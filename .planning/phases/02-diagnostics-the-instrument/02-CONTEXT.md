# Phase 2: Diagnostics — The Instrument - Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Every claim the rest of the project makes about which model ran, what parameters reached it, and what it cost becomes checkable rather than assumed.

**Requirements:** DIAG-01, DIAG-02, DIAG-03, DIAG-04, DIAG-05, DIAG-06, DIAG-07, DIAG-08

**Success criteria (from ROADMAP.md, binding — this is the spec):**

1. For any model invocation the user can read the exact JSON that went on the wire, with credentials redacted **at capture time** and dumps written only to gitignored paths — a wire inspector is by construction a credential-logging tool feeding a public repo.
2. A build-failing check proves no model call bypasses the instrument: `modelRegistry.complete` called outside `diagnostics/` fails the build, because provider hooks wire only into the main agent's `streamFn` and any un-chokepointed nested call is invisible.
3. Every turn appends a JSONL row carrying model, provider, tokens, cost, latency, cache-read ratio and outcome — and no reasoning-token column for Bedrock, which reports none.
4. When a model writes a tool call as prose (`finish_reason:"stop"` with `tool_calls:null`) the turn is logged as `prose_tool_call` and retried rather than treated as complete.
5. `/budget` reports system-prompt, tool-schema, context-file and skills-index tokens plus `cacheRead` vs `input`, and logs rotate rather than growing unbounded.

**Contains [RUNBOOK] requirements:** DIAG-01 and DIAG-05. Both carry `[FAUX]` **and** `[RUNBOOK]`: the offline half is verifiable on this machine with `fauxProvider`, the live half is not. Plan them as *built + unit-verified offline* plus an appended entry in the existing `docs/RUNBOOK.md` whose live check is **OUTSTANDING**. Never plan them as passing.

</domain>

<decisions>
## Implementation Decisions

Recorded in PROJECT.md (Key Decisions), ROADMAP.md and `.planning/research/ARCHITECTURE.md`. Binding on this phase; not to be re-derived.

**Already decided, binding:**

1. **A single exported `callModel()` chokepoint.** Verified at source (`dist/core/sdk.js:170-215`): `before_provider_request`, `after_provider_response`, `before_provider_headers` and `context` are wired into the *main agent's* `streamFn` only. A direct `ctx.modelRegistry.complete()` reaches `ModelRuntime.complete()` and fires none of them — so the inspector is blind to exactly the nested calls (advisor, reviewer, classifier) whose parameters most need verifying. `ProviderRequestOptions` carries per-call `onPayload` / `onResponse` (`pi-ai/dist/types.d.ts:70,74`), which is how the chokepoint restores visibility. `callModel()` is a **Phase 2 export** that Phases 5 and 8 import — its signature is a cross-phase contract, not an internal detail.

2. **The chokepoint is enforced mechanically, not by convention.** DIAG-03: a lint or test that fails the build when `modelRegistry.complete` appears outside `diagnostics/`. Without it, DIAG-02 decays the first time someone adds a nested call.

3. **Redaction happens at capture, not at read.** A wire dump that ever contains a live key on disk in a public repo is a breach even if a later reader would have masked it. Dumps go only to gitignored paths and a test must prove both properties.

4. **Local JSONL, no observability service.** Self-hosted Langfuse (Postgres + ClickHouse) was rejected against the zero-infra / zero-spend constraints. Files under `.pi/logs/`.

5. **Instrument before you tune.** Per-role and main-loop thinking budgets stay unbuilt until this instrument proves the parameters land (GATE-10, and the Carried-Forward Unknowns R1 / "does DeepSeek V4 Flash honour `reasoning_effort` through `openai-completions`"). Phase 2 exists to *answer* those, not to act on them.

6. **No reasoning-token column for Bedrock.** Converse reports none; a zero would be a fabricated measurement.

**Claude's discretion (guided by ROADMAP criteria + `.planning/research/ARCHITECTURE.md`):**
File decomposition inside `.pi/extensions/`, the exact JSONL row schema and field names, rotation policy (size vs date) and its thresholds, the redaction matcher's implementation, the DIAG-03 enforcement mechanism (test vs lint), the `/budget` output format, and the retry strategy for a detected prose tool call.

</decisions>

<code_context>
## Existing Code Insights

Phase 1 created the shape this phase writes into. Do not re-create it.

- `package.json` — `pi.extensions: ["./.pi/extensions"]`, `type: "module"`, peers declared for `@earendil-works/pi-{coding-agent,ai,tui,agent-core}` and `typebox` (never bundle). Scripts: `test` (`vitest run`), `test:unit`, `typecheck` (`tsc --noEmit`).
- `.pi/extensions/harness/index.ts` — the single existing extension; the diagnostics subsystem attaches here or alongside it.
- `tests/unit/`, `tests/integration/`, `tests/helpers/` (`git.ts`, `pi.ts`, `stub-bin.ts`, `win-quote.ts`), `tests/fixtures/` — 248 tests green, `tsc` clean. Reuse the helpers rather than adding parallel ones.
- `docs/RUNBOOK.md` — **already exists** with entries RB-01-01/02/03 and an outstanding-status guard test (`tests/unit/docs-policy.test.ts`). Phase 2 **appends** RB-02-xx entries; it must not recreate the file, and the guard must keep passing.
- `.gitignore` — `.pi/logs/`, `.pi/sessions/`, `.pi/cache/`, `.pi/state/`, `.pi/auth.json`, `logs/`, `*.log` and a blanket `*.jsonl` are already ignored. DIAG-07's gitignored-path requirement is largely satisfied by existing rules; the deliverable is the **test that proves it**, plus any additional path the design introduces.
- No build step. Pi loads `.ts` through jiti; adding a build breaks `/reload`.

Verified platform facts that constrain this phase:
- `fauxProvider()` from `@earendil-works/pi-ai` is the offline harness: `setResponses()` / `appendResponses()`, response **factories** that receive `(context, options, state, model)` and can therefore assert on the *outgoing* request, builders `fauxText` / `fauxThinking` / `fauxToolCall` / `fauxAssistantMessage({ stopReason, ... })`, and `state.callCount`. Register with `pi.registerProvider(faux.provider)`.
- `ctx.getSystemPrompt()` is exact for the system prompt but explicitly excludes `context`-hook message edits and `before_provider_request` rewrites (`docs/extensions.md:1066-1073`). For ground truth, `/budget` must read the captured payload, not the estimate.
- `before_provider_headers` fires **once per request**; retries reuse headers and do **not** re-fire. Any per-attempt correlation id must not rely on it.
- `before_provider_request` returning any non-`undefined` value **replaces the payload** for later handlers and for the real request — a capture hook must return `undefined`.
- `message_end` may return a replacement message but it **must keep the same `role`** — relevant to the prose-tool-call detector's retry path.
- Pi's own bundled examples `examples/extensions/provider-payload.ts` and `dynamic-tools.ts` are the reference implementations; prefer them over third-party READMEs.

</code_context>

<specifics>
## Specific Ideas

From `.planning/research/ARCHITECTURE.md` (Patterns 2 and 5) — binding on planning:

- Layout under `.pi/extensions/diagnostics/`: wire capture, `call-model.ts` (the exported chokepoint), `jsonl.ts` (append-only writer + rotation), `budget.ts` (system-prompt / tool-schema token reporter).
- Log files: `.pi/logs/wire-<date>.jsonl` (full request/response payloads, redacted at capture), `.pi/logs/turns-<date>.jsonl` (one row per turn *and* per nested call). `.pi/audit.jsonl` belongs to Phase 4's safety layer — do not build it here.
- Four call paths must funnel through diagnostics or the log has holes: the main agent loop, nested advisor/reviewer calls, subagent calls, and anything routing adds later. `callModel()` is that funnel.
- `docs/DIAGNOSTICS.md` — a JSONL schema reference, so later phases can read the log without reading the code.
- The prose-tool-call detector targets the measured ~11% DeepSeek failure mode (DeepSeek-V3 issue #1244, still open, titled for V4-Pro). It is a `message_end`-class detector: `finish_reason:"stop"` with `tool_calls:null` and a function name in `content`. It must **retry**, not merely log.
- `/budget` is a command, not a tool — per the CONTRIBUTING boundary rule (BOOT-10), new capability defaults to command or skill because tool schemas ride in every request payload.

</specifics>

<deferred>
## Deferred Ideas

- Per-role and main-loop thinking budgets — gated on what this instrument measures (Phase 8, GATE-10).
- The controlled experiment attributing "DeepSeek misses bugs Sonnet would catch" to prose tool calls vs context pollution vs provider misconfiguration — Phase 10. Phase 2 only supplies the measurement apparatus.
- `.pi/audit.jsonl` and the safety audit trail — Phase 4.
- Routing's use of `callModel()` — Phase 5; this phase only exports it with a stable signature.
- Any hosted or self-hosted observability backend (Langfuse et al.) — rejected on the zero-infra constraint.

</deferred>
