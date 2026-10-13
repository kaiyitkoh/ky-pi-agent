/**
 * Throwaway REPO_ROOT for `bin/bootstrap.sh` integration tests.
 *
 * The script derives REPO_ROOT from its own location and a full run writes the
 * tracked `$REPO_ROOT/.env.example`, so parallel test files running the real
 * script would race on that file. Each run gets its own copy of `bin/` and every
 * REPO_ROOT-relative input instead.
 *
 * The copy lives under `<repoRoot>/tmp/` (gitignored), not `os.tmpdir()`: the
 * stub the script writes imports the copied safety extension, whose own imports
 * (`.pi/lib`, `unbash`, `@earendil-works/*`) must resolve through an ancestor
 * `node_modules`.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";

import { repoRoot } from "./git.ts";
import type { StubSpec } from "./stub-bin.ts";

export interface BootstrapRepoCopy {
	/** Root of the throwaway copy -- what `SCRIPT_DIR/..` resolves to. */
	root: string;
	/** Forward-slashed path to the copied `bin/bootstrap.sh`, ready for `sh <path>`. */
	bootstrapSh: string;
	/** Where a full run's `write_env_template` writes, inside the copy. */
	envExample: string;
}

const COPIED_FILES = [
	"bin/bootstrap.sh",
	"bin/bootstrap.mjs",
	".pi/templates/env.example",
	".pi/templates/models-template.json",
	".pi/templates/auth-template.json",
	".pi/lib/jsonl.ts",
	".pi/lib/secret-patterns.ts",
	".pi/lib/settings.ts",
	".pi/settings.json",
	".pi/themes/ky.json",
	".pi/scripts/worktree-setup-hook.mjs",
	"package.json",
	"package-lock.json",
];

/**
 * Copy every REPO_ROOT-relative input `bin/bootstrap.sh` reads into a fresh
 * directory under this repo's `tmp/`. The caller owns cleanup.
 */
export function makeBootstrapRepoCopy(prefix: string): BootstrapRepoCopy {
	const tmpRoot = join(repoRoot(), "tmp");
	mkdirSync(tmpRoot, { recursive: true });
	const root = mkdtempSync(join(tmpRoot, prefix));

	for (const file of COPIED_FILES) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		copyFileSync(join(repoRoot(), file), join(root, file));
	}
	cpSync(join(repoRoot(), ".pi", "extensions", "safety"), join(root, ".pi", "extensions", "safety"), {
		recursive: true,
	});

	return {
		root,
		bootstrapSh: join(root, "bin", "bootstrap.sh").replace(/\\/g, "/"),
		envExample: join(root, ".env.example"),
	};
}

export interface BootstrapRun {
	stdout: string;
	stderr: string;
	status: number | null;
}

const BOOTSTRAP_SH = join(repoRoot(), "bin", "bootstrap.sh").replace(/\\/g, "/");

/**
 * Runs `sh bootstrap.sh args` with `PI_CODING_AGENT_DIR` set, against `repoCopy` when given (a full run writes the
 * tracked `.env.example`). `sh` is a real executable on both platforms, so no `shell: true` is needed.
 */
export function runBootstrap(
	args: string[],
	opts: { agentDir: string; env?: Record<string, string>; extraEnv?: Record<string, string>; repoCopy?: BootstrapRepoCopy },
): BootstrapRun {
	const script = opts.repoCopy?.bootstrapSh ?? BOOTSTRAP_SH;
	const result = spawnSync("sh", [script, ...args], {
		cwd: opts.repoCopy?.root ?? repoRoot(),
		env: { ...(opts.env ?? (process.env as Record<string, string>)), PI_CODING_AGENT_DIR: opts.agentDir, ...opts.extraEnv },
		encoding: "utf-8",
		timeout: 120_000,
		windowsHide: true,
	});
	if (result.error) throw new Error(`failed to run \`sh ${script} ${args.join(" ")}\`: ${result.error.message}`);
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

/**
 * A stub `npm` answering the three questions the script asks: ignore-scripts is on, `npm view` reports `version`, and
 * the global tree is empty so the install step genuinely runs.
 */
export function bootstrapNpmStub(logTo: string, version = "1.1.0"): StubSpec {
	return {
		exitCode: 0,
		logTo,
		match: [
			{ when: ["config", "get", "ignore-scripts"], stdout: "true\n" },
			{ when: ["view"], stdout: `"${version}"\n` },
			{ when: ["ls", "-g"], stdout: '{"dependencies":{}}\n' },
		],
	};
}
