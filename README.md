# UAII — Unified AI Accessibility Interface

> One AI conversation. Every human channel. Accessibility as a property of the protocol — not an afterthought per product.

**Specification:** [SPEC.md](SPEC.md) · **Version:** 0.2.0-draft · **License:** [CC-BY-4.0](LICENSE)

## Status

Public draft. Breaking changes expected until the v0.1 freeze. Open questions for v0.2 are tracked in [SPEC.md §7](SPEC.md#7-open-questions-v02-candidates).

## pi package — reference implementation

This repository is also a pi package. The bundled extension implements the spec contracts at terminal scale:

| SPEC.md | Extension behavior |
|---|---|
| §3.1 Intent Object | classifies every assistant reply: statement / question / action-request / media |
| §3.2 Renderer Contract | text (native floor) · audio (TTS) · plain-language (model rewrite) |
| §3.3 User Profile | `~/.config/uaii/profile.json` — portable, user-owned |
| §3.4 Negotiation | `/uaii` shows the kind → renderer coverage map |
| R2 no silent loss | every unrenderable payload becomes a declared `StructuredLoss` (`/uaii loss`) |
| §5 Degradation Ladder | both optional channels route through a local llama-swap first, then fall back, then declare loss |

Install for the current user:

```bash
pi install git:github.com/professorcinza/uaii-spec
```

Commands: `/uaii` · `/uaii audio on\|off` · `/uaii plain on\|off` · `/uaii urgency background\|normal\|alert\|critical` · `/uaii loss`.

## Local inference (llama-swap)

The extension binds optional channels to a local [llama-swap](https://github.com/mostlygeek/llama-swap) endpoint (any OpenAI-compatible server works). Defaults in the profile:

```json
{
  "inference": {
    "baseUrl": "http://localhost:9292/v1",
    "chatModel": "zai/glm-5.3-flash",
    "ttsModel": "pocket-tts-pt",
    "ttsVoice": "alba"
  }
}
```

Degradation ladders (§5) — first available rung wins, every skipped rung is a declared `StructuredLoss`:

| Channel | Ladder |
|---|---|
| audio | llama-swap `/audio/speech` → macOS `say` → `StructuredLoss` |
| plain-language | llama-swap `/chat/completions` rewrite → session model rewrite → `StructuredLoss` |

Set `ttsModel` or `chatModel` to `""` to skip that rung. When llama-swap is down, the extension keeps working and records the loss — never a silent failure (R2).

## UAII Live — hands-free voice (`bin/uaii-live`)

A terminal voice loop: **mic → parakeet STT → pi agent (full tools) → pocket-tts → speakers**, all through llama-swap. Half-duplex: the mic listens only while the agent is silent, so it never hears itself. Every failure speaks a declared loss (R2) and answers longer than 400 chars are truncated with a `StructuredLoss` on stderr (§5).

STT is **parakeet-pt** (NVIDIA Parakeet TDT 0.6b v3, multilingual incl. pt-BR, MLX). Benchmark against the previous whisper-large-v3-turbo rung on a 2.2 s pt-BR clip (M1 8 GB, warm): parakeet ≈ 0.5 s vs whisper ≈ 5 s — about 10× faster, which is why it is now the only STT rung. Parakeet is served by [paratran](https://pypi.org/project/paratran/) through `bin/paratran-serve.py`, a launcher that pins all MLX work to one worker thread (MLX binds arrays to the loading thread's stream — cross-thread inference fails with `There is no Stream(cpu, 1) in current thread`). llama-swap runs it as the `parakeet-pt` model (`aliases: [parakeet]`) in the `voice` group.

```bash
uaii-live              # in any project directory — pi runs there with full tools
```

Speak naturally; ~2.4s of silence ends your turn. Say **"sair"** (or tchau/encerrar) to exit; Ctrl+C always works.

Requirements: `ffmpeg` (mic capture, avfoundation), `afplay`, `curl`, `node`, `pi`, and llama-swap serving `parakeet-pt` + `pocket-tts-pt` (see the `inference` defaults above). On first run macOS asks for microphone permission — grant it to your terminal.

Tuning (env): `UAII_LIVE_DEVICE` (mic index), `UAII_LIVE_SILENCE_DB` (speech threshold, default −40), `UAII_LIVE_QUIET_CHUNKS`, `UAII_LIVE_MAX_SECS`, `UAII_LIVE_STT_MODEL` (space-separated ladder, default `"parakeet"`), `UAII_LIVE_TTS_MODEL`, `UAII_LIVE_TTS_VOICE`, `UAII_LIVE_BASE_URL`, `UAII_LIVE_PI_ARGS` (default `--no-extensions` — the UAII pi extension would double-speak otherwise).

This is a preview of the §7 input-fusion work: it is a client-side loop, not yet a UAII protocol mode. A true realtime (sub-second, barge-in) experience needs a speech-to-speech model; the ladder here is honest about that instead of pretending (R2).

## Contributing

Co-design review with assistive-technology user communities is required before v0.1 freeze. Open issues against the §7 items — input fusion grammar, cross-channel state sync, latency budgets, BCI contract, localization.
