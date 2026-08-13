---
phase: 04-safety-deployment-guardrails
plan: 09
subsystem: safety
tags: [bootstrap, user-scope-extensions, headless-deny, faux-provider, jiti, windows]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: "the plain re-export-stub mechanism spiked and proven against a real spawned pi process (Plan 01); .pi/extensions/safety/index.ts wiring the tool_call hook + wrapped bash/read/write/edit tools + approve_ky_command (Plan 08); writeAuditRow/AUDIT_LOG_BASE (Plan 02)"
provides:
  - "bin/bootstrap.sh: install_safety_extension writes a user-scope re-export stub at $PI_AGENT_DIR/extensions/ky-safety/index.ts pointing at .pi/extensions/safety/index.ts, idempotently, called from run_full() after install_pi"
  - "bin/bootstrap.sh: report_safety_extension, called from run_check_only() -- non-fatal when the stub is absent, fatal when present but pointing at a missing target"
  - "tests/integration/bootstrap-safety-stub.test.ts: idempotency and check-only reporting proof against a throwaway agent dir"
  - "tests/integration/headless-deny.test.ts: proof that a command policy.ts classifies block is DENIED inside a real spawned `pi --mode json` process with no UI bound, paired with a benign positive control, both rows landing in the same .pi/logs/audit-*.jsonl"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "in-process scripted provider for a spawned-subprocess test: a driver extension written directly into the throwaway agent directory calls pi.registerProvider(fauxProvider(...).provider) INSIDE the spawned pi process itself, eliminating any cross-process network dependency for scripting a model turn -- discovered as the fix for a measured, deterministic hang in the plan's originally-suggested loopback-HTTP-server composition"
    - "bootstrap.sh's install_safety_extension follows write_env_template's established idempotency discipline exactly: compute intended content, byte-compare against disk, print \"already current - unchanged\" rather than rewriting"

key-files:
  created:
    - tests/integration/bootstrap-safety-stub.test.ts
    - tests/integration/headless-deny.test.ts
  modified:
    - bin/bootstrap.sh

key-decisions:
  - "install_safety_extension is placed in run_full() AFTER install_pi, alongside merge_settings/write_env_template/merge_models_json/merge_auth_json, per the plan's explicit BOOT-01 ordering instruction -- it configures Pi, it does not gate hardening."
  - "The loopback-HTTP-server composition RESEARCH.md's Open Question 2 suggested was tried first and abandoned after direct measurement: spawning the identical argv via spawnSync from inside a vitest test process (both --pool=threads and --pool=forks) reproduced a deterministic hang -- the spawned pi process never opened a connection to the loopback server -- in 5/5 attempts, while the SAME argv against the SAME server from a bare `node script.mjs` outside vitest succeeded in 4/5 attempts. Stripping every npm_config_*/NPM_CONFIG_*/VITEST* variable vitest injects into the child env (the exact pollution class bin/bootstrap.sh's own sanitise_npm_env already documents) made no difference, ruling that out as the cause. The proximate cause was not fully isolated. Per RESEARCH's own pre-authorized fallback (\"fall back to whatever route reliably reaches the wrapped tool\"), replaced the loopback server with an in-process fauxProvider registered by a driver extension written into the throwaway agent directory and loaded INSIDE the spawned pi process -- verified reliable (fast, zero hangs) across 7 consecutive full runs during this plan's execution."
  - "headless-deny.test.ts's DENY assertion matches the policy's own unique reason substring (\"holds plaintext secrets\"), not the generic word \"tfstate\" -- mutation testing (see below) caught that the generic substring match passes VACUOUSLY when the guard is neutered, because a genuine `cat: No such file or directory` error for a nonexistent terraform.tfstate ALSO contains the word \"tfstate\"."
  - "The confirm-verdict / approve_ky_command path (ctx.ui.select() returning undefined headless) is deliberately NOT exercised end-to-end in headless-deny.test.ts -- it is already unit-proven against a real faux session in Plan 08's safety-entry.test.ts/double-enforcement.test.ts, and scripting a second in-process tool call on top of the two-turn exchange here was judged to add no further evidence. Recorded explicitly in the test file's own docstring rather than silently narrowing scope."

requirements-completed: [SAFE-10, SAFE-11]

# Metrics
duration: ~44min
completed: 2026-08-14
---

# Phase 4 Plan 9: User-Scope Bootstrap Install and the Real Headless Deny Summary

**`bin/bootstrap.sh` now installs the safety extension at user scope (idempotent, reported by `--check-only`), and `tests/integration/headless-deny.test.ts` proves a `policy.ts`-blocked command is denied inside a REAL spawned `pi --mode json` process with `noOpUIContext` genuinely bound -- after the plan's own suggested loopback-HTTP composition was tried, measured to hang deterministically only when spawned from inside vitest, and replaced with an in-process scripted provider running inside the spawned process itself.**

## Performance

- **Duration:** ~44 min
- **Started:** 2026-08-14T05:50:00+08:00 (approx, from prior commit)
- **Completed:** 2026-08-14T06:34:39+08:00
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `install_safety_extension` in `bin/bootstrap.sh` writes a plain re-export stub (`export { default } from "<abs path>";`) at `$PI_AGENT_DIR/extensions/ky-safety/index.ts` pointing at `.pi/extensions/safety/index.ts`, using the exact mechanism Plan 01's spike proved against a real spawned `pi` process on Windows -- backslashes normalised to forward slashes before the path is embedded in the generated TypeScript string literal, following `write_env_template`'s byte-compare idempotency discipline. Manually verified end to end: a full `sh bin/bootstrap.sh` run against a throwaway agent dir wrote the stub with a backslash-free specifier resolving to a real file, a second run reported "already current - unchanged" with a byte-identical, unchanged-mtime file.
- `report_safety_extension`, called from `run_check_only()`, is non-fatal when the stub is absent (a CI runner legitimately has none) and fatal when the stub is present but points at a target that no longer exists (a moved or deleted clone) -- verified against both cases directly.
- `tests/integration/bootstrap-safety-stub.test.ts` (4 cases) drives the real script against a throwaway `PI_CODING_AGENT_DIR`: written specifier has no backslash and resolves to an existing file; a second run is a byte-identical no-op with an unchanged mtime; `--check-only` on a stub-free dir exits 0 and creates nothing; `--check-only` on a stub with a missing target exits non-zero.
- `tests/integration/headless-deny.test.ts` (3 cases) spawns a real `pi --mode json` subprocess against a throwaway `PI_CODING_AGENT_DIR`/cwd, with the safety extension loaded ONLY via the user-scope `writeUserScopeShim` mechanism (no project trust granted at all): DENY -- `cat terraform.tfstate` (SAFE-06) is refused with an ERROR tool result carrying the guard's own reason; POSITIVE CONTROL -- the identical harness executes `echo kypi-positive-control-sentinel` normally through the SAME wrapped `bash` tool; AUDIT -- `.pi/logs/audit-*.jsonl` under the spawned cwd carries both the block row and the allow row, proving the guard was genuinely loaded and evaluating rather than the subprocess being unable to execute anything at all.
- **The major finding of this plan**: the plan's own suggested mechanism for scripting the spawned process's model turn -- a cross-process loopback HTTP server (`tests/helpers/loopback.ts`) -- was tried first and measured, by direct repeated experiment, to hang deterministically (5/5) when the identical `spawnSync` argv was issued from inside a vitest test process (confirmed under both `--pool=threads` and `--pool=forks`), while the SAME argv against the SAME server succeeded reliably (4/5, then consistently once warmed) from a bare `node script.mjs` outside vitest. Stripping every `npm_config_*`/`NPM_CONFIG_*`/`VITEST*` environment variable vitest injects into the child (the exact class of pollution `bin/bootstrap.sh`'s own `sanitise_npm_env` already documents and defends against) made no measurable difference, ruling that out as the cause. The proximate root cause was not fully isolated within this plan's scope. Per `04-RESEARCH.md` Open Question 2's own pre-authorized fallback clause, the mechanism was replaced with an in-process scripted provider: a small driver extension (`kypi-faux-driver`) is written directly into the throwaway agent directory, imports `fauxProvider`/`fauxToolCall`/`fauxAssistantMessage` from `@earendil-works/pi-ai`, and calls `pi.registerProvider(faux.provider)` -- executed INSIDE the spawned `pi` process itself via the same `registerProvider`-during-the-factory pattern Plan 01's sentinel provider already proved, with `fauxProvider`'s own `stream()` resolving through `queueMicrotask` and no network call anywhere. This eliminates the cross-process network dependency entirely and was verified reliable (fast, ~800ms-3s, zero hangs) across 7 consecutive full test runs.
- Mutation-tested by actually neutering `.pi/extensions/safety/policy.ts#evaluate()` to always return `{ kind: "allow" }` and re-running: all three `headless-deny.test.ts` cases correctly went red. This ALSO caught a genuine precision gap in the test's first draft: the DENY case's assertion matched the substring `"tfstate"` in the tool result text, which a real `cat: No such file or directory` error (produced once the guard stopped blocking, since no such file exists in the throwaway cwd) ALSO contains -- so the assertion would have passed vacuously under mutation. Fixed by matching the policy's own unique reason phrase (`"holds plaintext secrets"`) instead, in both the tool-result assertion and the audit-row assertion. Restored `policy.ts` byte-identical afterward (confirmed via `git diff`), and re-ran the full suite green.

## Task Commits

1. **Task 1: bootstrap installs the safety extension at user scope, idempotently** - `2782cf2` (feat)
2. **Task 2: Prove the deny in a real `pi --mode json` process with no UI bound (SAFE-10)** - `bc052ce` (test)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `bin/bootstrap.sh` (modified) - `install_safety_extension` (called from `run_full`, after `install_pi`) and `report_safety_extension` (called from `run_check_only`); usage text updated to mention the new install step
- `tests/integration/bootstrap-safety-stub.test.ts` (new, 4 tests) - idempotency and check-only reporting proof against a throwaway agent dir
- `tests/integration/headless-deny.test.ts` (new, 3 tests) - the real spawned-process DENY/POSITIVE-CONTROL/AUDIT proof, using the in-process faux-provider driver extension mechanism described above

## Decisions Made

See `key-decisions` in frontmatter. In summary: `install_safety_extension` placed after `install_pi` per the plan's explicit ordering instruction; the loopback-HTTP mechanism was abandoned for a measured, reproducible reason and replaced with an in-process `fauxProvider` driver extension running inside the spawned process, per RESEARCH's own pre-authorized fallback; the DENY assertion matches the policy's unique reason text rather than a substring a genuine unrelated error could also produce; the `confirm`/`approve_ky_command` headless-refusal path is deliberately left to Plan 08's existing faux-session coverage rather than scripted end-to-end here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced the loopback-HTTP composition with an in-process faux-provider driver extension**
- **Found during:** Task 2, while implementing `headless-deny.test.ts` per the plan's suggested `withLoopbackCompletions` + spawned-`pi` composition
- **Issue:** The composition hung deterministically (5/5 attempts, both vitest pools) when run inside vitest, while succeeding reliably outside it. This blocked Task 2 from completing at all with the plan's suggested mechanism.
- **Fix:** Per `04-RESEARCH.md` Open Question 2's explicit pre-authorized fallback ("fall back to whatever route reliably reaches the wrapped tool... do not silently downgrade to a faux-session test"), replaced the cross-process loopback server with a driver extension written into the throwaway agent directory that registers `fauxProvider()`'s `Provider` object directly inside the spawned `pi` process — no network call anywhere in the mechanism. Verified reliable across 7 consecutive runs before and after the mutation-testing round.
- **Files modified:** `tests/integration/headless-deny.test.ts` (the file was rewritten with this mechanism before its first commit; no separate fix commit was needed)
- **Verification:** `npx vitest run tests/integration/headless-deny.test.ts` green across 4 consecutive standalone runs plus the mutation-testing round plus the full-suite run (1022/1022)
- **Committed in:** `bc052ce` (Task 2 commit — the loopback attempt was never itself committed)

---

**Total deviations:** 1 auto-fixed (1 blocking issue, resolved via the plan's own pre-authorized fallback clause, not a scope change)
**Impact on plan:** None on scope or on what SAFE-10/SAFE-11 required to be proven — the fallback mechanism proves the identical claim (a real spawned `--mode json` process denies a blocked command with no UI bound) with no network dependency, and is documented in both the test file's own docstring and here per RESEARCH's own instruction to "record precisely what the fallback does and does not prove."

## Issues Encountered

The loopback-hang investigation (see Deviations above) consumed the majority of this plan's time: reproduced via a minimal scratch vitest test, confirmed independent of message word-count/quoting (both single-word and five-word messages exhibited it), confirmed independent of `npm_config_*`/`VITEST*` environment pollution, and confirmed independent of `windowsHide`. The proximate cause (plausibly security-software interception of loopback traffic specifically between a vitest-spawned process and a freshly-launched child process; not conclusively isolated) is recorded honestly as unresolved in the test file's own docstring rather than guessed at. The scratch debug files used during this investigation (`tests/integration/_debug-scratch.test.ts`, `tests/integration/_envdump.test.ts`) were deleted before committing and never entered git history.

## User Setup Required

None — no external service configuration required. This plan adds no new dependency.

## Next Phase Readiness

- Phase 4's SAFE-10 and SAFE-11 requirements are now proven end to end: the safety extension is genuinely installable at user scope by the one script a cold machine runs, and a blocked command is genuinely denied in the exact headless shape a spawned subagent (Plan 10, Phase 7's `pi-subagents`) will exhibit.
- The in-process faux-provider driver-extension pattern discovered here (`writeFauxDriverExtension` in `headless-deny.test.ts`) is available as a proven, reliable alternative to `tests/helpers/loopback.ts` for any FUTURE plan that needs to script a model turn inside a REAL SPAWNED `pi` subprocess specifically (as opposed to an in-process faux session, where `tests/helpers/faux.ts`'s existing `fauxProvider` usage is already the right tool) — worth citing directly rather than re-discovering the loopback-hang issue.
- No blockers. `npx vitest run tests/unit tests/integration` is 1022/1022 green (up from 1015 at the end of Plan 08; the delta is this plan's 7 new tests: 4 in `bootstrap-safety-stub.test.ts`, 3 in `headless-deny.test.ts`), `tsc --noEmit` clean, `sh bin/bootstrap.sh --check-only` exits 0 on this machine.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: bin/bootstrap.sh (install_safety_extension, report_safety_extension)
- FOUND: tests/integration/bootstrap-safety-stub.test.ts
- FOUND: tests/integration/headless-deny.test.ts
- FOUND: commit 2782cf2 (Task 1)
- FOUND: commit bc052ce (Task 2)
