/**
 * CR-01 — suite-wide guard: no test may ever resolve `getAgentDir()` to this
 * machine's REAL `~/.pi/agent`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `writeAgentOverrides` (`.pi/extensions/routing/agent-overrides.ts`) resolves
 * `join(getAgentDir(), "settings.json")` whenever no `settingsPath` is
 * injected, and `getAgentDir()` honours `PI_CODING_AGENT_DIR`, otherwise
 * falling back to the real `~/.pi/agent/` on THIS machine
 * [VERIFIED: pi-coding-agent 0.84.1 `dist/config.d.ts:76`]. Before this guard
 * existed, `PI_CODING_AGENT_DIR` injection was per-test-case discipline
 * (`tests/integration/mode-switch.test.ts` cases 2/4,
 * `tests/integration/wire-proof.test.ts`'s `beforeAll`) rather than
 * structural — and case 1 of `mode-switch.test.ts` plus every case of
 * `mode-persistence.test.ts` drove a SUCCESSFUL `/balanced` or `/max` switch
 * with the variable unset, reproducibly writing
 * `subagents.agentOverrides.planner` into this developer's real,
 * un-gitignored `~/.pi/agent/settings.json` (CR-01).
 *
 * This file is loaded once per test FILE via `vitest.config.ts`'s
 * `setupFiles` (distinct from `globalSetup`, which runs once for the whole
 * run in the main process and cannot set `process.env` for the worker that
 * actually executes a test file). A setup file's own MODULE BODY is
 * evaluated BEFORE the test file's own module body
 * [VERIFIED: vitest 4.1.9 executes `setupFiles` during worker
 * initialisation, strictly before the test file is imported], so the
 * assignment below (WR-02) closes the one window `beforeAll` alone cannot
 * reach: a test file — or a helper it imports — that resolves
 * `getAgentDir()` or calls `writeAgentOverrides()` at IMPORT TIME, before any
 * `beforeAll` in that file has had a chance to run. MEASURED (WR-02): a probe
 * test that read `process.env.PI_CODING_AGENT_DIR` at module scope observed
 * `undefined` there and the suite temp dir only once inside a test body, when
 * the guard set the variable in `beforeAll` alone. `beforeAll` below now only
 * RE-ASSERTS the same value, as a defence against an individual test case
 * that reassigns `process.env.PI_CODING_AGENT_DIR` mid-file and forgets to
 * restore it before the file's own `afterAll`. No currently-committed test
 * file resolves `getAgentDir()` at import time — this guard exists so that if
 * one ever does, it still cannot reach this machine's real `~/.pi/agent`.
 *
 * ---------------------------------------------------------------------------
 * WHY A FRESH TEMP DIR PER FILE, NOT ONE FOR THE WHOLE RUN
 * ---------------------------------------------------------------------------
 * Vitest's default `pool` runs test files in separate worker
 * processes/threads; a per-file temp dir keeps this guard simple (no
 * cross-worker coordination) while still giving every individual test the
 * SAME non-real target for the file's whole lifetime — cases that need their
 * OWN temp dir (to assert on ITS specific settings.json content) override
 * `process.env.PI_CODING_AGENT_DIR` for the duration of their own `it(...)`
 * body and must restore this suite value afterward, never merely `delete`
 * it — deleting would punch a hole in this guard for the REST of that file's
 * cases. See `tests/integration/mode-switch.test.ts` and
 * `tests/unit/agent-overrides.test.ts` for that restore pattern.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll } from "vitest";

// WR-02: set at MODULE SCOPE, not only inside beforeAll -- setupFiles are
// evaluated before the test file's own module body, so this closes the
// import-time window beforeAll cannot reach. See this file's own module
// docstring for the measured evidence.
const dir = mkdtempSync(join(tmpdir(), "kypi-agent-dir-suite-"));
process.env.PI_CODING_AGENT_DIR = dir;

beforeAll(() => {
	// Re-assert (not re-create) the same value: a test must never resolve
	// getAgentDir() to this machine's real ~/.pi/agent. This is now a defence
	// against an individual case mutating the env var mid-file and forgetting
	// to restore it before this file's own remaining cases run -- the
	// module-scope assignment above is what actually closes the CR-01 hole.
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
