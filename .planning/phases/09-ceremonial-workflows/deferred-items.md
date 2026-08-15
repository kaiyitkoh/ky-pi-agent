# Deferred items

Out-of-scope discoveries logged here per the executor's scope-boundary rule -- not fixed, not part of the current plan.

## Plan 09-08

- `tests/unit/checkpoint-store.test.ts` > "WR-09 -- concurrent recorders do not lose each other's entries" > "four overlapping OS processes each recording 150 entries produce all 600 rows" -- flaky under full-suite load (596/600 observed in one full-suite run; passes in isolation, re-run confirmed). This is a real-OS-process timing test (`checkpoint/` subsystem, Phase 7), unrelated to `.pi/extensions/grill/` or `.pi/skills/grill/`. Not fixed: out of scope for plan 09-08, which touches only the grill subsystem and the workflow-budgets registry.

## Plan 09-09

- `tests/unit/checkpoint-store.test.ts` > the same "four overlapping OS processes each recording 150 entries produce all 600 rows" case -- flaky again under full-suite load (599/600 observed this run; passes in isolation, re-run confirmed). Same real-OS-process timing test, `checkpoint/` subsystem (Phase 7), unrelated to `.pi/extensions/plan-ceremony/`. Not fixed: out of scope for plan 09-09, which touches only the plan-ceremony subsystem and the workflow-budgets registry.
