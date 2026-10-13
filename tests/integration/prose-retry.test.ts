/**
 * A prose tool call is detected, logged and retried exactly once inside one agent run. An offline proxy for runbook
 * RB-02-03: it proves the mechanism, never the live prose rate. A detection leaves a `kind: "turn"` row and a
 * kind-less standalone record, so every count filters on `kind`. Cases 4b and 4c each isolate one gate, which the
 * other would otherwise cover for. Every session activates `read`, since gate 3 refuses an empty tool list.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Context, FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { beforeAll, describe, expect, it } from "vitest";

import { logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { isProseToolCall } from "../../.pi/extensions/diagnostics/prose.ts";
import {
	MAX_PROSE_RETRIES,
	PROSE_EVENT,
	PROSE_EXHAUSTED_EVENT,
	PROSE_RETRY_PROMPT,
	TURNS_LOG_BASE,
} from "../../.pi/extensions/diagnostics/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { readTornSafe } from "../helpers/logs.ts";
import { capturing } from "../helpers/faux.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Absolute path of the diagnostics extension this repository ships. */
const EXTENSION_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;

/** The tool every session here activates, and the one the prose names. */
const TOOL = "read";

/** The file `read` would have opened, so the negative control's tool call succeeds. */
const NOTE = "note.txt";

/** Where the probe writes the active-tool list read live from `pi.getActiveTools()`, so the precondition is measured. */
const ACTIVE_TOOLS_DUMP = "active-tools.json";

/** A message that describes a `read` call instead of emitting one, wrapped in narration as in the wild. */
const PROSE_TEXT = `I'll open the file for you. read({"path":"${NOTE}"}) — one moment.`;

/** A perfectly ordinary reply, carrying nothing the detector could match. */
const PLAIN_TEXT = "The note says hi.";

/** The row shape this file asserts on. Nothing here is retyped from a literal. */
interface Row {
	ts?: number;
	/** `"turn"` on a composed turn row; ABSENT on a standalone event record. */
	kind?: string;
	event?: string;
	/** The tool the model meant to call, on a standalone prose record. */
	tool?: string;
	sessionId?: string;
	corr?: string;
	stopReason?: string;
	outcome?: string;
	toolCalls?: number;
	toolResults?: number;
	turnIndex?: number;
	where?: string;
}

/** What one driven session produced. */
interface Capture {
	rows: Row[];
	unparseable: string[];
	callCount: number;
	pending: number;
	/** The active tool names as the extension would have seen them. */
	activeTools: string[];
	/** Every outgoing context a capturing response step recorded. */
	outgoing: Context[];
	/** The turns log bytes as written, because the runbook's grep pipeline depends on them. */
	logText: string;
}

/** Reads the turns log; a missing file means the extension never loaded. */
function readTurns(cwd: string): { records: unknown[]; unparseable: string[] } {
	const file = logPath(cwd, TURNS_LOG_BASE);
	if (!existsSync(file)) {
		throw new Error(
			`${file} does not exist: the session wrote no turns log at all. The likeliest cause is ` +
				"the diagnostics extension not loading — it must sit at USER scope, which is what " +
				"`extensionPath` in tests/helpers/session.ts arranges, because project-scoped " +
				"`.pi/extensions` is gated behind project trust and that resolves false headless.",
		);
	}
	return readTornSafe(file);
}

/** Standalone out-of-band records carrying `event`. These have NO `kind`. */
function standalone(capture: Capture, event: string): Row[] {
	return capture.rows.filter((row) => row.kind === undefined && row.event === event);
}

/** Composed per-turn rows. These always carry `kind: "turn"`. */
function turnRows(capture: Capture): Row[] {
	return capture.rows.filter((row) => row.kind === "turn");
}

/** RB-02-03's one-liners, read from docs/RUNBOOK.md rather than retyped, in runbook order. */
function runbookCountingCommands(): string[] {
	const runbook = readFileSync(join(repoRoot(), "docs", "RUNBOOK.md"), "utf-8");
	const section = runbook.slice(runbook.indexOf("### RB-02-03"));
	const nextHeading = section.indexOf("\n### ");
	const body = nextHeading === -1 ? section : section.slice(0, nextHeading);
	return Array.from(body.matchAll(/`(cat \.pi\/logs\/turns-[^`]+)`/g)).map(
		(match) => match[1] as string,
	);
}

/**
 * Runs one of those one-liners over real log bytes. Interprets exactly the four stage forms the runbook uses and throws
 * on anything else, so a rewritten runbook fails loudly. `grep -F` is whole-line substring matching.
 */
function runbookPipeline(command: string, logText: string): number {
	const stages = command.split("|").map((stage) => stage.trim());
	let lines = logText.split("\n").filter((line) => line !== "");
	let count: number | undefined;

	for (const stage of stages) {
		if (count !== undefined) {
			throw new Error(`stage ${JSON.stringify(stage)} follows a stage that already produced a count`);
		}
		if (/^cat \.pi\/logs\/turns-[^\s]+$/.test(stage)) {
			continue;
		}
		const counting = /^grep -cF '(.+)'$/.exec(stage);
		if (counting) {
			count = lines.filter((line) => line.includes(counting[1] as string)).length;
			continue;
		}
		const keep = /^grep -F '(.+)'$/.exec(stage);
		if (keep) {
			lines = lines.filter((line) => line.includes(keep[1] as string));
			continue;
		}
		const drop = /^grep -v '(.+)'$/.exec(stage);
		if (drop) {
			lines = lines.filter((line) => !line.includes(drop[1] as string));
			continue;
		}
		if (stage === "wc -l") {
			count = lines.length;
			continue;
		}
		throw new Error(
			`RB-02-03 stage ${JSON.stringify(stage)} is not a shape this interpreter understands, so ` +
				"the runbook's arithmetic is no longer being checked against a real log. Teach the " +
				"interpreter the new stage rather than deleting the case.",
		);
	}

	if (count === undefined) {
		throw new Error(`RB-02-03 command ${JSON.stringify(command)} produced no number at all`);
	}
	return count;
}

/** Drive one session to completion and hand back everything worth asserting on. */
async function drive(options: {
	responses: FauxResponseStep[];
	prompts?: string[];
	outgoing?: Context[];
}): Promise<Capture> {
	const outgoing = options.outgoing ?? [];
	return await withFauxSession(
		{
			// The probe is the real diagnostics extension plus observers, one of which measures the active tools.
			extensionSource: probeSource(),
			responses: options.responses,
			tools: [TOOL],
			cwdFiles: { [NOTE]: "hi\n" },
		},
		async ({ session, faux, cwd }) => {
			for (const prompt of options.prompts ?? ["read the note"]) {
				await session.prompt(prompt);
			}
			const turns = readTurns(cwd);
			return {
				// Read the bytes: jiti gives the extension its own module registry, so its jsonl.ts is not this file's.
				rows: turns.records as Row[],
				unparseable: turns.unparseable,
				callCount: faux.state.callCount,
				pending: faux.getPendingResponseCount(),
				activeTools: readActiveTools(cwd),
				outgoing,
				logText: readFileSync(logPath(cwd, TURNS_LOG_BASE), "utf-8"),
			};
		},
	);
}

/**
 * The real diagnostics extension plus two counters, inline because createFauxSession takes one user-scope entry. The
 * counters append to files: jiti gives the extension its own module registry.
 */
function probeSource(): string {
	return [
		'import { appendFileSync, writeFileSync } from "node:fs";',
		'import { join } from "node:path";',
		`import diagnostics from ${JSON.stringify(EXTENSION_ENTRY.replace(/\\/g, "/"))};`,
		"export default function (pi) {",
		"\tdiagnostics(pi);",
		'\tpi.on("agent_end", (_event, ctx) => {',
		'\t\tappendFileSync(join(ctx.cwd, "agent-end.count"), "x\\n");',
		"\t});",
		'\tpi.on("agent_start", (_event, ctx) => {',
		'\t\tappendFileSync(join(ctx.cwd, "agent-start.count"), "x\\n");',
		"\t});",
		// Read through the same `pi.getActiveTools()` gate 3 uses.
		'\tpi.on("turn_start", (_event, ctx) => {',
		`\t\twriteFileSync(join(ctx.cwd, ${JSON.stringify(ACTIVE_TOOLS_DUMP)}), JSON.stringify(pi.getActiveTools()), "utf-8");`,
		"\t});",
		"}",
		"",
	].join("\n");
}

/** The active-tool list the live session reported, or `[]` when the probe never ran (no fallback to `[TOOL]`). */
function readActiveTools(cwd: string): string[] {
	const file = join(cwd, ACTIVE_TOOLS_DUMP);
	if (!existsSync(file)) {
		return [];
	}
	return JSON.parse(readFileSync(file, "utf-8")) as string[];
}

/** How many lines the named probe counter file holds. Absent counts as zero. */
function probeCount(cwd: string, name: string): number {
	const file = join(cwd, name);
	if (!existsSync(file)) {
		return 0;
	}
	return readFileSync(file, "utf-8").split("\n").filter((line) => line !== "").length;
}

let retried: Capture;
let capped: Capture;
let control: Capture;
let stopWithCall: Capture;
let truncated: Capture;
let twoRuns: Capture;
const retryOutgoing: Context[] = [];

describe("DIAG-05 — the prose retry, on a live session", () => {
	beforeAll(async () => {
		// Prose, then an ordinary answer; the second step captures the context the follow-up sent.
		retried = await drive({
			outgoing: retryOutgoing,
			responses: [
				fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
				capturing(
					retryOutgoing,
					fauxAssistantMessage([fauxText(PLAIN_TEXT)], { stopReason: "stop" }),
				),
			],
		});

		// Three prose responses: two prove the retry happened, three prove it stopped.
		capped = await drive({
			responses: [
				fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
				fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
				fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
			],
		});

		// Negative control: a real tool call whose text also narrates it.
		control = await drive({
			responses: [
				fauxAssistantMessage([fauxText(PROSE_TEXT), fauxToolCall(TOOL, { path: NOTE })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage([fauxText(PLAIN_TEXT)], { stopReason: "stop" }),
			],
		});

		// A real tool call with `stopReason: "stop"`, which isolates gate 2 (case 4 is held by gate 1).
		stopWithCall = await drive({
			responses: [
				fauxAssistantMessage([fauxText(PROSE_TEXT), fauxToolCall(TOOL, { path: NOTE })], {
					stopReason: "stop",
				}),
				fauxAssistantMessage([fauxText(PLAIN_TEXT)], { stopReason: "stop" }),
			],
		});

		// The prose text on a turn the token limit cut short, which isolates gate 1.
		truncated = await drive({
			responses: [fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "length" })],
		});

		// Two prompts, so two agent runs: the only fixture that sees the `agent_start` reset.
		twoRuns = await drive({
			prompts: ["read the note", "read it again"],
			responses: [
				fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
				fauxAssistantMessage([fauxText(PLAIN_TEXT)], { stopReason: "stop" }),
				fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
				fauxAssistantMessage([fauxText(PLAIN_TEXT)], { stopReason: "stop" }),
			],
		});
	});

	it("the fixture really is a prose tool call, and really is not one without tools", () => {
		// If PROSE_TEXT stopped matching, every case would count zero and pass.
		const message = fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" });
		expect(
			isProseToolCall(message, [TOOL]),
			"the fixture text is no longer classified as a prose tool call, so every session below " +
				"drives a detector that cannot fire and every count is trivially zero",
		).toBe(true);
		expect(
			isProseToolCall(message, []),
			"gate 3 must refuse an empty active-tool list. This is why every session here enables " +
				`\`${TOOL}\`: without it the detector is off and this file measures nothing`,
		).toBe(false);
	});

	it("case 1 — the detector fires and the model is called a second time", () => {
		expect(
			retried.unparseable,
			"a line of the turns log could not be parsed as JSON. The writer is open-write-close per " +
				"record precisely so this cannot happen from a single process",
		).toEqual([]);

		expect(
			retried.callCount,
			"the provider was not called twice. This is the whole of DIAG-05's effect half: the " +
				"detector may classify perfectly and still change nothing, and a turn that was logged " +
				"as prose and then left alone is exactly the silent under-delivery this harness exists " +
				"to survive. RESEARCH §6.3 recorded callCount = 2 against a live session on 2026-08-13; " +
				"a 1 here means `sendUserMessage` never reached the agent loop's follow-up resumption " +
				"point (pi-agent-core agent-loop.ts:262-268)",
		).toBe(2);

		const events = standalone(retried, PROSE_EVENT);
		expect(
			events.length,
			`exactly one standalone \`${PROSE_EVENT}\` record must exist for one prose turn. Zero ` +
				"means the event was never recorded out of band and Phase 10's rate would be computed " +
				"from turn rows alone — which vanish if `turn_end` throws, because Pi swallows the " +
				"exception (runner.ts:861-870). More than one means the handler fired twice for one " +
				"message and the measured rate is inflated",
		).toBe(1);

		expect(
			events[0]?.tool,
			`the record does not name \`${TOOL}\` as the tool the model meant to call. That column is ` +
				"what Phase 10 groups by — 'which tool does the cheap model fail to call?' is a " +
				"different and more actionable question than 'how often does it fail'",
		).toBe(TOOL);

		expect(
			events[0]?.corr,
			"the standalone record carries no correlation id, so it cannot be joined to the wire " +
				"bytes that produced it and nobody can ever see what was actually sent on a prose turn",
		).toBeDefined();

		const rows = turnRows(retried);
		expect(
			rows.length,
			"one prompt plus one retry is TWO turns inside one agent run, so two turn rows. One means " +
				"the retry turn went unrecorded; three means a row is being appended from `message_end` " +
				"as well as `turn_end`, which would double every per-turn total Phase 8 computes",
		).toBe(2);

		const prose = rows[0] as Row;
		expect(
			prose.event,
			"the prose turn's OWN row does not carry the verdict. The standalone record above is a " +
				"backstop, not the primary: a reader scanning turn rows for 'what happened on this " +
				"turn' must see it there",
		).toBe(PROSE_EVENT);

		// The verdict sits alongside the provider's stopReason, never instead of it.
		expect(
			prose.stopReason,
			"the prose row's `stopReason` was overwritten by the event. The two columns answer " +
				"different questions and a reader must be able to disagree with the verdict without " +
				"losing the provider's own word (RESEARCH §3.3)",
		).toBe("stop");
		expect(
			prose.outcome,
			"`outcome` must still be the mapping of `stopReason`, untouched by the detector",
		).toBe("ok");

		expect(
			rows[1]?.event,
			"the RETRY turn is marked as a prose tool call too, but its response was ordinary text. " +
				"Either the accumulator is not cleared between turns or the verdict is being carried " +
				"forward, and the measured prose rate would be exactly double the real one",
		).toBeUndefined();
	});

	it("case 1b — the retry prompt actually reached the model", () => {
		// A second request alone does not prove the nudge was sent; re-sending the same context corrects nothing.
		expect(
			retryOutgoing.length,
			"the capturing response step never ran, so there was no second request to inspect and " +
				"this case would assert nothing",
		).toBeGreaterThan(0);

		const text = JSON.stringify(retryOutgoing[0]?.messages ?? []);
		expect(
			text.includes(PROSE_RETRY_PROMPT),
			"the retry request did not carry PROSE_RETRY_PROMPT. The follow-up is the entire " +
				"intervention: without it the second call is the same prompt asked twice",
		).toBe(true);

		const users = (retryOutgoing[0]?.messages ?? []).filter((m) => m.role === "user");
		expect(
			users.length,
			"the follow-up must arrive as a USER message — the strongest instruction channel " +
				"available. `sendMessage` with a customType is renderable but is a weaker prompt " +
				"(RESEARCH §6.5), and this is the assertion that would notice the swap",
		).toBe(2);
	});

	it("case 2 — one agent run, not two", async () => {
		// One agent run: a retry from `agent_settled` would start a new run, miscount sessions and escape the cap.
		await withFauxSession(
			{
				extensionSource: probeSource(),
				tools: [TOOL],
				cwdFiles: { [NOTE]: "hi\n" },
				responses: [
					fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
					fauxAssistantMessage([fauxText(PLAIN_TEXT)], { stopReason: "stop" }),
				],
			},
			async ({ session, faux, cwd }) => {
				await session.prompt("read the note");

				expect(
					faux.state.callCount,
					"the probe session did not retry at all, so counting its agent runs proves nothing. " +
						"The inline probe extension must call the real diagnostics default export",
				).toBe(2);

				expect(
					probeCount(cwd, "agent-end.count"),
					"the retry produced a second `agent_end`, so it started a NEW agent run instead of " +
						"resuming the current one. RESEARCH §6.3 observed exactly one agent_end for the " +
						"pair. A new run breaks `/session` accounting and, worse, resets the retry " +
						"counter — the cap in case 3 would never bite again",
				).toBe(1);

				expect(
					probeCount(cwd, "agent-start.count"),
					"more than one `agent_start` for a single prompt. That hook is where " +
						"`proseRetriesThisRun` is reset, so a second one mid-run hands the detector a " +
						"fresh budget on every retry and the cap becomes decorative",
				).toBe(1);
			},
		);
	});

	it("case 3 — the cap holds: one retry against three prose responses", () => {
		expect(capped.unparseable, "a line of the cap-session turns log could not be parsed").toEqual(
			[],
		);

		expect(
			MAX_PROSE_RETRIES,
			"this case is written against a cap of one. If the constant moves, the arithmetic below " +
				"(2 calls, 1 event, 1 exhaustion) is wrong and must be rewritten rather than relaxed",
		).toBe(1);

		expect(
			capped.callCount,
			"three prose responses were scripted and the provider was called more than twice, so the " +
				"cap did not hold. An uncapped detector pointed at a model that RELIABLY writes prose " +
				"— which is the documented DeepSeek failure mode this whole harness exists for, near " +
				"11% on issue #1244 — is an unbounded spend, and every iteration of the loop looks " +
				"like an ordinary extra turn in the log [threat T-02-09-02]",
		).toBe(2);

		expect(
			capped.pending,
			"the third scripted response must still be unconsumed. This is the same fact as the " +
				"count above, read from the other end: the run STOPPED rather than continuing to draw " +
				"on the script",
		).toBe(1);

		expect(
			standalone(capped, PROSE_EVENT).length,
			`exactly one standalone \`${PROSE_EVENT}\` record: one retry was spent, so one action was ` +
				"taken. Two would mean the second prose turn also paid for a call",
		).toBe(1);

		const exhausted = standalone(capped, PROSE_EXHAUSTED_EVENT);
		expect(
			exhausted.length,
			`exactly one \`${PROSE_EXHAUSTED_EVENT}\` record. Zero means the harness gave up SILENTLY ` +
				"— indistinguishable in the log from a turn where the detector simply did not fire, " +
				"and the second prose response is the more interesting datum of the two: it says the " +
				"nudge did not work",
		).toBe(1);

		expect(
			exhausted[0]?.tool,
			"the exhaustion record must name the tool too, or 'the retry did not help' is recorded " +
				"without recording what it was trying to fix",
		).toBe(TOOL);

		// Both rows carry the verdict (what the turn was); the standalone records show what the harness did.
		const rows = turnRows(capped);
		expect(
			rows.length,
			"two turns, two rows. The exhausted turn is still a turn and must still be recorded",
		).toBe(2);
		expect(
			rows.filter((row) => row.event === PROSE_EVENT).length,
			"both turn rows must carry the verdict: both messages WERE prose tool calls, regardless " +
				"of which one the harness could still afford to answer. Marking only the retried one " +
				"would under-report the prose rate by exactly the turns where the problem is worst",
		).toBe(2);
	});

	it("case 3b — RB-02-03's own commands, run over the capped session's real log", () => {
		// The runbook's commands turn these bytes into the right numbers. Only the capped session (two prose turns, one
		// retry) separates the verdict count from the action count.
		const commands = runbookCountingCommands();
		expect(
			commands.length,
			"RB-02-03 must carry four `cat .pi/logs/turns-*.jsonl` one-liners: numerator, denominator, " +
				"retries issued, retries refused. Fewer means a step was dropped and this case is " +
				"silently checking a shorter procedure than the operator will run",
		).toBe(4);

		const [numerator, denominator, issued, refused] = commands as [string, string, string, string];

		expect(
			runbookPipeline(numerator, capped.logText),
			`step 1 (${numerator}) must count BOTH prose turns. This is the defect WR-01R names: the ` +
				"kind-less action record is written only when a retry was actually issued, and the cap " +
				"is one per agent run, so counting those records reports 1 where the truth is 2 — a " +
				"halved rate, which against a published ~11% baseline reads as refutation of the " +
				"leading root-cause hypothesis",
		).toBe(2);

		expect(
			runbookPipeline(denominator, capped.logText),
			`step 2 (${denominator}) is the denominator and must count the turns, not the records`,
		).toBe(2);

		const issuedCount = runbookPipeline(issued, capped.logText);
		const refusedCount = runbookPipeline(refused, capped.logText);

		expect(
			issuedCount,
			`step 3 (${issued}) is the retries ISSUED. One retry was affordable, so exactly one`,
		).toBe(1);
		expect(
			refusedCount,
			`step 4 (${refused}) is the retries REFUSED. The second prose turn hit the cap`,
		).toBe(1);

		expect(
			issuedCount + refusedCount,
			"the reconciliation identity RB-02-03 states — retries issued + retries refused = prose " +
				"turn rows — must hold on a real log. It is the only thing that makes a turn whose " +
				"`event` slot was taken by the degraded-cost marker visible instead of silent",
		).toBe(runbookPipeline(numerator, capped.logText));

		expect(
			issuedCount,
			"and the two numbers must genuinely DISAGREE on this fixture, or this case would pass " +
				"just as happily with the old, halved numerator pinned in the runbook",
		).not.toBe(runbookPipeline(numerator, capped.logText));
	});

	it("case 4 — a genuine tool call, narrated as well, does not fire the detector", () => {
		// Without this control a detector firing on every tool-using turn would look identical from the inside.
		expect(control.unparseable, "a line of the control turns log could not be parsed").toEqual([]);

		expect(
			standalone(control, PROSE_EVENT).length,
			"the detector fired on a turn that emitted a REAL tool call and merely narrated it as " +
				"well. Gate 2 exists for exactly this message. Every prose rate this project ever " +
				"reports would be inflated by the tool-using turns, which are the majority of the " +
				"interesting ones [threat T-02-09-03]",
		).toBe(0);

		expect(
			standalone(control, PROSE_EXHAUSTED_EVENT).length,
			"an exhaustion record on a session where the detector must never have fired",
		).toBe(0);

		const rows = turnRows(control);
		expect(
			rows.length,
			"a tool call produces two turns — the call, then the answer after the result. Fewer means " +
				"the control did not exercise the tool loop at all and proves nothing about it",
		).toBe(2);

		expect(
			rows[0]?.toolCalls ?? 0,
			"the control's first turn recorded no tool call, so the fixture did not do the one thing " +
				"it exists to do and the negative above is trivially true",
		).toBeGreaterThanOrEqual(1);

		expect(
			rows[0]?.toolResults ?? 0,
			"the tool never executed, so this is not a control over a genuine tool-using turn",
		).toBeGreaterThanOrEqual(1);

		expect(
			rows.some((row) => row.event === PROSE_EVENT),
			"a control turn row carries the prose verdict",
		).toBe(false);

		expect(
			control.callCount,
			"two calls is the ordinary tool loop: request, tool result, answer. A third would mean a " +
				"retry was injected on top of a turn that did its job",
		).toBe(2);
	});

	it("case 4b — a clean stop that nonetheless carries a real tool call", () => {
		// Gate 2 alone: a clean stop that still carries a tool call. Realistic, since stopReason maps the provider's
		// finish_reason while the agent loop executes the content blocks (pi-agent-core agent-loop.ts:203).
		expect(stopWithCall.unparseable, "a line of the 4b turns log could not be parsed").toEqual([]);

		const rows = turnRows(stopWithCall);
		expect(
			rows[0]?.toolCalls ?? 0,
			"the fixture's first turn carries no tool call, so it is not the shape this case is about " +
				"and the negative below is held by gate 1 again rather than gate 2",
		).toBeGreaterThanOrEqual(1);
		expect(
			rows[0]?.stopReason,
			"the fixture must report a CLEAN stop. If Pi normalised it to `toolUse` this case has " +
				"silently become a duplicate of case 4 and isolates nothing",
		).toBe("stop");

		expect(
			standalone(stopWithCall, PROSE_EVENT).length,
			"the detector fired on a message that emitted a REAL tool call. Gate 2 — no content block " +
				'of type "toolCall" — is the only thing standing between this message and a wasted ' +
				"model call, because the provider reported a clean stop. A model that did its job and " +
				"also explained itself must never be retried [threat T-02-09-03]",
		).toBe(0);

		expect(
			rows.some((row) => row.event === PROSE_EVENT),
			"a turn row of the 4b fixture carries the prose verdict",
		).toBe(false);
	});

	it("case 4c — a turn cut short by the token limit is a different failure", () => {
		// Gate 1 alone: a truncated turn must not fire. Its remedy is a larger maxTokens or compaction, and counting it
		// would inflate the prose rate with a different failure.
		expect(truncated.unparseable, "a line of the 4c turns log could not be parsed").toEqual([]);

		const rows = turnRows(truncated);
		expect(
			rows[0]?.stopReason,
			"the fixture must report `length`, or it is not testing the stop-reason gate at all",
		).toBe("length");
		expect(
			rows[0]?.toolCalls ?? -1,
			"the fixture must carry NO tool call, or gate 2 rejects the message first and gate 1 is " +
				"once again untested",
		).toBe(0);

		expect(
			standalone(truncated, PROSE_EVENT).length,
			"the detector fired on a turn the token limit cut short. Only a CLEAN stop can be a " +
				"silently incomplete turn; `length`, `error` and `aborted` are loud failures with " +
				"different remedies, and counting them here fabricates the prose rate " +
				"[threat T-02-09-03]",
		).toBe(0);

		expect(
			truncated.callCount,
			"a truncated turn was retried. That is a second call spent re-running into the same " +
				"token limit",
		).toBe(1);
	});

	it("case 5 — nothing was executed on the model's behalf", () => {
		// The follow-up retry, not promotion: promoting scraped prose into a real toolCall would execute untrusted
		// arguments, so this turn must carry no tool call or result.
		const prose = turnRows(retried)[0] as Row;

		expect(
			prose.toolCalls,
			"the prose turn's row records a tool call. `toolCalls` counts " +
				'`content[].type === "toolCall"` on the FINALIZED message, so a non-zero value here ' +
				"means something added a block to a message the model never emitted one in — which is " +
				"the promotion path, and the harness executing a tool on the model's behalf",
		).toBe(0);

		expect(
			prose.toolResults,
			"the prose turn executed a tool. The retry is a follow-up USER MESSAGE; it runs nothing " +
				"and can run nothing. A `1` here is a tool invoked with arguments parsed out of prose",
		).toBe(0);

		expect(
			prose.turnIndex,
			"the prose turn must be the first of the run; the retry is the second. If it is not, the " +
				"two rows are the wrong way round and every assertion above reads the wrong turn",
		).toBe(0);
	});

	it("case 6 — the retry budget is per agent run, and really is reset", () => {
		// The only fixture that sees `agent_start`: without the reset, every prose call after the first in a session
		// would log retry_exhausted silently.
		expect(twoRuns.unparseable, "a line of the two-run turns log could not be parsed").toEqual([]);

		expect(
			twoRuns.callCount,
			"two prompts, each answered first with prose, must cost four provider calls: prompt, " +
				"retry, prompt, retry. Three means the second run inherited a spent budget and the " +
				"reset on `agent_start` is missing or was swallowed",
		).toBe(4);

		expect(
			standalone(twoRuns, PROSE_EVENT).length,
			"both runs must record a retry. One means the second prose call was detected and then " +
				"abandoned",
		).toBe(2);

		expect(
			standalone(twoRuns, PROSE_EXHAUSTED_EVENT).length,
			"no run here spent more than its single retry, so nothing may be recorded as exhausted. " +
				"An exhaustion record is precisely what a missing reset would produce on the second run",
		).toBe(0);

		expect(
			turnRows(twoRuns).length,
			"two prompts with one retry each is four turns and four rows",
		).toBe(4);
	});

	it("every session really had the tool active, as Pi itself reported it", () => {
		// Measured, not a literal: gate 3 refuses an empty list, so dropping `tools: [TOOL]` must turn this red.
		for (const capture of [retried, capped, control, stopWithCall, truncated, twoRuns]) {
			expect(
				capture.activeTools,
				`each session must enable \`${TOOL}\`, and this reads what Pi REPORTED rather than what ` +
					"this file passed in. The detector's gate 3 returns false on an empty active-tool " +
					"list, so a session without tools is a detector that cannot fire and every " +
					"zero-or-one count above is trivially satisfied. An empty array here also means the " +
					"probe never saw a `turn_start`, i.e. the extension did not load at all",
			).toContain(TOOL);
		}
	});
});
