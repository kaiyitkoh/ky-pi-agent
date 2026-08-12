import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		// Integration tests shell out to `pi --offline -a --list-models`, which
		// pays a cold jiti compile on first run. The default 5s is not enough.
		testTimeout: 120_000,
		hookTimeout: 120_000,
		// A vacuously-empty suite must never report success.
		passWithNoTests: false,
	},
});
