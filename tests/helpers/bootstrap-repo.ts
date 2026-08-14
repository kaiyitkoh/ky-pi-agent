/**
 * Throwaway REPO_ROOT for `bin/bootstrap.sh` integration tests.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists to fix
 * ---------------------------------------------------------------------------
 * `bin/bootstrap.sh` derives its own `REPO_ROOT` from `dirname "$0"` (the
 * script's own location, `bin/bootstrap.sh:60-61`) and, on a full run, writes
 * the tracked `$REPO_ROOT/.env.example` (`write_env_template`,
 * `bin/bootstrap.sh:533-534`). Every integration test that spawned
 * `sh <repo>/bin/bootstrap.sh` for a full run therefore wrote into the REAL,
 * committed `.env.example` -- and vitest runs test FILES in parallel, so two
 * independent snapshot/restore windows raced on the same file and left the
 * tracked file corrupted (scrambled WR-06 fixture content survived) after a
 * clean `vitest run`.
 *
 * The fix: give every full-bootstrap subprocess its OWN copy of `bin/` and
 * every `$REPO_ROOT`-relative file the script reads, so `SCRIPT_DIR/..`
 * resolves to a throwaway directory and the one REPO_ROOT-relative WRITE a
 * full run performs (`.env.example` -- `merge_settings` / `merge_models_json`
 * / `merge_auth_json` / `install_safety_extension`'s stub all write under
 * `PI_CODING_AGENT_DIR`, which every caller already redirects) lands there
 * instead of in the tracked file.
 *
 * ---------------------------------------------------------------------------
 * Why the copy lives INSIDE this repo (`<repoRoot>/tmp/…`), not `os.tmpdir()`
 * ---------------------------------------------------------------------------
 * `install_safety_extension` embeds `$REPO_ROOT/.pi/extensions/safety/index.ts`
 * as an absolute import specifier in the stub it writes, and
 * `bootstrap-safety-stub.test.ts`'s CR-06 cases actually dynamically import
 * that path through jiti and expect the REAL safety extension to load --
 * which means every sibling file it imports (`policy.ts`, `shell.ts`, …),
 * `.pi/lib/jsonl.ts` (two levels up from `audit.ts`), and its npm
 * dependencies (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`,
 * `typebox`, `unbash`) must all resolve from wherever the copy lives.
 *
 * Node's module resolution walks up ANCESTOR directories looking for
 * `node_modules`; it does not search sideways. A copy under `os.tmpdir()`
 * (e.g. `C:\Users\...\AppData\Local\Temp\kypi-...`) has no ancestor holding
 * this project's `node_modules`, so the extension's own imports would fail to
 * resolve there. Nesting the copy at `<repoRoot>/tmp/<unique>/` keeps the
 * real `node_modules` an ancestor of every copied file, so resolution works
 * exactly as it does for the real tree -- and `tmp/` is already gitignored
 * (`.gitignore`'s "Temporary / scratch" section), so a copy that outlives its
 * test (a crash before cleanup runs) is invisible to `git status` rather than
 * showing up as an untracked path.
 */
import { copyFileSync, cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "./git.ts";

export interface BootstrapRepoCopy {
	/** Root of the throwaway copy -- what `SCRIPT_DIR/..` resolves to. */
	root: string;
	/** Forward-slashed path to the copied `bin/bootstrap.sh`, ready for `sh <path>`. */
	bootstrapSh: string;
	/** Where a full run's `write_env_template` writes, inside the copy. */
	envExample: string;
}

/**
 * Copy every `$REPO_ROOT`-relative input `bin/bootstrap.sh` reads (never
 * writes) into a fresh directory nested under this repo's own `tmp/`.
 *
 * The caller owns cleanup (`rmSync(copy.root, { recursive: true, force: true })`,
 * typically via the calling file's own `scratch` array) -- this module never
 * registers its own cleanup hook, so it composes with whatever convention the
 * calling test file already uses.
 */
export function makeBootstrapRepoCopy(prefix: string): BootstrapRepoCopy {
	const tmpRoot = join(repoRoot(), "tmp");
	mkdirSync(tmpRoot, { recursive: true });
	const root = mkdtempSync(join(tmpRoot, prefix));

	mkdirSync(join(root, "bin"), { recursive: true });
	copyFileSync(join(repoRoot(), "bin", "bootstrap.sh"), join(root, "bin", "bootstrap.sh"));

	mkdirSync(join(root, ".pi", "templates"), { recursive: true });
	for (const name of ["env.example", "models-template.json", "auth-template.json"]) {
		copyFileSync(join(repoRoot(), ".pi", "templates", name), join(root, ".pi", "templates", name));
	}

	// Read-only as far as bin/bootstrap.sh itself is concerned (only an
	// existence check plus embedding its own absolute path in a stub), but the
	// CR-06 driver in bootstrap-safety-stub.test.ts dynamically imports that
	// embedded path afterwards and expects the real extension to run, so the
	// whole tree it imports from must be present, not just index.ts.
	cpSync(join(repoRoot(), ".pi", "extensions", "safety"), join(root, ".pi", "extensions", "safety"), {
		recursive: true,
	});
	mkdirSync(join(root, ".pi", "lib"), { recursive: true });
	copyFileSync(join(repoRoot(), ".pi", "lib", "jsonl.ts"), join(root, ".pi", "lib", "jsonl.ts"));

	return {
		root,
		bootstrapSh: join(root, "bin", "bootstrap.sh").replace(/\\/g, "/"),
		envExample: join(root, ".env.example"),
	};
}
