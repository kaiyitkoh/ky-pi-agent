---
phase: 10-context-budget-progressive-disclosure
fixed_at: 2026-10-13T08:00:00Z
review_path: .planning/phases/10-context-budget-progressive-disclosure/10-REVIEW.md
iteration: 3
findings_in_scope: 4
fixed: 3
skipped: 1
status: partial
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-10-13T08:00:00Z
**Source review:** .planning/phases/10-context-budget-progressive-disclosure/10-REVIEW.md
**Iteration:** 3 (final; no re-review follows)

**Summary:**
- Findings in scope: 4 (2 warnings, plus the doc-only Info items IN-08 and IN-10)
- Fixed: 3 (WR-02, IN-08, IN-10)
- Skipped: 1 (WR-01: the code fix was deferred; the docs were corrected and the current behaviour is pinned by a test)

The work was done directly on `main` in the main checkout, as the orchestrator instructed. Nothing was pushed.

Each test file was run on its own with `--maxWorkers=2`; the full suite was not run. Results:

| Test file | Result |
|---|---|
| `tests/integration/tool-profiles.test.ts` | 22/22 |
| `tests/unit/docs-policy.test.ts` | 131/131 |
| `tests/unit/comment-discipline.test.ts` | 15/15 |
| `tests/unit/workflow-budgets.test.ts` | 130/130 |

`npx tsc --noEmit` was run once at the end and exits 0. No source file under `.pi/extensions` grew, so no ratchet was raised.

## Fixed Issues

### WR-02: The idle guard is load-bearing and untested

**Files modified:** `tests/integration/tool-profiles.test.ts`
**Commit:** adb6b44

**Applied fix:** added the test "a follow-up queued mid-run keeps a tool activated during that run" to the "a transcript's loadout is never narrowed again" block. The test works like this:
1. The first faux response step activates `bg_run`.
2. That step also queues `prompt("follow", { streamingBehavior: "followUp" })`.
3. The test asserts that the follow-up reached the provider (a non-vacuity check) and that its request declares `bg_run`.

**Mutation check:** `ctx.isIdle() ? ... : undefined` was replaced with an unconditional `applyProfile(...)` in `.pi/extensions/routing/index.ts`. The test then failed (`expected [ 'read', 'bash', 'edit', ... ] to include 'bg_run'`). The file was restored with `git checkout` and the test passes again.

### IN-08: The stale "once at session start" wording

**Files modified:** `docs/ROUTING.md`, `.pi/extensions/routing/profiles.ts`, `tests/integration/tool-profiles.test.ts`
**Commit:** 324f0f6

**Applied fix:** all three places now say that narrowing happens at session start, and on each idle prompt to tools the transcript has not declared. This matches the `input` handler and the ROUTING.md paragraph below it.

### IN-10: DIAGNOSTICS.md lost the backslash

**Files modified:** `docs/DIAGNOSTICS.md`
**Commit:** 428647d

**Applied fix:** "(raw, `/` and `` forms)" now reads "(raw, forward-slash and back-slash forms)". The words avoid a code span that holds a lone backslash, which is the construct that was lost the first time.

## Skipped Issues

### WR-01: Turns that an extension starts with `triggerTurn` are not narrowed

**File:** `.pi/extensions/routing/index.ts:325-338`, `.pi/extensions/plan-mode/index.ts:256-258,463-485`
**Partial work committed:** 16603fa (`docs/ROUTING.md`, `tests/integration/tool-profiles.test.ts`)

**Reason:** the code fix was judged unsafe for an unattended final iteration, with no re-review to follow. The options are:
- **Pass plan mode's restored set through a routing helper.** This changes the vendored `plan-mode/index.ts`, which would then need a seventh PROVENANCE deviation. It also couples plan mode to routing's flag and argv detection (`pi.getFlag("ky-profile")` from another extension, and `hasExplicitToolAllowlist`). That cross-extension flag read has not been verified against Pi 1.1.0.
- **Narrow on `agent_start` in routing.** `_runAgentPrompt` loops `agent.continue()` within one run (`agent-session.js:1390-1403`). Verifying that `agent_start` does not fire again on a continuation would take more source tracing. If it did fire, a tool a loader activated in the last turn would be dropped before it is declared, which is the failure WR-02's guard exists to stop. It is also unverified whether the agent loop awaits the subscriber before it builds the first request.
- **Change the extension load order** so that routing's `session_start` runs before plan mode's snapshot. This would fix only the `--plan` start-up case. It would also reorder every other handler chain (`tool_call`, `before_agent_start`).

**What was done instead:**
- `docs/ROUTING.md` now states that narrowing applies before every prompt you type or a command sends, and that turns an extension starts itself with `triggerTurn` are not narrowed. That covers plan mode's "Execute the plan", loop-police's nudges and background-tasks' completion follow-ups.
- It explains the costly case: under `--plan`, Execute declares the full pre-plan loadout, and the session then keeps it.
- It gives the workaround: leave plan mode with `/plan-mode` and type the next prompt, or enter plan mode after start-up so that its snapshot is already narrowed.
- A new test, "a turn an extension starts with triggerTurn after leaving plan mode is not narrowed", pins the current behaviour. It checks that the triggered turn reached the provider, that it declares `qoder_delegate` and `bg_run`, and that no removal is recorded. Whoever fixes this will see the test fail and must invert it. The review's suggested `dropUndeclared` helper and its test shape are the starting point.

**Original issue:** under `--plan`, plan mode's agent_end "Execute the plan" calls `restoreNormalModeTools()` and then `sendMessage(..., { triggerTurn: true })`. Pi runs that turn without `input` or `before_agent_start`. So the un-narrowed pre-plan loadout is declared and kept for the rest of the session: `full` is 4,179 tokens against 2,344 for `implement`.

## Cumulative across iterations 1-3

| Iter | Finding | Outcome | Commit(s) |
|---|---|---|---|
| 1 | CR-01 profile narrowing re-ran on resume, `/reload` and fork | fixed | 9040c3f |
| 1 | CR-02 provider key passed on the `env` command line | fixed | 2c6ebf5 |
| 1 | CR-03 crashed or errored trials scored as missed defects | fixed | 107634b |
| 1 | WR-01 plan mode at start restored the un-narrowed set | fixed for typed prompts; the `triggerTurn` path remained (iter 3, WR-01) | 209e266 |
| 1 | WR-02 default profile overrode an explicit `--tools` | fixed | 941f257 |
| 1 | WR-03 `PAD_TOKENS` included AGENTS.md | fixed | 6e40ad1 |
| 1 | WR-04 unquoted `$pad_arg` | fixed | 48ceefc |
| 1 | WR-05 `KY_EXP_KEY_VAR` denylist gap | fixed | 666e1fc |
| 1 | WR-06 "safety envelope" overstated isolation | fixed | 3ea88aa |
| 1 | WR-07 prose tool calls judged against the minimal tools | fixed | 837f149 |
| 1 | WR-08 no stopping or pooling rule | fixed | 211c0a8 |
| 1 | WR-09 unknown `--ky-profile` silently became `implement` | fixed | 19b8e9c |
| 2 | CR-01 floor measurements not path-normalised | fixed, needs human verification on macOS | 18eb2e2 |
| 2 | WR-01 pre-prompt narrowing ran mid-emit | fixed, needs human verification | f2dc06c |
| 2 | WR-02 vacuous reload and new-session tests | fixed | 7483904 |
| 2 | WR-03 prose root cause ignored the exclusion ceiling | fixed, needs human verification | 64a5942 |
| 3 | WR-01 `triggerTurn` turns not narrowed | skipped (code); docs corrected and behaviour pinned | 16603fa |
| 3 | WR-02 idle guard untested | fixed (mutation-checked) | adb6b44 |
| 3 | IN-08 stale "once at session start" wording | fixed | 324f0f6 |
| 3 | IN-10 lost backslash in DIAGNOSTICS.md | fixed | 428647d |

Totals: 20 findings acted on, 19 fixed and 1 skipped with a documented workaround and a pinning test.

## Remaining and accepted Info items (iteration 3 review)

These were out of scope for this pass and remain open. None changes runtime behaviour on the measured paths.

| ID | Item | Disposition |
|---|---|---|
| IN-01 | Routing's "best-effort" comment sits above `registerFlag`; the flag hard-codes the default and the profile list | Open, cosmetic |
| IN-02 | `FLOOR_LABEL` (46 chars) overflows `LABEL_WIDTH` (30); the test checks only `~` | Open, cosmetic |
| IN-03 | `findUnclassified` uses `in`, while `applyProfile` uses `Object.hasOwn` | Open; it matters only for a tool named like an `Object.prototype` key |
| IN-04 | AGENTS.md comment-rule violations in `shell-policy-gate.test.ts:3` and `context-floor.test.ts:40` | Open |
| IN-05 | `context-floor.test.ts` blocks share mutable state, so running with `-t attribution` throws on its own | Open |
| IN-06 | PROVENANCE deviation 9 overstates "no `bg_*` outside `full`" | Open, doc accuracy |
| IN-07 | Lint scope, missing launcher `trap`, `prepare` failure under `set -e`, `usage` from the last message only, denylist leak check | Open, carried over |
| IN-09 | `--tools` argv detection is over-broad; a changed `--ky-profile` on resume is silently ignored | Open, carried over |
| IN-11 | The machine-path test inspects only the system prompt and the repo root, not the tool text, tmpdir or homedir | Open; a probe found nothing machine-specific today |

---

_Fixed: 2026-10-13T08:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
