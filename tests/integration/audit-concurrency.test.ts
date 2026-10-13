/**
 * Concurrent processes appending audit rows to one shared `audit-*.jsonl`: nothing tears, nothing is lost, and rotation
 * racing an append drops nothing. Children call the real `writeAuditRow` (a `.mjs` loading the `.ts` writer via
 * `--experimental-strip-types` and a `file://` specifier, which Node's ESM loader needs on Windows), are spawned
 * asynchronously behind a shared start instant, and are read with the torn-safe reader so a tear is a measurement.
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

/** `file://` URL of the real writer: Node's native ESM loader rejects a bare Windows path. */
const JSONL_TS = pathToFileURL(join(repoRoot(), ".pi", "lib", "jsonl.ts")).href;
const AUDIT_TS = pathToFileURL(join(repoRoot(), ".pi", "extensions", "safety", "audit.ts")).href;

/** One label per child process. */
const LABELS = ["A", "B", "C", "D"] as const;

/** Records each child appends in case 1 (no rotation). 4 x 250 = 1000 lines total. */
const RECORDS_PER_CHILD = 250;

/**
 * Case 2's per-child record count: long enough that scheduler noise is irrelevant, short enough that total rotations
 * stay inside the writer's fixed `maxRotated = 10` retention, whose by-design purge would otherwise lose records.
 */
const RECORDS_PER_CHILD_ROTATED = 50;

/** ~194-byte records cross this every few records, giving several rotations, still inside the retention window. */
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

/** Case-1 child: real `writeAuditRow` calls, no rotation, alternating verdicts so every child writes both. */
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

/** Case-2 child: the same calls with a tiny `rotateBytes`, so the writer's own rotation fires while siblings append. */
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
		// `process.execPath` is node itself, so `shell` stays false; `--experimental-strip-types` must precede the script.
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

			// The real module's naming, so a change to `logPath`/`AUDIT_LOG_BASE` is noticed.
			const target = logPath(cwd, AUDIT_LOG_BASE);

			const script = join(cwd, "append-audit-child.mjs");
			writeFileSync(script, childSourcePlain(AUDIT_TS), "utf-8");

			const startAt = Date.now() + BARRIER_LEAD_MS;
			const reports = await Promise.all(
				LABELS.map((label) => runChild(script, [cwd, label, String(RECORDS_PER_CHILD), String(startAt)])),
			);

			expect(reports.length, "every child must have reported").toBe(LABELS.length);

			// --- the concurrency barrier --------------------------------------------
			// Bounds the total wall-clock span rather than requiring one shared in-flight instant, which flaked under full-suite
			// contention; four sequential runs would still blow through this bound.
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

			// The same wall-clock-span bound as case 1, for the same reason.
			const overallStart = Math.min(...reports.map((r) => r.startedAt));
			const overallFinish = Math.max(...reports.map((r) => r.finishedAt));
			expect(
				overallFinish - overallStart,
				"the four children's combined wall-clock span is too long to be concurrent execution -- " +
					"if they ran back to back, this case proves nothing about rotation racing a concurrent append",
			).toBeLessThan(5_000);

			// --- gather every fragment: the live file plus every rotated one -----------
			// Whether the writer's own rotation fired is observed as a caller would: the `<stem>.<n>.jsonl` fragments on disk.
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

	// Eight writers and a cap far below the run, with retention far above the rotation count, so any shortfall is a
	// rename race and never the retention window. Repeated, because the race shows in a minority of runs.
	it("case 3 -- eight processes rotating the shared writer many times lose no record across repeated rounds", async () => {
		const writers = 8;
		const perWriter = 60;
		for (let round = 0; round < 3; round++) {
			await withTempLogCwd(async (cwd) => {
				mkdirSync(logDir(cwd), { recursive: true });
				const script = join(cwd, "append-lib-child.mjs");
				writeFileSync(
					script,
					[
						`import { appendJsonl } from ${JSON.stringify(JSONL_TS)};`,
						"const [cwd, label, count, startAt] = process.argv.slice(2);",
						"const wait = Number(startAt) - Date.now();",
						"if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));",
						"for (let i = 0; i < Number(count); i++) {",
						'	appendJsonl(cwd, "stress", { label, i, pad: "x".repeat(150) }, { rotateBytes: 2_000, maxRotated: 200 });',
						"}",
						'process.stdout.write(JSON.stringify({ label, written: Number(count), startedAt: 0, finishedAt: 0, pid: process.pid }));',
						"",
					].join("\n"),
					"utf-8",
				);
				const startAt = Date.now() + BARRIER_LEAD_MS;
				await Promise.all(
					Array.from({ length: writers }, (_, n) => runChild(script, [cwd, `w${n}`, String(perWriter), String(startAt)])),
				);
				const dir = logDir(cwd);
				const fragments = readdirSync(dir).filter((name) => name.startsWith("stress-") && name.endsWith(".jsonl"));
				expect(fragments.length, "the cap must force rotations").toBeGreaterThan(2);
				let total = 0;
				for (const name of fragments) {
					const { records, unparseable } = readTornSafe(join(dir, name));
					expect(unparseable, `round ${round}: torn record in ${name}`).toEqual([]);
					total += records.length;
				}
				expect(total, `round ${round}: records lost across a rotation that raced a sibling`).toBe(writers * perWriter);
				expect(readdirSync(dir).filter((name) => name.endsWith(".lock")), "no rotation lock may be left behind").toEqual([]);
			});
		}
	}, 120_000);
});
