/**
 * computeDesignSignals over real unified-diff text: each signal fires on its own evidence and an ordinary
 * small change fires none.
 */
import { describe, expect, it, vi } from "vitest";

const reply = vi.hoisted(() => ({ next: undefined as unknown }));
vi.mock("../../.pi/extensions/routing/modes.ts", async (importOriginal) => ({
	...(await importOriginal<object>()),
	runSingleShotRole: async () => {
		if (reply.next instanceof Error) throw reply.next;
		return reply.next;
	},
}));

import { computeDesignSignals, runDesignReview } from "../../.pi/extensions/quality/design-review.ts";
import { shouldRunDesignReview } from "../../.pi/extensions/quality/gates.ts";

function diffOf(file: string, added: string[], removed: string[] = []): string {
	return [
		`diff --git a/${file} b/${file}`,
		`--- a/${file}`,
		`+++ b/${file}`,
		"@@ -1,3 +1,4 @@",
		...removed.map((l) => `-${l}`),
		...added.map((l) => `+${l}`),
		"",
	].join("\n");
}

const signalsFor = (changed: string[], diffText: string, escalated = false) => computeDesignSignals({ changed, diffText, escalated });

describe("computeDesignSignals", () => {
	it("an ordinary one-file change fires nothing", () => {
		const s = signalsFor(["src/a.ts"], diffOf("src/a.ts", ["const x = 1;", "function f() { return x; }"]));
		expect(s).toEqual({ filesTouched: 1, loopWrapsQuery: false, dataModelChanged: false, publicInterfaceChanged: false, escalateRequested: false });
		expect(shouldRunDesignReview(s)).toBe(false);
	});

	it("eight changed files fire on span alone", () => {
		const changed = Array.from({ length: 8 }, (_, i) => `src/f${i}.ts`);
		const s = signalsFor(changed, diffOf("src/f0.ts", ["const x = 1;"]));
		expect(s.filesTouched).toBe(8);
		expect(shouldRunDesignReview(s)).toBe(true);
		expect(shouldRunDesignReview(signalsFor(changed.slice(0, 7), ""))).toBe(false);
	});

	it("a loop body that calls a query fires loopWrapsQuery, including the one-line form", () => {
		const block = diffOf("src/a.ts", ["for (const id of ids) {", "  const row = await db.query(id);", "}"]);
		expect(signalsFor(["src/a.ts"], block).loopWrapsQuery).toBe(true);
		const inline = diffOf("src/a.ts", ["const rows = ids.map((id) => repo.findOne(id));"]);
		expect(signalsFor(["src/a.ts"], inline).loopWrapsQuery).toBe(true);
	});

	it("a query outside any loop, or only in a removed line, does not fire", () => {
		expect(signalsFor(["src/a.ts"], diffOf("src/a.ts", ["const row = await db.query(1);"])).loopWrapsQuery).toBe(false);
		expect(signalsFor(["src/a.ts"], diffOf("src/a.ts", ["const x = 1;"], ["for (const i of ids) { db.query(i); }"])).loopWrapsQuery).toBe(false);
	});

	it("a loop in one file does not leak into the next file's added lines", () => {
		const diff = diffOf("src/a.ts", ["for (const i of ids) {"]) + diffOf("src/b.ts", ["const r = fetch(url);"]);
		expect(signalsFor(["src/a.ts", "src/b.ts"], diff).loopWrapsQuery).toBe(false);
	});

	it.each(["db/schema.prisma", "db/migrations/001_init.sql", "src/models/user.ts", "api/types.graphql", "infra/schema.json"])("%s is a data-model path", (p) => {
		expect(signalsFor([p], "").dataModelChanged).toBe(true);
	});

	it("a plain source path is not a data-model path", () => {
		expect(signalsFor(["src/util.ts"], "").dataModelChanged).toBe(false);
	});

	it("adding or removing an export in a code file changes the public interface", () => {
		expect(signalsFor(["src/a.ts"], diffOf("src/a.ts", ["export function f() {}"])).publicInterfaceChanged).toBe(true);
		expect(signalsFor(["src/a.ts"], diffOf("src/a.ts", [], ["export const old = 1;"])).publicInterfaceChanged).toBe(true);
	});

	it("an export line in a non-code file does not", () => {
		expect(signalsFor(["README.md"], diffOf("README.md", ["export PATH=/x"])).publicInterfaceChanged).toBe(false);
	});

	it("escalation alone requests the pass", () => {
		const s = signalsFor(["src/a.ts"], diffOf("src/a.ts", ["const x = 1;"]), true);
		expect(s.escalateRequested).toBe(true);
		expect(shouldRunDesignReview(s)).toBe(true);
	});
});

describe("computeDesignSignals with a quoted diff header", () => {
	it("tracks the current file across a quoted header, so an export in a non-code file does not count", () => {
		const diff = [
			'diff --git "a/docs/we\\tird.md" "b/docs/we\\tird.md"',
			"@@ -1 +1 @@",
			"+export default x",
		].join("\n");
		const before = diffOf("src/a.ts", ["const a = 1;"]);
		expect(signalsFor(["src/a.ts", "docs/we\tird.md"], before + diff).publicInterfaceChanged).toBe(false);
	});
});

describe("runDesignReview never aborts the review it follows", () => {
	const input = { diffText: "", changed: ["src/a.ts"], requirements: [] };
	const ctx = {} as Parameters<typeof runDesignReview>[0];
	const call = (findings: unknown[]) => ({
		content: [{ type: "toolCall", id: "1", name: "submit_design_review", arguments: { findings } }],
		usage: { totalTokens: 1 },
	});

	it("a throwing reviewer call yields no findings and a notice, never an exception", async () => {
		reply.next = new Error("provider timed out");
		const result = await runDesignReview(ctx, input);
		expect(result.findings).toEqual([]);
		expect(result.notice).toContain("provider timed out");
	});

	it("one malformed finding is dropped and counted; the well-formed BLOCKER survives", async () => {
		const good = { severity: "BLOCKER", location: "src/a.ts:3", concreteFailure: "N+1 queries", suggestedFix: "batch them" };
		reply.next = call([good, { severity: "BLOCKER", location: "nowhere", concreteFailure: "x", suggestedFix: "y" }]);
		const result = await runDesignReview(ctx, input);
		expect(result.findings).toEqual([good]);
		expect(result.notice).toContain("dropped 1 malformed");
	});
});
