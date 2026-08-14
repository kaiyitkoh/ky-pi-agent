/**
 * Suite-wide guard: no test file may leave a TRACKED file modified that was
 * clean before the run started.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * `bin/bootstrap.sh` integration tests used to spawn the real script with
 * `cwd: repoRoot()`, so `SCRIPT_DIR/..` resolved to the real repository and a
 * full run's `write_env_template` wrote the real, tracked `.env.example`.
 * Vitest runs test FILES in parallel, so two files doing this at once raced
 * on the same file, and some cases (`bootstrap-safety-stub.test.ts` cases
 * 6/7) had no restore at all -- `npx vitest run` on a clean tree left
 * `.env.example` permanently corrupted. `tests/helpers/bootstrap-repo.ts`
 * fixes the root cause (every full run now gets its own throwaway
 * `REPO_ROOT`); this guard is the tripwire that catches the NEXT test that
 * makes the same mistake, for `.env.example` or any other tracked file.
 *
 * ---------------------------------------------------------------------------
 * Why a snapshot diff, not a bare "`git status --porcelain` must be empty"
 * ---------------------------------------------------------------------------
 * A bare "must be empty" assertion is correct only against a pristine
 * checkout, and is exactly the kind of check that is USELESS during normal
 * development: a developer with an in-progress, legitimately-uncommitted
 * change would trip it on every single run, for a file no test ever touched.
 * That is not a tripwire, it is noise a developer learns to ignore -- and a
 * guard nobody reads stops guarding anything.
 *
 * So: snapshot which TRACKED files are modified (`git status --porcelain`,
 * excluding `??` untracked entries) once, in `setup()`, before any test file
 * runs. In the returned teardown, take the same snapshot again and diff.
 * Only a path that is NEWLY dirty -- clean at setup, modified at teardown --
 * fails the run. A file the developer already had open stays out of scope
 * either way, exactly like every other assertion in this suite that redirects
 * around real machine/repo state rather than demanding a pristine one.
 *
 * ---------------------------------------------------------------------------
 * Untracked paths are deliberately out of scope
 * ---------------------------------------------------------------------------
 * `??` entries are excluded on both sides of the diff. Plenty of legitimate
 * scratch activity (this suite's own `tests/helpers/bootstrap-repo.ts`
 * copies land under the gitignored `tmp/`, and any crashed run's leftover
 * temp dir would show the same way) produces untracked paths, and none of it
 * is the failure mode this guard exists for -- a COMMITTED file silently
 * changing content is. Widening this to untracked paths would make the guard
 * fail on totally ordinary scratch output and teach the same "ignore it"
 * reflex the snapshot-diff design above is built to avoid.
 *
 * ---------------------------------------------------------------------------
 * CR-01 EXTENSION -- the REAL, UNTRACKED, out-of-repo global agent settings
 * ---------------------------------------------------------------------------
 * The tracked-file diff above cannot see `~/.pi/agent/settings.json`: it is
 * neither tracked nor inside the repo. That is exactly the file
 * `writeAgentOverrides` (`.pi/extensions/routing/agent-overrides.ts`)
 * resolves to by default, and it is exactly the file CR-01 found mutated on a
 * real developer machine (`subagents.agentOverrides.planner` written by a
 * test that never injected `PI_CODING_AGENT_DIR`). `tests/setup/agent-dir.ts`
 * is the structural fix (every test file now gets a throwaway
 * `PI_CODING_AGENT_DIR` before any of its tests run); this is the tripwire
 * for the NEXT test that regresses that guard -- snapshotted once here,
 * compared once here, independent of whatever any individual test file does
 * to `process.env` for its own worker.
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

/**
 * Repo-root-relative paths of every TRACKED file `git status --porcelain`
 * reports as modified right now. Porcelain v1's `??` prefix is untracked and
 * is excluded -- see this module's own docstring for why.
 */
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
		// Porcelain v1: two status characters, a space, then the path (a rename
		// carries `old -> new`; the path half after `-> ` is what changed, so the
		// whole remainder is kept rather than parsed further).
		const status = line.slice(0, 2);
		if (status === "??") {
			continue;
		}
		out.add(line.slice(3));
	}
	return out;
}

/**
 * Absolute path of THIS machine's real, global agent settings file --
 * `getAgentDir()`'s own default, computed independently of that function
 * (this file runs in vitest's main process, once, outside any test file's
 * own `PI_CODING_AGENT_DIR` override) [VERIFIED: pi-coding-agent 0.84.1
 * `dist/config.d.ts:76` -- "Get the agent config directory (e.g.,
 * ~/.pi/agent/)"].
 */
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
			// CR-01's exact regression shape. Set independently of the
			// newlyDirtied throw below so BOTH tripwires fire (and both set
			// process.exitCode) even if only one of the two conditions holds.
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
			// WR-13: vitest reports a globalSetup teardown throw as an "error
			// during close" on stderr but does NOT translate it into a non-zero
			// process exit code -- confirmed by direct execution, twice, on
			// separate runs (raw exit code 0 both times) with this exact throw
			// firing. A check that cannot fail the build is not a check: in CI,
			// and in any `npm test && ...` chain, the tripwire this file exists
			// to provide would be entirely decorative -- the exact regression it
			// was written to catch would ship green. Setting `process.exitCode`
			// survives vitest swallowing the throw into a log line, because
			// `process.exitCode` is read by Node's own normal exit machinery
			// independently of whatever vitest did with the error. The throw
			// itself is kept too, for the human-readable message on stderr --
			// this line is additive, not a replacement for it.
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
