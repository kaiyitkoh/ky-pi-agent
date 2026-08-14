---
phase: 05-routing-capability-guards
fixed_at: 2026-08-14T21:39:00Z
review_path: .planning/phases/05-routing-capability-guards/05-REVIEW.md
iteration: 3
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report (FINAL — reflects all three iterations)

**Fixed at:** 2026-08-14T21:39:00Z
**Source review:** .planning/phases/05-routing-capability-guards/05-REVIEW.md
**Iteration:** 3 (final — supersedes the iteration-1 and iteration-2 reports and reflects all
three iterations' work)

**Summary (iteration 3, this run):**
- Findings in scope: 5 (0 Blocker/Critical, 5 Warning — `fix_scope: critical_warning`;
  IN-01/IN-02 out of scope)
- Fixed: 5
- Skipped: 0

**Cumulative summary across all three iterations:**
- Iteration 1: 14 findings fixed (3 Critical, 11 Warning)
- Iteration 2: 8 findings fixed (1 Blocker — CR-01 — and 7 Warning)
- Iteration 3 (this run): 5 findings fixed (0 Blocker/Critical, 5 Warning)
- **Total: 27 findings fixed across the phase, 0 skipped, 0 remaining Critical/Blocker/Warning.**
- Remaining open: IN-01 and IN-02 (Info, out of `critical_warning` scope both times they were
  raised; ACCEPTED per the iteration-3 review's shippable-state adjudication).

**Autonomous run note:** Unattended run per the standing autonomous-run policy. Every fix was
applied inside an isolated git worktree (`gsd-reviewfix/05-<pid>`, fast-forwarded onto `main`
after all five commits landed, then removed together with its temp branch), verified per fix
with the 3-tier strategy (re-read; a project-scoped `npx tsc --noEmit` filtered to the modified
files, since a bare per-file `tsc --noEmit` against this repo's `tsconfig.json` produces
pre-existing third-party `.d.ts` noise unrelated to any edit; and, for the two findings with
new/extended tests — WR-01 and WR-02 — a live mutate/confirm-red/revert falsification against
the real committed source), and committed atomically. The full suite and typecheck were run once
at the end: **`npx vitest run` — 1376 tests / 80 files passed (1373 carried over from iteration 2,
+3 new: one WR-01 line-cap regression test, two WR-02 audit-record regression tests).
`npm run typecheck` — clean.** The real `~/.pi/agent/settings.json` mtime (2026-08-14 20:32,
predating this run's start) was unchanged after the full suite run — the CR-01 isolation guard
from iteration 1/2 held throughout.

**Iteration-3 context:** the review that produced these five findings independently falsified
all eight of iteration 2's fixes (mutate the real committed source → confirm the relevant test
goes red → revert) before filing any new findings, and confirmed iteration 1's still-standing
fixes (CR-02, CR-03, the cheap-mode wire proof) were undisturbed. ROADMAP criterion 1 was
re-confirmed CLOSED for `cheap`, `balanced` and `max` before this run started; none of that
verification work was redone here — this run's job was strictly the five listed Warnings.

## Fixed Issues

### WR-01: the confirmation excerpt was bounded by characters but not by lines or control characters, and its rationale comment asserted an unverified rendering property

**Files modified:** `.pi/extensions/qoder/index.ts`, `tests/integration/qoder-tool.test.ts`
**Commit:** `308374f`
**Applied fix:** A model-controlled `task` made mostly of newlines (e.g. `"\n".repeat(500)`)
could still change the confirmation dialog's HEIGHT — `ExtensionSelectorComponent` renders the
title as a single, untruncated `Text` child with the option list added after it, and
`selectedIndex` defaults to `0` (the approve choice). Replaced the character-only bound with a
flatten-then-bound pipeline: every C0/C1 control character (newlines included) is replaced with
a space, runs are collapsed, and only then is the result length-capped — so a model-controlled
string can change the excerpt's content but never the dialog's shape. Corrected the adjacent
comment's false claim that a long task could only push its own tail out of view (nothing in Pi's
or pi-tui's source supports a directional guarantee; the fix removes the premise entirely by
making the excerpt one flattened line). Added a falsified regression test asserting the captured
dialog title stays at or under 10 lines for a task with 100 internal (non-leading/trailing)
newlines — confirmed 104 lines without the fix, ≤10 with it.
**Citations re-verified before writing:** `dist/modes/interactive/components/extension-selector.js`
lines 12 (`selectedIndex = 0`), 29 (title as a single `Text` child), 35–36 (option list added
after the title) — read directly from the installed `pi-coding-agent@0.84.1` package.

### WR-02: two of four refusal branches wrote no audit record, contradicting the file's own stated "every branch writes one row" contract

**Files modified:** `.pi/extensions/qoder/index.ts`, `tests/integration/qoder-tool.test.ts`
**Commit:** `71f4cf0`
**Applied fix:** The `resolveQoderConfig` config-gate refusal (the documented defence-in-depth
path, and the only way to observe the `session_start` deactivation hook having failed) and the
WR-04 task-length refusal (the branch an adversarial or looping model hits repeatedly) both
threw with zero transcript trace. Both now write a `qoder.delegate.refused` record — `{event,
cause: "unconfigured" | "task-length", taskChars?}` — through the same redacted
`writeQoderTranscript` writer used by the confirmation records, before the throw, never the task
text. Added two falsified regression tests (one per branch); both went red when the two new
`writeQoderTranscript` calls were temporarily removed (`expected [] to have a length of 1 but
got +0`), confirmed green with the fix restored.

### WR-03: `qoder-tool.test.ts`'s own file header still described CR-01's reverted-to-broken design as current

**Files modified:** `tests/integration/qoder-tool.test.ts`
**Commit:** `15391e0`
**Applied fix:** The "WHY THE CONFIGURATION-GATE CASES NEVER CALL `execute()`" section stated
the gate is "made inside the extension's default export, evaluated once at load time from
`process.env`" — a precise description of the factory-time design that was the iteration-2
BLOCKER (CR-01), removed by commit `905dc7e`. The `describe` block's own inline comment 120
lines below already correctly described the current `session_start`-handler design, so the file
contradicted itself and pointed a maintainer at the broken shape first. Rewrote the header
section to match the correct, already-present inline description. Doc-only change; verified by
re-read and a full test-file run (9/9 passing, unchanged).

### WR-04: two `[VERIFIED]` citations pointed at a branch of `_refreshToolRegistry` that never runs from a real session — one stated the inverse of the truth

**Files modified:** `.pi/extensions/qoder/index.ts`, `tests/integration/qoder-tool.test.ts`
**Commit:** `3e2a8be`
**Applied fix:** Both citations pointed at `dist/core/agent-session.js:2008-2014`
(`_refreshToolRegistry`'s `else if (!options?.activeToolNames)` arm), which is unreachable from
session construction: `_buildRuntime` always forwards a *defined* `activeToolNames`
(`options.activeToolNames ?? ["read","bash","edit","write"]`, verified at `:2043-2046`), so that
arm's own precondition never holds. `qoder/index.ts`'s comment additionally stated the mechanism
as the *inverse* of the truth (claiming the default fires when the session was **not**
constructed with an explicit `includeAllExtensionTools` option, when the constructor at
`:158-161` always passes `includeAllExtensionTools: true`). Re-pointed both citations at the
constructor (`:158-161`) and the `else if (options?.includeAllExtensionTools)` arm that actually
runs (`:2003-2006`). The test file's own citation named the wrong suppression mechanism for the
faux harness's default `tools: []`; re-pointed at `allowedToolNames`
(`dist/core/sdk.js:133` — `options.tools ?? (options.noTools === "all" ? [] : undefined)` — and
`agent-session.js:1996-2002`, whose `if (allowedToolNames)` arm takes precedence over
`includeAllExtensionTools` because even an empty array is truthy in JS). **Every corrected
citation was read directly from the installed `pi-coding-agent@0.84.1` package
(`%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\core\agent-session.js` and
`dist\core\sdk.js`) before being written** — not copied from the reviewer's finding on faith.

### WR-05: `wire-proof.test.ts` still `delete`d the CR-01 suite guard instead of restoring it

**Files modified:** `tests/integration/wire-proof.test.ts`
**Commit:** `39b2ce0`
**Applied fix:** WR-02 (iteration 2) strengthened `tests/setup/agent-dir.ts`'s docstring into an
explicit convention: a case that needs its own temp `PI_CODING_AGENT_DIR` must restore the
suite-level value afterward, never merely `delete` it — deleting punches a hole in the guard for
the rest of that file's cases, against the developer's real, un-gitignored
`~/.pi/agent/settings.json`. `wire-proof.test.ts` was the one file left using the `delete` shape
(the two sibling files, `mode-switch.test.ts` and `agent-overrides.test.ts`, were already
converted in iteration 1). Benign today only because this file has exactly one `describe` block
(verified: `grep -n "^describe"` returns a single match); an ordinary future edit adding a
second `describe` would silently re-open CR-01's hole. Captured `process.env.PI_CODING_AGENT_DIR`
in `beforeAll` as `suiteAgentDir` and restored it (or deleted, only if it was genuinely unset) in
`afterAll`, matching the two sibling files exactly. Full `wire-proof.test.ts` suite re-run
(11/11 passing, unchanged) after the change.

## Skipped Issues

None — all five in-scope findings were fixed.

## Out of scope (unchanged, for the record)

- **IN-01** (`tests/global-teardown.ts`'s settings snapshot captures `size`/`mtimeMs` and compares
  neither) — Info tier, out of `critical_warning` scope.
- **IN-02** (iteration 2's IN-01/IN-02 — `ROUTING_EVENT` emission has no subscriber test; the
  WR-03 regression case's `resolveRoute` loop is trivially satisfied) — Info tier, out of
  `critical_warning` scope, unchanged and not worse since first raised.

---

_Fixed: 2026-08-14T21:39:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3 (final)_
