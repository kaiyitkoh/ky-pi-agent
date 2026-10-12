/**
 * terraform / aws / kubectl mutating-vs-read classification. Prompting on `aws sts get-caller-identity`
 * trains reflexive approval, which is worse than no gate, so the allow-list matters as much as the confirm-list.
 *
 * Invariants:
 * - Ported from `@ramtinj95/pi-infra-command-guard@0.9.1` `tool-policies.ts:324-338,1436-1484`, not
 *   imported (its peer deps are a large unreviewed surface).
 * - `isSensitiveAwsRead` runs BEFORE `isSafeAwsOperation`: `secretsmanager get-secret-value` matches
 *   the `^get-` safe prefix. infra-policy.test.ts pins this.
 * - `sts` is sensitive except `get-caller-identity`; narrowing that to "any `sts get-*`" would admit
 *   `get-session-token`.
 * - Global-flag arity is tabulated so `aws --profile prod s3 rm` classifies as `s3 rm`; an unknown
 *   flag is skipped alone, which can only under-consume (toward confirm, never allow).
 * - Unknown terraform subcommands and kubectl verbs default to `confirm`, not a hard block as in
 *   `git.ts`: an operator may legitimately run them, and under `--mode json` `noOpUIContext.select`
 *   returns `undefined`, so confirm is terminal there anyway.
 * - `terraform state`/`workspace` classify on the pair so `state rm` and `state list` differ.
 * - Every `confirm` carries a `reason`: it is what the model reads, what `audit.ts` records and what
 *   the approval request shows.
 *
 * Pure: no ctx, fs, subprocess or default export; consumes only the `CanonicalInvocation` type.
 * Registers nothing and never spells the tool-registration call (contributing-boundary.test.ts
 * matches it as a substring).
 */
import type { CanonicalInvocation } from "./shell.ts";
import { normaliseExecutable } from "./shell.ts";


/** Operations safe regardless of service, verbatim from the reference implementation. */
export const SAFE_AWS_EXACT_OPERATIONS: ReadonlySet<string> = new Set([
	"describe",
	"get",
	"head",
	"help",
	"list",
	"lookup",
	"ls",
	"query",
	"scan",
	"search",
	"select",
	"status",
	"wait",
]);

/** `aws configure` operations that do NOT return credential material. Every other `configure` operation is sensitive. */
export const SAFE_AWS_CONFIGURE_OPERATIONS: ReadonlySet<string> = new Set(["list", "list-profiles"]);

/** Service-specific safe-operation carve-outs — a read that does not fit the generic `^get-`/`^list-`/... prefix rule. */
export const SAFE_AWS_SERVICE_OPERATIONS: Readonly<Record<string, ReadonlySet<string>>> = {
	cloudformation: new Set(["estimate-template-cost"]),
	logs: new Set(["filter-log-events", "tail"]),
	rds: new Set(["download-db-log-file-portion"]),
	route53: new Set(["test-dns-answer"]),
	route53domains: new Set(["check-domain-availability"]),
	s3api: new Set(["select-object-content"]),
};

/** `ssm` operations returning plaintext parameter values. */
const SSM_SENSITIVE_OPERATIONS = /^(?:get-parameter|get-parameter-history|get-parameters|get-parameters-by-path)$/;

/** Operation names that always return credential material; deliberately redundant with the `secretsmanager` check. */
const CREDENTIAL_OPERATION_PATTERN =
	/(?:access-details|access-token|authorization-token|credentials|federation-token|get-token|login-password|master-user-password|open-id-token|password-data|secret-value|session-token|signin-token|tokens-from-refresh-token)/;

/** True when `service operation` returns credential-shaped material, even if it matches a safe prefix; evaluate before {@link isSafeAwsOperation}. */
export function isSensitiveAwsRead(service: string, operation: string): boolean {
	if (service === "sts" && operation !== "get-caller-identity") {
		return true;
	}
	if (service === "configure" && !SAFE_AWS_CONFIGURE_OPERATIONS.has(operation)) {
		return true;
	}
	if (service === "secretsmanager") {
		return true;
	}
	if (service === "ssm" && SSM_SENSITIVE_OPERATIONS.test(operation)) {
		return true;
	}
	return CREDENTIAL_OPERATION_PATTERN.test(operation);
}

/** The generic read-verb prefix — `describe-*`, `get-*`, `list-*`, etc. */
const SAFE_OPERATION_PREFIX = /^(?:admin-get|batch-get|describe|get|head|list|lookup|search|simulate|validate)-/;

/** True for a safe non-mutating call; only valid after {@link isSensitiveAwsRead} ruled the operation out. */
export function isSafeAwsOperation(service: string, operation: string): boolean {
	return (
		SAFE_AWS_SERVICE_OPERATIONS[service]?.has(operation) === true ||
		SAFE_AWS_EXACT_OPERATIONS.has(operation) ||
		SAFE_OPERATION_PREFIX.test(operation)
	);
}

/** `aws` global flags that consume the NEXT word as their value. */
const AWS_GLOBAL_VALUE_FLAGS = new Set(["--profile", "--region", "--output"]);

/** `aws` global flags that take no value argument. */
const AWS_GLOBAL_BOOLEAN_FLAGS = new Set(["--no-cli-pager", "--debug"]);

/** The first two positional words after `aws` (service, operation), skipping global flags; `undefined` routes to `confirm`. */
function extractAwsServiceOperation(args: readonly string[]): { service: string; operation: string } | undefined {
	const positionals: string[] = [];
	let i = 0;
	while (i < args.length && positionals.length < 2) {
		const arg = args[i];
		if (AWS_GLOBAL_VALUE_FLAGS.has(arg)) {
			i += 2;
			continue;
		}
		if (AWS_GLOBAL_BOOLEAN_FLAGS.has(arg)) {
			i += 1;
			continue;
		}
		if (arg.startsWith("-")) {
			// Unrecognised flag: assume boolean; never guess value arity, since over-consuming could swallow the real service/operation.
			i += 1;
			continue;
		}
		positionals.push(arg);
		i += 1;
	}
	if (positionals.length < 2) {
		return undefined;
	}
	return { service: positionals[0], operation: positionals[1] };
}

function classifyAwsInvocation(args: readonly string[]): InfraVerdict {
	const parsed = extractAwsServiceOperation(args);
	if (parsed === undefined) {
		return {
			kind: "confirm",
			reason: `"aws ${args.join(" ")}" has no recognisable service/operation pair -- fail closed to confirmation`,
		};
	}
	const { service, operation } = parsed;

	// Order matters: sensitive-read before safe-operation.
	if (isSensitiveAwsRead(service, operation)) {
		return {
			kind: "sensitive-read",
			reason: `"aws ${service} ${operation}" returns credential-shaped material that would enter model context`,
		};
	}
	if (isSafeAwsOperation(service, operation)) {
		return { kind: "allow" };
	}
	return {
		kind: "confirm",
		reason: `"aws ${service} ${operation}" is a mutating AWS call, not in the read-only allow-list -- requires confirmation before it changes the live account`,
	};
}


/** terraform subcommands (or `state`/`workspace` pairs) that require confirmation: irreversible or hard-to-undo state mutations. */
export const TERRAFORM_CONFIRM_SUBCOMMANDS: ReadonlySet<string> = new Set([
	"apply",
	"destroy",
	"import",
	"state rm",
	"state mv",
	"taint",
	"untaint",
	"force-unlock",
	"workspace delete",
]);

/** terraform subcommands that run without a prompt: orientation and previews. */
export const TERRAFORM_ALLOW_SUBCOMMANDS: ReadonlySet<string> = new Set([
	"plan",
	"fmt",
	"validate",
	"show",
	"output",
	"version",
	"providers",
	"state list",
	"state show",
	"workspace select",
	"workspace list",
]);

/** Parents whose second word forms the classification key. */
const TERRAFORM_TWO_WORD_PARENTS = new Set(["state", "workspace"]);

function terraformSubcommandKey(args: readonly string[]): string | undefined {
	const first = args[0];
	if (first === undefined) {
		return undefined;
	}
	if (TERRAFORM_TWO_WORD_PARENTS.has(first) && args[1] !== undefined) {
		return `${first} ${args[1]}`;
	}
	return first;
}

function classifyTerraformInvocation(args: readonly string[]): InfraVerdict {
	const key = terraformSubcommandKey(args);
	if (key === undefined) {
		return {
			kind: "confirm",
			reason: "\"terraform\" with no subcommand -- fail closed to confirmation",
		};
	}
	if (TERRAFORM_CONFIRM_SUBCOMMANDS.has(key)) {
		return {
			kind: "confirm",
			reason: `"terraform ${key}" mutates state or a live resource and cannot be trivially undone`,
		};
	}
	if (TERRAFORM_ALLOW_SUBCOMMANDS.has(key)) {
		return { kind: "allow" };
	}
	// Unknown subcommand: fail toward the prompt, not execution.
	return {
		kind: "confirm",
		reason: `"terraform ${key}" is an unclassified subcommand -- defaults to confirm (fail-safe, not a hard block: add a table row rather than widening a default)`,
	};
}


/** kubectl verbs requiring confirmation: mutate a cluster or run code in a workload. */
export const KUBECTL_CONFIRM_VERBS: ReadonlySet<string> = new Set([
	"delete",
	"apply",
	"replace",
	"patch",
	"scale",
	"drain",
	"cordon",
	"exec",
]);

/** kubectl verbs that run without a prompt. */
export const KUBECTL_ALLOW_VERBS: ReadonlySet<string> = new Set(["get", "describe", "logs", "config"]);

function classifyKubectlInvocation(args: readonly string[]): InfraVerdict {
	const verb = args[0];
	if (verb === undefined) {
		return { kind: "confirm", reason: "\"kubectl\" with no verb -- fail closed to confirmation" };
	}
	if (KUBECTL_CONFIRM_VERBS.has(verb)) {
		const reason =
			verb === "exec"
				? `"kubectl exec" runs arbitrary commands inside a live workload -- the bash guard cannot see into a remote shell`
				: `"kubectl ${verb}" mutates a live cluster resource`;
		return { kind: "confirm", reason };
	}
	if (KUBECTL_ALLOW_VERBS.has(verb)) {
		return { kind: "allow" };
	}
	// Unknown verb: same posture as terraform.
	return {
		kind: "confirm",
		reason: `"kubectl ${verb}" is an unclassified verb -- defaults to confirm (fail-safe, not a hard block)`,
	};
}


export type InfraVerdict =
	| { readonly kind: "not-applicable" }
	| { readonly kind: "allow" }
	| { readonly kind: "confirm"; readonly reason: string }
	| { readonly kind: "sensitive-read"; readonly reason: string };

/** `not-applicable` for any executable other than aws/terraform/kubectl, so composers need not special-case it. */
export function classifyInfraInvocation(invocation: CanonicalInvocation): InfraVerdict {
	// Normalised so `aws.exe` and path-qualified spellings classify as the bare verb.
	const executable = normaliseExecutable(invocation.executable);
	if (executable === "aws") {
		return classifyAwsInvocation(invocation.args);
	}
	if (executable === "terraform") {
		return classifyTerraformInvocation(invocation.args);
	}
	if (executable === "kubectl") {
		return classifyKubectlInvocation(invocation.args);
	}
	return { kind: "not-applicable" };
}
