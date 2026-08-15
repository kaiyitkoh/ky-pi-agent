/**
 * EXT-01 — `.pi/agents/*.md` frontmatter contract, enforced both directions.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `.pi/agents/*.md` frontmatter decides three of EXT-01's four properties
 * (system prompt, tool restriction, thinking level) and must NEVER decide the
 * fourth (model). `pi-subagents@0.49.0 src/agents/agents.ts:1155`:
 *
 *     if (override.model !== undefined && !agentHasFrontmatterField(agent, "model")) {
 *
 * A `model:` key in an agent file's own frontmatter makes
 * `settings.subagents.agentOverrides` (written by
 * `.pi/extensions/routing/agent-overrides.ts`, ROUTE-05) INERT for that
 * agent — `/cheap`, `/balanced`, `/max` and `/escalate` would silently stop
 * affecting it. This file is the mechanical proof that no shipped agent file
 * carries that key, plus the EXT-01 coverage proof (name, description,
 * tools, thinking, systemPromptMode all present) and the completeness proof
 * (every subagent role in `AGENT_NAME_BY_ROLE` ships a file, and every
 * shipped file names a role).
 *
 * ---------------------------------------------------------------------------
 * THE PARSER IS A DELIBERATE SUBSET, NOT REAL YAML
 * ---------------------------------------------------------------------------
 * `pi-subagents` parses agent frontmatter with a custom flat-key-plus-
 * folded-block parser (`src/agents/frontmatter.ts:65`), NOT the `yaml`
 * dependency. {@link extractFrontmatter} below mirrors only the flat
 * `key: value` half of that grammar — every key this repo's own agent files
 * use is flat, so a folded-block reader is not needed here and is not
 * built. A `.pi/agents/*.md` file that ever needs a folded block would need
 * this extractor extended deliberately, not silently assumed to work.
 *
 * ---------------------------------------------------------------------------
 * DISCOVERY IS `trackedFiles`, NEVER `readdirSync`
 * ---------------------------------------------------------------------------
 * An untracked scratch `.md` dropped into `.pi/agents/` by a stray edit must
 * not silently satisfy any assertion here — `trackedFiles(".pi/agents")`
 * reads git's index, matching this repo's standing "ask git, don't walk the
 * disk" discipline (`tests/helpers/git.ts`'s own module docstring).
 *
 * ---------------------------------------------------------------------------
 * NO HARDCODED ROLE NAME
 * ---------------------------------------------------------------------------
 * Every real-file assertion below reads role names out of
 * `AGENT_NAME_BY_ROLE` (`.pi/extensions/routing/schema.ts`), never a
 * hardcoded string — the same discipline `agent-overrides.test.ts:102`
 * already uses (`Object.values(AGENT_NAME_BY_ROLE)`). If a second subagent
 * role is ever added, this file needs no edit.
 *
 * ---------------------------------------------------------------------------
 * LIVE-PREDICATE PROOF — WHY THE REAL-FILE ASSERTIONS ARE NOT A TAUTOLOGY
 * ---------------------------------------------------------------------------
 * Without a case that PROVES the extractor and the required/forbidden-key
 * check can fail, every assertion above passes trivially against whatever
 * `.pi/agents/` happens to contain today — the exact vacuous-pass shape
 * `extension-layout.test.ts`'s own `isEntryPoint` fixtures exist to rule
 * out (`tests/unit/extension-layout.test.ts:229-265`). Four inline fixture
 * strings, never written to `.pi/agents/` itself (a fixture on disk there
 * would be enumerated by the suite above it), drive
 * {@link frontmatterViolations} directly: one accepted, three rejected —
 * `model:` present, `fallbackModels:` present, `description` missing.
 *
 * ---------------------------------------------------------------------------
 * FALSIFICATION (recorded here per the plan's acceptance criteria; see
 * 07-04-SUMMARY.md for the exact result)
 * ---------------------------------------------------------------------------
 * Before this file was committed, `model: claude-haiku-4-5` was appended to
 * `.pi/agents/planner.md`'s frontmatter and the suite was re-run: the
 * forbidden-key case for that file turned red with the expected message.
 * The line was then reverted.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import { AGENT_NAME_BY_ROLE } from "../../.pi/extensions/routing/schema.ts";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

// -----------------------------------------------------------------------------
// extractFrontmatter — the flat-key-plus-fence subset of pi-subagents' parser
// -----------------------------------------------------------------------------

/** A leading `---` fence, flat `key: value` lines, a closing `---`. */
const FRONTMATTER_FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** One flat frontmatter line: `key: value` (value may be empty). */
const FLAT_LINE = /^([A-Za-z][A-Za-z0-9_]*):[ \t]?(.*)$/;

/**
 * Parse `.pi/agents/*.md` frontmatter's flat `key: value` lines. Returns
 * `undefined` when no fenced frontmatter block is found. Exported so the
 * live-predicate fixtures below drive it directly, following the
 * `isEntryPoint` precedent in `tests/unit/extension-layout.test.ts`.
 */
export function extractFrontmatter(source: string): Record<string, string> | undefined {
	const match = FRONTMATTER_FENCE.exec(source);
	if (match === null) {
		return undefined;
	}
	const frontmatter: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		if (line.trim() === "") {
			continue;
		}
		const kv = FLAT_LINE.exec(line);
		if (kv === null) {
			continue;
		}
		frontmatter[kv[1]] = kv[2];
	}
	return frontmatter;
}

// -----------------------------------------------------------------------------
// The EXT-01 contract — required and forbidden keys
// -----------------------------------------------------------------------------

/**
 * The per-agent system-prompt / tool-restriction / thinking-level half of
 * EXT-01 — the model half is Phase 5's and is proven by its absence via
 * {@link FORBIDDEN_KEYS} below.
 */
const REQUIRED_KEYS = ["name", "description", "tools", "thinking", "systemPromptMode"] as const;

/**
 * `model` — see this file's own header for `agents.ts:1155`.
 * `fallbackModels` — model selection in every form belongs to
 * `.pi/extensions/routing/agent-overrides.ts`, never to an agent file.
 */
const FORBIDDEN_KEYS = ["model", "fallbackModels"] as const;

/**
 * Every violation of the EXT-01 contract found in `frontmatter`, or an empty
 * array when it is fully compliant. Shared between the real-file assertions
 * and the inline-fixture proof so both exercise the identical rule.
 */
function frontmatterViolations(frontmatter: Record<string, string>): string[] {
	const violations: string[] = [];
	for (const key of REQUIRED_KEYS) {
		if (!(key in frontmatter)) {
			violations.push(`missing required key "${key}"`);
		}
	}
	for (const key of FORBIDDEN_KEYS) {
		if (key in frontmatter) {
			violations.push(
				`forbidden key "${key}" present -- pi-subagents/src/agents/agents.ts:1155 makes ` +
					`settings.subagents.agentOverrides INERT for this agent once its own frontmatter ` +
					`declares "${key}", silently defeating /cheap, /balanced, /max and /escalate for it`,
			);
		}
	}
	return violations;
}

// -----------------------------------------------------------------------------
// Discovery — trackedFiles, never readdirSync
// -----------------------------------------------------------------------------

const AGENT_FILES = trackedFiles(".pi/agents").filter((p) => p.endsWith(".md"));

describe("subagent-agents-config -- discovery (guards against a vacuous pass)", () => {
	it("finds at least one tracked .pi/agents/*.md file", () => {
		expect(
			AGENT_FILES.length,
			"no tracked .md files under .pi/agents/ -- without this guard every assertion below would " +
				"pass having checked nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it("REQUIRED_KEYS and FORBIDDEN_KEYS are both non-empty (guards against a vacuous rule)", () => {
		expect(REQUIRED_KEYS.length).toBeGreaterThanOrEqual(1);
		expect(FORBIDDEN_KEYS.length).toBeGreaterThanOrEqual(1);
	});
});

// -----------------------------------------------------------------------------
// Completeness, both directions
// -----------------------------------------------------------------------------

/**
 * Agent files intentionally shipped WITHOUT a routed `AGENT_NAME_BY_ROLE`
 * entry today. Adding a stem here is a real architectural statement, not a
 * workaround -- mirrors `chokepoint-lint.test.ts`'s
 * `CHOKEPOINT_BYPASS_ALLOWLIST` shape: each entry must name (a) why the role
 * is not yet routed and (b) the `RB-*` id that tracks wiring it up. Checked
 * for staleness below (every entry must correspond to a real shipped file),
 * the same completeness discipline this describe block applies everywhere
 * else.
 */
const UNROUTED_AGENT_ALLOWLIST: readonly { readonly stem: string; readonly reason: string }[] = [
	{
		stem: "reviewer",
		reason:
			'plan 08-07 dispatches the reviewer via runSingleShotRole (ROLE_MECHANISM.reviewer === "call-model"), ' +
			"never through the subagent/agentOverrides mechanism AGENT_NAME_BY_ROLE serves -- this agent file " +
			"exists for the eventual real-subagent path, tracked as RB-08-03, OUTSTANDING",
	},
];

describe("subagent-agents-config -- completeness, both directions", () => {
	const declaredNames = Object.values(AGENT_NAME_BY_ROLE);
	const shippedStems = AGENT_FILES.map((p) => basename(p, ".md"));
	const allowedUnroutedStems = UNROUTED_AGENT_ALLOWLIST.map((e) => e.stem);

	it("AGENT_NAME_BY_ROLE names at least one subagent role (guards against a vacuous pass)", () => {
		expect(declaredNames.length).toBeGreaterThanOrEqual(1);
	});

	it("declared-but-absent: every AGENT_NAME_BY_ROLE value ships a tracked .pi/agents/<name>.md", () => {
		const offenders = declaredNames.filter((name) => !shippedStems.includes(name));
		expect(
			offenders,
			"these roles are declared in AGENT_NAME_BY_ROLE but ship no .pi/agents/<name>.md -- a role " +
				"routed to a subagent with no agent file cannot actually spawn one",
		).toEqual([]);
	});

	it("present-but-undeclared: every tracked .pi/agents/*.md names a role in AGENT_NAME_BY_ROLE, or is a named, reasoned exception", () => {
		const offenders = shippedStems.filter((stem) => !declaredNames.includes(stem) && !allowedUnroutedStems.includes(stem));
		expect(
			offenders,
			"these agent files ship but no role in AGENT_NAME_BY_ROLE routes to them, and none is named in " +
				"UNROUTED_AGENT_ALLOWLIST -- an agent Phase 5 will never override via " +
				"settings.subagents.agentOverrides; add a reasoned allowlist entry if this is deliberate " +
				"(e.g. a future-path agent file, per RB-08-03's precedent) or wire the role up",
		).toEqual([]);
	});

	it("UNROUTED_AGENT_ALLOWLIST carries no stale entry -- every stem it names is a real, shipped agent file", () => {
		const offenders = allowedUnroutedStems.filter((stem) => !shippedStems.includes(stem));
		expect(
			offenders,
			"UNROUTED_AGENT_ALLOWLIST names a stem with no corresponding .pi/agents/<stem>.md on disk -- " +
				"remove the stale entry",
		).toEqual([]);
	});
});

// -----------------------------------------------------------------------------
// EXT-01 coverage: required keys present on every real, shipped agent file
// -----------------------------------------------------------------------------

describe("subagent-agents-config -- EXT-01 coverage (real, shipped files)", () => {
	it.each(AGENT_FILES)("%s carries name, description, tools, thinking, systemPromptMode; name matches the filename stem", (file) => {
		const source = readFileSync(join(repoRoot(), file), "utf-8");
		const frontmatter = extractFrontmatter(source);
		expect(frontmatter, `${file}: no fenced frontmatter block found`).toBeDefined();
		if (frontmatter === undefined) {
			return;
		}
		for (const key of REQUIRED_KEYS) {
			expect(key in frontmatter, `${file}: missing required key "${key}"`).toBe(true);
		}
		const stem = basename(file, ".md");
		expect(frontmatter.name, `${file}: frontmatter "name" must equal the filename stem "${stem}"`).toBe(stem);
	});
});

// -----------------------------------------------------------------------------
// The forbidden-key assertion: no shipped agent defeats Phase 5's routing
// -----------------------------------------------------------------------------

describe("subagent-agents-config -- forbidden-key assertion (real, shipped files)", () => {
	it.each(AGENT_FILES)("%s carries no model: or fallbackModels: key", (file) => {
		const source = readFileSync(join(repoRoot(), file), "utf-8");
		const frontmatter = extractFrontmatter(source);
		expect(frontmatter, `${file}: no fenced frontmatter block found`).toBeDefined();
		if (frontmatter === undefined) {
			return;
		}
		const violations = frontmatterViolations(frontmatter).filter((v) => v.includes("forbidden key"));
		expect(violations, `${file}: ${violations.join("; ")}`).toEqual([]);
	});
});

// -----------------------------------------------------------------------------
// Live-predicate proof — the discriminator proven against inline fixtures
// -----------------------------------------------------------------------------

describe("extractFrontmatter + frontmatterViolations -- the discriminator is live against inline fixtures", () => {
	// Never written to .pi/agents/ itself -- a fixture on disk there would be
	// enumerated by the suites above and defeat the point of a controlled
	// negative case.
	const VALID_FIXTURE = [
		"---",
		"name: fixture-agent",
		"description: A fixture agent for the live-predicate proof, never shipped.",
		"tools: read, grep, find, ls",
		"thinking: high",
		"systemPromptMode: replace",
		"---",
		"",
		"Fixture body -- not a real agent.",
		"",
	].join("\n");

	it("accepts a fixture carrying every required key and no forbidden key", () => {
		const frontmatter = extractFrontmatter(VALID_FIXTURE);
		expect(frontmatter).toBeDefined();
		if (frontmatter === undefined) {
			return;
		}
		expect(
			frontmatterViolations(frontmatter),
			"the valid fixture must produce zero violations, or the rule rejects everything",
		).toEqual([]);
	});

	it("rejects a fixture carrying a model: key", () => {
		const fixture = VALID_FIXTURE.replace("systemPromptMode: replace", "systemPromptMode: replace\nmodel: claude-haiku-4-5");
		const frontmatter = extractFrontmatter(fixture);
		expect(frontmatter).toBeDefined();
		if (frontmatter === undefined) {
			return;
		}
		const violations = frontmatterViolations(frontmatter);
		expect(
			violations.some((v) => v.includes('"model"')),
			`expected a "model" violation, got ${JSON.stringify(violations)}`,
		).toBe(true);
	});

	it("rejects a fixture carrying a fallbackModels: key", () => {
		const fixture = VALID_FIXTURE.replace(
			"systemPromptMode: replace",
			"systemPromptMode: replace\nfallbackModels: dashscope/deepseek-v4-flash",
		);
		const frontmatter = extractFrontmatter(fixture);
		expect(frontmatter).toBeDefined();
		if (frontmatter === undefined) {
			return;
		}
		const violations = frontmatterViolations(frontmatter);
		expect(
			violations.some((v) => v.includes('"fallbackModels"')),
			`expected a "fallbackModels" violation, got ${JSON.stringify(violations)}`,
		).toBe(true);
	});

	it("rejects a fixture missing description", () => {
		const fixture = VALID_FIXTURE.split("\n")
			.filter((line) => !line.startsWith("description:"))
			.join("\n");
		const frontmatter = extractFrontmatter(fixture);
		expect(frontmatter).toBeDefined();
		if (frontmatter === undefined) {
			return;
		}
		const violations = frontmatterViolations(frontmatter);
		expect(
			violations.some((v) => v.includes('"description"')),
			`expected a "description" violation, got ${JSON.stringify(violations)}`,
		).toBe(true);
	});
});
