/**
 * SAFE-03 / SAFE-10 — the single decision function: `evaluate(toolName, input,
 * facts)`, composing `shell.ts`, `paths.ts`, `git.ts` and `infra.ts` into one
 * `Verdict` for `bash`/`read`/`write`/`edit`.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 * `noOpUIContext.confirm` returns `false` and `noOpUIContext.select` returns
 * `undefined` under `--mode json`/`-p`/a spawned subagent
 * [VERIFIED: `dist/core/extensions/runner.js:88-119`, `hasUI()` an
 * object-identity check at `runner.js:274-276` — 04-RESEARCH.md Pattern 4].
 * A guard shaped `if (ctx.hasUI && !ok) block` therefore falls through to
 * ALLOW on every headless run, because the `else` branch (no UI) is never
 * written at all. THIS MODULE NEVER READS `ctx`, so that shape cannot appear
 * here even by accident — but the same failure mode can reappear structurally
 * (an uninitialised verdict variable, a switch with no default, a classifier
 * throwing past an unguarded call site), and every one of those is what the
 * rest of this docstring, and every function below, is written to rule out.
 *
 * EVERY DECISION BELOW STARTS FROM DENY AND IS PROMOTED TO ALLOW ONLY ON AN
 * EXPLICIT POSITIVE MATCH. Concretely: `evaluateInvocation` and
 * `evaluateBash`'s loop both initialise their running verdict to `allow` at
 * the START of the reduction, but the WHOLE composition is deny-shaped
 * anyway, because "allow" is never the terminal answer for an invocation this
 * module actually classifies — it is only what remains after every
 * classifier that had an opinion returned `allow` or "not applicable", and
 * `strongerOf` can only ever move the running verdict TOWARD `block`, never
 * away from one a classifier already returned. A block, once produced by any
 * invocation or any classifier, cannot be un-produced by a later allow. DO
 * NOT "simplify" `strongerOf`/the reduction loop into an early-return
 * allow-unless-blocked shape — that is the exact inversion this docstring
 * rules out. See {@link strongerOf} and {@link VERDICT_RANK}.
 *
 * The three OTHER places deny-by-default is a property of the code's SHAPE,
 * not of a test that could be deleted:
 *   1. `evaluate()`'s `try`/`catch` — a classifier throwing (a bug in
 *      `shell.ts`/`paths.ts`/`git.ts`/`infra.ts`, or a future one) is caught
 *      and converted to `{ kind: "block" }`, never left to propagate as an
 *      exception a caller might mistake for "nothing to block" (T-04-03).
 *   2. `evaluateBash`/`evaluateRead`/`evaluateWrite`'s malformed-input checks
 *      run BEFORE any classifier sees the input — a missing, non-string or
 *      empty `command`/`path` is a block naming the malformed shape, never a
 *      value that reaches a classifier and produces an undefined outcome
 *      (T-04-38). Pi performs NO re-validation after a `tool_call` mutation
 *      [CONTEXT.md decision 5, `types.d.ts:899-903`], so a malformed input
 *      reaching this module is exactly the case that must not fall through.
 *   3. `fromInfraVerdict`'s `switch` ends in an `exhaustive: never` default —
 *      a future `InfraVerdict.kind` added to `infra.ts` without a matching
 *      arm here is a COMPILE ERROR, not a silent fallthrough to allow.
 *
 * ---------------------------------------------------------------------------
 * WHY UNKNOWN TOOL NAMES ARE ALLOWED, AND WHY THAT IS NOT THE SAME BUG
 * ---------------------------------------------------------------------------
 * `evaluate("some_unrelated_tool", ...)` returns `{ kind: "allow" }` — this
 * is a DIFFERENT question from "is this shape recognised". This module
 * governs exactly seven tool names (`bash`, `read`, `write`, `edit`, `grep`,
 * `find`, `ls` -- every one of Pi's own built-in tools, CR-04) and says so in
 * the `switch`'s `default` arm. A tool this guard does not wrap is a
 * real bypass (an extension-registered tool that shells out internally,
 * say) — SAFE-15's published limits table names that gap explicitly rather
 * than this module silently claiming coverage it does not have [T-04-41,
 * disposition: accept]. Once `evaluate` DOES recognise the tool name, every
 * subsequent decision inside that branch is deny-shaped per the rule above.
 *
 * ---------------------------------------------------------------------------
 * EVALUATION ORDER FOR `bash` (pinned by `tests/unit/policy-compose.test.ts`)
 * ---------------------------------------------------------------------------
 *   1. `canonicalise(command)` — a `{ kind: "refused" }` result terminates
 *      immediately with a block naming `shell.ts`'s own refusal cause
 *      (SAFE-03's fail-closed parse layer; command substitution, heredocs,
 *      backgrounding, unresolved expansions, shell-runner indirection all
 *      stop here and never reach a classifier below).
 *   2. For EACH canonical invocation found in the command (one per `Command`
 *      node `shell.ts` extracted — `cd /tmp && git push` and
 *      `terraform plan && terraform apply` each yield more than one), in
 *      this order:
 *        a. git/glab classification, using
 *           `currentBranchFor(invocation.cwdOverride ?? facts.cwd)` — called
 *           ONLY when the invocation's executable is literally `git` or
 *           `glab`, so a command with no git/glab invocation never triggers
 *           the one impure fact this module reads;
 *        b. infra classification (`terraform`/`aws`/`kubectl`);
 *        c. path classification over every argument in the invocation,
 *           applying `classifyPathRead` — the SAME sensitive-read table
 *           SAFE-06 uses for the `read` tool, so `cat terraform.tfstate` is
 *           caught by the path table even though neither the git nor the
 *           infra classifier has anything to say about `cat`.
 *           DELIBERATELY `classifyPathRead`, not `classifyPathWrite`, for a
 *           bash argument: `classifyPathWrite`'s out-of-project containment
 *           check would block nearly every absolute path a normal bash
 *           command references (`/usr/bin/env`, a `node_modules` path
 *           outside the repo, `/etc/hosts`) — SAFE-13's detonation-target
 *           half of `classifyPathWrite` is exercised directly by the
 *           `write`/`edit` tool surface below, where a real destination path
 *           is unambiguous; a later plan wiring bash REDIRECT targets
 *           through `classifyPathWrite` specifically (rather than every
 *           plain argument) is a legitimate, separately-scoped extension,
 *           not a gap silently narrowed here.
 *   3. The STRONGEST verdict across every invocation and every classifier
 *      wins (`block` > `confirm` > `allow`) — a block anywhere in a
 *      multi-segment command blocks the WHOLE command, so
 *      `cd /tmp && git push` is not allowed on the strength of its harmless
 *      first segment.
 *
 * A bash argument reaches `canonicalisePathArg` as `{ text: arg, value: arg
 * }` — `CanonicalInvocation.args` (`shell.ts`) is already `Word.value`-
 * resolved (quotes stripped, POSIX backslash escapes applied), not the raw
 * `Word.text` `paths.ts`'s own docstring says is required for an unquoted
 * Windows path to survive intact. KNOWN LIMITATION, not silently narrowed:
 * an unquoted Windows path argument reaching a sensitive-read check THROUGH
 * bash (as opposed to through the `read` tool directly, which passes the
 * tool-parameter string with no separate raw/resolved form and is
 * unaffected) may mangle exactly the way `paths.ts`'s own docstring
 * describes for `.value`. Threading `Word.text` through `CanonicalInvocation`
 * is `shell.ts`'s own extension point (04-04-SUMMARY.md's "Next Phase
 * Readiness"), not this module's; recorded here so a later plan does not
 * have to rediscover it.
 *
 * ---------------------------------------------------------------------------
 * `requestKey` — WHY IT MUST BE DERIVABLE IDENTICALLY AT TWO CALL SITES
 * ---------------------------------------------------------------------------
 * Plan 08's approval flow calls `evaluate()` at the `tool_call` hook (which
 * creates the pending approval) and AGAIN inside the wrapped tool's own
 * `execute()` (which must recognise the re-issued call as the same one that
 * was approved) — two genuinely separate call sites, per CONTEXT.md decision
 * 5's "enforce twice" rule. `computeRequestKey` is a pure function of
 * `(toolName, the exact `command`/`path` field, cwd)`, so both call sites,
 * given the same re-issued tool call, compute the identical string with no
 * shared mutable state. It is NOT a cryptographic hash — a stable, sorted-key
 * JSON-like serialisation is sufficient here, because the only property this
 * key needs is "identical input produces an identical string, twice, in two
 * different call stacks", never collision-resistance against an adversary
 * (`approvals.ts`'s byte-for-byte `command`/`reason` check is what actually
 * guards against a laundered approval, not this key's shape).
 *
 * ---------------------------------------------------------------------------
 * PURITY (matches `shell.ts` / `paths.ts` / `git.ts`'s pure half / `infra.ts`)
 * ---------------------------------------------------------------------------
 * No `ctx`, no `process.env`, no `node:fs`, no default export. The only
 * impure fact this module ever asks for — "what branch is currently checked
 * out" — is supplied by the CALLER as `facts.currentBranchFor`, never read
 * directly; `evaluate` itself never calls `git` or touches a filesystem. This
 * is what lets `tests/unit/policy-compose.test.ts` be a millisecond fixture
 * table exactly like every sibling module's own test file.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import type { CanonicalInvocation } from "./shell.ts";
import { canonicalise, normaliseExecutable } from "./shell.ts";
import type { PathPolicyFacts } from "./paths.ts";
import { canonicalisePathArg, classifyPathRead, classifyPathWrite } from "./paths.ts";
import type { GitInvocation, GitPolicyFacts, GitVerdict } from "./git.ts";
import { classifyGitInvocation, classifyGlabInvocation } from "./git.ts";
import type { InfraVerdict } from "./infra.ts";
import { classifyInfraInvocation } from "./infra.ts";

// ---------------------------------------------------------------------------
// Verdict shape
// ---------------------------------------------------------------------------

/**
 * The composed decision. `confirm` always carries a `requestKey` — Plan 08's
 * approval store keys its one-shot grant on exactly this string. A `block`
 * never carries an approval path: SAFE-04's protected-branch write and
 * SAFE-06's sensitive read are not things an in-band approval can safely
 * undo (the branch is still protected; the secret has still entered
 * context), so this module never emits `confirm` for either.
 */
export type Verdict =
	| { readonly kind: "allow" }
	| { readonly kind: "confirm"; readonly reason: string; readonly requestKey: string }
	| { readonly kind: "block"; readonly reason: string };

/**
 * Every environmental fact `evaluate` needs and will never derive for
 * itself — mirrors `paths.ts`'s `PathPolicyFacts` / `git.ts`'s
 * `GitPolicyFacts` purity contract, composed into one object so a caller
 * assembles it once per tool call.
 */
export interface PolicyFacts {
	/** The harness's own working directory — used when an invocation carries no `cwdOverride` of its own. */
	readonly cwd: string;
	/** Already-canonical absolute path — `classifyPathWrite`'s containment root. */
	readonly projectRoot: string;
	/** Already-canonical or plain home directory string, forwarded to `canonicalisePathArg`/`classifyPathWrite`. */
	readonly home: string;
	/**
	 * What branch is checked out at `cwd` — called lazily, and ONLY for an
	 * invocation whose executable is literally `git`, so a command with no
	 * git invocation never triggers this (likely `spawnSync`-backed) call.
	 */
	readonly currentBranchFor: (cwd: string) => string;
	/** Branch names treated as protected — forwarded to `classifyGitInvocation`. */
	readonly protectedBranches: readonly string[];
	/** Forwarded to `classifyPathRead`'s kubeconfig rule, when supplied. */
	readonly kubeconfigEnv?: string;
}

// ---------------------------------------------------------------------------
// Strongest-verdict-wins reduction
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<Verdict["kind"], number> = { allow: 0, confirm: 1, block: 2 };

/**
 * `b` replaces `a` only when `b` is STRICTLY stronger — a `block` anywhere
 * can never be downgraded by a later `allow`/`confirm`, which is the whole
 * mechanism behind "a block anywhere in a multi-segment command blocks the
 * whole command" (see module docstring, evaluation-order step 3).
 */
function strongerOf(a: Verdict, b: Verdict): Verdict {
	return VERDICT_RANK[b.kind] > VERDICT_RANK[a.kind] ? b : a;
}

// ---------------------------------------------------------------------------
// Malformed-input handling (T-04-38)
// ---------------------------------------------------------------------------

type FieldExtraction = { readonly kind: "ok"; readonly value: string } | { readonly kind: "missing"; readonly reason: string };

function describeShape(value: unknown): string {
	if (value === undefined) {
		return "undefined";
	}
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "an array";
	}
	return typeof value;
}

/**
 * A missing field, a non-string field, or an empty-string field are all
 * treated as the SAME malformed shape — a block naming exactly which of the
 * three it was. No classifier below is ever handed `undefined` or `""` to
 * interpret on its own.
 */
function extractStringField(input: unknown, field: string): FieldExtraction {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return { kind: "missing", reason: `input is not an object (received ${describeShape(input)})` };
	}
	const value = (input as Record<string, unknown>)[field];
	if (typeof value !== "string") {
		return { kind: "missing", reason: `"${field}" is missing or not a string (received ${describeShape(value)})` };
	}
	if (value === "") {
		return { kind: "missing", reason: `"${field}" is an empty string` };
	}
	return { kind: "ok", value };
}

// ---------------------------------------------------------------------------
// requestKey — see module docstring
// ---------------------------------------------------------------------------

/** Deterministic, key-sorted serialisation — never `JSON.stringify` directly, whose key order is insertion order and not guaranteed stable across equivalent-but-differently-built objects. */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function computeRequestKey(toolName: string, keyedInput: Readonly<Record<string, unknown>>, cwd: string): string {
	return `${toolName}::${stableStringify(keyedInput)}::${cwd}`;
}

// ---------------------------------------------------------------------------
// Sub-classifier adapters — each converts one classifier's own verdict shape
// into this module's `Verdict`, so `evaluateInvocation` never inspects a
// foreign discriminant directly.
// ---------------------------------------------------------------------------

function fromGitVerdict(verdict: GitVerdict): Verdict {
	// No approval path for a git/glab block, ever -- see module docstring.
	return verdict.kind === "allow" ? { kind: "allow" } : { kind: "block", reason: verdict.reason };
}

function fromInfraVerdict(verdict: InfraVerdict, requestKey: string): Verdict {
	switch (verdict.kind) {
		case "not-applicable":
		case "allow":
			return { kind: "allow" };
		case "confirm":
			return { kind: "confirm", reason: verdict.reason, requestKey };
		case "sensitive-read":
			// Approving does not un-expose a secret already read into the
			// model's context window -- same posture as SAFE-06's path-read
			// block, deliberately not routed to approval.
			return { kind: "block", reason: verdict.reason };
		default: {
			// Exhaustiveness guard (see module docstring, deny-by-default point 3):
			// a future InfraVerdict.kind added without a matching arm here is a
			// COMPILE ERROR, not a silent fallthrough to allow.
			const exhaustive: never = verdict;
			return exhaustive;
		}
	}
}

/**
 * WR-06: `git`'s OWN global options (`-C <path>`, `-c <name>=<value>`,
 * `--git-dir <path>`, `--work-tree <path>`, `--namespace <name>`) may appear
 * BEFORE the subcommand -- `git -C /repo status`, `git --no-pager log`,
 * `git -c user.name=x diff` are all legitimate, common invocations. Taking
 * `args[0]` as the subcommand verbatim (the previous shape) reads `"-C"` /
 * `"--no-pager"` / `"-c"` as the subcommand itself, which hits
 * `classifyGitInvocation`'s fail-closed unknown-subcommand arm and blocks a
 * plain read on a protected `HEAD` -- exactly the "annoying enough to get
 * disabled" failure mode 04-CONTEXT.md's own stated risk names. Skips every
 * leading `-`-prefixed token, consuming the next word as that flag's value
 * for the ones that take one (mirrors `shell.ts#resolveWrappers`'s own
 * tabulated-arity approach for `env`/`sudo`), so the subcommand this function
 * selects is the first POSITIONAL word, regardless of how many global options
 * precede it. `extractGitCwdOverride` (`shell.ts`) already resolves `-C`/
 * `--git-dir` for the `currentBranchFor` oracle independently -- this
 * function only has to skip past them to find the subcommand.
 */
const GIT_GLOBAL_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

function toGitInvocation(invocation: CanonicalInvocation): GitInvocation {
	const args = invocation.args;
	let i = 0;
	while (i < args.length && args[i].startsWith("-")) {
		const flag = args[i];
		if (GIT_GLOBAL_VALUE_OPTIONS.has(flag)) {
			i += 2;
		} else {
			// An unrecognised global flag, or a boolean one (--no-pager, -p, ...):
			// skip only the flag itself, never guessing an arity that could
			// over-consume into the real subcommand.
			i += 1;
		}
	}
	return { subcommand: args[i] ?? "", args: args.slice(i + 1) };
}

/** One invocation's own strongest verdict across git/glab, infra and path classification — see module docstring, evaluation-order step 2. */
function evaluateInvocation(invocation: CanonicalInvocation, facts: PolicyFacts, requestKey: string): Verdict {
	let strongest: Verdict = { kind: "allow" };
	const executable = normaliseExecutable(invocation.executable);

	if (executable === "git") {
		const gitFacts: GitPolicyFacts = {
			currentBranch: facts.currentBranchFor(invocation.cwdOverride ?? facts.cwd),
			protectedBranches: facts.protectedBranches,
		};
		strongest = strongerOf(strongest, fromGitVerdict(classifyGitInvocation(toGitInvocation(invocation), gitFacts)));
	} else if (executable === "glab") {
		strongest = strongerOf(strongest, fromGitVerdict(classifyGlabInvocation(toGitInvocation(invocation))));
	}

	strongest = strongerOf(strongest, fromInfraVerdict(classifyInfraInvocation(invocation), requestKey));

	const pathFacts: PathPolicyFacts = {
		projectRoot: facts.projectRoot,
		home: facts.home,
		kubeconfigEnv: facts.kubeconfigEnv,
	};
	for (const arg of invocation.args) {
		const canonicalPath = canonicalisePathArg({ text: arg, value: arg }, { cwd: facts.cwd, home: facts.home });
		const pathVerdict = classifyPathRead(canonicalPath, pathFacts);
		if (pathVerdict.kind === "block") {
			strongest = strongerOf(strongest, { kind: "block", reason: pathVerdict.reason });
		}
	}

	return strongest;
}

// ---------------------------------------------------------------------------
// Per-tool evaluation
// ---------------------------------------------------------------------------

function evaluateBash(input: unknown, facts: PolicyFacts): Verdict {
	const commandField = extractStringField(input, "command");
	if (commandField.kind === "missing") {
		return { kind: "block", reason: `bash input is malformed: ${commandField.reason}` };
	}
	const command = commandField.value;

	const shellVerdict = canonicalise(command);
	if (shellVerdict.kind === "refused") {
		return {
			kind: "block",
			reason: `shell.ts refused "${command}" (cause: ${shellVerdict.cause}): ${shellVerdict.detail}`,
		};
	}

	const requestKey = computeRequestKey("bash", { command }, facts.cwd);

	let strongest: Verdict = { kind: "allow" };
	for (const invocation of shellVerdict.invocations) {
		strongest = strongerOf(strongest, evaluateInvocation(invocation, facts, requestKey));
	}
	return strongest;
}

function evaluateRead(input: unknown, facts: PolicyFacts): Verdict {
	const pathField = extractStringField(input, "path");
	if (pathField.kind === "missing") {
		return { kind: "block", reason: `read input is malformed: ${pathField.reason}` };
	}
	const canonicalPath = canonicalisePathArg(
		{ text: pathField.value, value: pathField.value },
		{ cwd: facts.cwd, home: facts.home },
	);
	const verdict = classifyPathRead(canonicalPath, {
		projectRoot: facts.projectRoot,
		home: facts.home,
		kubeconfigEnv: facts.kubeconfigEnv,
	});
	return verdict.kind === "block" ? { kind: "block", reason: verdict.reason } : { kind: "allow" };
}

/** Shared by `write` and `edit` -- both tools take the same `{ path }` shape and both are governed by `classifyPathWrite` (SAFE-08 containment, SAFE-13 detonation targets). */
function evaluateWrite(input: unknown, facts: PolicyFacts): Verdict {
	const pathField = extractStringField(input, "path");
	if (pathField.kind === "missing") {
		return { kind: "block", reason: `write/edit input is malformed: ${pathField.reason}` };
	}
	const canonicalPath = canonicalisePathArg(
		{ text: pathField.value, value: pathField.value },
		{ cwd: facts.cwd, home: facts.home },
	);
	const verdict = classifyPathWrite(canonicalPath, {
		projectRoot: facts.projectRoot,
		home: facts.home,
		kubeconfigEnv: facts.kubeconfigEnv,
	});
	return verdict.kind === "block" ? { kind: "block", reason: verdict.reason } : { kind: "allow" };
}

/**
 * CR-04: read an OPTIONAL path-shaped field ("path" on `grep`/`find`/`ls`,
 * "glob" on `grep`) -- all three default to the tool's own cwd/every file
 * when the field is omitted, so an ABSENT field is not malformed input the
 * way a missing "command"/"path" is for `bash`/`read`/`write`/`edit`.
 * `undefined` for anything but a non-empty string, so callers can skip
 * classification entirely rather than misread "search the whole project" as
 * a sensitive-read match.
 */
function extractOptionalStringField(input: Readonly<Record<string, unknown>>, field: string): string | undefined {
	const value = input[field];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * CR-04: classify one path-shaped field against the SAME sensitive-read table
 * SAFE-06 already uses for the `read` tool. `undefined` (field absent)
 * allows -- see {@link extractOptionalStringField}.
 */
function evaluatePathReadIfPresent(rawPath: string | undefined, facts: PolicyFacts): Verdict {
	if (rawPath === undefined) {
		return { kind: "allow" };
	}
	const canonicalPath = canonicalisePathArg(
		{ text: rawPath, value: rawPath },
		{ cwd: facts.cwd, home: facts.home },
	);
	const verdict = classifyPathRead(canonicalPath, {
		projectRoot: facts.projectRoot,
		home: facts.home,
		kubeconfigEnv: facts.kubeconfigEnv,
	});
	return verdict.kind === "block" ? { kind: "block", reason: verdict.reason } : { kind: "allow" };
}

/**
 * CR-04: `grep`'s own schema is `{ pattern, path?, glob?, ignoreCase?,
 * literal?, context?, limit? }` and it returns matching LINES OF FILE
 * CONTENT -- `grep { pattern: ".", path: "~/.aws/credentials" }` (or
 * `grep { pattern: "=", glob: ".env" }`) previously reached execution with no
 * verdict and no audit row at all, reachable with no shell involved. Both
 * `path` and `glob` are checked against the same sensitive-read table; `glob`
 * is not a real filesystem path, but resolving it exactly like one and
 * checking its basename is enough to catch this finding's own worked
 * examples. `pattern` itself is never inspected -- SAFE-06's contract is
 * about WHICH FILE is read, not what text is searched for.
 */
function evaluateGrep(input: unknown, facts: PolicyFacts): Verdict {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return {
			kind: "block",
			reason: `grep input is malformed: input is not an object (received ${describeShape(input)})`,
		};
	}
	const record = input as Record<string, unknown>;
	const pathVerdict = evaluatePathReadIfPresent(extractOptionalStringField(record, "path"), facts);
	if (pathVerdict.kind === "block") {
		return pathVerdict;
	}
	const globVerdict = evaluatePathReadIfPresent(extractOptionalStringField(record, "glob"), facts);
	if (globVerdict.kind === "block") {
		return { kind: "block", reason: `grep glob refers to a sensitive file: ${globVerdict.reason}` };
	}
	return { kind: "allow" };
}

/**
 * CR-04: `find`/`ls` both carry an optional `path`; both leak file/directory
 * NAMES rather than CONTENTS, but a name under a sensitive directory (e.g.
 * every filename inside `~/.aws`) is still worth denying rather than
 * silently allowing -- defense in depth, cheap to apply since the same table
 * already exists.
 */
function evaluateFindOrLs(input: unknown, facts: PolicyFacts): Verdict {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return {
			kind: "block",
			reason: `find/ls input is malformed: input is not an object (received ${describeShape(input)})`,
		};
	}
	return evaluatePathReadIfPresent(extractOptionalStringField(input as Record<string, unknown>, "path"), facts);
}

// ---------------------------------------------------------------------------
// The public entry point
// ---------------------------------------------------------------------------

/**
 * The whole SAFE-03/SAFE-10 decision for one tool call. See the module
 * docstring for the deny-by-default shape, the `bash` evaluation order, and
 * why an unrecognised TOOL NAME (as opposed to an unrecognised INPUT SHAPE)
 * is the one case this function allows.
 */
export function evaluate(toolName: string, input: unknown, facts: PolicyFacts): Verdict {
	try {
		switch (toolName) {
			case "bash":
				return evaluateBash(input, facts);
			case "read":
				return evaluateRead(input, facts);
			case "write":
			case "edit":
				return evaluateWrite(input, facts);
			case "grep":
				return evaluateGrep(input, facts);
			case "find":
			case "ls":
				return evaluateFindOrLs(input, facts);
			default:
				// This guard governs exactly bash/read/write/edit/grep/find/ls --
				// every one of Pi's built-in tools. SAFE-15's published limits
				// table names every OTHER tool (an extension-registered one that
				// shells out internally) as a real gap, never silently claimed as
				// covered. See module docstring.
				return { kind: "allow" };
		}
	} catch (err) {
		// A classifier throwing is caught and converted to a block -- never left
		// to propagate as an exception a caller might treat as "nothing to
		// block". See module docstring, deny-by-default point 1. [T-04-03]
		return {
			kind: "block",
			reason: `policy evaluation threw for tool "${toolName}": ${
				err instanceof Error ? err.message : String(err)
			} -- deny by construction, never allow on an exception`,
		};
	}
}
