<!-- GSD:project-start source:PROJECT.md -->
## Project

**ky-pi-agent**

A personalised coding-agent harness built on [Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`, MIT, by Mario Zechner / Earendil Works), distributed as a public GitHub repo at `git@github.com:kaiyitkoh/ky-pi-agent.git` that is both Pi-installable (`pi install https://github.com/kaiyitkoh/ky-pi-agent`) and bootstrappable on a cold machine.

It exists to make *cheap models reliable*. The user's daily driver is intended to be DeepSeek V4 Flash, with stronger models (Anthropic via AWS Bedrock) reserved for the specific moments where they earn their cost. Everything in the harness — routing, quality gates, subagents, workflows, safety — serves that one goal: get Claude-Code-grade output from models that cost a fraction of Claude.

For the user: an AI Scientist who also does full-stack development across frontend, backend, and AWS infrastructure via Terraform, on large multi-stack codebases.

**Core Value:** **A harness that makes a cheap model produce work you'd trust from an expensive one — without the harness itself becoming the bottleneck.**

If the routing is elegant, the UI is beautiful, and the workflows are sophisticated, but DeepSeek Flash still misses bugs that Sonnet would catch, the project has failed. Everything else is negotiable against this.

### Constraints

- **Budget**: Zero spend beyond model API tokens. No SaaS subscriptions, no paid tiers, no hosted services. Open-source and self-hosted only.
- **Infrastructure**: Strong preference for zero background services — it should work from a cold laptop with Pi installed.
- **Complexity**: *"Don't overcomplicate things as complicated harness will result in lower performance."* Resolved via progressive disclosure rather than feature cuts: anything that cannot justify its per-turn token cost becomes a skill (name + description only until invoked) or moves into a subagent's isolated context.
- **Composition**: ~11 installed extensions + ~4 authored subsystems. Install commodity features (plan mode, todos, background bash, checkpointing, LSP, loop detection, web access, subagents, ask-user, session search, themes); author only the critical path (safety/gates, routing + capability guard, workflows, wire inspector). Reimplementing commodity features against an API shipping every 2–3 days is a maintenance tax, not an improvement.
- **Platform**: Windows (Git Bash) now, macOS later. POSIX `sh` throughout.
- **Secrets**: Public repo. No credential may ever be committed. Structure complete, values injected at runtime.
- **Security posture**: Extensions execute arbitrary code with full user permissions on a laptop holding live AWS SSO credentials for an account where `main` auto-deploys. Pin exact versions; review or vendor anything in the tool-execution or credential path.
- **Experience level**: New to Pi. Design decisions must be explainable, and the harness must remain debuggable by someone still learning the platform.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

- `@earendil-works/pi-coding-agent@0.84.1` — ships `docs/` (35 files, 12,196 lines) and `examples/` in the published package
- `@earendil-works/pi-ai@0.84.1` — ships every provider implementation and the built-in model catalogue as JSON
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
## 1. Pi Extension Authoring API — verified at 0.84.1
### The 33 events — complete and exact
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
### Registration API — complete list
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
### The session-replacement footgun (worth an ADR)
## 2. Packaging — exact `package.json` for `pi install https://github.com/kaiyitkoh/ky-pi-agent`
- Paths in `pi.*` are relative to the package root and **support glob patterns and `!exclusions`**.
- If **no** `pi` manifest is present, convention directories are auto-discovered: `extensions/` (`.ts` + `.js`), `skills/` (recursive `SKILL.md` folders + top-level `.md`), `prompts/` (`.md`), `themes/` (`.json`). Declare the manifest anyway — it is explicit and it is where `image`/`video` gallery metadata lives.
- **Runtime deps must be in `dependencies`.** Pi installs packages with `npm install --omit=dev`, so `devDependencies` are unavailable at runtime. (Exception: when `npmCommand` is configured, *git* packages use plain `install`.)
- To depend on another **pi package**, put it in both `dependencies` and `bundledDependencies` and reference it through `node_modules/...` paths in `pi.extensions`. Pi loads packages with separate module roots.
- Include `keywords: ["pi-package"]` for the gallery at `https://pi.dev/packages`.
- npm: `npm:@scope/pkg@1.2.3` — versioned specs are **pinned and skipped** by `pi update --extensions` / `--all`.
- git: refs are **pinned tags or commits**. `pi update` does *not* move them forward but *does* reconcile an existing clone to the configured ref (reset + clean + `npm install`). Move deliberately with `pi install git:host/user/repo@new-ref`.
- This is exactly the supply-chain posture `PROJECT.md` asks for. **Never write a bare `npm:pkg` or an unrefed git URL into `settings.json`.**
## 3. `models.json` — exact schema and verified provider configs
### Schema
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
- **omitted** → standard levels through `high` use the provider default; `xhigh`/`max` unsupported
- **string** → supported, this value is sent
- **`null`** → unsupported; hidden/skipped/clamped away in the UI
### (a) Alibaba DashScope — verified working config
| Form | URL |
|------|-----|
| Classic international (Singapore) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| Classic China (Beijing) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| **Workspace-dedicated, Singapore** (Alibaba's current recommendation) | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` |
| **Workspace-dedicated, Beijing** | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |
| | DeepSeek direct (`api.deepseek.com`) | DashScope (`*.maas.aliyuncs.com`) |
|---|---|---|
| Pi provider | built-in `deepseek` | you define it |
| `contextWindow` | **1,000,000** | **393,216 total** (Alibaba docs, verbatim: "393,216 in total") |
| `maxTokens` | 384,000 | lower; confirm per model in console |
| thinking enable | `thinking: {"type":"enabled"}` **nested** | `enable_thinking: true` **top-level** |
| `reasoning_effort` | **top-level** | **top-level** |
| `thinkingFormat` | `"deepseek"` (auto-detected) | `"qwen"` (**must be explicit**) |
| effort values | `high`, `max` (default `high`) | `high`, `max` (default `high`); `low`/`medium`→`high`, `xhigh`→`max` server-side |
### (b) AWS Bedrock with IAM Identity Center SSO — **claim confirmed, with a better option**
## 4. `auth.json` — interpolation, escaping, caching, precedence
| Form | Meaning |
|------|---------|
| `"!command"` | leading `!` executes **the whole value** as a shell command, stdout is the value |
| `"$ENV_VAR"` | environment variable |
| `"${ENV_VAR}"` | same, brace form |
| `"${KEY_PREFIX}_${KEY_SUFFIX}"` | interpolation works **inside larger literals** |
| `"$$..."` | escape → literal `$` |
| `"$!..."` | escape → literal `!`, no command execution |
| `"sk-..."`, `"MY_API_KEY"` | literal. **A bare uppercase string is a literal, not a variable.** |
| File | `!command` caching |
|------|--------------------|
| `auth.json` | **cached for the process lifetime** |
| `models.json` | **resolved at request time, every request, no caching** |
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
- Cloud Agents is "a fully managed runtime for AI agents": define an Agent (model + system prompt + tools) → configure an Environment (container) → start a Session → send `user.message` → stream **high-level events** (thinking, messages, status changes) over SSE. Cursor-paginated `{data, first_id, last_id, has_more}` responses.
- The Agent SDK's `query()` runs a **hosted agent loop with its own tools**.
- I fetched `docs.qoder.com/llms.txt` (the full documentation index) and confirmed: agent/session/deployment/environment/skill/vault/memory management, "model listing and selection" scoped to agent configuration, and **no page describing an OpenAI-compatible endpoint, chat completions API, or model inference gateway**.
### Is there an existing `pi-*-qoder` using the official API? **No. Both are bypass proxies.**
| Package | Version | dl/mo | Repo | Verdict |
|---|---|---|---|---|
| `pi-provider-qoder` | 0.3.0 (2026-07-30) | 987 | `simonsmh/pi-provider-qoder` (14★) | **bypass** |
| `pi-qoder-provider` | 0.2.2 (2026-07-20) | 160 | `minglu6/pi-provider-qoder` (0★) | **bypass**, near-identical description — a copy |
- `**WAF Bypass**: Built-in WAF obfuscation and body encoding (`Encode=1`)`
- `**COSY Signing**: Full COSY signature header generation (RSA/AES-CBC/MD5)`
- source file `qoder-encoding.ts # WAF bypass body encoder`
## 6. Extensions to install — verified against npm and GitHub on 2026-08-13
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
| Candidate | Version | dl/mo | ★ | Assessment |
|---|---|---|---|---|
| `@ramtinj95/pi-infra-command-guard` | 0.9.1 | 2,106 | 0 | **Best reference.** Scope is a near-exact match: `terraform apply`, `kubectl delete`, mutating `aws`/`az`/`gcloud`, `helm upgrade`, `argocd app sync`; approval overlay with time-boxed scoped bypasses; status-line integration. Crucially it **defeats indirection** — `K=kubectl; $K …`, `bash -lc "kubectl …"`, `xargs kubectl …` — because it parses with **`unbash`** instead of matching strings. Ships readable `.ts`. ⚠️ hard peer dep on `@howaboua/pi-codex-conversion` (which pulls `openai`, `web-tree-sitter`, `tree-sitter-bash`, `ws`) — that alone rules out installing it. **Steal the `unbash` approach; write your own.** |
| `cc-safety-net` | 2.0.3 | 7,753 | **1,482** | Highest stars, but multi-harness (Claude Code / opencode / cursor / amp / pi) with a peer dep on `@opencode-ai/plugin`, and its Pi entry is prebuilt `./dist/pi/index.js` — **not source-reviewable**, which fails the security constraint. |
| `pi-sandbox` | 0.6.3 | 6,006 | 191 | **Rules itself out: macOS + Linux only.** Wraps bash in `sandbox-exec` (macOS) / `bubblewrap` (Linux). No Windows path. Also needs `rg` installed. |
| `pi-defender` | 1.9.1 | 1,201 | 6 | Ships readable `./src/index.ts`, deps only `pi-tui` + `yaml`. Decent secondary reference; low adoption. |
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
### `pi-lens` vs `@narumitw/pi-lsp` — why the smaller one wins
- **18.6 MB across 1,294 files.** `PROJECT.md` requires source review or vendoring for anything in the tool-execution path. Reviewing 1,294 files is not going to happen; reviewing 13 is a morning.
- **Progressive disclosure.** `@narumitw/pi-lsp` puts exactly two tools in front of the model. Every tool description is per-turn system-prompt tax on DeepSeek Flash.
### Full install block
## 7. Theme file format — exact
- `$schema` URL verified live — **HTTP 200**.
- Schema top-level `required`: `["name", "colors"]`. `vars` and `export` optional.
- **`colors` has 53 properties; 51 are required.** The 2 optional are `scrollbarThumb` (falls back to `selectedBg`) and `thinkingMax` (falls back to `thinkingXhigh`). The question's "51 colour tokens" = the *required* count; the total token vocabulary is 53. Both numbers are right, for different questions.
## 8. Testing a Pi extension
### What authors actually use — surveyed, not guessed
| Runner | Count | Packages |
|---|---|---|
| **vitest** | **8** | `@tintinweb/pi-subagents`, `@gotgenes/pi-subagents`, `pi-lens`, `@juicesharp/rpiv-todo`, `pi-session-finder`, `@davideasden/pi-undo`, `@gotgenes/pi-subagents-worktrees`, + Pi core itself |
| `node --test` / `tsx --test` | 3 | `pi-web-access`, `pi-sandbox`, `pi-background-tasks` |
| `bun test` | 2 | `cc-safety-net`, `@mjasnikovs/pi-task` |
| none | 3 | `@narumitw/pi-plan-mode`, `pi-loop-police`, `@plannotator/pi-extension` |
### Testing without credentials — Pi ships a scripted mock provider
- `fauxProvider(options)` → `{ provider, api, models, getModel(), state, setResponses(), appendResponses(), getPendingResponseCount() }`
- `state: { callCount, deferredFetchCount, cancelledDeferred }` — assert on how many provider calls your extension caused
- Response steps are `AssistantMessage` **or** a `FauxResponseFactory(context, options, state, model)` — so you can **assert on the outgoing request** (`context`, `options.reasoningEffort`) and branch, which is exactly what the wire-inspector tests need
- Builders: `fauxText`, `fauxThinking`, `fauxToolCall`, `fauxAssistantMessage({ stopReason, errorMessage, deferred, responseId })`
- `tokensPerSecond` and `tokenSize: {min,max}` control synthetic streaming rate — lets you test steering and mid-stream interception deterministically
- `deferred: { pendingFetches, pollAfterMs }` simulates deferred/polling responses
- Register it into a live Pi session with `pi.registerProvider(faux.provider)` — `registerProvider` accepts a complete pi-ai `Provider` object
### The three testing layers
| Layer | Tool | What it proves |
|---|---|---|
| **Unit** | vitest, no Pi | Pure logic: routing table, capability guard, `unbash` command classification, cost maths. Fastest, most of your tests. |
| **Session** | vitest + `fauxProvider` + `SessionManager.inMemory()` + `InMemoryCredentialStore` | Event wiring, `tool_call` blocking, `before_provider_request` payload capture, system-prompt chaining, tool registration/activation. **No network, no credentials, no disk.** |
| **End-to-end** | `pi --mode json` in a temp dir, parse JSONL | The full binary really loads your package. Assert on `{"type":"tool_execution_end",...}` lines. Run in CI on both OSes. |
| Mode | `ctx.mode` | `ctx.hasUI` |
|---|---|---|
| Interactive | `"tui"` | `true` |
| `--mode rpc` | `"rpc"` | `true` |
| `--mode json` | `"json"` | `false` |
| `-p` (print) | `"print"` | `false` |
## 9. Windows / macOS portability
### Shell resolution — more precise than the docs
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
## Corrections to `PROJECT.md`
### 1. ❌ "DeepSeek documents `reasoning_effort` nested inside a `thinking` object while Pi sends it top-level"
### 2. ❌ "Pi's DeepSeek `thinkingLevelMap` never emits `low`" — true but **not a bug**
### 3. ❌ "Provider fallback chains (Qoder → Aliyun)"
### 4. ⚠️ "`@gotgenes/pi-subagents-worktrees` as the worktree bridge"
## Installation
# Prerequisite: Node >= 22.19.0, and Git for Windows on Windows
# Harness dev dependencies (in the repo)
# Runtime dependency for the authored safety layer
# Peers — declared, NOT installed into the package
#   @earendil-works/pi-coding-agent  "*"
#   @earendil-works/pi-ai            "*"
#   @earendil-works/pi-tui           "*"
#   typebox                          "*"
# Extensions — exact-pinned, written to project settings
# Try before committing — temp install, this run only
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
## Stack Patterns by Variant
- Do **not** build per-role thinking budgets — there is nothing to fix. `PROJECT.md`'s gate already says this.
- Redirect that effort to **progressive disclosure** (`pi.setActiveTools` + dynamic tool loading) and to the **prose-tool-call detector** (`message_end` handler that spots tool calls emitted as text in `content` and re-prompts). That is the ~11% failure mode no thinking budget touches.
- Thinking config is `undefined` — confirmed at source. Either accept no thinking, or route that model through its native provider instead.
- If using an application inference profile ARN, set `name` to a string containing `claude` so `isAnthropicClaudeModel()` and `supportsPromptCaching()` match; otherwise also set `AWS_BEDROCK_FORCE_CACHE=1`.
- `compat.thinkingFormat: "qwen"` is **mandatory** — without it, auto-detection yields `"openai"` and thinking is silently never enabled.
- `contextWindow: 393216`, not 1,000,000. Wrong value means overflow errors instead of clean compaction.
- Never set `samplingParams` on a thinking-enabled model (temperature/top_p/penalties unsupported in thinking mode).
- Register all tools, activate few (`pi.setActiveTools`), use a loader tool. Native deferred loading on Anthropic 4.5+/`gpt-5.4`+; safe fallback everywhere else.
- Omit `promptSnippet` and `promptGuidelines` from lazily-loaded tools — activating a tool that has them **rebuilds the system prompt** and invalidates the cache prefix.
- Use `pi-subagents`' `inheritProjectContext: false` / `inheritSkills: false` / `systemPromptMode: replace` to give cheap executors a deliberately minimal context.
- Prefer packages that ship `.ts` source (`pi-defender`, `@narumitw/*`, `@juicesharp/*`, `@ramtinj95/*`) over prebuilt `dist/*.js` (`cc-safety-net`).
- Vendor into `extensions/vendor/` and reference by local path in `pi.extensions` — a local path in settings is added **without copying** and is not touched by `pi update`.
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
## Sources
- `@earendil-works/pi-coding-agent@0.84.1` npm tarball — `docs/extensions.md` (2,988 lines), `docs/packages.md`, `docs/models.md`, `docs/providers.md`, `docs/themes.md`, `docs/sdk.md`, `docs/json.md`, `docs/settings.md`, `docs/windows.md`; `dist/core/extensions/types.d.ts` (event map, lines 767–899); `dist/index.d.ts` (public exports); `dist/utils/shell.js` (Windows shell resolution); `dist/modes/interactive/theme/theme-schema.json` + `dark.json` (53 tokens / 51 required); `examples/extensions/` (plan-mode, permission-gate, git-checkpoint, provider-payload)
- `@earendil-works/pi-ai@0.84.1` npm tarball — `dist/providers/amazon-bedrock.js` (`resolve()` order), `dist/api/bedrock-converse-stream.js` (`buildAdditionalModelRequestFields`), `dist/api/openai-completions.js` (`thinkingFormat` emission + `detectCompat`), `dist/providers/faux.{js,d.ts}` (mock provider), `dist/providers/data/*.json` (built-in catalogues: deepseek, qwen-token-plan)
- npm registry API + npm downloads API — every version, publish date, download count, dependency and size figure, queried 2026-08-13
- GitHub REST API via authenticated `gh` CLI — every `pushed_at`, star count and `archived` flag, queried 2026-08-13
- `pi-provider-qoder@0.3.0` tarball — WAF-bypass and COSY-signing evidence
- Package tarballs unpacked for feature verification: `pi-subagents@0.47.1`, `@tintinweb/pi-subagents@0.15.0`, `@gotgenes/pi-subagents-worktrees@0.3.0`, `@narumitw/pi-lsp@0.49.4`, `@narumitw/pi-plan-mode@0.49.3`, `awesome-pi-themes@1.1.9`, `pi-web-access@0.22.0`, `pi-sandbox@0.6.3`, `@ramtinj95/pi-infra-command-guard@0.9.1`, `cc-safety-net@2.0.3`, `pi-defender@1.9.1`, `@juicesharp/rpiv-*@2.4.0`, `pi-loop-police@1.14.1`
- https://www.alibabacloud.com/help/en/model-studio/deepseek-api — 393,216 total token cap; `reasoning_effort` `high`/`max` with `low`/`medium`→`high`, `xhigh`→`max`
- https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen — workspace-dedicated base URLs, `DASHSCOPE_API_KEY`
- https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope — dedicated-domain recommendation
- https://api-docs.deepseek.com/guides/reasoning_model + `/guides/thinking_mode/` — `thinking:{type:"enabled"}` nested, `reasoning_effort` top-level, sampling params unsupported in thinking mode
- https://docs.qoder.com/cloud-agents/overview — orchestration, not inference
- https://docs.qoder.com/cloud-agents/api/conventions/authentication — `https://api.qoder.com/api/v1/cloud`, `Bearer pt-…`
- https://docs.qoder.com/cli/sdk/quick-start + `/cli/sdk/authentication` — `query()`, `QODER_PERSONAL_ACCESS_TOKEN`
- https://docs.qoder.com/llms.txt — full doc index; **no inference endpoint exists**
- https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json — HTTP 200, live
- https://github.com/earendil-works/pi/issues/6998 — "DeepSeek models provided by Aliyun should use thinkingFormat=qwen", **closed**; fix verified present in the 0.84.1 catalogue
- https://api-docs.deepseek.com/quick_start/agent_integrations/oh_my_pi/ — DeepSeek's own page, but for the **Oh My Pi** fork; prescribes `compat` keys that do not exist in Pi and a `models.yml` file Pi does not read
- Runtime *behaviour* of every third-party extension (README/manifest-derived; nothing was executed — no Pi install and no credentials on this machine)
- The `pi-background-tasks` resource filter globs in the install block — internal file layout not enumerated
- `@zhushanwen/pi-ask-user@7.0.5` — **no `repository` field in `package.json`**; source provenance unverifiable, excluded on that basis
- Whether `@juicesharp/rpiv-i18n` (a peer dep) resolves correctly under Pi's `npm install --omit=dev`
- Actual per-turn system-prompt token cost of each extension — needs measurement against a running Pi, and is the single most important number for the cheap-model hypothesis
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
