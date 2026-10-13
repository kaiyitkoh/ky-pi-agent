---
phase: 11-terminal-ui
fixed_at: 2026-10-13T11:40:00Z
review_path: .planning/phases/11-terminal-ui/11-REVIEW.md
iteration: 3
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report (iteration 3, final)

**Fixed at:** 2026-10-13T11:40:00Z
**Source review:** .planning/phases/11-terminal-ui/11-REVIEW.md
**Iteration:** 3

**Summary:**
- Findings in scope (Critical + Warning): 2
- Fixed: 2
- Skipped: 0
- Info findings also fixed on request: IN-01, IN-03 (IN-02 and IN-04 were left open)

Each fix has a test that fails without it. I proved this by stashing only the source or doc change and re-running the targeted file. Verification was targeted only: `tests/unit/ui-statusline.test.ts` (30 passed), `tests/unit/ui-wire-check.test.ts` (47 passed), `tests/unit/docs-policy.test.ts` (152 passed), and `npx tsc --noEmit` (clean). The full suite was not run.

## Fixed Issues

### WR-01: A foreground workflow is counted once for its tool call and again for every child

**Files modified:** `.pi/extensions/ui/agents.ts`, `tests/unit/ui-statusline.test.ts`
**Commit:** 235c8b8
**Applied fix:** `isForegroundLaunch` now returns `false` for any call carrying `workflow` or `workflowScript`, so a workflow is counted only through its runner children. I confirmed in the `pi-subagents@0.76.1` extraction that a child with no `async` argument gets `workflowAwaitAsync: true` (`subagent-executor.js:4435`). The wrong four-line tracker JSDoc is replaced with one accurate sentence. New test: a blocking `{ workflow, async: false }` call and a `{ workflowScript, clarify: true }` call both return `false`, and two child `async-started` events give a count of 2.
**Status:** fixed: requires human verification. This is a counting-logic change. The residual case the review names is still open: a child that sets `async: false` inside an async workflow runs in-process and is not counted.

### WR-02: The wire check's default session can be a subagent child

**Files modified:** `scripts/ui-wire-check-core.ts`, `scripts/ui-wire-check.mjs`, `docs/RUNBOOK.md`, `docs/UI.md`, `tests/unit/docs-policy.test.ts`, `tests/unit/ui-wire-check.test.ts`
**Commit:** 7c0c000
**Applied fix:** `analyseWire` collects the distinct session ids. If no `--session` was given and there is more than one, it picks none and returns them in a new `ambiguousSessions` field. `verdict` then returns INSUFFICIENT, listing the ids and asking for `--session <id>`. This check runs after FAIL evidence is collected, though there is none because no session was analysed. The CLI prints `session: (ambiguous)` and exits 2. RB-11-03 step 5 and `docs/UI.md` now take the id from `/session` and pass `sh scripts/ui-wire-check.sh --session <id> --probe "$probe"`. The docs-policy pin was updated to match. New tests: an interleaved parent/child log with the child logged last is not analysed, a named session among several is analysed, and the launcher exits 2 listing `s1, child` but exits 0 with `--session s1`.
**Status:** fixed: requires human verification. This changes how a session is chosen. A log holding only one session behaves as before.

### IN-01 (Info, fixed on request): Both INSUFFICIENT branches drop the truncation caveat

**Files modified:** `scripts/ui-wire-check-core.ts`, `tests/unit/ui-wire-check.test.ts`
**Commit:** 5621e55
**Applied fix:** The `requests < 2` and `ratios.length === 0` branches now return `[...reasons, ...]`, the same as the `missing > 0` branch. New test: both branches keep "truncated by redaction".

### IN-03 (Info, fixed on request): RB-11-02 asks for a foreground run that a plain call cannot produce

**Files modified:** `docs/RUNBOOK.md`, `tests/unit/docs-policy.test.ts`
**Commit:** c09e7d6
**Applied fix:** Step 1 now asks for one call with `async: false` (blocking) and one with no `async` argument (background). It also says why: a plain call is async by default. The result line records `blocking run agents=<n>, background run agents=<n>`. The docs-policy pin was updated to the new line, and it fails against the old runbook.

## Not addressed (Info, out of scope)

- **IN-02:** a request with no system text skips the tool-list hash and the probe search.
- **IN-04:** a whitespace-only `action` is classified differently from pi-subagents.

---

_Fixed: 2026-10-13T11:40:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
