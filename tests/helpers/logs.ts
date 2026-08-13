/**
 * Temp `.pi/logs` fixtures and two deliberately different JSONL readers.
 *
 * ---------------------------------------------------------------------------
 * Why there are TWO readers
 * ---------------------------------------------------------------------------
 * DIAG-08 is a claim about concurrent appends: four subagent processes writing
 * one shared file must not produce a torn record. The measurement was executed
 * on this machine and found zero torn lines at record sizes up to 200 KB
 * [VERIFIED: executed 2026-08-13, win32, node v24.16.0 — RESEARCH.md §10.3].
 *
 * A reader that throws on a malformed line cannot report that number. It turns
 * "3 of 800 records were torn" — a measurement, and the exact one the
 * requirement is about — into a stack trace at record 217. So:
 *
 *   - {@link readTornSafe} never throws. It returns the records it could parse
 *     AND the raw text of every line it could not, so a test can assert
 *     `unparseable.length === 0` and, when that fails, print what tore.
 *   - {@link readJsonl} throws, on purpose. It is the strict reader for the
 *     files a test wrote itself, where a malformed line is a bug in the writer
 *     and swallowing it would hide one.
 *
 * The difference between them is asserted in `tests/unit/helpers.test.ts`
 * against the same mixed fixture, rather than assumed from these comments.
 *
 * ---------------------------------------------------------------------------
 * The `.jsonl` gitignore trap
 * ---------------------------------------------------------------------------
 * `.gitignore:30` is a blanket `*.jsonl`, and `.gitignore:79` ignores
 * `.pi/logs/`. That is exactly right for DIAG-07 and exactly wrong for a
 * COMMITTED fixture: a `tests/fixtures/wire-sample.jsonl` would be silently
 * untracked, so CI would run against a file that is not there — a green run
 * over absent data. **No fixture this helper reads may be committed with a
 * `.jsonl` extension.** Fixtures live inline in the test file, or carry a
 * `.jsonl.txt` suffix. Files written into a temp dir at run time are unaffected
 * and may use the real extension.
 *
 * ---------------------------------------------------------------------------
 * Cleanup safety
 * ---------------------------------------------------------------------------
 * {@link withTempLogCwd} only ever removes a path it created itself with
 * `mkdtempSync` under a `kypi-logs-` prefix. `rmSync` is never called on a
 * caller-supplied path. [threat T-02-01-01]
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create a temp working directory, await `fn` with it, then remove it.
 *
 * Asynchronous by design: the log writers under test append inside real
 * sessions, so the callback is usually async. Unlike `withStubBin` in
 * `./stub-bin.ts` — which rejects a thenable because it deletes its directory
 * the instant the callback returns — this helper awaits first and removes
 * afterwards, in a `finally`, so a thrown assertion still cleans up.
 */
export async function withTempLogCwd<T>(fn: (cwd: string) => T | Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "kypi-logs-"));
	try {
		return await fn(dir);
	} finally {
		try {
			// maxRetries is the Windows convention in this repo: handles linger.
			rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		} catch {
			// A leftover temp dir is noise, not a failure. Never mask a real
			// assertion result behind a cleanup error. [threat T-02-01-05]
		}
	}
}

/**
 * Sorted names of the files directly under `dir`.
 *
 * Returns `[]` when the directory does not exist, because "the writer created
 * no log at all" and "the writer created an empty directory" are the same
 * finding for a rotation test, and making the caller guard `existsSync` first
 * is how one of them gets forgotten. Directories are excluded; only files are
 * named.
 */
export function logFilesIn(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => statSync(join(dir, name)).isFile())
		.sort();
}

/**
 * Strict JSONL reader. Throws on any line that is not valid JSON.
 *
 * The trailing empty segment after the final newline is dropped; every other
 * line is parsed. Use this for a file the test itself wrote — there a bad line
 * is a bug in the writer and must be loud.
 */
export function readJsonl(path: string): unknown[] {
	const text = readFileSync(path, "utf-8");
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines.map((line) => JSON.parse(line) as unknown);
}

/** What {@link readTornSafe} found: the records, and the lines it could not read. */
export interface TornSafeResult {
	records: unknown[];
	/** Raw text of every line that failed to parse, in file order. */
	unparseable: string[];
}

/**
 * Tolerant JSONL reader. Never throws on a malformed line.
 *
 * A torn record is a measurement, not an exception — see the module docstring.
 * Assert on `unparseable.length`; the raw text is kept so the failure message
 * can show what tore rather than only how many did.
 */
export function readTornSafe(path: string): TornSafeResult {
	const text = readFileSync(path, "utf-8");
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") {
		lines.pop();
	}

	const records: unknown[] = [];
	const unparseable: string[] = [];
	for (const line of lines) {
		try {
			records.push(JSON.parse(line) as unknown);
		} catch {
			unparseable.push(line);
		}
	}
	return { records, unparseable };
}
