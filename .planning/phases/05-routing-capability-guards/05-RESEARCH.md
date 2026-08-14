# Phase 5: Routing & Capability Guards - Research

**Researched:** 2026-08-14
**Domain:** Pi 0.84.1 extension API (model selection, session entries, capability metadata) + Qoder Cloud Agents HTTP API
**Confidence:** HIGH — every claim below is either a direct read of Pi 0.84.1's recovered TypeScript/compiled JS with `file:line`, a direct read of this repository's own Phase 2-4 source, or an official Qoder docs page fetched live. Nothing in this file is exploratory: ROADMAP.md already records "Research: Not needed" for the routing mechanism itself, and this document exists only to (a) pin the exact shape of the Phase 2-4 contracts Phase 5 consumes, (b) verify the four capability blocks at source, and (c) settle ROUTE-11's HTTP shape. Two genuinely new, load-bearing findings surfaced during (a)/(b) that were not in `05-CONTEXT.md` — see the callouts marked **NEW FINDING**.

## Summary

Phase 5 writes exactly one new extension directory (`.pi/extensions/routing/` per ARCHITECTURE.md's sketch, file split at the planner's discretion) plus one delegate-tool registration for Qoder. Every mechanism it needs already exists, verified, in Pi 0.84.1 or in this repository's own Phase 2-4 code: `pi.setModel()` (returns `Promise<boolean>`, never throws for missing auth because the extension-facing wrapper pre-checks `hasConfiguredAuth` before calling the throwing inner method), `pi.appendEntry()` (zero-context-token custom session state), `ctx.modelRegistry.find/hasConfiguredAuth` (synchronous capability + auth lookups), and Phase 2's `callModel()` chokepoint (single-shot nested calls with full wire capture). Phase 3's `callWithFallback()` is a plain async function importing `callModel()` — Phase 5's router calls it exactly like any other caller, no special contract.

**The single most consequential finding in this research**: Pi 0.84.1 **already persists and restores the executor model across a restart natively**, with zero custom code. `AgentSession#setModel` (`agent-session.js:1197-1209`) calls `this.sessionManager.appendModelChange(model.provider, model.id)` (`agent-session.js:1204`) on every `pi.setModel()` call, which writes a native `{type:"model_change", provider, modelId}` session entry (`session-manager.js:790-801`). On session resume, `buildSessionContext()` → `getSessionContextSettings()` walks the branch and derives the effective model from the **last** `model_change` entry (or the last assistant message's own `provider`/`model`, whichever is later in path order) (`session-manager.js:146-161, 232-236`). This means ROUTE-09's "mode survives a restart at zero context-token cost" is **not** a claim the harness has to build a restore path for with respect to the executor model — Pi already does it. What the harness's `pi.appendEntry("ky:mode", …)` custom entry is actually for is narrower: persisting the **mode name** (`cheap`/`balanced`/`max`), the `/escalate` sticky flag, and whatever the harness needs to redisplay/re-derive on `session_start` that Pi's own `model_change` entry does not carry (e.g., which non-executor roles map to which models, for redisplay — those role assignments are not modelled as Pi session entries at all since only the executor's model is a session concept). The planner should scope ROUTE-09's `appendEntry` payload to exactly this narrower state, not re-implement model restoration.

**Primary recommendation:** Build `routing/` as a thin layer over four already-verified primitives — `pi.setModel()` (executor + `/escalate`), `callModel()`/`callWithFallback()` (single-shot roles), subagents via `settings.subagents.agentOverrides` (tool-loop roles), and `pi.appendEntry("ky:mode", …)` (mode-name persistence only). Build the capability guard as a pure predicate table keyed on `Model<Api>` fields already present in the catalogue (`input`, `reasoning`, `contextWindow`) plus **one explicit model-id deny-list** for Bedrock DeepSeek R1, because Pi's `Model<TApi>` type carries no tool-calling-support field at all (verified below) — the R1 block cannot be expressed as a catalogue predicate and must name the id directly. Build the Qoder delegate tool as a single `pi.registerTool()` using Node's built-in `fetch` (Node ≥22.19.0 ships it globally; zero new dependency), gated on `QODER_PERSONAL_ACCESS_TOKEN` being set, writing its own JSONL transcript via `.pi/lib/jsonl.ts#appendJsonl` to a gitignored path, reusing `diagnostics/redact.ts#redactDeep`/`redactString` at capture.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **Routing is THREE mechanisms, not one — and which one applies is decided by the role, not per turn.**
   - **Executor + `/escalate`** → `pi.setModel()` from a **command handler**, after `await ctx.waitForIdle()`.
   - **Single-shot roles** (review, advisor, vision, summarise) → `ctx.modelRegistry.complete()` **via Phase 2's `callModel()` chokepoint**, per-call reasoning effort, **no session mutation**.
   - **Roles needing a tool loop** → **subagents**.
2. **DO NOT build a virtual `streamSimple` provider.** Explicitly out of scope for v1.
3. **Mode persistence is `pi.appendEntry`, not a file and not context.** Entries restored from `ctx.sessionManager.getBranch()` on `session_start`. Namespace the entry type (`ky:mode`).
4. **The four hard capability blocks are refusals with a reason, never a silent downgrade** (ROUTE-06/07/08): image → text-only model; oversized context → small-window model; Bedrock non-Claude + thinking (silently dropped while UI still offers it); Bedrock DeepSeek R1 as executor (no tool calling at all).
5. **The mode switch also writes `settings.subagents.agentOverrides`.** Phase 5 owns the override write; Phase 7 wires the subagent package.
6. **Every claim about which model served a turn is proven by Phase 2's wire dump, not asserted** (ROUTE-10).
7. **Routing MUST go through the Phase 2 chokepoint.** `tests/unit/chokepoint-lint.test.ts` fails the build if `modelRegistry.complete` is called outside `diagnostics/`. Routing calls `callModel()`; it never calls `complete()` itself.
8. **`safety/` imports nothing from routing, BY DESIGN.** Routing may import from `diagnostics/` and from `providers/`. Routing may not create a cycle and safety must not gain a routing import. Cross-subsystem signalling uses `pi.events.on/emit`, not an import.
9. **`setModel` can fail, and the failure must be handled, not hoped through.** Returns `false` when there is no API key; can throw. A `/cheap` that silently no-ops and leaves the session on the expensive model is forbidden.
10. **Fallback is Phase 3's `callWithFallback`, and its chain is DeepSeek-direct → DashScope.** Reuse it; do not write a second chain.
11. **ROUTE-11 — Qoder is a DELEGATE TOOL only** — never a routable model, never a `models.json` entry, never a fallback hop, never in the role→model map or capability guard. Official surface only: PAT (`QODER_PERSONAL_ACCESS_TOKEN`, `pt-…`) + Cloud Agents API at `https://api.qoder.com/api/v1/cloud`. Never a bypass proxy.
12. **The Qoder delegate tool is a FOREIGN AGENT and its bypass is a first-class, user-facing statement.** Pi's tools, `AGENTS.md`, system prompt, safety hooks and wire inspector all bypass it. Belongs in `docs/` prose and in the tool's own description.

### Claude's Discretion

Whether the role→model map lives in TypeScript or JSON and where; the exact command names beyond `/cheap`, `/balanced`, `/max`, `/escalate` (and how `/escalate off` is spelled); how the capability guard is decomposed; the file split inside `routing/`; how mode state is surfaced visibly; the `RB-05-xx` numbering and section ordering in `docs/RUNBOOK.md`; where the foreign-agent caveat is published in `docs/`; and how the subagent `agentOverrides` write is shaped so Phase 7 can adopt it without rewriting.

### Deferred Ideas (OUT OF SCOPE)

- The virtual `streamSimple` provider and automatic per-turn routing — not v1.
- Qoder as a **model, provider or fallback hop** — permanently excluded.
- `/quick` and the evidence gate — Phase 6.
- Installing and pinning `pi-subagents` itself — Phase 7. Phase 5 writes the `agentOverrides` shape only.
- Quality gates, non-rubber-stamping reviewer, advisor escalation policy — Phase 8.
- Ceremonial workflows — Phase 9.
- Per-turn context budget / progressive disclosure — Phase 10.
- Statusline, header, subagent widget — Phase 11.
- Worktree isolation — v1.x.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| ROUTE-01 | Explicit role→model map: executor, planner, reviewer, advisor, vision, summariser | §Part A.6 (models-template.json fields), §Summary (vision role has no text-only DashScope answer — must name a Bedrock Claude id, e.g. `anthropic.claude-sonnet-4-5-20250929-v1:0`, verified present in catalogue) |
| ROUTE-02 | `/cheap`/`/balanced`/`/max` swap the map via `pi.setModel()` from a command after `waitForIdle()` | §Part B.4 (exact `pi.setModel()` contract, `agent-session.js:1885-1890`), §Part A.5 (command registration pattern from `harness/index.ts`) |
| ROUTE-03 | `/escalate` pulls a stronger model, visible + sticky until cleared | §Part B.4-5 (`pi.setModel()` + `pi.appendEntry` contracts) |
| ROUTE-04 | Single-shot roles run through `callModel()` with per-call reasoning effort, no session mutation | §Part A.1 (`callModel()` exact signature) |
| ROUTE-05 | Tool-loop roles run as subagents | §Part A.6 (`agentOverrides` write target — no existing merge machinery covers it, NEW FINDING) |
| ROUTE-06 | Hard-block image→text-only, oversized-context→small-window | §Part B.3 (`Model.input`/`contextWindow` accessor path, `model-registry.d.ts:26-28`) |
| ROUTE-07 | Hard-block Bedrock non-Claude + thinking | §Part B.1 (`buildAdditionalModelRequestFields`, exact predicate `isAnthropicClaudeModel`, `bedrock-converse-stream.js:542-550,889-927`) |
| ROUTE-08 | Hard-block Bedrock DeepSeek R1 as executor | §Part B.2 (catalogue has no tool-support field at all — deny-list required, NEW FINDING confirmed at `types.d.ts:661-682`) |
| ROUTE-09 | Mode persists across restart via `pi.appendEntry`, zero context tokens | §Summary (**NEW FINDING**: executor model already persists natively via `model_change` entries; `appendEntry` scope is narrower than assumed) |
| ROUTE-10 | Every mode switch produces a wire dump proving the intended model was used | §Part A.2 (exact wire-record schema, `WireKind`, correlation id, reader helpers) |
| ROUTE-11 | Qoder delegate tool, foreign-agent bypass documented | §Part C (exact HTTP shape: auth header, environment/session/event/stream endpoints, SSE envelope) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Executor model selection (`/cheap`, `/balanced`, `/max`, `/escalate`) | Extension command (`ExtensionCommandContext`) | Pi core session (`AgentSession#setModel`) | Commands are the only context carrying `waitForIdle()`; Pi core owns the actual mutation and its native persistence |
| Single-shot role calls (review, advisor, vision, summarise) | Diagnostics chokepoint (`callModel()`) | Routing (caller) | Chokepoint owns wire visibility; routing owns which model/role to call with |
| Tool-loop roles (planner, and any role needing files/bash) | Subagent process (Phase 7 package, not yet installed) | Routing (`agentOverrides` writer) | A subagent is a separate `pi` child process; routing only writes the config it reads |
| Capability guard (image/context/thinking/tool-calling blocks) | Routing (pure predicate over `Model<Api>`) | — | No Pi-side hook exists for this; it is app logic evaluated before `setModel`/`callModel`/subagent dispatch |
| Mode persistence | Session entries (`pi.appendEntry` + Pi's native `model_change` entries) | Routing (`session_start` restore) | Pi already persists the model; routing persists only the mode *name* and escalation flag |
| Qoder delegate | Routing-adjacent tool (own file, not `diagnostics/`, not the role→model map) | External HTTP (Qoder Cloud Agents API) | A registered tool is the only way the model can invoke it mid-turn; it is architecturally a foreign agent, never a routing target |
| Fallback on provider failure | `providers/fallback.ts` (Phase 3, existing) | Routing (caller via `callModel`/`callWithFallback`) | Already built; routing consumes it unmodified |

---

# Part A — Prior-Phase Contract Verification

## A.1 `.pi/extensions/diagnostics/call-model.ts` — `callModel()` exact contract

**File:** `.pi/extensions/diagnostics/call-model.ts:365-496`

```typescript
export async function callModel<TApi extends Api>(
  ctx: ExtensionContext,
  opts: CallModelOptions<TApi>,
): Promise<AssistantMessage>
```

| Field | Type | Notes | Cite |
|---|---|---|---|
| `role` | `string`, **mandatory, never defaulted** | Join key for `wire-*`/`turns-*` correlation. Every Phase 5 call MUST pass a real role name (e.g. `"reviewer"`, `"advisor"`, `"vision"`, `"summariser"`) — not `"executor"`, which never goes through `callModel` (it uses `setModel`). | `call-model.ts:182-189` |
| `model` | `Model<TApi>` | The resolved model object, e.g. from `ctx.modelRegistry.find(provider, id)` or `CHAIN` resolution inside `callWithFallback`. | `call-model.ts:190` |
| `systemPrompt` | `string?` | Per-call system prompt for the nested request. | `call-model.ts:191` |
| `messages` | `Message[]` | The nested request's message array — routing composes this itself; it is not the session's messages. | `call-model.ts:192` |
| `tools` | `Tool[]?` | Rarely used by single-shot roles; a role needing tools should be a subagent instead (ROUTE-05). | `call-model.ts:193` |
| `api` | `WithoutCaptures<ModelsApiStreamOptions<TApi>>?` | **Per-call reasoning effort goes here**: `opts.api = { reasoningEffort: "high" }` (OpenAI-shaped APIs) or `{ thinkingEnabled: true, thinkingBudgetTokens: N }` (Anthropic-shaped/Bedrock). This is exactly what ROUTE-04 means by "per-call reasoning effort". `onPayload`/`onResponse`/`transformHeaders`/`signal` are stripped from the type (capture keys, owned by the chokepoint) — **and enforced by spread order** (`opts.api` spread first, chokepoint's captures spread after, so a caller cannot suppress its own capture even against a loosely-typed `Model<Api>`). | `call-model.ts:170-172, 204, 391-397, 438-445` |
| `signal` | `AbortSignal?` | **Defaults to `ctx.signal`** when omitted — so pressing Esc during the main turn cancels a nested single-shot call too. Routing should generally omit this and let the default apply. | `call-model.ts:206-211, 398` |

**Return:** `Promise<AssistantMessage>`. On a provider-level failure the function **rethrows** after writing a `kind:"nested"` error row — the caller (routing, or `callWithFallback`) owns the fallback decision; `callModel` never swallows. (`call-model.ts:464-479`)

**What it appends, and under what `role`/`corr`:** four records under one correlation id issued by `callModel` itself (`nextCorrelationId(sessionId)`, `call-model.ts:372`): `nested.headers`, `nested.request`, `nested.response` in `wire-*.jsonl`, and exactly one `kind:"nested"` row in `turns-*.jsonl`, written on **both** success and failure paths (`call-model.ts:344-349, 481-493`). Every one of these carries the `role` string passed in `opts.role` (`call-model.ts:373, 384-386`) — this is the field ROUTE-10's test reads back to prove "the intended model actually served the next turn" for a non-executor role.

**No session mutation:** `callModel` never touches `ctx.model`, never calls `pi.setModel`, never appends a session entry. It is a pure nested completion — matching ROUTE-04's requirement exactly.

## A.2 Wire record schema — what a ROUTE-10 test reads back

**Files:** `.pi/extensions/diagnostics/schema.ts`, `wire.ts`, `turns.ts`. **Helper:** `tests/helpers/logs.ts`.

For ROUTE-10 ("every mode switch produces a wire dump proving the intended model was used"), the observable differs by mechanism:

| Route mechanism | What proves the model served the turn | Field(s) | Reader |
|---|---|---|---|
| Executor via `pi.setModel()` | The **next main-loop turn's** `turns-*.jsonl` row, `kind:"turn"` | `TurnRow.model` (`"${provider}/${id}"` shape — actually stored as separate `provider`/`model` fields, `schema.ts:215-216`) | `tests/helpers/logs.ts#readTornSafe`/`readJsonl`, filtered by `kind==="turn"` and taking the row **after** the mode switch |
| Single-shot role via `callModel()` | The `wire-*.jsonl` `nested.request`/`nested.response` pair AND the `turns-*.jsonl` `kind:"nested"` row, joined by `corr` | `WireRecord.role`, `WireRecord.corr`; `TurnRow.role`, `TurnRow.model` | Same helpers, filtered by `role === opts.role` |
| Subagent role | Out of scope for Phase 5's own wire log — a subagent is a separate `pi` process with its own diagnostics extension instance (if the child also loads `.pi/extensions/diagnostics/`) or none at all (Phase 7 concern) | — | Not testable from Phase 5's own log; ROUTE-05's test should assert the `agentOverrides` config is written correctly, not that a subagent's wire log exists |

**Key schema facts** (`.pi/extensions/diagnostics/schema.ts`):
- `WireKind` union: `"main.headers" | "main.request" | "main.response" | "nested.headers" | "nested.request" | "nested.response"` (`schema.ts:305-311`). A Phase 5 test asserting on a `nested.*` record is asserting on the correct half of the union.
- `TurnRow.role: string` — `"session"` (constant `SESSION_TURN_ROLE`, `diagnostics/index.ts:143`) for every main-loop turn, or `opts.role` for a nested call (`schema.ts:209-211`). **A ROUTE-10 test for the executor path must NOT filter on `role==="executor"` — main-loop rows are always `role:"session"`.** The executor's identity is proven by `TurnRow.model`/`provider`, not by `role`.
- `TurnRow.model: string`, `TurnRow.provider: string` (`schema.ts:216`) — the fields that actually say which model served a turn.
- Correlation: `corr` is `"${sessionId}#${n}"`, a process-wide counter (`wire.ts:183, 223-226`). Nested calls issue their own `corr` inside `callModel` itself, so a nested row's `corr` is never confused with the main loop's, **within one serial agent loop** — the module docstring explicitly states this assumption does NOT hold for `rpc` mode or concurrent in-process work (`wire.ts:64-87`), which is a residual limitation Phase 5's own tests do not need to solve but should not contradict.

**Reader helpers, exact exports** (`tests/helpers/logs.ts`):
- `withTempLogCwd<T>(fn): Promise<T>` — temp `.pi/logs`-shaped cwd, cleaned up after.
- `logFilesIn(dir): string[]`.
- `readJsonl(path): unknown[]` — **throws** on a malformed line; use for logs the test itself produced.
- `readTornSafe(path): TornSafeResult` — **never throws**; returns `{records, unparseable}`.

For a session-based ROUTE-10/02/03/09 test, the natural harness is `tests/helpers/session.ts#withFauxSession` (see A.8) driving a real `createAgentSession` with a faux provider and a real extension under test at user scope, then reading the wire/turns JSONL out of the session's own `cwd` with `readTornSafe`.

## A.3 `tests/unit/chokepoint-lint.test.ts` — the EXACT rule a `routing/` directory must obey

**File:** `tests/unit/chokepoint-lint.test.ts:52-280`

**Scanned set:** every tracked `.ts` under `.pi/extensions/` (`EXT_DIR = ".pi/extensions"`, line 60), **except** anything under `.pi/extensions/diagnostics/` (the `CHOKEPOINT_DIR` prefix, line 69) and anything in `CHOKEPOINT_BYPASS_ALLOWLIST` (currently empty, line 89). A new `.pi/extensions/routing/**/*.ts` directory is fully in scope and gets no exemption.

**Forbidden regexes** (all matched against raw source text, comments included — routing files may not even *name* these in prose):

| Pattern | Why banned |
|---|---|
| `\bmodelRegistry\s*(?:\?\.\|\.)\s*complete\b` | The direct completion `callModel()` wraps |
| `\bmodelRegistry\s*(?:\?\.\|\.)\s*completeSimple\b` | Same bypass, different overload |
| `\bmodelRegistry\s*(?:\?\.\|\.)\s*(?:stream\|streamSimple)\b` | Streaming siblings, no finalized message recorded |
| `\bmodelRegistry\s*(?:\?\.\|\.)\s*getProvider\b` | Hands back a raw `Provider` whose `.stream()` bypasses everything |
| `getRegisteredNativeProvider` | Other route to a raw `Provider` |
| `from\s+["']@earendil-works/pi-ai/api/` | Deep-import of an adapter's `stream` |
| `\bModelRuntime\b` | Public export, drivable directly |

**Explicitly NOT banned** (line 99-104): `modelRegistry.find`, `.getAvailable`, `.getAll`, `.hasConfiguredAuth`, `.getProviderAuthStatus`, `.registerProvider` — the docstring names this exact set as needed by "Phase 5's capability guard". **Routing code may freely call `ctx.modelRegistry.find(...)`, `.getAvailable()`, `.hasConfiguredAuth(...)` for capability checks and pre-flight auth checks; it may not call `.complete()`/`.completeSimple()`/`.stream()`/`.streamSimple()`/`.getProvider()` anywhere, including inside a comment.**

**Practical consequence for the planner:** any routing-internal helper that composes a nested single-shot call MUST route through `callModel()` (imported from `../diagnostics/call-model.ts`) or `callWithFallback()` (imported from `../providers/fallback.ts`), which itself imports `callModel()`. Routing never gets its own second chokepoint.

## A.4 `.pi/extensions/providers/fallback.ts` — `callWithFallback` consumption contract

**File:** `.pi/extensions/providers/fallback.ts:1-303`; chain source: `.pi/extensions/providers/schema.ts:320-362`

```typescript
export type CallWithFallbackOptions = Omit<CallModelOptions<Api>, "model">;
export async function callWithFallback(
  ctx: ExtensionContext,
  opts: CallWithFallbackOptions,
): Promise<AssistantMessage>
export function classifyFailure(errorText: string): FailureClass  // "quota"|"transient"|"unavailable"|"fatal"
```

- **`role` is still mandatory** (inherited from `CallModelOptions`, `model` omitted only). Every hop is called with the same `opts` including the same `role`, so all hops of one logical request share one role name in `turns-*.jsonl` and are only distinguishable by `model`/`provider` on each row.
- **`CHAIN` is a module-level `readonly ChainEntry[]` constant** in `providers/schema.ts:359-362` — `[{provider:"deepseek", id:"deepseek-v4-flash"}, {provider:"dashscope", id:"deepseek-v4-flash"}]`. It is **not** a parameter, not read from config, not injected. `callWithFallback` always walks this exact two-hop chain regardless of which role or which "mode" the caller is in. **This means Phase 5's routing does not — and cannot — parametrize the fallback chain by mode ("cheap" vs "max" don't get different fallback chains); `callWithFallback` is orthogonal to mode.** A routing call either goes through `callModel()` directly (single hop, e.g. a role explicitly pinned to a Bedrock Claude model that has no DeepSeek fallback) or through `callWithFallback()` (when the target IS DeepSeek-direct or DashScope and quota/availability fallback is wanted).
- Each hop is a real `callModel()` call (line 267), so `/budget`/wire-dump visibility exists per hop — the chokepoint lint runs over `fallback.ts` itself and it stays clean because it imports `callModel`, never `modelRegistry.complete` (verified: `fallback.ts` does not contain any forbidden pattern — confirmed by reading the full file above; it names `modelRegistry.find` only, which is the sanctioned lookup).
- **Confirmed actual consumption contract for Phase 5's router:** call `callWithFallback(ctx, {role, systemPrompt, messages, tools, api})` exactly like `callModel(ctx, {role, model, ...})` minus supplying `model` — the chain supplies it. This is the correct call for any role whose primary is DeepSeek-direct/DashScope; for a role pinned to Bedrock (e.g. `vision` → a Claude model), call `callModel()` directly since `CHAIN` has no Bedrock hop by design (`schema.ts:340-347`: R1 has no tool calling, non-Claude Bedrock reports no reasoning tokens/no thinking — "a 'cheap Bedrock fallback' is not one").

## A.5 Extension registration patterns this repo actually uses

**Command registration** (`harness/index.ts:69-75`, `diagnostics/index.ts:684-695` via `budget.ts`):
```typescript
pi.registerCommand("ky-hello", {
  description: "...",
  handler: async (_args, ctx) => { ctx.ui.notify("...", "info"); },
});
```
A Phase 5 `/cheap`, `/balanced`, `/max`, `/escalate` command follows this exact shape. **The handler's `ctx` is `ExtensionCommandContext`** (has `waitForIdle()`, `getSystemPromptOptions()`, etc.) — confirmed at type level (`ExtensionCommandContext extends ExtensionContext`, `types.d.ts:254-291`).

**Extension entry-point layout, enforced by `tests/unit/extension-layout.test.ts`:**
- Only `.pi/extensions/<name>.ts` (flat) or `.pi/extensions/<dir>/index.ts` (nested) may carry a `export default function(pi) {...}` — anything else with a default export fails the BOOT-05 gate (`extension-layout.test.ts:56-97, 164-172`).
- A sibling module with **no** default export must sit under `.pi/extensions/<dir>/...` (not at the flat top level) — `extension-layout.test.ts:67, 174-183`.
- **A `routing/` directory can exist without tripping any layout test** as long as it has exactly one `index.ts` entry point with the default export, and every other file in the directory (`modes.ts`, `guard.ts`, `qoder.ts`, whatever split the planner chooses) carries only named exports.

**`settings.json` / `pi.extensions` declaration:** `package.json#pi.extensions` is `["./.pi/extensions"]` (a literal directory, not a glob — `extension-layout.test.ts:197-213` asserts this), so a new `routing/` subdirectory is automatically in scope; **no `package.json` edit is needed** for Phase 5 to add `.pi/extensions/routing/index.ts`.

**BOOT-10 tool-registration boundary rule:** any `pi.registerTool(...)` call anywhere under `.pi/extensions/` is matched by `tests/unit/contributing-boundary.test.ts`'s `TOOL_REGISTRATION` substring scan, and the file must be added to `TOOL_REGISTRATION_ALLOWLIST` (currently `[".pi/extensions/safety/index.ts"]` only, `contributing-boundary.test.ts:113`) **in the same commit**, with the (a)/(b)/(c) justification written beside it. **The Qoder delegate tool is a registered tool** (it must be model-invocable mid-turn — a command cannot be called by the model), so whichever file registers it must be added to this allowlist.

## A.6 `.pi/templates/models-template.json` + `bin/bootstrap.sh` — model ids and settings merge

**Model ids that exist, with fields ROUTE-06/07/08 read:**

| Provider/id | `input` | `reasoning` | `contextWindow` | Source |
|---|---|---|---|---|
| `dashscope/deepseek-v4-flash` | `["text"]` | `true` | `393216` | `.pi/templates/models-template.json:105-151` |
| `dashscope/deepseek-v4-pro` | `["text"]` | `true` | `393216` | `.pi/templates/models-template.json:152-175` |
| `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v4-pro` | `["text"]` | `true` | `1000000` (Pi's built-in catalogue) | Pi built-in `dist/providers/data/deepseek.json` |
| `amazon-bedrock/deepseek.r1-v1:0`, `.../us.deepseek.r1-v1:0` | `["text"]` | `true` | `128000` | Pi built-in catalogue, **verified live** below (§Part B.2) |
| `amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` (example vision-capable Claude) | `["text","image"]` | `true` | `200000` | Pi built-in catalogue, verified live |

**Consequence confirmed for the role→model map:** both DashScope daily-driver models are `input: ["text"]`. There is no text-only-catalogue model in this repository's templates that carries `"image"` in `input`. **The `vision` role in ROUTE-01's map MUST be assigned a Bedrock Claude model id** (verified present in Pi's built-in catalogue, e.g. `anthropic.claude-sonnet-4-5-20250929-v1:0` or any `"input":["text","image"]` entry) or the vision role is unroutable by construction — this is not a hypothetical the guard produces, it is the actual daily-driver configuration.

**`settings.subagents.agentOverrides` write target — NEW FINDING, no existing machinery covers this:**

`bin/bootstrap.sh#merge_settings` (lines 490-527) performs a **key-namespaced merge that writes ONLY `obj.kyPiAgent`** into `$PI_AGENT_DIR/settings.json` (the **global** `~/.pi/agent/settings.json`, resolved via `getAgentDir()`). It does not touch, read, or know about a `subagents` key at all. There is **no** existing Pi extension-context API to write settings.json either — `ExtensionContext`/`ExtensionCommandContext` expose no `ctx.settings` writer (confirmed: no `settings` member anywhere in `dist/core/extensions/types.d.ts`). **Phase 5's mode-switch command must perform its own read-modify-write of a settings.json file**, mirroring `bootstrap.sh`'s pattern (read, parse, refuse on non-object/invalid JSON, replace only `obj.subagents.agentOverrides`, write back) but from inside a TypeScript command handler using `node:fs` + `getAgentDir()` (exported from `@earendil-works/pi-coding-agent`, confirmed: `dist/index.d.ts:2`).

**Which file — a real open question the planner must resolve, not previously surfaced:** two settings.json files exist per Pi's own docs (`docs/settings.md:1-8`): `~/.pi/agent/settings.json` (global) and `.pi/settings.json` (project — **currently tracked in this repo's git index**, present content `{}`, confirmed via `git ls-files .pi/settings.json`). Writing `agentOverrides` into the **project-scoped, git-tracked** `.pi/settings.json` means every `/cheap`/`/balanced`/`/max` switch produces an uncommitted working-tree diff in a public repo (arguably desirable — "visible-in-diff artifacts" is a stated project value per ARCHITECTURE Pattern 6 — but it also means the repo is *dirty* after routine use unless the user commits it, which is unusual for session state). Writing into the **global** `~/.pi/agent/settings.json` (gitignored by construction, outside the repo) keeps the tree clean but is machine-local and invisible to git. **Recorded as an assumption requiring a one-line decision in the plan** (see Assumptions Log A1); either is mechanically identical to implement.

**`compat`/model fields in `models-template.json` are all comment-annotated with source or UNVERIFIED markers** — the file itself states `contextWindow: 393216` is `VERIFIED-with-URL`, `maxTokens: 65536` is `UNVERIFIED — deliberately conservative`, and `cost` is all-zero placeholder pending `RB-03-05`. Phase 5's capability guard should read `contextWindow` (verified) and treat `cost`/`maxTokens` as informational only — they are not capability-blocking fields per ROUTE-06/07/08's own wording.

## A.7 `docs/RUNBOOK.md` + `tests/unit/docs-policy.test.ts` — exact RB-05 entry contract

**Highest existing RB number per phase, and the exact four-part contract:** RB-01-01..03, RB-02-01..03, RB-03-01..05, RB-04-01. The four-part entry contract (from `RB-04-01`'s worked example, `docs/RUNBOOK.md` tail) is: **(1)** exact numbered procedure with copy-pasteable commands, **(2)** "Expected output" naming the precise pass/fail signal, **(3)** "Offline proxy" naming the test file(s) that prove the harness's *classification/parsing* logic without the live credential, **(4)** a `**Status:** OUTSTANDING` line.

**Exact summary-table row format** (must appear verbatim, parsed by `tableStatus()` in `docs-policy.test.ts:150-161`):
```
| RB-05-01 | <short description> | OUTSTANDING |
```

**Exact detail-section format** (parsed by `sectionStatus()`, `docs-policy.test.ts:164-179` — heading must literally contain the id, and a `**Status:**` line must follow inside that section before the next `##`-`######` heading):
```
### RB-05-01 — <short description>

**Status:** OUTSTANDING

**Why this cannot be done here.** ...

**Procedure, on the work laptop.** ...
1. ...
2. ...

**Expected output.** ...

**Offline proxy:** `tests/...` — ...
```

**What `docs-policy.test.ts` requires that ANY appended Phase 5 entry must satisfy, verified from the test file itself:**
1. `PHASE_FIVE_IDS` (a new array, following the `PHASE_ONE_IDS`..`PHASE_FOUR_IDS` pattern at `docs-policy.test.ts:56-93`) must be added and spread into `ALL_IDS` (line 96) — **this is a required code change in `tests/unit/docs-policy.test.ts` itself**, in the same commit as the RUNBOOK append, per the file's own "THE GUARD SPANS THREE PHASES" docstring (lines 27-38) and the "governs every entry" test (lines 430-459) which fails the build if a declared id has no owning phase array.
2. `ENTRY_COMMANDS["RB-05-01"]` (or whatever id is chosen) must be added with the exact command string(s) the entry names, matched via `.toContain()` (line 401-409) — pin the **whole** command line per the RB-02-03/RB-03/RB-04 lesson recorded in the test's own comments (fragment pins caused false-green in Phase 2; whole-line pins are the current discipline).
3. The row's Status cell must literally contain `OUTSTANDING` (line 396-399) and the section's `**Status:**` line must match it exactly, or the guard reports `INCONSISTENT` and fails (this is Group C's live check, `docs-policy.test.ts:727-751`).
4. **The offline-proxy test path named in prose must exist on disk** (`docs-policy.test.ts:412-428`) — whatever test file Phase 5 writes as ROUTE-11's offline proxy (a `tests/helpers/loopback.ts`-based fixture serving a canned Cloud Agents session + SSE stream, per the objective's framing) must be created and referenced by its real repo-relative path in the runbook prose, matched by `PROXY_PATH_RE = /tests\/[A-Za-z0-9._\-/]+\.test\.ts/g`.

**Recommended id:** `RB-05-01` (ROUTE-11 is the only `[RUNBOOK]` requirement in Phase 5, per `05-CONTEXT.md`'s own statement "Contains [RUNBOOK] requirements: ROUTE-11 only").

## A.8 `tests/helpers/` inventory — what each makes easy for Phase 5's tests

| Helper | Exported functions | What it makes easy for Phase 5 |
|---|---|---|
| `faux.ts` | `wrapFauxWithPayload(faux, buildPayload?)`, `wrapFauxWithStatus(faux\|Provider, status)`, `buildOpenAiFixturePayload`, `buildBedrockFixturePayload`, `SECRET_FIXTURE_TOKEN`, `withSecretHeader` | **Yes, `fauxProvider` CAN assert on the outgoing request** — `wrapFauxWithPayload` emits `onPayload(buildPayload(model, context, options), model)` before delegating, so a test registers a faux provider under a chosen provider id (`opts.providerId` in `session.ts`), scripts its response, and inspects the captured payload's `model` field (or the `TurnRow.model`/`provider` on the resulting `turns-*.jsonl` row) to prove which model actually received the request — this is the exact mechanism ROUTE-10 needs, with no live credential |
| `session.ts` | `createFauxSession(opts)`, `withFauxSession(opts, fn)`, `writeUserScopeShim(agentDir, name, targetAbsPath)` | Builds a real `createAgentSession` in a temp dir, temp agent dir, faux model registered, **extension under test loaded at USER SCOPE** (mandatory — project-scoped `.pi/extensions` requires trust, which resolves `false` headless). A Phase 5 test for `/cheap`/`/escalate`/mode persistence drives this, invokes the registered command via the session's command dispatch, and inspects `handle.cwd`'s `.pi/logs/*.jsonl` afterwards |
| `models.ts` | `withModelsConfig(opts, fn)` | Offline model registry over a real `models.json`/`auth.json` pair (or the shipped template), returning the **composed** `Model<Api>` object — the honest oracle for capability-guard unit tests: `handle.requireModel("dashscope","deepseek-v4-flash").input` is genuinely `["text"]` as Pi composed it, not merely as the template file states it |
| `pi.ts` | `runPi(args, opts)`-shaped subprocess wrapper (via `commandFor`), `requirePiOnPath()` | End-to-end `pi --mode json` assertions if the plan needs one (e.g. proving the routing extension loads and registers its commands) — mirrors the pattern other phases used for BOOT-02/05 |
| `logs.ts` | `withTempLogCwd`, `logFilesIn`, `readJsonl` (throws), `readTornSafe` (never throws) | Reading back `wire-*.jsonl`/`turns-*.jsonl` for ROUTE-10 assertions |
| `loopback.ts` | `withLoopbackCompletions(opts, fn)`, `assertLoopbackUrl(url)` | Built for DashScope's OpenAI-completions shape (`node:http` on `127.0.0.1`, real Pi adapter talks to it, zero dependencies). **This is the direct template for ROUTE-11's offline proxy**: stand a loopback HTTP+SSE server, point the Qoder delegate tool's `baseUrl` at it via an env var seam, and assert the tool (a) sends the right `Authorization` header and JSON body, (b) parses the SSE envelope correctly, (c) folds the final result back as tool content. The existing helper is completions-shaped (OpenAI SSE chunks) and not identical to Qoder's envelope (see Part C) — Phase 5 needs a **new**, small loopback-style helper (or a `respond` override on this one) shaped for Qoder's `event: event_start`/`event_delta`/`session.status_idle` SSE stream, not a reuse of `defaultSseBody` as-is |

---

# Part B — Capability Blocks Verified at Source (Pi 0.84.1)

All four claims below were re-verified directly against the installed package at `C:\Users\Admin\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\node_modules\@earendil-works\pi-ai\dist\` on 2026-08-14 (this machine's actual installed pi-ai copy, nested under pi-coding-agent's own `node_modules`).

## B.1 Bedrock non-Claude + thinking — `buildAdditionalModelRequestFields` returns `undefined`

**File:** `pi-ai/dist/api/bedrock-converse-stream.js:889-927`

```javascript
function buildAdditionalModelRequestFields(model, options) {
    if (!options.reasoning || !model.reasoning) {
        return undefined;                              // (1) no thinking requested, or model.reasoning:false
    }
    if (isAnthropicClaudeModel(model)) {
        // ... builds { thinking: {...} } or { thinking:{type:"adaptive"}, output_config:{...} }
        return result;
    }
    return undefined;                                  // (2) THE BLOCK: non-Claude Bedrock, reasoning requested
}
```

**Exact predicate the guard should key on** — `isAnthropicClaudeModel(model)` at `bedrock-converse-stream.js:542-550`:
```javascript
function isAnthropicClaudeModel(model) {
    const id = model.id.toLowerCase();
    const name = model.name?.toLowerCase() ?? "";
    return (id.includes("anthropic.claude") || id.includes("anthropic/claude") ||
            name.includes("anthropic.claude") || name.includes("anthropic/claude") ||
            name.includes("claude"));
}
```

**Verified: the UI still offers a thinking level for a non-Claude Bedrock model.** The catalogue entry for `deepseek.r1-v1:0` (and every other Bedrock model with `reasoning:true`) genuinely carries `"reasoning": true` (confirmed live, §B.2 table below) — Pi's thinking-level picker/`setThinkingLevel` gates on `model.reasoning`, not on `isAnthropicClaudeModel`, so the picker offers a level, the request is built with `options.reasoning` set, and `buildAdditionalModelRequestFields` silently drops it at line 926-927. **The guard's own predicate should therefore be: `provider === "amazon-bedrock" && model.reasoning === true && !isAnthropicClaudeModel(model) && requestedThinkingLevel !== "off"` → block.** Since `isAnthropicClaudeModel` is not exported from pi-ai's public API (confirmed: not in `dist/index.d.ts`'s export list — only `Model`, `Api`, etc. are), the guard must **re-implement the same string-matching rule** (`id`/`name` containing `anthropic.claude`/`anthropic/claude`/`claude`) rather than import it — recorded as a residual coupling: if Pi changes this predicate upstream, the guard's copy will silently diverge. This is analogous to the `QUOTA_PATTERN`/`UNAVAILABLE_PATTERN` situation in `providers/schema.ts`, where Phase 3 already accepted "borrowed, not imported" patterns for the identical reason (no export exists).

## B.2 Bedrock DeepSeek R1 — catalogue carries NO tool-calling-support field at all

**Verified live**, `node -e` against the installed `pi-ai/dist/providers/data/amazon-bedrock.json`:

```json
{
 "id": "deepseek.r1-v1:0",  "name": "DeepSeek-R1",
 "reasoning": true, "input": ["text"],
 "cost": {"input":1.35,"output":5.4,"cacheRead":0,"cacheWrite":0},
 "contextWindow": 128000, "maxTokens": 32768
}
```
(and an identical shape for `us.deepseek.r1-v1:0`; `deepseek.v3-v1:0` and `deepseek.v3.2` carry a `compat:{"supportsStrictMode":true}` block but R1 does not).

**`Model<TApi>` interface, in full** (`pi-ai/dist/types.d.ts:661-682`):
```typescript
export interface Model<TApi extends Api> {
    id: string; name: string; api: TApi; provider: ProviderId; baseUrl: string;
    reasoning: boolean;
    thinkingLevelMap?: ThinkingLevelMap;
    input: ("text" | "image")[];
    cost: ModelCost;
    contextWindow: number; maxTokens: number;
    samplingParams?: Record<string, unknown>;
    headers?: Record<string, string>;
    compat?: /* provider-specific compat unions */;
}
```

**NEW FINDING, stated plainly as the objective requires: there is no field anywhere on `Model<TApi>` expressing tool-calling support.** No `supportsTools`, `toolCalling`, `functionCalling`, or similar. `compat` (OpenAI/Anthropic/Bedrock-specific) carries fields like `supportsStrictMode`, but nothing that generalizes to "this model rejects tool definitions outright." **This changes how ROUTE-08 must be written: it cannot be a predicate over catalogue fields at all — it must be an explicit model-id deny-list** (e.g. `const NO_TOOL_CALLING_BEDROCK_MODELS = ["deepseek.r1-v1:0", "us.deepseek.r1-v1:0"]`, matched case-insensitively against `model.id`), checked specifically when the target role is the **executor** (ROUTE-08's own wording: "Bedrock DeepSeek R1 as executor... it supports no tool calling at all" — the block is role-scoped, not universal; R1 could in principle still serve a tool-less single-shot role like `summariser` without tripping this specific rule, though `05-CONTEXT.md`'s decision 4 frames it as a general "capability guard" block. The plan should state explicitly whether the R1 deny-list applies only to executor/subagent-role assignment or to every role, since the underlying defect — no tool calling — only matters for roles that call tools).

**This finding is independently corroborated** by the fact that Pi's tool-calling request construction (`convertTools`, `openai-completions.ts:1337-1372` per CLAUDE.md's own citation, and the Bedrock equivalent `toolConfig` block in `bedrock-converse-stream.js`) is unconditional on any catalogue flag — Pi will happily *send* `toolConfig` to R1, and the provider itself is what rejects it. There is no client-side signal Pi's own code reads to pre-empt this; the harness's deny-list is doing work Pi's catalogue schema has no room for.

## B.3 `Model.input` / `Model.contextWindow` accessor path

**`ModelRegistry` public surface** (`pi/dist/core/model-registry.d.ts:20-44`):
```typescript
export declare class ModelRegistry {
    getAll(): Model<Api>[];
    getAvailable(): Model<Api>[];
    find(provider: string, modelId: string): Model<Api> | undefined;
    hasConfiguredAuth(model: Model<Api>): boolean;                 // SYNCHRONOUS
    getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth>;
    getProviderAuthStatus(provider: string): AuthStatus;
    getProviderAuth(provider: string): Promise<AuthResult | undefined>;
    // complete/getProvider/getRegisteredNativeProvider/etc. — chokepoint-lint forbidden outside diagnostics/
}
```

Both **catalogue models** (Pi built-ins, e.g. Bedrock, DeepSeek-direct) and **`models.json`-defined models** (DashScope) resolve through the identical `ModelRegistry` facade — there is no separate accessor per source. `ctx.modelRegistry.find("dashscope", "deepseek-v4-flash").input` and `ctx.modelRegistry.find("amazon-bedrock", "deepseek.r1-v1:0").input` both return the real, composed `("text"|"image")[]` array; confirmed identical shape via `tests/helpers/models.ts#withModelsConfig` (Phase 3's own test helper does exactly this for the DashScope entries, and Pi's built-in Bedrock/DeepSeek entries are loaded the same way at session start).

**`ctx.scopedModels`** — read-only `readonly ScopedModel[]` on `ExtensionContext` (`types.d.ts:224-228`), doc comment: "resolved from `--models`/`enabledModels` settings against the available catalogue... Empty when no scoping is configured (all available models are usable)." **This is the correct source for "which models may this session use"** — confirmed exactly matching CLAUDE.md's own guidance; `getAvailable()` returns every model Pi knows about regardless of scoping, which is the wrong list for a guard that should respect a user's `--models` restriction.

## B.4 `pi.setModel()` — exact signature, failure modes, and the persistence side-effect

**Extension-facing wrapper, exact source** (`pi/dist/core/agent-session.js:1885-1890`):
```javascript
setModel: async (model) => {
    if (!this._modelRuntime.hasConfiguredAuth(model.provider))
        return false;                                    // clean, non-throwing failure
    await this.setModel(model);                           // the inner method, below
    return true;
},
```

**Inner method it calls** (`agent-session.js:1197-1209`):
```javascript
async setModel(model) {
    if (!(await this._modelRuntime.checkAuth(model.provider))) {
        throw new Error(`No API key for ${model.provider}/${model.id}`);
    }
    const previousModel = this.model;
    const thinkingLevel = this._getThinkingLevelForModelSwitch();
    this.agent.state.model = model;
    this.sessionManager.appendModelChange(model.provider, model.id);   // <- persistence, see below
    this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
    this.setThinkingLevel(thinkingLevel);
    await this._emitModelSelect(model, previousModel, "set");
}
```

**Exact contract for the planner:** `pi.setModel(model): Promise<boolean>`. It returns `false` cleanly (no throw) when `hasConfiguredAuth(model.provider)` fails the **synchronous, pre-check** at the wrapper level — this is the common, expected "no API key configured" case and confirms `05-CONTEXT.md` decision 9 exactly. The inner method's own `throw new Error("No API key for...")` is reachable **only** in a narrow TOCTOU window (auth revoked between the wrapper's check and the inner call, in the same synchronous-ish tick) — practically unreachable via the extension API, but the plan should still wrap the `pi.setModel()` call in a `try/catch` defensively since the type signature does not rule out a throw and `checkAuth`/`hasConfiguredAuth` are not guaranteed atomic with respect to each other. **`ctx.modelRegistry.hasConfiguredAuth(model)` (synchronous, confirmed `model-registry.js:27-28`: `hasConfiguredAuth(model) { return this.runtime.hasConfiguredAuth(model.provider); }`) is the correct pre-flight "would `setModel` return false?" check** — cheaper than `getProviderAuth` (async) for a simple boolean gate, though `getProviderAuth` remains useful if the guard wants to surface *why* (missing key vs missing env var) in its refusal message.

**NEW FINDING — mode persistence is largely already solved by Pi itself.** `AgentSession#setModel` calls `this.sessionManager.appendModelChange(model.provider, model.id)` **on every successful `pi.setModel()` call** (line 1204), which writes a native session entry:

```typescript
// pi/dist/core/session-manager.d.ts:29-33
export interface ModelChangeEntry extends SessionEntryBase {
    type: "model_change";
    provider: string;
    modelId: string;
}
```
```javascript
// pi/dist/core/session-manager.js:790-801
appendModelChange(provider, modelId) {
    const entry = { type: "model_change", id: generateId(this.byId),
                     parentId: this.leafId, timestamp: new Date().toISOString(), provider, modelId };
    this._appendEntry(entry);
    return entry.id;
}
```

**And it is read back automatically on resume.** `buildSessionContext()` calls `getSessionContextSettings(path)`, which walks the branch and derives the effective model from the **last** `model_change` entry it finds (or the last assistant message's own `provider`/`model`, whichever occurs later in path order — i.e. the model an actual completed turn used also counts):
```javascript
// pi/dist/core/session-manager.js:146-161
function getSessionContextSettings(path) {
    let thinkingLevel = "off", model = null;
    for (const entry of path) {
        if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
        else if (entry.type === "model_change") model = { provider: entry.provider, modelId: entry.modelId };
        else if (entry.type === "message" && entry.message.role === "assistant")
            model = { provider: entry.message.provider, modelId: entry.message.model };
    }
    return { thinkingLevel, model };
}
// pi/dist/core/session-manager.js:232-236
export function buildSessionContext(entries, leafId, byId) {
    const path = buildSessionPath(entries, leafId, byId);
    const { thinkingLevel, model } = getSessionContextSettings(path);
    ...
    return { messages, thinkingLevel, model };
}
```

**Consequence for ROUTE-09:** the *executor model itself* survives a restart with **zero Phase 5 code**, because `pi.setModel()` already wrote the durable entry and Pi's own session-resume path already reads it back into `agent.state.model`/`this.model`. What ROUTE-09's `pi.appendEntry("ky:mode", …)` needs to carry is narrower: the **mode name** (`"cheap"`/`"balanced"`/`"max"`) for redisplay/statusline purposes (the `model_change` entry does not carry a mode *label*, only a raw provider/model id — reconstructing "was this cheap or balanced?" from a model id alone is lossy if two modes ever share an executor model), and the **`/escalate` sticky flag + which mode it escalated from** (so `/escalate off` knows what to restore to — again not something Pi's native entries encode). The restore-on-`session_start` recipe is therefore: on `session_start`, call `ctx.sessionManager.getBranch()`, filter for `entry.type === "custom" && entry.customType === "ky:mode"`, take the **last** matching entry in the branch (branch is root-to-leaf ordered per `getBranch`'s own doc comment "Walk from entry to root... returned in path order" — confirmed the same walk-then-reverse shape as `buildSessionPath`, `session-manager.js:137-144`), and restore only the mode-name/escalation bookkeeping — never re-derive or re-apply the executor model itself, which Pi has already restored by the time `session_start` fires.

## B.5 `pi.appendEntry` — exact signature and restore recipe

**Signature** (`types.d.ts:936`, on `ExtensionAPI`, i.e. `pi.appendEntry`, not `ctx.appendEntry`):
```typescript
appendEntry<T = unknown>(customType: string, data?: T): void;
```

**`CustomEntry` shape it writes** (`session-manager.d.ts:69-73`):
```typescript
export interface CustomEntry<T = unknown> extends SessionEntryBase {
    type: "custom";
    customType: string;
    data?: T;
}
// SessionEntryBase: { type: string; id: string; parentId: string | null; timestamp: string }
```

**Namespacing rule:** no enforced namespace syntax exists in Pi itself — `customType` is a free string. The convention `ky:mode` (colon-separated, project-prefixed) is this repository's own choice (matches `05-CONTEXT.md` decision 3's wording), not a Pi requirement; any other extension picking the identical `customType` string would collide in the branch walk with no error from Pi.

**Confirmed: does NOT participate in LLM context** — doc comment directly on the interface: *"Purpose: Persist extension state across session reloads... Does NOT participate in LLM context (ignored by buildSessionContext)."* (`session-manager.d.ts:57-68`). This is a direct, in-source citation superseding the `docs/extensions.md:1442` prose citation `05-CONTEXT.md` used — both say the same thing; the `.d.ts` doc comment is the more precise source.

**Restore-on-`session_start` recipe:**
```typescript
pi.on("session_start", (_event, ctx) => {
  const branch = ctx.sessionManager.getBranch();               // root-to-leaf order
  const modeEntries = branch.filter(
    (e): e is CustomEntry<KyModeData> => e.type === "custom" && e.customType === "ky:mode",
  );
  const latest = modeEntries.at(-1);                            // last write wins
  if (latest?.data) { /* restore mode name + escalation flag into module state */ }
});
```
`getBranch(fromId?)` — `session-manager.d.ts:261`, "Walk from entry to root, returning all entries in path order. Includes all entry types." Confirmed to return the full mixed-type array (messages, model_change, custom, etc.) — the filter above is mandatory since `getBranch()` is not type-narrowed by Pi itself.

---

# Part C — ROUTE-11: Qoder Delegate Tool HTTP Shape

The v1/v2 tension is already resolved (`05-CONTEXT.md` decision 11) and is **not re-litigated here**. This section gives only the minimum HTTP shape the delegate tool needs, fetched live from `docs.qoder.com` on 2026-08-14.

## C.1 Auth

**Header:** `Authorization: Bearer pt-<token>` — literal `Bearer ` prefix, token itself begins `pt-`.
**Env var:** `QODER_PERSONAL_ACCESS_TOKEN` (per `05-CONTEXT.md` decision 11 and STACK.md §5, both already established; not re-verified here beyond confirming the header shape live).
**Base URL:** `https://api.qoder.com/api/v1/` (Cloud Agents endpoints live under `.../cloud/`).

[CITED: docs.qoder.com/cloud-agents/api/conventions/authentication — fetched 2026-08-14]

## C.2 Endpoint sequence to delegate one task and fold the result back

A pre-configured `agent_id` and `environment_id` are assumed inputs (see C.4 — agent/environment creation is a one-time console/API setup, not a per-task call), supplied to the delegate tool via env vars (e.g. `QODER_AGENT_ID`, `QODER_ENVIRONMENT_ID`) or tool parameters.

| Step | Method + Path | Body | Response |
|---|---|---|---|
| 1. Create session | `POST /api/v1/cloud/sessions` | `{"agent":{"id":"<agent_id>","type":"agent"},"environment_id":"<env_id>","title":"..."}` | `{"id":"sess_...","type":"session","status":"idle","agent":{...},"environment_id":"...","created_at":"..."}` |
| 2. Send the task | `POST /api/v1/cloud/sessions/{session_id}/events` | `{"events":[{"type":"user.message","content":[{"type":"text","text":"<the delegated task>"}]}]}` | 2xx ack (event queued) |
| 3. Stream results | `GET /api/v1/cloud/sessions/{session_id}/events/stream` | — | SSE stream, see C.3. Supports `Last-Event-ID` header for reconnection |

Every request carries `Authorization: Bearer $QODER_PERSONAL_ACCESS_TOKEN` and `Content-Type: application/json` on the POSTs.

[CITED: docs.qoder.com/cloud-agents/api/sessions/create.md, .../send-event.md, .../stream-events.md — fetched 2026-08-14]

## C.3 SSE event envelope

Each SSE frame carries three lines: `id:` (event id), `event:` (event type name), `data:` (JSON payload). Observed/documented event types and shapes:

```
id: evt_00jjujk9fbnr55q5rtyp
event: event_start
data: {"event":{"id":"evt_00jjujk9fbnr55q5rtyp","type":"agent.thinking"},"type":"event_start"}

id: evt_00jjujk9fbnr4wkj2gh8
event: event_start
data: {"event":{"id":"evt_00jjujk9fbnr4wkj2gh8","type":"agent.message"},"type":"event_start"}

id: evt_00jjujk9fbnr4wkj2gh8
event: event_delta
data: {"delta":{"content":{"text":"Hello","type":"text"},"index":0,"type":"content_delta"},"event_id":"evt_00jjujk9fbnr4wkj2gh8","type":"event_delta"}

id: evt_b2c3d4e5f6a7b8c9
event: session.status_idle
data: {"id":"evt_b2c3d4e5f6a7b8c9","type":"session.status_idle","stop_reason":{"type":"end_turn"},"processed_at":"2026-05-18T03:40:50.987654321Z"}
```

**Parsing recipe the delegate tool needs:** accumulate `event_delta` frames whose parent `event_start` was `type:"agent.message"`, concatenating `delta.content.text` for `delta.type==="content_delta"`, until a `session.status_idle` frame with `stop_reason.type==="end_turn"` arrives — that is the completion signal to fold the accumulated text back as the tool's result. `agent.thinking` events should be ignored for the tool result (or optionally surfaced as tool-call progress via `onUpdate`, which `pi.registerTool`'s `execute(toolCallId, params, signal, onUpdate, ctx)` signature already supports — confirmed shape at `.pi/extensions/safety/index.ts:391-424`, same five-argument tool `execute` shape this repo already uses).

[CITED: docs.qoder.com/cloud-agents/api/sessions/stream-events.md — fetched 2026-08-14]

## C.4 What is UNVERIFIED, and why the live check is OUTSTANDING by construction

- **The exact `agent.thinking`/`agent.message`/other event `type` enum is not exhaustively documented** on the page fetched — only three examples were shown (`agent.thinking`, `agent.message`, `session.status_idle`). Other event types (tool-use-by-Qoder's-own-agent, errors, additional status transitions) are plausible and UNVERIFIED. The delegate tool's SSE parser must **fail safely on an unrecognized event type** (skip/ignore, never throw) rather than assume the three-type enum above is complete.
- **Whether a real PAT + real `agent_id`/`environment_id` actually produce this exact envelope end-to-end** is UNVERIFIED — there is no PAT and no network egress on this machine (`05-CONTEXT.md`'s own framing). This is precisely why ROUTE-11 is a `[RUNBOOK]` requirement: the live check (`RB-05-01`) settles it, and per the Standing Operating Policy this must be recorded as **OUTSTANDING**, never passing, until the user runs it on the work laptop with a real PAT.
- **Agent/environment creation is confirmed to be a one-time setup action** ("typically done once via API/console rather than per-task... reusable, versioned"), so the delegate tool should **not** call `POST /api/v1/cloud/agents` or `POST /api/v1/cloud/environments` per invocation — it should require `QODER_AGENT_ID`/`QODER_ENVIRONMENT_ID` (or equivalent) to already be configured and fail with an actionable message naming the Qoder console/API step if they are unset, mirroring the harness's existing "actionable message, never a silent guess" pattern (PROV-05's AWS SSO message is the direct precedent to copy).
[CITED: docs.qoder.com/cloud-agents/api/agents/create.md — fetched 2026-08-14]

## C.5 The one-paragraph bypass statement (for the planner to lift into user-facing docs)

> **The Qoder delegate tool is a foreign agent, not a Pi tool call.** When the executor delegates a task to Qoder, that task runs inside Qoder's own hosted agent loop, with Qoder's own `Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash` tools, against a container environment this harness does not control. None of the following apply to work Qoder does on the harness's behalf: Pi's own tools, `AGENTS.md` and the system prompt this harness has spent four phases shaping, the Phase 4 safety guard (`HEAD==main` write blocks, `terraform apply` confirmation, `.env`/`*.tfstate` read blocks, the audit JSONL), and the Phase 2 wire inspector (no request/response of Qoder's own model calls is ever captured by this repository's diagnostics). On a laptop where merging to `main` auto-deploys to AWS, delegating a task to Qoder means trusting Qoder's own agent loop with whatever repository access its environment is configured with, outside every control this harness builds. Use it only for tasks where that trust boundary is acceptable, and treat its result the same way you would treat a pull request from an unfamiliar contributor — reviewed, never merged on the strength of "an agent said so."

---

## Standard Stack

Phase 5 installs **zero new packages**. Every mechanism used is either a Pi 0.84.1 extension API call, this repository's own Phase 2-4 exports, or Node's built-in `fetch`/`node:http`.

### Core (no new dependencies)
| Capability | Source | Why no new package |
|---|---|---|
| Model selection | `pi.setModel()`, `ctx.modelRegistry.*` — Pi 0.84.1 built-in | Verified at source, §Part B |
| Nested single-shot calls | `.pi/extensions/diagnostics/call-model.ts#callModel`, `providers/fallback.ts#callWithFallback` | Already built, Phase 2/3 |
| HTTP client for Qoder | Node's global `fetch` (stable since Node 18, unconditionally available on the project's `engines.node: ">=22.19.0"` floor) | Zero new dependency; matches `tests/helpers/loopback.ts`'s stated "zero dependencies: `node:http` only" discipline for test code, and this repo's `package.json` `dependencies` currently holds exactly one entry (`unbash`) |
| SSE parsing | Hand-rolled line parser over `fetch`'s `ReadableStream` body (no `eventsource` package) | `tests/unit/pinning.test.ts` asserts `devDependencies` equals exactly six audited pins; adding any package requires the full Package Legitimacy Gate and is avoidable here — Qoder's SSE format is `id:`/`event:`/`data:` lines separated by blank lines, trivial to parse without a library |

### Package Legitimacy Audit

**Not applicable.** This phase installs no external packages. `package.json`'s `dependencies` (`unbash@4.0.10`, already audited in Phase 4) and `devDependencies` (six entries, already audited in Phase 1) are unchanged by this phase. If the planner later decides a dedicated SSE-parsing package is worth the schema/maintenance cost over the hand-rolled parser above, the Package Legitimacy Gate must run at that time — not assumed clean now.

---

## Architecture Patterns

### Recommended Project Structure (routing/, Claude's discretion on exact split — one reasonable shape)
```
.pi/extensions/routing/
├── index.ts        # entry point: registers /cheap, /balanced, /max, /escalate commands,
│                    #   session_start restore hook, and (if colocated) the Qoder tool
├── modes.ts         # named exports: MODES table, role→model resolution, mode state
├── guard.ts         # named exports: pure capability-guard predicates over Model<Api>
└── qoder.ts         # named exports: the Qoder HTTP client + SSE parser (or its own
                      #   `.pi/extensions/qoder/index.ts` directory if the planner wants
                      #   the foreign-agent tool physically separated from the role→model
                      #   map, reinforcing decision 11's "never in the routing table")
```
Both `modes.ts`/`guard.ts`/`qoder.ts` carry **no default export** (named exports only), satisfying `extension-layout.test.ts`'s module-vs-entry-point partition without any special-casing.

### Pattern: Capability guard as a pure predicate, evaluated before dispatch

```typescript
// routing/guard.ts — illustrative shape, not prescriptive of file boundaries
import type { Api, Model } from "@earendil-works/pi-ai";

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

const NO_TOOL_CALLING_MODEL_IDS = ["deepseek.r1-v1:0", "us.deepseek.r1-v1:0"];

// isAnthropicClaudeModel re-implemented — not importable, see Part B.1
function isAnthropicClaudeModel(model: Model<Api>): boolean {
  const id = model.id.toLowerCase();
  const name = (model.name ?? "").toLowerCase();
  return id.includes("anthropic.claude") || id.includes("anthropic/claude") ||
         name.includes("anthropic.claude") || name.includes("anthropic/claude") ||
         name.includes("claude");
}

export function guardRoute(
  model: Model<Api>,
  role: string,
  need: { image?: boolean; estimatedInputTokens?: number; thinkingRequested?: boolean },
): GuardVerdict {
  if (need.image && !model.input.includes("image")) {
    return { ok: false, reason: `${model.provider}/${model.id} is text-only (input=${JSON.stringify(model.input)}); the ${role} role needs image input` };
  }
  if (need.estimatedInputTokens !== undefined && need.estimatedInputTokens > model.contextWindow) {
    return { ok: false, reason: `${model.provider}/${model.id} has a ${model.contextWindow}-token window; the request needs ~${need.estimatedInputTokens}` };
  }
  if (model.provider === "amazon-bedrock" && model.reasoning && !isAnthropicClaudeModel(model) && need.thinkingRequested) {
    return { ok: false, reason: `${model.provider}/${model.id} silently drops thinking configuration on non-Claude Bedrock models (buildAdditionalModelRequestFields returns undefined)` };
  }
  if (role === "executor" && NO_TOOL_CALLING_MODEL_IDS.some((id) => model.id.toLowerCase().includes(id))) {
    return { ok: false, reason: `${model.provider}/${model.id} supports no tool calling at all; cannot serve as executor` };
  }
  return { ok: true };
}
```

### Pattern: pre-flight auth check before `setModel`, sanctioned by chokepoint-lint

```typescript
// routing/index.ts command handler, illustrative
pi.registerCommand("balanced", {
  description: "Switch the role->model map to balanced",
  handler: async (_args, ctx) => {
    await ctx.waitForIdle();
    const target = ctx.modelRegistry.find("dashscope", "deepseek-v4-pro");  // sanctioned lookup, not banned by chokepoint-lint
    if (!target) { ctx.ui.notify("balanced mode's executor model is not configured", "error"); return; }
    const guard = guardRoute(target, "executor", {});
    if (!guard.ok) { ctx.ui.notify(guard.reason, "error"); return; }
    if (!ctx.modelRegistry.hasConfiguredAuth(target)) {                     // sanctioned, synchronous pre-flight
      ctx.ui.notify(`No API key configured for ${target.provider}/${target.id}`, "error");
      return;
    }
    let switched: boolean;
    try { switched = await pi.setModel(target); }
    catch (err) { ctx.ui.notify(`setModel threw: ${String(err)}`, "error"); return; }
    if (!switched) { ctx.ui.notify(`setModel returned false for ${target.provider}/${target.id}`, "error"); return; }
    pi.appendEntry("ky:mode", { mode: "balanced", at: Date.now() });        // narrow: mode name only, see Part B.4
  },
});
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Nested single-shot model calls | A second call site to `ctx.modelRegistry.complete()` | `callModel()` (Phase 2) or `callWithFallback()` (Phase 3) | `chokepoint-lint.test.ts` fails the build; wire visibility is lost otherwise |
| Provider failover on quota/outage | A second fallback chain inside routing | `callWithFallback()` (Phase 3) | `providers/fallback.ts` already implements the exact three-class taxonomy and chain; routing is explicitly documented as its consumer |
| Executor model restore-on-restart | A custom session-entry replay of `provider`/`model` | Nothing — Pi's own `model_change` entry + `getSessionContextSettings()` already do this | Verified at source, §Part B.4; building a second mechanism risks disagreeing with Pi's own resume logic |
| Settings.json parsing/merge | A hand-rolled JSON.parse with no validation | `bootstrap.sh#merge_settings`'s pattern (read, validate is-object, replace only the owned key, write back) | The existing pattern already handles the "refuse to touch invalid/non-object JSON" failure mode Phase 5's own write needs too |
| SSE line parsing for Qoder | An `eventsource`/similar npm package | A ~20-line hand-rolled parser over `fetch`'s stream body | Zero new dependency, avoids the Package Legitimacy Gate, and the envelope (`id:`/`event:`/`data:`, blank-line-terminated) is trivial |

## Common Pitfalls

### Pitfall 1: Filtering wire/turns rows by `role === "executor"`
**What goes wrong:** ROUTE-10 assertions for the executor path find nothing.
**Why it happens:** main-loop `turns-*.jsonl` rows always carry `role: "session"` (the `SESSION_TURN_ROLE` constant), never `"executor"` — only `callModel()`'s nested rows carry a caller-supplied role.
**How to avoid:** prove the executor path by `TurnRow.model`/`provider` on the **next `kind:"turn"` row after the mode switch**, not by filtering on role.
**Warning signs:** a ROUTE-02/03 test that passes by finding zero matching rows (a vacuous pass) rather than finding the expected one.

### Pitfall 2: Assuming `isAnthropicClaudeModel` is importable
**What goes wrong:** a `from "@earendil-works/pi-ai"` import of this predicate fails to compile — it is not exported.
**Why it happens:** the function is internal to `bedrock-converse-stream.js` and absent from `dist/index.d.ts`.
**How to avoid:** re-implement the identical string-matching rule locally (shown in the Architecture Patterns section above), and note the coupling risk in a comment so a future Pi upgrade that changes this predicate is a known, searchable risk rather than a silent divergence.

### Pitfall 3: Writing `agentOverrides` into the wrong settings.json, or assuming a Pi API exists to write it
**What goes wrong:** either the write silently goes nowhere (no `ctx.settings` API exists) or it lands in the wrong scope (global vs project) from what the plan assumed.
**Why it happens:** `bin/bootstrap.sh#merge_settings` only ever writes the `kyPiAgent` key; nothing in this repository or in Pi's extension API currently writes `subagents.agentOverrides`.
**How to avoid:** the plan must explicitly choose global (`getAgentDir()/settings.json`) vs project (`.pi/settings.json`, git-tracked) and write a dedicated, key-namespaced read-modify-write helper — see Assumptions Log A1.

### Pitfall 4: Treating the Qoder SSE event-type list as exhaustive
**What goes wrong:** a parser that only recognizes `agent.thinking`/`agent.message`/`session.status_idle` throws or hangs on an undocumented event type once a real PAT is used.
**Why it happens:** the fetched docs page showed only three example event types; the full enum was not published anywhere reachable in this research session.
**How to avoid:** parse defensively — unknown `event:`/`data.type` values are ignored, not fatal, and the loop only terminates on an explicit `session.status_idle` (or a connection close/timeout, handled separately).

## Code Examples

### Verified: `pi.setModel()` contract (composited from the two source excerpts above)
```javascript
// pi 0.84.1 dist/core/agent-session.js:1885-1890 + :1197-1209
setModel: async (model) => {
    if (!this._modelRuntime.hasConfiguredAuth(model.provider)) return false;
    await this.setModel(model);   // can throw "No API key for X" only in a TOCTOU race
    return true;
}
```

### Verified: capability-blocking function, Bedrock non-Claude thinking
```javascript
// pi-ai 0.84.1 dist/api/bedrock-converse-stream.js:889-927 (excerpted above in full, Part B.1)
function buildAdditionalModelRequestFields(model, options) {
    if (!options.reasoning || !model.reasoning) return undefined;
    if (isAnthropicClaudeModel(model)) { /* builds thinking config */ return result; }
    return undefined;   // <- the silent drop ROUTE-07 must pre-empt
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| (n/a — no prior version of this harness's routing existed) | Three-tier routing (`setModel`/`callModel`/subagents), decided in `05-CONTEXT.md` decision 1 | This phase | Not applicable — greenfield within this project |

**Deprecated/outdated:** none — this is the first implementation of routing in this codebase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `settings.subagents.agentOverrides` should be written to [global `~/.pi/agent/settings.json` OR project `.pi/settings.json`] — this research surfaces the choice but does not make it; `05-CONTEXT.md` left the exact write shape to Claude's discretion | Part A.6 | If the planner does not pin one explicitly, the implementer may pick project-scope (dirtying the git tree on every mode switch, since `.pi/settings.json` is currently tracked at `{}`) when global-scope (machine-local, gitignored) may be intended, or vice versa. Low risk either way — mechanically identical — but user-visible behavior (git diff noise) differs |
| A2 | The Qoder SSE event-type enum (`agent.thinking`, `agent.message`, `session.status_idle`, `event_start`, `event_delta`) documented at `docs.qoder.com/cloud-agents/api/sessions/stream-events.md` is representative but the page did not claim to be exhaustive | Part C.3-C.4 | A real session could emit an event type not covered here (e.g. a tool-use event from Qoder's own internal agent, an error event). Mitigated by the "ignore unknown types" parsing rule (Pitfall 4), but the harness cannot enumerate the full contract without the live `RB-05-01` check |
| A3 | `agent_id`/`environment_id` are assumed to be pre-configured, one-time setup values (env vars) rather than created per-task — based on the fetched docs page's own framing ("typically done once via API/console"), not on an executed test | Part C.2, C.4 | If the user's actual workflow expects the delegate tool to provision its own environment per task, the tool would need the `POST /api/v1/cloud/environments` step added — a design change, not just a code change |
| A4 | `isAnthropicClaudeModel`'s re-implementation (Architecture Patterns section) exactly mirrors the private function at `bedrock-converse-stream.js:542-550` as read on 2026-08-14 against the installed pi-ai copy nested under this machine's global `pi-coding-agent` install | Part B.1, Architecture Patterns | If Pi bumps past 0.84.1 with a changed predicate, the guard's local copy silently diverges with no compile-time or lint-time signal — same residual risk `providers/schema.ts`'s `QUOTA_PATTERN`/`UNAVAILABLE_PATTERN` already carry and already accept |

**If this table is empty:** N/A — see above, four items recorded.

## Open Questions (RESOLVED — both settled during planning, 2026-08-14)

> Neither question survived into the plan set. Both were decided in-plan under the Standing
> Operating Policy (the user is asleep; pick the option consistent with the recorded decisions,
> note it in one line, move on). Resolutions are recorded inline below.

1. **Does the R1 tool-calling deny-list (ROUTE-08) apply only when R1 is assigned the executor role, or to every role assignment?**
   - **RESOLVED in `05-02-PLAN.md`: role-scoped.** The deny-list applies when `usesToolLoop` is true (the executor and any subagent role) and is skipped for pure single-shot `callModel()` roles that pass no `tools`. This matches ROUTE-08's own wording and the actual defect, and avoids over-blocking a technically-fine tool-less use. `05-05-PLAN.md` extends the same guard call to the subagent-pin write, so a subagent role — which is a tool-loop role by definition — cannot be pinned to R1 silently.
   - What we know: ROUTE-08's own wording is executor-specific ("Bedrock DeepSeek R1 as executor... it supports no tool calling at all"); `05-CONTEXT.md` decision 4 frames all four blocks together as "the capability guard," which could be read as role-agnostic.
   - What's unclear: whether a single-shot role with no tool loop (e.g. `summariser`) should also be blocked from R1, given R1 genuinely has no defect for a tool-less request.
   - Recommendation: scope the deny-list check to roles that go through a tool loop (executor, and any subagent role) and skip it for pure single-shot `callModel()` roles that pass no `tools` — this matches the stated defect precisely and avoids over-blocking a technically-fine use.

2. **Which `agentOverrides` shape will Phase 7's actual `pi-subagents` package expect?**
   - **RESOLVED in `05-05-PLAN.md`: write ARCHITECTURE.md's documented shape now, flagged for Phase 7 re-verification.** `.pi/extensions/routing/agent-overrides.ts` writes `{ "<agentName>": { "model": "<provider>/<id>" } }` under `settings.subagents.agentOverrides`, carries a mandatory `PHASE 7 RE-VERIFICATION` docstring section naming EXT-08, and targets the GLOBAL agent settings file (`join(getAgentDir(), "settings.json")`) rather than the git-tracked `.pi/settings.json` — resolving Assumption A1 in the same plan.
   - What we know: ARCHITECTURE.md's Pattern 7 states the precedence chain (`settings.subagents.agentOverrides.<name>.model` sits between per-run override/frontmatter and `settings.subagents.defaultModel`/parent-session-model) and cites `pi-subagents@0.47.1`'s `docs/agents.md:11` for it — but that package is not yet installed in this repository (Phase 7).
   - What's unclear: the exact JSON key names Phase 5 should write today, before the package that reads them exists, risk drift.
   - Recommendation: write the shape ARCHITECTURE.md already documents (`{ "<agentName>": { "model": "<provider>/<id>" } }` under `settings.subagents.agentOverrides`) and flag in the plan that Phase 7 must re-verify this shape against the actually-pinned package version at that time (per EXT-08's own "every pin is re-verified at planning time" rule) — do not treat this as settled beyond "forward-compatible best guess."

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node global `fetch` | Qoder delegate tool HTTP calls | ✓ | Node 24.16.0 installed on this machine, project floor `>=22.19.0` (fetch stable since Node 18) | — |
| `QODER_PERSONAL_ACCESS_TOKEN` | ROUTE-11 live check | ✗ | — | Tool must fail with an actionable message when unset; `RB-05-01` stays OUTSTANDING |
| Network egress to `api.qoder.com` | ROUTE-11 live check | ✗ (no network egress on this machine per `05-CONTEXT.md`) | — | `tests/helpers/loopback.ts`-style offline proxy for the offline half; live check deferred to work laptop |
| Pi 0.84.1 installed | All of Part A/B verification | ✓ | 0.84.1, confirmed nested under `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\node_modules\@earendil-works\pi-ai` | — |

**Missing dependencies with no fallback:** none — both missing items (PAT, network egress) have documented fallbacks (fail-actionably, offline proxy).

**Missing dependencies with fallback:** `QODER_PERSONAL_ACCESS_TOKEN`, network egress — both resolved via the `[RUNBOOK]` pattern already established in Phases 2-4.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 (pinned, matches Pi core) |
| Config file | none — `package.json#scripts.test` = `vitest run` |
| Quick run command | `npx vitest run tests/unit/<file>.test.ts` |
| Full suite command | `npx vitest run` (currently 1083+ tests, 64+ files per Phase 4's close-out note) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|-------------|
| ROUTE-01 | Role→model map covers all six roles, no auto-classification | unit | `npx vitest run tests/unit/routing-map.test.ts -x` | ❌ Wave 0 |
| ROUTE-02 | `/cheap`/`/balanced`/`/max` swap via `setModel` after `waitForIdle` | session (`withFauxSession`) | `npx vitest run tests/integration/mode-switch.test.ts -x` | ❌ Wave 0 |
| ROUTE-03 | `/escalate` sticky until cleared | session | `npx vitest run tests/integration/escalate.test.ts -x` | ❌ Wave 0 |
| ROUTE-04 | Single-shot roles via `callModel()`, no session mutation | session, asserting `ctx.model` unchanged + a `kind:"nested"` turns row | `npx vitest run tests/integration/single-shot-roles.test.ts -x` | ❌ Wave 0 |
| ROUTE-05 | Tool-loop roles as subagents (Phase 5 owns the `agentOverrides` write only) | unit, asserting the written JSON shape | `npx vitest run tests/unit/agent-overrides.test.ts -x` | ❌ Wave 0 |
| ROUTE-06 | Image/context-window hard blocks | unit, pure predicate over `Model<Api>` fixtures | `npx vitest run tests/unit/capability-guard.test.ts -x` | ❌ Wave 0 |
| ROUTE-07 | Bedrock non-Claude + thinking hard block | unit, using `tests/helpers/models.ts#withModelsConfig` against a Bedrock-shaped fixture model | `npx vitest run tests/unit/capability-guard.test.ts -x` | ❌ Wave 0 (same file as ROUTE-06) |
| ROUTE-08 | Bedrock R1 executor hard block | unit, deny-list fixture including both `deepseek.r1-v1:0` and `us.deepseek.r1-v1:0` | `npx vitest run tests/unit/capability-guard.test.ts -x` | ❌ Wave 0 (same file) |
| ROUTE-09 | Mode name persists via `appendEntry`, zero context tokens; executor model persists via Pi's native `model_change` (verify, don't re-build) | session, asserting the mode entry's payload appears in NO outgoing request via `wrapFauxWithPayload` capture, AND that `getBranch()` after restart yields the expected `model_change` entry | `npx vitest run tests/integration/mode-persistence.test.ts -x` | ❌ Wave 0 |
| ROUTE-10 | Every mode switch produces a wire dump proving the model served | session, reading `turns-*.jsonl`/`wire-*.jsonl` via `readTornSafe` | `npx vitest run tests/integration/wire-proof.test.ts -x` | ❌ Wave 0 |
| ROUTE-11 (FAUX half) | Delegate tool parses a canned Qoder session+SSE correctly | integration, loopback-style HTTP+SSE fixture | `npx vitest run tests/integration/qoder-delegate.test.ts -x` | ❌ Wave 0 |
| ROUTE-11 (RUNBOOK half) | Real PAT reaches `api.qoder.com` and folds a result back | manual, on the work laptop | documented in `docs/RUNBOOK.md` `RB-05-01` | N/A — OUTSTANDING by construction |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/unit/<touched-file>.test.ts` (and `tests/integration/<touched-file>.test.ts` where applicable)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green, `tsc --noEmit` clean, before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/routing-map.test.ts` — covers ROUTE-01
- [ ] `tests/integration/mode-switch.test.ts` — covers ROUTE-02
- [ ] `tests/integration/escalate.test.ts` — covers ROUTE-03
- [ ] `tests/integration/single-shot-roles.test.ts` — covers ROUTE-04
- [ ] `tests/unit/agent-overrides.test.ts` — covers ROUTE-05
- [ ] `tests/unit/capability-guard.test.ts` — covers ROUTE-06/07/08
- [ ] `tests/integration/mode-persistence.test.ts` — covers ROUTE-09
- [ ] `tests/integration/wire-proof.test.ts` — covers ROUTE-10
- [ ] `tests/integration/qoder-delegate.test.ts` — covers ROUTE-11's [FAUX] half
- [ ] `docs/RUNBOOK.md` `RB-05-01` section + `tests/unit/docs-policy.test.ts` `PHASE_FIVE_IDS`/`ENTRY_COMMANDS` additions — covers ROUTE-11's [RUNBOOK] half
- [ ] No new test framework install needed — vitest already configured and used identically by Phases 2-4

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `QODER_PERSONAL_ACCESS_TOKEN` read from env only, never hardcoded; `Authorization: Bearer` header built at call time, never logged unredacted |
| V3 Session Management | no | Not applicable — no new session/cookie mechanism; Pi's own session entries are used as-is |
| V4 Access Control | partial | The capability guard IS an access-control mechanism (which model may serve which role) — implemented as pure predicates, deny-by-default framing matches Phase 4's established posture |
| V5 Input Validation | yes | The Qoder delegate tool's parameters (task text, optionally repo/branch) are model-supplied input reaching an external HTTP call — validate shape before sending (non-empty string, reasonable length) the same way `safety/index.ts`'s `approve_ky_command` validates its own tool params |
| V6 Cryptography | no | No new cryptographic code; TLS to `api.qoder.com` is handled by Node's `fetch`/`https` stack, never hand-rolled |
| V13 API and Web Service | yes | The Qoder integration is exactly an outbound API client — reuse `diagnostics/redact.ts` for any transcript capture, per `05-CONTEXT.md` decision 12 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PAT committed to a public repo (accidentally hardcoded, or leaked via a logged transcript) | Information Disclosure | Env-var only; `diagnostics/redact.ts#redactDeep`/`redactString` applied at capture to any Qoder transcript, written only to the gitignored `.pi/logs/` tree (matching DIAG-07's own established pattern) |
| Confused deputy: a task delegated to Qoder silently performs an action the Phase 4 safety guard would have blocked in-process (e.g. writing outside the project dir, or a git push) | Elevation of Privilege | Cannot be technically prevented (Qoder's environment is opaque to this harness by design) — mitigated only by the C.5 bypass statement being genuinely visible to the user before they invoke the tool, and by the tool's own description carrying the same warning so the model sees it too |
| `settings.subagents.agentOverrides` write is a config-injection surface: if the write function does not validate `obj` is a plain object before merging (mirroring `bootstrap.sh#merge_settings`'s own `FATAL: ... is not a JSON object. Refusing to touch it.` guard), a malformed or adversarially-crafted `settings.json` could be silently overwritten or could poison the merge | Tampering | Reuse `bootstrap.sh#merge_settings`'s exact validation shape (parse, reject non-object, reject array, refuse rather than coerce) in the new TypeScript read-modify-write helper |
| SSE response body from `api.qoder.com` is untrusted network input; a malformed or adversarial `data:` line should not crash the extension or execute anything | Denial of Service / Tampering | Wrap `JSON.parse` per SSE line in try/catch (mirroring `tests/helpers/loopback.ts`'s own `body = undefined` on parse failure pattern), never `eval`, never dynamically construct code from the payload |

## Sources

### Primary (HIGH confidence)
- `.pi/extensions/diagnostics/call-model.ts`, `schema.ts`, `wire.ts`, `turns.ts`, `index.ts` — this repository, read in full
- `.pi/extensions/providers/fallback.ts`, `schema.ts` — this repository, read in full
- `.pi/extensions/harness/index.ts`, `safety/index.ts` — this repository, read in full (registration patterns)
- `tests/unit/chokepoint-lint.test.ts`, `extension-layout.test.ts`, `contributing-boundary.test.ts`, `docs-policy.test.ts` — this repository, read in full
- `tests/helpers/faux.ts`, `session.ts`, `models.ts`, `logs.ts`, `loopback.ts`, `pi.ts` — this repository, read in full or substantially
- `.pi/templates/models-template.json` — this repository, read in full
- `bin/bootstrap.sh` (`merge_settings`, lines 460-527) — this repository, read
- `docs/RUNBOOK.md` (tail, RB-04-01 worked example) — this repository, read
- `package.json` — this repository, read in full
- `@earendil-works/pi-ai@0.84.1` `dist/api/bedrock-converse-stream.js` (lines 480-928), `dist/types.d.ts` (lines 640-688), `dist/providers/data/amazon-bedrock.json` — installed package at `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\node_modules\@earendil-works\pi-ai`, read/executed live 2026-08-14
- `@earendil-works/pi-coding-agent@0.84.1` `dist/core/extensions/types.d.ts` (lines 195-291, 918-964, 1130-1230), `dist/core/model-registry.d.ts`, `dist/core/agent-session.js` (lines 1185-1265, 1875-1895), `dist/core/session-manager.js` (lines 130-260, 770-801), `dist/core/session-manager.d.ts`, `dist/index.d.ts`, `docs/settings.md` — installed package at `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent`, read live 2026-08-14

### Secondary (MEDIUM confidence)
- docs.qoder.com/cloud-agents/api/conventions/authentication — fetched live 2026-08-14
- docs.qoder.com/cloud-agents/overview — fetched live 2026-08-14
- docs.qoder.com/llms.txt — fetched live 2026-08-14 (URL discovery only)
- docs.qoder.com/cloud-agents/api/sessions/create.md — fetched live 2026-08-14
- docs.qoder.com/cloud-agents/api/sessions/send-event.md — fetched live 2026-08-14
- docs.qoder.com/cloud-agents/api/sessions/stream-events.md — fetched live 2026-08-14
- docs.qoder.com/cloud-agents/api/environments/create.md — fetched live 2026-08-14
- docs.qoder.com/cloud-agents/api/agents/create.md — fetched live 2026-08-14

### Tertiary (LOW confidence)
- None used — every claim in this document traces to a primary or secondary source above.

## Metadata

**Confidence breakdown:**
- Prior-phase contract verification (Part A): HIGH — every claim is a direct read of this repository's committed source
- Capability guard verification (Part B): HIGH — every claim is a direct read or live execution against the installed Pi 0.84.1 package on this machine
- Qoder HTTP shape (Part C): MEDIUM — official docs fetched live, but no live PAT/network egress exists on this machine to execute the sequence end-to-end; the SSE event-type enum is confirmed incomplete as documented (§C.4)

**Research date:** 2026-08-14
**Valid until:** 30 days for the Part A/B findings (Pi platform mechanics, stable pin at 0.84.1); 14 days for Part C (Qoder's API surface is a third-party product that could change without this project's involvement, and the docs page itself did not claim completeness)
