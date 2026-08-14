/**
 * SAFE-10 -- a blocked command is denied inside a REAL, separately-spawned
 * `pi --mode json` process, where `noOpUIContext` is genuinely bound rather
 * than merely asserted about.
 *
 * ---------------------------------------------------------------------------
 * Why a faux session cannot prove this (04-RESEARCH.md Pattern 4)
 * ---------------------------------------------------------------------------
 * `hasUI()` is an object-identity check against the `noOpUIContext` singleton
 * [`dist/core/extensions/runner.js:153,274-276`], not a mode-string branch.
 * `createFauxSession` (Plan 08's `double-enforcement.test.ts`) drives a REAL
 * in-process agent loop and is the right tool for proving policy logic and
 * double enforcement, but it runs inside THIS test process, which never binds
 * a UI context either way -- so it cannot distinguish "no UI was ever bound"
 * from "a UI could have been bound but the test harness happens not to use
 * one". Only an actual `--mode json` subprocess, spawned via `runPi()`, can
 * make that distinction, because Pi's own CLI entry point is what decides
 * whether `setUIContext` is ever called.
 *
 * ---------------------------------------------------------------------------
 * The composition, and the dead end it replaces (RESEARCH Open Question 2)
 * ---------------------------------------------------------------------------
 * The plan's own design named `tests/helpers/loopback.ts` (a cross-process
 * HTTP capture server in THIS test process) as the way to script the spawned
 * `pi`'s model turn. THAT COMPOSITION WAS TRIED, AND MEASURED TO BE
 * UNRELIABLE: driving the identical argv through `spawnSync` from inside a
 * vitest test process (`--pool=threads` and `--pool=forks` both) reproduced a
 * deterministic hang -- the spawned `pi` process never even opened a
 * connection to the loopback server -- in every one of five separate runs,
 * while the SAME argv against the SAME server run from a bare `node script.mjs`
 * outside vitest succeeded in four of five runs, and reliably once warmed.
 * Stripping every `npm_config_*`/`NPM_CONFIG_*`/`VITEST*` variable vitest
 * injects into the child's environment (bootstrap.sh's own documented
 * pollution hazard) made no difference. The proximate cause was never fully
 * isolated -- plausibly a security-software interception of loopback traffic
 * specifically between a vitest-spawned process and a freshly-launched child,
 * plausibly something else -- and RESEARCH's own Open Question 2 explicitly
 * pre-authorizes exactly this situation: fall back to whatever route
 * reliably reaches the wrapped tool, and record precisely what does and does
 * not change.
 *
 * THE FIX: no network at all. `fauxProvider()` [pi-ai 0.84.1
 * `dist/providers/faux.js`] resolves every scripted response through
 * `queueMicrotask` with no `fetch` anywhere in its implementation. Instead of
 * a `models.json` pointing at an external loopback URL, this file writes a
 * small DRIVER EXTENSION straight into the throwaway agent directory
 * (`kypi-faux-driver`) that imports `fauxProvider`/`fauxToolCall`/
 * `fauxAssistantMessage` from `@earendil-works/pi-ai` and calls
 * `pi.registerProvider(faux.provider)` -- run INSIDE the spawned `pi`
 * process itself, exactly the same `registerProvider`-during-the-factory
 * pattern the sentinel provider in Plan 01's `user-scope-load.test.ts`
 * already proved loads and resolves with no trust prompt. Verified by direct
 * repeated execution (both standalone and inside vitest) to complete in well
 * under a second with no flakiness across multiple consecutive runs.
 *
 * The driver's scripted response queue is exactly two entries: turn 1 always
 * emits a single `bash` tool call for the given command, turn 2 always
 * settles with plain text -- so the exchange terminates instead of
 * re-attempting the same command once its tool result comes back.
 *
 * ---------------------------------------------------------------------------
 * What this file proves, and what it explicitly does not (scope, stated
 * honestly per the plan's own fallback clause)
 * ---------------------------------------------------------------------------
 * PROVEN: a command classified `block` by `policy.ts` is refused with no UI
 * bound at all, in a real subprocess, with an audit trail; the identical
 * harness executes a benign command normally, so the deny is not merely "the
 * subprocess could not execute anything".
 *
 * NOT exercised here: the `confirm`-verdict / `approve_ky_command` path,
 * where `ctx.ui.select()` itself returns `undefined` headless. That specific
 * mechanism is unit-proven in `tests/unit/safety-entry.test.ts`'s WR-11
 * describe block ("approve_ky_command.execute() denies by default on every
 * non-affirmative branch"), which drives the REGISTERED tool's own
 * `execute()` directly for all three deny-by-default branches T-04-03 names
 * (`hasUI: false`, an explicit "Deny" selection, and `ctx.ui.select()`
 * returning `undefined`), asserting both that it throws and that no grant is
 * left behind. (This docstring previously named
 * `tests/integration/double-enforcement.test.ts` too -- that file proves
 * SAFE-09's mutation-after-allow property, not this one; it never invokes
 * `approve_ky_command` at all. Corrected as WR-11.) Scripting a SECOND tool
 * call (`approve_ky_command`) on top of the two-turn exchange above was
 * judged unnecessary for this plan and would not add anything the unit-level
 * proof does not already cover -- both paths go through the identical
 * `noOpUIContext` singleton this file's DENY case already proves is bound.
 *
 * ---------------------------------------------------------------------------
 * Never `it.skip`
 * ---------------------------------------------------------------------------
 * `requirePiOnPath()` throws with the exact remedy if `pi` is missing --
 * matching every other real-subprocess test in this repository.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { requirePiOnPath, runPi } from "../helpers/pi.ts";
import { writeUserScopeShim } from "../helpers/session.ts";

/** Cold jiti compile; matches this suite's other real-subprocess spawns. */
const TIMEOUT_MS = 120_000;

const PROVIDER_ID = "kypi-loopback";
const MODEL_ID = "kypi-headless-deny-sentinel";

/** SAFE-06's path table blocks this directly at the HOOK (`policy.ts`'s "block", never "confirm") -- proven fixture, reused verbatim from Plan 08's `double-enforcement.test.ts` Case 1. */
const BLOCKED_COMMAND = "cat terraform.tfstate";

/** Nothing this project's policy classifies -- plain `echo`, no git/infra/path invocation. */
const BENIGN_COMMAND = "echo kypi-positive-control-sentinel";

/** Temp dirs created by this suite, removed in `afterAll`. */
const scratch: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
}

function freshEnv(agentDir: string): Record<string, string> {
	return {
		...(process.env as Record<string, string>),
		PI_CODING_AGENT_DIR: agentDir,
	};
}

/**
 * Write (or overwrite) the in-process faux-provider driver extension at user
 * scope. See the module docstring's "THE FIX" section for why this replaces
 * a loopback HTTP server. Overwriting the SAME file between the two `it()`
 * cases below and relying on a fresh `pi` process to re-resolve it is the
 * identical mechanism `user-scope-load.test.ts`'s FRESHNESS case already
 * proved: jiti has no cross-process cache, so each spawn sees exactly the
 * content on disk at the moment it starts.
 */
function writeFauxDriverExtension(agentDir: string, command: string): void {
	const dir = join(agentDir, "extensions", "kypi-faux-driver");
	mkdirSync(dir, { recursive: true });
	const source = [
		'import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";',
		'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
		"",
		"// Generated by tests/integration/headless-deny.test.ts. Lives in a temp dir",
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
		"\t// Turn 1: a single bash tool call for the scripted command. Turn 2: plain",
		"\t// text, so the exchange settles instead of re-attempting the same call.",
		"\tfaux.setResponses([",
		`\t\tfauxAssistantMessage(fauxToolCall("bash", { command: ${JSON.stringify(command)} }), { stopReason: "toolUse" }),`,
		'\t\tfauxAssistantMessage("acknowledged"),',
		"\t]);",
		"\tpi.registerProvider(faux.provider);",
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
	if (!existsSync(dir)) {
		return [];
	}
	const rows: AuditRow[] = [];
	for (const name of readdirSync(dir)) {
		if (!/^audit-\d{4}-\d{2}-\d{2}(\.\d+)?\.jsonl$/.test(name)) {
			continue;
		}
		const text = readFileSync(join(dir, name), "utf-8");
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (trimmed === "") {
				continue;
			}
			rows.push(JSON.parse(trimmed) as AuditRow);
		}
	}
	return rows;
}

/** The safety extension's own entry point -- the file `writeUserScopeShim` re-exports. */
const SAFETY_ENTRY_POINT = join(repoRoot(), ".pi", "extensions", "safety", "index.ts");

describe("SAFE-10 / SAFE-11 -- a blocked command is denied inside a real headless pi process", () => {
	let agentDir: string;
	let cwd: string;

	beforeAll(() => {
		// Throws rather than skipping -- see tests/helpers/pi.ts's own docstring.
		requirePiOnPath();

		agentDir = tempDir("kypi-agentdir-");
		// A throwaway cwd OUTSIDE this repository: from inside the repo, Pi would
		// walk up collecting this project's own 49 KB CLAUDE.md into every
		// request (tests/helpers/session.ts's own documented hazard).
		cwd = tempDir("kypi-cwd-");

		// SAFE-11's mechanism, not project-scoped resources: this cwd has no
		// .pi/extensions at all, so the ONLY possible source of the safety
		// extension is the user-scope stub.
		writeUserScopeShim(agentDir, "ky-safety", SAFETY_ENTRY_POINT);
	});

	afterAll(() => {
		for (const dir of scratch) {
			try {
				rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
			} catch {
				// A leftover temp dir is noise, not a failure.
			}
		}
	});

	it(
		"case 1 -- DENY: a blocked bash command is refused, with no UI bound and no hang",
		() => {
			writeFauxDriverExtension(agentDir, BLOCKED_COMMAND);

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
					"trigger the scripted first turn",
				],
				{ cwd, env: freshEnv(agentDir) },
			);

			// The process completed within the timeout with a real exit code --
			// this IS the "no hang" proof: `--mode json` never binds a UI, so
			// nothing was ever waiting on input; a hung process would instead
			// have been killed by spawnSync's timeout and reported status null.
			expect(result.status, `pi failed:\n${result.stderr}\nstdout:\n${result.stdout}`).toBe(0);

			const lines = parseJsonLines(result.stdout);
			expect(lines.length, "the JSONL stream must not be empty").toBeGreaterThan(0);

			const toolEnds = lines.filter(isToolExecutionEnd);
			expect(
				toolEnds.length,
				`no tool_execution_end line was emitted at all. stdout:\n${result.stdout}`,
			).toBeGreaterThan(0);

			const bashEnd = toolEnds.find((e) => e.toolName === "bash");
			expect(bashEnd, "no tool_execution_end for the bash tool call was found").toBeDefined();
			expect(
				bashEnd?.isError,
				"the blocked command must surface as an ERROR tool result, not a silent allow",
			).toBe(true);
			expect(
				resultText(bashEnd as ToolExecutionEndEvent),
				"the error text must carry the guard's OWN reason -- not merely the substring " +
					'"tfstate", which a genuine `cat: No such file or directory` error would ALSO ' +
					"contain and would make this assertion pass vacuously if the guard were removed " +
					"(caught by mutation testing during this plan's execution)",
			).toMatch(/holds plaintext secrets/i);
		},
		TIMEOUT_MS,
	);

	it(
		"case 3 -- POSITIVE CONTROL: the identical harness executes a benign command normally",
		() => {
			writeFauxDriverExtension(agentDir, BENIGN_COMMAND);

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
					"trigger the scripted first turn",
				],
				{ cwd, env: freshEnv(agentDir) },
			);

			expect(result.status, `pi failed:\n${result.stderr}\nstdout:\n${result.stdout}`).toBe(0);

			const lines = parseJsonLines(result.stdout);
			expect(lines.length, "the JSONL stream must not be empty").toBeGreaterThan(0);

			const toolEnds = lines.filter(isToolExecutionEnd);
			const bashEnd = toolEnds.find((e) => e.toolName === "bash");
			expect(
				bashEnd,
				"without this control, case 1's block is indistinguishable from a subprocess " +
					"that cannot execute ANY tool at all",
			).toBeDefined();
			expect(bashEnd?.isError, "a benign command must execute, not be blocked").toBe(false);
			expect(
				resultText(bashEnd as ToolExecutionEndEvent),
				"the real `echo` output must reach the result -- proof this actually ran a shell, " +
					"not merely that the guard stayed out of the way",
			).toContain("kypi-positive-control-sentinel");
		},
		TIMEOUT_MS,
	);

	it("case 4 -- AUDIT: the shared log carries a block row from case 1 and an allow row from case 3", () => {
		const rows = readAuditRows(cwd);
		expect(
			rows.length,
			`.pi/logs/audit-*.jsonl under ${cwd} is empty or absent -- the guard never wrote a row at all`,
		).toBeGreaterThan(0);

		const blockRow = rows.find(
			(r) => r.verdict === "block" && r.tool === "bash" && /holds plaintext secrets/i.test(r.reason),
		);
		expect(
			blockRow,
			`no block row for the terraform.tfstate command was found. Rows:\n${JSON.stringify(rows, null, 2)}`,
		).toBeDefined();

		const allowRow = rows.find((r) => r.verdict === "allow" && r.tool === "bash");
		expect(
			allowRow,
			`no allow row for the benign command was found -- this is the row that proves the guard ` +
				`was genuinely LOADED and evaluating, rather than the log simply being empty. Rows:\n${JSON.stringify(rows, null, 2)}`,
		).toBeDefined();
	});
});
