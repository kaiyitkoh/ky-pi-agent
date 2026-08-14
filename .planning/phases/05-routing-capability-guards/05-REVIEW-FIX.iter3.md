---
phase: 05-routing-capability-guards
fixed_at: 2026-08-14T21:10:00Z
review_path: .planning/phases/05-routing-capability-guards/05-REVIEW.md
iteration: 2
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-08-14T21:10:00Z
**Source review:** .planning/phases/05-routing-capability-guards/05-REVIEW.md
**Iteration:** 2 (this report supersedes the iteration-1 report and reflects both iterations' work)

**Summary (iteration 2):**
- Findings in scope: 8 (1 BLOCKER, 7 Warning — `fix_scope: critical_warning`; IN-01..IN-03 out of scope)
- Fixed: 8
- Skipped: 0

**Autonomous run note:** Unattended run per the standing autonomous-run policy. Every fix was applied
inside an isolated git worktree (`gsd-reviewfix/05-<pid>`, fast-forwarded onto `main` after this
report was written), verified per fix with the 3-tier strategy (re-read, `npx tsc --noEmit`, and a
live mutate/confirm-red/revert falsification against the test(s) written or extended for that
finding), and committed atomically. The full suite and typecheck were run once at the end:
**`npx vitest run` — 1373 tests / 80 files passed. `npm run typecheck` — clean.**

## Critical discovery this iteration made and had to design around

CR-01's own fix guidance (move the deactivation into `pi.on("session_start", ...)`) is
architecturally correct, but **`session_start` does not fire at all inside this repository's
`createFauxSession` test harness** — this is independently measured and already documented by
`tests/integration/call-model.test.ts` and `tests/integration/mode-persistence.test.ts` ("Pi emits
`session_start` from `AgentSession`'s extension-binding step, which the headless factory this
repository's test helpers use does not reach"). A naive test that only asserted
`getActiveToolNames()` immediately after `createFauxSession` would never actually exercise the fix.
The resolution: `ExtensionRunner` exposes a public, typed `emit<TEvent extends RunnerEmitEvent>()`
method [VERIFIED: pi-coding-agent 0.84.1 `dist/core/extensions/runner.d.ts:146`; `SessionStartEvent`
is not among `RunnerEmitEvent`'s exclusions], so the new tests call
`handle.session.extensionRunner.emit({ type: "session_start", reason: "startup" })` directly —
proving the real registered handler runs, deterministically, in-process, rather than only asserting
about its source text. Every fix below was mutate/confirm-red/revert tested against the real
committed source, not against this discovery in isolation.

## Fixed Issues (iteration 2)

### CR-01 [BLOCKER]: WR-11's configuration gate called `pi.getActiveTools()` during extension load

**Files modified:** `.pi/extensions/qoder/index.ts`, `tests/integration/qoder-tool.test.ts`
**Commit:** 905dc7e
**Applied fix:** `pi.getActiveTools()`/`pi.setActiveTools()` throw "Extension runtime not
initialized" when called from an extension factory; Pi then discards the WHOLE extension, which is
exactly what iteration 1's WR-11 fix caused on every unconfigured machine (this laptop, CI).
Reproduced via `createFauxSession` before the fix, confirmed absent after. Moved the gate into a
`pi.on("session_start", ...)` handler — the same precedent `safety/index.ts` and `routing/index.ts`
already use — wrapped in try/catch so a hook failure degrades to "tool stays active, refuses
actionably at call time" rather than crashing the session. Rewrote the WR-11 configuration-gate
tests to (1) assert the tool DEFINITION exists before asserting anything about activation — this
alone turns the old false-pass red — and (2) call `extensionRunner.emit({ type: "session_start" })`
to invoke the real handler (see the discovery section above). Mutate/confirm-red/revert performed
against the real source: reintroducing the factory-time call reproduces the crash and the new test
catches it.

### WR-01 (iter2): `usesFallbackChain`'s docstrings still described the pre-CR-02 dispatch rule

**Files modified:** `.pi/extensions/routing/modes.ts`
**Commit:** 1b0235e
**Applied fix:** CR-02 (iteration 1) replaced `usesFallbackChain`'s only production call site with
an inline `resolvedIsChainHead` check, but three doc comments (module docstring,
`usesFallbackChain`'s own docstring, `runSingleShotRole`'s docstring) still described chain
MEMBERSHIP as sufficient to justify `callWithFallback()` — exactly the mistake CR-02 fixed. Rewrote
all three to state only the chain HEAD qualifies and that `usesFallbackChain` is now a tested,
callerless pure predicate. Doc-only; verified via `tsc --noEmit` and a full re-read.

### WR-02 (iter2): the CR-01 test guard was not in force at test-file MODULE scope

**Files modified:** `tests/setup/agent-dir.ts`, `tests/unit/agent-dir-setup.test.ts` (new)
**Commit:** e70bb44
**Applied fix:** `PI_CODING_AGENT_DIR` was set inside `beforeAll`, which runs after a test file's own
module body is evaluated — a test file (or a helper it imports) that resolved `getAgentDir()` at
IMPORT TIME could still reach this machine's real `~/.pi/agent`, despite the file's own "no test
file can opt out of this by omission" claim. Moved the assignment to module scope (setupFiles run
before the test file's own module body); `beforeAll` now only re-asserts the value. Softened the
docstring. Added `tests/unit/agent-dir-setup.test.ts`, which captures the env var at ITS OWN module
scope (the only way to observe the import-time window) and asserts it was already set.
Mutate/confirm-red/revert performed: reverting to `beforeAll`-only reproduces `undefined` at import
time and the new probe test catches it.

### WR-03 (iter2): the Qoder delegation confirmation decision was recorded nowhere

**Files modified:** `.pi/extensions/qoder/client.ts`, `.pi/extensions/qoder/index.ts`,
`tests/integration/qoder-tool.test.ts`
**Commit:** 3ae1bb0
**Applied fix:** Exported `client.ts`'s existing `writeQoderTranscript` (same redacted writer/stream
`delegateTask` already uses) and called it from `index.ts` on BOTH branches — approved and declined
— before either returning or throwing: `{ event: "qoder.delegate.confirm", hasUI, approved,
taskChars }`, never the task text itself. Extended the existing decline and approve integration
cases to assert exactly one record lands with the right `approved`/`hasUI` values.
Mutate/confirm-red/revert performed: disabling the write makes both extended cases fail on the
missing record.

### WR-04 (iter2): the Qoder task-length validation ran AFTER the human confirmation prompt

**Files modified:** `.pi/extensions/qoder/index.ts`, `tests/integration/qoder-tool.test.ts`
**Commit:** c98fa2a
**Applied fix:** `qoderDelegateSchema` had no `maxLength`, and `MAX_TASK_CHARS`/the empty-task
refusal lived inside `delegateTask`, which iteration 1's WR-11 made run AFTER the human decision — an
unbounded, model-controlled `task` was interpolated into `ctx.ui.select`'s dialog title before any
validation ran, letting a long task push the bypass warning out of view. Moved the trim/length check
to the tool boundary, before `ctx.ui.select` is ever called, and render only a bounded excerpt (500
chars) with the bypass warning FIRST and the excerpt LAST. Added a case asserting `ctx.ui.select` is
never called for an over-limit task (`selectCallCount` stays 0, zero requests reach the loopback).
Mutate/confirm-red/revert performed: disabling the early check reproduces a `select()` call for an
over-limit task and the new test catches it.

### WR-06 (iter2): the inactivity-timeout and malformed-session-id paths wrote no terminal transcript record

**Files modified:** `.pi/extensions/qoder/client.ts`, `tests/integration/qoder-delegate.test.ts`
**Commit:** b4bd854
**Applied fix:** `qoder.delegate.result` was only written at the very end of `delegateTask`,
unreachable from three earlier throw sites (two inactivity-timeout checks, one malformed-session-id
refusal) — the same gap iteration 1's WR-06 closed for the stream-open step, on the exact file
RB-05-01 step 4 tells the operator to read. Added a `qoder.delegate.failed` record (through the same
redacted writer) before each throw: `{ cause: "inactivity-timeout", afterMs, textChars }` for the two
timeout sites, `{ cause: "malformed-session-id" }` for the id refusal — never the offending id
itself. Extended the existing WR-07/WR-08 tests to assert the new record and that the malformed id is
never echoed into the transcript. Mutate/confirm-red/revert performed: disabling all three writes
makes both extended cases fail on the missing record.

### WR-07 (iter2): the atomic-write temp file was orphaned on failure and its name could collide

**Files modified:** `.pi/extensions/routing/agent-overrides.ts`, `tests/unit/agent-overrides.test.ts`
**Commit:** b082868
**Applied fix:** Two defects in iteration 1's WR-02 atomic-write fix: (1) if `renameSync` failed
(EPERM/EXDEV/a Windows lock), the temp file was left orphaned in the user's GLOBAL `~/.pi/agent/`
forever; (2) the temp name was keyed on `process.pid` alone, which two jiti copies of the same module
in one process share, so two concurrent `applyMode` calls could collide and produce a spurious
refusal for a write that had actually succeeded. Added `randomUUID()` to the temp name and wrapped
the write/rename in its own try/catch that best-effort `rm`'s the temp file before rethrowing. Added
a case that mocks `node:fs`'s `renameSync` to throw (the only platform-independent way to exercise
this path) and asserts no `*.tmp` survives. Mutate/confirm-red/revert performed: dropping the cleanup
reproduces an orphaned temp file and the new test catches it.

### WR-05 (iter2): the docs contradicted WR-11's behavior change

**Files modified:** `docs/ROUTING.md`, `docs/RUNBOOK.md`
**Commit:** e914059
**Applied fix:** `docs/ROUTING.md` §6 still promised "the tool refuses actionably... when any of the
three is unset" — false once CR-01 is fixed, since the tool is deactivated and never offered to the
model at all when unconfigured. Neither doc mentioned WR-11's human-in-the-loop confirmation or that
it refuses outright with no UI bound. Added a "Two gates" paragraph to ROUTING.md §6 (unconfigured ⇒
not offered at all; configured ⇒ every invocation requires an explicit human selection, headless
refuses by design) and a sentence to RB-05-01 step 3 naming the approval dialog and that the check
cannot be run headlessly. RB-05-01's OUTSTANDING status is unchanged in both places it appears —
verified against `tests/unit/docs-policy.test.ts` (73/73 passing).

## Skipped Issues (iteration 2)

None — all 8 in-scope findings were fixed.

---

## Iteration 1 (prior run — summary, full detail in git history)

**Findings in scope:** 14 (3 Critical, 11 Warning)
**Fixed:** 14 **Skipped:** 0

CR-01 (real `~/.pi/agent/settings.json` write hole), CR-02 (fallback-chain candidate discarded),
CR-03 (truncated Qoder stream returned as complete), WR-01 (cheap-mode chain adjudication closed),
WR-02 (`writeAgentOverrides` throw/non-atomic write), WR-03 (`getModeState` accepted any string
mode), WR-04 (`data: null` TypeError), WR-05 (mode switch cleared escalation with no record), WR-06
(no transcript for the Qoder stream-open step), WR-07 (no SSE read timeout), WR-08 (unencoded
session id), WR-09 (`MAX_TASK_CHARS` untested), WR-10 (self-fulfilling "never reached" case), WR-11
(`qoder_delegate` gates — confirmation half correct, configuration half was iteration 2's CR-01
regression). See commit messages `b4a5711`..`456087e` on this branch's history for full detail per
finding; the iteration-1 report body previously at this path is preserved in git history (this file
overwrites it per the fixer's own instructions).

---

_Fixed: 2026-08-14T21:10:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
