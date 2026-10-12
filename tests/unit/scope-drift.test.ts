import { describe, expect, it } from "vitest";

import { compareScope } from "../../.pi/extensions/review/scope-drift.ts";

interface Row {
	readonly name: string;
	readonly why: string;
	readonly changed: string[];
	readonly spec: string[];
	readonly plan: string[];
	readonly drifted: string[];
	readonly undelivered: string[];
}

const ROWS: Row[] = [
	{
		name: "in-scope diff",
		why: "negative control: without it, drifted = changed would pass every positive row",
		changed: ["src/a.ts"],
		spec: ["src/a.ts"],
		plan: [],
		drifted: [],
		undelivered: [],
	},
	{
		name: "one path outside the union",
		why: "the undeclared path, and only it, is drift",
		changed: ["src/a.ts", "src/rogue.ts"],
		spec: ["src/a.ts"],
		plan: [],
		drifted: ["src/rogue.ts"],
		undelivered: [],
	},
	{
		name: "declared but never changed",
		why: "a SPEC declaring five files and delivering one must not read clean",
		changed: ["src/a.ts"],
		spec: ["src/a.ts", "src/b.ts"],
		plan: [],
		drifted: [],
		undelivered: ["src/b.ts"],
	},
	{
		name: "both directions at once",
		why: "the two lists are independent",
		changed: ["src/rogue.ts"],
		spec: ["src/b.ts"],
		plan: [],
		drifted: ["src/rogue.ts"],
		undelivered: ["src/b.ts"],
	},
	{
		name: "declared only in PLAN, changed",
		why: "the allowance is the union, so narrowing it to an intersection must turn this red",
		changed: ["src/p.ts"],
		spec: ["src/a.ts"],
		plan: ["src/p.ts"],
		drifted: [],
		undelivered: ["src/a.ts"],
	},
	{
		name: "declared only in SPEC, changed",
		why: "the other half of the union",
		changed: ["src/s.ts"],
		spec: ["src/s.ts"],
		plan: ["src/p.ts"],
		drifted: [],
		undelivered: ["src/p.ts"],
	},
	{
		name: "backslash and ./ forms",
		why: "one normalisation shared with driftAbort",
		changed: ["src\\a.ts", "./src/b.ts"],
		spec: ["./src/a.ts", "src\\b.ts"],
		plan: [],
		drifted: [],
		undelivered: [],
	},
	{
		name: "empty declaration",
		why: "fail closed: nothing declared means every change is drift, as with driftAbort",
		changed: ["src/a.ts"],
		spec: [],
		plan: [],
		drifted: ["src/a.ts"],
		undelivered: [],
	},
];

describe("compareScope", () => {
	for (const row of ROWS) {
		it(`${row.name} (${row.why})`, () => {
			const report = compareScope({ changed: row.changed, specExpectedFiles: row.spec, planFilesTouched: row.plan });
			expect(report.drifted).toEqual(row.drifted);
			expect(report.undelivered).toEqual(row.undelivered);
		});
	}
});
