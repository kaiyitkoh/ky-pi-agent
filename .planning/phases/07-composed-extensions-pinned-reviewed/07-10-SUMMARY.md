---
phase: 07-composed-extensions-pinned-reviewed
plan: 10
subsystem: infra
tags: [supply-chain, npm, pi-install, security-gate, provenance]

requires:
  - phase: 07-composed-extensions-pinned-reviewed
    provides: "docs/EXTENSIONS.md (07-01) live-resolved package table; .pi/settings.json packages[] (07-09) the five-entry lockfile; tests/unit/pinning.test.ts's exported isPinnedPackageSpec (Phase 1)"
provides:
  - "A live-verified falsification of the install gate's own pre-authorisation: ground (a) ('no credentials on this dev machine') is FALSE -- AWS SSO/static admin keys confirmed present"
  - "A full read-only package-legitimacy review of all five pinned specs (version/license-file/source-shape/provenance/pushed_at/do-not-install cross-check), recorded in docs/EXTENSIONS.md's new Install reconciliation section"
  - "Proof that no install command of any kind ran in this plan (git history, .pi/npm/ contents, .pi/git/ absence)"
  - "An honest UNVERIFIED reconciliation verdict and an RB-07-02 handoff to plan 07-13, per the plan's own documented fallback -- never a fabricated MATCH"
affects: [07-11, 07-13]

tech-stack:
  added: []
  patterns: ["A pre-authorised checkpoint's stated grounds are individually re-verified live, not taken on faith, before the gate is treated as satisfied"]

key-files:
  created: []
  modified: [docs/EXTENSIONS.md]

key-decisions:
  - "The blocking human-verify gate (plan 07-10 Task 2) is recorded NOT SATISFIED. The user's pre-authorisation rested on three grounds; ground (a) ('this dev machine has no credentials') was verified rather than assumed and found FALSE -- `aws sts get-caller-identity --profile ADMIN_PROFILE` returned exit 0 with live static admin keys and an SSO cache present. A falsified ground voids the pre-authorisation; per the plan's own binding text this checkpoint is explicitly non-auto-approvable and outside the standing autonomous-run pre-authorisations (which cover [RUNBOOK] verification, not a supply-chain gate)."
  - "No install command of any kind (`pi install`, `npm install`, `npm i`, `pi update`) was run anywhere in this plan. Only read-only commands were used: `npm view` (registry metadata), `npm pack` + `tar -tf`/`tar -xf` into a scratch temp directory outside the repo (download + list/extract, no lifecycle scripts, no execution), and `gh api` (repository facts). The scratch directory was deleted after inspection."
  - "The reconciliation verdict is UNVERIFIED, per the plan's own documented fallback -- no `pi list` was ever run, so no MATCH or MISMATCH verdict is possible or written. `RB-07-02` is handed to plan 07-13 as a second, distinct OUTSTANDING runbook entry."
  - "Pinning re-verification reused the exported `isPinnedPackageSpec` from `tests/unit/pinning.test.ts` (imported via the pre-existing test's own live assertion against `.pi/settings.json`) rather than writing a second pinning regex, per this plan's explicit instruction."
  - "REQUIREMENTS.md already marks EXT-05 `[x] Complete` (set by plan 07-06, before any of the five npm-installed packages -- pi-subagents, pi-background-tasks, @narumitw/pi-lsp, pi-web-access, pi-session-finder -- were ever installed). This plan did NOT call `requirements mark-complete` for EXT-05 and does not silently endorse that prior mark: EXT-05's own wording ('...are available') requires the packages to actually be installed and available in a session, which has still never happened. Recorded here as a Blocker/Concern rather than corrected in REQUIREMENTS.md directly, since editing that file's requirement-status content is outside this plan's declared scope (`docs/EXTENSIONS.md` only) and outside what a single execution plan should silently overwrite."

requirements-completed: []

duration: ~40min
completed: 2026-08-15
---

# Phase 07 Plan 10: Install Gate Falsified — Legitimacy Review Performed, No Install Ran Summary

**The blocking human-verify install gate was found NOT SATISFIED after verifying its own pre-authorisation grounds (ground (a), "no credentials on this machine," is false -- live AWS SSO/static admin keys confirmed present); performed the full read-only package-legitimacy review anyway and recorded UNVERIFIED with an RB-07-02 handoff, per the plan's own documented fallback for when the install path cannot proceed.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-14T21:45:41Z (first hardening re-assertion)
- **Completed:** 2026-08-15T05:50Z (final verification pass)
- **Tasks:** 4 (Task 1 executed as written; Task 2 executed as a review only, gate recorded NOT SATISFIED; Task 3's install step not taken, its documented fallback taken instead; Task 4 executed as written)
- **Files modified:** 1 (`docs/EXTENSIONS.md`)

## Accomplishments

- **Task 1** — Re-asserted `sh bin/bootstrap.sh --assert-hardening` immediately before any review command. Exit 0, all three npm scopes (repo root, project `.pi/npm` prefix, user-scope `~/.pi/agent/npm` prefix) hardened. Timestamp `2026-08-14T21:45:41Z`.
- **Task 2 (review, not approval)** — Performed the full package-legitimacy review the gate exists for, on all five pinned specs, entirely via read-only methods (`npm view`, `npm pack` + `tar -tf`/`tar -xf` into a deleted scratch temp directory, `gh api`). Findings: all five versions resolve as the registry's current latest (no drift against the pin), all five tarballs ship a LICENSE file and reviewable `.ts` source (zero `dist/*.js`), all five repositories are non-archived and match the expected owner, none appears on the standing do-not-install list. Two `pushed_at` values moved since `07-01-SUMMARY.md`'s snapshot (`pi-subagents`, `pi-web-access`) — both are repository activity, not version bumps, and are recorded as drift rather than silently treated as agreement.
- **The gate itself was found NOT SATISFIED.** The user's pre-authorisation for this checkpoint rested on three stated grounds, each required to be verified rather than taken on faith. Ground (a) ("this dev machine has no credentials") was checked directly: `aws sts get-caller-identity --profile ADMIN_PROFILE` returned exit 0, resolving to account `ACCOUNT_ID`, `arn:aws:iam::ACCOUNT_ID:user/ADMIN_USER` — live, long-lived static admin keys in plaintext at `~/.aws/credentials`, plus an SSO cache. This falsifies the ground the pre-authorisation was built on. Per plan 07-10's own Task 2 text — binding and not open to re-litigation — this checkpoint is "NOT auto-approvable and must not be skipped on the strength of `workflow.auto_advance` or the autonomous-run policy." Because the user is unavailable and this run must not block waiting for them, the plan's mandated response was to record the falsified ground and take Task 3's own documented fallback, not to install.
- **Task 3 (fallback taken)** — No `pi install` of any kind was run. Confirmed via `git status --porcelain` (no `.npmrc`/`.pi/npm/.npmrc` modification anywhere in this plan), `.pi/npm/` contents (only the tracked `.npmrc`, no `node_modules/`), and `.pi/git/` absence (does not exist). Re-ran `sh bin/bootstrap.sh --assert-hardening` after the review — exit 0 again, timestamp `2026-08-14T21:48:15Z`. Ran `npx vitest run tests/unit/extension-pins.test.ts` (52 tests, exit 0) — its Direction 4 ("installed-but-undeclared") remains **unexercised against a real installed tree**, resolving through its documented "confirmed absent" branch because `.pi/npm/node_modules` and `.pi/git/` do not exist. Recorded plainly that this direction has never actually fired against real npm output, not claimed as proven.
- **Task 4** — Appended a `## Install reconciliation` section to `docs/EXTENSIONS.md` (189 lines) containing: the gate-outcome table (all three pre-authorisation grounds and their verification results), both hardening runs (before/after, both exit 0), the full five-package legitimacy evidence table, the do-not-install cross-check, the pinning re-verification (reused `isPinnedPackageSpec`, no second regex), an informal `.registerTool(` call-site count per package (explicitly deferred to `tests/unit/tool-count-baseline.test.ts` as the authoritative registry, no number substituted as a baseline), the UNVERIFIED reconciliation verdict, and the `RB-07-02` handoff to plan 07-13. No tool-count number was restated as an authoritative baseline, per the doc's own established discipline.
- Full verification suite re-run after the docs edit: `npx vitest run` — 90 files / 1541 tests, all green. `npx tsc --noEmit` — clean, exit 0.

## Task Commits

1. **Task 1: Re-assert the hardening immediately before review** — no commit (assertion-only per the plan's own file spec; output recorded in this SUMMARY and in `docs/EXTENSIONS.md`)
2. **Task 2: Package legitimacy gate (review, not approval)** — no commit (read-only registry/API/tarball reads only; gate outcome recorded in `docs/EXTENSIONS.md` and this SUMMARY, not a file the plan declares)
3. **Task 3: Fallback taken (no install attempted)** — no commit (no tracked file was written by this task; its findings feed Task 4's write)
4. **Task 4: Record the reconciliation in `docs/EXTENSIONS.md`** — `21613c4` (docs)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `docs/EXTENSIONS.md` — new `## Install reconciliation` section: gate-outcome table, both hardening runs, the five-package legitimacy evidence table, the do-not-install cross-check, the pinning re-verification, informal tool-call-site counts (deferred to Phase 11's authoritative baseline), the UNVERIFIED verdict, and the `RB-07-02` handoff.

## Decisions Made

See `key-decisions` in frontmatter. Summarized: (1) the install gate is recorded NOT SATISFIED because its own pre-authorisation ground (a) is verifiably false on this machine; (2) the legitimacy review was performed in full regardless, entirely read-only, because the review itself is valuable independent of whether an install follows; (3) no install command of any kind was run, verified from git/filesystem state, not merely asserted; (4) the reconciliation verdict is UNVERIFIED with an `RB-07-02` handoff, never a fabricated MATCH; (5) `isPinnedPackageSpec` was imported and reused rather than reimplemented; (6) EXT-05's prior `[x]` mark in `REQUIREMENTS.md` (set by plan 07-06, before any npm install ever ran) is flagged as a concern rather than silently endorsed or silently corrected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4 — architectural/gate decision, resolved by the orchestrator before this agent was spawned] The blocking human-verify gate was not satisfiable by this agent, and Task 3's install path was replaced by its own documented fallback**
- **Found during:** Task 2 (package legitimacy gate)
- **Issue:** Plan 07-10's Task 2 is a `checkpoint:human-verify` gated `blocking-human`, explicitly non-auto-approvable, requiring a live human to confirm five package identities before `pi install` runs. No human was available (overnight autonomous run). The user had pre-authorised passing this specific checkpoint on three stated grounds, but this agent's own instructions required each ground to be verified rather than assumed, and ground (a) ("this dev machine has no credentials") was found FALSE — live AWS SSO / static admin credentials are present. A falsified pre-authorisation ground does not carry, per the plan's own binding text.
- **Fix:** This was not an issue to "fix" — it is the deviation itself, resolved by the orchestrator's explicit mandate (recorded in this agent's own task instructions) to (a) perform the full legitimacy review Task 2 exists for, without approving or installing, (b) record the gate as NOT SATISFIED with the falsified ground stated verbatim, and (c) take Task 3's own documented fallback (record UNVERIFIED, hand off `RB-07-02`) rather than the install path. No package name, version, or `.pi/settings.json` content was altered.
- **Files modified:** `docs/EXTENSIONS.md` only (Task 4's declared file).
- **Verification:** `git status --porcelain` shows no `.npmrc`/`.pi/npm/.npmrc` change and no newly-tracked file under `.pi/npm/`/`.pi/git/`, at any point in this plan; `sh bin/bootstrap.sh --assert-hardening` exits 0 both before and after; `.pi/npm/` contains only the tracked `.npmrc`; `.pi/git/` does not exist.
- **Committed in:** `21613c4` (Task 4 commit — this is the only commit this plan produced).

---

**Total deviations:** 1 (Rule 4 — an architectural/gate-level deviation, resolved by the orchestrator's explicit prior instruction rather than re-litigated by this agent, per the "the gate decision ALREADY MADE do not relitigate" directive in this agent's own task).
**Impact on plan:** The plan's stated deliverable ("an installed, verified extension tree") was not produced. What was produced instead — a full read-only legitimacy review, an honestly falsified gate record, and an UNVERIFIED reconciliation with a named runbook handoff — is exactly what the plan's own Task 3 fallback text anticipates for the case where the install path cannot proceed, applied here because the blocking condition is a gate failure rather than a technical install failure.

## Issues Encountered

None beyond the gate-level deviation documented above. All read-only commands (`npm view`, `npm pack`, `tar`, `gh api`) executed cleanly; no network or tooling failures.

## User Setup Required

**This is the item that matters most in this SUMMARY.** `RB-07-02` (a new, second Phase 7 runbook entry, distinct from `RB-07-01`) must be appended to `docs/RUNBOOK.md` by plan 07-13 and marked **OUTSTANDING**. It covers:

1. Running `pi install` for the five pinned specs (`npm:pi-subagents@0.49.0`, `npm:pi-background-tasks@2.4.2`, `npm:@narumitw/pi-lsp@0.49.4`, `npm:pi-web-access@0.22.0`, `npm:pi-session-finder@0.5.6`) with a human physically present to satisfy the package-legitimacy gate, on a machine whose real credential exposure is now known and accepted (rather than assumed absent).
2. Capturing and reconciling `pi list` output against `.pi/settings.json`'s `packages[]` array for the first time — this has never been done in this repository.

Separately: `REQUIREMENTS.md` currently marks `EXT-05` `[x] Complete` (set by plan `07-06`), but the packages that requirement names as "available" have never been installed. This plan did not correct that mark (out of this plan's declared file scope), but flags it here for the user or a future plan to reconcile — `EXT-05` should arguably read `[~]` Partial with `RB-07-02` named inline, matching this project's own established convention for every other `[RUNBOOK]`-gated requirement (`PROV-03/04/06/07/10`, `ROUTE-11`, `SAFE-01`).

## Next Phase Readiness

Plan 07-11 (tool-count baseline) can proceed — it does not depend on an installed tree; it measures against the same pinned tarball contents this plan already confirmed are `.ts` source with LICENSE files. Plan 07-13 must append `RB-07-02` to `docs/RUNBOOK.md`, alongside the already-outstanding `RB-07-01`, and should consider whether `EXT-05`'s current `[x]` mark needs revising to `[~]` given neither RB-07-01 nor RB-07-02 has run. No install-blocking technical issue exists — the blocker is exclusively the unmet human-verification gate, which requires a human physically present with knowledge of this machine's real credential exposure.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: .planning/phases/07-composed-extensions-pinned-reviewed/07-10-SUMMARY.md
- FOUND: docs/EXTENSIONS.md
- FOUND: 21613c4 (docs(07-10) commit)
