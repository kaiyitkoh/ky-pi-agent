# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## wr09-lost-update — checkpoint store's withLock silently lost rows under contention
- **Date:** 2026-08-16
- **Error patterns:** WR-09, checkpoint-store, withLock, lost update, flaky, 596/600, 599/600, entries.length, recordCheckpoint, lock acquisition, unsynchronized read-modify-write, full-suite load, CPU contention
- **Root cause:** withLock() in .pi/extensions/checkpoint/store.ts degraded to running its read-modify-write body UNLOCKED whenever lock acquisition exceeded LOCK_MAX_WAIT_MS (2000ms). This window was exceeded by ordinary contention among live concurrent recorders (not dead holders -- the pre-existing 30s LOCK_STALE_MS staleness breaker already reclaims those), so the "degrade to unlocked" fallback only ever fired against live contention, and every firing was an unsynchronized race that could drop a concurrently-written row. Confirmed by instrumentation: degraded-call count correlated 1:1 with lost-row count under synthetic CPU stress.
- **Fix:** Removed the unlocked-degradation fallback; withLock() now throws on genuine acquisition failure (caught by the callers' existing NEVER THROWS try/catch wrappers, preserving the documented failure signal: undefined / []). Raised LOCK_MAX_WAIT_MS from a flat 2000ms to LOCK_STALE_MS + 5000ms (35s) so a caller only gives up after the staleness breaker has had a full window to reclaim a dead lock. CAUTION when rewriting NEVER-THROWS-adjacent docstrings: quality/rules.ts's swallowed-exception rule exempts comment-only catch clauses via a literal substring match on "NEVER THROWS" in a leading comment on the catch or its enclosing function -- word-wrapping that exact phrase across a JSDoc line break breaks the exemption and produces a new quality-gate finding.
- **Files changed:** .pi/extensions/checkpoint/store.ts, tests/unit/workflow-budgets.test.ts, .planning/phases/09-ceremonial-workflows/deferred-items.md
---

