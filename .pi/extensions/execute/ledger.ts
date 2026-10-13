/**
 * The harness-owned, HMAC-signed record of each /execute slug, kept outside the work tree because the model can edit
 * PROGRESS.md; the safety path guard keeps the key from tool reads. Unverifiable rows throw.
 */
import { spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { workDir } from "../../lib/work-artifacts.ts";
import { HARNESS_LEDGER_SEGMENT } from "../safety/paths.ts";
import { stallDetected } from "./progress.ts";

/** Directory under the git common dir; the safety path guard refuses any tool path through a segment of this name. */
export const LEDGER_DIR = HARNESS_LEDGER_SEGMENT;

/** What a task may not change once pinned: PLAN.md sits in the work tree, so the model can edit it mid-run. */
export interface PinnedTask {
	readonly id: string;
	readonly path: string | null;
	readonly verificationCommand: string | null;
}

export type LedgerRow =
	| { readonly kind: "base"; readonly sha: string; readonly allowance: readonly string[]; readonly reason: string; readonly tasks?: readonly PinnedTask[] }
	| { readonly kind: "rejected"; readonly taskId: string; readonly count: number | null }
	| { readonly kind: "reset"; readonly taskId: string }
	| { readonly kind: "accepted"; readonly taskId: string; readonly sha: string; readonly entry: string };

const KEY_FILE = "key";
const KEY_BYTES = 32;

function ledgerRoot(cwd: string): string {
	const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (r.status !== 0) throw new Error(`execute: cannot locate the git directory in ${cwd} for the harness ledger`);
	return join(resolve(cwd, (r.stdout ?? "").trim()), LEDGER_DIR);
}

/** The ledger file for `slug` in this worktree; the common dir is shared, so the name carries the worktree's top level. */
export function ledgerFile(cwd: string, slug: string): string {
	workDir(cwd, slug);
	const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (top.status !== 0) throw new Error(`execute: cannot locate the worktree root in ${cwd} for the harness ledger`);
	const worktree = createHash("sha256").update(resolve((top.stdout ?? "").trim())).digest("hex").slice(0, 12);
	return join(ledgerRoot(cwd), `${slug}.${worktree}.jsonl`);
}

function signingKey(root: string): Buffer {
	const file = join(root, KEY_FILE);
	if (existsSync(file)) return Buffer.from(readFileSync(file, "utf-8").trim(), "hex");
	// A lost key beside existing rows must never read as a fresh start.
	if (existsSync(root) && readdirSync(root).some((f) => f.endsWith(".jsonl"))) {
		throw new Error(`execute: the ledger key ${file} is missing, so the recorded rows cannot be verified -- refusing`);
	}
	mkdirSync(root, { recursive: true });
	const key = randomBytes(KEY_BYTES);
	writeFileSync(file, key.toString("hex"), { encoding: "utf-8", mode: 0o600 });
	return key;
}

const sign = (key: Buffer, body: string): string => createHmac("sha256", key).update(body).digest("hex");

/** Append one signed row; the slug is inside the signed body, so a row cannot be moved to another slug's file. */
export function appendLedger(cwd: string, slug: string, row: LedgerRow): void {
	const file = ledgerFile(cwd, slug);
	const body = JSON.stringify({ slug, ...row });
	appendFileSync(file, `${JSON.stringify({ body, mac: sign(signingKey(dirname(file)), body) })}\n`, "utf-8");
}

/** Every row for `slug`, oldest first. Throws when any row fails its signature or names another slug. */
export function readLedger(cwd: string, slug: string): readonly LedgerRow[] {
	const file = ledgerFile(cwd, slug);
	if (!existsSync(file)) return [];
	const key = signingKey(dirname(file));
	return readFileSync(file, "utf-8").split("\n").filter((l) => l.trim() !== "").map((line, i) => {
		const tampered = new Error(`execute: row ${i + 1} of the harness ledger ${file} fails its signature -- the record was altered; refusing`);
		let parsed: { body?: unknown; mac?: unknown };
		try {
			parsed = JSON.parse(line) as typeof parsed;
		} catch {
			throw tampered;
		}
		const { body, mac } = parsed;
		if (typeof body !== "string" || typeof mac !== "string" || mac.length !== sign(key, body).length) throw tampered;
		if (!timingSafeEqual(Buffer.from(sign(key, body)), Buffer.from(mac))) throw tampered;
		const row = JSON.parse(body) as LedgerRow & { slug?: string };
		if (row.slug !== slug) throw tampered;
		return row;
	});
}

/** Drift base: the latest accepted commit or pinned base, whichever came later. */
export function ledgerBase(rows: readonly LedgerRow[]): string | undefined {
	const last = rows.filter((r) => r.kind === "base" || r.kind === "accepted").at(-1);
	return last !== undefined && "sha" in last ? last.sha : undefined;
}

/** The write allowance pinned with the latest base, so a widened SPEC/PLAN cannot absorb drift unnoticed. */
export function pinnedAllowance(rows: readonly LedgerRow[]): readonly string[] | undefined {
	const base = rows.filter((r) => r.kind === "base").at(-1);
	return base?.kind === "base" ? base.allowance : undefined;
}

/** The task list pinned with the latest base; undefined when no base, or a base written before tasks were pinned. */
export function pinnedTasks(rows: readonly LedgerRow[]): readonly PinnedTask[] | undefined {
	const base = rows.filter((r) => r.kind === "base").at(-1);
	return base?.kind === "base" ? base.tasks : undefined;
}

export function tasksOf(tasks: readonly { readonly id: string; readonly path?: string; readonly verificationCommand?: string }[]): readonly PinnedTask[] {
	return tasks.map((t) => ({ id: t.id, path: t.path ?? null, verificationCommand: t.verificationCommand ?? null }));
}

/** One line per task, so a re-pin prompt shows exactly what moved. */
export function renderTasks(tasks: readonly PinnedTask[] | undefined): string {
	return tasks === undefined ? "(none pinned)" : tasks.map((t) => `${t.id} ${t.path ?? "-"} | verify: ${t.verificationCommand ?? "(none)"}`).join("\n");
}

export function acceptedEntries(rows: readonly LedgerRow[]): readonly { readonly taskId: string; readonly sha: string; readonly entry: string }[] {
	return rows.flatMap((r) => (r.kind === "accepted" ? [r] : []));
}

/** Rejected attempts for `taskId` since its last reset, and whether the recorded count stopped dropping between the last two. */
export function attemptState(rows: readonly LedgerRow[], taskId: string): { readonly attempts: number; readonly stalled: boolean } {
	let counts: (number | null)[] = [];
	for (const r of rows) {
		if (r.kind === "reset" && r.taskId === taskId) counts = [];
		if (r.kind === "rejected" && r.taskId === taskId) counts.push(r.count);
	}
	const [prev, cur] = counts.slice(-2);
	return { attempts: counts.length, stalled: typeof prev === "number" && typeof cur === "number" && stallDetected(prev, cur) };
}

/** The sorted union, so the same allowance always compares equal. */
export function allowanceOf(spec: readonly string[], plan: readonly string[]): readonly string[] {
	return [...new Set([...spec, ...plan])].sort();
}

/** The latest user re-pin, if any, and the accepted commits recorded before it, which a rebase may have replaced. */
export function latestRepin(rows: readonly LedgerRow[]): { readonly sha: string; readonly before: ReadonlySet<string> } | undefined {
	const bases = rows.flatMap((r, i) => (r.kind === "base" ? [i] : []));
	const at = bases.length > 1 ? bases.at(-1) : undefined;
	const row = at === undefined ? undefined : rows[at];
	if (at === undefined || row?.kind !== "base") return undefined;
	return { sha: row.sha, before: new Set(acceptedEntries(rows.slice(0, at)).map((e) => e.sha)) };
}
