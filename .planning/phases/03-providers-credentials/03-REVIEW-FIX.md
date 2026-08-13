---
phase: 03-providers-credentials
fixed_at: 2026-08-14T02:07:00Z
review_path: .planning/phases/03-providers-credentials/03-REVIEW.md
iteration: 2
findings_in_scope: 8
fixed: 7
skipped: 1
status: partial
---

# Phase 3: Code Review Fix Report — Iteration 2

**Fixed at:** 2026-08-14
**Source review:** `.planning/phases/03-providers-credentials/03-REVIEW.md`
**Iteration:** 2

**Summary:**

- Findings in scope: 8 (4 Warning, 4 Info; `fix_scope: all`)
- Fixed: 7
- Skipped: 1 (IN-01 — accepted-and-documented, no code change is correct)

**Suite:** 649/649 → **655/655**, 45 files. `npx tsc --noEmit` clean. Working
tree byte-identical to the branch head after every falsification run
(`git status --porcelain` empty, verified after each).

**No network request was issued to any provider host. No credential was read or
written. No `RB-03-xx` status changed — all five remain OUTSTANDING**, enforced
in both the summary table and the Status line by `tests/unit/docs-policy.test.ts`.

## The standing failure mode this iteration was about

Iteration 1's fixes to three tautological tests wrote new tautologies. Every one
of the reviewer's three mutations — each **649/649 green** against the tree this
iteration inherited — was re-run against the fixed tree, together and
individually:

| Reviewer mutation | Before this iteration | After |
|---|---|---|
| append `\|exceeded` to `QUOTA_PATTERN` | 649 passed | **RED** — `case 3c` (set equality) and `case 3b` (minimality) |
| delete the sentinel row from `NOT_A_PROFILE` **and** the sentinel check from `usableProfileName` | 649 passed | **RED** — `case 4b` (`expected 1 to be greater than or equal to 2`) |
| swap the two lines of `resolveProfileName` | 649 passed | **RED** — `case 6` (`expected [] to include 'amazon-bedrock'`) |

Applied all three simultaneously: **4 failed / 651 passed across 3 files.**
Tree restored; `git status` clean; 655/655 green again.

Every fix below was committed **before** it was falsified, so no
`git checkout --` restore could delete an uncommitted edit and hand back a green
run against a pre-edit file — the trap recorded in `STATE.md` that caught both
previous agents in this phase.

## Fixed Issues

### WR-01: CR-01's sentinel guard can be deleted with nothing red

**Files modified:** `tests/integration/sso-classifier.test.ts`
**Commit:** `03f9f70`
**Status:** fixed

`expect(notAProfileRuns.length).toBeGreaterThanOrEqual(NOT_A_PROFILE.length)`
compared the loop with itself; the only real floor was the paired `>= 1`, and
one row is exactly enough to let the table be halved to the metacharacter row
— which `SAFE_PROFILE_NAME` already rejects — leaving the CR-01 equality check
free to delete.

Both floors are now the literal **2**, which is the number of *mechanisms* the
table covers. Two further assertions stop the floor being met by two rows of the
same kind: `SAFE_PROFILE_NAME` must **accept** `PROFILE_TEMPLATE_SENTINEL` (that
is precisely why the equality check exists), and the sentinel row must be
present by value.

**Falsified three ways:**

| Mutation | Result |
|---|---|
| delete sentinel row **and** sentinel check (the reviewer's) | RED — `expected 1 to be greater than or equal to 2` |
| delete **only** the sentinel check in `usableProfileName` | RED — `case 4b`'s `.not.toContain(value)`: the sentinel was interpolated into the surfaced command |
| delete **only** the table row | RED — the floor of 2 |

Tree restored and re-verified clean after each.

---

### WR-02: `QUOTA_PATTERN` can be widened arbitrarily with nothing red

**Files modified:** `tests/integration/fallback-chain.test.ts`,
`.pi/extensions/providers/schema.ts`
**Commit:** `5440afc`
**Status:** fixed

The fixture table sat *beside* the pattern and nothing tied them together, so
the addition direction — the direction CR-03 was about — was entirely open.

Three changes:

1. **`topLevelAlternatives(source)`** — a character walk over the regex source
   tracking group depth, character classes and backslash escapes. Deliberately
   *not* the reviewer's suggested `/\|(?![^(]*\))/`: that lookahead is correct
   only for the parenthesis shapes present today and mis-splits **silently** the
   moment a second group appears (it still produces alternatives, just the wrong
   ones). The walk stays correct as the pattern grows.
2. **`case 3c`** — set equality between `topLevelAlternatives(QUOTA_PATTERN.source)`
   and `QUOTA_ALTERNATIVE_FIXTURES`, failing in both directions with the
   consequence spelled out (a match forwards the user's whole prompt to a second
   vendor).
3. **`case 3b`'s minimality check now rebuilds the other alternatives from
   `QUOTA_PATTERN.source`**, not from the fixture table. This is what makes
   `schema.ts:547-548`'s claim — that minimality "is asserted directly" — *true*
   rather than merely reworded; the docstring was updated to describe the
   mechanism that now enforces it.
4. **`case 3d`** pins the splitter's own contract (flat alternation, bar inside a
   group, bar inside a character class, escaped bar, no bar) on inputs
   independent of `QUOTA_PATTERN` — otherwise the obvious way to make a failing
   equality pass is to adjust the thing producing its left-hand side.

**Falsified:** appending `|exceeded` → `case 3b` **and** `case 3c` both red, the
latter naming the divergence (`expected [ Array(8) ] to deeply equal [ Array(7) ]`).
Replacing the splitter body with `source.split("|")` → `3b`, `3c` **and** `3d`
red. Restored clean.

---

### WR-03: `resolveProfileName`'s stored-before-ambient order is asserted nowhere

**Files modified:** `.pi/extensions/providers/index.ts`,
`tests/unit/bedrock-auth.test.ts`
**Commit:** `a86ed21`
**Status:** fixed

**Decision taken (autonomous, one line):** the reviewer offered two routes —
wire a `credentials` seam into `withFauxSession`, or unit-test the function
directly. Took the second. The first is structurally blocked: since the WR-05
fix `drive()` registers the faux provider under the id `amazon-bedrock`, which
**shadows Pi's real Bedrock resolver**, so `getProviderAuth("amazon-bedrock")`
resolves through faux (whose auth is empty) whatever credential store is handed
to the runtime. Making that seam answer would mean un-doing WR-05's fix. The
function takes nothing but `ctx.modelRegistry.getProviderAuth`.

`resolveProfileName` is now exported (a named export does not change the file's
classification — `extension-layout.test.ts` keys on the *default* export) and
driven against a stubbed `ExtensionContext` in three new cases:

- **case 6** — stored `kypi-fixture-stored-profile`, ambient
  `kypi-fixture-ambient-profile`; the stored one must win, because that is the
  one Pi itself dials. It **also asserts the registry was asked for
  `amazon-bedrock`**, so a handler reading a different provider cannot pass by
  falling through to the ambient branch.
- **case 6b** — the paired positive: with no stored credential the ambient value
  is surfaced. Without it, case 6 is satisfied by a function that never reads the
  environment at all — and the ambient branch is the *common* case on the target
  machine, since bootstrap deliberately writes no Bedrock entry.
- **case 6c** — neither source yields `PROFILE_PLACEHOLDER`, not a command
  trailing off after `--profile `.

**Falsified:** swapping the two lines → `case 6` red across the full suite.
Restored clean.

*Incidental:* the first draft of the new docstring tripped
`tests/unit/chokepoint-lint.test.ts` by naming a runtime class in prose. Reworded
per that test's own documented remedy rather than allowlisted.

---

### WR-04: `docs/RUNBOOK.md` RB-03-03 still describes the pre-CR-01 installer

**Files modified:** `docs/RUNBOOK.md`, `tests/unit/docs-policy.test.ts`
**Commit:** `91924fe`
**Status:** fixed

Step 2 now states what `merge_auth_json` actually does: bootstrap **does not**
install the `amazon-bedrock` entry, withholds any template entry still holding a
`REPLACE_WITH_` value at any depth, reports what it withheld, and a fresh
`PI_CODING_AGENT_DIR` therefore yields an `auth.json` holding `dashscope` and
`deepseek` and no `amazon-bedrock` key — *that is correct, not a failed
bootstrap*. That claim is not new prose: `templates-install.test.ts` case 1a
already asserts `Object.keys(installedAuth).sort()` equals the installable
partition.

The reviewer's optional suggestion was taken, but **not** by adding prose to
`ENTRY_COMMANDS` (that array is contracted to hold commands, asserted by a case
named "names the exact command(s)"). Instead a new **two-sided** case:

- **behaviour half** — `bin/bootstrap.sh` must still contain
  `if (carriesSentinel(tpl[key])) { skipped.push(key); continue; }`;
- **doc half** — the RB-03-03 section must contain `does **not** install this
  entry` and `REPLACE_WITH_AWS_PROFILE_NAME`, and must **not** contain the old
  `replacing the literal placeholder`.

So a third behaviour change fails the behaviour half and a doc tidy-up fails the
doc half; neither can drift alone.

**Falsified both halves:** deleting the withholding line from `bootstrap.sh` →
red on the behaviour half; restoring the pre-CR-01 sentence → red on the doc
half. Restored clean. **No `RB-03-xx` status was touched.**

---

### IN-02: `grep -v ... > "$_rc_file" || true` swallows exit 2

**Files modified:** `bin/bootstrap.sh`
**Commit:** `99191c3`
**Status:** fixed

`|| true` → `|| [ "$?" -eq 1 ]`, exactly as suggested. Exit 1 (empty filter
result, a legitimate one-line `ignore-scripts=false` input) still survives
`set -e`; exit 2 (unreadable or vanished backup) now aborts loudly with the 0600
backup still on disk.

**Executed in a standalone POSIX harness rather than reasoned about:**

| Form | Input | Result |
|---|---|---|
| new | `ignore-scripts=false` only (grep exits 1) | `EXIT1-SURVIVED`, status 0 |
| new | missing backup (grep exits 2) | script aborts, status 1 |
| old `\|\| true` | missing backup | prints past the failure, status 0, leaves a **zero-byte** `.npmrc` |

POSIX conformance re-checked after touching the script per the run rules:
`sh -n` OK, `dash -n` OK, `tests/unit/lf-and-shell.test.ts` 15/15 (it is the one
that catches `local`/`declare`/`typeset`, which `dash -n` does not).

---

### IN-03: the IN-05 teardown removes `http.Server`'s own connection handler

**Files modified:** `tests/helpers/loopback.ts`
**Commit:** `d270cfc`
**Status:** fixed

`trackSocket` hoisted to a named `const` and the bind-failure catch now calls
`server.removeListener("connection", trackSocket)`.

This path is driven by no test (the reviewer notes it is harmless today), so
there is no mutation that could go red. The underlying claim was therefore
**executed** instead:

```
{"after_on":2,"after_removeListener":1,"after_removeAllListeners":0}
```

`createServer` does install its own `connection` listener; `removeAllListeners`
destroyed it; the named removal leaves it intact.

---

### IN-04: case 7c counts a mention inside a test file as "read by something tracked"

**Files modified:** `tests/integration/templates-install.test.ts`
**Commit:** `7c03dd3`
**Status:** fixed

`&& !path.startsWith("tests/")` added to the consumer filter, with the reason
inline: a test that names a variable is documenting a check, not consuming a
credential.

**Falsified with the evasion the finding describes, and its paired positive:**
adding `KYPI_MUTATION_ONLY_TOKEN=` to the managed block and naming that string
**only** under `tests/` →
`expected [ 'KYPI_MUTATION_ONLY_TOKEN' ] to deeply equal []`. Reverting only the
new filter line, with the same mutation still in place → **green**. So the
tightening is a real widening of the check, not a restatement. Verified all four
managed names still have non-test consumers (the suite is green). Restored clean.

## Skipped Issues

### IN-01: CR-02's mode assertions have still never executed on any leg

**File:** `tests/integration/templates-install.test.ts:398-425`
**Reason:** skipped deliberately — the finding's own **Fix** section says "No
code change", and it is right.

Case 1c branches on `process.platform === "win32"` and returns after two
existence assertions, so the `700`/`600` checks run only on `macos-latest`, which
per BOOT-07 has never run. Writing a Windows-side mode assertion would be worse
than the gap: `chmodSync` on Windows toggles only the read-only bit and does not
touch NTFS ACLs — a fact this repository already records in `docs/RUNBOOK.md`'s
Phase 1 machine-state notes and pins in `docs-policy.test.ts` — so such an
assertion would either be vacuous or would assert a control that does not exist
on the platform the harness actually runs on. The correct outcome is to leave the
macOS leg as the thing that answers it.

Tracked against **BOOT-07**, which is itself OUTSTANDING (GitHub Actions has
never run; it has no `RB-xx` entry yet, per the existing note in `STATE.md`).
This is recorded as accepted-and-documented, exactly as the reviewer accepted
CR-02's macOS-only residual as Info-not-finding. **It must not be restated as
closed until that leg has run.**

## Notes carried forward

- **An edge deliberately not pinned.** `usableProfileName` rejects the sentinel
  and `resolveProfileName` then falls through to the *ambient* value. On a
  machine holding a hand-copied template entry, Pi would dial the sentinel and
  fail while the message would name the ambient profile — the same shape of
  hazard WR-03 is about. It is out of scope for these findings, the remedy is not
  obvious (falling back to the placeholder + RB-03-03 hint may be better than
  naming a profile that did not fail), and pinning behaviour I am not confident
  is correct would be worse than leaving it unasserted. Recorded here rather than
  silently decided.
- `.planning/phases/03-providers-credentials/.review-fix-recovery-pending.json`
  is a transient worktree-recovery sentinel written at the start of this run and
  removed at the end. If it is present, this run did not finish cleanly.

---

_Fixed: 2026-08-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
