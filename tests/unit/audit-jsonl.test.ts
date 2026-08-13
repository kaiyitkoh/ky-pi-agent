/**
 * SAFE-14 — the audit writer records ALLOW and BLOCK, imports nothing from
 * diagnostics, and cannot delete or be deleted by another stream's logs.
 *
 * STRUCTURAL ANALOG OF `tests/unit/jsonl-rotation.test.ts`, scoped to the one
 * requirement Phase 2 never had reason to prove: a log of blocks alone cannot
 * answer "was the guard even loaded?" (Pitfall 15's exact failure signature).
 * The allow-and-block-both-present assertion below is the one with no Phase 2
 * precedent.
 *
 * Real filesystem throughout, via `withTempLogCwd` — nothing is written
 * inside this repository.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { logDir, logPath } from "../../.pi/lib/jsonl.ts";
import {
	pruneAuditLogs,
	writeAuditRow,
	type AuditRowInput,
} from "../../.pi/extensions/safety/audit.ts";
import { AUDIT_LOG_BASE, type AuditRow } from "../../.pi/extensions/safety/schema.ts";
import { pruneLogs as diagnosticsPruneLogs } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { TURNS_LOG_BASE, WIRE_LOG_BASE } from "../../.pi/extensions/diagnostics/schema.ts";
import { logFilesIn, readJsonl, withTempLogCwd } from "../helpers/logs.ts";

/** A minimal ALLOW row. */
function allowRow(cwd: string): AuditRowInput {
	return {
		event: "bash_call",
		tool: "bash",
		command: "git status",
		cwd,
		verdict: "allow",
		reason: "read-only",
	};
}

/** A minimal BLOCK row. */
function blockRow(cwd: string): AuditRowInput {
	return {
		event: "bash_call",
		tool: "bash",
		command: "git push origin main",
		cwd,
		verdict: "block",
		reason: "writes blocked on protected branch",
	};
}

/** Write a `<base>-<now minus days>.jsonl` fixture directly, bypassing the writer. */
function plant(dir: string, base: string, days: number, now: Date): string {
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
	const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate(),
	).padStart(2, "0")}`;
	const path = join(dir, `${base}-${stamp}.jsonl`);
	writeFileSync(path, `${JSON.stringify({ base, ageDays: days })}\n`, "utf-8");
	return path;
}

describe("SAFE-14 — writeAuditRow records both verdicts in one dated file", () => {
	it("writes an allow row and a block row into the same file, both readable", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 14, 9, 0, 0);

			const allowPath = writeAuditRow(cwd, allowRow(cwd), { now });
			const blockPath = writeAuditRow(cwd, blockRow(cwd), { now });

			expect(allowPath, "writeAuditRow must return the path it wrote on success").toBeDefined();
			expect(blockPath).toEqual(allowPath);

			const rows = readJsonl(allowPath as string) as AuditRow[];
			expect(
				rows.some((r) => r.verdict === "allow"),
				"an allow row must be present — a block-only log cannot answer whether the guard even " +
					"loaded (Pitfall 15's failure signature)",
			).toBe(true);
			expect(
				rows.some((r) => r.verdict === "block"),
				"a block row must be present",
			).toBe(true);
		});
	});

	it("writes to <cwd>/.pi/logs/audit-YYYY-MM-DD.jsonl", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 14, 9, 0, 0);
			const written = writeAuditRow(cwd, allowRow(cwd), { now });
			expect(written).toBe(logPath(cwd, AUDIT_LOG_BASE, now));
			expect(written).toContain("audit-2026-08-14.jsonl");
		});
	});

	it("every row carries exactly ts, event, tool, command, cwd, verdict, reason, pid", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 14, 9, 0, 0);
			const written = writeAuditRow(cwd, blockRow(cwd), { now });
			const [row] = readJsonl(written as string) as AuditRow[];

			expect(
				Object.keys(row).sort(),
				"the row must carry exactly the audited field list — nothing more, nothing less",
			).toEqual(["command", "cwd", "event", "pid", "reason", "tool", "ts", "verdict"].sort());

			expect(typeof row.ts).toBe("number");
			expect(typeof row.pid).toBe("number");
		});
	});

	it("never writes tool output or file contents, even when the caller supplies them", async () => {
		await withTempLogCwd(async (cwd) => {
			const now = new Date(2026, 7, 14, 9, 0, 0);
			const poisoned = {
				...blockRow(cwd),
				// Fields NOT in AuditRowInput's declared shape, forced past the type
				// checker to prove the writer does not spread its input verbatim.
				toolOutput: "DASHSCOPE_API_KEY=sk-leaked-value",
				fileContents: "the full body of a .env file",
			} as AuditRowInput;

			const written = writeAuditRow(cwd, poisoned, { now });
			const [row] = readJsonl(written as string) as Record<string, unknown>[];

			expect(row.toolOutput, "tool output must never reach the audit row").toBeUndefined();
			expect(row.fileContents, "file contents must never reach the audit row").toBeUndefined();
		});
	});

	it("adversarial row content cannot steer the write outside the log directory", async () => {
		await withTempLogCwd(async (cwd) => {
			const written = writeAuditRow(cwd, {
				event: "../../evil",
				tool: "../evil",
				command: "rm -rf / #",
				cwd: "../../../etc",
				verdict: "block",
				reason: "../../evil",
			});

			expect(
				written,
				"none of the row's string fields are path components — only the fixed AUDIT_LOG_BASE " +
					"constant is, so adversarial content in command/reason/etc. cannot place the file " +
					"anywhere but inside the log directory",
			).toBeDefined();
			expect((written as string).startsWith(logDir(cwd))).toBe(true);
		});
	});

	it("swallows a write failure and returns undefined rather than throwing into the caller", async () => {
		await withTempLogCwd(async (cwd) => {
			const dir = logDir(cwd);
			// Occupy the exact path the writer needs as a DIRECTORY with a plain
			// file instead, so `mkdirSync(dir, { recursive: true })` fails. A real
			// filesystem failure, not a mock -- the same discipline every other
			// writer test in this repo uses.
			mkdirSync(dirname(dir), { recursive: true });
			writeFileSync(dir, "occupying the log directory's path with a file");

			let threw = false;
			let result: string | undefined;
			try {
				result = writeAuditRow(cwd, blockRow(cwd));
			} catch {
				threw = true;
			}

			expect(
				threw,
				"a failed audit write must never throw into the caller's control flow -- that could turn " +
					"a BLOCK into an unhandled exception a guard's caller treats as an allow",
			).toBe(false);
			expect(result, "on failure writeAuditRow must return undefined, not a path").toBeUndefined();
		});
	});
});

describe("SAFE-14 / T-04-14 — retention is ownership-scoped in both directions", () => {
	it("pruneAuditLogs deletes an aged audit log and leaves an aged wire log untouched", async () => {
		await withTempLogCwd(async (cwd) => {
			const dir = logDir(cwd);
			mkdirSync(dir, { recursive: true });
			const now = new Date(2026, 7, 14, 9, 0, 0);

			const agedAudit = plant(dir, AUDIT_LOG_BASE, 40, now);
			const agedWire = plant(dir, WIRE_LOG_BASE, 40, now);

			const deleted = pruneAuditLogs(cwd, { retentionDays: 14, now });

			expect(deleted).toEqual([agedAudit]);
			expect(
				logFilesIn(dir),
				"the foreign wire log must survive a prune scoped to the audit stream",
			).toContain(basename(agedWire));
		});
	});

	it("the diagnostics binding's prune leaves an aged audit log untouched (the converse)", async () => {
		await withTempLogCwd(async (cwd) => {
			const dir = logDir(cwd);
			mkdirSync(dir, { recursive: true });
			const now = new Date(2026, 7, 14, 9, 0, 0);

			const agedAudit = plant(dir, AUDIT_LOG_BASE, 40, now);
			const agedTurns = plant(dir, TURNS_LOG_BASE, 40, now);

			const deleted = diagnosticsPruneLogs(cwd, { retentionDays: 14, now });

			expect(deleted).toEqual([agedTurns]);
			expect(
				logFilesIn(dir),
				"the audit log must survive a prune scoped to the diagnostics streams -- neither binding " +
					"may delete the other's logs",
			).toContain(basename(agedAudit));
		});
	});
});
