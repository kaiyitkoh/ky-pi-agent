/**
 * The gate-depth table lists only mechanisms each workflow's command module actually imports.
 *
 * `gateDepthFor` is a pure lookup, so a table entry proves nothing by itself: the behavioural check is that the
 * function implementing every listed mechanism is imported by the workflow's own command module (or the settle
 * module it hands off to). A mechanism added to a workflow that never calls it makes `unbackedEntries` non-empty.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	GATE_DEPTH_BY_WORKFLOW,
	QUALITY_MECHANISMS,
	WORKFLOW_IDS,
	gateDepthFor,
	type MechanismId,
	type WorkflowId,
} from "../../.pi/extensions/quality/gates.ts";
import { repoRoot } from "../helpers/git.ts";

const COMMAND_MODULES: Readonly<Record<WorkflowId, readonly string[]>> = {
	quick: [".pi/extensions/workflows/index.ts", ".pi/extensions/workflows/settle.ts"],
	grill: [".pi/extensions/grill/index.ts"],
	plan: [".pi/extensions/plan-ceremony/index.ts"],
	execute: [".pi/extensions/execute/index.ts"],
	review: [".pi/extensions/review/index.ts"],
};

function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Value names (not `type` imports) brought in by static `import { ... } from "..."` statements. */
function importedNames(text: string): Set<string> {
	const names = new Set<string>();
	const re = /import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g;
	for (const match of stripComments(text).matchAll(re)) {
		for (const part of (match[1] ?? "").split(",")) {
			const trimmed = part.trim();
			if (trimmed === "" || /^type\s/.test(trimmed)) continue;
			names.add(trimmed.split(/\s+as\s+/)[0]?.trim() ?? trimmed);
		}
	}
	return names;
}

function importsOf(workflow: WorkflowId): Set<string> {
	const all = new Set<string>();
	for (const file of COMMAND_MODULES[workflow]) {
		for (const name of importedNames(readFileSync(join(repoRoot(), file), "utf-8"))) all.add(name);
	}
	return all;
}

function functionsOf(mechanism: MechanismId): readonly string[] {
	const entry = QUALITY_MECHANISMS.find((m) => m.id === mechanism);
	if (entry === undefined) throw new Error(`unknown mechanism ${mechanism}`);
	return entry.functions;
}

/** Table entries whose implementing function is not imported by the workflow's command module(s). */
function unbackedEntries(table: Readonly<Record<WorkflowId, readonly MechanismId[]>>): string[] {
	const unbacked: string[] = [];
	for (const workflow of WORKFLOW_IDS) {
		const imported = importsOf(workflow);
		for (const mechanism of table[workflow]) {
			for (const fn of functionsOf(mechanism)) {
				if (!imported.has(fn)) unbacked.push(`${workflow}:${mechanism} (${fn})`);
			}
		}
	}
	return unbacked;
}

describe("the table is the production truth", () => {
	it("lists exactly the mechanisms each workflow runs", () => {
		expect(gateDepthFor("quick").mechanisms).toEqual(["deterministic"]);
		expect(gateDepthFor("execute").mechanisms).toEqual(["deterministic"]);
		expect(gateDepthFor("grill").mechanisms).toEqual([]);
		expect(gateDepthFor("plan").mechanisms).toEqual([]);
		expect(gateDepthFor("review").mechanisms).toEqual(["deterministic", "model-review", "refute-or-promote"]);
	});

	it("lists calibration for no workflow, and marks it offline-only", () => {
		for (const workflow of WORKFLOW_IDS) expect(gateDepthFor(workflow).mechanisms).not.toContain("calibration");
		expect(QUALITY_MECHANISMS.find((m) => m.id === "calibration")?.production).toBe(false);
	});

	it("credits refute-or-promote to the function the review command calls", () => {
		expect(QUALITY_MECHANISMS.find((m) => m.id === "refute-or-promote")?.functions).toEqual(["runRefuteOrPromote"]);
	});
});

describe("every listed mechanism is backed by the workflow's command module", () => {
	it("no table entry is unbacked", () => {
		expect(unbackedEntries(GATE_DEPTH_BY_WORKFLOW)).toEqual([]);
	});

	it("self-check: a mechanism the command never imports is detected", () => {
		const table = { ...GATE_DEPTH_BY_WORKFLOW, quick: ["deterministic", "model-review"] } as Record<WorkflowId, readonly MechanismId[]>;
		expect(unbackedEntries(table)).toEqual(["quick:model-review (runReview)"]);
	});

	it("self-check: a workflow with no gate cannot claim the deterministic stage", () => {
		const table = { ...GATE_DEPTH_BY_WORKFLOW, grill: ["deterministic"] } as Record<WorkflowId, readonly MechanismId[]>;
		expect(unbackedEntries(table)).toEqual(["grill:deterministic (runChangeGateStage)"]);
	});
});

describe("exhaustiveness and purity", () => {
	it("every WorkflowId has a row and every row is a WorkflowId", () => {
		expect(Object.keys(GATE_DEPTH_BY_WORKFLOW).sort()).toEqual([...WORKFLOW_IDS].sort());
	});

	it("every listed mechanism id is a known mechanism", () => {
		const known = new Set<string>(QUALITY_MECHANISMS.map((m) => m.id));
		for (const workflow of WORKFLOW_IDS) {
			for (const id of gateDepthFor(workflow).mechanisms) expect(known.has(id), `${workflow} names unknown mechanism ${id}`).toBe(true);
		}
	});

	it("the table and its rows are frozen", () => {
		expect(() => (gateDepthFor("quick").mechanisms as MechanismId[]).push("calibration")).toThrow();
		expect(() => {
			(GATE_DEPTH_BY_WORKFLOW as Record<WorkflowId, readonly MechanismId[]>).quick = [];
		}).toThrow();
	});
});
