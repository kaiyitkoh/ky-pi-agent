/**
 * SAFE-07 — the terraform / aws / kubectl mutating-vs-read classification.
 *
 * The requirement most likely to be shipped backwards. A guard that prompts
 * on `aws sts get-caller-identity` — the first call a session makes to orient
 * itself — trains the user to approve reflexively, which `04-RESEARCH.md`
 * Pitfall 4 names as a WORSE security posture than no gate at all. Getting
 * the allow-list right is therefore not a nicety layered on top of the
 * confirm-list; it is the requirement's whole point.
 *
 * ---------------------------------------------------------------------------
 * REIMPLEMENTED, NOT IMPORTED
 * ---------------------------------------------------------------------------
 * `@ramtinj95/pi-infra-command-guard@0.9.1` is read-not-installed per
 * CONTEXT.md decision 9 (hard peer dep on `@howaboua/pi-codex-conversion`,
 * which drags in `openai`/`web-tree-sitter`/`tree-sitter-bash`/`ws` — a huge
 * unreviewed surface for a guard). `04-RESEARCH.md`'s "Code Examples" section
 * reproduces its AWS classification (`tool-policies.ts:324-338,1436-1484`)
 * verbatim as the pattern to carry; this module ports the pattern, never the
 * package. `infra.ts` imports nothing from that package and it appears
 * nowhere in `package.json`.
 *
 * ---------------------------------------------------------------------------
 * WHY `isSensitiveAwsRead` IS CHECKED BEFORE `isSafeAwsOperation`
 * ---------------------------------------------------------------------------
 * `secretsmanager get-secret-value` matches the `^get-` safe prefix
 * (`isSafeAwsOperation`'s regex allows any `get-*` operation). If the safe
 * check ran first, a credential-returning read would be waved through as an
 * ordinary orientation call. `classifyAwsInvocation` below therefore
 * evaluates `isSensitiveAwsRead` FIRST and returns immediately on a match,
 * never falling through to the safe-operation check. `tests/unit/infra-policy.test.ts`
 * pins this with `aws secretsmanager get-secret-value` — the exact fixture
 * that would flip to ALLOW if the two checks were reversed. That ordering was
 * verified by deliberately reversing the checks, watching the test go red,
 * then restoring the correct order (recorded in `04-06-SUMMARY.md`).
 *
 * ---------------------------------------------------------------------------
 * WHY `sts`/`get-caller-identity` IS EXCLUDED FROM THE SENSITIVE-READ RULE
 * ---------------------------------------------------------------------------
 * Kept exactly as `04-RESEARCH.md` reproduces it: `service === "sts" &&
 * operation !== "get-caller-identity"`. Every OTHER `sts` operation
 * (`assume-role`, `get-session-token`, `get-federation-token`, ...) returns
 * credential material and stays sensitive; `get-caller-identity` returns only
 * account/ARN/user-id and is the single call a session makes constantly to
 * orient itself. This is the one line that decides whether the harness is
 * usable — narrowing it to "any `sts get-*`" would silently re-admit
 * `get-session-token` as safe.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GLOBAL-FLAG SKIP IS TABULATED, NOT GUESSED
 * ---------------------------------------------------------------------------
 * `aws --profile prod s3 rm ...` must classify as `s3 rm`, not `--profile
 * rm` — the same class of error `04-RESEARCH.md` Pitfall 2 names for
 * `env`/`sudo` wrapper resolution (`shell.ts`'s `ENV_VALUE_OPTIONS` /
 * `SUDO_VALUE_OPTIONS`). `AWS_GLOBAL_VALUE_FLAGS` lists every value-taking
 * global flag this project's fixtures exercise (`--profile`, `--region`,
 * `--output`); `AWS_GLOBAL_BOOLEAN_FLAGS` lists the flags this module's
 * fixtures use that take no value (`--no-cli-pager`, `--debug`). Any other
 * `-`-prefixed token is treated as boolean and skipped alone — a
 * conservative default that can only ever consume too little (leaving a
 * flag's value to be mis-read as a positional, which is a fail-toward-confirm
 * outcome for an unclassified command, never a fail-toward-allow one).
 *
 * ---------------------------------------------------------------------------
 * WHY UNKNOWN TERRAFORM SUBCOMMANDS AND UNKNOWN KUBECTL VERBS DEFAULT TO
 * `confirm`, NOT `allow` OR A HARD BLOCK
 * ---------------------------------------------------------------------------
 * Unlike `git.ts`, where an unknown subcommand under a protected `HEAD` is a
 * hard block (there is no legitimate reason to approve an unrecognised git
 * write to `main`), an unknown infra verb has a legitimate human-in-the-loop
 * path: the operator may genuinely want to run it. Routing it to the
 * approval protocol is both fail-safe (nothing executes without a human
 * decision) and usable (it does not permanently wall off a verb this module
 * simply has not been taught). Under `--mode json` that `confirm` is a
 * terminal block anyway, because `noOpUIContext.select` returns `undefined`
 * — the deny-by-default property Plan 07 and Plan 09 build on and prove.
 *
 * ---------------------------------------------------------------------------
 * WHY `terraform state` / `terraform workspace` CLASSIFY ON THE PAIR
 * ---------------------------------------------------------------------------
 * `terraform state list` (read) and `terraform state rm` (mutates state,
 * silently orphaning real resources) share a first word. Classifying on
 * `args[0]` alone would give both the SAME verdict — whichever one the table
 * happened to name would swallow the other. `terraformSubcommandKey` below
 * joins `state`/`workspace` with their second word before any table lookup,
 * so `"state rm"` and `"state list"` are distinct keys. Same shape as `aws`'s
 * service+operation pair.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY `confirm` VERDICT CARRIES A `reason`
 * ---------------------------------------------------------------------------
 * That string is what the model reads when the call is blocked, what lands
 * in the audit row (`audit.ts`), and — in Plan 07 — what is shown in the
 * approval request itself. A `confirm` with no reason is a prompt the model
 * cannot act on and an audit row that cannot later explain itself.
 *
 * ---------------------------------------------------------------------------
 * PURITY (matches `shell.ts` / `git.ts`'s pure half / `redact.ts`'s contract)
 * ---------------------------------------------------------------------------
 * No `ctx`, no filesystem, no subprocess, no default export. The only import
 * is the `CanonicalInvocation` TYPE from `shell.ts` — this module consumes
 * the shape, never `shell.ts`'s runtime `canonicalise()` itself, so it stays
 * independently testable against hand-built fixtures exactly like
 * `git-policy.test.ts` does for `git.ts`.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import type { CanonicalInvocation } from "./shell.ts";
import { normaliseExecutable } from "./shell.ts";

// ---------------------------------------------------------------------------
// AWS classification (SAFE-07) — reproduced from `04-RESEARCH.md`'s
// "AWS mutating vs. read-only classification" code example, itself extracted
// from `@ramtinj95/pi-infra-command-guard@0.9.1 tool-policies.ts:324-338,1436-1484`.
// ---------------------------------------------------------------------------

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

/**
 * `ssm` operations that return the plaintext parameter value itself, distinct
 * from the many other `ssm describe-*`/`list-*` reads that do not.
 */
const SSM_SENSITIVE_OPERATIONS = /^(?:get-parameter|get-parameter-history|get-parameters|get-parameters-by-path)$/;

/**
 * Operation-name shapes that always return credential material, whichever
 * service they belong to. Kept intact, character-for-character, from
 * `04-RESEARCH.md` — this is the regex `secretsmanager get-secret-value`
 * trips even though the check above (`service === "secretsmanager"`) already
 * catches it unconditionally; the two are deliberately redundant so a
 * differently-shaped secretsmanager operation name still gets caught.
 */
const CREDENTIAL_OPERATION_PATTERN =
	/(?:access-details|access-token|authorization-token|credentials|federation-token|get-token|login-password|master-user-password|open-id-token|password-data|secret-value|session-token|signin-token|tokens-from-refresh-token)/;

/**
 * True when `service operation` returns credential-shaped material that must
 * never be treated as an ordinary safe read, EVEN IF it also matches a safe
 * prefix. Callers MUST evaluate this before {@link isSafeAwsOperation} — see
 * the module docstring's ordering section.
 */
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

/**
 * True when `service operation` is a safe, non-mutating call — evaluated only
 * AFTER {@link isSensitiveAwsRead} has already ruled the operation out (see
 * the module docstring's ordering section). Calling this alone, without
 * first checking `isSensitiveAwsRead`, re-admits `secretsmanager
 * get-secret-value` as allowed.
 */
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

/**
 * The first two POSITIONAL (non-flag) words after `aws` — its service and
 * operation — skipping global flags wherever they appear before either is
 * found. `undefined` when fewer than two positional words are present (e.g.
 * `aws --version`, `aws help`), which callers route to `confirm` rather than
 * guessing.
 */
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
			// Unrecognised flag: assume boolean and skip only the flag itself. Never
			// guessing a value-consuming arity here is deliberate -- over-consuming
			// risks swallowing the real service/operation words, which would
			// misclassify a mutating call as `undefined` -> confirm (safe direction).
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

	// ORDER MATTERS: sensitive-read before safe-operation. See module docstring.
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

// ---------------------------------------------------------------------------
// terraform classification (SAFE-07)
// ---------------------------------------------------------------------------

/**
 * terraform subcommands (or `<parent> <child>` pairs for `state`/`workspace`)
 * that require confirmation. Every entry here is either irreversible
 * (`apply`, `destroy`, `import`) or mutates state without touching real
 * infrastructure in a way that is easy to undo (`state rm`/`mv`, `taint`,
 * `untaint`, `force-unlock`, `workspace delete`).
 */
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

/**
 * terraform subcommands that run without a prompt -- the calls a session uses
 * to orient itself or preview a change, never one that mutates state or a
 * live resource.
 */
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

/** terraform subcommand parents whose SECOND word forms the classification key -- see module docstring. */
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
	// Unknown terraform subcommand: fail closed toward the prompt, not toward
	// execution -- see module docstring's "WHY UNKNOWN ... DEFAULT TO confirm" section.
	return {
		kind: "confirm",
		reason: `"terraform ${key}" is an unclassified subcommand -- defaults to confirm (fail-safe, not a hard block: add a table row rather than widening a default)`,
	};
}

// ---------------------------------------------------------------------------
// kubectl classification (SAFE-07)
// ---------------------------------------------------------------------------

/** kubectl verbs that require confirmation -- mutate a live cluster or run code inside a live workload. */
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

/** kubectl verbs that run without a prompt -- read-only inspection of the cluster. */
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
	// Unknown kubectl verb: fail closed toward the prompt, same posture as terraform above.
	return {
		kind: "confirm",
		reason: `"kubectl ${verb}" is an unclassified verb -- defaults to confirm (fail-safe, not a hard block)`,
	};
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

/** Discriminated verdict shape, mirroring `shell.ts`'s `ShellVerdict` and `git.ts`'s `GitVerdict`. */
export type InfraVerdict =
	| { readonly kind: "not-applicable" }
	| { readonly kind: "allow" }
	| { readonly kind: "confirm"; readonly reason: string }
	| { readonly kind: "sensitive-read"; readonly reason: string };

/**
 * The whole SAFE-07 decision. `{ kind: "not-applicable" }` for any executable
 * that is not `aws`/`terraform`/`kubectl`, so a later composer (Plan 07) can
 * chain this classifier with `git.ts`'s and `paths.ts`'s without
 * special-casing "this classifier had nothing to say about this command."
 */
export function classifyInfraInvocation(invocation: CanonicalInvocation): InfraVerdict {
	// CR-03: basename-reduced and extension-stripped, so `aws.exe`,
	// `terraform.exe`, `kubectl.exe` and path-qualified/`./`-relative forms
	// classify identically to the bare verb -- see `shell.ts#normaliseExecutable`.
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
