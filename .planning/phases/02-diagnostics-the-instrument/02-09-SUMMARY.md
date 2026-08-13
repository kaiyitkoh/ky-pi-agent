---
phase: 02-diagnostics-the-instrument
plan: 09
subsystem: diagnostics
tags: [wave-5, prose-retry, follow-up-injection, retry-cap, negative-controls, DIAG-05]
requires:
  - "02-04 — .pi/extensions/diagnostics/prose.ts (isProseToolCall, proseToolCallName)"
  - "02-08 — .pi/extensions/diagnostics/index.ts (the message_end hook, the turn accumulator, safeHandler, writeTurnsRow)"
  - "02-03 — .pi/extensions/diagnostics/schema.ts (MAX_PROSE_RETRIES, PROSE_EVENT, PROSE_EXHAUSTED_EVENT)"
  - "02-01 — tests/helpers/{session,faux,logs,git}.ts"
provides:
  - ".pi/extensions/diagnostics/index.ts — the prose-tool-call EFFECT: the verdict on the turn row, the standalone event record, the capped follow-up retry, the exhaustion record; the entry point now registers eight hooks"
  - ".pi/extensions/diagnostics/index.ts — PROSE_RETRY_FORCES_TOOL_CHOICE (false, no handler registered)"
  - ".pi/extensions/diagnostics/schema.ts — PROSE_RETRY_PROMPT"
  - "tests/integration/prose-retry.test.ts — eleven live-session cases, twelve executed falsifications"
affects:
  - "02-10 (/budget) — rowsWrittenThisSession() now counts standalone prose records too"
  - "02-11 (docs/DIAGNOSTICS.md) — the promotion alternative is documented in index.ts's docstring, ready to copy; docs/RUNBOOK.md's RB-02-03 must name BOTH offline proxies (tests/unit/prose-detector.test.ts and tests/integration/prose-retry.test.ts) and stay OUTSTANDING"
  - "Phase 4 (command guard) — once it ships, tool-call promotion becomes available as a lever for read-only tools"
  - "Phase 10 (root-cause discrimination) — reads the standalone prose_tool_call records and their `tool` column; PROSE_RETRY_FORCES_TOOL_CHOICE is the flag it flips once a baseline rate exists"
tech-stack:
  added: []
  patterns:
    - "the verdict rides on the turn accumulator; the ACTION gets its own kind-less record — one row per turn stays true"
    - "record what the turn WAS on the turn row, what the harness DID out of band"
    - "when two negative controls cover for each other, neither gate is tested — break the symmetry with a fixture per gate"
    - "assert the fixture still classifies the way the test assumes, or a zero count is a pass over a detector that never ran"
    - "capture the outgoing context with a faux response factory to prove an injected message reached the model"
    - "a flag-guarded lever registers NO handler while off — an inert registration is one edit from live and shows up in the hook list"
key-files:
  created:
    - tests/integration/prose-retry.test.ts
  modified:
    - .pi/extensions/diagnostics/index.ts
    - .pi/extensions/diagnostics/schema.ts
    - tests/unit/diagnostics-entry.test.ts
decisions:
  - "DIAG-05 stays Pending — the [FAUX] half is now complete end to end, but RB-02-03 (has the detector fired on real DeepSeek V4 Flash traffic, at what rate) is OUTSTANDING and this machine cannot answer it"
  - "follow-up injection, not tool-call promotion: promotion works and is cheaper, and is rejected because it executes a tool with regex-scraped arguments before Phase 4's guard exists"
  - "the exhausted branch appends ONLY the exhaustion record, not that record plus a second prose_tool_call — the plan's body and its acceptance criteria conflicted and the criteria are the tiebreaker"
  - "counts filter on `kind` before counting: the turn row and the standalone record both carry event: prose_tool_call and they mean different things"
  - "the degraded-cost marker beats the prose verdict when both want the row's single `event` field — a fabricated zero cost is unrecoverable, the verdict is not"
  - "docs/RUNBOOK.md is untouched: 02-11 owns the Phase 2 runbook section, as 02-04 recorded"
metrics:
  duration: ~40m
  tasks: 2
  files: 4
  completed: 2026-08-13
---

# Phase 2 Plan 09: The Prose-Tool-Call Retry Summary

The detector now acts: a turn whose assistant message *describes* a tool call is
logged as `prose_tool_call` and retried exactly once, inside the same agent run,
by a follow-up user message that executes nothing — and a second prose response
logs `prose_tool_call_retry_exhausted` and stops paying.

## What was built

### Task 1 — the effect in `index.ts` (commit `d9057a4`)

`message_end` now runs the 02-04 predicate against `pi.getActiveTools()` after
storing the finalized message, inside the same `safeHandler` wrapper. In order:

| Step | What it does | Why it is that way |
|---|---|---|
| role gate | returns unless `assistant` | `message_end` fires for user and toolResult messages too |
| `isProseToolCall` | returns unless it fires | the active-tool list is never hardcoded; gate 3 refuses an empty one |
| `turn.event = PROSE_EVENT` | stamps the accumulator | so the turn's own row carries the verdict **alongside** `stopReason` |
| cap check | `PROSE_EXHAUSTED_EVENT` record, return | a second prose response is a signal, not something to keep paying for |
| standalone record | `PROSE_EVENT` + `tool` + `sessionId` + `corr` | survives if `turn_end` never runs — Pi swallows handler exceptions |
| `sendUserMessage` | `{ deliverAs: "followUp" }` | mandatory inside `message_end`; resumes the SAME run |

`proseRetriesThisRun` resets on `agent_start`, registered through `safeHandler`
like everything else. The entry point registers **eight** hooks now.

**Two rows carry `event: prose_tool_call`, and they mean different things.** The
turn's own row (`kind: "turn"`) records what the turn *was*. The standalone
record (no `kind`, exactly like `session_start` and `diagnostics.error`) records
what the harness *did*. 02-08's handover was explicit that `message_end` must not
append a second **turn** row — `turn_end` already writes and counts one per turn
— and that constraint is honoured: nothing here is `kind: "turn"`, so no per-turn
total doubles.

**The handler still returns no value.** A returned `{ message }` replaces the
finalized message in place [VERIFIED: pi 0.84.1 `agent-session.ts:710-724`], and
that is the promotion path. `grep -c 'type: "toolCall"'` on the file returns 0.

**`PROSE_RETRY_FORCES_TOOL_CHOICE = false`**, with the mechanism recorded at its
docstring (a second `before_provider_request` handler returning a payload with
`tool_choice: "required"`, RESEARCH §1.2) and the reason it is off: its effect is
**UNVERIFIED**, and turning it on before a baseline exists would mean the
detector measures the intervention rather than the problem. **No handler is
registered while the flag is false** — an inert registration is one edit from
live and would appear in the hook list, implying a capability this subsystem does
not have.

The module docstring now carries the promotion paragraph: it was executed during
research and works at zero extra model calls (§6.4), and it is not built because
it executes a tool with arguments regex-scraped out of untrusted prose, on a
laptop where merging to `main` auto-deploys and Phase 4's guard has not shipped;
because it rewrites session history to claim the model emitted a call it did not,
corrupting the measurement Phase 10 reads; and because a wrong parse is a
*silently wrong action* rather than a visible retry. It becomes available for
read-only tools once Phase 4 ships.

### Task 2 — `tests/integration/prose-retry.test.ts` (commit `fd8ed2a`) — 11 cases

Six in-memory sessions, the real extension at user scope, `read` active in every
one, all assertions reading bytes off disk.

| Case | What it holds |
|---|---|
| precondition | the fixture text still classifies as prose **and** returns `false` against an empty tool list |
| 1 | `callCount === 2`; exactly one standalone `prose_tool_call` naming `read` with a `corr`; two turn rows; the prose row carries the verdict **and** `stopReason: "stop"` **and** `outcome: "ok"`; the retry row carries no verdict |
| 1b | the second request's context really contains `PROSE_RETRY_PROMPT`, as a second **user** message |
| 2 | exactly one `agent_end` and one `agent_start`, counted by an inline probe extension that wraps the real one |
| 3 | three prose responses scripted → two calls, one `prose_tool_call`, one `prose_tool_call_retry_exhausted` naming the tool, one response left unconsumed, both turn rows carrying the verdict |
| 4 | a real `fauxToolCall` narrated as well: zero prose records, two turns, `toolCalls ≥ 1`, `toolResults ≥ 1` |
| 4b | a **clean stop** that nonetheless carries a real tool call — gate 2 alone |
| 4c | the same prose on a `length`-truncated turn — gate 1 alone |
| 5 | the prose turn's row has `toolCalls: 0` and `toolResults: 0` — the difference from promotion |
| 6 | two prompts, four calls, two retries, zero exhaustions — the only case that can see the `agent_start` reset |
| vacuity | every fixture had the tool active |

Case 2's probe writes to files in `cwd` rather than incrementing a variable: Pi
loads the extension through jiti, which keeps its own module registry, so an
in-process counter this file could read would never move (02-05's finding).

Case 1b exists because `callCount === 2` proves a second request happened and
says nothing about whether it carried the nudge. A retry that re-sends the
identical context is a second roll of the same dice.

### A real record set, dumped from a live session

```json
{"ts":1786601464878,"event":"prose_tool_call","tool":"read",
 "sessionId":"019ff9be-…","corr":"019ff9be-…#1"}
{"ts":1786601464879,"kind":"turn","role":"session","corr":"019ff9be-…#1",
 "provider":"faux","model":"faux-flash","stopReason":"stop","outcome":"ok",
 "toolCalls":0,"turnIndex":0,"toolResults":0,"thinkingLevel":"medium",
 "event":"prose_tool_call"}
{"ts":1786601464881,"kind":"turn","role":"session","corr":"019ff9be-…#2",
 "stopReason":"stop","outcome":"ok","toolCalls":0,"turnIndex":1,"toolResults":0}
```

`stopReason` and the verdict side by side; the retry turn clean; zero tool calls
and zero tool results on both. This dump was taken with a throwaway probe, read,
and the probe deleted.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit 0 |
| `npx vitest run tests/integration/prose-retry.test.ts` | exit 0, **11 tests** |
| `npm test` (full suite) | 28 files, **437 tests passed** (was 426 after 02-08) |
| wire-nonmutating + contributing-boundary + extension-layout + diagnostics-entry + chokepoint-lint | exit 0, 31 tests |
| `grep -n deliverAs .pi/extensions/diagnostics/index.ts` | one call site, value `"followUp"` |
| `grep -c 'type: "toolCall"' .pi/extensions/diagnostics/index.ts` | **0** — no promotion path |
| `PROSE_RETRY_FORCES_TOOL_CHOICE` | `false`; registered hook list is eight entries, `before_provider_request` appearing once |
| `message_end` handler return | none — block-bodied, every path `return;` or falls off the end |
| CR bytes in all four touched files | 0 |
| `.pi/logs/` in this repository | does not exist |
| `git status --porcelain` after the full suite | clean |

### Falsification checks — twelve, executed, each restored byte-identical

Every sabotage was applied to real source, the suite run, and the file restored
from a backup verified with `md5sum`.

| # | Sabotage | Result |
|---|---|---|
| A | `MAX_PROSE_RETRIES = 2` | case 3 fails |
| A2 | `MAX_PROSE_RETRIES = 2` **with the constant guard removed** | case 3 fails on `expected 3 to be 2` — the cap is REACHED, not merely asserted |
| B | the retry call deleted | cases 1, 1b, 2, 3, 6 fail |
| C | `deliverAs` omitted | cases 1, 1b, 2, 3, 6 fail — RESEARCH §6.3's "omitting it throws" re-verified live at 0.84.1 |
| D | standalone `PROSE_EVENT` record not appended | cases 1, 3, 6 fail |
| E | `turn.event = PROSE_EVENT` removed | cases 1, 3 fail |
| F | exhaustion record not appended | case 3 fails |
| G | the `agent_start` reset removed | case 6 fails |
| H | **gate 2 removed from `prose.ts`** | **all 9 passed — see below** |
| H2 | gate 2 removed, against the new case 4b | case 4b fails |
| J | **gate 1 removed from `prose.ts`** | **all 10 passed — see below** |
| J2 | gate 1 removed, against the new case 4c | case 4c fails |

A2 matters more than A. With the guard in place the sabotage trips
`expect(MAX_PROSE_RETRIES).toBe(1)` first, which proves only that the constant
moved. Removing the guard shows the provider really was called three times — the
cap is a behaviour this file exercises, not a number it reads back.

## Deviations from Plan

### The finding — the plan's one negative control could not detect a missing gate

**1. [Rule 2 — correctness] Two extra negative controls, because the first was covered for.**

- **Found during:** Task 2 falsification H
- **Issue:** The plan specifies one live negative control (case 4: a real tool
  call, narrated as well). It passed. Then deleting **gate 2** from `prose.ts` —
  the "no `toolCall` content block" gate, the exact one case 4 is written to
  defend — left all nine cases green, because a genuine tool call always carries
  `stopReason: "toolUse"` and **gate 1** rejected it first. Deleting **gate 1**
  instead was also green, because gate 2 then caught it. Each gate was covering
  for the other, and neither was tested at this layer.
- **Fix:** Case 4b — a **clean stop** that nonetheless carries a real tool call,
  which only gate 2 can reject. Case 4c — the same prose text on a
  `length`-truncated turn, which only gate 1 can reject. Both were re-falsified
  (H2, J2) and each now fails for its own gate and only that gate.
- **Why 4b is not contrived:** `stopReason` is Pi's *mapping* of the provider's
  `finish_reason` [pi-ai `openai-completions.ts:462-464`], and a cheap
  OpenAI-compatible endpoint reporting `stop` on a response that nonetheless
  carried `tool_calls` is exactly the provider misbehaviour this harness exists
  for. The agent loop decides what to execute from the content blocks, not the
  stop reason [pi-agent-core `agent-loop.ts:203`], so the tool really runs in
  that fixture.
- **Files modified:** `tests/integration/prose-retry.test.ts`
- **Commit:** `fd8ed2a`

This is the same shape as plan 02-04's ninth negative, and the same lesson: a
guard no test can break is a guard that is not there.

### Auto-fixed / adjusted

**2. [Rule 3 — blocking] The plan's body and its acceptance criteria conflicted on the exhausted branch.**

- **Issue:** The action text says to append the `PROSE_EVENT` record and *then*,
  if the budget is spent, append `PROSE_EXHAUSTED_EVENT`. The acceptance criteria
  say case 3 must find **exactly one** `PROSE_EVENT` and **exactly one**
  `PROSE_EXHAUSTED_EVENT` against three scripted prose responses. Both cannot
  hold: the literal ordering produces two `PROSE_EVENT` records.
- **Fix:** The exhausted branch appends only the exhaustion record and returns.
  The criteria are the tiebreaker, and the resulting shape is the more honest
  one: **one standalone record per ACTION taken**, while the detector's verdict
  lives on the turn row for every prose turn regardless of budget.
- **Commit:** `d9057a4`

**3. [Rule 3 — blocking] Counts filter on `kind` before counting.**

- **Issue:** The plan asks for the verdict on the turn's own row *and* a
  standalone record, both carrying `event: PROSE_EVENT`, and then for a test
  asserting "exactly one record with `event: PROSE_EVENT`". Counting bare `event`
  matches across both shapes makes that unassertable — case 1 alone would find
  two, and case 3's two turn rows legitimately both carry the verdict.
- **Fix:** `standalone()` filters `kind === undefined`, `turnRows()` filters
  `kind === "turn"`, and the test's docstring states the distinction before any
  count is taken. Nothing in the log had to change: the standalone record already
  carries no `kind`, exactly like the `session_start` and `diagnostics.error`
  rows.
- **Commit:** `fd8ed2a`

**4. [Rule 3 — blocking] `tests/unit/diagnostics-entry.test.ts`'s hook list grew to eight.**

Its own failure message says the list "should grow with them — not be deleted".
It now names `agent_start` and why, and adds a line saying that a *second*
`before_provider_request` entry would mean the `tool_choice` lever had been
switched on.

**5. [Rule 2 — correctness] `turn_end` gives the degraded-cost marker precedence over the prose verdict.**

`event` is one string and two things want it. `diagnostics.model_unavailable`
wins, because losing it puts a fabricated zero cost into a Phase 8 spend total
with nothing anywhere saying so [threat T-02-08-05]. Losing the prose verdict on
that row costs nothing equivalent — the standalone record already carries it,
which is exactly the case that record exists for. Unreachable through a live
session (`ctx.model` is always set), so it is a comment and a conditional, not a
test.

### Additions beyond the letter of the plan

- **Case 1b — the retry prompt actually reached the model.** The plan asserts
  `callCount === 2`. That proves a second request happened and nothing about what
  it carried; a retry that re-sends the identical context is a second roll of the
  same dice. A capturing faux response factory records the outgoing `Context`, and
  the case asserts `PROSE_RETRY_PROMPT` is in it and that it arrived as the second
  **user** message (RESEARCH §6.5 notes a custom message would be a weaker prompt).
- **Case 6 — the `agent_start` reset.** Every fixture the plan names drives ONE
  prompt, so a build that never reset `proseRetriesThisRun` would pass all of them
  and then, in real use, retry the first prose call of the session and log
  `prose_tool_call_retry_exhausted` for every one after it, all day, with no error
  anywhere. Falsification G confirms this case is the only one that catches it.
- **A precondition case** asserting the fixture text still classifies as prose,
  and that the same message classifies `false` against an empty tool list. Every
  negative case here counts to zero; without this, a tool rename or a tightened
  pattern turns the whole file into a green run over a detector that never fired.
- **`agent-start.count === 1` in case 2**, beside the `agent_end` count. A second
  `agent_start` mid-run would hand the detector a fresh budget on every retry and
  make the cap decorative.
- **`capped.pending === 1`** — the same fact as `callCount === 2` read from the
  other end: the run *stopped* rather than continuing to draw on the script.
- **`readTurns` fails with the remedy** ("the extension must load at USER scope")
  rather than an `ENOENT` stack, copying `turns-log.test.ts`'s discipline.

## Known Stubs

None. Every branch of the effect is exercised end to end by a live session:
detection, the verdict on the row, the standalone record, the retry, the cap, the
exhaustion record, the reset, and all three negative controls.

`PROSE_RETRY_FORCES_TOOL_CHOICE` is **not** a stub. It is a documented,
deliberately unbuilt lever with no handler behind it — the plan's own instruction
(RESEARCH Open Question 1, disposition `accept` on threat T-02-09-06) and the
hook-list assertion is what keeps it that way.

## Threat Flags

None beyond the plan's own register.

| Threat | Where it is closed |
|---|---|
| T-02-09-01 executing a tool the model never emitted | promotion is not built; case 5 asserts `toolCalls: 0` and `toolResults: 0` on the prose turn; `grep -c 'type: "toolCall"'` is 0 |
| T-02-09-02 an unbounded retry loop | `MAX_PROSE_RETRIES` is 1, reset on `agent_start`; case 3, and falsification A2 shows raising the cap really does buy a third call |
| T-02-09-03 a false-positive rate corrupting Phase 10's evidence | 02-04's nine unit negatives plus THREE live controls here, one per gate, each individually falsified; the verdict sits beside `stopReason`, never instead of it |
| T-02-09-04 replacing the finalized message | the handler returns no value on every path; the replacement contract is cited at the hook |
| T-02-09-05 a detector exception vanishing | the whole check runs inside `safeHandler`, which writes a `diagnostics.error` row — falsification C exercised that path live (the `deliverAs`-less throw was caught and the session survived) |
| T-02-09-06 `tool_choice: "required"` on an unverified hypothesis | flag is `false`, no handler registered, and the hook-list assertion names the symptom |
| T-02-09-SC supply chain | nothing installed; `tests/unit/pinning.test.ts` green in the full run |

## Notes for the next plan

- **DIAG-05 is NOT complete.** Its `[FAUX]` half is now finished end to end, but
  `RB-02-03` — *has the detector fired on real DeepSeek V4 Flash traffic, and at
  what rate* — needs live credentials this machine does not have and is
  **OUTSTANDING**. `REQUIREMENTS.md` is untouched; DIAG-05 stays `Pending`,
  exactly as DIAG-01 does.
- **02-11 owns the runbook entry**, as 02-04 recorded. `RB-02-03` must name
  **both** offline proxies — `tests/unit/prose-detector.test.ts` (the classifier)
  and `tests/integration/prose-retry.test.ts` (the mechanism) — and must never be
  reported as passing on the strength of either.
- **02-11's `docs/DIAGNOSTICS.md` should copy, not re-derive**, the promotion
  paragraph now in `index.ts`'s module docstring: it is the "available lever for
  read-only tools once Phase 4 ships" the research asks to be documented.
- **`/budget` (02-10) counts the standalone prose records too.** They go through
  `writeTurnsRow`, so `rowsWrittenThisSession()` matches the file.
- **A prose row is not a spend row and not a turn row.** Anything grouping
  `turns-*.jsonl` must filter on `kind` first: `kind: "turn"` is what a per-turn
  or per-cost total sums over, and the kind-less records are events.
- **Phase 10 flips `PROSE_RETRY_FORCES_TOOL_CHOICE`,** not Phase 2 and not Phase
  5. Building the second `before_provider_request` handler is a ten-line job; the
  baseline rate it needs is the expensive part.

## Self-Check: PASSED

All four touched files exist on disk
(`.pi/extensions/diagnostics/index.ts`, `.pi/extensions/diagnostics/schema.ts`,
`tests/integration/prose-retry.test.ts`, `tests/unit/diagnostics-entry.test.ts`),
and both task commits (`d9057a4`, `fd8ed2a`) are present in `git log`.
