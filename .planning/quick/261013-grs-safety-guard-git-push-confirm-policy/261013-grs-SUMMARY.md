---
quick_id: 261013-grs
status: complete
date: 2026-10-13
commits: [690c7b9, a109822]
---

# Quick Task 261013-grs Summary: git push confirm policy

- Pushes to main/master/staging, any force variant, every-ref/tag forms, protected deletes, merge_request push options, unknown flags: hard-blocked.
- A push resolving to a non-protected branch returns `ask`; the hook calls `ctx.ui.confirm` with the command and resolved remote/branch; approve -> 30s one-shot grant consumed by the bash wrapper; deny -> block; no TUI (hasUI false, print/json/rpc, subagents) -> refuse; `bg_run` blocks.
- Implicit destinations resolved from git config and `rev-parse --symbolic-full-name`, trusted only for a sole statement with no prefix, wrapper, cd or repo-redirect option.
- Tests: new `tests/unit/push-confirm.test.ts` (both directions, incl. real repos and the hook/wrapper); updated git-policy, policy-compose, safety-entry, docs-policy, git-head-main. Targeted runs: 605 + 172 passed; `tsc --noEmit` clean.
- Docs: `docs/SAFETY.md` "git push: block, ask, refuse"; `docs/RUNBOOK.md` RB-04-02 (live TUI check, OUTSTANDING).
- Review: 8 critical + 6 warning fixed in a109822; 1 info accepted.
