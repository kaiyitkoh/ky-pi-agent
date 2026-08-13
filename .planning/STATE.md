---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 02-02-PLAN.md — BOOT-05 layout gate discriminates entry points from modules; the redactor lands, proven both directions and bounded
last_updated: "2026-08-13T04:13:16.163Z"
last_activity: 2026-08-13 -- Phase 02 Plan 02 complete (layout-gate discriminator + redactor)
progress:
  total_phases: 11
  completed_phases: 1
  total_plans: 21
  completed_plans: 12
  percent: 57
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-13)

**Core value:** A harness that makes a cheap model produce work you'd trust from an expensive one — without the harness itself becoming the bottleneck.
**Current focus:** Phase 02 — diagnostics-the-instrument

## Current Position

Phase: 02 (diagnostics-the-instrument) — EXECUTING
Plan: 3 of 11
Status: Executing Phase 02
Last activity: 2026-08-13 -- Phase 02 Plan 02 complete (layout-gate discriminator + redactor)

Progress: [██████░░░░] 57% (12 of 21 plans complete)

**Read that 57% carefully.** The denominator is *plans written so far* — Phase 1's
10 plus Phase 2's 11. Phases 3-11 are not yet planned, so it will grow and the
percentage will fall. The honest phase-level figure is **1 of 11 phases complete**.

## Performance Metrics

**Velocity:**

- Total plans completed: 10
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 10 | - | - |

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
| Phase 01 P06 | 30m | 2 tasks | 4 files |
| Phase 01 P08 | 22m | 2 tasks | 3 files |
| Phase 01 P09 | 20m | 2 tasks | 2 files |
| Phase 01 P10 | 25m | 3 tasks | 3 files |
| Phase 02 P01 | 20m | 3 tasks | 4 files |
| Phase 02 P02 | 12m | 3 tasks | 3 files |

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
- [Phase 01]: sanitise_npm_env must match npm_config_ case-INSENSITIVELY — a Node test runner upper-cases the keys and Windows env names are case-insensitive, so the lower-case-only strip made --assert-hardening report true for an empty directory
- [Phase 01]: execution order is proven by a recorded argv log, never by reading the script — and every ordering comparison is preceded by non-emptiness assertions, since Math.max of an empty array is -Infinity and Math.min is Infinity
- [Phase 01]: the stub npm answers argv-conditionally (StubSpec.match) rather than answering true to all four questions — a stub that answers true to 'npm view ... version' would let a version-gate regression pass unseen
- [Phase 01]: CI action SHAs are resolved live with gh api repos/<o>/<r>/commits/<tag> --jq .sha, never transcribed — actions/checkout@3d3c42e (v7.0.1), actions/setup-node@8207627 (**v7.0.0**). Corrected 2026-08-13 by code review CR-03: the setup-node comment shipped as v5.0.0 and the "resolved live" claim was false for it — v5.0.0 is a0853c24, and 8207627 is tagged v7.0.0/v7. A tag comment that no test checks is a claim, not a pin, so ci-pinning.test.ts now holds an explicit (SHA, tag) table and posix-lint re-resolves every comment through the API
- [Phase 01]: posix-lint is a separate ubuntu-latest job, not a matrix step — shellcheck is preinstalled only there, and sh execution cannot prove POSIX conformance since Git-Bash sh and macOS /bin/sh are both bash in POSIX mode
- [Phase 01]: no line-ending fix-up step in CI — .gitattributes eol=lf is the fix and the node CR-byte scan is the proof; a git config step would mask a broken .gitattributes
- [Phase 01]: the CI lint reads ci.yml as TEXT — yaml exists only transitively under Pi, and declaring it would break pinning.test.ts's exactly-six-devDependencies assertion
- [Phase 01]: the three BOOT-10 source facts were re-verified in Pi 0.84.1's recovered TypeScript, not inherited — convertTools at openai-completions.ts:1337-1372 is called at :731, system-prompt.ts's only 'command' hit is preamble prose at :121, and skills.ts:350-356 emits name/description/location only
- [Phase 01]: the registerTool scan is a plain substring per 01-VALIDATION's BOOT-10 wording — it survives bracket access and aliasing, at the cost that extensions may not name the call even in a comment
- [Phase 01]: TOOL_REGISTRATION_ALLOWLIST is empty and named so a later phase extends it with an (a)/(b)/(c) justification instead of deleting the test
- [Phase 01]: the npm_config_ignore_scripts persistence hazard cites bash.ts:105 + shell.ts:122-134 (the bash tool spreads process.env) — package-manager's getEnv() is private and covers only Pi's own npm spawns
- [Phase 01]: a runbook status is parsed from BOTH the summary table and the detail subsection and the two must agree — a half-flip returns INCONSISTENT, because updating the skim-able table and forgetting the subsection is the likeliest real failure and would otherwise leave two contradictory answers with no signal
- [Phase 01]: the outstanding-status parser is asserted against a PASSED fixture as well as an OUTSTANDING one — without the PASSED case, asserting OUTSTANDING on the real file is a tautology that passes whatever the file says
- [Phase 01]: docs/RUNBOOK.md is created in Phase 1 though PROV-09 (Phase 3) owns it — the ownership is stated inline so Phase 3 appends rather than rewrites, and the three Phase 1 checks are not lost in between
- [Phase 01]: the README's 'not covered' clause is asserted case-sensitively — Task 1's own case-insensitive regex passed against the capitalised heading while the prose instance was split across a line break, i.e. present in spirit and absent as a string
- [Phase 02]: fauxProvider never calls onPayload (pi-ai faux.ts:510) so before_provider_request never fires under a plain faux session — tests/helpers/faux.ts wraps the provider to emit it at the adapter position, and every capture test must assert captured.length > 0 before asserting content
- [Phase 02]: the extension under test loads at USER scope (<agentDir>/extensions/<name>/index.ts) — project-scoped .pi/extensions is gated behind project trust, which resolves false headless with no UI to answer it
- [Phase 02]: the faux session cwd is always a temp dir outside this repo — from inside it Pi walks up and loads the 49 KB CLAUDE.md into every faux request (12,725 input tokens for a one-word prompt), so any token measurement would be measuring the harness
- [Phase 02]: two JSONL readers, not one — readTornSafe reports a torn line as data because DIAG-08 is a measurement, and readJsonl throws so a writer bug in a test-authored file stays loud; the difference is asserted on the same fixture
- [Phase 02]: an extension entry point is a file with a default export at statement position — the BOOT-05 layout gate now partitions .pi/extensions/ into entry points (must sit at an auto-discovered path) and imported modules (must sit under <dir>/), closing PATTERNS blocker B1 without widening the regex
- [Phase 02]: the wire payload never carries the API key (RESEARCH §1.3, 12 verified onPayload call sites) — so the redactor matches secret-SHAPED values as well as credential-named header keys; the real hazard is a .env or *.tfstate the model read into messages[]
- [Phase 02]: a word boundary is added to the sk- and pt- patterns only, against RESEARCH's literal list — risk-assessment-documents is sk- plus 24 token characters, and a redactor that mangles ordinary paths fails DIAG-07's negative control as surely as one that leaks
- [Phase 02]: DIAG-07 stays Pending after plan 02-02 — the requirement names redaction at capture AND gitignored paths, and this plan ships only the redactor; nothing calls it until wire.ts (02-05)

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

- **UNRESOLVED (R1)**: Whether DeepSeek-direct accepts `reasoning_effort: "low"`. Settled by one request in Phase 3 (PROV-07), gated behind Phase 2. Until then `/cheap` must not be defined in terms of a cheap thinking tier.
- **Root cause still open**: prose tool calls vs context pollution vs provider misconfiguration. Phase 2 measures, Phase 10 discriminates. Do not commit to a fix for an unmeasured cause.
- **No credentials on the dev machine**: 8 of 107 requirements are [RUNBOOK] and need the work laptop. `docs/RUNBOOK.md` (PROV-09, Phase 3) is the deliverable that carries them. **The file now exists** — Phase 1 created it in Plan 10 with its own section; Phase 3 appends rather than rewrites.
- **Three Phase 1 checks are OUTSTANDING and machine-enforced as such**: `RB-01-01` (SAFE-16, `gh auth logout` on the work laptop), `RB-01-02` (BOOT-02, `pi install` against the real URL on a clean profile), `RB-01-03` (BOOT-05, `/reload` in a TTY). Each is recorded in `docs/RUNBOOK.md` with its exact command, expected output and offline proxy. `tests/unit/docs-policy.test.ts` parses both the summary table and the detail subsection and fails if either is flipped to passed, or if the two disagree. Flipping one requires a human to have executed it and must be a deliberate edit in the same commit as the test change.
- **SAFE-16 is half-shipped, deliberately**: the classifier (`scripts/check-gh-unauthenticated.sh`) is proven in both directions, but the live control — `gh auth logout` on the work laptop — is **OUTSTANDING** and must never be reported as passed. `gh` stays authenticated on this dev box; it is how the repo is pushed over HTTPS. Runbook entry is `RB-01-01`.
- **BOOT-07's live CI run is OUTSTANDING**: `.github/workflows/ci.yml` exists, is valid YAML, and is statically proven (both action SHAs resolved against the GitHub API, matrix `[windows-latest, macos-latest]`, `fail-fast: false`, every execution step asserted by `tests/unit/ci-pinning.test.ts`). It has **never run** — GitHub Actions cannot be triggered from this machine. macOS behaviour, ShellCheck's verdict on the two tracked scripts, and whether the pinned global Pi install satisfies the load-path tests on a runner are all unverified until the first push. Do not report a green tick that does not exist. **It has no `docs/RUNBOOK.md` entry yet** — Plan 10 seeded only the three checks its plan named. A later phase should add it alongside `RB-01-01..03`.
- **`shellcheck` is not installed on this machine**: full `--shell=sh` conformance of `bin/bootstrap.sh` and `scripts/check-gh-unauthenticated.sh` is UNVERIFIED locally. Narrowed by code review WR-07: `/usr/bin/dash` IS present (Git for Windows ships it) and is a genuine POSIX shell rather than bash in POSIX mode, so `tests/unit/lf-and-shell.test.ts` now parses every tracked `*.sh` with `dash -n` in addition to the four-construct bashism regex. Both scripts pass. A parse is not a lint — unquoted expansions and BSD-vs-GNU flag differences still need the Ubuntu `posix-lint` job, which has never run.
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

Last session: 2026-08-13T04:13:16.154Z
Stopped at: Completed 02-02-PLAN.md — BOOT-05 layout gate discriminates entry points from modules; the redactor lands, proven both directions and bounded
Resume file: None

Next: `/gsd:autonomous` — Phase 1 has CONTEXT.md already, so it resumes at plan-phase.
