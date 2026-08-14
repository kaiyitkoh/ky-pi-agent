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
	// WR-06 -- a leading git GLOBAL option before the subcommand must not be
	// mistaken for the subcommand itself. Paired positive (read, allowed even
	// on protected main) and negative (write, still blocked on protected main).
	// -------------------------------------------------------------------------
	{
		name: "git -C /repo status on protected main -- allowed, -C is a global option, not the subcommand",
		toolName: "bash",
		input: { command: "git -C /repo status" },
		facts: PROTECTED_MAIN,
		expected: "allow",
	},
	{
		name: "git -C /repo push on protected main -- still blocked, -C must not shadow the real subcommand",
		toolName: "bash",
		input: { command: "git -C /repo push" },
		facts: PROTECTED_MAIN,
		expected: "block",
		reasonIncludes: "writes to the checked-out branch",
	},
	{
		name: "git --no-pager log on protected main -- allowed, a boolean global flag before the subcommand",
		toolName: "bash",
		input: { command: "git --no-pager log" },
		facts: PROTECTED_MAIN,
		expected: "allow",
	},
	{
		name: "git -c user.name=x diff on protected main -- allowed, -c takes a value and must be skipped as a pair",
		toolName: "bash",
		input: { command: "git -c user.name=x diff" },
		facts: PROTECTED_MAIN,
		expected: "allow",
	},

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

/**
 * WR-14 -- CR-07's own `isSensitiveSearchRoot` over-blocked one shape, fail-
 * closed (never a security defect) but the "annoying enough to get the guard
 * disabled" class this project's own `<specifics>` names as the real risk
 * once `grep`/`find`/`ls` are active anywhere: `isSensitiveSearchRoot`
 * matched a `.aws`/`.kube`/`.ssh`/`.gnupg` segment ANYWHERE in the path,
 * unanchored -- a legitimate in-project path merely CONTAINING one of those
 * segment names (`tests/fixtures/.ssh/...`, `node_modules/<pkg>/.aws/`) was
 * denied. That half of WR-14 is still correct and unaffected by WR-17 below.
 *
 * WR-14's OTHER half -- exempting an ABSENT `path` outright whenever
 * `projectRoot === home` -- is REVERTED here as **WR-17**: that exemption
 * reopened the exact SAFE-06 leak CR-07 exists to close, for the one case
 * where the danger is highest. A bare `grep { pattern:
 * "aws_secret_access_key" }` with no `path` at all, in a session rooted
 * directly at `$HOME`, recurses straight through `~/.aws` and returned
 * `allow` -- confirmed by execution. There is no principled difference
 * between that default and an EXPLICIT `path: "."` from the same session,
 * which correctly still blocks (see the case below) -- so the exemption is
 * removed outright: an absent path is evaluated through
 * `isSensitiveSearchRoot` exactly like every other search root.
 *
 * Every case here is paired with a CR-07 RE-RUN -- the exact fixtures
 * CR-07's own corpus rows (EV-61..EV-64) already prove, reproduced directly
 * here against `evaluate()` so this fix's own test file is self-contained
 * proof that neither WR-14's segment-anchoring fix nor WR-17's reversal
 * reopens CR-07, not merely a claim that the corpus elsewhere still passes.
 */
describe("WR-14/WR-17 -- grep/find/ls search-root false positives are fixed WITHOUT reopening CR-07 or SAFE-06", () => {
	it("a legitimate in-project path containing a .ssh segment, NOT under $HOME, is allowed", () => {
		const facts = makeFacts({ projectRoot: "C:/repo", home: "C:/Users/tester" });
		const verdict = evaluate("grep", { pattern: "x", path: "C:/repo/tests/fixtures/.ssh/known_hosts_fixture" }, facts);
		expect(
			verdict.kind,
			`expected allow, got ${verdict.kind} (${"reason" in verdict ? verdict.reason : "no reason"})`,
		).toBe("allow");
	});

	it("a node_modules path containing an .aws segment, NOT under $HOME, is allowed", () => {
		const facts = makeFacts({ projectRoot: "C:/repo", home: "C:/Users/tester" });
		const verdict = evaluate("ls", { path: "C:/repo/node_modules/some-pkg/.aws" }, facts);
		expect(
			verdict.kind,
			`expected allow, got ${verdict.kind} (${"reason" in verdict ? verdict.reason : "no reason"})`,
		).toBe("allow");
	});

	it("WR-17: a bare grep/find/ls with NO path, opened directly in $HOME, now BLOCKS -- the tool's own documented default recurses straight through ~/.aws", () => {
		const facts = makeFacts({ projectRoot: "C:/Users/tester", home: "C:/Users/tester" });
		const grepVerdict = evaluate("grep", { pattern: "aws_secret_access_key" }, facts);
		const findVerdict = evaluate("find", {}, facts);
		const lsVerdict = evaluate("ls", {}, facts);
		expect(grepVerdict.kind, "a bare grep from a session rooted at $HOME must block, not silently walk ~/.aws").toBe(
			"block",
		);
		expect(findVerdict.kind).toBe("block");
		expect(lsVerdict.kind).toBe("block");
	});

	it("an EXPLICIT path equal to $HOME, opened in $HOME, blocks identically to the absent-path default (WR-17 removed the difference between them)", () => {
		const facts = makeFacts({ projectRoot: "C:/Users/tester", home: "C:/Users/tester" });
		const verdict = evaluate("grep", { pattern: "x", path: "C:/Users/tester" }, facts);
		expect(verdict.kind, "an EXPLICIT path argument equal to $HOME must block, same as the absent-path default").toBe(
			"block",
		);
	});

	it("CR-07 RE-RUN (EV-61): grep over the ~/.aws DIRECTORY itself still blocks", () => {
		const facts = makeFacts({ projectRoot: "C:/repo", home: "C:/Users/tester" });
		const verdict = evaluate("grep", { pattern: "aws_secret_access_key", path: "C:/Users/tester/.aws" }, facts);
		expect(verdict.kind).toBe("block");
	});

	it("CR-07 RE-RUN (EV-62): ls over ~/.aws still blocks", () => {
		const facts = makeFacts({ projectRoot: "C:/repo", home: "C:/Users/tester" });
		const verdict = evaluate("ls", { path: "C:/Users/tester/.aws" }, facts);
		expect(verdict.kind).toBe("block");
	});

	it("CR-07 RE-RUN (EV-63): a search root equal to $HOME itself (session cwd != home) still blocks", () => {
		const facts = makeFacts({ projectRoot: "C:/repo", home: "C:/Users/tester" });
		const verdict = evaluate("grep", { pattern: "password", path: "C:/Users/tester" }, facts);
		expect(verdict.kind).toBe("block");
	});

	it("CR-07 RE-RUN (EV-64): a non-string path is still malformed/blocked", () => {
		const facts = makeFacts({ projectRoot: "C:/repo", home: "C:/Users/tester" });
		const verdict = evaluate("grep", { pattern: "x", path: ["~/.aws/credentials"] }, facts);
		expect(verdict.kind).toBe("block");
	});
});
