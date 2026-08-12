# Stack Research

**Domain:** Personalised coding-agent harness built on Pi (`@earendil-works/pi-coding-agent`)
**Researched:** 2026-08-13
**Confidence:** HIGH for everything derived from the shipped Pi package (docs + `.d.ts` + provider source, all read directly from the `0.84.1` npm tarball); HIGH for all npm/GitHub version and maintenance data (queried live); MEDIUM for third-party extension *behaviour* claims (README-derived, not executed); explicitly flagged where LOW.

**Method note.** Rather than trusting training data or blog posts, I downloaded and unpacked the actual tarballs:

- `@earendil-works/pi-coding-agent@0.84.1` — ships `docs/` (35 files, 12,196 lines) and `examples/` in the published package
- `@earendil-works/pi-ai@0.84.1` — ships every provider implementation and the built-in model catalogue as JSON

Every claim about Pi's API, provider wire format, theme schema and event list below is read out of those files, not inferred. Where a claim in `PROJECT.md` turned out to be **wrong**, it is called out in a dedicated section.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@earendil-works/pi-coding-agent` | **0.84.1** (published 2026-08-07) | The harness host | The thing being extended. MIT. Node `>=22.19.0`. `legacy-node20` dist-tag pinned at `0.74.2` if you ever need Node 20 — do not use it, it is 10 minor versions stale. |
| Node.js | **≥ 22.19.0** | Runtime | Hard `engines` requirement in Pi's `package.json`. Local machine has v24.16.0 — fine. Pin `22.x` **and** `24.x` in the CI matrix; Pi is built and tested on both. |
| TypeScript | **5.9.3** | Extension authoring | **Deliberately not latest.** `typescript@7.0.2` is current and several extension authors use it (`pi-lens`, `pi-web-access`, `cc-safety-net` are on `^7.0.2`), but Pi itself pins `5.9.3` in devDependencies. Type-only compatibility with Pi's shipped `.d.ts` is the thing that matters; match Pi. Revisit when Pi moves. |
| `typebox` | **1.3.7** (peer, `"*"`) | Tool parameter schemas | **Critical:** the unscoped `typebox` package, currently `1.3.13`. **Not** `@sinclair/typebox` (that is the legacy scoped package, stuck at `0.34.52`, and Pi does not use it). Pi bundles `typebox@1.3.7`; you must declare it in `peerDependencies` with `"*"` and must not bundle it. |
| `jiti` | **2.7.0** (bundled by Pi) | TS loading, no build step | Pi loads extensions through jiti. **You never compile.** Ship `.ts` directly and point `pi.extensions` at it. Do not add a build step; it buys nothing and breaks `/reload`. |
| `vitest` | **4.1.9** | Testing | Pi core itself uses `vitest@4.1.9`. Latest is `4.1.10`. Vitest is also the plurality choice among extension authors (8 of 15 surveyed). Pin `4.1.9` to match Pi exactly. |
| `unbash` | **4.0.10** | Bash AST parsing for the safety layer | ISC, **zero dependencies**, 35.8M downloads/month, published 2026-08-09. This is the answer to `PROJECT.md`'s "the `tool_call` hook is a string matcher, trivially defeated (`g=push; git $g`, `sh -c`, heredocs)". Parse the command, walk the AST, match on resolved command nodes. `@ramtinj95/pi-infra-command-guard` already does exactly this — see below. |
| Git Bash | Any current | Windows shell | Pi hard-requires a bash on Windows. See the Windows section for the exact resolution order (which the docs under-specify). |

### Peer Dependencies (declare, never bundle)

Pi's `packages.md` is explicit: *"Pi bundles core packages for extensions and skills. If you import any of these, list them in `peerDependencies` with a `"*"` range and do not bundle them."*

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  }
}
```

Bundling any of these produces a second module instance, which breaks `instanceof` checks and type identity across the extension boundary.

---

## 1. Pi Extension Authoring API — verified at 0.84.1

### The 33 events — complete and exact

Extracted from `dist/core/extensions/types.d.ts`, the `ExtensionAPI.on()` overload list (lines 867–899). The list in the research question is **exactly right and exactly complete** — all 33, no more, no fewer.

| Event | Return type | Can block/cancel? | Return shape |
|-------|-------------|-------------------|--------------|
| `project_trust` | `ProjectTrustEventResult` | **Decides trust** | `{ trusted: "yes" \| "no" \| "undecided", remember?: boolean }` — **required** return. First yes/no wins, suppresses built-in prompt. Only user/global + CLI `-e` extensions participate. |
| `resources_discover` | `ResourcesDiscoverResult` | no | `{ skillPaths?, promptPaths?, themePaths? }` |
| `session_start` | — | no | ignored |
| `session_info_changed` | — | no | ignored |
| `session_before_switch` | `SessionBeforeSwitchResult` | **cancel** | `{ cancel?: boolean }` |
| `session_before_fork` | `SessionBeforeForkResult` | **cancel** | `{ cancel?: boolean, skipConversationRestore?: boolean }` |
| `session_before_compact` | `SessionBeforeCompactResult` | **cancel** | `{ cancel?: boolean, compaction?: CompactionResult }` |
| `session_compact` | — | no | ignored |
| `session_before_tree` | `SessionBeforeTreeResult` | **cancel** | `{ cancel?, summary?: {summary, details?, usage?}, customInstructions?, replaceInstructions?, label? }` |
| `session_tree` | — | no | ignored |
| `session_shutdown` | — | no | ignored |
| `context` | `ContextEventResult` | **rewrites context** | `{ messages?: AgentMessage[] }` — `event.messages` is a deep copy, safe to mutate |
| `before_provider_request` | `unknown` | **replaces payload** | Return `undefined` to keep; any other value **replaces the payload** for later handlers and the actual request |
| `before_provider_headers` | — | **mutate in place** | Mutate `event.headers`; string = set/override, `null` = delete. Fires once per request; **retries reuse headers and do not re-fire.** |
| `after_provider_response` | — | no | `event.status`, `event.headers` (normalised), before stream body is consumed |
| `before_agent_start` | `BeforeAgentStartEventResult` | **rewrites system prompt** | `{ message?: Pick<CustomMessage,"customType"\|"content"\|"display"\|"details">, systemPrompt?: string }` — `systemPrompt` **chains** across extensions |
| `agent_start` / `agent_end` / `agent_settled` | — | no | ignored |
| `turn_start` / `turn_end` | — | no | ignored |
| `message_start` / `message_update` | — | no | ignored |
| `message_end` | `MessageEndEventResult` | **replaces message** | `{ message?: AgentMessage }` — replacement **must keep the same `role`** |
| `tool_execution_start` / `_update` / `_end` | — | no | ignored |
| `model_select` | — | no | ignored |
| `thinking_level_select` | — | no | **explicitly notification-only**, returns ignored |
| `tool_call` | `ToolCallEventResult` | **BLOCK** | `{ block?: boolean, reason?: string, terminate?: boolean }`. `event.input` is **mutable in place**; mutations affect real execution and **no re-validation occurs**. `terminate` only applies to a blocked call and only stops the agent when *every* finalized result in the batch terminates. |
| `tool_result` | `ToolResultEventResult` | **modifies result** | `{ content?, details?, isError?, usage? }` — partial patch, middleware-chained in load order |
| `user_bash` | `UserBashEventResult` | **intercepts** | `{ operations?: BashOperations }` or `{ result?: BashResult }` |
| `input` | `InputEventResult` | **handles** | `{ action: "continue" \| "transform" \| "handled", text?, images? }` — first `"handled"` wins; transforms chain |

**Ordering fact that matters for the safety layer:** in the default parallel tool mode, sibling tool calls are *preflighted sequentially* then *executed concurrently*. `tool_call` is **not** guaranteed to see sibling tool results from the same assistant message in `ctx.sessionManager`. Do not write a guard that depends on seeing a sibling's result.

**Ordering fact that matters for the wire inspector:** `before_provider_headers` fires once per provider request and **retries reuse the same headers rather than re-firing**. If you count requests by counting header-hook invocations you will undercount retries. `before_provider_request` fires per payload build; `after_provider_response` fires per HTTP response. Use `after_provider_response` to count actual attempts.

### Registration API — complete list

`pi.on`, `pi.registerTool`, `pi.registerCommand`, `pi.registerShortcut`, `pi.registerFlag`, `pi.getFlag`, `pi.registerMessageRenderer`, `pi.registerMarkdownTransformer`, `pi.registerEntryRenderer`, `pi.registerProvider`, `pi.unregisterProvider`, `pi.sendMessage`, `pi.sendUserMessage`, `pi.appendEntry`, `pi.setSessionName`, `pi.getSessionName`, `pi.setLabel`, `pi.getCommands`, `pi.exec`, `pi.getActiveTools`, `pi.getAllTools`, `pi.setActiveTools`, `pi.setModel`, `pi.getThinkingLevel`, `pi.setThinkingLevel`, `pi.events`.

Notes that change design:

- `pi.registerTool()` **works after startup**, from `session_start`, command handlers, or any event handler. New tools are live in the same session without `/reload`. This is the mechanism for progressive disclosure — register everything, keep most inactive, activate on demand via `pi.setActiveTools()`.
- **Dynamic tool loading is a first-class, documented feature.** Register all tools, keep a loader tool active, and have the loader call `pi.setActiveTools([...current, ...matched])`. Pi records the additions on the tool result and exposes the new definitions before the next model request. Anthropic 4.5+ and OpenAI `gpt-5.4`+ get native deferred loading (`defer_loading` / `tool_search_call`); everything else falls back to sending the full active list. **This is the sanctioned answer to context pollution** and it is better than the skill-only approach.
- Warning that directly serves the "bloated system prompt" hypothesis: activating a tool that has `promptSnippet` or `promptGuidelines` **rebuilds the system prompt**, invalidating the provider cache prefix. Pi's docs say lazily-loaded tools *"should usually rely on their tool `description` and omit active-only prompt metadata."*
- `promptGuidelines` bullets are appended **flat** into the `Guidelines` section with no tool-name prefix. Every guideline must name its own tool. Writing "Use this tool when…" is a documented mistake.
- `pi.registerProvider()` calls made during the factory are **queued and flushed** after the runner initialises; calls made later (e.g. from a command handler) take effect immediately with no `/reload`.
- `ctx.reload()` is only available on `ExtensionCommandContext` (commands), not `ExtensionContext` (tools/events), because it can deadlock. Treat it as terminal: `await ctx.reload(); return;`.
- `pi.exec(command, args, options)` → `{ stdout, stderr, code, killed }`.

### `ctx` — the full surface

| Member | Notes |
|--------|-------|
| `ctx.ui` | See next table |
| `ctx.mode` | `"tui" \| "rpc" \| "json" \| "print"` |
| `ctx.hasUI` | `true` in tui **and rpc**; `false` in json and print |
| `ctx.cwd` | Use with `CONFIG_DIR_NAME` (exported) instead of hardcoding `.pi` |
| `ctx.isProjectTrusted()` | Includes temporary and CLI trust overrides, not just `trust.json` |
| `ctx.sessionManager` | Read-only. `getEntries()`, `getBranch()`, `buildContextEntries()`, `getLeafId()`, `getLabel()`, `getSessionFile()`, `getSessionId()` |
| `ctx.modelRegistry` | `.find()`, `.getAvailable()`, `.getProvider(id)`, `.getProviderAuth(id)` → resolves key/headers/baseUrl/env **without loading a model** |
| `ctx.model`, `ctx.thinkingLevel` | Active model and its effective thinking level |
| `ctx.scopedModels` | Read-only `{ model, thinkingLevel? }[]` from `--models` / `enabledModels`. Empty means "all models usable". **Use this for the model picker**, not `getAvailable()` |
| `ctx.signal` | Agent abort signal; defined during turn events, usually `undefined` when idle. Pass to `fetch()` so Esc cancels |
| `ctx.isIdle()`, `ctx.abort()`, `ctx.hasPendingMessages()` | |
| `ctx.shutdown()` | Graceful; deferred to idle in tui/rpc, no-op in print |
| `ctx.getContextUsage()` | Last assistant usage + estimate for trailing messages |
| `ctx.compact(opts)` | Fire-and-forget with `onComplete` / `onError` |
| `ctx.getSystemPrompt()` | Reflects `before_agent_start` chaining so far. **Does not** include `context` mutations or `before_provider_request` rewrites |
| **Commands only** — `ctx.getSystemPromptOptions()`, `ctx.waitForIdle()`, `ctx.newSession()`, `ctx.fork()`, `ctx.navigateTree()`, `ctx.switchSession()`, `ctx.reload()` | |

**`ctx.ui.*` complete:** `select`, `confirm`, `input`, `editor`, `notify`, `custom` (+ `{overlay, overlayOptions, onHandle}`), `setStatus`, `setWidget` (+ `{placement:"belowEditor"}`), `setFooter`, `setTitle`, `setEditorText`, `getEditorText`, `pasteToEditor`, `setWorkingMessage`, `setWorkingVisible`, `setWorkingIndicator`, `setToolsExpanded`, `getToolsExpanded`, `setEditorComponent`, `getEditorComponent`, `addAutocompleteProvider`, `getAllThemes`, `getTheme`, `setTheme`, `theme`.

Dialogs accept `{ timeout: ms }` (live countdown; `select`→`undefined`, `confirm`→`false`, `input`→`undefined` on timeout) or `{ signal }` to distinguish timeout from user-cancel.

### The session-replacement footgun (worth an ADR)

`ctx.newSession/fork/switchSession` take a `withSession` callback. That callback runs **after** the old session emitted `session_shutdown` and the new extension instance already received `session_start` — but it executes **in the old closure**. Captured `pi` and old `ctx` session-bound objects are stale and **will throw**. Only capture plain data (strings, ids). This will bite the workflow engine; design for it up front.

---

## 2. Packaging — exact `package.json` for `pi install https://github.com/kaiyitkoh/ky-pi-agent`

Verified from `docs/packages.md`.

```json
{
  "name": "ky-pi-agent",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"],
    "image": "https://raw.githubusercontent.com/kaiyitkoh/ky-pi-agent/main/docs/screenshot.png"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "dependencies": {
    "unbash": "4.0.10"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "vitest": "4.1.9",
    "@types/node": "24.12.4"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

**Rules, verbatim from the docs:**

- Paths in `pi.*` are relative to the package root and **support glob patterns and `!exclusions`**.
- If **no** `pi` manifest is present, convention directories are auto-discovered: `extensions/` (`.ts` + `.js`), `skills/` (recursive `SKILL.md` folders + top-level `.md`), `prompts/` (`.md`), `themes/` (`.json`). Declare the manifest anyway — it is explicit and it is where `image`/`video` gallery metadata lives.
- **Runtime deps must be in `dependencies`.** Pi installs packages with `npm install --omit=dev`, so `devDependencies` are unavailable at runtime. (Exception: when `npmCommand` is configured, *git* packages use plain `install`.)
- To depend on another **pi package**, put it in both `dependencies` and `bundledDependencies` and reference it through `node_modules/...` paths in `pi.extensions`. Pi loads packages with separate module roots.
- Include `keywords: ["pi-package"]` for the gallery at `https://pi.dev/packages`.

**Install surfaces that all work:**

```
pi install https://github.com/kaiyitkoh/ky-pi-agent          # raw URL, HEAD
pi install https://github.com/kaiyitkoh/ky-pi-agent@v0.1.0   # pinned tag  ← use this
pi install git:github.com/kaiyitkoh/ky-pi-agent@v0.1.0       # shorthand needs git: prefix
pi install git:git@github.com:kaiyitkoh/ky-pi-agent@v0.1.0   # SSH, respects ~/.ssh/config
pi install /absolute/path/to/repo                            # local dev, no copy
pi install ./relative/path                                   # resolved against the settings file
```

**Version pinning:**

- npm: `npm:@scope/pkg@1.2.3` — versioned specs are **pinned and skipped** by `pi update --extensions` / `--all`.
- git: refs are **pinned tags or commits**. `pi update` does *not* move them forward but *does* reconcile an existing clone to the configured ref (reset + clean + `npm install`). Move deliberately with `pi install git:host/user/repo@new-ref`.
- This is exactly the supply-chain posture `PROJECT.md` asks for. **Never write a bare `npm:pkg` or an unrefed git URL into `settings.json`.**

**Clone/install locations:** git → `~/.pi/agent/git/<host>/<path>` (global) or `.pi/git/<host>/<path>` (project). npm → `~/.pi/agent/npm/` or `.pi/npm/`.

**Coexisting with a bootstrap script.** No conflict, and no special handling needed. Pi only reads `package.json`'s `pi` key and the declared directories. A `bootstrap.sh` at the repo root is invisible to Pi. Structure:

```
ky-pi-agent/
├── package.json          # pi manifest — read by `pi install`
├── bootstrap.sh          # POSIX sh — installs pi, writes settings.json, installs packages
├── extensions/           # authored: safety, router, workflows, wire-inspector
├── skills/  prompts/  themes/
└── config/
    ├── models.json       # template, secrets as $ENV_VAR
    ├── auth.json.example
    └── settings.json     # the pinned `packages` array
```

Scoping note: `install`/`remove` write to `~/.pi/agent/settings.json` by default; `-l` writes to `.pi/settings.json`. Project settings can be committed and **Pi auto-installs missing packages on startup once the project is trusted**. If the same package appears in both scopes, the project entry wins unless it sets `autoload: false`, in which case it applies as a delta over the global entry.

---

## 3. `models.json` — exact schema and verified provider configs

### Schema

Provider fields: `baseUrl`, `api`, `apiKey`, `oauth`, `headers`, `authHeader`, `models`, `modelOverrides`, `compat`.

`api` ∈ `"openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai"` (also `azure-openai-responses` and `openai-codex-responses` appear in compat handling). Settable at provider **or** model level.

Model fields — full table, verified:

| Field | Required | Default | Note |
|-------|----------|---------|------|
| `id` | **yes** | — | passed to the API |
| `name` | no | `id` | used for `--model` matching and secondary detail text; **the footer still shows `id`** |
| `api` | no | provider's | |
| `reasoning` | no | `false` | |
| `thinkingLevelMap` | no | omitted | see below |
| `input` | no | `["text"]` | `["text"]` or `["text","image"]` — **this is the field the capability guard reads** |
| `contextWindow` | no | `128000` | |
| `maxTokens` | no | `16384` | |
| `samplingParams` | no | omitted | free-form, merged **verbatim after** Pi's own fields, so **its keys win**. OpenAI-compatible APIs only |
| `cost` | no | zeros | `{input, output, cacheRead, cacheWrite, tiers?}`, per-million-token; a tier applies to the **whole request** when `input+cacheRead+cacheWrite > inputTokensAbove` |
| `compat` | no | provider's | merged with provider-level `compat` |
| `baseUrl` | no | provider's | per-model endpoint override |

`thinkingLevelMap` is **tristate**, keys `off|minimal|low|medium|high|xhigh|max`:
- **omitted** → standard levels through `high` use the provider default; `xhigh`/`max` unsupported
- **string** → supported, this value is sent
- **`null`** → unsupported; hidden/skipped/clamped away in the UI

(Migration note in the docs: older `compat.reasoningEffortMap` moves to model-level `thinkingLevelMap`.)

### (a) Alibaba DashScope — verified working config

**There is no built-in DashScope/Alibaba provider.** I listed every file in `pi-ai/dist/providers/data/` — the only Alibaba entries are `qwen-token-plan`, `qwen-token-plan-cn`, `qwen-token-plan-individual`, whose `baseUrl` is `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` and whose env var is `QWEN_TOKEN_PLAN_API_KEY`. `PROJECT.md` is correct: this is a different host and a different key namespace. You must define DashScope yourself.

**Endpoints.** Two forms are live:

| Form | URL |
|------|-----|
| Classic international (Singapore) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| Classic China (Beijing) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| **Workspace-dedicated, Singapore** (Alibaba's current recommendation) | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` |
| **Workspace-dedicated, Beijing** | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |

Alibaba's docs now lead with the workspace-dedicated domains ("*The new dedicated domains deliver superior performance and higher stability for inference requests*") and the current pages present them as required for the Beijing / Singapore / Tokyo / Frankfurt / Hong Kong regions. `WorkspaceId` comes from the Model Studio console's Workspace Details page. Env var is `DASHSCOPE_API_KEY`. **Use the workspace-dedicated Singapore domain**; keep `dashscope-intl` documented as the fallback if the workspace domain misbehaves.

**The critical `compat` finding.** Pi's own `qwen-token-plan` catalogue — the same Aliyun `compatible-mode` API surface — sets `thinkingFormat: "qwen"` on **every** model, including the DeepSeek, GLM, Kimi and MiniMax ones. This is not an accident: it was [pi issue #6998](https://github.com/earendil-works/pi/issues/6998), and it is **closed/fixed** in the 0.84.1 catalogue I read.

This matters because of auto-detection. `detectCompat()` in `openai-completions.js` picks `thinkingFormat: "deepseek"` only when `provider === "deepseek"` or the baseUrl contains `deepseek.com`. A custom provider on `*.maas.aliyuncs.com` matches nothing, so it silently defaults to `"openai"` — plain `reasoning_effort`, **no `enable_thinking` at all**. On DashScope that means **thinking is off and you never find out**. You must set `compat.thinkingFormat: "qwen"` explicitly.

What `thinkingFormat: "qwen"` emits (read from source):
```js
params.enable_thinking = !!options?.reasoningEffort;          // top-level
if (reasoningEffort && compat.supportsReasoningEffort)
  params.reasoning_effort = model.thinkingLevelMap?.[level] ?? level;   // top-level
```
Both top-level. Alibaba's docs confirm: `enable_thinking` "is not a standard OpenAI parameter" — the Python SDK passes it via `extra_body`, the Node SDK passes it top-level. Pi builds the JSON body directly, so top-level is correct.

**Verified DashScope config** (mirrors Pi's own `qwen-token-plan` entries, with the DashScope context cap applied):

```json
{
  "providers": {
    "dashscope": {
      "baseUrl": "https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
      "api": "openai-completions",
      "apiKey": "$DASHSCOPE_API_KEY",
      "compat": {
        "thinkingFormat": "qwen",
        "supportsDeveloperRole": false,
        "supportsStore": false
      },
      "models": [
        {
          "id": "deepseek-v4-flash",
          "name": "DeepSeek V4 Flash (DashScope)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 393216,
          "maxTokens": 65536,
          "compat": { "supportsReasoningEffort": true },
          "thinkingLevelMap": {
            "minimal": null, "low": null, "medium": null,
            "high": "high", "xhigh": null, "max": "max"
          }
        },
        {
          "id": "deepseek-v4-pro",
          "name": "DeepSeek V4 Pro (DashScope)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 393216,
          "maxTokens": 65536,
          "compat": { "supportsReasoningEffort": true },
          "thinkingLevelMap": {
            "minimal": null, "low": null, "medium": null,
            "high": "high", "xhigh": null, "max": "max"
          }
        },
        {
          "id": "qwen3.8-max",
          "name": "Qwen3.8 Max (DashScope)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 1000000,
          "maxTokens": 131072,
          "compat": { "supportsReasoningEffort": true },
          "thinkingLevelMap": {
            "minimal": null, "low": "low", "medium": "medium",
            "high": null, "xhigh": "xhigh", "max": null
          }
        }
      ]
    }
  }
}
```

**How DashScope DeepSeek differs from DeepSeek's own API — verified both sides:**

| | DeepSeek direct (`api.deepseek.com`) | DashScope (`*.maas.aliyuncs.com`) |
|---|---|---|
| Pi provider | built-in `deepseek` | you define it |
| `contextWindow` | **1,000,000** | **393,216 total** (Alibaba docs, verbatim: "393,216 in total") |
| `maxTokens` | 384,000 | lower; confirm per model in console |
| thinking enable | `thinking: {"type":"enabled"}` **nested** | `enable_thinking: true` **top-level** |
| `reasoning_effort` | **top-level** | **top-level** |
| `thinkingFormat` | `"deepseek"` (auto-detected) | `"qwen"` (**must be explicit**) |
| effort values | `high`, `max` (default `high`) | `high`, `max` (default `high`); `low`/`medium`→`high`, `xhigh`→`max` server-side |

`contextWindow` is not cosmetic here — it drives Pi's compaction thresholds and your capability guard. Getting it wrong by 2.5× means overflow errors instead of clean compaction.

**Thinking mode disables sampling params.** DeepSeek documents that thinking mode does not support `temperature`, `top_p`, `presence_penalty`, or `frequency_penalty`. Do not set `samplingParams` on a thinking-enabled DeepSeek model.

**⚠️ Do not follow DeepSeek's own "Using DeepSeek with Oh My Pi" page.** It is at `api-docs.deepseek.com/quick_start/agent_integrations/oh_my_pi/` and it is for **Oh My Pi**, a different fork (`~/.omp/agent/models.yml`, whose npm package `@ayulab/oh-my-pi` is on an **archived** repo). It prescribes `supportsToolChoice`, `requiresReasoningContentForToolCalls`, `requiresAssistantContentForToolCalls` and a `models.yml` file. **None of those keys exist in Pi's `compat` schema** — I enumerated the full set from `models.md` and cross-checked against `getCompat()` in `openai-completions.js`. It also says *"Do not rely on the built-in model entries"* — for **Pi**, the built-in `deepseek` entries at 0.84.1 are correct and current (1M/384K, `thinkingFormat:"deepseek"`, `requiresReasoningContentOnAssistantMessages: true`). This is the clearest case in this research of a source contradicting the docs; trust the docs.

### (b) AWS Bedrock with IAM Identity Center SSO — **claim confirmed, with a better option**

Source read verbatim from `pi-ai/dist/providers/amazon-bedrock.js`. `resolve()` returns on the **first** match, in this order:

1. `credential?.key` → stored bearer token
2. `AWS_BEARER_TOKEN_BEDROCK`
3. `credential?.env?.AWS_PROFILE` **or** process env `AWS_PROFILE`
4. `AWS_ACCESS_KEY_ID` **and** `AWS_SECRET_ACCESS_KEY`
5. `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`
6. `AWS_CONTAINER_CREDENTIALS_FULL_URI`
7. `AWS_WEB_IDENTITY_TOKEN_FILE`
8. **`return undefined`**

**Confirmed:** `aws sso login` alone writes an SSO token cache to `~/.aws/sso/cache/` and sets **none** of these variables. Without `AWS_PROFILE` exported, `resolve()` falls through to `undefined` and Bedrock models never appear in `/model`.

**But there is a better fix than exporting an env var.** Step 3 checks `credential?.env?.AWS_PROFILE` *first*. `/login amazon-bedrock` → "AWS profile" stores exactly that:

```js
return { type: "api_key", env: { AWS_PROFILE: <entered profile name> } };
```

So the durable, no-shell-config solution is `auth.json`:

```json
{
  "amazon-bedrock": {
    "type": "api_key",
    "env": { "AWS_PROFILE": "my-sso-profile", "AWS_REGION": "us-east-1" }
  }
}
```

`providers.md` confirms provider-scoped `env` values are used **before** process environment variables when resolving keys, headers and provider configuration "such as … Bedrock settings". This is strictly better for a work laptop: it survives a fresh shell, it does not leak `AWS_PROFILE` into unrelated tooling, and it contains no secret so it can be templated in-repo.

**Expired-SSO detection is on you.** `resolve()` only checks env-var *presence*, never token validity. Expired SSO passes `resolve()` and fails later inside the AWS SDK as an opaque provider error. The harness must preflight — e.g. `aws sts get-caller-identity --profile $P` on `session_start` and before any Bedrock-routed turn — and translate a failure into "run `aws sso login --profile $P`". Confirms the `PROJECT.md` requirement; there is no built-in support for it.

**Other Bedrock facts:** region defaults to `us-east-1` (`AWS_REGION` overrides); proxy via `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`, `AWS_BEDROCK_SKIP_AUTH=1`, `AWS_BEDROCK_FORCE_HTTP1=1`; prompt caching is auto-detected from the model id/name and needs `AWS_BEDROCK_FORCE_CACHE=1` for application inference profile ARNs.

**Bedrock thinking on non-Anthropic models — `PROJECT.md`'s claim CONFIRMED at source.** From `api/bedrock-converse-stream.js`:

```js
function buildAdditionalModelRequestFields(model, options) {
    if (!options.reasoning || !model.reasoning) return undefined;
    if (isAnthropicClaudeModel(model)) { /* adaptive or budget_tokens thinking */ }
    return undefined;                       // ← every non-Claude model
}
```

Extended thinking is requested **only** for Anthropic Claude on Bedrock. Everything else silently gets no thinking config. `isAnthropicClaudeModel()` matches `anthropic.claude` / `anthropic/claude` in the id, or `claude` in the `name` — so for an application inference profile ARN you can force correct handling by setting `name` to something containing `claude`. Adaptive thinking (`thinking.type:"adaptive"` + `output_config.effort`) is used for opus-4-6/4-7/4-8/5, sonnet-4-6/5, fable-5; older Claude gets `budget_tokens` plus the `interleaved-thinking-2025-05-14` beta.

---

## 4. `auth.json` — interpolation, escaping, caching, precedence

File: `~/.pi/agent/auth.json`, created `0600`.

**Interpolation, identical grammar in `auth.json` `key`, `models.json` `apiKey`, and `models.json` `headers` values:**

| Form | Meaning |
|------|---------|
| `"!command"` | leading `!` executes **the whole value** as a shell command, stdout is the value |
| `"$ENV_VAR"` | environment variable |
| `"${ENV_VAR}"` | same, brace form |
| `"${KEY_PREFIX}_${KEY_SUFFIX}"` | interpolation works **inside larger literals** |
| `"$$..."` | escape → literal `$` |
| `"$!..."` | escape → literal `!`, no command execution |
| `"sk-..."`, `"MY_API_KEY"` | literal. **A bare uppercase string is a literal, not a variable.** |

`$FOO_BAR` parses as the variable `FOO_BAR`. Use `${FOO}_BAR` when `_BAR` is literal text. **A missing environment variable leaves the value unresolved** (it does not become empty string).

**Caching — the two files differ, and this is a real operational difference:**

| File | `!command` caching |
|------|--------------------|
| `auth.json` | **cached for the process lifetime** |
| `models.json` | **resolved at request time, every request, no caching** |

`models.md` is explicit that this is deliberate: *"pi intentionally does not apply built-in TTL, stale reuse, or recovery logic for arbitrary commands… If your command is slow, expensive, rate-limited, or should keep using a previous value on transient failures, wrap it in your own script."* Practical consequence: **put `!`-commands in `auth.json`, not `models.json`.** A `!aws ...` or `!op read ...` in `models.json` runs on every single provider request.

Also: `/model` availability checks use *configured auth presence* and **do not execute shell commands**. A model backed by a `!command` shows as available without the command ever running.

**Precedence — canonical, from `providers.md` §Resolution Order:**

1. CLI `--api-key`
2. `auth.json` (API key or OAuth token)
3. Environment variable
4. Custom provider `apiKey` from `models.json`

The SDK's `ModelRuntime` adds one above all of these: **runtime overrides** via `setRuntimeApiKey()` (not persisted). So the full chain is: runtime override → `--api-key` → `auth.json` → env → `models.json`.

**Provider-scoped `env`.** Any `api_key` credential may carry an `env` object. Those values are used **before** process env when resolving the key, provider/model headers, and provider config (Cloudflare account ids, Azure settings, Vertex project/location, **Bedrock settings**, `PI_CACHE_RETENTION`, `HTTP_PROXY`/`HTTPS_PROXY`). This is the mechanism that makes the Bedrock `AWS_PROFILE` fix above work, and it is the right place for anything that shouldn't leak into the project shell.

**For the public repo:** commit `config/auth.json.example` containing only `$VAR` / `!command` references and `env` scaffolding. Never commit `auth.json`. Add it to `.gitignore` explicitly.

---

## 5. Qoder official API — **negative finding, verified three ways**

### What the official API actually is

| | |
|---|---|
| PAT format | `pt-…`, generated at `qoder.com/account/integrations`, shown once |
| Env var | `QODER_PERSONAL_ACCESS_TOKEN` |
| Cloud Agents base URL | `https://api.qoder.com/api/v1/cloud` |
| Auth header | `Authorization: Bearer pt-your-token-here` |
| Agent SDK | TypeScript + Python, entry point `query()`, `accessTokenFromEnv()`, async iteration over `'assistant'` / `'result'` messages, its own `Read/Write/Edit/Glob/Grep/Bash` tools, `allowedTools` and `permissionMode` |

### Can you write a Pi custom provider against it? **No.**

Pi's provider contract needs a **token-streaming chat API** — one of `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`, or a hand-written `streamSimple`. Qoder's official surface is **agent-task orchestration**, not inference:

- Cloud Agents is "a fully managed runtime for AI agents": define an Agent (model + system prompt + tools) → configure an Environment (container) → start a Session → send `user.message` → stream **high-level events** (thinking, messages, status changes) over SSE. Cursor-paginated `{data, first_id, last_id, has_more}` responses.
- The Agent SDK's `query()` runs a **hosted agent loop with its own tools**.
- I fetched `docs.qoder.com/llms.txt` (the full documentation index) and confirmed: agent/session/deployment/environment/skill/vault/memory management, "model listing and selection" scoped to agent configuration, and **no page describing an OpenAI-compatible endpoint, chat completions API, or model inference gateway**.

A `streamSimple` shim over the Cloud Agents SSE is technically writable but is a category error: Qoder's agent runs its own tool loop in its own container, so Pi's tools, `AGENTS.md` context, system prompt, safety hooks and wire inspector would all be bypassed. That is Pi wrapping a foreign agent, not Pi using a model.

**What is viable:** a Pi **extension registering a delegate tool** — `qoder_task({ prompt, repo })` → create session via `POST /api/v1/cloud/...` → stream SSE → return the result as tool content. Qoder becomes a *subagent*, not a routing-table entry. This means **Qoder cannot participate in role→model routing or in a provider fallback chain**, which changes the `PROJECT.md` requirement "Provider fallback chains … (Qoder → Aliyun)". That chain is not constructible against the official API.

### Is there an existing `pi-*-qoder` using the official API? **No. Both are bypass proxies.**

| Package | Version | dl/mo | Repo | Verdict |
|---|---|---|---|---|
| `pi-provider-qoder` | 0.3.0 (2026-07-30) | 987 | `simonsmh/pi-provider-qoder` (14★) | **bypass** |
| `pi-qoder-provider` | 0.2.2 (2026-07-20) | 160 | `minglu6/pi-provider-qoder` (0★) | **bypass**, near-identical description — a copy |

I unpacked `pi-provider-qoder@0.3.0`. Its README lists:

- `**WAF Bypass**: Built-in WAF obfuscation and body encoding (`Encode=1`)`
- `**COSY Signing**: Full COSY signature header generation (RSA/AES-CBC/MD5)`
- source file `qoder-encoding.ts # WAF bypass body encoder`

Every URL in its bundle points at the IDE's internal gateway — `gateway.qoder.sh`, `gateway.qoder.com.cn`, `openapi.qoder.sh`, `api3.qoder.sh`, `center.qoder.sh`. **Not one reference to `api.qoder.com/api/v1/cloud`.** `PROJECT.md`'s decision to exclude these is correct, and now has source evidence rather than inference.

**Confidence: HIGH.** Fully verified from official docs + the package bundle.

---

## 6. Extensions to install — verified against npm and GitHub on 2026-08-13

All versions, download counts (last 30 days, npm downloads API) and `pushed_at` dates queried live.

### Recommended set

| # | Category | **Install** | Version | dl/mo | Repo (★) | Last push | Size | Why it wins |
|---|---|---|---|---|---|---|---|---|
| 1 | Subagents | **`pi-subagents`** | **0.47.1** | **213,951** | `nicobailon/pi-subagents` (3,110★) | 2026-08-12 | 3.4 MB | 5× the downloads of the next option. Has *all four* required features **plus** worktree isolation **built in** (no bridge). Also ships `contact_supervisor` — a native child→parent channel that is exactly the "advisor escalation" requirement. **20 releases in 30 days** — compose, never fork. |
| 2 | Plan mode | **`@narumitw/pi-plan-mode`** | **0.49.3** | 19,180 | `narumiruna/pi-extensions` (315★) | 2026-08-12 | 180 KB | "Codex-like read-only `/plan` collaboration mode" — closest fit to Claude Code plan mode. Peer-only Pi deps. Same author as the LSP pick, so one vendor to review. |
| 3 | Todo | **`@juicesharp/rpiv-todo`** | **2.4.0** | 43,055 | `juicesharp/rpiv-mono` (600★) | 2026-08-11 | 103 KB | Live overlay that **survives `/reload`**. Small. Same monorepo as the ask-user pick. |
| 4 | Ask user | **`@juicesharp/rpiv-ask-user-question`** | **2.4.0** | **51,649** | `juicesharp/rpiv-mono` (600★) | 2026-08-11 | 237 KB | Highest downloads in a crowded category (10 credible competitors). Same vendor as todo. |
| 5 | Background bash | **`pi-background-tasks`** | **2.3.0** | 26,886 | `ismailsaleekh/pi-background-tasks` (8★) | 2026-08-12 | 1.6 MB | Durable background shell tasks, 17 releases/30d, pushed today. Only real competitor is stale. **Filter it** — it also ships "read-only delegated agents" that duplicate `pi-subagents`. |
| 6 | LSP / diagnostics | **`@narumitw/pi-lsp`** | **0.49.4** | 16,116 | `narumiruna/pi-extensions` (315★) | 2026-08-12 | **76 KB, 13 files, 0 runtime deps** | Registers exactly **two** LLM-facing tools (`lsp_diagnostics`, `lsp_fix`); the other 17 entries are LSP *server configs*, not tools. Fully auditable in one sitting. See the `pi-lens` note below. |
| 7 | Loop detection | **`pi-loop-police`** | **1.14.1** | 3,324 | `sebaxzero/pi-loop-police` (11★) | 2026-08-11 | 107 KB, 0 deps | Only credible option. Keywords are literally `qwen`, `deepseek` — built for this exact failure mode. 12 releases/30d. ⚠️ **no LICENSE file on the repo** despite `"MIT"` in `package.json`. Vendor it. |
| 8 | Web access | **`pi-web-access`** | **0.22.0** | **221,973** | `nicobailon/pi-web-access` (1,070★) | 2026-08-12 | 7.2 MB | Genuinely keyless: zero-config Exa, keyless DuckDuckGo, keyless Jina Reader, local `unpdf` PDF extraction. Mandatory — Pi has no web tool and MCP is out of scope. |
| 9 | Session search | **`pi-session-finder`** | **0.5.6** | 2,829 | `pungggi/pi-session-finder` (3★) | 2026-08-02 | 82 KB, 10 files | Does one thing: `/find <keywords>` full-text across projects. Vitest. Scope discipline over `pi-sessions`'s six features. |
| 10 | Themes | **`awesome-pi-themes`** | **1.1.9** | 2,621 | `isashi/awesome-pi-themes` (3★) | 2026-08-10 | 107 KB | **Verified: exactly 36 theme JSONs**, correct `$schema`, 52 colour keys each (51 required + `thinkingMax`). Use as reference material for the authored theme; `pi.themes: ["./themes"]`. |
| 11 | Provider fallback | **`pi-model-fallback`** | **0.3.6** | 682 | `eiei114/pi-model-fallback` (1★) | 2026-08-12 | **49 KB, 10 files** | ⚠️ **LOW confidence — weakest category.** Chosen because it is small enough to read end-to-end in 20 minutes and exactly scoped ("switches to a fallback model after provider failures such as 429"). Treat as a stopgap: `pi-subagents` already has per-agent `fallbackModels`, Pi has built-in `retry` settings, and the authored router should own this. |
| 12 | File checkpointing | **`@davideasden/pi-undo`** | **0.2.11** | 2,278 | `DavidEasden/pi-undo` (—) | 2026-08-05 | 1.2 MB | ⚠️ **LOW confidence — every option here is weak.** Best-maintained *workspace* undo/redo. See the category autopsy below. |

### Categories where I am overriding the question's premise

**Worktree isolation — do not install `@gotgenes/pi-subagents-worktrees`.** Its `peerDependencies` are `{"@gotgenes/pi-subagents": ">=16.4.0"}`, and its README states: *"If `@gotgenes/pi-subagents` is not loaded first (or not installed at all), this extension does nothing."* It is a bridge for a **third** subagents package (`@gotgenes/pi-subagents@19.2.2`, 8,460 dl/mo, self-described "friendly fork of `@tintinweb/pi-subagents`"), not for nicobailon's or tintinweb's. Both of those have worktree isolation **natively** — nicobailon's via `worktree: true` on workflow runs, tintinweb's via `isolation: worktree` in agent frontmatter. **The bridge is unnecessary and would silently no-op.**

**Dangerous-command blocking — author it, per `PROJECT.md`.** This sits in the tool-execution path on a laptop with live AWS SSO credentials for an auto-deploying account, and `PROJECT.md` already scopes safety as authored. Use these as references, not installs:

| Candidate | Version | dl/mo | ★ | Assessment |
|---|---|---|---|---|
| `@ramtinj95/pi-infra-command-guard` | 0.9.1 | 2,106 | 0 | **Best reference.** Scope is a near-exact match: `terraform apply`, `kubectl delete`, mutating `aws`/`az`/`gcloud`, `helm upgrade`, `argocd app sync`; approval overlay with time-boxed scoped bypasses; status-line integration. Crucially it **defeats indirection** — `K=kubectl; $K …`, `bash -lc "kubectl …"`, `xargs kubectl …` — because it parses with **`unbash`** instead of matching strings. Ships readable `.ts`. ⚠️ hard peer dep on `@howaboua/pi-codex-conversion` (which pulls `openai`, `web-tree-sitter`, `tree-sitter-bash`, `ws`) — that alone rules out installing it. **Steal the `unbash` approach; write your own.** |
| `cc-safety-net` | 2.0.3 | 7,753 | **1,482** | Highest stars, but multi-harness (Claude Code / opencode / cursor / amp / pi) with a peer dep on `@opencode-ai/plugin`, and its Pi entry is prebuilt `./dist/pi/index.js` — **not source-reviewable**, which fails the security constraint. |
| `pi-sandbox` | 0.6.3 | 6,006 | 191 | **Rules itself out: macOS + Linux only.** Wraps bash in `sandbox-exec` (macOS) / `bubblewrap` (Linux). No Windows path. Also needs `rg` installed. |
| `pi-defender` | 1.9.1 | 1,201 | 6 | Ships readable `./src/index.ts`, deps only `pi-tui` + `yaml`. Decent secondary reference; low adoption. |

**Also read Pi's own bundled examples** — they are in the npm tarball at `examples/extensions/`: `permission-gate.ts`, `protected-paths.ts`, `confirm-destructive.ts`, `dirty-repo-guard.ts`, `inline-bash.ts`, `bash-spawn-hook.ts`. Zero supply-chain risk, written by the Pi author, guaranteed current with the API.

### File checkpointing — category autopsy (why confidence is LOW)

| Candidate | Version | dl/mo | ★ | Last push | Verdict |
|---|---|---|---|---|---|
| `pi-rewind` (arpagon) | 0.5.0 | 1,868 | 104 | **2026-03-31** | **Avoid.** 4½ months stale against an API shipping every 2–3 days. Most stars in the category, which is exactly the trap. |
| `@ayulab/pi-rewind` | 0.4.6 | 4,091 | 13 | 2026-07-15 | **Avoid — repo `ayu-exorcist/oh-my-pi` is ARCHIVED.** Also GPL-3.0 and belongs to the Oh My Pi fork. |
| `@undreren/pi-checkpoint` | 0.1.3 | 340 | 1 | 2026-07-22 | **Wrong tool.** "Context checkpoints and `restore_conversation`" — conversation, not files. Pi's `/tree` and `/fork` already do that. |
| **`@davideasden/pi-undo`** | **0.2.11** | 2,278 | — | **2026-08-05** | **Recommended.** "Persistent workspace undo and redo for Pi." Vitest, TS 5.9.3. Freshest genuine workspace-undo. |
| `pi-rewind-hook` | 1.8.5 | 983 | — | 2026-07-28 | **Strong alternative.** "Automatic git checkpoints with file/conversation restore" — and it is by **nicobailon**, the maintainer behind `pi-subagents` (214k dl) and `pi-web-access` (222k dl). Proven maintainer, weak adoption on this package. |
| `@pi-plugins/checkpoint` | 0.1.2 | 449 | — | 2026-08-05 | **Most elegant design:** "File checkpoints for pi-agent: restore files on `/tree` navigation" — hooks Pi's *native* tree navigation so conversation-rewind and file-rewind move together. Too new to bet on (v0.1.2). |
| `pi-workspace-history` | 0.2.2 | 1,487 | — | 2026-05-10 | Stale. |

**Recommendation:** install `@davideasden/pi-undo`, and keep Pi's bundled `examples/extensions/git-checkpoint.ts` (git stash on `turn_start`, restore on fork) as the vendorable ~100-line fallback. Re-evaluate `@pi-plugins/checkpoint` at a later milestone — its `/tree` integration is the correct architecture.

### Subagents — the three-way comparison in full

| | **`pi-subagents`** ✅ | `@tintinweb/pi-subagents` | `@gotgenes/pi-subagents` |
|---|---|---|---|
| Version | **0.47.1** | 0.15.0 | 19.2.2 |
| Downloads/mo | **213,951** | 40,722 | 8,460 |
| Stars | **3,110** | 856 | 150 (monorepo) |
| Releases/30d | 20 | 4 | 11 |
| Per-agent model | ✅ + `fallbackModels` | ✅ | ✅ (fork of tintinweb) |
| Per-agent system prompt | ✅ + `systemPromptMode: replace\|append` | ✅ | ✅ |
| Per-agent tool allowlist | ✅ strict, + `extensions` / `subagentOnlyExtensions` | ✅ | ✅ |
| Per-agent thinking | ✅ | ✅ | ✅ |
| Worktree isolation | ✅ **built in** (`worktree: true`) | ✅ **built in** (`isolation: worktree`) | ➖ separate `@gotgenes/pi-subagents-worktrees` |
| Background | ✅ | ✅ (concurrency cap 4) | ✅ |
| Mid-run steering | ✅ FleetView + `/subagents-fleet` | ✅ overlay + `steer_subagent` | ✅ |
| Child→parent escalation | ✅ **`contact_supervisor`** (native) | ➖ via `pi.events` | ✅ typed API + lifecycle events |
| Notable extras | skills + prompts shipped; `inheritProjectContext`, `inheritSkills`, `skillPath` | cron/interval scheduling, nested subagents, conversation viewer | clean typed extension API for building on top |
| Size | 3.4 MB / 216 files | — | — |

**Choose `pi-subagents`.** `contact_supervisor` alone justifies it — it is the advisor-escalation requirement, native, with no glue code. `inheritProjectContext` / `inheritSkills` / `systemPromptMode` are direct levers on the context-pollution hypothesis: you can give a cheap executor a *minimal* child context deliberately.

**Choose `@tintinweb/pi-subagents` instead if** the 20-releases-per-month cadence proves destabilising — 4/month is calmer, and it is the only one with built-in cron scheduling.

### `pi-lens` vs `@narumitw/pi-lsp` — why the smaller one wins

`pi-lens@3.8.74` has more downloads (40,911 vs 16,116) and more stars (320 vs 315 for the whole narumiruna monorepo). It loses on two project constraints:

- **18.6 MB across 1,294 files.** `PROJECT.md` requires source review or vendoring for anything in the tool-execution path. Reviewing 1,294 files is not going to happen; reviewing 13 is a morning.
- **Progressive disclosure.** `@narumitw/pi-lsp` puts exactly two tools in front of the model. Every tool description is per-turn system-prompt tax on DeepSeek Flash.

Install `@narumitw/pi-lsp`. Revisit `pi-lens` only if diagnostics coverage proves insufficient in practice.

### Full install block

```jsonc
// config/settings.json — every entry exact-pinned
{
  "packages": [
    "npm:pi-subagents@0.47.1",
    "npm:@narumitw/pi-plan-mode@0.49.3",
    "npm:@juicesharp/rpiv-todo@2.4.0",
    "npm:@juicesharp/rpiv-ask-user-question@2.4.0",
    { "source": "npm:pi-background-tasks@2.3.0",
      "extensions": ["extensions/background-tasks*.ts"] },   // exclude its delegated-agent tools
    "npm:@narumitw/pi-lsp@0.49.4",
    "npm:pi-loop-police@1.14.1",
    "npm:pi-web-access@0.22.0",
    "npm:pi-session-finder@0.5.6",
    "npm:pi-model-fallback@0.3.6",
    "npm:@davideasden/pi-undo@0.2.11",
    "https://github.com/kaiyitkoh/ky-pi-agent@v0.1.0"
  ]
}
```

Twelve entries. The filter syntax on `pi-background-tasks` is the documented object form (`source` + per-type glob arrays with `!exclusions`, `+path`, `-path`); **verify the actual file paths before shipping that filter** — I did not enumerate that package's internal layout.

---

## 7. Theme file format — exact

Read from `dist/modes/interactive/theme/theme-schema.json` and `dark.json` in the shipped package.

```json
{
  "$schema": "https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
  "name": "ky-dark",
  "vars": { "primary": "#00aaff", "secondary": 242 },
  "colors": { "accent": "primary", "...": "..." },
  "export": { "pageBg": "#18181e", "cardBg": "#1e1e24", "infoBg": "#3c3728" }
}
```

- `$schema` URL verified live — **HTTP 200**.
- Schema top-level `required`: `["name", "colors"]`. `vars` and `export` optional.
- **`colors` has 53 properties; 51 are required.** The 2 optional are `scrollbarThumb` (falls back to `selectedBg`) and `thinkingMax` (falls back to `thinkingXhigh`). The question's "51 colour tokens" = the *required* count; the total token vocabulary is 53. Both numbers are right, for different questions.

Breakdown (53): Core UI 11 · Backgrounds & Content 12 · Markdown 10 · Tool Diffs 3 · Syntax 9 · Thinking-level borders 7 · Bash mode 1.

<details>
<summary>All 53, in schema order</summary>

`accent, border, borderAccent, borderMuted, success, error, warning, muted, dim, text, thinkingText, selectedBg, scrollbarThumb*, userMessageBg, userMessageText, customMessageBg, customMessageText, customMessageLabel, toolPendingBg, toolSuccessBg, toolErrorBg, toolTitle, toolOutput, mdHeading, mdLink, mdLinkUrl, mdCode, mdCodeBlock, mdCodeBlockBorder, mdQuote, mdQuoteBorder, mdHr, mdListBullet, toolDiffAdded, toolDiffRemoved, toolDiffContext, syntaxComment, syntaxKeyword, syntaxFunction, syntaxVariable, syntaxString, syntaxNumber, syntaxType, syntaxOperator, syntaxPunctuation, thinkingOff, thinkingMinimal, thinkingLow, thinkingMedium, thinkingHigh, thinkingXhigh, thinkingMax*, bashMode` — `*` = optional
</details>

**Colour value formats (4):** hex `"#ff0000"` · xterm-256 integer `39` · `vars` reference `"primary"` · `""` = terminal default.

**Load paths, in order:** built-in `dark`/`light` → `~/.pi/agent/themes/*.json` → `.pi/themes/*.json` (**trusted projects only**) → package `themes/` or `pi.themes` → `settings.themes[]` → `--theme <path>` (repeatable). `--no-themes` disables discovery. `name` must be unique and must not contain `/`. **Editing the active custom theme file hot-reloads it** — good authoring loop.

---

## 8. Testing a Pi extension

### What authors actually use — surveyed, not guessed

I read `devDependencies` and `scripts.test` from the 15 most-relevant published extensions:

| Runner | Count | Packages |
|---|---|---|
| **vitest** | **8** | `@tintinweb/pi-subagents`, `@gotgenes/pi-subagents`, `pi-lens`, `@juicesharp/rpiv-todo`, `pi-session-finder`, `@davideasden/pi-undo`, `@gotgenes/pi-subagents-worktrees`, + Pi core itself |
| `node --test` / `tsx --test` | 3 | `pi-web-access`, `pi-sandbox`, `pi-background-tasks` |
| `bun test` | 2 | `cc-safety-net`, `@mjasnikovs/pi-task` |
| none | 3 | `@narumitw/pi-plan-mode`, `pi-loop-police`, `@plannotator/pi-extension` |

**Use vitest 4.1.9.** It matches Pi core exactly, it is the plurality choice, and unlike `bun test` it needs no extra runtime on the `windows-latest` / `macos-latest` CI matrix.

### Testing without credentials — Pi ships a scripted mock provider

**This is the most useful thing I found for this project.** `@earendil-works/pi-ai` exports a purpose-built test double from its main entry (`export * from "./providers/faux.ts"`). It is not documented in `docs/`, only in the `.d.ts` — but it is public API.

```typescript
import { fauxProvider, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";

const faux = fauxProvider({ models: [{ id: "test-1", reasoning: true, input: ["text"] }] });

faux.setResponses([
  fauxAssistantMessage([fauxThinking("planning…"), fauxToolCall("bash", { command: "rm -rf /" })]),
  fauxAssistantMessage("done"),
  // or a factory: (context, options, state, model) => AssistantMessage
]);

const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore() });
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
  model: faux.getModel(),
});

await session.prompt("go");
expect(faux.state.callCount).toBe(2);
```

The API surface:

- `fauxProvider(options)` → `{ provider, api, models, getModel(), state, setResponses(), appendResponses(), getPendingResponseCount() }`
- `state: { callCount, deferredFetchCount, cancelledDeferred }` — assert on how many provider calls your extension caused
- Response steps are `AssistantMessage` **or** a `FauxResponseFactory(context, options, state, model)` — so you can **assert on the outgoing request** (`context`, `options.reasoningEffort`) and branch, which is exactly what the wire-inspector tests need
- Builders: `fauxText`, `fauxThinking`, `fauxToolCall`, `fauxAssistantMessage({ stopReason, errorMessage, deferred, responseId })`
- `tokensPerSecond` and `tokenSize: {min,max}` control synthetic streaming rate — lets you test steering and mid-stream interception deterministically
- `deferred: { pendingFetches, pollAfterMs }` simulates deferred/polling responses
- Register it into a live Pi session with `pi.registerProvider(faux.provider)` — `registerProvider` accepts a complete pi-ai `Provider` object

**Confidence: HIGH** (read from `providers/faux.d.ts` + `faux.js`). **Caveat: not in `docs/`, so it carries no public stability guarantee.** Pin `@earendil-works/pi-ai` exactly and expect to fix breakage on upgrades. Given every credential-dependent feature must be built blind on the dev machine, that is a trade worth making.

### The three testing layers

| Layer | Tool | What it proves |
|---|---|---|
| **Unit** | vitest, no Pi | Pure logic: routing table, capability guard, `unbash` command classification, cost maths. Fastest, most of your tests. |
| **Session** | vitest + `fauxProvider` + `SessionManager.inMemory()` + `InMemoryCredentialStore` | Event wiring, `tool_call` blocking, `before_provider_request` payload capture, system-prompt chaining, tool registration/activation. **No network, no credentials, no disk.** |
| **End-to-end** | `pi --mode json` in a temp dir, parse JSONL | The full binary really loads your package. Assert on `{"type":"tool_execution_end",...}` lines. Run in CI on both OSes. |

**`--mode json`** emits one JSON object per line to stdout; first line is `{"type":"session","version":3,"id",...}`. `message_update` records are **delta-only** (no cumulative `message`, no `assistantMessageEvent.partial`) to keep stream size linear — assemble from `contentIndex` + `delta`, or just assert on `message_end`, which is authoritative. `ctx.hasUI` is `false` and all UI methods are no-ops, so **dialogs cannot be tested here**.

**`--mode rpc`** (`runRpcMode`, `RpcClient` exported from the package) is the better harness for anything involving `ctx.ui`: `ctx.hasUI` is `true` and dialogs/notifications are marshalled over the JSON protocol, so a test client can *answer* a `confirm()`. This is how you test the block-and-confirm safety dialog. `ctx.ui.custom()` returns `undefined` in RPC mode, so custom components still need manual verification.

Mode matrix, verbatim from the docs:

| Mode | `ctx.mode` | `ctx.hasUI` |
|---|---|---|
| Interactive | `"tui"` | `true` |
| `--mode rpc` | `"rpc"` | `true` |
| `--mode json` | `"json"` | `false` |
| `-p` (print) | `"print"` | `false` |

**`systemPromptOverride`** is not a `createAgentSession` option — it is a `DefaultResourceLoader` option: `new DefaultResourceLoader({ systemPromptOverride: () => "..." })`, passed as `resourceLoader`. Useful for pinning a deterministic prompt in session tests.

---

## 9. Windows / macOS portability

### Shell resolution — more precise than the docs

`docs/windows.md` lists three steps. The actual implementation in `dist/utils/shell.js` has **four**, and the docs omit one:

1. `shellPath` from `settings.json` (supports leading `~`) — **throws** if the path does not exist
2. `%ProgramFiles%\Git\bin\bash.exe`
3. **`%ProgramFiles(x86)%\Git\bin\bash.exe`** ← *not in the docs*
4. `where bash.exe`, first result, **verified to exist** (`where` can return non-existent paths)
5. throw with an actionable three-option message

On Unix: `/bin/bash` → `which bash` → fall back to `sh`.

**Legacy WSL bash is special-cased.** A path matching `^[a-z]:\\windows\\(system32|sysnative)\\bash\.exe$` gets `args: ["-s"]` with `commandTransport: "stdin"` instead of the normal `["-c"]`. If a machine has WSL but not Git Bash, commands arrive via **stdin, not argv** — a meaningfully different execution path. Git for Windows is what you want; WSL is genuinely not required, but it is also not the same code path if it gets picked up.

### Everything else that differs

| Concern | Windows | macOS / Linux | What extension authors must do |
|---|---|---|---|
| Process-tree kill | `taskkill /F /T /PID` | `process.kill(-pid, "SIGKILL")` with single-pid fallback | Use `pi.exec()`; don't hand-roll `spawn` + kill. Pi tracks detached child PIDs and kills them on SIGHUP/SIGTERM. |
| PATH | `getShellEnv()` prepends Pi's bin dir; PATH key looked up **case-insensitively** (`Path` vs `PATH`) | prepends bin dir | Never read `process.env.PATH` directly on Windows. |
| Config paths | `.pi` under the same rules | same | Use exported `CONFIG_DIR_NAME` + `node:path.join`, never string concat with `/`. Rebranded distributions use a different directory name. |
| File paths in tools | backslashes | forward | `resolve(ctx.cwd, params.path)` then `withFileMutationQueue()` on the **resolved absolute** path. For existing files the helper canonicalises through `realpath()`, so symlink aliases share one queue. |
| Shell scripts | Git Bash sh | sh | POSIX `sh` only, per `PROJECT.md`. Never PowerShell. |
| Line endings | CRLF risk | LF | Commit `.gitattributes` with `* text=auto eol=lf` and `*.sh text eol=lf`. Git Bash will run CRLF `.sh` files badly. |
| Sandboxing | **none available** | `sandbox-exec` / `bubblewrap` | Rules out `pi-sandbox`. Reinforces that the authored guard is the only cross-platform control. |
| Optional dep | `@mariozechner/clipboard@0.3.9` is an `optionalDependency` | same | Don't assume clipboard works. |

**CI matrix.** `windows-latest` + `macos-latest` × Node `22.x` + `24.x`. `windows-latest` runners have Git for Windows preinstalled, so step 2 of shell resolution resolves without setup. Free on public repos, per `PROJECT.md`.

---

## Corrections to `PROJECT.md`

Four claims in the project context did not survive verification. Two are load-bearing for the roadmap.

### 1. ❌ "DeepSeek documents `reasoning_effort` nested inside a `thinking` object while Pi sends it top-level"

**Wrong. Pi's DeepSeek wire format is correct.** DeepSeek's own docs show `thinking: {"type":"enabled"}` (nested) **and** `reasoning_effort: "high"` (**top-level**). Pi's `thinkingFormat: "deepseek"` emits exactly that:

```js
if (options?.reasoningEffort) params.thinking = { type: "enabled" };
else if (model.thinkingLevelMap?.off !== null) params.thinking = { type: "disabled" };
if (options?.reasoningEffort && compat.supportsReasoningEffort)
  params.reasoning_effort = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
```

There is no bug here for DeepSeek-direct.

### 2. ❌ "Pi's DeepSeek `thinkingLevelMap` never emits `low`" — true but **not a bug**

`{minimal:null, low:null, medium:null, high:"high", max:"max"}` is **faithful to the API**. Alibaba documents (and DeepSeek confirms) that V4 accepts only `high` and `max`, with `low`/`medium` → `high` and `xhigh` → `max` mapped server-side. Pi hides levels the model cannot honour rather than sending values that get silently rewritten. That is correct behaviour, not a defect.

**Net effect on the roadmap:** two of the four suspected thinking-parameter defects evaporate. The **Bedrock non-Anthropic** one is real and confirmed at source; the **DashScope `thinkingFormat: "qwen"`** one is real and is a *configuration* requirement, not a Pi bug. The wire inspector is still the right first move — but it is now likely to *exonerate* the DeepSeek-direct path, which shifts the "doesn't think enough" diagnosis toward **context pollution** and the **~11% prose-tool-call failure mode**. Weight the roadmap accordingly.

### 3. ❌ "Provider fallback chains (Qoder → Aliyun)"

Not constructible. Qoder's official API has no inference endpoint (§5) — it cannot be a Pi provider, so it cannot be a fallback target. Qoder can only be a **delegate tool**. Either drop Qoder from the routing/fallback requirement or restate it as "Qoder as an optional delegate subagent".

### 4. ⚠️ "`@gotgenes/pi-subagents-worktrees` as the worktree bridge"

It bridges `@gotgenes/pi-subagents` only, and no-ops silently otherwise. Both recommended subagent packages have worktree isolation built in. Remove this from the plan.

---

## Installation

```bash
# Prerequisite: Node >= 22.19.0, and Git for Windows on Windows
npm install -g @earendil-works/pi-coding-agent@0.84.1

# Harness dev dependencies (in the repo)
npm install -D typescript@5.9.3 vitest@4.1.9 @types/node@24.12.4

# Runtime dependency for the authored safety layer
npm install unbash@4.0.10

# Peers — declared, NOT installed into the package
#   @earendil-works/pi-coding-agent  "*"
#   @earendil-works/pi-ai            "*"
#   @earendil-works/pi-tui           "*"
#   typebox                          "*"

# Extensions — exact-pinned, written to project settings
pi install -l npm:pi-subagents@0.47.1
pi install -l npm:@narumitw/pi-plan-mode@0.49.3
pi install -l npm:@juicesharp/rpiv-todo@2.4.0
pi install -l npm:@juicesharp/rpiv-ask-user-question@2.4.0
pi install -l npm:pi-background-tasks@2.3.0
pi install -l npm:@narumitw/pi-lsp@0.49.4
pi install -l npm:pi-loop-police@1.14.1
pi install -l npm:pi-web-access@0.22.0
pi install -l npm:pi-session-finder@0.5.6
pi install -l npm:pi-model-fallback@0.3.6
pi install -l npm:@davideasden/pi-undo@0.2.11

# Try before committing — temp install, this run only
pi -e npm:pi-loop-police@1.14.1
```

---

## Alternatives Considered

| Recommended | Alternative | When to use the alternative |
|---|---|---|
| `pi-subagents@0.47.1` | `@tintinweb/pi-subagents@0.15.0` | If 20 releases/month destabilises you (tintinweb ships 4/month), or you want built-in cron/interval scheduling of subagents. |
| `pi-subagents@0.47.1` | `@gotgenes/pi-subagents@19.2.2` | If you end up building extensions **on top of** the subagent layer — it exposes a deliberately typed API with lifecycle events for exactly that. |
| `@narumitw/pi-lsp@0.49.4` | `pi-lens@3.8.74` | If two tools (`lsp_diagnostics`, `lsp_fix`) prove insufficient and you need linters/formatters/structural analysis, and you accept 18.6 MB / 1,294 unreviewed files. |
| `@narumitw/pi-plan-mode@0.49.3` | Vendor Pi's `examples/extensions/plan-mode/` (390 lines) | If you want **zero** supply-chain exposure in a tool-gating path. Written by the Pi author, guaranteed API-current, fully readable in an hour. Strong option given the safety posture. |
| `@narumitw/pi-plan-mode@0.49.3` | `@plannotator/pi-extension@0.26.8` | If you want *plan review with inline annotations* rather than plan **mode**. 38k dl/mo, 7,679★ — but that is a whole multi-harness product, far more surface than needed. |
| `@davideasden/pi-undo@0.2.11` | `pi-rewind-hook@1.8.5` | If you trust maintainer track record over adoption — it is by nicobailon (214k + 222k dl/mo on other packages). |
| `@davideasden/pi-undo@0.2.11` | `@pi-plugins/checkpoint@0.1.2` | Once it matures. Restoring files on `/tree` navigation is the architecturally correct design — it makes conversation-rewind and file-rewind one action. |
| `pi-model-fallback@0.3.6` | Build it into the authored router | **Probably the right end state.** Fallback is one `try/catch` around `pi.setModel()` driven by `after_provider_response` status codes. |
| `pi-session-finder@0.5.6` | `pi-sessions@0.12.1` | If you also want handoff, cross-session messaging, auto-titling and indexing. More surface, 1,960 dl/mo. |
| `pi-web-access@0.22.0` | `pi-web-search@1.3.1` | **Don't.** It is provider-native search (Gemini/OpenAI/Anthropic), so it *requires* keys — fails the no-API-key requirement. Also 8,514 dl/mo and last pushed 2026-07-09. |
| vitest 4.1.9 | `node --test` via `tsx` | If you want zero test dependencies. 3 of 15 surveyed packages do this. You lose vitest's mocking and watch ergonomics. |

---

## What NOT to Use

| Avoid | Why | Use instead |
|---|---|---|
| `@sinclair/typebox` | Wrong package. Legacy scoped fork at `0.34.52`. Pi bundles unscoped `typebox@1.3.7`. Using it produces schemas Pi cannot validate. | `typebox` (unscoped), peer `"*"` |
| `Type.Union` / `Type.Literal` for string enums | Documented: **does not work with Google's API**. | `StringEnum([...] as const)` from `@earendil-works/pi-ai` |
| `pi-provider-qoder@0.3.0`, `pi-qoder-provider@0.2.2` | Ship a WAF-bypass body encoder and COSY RSA/AES-CBC/MD5 signature forging against `gateway.qoder.sh`. Breach Qoder ToS §3.2.6/§3.2.9/§3.2.10; §15.2 makes termination irreversible. **Verified from the package bundle**, not inferred. | Official PAT + Cloud Agents API as a *delegate tool*, or drop Qoder |
| `@gotgenes/pi-subagents-worktrees@0.3.0` | Peer-depends on `@gotgenes/pi-subagents >= 16.4.0`; **silently does nothing** with any other subagents package. Both recommendations have worktrees built in. | Native worktree support in `pi-subagents` |
| `@ayulab/pi-rewind@0.4.6` | Repo `ayu-exorcist/oh-my-pi` is **ARCHIVED**. GPL-3.0. Belongs to the Oh My Pi fork, not Pi. | `@davideasden/pi-undo` |
| `pi-rewind@0.5.0` (arpagon) | Last push **2026-03-31** — 4½ months against an API shipping every 2–3 days. 104★ makes it the most tempting trap in the ecosystem. | `@davideasden/pi-undo` |
| `pi-high-availability@2.3.0` | Last publish **and** last push 2026-03-19. **71 downloads/month.** Dead. | `pi-model-fallback`, or author it |
| `pi-provider-fallback@1.0.4` | 147 dl/mo, 0★, no publish since 2026-06-22. `PROJECT.md`'s assessment confirmed. | `pi-model-fallback@0.3.6` |
| `pi-sandbox@0.6.3` | **macOS/Linux only** (`sandbox-exec` / `bubblewrap`). No Windows path. Also requires `rg`. | Authored guard using `unbash` |
| `cc-safety-net@2.0.3` in the safety path | 1,482★ is tempting, but its Pi entry is prebuilt `dist/pi/index.js` — **not source-reviewable**, violating the security constraint for tool-path code. Peer-depends on `@opencode-ai/plugin`. | Authored guard; reference `@ramtinj95/pi-infra-command-guard`'s source |
| `@ramtinj95/pi-infra-command-guard@0.9.1` as an **install** | Hard peer dep on `@howaboua/pi-codex-conversion`, which drags in `openai`, `web-tree-sitter`, `tree-sitter-bash`, `ws`, `js-tiktoken`. Huge unreviewed surface for a guard. 0★. | **Read it, copy the `unbash` approach, write your own** |
| String matching in the `tool_call` guard | `g=push; git $g`, `bash -lc "..."`, `xargs`, heredocs all defeat it. `PROJECT.md` already names this. | `unbash@4.0.10` — parse to AST, match resolved command nodes |
| `!command` in `models.json` | **No caching** — re-executes on *every* provider request. Deliberate design choice by Pi. | `!command` in `auth.json` (cached for process lifetime) |
| `@earendil-works/pi-coding-agent@0.74.2` (`legacy-node20`) | 10 minor versions stale. Only exists for Node 20. | `0.84.1` on Node ≥ 22.19.0 |
| DeepSeek's "Using DeepSeek with Oh My Pi" doc | It is for **Oh My Pi** (`~/.omp/agent/models.yml`), a different fork on an archived repo. Its `supportsToolChoice` / `requiresReasoningContentForToolCalls` / `requiresAssistantContentForToolCalls` keys **do not exist in Pi's `compat` schema**. | Pi's own `docs/models.md`; the built-in `deepseek` catalogue is correct |
| Pi's built-in `qwen-token-plan` provider for pay-as-you-go DashScope keys | Different host (`token-plan.ap-southeast-1.maas.aliyuncs.com`), different key namespace (`sk-sp-` prepaid, `QWEN_TOKEN_PLAN_API_KEY`). **`PROJECT.md` confirmed correct.** | Custom `dashscope` provider in `models.json` |
| A build step for extensions | jiti loads `.ts` directly. A build step breaks `/reload` hot-reloading and buys nothing. | Ship `.ts`; point `pi.extensions` at it |
| Bundling any `@earendil-works/*` or `typebox` | Creates a second module instance; breaks type/instance identity across the boundary. | `peerDependencies` with `"*"` |

---

## Stack Patterns by Variant

**If the wire inspector shows DeepSeek-direct thinking parameters arriving correctly (likely, per the corrections above):**
- Do **not** build per-role thinking budgets — there is nothing to fix. `PROJECT.md`'s gate already says this.
- Redirect that effort to **progressive disclosure** (`pi.setActiveTools` + dynamic tool loading) and to the **prose-tool-call detector** (`message_end` handler that spots tool calls emitted as text in `content` and re-prompts). That is the ~11% failure mode no thinking budget touches.

**If routing through Bedrock to a non-Anthropic model:**
- Thinking config is `undefined` — confirmed at source. Either accept no thinking, or route that model through its native provider instead.
- If using an application inference profile ARN, set `name` to a string containing `claude` so `isAnthropicClaudeModel()` and `supportsPromptCaching()` match; otherwise also set `AWS_BEDROCK_FORCE_CACHE=1`.

**If DashScope replaces DeepSeek-direct as the daily driver:**
- `compat.thinkingFormat: "qwen"` is **mandatory** — without it, auto-detection yields `"openai"` and thinking is silently never enabled.
- `contextWindow: 393216`, not 1,000,000. Wrong value means overflow errors instead of clean compaction.
- Never set `samplingParams` on a thinking-enabled model (temperature/top_p/penalties unsupported in thinking mode).

**If context pollution is confirmed as the real cause:**
- Register all tools, activate few (`pi.setActiveTools`), use a loader tool. Native deferred loading on Anthropic 4.5+/`gpt-5.4`+; safe fallback everywhere else.
- Omit `promptSnippet` and `promptGuidelines` from lazily-loaded tools — activating a tool that has them **rebuilds the system prompt** and invalidates the cache prefix.
- Use `pi-subagents`' `inheritProjectContext: false` / `inheritSkills: false` / `systemPromptMode: replace` to give cheap executors a deliberately minimal context.

**If a safety-critical extension must be trusted:**
- Prefer packages that ship `.ts` source (`pi-defender`, `@narumitw/*`, `@juicesharp/*`, `@ramtinj95/*`) over prebuilt `dist/*.js` (`cc-safety-net`).
- Vendor into `extensions/vendor/` and reference by local path in `pi.extensions` — a local path in settings is added **without copying** and is not touched by `pi update`.

---

## Version Compatibility

| Package | Compatible with | Notes |
|---|---|---|
| `@earendil-works/pi-coding-agent@0.84.1` | `pi-ai`/`pi-tui`/`pi-client`/`pi-protocol`/`pi-agent-core` `^0.84.1` | Version-locked family. Upgrade all together or not at all. |
| `@earendil-works/pi-coding-agent@0.84.1` | Node `>=22.19.0` | Hard `engines`. `legacy-node20` tag frozen at `0.74.2`. |
| `typebox@1.3.7` (Pi's pin) | `typebox@1.3.13` (current) | Same major; peer `"*"` is safe. Never `@sinclair/typebox`. |
| `pi-subagents@0.47.1` | peers `@earendil-works/pi-ai >=0.80.0`, others `*` | Satisfied by 0.84.1. |
| `@gotgenes/pi-subagents@19.2.2` | peer `@earendil-works/pi-coding-agent >=0.80.5` | Satisfied. |
| `@gotgenes/pi-subagents-worktrees@0.3.0` | peer `@gotgenes/pi-subagents >=16.4.0` **only** | **Incompatible with `pi-subagents` and `@tintinweb/pi-subagents`.** |
| `@juicesharp/rpiv-todo` + `rpiv-ask-user-question` @2.4.0 | peer `@juicesharp/rpiv-i18n@*`, dep `@juicesharp/rpiv-config@^2.4.0` | Family — keep both on the same minor. Verify `rpiv-i18n` resolves under `npm install --omit=dev`. |
| `pi-defender@1.9.1` | dep `@earendil-works/pi-tui@^0.74.0` | ⚠️ Declares pi-tui as a **dependency**, not a peer — will install a **second, stale** pi-tui. Contributing reason not to install it. |
| `vitest@4.1.9` | Node 22 / 24, TS 5.9.3 | Matches Pi core. |
| `unbash@4.0.10` | anything | **Zero dependencies**, ISC. |

---

## Sources

**Primary — read directly from published tarballs (HIGH confidence):**
- `@earendil-works/pi-coding-agent@0.84.1` npm tarball — `docs/extensions.md` (2,988 lines), `docs/packages.md`, `docs/models.md`, `docs/providers.md`, `docs/themes.md`, `docs/sdk.md`, `docs/json.md`, `docs/settings.md`, `docs/windows.md`; `dist/core/extensions/types.d.ts` (event map, lines 767–899); `dist/index.d.ts` (public exports); `dist/utils/shell.js` (Windows shell resolution); `dist/modes/interactive/theme/theme-schema.json` + `dark.json` (53 tokens / 51 required); `examples/extensions/` (plan-mode, permission-gate, git-checkpoint, provider-payload)
- `@earendil-works/pi-ai@0.84.1` npm tarball — `dist/providers/amazon-bedrock.js` (`resolve()` order), `dist/api/bedrock-converse-stream.js` (`buildAdditionalModelRequestFields`), `dist/api/openai-completions.js` (`thinkingFormat` emission + `detectCompat`), `dist/providers/faux.{js,d.ts}` (mock provider), `dist/providers/data/*.json` (built-in catalogues: deepseek, qwen-token-plan)
- npm registry API + npm downloads API — every version, publish date, download count, dependency and size figure, queried 2026-08-13
- GitHub REST API via authenticated `gh` CLI — every `pushed_at`, star count and `archived` flag, queried 2026-08-13
- `pi-provider-qoder@0.3.0` tarball — WAF-bypass and COSY-signing evidence
- Package tarballs unpacked for feature verification: `pi-subagents@0.47.1`, `@tintinweb/pi-subagents@0.15.0`, `@gotgenes/pi-subagents-worktrees@0.3.0`, `@narumitw/pi-lsp@0.49.4`, `@narumitw/pi-plan-mode@0.49.3`, `awesome-pi-themes@1.1.9`, `pi-web-access@0.22.0`, `pi-sandbox@0.6.3`, `@ramtinj95/pi-infra-command-guard@0.9.1`, `cc-safety-net@2.0.3`, `pi-defender@1.9.1`, `@juicesharp/rpiv-*@2.4.0`, `pi-loop-police@1.14.1`

**Official vendor documentation (HIGH confidence):**
- https://www.alibabacloud.com/help/en/model-studio/deepseek-api — 393,216 total token cap; `reasoning_effort` `high`/`max` with `low`/`medium`→`high`, `xhigh`→`max`
- https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen — workspace-dedicated base URLs, `DASHSCOPE_API_KEY`
- https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope — dedicated-domain recommendation
- https://api-docs.deepseek.com/guides/reasoning_model + `/guides/thinking_mode/` — `thinking:{type:"enabled"}` nested, `reasoning_effort` top-level, sampling params unsupported in thinking mode
- https://docs.qoder.com/cloud-agents/overview — orchestration, not inference
- https://docs.qoder.com/cloud-agents/api/conventions/authentication — `https://api.qoder.com/api/v1/cloud`, `Bearer pt-…`
- https://docs.qoder.com/cli/sdk/quick-start + `/cli/sdk/authentication` — `query()`, `QODER_PERSONAL_ACCESS_TOKEN`
- https://docs.qoder.com/llms.txt — full doc index; **no inference endpoint exists**
- https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json — HTTP 200, live

**Corroborating (MEDIUM confidence):**
- https://github.com/earendil-works/pi/issues/6998 — "DeepSeek models provided by Aliyun should use thinkingFormat=qwen", **closed**; fix verified present in the 0.84.1 catalogue

**Explicitly rejected as contradicting official docs:**
- https://api-docs.deepseek.com/quick_start/agent_integrations/oh_my_pi/ — DeepSeek's own page, but for the **Oh My Pi** fork; prescribes `compat` keys that do not exist in Pi and a `models.yml` file Pi does not read

**Not verified — flagged as UNVERIFIED:**
- Runtime *behaviour* of every third-party extension (README/manifest-derived; nothing was executed — no Pi install and no credentials on this machine)
- The `pi-background-tasks` resource filter globs in the install block — internal file layout not enumerated
- `@zhushanwen/pi-ask-user@7.0.5` — **no `repository` field in `package.json`**; source provenance unverifiable, excluded on that basis
- Whether `@juicesharp/rpiv-i18n` (a peer dep) resolves correctly under Pi's `npm install --omit=dev`
- Actual per-turn system-prompt token cost of each extension — needs measurement against a running Pi, and is the single most important number for the cheap-model hypothesis

---
*Stack research for: personalised Pi coding-agent harness*
*Researched: 2026-08-13*
