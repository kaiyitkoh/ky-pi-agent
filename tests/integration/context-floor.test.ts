/**
 * Per-turn floor: what every request costs before the user types anything. Measured by the same
 * computation `/budget` uses, over a composed offline session, on text with paths and the shell
 * executable replaced by placeholders, so the figures do not depend on the checkout path or OS.
 */
import { describe, expect, it } from "vitest";

import { estimateTokensFromChars } from "../../.pi/extensions/diagnostics/budget.ts";
import {
	type FloorMeasurement,
	listEntryPoints,
	measureFloor,
} from "../helpers/harness-session.ts";

/** The composed full-profile floor before any cut: 4179 tokens (16714 chars), measured 2026-10-13 with all 18 tracked entry points. */
const BEFORE_FULL_FLOOR = 4179;

/**
 * Ceilings in `/budget`-formula tokens (Math.ceil(chars / 4)) on normalised text, each the value measured
 * on 2026-10-13 plus under 3% headroom.
 * recon: measured 1773. review: measured 1900. implement: measured 4179 (was 2344 before questionnaire and bg_* joined it). full: measured 4179.
 */
const FLOOR_CEILINGS = {
	recon: 1820,
	review: 1950,
	implement: 4300,
	full: 4300,
} as const;

const PROFILES = ["recon", "review", "implement", "full"] as const;

const CLOSURE_TOLERANCE_CHARS = 32;

const SHELL_POLICY_SECTION_NAME = "pi_background_shell_policy";

let composed: FloorMeasurement;
let bare: FloorMeasurement;
let bareAgents: FloorMeasurement;

// Mutation check: lowering composedBefore below the measured value fails this block.
describe("composed default", () => {
	it("stays under the BEFORE ceiling", async () => {
		composed = await measureFloor({ profile: "full" });
		const entries = listEntryPoints();
		expect(entries.length, "entry-point discovery must not be vacuous").toBeGreaterThanOrEqual(15);
		for (const wanted of [".pi/extensions/background-tasks/index.ts", ".pi/extensions/loop-police/index.ts"]) {
			expect(entries, `re-exported default entry ${wanted} must be measured`).toContain(wanted);
		}
		for (const name of ["read", "bash", "approve_ky_command", "bg_run"]) {
			expect(composed.toolNames, `composed harness must register ${name}`).toContain(name);
		}
		console.info(
			`COMPOSED chars=${composed.budget.floor.chars} tokens=${composed.budget.floor.estimatedTokens} ` +
				`system=${composed.budget.systemPrompt.chars} tools=${composed.budget.toolSchemas.chars} ` +
				`toolCount=${composed.toolNames.length} wireToolChars=${composed.wireToolChars} ` +
				`systemMessages=${composed.systemMessageCount}`,
		);
		console.info(`TOOLS ${composed.toolNames.join(",")}`);
		expect(composed.budget.floor.estimatedTokens).toBeLessThanOrEqual(FLOOR_CEILINGS.full);
	}, 60_000);
});

describe("per-profile floors", () => {
	it("holds each profile under its ceiling and below BEFORE", async () => {
		const floors = {} as Record<(typeof PROFILES)[number], FloorMeasurement>;
		for (const p of PROFILES) floors[p] = await measureFloor({ profile: p });
		for (const p of PROFILES) {
			const m = floors[p];
			console.info(
				`AFTER ${p} tokens=${m.budget.floor.estimatedTokens} chars=${m.budget.floor.chars} ` +
					`system=${m.budget.systemPrompt.chars} tools=${m.budget.toolSchemas.chars} wireToolChars=${m.wireToolChars}`,
			);
			expect(m.budget.floor.estimatedTokens, `${p} floor`).toBeLessThanOrEqual(FLOOR_CEILINGS[p]);
		}
		const full = floors.full.budget.floor.estimatedTokens;
		const impl = floors.implement.budget.floor.estimatedTokens;
		console.info(
			`REDUCTION implement ${BEFORE_FULL_FLOOR - impl} tokens (${(((BEFORE_FULL_FLOOR - impl) / BEFORE_FULL_FLOOR) * 100).toFixed(1)}%)`,
		);
		expect(impl).toBeLessThanOrEqual(full);
		expect(full).toBeLessThanOrEqual(BEFORE_FULL_FLOOR);
		const recon = floors.recon.budget.floor.estimatedTokens;
		for (const p of ["review", "implement", "full"] as const) {
			expect(recon, `recon must be below ${p}`).toBeLessThan(floors[p].budget.floor.estimatedTokens);
		}
		expect(floors.full.systemPrompt, "non-vacuity: full carries the section").toContain(SHELL_POLICY_SECTION_NAME);
		expect(floors.implement.systemPrompt, "implement keeps bg_run, so it carries the section").toContain(SHELL_POLICY_SECTION_NAME);
		for (const p of ["recon", "review"] as const) {
			expect(floors[p].systemPrompt, `${p} must not carry the shell policy`).not.toContain(SHELL_POLICY_SECTION_NAME);
		}
	}, 120_000);
});

describe("bare baselines", () => {
	it("measures bare Pi and bare Pi plus AGENTS.md", async () => {
		bare = await measureFloor({ entryPoints: [], skills: false, agentsMd: false });
		bareAgents = await measureFloor({ entryPoints: [], skills: false, agentsMd: true });
		for (const [label, m] of [["BARE", bare], ["BARE+AGENTS", bareAgents]] as const) {
			console.info(
				`${label} chars=${m.budget.floor.chars} tokens=${m.budget.floor.estimatedTokens} ` +
					`system=${m.budget.systemPrompt.chars} tools=${m.budget.toolSchemas.chars} ` +
					`toolCount=${m.toolNames.length}`,
			);
		}
		expect(bare.toolNames, "bare Pi must still expose its built-in tools").toContain("read");
		expect(bareAgents.budget.systemPrompt.chars).toBeGreaterThan(bare.budget.systemPrompt.chars);
	}, 60_000);
});

// Mutation check: dropping an entry point from the composed list breaks the closure.
describe("per-extension attribution", () => {
	it("closes on the composed floor", async () => {
		const rows: { entry: string; chars: number; tokens: number; added: string[] }[] = [];
		let sum = 0;
		for (const entry of listEntryPoints()) {
			const one = await measureFloor({ entryPoints: [entry], skills: false, profile: "full" });
			const chars = one.budget.floor.chars - bareAgents.budget.floor.chars;
			const added = one.toolNames.filter((n) => !bareAgents.toolNames.includes(n));
			rows.push({ entry, chars, tokens: estimateTokensFromChars(Math.max(chars, 0)), added });
			sum += chars;
		}
		const skillsOnly = await measureFloor({ entryPoints: [], skills: true });
		const skillsChars = skillsOnly.budget.floor.chars - bareAgents.budget.floor.chars;
		rows.push({
			entry: "(skills index)",
			chars: skillsChars,
			tokens: estimateTokensFromChars(Math.max(skillsChars, 0)),
			added: [],
		});
		sum += skillsChars;

		for (const r of rows) {
			console.info(`ROW ${r.entry} chars=${r.chars} tokens=${r.tokens} tools=${r.added.join("+") || "-"}`);
		}
		expect(rows.length, "zero-delta rows are still listed").toBe(listEntryPoints().length + 1);

		const residual = composed.budget.floor.chars - (bareAgents.budget.floor.chars + sum);
		console.info(`RESIDUAL chars=${residual}`);
		expect(
			Math.abs(residual),
			`attribution residual was ${residual} chars (tolerance ${CLOSURE_TOLERANCE_CHARS})`,
		).toBeLessThanOrEqual(CLOSURE_TOLERANCE_CHARS);
	}, 300_000);
});
