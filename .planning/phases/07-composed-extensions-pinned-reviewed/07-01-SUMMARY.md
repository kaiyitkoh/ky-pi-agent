---
phase: 07-composed-extensions-pinned-reviewed
plan: 01
subsystem: infra
tags: [supply-chain, pinning, npm, docs, provenance]

requires:
  - phase: 01-bootstrap-supply-chain
    provides: "ignore-scripts hardening, bin/bootstrap.sh --assert-hardening, isPinnedPackageSpec"
provides:
  - "docs/EXTENSIONS.md — the phase's provenance record for every pin the remaining 12 plans in Phase 7 depend on"
  - "Live re-verification, at execution time, of six package versions/licenses/repositories against the npm registry, GitHub API and packed tarballs"
  - "Confirmed hardening precondition satisfied before any install task in the phase"
affects: [07-02, 07-03, 07-04, 07-05, 07-06, 07-07, 07-08, 07-09, 07-10, 07-11, 07-12, 07-13]

tech-stack:
  added: []
  patterns: ["Re-verify every pin live at execution time rather than trust a research document", "npm pack + tar -tf as the sanctioned LICENSE-file audit technique (never npm install)"]

key-files:
  created: [docs/EXTENSIONS.md]
  modified: []

key-decisions:
  - "All six re-checked packages (pi-subagents, pi-background-tasks, @narumitw/pi-lsp, pi-web-access, pi-session-finder, pi-loop-police) are UNCHANGED in version against 07-CONTEXT.md's 2026-08-15 table — no drift in the hours since context generation"
  - "pi-loop-police's GitHub API license is re-confirmed null and its tarball re-confirmed to ship no LICENSE file — EXT-10 vendoring requirement stands, not silently reversed"
  - "Vendored items sit FLAT under .pi/extensions/ (decision D-07-D), never under a vendor/ parent — cited against tests/unit/extension-layout.test.ts:58's NESTED_INDEX regex, which supersedes 07-RESEARCH.md's suggested vendor/ subdirectory layout"
  - "pi-web-access is the only installed package carrying genuine transitive caret-range residuals (8 dependencies, including a third uncontrolled typebox instance); pi-subagents' and pi-background-tasks' own dependencies are exact pins, recorded as a second-module-instance risk marked UNVERIFIED per decision 5"

requirements-completed: [EXT-06, EXT-08, EXT-10]

duration: ~20min
completed: 2026-08-14
---

# Phase 07 Plan 01: Hardening Assertion and Live Pin Re-Verification Summary

**Ran the BOOT-01 hardening assertion for real (exit 0, three scopes certified), then re-resolved version/license/repository/lifecycle-script facts live for all six Phase 7 candidate packages via npm view, gh api and npm pack + tar -tf, and committed the results as docs/EXTENSIONS.md.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-14T19:09:39Z (first hardening run)
- **Completed:** 2026-08-14T19:14:31Z (post-verification)
- **Tasks:** 3
- **Files modified:** 1 created (`docs/EXTENSIONS.md`)

## Accomplishments

- `sh bin/bootstrap.sh --assert-hardening` run for real from the repo root before any registry command in this plan — exited 0, certifying all three `ignore-scripts` scopes (repo root, project `.pi/npm` prefix, user-scope `~/.pi/agent/npm` prefix). This is the ordering control that makes every later install task in Phase 7 safe: `pi install` runs npm lifecycle scripts, and no install may proceed against a machine that has not first been proven hardened.
- Re-resolved, live, in this session: version, license, repository URL, `dependencies`, `peerDependencies`, all three lifecycle-script fields, `time.modified`, `dist.fileCount` and `dist.unpackedSize` for `pi-subagents`, `pi-background-tasks`, `@narumitw/pi-lsp`, `pi-web-access`, `pi-session-finder`, `pi-loop-police` via `npm view`.
- Re-resolved, live, GitHub `stargazers_count`, `pushed_at`, `archived` and `license.spdx_id` for all six repositories via `gh api`.
- Ran `npm pack <pkg>@<version>` + `tar -tf | grep -i licen` for all six in a scratch temp directory (never this repo, never `~/.pi`) to re-establish LICENSE-file presence from the tarball itself, then deleted the scratch directory.
- Wrote `docs/EXTENSIONS.md` (245 lines) with all seven required sections: Verification provenance, Installed packages, Vendored (not depended on), Dropped (with reasons), Known Pin Residuals, Worktree isolation (accepted residual), Download counts are not evidence.

## Task Commits

Tasks 1 and 2 were live command runs with no file output (per the plan's own file spec: `(none — assertion only)` / `(none — registry/API reads and $TMPDIR inspection only)`); their findings are recorded in this SUMMARY and in `docs/EXTENSIONS.md`'s Verification provenance section rather than a separate commit. Task 3 is the plan's only committable artifact:

1. **Task 1: Assert the hardening** — no commit (assertion-only, output recorded above and in `docs/EXTENSIONS.md`)
2. **Task 2: Re-resolve every version, license and repository fact live** — no commit (registry/API/tarball reads only, findings recorded in `docs/EXTENSIONS.md`)
3. **Task 3: Write docs/EXTENSIONS.md** — `1efdc93` (docs)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `docs/EXTENSIONS.md` — the phase's committed provenance record: re-verified pin table, LICENSE-file audit, vendoring decisions (with the D-07-D flat-placement citation), the drop list with architectural reasons, known transitive pin residuals, the accepted worktree `node_modules` junction residual, and the CDN-cached download-count finding.

## Decisions Made

- All six re-checked package versions are **UNCHANGED** against `07-CONTEXT.md`'s 2026-08-15 table. No MOVED row was found — the re-verification confirms stability at this specific execution moment, while `docs/EXTENSIONS.md` states plainly that any future bump must re-run the same commands rather than trust this file.
- `pi-loop-police`'s no-LICENSE-file finding is **re-confirmed independently** (GitHub API `license: null`, tarball listing carries no `LICENSE`/`LICENCE` entry) rather than assumed from the research document — EXT-10 vendoring stands unchanged.
- Vendored items are placed FLAT under `.pi/extensions/` per the already-settled decision D-07-D, not under a `vendor/` parent as `07-RESEARCH.md`'s Recommended Project Structure suggested — this is recorded explicitly in `docs/EXTENSIONS.md` with the `tests/unit/extension-layout.test.ts:58` citation, so a later plan in this wave does not silently reintroduce a nested layout `/reload` cannot pick up.
- No `npm install`, `pi install`, or `slopcheck install` was run anywhere in this plan — `npm pack` (download only, no lifecycle scripts) plus `tar -tf` (list only, no extraction) was the sole tarball-inspection mechanism, per `07-VALIDATION.md`'s sanctioned technique and Pitfall 5's warning that `slopcheck install` is not a dry run.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria were met without any Rule 1-4 auto-fix or architectural question.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. This plan performed only read-only registry/API/tarball inspection and a local file write.

## Next Phase Readiness

`docs/EXTENSIONS.md` is committed and available for the remaining 12 plans in Phase 7's wave to reference as the single provenance source for every pin, vendor decision and drop decision this phase makes. The hardening precondition is proven live on this machine, so the next plan in the wave (any plan that runs `pi install`) may proceed. No blockers.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-14*

## Self-Check: PASSED
