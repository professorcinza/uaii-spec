# UAII — Unified AI Accessibility Interface

**Version:** 0.1.0-draft · **Status:** Public Draft · **License:** CC-BY-4.0 · **Normative language:** [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)

> One AI conversation. Every human channel. Accessibility as a property of the protocol — not an afterthought per product.

---

## 1. Reason for Existence

AI systems emit one language: rich, visual, streaming, multimodal. Humans do not receive through one channel. Today, every assistive technology re-invents this translation per product, per platform, per release — and loses information silently each time.

UAII defines **one contract** between AI output and human input/output channels.

**If a user's channel cannot receive what the AI produced, that is a protocol violation — never the user's problem.**

verify: `grep -q "protocol violation" SPEC.md`

## 2. Scope

### 2.1 In scope (v0.1)

- **Intent Object**: the abstract, presentation-free unit of AI output.
- **Renderer Contract**: obligations for every channel renderer.
- **User Profile**: portable, user-owned capability and preference schema.
- **Capability Negotiation**: handshake between AI services and user agents.

### 2.2 Non-Goals (permanent)

| Non-Goal | Rationale |
|---|---|
| Replace WCAG 2.2 / WAI-ARIA | UAII governs AI↔channel mediation; WCAG governs web content. Complementary, never competing. |
| Standardize hardware | Devices evolve; contracts must not encode circuits. |
| Mandate any channel | No channel — including visual — is ever required to operate. |
| Define input fusion grammar | Deferred to v0.2. v0.1 input is pass-through. |
| Infer disability status | Systems derive behavior from declared channel needs, never from diagnosed identity. |

## 3. Core Model

### 3.1 Intent Object

The atomic unit of AI→human communication. AI services **MUST** emit Intent Objects; they **MUST NOT** emit presentation decisions ("show a red chart") to user agents.

```text
IntentObject {
  id:          uuid-v7            // stable across updates; streaming refines in place
  kind:        statement | question | comparison | sequence | spatial
             | temporal | media | action-request | error
  payload:     TypedPayload       // abstract semantics, never layout
  salience:    float 0..1         // ranking within the response
  urgency:     background | normal | alert | critical
  alternatives: [IntentObject]    // equivalent expressions, same id-space
}
```

**Payload rule:** payload describes *meaning and structure* ("comparison of 3 series over 12 months"), never appearance ("line chart, red, 800×400"). A renderer **MUST** be able to decide presentation from `kind` + `payload` + User Profile alone.

### 3.2 Renderer Contract

A Channel Renderer consumes `(IntentObject, UserProfile)` and produces channel-native output (speech, braille, haptics, screen-reader text, visual, switch/scanning, gaze, …).

Every renderer **MUST**:

1. Handle every `kind` it declares in negotiation.
2. **Degrade declared, not silent**: when payload cannot map to the channel, emit a `StructuredLoss` object — what was lost, why, and the best partial representation. **MUST NOT silently drop content.**
3. Respect profile constraints (rate limits, density, session length, modality on/off).

```text
StructuredLoss {
  intent_id:  uuid-v7
  lost:       string            // what could not be represented
  reason:     bandwidth | latency | channel-off | unmappable
  partial:    TypedPayload?     // best-effort reduced representation
}
```

### 3.3 User Profile

```text
UserProfile {
  channels:    [{ channel, priority, enabled }]
  constraints: { max_rate, max_session_length, noise_tolerance }
  cognitive:   { plain_language, structure_first, max_working_set }
  context:     { environment: quiet | noisy | public | private,
                 hands_busy, eyes_busy }
}
```

- The profile **MUST** be portable (export/import as a unit) and user-controlled.
- Context is a *live* layer: a quiet office and a noisy street change the same profile's behavior without changing stored preferences.

### 3.4 Capability Negotiation

Session handshake, before first Intent Object:

```text
UAII/1.0 NEGOTIATE
  ai  → declares: supported kinds, streaming, max object rate
  ua  → declares: available renderers, kind coverage, profile digest
  ← agreed: kind→renderer map + ordered fallback chain per kind
```

If coverage for a kind is zero, the AI **MUST** re-express that content in a covered kind. The fallback chain **MUST** end in `StructuredLoss`, never in absence.

## 4. Normative Rules

- **R1.** Every user-facing AI output **MUST** be expressible as Intent Objects.
- **R2.** Renderers **MUST NOT silently drop content.** All degradation is structured (`StructuredLoss`) and visible to the user through an active channel.
- **R3. No channel is required.** The system **MUST** be fully operable with any single channel, including text-only. Requiring any channel — visual included — for any operation is a protocol violation.
- **R4.** Streaming updates **MUST** be id-stable: refinements update existing Intent Objects in place; screen readers **MUST NOT** re-announce the world per token.
- **R5.** `critical` urgency **MUST** preempt `background` traffic on every channel, subject to that channel's physical rate limit.
- **R6.** User Profile data **MUST NOT** leave the user agent without explicit, revocable consent; AI services receive digests, never raw profiles, unless consented.
- **R7.** All protocol text (loss notices, errors, labels) **MUST** be plain-language when `cognitive.plain_language` is set. Protocol strings are content, not chrome.

verify: `test "$(grep -cE '^- \*\*R[0-9]\.' SPEC.md)" -eq 7 && grep -q "StructuredLoss" SPEC.md && echo PASS`

## 5. Degradation Ladder

For each `kind`, normative fallback order when the primary channel cannot map it. Renderers implement the ladder; the ladder is the compatibility floor.

| kind | 1st choice | 2nd | 3rd | floor |
|---|---|---|---|---|
| spatial | native spatial (haptic/gaze) | structured text description | verbal enumeration | StructuredLoss |
| media | described + captioned playback | transcript | summary | StructuredLoss |
| comparison | table (channel-native) | verbal pairwise | ranked list | StructuredLoss |
| temporal | timeline (channel-native) | ordered narration | event list | StructuredLoss |
| action-request | channel-native confirmation | yes/no prompt | verbal confirm | StructuredLoss |

**Never** does a ladder skip its floor: if step N fails, `StructuredLoss` fires. Silence is the only forbidden outcome.

## 6. Conformance

An implementation is **UAII-conformant (v0.1)** iff:

1. It emits or consumes valid Intent Objects (§3.1) with id-stable streaming (R4).
2. It completes negotiation (§3.4) before first Intent Object.
3. It never silently drops content (R2) and honors the degradation floor (§5).
4. It operates with any single channel (R3) and keeps profile data user-controlled (R6).

Conformance is testable: each clause maps to the Gherkin features below.

```gherkin
Feature: No silent loss
  Scenario: Renderer cannot map a spatial payload
    Given a renderer that declares only "statement" coverage
    When it receives an IntentObject of kind "spatial"
    Then it emits a StructuredLoss with reason "unmappable"
    And the user receives the floor representation on an active channel

Feature: Single-channel operation
  Scenario: Text-only user agent
    Given a profile with only the "text" channel enabled
    When the AI emits any IntentObject
    Then the full response is available through the text channel
    And no step requires visual or audio confirmation
```

verify: `grep -q "Feature: No silent loss" SPEC.md && grep -q "Feature: Single-channel operation" SPEC.md && echo PASS`

## 7. Open Questions (v0.2 candidates)

- **Input fusion grammar**: combining gaze + switch + speech into one intent.
- **Cross-channel state sync**: resuming a session on a different channel mid-conversation.
- **Latency budgets**: measured per-channel budgets for R5 preemption (need data, not opinion).
- **BCI contract**: what `kind` set is honest for current non-invasive interfaces.
- **Localization**: plain-language rules (R7) per language community.

## 8. References

- RFC 2119 — normative keywords
- WCAG 2.2 / WAI-ARIA — web accessibility layer UAII complements
- UIA (Windows) · AXAPI (Apple) · AT-SPI (Linux) — platform accessibility APIs UAII abstracts over
- ISO/IEC 40500 — WCAG as ISO standard

---

*Next step: publish as a public repo (GitHub) with `LICENSE` (CC-BY-4.0), open a `v0.2` discussion branch for §7, and recruit co-design reviewers from assistive-technology user communities before freezing v0.1.*
