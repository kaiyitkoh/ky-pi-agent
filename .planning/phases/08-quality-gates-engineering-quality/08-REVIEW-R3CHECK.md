---
phase: 08-quality-gates-engineering-quality
reviewed: 2026-08-15T18:05:00Z
depth: deep
scope: targeted verification pass over dc4cc16..7eda58c (WR3-01/01a, WR3-02, WR3-03, WR3-04, WR3-06)
files_reviewed: 8
files_reviewed_list:
  - .pi/extensions/quality/calibration.ts
  - .pi/extensions/quality/index.ts
  - tests/integration/reviewer-calibration.test.ts
  - tests/integration/qoder-delegate.test.ts
  - tests/unit/quality-production-exec.test.ts
  - tests/unit/workflow-budgets.test.ts
  - docs/QUALITY.md
  - docs/WORKFLOWS.md
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 08 — Round 3 Targeted Verification (R3CHECK)

**Reviewed:** 2026-08-15
**Scope:** ONLY `dc4cc16..7eda58c`. This does not supersede `08-REVIEW.md`.
**Method:** independent re-derivation of the calibration number with a throwaway
scorer harness; live mutation of production source for WR3-03 and WR3-04, each
restored and confirmed byte-identical (`git status --porcelain` clean).

## Summary

**The headline number is honest.** I re-derived the catch rate myself from
`calibration.ts` + `seeded-defects/index.ts` without running the phase's own
test, and got `caught: 2, total: 6, catchRate: 0.3333333333333333,
unmatchedFindings: 1`, with `perDefectClass` = `fabricated-evidence: true`,
`absent-guard: true`, all four others `false`. That is exactly what
`KNOWN_SUBSET_CAUGHT` and the test assert. The WR3-02 revert is genuine: the
`false-label` `concreteFailure` at `reviewer-calibration.test.ts:255` is
byte-identical to `ac0e427`'s pre-`bb2a67c` text, the other two findings are
unchanged from `ac0e427`, and the answer key
(`tests/fixtures/seeded-defects/index.ts`) was **not touched by either
`ad92ffd` or `cc1ed23`** — so nothing was quietly adjusted to compensate. All
five controls (blind, shotgun, name-drop, kitchen-sink, two-needle
kitchen-sink) independently score `catchRate: 0` in my harness.

**WR3-03 and WR3-04 both survive their own mutations, honestly.** I performed
all three WR3-03 mutation shapes against the real `client.ts:743` / `:808` and
all three go RED, Mutation B with the exact claimed `nowCalls === 0` message.
I disabled WR3-04's `%` guard and both new tests turned RED with exactly the
claimed symptoms (`{status:"fail", findings:["The system cannot find the path
specified."]}` and `pass` instead of `unavailable`). The `DIRECTORY_BUDGETS`
raise 3670→3740 is **measured, not padded**: the eight files total 3,731
`wc -l` newlines = 3,739 by the ratchet's own `split("\n").length` metric,
matching the per-file figures in the justification exactly, leaving **one line
of headroom**. WR3-06 removed the count and the enumeration outright and
points at `DIRECTORY_BUDGETS` as the source of truth — it did not swap in a
different wrong number.

**What round 3 got wrong.** The new WR3-01 cross-contamination rule has a
demonstrable perverse consequence and a residual exploit, both from one root
cause. It does not affect the 2/6 number, but it makes an affirmative claim in
`docs/QUALITY.md` false and will corrupt `RB-08-03`, the live run this number
exists to set up. That is CR3C-01 below. Separately, `cc1ed23`'s commit
message claims the corrected number was propagated to
`.planning/REQUIREMENTS.md`; one of that file's two GATE-08 statements still
says 3/6.

---

## Critical Issues

### CR3C-01: `findingCatches`'s cross-contamination rule rejects genuine findings, and one generic 3-word phrase still scores 0.167 — the two-needle "independence" premise is false for 2 of 6 classes

**File:** `.pi/extensions/quality/calibration.ts:195-203` (the rule), root cause
in `tests/fixtures/seeded-defects/index.ts:345` and `:358` (the needle sets)
**Claim under test:** `docs/QUALITY.md:281-283` — *"a genuine finding about one
file's one defect does not organically use enough of a wholly different
defect's vocabulary to catch it too"*. And
`calibration.ts:129-136` — *"a second, INDEPENDENT needle is not free to
include without genuinely describing a second aspect of the defect."*

Both statements are false, and for the same reason: `tautological-test`'s
needle set contains `"cannot fail"` **and** `"structurally cannot"`
(`seeded-defects/index.ts:345`). These are not two independent facts — they are
both satisfied by the single contiguous natural phrase **"structurally cannot
fail"**. `escaped-side-effect` has the same shape at `:358`: `"writes into the
real"` + `"developer's own home directory"` are both satisfied by the one clause
"writes into the real developer's own home directory".

**Consequence A — genuine findings are rejected (under-count).** Measured, four
for four. Each of these is correctly located, correctly severity-tagged, and
carries two of its OWN class's needles; each scores `caught: 0`,
`unmatchedFindings: 1`:

| finding (abridged), at its own correct file | scored |
|---|---|
| `false-label`: "MUTATION-VERIFIED is false: parseCommand returns true **regardless of input**, so the test **structurally cannot fail** and **the label survived its own mutation**." | **0** |
| `absent-guard`: "dispatchCommand **never calls isGuardedCommand** and is **not wired in**; the guard's unit test **structurally cannot fail** because it never touches this path." | **0** |
| `symptomatic-fix`: "isWithinRateLimit **always returns true** and **ignores its arguments**, so every caller's assertion **structurally cannot fail**." | **0** |
| `fabricated-evidence`: "markMigrationComplete **performs none** of the work and is a **hardcoded return**; the VERIFIED comment means the claim **structurally cannot fail**." | **0** |

Delete the four words "structurally cannot fail" from the first row and it
scores `1/6` correctly. So the scorer punishes a reviewer for using this
project's own house vocabulary — "tests that cannot fail" is the phrase
`seeded-defects/index.ts:16`, `docs/QUALITY.md` and `CLAUDE.md` all use for
this entire defect family. A real reviewer at `RB-08-03` is systematically
likelier to write it than to avoid it, so the live catch rate will read low for
a reason that has nothing to do with the reviewer.

**Consequence B — a derivable generic phrase still scores non-zero (exploit).**
`MIN_DISTINCT_NEEDLES = 2` is defeated for `tautological-test` by that same
single phrase. One boilerplate `concreteFailure` of **"This test structurally
cannot fail."**, reused verbatim across all six touched files, having
identified nothing, scores:

```
caught: 1/6, catchRate: 0.167   { tautological-test: true, ...rest false }
```

and `"It writes into the real developer's own home directory."` likewise scores
`1/6` via `escaped-side-effect`. This is a *worse* class of exploit than either
control round 3 added: `SHOTGUN_KITCHEN_SINK_ARGS` and
`TWO_NEEDLE_KITCHEN_SINK_ARGS` both require reading the corpus's own answer key
(the review's own stated reason they were Warnings, not repeat Criticals),
whereas "this test structurally cannot fail" is derivable from the input alone
— the same property that made WR-03's name-drop control a Critical. The
name-drop control scores 0; this scores 0.167.

**Fix.** Make the needle sets phrase-independent, then pin that property:

```ts
// tests/fixtures/seeded-defects/index.ts:345 — tautological-test
// "structurally cannot" is not independent of "cannot fail": one phrase,
// "structurally cannot fail", satisfies both. Replace it with a needle
// describing a genuinely separate fact about THIS tautology.
mustMentionAny: ["compares it to itself", "cannot fail",
                 "identical to what it is compared against",
                 "assigned from the same call"],

// :358 — escaped-side-effect: same problem across
// "writes into the real" / "developer's own home directory".
mustMentionAny: ["writes into the real", "outside the temp repo",
                 "escapes the test", "not redirected to a temp"],
```

and add two permanent guards to the corpus-integrity group in
`reviewer-calibration.test.ts`:

```ts
it("no two needles of one class are jointly satisfiable by one contiguous phrase", () => {
  for (const d of SEEDED_DEFECTS) {
    for (const a of d.expected.mustMentionAny)
      for (const b of d.expected.mustMentionAny) {
        if (a === b) continue;
        // a phrase overlapping on >= 1 shared word is the tell
        const tail = a.split(" ").slice(-1)[0], head = b.split(" ")[0];
        expect(`${a} ${b}`.includes(`${tail} ${head}`) && a.includes(head) === false,
          `"${a}" and "${b}" (${d.id}) are not independent needles`).toBe(true);
      }
  }
});

it("SIXTH CONTROL -- a single generic phrase reused across all six files scores 0", () => {
  // derivable from the input alone, no answer key required
  for (const text of ["This test structurally cannot fail.",
                      "It writes into the real developer's own home directory."]) {
    expect(scoreCalibration(expected, SHOTGUN_LOCATION_FILES.map((f, i) => ({
      severity: "BLOCKER" as const, location: `${f}:${i + 1}`, concreteFailure: text,
    }))).catchRate).toBe(0);
  }
});

it("REGRESSION -- an accurate finding is not rejected for using house vocabulary", () => {
  expect(scoreCalibration(expected, [{ severity: "BLOCKER",
    location: "src/parser-mutation-claim.test.ts:3",
    concreteFailure: "MUTATION-VERIFIED is false: parseCommand returns true regardless of " +
      "input, so the test structurally cannot fail and the label survived its own mutation.",
  }]).perDefectClass["false-label"]).toBe(true);
});
```

Also correct `docs/QUALITY.md:281-283`, which currently asserts the property
this finding disproves.

**Verdict: BLOCK.** Not because 2/6 is wrong — it is right, and this defect does
not move it. Because (a) it is a live correctness bug in shipped production code
under `.pi/extensions/`, (b) `docs/QUALITY.md` states the opposite as fact, and
(c) `RB-08-03` is the one deliverable this whole apparatus exists to enable, and
it would run against a scorer that penalises correct prose. The fix is two
needle strings plus three tests. Do not carry this one.

---

## Warnings

### WR3C-01: `.planning/REQUIREMENTS.md` states BOTH 3/6 and 2/6 for GATE-08

**File:** `.planning/REQUIREMENTS.md:109` (says 3/6) vs `:304` (says 2/6)

`cc1ed23`'s commit message says the corrected number was propagated to
"`.planning/REQUIREMENTS.md`'s GATE-08 row" — only the summary table at `:304`
was updated. The requirements checklist entry at `:109` still reads *"The
recorded 3/6 catch rate is a SCRIPTED faux reviewer's number"*. One file, two
contradictory numbers for the same gate. Given this phase's entire subject is
stale restated numbers, and given WR3-06 in this very round removed a restated
count for exactly this reason, the miss matters more than it normally would.

The `08-10-SUMMARY.md` / `08-13-SUMMARY.md` bodies also still say 0.5 / 3/6,
but both carry a prominent dated correction banner directly under the H1
explicitly preserving the body as a historical falsification record — that is a
deliberate, disclosed choice and is fine. `:109` is not.

**Fix:** update `:109` to `2/6`, or better, replace the restated number with a
pointer to `docs/QUALITY.md`'s WR3-02 disclosure, matching WR3-06's own
resolution of the same problem.

**Verdict:** should be fixed before phase completion; trivial.

### WR3C-02: WR3-04's `%` guard checks only `bin`, not `args`, though both are folded into the same cmd.exe command line

**File:** `.pi/extensions/quality/index.ts:282`

`commandFor` (`.pi/lib/win-quote.ts:79`) folds `[cmd, ...args]` into one
`cmd.exe` command string, and `quoteForWindows`'s `PLAIN` regex at `:49`
(`^[A-Za-z0-9_.:@/\\=-]+$`) excludes `%`, so a `%`-bearing argument is
double-quoted — which, per this fix's own correct premise, does **not** suppress
`%VAR%` expansion. The guard inspects only `bin`.

Currently unreachable: the only two arg lists are the literal constants
`["--noEmit"]` (`gates.ts:244`) and `["run", ...LINT_GATE_FILES]` (`:295`),
none containing `%`. So this is a latent gap, not a live bug. But the guard's
own docstring justifies itself as closing a *structural* property of the
command line, and it closes it for one of the two halves.

**Fix:**

```ts
const pctBearing = [bin, ...args].filter((a) => a.includes("%"));
if (process.platform === "win32" && pctBearing.length > 0) {
    throw new Error(
        `${cmd} command line contains '%' in ${pctBearing.join(", ")} -- cmd.exe expands ` +
            "%VAR% inside quotes, so this command line cannot be built safely; " +
            "the leg is unavailable, not failed",
    );
}
```

**Verdict:** carry as accepted-and-documented if you prefer; it is a two-line
change and closing it now costs less than the note explaining why it is open.

---

## Verified Clean (no finding)

- **The 2/6 number.** Independently re-derived: `caught: 2, total: 6,
  catchRate: 0.3333333333333333, unmatched: 1`. Matches every assertion in
  `reviewer-calibration.test.ts:537-542`.
- **Reproducible from an unmodified control.** `KNOWN_SUBSET_ARGS`'s three
  `concreteFailure` strings at `:236`, `:242`, `:255` are byte-identical to
  `ac0e427`'s (modulo a single→double quote style change on the third).
  `tests/fixtures/seeded-defects/index.ts` was not modified by `ad92ffd` or
  `cc1ed23` — no compensating edit to the answer key.
- **All five controls score zero**, verified in my own harness independently of
  the test file: blind `0/6`, shotgun `0/6` (`unmatched: 20`), name-drop `0/6`,
  kitchen-sink `0/6`, two-needle kitchen-sink `0/6`. The two-needle control is
  0 only because of WR3-01's new rule (it was 1.0 before), and the kitchen-sink
  control is 0 only because of `MIN_DISTINCT_NEEDLES` — both are load-bearing,
  neither is passing for an incidental reason.
- **WR3-03 mutation pinning is real.** Performed live against
  `.pi/extensions/qoder/client.ts`:
  - Mutation B (`:743` → `const now = Date.now;`): **RED**, 1 failed / 19
    passed, `"delegateTask never consulted the injected clock ... expected 0 to
    be greater than 0"`.
  - Mutations A+B (`:808` reset also removed): **RED**, same `nowCalls`
    failure.
  - Mutation A alone (`:808` reset removed): **RED**.
  All three restored; `git status --porcelain` clean. This is not a
  `MUTATION-VERIFIED` label that survives its own mutation.
- **WR3-04 fails closed and honestly.** `runTypecheckLeg` (`gates.ts:245-250`)
  maps the thrown error to `{status: "unavailable", reason: ...}`, never
  `fail`. Guard disabled → both new tests RED with exactly the claimed
  symptoms; restored → 18/18 green, 82/82 across both files.
- **`DIRECTORY_BUDGETS` 3670→3740 is measured.** Eight files = 3,731 `wc -l`
  = 3,739 under the ratchet's own line metric; every per-file figure in the
  justification string matches to the line. Rounded to 3740 leaves 1 line of
  headroom. Not padding.
- **WR3-06 removed rather than re-numbered.** `docs/WORKFLOWS.md:149-160` now
  carries no count and no enumeration, and points at `DIRECTORY_BUDGETS`.

---

_Reviewed: 2026-08-15T18:05:00Z_
_Reviewer: Claude (gsd-code-reviewer), targeted R3 verification pass_
_Depth: deep — includes live mutation of production source, all restored byte-identical_
