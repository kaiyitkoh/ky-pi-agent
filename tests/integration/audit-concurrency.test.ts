/**
 * SAFE-14 -- four concurrent processes append allow-and-block audit rows to
 * one shared `audit-*.jsonl` and nothing tears, nothing is lost, and rotation
 * racing a concurrent append does not drop a record either.
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
 * Rotation under concurrency (case 2)
 * ---------------------------------------------------------------------------
 * `.pi/lib/jsonl.ts`'s own docstring names the hazard precisely: a held file
 * descriptor would keep writing into a file that a SIBLING process just
 * renamed away, so every record after that rotation would land in the
 * rotated file and be lost from the live one. The real writer avoids this by
 * opening, writing and closing per record (`appendFileSync`, never a
 * stream), and by NEVER losing a record even when its own `renameSync`
 * throws -- "Rotation failed; the next append will simply keep growing the
 * live file rather than losing the record" (`.pi/lib/jsonl.ts` `rotate()`
 * docstring). Case 2 drives four children against a deliberately tiny
 * `rotateBytes` cap so many renames fire WHILE other children are still
 * appending, replicating that exact race in each child's own append loop
 * (stat, compare against the cap, attempt a rename, swallow a failed one,
 * append unconditionally) -- and then sums every fragment (the live file
 * plus every rotated one) and asserts the total record count survived
 * intact.
 *
 * The generated children are written as `.mjs`, never `.js`: `.JS` is in
 * PATHEXT on Windows and Windows Script Host cannot run ESM
 * [VERIFIED: tests/helpers/stub-bin.ts:20-35].
 */
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { logDir, logPath } from "../../.pi/lib/jsonl.ts";
import { AUDIT_LOG_BASE, type AuditRow } from "../../.pi/extensions/safety/schema.ts";
import { readTornSafe, withTempLogCwd } from "../helpers/logs.ts";

/** One label per child process. */
const LABELS = ["A", "B", "C", "D"] as const;

/** Records each child appends in case 1 (no rotation). 4 x 250 = 1000 lines total. */
const RECORDS_PER_CHILD = 250;

/** Records each child appends in case 2 (rotation forced). Kept small: many rotations, bounded runtime. */
const RECORDS_PER_CHILD_ROTATED = 120;

/** Milliseconds the parent allows for every child to boot before the barrier lifts. */
const BARRIER_LEAD_MS = 500;

/** The full field set every {@link AuditRow} must carry -- no more, no fewer. */
const AUDIT_ROW_FIELDS = ["ts", "event", "tool", "command", "cwd", "verdict", "reason", "pid"].sort();

/** What a child prints on stdout when it is done. */
interface ChildReport {
	label: string;
	written: number;
	startedAt: number;
	finishedAt: number;
	pid: number;
}

/**
 * Source of the case-1 child: plain concurrent appends of AuditRow-shaped
 * records, no rotation logic. Alternates `verdict` by record index so BOTH
 * "allow" and "block" appear from every child, not just across children.
 */
function childSourcePlain(): string {
	return [
		"// Generated child -- see tests/integration/audit-concurrency.test.ts.",
		"// Lives in a temp dir and is deleted with it.",
		'import { appendFileSync, writeSync } from "node:fs";',
		"",
		"const [file, label, countRaw, startAtRaw] = process.argv.slice(2);",
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
		"\tconst row = {",
		"\t\tts: Date.now(),",
		'\t\tevent: "bash_call",',
		'\t\ttool: "bash",',
		"\t\tcommand: `cmd-${label}-${i}`,",
		'\t\tcwd: "/tmp/kypi-audit-concurrency",',
		'\t\tverdict: i % 2 === 0 ? "allow" : "block",',
		"\t\treason: `reason-${label}-${i}`,",
		"\t\tpid: process.pid,",
		"\t};",
		'\tappendFileSync(file, JSON.stringify(row) + "\\n", "utf8");',
		"}",
		"const finishedAt = Date.now();",
		"",
		'writeSync(1, JSON.stringify({ label, written: count, startedAt, finishedAt, pid: process.pid }));',
		"process.exitCode = 0;",
		"",
	].join("\n");
}

/**
 * Source of the case-2 child: the SAME AuditRow-shaped appends, but each
 * iteration first checks the live file's size against `cap` and attempts a
 * rename-based rotation when the next record would cross it -- replicating
 * `.pi/lib/jsonl.ts`'s own rotate-before-write shape, including swallowing a
 * failed rename (a sibling process may have already rotated the same file)
 * and still appending unconditionally afterward, so no record is EVER
 * dropped on account of losing a rotation race.
 */
function childSourceRotating(): string {
	return [
		"// Generated child -- see tests/integration/audit-concurrency.test.ts.",
		"// Lives in a temp dir and is deleted with it.",
		'import { appendFileSync, renameSync, statSync } from "node:fs";',
		'import { writeSync } from "node:fs";',
		"",
		"const [file, label, countRaw, startAtRaw, capRaw] = process.argv.slice(2);",
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
		"let rotations = 0;",
		"for (let i = 0; i < count; i++) {",
		"\tconst row = {",
		"\t\tts: Date.now(),",
		'\t\tevent: "bash_call",',
		'\t\ttool: "bash",',
		"\t\tcommand: `cmd-${label}-${i}`,",
		'\t\tcwd: "/tmp/kypi-audit-concurrency",',
		'\t\tverdict: i % 2 === 0 ? "allow" : "block",',
		"\t\treason: `reason-${label}-${i}`,",
		"\t\tpid: process.pid,",
		"\t};",
		'\tconst text = JSON.stringify(row) + "\\n";',
		"\tconst bytes = Buffer.byteLength(text, \"utf8\");",
		"",
		"\tlet size = 0;",
		"\ttry {",
		"\t\tsize = statSync(file).size;",
		"\t} catch {",
		"\t\t// Absent file: nothing to rotate yet.",
		"\t}",
		"\tif (size > 0 && size + bytes > cap) {",
		"\t\tconst rotated = `${file}.${process.pid}-${i}.rotated.jsonl`;",
		"\t\ttry {",
		"\t\t\trenameSync(file, rotated);",
		"\t\t\trotations++;",
		"\t\t} catch {",
		"\t\t\t// A sibling process won the race and rotated first. Never throw --",
		"\t\t\t// the append below still lands, on whichever file exists at `file`",
		"\t\t\t// (freshly created if the rename above just moved it away).",
		"\t\t}",
		"\t}",
		"\tappendFileSync(file, text, \"utf8\");",
		"}",
		"const finishedAt = Date.now();",
		"",
		'writeSync(1, JSON.stringify({ label, written: count, startedAt, finishedAt, pid: process.pid, rotations }));',
		"process.exitCode = 0;",
		"",
	].join("\n");
}

/** Run one child to completion, returning its parsed report. */
function runChild(script: string, args: string[]): Promise<ChildReport & { rotations?: number }> {
	return new Promise((resolve, reject) => {
		// `process.execPath` is the node executable, not a `.cmd` shim, so
		// `shell` stays false and the DEP0190 quoting hazard does not arise.
		const child = spawn(process.execPath, [script, ...args], {
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
				resolve(JSON.parse(stdout) as ChildReport & { rotations?: number });
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
			writeFileSync(script, childSourcePlain(), "utf-8");

			const startAt = Date.now() + BARRIER_LEAD_MS;
			const reports = await Promise.all(
				LABELS.map((label) =>
					runChild(script, [target, label, String(RECORDS_PER_CHILD), String(startAt)]),
				),
			);

			expect(reports.length, "every child must have reported").toBe(LABELS.length);

			// --- the concurrency barrier --------------------------------------------
			const latestStart = Math.max(...reports.map((r) => r.startedAt));
			const earliestFinish = Math.min(...reports.map((r) => r.finishedAt));
			expect(
				latestStart,
				"the four children must have overlapped in time -- the latest start has to precede the " +
					"earliest finish. If they ran back to back, a clean line count below proves nothing " +
					"about concurrent appends and this file is a vacuous pass",
			).toBeLessThan(earliestFinish);

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
			expect(
				verdicts.has("allow"),
				"no allow row appeared anywhere across the four concurrent writers",
			).toBe(true);
			expect(
				verdicts.has("block"),
				"no block row appeared anywhere across the four concurrent writers",
			).toBe(true);

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
			writeFileSync(script, childSourceRotating(), "utf-8");

			// Small enough that a single child's own records cross it many times
			// over the run, and small enough that four children racing on the SAME
			// file will collide on the rename mid-run rather than merely at the end.
			const tinyCap = 600;

			const startAt = Date.now() + BARRIER_LEAD_MS;
			const reports = await Promise.all(
				LABELS.map((label) =>
					runChild(script, [
						target,
						label,
						String(RECORDS_PER_CHILD_ROTATED),
						String(startAt),
						String(tinyCap),
					]),
				),
			);

			expect(reports.length, "every child must have reported").toBe(LABELS.length);

			const latestStart = Math.max(...reports.map((r) => r.startedAt));
			const earliestFinish = Math.min(...reports.map((r) => r.finishedAt));
			expect(
				latestStart,
				"the four children must have overlapped in time for the rotation race to be real",
			).toBeLessThan(earliestFinish);

			const totalRotations = reports.reduce((sum, r) => sum + (r.rotations ?? 0), 0);
			expect(
				totalRotations,
				"zero rotations fired across every child -- this case proves nothing about rotation " +
					"if the cap never actually triggered a rename. Raise RECORDS_PER_CHILD_ROTATED or " +
					"lower tinyCap if this ever regresses to 0",
			).toBeGreaterThan(0);

			// --- gather every fragment: the live file plus every rotated one -----------
			const dir = logDir(cwd);
			const liveBaseName = target.slice(dir.length + 1);
			const fragmentNames = readdirSync(dir).filter(
				(name) => name === liveBaseName || name.startsWith(`${liveBaseName}.`),
			);
			expect(
				fragmentNames.length,
				`expected the live file plus at least one rotated fragment; found: ${JSON.stringify(fragmentNames)}`,
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
