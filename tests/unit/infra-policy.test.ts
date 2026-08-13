/**
 * SAFE-07 — `.pi/extensions/safety/infra.ts`, table-driven.
 *
 * A `{ command, expected, why }` table over `classifyInfraInvocation`,
 * covering the three infra families (`aws`, `terraform`, `kubectl`) plus a
 * `not-applicable` row for a non-infra executable. The orientation calls
 * (`aws sts get-caller-identity`, `aws s3 ls`, `terraform plan`, `kubectl
 * get pods`) are present as NAMED ALLOW rows citing `04-RESEARCH.md`
 * Pitfall 4, so a later change that gates them fails loudly rather than
 * silently degrading the harness into approval fatigue.
 *
 * VACUOUS-PASS GUARD (this repo's house rule -- `tests/unit/git-policy.test.ts`,
 * `tests/unit/path-policy.test.ts`, `tests/unit/shell-deny-list.test.ts`):
 * the row table asserts its own length before use, and every entry in
 * `TERRAFORM_CONFIRM_SUBCOMMANDS`, `TERRAFORM_ALLOW_SUBCOMMANDS`,
 * `KUBECTL_CONFIRM_VERBS` and `KUBECTL_ALLOW_VERBS` is asserted reachable by
 * at least one row -- a dead table entry and an absent one would otherwise
 * produce identical green runs.
 */
import { describe, expect, it } from "vitest";

import {
	classifyInfraInvocation,
	isSafeAwsOperation,
	isSensitiveAwsRead,
	KUBECTL_ALLOW_VERBS,
	KUBECTL_CONFIRM_VERBS,
	SAFE_AWS_EXACT_OPERATIONS,
	TERRAFORM_ALLOW_SUBCOMMANDS,
	TERRAFORM_CONFIRM_SUBCOMMANDS,
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
	// terraform -- irreversible ops, CONFIRM
	// -------------------------------------------------------------------------
	{ command: "terraform apply", expected: "confirm", why: "irreversible infra change" },
	{ command: "terraform apply -auto-approve", expected: "confirm", why: "still an apply" },
	{ command: "terraform destroy", expected: "confirm", why: "irreversible infra change" },
	{ command: "terraform import x y", expected: "confirm", why: "irreversible infra change" },
	{ command: "terraform state rm x", expected: "confirm", why: "two-word subcommand: mutates state, orphans real resources" },
	{ command: "terraform state mv x y", expected: "confirm", why: "two-word subcommand: mutates state" },
	{ command: "terraform taint x", expected: "confirm", why: "mutates state" },
	{ command: "terraform untaint x", expected: "confirm", why: "mutates state" },
	{ command: "terraform force-unlock x", expected: "confirm", why: "mutates state lock" },
	{ command: "terraform workspace delete x", expected: "confirm", why: "two-word subcommand: destroys a workspace" },

	// -------------------------------------------------------------------------
	// terraform -- orientation / preview, named ALLOW (Pitfall 4's terraform sibling)
	// -------------------------------------------------------------------------
	{ command: "terraform plan", expected: "allow", why: "Pitfall 4 sibling: a local plan must not gate" },
	{ command: "terraform fmt", expected: "allow", why: "formatting only" },
	{ command: "terraform validate", expected: "allow", why: "read-only validation" },
	{ command: "terraform show", expected: "allow", why: "read-only state inspection" },
	{ command: "terraform output", expected: "allow", why: "read-only" },
	{ command: "terraform version", expected: "allow", why: "read-only" },
	{ command: "terraform providers", expected: "allow", why: "read-only" },
	{ command: "terraform state list", expected: "allow", why: "two-word subcommand: read-only, distinct from state rm" },
	{ command: "terraform state show x", expected: "allow", why: "two-word subcommand: read-only" },
	{ command: "terraform workspace select x", expected: "allow", why: "two-word subcommand: read-only" },
	{ command: "terraform workspace list", expected: "allow", why: "two-word subcommand: read-only" },

	// -------------------------------------------------------------------------
	// terraform -- unknown subcommand, fail closed to CONFIRM (not a hard block)
	// -------------------------------------------------------------------------
	{ command: "terraform frobnicate", expected: "confirm", why: "unknown subcommand defaults to confirm, not allow" },

	// -------------------------------------------------------------------------
	// kubectl -- mutating verbs, CONFIRM
	// -------------------------------------------------------------------------
	{ command: "kubectl delete pod x", expected: "confirm", why: "deletes a live cluster resource" },
	{ command: "kubectl delete -f manifest.yaml", expected: "confirm", why: "deletes via manifest" },
	{ command: "kubectl apply -f x", expected: "confirm", why: "mutates cluster state" },
	{ command: "kubectl replace -f x", expected: "confirm", why: "mutates cluster state" },
	{ command: "kubectl patch x", expected: "confirm", why: "mutates cluster state" },
	{ command: "kubectl scale x", expected: "confirm", why: "mutates cluster state" },
	{ command: "kubectl drain x", expected: "confirm", why: "mutates cluster state" },
	{ command: "kubectl cordon x", expected: "confirm", why: "mutates cluster state" },
	{
		command: "kubectl exec x",
		expected: "confirm",
		why: "runs arbitrary commands inside a live workload -- bash guard cannot see into it",
	},

	// -------------------------------------------------------------------------
	// kubectl -- read-only verbs, named ALLOW
	// -------------------------------------------------------------------------
	{ command: "kubectl get pods", expected: "allow", why: "read-only" },
	{ command: "kubectl describe pod x", expected: "allow", why: "read-only" },
	{ command: "kubectl logs x", expected: "allow", why: "read-only" },
	{ command: "kubectl config view", expected: "allow", why: "read-only" },

	// -------------------------------------------------------------------------
	// kubectl -- unknown verb, fail closed to CONFIRM
	// -------------------------------------------------------------------------
	{ command: "kubectl frobnicate x", expected: "confirm", why: "unknown verb defaults to confirm, not allow" },

	// -------------------------------------------------------------------------
	// not-applicable -- a non-infra executable
	// -------------------------------------------------------------------------
	{ command: "ls -la", expected: "not-applicable", why: "not an infra executable -- lets a composer chain classifiers" },
	{ command: "git push", expected: "not-applicable", why: "git.ts's job, not infra.ts's" },
];

describe("SAFE-07 -- infra-policy.test.ts: table is non-empty (vacuous-pass guard)", () => {
	it("has at least the rows the plan's acceptance criteria name", () => {
		expect(ROWS.length, "a shortened table silently drops a named allow or confirm case").toBeGreaterThanOrEqual(45);
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

describe("SAFE-07 -- liveness guard: every table key is exercised", () => {
	const terraformUsed = new Set(
		ROWS.filter((r) => r.command.startsWith("terraform ")).map((r) => {
			const words = r.command.split(/\s+/).slice(1);
			return words[0] === "state" || words[0] === "workspace" ? `${words[0]} ${words[1]}` : words[0];
		}),
	);
	const kubectlUsed = new Set(
		ROWS.filter((r) => r.command.startsWith("kubectl ")).map((r) => r.command.split(/\s+/)[1]),
	);

	it("every TERRAFORM_CONFIRM_SUBCOMMANDS key is exercised by at least one row", () => {
		const dead = [...TERRAFORM_CONFIRM_SUBCOMMANDS].filter((k) => !terraformUsed.has(k));
		expect(dead, `these terraform confirm keys have no fixture row: ${dead.join(", ")}`).toEqual([]);
	});

	it("every TERRAFORM_ALLOW_SUBCOMMANDS key is exercised by at least one row", () => {
		const dead = [...TERRAFORM_ALLOW_SUBCOMMANDS].filter((k) => !terraformUsed.has(k));
		expect(dead, `these terraform allow keys have no fixture row: ${dead.join(", ")}`).toEqual([]);
	});

	it("every KUBECTL_CONFIRM_VERBS key is exercised by at least one row", () => {
		const dead = [...KUBECTL_CONFIRM_VERBS].filter((k) => !kubectlUsed.has(k));
		expect(dead, `these kubectl confirm verbs have no fixture row: ${dead.join(", ")}`).toEqual([]);
	});

	it("every KUBECTL_ALLOW_VERBS key is exercised by at least one row", () => {
		const dead = [...KUBECTL_ALLOW_VERBS].filter((k) => !kubectlUsed.has(k));
		expect(dead, `these kubectl allow verbs have no fixture row: ${dead.join(", ")}`).toEqual([]);
	});

	it("all four tables are non-empty (guards against a vacuous coverage check)", () => {
		expect(TERRAFORM_CONFIRM_SUBCOMMANDS.size).toBeGreaterThan(0);
		expect(TERRAFORM_ALLOW_SUBCOMMANDS.size).toBeGreaterThan(0);
		expect(KUBECTL_CONFIRM_VERBS.size).toBeGreaterThan(0);
		expect(KUBECTL_ALLOW_VERBS.size).toBeGreaterThan(0);
	});
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
