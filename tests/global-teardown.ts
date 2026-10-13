/**
 * Suite-wide tripwire: fails the run if a tracked file that was clean at setup is modified at teardown (a snapshot
 * diff, so a developer's in-progress edits are not noise), or if the real ~/.pi/agent/settings.json changed, which
 * tests/setup/agent-dir.ts exists to prevent. Untracked paths are out of scope: scratch output is ordinary.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function repoRootSync(): string {
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		encoding: "utf-8",
		windowsHide: true,
	});
	if (result.status !== 0) {
		throw new Error("tests/global-teardown.ts: not inside a git repository");
	}
	const root = result.stdout.trim();
	if (root === "") {
		throw new Error("tests/global-teardown.ts: `git rev-parse --show-toplevel` returned nothing");
	}
	return root;
}

/** Tracked files `git status --porcelain` reports as modified; `??` untracked entries are excluded. */
function modifiedTrackedFiles(cwd: string): Set<string> {
	const result = spawnSync("git", ["status", "--porcelain"], {
		cwd,
		encoding: "utf-8",
		windowsHide: true,
	});
	if (result.status !== 0) {
		throw new Error(
			`tests/global-teardown.ts: \`git status --porcelain\` failed (${result.status}): ${result.stderr}`,
		);
	}
	const out = new Set<string>();
	for (const line of (result.stdout ?? "").split("\n")) {
		if (line.length === 0) {
			continue;
		}
		// Porcelain v1: two status characters and a space; a rename keeps its whole `old -> new` remainder.
		const status = line.slice(0, 2);
		if (status === "??") {
			continue;
		}
		out.add(line.slice(3));
	}
	return out;
}

/** The real global agent settings path, computed independently of getAgentDir() in vitest's main process. */
function realAgentSettingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

/** A cheap, sufficient fingerprint of the real settings file: absence, or size + mtime + content. */
interface SettingsSnapshot {
	exists: boolean;
	size?: number;
	mtimeMs?: number;
	text?: string;
}

function snapshotRealAgentSettings(): SettingsSnapshot {
	const path = realAgentSettingsPath();
	if (!existsSync(path)) {
		return { exists: false };
	}
	const stat = statSync(path);
	return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs, text: readFileSync(path, "utf-8") };
}

export default async function setup(): Promise<() => Promise<void>> {
	const root = repoRootSync();
	const before = modifiedTrackedFiles(root);
	const beforeRealAgentSettings = snapshotRealAgentSettings();

	return async () => {
		const after = modifiedTrackedFiles(root);
		const newlyDirtied = [...after].filter((path) => !before.has(path)).sort();

		const afterRealAgentSettings = snapshotRealAgentSettings();
		const realAgentSettingsChanged =
			beforeRealAgentSettings.exists !== afterRealAgentSettings.exists ||
			beforeRealAgentSettings.text !== afterRealAgentSettings.text;

		if (realAgentSettingsChanged) {
			// Set independently of the throw below, so both tripwires fire and set process.exitCode.
			process.exitCode = 1;
			throw new Error(
				`tests/global-teardown.ts: the test suite modified this machine's REAL, global agent ` +
					`settings file (${realAgentSettingsPath()}) -- this is exactly CR-01's regression shape. ` +
					"A test resolved getAgentDir() to the real ~/.pi/agent instead of a throwaway " +
					"PI_CODING_AGENT_DIR. See tests/setup/agent-dir.ts for the suite-wide guard that is " +
					"supposed to prevent this, and check whether a test file deleted (rather than restored) " +
					"process.env.PI_CODING_AGENT_DIR mid-run.",
			);
		}

		if (newlyDirtied.length > 0) {
			// Vitest logs a globalSetup teardown throw but still exits 0, so the exit code is set directly; the throw stays
			// for its message.
			process.exitCode = 1;
			throw new Error(
				"tests/global-teardown.ts: the test suite left tracked file(s) modified that " +
					"were clean before it ran:\n" +
					newlyDirtied.map((path) => `  ${path}`).join("\n") +
					"\n\nA test wrote to a real, committed file instead of a throwaway copy. If it " +
					"is a bin/bootstrap.sh integration test, see tests/helpers/bootstrap-repo.ts for " +
					"the pattern every full-bootstrap-run test must use instead of spawning the " +
					"script against the real repo root.",
			);
		}
	};
}
