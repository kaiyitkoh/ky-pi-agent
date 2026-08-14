# Phase 6: Walking Skeleton — `/quick` & the Evidence Gate - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

The full plumbing path — route → guard → execute → evidence → commit — runs end to end at the smallest possible size, **before** any ceremonial workflow is built on top of it.

**Requirements:** FLOW-01, FLOW-11, GATE-07

**Depends on:** Phase 4 (safety guard), Phase 5 (routing). In practice it also consumes Phase 2 (`callModel()`, the per-turn JSONL, the prose-tool-call detector) and Phase 3 (`callWithFallback`), because "logged by Phase 2" is in the success criterion.

**Success criteria (from ROADMAP.md, binding — this is the spec):**

1. `/quick` takes a trivial task from prompt to atomic commit — routed by Phase 5, guarded by Phase 4, logged by Phase 2 — in **≤80 lines**; if it exceeds 100 it has FAILED. This is a hard number, not an aspiration.
2. A completion claim is **rejected** unless a `tool_result` exit code bound to the **current git SHA** supports it. Prose in the transcript that merely *looks like* command output does not pass — which matters precisely because the model that writes prose tool calls (Phase 2's `prose_tool_call` detector exists for this) can also write plausible command output. The gate must key on structured tool results and a SHA, never on transcript text.
3. **CI fails the build** when any workflow file exceeds its line budget — the budget exists *before* the cathedral is built, not after. This is the mechanism that protects Phase 9 from itself.

**Contains [RUNBOOK] requirements: NONE.** All three requirements are verifiable offline on this machine. FLOW-01 and FLOW-11 carry no tag; GATE-07 carries `[FAUX]` and must be planned as *passing* with `fauxProvider` + `SessionManager.inMemory()`, not as outstanding. **If planning finds itself wanting to defer something to `docs/RUNBOOK.md`, that is a signal the wrong thing is being built.** Do not append an `RB-06-xx` section; `tests/unit/docs-policy.test.ts` need not change.

</domain>

<decisions>
## Implementation Decisions

Recorded in PROJECT.md (Key Decisions, Constraints), ROADMAP.md, CONTRIBUTING.md and `.planning/research/{ARCHITECTURE,PITFALLS,STACK,SUMMARY}.md`. Binding on this phase; not to be re-derived and not to be re-litigated.

**Already decided, binding:**

1. **This is a WALKING SKELETON, and its value is proving the seams actually connect.** Prefer exercising the real Phase 2/4/5 components over mocking them. If a seam does not connect, **that is the finding — report it, do not paper over it with a shim.** A `/quick` that passes its tests by re-implementing routing or re-implementing the guard has proved nothing and has failed the phase.

2. **`/quick` is a COMMAND, not a tool, not a skill.** The boundary rule in `CONTRIBUTING.md`/PROJECT.md: a new capability defaults to COMMAND (**0 per-turn tokens** — commands are never rendered into the system prompt) or SKILL (~40–60 tok index); registering a TOOL requires justifying its per-request schema cost. Phase 1's `harness/index.ts` already dogfoods this and Plan 01-09's test greps `.pi/extensions/**` for tool registration and fails the build if it appears. `/quick` must not become the exception. This also matches Phase 5's finding that `ctx.waitForIdle()`, `ctx.newSession()`, `ctx.fork()` and `ctx.reload()` exist **only on `ExtensionCommandContext`**.

3. **The ≤80-line budget is the whole point of the phase, not an aesthetic preference.** The comparative research found GSD's own no-ceremony `quick.md` is **1,169 lines (~15k tokens)**. A no-ceremony path that costs 15k tokens to load is self-refuting. Do not let `/quick` grow and then rationalise the budget; do not move logic into an uncounted helper file purely to duck the count. If shared machinery genuinely belongs in a subsystem module, it belongs there because it is shared — and the line-budget test must then be written so that trick does not silently defeat it.

4. **FLOW-11's budget is enforced by a test in the vitest suite, because that is already the CI failure mechanism.** `.github/workflows/ci.yml` runs `npx vitest run` on `windows-latest` and `macos-latest`, plus `npx tsc --noEmit`. `tests/unit/pinning.test.ts`, `tests/unit/contributing-boundary.test.ts` and `tests/unit/docs-policy.test.ts` are the worked examples of a policy assertion that fails the build. Do not invent a second CI mechanism, a new workflow job or a shell linter for this.

5. **The budget must be a registry, not a single hardcoded number.** FLOW-11 says *"every workflow has a CI-enforced line budget"* and the ROADMAP calls it "the mechanism that protects Phase 9 from itself" — Phase 9 adds `/grill`, `/plan`, `/execute`, `/review`. The registry must therefore (a) name each workflow file and its budget, (b) fail when a listed file exceeds its budget, and (c) fail when a workflow file exists that the registry does not list — otherwise Phase 9 adds a 1,169-line workflow the test never looks at, which is the exact failure being guarded against.

6. **GATE-07 keys on structured `tool_result` data plus a git SHA — never on transcript text.** This is a direct consequence of Phase 2's `prose_tool_call` detector (`.pi/extensions/diagnostics/prose.ts`): a model that emits tool calls as prose can equally emit plausible command output as prose. Therefore: the evidence record is built from the `tool_execution_end`/`tool_result` path (exit code, structured), and it is **bound to the SHA that was HEAD when the command ran**. Evidence collected against SHA `A` must not satisfy a completion claim made at SHA `B` — a stale-SHA claim is a rejected claim.

7. **The guard is Phase 4's, unchanged, and it must hold headless.** Phase 4's code review found *a guard that was entirely absent headless*. `/quick` commits, and committing runs `git`, which is precisely what `safety/git.ts` classifies (`classifyGitInvocation`, `PROTECTED_BRANCHES = ["main","master"]`). `/quick` must go through the real guard path; it must not shell out to `git` around it.

8. **`safety/` imports nothing from routing and gains no routing import — the direction is by design.** ARCHITECTURE's dependency table keeps `safety/` source-reviewable in isolation because it sits in the credential/exec path. Phase 5's context states it explicitly: *"routing does not import safety either; the two subsystems meet only in Phase 6's `/quick`."* **Phase 6 is that meeting point, and the meeting happens in `/quick`, not by adding a cross-import to either subsystem.** For cross-subsystem signalling use `pi.events.on/emit` rather than an import.

9. **Routing goes through Phase 5's existing API; the chokepoint lint stays green.** `tests/unit/chokepoint-lint.test.ts` fails the build on `modelRegistry.complete` outside `diagnostics/` (DIAG-02). `/quick` routes via `routing/modes.ts` (`resolveRoute`, `planRoleCall`, `runSingleShotRole`) and, where a model call is needed, via `diagnostics/call-model.ts` `callModel()`. It never calls `complete()` itself and never widens `CallModelOptions`.

10. **Be suspicious of green.** Phase 4's review needed six iterations and found 11 blockers; Phase 5's found the test suite writing into the developer's **real `~/.pi/agent/settings.json`** and a wire-proof test that structurally could not distinguish a routing decision from a hardcoded chain head. Every test written here must be shown to FAIL if its subject is removed, and no test may write outside the repo or a temp dir.

**Claude's discretion (guided by ROADMAP criteria + `.planning/research/`):**
Where `/quick` lives on disk (a `.pi/extensions/workflows/` module registering the command, versus a prompt/markdown workflow file) and hence what exactly the line budget counts; whether the evidence gate is a module under a new `workflows/` directory or lives beside `diagnostics/`; the shape of the evidence record (in-memory map, `pi.appendEntry` custom entry, or a gitignored JSONL under `.pi/logs/`) provided it is structured and SHA-bound; how the rejection is surfaced (thrown, returned verdict, `ctx.ui.notify`); the exact budget numbers for not-yet-written Phase 9 workflows in the registry; whether the registry lives in the test file or a committed data file; and the wording of any `docs/` note.

**Decisions taken autonomously during context generation** (per the Standing Operating Policy — the user is asleep; noted here rather than asked):
- Phase slug is `06-walking-skeleton-quick-evidence-gate`, following Phases 3–5's convention of dropping `&` and punctuation from the phase title.
- "≤80 lines / failed above 100" is read as: the budget the test enforces is **80**, and 100 is the hard failure ceiling the ROADMAP names. Planning targets 80; the test enforces 80.

</decisions>

<code_context>
## Existing Code Insights

Phases 1–5 created everything this phase composes. **Do not re-create any of it — composing it is the entire deliverable.** 1,376 tests green, `tsc --noEmit` clean, `.pi/extensions/` holds 6 subsystem directories (`diagnostics`, `harness`, `providers`, `qoder`, `routing`, `safety`). Every item below is a concrete export, verified by reading the file — not an assumption. **Read the real signatures before planning against them.**

**Phase 5 — `.pi/extensions/routing/` (5 files: `index.ts`, `modes.ts`, `guard.ts`, `agent-overrides.ts`, `schema.ts`).**
- `modes.ts` exports `getModeState()`, `setMode()`, `setEscalated()`, `resolveRoute(role, state)`, `pickConfiguredCandidate(registry, candidates)`, `usesToolLoop(role)`, `usesFallbackChain(ref)`, `planRoleCall(registry, opts)` → `PlanResult`, and `runSingleShotRole(ctx, opts)` → `Promise<AssistantMessage>`. Types: `ModeState`, `RoleNeed`, `CandidateResult`, `ModelRegistryLike`.
- `guard.ts` exports `guardRoute(model, role, need)` → `GuardVerdict` (`{ok:true} | {ok:false, reason}`), `isAnthropicClaudeModel(model)`, `NO_TOOL_CALLING_MODEL_IDS`, and the `GuardNeed` interface.
- `index.ts` exports `restoreModeFromBranch(branch)` and `RoutingTestOptions` — the latter is the existing seam for driving routing from a test without touching the developer's real settings. **Use it; do not invent a second seam and do not let a test write to `~/.pi/`.**
- Existing tests to extend rather than duplicate: `tests/unit/routing-map.test.ts`, `routing-dispatch.test.ts`, `capability-guard.test.ts`, `agent-overrides.test.ts`, `r1-unclamp.test.ts`, `model-metadata.test.ts`.

**Phase 4 — `.pi/extensions/safety/` (9 files).**
- `git.ts` exports `classifyGitInvocation(invocation, facts)` → `GitVerdict` (`{kind:"allow"} | {kind:"block", reason}`), `classifyGlabInvocation()`, `classifyPushFailure(stderr)`, `currentBranch(cwd)`, `DETACHED_HEAD`, `GIT_WRITE_SUBCOMMANDS`, `GIT_READ_SUBCOMMANDS`, and the `GitInvocation`/`GitPolicyFacts` types. **`currentBranch(cwd)` is also the natural place to look for how the phase already reads git state.**
- `shell.ts` exports `canonicalise(command)` → `ShellVerdict`, `normaliseExecutable()`, `DENIED_PART_TYPES`, `HEREDOC_OPERATORS`, `GUARDED_VERB_PATTERN`, `SHELL_RUNNERS`, `SHELL_REFUSAL_CAUSES`, `CanonicalInvocation`. This is the `unbash` AST path — string matching is explicitly forbidden.
- `index.ts` exports `APPROVE_TOOL_NAME`, `HOOK_AUDIT_EVENT`, `WRAPPER_AUDIT_EVENT`, `APPROVAL_AUDIT_EVENT`, `PROTECTED_BRANCHES`. The three audit-event constants are the hook-vs-wrapper duality Phase 4's review produced — **the wrapper is what holds headless**; read `index.ts` before assuming which path a headless `/quick` traverses.
- Existing tests: `git-policy.test.ts`, `shell-parse.test.ts`, `shell-deny-list.test.ts`, `evasion-corpus.test.ts`, `approvals.test.ts`, `policy-compose.test.ts`, `infra-policy.test.ts`, `path-policy.test.ts`, `safety-entry.test.ts`, `audit-jsonl.test.ts`.

**Phase 2 — `.pi/extensions/diagnostics/` (9 files) is the contract this phase logs through.**
- `call-model.ts` exports `callModel<TApi>(ctx, opts)` + `CallModelOptions<TApi>`. Its docstring declares itself a **CROSS-PHASE CONTRACT**. Plan against the existing signature; **do not widen it.**
- `prose.ts` is the `prose_tool_call` detector — the direct justification for GATE-07's "never on transcript text". Read it; the evidence gate is its structural counterpart.
- `turns.ts` exports `composeTurnRow(input)`, `outcomeFor(stopReason)`, `cacheReadRatio(usage)`, `TurnRowInput`. `index.ts` exports `rowsWrittenThisSession()`, `noteRowWritten()`, `safeHandler()` and the event/where constants. `jsonl.ts`/`schema.ts`/`wire.ts`/`redact.ts`/`budget.ts` complete the machinery. `.pi/lib/jsonl.ts` is the shared append helper; `.pi/logs/` is gitignored.
- `tests/unit/chokepoint-lint.test.ts` fails the build on `modelRegistry.complete` outside `diagnostics/`. `call-model-containment.test.ts` and `wire-nonmutating.test.ts` are the worked examples for asserting on a nested call.

**Phase 3 — `.pi/extensions/providers/`**: `fallback.ts` exports `callWithFallback(...)`, `CallWithFallbackOptions`, `classifyFailure(errorText)`. `.pi/templates/models-template.json` defines the `dashscope` provider with `deepseek-v4-flash`/`deepseek-v4-pro`, both `"input": ["text"]`.

**Test helpers already available — reuse, do not rewrite:** `tests/helpers/{faux.ts, session.ts, models.ts, pi.ts, logs.ts, git.ts, stub-bin.ts, win-quote.ts, loopback.ts, qoder-loopback.ts, bootstrap-repo.ts}`. For this phase the load-bearing three are **`git.ts`** (temp-repo scaffolding — a real SHA to bind evidence to), **`faux.ts`** (`fauxProvider`, asserts on the *outgoing* request) and **`session.ts`** (`SessionManager.inMemory()`). `stub-bin.ts` builds PATH stubs, which is how a fabricated-output scenario can be staged without a real command ever running.

**CI — `.github/workflows/ci.yml`** has two jobs: `posix-lint` (ubuntu, ShellCheck + pin-audit) and `test` on a `windows-latest`/`macos-latest` matrix running `npm ci --ignore-scripts`, `npx vitest run`, `sh -n bin/bootstrap.sh`, `sh bin/bootstrap.sh --check-only`, `scripts/check-gh-unauthenticated.sh --warn-only`, `npx tsc --noEmit`. **A failing vitest test is already a failing build on both platforms** — that is FLOW-11's enforcement point.

**Packaging.** `package.json` `pi` manifest points at `./.pi/extensions`, `./.pi/skills`, `./.pi/prompts`, `./.pi/themes`. `.pi/prompts/` and `.pi/skills/` currently exist but are **empty** — if `/quick` is authored as a prompt file, that is where it lands and the line-budget test must find it there. `.pi/agents/` is also empty (Phase 7 fills it). No build step: jiti loads `.ts` directly; a build breaks `/reload`.

**Docs.** `docs/` holds `DIAGNOSTICS.md`, `ROUTING.md`, `SAFETY.md`, `RUNBOOK.md`. A `docs/WORKFLOWS.md` is the convention-consistent home for the budget registry's rationale, if one is wanted.

**Pi's own bundled examples and published TypeScript take precedence over any extension README** (`%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\`). Original TypeScript for anything in `dist/` is recoverable from `dist/**/*.js.map` `sourcesContent`. Cite `file:line`; mark anything unverifiable as **UNVERIFIED** rather than asserting it.

</code_context>

<specifics>
## Specific Ideas

- **The single most likely way this phase fails is a `/quick` that "passes" without touching Phase 4 or Phase 5 at all.** A test that asserts `/quick` produced a commit proves nothing about the seams. The tests that matter are the ones that *break the seam and watch `/quick` refuse*: point `/quick` at a protected branch and see Phase 4 block the commit; ask for a route Phase 5's guard refuses and see `/quick` stop with that reason; remove the routing call and see the routing assertion fail.
- **GATE-07 needs a genuinely adversarial negative test, not a happy path with an inverted assertion.** Three distinct rejections, each of which must be shown to fail if the gate is removed:
  1. **Fabricated prose**: a transcript containing text that looks exactly like a passing command run (`$ npm test` … `exit 0`) with **no** corresponding `tool_result` → rejected.
  2. **Stale SHA**: a real, structured `tool_result` with exit code 0 captured at SHA `A`, then a commit moves HEAD to SHA `B`, and the claim is made at `B` → rejected. This is the clause that stops "I ran the tests" surviving a subsequent edit.
  3. **Non-zero exit**: a real structured `tool_result` at the current SHA with a non-zero exit code → rejected.
  And exactly one acceptance: structured result, exit 0, SHA matches HEAD → accepted.
- **Bind to the SHA the evidence was produced under, and compare against HEAD at claim time.** `tests/helpers/git.ts` gives a real temp repo, so this is testable with real `git rev-parse` output rather than a stubbed string. A gate whose SHA is a fixture constant cannot distinguish "bound correctly" from "bound to nothing".
- **The line-budget test must count what actually ships, and must not be defeatable by moving lines.** Two failure modes to design against: (a) a workflow file that grows and is silently un-listed in the registry; (b) `/quick` shrinking to 70 lines because 400 lines moved into a helper that only `/quick` calls. The registry-completeness assertion in decision 5 handles (a); (b) is a judgement call that the plan should state explicitly rather than leave to review.
- **Do not re-enable UI gates.** `workflow.ui_phase` and `ui_safety_gate` are `false` deliberately; this phase has no UI surface. Phase 11 owns the terminal UI, Phase 9 owns the ceremonial workflows.
- **`/quick` is not `/gsd:quick`.** The harness's `/quick` is a Pi command inside this repo's `.pi/`; GSD's is a Claude Code skill. They are named the same and are unrelated. Do not wire one to the other, and do not let the 1,169-line GSD `quick.md` be read as prior art to imitate — it is the counterexample the budget exists to prevent.
- **"Atomic commit" means one commit for the trivial task, produced through the guarded path.** Phase 1's supply-chain posture and Phase 4's git policy both already apply; `/quick` adds no new git capability, it composes the existing one.
- **Nothing here needs credentials or network.** `fauxProvider` serves the model side, `tests/helpers/git.ts` serves the git side, `stub-bin.ts` serves the exec side. If a plan reaches for a real provider or a live network call, the plan is wrong.

</specifics>

<deferred>
## Deferred Ideas

- The ceremonial workflows themselves — `/grill`, `/plan`, `/execute`, `/review`, SPEC/PLAN/REVIEW artifacts, the ambiguity scorecard, MR-to-staging — **Phase 9**. Phase 6 writes the budget they will be measured against; it does not write them.
- Installing and pinning the commodity extensions (`pi-subagents`, plan mode, todos, LSP, web, checkpointing) — **Phase 7**, where every pin is re-verified at planning time.
- Quality gates, the non-rubber-stamping reviewer, seeded-defect calibration (GATE-08), advisor escalation (GATE-09), per-role thinking budgets (GATE-10) and the deterministic anti-pattern rules (QUAL-01/02) — **Phase 8**. Phase 6 builds only GATE-07, the evidence gate.
- Per-turn context budget, `pi.setActiveTools()` progressive disclosure, `AGENTS.md` token budget (CTX-01..06) — **Phase 10**. Do not tune token cost here beyond honouring the ≤80-line budget.
- Statusline, header, subagent widget, theme (UI-01..05) — **Phase 11**.
- Qoder as a delegate tool is already built (Phase 5, `.pi/extensions/qoder/`); `/quick` does not route to it and must not. It is a foreign agent that bypasses the harness's tools, safety hooks and wire inspector.
- Any live-credential check. This phase has **no [RUNBOOK] requirements** — see the Phase Boundary section.

</deferred>
