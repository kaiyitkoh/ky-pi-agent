/**
 * Suite-wide guard: no test may resolve `getAgentDir()` to this machine's real `~/.pi/agent`, which
 * `writeAgentOverrides` would otherwise write into whenever `PI_CODING_AGENT_DIR` is unset.
 * Runs per test file via `setupFiles`; a per-file temp dir needs no cross-worker coordination. A case that overrides
 * the variable must restore this value afterwards, never `delete` it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll } from "vitest";

// Module scope, not only beforeAll: setupFiles run before the test file's own module body, so an import-time
// `getAgentDir()` is covered too.
const dir = mkdtempSync(join(tmpdir(), "kypi-agent-dir-suite-"));
process.env.PI_CODING_AGENT_DIR = dir;

beforeAll(() => {
	// Re-assert, in case an earlier case mutated the variable and forgot to restore it.
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
