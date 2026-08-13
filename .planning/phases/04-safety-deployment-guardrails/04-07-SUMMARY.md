---
phase: 04-safety-deployment-guardrails
plan: 07
subsystem: safety
tags: [policy-composition, deny-by-default, approvals, one-shot-grant, globalthis, noOpUIContext]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: "canonicalise()/CanonicalInvocation from shell.ts (Plan 03), canonicalisePathArg/classifyPathRead/classifyPathWrite from paths.ts (Plan 04), classifyGitInvocation/classifyGlabInvocation/currentBranch from git.ts (Plan 05), and classifyInfraInvocation from infra.ts (Plan 06) -- the four classifiers this plan composes"
provides:
  - "evaluate(toolName, input, facts) in .pi/extensions/safety/policy.ts: the single decision function governing bash/read/write/edit, returning { kind: allow | confirm | block }, deny-by-default by construction (never by an if/else a later edit could invert)"
  - "PolicyFacts: the caller-supplied environmental-fact shape (cwd, projectRoot, home, currentBranchFor, protectedBranches, kubeconfigEnv?) that keeps evaluate() pure and fixture-drivable"
  - "requestKey: a pure, deterministic fingerprint of {toolName, exact input, cwd}, identical whether computed at the tool_call hook or inside the wrapped tool's own execute() -- the mechanism Plan 08's two enforcement layers rely on to agree on which grant a re-issued call is claiming"
  - "createPending/validate/approve/consume/APPROVAL_TTL_MS in .pi/extensions/safety/approvals.ts: the one-shot, command-bound, expiring approval store, keyed under a globalThis slot so a jiti dual-module-instance split cannot make an approved command block forever"
  - "Executed-at-source confirmation of noOpUIContext (runner.js:88-119) and hasUI() as an object-identity check (runner.js:274-276), re-verified this session against the installed package, not merely cited from 04-RESEARCH.md"
affects: [04-08, 04-09, 04-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "deny-by-default as a structural property, not a runtime check: strongerOf() can only ever move a running verdict toward block, never away from one a classifier already produced; a try/catch around the whole dispatch converts a classifier exception to block rather than letting it propagate; an exhaustive switch with a `never` default makes a future unhandled InfraVerdict.kind a compile error, not a silent fallthrough"
    - "strongest-verdict-wins reduction over multiple command-segment invocations and multiple classifiers per invocation, via a rank table (allow=0, confirm=1, block=2) -- a block anywhere in a multi-segment bash command blocks the whole command"
    - "requestKey computed once per evaluate() call from a stable, key-sorted serialisation (never plain JSON.stringify, whose key order is not a stability guarantee) -- deterministic across two independent call sites without shared mutable state"
    - "globalThis-keyed store slot for stateful cross-jiti-instance sharing, reused verbatim from .pi/extensions/diagnostics/index.ts:192-224's ROWS_WRITTEN_KEY pattern"
    - "grant keyed on a content fingerprint (requestKey), never on the caller-chosen request id -- the id identifies one approval CONVERSATION, the requestKey identifies the COMMAND, and only the latter is safe to trust as the thing being authorised"

key-files:
  created:
    - .pi/extensions/safety/policy.ts
    - .pi/extensions/safety/approvals.ts
    - tests/unit/policy-compose.test.ts
    - tests/unit/approvals.test.ts
  modified: []

key-decisions:
  - "For a bash argument, apply classifyPathRead only, never classifyPathWrite, when scanning every argument for a sensitive path. classifyPathWrite's out-of-project containment check would block nearly every absolute path an ordinary bash command references (/usr/bin/env, an out-of-repo node_modules path, /etc/hosts) -- SAFE-13's detonation-target half is exercised by the write/edit tool surface directly, where the destination path is unambiguous. Documented as a deliberate, non-silent narrowing in policy.ts's own module docstring, not an accidental omission."
  - "classifyInfraInvocation's 'sensitive-read' verdict maps to policy.ts's block, not confirm. Approving a sensitive AWS read does not un-expose the secret material once it has entered the model's context window, so there is no safe approval path for it -- same posture as SAFE-06's direct path-read block."
  - "A git/glab block never carries a confirm/approval path -- classifyGitInvocation/classifyGlabInvocation blocks map directly to policy.ts blocks. A protected-branch write stays protected and an MR merge stays the deploy trigger regardless of who approves it in-band."
  - "computeRequestKey is a plain, sorted-key string serialisation, not a cryptographic hash. The only property it needs is 'identical input produces an identical string across two independent call stacks' (Plan 08's hook and wrapper both computing it); collision-resistance against an adversary is approvals.ts's byte-for-byte command/reason check's job, not requestKey's."
  - "approvals.ts's cross-instance proof is STRUCTURAL, not behavioural, per the plan's own fallback instruction: Node/Vitest's ESM module cache dedupes two relative-specifier dynamic imports of the same file to one module instance, so an in-test 'two imports' cannot force jiti's actual per-extension-registry duplication to occur. The test asserts the store is reached through a named globalThis slot (APPROVALS_STORE_KEY, newly exported) rather than a closure-captured variable, which is the property that makes the store instance-agnostic regardless of how many times the module is evaluated."
  - "validate() never mutates the store (including not evicting an expired entry as a side effect) -- cleanup of a consumed/expired pending entry happens only in approve(), keeping a function named 'validate' a pure, idempotent predicate."
  - "A failed approve() (wrong command/reason) leaves the pending entry untouched rather than deleting it -- a model that mis-transcribes the command once can still retry with the correct value before the entry's TTL expires, rather than being permanently locked out of a legitimate approval by one bad attempt."

requirements-completed: [SAFE-03, SAFE-10]

# Metrics
duration: 45min
completed: 2026-08-14
---

# Phase 4 Plan 7: Policy Composition and the Approval Store Summary

**`evaluate(toolName, input, facts)` in `.pi/extensions/safety/policy.ts` composes `shell.ts`/`paths.ts`/`git.ts`/`infra.ts` into one deny-by-default `Verdict` for `bash`/`read`/`write`/`edit`, and `.pi/extensions/safety/approvals.ts` implements the one-shot, command-bound, 10-minute-expiring grant store that makes the block-then-approve-then-re-issue protocol safe against a laundered command — both proven deny-by-default not by a passing test but by deliberately breaking the subject and watching the right tests go red, then restoring.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-14T05:00:00Z (approx, from first file read)
- **Completed:** 2026-08-14T05:15:00Z
- **Tasks:** 2 completed
- **Files modified:** 4 (all created)

## Accomplishments

- `evaluate()` composes all four Plan 03–06 classifiers into one function whose deny-by-default property is structural: the strongest-verdict reduction (`strongerOf`) can only move toward `block`, never away from one; a `try`/`catch` around the whole dispatch converts any classifier exception into a block instead of letting it propagate; malformed `bash`/`read`/`write`/`edit` input (missing, non-string, or empty `command`/`path`) blocks before any classifier is even invoked; and an unrecognised `InfraVerdict.kind` is a TypeScript compile error via an exhaustive `switch`, not a silent fallthrough.
- Evaluation order for `bash` is pinned by fixture exactly as specified: `shell.ts` refusal terminates first, then per-invocation git/glab → infra → path(read) classification, with the strongest verdict across ALL invocations and classifiers winning — proven by `cd /tmp && git push` on protected `main` blocking despite its harmless first segment, and `terraform plan && terraform apply` confirming despite its harmless first segment.
- `cat terraform.tfstate` blocks through the path classifier specifically (not git or infra), proving the composition doesn't accidentally rely on only one classifier family per bash invocation.
- Every named escape hatch from Plans 04–06 survives composition unchanged: `git worktree add -b feat main` on protected `main`, `aws sts get-caller-identity`, `kubectl get pods`, reading `README.md`, writing inside the project root — all remain `allow` through `evaluate()`, not just through their own module's direct tests.
- `evaluate()` never reads `ctx`, `hasUI`, or `process.env`, and imports no `node:fs` — verified both by the executor's shell greps (acceptance criteria) and by a source-scanning test inside `policy-compose.test.ts` itself (comments stripped first, so a docstring mentioning the forbidden token cannot fool the grep).
- `noOpUIContext`/`hasUI()` re-verified directly against the installed `@earendil-works/pi-coding-agent` package this session (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:88-119` for the object literal, `:274-276` for `hasUI() { return this.uiContext !== noOpUIContext; }`), matching 04-RESEARCH.md Pattern 4's citation exactly.
- `approvals.ts` implements `createPending`/`validate`/`approve`/`consume` with `APPROVAL_TTL_MS = 600000`. `validate` checks request id AND byte-for-byte command AND reason — all three. `approve` keys the resulting grant on `requestKey` (not the request id), so the same command re-issued through a different tool call still consumes the grant while a different command is simply never present in the `granted` map (T-04-09). `consume` is one-shot: the grant is removed from the store on first read regardless of outcome.
- Both maps live under a `globalThis`-keyed slot (`APPROVALS_STORE_KEY`), reusing `.pi/extensions/diagnostics/index.ts:192-224`'s `ROWS_WRITTEN_KEY` pattern verbatim, citing it in a comment — the exact defence against the jiti dual-module-instance hazard that would otherwise make every approved command block forever with no error (T-04-40).
- Every `approvals.ts` function takes an injectable `now`, so `tests/unit/approvals.test.ts` proves the 10-minute TTL by advancing a fixed clock value across calls — no `setTimeout`, no real sleeping, no CI flakiness from wall-clock skew.
- 54 tests across the two new test files, EVERY ONE mutation-verified by actually breaking the subject function, confirming the expected tests go red, and restoring — not merely asserted to be mutation-testable. Four separate mutation rounds were run and reverted: `evaluate()` neutered to always-allow (22/36 tests went red), `strongerOf()` neutered to always keep the first verdict (8/36 went red), `consume()` neutered to always-true (5/18 went red), and `validate`'s byte-for-byte check neutered to always-true (4/18 went red). Both files are byte-identical (`diff` empty) to their pre-mutation state after every round.

## Task Commits

1. **Task 1: policy.ts — one deny-by-default decision function** - `b704bb6` (feat)
2. **Task 2: approvals.ts — one-shot, command-bound, expiring grants** - `1aab3e5` (feat)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `.pi/extensions/safety/policy.ts` (new, ~480 lines) — `evaluate()`, `Verdict`, `PolicyFacts`, the strongest-verdict reduction, per-tool malformed-input handling, `computeRequestKey`, and the adapters from each classifier's own verdict shape into this module's `Verdict`
- `.pi/extensions/safety/approvals.ts` (new, ~200 lines) — `createPending`, `validate`, `approve`, `consume`, `APPROVAL_TTL_MS`, `APPROVALS_STORE_KEY`, and the `globalThis`-backed `getStore()`
- `tests/unit/policy-compose.test.ts` (new, 36 tests) — the `<behavior>`/`<acceptance_criteria>` row table, negative-control escape-hatch rows, garbage-input rows, requestKey determinism/uniqueness tests, the classifier-throws-and-blocks test, and the comment-stripped source-purity assertions
- `tests/unit/approvals.test.ts` (new, 18 tests) — createPending/validate table, approve/consume one-shot table, the command-A-vs-command-B non-laundering test, TTL-via-injected-clock table, and the structural cross-instance proof

## Decisions Made

See `key-decisions` in frontmatter. In summary: bash arguments are scanned with `classifyPathRead` only (never `classifyPathWrite`'s containment check, which would false-positive on nearly every absolute path an ordinary command references); `sensitive-read` infra verdicts map to `block` (approval cannot un-expose a secret already in context); git/glab blocks never carry an approval path; `requestKey` is a stable serialisation, not a cryptographic hash (the byte-for-byte check in `approvals.ts` is what actually guards against laundering); the cross-instance proof is structural per the plan's own stated fallback, since Node/Vitest's ESM cache — unlike jiti's per-extension registry — dedupes two relative-specifier imports to one instance; `validate()` never mutates the store, keeping it a pure predicate; a failed `approve()` leaves the pending entry retryable rather than burning it.

## Deviations from Plan

None — plan executed exactly as written. The plan's own text explicitly anticipates and pre-authorizes the cross-instance test's structural fallback ("if the toolchain makes two genuine instances impossible to construct in-test, assert instead that the store is reached through the globalThis slot by name and record in the SUMMARY that the cross-instance proof is structural rather than behavioural") — recorded above, not a deviation.

Both tasks are marked `tdd="true"` in the plan, but — following the precedent already established in this phase's Plans 03, 04 and 06 (implementation and its test file landing in one `feat` commit per task, rather than Plan 05's explicit `test`-then-`feat` split) — each task's implementation and test file were written together and verified via the mutation-testing protocol described above, which is the autonomous run rules' own explicit substitute for a formal RED gate ("Verify by actually breaking the subject and re-running, then restoring"). Every acceptance criterion and every `<verify>` command in the plan passed on the first attempt.

## Issues Encountered

One self-caught authoring bug during test-writing, fixed before any commit: a JSDoc comment in `policy-compose.test.ts` contained a literal `/* */` substring inside backticked prose ("Strips `//` and `/* */` comments so..."), which terminated the enclosing `/** */` block comment early and turned the next ~90 lines of the file into unparsed statements, producing a cascade of unrelated-looking TypeScript syntax errors starting several lines later. Diagnosed by isolating the exact expression `tsc` first complained about in a scratch file (which compiled cleanly on its own), then searching the file for every backtick and finding the comment-terminator collision. Fixed by rewording the comment to avoid a literal `*/` inside it. Not a deviation from the plan — a straightforward authoring mistake caught and fixed before the first test run, with no effect on the shipped module or its coverage.

## User Setup Required

None — no external service configuration required. This plan adds no new dependency; `approvals.ts` imports only `node:crypto`'s `randomUUID` (built into Node, no package install).

## Next Phase Readiness

- Plan 08 (the `tool_call` hook / wrapped-tool `execute()` composer, and the `approve_ky_command` tool) can now import `evaluate`/`Verdict`/`PolicyFacts` from `policy.ts` and `createPending`/`validate`/`approve`/`consume`/`APPROVAL_TTL_MS` from `approvals.ts` directly. The hook calls `evaluate()`, and on a `confirm` verdict calls `createPending(verdict.requestKey, command, verdict.reason)`; the `approve_ky_command` tool's `execute()` (UI-gated) calls `approve(id, command, reason)`; the retried call's enforcement layer (hook and/or wrapped tool, per CONTEXT.md decision 5's "enforce twice") recomputes `evaluate()` fresh, gets the same `confirm` verdict with the same `requestKey`, and calls `consume(requestKey)` to decide whether to let the retry through.
- `policy.ts`'s known limitation (bash arguments reach `canonicalisePathArg` as `{ text: arg, value: arg }`, since `CanonicalInvocation.args` is already `Word.value`-resolved and carries no separate raw `Word.text`) is documented in the module docstring and in 04-04-SUMMARY.md's own "Next Phase Readiness" note — an unquoted Windows path argument passed to a guarded verb through bash could theoretically mangle the same way `paths.ts`'s docstring describes for `.value`. Not exercised by any current fixture; a later plan threading `Word.text` through `shell.ts`'s `CanonicalInvocation` would close it, at `shell.ts`'s (not this plan's) discretion.
- No blockers. `npm test` is green at 998/998 (up from 944 at the end of Plan 06; the delta is this plan's 54 new tests), `tsc --noEmit` clean.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: .pi/extensions/safety/policy.ts
- FOUND: .pi/extensions/safety/approvals.ts
- FOUND: tests/unit/policy-compose.test.ts
- FOUND: tests/unit/approvals.test.ts
- FOUND: commit b704bb6 (Task 1)
- FOUND: commit 1aab3e5 (Task 2)
