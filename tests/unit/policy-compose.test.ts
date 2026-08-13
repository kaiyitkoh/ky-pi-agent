/**
 * SAFE-03 / SAFE-10 -- `.pi/extensions/safety/policy.ts`, table-driven.
 *
 * A `{ name, toolName, input, facts, expected }` table over `evaluate()`,
 * covering every row in the plan's `<behavior>` block plus the
 * `<acceptance_criteria>`'s multi-segment, strongest-verdict and
 * path-classifier-not-git-or-infra cases. Also proves, directly rather than
 * only by fixture, the three deny-by-default mechanisms the module docstring
 * names: a classifier throwing, a malformed input shape, and every
 * `Verdict.kind` being reachable.
 *
 * VACUOUS-PASS GUARD (this repo's house rule -- `tests/unit/infra-policy.test.ts`,
 * `tests/unit/git-policy.test.ts`): the row table asserts its own length
 * before use, and a dedicated test collects every `Verdict.kind` actually
 * observed across the table and asserts it covers all three.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { evaluate, type PolicyFacts, type Verdict } from "../../.pi/extensions/safety/policy.ts";

const POLICY_SOURCE = readFileSync(new URL("../../.pi/extensions/safety/policy.ts", import.meta.url), "utf-8");

/** Strips line comments and block comments so the purity grep below cannot be fooled by a docstring mentioning the forbidden token in prose. */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const POLICY_CODE_ONLY = stripComments(POLICY_SOURCE);

function makeFacts(overrides: Partial<PolicyFacts> = {}): PolicyFacts {
	return {
		cwd: "C:/repo",
		projectRoot: "C:/repo",
		home: "C:/Users/tester",
		currentBranchFor: () => "feature/x",
		protectedBranches: ["main"],
		...overrides,
	};
}

const PROTECTED_MAIN: Partial<PolicyFacts> = { currentBranchFor: () => "main" };

interface Row {
	readonly name: string;
	readonly toolName: string;
	readonly input: unknown;
	readonly facts?: Partial<PolicyFacts>;
	readonly expected: Verdict["kind"];
	readonly reasonIncludes?: string;
}

const ROWS: readonly Row[] = [
	// -------------------------------------------------------------------------
	// Every named row in the plan's <behavior> block
	// -------------------------------------------------------------------------
	{ name: "git status -- read subcommand, allowed", toolName: "bash", input: { command: "git status" }, expected: "allow" },
	{
		name: "git push on protected main -- block, no approval path",
		toolName: "bash",
		input: { command: "git push" },
		facts: PROTECTED_MAIN,
		expected: "block",
		reasonIncludes: "writes to the checked-out branch",
	},
	{
		name: "terraform apply -- confirm",
		toolName: "bash",
		input: { command: "terraform apply" },
		expected: "confirm",
		reasonIncludes: "cannot be trivially undone",
	},
	{
		name: "git $(echo push) -- blocked by shell.ts, cause named in reason",
		toolName: "bash",
		input: { command: "git $(echo push)" },
		expected: "block",
		reasonIncludes: "command-substitution",
	},
	{
		name: "read terraform.tfstate -- block",
		toolName: "read",
		input: { path: "terraform.tfstate" },
		expected: "block",
		reasonIncludes: "Terraform state",
	},
	{
		name: "write .git/hooks/pre-commit -- block",
		toolName: "write",
		input: { path: ".git/hooks/pre-commit" },
		expected: "block",
		reasonIncludes: "git hook",
	},
	{
		name: "edit ../outside/file.ts -- block, outside project root",
		toolName: "edit",
		input: { path: "../outside/file.ts" },
		expected: "block",
		reasonIncludes: "outside the project root",
	},
	{
		name: "bash {} -- malformed, no command field",
		toolName: "bash",
		input: {},
		expected: "block",
		reasonIncludes: "missing or not a string",
	},
	{
		name: "bash {command: ''} -- malformed, empty command",
		toolName: "bash",
		input: { command: "" },
		expected: "block",
		reasonIncludes: "empty string",
	},
	{
		name: "unknown tool name -- allowed, this guard does not claim it",
		toolName: "some_unknown_tool",
		input: { anything: "goes" },
		expected: "allow",
	},

	// -------------------------------------------------------------------------
	// <acceptance_criteria> rows
	// -------------------------------------------------------------------------
	{
		name: "cd /tmp && git push on protected main -- strongest verdict wins over segments",
		toolName: "bash",
		input: { command: "cd /tmp && git push" },
		facts: PROTECTED_MAIN,
		expected: "block",
	},
	{
		name: "terraform plan && terraform apply -- strongest verdict wins (confirm beats allow)",
		toolName: "bash",
		input: { command: "terraform plan && terraform apply" },
		expected: "confirm",
	},
	{
		name: "cat terraform.tfstate -- blocked by the PATH classifier, not git or infra",
		toolName: "bash",
		input: { command: "cat terraform.tfstate" },
		expected: "block",
		reasonIncludes: "Terraform state",
	},

	// -------------------------------------------------------------------------
	// Negative controls -- the orientation/escape-hatch commands must stay usable
	// through the composed function, not just through their own module's tests
	// -------------------------------------------------------------------------
	{
		name: "git worktree add -b feat main on protected main -- still allowed (escape hatch)",
		toolName: "bash",
		input: { command: "git worktree add -b feat main" },
		facts: PROTECTED_MAIN,
		expected: "allow",
	},
	{ name: "aws sts get-caller-identity -- allowed (orientation call)", toolName: "bash", input: { command: "aws sts get-caller-identity" }, expected: "allow" },
	{ name: "kubectl get pods -- allowed (read-only)", toolName: "bash", input: { command: "kubectl get pods" }, expected: "allow" },
	{ name: "read README.md -- allowed, not a sensitive class", toolName: "read", input: { path: "README.md" }, expected: "allow" },
	{ name: "write src/index.ts inside project root -- allowed", toolName: "write", input: { path: "src/index.ts" }, expected: "allow" },

	// -------------------------------------------------------------------------
	// Garbage / unknown-shape inputs -- T-04-38, every one of these must block,
	// never throw and never fall through to allow
	// -------------------------------------------------------------------------
	{ name: "bash null input", toolName: "bash", input: null, expected: "block" },
	{ name: "bash array input", toolName: "bash", input: [], expected: "block" },
	{ name: "bash command is a number", toolName: "bash", input: { command: 12345 }, expected: "block" },
	{ name: "bash command is null", toolName: "bash", input: { command: null }, expected: "block" },
	{ name: "read path is an array", toolName: "read", input: { path: [] }, expected: "block" },
	{ name: "write path missing entirely", toolName: "write", input: {}, expected: "block" },
	{ name: "edit path is empty string", toolName: "edit", input: { path: "" }, expected: "block" },
];

describe("SAFE-03/SAFE-10 -- policy-compose.test.ts: table is non-empty (vacuous-pass guard)", () => {
	it("has at least the rows the plan's <behavior> and <acceptance_criteria> name", () => {
		expect(ROWS.length, "a shortened table silently drops a named allow/confirm/block case").toBeGreaterThanOrEqual(24);
	});
});

describe("SAFE-03/SAFE-10 -- evaluate() over the table", () => {
	for (const row of ROWS) {
		it(`${row.name} -> ${row.expected}`, () => {
			const verdict = evaluate(row.toolName, row.input, makeFacts(row.facts));
			expect(verdict.kind, `expected ${row.expected}, got ${verdict.kind} (${"reason" in verdict ? verdict.reason : "no reason"})`).toBe(
				row.expected,
			);
			if (row.reasonIncludes !== undefined) {
				expect("reason" in verdict && verdict.reason).toContain(row.reasonIncludes);
			}
		});
	}
});

describe("SAFE-03/SAFE-10 -- every Verdict.kind is reachable by at least one row", () => {
	it("produces allow, confirm and block across the fixture table", () => {
		const observed = new Set(ROWS.map((r) => r.expected));
		expect([...observed].sort()).toEqual(["allow", "block", "confirm"]);
	});
});

describe("SAFE-10 -- confirm verdicts carry a requestKey, deterministic and command-specific", () => {
	it("the same command, same cwd, produces the identical requestKey across two calls", () => {
		const facts = makeFacts();
		const v1 = evaluate("bash", { command: "terraform apply" }, facts);
		const v2 = evaluate("bash", { command: "terraform apply" }, facts);
		expect(v1.kind).toBe("confirm");
		expect(v2.kind).toBe("confirm");
		if (v1.kind === "confirm" && v2.kind === "confirm") {
			expect(v1.requestKey).toBe(v2.requestKey);
		}
	});

	it("a different command produces a different requestKey (command A cannot be laundered as command B)", () => {
		const facts = makeFacts();
		const v1 = evaluate("bash", { command: "terraform apply" }, facts);
		const v2 = evaluate("bash", { command: "terraform destroy" }, facts);
		expect(v1.kind).toBe("confirm");
		expect(v2.kind).toBe("confirm");
		if (v1.kind === "confirm" && v2.kind === "confirm") {
			expect(v1.requestKey).not.toBe(v2.requestKey);
		}
	});

	it("the same command in a different cwd produces a different requestKey", () => {
		const v1 = evaluate("bash", { command: "terraform apply" }, makeFacts({ cwd: "C:/repo" }));
		const v2 = evaluate("bash", { command: "terraform apply" }, makeFacts({ cwd: "C:/other" }));
		expect(v1.kind).toBe("confirm");
		expect(v2.kind).toBe("confirm");
		if (v1.kind === "confirm" && v2.kind === "confirm") {
			expect(v1.requestKey).not.toBe(v2.requestKey);
		}
	});
});

describe("SAFE-03 -- deny-by-default when a classifier throws (T-04-03)", () => {
	it("evaluate() catches an exception from facts.currentBranchFor and blocks, never throws itself", () => {
		const throwingFacts = makeFacts({
			currentBranchFor: () => {
				throw new Error("simulated classifier failure");
			},
		});
		let verdict: Verdict | undefined;
		expect(() => {
			verdict = evaluate("bash", { command: "git push" }, throwingFacts);
		}).not.toThrow();
		expect(verdict?.kind).toBe("block");
		expect(verdict !== undefined && "reason" in verdict && verdict.reason).toContain("policy evaluation threw");
	});
});

describe("SAFE-03 -- purity: policy.ts never reads ctx, process.env, hasUI or node:fs", () => {
	it("contains no `ctx.` reference in code (comments stripped)", () => {
		expect(POLICY_CODE_ONLY).not.toMatch(/\bctx\./);
	});

	it("contains no `hasUI` reference in code (comments stripped)", () => {
		expect(POLICY_CODE_ONLY).not.toMatch(/hasUI/);
	});

	it("contains no `process.env` reference in code (comments stripped)", () => {
		expect(POLICY_CODE_ONLY).not.toMatch(/process\.env/);
	});

	it("imports nothing from node:fs", () => {
		expect(POLICY_CODE_ONLY).not.toMatch(/from\s+["']node:fs["']/);
	});

	it("has no statement-position `export default`", () => {
		expect(POLICY_CODE_ONLY).not.toMatch(/^export default/m);
	});
});
