/**
 * Quality extension entry point: wires gates.ts, rules.ts and advisor.ts to a real cwd, subprocess runner
 * and the live tool list, and registers `consult_advisor`. Rationale and the registration budget: docs/QUALITY.md.
 * Authored in this repo, not vendored; the "vendored" kind in the tool-count registry means in-repo source only.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	CONSULT_ADVISOR_DESCRIPTION,
	CONSULT_ADVISOR_TOOL_NAME,
	consultAdvisorParameters,
	executeConsultAdvisor,
} from "./advisor.ts";
import { type ExecRunner, type GateResult, runDeterministicGates } from "./gates.ts";
import type { QualitySource } from "./rules.ts";
import { commandFor } from "../../lib/win-quote.ts";

const REGISTERED_TOOL_NAMES_KEY = "__kypiQualityRegisteredToolNames";

/** Live tool names via the factory-set closure on `globalThis`; empty before the factory has run. */
export function registeredToolNames(): readonly string[] {
	const fn = (globalThis as Record<string, unknown>)[REGISTERED_TOOL_NAMES_KEY];
	return typeof fn === "function" ? (fn as () => readonly string[])() : [];
}

/** Every `.ts` file under `<cwd>/.pi/extensions/`, read off disk so uncommitted work is checked. */
function collectQualitySources(cwd: string): QualitySource[] {
	const root = join(cwd, ".pi", "extensions");
	const sources: QualitySource[] = [];
	const walk = (dir: string): void => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".ts")) {
				sources.push({ path: relative(cwd, full).replace(/\\/g, "/"), text: readFileSync(full, "utf-8") });
			}
		}
	};
	walk(root);
	return sources;
}

/**
 * The local binary, resolved per platform and never `npx` (unpinned download; `npx.cmd` is unspawnable on Windows).
 * Walks up through ancestors because `cwd` is often a subdirectory; `undefined` once the root is reached.
 */
function localBin(cwd: string, name: string): string | undefined {
	const suffix = process.platform === "win32" ? ".cmd" : "";
	let dir = resolve(cwd);
	for (;;) {
		const candidate = join(dir, "node_modules", ".bin", `${name}${suffix}`);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined; // reached the filesystem root
		dir = parent;
	}
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
		throw new Error(`${cmd} is not installed under ${cwd}/node_modules/.bin or any ancestor's -- the leg is unavailable, not skipped or passed`);
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
	// LINT_GATE_FILES names this repo's own tests; elsewhere vitest would report a false FAIL, so degrade to unavailable.
	const missingTargets = args.filter((a) => a.endsWith(".test.ts") && !existsSync(join(cwd, a)));
	if (missingTargets.length > 0) {
		throw new Error(
			`${cmd} target file(s) not found under ${cwd}: ${missingTargets.join(", ")} -- this leg only runs ky-pi-agent's own structural lint suite`,
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
 * The `ExecRunner` `/quick` uses. A test override always wins (a stub never spawns); otherwise an untrusted
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
				`the project at ${cwd} is not trusted -- the typecheck/lint legs will not execute a binary from this cwd until it is`,
			);
		};
	}
	return productionExec;
}

/** Runs the deterministic gate stage for real; `projectTrusted` comes from `ctx.isProjectTrusted()`. */
export function runQuickGateStage(cwd: string, projectTrusted: boolean): GateResult {
	return runDeterministicGates({
		sources: collectQualitySources(cwd),
		registeredToolNames: registeredToolNames(),
		cwd,
		exec: resolveExec(cwd, projectTrusted),
	});
}

export default function (pi: ExtensionAPI): void {
	// Registered first so a name collision resolves in this file's favour (safety/index.ts:32-46).
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
