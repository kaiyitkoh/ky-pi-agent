---
phase: quick-261013-sit
plan: 01
status: complete
subsystem: safety, routing, review
tags: [safety, routing, review, protected-branches, pipe-rule]
requirements: [SAFE-03, SAFE-07, SAFE-11, EXT-01, QUAL-08, ROUTE-02, FLOW-08]
commits:
  - 72f5db0 fix(safety): refuse a piped interpreter only when stdin is its code; allow terraform -chdir
  - 644a043 feat(safety): add-only protected branches from settings; unify the /grill and /plan turn budget; resolve pi-subagents from the loaded tool
  - cf5c5db fix(routing,review): default mode at fresh start, one model picker, guarded fallback hops, /quick warns on overfull context, merge-base typecheck baseline
  - 6de9aab docs(review): record status of the deferred v1.0 findings
---

# Quick 261013-sit: Safety and mode follow-ups

One-liner: a piped code runner is refused only when stdin would be its code, protected branches are configurable add-only, /grill and /plan share one turn rule, and every deferred v1.0 finding named in the plan is fixed or recorded as decided.

## What changed

- **Pipe rule** (`safety/shell.ts`): per-interpreter option grammar (`stdinIsCode`) for shells, python, node/deno/bun, perl, ruby, php and other runners; unknown options, `-`, `-s`, `-i`, `PYTHONINSPECT=`, bare runners and cmd/pwsh/busybox/parallel/osascript on a pipe still refuse. Piped inline code is checked by re-parsing shell `-c` code and by a word list of evaluators and deserializers. `python -m foo` refuses when the same command wrote `foo.py`, `foo` or `foo/`.
- **terraform** (`safety/infra.ts`): `-chdir=`, `-version`, `-help` skipped before classification.
- **Protected branches** (`safety/branches.ts`, `.pi/lib/settings.ts`): add-only lists from user and project settings, `main` first, malformed values keep defaults and warn (notify + audit row). All six commit-check callers and the glab classifier use them.
- **Turn budget**: `turnBudgetSpent` shared by /grill and /plan; /plan gets a last-turn brief (`planTurnBrief`).
- **Child guard** (`safety/subagents.ts`): pi-subagents resolved from the loaded `subagent` tool's source path, then the npm roots; still fails closed.
- **Routing**: `freshSessionPlan` resets a fresh session or `/new` to `DEFAULT_MODE` and applies its executor unless a model was chosen explicitly; `agentOverridesFor` takes a registry so pins and `/mode` share one picker; `callWithFallback` takes a per-hop guard; `/quick` warns on overfull context.
- **/review**: `typecheckBaseline` / `typecheckFailsAtCommit` in `quality/index.ts` run the merge-base typecheck lazily, in a detached worktree created inside the git dir (no link into node_modules).

## Tests run (targeted, `--maxWorkers=2`, one invocation at a time)

shell-deny-list, evasion-corpus, infra-policy, shell-parse, protected-branches, subagent-guard, push-confirm, git-policy, safety-entry, agent-overrides, ceremony-gates, review-mr, default-mode, mode-switch, mode-persistence, model-select-guard, fallback-chain, quick-workflow, review-command, planner-pin-session, ky-profile-flag, routing-guard-hooks, escalate, wire-proof, workflow-budgets, comment-discipline, docs-policy; `npx tsc --noEmit` clean at each commit. The full suite was not run (orchestrator).

## Deviations from Plan

1. **[Rule 2 - hardening]** `python -m` with an interactive or evaluator module (`code`, `codeop`, `pdb`, `ipdb`, `IPython`, `ptpython`, `bpython`, `idlelib`, `runpy`) on a pipe is refused: those read stdin as code. Not in the plan's grammar.
2. **[Rule 2 - hardening]** A `PYTHONINSPECT=` assignment in an earlier statement of the same command (`PYTHONINSPECT=1; cat x | python s.py`) also refuses, not only prefix and `env` forms. `busybox` is detected through the wrapper list, because the wrapper resolver rewrites it to the inner program.
3. **[Rule 3 - frozen ceiling]** The `/plan` last-turn brief lives in `plan-ceremony/plan-schema.ts` (`planTurnBrief`) and the /review baseline decision in `quality/index.ts` (`typecheckBaseline`), because `plan-ceremony/index.ts` and `review/index.ts` are at frozen text ceilings.
4. **[Rule 1 - ordering]** In `session_start` the default-executor step starts before tool narrowing and is awaited in a `finally`, so the handler's existing synchronous behaviour is unchanged; `savedDefaultModel` never throws, so a stub or unreadable settings file cannot stop pin bookkeeping.
5. Per orchestrator override, the /review base typecheck uses a detached worktree inside the git dir (no junction); the exec for the base reuses the real repo's local `tsc` binary because the worktree's own git top level would stop the binary search. The production path was checked against a scratch repo (fails at a bad commit, passes at a good one, no worktree left behind).
6. Existing stubs in `tests/unit/ky-profile-flag.test.ts` and `tests/unit/planner-pin-session.test.ts` gained `cwd` / registry fields because `session_start` now reads settings and the registry.
7. Budget entries raised or lowered with dated sentences: safety dir 4080 to 4350, `.pi/lib` 800 to 820, plan-ceremony dir 490 to 500, routing dir 1560 to 1630, routing/index.ts 430 to 470, providers dir 440 to 450, quality dir 2480 to 2520. No frozen ceiling number moved.

## Known Stubs

None.

## Self-Check: PASSED

Commits 72f5db0, 644a043, cf5c5db, 6de9aab exist; working tree clean apart from this quick directory.
