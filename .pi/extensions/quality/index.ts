/**
 * Quality extension entry point: wires gates.ts, rules.ts and advisor.ts to a real cwd, subprocess runner
 * and the live tool list, and registers `consult_advisor`. Rationale and the registration budget: docs/QUALITY.md.
 * Authored in this repo, not vendored; the "vendored" kind in the tool-count registry means in-repo source only.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as ts from "typescript";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	CONSULT_ADVISOR_DESCRIPTION,
	CONSULT_ADVISOR_TOOL_NAME,
	consultAdvisorParameters,
	executeConsultAdvisor,
} from "./advisor.ts";
import { type ExecRunner, type LegStatus, outputLines, probeLspAvailability, runTypecheckLeg } from "./gates.ts";
import { type QualityFinding, runAntiPatternRules } from "./rules.ts";
import { commandFor } from "../../lib/win-quote.ts";

const REGISTERED_TOOL_NAMES_KEY = "__kypiQualityRegisteredToolNames";

/** Live tool names via the factory-set closure on `globalThis`; empty before the factory has run. */
export function registeredToolNames(): readonly string[] {
	const fn = (globalThis as Record<string, unknown>)[REGISTERED_TOOL_NAMES_KEY];
	return typeof fn === "function" ? (fn as () => readonly string[])() : [];
}

/**
 * The local binary, resolved per platform and never `npx` (unpinned download; `npx.cmd` is unspawnable on Windows).
 * Walks up from a subdirectory `cwd`, but never past the git top level: a binary above the trusted project is not its own.
 */
function localBin(cwd: string, name: string): string | undefined {
	const bin = join("node_modules", ".bin", `${name}${process.platform === "win32" ? ".cmd" : ""}`);
	const dir = findUp(cwd, (d) => existsSync(join(d, bin)));
	return dir === undefined ? undefined : join(dir, bin);
}

/**
 * A `cmd.exe` "command not found" message, which must read as `unavailable`, not as a compiler `fail`.
 * Not exhaustive (`%VAR%` in a path yields other messages), hence the `%` guard in {@link productionExec}.
 */
const CMD_EXE_SPAWN_FAILURE = /is not recognized as an internal or external command/i;

/**
 * Production `ExecRunner`: the pinned local binary (or an ancestor's) via {@link commandFor}, never `npx`.
 * Exported for tests/unit/quality-production-exec.test.ts.
 */
export const productionExec: ExecRunner = (cmd, args, cwd) => {
	const bin = localBin(cwd, cmd);
	if (bin === undefined) {
		// Unavailable, naming the missing binary: never a network fetch, never a silent pass.
		throw new Error(`${cmd} is not installed under ${cwd}/node_modules/.bin or any ancestor's up to the git top level -- the leg is unavailable, not skipped or passed`);
	}
	// `cmd.exe` expands `%VAR%` inside double quotes before quote processing, which `commandFor` cannot suppress.
	// The check covers `bin` and `args`, the whole command line. Win32 only.
	const pctBearing = [bin, ...args].filter((a) => a.includes("%"));
	if (process.platform === "win32" && pctBearing.length > 0) {
		throw new Error(
			`${cmd} command line contains '%' in ${pctBearing.join(", ")} -- cmd.exe expands %VAR% inside quotes, ` +
				"so this command line cannot be built safely; the leg is unavailable, not failed",
		);
	}
	// A test-file target absent from this cwd would make the runner report a false FAIL, so degrade to unavailable.
	const missingTargets = args.filter((a) => a.endsWith(".test.ts") && !existsSync(resolve(cwd, a)));
	if (missingTargets.length > 0) {
		throw new Error(
			`${cmd} target file(s) not found under ${cwd}: ${missingTargets.join(", ")} -- a leg naming test files only applies where they exist`,
		);
	}
	// `commandFor` quotes every argument on Windows (cwd may hold spaces or `&`); POSIX passes the array through.
	const isWindows = process.platform === "win32";
	const [file, spawnArgs] = commandFor(bin, [...args], isWindows);
	const result = spawnSync(file, spawnArgs, {
		cwd,
		// A Windows `.cmd` shim needs a shell; a real executable does not.
		shell: isWindows,
		windowsHide: true,
		encoding: "utf-8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0 && CMD_EXE_SPAWN_FAILURE.test(result.stderr ?? "")) {
		// A cmd.exe resolution failure is not a compiler verdict; report unavailable.
		throw new Error(`${cmd} could not be spawned from ${bin} -- cmd.exe reported: ${(result.stderr ?? "").trim()}`);
	}
	return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

const EXEC_OVERRIDE_KEY = "__kypiQualityExecOverride";

/** FOR TESTS ONLY. Pass `undefined` to restore the production runner. */
export function setQuickGateExecOverrideForTests(exec: ExecRunner | undefined): void {
	(globalThis as Record<string, unknown>)[EXEC_OVERRIDE_KEY] = exec;
}

/**
 * The `ExecRunner` the change gate uses. A test override always wins (a stub never spawns); otherwise an untrusted
 * `cwd` is refused before any spawn, which the legs turn into `unavailable`.
 */
function resolveExec(cwd: string, projectTrusted: boolean): ExecRunner {
	const override = (globalThis as Record<string, unknown>)[EXEC_OVERRIDE_KEY];
	if (typeof override === "function") {
		return override as ExecRunner;
	}
	if (!projectTrusted) {
		return () => {
			throw new Error(
				`the project at ${cwd} is not trusted -- the typecheck and lint legs will not execute a binary from this cwd until it is`,
			);
		};
	}
	return productionExec;
}

/** The git top level of `cwd`, or `cwd` outside a repository. `git diff` paths are relative to it, not to `cwd`. */
export function repoTop(cwd: string): string {
	const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	return resolve(top.status === 0 ? top.stdout.trim() : cwd);
}

/** The nearest directory from `cwd` up to the git top level for which `holds` is true; never above the project. */
function findUp(cwd: string, holds: (dir: string) => boolean): string | undefined {
	const norm = (p: string): string => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
	const stop = norm(repoTop(cwd));
	let dir = resolve(cwd);
	for (;;) {
		if (holds(dir)) return dir;
		const parent = dirname(dir);
		if (norm(dir) === stop || parent === dir) return undefined;
		dir = parent;
	}
}

/**
 * A reason when a solution-style tsconfig (only `references`, or an explicit empty `files`) gives `tsc --noEmit` no file
 * to check, so its exit 0 would be a vacuous pass. Other configs with no input are left to tsc, which fails them itself.
 */
function tsconfigChecksNothing(file: string): string | undefined {
	const read = ts.readConfigFile(file, ts.sys.readFile);
	if (read.error !== undefined) return undefined;
	const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(file));
	const refs = parsed.projectReferences?.length ?? 0;
	const emptyFiles = Array.isArray((read.config as { files?: unknown }).files) && (read.config as { files: unknown[] }).files.length === 0;
	if (parsed.fileNames.length > 0 || (refs === 0 && !emptyFiles)) return undefined;
	return `${file} gives tsc no file to check (a solution-style config with ${refs} project reference(s)), so tsc --noEmit would pass having checked nothing`;
}

/** `tsc --noEmit` at `cwd`, alone; unavailable when no tsconfig.json exists from `cwd` up to the git top level, or it checks nothing. */
export function runTypecheckAt(cwd: string, projectTrusted: boolean): LegStatus {
	const dir = findUp(cwd, (d) => existsSync(join(d, "tsconfig.json")));
	if (dir === undefined) {
		return { status: "unavailable", reason: `no tsconfig.json at or above ${cwd} (up to the git top level), so tsc has no project to check` };
	}
	const vacuous = tsconfigChecksNothing(join(dir, "tsconfig.json"));
	if (vacuous !== undefined) return { status: "unavailable", reason: vacuous };
	return runTypecheckLeg(cwd, resolveExec(cwd, projectTrusted));
}

const ESLINT_CONFIGS = [
	"eslint.config.js",
	"eslint.config.mjs",
	"eslint.config.cjs",
	"eslint.config.ts",
	"eslint.config.mts",
	"eslint.config.cts",
	".eslintrc",
	".eslintrc.js",
	".eslintrc.cjs",
	".eslintrc.json",
	".eslintrc.yml",
	".eslintrc.yaml",
];

const LINT_OUTPUT_MAX_LINES = 40;

function hasEslintConfig(dir: string): boolean {
	if (ESLINT_CONFIGS.some((name) => existsSync(join(dir, name)))) return true;
	try {
		return "eslintConfig" in (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as object);
	} catch {
		return false;
	}
}

interface EslintResult {
	readonly filePath: string;
	readonly messages: readonly { readonly ruleId?: string | null; readonly severity?: number; readonly fatal?: boolean; readonly message?: string; readonly line?: number }[];
}

/** ESLint's own per-file report; undefined when stdout is not one. */
function parseEslintJson(stdout: string): readonly EslintResult[] | undefined {
	try {
		const parsed: unknown = JSON.parse(stdout);
		return Array.isArray(parsed) && parsed.every((r) => typeof r?.filePath === "string" && Array.isArray(r?.messages)) ? (parsed as EslintResult[]) : undefined;
	} catch {
		return undefined;
	}
}

// ESLint reports an ignored or unconfigured file as a warning ("File ignored because ...") and exits 0.
const IGNORED_FILE = /^File ignored\b/;

/**
 * Runs the target repo's own ESLint on the changed code files (paths relative to `top`), from the nearest directory between
 * `cwd` and `top` that holds a config; unavailable unless the repo configures it and is trusted.
 */
function runLintAt(cwd: string, top: string, projectTrusted: boolean, files: readonly string[]): LegStatus {
	if (files.length === 0) return { status: "unavailable", reason: "no changed TypeScript/JavaScript file for eslint to check" };
	const configDir = findUp(cwd, hasEslintConfig);
	if (configDir === undefined) {
		return { status: "unavailable", reason: `no ESLint config at or above ${cwd} (up to the git top level), so there is no lint rule set to apply` };
	}
	let result: { code: number; stdout: string; stderr: string };
	try {
		result = resolveExec(configDir, projectTrusted)("eslint", ["--format", "json", "--", ...files.map((f) => relative(configDir, join(top, f)))], configDir);
	} catch (err) {
		return { status: "unavailable", reason: `eslint could not be run: ${err instanceof Error ? err.message : String(err)}` };
	}
	const bound = (lines: readonly string[]) => (lines.length > LINT_OUTPUT_MAX_LINES ? [...lines.slice(0, LINT_OUTPUT_MAX_LINES), `... ${lines.length - LINT_OUTPUT_MAX_LINES} more line(s)`] : [...lines]);
	const raw = bound(outputLines(result));
	if (result.code !== 0 && result.code !== 1) return { status: "unavailable", reason: `eslint exited ${result.code} without a lint verdict: ${raw.slice(0, 3).join(" | ")}` };
	const report = parseEslintJson(result.stdout);
	// Exit 1 is ESLint's own "errors found", so an unreadable report still fails; exit 0 without one proves nothing was linted.
	if (report === undefined) return result.code === 1 ? { status: "fail", findings: raw } : { status: "unavailable", reason: "eslint printed no JSON report, so whether it linted any file is unknown" };
	const linted = report.filter((r) => !r.messages.some((m) => (m.ruleId ?? null) === null && IGNORED_FILE.test(m.message ?? "")));
	const errors = linted.flatMap((r) => r.messages.filter((m) => m.severity === 2 || m.fatal === true).map((m) => `${relative(top, r.filePath)}:${m.line ?? 0} ${m.ruleId ?? "fatal"}: ${m.message ?? ""}`));
	if (errors.length > 0 || result.code === 1) return { status: "fail", findings: errors.length > 0 ? bound(errors) : raw };
	if (linted.length === 0) {
		const why = report.flatMap((r) => r.messages.map((m) => m.message ?? "")).find((m) => IGNORED_FILE.test(m)) ?? "no result";
		return { status: "unavailable", reason: `eslint linted none of the changed files (${why})` };
	}
	return { status: "pass" };
}

const CODE_FILE = /\.[cm]?[tj]sx?$/;

export interface ChangeGateResult {
	readonly typecheck: LegStatus;
	readonly lint: LegStatus;
	readonly lsp: LegStatus;
	readonly antiPattern: LegStatus;
	/** True when any leg failed. */
	readonly failed: boolean;
	/** False when every leg was unavailable, so nothing deterministic checked the change. */
	readonly ranAny: boolean;
	/** One entry per leg, in gate order. */
	readonly report: string;
}

const GIT_SHOW_MAX_BUFFER = 16_777_216;

function showAt(cwd: string, sha: string, path: string): string | undefined {
	const r = spawnSync("git", ["show", `${sha}:${path}`], { cwd, encoding: "utf-8", shell: false, windowsHide: true, maxBuffer: GIT_SHOW_MAX_BUFFER });
	return r.status === 0 ? r.stdout : undefined;
}

const findingKey = (f: QualityFinding): string => `${f.path}\0${f.ruleId}\0${f.message}`;

/**
 * The deterministic stage for a work repo's change between `baseSha` and the tree on disk: anti-pattern rules on
 * the changed code files, counting only findings `baseSha` did not already have, the repo's own ESLint on those files,
 * and `tsc --noEmit` only when a code file changed, a tsconfig exists and the base did not already fail it (a failure
 * there cannot be attributed to the change). The LSP leg is always unavailable.
 */
export function runChangeGateStage(input: {
	readonly cwd: string;
	readonly projectTrusted: boolean;
	readonly baseSha: string;
	readonly changed: readonly string[];
	readonly baseTypecheckFailed: boolean;
}): ChangeGateResult {
	const top = repoTop(input.cwd);
	const code = input.changed.filter((p) => CODE_FILE.test(p) && existsSync(join(top, p)));
	let antiPattern: LegStatus = { status: "unavailable", reason: "no changed TypeScript/JavaScript file to scan" };
	if (code.length > 0) {
		const before = new Map<string, number>();
		const baseSources = code.flatMap((path) => {
			const text = showAt(input.cwd, input.baseSha, path);
			return text === undefined ? [] : [{ path, text }];
		});
		for (const f of runAntiPatternRules(baseSources)) before.set(findingKey(f), (before.get(findingKey(f)) ?? 0) + 1);
		const added = runAntiPatternRules(code.map((path) => ({ path, text: readFileSync(join(top, path), "utf-8") }))).filter((f) => {
			const left = before.get(findingKey(f)) ?? 0;
			before.set(findingKey(f), left - 1);
			return left <= 0 && f.tier === "error";
		});
		antiPattern = added.length === 0 ? { status: "pass" } : { status: "fail", findings: added.map((f) => `${f.path}:${f.line} ${f.ruleId}: ${f.message}`) };
	}
	const typecheck: LegStatus = !input.changed.some((p) => CODE_FILE.test(p))
		? { status: "unavailable", reason: "no changed TypeScript/JavaScript file for tsc to check" }
		: input.baseTypecheckFailed
			? { status: "unavailable", reason: "tsc already failed on the base tree, so a failure cannot be attributed to this change" }
			: runTypecheckAt(input.cwd, input.projectTrusted);
	const lint = runLintAt(input.cwd, top, input.projectTrusted, code);
	const lsp = probeLspAvailability(registeredToolNames());
	const legs = [["typecheck", typecheck], ["lint", lint], ["lsp", lsp], ["anti-pattern", antiPattern]] as const;
	const report = legs
		.map(([id, leg]) => leg.status === "fail" ? `${id}: FAIL\n${leg.findings.map((f) => `  - ${f}`).join("\n")}` : `${id}: ${leg.status === "pass" ? "PASS" : `UNAVAILABLE (${leg.reason})`}`)
		.join("\n");
	return { typecheck, lint, lsp, antiPattern, failed: legs.some(([, l]) => l.status === "fail"), ranAny: legs.some(([, l]) => l.status !== "unavailable"), report };
}

export default function (pi: ExtensionAPI): void {
	// Registered first so a name collision resolves in this file's favour (first-registration-wins; see safety/index.ts default export).
	// `name` stays a literal because tool-count-baseline.test.ts scans source text for it; this check stops drift.
	if (CONSULT_ADVISOR_TOOL_NAME !== "consult_advisor") {
		throw new Error(
			`quality/index.ts: CONSULT_ADVISOR_TOOL_NAME is ${JSON.stringify(CONSULT_ADVISOR_TOOL_NAME)}, not ` +
				'"consult_advisor" -- update the literal below to match',
		);
	}
	pi.registerTool({
		name: "consult_advisor",
		label: "consult advisor",
		description: CONSULT_ADVISOR_DESCRIPTION,
		parameters: consultAdvisorParameters,
		// No terminate field: a consult continues the turn.
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const text = await executeConsultAdvisor(ctx, params);
			return { content: [{ type: "text", text }], details: undefined };
		},
	});

	(globalThis as Record<string, unknown>)[REGISTERED_TOOL_NAMES_KEY] = () => pi.getAllTools().map((t) => t.name);
}
