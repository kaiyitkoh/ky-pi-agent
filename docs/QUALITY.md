# Quality — the deterministic stage, the reviewer, calibration, and what none of it proves

**The contract of this file.** As with `docs/DIAGNOSTICS.md`, `docs/SAFETY.md`
and `docs/WORKFLOWS.md`: **if the code and this document disagree, the code
is authoritative and this document is a bug.** Fix the document; do not fix
the code to match the document.

**Ownership.** `.pi/extensions/quality/` (`gates.ts`, `rules.ts`,
`review-schema.ts`, `reviewer.ts`, `verdict.ts`, `advisor.ts`,
`calibration.ts`, `index.ts`) and `tests/fixtures/seeded-defects/` are
Phase 8's subsystem. It imports the Phase 2 chokepoint (`callModel()`, via
`routing/modes.ts`'s `runSingleShotRole`) and nothing from `safety/` —
`safety/` imports nothing from `routing/` either, and neither imports
`quality/`. `/review` wires `verdict.ts`'s stop signal and `reviewer.ts`'s dispatch; `/quick` and `/execute` call the deterministic stage.

---

## 1. The deterministic stage

Four legs, in binding order — `typecheck` → `lint` → `lsp` → `anti-pattern`
(`quality/gates.ts`'s `GATE_LEGS`) — each reporting one of exactly three
states:

| State | Meaning |
|-------|---------|
| `pass` | The leg ran and found nothing. |
| `fail` | The leg ran and found something, carried in `findings`. |
| `unavailable` | The leg **did not run at all**, carried with a `reason`. |

**`UNAVAILABLE` IS NOT A PASS.** An absent check reported as clean is Phase
4's headless-guard failure — a control that silently does not run, and
nobody downstream can tell — in a new costume. This is why `LegStatus` is a
three-arm discriminated union and not a boolean plus a nullable reason: a
two-state type cannot represent "did not run" as anything other than "ran
and passed" or "ran and failed", both of which are lies about a leg that
never executed. `GateResult.failed` is computed as "any leg reports `fail`" — `unavailable` never sets it, by construction, so an absent LSP install is never a reason to reject a change on its own, but it is always visible in the gate report for a human to read.

The legs run on the work repo's change, not on this harness, and each has its own availability rule. Changed paths come from `git diff`, relative to the git top level, so the legs (and `/review`'s file reader) resolve them from the top level even when Pi runs in a subdirectory of a monorepo:

| Leg | Runs when | Otherwise |
|-----|-----------|-----------|
| `typecheck` | a code file changed, a `tsconfig.json` exists at or above the cwd (up to the git top level), the project is trusted, the repo-local TypeScript is installed and the base tree did not already fail it | `unavailable` |
| `lint` | the project is trusted, an ESLint config (`eslint.config.{js,mjs,cjs,ts,mts,cts}`, `.eslintrc{,.js,.cjs,.json,.yml,.yaml}` or `package.json#eslintConfig`) exists at or above the cwd (up to the git top level), and a repo-local `eslint` binary; it runs from the directory holding that config with `--format json`; an error-severity message (or exit 1) is `fail`; `pass` needs at least one changed file ESLint actually linted | `unavailable`, including when ESLint ignored every changed file ("File ignored because ...") or printed no JSON report; any other non-zero exit is also `unavailable` |
| `lsp` | never | always `unavailable` |
| `anti-pattern` | a changed code file exists; only error-tier findings the base did not already have count | `pass` with nothing found |

**The `lint` leg runs the target repo's own ESLint** on the changed code files, passing the files after `--` so a name beginning with `-` cannot be read as a flag, with output bounded at 40 lines. It never runs without an ESLint config and a repo-local binary, and never on an untrusted project: a report of "no lint problems" from a linter that was not there is the failure this document exists to prevent.

**The LSP leg is `UNAVAILABLE` by a Pi API limit, not by an absent install.** A command or event context in Pi 1.1.0 has no `executeTool` (`dist/core/extensions/types.d.ts:262-280`: only a tool's own execute context carries it), so the gate cannot call `lsp_diagnostics`, and a registered tool is not a run. The probe (`probeLspAvailability`) still reads the live tool-name list and requires both `lsp_diagnostics` and `lsp_fix`, so the report names what is missing. Whether the model can reach a real language server through the tool path is the live half, `RB-08-02` in `docs/RUNBOOK.md`.

**The anti-pattern leg (QUAL-01) is syntax-only, never a type-checked
walk.** Its six rules (§2) parse with `ts.createSourceFile` and walk with
`ts.forEachChild`, never `ts.createProgram`/`getTypeChecker` and never
`String.match`. This is what keeps QUAL-02's wall-clock claim true rather
than merely asserted: parsing one file is cheap in a way type-checking a
whole program is not, measured at 300-390ms across every tracked
`.pi/extensions/*.ts` file, against a 1600ms budget set at roughly 4x the
worst observed run.

**QUAL-07's design-review pass is wired into `/review`, and it fires on signals, not on every run.** `shouldRunDesignReview` fires when the changed-file span reaches `DESIGN_REVIEW_FILE_SPAN` (8), an added line inside a loop body (the next 8 lines after a loop header) calls something query-like, a changed path matches schema, migration(s), models, `.prisma`, `.sql` or `.graphql`, an `export` line is added or removed in a JS/TS file, or the session is escalated. It returns `false` on an ordinary small task. When it fires, `design-review.ts` makes one extra reviewer call for complexity, scalability and abstraction-fit findings; the pass is additive and fails open, and a design BLOCKER goes through refute-or-promote like any other. REVIEW.md always carries a Design review section.

### Gate depth per workflow

This is the honest table: it lists what each workflow actually runs, not what the module could run.

| Workflow | Mechanisms that run |
|----------|---------------------|
| `quick` | deterministic |
| `execute` | deterministic |
| `grill` | none (SPEC validators only) |
| `plan` | none (PLAN validators only) |
| `review` | deterministic, model-review, refute-or-promote |

Calibration is offline only and is listed for no workflow. `runBoundedReviewLoop` is not credited anywhere.

## 2. The six anti-pattern rules (QUAL-01)

| Rule id | Tier | What it detects | Named false-positive scope |
|---------|------|------------------|------------------------------|
| `magic-number` | error | A numeric literal where a named constant belongs | Excludes `const` declarations — a literal being *assigned* to a named constant is the fix, not the violation |
| `literal-special-case` | **warning** | Special-casing on a specific literal input value | Honestly undecidable without type information; can never fail a build alone |
| `copy-paste` | error | Duplicated code shapes | — |
| `swallowed-exception` | error | A `catch` block that discards its error | Exempted by a `NEVER THROWS` marker convention for a deliberately empty catch |
| `shipped-todo` | error | A `TODO`/`FIXME`/`XXX`/`HACK`-shaped comment standing in for a real fix | — |
| `n-plus-one` | **warning** | A query call inside a loop | A caller-tunable callee allowlist; honestly undecidable without a real call graph; can never fail a build alone |

The two WARNING-tier rules (`literal-special-case`, `n-plus-one`) are
**only partially decidable without type information or a real call graph**,
and neither can ever flip `GateResult.failed` to true on its own —
`runAntiPatternLeg` only ever reaches `fail` when at least one ERROR-tier
finding exists; a warning-only run still reports its findings (tagged by
tier) inside a `pass` leg.

**The `tests/fixtures/**` exemption.** `SCAN_EXEMPT_PREFIXES` names
`tests/fixtures/` so that a corpus deliberately *built* out of these six
anti-pattern shapes (§6's seeded-defect corpus) is not itself flagged when
this repository's own source is swept. This exemption exists because a
fixture corpus's whole purpose is to contain the shapes these rules detect
— it is not a general escape hatch, and every fixture using it writes its
defective shape into an isolated temp-repo clone rather than at this
module's own top level, so the exemption is a belt on an already-safe
design, not the only thing keeping the corpus green.

## 3. The REVIEW artifact

`submit_review` is a forced structured tool call whose typebox schema
(`review-schema.ts`'s `submitReviewParameters`) **IS** the REVIEW
artifact's shape — Pi's own tool-call JSON-Schema validation rejects a
structurally wrong `severity` or `status` before `validateReview` ever
runs. The mandatory fields, enforced by the nine-branch, first-match-wins
`validateReview`:

- A per-requirement **verdict** (`Implemented`/`Partial`/`Missing`) covering
  every requirement id actually under review, in both directions — an
  unlisted requirement and an extra, un-requested one are both rejected.
- A mandatory, non-empty **"checked and cleared"** section, so silence is
  structurally impossible (GATE-04).
- Every finding classified **BLOCKER / WARNING / NIT** — an unclassified
  finding is rejected as malformed (GATE-05), never merely discouraged by
  prompt wording.
- A **classification** of the change as `root-cause` / `symptomatic` /
  `workaround`, with written justification (QUAL-04) — a `workaround`
  additionally requires `properFix` and `deferralReason` fields, so an
  approved workaround's debt is recorded rather than silent (QUAL-06).
- A **NIT cap** (`NIT_CAP = 5`), the anti-padding countermeasure to a
  reviewer told to find gaps and inventing trivial ones instead.

**A `file:line` string in a verdict's `evidence` or a finding's `location`
is EVIDENCE THE MODEL WROTE, not evidence the harness observed.** It is
shape-validated (matched against a `<path>:<digits>` pattern) and nothing
more — it could name a file that does not exist, a line that says nothing
of the sort, or a location nobody ever read. This is **not** equivalent to
`docs/WORKFLOWS.md`'s GATE-07 evidence, which trusts only a structural
`isError` boolean Pi's own tool-execution machinery computes from a real
process exit code, bound to a git SHA the harness read itself, and never
trusts model-authored text. No consumer of a validated `ReviewArtifact` may
treat `evidence` or `location` as a verified fact — only as the reviewer's
*claim* about where to look.

## 4. The anti-review-theatre protocol

Two-sided, because a reviewer told to find gaps can fail in either
direction:

- **Silent approval.** GATE-04's mandatory "checked and cleared" section
  and GATE-05's classification requirement make a bare "LGTM" structurally
  impossible to submit.
- **Invented findings.** `NIT_CAP` bounds low-value padding; **refute-or-
  promote** (`verdict.ts#runRefuteOrPromote`) is the countermeasure one
  severity tier up — every BLOCKER gets exactly **one** chance to be
  refuted by the SAME reviewing model, with the SAME context, before it can
  stop anything. Refute-or-promote applies to BLOCKERs **only** — a WARNING
  or NIT never enters this pass, which is enforced by filtering on
  `severity === "BLOCKER"` before any nested call is made, so the pass
  costs exactly one provider request per BLOCKER, never per finding.

The whole review/refute/re-review cycle is **bounded at two iterations**
(`MAX_REVIEW_ITERATIONS`), with **stall detection**: an iteration whose
promoted-BLOCKER set is identical to the previous iteration's terminates
the loop with its own distinct `"stalled"` outcome, never silently treated
as just another iteration. `runRefuteOrPromote` **fails safe**: a response
carrying no `refute_finding` tool call, or an out-of-enum outcome, counts
as `UPHELD` (the BLOCKER survives) — the opposite of the usual fail-closed
instinct, because the safer state here is the one where the BLOCKER still
stands.

## 5. Classification and the stop

`decideWorkflowStop` (QUAL-05/GATE-06) is a pure, numbered, first-match-wins
predicate over a **post-refutation** review — never the raw reviewer
output, since handing it raw findings would let a since-withdrawn BLOCKER
still stop the workflow:

1. Any BLOCKER surviving refutation stops WITHOUT an approval path, naming
   each `location` and `concreteFailure`, and the classification too when it
   is not `root-cause`. It comes first so a `symptomatic` or `workaround`
   label can never turn a surviving BLOCKER into an approvable stop.
2. `symptomatic` classification stops for approval, even with zero findings.
3. `workaround` classification stops for approval, quoting
   `properFix`/`deferralReason` directly in the stop message.
4. A Partial or Missing requirement verdict stops for approval, naming each
   requirement.
5. Otherwise, clear.

A WARNING or NIT never reaches branch (1) — that branch's own filter is
`severity === "BLOCKER"`. What a stop shows the user is never a bare
boolean: branch (1) names the specific surviving findings, and branch (3)'s
debt is quoted verbatim, so an approval is a decision about a stated fact,
not a rubber stamp. Because a BLOCKER stop is never approvable, the
"Open the MR anyway?" prompt in `/review` is only ever reached with no
surviving BLOCKER.

## 6. Calibration

`quality/calibration.ts#scoreCalibration` turns a reviewer's raw findings
into a **catch rate per defect class** — a raw ratio, never rounded, never
accompanied by a verdict string. It is deliberately the **third**,
separable artifact: the corpus (`tests/fixtures/seeded-defects/`), the
injection (`reviewer.ts#runReview` dispatching a reviewer against the
corpus), and the scoring are independently testable, so nothing that
produces a finding knows how it will be scored and nothing in the scorer
knows how a finding was produced — the countermeasure to a calibration
harness that can only ever report 100%.

The corpus is **six real, dated incidents from this project's own history**
(Phases 3-7), not invented off-by-ones, one per defect-class id
(`tests/fixtures/seeded-defects/index.ts`'s `DEFECT_CLASSES`):

| Defect-class id | Incident |
|------------------|----------|
| `fabricated-evidence` | Phase 6: an evidence gate accepted a fabricated completion claim through three rounds of green tests. |
| `tautological-test` | Phase 5: a wire-proof test that structurally could not distinguish a routing decision from a hardcoded chain head. |
| `escaped-side-effect` | Phase 5: a suite writing into the developer's real `~/.pi/agent/settings.json`. |
| `absent-guard` | Phase 4: a guard entirely absent from the real dispatch path while its unit tests passed. |
| `symptomatic-fix` | Phase 3: a "fix" that suppressed a failing assertion instead of addressing its cause. |
| `false-label` | Phase 7: a test labelled "MUTATION-VERIFIED" that survived its own mutation. |

**The number recorded so far — 2 of 6, catch rate 0.333... — is a SCRIPTED
faux reviewer's number, not a live model's judgement.** Its purpose is to
prove the pipeline (corpus → `runReview` → `validateReview` →
`scoreCalibration`) computes a real, reproducible, non-rounded number end
to end.

**WR3-02 disclosure (`08-REVIEW.md` iteration 3).** This fixture was
originally scripted to catch 3 of 6, including `false-label`. When WR2-05
raised the matcher's needle requirement from one to two (`bb2a67c`),
`false-label`'s finding text did not naturally contain a second needle, so
— in the SAME commit that raised the bar — it was extended with a phrase
lifted from the corpus's own `mustMentionAny` answer key, which kept the
reported 0.5 unchanged **by construction**, not by measurement; the
pre-edit text scores 2/6 = 0.333... under that same, already-raised bar.
The fixture has been reverted to its original, unmodified text
(`tests/integration/reviewer-calibration.test.ts`'s `KNOWN_SUBSET_ARGS`
and `KNOWN_SUBSET_CAUGHT`), and **2 of 6, 0.333..., is the honest number**:
the false-label finding is still submitted by the scripted reviewer (three
findings go in), but only two are credited as genuine catches by today's
matcher. This is not being re-inflated back toward 0.5 — the catch rate is
a measurement of what the current matcher, run against unedited fixture
text, actually reports, not a target to preserve across matcher changes.

Its purpose is proven further by FOUR required negative controls
(unaffected by the WR3-02 revert above, since none of them ever depended
on the `false-label` finding's text): a blind reviewer (approves
everything) scores
`catchRate: 0`; a shotgun reviewer (twenty generic findings, e.g.
"this area could probably be improved somehow") also scores `catchRate: 0`;
(WR-03) a **name-dropping shotgun** — one finding per touched file, naming
only that file's own most conspicuous symbol (`markMigrationComplete`,
`isGuardedCommand`, …) with no description of what is actually wrong — also
scores `catchRate: 0`; and (WR2-05, `08-REVIEW.md` iteration 2) a
**boilerplate kitchen sink** — ONE sentence, reused verbatim across all six
touched files, engineered to contain exactly one `mustMentionAny` phrase per
defect class — scores `catchRate: 0` too. The name-dropping control exists
because the first version of `tests/fixtures/seeded-defects/index.ts`'s
`mustMentionAny` needles were bare symbol names, trivially derivable from
"the file's only function" (five of the six fixture files contain exactly
one) without having understood the defect at all — that exact shape scored
`catchRate: 1.0` (6/6, having caught nothing) before the needles were
rewritten to describe the DEFECT's behaviour (e.g. `absent-guard`'s needle
is `"never calls isGuardedCommand"`, not bare `"isGuardedCommand"`). The
kitchen-sink control exists because that rewrite alone was still not enough:
`mustMentionAny` is an OR set, and an OR set is only as strong as its
weakest member — a single crafted sentence carrying one generic-sounding
phrase per class ALSO scored `catchRate: 1.0` having identified nothing,
until `findingCatches` was changed to require **two independent needles**
per expectation (`calibration.ts`'s `MIN_DISTINCT_NEEDLES`), not merely one.
**`findingCatches` is honestly a substring-match proxy for defect
identification, never a semantic one** — it requires the right file **and**
at least two of the phrases the corpus names as describing the specific
malformed *behaviour*, which is a stronger bar than a bare finding count or
the right identifier alone, but it is still pattern matching against known
text, not judgement.

(WR3-01, `08-REVIEW.md` iteration 3) The two-needle bar above did not close
the exploit, it only raised its price: a single sentence carrying TWO
needles per defect class, reused verbatim across all six touched files,
still scored `catchRate: 1.0` having identified zero defects — one measured
data point, not a ceiling: extending the same boilerplate by one more
phrase per class defeats the matcher just as the one-needle version did.
`findingCatches` was changed again to also reject a finding whose text
*also* independently clears a DIFFERENT, unrelated expectation's own
two-needle bar — a genuine finding about one file's one defect does not
organically use enough of a wholly different defect's vocabulary to catch
it too, which is exactly what a sentence reused across all six files must
do. A fifth permanent control, `TWO_NEEDLE_KITCHEN_SINK_ARGS`
(`tests/integration/reviewer-calibration.test.ts`), pins this: it now
scores `catchRate: 0`, and is kept alongside the blind/shotgun/name-drop/
kitchen-sink controls as a permanent regression test for this exploit
shape, not a claim that the substring-match approach has no further
exploit — the OR/AND-of-substrings axis this scorer is built on is not
exhausted by proving four constructions against it, and a live reviewer's
findings are never phrased to defeat any of this in the first place. **No
live reviewer, of any kind, has ever run against this corpus.** The live
calibration run is `RB-08-03` in `docs/RUNBOOK.md`, OUTSTANDING, and its
result is expected to differ from the scripted number in either direction,
since a live model was never tuned to this corpus the way the scripted one
was.

**CR3C-01 correction (`08-REVIEW-R3CHECK.md`).** The paragraph above's claim
— "a genuine finding about one file's one defect does not organically use
enough of a wholly different defect's vocabulary to catch it too" — was
**false** for two of the six classes, and for a narrower reason than the
cross-contamination rule itself: `tautological-test`'s needle set contained
`"cannot fail"` **and** `"structurally cannot"`, which are not independent
facts — the single phrase `"structurally cannot fail"` (this project's own
house vocabulary for this entire defect family; see `seeded-defects/
index.ts`'s own header and `CLAUDE.md`) satisfies both at once.
`escaped-side-effect` had the same shape (`"writes into the real"` +
`"developer's own home directory"`, both satisfied by one natural clause).
Two consequences: (1) a genuine, correctly-located finding carrying two of
its OWN class's needles could be wrongly rejected merely for ALSO containing
that phrase, because the phrase looked like it independently cleared
`tautological-test`'s own two-needle bar too — the exact failure mode the
paragraph above claims cannot happen; (2) the same three-word phrase, reused
verbatim across all six files with zero analysis, scored a non-zero
`catchRate` on its own, needing no answer-key access unlike the kitchen-sink
controls. **The fix is the needle sets, not the cross-contamination rule
itself** — `tests/fixtures/seeded-defects/index.ts`'s `tautological-test`
and `escaped-side-effect` entries now each carry four needles with no
shared word or substring between any pair (pinned corpus-wide by
`reviewer-calibration.test.ts`'s own needle-independence test), and the
cross-contamination rule is otherwise unchanged and still load-bearing (see
`TWO_NEEDLE_KITCHEN_SINK_ARGS` above, still `catchRate: 0` after this fix —
verified, not assumed). The corrected claim: cross-contamination catches a
finding that organically clears a DIFFERENT class's bar **only when that
class's own needles are genuinely mutually independent** — a property that
must hold for every expectation, is now pinned by a permanent test, and was
NOT true for two of six before this fix. A sixth permanent control (the
two generic phrases above, run through `scoreCalibration` directly) and a
regression test (a genuine `false-label` finding using the phrase
"structurally cannot fail" is credited, not rejected) both now pin this.
**The 2/6 = 0.333... number is unaffected** — neither fixed needle
participates in `KNOWN_SUBSET_ARGS`'s three scripted findings, and every
other control was re-verified to still score `catchRate: 0` after the
needle change.

## 7. The cost record

`qualityMs`/`qualityTokens` are two optional fields on `TurnRow`
(`.pi/extensions/diagnostics/schema.ts`), accumulated by a `globalThis`-keyed
ledger (`diagnostics/quality-cost.ts#addQualityCost`/`takeQualityCost`) that
sums every contribution within one turn (the deterministic gate stage, the
reviewer, the refute pass each contribute independently) and is drained
**exactly once**, by `diagnostics/index.ts`'s `turn_end` handler. The field
contract — the omission rule, and the distinction from `latencyMs` (`qualityMs`
is a **share** of the turn, `latencyMs` is the turn **total**, and the two are
not comparable without that distinction) — is stated once, in
`docs/DIAGNOSTICS.md`'s own turns-row field table; this document does not
restate it a second time to avoid the two drifting apart.

## 8. What this layer does NOT prove

Following `.pi/extensions/workflows/evidence.ts`'s own discipline of stating
plainly what a passing check does not cover:

- **No live reviewer has ever run.** Every `runReview` call in this
  repository's test suite drives a scripted `fauxProvider`. Whether a real
  DeepSeek/DashScope/Bedrock model, dispatched as this reviewer, catches a
  real defect is unmeasured — `RB-08-03`, OUTSTANDING.
- **The LSP leg has never executed against a real language server.** Its
  `UNAVAILABLE` state reflects an API limit (section 1), not a
  clean result — `RB-08-02`, OUTSTANDING.
- **The main-loop half of GATE-10's thinking budgets is unproved on the
  wire.** Plan 08-01 proved the *nested* path (reviewer, advisor, vision,
  summariser) sends the correct per-`model.api` thinking shape; the main
  loop's own dispatch (`pi.setModel()`) is a structurally different code
  path this repository does not control the internals of, and has never
  been read off a real wire dump — `RB-08-01`, OUTSTANDING.
- **A deterministic gate finding nothing means nothing was found by THESE
  rules** — not that the code is correct. The anti-pattern rules are
  syntax-only and carry no type information; a swallowed exception marked
  `NEVER THROWS`, a magic number assigned to a `const`, or a query call the
  n-plus-one allowlist exempts are all invisible to this stage by design,
  documented in each rule's own false-positive scope (§2), not hidden.
- **A validated `ReviewArtifact`'s `evidence`/`location` fields are claims,
  never verified facts** (§3) — a reviewer can cite a `file:line` that says
  nothing of the sort, and nothing in this layer checks that it does.
- **`consult_advisor` (GATE-09) changes nothing about the session's own
  model or turn count** — it is a nested, chokepoint-only call whose answer
  returns into the SAME executor turn; a refused consult (no configured
  candidate) costs zero requests and is never charged to the QUAL-09
  ledger.

## Entry-point notes (`quality/index.ts`, `quality/gates.ts`)

- **Live tool list through a closure on `globalThis`.** `pi.getAllTools()` exists
  only on `ExtensionAPI`, so the factory stores `() => pi.getAllTools().map(...)`
  under a `globalThis` key. Pi loads each entry point through its own module
  graph, so a module-level `let` would stay empty in the importer's copy; the
  shared function object does not.
- **`consult_advisor` is a tool, not a command.** The answer must return into the
  same executor turn; a command runs between turns. It is registered first in the
  factory, carries no per-tool prompt metadata (activating such a tool rebuilds
  the system prompt) and sets no `terminate`, since a consult continues the turn.
- **The production runner never names `npx`.** `npx` is `npx.cmd` on Windows and
  unspawnable without a shell; elsewhere an unpinned `npx <pkg>` downloads from
  the registry. `productionExec` resolves `node_modules/.bin/<name>` (walking up
  ancestors to the git top level, never past it, so a binary outside the
  trusted project is never run), refuses a `%` in the command line on Windows, and degrades to
  `unavailable` for a foreign `cwd` or an untrusted project.
- **Chokepoint hygiene.** `gates.ts` never reaches a model and never spells the
  bypass routes or the tool-registration call, even in comments; the raw-source
  lint tests grant `quality/` no exemption.
