/**
 * SAFE-12 -- the blocked command stays blocked inside a spawned HEADLESS
 * SUBAGENT child process, and the child's own audit log is the evidence that
 * the guard was genuinely present rather than merely quiet.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a repeat of SAFE-10 (`headless-deny.test.ts`, Plan 09)
 * ---------------------------------------------------------------------------
 * Plan 09 already proves a blocked command is denied inside a real spawned
 * `pi --mode json` process with no UI bound. This file proves the SPAWN
 * TOPOLOGY that PITFALLS Pitfall 15 names specifically: `pi-subagents@0.47.1`
 * spawns a real child `pi` process from `pi-spawn.ts:139-163` whose own
 * working directory is a PROJECT directory that MAY carry project-scoped
 * `.pi/extensions/`, gated behind project trust that never resolves headless
 * (`resolveProjectTrusted` returns `false` with no UI --
 * PITFALLS.md:537-561). `pi-subagents` is not installed until Phase 7
 * (CLAUDE.md "Deferred"), so this test builds the faithful PROXY
 * 04-RESEARCH.md's Open Question 2 designs: the same composition Plan 09
 * proved reliable (`writeUserScopeShim` + an in-process `fauxProvider` driver
 * extension + a real spawned `pi --mode json` child), with a working
 * directory that ALSO contains a project-scoped `.pi/extensions/` sentinel --
 * so ONE spawn proves both halves of decision 6 (CONTEXT.md): user scope
 * loads, project scope genuinely does not, in the same run.
 *
 * Reused wholesale from Plan 09 rather than re-derived (per this plan's
 * `read_first`): the in-process `fauxProvider` driver-extension mechanism,
 * `writeUserScopeShim`, `runPi`, and the block-versus-allow audit-row
 * assertions. See `headless-deny.test.ts`'s own docstring for why the
 * plan's originally-suggested loopback-HTTP composition was abandoned.
 *
 * ---------------------------------------------------------------------------
 * ONE spawned child, TWO scripted tool calls (cost control)
 * ---------------------------------------------------------------------------
 * This is the phase's single most expensive test. Rather than spawning twice
 * (once per command, as Plan 09 does across two `it()` cases), the driver
 * here scripts BOTH commands into ONE spawned process's turn sequence: the
 * blocked command first, then the benign command, then a closing text
 * message. Pi's real agent loop feeds each tool result back to the model and
 * asks for the next turn regardless of whether the previous tool call was
 * blocked, so the scripted response queue advances exactly the same way it
 * would in a real multi-tool-call exchange.
 *
 * ---------------------------------------------------------------------------
 * Three assertions, one spawn
 * ---------------------------------------------------------------------------
 * 1. BLOCK IN THE CHILD -- the first bash tool call (the blocked command)
 *    surfaces as an error result carrying the guard's own reason text.
 * 2. THE GUARD WAS PRESENT, NOT MERELY QUIET -- the child's own
 *    `.pi/logs/audit-*.jsonl` contains an ALLOW row for the benign command
 *    it also ran, alongside the BLOCK row. Without the allow row, an empty
 *    or block-only audit log is indistinguishable from "the subagent did
 *    nothing dangerous" and "the guard was never loaded" -- precisely
 *    Pitfall 15's warning sign (PITFALLS.md:561), turned into an assertion.
 * 3. PROJECT SCOPE GENUINELY DOES NOT LOAD -- a project-scoped sentinel
 *    extension is planted at `<cwd>/.pi/extensions/kypi-project-sentinel/
 *    index.ts` that writes a marker file to disk purely as an IMPORT-TIME
 *    side effect (i.e. it fires the instant jiti loads the module, before
 *    Pi ever calls the extension's default export). No `-a` flag is passed
 *    and the throwaway agent dir has no saved trust decision, so project
 *    trust resolves to the non-interactive default ("ask", ignored with no
 *    error -- `tests/integration/load-paths.test.ts` case 4 proves this
 *    exact mechanism against the real repo). Asserting the marker file is
 *    ABSENT after the run confirms the module was never even imported, on
 *    the same run that proves the user-scope stub loaded and enforced.
 *
 * ---------------------------------------------------------------------------
 * Never `it.skip`
 * ---------------------------------------------------------------------------
 * `requirePiOnPath()` throws with the exact remedy if `pi` is missing --
 * matching every other real-subprocess test in this repository. There is no
 * env-var gate and no `describe.skip` here, per this plan's own instruction
 * and `tests/helpers/pi.ts`'s stated no-skip contract.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { logFilesIn, readJsonl } from "../helpers/logs.ts";
import { requirePiOnPath, runPi } from "../helpers/pi.ts";
import { scratchDirs } from "../helpers/scratch.ts";
import { writeUserScopeShim } from "../helpers/session.ts";

/** Cold jiti compile; matches this suite's other real-subprocess spawns. */
const TIMEOUT_MS = 120_000;

const PROVIDER_ID = "kypi-subagent-loopback";
const MODEL_ID = "kypi-subagent-block-sentinel";

/** SAFE-06's path table blocks this directly at the HOOK -- proven fixture, reused verbatim from Plan 09/08. */
const BLOCKED_COMMAND = "cat terraform.tfstate";

/** Nothing this project's policy classifies -- plain `echo`, no git/infra/path invocation. */
const BENIGN_COMMAND = "echo kypi-subagent-positive-control-sentinel";

/** File the project-scoped sentinel writes IF (and only if) it is ever imported. */
const PROJECT_SENTINEL_MARKER = "kypi-project-sentinel-loaded.marker";

const scratch = scratchDirs();
const tempDir = scratch.make;

function freshEnv(agentDir: string): Record<string, string> {
	return {
		...(process.env as Record<string, string>),
		PI_CODING_AGENT_DIR: agentDir,
	};
}

/**
 * Write the in-process faux-provider driver extension at user scope, scripted
 * with ONE tool call per entry in `commands`, followed by a closing text
 * message so the exchange settles instead of re-attempting the last call.
 *
 * See the module docstring's "ONE spawned child, TWO scripted tool calls"
 * section. Mechanism copied wholesale from `headless-deny.test.ts`
 * (Plan 09) -- see that file's docstring for why this replaces a
 * cross-process loopback HTTP server.
 */
function writeFauxDriverExtension(agentDir: string, commands: string[]): void {
	const dir = join(agentDir, "extensions", "kypi-faux-driver");
	mkdirSync(dir, { recursive: true });
	const toolCallLines = commands.map(
		(command) =>
			`\tfauxAssistantMessage(fauxToolCall("bash", { command: ${JSON.stringify(command)} }), { stopReason: "toolUse" }),`,
	);
	const source = [
		'import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";',
		'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
		"",
		"// Generated by tests/integration/subagent-block.test.ts. Lives in a temp dir",
		"// outside this repository -- never committed.",
		"export default function (pi: ExtensionAPI): void {",
		"\tconst faux = fauxProvider({",
		`\t\tprovider: ${JSON.stringify(PROVIDER_ID)},`,
		"\t\tmodels: [",
		"\t\t\t{",
		`\t\t\t\tid: ${JSON.stringify(MODEL_ID)},`,
		"\t\t\t\treasoning: false,",
		'\t\t\t\tinput: ["text"],',
		"\t\t\t\tcost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },",
		"\t\t\t\tcontextWindow: 8192,",
		"\t\t\t\tmaxTokens: 1024,",
		"\t\t\t},",
		"\t\t],",
		"\t});",
		"\t// One tool call per scripted command, in order, then plain text so the",
		"\t// exchange settles instead of re-attempting the last call.",
		"\tfaux.setResponses([",
		...toolCallLines,
		'\t\tfauxAssistantMessage("acknowledged"),',
		"\t]);",
		"\tpi.registerProvider(faux.provider);",
		"}",
		"",
	].join("\n");
	writeFileSync(join(dir, "index.ts"), source, "utf-8");
}

/**
 * Plant a project-scoped extension that leaves an on-disk marker purely as an
 * IMPORT-TIME side effect -- so "the marker is absent" means "the module was
 * never imported", which is a stronger claim than "the module ran and did
 * nothing". This is the SAFE-11 mechanism (project trust never resolves
 * headless) exercised from inside the SAME spawn that proves SAFE-12.
 */
function writeProjectScopedSentinel(cwd: string): void {
	const dir = join(cwd, ".pi", "extensions", "kypi-project-sentinel");
	mkdirSync(dir, { recursive: true });
	const source = [
		'import { writeFileSync } from "node:fs";',
		'import { join } from "node:path";',
		"",
		"// Generated by tests/integration/subagent-block.test.ts. If Pi ever imports",
		"// this module, the marker below is written BEFORE the default export is",
		"// even called -- proof the module was loaded, not merely inert.",
		`writeFileSync(join(process.cwd(), ${JSON.stringify(PROJECT_SENTINEL_MARKER)}), "loaded", "utf-8");`,
		"",
		"export default function (): void {",
		"\t// Never reached headless with no project trust decision on record.",
		"}",
		"",
	].join("\n");
	writeFileSync(join(dir, "index.ts"), source, "utf-8");
}

interface JsonLine {
	type?: unknown;
	[key: string]: unknown;
}

/** Parse `--mode json` stdout into one object per line, dropping blank lines. */
function parseJsonLines(stdout: string): JsonLine[] {
	const out: JsonLine[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") {
			continue;
		}
		out.push(JSON.parse(trimmed) as JsonLine);
	}
	return out;
}

interface ToolExecutionEndEvent {
	type: "tool_execution_end";
	toolCallId: string;
	toolName: string;
	result: { content?: Array<{ type: string; text?: string }> };
	isError: boolean;
	[key: string]: unknown;
}

function isToolExecutionEnd(line: JsonLine): line is ToolExecutionEndEvent {
	return line.type === "tool_execution_end";
}

function resultText(event: ToolExecutionEndEvent): string {
	return (event.result.content ?? []).map((c) => (typeof c.text === "string" ? c.text : "")).join("");
}

interface AuditRow {
	event: string;
	tool: string;
	command: string;
	cwd: string;
	verdict: "allow" | "block";
	reason: string;
	pid: number;
}

/** Read every `<cwd>/.pi/logs/audit-*.jsonl` row -- the SAFE-14 log this project's safety extension writes. */
function readAuditRows(cwd: string): AuditRow[] {
	const dir = join(cwd, ".pi", "logs");
	const rows: AuditRow[] = [];
	for (const name of logFilesIn(dir)) {
		if (!/^audit-\d{4}-\d{2}-\d{2}(\.\d+)?\.jsonl$/.test(name)) {
			continue;
		}
		rows.push(...(readJsonl(join(dir, name)) as AuditRow[]));
	}
	return rows;
}

/** The safety extension's own entry point -- the file `writeUserScopeShim` re-exports. */
const SAFETY_ENTRY_POINT = join(repoRoot(), ".pi", "extensions", "safety", "index.ts");

describe("SAFE-12 -- a blocked command stays blocked inside a spawned headless subagent child", () => {
	let agentDir: string;
	let cwd: string;
	let durationMs: number;

	beforeAll(() => {
		// Throws rather than skipping -- see tests/helpers/pi.ts's own docstring.
		requirePiOnPath();

		agentDir = tempDir("kypi-subagent-agentdir-");
		// The PROJECT directory a real pi-subagents child would be spawned into --
		// outside this repository, carrying its OWN .pi/extensions/ (the project
		// sentinel below), exactly the topology PITFALLS Pitfall 15 describes.
		cwd = tempDir("kypi-subagent-cwd-");

		// SAFE-11's mechanism: the ONLY possible source of the safety extension is
		// the user-scope stub, never project scope.
		writeUserScopeShim(agentDir, "ky-safety", SAFETY_ENTRY_POINT);

		// SAFE-12's differentiator versus Plan 09: a project-scoped resource sits
		// in the child's own cwd, proving it is genuinely ignored headless rather
		// than merely absent from the fixture.
		writeProjectScopedSentinel(cwd);

		writeFauxDriverExtension(agentDir, [BLOCKED_COMMAND, BENIGN_COMMAND]);
	});

	afterAll(scratch.cleanup);

	it(
		"one spawned child: blocks the dangerous command, allows the benign one, and never imports the project-scoped sentinel",
		() => {
			const startedAt = Date.now();

			// No `-a`: project trust must resolve to its non-interactive default
			// ("ask", ignored with no error) exactly as
			// tests/integration/load-paths.test.ts case 4 proves against this repo.
			const result = runPi(
				[
					"--mode",
					"json",
					"--provider",
					PROVIDER_ID,
					"--model",
					MODEL_ID,
					"--no-session",
					"--no-approve",
					"trigger the scripted turns",
				],
				{ cwd, env: freshEnv(agentDir) },
			);

			durationMs = Date.now() - startedAt;

			// The process completed within the timeout with a real exit code --
			// `--mode json` never binds a UI, so nothing was ever waiting on input;
			// a hung process would instead have been killed by spawnSync's timeout.
			expect(result.status, `pi failed:\n${result.stderr}\nstdout:\n${result.stdout}`).toBe(0);

			const lines = parseJsonLines(result.stdout);
			expect(lines.length, "the JSONL stream must not be empty").toBeGreaterThan(0);

			const bashEnds = lines.filter(isToolExecutionEnd).filter((e) => e.toolName === "bash");
			expect(
				bashEnds.length,
				`expected two tool_execution_end events for the bash tool (one per scripted command). stdout:\n${result.stdout}`,
			).toBeGreaterThanOrEqual(2);

			// --- assertion 1: BLOCK IN THE CHILD -----------------------------------
			const blockedEnd = bashEnds[0] as ToolExecutionEndEvent;
			expect(
				blockedEnd.isError,
				"the blocked command must surface as an ERROR tool result inside the spawned child, not a silent allow",
			).toBe(true);
			expect(
				resultText(blockedEnd),
				"the error text must carry the guard's OWN reason -- not merely a substring a genuine " +
					"unrelated error could also produce (mutation-tested precision, per Plan 09's finding)",
			).toMatch(/holds plaintext secrets/i);

			// --- POSITIVE CONTROL: the benign command executes normally -----------
			const benignEnd = bashEnds[1] as ToolExecutionEndEvent;
			expect(benignEnd.isError, "the benign command must execute inside the SAME child, not be blocked").toBe(
				false,
			);
			expect(
				resultText(benignEnd),
				"the real `echo` output must reach the result -- proof this actually ran a shell",
			).toContain("kypi-subagent-positive-control-sentinel");

			// --- assertion 2: THE GUARD WAS PRESENT, NOT MERELY QUIET --------------
			const rows = readAuditRows(cwd);
			expect(
				rows.length,
				`.pi/logs/audit-*.jsonl under the CHILD's cwd (${cwd}) is empty or absent -- the guard ` +
					"never wrote a row at all inside the spawned subagent",
			).toBeGreaterThan(0);

			const blockRow = rows.find(
				(r) => r.verdict === "block" && r.tool === "bash" && /holds plaintext secrets/i.test(r.reason),
			);
			expect(
				blockRow,
				`no block row for the terraform.tfstate command was found in the CHILD's own audit log. Rows:\n${JSON.stringify(rows, null, 2)}`,
			).toBeDefined();

			const allowRow = rows.find((r) => r.verdict === "allow" && r.tool === "bash");
			expect(
				allowRow,
				"no allow row for the benign command was found in the CHILD's own audit log -- this is " +
					"the row that proves the guard was genuinely LOADED and evaluating inside the subagent, " +
					"rather than the log simply being empty because nothing dangerous was attempted. An " +
					`absent allow row here may mean the guard never loaded at all. Rows:\n${JSON.stringify(rows, null, 2)}`,
			).toBeDefined();

			// --- assertion 3: PROJECT SCOPE GENUINELY DOES NOT LOAD -----------------
			const markerPath = join(cwd, PROJECT_SENTINEL_MARKER);
			expect(
				existsSync(markerPath),
				"the project-scoped sentinel's marker file exists, which means Pi IMPORTED a module " +
					"under the child cwd's .pi/extensions/ with no project trust decision on record and no " +
					"-a flag -- this would mean project-scoped resources are reachable from a headless " +
					"subagent, which is precisely the failure Pitfall 15 (and SAFE-11) exist to rule out",
			).toBe(false);

			// Recorded in the SUMMARY per this plan's acceptance criteria.
			console.log(`subagent-block.test.ts: single spawned child completed in ${String(durationMs)}ms`);
		},
		TIMEOUT_MS,
	);
});
