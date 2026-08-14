---
phase: 05-routing-capability-guards
reviewed: 2026-08-14T20:05:00Z
depth: standard
files_reviewed: 23
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
  - tests/helpers/qoder-loopback.ts
  - tests/integration/escalate.test.ts
  - tests/integration/mode-persistence.test.ts
  - tests/integration/mode-switch.test.ts
  - tests/integration/qoder-delegate.test.ts
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
  critical: 3
  warning: 11
  info: 5
  total: 19
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-08-14T20:05:00Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

The subsystem is unusually well-documented and the pure layers (`schema.ts`,
`guard.ts`, `planRoleCall`) are genuinely well-tested. The four architectural
invariants I was asked to police hold on inspection:

- **Chokepoint (invariant 1):** `modes.ts` reaches a model only via
  `callModel()`/`callWithFallback()`; no file in `routing/` or `qoder/` spells
  a direct-completion or raw-provider route, and no lint exemption was added.
- **No `safety/`↔`routing/` cycle (invariant 2):** verified — `routing/`
  imports `lib/jsonl.ts`, `diagnostics/`, `providers/`, nothing from `safety/`;
  cross-subsystem signalling is `pi.events.emit(ROUTING_EVENT, …)`.
- **Zero-context persistence (invariant 3):** `ky:mode` carries only mode name,
  flag, `escalatedFrom`, `at`; `pi.appendEntry`'s "custom entries do NOT
  participate in LLM context" claim is real
  [VERIFIED: pi-coding-agent 0.84.1 `docs/extensions.md:1441`], and
  `mode-persistence.test.ts` case 4 pairs the absence with a live positive
  control. Sound.
- **Qoder is a delegate tool only (invariant 4):** verified — Qoder appears in
  no `ROLE_MAP`, no `CHAIN`, no `models.json` template, no guard entry. Only
  the official Cloud Agents surface is spoken; zero bypass-proxy behaviour, no
  signature forging, and the loopback fixture refuses any non-`127.0.0.1` host
  before handing out a `baseUrl`. The PAT is never written to a transcript
  record at all (not redacted-after-the-fact), and `qoder-delegate.test.ts`
  asserts that with non-vacuity guards.
- **RB-05-01 correctly OUTSTANDING** in both the table and the detail section,
  and `docs-policy.test.ts` governs it. No finding filed against that.

That said, this code has three defects I can prove that must be fixed before it
ships, one of which has **already modified the developer's real machine
configuration** and one of which breaks single-shot routing on exactly the
credential configuration the candidate-ordering rule exists to serve. The
adjudication requested on ROADMAP criterion 1's "all three modes" clause is
**WR-01: the cheap leg is open**, and it is open for a stronger reason than the
prompt supposed.

---

## Critical Issues

### CR-01: The test suite writes to the developer's REAL global Pi settings file — reproduced, with the artifact on disk

**File:** `tests/integration/mode-switch.test.ts:266-336`,
`tests/integration/mode-persistence.test.ts:183`, `:236`, `:309`
(with `.pi/extensions/routing/agent-overrides.ts:329-334` and
`.pi/extensions/routing/index.ts:282-290`)

**Issue:** A successful `applyMode` calls `writeAgentOverrides(...)`, which
resolves `join(getAgentDir(), "settings.json")` when no `settingsPath` is
injected. `getAgentDir()` honours `PI_CODING_AGENT_DIR` and otherwise resolves
`~/.pi/agent/` [VERIFIED: pi-coding-agent 0.84.1 `dist/config.d.ts:76`,
`getAgentDir()` "Get the agent config directory (e.g., ~/.pi/agent/)"].

`wire-proof.test.ts` documents this trap at length (`:74-83`) and sets
`process.env.PI_CODING_AGENT_DIR` in `beforeAll`. `mode-switch.test.ts` sets it
for cases 2 and 4 only — **case 1 drives a successful `/balanced` with the
variable unset** (and `afterEach:237` deletes any leakage from a prior file).
`mode-persistence.test.ts` **never sets it at all** and drives three successful
switches (`/max` case 1, `/balanced`+`/max` case 2, `/balanced` case 4).

This is not theoretical. On this machine right now:

```
$ cat ~/.pi/agent/settings.json        # mtime 2026-08-14 19:29
{
  "kyPiAgent": { "bootstrapVersion": "1", ... },
  "subagents": { "agentOverrides": { "planner": { "model": "deepseek/deepseek-v4-pro" } } }
}
```

`deepseek/deepseek-v4-pro` is exactly `ROLE_MAP.balanced.planner.candidates[0]`.
The suite silently reconfigured the user's live harness. `tests/global-teardown.ts`
cannot see it: that tripwire diffs *tracked repository files*, and
`~/.pi/agent/settings.json` is neither tracked nor in the repo. On a machine
where Phase 7 later installs `pi-subagents`, this stray pin becomes a live
routing decision nobody made.

**Fix:** Make the temp-dir injection unconditional rather than per-case. Add a
suite-wide guard in `vitest.config.ts` (`setupFiles`) so no test can ever reach
the real agent dir:

```ts
// tests/setup/agent-dir.ts, referenced from vitest.config.ts setupFiles
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

let dir: string;
beforeAll(() => {
	// A test must never resolve getAgentDir() to this machine's real ~/.pi/agent.
	dir = mkdtempSync(join(tmpdir(), "kypi-agent-dir-suite-"));
	process.env.PI_CODING_AGENT_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
```

Then delete the per-file `delete process.env.PI_CODING_AGENT_DIR` in
`mode-switch.test.ts:237` and `agent-overrides.test.ts:77` (they now punch a
hole in the suite-wide guard) and have those cases override to their own temp
dir and restore the suite value. Additionally: extend `tests/global-teardown.ts`
to snapshot/compare `~/.pi/agent/settings.json` so a future regression of this
exact shape fails the run loudly. Finally, restore the developer's file by
removing the stray `subagents` key.

---

### CR-02: `runSingleShotRole` throws away the candidate it just resolved whenever that candidate is a chain member — DashScope-only machines lose every flash-tier single-shot role

**File:** `.pi/extensions/routing/modes.ts:377-395`
(with `.pi/extensions/providers/fallback.ts:252-273`)

**Issue:** `planRoleCall` → `pickConfiguredCandidate` walks the ordered
candidate list and **skips candidates with no configured auth** — that is the
documented purpose of the ordering rule (`schema.ts:48-56`). It may therefore
legitimately return `dashscope/deepseek-v4-flash` because `deepseek` (direct)
has no key on this machine.

`runSingleShotRole` then does:

```ts
const ref: ModelRef = { provider: plan.model.provider, id: plan.model.id };
if (usesFallbackChain(ref)) {
    return callWithFallback(ctx, { role, systemPrompt, messages, api });  // <-- plan.model is DROPPED
}
```

`callWithFallback` takes no starting model. It **always restarts at `CHAIN[0]`**
(`fallback.ts:252`), which is `deepseek/deepseek-v4-flash`
(`providers/schema.ts:359-362`). `deepseek` is a built-in Pi provider, so
`registry.find()` resolves it; `callModel` then fails for want of a key; and
`classifyFailure` sends a missing/invalid-credential string down the
non-retryable branch → `"fatal"` → `throw error` / `return message`
(`fallback.ts:269`, `:281-286`). **The `dashscope` hop the router explicitly
selected is never attempted.**

Consequences, in order of severity:
1. On a machine holding only DashScope credentials — the daily-driver
   configuration this whole project is built around — `reviewer` and
   `summariser` in `cheap`/`balanced` mode fail outright with a `deepseek`
   auth error, despite a fully configured, guard-approved candidate existing.
2. Even in the happy path, **the model that serves the request is `CHAIN[0]`,
   not the model `ROLE_MAP` named.** The plan's resolution result is
   decorative for any chain-member route. This also invalidates the only wire
   evidence cheap mode has (see WR-01).
3. `pickConfiguredCandidate`'s auth pre-check is bypassed, so the prompt is
   disclosed to a provider the harness already knew would reject it — the same
   disclosure `fallback.ts:281-286` deliberately avoids elsewhere.

No test catches it: `single-shot-roles.test.ts` registers *only* `deepseek`
(so `CHAIN[0]` is always the answer) and `wire-proof.test.ts` exercises the
single-shot path only for `max.reviewer`, which is Bedrock and not a chain
member.

**Fix:** Do not enter the chain unless the resolved ref *is* the chain's head,
and make that explicit rather than incidental:

```ts
const chainHead = CHAIN[0];
const resolvedIsChainHead =
    chainHead !== undefined && ref.provider === chainHead.provider && ref.id === chainHead.id;

if (resolvedIsChainHead) {
    return callWithFallback(ctx, { role: opts.role, systemPrompt: opts.systemPrompt, messages: opts.messages, api });
}
// The router already picked a specific, authed, guard-approved model. Serve THAT one.
return callModel(ctx, { role: opts.role, model: plan.model, systemPrompt: opts.systemPrompt, messages: opts.messages, api });
```

(The alternative — teaching `callWithFallback` a `startAt`/`startFrom` option so
the chain resumes at the resolved hop — is better long-term and keeps the
retry taxonomy available to a DashScope-first machine; either way the resolved
model must not be silently discarded.) Add a unit case to
`routing-dispatch.test.ts` with a registry that authes `dashscope` only, and an
integration case asserting the nested wire record names `dashscope`.

---

### CR-03: A truncated Qoder stream is returned to the model as a complete delegated result

**File:** `.pi/extensions/qoder/client.ts:617-644`, `.pi/extensions/qoder/index.ts:133-136`

**Issue:** Two defects compound:

1. **The trailing buffer is never flushed.** The read loop keeps `buffer =
   parsed.rest` and, on `streamDone`, `break`s without parsing what is left in
   `buffer` and without a final `decoder.decode()`. A server that ends the body
   with the last frame *not* followed by a blank line — a very common SSE
   server behaviour, and one this file's own docstring says the enum/envelope
   is UNVERIFIED about — loses that final frame. If the lost frame is
   `session.status_idle`, `done` is `false`; if it is the last
   `content_delta`, the answer is truncated.
2. **`done` is never checked.** `delegateTask` returns `folded` regardless, and
   `index.ts:133-136` returns `result.text` regardless. A connection dropped
   mid-stream, a server-side 5xx after headers, or an early close therefore
   produces a **truncated or empty string presented to the model as Qoder's
   answer**, with no error and no marker. The transcript records
   `done: false`, but the model never sees it and the tool result is not
   `isError`.

For a subsystem whose stated purpose is "never a silent downgrade", and for a
tool whose result the docs tell the user to treat as an untrusted PR, silently
handing back half an answer is the worst available failure mode.

**Fix:**

```ts
	} finally {
		reader.releaseLock();
	}

	// Flush what the transport left unterminated: a server that closes without a
	// final blank line must not cost us the last frame (often status_idle).
	buffer += decoder.decode();
	if (buffer.trim().length > 0) {
		allFrames.push(...parseSseFrames(`${buffer}\n\n`).frames);
		folded = foldDelegatedResult(allFrames);
	}

	writeQoderTranscript(cwd, { event: "qoder.delegate.result", done: folded.done, stopReason: folded.stopReason, textChars: folded.text.length });

	if (!folded.done) {
		throw new Error(
			`Qoder delegate: the event stream ended without a session.status_idle frame after ` +
				`${folded.text.length} characters -- the delegated result is incomplete and must not be ` +
				"treated as an answer.",
		);
	}
	return folded;
```

Add loopback cases for (a) a body whose final frame lacks the terminating blank
line and (b) a stream closed before `session.status_idle`, asserting a throw
rather than a short string.

---

## Warnings

### WR-01: ADJUDICATION — criterion 1's cheap leg is NOT proven by any wire dump, and cheap's current proof path cannot prove it

**File:** `tests/integration/wire-proof.test.ts:216`, `:490-510`;
`tests/integration/single-shot-roles.test.ts:129-134`, `:428-447`

**Verdict: OPEN. Cheap's proof is materially weaker than balanced's and max's —
weaker even than the prompt's own characterisation of it.**

The facts as I read them:

- `wire-proof.test.ts` asserts turn-row/wire-record model identity for
  `balanced.executor` (case 1/3), `max.executor` (case 2/3) and
  `max.reviewer` (cases 5/6, joined by `corr`). `setMode("cheap")` at `:216` is
  fixture hygiene only; **no cheap-mode turn is ever served or asserted** in
  that file. `/cheap` is never driven to success anywhere in the suite —
  `mode-switch.test.ts` cases 3 and 4 drive `/cheap` specifically to *refuse*.
- `single-shot-roles.test.ts` does serve a nested turn in cheap mode via
  `ROLE_MAP.cheap.reviewer`, but its `TurnsRow` interface (`:129-134`) does not
  even declare `provider`/`model`, and no case asserts them. The proof is
  entirely indirect: case 0's api-identity guard plus "only one model is
  registered".
- **The indirect proof does not hold.** Two independent holes: (a) the fixture's
  session also has `faux/faux-flash` registered and authed, so a `ROLE_MAP`
  corrupted to point cheap's reviewer at the session's own faux model would
  resolve, dispatch, write a `kind:"nested"` row with `role:"reviewer"`, and
  pass every assertion in the file; and (b) far worse, per **CR-02**,
  `cheap.reviewer` resolves a `CHAIN` member and is therefore dispatched
  through `callWithFallback`, which **re-resolves `CHAIN[0]` itself and ignores
  the routed candidate entirely**. Editing `ROLE_MAP.cheap.reviewer` to
  `dashscope/deepseek-v4-flash` would change nothing observable in that test.
  Cheap's only wire evidence runs through the one dispatch path that is
  structurally incapable of distinguishing a routing decision from a hardcoded
  chain head.
- Note also that `cheap.executor` and `balanced.executor` are the *same*
  `FLASH_CANDIDATES`, so an executor-based cheap proof would be degenerate by
  construction. Cheap is distinguishable from balanced only at
  `planner`/`reviewer`/`advisor`.

**What would close it.** Add a case to `single-shot-roles.test.ts` (or a cheap
section in `wire-proof.test.ts`) that drives a role which is (i) served in
cheap mode, (ii) resolved to a model *not* in `CHAIN`, and (iii) asserted by
identity against the map. `cheap.advisor` is the natural choice
(`deepseek/deepseek-v4-pro`, not a chain member, and distinct from
`balanced.advisor`'s Bedrock Claude):

```ts
const advisorRef = ROLE_MAP.cheap.advisor.candidates[0];
// non-vacuity first
expect(run.turnsAfterAdvisor.length).toBeGreaterThan(0);
const row = run.turnsAfterAdvisor.find((r) => r.kind === "nested" && r.role === "advisor");
expect(row, "no nested advisor row -- the assertions below would key off undefined").toBeDefined();
expect(row?.provider).toBe(advisorRef.provider);
expect(row?.model, "cheap's advisor route did not serve the turn").toBe(advisorRef.id);
// and the independent second oracle, joined by corr, never by position:
const req = run.wireAfterAdvisor.find((w) => w.corr === row?.corr && w.kind === "nested.request");
expect(req, "no nested.request joined by corr").toBeDefined();
expect(req?.payload?.model).toBe(advisorRef.id);
// paired distinctness, so this is routing and not the session's own model:
expect(row?.model).not.toBe(run.executorModelAtThatPoint.id);
```

Until that lands (and CR-02 is fixed), criterion 1 should be recorded as proven
for `balanced` and `max` and **unproven for `cheap`**.

### WR-02: `writeAgentOverrides` can throw despite documenting that it never does, and the throw lands mid-way through a mode switch

**File:** `.pi/extensions/routing/agent-overrides.ts:363-427` (esp. `:370-373`, `:414-424`)

**Issue:** The module docstring (`:105-112`) promises "returns a refusal rather
than throwing, so a mode-switch command can report 'the model switched but the
subagent pins did not'". Only `JSON.parse` is guarded. `readFileSync` (twice),
`writeFileSync` and `statSync` are all unguarded: EACCES/EPERM/EISDIR, a
missing `~/.pi/agent` parent directory on a fresh machine, or a Windows file
lock all throw straight out. In `applyMode` (`index.ts:286`) that happens
*after* `pi.setModel` succeeded, `setMode`/`setEscalated` ran and
`pi.appendEntry` wrote — so the switch really happened, the user never gets the
step-6 notification, and Pi swallows extension handler exceptions. The
`void statSync(path)` at `:424` is pure dead weight: it is explicitly
"diagnostic only, not gating", it is never read, and it is the one call most
likely to throw for no benefit.

Separately, `writeFileSync` is not atomic. A crash or a concurrent Pi session
mid-write truncates the user's **global** settings file, destroying
`kyPiAgent`, `subagents.defaultModel` and any hand-written keys — the very
sibling keys the read-modify-write exists to preserve.

**Fix:** Wrap the whole body in `try`/`catch` returning `{ ok:false, reason, path }`;
delete the `statSync` line; write via temp-file + `renameSync`:

```ts
try {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, nextText, "utf-8");
    renameSync(tmp, path);           // atomic on the same filesystem
    return { ok: true, written: true, path };
} catch (err) {
    return { ok: false, reason: `${path} could not be written (${err instanceof Error ? err.message : String(err)}).`, path };
}
```

Add a case asserting a refusal (not a throw) when the target directory does not
exist.

### WR-03: `getModeState()` validates the shape of the `globalThis` slot but not that `mode` is a real mode — `resolveRoute` then dereferences `undefined`

**File:** `.pi/extensions/routing/modes.ts:145-151`, `:205-210`

**Issue:** `isKyModeData` accepts any `{mode: string, escalated: boolean, at:
number}`. The docstring at `:157-163` explicitly anticipates the slot holding
"a stale shape from a version this module no longer writes" — but a stale value
like `{mode: "turbo", …}` passes the shape check, and `resolveRoute` then
evaluates `ROLE_MAP[state.mode][role]` → `undefined[role]` → `TypeError`,
crashing `/escalate`, `/mode` and every `runSingleShotRole`. This is
inconsistent with `restoreModeFromBranch`, which validates against `MODES`
precisely for this reason (T-05-36).

**Fix:** Reuse the same narrowing in the slot reader:

```ts
return typeof candidate.mode === "string" &&
    (MODES as readonly string[]).includes(candidate.mode) &&   // T-05-36, applied at BOTH readers
    typeof candidate.escalated === "boolean" &&
    typeof candidate.at === "number";
```

### WR-04: `restoreModeFromBranch` throws on a `null` payload, contradicting its own "NEVER THROWS" contract

**File:** `.pi/extensions/routing/index.ts:538-559` (specifically `:543`, `:553`)

**Issue:** `if (latest?.data === undefined) return;` does not catch `data:
null` (`null === undefined` is `false`). Execution reaches `isModeName(data.mode)`
and dereferences `null` → `TypeError`. The doc comment at `:530-536` claims the
function never throws on a malformed payload, and `mode-persistence.test.ts`
case 3 only exercises a malformed *mode string*, not a malformed *payload*. The
`session_start` wrapper's `catch` contains the damage, but the exported
function's stated contract — the thing every direct caller and every test reads
— is false.

**Fix:** `if (latest === undefined || latest.data === null || typeof latest.data !== "object") return;`
and add a case: `restoreModeFromBranch([{...entry, data: null}])` must not throw
and must leave the perturbed state at `DEFAULT_MODE`.

### WR-05: a mode switch clears escalation without writing the durable escalation record the module promises for "every escalation change"

**File:** `.pi/extensions/routing/index.ts:275-277` vs `:46-63`, `:333-348`

**Issue:** The docstring states "Every escalation change ALSO writes a durable
JSONL record (`writeEscalationRecord` below) naming the previous and new
executor and the escalation flag — the explanation that survives after the
session itself is gone (T-05-32)". `applyMode` calls `setEscalated(false)` at
`:276` — a real escalation change, and one that materially changes cost — and
writes **no** escalation record. So the sequence `/escalate` → (expensive
turns) → `/cheap` leaves an `escalation-*.jsonl` that shows escalation being
turned on and never turned off. That is precisely the "why was this turn
expensive?" question T-05-32 exists to answer, answered wrongly.

**Fix:** In `applyMode`, when the pre-switch `getModeState().escalated` was
`true`, call `writeEscalationRecord(ctx.cwd, { mode, escalated: false,
previousModel, newModel })` after the successful switch (capture
`previousModel` from `ctx.model` before `pi.setModel`, as `applyEscalate`
already does at `:405`).

### WR-06: RB-05-01's documented failure signal cannot fire for the stream request — no transcript record is written for it

**File:** `docs/RUNBOOK.md:963-974`; `.pi/extensions/qoder/client.ts:601-608`

**Issue:** RB-05-01 step 4 tells the operator to read
`.pi/logs/qoder-*.jsonl`, and names as "the failure signal that matters most" a
`401`/`403` "on any of the three requests (visible in the transcript's
`*.response` records, by HTTP status)". `delegateTask` writes
request/response transcript records for step 1 and step 2 only. The **stream
open (step 3) writes neither a request nor a response record**, so a 401/403
there leaves the transcript showing two clean 200s and then nothing. The
operator running the one live check this phase deliberately leaves OUTSTANDING
would be looking at a log that cannot show the failure the runbook told them to
look for.

**Fix:** Add the two missing transcript writes around the stream fetch,
mirroring the other two steps:

```ts
writeQoderTranscript(cwd, { event: "qoder.stream.open.request", url: `${config.baseUrl}/sessions/${sessionId}/events/stream` });
const streamResponse = await fetch(...);
writeQoderTranscript(cwd, { event: "qoder.stream.open.response", status: streamResponse.status });
```

(Do not change RB-05-01's status; only make the procedure it describes real.)

### WR-07: the SSE read loop has no timeout — a stream that never idles and never closes hangs the tool indefinitely

**File:** `.pi/extensions/qoder/client.ts:617-635`

**Issue:** `while (!folded.done) { await reader.read(); … }` terminates only on
`session.status_idle`, on stream close, or on abort. A Qoder session that keeps
the connection open (a heartbeat/keepalive comment frame, a stalled agent) pins
the tool call forever. The only escape is the user pressing Esc. The loopback
helper's docstring claims "every failure path … is written to terminate rather
than hang" — true of the fixture, not of the client.

**Fix:** Track a last-progress timestamp and race `reader.read()` against a
generous inactivity deadline (e.g. 5 minutes with no bytes), aborting the
reader and throwing an actionable error naming the elapsed time. Reset the
deadline on every chunk so a genuinely long delegation is not cut off.

### WR-08: the server-supplied session id is interpolated into request paths without encoding

**File:** `.pi/extensions/qoder/client.ts:588-601`

**Issue:** `sessionId` comes from an untrusted network response and is spliced
raw into two URLs (`${config.baseUrl}/sessions/${sessionId}/events` and
`…/events/stream`). An id containing `../`, `?`, `#` or a space re-targets or
mangles the request. The only validation is "is a non-empty string"
(`:583-586`). The blast radius is small (the peer is the host we already
trust with a bearer token), but this is the exact input-validation posture the
file claims for the model-supplied `task` and does not apply to the
server-supplied id.

**Fix:** `const encodedId = encodeURIComponent(sessionId);` and use it in both
paths; optionally reject an id that does not match `/^[A-Za-z0-9._-]{1,128}$/`
with a message naming what came back.

### WR-09: `MAX_TASK_CHARS` and the empty-task refusal are documented as the ASVS V5 control and have zero test coverage

**File:** `.pi/extensions/qoder/client.ts:143-152`, `:548-556`;
`tests/unit/qoder-client.test.ts` (no case), `tests/integration/qoder-delegate.test.ts` (no case)

**Issue:** Both validation branches are stated as deliberate security controls
mirroring `safety/index.ts`'s params validation. Neither is exercised anywhere.
They are also the two cheapest possible tests (no server needed for the throw,
and the loopback proves zero requests were issued).

**Fix:**

```ts
it("refuses a whitespace-only task before any request is issued", async () => {
	await withQoderLoopback({ frames: FRAMES }, async (loop) => {
		const config = resolveFixtureConfig(loop.baseUrl);
		await expect(delegateTask({ config, task: "   \n\t ", cwd })).rejects.toThrow(/empty after trimming/);
		expect(loop.received).toHaveLength(0);   // the load-bearing half
	});
});
it("refuses a task one character over MAX_TASK_CHARS, naming the limit, with zero requests", async () => { /* "x".repeat(MAX_TASK_CHARS + 1) */ });
```

### WR-10: the "writeAgentOverrides is never reached for a guard-blocked derivation" case is self-fulfilling — it asserts the test's own behaviour, not the code's

**File:** `tests/unit/agent-overrides.test.ts:172-193`

**Issue:** The case derives an `ok:false` result, deliberately does not call
`writeAgentOverrides`, and then asserts the settings file does not exist. That
assertion is true because the test did not call the writer. It would pass
unchanged if `applyMode` unwrapped an `ok:false` derivation and wrote `{}`
anyway — which is the actual regression the "caller discipline" note exists to
guard against. The comment at `:188-192` even says so out loud ("This case
proves that discipline by simply never calling it"). Nothing anywhere drives
`applyMode` against a guard-blocked subagent derivation.

**Fix:** Move the assertion to the caller. In `mode-switch.test.ts`, inject a
role map (or monkeypatch the module seam) whose `planner` candidate is
`us.deepseek.r1-v1:0`, drive a successful `/balanced`, then assert (a) the
notification text contains "subagent pins unchanged because" and names
"planner", and (b) the injected settings.json still has no `subagents` key. If
the seam is not reachable from the command path, that itself is worth fixing —
an untestable refusal branch is an unproven one.

### WR-11: `qoder_delegate` is registered active in every session, with no confirmation gate and no configuration gate

**File:** `.pi/extensions/qoder/index.ts:104-138`

**Issue:** Two separate problems in one registration:

1. **No human in the loop.** The tool's own description states it bypasses
   Pi's tools, AGENTS.md, the Phase 4 safety guard and the wire inspector, on a
   laptop where merging to `main` auto-deploys to AWS. Yet the model can invoke
   it unilaterally, mid-turn, with no `ctx.ui.select()` confirmation — while
   `terraform apply` and a `git push` to `main`, both strictly less
   consequential than handing an entire task to an uncontrolled foreign agent,
   require `approve_ky_command` plus a real human selection. The description is
   a warning to the model, not a control; a cheap model that misreads it is
   exactly the failure mode this harness exists to prevent. I could find no
   recorded decision in `05-CONTEXT.md` waiving a confirmation for this tool
   (decision 11 settles delegate-vs-model, not gating), so this is not
   re-litigation.
2. **No configuration gate.** The tool is registered unconditionally and costs
   a measured 329 tokens on *every* provider request, including on this machine
   and in CI where `resolveQoderConfig` can only ever refuse. CLAUDE.md names
   `pi.registerTool` + `pi.setActiveTools` progressive disclosure as the
   sanctioned answer to exactly this per-turn tax.

**Fix:** (1) Route the delegation through a confirmation in interactive mode —
`if (ctx.hasUI) { const ok = await ctx.ui.select(...); if (!ok) throw new Error("Qoder delegation declined by the user."); }` — or, if a
confirmation is deliberately not wanted, record that decision explicitly with
its reasoning next to the `TOOL_REGISTRATION_ALLOWLIST` entry. (2) Register the
tool always but activate it only when the three environment variables are
present, so an unconfigured machine pays nothing:

```ts
if (resolveQoderConfig(process.env).ok) {
	pi.setActiveTools([...pi.getActiveTools(), "qoder_delegate"]);
}
```

---

## Info

### IN-01: `ROUTING_EVENT` emission is entirely untested

**File:** `.pi/extensions/routing/index.ts:294-298`, `:453-457`
**Issue:** No test subscribes to `pi.events` or pins the emitted payload shape
(`{mode, escalated, model}`). Phase 11 will build a statusline on a contract
nothing asserts.
**Fix:** In `mode-switch.test.ts`, have the probe extension register
`pi.events.on(ROUTING_EVENT, …)` into the existing shared `globalThis` log and
assert one event with the expected three keys after a successful switch (with a
non-emptiness guard first).

### IN-02: `escalation-*.jsonl` is never pruned

**File:** `.pi/extensions/routing/index.ts:308-317`
**Issue:** Acknowledged in-code, and `.pi/logs/` is gitignored, so this is
disclosure rather than defect — but every other stream in this repo has an
owner that prunes it. Worth an explicit `pruneLogs({ ownedBases:
[ESCALATION_LOG_BASE] })` when Phase 11 touches this file.

### IN-03: `VISION_CANDIDATES` is the name used for five non-vision routes

**File:** `.pi/extensions/routing/schema.ts:226-227`, used at `:259`, `:265-268`
**Issue:** `balanced.advisor`, `max.planner`, `max.reviewer` and `max.advisor`
all read `VISION_CANDIDATES`. A reader scanning `ROLE_MAP` sees "vision" beside
`planner` and has to go look. Rename to `BEDROCK_CLAUDE_CANDIDATES` and, if
desired, keep `const VISION_CANDIDATES = BEDROCK_CLAUDE_CANDIDATES` with a
comment for the vision-specific rationale.

### IN-04: `waitForConfiguredAuth` is copy-pasted verbatim into four test files

**File:** `tests/integration/mode-switch.test.ts:147-162`,
`wire-proof.test.ts:164-180`, `single-shot-roles.test.ts:161-177`,
`mode-persistence.test.ts:77-92`
**Issue:** Four identical copies with four slightly different error messages.
The measured finding it encodes lives in one file's header; the next person to
fix a timing bug will fix one copy.
**Fix:** Move it to `tests/helpers/session.ts` (which already owns
`FauxSessionHandle`) and keep the measured-gap explanation with it.

### IN-05: `docs/ROUTING.md` never says the subagent pin is written to the GLOBAL agent settings file

**File:** `docs/ROUTING.md:107-114`, `:175-192`
**Issue:** §3 says a mode switch writes "the `settings.subagents.agentOverrides`
pin those subagents will read" without saying *where*. Given CR-01, "which
file does `/balanced` modify on my machine?" is a question a user will
reasonably have, and the answer (`~/.pi/agent/settings.json`, user scope, not
the repo's `.pi/settings.json`) is a deliberate, argued decision that deserves
one sentence in the user-facing doc.

---

_Reviewed: 2026-08-14T20:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
