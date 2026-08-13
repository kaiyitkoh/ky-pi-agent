/**
 * DIAG-08 — rotation, retention and path confinement, against a real filesystem.
 *
 * No mocks and no in-memory fs. The whole claim is about what `renameSync` and
 * `unlinkSync` do to real files, so faking either would leave the requirement
 * asserted nowhere. Every case runs inside `withTempLogCwd`, which only ever
 * removes a directory it created itself under a `kypi-logs-` prefix.
 *
 * THE ROTATION ASSERTION IS RECORD-FOR-RECORD, NOT FILE-EXISTENCE. "a rotated
 * file appeared" is satisfied by a writer that renames and then drops the next
 * fifty records on the floor. What matters is that the union of live plus
 * rotated files, read oldest-first, is exactly the sequence that was appended —
 * nothing lost across the rename, nothing duplicated. That is the property
 * RESEARCH §10.3 measured and the one a later reader of `turns-*.jsonl` relies
 * on when they count turns.
 *
 * DETERMINISM. Record size is computed, not guessed: `makeRecord` pads every
 * record to exactly {@link RECORD_BYTES} serialised bytes including its
 * newline, so with a cap of `RECORD_BYTES * 8` the rotation boundaries are
 * arithmetic rather than an approximation that drifts when a field is renamed.
 * Retention injects `now` rather than back-dating mtimes, because mtime
 * manipulation behaves differently on Windows and macOS and the requirement is
 * about the date stamp in the file name anyway.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	appendJsonl,
	logDir,
	logPath,
	pruneLogs,
	type AppendOptions,
} from "../../.pi/extensions/diagnostics/jsonl.ts";
import { TURNS_LOG_BASE } from "../../.pi/extensions/diagnostics/schema.ts";
import { logFilesIn, readTornSafe, withTempLogCwd } from "../helpers/logs.ts";

/** Exact serialised size of every record below, newline included. */
const RECORD_BYTES = 500;

/** Records per file at {@link ROTATE_BYTES}. Chosen so boundaries are exact. */
const PER_FILE = 8;

/** Size cap used by every rotation case. */
const ROTATE_BYTES = RECORD_BYTES * PER_FILE;

/** The value planted in record 1, so "the oldest content" is identifiable by string. */
const OLDEST_MARKER = "OLDEST-RECORD-MARKER";

/**
 * A record whose serialised line is exactly {@link RECORD_BYTES} bytes.
 *
 * The padding is computed from the real serialisation rather than eyeballed;
 * a hand-tuned constant would silently stop being exact the first time a field
 * name changes, and every boundary assertion below would then be off by one
 * with no explanation.
 */
function makeRecord(i: number, marker = ""): { i: number; marker: string; pad: string } {
	const overhead = Buffer.byteLength(JSON.stringify({ i, marker, pad: "" }), "utf8") + 1;
	return { i, marker, pad: "p".repeat(RECORD_BYTES - overhead) };
}

/** `<base>-YYYY-MM-DD.jsonl` → `<base>-YYYY-MM-DD.<n>.jsonl`. */
function rotatedPath(live: string, n: number): string {
	return `${live.slice(0, -".jsonl".length)}.${n}.jsonl`;
}

/** Append `count` records numbered from 1, returning the ones that were written. */
function appendRun(
	cwd: string,
	count: number,
	opts: AppendOptions,
): { i: number; marker: string; pad: string }[] {
	const written: { i: number; marker: string; pad: string }[] = [];
	for (let i = 1; i <= count; i++) {
		const record = makeRecord(i, i === 1 ? OLDEST_MARKER : "");
		appendJsonl(cwd, TURNS_LOG_BASE, record, opts);
		written.push(record);
	}
	return written;
}

/** Parse a file, asserting it tore nowhere, and return its records. */
function readIntact(path: string, what: string): unknown[] {
	const { records, unparseable } = readTornSafe(path);
	expect(
		unparseable,
		`${what} (${path}) contains lines that are not valid JSON. A rotation that tears a record ` +
			"loses the turn it described, and DIAG-08 is precisely the claim that it does not",
	).toEqual([]);
	return records;
}

describe("DIAG-08 — size-based rotation loses no record across the rename", () => {
	it("keeps every appended record, in order, across two rotations", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 13, 9, 0, 0);
			const live = logPath(cwd, TURNS_LOG_BASE, now);

			// 20 records at 8 per file: records 1-8 and 9-16 rotate away, 17-20
			// stay live. Two crossings of the cap, which is what the requirement
			// is about — one rotation could be luck.
			const written = appendRun(cwd, 20, { rotateBytes: ROTATE_BYTES, now });

			expect(
				logFilesIn(logDir(cwd)).length,
				"expected one live file plus two rotated ones after crossing the cap twice; a different " +
					"count means rotation fired the wrong number of times",
			).toBe(3);

			// Oldest first: .2 was rotated before .1, which was rotated before the
			// live file was reopened. Reading them in this order must reproduce the
			// append order exactly.
			const inRotationOrder = [
				...readIntact(rotatedPath(live, 2), "the oldest rotated file"),
				...readIntact(rotatedPath(live, 1), "the newest rotated file"),
				...readIntact(live, "the live file"),
			];

			expect(
				inRotationOrder,
				"the union of live plus rotated files, read oldest-first, must equal every record that " +
					"was appended, in order. Anything else means the writer dropped or duplicated records " +
					"across a rename — the exact failure a bare `did a .1 file appear?` assertion misses",
			).toEqual(written);
		});
	});

	it("never lets the live file exceed the cap", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 13, 9, 0, 0);
			const live = logPath(cwd, TURNS_LOG_BASE, now);

			for (let i = 1; i <= 20; i++) {
				appendJsonl(cwd, TURNS_LOG_BASE, makeRecord(i), { rotateBytes: ROTATE_BYTES, now });
				const records = readIntact(live, "the live file");
				expect(
					statSync(live).size,
					`after append ${i} the live file holds ${records.length} records. The cap is checked ` +
						"against size + this record, so the live file must never be larger than the cap — " +
						"a writer that rotates only once it is already over ships oversized files",
				).toBeLessThanOrEqual(ROTATE_BYTES);
			}
		});
	});
});

describe("DIAG-08 — a record larger than the cap is written whole, not dropped", () => {
	/**
	 * THE HONEST HALF OF THE CAP CLAIM.
	 *
	 * `appendJsonl`'s guard is `size > 0 && size + bytes > cap`, so two branches
	 * write unconditionally: an empty or absent file, and the post-rotation path
	 * where `size` was just reset to 0. The docstring used to promise "the live file
	 * is never larger than the cap", full stop, and that is not true for a single
	 * oversized record.
	 *
	 * The behaviour is the RIGHT one — dropping a record loses the turn it describes,
	 * which is the one thing this writer may never do — so this case pins it rather
	 * than treating it as a bug. It also pins the consequence, which is the part a
	 * reader would otherwise be surprised by: the live file is over the cap, so the
	 * NEXT append rotates immediately.
	 *
	 * Untested in both directions before this: every rotation case uses 500-byte
	 * records against a 4000-byte cap, so the branch was never entered.
	 */
	it("writes it whole, then rotates on the very next append", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 13, 9, 0, 0);
			const live = logPath(cwd, TURNS_LOG_BASE);
			// A cap far below one record, so the first append cannot possibly fit.
			const tinyCap = 100;
			const oversized = makeRecord(1, OLDEST_MARKER);

			expect(
				RECORD_BYTES,
				"the fixture record must genuinely exceed the cap, or this case exercises the ordinary " +
					"fitting path and proves nothing about the oversized branch",
			).toBeGreaterThan(tinyCap);

			appendJsonl(cwd, TURNS_LOG_BASE, oversized, { rotateBytes: tinyCap, now });

			expect(
				readIntact(live, "the live file"),
				"THE RECORD MUST SURVIVE. Honouring a size bound by dropping a record would lose the " +
					"turn it describes, and a turn that left no row is indistinguishable from a quiet " +
					"session — the single failure class this phase exists to eliminate",
			).toEqual([oversized]);

			expect(
				statSync(live).size,
				"and it is genuinely over the cap, which is the fact the docstring now states instead " +
					"of the absolute claim it used to make. A file at or under the cap here would mean " +
					"the record was truncated to fit, which is the same loss wearing a different name",
			).toBeGreaterThan(tinyCap);

			// The consequence, pinned so it is documented behaviour rather than a
			// surprise: the live file is already over the cap with `size > 0`, so the
			// guard fires immediately.
			const second = makeRecord(2);
			appendJsonl(cwd, TURNS_LOG_BASE, second, { rotateBytes: tinyCap, now });

			expect(
				readIntact(rotatedPath(live, 1), "the rotated file"),
				"the oversized record must have rotated away intact, not been overwritten",
			).toEqual([oversized]);

			expect(
				readIntact(live, "the live file after the second append"),
				"and the second record is alone in the new live file. Every record still exists exactly " +
					"once across live plus rotated, which is the property DIAG-08 is actually about",
			).toEqual([second]);
		});
	});
});

describe("DIAG-08 — the rotated-file cap bounds disk use, oldest first", () => {
	it("keeps one live plus maxRotated files and drops the oldest content", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 13, 9, 0, 0);
			const maxRotated = 3;

			// 50 records at 8 per file crosses the cap six times, which is past
			// four rotations and therefore past the point where the earliest file
			// must have been unlinked rather than merely shifted.
			appendRun(cwd, 50, { rotateBytes: ROTATE_BYTES, maxRotated, now });

			const files = logFilesIn(logDir(cwd));
			expect(
				files.length,
				`expected at most ${maxRotated + 1} files (one live plus ${maxRotated} rotated) but found ` +
					`${files.join(", ")}. Without this bound a bad day fills the laptop's disk`,
			).toBeLessThanOrEqual(maxRotated + 1);
			expect(
				files.length,
				"expected the cap to be reached, not undershot; fewer files than the cap here would mean " +
					"the run did not actually rotate enough times to exercise the unlink path",
			).toBe(maxRotated + 1);

			// The marker went into record 1, i.e. into the first file written. It
			// must be the content that disappeared — deleting the NEWEST file would
			// also satisfy a file-count assertion, and would be catastrophic.
			const survivingText = files
				.map((name) => readIntact(join(logDir(cwd), name), name))
				.flat()
				.map((r) => JSON.stringify(r))
				.join("\n");

			expect(
				survivingText.includes(OLDEST_MARKER),
				`${OLDEST_MARKER} was planted in the very first record. It must be gone once the cap is ` +
					"exceeded: retention deletes oldest-first. Finding it here means the newest file was " +
					"deleted instead, which is the opposite of the policy",
			).toBe(false);

			// Paired positive: the marker check above is only meaningful if the
			// surviving text is non-empty and does hold the newest records.
			expect(
				survivingText.includes(`"i":50`),
				"the most recent record must survive; if it does not, the absence of the oldest marker " +
					"above proves nothing about ordering — it would just mean everything was deleted",
			).toBe(true);
		});
	});
});

describe("DIAG-08 — retention deletes by date stamp against an injected clock", () => {
	it("keeps files inside the window and deletes the ones past it", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 13, 9, 0, 0);
			const dir = logDir(cwd);
			mkdirSync(dir, { recursive: true });

			/** `turns-<now minus days>.jsonl`, created empty-but-valid. */
			function plant(days: number): string {
				const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
				const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
					d.getDate(),
				).padStart(2, "0")}`;
				const path = join(dir, `${TURNS_LOG_BASE}-${stamp}.jsonl`);
				writeFileSync(path, `${JSON.stringify({ ageDays: days })}\n`, "utf-8");
				return path;
			}

			const survivor1 = plant(1);
			const survivor13 = plant(13);
			const doomed15 = plant(15);
			const doomed40 = plant(40);

			const deleted = pruneLogs(cwd, { retentionDays: 14, now });

			expect(
				deleted,
				"pruneLogs must report exactly the two files past the 14-day window. The 13-day file is " +
					"inside it and the 15-day file is outside it, so an off-by-one in the age arithmetic " +
					"shows up here rather than as silently missing history a fortnight later",
			).toEqual([doomed15, doomed40].sort());

			expect(
				logFilesIn(dir).sort(),
				"the survivors must still be on disk. Asserting only the returned list would pass for a " +
					"prune that reported deletions it never performed",
			).toEqual([basename(survivor1), basename(survivor13)].sort());
		});
	});

	it("never deletes a dated .jsonl this module did not write", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 13, 9, 0, 0);
			const dir = logDir(cwd);
			mkdirSync(dir, { recursive: true });

			/** `<base>-<now minus days>.jsonl`, created empty-but-valid. */
			function plant(base: string, days: number): string {
				const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
				const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
					d.getDate(),
				).padStart(2, "0")}`;
				const path = join(dir, `${base}-${stamp}.jsonl`);
				writeFileSync(path, `${JSON.stringify({ base, ageDays: days })}\n`, "utf-8");
				return path;
			}

			// Both are 40 days old, so AGE cannot be what distinguishes them. The only
			// difference is who wrote them.
			const foreign = plant("foreign", 40);
			const alsoForeign = plant("todo_state", 40);
			const owned = plant(TURNS_LOG_BASE, 40);

			const deleted = pruneLogs(cwd, { retentionDays: 14, now });

			expect(
				deleted,
				"pruneLogs must report ONLY the file it owns. `LOG_NAME_RE`'s first capture group is any " +
					"base name, because the same expression parses the rotation-bucket stem, so a prune " +
					"scoped by name SHAPE deletes another extension's dated JSONL — irreversibly, on every " +
					"session_start, with the unlink error swallowed so nothing anywhere reports it. " +
					"`.pi/logs/` is the most obvious directory name any extension would pick under Pi's " +
					"config dir, and this project composes roughly eleven of them",
			).toEqual([owned]);

			expect(
				logFilesIn(dir).sort(),
				"the foreign files must still be on disk. Asserting only the returned list would pass " +
					"for a prune that deleted them and forgot to mention it",
			).toEqual([basename(foreign), basename(alsoForeign)].sort());
		});
	});

	it("returns an empty list when there is no log directory at all", async () => {
		await withTempLogCwd(async (cwd) => {
			expect(
				pruneLogs(cwd, { now: new Date(2026, 7, 13) }),
				"a session started in a project that has never written a log must not fail, and must " +
					"not claim to have deleted anything",
			).toEqual([]);
		});
	});
});

describe("DIAG-08 / T-02-03-07 — a base name cannot escape the log directory", () => {
	const ESCAPES = ["..", "../evil", "wire/../../evil", "sub/wire", "a\\b", "", ".hidden", "C:evil"] as const;

	it.each(ESCAPES)("refuses the base %j", async (base) => {
		await withTempLogCwd(async (cwd) => {
			expect(
				() => appendJsonl(cwd, base, { x: 1 }),
				`appendJsonl accepted ${JSON.stringify(base)}. A base is a bare stream name from ` +
					"schema.ts; anything carrying a separator or a `..` could place a diagnostic dump " +
					"anywhere in the working tree, outside the gitignored log directory",
			).toThrow();

			expect(
				logFilesIn(logDir(cwd)),
				"the refusal must happen before anything is written; a throw after the append would " +
					"leave the file on disk and only look safe",
			).toEqual([]);
		});
	});

	it("accepts the real stream names, so the refusal above is not refusing everything", async () => {
		await withTempLogCwd(async (cwd) => {
			const path = appendJsonl(cwd, TURNS_LOG_BASE, { x: 1 });
			expect(
				path.startsWith(logDir(cwd)),
				"the shipped base names must still work. Without this pair, a validator that rejected " +
					"every input would pass the escape cases above while breaking the whole subsystem",
			).toBe(true);
		});
	});
});
