# Deferred items — Phase 08

Out-of-scope discoveries logged during plan execution, per the executor's SCOPE BOUNDARY rule (only auto-fix issues directly caused by the current task's own changes).

## 08-11

- **`tests/unit/checkpoint-store.test.ts` — "WR-09 -- concurrent recorders do not lose each other's entries" is timing-flaky under full-suite CPU load.** Observed once during this plan's final full-suite verification (`npx vitest run`): failed with "the four writers must have OVERLAPPED -- the latest start has to precede the earliest finish" (a real-clock overlap assertion between four spawned OS processes). Re-ran the file in isolation immediately after: 17/17 green, including this case. This is a Phase 7 file (checkpoint extension, plan 07-03), untouched by plan 08-11's own file scope (`.pi/extensions/quality/index.ts`, `.pi/extensions/workflows/index.ts`, and the test files this plan's frontmatter names). Not fixed here — it is a pre-existing machine-timing sensitivity in a file this plan did not modify, not a regression this plan introduced. Left for whichever future pass owns `checkpoint-store.test.ts`'s own tightening.
