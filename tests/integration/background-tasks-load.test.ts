/**
 * 08.1-05 (UPG-04) -- the vendored, process-only pi-background-tasks loads on Pi 1.1.0
 * and is governed by the safety guard.
 *
 * Case A  load + surface: no load error, exactly bg_run/bg_status/bg_logs/bg_kill, nothing from the
 *         dropped features -- also with PI_BG_FEATURES set to every upstream token (removed code
 *         cannot be re-enabled).
 * Case D  input surface, fail closed: over the LIVE registration, no non-bg_run tool has an
 *         input-bearing parameter unless it is listed in GUARDED_TOOLS, and every registered name
 *         was seen by the 08.1-03 hook audit.
 * Case B  guard: a real vendored bg_run `git push origin main` is blocked by the safety hook before
 *         any process spawns (no task output file is ever created).
 * Case C  `bg_run echo ok` is allowed and runs to completion.
 *
 * The safety extension and the vendored entry load together at USER scope (project scope is
 * trust-gated headless). Nothing here pushes: the temp cwd is not a git repo.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { assertAuditNonEmpty, readAudit } from "../helpers/logs.ts";
import { capturing, lastToolResult } from "../helpers/faux.ts";
import { withFauxSession } from "../helpers/session.ts";

const root = repoRoot().replace(/\\/g, "/");
const SAFETY_ENTRY = `${root}/.pi/extensions/safety/index.ts`;
const BGT_ENTRY = `${root}/.pi/extensions/background-tasks/index.ts`;
const SUMMARY_03 = join(repoRoot(), ".planning/phases/08.1-pi-1-x-upgrade-install-health/08.1-03-SUMMARY.md");

const PUSH_MAIN = "git push origin main";
const EXPECTED_TOOLS = ["bg_kill", "bg_logs", "bg_run", "bg_status"];
const DROPPED = /fusion|delegate|attested|attribution|bg_result/i;

/** Parameter names that can carry an executable/path/stdin payload. Never loosen to make a tool pass. */
const INPUT_BEARING =
	/^(command|cmd|exec|executable|script|shell|args|argv|path|paths|file|files|filePath|cwd|dir|directory|stdin|input|data|text|write)$/i;

/**
 * Non-bg_run tools allowed to carry an input-bearing parameter, each citing the
 * registerToolCallHook branch in .pi/extensions/safety/index.ts that maps or denies it.
 * Empty: the trimmed vendored surface has no such tool (bg_status/bg_logs/bg_kill take taskId/maxBytes/tail).
 */
const GUARDED_TOOLS: readonly string[] = [];

/** Safety first, then the vendored extension (the production order). */
const COMBINED_SOURCE = [
	`import safety from ${JSON.stringify(SAFETY_ENTRY)};`,
	`import backgroundTasks from ${JSON.stringify(BGT_ENTRY)};`,
	"export default async function (pi) {",
	"\tsafety(pi);",
	"\tawait backgroundTasks(pi);",
	"}",
	"",
].join("\n");

function taskFiles(cwd: string, suffix: string): string[] {
	const tasks = join(cwd, ".pi", "tasks");
	if (!existsSync(tasks)) {
		return [];
	}
	const out: string[] = [];
	for (const run of readdirSync(tasks)) {
		for (const f of readdirSync(join(tasks, run))) {
			if (f.endsWith(suffix)) {
				out.push(join(tasks, run, f));
			}
		}
	}
	return out;
}

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (pred()) {
			return true;
		}
		await new Promise((r) => setTimeout(r, 50));
	}
	return pred();
}

async function liveTools() {
	return withFauxSession({ extensionPath: BGT_ENTRY, tools: ["bg_run", "bg_status", "bg_logs", "bg_kill", "bg_result", "bg_run_pi_attested", "bg_delegate"] }, async ({ session }) =>
		session.getAllTools().filter((t) => EXPECTED_TOOLS.includes(t.name) || DROPPED.test(t.name) || t.name.startsWith("bg_")),
	);
}

function propNames(parameters: unknown): string[] {
	const props = (parameters as { properties?: Record<string, unknown> }).properties;
	return props === undefined ? [] : Object.keys(props);
}

describe("08.1-05 case A -- vendored extension loads on Pi 1.1.0, process-only", () => {
	it("registers exactly bg_run/bg_status/bg_logs/bg_kill and nothing from the dropped features", async () => {
		const tools = await liveTools();
		expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
		expect(tools.filter((t) => DROPPED.test(t.name))).toEqual([]);
	});

	it("PI_BG_FEATURES with every upstream token cannot re-enable removed tools", async () => {
		const prior = process.env["PI_BG_FEATURES"];
		process.env["PI_BG_FEATURES"] = "process,delegate,fusion,attested,attribution";
		try {
			const tools = await liveTools();
			expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
		} finally {
			if (prior === undefined) {
				delete process.env["PI_BG_FEATURES"];
			} else {
				process.env["PI_BG_FEATURES"] = prior;
			}
		}
	});
});

describe("08.1-05 case D -- input surface fails closed", () => {
	it("no non-bg_run tool has an input-bearing parameter unless GUARDED_TOOLS lists it", async () => {
		const tools = await liveTools();
		expect(tools.length, "no vendored tools registered -- vacuous").toBeGreaterThan(0);
		const offenders: string[] = [];
		for (const t of tools) {
			if (t.name === "bg_run" || GUARDED_TOOLS.includes(t.name)) {
				continue;
			}
			for (const p of propNames(t.parameters)) {
				if (INPUT_BEARING.test(p)) {
					offenders.push(`${t.name}.${p}`);
				}
			}
		}
		expect(offenders, "input-bearing parameter on a tool the safety hook does not map or deny").toEqual([]);
		for (const g of GUARDED_TOOLS) {
			const src = readFileSync(join(repoRoot(), ".pi/extensions/safety/index.ts"), "utf-8");
			expect(src, `GUARDED_TOOLS entry ${g} is not named in the safety hook`).toContain(g);
		}
	});

	it("bg_run exposes command and the other tools are id-only (matches the 08.1-03 audit table)", async () => {
		const tools = await liveTools();
		const byName = new Map(tools.map((t) => [t.name, propNames(t.parameters)]));
		expect(byName.get("bg_run")).toContain("command");
		expect(byName.get("bg_status")).toEqual(["taskId"]);
		expect(byName.get("bg_kill")).toEqual(["taskId"]);
		expect([...(byName.get("bg_logs") ?? [])].sort()).toEqual(["maxBytes", "tail", "taskId"]);
	});

	it("every registered tool name appears in the 08.1-03 SUMMARY 'Process tool input audit' table", async () => {
		const summary = readFileSync(SUMMARY_03, "utf-8");
		const audit = summary.slice(summary.indexOf("## Process tool input audit"));
		const tools = await liveTools();
		for (const t of tools) {
			expect(audit, `${t.name} was never seen by the 08.1-03 hook audit`).toContain(`| ${t.name} |`);
		}
	});
});

async function callBgRun(command: string) {
	const outgoing: TranscriptContext[] = [];
	return withFauxSession(
		{
			extensionSource: COMBINED_SOURCE,
			tools: ["bg_run"],
			responses: [
				fauxAssistantMessage(
					[fauxToolCall("bg_run", { name: "probe", command, isAgent: false })],
					{ stopReason: "toolUse" },
				),
				capturing(outgoing, fauxAssistantMessage([fauxText("noted")], { stopReason: "stop" })),
			],
		},
		async ({ session, cwd }) => {
			await session.prompt("run it");
			const rows = readAudit(cwd);
			assertAuditNonEmpty(rows);
			expect(outgoing.length, "closing reply never reached").toBe(1);
			const result = lastToolResult(outgoing[0] as TranscriptContext);
			const outputsAtReturn = taskFiles(cwd, ".output").length;
			let completed = false;
			if (result?.isError === false) {
				completed = await waitFor(
					() => taskFiles(cwd, ".json").some((f) => readFileSync(f, "utf-8").includes('"status": "completed"') || readFileSync(f, "utf-8").includes('"status":"completed"')),
					15000,
				);
			}
			return { rows, result, outputsAtReturn, completed, outputs: taskFiles(cwd, ".output").map((f) => readFileSync(f, "utf-8")) };
		},
	);
}

describe("08.1-05 case B/C -- the safety hook governs the vendored bg_run", () => {
	it("case B: bg_run `git push origin main` is blocked before any process spawns", async () => {
		const { rows, result, outputsAtReturn } = await callBgRun(PUSH_MAIN);
		expect(result?.isError).toBe(true);
		expect(rows.some((r) => r.tool === "bg_run" && r.verdict === "block" && r.command === PUSH_MAIN)).toBe(true);
		expect(rows.some((r) => r.command === PUSH_MAIN && r.verdict === "allow")).toBe(false);
		// Observable: a started task always creates <cwd>/.pi/tasks/<run>/<id>.output; none exists.
		expect(outputsAtReturn, "a task output file exists -- a process was started").toBe(0);
	});

	it("case C: bg_run `echo ok` is allowed and completes", async () => {
		const { rows, result, completed, outputs } = await callBgRun("echo ok");
		expect(result?.isError).toBe(false);
		expect(rows.some((r) => r.tool === "bg_run" && r.verdict === "allow" && r.command === "echo ok")).toBe(true);
		expect(completed, "task never reached status completed").toBe(true);
		expect(outputs.join("\n")).toContain("ok");
	});
});
