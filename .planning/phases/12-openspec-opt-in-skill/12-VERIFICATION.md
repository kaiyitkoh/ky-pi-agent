---
phase: 12-openspec-opt-in-skill
verified: 2026-10-13T00:00:00Z
status: human_needed
score: 4/4 must-haves verified (automated); 4 runbook items outstanding
overrides_applied: 0
human_verification:
  - test: "RB-12-01 install and setup on work laptop and macOS"
    expected: "openspec 1.13.2, scripts/openspec-setup.sh --check exits 0"
    why_human: "Other machines and OS"
  - test: "RB-12-02 live Pi session: /budget skills slice unchanged; /skill:openspec-explore and /opsx-explore expand"
    expected: "Zero per-turn growth, both commands expand"
    why_human: "Needs interactive Pi session and credentials"
  - test: "RB-12-03 telemetry egress under network capture"
    expected: "No edge.openspec.dev requests"
    why_human: "Network capture"
  - test: "RB-12-04 upgrade drill at next version bump"
    expected: "Documented upgrade path works"
    why_human: "Requires a future version bump"
---

# Phase 12: OpenSpec Opt-in Skill Verification Report

**Goal:** OpenSpec's official skills are available on demand (`/skill:openspec-*`) without costing per-turn tokens or weakening Phase 9's code-enforced gates.
**Status:** human_needed (no automated gaps)

## Success Criteria (OSPEC-1..4)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | CLI pinned to exact reviewed version, telemetry off | VERIFIED | `openspec --version` prints 1.13.2. `scripts/openspec-setup.sh` has the single pin `OPENSPEC_VERSION="1.13.2"`. `.pi/extensions/harness/index.ts:24` forces `OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`, `OPENSPEC_NO_UPDATE_CHECK=1` and `OPENSPEC_NO_AUTO_CONFIG=1` into process.env. Real egress is RB-12-03. |
| 2 | Skills at user level with `disable-model-invocation: true`, none in repo `.pi/` | VERIFIED | 12 `~/.pi/agent/skills/openspec-*/SKILL.md` exist and all carry the flag (`grep -L` found no file lacking it). 12 `opsx-*` prompts are in `~/.pi/agent/prompts`. Repo `.pi/skills` holds only pre-existing grill, plan-ceremony and review, with no openspec content. The zero-cost proof is `tests/integration/openspec-zero-cost.test.ts`. The live-session confirmation is RB-12-02. |
| 3 | Guard classifies openspec correctly, `openspec/` stays out of the repo | VERIFIED | The openspec arm is in `.pi/extensions/safety/infra.ts` and `shell.ts`. `tests/unit/infra-policy.test.ts` passes (241 tests with the gitignore test): read-only and archive allow, mutators and unknown verbs confirm. `.gitignore:181` has the rooted `/openspec/`, and `git check-ignore` confirms it. `git ls-files` lists no `openspec/` tree. |
| 4 | Bootstrap/runbook documents install and upgrade, openspec-pi evaluated | VERIFIED | `docs/OPENSPEC.md` has a "Why not `openspec-pi@0.2.1`" section. `scripts/openspec-setup.sh --check` printed "OK: openspec 1.13.2, 12 skills and 12 prompts installed" and exited 0. RUNBOOK has Phase 12 with RB-12-01..04 OUTSTANDING. `tests/unit/openspec-docs.test.ts` passes. |

## Checks Run
- `openspec --version` printed 1.13.2.
- `sh scripts/openspec-setup.sh --check` exited 0.
- Targeted vitest run: openspec-docs, openspec-env, openspec-skills (12 tests), infra-policy and gitignore-policy (241 tests). All passed.
- The orchestrator's full-suite run at 71131a0 (149 files, 2974 passed) is taken as given.
- No TBD/FIXME/XXX markers in `scripts/openspec-setup.sh`. The git tree is clean apart from an unrelated untracked research file.

## Gaps
None.

## Notes
- ROADMAP.md still shows 12-04 unchecked and "3/4 plans executed". The plan's artifacts exist (docs, runbook, real install), so this is a stale checkbox and not a code gap. The orchestrator should tick it.
- The review-fix changes (broadened wrapper grammar, lowered safety budget) are covered by the passing infra-policy corpus.
- Human items are the four outstanding runbook entries, which need a live Pi session, other machines, a network capture, or a future version bump.
