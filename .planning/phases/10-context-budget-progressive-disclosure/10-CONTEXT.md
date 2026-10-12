# Phase 10: Context Budget & Progressive Disclosure - Context

**Gathered:** 2026-10-13
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss; orchestrator facts below are binding)

<domain>
## Phase Boundary

The harness stops being a tax on the model it exists to help, and the open question of whether context pollution actually degrades output quality gets a measured answer.

**Requirements:** CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06

**Depends on:** Phase 2 (`/budget`, `budget-sections`), Phase 7 (`tool-count-baseline.test.ts`, `contributing-boundary.test.ts` allowlist), Phase 8, Phase 08.1 (Pi 1.1.0, 1.x tool-path guard), Phase 08.2 (root `AGENTS.md`, per-session comment-rule injection), Phase 9 (everything that registers a tool).

**Success criteria (ROADMAP.md, binding — the spec):**

1. Named tool profiles (recon / implement / review / full) are set once at `session_start` via `pi.setActiveTools()` and only ever added to — tool *removal* invalidates the prompt cache, and the `context` hook cannot strip tool definitions at all.
2. `/budget` shows the per-turn floor measurably below the ~1,850-token baseline, and each installed extension's per-turn token cost is a recorded number that either justifies keeping it or removes it.
3. CI fails when `AGENTS.md` exceeds its token budget, and no volatile content — timestamps, running cost, git branch, changed files — appears in the system prompt.
4. **Verified live on the work laptop**: a controlled minimal-vs-full-harness experiment produces a recorded answer on whether context pollution degrades output quality. **[RUNBOOK]**

**Out of scope:** Phase 11 (TUI chrome — statusline/header/widget), Phase 12 (OpenSpec). Do not touch `.planning/phases/12-openspec-opt-in-skill/`.
</domain>

<decisions>
## Implementation Decisions

### Orchestrator facts (binding)

1. **Pi is 1.1.0** (`node_modules/@earendil-works/pi-coding-agent/package.json`). The 0.84-era research in CLAUDE.md is stale where it conflicts. **Verify every API claim at source in `node_modules` (`dist/**/*.d.ts`, `dist/**/*.js`, shipped `docs/`), never blogs.**
2. **Pi 1.x ships native progressive disclosure. PREFER it over authoring our own** (project constraint: do not reimplement what the platform ships). Verified at source while writing this file:
   - `ToolDefinition.exposure?: "direct" | "model-only" | "codemode" | "deferred" | "hidden"` (`dist/core/extensions/types.d.ts:395,475`). `deferred` = not declared, findable/activatable by built-in `tool_search`. `hidden` = withdrawn (tools cannot be unregistered).
   - `ToolDefinition.defaultActive?: boolean` (`types.d.ts` ~481) — `false` registers without activating; activated by `--tools`, the `defaultTools` setting, or `setActiveTools()`.
   - `ToolDefinition.namespace`, `prepareLoadout(loadout) -> { descriptions?, hiddenDeclarations? }` (`types.d.ts:411-491`).
   - `defaultTools` setting with `+name`/`-name` entries (`docs/settings.md:40-58`).
   - `docs/extensions.md` "Activate tools dynamically": Pi records the initial tool set in the transcript's first system message and **appends** tool changes before the next request; providers that cannot represent the transition get a full checkpoint that can invalidate the cached prefix. This is the 1.x statement of criterion 1's "only add, never remove".
   - Also available: `provider_stream_event`, `ctx.modelRegistry.stream()` (the chokepoint lint forbids `.stream` outside `diagnostics/` — do not weaken it).
3. **Criterion reinterpretation must be explicit.** Criterion 1 / CTX-01 / CTX-02 are phrased for 0.84 (`setActiveTools` at `session_start`, `context` hook). Research must decide, at source, whether the 1.x mechanism (`defaultActive: false` / `exposure` / `defaultTools`) satisfies them better, and the plans must record each reinterpretation in a "Criterion reinterpretations" table (original wording -> 1.x mechanism -> why equivalent or stronger -> test that proves it). `setActiveTools` stays the activation primitive unless source shows otherwise; the "context hook cannot strip tool definitions" half must be proven by a faux test, not asserted.
4. **Known conflict to resolve, not ignore:** Phase 08.1 disabled `builtin:tool-search` and `builtin:codemode` in `.pi/settings.json`, and the safety hook **denies** `tool_search`/`codemode` calls (`docs/SAFETY.md`, `tests/integration/new-tool-paths.test.ts`) because they were unreviewed. `exposure: "deferred"` is only reachable via `tool_search`. Options: (a) keep tool_search denied and use `defaultActive: false` + additive profile activation via `setActiveTools`, no safety change; (b) review Pi's first-party `dist/extensions/tool-search/` source and re-enable it, updating the deny list, settings test and SAFETY.md in the same change. Default to (a) unless research shows (b) is materially cheaper per turn AND nested calls stay guarded. Record the choice.
5. **Phase 08.2 changed the floor.** Pi in this repo now loads root `AGENTS.md` (1,655 bytes) instead of the 49 KB `CLAUDE.md`; the harness injects comment rules per session. The Phase 2 numbers (12,725 input tokens; ~1,850 Pi-default floor) are stale. **Measure the current floor with `/budget`'s own computation (faux session, offline) BEFORE cutting, record it, then measure AFTER.** Do not assume.
6. **CTX-05 needs live credentials.** Design the minimal-vs-full experiment protocol fully (task set, seeded-defect or graded tasks, arms, N, metric, decision rule, which result discriminates which root-cause candidate), build the harness/script offline and unit-test it with `fauxProvider`, and append runbook entry `RB-10-xx` marked **OUTSTANDING**. No inference requests from this machine. CTX-05 stays partial with the id named inline.
7. **CTX-06 for packages that cannot be loaded offline.** `pi-subagents`, `@narumitw/pi-lsp`, `pi-web-access`, `pi-session-finder` are pinned in `.pi/settings.json` but **not installed** (`RB-07-02` OUTSTANDING). Measure everything measurable offline (authored/vendored extensions in `.pi/extensions/`, Pi built-ins, skills index, prompt templates, AGENTS.md, injected comment rules). For pinned-but-uninstalled packages, a static measurement from the published tarball's tool descriptions/schemas is acceptable only if it executes no package code (read files only, treated as untrusted data); otherwise mark OUTSTANDING with a runbook id. Every recorded number states its method.

### Already decided, binding (from prior phases)

- **Boundary rule (BOOT-10, CONTRIBUTING.md):** commands cost 0 per-turn tokens, skills ~40-60 tok index. Tool registrations are allowlisted in `tests/unit/contributing-boundary.test.ts` and baselined in `tests/unit/tool-count-baseline.test.ts` — Phase 10 is where that number is cut. Any change to registered/active tools updates both in the same change.
- **Prompt cache (CTX-04):** no volatile content (timestamps, cost, branch, changed files, session ids) in the system prompt or in `promptSnippet`/`promptGuidelines`. Activating a tool that carries `promptSnippet`/`promptGuidelines` rebuilds the system prompt — lazily-activated tools rely on `description` only. Volatile UI content belongs to Phase 11's TUI chrome. Prove with a faux test that captures the system prompt across turns / simulated clocks and asserts byte equality.
- **CTX-03:** CI-enforced token budget on `AGENTS.md` (and the injected comment-rule block). Pick the budget from the measured current size with modest headroom; a raise must be a visible edit with a why. Use the same token estimator as `/budget`.
- **Chokepoint lint** (`tests/unit/chokepoint-lint.test.ts`): no `modelRegistry.complete/.stream/...` outside `.pi/extensions/diagnostics/`, including in comments. Do not weaken.
- **No new npm dependency.** `pinning.test.ts` asserts the exact devDependencies set.
- **Be suspicious of green.** Each new test must fail when its subject is removed.
- **Comments follow root AGENTS.md** (WHY-only, no phase/requirement IDs in code comments).

### CPU budget (hard — user's PC hit 99%)
- Targeted tests only: `npx vitest run <file> --maxWorkers=2`; `npx tsc --noEmit` once per plan; never concurrent test runs; sequential plan execution. Full suite ONCE at verification. Known flake: `audit-concurrency`. Do not raise budgets to pass tests.

### Claude's discretion
Profile membership; where profile selection lives (routing mode vs settings vs command); the experiment's task corpus and metric; how per-extension cost is attributed (diff of `/budget` sections with an extension loaded vs not); file layout of any new module (prefer extending `diagnostics/` budget code and `routing/` over new subsystems).
</decisions>

<code_context>
- `/budget`: `.pi/extensions/diagnostics/` (tests `budget-command.test.ts`, `budget-sections.test.ts`).
- Registered tools today: `safety/index.ts` (several, incl. `approve_ky_command`), `qoder/index.ts` (`qoder_delegate`), `quality/index.ts`, `todo.ts`, `questionnaire.ts`.
- `.pi/settings.json`: `packages[]` (4 pinned, uninstalled) and `extensions` disabling `builtin:mcp`, `builtin:llama.cpp`, `builtin:codemode`, `builtin:tool-search`.
- Notes for this phase from 08.1: `docs/EXTENSIONS.md` "Pi 1.x capabilities not adopted - inputs for Phases 10/11".
- Runbook: `docs/RUNBOOK.md`; append `RB-10-xx`, never renumber; `tests/unit/docs-policy.test.ts` cross-checks table row vs `**Status:**` line and needs new ids in its arrays.
</code_context>

<deferred>
- Live CTX-05 run and live per-extension numbers for uninstalled packages -> runbook OUTSTANDING.
- TUI placement of volatile info -> Phase 11.
</deferred>
