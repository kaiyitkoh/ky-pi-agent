---
phase: 04-safety-deployment-guardrails
plan: 11
subsystem: safety
tags: [evasion-corpus, docs, published-limits-table, mistake-catcher, honesty-gate]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: "evaluate()/PolicyFacts from policy.ts (Plan 07), the wired hook/wrapped-tool composition from index.ts (Plan 08), and shell.ts/paths.ts/git.ts/infra.ts's own classifier contracts (Plans 03-06) -- everything this plan drives real inputs through"
provides:
  - "tests/fixtures/evasion-corpus.ts: EVASION_CORPUS, 43 evasion attempts (34 BLOCKED, 9 OUT-OF-SCOPE), covering all 14 PITFALLS.md bypass classes plus custom-tool/sensitive-read/infra/false-positive-risk, every expect value assigned by actually executing evaluate() and reading the real Verdict.kind"
  - "tests/unit/evasion-corpus.test.ts: Group A drives every BLOCKED row through the real evaluate(); Group B derives docs/SAFETY.md's published table from the corpus (both directions); Group C proves corpus liveness"
  - "docs/SAFETY.md: the SAFE-15 published limits table -- honest ceiling statement (mistake-catcher, no Windows sandbox, GitLab server-side protection as the only non-theatre control), what the guard catches, the 9-row 'Known bypasses' table, load-order residual risks (T-04-08) with source citations, and the code-is-authoritative stance"
  - "a real defect fix in .pi/extensions/safety/shell.ts: 'eval' added to SHELL_RUNNERS, closing the literal eval\"git push\" bypass found while authoring this corpus"
affects: [04-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "corpus-derives-doc, never doc-transcribes-corpus: docs/SAFETY.md's published table's row count and row identities are asserted, at test time, to equal EVASION_CORPUS.filter(c => c.expect === \"OUT-OF-SCOPE\").length and its id set -- following docs-policy.test.ts's truncationCauseCount() discipline -- with the converse asserted too, so the doc cannot grow a limit the corpus does not know about"
    - "bucket assigned by execution, never predicted: every row's expect value in evasion-corpus.ts was set only after actually calling evaluate() with that exact tool/input and reading the real Verdict.kind, documented in the fixture's own module docstring so the process is auditable, not merely claimed"
    - "table-row-id extraction anchored to line start (^\\|\\s*(EV-\\d+)\\s*\\|), not a bare EV-\\d+ regex, so a row's own prose cross-referencing a DIFFERENT row's id (EV-27's explanation mentions EV-28 and EV-30) is not mistaken for that row having its own table entry"

key-files:
  created:
    - tests/fixtures/evasion-corpus.ts
    - tests/unit/evasion-corpus.test.ts
    - docs/SAFETY.md
  modified:
    - .pi/extensions/safety/shell.ts
    - tests/unit/shell-parse.test.ts

key-decisions:
  - "EV-08 (eval \"git push\", literal guarded verb) was a genuine defect, not a limit -- fixed by adding \"eval\" to shell.ts's SHELL_RUNNERS, because eval executes its argument as shell code in the current shell, the identical shape sh -c \"...\" already catches. A regression row was added to tests/unit/shell-parse.test.ts's existing SHELL_RUNNER_TABLE rather than only to the new corpus, so the fix has its own dedicated, pre-existing test suite's protection."
  - "EV-09 (CMD=\"git push\"; eval \"$CMD\", variable-indirection through eval) remains OUT-OF-SCOPE even after the EV-08 fix -- the guarded-verb text lives in a variable assigned by a separate, earlier command node, never in eval's own raw source segment, so no substring check over that segment can see it. Closing this needs arbitrary shell-variable resolution at parse time, which 04-RESEARCH.md's Anti-Patterns section explicitly names as effort this phase does not need to spend. Published, not silently narrowed."
  - "EV-27's bash-argument Windows-path mangling was NOT fixed -- it is the exact, already-documented KNOWN LIMITATION named in policy.ts's own module docstring before this plan started (Word.value strips unquoted backslashes as POSIX escapes). Confirmed still real by direct execution, published as EV-27, and proven confined to the bash-argument surface specifically by two contrast rows that both block correctly: EV-28 (the same path, quoted) and EV-30 (the same path, via the read tool directly, which has no separate raw/resolved form for Word.value to mangle)."
  - "encoding (EV-41, base64 | sh) was checked for the plan's own stated 'does the shell-runner rule catch it incidentally' question, by execution rather than assumption -- it does NOT, because the final pipeline segment's own raw text is bare `sh` with no arguments, so GUARDED_VERB_PATTERN never sees `git`, which exists only inside the decoded payload at runtime. Published as a clean OUT-OF-SCOPE row rather than tagged BLOCKED with a misleading 'incidental catch' note."
  - "the corpus's tool field is typed as a plain string, not a bash|read|write|edit union, specifically so EV-42 (custom_extension_tool) can express the ONE case evaluate() allows by design: a fifth tool name it does not recognise at all."

requirements-completed: [SAFE-15, SAFE-17]

# Metrics
duration: 65min
completed: 2026-08-14
---

# Phase 4 Plan 11: Evasion Corpus and the Published Limits Table Summary

**43 evasion attempts driven through the real `evaluate()` pipeline (34 BLOCKED, 9 explicitly published as OUT-OF-SCOPE in `docs/SAFETY.md`), with every bucket assignment made by actually executing the guard rather than predicted -- catching and fixing one genuine defect (`eval` missing from `shell.ts`'s `SHELL_RUNNERS`) along the way, and publishing the honest residual gaps (variable-indirection-through-`eval`, unquoted-Windows-path-in-bash, and three classes of client/tool the guard was never built to see) rather than hiding them.**

## Performance

- **Duration:** ~65 min
- **Started:** 2026-08-14T06:35:00Z (approx, from first file read)
- **Completed:** 2026-08-14T06:55:00Z
- **Tasks:** 2 completed
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- **Total evasion attempts: 43.** **Blocked: 34** (verdict `block` or `confirm`, i.e. non-`allow`, driven through the real `evaluate()` and asserted in `tests/unit/evasion-corpus.test.ts` Group A). **Not caught (published as limits): 9** (`EV-09`, `EV-27`, `EV-35`, `EV-36`, `EV-38`, `EV-39`, `EV-40`, `EV-41`, `EV-42`), every one of them a row in `docs/SAFETY.md`'s "Known bypasses this guard does not catch" table.
- All 14 `PITFALLS.md:455-468` bypass classes are represented by at least one corpus row (variable indirection, command substitution, nested shell at three depths, heredoc-to-script in two forms, different repo in both POSIX and Windows spellings, env wrapper in three forms, task-runner indirection, encoding, backgrounding in two forms, quoting/whitespace in three forms, shell function/alias, PATH shadowing, different client, and the non-bash write/edit surface) — plus four classes beyond the 14 the plan's own action text names explicitly: custom extension-registered tool, sensitive-read path forms, the terraform/aws/kubectl infra confirm gate, and the Assumption A3 false-positive-risk case.
- **Every single verdict in the corpus was observed by execution before being written down**, using three scratch probe files (deleted before commit) run against the real `evaluate()`. This surfaced one authoring mistake along the way: an initial probe used a bash heredoc (`cat > file <<'EOF'`) to write test fixtures, which silently collapsed `\\` to `\` in the written source, producing a misleading "allow" for the `read`-tool Windows-path case (EV-30) that was NOT real — re-verified with `String.raw` literals written via the `Write` tool (no shell heredoc), which showed the true, correct `block` verdict. The false signal was caught before it reached the corpus, not after.
- **Found and fixed a real defect (EV-08):** `eval "git push"` came back `allow`, because `"eval"` was missing from `shell.ts`'s `SHELL_RUNNERS` set — `eval` executes its argument as shell code in the current shell, the identical "hides a guarded verb inside a quoted argument" shape `sh -c "..."` already catches. Fixed by adding `"eval"` to `SHELL_RUNNERS` (one line, with a docstring explaining the discovery and the residual gap it does NOT close), and added a regression row (`"eval with a literal guarded verb (Plan 11 regression -- EV-08)"`) to `tests/unit/shell-parse.test.ts`'s existing, pre-Plan-11 `SHELL_RUNNER_TABLE` — not only to the new corpus — so this fix has its own dedicated test suite's protection going forward, not only the corpus's.
- **Found and published a real, deeper limit (EV-09):** even after the EV-08 fix, `CMD="git push"; eval "$CMD"` still returns `allow`, because the guarded-verb text lives in a *different* command node (the assignment) than `eval`'s own raw segment, which contains no literal `git` text at all. This is a structural boundary — closing it needs arbitrary shell-variable resolution, which `04-RESEARCH.md`'s Anti-Patterns section explicitly rules out of scope for this phase — published honestly rather than silently narrowed or misrepresented as fixed.
- Confirmed by direct execution, not assumption, that the base64-encoding bypass (`echo Z2l0IHB1c2g= | base64 -d | sh`) is **not** caught even incidentally by the shell-runner rule — the plan explicitly asked this question to be checked rather than guessed, and the answer is a clean miss (the final pipeline segment's raw text is bare `sh`, no `git` substring anywhere in the parsed tree).
- Confirmed the EV-27 Windows-path-in-bash gap is real and precisely scoped: the SAME path (i) mangles and allows when unquoted in bash, (ii) blocks correctly when quoted in bash, and (iii) blocks correctly when passed directly to the `read` tool (no bash involved at all) — three contrasting rows (EV-27/28/30) that pin the gap to exactly one surface, not overclaimed as broader or narrower than it is.
- `docs/SAFETY.md` states the honest ceiling in its opening paragraphs (mistake-catcher not a security boundary, no OS-level sandbox on Windows, GitLab server-side protected branches as the only non-theatre control), lists what the guard does catch keyed to the BLOCKED classes, publishes the 9-row "Known bypasses" table with an ID/Class/Example/Why-not-caught/What-does-catch-it column shape, names the tool-name-collision (`T-04-08`) and `event.input`-mutation residual risks with exact `dist/core/extensions/{runner.js:280-291,types.d.ts:687-688}` citations (verified against the installed package, matching `.pi/extensions/safety/index.ts`'s own docstring citations exactly), and closes with the same code-is-authoritative stance `docs/DIAGNOSTICS.md` states for the redaction contract.
- `tests/unit/evasion-corpus.test.ts` Group B slices the doc by heading markers, asserts the slice is non-vacuous BEFORE any content assertion, derives the expected OUT-OF-SCOPE row count and identities FROM `EVASION_CORPUS` (never a hand-typed literal, following `docs-policy.test.ts`'s `truncationCauseCount()` discipline), and asserts the converse too (the doc holds no `EV-` id the corpus does not tag OUT-OF-SCOPE) — using a line-start-anchored regex specifically so a row's own prose cross-referencing a sibling row's id (EV-27 mentions EV-28 and EV-30 in its explanation) is not mistaken for that sibling having its own table row.

## Task Commits

1. **Task 1: the corpus as data, plus the eval defect fix found while authoring it** - `6f50035` (feat)
2. **Task 2: drive the corpus through evaluate() and publish docs/SAFETY.md** - `ffee390` (test)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `tests/fixtures/evasion-corpus.ts` (new, ~330 lines) — `EvasionCase`, `EvasionExpectation`, `EVASION_CORPUS` (43 rows)
- `tests/unit/evasion-corpus.test.ts` (new, 50 tests) — Groups A/B/C described above
- `docs/SAFETY.md` (new) — the SAFE-15 published limits table and honest-ceiling statement
- `.pi/extensions/safety/shell.ts` (modified) — `"eval"` added to `SHELL_RUNNERS`, with a docstring explaining the discovery and the residual EV-09 gap it does not close
- `tests/unit/shell-parse.test.ts` (modified) — one regression row added to the pre-existing `SHELL_RUNNER_TABLE`

## Decisions Made

See `key-decisions` in frontmatter. In summary: EV-08 was a defect and got fixed (with its own regression test in the pre-existing shell-parse suite, not only the new corpus); EV-09, EV-27, EV-35, EV-36, EV-38, EV-39, EV-40, EV-41, EV-42 are genuine limits and got published; the encoding case was checked by execution for the plan's own stated "does the shell-runner rule catch it incidentally" question rather than assumed either way; the corpus's `tool` field is a plain string (not a strict union) so the one unknown-tool-name row (EV-42) is expressible.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added "eval" to shell.ts's SHELL_RUNNERS**
- **Found during:** Task 1, while executing candidate corpus rows against the real `evaluate()` to determine their buckets (the plan's own mandatory discipline: assign the bucket only after observing the real verdict)
- **Issue:** `eval "git push"` — a literal guarded verb passed as `eval`'s own argument, structurally identical to `sh -c "git push"` — returned `allow`, because `"eval"` was absent from `SHELL_RUNNERS`, so the shell-runner denial rule never considered it even though the guarded-verb text was literally present in its raw segment.
- **Fix:** Added `"eval"` to `SHELL_RUNNERS` in `.pi/extensions/safety/shell.ts`, with an inline comment explaining the discovery, citing `EV-08`, and explicitly noting the fix does NOT close the deeper variable-indirection form (`EV-09`).
- **Files modified:** `.pi/extensions/safety/shell.ts`, `tests/unit/shell-parse.test.ts` (regression row added to the existing `SHELL_RUNNER_TABLE`)
- **Verification:** Re-executed `eval "git push"` against the real `evaluate()` after the fix — now `block`, cause `shell-runner`. Full suite re-run (`tests/unit/shell-parse.test.ts`, `tests/unit/shell-deny-list.test.ts`, `tests/unit/policy-compose.test.ts`, `tests/unit/safety-entry.test.ts`, `tests/integration/double-enforcement.test.ts`) confirmed no regressions (96/96 green) before proceeding.
- **Committed in:** `6f50035` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 real defect found and fixed during corpus authoring, per the plan's own explicit instruction: "If a case that ought to be BLOCKED comes back allowed, that is a defect... to fix in this plan"). No scope creep — the fix is one Set entry plus its own regression row in a pre-existing test file; the rest of the plan's published limits (EV-09, EV-27, EV-35, EV-36, EV-38, EV-39, EV-40, EV-41, EV-42) were genuinely out of scope and were published, not fixed.

## Issues Encountered

One self-caught authoring artifact, never reaching the corpus: an early scratch probe file was created via a bash heredoc (`cat > file <<'EOF' ... EOF`), which silently collapsed every `\\` in the TypeScript source to a single `\`, corrupting a Windows-path string literal before it ever reached `canonicalisePathArg`. The resulting "allow" for the `read`-tool Windows-path case looked like a real bug in `paths.ts` at first. Re-derived using `String.raw` template literals written through the `Write` tool (never a bash heredoc) confirmed the true, correct `block` verdict, and the corpus (`EV-30`) reflects the re-verified result. Not a deviation from the plan — a test-authoring mistake caught by re-execution before it could produce a false "limitation" in the published table.

## User Setup Required

None — no external service configuration required. This plan adds no new dependency.

## Next Phase Readiness

- Plan 12 (whatever composes the phase's final documentation/verification pass) can rely on `docs/SAFETY.md` existing with the exact heading shape `tests/unit/evasion-corpus.test.ts` Group B already pins (`## Known bypasses this guard does not catch`, `## Load order is part of this`, `## Authority`), and on `tests/fixtures/evasion-corpus.ts` as the single source of truth for both the corpus count and the published table's contents.
- `.pi/extensions/safety/shell.ts`'s known, still-open limitation (EV-09: variable-indirection through `eval`) is documented in three places now — the module's own inline comment on `SHELL_RUNNERS`, the corpus row's `why`, and `docs/SAFETY.md`'s published table — so a future phase closing it (by threading resolved variable values through `shell.ts`, which is explicitly out of this phase's scope) has a clear, triply-cited starting point.
- No blockers. `npx vitest run tests/unit tests/integration` is 1073/1073 green (up from 1022 at the end of Plan 09, +1 regression row this plan added to `tests/unit/shell-parse.test.ts`, +50 new in `tests/unit/evasion-corpus.test.ts` -- Plan 10 has no SUMMARY.md on disk yet, so 1022 is the last confirmed baseline), `tsc --noEmit` clean.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: tests/fixtures/evasion-corpus.ts
- FOUND: tests/unit/evasion-corpus.test.ts
- FOUND: docs/SAFETY.md
- FOUND: .pi/extensions/safety/shell.ts (modified)
- FOUND: tests/unit/shell-parse.test.ts (modified)
- FOUND: commit 6f50035 (Task 1)
- FOUND: commit ffee390 (Task 2)

## Self-Check: PASSED (re-verified)

- FOUND: tests/fixtures/evasion-corpus.ts
- FOUND: tests/unit/evasion-corpus.test.ts
- FOUND: docs/SAFETY.md
- FOUND: .pi/extensions/safety/shell.ts (modified)
- FOUND: tests/unit/shell-parse.test.ts (modified)
- FOUND: commit 6f50035 (Task 1)
- FOUND: commit ffee390 (Task 2)
