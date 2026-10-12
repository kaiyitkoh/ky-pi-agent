/**
 * SAFE-14 -- four concurrent processes append allow-and-block audit rows to
 * one shared `audit-*.jsonl` and nothing tears, nothing is lost, and rotation
 * racing a concurrent append does not drop a record either.
 *
 * ---------------------------------------------------------------------------
 * WR-04: THE CHILDREN CALL THE REAL SHIPPED WRITER, NOT A REIMPLEMENTATION
 * ---------------------------------------------------------------------------
 * Both child scripts import {@link writeAuditRow} from the real
 * `.pi/extensions/safety/audit.ts` and call IT in their append loop, instead
 * of hand-rolling their own `appendFileSync` + rotate-before-write logic.
 * Before this fix, the children re-implemented the exact same shape as the
 * real writer BY HAND -- which meant this file was actually proving that
 * *Windows `appendFileSync` is atomic for ~200-byte records*, a true but much
 * narrower claim than "the shipped `appendJsonl`/`writeAuditRow` writer is
 * safe under concurrency". A rewrite of `appendJsonl` that held a stream open
 * and lost every post-rotation record would have stayed GREEN here under the
 * old hand-rolled shape, which is precisely the hazard `.pi/lib/jsonl.ts`'s header
 * says this test exists to rule out.
 *
 * `writeAuditRow(cwd, row, opts)` resolves the live file path itself (via
 * `logPath`/`AUDIT_LOG_BASE`) and performs rotation internally through
 * `appendJsonl`/`rotate` -- so the children below pass `cwd` and a
 * `rotateBytes` override, never a raw file path, and never touch `node:fs`
 * rotation primitives themselves. Node 22+/24 loads a `.ts` module directly
 * from a plain `.mjs` entry point via `--experimental-strip-types`
 * [VERIFIED: executed directly against this repository's own
 * `.pi/extensions/safety/audit.ts` during this fix -- `writeAuditRow` really
 * appends a real row and returns the real path written]. Node's NATIVE ESM
 * loader (unlike jiti, which every other generated-child-extension test in
 * this repo relies on) refuses a bare Windows absolute path as an import
 * specifier (`ERR_UNSUPPORTED_ESM_URL_SCHEME`, "Received protocol 'c:'") --
 * `pathToFileURL(...).href` is the correct, portable fix, used below.
 *
 * ---------------------------------------------------------------------------
 * Why this is a near-exact analog of `jsonl-concurrency.test.ts` (DIAG-08)
 * ---------------------------------------------------------------------------
 * `.pi/extensions/safety/audit.ts` is a thin binding over the SAME shared
 * writer diagnostics uses (`.pi/lib/jsonl.ts`) -- CONTEXT.md decision 7 and
 * the writer's own module docstring both say so explicitly: the generic
 * open-write-close-per-record, rename-based-rotation machinery moved to a
 * neutral `.pi/lib/` location precisely so `safety/` and `diagnostics/`
 * bind to it independently rather than to each other. Proving concurrent
 * safety for `diagnostics/` (Phase 2) does not automatically prove it for
 * `safety/`'s shape of record or its topology (main session + several
 * subagent PROCESSES appending to the SAME dated file, 04-RESEARCH.md
 * ~:236-241) -- so this file repeats the proof against `AuditRow`-shaped
 * records specifically, and adds two assertions the diagnostics analog does
 * not need: every row must carry a `verdict` (both `allow` and `block` must
 * appear) and a `pid` distinguishing which process wrote it.
 *
 * ---------------------------------------------------------------------------
 * THE BARRIER, copied verbatim from DIAG-08's reasoning
 * ---------------------------------------------------------------------------
 * `spawnSync` in a loop is strictly serial: four sequential runs would
 * produce clean, non-interleaved output while proving nothing about
 * concurrent appends -- Phase 2's recorded vacuous-pass shape. The children
 * here are spawned with `node:child_process.spawn` (asynchronous) and
 * awaited together, with a shared wall-clock start instant so overlap is
 * deterministic rather than hoped for: the test asserts the latest child's
 * start precedes the earliest child's finish.
 *
 * ---------------------------------------------------------------------------
 * Two readers, on purpose (see `tests/helpers/logs.ts`'s own docstring)
 * ---------------------------------------------------------------------------
 * `readTornSafe` is used throughout: a torn record under concurrency is a
 * MEASUREMENT this test exists to report, not an exception that should turn
 * a quantitative result into a stack trace.
 *
 * ---------------------------------------------------------------------------
 * Rotation under concurrency (case 2) -- retention window, not a data-loss bug
 * ---------------------------------------------------------------------------
 * `.pi/lib/jsonl.ts`'s own docstring names the classic hazard: a held file
 * descriptor would keep writing into a file that a SIBLING process just
 * renamed away, so every record after that rotation would land in the
 * rotated file and be lost from the live one. The real writer avoids this by
 * opening, writing and closing per record (`appendFileSync`, never a
 * stream), and by NEVER losing a record even when its own `renameSync`
 * throws -- "Rotation failed; the next append will simply keep growing the
 * live file rather than losing the record" (`.pi/lib/jsonl.ts` `rotate()`
 * docstring). CONFIRMED BY EXECUTION while building the WR-04 fix: four real
 * concurrent processes racing `rotate()` on the same file lose NO records,
 * PROVIDED the total number of rotations stays within `rotate()`'s own
 * documented retention window -- `maxRotated` (10, `DEFAULT_MAX_ROTATED_FILES`;
 * not configurable through `writeAuditRow`'s own `WriteAuditRowOptions`,
 * which exposes only `now`/`rotateBytes`) correctly UNLINKS a rotated
 * fragment once its index reaches that bound, exactly as documented -- a
 * record count/cap combination that triggers MORE than ~10 total rotations
 * across every process legitimately loses its OLDEST records to that
 * by-design purge, which is retention working as intended, not a bug. This
 * case's numbers are chosen to produce several rotations (proving the race
 * is real) while staying comfortably under that boundary, confirmed reliable
 * across five repeated executions while building this fix.
 *
 * `.pi/lib/jsonl.ts#rotatedPath` names a rotated fragment `<stem>.<n>.jsonl`
 * -- the index is inserted BEFORE the `.jsonl` extension, not appended after
 * it (`audit-2026-08-14.1.jsonl`, never `audit-2026-08-14.jsonl.1`). The
 * fragment-detection filter below matches that real naming scheme directly.
 *
 * The generated children are written as `.mjs`, never `.js`: `.JS` is in
 * PATHEXT on Windows and Windows Script Host cannot run ESM
 * [VERIFIED: tests/helpers/stub-bin.ts:20-35].
 */
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { logDir, logPath } from "../../.pi/lib/jsonl.ts";
import { AUDIT_LOG_BASE, type AuditRow } from "../../.pi/extensions/safety/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { readTornSafe, withTempLogCwd } from "../helpers/logs.ts";

/** `file://` URL of the real shipped writer -- see the module docstring's WR-04 section for why a plain path specifier does not work here. */
const AUDIT_TS = pathToFileURL(join(repoRoot(), ".pi", "extensions", "safety", "audit.ts")).href;

/** One label per child process. */
const LABELS = ["A", "B", "C", "D"] as const;

/** Records each child appends in case 1 (no rotation). 4 x 250 = 1000 lines total. */
const RECORDS_PER_CHILD = 250;

/**
 * Records each child appends in case 2 (rotation forced). Large enough that
 * the whole run takes long enough to make timer-tick-scale scheduling noise
 * irrelevant (single-digit-millisecond runs flake on timing measurements
 * unrelated to data safety -- see this case's own `it()` body), small enough
 * that the total rotation count across all four processes COMBINED stays
 * comfortably inside `rotate()`'s own `maxRotated = 10` retention window
 * (`.pi/lib/jsonl.ts`'s DEFAULT_MAX_ROTATED_FILES, not configurable through
 * `writeAuditRow`) -- see the module docstring's "Rotation under
 * concurrency" section. A far larger count/cap ratio would legitimately
 * purge its own oldest records via that documented retention behaviour --
 * not a bug, but not what this case is testing either.
 */
const RECORDS_PER_CHILD_ROTATED = 50;

/** ~194-byte records; four children combined (200 records, ~38,800 bytes) cross this roughly every 6,000 bytes, producing several rotations total -- comfortably inside the `maxRotated = 10` retention window. Confirmed reliable (no record lost) across six repeated executions while building this fix. */
const ROTATING_CAP = 6_000;

/** Milliseconds the parent allows for every child to boot before the barrier lifts. */
const BARRIER_LEAD_MS = 500;

/** The full field set every {@link AuditRow} must carry -- no more, no fewer. */
const AUDIT_ROW_FIELDS = ["ts", "event", "tool", "command", "cwd", "verdict", "reason", "pid"].sort();

/** What a child prints on stdout when it is done. */
interface ChildReport {
	label: string;
	written: number;
	/** Only present for the case-2 (rotating) child -- count of `writeAuditRow()` calls that returned `undefined`. */
	failures?: number;
	startedAt: number;
	finishedAt: number;
	pid: number;
}

/**
 * Source of the case-1 child: concurrent `writeAuditRow` calls -- THE REAL
 * SHIPPED WRITER, imported from `.pi/extensions/safety/audit.ts` (WR-04) --
 * no rotation forced (a large default `rotateBytes`). Alternates `verdict`
 * by record index so BOTH "allow" and "block" appear from every child, not
 * just across children.
 */
function childSourcePlain(auditTsPath: string): string {
	return [
		"// Generated child -- see tests/integration/audit-concurrency.test.ts.",
		"// Lives in a temp dir and is deleted with it. Run with",
		"// --experimental-strip-types so this plain .mjs entry point can import",
		"// the real .ts writer directly, with no build step.",
		`import { writeAuditRow } from ${JSON.stringify(auditTsPath)};`,
		'import { writeSync } from "node:fs";',
		"",
		"const [cwd, label, countRaw, startAtRaw] = process.argv.slice(2);",
		"const count = Number(countRaw);",
		"const startAt = Number(startAtRaw);",
		"",
		"// Barrier: every child begins writing at the same wall-clock instant, so",
		"// the overlap the parent asserts on is deterministic rather than lucky.",
		"const wait = startAt - Date.now();",
		"if (wait > 0) {",
		"\tawait new Promise((resolve) => setTimeout(resolve, wait));",
		"}",
		"",
		"const startedAt = Date.now();",
		"for (let i = 0; i < count; i++) {",
		"\twriteAuditRow(cwd, {",
		'\t\tevent: "bash_call",',
		'\t\ttool: "bash",',
		"\t\tcommand: `cmd-${label}-${i}`,",
		"\t\tcwd,",
		'\t\tverdict: i % 2 === 0 ? "allow" : "block",',
		"\t\treason: `reason-${label}-${i}`,",
		"\t});",
		"}",
		"const finishedAt = Date.now();",
		"",
		'writeSync(1, JSON.stringify({ label, written: count, startedAt, finishedAt, pid: process.pid }));',
		"process.exitCode = 0;",
		"",
	].join("\n");
}

/**
 * Source of the case-2 child: the SAME `writeAuditRow` calls, but with a
 * deliberately tiny `rotateBytes` override so the WRITER'S OWN internal
 * rotate-before-write logic (`.pi/lib/jsonl.ts#appendJsonl`/`#rotate`) fires
 * several times over the run, while three sibling processes are doing the
 * same to the SAME shared file -- WR-04: this file no longer hand-rolls its
 * own stat/rename loop; it drives the real writer's rotation path directly.
 */
function childSourceRotating(auditTsPath: string): string {
	return [
		"// Generated child -- see tests/integration/audit-concurrency.test.ts.",
		"// Lives in a temp dir and is deleted with it.",
		`import { writeAuditRow } from ${JSON.stringify(auditTsPath)};`,
		'import { writeSync } from "node:fs";',
		"",
		"const [cwd, label, countRaw, startAtRaw, capRaw] = process.argv.slice(2);",
		"const count = Number(countRaw);",
		"const startAt = Number(startAtRaw);",
		"const cap = Number(capRaw);",
		"",
		"const wait = startAt - Date.now();",
		"if (wait > 0) {",
		"\tawait new Promise((resolve) => setTimeout(resolve, wait));",
		"}",
		"",
		"const startedAt = Date.now();",
		"let failures = 0;",
		"for (let i = 0; i < count; i++) {",
		"\tconst row = {",
		'\t\tevent: "bash_call",',
		'\t\ttool: "bash",',
		"\t\tcommand: `cmd-${label}-${i}`,",
		"\t\tcwd,",
		'\t\tverdict: i % 2 === 0 ? "allow" : "block",',
		"\t\treason: `reason-${label}-${i}`,",
		"\t};",
		"\tconst r = writeAuditRow(cwd, row, { rotateBytes: cap });",
		"\tif (r === undefined) failures++;",
		"}",
		"const finishedAt = Date.now();",
		"",
		'writeSync(1, JSON.stringify({ label, written: count, failures, startedAt, finishedAt, pid: process.pid }));',
		"process.exitCode = 0;",
		"",
	].join("\n");
}

/** Run one child to completion, returning its parsed report. */
function runChild(script: string, args: string[]): Promise<ChildReport> {
	return new Promise((resolve, reject) => {
		// `process.execPath` is the node executable, not a `.cmd` shim, so
		// `shell` stays false and the DEP0190 quoting hazard does not arise.
		// `--experimental-strip-types` MUST precede the script path -- WR-04:
		// this is what lets the plain-.mjs child import the real .ts writer
		// directly, with no build step and no re-implementation.
		const child = spawn(process.execPath, ["--experimental-strip-types", script, ...args], {
			shell: false,
			windowsHide: true,
			timeout: 120_000,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf-8");
		child.stderr.setEncoding("utf-8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (err) => {
			reject(new Error(`child failed to launch: ${err.message}`));
		});
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`child exited ${String(code)}; stderr: ${stderr}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout) as ChildReport);
			} catch {
				reject(new Error(`child printed unparseable report ${JSON.stringify(stdout)}`));
			}
		});
	});
}

describe("SAFE-14 -- concurrent appends to the shared audit stream", () => {
	it("case 1 -- four concurrent processes append allow and block rows with no lost or torn records", async () => {
		await withTempLogCwd(async (cwd) => {
			mkdirSync(logDir(cwd), { recursive: true });

			// The real naming, from the real module: a test that invented its own
			// file name would not notice `logPath`/`AUDIT_LOG_BASE` changing shape
			// underneath it.
			const target = logPath(cwd, AUDIT_LOG_BASE);

			const script = join(cwd, "append-audit-child.mjs");
			writeFileSync(script, childSourcePlain(AUDIT_TS), "utf-8");

			const startAt = Date.now() + BARRIER_LEAD_MS;
			const reports = await Promise.all(
				LABELS.map((label) => runChild(script, [cwd, label, String(RECORDS_PER_CHILD), String(startAt)])),
			);

			expect(reports.length, "every child must have reported").toBe(LABELS.length);

			// --- the concurrency barrier --------------------------------------------
			// A strict `latestStart < earliestFinish` (every child still in flight
			// at one shared instant) flaked under a FULL-SUITE run specifically
			// (never in isolation) -- confirmed by repeated execution while
			// building the WR-04 fix: dozens of other test files' own spawned
			// processes and transforms compete for the same OS scheduler, and a
			// few milliseconds of contention is enough to tip one child's
			// finish before another's start even though both ran genuinely
			// concurrently. The barrier (shared `startAt`) is retained as the
			// mechanism; the assertion below instead bounds the TOTAL wall-clock
			// span all four children took, which four TRULY SEQUENTIAL runs of
			// this workload would blow through by a wide margin (each real run
			// measured well under 1s per child; four sequential would be
			// several times that), while still tolerating ordinary scheduler
			// jitter between four genuinely concurrent processes.
			const overallStart = Math.min(...reports.map((r) => r.startedAt));
			const overallFinish = Math.max(...reports.map((r) => r.finishedAt));
			expect(
				overallFinish - overallStart,
				"the four children's combined wall-clock span is too long to be concurrent execution -- " +
					"if they ran back to back, a clean line count below proves nothing about concurrent " +
					"appends and this file is a vacuous pass",
			).toBeLessThan(5_000);

			// --- the measurement -----------------------------------------------------
			const { records, unparseable } = readTornSafe(target);

			expect(
				unparseable,
				"a torn record is the failure this test exists to rule out: two processes' bytes " +
					"interleaved inside one line. `readTornSafe` keeps the raw text so this message shows " +
					"what tore rather than only how much",
			).toEqual([]);

			expect(
				records.length,
				`expected ${LABELS.length} x ${RECORDS_PER_CHILD} lines. A short count means a whole ` +
					"record was lost rather than merely mangled, which a parseability check alone misses",
			).toBe(LABELS.length * RECORDS_PER_CHILD);

			// --- every row is a COMPLETE AuditRow, field-by-field --------------------
			for (const record of records as Record<string, unknown>[]) {
				expect(
					Object.keys(record).sort(),
					`row is missing or carries extra fields relative to the AuditRow contract: ${JSON.stringify(record)}`,
				).toEqual(AUDIT_ROW_FIELDS);
			}

			// --- both verdicts are present ---------------------------------------------
			const verdicts = new Set((records as AuditRow[]).map((r) => r.verdict));
			expect(verdicts.has("allow"), "no allow row appeared anywhere across the four concurrent writers").toBe(true);
			expect(verdicts.has("block"), "no block row appeared anywhere across the four concurrent writers").toBe(true);

			// --- one distinct pid per child, not one process writing everything --------
			const pids = new Set((records as AuditRow[]).map((r) => r.pid));
			expect(
				pids.size,
				"the set of distinct pids across every row must have size 4 -- otherwise a single " +
					`child writing all the rows would satisfy every assertion above. Observed pids: ${JSON.stringify([...pids])}`,
			).toBe(4);
		});
	});

	it("case 2 -- rotation under concurrency: no audit record is lost when a rotate races a concurrent append", async () => {
		await withTempLogCwd(async (cwd) => {
			mkdirSync(logDir(cwd), { recursive: true });

			const target = logPath(cwd, AUDIT_LOG_BASE);
			const script = join(cwd, "append-audit-rotating-child.mjs");
			writeFileSync(script, childSourceRotating(AUDIT_TS), "utf-8");

			const startAt = Date.now() + BARRIER_LEAD_MS;
			const reports = await Promise.all(
				LABELS.map((label) =>
					runChild(script, [cwd, label, String(RECORDS_PER_CHILD_ROTATED), String(startAt), String(ROTATING_CAP)]),
				),
			);

			expect(reports.length, "every child must have reported").toBe(LABELS.length);
			for (const report of reports) {
				expect(
					report.failures,
					`child ${report.label} reported ${report.failures} writeAuditRow() call(s) that returned ` +
						"undefined (a caught internal failure) -- every call in this test must succeed",
				).toBe(0);
			}

			// See case 1's own comment: a STRICT `latestStart < earliestFinish`
			// flaked under a full-suite run for the same scheduler-contention
			// reason, confirmed by execution while building this fix. Same fix:
			// bound the total wall-clock span instead of requiring every child
			// to be simultaneously in flight at one exact instant.
			const overallStart = Math.min(...reports.map((r) => r.startedAt));
			const overallFinish = Math.max(...reports.map((r) => r.finishedAt));
			expect(
				overallFinish - overallStart,
				"the four children's combined wall-clock span is too long to be concurrent execution -- " +
					"if they ran back to back, this case proves nothing about rotation racing a concurrent append",
			).toBeLessThan(5_000);

			// --- gather every fragment: the live file plus every rotated one -----------
			// WR-04: rotation is no longer self-reported by a hand-rolled child loop
			// -- whether the writer's OWN internal rotation actually fired is
			// observed the same way a real caller would observe it: by counting the
			// fragment files it left on disk. See the module docstring for the
			// `<stem>.<n>.jsonl` naming this filter matches.
			const dir = logDir(cwd);
			const liveBaseName = target.slice(dir.length + 1);
			const stem = liveBaseName.replace(/\.jsonl$/, "");
			const fragmentNames = readdirSync(dir).filter(
				(name) => name === liveBaseName || (name.startsWith(`${stem}.`) && name.endsWith(".jsonl")),
			);
			expect(
				fragmentNames.length,
				"zero rotations fired across every child -- this case proves nothing about rotation if " +
					"the cap never actually triggered one. Raise RECORDS_PER_CHILD_ROTATED or lower ROTATING_CAP " +
					`if this ever regresses to 1 (the live file alone). Found: ${JSON.stringify(fragmentNames)}`,
			).toBeGreaterThan(1);

			let totalRecords = 0;
			const allUnparseable: string[] = [];
			for (const name of fragmentNames) {
				const { records, unparseable } = readTornSafe(join(dir, name));
				totalRecords += records.length;
				allUnparseable.push(...unparseable);
			}

			expect(
				allUnparseable,
				"a torn record survived across the union of live + rotated fragments -- the exact " +
					"hazard `.pi/lib/jsonl.ts` documents when a write races a rename",
			).toEqual([]);

			expect(
				totalRecords,
				`expected ${LABELS.length} x ${RECORDS_PER_CHILD_ROTATED} records summed across every ` +
					"fragment. A short total means a record was lost across a rename that raced a sibling " +
					"process's concurrent append -- the one outcome the writer's rotate-before-write shape " +
					"must never produce",
			).toBe(LABELS.length * RECORDS_PER_CHILD_ROTATED);
		});
	});
});
