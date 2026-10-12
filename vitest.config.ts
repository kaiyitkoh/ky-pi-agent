import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		// Integration tests shell out to `pi --offline -a --list-models`, which
		// pays a cold jiti compile on first run. The default 5s is not enough.
		testTimeout: 120_000,
		hookTimeout: 120_000,
		// D-06: cap worker processes (the full suite pegged the dev machine's CPU at 99%).
		maxWorkers: 2,
		// A vacuously-empty suite must never report success.
		passWithNoTests: false,
		// Suite-wide tripwire: fails the run if any tracked file ends up
		// modified that was clean before the run started. See
		// tests/global-teardown.ts's own docstring for why this exists (the
		// `.env.example`-corruption bug it was added to catch) and why it diffs
		// against a setup-time snapshot rather than demanding an empty
		// `git status --porcelain` outright.
		globalSetup: ["./tests/global-teardown.ts"],
		// CR-01: structural guard against ANY test resolving getAgentDir() to
		// this machine's real ~/.pi/agent. Runs once per test file, before
		// every test in that file -- see tests/setup/agent-dir.ts's own
		// docstring for the reproduced incident this closes.
		setupFiles: ["./tests/setup/agent-dir.ts"],
	},
});
