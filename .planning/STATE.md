---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 01-07-PLAN.md — SAFE-16 /share control classifier
last_updated: "2026-08-13T00:46:11.855Z"
last_activity: 2026-08-13 -- completed 01-07 (SAFE-16 /share control classifier)
progress:
  total_phases: 11
  completed_phases: 0
  total_plans: 10
  completed_plans: 6
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-13)

**Core value:** A harness that makes a cheap model produce work you'd trust from an expensive one — without the harness itself becoming the bottleneck.
**Current focus:** Phase 01 — bootstrap-packaging-supply-chain

## Current Position

Phase: 01 (bootstrap-packaging-supply-chain) — EXECUTING
Plan: 7 of 10
Status: Ready to execute
Last activity: 2026-08-13 -- completed 01-07 (SAFE-16 /share control classifier)

Progress: [██████░░░░] 60%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 15m | 3 tasks | 10 files |
| Phase 01 P02 | 20m | 2 tasks | 6 files |
| Phase 01 P03 | 18m | 3 tasks | 3 files |
| Phase 01 P04 | 18m | 2 tasks | 2 files |
| Phase 01 P05 | 35m | 2 tasks | 3 files |
| Phase 01 P07 | 18m | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Horizontal layers in dependency order — `callModel()` is a Phase 2 export that Phases 5 and 8 import; routing cannot be verified without the instrument that proves which model ran.
- [Roadmap]: `ignore-scripts=true` precedes the first `pi install` (Phase 1). A pinning policy applied afterwards is applied to code that already ran.
- [Roadmap]: The prose-tool-call detector lives in Diagnostics (Phase 2), not Quality Gates — it is the leading root-cause candidate and it interacts with evidence-gating to fabricate evidence.
- [Roadmap]: Safety (Phase 4) depends on Phase 1 only, not on routing. GitLab server-side protected branches ship before any hook is trusted.
- [Roadmap]: A skeletal `/quick` is pulled forward to Phase 6 as a walking skeleton, exercising route → guard → execute → evidence → commit before any ceremonial workflow is built on it.
- [Phase 01]: .pi/npm ignored in contents form (.pi/npm/*) so !/.pi/npm/.npmrc can re-include the control file — git cannot re-include a file under an excluded directory
- [Phase 01]: peerDependencies stay at range * per docs/packages.md:171 — peers are jiti-aliased to Pi's bundled copies; the exact pin lives in devDependencies + package-lock.json
- [Phase 01]: git check-ignore needs --no-index, not just -q — the index masks ignore rules for tracked paths, which would have made the entire MUST_BE_COMMITTABLE half of the BOOT-09 test a vacuous pass
- [Phase 01]: test helpers throw rather than skip when a prerequisite binary is missing — a skipped load-path test is a green CI run that verified nothing
- [Phase 01]: on Windows a PATH stub cannot simulate gh SUCCESS inside Pi (Pi spawns gh with shell:false; Node returns EINVAL on .cmd since CVE-2024-27980) — write SAFE-16 as the not-authenticated assertion
- [Phase 01]: a negative control must be paired with a positive on the same fixture — case 4's no--a absence is only meaningful because adding -a and nothing else flips it back to present on the same fresh PI_CODING_AGENT_DIR
- [Phase 01]: PI_CODING_AGENT_DIR relocates trust.json (dist/config.js:397,412-418) — every load-path test uses a fresh one so verdicts come from the gate, not from this machine's saved decisions
- [Phase 01]: the sentinel extension registers a command and a dead-endpoint provider and never a tool — BOOT-10's boundary rule dogfooded on the first commit of real code
- [Phase 01]: npx and npm run export the resolved config as npm_config_* and npm ranks env above every .npmrc — supply-chain probes must strip npm_config_* or they measure the launcher, not the control
- [Phase 01]: user-scope npm hardening is asserted as a MECHANISM against a throwaway agent dir; the live machine-state check belongs to bin/bootstrap.sh --assert-hardening which has now been run for real on this machine (~/.pi/agent/npm/.npmrc exists, --assert-hardening exits 0)
- [Phase 01]: isPinnedPackageSpec is exported from tests/unit/pinning.test.ts for Phase 7 to import — no production module exists yet and a second regex is how the two drift apart
- [Phase 01]: bootstrap splits --check-only (CI, exits 0 on a clean runner) from --assert-hardening (the ordering proof, exits 1 there) — one flag cannot be both
- [Phase 01]: bootstrap strips npm_config_* before every npm query — run under npm/npx it would otherwise certify a control it never exercised, the same trap Plan 04 hit
- [Phase 01]: E404-token discrimination replaces RESEARCH's leading-quote-zero heuristic, which would misclassify any 1.x pin as unpublished
- [Phase 01]: the full bootstrap was run for real on this machine — ~/.pi/agent/npm/.npmrc now exists, so BOOT-01 user-scope is live-verified, not just mechanism-verified
- [Phase 01]: /share cannot be blocked by any extension — it is a literal-string match in the interactive submit handler (interactive-mode.ts:2902), dispatched before extension commands and before the input event; gh auth status exiting non-zero is the entire control
- [Phase 01]: dropping only the gist scope is a closed door — repo, read:org and gist are gh's documented non-removable minimum set, so gh auth logout is the only remedy
- [Phase 01]: SAFE-16's script ships --warn-only because gh is legitimately authenticated on the dev machine for git-over-HTTPS; CI and the dev box use it, the work-laptop runbook runs the script bare
- [Phase 01]: every stubbed-binary test case asserts the stub's own call log — without it a PATH-ordering mistake silently turns the suite into an assertion about the developer's real keyring

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

- **UNRESOLVED (R1)**: Whether DeepSeek-direct accepts `reasoning_effort: "low"`. Settled by one request in Phase 3 (PROV-07), gated behind Phase 2. Until then `/cheap` must not be defined in terms of a cheap thinking tier.
- **Root cause still open**: prose tool calls vs context pollution vs provider misconfiguration. Phase 2 measures, Phase 10 discriminates. Do not commit to a fix for an unmeasured cause.
- **No credentials on the dev machine**: 8 of 107 requirements are [RUNBOOK] and need the work laptop. `docs/RUNBOOK.md` (PROV-09, Phase 3) is the deliverable that carries them.
- **SAFE-16 is half-shipped, deliberately**: the classifier (`scripts/check-gh-unauthenticated.sh`) is proven in both directions, but the live control — `gh auth logout` on the work laptop — is **OUTSTANDING** and must never be reported as passed. `gh` stays authenticated on this dev box; it is how the repo is pushed over HTTPS. Runbook entry lands in Plan 10.
- **Moving platform**: Pi ships every 2–3 days; the composed extension ecosystem ships 13–16 releases/month. Every pin must be re-verified at Phase 7 planning time, not inherited from research.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Standing Operating Policy — Autonomous Run

Set by the user on 2026-08-13 before an unattended overnight run. **In force until the v1.0 milestone completes.**

1. **Delegate to subagents.** Planning, execution, and review run in spawned agents, not inline. The orchestrator context must stay lean across an 11-phase run — it will not survive otherwise.
2. **Code review after every phase**, in a spawned agent, checking end-to-end that no bugs or regressions were introduced. Not advisory: findings get fixed before advancing.
3. **Do not ask the user anything until the milestone is done.** Two standing pre-authorisations:
   - Verification `human_needed` caused by `[RUNBOOK]` items → build it, write the runbook entry, mark the live check **outstanding** (never "passed"), continue.
   - Verification `gaps_found` → this means something was genuinely *not built*, which is not the same as not-yet-verified-live and is **not** covered by the above. Close the gap; do not silently advance.
4. **Follow Pi's own documentation and bundled examples** over third-party blog posts or extension READMEs. Verify against published TypeScript (recoverable from `dist/**/*.js.map` `sourcesContent`) and cite `file:line`. Mark anything unverifiable as UNVERIFIED rather than asserting it.
5. **`workflow.skip_discuss` is `true`** — each phase uses its ROADMAP goal and success criteria as the spec. Grey-area implementation choices are at Claude's discretion, guided by the ROADMAP criteria and `.planning/research/`.
6. **Always pass `--research` to `plan-phase`.** Without it, `plan-phase` prompts "Research before planning Phase N?" whenever `RESEARCH.md` is missing — which is every phase. The flag forces research and skips the prompt. `nyquist_validation` requires `RESEARCH.md` anyway, so research must run regardless.
7. **UI gates are disabled deliberately** (`ui_phase`, `ui_safety_gate`, `ui_review` all `false`). GSD's frontend detector is a case-insensitive substring match on `UI|interface|frontend|component|layout|page|screen|view|form|dashboard|widget`, and **all 11 phases trip it** — Phase 1 matches because "package" contains "page". With the safety gate on, `plan-phase` exits outright on a phase with no `UI-SPEC.md`. Phase 11 is a *terminal* UI, not the web frontend the UI-SPEC contract is designed for, so the gate has nothing correct to contribute here. Do not re-enable.
8. **Do not ruminate.** The decisions are already made and written down. Agents implement PROJECT.md, ROADMAP.md and the research documents — they do not re-derive or re-litigate them. If a choice is genuinely open, pick the option consistent with the recorded decisions, note it in one line, and move on.

Everything the user cares about is already captured in PROJECT.md (Key Decisions, Constraints), REQUIREMENTS.md (107 requirements with `[FAUX]`/`[RUNBOOK]` tags), and ROADMAP.md (per-phase success criteria and Carried-Forward Unknowns). Those are the contract — build to them.

## Session Continuity

Last session: 2026-08-13T00:45:43.840Z
Stopped at: Completed 01-07-PLAN.md — SAFE-16 /share control classifier
Resume file: None

Next: `/gsd:autonomous` — Phase 1 has CONTEXT.md already, so it resumes at plan-phase.
