---
phase: 04-safety-deployment-guardrails
plan: 08
subsystem: safety
tags: [tool_call-hook, wrapped-tools, approval-protocol, deny-by-default, double-enforcement, typebox, StringEnum, jiti]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: "evaluate()/Verdict/PolicyFacts from policy.ts and createPending/validate/approve/consume/APPROVAL_TTL_MS from approvals.ts (Plan 07); writeAuditRow/pruneAuditLogs from audit.ts (Plan 02); currentBranch from git.ts (Plan 05)"
provides:
  - ".pi/extensions/safety/index.ts: the entry point wiring evaluate() into Pi TWICE -- the tool_call hook (UX/early rejection) and each wrapped bash/read/write/edit tool's own execute() (the actual last checkpoint, re-evaluating whatever params reach execution)"
  - "approve_ky_command: the one registered tool that is not a wrapper -- block -> approval-tool -> re-issue, byte-for-byte validate(), approve only on an explicit ctx.ui.select() affirmative, never an inline confirm()"
  - "classifyAtWrapper()/wrapperOutcome(): the shared classify/act split that gives every call path (allow, confirm, block, exception-converted-to-block) exactly one audit row"
  - "tests/unit/safety-entry.test.ts: registration-shape proof (exact tool/hook sets, source-order guarantee, no ctx.ui.confirm(, exactly one ctx.ui.select()"
  - "tests/integration/double-enforcement.test.ts: the SAFE-09 mutated-event.input proof against a real faux session, with the audit log's allow+block pair as the observable signature"
  - "TOOL_REGISTRATION_ALLOWLIST entry in tests/unit/contributing-boundary.test.ts with the (a)/(b)/(c) justification and the measured 275-token schema cost"
affects: [04-09, 04-10, 04-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "classify/act split: classifyAtWrapper() never throws (a classification bug converts to a block Verdict, mirroring policy.ts#evaluate's own contract), so the CALLER's single allow/confirm/block dispatch writes exactly one audit row per call, including the exception path -- no separate exception-audit call site to keep in sync with the normal one"
    - "spread-override wrapping of Pi's own createBashTool/createReadTool/createWriteTool/createEditTool factories, delegate called with exactly 4 args (no ctx) matching AgentTool.execute's own declared type at pi-agent-core/dist/types.d.ts:348, confirmed compatible by reading wrapToolDefinition's runtime adapter (ctx ?? ctxFactory?.() degrades to undefined harmlessly)"
    - "tool registrations precede hook registration in literal source order, both as a runtime property (first-registration-wins across extensions) and as a textually-asserted guarantee (tests/unit/safety-entry.test.ts parses index.ts's own source for registerWrappedTools/registerApprovalTool/registerToolCallHook call positions)"
    - "within-extension second-handler mutation as the load-order-fidelity fallback the plan itself pre-authorized: createFauxSession accepts one user-scope entry point, so the double-enforcement test's mutation cases load an inline extension that calls the real safety default export then registers a second pi.on(\"tool_call\", ...) handler -- verified against Pi's own emitToolCall loop (runner.js:701-719), which treats every extension's own handler list through the identical accumulating-mutation loop, so the mechanism under test is identical whether the two handlers live in one extension or two"

key-files:
  created:
    - .pi/extensions/safety/index.ts
    - tests/unit/safety-entry.test.ts
    - tests/integration/double-enforcement.test.ts
  modified:
    - tests/unit/contributing-boundary.test.ts

key-decisions:
  - "The delegate call to each wrapped built-in tool's own execute() omits ctx (4 arguments, not 5). AgentTool.execute's declared type at pi-agent-core/dist/types.d.ts:348 carries no 5th ctx parameter; the runtime adapter (tool-definition-wrapper.ts's wrapToolDefinition) treats a missing ctx as undefined and every closure this file wraps (bash's resolveSpawnContext, read/write/edit's own cwd-closure path resolution) degrades gracefully without it. This compiled cleanly under tsc --noEmit and RESEARCH.md's own reference example (which does pass a 5th ctx argument) was not followed literally for this reason."
  - "classifyAtWrapper() and wrapperOutcome() are split rather than combined into one guarded() wrapper, specifically to avoid a double-audit-row / double-wrapped-error-message bug: an earlier draft wrapped the ENTIRE allow/confirm/block dispatch (including the deliberate block-and-throw) inside one generic exception-containment function, which meant the deliberate throw for a block verdict was ALSO caught by the same containment, producing two audit rows and a confusingly re-wrapped error message for every single block. Splitting classification (never throws, returns a Verdict) from action (writes exactly one row, then returns or throws) removes the double-write entirely."
  - "PROTECTED_BRANCHES defaults to [\"main\", \"master\"], compared case-insensitively by git.ts#isProtected. KUBECONFIG is read directly from process.env in buildFacts() -- the one place this file touches the impure environment, matching policy.ts's own purity contract (it never reads env itself)."
  - "approve_ky_command's blast_radius field uses StringEnum([\"low\",\"medium\",\"high\"]) from @earendil-works/pi-ai rather than Type.Union/Type.Literal, per CLAUDE.md's 'What NOT to Use' (Type.Union/Type.Literal for string enums does not work against Google's API)."
  - "The schema token cost for approve_ky_command was MEASURED, not estimated: serialised as {type:\"function\",function:{name,description,parameters}} (the exact shape openai-completions.ts:1337-1372 sends), it is 1099 bytes -> 275 tokens via this project's own chars/4 estimator (diagnostics/budget.ts:223-224). Recorded in both the TOOL_REGISTRATION_ALLOWLIST comment and this SUMMARY, per CONTRIBUTING.md's boundary rule (b)."
  - "The double-enforcement test's fixtures are path-based (cat terraform.tfstate blocked via SAFE-06's tfstate rule; echo benign-a/echo benign-b allowed), never git-branch-based -- withFauxSession's cwd is a fresh, non-git temp directory, and a HEAD==main fixture would need this file to git init and commit before every case for no benefit, since the plan's own Case 1 alternative already names a no-git-fixture-needed blocked command."

requirements-completed: [SAFE-09, SAFE-10, SAFE-14]

# Metrics
duration: ~50min
completed: 2026-08-14
---

# Phase 4 Plan 8: Wiring the Guard — Hook, Wrapped Tools, and the Approval Protocol Summary

**`.pi/extensions/safety/index.ts` wires `policy.ts#evaluate` into Pi at two independent enforcement points — the `tool_call` hook and each wrapped `bash`/`read`/`write`/`edit` tool's own `execute()` — and registers `approve_ky_command` as the sole non-wrapper tool implementing block → approval-tool → re-issue; `tests/integration/double-enforcement.test.ts` proves the second layer survives a later handler mutating `event.input.command` after the hook already allowed it, with the audit log's allow+block pair as the observable evidence, mutation-verified by actually neutering each enforcement point and watching the right tests go red.**

## Performance

- **Duration:** ~50 min (including the research phase reading Pi's own `.d.ts`/`.js` sources before the first commit)
- **Started:** 2026-08-13T21:15:00Z (approx, from first file read)
- **Completed:** 2026-08-13T21:44:36Z
- **Tasks:** 2 completed
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `.pi/extensions/safety/index.ts` registers the four wrapped built-in tools FIRST (before any hook, citing `runner.js:280-291`'s first-registration-wins semantics), then `approve_ky_command`, then the `tool_call` hook — `tests/unit/safety-entry.test.ts` pins both the runtime registration order and the literal source-text order of the three registration calls.
- Both enforcement points share one classification function, `classifyAtWrapper()`, which never throws — a bug anywhere in this file's own classification path (not `evaluate()` itself, which already converts a classifier exception to a block per its own contract) converts to a `block` Verdict, and the CALLER (the hook, or `wrapperOutcome()`) does the single allow/confirm/block dispatch and writes exactly one audit row per call, including the exception path. This design was arrived at after an earlier draft produced a double-audit-row bug wrapping the deliberate block-and-throw inside the same generic exception containment as the classification step; splitting classify (returns) from act (writes-then-throws) removed it.
- `approve_ky_command`'s `execute()` validates `request_id`/`command`/`reason` byte-for-byte via `approvals.ts#validate`, then approves ONLY on an explicit `"Approve"` selection from `ctx.ui.select()` — written as "approve only on an explicit affirmative", never "refuse only when the UI said no". `undefined` (the headless `noOpUIContext` value) and `hasUI === false` both refuse through the same branch. No `ctx.ui.confirm(` appears anywhere in the file (asserted by both a grep-shaped acceptance criterion and a comment-stripped test).
- The wrapped-tool delegate calls (`bashTool.execute(toolCallId, params, signal, onUpdate)`) deliberately omit `ctx` — `AgentTool.execute`'s own declared type (`pi-agent-core/dist/types.d.ts:348`) carries exactly 4 parameters, and the runtime adapter (`tool-definition-wrapper.ts`) degrades a missing `ctx` to `undefined` harmlessly for every one of the four tools. This compiled cleanly under `tsc --noEmit` on the first attempt.
- `tests/integration/double-enforcement.test.ts` drives three real faux sessions (never a stub): Case 1 proves the hook alone catches `cat terraform.tfstate` (no git fixture needed — SAFE-06's path classifier blocks it directly); Case 2 registers a second `tool_call` handler inside the SAME extension (the plan's own pre-authorized fallback for `createFauxSession`'s one-entry-point limit) that mutates a hook-allowed `echo benign-a` into the blocked command, and proves the wrapped tool's own re-evaluation still stops it, with the audit log carrying BOTH an allow row (hook's view of the original) and a block row (wrapper's view of the mutated command); Case 3 is the negative control — the same mutation mechanism targeting a second benign command executes normally, proving Case 2 is not "the wrapper blocks everything".
- Every audit assertion in the integration test asserts the log is non-empty BEFORE asserting on its contents (the plan-mandated vacuity guard).
- Mutation-tested by actually breaking the subject and restoring, twice: (1) neutering `wrapperOutcome()` to a no-op turned Cases 2 and 3 red (Case 1 stayed green, as expected — it depends only on the hook); (2) neutering `classifyAtWrapper()` to always return `allow` turned Case 1, Case 2, AND `safety-entry.test.ts`'s malformed-input test all red, while Case 3 stayed green. The file was restored byte-identical (`diff` empty) after each round, confirmed by `tsc --noEmit` and a full green re-run.
- `TOOL_REGISTRATION_ALLOWLIST` in `tests/unit/contributing-boundary.test.ts` gained `.pi/extensions/safety/index.ts` with the (a)/(b)/(c) justification written inline: (a) the model must call `approve_ky_command` mid-turn as the resumption step of a blocked `tool_call`, never a user-initiated action; (b) the MEASURED schema cost (1099 bytes → 275 tokens via `diagnostics/budget.ts`'s own `chars/4` estimator, with the four wrapped tools costing zero net since Pi already ships them); (c) a skill cannot carry a byte-for-byte, server-validated, one-shot-grant protocol.

## Task Commits

1. **Task 1: safety/index.ts — the hook, the wrapped tools, and the approval tool** - `28f6271` (feat)
2. **Task 2: Prove the double enforcement against a mutated event.input (SAFE-09)** - `8b4b2df` (test)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `.pi/extensions/safety/index.ts` (new, ~530 lines) — the entry point: `buildFacts`, `extractCommandOrPath`, `classifyAtWrapper`, `wrapperOutcome`, `registerWrappedTools`, `registerApprovalTool` (`approve_ky_command`), `registerToolCallHook`, and the default export composing all four plus `session_start` retention
- `tests/unit/safety-entry.test.ts` (new, 14 tests) — registration shape: exact tool/hook sets, source-order guarantee, schema `required` fields, no `promptSnippet`/`promptGuidelines` on `approve_ky_command`, no `ctx.ui.confirm(`, exactly one `ctx.ui.select(`, and a live proof that a malformed `bash` call never delegates to the real tool
- `tests/integration/double-enforcement.test.ts` (new, 3 tests) — the SAFE-09 proof against real faux sessions, described above
- `tests/unit/contributing-boundary.test.ts` (modified) — `TOOL_REGISTRATION_ALLOWLIST` extended with the (a)/(b)/(c) justification comment

## Decisions Made

See `key-decisions` in frontmatter. In summary: the wrapped-tool delegate call omits `ctx` (matches `AgentTool.execute`'s real declared type, verified by a clean `tsc --noEmit`); classification and action are split into two functions specifically to avoid a double-audit-row bug found and fixed before the first commit; `PROTECTED_BRANCHES` defaults to `["main","master"]`; `blast_radius` uses `StringEnum` per CLAUDE.md; the approval tool's schema cost was measured by executing a scratch script against the real `typebox`/`StringEnum` imports, not estimated; the double-enforcement fixtures are path-based rather than git-branch-based to avoid needing a git fixture in a temp, non-git `cwd`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a double-audit-row / double-wrapped-error-message bug found during authoring, before any commit**
- **Found during:** Task 1, while drafting a single generic `guarded()` wrapper combining classification and action
- **Issue:** An initial design wrapped the entire allow/confirm/block dispatch — including the DELIBERATE `throw new Error(verdict.reason)` for a block verdict — inside one generic exception-containment function. That containment's own `catch` then intercepted the deliberate throw too, writing a SECOND audit row with a confusingly re-wrapped reason string ("safety extension threw inside ... wrapper: <original reason> -- deny by construction...") on every single block, not just on genuine bugs.
- **Fix:** Split into `classifyAtWrapper()` (never throws; converts an exception to a `block` Verdict) and `wrapperOutcome()`/the hook's own inline dispatch (writes exactly one audit row for whatever verdict it receives, including the exception-converted one, then returns or throws cleanly).
- **Files modified:** `.pi/extensions/safety/index.ts` (design decided before the file was written; no separate fix commit needed)
- **Verification:** `tests/unit/safety-entry.test.ts`'s audit-count assertions and the double-enforcement test's exact-row-count assertions both depend on exactly-one-row-per-verdict; both pass, and the mutation-testing rounds confirmed the exception path still produces the expected single block row.
- **Committed in:** `28f6271` (Task 1 commit — the bug was never actually shipped)

---

**Total deviations:** 1 auto-fixed (1 design bug caught during authoring, never committed)
**Impact on plan:** None on scope — the fix is the shipped design, not a follow-up change.

## Issues Encountered

None beyond the deviation above. `AgentTool.execute`'s 4-parameter (no-`ctx`) type initially looked like it might force `any`-typed generic gymnastics across the four wrapped-tool registrations; writing each of the four registrations out explicitly (rather than one shared generic `makeWrappedExecute<T>` helper) avoided that entirely and compiled cleanly on the first `tsc --noEmit` run.

## User Setup Required

None — no external service configuration required. This plan adds no new dependency; `StringEnum` comes from the already-pinned `@earendil-works/pi-ai`, and `Type` from the already-pinned unscoped `typebox`.

## Next Phase Readiness

- Plan 09 (bootstrap user-scope install and the real `pi --mode json` headless deny) can now point `bin/bootstrap.sh`'s re-export stub at `.pi/extensions/safety/index.ts`'s default export directly — the entry point is complete and self-contained (imports nothing from `diagnostics/`, `harness/`, or `providers/`).
- Plan 10 (blocked command inside a spawned headless child, four-process audit concurrency) can drive the SAME `classifyAtWrapper`/`wrapperOutcome`/hook composition inside a real subagent process; the audit row shape (`event`, `tool`, `command`, `cwd`, `verdict`, `reason`, `pid`) already carries `pid`, which is what will distinguish a subagent's rows from the main session's in one shared file.
- Plan 11 (the evasion corpus and `docs/SAFETY.md`) can cite `T-04-08`'s residual risk (a tool-name collision with an extension loaded earlier in Pi's own order, outside this repo's control) directly from this file's own module docstring, which already names the gap rather than overclaiming coverage.
- No blockers. `npx vitest run tests/unit tests/integration` is 1015/1015 green (up from 998 at the end of Plan 07; the delta is this plan's 17 new tests), `tsc --noEmit` clean.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: .pi/extensions/safety/index.ts
- FOUND: tests/unit/safety-entry.test.ts
- FOUND: tests/integration/double-enforcement.test.ts
- FOUND: commit 28f6271 (Task 1)
- FOUND: commit 8b4b2df (Task 2)
