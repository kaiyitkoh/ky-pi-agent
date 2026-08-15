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
`quality/`. Phase 9 wires `verdict.ts`'s stop signal and `reviewer.ts`'s
dispatch into a real ceremonial workflow (QUAL-08); nothing in this
directory does that yet.

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
never executed. `GateResult.blocking` is computed as "any leg reports
`fail`" — `unavailable` never sets it, by construction, so an absent LSP
install is never a reason to stop `/quick` on its own, but it is always
visible in `GateResult.report` for a human to read.

**The `lint` leg is a named, exhaustive set, never a directory glob.**
`LINT_GATE_FILES` names this repository's own twelve structural vitest
suites explicitly (`chokepoint-lint`, `contributing-boundary`,
`jsonl-append-only`, `extension-layout`, `pinning`, `gitignore-policy`,
`docs-policy`, `npmrc-policy`, `secret-scan`, `ci-pinning`, `lf-and-shell`,
`evasion-corpus`) — this project has no ESLint or other linter installed
(`tests/unit/pinning.test.ts` pins exactly six audited `devDependencies`),
so "lint" here means these named suites and never silently grows to mean
"the whole unit test tree."

**The LSP leg's real state on this machine, today: `UNAVAILABLE`.**
`probeLspAvailability` reads the live, registered tool-name list — never
`.pi/settings.json`, which lists what is *pinned*, not what is *loaded* —
and requires **both** `lsp_diagnostics` and `lsp_fix` to be present, naming
whichever is missing rather than collapsing to a bare boolean.
`@narumitw/pi-lsp@0.49.4` is pinned in `.pi/settings.json` and has never
been installed, so this leg has never reported anything but `UNAVAILABLE`
in this repository. Whether it reports `FAIL` against a real type error,
once the package and a real language server are both present, is
`RB-08-02` in `docs/RUNBOOK.md`, OUTSTANDING.

**The anti-pattern leg (QUAL-01) is syntax-only, never a type-checked
walk.** Its six rules (§2) parse with `ts.createSourceFile` and walk with
`ts.forEachChild`, never `ts.createProgram`/`getTypeChecker` and never
`String.match`. This is what keeps QUAL-02's wall-clock claim true rather
than merely asserted: parsing one file is cheap in a way type-checking a
whole program is not, measured at 300-390ms across every tracked
`.pi/extensions/*.ts` file, against a 1600ms budget set at roughly 4x the
worst observed run.

**QUAL-07's design-review predicate lives here too, and it is a predicate,
not a call.** `shouldRunDesignReview` decides *whether* a design-level pass
should fire — on a diff spanning many files (`DESIGN_REVIEW_FILE_SPAN`, an
explicitly untuned constant Phase 9 owns dialing), a loop wrapping a query,
a data-model or public-interface change, or an explicit `/escalate` — and
returns `false` on an ordinary small task. It never touches a reviewer
itself; nothing in `quality/gates.ts` makes the design-review call.

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
and neither can ever flip `GateResult.blocking` to `fail` on its own —
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

1. `symptomatic` classification stops, regardless of findings.
2. `workaround` classification stops, quoting `properFix`/`deferralReason`
   directly in the stop message.
3. Any BLOCKER surviving refutation stops, naming its `location` and
   `concreteFailure`.
4. Otherwise, clear.

A WARNING or NIT never reaches branch (3) — that branch's own filter is
`severity === "BLOCKER"`. What a stop shows the user is never a bare
boolean: branch (2)'s debt is quoted verbatim, and branch (3) names the
specific surviving finding, so approval is a decision about a stated fact,
not a rubber stamp.

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

**The number recorded so far — 3 of 6, catch rate 0.5 — is a SCRIPTED faux
reviewer's number, not a live model's judgement.** It was scripted to catch
exactly three of six, and its purpose is to prove the pipeline (corpus →
`runReview` → `validateReview` → `scoreCalibration`) computes a real,
reproducible, non-rounded number end to end — proven further by two
required negative controls: a blind reviewer (approves everything) scores
`catchRate: 0`, and a shotgun reviewer (twenty generic findings) also scores
`catchRate: 0` because `findingCatches` requires both the right file **and**
a specific, named mention, not merely a high finding count. **No live
reviewer, of any kind, has ever run against this corpus.** The live
calibration run is `RB-08-03` in `docs/RUNBOOK.md`, OUTSTANDING, and its
result is expected to differ from 3/6 in either direction, since a live
model was never tuned to this corpus the way the scripted one was.

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
  `UNAVAILABLE` state on this machine reflects an absent install, not a
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
