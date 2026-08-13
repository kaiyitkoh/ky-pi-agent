# Phase 3: Providers & Credentials — Research

**Researched:** 2026-08-13
**Domain:** Pi provider configuration (`models.json` / `auth.json`), OpenAI-compatible `compat` emission, Bedrock SSO credential resolution, retry classification, offline verification design
**Confidence:** HIGH for everything reachable from installed source; the DashScope *runtime* behaviours are UNVERIFIED by construction and are what the RB-03 entries exist for.

**Method.** Every `pi`/`pi-ai` claim below was read from original TypeScript recovered from `dist/**/*.js.map` `sourcesContent` at `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent` (and its nested `node_modules/@earendil-works/pi-ai`), plus the `docs/` shipped in the package. Line numbers are original-source lines. Two findings were *executed* rather than read (the retry-regex classification table and the `.gitignore` trap) and are marked EXECUTED. **No provider request was issued and no credential store was touched.**

---

<user_constraints>
## User Constraints (from 03-CONTEXT.md)

### Locked Decisions

Verbatim from `03-CONTEXT.md` `<decisions>` — binding, not re-derived here:

1. **DashScope's `compat` block is written out in full, explicitly, for every model — never left to detection.** `detectCompat` has no branch for DashScope, Model Studio, `aliyuncs.com` or Qwen. The two failures are silent: `thinkingFormat` falls back to `"openai"` so thinking is never enabled, and `requiresReasoningContentOnAssistantMessages` falls back to `false` so the provider returns **HTTP 400 on the second turn of any tool sequence**.
2. **Never copy `contextWindow: 1000000` from Pi's built-in direct-DeepSeek entry into a DashScope entry.** Whatever number is written must be sourced or marked UNVERIFIED in-file.
3. **Bedrock authenticates via `credential.env.AWS_PROFILE` in `auth.json`.** Pi checks it before process env; `aws sso login` alone sets no environment variable; `/login` → "Existing AWS credential chain" stores nothing; EC2 instance profiles are unsupported.
4. **Expired SSO is classified non-retryable and gets an actionable message** naming the exact `aws sso login --profile <name>` command.
5. **`!command` may appear only in `auth.json`** (cached per process); in `models.json` it is re-executed on every provider request.
6. **Bedrock reports no reasoning tokens and no thinking config for non-Claude models.** Do not plan a "cheap Bedrock fallback".
7. **Not Pi's built-in `qwen-token-plan` provider** — different host, different key namespace.
8. **Qoder is not a provider and is not in v1. The fallback chain is DeepSeek-direct → DashScope.**
9. **R1 stays open and is settled by one live request, not by desk work.** `/cheap` must not be defined in terms of a cheap thinking tier until then.
10. **Keep secrets out of `auth.json` entirely** — `0600` is a no-op on Windows. Already recorded in `docs/RUNBOOK.md`; reference, do not restate.
11. **Phase 3 is verified BY Phase 2's instrument.** Plan against the API Phase 2 actually exported.

### Claude's Discretion

The exact model set and ids per provider; which DashScope base-URL form to template; the mechanism by which in-repo templates reach `~/.pi/agent/`; the shape of the fallback-chain implementation and its error taxonomy; file decomposition; RB-03-xx numbering and section ordering; how the R1 result is recorded.

### Deferred Ideas (OUT OF SCOPE)

Routing, `/cheap`, the capability guard reading `input[]` (Phase 5) · per-role and main-loop thinking budgets (Phase 8, GATE-10) · whether strict-schema mode reduces the prose-tool-call rate — **record the finding only** (experiment is Phase 10) · third-party extension pins including `pi-model-fallback` (Phase 7) · Qoder in any form · the safety layer's `.pi/audit.jsonl` and command guard (Phase 4).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research support |
|----|-------------|------------------|
| PROV-01 | Structurally complete `models.json` / `auth.json` templates, zero secrets, `$ENV_VAR` + `!command` resolution | §Q1 (template + bootstrap installer chosen), §Q3 (`getProviderAuth` offline test), §Traps T1 (`.gitignore` swallows `auth.json`) |
| PROV-02 | `!command` only in `auth.json` | §Q1.4 — verified at source that the rule is really *cached vs uncached call site*, and that `registerProvider({apiKey})` is on the **uncached** side |
| PROV-03 | DashScope custom provider with explicit full `compat` block **[RUNBOOK]** | §Q2 — full 24-field enumeration, three **new** fields PITFALLS missed, and one **correction** (`thinkingFormat: "qwen"`, not `"deepseek"`) |
| PROV-04 | Bedrock via `credential.env.AWS_PROFILE` **[RUNBOOK]** | §Q5.4 — `resolve()` read at source; `env.AWS_PROFILE` is a **literal, never interpolated** → placeholder + runbook, not a templated value |
| PROV-05 | Expired SSO → actionable message + non-retryable **[FAUX]** | §Q4 — `message_end` is the mechanism (verified ordering); `after_provider_response` **cannot see it**; retry classification table EXECUTED |
| PROV-06 | Accurate capability metadata, never inherited cross-provider | §Q5 — built-in catalogues dumped; 393,216 now VERIFIED-with-URL; Bedrock needs **no** entry |
| PROV-07 | The R1 experiment, run and recorded **[RUNBOOK]** | §Q6 — API contract settled from docs; "what Pi will send" settled at source (`low` is clamped to `high`); experiment procedure written |
| PROV-08 | DeepSeek-direct → DashScope fallback for quota/transient/unavailable **[FAUX]** | §Q4.5 — taxonomy anchored on Pi's own regex tables; `callModel()` is the seam; faux cannot vary HTTP status → helper required |
| PROV-09 | First-run runbook | §RB-03 entry shapes + `tests/unit/docs-policy.test.ts` contract |
| PROV-10 | Two-turn tool-calling against DashScope returns 200 **[RUNBOOK]** | §Q2.3 — `requiresReasoningContentOnAssistantMessages` emission site read at source (`:1223-1229`), gated on `model.reasoning` |
</phase_requirements>

---

## Answers

| Q | Answer | Confidence |
|---|--------|-----------|
| **Q1** | **Option (a): templates in `.pi/templates/`, installed into the agent dir by `bin/bootstrap.sh` with merge-if-absent semantics.** `registerProvider` *does* participate in `$ENV_VAR`/`!command` interpolation (same `resolveConfigValue*` machinery), but a project-scoped extension does not load in subagents, so a provider registered from `.pi/extensions/` would be invisible to every subagent — fatal for Phase 5/7. `models.json` is also the only layer that survives `pi -p`, `--mode json`, and a second Pi install. Runner-up: hybrid (c), provider shape in code + credentials in `auth.json` — rejected for the same subagent reason. | VERIFIED |
| **Q2** | `compat` is settable at **three** layers (provider, model, `modelOverrides`) and merges shallow-with-nested-object-merge via `mergeCompat`. All four PITFALLS claims confirmed, **plus three fields PITFALLS missed** (`maxTokensField`, `supportsStrictMode`, `supportsLongCacheRetention`) and **one correction**: DeepSeek-served-by-DashScope wants `thinkingFormat: "qwen"`, not `"deepseek"`. `reasoning: true` on the model entry is **mandatory** — every thinking branch and the `reasoning_content` fix are gated on it. | VERIFIED (source) + CITED (Alibaba docs) |
| **Q3** | Offline can prove: template structure, resolved `compat` after merge, `$ENV_VAR`/`!command` resolution via `getProviderAuth`, the **real** emitted payload via a loopback server driving Pi's own adapter, message text + non-retryability via `faux.state.callCount`. Offline cannot prove: that DashScope *accepts* what we emit, the real context cap and price, or that a live SSO expiry produces the string we match. `faux` always reports `status: 200` and never varies it → a `wrapFauxWithStatus` helper is required. | VERIFIED |
| **Q4** | **The SSO classifier is a `message_end` handler, not `after_provider_response`.** `after_provider_response`/`onResponse` never fires on a provider error (already a recorded Phase 2 closed door; re-confirmed in the Bedrock adapter). Pi's retry decision is a pure regex over `message.errorMessage`, read *after* `message_end` handlers have mutated the message in place — so rewriting `errorMessage` in `message_end` is the sanctioned way to force non-retryable. The fallback chain lives **inside a wrapper around `callModel()`**, because `ModelRegistry.complete` has no retry at all and nested calls fire no hooks. | VERIFIED |
| **Q5** | Built-in `deepseek` catalogue dumped verbatim (ctx 1,000,000 / max 384,000 / `low: null`). **393,216 is now VERIFIED-with-URL** from Alibaba's own DeepSeek-on-Model-Studio page — the prior UNVERIFIED mark is discharged. Base URL: template the **shared `dashscope-intl.aliyuncs.com`** form (workspace-dedicated embeds an account id in a public repo, and `baseUrl` is *not* interpolated) with a bootstrap-time env override. Bedrock needs **no** `models.json` entry — its catalogue is complete and accurate. | VERIFIED / CITED / one UNVERIFIED (DashScope cost + whether DeepSeek is served on the legacy Singapore domain) |
| **Q6** | Two different questions, which is why two researchers disagreed. **API contract: `api.deepseek.com` documents `reasoning_effort` accepting `"low"`, `"high"` (default), `"max"`, with `"medium"`/`"xhigh"` → `"high"`** [CITED]. **What Pi will send: never `"low"`** — the shipped catalogue maps `low: null`, `getSupportedThinkingLevels` filters it out and `clampThinkingLevel("low")` returns `"high"` [VERIFIED at source]. The experiment therefore needs a one-line `modelOverrides.thinkingLevelMap.low` to unclamp it, then reads the Phase 2 wire dump and turns row. | OPEN-BY-DESIGN (the token-count half) |
| **Q7** | Pi **can** emit `strict`, and already emits `"strict": false` on every function today whenever `supportsStrictMode !== false`. Turning it *on* is **not** a `compat` or model-entry switch — it is `tool.constrainedSampling` at `pi.registerTool` time. So Phase 3 cannot "make it settable"; Phase 3 records the finding and sets `supportsStrictMode` explicitly (recommendation: `false` for DashScope — `strict` is not in Alibaba's supported-parameter list and PROV-10's whole failure mode is an unlisted field on the wire). | VERIFIED |

---

## Architectural Responsibility Map

| Capability | Primary tier | Secondary tier | Rationale |
|---|---|---|---|
| Provider/model catalogue + `compat` | `~/.pi/agent/models.json` (user scope) | in-repo template + bootstrap installer | Only user-scope config reaches subagents, `--mode json`, and a second install. Verified: no project-scope `models.json` exists. |
| Credentials | `~/.pi/agent/auth.json` (user scope) | process env via `$ENV_VAR` | The only file whose `!command` is cached; gitignored; never in the repo. |
| Base-URL / workspace selection | bootstrap-time substitution into the installed `models.json` | env var `KYPI_DASHSCOPE_BASE_URL` | `baseUrl` is **not** interpolated at runtime; a workspace id must not enter a public repo. |
| SSO error classification | `message_end` extension handler (main loop) | `callModel()` wrapper (nested loop) | Pi's retry gate reads the post-`message_end` message. Nested calls bypass hooks entirely. |
| Provider fallback chain | wrapper around `callModel()` in `.pi/extensions/diagnostics/`-adjacent code | — | `ModelRegistry.complete` has no retry; DIAG-03 forbids calling it outside `diagnostics/`. |
| Live verification | `docs/RUNBOOK.md` RB-03-xx | Phase 2 wire dump + turns JSONL | Every credential-dependent claim is either a runbook step or a lie. |

---

## Q1 — How in-repo templates become the `models.json` / `auth.json` Pi reads

### Q1.1 The scope facts, re-confirmed

`getModelsPath()` = `join(getAgentDir(), "models.json")`, `getAuthPath()` = `join(getAgentDir(), "auth.json")`, and `getAgentDir()` = `process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")` [VERIFIED: `pi 0.84.1 src/config.ts:515-536`]. An interactive session resolves the path at `src/core/agent-session-services.ts:59`; the SDK path at `src/core/model-runtime.ts:76` (`options.modelsPath ?? join(getAgentDir(), "models.json")`, and `null` disables the file entirely). **There is no project scope for either file.**

### Q1.2 Does `registerProvider` participate in interpolation? **Yes — and that is a hazard, not a feature.**

`ProviderConfigInput.apiKey` flows into `configuredApiKey()` → `composeApiKeyAuth().resolve()` → `resolveConfigValueOrThrow(rawKey, …)` — the *same* function models.json uses [VERIFIED: `pi src/core/provider-composer.ts:272-277, :341-363`]. Pi's own docs confirm: *"`apiKey` — API key literal, environment interpolation (`$ENV_VAR` or `${ENV_VAR}`), or leading `!command`"* [CITED: `pi 0.84.1 docs/extensions.md:1826`]. Headers likewise, through `resolveHeadersOrThrow`.

`resolveConfigValueOrThrow` calls `resolveConfigValueUncached` — **no cache** [VERIFIED: `pi src/core/resolve-config-value.ts:208-243`]. The cached variant is `resolveConfigValue`, whose `executeCommand` memoises on the command string for the process lifetime [`:139-146`, `:196-204`]. `auth.json` reads use the **cached** one [`pi src/core/auth-storage.ts:442-448`, and `:259-268` for the read-only store]. So:

> **PROV-02 restated precisely:** the rule is not "which file" but "which call site". `!command` is cached only where `AuthStorage.read` resolves `credential.key`. A `!command` in `models.json`'s `apiKey`/`headers`, **or in a `registerProvider({ apiKey })` string**, is re-executed per request. The mechanical test must therefore cover both surfaces.

Two further facts worth pinning: `/model` availability checks never execute shell commands [CITED: `docs/models.md`, "availability checks use configured auth presence and do not execute shell commands"], and `ReadOnlyAuthStorage.read` returns a `!command` credential **unresolved** rather than running it [`auth-storage.ts:264-267`] — a divergence between the two stores worth knowing before debugging one.

### Q1.3 Why option (b) loses

Three independent reasons, in decreasing order of severity:

1. **Subagents.** SAFE-11 (recorded) and `tests/helpers/session.ts`'s module docstring both state it: project-scoped `.pi/extensions` is gated behind project trust, which resolves `false` headless. A provider registered there does not exist inside a subagent. Phase 5 (ROUTE-05) and Phase 7 (EXT-01 per-agent model) both need it to.
2. **`applyExtension` replaces, it does not merge.** When an extension supplies `models`, `applyExtension` returns `config.models.map(...)` and drops whatever `applyModelsJson` produced [VERIFIED: `pi src/core/provider-composer.ts:214-234`]. `ProviderConfigInput` has **no provider-level `compat` field at all** (`:46-71`) — so provider-level compat is unavailable, and any provider-level compat from `models.json` is discarded for extension-defined models. Only `modelOverrides[id].compat` survives, applied last (`:442-445`).
3. **Reach.** `pi --list-models`, `pi -p`, `--mode json`, `pi install`ed copies on a second machine and the `/model` picker all read the agent dir. A code path in this repo reaches only sessions started from this repo.

### Q1.4 The recommendation

> **Ship `.pi/templates/models-template.json` and `.pi/templates/auth-template.json` in the repo; install them into `$PI_AGENT_DIR` from `bin/bootstrap.sh` with key-namespaced, merge-if-absent semantics — never a whole-file rewrite.**

This is also what `ARCHITECTURE.md:183-187` already prescribes (`templates/ # copied to ~ by bootstrap, never read at runtime`), with **one correction: the filenames in that sketch cannot be committed** — see Trap T1.

The bootstrap already has the exact idiom: `merge_settings()` reads, `JSON.parse`s, refuses to touch invalid JSON, replaces only its own key, and reports "already current — unchanged" on a re-run [`bin/bootstrap.sh:441-474`]. Two new functions in the same shape:

- `merge_models_json()` — writes `providers.dashscope` only when that key is absent; substitutes `${KYPI_DASHSCOPE_BASE_URL:-https://dashscope-intl.aliyuncs.com/compatible-mode/v1}` into `baseUrl` at install time (this is how the workspace-dedicated form is selected without a workspace id ever entering git).
- `merge_auth_json()` — writes a provider key **only when absent**, and never touches an existing one. This file may hold real credentials; clobbering it is the worst outcome in the phase.

Both must run in `run_full()` *after* `install_pi` (they configure Pi, they do not gate the hardening ordering), and neither belongs in `--assert-hardening`.

**Offline testability:** high. `PI_CODING_AGENT_DIR` is already a documented test seam of `bootstrap.sh` (`bin/bootstrap.sh:48`), and `tests/integration/bootstrap-check-only.test.ts` already drives the script. A test points `PI_CODING_AGENT_DIR` at a temp dir, runs bootstrap (with `KYPI_SKIP_INSTALL`), and asserts the merged files; a second run asserts byte-identity; a third run with a pre-existing `auth.json` asserts it was not modified.

---

## Q2 — The `compat` field set, what each field emits, and the literal blocks to ship

### Q2.1 Where `compat` may be set, and how the layers merge

| Layer | Schema | Merge |
|---|---|---|
| `providers.<id>.compat` | `ProviderConfigSchema.compat` [`pi src/core/model-config.ts:193-204`] | applied to every base model (`applyModelsJson` `:193-197`) and as the base for each custom model (`modelFromJson` `:164`) |
| `providers.<id>.models[].compat` | `ModelDefinitionSchema.compat` [`:156-170`] | `mergeCompat(providerConfig.compat, definition.compat)` — model wins |
| `providers.<id>.modelOverrides.<id>.compat` | `ModelOverrideSchema.compat` [`:172-191`] | applied **last**, after extensions (`composeModelProvider` `:442-445`) |

`mergeCompat` is `{...base, ...override}` plus a nested merge of `openRouterRouting`, `vercelGatewayRouting`, `chatTemplateKwargs`, `chatTemplateArgs` [VERIFIED: `pi src/core/provider-composer.ts:81-101`]. The adapter then merges the resolved model-level `compat` over `detectCompat` field-by-field with `??` in `getCompat` [VERIFIED: `pi-ai src/api/openai-completions.ts:1542-1575`].

**Two schema gotchas the planner must know:**

- The `models.json` compat schema documents **21** of the type's **24** fields — `supportsFinishReason`, `zaiToolStream` and `supportsThinkingTokenBudget` are absent from `OpenAICompletionsCompatSchema` [`model-config.ts:72-110`] but present on `OpenAICompletionsCompat` [`pi-ai src/types.ts:538-598`]. Typebox `Type.Object` permits additional properties (EXECUTED: `Compile(Type.Object({a:…})).Check({a:true,zzz:1}) === true`), so they *do* pass validation and *do* reach the adapter — but relying on that is fragile. **Do not use them; we need none of them.**
- The same permissiveness means **a typo'd compat key validates silently and does nothing**. This is the single most likely way Phase 3 ships a broken provider. The offline test must assert the *resolved* `model.compat` object, not the file's bytes.

### Q2.2 Every field, its generic default, and what DashScope needs

`detectCompat` checks zai, together, moonshot, openrouter, cloudflare (×2), nvidia, ant-ling, cerebras, xai, chutes, `deepseek.com`, opencode. **No `aliyuncs.com`, no `dashscope`, no `qwen`** [VERIFIED: `pi-ai src/api/openai-completions.ts:1443-1536`]. A DashScope base URL therefore takes every generic default below.

| Field | Generic default | Emission site | DashScope value | Why |
|---|---|---|---|---|
| `supportsStore` | `true` | `:711-713` — sends `store: false` | **`false`** | `store` is not in Alibaba's supported-parameter list [CITED]. Note the default sends `store: false`, not `true`. |
| `supportsDeveloperRole` | `true` | `:1083-1085`, gated on `model.reasoning` | **`false`** | `developer` role unlisted; bites only on reasoning models, which is exactly our case. |
| `supportsReasoningEffort` | `true` | `:754`, `:763`, `:802`, `:837` | **`true`** (explicit) | Needed; set explicitly so detection never decides it. |
| `supportsUsageInStreaming` | `true` | `:707-709` — `stream_options:{include_usage:true}` | leave default | `stream_options` is documented as supported [CITED]. |
| `supportsFinishReason` | `true` | stream parse | leave default | Not settable in `models.json` schema anyway. |
| `maxTokensField` | `"max_completion_tokens"` | `:715-721` | **`"max_tokens"`** | **NEW — PITFALLS missed this.** Alibaba's compatibility table lists `max_tokens` and does not list `max_completion_tokens` [CITED]. |
| `requiresToolResultName` | `false` | message conversion | leave default | — |
| `requiresAssistantAfterToolResult` | `false` | `:1090-1093` | leave default | — |
| `requiresThinkingAsText` | `false` | message conversion | leave default | — |
| `requiresReasoningContentOnAssistantMessages` | `false` (`isDeepSeek`-gated) | `:1223-1229`, gated on `model.reasoning` | **`true`** for DeepSeek models | The PROV-10 fix: replayed assistant messages get `reasoning_content: ""`, without which the second turn of a tool sequence 400s. |
| `thinkingFormat` | `"openai"` | `:748-845` | **`"qwen"`** — see Q2.3 | Correction to PITFALLS' draft. |
| `openRouterRouting` / `vercelGatewayRouting` / `chatTemplateKwargs` / `chatTemplateArgs` | `{}` | n/a | omit | — |
| `zaiToolStream` | `false` | `:732-734` | omit | Not settable in schema. |
| `supportsThinkingTokenBudget` | `false` | `:851-866` | omit | Not settable in schema. |
| `supportsStrictMode` | `true` | `:1360`, `:1368` | **`false`** — see Q7 | `strict` unlisted; suppressing it removes one unlisted field from the PROV-10 request. |
| `supportsOpenAIGrammarTools` | `false` | `:1342-1358` | omit | — |
| `cacheControlFormat` | `undefined` | `:740-742` | omit | — |
| `sendSessionAffinityHeaders` | `false` | header build | omit | Inert while `false`. |
| `deferredToolsMode` | `undefined` | `:727-729` | omit | — |
| `sessionAffinityFormat` | `"openai"` | header build | omit | Inert; gated on `sendSessionAffinityHeaders`. |
| `supportsLongCacheRetention` | `true` | `:699-704` — `prompt_cache_key` + `prompt_cache_retention:"24h"` | **`false`** | **NEW — PITFALLS missed this.** Neither parameter is in Alibaba's list; both would ride along on long-cache turns. |

**`reasoning: true` is mandatory on the model entry.** Every `thinkingFormat` branch is `compat.thinkingFormat === X && model.reasoning` [`:748`, `:761`, `:769`, `:774`, `:779`, `:796`, `:806`, `:816`, `:821`, `:830`, `:837`], and the `reasoning_content` fix is `&& model.reasoning` too [`:1225`]. `modelFromJson` defaults `reasoning` to **`false`** when omitted [`provider-composer.ts:156`] — so an entry that forgets it disables thinking *and* re-opens the PROV-10 400, silently.

### Q2.3 The `thinkingFormat` correction: `"qwen"`, not `"deepseek"`

`PITFALLS.md:302-310` drafts `thinkingFormat: "deepseek"` for DeepSeek-via-DashScope. The evidence says otherwise:

- Pi's `"deepseek"` branch emits `thinking: {type: "enabled"|"disabled"}` plus top-level `reasoning_effort` [`:796-805`].
- Pi's `"qwen"` branch emits top-level `enable_thinking: boolean` plus `reasoning_effort` [`:761-768`].
- **Alibaba's own DeepSeek-on-Model-Studio page documents `enable_thinking` (boolean) and `reasoning_effort` with values `high`/`max`, default `high`** [CITED: alibabacloud.com/help/en/model-studio/deepseek-api]. It does not document a `thinking` object.
- The upstream issue `earendil-works/pi#6998` is titled *"DeepSeek models provided by Aliyun should use thinkingFormat=qwen"* and is closed [CITED via `CLAUDE.md` Sources]. `CLAUDE.md`'s own Stack Patterns section already says *"`compat.thinkingFormat: \"qwen\"` is **mandatory**"* for the DashScope path.

> **Decision:** `thinkingFormat: "qwen"` for **all** DashScope models including DeepSeek. `requiresReasoningContentOnAssistantMessages` is an independent key applied in message conversion, so it stays `true` for DeepSeek models and the PROV-10 fix is unaffected. If RB-03-01's wire dump shows DashScope rejecting `enable_thinking` for a DeepSeek model, flipping to `"deepseek"` is a one-key change with the test already in place.

### Q2.4 The literal blocks to ship

`.pi/templates/models-template.json` (the `deepseek-v4-*` ids are deliberately identical to the DeepSeek-direct ids — that collision is exactly what PROV-06's invariant is about):

```jsonc
{
  "providers": {
    "dashscope": {
      "name": "Alibaba Model Studio (DashScope)",
      "api": "openai-completions",
      "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      "apiKey": "$DASHSCOPE_API_KEY",
      "compat": {
        "supportsStore": false,
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": true,
        "maxTokensField": "max_tokens",
        "supportsStrictMode": false,
        "supportsLongCacheRetention": false,
        "thinkingFormat": "qwen"
      },
      "models": [
        {
          "id": "deepseek-v4-flash",
          "name": "DeepSeek V4 Flash (DashScope)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 393216,
          "maxTokens": 65536,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "thinkingLevelMap": {
            "minimal": null, "low": null, "medium": null,
            "high": "high", "max": "max"
          },
          "compat": { "requiresReasoningContentOnAssistantMessages": true }
        },
        {
          "id": "deepseek-v4-pro",
          "name": "DeepSeek V4 Pro (DashScope)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 393216,
          "maxTokens": 65536,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "thinkingLevelMap": {
            "minimal": null, "low": null, "medium": null,
            "high": "high", "max": "max"
          },
          "compat": { "requiresReasoningContentOnAssistantMessages": true }
        }
      ]
    }
  }
}
```

Notes the planner must carry into the task text:

- `contextWindow: 393216` — **VERIFIED-with-URL** (alibabacloud.com/help/en/model-studio/deepseek-api, *"393,216 in total"* for `deepseek-v4-pro`, `-us` and `deepseek-v4-flash`). Decision 2's UNVERIFIED mark is discharged. The file should still carry a source comment; `models.json` accepts `//` comments (`stripJsonComments`, `model-config.ts:261`).
- `maxTokens: 65536` — **UNVERIFIED**; deliberately conservative. Pi only sends `max_tokens` when the caller sets `options.maxTokens`, so a low value costs at most truncation, while a high one risks a 400. RB-03-05 measures the real cap.
- `cost` all zeros — **deliberate, visible placeholder, not a fabrication.** Public English docs give no per-token price (console only). Zeros are what `modelFromJson` would default to anyway (`:159`), and `docs/DIAGNOSTICS.md` already documents zero-cost detection. The plan must add a test that every all-zero-cost templated model is on an explicit `COST_UNVERIFIED` list *and* named in the runbook — a gap that is asserted is a gap that gets closed.
- `thinkingLevelMap` mirrors Pi's own direct-DeepSeek entry. Mapping `low → "high"` would put a selectable "low" in the UI that silently means high; `null` is honest. On the DashScope path `low`/`medium` map to `high` server-side regardless [CITED], which is exactly why CONTEXT decision 9 bounds R1's impact to the direct path.

`.pi/templates/auth-template.json`:

```jsonc
{
  "dashscope":  { "type": "api_key", "key": "$DASHSCOPE_API_KEY" },
  "deepseek":   { "type": "api_key", "key": "$DEEPSEEK_API_KEY" },
  "amazon-bedrock": { "type": "api_key", "env": { "AWS_PROFILE": "REPLACE_WITH_AWS_PROFILE_NAME" } }
}
```

Validity confirmed against `ReadOnlyAuthStorage.load`'s validator: `type: "api_key"` with `key` absent and an all-string `env` object passes [`pi src/core/auth-storage.ts:236-252`]. `AuthStorage.read` interpolates `key` with `credential.env` as the variable map [`:442-448`], so `env` doubles as a per-credential variable scope. **`env.AWS_PROFILE` itself is never interpolated** — `resolve()` reads it raw [`pi-ai src/providers/amazon-bedrock.ts:64-70`] — hence the literal placeholder and RB-03-03. Do **not** ship `"AWS_PROFILE": ""`: `credential?.env?.AWS_PROFILE ?? (await env("AWS_PROFILE"))` uses `??`, so an empty string wins over the ambient variable and breaks resolution in a way that looks like a Bedrock outage.

---

## Q3 — What offline can and cannot prove, per requirement

| Req | Offline proof | Residual gap → runbook |
|---|---|---|
| PROV-01 | (i) JSON-schema/structural test over both templates: no value matches a secret shape, every credential-bearing value is `$ENV_VAR` or `!…`; (ii) `ModelRuntime.create({ modelsPath: <template>, authPath: <temp> })` then `registry.getProviderAuth("dashscope")` with `DASHSCOPE_API_KEY` set in `process.env` → asserts `auth.apiKey` equals the env value; (iii) bootstrap-installer integration test under `PI_CODING_AGENT_DIR`. | none — PROV-01 is fully provable offline |
| PROV-02 | Mechanical scan: no string value in `models-template.json` starts with `!`; plus a *behavioural* proof that the rule matters — an `auth.json` fixture with `"key": "!echo A"` resolved twice returns the cached value while a `models.json` `apiKey: "!echo …"` re-executes (assert via a counter script through `stub-bin.ts`). Also scan `.pi/extensions/**` for `registerProvider` with a `!`-prefixed `apiKey`/header. | none |
| PROV-03 | (i) resolved-`compat` deep-equality after the three-layer merge; (ii) **loopback payload test** (Q3.2) proving the emitted body carries `enable_thinking`, `reasoning_effort`, `max_tokens`, no `store`, no `developer` role, no `strict`, no `prompt_cache_*`; (iii) a source-guard test asserting the installed `pi-ai` still has no `aliyuncs`/`dashscope` branch in `detectCompat`, so a future Pi that adds one fails loudly instead of silently double-configuring. | **DashScope must accept it** → RB-03-01 |
| PROV-04 | `auth-template.json` validates against the `api_key` credential shape; a `ModelRuntime` over a temp `auth.json` containing `env.AWS_PROFILE` returns `source: "stored credential"` from `getProviderAuth("amazon-bedrock")` **with no AWS SDK involved**; a negative test with the entry absent and no ambient var returns `undefined`. | **A fresh shell on the work laptop** → RB-03-03 |
| PROV-05 | Faux session, one scripted `stopReason:"error"` message carrying an SSO string; assert (a) the surfaced text contains `aws sso login --profile <name>`, (b) `faux.state.callCount === 1`. Both halves, as CONTEXT requires. Plus a table test driving `isRetryableAssistantError` over the six credential strings before and after the rewrite. | none — `[FAUX]`, plan as **passing** |
| PROV-06 | Cross-provider invariant test: for every `(provider, modelId)` in the composed registry, no two providers serving the same `modelId` share a `contextWindow` unless both are sourced; and `dashscope/deepseek-v4-flash.contextWindow !== deepseek/deepseek-v4-flash.contextWindow` specifically (393,216 vs 1,000,000). Plus the `COST_UNVERIFIED` allowlist test. | real cap + price → RB-03-05 |
| PROV-07 | Nothing about the answer. What *is* provable: that the `modelOverrides` unclamp works — `clampThinkingLevel(model,"low") === "low"` after the override and `"high"` before it. That makes the experiment executable rather than merely described. | the answer → RB-03-04 |
| PROV-08 | Faux + `wrapFauxWithStatus`: three scripted errors (quota / transient / unavailable) → assert the chain's classification, that the second model was tried exactly once for the retryable classes, and that a quota error does **not** trigger a same-provider retry. | none — `[FAUX]`, plan as **passing** |
| PROV-09 | `tests/unit/docs-policy.test.ts` extension (Q3.4). | the entries themselves are the gap-record |
| PROV-10 | The `requiresReasoningContentOnAssistantMessages` half of the loopback payload test: a two-turn context whose assistant message carries a tool call and no `reasoning_content` must come out with `reasoning_content: ""` on the wire. This is the *exact* mechanism, proven against Pi's real adapter. | the provider's 200 → RB-03-02 |

### Q3.1 The `fauxProvider` API, verified

- `faux.state` is `{ callCount, deferredFetchCount, cancelledDeferred }` [`pi-ai src/providers/faux.ts:101-105`]; `state.callCount++` is the **first** statement of `stream()` [`:506`], so it counts *attempts*, which is exactly what "non-retryable ⇒ attempted once" needs.
- A provider error is a scripted `fauxAssistantMessage("", { stopReason: "error", errorMessage: "…" })`; the stream pushes `{type:"error", reason:"error", error: message}` and ends [`:426-431`]. A response **factory** that throws is converted to the same shape via `createErrorMessage` [`:305-317`].
- **`faux` cannot vary the HTTP status.** `await streamOptions?.onResponse?.({ status: 200, headers: {} }, requestModel)` is unconditional and hard-coded [`:507`]. There is no path to a 429/503 through faux. **A Wave-0 helper is required** — the same shape as the existing `wrapFauxWithPayload`:

```ts
// tests/helpers/faux.ts — sibling of wrapFauxWithPayload
export function wrapFauxWithStatus(faux: FauxProviderHandle, status: number): Provider {
  const inner = faux.provider;
  const emit = (options: unknown, model: Model<string>) => {
    const bag = options as (StreamOptions & Record<string, unknown>) | undefined;
    void (bag?.onResponse as ((r: { status: number; headers: Record<string,string> }, m: Model<string>) => unknown) | undefined)
      ?.({ status, headers: {} }, model);
  };
  return {
    ...inner,
    stream(model, context, options) { emit(options, model); return inner.stream(model, context, options); },
    streamSimple(model, context, options) { emit(options, model); return inner.streamSimple(model, context, options); },
  };
}
```

Note this *adds* a status callback; faux's own 200 still fires afterwards. If a test needs the 200 suppressed, wrap `onResponse` rather than pre-calling it. The planner should pick one and state it in the task — silently double-firing `onResponse` would write two `*.response` wire records under one correlation id and confuse `/budget`'s row count.

### Q3.2 The loopback payload test — the highest-value new capability in this phase

`fauxProvider` payloads are fixtures this repo writes; `tests/helpers/faux.ts` says so at length and Phase 2 correctly refused to over-claim from them. Phase 3 can do better **without any credential or egress**: stand up a `node:http` server on `127.0.0.1`, point a `models.json` provider's `baseUrl` at it, and let Pi's *real* `openai-completions` adapter build and send the body. Capture `req.body`; respond with a minimal SSE `data: {...}\n\ndata: [DONE]\n\n` (or simply assert and destroy — the assertion has already run).

Why this is sound: `detectCompat` matches none of its branches for `http://127.0.0.1:<port>/v1`, exactly as it matches none for DashScope, so the emission path is byte-for-byte the DashScope path except the URL string. It converts every claim in Q2.2 from "the source says" to "the wire shows".

What it does **not** prove, and the plan must say so: that DashScope accepts the body. That is RB-03-01/RB-03-02 and nothing else can substitute.

Constraint for the task text: **loopback only.** The test must bind `127.0.0.1` and assert the resolved `baseUrl` host is `127.0.0.1` before starting, so a copy-paste that reintroduces a real host fails rather than silently egressing from CI.

### Q3.3 `getProviderAuth` — the natural offline interpolation test

`ModelRegistry.getProviderAuth(provider)` → `runtime.getAuth(providerId)` and returns `AuthResult { auth: { apiKey?, headers?, baseUrl? }, env?, source? }` [VERIFIED: `pi src/core/model-registry.ts:115-117`; `pi-ai src/auth/types.ts:102-109`]. It takes a **provider id string**, so no model is loaded and no request is prepared. `ModelRuntime.create({ modelsPath, authPath, refreshOnCreate: false })` gives a fully offline registry — `tests/helpers/session.ts` already uses exactly this constructor, with `modelsPath: null`; Phase 3 passes the template path instead.

`source` is a useful assertion target: `"stored credential"` when `auth.json` supplied it, `"configured API key"` when `models.json` did, `"AWS_PROFILE"` when the ambient variable did [`provider-composer.ts:325-354`; `amazon-bedrock.ts:64-70`]. Note the precedence the tests must encode: **an `auth.json` entry wins over the `models.json` `apiKey`** (`resolve` checks `input.credential` first, `:342-357`).

### Q3.4 The `docs-policy` contract for RB-03

`tests/unit/docs-policy.test.ts` requires, for every id in `ALL_IDS`: a summary-table row whose last cell contains `OUTSTANDING`; a `**Status:** OUTSTANDING` line inside a `### <id> …` heading section (disagreement ⇒ `INCONSISTENT` ⇒ fail); every command in `ENTRY_COMMANDS[id]` present verbatim; and at least `ALL_IDS.length` `tests/**/*.test.ts` paths referenced across the file, each existing on disk. Phase 3 adds `PHASE_THREE_IDS`, extends `ALL_IDS`, adds five `ENTRY_COMMANDS` entries, and — mirroring Phase 2's Group C — adds an `RB-03-01` fixture pair so the generalisation is exercised by a fixture and not only by the real file.

---

## Q4 — Where the SSO classifier and the fallback chain hook in

### Q4.1 `after_provider_response` cannot see it — twice over

- Phase 2 already recorded the general case as a closed door: *"The adapter's `onResponse` call sits after the retry wrapper, and a 4xx/5xx throws into the catch instead"* [`docs/DIAGNOSTICS.md:341-354`].
- Re-confirmed independently for Bedrock: `onResponse` is called only after `await client.send(command, …)` returns, inside the `try` [`pi-ai src/api/bedrock-converse-stream.ts:253-261`]. A credential failure throws out of `client.send` straight to the catch at `:310`, where `formatBedrockError(error)` is assigned and an error message is pushed. **`onResponse` never fires.**

PITFALLS Pitfall 11's *"Implement it in `after_provider_response`"* is therefore wrong and must not be planned. Record the correction.

### Q4.2 `formatBedrockError`, read at source

`BEDROCK_ERROR_PREFIXES` maps exactly five names — `InternalServerException`, `ModelStreamErrorException`, `ValidationException`, `ThrottlingException`, `ServiceUnavailableException` [`:335-341`]. `formatBedrockError` prefixes only when `error instanceof BedrockRuntimeServiceException`; otherwise it returns `norm.message`, or `` `${status}: ${body}` `` when the SDK did not fold the body into the message [`:357-374`]. An SSO/STS credential error is not a `BedrockRuntimeServiceException`, so it arrives as a raw SDK string with **no reauth instruction** — the verified half of PROV-05.

### Q4.3 The retry classifier, and an honest correction to PITFALLS

`isRetryableAssistantError(message)` [`pi-ai src/utils/retry.ts:206-212`]:

1. not `stopReason:"error"` or no `errorMessage` → **not retryable**;
2. `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` matches → **not retryable** (checked first, wins);
3. `RETRYABLE_PROVIDER_ERROR_PATTERN` matches → **retryable**;
4. otherwise → **not retryable**.

Both patterns are plain case-insensitive alternations over `errorMessage` [`:6-88`]. I ran them (EXECUTED, 2026-08-13):

| Error string | Verdict today |
|---|---|
| `ExpiredTokenException: The security token included in the request is expired` | not retryable |
| `ExpiredToken: The provided token has expired.` | not retryable |
| `InvalidGrantException: Invalid grant provided` | not retryable |
| `CredentialsProviderError: Could not load credentials from any providers` | not retryable |
| `UnrecognizedClientException: … token … is invalid.` | not retryable |
| `The SSO session associated with this profile has expired …` | not retryable |
| `Throttling error: ThrottlingException: Too many requests…` | **retryable** |
| `Service unavailable: ServiceUnavailableException` | **retryable** |
| `Internal server error: InternalServerException` | **retryable** |
| `Error code: 429 … 'type': 'insufficient_quota'` | **not** retryable (limit pattern wins) |
| `Request timed out.` / `fetch failed` / `Error code: 503 …` | **retryable** |
| `Arrearage / Allocated quota exceeded` | **not** retryable (limit pattern wins) |

> **Correction to PITFALLS Pitfall 11.** All six named credential strings are already non-retryable under Pi 0.84.1 — the *"a 5xx-shaped expiry could be retried"* claim is **UNVERIFIED and, for those strings, false**. The verified gap is the **message**, not the retry. The residual retry risk is real but narrow: a credential failure whose text happens to include `timeout`, `fetch failed`, `socket hang up`, `getaddrinfo`, or a 5xx status — all plausible for an STS/SSO token-refresh network call — *will* be retried 3× at 2s/4s/8s (`retry.maxRetries: 3`, `baseDelayMs: 2000` [CITED: `docs/settings.md:136-149`]) for ~14 s of wasted wall-clock against a credential that cannot become valid. Both halves of PROV-05 remain worth building; the plan should state which half was already true so the test is not written to prove something trivially green.

### Q4.4 The mechanism: `message_end`

Verified ordering, and it is decisive:

1. `_handleAgentEvent` calls `await this._emitExtensionEvent(event)` **first** [`pi src/core/agent-session.ts:632`].
2. For `message_end`, that runs `emitMessageEnd`, which chains handlers, rejects a replacement whose `role` differs, and returns the final message [`pi src/core/extensions/runner.ts:835-875`].
3. A replacement is applied by `_replaceMessageInPlace(event.message, normalized)`, which **deletes every key of the target and `Object.assign`s the replacement** [`agent-session.ts:710-724, :767-780`]. Same object identity.
4. Only afterwards does `_handleAgentEvent` set `this._lastAssistantMessage = event.message` [`:662`] — the mutated object.
5. `_handlePostAgentRun` reads it and calls `_isRetryableError(msg)` → `isRetryableAssistantError` [`:1076-1085`, `:2087`]. `_willRetryAfterAgentEnd` scans `event.messages` for the same object [`:683-696`].

> **A `message_end` handler that rewrites `errorMessage` on an assistant message controls Pi's retry decision.** That is the sanctioned non-retryable mechanism and it delivers the actionable text in the same edit.

Two contract details for the task text: the handler must return a **complete** message (step 3 deletes all keys — a patch would erase `role`, `content`, `usage`), and the `role` must stay `assistant` or the runner rejects it with an extension error [`runner.ts:850-857`].

Sketch:

```ts
// SSO_PATTERNS deliberately excludes anything that also matches Pi's
// RETRYABLE_PROVIDER_ERROR_PATTERN, so the rewrite can only ever move a
// message from retryable -> non-retryable, never the reverse.
pi.on("message_end", (event) => {
  if (event.message.role !== "assistant") return;
  const msg = event.message as AssistantMessage;
  if (msg.stopReason !== "error" || !msg.errorMessage) return;
  const profile = classifySso(msg.errorMessage);          // undefined when not an SSO failure
  if (!profile) return;
  return {
    message: {
      ...msg,
      errorMessage:
        `AWS SSO credentials are expired or missing. Run: aws sso login --profile ${profile}\n` +
        `(original: ${msg.errorMessage})`,
    },
  };
});
```

The profile name comes from `ctx.modelRegistry.getProviderAuth("amazon-bedrock")` → `result.env?.AWS_PROFILE`, falling back to `process.env.AWS_PROFILE`, falling back to the literal `<profile>` with a pointer to RB-03-03. **The test must assert the resolved name appears**, not the placeholder — a message that says `--profile <name>` verbatim is the failure mode this requirement exists to prevent.

⚠️ The `(original: …)` suffix re-admits the original text to the regex. If the original contains e.g. `timed out`, the rewritten message becomes retryable again. **Either omit the original from `errorMessage` (put it in a `details` field or the log), or assert in the test that `isRetryableAssistantError(rewritten) === false` for every fixture.** Prefer both.

### Q4.5 The fallback chain

`ModelRegistry.complete` has **no retry** — `retryAssistantCall` is called from exactly one place in the whole install, `core/compaction/compaction.ts:450`. Nested `callModel()` invocations are therefore single-shot and fire no extension hooks (Phase 2's verified finding, `call-model.ts:26-38`). So:

> **The chain is a thin wrapper around `callModel()` in the harness's own code — not `pi.setModel()`, not `before_provider_request`, not `fallbackModels`.**

`pi.setModel()` is Phase 5's mode-switch mechanism and mutates session state (ROUTE-02 requires `await ctx.waitForIdle()` first); using it for a per-call failure would leave the session on the fallback model after a transient blip. `before_provider_request` can replace a payload but cannot change which provider is dialled. `pi-subagents`' `fallbackModels` is Phase 7 and out of scope. `STACK.md:828` already records the position: *"Fallback is one try/catch around … driven by response status codes — probably the right end state."*

Shape:

```ts
const CHAIN = [
  { provider: "deepseek",  id: "deepseek-v4-flash" },
  { provider: "dashscope", id: "deepseek-v4-flash" },
] as const;

export async function callWithFallback(ctx, opts) {
  let last: AssistantMessage | undefined;
  for (const [i, ref] of CHAIN.entries()) {
    const model = ctx.modelRegistry.find(ref.provider, ref.id);   // model-registry.ts:56-58
    if (!model) continue;
    const msg = await callModel(ctx, { ...opts, model });          // never throws on adapter error
    if (msg.stopReason !== "error") return msg;
    last = msg;
    if (classify(msg) === "fatal" || i === CHAIN.length - 1) break;
  }
  return last!;
}
```

`callModel` returns rather than throws for adapter and setup failures (both are converted to a `stopReason:"error"` message — `call-model.ts:233-256` documents the two classes at source), so the branch is on `stopReason`, not `catch`. Keep the `catch` anyway for a registry-facade rejection; `call-model.ts` already rethrows those.

**Error taxonomy — anchored on Pi's own tables so the harness and Pi never disagree:**

| Class | Rule | Chain action | Representative strings |
|---|---|---|---|
| **quota** | `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` matches | **advance** to next provider, no same-provider retry | `insufficient_quota`, `quota exceeded`, `billing`, `out of budget`, DashScope `Arrearage`/`Allocated quota exceeded` |
| **transient** | retryable pattern matches AND text is rate-limit/5xx shaped | advance (the harness does not add its own backoff; the main loop already has one) | `429`, `rate limit`, `Throttling.RateQuota`, `500`, `502`, `504` |
| **unavailable** | retryable pattern matches AND text is availability/transport shaped | advance | `503`, `service unavailable`, `overloaded`, `fetch failed`, `getaddrinfo`, `timed out` |
| **fatal** | neither pattern matches | **stop** — do not burn a second provider on a 400/401 | `Error code: 400 …`, `Error code: 401 …`, `ValidationException`, and the six SSO strings |

Reusing Pi's exported `isRetryableAssistantError` for the retryable/fatal split, and a small local table for the quota/transient/unavailable subdivision, keeps the harness from inventing a fourth classification of the same strings. The three classes must each have their own test, as CONTEXT requires.

---

## Q5 — Model catalogue facts

### Q5.1 Built-in `deepseek` (verbatim, `pi-ai 0.84.1 dist/providers/data/deepseek.json`)

| field | `deepseek-v4-flash` | `deepseek-v4-pro` |
|---|---|---|
| `baseUrl` | `https://api.deepseek.com` | same |
| `api` | `openai-completions` | same |
| `reasoning` | `true` | `true` |
| `input` | `["text"]` | `["text"]` |
| `contextWindow` | **1000000** | **1000000** |
| `maxTokens` | **384000** | **384000** |
| `cost` | `{input:0.14, output:0.28, cacheRead:0.0028, cacheWrite:0}` | `{input:0.435, output:0.87, cacheRead:0.003625, cacheWrite:0}` |
| `compat` | `{supportsStore:false, supportsDeveloperRole:false, requiresReasoningContentOnAssistantMessages:true, thinkingFormat:"deepseek"}` | identical |
| `thinkingLevelMap` | `{minimal:null, low:null, medium:null, high:"high", max:"max"}` | identical |

Provider definition: `id: "deepseek"`, `envApiKeyAuth([\"DEEPSEEK_API_KEY\"])` [`pi-ai src/providers/deepseek.ts:6-15`].

**These are the numbers a DashScope entry must not inherit.** 1,000,000 vs 393,216 is the specific collision PROV-06 names, and the model ids are identical, so the invariant test has a real target.

### Q5.2 Built-in `qwen-token-plan`

`baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"`, `auth: envApiKeyAuth(["QWEN_TOKEN_PLAN_API_KEY"])` [`pi-ai src/providers/qwen-token-plan.ts:6-15`]. Pi's own docs show the credential shape as `"qwen-token-plan": { "type": "api_key", "key": "sk-sp-..." }` [CITED: `docs/providers.md`]. Confirms decision 7: different host, different env var, different key namespace. The runbook line stands.

### Q5.3 Bedrock — **no `models.json` entry needed**

`amazon-bedrock.json` ships **114** models with full metadata. Spot-checked entries the harness will actually route to:

| id | ctx | maxTokens | input | reasoning | compat |
|---|---|---|---|---|---|
| `global.anthropic.claude-sonnet-4-5-20250929-v1:0` | 200000 | 64000 | text, image | true | `{supportsStrictMode:true}` |
| `global.anthropic.claude-opus-4-5-20251101-v1:0` | 200000 | 64000 | text, image | true | `{supportsStrictMode:true}` |
| `global.anthropic.claude-haiku-4-5-20251001-v1:0` | 200000 | 64000 | text, image | true | `{supportsStrictMode:true}` |
| `deepseek.r1-v1:0` | 128000 | 32768 | text | true | — |
| `deepseek.v3.2` | 163840 | 81920 | text | true | `{supportsStrictMode:true}` |
| `qwen.qwen3-32b-v1:0` | 16384 | 16384 | text | true | `{supportsStrictMode:true}` |

> **Decision:** Phase 3 adds **no Bedrock model entries**. Bedrock's Phase 3 surface is exactly one thing — `auth.json`'s `amazon-bedrock` credential (PROV-04). Redefining catalogued models would create precisely the drift PROV-06 forbids. Note for Phase 5: no Bedrock DeepSeek entry is V4, and `deepseek.r1-v1:0` is the ROUTE-08 target.

### Q5.4 Bedrock `resolve()`, verbatim order

`credential.key` → `AWS_BEARER_TOKEN_BEDROCK` → `credential.env.AWS_PROFILE ?? ambient AWS_PROFILE` → `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` → `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` → `..._FULL_URI` → `AWS_WEB_IDENTITY_TOKEN_FILE` → `undefined` [VERIFIED: `pi-ai src/providers/amazon-bedrock.ts:52-77`]. The `"credential-chain"` login branch returns `{ type: "api_key" }` with no `key` and no `env` [`:46-51`] — a stored no-op. No EC2 IMDS branch exists. Decision 3 confirmed in full.

### Q5.5 DashScope figures — what is verified and what is not

| Figure | Value | Status |
|---|---|---|
| `deepseek-v4-flash` / `-pro` context window on DashScope | **393,216 total** | **VERIFIED-with-URL** — alibabacloud.com/help/en/model-studio/deepseek-api, *"393,216 in total"* |
| `reasoning_effort` values on DashScope | `high`, `max`; default `high`; `low`/`medium` → `high`, `xhigh` → `max` server-side | CITED (same page) |
| Thinking toggle on DashScope | `enable_thinking` boolean | CITED (same page) — drives the `thinkingFormat: "qwen"` decision |
| Max output tokens | — | **UNVERIFIED** — page gives `65,536` / `16,384` for *other* models only. Template 65,536 conservatively; RB-03-05 measures. |
| Per-token price | — | **UNVERIFIED** — *"see the Model Studio console"*. Zeros + `COST_UNVERIFIED` allowlist + RB-03-05. |
| Supported OpenAI params | `model, messages, top_p, temperature, presence_penalty, n, max_tokens, seed, stream, stop, tools, stream_options` | CITED — compatibility-of-openai-with-dashscope. **`max_completion_tokens`, `store`, `strict`, `developer` role and `prompt_cache_*` are all absent.** |
| Whether DeepSeek models are served on the **legacy** `dashscope-intl` Singapore domain | — | **UNVERIFIED** — the DeepSeek page lists Singapore only in workspace-dedicated form. **This is the single most likely reason RB-03-01 fails first time.** The remedy is already in the design: set `KYPI_DASHSCOPE_BASE_URL` and re-run bootstrap. |
| Key scoping | *"API keys differ by region"*; keys are region- and workspace-scoped and non-portable | CITED |

### Q5.6 The base-URL decision

Alibaba documents Singapore's dedicated form as `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`, lists `https://dashscope-intl.aliyuncs.com` under *"Legacy domains (still functional)"*, and recommends the dedicated domains (*"superior performance and higher stability"*) [CITED]. `STACK.md:262` accordingly prefers the workspace-dedicated form.

New fact that decides the *template*: **`baseUrl` is never interpolated.** `modelFromJson` and `composeModelProvider` take it as a raw string [`provider-composer.ts:142, :479`]; only `apiKey` and `headers` pass through `resolveConfigValue*`. So a workspace-dedicated URL in the repo would be a hard-coded, account-identifying literal in a public repo, and wrong for any other machine.

> **Decision (one line):** the committed template carries `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`; `bin/bootstrap.sh` substitutes `$KYPI_DASHSCOPE_BASE_URL` when set, so the workspace-dedicated form is selected at install time and lives only in `~/.pi/agent/models.json`, outside git. `KYPI_DASHSCOPE_BASE_URL` is added to `.pi/templates/env.example` inside the managed markers. RB-03-01 tells the user to set it.

---

## Q6 — The R1 experiment

### Q6.1 The two questions, separated

**(a) The API's contract.** `api.deepseek.com` documents `reasoning_effort` with values **`"low"`, `"high"` (default), `"max"`**, and notes that `"medium"` and `"xhigh"` map to `"high"` [CITED: api-docs.deepseek.com/guides/thinking_mode/ and /api/create-chat-completion]. Thinking is enabled with `{"thinking": {"type": "enabled"}}`; disabled with `{"type":"disabled"}`. Reasoning tokens are reported at `usage.completion_tokens_details.reasoning_tokens`. Thinking mode does not support `temperature`, `top_p`, `presence_penalty` or `frequency_penalty`.

**(b) What Pi will send.** `deepseek-v4-flash` ships `thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" }`. `getSupportedThinkingLevels` drops every level mapped to `null` and every one of `xhigh`/`max` mapped to `undefined`, giving **`["off","high","max"]`**; `clampThinkingLevel(model, "low")` finds `low` unavailable, walks forward and returns **`"high"`** [VERIFIED: `pi-ai src/models.ts:900-932`]. So **Pi 0.84.1 with the built-in catalogue can never send `reasoning_effort: "low"` to DeepSeek-direct.**

A detail that matters for the experiment's mechanics: if `"low"` *did* reach the adapter, the `deepseek` branch emits `model.thinkingLevelMap?.[effort] ?? effort` [`openai-completions.ts:802-805`] and `null ?? "low"` is `"low"` — so the **null mapping suppresses selection, not emission**. Unclamping is therefore sufficient; no adapter change is needed.

> That is why two researchers reached opposite conclusions without either being careless: one answered (a), one answered (b). Both are right about their own question. **Neither is the answer PROV-07 wants, which is the token count.**

### Q6.2 The procedure — RB-03-04

**Preparation (one-time, on the work laptop).** Add the unclamp to `~/.pi/agent/models.json`. It is a `modelOverrides` entry, because `applyModelOverride` *merges* `thinkingLevelMap` (`{...model.thinkingLevelMap, ...override.thinkingLevelMap}`, `provider-composer.ts:108-110`) — the rest of the map, the compat block and the cost table are untouched:

```jsonc
{
  "providers": {
    "deepseek": {
      "modelOverrides": {
        "deepseek-v4-flash": { "thinkingLevelMap": { "low": "low" } }
      }
    }
  }
}
```

**Commands, copy-pasteable:**

1. `pi --list-models | grep deepseek-v4-flash` — confirms the override parsed. A `Warning: errors loading models.json` line means the edit is malformed and everything below is invalid.
2. Start `pi`, select `deepseek/deepseek-v4-flash`, set thinking level **low**. If the picker does not offer `low`, the override did not apply — stop.
3. Send the fixed prompt (use the same string in both legs; it must be non-trivial enough to provoke reasoning):
   `Prove that the sum of the first n odd positive integers is n squared, then state the value for n = 47.`
4. `tail -n 5 .pi/logs/wire-$(date +%F).jsonl` — find the record whose `kind` is `main.request`.
5. `cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"kind":"turn"' | tail -n 1`
6. Set thinking level **high**, send the **same** prompt, repeat steps 4–5.

**Expected output, by outcome:**

| Outcome | `main.request` payload | `main.response` / turns row |
|---|---|---|
| **accepted-and-cheaper** | `"thinking":{"type":"enabled"}` and top-level `"reasoning_effort":"low"` | `main.response` `status: 200`; the low turn's `reasoning` is materially below the high turn's. **"Materially" is pre-committed as ≤ 60% of the high value**, so the result is a decision and not a vibe. |
| **accepted-but-not-cheaper** | same | `status: 200`, `reasoning` within 60–100% of high |
| **rejected** | same | **no `main.response` record at all** (a 4xx throws before `onResponse`, per Q4.1 — its absence *is* the signal), and the turns row carries `outcome: "error"` with an `Error code: 400 …` message quoting the offending parameter |

`reasoning` is absent from a turns row when the provider reports no breakdown [`docs/DIAGNOSTICS.md:96, :142-151`]. **An absent `reasoning` key on both legs is a fourth outcome — "DeepSeek V4 Flash reports no reasoning-token breakdown through this adapter" — and it is a result worth recording, not a failed run.**

**Recording.** RB-03-04's status flips to `PASSED — YYYY-MM-DD` only with the four payload/row fragments pasted verbatim into the entry (two payloads, two turns rows). The one-line conclusion is appended to `.planning/ROADMAP.md`'s Carried-Forward Unknowns row R1 and to `.planning/PROJECT.md`'s Key Decisions. If the answer is accepted-and-cheaper, the `modelOverrides` unclamp graduates from a manual edit into `.pi/templates/models-template.json` — **and that is a follow-up, not part of Phase 3**, because `/cheap` is Phase 5.

---

## Q7 — Strict-schema mode

- Pi **can** emit `strict`, on the `openai-completions` path, per tool: `convertTools` writes `...(compat.supportsStrictMode !== false && { strict: strict ?? false })` [`pi-ai src/api/openai-completions.ts:1360-1369`].
- `strict` is `true` only when the tool declares `constrainedSampling: { type: "json_schema", … }` and the provider permits it; otherwise `resolveJsonSchemaStrictSampling` returns `undefined` [`pi-ai src/api/constrained-sampling.ts:84-99`]. With `undefined`, `strict ?? false` still emits **`"strict": false`**.
- Generic detection sets `supportsStrictMode: !isMoonshot && !isTogether && !isCloudflareAiGateway && !isNvidia` → **`true`** for both `deepseek.com` and DashScope [`:1522`].

> **Therefore: today, Pi already sends `"strict": false` on every function definition to DeepSeek-direct. Turning strict *on* is a tool-authoring change (`pi.registerTool` + `constrainedSampling`), not a `compat` or model-entry switch.** Phase 3 cannot make it "settable" in `models.json` beyond permitting it, which detection already does.

Phase 3's deliverables here are exactly two, both cheap:
1. **Record the finding** in `docs/RUNBOOK.md` (or a short note in the phase's notes) so Phase 8/10 starts from fact rather than from PITFALLS' "UNVERIFIED whether strict mode measurably reduces the prose-fallthrough rate".
2. **Set `supportsStrictMode` explicitly** in the DashScope compat block — `false`, because `strict` is not in Alibaba's supported-parameter list and PROV-10's entire failure mode is an unlisted field on the wire. Flipping it to `true` later is one key and the loopback test already covers the emission. DeepSeek-direct keeps detection's `true`.

Do **not** plan a quality-gate experiment into this phase.

---

## Traps — "do not do this"

| # | Trap | Why it bites | What to do instead |
|---|---|---|---|
| **T1** | Naming the credential template `.pi/templates/auth.json` (as `ARCHITECTURE.md:184` sketches) or `auth.example.json` | **EXECUTED:** `git check-ignore` reports `.gitignore:46:auth.json` and `.gitignore:47:auth.*.json` match both. The file would be **silently absent from every clone** and success criterion 1 would be false while every test passed. | Name it `.pi/templates/auth-template.json` (verified NOT ignored) and add a test that runs `git check-ignore` and `git ls-files` against **both** templates. |
| **T2** | Writing `after_provider_response` for the SSO classifier | It never fires on a provider error (Q4.1). The handler would be dead code and the test would have to fake the event to pass. | `message_end`. |
| **T3** | Testing "non-retryable" by reading the classifier | CONTEXT is explicit: prove it by call count. | `faux.state.callCount === 1`. |
| **T4** | Including the original SDK text inside the rewritten `errorMessage` | Re-admits `timeout` / `fetch failed` / a 5xx to Pi's regex and silently re-enables the retry the requirement forbids. | Keep the original out of `errorMessage`; assert `isRetryableAssistantError(rewritten) === false` on every fixture. |
| **T5** | Omitting `reasoning: true` from a DashScope model entry | `modelFromJson` defaults it to `false`; every thinking branch and the `reasoning_content` fix are gated on it. Thinking silently never happens **and** PROV-10's 400 returns. | Assert `reasoning === true` on every templated reasoning model in the structural test. |
| **T6** | Asserting the template's bytes instead of the resolved `compat` | Typebox allows unknown keys, so `supportsStoore: false` validates and does nothing. | Deep-equal the composed `model.compat` from a real `ModelRuntime`. |
| **T7** | Letting the installer overwrite `~/.pi/agent/auth.json` | It may hold the user's real credentials for every provider. | Merge-if-absent per provider key; never rewrite the file wholesale; test the "existing entry untouched" case. |
| **T8** | Shipping `"AWS_PROFILE": ""` as the placeholder | `??` treats `""` as present, so it wins over the ambient variable and breaks Bedrock in a way that looks like an outage. | A non-empty literal placeholder, plus RB-03-03. |
| **T9** | Copying `contextWindow: 1000000` or the DeepSeek-direct `cost` table into the DashScope entry | The ids are identical, so the copy is one keystroke away and invisible in review. | The PROV-06 invariant test, written *before* the template. |
| **T10** | Writing a Phase 3 check that looks for a SigV4 signature in a wire dump | Already a recorded closed door (RB-02-02); a Bedrock-aimed redaction check reports a clean pass while exercising nothing. | Nothing — do not write it. |
| **T11** | Pointing the loopback payload test at a real host | Would issue a live provider request from CI. | Bind and assert `127.0.0.1` before the test starts. |
| **T12** | Marking PROV-03/04/07/10 as passing because the offline half is green | The exact failure this project exists to correct. | `[~]` in REQUIREMENTS.md naming the RB-03 id inline; `OUTSTANDING` in both runbook places. |
| **T13** | Putting a `!command` in `registerProvider({ apiKey })` and thinking PROV-02 is satisfied | It is on the **uncached** side, identical to `models.json`. | PROV-02's scan must cover `.pi/extensions/**` too. |

---

## Runbook entries — shape and content

`docs/RUNBOOK.md` gains a `## Phase 3 — Providers & Credentials` section with a summary table and five detail subsections. **All five are OUTSTANDING and none may be planned as passing.**

| ID | Requirement | Live check |
|---|---|---|
| RB-03-01 | PROV-03 | The explicit DashScope compat block is correct **on the wire** and DashScope accepts it: one ordinary turn returns 200 and `main.request` shows `enable_thinking`, top-level `reasoning_effort`, `max_tokens`, and **no** `store` / `developer` role / `strict` / `prompt_cache_*` |
| RB-03-02 | PROV-10 | A **two-turn tool-calling** sequence against DashScope returns 200 on the **second** turn (the first always works) |
| RB-03-03 | PROV-04 | Bedrock authenticates from a **fresh shell** via `credential.env.AWS_PROFILE` |
| RB-03-04 | PROV-07 | The R1 experiment, with the four payload/row fragments recorded |
| RB-03-05 | PROV-06 | The real DashScope context cap and per-token price, measured and written back into the template |

Skeleton for one entry (matching the file's existing four-part contract and the `docs-policy` parser):

```markdown
### RB-03-02 — PROV-10: a two-turn tool-calling sequence against DashScope returns 200

**Status:** OUTSTANDING

**Why this cannot be done here.** …no DashScope credential and no provider egress…

**Procedure, on the work laptop:**

1. Select `dashscope/deepseek-v4-flash`.
2. Ask something that forces two tool turns, e.g. `Read package.json, then read the file its "main" field points at.`
3. `cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 2`

**Expected output.** Two `main.request` records. The **second** must contain an assistant
message carrying `tool_calls` **and** a `reasoning_content` key (value `""` is correct and
expected — Pi inserts it). A `main.response` record must follow it with `status: 200`.
An absent `main.response` after the second request means the request 4xx'd — see Q4.1 —
and the turns row will carry `outcome: "error"` with the provider's message. That is a
finding, not a pass.

**Offline proxy:** `tests/integration/dashscope-payload.test.ts` — drives Pi's real
`openai-completions` adapter against a loopback server with the shipped compat block and
asserts `reasoning_content: ""` is present on the replayed assistant message. It proves
what Pi emits. It says nothing about what DashScope accepts, which is this entry.
```

Additional runbook prose the phase should carry (no new ids needed):

- *Do not use the built-in Qwen providers.* `qwen-token-plan*` are a different Alibaba product on `token-plan.*.maas.aliyuncs.com` with `sk-sp-` keys; pasting a DashScope key there returns 401 and looks like "DashScope is broken".
- *DashScope keys are region- and workspace-scoped and non-portable.* A Singapore key against the Beijing domain fails; a key from the wrong workspace sees a different model list.
- *`aws sso login --profile X && echo $AWS_PROFILE`* — an empty echo means Bedrock will not work regardless of a successful SSO login. The persisting path is `pi auth login` → Amazon Bedrock → **"AWS profile"**, never "Existing AWS credential chain".
- *If RB-03-01 fails to resolve the host*, set `KYPI_DASHSCOPE_BASE_URL` to the workspace-dedicated form and re-run `sh bin/bootstrap.sh`.
- Reference — do not restate — the existing `0600`-on-Windows note in the Phase 1 machine-state section.

---

## Proposed plan decomposition (a suggestion to the planner)

Fine granularity, matching Phases 1 (10 plans) and 2 (11). `parallelization: false`, so waves are ordering, not concurrency.

| Wave | Plan | Covers | Rationale |
|---|---|---|---|
| **0** | **03-01** — test seams | `wrapFauxWithStatus`, `withModelsConfig()` (a `ModelRuntime` over an arbitrary `modelsPath`/`authPath`), the loopback capture server helper, and the `git check-ignore` / `git ls-files` template-trackedness test | Phase 2's hard-won lesson: the naive test for this phase ships vacuously green. `faux` cannot produce a non-200 and the payload it emits is a fixture this repo wrote. Wave 0 is mandatory. |
| **1** | **03-02** — `models-template.json` | PROV-03 (structural half), PROV-06 | The template plus the resolved-`compat` deep-equality test and the cross-provider `contextWindow` invariant. The invariant test is written first. |
| **1** | **03-03** — `auth-template.json` + installer | PROV-01, PROV-02, PROV-04 (template half) | `merge_models_json` / `merge_auth_json` in `bin/bootstrap.sh`; `getProviderAuth` interpolation tests; the cached-vs-uncached `!command` proof; the `.pi/extensions/**` scan. |
| **2** | **03-04** — loopback wire proof | PROV-03 (emission half), PROV-10 (offline half), Q7 finding | Converts every Q2.2 claim into an assertion against Pi's real adapter. Highest-value single plan in the phase. |
| **3** | **03-05** — SSO classifier | PROV-05 | `message_end` handler + actionable message + `callCount === 1` + the `isRetryableAssistantError` table test. |
| **3** | **03-06** — fallback chain | PROV-08 | `callWithFallback` around `callModel`, three-class taxonomy, three tests. Depends on 03-01's status helper and 03-02's dashscope models existing in the registry. |
| **4** | **03-07** — runbook + traceability | PROV-09, and the OUTSTANDING half of PROV-03/04/07/10 | `docs/RUNBOOK.md` Phase 3 section, `docs-policy.test.ts` extension with an `RB-03-01` fixture pair, `REQUIREMENTS.md` checkboxes to `[~]` with the RB id named inline, `ROADMAP.md` R1 row annotated. |

Optional split if the planner wants finer grain: 03-02 → template / invariant-test; 03-04 → request-shape / `reasoning_content`-replay. Seven plans is the recommendation; nine is defensible.

---

## Validation Architecture

**Test framework**

| Property | Value |
|---|---|
| Framework | `vitest@4.1.9` (pinned to match Pi core) |
| Config file | `vitest.config.ts` — `environment: node`, `include: ["tests/**/*.test.ts"]`, `testTimeout: 120_000`, `passWithNoTests: false` |
| Quick run command | `npm run test:unit` (`vitest run tests/unit`) |
| Full suite command | `npm test` (`vitest run`) + `npm run typecheck` (`tsc --noEmit`) |

**Phase requirements → test map**

| Req | Observable signal | Test type | Automated command | File exists? |
|---|---|---|---|---|
| PROV-01 | `getProviderAuth("dashscope").auth.apiKey` equals `process.env.DASHSCOPE_API_KEY`; no secret-shaped literal in either template | integration | `npx vitest run tests/integration/templates-install.test.ts` | ❌ Wave 1 |
| PROV-02 | Zero `!`-prefixed values in `models-template.json` and in any `registerProvider` call under `.pi/extensions/`; an `auth.json` `!command` resolves twice with one stub invocation | unit | `npx vitest run tests/unit/command-interpolation.test.ts` | ❌ Wave 1 |
| PROV-03 | Composed `model.compat` deep-equals the intended object; loopback request body has `enable_thinking` + `reasoning_effort` + `max_tokens`, and lacks `store` / `developer` / `strict` / `prompt_cache_*`; installed `pi-ai` still has no `aliyuncs` branch | unit + integration | `npx vitest run tests/unit/dashscope-compat.test.ts tests/integration/dashscope-payload.test.ts` | ❌ Waves 1–2 |
| PROV-04 | `getProviderAuth("amazon-bedrock")` returns `source: "stored credential"` with `env.AWS_PROFILE` set from a temp `auth.json`; `undefined` when absent | unit | `npx vitest run tests/unit/bedrock-auth.test.ts` | ❌ Wave 1 |
| PROV-05 | Surfaced `errorMessage` contains `aws sso login --profile <resolved>`; `faux.state.callCount === 1`; `isRetryableAssistantError(rewritten) === false` for all six fixtures | integration | `npx vitest run tests/integration/sso-classifier.test.ts` | ❌ Wave 3 |
| PROV-06 | `dashscope/deepseek-v4-flash.contextWindow === 393216` while `deepseek/deepseek-v4-flash.contextWindow === 1000000`; every all-zero-cost model is on `COST_UNVERIFIED` **and** named in the runbook | unit | `npx vitest run tests/unit/model-metadata.test.ts` | ❌ Wave 1 |
| PROV-07 | `clampThinkingLevel(model,"low")` is `"high"` without the override and `"low"` with it | unit | `npx vitest run tests/unit/r1-unclamp.test.ts` | ❌ Wave 1 |
| PROV-08 | For each of quota/transient/unavailable, the second chain entry is attempted exactly once; for `fatal`, it is not attempted at all (`faux.state.callCount` per provider) | integration | `npx vitest run tests/integration/fallback-chain.test.ts` | ❌ Wave 3 |
| PROV-09 | Every `RB-03-xx` has an `OUTSTANDING` table row **and** an `OUTSTANDING` `**Status:**` line, names its commands verbatim, and cites an existing test path | unit | `npx vitest run tests/unit/docs-policy.test.ts` | ✅ extend |
| PROV-10 | On a replayed two-turn context, the loopback body's assistant message carries `reasoning_content` | integration | `npx vitest run tests/integration/dashscope-payload.test.ts` | ❌ Wave 2 |

**Sampling rate**

- **Per task commit:** `npm run test:unit` + `npm run typecheck`. Unit tests here are pure-function and file-structural; both run in seconds.
- **Per wave merge:** `npm test` (full suite, including the loopback integration test and the bootstrap installer test under a temp `PI_CODING_AGENT_DIR`).
- **Phase gate:** full suite green **and** `docs-policy.test.ts` green with all five RB-03 ids OUTSTANDING, before `/gsd:verify-work`.

**Signals that are unobservable offline** — each maps to exactly one runbook id, and no offline test may be written that appears to cover them:

| Unobservable | Why | Owner |
|---|---|---|
| DashScope accepts the emitted body | needs a live key and egress | RB-03-01 |
| The second turn of a tool sequence returns 200 | the 400 is provider-side | RB-03-02 |
| `AWS_PROFILE` survives a fresh shell and the AWS SDK resolves a live SSO token | needs the work laptop's `~/.aws` | RB-03-03 |
| Whether `low` yields fewer reasoning tokens | needs two live DeepSeek turns | RB-03-04 |
| Real context cap and price | console/provider-side | RB-03-05 |
| Whether a live SSO expiry produces a string the classifier matches | the classifier is proven against strings this repo wrote | folded into RB-03-03's expected output |

**Wave 0 gaps**

- [ ] `tests/helpers/faux.ts` — add `wrapFauxWithStatus` (covers PROV-08)
- [ ] `tests/helpers/models.ts` — `withModelsConfig()` returning a `ModelRuntime` over an arbitrary `modelsPath`/`authPath` (covers PROV-01/03/04/06/07)
- [ ] `tests/helpers/loopback.ts` — `withLoopbackCompletions(handler)` binding `127.0.0.1` (covers PROV-03/10)
- [ ] `tests/unit/template-tracked.test.ts` — `git check-ignore` + `git ls-files` over both templates (covers Trap T1)
- Framework install: **none** — `vitest@4.1.9` is already pinned and configured.

---

## Sources

### Primary (HIGH confidence — original TypeScript recovered from shipped sourcemaps, and Pi's own `docs/`)

- `pi-ai 0.84.1 src/api/openai-completions.ts` — `detectCompat` `:1443-1536`, `getCompat` `:1542-1575`, `store` `:711-713`, max-tokens field `:715-721`, tools `:730-738`, thinking branches `:748-845`, thinking-token budget `:851-866`, developer role `:1083-1085`, `reasoning_content` `:1223-1229`, `convertTools` `:1337-1372`, usage `:1374-1410`
- `pi-ai 0.84.1 src/api/bedrock-converse-stream.ts` — `onPayload` `:247`, `onResponse` `:253-261`, catch/`formatBedrockError` `:310-322`, `BEDROCK_ERROR_PREFIXES` `:335-341`, `formatBedrockError` `:357-374`
- `pi-ai 0.84.1 src/api/constrained-sampling.ts:84-99` — `resolveJsonSchemaStrictSampling`
- `pi-ai 0.84.1 src/providers/amazon-bedrock.ts:12-77` — login options and `resolve()` order
- `pi-ai 0.84.1 src/providers/deepseek.ts:6-15`, `src/providers/qwen-token-plan.ts:6-15`
- `pi-ai 0.84.1 dist/providers/data/deepseek.json`, `dist/providers/data/amazon-bedrock.json` — catalogues dumped verbatim
- `pi-ai 0.84.1 src/providers/faux.ts` — `FauxProviderState` `:101-105`, `createErrorMessage` `:305-317`, `callCount`/hard-coded 200 `:502-512`, error push `:423-431`
- `pi-ai 0.84.1 src/utils/retry.ts` — pattern tables `:6-88`, `retryAssistantCall` `:113-201`, `isRetryableAssistantError` `:206-212`
- `pi-ai 0.84.1 src/models.ts:900-932` — `getSupportedThinkingLevels`, `clampThinkingLevel`
- `pi-ai 0.84.1 src/types.ts:538-598` (`OpenAICompletionsCompat`, 24 fields), `:785-814` (`Model`)
- `pi-ai 0.84.1 src/auth/types.ts:102-109` — `AuthResult`
- `pi 0.84.1 src/config.ts:491-536` — `CONFIG_DIR_NAME`, `getAgentDir`, `getModelsPath`, `getAuthPath`
- `pi 0.84.1 src/core/model-config.ts:54-110` (compat schema), `:156-208` (model/provider/override schemas), `:245-284` (`ModelConfig.load`)
- `pi 0.84.1 src/core/provider-composer.ts:46-71` (`ProviderConfigInput`), `:81-101` (`mergeCompat`), `:103-128` (`applyModelOverride`), `:130-166` (`modelFromJson`), `:168-206` (`applyModelsJson`), `:208-235` (`applyExtension`), `:272-285`, `:301-365` (`composeApiKeyAuth`), `:420-523` (`composeModelProvider`)
- `pi 0.84.1 src/core/resolve-config-value.ts:139-146`, `:196-204`, `:208-243` — cached vs uncached
- `pi 0.84.1 src/core/auth-storage.ts:236-268` (`ReadOnlyAuthStorage`), `:442-448` (`AuthStorage.read`)
- `pi 0.84.1 src/core/agent-session.ts:609-696`, `:710-724`, `:762-780`, `:1076-1103`, `:2087`
- `pi 0.84.1 src/core/extensions/runner.ts:835-875` — `emitMessageEnd`
- `pi 0.84.1 src/core/model-registry.ts:47-117` — `find`, `getProviderAuth`, `complete`
- `pi 0.84.1 src/core/model-runtime.ts:76-88`, `:215-275`, `:404-420`, `:561-571`
- `pi 0.84.1 src/cli/list-models.ts` — what `--list-models` prints and that it uses `getAvailable`
- `pi 0.84.1 docs/extensions.md:1705-1845` (`registerProvider`), `docs/models.md` (interpolation + no-caching-in-models.json), `docs/providers.md` (auth.json shapes, `sk-sp-`, 0600), `docs/settings.md:136-160` (retry)

### Secondary (MEDIUM-HIGH — official vendor documentation, fetched 2026-08-13)

- alibabacloud.com/help/en/model-studio/deepseek-api — base URLs incl. workspace-dedicated Singapore; model ids; **"393,216 in total"**; `enable_thinking`; `reasoning_effort` `high`/`max` default `high`; `max_tokens`
- alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope — legacy vs dedicated domains and the dedicated-domain recommendation; the supported-parameter list (`max_tokens` present; `max_completion_tokens`, `store`, `strict`, `developer` absent); "API keys differ by region"
- api-docs.deepseek.com/guides/thinking_mode/ — `reasoning_effort` values **`low` / `high` / `max`**; `thinking:{type:…}`; sampling params unsupported in thinking mode
- api-docs.deepseek.com/api/create-chat-completion — `high` default, `medium`/`xhigh` → `high`; `max_tokens` only; `completion_tokens_details.reasoning_tokens`
- alibabacloud.com/help/en/model-studio/models — model ids present (`deepseek-v4-pro`, `deepseek-v4-flash`, `qwen3.7-*`); **no context/price data on this page**

### Executed on this machine (2026-08-13, node 24.16.0)

- Pi's two retry regexes run over 19 representative error strings — the classification table in Q4.3
- `Compile(Type.Object({a: Type.Optional(Type.Boolean())})).Check({a:true, zzz:1}) === true` — typebox permits unknown compat keys
- `git check-ignore -v` over five candidate template filenames — Trap T1

### In-repo

- `.planning/{PROJECT,ROADMAP,REQUIREMENTS,STATE}.md`, `.planning/research/{PITFALLS,ARCHITECTURE,STACK}.md`, `.planning/phases/03-providers-credentials/03-CONTEXT.md`
- `docs/RUNBOOK.md`, `docs/DIAGNOSTICS.md` (esp. `:96`, `:142-151`, `:341-354`)
- `.pi/extensions/diagnostics/{call-model,schema}.ts`, `tests/helpers/{faux,session}.ts`, `tests/unit/docs-policy.test.ts`, `bin/bootstrap.sh`, `.gitignore`, `vitest.config.ts`, `package.json`

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | `maxTokens: 65536` for DashScope-served DeepSeek V4 | Q2.4 | Output truncated below the real cap. Bounded: Pi sends `max_tokens` only when the caller sets it. RB-03-05. |
| A2 | DeepSeek models are reachable on the legacy `dashscope-intl.aliyuncs.com` Singapore domain | Q5.5/Q5.6 | RB-03-01 fails at DNS/404. Remedy already designed: set `KYPI_DASHSCOPE_BASE_URL`, re-run bootstrap. |
| A3 | `supportsStrictMode: false` is the right conservative setting for DashScope | Q7 | Forgoes strict schemas on the DashScope path until Phase 10. One-key reversal; the loopback test already covers the emission either way. |
| A4 | `supportsLongCacheRetention: false` for DashScope | Q2.2 | Loses long prompt-cache retention **if** DashScope actually supports `prompt_cache_retention`. Undocumented; the conservative side is the one that cannot 400. |
| A5 | The "materially fewer" threshold for R1 is `low.reasoning ≤ 0.6 × high.reasoning` | Q6.2 | An arbitrary but pre-committed line. Pre-committing is the point: choosing it after seeing the numbers is how a null result becomes a positive one. |
| A6 | Project-scoped extensions do not load in subagents | Q1.3 | If wrong, option (b) becomes viable. Recorded as SAFE-11 and restated in `tests/helpers/session.ts`; **not re-verified in this session** — treated as a locked project decision. |
| A7 | The chain's second hop uses the same model id on DashScope (`deepseek-v4-flash`) | Q4.5 | If DashScope's id differs, `registry.find` returns `undefined` and the hop is skipped silently. Mitigation: the chain test asserts every entry resolves. |

---

## Open Questions (RESOLVED — disposition recorded for each; no further desk work required)

Each of the four carries a concrete handling decision below. None is reopened here: three are
deferred to a live runbook check (`RB-03-01`, `RB-03-04`) because no amount of reading settles
them, and the fourth is a design choice the planner made and stated in the plan text.

1. **Does DashScope serve DeepSeek on the legacy Singapore domain?** Known: the compatibility page lists `dashscope-intl.aliyuncs.com` as legacy-but-functional; the DeepSeek page lists Singapore only in workspace-dedicated form. Unclear: whether the legacy host routes DeepSeek model ids. Handling: template the legacy host, ship the `KYPI_DASHSCOPE_BASE_URL` escape hatch, and make it the first troubleshooting line in RB-03-01. **Resolved — deferred to RB-03-01 (OUTSTANDING); no further action required.**
2. **`thinkingFormat: "qwen"` vs `"deepseek"` for DeepSeek-on-DashScope.** Known: Alibaba documents `enable_thinking`, and upstream `pi#6998` closed in favour of `qwen`. Unclear: whether DashScope *also* accepts the `thinking:{type}` object. Handling: ship `"qwen"`, and make RB-03-01's expected output name the key explicitly so a mismatch is a one-key fix with the test already written. **Resolved — deferred to RB-03-01 (OUTSTANDING); no further action required.**
3. **Does `deepseek-v4-flash` report `completion_tokens_details.reasoning_tokens` through Pi's adapter at all?** Known: the adapter reads it (`:1404`) and the turns row carries it. Unclear: whether the provider populates it. Handling: recorded as R1's fourth outcome — an absent `reasoning` key on both legs is a result, not a failed run. **Resolved — deferred to RB-03-04 (OUTSTANDING); no further action required.**
4. **`wrapFauxWithStatus` double-firing `onResponse`.** Known: faux's own 200 always fires. Unclear: whether the test wants it suppressed. Handling: the planner picks one and states it in the task; a double fire writes two `*.response` records under one correlation id. **Resolved by plan 03-01 Task 1: substitute `onResponse` rather than pre-calling it, so faux's hard-coded 200 is rewritten and exactly one status fires. No further action required.**

---

## Metadata

**Confidence breakdown**

- Configuration mechanics (paths, schemas, merge order, interpolation, caching): **HIGH** — read at source, multiple call sites cross-checked.
- `compat` field semantics and emission: **HIGH** — every field traced to its emission line.
- Retry / `message_end` ordering: **HIGH** — verified at source and the regex table was executed.
- DashScope runtime behaviour: **MEDIUM** for the documented parameter list and 393,216 (official vendor docs); **LOW** for cost, max output, and legacy-domain DeepSeek availability — all three are RB-03-05/RB-03-01.
- R1: **HIGH** on both sub-questions separately; **OPEN-BY-DESIGN** on the token count, which is the only thing PROV-07 asks.

**Research date:** 2026-08-13
**Valid until:** 2026-09-12 for the Pi-source findings (they are pinned to `0.84.1`; re-verify on any Pi bump — `detectCompat` gaining an `aliyuncs` branch is the specific regression, and the phase ships a test for it). **7 days** for the Alibaba documentation figures — Model Studio pages move.
