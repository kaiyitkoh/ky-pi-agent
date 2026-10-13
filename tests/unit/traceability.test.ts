import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

const requirements = read(".planning/REQUIREMENTS.md");
const roadmap = read(".planning/ROADMAP.md");
const runbook = read("docs/RUNBOOK.md");

type Mark = " " | "x" | "~";
interface Bullet {
	readonly id: string;
	readonly mark: Mark;
	readonly text: string;
}
interface Row {
	readonly id: string;
	readonly phase: string;
	readonly status: string;
}

const bullets: Bullet[] = [...requirements.matchAll(/^- \[([ x~])\] \*\*([A-Z]+-\d+)\*\*(.*)$/gm)].map((m) => ({
	mark: m[1] as Mark,
	id: m[2]!,
	text: m[3]!,
}));

const rows: Row[] = [...requirements.matchAll(/^\| ([A-Z]+-\d+) \| (Phase [\d.]+) \| (.*) \|$/gm)].map((m) => ({
	id: m[1]!,
	phase: m[2]!,
	status: m[3]!,
}));

const runbookIds = new Set(runbook.match(/RB-\d+(?:\.\d+)?-\d+/g) ?? []);
// Their remaining check is the first CI run, which has no runbook entry.
const CI_ONLY_PARTIALS = new Set(["BOOT-06", "BOOT-07"]);
const rowFor = (id: string): Row => rows.find((r) => r.id === id)!;

describe("REQUIREMENTS.md traceability", () => {
	it("parses a non-trivial set of bullets and rows (guards against a vacuous pass)", () => {
		expect(bullets.length).toBeGreaterThan(100);
		expect(rows.length).toBeGreaterThan(100);
	});

	it("every bullet id has a traceability row and every row has a bullet", () => {
		const bulletIds = bullets.map((b) => b.id);
		const rowIds = rows.map((r) => r.id);
		expect(bulletIds.filter((id) => !rowIds.includes(id)), "bullets without a row").toEqual([]);
		expect(rowIds.filter((id) => !bulletIds.includes(id)), "rows without a bullet").toEqual([]);
		expect(new Set(bulletIds).size, "duplicate bullet ids").toBe(bulletIds.length);
		expect(new Set(rowIds).size, "duplicate row ids").toBe(rowIds.length);
	});

	it("the stated total equals the number of bullets", () => {
		const stated = /v1 requirements: \*\*(\d+) total\*\*/.exec(requirements);
		expect(stated, "the Coverage section must state '**N total**'").not.toBeNull();
		expect(Number(stated![1])).toBe(bullets.length);
	});

	it("a checked bullet's row does not claim pending, partial or outstanding work", () => {
		const offenders = bullets
			.filter((b) => b.mark === "x")
			.filter((b) => /^(Pending|Partial)|OUTSTANDING|outstanding/.test(rowFor(b.id).status))
			.map((b) => b.id);
		expect(offenders, "a [x] bullet whose row names an outstanding check should be [~]").toEqual([]);
	});

	it("a partial bullet names a runbook entry that exists", () => {
		const offenders = bullets
			.filter((b) => b.mark === "~" && !CI_ONLY_PARTIALS.has(b.id))
			.filter((b) => {
				const ids = `${b.text} ${rowFor(b.id).status}`.match(/RB-\d+(?:\.\d+)?-\d+/g) ?? [];
				return ids.length === 0 || ids.some((id) => !runbookIds.has(id));
			})
			.map((b) => b.id);
		expect(offenders, "a [~] bullet must cite RB ids that exist in docs/RUNBOOK.md").toEqual([]);
	});

	it("an unchecked bullet's row is not Complete", () => {
		const offenders = bullets.filter((b) => b.mark === " ").filter((b) => /^Complete/.test(rowFor(b.id).status)).map((b) => b.id);
		expect(offenders).toEqual([]);
	});

	it("a Pending row is never on a checked or partial bullet", () => {
		const offenders = bullets.filter((b) => b.mark !== " ").filter((b) => /^Pending/.test(rowFor(b.id).status)).map((b) => b.id);
		expect(offenders).toEqual([]);
	});

	it("SAFE-10 describes the shipped confirmation protocol", () => {
		const safe10 = bullets.find((b) => b.id === "SAFE-10")!;
		expect(safe10.text).not.toContain("not an inline");
		expect(safe10.text).toContain("ctx.ui.confirm");
		expect(safe10.text).toContain("approve_ky_command");
	});
});

describe("ROADMAP.md progress table", () => {
	const phaseDirs = readdirSync(join(root, ".planning", "phases"), { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);
	const progress = roadmap.slice(roadmap.indexOf("| Phase | Plans Complete |"));
	const progressRows = progress.split("\n").filter((l) => /^\| \d+(?:\.\d+)?\. /.test(l));

	it("has a row for every phase directory", () => {
		const missing = phaseDirs.filter((dir) => {
			const num = /^(\d+(?:\.\d+)?)-/.exec(dir)![1]!.replace(/^0+(?=\d)/, "");
			return !progressRows.some((r) => r.startsWith(`| ${num}. `));
		});
		expect(missing).toEqual([]);
	});

	it("never shows 0/TBD for a phase that has summaries", () => {
		for (const dir of phaseDirs) {
			const hasSummary = readdirSync(join(root, ".planning", "phases", dir)).some((f) => f.endsWith("-SUMMARY.md"));
			if (!hasSummary) continue;
			const num = /^(\d+(?:\.\d+)?)-/.exec(dir)![1]!.replace(/^0+(?=\d)/, "");
			const row = progressRows.find((r) => r.startsWith(`| ${num}. `));
			expect(row, `${dir}: progress row`).toBeDefined();
			expect(row, `${dir}: stale progress row`).not.toMatch(/0\/TBD|Not started/);
		}
	});
});
