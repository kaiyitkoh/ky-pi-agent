# Phase 2: Diagnostics — The Instrument - Research

**Researched:** 2026-08-13
**Domain:** Pi 0.84.1 provider-hook surface, the nested-call chokepoint, offline model simulation with `fauxProvider`, append-only JSONL observability on Windows
**Confidence:** HIGH — every load-bearing claim below was either read in Pi's own recovered TypeScript with a `file:line` citation, or **executed on this machine this session** and its output pasted in.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Copied verbatim from `.planning/phases/02-diagnostics-the-instrument/02-CONTEXT.md`:

1. **A single exported `callModel()` chokepoint.** Verified at source (`dist/core/sdk.js:170-215`): `before_provider_request`, `after_provider_response`, `before_provider_headers` and `context` are wired into the *main agent's* `streamFn` only. A direct `ctx.modelRegistry.complete()` reaches `ModelRuntime.complete()` and fires none of them — so the inspector is blind to exactly the nested calls (advisor, reviewer, classifier) whose parameters most need verifying. `ProviderRequestOptions` carries per-call `onPayload` / `onResponse` (`pi-ai/dist/types.d.ts:70,74`), which is how the chokepoint restores visibility. `callModel()` is a **Phase 2 export** that Phases 5 and 8 import — its signature is a cross-phase contract, not an internal detail.

2. **The chokepoint is enforced mechanically, not by convention.** DIAG-03: a lint or test that fails the build when `modelRegistry.complete` appears outside `diagnostics/`. Without it, DIAG-02 decays the first time someone adds a nested call.

3. **Redaction happens at capture, not at read.** A wire dump that ever contains a live key on disk in a public repo is a breach even if a later reader would have masked it. Dumps go only to gitignored paths and a test must prove both properties.

4. **Local JSONL, no observability service.** Self-hosted Langfuse (Postgres + ClickHouse) was rejected against the zero-infra / zero-spend constraints. Files under `.pi/logs/`.

5. **Instrument before you tune.** Per-role and main-loop thinking budgets stay unbuilt until this instrument proves the parameters land (GATE-10, and the Carried-Forward Unknowns R1 / "does DeepSeek V4 Flash honour `reasoning_effort` through `openai-completions`"). Phase 2 exists to *answer* those, not to act on them.

6. **No reasoning-token column for Bedrock.** Converse reports none; a zero would be a fabricated measurement.

### Claude's Discretion

File decomposition inside `.pi/extensions/`, the exact JSONL row schema and field names, rotation policy (size vs date) and its thresholds, the redaction matcher's implementation, the DIAG-03 enforcement mechanism (test vs lint), the `/budget` output format, and the retry strategy for a detected prose tool call.

### Deferred Ideas (OUT OF SCOPE)

- Per-role and main-loop thinking budgets — gated on what this instrument measures (Phase 8, GATE-10).
- The controlled experiment attributing "DeepSeek misses bugs Sonnet would catch" to prose tool calls vs context pollution vs provider misconfiguration — Phase 10. Phase 2 only supplies the measurement apparatus.
- `.pi/audit.jsonl` and the safety audit trail — Phase 4.
- Routing's use of `callModel()` — Phase 5; this phase only exports it with a stable signature.
- Any hosted or self-hosted observability backend (Langfuse et al.) — rejected on the zero-infra constraint.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description (verbatim from REQUIREMENTS.md) | Research Support |
|----|---------------------------------------------|------------------|
| DIAG-01 | Every provider request and response is captured via `before_provider_request` / `after_provider_response` / `before_provider_headers`, showing the exact JSON on the wire **[FAUX]** + **[RUNBOOK]** | §1, §2, §3 — exact event shapes and mutation contracts read at source. **§8 finding F1 is the phase-shaping one: `fauxProvider` never calls `onPayload`, so `before_provider_request` cannot fire under a plain faux session.** §8.3 gives the executed 15-line wrapper that fixes it, and §12 splits the offline half from the live half. |
| DIAG-02 | All model invocations route through a single exported `callModel()` chokepoint — provider hooks wire only into the main agent's `streamFn`, so a direct `modelRegistry.complete()` is invisible to the inspector **[FAUX]** | §4 — the premise was **executed** (§4.4): a nested `complete()` fired zero extension hooks while per-call `onPayload`/`onResponse`/`transformHeaders` all fired. §4.2 corrects ARCHITECTURE.md: `transformHeaders` is *also* available on `complete()`, so the chokepoint can restore all three hooks, not two. |
| DIAG-03 | A lint or test fails the build if `modelRegistry.complete` is called outside `diagnostics/` **[FAUX]** | §9 — ESLint is structurally blocked by `tests/unit/pinning.test.ts:253`. A source-grep vitest test in the `contributing-boundary.test.ts` house pattern is recommended, with the exact regex set, the false-positive exclusions, the vacuous-pass guard, and an honest table of the bypasses it does *not* catch. |
| DIAG-04 | Every turn appends a JSONL record — model, provider, tokens, cost, latency, cache-read ratio, outcome (no reasoning-token column for Bedrock; it reports none) **[FAUX]** | §5 — `Usage` shape read at source including the optional `reasoning`; Bedrock's `handleMetadata` confirmed to leave it `undefined`; `calculateCost` is a public export; `after_provider_response` proven **not** to fire on provider errors, so `outcome` must come from `message.stopReason`. §5.5 gives a field-by-field provenance table for the row. |
| DIAG-05 | A detector identifies prose tool calls — `finish_reason:"stop"` with `tool_calls:null` and a function name in `content` — logs `event: prose_tool_call`, and retries rather than treating the turn as complete **[FAUX]** + **[RUNBOOK]** | §6 — `StopReason` enum confirmed to contain the literal `"stop"`; `rawStopReason` carries the provider's raw `finish_reason`. **Two retry mechanisms were executed end to end** (§6.3, §6.4): follow-up injection (recommended) and `message_end` → real `toolCall` promotion (works, rejected as default with reasons). |
| DIAG-06 | `/budget` reports system-prompt tokens, tool-schema tokens, context-file tokens, skills-index tokens, and `cacheRead` vs `input` **[FAUX]** | §7 — every input is a public export or a `ctx` member; `formatSkillsForPrompt` and `estimateTokens` are exported, so skills-index tokens are computable *exactly*. **Measured on this repo: `CLAUDE.md` is 49,404 bytes ≈ 12,351 tokens in every request, and a one-word prompt cost 12,725 input tokens** — ~7× ARCHITECTURE.md's 1,850-token floor estimate. |
| DIAG-07 | Captured payloads are redacted at capture time and written only to gitignored paths — a wire inspector is by construction a credential-logging tool feeding a public repo **[FAUX]** | §3.3 — the credential-bearing header names enumerated at source; **the payload itself carries no API key on any adapter read**, so the real hazard is secret-shaped *content* the model read into context. §10.4 confirms Pi ships no redaction helper and no new dependency may be added. |
| DIAG-08 | Diagnostic logs rotate rather than growing unbounded **[FAUX]** | §10 — no Pi-provided log helper; `withFileMutationQueue` is in-process only and useless across subagents. **Executed on this machine: 4 concurrent processes × 200 records × 200 KB each produced 800 lines and 0 torn records**, and `renameSync` succeeded over both a same-process and a cross-process open handle. Concrete rotation numbers in §10.5. |
</phase_requirements>

---

## Summary

Three findings reshape this phase, and one of them invalidates the default test strategy.

**First — and this is the big one — `fauxProvider` never calls `onPayload`, so `before_provider_request` never fires in a faux session.** I proved it by running a real `createAgentSession` against `fauxProvider` with an extension that logs all three provider hooks: `before_provider_headers` fired, `after_provider_response` fired, and `before_provider_request` did not appear in the log at all (§8.2, executed output pasted). Every DIAG requirement is tagged `[FAUX]`, and DIAG-01/DIAG-07 are *about* the payload hook, so a plan that assumes "register faux, prompt, assert on the captured payload" ships a test that is vacuously green. The fix is small and I executed it: a ~15-line wrapper around `faux.provider` that calls `options.onPayload(...)` at exactly the point every real adapter calls it (`openai-completions.ts:237`, `bedrock-converse-stream.ts:247`). With the wrapper in place the hook fires and the payload arrives (§8.3). That wrapper belongs in `tests/helpers/faux.ts` in Wave 0 — before any DIAG-01 or DIAG-07 test is written.

**Second, DIAG-02's premise is now executed rather than inferred, and the chokepoint is one hook richer than ARCHITECTURE.md thought.** A nested `modelRuntime.complete()` made during a live session fired *none* of the three extension provider hooks — the extension's log file was never even created — while the per-call `onPayload`, `onResponse` **and `transformHeaders`** callbacks all fired (§4.4). `transformHeaders` is part of `ModelsRequestTransforms`, which `ModelsApiStreamOptions<TApi>` includes (`pi-ai src/models.ts:78-83`), and `ModelRegistry.complete` takes exactly that type (`pi src/core/model-registry.ts:101-107`). So `callModel()` can restore all three hooks on the nested path, not two, and `callModel`'s signature — the cross-phase contract Phases 5 and 8 import — should carry a headers capture from day one rather than being widened later. A second, quieter finding: `fauxProvider` hardcodes `usage.cost` to all zeros regardless of the model's cost rates, so any cost assertion written naively against faux is a zero-equals-zero tautology. `callModel()` should call the exported `calculateCost(model, usage)` itself; it is idempotent and it makes the cost column real in both faux tests and production.

**Third, the `/budget` number this repo actually needs is already measurable and is far worse than the roadmap assumed.** `CLAUDE.md` in this repository is 49,404 bytes; the faux run's system prompt was 50,881 characters and a single one-word prompt reported 12,725 input tokens. ARCHITECTURE.md's "real per-turn floor is ~1,850 tokens" understates the live figure in this repo by roughly seven times, and the entire excess is one context file. `/budget` does not need to be clever to be valuable — it needs to print that number on the first day. Every input it needs is a public export: `ctx.getSystemPrompt()` (exact string), `ctx.getSystemPromptOptions()` (command contexts only — `contextFiles` and `skills` are populated, `agent-session.ts:1046-1055`), `formatSkillsForPrompt` and `estimateTokens` (both exported from `@earendil-works/pi-coding-agent`), and `pi.getAllTools()` whose `ToolInfo` carries `parameters` (`types.ts:1575`).

**Primary recommendation:** Build Wave 0 as three test helpers before any requirement code — the `onPayload`-emitting faux wrapper, an in-memory `createAgentSession` factory (`ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false })` + `SessionManager.inMemory()` + `SettingsManager.inMemory()`, all executed in §8.4), and a `.pi/logs/` temp-dir fixture. Then build `diagnostics/` as capture → redact → append, with `callModel()` exporting all three per-call capture hooks plus `calculateCost`, the prose detector retrying via `pi.sendUserMessage(..., { deliverAs: "followUp" })` from `message_end` (executed, §6.3), and DIAG-03 as a source-grep vitest test rather than ESLint (ESLint is structurally blocked, §9.2).

---

## Decisions taken autonomously

The user is asleep. Each of these is a "Claude's discretion" item from CONTEXT.md, decided consistently with PROJECT.md / ROADMAP.md / `.planning/research/`, and noted in one line as the Standing Operating Policy requires.

1. **DIAG-03 is a source-grep vitest test, not ESLint.** ESLint cannot be added without breaking `tests/unit/pinning.test.ts:253` ("declares no dev dependency beyond the six audited pins") and without a Package Legitimacy Audit of eslint plus plugins. Phase 1 already established source-assertion tests as the house pattern (`contributing-boundary.test.ts`). §9.
2. **`callModel()` captures headers as well as payload and response.** `transformHeaders` is available on `complete()` (§4.2) and DIAG-01 names all three hooks. Discovering this after Phase 5 imports the signature would be a breaking change to a cross-phase contract.
3. **`callModel()` calls `calculateCost(model, usage)` defensively.** Faux returns zero cost; real adapters already populate it; `calculateCost` recomputes from the same rates and is idempotent (`pi-ai src/models.ts:878-898`). Without it the DIAG-04 cost column is untestable offline.
4. **The prose-tool-call retry is follow-up injection, not tool-call promotion.** Both were executed and both work (§6.3, §6.4). Promotion fabricates a tool call the model never emitted through the channel and executes it with arguments parsed out of prose — on a machine where Phase 4 exists precisely because tool execution is dangerous, that is the wrong default. Promotion is documented as an alternative with its risks named.
5. **Rotation is size-based with a date-stamped base name and a retention prune at `session_start`.** Concrete numbers in §10.5. Date alone does not bound a heavy day; size alone loses the "which day was that?" affordance.
6. **One shared JSONL file per stream, not one per process.** Executed evidence (§10.3) shows `appendFileSync` is atomic across four concurrent processes at record sizes up to 200 KB on this Windows box, so per-process fragmentation buys nothing and costs readability.
7. **Test fixtures that must be committed do not use the `.jsonl` extension.** `.gitignore:26` blanket-ignores `*.jsonl`. A fixture named `*.jsonl.txt` (or held inline in the test) is committable; a `.jsonl` one silently never reaches CI. §10.6.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Main-loop wire capture | Pi extension event hooks (`before_provider_headers` / `before_provider_request` / `after_provider_response`) | — | These hooks exist only on the main agent's `streamFn`; nothing else can see the main loop's payload. Verified `sdk.ts:302-348`. |
| Nested-call wire capture | `callModel()` in `diagnostics/`, via per-call `onPayload` / `onResponse` / `transformHeaders` | — | The extension hooks do not fire here. Executed §4.4. |
| Redaction | `diagnostics/` capture path, synchronously before any write | — | "At capture, not at read" is a locked decision; Pi ships no redactor (§10.4). |
| Per-turn accounting | `message_end` + `turn_end` extension hooks reading `AssistantMessage.usage` | `after_provider_response` for status only | The response body is unreachable from any hook; usage lives on the finalized message. §3.2, §5. |
| Cost | `calculateCost(model, usage)` from `@earendil-works/pi-ai` | provider adapters (already call it in production) | Public export; faux does not populate it. §5.3. |
| Prose-tool-call detection | `message_end` extension hook | — | The only hook that sees the finalized assistant message with `stopReason` and full `content` before the loop reads it. §6.2. |
| Prose-tool-call retry | `pi.sendUserMessage(..., { deliverAs: "followUp" })` | agent-loop follow-up queue (`agent-loop.ts:262-268`) | Executed §6.3. The loop's own resumption point; no new agent run, no `agent_end` in between. |
| Token budget report | Extension **command** (`ExtensionCommandContext`) | `ctx.getSystemPrompt()`, `getSystemPromptOptions()`, `pi.getAllTools()` | `getSystemPromptOptions()` exists only on the command context (`types.ts:1352-1356`); and a command costs zero per-turn tokens (BOOT-10). |
| Log durability & rotation | `node:fs` `appendFileSync` in `diagnostics/jsonl.ts` | `session_start` hook for retention prune | No Pi log helper exists; `withFileMutationQueue` is in-process only. §10.1-10.3. |
| Chokepoint enforcement | vitest source-grep over `git ls-files` | `tsc --noEmit` (types only, cannot express this) | ESLint blocked by the six-devDependency pin. §9. |

---

## §1 `before_provider_request` — exact shape and replacement semantics (DIAG-01, DIAG-07)

### 1.1 The event

```ts
/** Fired before a provider request is sent. Can replace the payload. */
export interface BeforeProviderRequestEvent {
	type: "before_provider_request";
	payload: unknown;
}
```
`[VERIFIED: pi 0.84.1 src/core/extensions/types.ts:675-679]`

The result type is `export type BeforeProviderRequestEventResult = unknown;` `[VERIFIED: types.ts:1069]` — deliberately untyped, because the payload shape is provider-specific.

### 1.2 Return `undefined` or you replace the request

```ts
const handlerResult = await handler(event, ctx);
if (handlerResult !== undefined) {
    currentPayload = handlerResult;
}
```
`[VERIFIED: pi src/core/extensions/runner.ts:1030-1033]`

Handlers run in extension load order and each sees the previous handler's replacement (`runner.ts:1020-1028`). Docs restate it: *"Returning `undefined` keeps the payload unchanged. Returning any other value replaces the payload for later handlers and for the actual request."* `[CITED: docs/extensions.md:680]`

**Planning consequence.** A capture handler written as an arrow function with an expression body (`(e) => log(e.payload)`) returns whatever `log` returns. If `log` returns anything but `undefined`, the harness silently replaces every request payload with a log return value. The capture handler must have a block body and no return. Pi's own reference implementation does exactly this `[CITED: examples/extensions/provider-payload.ts:6-13]`. A unit test should assert the handler's return value is `undefined`.

**Corollary worth banking for DIAG-05.** Because a non-`undefined` return *does* replace the payload, `tool_choice: "required"` can be injected for exactly one retry request from a second, flag-guarded handler. This is the only way to reach `toolChoice` on the main loop — the agent's per-turn config has no such field. `toolChoice` is a per-API option (`openai-completions.ts:143`, `bedrock-converse-stream.ts:72`, `anthropic-messages.ts:255`) reachable directly only on the nested `complete()` path.

### 1.3 Where in the request the payload sits, and whether it carries credentials

| Adapter | `onPayload` argument | Contains a credential? |
|---|---|---|
| `openai-completions` | `params: ChatCompletionCreateParamsStreaming` — the JSON request body | **No.** The key goes to `createClient(model, context, apiKey, ...)` on the line above `[VERIFIED: openai-completions.ts:227-237]` |
| `bedrock-converse-stream` | `commandInput: ConverseStreamCommandInput` (`modelId`, `messages`, `system`, `inferenceConfig`, `toolConfig`, `additionalModelRequestFields`) | **No.** SigV4 is applied by Smithy middleware after the command is built `[VERIFIED: bedrock-converse-stream.ts:234-251]` |
| `anthropic-messages` | `params` | **No** — `onPayload` at `:550`, auth via client construction |
| `google-generative-ai` / `google-vertex` / `openai-responses` / `azure-openai-responses` / `mistral` / `pi-messages` / `openai-codex-responses` | request body object | No — all resolve auth into headers or SDK clients |

`[VERIFIED: exhaustive grep of `onPayload` across `pi-ai/src/api/*.ts` — 12 call sites, all post-body-build, all pre-send]`

**This is the most important DIAG-07 fact and it inverts the naive threat model.** The payload does not contain the API key. What it *does* contain is the full `messages[]` array — including any file the model read this session. On a machine holding live AWS SSO credentials, the realistic leak is a `.env`, an `~/.aws/credentials`, or a `*.tfstate` that the model read into context and that the wire dump then wrote to disk verbatim. Phase 4's SAFE-06 blocks those reads, but Phase 4 has not shipped yet and Phase 2's dumps start today.

**Therefore the redactor must scan values, not just key names.** A key-name allowlist (`authorization`, `x-api-key`, …) is necessary for §3.3's header path and completely insufficient for the payload path. The payload redactor needs secret-*shaped* value matching: `sk-[A-Za-z0-9_-]{16,}`, `AKIA[0-9A-Z]{16}`, `ASIA[0-9A-Z]{16}`, `ghp_`/`gho_`/`ghu_`/`ghs_`/`github_pat_`, `xoxb-`/`xoxp-`, `AIza[0-9A-Za-z_-]{35}`, `pt-[A-Za-z0-9]{16,}` (Qoder PAT), `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `Bearer\s+[A-Za-z0-9._-]{20,}`, and `aws_secret_access_key\s*=\s*\S+`. A companion test must assert a *negative control*: a payload containing each pattern comes out redacted, and a payload containing none comes out byte-identical (otherwise a redactor that mangles everything passes).

---

## §2 `before_provider_headers` — mutation contract and retry behaviour (DIAG-01, DIAG-07)

### 2.1 The event and its contract

```ts
/**
 * Fired after request headers are assembled, before the provider HTTP call.
 * Handlers mutate `headers` in place (e.g. to inject tracing/session headers);
 * the return value is ignored. A `null` value deletes that header.
 */
export interface BeforeProviderHeadersEvent {
	type: "before_provider_headers";
	headers: ProviderHeaders;   // Record<string, string | null>
}
```
`[VERIFIED: pi src/core/extensions/types.ts:681-689; ProviderHeaders at pi-ai src/types.ts:110]`

The runner confirms the return value is discarded: *"// Handlers mutate `headers` in place; the return value is ignored."* followed by a bare `await handler(event, ctx);` `[VERIFIED: runner.ts:1059-1064]`.

### 2.2 Fires once per request; retries do not re-fire

`transformHeaders` is invoked inside `ModelRuntime.prepareRequest`, which runs once per logical request inside `lazyStream`:

```ts
const { transformHeaders, ...rawProviderOptions } = options ?? {};
let headers = mergeHeaders(resolution.auth.headers, providerOptions.headers);
if (transformHeaders) headers = await transformHeaders(headers ?? {});
```
`[VERIFIED: pi src/core/model-runtime.ts:590-593]`

Provider-level retries happen *inside* the adapter, wrapped around the SDK call (`retryProviderRequest(...)`, `openai-completions.ts:245-252`) — i.e. after headers were computed. Docs state the consequence directly: *"Runs once per provider request; retries reuse the same headers rather than re-firing the hook."* `[CITED: docs/extensions.md:676]`

**Planning consequence.** A per-attempt correlation id cannot come from this hook. Correlate on `(sessionId, turnIndex, monotonic counter)` maintained by `diagnostics/` instead, and record `attempt` only where it is observable — which, for the main loop, it is not.

### 2.3 Hook order

`before_provider_headers` → `before_provider_request` → HTTP → `after_provider_response`. Both the docs diagram `[CITED: docs/extensions.md:298-300]` and the code path (`prepareRequest` → `provider.streamSimple` → body build → `onPayload`) agree. Confirmed by the executed probe in §8.2, where the log lines appear in exactly that order.

### 2.4 What is actually in the headers — the DIAG-07 redaction list

`headers = mergeHeaders(resolution.auth.headers, providerOptions.headers)`, so the hook sees **resolved provider auth headers**. Enumerated at source:

| Header | Provider / path | Source |
|---|---|---|
| `Authorization: Bearer <token>` | Anthropic auth-token path | `pi-ai src/providers/anthropic.ts:28` |
| `Authorization` | OpenAI-compatible / OAuth providers | `openai-completions.ts:72-76` (`getClientApiKey` accepts `authorization` in lieu of `apiKey`) |
| `x-api-key` | Anthropic messages; Cloudflare gateway | `anthropic-messages.ts:287`, `providers/cloudflare-auth.ts:95` |
| `cf-aig-authorization` | Cloudflare AI Gateway | `openai-completions.ts:74`, `cloudflare-auth.ts:94` |
| `Authorization: Bearer <codex token>` | OpenAI Codex responses | `openai-codex-responses.ts:1606` |

Plus Pi's own attribution headers (`HTTP-Referer`, `X-OpenRouter-Title`, `X-BILLING-INVOKE-ORIGIN`, `User-Agent`), which are not secrets.

**Bedrock is the exception and it matters.** SigV4 is applied by the AWS SDK's signing middleware, downstream of anything Pi hands over; and `ProviderRequestOptions.headers` documents that on Bedrock *"reserved headers (`x-amz-*`, `authorization`, `host`) are silently ignored to preserve SigV4 / bearer auth"* `[CITED: pi-ai src/types.ts:148-153]`. **So the wire inspector never sees a Bedrock credential in `before_provider_headers`.** Recording that as a *limitation* in `docs/DIAGNOSTICS.md` is more honest than implying the dump is complete.

**Recommended header redaction rule:** case-insensitive key match on `authorization`, `x-api-key`, `api-key`, `cf-aig-authorization`, `x-goog-api-key`, `proxy-authorization`, `cookie`, `set-cookie`, plus any key matching `/(^|[-_])(api[-_]?key|token|secret|credential|password)([-_]|$)/i`. Replace the value with `"[redacted:<n> chars]"` — keeping the length makes "was a key present at all?" answerable without exposing it.

---

## §3 `after_provider_response` — what you get, and where usage really comes from (DIAG-04)

### 3.1 The event

```ts
/** Fired after a provider response is received and before the response stream is consumed. */
export interface AfterProviderResponseEvent {
	type: "after_provider_response";
	status: number;
	headers: Record<string, string>;
}
```
`[VERIFIED: types.ts:691-696]` — the result is ignored (`on(event: "after_provider_response", handler: ExtensionHandler<AfterProviderResponseEvent>)`, no result type, `types.ts:1226`).

### 3.2 The response body is NOT reachable from this hook

The adapter calls `onResponse` with a manufactured `{ status, headers }` pair and nothing else:

```ts
await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
stream.push({ type: "start", partial: output });
```
`[VERIFIED: openai-completions.ts:239-241]`

On Bedrock it is even thinner — `{ status: response.$metadata.httpStatusCode, headers: { "x-amzn-requestid": ... } }` `[VERIFIED: bedrock-converse-stream.ts:255-261]`. Docs concur: *"Header availability depends on provider and transport. Providers that abstract HTTP responses may not expose headers."* `[CITED: docs/extensions.md:708]`

**Two consequences the plan must absorb:**

1. **All token/cost/content data comes from the finalized `AssistantMessage`, delivered by `message_end` (or `turn_end`), never from `after_provider_response`.**
2. **`after_provider_response` never fires on a provider error.** In `openai-completions` the `onResponse` call sits *after* `await retryProviderRequest(...)`; a 4xx/5xx throws and control jumps to the `catch` at `:590`, which sets `output.stopReason = "error"` and `output.errorMessage` and pushes an error event `[VERIFIED: openai-completions.ts:590-609]`. So a DIAG-04 row that derives `outcome` from the response hook records nothing at all for the failures that matter most.

### 3.3 What DIAG-04's `outcome` should therefore be derived from

| Outcome | Source |
|---|---|
| `ok` | `message.stopReason === "stop"` |
| `tool_use` | `message.stopReason === "toolUse"` |
| `length` | `message.stopReason === "length"` |
| `error` | `message.stopReason === "error"` + `message.errorMessage` + `message.diagnostics[]` |
| `aborted` | `message.stopReason === "aborted"` |
| `deferred` | `message.stopReason === "deferred"` |
| `prose_tool_call` | detector verdict (§6), recorded alongside — not instead of — `stopReason` |

`AssistantMessage.diagnostics?: AssistantMessageDiagnostic[]` carries *"Redacted provider/runtime diagnostics for failures and recoveries"* with `{ type, timestamp, error: {name, message, stack, code}, details }` `[VERIFIED: pi-ai src/types.ts:421; src/utils/diagnostics.ts:1-12]`. Note it says "redacted" but the type is a plain error record — do **not** treat it as pre-sanitised; run it through the redactor like everything else.

---

## §4 The `callModel()` chokepoint (DIAG-02)

### 4.1 The exact signature to wrap

```ts
complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,                        // { systemPrompt?, messages, tools? }
    options?: ModelsApiStreamOptions<TApi>,
): Promise<AssistantMessage> {
    return this.runtime.complete(model, context, options);
}
```
`[VERIFIED: pi src/core/model-registry.ts:101-107]` — `ModelRegistry` is described in its own header comment as a *"Synchronous compatibility facade exposed to extensions"* (`model-registry.ts:28-30`), and `ExtensionContext.modelRegistry: ModelRegistry` (`types.ts:319`).

`ModelRuntime.complete` is `this.stream(model, context, options).result()` `[VERIFIED: model-runtime.ts:628-634]`.

### 4.2 CORRECTION to ARCHITECTURE.md: `transformHeaders` is available too

```ts
export interface ModelsRequestTransforms {
	/** Transform fully assembled model/auth/request headers before provider dispatch. */
	transformHeaders?: (headers: ProviderHeaders) => ProviderHeaders | Promise<ProviderHeaders>;
}
export type ModelsApiStreamOptions<TApi extends Api> = ApiStreamOptions<TApi> & ModelsRequestTransforms;
```
`[VERIFIED: pi-ai src/models.ts:78-83]`

ARCHITECTURE.md Pattern 2 lists only `onPayload` and `onResponse`. It is right that those exist and wrong that they are the whole set. Because `complete()` takes `ModelsApiStreamOptions<TApi>`, **`callModel()` can capture headers on the nested path exactly as `before_provider_headers` does on the main path.** DIAG-01 names all three hooks; without this the nested path would satisfy two of three.

The full option surface available to `callModel()`, all reachable through `ModelsApiStreamOptions<TApi>`:

| Option | Type / note | Source |
|---|---|---|
| `onPayload` | `(payload, model) => unknown \| undefined` — return `undefined` to keep | `pi-ai src/types.ts:141` |
| `onResponse` | `(response: {status, headers}, model) => void` | `types.ts:145` |
| `transformHeaders` | `(headers) => ProviderHeaders` | `models.ts:79` |
| `signal` | `AbortSignal` — pass `ctx.signal` so Esc cancels nested work | `types.ts:121` |
| `headers` | `ProviderHeaders`, merged before `transformHeaders` | `types.ts:154` |
| `apiKey`, `env`, `fetch` | per-call auth/transport override | `types.ts:124-136` |
| `sessionId`, `cacheRetention` | prompt-cache control; `"none"` disables session caching | `types.ts:196-206` |
| `maxTokens`, `temperature`, `samplingParams` | `StreamOptions` | `types.ts:181-190` |
| `toolChoice` | per-API; `"required"`/`"any"` etc. | `openai-completions.ts:143`, `bedrock-converse-stream.ts:72`, `anthropic-messages.ts:255` |
| `reasoningEffort` / `thinkingEnabled` / `thinkingBudgetTokens` | per-API thinking control | per-API options interfaces |
| `timeoutMs`, `maxRetries`, `maxRetryDelayMs` | `types.ts:159-172` |

### 4.3 Where the hooks are wired (why nested calls are blind)

```ts
agent = new Agent({
    ...
    streamFn: async (model, context, options) => {
        ...
        return modelRuntime.streamSimple(model, context, {
            ...options,
            transformHeaders: async (requestHeaders) => { ... emitBeforeProviderHeaders ... },
        });
    },
    onPayload: async (payload, _model) => { ... emitBeforeProviderRequest ... },
    onResponse: async (response, _model) => { ... emit after_provider_response ... },
    transformContext: async (messages) => runner.emitContext(messages),
});
```
`[VERIFIED: pi src/core/sdk.ts:294-360]` — all four hooks are constructor options on the **one** `Agent` instance. Nothing else in Pi routes through it.

### 4.4 EXECUTED PROOF

I ran a live `createAgentSession` with a user-scope extension logging all three provider hooks, made a main-loop turn, then made a nested `modelRuntime.complete()` with per-call callbacks. Verbatim output:

```
=== after MAIN loop turn ===
{"hook":"before_provider_headers","headers":{}}
{"hook":"before_provider_request","payloadKeys":["model","marker"]}
{"hook":"after_provider_response","status":200,"headers":{}}
{"hook":"message_end","stopReason":"stop","usage":{"input":12725,"output":4,...}}
{"hook":"turn_end","turnIndex":0,"toolResults":0}

=== after NESTED complete() ===
extension hook log: "(no file - extension hooks never fired)"
per-call onPayload saw: {"model":"faux-flash","marker":"NESTED-OR-MAIN"}
per-call onResponse saw: {"status":200,"headers":{}}
per-call transformHeaders saw: {}
nested usage: {"input":6,"output":4,"cacheRead":0,"cacheWrite":6,"totalTokens":16,"cost":{"input":0,...,"total":0}}
cost after calculateCost: {"input":0.000006,"output":0.000008,"cacheRead":0,"cacheWrite":0.000009,"total":0.000023}
```
`[VERIFIED: executed 2026-08-13, node 24.16.0, Pi 0.84.1 — the extension's log file was not even created by the nested call]`

Three things this pins down for the plan: the extension hooks are genuinely blind to nested calls; all three per-call callbacks are the complete replacement; and **`usage.cost` came back all zeros until `calculateCost` was applied**.

### 4.5 The other bypass routes (name them in `docs/DIAGNOSTICS.md`)

`ctx.modelRegistry` also exposes `getProvider(id): Provider | undefined` and `getRegisteredNativeProvider(name)` (`model-registry.ts:96-98, 143-145`), and a `Provider` carries `.stream()` / `.streamSimple()` directly. `ModelRuntime` itself is a public export (`pi/src/index.ts:184`). And `@earendil-works/pi-ai` exposes `./api/*` subpaths, so an adapter's `stream` can be imported outright. DIAG-03's lint cannot close all of these; it should close the practical ones and the docs should list the rest as known limits (§9.4). This is the same honest-limits posture SAFE-15 requires of the bash guard.

### 4.6 Recommended `callModel()` signature (the cross-phase contract)

```ts
// .pi/extensions/diagnostics/call-model.ts
export interface CallModelOptions<TApi extends Api> {
  /** Role name recorded in the JSONL row: "advisor" | "reviewer" | "summariser" | ... */
  role: string;
  model: Model<TApi>;
  systemPrompt?: string;
  messages: Message[];
  tools?: ToolDefinition[];
  /** Per-API options: reasoningEffort | thinkingEnabled | thinkingBudgetTokens | toolChoice | maxTokens | temperature */
  api?: Omit<ModelsApiStreamOptions<TApi>, "onPayload" | "onResponse" | "transformHeaders" | "signal">;
  /** Defaults to ctx.signal so Esc cancels nested work. */
  signal?: AbortSignal;
}

export async function callModel<TApi extends Api>(
  ctx: ExtensionContext,
  opts: CallModelOptions<TApi>,
): Promise<AssistantMessage>;
```

Phases 5 (ROUTE-04, GATE-09) and 8 import this. Keep `role` mandatory — it is the join key between the wire log and the turns log, and it is the field that makes "was `/max` worth it?" answerable.

---

## §5 Where the per-turn numbers live (DIAG-04)

### 5.1 `Usage`

```ts
export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Subset of `cacheWrite` written with 1h retention. Only Anthropic reports this split. */
	cacheWrite1h?: number;
	/**
	 * Reasoning/thinking tokens, when the provider reports them. This is a subset of
	 * `output`: `output` already includes these tokens. Set to a number (possibly 0) by
	 * providers that expose a reasoning breakdown; left undefined by providers that don't.
	 */
	reasoning?: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}
```
`[VERIFIED: pi-ai src/types.ts:368-389]`

### 5.2 The Bedrock reasoning-token claim — CONFIRMED at source

```ts
function handleMetadata(event, model, output): void {
	if (event.usage) {
		output.usage.input = event.usage.inputTokens || 0;
		output.usage.output = event.usage.outputTokens || 0;
		output.usage.cacheRead = event.usage.cacheReadInputTokens || 0;
		output.usage.cacheWrite = event.usage.cacheWriteInputTokens || 0;
		output.usage.totalTokens = event.usage.totalTokens || output.usage.input + output.usage.output;
		calculateCost(model, output.usage);
	}
}
```
`[VERIFIED: pi-ai src/api/bedrock-converse-stream.ts:589-602]` — `reasoning` is never assigned, so it stays `undefined`.

Contrast `openai-completions`, which *does* assign it:
```ts
reasoning: rawUsage.completion_tokens_details?.reasoning_tokens || 0,
```
`[VERIFIED: openai-completions.ts:1404, from the `completion_tokens_details?: { reasoning_tokens?: number }` shape at :1380]`

**Schema decision this forces.** `reasoning` must be an **omitted key**, not `null` and not `0`, when `usage.reasoning === undefined`. A `0` on the Bedrock rows is a fabricated measurement — exactly what locked decision 6 forbids — and a `null` invites a chart that renders it as zero anyway. `docs/DIAGNOSTICS.md` must state: *absence of the key means the provider does not report the breakdown; it does not mean zero thinking tokens were billed.*

### 5.3 Cost: computed by Pi, and by us

```ts
export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	let rates: ModelCostRates = model.cost;
	for (const tier of model.cost.tiers ?? []) { if (inputTokens > tier.inputTokensAbove && ...) rates = tier; }
	const longWrite = usage.cacheWrite1h ?? 0;
	const shortWrite = usage.cacheWrite - longWrite;
	usage.cost.input = (rates.input / 1000000) * usage.input;
	...
}
```
`[VERIFIED: pi-ai src/models.ts:878-898]`. It is exported from the public index (`export * from "./models.ts"`, `pi-ai src/index.ts:34`) and I imported and called it successfully in §4.4. It **mutates `usage.cost` in place** and recomputes from the same rates, so calling it twice is safe.

Real adapters already call it; `fauxProvider` hardcodes `cost` to all zeros in `withUsageEstimate` `[VERIFIED: pi-ai src/providers/faux.ts:256-266]`. Hence decision 3.

### 5.4 `ctx.getContextUsage()`

```ts
export interface ContextUsage {
	/** Estimated context tokens, or null if unknown (e.g. right after compaction...). */
	tokens: number | null;
	contextWindow: number;
	/** Context usage as percentage of context window, or null if tokens is unknown. */
	percent: number | null;
}
```
`[VERIFIED: types.ts:288-294]`; implementation at `agent-session.ts:3174-3216` — it uses the last post-compaction assistant `usage` and estimates trailing messages with `estimateTokens`. It is a **whole-context estimate with no breakdown**, so it is right for a status line and wrong for `/budget`'s component table.

### 5.5 Field-by-field provenance for the DIAG-04 row

| Field | Source | Hook |
|---|---|---|
| `ts` | `Date.now()` | — |
| `kind` | `"turn"` \| `"nested"` | — |
| `role` | session executor, or `opts.role` | — |
| `sessionId` | `ctx.sessionManager.getSessionId()` | — |
| `turnIndex` | `event.turnIndex` | `turn_end` (`types.ts:735-740`) |
| `provider` / `model` | `message.provider` / `message.model` | `message_end` |
| `responseModel` | `message.responseModel` (differs on OpenRouter `auto`) | `message_end` (`pi-ai types.ts:419`) |
| `input`/`output`/`cacheRead`/`cacheWrite`/`totalTokens` | `message.usage.*` | `message_end` |
| `reasoning` | `message.usage.reasoning` — **omit key when `undefined`** | `message_end` |
| `cacheReadRatio` | `cacheRead / (input + cacheRead)`; omit when denominator is 0 | derived |
| `cost.*` | `calculateCost(model, usage)` | derived |
| `latencyMs` | `turn_end` wall clock − `turn_start.timestamp` (`types.ts:728-732`) | `turn_start`/`turn_end` |
| `stopReason` / `rawStopReason` | `message.stopReason` / `message.rawStopReason` | `message_end` |
| `outcome` | mapped from `stopReason` (§3.3) | `message_end` |
| `errorMessage` | `message.errorMessage`, redacted | `message_end` |
| `toolCalls` | count of `content[].type === "toolCall"` | `message_end` |
| `toolResults` | `event.toolResults.length` | `turn_end` |
| `event` | `"prose_tool_call"` when the detector fires | `message_end` |
| `httpStatus` | `after_provider_response.status` — **absent on error and on every nested call unless `callModel` supplies `onResponse`** | `after_provider_response` |

`ctx.thinkingLevel` (`types.ts:328`) should be recorded as the *requested* input alongside the totals — PITFALLS Pitfall 2's recommendation, since Bedrock makes thinking cost undecomposable.

---

## §6 The prose-tool-call detector and its retry (DIAG-05)

### 6.1 `stopReason` really is the literal `"stop"`

```ts
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
```
`[VERIFIED: pi-ai src/types.ts:391]`

`AssistantMessage` additionally carries `rawStopReason?: string` — the provider's untranslated value. `openai-completions` sets it directly from `choice.finish_reason` before mapping `[VERIFIED: openai-completions.ts:462-464]`; Bedrock from `item.messageStop.stopReason` (`bedrock-converse-stream.ts:275`). So the requirement's `finish_reason:"stop"` is checkable two ways, and both belong in the JSONL row.

The `tool_calls: null` half becomes `message.content.some(c => c.type === "toolCall") === false` — Pi normalises tool calls into content blocks (`pi-ai types.ts:415`).

### 6.2 `message_end` is the right hook, and its replacement contract

```ts
export interface MessageEndEventResult {
	/** Replace the finalized message. The replacement must keep the original message role. */
	message?: AgentMessage;
}
```
`[VERIFIED: types.ts:1097-1100]` — the runner rejects a role change with an `emitError` and *continues* rather than throwing (`runner.ts:850-857`).

Crucially, the replacement is applied by deleting every key on the original object and `Object.assign`-ing the replacement onto it:
```ts
private _replaceMessageInPlace(target, replacement): void {
	// Agent-core stores the finalized message object in its state before emitting message_end. ...
	for (const key of Object.keys(targetRecord)) delete targetRecord[key];
	Object.assign(targetRecord, replacement);
}
```
`[VERIFIED: pi src/core/agent-session.ts:710-724]`, invoked from `_emitExtensionEvent` at `:762-779`, which is `await`ed *before* persistence (`:634` then `:640`).

And the agent loop reads that very object immediately after the emit returns:
```ts
await emit({ type: "message_end", message: finalMessage });
return finalMessage;
...
const toolCalls = message.content.filter((c) => c.type === "toolCall");
```
`[VERIFIED: pi-agent-core src/agent-loop.ts:350-352, 203]`

### 6.3 RECOMMENDED retry: follow-up injection — EXECUTED

The agent loop's own resumption point:
```ts
// Agent would stop here. Check for follow-up messages.
const followUpMessages = (await config.getFollowUpMessages?.()) || [];
if (followUpMessages.length > 0) { pendingMessages = followUpMessages; continue; }
```
`[VERIFIED: pi-agent-core src/agent-loop.ts:262-268]`

`pi.sendUserMessage(content, { deliverAs?: "steer" | "followUp" })` `[VERIFIED: types.ts:1311-1314]` routes to `AgentSession.prompt(..., { streamingBehavior: deliverAs, expandPromptTemplates: false, source: "extension" })` `[VERIFIED: agent-session.ts:1480-1511]`. While the agent is streaming, omitting `deliverAs` **throws**: *"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."* `[VERIFIED: agent-session.ts:1167-1172]` — and inside `message_end` the agent *is* streaming (my probe logged `isIdle: false`).

Executed, verbatim:
```
{"hook":"message_end.assistant","stopReason":"stop","hasToolCall":false,"prose":true,"retries":0,"text":"read({\"path\":\"a.txt\"})"}
{"event":"prose_tool_call","action":"retry_followUp","isIdle":false}
{"hook":"turn_end","turnIndex":0}
{"hook":"message_end.assistant","stopReason":"stop","hasToolCall":false,"prose":false,"retries":1,"text":"sorry, here is the real answer"}
{"hook":"turn_end","turnIndex":1}
{"hook":"agent_end"}
{"hook":"agent_settled"}
callCount = 2 pending = 0
```
`[VERIFIED: executed 2026-08-13]`

Note what this proves beyond "it works": `agent_end` fires **once**, after turn 1. The retry happens inside the same agent run, so no `agent_settled` gap, no new session entry churn, and `/session` accounting stays coherent.

### 6.4 ALTERNATIVE, works, rejected as default: promote the prose into a real tool call — EXECUTED

Returning `{ message: { ...m, content: [...m.content, { type: "toolCall", id, name, arguments }] } }` from `message_end` makes the agent loop actually execute the tool:
```
{"event":"prose_tool_call","action":"promote_to_toolcall","args":"{\"path\":\"a.txt\"}"}
{"hook":"tool_execution_start","tool":"read","args":{"path":"a.txt"}}
{"hook":"turn_end","turnIndex":0,"toolResults":1}
{"hook":"turn_end","turnIndex":1,"toolResults":0}
{"hook":"agent_end"}
callCount = 2
```
`[VERIFIED: executed 2026-08-13]`

Zero extra model call — genuinely cheaper. **Rejected as the default for three reasons:** (1) it executes a tool with arguments regex-parsed out of prose, on a laptop where merging to `main` auto-deploys, and Phase 4's guard does not exist yet; (2) it rewrites session history to claim the model emitted a tool call it did not, which corrupts the very measurement Phase 10 needs; (3) a wrong parse produces a *silently wrong action* rather than a visible retry. Document it in `docs/DIAGNOSTICS.md` as an available lever for read-only tools once Phase 4 has shipped.

### 6.5 Other options, enumerated with verdicts

| Mechanism | Works? | Verdict |
|---|---|---|
| `sendUserMessage(..., {deliverAs:"followUp"})` from `message_end` | **Yes, executed** | **Recommended.** Same agent run, one extra turn. |
| `sendUserMessage(..., {deliverAs:"steer"})` from `message_end` | Plausible — steering is drained at `agent-loop.ts:259` | Not recommended: steer semantics are "interrupt", and the stream has already finished, so followUp is the honest queue. |
| `message_end` → promote to `toolCall` | **Yes, executed** | Alternative; see §6.4. |
| `sendUserMessage(text)` from `agent_settled` | Yes — `_isAgentRunActive = false` is set *before* the emit (`agent-session.ts:596-600`), so no `deliverAs` needed | Fires later, starts a *new* agent run. Use only as an outside-a-run safety net. |
| `pi.sendMessage({customType,...}, {triggerTurn:true, deliverAs:"followUp"})` | Yes (`types.ts:1302-1305`, `agent-session.ts:1439-1454`) | A custom message is renderable but is a weaker prompt to the model than a user message. |
| `tool_choice:"required"` on the retry | Only via `before_provider_request` payload replacement (§1.2) on the main loop; directly via `options.toolChoice` on the nested path | Worth building as a flag-guarded second handler, but PITFALLS Pitfall 7 note 3 flags it as **UNVERIFIED** whether it reduces the rate. Measure first. |

### 6.6 Guardrails the detector needs

- **Cap retries per turn.** One. A second prose response is a signal, not something to keep paying for; log `prose_tool_call_retry_exhausted` and stop.
- **The false-positive that matters.** "Use `read({...})` to open the file" written *as an explanation to the user* is not a failed tool call. Anchor the regex to registered tool names (`pi.getActiveTools()`), require an immediately-following `{`, and require the message to contain no tool call at all. Then unit-test the negative: a message that merely *mentions* a tool name must not fire.
- **Extension handler exceptions are silently swallowed.** During this research a bad regex in a `message_end` handler produced no visible error anywhere; the failure went to `emitError` and my probe only saw it because I had wrapped the handler in `try/catch` myself (`runner.ts:861-870`). **Every diagnostics handler must have its own `try/catch` that writes to the log**, or the instrument fails silently — which is the exact failure class this phase exists to eliminate.

---

## §7 `/budget` (DIAG-06)

### 7.1 Every input, and whether it is exact or estimated

| Quantity | How | Exact? |
|---|---|---|
| System prompt string | `ctx.getSystemPrompt()` (`types.ts:346`) | **Exact string.** Excludes `context`-hook message edits and `before_provider_request` rewrites `[CITED: docs/extensions.md:1066-1073]`. |
| Context files | `ctx.getSystemPromptOptions().contextFiles: Array<{path, content}>` | **Exact**, and confirmed populated at runtime (`agent-session.ts:1046-1055`). |
| Skills index | `formatSkillsForPrompt(opts.skills)` — **exported** (`pi/src/index.ts:264`, impl `core/skills.ts:335-361`) | **Exact** — reproduces the literal block Pi appends, including the `disableModelInvocation` filter. |
| Tool schemas | `pi.getAllTools()` filtered by `pi.getActiveTools()`; `ToolInfo = Pick<ToolDefinition,"name"\|"description"\|"parameters"\|"promptGuidelines"> & {sourceInfo}` (`types.ts:1575-1577`) | **Exact characters**; the serialisation the provider sees differs slightly per adapter. |
| `cacheRead` vs `input` | `getLastAssistantUsage` (exported, `pi/src/index.ts:44`) or the last DIAG-04 row | Exact — provider-reported. |
| Tokens | `Math.ceil(chars / 4)` | **Estimate only.** See 7.2. |

`getSystemPromptOptions()` lives on `ExtensionCommandContext`, not `ExtensionContext` (`types.ts:1352-1356`) — a second, independent reason `/budget` must be a command, on top of BOOT-10's zero-token rule.

### 7.2 There is no tokenizer. The 4-chars/token heuristic is Pi's own.

Pi's only counter is `estimateTokens(message: AgentMessage)`, which sums content characters and returns `Math.ceil(chars / 4)` `[VERIFIED: pi/src/core/compaction/compaction.ts:266-291]`. It is exported (`pi/src/index.ts:38`) but takes a *message*, not a string, so `/budget` needs its own `Math.ceil(chars/4)` for prompt fragments — the same formula, which is the point.

Neither `@earendil-works/pi-coding-agent` nor `@earendil-works/pi-ai` depends on `tiktoken`, `gpt-tokenizer`, or any tokenizer `[VERIFIED: both `package.json` dependency lists read this session]`. And no tokenizer may be added — see the Package Legitimacy Audit.

**Therefore `/budget` must print characters as the primary figure and tokens as a clearly-labelled ±20% estimate, with the provider-reported `usage.input` from the last turn shown alongside as the ground truth.** ARCHITECTURE.md's Open Questions row already says this; DIAG-06 should ship it as UI, not as a caveat in a doc.

### 7.3 Decomposition without reimplementing the builder

`buildSystemPrompt` is **not** reachable: the package `exports` map has only `.`, `./rpc-entry` and `./client`, and `buildSystemPrompt` is absent from `pi/src/index.ts`. So `/budget` cannot difference the prompt by rebuilding it. Two exact routes remain, and both should be used:

1. **Slice the real string.** The context-file block is delimited by the literal markers `\n\n<project_context>\n\n` … `</project_context>\n` and the skills block starts at `\n\nThe following skills provide specialized instructions` `[VERIFIED: pi/src/core/system-prompt.ts:143-158; core/skills.ts:342-348]`. Locating these inside `ctx.getSystemPrompt()` gives exact character counts for each section and, by subtraction, for Pi's base prompt.
2. **Recompute the skills block** with the exported `formatSkillsForPrompt(opts.skills)` and assert it equals the sliced region. If it ever diverges, Pi changed the format and `/budget` should say so loudly rather than silently mis-report.

### 7.4 The measured number, today, in this repo

```
CLAUDE.md 49404 bytes ~ 12351 tok
```
and from the executed faux session in this repo's tree:
```
FACTORY SAW: ... sysPromptChars= 50881 ...
{"hook":"message_end", "usage":{"input":12725,"output":4,...}}
```
`[VERIFIED: executed 2026-08-13]`

Pi discovers context files by walking up from `cwd`, with candidates `["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]` plus a global file `[VERIFIED: pi/src/core/resource-loader.ts:71, 125-155]`. This repo has no `AGENTS.md`, so `CLAUDE.md` — 97% of the system prompt — is loaded into **every request**.

That is 12,351 tokens per turn before any tool schema, any skill, or any conversation. ARCHITECTURE.md's ~1,850-token floor is not wrong about Pi's defaults; it simply did not count this project's own context file. `/budget`'s first output should make it impossible to miss, and it hands Phase 10's CTX-03 its target number on day one.

---

## §8 `fauxProvider` — the offline harness (all eight DIAG requirements)

### 8.1 Exact API

Import path: `@earendil-works/pi-ai` — `export * from "./providers/faux.ts"` `[VERIFIED: pi-ai src/index.ts:36]`. It is **undocumented**: `grep -rn "faux" docs/*.md` in the shipped Pi docs returns nothing. Everything below is read from source.

```ts
export function fauxProvider(options?: RegisterFauxProviderOptions): FauxProviderHandle;

export interface RegisterFauxProviderOptions {
  api?: string;                       // default: random "faux:<ts>:<rand>"
  provider?: string;                  // default: "faux"
  models?: FauxModelDefinition[];     // default: one "faux-1", 128k ctx, text+image
  deferred?: { pendingFetches?: number; pollAfterMs?: number };
  tokensPerSecond?: number;           // synthetic streaming rate
  tokenSize?: { min?: number; max?: number };
}

export interface FauxModelDefinition {
  id: string; name?: string; reasoning?: boolean;
  input?: ("text"|"image")[];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number; maxTokens?: number;
}

export interface FauxProviderHandle {
  provider: Provider;  api: string;  models: [Model<string>, ...Model<string>[]];
  getModel(): Model<string>;  getModel(modelId: string): Model<string> | undefined;
  state: FauxProviderState;                       // { callCount, deferredFetchCount, cancelledDeferred }
  setResponses: (responses: FauxResponseStep[]) => void;
  appendResponses: (responses: FauxResponseStep[]) => void;
  getPendingResponseCount: () => number;
}

export type FauxResponseStep = AssistantMessage | FauxResponseFactory;
export type FauxResponseFactory = (
  context: Context,                                  // { systemPrompt?, messages, tools? }
  options: SimpleStreamOptions | undefined,          // sessionId, cacheRetention, reasoningEffort, signal, ...
  state: FauxProviderState,
  model: Model<string>,
) => AssistantMessage | Promise<AssistantMessage>;

export function fauxText(text: string): TextContent;
export function fauxThinking(thinking: string): ThinkingContent;
export function fauxToolCall(name: string, arguments_: ToolCall["arguments"], options?: { id?: string }): ToolCall;
export function fauxAssistantMessage(
  content: string | FauxContentBlock | FauxContentBlock[],
  options?: { stopReason?: StopReason; deferred?: DeferredHandle; errorMessage?: string; responseId?: string; timestamp?: number },
): AssistantMessage;   // stopReason defaults to "stop"
```
`[VERIFIED: pi-ai src/providers/faux.ts:39-146, 685-708]`

Auth is a no-op: `auth: { apiKey: { name: "Faux", resolve: async () => ({ auth: {} }) } }` `[VERIFIED: faux.ts:689]` — no key, no network, no `auth.json` entry needed. Register with `pi.registerProvider(faux.provider)` — the single-argument `Provider` overload exists (`types.ts:1416`, dispatching to `registerNativeProvider`, `model-registry.ts:128-136`).

### 8.2 FINDING F1 — `fauxProvider` never calls `onPayload`

`grep -n "onPayload" pi-ai/src/providers/faux.ts` returns **nothing**. The faux stream calls only `onResponse`:
```ts
queueMicrotask(async () => {
    await streamOptions?.onResponse?.({ status: 200, headers: {} }, requestModel);
```
`[VERIFIED: faux.ts:510; also :577 and :641 for the deferred paths]`

Executed confirmation — a live session, an extension logging all three provider hooks, one prompt:
```
{"hook":"before_provider_headers","headers":{}}
{"hook":"after_provider_response","status":200,"headers":{}}
{"hook":"message_end","stopReason":"stop","usage":{"input":12725,"output":10,"cacheRead":0,"cacheWrite":12725,...},"model":"faux-flash","provider":"faux","content":["text"]}
{"hook":"turn_end","turnIndex":0,"toolResults":0}
```
`[VERIFIED: executed 2026-08-13 — `before_provider_request` is absent]`

`before_provider_headers` *does* fire, because `transformHeaders` runs in `ModelRuntime.prepareRequest` before dispatch and is provider-agnostic (§2.2). Its headers are `{}` because faux's auth resolves empty.

**This is the single most plan-shaping finding in this document.** Any DIAG-01 or DIAG-07 test written as "register faux, prompt, assert the captured payload" asserts on a hook that never ran.

### 8.3 The fix — an `onPayload`-emitting wrapper, EXECUTED

```ts
// tests/helpers/faux.ts (Wave 0)
const wrapped: Provider = {
  ...faux.provider,
  streamSimple: (model, context, options) => {
    // Fires onPayload at exactly the point every real adapter does:
    //   openai-completions.ts:237, bedrock-converse-stream.ts:247, anthropic-messages.ts:550
    options?.onPayload?.(buildFixturePayload(model, context, options), model);
    return faux.provider.streamSimple(model, context, options);
  },
  stream: (model, context, options) => {
    options?.onPayload?.(buildFixturePayload(model, context, options), model);
    return faux.provider.stream(model, context, options);
  },
};
```
Executed result with `buildFixturePayload` returning `{model, messages, tools, authorization: "Bearer sk-SECRET-SHOULD-BE-REDACTED"}`:
```
{"hook":"before_provider_headers","headers":{}}
{"hook":"before_provider_request","payloadKeys":["model","messages","tools","authorization"]}
{"hook":"after_provider_response","status":200,"headers":{}}
```
`[VERIFIED: executed 2026-08-13]`

`buildFixturePayload` should return **realistic shapes**, not invented ones: a `ChatCompletionCreateParamsStreaming`-shaped object for the DeepSeek path and a `ConverseStreamCommandInput`-shaped object for the Bedrock path, both transcribed from `openai-completions.ts:626-760` and `bedrock-converse-stream.ts:234-246`. That keeps the offline test honest about *shape* while §12 keeps it honest about not having seen the real thing.

### 8.4 The executed session skeleton (Wave 0 helper)

```ts
// tests/helpers/session.ts — every line below was executed this session
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxText, fauxAssistantMessage } from "@earendil-works/pi-ai";

const faux = fauxProvider({ models: [{ id: "faux-flash", reasoning: true,
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } }] });

const modelRuntime = await ModelRuntime.create({
  authPath: join(agentDir, "auth.json"),   // file need not exist
  modelsPath: null,                        // do not read ~/.pi/agent/models.json
  refreshOnCreate: false,                  // no catalogue refresh
});
modelRuntime.registerNativeProvider(wrapFauxWithPayload(faux));
const model = modelRuntime.getModel(faux.provider.id, "faux-flash")!;

faux.setResponses([
  (context, options, state, m) => {
    // assert on the OUTGOING request here:
    //   context.systemPrompt, context.messages, context.tools,
    //   options?.reasoningEffort, options?.sessionId, options?.cacheRetention, options?.toolChoice,
    //   state.callCount
    return fauxAssistantMessage([fauxText("ok")], { stopReason: "stop" });
  },
]);

const { session } = await createAgentSession({
  cwd, agentDir, model, modelRuntime,
  settingsManager: SettingsManager.inMemory({}, {}),
  sessionManager: SessionManager.inMemory(cwd),
  tools: [],                               // or ["read"] when the test needs a real tool
});
await session.prompt("hello");
```
`[VERIFIED: executed 2026-08-13 — all four probes in this document use exactly this skeleton]`

Notes the planner needs:
- **There is no `InMemoryCredentialStore`.** ARCHITECTURE.md and CONTEXT.md both name one; the real primitives are `ModelRuntime.create({ credentials?: CredentialStore, authPath })` (`model-runtime.ts:68-69, 172-173`) and `AuthStorage.inMemory(data?)` (`core/auth-storage.ts:357`). Neither is needed for faux, whose auth resolves empty. Correct the name in the plan or a task will chase a symbol that does not exist.
- **Load the extension under test at *user* scope** — put it in `<agentDir>/extensions/<name>/index.ts`. Project-scoped `.pi/extensions` are gated behind project trust, which returns `false` with no UI (`core/project-trust.ts`, PITFALLS Pitfall 15). My probes loaded from `agentDir` and needed no trust interaction.
- **`SettingsManager.inMemory(settings, options)` takes two arguments** (`settings-manager.ts:348`); calling it with one is a type error under `strict`.
- **Give `cwd` a temp directory outside the repo** if the test asserts on system-prompt size — otherwise Pi walks up and loads this repo's 49 KB `CLAUDE.md` into every faux request (§7.4). Conversely, a `/budget` test that *wants* a context file should plant its own small one.

### 8.5 What faux does and does not simulate

| Behaviour | Faux | Consequence for the plan |
|---|---|---|
| `onPayload` / `before_provider_request` | **Never** | Use the wrapper (§8.3). |
| `transformHeaders` / `before_provider_headers` | Fires, headers `{}` | Header-redaction tests must inject headers via the wrapper or unit-test the redactor directly. |
| `onResponse` / `after_provider_response` | Always `{status: 200, headers: {}}` (`faux.ts:510`) | A 429 / retry-after test must unit-test the classifier, not drive it through faux. |
| `usage.input/output/cacheRead/cacheWrite` | Synthesised, 4 chars/token, with a real prefix-cache simulation keyed on `options.sessionId` when `cacheRetention !== "none"` (`faux.ts:229-267`) | **Good news for DIAG-06**: `cacheRead` vs `input` is genuinely exercisable offline across two turns of the same `sessionId`. |
| `usage.cost` | **Always all zeros**, overriding the model's `cost` rates (`faux.ts:264`) | `callModel()` must call `calculateCost` (decision 3), or every cost assertion is `0 === 0`. |
| `usage.reasoning` | Never set | Matches Bedrock. Test the *omit-the-key* rule by driving `Usage` objects directly, not through faux. |
| `rawStopReason` | Never set (`fauxAssistantMessage` does not populate it) | The detector must not require `rawStopReason`; treat it as optional enrichment. |
| Tool calls | `fauxToolCall(name, args, {id})` streams properly and the loop executes the tool | Prose-vs-real detection is fully testable both ways. |
| Errors | `fauxAssistantMessage(..., { stopReason: "error", errorMessage })` | `outcome: "error"` rows are testable. |
| Deferred | `deferred: { pendingFetches, pollAfterMs }` (`faux.ts:118-121`) | Out of scope for v1. |
| `tokensPerSecond` / `tokenSize` | Controls synthetic streaming rate | Useful for a mid-stream steering test; not needed here. |

---

## §9 DIAG-03 — making the chokepoint a build failure

### 9.1 What exists in this repo today

`vitest@4.1.9`, `tsc --noEmit`, `git ls-files` via `tests/helpers/git.ts` (`repoRoot()`, `trackedFiles(pattern)`, `isIgnored(path)`). **No ESLint, no ast-grep, no linter of any kind.** `package.json` scripts are exactly `test`, `test:unit`, `typecheck`.

### 9.2 The three options

| Option | Verdict |
|---|---|
| **ESLint `no-restricted-syntax`** | **Structurally blocked.** `tests/unit/pinning.test.ts:253` asserts `Object.keys(devDependencies).sort()` equals exactly the six audited pins; adding `eslint` + `typescript-eslint` + a config package fails that test and requires a Package Legitimacy Audit of each. It also adds ~100 transitive packages to a repo whose Phase 1 thesis is supply-chain minimalism. Correct AST semantics, wrong price. |
| **`tsc`-level trick** (e.g. a branded type or a `@ts-expect-error` wall) | **Cannot express it.** TypeScript has no "this symbol may only be referenced from this directory" construct. A structural hack (re-declaring `ModelRegistry` with `complete` typed `never` outside `diagnostics/`) requires per-directory `tsconfig` projects and a second module-resolution root; it would be fragile against Pi's 2–3-day cadence and unreadable. Rejected. |
| **Source-grep vitest test** | **Recommended.** Zero new dependencies, matches the house pattern already proven in `tests/unit/contributing-boundary.test.ts` (BOOT-10) — same shape: tracked-file enumeration, a named forbidden token, an explicit allowlist requiring written justification, and a vacuous-pass guard. |

### 9.3 Recommended test design

```
File set:  trackedFiles() filtered to /^\.pi\/extensions\/.*\.ts$/
Exempt:    paths under `.pi/extensions/diagnostics/`
Allowlist: CHOKEPOINT_BYPASS_ALLOWLIST: readonly string[] = []   // empty by design
```

Forbidden patterns, applied to code with `//`, `/* */` and template-literal-free stripping *not* applied (see below):

| Pattern | Catches |
|---|---|
| `/\bmodelRegistry\s*(\?\.)?\.\s*complete\b/` | the documented call, incl. optional chaining and whitespace |
| `/\bmodelRegistry\s*(\?\.)?\.\s*completeSimple\b/` | the sibling on `ModelRuntime` |
| `/\bmodelRegistry\s*(\?\.)?\.\s*(stream\|streamSimple)\b/` | the streaming siblings |
| `/\bmodelRegistry\s*(\?\.)?\.\s*getProvider\b/` and `/getRegisteredNativeProvider/` | acquiring a raw `Provider`, whose `.stream()` bypasses everything (§4.5) |
| `/from\s+["']@earendil-works\/pi-ai\/api\//` | deep-importing an adapter's `stream` |
| `/\bModelRuntime\b/` | importing the runtime class directly (`pi/src/index.ts:184`) |

**Not banned:** `modelRegistry.find`, `.getAvailable`, `.getAll`, `.hasConfiguredAuth`, `.getProviderAuthStatus`, `.registerProvider` — Phase 5's capability guard needs all of them. Banning the whole `modelRegistry` substring would force Phase 5 to gut the allowlist, and an allowlist everyone edits is not a control.

**Avoiding the three false positives:**
1. **The chokepoint's own call site** — excluded by directory, not by allowlist, so `diagnostics/call-model.ts` never needs an entry.
2. **Comments and docs** — the test scans `.pi/extensions/**/*.ts` only. `docs/DIAGNOSTICS.md` and `CONTRIBUTING.md` may discuss the call freely. **But** BOOT-10's test taught the opposite lesson: a plain substring also matches prose *inside* an extension file, which is why `harness/index.ts` says "the tool-registration call" instead of naming it. Keep the same discipline: extension comments must not spell `modelRegistry.complete`, and the test's own header should say so.
3. **Test fixtures** — `tests/**` is outside the scanned set entirely.

**Vacuous-pass guard (mandatory, per the Phase 1 lesson):** assert the scanned file set is non-empty *and* that the regex set genuinely matches by running it against an inline positive fixture string. Phase 1 tripped this failure twice (`git check-ignore` without `--no-index`; an npm probe reading its launcher's env). A grep test that scans zero files is a green run that verified nothing.

**Second half — prove the positive.** DIAG-02 says "all model invocations route through `callModel()`". The lint proves nobody *else* calls `complete`; it does not prove `callModel` exists and works. Pair it with a behavioural test: call `callModel()` against the wrapped faux provider and assert a `kind:"nested"` row landed in the turns log with `role`, `usage` and non-zero `cost`.

### 9.4 Honest limits (state these in `docs/DIAGNOSTICS.md`)

Not caught: string-built property access (`ctx["model" + "Registry"]`), a destructured-then-renamed registry, `eval`, a bypass introduced by a *composed third-party* extension (Phase 7 — these are not under `.pi/extensions/`), and `pi.registerProvider` with a custom `streamSimple` that calls a real model directly. The last one is the realistic future gap, because ARCHITECTURE.md keeps the virtual provider as a documented escape hatch.

---

## §10 Log writing and rotation (DIAG-08, DIAG-07)

### 10.1 Pi provides no log helper

There is no logging API on `ExtensionAPI` or `ExtensionContext`, and no exported append helper. Pi's own session persistence uses bare `node:fs`:
```ts
appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
```
`[VERIFIED: pi/src/core/session-manager.ts:1021, :1040, :1625]`

Pi's reference wire-logging example does the same: `appendFileSync(logFile, ..., "utf8")` into `join(ctx.cwd, CONFIG_DIR_NAME, "provider-payload.log")` `[CITED: examples/extensions/provider-payload.ts:8]`. Use `CONFIG_DIR_NAME` (exported, `pi/src/index.ts:7`) rather than a hardcoded `.pi`, and `node:path.join` rather than string concatenation — Windows rule from CLAUDE.md.

### 10.2 `withFileMutationQueue` does not help here

It is exported (`pi/src/index.ts:322`) but its state is a **module-level `Map` in one process** (`core/tools/file-mutation-queue.ts:4`). Subagents are separate child `pi` processes, so it serialises nothing across them. Its real purpose is stopping our writes racing the built-in `edit`/`write` tools on the same path — irrelevant for a log nothing else touches.

### 10.3 EXECUTED: concurrent appends are safe, and rename is not blocked

```
recordSize~8000B:   lines=800 expected=800 unparseable=0
recordSize~65000B:  lines=800 expected=800 unparseable=0
recordSize~200000B: lines=800 expected=800 unparseable=0
```
(4 concurrent Node processes × 200 records each, single shared file, `appendFileSync`)

```
lines 6000 expected 6000 unparseable 0 {"A":1500,"B":1500,"C":1500,"D":1500}
```
(4 processes × 1500 records of ~950 B)

```
CASE1 no-handle rename: OK
CASE2 open-handle rename: OK               (same process holding an "a" fd)
XPROC rename with child handle open: OK    (child process holding an "a" fd)
```
`[VERIFIED: all executed 2026-08-13, win32, node v24.16.0]`

So on Windows: `appendFileSync` is atomic against other appenders at every record size tested, and `renameSync` is not blocked by an open handle in this process or another. **Rename-based rotation of a single shared file is viable and needs no lock file and no per-process fragmentation.**

Two caveats to record rather than hide: (a) this was executed on Windows only — the macOS leg is CI's job (BOOT-07, itself still OUTSTANDING), and POSIX `O_APPEND` atomicity for very large single writes is not formally guaranteed; (b) a writer that holds an fd across the rename keeps writing into the *rotated* file. With `appendFileSync` — which opens, writes and closes per call — that window is one write, which is acceptable. **Never use `createWriteStream` for these logs.**

### 10.4 Redaction: nothing to reuse

`grep -rn "function redact\|redactSecret\|maskSecret\|REDACTED"` across all of `pi/src` and `pi-ai/src` returns **nothing**. `pi-ai/src/utils/diagnostics.ts` is described as producing "redacted" diagnostics but contains no redaction logic — it just shapes `Error` objects. And no third-party redaction dependency may be added (Package Legitimacy Audit below). The matcher is hand-rolled, deliberately small, and must be unit-tested in both directions (§1.3).

### 10.5 Recommended concrete policy

```
.pi/logs/wire-YYYY-MM-DD.jsonl        full request/response, redacted at capture
.pi/logs/wire-YYYY-MM-DD.1.jsonl      rotated (increasing N = older)
.pi/logs/turns-YYYY-MM-DD.jsonl       one row per turn AND per nested call
.pi/logs/turns-YYYY-MM-DD.1.jsonl
```

| Knob | Value | Why this number |
|---|---|---|
| Rotate `wire-*` at | **32 MB** | A single payload here is ~50 KB (measured §7.4). 32 MB ≈ 600 turns — about a heavy day — and stays comfortably openable in an editor. |
| Rotate `turns-*` at | **8 MB** | Rows are ~600 B, so 8 MB ≈ 14,000 turns. |
| Keep per stream | **10 rotated files** | Bounds a bad day at ~320 MB wire / ~80 MB turns. |
| Retention | **14 days** | Long enough to answer "was DeepSeek worse last week?"; short enough that a public-repo working tree never accumulates months of prompt bodies. |
| Prune when | **`session_start`**, plus opportunistically after any rotation | Cheap, deterministic, off the hot path. |
| Size check | `statSync(file).size` before each append, cached and re-`stat`ed at most once per second | A `stat` per append at DeepSeek turn rates is free; caching keeps it free at subagent fan-out. |

`.gitignore` already covers `.pi/logs/`, `logs/`, `*.log` and a blanket `*.jsonl`. The **deliverable is the test**, in the `tests/unit/gitignore-policy.test.ts` house pattern, using `git check-ignore --no-index` (the `--no-index` lesson from Phase 1 — the index masks ignore rules for tracked paths and would make the assertion vacuous).

### 10.6 The `*.jsonl` gitignore trap

`.gitignore:26` is a blanket `*.jsonl`. That is exactly right for DIAG-07 and exactly wrong for a *committed* fixture: a `tests/fixtures/wire-sample.jsonl` would be silently untracked, so CI would run against a file that does not exist there. Keep committed fixtures inline in the test file, or name them `*.jsonl.txt`. A one-line assertion in the DIAG-07 test — that every fixture path the test reads is tracked — makes this failure loud instead of silent.

---

## §11 What Pi 0.84.1 already ships (do not rebuild)

| Capability | Ships? | What it gives / what is missing |
|---|---|---|
| `/session` | **Yes** — `BUILTIN_SLASH_COMMANDS` (`core/slash-commands.ts:28`), handler `interactive-mode.ts:5992` | `SessionStats = { sessionFile, sessionId, userMessages, assistantMessages, toolCalls, toolResults, totalMessages, tokens:{input,output,cacheRead,cacheWrite,total}, cost, contextUsage? }` (`agent-session.ts:262-279`). **Session-cumulative only.** No per-turn row, no latency, no per-model/provider split, no cache-read ratio, no outcome, no nested-call attribution, nothing on disk. DIAG-04 is genuinely missing. |
| A `/cost` or `/usage` command | **No** — the built-in list is 22 commands and contains neither | — |
| A `/budget` command | **No** | DIAG-06 is genuinely missing. |
| Wire-dump env var or CLI flag | **No.** The complete `PI_*` set is `PI_CODING_AGENT`, `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`, `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `PI_PACKAGE_DIR`, `PI_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_TELEMETRY`, `PI_CACHE_RETENTION`, `PI_SHARE_VIEWER_URL`, `PI_HARDWARE_CURSOR` `[CITED: docs/environment-variables.md:21-84]`. CLI flags: no `--log`, no `--debug`, no `--trace` `[CITED: docs/usage.md:173-249]` | DIAG-01 is genuinely missing. |
| Session JSONL | **Yes** — `SessionManager` writes every message to `.pi/sessions/*.jsonl` | Full transcript, but **not** the provider payload, not headers, not latency, not per-turn cost. Useful as a cross-check, not a substitute. |
| Telemetry / spans | **Contract only.** `@earendil-works/pi-telemetry` ships `TelemetryContext`/`TelemetrySpan` and `ProviderRequestOptions.telemetryContext` exists (`pi-ai src/types.ts:123`), **but `grep -rn "startSpan" pi-ai/src` returns nothing** — no adapter emits a span. `@opentelemetry/api` is a dependency of pi-ai with no producer in the model path. | Nothing to reuse. Do not build on it; it may become the right integration point in a later Pi version. |
| Reference wire-logger | **Yes** — `examples/extensions/provider-payload.ts`, 15 lines, both payload and response hooks | **This is the starting point for `diagnostics/wire.ts`.** It has no redaction, no rotation, and no nested-call coverage — which is precisely the delta this phase adds. EXT-06 says prefer Pi's bundled examples; this is the one that applies. |
| A redaction helper | **No** (§10.4) | Hand-roll. |
| A tokenizer | **No** (§7.2) | 4 chars/token, labelled as an estimate. |
| Log rotation | **No** | Hand-roll (§10.5). |

---

## §12 The [RUNBOOK] split for DIAG-01 and DIAG-05

Both carry `[FAUX]` **and** `[RUNBOOK]`. Neither may ever be reported as passing. The line between the halves is now precise.

### DIAG-01 — wire capture

| Half | Verifiable offline? | Evidence |
|---|---|---|
| The three handlers are registered and fire in order | **Yes** — executed §8.3 with the wrapper | vitest: log lines in the order headers → request → response |
| The capture handler returns `undefined` (does not replace the payload) | **Yes** | vitest: assert handler return is `undefined`; assert the faux factory's `context` is unchanged |
| Redaction removes each secret pattern; and leaves a clean payload byte-identical | **Yes** | vitest over fixture payloads, both directions |
| Dumps land only under `.pi/logs/` and every such path is gitignored | **Yes** | `git check-ignore --no-index` over the produced paths |
| Header capture on the nested path (`transformHeaders` via `callModel`) | **Yes** — executed §4.4 | vitest |
| **That the real DeepSeek/DashScope/Bedrock payload has the shape our fixtures assume** | **No** | `RB-02-01` |
| **That `reasoning_effort` / `thinking` / `enable_thinking` actually appear on the wire for the daily driver** — the Carried-Forward Unknown this whole phase exists to answer | **No** | `RB-02-01` |
| **That no real `Authorization` / SigV4 value survives into a dump** | **No** — faux headers are `{}` | `RB-02-02` |

Proposed runbook entries, in the existing `docs/RUNBOOK.md` format (exact command, expected output, offline proxy, status):

- **RB-02-01 — DIAG-01: one real turn per provider produces a wire dump showing the thinking parameters.** Command: run one turn against DeepSeek-direct and one against Bedrock Claude, then `tail -n 1 .pi/logs/wire-$(date +%F).jsonl | python -m json.tool`. Expected: for DeepSeek, a `thinking: {"type":"enabled"}` object **and** a sibling top-level `reasoning_effort` (PITFALLS Pitfall 3 says Pi is correct here — this confirms it once and closes it); for Bedrock Claude, a non-`undefined` `additionalModelRequestFields` (PITFALLS Pitfall 1). Offline proxy: `tests/unit/wire-capture.test.ts`. **Status: OUTSTANDING.**
- **RB-02-02 — DIAG-07: no live credential appears in any dump.** Command: after RB-02-01, `grep -rIEn 'sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|Bearer [A-Za-z0-9._-]{20,}|BEGIN [A-Z ]*PRIVATE KEY' .pi/logs/`. Expected: no matches; and every `authorization`-shaped key renders as `[redacted:N chars]`. Offline proxy: `tests/unit/redact.test.ts`. **Status: OUTSTANDING.**

### DIAG-05 — prose-tool-call detector

| Half | Verifiable offline? | Evidence |
|---|---|---|
| Detector fires on a scripted prose message | **Yes** — executed §6.3 | vitest |
| Detector does **not** fire when a real `toolCall` is present, or on a message that merely mentions a tool name | **Yes** | vitest (both negatives are mandatory) |
| The row is written as `event: prose_tool_call` | **Yes** | vitest over the produced JSONL |
| A retry actually happens and the model is called a second time in the same run | **Yes** — executed §6.3: `callCount = 2`, one `agent_end` | vitest asserting `faux.state.callCount === 2` |
| The retry is capped at one | **Yes** | vitest with three scripted prose responses |
| **That the detector fires on real DeepSeek traffic, and at what rate** | **No** | `RB-02-03` |
| **That the retry recovers the turn on a real model rather than producing more prose** | **No** | `RB-02-03` |

- **RB-02-03 — DIAG-05: the detector has fired on real DeepSeek V4 Flash traffic.** Command: after a working day, `grep -c '"event":"prose_tool_call"' .pi/logs/turns-*.jsonl` and `grep -c '"kind":"turn"' .pi/logs/turns-*.jsonl`. Expected: a ratio to compare against the 11% baseline in DeepSeek-V3 issue #1244; and at least one recorded instance where the following turn contains a real `toolCall`. Offline proxy: `tests/unit/prose-detector.test.ts`. **Status: OUTSTANDING.**

The Phase 2 section of `docs/RUNBOOK.md` must also carry the summary table row **and** the detail subsection for each — `tests/unit/docs-policy.test.ts` parses both and returns `INCONSISTENT` if they disagree.

---

## Architecture Patterns

### System architecture

```
                       ┌──────────────────────────── MAIN AGENT LOOP ────────────────────────────┐
 user prompt ─────────►│                                                                          │
                       │  turn_start ──► context ──► before_provider_headers ──► before_provider_ │
                       │                    │                   │                 request         │
                       │                    │                   │                   │             │
                       │                    │            [capture headers]   [capture payload,    │
                       │                    │             redact, append]     redact, append;     │
                       │                    │                   │             MUST return undef]  │
                       │                    │                   ▼                   ▼             │
                       │                    │            ═══════ HTTP to provider ═══════         │
                       │                    │                   │                                 │
                       │        after_provider_response ◄───────┘   (status+headers only;         │
                       │                    │                        NEVER fires on error)        │
                       │                    ▼                                                     │
                       │              message_end ──► [prose detector]                            │
                       │                    │            │                                        │
                       │                    │            ├─ fires ─► append {event:prose_tool_call}│
                       │                    │            │            └─► pi.sendUserMessage(...,  │
                       │                    │            │                 {deliverAs:"followUp"}) │
                       │                    │            │                 ══► loop resumes at     │
                       │                    │            │                     agent-loop.ts:262   │
                       │                    ▼                                                     │
                       │               turn_end ──► [compose row] ──► turns-<date>.jsonl           │
                       └──────────────────────────────────────────────────────────────────────────┘

   ┌──────────── NESTED CALLS (advisor / reviewer / classifier / summariser) ─────────────┐
   │  caller ──► diagnostics/call-model.ts  callModel(ctx, {role, model, messages, ...})   │
   │                        │                                                              │
   │                        ├─ transformHeaders ─► [capture headers, redact, append]       │
   │                        ├─ onPayload        ─► [capture payload, redact, append;       │
   │                        │                        MUST return undefined]                │
   │                        ├─ onResponse       ─► [capture status]                        │
   │                        ▼                                                              │
   │              ctx.modelRegistry.complete(model, context, options)                      │
   │                        │   (fires ZERO extension hooks — proven §4.4)                 │
   │                        ▼                                                              │
   │              calculateCost(model, usage) ──► append {kind:"nested", role, ...}        │
   └───────────────────────────────────────────────────────────────────────────────────────┘

   /budget  (COMMAND — ExtensionCommandContext only, zero per-turn tokens)
        ctx.getSystemPrompt()            → exact system-prompt chars, sliced into sections
        ctx.getSystemPromptOptions()     → contextFiles[], skills[]
        formatSkillsForPrompt(skills)    → exact skills-index block
        pi.getAllTools() ∩ getActiveTools() → tool description + JSON-schema chars
        last turns-row / getLastAssistantUsage() → cacheRead vs input (ground truth)

   diagnostics/jsonl.ts   appendFileSync only (never createWriteStream)
        size check → renameSync to <base>.N.jsonl → prune on session_start
```

### Recommended module structure

```
.pi/extensions/diagnostics/
├── index.ts          # registers the 5 hooks + /budget; every handler wrapped in try/catch
├── call-model.ts     # THE exported chokepoint. The only file allowed to name complete()
├── wire.ts           # payload/header/response capture; the redact→append pipeline
├── redact.ts         # key-name matcher + secret-shaped value matcher; pure, unit-testable
├── turns.ts          # per-turn row composition from turn_start/message_end/turn_end
├── prose.ts          # prose-tool-call detector + the capped follow-up retry; pure predicate + effect
├── jsonl.ts          # appendFileSync, size-based rotation, retention prune
└── schema.ts         # the row types, imported by docs/DIAGNOSTICS.md's generator and by tests
docs/DIAGNOSTICS.md   # JSONL schema reference + known limits (§4.5, §9.4, §2.4 Bedrock gap)
tests/helpers/faux.ts # wrapFauxWithPayload() + in-memory createAgentSession factory (Wave 0)
```

`redact.ts` and `prose.ts` must be **pure predicate + separate effect**, so the interesting half is unit-testable without a session at all. That is where most of the DIAG test mass should live; the session tests then prove wiring, not logic.

### Pattern: capture handler shape

```ts
// Source: adapted from examples/extensions/provider-payload.ts (Pi 0.84.1 bundled example)
pi.on("before_provider_request", (event, ctx) => {
  try {
    appendJsonl(wirePath(ctx), { kind: "main.request", payload: redact(event.payload) });
  } catch (err) {
    appendJsonl(wirePath(ctx), { kind: "diagnostics.error", where: "before_provider_request", err: String(err) });
  }
  // NO return. A non-undefined return REPLACES the payload (runner.ts:1031-1033).
});
```

### Anti-patterns to avoid

- **An arrow function with an expression body on `before_provider_request`.** Returns the log function's value and silently replaces every request payload.
- **A handler with no `try/catch`.** Exceptions go to `emitError` and vanish (observed live, §6.6). The instrument must not be able to fail silently.
- **`createWriteStream` for the logs.** Holds an fd across rotation; §10.3's rename safety depends on open-write-close.
- **Deriving `outcome` or usage from `after_provider_response`.** It never fires on error (§3.2).
- **A `reasoning: 0` column on Bedrock rows.** A fabricated measurement; locked decision 6.
- **Asserting cost through faux without `calculateCost`.** `0 === 0` (§8.5).
- **A key-name-only redactor.** Misses the real hazard — secret-shaped values inside `messages[]` (§1.3).
- **Committing a `.jsonl` test fixture.** Blanket-ignored (§10.6).

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Per-model cost from token counts | A rates table + multiplication | `calculateCost(model, usage)` from `@earendil-works/pi-ai` | Handles `cost.tiers` (whole-request tier selection above `inputTokensAbove`) and Anthropic's 2× 1-hour cache-write rule. `models.ts:878-898`. |
| Rendering the skills index for token counting | Re-implementing the XML block | `formatSkillsForPrompt(skills)` from `@earendil-works/pi-coding-agent` | Exported (`index.ts:264`) and includes the `disableModelInvocation` filter you would forget. |
| A context-token estimate for the status line | Summing message characters | `ctx.getContextUsage()` / exported `estimateTokens` | Already handles the post-compaction "unknown" case that a naive sum gets wrong. |
| An offline model for tests | A hand-written stub `Provider` | `fauxProvider()` | Real streaming events, tool-call streaming, a prefix-cache simulation, deferred responses, and `state.callCount`. Wrap it for `onPayload` (§8.3) rather than replacing it. |
| An in-memory session for tests | Temp-dir scaffolding | `SessionManager.inMemory()` + `SettingsManager.inMemory()` + `ModelRuntime.create({modelsPath:null, refreshOnCreate:false})` | Executed §8.4. No disk, no network, no credentials. |
| Cross-process log serialisation | A lock file, `proper-lockfile`, per-process files | `appendFileSync` | Executed §10.3: atomic across 4 processes at 200 KB records. Adding a dependency also breaks the six-devDependency pin. |
| A wire logger from scratch | — | Start from `examples/extensions/provider-payload.ts` | EXT-06: prefer Pi's bundled examples. 15 lines; add redaction, rotation and the nested path. |
| **Redaction** | — | **Nothing exists — hand-roll it** (§10.4) | Stated explicitly so nobody spends an hour looking. Keep it ~60 lines, pure, and tested in both directions. |
| **A tokenizer** | — | **Nothing exists — use `Math.ceil(chars/4)` and label it** (§7.2) | Pi's own estimator uses the same formula. Show provider-reported `usage.input` as the ground truth beside it. |

---

## Common Pitfalls

### Pitfall 1: Writing DIAG-01/DIAG-07 tests against a plain `fauxProvider`
**What goes wrong:** `before_provider_request` never fires; the test asserts on an empty capture list and passes because the assertion was written as "no unredacted secrets found".
**Why:** `fauxProvider` calls `onResponse` but never `onPayload` (faux.ts:510; executed §8.2).
**Avoid:** Build `tests/helpers/faux.ts` with the payload-emitting wrapper in Wave 0, and make every capture test assert `captured.length > 0` before asserting anything about content.
**Warning sign:** A DIAG-01 test that passes when you comment out the `before_provider_request` registration.

### Pitfall 2: A capture handler that silently rewrites every request
**What goes wrong:** Every provider request is replaced by whatever the logging call returned.
**Why:** `runner.ts:1031-1033` treats any non-`undefined` return as a replacement.
**Avoid:** Block-bodied handlers; a unit test asserting the handler returns `undefined`; an integration test asserting the faux factory sees the unmodified `context`.
**Warning sign:** A model erroring with "invalid request body" immediately after the diagnostics extension loads.

### Pitfall 3: Building the JSONL row from `after_provider_response`
**What goes wrong:** Failed turns produce no row — the exact turns you most need recorded.
**Why:** `onResponse` is called after the awaited request; a 4xx/5xx throws past it (openai-completions.ts:239 vs :590).
**Avoid:** `message_end` + `turn_end` are the row's spine; `after_provider_response` contributes an optional `httpStatus` only.
**Warning sign:** Zero rows with `outcome: "error"` after a day where you saw errors on screen.

### Pitfall 4: A `reasoning: 0` column on Bedrock
**What goes wrong:** A cost dashboard reports Bedrock thinking as free.
**Why:** `handleMetadata` never assigns `usage.reasoning` (bedrock-converse-stream.ts:589-602).
**Avoid:** Omit the key when `undefined`; say so in `docs/DIAGNOSTICS.md`.

### Pitfall 5: A silently-dead diagnostics extension
**What goes wrong:** A throw inside any handler is caught by `emitError` and produces no visible output; the log simply stops.
**Why:** `runner.ts:861-870` — observed live during this research (a bad regex produced no error anywhere until I added my own `try/catch`).
**Avoid:** Wrap every handler; on catch, append a `diagnostics.error` row. Add a self-test: `/budget` reports the number of rows written this session, so "0 rows" is visible rather than inferred.

### Pitfall 6: The prose detector firing on prose *about* tools
**What goes wrong:** Every explanatory message triggers a retry; cost doubles and the measured "prose tool call rate" is fiction — which then corrupts Phase 10's root-cause discrimination.
**Avoid:** Anchor to `pi.getActiveTools()` names; require `name` immediately followed by `{`; require zero real tool calls in the message; cap retries at one; unit-test the negative case explicitly.

### Pitfall 7: Assuming the wire dump contains the Bedrock credential
**What goes wrong:** RB-02-02 is written to look for a SigV4 signature that can never appear, "passes", and the redactor's Bedrock path is never actually exercised.
**Why:** SigV4 is applied by Smithy middleware after Pi hands over headers, and `x-amz-*`/`authorization`/`host` are explicitly ignored on that path (pi-ai types.ts:148-153).
**Avoid:** State the gap in `docs/DIAGNOSTICS.md`; write RB-02-02 around the DeepSeek/DashScope path where a bearer token genuinely does pass through.

### Pitfall 8: A vacuous DIAG-03 grep
**What goes wrong:** The scanned file set is empty (wrong glob, or `trackedFiles` filtered to nothing) and the test is permanently green.
**Why:** Phase 1 hit this class twice.
**Avoid:** Assert the file set is non-empty; assert the regex set matches an inline positive fixture; keep the allowlist empty with a written policy for extending it.

### Pitfall 9: Measuring `/budget` from inside this repo and drawing the wrong conclusion
**What goes wrong:** A test asserts "system prompt < 5,000 chars" and fails on every machine, because Pi walks up and loads this repo's 49 KB `CLAUDE.md`.
**Avoid:** `/budget` unit tests run with `cwd` set to a temp directory with a planted, known context file. The *real* number belongs in an integration test that asserts the decomposition sums correctly, not that it is below a threshold.

---

## Code Examples

### Nested call through the chokepoint, with all three captures

```ts
// diagnostics/call-model.ts
// Sources: model-registry.ts:101-107 (signature), models.ts:78-83 (transformHeaders),
//          pi-ai types.ts:141-145 (onPayload/onResponse), models.ts:878 (calculateCost)
import { calculateCost, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";

export async function callModel<TApi extends Api>(ctx: ExtensionContext, opts: CallModelOptions<TApi>) {
  const started = Date.now();
  const corr = nextCorrelationId(ctx);
  let status: number | undefined;

  const res: AssistantMessage = await ctx.modelRegistry.complete(
    opts.model,
    { systemPrompt: opts.systemPrompt, messages: opts.messages, tools: opts.tools },
    {
      ...(opts.api ?? {}),
      signal: opts.signal ?? ctx.signal,
      sessionId: ctx.sessionManager.getSessionId(),
      transformHeaders: (h) => { wire(ctx, { corr, kind: "nested.headers", role: opts.role, headers: redactHeaders(h) }); return h; },
      onPayload: (p) => { wire(ctx, { corr, kind: "nested.request", role: opts.role, payload: redact(p) }); return undefined; },
      onResponse: (r) => { status = r.status; wire(ctx, { corr, kind: "nested.response", role: opts.role, status: r.status, headers: r.headers }); },
    } as ModelsApiStreamOptions<TApi>,
  );

  calculateCost(opts.model, res.usage);   // faux returns zeros; real adapters already did this. Idempotent.
  appendTurnRow(ctx, rowFromMessage(res, { corr, kind: "nested", role: opts.role, latencyMs: Date.now() - started, httpStatus: status }));
  return res;
}
```

### Prose detector + capped retry (executed shape, §6.3)

```ts
// diagnostics/prose.ts — pure predicate
export function isProseToolCall(m: AssistantMessage, activeToolNames: readonly string[]): boolean {
  if (m.stopReason !== "stop") return false;
  if (m.content.some((c) => c.type === "toolCall")) return false;
  if (activeToolNames.length === 0) return false;
  const text = m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const names = activeToolNames.map(escapeRegExp).join("|");
  return new RegExp(`\\b(${names})\\s*\\(\\s*\\{`).test(text);
}

// diagnostics/index.ts — the effect
pi.on("message_end", (event, ctx) => {
  try {
    if (event.message.role !== "assistant") return;
    if (!isProseToolCall(event.message, pi.getActiveTools())) return;
    appendTurnRow(ctx, { event: "prose_tool_call", ... });
    if (retriesThisRun >= MAX_PROSE_RETRIES) { appendTurnRow(ctx, { event: "prose_tool_call_retry_exhausted" }); return; }
    retriesThisRun++;
    // agent is streaming inside message_end (isIdle() === false), so deliverAs is MANDATORY.
    // Resumes the SAME run at agent-loop.ts:262-268 — no new agent_end in between.
    pi.sendUserMessage(
      "Your previous message described a tool call in prose instead of emitting one. Re-issue it as a real tool call.",
      { deliverAs: "followUp" },
    );
  } catch (err) { appendTurnRow(ctx, { event: "diagnostics.error", where: "message_end", err: String(err) }); }
});
pi.on("agent_start", () => { retriesThisRun = 0; });
```

### `/budget` skeleton

```ts
// Sources: types.ts:346/1352-1356 (ctx), index.ts:264 (formatSkillsForPrompt),
//          types.ts:1575 (ToolInfo.parameters), system-prompt.ts:143-158 + skills.ts:342 (markers)
pi.registerCommand("budget", {
  description: "Per-turn token budget: system prompt, tool schemas, context files, skills, cache",
  handler: async (_args, ctx) => {
    const prompt = ctx.getSystemPrompt();                       // exact
    const opts = ctx.getSystemPromptOptions();                  // command context only
    const skillsBlock = formatSkillsForPrompt(opts.skills ?? []);
    const ctxFilesChars = (opts.contextFiles ?? []).reduce((n, f) => n + f.path.length + f.content.length + 60, 0);
    const active = new Set(pi.getActiveTools());
    const schemaChars = pi.getAllTools().filter((t) => active.has(t.name))
      .reduce((n, t) => n + t.name.length + t.description.length + JSON.stringify(t.parameters).length, 0);
    const last = getLastAssistantUsage(ctx.sessionManager.getBranch());   // exported
    // tok() is Math.ceil(chars/4) — the same heuristic Pi uses (compaction.ts:274). Label it as an estimate.
    // Show last.input / last.cacheRead beside it as provider-reported ground truth.
  },
});
```

---

## Runtime State Inventory

Not applicable — Phase 2 is greenfield code inside an existing repo shape. It renames nothing, migrates nothing, and registers no OS-level state. It does *create* a new runtime-state path, `.pi/logs/`, which `.gitignore:80` already covers; the deliverable is the test that proves it (DIAG-07).

---

## Validation Architecture

Nyquist validation is enabled (`.planning/config.json` → `workflow.nyquist_validation: true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@4.1.9` (exact pin, matches Pi core) |
| Config file | `vitest.config.ts` — `environment: "node"`, `include: ["tests/**/*.test.ts"]`, `testTimeout: 120_000`, `passWithNoTests: false` |
| Quick run command | `npm run test:unit` (`vitest run tests/unit`) |
| Full suite command | `npm test` (`vitest run`) + `npm run typecheck` (`tsc --noEmit`) |
| Existing baseline | 248 tests green, `tsc` clean (Phase 1) |

### Phase Requirements → Test Map

| Req ID | Behaviour observed | Test type | Automated command | File exists? |
|--------|-------------------|-----------|-------------------|--------------|
| DIAG-01 | All three provider hooks fire, in order headers→request→response, on a live in-memory session | integration | `npx vitest run tests/integration/wire-capture.test.ts` | ❌ Wave 1 |
| DIAG-01 | The capture handler returns `undefined`, so the payload the provider receives is byte-identical to the one built | unit | `npx vitest run tests/unit/wire-nonmutating.test.ts` | ❌ Wave 1 |
| DIAG-01 | *(live half)* Real DeepSeek + Bedrock payloads carry the thinking parameters | **manual** | `RB-02-01` in `docs/RUNBOOK.md` | ❌ Wave 4 — **OUTSTANDING, never "passed"** |
| DIAG-02 | `callModel()` produces a `kind:"nested"` row with `role`, `usage`, non-zero `cost`, and captured payload + headers + status | integration | `npx vitest run tests/integration/call-model.test.ts` | ❌ Wave 2 |
| DIAG-02 | A bare `modelRegistry.complete()` produces **no** extension-hook capture — the negative control that makes the chokepoint meaningful | integration | same file | ❌ Wave 2 |
| DIAG-03 | The grep fails on a synthetic offending file and passes on the real tree; the scanned set is non-empty; the allowlist is empty | unit | `npx vitest run tests/unit/chokepoint-lint.test.ts` | ❌ Wave 2 |
| DIAG-04 | One turn → exactly one `kind:"turn"` row with every field in §5.5 populated from the right source | integration | `npx vitest run tests/integration/turns-log.test.ts` | ❌ Wave 2 |
| DIAG-04 | `reasoning` key is **omitted** when `usage.reasoning === undefined` and present when it is a number | unit | `npx vitest run tests/unit/turn-row.test.ts` | ❌ Wave 2 |
| DIAG-04 | `outcome` maps correctly for `stop` / `toolUse` / `length` / `error` / `aborted`; an error turn still produces a row | integration | `tests/integration/turns-log.test.ts` (faux `stopReason: "error"`) | ❌ Wave 2 |
| DIAG-05 | Detector fires on scripted prose; does **not** fire on a real `toolCall`; does **not** fire on a mention without `{` | unit | `npx vitest run tests/unit/prose-detector.test.ts` | ❌ Wave 3 |
| DIAG-05 | A retry actually occurs: `faux.state.callCount === 2` after one prose response, within a single `agent_end` | integration | `npx vitest run tests/integration/prose-retry.test.ts` | ❌ Wave 3 |
| DIAG-05 | Retry is capped: three scripted prose responses yield exactly one retry plus a `prose_tool_call_retry_exhausted` row | integration | same file | ❌ Wave 3 |
| DIAG-05 | *(live half)* The detector has fired on real DeepSeek traffic, with a recorded rate | **manual** | `RB-02-03` | ❌ Wave 4 — **OUTSTANDING** |
| DIAG-06 | `/budget` sections sum to `ctx.getSystemPrompt().length`; the skills slice equals `formatSkillsForPrompt(opts.skills)` | integration | `npx vitest run tests/integration/budget.test.ts` | ❌ Wave 3 |
| DIAG-06 | `cacheRead` vs `input` is reported across two turns of the same `sessionId` (faux simulates the prefix cache) | integration | same file | ❌ Wave 3 |
| DIAG-06 | `/budget` is registered as a **command**, and `diagnostics/` registers **no tool** — BOOT-10 stays green | unit | existing `tests/unit/contributing-boundary.test.ts` (must keep passing) | ✅ exists |
| DIAG-07 | Each secret pattern is redacted; a clean payload is returned byte-identical (negative control) | unit | `npx vitest run tests/unit/redact.test.ts` | ❌ Wave 1 |
| DIAG-07 | Redaction happens before the write: the on-disk bytes never contain the plaintext, asserted by reading the file | integration | `npx vitest run tests/integration/wire-capture.test.ts` | ❌ Wave 1 |
| DIAG-07 | Every path the writer produces is gitignored — `git check-ignore --no-index` over the real produced paths | unit | `npx vitest run tests/unit/logs-gitignored.test.ts` | ❌ Wave 1 |
| DIAG-07 | *(live half)* No live credential in a real dump | **manual** | `RB-02-02` | ❌ Wave 4 — **OUTSTANDING** |
| DIAG-08 | Exceeding the size cap renames to `<base>.1.jsonl` and starts a fresh file; content is not lost | unit | `npx vitest run tests/unit/jsonl-rotation.test.ts` | ❌ Wave 1 |
| DIAG-08 | Retention prune keeps ≤10 rotated files and ≤14 days, deleting oldest first | unit | same file | ❌ Wave 1 |
| DIAG-08 | Four concurrent child processes appending produce N×M parseable lines and zero torn records | integration | `npx vitest run tests/integration/jsonl-concurrency.test.ts` | ❌ Wave 1 |

### Sampling rate

- **Per task commit:** `npm run test:unit && npm run typecheck` — unit tests are pure and sub-second; the typecheck is the only gate that catches a Pi API drift.
- **Per wave merge:** `npm test` (full suite, including the integration tests that spin up in-memory sessions and spawn child processes).
- **Phase gate:** full suite green, `tsc --noEmit` clean, and `docs/RUNBOOK.md` carrying RB-02-01/02/03 with matching **OUTSTANDING** status in both the summary table and the detail subsection (`tests/unit/docs-policy.test.ts` returns `INCONSISTENT` otherwise), before `/gsd:verify-work`.

### Wave 0 gaps

- [ ] `tests/helpers/faux.ts` — `wrapFauxWithPayload(faux)` (§8.3) **and** realistic `buildFixturePayload` shapes for the `openai-completions` and `bedrock-converse-stream` paths. **Blocks DIAG-01, DIAG-02, DIAG-07.**
- [ ] `tests/helpers/session.ts` — the in-memory `createAgentSession` factory of §8.4, plus a temp `agentDir` whose `extensions/` holds the extension under test at **user scope** (project scope does not load headless).
- [ ] `tests/helpers/logs.ts` — temp `.pi/logs/` fixture, JSONL reader, and a `readTornSafe()` that reports unparseable lines rather than throwing.
- [ ] No framework install needed — `vitest@4.1.9` is already pinned and green.
- [ ] No new dependency may be added; see the Package Legitimacy Audit.

---

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json`, so this section is required.

### Applicable ASVS categories

| ASVS category | Applies | Standard control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 2 authenticates nothing; it observes credentials in transit and must not persist them. |
| V3 Session Management | no | Pi owns sessions. |
| V4 Access Control | no | Single-user local harness. |
| V5 Input Validation | **partial** | The prose detector parses untrusted model output with a regex. `typebox` is available (peer-declared) but the detector's inputs are typed by Pi already; the real control is a **bounded regex** — no catastrophic backtracking, no unbounded `.*` across a multi-megabyte assistant message. Test with a 1 MB adversarial string. |
| V6 Cryptography | no | No crypto is performed. |
| **V7 Error Handling & Logging** | **yes — this is the phase** | ASVS V7.1.1 ("log no sensitive data") and V7.3.1 ("protect log files from unauthorised access") are literally DIAG-07. Controls: redact at capture; write only under `.pi/logs/`; `git check-ignore --no-index` test; never read a log back into model context. |
| V12 Files & Resources | **yes** | Log paths must be constructed with `node:path.join` from `ctx.cwd` + exported `CONFIG_DIR_NAME`, never from model-supplied input; rotation must not follow symlinks out of `.pi/logs/`. |
| V14 Configuration | **partial** | No new dependency may enter the tool/credential path (see audit). |

### Known threat patterns for this stack

| Pattern | STRIDE | Standard mitigation |
|---|---|---|
| Credential written to a dump in a public repo | Information Disclosure | Redact at capture (not at read); gitignored path; a test proving both. The gitignore alone is insufficient — a `git add -f` or a future rule change silently defeats it, which is why redaction is first. |
| Secret-shaped content inside `messages[]` (a `.env` or `*.tfstate` the model read) | Information Disclosure | Value-shaped redaction (§1.3), not key-name-only. This is the dominant real risk (§1.3) and Phase 4's SAFE-06 read-block has not shipped yet. |
| A capture handler accidentally rewriting the request payload | Tampering | Block-bodied handlers; a test asserting `undefined` return; an integration test asserting the outgoing `context` is unmodified. |
| Prose-tool-call **promotion** executing a tool with regex-parsed arguments | Elevation of Privilege | Rejected as the default (§6.4). Follow-up retry does not execute anything. |
| Unbounded log growth filling the disk on a laptop | Denial of Service | Size cap + rotation + retention prune (§10.5). |
| ReDoS on a large assistant message | Denial of Service | Bounded regex; test against a 1 MB input. |
| A silently-dead instrument that reports nothing while claiming coverage | Repudiation | Per-handler `try/catch` writing a `diagnostics.error` row; `/budget` reports rows-written-this-session so zero is visible. |

---

## Package Legitimacy Audit

**This phase installs no packages.** Every capability is available from `@earendil-works/pi-coding-agent@0.84.1`, `@earendil-works/pi-ai@0.84.1` (both already peer-declared and dev-pinned), `vitest@4.1.9`, and Node's `node:fs` / `node:path`.

| Package | Registry | Disposition |
|---|---|---|
| *(none)* | — | No new dependency is proposed. |

Adding any dependency would fail `tests/unit/pinning.test.ts:253` ("declares no dev dependency beyond the six audited pins") and would require a full audit. Candidates a naive plan might reach for, and why each is unnecessary: a tokenizer (§7.2 — Pi has none and uses 4 chars/token itself), a redaction library (§10.4 — ~60 lines, and a redactor is exactly the kind of thing you want to be able to read end to end), a log-rotation library (§10.5 — `statSync` + `renameSync`), a lock library (§10.3 — executed evidence shows none is needed), and ESLint (§9.2 — structurally blocked, and the house pattern already covers it).

`slopcheck` was not run because there is nothing to check. If a later plan revision proposes a package, the Package Legitimacy Gate must run before it is written into `package.json`.

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.16.0 | — |
| `@earendil-works/pi-coding-agent` | all DIAG work | ✓ | 0.84.1 (devDep **and** global at `~/AppData/Roaming/npm/node_modules`) | — |
| `@earendil-works/pi-ai` | `fauxProvider`, `calculateCost`, types | ✓ | 0.84.1 (devDep) | — |
| `vitest` | every test | ✓ | 4.1.9 | — |
| `git` | `trackedFiles`, `check-ignore` in tests | ✓ | Git Bash present | — |
| Model credentials | RB-02-01/02/03 only | ✗ | — | **None.** These are the [RUNBOOK] half; they stay OUTSTANDING. |
| Network egress to a provider | RB-02-01/02/03 only | ✗ (by policy — offline research) | — | **None.** Same. |
| ESLint / ast-grep | DIAG-03 if built as a lint | ✗ | — | Source-grep vitest test (§9.2) — recommended anyway. |
| A tokenizer | DIAG-06 exact token counts | ✗ | — | `Math.ceil(chars/4)`, labelled an estimate, with `usage.input` shown as ground truth (§7.2). |
| macOS | cross-platform proof of §10.3 | ✗ | — | CI `macos-latest` leg — which is itself BOOT-07 **OUTSTANDING** and has never run. State this limitation rather than implying coverage. |

**Missing with no fallback:** live model credentials and network egress — bounded exactly to RB-02-01/02/03.
**Missing with fallback:** ESLint, a tokenizer, macOS verification — each has a named substitute above.

---

## State of the Art

| Old approach | Current approach | When changed | Impact here |
|---|---|---|---|
| Wire logging as `console.log` in a hook | `before_provider_request` + `before_provider_headers` + `after_provider_response` with a documented replacement contract | Pi ≥ 0.7x; example bundled at 0.84.1 | Start from `examples/extensions/provider-payload.ts`. |
| Model calls only through the session | `ModelRegistry.complete()` with per-call `onPayload`/`onResponse`/`transformHeaders` | `ModelsRequestTransforms` present at 0.84.1 | Makes the chokepoint possible — and makes it necessary. |
| `ModelRuntime.getAll()/find()/getSnapshot()/getAuthOptions()` | Removed; use `ModelRegistry` facade | pre-0.84.1 breaking change (Pi CHANGELOG, PITFALLS Pitfall 16) | Do not copy older third-party extension code that calls the removed methods. |
| `@sinclair/typebox` | unscoped `typebox` | Pi bundles `1.3.7` | Not used in this phase, but the rule stands. |

**Deprecated / not to be used:**
- `pi-ai`'s root entrypoint has been aliased to `/compat` **with an announced future removal** (PITFALLS Pitfall 16). Import from `@earendil-works/pi-ai` root as everything else does today, but expect a migration; keep pi-ai imports concentrated in `call-model.ts` and `schema.ts` so the blast radius is two files.
- `telemetryContext` / `@earendil-works/pi-telemetry` — a contract with no producer at 0.84.1 (§11). Not a build target; possibly the right integration point later.

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | 32 MB / 8 MB rotation caps and a 14-day / 10-file retention are the right numbers | §10.5 | Low. Config constants in `jsonl.ts`; tune after a week of real use. The 50 KB/payload input to the arithmetic is measured, not assumed. |
| A2 | The proposed secret-pattern set (`sk-`, `AKIA`, `ASIA`, `ghp_`, `xoxb-`, `AIza`, `pt-`, PEM, `Bearer`) covers the credentials this machine actually holds | §1.3 | Medium. A missed pattern is a credential on disk in a public repo. Mitigate by also redacting on key name, by keeping the pattern list in one exported constant, and by making RB-02-02 a real grep over real dumps. |
| A3 | `appendFileSync` atomicity holds on macOS as it does on Windows | §10.3 | Medium. Windows is executed; macOS is not. The concurrency test runs on both CI legs — but the macOS leg (BOOT-07) has never actually run. Treat as unproven on macOS. |
| A4 | Follow-up retry is more valuable than tool-call promotion for the daily driver | §6.4, decision 4 | Low-medium. Both are executed and both work; the choice is a safety judgement, reversible in one file. |
| A5 | The 4-chars/token heuristic is within ±20% for DeepSeek and Claude | §7.2 | Low, and self-correcting — `/budget` shows provider-reported `usage.input` beside the estimate, so the error is visible on screen. |
| A6 | A single `role` string is a sufficient join key between the wire log and the turns log for Phases 5 and 8 | §4.6 | Medium — it is a cross-phase contract. Mitigate by also emitting a monotonic `corr` id per logical request, which is cheap now and impossible to retrofit cleanly. |
| A7 | `pi.getActiveTools()` is the right name source for the prose regex | §6.6 | Low. If a tool is registered but inactive, prose about it is genuinely not a failed call. |

Everything else in this document is tagged `[VERIFIED: file:line]` from Pi 0.84.1's recovered TypeScript, `[CITED: docs/...]` from the shipped docs, or `[VERIFIED: executed 2026-08-13]` with the output pasted inline.

---

## Open Questions

1. **Does `tool_choice: "required"` on the retry actually reduce the prose-tool-call rate?**
   - Known: the mechanism exists on both paths (§1.2, §4.2). PITFALLS Pitfall 7 note 3 marks the effect **UNVERIFIED**.
   - Unclear: whether DeepSeek honours it, and whether it trades prose for a wrong-tool call.
   - Recommendation: build the flag-guarded payload-injection handler but leave it **off**. The detector must produce a baseline rate first. This is Phase 10's experiment, not Phase 2's.

2. **Does DeepSeek V4 Flash honour `reasoning_effort` through `openai-completions`?** (Carried-Forward Unknown; the reason this phase exists.)
   - Phase 2 does not answer it — Phase 2 builds the apparatus that answers it. RB-02-01 is that apparatus pointed at the question.
   - Recommendation: make RB-02-01's expected output name the exact JSON keys (`thinking.type`, `reasoning_effort`) so the answer is unambiguous when someone finally runs it.

3. **How should nested-call `usage` fold into Pi's own `/session` totals?**
   - Known: `ToolResultEventBase.usage?: Usage` and `ToolResultEventResult.usage` exist (`types.ts:920-921, 1094`) — the documented channel for attributing nested model usage to the tool that caused it.
   - Unclear: whether `/session`'s `cost` sums tool-result usage.
   - Recommendation: have `callModel()` return the `Usage` so a caller *can* attach it, and let Phase 8 decide. Do not build the attachment in Phase 2 — there is no caller yet.

4. **Is `.pi/logs/` the right home given `pi install` also clones this repo to `~/.pi/agent/git/...`?**
   - Known: `ctx.cwd` is the project dir, so logs follow the project. Phase 1 proved both load paths work off one tree.
   - Recommendation: `join(ctx.cwd, CONFIG_DIR_NAME, "logs")`, as ARCHITECTURE.md specifies. A user-scope fallback is a Phase 7 concern (subagents may run with a different `cwd`), and the concurrency evidence in §10.3 means a shared file is safe if they do land in the same place.

---

## Sources

### Primary — Pi 0.84.1 TypeScript recovered from `dist/**/*.js.map` `sourcesContent` (457 files extracted this session)

- `pi/src/core/extensions/types.ts` — event shapes (`:670-759`), result types (`:1065-1106`), `ExtensionContext` (`:307-347`), `ExtensionCommandContext` (`:1352-1356`), `ToolInfo` (`:1575`), `sendMessage`/`sendUserMessage` (`:1302-1314`), `registerProvider` overloads (`:1416-1417`), `ContextUsage` (`:288-294`)
- `pi/src/core/extensions/runner.ts` — `emitBeforeProviderRequest` (`:1016-1048`), `emitBeforeProviderHeaders` (`:1050-1077`), `emitMessageEnd` (`:835-875`), `noOpUIContext` (`:235-265`), error swallowing (`:861-870`)
- `pi/src/core/sdk.ts` — the only hook wiring point (`:294-360`), `createAgentSession` (`:169-230`)
- `pi/src/core/agent-session.ts` — `_replaceMessageInPlace` (`:710-724`), `_emitExtensionEvent` (`:727-790`), `_handleAgentEvent` (`:610-681`), `prompt` streaming guard (`:1167-1180`), `sendUserMessage` (`:1480-1511`), `_emitAgentSettled` (`:596-604`), `getContextUsage` (`:3174-3216`), `SessionStats` (`:262-279`), `_baseSystemPromptOptions` (`:1046-1056`)
- `pi/src/core/model-registry.ts` — whole file; `complete` (`:101-107`), `registerProvider` (`:128-136`), `getProvider` (`:96-98`)
- `pi/src/core/model-runtime.ts` — `prepareRequest` (`:573-608`), `complete`/`stream`/`streamSimple` (`:610-645`), `CreateModelRuntimeOptions` (`:64-82`), `create` (`:172-192`)
- `pi/src/core/system-prompt.ts` — `BuildSystemPromptOptions` (`:8-25`), context-file and skills block markers (`:143-158`)
- `pi/src/core/skills.ts` — `formatSkillsForPrompt` (`:335-361`)
- `pi/src/core/compaction/compaction.ts` — `estimateTokens` (`:266-291`), `estimateContextTokens` (`:202`)
- `pi/src/core/resource-loader.ts` — context-file candidates and ancestor walk (`:71`, `:125-155`)
- `pi/src/core/session-manager.ts` — `appendFileSync` JSONL persistence (`:1021`, `:1040`, `:1625`), `inMemory` (`:1568`)
- `pi/src/core/tools/file-mutation-queue.ts` — whole file (in-process only)
- `pi/src/core/slash-commands.ts` — `BUILTIN_SLASH_COMMANDS` (`:19-42`)
- `pi/src/core/diagnostics.ts` — resource diagnostics (unrelated to this phase; name collision noted)
- `pi/src/index.ts` — public exports: `estimateTokens` (`:38`), `getLastAssistantUsage` (`:44`), `formatSkillsForPrompt` (`:264`), `ModelRegistry` (`:171`), `ModelRuntime` (`:184`), `SessionManager` (`:246`), `withFileMutationQueue` (`:322`), `CONFIG_DIR_NAME` (`:7`); **`buildSystemPrompt` absent**
- `pi-agent-core/src/agent-loop.ts` — the loop (`:160-275`), follow-up resumption (`:262-268`), `streamAssistantResponse` and the `message_end` emit (`:277-370`)
- `pi-ai/src/types.ts` — `ProviderRequestOptions` (`:120-173`), `StreamOptions` (`:175-215`), `Usage` (`:368-389`), `StopReason` (`:391`), `AssistantMessage` (`:413-428`), `ToolResultMessage.usage` (`:436-437`), `ProviderHeaders` (`:110`), Bedrock reserved-header note (`:148-153`)
- `pi-ai/src/models.ts` — `ModelsRequestTransforms` (`:78-83`), `applyAuth` (`:636-665`), `calculateCost` (`:878-898`), `getSupportedThinkingLevels` (`:902-911`)
- `pi-ai/src/providers/faux.ts` — whole file (708 lines); `withUsageEstimate` (`:229-267`), `createFauxCore.stream` (`:504-530`), `fauxProvider` (`:685-708`), builders (`:51-96`)
- `pi-ai/src/api/openai-completions.ts` — `getClientApiKey` (`:72-76`), `onPayload` (`:237`), `onResponse` (`:241`), error path (`:590-609`), `rawStopReason` (`:462-464`), usage incl. `reasoning` (`:1380-1408`), `toolChoice` (`:143`, `:744-745`)
- `pi-ai/src/api/bedrock-converse-stream.ts` — command build + `onPayload` (`:234-251`), `onResponse` (`:255-261`), `handleMetadata` (`:589-602`), `toolChoice` (`:72`)
- `pi-ai/src/api/anthropic-messages.ts` (`:287`, `:550`), `google-*`, `mistral`, `openai-responses`, `openai-codex-responses` (`:1606`), `azure-openai-responses`, `pi-messages`, `simple-options.ts` — exhaustive `onPayload` call-site survey
- `pi-ai/src/providers/anthropic.ts` (`:28`), `cloudflare-auth.ts` (`:94-95`) — credential-bearing header names
- `pi-ai/src/utils/diagnostics.ts` — whole file (no redaction present)
- `pi-ai/src/index.ts` (`:34`, `:36`) — `calculateCost` and `fauxProvider` public exports

### Primary — bundled docs and examples (Pi 0.84.1)

- `docs/extensions.md` — hook-order diagram (`:298-320`), `before_provider_headers` (`:660-676`), `before_provider_request` (`:678-693`), `after_provider_response` (`:695-708`), `ctx.getSystemPrompt()` caveats (`:1066-1080`), `ctx.getSystemPromptOptions()` (`:1086-1088`)
- `docs/environment-variables.md` (`:13-88`), `docs/usage.md` (`:173-249`), `docs/settings.md` (`:81-83`) — the complete flag/env surface; no wire-dump switch exists
- `examples/extensions/provider-payload.ts` — the reference wire logger (whole file, 15 lines)
- `examples/extensions/send-user-message.ts` — `/ask`, `/steer`, `/followup` and the `isIdle()` guard pattern
- `grep -rn "faux" docs/*.md` → no matches (fauxProvider is undocumented)

### Executed on this machine, 2026-08-13 (win32, node v24.16.0, Pi 0.84.1)

- Probe 1 — live `createAgentSession` + plain `fauxProvider` + a 5-hook logging extension: **`before_provider_request` absent**; headers and response hooks fire; `usage.input = 12725`; `sysPromptChars = 50881`
- Probe 2 — same with an `onPayload`-emitting wrapper: `before_provider_request` fires with the full payload
- Probe 3 — prose-tool-call detector + `sendUserMessage(..., {deliverAs:"followUp"})`: `callCount = 2`, one `agent_end`, retry inside the same run
- Probe 4 — `message_end` → real `toolCall` promotion: `tool_execution_start` for `read`, `toolResults: 1`
- Probe 5 — nested `modelRuntime.complete()`: zero extension hooks fired, all three per-call callbacks fired, `usage.cost` zero until `calculateCost`
- Concurrency — 4 processes × 1500 records × ~950 B → 6000 lines, 0 unparseable; 4 × 200 × {8 KB, 65 KB, 200 KB} → 800 lines each, 0 unparseable
- Rename — `renameSync` OK with no handle, with a same-process open handle, and with a cross-process open handle
- `wc`/`stat` — `CLAUDE.md` = 49,404 bytes; `AGENTS.md` absent
- `package.json` dependency lists of both Pi packages — no tokenizer

### Repository state read this session

`package.json` (six devDependencies, `pi.extensions: ["./.pi/extensions"]`), `vitest.config.ts`, `tsconfig.json`, `.gitignore` (`*.jsonl:26`, `.pi/logs/:80`), `.pi/extensions/harness/index.ts`, `tests/unit/pinning.test.ts:244-257`, `tests/unit/contributing-boundary.test.ts` (the DIAG-03 house pattern), `tests/helpers/{git,pi}.ts`, `docs/RUNBOOK.md` (entry format), `.planning/config.json`

---

## Metadata

**Confidence breakdown:**
- Event shapes, mutation contracts, hook wiring: **HIGH** — read at source with `file:line`, and the four executed probes agree with the reading in every particular.
- `fauxProvider` behaviour and the offline test recipe: **HIGH** — the recipe was executed end to end; the `onPayload` gap was found by execution, not inference.
- Retry mechanisms: **HIGH** — both executed.
- JSONL concurrency and rotation on Windows: **HIGH** on Windows, **UNVERIFIED on macOS** (A3).
- Redaction pattern coverage: **MEDIUM** (A2) — the mechanism is certain, the pattern list is a judgement call.
- Rotation thresholds: **MEDIUM** (A1) — arithmetic from a measured payload size, but a first guess at policy.
- Real provider payload shapes: **NOT VERIFIED, by design** — that is the `[RUNBOOK]` half (§12) and must never be reported as passing.

**Research date:** 2026-08-13
**Valid until:** ~2026-09-12 for the Pi-API claims — Pi ships every ~2.3 days, so re-verify at the pinned version before Phase 5 imports `callModel()`. The executed filesystem findings (§10.3) do not expire.
