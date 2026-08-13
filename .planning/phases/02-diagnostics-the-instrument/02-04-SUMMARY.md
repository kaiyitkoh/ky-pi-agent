---
phase: 02-diagnostics-the-instrument
plan: 04
subsystem: diagnostics
tags: [wave-2, prose-detector, redos, false-positives, DIAG-05]
requires:
  - "02-02 — .pi/extensions/diagnostics/redact.ts (the sibling pure-module posture this file copies)"
  - "02-02 — tests/unit/extension-layout.test.ts entry-point discriminator (permits a sibling non-entry module)"
  - "02-03 — .pi/extensions/diagnostics/schema.ts (the subsystem's single pi-ai import site)"
provides:
  - ".pi/extensions/diagnostics/prose.ts — escapeRegExpLiteral, buildProseToolCallPattern, isProseToolCall, proseToolCallName"
  - ".pi/extensions/diagnostics/schema.ts — AssistantMessage re-export (type-only)"
  - "tests/unit/prose-detector.test.ts — the PROSE/NOT_PROSE tables and the 1 MB bound; the named offline proxy for RB-02-03"
affects:
  - "02-09 (the retry effect) — imports isProseToolCall and proseToolCallName; owns sendUserMessage(deliverAs: 'followUp') and the MAX_PROSE_RETRIES cap"
  - "02-06 (turns.ts) — the prose_tool_call row records proseToolCallName(...) as the tool the model meant to call"
  - "02-11 (docs/RUNBOOK.md) — tests/unit/prose-detector.test.ts is the offline proxy RB-02-03 must name"
  - "Phase 10 — the measured prose rate this predicate produces is the number that discriminates between root causes"
tech-stack:
  added: []
  patterns:
    - "pure predicate here, effect in index.ts — the interesting half is testable with no session at all"
    - "counted quantifiers instead of `\\s*` on any pattern pointed at model output"
    - "no `g` flag on a pattern used through both .test() and .exec(), so lastIndex cannot make it lie"
    - "negatives outnumber positives when a false positive corrupts a measurement"
    - "falsify every gate individually; a gate no test can break is a gate that is not there"
key-files:
  created:
    - .pi/extensions/diagnostics/prose.ts
    - tests/unit/prose-detector.test.ts
  modified:
    - .pi/extensions/diagnostics/schema.ts
decisions:
  - "DIAG-05 is NOT marked complete — this plan ships the classifier only; the retry effect, the row and the cap are 02-09, and the requirement names the retry"
  - "AssistantMessage is re-exported from schema.ts rather than imported from pi-ai a second time, keeping the subsystem's stated single-import-site rule true"
  - "The test imports fauxAssistantMessage/fauxText/fauxToolCall from @earendil-works/pi-ai directly — tests/helpers/faux.ts does not re-export them, and tests/helpers/session.ts:73 already sets that precedent"
  - "A ninth negative case was added after a falsification run proved the leading \\b was untestable: removing it passed all 21 tests"
  - "escapeRegExpLiteral also escapes `/` and `-`, beyond the strict minimum, because over-escaping a literal is free and under-escaping widens the match"
metrics:
  duration: ~20m
  tasks: 2
  files: 3
  completed: 2026-08-13
---

# Phase 2 Plan 04: The Prose-Tool-Call Predicate Summary

A pure, bounded, tool-name-anchored predicate that decides whether a finalized
assistant message *described* a tool call instead of emitting one — proven
against five positives, nine negatives and a megabyte of adversarial text, with
every one of its gates individually falsified.

## What was built

### Task 1 — `.pi/extensions/diagnostics/prose.ts` (commit `96e34a1`)

Zero value imports, one type-only import, no I/O, no dependency.

| Export | What it does |
|---|---|
| `escapeRegExpLiteral(v)` | escapes every regex metacharacter in a tool name |
| `buildProseToolCallPattern(names)` | `\b(n1\|n2\|…)[\s]{0,8}\([\s]{0,8}\{`, or `undefined` for an empty list |
| `isProseToolCall(msg, names)` | the four gates |
| `proseToolCallName(msg, names)` | the matched name, or `undefined` |

The four gates, in order, each named at its own site in the source:

1. `stopReason === "stop"` — rules out `toolUse`, `length`, `error`, `aborted`,
   `deferred`, `pending`. Only a clean stop can be a *silently* incomplete turn.
   [VERIFIED: pi-ai 0.84.1 `dist/types.d.ts:275` — the union has that literal.]
2. No content block of type `"toolCall"` — the `tool_calls: null` half of the
   signature. Pi normalises provider tool calls into content blocks
   [VERIFIED: `dist/types.d.ts:295-297`, the `AssistantMessage.content` union].
3. A non-empty active-name list — with no registered names there is nothing a
   prose tool call could be *about*, so any hit would be a false positive by
   construction.
4. The joined `text` blocks match the name-anchored pattern.

`rawStopReason` is deliberately **not** a gate. It is the provider's
untranslated `finish_reason` and belongs in the JSONL row as enrichment, but
`fauxAssistantMessage` never populates it [02-RESEARCH.md §8.5], so requiring it
would make the detector untestable offline and silently dead against any
provider Pi does not map.

Two things in the docstring are load-bearing rather than decorative and are
stated as such:

- **A false positive is worse than a miss.** A miss costs one un-nudged turn. A
  false positive costs an extra model call *and* fabricates the prose rate
  Phase 10 will use to discriminate between root causes. Every gate is therefore
  a conjunction and none is fuzzy.
- **Nothing here parses arguments.** Promoting scraped prose into a real
  `toolCall` block works and was executed during research; it is rejected as the
  default because it would execute a tool with regex-scraped arguments on a
  laptop where merging to `main` auto-deploys, before Phase 4's guard exists
  [02-RESEARCH.md §6.4]. This file reports a name and a verdict.

The pattern uses counted quantifiers (`{0,8}`) rather than `\s*` and contains no
`.` at all, and carries **no `g` flag** — `redact.ts`'s patterns do, which makes
`.test()` lie on every other call, and this one is used through both `.test()`
and `.exec()`.

### Task 2 — `tests/unit/prose-detector.test.ts` (commit `e2e2a3e`) — 301 lines, 22 tests

- **`PROSE`, 5 cases** — bare `read({...})`; the same wrapped in explanation on
  both sides; `write` with a newline between the name and the paren; `bash` with
  whitespace between the paren and the brace; `edit_file` for the underscore.
  Each asserts the verdict **and** that `proseToolCallName` returns the right
  name, because a verdict without a name is half a measurement.
- **`NOT_PROSE`, 9 cases**, each carrying its own `protects` string that is
  printed on failure: a real `fauxToolCall("read", …)` alongside the narration;
  a bare mention; `read(path)` with no brace; `stopReason: "toolUse"`;
  `stopReason: "length"`; a perfect call evaluated against an empty name list;
  `deploy({...})` naming an unregistered tool; **`unread({...})`**, the longer
  identifier that merely ends with a tool name; and a message with no text
  blocks at all.
- **Vacuous-pass guards, three of them** — the table floors (≥5 and ≥7); at
  least one case classifying each way, with messages naming both degenerate
  predicates (`always false` reports a 0% prose rate forever, `always true`
  retries every turn); and the two mandatory negatives asserted **by label**, so
  a tidy-up that deleted either would not still satisfy the length floor.
- **Pattern-shape assertions** — empty list yields `undefined`; the source
  contains no `\s*` and no `.*` and does contain `{0,8}`; two consecutive calls
  agree (the `lastIndex` trap); and escaping is proven end to end — a registered
  name `a.b` must not match `axb` but must still match `a.b`.
- **The bound** — a 1 MB message of repeated near-miss text (`read x write y
  bash z edit_file w `) classified in under 2000 ms, with the verdict asserted
  `false` so the timing measures the expensive failure path rather than an early
  exit.

The header states plainly that this file is the offline proxy named by
`RB-02-03`: it proves the classifier and says nothing about whether the detector
has ever fired on real DeepSeek V4 Flash traffic, at what rate, or whether the
retry recovers the turn. **`RB-02-03` is OUTSTANDING.**

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit 0 |
| `npx vitest run tests/unit/prose-detector.test.ts` | exit 0, **22 tests** |
| `npm run test:unit` | 17 files, 319 tests passed (was 298 after 02-03) |
| `npm test` (full suite) | 21 files, **343 tests passed** (was 321 after 02-03) |
| `npx vitest run tests/unit/extension-layout.test.ts tests/unit/contributing-boundary.test.ts` with `prose.ts` in the index | exit 0, 15 tests |
| `grep -c "registerTool" .pi/extensions/diagnostics/prose.ts` | 0 |
| value imports in `prose.ts` | 0 (one type-only import, from `./schema.ts`) |
| built pattern source | `\b(read\|write\|bash\|edit_file)[\s]{0,8}\([\s]{0,8}\{` — no `\s*`, no `.*` |
| `buildProseToolCallPattern([])` | `undefined` |
| CR bytes in both new files | 0 |
| `git status --porcelain` after the suite | clean |

### Falsification checks — executed, not assumed

Every gate was individually broken, the suite run, and the source restored
byte-for-byte (`md5sum` identical and `git diff` empty after each).

**1. Gate 2 removed (the "no real tool call" gate the plan names).**

```
× does not fire on a real tool call, narrated as well
  Tests  1 failed | 20 passed
```

**2. Gate 1 removed (`stopReason`).**

```
× does not fire on a call-shaped string in a message that stopped for toolUse
× does not fire on a call-shaped string in a message truncated by the token limit
  Tests  2 failed | 19 passed
```

**3. Gate 3 removed (empty list builds `\b(\w+)[\s]{0,8}\([\s]{0,8}\{` instead of refusing).**

```
× refuses to build a pattern from an empty name list
```

**4. Escaping neutered (`escapeRegExpLiteral` returns its argument).**

```
× escapes metacharacters in a tool name instead of splicing them in
```

**5. Counted quantifiers replaced with `\s*`.**

```
× uses counted quantifiers rather than unbounded ones
```

**6. The brace requirement dropped.**

```
× does not fire on a mention followed by a paren but no brace
```

**7. The leading `\b` dropped — and this one initially PASSED.**

This is the finding of the plan. With the eight negatives the plan specified,
deleting the word boundary from the pattern left **all 21 tests green**. The
module docstring claimed `\b` was load-bearing and nothing could break it; the
plan's `edit_file` case proves escaping but not the boundary, because `_` sits
*inside* the name rather than before it. A ninth negative was added —
`const cached = unread({"path":"a.txt"});` — and the falsification then behaves:

```
× does not fire on a longer identifier that merely ends with an active tool name
  Tests  1 failed | 21 passed
```

Without the boundary, every helper, method and variable in a printed code block
whose name happens to end in a tool name is a false positive, in exactly the
context (a model explaining code) where the detector runs most often.

**8. The 1 MB bound is not measuring nothing.** Measured directly by temporarily
tightening the assertion to `toBeLessThan(0)` and reading the reported figure:

```
isProseToolCall took 1 ms on a 1 MB message
```

A 2000× margin — meaningful only because the counterfactual was also measured.
A nested quantifier of the kind the module forbids (`/^(a+)+$/`) on a *31-byte*
input:

```
20 chars -> 33 ms      28 chars -> 1096 ms
24 chars -> 69 ms      30 chars -> 4373 ms
```

Thirty characters costs 4.4 seconds; a million characters costs 1 millisecond.
That is the difference the counted quantifiers buy, and it is why the bound is
generous rather than tight.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 2 — correctness] A ninth negative case, because the plan's eight could not detect a missing word boundary.**

- **Found during:** Task 2 falsification
- **Issue:** The plan's positive table says the `edit_file` case proves "escaping
  and word boundaries both hold". It does not. Removing `\b` from the pattern
  passed all 21 tests. A guard no test can break is a guard that is not there.
- **Fix:** Added `NOT_PROSE` case *"a longer identifier that merely ends with an
  active tool name"* (`unread({"path":"a.txt"})`), then re-ran the falsification
  to confirm it now fails for that reason and only that reason.
- **Files modified:** `tests/unit/prose-detector.test.ts`
- **Commit:** `e2e2a3e`

**2. [Rule 3 — blocking] `AssistantMessage` is re-exported from `schema.ts` rather than imported from pi-ai a second time.**

- **Found during:** Task 1
- **Issue:** The plan's signature is `isProseToolCall(message: AssistantMessage, …)`,
  but `schema.ts`'s docstring records the subsystem rule that *only* `schema.ts`
  and `call-model.ts` may import `@earendil-works/pi-ai`, whose root entrypoint
  has an announced future removal. `schema.ts` did not re-export
  `AssistantMessage`, so the plan's signature and the recorded rule could not
  both hold.
- **Fix:** One type-only re-export in `schema.ts`, with a comment saying why the
  alternative — re-declaring the message shape locally in `prose.ts` — was
  rejected: it would trade a compile error for a silent miss the day Pi renames
  a content-block type. `prose.ts` imports the type from `./schema.ts`, keeping
  its own value-import count at zero.
- **Files modified:** `.pi/extensions/diagnostics/schema.ts`
- **Commit:** `96e34a1`

**3. [Rule 3 — blocking] The faux message builders are imported from pi-ai, not from `tests/helpers/faux.ts`.**

- **Found during:** Task 2
- **Issue:** The plan's `read_first` says to use "`fauxAssistantMessage`,
  `fauxText` and `fauxToolCall` re-export usage" from `tests/helpers/faux.ts`.
  That file re-exports none of them — it wraps `fauxProvider` for the `onPayload`
  hazard and exports payload builders.
- **Fix:** Imported the three builders directly from `@earendil-works/pi-ai`,
  which is what `tests/helpers/session.ts:73` already does. No helper was added:
  a re-export shim whose only consumer is one test file is indirection, not
  abstraction.
- **Commit:** `e2e2a3e`

**4. [judgement call] `escapeRegExpLiteral` escapes `/` and `-` as well.**

Neither is strictly required outside a character class in a non-`u` pattern, and
both are valid identity escapes there. Over-escaping a literal costs nothing and
under-escaping widens the match, which is the failure direction that matters
(threat T-02-04-02).

**5. [judgement call, logged rather than actioned] DIAG-05 was NOT marked complete.**

The plan frontmatter lists `requirements: [DIAG-05]`, but the requirement covers
the detector *and* its capped retry. This plan ships the classifier; the
`message_end` handler, the `prose_tool_call` row, the `MAX_PROSE_RETRIES` cap and
the `prose_tool_call_retry_exhausted` row are plan 02-09, and the live half is
`RB-02-03`. `REQUIREMENTS.md` is untouched. Same call, same reasoning, as 02-01,
02-02 and 02-03.

### Additions beyond the letter of the plan

- A tenth test asserting the pattern is **stateless** across two consecutive
  calls. `redact.ts` carries the opposite convention (`g`, and therefore a
  persistent `lastIndex`) and the two modules now sit next to each other; the
  note in `redact.ts`'s "Notes for the next plan" is what prompted it.
- The two mandatory negatives are asserted **by label** as well as being in the
  table, so the length floor cannot be satisfied by unrelated cases after a
  deletion.
- A `NOT_PROSE` case for a message with no `text` blocks at all — not required,
  but `collectText` on an empty content array is the shape most likely to throw
  in a `message_end` handler where an exception is silently swallowed.
- `proseToolCallName` delegates to `isProseToolCall` rather than re-implementing
  the gates, so the two exports cannot disagree; a negative-table assertion
  checks that property on every one of the nine cases.

## Known Stubs

None. Every export is implemented and exercised. `prose.ts` registers no hook
and is imported by nothing yet — that is the plan's stated scope, and the file's
docstring names 02-09 as the plan that wires the effect.

## Threat Flags

None beyond the plan's own register.

| Threat | Where it is closed |
|---|---|
| T-02-04-01 denial of service | counted `{0,8}` quantifiers, single alternation, no `.`; 1 MB message at 1 ms with the 4373 ms/30-char counterfactual measured |
| T-02-04-02 tampering via a metacharacter in a tool name | `escapeRegExpLiteral` on every name; the `a.b` vs `axb` test; falsification 4 |
| T-02-04-03 a fabricated false-positive rate | nine negatives, three vacuous-pass guards, the empty-name-list refusal, and falsifications 1-3 and 6-7 |
| T-02-04-04 elevation of privilege | accepted and stated: this plan ships a predicate; nothing parses arguments and nothing executes |
| T-02-04-SC supply chain | no package installed; `tests/unit/pinning.test.ts` still green; `prose.ts` has zero value imports |

## Notes for the next plan

- **02-09 owns the effect and the cap.** Import `isProseToolCall` and
  `proseToolCallName`; do not re-derive either. The handler must be wrapped in
  `safeHandler` and must call `noteRowWritten()` (02-03's rules).
- **`deliverAs` is mandatory inside `message_end`.** The agent is streaming
  there (`isIdle() === false`); omitting it throws
  [02-RESEARCH.md §6.3, agent-session.ts:1167-1172].
- **Pass `pi.getActiveTools()`, never a hardcoded list.** The empty-list refusal
  is the gate that keeps a mis-wired call from reporting a 100% prose rate.
- **Record `rawStopReason` on the row as optional enrichment.** Never gate on it;
  faux does not set it.
- **Do not add a `g` flag to the pattern.** It is used through both `.test()` and
  `.exec()` and `lastIndex` would make alternate calls disagree.
- **`tests/unit/prose-detector.test.ts` is the offline proxy `RB-02-03` must
  name** when plan 02-11 appends the Phase 2 runbook section. The live half stays
  **OUTSTANDING**.

## Self-Check: PASSED

Both new files exist on disk (`.pi/extensions/diagnostics/prose.ts`,
`tests/unit/prose-detector.test.ts`), the modified file
(`.pi/extensions/diagnostics/schema.ts`) is committed, and both task commits
(`96e34a1`, `e2e2a3e`) are present in `git log`.
