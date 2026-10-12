---
phase: 10-context-budget-progressive-disclosure
fixed_at: 2026-10-13T07:45:00Z
review_path: .planning/phases/10-context-budget-progressive-disclosure/10-REVIEW.md
iteration: 2
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-10-13T07:45:00Z
**Source review:** .planning/phases/10-context-budget-progressive-disclosure/10-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 4 (1 critical, 3 warning; Info excluded by scope)
- Fixed: 4
- Skipped: 0

The work was done directly on `main` in the main checkout. Nothing was pushed. Each test file was run on its own with `--maxWorkers=2`; the full suite was not run. Files run:
- `normalise-paths`
- `context-floor`
- `ctx-experiment`
- `docs-policy`
- `tool-profiles`
- `ky-profile-flag`
- `workflow-budgets`
- `prompt-stability`

`npx tsc --noEmit` was run once at the end and exits 0. Every new or strengthened test was checked by mutation: the subject was reverted, the test was confirmed to fail, and the code was restored.

## Fixed Issues

### CR-01: Floor measurements are not path-normalised

**Files modified:** `tests/helpers/harness-session.ts`, `tests/unit/normalise-paths.test.ts` (new), `tests/integration/context-floor.test.ts`, `scripts/ctx-experiment-core.ts`, `docs/DIAGNOSTICS.md`, `docs/EXTENSIONS.md`, `docs/ROUTING.md`
**Commit:** 18eb2e2

**Applied fix:**
- `normalisePaths` now also replaces the back-slash form of each path, and turns `\` into `/` after every `<repo>`/`<cwd>`/`<agent>` placeholder.
- A probe of the normalised prompt found one more machine-dependent part the review did not list: the background-tasks shell-policy section. It embeds the resolved shell executable (`C:\\Program Files\\Git\\usr\\bin\\bash.exe` here). On a POSIX login shell such as macOS's default zsh it also picks a different dialect and adds extra guidance lines. That alone would have kept `PAD_TOKENS` failing on macOS. The harness therefore pins `PI_BG_POSIX_SHELL=bash`, clears the other `PI_BG_*` shell variables (it saves and restores them), and replaces the `"executable"` value with `<shell>`.

**New test.** `tests/unit/normalise-paths.test.ts` checks three things:
- A back-slash `<location>` and a forward-slash one both map to `<repo>/.pi/skills/...`.
- The Windows and macOS executables both map to `<shell>`.
- A real measured prompt contains no form of the repo root, still contains `<repo>/.pi/skills/` (a non-vacuity check) and `"executable":"<shell>"`, and has no back-slash after a placeholder.

The test fails if the back-slash variant is removed, and fails if the executable replacement is removed.

**Re-measured in one pass and changed in one commit:**

| Figure | Before | After |
|---|---|---|
| `PAD_TOKENS` | 2653 | 2622 |
| `BEFORE_FULL_FLOOR` | 4233 | 4179 |
| bare | 1326 | 1303 |
| bare + AGENTS.md | 1778 | 1756 |
| background-tasks row | 1548 | 1539 |
| skills row | 344 | 321 |
| shell-policy section | ~128 | ~119 |
| recon | 1818 | 1773 |
| review | 1945 | 1900 |
| implement | 2389 | 2344 |

The attribution residual is still 0.

**Ceilings.** `FLOOR_CEILINGS` follow the existing convention: measured value × 1.03, rounded down to a ten, which is under 3% headroom. The new values are recon 1820, review 1950, implement 2410 and full 4300. Every ceiling went down; none was loosened.

**Docs.** DIAGNOSTICS.md, EXTENSIONS.md and ROUTING.md carry the new figures. DIAGNOSTICS.md now states:
- What is path-independent: the checkout path, OS and login shell.
- How a real session differs from the measured figures:
  - by the length of its actual paths (three Pi doc paths, three skill locations, the shell executable), a few tokens per path;
  - by extra shell-policy guidance on a POSIX login shell that is not bash.

**Status: fixed, needs human verification.** The figures were measured on win32 only. The new test checks that no repo path is left, but nobody has run the floor numbers on macOS. Pinning the shell is a measurement choice, so the floor shows the cost under bash rather than under the user's own login shell. DIAGNOSTICS.md says this.

### WR-01: Pre-prompt narrowing ran mid-emit

**Files modified:** `.pi/extensions/routing/index.ts`, `tests/integration/tool-profiles.test.ts`, `tests/unit/workflow-budgets.test.ts`, `docs/ROUTING.md`
**Commit:** f2dc06c

**Applied fix:** narrowing moved from `before_agent_start` to the `input` event. Pi 1.1.0 runs `input` in `prompt()` before `emitBeforeAgentStart` (`agent-session.js:1538` vs `:1591`). So every `before_agent_start` handler, background-tasks' shell-policy gate included, now sees the final loadout whatever the load order. The pass only runs when `ctx.isIdle()` is true, so a message queued during a run never drops a tool the loop has not declared yet.

**New test:** default profile, then a prompt, then `bg_run` is activated, then a second prompt. It asserts that the second request:
- does not declare `bg_run`
- carries no `pi_background_shell_policy` section
- has exactly one system message
- has a system prompt byte-identical to the first request's

Against the old hook it failed on the shell-policy assertion. All 19 existing tool-profile tests still pass, including the plan-mode-exit case.

`routing/index.ts` stays at 340 lines, so no budget was raised. The two budget reasons that named "the before_agent_start pass" were reworded.

**Status: fixed, needs human verification.** Two limits remain:
- The idle guard has no test, because a follow-up queued during a faux run is hard to stage.
- A tool that another extension activates *inside* its own `before_agent_start` handler is no longer dropped. The old hook dropped it only when routing happened to run later. No tracked extension does this.

### WR-02: Vacuous reload and new-session tests

**Files modified:** `tests/integration/tool-profiles.test.ts`
**Commit:** 7483904

**Applied fix:**
- **New-session test.** It now activates `bg_run` first, with a non-vacuity assertion that the tool is active, then emits `session_start` with reason `new` and expects `bg_run` to be gone.
- **New reload test.** It runs in a session with no messages, where only the `reason === "reload"` clause decides: it activates `bg_run`, emits a reload and expects `bg_run` to stay. This difference is observable, so the clause was kept rather than deleted.
- **Renamed test.** The old reload test is now "a reload after a request records no removal", which is what it asserts.

**Mutation check:**
- Deleting the reload clause fails the new reload test.
- Adding an early return for `new` fails the new-session test.

### WR-03: The prose root cause ignored the exclusion ceiling

**Files modified:** `scripts/ctx-experiment-core.ts`, `tests/unit/ctx-experiment.test.ts`, `docs/DIAGNOSTICS.md`
**Commit:** 64a5942

**Applied fix:** `discriminate` now returns `inconclusive` before the prose check whenever any arm in the summary fails `exclusionsAcceptable`. Of the review's two options this is the stricter one. Every arm in a summary has at least one planned trial, so this never fires on an absent arm.

**New test cases:**

| Case | Expected |
|---|---|
| Prose arm with 3 of 63 excluded (at the ceiling) | `prose-tool-calls` |
| Prose arm with 4 excluded | `inconclusive` |
| A different arm over the ceiling | `inconclusive` |

The test fails without the check. DIAGNOSTICS.md now says that any arm over the ceiling makes the whole discrimination inconclusive, `prose-tool-calls` included.

**Status: fixed, needs human verification.** This is a change to the pre-registered decision rule. It now matches the documented rule, but the documented rule had to be made more explicit to say so.

---

_Fixed: 2026-10-13T07:45:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
