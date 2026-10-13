---
quick_id: 261013-grs
slug: safety-guard-git-push-confirm-policy
date: 2026-10-13
mode: quick
---

# Quick Task 261013-grs: git push confirm policy

User decision 2026-10-13: replace "every push without an explicit `src:dst` is refused" with block / ask / refuse.

## Task 1 — policy (git.ts, policy.ts, shell.ts, approvals.ts, index.ts)
- **files:** `.pi/extensions/safety/{git,policy,shell,approvals,index}.ts`
- **action:** Block force variants, every-ref forms, protected (`main`, `master`, `staging`) or ambiguous destinations, protected deletes, merge push options, submodule recursion, unknown flags, any push while HEAD is protected. Resolve non-protected destinations (explicit `src:dst`; bare source and no-refspec via git config, mirroring builtin/push.c) and return `ask`. Trust config only when the push is the sole invocation with no prefix, wrapper, cd or repo-redirect option. Hook asks with `ctx.ui.confirm` only when `hasUI && mode === "tui"`; approval writes a one-shot grant the bash wrapper consumes; deny or no UI blocks; `bg_run` blocks.
- **verify:** `npx tsc --noEmit`
- **done:** typecheck clean.

## Task 2 — tests (both directions)
- **files:** `tests/unit/push-confirm.test.ts` (new), `git-policy`, `policy-compose`, `safety-entry`, `docs-policy`, `tests/integration/git-head-main.test.ts`
- **verify:** targeted vitest runs, `--maxWorkers=2`
- **done:** all targeted safety tests green.

## Task 3 — docs
- **files:** `docs/SAFETY.md` (new "git push: block, ask, refuse"), `docs/RUNBOOK.md` (RB-04-02 live TUI check)
- **done:** docs-policy test green.
