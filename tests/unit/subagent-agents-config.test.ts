/**
 * `.pi/agents/*.md` frontmatter contract, both directions: every file carries name, description, tools, thinking and
 * systemPromptMode, none carries `model`/`fallbackModels` (a pinned model would hide the routing decision; pi-subagents
 * applyDefaults only fills an undefined model), and every routed role ships a file. Discovery reads git's index, role
 * names come from AGENT_NAME_BY_ROLE, and the parser mirrors only the flat `key: value` half of pi-subagents' grammar.
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

/** Parses the flat `key: value` frontmatter lines, or undefined when there is no fenced block. */
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

/** The keys every agent file must carry; the model is routing's, proven by FORBIDDEN_KEYS. */
const REQUIRED_KEYS = ["name", "description", "tools", "thinking", "systemPromptMode"] as const;

/** Model selection in any form belongs to routing/agent-overrides.ts, never to an agent file. */
const FORBIDDEN_KEYS = ["model", "fallbackModels"] as const;

/** Every contract violation in `frontmatter`; shared by the real-file checks and the fixture proof. */
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

/** Agent files shipped without a routed role; each entry names why and the RB-* id that tracks wiring it. */
const UNROUTED_AGENT_ALLOWLIST: readonly { readonly stem: string; readonly reason: string }[] = [
	{
		stem: "executor-handoff",
		reason:
			"plan 09-11 builds and measures the FLOW-09 handoff packet entirely offline -- `pi-subagents` is " +
			"reviewed and pinned but NOT installed (Phase 7 installed nothing), so no role can route to a " +
			"subagent that cannot spawn; `probeSubagentAvailability` degrades to UNAVAILABLE rather than " +
			"silently passing. This agent file exists for the eventual real-subagent path, tracked as " +
			"RB-09-03, OUTSTANDING, which is itself gated behind RB-07-02 (install the five pinned specs " +
			"with a human present for the package-legitimacy gate)",
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
// Shipped agents neither shadow a builtin nor carry HTML comments
// -----------------------------------------------------------------------------

/** Builtin agent names shipped by pi-subagents 0.76.1 (package agents/ directory). */
const BUILTIN_AGENT_NAMES = [
	"claude-code",
	"claude-code-writer",
	"codex-exec",
	"codex-exec-writer",
	"cursor-agent",
	"cursor-agent-writer",
	"delegate",
	"evidence-auditor",
	"oracle",
	"researcher",
	"reviewer",
	"scout",
	"worker",
] as const;

describe("subagent-agents-config -- builtin shadowing and prompt hygiene (real, shipped files)", () => {
	it.each(AGENT_FILES)("%s does not shadow a pi-subagents builtin", (file) => {
		const source = readFileSync(join(repoRoot(), file), "utf-8");
		const declared = extractFrontmatter(source)?.name;
		const stem = basename(file, ".md");
		expect(BUILTIN_AGENT_NAMES as readonly string[], `${file}: filename stem collides with a builtin`).not.toContain(stem);
		expect(BUILTIN_AGENT_NAMES as readonly string[], `${file}: frontmatter name collides with a builtin`).not.toContain(declared);
	});

	it.each(AGENT_FILES)("%s carries no HTML comment, which would reach every child as system prompt", (file) => {
		const source = readFileSync(join(repoRoot(), file), "utf-8");
		expect(source).not.toContain("<!--");
	});
});

// -----------------------------------------------------------------------------
// Live-predicate proof — the discriminator proven against inline fixtures
// -----------------------------------------------------------------------------

describe("extractFrontmatter + frontmatterViolations -- the discriminator is live against inline fixtures", () => {
	// Inline, never under .pi/agents/, where the suites above would enumerate it.
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
