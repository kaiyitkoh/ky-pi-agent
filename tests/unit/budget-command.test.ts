/**
 * DIAG-06 — the `/budget` COMMAND HANDLER, driven end to end offline.
 *
 * ---------------------------------------------------------------------------
 * THE GAP THIS FILE CLOSES
 * ---------------------------------------------------------------------------
 * `registerBudgetCommand`'s handler body — roughly fifty lines including
 * `ctx.getSystemPrompt()`, `ctx.getSystemPromptOptions()`,
 * `formatSkillsForPrompt(skills)`, the `getActiveTools`/`getAllTools`
 * intersection, `getLastAssistantUsage(...)`, `ctx.ui.notify` and the entire
 * catch path that writes a `diagnostics.error` row carrying
 * `BUDGET_COMMAND_WHERE` — had ZERO coverage. `diagnostics-entry.test.ts`
 * asserts only that the command NAME was registered; its stub `registerCommand`
 * discards the handler. `budget.test.ts` calls `computeBudget` and
 * `formatBudgetReport` directly and states the gap in its own header.
 *
 * `ExtensionCommandContext` is a plain interface and every pure function in
 * `budget.ts` already takes its inputs as data, so the handler is drivable with
 * no session at all — which is the only reason the gap was ever tolerable and
 * therefore the reason it is not.
 *
 * ---------------------------------------------------------------------------
 * THE TRIPWIRE, AGAINST PI'S OWN FORMATTER FOR THE FIRST TIME
 * ---------------------------------------------------------------------------
 * `report.skillsBlockMatchesSlice` is described in `budget.test.ts` as
 * "RESEARCH §7.3's tripwire for Pi changing its format". It was not one. Every
 * `computeBudget` call in that file passes `skillsBlock: ""` hand-written by the
 * test, and in those sessions `slices.skills` is also `0` — so the assertion
 * compared a constant the test supplied against a default that happens to match.
 * `budget-sections.test.ts` case 5 exercises the COMPARISON against a synthetic
 * block, which is a different claim.
 *
 * Here the system prompt the stub returns CONTAINS the output of the real
 * `formatSkillsForPrompt`, and the handler recomputes the block with that same
 * exported function. So the sliced region and the recomputed block are compared
 * against each other for a NON-EMPTY block, through Pi's own formatter, at the
 * version installed in `node_modules`. If a future release moves
 * `SKILLS_OPEN_MARKER` or `SKILLS_CLOSE_MARKER` relative to what the formatter
 * emits, this is the file that goes red. [threat T-02-10-02]
 */
import { existsSync } from "node:fs";

import type { Skill } from "@earendil-works/pi-coding-agent";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { describe, expect, it } from "vitest";

import {
	BUDGET_COMMAND_NAME,
	BUDGET_COMMAND_WHERE,
	CONTEXT_FILES_CLOSE_MARKER,
	CONTEXT_FILES_OPEN_MARKER,
	FLOOR_LABEL,
	PROVIDER_REPORTED_LABEL,
	ROWS_WRITTEN_LABEL,
	SKILLS_CLOSE_MARKER,
	SKILLS_OPEN_MARKER,
	computeBudget,
	estimateTokensFromChars,
	registerBudgetCommand,
} from "../../.pi/extensions/diagnostics/budget.ts";
import { logPath, rowsWrittenThisSession } from "../../.pi/extensions/diagnostics/jsonl.ts";
import {
	DIAGNOSTICS_ERROR_EVENT,
	TURNS_LOG_BASE,
} from "../../.pi/extensions/diagnostics/schema.ts";
import { SECRET_FIXTURE_TOKEN } from "../helpers/faux.ts";
import { readJsonl, withTempLogCwd } from "../helpers/logs.ts";

/** A command handler as Pi stores it. */
type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

/** The context file the fixture claims Pi loaded. */
const CONTEXT_PATH = "/tmp/kypi/AGENTS.md";
const CONTEXT_BODY = "Always run the tests before committing.";

/** A real `Skill`, so `formatSkillsForPrompt` produces a real non-empty block. */
const SKILL: Skill = {
	name: "commit",
	description: "How to commit in this repository",
	filePath: "/tmp/kypi/skills/commit/SKILL.md",
	baseDir: "/tmp/kypi/skills/commit",
	sourceInfo: {} as Skill["sourceInfo"],
	disableModelInvocation: false,
};

/** The block Pi itself would append. Computed, never transcribed. */
const REAL_SKILLS_BLOCK = formatSkillsForPrompt([SKILL]).trim();

/** Pi's own per-file wrapper [VERIFIED: pi 0.84.1 src/core/system-prompt.ts:149]. */
const CONTEXT_BLOCK =
	CONTEXT_FILES_OPEN_MARKER +
	"Project-specific instructions and guidelines:\n\n" +
	`<project_instructions path="${CONTEXT_PATH}">\n${CONTEXT_BODY}\n</project_instructions>\n\n` +
	CONTEXT_FILES_CLOSE_MARKER;

/**
 * The system prompt the stub context returns.
 *
 * Assembled in Pi's own order — preamble, context block, skills index, trailer —
 * with the SKILLS HALF produced by the real exported formatter rather than
 * transcribed. That is what makes the recomputed-versus-sliced cross-check a
 * check against Pi and not against this file.
 */
const FULL_PROMPT =
	"You are an expert coding assistant.\n\nGuidelines:\n- Be concise\n" +
	CONTEXT_BLOCK +
	REAL_SKILLS_BLOCK +
	"\nCurrent working directory: /tmp/kypi";

/** What one handler invocation produced. */
interface Invocation {
	notified: { text: string; level?: string }[];
	rows: { event?: string; where?: string; error?: string }[];
}

/** Options for {@link invoke}, so each case varies exactly one thing. */
interface InvokeOptions {
	/** Throws instead of returning the prompt, to drive the catch path. */
	promptError?: string;
	/** Throws from `ctx.ui.notify`, to drive the "UI is dead too" branch. */
	notifyThrows?: boolean;
	/** Session entries `getLastAssistantUsage` reads. Default: one assistant turn. */
	branch?: unknown[];
}

/**
 * Register the REAL command against a recording stub, then invoke its handler.
 *
 * The handler is pulled off the stub rather than reimplemented: a test that
 * called `computeBudget` itself would prove the same thing `budget.test.ts`
 * already proves and would leave the fifty lines around it unexecuted.
 */
async function invoke(opts: InvokeOptions = {}): Promise<Invocation & { cwd: string }> {
	return await withTempLogCwd(async (cwd) => {
		let handler: CommandHandler | undefined;
		const rowsBefore = rowsWrittenThisSession();

		const pi = {
			registerCommand(name: string, spec: { handler: CommandHandler }) {
				if (name === BUDGET_COMMAND_NAME) {
					handler = spec.handler;
				}
			},
			// `read` is active; `bash` is registered and NOT active, so the
			// intersection in the handler has something to actually exclude.
			getActiveTools: () => ["read"],
			getAllTools: () => [
				{ name: "read", description: "Read a file", parameters: { path: "string" } },
				{ name: "bash", description: "Run a command", parameters: { command: "string" } },
			],
		} as unknown as ExtensionAPI;

		registerBudgetCommand(pi, () => 7);

		expect(
			handler,
			`registerBudgetCommand did not register a handler under "${BUDGET_COMMAND_NAME}", so every ` +
				"assertion in this file would be about a function that was never called",
		).toBeDefined();

		const notified: { text: string; level?: string }[] = [];
		const ctx = {
			cwd,
			ui: {
				notify: (text: string, level?: string) => {
					if (opts.notifyThrows === true) {
						throw new Error("no terminal attached");
					}
					notified.push({ text, level });
				},
			},
			getSystemPrompt: () => {
				if (opts.promptError !== undefined) {
					throw new Error(opts.promptError);
				}
				return FULL_PROMPT;
			},
			getSystemPromptOptions: () => ({
				cwd,
				contextFiles: [{ path: CONTEXT_PATH, content: CONTEXT_BODY }],
				skills: [SKILL],
			}),
			sessionManager: {
				getBranch: () =>
					opts.branch ?? [
						{
							type: "message",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "hi" }],
								usage: {
									input: 12_725,
									output: 40,
									cacheRead: 3_000,
									cacheWrite: 0,
									totalTokens: 15_765,
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
								},
							},
						},
					],
			},
		} as unknown as ExtensionCommandContext;

		await handler?.("", ctx);

		const turnsFile = logPath(cwd, TURNS_LOG_BASE);
		const rows = existsSync(turnsFile)
			? (readJsonl(turnsFile) as { event?: string; where?: string; error?: string }[])
			: [];

		// A row on disk that nothing counted makes `/budget`'s own figure disagree with the file it describes.
		expect(
			rowsWrittenThisSession() - rowsBefore,
			"the rows-written counter must move exactly once per row the handler appended",
		).toBe(rows.length);

		return { notified, rows, cwd };
	});
}

describe("DIAG-06 — the /budget handler runs, and the skills tripwire is real", () => {
	it("notifies a rendered report carrying the rows-written and ground-truth lines", async () => {
		const { notified, rows } = await invoke();

		expect(
			notified.length,
			"the handler must reach `ctx.ui.notify`. Zero means it threw somewhere before it and Pi " +
				"routed the exception to `emitError`, which produces no visible output at all " +
				"[VERIFIED: pi 0.84.1 src/core/extensions/runner.ts:861-870] — a `/budget` that " +
				"silently does nothing is the exact ambiguity this subsystem exists to remove",
		).toBe(1);

		const first = notified[0];
		expect(first?.level, "a successful report is informational, not an error").toBe("info");

		expect(
			first?.text,
			`the rows-written line is how a dead instrument becomes visible rather than inferred; the ` +
				"count is the injected callback's return value, so this also proves the counter really " +
				"is passed through rather than recomputed",
		).toContain(`${ROWS_WRITTEN_LABEL}: 7`);

		expect(
			first?.text,
			"`getLastAssistantUsage` must have found the branch's assistant usage, or the only exact " +
				"token numbers in the report are missing and the estimates have nothing to be checked " +
				"against",
		).toContain("12725");

		expect(first?.text, "and they must be on their own labelled line").toContain(
			PROVIDER_REPORTED_LABEL,
		);

		expect(
			first?.text,
			"the active-tool intersection must EXCLUDE a registered-but-inactive tool. Only active " +
				"tools are serialised into `tools[]` on a request, so counting `bash` would over-state " +
				"the per-turn cost of a tool nobody is paying for",
		).not.toContain("bash");
		expect(
			first?.text,
			"the paired positive: the ACTIVE tool must be there, or the exclusion above is satisfied " +
				"by a report with no tool rows at all",
		).toContain("read");

		expect(
			rows,
			"nothing is written to disk on the success path. The report contains file PATHS, and a " +
				"persisted copy of it would be a copy of a user's global context-file layout " +
				"[threats T-02-10-01, T-02-10-06]",
		).toEqual([]);
	});

	// Mutation check: deleting the floor row from formatBudgetReport fails this test.
	it("prints the per-turn floor line from the same chars the other rows use", async () => {
		const { notified } = await invoke();
		const line = (notified[0]?.text ?? "").split(/\r?\n/).find((l) => l.includes(FLOOR_LABEL));
		expect(line, "the floor line must be rendered").toBeDefined();
		expect(line).toContain("~");
	});

	it("computes the floor from the char sum, rounded once", () => {
		const tools = [{ name: "ab", description: "cde", parameters: { a: 1 } }];
		const report = computeBudget({
			systemPrompt: "x".repeat(9),
			contextFiles: [],
			skills: [],
			skillsBlock: "",
			tools,
			lastUsage: undefined,
			rowsWritten: 0,
		});
		const toolChars = 2 + 3 + JSON.stringify({ a: 1 }).length;
		expect(report.floor.chars).toBe(9 + toolChars);
		expect(report.floor.estimatedTokens).toBe(estimateTokensFromChars(9 + toolChars));
	});

	it("cross-checks the recomputed skills block against a REAL sliced region", async () => {
		const { notified } = await invoke();
		const text = notified[0]?.text ?? "";

		// The precondition, asserted rather than assumed. Both prior tripwire
		// assertions in this repository compared an empty recomputed block against an
		// empty sliced region — `"".length === 0` — so they held no matter what Pi
		// emitted. This is what makes the check below non-vacuous.
		expect(
			REAL_SKILLS_BLOCK.length,
			"`formatSkillsForPrompt` returned an EMPTY block for a skill with " +
				"`disableModelInvocation: false`, so the cross-check below degenerates to `0 === 0` — " +
				"exactly the tautology this case exists to replace",
		).toBeGreaterThan(0);

		expect(
			REAL_SKILLS_BLOCK.startsWith(SKILLS_OPEN_MARKER),
			`Pi's own formatter no longer opens the block with the literal this module slices on. ` +
				"That is RESEARCH §7.3's tripwire firing: `/budget` has been attributing the whole " +
				"skills index to the base prompt ever since",
		).toBe(true);

		expect(
			REAL_SKILLS_BLOCK.endsWith(SKILLS_CLOSE_MARKER),
			"and the closing tag must still be the last thing in it, or the slice runs past the block",
		).toBe(true);

		expect(
			text,
			"WARNINGS must be absent. The handler recomputed the block with Pi's own formatter and " +
				"sliced the region out of a prompt that really contains that formatter's output, so a " +
				"divergence here means the markers and the formatter have drifted apart in the version " +
				"installed in node_modules — which is the whole claim `skillsBlockMatchesSlice` makes " +
				"and which no test in this repository previously exercised against a NON-EMPTY block",
		).not.toContain("WARNINGS");
	});
});

describe("DIAG-06 — the /budget failure path reports twice", () => {
	it("surfaces the error to the UI and leaves a diagnostics.error row", async () => {
		const { notified, rows } = await invoke({
			promptError: `prompt build failed with authorization Bearer ${SECRET_FIXTURE_TOKEN}`,
		});

		expect(
			notified.length,
			"the operator must see the failure NOW. Pi routes a thrown command handler to `emitError`, " +
				"which renders nothing, so without this the command looks like it worked",
		).toBe(1);
		expect(notified[0]?.level, "and it must be rendered as an error, not as a report").toBe("error");

		expect(
			rows.length,
			"and it must still be there TOMORROW. The catch path appends a row precisely so a failure " +
				"the operator dismissed is not lost [threat T-02-10-06]",
		).toBe(1);

		expect(rows[0]?.event, "the row identifies itself as a diagnostics failure").toBe(
			DIAGNOSTICS_ERROR_EVENT,
		);
		expect(
			rows[0]?.where,
			`the row must name ${BUDGET_COMMAND_WHERE}, or a reader knows the instrument failed but ` +
				"not which of the nine registrations did it",
		).toBe(BUDGET_COMMAND_WHERE);

		expect(
			rows[0]?.error?.includes(SECRET_FIXTURE_TOKEN),
			"`String(err)` routinely quotes the input that caused the failure, and that input may be a " +
				"`.env` the model just read. This repository is public [threat T-02-03-06]",
		).toBe(false);
		expect(
			(notified[0]?.text ?? "").includes(SECRET_FIXTURE_TOKEN),
			"the same redaction applies to the on-screen copy; a terminal scrollback is pasted into " +
				"issues",
		).toBe(false);
		expect(
			rows[0]?.error,
			"the paired positive: the non-secret half must survive, or the row says a command failed " +
				"and nothing about why",
		).toContain("prompt build failed");
	});

	it("still writes the row when the UI itself cannot render", async () => {
		const { rows } = await invoke({ promptError: "boom", notifyThrows: true });

		expect(
			rows.length,
			"the notify call is inside its own try precisely so a dead UI does not stop the row. " +
				"Losing both reports at once is the case where the failure is completely invisible",
		).toBe(1);
		expect(rows[0]?.where).toBe(BUDGET_COMMAND_WHERE);
	});

	it("reports 'no assistant turn yet' rather than a fabricated zero", async () => {
		const { notified } = await invoke({ branch: [] });

		expect(
			notified[0]?.text,
			"an empty branch must still print the ground-truth line, saying it has no data. Omitting " +
				"the line would leave a reader unable to tell `no data` from `zero tokens`",
		).toContain(PROVIDER_REPORTED_LABEL);

		expect(
			notified[0]?.text,
			"and it must not claim an input count. A defaulted 0 here is a fabricated measurement",
		).not.toContain("input 0 tokens");
	});
});
