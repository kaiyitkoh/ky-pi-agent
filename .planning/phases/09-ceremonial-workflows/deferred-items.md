# Deferred items

Out-of-scope discoveries logged here per the executor's scope-boundary rule -- not fixed, not part of the current plan.

## Plan 09-08

- `tests/unit/checkpoint-store.test.ts` > "WR-09 -- concurrent recorders do not lose each other's entries" > "four overlapping OS processes each recording 150 entries produce all 600 rows" -- flaky under full-suite load (596/600 observed in one full-suite run; passes in isolation, re-run confirmed). This is a real-OS-process timing test (`checkpoint/` subsystem, Phase 7), unrelated to `.pi/extensions/grill/` or `.pi/skills/grill/`. Not fixed: out of scope for plan 09-08, which touches only the grill subsystem and the workflow-budgets registry.
  **MISDIAGNOSED -- see the correction below.** This was never test flakiness. Root-caused and fixed in
  debug session `wr09-lost-update` (2026-08-15/16): `withLock` in `.pi/extensions/checkpoint/store.ts`
  degraded to running its read-modify-write body UNLOCKED whenever lock acquisition exceeded
  `LOCK_MAX_WAIT_MS` (2000ms), which live contention among the four recorders could and did exceed under
  CPU load. Every degraded call was an unsynchronized race that could drop a concurrently-written row --
  exactly the 596/600 and 599/600 signatures observed here and in plan 09-09 below. See the correction
  entry for the fix and its verification.

## Plan 09-09

- `tests/unit/checkpoint-store.test.ts` > the same "four overlapping OS processes each recording 150 entries produce all 600 rows" case -- flaky again under full-suite load (599/600 observed this run; passes in isolation, re-run confirmed). Same real-OS-process timing test, `checkpoint/` subsystem (Phase 7), unrelated to `.pi/extensions/plan-ceremony/`. Not fixed: out of scope for plan 09-09, which touches only the plan-ceremony subsystem and the workflow-budgets registry.
  **MISDIAGNOSED -- see the correction below.** Same defect as the plan 09-08 entry above, same fix.

## Correction (2026-08-16, debug session `wr09-lost-update`)

Both "flaky, out of scope" entries above were wrong. Losing 1-4 of 600 rows was not test timing noise;
it was `.pi/extensions/checkpoint/store.ts`'s `withLock` silently losing checkpoints under contention --
precisely the failure WR-09 exists to forbid.

**Root cause (confirmed by instrumentation, not inferred):** `withLock` retried lock acquisition for up
to `LOCK_MAX_WAIT_MS` (2000ms), then, if still unheld, ran the read-modify-write `body()` UNLOCKED anyway
(`held` stayed `false`; the `try { return body(); }` sat outside the acquisition loop). The docstring
defended this as a deliberate trade against "a stale lock outliving its owner in a way the staleness
check did not catch" -- but the module's own `LOCK_STALE_MS` (30s) staleness breaker, inside the same
retry loop, already reclaims a lock left by a genuinely dead holder. The unlocked fallback therefore only
ever fired against ordinary contention between four LIVE, working recorder processes, and every firing
was a real, unsynchronized read-modify-write race. Instrumented `withLock` (temporarily) to count
degraded (lock-not-held) calls and correlate them with lost rows: under synthetic CPU contention on top
of the full suite, 4 degraded calls produced 10 lost rows (590/600) in one run; 0 degraded calls under
normal load produced 0 lost rows (600/600) across multiple runs -- a 1:1 correlation, and the same
contention-gated intermittency (a handful of rows, not a collapse) both prior executors observed.

**Fix:** removed the unlocked fallback entirely -- `withLock` now `throw`s if it cannot acquire the lock
within its deadline, and both callers (`recordCheckpoint`, `pruneCheckpoints`) already wrap their call in
a try/catch that translates any throw into the module's documented failure signal (`undefined` / `[]`),
so the NEVER THROWS contract at the module boundary is unaffected. `LOCK_MAX_WAIT_MS` was raised from a
flat 2000ms to `LOCK_STALE_MS + 5000ms` (35s) so a caller only gives up after the staleness breaker has
had a full window to reclaim a genuinely dead lock -- ordinary contention among live processes resolves
in milliseconds and never approaches that bound.

**Verification:** 10 consecutive `npx vitest run` (full suite, all 114 files / 2169 tests) under
sustained synthetic CPU contention (16-20 busy-loop processes alongside the suite) -- 10/10 fully green,
zero WR-09 failures, zero failures anywhere. `npx tsc --noEmit` clean.

**Files changed:** `.pi/extensions/checkpoint/store.ts` (the fix); `tests/unit/workflow-budgets.test.ts`
(ratchet raise 1070 -> 1100 for the checkpoint directory's line budget, with the reason recorded in its
own `why` string per this repo's established ratchet-raise convention -- the added lines are the
docstring explaining why the old trade did not hold, which the earlier ratchet raises in that same
`why` string argue a budget must never pressure out of a correctness fix).

Debug session archived at `.planning/debug/resolved/wr09-lost-update.md`.

## Plan 09-12

- `tests/unit/subagent-agents-config.test.ts` > "subagent-agents-config -- completeness, both directions" >
  "present-but-undeclared: every tracked .pi/agents/*.md names a role in AGENT_NAME_BY_ROLE, or is a
  named, reasoned exception" -- fails on `main` before this plan's own changes: `.pi/agents/executor-handoff.md`
  ships (added in plan 09-11, commit `5a5db3a`) but no role in `AGENT_NAME_BY_ROLE`
  (`.pi/extensions/routing/`) routes to it, and it is not named in `UNROUTED_AGENT_ALLOWLIST`. Confirmed
  pre-existing via `git log --oneline -3 -- .pi/agents/executor-handoff.md tests/unit/subagent-agents-config.test.ts`
  (last touched by plan 09-11's own commit, before this plan started) and via `git status --short`/`git diff --stat`
  showing zero unstaged changes to either file at the point this failure was first observed. Not fixed: out of
  scope for plan 09-12, which touches only `.pi/extensions/quality/gates.ts`,
  `tests/unit/gate-depth-selector.test.ts` and `tests/unit/workflow-budgets.test.ts` -- none of which name a
  role, an agent file, or `AGENT_NAME_BY_ROLE`. Belongs to whichever later plan wires `/execute`'s subagent
  handoff (FLOW-09/plan 09-11's own follow-on) to a routed role, or adds `executor-handoff` to
  `UNROUTED_AGENT_ALLOWLIST` with a stated reason if it is deliberately future-path.
