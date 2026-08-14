---
phase: 05-routing-capability-guards
reviewed: 2026-08-14T20:45:00Z
depth: standard
iteration: 2
files_reviewed: 27
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
  - tests/helpers/qoder-loopback.ts
  - tests/integration/escalate.test.ts
  - tests/integration/mode-persistence.test.ts
  - tests/integration/mode-switch.test.ts
  - tests/integration/qoder-delegate.test.ts
  - tests/integration/qoder-tool.test.ts
  - tests/integration/single-shot-roles.test.ts
  - tests/integration/wire-proof.test.ts
  - tests/unit/agent-overrides.test.ts
  - tests/unit/capability-guard.test.ts
  - tests/unit/contributing-boundary.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/qoder-client.test.ts
  - tests/unit/routing-dispatch.test.ts
  - tests/unit/routing-map.test.ts
findings:
  critical: 1
  warning: 7
  info: 3
  total: 11
status: issues_found
---

# Phase 5: Code Review Report (iteration 2)

**Reviewed:** 2026-08-14T20:45:00Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Thirteen of the fourteen iteration-1 fixes are **real, load-bearing and
verified at source**. The fourteenth — WR-11's *configuration gate* — is a
regression that breaks the Qoder extension outright on every machine that is
not already configured for Qoder, and its two accompanying tests pass **for
the wrong reason**. That is the one BLOCKER below, and it was reproduced, not
inferred.

### Verification verdicts on iteration 1's fourteen findings

| Finding | Verdict | Evidence |
|---|---|---|
| **CR-01** (tests wrote the real `~/.pi/agent/settings.json`) | **FIXED, structural** — with one residual gap (WR-02 below) | `vitest.config.ts:24` `setupFiles` + `tests/setup/agent-dir.ts:52-58`. A test file cannot opt out by omission at *test-body* time: measured `PI_CODING_AGENT_DIR = "…\Temp\kypi-agent-dir-suite-ew1rK2"` inside a freshly-added test that did nothing to enable it. Both former `delete`-the-var sites (`mode-switch.test.ts:282`, `agent-overrides.test.ts:89`) now restore the suite value; the one remaining `delete` (`wire-proof.test.ts:458`) is in `afterAll`, after that file's last test. The `global-teardown.ts` tripwire is genuinely load-bearing: it snapshots `homedir()/.pi/agent/settings.json` **independently of `getAgentDir()`** (`:125-127`), compares `text` (not just mtime) and sets `process.exitCode = 1` before throwing (`:160-173`) — the `process.exitCode` line is what makes it fail a build, and it is present. |
| **CR-02** (resolved chain-member candidate discarded) | **FIXED, honoured on the dispatch path** | `modes.ts:416-435`: the chain is entered only when the resolved ref *is* `CHAIN[0]`; every other candidate is served by `callModel(ctx, {…, model: plan.model, …})` — the Phase 2 chokepoint, not a bypass. The regression test (`single-shot-roles.test.ts:612-707`) would go red on a revert: it registers **only** `dashscope`, asserts `hasConfiguredAuth("deepseek") === false` as a precondition (`:639-642`), then asserts the reply text, `nested[0].provider === "dashscope"`, **zero** rows with `provider === "deepseek"`, and the corr-joined `nested.request` payload. A reverted fix restarts at the unauthed `deepseek` head and fails the first assertion. |
| **CR-03** (truncated Qoder stream returned as complete) | **FIXED, both halves present and reachable** | `client.ts:763-772` (trailing `decoder.decode()` + final `parseSseFrames` pass, placed *after* the `finally`, so it runs on the normal `streamDone` break) and `client.ts:786-792` (`if (!folded.done) throw`). Both loopback cases exist and are non-vacuous: the no-trailing-blank-line case asserts its own fixture precondition (`.endsWith("\n\n") === false`, `qoder-delegate.test.ts:406-409`) and then `folded.done === true`; the early-close case asserts a throw **and** `loop.received` has length 3, so the stream really was opened. |
| **WR-01** (cheap leg of ROADMAP criterion 1) | **CLOSED** — see adjudication below | |
| **WR-02** (`writeAgentOverrides` throws / non-atomic) | **FIXED** | Whole body in `try`/`catch` returning `{ok:false, reason, path}` (`agent-overrides.ts:379-451`), `void statSync(path)` removed, temp-file + `renameSync` in the *same directory*. Paired tests: a missing parent dir refuses without throwing **and** leaves no partial file; a success leaves no `*.tmp`. Residual: IN-02 below. |
| **WR-03** (`getModeState` accepted any string mode) | **FIXED** | `modes.ts:167` `(MODES as readonly string[]).includes(candidate.mode)`. The test plants `{mode:"turbo"}` directly into the documented `globalThis` key — the only way to construct the state — and asserts the fallback to `DEFAULT_MODE`. |
| **WR-04** (`data: null` TypeError) | **FIXED** | `index.ts:606` `latest === undefined \|\| latest.data === null \|\| typeof latest.data !== "object"`. |
| **WR-05** (mode switch cleared escalation with no record) | **FIXED, load-bearing** | `index.ts:261-262, 324-331` captures `priorState`/`previousModel` before the mutation and writes the off-record only when a real escalation was cleared. `escalate.test.ts:440-519` switches `/escalate` → `/cheap` (**same** mode deliberately, so a "only record when the mode name changes" implementation still fails), asserts the *last* record carries `escalated:false`, `mode:"cheap"`, `newModel:"deepseek/deepseek-v4-flash"`, `previousModel:"deepseek/deepseek-v4-pro"`, with the ON record as a paired positive. **Invariant 3 is intact** — the record goes to `.pi/logs/escalation-*.jsonl` via `appendJsonl`, never to `pi.appendEntry` or the context window. |
| **WR-06** (no transcript for the stream-open step) | **FIXED** | `client.ts:666-676`. Residual: IN-01 below. |
| **WR-07** (no SSE read timeout) | **FIXED** | `client.ts:692-732`: `lastProgressAt` resets on every chunk, the race is against the *remaining* budget, and the reader is cancelled before the throw so `releaseLock()` in the `finally` cannot mask it. Paired tests: a stall is detected, and slow-but-real progress is **not** cut off. |
| **WR-08** (unencoded server-supplied session id) | **FIXED** | `client.ts:633-639`: positive shape match `/^[A-Za-z0-9._-]{1,128}$/` **plus** `encodeURIComponent`. Two tests, including a bare-`/` id proving it is a shape match rather than a traversal blocklist. |
| **WR-09** (`MAX_TASK_CHARS` untested) | **FIXED** | Three cases including the exactly-at-limit positive control; each asserts `loop.received` length 0 for the refusals. |
| **WR-10** (self-fulfilling "never reached" case) | **FIXED, genuinely moved to the caller** | `mode-switch.test.ts:535-600` drives the **real** `/balanced` command handler against a guard-blocked `balanced.planner`, then asserts (a) the executor switch still succeeded, (b) the notification contains `"subagent pins unchanged because"`, `"planner"` and the guard's own `"tool calling"` reason, and (c) the injected `settings.json` carries no `subagents` key. |
| **WR-11** (`qoder_delegate` gates) | **HALF FIXED / HALF BROKEN** | Confirmation gate: correct. `ExtensionUIContext.select` returns `Promise<string \| undefined>` [VERIFIED: pi-coding-agent 0.84.1 `dist/core/extensions/types.d.ts:70`], so `choice !== DELEGATE_CHOICE` is a valid comparison and the deny-by-default shape matches `safety/index.ts:522-530` exactly; the "user approves" test proves a request really reaches the loopback, so the normal path is not broken *in a configured session*. Configuration gate: **BLOCKER, see CR-01 below.** |

### Architectural invariants

1. **Chokepoint** — HOLDS. CR-02's fix routes through `callModel()`; no file in
   `routing/` or `qoder/` spells the direct-completion or raw-provider route,
   and no lint exemption was added.
2. **`safety/` ↛ `routing/`** — HOLDS. `grep` for a `../routing` import under
   `.pi/extensions/safety/` returns nothing; signalling is still
   `pi.events.emit(ROUTING_EVENT, …)`.
3. **Zero-context mode persistence** — HOLDS. WR-05's new record is a JSONL
   log line, not a session entry.
4. **Qoder is a delegate tool only** — HOLDS. Absent from `ROLE_MAP`, `CHAIN`,
   `models.json` and the guard; official Cloud Agents surface only; the
   loopback fixture still refuses any non-`127.0.0.1` host in two independent
   places (`qoder-loopback.ts:170`, `:401`).
5. **No credential ever committed / PAT never transcribed** — HOLDS after
   CR-03/WR-06/WR-07/WR-08. The four new/changed `writeQoderTranscript` calls
   carry only `event`, `url`, `status`, `done`, `stopReason`, `textChars`; the
   `Authorization` header object is never passed to the transcript writer, and
   `qoder-delegate.test.ts:356` still asserts neither the fixture token nor an
   `Authorization` value appears in the log.

**RB-05-01 remains OUTSTANDING** in both the RUNBOOK table (`:935`) and the
detail section (`:939`). No finding is filed against that; it is correct.

### WR-01 adjudication: criterion 1 is now CLOSED for all three modes

`ROLE_MAP.cheap.advisor.candidates[0]` is `deepseek/deepseek-v4-pro`
(`routing/schema.ts:205, 224, 251`). `CHAIN` is
`[deepseek/deepseek-v4-flash, dashscope/deepseek-v4-flash]`
(`providers/schema.ts:359-362`) — **flash only** — so `cheap.advisor` is
genuinely **not** a chain member, and post-CR-02 it is dispatched through
`callModel` with the router's own resolved model. The new Task 3
(`wire-proof.test.ts:352-411`, cases 10/11 at `:679-745`) asserts:

- the nested turn row's `provider` **and** `model` equal
  `ROLE_MAP.cheap.advisor.candidates[0]`;
- the **corr-joined** `nested.request` wire payload's `model` independently
  equals the same id (`:722-735`) — a second oracle, joined by `corr`, never
  by position;
- the row's model is **not** the session's own executor model at that moment
  (`:707-712`), made non-degenerate by first switching the session executor to
  the flash tier (`:364-371`) so the comparison is `pro` vs `flash`, not
  `pro` vs `pro`;
- and `advisorRef.id !== "deepseek-v4-flash"` (`:719`), pinning that this
  route cannot be confused with the chain head.

**Verdict: criterion 1 is proven for `cheap`, `balanced` and `max`.**

---

## Critical Issues

### CR-01 [BLOCKER]: WR-11's configuration gate calls `pi.getActiveTools()` during extension load — Pi throws, and the entire Qoder extension is discarded on every unconfigured machine

**File:** `.pi/extensions/qoder/index.ts:186-188`

**Issue:** `pi.getActiveTools()` and `pi.setActiveTools()` are **not callable
from an extension factory**. Pi installs throwing stubs for both until
`Runner.bindCore()` runs:

```js
// pi-coding-agent 0.84.1, dist/core/extensions/loader.js:134-153
const notInitialized = () => {
    throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
};
…
getActiveTools: notInitialized,
setActiveTools: notInitialized,
// registerTool() is valid during extension load; refresh is only needed post-bind.
```

and the factory is awaited strictly before that bind:
`loadExtensionFromFactory` → `await factory(api)`
(`dist/core/extensions/loader.js:425`), while
`this._bindExtensionCore(this._extensionRunner)` does not run until
`dist/core/agent-session.js:2041`, after
`this._resourceLoader.getExtensions()` at `:2031`.

**This repository already documents the exact hazard** — `.pi/extensions/safety/index.ts:768-769`:
*"the runtime's own `getAllTools()`/`getActiveTools()` throw 'not initialized'
during extension loading — `dist/core/extensions/loader.js:151-152`"*. The two
other `getActiveTools()` call sites in this codebase
(`diagnostics/index.ts:506`, `diagnostics/budget.ts:648`) are both inside
handlers, correctly. `qoder/index.ts:187` is the only factory-time call.

**REPRODUCED, not inferred.** Driving the real entry point through
`createFauxSession` with the three Qoder variables unset:

```
PROBE factory error = Extension runtime not initialized. Action methods cannot be called during extension loading.
PROBE unconfigured: toolDefinition = UNDEFINED (never registered)
PROBE unconfigured: activeToolNames = []
PROBE configured:   toolDefinition = DEFINED
```

Because the factory throws, `loadExtension` returns
`{ extension: null, error: "Failed to load extension: …" }` and Pi discards the
**whole extension**, including the `registerTool` call that had already
succeeded. Consequences:

1. On the developer's machine today and in CI — no PAT — the Qoder extension
   does not load at all. ROUTE-11's shipped deliverable is inert.
2. The failure mode is **worse than absence**. With two of three variables set
   (the most likely partial-setup state, and the exact case
   `resolveQoderConfig`'s ordered refusal messages were written for), the tool
   vanishes instead of emitting *"Qoder delegate refused: QODER_AGENT_ID not
   set…"*. `docs/ROUTING.md:247-249` promises the opposite: *"The tool refuses
   actionably, naming exactly what is missing, when any of the three is
   unset."*
3. The user gets a startup extension-load error instead of a working harness.

**Both tests that "prove" this gate pass for the wrong reason.**
`tests/integration/qoder-tool.test.ts:144-160` asserts
`getActiveToolNames()` does **not** contain `"qoder_delegate"` — satisfied
identically by "the gate deactivated it" and by "the extension crashed and the
tool never existed", which is what actually happens. The paired positive
(`:162-179`) sets all three variables, so `resolveQoderConfig(...).ok` is
`true` and the throwing branch is **never executed**. The three
confirmation-gate cases likewise all run configured. No test in the suite
asserts that this extension loads without error (`grep -l qoder
tests/integration/load-paths.test.ts tests/integration/user-scope-load.test.ts
tests/unit/extension-layout.test.ts` → nothing), which is why the crash shipped
green.

**Fix:** Move the deactivation to a point where the runtime is bound.
`pi.setActiveTools` is valid from `session_start`, a command handler, or any
event handler — the sanctioned pattern CLAUDE.md describes and the one
`diagnostics/` already follows:

```ts
// qoder/index.ts -- replace the factory-time block at :186-188
pi.on("session_start", () => {
    // registerTool() makes a newly-registered tool active by default
    // [VERIFIED: dist/core/agent-session.js:2008-2014]; deactivate it here,
    // where the runtime IS bound. Calling getActiveTools()/setActiveTools()
    // from the FACTORY throws "Extension runtime not initialized"
    // [VERIFIED: dist/core/extensions/loader.js:134-153] and Pi then discards
    // this whole extension -- see safety/index.ts:768 for the same citation.
    if (!resolveQoderConfig(process.env).ok) {
        pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "qoder_delegate"));
    }
});
```

And make the tests non-vacuous:

1. Assert the extension **loaded** before asserting anything about activation —
   e.g. `expect(handle.session.extensionRunner.getToolDefinition("qoder_delegate"),
   "the extension failed to load; the absence assertion below would pass for the wrong reason").toBeDefined();`
   in the unconfigured case, *before* the `not.toContain` assertion. That single
   line turns the current false pass into a red test today.
2. Add a load-cleanliness case covering `.pi/extensions/qoder/index.ts` in the
   unconfigured state, alongside the existing user-scope load tests.

---

## Warnings

### WR-01 [WARNING]: `usesFallbackChain` is now dead in production, and its doc comment instructs the next caller to reintroduce CR-02

**File:** `.pi/extensions/routing/modes.ts:286-294`, `:57-67`, `:364-372`

**Issue:** CR-02's fix replaced the only production call site with the inline
`resolvedIsChainHead` check (`:416-418`). `usesFallbackChain` now has **zero
production callers** (`grep` finds it only in `modes.ts` itself and two test
files), yet its docstring still reads:

> *"this is the only test a caller needs to decide between `callWithFallback()`
> and a direct chokepoint call."*

That is precisely the rule CR-02 proved wrong. Two more stale statements
compound it:

- `runSingleShotRole`'s own doc comment (`:369-371`) still describes the fixed
  behaviour as *"`callWithFallback()` when the resolved `{provider,id}` is a
  **member** of the fixed fallback chain"* — it is now the chain **head**, and
  the difference is the whole of CR-02.
- The module docstring (`:60-63`) still frames `usesFallbackChain` as the
  mechanism the file uses.

A maintainer who reads the docstrings rather than tracing `runSingleShotRole`
will "simplify" the inline check back into `usesFallbackChain(ref)` and
silently restore the DashScope-only outage — with the regression test still
green only because that test happens to catch it. Documentation that
contradicts the fix is how a fixed bug comes back.

**Fix:** Either delete `usesFallbackChain` (and its unit block), or keep it and
rewrite the three comments to say what is now true:

```ts
/**
 * Whether `ref` is a MEMBER of the fixed fallback chain. NOTE (CR-02): a
 * member is NOT sufficient to justify `callWithFallback()`, which always
 * restarts at CHAIN[0] and takes no starting model -- only the chain HEAD is.
 * See runSingleShotRole's own `resolvedIsChainHead` check; do not replace it
 * with this predicate.
 */
```

and correct `runSingleShotRole:369-371` from "is a member of" to "is the head
of".

### WR-02 [WARNING]: CR-01's suite-wide guard is not in force at test-file module scope

**File:** `tests/setup/agent-dir.ts:52-58` (and its docstring at `:24-28`)

**Issue:** The guard sets `PI_CODING_AGENT_DIR` inside `beforeAll`, which runs
after every test file's module body has already been evaluated. **Measured**,
with a probe test added to `tests/unit/` and nothing else:

```
PROBE module-scope PI_CODING_AGENT_DIR = undefined
PROBE in-test      PI_CODING_AGENT_DIR = "C:\\…\\Temp\\kypi-agent-dir-suite-ew1rK2"
```

So any test file — or any helper it imports — that resolves `getAgentDir()`,
or calls `writeAgentOverrides()`, at **import time** still reaches the real
`~/.pi/agent`. No current file does, so this is a hole rather than an active
bug; but the file's own docstring asserts the stronger claim (*"no test file
can opt out of this by omission"*), and a claim that broad is exactly what
stops the next author from checking.

**Fix:** Set it at module scope as well as in `beforeAll` — setup files are
evaluated before the test module, so this closes the import-time window:

```ts
// Module scope: setupFiles are evaluated BEFORE the test file's own module
// body, so this covers import-time resolution that beforeAll cannot reach.
const dir = mkdtempSync(join(tmpdir(), "kypi-agent-dir-suite-"));
process.env.PI_CODING_AGENT_DIR = dir;

beforeAll(() => { process.env.PI_CODING_AGENT_DIR = dir; }); // re-assert
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
```

Then soften the docstring to state exactly what is now guaranteed.

### WR-03 [WARNING]: the `qoder_delegate` confirmation decision is recorded nowhere

**File:** `.pi/extensions/qoder/index.ts:136-152`

**Issue:** WR-11's new gate is the single most consequential decision in this
subsystem — a human authorising a foreign agent to act on a machine where
`main` auto-deploys — and it writes **no** record on any branch: not the
prompt, not a decline, not an approval. It is the only decision point in the
phase without one. The precedent this file explicitly claims to mirror does
the opposite: `safety/index.ts#registerApprovalTool` writes an audit row on
*every* branch including the refusals (`:501-510`, `:531-541`), and its own
docstring says so (*"Every branch writes exactly one audit row"*).
`client.ts` writes six transcript records for the mechanical HTTP steps and
zero for the authorisation. Post-incident, "did a human approve this
delegation?" is unanswerable.

**Fix:** Write a `qoder.delegate.confirm` transcript record on both branches,
through the same redacted writer, before returning or throwing — e.g.
`{ event: "qoder.delegate.confirm", hasUI: ctx.hasUI, approved: choice === DELEGATE_CHOICE, taskChars: params.task.length }`.
Never the task text itself.

### WR-04 [WARNING]: WR-11 moved the ASVS V5 task validation *behind* the human prompt, and `task` is unbounded at the tool boundary

**File:** `.pi/extensions/qoder/index.ts:74-78`, `:136-152`; `.pi/extensions/qoder/client.ts:584-592`

**Issue:** `qoderDelegateSchema` declares `task: Type.String(...)` with **no**
`maxLength`. `MAX_TASK_CHARS` and the empty-task refusal live inside
`delegateTask`, which now runs *after* the confirmation. So an unbounded,
model-controlled string is interpolated into `ctx.ui.select`'s title
(`index.ts:138`) before any validation at all. Two consequences:

1. A megabyte-long or newline-stuffed `task` floods the confirmation dialog;
   the four-line bypass warning that follows it can be pushed out of view,
   so the user approves a prompt whose warning they never saw. This is
   confirmation fatigue engineered by the untrusted party.
2. `client.ts`'s docstring still describes the length bound as validation that
   happens "before sending anything" — true of the network, no longer true of
   the human decision, which is now the more security-relevant of the two.

**Fix:** Enforce the bound at the tool boundary, before the prompt:

```ts
const task = params.task.trim();
if (task.length === 0 || task.length > MAX_TASK_CHARS) {
    throw new Error(`Qoder delegate refused: task must be 1..${MAX_TASK_CHARS} characters after trimming.`);
}
// and render a bounded excerpt in the dialog, with the warning FIRST:
const excerpt = task.length > 500 ? `${task.slice(0, 500)}… (${task.length} chars total)` : task;
```

Add a case asserting `ctx.ui.select` is never called for an over-limit task.

### WR-05 [WARNING]: the shipped docs contradict WR-11's behaviour change — the confirmation gate is undocumented and §6's refusal promise is now false

**File:** `docs/ROUTING.md:244-249`; `docs/RUNBOOK.md:960-963`

**Issue:** WR-11 changed user-visible behaviour in two ways and neither doc was
touched (`git diff --stat 468198e HEAD` shows no `docs/` change across the
fourteen fix commits):

1. `docs/ROUTING.md:247-249` — *"The tool refuses actionably, naming exactly
   what is missing, when any of the three is unset — which is this machine's
   state today and will be CI's state always."* After WR-11 that is wrong even
   once CR-01 is fixed: the tool is deactivated, so the model cannot call it
   and the actionable message is never produced. (Today, per CR-01, the whole
   extension is gone instead.)
2. Nothing in ROUTING.md §6 or RUNBOOK RB-05-01 mentions that delegation now
   requires an interactive `ctx.ui.select` confirmation, or that it refuses
   outright with `hasUI === false`. RB-05-01 step 3 tells the operator to
   *"Start `pi` … and ask the model to delegate"* with no hint that a dialog
   will appear — and an operator who reaches for `pi -p` or `--mode json` to
   script the one live check this phase leaves outstanding will get a refusal
   they have no documentation for.

**Fix:** Add to ROUTING.md §6 a "Two gates" paragraph — (a) unconfigured ⇒ the
tool is not offered to the model at all; (b) configured ⇒ every invocation
requires an explicit human selection, and headless/`-p`/`--mode json` refuses
by design — and add a sentence to RB-05-01 step 3: *"An approval dialog will
appear; select 'Delegate to Qoder'. This check cannot be run headlessly."*
Do not change RB-05-01's OUTSTANDING status.

### WR-06 [WARNING]: the inactivity-timeout and session-id-refusal paths write no terminal transcript record — the same gap WR-06 closed for stream-open

**File:** `.pi/extensions/qoder/client.ts:698-703`, `:727-731`, `:633-638`

**Issue:** `qoder.delegate.result` is written at `:774-779`, which is
unreachable from the three throw sites above. So after a stalled stream the
transcript ends at `qoder.stream.open.response: 200` with nothing following,
and after a malformed session id it ends at
`qoder.session.create.response: 200`. RB-05-01 step 4 directs the operator to
read exactly this file; iteration 1's WR-06 established that a step which
writes nothing is a step the operator cannot diagnose, and these three paths
have the same shape.

**Fix:** Write a terminal record before each throw, e.g.
`writeQoderTranscript(cwd, { event: "qoder.delegate.failed", cause: "inactivity-timeout", afterMs: inactivityTimeoutMs, textChars: folded.text.length })`
and `{ cause: "malformed-session-id" }`. Never include the offending id
verbatim without passing it through `redactDeep` (it already is, via
`writeQoderTranscript`).

### WR-07 [WARNING]: the atomic-write temp file is orphaned on failure and its name collides between two jiti copies in one process

**File:** `.pi/extensions/routing/agent-overrides.ts:441-451`

**Issue:** Two defects in the WR-02 fix:

1. If `renameSync` fails (EPERM, EXDEV, an antivirus/indexer lock on Windows —
   the platform this project targets), the `catch` returns a refusal but
   `<path>.<pid>.tmp` is left sitting in the user's **global** `~/.pi/agent/`
   directory forever. The function's own contract is that a refusal leaves the
   filesystem as it found it; `agent-overrides.test.ts:321` asserts exactly
   that ("a refusal must never leave a partial file behind") but only for the
   ENOENT case, where the temp write itself fails and no file is created.
2. The name is keyed on `process.pid` alone. This module's siblings document at
   length that jiti can hold **two copies of one module in one process**
   (`modes.ts:32-46`). Two concurrent `applyMode` calls from two copies collide
   on the identical temp path: A writes, B overwrites, A renames, B's rename
   hits ENOENT and reports a spurious refusal to the user for a write that
   actually succeeded.

**Fix:**

```ts
const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
try {
    writeFileSync(tmpPath, nextText, "utf-8");
    renameSync(tmpPath, path);
} catch (err) {
    try { rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
    throw err; // handled by the outer catch's refusal
}
```

Add a case that makes `renameSync` fail and asserts no `*.tmp` survives.

---

## Info

### IN-01 [INFO]: `ROUTING_EVENT` emission is still entirely untested

**File:** `.pi/extensions/routing/index.ts:346-350`, `:505-509`
**Issue:** Re-filed from iteration 1 (IN-01) only because WR-05 added a second
consumer-visible state transition (`escalated:false` on a mode switch) without
a subscriber test. Phase 11's statusline will be built on a payload shape
nothing asserts.
**Fix:** Subscribe in `mode-switch.test.ts`'s probe extension and pin
`{mode, escalated, model}` after a successful switch, with a non-emptiness
guard first.

### IN-02 [INFO]: the WR-03 regression case's `resolveRoute` loop is trivially satisfied

**File:** `tests/unit/routing-dispatch.test.ts:346-350`
**Issue:** The loop asserts `resolveRoute(role, state)` does not throw, but
`state` is the **already-normalised** return of `getModeState()` — the
preceding assertion has just proved its `mode` is `DEFAULT_MODE`. The loop
therefore cannot fail once the line above passes. The real assertion (`:337-343`)
is load-bearing; this one is decoration and should not be read as a second
independent check.
**Fix:** Either drop it, or make it independent by passing the raw slot value:
`expect(() => resolveRoute(role, { mode: "turbo" as ModeName, escalated: false })).toThrow()`
as a documented negative control.

### IN-03 [INFO]: `tests/setup/agent-dir.ts`'s `afterAll` dereferences a possibly-unassigned `dir`

**File:** `tests/setup/agent-dir.ts:60-62`
**Issue:** If `mkdtempSync` throws in `beforeAll` (a full or read-only
`tmpdir()`), `dir` stays `undefined` and `rmSync(undefined, …)` throws a
`TypeError` that masks the real cause in every test file at once.
**Fix:** `if (dir !== undefined) rmSync(dir, …)`.

---

_Reviewed: 2026-08-14T20:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 2_
