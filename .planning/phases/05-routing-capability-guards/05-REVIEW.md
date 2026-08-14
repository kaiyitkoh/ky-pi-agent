---
phase: 05-routing-capability-guards
reviewed: 2026-08-14T21:25:00Z
depth: standard
iteration: 3
files_reviewed: 20
files_reviewed_list:
  - .pi/extensions/qoder/client.ts
  - .pi/extensions/qoder/index.ts
  - .pi/extensions/routing/agent-overrides.ts
  - .pi/extensions/routing/guard.ts
  - .pi/extensions/routing/index.ts
  - .pi/extensions/routing/modes.ts
  - .pi/extensions/routing/schema.ts
  - docs/ROUTING.md
  - docs/RUNBOOK.md
  - tests/setup/agent-dir.ts
  - tests/global-teardown.ts
  - vitest.config.ts
  - tests/unit/agent-dir-setup.test.ts
  - tests/integration/qoder-delegate.test.ts
  - tests/integration/qoder-tool.test.ts
  - tests/integration/wire-proof.test.ts
  - tests/integration/single-shot-roles.test.ts
  - tests/unit/agent-overrides.test.ts
  - tests/unit/routing-dispatch.test.ts
  - tests/unit/docs-policy.test.ts
findings:
  critical: 0
  warning: 5
  info: 2
  total: 7
status: issues_found
resolved_after_review: true
resolved_by_commits: 308374f..39b2ce0
resolution_report: .planning/phases/05-routing-capability-guards/05-REVIEW-FIX.md
---

> **RESOLUTION NOTE (orchestrator, autonomous run).** This file records the state of the code at
> review time. All 5 Warning findings below were subsequently fixed in the iteration-3 fix pass
> (commits `308374f`, `71f4cf0`, `15391e0`, `3e2a8be`, `39b2ce0`) and are reported in
> `05-REVIEW-FIX.md` with `status: all_fixed`, `skipped: 0`. The `status: issues_found` field above
> is left unchanged because it faithfully describes the review, not the current tree. The 2 Info
> findings (IN-01, IN-02) were out of the `critical_warning` fix scope and are ACCEPTED.
> Post-fix verification: 80 test files / 1376 tests green, `tsc --noEmit` clean.

# Phase 5: Code Review Report (iteration 3 — FINAL)

**Reviewed:** 2026-08-14T21:25:00Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found (no BLOCKER)

## Summary

**All eight iteration-2 fixes are real, load-bearing and verified at source.**
The iteration-2 BLOCKER (CR-01, Qoder's configuration gate calling
`pi.getActiveTools()` from the extension factory) is genuinely fixed, and —
unlike iteration 1's WR-11 — the fix was **falsified in this review, not taken
on trust**: I ran four mutate/confirm-red/revert experiments against the real
committed source and confirmed each goes red. None of iteration 1's still-standing
fixes were disturbed. ROADMAP criterion 1 remains CLOSED for `cheap`, `balanced`
and `max`. All five architectural invariants hold.

**The phase is in a shippable state.** No finding below is a BLOCKER. Five
warnings remain, four of which are documentation/comment defects of the exact
class that iteration 2's own WR-01 identified as "how a fixed bug comes back",
and one of which (WR-01 below) is a residual half of iteration 2's WR-04 that
should be closed **before Qoder is ever configured** (i.e. before RB-05-01 is
run on the work laptop).

`npx vitest run` — **1373 tests / 80 files passed**. `npm run typecheck` — clean.
Working tree restored byte-clean after every falsification (`git status --porcelain`
shows only `.planning/` artifacts).

### Falsification experiments run in this review (mutate → confirm red → revert)

| Mutation applied to real committed source | Test that went red | Verdict |
|---|---|---|
| Delete the whole `pi.on("session_start", …)` block from `qoder/index.ts` | `qoder-tool.test.ts:231` — *"qoder_delegate is STILL active after session_start fired"* | Gate is **load-bearing**, not decorative |
| Re-introduce the factory-time `pi.getActiveTools()` call (iteration 2's CR-01) | `qoder-tool.test.ts:212` — *"the extension failed to load at all (factory threw and Pi discarded it)"* | The non-vacuity guard **really catches** the iteration-2 regression |
| Revert `tests/setup/agent-dir.ts` to `beforeAll`-only | `agent-dir-setup.test.ts:38` — *"PI_CODING_AGENT_DIR was undefined at this file's own import time"* | WR-02's module-scope isolation is **really in force** |
| Delete the `qoder.delegate.confirm` write from `qoder/index.ts` | both `qoder-tool.test.ts` confirmation cases (decline + approve) | WR-03's audit record is **reachable on both branches** |
| Delete the `qoder.delegate.failed / malformed-session-id` record from `client.ts` | `qoder-delegate.test.ts:643` | WR-06's terminal record is **load-bearing** |

### Verification verdicts on iteration 2's eight findings

| Finding | Verdict | Evidence |
|---|---|---|
| **CR-01** [BLOCKER] (factory-time `getActiveTools()`) | **FIXED, and correct in production** | The factory now calls only `pi.registerTool` and `pi.on` (`qoder/index.ts:112-265`); the gate moved to `pi.on("session_start", …)` at `:257-265`, wrapped in `try`/`catch`. Verified the whole chain at source: `ExtensionRunner#emit()` dispatches to the **real registered handlers** (`dist/core/extensions/runner.js:579-608` — `ext.handlers.get(event.type)` then `await handler(event, ctx)`), and production reaches that exact method via `AgentSession#bindExtensions()` → `this._extensionRunner.emit(this._sessionStartEvent)` (`dist/core/agent-session.js:1761`), which **every** mode calls (`interactive-mode.js:1379`, `print-mode.js:53`, `rpc-mode.js:230`). So the test's `extensionRunner.emit({type:"session_start"})` is not "asserting on its own emit" — it is the same method, on the same runner, invoking the same handler map that production uses. `setActiveToolsByName` mutates `agent.state.tools` **and rebuilds the system prompt** (`agent-session.js:631-643`), so the ~329 tokens really do go away before the first request. Both falsifications above confirm the test would fail if the handler were removed **and** if the factory-time call came back. |
| **WR-01** (stale `usesFallbackChain` docs) | **FIXED** | All three comments corrected: module docstring `modes.ts:69-74` now states membership is "a fact about `CHAIN`, not a dispatch rule"; `usesFallbackChain`'s own docstring `:294-300` says only the HEAD qualifies and names `resolvedIsChainHead`; `runSingleShotRole`'s docstring `:378-382` now says "is the HEAD of the fixed fallback chain (CR-02: not merely a member)". The dispatch code at `:427-446` is unchanged and still honours the resolved candidate. |
| **WR-02** (guard not in force at module scope) | **FIXED, falsified** | `tests/setup/agent-dir.ts:66-67` assigns at module scope; `beforeAll:69-76` only re-asserts. `agent-dir-setup.test.ts:29` captures at its **own** module scope (the only observation point that can see the window) and asserts three things, including that the value matches `/kypi-agent-dir-suite-/` — so a developer who happens to export `PI_CODING_AGENT_DIR` in their shell cannot make it pass for the wrong reason. Reverting the fix reproduces `undefined` and turns the test red. Iteration 2's IN-03 (`afterAll` dereferencing a possibly-unassigned `dir`) is **incidentally resolved** — `dir` is now a module-scope `const`, so a `mkdtempSync` failure fails the setup file loudly instead of masking itself in `afterAll`. |
| **WR-03** (confirmation decision unrecorded) | **FIXED, reachable on both branches** | `qoder/index.ts:185-190` writes `{event:"qoder.delegate.confirm", hasUI, approved, taskChars}` through `client.ts`'s own exported `writeQoderTranscript` (`client.ts:507-513`) — the same `redactDeep` + `appendJsonl` writer, never a second one, and never the task text. Placed **before** the `if (!approved) throw` at `:192`, so the decline branch is covered. Falsified: removing the write reddens both confirmation cases. |
| **WR-04** (validation behind the human prompt) | **FIXED for length; see WR-01 below for the residual** | `qoder/index.ts:141-147` trims and bounds **before** `ctx.ui.select` is reachable at `:166`. `qoder-tool.test.ts:345-391` asserts `selectCallCount === 0` and `loop.received` length 0 for an over-limit task — a genuine paired absence-plus-positive-control. |
| **WR-05** (docs contradicted WR-11) | **FIXED** | `docs/ROUTING.md` §6 gained a "Two gates, not one" block (`:250-273`) stating (a) unconfigured ⇒ not offered to the model at all, (b) configured ⇒ explicit human selection, headless refuses by design, and that both branches write a `qoder.delegate.confirm` record. `docs/RUNBOOK.md` RB-05-01 step 3 gained the approval-dialog sentence and "this check cannot be run headlessly". |
| **WR-06** (no terminal transcript on three throw paths) | **FIXED, one falsified** | `client.ts:646` (malformed-session-id), `:717-722` and `:752-757` (both inactivity-timeout sites) each write `qoder.delegate.failed` with a `cause` before throwing. The malformed-id record is asserted at `qoder-delegate.test.ts:640-650` **together with** a check that the offending id never appears in the transcript; removing the write reddens it. |
| **WR-07** (orphaned/colliding temp file) | **FIXED** | `agent-overrides.ts:464-478`: `${path}.${pid}.${randomUUID()}.tmp`, inner `try`/`catch` that best-effort `rmSync`es before rethrowing into the outer refusal. The new test (`agent-overrides.test.ts:337-386`) mocks only `node:fs#renameSync` (spreading `importActual` so `writeFileSync` stays real, which is what makes the orphan actually get created), asserts no `*.tmp` survives **and** that the call still returns `ok:false` rather than throwing, and unmocks in its own `afterEach` so no other case in the file is affected. |

### Regression check on iteration 1's still-standing fixes

- **CR-02** (resolved chain-member candidate discarded) — **INTACT.** `modes.ts:427-446` still enters `callWithFallback` only when the resolved ref *is* `CHAIN[0]`, and serves every other candidate through `callModel(ctx, {…, model: plan.model, …})`. The regression test (`single-shot-roles.test.ts:612-707`) is unchanged, still asserts `hasConfiguredAuth("deepseek") === false` as a precondition, the reply text, `nested[0].provider === "dashscope"`, **zero** `provider === "deepseek"` rows, and the corr-joined `nested.request` payload model.
- **CR-03** (truncated Qoder stream) — **INTACT.** `client.ts:793-802` (trailing `decoder.decode()` + final `parseSseFrames` pass, placed after the `finally`) and `:816-822` (`if (!folded.done) throw`). Iteration 2's WR-06 edits inserted records *before* the throw sites without moving either half. Both loopback cases still pass with their own fixture preconditions.
- **WR-01 iter1 / cheap-mode wire proof** — **INTACT.** `wire-proof.test.ts:352-437` unchanged; it still switches the executor to the flash tier first (`:371`) so the "advisor ≠ executor" comparison is `pro` vs `flash`, and still joins the second oracle by `corr`.

### Architectural invariants

1. **Chokepoint** — HOLDS. `CHOKEPOINT_BYPASS_ALLOWLIST` is still `[]` (`tests/unit/chokepoint-lint.test.ts:89`); no exemption was added by any of the eight commits.
2. **`safety/` ↛ `routing/`** — HOLDS. The only occurrence of "routing" under `.pi/extensions/safety/` is a prose reference in `safety/schema.ts:11`; there is no import in either direction.
3. **Zero-context mode persistence** — HOLDS. Every record iteration 2 added (`qoder.delegate.confirm`, `qoder.delegate.failed`) goes to `.pi/logs/qoder-*.jsonl` via `appendJsonl`; nothing new touches `pi.appendEntry` or the context window.
4. **Qoder is a delegate tool only** — HOLDS. `grep -rin qoder .pi/extensions/routing/ .pi/extensions/providers/ .pi/*.json` returns exactly one prose mention (`routing/index.ts:186`) and nothing in `models.json`, `ROLE_MAP`, `CHAIN` or the guard. Official Cloud Agents surface only (`client.ts:609,660,684`); no bypass-proxy behaviour anywhere.
5. **No credential committed / PAT never transcribed** — HOLDS after all edits. `requestHeaders()` (`client.ts:557-559`) is the only place the token is placed; the new `qoder.delegate.confirm` record carries `{event, hasUI, approved, taskChars}` only, and `qoder-delegate.test.ts:379-381` still asserts the transcript contains neither the fixture token nor `authorization`/`bearer` in any casing.

**RB-05-01 remains OUTSTANDING** in both the summary table (`docs/RUNBOOK.md:935`) and the detail section (`:939`), and `tests/unit/docs-policy.test.ts:400-431` still gates both halves and reports a half-flip as `INCONSISTENT`. Correct; no finding is filed against it.

### ROADMAP criterion 1 — re-confirmed CLOSED for all three modes

`ROLE_MAP.cheap.advisor.candidates[0]` is `deepseek/deepseek-v4-pro`
(`schema.ts:205,224,251`); `CHAIN` is flash-only
(`providers/schema.ts:359-362`). So `cheap.advisor` is genuinely not a chain
member and, post-CR-02, is dispatched through `callModel` with the router's own
resolved model. `wire-proof.test.ts` Task 3 still proves the nested row's
provider **and** model, the corr-joined wire payload's model, non-identity with
the session executor at that moment, and `advisorRef.id !== "deepseek-v4-flash"`.
**Criterion 1 is CLOSED for `cheap`, `balanced` and `max`.**

---

## Warnings

### WR-01 [WARNING]: iteration 2's WR-04 bounded the confirmation excerpt by CHARACTERS but not by LINES or control characters — and its rationale comment asserts a rendering property nothing verifies

**File:** `.pi/extensions/qoder/index.ts:148-151`, `:163-165`, `:166-174`

**Issue:** The excerpt is capped at 500 **characters** and then interpolated
verbatim into `ctx.ui.select`'s title. A model-controlled `task` of
`"\n".repeat(500)` therefore still produces a ~500-line dialog title. Three
facts verified at source make this more than cosmetic:

1. `ExtensionSelectorComponent` renders the title as a **single, untruncated,
   un-line-capped** `Text` child
   [VERIFIED: pi-coding-agent 0.84.1 `dist/modes/interactive/components/extension-selector.js:29`].
2. The **option list is added after the title**
   (`:35-36`), so the title's height determines where the two choices land.
3. `selectedIndex` defaults to `0` (`:12`), and this file passes
   `[DELEGATE_CHOICE, CANCEL_CHOICE]` (`index.ts:172`) — so **the pre-highlighted
   option is the approve one**. (`safety/index.ts:523-527` has the identical
   `[APPROVE_CHOICE, DENY_CHOICE]` ordering, so a fix here should be considered
   for both.)

The code comment at `:163-165` states the fix's rationale as fact:

> *"the bypass warning comes FIRST and the (now bounded) task excerpt LAST, so a
> long task can push only its own tail out of view, never the warning the user
> needs to read first."*

That is an assertion about terminal rendering, and nothing in the repository or
in Pi's source supports it. Pi's main-screen renderer writes the whole component
buffer to the terminal (`pi-tui/dist/tui-main-screen.js:153-200`), so on a
terminal shorter than the dialog it is the **top** of the title — the bypass
warning — that scrolls out of view, not the tail. [UNVERIFIED: the exact
on-screen outcome, which depends on viewport anchoring I could not exercise
without a real terminal. What IS verified is (1)-(3) above and the absence of
any line cap anywhere in the path.] Either way, the comment claims a guarantee
the code does not provide.

Not a BLOCKER today: `qoder_delegate` is deactivated on every unconfigured
machine (this laptop, CI), so the dialog is unreachable. **It becomes live the
moment RB-05-01 is run on the work laptop**, which is exactly when a
model-controlled string starts driving a security confirmation on a box where
`main` auto-deploys.

**Fix:** bound line count as well as character count, and drop control
characters, before the excerpt reaches the dialog:

```ts
// Replace every C0/C1 control character (newlines included) with a space, then
// collapse runs, THEN bound the length. Written without regex escapes so it is
// unambiguous: a model-controlled string must not be able to change the SHAPE
// of a security dialog, only its content.
const flattened = Array.from(task)
    .map((ch) => {
        const cp = ch.codePointAt(0) ?? 0;
        return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ? " " : ch;
    })
    .join("")
    .replace(/  +/g, " ")
    .trim();
const excerpt =
    flattened.length > CONFIRM_EXCERPT_CHARS
        ? `${flattened.slice(0, CONFIRM_EXCERPT_CHARS)}… (${task.length} chars total)`
        : flattened;
```

and correct the `:163-165` comment to state what is then actually true (the
excerpt is one flattened line of bounded width, so it cannot change the dialog's
height at all). Add a case asserting `select`'s captured title has at most N
lines for a newline-stuffed task.

### WR-02 [WARNING]: `qoder/index.ts` claims to mirror safety's "every branch writes exactly one audit row" contract — two of its four refusal branches write nothing

**File:** `.pi/extensions/qoder/index.ts:121-126`, `:141-147`, `:180-190`

**Issue:** The comment introducing WR-03's record says, verbatim:

> *"mirroring `safety/index.ts#registerApprovalTool`'s own 'every branch writes
> exactly one audit row' contract"* (`:182-184`).

That contract genuinely holds in `safety/index.ts`: the `validate()` refusal
writes a row (`:502-510`), the deny branch writes one (`:531-541`), the
unreachable `approve()`-false branch writes one (`:549-558`), and the allow
branch writes one (`:562-569`). In `qoder/index.ts` it holds for exactly two of
four branches:

| Branch | Record written? |
|---|---|
| `resolveQoderConfig` refusal (`:122-126`) | **no** |
| WR-04 length/empty refusal (`:142-147`) | **no** |
| declined / no-UI (`:192-199`) | yes |
| approved (`:201-216`) | yes |

The length-refusal gap is the one that matters: it is the branch an adversarial
or looping model hits repeatedly, and it now leaves **zero** trace anywhere —
no transcript record, no audit row, nothing for the operator RB-05-01 step 4
sends to `.pi/logs/qoder-*.jsonl`. The config-refusal gap is the documented
defence-in-depth path (`docs/ROUTING.md:265-268`), so a record there is also the
only way to observe the deactivation hook having failed.

**Fix:** write one record on each of the two silent branches, through the same
redacted writer, before the throw:

```ts
writeQoderTranscript(ctx.cwd, { event: "qoder.delegate.refused", cause: "unconfigured" });
// and
writeQoderTranscript(ctx.cwd, { event: "qoder.delegate.refused", cause: "task-length", taskChars: task.length });
```

Never the task text. Then the `:182-184` comment becomes true as written.

### WR-03 [WARNING]: `qoder-tool.test.ts`'s file header still describes CR-01's reverted-to-broken design as the current one

**File:** `tests/integration/qoder-tool.test.ts:32-41`

**Issue:** The header section *"WHY THE CONFIGURATION-GATE CASES NEVER CALL
`execute()`"* still reads:

> *"the gate this file's own WR-11 fix applies is a ONE-TIME decision made
> inside the extension's default export, evaluated once at load time from
> `process.env`, not a per-call check."*

"Made inside the extension's default export, evaluated once at load time" is a
precise description of **the factory-time gate that was the iteration-2
BLOCKER** — the design that crashed the whole extension and that commit
`905dc7e` removed. The `describe` block's own inline comment 120 lines below
(`:168-190`) correctly describes the `session_start` design, so the file now
contradicts itself, and the contradiction points a maintainer at the broken
shape first. This is precisely the failure class iteration 2's own WR-01 filed
against `usesFallbackChain` ("documentation that contradicts the fix is how a
fixed bug comes back") — the fixer corrected that instance and left this one.

**Fix:** rewrite `:32-41` to say what is now true, e.g.:

```
 * WHY THE CONFIGURATION-GATE CASES NEVER CALL `execute()`
 * They prove only whether `session.getActiveToolNames()` contains
 * `"qoder_delegate"` AFTER a real `session_start` is emitted. The gate is a
 * once-per-session decision made in a `session_start` HANDLER (CR-01: it
 * cannot live in the factory -- `pi.getActiveTools()`/`setActiveTools()`
 * throw there), reading `process.env` at that moment -- which is why
 * `process.env` is set BEFORE `createFauxSession` in those cases and
 * restored in each case's own `finally`.
```

### WR-04 [WARNING]: both "a newly-registered tool is active by default" citations point at a branch of `_refreshToolRegistry` that never runs from a real session

**Files:** `.pi/extensions/qoder/index.ts:239-246`; `tests/integration/qoder-tool.test.ts:155-166`

**Issue:** Two load-bearing `[VERIFIED: …]` / `[MEASURED …]` citations are
attached to the wrong branch, and one of them states the inverse of the truth.

1. `qoder/index.ts:240-245` cites `dist/core/agent-session.js:2008-2014` and
   says the tool is active by default *"when the session was **not**
   constructed with an explicit `activeToolNames`/`allowedToolNames`/
   **`includeAllExtensionTools`** option"*. In fact `AgentSession`'s constructor
   **always** calls `_buildRuntime({ activeToolNames: …, includeAllExtensionTools: true })`
   [VERIFIED: `dist/core/agent-session.js:158-161`], and `_buildRuntime` always
   forwards a defined `activeToolNames` (`options.activeToolNames ?? ["read","bash","edit","write"]`,
   `:2043-2045`). So the cited `else if (!options?.activeToolNames)` arm at
   `:2008` is **unreachable from session construction**; the arm that actually
   activates `qoder_delegate` is `else if (options?.includeAllExtensionTools)`
   at `:2003-2006`. The behavioural conclusion ("it starts active, so the gate
   has something to act on") is correct — I verified it independently — but the
   stated mechanism is not, and it is stated as the *negation* of the mechanism
   that is really responsible.
2. `qoder-tool.test.ts:156-166` attributes the faux harness's suppression to
   *"an EXPLICIT (though empty) `activeToolNames` array … (that default only
   fires when `activeToolNames` was never supplied at all)"*. The real mechanism
   is `allowedToolNames`: `createAgentSession` maps `options.tools` to it
   (`dist/core/sdk.js:133`), and `_refreshToolRegistry`'s `if (allowedToolNames)`
   arm (`:1996-2002`) takes precedence over `includeAllExtensionTools`. Under
   the comment's own stated rule, the auto-activate default would never fire in
   production either — which would make the gate pointless, and is not true.

This matters in a repository whose standing rule is *"verify at source, not
docs"*: a future maintainer checking whether the gate is still needed after a Pi
upgrade will grep `agent-session.js:2008-2014`, find an unrelated branch, and
draw the wrong conclusion.

**Fix:** re-point both citations at `dist/core/agent-session.js:158-161` (the
constructor's `includeAllExtensionTools: true`) and `:2003-2006` (the arm that
consumes it), and correct the test comment to name `allowedToolNames` /
`dist/core/sdk.js:133` / `agent-session.js:1996-2002`.

### WR-05 [WARNING]: `wire-proof.test.ts` still `delete`s the CR-01 suite guard instead of restoring it — the one pattern `tests/setup/agent-dir.ts` now explicitly forbids

**File:** `tests/integration/wire-proof.test.ts:457-460`

**Issue:** WR-02's fix strengthened `tests/setup/agent-dir.ts`'s docstring into
an explicit convention (`:49-54`):

> *"cases that need their OWN temp dir … must restore this suite value
> afterward, **never merely `delete` it** — deleting would punch a hole in this
> guard for the REST of that file's cases."*

`wire-proof.test.ts:458` still does exactly that. It is benign **today** only
because it is the last hook of the file's only `describe` (verified: `grep -n
"^describe" tests/integration/wire-proof.test.ts` returns one match, at `:446`).
The two sibling files that had the same pattern were converted to the restore
shape in iteration 1 (`mode-switch.test.ts:282`, `agent-overrides.test.ts:89-93`);
this one was left. Adding a second `describe` below it — an entirely ordinary
edit — silently re-opens CR-01's hole against this developer's real,
un-gitignored `~/.pi/agent/settings.json`. The `global-teardown.ts` tripwire
would catch the resulting mutation after the fact, but a guard that relies on
its own tripwire is not a guard.

**Fix:** capture and restore, matching the two siblings:

```ts
let suiteAgentDir: string | undefined;
beforeAll(async () => {
    suiteAgentDir = process.env.PI_CODING_AGENT_DIR;
    settingsDir = mkdtempSync(join(tmpdir(), "kypi-wire-proof-settings-"));
    process.env.PI_CODING_AGENT_DIR = settingsDir;
    run = await runFixture();
}, 60_000);

afterAll(() => {
    if (suiteAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = suiteAgentDir;
    rmSync(settingsDir, { recursive: true, force: true, maxRetries: 3 });
});
```

---

## Info

### IN-01 [INFO]: `global-teardown.ts`'s settings snapshot captures `size` and `mtimeMs` and compares neither

**File:** `tests/global-teardown.ts:143`, `:156-158`
**Issue:** `snapshotRealAgentSettings()` returns `{exists, size, mtimeMs, text}`,
but the comparison at `:157-158` reads only `exists` and `text`. The two extra
fields are dead. Comparing `text` is the correct, stronger check (a rewrite of
identical bytes is not a regression), so this is unused state rather than a
weakened check — but a reader will reasonably assume `mtimeMs` participates.
**Fix:** drop `size`/`mtimeMs` from `SettingsSnapshot`, or state in the interface
doc that they are diagnostic-only and deliberately not compared.

### IN-02 [INFO]: iteration 2's IN-01 and IN-02 are unchanged and still open

**Files:** `.pi/extensions/routing/index.ts:346-350`, `:505-509`;
`tests/unit/routing-dispatch.test.ts:346-350`
**Issue:** Re-stated for the record only, not re-filed as new findings and not
worse than at iteration 2: (a) `ROUTING_EVENT`'s emission still has no
subscriber test, so Phase 11's statusline will be built on a payload shape
nothing asserts; (b) the WR-03 regression case's `resolveRoute` loop is still
trivially satisfied, because `state` is the already-normalised return of
`getModeState()` — the real assertion is `:337-343`, and the loop should not be
read as a second independent check.

---

## Shippable-state adjudication

**Shippable: YES.** No BLOCKER. Recommended disposition of the five warnings:

| ID | Disposition | Rationale |
|---|---|---|
| **WR-01** | **OPEN — fix before configuring Qoder / before running RB-05-01** | Only unreachable because the tool is deactivated on unconfigured machines; goes live the moment the work laptop exports the three variables. One-line fix. |
| **WR-02** | **OPEN — low cost** | Two silent refusal branches on the phase's one foreign-agent surface; the file's own stated contract is currently false. |
| **WR-03** | **OPEN — must fix** | A test file header that documents the exact design the iteration-2 BLOCKER was; this is the specific mechanism by which the bug returns. |
| **WR-04** | **OPEN — must fix** | Wrong `[VERIFIED]` citations in a codebase whose standing rule is verify-at-source; one of the two states the inverse of the truth. |
| **WR-05** | **ACCEPTED or OPEN (reviewer's preference: OPEN)** | Benign today, latent tomorrow, six-line fix, and it contradicts a convention the same iteration just wrote down. |
| IN-01, IN-02 | **ACCEPTED** | Documented, non-blocking, unchanged. |

---

_Reviewed: 2026-08-14T21:25:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 3 (final)_
