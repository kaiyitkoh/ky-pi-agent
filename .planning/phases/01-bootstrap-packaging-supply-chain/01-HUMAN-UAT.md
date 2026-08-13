---
status: partial
phase: 01-bootstrap-packaging-supply-chain
source: [01-VERIFICATION.md]
started: 2026-08-13T10:40:00Z
updated: 2026-08-13T10:40:00Z
---

## Current Test

[awaiting human testing]

These four items are the live half of Phase 1. They were pre-authorised as
outstanding under the Standing Operating Policy in `.planning/STATE.md` — the
phase was allowed to complete with them pending, but none of them may be
recorded as passed until a human actually runs them. `docs/RUNBOOK.md` carries
the executable procedure for the first three; `tests/unit/docs-policy.test.ts`
mechanically prevents any of them being flipped to PASSED in the runbook without
the corresponding status line agreeing.

## Tests

### 1. RB-01-01 (SAFE-16) — `gh auth logout` on the work laptop, then confirm `/share` aborts
expected: `sh scripts/check-gh-unauthenticated.sh` (bare) exits 1 before logout, naming the risk; after `gh auth logout`, exits 0 with `OK: gh is unauthenticated`; a live `/share` attempt aborts with `GitHub CLI is not logged in.`
why_human: Requires a live credential state change on the actual work laptop. This dev machine's `gh` is legitimately authenticated for git-over-HTTPS push access and must not be logged out.
runbook: docs/RUNBOOK.md RB-01-01 (OUTSTANDING)
result: [pending]

### 2. RB-01-02 (BOOT-02) — `pi install https://github.com/kaiyitkoh/ky-pi-agent` on a clean profile
expected: `pi --list-models` includes `ky-harness-selftest`, proving the manifest resolved, the extension directory was collected over the network, and the extension loaded.
why_human: Requires a clean Pi profile (`PI_CODING_AGENT_DIR` pointed at an empty directory) and real network egress to GitHub. The offline proxy — `tests/integration/load-paths.test.ts` case 2, local clone + `npm install --omit=dev` — passes against the real `pi@0.84.1` binary; the real-URL fetch itself is untested by design.
runbook: docs/RUNBOOK.md RB-01-02 (OUTSTANDING)
result: [pending]

### 3. RB-01-03 (BOOT-05) — `/reload` re-registers the extension in an interactive TTY session
expected: Editing `SELFTEST_MODEL_ID` and running `/reload` surfaces the new value in the same session, without restarting `pi`.
why_human: `/reload` is an interactive slash command with no non-interactive equivalent and no scriptable path; it requires a TTY. The structural precondition (extension sits at an auto-discovered path) is proven by `tests/unit/extension-layout.test.ts`, which is necessary but not sufficient.
runbook: docs/RUNBOOK.md RB-01-03 (OUTSTANDING)
result: [pending]

### 4. CI workflow's first live run on `windows-latest` and `macos-latest` (BOOT-06 conformance half, BOOT-07)
expected: The `posix-lint` job (`shellcheck --shell=sh --severity=style` plus the pin-audit step) and the `windows-latest` / `macos-latest` test matrix (full vitest suite, `bootstrap --check-only`, `gh` check `--warn-only`, `tsc`) all pass on GitHub's runners.
why_human: Cannot be triggered from this machine — it needs a push or PR against the GitHub-hosted repo. `.github/workflows/ci.yml` is statically verified end-to-end by `tests/unit/ci-pinning.test.ts`, and `shellcheck` is confirmed absent locally, so the POSIX-conformance half genuinely cannot be exercised here. Never executed to date.
runbook: no entry yet — flagged in `01-10-SUMMARY.md` for a later phase to fold into `docs/RUNBOOK.md`
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
