/**
 * terraform / aws / kubectl / openspec mutating-vs-read classification. Prompting on `aws sts get-caller-identity`
 * trains reflexive approval, which is worse than no gate, so the allow-list matters as much as the confirm-list.
 * Ported from `@ramtinj95/pi-infra-command-guard@0.9.1` `tool-policies.ts:324-338,1436-1484`, not imported (its peer
 * deps are a large unreviewed surface). Unknown subcommands confirm rather than block: under `--mode json` confirm is
 * terminal anyway. Every `confirm` carries the `reason` the model reads and the approval request shows.
 * Pure: no ctx, fs, subprocess or default export.
 */
import type { CanonicalInvocation } from "./shell.ts";
import { normaliseExecutable } from "./shell.ts";

const wordSet = (words: string): ReadonlySet<string> => new Set(words.split(" "));

export type InfraVerdict =
	| { readonly kind: "not-applicable" }
	| { readonly kind: "allow" }
	| { readonly kind: "confirm"; readonly reason: string }
	| { readonly kind: "sensitive-read"; readonly reason: string };

const confirm = (reason: string): InfraVerdict => ({ kind: "confirm", reason });

/** Operations safe regardless of service, verbatim from the reference implementation. */
export const SAFE_AWS_EXACT_OPERATIONS = wordSet("describe get head help list lookup ls query scan search select status wait");

/** `aws configure` operations that do NOT return credential material. Every other `configure` operation is sensitive. */
export const SAFE_AWS_CONFIGURE_OPERATIONS = wordSet("list list-profiles");

/** Service-specific safe-operation carve-outs — a read that does not fit the generic `^get-`/`^list-`/... prefix rule. */
export const SAFE_AWS_SERVICE_OPERATIONS: Readonly<Record<string, ReadonlySet<string>>> = {
	cloudformation: wordSet("estimate-template-cost"),
	logs: wordSet("filter-log-events tail"),
	rds: wordSet("download-db-log-file-portion"),
	route53: wordSet("test-dns-answer"),
	route53domains: wordSet("check-domain-availability"),
	s3api: wordSet("select-object-content"),
};

/** `ssm` operations returning plaintext parameter values. */
const SSM_SENSITIVE_OPERATIONS = /^(?:get-parameter|get-parameter-history|get-parameters|get-parameters-by-path)$/;

/** Operation names that always return credential material; deliberately redundant with the `secretsmanager` check. */
const CREDENTIAL_OPERATION_PATTERN =
	/(?:access-details|access-token|authorization-token|credentials|federation-token|get-token|login-password|master-user-password|open-id-token|password-data|secret-value|session-token|signin-token|tokens-from-refresh-token)/;

/**
 * True when `service operation` returns credential-shaped material, even if it matches a safe prefix
 * (`secretsmanager get-secret-value` matches `^get-`), so evaluate it before {@link isSafeAwsOperation}.
 * `sts` is sensitive except `get-caller-identity`: "any `sts get-*`" would admit `get-session-token`.
 */
export function isSensitiveAwsRead(service: string, operation: string): boolean {
	return (
		(service === "sts" && operation !== "get-caller-identity") ||
		(service === "configure" && !SAFE_AWS_CONFIGURE_OPERATIONS.has(operation)) ||
		service === "secretsmanager" ||
		(service === "ssm" && SSM_SENSITIVE_OPERATIONS.test(operation)) ||
		CREDENTIAL_OPERATION_PATTERN.test(operation)
	);
}

const SAFE_OPERATION_PREFIX = /^(?:admin-get|batch-get|describe|get|head|list|lookup|search|simulate|validate)-/;

/** True for a safe non-mutating call; only valid after {@link isSensitiveAwsRead} ruled the operation out. */
export function isSafeAwsOperation(service: string, operation: string): boolean {
	return (
		SAFE_AWS_SERVICE_OPERATIONS[service]?.has(operation) === true ||
		SAFE_AWS_EXACT_OPERATIONS.has(operation) ||
		SAFE_OPERATION_PREFIX.test(operation)
	);
}

const AWS_GLOBAL_VALUE_FLAGS = wordSet("--profile --region --output");

/** The first two positional words after `aws`, skipping global flags so `aws --profile prod s3 rm` is `s3 rm`. */
function extractAwsServiceOperation(args: readonly string[]): { service: string; operation: string } | undefined {
	const positionals: string[] = [];
	for (let i = 0; i < args.length && positionals.length < 2; i += 1) {
		// An unrecognised flag is skipped alone: guessing a value arity could swallow the real service/operation.
		if (AWS_GLOBAL_VALUE_FLAGS.has(args[i])) i += 1;
		else if (!args[i].startsWith("-")) positionals.push(args[i]);
	}
	return positionals.length < 2 ? undefined : { service: positionals[0], operation: positionals[1] };
}

function classifyAwsInvocation(args: readonly string[]): InfraVerdict {
	const parsed = extractAwsServiceOperation(args);
	if (parsed === undefined) {
		return confirm(`"aws ${args.join(" ")}" has no recognisable service/operation pair -- fail closed to confirmation`);
	}
	const { service, operation } = parsed;
	if (isSensitiveAwsRead(service, operation)) {
		return {
			kind: "sensitive-read",
			reason: `"aws ${service} ${operation}" returns credential-shaped material that would enter model context`,
		};
	}
	if (isSafeAwsOperation(service, operation)) return { kind: "allow" };
	return confirm(
		`"aws ${service} ${operation}" is a mutating AWS call, not in the read-only allow-list -- requires confirmation before it changes the live account`,
	);
}

/** terraform subcommands (or `state`/`workspace` pairs) that require confirmation: irreversible or hard-to-undo state mutations. */
export const TERRAFORM_CONFIRM_SUBCOMMANDS = new Set([
	...wordSet("apply destroy import taint untaint force-unlock"),
	"state rm",
	"state mv",
	"workspace delete",
]);

/** terraform subcommands that run without a prompt: orientation and previews. */
export const TERRAFORM_ALLOW_SUBCOMMANDS = new Set([
	...wordSet("plan fmt validate show output version providers"),
	"state list",
	"state show",
	"workspace select",
	"workspace list",
]);

/** kubectl verbs requiring confirmation: mutate a cluster or run code in a workload. */
export const KUBECTL_CONFIRM_VERBS = wordSet("delete apply replace patch scale drain cordon exec");

/** kubectl verbs that run without a prompt. */
export const KUBECTL_ALLOW_VERBS = wordSet("get describe logs config");

/** openspec subcommands (or `config`/`store`/`workset` pairs) that read only, or write only inside `openspec/`. */
export const OPENSPEC_ALLOW_SUBCOMMANDS = new Set([
	// `archive` writes only inside `openspec/`; bash writes are not path-classified, so a path-write rule must not regress it.
	...wordSet("list view show validate status instructions archive new change spec schema schemas templates context doctor"),
	...wordSet("__complete --help -h --version -V"),
	...["config get", "config list", "config path", "store list", "store doctor", "workset list"],
]);

/** openspec subcommands that write outside `openspec/`, change global state or leave this machine. */
export const OPENSPEC_CONFIRM_SUBCOMMANDS = new Set([
	...wordSet("init update completion feedback"),
	...["config set", "config unset", "config reset", "config edit", "config profile"],
	...["store setup", "store register", "store unregister", "store remove"],
	...["workset create", "workset open", "workset remove"],
]);

/** The first word, or the first two under a parent whose second word decides (`state rm` vs `state list`). */
function subcommandKey(args: readonly string[], twoWordParents: ReadonlySet<string>): string | undefined {
	return twoWordParents.has(args[0]) && args[1] !== undefined ? `${args[0]} ${args[1]}` : args[0];
}

const unclassified = (what: string, noun: string): InfraVerdict =>
	confirm(`"${what}" is an unclassified ${noun} -- defaults to confirm (fail-safe, not a hard block: add a table row rather than widening a default)`);

const sensitiveRead = (reason: string): InfraVerdict => ({ kind: "sensitive-read", reason });

/** `terraform show -json` and `output -raw/-json` print values the plain forms mask as sensitive. */
function terraformSecretDump(key: string, args: readonly string[]): InfraVerdict | undefined {
	const flags = args.slice(1).map((a) => a.replace(/^--/, "-").toLowerCase());
	const dumps = key === "show" ? flags.includes("-json") : key === "output" && (flags.includes("-raw") || flags.includes("-json"));
	return dumps ? sensitiveRead(`"terraform ${key}" in raw or JSON form prints state values, including secrets, into model context`) : undefined;
}

function classifyTerraformInvocation(rawArgs: readonly string[]): InfraVerdict {
	// terraform's only global options precede the subcommand.
	let skip = 0;
	while (/^--?chdir=/.test(rawArgs[skip] ?? "")) skip += 1;
	const args = rawArgs.slice(skip);
	if (/^(-v|-version|--version|-h|-help|--help)$/.test(args[0] ?? "")) return { kind: "allow" };
	const key = subcommandKey(args, wordSet("state workspace"));
	if (key === undefined) return confirm('"terraform" with no subcommand -- fail closed to confirmation');
	const dump = terraformSecretDump(key, args);
	if (dump !== undefined) return dump;
	if (TERRAFORM_CONFIRM_SUBCOMMANDS.has(key)) {
		return confirm(`"terraform ${key}" mutates state or a live resource and cannot be trivially undone`);
	}
	return TERRAFORM_ALLOW_SUBCOMMANDS.has(key) ? { kind: "allow" } : unclassified(`terraform ${key}`, "subcommand");
}

const KUBECTL_SECRET_RESOURCE = /^secrets?(\.v1)?(\/|$)/i;

/** True when a `get`/`describe` names the secret resource type in any position, including a comma list (`cm,secret`). */
const namesSecretResource = (args: readonly string[]): boolean =>
	args.slice(1).some((a) => !a.startsWith("-") && a.split(",").some((part) => KUBECTL_SECRET_RESOURCE.test(part)));

function kubectlSecretRead(verb: string, args: readonly string[]): InfraVerdict | undefined {
	if ((verb === "get" || verb === "describe") && namesSecretResource(args)) {
		return sensitiveRead(`"kubectl ${verb}" on secrets prints cluster secret material into model context`);
	}
	if (verb === "config" && args[1] === "view" && args.some((a) => a === "--raw" || a === "--raw=true")) {
		return sensitiveRead('"kubectl config view --raw" prints client credentials into model context');
	}
	return undefined;
}

function classifyKubectlInvocation(args: readonly string[]): InfraVerdict {
	const verb = args[0];
	if (verb === undefined) return confirm('"kubectl" with no verb -- fail closed to confirmation');
	const secretRead = kubectlSecretRead(verb, args);
	if (secretRead !== undefined) return secretRead;
	if (verb === "exec") {
		return confirm(`"kubectl exec" runs arbitrary commands inside a live workload -- the bash guard cannot see into a remote shell`);
	}
	if (KUBECTL_CONFIRM_VERBS.has(verb)) return confirm(`"kubectl ${verb}" mutates a live cluster resource`);
	return KUBECTL_ALLOW_VERBS.has(verb) ? { kind: "allow" } : unclassified(`kubectl ${verb}`, "verb");
}

function openspecConfirmWhy(key: string): string {
	if (key === "init" || key === "update") {
		return "writes agent config directories such as .pi/ and .claude/, and update can offer an unpinned global self-upgrade";
	}
	if (key === "completion") return "install edits shell rc files";
	return key === "feedback" ? "posts to GitHub via gh" : "changes OpenSpec global config or store state";
}

function classifyOpenspecInvocation(args: readonly string[]): InfraVerdict {
	const key = subcommandKey(args, wordSet("config store workset"));
	if (key === undefined) return confirm('"openspec" with no subcommand -- fail closed to confirmation');
	if (OPENSPEC_CONFIRM_SUBCOMMANDS.has(key)) {
		return confirm(`"openspec ${key}" ${openspecConfirmWhy(key)}; it cannot be trivially undone or leaves this repo`);
	}
	// 1.13.2 writes the --code-workspace path with no confinement (dist/commands/context.js writeCodeWorkspace).
	if (key === "context" && args.some((a) => a === "--code-workspace" || a.startsWith("--code-workspace="))) {
		return confirm(`"openspec context --code-workspace" writes a workspace file at an arbitrary path, outside openspec/`);
	}
	return OPENSPEC_ALLOW_SUBCOMMANDS.has(key) ? { kind: "allow" } : unclassified(`openspec ${key}`, "subcommand");
}

const CLASSIFIERS = new Map([
	["aws", classifyAwsInvocation],
	["terraform", classifyTerraformInvocation],
	["kubectl", classifyKubectlInvocation],
	["openspec", classifyOpenspecInvocation],
]);

/** `not-applicable` for any executable other than aws/terraform/kubectl/openspec, so composers need not special-case it. */
export function classifyInfraInvocation(invocation: CanonicalInvocation): InfraVerdict {
	const classify = CLASSIFIERS.get(normaliseExecutable(invocation.executable));
	return classify === undefined ? { kind: "not-applicable" } : classify(invocation.args);
}
