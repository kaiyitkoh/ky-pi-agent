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
	readonly requirementIds?: readonly string[];
	readonly line?: string;
}

/** The SPEC and PLAN content a run is held to; `tasks` and `specHash` are absent from rows written before they were pinned. */
export interface PlanPin {
	readonly allowance: readonly string[];
	readonly tasks?: readonly PinnedTask[];
	readonly specHash?: string;
	readonly reason: string;
}

/** `base` moves the drift base; `pin` re-pins the SPEC and PLAN content only, so it never reads as a rebase. */
export type LedgerRow =
	| ({ readonly kind: "base"; readonly sha: string } & PlanPin)
	| ({ readonly kind: "pin" } & PlanPin)
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

/** The SPEC and PLAN content pinned by the latest `base` or `pin` row; undefined before the first /execute. */
export function pinnedPlan(rows: readonly LedgerRow[]): PlanPin | undefined {
	return rows.filter((r) => r.kind === "base" || r.kind === "pin").at(-1) as PlanPin | undefined;
}

/** The pinned write allowance, so a widened SPEC/PLAN cannot absorb drift unnoticed. */
export function pinnedAllowance(rows: readonly LedgerRow[]): readonly string[] | undefined {
	return pinnedPlan(rows)?.allowance;
}

/** The task list pinned with the latest `base` or `pin`; undefined when none, or a row written before tasks were pinned. */
export function pinnedTasks(rows: readonly LedgerRow[]): readonly PinnedTask[] | undefined {
	return pinnedPlan(rows)?.tasks;
}

// Ticking a task done is not a change to what was pinned.
const withoutCheckbox = (line: string | undefined): string | undefined => line?.replace(/^- \[[ xX]\] /, "");

export function tasksOf(tasks: readonly { readonly id: string; readonly path?: string; readonly verificationCommand?: string; readonly requirementIds: readonly string[]; readonly rawLine: string }[]): readonly PinnedTask[] {
	return tasks.map((t) => ({ id: t.id, path: t.path ?? null, verificationCommand: t.verificationCommand ?? null, requirementIds: t.requirementIds, line: withoutCheckbox(t.rawLine) }));
}

export function specDigest(specMarkdown: string): string {
	return createHash("sha256").update(specMarkdown).digest("hex");
}

/** Which pinned file the live SPEC/PLAN content departs from, or undefined when it matches or nothing is pinned yet. */
export function pinMismatch(pin: PlanPin | undefined, now: { readonly tasks: readonly PinnedTask[]; readonly specHash: string }): string | undefined {
	if (pin === undefined) return undefined;
	const text = (tasks: readonly PinnedTask[] | undefined) => JSON.stringify(tasks?.map((t) => ({ ...t, line: withoutCheckbox(t.line) })));
	if (text(pin.tasks) !== text(now.tasks)) return "PLAN.md's tasks (text, requirement ids, paths or verification commands)";
	return pin.specHash === now.specHash ? undefined : "SPEC.md";
}

/** One line per task, so a re-pin prompt shows exactly what moved. */
export function renderTasks(tasks: readonly PinnedTask[] | undefined): string {
	return tasks === undefined ? "(none pinned)" : tasks.map((t) => withoutCheckbox(t.line) ?? `${t.id} ${t.path ?? "-"} | verify: ${t.verificationCommand ?? "(none)"}`).join("\n");
}

/** The SPEC.md copy a `base` or `pin` row pinned, kept beside the ledger where the safety path guard keeps the model out. */
export function pinnedSpecFile(cwd: string, slug: string): string {
	return ledgerFile(cwd, slug).replace(/\.jsonl$/, ".SPEC.md");
}

/** Append a `base` or `pin` row, writing the SPEC.md copy it pins first. */
export function appendPin(cwd: string, slug: string, row: Extract<LedgerRow, { kind: "base" | "pin" }>, specText: string): void {
	const file = pinnedSpecFile(cwd, slug);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, specText, "utf-8");
	appendLedger(cwd, slug, row);
}

/** The pinned SPEC.md text, or undefined when the copy is missing or does not hash to the signed pin. */
export function readPinnedSpec(cwd: string, slug: string, pin: PlanPin | undefined): string | undefined {
	const file = pinnedSpecFile(cwd, slug);
	if (pin?.specHash === undefined || !existsSync(file)) return undefined;
	const text = readFileSync(file, "utf-8");
	return specDigest(text) === pin.specHash ? text : undefined;
}

/** Changed lines only, `-` pinned and `+` now: the common head and tail are trimmed, then an LCS runs on the middle. */
export function lineDiff(before: readonly string[], after: readonly string[]): string[] {
	let head = 0;
	while (head < before.length && head < after.length && before[head] === after[head]) head++;
	let tail = 0;
	while (tail < before.length - head && tail < after.length - head && before.at(-1 - tail) === after.at(-1 - tail)) tail++;
	const a = before.slice(head, before.length - tail);
	const b = after.slice(head, after.length - tail);
	const w = b.length + 1;
	// Past the cap the quadratic table is skipped and every middle line is shown.
	if (a.length * b.length > 1_000_000) return [...a.map((l) => `- ${l}`), ...b.map((l) => `+ ${l}`)];
	const lcs = new Int32Array((a.length + 1) * w);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) lcs[i * w + j] = a[i] === b[j] ? (lcs[(i + 1) * w + j + 1] as number) + 1 : Math.max(lcs[(i + 1) * w + j] as number, lcs[i * w + j + 1] as number);
	}
	const out: string[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) [i, j] = [i + 1, j + 1];
		else if (j < b.length && (i === a.length || (lcs[i * w + j + 1] as number) >= (lcs[(i + 1) * w + j] as number))) out.push(`+ ${b[j++] as string}`);
		else out.push(`- ${a[i++] as string}`);
	}
	return out;
}

/** What a re-pin would accept: the allowance, then only the changed task and SPEC.md lines. */
export function renderPinChanges(cwd: string, slug: string, rows: readonly LedgerRow[], now: { readonly allowance: readonly string[]; readonly tasks: readonly PinnedTask[]; readonly specText: string }): string {
	const pin = pinnedPlan(rows);
	const taskDiff = lineDiff(renderTasks(pin?.tasks).split("\n"), renderTasks(now.tasks).split("\n"));
	const pinnedSpec = readPinnedSpec(cwd, slug, pin);
	const specDiff = pinnedSpec === undefined ? [] : lineDiff(pinnedSpec.split(/\r?\n/), now.specText.split(/\r?\n/));
	const specShown = pin?.specHash === specDigest(now.specText) ? "none" : pinnedSpec === undefined ? `CHANGED, but the pinned copy ${pinnedSpecFile(cwd, slug)} is missing or does not match the pin, so the change cannot be shown` : `\n${specDiff.join("\n")}`;
	return `Allowance pinned: ${(pin?.allowance ?? []).join(", ")}\nAllowance now: ${now.allowance.join(", ")}\nTask changes (- pinned, + now): ${taskDiff.length === 0 ? "none" : `\n${taskDiff.join("\n")}`}\nSPEC.md changes (- pinned, + now): ${specShown}`;
}

/** How to get back to the pin; SPEC.md names its pinned copy, which the user can restore with `!cp`. */
export function restoreAdvice(cwd: string, slug: string, moved: string, rows: readonly LedgerRow[]): string {
	const copy = moved === "SPEC.md" && readPinnedSpec(cwd, slug, pinnedPlan(rows)) !== undefined ? pinnedSpecFile(cwd, slug) : undefined;
	const restore = copy === undefined ? "restore it" : `restore it with !cp "${copy}" ".pi/work/${slug}/SPEC.md"`;
	return `${restore}, or accept it with /execute ${slug} --repin, which shows what changed`;
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
