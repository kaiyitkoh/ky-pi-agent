# Architecture Research

**Domain:** Personalised coding-agent harness on Pi (`@earendil-works/pi-coding-agent`), distributed as a dual-mode GitHub repo
**Researched:** 2026-08-13
**Pi version verified against:** 0.84.1 (npm, published source + bundled `docs/` + bundled `examples/`)
**Confidence:** HIGH for everything marked *verified*; explicit UNVERIFIED markers elsewhere

> **Method note.** Every claim below marked *verified* was checked against the actual published package, not against training data or web summaries. The tarball `@earendil-works/pi-coding-agent@0.84.1` was downloaded and unpacked; it ships `dist/**/*.d.ts` + `dist/**/*.js`, the full `docs/` tree (12,196 lines), and 80 working extension examples. Third-party extensions named in the brief were downloaded from npm and read. Token counts were produced by importing Pi's own `buildSystemPrompt` and tool factories and measuring the output.

---

## 0. Executive answer to the highest-risk question (role→model routing)

**The adversarial review was right about the event API and wrong about the conclusion.**

Verified: no lifecycle event result type carries a model. `BeforeAgentStartEventResult` is `{ message?, systemPrompt? }`. `ContextEventResult` is `{ messages? }`. `ToolCallEventResult` is `{ block?, reason?, terminate? }`. There is genuinely **no per-request model override in the event hook surface** (`dist/core/extensions/types.d.ts:774-820`).

But two mechanisms exist that the review missed, and both are load-bearing:

**Mechanism 1 — `ctx.modelRegistry.complete(model, context, options)`.** A direct, in-process, non-streaming call to *any* model in the registry, from any extension context, with no session mutation whatsoever.

```typescript
// dist/core/model-registry.d.ts:33 — verified signature
complete<TApi extends Api>(
  model: Model<TApi>,
  context: Context,                       // { systemPrompt?, messages, tools? }
  options?: ModelsApiStreamOptions<TApi>, // per-API: reasoningEffort | thinkingEnabled |
                                          // thinkingBudgetTokens, signal, sessionId,
                                          // cacheRetention, onPayload, onResponse
): Promise<AssistantMessage>;
```

This is used by Pi's own shipped examples: `examples/extensions/summarize.ts:181` calls a *different* model than the session model; `examples/extensions/handoff.ts:131` calls `ctx.model!` with a custom system prompt. `AssistantMessage.usage` is what you return as the tool result's `usage` field — which is exactly why `nestedModelUsage` is documented. The review's inference from that field was correct; the API it implies is `modelRegistry.complete`, not a re-entrant agent.

**Mechanism 2 — a virtual provider with a custom `streamSimple`.** `pi.registerProvider(id, { ..., streamSimple })` registers models whose stream function you own. Pi dispatches the *main agent loop* through your function, which then picks a real model and forwards. Per-request routing of the primary loop, with zero session mutation.

This is the ecosystem-standard mechanism, verified by reading source, not READMEs:

| Extension | Version read | Mechanism |
|---|---|---|
| `pi-router` | 0.5.0 | `pi.registerProvider("router", { streamSimple })` + mirror models `router/<id>` (`index.ts:3626`) |
| `pi-smart-router` | 0.16.0 | `pi.registerProvider('smart-router', { streamSimple })` + single `auto` model (`extension-setup.ts:106`) |
| `pi-model-auto` | 0.2.2 | `pi.registerProvider("pi-router", { streamSimple })` (`src/index.ts:368`) |
| `pi-bifrost` | 0.4.0 | `input` hook + `pi.setModel()` — the racy path (`index.ts:383`), and it carries explicit failure bookkeeping for `setModel` returning false / throwing |

Three of four use the virtual provider. The fourth is the only one that has to write reliability code for `setModel` failure modes. Pi's own docs corroborate the pattern: *"`PI_PROVIDER` and `PI_MODEL` identify the selected Pi model, not a different upstream model that a router may choose internally"* (`docs/environment-variables.md:27`).

**Recommended architecture for this project — a three-tier split, not a single mechanism:**

| Routing need | Mechanism | Why |
|---|---|---|
| Session mode (`/cheap`, `/balanced`, `/max`) — swaps the whole role→model map | `pi.setModel()` for the *executor* role, from a command handler | Deliberate, user-initiated, whole-session, idle-time. This is precisely what `setModel` is for. Commands can `await ctx.waitForIdle()` first, which removes the race. Visible state change is a *feature*: the footer shows what you're paying for. |
| Non-executor roles: review, advisor, vision, classify, summarize | `ctx.modelRegistry.complete()` inside a custom tool or command | No session mutation, exact per-call thinking/effort parameters, `usage` returns to Pi's accounting, works when the role is a single request with no tool loop. |
| Roles needing tools + an agentic loop (diff reviewer with `read`/`bash`, planner) | Subagent (child Pi process, `model:` in agent frontmatter) | Isolated context — the point of the exercise — plus tool restriction and thinking level per agent, without building a tool loop. |
| `/escalate` — this turn on a stronger model | `pi.setModel()` to the mode's strong model, **sticky and visible**, with `/escalate off` to return | The main loop must keep tools, so nested `complete()` can't do it without reimplementing the agent loop. Sticky+visible beats auto-restore for debuggability, which is a stated project constraint. |

**Do NOT build a virtual provider in v1.** It is the right tool for *automatic* per-turn routing. This project's first Key Decision is "explicit role→model mapping, no auto-classification" — the thing the virtual provider uniquely enables is the thing the project has decided not to do. Its costs are real: it takes over the `/model` picker, `PI_MODEL` reports the virtual id, thinking-level clamping runs against the virtual model's `reasoning` flag and `thinkingLevelMap`, and cost accounting depends on forwarding the *real* `Model` object into the downstream adapter (pi-router's own mirror models carry `cost: {0,0,0,0}`, `index.ts:3561`). Keep it as a documented escape hatch for a later milestone if provider failover chains prove to need request-level retries the agent-level `retry` settings can't express.

---

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  DISTRIBUTION LAYER  (the git repo — one artifact, two consumption modes)      │
│  ┌──────────────────────┐   ┌──────────────────────┐   ┌────────────────────┐  │
│  │ package.json#pi      │   │ bin/bootstrap.sh     │   │ .pi/ (dogfood)     │  │
│  │ manifest → installab-│   │ POSIX sh, machine    │   │ same dir loads when│  │
│  │ le via `pi install`  │   │ setup + templates    │   │ you cd into repo   │  │
│  └──────────────────────┘   └──────────────────────┘   └────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
                                       │ resolves to
                                       ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  PI RUNTIME  (not ours — 2-3 day release cadence, treat as a moving platform)  │
│   ExtensionRunner · AgentSession · ModelRuntime/Registry · ResourceLoader      │
│   7 built-in tools · SessionManager(JSONL) · TUI · prompt-template expander    │
└───────────────────────────────────────────────────────────────────────────────┘
        ▲ hooks / registrations                       ▲ pinned installs
        │                                             │
┌───────┴─────────────────────────────┐   ┌───────────┴───────────────────────┐
│  AUTHORED SUBSYSTEMS (4 extensions) │   │  COMPOSED EXTENSIONS (~11, pinned)│
│  ┌───────────────────────────────┐  │   │  subagents · plan-mode · todos    │
│  │ 1. diagnostics/               │  │   │  background-bash · checkpoint     │
│  │    wire inspector, JSONL log, │  │   │  lsp · loop-detect · web · ask-   │
│  │    callModel() chokepoint,    │◄─┼───┤  user · session-search · themes   │
│  │    context-budget reporter    │  │   └───────────────────────────────────┘
│  ├───────────────────────────────┤  │
│  │ 2. routing/                   │  │   ┌───────────────────────────────────┐
│  │    role map, /cheap|/balanced │  │   │  DECLARATIVE RESOURCES (data)     │
│  │    /max, /escalate, capability│──┼──►│  .pi/agents/*.md   (subagent defs)│
│  │    guard, provider registry   │  │   │  skills/**/SKILL.md (workflows)   │
│  ├───────────────────────────────┤  │   │  prompts/*.md      (thin entries) │
│  │ 3. safety/                    │  │   │  models.json / auth.json templates│
│  │    bash-AST guard, tool       │  │   │  settings.json templates          │
│  │    wrapper, approval tool,    │  │   │  themes/*.json                    │
│  │    audit log, path/secret     │  │   └───────────────────────────────────┘
│  ├───────────────────────────────┤  │
│  │ 4. workflows/                 │  │   ┌───────────────────────────────────┐
│  │    4 commands + state in      │──┼──►│  RUNTIME STATE (gitignored)       │
│  │    .planning-style dir        │  │   │  .pi/logs/*.jsonl  .pi/audit.jsonl│
│  └───────────────────────────────┘  │   │  .pi/state/*.json  .pi/sessions/  │
└─────────────────────────────────────┘   └───────────────────────────────────┘
```

### Component Responsibilities

| Component | Owns | Implementation | Talks to |
|---|---|---|---|
| **Bootstrap** (`bin/bootstrap.sh`) | Machine-level setup: install Pi, probe `aws`/`glab`/`git`/`bash`, write `~/.pi/agent/{settings,models,auth}.json` from templates, seed `.env.example` | POSIX `sh`, zero Node deps beyond `npx`/`npm` | filesystem, `pi install`, nothing at runtime |
| **diagnostics/** | Every fact about what actually went over the wire | Extension: `before_provider_request`, `after_provider_response`, `before_provider_headers`, `turn_end`, `message_end`; exports `callModel()` | writes `.pi/logs/*.jsonl`; exports helper imported by routing + workflows |
| **routing/** | The role→model map, mode state, capability preflight, `models.json`-independent provider registration | Extension: commands + `pi.setModel` + `ctx.modelRegistry` + `pi.registerProvider` | reads `ctx.modelRegistry`, calls `diagnostics.callModel()`, writes mode to `pi.appendEntry` |
| **safety/** | Deny/allow decisions on tool execution, audit trail | Extension: `tool_call` hook **plus** built-in tool wrappers **plus** an `approve_*` tool | writes `.pi/audit.jsonl`; reads policy JSON |
| **workflows/** | The four user-facing workflows and their persisted state | Extension commands (thin) + skills (thick) + a state directory | orchestrates subagents, routing, gates |
| **Subagent extension** (composed) | Child-process isolation, per-agent model/tools/thinking, background runs, worktrees | `pi-subagents@=x.y.z`, configured via `settings.json#subagents` + `.pi/agents/*.md` | reads harness role→model map indirectly, through `agentOverrides` written by bootstrap |
| **Skills** | Anything with a token cost that isn't needed every turn | `SKILL.md` + scripts, discovered by Pi | invoked by model reading the file, or `/skill:name` |
| **Prompt templates** | One-line aliases that expand to a sentence, nothing more | `prompts/*.md`, regex substitution only | none |

### The boundary rule (this is the load-bearing decision)

Every capability lands in exactly one of five buckets. Decide with this table, not by taste:

| If the thing… | It is a… | Per-turn cost |
|---|---|---|
| must be callable by the model mid-turn and needs code | **tool** in an extension | description + JSON schema in every request (~40-200 tok each) + optional `promptSnippet`/`promptGuidelines` in the system prompt (~37 tok measured) |
| is user-initiated, never model-initiated | **extension command** (`pi.registerCommand`) | **0 tokens** — commands are not in the system prompt |
| is a procedure the model should follow when a situation arises | **skill** | ~40-60 tok for name+description+path; body loads only on read |
| is a fixed instruction the user wants to fire by name | **prompt template** | 0 until invoked; then the whole file |
| needs its own context window / different model / restricted tools | **subagent** (`.md` + frontmatter) | 0 in the parent — the whole point |
| is a value, not behaviour | **config** (`settings.json` / `models.json` / policy JSON) | 0 |

**Corollary that should be written into the repo's CONTRIBUTING:** a new capability defaults to *command or skill*. Registering a tool requires justifying its per-request schema cost against the measured budget. This is the concrete form of the project's "progressive disclosure as an architectural principle" constraint.

---

## Recommended Project Structure

```
ky-pi-agent/
├── package.json                 # name, keywords:["pi-package"], pi manifest, peerDeps
├── README.md
├── bin/
│   └── bootstrap.sh             # POSIX sh; cold-machine setup. Also bootstrap.ps1 shim? NO.
├── .pi/                         # ← dogfood dir: loads when you cd into this repo,
│   │                            #   AND is what package.json#pi points at
│   ├── settings.json            # this repo's own harness config (committed, no secrets)
│   ├── extensions/
│   │   ├── diagnostics/
│   │   │   ├── index.ts         # hooks, registration
│   │   │   ├── call-model.ts    # THE nested-LLM chokepoint (exported)
│   │   │   ├── jsonl.ts         # append-only writer, rotation
│   │   │   └── budget.ts        # system-prompt / tool-schema token reporter
│   │   ├── routing/
│   │   │   ├── index.ts
│   │   │   ├── roles.ts         # role→model map types + resolution
│   │   │   ├── modes.ts         # /cheap /balanced /max /escalate
│   │   │   ├── capability.ts    # hard guards: vision, context window, auth
│   │   │   └── providers.ts     # registerProvider for DashScope/Qoder/Bedrock extras
│   │   ├── safety/
│   │   │   ├── index.ts         # tool_call hook + tool wrappers + approve tool
│   │   │   ├── shell.ts         # bash AST → canonical invocations (unbash)
│   │   │   ├── policy.ts        # rules: HEAD==main, glab mr merge, tfstate, ...
│   │   │   ├── approvals.ts     # pending/granted store, TTL, one-shot identity
│   │   │   └── audit.ts         # append to .pi/audit.jsonl
│   │   ├── workflows/
│   │   │   ├── index.ts         # 4 commands, thin
│   │   │   └── state.ts         # spec/plan file IO
│   │   └── tsconfig.json
│   ├── agents/                  # subagent definitions (.md + YAML frontmatter)
│   │   ├── reviewer.md          # model: <strong>, tools: read,grep,find,ls,bash
│   │   ├── scout.md             # model: <cheap>, read-only
│   │   ├── planner.md
│   │   └── advisor.md
│   ├── skills/
│   │   ├── grill-spec/SKILL.md
│   │   ├── plan-execute/SKILL.md
│   │   ├── review-mr/SKILL.md
│   │   ├── playwright-verify/SKILL.md
│   │   └── bedrock-sso-recovery/SKILL.md
│   ├── prompts/                 # NON-RECURSIVE discovery — flat files only
│   │   ├── grill.md   plan.md   ship.md   quick.md
│   ├── themes/
│   │   └── ky.json
│   └── templates/               # copied to ~ by bootstrap, never read at runtime
│       ├── settings.user.json
│       ├── models.json
│       ├── auth.json            # only $ENV_VAR / !command references
│       └── env.example
├── docs/
│   ├── RUNBOOK.md               # first-run verification on the work laptop
│   └── DIAGNOSTICS.md           # JSONL schema reference
├── tests/
└── .github/workflows/ci.yml     # matrix: windows-latest + macos-latest
```

### Structure Rationale

- **`.pi/` as the single source, not `extensions/` at root.** Verified: `@minhduydev/pi-harness@2.8.1` does exactly this — `package.json#pi` points at `./.pi/extensions`, `./.pi/skills`, `./.pi/prompts`, `./.pi/themes`, and ships `.pi/agents` and `.pi/settings.json` in `files`. The payoff is that the repo *is* a live Pi project: `cd ky-pi-agent && pi` loads the harness you are editing, with `/reload` hot-reloading it. The alternative convention — top-level `extensions/`, `skills/`, `themes/`, `prompts/` (verified in `mitsupi@1.6.0` and `lelezonio-pi-kit@0.2.7`) — is simpler but gives you no dogfooding without symlinks. For a harness whose whole risk is "does this actually work", dogfooding wins.
- **`package.json` is required here even though it is optional in general.** Convention-directory discovery works with no manifest (`docs/packages.md:160`), but you need `package.json` for (a) `peerDependencies: {"@earendil-works/pi-coding-agent":"*", ...}` — Pi bundles these and they must *not* be bundled by you (`docs/packages.md:171`), (b) real deps like the bash parser, (c) `keywords:["pi-package"]` for the gallery.
- **`bin/bootstrap.sh` and `pi install` are orthogonal, not alternatives.** `pi install https://github.com/kaiyitkoh/ky-pi-agent` registers resources in `~/.pi/agent/settings.json` and clones to `~/.pi/agent/git/github.com/kaiyitkoh/ky-pi-agent`. It does not install Pi, probe for `aws`/`glab`, or write `models.json`/`auth.json`. Verified pattern in both kits: ship a `bin` entry (`lelezonio-pi-kit` → `bin/install.mjs`, `@minhduydev/pi-harness` → `scripts/init-consumer.mjs`) that merges settings and manages *marked regions* in user files. Copy the marked-region idea: `<!-- ky-pi-agent managed:start -->` … `:end` so re-running bootstrap is idempotent and user edits outside the markers survive.
- **`prompts/` must be flat.** Verified: *"Template discovery in `prompts/` is non-recursive"* (`docs/prompt-templates.md:95`). There is no `gsd:`-style namespace. Prefix filenames instead (`ky-grill.md`) or accept bare names.
- **Runtime state under `.pi/` and gitignored.** Verified pattern from `@minhduydev/pi-harness`, which gitignores `.pi/sessions/`, `.pi/artifacts/`, `.pi/usage/`, `.pi/context-usage.jsonl`, `.pi/decision-log.jsonl`, `.pi/auth.json`, `.pi/trust.json`. Adopt this list nearly verbatim — it is a public repo and `.pi/auth.json` must never be committable by accident.
- **No `bootstrap.ps1`.** Constraint says POSIX `sh` throughout; Pi requires a bash shell on Windows anyway (`docs/windows.md`), so Git Bash is a hard prerequisite the bootstrap should *check for*, not work around.

---

## Architectural Patterns

### Pattern 1: Two-tier model selection (session model + nested calls)

**What:** Session model = the executor, changed only by explicit user commands. Everything else is a nested call or a subagent.

**When:** Always, for this project. Revisit only if automatic per-turn routing becomes a requirement.

**Trade-offs:** Visible session state changes (good for debuggability, bad if you wanted invisibility). Nested calls do not appear in the transcript unless you surface them. No race conditions, because commands run at idle and nested calls never touch session state.

```typescript
// routing/modes.ts
const MODES = {
  cheap:    { executor: "deepseek/deepseek-v4-flash", review: "deepseek/deepseek-v4-pro",  advisor: "deepseek/deepseek-v4-pro" },
  balanced: { executor: "deepseek/deepseek-v4-flash", review: "bedrock/claude-sonnet-…",   advisor: "bedrock/claude-sonnet-…" },
  max:      { executor: "bedrock/claude-sonnet-…",    review: "bedrock/claude-opus-…",     advisor: "bedrock/claude-opus-…" },
} as const;

pi.registerCommand("balanced", {
  description: "Switch the role→model map to balanced",
  handler: async (_args, ctx) => {
    await ctx.waitForIdle();                       // removes the setModel race entirely
    const target = resolve(ctx, MODES.balanced.executor);
    const guard = capabilityCheck(ctx, target, { needsVision: false });
    if (!guard.ok) return void ctx.ui.notify(guard.reason, "error");
    if (!await pi.setModel(target)) {              // false = no API key for that model
      return void ctx.ui.notify(authHint(ctx, target), "error");   // actionable, not opaque
    }
    setMode("balanced");                            // module state
    pi.appendEntry("ky:mode", { mode: "balanced", at: Date.now() }); // survives restart, 0 tokens
  },
});
```

`pi.appendEntry` is the right persistence primitive: *"Custom entries do NOT participate in LLM context"* (`docs/extensions.md:1442`), and they are restorable from `ctx.sessionManager.getBranch()` on `session_start`. Verified in use by `@firstpick/pi-extension-tools@0.1.8`, which persists the active-tool set both to a JSON file and to a session entry, preferring the file on restore.

### Pattern 2: One `callModel()` chokepoint for every nested LLM call

**What:** A single exported helper in `diagnostics/` that all nested calls go through.

**Why this is not optional:** Verified in `dist/core/sdk.js:170-215` — the `before_provider_request`, `after_provider_response`, `before_provider_headers`, and `context` hooks are wired into the *main agent's* `streamFn` only. A direct `ctx.modelRegistry.complete()` goes to `ModelRuntime.complete()` and **never fires those hooks**. Without a chokepoint, the wire inspector is blind to exactly the calls (advisor, reviewer, classifier) whose parameters you most need to verify. `ProviderRequestOptions` carries per-call `onPayload` and `onResponse` (`pi-ai/dist/types.d.ts:70,74`), so the chokepoint can restore full visibility.

```typescript
// diagnostics/call-model.ts
export async function callModel(ctx: ExtensionContext, opts: {
  role: string; model: Model<Api>; systemPrompt?: string;
  messages: Message[]; tools?: Tool[]; apiOptions?: Record<string, unknown>;
}): Promise<AssistantMessage> {
  const started = Date.now();
  const res = await ctx.modelRegistry.complete(opts.model,
    { systemPrompt: opts.systemPrompt, messages: opts.messages, tools: opts.tools },
    {
      ...opts.apiOptions,                       // reasoningEffort | thinkingEnabled | ...
      signal: ctx.signal,                       // Esc cancels nested work
      cacheRetention: "none",
      sessionId: ctx.sessionManager.getSessionId(),
      onPayload: (p) => { logWire("nested.request", { role: opts.role, payload: p }); return undefined; },
      onResponse: (r) => { logWire("nested.response", { role: opts.role, status: r.status, headers: r.headers }); },
    });
  logTurn({ kind: "nested", role: opts.role, model: `${opts.model.provider}/${opts.model.id}`,
            usage: res.usage, latencyMs: Date.now() - started, stopReason: res.stopReason });
  return res;
}
```

Per-role thinking budgets are **exact** here in a way they are not for the main loop: `anthropic-messages` takes `thinkingEnabled`/`thinkingBudgetTokens`/`effort`, `openai-completions`/`responses` take `reasoningEffort` (verified in `pi-ai/dist/api/*.d.ts`). The main loop only has session-scoped `pi.setThinkingLevel()`. This inverts the project's assumption: the *nested* path is where per-role thinking budgets are cheap and verifiable, and it can be validated the moment the wire inspector exists.

### Pattern 3: Block → approval-tool → re-issue (the only way to get a dialog out of `tool_call`)

**What:** `tool_call` blocks with a reason that names a request id and instructs the model to call a dedicated approval tool. That tool's `execute()` runs the UI. On approval it records a one-shot grant keyed to the exact command; the model re-issues; the hook now allows it.

**Why not just `await ctx.ui.confirm()` inside `tool_call`:** you *can* — Pi's own `examples/extensions/permission-gate.ts` does — and for a TUI-only harness that is simpler. But three verified facts push toward the two-step pattern:

1. In print (`-p`) and JSON mode the runner installs `noOpUIContext`, where `confirm: async () => false`, `select: async () => undefined`, `custom: async () => undefined` (`dist/core/extensions/runner.js:88-119`). Confirms **fail closed** — which is the correct default, but only if your code is written as "block unless explicitly approved". Written as `if (ctx.hasUI && !ok) block`, it fails **open**.
2. The dialog blocks the agent inside a hook. The approval-tool form gives the model a structured, resumable protocol and lets you attach risk metadata, TTLs, and scoped bypasses.
3. It is what the most mature Pi infra guard actually does. Verified in `@ramtinj95/pi-infra-command-guard@0.9.1`: `guardExecution(...)` returns `mode !== "tui" → { allow:false, reason: "…Approval is unavailable outside TUI mode. Do not retry the command." }` (`approvals.ts:209-219`), otherwise creates a pending approval and returns a reason containing the request id; the `approve_infra_command` tool then drives `ctx.ui.select()` / a custom approval component (`index.ts:203-330`).

**And enforce twice.** The same extension registers a wrapped built-in bash tool *in addition to* the hook:

```typescript
// verified shape, @ramtinj95/pi-infra-command-guard index.ts:375-391
pi.registerTool({
  ...bashTool,
  execute: async (id, params, signal, onUpdate, ctx) => {
    const decision = guardExecution(approvals, identity(params, ctx.cwd), ctx.mode, policy, bypasses);
    if (!decision.allow) throw new Error(decision.reason);   // throw ⇒ isError:true to the LLM
    return bashTool.execute(id, params, signal, onUpdate);
  },
});
```

This matters because `tool_call` handlers chain and *"Later `tool_call` handlers see mutations made by earlier handlers. No re-validation is performed after your mutation"* (`docs/extensions.md:761-764`). A hook-only guard can be defeated by any later-loaded extension that rewrites `event.input`. The tool wrapper is the last checkpoint before execution. Build both.

### Pattern 4: Bash AST, not string matching — and fail closed on anything you cannot parse

**What:** Parse the command into an AST, resolve wrappers (`sudo`, `env`, `sh -c`, `xargs`, `python -c`), reduce to a canonical list of `{executable, args, cwd}` invocations, then apply per-executable allow/deny policy.

**Verified state of the art:**
- `@ramtinj95/pi-infra-command-guard@0.9.1` depends on **`unbash@4.0.10`**, a real bash parser (`shell.ts:1`). It maintains `SHELL_RUNNERS` (`sh,bash,zsh,dash,fish,xargs,python*,node,perl,ruby`), option tables for `sudo`/`env` so it can find the real executable past flags, and — critically — it **errors out** on constructs it cannot reason about: backtick substitution, `$(...)`, process substitution, heredocs, background `&`, unterminated quotes, dynamic executables (`shell.ts:579-687`). Those errors become blocks, not passes.
- `cc-safety-net@2.0.3` is *not* AST-based despite the "canonical IR" framing — its canonicalisation is **path** canonicalisation (env-var expansion with a depth limit of 64, realpath resolution, `PI_CODING_AGENT_DIR`/`HOME`/`XDG_*` awareness). It handles heredocs lexically (46 references). Its Pi adapter is **block-only**: `{ block: true, reason }`, never a prompt, and it fails closed on malformed events (`dist/pi/index.js`).

**The honest boundary:** `g=push; git $g` is defeated by AST parsing only if you refuse to evaluate variable expansion — which is what "block on dynamic executable" does. `sh -c "$(curl …)"` is defeated only by blocking command substitution outright. Both extensions do exactly that. So a genuinely robust guard is *restrictive*: it blocks a class of legitimate commands. That is the real trade, and it is the correct one here, because the project already has the real control (GitLab server-side protected branches) and this layer is defence-in-depth.

**What is theatre:** any regex over the raw command string; any allowlist that does not resolve wrappers; any check that runs only in `tool_call` and not also in the tool wrapper; any confirm-based gate that has not been tested under `-p`.

### Pattern 5: Progressive disclosure with measured budgets

**What:** Keep the active tool set minimal per session profile; put procedures in skills; put big contexts in subagents; measure, don't guess.

**Measured facts (produced by importing Pi 0.84.1's own builders — reproduce with `docs/DIAGNOSTICS.md`):**

| Item | Cost | Where it lives |
|---|---|---|
| System prompt, 7 built-in tools, no skills, no `AGENTS.md` | **3,025 chars ≈ 756 tok** | system prompt, every request |
| System prompt, default 4 tools (`read,bash,edit,write`) | 2,230 chars ≈ 558 tok | same |
| Built-in tool **descriptions** (7 tools) | 1,595 chars ≈ **399 tok** | provider payload `tools[]`, every request |
| Built-in tool **JSON schemas** (7 tools) | 2,829 chars ≈ **707 tok** | provider payload `tools[]`, every request |
| One custom tool with `promptSnippet` + 1 `promptGuidelines` bullet | +147 chars ≈ **+37 tok** | system prompt |
| Skills block header (fixed, once any skill exists) | ~450 chars ≈ **112 tok** | system prompt |
| Each additional skill (`<name>`,`<description>`,`<location>`) | ~150-250 chars ≈ **40-60 tok** | system prompt |

So: **the real per-turn floor is ~1,850 tokens, not ~400.** The project's context note understates it by ~4x, because it counts only the system prompt and only the 4-tool default. The dominant term is the tool schema array in the payload, which `promptSnippet` discipline does nothing about. Verified mechanism: `buildSystemPrompt` lists a tool in *Available tools* **only if** the caller supplied a `toolSnippets[name]` entry (`dist/core/system-prompt.js:42`) — but the tool's `description` + `parameters` go into the request regardless, because that is how tool calling works.

**Therefore the lever that matters is `pi.setActiveTools()`, not `promptSnippet` omission.**

Verified capabilities:
- `pi.getActiveTools() / pi.getAllTools() / pi.setActiveTools(names)` work at runtime for built-ins *and* extension tools (`docs/extensions.md:1646-1671`).
- `pi.registerTool()` also works after startup, inside `session_start` or command handlers; new tools are live without `/reload` (`docs/extensions.md:1342`).
- Purely **additive** `setActiveTools` calls made *during a tool's execution* get native deferred loading on Anthropic Sonnet/Opus/Fable ≥4.5 and OpenAI gpt-5.4+ (`defer_loading` / `tool_search_call`); everything else falls back to sending the full list next request (`docs/extensions.md:2331-2364`). **DeepSeek gets the fallback**, so for the daily driver, deferred loading buys nothing — the win comes from starting small.
- Tool **removal** never uses deferred loading and invalidates the provider prompt cache. So: set the profile once at `session_start`, then only add.
- The `context` hook **cannot** strip tool definitions. `ContextEventResult` is `{ messages? }` only (`types.d.ts:774`). Confirmed no.
- There is **no `defaultTools` setting.** `docs/settings.md` has no such key; tool selection at launch is `--tools` / `--exclude-tools` / `--no-builtin-tools` / `--no-tools` (`docs/usage.md:211-214`), and at runtime it is `setActiveTools`. Any plan built on a `defaultTools` setting is built on something that does not exist.

**Design:** ship named tool profiles (`recon`, `implement`, `review`, `full`) resolved at `session_start` and switchable by command; persist the active set the way `@firstpick/pi-extension-tools` does (file + session entry, file wins).

**Measuring from inside an extension:**
```typescript
pi.registerCommand("budget", {
  handler: async (_a, ctx) => {
    const sp = ctx.getSystemPrompt();                       // exact string Pi will send
    const opts = ctx.getSystemPromptOptions();              // commands only; incl. contextFiles, skills
    const active = new Set(pi.getActiveTools());
    const schema = pi.getAllTools().filter(t => active.has(t.name))
      .reduce((n, t) => n + t.description.length + JSON.stringify(t.parameters).length, 0);
    ctx.ui.notify(`system ${sp.length}ch · tools ${schema}ch · ≈${Math.round((sp.length+schema)/4)} tok`, "info");
  },
});
```
`ctx.getSystemPrompt()` is exact for the system prompt but explicitly excludes `context`-hook message edits and `before_provider_request` payload rewrites (`docs/extensions.md:1066-1073`). For ground truth, read the payload the wire inspector captured — that is the only number that is not an estimate.

### Pattern 6: Workflows = thin command + thick skill + file state

**What:** each of the four workflows is (a) an extension command for control flow and state, (b) a skill holding the actual procedure, (c) a directory of markdown artifacts for state.

**Why the mix, verified:**
- Prompt templates are regex substitution only — `$1`, `$@`, `$ARGUMENTS`, `${1:-default}`, `${@:N:L}` (`dist/core/prompt-templates.js:58`). **No bash, no file inclusion, no recursion** (the code explicitly does not re-substitute expanded content). Discovery is flat. They can be a nice `/grill <topic>` front door and nothing more.
- Skills auto-surface by description and load on read, so the *procedure* costs ~50 tok/turn instead of its full length. This is where multi-hundred-line workflow instructions belong.
- Extension commands get `ExtensionCommandContext` — `waitForIdle()`, `newSession()`, `fork()`, `navigateTree()`, `switchSession()`, `reload()` — none of which are available from a hook or a tool (they can deadlock). Any workflow step that needs a fresh session, a fork, or an idle barrier **must** be a command.
- State: use a `.planning/`-equivalent directory of markdown, not session entries. Rationale from the project's own decisions: `AGENTS.md`-style visible-in-diff artifacts over invisible state. `pi.appendEntry` is right for *harness* state (mode, tool profile), wrong for *work product* (specs, plans) because it is invisible to git and to any other tool.

```
/grill <topic>   → command: creates .work/<slug>/SPEC.md, sends a user message that
                   pulls in the grill-spec skill, loops until the spec's open questions are empty
/plan            → command: reads SPEC.md, spawns planner subagent, writes PLAN.md
/go              → command: reads PLAN.md, per task: deterministic gates → executor →
                   reviewer subagent → mark done
/quick <task>    → command: no artifacts, atomic commit only
```

Note the collision rule: if two extensions register the same command name Pi keeps both and suffixes them `/review:1`, `/review:2` (`docs/extensions.md:1498`). Prefix harness commands to avoid ambiguity with the ~11 composed extensions.

### Pattern 7: Subagent composition without forking

**What:** pin `pi-subagents` exactly; declare agents as data; wire models through settings, not code.

**Verified surface (`pi-subagents@0.47.1`):**
- Agent discovery: builtin `~/.pi/agent/extensions/subagent/agents/`, package `package.json#pi-subagents.agents`, user `~/.pi/agent/agents/**/*.md`, project `.pi/agents/**/*.md` (`docs/agents.md:19-24`). **Recursive**, unlike prompts.
- Frontmatter: `name`, `aliases`, `description`, `tools` (strict allowlist), `extensions` / `subagentOnlyExtensions`, `model`, `fallbackModels`, `thinking`, `systemPromptMode: replace|append`, `inheritProjectContext`, `inheritSkills`, `skills`, `skillPath`, `defaultContext: fresh|fork`, `output`, `defaultReads`, `defaultProgress`, `async`.
- Model precedence, strongest first: per-run override → frontmatter `model` → `settings.subagents.agentOverrides.<name>.model` → `settings.subagents.defaultModel` → **parent session model** (`docs/models.md:11`).
- Per-run override syntax: `/run reviewer[model=anthropic/claude-sonnet-4:high] "Review this diff"`.
- **No automatic reviewer.** Verified verbatim: *"Installing the extension does not start an automatic reviewer in the background. It gives Pi a delegation tool."* (`README.md:47`).

**Therefore, wiring role→model to subagents:** write `settings.subagents.agentOverrides` from the harness's mode switch. Keep `.pi/agents/*.md` free of `model:` so the settings layer wins; `agentOverrides` also fills in fields the frontmatter leaves unset, which is exactly the composition seam you want.

**Therefore, triggering the reviewer automatically:** three options, in increasing coupling.
1. **Workflow-driven (recommended).** `/go` is your code; after the executor finishes a task, the command calls the subagent tool itself. Deterministic, no prompting.
2. **`agent_settled` hook + `pi.sendUserMessage(..., { deliverAs: "followUp" })`.** Fires when Pi will not continue on its own; inject "run reviewer on the diff". Simple, but you are asking the model to comply.
3. **`AGENTS.md` / `--append-system-prompt` instruction.** What the README suggests. Cheapest, least reliable — a cheap model is precisely the one that will skip it.

Use (1) inside workflows and (2) as the safety net outside them. Do not rely on (3) alone: "the cheap model didn't do the review step" is the project's core failure mode restated.

**Two interactions worth flagging now:** (a) subagents default to inheriting the parent model, so any future virtual routing provider would be inherited too, and a child would route through your provider recursively — pin child models explicitly. (b) forked context over an Anthropic parent with signed thinking blocks forces the child's thinking off (`docs/models.md`), which matters if the reviewer is a Bedrock Claude fed a forked context.

---

## Data Flow

### Request flow (verified hook order, `docs/extensions.md:277-348`)

```
user types "/go" ─────────────────────────────────────────────────────────────┐
  │                                                                            │
  ├─ built-in commands matched FIRST in the editor submit handler              │
  │    (/model /settings /share /export /compact /tree … — verified            │
  │     dist/modes/interactive/interactive-mode.js:2295-2430)                  │
  │    ⇒ extensions CANNOT intercept these. See "unblockable /share" below.    │
  ├─ extension commands  → workflows.handler(args, ExtensionCommandContext)    │
  ├─ input event         → (transform / handled / continue)                    │
  ├─ skill + prompt-template expansion                                         │
  ├─ before_agent_start  → routing may amend systemPrompt for this turn only   │
  │                        (chained across extensions; 0 permanent cost)       │
  │                                                                            │
  │   ┌── per turn ──────────────────────────────────────────────────────┐     │
  │   ├─ turn_start                                                      │     │
  │   ├─ context            → prune messages (CANNOT touch tools)        │     │
  │   ├─ before_provider_headers → diagnostics tags request              │     │
  │   ├─ before_provider_request → DIAGNOSTICS: full payload dump ★      │     │
  │   ├─ [HTTP to provider]                                              │     │
  │   ├─ after_provider_response → DIAGNOSTICS: status + headers ★       │     │
  │   │                                                                  │     │
  │   │  model emits tool calls:                                         │     │
  │   │   ├─ tool_execution_start                                        │     │
  │   │   ├─ tool_call        → SAFETY gate #1 (may block / mutate)      │     │
  │   │   ├─ [tool.execute]   → SAFETY gate #2 (wrapper, throws)         │     │
  │   │   │      └─ if the tool is advisor/review: diagnostics.callModel │     │
  │   │   │         → ctx.modelRegistry.complete(strongModel, …)  ★      │     │
  │   │   ├─ tool_result      → may attach nested `usage`                │     │
  │   │   └─ tool_execution_end                                          │     │
  │   └─ turn_end             → DIAGNOSTICS: per-turn JSONL row          │     │
  │                                                                      │     │
  ├─ agent_end                                                                 │
  └─ agent_settled          → workflows: auto-trigger reviewer if in /go ──────┘

★ = the four points where the harness observes or produces model traffic.
    All four must funnel through diagnostics or the log has holes.
```

**Parallel-execution caveat, verified:** tool calls run in parallel by default. Siblings from one assistant message are preflighted sequentially then executed concurrently, and `tool_call` is *not* guaranteed to see sibling results in `ctx.sessionManager` (`docs/extensions.md:757`). Safety policy must therefore be evaluable from `(command, cwd)` alone — no "was the previous command a `git checkout`?" reasoning. Any harness tool that mutates files must use `withFileMutationQueue()` or it will race the built-in `edit`.

### State flow

```
harness state (mode, tool profile, approvals)
   ├─ in-memory module state            ← authoritative during the session
   ├─ pi.appendEntry("ky:*", …)         ← 0 tokens, survives restart, restored on session_start
   └─ .pi/state/*.json                  ← survives /new, shared across sessions

work product (specs, plans, reviews)
   └─ .work/<slug>/{SPEC,PLAN,REVIEW}.md   ← git-visible, diffable, the project's stated preference

observability (append-only, never read back into context)
   ├─ .pi/logs/wire-<date>.jsonl        ← full request/response payloads (may contain secrets → gitignore)
   ├─ .pi/logs/turns-<date>.jsonl       ← one row per turn/nested call
   └─ .pi/audit.jsonl                   ← every blocked / approved action
```

### Key data flows

1. **Mode switch.** command → `waitForIdle` → capability guard → `pi.setModel` → write `agentOverrides` for subagents → `appendEntry` → statusline update via `model_select`.
2. **Escalation.** `/escalate` → resolve `MODES[mode].strong` → capability guard → `setModel` → sticky until `/escalate off`. Every escalation writes an audit row so cost spikes are explainable after the fact.
3. **Advisor.** executor calls `ask_advisor` tool → `callModel(strongModel, {systemPrompt: advisorPrompt, messages:[question + evidence]})` → returns text + `usage` → Pi folds `usage` into `/session` totals.
4. **Diff review.** `/go` step end → collect `git diff` + touched file contents + typecheck/test output → subagent `reviewer` (isolated context, own model, `read/grep/find/ls/bash`) → structured findings → executor fixes → loop.
5. **Blocked command.** `tool_call` → AST parse → policy deny → create pending approval → block with request id → model calls `approve_ky_command` → `ctx.ui.select` → grant one-shot keyed to exact command → model re-issues → hook allows → wrapper re-checks → executes → audit row.

---

## Scaling Considerations

Not user-count scaling — this is a single-user harness. The axes that actually break are context budget, session length, and process count.

| Axis | At the low end | Where it breaks | Fix |
|---|---|---|---|
| **Registered tools** | 7 built-ins ≈ 1,106 tok of payload schema | ~20 active tools ≈ 3-4k tok/turn; on a 64k-context cheap model that is 5%+ of budget before any work | Tool profiles via `setActiveTools`; loader-tool + additive activation; anything user-initiated becomes a command |
| **Skills** | 5 skills ≈ 112 + 5×50 ≈ 362 tok | ~30 skills ≈ 1.6k tok/turn — the GSD-scale failure mode the project already rejected | Cap the catalogue; `disable-model-invocation: true` for skills only reachable via `/skill:name` (verified frontmatter field, hides from system prompt) |
| **Session length** | fine | auto-compaction at `contextWindow − reserveTokens(16384)`; `keepRecentTokens` 20000 | Subagents for anything long-running; `/tree` + labels as checkpoints; tune `compaction.*` per model |
| **Parallel subagents** | 1-2 fine | each is a full child Pi process; N×(model cost + memory); worktree contention | Cap concurrency (the shipped example caps 8 tasks / 4 concurrent); worktree isolation per agent |
| **JSONL logs** | fine | wire logs contain full payloads — hundreds of MB in a week of heavy use | Daily rotation + size cap + a retention command; never read logs into context |
| **Repo size (multi-stack)** | fine | `grep`/`find` results truncate at 50KB / 2000 lines; the model silently works from a partial view | Scout subagent returns a compressed map; prefer `find`→`read` over broad `grep` |

**First bottleneck, predicted:** per-turn token floor on DeepSeek Flash. Second: log volume. Third: subagent process cost on a laptop.

---

## Anti-Patterns

### Anti-Pattern 1: Building the harness around `setModel` for per-turn routing
**What people do:** hook `input`, classify, `setModel`, hope. (This is `pi-bifrost`'s design, and it carries a whole `reliability-store` to cope with the resulting failures.)
**Why it's wrong:** `setModel` returns `false` when auth is missing and can throw; it mutates visible session state mid-flight; it interacts with thinking-level clamping and `model_select` handlers.
**Do instead:** session-scoped modes for the executor (deliberate, at idle) + `modelRegistry.complete()` for roles + subagents for loops. Virtual provider only if automatic routing later becomes a requirement.

### Anti-Pattern 2: Treating `promptSnippet` omission as context-budget management
**What people do:** omit `promptSnippet` so the tool "doesn't appear in the system prompt".
**Why it's wrong:** verified — the tool's `description` and full JSON `parameters` still go into every request's `tools[]` array. You saved ~37 tokens and kept ~150.
**Do instead:** don't register the tool. `setActiveTools` is the only real lever.

### Anti-Pattern 3: A `tool_call` guard with no tool wrapper
**Why it's wrong:** later-loaded `tool_call` handlers can mutate `event.input` after yours ran, and Pi performs no re-validation. Your allow decision was made about a different command than the one that executes.
**Do instead:** hook for UX and early rejection; wrapped tool `execute` for enforcement. Verified as the pattern used by the one Pi extension that takes infra safety seriously.

### Anti-Pattern 4: Confirm-based gates that were never tested headless
**Why it's wrong:** `noOpUIContext.confirm` returns `false` and `select` returns `undefined` in `-p`/json mode. Code shaped `if (ctx.hasUI && !ok) block` silently permits everything in CI.
**Do instead:** invert to deny-by-default; add a CI test that runs the guard under `--mode json` and asserts the deny.

### Anti-Pattern 5: Assuming the wire inspector sees everything
**Why it's wrong:** verified — provider hooks are wired only into the main agent's `streamFn` (`dist/core/sdk.js:200`). Nested `complete()` calls bypass them entirely.
**Do instead:** the single `callModel()` chokepoint with per-call `onPayload`/`onResponse`. Add a lint/test that forbids importing `modelRegistry.complete` outside `diagnostics/`.

### Anti-Pattern 6: Porting a namespaced command tree onto prompt templates
**Why it's wrong:** flat discovery, no bash, no includes, no recursion, no `gsd:` namespace.
**Do instead:** commands for control flow, skills for procedure, templates only as one-line front doors.

### Anti-Pattern 7: Believing `/share` can be blocked by an extension
**Why it's wrong:** verified — `/share` is matched in the interactive editor's submit handler *before* extension commands or the `input` event (`interactive-mode.js:2326`). No hook sees it. Registering a command named `share` does not shadow it.
**Do instead:** the real control is `gh`: `handleShareCommand` runs `gh auth status` first and aborts with an error if `gh` is missing or unauthenticated (`interactive-mode.js:4905-4917`). On the work laptop, ensure `gh` is not authenticated, and document it in the runbook. A `PATH` shim for `gh` is a defensible belt-and-braces measure. Wrapping the editor component to filter submissions is *theoretically* possible (`newEditor.onSubmit = this.defaultEditor.onSubmit`, `interactive-mode.js:2030`) but is UNVERIFIED and fragile against a 2-3 day release cadence — do not depend on it.

---

## Integration Points

### External services

| Service | Integration pattern | Gotchas |
|---|---|---|
| **AWS Bedrock** | Built-in provider; `pi-ai/dist/bedrock-provider` + `api/bedrock-converse-stream` | Cost is computed inside the adapter via `calculateCost(model, usage)`. SSO expiry surfaces as a provider error — catch in the executor path and map to an actionable message; a `bedrock-sso-recovery` skill is the cheapest fix. Thinking config for non-Anthropic Bedrock models must be verified with the wire inspector before any budget work. |
| **Alibaba DashScope** | Custom provider in `models.json` (`api: "openai-completions"`, `baseUrl`, `apiKey: "$DASHSCOPE_API_KEY"`) or `pi.registerProvider` | Not the built-in `qwen-token-plan`. Qwen thinking needs `compat.thinkingFormat: "qwen"`; some OpenAI-compatible servers need `compat.supportsDeveloperRole:false` / `supportsReasoningEffort:false`. `compat` can be set per provider or per model. |
| **Qoder (official PAT)** | `pi.registerProvider` from `routing/providers.ts`, or `models.json` if it is plain OpenAI-compatible | Extension registration allows an async factory that discovers models at startup (`docs/extensions.md:190-218`) — useful if the model list is dynamic. |
| **GitLab (`glab`)** | bash tool, guarded | `glab mr merge` is the deny target, not "main". Server-side protected branches are the real control. |
| **GitHub Actions** | `windows-latest` + `macos-latest` matrix | Runs `pi --mode json -p` smoke tests: extensions load, commands register, guard denies under headless. This is where Anti-Pattern 4 gets caught. |
| **Playwright CLI** | skill driving the user's existing flow | Not a tool — zero per-turn cost until invoked. |

### Internal boundaries

| Boundary | Communication | Notes |
|---|---|---|
| routing ↔ diagnostics | direct import of `callModel()` | The one intentional coupling. Everything else stays decoupled. |
| safety ↔ everything | none — reads policy files, writes audit | Must not import routing or workflows, so it can be reviewed in isolation (it is in the credential/exec path). |
| workflows ↔ subagents | the subagent extension's registered tool, invoked from a command | Composition seam. Never import `pi-subagents` internals — pin the version, use the tool. |
| harness ↔ subagent models | `settings.json#subagents.agentOverrides` written by mode switch | Data, not code. Survives upstream refactors. |
| extension ↔ extension | `pi.events` bus (`pi.events.on/emit`) | Use for statusline updates from routing; avoids import cycles. |
| any ↔ TUI | `ctx.ui.*`, guarded by `ctx.mode === "tui"` for `custom()` and `ctx.hasUI` for dialogs | Two different guards; they are not interchangeable. |

---

## Build Order

Dependencies are hard unless marked *soft*.

```
P0  Repo skeleton + dual-mode packaging + bootstrap
     package.json#pi → ./.pi/*, peerDeps, .gitignore (runtime state), bin/bootstrap.sh,
     templates/, CI matrix skeleton, a hello-world extension proving `pi install` and
     the .pi/ dogfood path both work on Windows and macOS.
     Depends on: nothing.  Exit test: `pi install <repo>` on a clean profile + `cd repo && pi` both load it.

P1  Diagnostics core                        ← depends on P0
     before_provider_request / after_provider_response / before_provider_headers,
     turn_end → JSONL, callModel() chokepoint, /budget command, log rotation.
     Why first: it is the instrument. Two of four quality levers and the entire
     DeepSeek diagnosis are unverifiable without it. Building anything else first
     means building on an unmeasured assumption — the exact failure the project
     already had once.
     Exit test: a wire dump for each provider showing whether thinking/effort params arrive.

P2  Providers + model catalogue             ← depends on P0; verified by P1
     models.json / auth.json templates, DashScope + Qoder + Bedrock structurally complete,
     $ENV_VAR / !command interpolation, capability metadata (input[], contextWindow, cost).
     Runs in parallel with P3 if desired (soft).
     Exit test: `pi --list-models` shows every intended model; no secret in the repo.

P3  Safety                                  ← depends on P0 only
     bash AST (unbash) → canonical invocations, policy (HEAD==main, glab mr merge,
     tfstate/.env/kubeconfig reads, terraform apply/destroy, kubectl delete, aws mutations),
     tool_call hook + built-in tool wrappers + approve_* tool + audit JSONL.
     Deliberately independent of routing so it can be source-reviewed alone.
     Exit test: headless deny test in CI; a table of 30 evasion attempts, each blocked or
     explicitly documented as out of scope.

P4  Routing                                 ← depends on P1 (verify) + P2 (models exist)
     role map, /cheap /balanced /max /escalate, capability guard (vision, context window,
     hasConfiguredAuth), actionable SSO-expiry message, mode persistence.
     Exit test: every mode switch produces a wire dump proving the intended model was used.

P5  Composed extensions, pinned             ← depends on P0; P4 for agentOverrides wiring
     subagents, plan mode, todos, background bash, checkpointing, LSP, loop detection,
     web, ask-user, session search, themes — exact versions, source-reviewed for anything
     in the tool-execution or credential path. Agent .md files + settings templates.
     Exit test: `pi list` matches a committed lockfile; a reviewer subagent runs end to end.

P6  Quality gates                           ← depends on P1, P4, P5
     deterministic gates first (LSP/typecheck/lint), then strong-model diff review fed
     diff + touched files + test output via the reviewer subagent, then advisor escalation.
     Per-role thinking budgets ONLY if P1 proved the parameters land.
     Exit test: a seeded bug that DeepSeek misses and the gate catches.

P7  Workflows                               ← depends on P3, P4, P5, P6
     grill→spec, plan→execute, review→MR→staging, quick. Thin commands + skills + .work/ files.
     Exit test: one real feature shipped end to end on the work laptop.

P8  Progressive-disclosure tuning pass      ← depends on everything that registers a tool
     Measure with /budget, define tool profiles, demote tools to skills/commands,
     set the per-turn budget as a CI assertion.
     The RULES land in P0 (CONTRIBUTING); the TUNING lands here.

P9  UI                                      ← depends on P4 (model/mode), P5 (subagent activity)
     theme, statusline, header, subagent widget. Sequenced last by decision.
```

**The three non-obvious ordering constraints:**
1. **P1 before P4 and P6.** The project's own Key Decision says so, and the architecture makes it structural: `callModel()` is a P1 artifact that P4 and P6 import.
2. **P3 parallel to P2/P4, not after.** Safety has no dependency on routing, and the deployment risk (`main` auto-deploys) exists from the first real session. Ship it early even if routing is still `/max`-only.
3. **P8 cannot be first.** You cannot tune a budget before the tools exist. But the *boundary rule* (tool vs command vs skill) must be enforced from P0, or P8 becomes a rewrite.

---

## Open Questions / UNVERIFIED

| Item | Status | How to resolve |
|---|---|---|
| Whether a virtual-provider `streamSimple` that forwards the **real** `Model` object preserves `/session` cost accounting and the recorded assistant-message model id | UNVERIFIED (pi-router mirrors carry `cost:0`; `calculateCost` runs inside the downstream adapter with whatever model it is handed) | Only matters if P-later adopts a virtual provider; test with a two-call session and compare `/session` to the JSONL |
| Whether an extension can practically shadow `/share` by wrapping the editor component | UNVERIFIED — the assignment `newEditor.onSubmit = this.defaultEditor.onSubmit` makes it plausible; depends on private TUI internals | Do not rely on it. Control `gh` auth instead. |
| Whether `pi install https://github.com/user/repo` works with **no** `package.json` at all (pure convention dirs) | MEDIUM — `docs/packages.md:160` says convention discovery applies when no `pi` manifest is present; silent on a wholly absent manifest | Moot: this repo needs `package.json` for peerDeps regardless |
| Whether DeepSeek V4 Flash honours `reasoning_effort` at all through Pi's `openai-completions` adapter | UNVERIFIED — this is exactly what P1 exists to answer | Wire dump on the work laptop; gate all thinking-budget work on the result |
| Whether `unbash` handles Windows Git Bash path forms (`/c/Users/...` vs `C:\`) correctly in argument position | UNVERIFIED | Unit tests in P3 with both path forms; this is a real cross-platform risk for path-scoped policy |
| Exact tokenizer ratios | Estimates use 4 chars/token | Character counts above are exact; token counts are ±20%. Use the provider's reported `usage.input` from the wire log for anything that matters |

---

## Sources

**Primary (verified by reading the published artifact):**
- `@earendil-works/pi-coding-agent@0.84.1` npm tarball — `dist/core/system-prompt.js`, `dist/core/skills.js`, `dist/core/model-registry.d.ts`, `dist/core/model-runtime.d.ts`, `dist/core/sdk.js`, `dist/core/extensions/{types.d.ts,runner.js}`, `dist/core/prompt-templates.js`, `dist/core/tools/*.js`, `dist/modes/interactive/interactive-mode.js`
- Bundled docs: `docs/extensions.md` (2,988 lines), `docs/packages.md`, `docs/skills.md`, `docs/prompt-templates.md`, `docs/settings.md`, `docs/usage.md`, `docs/models.md`, `docs/environment-variables.md`
- Bundled examples: `examples/extensions/{summarize.ts,handoff.ts,subagent/,permission-gate.ts,tools.ts,preset.ts,dynamic-tools.ts,provider-payload.ts}`
- `@earendil-works/pi-ai@0.84.1` — `dist/types.d.ts`, `dist/models.d.ts`, `dist/api/{anthropic-messages,openai-completions,openai-responses}.d.ts`
- Token measurements produced by importing `buildSystemPrompt` and the tool factories from the installed package

**Third-party extensions (source read, not README):**
- `pi-router@0.5.0`, `pi-smart-router@0.16.0`, `pi-model-auto@0.2.2`, `pi-bifrost@0.4.0` — routing mechanisms
- `@ramtinj95/pi-infra-command-guard@0.9.1` (depends on `unbash@4.0.10`) — bash AST guard, approval protocol, tool wrapping
- `cc-safety-net@2.0.3` — path canonicalisation, block-only Pi adapter
- `@firstpick/pi-extension-tools@0.1.8` — runtime `setActiveTools` persistence
- `pi-subagents@0.47.1` — agent frontmatter, model precedence, `agentOverrides`, no auto-reviewer
- `@minhduydev/pi-harness@2.8.1`, `mitsupi@1.6.0`, `lelezonio-pi-kit@0.2.7` — repo layout and bootstrap patterns
- `@preapexis/pi-kit` — **does not exist on npm** (checked 2026-08-13); excluded

---
*Architecture research for: personalised Pi coding-agent harness*
*Researched: 2026-08-13 against Pi 0.84.1*
