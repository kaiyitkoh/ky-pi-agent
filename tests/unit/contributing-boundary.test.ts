/**
 * The boundary rule: a new capability defaults to a command or skill, and a tool must justify its per-request schema
 * cost. A tool's name, description and full schema ride in `tools[]` on every request (pi-ai
 * src/api/openai-completions.ts:1337-1372); a command costs nothing and a skill only its name and description.
 * An exception is added to TOOL_REGISTRATION_ALLOWLIST with CONTRIBUTING.md's (a)/(b)/(c) answers beside it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

const EXT_DIR = ".pi/extensions";

/** The rule as a grep; keep identical to the validation row's regex. */
const RULE_PATTERN = /default.*command or skill/i;

/** The citation that keeps the rule falsifiable rather than a style preference. */
const EVIDENCE_CITATION = "openai-completions.ts:1337";

/** A plain substring, so `pi["registerTool"]` and aliases are caught too; extensions may not name it even in a comment. */
const TOOL_REGISTRATION = "registerTool";

/** The sanctioned zero-cost surface. */
const COMMAND_REGISTRATION = "registerCommand";

/**
 * Files under `.pi/extensions/` permitted to register a tool. Each entry: (a) why the model must call it mid-turn,
 * (b) the measured schema cost (bytes of the serialised `{type:"function",function:{...}}`, chars/4 tokens), and
 * (c) why a skill cannot carry it.
 */
const TOOL_REGISTRATION_ALLOWLIST: readonly string[] = [
	// approve_ky_command: (a) resumes a tool_call the guard blocked inside the model's own turn; (b) 1099 bytes, 275
	// tokens; (c) a skill cannot validate a command against server-side state or drive a real human confirmation.
	".pi/extensions/safety/index.ts",
	// qoder_delegate: (a) a delegated result must return into the same turn; (b) 1315 bytes, 329 tokens; (c) a skill
	// cannot make an authenticated streaming HTTP round trip.
	".pi/extensions/qoder/index.ts",
	// todo: (a) the model maintains its own step list while it works; (b) 383 bytes, 96 tokens; (c) a skill holds no
	// branch-scoped state across turns.
	".pi/extensions/todo.ts",
	// questionnaire: (a) the model must stop and ask before continuing the same turn; (b) 1258 bytes, 315 tokens;
	// (c) a skill cannot suspend a turn for a structured human answer.
	".pi/extensions/questionnaire.ts",
	// consult_advisor: (a) the advisor's answer must return into the executor's same turn; (b) 584 bytes, 146 tokens;
	// (c) a skill cannot make a routed, guarded nested model call with structured output.
	".pi/extensions/quality/index.ts",
	// Vendored pi-background-tasks, process-only: (a) the model starts, polls, reads and stops long-running commands
	// mid-turn; (b) four tools, measured by tool-count-baseline.test.ts; (c) a skill cannot hold a live process handle.
	".pi/extensions/background-tasks/src/extension.ts",
	// bg_enable loader: (a) the model decides mid-turn that it needs those tools; (b) 358 bytes, 90 tokens, replacing
	// five tools in the implement floor (4177 -> 2342 tokens); (c) only pi.setActiveTools can change the active set.
	".pi/extensions/routing/loader.ts",
];

/** Tracked text sources under `.pi/extensions/`, read from the index's view. */
function extensionSources(): { path: string; text: string }[] {
	return trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts") || p.endsWith(".js"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
}

describe("BOOT-10 — the boundary rule is stated", () => {
	const contributing = readFileSync(join(repoRoot(), "CONTRIBUTING.md"), "utf-8");

	it("states that a new capability defaults to a command or skill", () => {
		expect(
			RULE_PATTERN.test(contributing),
			`CONTRIBUTING.md must match ${RULE_PATTERN} — this is the literal regex the ` +
				"BOOT-10 validation row greps for, so rewording past it silently drops the requirement",
		).toBe(true);
	});

	it("keeps the source citation that makes the rule economic rather than stylistic", () => {
		expect(
			contributing,
			`CONTRIBUTING.md must cite ${EVIDENCE_CITATION} — a tool's full JSON Schema riding in ` +
				"every request payload is the reason for the rule; drop the citation and the rule " +
				"becomes an unsupported opinion that the next contributor is right to ignore",
		).toContain(EVIDENCE_CITATION);
	});
});

describe("BOOT-10 — the phase does not violate the rule in the commit that writes it", () => {
	const sources = extensionSources();

	it("finds at least one tracked extension source (guards against a vacuous pass)", () => {
		expect(
			sources.length,
			`no tracked .ts/.js under ${EXT_DIR}/ — every assertion below scans this set, so an ` +
				"empty one turns the whole gate into a pass that verified nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it(`registers no tool anywhere under ${EXT_DIR}/`, () => {
		const offenders = sources
			.filter((s) => !TOOL_REGISTRATION_ALLOWLIST.includes(s.path))
			.filter((s) => s.text.includes(TOOL_REGISTRATION))
			.map((s) => s.path);

		expect(
			offenders,
			"these files register a tool. Per CONTRIBUTING.md's boundary rule, answer (a) must the " +
				"model call this mid-turn, (b) what is the measured schema cost, (c) why can a skill " +
				"not carry it as a procedure — then add the path to TOOL_REGISTRATION_ALLOWLIST with " +
				"those answers beside it",
		).toEqual([]);
	});

	it("exercises the sanctioned surface — at least one command is registered", () => {
		const withCommand = sources.filter((s) => s.text.includes(COMMAND_REGISTRATION)).map((s) => s.path);

		expect(
			withCommand.length,
			`no file under ${EXT_DIR}/ calls ${COMMAND_REGISTRATION}. The rule's negative half would ` +
				"then be satisfied by an extension that does nothing at all; the positive half has to " +
				"be genuinely exercised for the compliance above to mean the rule is workable",
		).toBeGreaterThanOrEqual(1);
	});
});
