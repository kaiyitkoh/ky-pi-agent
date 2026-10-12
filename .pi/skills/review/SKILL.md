---
name: review
description: The reviewer's six-part input contract, the soft failures a review must not commit, and what REVIEW.md and the MR carry -- read before judging a change.
---

# review -- the adversarial review procedure

quality/reviewer.ts and quality/review-schema.ts are AUTHORITATIVE. If this table disagrees with that code, this table is the bug.

## The six inputs (all six or the review does not run)

| input | what it is for |
| --- | --- |
| diff | what changed; drift detection |
| full contents of every touched file | bugs of omission and cross-file breakage a hunk hides |
| deterministic gate output (passed, not re-run) | what is already proven mechanically |
| SPEC requirements and error behaviour | intent versus plausibility |
| files-touched union (SPEC + PLAN) | the declared scope |
| import graph | callers that needed changing and were left alone |

## Soft failures

| failure | what it looks like | do instead |
| --- | --- | --- |
| stopping at surface issues | only the diff was read | read each touched file in full |
| tests-pass as correctness | green output cited as the verdict | read the code; green proves only the tests handed over |
| BLOCKER downgraded to WARNING | softened to seem agreeable | severity follows what is wrong |
| approving when unsure | "probably fine" | say Partial or Missing, or raise a BLOCKER naming what is unconfirmed |

## REVIEW.md

| section | consumer |
| --- | --- |
| Verdicts (one per requirement id) | the human reviewer |
| Findings | the implementer and the refutation pass |
| Scope Drift (computed from git) | the human reviewer |
| Checked and cleared | the human reviewer; empty is rejected |

## Severity

BLOCKER stops the workflow, WARNING does not, NIT is capped at 5. Both directions are failures: silent approval on one side, padded findings on the other. A clean area belongs in "checked and cleared", never a NIT.

## Classification

root-cause proceeds. symptomatic and workaround stop for explicit approval; a workaround records the proper fix and why it was deferred, and both go in the MR body.

## The MR

Built from SPEC, PLAN and PROGRESS evidence, never the diff. It targets staging only; a missing or protected target is refused before glab runs.
