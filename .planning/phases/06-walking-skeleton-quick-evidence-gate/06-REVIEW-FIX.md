---
phase: 06-walking-skeleton-quick-evidence-gate
fixed_at: 2026-08-15T01:47:00Z
review_path: .planning/phases/06-walking-skeleton-quick-evidence-gate/06-REVIEW.md
iteration: 4
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-08-15T01:47:00Z
**Source review:** .planning/phases/06-walking-skeleton-quick-evidence-gate/06-REVIEW.md (iteration 4 — final)
**Iteration:** 4 -- **this is the last change to this phase; nothing follows this one.**

**Summary:**
- Findings in scope: 1 (CR-01 only, per this pass's explicit fix scope; WR-01
  is accepted as a documented residual risk and was deliberately left alone)
- Fixed: 1
- Skipped: 0

Iteration 4's reviewer re-verified all three iteration-3 findings genuinely
closed, then obtained a false ACCEPT from the real `/quick`: `gateCompletion`
rejects when `headSha === baseSha` ("no commit landed"), but its ACCEPT path
silently inverted that into "HEAD moved ⟹ a commit landed" -- false, because
`checkout`, `reset` and `revert` all move HEAD without committing anything,
and `reset --hard` can delete a commit outright. The reviewer's own W1
(`git checkout --detach HEAD~1`, zero commits made) and W2 (`git reset --hard
HEAD~1`, a commit destroyed) both got `"quick: a commit landed at <sha>..."`.
This pass replaced that claim with what the evidence actually establishes:
HEAD moved, and no captured tool outcome failed -- never that a commit
landed.

## Fixed Issues

### CR-01: ACCEPT asserted "a commit landed at &lt;sha&gt;" from evidence that only shows HEAD is a different string

**Files modified:** `.pi/extensions/workflows/index.ts`, `.pi/extensions/workflows/evidence.ts`, `docs/WORKFLOWS.md`, `tests/integration/quick-workflow.test.ts`
**Commit:** `fd1a49a`
**Applied fix:** exactly the reviewer's prescribed, zero-net-line fix, applied
in the three places the claim was made, plus the doc:

1. `index.ts`'s `agent_end` notify text: `` `quick: a commit landed at ${verdict.sha}...` `` →
   `` `quick: HEAD moved to ${verdict.sha} with no failed tool result -- no commit was verified and the work itself is NOT verified` ``.
2. `evidence.ts`'s `endRun()` JSONL `reason` field: `` `a commit landed at ${headSha}...` `` →
   `` `HEAD moved to ${headSha} with no failed tool result recorded during this run -- whether a commit was created, and whether it contains the work, are both unverified` ``.
3. `gateCompletion`'s own docstring, branch (2): reworded away from the
   "no commit landed" framing (which primed the false converse on the accept
   side) to "HEAD is still what it was when the run was armed" -- purely
   about HEAD, never about commits.
4. `docs/WORKFLOWS.md`'s accept-guarantee paragraph (§4): struck "a commit
   landed during the run, made through a tool call..." and replaced it with
   "HEAD is a different commit than when the run was armed", plus an
   explicit sentence naming `checkout`, `reset` and `revert` as moves that
   satisfy this without creating anything, and naming this pass's own W1/W2
   probes as the proof.

The rejection logic itself is untouched -- this is a wording fix, not a
detection fix. `gateCompletion` still keys purely on structured, Pi-computed
data (`isError`) plus a real git SHA comparison, never on transcript text.
Per hard constraint 6 in the task's own framing, narrowing the claim (not
tightening the predicate) is the correct Phase 6 outcome; verifying that a
commit actually landed is explicitly deferred to Phase 8 (needs a diff or
tree hash, which this predicate does not have and is not meant to have).

**Line cost: zero, as prescribed.** `index.ts` stays at **79/80** raw lines
(unchanged from before this pass -- not a knob, per hard constraint 2).
`evidence.ts` stays at **336/340** (unchanged; its budget was NOT raised a
fourth time -- a wording fix needed no room, exactly as flagged).

**Regression test added:** case 9 (PROBE W1) in `quick-workflow.test.ts` --
seeds two real commits, scripts `bash 'git checkout --detach HEAD~1'` (a
real, successful tool call that moves HEAD and creates no commit) followed
by a false completion claim in prose, then asserts (a) the gate still
ACCEPTs (this pass does not tighten detection), (b) no NEW commit object
was created anywhere in the repository (`git rev-list --count --all`
unchanged), and (c) neither the evidence row's `reason` nor `/quick`'s own
notification text contains the string `"a commit landed"` -- both must say
`"HEAD moved"` instead.

**Mutation test (RED then GREEN, executed, real output pasted below).**
Reverted only the two source files (`index.ts`, `evidence.ts`) via
`git stash push` on those two paths, keeping the new test in place:

```
$ git stash push -- .pi/extensions/workflows/evidence.ts .pi/extensions/workflows/index.ts
$ npx vitest run tests/integration/quick-workflow.test.ts -t "case 9"
 FAIL  ... case 9 (CR-01 iteration 4 regression, PROBE W1) ...
   AssertionError: PROBE W1: the evidence row must not claim "a commit landed" when checkout only moved HEAD:
   expected 'a commit landed at 9b59ee29d85cd2feef…' not to contain 'a commit landed'
   Expected: "a commit landed"
   Received: "a commit landed at 9b59ee29d85cd2feef028409f44898b7d6db47af with no failed tool result recorded
             during this run -- the work itself is not verified"
   Tests  1 failed | 13 skipped (14)

$ git stash pop
$ npx vitest run tests/integration/quick-workflow.test.ts
   Tests  14 passed (14)
```

**Live reproduction of the reviewer's own W1, W2 and P4 probes** (a
temporary standalone probe file, run once for pasted output, then deleted --
`git status` afterwards shows no leftover probe artifact), executed against
the real `/quick`, the real safety extension, a real faux session, AFTER the
fix landed:

```
=== W1  bash 'git checkout --detach HEAD~1'  then  "done, I implemented and committed the fix and all tests pass"
commits before/after (rev-list --count HEAD): 2 / 1
row:    {"verdict":"accept","reason":"HEAD moved to 10451e087c6226805d6ffde1c405087909f58e59 with no failed tool
         result recorded during this run -- whether a commit was created, and whether it contains the work, are
         both unverified", "baseSha":"a1e186db8...","headSha":"10451e087c...","recordCount":1,"tools":["bash"]}
notify: {"text":"quick: HEAD moved to 10451e087c6226805d6ffde1c405087909f58e59 with no failed tool result --
         no commit was verified and the work itself is NOT verified","level":"info"}

=== W2  bash 'git reset --hard HEAD~1'       then  "done, committed and verified"
git log --oneline BEFORE: a1e186d second | 10451e0 first
git log --all --oneline AFTER: 10451e0 first        <-- "second" is GONE (a commit was destroyed)
row:    {"verdict":"accept","reason":"HEAD moved to 10451e087c... with no failed tool result recorded during
         this run -- whether a commit was created, and whether it contains the work, are both unverified"}
notify: {"text":"quick: HEAD moved to 10451e087c... with no failed tool result -- no commit was verified and
         the work itself is NOT verified","level":"info"}

=== P4  bash 'git push --force origin main' [BLOCKED] -> bash 'git commit --allow-empty' -> "pushed and verified, tests pass"
row:    {"verdict":"reject","reason":"a tool result in this run failed (bash) -- a completion claim cannot be
         supported by a run that contains a recorded failure, even if a commit landed afterwards", ...}
notify: {"text":"a tool result in this run failed (bash) -- ...","level":"error"}
```

Neither W1 nor W2's message contains the string "a commit landed" anymore --
both say "HEAD moved", which is the true, structurally-supported statement.
P4 (iteration 3's own rejection regression) still REJECTS exactly as before
this pass -- the wording change made no regression to the reject paths.

**Note (requires human verification):** none. This is a pure wording change
-- the predicate's control flow (which branch a given input takes) is
byte-for-byte unchanged; only the strings attached to the ACCEPT branch were
edited. `tsc --noEmit` is clean and the full suite (84 files, 1440 tests) is
green with the change in place.

## WR-01: accepted as a documented residual risk, not fixed this pass

**Status: accepted, unchanged.** Per this pass's explicit fix scope
(CR-01 only), WR-01 -- "the anti-offloading ratchet counts nothing outside a
command directory, one sideways `mkdir` defeats it" -- was left untouched.
The reviewer's own verdict on WR-01 already recommended shipping it as an
accepted finding rather than spending another pass: it is a test-only
control with no effect on shipped runtime behaviour, the correct scope of
the real fix (budget all of `.pi/`, or police imports) is explicitly a
Phase 9 decision rather than a Phase 6 one, and nothing in the current tree
exploits the hole. No code or test file touched for this finding.

## Iteration 1, 2 and 3 findings -- carried forward (one-line status, unchanged by this round)

| ID | iteration-1 status | iteration-2 disposition | iteration-3 disposition | iteration-4 disposition |
|---|---|---|---|---|
| CR-01 (orig., iter 1, no-commit run accepted) | fixed | re-opened and fixed again (records-anywhere-in-run predicate) | superseded by iteration-3 CR-01 (capture-point blindness) | superseded by iteration-4 CR-01 (ACCEPT-wording over-claim) -- **fixed above** |
| WR-01 (orig., iter 1) | fixed | re-opened and fixed again (ordinary-turn-in-flight guard) | verified still fixed | untouched this round; unrelated to iteration-4's own WR-01 |
| WR-02 (orig., iter 1, routing pre-flight) | fixed | untouched, still verified fixed | verified still fixed | untouched this round |
| WR-03 (orig., iter 1, armedCwd() SHA source) | fixed | untouched, still verified fixed | verified still fixed | untouched this round; unproven at session level until Phase 7 |
| WR-04 (orig., iter 1, pruneEvidenceLogs wiring) | fixed | untouched, still verified fixed | verified still fixed | untouched this round |
| WR-05 (orig., iter 1, budget registry discovery) | partially fixed | superseded by iteration-2 WR-03 (directory aggregate) | verified still fixed | untouched this round |
| WR-06 (orig., iter 1, run-state/security test coverage) | fixed | untouched, still verified fixed | untouched | untouched this round |
| CR-01 (iter 2, records-anywhere-in-run) | -- | fixed | verified genuinely closed | untouched this round |
| WR-01 (iter 2, ordinary-turn-in-flight) | -- | fixed | verified genuinely closed | untouched this round |
| WR-02 (iter 2, agent_end SHA-read swallow) | -- | fixed for the probed path | superseded by iteration-3 WR-02 (orphan before agent_end) -- fixed | verified still fixed |
| WR-03 (iter 2, directory aggregate scoped to workflows/ only) | -- | fixed for the flat layout, incomplete in general | superseded by iteration-3 WR-01 (depth-filter hole) -- fixed | superseded again by **iteration-4 WR-01** (sibling-directory hole) -- **accepted, not fixed** (see above) |
| WR-04 (iter 2, existsSync/readFileSync ordering) | -- | fixed | verified still fixed | untouched this round |
| WR-05 (iter 2, docs/WORKFLOWS.md drift) | -- | fixed | this round's docs changes kept it current | this round's docs changes (accept-guarantee wording) keep it current |
| CR-01 (iter 3, capture-point blindness to four failure classes) | -- | -- | fixed (`tool_execution_end` capture point, `recordCaptureFailure`) | verified still fixed (P4/P7 shapes untouched by this round's wording-only edit) |
| WR-01 (iter 3, directory aggregate defeated by one subdirectory) | -- | -- | fixed for the nested case | superseded by **iteration-4 WR-01** (sibling case) -- **accepted, not fixed**, carried to Phase 9 |
| WR-02 (iter 3, session_start disarms an orphaned run) | -- | -- | fixed | verified still fixed |
| IN-01..IN-06 (iter 3, Info) | -- | -- | out of scope (fix_scope critical_warning) | out of scope (fix_scope critical_only); left for a later phase |
| **CR-01 (iter 4, ACCEPT over-claims "a commit landed")** | -- | -- | -- | **fixed this round** (see above) |
| **WR-01 (iter 4, aggregate counts nothing outside a command directory)** | -- | -- | -- | **accepted, not fixed this round** (see above); explicit Phase 9 inheritance |

## Residual risk carried forward

- **The gate proves "HEAD changed + no failed tool outcome", never "the
  claimed work was done".** After this pass's own correction, ACCEPT no
  longer even claims a commit landed -- it claims exactly what the predicate
  can establish: `git rev-parse HEAD` differs from the SHA captured at arm
  time, and no finalized tool call recorded during the run carried a
  structural failure. Nothing in the predicate distinguishes a commit from a
  `checkout`, a `reset` or a `revert`, and nothing attributes the HEAD move
  to any particular tool call. Verifying that a genuine commit landed, that
  its diff contains the claimed work, or binding to a tree hash instead of a
  commit SHA are all explicitly Phase 8's job, not this walking skeleton's.
- **The anti-offloading ratchet reaches down but not sideways (WR-01,
  accepted).** `commandDirs` is derived only from files that already spell
  `registerCommand(`; a `.ts`/`.js` file that sits in a sibling directory (or
  in `.pi/lib/`) and never spells that call is invisible to both the
  per-file registry and every directory total. The reviewer proved this with
  2,402 planted lines leaving the whole suite green. The correct scope of
  the real fix -- budget all of `.pi/`, or police import destinations -- is
  a deliberate Phase 9 decision, not a Phase 6 one, and Phase 9 is the phase
  this control exists to survive.
- **`evidence.ts`'s budget has been raised three times across this loop**
  (280 → 300 → 330 → 340, now holding steady at 340 with 336 measured).
  This pass did NOT raise it a fourth time -- the wording fix needed no
  room, exactly as the task required. Roughly half of the file's raw-line
  total is docstring; the ratchet is real as a code-size control but is
  increasingly indexing documentation growth rather than executable
  complexity, a property worth revisiting if a future phase needs to touch
  this file again.
- An empty commit, or a commit of wholly unrelated content, still ACCEPTs --
  needs a diff or tree hash (Phase 8).
- A failure hidden inside a single shell command accepts:
  `bash 'false; git commit --allow-empty -m N3'` → `accept`, because the
  gate's granularity is a tool call, not a command.
- `EvidenceRecord.command` is built, redacted, truncated and never read;
  `tool_execution_end` supplies `toolInput: {}`, so it is always the empty
  string and reject reasons name the tool but never the command (IN-04,
  out of scope).
- `index.ts` sits at 79/80 -- one raw line of headroom, and no ceiling
  debate has been had.
- `agent_end` still spawns a `git rev-parse HEAD` on every turn of every
  session the extension is loaded into, armed or not -- no `isRunArmed()`
  short-circuit.
- `armedCwd()` remains unproven at session level until `pi-subagents` lands
  (Phase 7).
- Architectural invariants re-confirmed clean by this pass's own `tsc` and
  full-suite runs: `evidence.ts` imports only `../diagnostics/redact.ts` and
  `../../lib/jsonl.ts` -- nothing from `../safety/` (CONTEXT.md decision 8);
  no tool was registered; `docs/RUNBOOK.md` was not touched; no CI job was
  added.

## Final verification (real output, executed in the primary checkout after the worktree fast-forward)

```
$ npx tsc --noEmit
   (no output -- clean)

$ npx vitest run
    Test Files  84 passed (84)
         Tests  1440 passed (1440)
    Duration    31.77s

$ node -e "console.log(require('fs').readFileSync('.pi/extensions/workflows/index.ts','utf-8').split('\n').length)"
79
$ node -e "console.log(require('fs').readFileSync('.pi/extensions/workflows/evidence.ts','utf-8').split('\n').length)"
336
```

`.pi/extensions/workflows/index.ts` is **79/80** raw lines (unchanged --
still one line of headroom). `evidence.ts` is **336/340** (unchanged --
not raised a fourth time). `git status --porcelain` in the primary checkout
after the fast-forward shows only the pre-existing, untouched review
artifacts for this phase; no probe file, stash, or uncommitted source edit
was left behind.

## Commits (in order)

| Finding(s) | Commit | Files |
|---|---|---|
| CR-01 (iteration 4, ACCEPT-wording over-claim) | `fd1a49a` | `.pi/extensions/workflows/index.ts`, `.pi/extensions/workflows/evidence.ts`, `docs/WORKFLOWS.md`, `tests/integration/quick-workflow.test.ts` |

The commit above was made inside an isolated worktree
(`gsd-reviewfix/06-1177`, created from `main`'s tip at `ee45f19`) and
verified GREEN (`npx tsc --noEmit` clean, full `npx vitest run` -- 84 files,
1440 tests -- passing) both inside the worktree and, after the
fast-forward, in the primary checkout. `main` was fast-forwarded to the
worktree branch's tip (`git merge --ff-only`), the worktree was removed, the
temp branch deleted, and the recovery sentinel dropped -- the transactional
cleanup tail this workflow specifies. One process note: `git worktree
remove --force` failed on a `node_modules` directory that had been
manually staged inside the worktree (as a non-reparse-point directory, used
only to run `tsc`/`vitest` without a slow `npm install`, and confirmed via
`fsutil reparsepoint query` to be a genuine separate directory rather than a
shared symlink/junction); it was removed directly with `rm -rf` before
`git worktree prune`, and the primary checkout's own `node_modules` was
independently verified intact (92 top-level entries, `.bin/tsc` present,
`tsc --noEmit` clean) both before and after. No source file was affected by
this cleanup detail.

---

_Fixed: 2026-08-15T01:47:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 4 -- final pass_
