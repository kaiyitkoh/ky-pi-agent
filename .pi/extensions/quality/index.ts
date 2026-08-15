/**
 * ky-pi-agent — the quality subsystem's extension entry point (GATE-01,
 * GATE-09, QUAL-05).
 *
 * PURPOSE. This file composes waves 1-3's pure/impure pieces into what the
 * running harness actually does: {@link runQuickGateStage} is the ONE thing
 * `.pi/extensions/workflows/index.ts` calls to run `gates.ts`'s deterministic
 * stage for real, so `/quick` never inlines rule or leg logic and stays
 * inside its own line budget (`docs/WORKFLOWS.md`, `tests/unit/
 * workflow-budgets.test.ts`). It reimplements nothing from `gates.ts`,
 * `rules.ts` or `advisor.ts` — it wires their existing exports to a real
 * `cwd`, a real subprocess runner and the live registered-tool-name list.
 * Wiring `verdict.ts`'s stop signal into a live ceremonial workflow is
 * explicitly Phase 9's job (QUAL-08); this plan's own must_haves state that
 * boundary and this file does not cross it.
 *
 * ---------------------------------------------------------------------------
 * THE LSP PROBE IS FED FROM A CLOSURE CAPTURED IN THE FACTORY, NEVER A
 * LOAD-TIME SNAPSHOT
 * ---------------------------------------------------------------------------
 * `pi.getAllTools()` exists only on `ExtensionAPI`
 * [`dist/core/extensions/types.d.ts:948`], never on `ExtensionContext` —
 * `gates.ts`'s own module docstring already states its `ctx` equivalent has
 * no such accessor. So this file captures the closure `() =>
 * pi.getAllTools().map((t) => t.name)` where `pi` is in scope (the factory
 * below), NOT a snapshot array taken at load time — tools may register after
 * startup (registration works from `session_start`, command handlers
 * and event handlers too, not only a factory), and a snapshot taken during the factory would report
 * the LSP absent forever even on a machine where it later loads.
 *
 * The closure itself — not merely data derived from it — is stored under a
 * `globalThis` key, mirroring `diagnostics/quality-cost.ts`'s and
 * `routing/modes.ts`'s own STATE-SLOT HAZARD discipline: Pi loads each
 * top-level extension entry point through its own jiti module graph, so
 * `workflows/index.ts` importing `registeredToolNames` from this file gets a
 * SEPARATE module instance than the one whose factory Pi actually invoked —
 * a plain module-level `let` here would leave the importer's own copy at its
 * initial, empty value forever. Storing the closure itself on `globalThis`
 * survives that split intact: the SAME function object — the one that
 * genuinely closes over the real `pi` — is what every copy of this module
 * reads back, in this or any other process-wide graph.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE REGISTERS A TOOL ON PURPOSE (BOOT-10)
 * ---------------------------------------------------------------------------
 * `pi.registerTool` is called exactly once below, for `consult_advisor`. This
 * is the fifth `TOOL_REGISTRATION_ALLOWLIST` entry
 * (`tests/unit/contributing-boundary.test.ts`) and the fifth
 * `TOOL_COUNT_BASELINE` row (`tests/unit/tool-count-baseline.test.ts`), both
 * landing in this same commit — `advisor.ts`'s own docstring states plainly
 * that it builds the mechanism but defers registration here.
 *
 * (a) The model must call `consult_advisor` MID-TURN — the consult happens at
 *     a decision point INSIDE the executor's own turn, and the advisor's
 *     answer must return into that SAME turn. A command cannot do this:
 *     `system-prompt.ts` carries no reference to registered commands, so a
 *     command runs BETWEEN turns and has no path back into the model's own
 *     reasoning while it is still working.
 * (b) MEASURED, not estimated: 584 bytes / 146 tokens, computed exactly as
 *     `08-08-SUMMARY.md` records — `Buffer.byteLength(JSON.stringify({type:
 *     "function",function:{name,description,parameters}}),"utf8")`,
 *     `Math.ceil(bytes/4)` per `diagnostics/budget.ts:223-224`, run against
 *     the real `consultAdvisorParameters`/`CONSULT_ADVISOR_DESCRIPTION` via a
 *     `node --input-type=module -e` one-liner from this repo's root. The new
 *     LIVE TOTAL this commit produces: 5 tools, 1015 + 146 = 1161 tokens —
 *     Phase 7's own 1015-token, 4-tool figure (`tests/unit/
 *     contributing-boundary.test.ts`'s own honesty paragraph) plus this
 *     tool's 146. Phase 10, not this plan, owns deciding whether that is
 *     acceptable and cutting it.
 * (c) A skill cannot carry this: a skill is text the model reads and
 *     interprets, with no mechanism to make a nested, routed, guarded model
 *     call whose result returns as structured tool output the executor can
 *     branch on inside the SAME turn.
 *
 * `promptMetadata: false` in the `TOOL_COUNT_BASELINE` row: the registration
 * below carries neither of `ToolDefinition`'s two optional per-tool
 * prompt-metadata fields — the one-line "available tools" snippet field and
 * the active-only guideline-bullets field — deliberately never spelled here
 * by name; a directory-wide grep for both field names across this whole
 * subsystem is 0, recorded in that row's own `why`. Activating a tool that
 * carries either REBUILDS THE SYSTEM PROMPT and invalidates the provider
 * cache prefix.
 *
 * No `terminate` field is set on the registration below — `advisor.ts`'s own
 * docstring states why: a consult is mid-turn continuation, never a final
 * answer.
 *
 * A NOTE, NOT AN UPSTREAM COPY — for `tests/unit/tool-count-baseline.test.ts`'s
 * own registry, which discovers a "vendored"-kind row's source by scanning for
 * a case-insensitive "vendored" marker in the file itself. This file is
 * authored in this repository, never copied in from anywhere else — its own
 * `TOOL_COUNT_BASELINE` row's `why` states plainly that `kind: "vendored"`
 * here means only "in-repo source, grep-enforced against tracked source",
 * because that registry's `kind` union has no better member for authored
 * code, not that this directory holds a real upstream vendored copy of
 * something.
 *
 * ---------------------------------------------------------------------------
 * REGISTRATION-ORDER DISCIPLINE (safety/index.ts:32-46's precedent)
 * ---------------------------------------------------------------------------
 * The tool is registered first, in the factory, before anything else this
 * file does — mirroring `safety/index.ts`'s own stated rule that tool
 * registrations sit ahead of hooks so a name collision with a
 * later-registered extension resolves first-registration-wins in this file's
 * favour, not silently against it.
 *
 * ---------------------------------------------------------------------------
 * A TEST-ONLY SEAM, NAMED AS SUCH
 * ---------------------------------------------------------------------------
 * `runQuickGateStage`'s default typecheck/lint legs shell a REAL subprocess
 * (`tsc --noEmit`, `vitest run ...`, resolved locally -- see
 * {@link productionExec}'s own docstring) against `cwd` — correct for
 * production, catastrophic for a session-level test driven against a
 * throwaway `makeTempRepo()` fixture with no `node_modules` at all: a real
 * spawn there would fail (or, before CR-01/CR-02, would have reached `npx`
 * and attempted to fetch a package), which is exactly the "install nothing"
 * rule this phase's own autonomous-run constraints forbid.
 * {@link setQuickGateExecOverrideForTests} is the escape hatch, following
 * `diagnostics/quality-cost.ts#peekQualityCost`'s own "FOR TESTS ONLY" naming
 * convention and the same `globalThis` mechanism this file already uses for
 * {@link registeredToolNames} — production code never calls it.
 *
 * ---------------------------------------------------------------------------
 * CR-01 / CR-02: THE PRODUCTION RUNNER NEVER NAMES `npx`
 * ---------------------------------------------------------------------------
 * `npx` is `npx.cmd` on Windows, and Node refuses to spawn a `.cmd` without a
 * shell (verified on this machine: `spawnSync("npx", [...], {shell:false})`
 * throws ENOENT) -- so both legs degraded to `unavailable` on this project's
 * declared primary platform, and `blocking` never sets on an `unavailable`
 * leg by design (`gates.ts`'s own three-state contract), which made the
 * degradation invisible. On a platform where `npx` DOES spawn, `npx tsc`/
 * `npx vitest` with nothing installed locally silently DOWNLOADS AND
 * EXECUTES an unpinned package from the registry -- a direct violation of
 * this project's supply-chain posture. {@link productionExec} instead
 * resolves the LOCAL, already-pinned binary under
 * `<cwd>/node_modules/.bin/<name>` via {@link localBin} and never reaches the
 * network: a missing binary is an honest `unavailable`, naming the path that
 * was not found, never a network fetch and never a silent pass.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
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

// ---------------------------------------------------------------------------
// The registered-tool-name closure -- see this file's own docstring.
// ---------------------------------------------------------------------------

const REGISTERED_TOOL_NAMES_KEY = "__kypiQualityRegisteredToolNames";

/** The live registered-tool-name list, read through whichever module instance's copy of the factory-set closure `globalThis` is holding. Empty before the factory has ever run. */
export function registeredToolNames(): readonly string[] {
	const fn = (globalThis as Record<string, unknown>)[REGISTERED_TOOL_NAMES_KEY];
	return typeof fn === "function" ? (fn as () => readonly string[])() : [];
}

// ---------------------------------------------------------------------------
// runQuickGateStage -- the ONE call /quick makes. Everything impure (file
// walking, subprocess shelling) lives here so workflows/index.ts stays a
// budget-honouring caller, never a re-implementer.
// ---------------------------------------------------------------------------

/** Every `.ts` file under `<cwd>/.pi/extensions/`, read fresh off disk -- the real working tree, not the git index, so uncommitted work is checked too. */
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
 * The locally-installed binary, resolved per platform — never the `npx`
 * shim. See this file's own "CR-01 / CR-02" docstring section for why.
 */
function localBin(cwd: string, name: string): string {
	const suffix = process.platform === "win32" ? ".cmd" : "";
	return join(cwd, "node_modules", ".bin", `${name}${suffix}`);
}

/**
 * Production `ExecRunner` — resolves the pinned LOCAL binary under
 * `<cwd>/node_modules/.bin`, never `npx`. See this file's own "CR-01 /
 * CR-02" docstring section for the two failure modes this closes. Exported
 * (not `FOR TESTS ONLY` -- this IS the production implementation) so
 * `tests/unit/quality-production-exec.test.ts` can exercise it directly,
 * including the real spawn CR-01 requires proof of.
 */
export const productionExec: ExecRunner = (cmd, args, cwd) => {
	const bin = localBin(cwd, cmd);
	if (!existsSync(bin)) {
		// Honest UNAVAILABLE, naming the missing binary -- never falls through
		// to a network-fetching npx, and never silently reports pass.
		throw new Error(`${cmd} is not installed under ${cwd}/node_modules/.bin -- the leg is unavailable, not skipped or passed`);
	}
	// CR-02's secondary correctness bug: LINT_GATE_FILES (gates.ts) is THIS
	// repository's own structural test paths. In any other cwd those paths do
	// not exist, and vitest would report a false FAIL against files it never
	// found rather than an honest "this leg does not apply here". Any `.test.ts`
	// argument that does not exist under `cwd` degrades the leg to unavailable,
	// naming the missing path(s), before a subprocess is even spawned.
	const missingTargets = args.filter((a) => a.endsWith(".test.ts") && !existsSync(join(cwd, a)));
	if (missingTargets.length > 0) {
		throw new Error(
			`${cmd} target file(s) not found under ${cwd}: ${missingTargets.join(", ")} -- this leg only runs ky-pi-agent's own structural lint suite`,
		);
	}
	const result = spawnSync(bin, args, {
		cwd,
		// A Windows `.cmd` shim cannot be launched without a shell (Node
		// refuses to spawn one with shell:false); a real executable
		// (macOS/Linux, or a non-.cmd Windows binary) can be launched
		// directly. Branch explicitly on platform rather than relying on
		// ENOENT, per CR-01.
		shell: process.platform === "win32",
		windowsHide: true,
		encoding: "utf-8",
	});
	if (result.error) throw result.error;
	return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

const EXEC_OVERRIDE_KEY = "__kypiQualityExecOverride";

/** FOR TESTS ONLY. See this file's own "A TEST-ONLY SEAM" section. Pass `undefined` to restore the production runner. */
export function setQuickGateExecOverrideForTests(exec: ExecRunner | undefined): void {
	(globalThis as Record<string, unknown>)[EXEC_OVERRIDE_KEY] = exec;
}

function resolveExec(): ExecRunner {
	const override = (globalThis as Record<string, unknown>)[EXEC_OVERRIDE_KEY];
	return typeof override === "function" ? (override as ExecRunner) : productionExec;
}

/**
 * Run GATE-01's deterministic gate stage for real: real sources off `cwd`,
 * the live registered-tool-name list, and a real (or test-overridden) exec
 * runner. This is the whole surface `/quick` calls -- see the module
 * docstring's PURPOSE section.
 */
export function runQuickGateStage(cwd: string): GateResult {
	return runDeterministicGates({
		sources: collectQualitySources(cwd),
		registeredToolNames: registeredToolNames(),
		cwd,
		exec: resolveExec(),
	});
}

export default function (pi: ExtensionAPI): void {
	// Registration first -- see REGISTRATION-ORDER DISCIPLINE above.
	//
	// `name` is the LITERAL "consult_advisor", not CONSULT_ADVISOR_TOOL_NAME --
	// tests/unit/tool-count-baseline.test.ts's own extractRegisteredToolNames
	// scans raw source text for a quoted `name: "..."` literal, exactly the
	// same convention todo.ts/questionnaire.ts/qoder/index.ts already use for
	// their own registerTool calls. The assertion two lines below is what
	// keeps this literal and advisor.ts's own constant from silently drifting
	// apart -- it throws at extension-load time, not merely at test time, if
	// they ever disagree.
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
		// No terminate field -- see this file's own docstring and advisor.ts's
		// WHY NO terminate FIELD section.
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const text = await executeConsultAdvisor(ctx, params);
			return { content: [{ type: "text", text }], details: undefined };
		},
	});

	(globalThis as Record<string, unknown>)[REGISTERED_TOOL_NAMES_KEY] = () => pi.getAllTools().map((t) => t.name);
}
