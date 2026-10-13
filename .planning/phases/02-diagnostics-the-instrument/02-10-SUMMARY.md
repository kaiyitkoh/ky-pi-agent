---
phase: 02-diagnostics-the-instrument
plan: 10
subsystem: diagnostics
tags: [wave-6, budget, system-prompt-decomposition, boundary-rule, pitfall-9, DIAG-06]
requires:
  - "02-03 — .pi/extensions/diagnostics/jsonl.ts (appendJsonl), schema.ts (DIAGNOSTICS_ERROR_EVENT, TURNS_LOG_BASE, TURNS_ROTATE_BYTES, MAX_ROTATED_FILES), redact.ts (redactString), index.ts (rowsWrittenThisSession, noteRowWritten)"
  - "02-08 — .pi/extensions/diagnostics/index.ts (the turn rows rowsWrittenThisSession now counts; the turns log case 3 reads)"
  - "02-09 — .pi/extensions/diagnostics/index.ts (the standalone prose records the same counter counts)"
  - "02-01 — tests/helpers/{session,logs,git}.ts"
provides:
  - ".pi/extensions/diagnostics/budget.ts — estimateTokensFromChars, sliceSystemPrompt, computeBudget, formatBudgetReport, registerBudgetCommand, plus every marker and label literal a test asserts on"
  - ".pi/extensions/diagnostics/index.ts — the `/budget` registration; the subsystem now has eight hooks and exactly one command"
  - "tests/unit/budget-sections.test.ts — eight cases over inline fixtures, eight executed falsifications"
  - "tests/integration/budget.test.ts — five live-session cases, seven executed falsifications"
affects:
  - "02-11 (docs/DIAGNOSTICS.md) — the `/budget` section should copy budget.ts's docstring: characters primary, tokens ±20%, no tokenizer may be added, and the two independent reasons it is a command"
  - "Phase 10 (CTX-03, context pollution) — `/budget` is the measurement that hands it a target number; the decomposition is the discriminator between `the prompt is big` and `one context file is 97% of it`"
  - "Phase 8 (cost accounting) — cacheReadRatio here uses the same definition as TurnRow.cacheReadRatio, deliberately"
tech-stack:
  added: []
  patterns:
    - "compute a remainder by removing located regions, never by subtraction — a subtracted base makes the sum assertion an identity that holds however wrong the arithmetic is"
    - "warn only about a section that was EXPECTED and is missing; a warnings array that fires on every healthy session is one nobody reads on the session that mattered"
    - "select table rows by a column the sabotage does not touch (the character count), so a formatter that dropped the marker still yields the row and fails"
    - "build a self-scanning regex rather than spelling it, so the guard does not match itself"
    - "cross-check ctx.getSystemPrompt() against the context.systemPrompt the provider adapter received — the report must describe the string that was paid for"
key-files:
  created:
    - .pi/extensions/diagnostics/budget.ts
    - tests/unit/budget-sections.test.ts
    - tests/integration/budget.test.ts
  modified:
    - .pi/extensions/diagnostics/index.ts
    - tests/unit/diagnostics-entry.test.ts
    - .planning/REQUIREMENTS.md
decisions:
  - "DIAG-06 is marked COMPLETE — it is [FAUX]-only, and every input it names is exercised offline: the decomposition against the installed Pi's real prompt, the tool schemas the provider was really sent, and faux's genuine prefix-cache simulation across two turns"
  - "registerBudgetCommand takes a third parameter, noteRowWritten, beyond the signature the plan wrote — the failure path appends a row, and a counter only some append paths increment reports a number that looks like a measurement and is not"
  - "a missing marker warns only when the section was expected: context files loaded but no block, or a recomputed skills block that is not in the prompt. An unconditional warning would fire on every session with no skills"
  - "the per-file context breakdown carries Pi's exact per-file wrapper and therefore sums to slightly LESS than the sliced block; the residual (delimiters plus header) is stated rather than hidden by fudging the per-file numbers"
  - "the integration test supplies its own contextFiles list because getSystemPromptOptions() is command-context only and a headless session cannot invoke a slash command; the gap is stated in the file header rather than papered over"
metrics:
  duration: ~55m
  tasks: 3
  files: 6
  completed: 2026-08-13
requirements-completed: [DIAG-06]
---

# Phase 2 Plan 10: `/budget` Summary

`/budget` prints the number: how many characters of every request are Pi's base
prompt, this project's context files, the skills index and the active tool
schemas — with the provider's own `usage.input` beside the estimates as ground
truth, and the rows-written count so a dead instrument says so on screen.

## What was built

### Task 1 — `.pi/extensions/diagnostics/budget.ts` (commit `e78dbf3`)

Six exports, three of them pure.

| Export | What it does |
|---|---|
| `estimateTokensFromChars` | `Math.ceil(chars / 4)` — Pi's own formula [VERIFIED: `src/core/compaction/compaction.ts:274`], labelled ±20% at its docstring and again in the rendered output |
| `sliceSystemPrompt` | locates the two literal blocks and reports `total`, `base`, `contextFiles`, `skills` plus a `*Found` flag each |
| `computeBudget` | per-section characters and estimates, per-file and per-tool breakdowns, `cacheReadRatio`, `rowsWritten`, `skillsBlockMatchesSlice`, `warnings` |
| `formatBudgetReport` | plain aligned text; characters primary, every token figure prefixed `~` |
| `registerBudgetCommand` | the command, and the only function in the file that reads the world |
| the literals | every marker, label and warning string, exported so a test imports rather than re-types one |

**The markers are transcribed from Pi's own recovered TypeScript**, not from a
doc: `prompt += "\n\n<project_context>\n\n"` … `"</project_context>\n"`
[VERIFIED: pi 0.84.1 `src/core/system-prompt.ts:146,151`] and the skills block's
opening sentence and `</available_skills>` close
[VERIFIED: `src/core/skills.ts:343,358`], both recovered from
`dist/**/*.js.map` `sourcesContent` this session.

**`base` is the prompt with the located regions physically removed, never
`total - contextFiles - skills`.** That distinction is the whole content of the
sum assertion. Falsification A4 proves it: with both regions accidentally
resolving to the same block, the remainder-based build fails
`expected 916 to be 714`, while a subtraction-based `base` would have satisfied
`base + contextFiles + skills === total` as an identity and passed.

**A missing marker is reported, never guessed.** `contextFilesFound` and
`skillsFound` make a genuinely empty section distinguishable from one whose
delimiter moved — the failure a package shipping every 2–3 days will eventually
produce, and the one this decomposition would otherwise hide by attributing 97%
of the prompt to "base" with a straight face. [threat T-02-10-02]

**Warnings fire only for a section that was EXPECTED.** Context files loaded and
no block found; a skills block recomputed with Pi's own `formatSkillsForPrompt`
and not present; or the two differing in size. A session with no skills is
silent, because a warnings array that cries on every healthy run is one nobody
reads on the run that mattered.

**The boundary rule is stated twice, for two different reasons.** A command
costs zero per-turn tokens where the other kind of registration serialises a
full JSON Schema into every request [VERIFIED: pi-ai
`src/api/openai-completions.ts:1337-1370`] — a report *about* per-turn token cost
becoming one would be the instrument turning into the thing it measures. And
independently: `getSystemPromptOptions()` exists on `ExtensionCommandContext` and
not on the context a tool receives [VERIFIED: pi 0.84.1
`dist/core/extensions/types.d.ts:256` versus `:219-249`], so a tool could not
compute this report at all. `grep -c registerTool` on the file returns 0.

### Task 2 — the registration and the pure proofs (commit `5802f2f`)

`index.ts` calls `registerBudgetCommand(pi, rowsWrittenThisSession, noteRowWritten)`
at the bottom of its default export, and its LAYOUT paragraph now names
`budget.ts` and DIAG-06.

`tests/unit/diagnostics-entry.test.ts` gained `registerCommand` on its stub —
without it the entry point throws a `TypeError` and the eight-hook assertion
never runs — and a new assertion that the registered-command list is **exactly**
`["budget"]`. That is the positive half of BOOT-10 at the subsystem level;
`contributing-boundary.test.ts` keeps the negative half across all of
`.pi/extensions/`.

`tests/unit/budget-sections.test.ts`, eight tests over inline fixtures:

| Case | What it holds |
|---|---|
| 1 | the three sections sum to the whole prompt, and each is exactly its block |
| 2 | no context block → 0 **and** the flag false; `base` absorbs the rest; `computeBudget` warns and names the marker |
| 3 | the skills mirror, **plus** the benign case: no skills configured warns about nothing |
| 4 | `0→0, 1→1, 4→1, 5→2`, and `49_404 → 12_351` — this repository's own `CLAUDE.md`, measured live [RESEARCH §7.4] |
| 5 | a divergent recomputed skills block sets `skillsBlockMatchesSlice` false, warns, and reaches the rendered text; paired with a matching positive |
| 6 | three fake tools sum to `name + description + JSON.stringify(parameters)`; the breakdown names `bash` first and sums to the total |
| 7 | the rows-written figure renders, zero **and** non-zero |
| 8 | every table row carries `~`, the provider-reported line is separate and labelled, no file content appears |

The fixture preamble deliberately contains the words "project" and "skills" in
prose, so a slicer matching a loose substring rather than the full delimiters
would find them and break the sum.

### Task 3 — `tests/integration/budget.test.ts` (commit `06911c6`) — 5 cases

One live session, two prompts, a planted `AGENTS.md`, the real diagnostics
extension wrapped by an inline probe that writes `ctx.getSystemPrompt()` to a
file in `cwd` (jiti gives the loaded extension its own module registry, so an
in-process variable would never move — 02-05's finding).

The prompt Pi actually built, from this run:

```
...follow links to related docs (e.g., tui.md for TUI API details)

<project_context>

Project-specific instructions and guidelines:

<project_instructions path="C:\...\kypi-cwd-HHOWNV\AGENTS.md">
# Project notes

Always run the tests before committing.

</project_instructions>

</project_context>

Current working directory: C:/.../kypi-cwd-HHOWNV
```

and the slices: `{total: 2023, base: 1789, contextFiles: 234, skills: 0,
contextFilesFound: true, skillsFound: false}` — 1789 + 234 + 0 = 2023.

| Case | What it holds |
|---|---|
| 1 | the sum, against the installed Pi's real prompt; `contextFilesFound` true; the block is at least as long as the planted file; **and `ctx.getSystemPrompt()` is byte-identical to the `context.systemPrompt` the provider adapter received** |
| 2 | `skillsFound` false with no skill configured, `skills` 0 consistently, `warnings` empty, `skillsBlockMatchesSlice` true, and at least one real tool schema present |
| 3 | two turns of one session: `cacheRead` 0 then 511, ratio 0.744 — strictly between 0 and 1, computed the same way `TurnRow.cacheReadRatio` is |
| 4 | the report names the context file's path, contains none of its content, marks estimates, and carries the last turn's real `input` |
| 5 | a built regex proves no size threshold was smuggled into the file (Pitfall 9) |

Case 1's cross-check is an addition: `/budget` reports `ctx.getSystemPrompt()`
and the user pays for `context.systemPrompt`, so a divergence would make the
whole report a description of something else. They are equal at 0.84.1.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit 0 |
| `npm test` (full suite) | 30 files, **450 tests passed** (was 437 after 02-09) |
| `npx vitest run tests/unit/budget-sections.test.ts tests/unit/contributing-boundary.test.ts` | exit 0, 12 tests |
| `npx vitest run tests/integration/budget.test.ts` | exit 0, 5 tests |
| `grep -c registerTool .pi/extensions/diagnostics/budget.ts` | **0** |
| `grep -n registerCommand …/budget.ts` | one call site, name `budget` |
| `grep -n formatSkillsForPrompt …/budget.ts` | present, at the import and the call |
| `contributing-boundary.test.ts` | zero tool registrations, ≥1 command registration, under `.pi/extensions/` |
| `extension-layout.test.ts`, `chokepoint-lint.test.ts`, `diagnostics-entry.test.ts` | green; `budget.ts` has no default export, so the layout gate classifies it as an imported module |
| CR bytes in all six touched files | 0 |
| `.pi/logs/` in this repository | does not exist |
| `git status --porcelain` after the full suite | clean |

### A real report, rendered from the pure functions

```
/budget -- per-turn token budget

Token figures marked ~ are ESTIMATES: Math.ceil(chars / 4), Pi's own heuristic, roughly +/-20% error. Characters are the measurement.

  section                            chars    tokens
  --------------------------------------------------
  system prompt (total)                328       ~82
    base prompt                         45       ~12
    context files                      169       ~43
    skills index                       114       ~29
  tool schemas (2 active)               94       ~24

  context files, largest first:
    /tmp/AGENTS.md                      82       ~21

  tool schemas, largest first:
    bash                                62       ~16
    read                                32        ~8

provider-reported (ground truth): input 12725 tokens, cacheRead 3000 tokens, cache-read ratio 0.191
diagnostic rows written this session: 0  (0 means the instrument recorded nothing this session)
```

### Falsification checks — fifteen, executed, every file restored byte-identical

Each sabotage was applied to real source, the suite run, and the file restored
from a backup verified with `md5sum` and `diff`.

**Unit (8):**

| # | Sabotage | Result |
|---|---|---|
| A | both regions resolve to the context block, `base` by remainder | case 1 — **`expected 916 to be 714`**, the sum assertion firing first |
| A2 | the same duplicate, `base` by subtraction | case 1 fails on the *other* assertions; the sum passes as an identity |
| A3 | `base: remainder.length - 1` | the sum assertion in isolation — `expected 713 to be 714` |
| B | `contextFilesFound` / `skillsFound` hardcoded `true` | cases 2, 3 |
| C | the `~` prefix dropped from the token column | case 8 |
| D | `Math.round` instead of `Math.ceil` | case 4 |
| E | `warnings` never populated | cases 2, 3, 5, 8 |
| F | `rowsWritten` hardcoded to 0 | case 7 — on the *paired positive*, which is why it is there |
| G | `skillsBlockMatchesSlice` hardcoded `false` | cases 3, 5 |
| H | the `/budget` registration removed from `index.ts` | `diagnostics-entry` — `expected [] to deeply equal [ 'budget' ]` |

A and A2 are the pair that matters. A2 shows that with a subtracted `base` the
sum assertion is an identity: it passes while the decomposition is nonsense. A
shows the shipped design catches exactly that case, and that the sum assertion
is the one that fires.

**Integration (7):**

| # | Sabotage | Result |
|---|---|---|
| I1 | `<project_context>` renamed to `<project-context>` | cases 1, 2 — the marker-liveness proof |
| I2 | the skills marker aliased to `Guidelines:`, a string the real prompt DOES contain | case 2 — `expected true to be false` |
| I3 | the planted `AGENTS.md` removed from the fixture | cases 1, 2 |
| I4 | `cacheReadRatio` forced to 0 | case 3 |
| I5 | a `toBeLessThan(5000)` on prompt size smuggled in | case 5 — `expected [ '5000' ] to deeply equal []` |
| I6 | case 5's regex replaced with one that cannot match | case 5 |
| I7 | case 3's `ratio < 1` removed, so no bound exists at all | case 5's **vacuity guard** — `expected 0 to be greater than or equal to 1` |

I2 is the one worth naming: a negative assertion (`skillsFound === false`)
passes trivially if the marker is a string that could never be found. Pointing
the marker at text the real prompt genuinely contains is what shows the
assertion is reading the prompt rather than agreeing with itself.

## Deviations from Plan

### Auto-fixed / necessary

**1. [Rule 2 — correctness] `registerBudgetCommand` takes a third parameter.**

- **Found during:** Task 1
- **Issue:** the plan's signature is `registerBudgetCommand(pi, rowsWritten)`,
  and the same plan requires the catch path to append a `diagnostics.error` row.
  An append that does not call `noteRowWritten()` makes `/budget`'s own
  rows-written figure disagree with the file it describes — and 02-03's handover
  is explicit that "a counter that only some append paths increment is worse
  than no counter: it reports a number that looks like a measurement and is
  not". Importing `noteRowWritten` from `index.ts` is not available either:
  `index.ts` imports this module, so the import back would be a cycle.
- **Fix:** `registerBudgetCommand(pi, rowsWritten, noteRowWritten)`, exactly the
  shape `registerWireHooks(pi, safeHandler, noteRowWritten)` already uses, with
  the reason at the function's docstring.
- **Commit:** `e78dbf3`

**2. [Rule 3 — blocking] `tests/unit/diagnostics-entry.test.ts`'s stub needed `registerCommand`.**

Its `pi` stub implemented only `on`. Registering a command against it throws a
`TypeError` before the eight-hook assertion is reached, so the whole file would
have failed with a crash rather than a diagnosis. The stub now records commands,
and the file asserts the list is exactly `["budget"]` — a stub that models half
the API turns a real regression into a stack trace nobody reads.

**3. [judgement call] A marker warning fires only when the section was expected.**

The plan says `warnings` carries "a message when a marker was not found". Taken
literally that warns on every session with no skills configured — and the same
plan's integration case 2 asserts `warnings` is **empty** for exactly that
fixture. The two cannot both hold. The resolution is the more honest reading: a
*divergence* is context files being loaded while the block is absent, or a
skills block recomputed with Pi's own formatter and not present in the prompt.
Both are now warned about; a genuinely empty section is not. Unit case 3 asserts
both halves.

**4. [judgement call] The integration test supplies its own `contextFiles` list.**

`getSystemPromptOptions()` is command-context only and a headless session cannot
invoke a slash command, so the integration file asserts the SLICING against the
real prompt and constructs the input list itself. The gap — that the
command-context wiring is covered by the unit registration assertion and by
manual use, not end to end — is stated in the file header rather than left to be
discovered.

### Additions beyond the letter of the plan

- **Case 1's prompt cross-check.** `ctx.getSystemPrompt()` is asserted identical
  to the `context.systemPrompt` the provider adapter received. `/budget` reports
  the former and the user pays for the latter; nothing else in the suite would
  notice them diverging, and the report would then be a precise description of
  something nobody was charged for. They are equal at 0.84.1.
- **The integration test's tool list is the real outgoing one.** `Context.tools`
  is `{name, description, parameters}[]` [VERIFIED: pi-ai
  `dist/types.d.ts:364-374`], captured from the faux response factory — so the
  tool-schema column there is computed over the bytes the provider was actually
  sent rather than a fixture.
- **Unit case 3's benign half** (`skills: []` warns about nothing) and **case 5's
  matching positive**. Each stops a "warn unconditionally" or "always diverge"
  implementation passing the assertion above it.
- **Case 5's vacuity guard.** The Pitfall 9 scan asserts it found at least one
  upper-bound assertion before filtering. Falsification I7 shows that without it
  the check would pass over a file whose regex had stopped matching.
- **Table rows are selected by their character column, never by the marker.** A
  formatter that dropped `~` still yields the row and fails, instead of silently
  selecting nothing and passing.
- **`estimateTokensFromChars(49_404) === 12_351`** pins the estimator to a live
  observation of this repository rather than an invented round number, so a later
  `chars / 3.5` tweak cannot pass unnoticed.

## Known Stubs

None. Every export is implemented and exercised.

Two paths are covered by construction rather than by a dedicated test, and both
are named here rather than left to be found:

- **The `/budget` handler's happy path is not driven end to end.** A headless
  session cannot invoke a slash command, and `getSystemPromptOptions()` exists
  only on the command context, so there is no offline way to call the handler
  with a real `ExtensionCommandContext`. What IS proven: the command is
  registered exactly once (unit), and every function it calls is proven against
  the real system prompt of the installed Pi (integration). The remaining gap is
  the ten lines of wiring between them.
- **The catch path** (`ctx.ui.notify` plus the `diagnostics.error` row) is
  unreachable without manufacturing a throwing context, which would prove the
  mock. It is defensive, it writes a row that NAMES itself
  (`where: "command.budget"`), and its shape is identical to `safeHandler`'s,
  which `tests/unit/diagnostics-entry.test.ts` does exercise.

## Threat Flags

None beyond the plan's own register.

| Threat | Where it is closed |
|---|---|
| T-02-10-01 context-file *content* in the report | paths and counts only; unit case 8 and integration case 4 both assert the planted content is absent; nothing is written to disk on the success path |
| T-02-10-02 a marker change silently mis-attributing the prompt | `contextFilesFound` / `skillsFound` / `warnings`; the `formatSkillsForPrompt` cross-check; the integration test slices the installed Pi's real prompt; falsifications B, I1, I2 |
| T-02-10-03 a token figure read as exact | characters primary; every token figure prefixed `~`; `ESTIMATE_NOTE` in the output itself; the provider-reported line separate and labelled; falsification C |
| T-02-10-04 a silently dead instrument | `ROWS_WRITTEN_LABEL` plus `ZERO_ROWS_NOTE`; unit case 7 asserts the zero case and the paired non-zero; falsification F |
| T-02-10-05 the diagnostics subsystem adding per-turn cost | `/budget` is a command; `diagnostics-entry.test.ts` asserts the command list is exactly `["budget"]`; `contributing-boundary.test.ts` keeps the zero-tool boundary green |
| T-02-10-06 a `/budget` exception vanishing | the handler body is wrapped; the catch surfaces to the UI **and** appends a `diagnostics.error` row with `where: "command.budget"`, counted through `noteRowWritten` |
| T-02-10-SC supply chain | nothing installed. A tokenizer is explicitly rejected at `estimateTokensFromChars`'s docstring, with the reason: `tests/unit/pinning.test.ts` fails the build if a dependency appears, and neither Pi package depends on one |

## Notes for the next plan

- **DIAG-06 is COMPLETE.** It is `[FAUX]`-only and every input it names is
  exercised offline. `REQUIREMENTS.md` line 36 and the traceability row are both
  flipped. It needs **no** runbook entry — unlike DIAG-01 and DIAG-05, nothing
  about it requires live credentials.
- **02-11's `docs/DIAGNOSTICS.md` should copy, not re-derive,** three paragraphs
  from `budget.ts`'s docstring: that there is no tokenizer and none may be added,
  that characters are the measurement and tokens are ±20%, and the *two*
  independent reasons `/budget` is a command (zero per-turn tokens, and
  `getSystemPromptOptions()` being command-context only).
- **The markers are a maintenance surface with an expiry date.** Pi ships every
  2–3 days. `tests/integration/budget.test.ts` case 1 is the tripwire; when it
  goes red after a Pi upgrade, the fix is to re-transcribe
  `CONTEXT_FILES_OPEN_MARKER` and friends from the new
  `dist/core/system-prompt.js.map`, not to relax the assertion.
- **The 12,351-token figure is this repository measuring itself.** Any `/budget`
  reading taken from inside `ky-pi-agent` includes its own 49 KB `CLAUDE.md`.
  That is the point for Phase 10's CTX-03, and a trap for anyone quoting the
  number as "Pi's overhead".
- **`rowsWrittenThisSession()` now has a consumer.** Every future append path in
  this subsystem must call `noteRowWritten()`, or the number `/budget` prints
  stops matching the file it describes.

## Self-Check: PASSED

All six touched files exist on disk
(`.pi/extensions/diagnostics/budget.ts`, `.pi/extensions/diagnostics/index.ts`,
`tests/unit/budget-sections.test.ts`, `tests/unit/diagnostics-entry.test.ts`,
`tests/integration/budget.test.ts`, `.planning/REQUIREMENTS.md`), and all three
task commits (`e78dbf3`, `5802f2f`, `06911c6`) are present in `git log`.
