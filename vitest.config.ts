import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		// Integration tests spawn `pi` and `sh`, and the first pays a cold jiti compile.
		testTimeout: 120_000,
		hookTimeout: 120_000,
		// The full suite at default parallelism pegged the dev machine's CPU.
		maxWorkers: 2,
		passWithNoTests: false,
		// Fails the run if a tracked file that was clean at start is modified (tests/global-teardown.ts).
		globalSetup: ["./tests/global-teardown.ts"],
		// Points getAgentDir() away from the machine's real ~/.pi/agent before every file.
		setupFiles: ["./tests/setup/agent-dir.ts"],
	},
});
