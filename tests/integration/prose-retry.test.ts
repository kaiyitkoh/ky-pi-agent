/**
 * DIAG-05 — a prose tool call is detected, logged, and retried exactly once
 * inside a single agent run.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHAT IT IS NOT — read this before quoting a green run
 * ---------------------------------------------------------------------------
 * This file and `tests/unit/prose-detector.test.ts` are the two OFFLINE PROXIES
 * named by `RB-02-03`. Between them they prove the mechanism: that the predicate
 * classifies correctly (there) and that the harness really calls the model a
 * second time, once, inside one agent run, having executed nothing (here).
 *
 * They say **nothing whatsoever** about the question `RB-02-03` actually asks:
 * has the detector fired on real DeepSeek V4 Flash traffic, and at what rate.
 * That needs live credentials this machine does not have, and it stays
 * **OUTSTANDING**. Phase 10 discriminates between root causes using a measured
 * prose rate; a green run of this file is not that measurement and must never be
 * reported as one. The provider here is `fauxProvider` and every "prose tool
 * call" below was written by this test, not by a model.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE THIS REPRODUCES, EXECUTED DURING RESEARCH
 * ---------------------------------------------------------------------------
 * RESEARCH §6.3 recorded the retry working against a live in-memory session:
 * two `message_end` events, `callCount = 2`, a single `agent_end`, `pending = 0`
 * [VERIFIED: executed 2026-08-13]. Cases 1 and 2 are that observation turned
 * into a standing assertion, because an observation nobody re-runs is a claim
 * about the past.
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF ROW CARRY `event: prose_tool_call`, AND THE DIFFERENCE MATTERS
 * ---------------------------------------------------------------------------
 * A detected prose tool call leaves two marks in `turns-*.jsonl`:
 *
 *   1. The turn's OWN row (`kind: "turn"`), whose `event` records the verdict
 *      ALONGSIDE its `stopReason` — never instead of it (RESEARCH §3.3).
 *   2. A STANDALONE record with NO `kind`, written immediately from
 *      `message_end`, naming the matched tool. It exists so the event survives
 *      even if the turn row never lands — a handler throwing in `turn_end` is
 *      swallowed by Pi (runner.ts:861-870).
 *
 * So every count below filters on `kind` before it counts, through
 * {@link standalone} and {@link turnRows}. Counting bare `event` matches across
 * both shapes would make "exactly one retry" unassertable: the cap case
 * legitimately produces two turn rows carrying the verdict and exactly one
 * standalone record of each action.
 *
 * ---------------------------------------------------------------------------
 * THREE NEGATIVE CONTROLS, BECAUSE ONE WAS NOT ENOUGH
 * ---------------------------------------------------------------------------
 * The plan asked for one: a real tool call, narrated as well. It was written,
 * it passed — and deleting gate 2 from `prose.ts` left every case green
 * (falsification H), because a genuine tool call always stops for `toolUse` and
 * gate 1 rejected it first. Deleting gate 1 instead also left everything green
 * (falsification J), because gate 2 then caught it. Each gate was covering for
 * the other, so neither was tested.
 *
 * Cases 4b and 4c exist to break that symmetry: 4b is a CLEAN stop that
 * nonetheless carries a real tool call (gate 2 alone), 4c is the same prose text
 * on a turn the token limit cut short (gate 1 alone). Both were confirmed to
 * fail when their gate is removed. The same finding, in the same shape, as plan
 * 02-04's ninth negative — a guard no test can break is a guard that is not
 * there.
 *
 * ---------------------------------------------------------------------------
 * FIXTURE DISCIPLINE
 * ---------------------------------------------------------------------------
 * Every session enables the `read` tool. `isProseToolCall` refuses on an empty
 * active-tool list by design (gate 3), so a session with no tools would make
 * every case here vacuously "no prose detected" — a green file over a detector
 * that was never allowed to run. {@link toolsAreActive} asserts the precondition
 * directly rather than leaving it implied by the other cases passing.
 *
 * The extension loads at USER scope through `extensionPath` / `extensionSource`:
 * project-scoped `.pi/extensions` is gated behind project trust, which resolves
 * `false` headless with no UI to answer the prompt, and a silently absent
 * extension is a green run over nothing (RESEARCH §8.4).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssistantMessage, Context, FauxResponseStep } from "@earendil-works/pi-ai";
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
import { withFauxSession } from "../helpers/session.ts";

/** Absolute path of the diagnostics extension this repository ships. */
const EXTENSION_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;

/** The tool every session here activates, and the one the prose names. */
const TOOL = "read";

/** The file `read` would have opened, so the negative control's tool call succeeds. */
const NOTE = "note.txt";

/**
 * Where the probe writes the active-tool list Pi actually reported.
 *
 * WHY THIS FILE EXISTS. `Capture.activeTools` used to be the literal `[TOOL]`,
 * hardcoded by `drive()` — so the final `it` in this file was
 * `[TOOL].toContain(TOOL)` and could not fail even if `tools: [TOOL]` were dropped
 * from `withFauxSession`, which is precisely the condition it claims to guard.
 * Gate 3 refuses an empty active-tool list by design, so that removal would turn
 * every count in this file into a trivial zero while the guard stayed green — the
 * vacuous-pass shape this whole phase exists to eliminate, wearing the costume of
 * a precondition check.
 *
 * The value is now READ OUT OF THE LIVE SESSION, through the same
 * `pi.getActiveTools()` the detector itself calls. It goes through a file because
 * jiti gives the loaded extension its own module registry, so an in-process
 * variable this file could read would never move (02-05's finding).
 */
const ACTIVE_TOOLS_DUMP = "active-tools.json";

/**
 * A message that DESCRIBES a `read` call instead of emitting one.
 *
 * The name, an immediately-following `(` and a `{` — the whole of gate 4. It is
 * wrapped in explanation on both sides because that is what the failure looks
 * like in the wild: the model narrating its intention and then stopping.
 */
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
	/**
	 * The turns log EXACTLY as it reached disk.
	 *
	 * The parsed `rows` are what most cases assert on, but `RB-02-03` is a
	 * procedure the operator runs with `grep` over these bytes, so the case that
	 * checks the runbook's arithmetic has to see the bytes and not a reconstruction
	 * of them. A serialised-back-from-`rows` fixture would silently agree with any
	 * key order the runbook's fixed-string patterns depend on.
	 */
	logText: string;
}

/**
 * Read the turns log, failing with the remedy rather than an `ENOENT` stack.
 *
 * A missing file is what "the extension never loaded" looks like, and it is the
 * single most likely failure of this whole file.
 */
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

/**
 * The `cat .pi/logs/turns-*.jsonl | ...` one-liners `RB-02-03` tells the operator
 * to run, in the order the runbook numbers them.
 *
 * Read out of `docs/RUNBOOK.md` rather than retyped. The point of
 * {@link runbookPipeline} is to compute the operator's number from the runbook's
 * own text over a real log, so a retyped copy would only prove this file agrees
 * with itself.
 */
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
 * Run one of those one-liners against real log bytes and return its number.
 *
 * A faithful interpreter for exactly the four stage forms `RB-02-03` uses, and it
 * THROWS on anything else. That is deliberate: a rewrite of the runbook into a
 * shape this cannot read must fail loudly here, because the alternative is a
 * pipeline that silently computes nothing and a green test over it.
 *
 * `grep -F` semantics are plain substring matching on a whole line, which is
 * exactly what makes the trailing `"` in `'"event":"prose_tool_call"'` keep
 * `prose_tool_call_retry_exhausted` out of the count.
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

/**
 * A response step that records the outgoing context before answering.
 *
 * This is how the retry is proven to have REACHED the model rather than merely
 * been handed to `sendUserMessage`. `fauxProvider` accepts a factory in place of
 * a canned message and calls it with the request context
 * [pi-ai src/providers/faux.ts], so the assertion is on the bytes the second
 * call would have sent.
 */
function capturing(into: Context[], reply: AssistantMessage): FauxResponseStep {
	return ((context: Context): AssistantMessage => {
		into.push(context);
		return reply;
	}) as FauxResponseStep;
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
			// `extensionSource` rather than `extensionPath`: the probe IS the real
			// diagnostics extension plus the observers this file needs, and one of them
			// is what makes the active-tool precondition a measurement instead of a
			// literal. See {@link ACTIVE_TOOLS_DUMP}.
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
				// WHY THE BYTES AND NOT `producedPaths()`. Pi loads the extension
				// through jiti, which keeps its own module registry, so the `jsonl.ts`
				// instance that did the writing is not the one this file imported
				// (02-05's finding, re-confirmed in 02-07 and 02-08).
				rows: turns.records as Row[],
				unparseable: turns.unparseable,
				callCount: faux.state.callCount,
				pending: faux.getPendingResponseCount(),
				// OBSERVED, not asserted. See {@link ACTIVE_TOOLS_DUMP}.
				activeTools: readActiveTools(cwd),
				outgoing,
				logText: readFileSync(logPath(cwd, TURNS_LOG_BASE), "utf-8"),
			};
		},
	);
}

/**
 * An extension that IS the real diagnostics extension, plus two counters.
 *
 * Written inline rather than composed from two extension paths because
 * `createFauxSession` accepts one user-scope entry point and refuses both
 * options at once. The counters append to files in `cwd` rather than
 * incrementing a variable: jiti gives the loaded extension its own module
 * registry, so an in-process counter this file could read would never move.
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
		// THE ACTIVE-TOOL LIST AS PI REALLY REPORTS IT, read through the same
		// `pi.getActiveTools()` the detector's gate 3 reads. See
		// {@link ACTIVE_TOOLS_DUMP} for why this is observed rather than asserted
		// against a literal.
		'\tpi.on("turn_start", (_event, ctx) => {',
		`\t\twriteFileSync(join(ctx.cwd, ${JSON.stringify(ACTIVE_TOOLS_DUMP)}), JSON.stringify(pi.getActiveTools()), "utf-8");`,
		"\t});",
		"}",
		"",
	].join("\n");
}

/**
 * The active-tool list the live session reported, or `[]` when the probe never ran.
 *
 * `[]` on absence is deliberate and is the honest answer: an absent dump means no
 * `turn_start` fired, which means the extension did not load, which means the
 * detector was never active. Returning `[TOOL]` as a fallback would put the
 * tautology straight back.
 */
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
		// Case 1 / 5 — prose, then an ordinary answer. The second step CAPTURES the
		// outgoing context, which is what proves the follow-up reached the model.
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

		// Case 3 — THREE prose responses scripted, so the cap has something to hold
		// back. Two would prove the retry happened; three proves it stopped.
		capped = await drive({
			responses: [
				fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
				fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
				fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "stop" }),
			],
		});

		// Case 4 — the negative control: a REAL tool call whose text also narrates
		// it. Same words, same tool, genuine emission.
		control = await drive({
			responses: [
				fauxAssistantMessage([fauxText(PROSE_TEXT), fauxToolCall(TOOL, { path: NOTE })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage([fauxText(PLAIN_TEXT)], { stopReason: "stop" }),
			],
		});

		// Case 4b — the same real tool call, but reported with `stopReason: "stop"`.
		// This fixture exists because falsification H found that case 4 above is
		// held by GATE 1, not gate 2: a genuine tool call always stops for
		// `toolUse`, so removing "no toolCall block" from the predicate broke
		// nothing at this layer. Only a clean stop CARRYING a call isolates gate 2.
		stopWithCall = await drive({
			responses: [
				fauxAssistantMessage([fauxText(PROSE_TEXT), fauxToolCall(TOOL, { path: NOTE })], {
					stopReason: "stop",
				}),
				fauxAssistantMessage([fauxText(PLAIN_TEXT)], { stopReason: "stop" }),
			],
		});

		// Case 4c — the same prose text on a turn the token limit cut short.
		// Falsification J found that deleting gate 1 broke nothing either: cases 4
		// and 4b are both held by gate 2. A truncated turn is the shape that
		// isolates the stop reason.
		truncated = await drive({
			responses: [fauxAssistantMessage([fauxText(PROSE_TEXT)], { stopReason: "length" })],
		});

		// Case 6 — TWO prompts, so two agent runs, each opening with prose. This is
		// the only fixture that can see the `agent_start` reset.
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
		// THE PRECONDITION, ASSERTED RATHER THAN ASSUMED. If `PROSE_TEXT` stopped
		// matching — a tool rename, a tightened pattern — every case below would
		// report "no prose detected" and pass. That is the vacuous-pass shape this
		// whole phase exists to eliminate, and it is invisible from the assertions
		// themselves because they are all counting zero-or-one.
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

		// ALONGSIDE, NOT INSTEAD OF. RESEARCH §3.3 is explicit that the detector
		// verdict sits NEXT TO the provider's own word. `prose_tool_call` is this
		// project's interpretation; `stop` is what the provider said. A row that
		// replaced one with the other would destroy the evidence for the very
		// judgement it is recording. [threat T-02-09-03]
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
		// `sendUserMessage` returns void and swallows nothing visibly. Without this
		// assertion, case 1's `callCount === 2` proves a second request happened and
		// says nothing about whether it carried the nudge — a retry that re-sends
		// the identical context is a second roll of the same dice, not a correction.
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
		// WHY THIS IS NOT A DETAIL. `sendUserMessage` from `agent_settled` also
		// works (RESEARCH §6.5) and starts a NEW agent run. That would show up as a
		// spurious settled gap, a second `agent_start`, and `/session` accounting
		// that reports two runs where the user asked one question. It would also
		// break the cap: the counter resets on `agent_start`, so a retry that
		// started a new run could never be capped at all.
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

		// Both turns really were prose — the verdict is on both rows even though
		// only the first bought a retry. That is the intended asymmetry: the row
		// records what the turn WAS, the standalone records record what the harness
		// DID about it.
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
		// [WR-01R] THE RUNBOOK'S ARITHMETIC, MEASURED. Case 3 proves the log holds
		// two verdict rows and one retry action. This case proves the commands
		// `docs/RUNBOOK.md` hands the operator turn those bytes into the right
		// numbers, because the whole value of RB-02-03 is the ratio it produces and
		// an off-by-a-factor numerator read against a published ~11% baseline is
		// worse than no measurement: it looks like evidence.
		//
		// The `capped` session is the only fixture that can catch this. It is one
		// agent run with TWO prose turns and a cap of one, which is exactly the
		// shape where the verdict count and the action count diverge.
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
		// WITHOUT THIS CONTROL THE MEASURED RATE IS FICTION. A detector that fired
		// on every tool-using turn would look identical from the inside: rows
		// appear, retries happen, nothing errors. The unit table has this negative
		// too, against an inline fixture; here it is a real agent loop, with a real
		// tool execution in the middle, and the message the loop actually finalized.
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
		// GATE 2 IN ISOLATION, AND WHY IT NEEDED ITS OWN FIXTURE. Case 4 above is a
		// `stopReason: "toolUse"` turn, so gate 1 rejects it before gate 2 is ever
		// consulted: deleting gate 2 from `prose.ts` left all nine cases green
		// (falsification H). The predicate's docstring claims gate 2 rules out "the
		// model that actually emitted the call and merely narrated it as well", and
		// a claim no test can break is not a guarantee — that is the same finding
		// plan 02-04 recorded for the leading `\b`.
		//
		// This is not a contrived shape. `stopReason` is Pi's MAPPING of the
		// provider's `finish_reason` [pi-ai openai-completions.ts:462-464], and a
		// cheap OpenAI-compatible endpoint reporting `stop` on a response that
		// nonetheless carried `tool_calls` is precisely the class of provider
		// misbehaviour this harness exists for. The agent loop reads the content
		// blocks, not the stop reason, when deciding what to execute
		// [pi-agent-core agent-loop.ts:203], so the tool really runs here.
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
		// GATE 1 IN ISOLATION. Cases 4 and 4b are both held by gate 2, so deleting
		// the stop-reason check broke nothing (falsification J). This fixture is
		// the missing half: identical text, no tool call, `stopReason: "length"`.
		//
		// WHY IT MUST NOT FIRE. A truncated turn did not silently do less than it
		// claimed — it was cut off, visibly, and the fix is a larger `maxTokens` or
		// a compaction, not a re-prompt. Folding it into the prose rate would
		// inflate the number Phase 10 discriminates on with a failure that has a
		// different cause AND a different remedy, and the retry would spend a
		// second call re-truncating the same answer.
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
		// THE DIFFERENCE BETWEEN THE FOLLOW-UP RETRY AND THE REJECTED PROMOTION.
		// Promotion — returning `{ message }` from `message_end` with the parsed
		// prose turned into a real `toolCall` block — was executed during research
		// and works at zero extra model calls (RESEARCH §6.4). It is not built,
		// because it executes a tool whose arguments were regex-scraped out of
		// untrusted prose, on a laptop where merging to `main` auto-deploys and
		// Phase 4's command guard has not shipped. If it were ever built, this
		// turn's row would carry a tool call and a tool result — the research
		// output for the promotion path shows `toolResults: 1` on exactly this
		// turn. [threat T-02-09-01]
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
		// THE ONLY CASE THAT CAN SEE `agent_start`. Every other fixture here drives
		// ONE prompt, so a build that never reset `proseRetriesThisRun` would pass
		// all of them and then, in real use, retry the first prose call of the
		// session and silently log `prose_tool_call_retry_exhausted` for every one
		// after it — for the rest of the day. That failure has no error in it
		// anywhere and looks, in the log, exactly like a model that got worse.
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
		// THIS USED TO BE A TAUTOLOGY. `Capture.activeTools` was the literal `[TOOL]`,
		// written by `drive()` — so the assertion was `[TOOL].toContain(TOOL)` and
		// could not fail even if `tools: [TOOL]` were dropped from `withFauxSession`,
		// which is exactly the condition it claims to guard. Gate 3 refuses an empty
		// active-tool list, so that removal would make every count in this file a
		// trivial zero with this "precondition check" still green.
		//
		// The value now comes from `pi.getActiveTools()` inside the live session, read
		// back off disk because jiti gives the extension its own module registry.
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
