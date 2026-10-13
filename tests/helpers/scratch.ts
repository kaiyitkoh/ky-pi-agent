import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Temp directories under `os.tmpdir()`, removed by `cleanup` (register it with `afterEach` or `afterAll`). */
export function scratchDirs(): { make: (prefix: string) => string; track: (dir: string) => string; cleanup: () => void } {
	const dirs: string[] = [];
	const track = (dir: string): string => {
		dirs.push(dir);
		return dir;
	};
	return {
		make: (prefix) => track(mkdtempSync(join(tmpdir(), prefix))),
		track,
		cleanup: () => {
			for (const dir of dirs.splice(0)) {
				try {
					rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
				} catch {
					// A leftover temp dir must never mask the test's own result.
				}
			}
		},
	};
}
