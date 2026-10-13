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
import { copyFileSync, cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";

import { repoRoot } from "./git.ts";

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
