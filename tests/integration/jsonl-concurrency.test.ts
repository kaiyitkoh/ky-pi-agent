/**
 * DIAG-08 — four concurrent processes append to one file and nothing tears.
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT ONE. The claim is about the
 * operating system, not about our code: whether `appendFileSync` from four
 * separate OS processes onto one path produces interleaved-but-whole records or
 * shredded ones. Nothing in-process can answer that. Subagents are separate
 * `pi` child processes [RESEARCH §10.2], so this is the real deployment shape.
 *
 * It reproduces the shape of RESEARCH §10.3's executed finding — 4 processes ×
 * 1500 records of ~950 B → 6000 lines, 0 unparseable — at 4 × 400, which keeps
 * the suite inside its feedback budget while still crossing the boundary the
 * finding is about.
 *
 * ---------------------------------------------------------------------------
 * THE BARRIER, AND WHY THE CHILDREN ARE NOT SPAWNED WITH `spawnSync`
 * ---------------------------------------------------------------------------
 * `spawnSync` blocks until the child exits. Four `spawnSync` calls in a loop
 * run four processes strictly one after another, and a serialised run cannot
 * produce a single interleaved write — the test would go green having proven
 * nothing about concurrency at all. That is this repo's recurring vacuous-pass
 * shape, so the children are spawned asynchronously and awaited together.
 *
 * Overlap is then made deterministic rather than hoped for: the parent computes
 * one wall-clock start instant and passes it to every child, each child sleeps
 * until that instant before its first write, and the test asserts that the
 * latest start precedes the earliest finish — i.e. there was a moment when all
 * four were writing. Without that assertion, four processes that happened to
 * run back to back would still produce 1600 clean lines and still pass.
 *
 * ---------------------------------------------------------------------------
 * Caveats, recorded rather than hidden (RESEARCH §10.3)
 * ---------------------------------------------------------------------------
 * (a) The original measurement, and every run of this test so far, is Windows
 *     only. The macOS leg belongs to CI's `macos-latest` job, which is itself
 *     BOOT-07 and still OUTSTANDING — it has never run. A green result here is
 *     evidence about win32 and about nothing else.
 * (b) POSIX `O_APPEND` atomicity for very large single writes is not formally
 *     guaranteed. The records here are ~950 B, far below any pipe-buffer-sized
 *     threshold, but the guarantee being empirical rather than specified is the
 *     reason the writer stays open-write-close per record and the reason this
 *     test measures rather than assumes.
 *
 * The generated child is written as `.mjs`, never `.js`: `.JS` is in PATHEXT on
 * Windows and Windows Script Host cannot run ESM
 * [VERIFIED: tests/helpers/stub-bin.ts:20-35].
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { logDir, logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { TURNS_LOG_BASE } from "../../.pi/extensions/diagnostics/schema.ts";
import { readTornSafe, withTempLogCwd } from "../helpers/logs.ts";

/** One label per child process. */
const LABELS = ["A", "B", "C", "D"] as const;

/** Records each child appends. 4 × 400 = 1600 lines total. */
const RECORDS_PER_CHILD = 400;

/** Milliseconds the parent allows for every child to boot before the barrier lifts. */
const BARRIER_LEAD_MS = 500;

/** Padding length that puts each serialised record at roughly 950 bytes. */
const PAD_LENGTH = 900;

/** What a child prints on stdout when it is done. */
interface ChildReport {
	label: string;
	written: number;
	startedAt: number;
	finishedAt: number;
}

/**
 * Source of the child process.
 *
 * Built as a joined array of source lines, the house pattern from
 * `tests/helpers/stub-bin.ts:133-163`. `writeSync(1, …)` rather than
 * `console.log` plus `process.exit`, because `process.exit` can truncate a
 * piped stdout mid-flush and would make the report flaky.
 */
function childSource(): string {
	return [
		"// Generated child -- see tests/integration/jsonl-concurrency.test.ts.",
		"// Lives in a temp dir and is deleted with it.",
		'import { appendFileSync, writeSync } from "node:fs";',
		"",
		"const [file, label, countRaw, startAtRaw] = process.argv.slice(2);",
		"const count = Number(countRaw);",
		"const startAt = Number(startAtRaw);",
		`const pad = "x".repeat(${PAD_LENGTH});`,
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
		'\tappendFileSync(file, JSON.stringify({ label, i, pad }) + "\\n", "utf8");',
		"}",
		"const finishedAt = Date.now();",
		"",
		'writeSync(1, JSON.stringify({ label, written: count, startedAt, finishedAt }));',
		"process.exitCode = 0;",
		"",
	].join("\n");
}

/** Run one child to completion, returning its parsed report. */
function runChild(script: string, args: string[]): Promise<ChildReport> {
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
				resolve(JSON.parse(stdout) as ChildReport);
			} catch {
				reject(new Error(`child printed unparseable report ${JSON.stringify(stdout)}`));
			}
		});
	});
}

describe("DIAG-08 — concurrent appends from separate processes", () => {
	it("produces every line, all parseable, with per-label counts intact", async () => {
		await withTempLogCwd(async (cwd) => {
			mkdirSync(logDir(cwd), { recursive: true });

			// The real naming, from the real module: a test that invented its own
			// file name would not notice `logPath` changing shape underneath it.
			const target = logPath(cwd, TURNS_LOG_BASE);

			const script = join(cwd, "append-child.mjs");
			writeFileSync(script, childSource(), "utf-8");

			const startAt = Date.now() + BARRIER_LEAD_MS;
			const reports = await Promise.all(
				LABELS.map((label) =>
					runChild(script, [target, label, String(RECORDS_PER_CHILD), String(startAt)]),
				),
			);

			expect(
				reports.length,
				"every child must have reported. A rejected promise would have thrown above, so this " +
					"guards the case where the label list itself was emptied and the loop ran zero times",
			).toBe(LABELS.length);

			// --- the concurrency the whole test is named for ----------------------
			const latestStart = Math.max(...reports.map((r) => r.startedAt));
			const earliestFinish = Math.min(...reports.map((r) => r.finishedAt));
			expect(
				latestStart,
				"the four children must have overlapped in time — the latest start has to precede the " +
					"earliest finish. If they ran back to back, the 1600 clean lines below prove nothing " +
					"about concurrent appends and this file is a vacuous pass",
			).toBeLessThan(earliestFinish);

			// --- the measurement --------------------------------------------------
			const { records, unparseable } = readTornSafe(target);

			expect(
				unparseable,
				"a torn record is the failure DIAG-08 exists to rule out: two processes' bytes " +
					"interleaved inside one line. `readTornSafe` keeps the raw text so this message shows " +
					"what tore rather than only how much",
			).toEqual([]);

			expect(
				records.length,
				`expected ${LABELS.length} x ${RECORDS_PER_CHILD} lines. A short count means a whole ` +
					"record was lost rather than merely mangled, which a parseability check alone misses",
			).toBe(LABELS.length * RECORDS_PER_CHILD);

			const counts: Record<string, number> = {};
			for (const record of records as { label?: string }[]) {
				const label = record.label ?? "?";
				counts[label] = (counts[label] ?? 0) + 1;
			}
			expect(
				counts,
				"every child's records must all be present. A per-label count is what distinguishes " +
					"'1600 lines arrived' from '1600 lines arrived and one child's 400 overwrote another's'",
			).toEqual(Object.fromEntries(LABELS.map((label) => [label, RECORDS_PER_CHILD])));

			// The record size the RESEARCH measurement used. Asserted rather than
			// commented, so a future edit to PAD_LENGTH cannot quietly shrink the
			// records until the test stops exercising the interesting size.
			const sample = JSON.stringify(records[0]);
			expect(
				Buffer.byteLength(sample, "utf8"),
				"records must stay around the ~950 B size RESEARCH §10.3 measured; a much smaller " +
					"record would fit trivially inside any write buffer and stop testing the boundary",
			).toBeGreaterThan(900);
		});
	});
});
