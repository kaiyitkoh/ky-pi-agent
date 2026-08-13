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
 * THIS FILE, TASK 1 OF 2. Only the `aws` half is implemented here; `terraform`
 * and `kubectl` land in Task 2 (`04-06-PLAN.md`), which extends
 * `classifyInfraInvocation` to dispatch to them. Until then, any non-`aws`
 * executable — including `terraform`/`kubectl` themselves — reports
 * `not-applicable`, matching how a not-yet-taught verb should behave rather
 * than silently allowing it.
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
// The public entry point (aws only for now -- Task 2 adds terraform/kubectl)
// ---------------------------------------------------------------------------

/** Discriminated verdict shape, mirroring `shell.ts`'s `ShellVerdict` and `git.ts`'s `GitVerdict`. */
export type InfraVerdict =
	| { readonly kind: "not-applicable" }
	| { readonly kind: "allow" }
	| { readonly kind: "confirm"; readonly reason: string }
	| { readonly kind: "sensitive-read"; readonly reason: string };

/**
 * The SAFE-07 decision for `aws` invocations. `{ kind: "not-applicable" }`
 * for any other executable — Task 2 extends this to dispatch `terraform` and
 * `kubectl` invocations too, so a later composer (Plan 07) can chain this
 * classifier with `git.ts`'s and `paths.ts`'s without special-casing "this
 * classifier had nothing to say about this command."
 */
export function classifyInfraInvocation(invocation: CanonicalInvocation): InfraVerdict {
	const executable = invocation.executable.toLowerCase();
	if (executable === "aws") {
		return classifyAwsInvocation(invocation.args);
	}
	return { kind: "not-applicable" };
}
