#!/usr/bin/env python3
"""paratran serve + single-thread MLX affinity fix.

paratran 0.6.0 loads the parakeet model on the uvicorn main thread (lifespan)
but runs request-time inference via asyncio.to_thread. MLX binds arrays to the
stream of the thread that created them, so cross-thread eval always fails with:
"There is no Stream(cpu, 1) in current thread."

Fix: run ALL parakeet work (model load + inference) on one dedicated worker
thread; HTTP handlers block on a queue until the job completes.

Usage: paratran-serve.py [--host H] [--port P] [--model HF_ID] [--cache-dir D]
"""

import argparse
import os
import queue
import threading

parser = argparse.ArgumentParser()
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--port", type=int, default=9654)
parser.add_argument(
    "--model",
    default=os.environ.get("PARATRAN_MODEL", "mlx-community/parakeet-tdt-0.6b-v3"),
)
parser.add_argument("--cache-dir", default=os.environ.get("PARATRAN_MODEL_DIR") or None)
args = parser.parse_args()

# launchd gives llama-swap a minimal PATH; parakeet-mlx shells out to ffmpeg
# to decode audio. Prepend the Homebrew paths explicitly.
os.environ["PATH"] = (
    "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + os.environ.get("PATH", "")
)

os.environ["PARATRAN_MODEL"] = args.model
if args.cache_dir:
    os.environ["PARATRAN_MODEL_DIR"] = args.cache_dir

from paratran import server as ps  # noqa: E402

_jobs: queue.Queue = queue.Queue()


def _pump() -> None:
    while True:
        fn, fn_args, fn_kwargs, box, done = _jobs.get()
        try:
            box.append(fn(*fn_args, **fn_kwargs))
        except BaseException as exc:  # re-raised in the caller thread
            box.append(exc)
        finally:
            done.set()


threading.Thread(target=_pump, name="parakeet-inference", daemon=True).start()


def _run_on_worker(fn, *fn_args, **fn_kwargs):
    box: list = []
    done = threading.Event()
    _jobs.put((fn, fn_args, fn_kwargs, box, done))
    done.wait()
    result = box[0]
    if isinstance(result, BaseException):
        raise result
    return result


def _orig_load():
    from paratran.transcribe import get_model

    get_model()


def _load_model():
    _run_on_worker(_orig_load)


def _transcribe_file(path, options):
    from paratran.transcribe import transcribe_file

    return _run_on_worker(transcribe_file, path, options=options)


ps._load_model = _load_model
ps._transcribe_file = _transcribe_file

import uvicorn  # noqa: E402

uvicorn.run(ps.app, host=args.host, port=args.port)
