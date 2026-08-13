---
phase: 02-diagnostics-the-instrument
plan: 03
subsystem: diagnostics
tags: [wave-2, jsonl, rotation, retention, concurrency, DIAG-07, DIAG-08]
requires:
  - "02-01 — tests/helpers/logs.ts (withTempLogCwd, logFilesIn, readJsonl, readTornSafe)"
  - "02-01 — tests/helpers/faux.ts (SECRET_FIXTURE_TOKEN)"
  - "02-02 — .pi/extensions/diagnostics/redact.ts (redactString)"
  - "02-02 — tests/unit/extension-layout.test.ts entry-point discriminator (permits sibling modules)"
provides:
  - ".pi/extensions/diagnostics/schema.ts — LOG_DIR_SEGMENT, WIRE_LOG_BASE, TURNS_LOG_BASE, WIRE_ROTATE_BYTES, TURNS_ROTATE_BYTES, MAX_ROTATED_FILES, RETENTION_DAYS, MAX_PROSE_RETRIES, PROSE_EVENT, PROSE_EXHAUSTED_EVENT, DIAGNOSTICS_ERROR_EVENT, RowKind, Outcome, OUTCOME_BY_STOP_REASON, TurnCost, TurnRow, WireKind, WireRecord"
  - ".pi/extensions/diagnostics/jsonl.ts — logDir, logPath, rotate, appendJsonl, pruneLogs, producedPaths, resetProducedPaths, AppendOptions, PruneOptions"
  - ".pi/extensions/diagnostics/index.ts — default entry point, safeHandler, rowsWrittenThisSession, noteRowWritten, SESSION_START_EVENT"
affects:
  - "02-05 (wire.ts) — appends through appendJsonl(WIRE_LOG_BASE, …) and registers on this index.ts"
  - "02-06 (turns.ts) — composes TurnRow and appends through appendJsonl(TURNS_LOG_BASE, …)"
  - "02-07 (prose.ts) — imports MAX_PROSE_RETRIES, PROSE_EVENT, PROSE_EXHAUSTED_EVENT"
  - "02-08 (/budget) — reports rowsWrittenThisSession()"
  - "every later diagnostics hook — must be wrapped in safeHandler and must call noteRowWritten()"
tech-stack:
  added: []
  patterns:
    - "open-write-close per record; the stream constructor's name is never spelled so the grep gate stays live"
    - "a computed-size record fixture, so rotation boundaries are arithmetic rather than approximation"
    - "an injected `now` for retention, never an mtime — deterministic on both platforms"
    - "a wall-clock barrier across child processes, so concurrency is deterministic and a serialised run fails loudly"
    - "two-layer path confinement: a character allowlist on `base`, plus a resolved-path containment assertion"
key-files:
  created:
    - .pi/extensions/diagnostics/schema.ts
    - .pi/extensions/diagnostics/jsonl.ts
    - .pi/extensions/diagnostics/index.ts
    - tests/unit/jsonl-rotation.test.ts
    - tests/integration/jsonl-concurrency.test.ts
    - tests/unit/logs-gitignored.test.ts
    - tests/unit/diagnostics-entry.test.ts
  modified: []
decisions:
  - "DIAG-08 is marked complete; DIAG-07 stays Pending because the requirement names redaction AT CAPTURE as well as gitignored paths, and nothing calls the redactor on a payload until wire.ts (02-05)"
  - "`createWriteStream` is NOT spelled in jsonl.ts, against the letter of the plan's action text and in favour of its own acceptance grep — blocker B3's lesson is that a substring gate matches prose, and a warning that permanently breaks the gate is worse than the warning is worth"
  - "the four concurrency children are spawned asynchronously, not with spawnSync — spawnSync blocks, so four calls in a loop are strictly serial and could not produce a single interleaved write"
  - "a wall-clock barrier plus a latest-start-precedes-earliest-finish assertion, so a serialised run fails instead of quietly passing with 1600 clean lines"
  - "tests/unit/diagnostics-entry.test.ts added beyond the plan's file list — the plan's own success criteria include the throwing-handler row and no listed file asserted it"
  - "safeHandler passes a successful handler's return value through, so a hook with a real return contract (context, before_agent_start) can be wrapped without breaking it"
metrics:
  duration: ~35m
  tasks: 3
  files: 7
  completed: 2026-08-13
---

# Phase 2 Plan 03: The Log Substrate Summary

An append-only JSONL writer with size-based rotation, dated retention and
two-layer path confinement; the shared schema every later plan asserts against;
and a diagnostics entry point whose handlers write a `diagnostics.error` row
instead of disappearing into Pi's `emitError`.

## What was built

### Task 1 — `schema.ts` + `jsonl.ts` (commit `3dfdfff`)

`schema.ts` holds every literal a test asserts on, each with a docstring saying
why it is exported and each numeric threshold carrying its arithmetic from
RESEARCH §10.5. `OUTCOME_BY_STOP_REASON` is typed `Record<StopReason, Outcome>`
against pi-ai's own union, so a new member of that union is a compile error here
rather than an `undefined` in a log file. `TurnRow.reasoning` is declared
`reasoning?: number` with the Bedrock provenance inline — the key is omitted
when the provider reports nothing, never `0` and never `null`.

`WireRecord` is a three-way union rather than three optional fields, so a record
carrying both a `payload` and a `status` does not typecheck.

`jsonl.ts` is the writer:

| Export | Behaviour |
|---|---|
| `logDir(cwd)` | `join(cwd, CONFIG_DIR_NAME, LOG_DIR_SEGMENT)` — Pi's exported constant, never a literal `.pi` |
| `logPath(cwd, base, now?)` | `<logDir>/<base>-YYYY-MM-DD.jsonl`, zero-padded local date |
| `rotate(file, maxRotated)` | shifts `.<n>.jsonl` highest-first, unlinks at/above the cap, renames the live file to `.1` |
| `appendJsonl(cwd, base, record, opts?)` | mkdir, cached size check, rotate if this record would cross the cap, `appendFileSync`, record the path, return it |
| `pruneLogs(cwd, opts?)` | deletes past the date window and past the rotated cap, returns the sorted deleted paths, swallows every unlink error |
| `producedPaths()` / `resetProducedPaths()` | the module-level set DIAG-07's gitignore test reads |

Two things are load-bearing and easy to lose in a later edit, so both are stated
in the module docstring: open-write-close per record (a held descriptor keeps
writing into the file that was renamed away), and the deliberate non-use of
`withFileMutationQueue`, whose state is a module-level `Map` in one process and
therefore serialises nothing across subagent processes.

Path confinement is two layers, on purpose. `BASE_RE` is a strict character
allowlist that makes `..`, a separator and a drive letter impossible before
`join` ever sees the value; `assertInsideLogDir` re-checks the resolved path.
The falsification run below shows both are live and that they catch different
inputs.

### Task 2 — rotation, retention and concurrency proofs (commit `11aeedf`)

`tests/unit/jsonl-rotation.test.ts` (14 tests) runs against a real filesystem
inside `withTempLogCwd`. Record size is **computed**, not guessed: `makeRecord`
pads every record to exactly 500 serialised bytes including its newline, so with
a 4000-byte cap the boundaries are arithmetic and a renamed field cannot make
every assertion off-by-one.

The rotation assertion is record-for-record, not file-existence: the union of
`.2`, `.1` and the live file, read oldest-first, must `toEqual` the exact array
of 20 records that was appended. The cap case runs 50 records at
`maxRotated: 3`, asserts exactly four files survive, asserts a marker planted in
record 1 is **gone**, and pairs that with an assertion that record 50 is still
present — without the pair, "everything was deleted" would also pass.

Retention plants files stamped 1, 13, 15 and 40 days before an injected `now`
and asserts both directions: the returned deleted list is exactly the two past
the window, and the two survivors are still on disk.

`tests/integration/jsonl-concurrency.test.ts` spawns four real child processes
on a generated `.mjs` and asserts 1600 lines, zero unparseable, and per-label
counts of exactly 400. Two deliberate departures from the plan's letter are
described under Deviations.

### Task 3 — the entry point and the gitignored-path proof (commit `bae6f39`)

`.pi/extensions/diagnostics/index.ts` registers one hook today —
`session_start`, wrapped in `safeHandler`, calling `pruneLogs(ctx.cwd)` and
writing one `diagnostics.session_start` row carrying the pruned-file count.
Later plans in this phase add the wire, turn, prose and budget registrations to
the same function.

`safeHandler(where, fn)` returns a wrapper whose catch path appends a
`DIAGNOSTICS_ERROR_EVENT` row with the handler name in `where` and
`String(err)` passed through `redactString`, and then returns `undefined`. It
never rethrows — that would hand the exception straight back to the swallowing
path it exists to escape — and it never invents a return value, because several
Pi hooks treat any non-`undefined` return as a replacement for the thing being
hooked. The success path's return value is passed through untouched, which is
what lets a hook with a real return contract be wrapped later.

`rowsWrittenThisSession()` and `noteRowWritten()` make "0 rows" a number
`/budget` can print rather than something a reader has to infer from a file they
never opened.

`tests/unit/logs-gitignored.test.ts` has the two halves the plan specified: a
six-entry literal policy table with a magnitude guard, and a reality check that
resets the produced-path set, runs the real writer, forces a rotation, and asks
`git check-ignore -q --no-index` about every path `producedPaths()` reports —
guarded by a non-empty assertion **and** by an assertion that a rotated
`.<n>.jsonl` name was actually produced, since without that the reality check
only re-covers names the table already lists. `isIgnored("README.md") === false`
proves the oracle is live.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit 0 |
| `npm test` (full suite) | 20 files, **321 tests passed** (was 293 after 02-02) |
| `npx vitest run tests/unit/jsonl-rotation.test.ts tests/integration/jsonl-concurrency.test.ts` | exit 0, 15 tests, 1.5 s wall clock (budget: 90 s) |
| `npx vitest run tests/unit/logs-gitignored.test.ts tests/unit/extension-layout.test.ts tests/unit/contributing-boundary.test.ts` | exit 0, 24 tests |
| `tests/integration/load-paths.test.ts` with the diagnostics extension present | passes (part of the full suite) |
| `grep -c createWriteStream .pi/extensions/diagnostics/jsonl.ts` | 0 |
| `grep -c registerTool` over all three new sources | 0 each |
| `grep -c '".pi"' .pi/extensions/diagnostics/jsonl.ts` | 0; `CONFIG_DIR_NAME` present |
| `grep -n "export default function" .pi/extensions/diagnostics/index.ts` | matches (line 144) |
| `git status --porcelain` after the full suite | clean; no `.pi/logs/` on disk at all |
| CR bytes in all seven new files | 0 |

### Falsification checks — executed, not assumed

Every new assertion was made to fail for the right reason and the source
restored byte-for-byte afterwards (`cmp`/`git diff` verified empty each time).

**1. Rotation that deletes instead of renaming.** Replaced `rotate(...)` with
`unlinkQuietly(file)`:

```
× keeps every appended record, in order, across two rotations
  → expected one live file plus two rotated ones … expected 1 to be 3
× keeps one live plus maxRotated files and drops the oldest content
```

**2. Rotation that happens but silently drops one record.** Added an early
`return` after the rotate, so file counts stayed correct and two records
vanished. This is the case a file-existence assertion misses entirely:

```
× keeps every appended record, in order, across two rotations
  → expected [ …17 ] to deeply equal [ …19 ]
× never lets the live file exceed the cap
```

**3. Retention arithmetic and base validation, together.** Widened the window to
`retentionDays * 2` and loosened `BASE_RE` to `/^.+$/`:

```
× keeps files inside the window and deletes the ones past it
× refuses the base ".."      × refuses the base ".hidden"    × refuses the base "C:evil"
```

Note which cases did **not** fail: `"../evil"`, `"wire/../../evil"`,
`"sub/wire"`, `"a\b"` and `""` were still refused, by `assertInsideLogDir`. That
is the two-layer defence working — each layer catches inputs the other does not,
and neither is decorative.

**4. Serialised children (the concurrency test's whole point).** Ran the four
children strictly one after another with the barrier disabled:

```
× produces every line, all parseable, with per-label counts intact
  → the four children must have overlapped in time … expected …874 to be less than …715
```

The 1600 lines were still all present and all parseable. That is precisely the
vacuous pass the overlap assertion exists to prevent, and it is why `spawnSync`
was rejected.

**5. Produced-path gitignore loop.** Repointed the writer at
`.pi/diagdump/*.txt`, which no rule ignores (and temporarily widened the
rotated-suffix regex so the loop was reached at all):

```
× the writer produced .pi/diagdump/turns-2026-08-13.1.txt and git says it is committable
```

The first attempt at this falsification failed on the rotated-suffix guard
instead — which is itself evidence that guard is live rather than decorative.

**6. `safeHandler`, both halves.** Removing `redactString` from the error path:

```
× redacts a credential quoted by the exception message
```

Removing the `try` around the handler call:

```
× writes a diagnostics.error row naming the handler, and does not rethrow
× redacts a credential quoted by the exception message
  Error: deliberate failure inside a diagnostics handler
```

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 1 — bug in the plan's own acceptance set] `createWriteStream` is not spelled in `jsonl.ts`.**

- **Found during:** Task 1
- **Issue:** The action text requires the module docstring to state
  "**`appendFileSync` only, never `createWriteStream`**". The acceptance
  criterion immediately below requires
  `grep -c "createWriteStream" .pi/extensions/diagnostics/jsonl.ts` to return 0.
  These cannot both hold. This is blocker **B3** again — a substring gate
  matches prose — and the repo has now hit it three times.
- **Fix:** The rule is stated in full, in words, without the API name, exactly
  the dodge `harness/index.ts:36` uses for the tool-registration call. The
  docstring says explicitly that the name is withheld *on purpose* and why, so
  nobody "helpfully" adds it back. The grep stays a live mechanical proof that
  no stream is constructed in the file.
- **Files modified:** `.pi/extensions/diagnostics/jsonl.ts`
- **Commit:** `3dfdfff`

**2. [Rule 1 — bug] The concurrency children are spawned asynchronously, not with `spawnSync`.**

- **Found during:** Task 2
- **Issue:** The plan says "Spawn four children with `spawnSync(...)`".
  `spawnSync` blocks until the child exits, so four calls in a loop run four
  processes strictly one after another. A serialised run cannot produce a single
  interleaved write, and the test would report 1600 clean lines having proven
  nothing whatsoever about concurrency — which is the entire claim of DIAG-08
  and of RESEARCH §10.3.
- **Fix:** `spawn` with `stdio` pipes, wrapped in a promise, four launched and
  awaited together. Every other flag the plan named is kept: `windowsHide`, an
  explicit `timeout`, `shell: false` (justified — `process.execPath` is an
  executable, not a `.cmd` shim), and an encoding set on the pipes.
- **Commit:** `11aeedf`

**3. [Rule 2 — correctness] A wall-clock barrier and an overlap assertion were added.**

- **Found during:** Task 2
- **Issue:** Even asynchronously, four children could in principle run back to
  back on a loaded machine and still pass. An overlap that is hoped for is not
  an overlap that is tested.
- **Fix:** The parent computes one start instant and passes it to every child;
  each child sleeps until then before its first write; the test asserts the
  latest start precedes the earliest finish. Falsification 4 above shows it
  fails when the children are serialised.
- **Commit:** `11aeedf`

**4. [Rule 2 — correctness] `tests/unit/diagnostics-entry.test.ts` added beyond the plan's file list.**

- **Found during:** Task 3
- **Issue:** The plan's `must_haves.truths` and `<success_criteria>` both include
  "a throwing diagnostics handler leaves a `diagnostics.error` row instead of
  vanishing", and none of the three files the plan lists asserts it. Shipping
  `safeHandler` unasserted would be exactly the green tick that does not exist
  which the standing operating policy forbids.
- **Fix:** Four unit tests against recording stubs of `ExtensionAPI` and
  `ExtensionContext` — no session, no network, milliseconds. They cover the
  error row, its redaction, the success-value passthrough, and the entry point's
  single `session_start` registration writing its heartbeat row. The file's
  header states why it exists and that the in-session half belongs to plan
  02-05.
- **Commit:** `bae6f39`

**5. [judgement call] `safeHandler` is generic over its return value.**

The plan describes a wrapper that "must return `undefined` from the catch path".
It does. It also returns the *success* path's value untouched, because
`context`, `before_agent_start` and `message_end` all have real return contracts
and a wrapper that swallowed their results would break them the first time one
is wrapped. Documented in the function's docstring.

**6. [judgement call] `pruneLogs` applies the rotated cap per dated stem, not per base name.**

`wire-2026-08-12.*` and `wire-2026-08-13.*` are bounded independently. That
matches what `rotate` already manages and matches RESEARCH §10.5's arithmetic
("10 × 32 MB bounds a bad day"), which is a per-day figure.

**7. [judgement call, logged rather than actioned] DIAG-07 is NOT marked complete; DIAG-08 is.**

DIAG-08 reads "Diagnostic logs rotate rather than growing unbounded" and is now
fully delivered and proven, so it is checked off. DIAG-07 reads "redacted at
capture time **and** written only to gitignored paths". This plan closes the
second half and 02-02 shipped the redactor, but nothing calls the redactor on a
captured payload until `wire.ts` lands in 02-05. Same call, same reasoning, as
02-01 and 02-02.

### Additions beyond the letter of the plan

- `logPath` and `pruneLogs` both refuse to follow anything that is not a regular
  file, and `pruneLogs` returns `[]` rather than throwing when the log directory
  has never existed (asserted).
- The rotation test's cap case pairs "the oldest marker is gone" with "the
  newest record survives". Without the pair, deleting everything would pass.
- The gitignore reality check asserts a rotated `.<n>.jsonl` path was genuinely
  produced, not merely that the produced list is non-empty.
- The concurrency test asserts the sampled record is over 900 bytes, so a future
  edit to `PAD_LENGTH` cannot silently shrink the records until the test stops
  exercising the size RESEARCH measured.
- `noteRowWritten()` is exported so the sibling modules added in 02-05 to 02-08
  increment the same counter. A counter only some append paths increment reports
  a number that looks like a measurement and is not.

## Known Stubs

None. Every export is implemented and exercised. `index.ts` registers one hook
rather than five, but that is the plan's stated scope — the four remaining
registrations are the deliverables of 02-05 through 02-08, and the file's
`LIFETIME` docstring names each.

## Threat Flags

None beyond the plan's own register, all eight of which are mitigated in code
and named at the mitigation site:

| Threat | Where it is closed |
|---|---|
| T-02-03-01 information disclosure | `logDir` built from `cwd` + `CONFIG_DIR_NAME` + `LOG_DIR_SEGMENT`; `tests/unit/logs-gitignored.test.ts` both halves |
| T-02-03-02 symlink escape | `lstatSync` regular-file checks in `rotate`, `pruneLogs` and `regularFileSize` |
| T-02-03-03 unbounded growth | size caps, `MAX_ROTATED_FILES`, `RETENTION_DAYS`, pruned at `session_start`; `jsonl-rotation.test.ts` |
| T-02-03-04 torn records | `appendFileSync` open-write-close; `jsonl-concurrency.test.ts` with a real overlap proof |
| T-02-03-05 a silently dead instrument | `safeHandler` + `rowsWrittenThisSession`; `diagnostics-entry.test.ts` |
| T-02-03-06 a secret in an error row | `redactString(String(err))`; falsification 6 |
| T-02-03-07 model-supplied path | `BASE_RE` + `assertInsideLogDir`, both proven live and proven to catch different inputs |
| T-02-03-SC supply chain | no package installed; `tests/unit/pinning.test.ts` still green |

## Notes for the next plan

- **Wrap every new hook in `safeHandler` and call `noteRowWritten()` from every
  append path.** An unwrapped handler that throws vanishes; an append that does
  not count makes `/budget` lie.
- **`appendJsonl` defaults the cap by base name**, so `appendJsonl(cwd,
  WIRE_LOG_BASE, …)` gets 32 MB and `TURNS_LOG_BASE` gets 8 MB with no options
  object.
- **Never build a `base` from anything but a `schema.ts` constant.** The
  allowlist will throw, which is the point, but it will throw at runtime inside
  a swallowed handler.
- **`producedPaths()` accumulates for the process lifetime.** Any test that
  reads it must call `resetProducedPaths()` first, or it will assert over paths
  another test produced.
- **`rotate` records its destination path**, so a rotated name appears in
  `producedPaths()` — that is what lets the DIAG-07 reality check cover names no
  human typed.
- **The concurrency evidence is win32-only.** RESEARCH §10.3's caveats are
  restated verbatim in substance in the test's header; the macOS leg belongs to
  CI's `macos-latest` job, which is BOOT-07 and still OUTSTANDING. Do not
  upgrade that to "proven cross-platform" anywhere.

## Self-Check: PASSED

All seven files exist on disk and all three task commits (`3dfdfff`, `11aeedf`,
`bae6f39`) are present in `git log`.
