# Phase 10: Context Budget & Progressive Disclosure - Research

**Researched:** 2026-10-13
**Domain:** Pi 1.1.0 per-turn token floor, native progressive disclosure (tool activation), prompt-cache discipline, controlled context-pollution experiment design
**Confidence:** HIGH on mechanism and measured numbers (read at source and executed offline), MEDIUM on provider-cache economics for DeepSeek, LOW on the four uninstalled packages (static reading only)

All Pi claims below were verified in `node_modules/@earendil-works/*@1.1.0` (`dist/**/*.js`, `dist/**/*.d.ts`, shipped `docs/`). `CLAUDE.md`'s stack notes are 0.84-era and were not relied on. Numbers marked "measured" came from one scratch vitest harness (outside the repo, `--maxWorkers=1`, about 1 s per invocation, no network, no provider call). Method is in "Code Examples".

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Orchestrator facts (binding)**

1. **Pi is 1.1.0** (`node_modules/@earendil-works/pi-coding-agent/package.json`). The 0.84-era research in CLAUDE.md is stale where it conflicts. **Verify every API claim at source in `node_modules` (`dist/**/*.d.ts`, `dist/**/*.js`, shipped `docs/`), never blogs.**
2. **Pi 1.x ships native progressive disclosure. PREFER it over authoring our own** (project constraint: do not reimplement what the platform ships). Verified at source while writing this file:
   - `ToolDefinition.exposure?: "direct" | "model-only" | "codemode" | "deferred" | "hidden"` (`dist/core/extensions/types.d.ts:395,475`). `deferred` = not declared, findable/activatable by built-in `tool_search`. `hidden` = withdrawn (tools cannot be unregistered).
   - `ToolDefinition.defaultActive?: boolean` (`types.d.ts` ~481) - `false` registers without activating; activated by `--tools`, the `defaultTools` setting, or `setActiveTools()`.
   - `ToolDefinition.namespace`, `prepareLoadout(loadout) -> { descriptions?, hiddenDeclarations? }` (`types.d.ts:411-491`).
   - `defaultTools` setting with `+name`/`-name` entries (`docs/settings.md:40-58`).
   - `docs/extensions.md` "Activate tools dynamically": Pi records the initial tool set in the transcript's first system message and **appends** tool changes before the next request; providers that cannot represent the transition get a full checkpoint that can invalidate the cached prefix. This is the 1.x statement of criterion 1's "only add, never remove".
   - Also available: `provider_stream_event`, `ctx.modelRegistry.stream()` (the chokepoint lint forbids `.stream` outside `diagnostics/` - do not weaken it).
3. **Criterion reinterpretation must be explicit.** Criterion 1 / CTX-01 / CTX-02 are phrased for 0.84 (`setActiveTools` at `session_start`, `context` hook). Research must decide, at source, whether the 1.x mechanism (`defaultActive: false` / `exposure` / `defaultTools`) satisfies them better, and the plans must record each reinterpretation in a "Criterion reinterpretations" table (original wording -> 1.x mechanism -> why equivalent or stronger -> test that proves it). `setActiveTools` stays the activation primitive unless source shows otherwise; the "context hook cannot strip tool definitions" half must be proven by a faux test, not asserted.
4. **Known conflict to resolve, not ignore:** Phase 08.1 disabled `builtin:tool-search` and `builtin:codemode` in `.pi/settings.json`, and the safety hook **denies** `tool_search`/`codemode` calls (`docs/SAFETY.md`, `tests/integration/new-tool-paths.test.ts`) because they were unreviewed. `exposure: "deferred"` is only reachable via `tool_search`. Options: (a) keep tool_search denied and use `defaultActive: false` + additive profile activation via `setActiveTools`, no safety change; (b) review Pi's first-party `dist/extensions/tool-search/` source and re-enable it, updating the deny list, settings test and SAFETY.md in the same change. Default to (a) unless research shows (b) is materially cheaper per turn AND nested calls stay guarded. Record the choice.
5. **Phase 08.2 changed the floor.** Pi in this repo now loads root `AGENTS.md` (1,655 bytes) instead of the 49 KB `CLAUDE.md`; the harness injects comment rules per session. The Phase 2 numbers (12,725 input tokens; ~1,850 Pi-default floor) are stale. **Measure the current floor with `/budget`'s own computation (faux session, offline) BEFORE cutting, record it, then measure AFTER.** Do not assume.
6. **CTX-05 needs live credentials.** Design the minimal-vs-full experiment protocol fully (task set, seeded-defect or graded tasks, arms, N, metric, decision rule, which result discriminates which root-cause candidate), build the harness/script offline and unit-test it with `fauxProvider`, and append runbook entry `RB-10-xx` marked **OUTSTANDING**. No inference requests from this machine. CTX-05 stays partial with the id named inline.
7. **CTX-06 for packages that cannot be loaded offline.** `pi-subagents`, `@narumitw/pi-lsp`, `pi-web-access`, `pi-session-finder` are pinned in `.pi/settings.json` but **not installed** (`RB-07-02` OUTSTANDING). Measure everything measurable offline (authored/vendored extensions in `.pi/extensions/`, Pi built-ins, skills index, prompt templates, AGENTS.md, injected comment rules). For pinned-but-uninstalled packages, a static measurement from the published tarball's tool descriptions/schemas is acceptable only if it executes no package code (read files only, treated as untrusted data); otherwise mark OUTSTANDING with a runbook id. Every recorded number states its method.

**Already decided, binding (from prior phases)**

- **Boundary rule (BOOT-10, CONTRIBUTING.md):** commands cost 0 per-turn tokens, skills ~40-60 tok index. Tool registrations are allowlisted in `tests/unit/contributing-boundary.test.ts` and baselined in `tests/unit/tool-count-baseline.test.ts` - Phase 10 is where that number is cut. Any change to registered/active tools updates both in the same change.
- **Prompt cache (CTX-04):** no volatile content (timestamps, cost, branch, changed files, session ids) in the system prompt or in `promptSnippet`/`promptGuidelines`. Activating a tool that carries `promptSnippet`/`promptGuidelines` rebuilds the system prompt - lazily-activated tools rely on `description` only. Volatile UI content belongs to Phase 11's TUI chrome. Prove with a faux test that captures the system prompt across turns / simulated clocks and asserts byte equality.
- **CTX-03:** CI-enforced token budget on `AGENTS.md` (and the injected comment-rule block). Pick the budget from the measured current size with modest headroom; a raise must be a visible edit with a why. Use the same token estimator as `/budget`.
- **Chokepoint lint** (`tests/unit/chokepoint-lint.test.ts`): no `modelRegistry.complete/.stream/...` outside `.pi/extensions/diagnostics/`, including in comments. Do not weaken.
- **No new npm dependency.** `pinning.test.ts` asserts the exact devDependencies set.
- **Be suspicious of green.** Each new test must fail when its subject is removed.
- **Comments follow root AGENTS.md** (WHY-only, no phase/requirement IDs in code comments).

**CPU budget (hard - user's PC hit 99%)**
- Targeted tests only: `npx vitest run <file> --maxWorkers=2`; `npx tsc --noEmit` once per plan; never concurrent test runs; sequential plan execution. Full suite ONCE at verification. Known flake: `audit-concurrency`. Do not raise budgets to pass tests.

### Claude's Discretion
Profile membership; where profile selection lives (routing mode vs settings vs command); the experiment's task corpus and metric; how per-extension cost is attributed (diff of `/budget` sections with an extension loaded vs not); file layout of any new module (prefer extending `diagnostics/` budget code and `routing/` over new subsystems).

### Deferred Ideas (OUT OF SCOPE)
- Live CTX-05 run and live per-extension numbers for uninstalled packages -> runbook OUTSTANDING.
- TUI placement of volatile info -> Phase 11.
- Out of scope: Phase 11 (TUI chrome - statusline/header/widget), Phase 12 (OpenSpec). Do not touch `.planning/phases/12-openspec-opt-in-skill/`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CTX-01 | Named tool profiles (recon / implement / review / full) are set once at `session_start` and only added to; removal invalidates the cache **[FAUX]** | Section "Native mechanism, verified at source" (semantics, T1/T2 proofs); "Profile design" (allowlist-intersection hook, membership, floors). The "only added to" half is provider-dependent, see Reinterpretation R1. |
| CTX-02 | `pi.setActiveTools()` is the mechanism; `context` hook cannot strip tool definitions and is not used for this **[FAUX]** | `setActiveTools` from `session_start` proven (T1). `context` hook proven unable to strip (T3); a second hook `context_with_system` CAN, so a lint is required (R2). |
| CTX-03 | `AGENTS.md` has a hard token budget enforced in CI | Measured: AGENTS.md 1,653 chars / 414 tok; rendered block 1,851 chars / 463 tok; injected comment rules 792 chars / 198 tok. Budget proposal and estimator in "CTX-03 design". |
| CTX-04 | No volatile content in the system prompt; one volatile token re-prices the whole prefix **[FAUX]** | Full inventory of system-prompt sources (none volatile today; one unconditional section to gate; two third-party risks) and the faux test design in "CTX-04 design". |
| CTX-05 | Controlled minimal-vs-full experiment on whether pollution degrades quality **[RUNBOOK]** | Full protocol in "CTX-05 design": 3 arms, reuse of the Phase 8 seeded-defect corpus and `scoreCalibration`, N, pre-registered decision rule, discrimination matrix for the three root-cause candidates, offline harness plan, `RB-10-01`. |
| CTX-06 | Per-extension per-turn token cost measured and recorded | Measured table for all 18 local entry points and Pi built-ins (additivity check closes exactly at 4,444). Static feasibility for the 4 uninstalled packages in "CTX-06 design". |
</phase_requirements>

## Summary

The measured per-turn floor of the current default session (all 18 local extension entry points, AGENTS.md, three skills, Pi built-ins, faux provider) is **4,444 estimated tokens** (8,567 system-prompt chars + 9,206 tool-declaration chars, `Math.ceil(chars/4)`); by `/budget`'s own formula (`name + description + JSON(parameters)`) it is **4,255**. That is 2.4x the stale "~1,850" figure: the floor has grown since Phase 2 because of Phases 5-9 (bg tools, approval tool, advisor, questionnaire, todo, skills) even though the 49 KB CLAUDE.md is gone. Bare Pi plus today's AGENTS.md is 1,905 (1,800 by the `/budget` formula), which is what the old ~1,850 figure actually described. The contributors close exactly: 1,905 + skills 343 + `pi-background-tasks` 1,590 + safety net 72 + questionnaire 307 + todo 88 + advisor 139 = 4,444. Eleven of the 18 extensions cost exactly 0 tokens per turn. One extension, the vendored background-tasks, is 36% of the floor (761 tok of schema, 700 tok of `promptSnippet`/`promptGuidelines`, 128 tok of an unconditional shell-policy prompt section).

The native 1.x mechanism is sufficient and stronger than the 0.84 phrasing, with two caveats that change the criteria. (1) `setActiveTools()` at `session_start` is clean: it runs before the first request, so the transcript's first system message records the narrowed set and no `toolsRemoved` is ever written (proved, T1). (2) "Only add, never remove" is true only on transports that can express tool additions natively. Of the user's actual providers, DeepSeek (`openai-completions`) and Bedrock (`bedrock-converse-stream`) cannot: Pi collapses the transcript and re-sends the *current* tool list at the head of every request, so ANY mid-session loadout change, add or remove, changes the tools block and re-prices the prefix. Only Anthropic-direct models with `compat.supportsMidConvoToolChanges` anchor additions, and a single removal anywhere in history permanently disables that anchoring for the branch. The real invariant is therefore "decide the loadout before the first request; mid-session changes are rare, user-initiated and priced." The `context` hook still cannot strip tools (Pi restores them), but a sibling hook `context_with_system` can; CTX-02 needs a lint for it.

`tool_search` (option b) is not cheaper: it costs about 173 tok/turn itself, requires `exposure: "deferred"` on every tool it would serve (including vendored code), and each model-driven load is a prefix re-price on DeepSeek/Bedrock. **Choose option (a)**: allowlist profiles applied once at `session_start` by intersecting with the current active set, no safety change.

**Primary recommendation:** Add an allowlist-based profile table in `routing/` applied at `session_start` (intersection with the live active set, selected by a `--ky-profile` flag, default `implement`), gate the background-tasks shell-policy section on `bg_run` being selected, extend `/budget` and a composed-harness faux helper so every profile has a CI-enforced floor ceiling, add the byte-equality and `context_with_system` lints, and ship the CTX-05 offline harness plus `RB-10-01` OUTSTANDING.

## Measured current floor (BEFORE any cut)

Method (reproducible, offline): a scratch vitest file created a `createAgentSession` with `fauxProvider`, `ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })`, `SessionManager.inMemory`, one user-scope inline extension that imports and awaits every local entry point, the real `AGENTS.md` copied into a temp cwd, and `resources_discover` returning the repo `.pi/skills`. `session.bindExtensions({})` fired `session_start`, one `session.prompt("hi")` captured the outgoing `TranscriptContext`; system prompt = `getCurrentSystemMessage(...).sections` joined with `\n\n` (identical to `getSystemMessageText`, `pi-ai dist/utils/text.js:11-17`); tools = `getCurrentTools(...)` serialised with `toToolDeclaration` (`pi-ai dist/utils/transcript.js:109-117`). Estimator is `Math.ceil(chars / 4)`, same as `/budget` (`diagnostics/budget.ts:119-121`). `[VERIFIED: executed 2026-10-13, node 24.16.0, pi 1.1.0]`

| Configuration | System chars (tok) | Tool decl chars (tok) | Floor tok (wire est) | Floor tok (`/budget` formula) |
|---------------|-------------------|-----------------------|----------------------|-------------------------------|
| A. Bare Pi, 4 built-ins, no AGENTS.md | 2,802 (701) | 2,964 (741) | **1,442** | 1,337 |
| B. A + root AGENTS.md | 4,655 (1,164) | 2,964 (741) | **1,905** | 1,800 |
| C. Full harness default (18 entry points + AGENTS.md + 3 skills) | 8,567 (2,142) | 9,206 (2,302) | **4,444** | 4,255 |

Section sizes in C (chars): preamble 169, tools 545, rules 2,660, docs 1,385, project_context 1,851, skills 1,371, cwd 62, `pi_background_shell_policy` 510. 12 tools declared, 17 registered. `qoder_delegate` is registered but inactive (its `session_start` filter fires on an unconfigured machine); `powershell`, `grep`, `find`, `ls` are registered inactive by Pi.

`/budget` undercounts the wire by about 4% because its tool formula omits the JSON keys; the 1.x `toToolDeclaration` JSON is closer, and the OpenAI-shaped request adds roughly 31 more chars per tool (`{"type":"function","function":...}`). Keep `/budget`'s formula as the recorded unit for continuity, state both in the record, and never mix them in one comparison.

### Per-extension attribution (CTX-06, local code) - each extension loaded alone vs bare Pi, then closed against C

| Source | Tools it adds (decl tok) | System-prompt chars it changes | Per-turn cost (tok) | Verdict |
|--------|-------------------------|--------------------------------|---------------------|---------|
| Pi built-ins (4 default tools) | read 179, bash 144, edit 303, write 116 | base prompt 2,802 incl. `docs` 1,385 | 1,442 | platform floor |
| AGENTS.md (project context) | - | +1,851 | +463 | CTX-03 budgeted |
| 3 skills index (grill, plan-ceremony, review) | - | +1,371 | +343 | keep; shorten descriptions (location path is in the index) |
| `background-tasks` (vendored) | bg_run 456, bg_status 89, bg_logs 147, bg_kill 70 = 762 | tools +375, rules +2,430, shell policy +510 = +3,315 | **1,590** | profile-gate; biggest single lever |
| `safety` | approve_ky_command 267 | -778 (wrapped built-ins carry no `promptSnippet`/`promptGuidelines`, so their lines vanish from `tools`/`rules`) | **+72 net** | keep in every profile |
| `questionnaire` (vendored) | 307 | 0 | 307 | `implement`: out; `full`: in |
| `todo` (vendored) | 88 | 0 | 88 | `implement`: in |
| `quality` (consult_advisor) | 139 | 0 | 139 | `implement`/`review`: in |
| `qoder` | qoder_delegate (~329 when configured; 0 now) | 0 | 0 now | `full` only |
| `harness` (comment rules) | - | +792 only when no context file carries the heading; 0 here | 0 here, +198 elsewhere | keep; budgeted |
| checkpoint, diagnostics, execute, grill, loop-police, plan-ceremony, plan-mode, providers, review, routing, workflows | none | 0 | **0 (measured)** | keep, no cost |

Additivity check: 1,905 + 343 + 1,590 + 72 + 307 + 88 + 139 = **4,444**. The attribution is exact, so a plan can claim a reduction per extension and the sum is verifiable.

Context for the verdicts: the Phase 2 12,725-token and ~1,850 figures are both stale (`02-RESEARCH.md` line 631: the 1,850 "is not wrong about Pi's defaults; it simply did not count this project's own context file"). B (1,905) is the like-for-like successor of that figure.

### Projected floors by profile (measured with a `session_start` allowlist hook appended to the composed session)

| Profile | Active tools | Floor (wire est) | `/budget` formula | With shell-policy section gated |
|---------|--------------|------------------|-------------------|---------------------------------|
| full (today's behaviour, no hook) | 12 | 4,444 | 4,255 | 4,444 (bg_run selected) |
| implement | read, bash, edit, write, approve_ky_command, todo, consult_advisor | 2,675 | 2,539 | **2,547 / 2,411** |
| review | read, bash, approve_ky_command, consult_advisor | 2,169 | 2,095 | **2,041 / 1,967** |
| recon | read, bash, approve_ky_command | 2,031 | 1,968 | **1,903 / 1,840** |
| minimal probe | read, bash | 1,764 | 1,711 | 1,636 / 1,583 |

The default profile removes 1,897 tok (-43%) from today's floor. The literal "below ~1,850" is only reached by `recon` under `/budget`'s formula (1,840), a 10-token margin, so it must be stated as a reinterpretation (R4), not a headline. Further, honest levers not yet taken: shorten the three skill descriptions (about 60 tok), and the Pi `docs` section (346 tok, "read only when the user asks about pi itself") is only removable by replacing the whole default prompt via `customPrompt`/SYSTEM.md, which also drops the `tools` and `rules` sections and with them every `promptSnippet`/`promptGuidelines`. That is a behaviour change for a cheap model and belongs in the CTX-05 experiment as an optional arm, not in the default.

## Native mechanism, verified at source

Semantics (pi 1.1.0), each with the citation to re-check:

- **Registration and activation.** A tool is auto-activated on registration iff `exposure` is `direct` or `model-only` and `defaultActive !== false` (`agent-session.js:2893-2899`, `_isDeclarable` / `_isActivatedOnRegistration`). `defaultActive: false` tools stay registered, absent from `tools[]` and from the `tools`/`rules` prompt sections (proved, T5). Allowlists (`--tools`, `createAgentSession({tools})`) activate named tools even if `defaultActive:false` (`agent-session.js:2873-2880`) and, importantly, FILTER registration of everything not named (`_isAllowedTool`, `:1109-1117`): the existing faux helper passes `tools: []` by default and therefore registers no extension tools at all.
- **`setActiveTools`.** Replace semantics, not add: `setActiveToolsByName` -> `_setActiveTools` -> `_applyToolLoadout` -> `_rebuildSystemPrompt` (`agent-session.js:1099-1115`, `:1148-1195`). Unknown and `hidden` names are ignored. A deactivating call clears pending restored tools (`:1101-1105`).
- **Order inside a prompt.** `before_agent_start` handlers run first; if none edited `selectedTools`, the live `getActiveToolNames()` is authoritative (`agent-session.js:1590-1598`); then `_preparePromptAndToolLoadout` diffs the structured prompt sections against the transcript and the agent loop's `declareToolChanges` diffs the executable tool set against the committed transcript (`pi-agent-core agent-loop.js:213-245`, `pi-ai transcript.js:122-141`). Whatever is active when the first request is built becomes the initial `toolsAdded`; there is no delta to record, so no `toolsRemoved`.
- **`session_start` ordering.** `session.bindExtensions()` emits `session_start` (`agent-session.js:2598-2615`). In a headless faux session it does NOT fire from `createAgentSession`; a test must call `bindExtensions({})` or `extensionRunner.emit({type:"session_start",reason:"startup"})` (the pattern in `tests/integration/qoder-tool.test.ts:190-220`). Handlers run in extension load order (directory name order for `.pi/extensions/*`); `plan-mode` and `qoder` sort before `routing` and `safety`.
- **Transport behaviour (the cache fact).** `resolveTranscriptTools` anchors additions only when the transport supports them AND no removal or same-name redeclaration exists anywhere in history; otherwise it sends the current tool list (`pi-ai transcript.js:196-208`). `anthropic-messages.js:869-870` needs `supportsMidConvoSystemMessages && supportsMidConvoToolChanges`; `openai-completions.js:567,898` needs `supportsMidConvoSystemMessages && supportsMidConvoToolAdditions`, both default `false` (`:1294-1295`); `bedrock-converse-stream.js:26,154` always collapses and sends `getCurrentTools`. In the shipped catalogues only `anthropic.json` sets `supportsMidConvoToolChanges` (7 models); `deepseek.json` sets `supportsMidConvoSystemMessages` once and never `supportsMidConvoToolAdditions`; `amazon-bedrock.json` sets none. So for DeepSeek and Bedrock every loadout change re-sends a different tools block. That DeepSeek's server cache keys on a prefix that includes the tools block is `[ASSUMED]` (A1) and is what RB-10-02 should confirm with the turn log's `cacheRead`.
- **`context` hook cannot strip tools.** Its event carries messages without system messages and Pi restores prompt and tool state after the handler returns (`types.d.ts:660-665`; `runner.js:1006-1021` filters `role !== "system"` before and `restoreSystemMessages` after). Proved by faux test T3 (handler that rewrote `toolsAdded`/`toolsRemoved` on every message: provider still received all 8 tools). **However** `context_with_system` (`types.d.ts:670-680`, `runner.js:1035-1060`) hands over the full transcript "and the handler owns the prompt and tool declarations"; proved T3b: it removes tools from the provider request. No extension in `.pi/extensions` uses it today (grep: only two `context` handlers, `loop-police.ts:641` and `plan-mode/index.ts:333`, both message rewrites).
- **Plan mode is a deliberate mid-session excursion.** `plan-mode/index.ts:130-188,251-258`: entering `/plan` removes `edit`/`write` and ADDS `grep`, `find`, `ls`, `questionnaire`; leaving restores the snapshot. On DeepSeek/Bedrock each toggle re-prices the prefix. Document it as the one sanctioned user-initiated change, and exempt it explicitly in the "no removal after session_start" test.

### Criterion reinterpretations (the table CONTEXT fact 3 requires)

| # | Original wording | 1.x mechanism | Why equivalent or stronger | Proving test |
|---|------------------|---------------|-----------------------------|--------------|
| R1 | "profiles set once at `session_start` via `pi.setActiveTools()` and only ever added to - tool *removal* invalidates the prompt cache" | `setActiveTools` once at `session_start` (before the first request) as an allowlist intersection; profile code never runs again. Mid-session changes are user commands only. | Stronger on the part that matters: pre-first-request narrowing writes no `toolsRemoved`, so there is nothing to invalidate. Weaker as stated: on DeepSeek and Bedrock additions ALSO re-price the prefix (transport collapses to the current list), so "only added to" is not a cache guarantee there. The enforced rule is "no profile-driven change after the first request" | Faux T1: after `session_start` narrowing, requests 1 and 2 carry exactly one system message, tools = narrowed set, `hasNonAdditiveToolChanges` false. Faux T2: a mid-session removal produces a second system message with `removed` and `hasNonAdditiveToolChanges` true, and `resolveTranscriptTools(messages, true).anchorsAdditions` false even after a later pure addition |
| R2 | "the `context` hook cannot strip tool definitions at all" | `context` cannot (Pi restores state); `context_with_system` can | Same safety property, made enforceable: a grep lint forbids `context_with_system` handlers in `.pi/extensions` | Faux T3 (provider still sees all tools) + T3b (negative control: the other hook does strip) + tracked-source lint with a self-test that a fixture handler is flagged |
| R3 | "named profiles ... via `pi.setActiveTools()`" (mechanism) | `setActiveTools` stays the activation primitive; `defaultActive:false` is used only for authored tools that no profile but `full` includes; `exposure:"deferred"` is not used | `defaultActive:false` is fail-safe if the hook throws, but patching vendored code costs a PROVENANCE deviation per tool; the hook needs no vendored patch. `deferred` needs `tool_search` (decision below) | T5 proves `defaultActive:false` semantics; completeness test below proves every registered tool is classified |
| R4 | "`/budget` shows the per-turn floor measurably below the ~1,850-token baseline" | Baseline is re-measured: today's default floor is 4,444 (4,255 by `/budget`); B (1,905) is the like-for-like successor of the 1,850 figure. Target: default profile `implement` at or below ~2,550 (-43%); `recon` at or below ~1,850 by `/budget` formula | "Measurably below" is satisfied against the true baseline; the literal 1,850 is met only by `recon` (10-token margin) and must not be advertised for the default | Composed-harness floor ceilings per profile, computed with `computeBudget` over the real captured prompt and tools |
| R5 | "each installed extension's per-turn token cost is a recorded number that either justifies keeping it or removes it" | Table above (local, exact) + static or OUTSTANDING (packages) | Exact additivity (closes at 4,444) | A test that recomputes the sum of per-extension deltas and fails if it drifts from the composed floor by more than a stated tolerance |
| R6 | "no volatile content ... in the system prompt" | Plus: no mid-run section patches (a `sections` patch on turn 2 is a second system message) | Byte equality is necessary but not sufficient; a patch also breaks the head on collapsed transports | Faux T4 (moved clock, 3 turns): outgoing context has exactly one system message, prompts equal; negative control with a clock-in-section extension fails |

## Standard Stack

No new dependency. Everything below is already installed and pinned (`pinning.test.ts` asserts the set).

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@earendil-works/pi-coding-agent` | 1.1.0 | Host, `createAgentSession`, `ModelRuntime`, `SettingsManager`, `formatSkillsForPrompt` | The platform being extended `[VERIFIED: node_modules package.json]` |
| `@earendil-works/pi-ai` | 1.1.0 | `fauxProvider`, `getCurrentTools`, `getCurrentSystemMessage`, `getCurrentSystemPrompt`, `toToolDeclaration`, `hasNonAdditiveToolChanges`, `resolveTranscriptTools` | All exported from the package index; used in the scratch measurements `[VERIFIED: executed]` |
| `vitest` | 4.1.11 (installed; CLAUDE.md's 4.1.9 is stale) | Test runner | Repo convention `[VERIFIED: package.json]` |
| `typebox` | 1.3.27 (installed pin) | Tool schemas | Repo convention |

### Supporting (already in repo, reuse)
| Asset | Purpose | When to Use |
|-------|---------|-------------|
| `.pi/extensions/diagnostics/budget.ts` (`computeBudget`, `estimateTokensFromChars`, `sliceSystemPrompt`) | The one estimator and decomposition | Extend, do not fork: add a `floor` line and a per-profile summary |
| `tests/helpers/session.ts` (`createFauxSession`, `withFauxSession`) | Faux session | Needs a new option to leave `tools` unset (currently `opts.tools ?? []` registers no extension tools) |
| `tests/helpers/faux.ts` (`transcriptView`) | Reads outgoing system prompt and tools from a `TranscriptContext` | Every prompt-stability assertion |
| `.pi/extensions/quality/calibration.ts` (`scoreCalibration`) and `tests/fixtures/seeded-defects/index.ts` (`SEEDED_DEFECTS`) | Pure grader and six-defect corpus | CTX-05 trial scoring |
| `.pi/extensions/diagnostics/prose.ts` (`isProseToolCall`) | Prose-tool-call predicate | CTX-05 root-cause discrimination |
| `tests/unit/extension-layout.test.ts` (`isEntryPoint`), `tests/helpers/git.ts` (`trackedFiles`) | Enumerate entry points | Derive the composed-extension list instead of hard-coding it |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `setActiveTools` allowlist hook | `defaultTools` in `.pi/settings.json` / `--tools` CLI | Static, no named profiles, and project settings are ignored for an untrusted project (`docs/SAFETY.md:192`). Keep as an escape hatch the user can type: `pi --tools read,bash` already works natively |
| Allowlist hook | `tool_search` + `exposure:"deferred"` | See decision below: costs more per turn on these providers |
| Allowlist hook | `defaultActive:false` on every tool | Fail-safe but needs vendored patches per tool; use only on authored tools |

**Installation:** none.

**Version verification:** versions read from `node_modules/*/package.json` on 2026-10-13, not from the registry (no install).

## Package Legitimacy Audit

No external package is added or installed by this phase. For CTX-06 the four already-pinned packages (`@narumitw/pi-lsp@0.49.9`, `pi-session-finder@0.5.6`, `pi-subagents@0.76.1`, `pi-web-access@0.38.0`) were fetched once with `npm pack <spec> --ignore-scripts` into a scratch directory and read as text. Nothing was installed, imported or executed. slopcheck was not run because no package is being recommended for install; the pins predate this phase and carry their own gate (`RB-07-02`).

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none (not applicable; no new package)

## `tool_search` decision: option (a), keep it off

Source: `dist/extensions/tool-search/tool.js` (188 lines, zero dependencies, first-party) and `index.js` (14 lines).

- It registers `{...createToolSearchToolDefinition({tools: pi}), defaultActive:false}` (`index.js:11`), `exposure:"model-only"` (`tool.js`). Its `execute` ranks (BM25) tools with exposure `codemode` or `deferred` that are not active and calls `tools.setActiveTools([...active, ...matches])` (`tool.js` `searchAndLoad`). It never executes the matched tool; the loaded tool is later called through the normal path, so the `tool_call` hook still guards it. Nested-call risk is therefore small and (b) is technically reviewable in under an hour.
- **Cost, measured:** its own declaration is 615 JSON chars plus a 61-char `promptSnippet`, about **173 tok every turn** while active.
- **It only serves tools whose `exposure` is `codemode` or `deferred`.** Every candidate here is either vendored (bg_*, questionnaire, todo: a PROVENANCE deviation per tool) or authored. Third-party tools cannot be re-exposed from outside.
- **Each model-driven load changes the tools block**, which on DeepSeek and Bedrock is a full prefix re-price (see transport facts). A profile chosen up front pays that cost zero times.
- (a) needs no change to `.pi/settings.json`, `docs/SAFETY.md`, the deny list in `safety/index.ts:340-348`, or `tests/integration/new-tool-paths.test.ts`.

Decision: **(a)**. Record it in `docs/EXTENSIONS.md` next to the "Pi 1.x capabilities not adopted" notes, with the 173-token figure. Revisit only if a use case appears where the model must discover tools it cannot predict (for example many MCP tools); MCP is disabled in this repo.

## Profile design

**Where it lives.** `routing/profiles.ts` (pure table plus a `resolveProfile` and an `applyProfile(activeNames, profile)` function; named exports only, because a default export reclassifies a file as an extension entry point) and a `session_start` handler in `routing/index.ts`. Selection: `pi.registerFlag("ky-profile", {...})` read with `pi.getFlag` at `session_start` (`types.d.ts:1214,1224`; `plan-mode` already registers a flag, so the pattern is exercised), default `implement`. `/mode`'s cheap/balanced/max are MODEL tiers; do not overload them. A `/profile <name>` command is optional and must say it re-prices the cache on DeepSeek/Bedrock; it must be additive-only and refuse a narrowing (narrowing means `/new`). Raising `routing`'s directory ratchet in `tests/unit/workflow-budgets.test.ts` (currently 1,020 against 1,019 measured) is part of the same change, with a `why`.

**Mechanism: allowlist intersection with the live active set**, not "replace with a list". Reasons verified above: `setActiveTools` replaces; `plan-mode` (resume path calls `enablePlanModeTools()` in its own `session_start`, line ~496) and `qoder` both mutate the active set in their own `session_start` handlers and sort BEFORE `routing`. Intersecting with `getActiveTools()` makes narrowing order-independent, can never add a tool the earlier handlers removed (qoder unconfigured stays out), and preserves relative order, which matters because tool order sets the `tools` section line order and the wire order (a reordered list is a different prefix across sessions).

**Completeness guard.** A table keyed by tool name per profile, plus a test that enumerates `session.getAllTools()` in the composed faux session and fails if any registered name is absent from the table. Reason: `extractRegisteredToolNames` in `tool-count-baseline.test.ts` cannot see names of the safety-wrapped tools (they spread `createBashTool()` with no literal `name:`), so runtime enumeration is the only complete source. This is the CTX-01 anti-regression: a new tool must be classified or the build fails.

**Membership (proposal; costs from the table above, decl tok):**

| Tool | tok | recon | review | implement | full |
|------|-----|-------|--------|-----------|------|
| read | 179 | yes | yes | yes | yes |
| bash (safety-wrapped) | 144 | yes | yes | yes | yes |
| approve_ky_command | 267 | yes | yes | yes | yes |
| edit | 303 | no | no | yes | yes |
| write | 116 | no | no | yes | yes |
| todo | 88 | no | no | yes | yes |
| consult_advisor | 139 | no | yes | yes | yes |
| questionnaire | 307 | no | no | no | yes |
| bg_run / status / logs / kill | 762 + 829 prompt metadata | no | no | no | yes |
| qoder_delegate | ~329 | no | no | no | yes (still gated on configuration) |
| grep / find / ls | n/a | no | no | no | not default (`full` = today's behaviour) |
| third-party loaders (`subagents_enable`, `web_enable`), `lsp_*`, `subagent*` | unmeasured | by name, see Pitfall 6 | | | |

`approve_ky_command` stays everywhere: the model itself must call it to resume a blocked command (`contributing-boundary.test.ts` allowlist rationale (a)), so excluding it turns every confirm-tier block into a dead end. `questionnaire` is out of `implement` but plan mode adds it back for the `/plan` excursion. `full` applies no hook at all, which preserves today's behaviour and `qoder`'s own gate exactly. This matches the executor/planner/reviewer subagent frontmatter (`.pi/agents/*.md`: planner and reviewer are `read, grep, find, ls`; executor-handoff adds `write, edit, bash`), so profile names correspond to roles already defined.

**Gate the shell-policy section.** `background-tasks/src/core/shell-policy.ts:167-176` registers a `before_agent_start` handler that writes `sections.pi_background_shell_policy` unconditionally, so a session with `bg_*` inactive still pays 510 chars (128 tok) for guidance about tools it does not have (measured: present in every profile row without the gate). The event carries `systemPromptOptions.selectedTools`; the minimal, robust fix is a documented local patch in the vendored handler (PROVENANCE deviation) that returns early and leaves the section unset unless `selectedTools` includes `bg_run`. A handler in `routing` that deletes the section would depend on load order (background-tasks sorts first, so it would work, but silently) and is the weaker choice.

**Test to write (proves non-vacuity):** composed faux session per profile; assert declared tool names equal the profile (plus qoder gate), assert `computeBudget(...)` floor <= the profile ceiling, and a mutation check: delete one tool from `full` membership in a fixture table and watch the completeness test fail. Resume-in-plan-mode case: restore a plan-mode entry, assert the plan-mode tool set survives profile narrowing (see Pitfall 5).

## CTX-04 design: system-prompt content inventory and the stability test

Every source of system-prompt text in the current default session (verified by grep over `.pi/` and by the captured sections):

| Source | Section(s) | Volatile? | Notes |
|--------|-----------|-----------|-------|
| Pi default prompt | `preamble`, `tools`, `rules`, `docs`, `cwd` | No clock, no cost, no branch. `docs` embeds absolute Pi install paths (machine-stable). `cwd` is stable per session | `pi 1.1.0 dist/core/system-prompt.js:41-98` |
| AGENTS.md | `project_context` | Static file; changes only on `/reload` | `agent-session.js:_rebuildSystemPrompt` |
| `harness/index.ts:23` | `code_comments` | Constant text; skipped when a context file has the heading | already tested in `comment-rules-delivery.test.ts` |
| Skills | `skills` | Static | |
| `background-tasks` shell policy | `pi_background_shell_policy` | Resolved once at activation from platform, env and `process.cwd()`; stable within a process, varies across machines | gate on `bg_run` (above) |
| `promptSnippet`/`promptGuidelines` | `tools`, `rules` | Only on bg_* in the local code (4 tools, 15+ guideline bullets); all static strings | no template interpolation found; add a lint |
| `grill` / `plan-ceremony` / `plan-mode` `before_agent_start` | none: they return a `message`, which becomes a custom message in HISTORY, not the prefix | History is append-only, so a stable prefix is untouched | clarify in docs so nobody "fixes" it |
| Third party `pi-subagents` | `advertised_subagents` section, set "on every turn it applies" (`src/extension/index.js` near 690-700) | Depends on the capability ceiling and the advertised agent list; if it varies between turns the head changes | NOT testable offline, RB-10-03 |
| Third party `pi-subagents` tool activation | calls `setActiveTools` at `session_start`, and re-adds `subagents_enable` in its own `before_agent_start` every prompt when the loader is "selected" (`tool-activation.js:100-118`); in `auto` mode it goes eager on an empty session whenever the model has no native tool additions (`:63-72`), which is DeepSeek | The full `subagent` schema would be declared from turn 1 on DeepSeek | RB-10-03 |

Test design (all [FAUX], one composed session, three prompts, `Date.now` advanced a week between prompts; proven in scratch T4 on a bg-only composition, prompt equal at 6,119 chars):

1. Capture each outgoing `TranscriptContext`; assert `transcriptView(ctx).systemPrompt` is byte-equal across turns, and `ctx.messages.filter(role==="system").length === 1` on every request (no section patch, no tool delta).
2. Wire-level: also assert `getCurrentTools` names and order are identical across turns.
3. **Negative control** inside the same file: a second inline extension that writes `sections.volatile = String(Date.now())` in `before_agent_start` must make assertion 1 fail. Without it the test is green over an empty claim.
4. Source lint (tracked `.ts` under `.pi/extensions/`, excluding `background-tasks/` vendored internals that are checked by PROVENANCE): `promptSnippet`/`promptGuidelines` values must not contain `${`, `Date`, `new Date`, `process.cwd`, `git`. Self-test the regex on an inline offending fixture, per the chokepoint-lint convention.
5. Lint: no `context_with_system` anywhere (R2).

Two further facts for the planner: the faux provider never calls `onPayload`, so `before_provider_request` never fires in a plain faux session (documented in `tests/helpers/faux.ts` header); use `ctx.messages` captured in a response factory, as the existing `comment-rules-delivery.test.ts` does. And `cwd` appears in the prompt, so the test must run from a fixed temp cwd, never assert the path.

## CTX-03 design: AGENTS.md and comment-rule budgets

Measured: `AGENTS.md` 1,653 chars (1,655 bytes; the em dash is multi-byte), **414 tok**, no CR, root only; the rendered `project_context` block is 1,851 chars (**463 tok**) because Pi adds the header sentence, the `<project_instructions path="...">` wrapper and the absolute path (`system-prompt.js:25-30`); `COMMENT_RULES_TEXT` 759 chars (**190 tok**), injected as a `code_comments` section of 792 chars (**198 tok**) only when no context file has the heading. Pi loads only the FIRST existing candidate per directory (`resource-loader.js:115-135`, order `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`), so the 49 KB `CLAUDE.md` in this repo does not reach Pi.

Proposal (planner may adjust, but a raise must be a visible edit with a why):

- `AGENTS.md` content budget **450 tok** (`estimateTokensFromChars(content)` after CRLF normalisation), current 414, headroom 8.7%.
- Rendered block budget **500 tok** (path-inclusive, same formula `computeBudget` uses per file, `PROJECT_INSTRUCTIONS_WRAPPER_CHARS`), current 463.
- Injected `code_comments` block **210 tok**, current 198.
- Use the exported `estimateTokensFromChars` from `diagnostics/budget.ts`; the parity test between `AGENTS.md` and `COMMENT_RULES_TEXT` already exists (`comment-rules-delivery.test.ts`), so a budget raise on one side is visible on both.
- Mutation check: write a fixture over-budget AGENTS.md in a temp dir and assert the same checker function fails on it, so the CI test cannot pass vacuously.
- Out of reach of CI: the user's other repos' context files and ancestor/global `AGENTS.md`; `/budget` reports them at runtime.

## CTX-05 design: the minimal-vs-full experiment

**Question.** Does the always-present harness context (system prompt, tool schemas, skills, project context) degrade a cheap model's output quality, separately from the other two root-cause candidates? ROADMAP says no study sets a token threshold; the design must therefore report an effect size with an interval, not a threshold.

**Task corpus (reuse, do not invent).** The six Phase 8 seeded defects (`SEEDED_DEFECTS`): real, dated failure shapes from this project, each built into an isolated temp repo by `build(repo)`, each with `expected {locationFile, mustMentionAny, minimumSeverity}`. Grader: `scoreCalibration(expected, findings)` (pure, already cross-contamination-hardened). Task prompt: the reviewer contract input from `buildReviewerContext` plus the `REVIEWER_SYSTEM_PROMPT` text, delivered as the USER message in every arm so the arms differ only in harness context, not in instructions. The task needs no tool call (the diff and files are inline), so no arm can win by using tools the other lacks.

**Arms (same model, same provider route, same thinking level; temperature untouched).**

| Arm | Invocation (live, work laptop) | Purpose |
|-----|-------------------------------|---------|
| A minimal | `pi -ne -ns -nc -np --tools read,bash,edit,write --mode json -p "<task>"` from the temp repo | Bare Pi, about 1,442 floor |
| B full | the harness as installed (`pi -a --mode json -p "<task>"` in a directory that loads it; default profile `implement` AND a second run with `--ky-profile full`) | About 2,547 / 4,444 floor |
| C padded-minimal | A plus `--append-system-prompt <file>` whose text is the concatenated real harness prose (tool descriptions, bg guidelines, skills index, AGENTS.md) at the same token count as B's delta, inert (no tools, no hooks) | Separates token mass from harness BEHAVIOUR |

Flags verified in `docs/cli.md:120-125,190-232`. Optional arm D, only if budget allows: arm A on a strong model (Bedrock Claude) as the ceiling the user's premise cites.

**Design.** Paired by (defect, repeat): each arm runs each defect R times. Run order is a seeded shuffle, interleaved across arms to cancel provider drift. N: 6 defects x R=10 = 60 trials per arm (first stage); extend to R=20 (120 per arm) only if the first stage is inconclusive. Detectable effect at 80% power, one-sided alpha 0.05, baseline catch rate near 0.5: about 23 points at 60/arm, about 16 at 120/arm (normal approximation; `[ASSUMED]` that trials are independent, which is optimistic because the six defects are clusters). The protocol must therefore say plainly: it can only detect LARGE effects. Smaller pollution effects are out of reach at this cost, and an "inconclusive" result is a legitimate recorded answer.

**Metric.** Primary: per-trial binary "caught the seeded defect" from `scoreCalibration`, aggregated per arm and per defect. Secondary, all computed offline from the `--mode json` event stream so the minimal arm (which has no diagnostics extension) is measurable: (i) `unmatchedFindings` (noise), (ii) prose-tool-call flag per assistant message via `isProseToolCall(message, activeToolNames)`, (iii) input tokens and cache read from provider usage in the stream, (iv) stop reason.

**Decision rule (pre-registered, written into the module as constants).** Let d = catch(B) - catch(A), with an exact two-sided 90% interval.
- DEGRADES if d <= -15 points and the upper bound < 0.
- NO DETECTABLE EFFECT if the whole interval lies above -15 points.
- INCONCLUSIVE otherwise; escalate to R=20, then stop.

**Root-cause discrimination (what each outcome means).**

| Observation | Candidate it supports | Next step |
|-------------|----------------------|-----------|
| B < A and C ~ A | Harness BEHAVIOUR (hooks, wrapped tools, safety blocks), not token mass. Note: with safety loaded, the built-in tools lose their prompt lines, so B's prompt differs structurally from A's beyond size | inspect blocked calls in the audit log, compare prompts |
| B < A and C < A (similar) | Context POLLUTION by size or content | profiles/shorter descriptions are the fix; re-run with the `implement` floor as arm B |
| B ~ A ~ C and catch rate low in all | Neither pollution nor harness; look at prose tool calls and the provider path | next two rows |
| Prose-tool-call rate >= ~10% of assistant messages in any arm and low-catch trials concentrate in them | Prose tool calls (the ~11% candidate) | evaluate the retry lever (`PROSE_RETRY_FORCES_TOOL_CHOICE`, still `false`, deferred to "a baseline rate"; this experiment produces that baseline) |
| Same arm A on two routes (DeepSeek direct vs DashScope) differs by >= the detectable effect, or the wire record (Phase 2 inspector) shows a thinking/effort field differing between arms | Provider misconfiguration | RB-08-01 style payload read; fix per-provider config |

**Offline harness (built and unit-tested here, no inference).** `diagnostics/ctx-experiment.ts` (pure, named exports): `ARMS` and `armArgs(arm)`; `buildRunPlan(seed, defects, repeats)` (seeded, balanced, interleaved); `scoreTrial(finalText)` that parses the findings JSON and calls `scoreCalibration`; `summarise(trials)`; `decide(summary)`; `padFileText(tokens)` producing the inert filler from real harness strings. A thin POSIX `sh` launcher (repo convention is sh for scripts) loops the plan, runs `pi` per trial in a scrubbed environment, and appends JSONL; the aggregator is invoked as `node scripts/...ts` (Node 24 here strips types natively and `engines` is >=22.19; verified executing a `.ts` file). Tests: plan balance and determinism; `decide` boundary table; `scoreTrial` against a scripted `fauxProvider` that returns a caught, a missed and a malformed answer; a blind responder scoring 0 and a shotgun scoring 0 (reusing the Phase 8 controls); a check that arm argument lists differ ONLY in the intended flags; a negative control that a doubled padding changes `padFileText` length. Place the module in `diagnostics/` (chokepoint-safe: it may call nothing but pure code) and keep model calls out; `workflow-budgets` ratchets apply to any directory that registers a command, and `diagnostics` already has an entry to raise.

**Safety of the live run.** The minimal arm has no safety layer and bash. The work laptop holds live AWS SSO credentials. Run every trial in a disposable temp repo with a scrubbed environment (only the provider key and PATH; no `AWS_*`, no `HOME` pointing at real config: set `PI_CODING_AGENT_DIR` to a temp dir holding only auth), and keep the task review-only. Record this in the runbook entry.

**Runbook `RB-10-01` (OUTSTANDING)**, following the Phase 9 entry shape (summary-table row, `### RB-10-01 - ...` heading, `**Status:** OUTSTANDING`, "Why this cannot be done here", "Procedure, on the work laptop", "Expected output", "Offline proxy"). `tests/unit/docs-policy.test.ts` needs: `PHASE_TEN_IDS` appended to `ALL_IDS` (`:169-183`), a command-pin row in the per-id command map (`:516-533`, strings that must appear in the runbook), and the table/Status agreement. Suggested ids: `RB-10-01` CTX-05 live experiment; `RB-10-02` CTX-04/CTX-06 live check that cache reads are high on turn 2 and the system prompt is byte-equal across two real turns with the four packages installed; `RB-10-03` CTX-06 per-package `/budget` numbers after `RB-07-02` (also checks `pi-subagents` eager-mode and `advertised_subagents` stability). CTX-05 stays partial and says `RB-10-01` inline.

## CTX-06 design: the four uninstalled packages

Feasibility, from reading the tarballs (`npm pack --ignore-scripts`, files read as text, nothing executed):

| Package | Static measurement feasible? | Finding |
|---------|-----------------------------|---------|
| `@narumitw/pi-lsp@0.49.9` | Partly | Two tools, literal `description`/`promptSnippet`/`promptGuidelines` strings in `src/pi-lsp.ts:35-175`: descriptions 147 chars, snippets 113, guidelines 517, plus param descriptions. Typebox schema JSON cannot be computed without evaluating `Type.*`. Estimate about 500-650 tok (`[ASSUMED]` order of magnitude; schemas approximated) |
| `pi-session-finder@0.5.6` | Yes, trivially | Zero `registerTool` sites (already recorded); cost 0 per turn |
| `pi-subagents@0.76.1` | No | Tool descriptions and prompt metadata are built by functions at runtime (`buildSubagentToolDescription(config)`, `buildSubagentToolPromptMetadata`, `createSubagentParamsSchema`), the loader strings are static, and `auto` mode decides eager vs loader from the model at `session_start`. Static reading cannot produce a number |
| `pi-web-access@0.38.0` | No | Conditional registration (`isToolEnabled`) plus a loader; compiled `dist` bundle |

Recommendation: record the static facts for lsp and session-finder as "static, read-only, source-text estimate, not a `/budget` number", mark `pi-subagents` and `pi-web-access` (and exact lsp) **OUTSTANDING** under `RB-10-03` with the exact procedure (`pi install` per `RB-07-02`, then `/budget` per profile on the work laptop). Do not evaluate typebox expressions extracted from package text: that executes package-authored code and violates fact 7. Do not extend `tool-count-baseline.test.ts`'s npm rows to carry token numbers as if verified.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Which tools the model sees (profile) | Pi extension, `session_start` hook in `routing/` | `.pi/settings.json` / CLI `--tools` as user override | The tool set is part of the cached prefix; only code that runs before the first request can set it for free |
| Token accounting (`/budget`, floor) | `diagnostics/budget.ts` (command, 0 tok) | Faux-session test helper | Commands cost zero per turn; the estimator must be single-sourced |
| Prompt-stability guarantee | Test suite (faux) | Source lints | Runtime behaviour is Pi's; the repo can only forbid the inputs that break it |
| AGENTS.md budget | CI test | `/budget` runtime view | CI covers this repo's file; runtime covers every other repo |
| Experiment orchestration | `sh` launcher + pure TS module | Work laptop (live key) | Live inference cannot run here |
| Third-party package cost | Work laptop `/budget` | Static tarball reading (partial) | Needs the package's code to run |

## Architecture Patterns

### System architecture (data flow for the floor and the profile)

```
pi start (cwd, flags, AGENTS.md, settings)
        |
   load extensions in directory order -- factories register tools (defaultActive default true), commands, flags, hooks
        |
   AgentSession built: registry ready, default active = 4 builtins + every defaultActive extension tool
        |
   session.bindExtensions -> emit session_start  (handlers in load order)
        |     plan-mode  : restore plan state, maybe enablePlanModeTools()
        |     qoder      : drop qoder_delegate if unconfigured
        |     routing    : applyProfile(getActiveTools(), flagProfile) -> setActiveTools(intersection)   <- NEW, once
        |
   first prompt: before_agent_start handlers (sections / messages), selectedTools = live active set
        |
   _preparePromptAndToolLoadout: sections diff vs transcript -> first system message {sections, toolsAdded}
        |
   agent loop: declareToolChanges (no delta on turn 1) -> context hooks (messages only; Pi restores system)
        |
   transport: DeepSeek/Bedrock collapse -> head = replayed prompt + CURRENT tool list  (any later change re-prices)
              Anthropic native    -> initial tools anchored, later additions as tool_addition blocks (until a removal)
        |
   provider request  -> usage {input, cacheRead} -> turns log -> /budget
```

### Recommended structure (additions only; prefer extending)
```
.pi/extensions/routing/
├── profiles.ts            # pure: PROFILE_TOOLS table, resolveProfile, applyProfile (named exports only)
└── index.ts               # + registerFlag("ky-profile"), + session_start applyProfile
.pi/extensions/diagnostics/
├── budget.ts              # + floor line, per-profile summary (same estimator)
└── ctx-experiment.ts      # pure experiment core (CTX-05)
tests/helpers/
└── harness-session.ts     # composed faux session: all entry points via trackedFiles, AGENTS.md, skills, profile option
tests/unit|integration/    # floor-ceilings, profile-membership, prompt-stability, agents-md-budget, ctx-experiment
docs/RUNBOOK.md            # RB-10-01..03
docs/EXTENSIONS.md         # tool_search decision, per-extension cost table, plan-mode exemption
```

### Pattern 1: narrow by intersection at `session_start`
**What:** compute `next = getActiveTools().filter(n => allow.has(n))`, call `setActiveTools(next)` once, never again from profile code.
**When:** every profile except `full`.
**Example:**
```typescript
// Source: pi 1.1.0 dist/core/agent-session.js:1099-1115 (replace semantics) + scratch proof T1
pi.on("session_start", () => {
  const profile = resolveProfile(pi.getFlag("ky-profile"));
  if (profile === "full") return;
  const allow = new Set(PROFILE_TOOLS[profile]);
  pi.setActiveTools(pi.getActiveTools().filter((name) => allow.has(name)));
});
```

### Pattern 2: composed-harness faux measurement
**What:** one inline user-scope extension that awaits every entry point, `AGENTS.md` copied into the temp cwd, skills via `resources_discover`, `session.bindExtensions({})`, one prompt, capture `TranscriptContext`, feed `computeBudget`.
**Why:** it is the only place the 18 extensions interact (shared active set, shared prompt sections).

### Anti-Patterns to Avoid
- **Hard-coding the extension list in the measurement.** Derive it from tracked entry points, so a new extension changes the floor and trips the ceiling.
- **Asserting an absolute size without a named ceiling and a why.** Phase 2's integration test deliberately asserts none because the number depended on the machine; here the temp-cwd isolation makes the number deterministic, so assert a ceiling per profile and make a raise a visible edit.
- **Replacing the active list with a literal list at `session_start`.** Breaks plan-mode resume and qoder gating by load order.
- **Relying on `tools: []` in the existing faux helper.** It filters registration of extension tools; the helper needs an "all tools" option.
- **Using `defaultActive:false` on vendored tools** just to avoid a hook: each is a PROVENANCE deviation to re-apply on every upstream bump.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Progressive disclosure | A custom loader tool or lazy registry | `setActiveTools` + profile table; Pi's transcript records the loadout | Pi already records, diffs and replays tool state per branch |
| Token counting | A tokenizer | `estimateTokensFromChars` (`ceil(chars/4)`) | `pinning.test.ts` forbids new deps; consistency with `/budget` |
| Reading the outgoing prompt/tools | Patching `before_provider_request` | `transcriptView(context)` in a faux response factory | Faux never fires `onPayload` |
| Catch-rate grading | New string matching | `scoreCalibration` | Already hardened against shotgun and cross-contamination |
| Prose-call detection | New regex | `isProseToolCall` | Tool-name anchored, ReDoS-bounded |
| Experiment statistics | A stats library | Exact binomial/Fisher in a ~30-line pure function with a boundary-table test | One decision, small N; no dependency allowed |
| Package cost for uninstalled packages | Evaluating extracted typebox | OUTSTANDING + runbook | Executes package code |

**Key insight:** the platform records and replays the tool loadout itself; the only thing worth authoring is the decision of what the loadout is, once, before the first request, and a test that nothing else changes it.

## Common Pitfalls

### Pitfall 1: Believing "only add" protects the cache on DeepSeek or Bedrock
**What goes wrong:** a mid-session `setActiveTools([...active, x])` is treated as free.
**Why:** those transports collapse and resend the current tool list; additions change the tools block just like removals (`transcript.js:196-208`; `openai-completions.js:1294-1295`; `bedrock-converse-stream.js:26,154`).
**Avoid:** profile is decided before the first request; `/profile` is additive-only and documented as a priced action.
**Warning signs:** `cacheRead` ratio collapses on the turn after a tool change in the turns log.

### Pitfall 2: One removal poisons the whole branch on Anthropic-native
**What:** `hasNonAdditiveToolChanges` scans the full history; after any `toolsRemoved`, later pure additions are no longer anchored (proved T2: `anchorsAdditions` false after remove-then-add).
**Avoid:** never remove after the first request except the documented plan-mode toggle; test it.

### Pitfall 3: Handler load order
**What:** `plan-mode` and `qoder` mutate the active set in `session_start` before `routing` runs; `pi-subagents` re-adds its loader in `before_agent_start` every prompt.
**Avoid:** intersection, not replacement; classify third-party names in the table; verify the packages' interaction in RB-10-03 because it cannot be tested offline.

### Pitfall 4: The faux helper silently registers no extension tools
**What:** `createFauxSession` passes `tools: opts.tools ?? []` and `session_start` never fires headless.
**Avoid:** add an all-tools option; call `bindExtensions({})`; assert tool presence BEFORE asserting absence (the vacuity guard `qoder-tool.test.ts` uses).

### Pitfall 5: Resume-in-plan-mode
**What:** `plan-mode`'s `session_start` calls `enablePlanModeTools()` when a persisted plan-mode entry is enabled, snapshotting the active set and adding `grep`, `find`, `ls`, `questionnaire`. A later narrowing in `routing` removes those, leaving a plan-mode session without its tools.
**Avoid:** when plan mode is restored enabled, union plan-mode's managed set into the allowlist (or skip narrowing); test with a persisted entry.

### Pitfall 6: Third-party loaders defeat exclusion
**What:** excluding `subagents_enable` from a profile does not hold if the package re-adds it in `before_agent_start`; and in `auto` mode on a non-native-additions model (DeepSeek) the package goes eager and declares the full `subagent` tool from turn 1.
**Avoid:** configure the package's `toolActivation` per its own config rather than fighting it; measure after install (RB-10-03). Open question OQ2.

### Pitfall 7: Budget-formula drift
**What:** `/budget` (4,255) and wire estimate (4,444) differ by about 4%; mixing them in a before/after claim fakes a reduction or hides one.
**Avoid:** record the formula next to every number; CI ceilings use one formula only.

### Pitfall 8: Code-comment and naming gates on the new files
`contributing-boundary.test.ts` matches the plain substring `registerTool` in every file under `.pi/extensions/` outside its allowlist, comments included (header lines 43-58); say "the tool-registration call". `chokepoint-lint.test.ts` bans the model-call method names outside `diagnostics/`, comments included. `comment-discipline.test.ts` rejects phase/requirement/review IDs in code comments, so the `ctx-experiment.ts` header must not cite CTX-05 or RB-10-01 (put those in docs/tests). A new file that has a default export becomes an extension entry point and `extension-layout.test.ts` will then require the flat or `<name>/index.ts` shape. `workflow-budgets.test.ts` ratchets every directory that holds a command source; adding lines to `routing/` or `diagnostics/` means editing the number with a `why`.

## Code Examples

### Composed measurement core (the scratch harness, trimmed; becomes `tests/helpers/harness-session.ts`)
```typescript
// Source: executed 2026-10-13 against pi 1.1.0; APIs per dist/index.d.ts and pi-ai dist/utils/transcript.js
const faux = fauxProvider({ models: [{ id: "faux-flash", reasoning: true }] });
faux.setResponses([(ctx) => { captured = ctx; return fauxAssistantMessage("ok"); }]);
const mr = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
mr.registerNativeProvider(faux.provider);
const { session } = await createAgentSession({
  cwd, agentDir, model: mr.getModel(faux.provider.id, "faux-flash")!, modelRuntime: mr,
  settingsManager: SettingsManager.inMemory({ extensions: ["-builtin:mcp", "-builtin:llama.cpp", "-builtin:codemode", "-builtin:tool-search"] }, {}),
  sessionManager: SessionManager.inMemory(cwd),          // NOTE: no `tools` key, so extension tools register
});
await session.bindExtensions({});                        // fires session_start
await session.prompt("hi");
const sys = getCurrentSystemMessage(captured.messages)!; // sections + toolsAdded
const prompt = Object.values(sys.sections ?? {}).join("\n\n");
const decl = getCurrentTools(captured.messages).reduce((n, t) => n + JSON.stringify(toToolDeclaration(t)).length, 0);
const floorTokens = Math.ceil((prompt.length + decl) / 4);
```

### Proof that narrowing at `session_start` records no removal (T1) and that a mid-session removal does (T2)
```typescript
// Source: executed; assertions the real tests should make
// T1: after bindExtensions with a hook that drops bg_*:
//   ctxs[0].messages.filter(m => m.role === "system") has length 1, toolsAdded = [read,bash,edit,write], no toolsRemoved
//   hasNonAdditiveToolChanges(ctxs[1].messages) === false
// T2: after pi.setActiveTools(active minus "bg_kill") between prompts:
//   second system message has {sections:["tools","rules"], toolsRemoved:["bg_kill"]}
//   hasNonAdditiveToolChanges(ctxs[1].messages) === true
//   resolveTranscriptTools(ctxs[1].messages, true).anchorsAdditions === false
```

### `defaultActive:false` semantics (T5)
```typescript
// Source: executed; registering {name:"t_off", defaultActive:false, promptSnippet, promptGuidelines}
// request 1: tools = read,bash,edit,write,t_on ; `tools` section has no t_off line ; getAllTools() lists t_off[direct]
// after setActiveTools([...active,"t_off"]): request 2 gains a system message {sections:["tools","rules"], toolsAdded:["t_off"]}
```

### Draft decision function (CTX-05)
```typescript
// Pre-registered constants live next to the function; the test is a boundary table.
export const DEGRADE_POINTS = 0.15;
export function decide(a: Counts, b: Counts): "DEGRADES" | "NO_DETECTABLE_EFFECT" | "INCONCLUSIVE" {
  const d = b.caught / b.n - a.caught / a.n;
  const [lo, hi] = diffInterval90(a, b); // exact, pure, ~30 lines
  if (d <= -DEGRADE_POINTS && hi < 0) return "DEGRADES";
  if (lo > -DEGRADE_POINTS) return "NO_DETECTABLE_EFFECT";
  return "INCONCLUSIVE";
}
```

## State of the Art

| Old Approach (0.84-era docs in CLAUDE.md) | Current Approach (1.1.0 source) | Impact |
|-------------------------------------------|---------------------------------|--------|
| Register everything, keep a loader tool, activate on demand; "Anthropic 4.5+ and gpt-5.4 get native deferred loading" | Tool state is a transcript delta (`toolsAdded`/`toolsRemoved` on system messages); native additions exist only where `compat.supportsMidConvoToolChanges`/`ToolAdditions` is set | DeepSeek and Bedrock do not have it; profiles up front beat lazy loading here |
| `context` hook "cannot strip tools" | True for `context`; a second hook `context_with_system` owns prompt and tools | New lint |
| `before_agent_start` returns `systemPrompt` string | Structured `systemPromptOptions.sections`; section patches are transcript deltas | Volatile content shows up as a second system message |
| `tool_search`/dynamic loading as the sanctioned answer | First-party `tool_search` exists but is off by default and costs about 173 tok | Not adopted |
| Phase 2 floor 12,725 / ~1,850 | 4,444 default, 1,905 for bare Pi + AGENTS.md | Re-baselined here |

**Deprecated/outdated in this repo's docs:** `tests/helpers/session.ts` header still cites 0.84.1 and a 49 KB CLAUDE.md / 12,725 figure; `docs/EXTENSIONS.md` "Pi 1.x capabilities not adopted" should be updated with this phase's decisions.

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted deliberately. One adjacent note: the `qoder` `session_start` deactivation stays as is; `full` must not re-add `qoder_delegate` when unconfigured, which the intersection design guarantees.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | DeepSeek's server-side prefix cache includes the `tools` array ahead of messages, so a changed tools block re-prices everything after it | Native mechanism | If tools sit after the cached prefix the "any change re-prices" claim is milder, but the cost of unneeded schema tokens is unchanged. RB-10-02 measures `cacheRead` across a tool change |
| A2 | Detectable-effect figures (23 pts at 60/arm, 16 at 120/arm) from a normal approximation with independent trials | CTX-05 | Real power is lower because six defects are clusters; the protocol states it can only see large effects |
| A3 | Pi's handler order for `session_start` is extension-directory order, with `routing` after `plan-mode` and `qoder` | Profile design | Intersection design is order-independent for those two, so risk is low; third-party package order is unknown and is RB-10-03 |
| A4 | `pi-lsp` token estimate 500-650 from partial static reading | CTX-06 | Wrong by tens of percent; flagged as source-text estimate, exact value OUTSTANDING |
| A5 | Node >= 22.19 strips TypeScript types without a flag (verified on 24.16 only) | CTX-05 launcher | If a 22.x machine needs a flag, the launcher can use `--experimental-strip-types`; check on the work laptop |
| A6 | Default profile should be `implement` and `full` should stay opt-in | Profile design | A product decision with a behavioural cost (bg_* and questionnaire not offered by default); user can flip the default in one constant |

## Open Questions

1. **Default profile and the literal 1,850 target**
   - Known: default `implement` is 2,547 (-43%); only `recon` reaches 1,840 by `/budget`'s formula.
   - Unclear: whether the user wants `recon`-level cheapness as the default for exploratory sessions.
   - Recommendation: ship `implement` as default, record R4, and let `--ky-profile recon` be the documented cheap mode.
2. **pi-subagents `auto` mode on DeepSeek goes eager** (declares the large `subagent` schema from turn 1) and re-adds its loader every prompt.
   - Recommendation: after `RB-07-02`, set the package's `toolActivation` deliberately and re-measure under `RB-10-03`; do not try to defeat it from `routing`.
3. **Removing Pi's `docs` section (346 tok) via a custom prompt.** Large win, but drops tool snippets and rules for a cheap model.
   - Recommendation: do not adopt by default; include as optional arm E in the CTX-05 experiment if budget allows.
4. **Prose-retry `tool_choice` lever** (`PROSE_RETRY_FORCES_TOOL_CHOICE`, off, deferred to Phase 10 in STATE.md).
   - Recommendation: out of scope for CTX-01..06; CTX-05 supplies the baseline rate it needs. Note it in the phase summary rather than build it.
5. **Pi's cache warmer** (`cacheWarming` default `"streaming"`, `docs/settings.md:19`, `core/cache-warmer.js`) replays the prompt with a one-token output during runs; a stable prefix makes the replay cheap. Not in scope; mention in `docs/EXTENSIONS.md` so Phase 11's cost display accounts for it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | yes | 24.16.0 | - |
| npm | static tarball reads | yes | with node | - |
| vitest | tests | yes | 4.1.11 | - |
| Pi 1.1.0 (SDK in `node_modules`) | faux sessions | yes | 1.1.0 | - |
| `pi` binary on PATH | integration tests that shell out | not needed for Phase 10 plans | - | faux sessions |
| Provider API key | CTX-05 live, RB-10-02 | no (by policy) | - | runbook OUTSTANDING |
| Installed `pi-subagents`/lsp/web/finder | exact CTX-06 numbers | no (`RB-07-02`) | - | static partial + OUTSTANDING |
| Network to the npm registry | optional tarball re-read | yes (used once) | - | none needed |

**Missing dependencies with no fallback:** none blocking.
**Missing with fallback:** live key, installed packages (runbook entries).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.11 |
| Config file | `vitest.config.ts` (maxWorkers 2, setup `tests/setup/agent-dir.ts`, global teardown tripwire) |
| Quick run command | `npx vitest run <file> --maxWorkers=2` |
| Full suite command | `npx vitest run --maxWorkers=2` (once, at verification; `audit-concurrency` is a known flake) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CTX-01 | Each profile's declared tools equal its table; narrowing writes no `toolsRemoved`; every registered tool is classified; completeness fails when a tool is unclassified | faux integration | `npx vitest run tests/integration/tool-profiles.test.ts --maxWorkers=2` | Wave 0 |
| CTX-01 | Plan-mode resume keeps its tool set under narrowing; plan-mode toggle is the only post-start change | faux integration | same file | Wave 0 |
| CTX-02 | `context` handler cannot strip; `context_with_system` can (negative control); no `context_with_system` in tracked extension source (lint with self-test) | faux + unit | `npx vitest run tests/integration/context-hook-tools.test.ts tests/unit/context-hook-lint.test.ts --maxWorkers=2` | Wave 0 |
| CTX-03 | AGENTS.md and rendered block and comment-rule block under their budgets; over-budget fixture fails the same checker | unit | `npx vitest run tests/unit/agents-md-budget.test.ts --maxWorkers=2` | Wave 0 |
| CTX-04 | Prompt byte-equal over 3 turns with moved clock; one system message per request; negative control with a volatile section fails; snippet/guideline interpolation lint | faux integration + unit | `npx vitest run tests/integration/prompt-stability.test.ts tests/unit/prompt-metadata-lint.test.ts --maxWorkers=2` | Wave 0 |
| CTX-05 | Plan balance/determinism, trial scoring, decision boundary table, arm args differ only in intended flags, controls score 0 | unit + faux | `npx vitest run tests/unit/ctx-experiment.test.ts --maxWorkers=2` | Wave 0 |
| CTX-05 | The live run | manual | RB-10-01 (OUTSTANDING) | docs |
| CTX-06 | Per-extension deltas recompute and close on the composed floor within tolerance; per-profile floor ceilings; `/budget` prints the floor line | faux integration + unit | `npx vitest run tests/integration/context-floor.test.ts tests/unit/budget-command.test.ts --maxWorkers=2` | partly (budget tests exist) |
| CTX-06 | Uninstalled package numbers | manual | RB-10-03 (OUTSTANDING) | docs |
| all | Runbook ids governed; docs-policy arrays updated | unit | `npx vitest run tests/unit/docs-policy.test.ts --maxWorkers=2` | exists, needs edit |
| all | Tool-count baseline and boundary allowlist updated in the same change | unit | `npx vitest run tests/unit/tool-count-baseline.test.ts tests/unit/contributing-boundary.test.ts --maxWorkers=2` | exist, need edits |

### Sampling Rate
- **Per task commit:** the one targeted file for that task, `--maxWorkers=2`.
- **Per wave merge:** the touched files above in one sequential invocation, plus `npx tsc --noEmit` once per plan.
- **Phase gate:** full suite once; `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/helpers/harness-session.ts` - composed faux session with an all-tools option, entry points from `trackedFiles`, AGENTS.md and skills, profile option; used by four of the files above.
- [ ] `tests/integration/tool-profiles.test.ts`, `context-hook-tools.test.ts`, `prompt-stability.test.ts`, `context-floor.test.ts`.
- [ ] `tests/unit/agents-md-budget.test.ts`, `context-hook-lint.test.ts`, `prompt-metadata-lint.test.ts`, `ctx-experiment.test.ts`.
- [ ] Edits to `docs-policy.test.ts` (`PHASE_TEN_IDS`, command-pin rows), `tool-count-baseline.test.ts` (token column or profile column), `workflow-budgets.test.ts` (routing and diagnostics ratchets), `contributing-boundary.test.ts` (if a tool changes).
- [ ] Every new test gets a mutation proof (remove the subject, watch it fail), stated in its header per repo convention. The profile completeness test, the byte-equality test and the budget checker each have a built-in negative control above.

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json`, so this section applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | - |
| V3 Session Management | no | - |
| V4 Access Control | yes | The `tool_call` guard stays the load-bearing control; profiles only reduce what is offered and are not a security boundary (a hidden tool can still be re-enabled by `/profile full` or `setActiveTools`) |
| V5 Input Validation | yes | Experiment parser treats model output and package text as untrusted: bounded regex, JSON parse in try/catch, no `eval` |
| V6 Cryptography | no | - |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Un-reviewed `tool_search`/codemode path opened to relieve token cost | Elevation of privilege | Keep the deny list and settings disables; decision (a) leaves them untouched |
| Reading untrusted tarballs | Tampering | `npm pack --ignore-scripts`, read as text only, never import or `require`, separate scratch dirs (done) |
| Minimal experiment arm has no safety layer on a laptop with live AWS SSO | Elevation / information disclosure | Disposable temp repo, scrubbed env (no `AWS_*`), temp `PI_CODING_AGENT_DIR`, review-only prompt, documented in `RB-10-01` |
| Secrets in experiment output | Information disclosure | JSONL output goes under the gitignored logs dir; route through `redact.ts`; public repo rule |
| Prompt injection via padded filler or tarball text | Tampering | Filler is built from this repo's own strings only |

## Project Constraints (from CLAUDE.md and AGENTS.md)

- No credentials in the public repo; no account ids or hostnames in docs (RUNBOOK uses `<work-repo>`).
- Zero spend beyond model tokens; no new dependency; `pinning.test.ts` guards devDependencies.
- Complexity: anything that cannot justify its per-turn cost becomes a skill or moves out; commands cost 0; tool registrations are allowlisted and baselined.
- POSIX `sh` for scripts; Windows Git Bash now; LF endings; Node >= 22.19; `.ts` loaded by jiti, no build step; entry `.pi/extensions/<name>/index.ts`.
- `@earendil-works/*` and `typebox` are peers `"*"`, never bundled; unscoped `typebox`.
- Exact version pins; no bare `npm:pkg`.
- Comments: WHY-only, 1-2 lines, no phase/requirement/review IDs, no caller references, file:line or URL for external facts, vendored files exempt. The new files in this phase must obey it (see Pitfall 8).
- Tests: `npx vitest run <file> --maxWorkers=2`, `npx tsc --noEmit`; stage explicit paths; never push or merge to `main`; GSD workflow for edits.
- Verify at source, not docs (user memory): this document read `dist/*.js` and ran faux sessions; the shipped `docs/extensions.md` statement matched the source.

## Sources

### Primary (HIGH confidence)
- `node_modules/@earendil-works/pi-coding-agent@1.1.0`: `dist/core/agent-session.js` (:1055-1195, :1326-1375, :1560-1640, :2598-2640, :2800-2900), `dist/core/system-prompt.js`, `dist/core/sdk.js` (:140-160, :300-320), `dist/core/extensions/runner.js` (:1006-1063), `dist/core/extensions/types.d.ts` (:395-491, :660-690, :1058, :1214-1224, :1257-1267), `dist/core/resource-loader.js` (:115-135), `dist/extensions/tool-search/{index,tool}.js`, `dist/core/cache-warmer.d.ts`, `docs/extensions.md` (:182-186), `docs/settings.md` (:19, :40-58), `docs/cli.md` (:114-232), `docs/configuration.md` (:19-39)
- `node_modules/@earendil-works/pi-agent-core@1.1.0/dist/agent-loop.js` (:205-262)
- `node_modules/@earendil-works/pi-ai@1.1.0`: `dist/utils/transcript.js`, `dist/utils/text.js`, `dist/api/{openai-completions,anthropic-messages,bedrock-converse-stream}.js`, `dist/providers/data/*.json` (compat flags)
- Executed scratch proofs T1-T5 and measurements A/B/C, per-extension and per-profile runs (2026-10-13, not committed; scratch dir under the session scratchpad)
- Repo files: `.pi/extensions/{diagnostics/budget.ts, safety/index.ts, qoder/index.ts, quality/calibration.ts, routing/*, harness/*, plan-mode/index.ts, background-tasks/src/core/shell-policy.ts}`, `.pi/agents/*.md`, `tests/{helpers/session.ts,helpers/faux.ts,fixtures/seeded-defects/index.ts}`, `tests/unit/{tool-count-baseline,contributing-boundary,chokepoint-lint,comment-discipline,workflow-budgets,docs-policy,budget-command}.test.ts`, `docs/{RUNBOOK,EXTENSIONS,SAFETY,DIAGNOSTICS}.md`

### Secondary (MEDIUM confidence)
- Tarballs of the four pinned packages, read as text only (`npm pack --ignore-scripts`): `pi-subagents@0.76.1` `src/extension/{tool-activation,index}.js`; `@narumitw/pi-lsp@0.49.9` `src/pi-lsp.ts`

### Tertiary (LOW confidence)
- Detectable-effect arithmetic (normal approximation); DeepSeek server-side cache layout (A1); pi-lsp token estimate (A4)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - nothing new; all versions read from `node_modules`.
- Architecture and mechanism: HIGH - source read and executed in faux sessions; the provider-dependent cache behaviour is read from the transport code, with the DeepSeek server side flagged A1.
- Measured numbers: HIGH for the offline floors and attribution (exact closure); MEDIUM that they match a real terminal session (user-scope shim vs project scope, global `~/.pi/agent` files not included).
- Pitfalls: HIGH for those proven (T1-T5), MEDIUM for third-party interactions (unexecuted).
- CTX-05 protocol: MEDIUM - design is sound and reuses verified assets; power is approximate.

**Research date:** 2026-10-13
**Valid until:** 2026-10-27 (Pi ships every 2-3 days; re-run the measurement harness after any Pi bump or any new tool)
