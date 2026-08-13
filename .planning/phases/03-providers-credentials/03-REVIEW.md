---
phase: 03-providers-credentials
reviewed: 2026-08-14T02:20:00Z
depth: standard
iteration: 3
files_reviewed: 27
files_reviewed_list:
  - .env.example
  - .pi/extensions/providers/fallback.ts
  - .pi/extensions/providers/index.ts
  - .pi/extensions/providers/schema.ts
  - .pi/extensions/providers/sso.ts
  - .pi/templates/auth-template.json
  - .pi/templates/env.example
  - .pi/templates/models-template.json
  - bin/bootstrap.sh
  - docs/RUNBOOK.md
  - tests/helpers/faux.ts
  - tests/helpers/loopback.ts
  - tests/helpers/models.ts
  - tests/integration/dashscope-payload.test.ts
  - tests/integration/fallback-chain.test.ts
  - tests/integration/sso-classifier.test.ts
  - tests/integration/templates-install.test.ts
  - tests/unit/bedrock-auth.test.ts
  - tests/unit/command-interpolation.test.ts
  - tests/unit/dashscope-compat.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/helpers.test.ts
  - tests/unit/jsonl-rotation.test.ts
  - tests/unit/lf-and-shell.test.ts
  - tests/unit/model-metadata.test.ts
  - tests/unit/r1-unclamp.test.ts
  - tests/unit/template-tracked.test.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 3: Code Review Report — Iteration 3 (final)

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 27
**Status:** clean

## Summary

This iteration answered two questions and nothing else, both by execution rather
than by reading. **Both answers are favourable, and no finding is raised.**

Baseline on the unmutated tree: **655 passed / 45 files**, 25.5 s. The working
tree was restored and verified **byte-identical by `sha256sum -c`** after every
one of the seven mutation runs below; `git status --porcelain` over `.pi/`,
`tests/`, `bin/`, `docs/` and `.env.example` is empty at the end of this review.
No network request was issued.

The phase's signature failure — *a fix to a false-green test that is itself
false-green* — did **not** recur for a third time. The three iteration-2 fixes
each hold up under the mutation they were written to catch **and** under a
sharper second mutation I constructed to test whether the guard was incidental.

### (1) The three named regressions are genuinely closed

Each was run against the real suite. None came back green.

| Mutation | Result | Failing case |
|---|---|---|
| append `\|exceeded` to `QUOTA_PATTERN` (`schema.ts:432`) | **RED — 2 failed / 653 passed** | `fallback-chain.test.ts` case 3c (set equality, `Array(8)` vs `Array(7)`) **and** case 3b (minimality) |
| delete the sentinel row from `NOT_A_PROFILE` **and** the sentinel check from `usableProfileName` | **RED — 1 failed / 654 passed** | `sso-classifier.test.ts:547` case 4b — `expected 1 to be greater than or equal to 2` |
| swap the two lines of `resolveProfileName` (`index.ts:218-219`) | **RED — 1 failed / 654 passed** | `bedrock-auth.test.ts:466` case 6 — `expected [] to include 'amazon-bedrock'` |

The fixer's claims are accurate. Two additional mutations confirm the guards are
not passing by coincidence:

- **Deleting *only* the production sentinel check** (leaving `NOT_A_PROFILE`
  intact) — the case that matters most, since it is the one-token edit that
  restores CR-01 — is **RED** at `sso-classifier.test.ts:593`, and the failure
  message shows the real surfaced string:
  `"AWS SSO credentials are expired or missing. Run: aws sso login --profile REPLACE_WITH_AWS_PROFILE_NAME"`.
  So the guard catches the production deletion on its own, not merely the paired
  table edit.
- **Inverting `resolveProfileName`'s order while still querying the registry**
  (hoisting `const stored = await storedProfileName(ctx);` above an
  ambient-first chain, so the `asked` array is populated) is **RED** at
  `bedrock-auth.test.ts:476` — `expected 'kypi-fixture-ambient-profile' to be
  'kypi-fixture-stored-profile'`. Case 6's two assertions therefore fire
  independently; the precedence check is not a side-effect of short-circuiting.

### (2) Iteration 2's fixes did not introduce a third generation

The three highest-risk pieces of new code were each attacked directly.

**The hand-rolled splitter (`fallback-chain.test.ts:133-180`, commit `5440afc`).**
Case 3d's five inputs — `"a|b|c"`, `"a|b (?:x|y)|c"`, `"a[|]b|c"`,
`String.raw`a\|b|c``, `"solo"` — are string literals with no reference to
`QUOTA_PATTERN`, so the concern that the splitter's own pin could be satisfied by
the thing it splits does not apply. Replacing the walk's body with
`return source.split("|")` turns **case 3b, 3c *and* 3d red together**; 3d names
the splitter directly. The set equality at `:767` is a **string** comparison over
alternatives, so it also catches edits *inside* an alternative (widening
`billing (?:details|quota|limit)` in any way changes that alternative's text and
fails), not only additions and deletions. The walk itself is correct on the
constructs it meets: `inClass` is tested before `[`/`(`, and the backslash branch
consumes the following character before any state transition.

**Case 4b's literal floor (commit `03f9f70`).** The literal is `2` and the
mutation moves it to `1`, so it is pinned to something a real deletion changes —
confirmed by execution, not by reading. It cannot be satisfied by two rows of the
same kind either: `:564` requires `SAFE_PROFILE_NAME` to **accept**
`PROFILE_TEMPLATE_SENTINEL` (so the shape bound provably cannot stand in for the
equality check) and `:572` requires the sentinel row to be present **by value**.

**The direct unit test of `resolveProfileName` (commit `a86ed21`).** It tests the
real function: `tests/unit/bedrock-auth.test.ts:74` imports it from
`../../.pi/extensions/providers/index.ts`, and both mutations applied to that
production file — not to any copy — turn it red. It is not a re-implementation.

**One further mutation, run on my own initiative.** No test pins
`QUOTA_PATTERN.flags`, even though `schema.ts:426-429` makes a strong claim about
the absence of `g` and Phase 2 has exactly such a guard at
`tests/unit/prose-detector.test.ts:249-253`. Adding `g` would make
`classifyFailure`'s `.test()` alternate through a persistent `lastIndex`. Run:
**RED** — `fallback-chain.test.ts:714` case 3b, `expected 'fatal' to be 'quota'`,
because the per-alternative loop calls the pattern repeatedly and the alternation
surfaces immediately. The invariant is enforced behaviourally rather than
structurally, which is sufficient; no finding.

### Standing invariants — all still hold

- **No secret or literal credential** in any template or doc. `auth-template.json`
  carries only `$DASHSCOPE_API_KEY`, `$DEEPSEEK_API_KEY` (env references Pi
  interpolates) and the `REPLACE_WITH_AWS_PROFILE_NAME` sentinel. A scan of
  `.pi/templates/`, `.env.example` and `docs/` for `sk-`, `pt-`, `AKIA` and
  `ASIA` credential shapes returns nothing.
- **No `!command` in `models-template.json`** — `grep -nE '":\s*"!'` returns
  none. The only interpolated value is `apiKey: "$DASHSCOPE_API_KEY"`, and the
  file's own header records why `!command` belongs in `auth.json` instead.
- **Egress stays closed.** Every hit for `deepseek.com`, `aliyuncs.com` and
  `amazonaws.com` under `tests/` is a string in a comment, a docs-policy
  fixture, a `detectCompat` substring assertion, or the `assertLoopbackUrl`
  negative control that exists to *refuse* such a URL. The built-in-catalogue
  route is closed by `fallback-chain.test.ts` case 1 (`:543-575`), which asserts
  every hop resolved *this run's* faux api id rather than the real entry, behind
  its own `>= 5` floor.
- **`bin/bootstrap.sh` is strict POSIX sh.** `sh -n` OK and `dash -n` OK; a
  precise grep for leading `local`/`declare`/`typeset`, `[[ `, `sort -V` and
  `name=(` array assignment returns nothing. (`dash -n` does not catch the first
  three; `tests/unit/lf-and-shell.test.ts` does, and it is green.) The single
  `[[:space:]]` occurrence at `:424` is a POSIX character class inside a `grep`
  pattern, not a bash test.
- **All five `RB-03-xx` statuses read OUTSTANDING and none reads PASSED**
  (`docs/RUNBOOK.md:415-419` summary rows; section statuses at `:423`, `:500`,
  `:542`, `:628`, `:719`). `tests/unit/docs-policy.test.ts:365-374` pins both the
  table row and the Status line for every id in `PHASE_THREE_IDS`. The only
  `PASSED` token in the file is the legend at `:16-17` and the recording rule at
  `:699`.

### Accepted-and-documented residuals (not findings)

Carried forward unchanged from iteration 2's fix report; no code change is
correct for either, and both are already tracked:

- **IN-01** — CR-02's `700`/`600` mode assertions
  (`templates-install.test.ts:398-425`) have still never executed on any leg,
  because case 1c returns early on `win32` and the macOS leg (BOOT-07) has never
  run. The fixer's reasoning for skipping is sound: `chmodSync` on Windows
  toggles only the read-only bit and does not touch NTFS ACLs, so a Windows-side
  assertion would be vacuous or would assert a control that does not exist.
- **The unpinned sentinel/ambient edge** the fixer recorded under "Notes carried
  forward": `usableProfileName` rejects the sentinel and `resolveProfileName`
  then falls through to the *ambient* value, so a machine holding a hand-copied
  template entry would have Pi dial the sentinel while the message names the
  ambient profile. Leaving it unasserted rather than pinning behaviour of
  uncertain correctness is the right call at this point in the phase.

## Narrative Findings (AI reviewer)

None. No mutation produced a wrong result, and no defect was found that could be
demonstrated rather than argued. `status: clean` is reported on that basis, not
to close the iteration.

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 3 (final)_
