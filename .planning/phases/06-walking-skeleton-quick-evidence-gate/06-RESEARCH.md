# Phase 6: Walking Skeleton — `/quick` & the Evidence Gate - Research

**Researched:** 2026-08-14
**Domain:** Composing existing Phase 2/4/5 seams into one command; a CI line-budget test; a SHA-bound evidence gate
**Confidence:** HIGH — every claim below is either read directly from this repo's source or Pi 0.84.1's own shipped `.d.ts`/`docs/`. No web search was used (per phase scope: ROADMAP says this phase needs no research).

## Summary

This phase builds nothing new at the mechanism level — it composes three already-shipped subsystems (`routing/`, `safety/`, `diagnostics/`) behind one Pi **command**, plus a CI test that fails the build on a line-count regression. The four questions below were answered by reading source, not by re-deriving design. The two live risks found: (1) `/quick`, to hold the safety guard headless, must run inside a session where the safety extension is loaded — either via the same "write a driver at USER scope" pattern Phase 4's headless tests already use, or by trusting the project — this is not automatic and must be planned explicitly; (2) the bash tool exposes a structural `isError` boolean on `tool_result`/`tool_execution_end`, but the literal numeric exit code is only recoverable by parsing the tool's own trusted output text (`"Command exited with code N"`), never the model's transcript — GATE-07's "never on transcript text" is satisfiable, but the plan must be precise about *which* text it means.

**Primary recommendation:** `/quick` is a single `pi.registerCommand()` handler in a new `.pi/extensions/workflows/index.ts`, calling `planRoleCall`/`runSingleShotRole` (routing), letting the existing safety wrapper enforce the git commit (no new safety code), and writing one evidence-gate record via `appendJsonl` with its own owned base name. The evidence gate keys on `ToolResultEvent.isError` (structural, Pi-computed) plus a freshly-added `currentSha(cwd)` helper in `safety/git.ts`'s style — no such helper exists today.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Route selection (which model serves executor) | `routing/modes.ts` (pure) | `/quick` command (dispatch) | Already built; `/quick` only calls it |
| Capability guard | `routing/guard.ts` (pure) | — | Called inside `planRoleCall`; `/quick` never re-implements |
| Command execution (bash/write/edit) | `safety/index.ts` wrapped tools | `tool_call` hook | Both already enforce headless; `/quick` adds no exec path of its own |
| Evidence record (exit code + SHA) | New: `workflows/evidence.ts` (pure predicate) + `appendJsonl` | `/quick` command (capture point) | No existing module owns this; SEAM RISK below |
| Git SHA read | New: small helper, `git.ts` pattern | — | `safety/git.ts` has no SHA reader today; must be added |
| Turn/cost logging | `diagnostics/` (via `callModel`) | — | Only reached if `/quick` needs a nested model call beyond the session executor |
| CI line-budget enforcement | `tests/unit/` vitest test | `.github/workflows/ci.yml` (`npx vitest run`, already present) | No new CI job; reuse existing mechanism (CONTEXT.md decision 4) |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLOW-01 | `/quick` executes trivial work with no ceremony, ≤80 lines, CI-enforced | Q2 settles the command-vs-prompt-template question; Q2 also gives the line-count mechanics and the registry shape |
| FLOW-11 | Every workflow has a CI-enforced line budget | Q2's registry design; reuses the existing `npx vitest run` CI step, no new job |
| GATE-07 | Completion gated on `tool_result` exit codes bound to a git SHA, never transcript text | Q3 gives the exact structural field (`isError`) and where the numeric code is NOT structural; Q1/git.ts gives the SHA-read gap |
</phase_requirements>

## User Constraints (from CONTEXT.md)

Full text lives in `06-CONTEXT.md`; only the load-bearing points are restated here per this phase's explicit scope-brevity instruction.

**Locked (binding, not re-litigated):**
1. Walking skeleton — compose real Phase 2/4/5 code; a passing test that re-implements routing or the guard has proved nothing.
2. `/quick` is a COMMAND, never a tool, never a skill.
3. ≤80 lines is the target the test enforces; 100 is the hard failure ceiling (ROADMAP wording).
4. FLOW-11's budget test lives in the existing vitest suite — no new CI job, no shell linter.
5. The budget is a **registry** (file→budget), not one hardcoded number, and the registry must also fail when an unlisted workflow file exists.
6. GATE-07 keys on structured `tool_result` + git SHA, never transcript text — direct consequence of the `prose_tool_call` detector (`diagnostics/prose.ts`) existing.
7. The guard is Phase 4's, unchanged, and must hold headless — `/quick` must not shell out to `git` around it.
8. `safety/` gains no routing import and vice versa; the two subsystems meet only inside `/quick`. Cross-subsystem signalling is `pi.events`, never an import.
9. Routing goes through `routing/modes.ts`'s existing exports; `/quick` never calls `modelRegistry.complete()` itself (chokepoint-lint).
10. Every test must be shown to fail if its subject is removed; no test may write outside the repo or a temp dir.

**Claude's discretion:** exact file location under `.pi/extensions/`, evidence-record shape (in-memory / `pi.appendEntry` / gitignored JSONL — CONTEXT.md leans JSONL structured+SHA-bound), how a rejection is surfaced, exact budget numbers for not-yet-written Phase 9 workflows, whether the registry lives in the test file or a committed data file.

**Deferred (out of scope for this phase):** `/grill`/`/plan`/`/execute`/`/review` themselves (Phase 9); installing `pi-subagents` etc. (Phase 7); quality gates (Phase 8); context budget tuning (Phase 10); UI (Phase 11); Qoder delegation (never from `/quick`).

## Q1 — Real, current API of the seams `/quick` must compose

### Routing (`routing/modes.ts`, `routing/guard.ts`, `routing/index.ts`)

- `resolveRoute(role: Role, state: ModeState): RoleRoute` — pure. `.pi/extensions/routing/modes.ts:232`
- `pickConfiguredCandidate(registry: ModelRegistryLike, candidates): CandidateResult` — pure, walks a candidate list, skips unauthenticated entries. `modes.ts:257`
- `usesToolLoop(role: Role): boolean` — derives ROUTE-08 scope from `ROLE_MECHANISM`. `modes.ts:289`
- `planRoleCall(registry: ModelRegistryLike, opts: {role, state, need: RoleNeed}): PlanResult` — the full resolve→pick→guard pipeline in one pure call. `modes.ts:339`. `PlanResult` is `{ok:true, role, model, mechanism, reasoningEffort?} | {ok:false, reason}`.
- `runSingleShotRole(ctx: ExtensionContext, opts: {role, messages, systemPrompt?, need}): Promise<AssistantMessage>` — impure, dispatches through `callModel`/`callWithFallback`. **Only valid for `mechanism === "call-model"` roles** (reviewer, advisor, vision, summariser) — throws for `executor`/`planner`. `modes.ts:395`.
- `getModeState(): KyModeData` — reads the current mode/escalation off a `globalThis` slot. `modes.ts:191`.
- `guardRoute(model, role, need: GuardNeed): GuardVerdict` — `{ok:true} | {ok:false, reason}`, four hard blocks, first match wins. `.pi/extensions/routing/guard.ts:212`.

**Precondition `/quick` must satisfy:** `runSingleShotRole` is for the four single-shot roles, NOT the executor. `/quick`'s own "do the work" turn is the session's *own* prompt loop (the model already selected via `/cheap`/`/balanced`/`/max`), not a nested `runSingleShotRole` call — a role of `executor` handed to `runSingleShotRole` throws by design (`modes.ts:401-406`). If `/quick` needs the executor to actually act, that happens through `ctx.sendUserMessage`/the normal agent turn, not through this dispatcher. **This is a planning-relevant finding**: `/quick`'s job is to KICK OFF a routed, guarded turn and then gate on its evidence — not to run a second nested completion for the work itself.

`RoutingTestOptions` (`routing/index.ts:236`) is a test-only injection seam, but it injects `AgentOverridesForOptions` ONLY (a guard-blocked-fixture role map for `agentOverridesFor`). **It does NOT prevent a settings write.** The actual fix for "test suite wrote into the developer's real `~/.pi/agent/settings.json`" is `tests/setup/agent-dir.ts`, a vitest `setupFiles` entry (`vitest.config.ts:24`) that sets `process.env.PI_CODING_AGENT_DIR` to a fresh temp dir **at module scope, before any test file's own body runs** — this is what `getAgentDir()` (used by `agent-overrides.ts:334`, `resolveSettingsPath`) resolves against. Confirmed: `tests/setup/agent-dir.ts:1-81` documents the exact CR-01 finding and fix. **A Phase 6 test needs no new seam here** — it inherits this suite-wide guard automatically, same as every other test file in the repo. Do not invent a second env-var override.

### Safety (`safety/git.ts`, `safety/shell.ts`, `safety/index.ts`)

- `classifyGitInvocation(invocation: GitInvocation, facts: GitPolicyFacts): GitVerdict` — `{kind:"allow"} | {kind:"block", reason}`. `.pi/extensions/safety/git.ts:310`.
- `currentBranch(cwd): string` — the only impure export; runs `git symbolic-ref --short HEAD` via `spawnSync(..., {shell:false})`, returns `DETACHED_HEAD` on non-zero. `git.ts:144`. **No SHA-reading function exists in this file or anywhere in `.pi/extensions/safety/` or `tests/helpers/`** (grepped `tests/helpers/git.ts` — only `repoRoot`, `isIgnored`, `trackedFiles`). SEAM RISK, see below.
- `canonicalise(command: string): ShellVerdict` — the `unbash` AST path. `.pi/extensions/safety/shell.ts:751`.
- `index.ts` exports `HOOK_AUDIT_EVENT`/`WRAPPER_AUDIT_EVENT`/`APPROVAL_AUDIT_EVENT`/`PROTECTED_BRANCHES`. `.pi/extensions/safety/index.ts:122-140`.

**Which path holds headless — read directly, not inferred:** BOTH the `tool_call` hook (`registerToolCallHook`, `index.ts:639`) and the wrapped tool's own `execute()` (`registerWrappedTools`, `index.ts:386`) run unconditionally, with no `ctx.hasUI` gate anywhere in their block/allow logic — `ctx.hasUI` is checked only inside `approve_ky_command`'s own `execute()` (`index.ts:522`), to decide whether `ctx.ui.select()` can even be attempted. So a straight `block` verdict (protected branch, disallowed command) is enforced identically headless or interactive: the wrapper throws, `isError:true` reaches the model, an audit row is written either way. A `confirm` verdict (needs human approval) is where headless differs: `ctx.ui.select()` is never reached (`hasUI === false`), the approval is refused, and the command **stays blocked** — deny-by-default, not fail-open (SAFE-10). **This means `/quick`'s commit path is safe by construction as long as it goes through the real `git`/`glab` invocation the wrapped `bash` tool executes** — it must never call a git library or `spawnSync` directly.

**The prior finding CONTEXT.md cites ("a guard entirely absent headless") is about EXTENSION LOADING, not this dispatch logic.** `safety/index.ts`'s own docstring (CR-09, `index.ts:771-787`) documents the real failure mode: Pi only auto-discovers a **project-scoped** `.pi/extensions/` copy when the project is trusted, and headless trust resolves `false` with no UI to answer it (`dist/core/project-trust.js#resolveProjectTrusted`). The fix already shipped is **user-scope installation** (`bin/bootstrap.sh` writes a stub at `~/.pi/agent/extensions/` that re-exports this file's default export unconditionally) — SAFE-11. **For any Phase 6 test that drives `/quick` in a headless faux session, the safety extension MUST be loaded the same way Phase 4's own tests load it: at USER scope inside the throwaway `agentDir`**, exactly the pattern `tests/helpers/session.ts` already documents ("The extension under test must load at USER scope … Project-scoped `.pi/extensions` is gated behind project trust", `session.ts:32-35`). This is not a new finding for Phase 6 — it is the existing, already-solved constraint, and the plan must reuse it rather than rediscover it.

### Diagnostics (`diagnostics/call-model.ts`, `prose.ts`, `turns.ts`/`jsonl.ts`/`index.ts`)

- `callModel<TApi>(ctx, opts: CallModelOptions<TApi>): Promise<AssistantMessage>` — the sole chokepoint for a nested completion, mandatory `role` string. `.pi/extensions/diagnostics/call-model.ts:365`. `/quick` only needs this if it dispatches a single-shot role (e.g. a reviewer pass) — likely NOT needed for the walking-skeleton's own `/quick` body, since the executor turn is the session's own prompt loop.
- `isProseToolCall(message, activeToolNames): boolean` — GATE-07's structural counterpart. Four conjunctive gates: `stopReason === "stop"`, no `toolCall` content block, non-empty active-tool list, text matches an anchored pattern. `.pi/extensions/diagnostics/prose.ts:162`. **This detects the model DESCRIBING a call instead of making one — it operates on `message.content`/`stopReason`, never on `tool_result`.** GATE-07 is a different, later check: it verifies a REAL `tool_result` exists and is fresh, which is the complementary half — prose.ts stops a fabricated call from being silently accepted as "the turn is done"; GATE-07 stops a fabricated COMPLETION CLAIM from being accepted without matching evidence.
- `appendJsonl(cwd, base, record, opts?): string` — generic writer, lives at `.pi/lib/jsonl.ts:437`, not diagnostics-owned. **Any caller may append an event row** as long as `base` matches `BASE_RE` (`^[A-Za-z0-9][A-Za-z0-9_-]*$`) and the resolved path stays inside `logDir(cwd)` — confirmed by reading `logPath`/`assertInsideLogDir` (`jsonl.ts:250-281`). `pruneLogs` requires an explicit `ownedBases` list (no default, no shared list — "ownership, not shape", `jsonl.ts:92-103`). **A new evidence-gate stream (e.g. base `"evidence"`) is legitimate and needs no diagnostics import** — it binds to `.pi/lib/jsonl.ts` directly, exactly as `safety/audit.ts` and `routing/index.ts`'s `writeEscalationRecord` already do (`routing/index.ts:215,385-399`).

## Q2 — Where a Pi command lives, and what the ≤80-line budget counts

Pi has **three** distinct ways a slash command comes to exist, verified from Pi's own shipped docs:

1. **`pi.registerCommand(name, options)`** in a TypeScript extension — a real handler function, full `ctx` access. [CITED: `docs/extensions.md:1494-1527`]
2. **A markdown prompt template** under a `prompts/` convention directory (or `pi.prompts` manifest entry) — `/name` expands the file's Markdown body, with `$1`/`$@`/`${1:-default}` substitution, into the **user's own next message**. [CITED: `docs/prompt-templates.md:1-96`]
3. **A skill** (`SKILL.md`) — not command-invoked in the same sense; out of scope here.

`pi.getCommands()` documents that these are genuinely three different sources ("extensions first, then templates, then skills", `docs/extensions.md:1531-1532`).

**Decisive finding: a prompt template CANNOT be `/quick`.** A `.md` prompt template has **zero code execution** — it is text substitution that becomes a message the model then reads and acts on via its own tool calls. It cannot call `planRoleCall`, cannot call `guardRoute`, cannot append a structured evidence record, and cannot compare a captured SHA against HEAD deterministically. Routing that decision through the model (having the model narrate "I checked the route, it's fine") is EXACTLY the transcript-text failure mode GATE-07 exists to reject. **`/quick` must be `pi.registerCommand()`** — this is not a style preference, it follows directly from the requirement that route/guard/evidence decisions be structural, not model-narrated.

This also matches CONTEXT.md's independent reasoning (boundary rule: command = 0 per-turn tokens; `ctx.waitForIdle()`/`ctx.reload()` exist only on `ExtensionCommandContext`, `docs/extensions.md`-cited elsewhere in this repo's own code comments, e.g. `routing/index.ts:71`).

**Recommended placement:** `.pi/extensions/workflows/index.ts` — new subsystem directory, sibling to `diagnostics/`, `routing/`, `safety/`. Keeps `/quick`'s own file auto-discovered (entry-point shape, `tests/unit/extension-layout.test.ts`'s existing rule) and gives Phase 9's `/grill`/`/plan`/`/execute`/`/review` a natural home in the same directory later.

**What "line" should mean, and the registry shape:** No existing test in this repo counts lines of a TypeScript file (`pinning.test.ts`, `contributing-boundary.test.ts`, `docs-policy.test.ts` are all string/regex greps, not line counters) — this is new mechanism, but a small one: `readFileSync(path, "utf-8").split("\n").length`, raw lines (simplest, hardest to game by reformatting, and what the ROADMAP's "≤80 lines" plainly means — it does not say "non-comment"). Recommend the registry be a small committed array of `{file, budget}` in the test file itself (simplest; CONTEXT.md leaves this to discretion), asserting for each entry `lineCount(file) <= budget`, AND separately globbing every `.pi/extensions/workflows/**/index.ts` (or every file matching a "this is a workflow" naming rule) and asserting its path is present in the registry — this is what closes CONTEXT.md decision 5(c), "fail when a workflow file exists the registry does not list." The **known, accepted loophole** (moving logic into an uncounted helper `/quick` alone calls) cannot be closed by a line-count test alone; CONTEXT.md already states this is a judgement call for the plan/reviewer, not a test — do not attempt to invent a "shared vs. private helper" detector; it would be a heuristic with no ground truth, more brittle than the line-count test itself.

## Q3 — How a `tool_result` exit code is observable, and bound to a SHA

From `dist/core/extensions/types.d.ts` (pi-coding-agent 0.84.1):

- `ToolExecutionEndEvent` (`:593-599`): `{type, toolCallId, toolName, result: any, isError: boolean}` — fires on `tool_execution_end`.
- `ToolResultEventBase` (`:691-699`): `{type:"tool_result", toolCallId, input, content: (TextContent|ImageContent)[], isError: boolean, usage?}`. `BashToolResultEvent extends` this with `details: BashToolDetails | undefined`.
- `BashToolDetails` (`dist/core/tools/bash.d.ts:14-17`): `{truncation?, fullOutputPath?}` — **no `exitCode` field.**

Reading `dist/core/tools/bash.js:320-348` directly: on success (`exitCode === 0`), the tool returns `{content:[{type:"text", text: outputText}], details}` with no exit code anywhere. On failure (`exitCode !== 0 && exitCode !== null`), the tool **throws** `new Error(appendStatus(outputText, "Command exited with code ${exitCode}"))` — the exit code is embedded as a TEXT SUFFIX inside the thrown message, which Pi's agent loop turns into `isError: true` on the `ToolResultEvent`/`ToolExecutionEndEvent`.

**Conclusion, stated plainly:** `isError: boolean` on `tool_result`/`tool_execution_end` IS a genuinely structural, Pi-computed field — it is derived by Pi's own bash tool from the real process exit code, not written by the model, and cannot be spoofed by prose in the transcript (the model's `content` blocks are a separate field entirely; `isError` is set by the tool execution machinery, not the assistant message). **This is sufficient for GATE-07's pass/fail question** ("did the command in question exit zero"). The literal numeric exit code, if ever needed, is NOT a separate structured field — recovering it requires parsing the tool's own output text for `"Command exited with code N"`. **This is parsing trusted TOOL output, not model-authored transcript prose — a different, weaker-risk category than what GATE-07's docstring warns against — but the plan should say so explicitly rather than claim "no text parsing anywhere."** For GATE-07's actual requirement (boolean pass/fail bound to a SHA), the plan does not need the numeric code at all — `isError` alone answers it, and needs no text parsing.

**Git SHA:** no reader exists yet. `safety/git.ts` has `currentBranch(cwd)` (`git symbolic-ref --short HEAD`) but nothing that runs `git rev-parse HEAD`. `tests/helpers/git.ts` has `repoRoot`/`isIgnored`/`trackedFiles`, no SHA reader either. **A new small helper is needed**, following the identical `spawnSync(["git", "rev-parse", "HEAD"], {cwd, encoding:"utf-8", shell:false, windowsHide:true})` pattern `currentBranch` already uses (`safety/git.ts:144-158`) — do not invent a second spawn style. This is a genuine gap, not an oversight to route around.

## Q4 — Smallest honest test strategy

| Test | Shape | Reuses | Mutation argument (what goes red if removed) |
|------|-------|--------|------------------------------------------------|
| GATE-07 rejection 1: fabricated prose, no `tool_result` | Unit — build a `ToolResultEvent`-shaped record set with zero entries, feed to the evidence-gate predicate, assert reject | none needed (pure function test) | Removing the "requires a matching tool_result" check makes this pass |
| GATE-07 rejection 2: real `tool_result`, stale SHA | Unit — real `tests/helpers/git.ts` temp repo (`repoRoot`-style scaffold), capture SHA A, make a commit to reach SHA B, assert claim-at-B rejects evidence-from-A | `tests/helpers/git.ts` (extend with a `currentSha`/commit helper if absent) | Removing the SHA-equality check makes stale evidence pass |
| GATE-07 rejection 3: real `tool_result`, non-zero exit | Unit or session-level — feed `isError:true` record, assert reject | `tests/helpers/stub-bin.ts` (stage a failing command) or a plain fixture object | Removing the `isError` check makes a failed command's evidence pass |
| GATE-07 acceptance: structured, exit 0, SHA matches HEAD | Same fixture family, one positive case | same | Confirms the gate isn't fail-closed-always (a gate that always rejects would also "pass" the three negatives) |
| `/quick` traverses Phase 5 routing for real | Session-level — `withFauxSession`-style harness (`tests/helpers/session.ts`), assert a routing refusal (guard-blocked model / no configured auth) produces a `/quick` refusal with the guard's own reason text, not a generic error | `tests/helpers/session.ts`, `tests/helpers/faux.ts` | Deleting the `planRoleCall`/`guardRoute` call and hardcoding "always allow" turns this red — **the router's own refusal wording must appear verbatim in `/quick`'s output**, not merely "a refusal happened", or this has the exact weakness Phase 5's wire-proof test had (structurally indistinguishable from a hardcoded chain head) |
| `/quick` traverses Phase 4 guarding for real | Session-level, USER-SCOPE loaded safety extension (per Q1 headless finding) — point `/quick` at a protected branch, assert the commit is refused with `safety/git.ts`'s own reason text | `tests/helpers/session.ts` (extended to write the safety extension at user scope, mirroring `tests/integration/headless-deny.test.ts`'s pattern) or a real spawned `pi --mode json` child (`tests/helpers/pi.ts`) if the faux session proves insufficient, same fallback Phase 4 itself took | Removing the `git`/`glab` call from `/quick`'s own commit step (i.e. bypassing the wrapped tool) turns this from "refused with guard's reason" to "refused with nothing" or "succeeded" |
| FLOW-11 budget test, including registry completeness | Unit — `readFileSync` + `split("\n").length` against each registry entry; separately glob workflow files and assert every one is a registry key | none (self-contained fs check, no helper needed) | Adding an unlisted 500-line workflow file, or bumping `/quick` past budget, must turn this red; falsify by actually doing both during test-writing, per this repo's own "falsification" convention (e.g. `04-06-SUMMARY.md`'s pattern) |

**On the wire-proof weakness to avoid (Phase 5's finding):** a test that only asserts "a refusal happened" cannot distinguish a real routing/guard decision from a `/quick` implementation that hardcodes "always refuse role X" or "always allow". Every routing/guard test above must assert the **verbatim reason string** produced by `guardRoute`/`pickConfiguredCandidate`/`classifyGitInvocation` appears in `/quick`'s reported output — reading the reason back from the real function, never retyped as a literal in the test (the same discipline `docs/ROUTING.md`'s own converse-assertion test already uses, `05-12` decision).

**Unit vs session-level, summarised:** the evidence-gate predicate itself (SHA compare, `isError` check, presence check) should be a PURE function — unit-testable with plain fixture objects, no session needed, matching this codebase's own house style (`guard.ts`, `git.ts`'s classifier half). Only the "does `/quick` actually call routing and actually call the guarded git path" tests need a session (`withFauxSession` or a spawned `pi` child).

## SEAM RISK Findings

1. **No git-SHA reader exists anywhere in this repo today** (`safety/git.ts` only has `currentBranch`; `tests/helpers/git.ts` only has ignore/tracking helpers). CONTEXT.md's code-context section did not flag this gap — it must be built as part of this phase, following `currentBranch`'s exact `spawnSync` pattern, not assumed to already exist.
2. **`RoutingTestOptions` does not prevent a real-settings write**, contrary to a plausible reading of CONTEXT.md's phrasing ("the existing seam for driving routing from a test without touching the developer's real settings"). The actual, already-shipped fix is the suite-wide `tests/setup/agent-dir.ts` vitest setup file. A plan that tries to pass `RoutingTestOptions.agentOverridesFor` as if it were a settings-path override would be solving a problem that is already solved elsewhere, and would not actually protect against writing to `~/.pi/agent/settings.json` on its own.
3. **No file in this repo counts lines of a TypeScript workflow file today.** `tests/unit/pinning.test.ts`, `contributing-boundary.test.ts`, `docs-policy.test.ts` are all string/regex assertions. FLOW-11's mechanism is new, small (one `readFileSync`+`split`), and has no existing pattern to copy beyond the general "assert against a registry, assert converse-completeness" style `docs/ROUTING.md`'s own test already established.
4. **`runSingleShotRole` cannot serve the `executor` role** (throws by design). If a plan assumes `/quick` dispatches its own work turn through `runSingleShotRole`, that assumption is wrong — the work turn is the ordinary session prompt loop against whatever model `/cheap`/`/balanced`/`/max` already selected. `/quick`'s use of `routing/` is for confirming/asserting the currently-configured route is valid (e.g. via `planRoleCall`/`guardRoute` as a pre-flight check), not for making a second nested call.

No seam was found to be genuinely disconnected — every composed piece (routing pure functions, safety wrapped-tool enforcement, `appendJsonl`) is directly callable from a new command module with no missing export and no undocumented precondition, aside from the three gaps above.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 (already configured, `vitest.config.ts`) |
| Config file | `vitest.config.ts` (setupFiles already includes `tests/setup/agent-dir.ts`) |
| Quick run command | `npx vitest run tests/unit/<new-file>.test.ts` |
| Full suite command | `npx vitest run` (already CI's mechanism, `.github/workflows/ci.yml:181`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLOW-01 | `/quick` ≤80 lines (100 hard fail), routes+guards+logs for real | session-level | `npx vitest run tests/integration/quick-workflow.test.ts -t "quick"` | ❌ Wave 0 |
| FLOW-11 | Workflow line-budget registry, complete and enforced | unit | `npx vitest run tests/unit/workflow-budgets.test.ts` | ❌ Wave 0 |
| GATE-07 | Reject fabricated/stale/failed evidence; accept fresh+passing | unit (predicate) + session (integration) | `npx vitest run tests/unit/evidence-gate.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `npx vitest run <file>`
- **Per wave merge:** `npx vitest run` (full suite) + `npx tsc --noEmit`
- **Phase gate:** full suite green before `/gsd:verify-work`, same as Phases 1–5

### Wave 0 Gaps
- [ ] `tests/unit/workflow-budgets.test.ts` — FLOW-11, no prior art beyond the general registry-completeness pattern
- [ ] `tests/unit/evidence-gate.test.ts` — GATE-07's pure predicate (3 rejections + 1 acceptance)
- [ ] `tests/integration/quick-workflow.test.ts` — FLOW-01 end-to-end, needs safety extension loaded at USER scope inside the session helper (extend `tests/helpers/session.ts` or reuse `tests/integration/headless-deny.test.ts`'s spawned-`pi` pattern if faux proves insufficient)
- [ ] A `currentSha(cwd)` helper — either added to `.pi/extensions/safety/git.ts` (production code, if `/quick` needs it at runtime) and/or `tests/helpers/git.ts` (if only tests need it) — **decide which in the plan**, since GATE-07's production evidence-capture path needs a SHA reader regardless of test needs

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `.pi/extensions/workflows/` is the right new directory name (vs. e.g. `workflow/` singular, or nesting under `diagnostics/`) | Q2 | Low — cosmetic, easy to rename before commit; no test currently hardcodes the name |
| A2 | Raw line count (not non-blank/non-comment) is what "≤80 lines" means | Q2 | Low-medium — if the plan later wants a stricter non-comment count, the registry mechanism still works, only the counting function changes |
| A3 | `/quick`'s own work turn is the session's ordinary prompt loop, not a nested `runSingleShotRole`/`callModel` call | Q1 | Medium — if wrong, the plan would need to route `/quick`'s actual work through the diagnostics chokepoint differently; verify against `ROLE_MECHANISM`'s executor entry when planning |

**Confirmed, not assumed:** the `runSingleShotRole` executor restriction, the `isError` structural field, the `RoutingTestOptions` scope, the missing SHA reader, and the prompt-template-vs-command distinction were all read directly from source, not inferred.

## Open Questions

1. **Does `/quick` need a nested `callModel` call at all, or does it end with the ordinary agent turn?**
   - What we know: `runSingleShotRole` cannot serve `executor`; the four single-shot roles are reviewer/advisor/vision/summariser.
   - What's unclear: whether the walking-skeleton's own definition of "trivial task, prompt to atomic commit" implies `/quick` itself prompts the model (needing no nested call — the surrounding session already has a prompt loop) or merely sets up state and lets the user's next message do the work.
   - Recommendation: the plan should state explicitly which of these `/quick` is, since it changes whether `callModel`/diagnostics logging is even reached by this command directly.

## Sources

### Primary (HIGH confidence — read directly)
- `.pi/extensions/routing/{modes,guard,index,agent-overrides}.ts` — full read, this session
- `.pi/extensions/safety/{git,shell,index}.ts` — full read, this session
- `.pi/extensions/diagnostics/{call-model,prose,index}.ts`, `.pi/lib/jsonl.ts` — full read, this session
- `tests/helpers/{git,faux,session}.ts`, `tests/setup/agent-dir.ts`, `tests/integration/{headless-deny,mode-switch}.test.ts` — full/partial read, this session
- `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\docs\{extensions,packages,prompt-templates}.md` — read directly
- `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\core\extensions\types.d.ts`, `dist\core\tools\bash.{d.ts,js}` — read directly
- `.planning/{CONTEXT.md → 06-CONTEXT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md}`, `CLAUDE.md`, `package.json`, `.github/workflows/ci.yml` — read directly

### Secondary / Tertiary
None used — no web search per phase scope; all claims verified at source.

## Metadata

**Confidence breakdown:**
- Seam APIs (Q1): HIGH — every signature cited with `file:line`, cross-checked against callers already using them
- Command mechanics (Q2): HIGH — decisive finding (prompt templates cannot execute code) is a structural fact of Pi's own docs, not a judgement call
- Evidence-gate mechanics (Q3): HIGH — `isError` field and the text-embedded exit code were both confirmed by reading `bash.js`'s actual return/throw statements
- Test strategy (Q4): MEDIUM-HIGH — the shapes are derived from this repo's own established patterns (mutation-argument discipline, wire-proof weakness precedent); the exact session-vs-spawned-process choice for the safety-traversal test may need a fallback decision during planning, same as Phase 4 needed

**Research date:** 2026-08-14
**Valid until:** Next Pi version bump (this repo pins 0.84.1 exactly) or when Phase 6 plans are written, whichever comes first — no external dependency drift expected inside a single phase.
