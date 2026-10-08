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

## Contributing

Co-design review with assistive-technology user communities is required before v0.1 freeze. Open issues against the §7 items — input fusion grammar, cross-channel state sync, latency budgets, BCI contract, localization.
