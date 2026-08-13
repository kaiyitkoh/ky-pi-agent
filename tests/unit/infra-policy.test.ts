/**
 * SAFE-07 — `.pi/extensions/safety/infra.ts`, table-driven.
 *
 * THIS FILE, TASK 1 OF 2. Only the `aws` half of the table is present here;
 * Task 2 (`04-06-PLAN.md`) extends this same file with `terraform` and
 * `kubectl` rows once `classifyInfraInvocation` dispatches to them.
 *
 * A `{ command, expected, why }` table over `classifyInfraInvocation`. The
 * orientation calls (`aws sts get-caller-identity`, `aws s3 ls`) are present
 * as NAMED ALLOW rows citing `04-RESEARCH.md` Pitfall 4, so a later change
 * that gates them fails loudly rather than silently degrading the harness
 * into approval fatigue.
 *
 * VACUOUS-PASS GUARD (this repo's house rule -- `tests/unit/git-policy.test.ts`,
 * `tests/unit/path-policy.test.ts`, `tests/unit/shell-deny-list.test.ts`):
 * the row table asserts its own length before use.
 */
import { describe, expect, it } from "vitest";

import {
	classifyInfraInvocation,
	isSafeAwsOperation,
	isSensitiveAwsRead,
	SAFE_AWS_EXACT_OPERATIONS,
} from "../../.pi/extensions/safety/infra.ts";
import type { CanonicalInvocation } from "../../.pi/extensions/safety/shell.ts";

/** Test-only convenience: builds a minimal `CanonicalInvocation` from a display command. The module never parses raw strings itself. */
function inv(command: string): CanonicalInvocation {
	const [executable, ...args] = command.trim().split(/\s+/);
	return { executable: executable ?? "", args, wrappers: [], rawSegment: command };
}

interface Row {
	readonly command: string;
	readonly expected: "allow" | "confirm" | "sensitive-read" | "not-applicable";
	readonly why: string;
}

const ROWS: readonly Row[] = [
	// -------------------------------------------------------------------------
	// aws -- the orientation calls, named ALLOW (Pitfall 4)
	// -------------------------------------------------------------------------
	{
		command: "aws sts get-caller-identity",
		expected: "allow",
		why: "Pitfall 4: gating the first orientation call trains reflexive approval",
	},
	{ command: "aws s3 ls", expected: "allow", why: "Pitfall 4: the other orientation call -- ls is a named safe operation" },
	{ command: "aws iam list-users", expected: "allow", why: "list- prefix" },
	{ command: "aws ec2 describe-instances", expected: "allow", why: "describe- prefix" },
	{ command: "aws logs tail", expected: "allow", why: "service-specific carve-out" },
	{ command: "aws logs filter-log-events", expected: "allow", why: "service-specific carve-out" },
	{ command: "aws ssm describe-parameters", expected: "allow", why: "describe- prefix, distinct from get-parameter*" },
	{ command: "aws configure list", expected: "allow", why: "named safe configure operation" },
	{ command: "aws configure list-profiles", expected: "allow", why: "named safe configure operation" },
	{
		command: "aws cloudformation estimate-template-cost",
		expected: "allow",
		why: "service-specific carve-out (SAFE_AWS_SERVICE_OPERATIONS.cloudformation)",
	},

	// -------------------------------------------------------------------------
	// aws -- mutating calls, CONFIRM
	// -------------------------------------------------------------------------
	{ command: "aws s3 rm s3://bucket/key", expected: "confirm", why: "rm matches no safe prefix" },
	{ command: "aws s3 cp local s3://bucket/key", expected: "confirm", why: "cp matches no safe prefix" },
	{ command: "aws iam create-access-key", expected: "confirm", why: "create matches no safe prefix" },
	{
		command: "aws ec2 terminate-instances --instance-ids i-x",
		expected: "confirm",
		why: "terminate-instances is irreversible and matches no safe prefix",
	},
	{
		command: "aws --profile prod s3 rm s3://b/k",
		expected: "confirm",
		why: "global-flag skipping: classifies as s3 rm, not --profile rm",
	},

	// -------------------------------------------------------------------------
	// aws -- sensitive reads, ORDERING-CRITICAL rows
	// -------------------------------------------------------------------------
	{
		command: "aws sts assume-role",
		expected: "sensitive-read",
		why: "sts operation other than get-caller-identity returns credential material",
	},
	{
		command: "aws secretsmanager get-secret-value --secret-id x",
		expected: "sensitive-read",
		why: "ORDERING PROOF: get-secret-value matches the ^get- safe prefix but is checked sensitive FIRST",
	},
	{
		command: "aws ssm get-parameter --name x",
		expected: "sensitive-read",
		why: "returns the plaintext parameter value",
	},
	{
		command: "aws configure get aws_secret_access_key",
		expected: "sensitive-read",
		why: "configure get is not in SAFE_AWS_CONFIGURE_OPERATIONS",
	},

	// -------------------------------------------------------------------------
	// not-applicable -- a non-aws executable (terraform/kubectl arrive in Task 2)
	// -------------------------------------------------------------------------
	{ command: "ls -la", expected: "not-applicable", why: "not an infra executable -- lets a composer chain classifiers" },
	{ command: "git push", expected: "not-applicable", why: "git.ts's job, not infra.ts's" },
	{ command: "terraform apply", expected: "not-applicable", why: "Task 1 covers aws only -- Task 2 wires terraform" },
];

describe("SAFE-07 -- infra-policy.test.ts: table is non-empty (vacuous-pass guard)", () => {
	it("has at least the rows the plan's acceptance criteria name", () => {
		expect(ROWS.length, "a shortened table silently drops a named allow or confirm case").toBeGreaterThanOrEqual(20);
	});
});

describe("SAFE-07 -- classifyInfraInvocation over the table", () => {
	for (const row of ROWS) {
		it(`${row.command} -> ${row.expected} (${row.why})`, () => {
			const verdict = classifyInfraInvocation(inv(row.command));
			expect(
				verdict.kind,
				`expected ${row.expected} for "${row.command}", got ${verdict.kind}` +
					("reason" in verdict ? ` (${verdict.reason})` : ""),
			).toBe(row.expected);
		});
	}
});

describe("SAFE-07 -- every confirm/sensitive-read verdict in the fixtures carries a non-empty reason", () => {
	const gatedRows = ROWS.filter((r) => r.expected === "confirm" || r.expected === "sensitive-read");

	it("has at least one confirm/sensitive-read row (guards against a vacuous check)", () => {
		expect(gatedRows.length).toBeGreaterThan(0);
	});

	for (const row of gatedRows) {
		it(`"${row.command}" verdict carries a non-empty reason`, () => {
			const verdict = classifyInfraInvocation(inv(row.command));
			expect(verdict.kind === "confirm" || verdict.kind === "sensitive-read", `expected a gated verdict for "${row.command}"`).toBe(
				true,
			);
			if (verdict.kind === "confirm" || verdict.kind === "sensitive-read") {
				expect(verdict.reason.length, `"${row.command}" produced an empty reason string`).toBeGreaterThan(0);
			}
		});
	}
});

describe("SAFE-07 -- isSensitiveAwsRead / isSafeAwsOperation exported and directly testable", () => {
	it("sts get-caller-identity is explicitly excluded from the sensitive-read rule", () => {
		expect(isSensitiveAwsRead("sts", "get-caller-identity")).toBe(false);
	});

	it("sts assume-role is sensitive", () => {
		expect(isSensitiveAwsRead("sts", "assume-role")).toBe(true);
	});

	it("secretsmanager get-secret-value is sensitive despite matching the ^get- safe prefix", () => {
		expect(isSensitiveAwsRead("secretsmanager", "get-secret-value")).toBe(true);
		expect(isSafeAwsOperation("secretsmanager", "get-secret-value")).toBe(true);
	});

	it("SAFE_AWS_EXACT_OPERATIONS contains ls (aws s3 ls's safe operation)", () => {
		expect(SAFE_AWS_EXACT_OPERATIONS.has("ls")).toBe(true);
	});
});
