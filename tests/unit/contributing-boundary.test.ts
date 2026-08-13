/**
 * BOOT-10 — the boundary rule is stated, and this phase does not break it.
 *
 * THE RULE. A new capability defaults to a command or skill; registering a tool
 * requires justifying its per-request schema cost. `CONTRIBUTING.md` carries the
 * rule and its evidence; this file is the enforcement point. A rule written in
 * markdown and asserted nowhere is a rule that gets broken by phase 4.
 *
 * WHY IT IS ECONOMIC, NOT STYLISTIC — the three facts, each read out of Pi
 * 0.84.1's own published TypeScript (recovered from `dist/**\/*.js.map`):
 *   - a tool's name, description and complete JSON Schema are serialised into
 *     `tools[]` on every provider request
 *     [VERIFIED: pi-ai src/api/openai-completions.ts:1337-1372, called at :731]
 *   - a command costs zero: `src/core/system-prompt.ts` is 163 lines and holds
 *     no reference to registered commands
 *     [VERIFIED: pi src/core/system-prompt.ts, whole file]
 *   - a skill costs name + description + location only, body on read
 *     [VERIFIED: pi src/core/skills.ts:350-356, :344]
 *
 * SCOPE, STATED RATHER THAN IMPLIED. This test applies to Phase 1's
 * `.pi/extensions/**` and to nothing else. A later phase that genuinely needs a
 * tool does not delete this file: it extends `TOOL_REGISTRATION_ALLOWLIST`
 * below, in the same change, with the written answers to (a), (b) and (c) from
 * CONTRIBUTING's boundary rule. Making the exception visible and argued is the
 * entire point; an unenforced rule and a silently-edited test are the same
 * thing.
 *
 * THE VACUOUS-PASS GUARD. Assertion 2 scans a file set for a forbidden string.
 * On an empty set it would pass while proving nothing — the exact failure shape
 * this phase has already tripped over twice (a `check-ignore` without
 * `--no-index`, and an npm probe reading its launcher's environment). So the set
 * is asserted non-empty first, and assertion 3 requires the positive half of the
 * rule to be genuinely exercised rather than merely permitted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

const EXT_DIR = ".pi/extensions";

/**
 * The rule, as a grep. `/default.*command or skill/i` is the regex named in
 * `01-VALIDATION.md`'s BOOT-10 row; keep the two identical.
 */
const RULE_PATTERN = /default.*command or skill/i;

/**
 * The evidence the rule must keep carrying.
 *
 * Without a citation the rule decays into an unsupported style preference, and
 * the first person who finds it inconvenient deletes it. Asserting the citation
 * string means the claim stays falsifiable: anyone can open that file at that
 * line and check.
 */
const EVIDENCE_CITATION = "openai-completions.ts:1337";

/**
 * The call that puts a tool's schema into every provider request.
 *
 * Matched as a plain substring, deliberately. `01-VALIDATION.md`'s BOOT-10 row
 * says the string "appears nowhere under `.pi/extensions/**`", and a substring
 * is the only form that survives `pi["registerTool"]`, a destructured alias or
 * a `const t = "registerTool"` indirection. The cost is that an extension may
 * not name the call even in a comment — `.pi/extensions/harness/index.ts`
 * describes it as "the tool-registration call" for exactly that reason.
 */
const TOOL_REGISTRATION = "registerTool";

/** The sanctioned zero-cost surface. */
const COMMAND_REGISTRATION = "registerCommand";

/**
 * Files under `.pi/extensions/` permitted to register a tool.
 *
 * EMPTY BY DESIGN, for the whole of Phase 1. To add an entry you must also add
 * the (a)/(b)/(c) justification from CONTRIBUTING.md next to it, in the same
 * commit. See the SCOPE note in this file's header.
 */
const TOOL_REGISTRATION_ALLOWLIST: readonly string[] = [];

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
