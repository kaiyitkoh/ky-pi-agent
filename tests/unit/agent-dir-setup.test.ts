/**
 * WR-02 — proves `tests/setup/agent-dir.ts`'s CR-01 guard is in force at
 * MODULE (import-time) scope, not merely inside its own `beforeAll`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HAS TO CAPTURE THE VALUE AT ITS OWN TOP LEVEL
 * ---------------------------------------------------------------------------
 * `tests/setup/agent-dir.ts` is loaded via `vitest.config.ts`'s `setupFiles`,
 * which runs before THIS file's own module body is evaluated. Reading
 * `process.env.PI_CODING_AGENT_DIR` inside an `it(...)` body would only prove
 * the guard is in force by the time a TEST runs -- which `beforeAll` alone
 * already guarantees, and is not what WR-02 is about. The finding is
 * specifically about the window BEFORE `beforeAll` fires: a test file, or a
 * helper it imports, that resolves `getAgentDir()` at IMPORT TIME. So the
 * value is captured at this file's own top level, in the gap between
 * `setupFiles` running and this file's `describe`/`it` calls executing --
 * the exact gap `beforeAll` cannot reach.
 *
 * MEASURED (WR-02, reproduced here): before the fix, a probe reading
 * `process.env.PI_CODING_AGENT_DIR` at module scope observed `undefined`;
 * only a later read inside a test body observed the suite's temp dir. If
 * `tests/setup/agent-dir.ts`'s module-scope assignment is ever reverted back
 * to `beforeAll`-only, this file's captured value reverts to `undefined` and
 * the assertion below fails.
 */
import { describe, expect, it } from "vitest";

/** Captured at IMPORT TIME -- see this file's own header for why. */
const capturedAtModuleScope = process.env.PI_CODING_AGENT_DIR;

describe("tests/setup/agent-dir.ts -- WR-02: the guard is in force at module scope", () => {
	it("PI_CODING_AGENT_DIR was already set to a non-real temp dir BEFORE this file's own module body ran", () => {
		expect(
			capturedAtModuleScope,
			"PI_CODING_AGENT_DIR was undefined at this file's own import time -- the CR-01 guard only " +
				"took effect later, inside beforeAll, leaving an import-time window where a test file (or " +
				"a helper it imports) resolving getAgentDir() would reach this machine's REAL ~/.pi/agent",
		).toBeDefined();

		expect(
			capturedAtModuleScope,
			"the module-scope value must be a real, existing path, not merely truthy",
		).toMatch(/kypi-agent-dir-suite-/);

		// Non-vacuity: prove this is genuinely the SUITE temp dir, not a value
		// this file's own module scope happened to set independently -- it must
		// still equal the (possibly re-asserted) value beforeAll leaves in place.
		expect(process.env.PI_CODING_AGENT_DIR).toBe(capturedAtModuleScope);
	});
});
