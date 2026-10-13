/**
 * Temp `.pi/logs` fixtures and two JSONL readers: {@link readTornSafe} reports torn lines as a measurement (the
 * concurrent-append claim needs the count), {@link readJsonl} throws because a bad line in a test's own file is a bug.
 * `.gitignore` ignores `*.jsonl`, so a committed fixture must not use that extension or CI reads an absent file.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "vitest";

import { AUDIT_LOG_BASE, type AuditRow } from "../../.pi/extensions/safety/schema.ts";
import { logPath } from "../../.pi/lib/jsonl.ts";

/** Awaits `fn` in a fresh temp directory, removing it in a `finally` even when an assertion throws. */
export async function withTempLogCwd<T>(fn: (cwd: string) => T | Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "kypi-logs-"));
	try {
		return await fn(dir);
	} finally {
		try {
			// maxRetries is the Windows convention in this repo: handles linger.
			rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		} catch {
			// A leftover temp dir must never mask the test's own result.
		}
	}
}

/** Sorted file names directly under `dir`; `[]` when it does not exist, the same finding as an empty one. */
export function logFilesIn(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => statSync(join(dir, name)).isFile())
		.sort();
}

/** Strict JSONL reader: throws on any line that is not valid JSON. */
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

/** Tolerant JSONL reader: never throws, keeping each unparseable line so a failure can show what tore. */
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

/** Today's safety audit rows for `cwd`. A missing file means the safety extension never loaded: it must load at user scope. */
export function readAudit(cwd: string): Partial<AuditRow>[] {
	const file = logPath(cwd, AUDIT_LOG_BASE);
	if (!existsSync(file)) throw new Error(`${file} does not exist: the safety extension never wrote an audit log (it must load at user scope)`);
	return readJsonl(file) as Partial<AuditRow>[];
}

/** Fails when `rows` is empty, so allow/block assertions over it cannot pass vacuously. */
export function assertAuditNonEmpty(rows: readonly unknown[]): void {
	expect(rows.length, "audit file is empty -- the assertions below would be vacuous").toBeGreaterThan(0);
}
