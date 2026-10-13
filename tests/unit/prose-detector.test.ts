/**
 * The prose-tool-call classifier in both directions, as a pure predicate over faux messages. A false positive costs an
 * extra call and inflates the measured prose rate, so negatives outnumber positives and include a real toolCall and a
 * mere mention of a tool name. Says nothing about live traffic, which is an outstanding runbook check.
 */
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	buildProseToolCallPattern,
	escapeRegExpLiteral,
	isProseToolCall,
	proseToolCallName,
} from "../../.pi/extensions/diagnostics/prose.ts";

/** Plausible active tools; `edit_file` exercises both the escaping and the leading `\b`. */
const ACTIVE = ["read", "write", "bash", "edit_file"] as const;

/** A finalized assistant message carrying only the given text. */
function textMessage(text: string, stopReason?: AssistantMessage["stopReason"]): AssistantMessage {
	return fauxAssistantMessage([fauxText(text)], stopReason ? { stopReason } : undefined);
}

// ---------------------------------------------------------------------------
// The positive table
// ---------------------------------------------------------------------------

interface ProseCase {
	label: string;
	text: string;
	/** The tool the model meant to call, which `proseToolCallName` must report. */
	name: string;
}

const PROSE: readonly ProseCase[] = [
	{
		label: "a bare call, exactly the shape DeepSeek-V3 #1244 describes",
		text: 'read({"path":"a.txt"})',
		name: "read",
	},
	{
		label: "the same call wrapped in explanation on both sides",
		text: 'I will now open the file. read({"path":"a.txt"}) That should show the failing assertion.',
		name: "read",
	},
	{
		label: "the name and the paren split across a newline",
		text: 'Here is the call:\n\nwrite\n({"path":"b.txt","content":"x"})',
		name: "write",
	},
	{
		label: "whitespace between the paren and the brace",
		text: 'bash(  {"cmd":"npm test"})',
		name: "bash",
	},
	{
		label: "a tool name containing an underscore, proving escaping and \\b both hold",
		text: 'edit_file({"path":"c.ts","old":"a","new":"b"})',
		name: "edit_file",
	},
];

// ---------------------------------------------------------------------------
// The negative table
// ---------------------------------------------------------------------------

interface NotProseCase {
	label: string;
	/** What this case protects — printed in the failure message. */
	protects: string;
	message: AssistantMessage;
	active?: readonly string[];
}

const NOT_PROSE: readonly NotProseCase[] = [
	{
		label: "a real tool call, narrated as well",
		protects:
			"a model that emitted the call AND explained it did its job; counting it would inflate the rate Phase 10 reads",
		message: fauxAssistantMessage([
			fauxText('Opening the file now with read({"path":"a.txt"}).'),
			fauxToolCall("read", { path: "a.txt" }, { id: "call_1" }),
		]),
	},
	{
		label: "a bare mention of a tool name",
		protects: "prose about a tool is not a failed call; this is the false positive that matters most",
		message: textMessage("You could read the file yourself, or ask me to."),
	},
	{
		label: "a mention followed by a paren but no brace",
		protects: "`read(path)` is pseudocode in an explanation, not an argument object the model tried to send",
		message: textMessage("The signature is read(path) and it returns the file contents."),
	},
	{
		label: "a call-shaped string in a message that stopped for toolUse",
		protects: "gate 1 — a toolUse stop is a different story with a different fix",
		message: textMessage('read({"path":"a.txt"})', "toolUse"),
	},
	{
		label: "a call-shaped string in a message truncated by the token limit",
		protects: "gate 1 — a length stop is a truncation bug, and folding it in here would inflate the rate",
		message: textMessage('read({"path":"a.txt"})', "length"),
	},
	{
		label: "a perfectly-shaped call evaluated with no active tools",
		protects: "gate 3 — with no registered names there is nothing the prose could be about, so any hit is a false positive",
		message: textMessage('read({"path":"a.txt"})'),
		active: [],
	},
	{
		label: "a call naming a tool nobody registered",
		protects: "the pattern is anchored to registered names; `deploy` is a word in a sentence, not a missed call",
		message: textMessage('deploy({"env":"prod"})'),
	},
	{
		label: "a longer identifier that merely ends with an active tool name",
		protects:
			"the leading \\b — without it `unread({...})` matches `read({...})`, and every helper, method and " +
			"variable in a printed code block whose name happens to end in a tool name becomes a false positive",
		message: textMessage('const cached = unread({"path":"a.txt"});'),
	},
	{
		label: "a message with no text blocks at all",
		protects: "an empty content list must not throw and must not classify",
		message: fauxAssistantMessage([]),
	},
];

// ---------------------------------------------------------------------------
// The tables, looped
// ---------------------------------------------------------------------------

describe("DIAG-05 — a described tool call is classified as one", () => {
	for (const testCase of PROSE) {
		it(`fires on ${testCase.label}`, () => {
			const message = textMessage(testCase.text);
			expect(
				isProseToolCall(message, ACTIVE),
				`this is the ~11% failure mode itself: finish_reason "stop", no toolCall block, ` +
					`and a call in content. Not firing means the turn silently did less than it claimed. Text: ${JSON.stringify(testCase.text)}`,
			).toBe(true);
			expect(
				proseToolCallName(message, ACTIVE),
				"the row and the retry prompt both name the tool; a verdict without a name is half a measurement",
			).toBe(testCase.name);
		});
	}
});

describe("DIAG-05 — everything that merely looks like one is not", () => {
	for (const testCase of NOT_PROSE) {
		it(`does not fire on ${testCase.label}`, () => {
			const active = testCase.active ?? ACTIVE;
			expect(isProseToolCall(testCase.message, active), testCase.protects).toBe(false);
			expect(
				proseToolCallName(testCase.message, active),
				"the two exports must never disagree about the same message",
			).toBeUndefined();
		});
	}
});

// ---------------------------------------------------------------------------
// The vacuous-pass guard
// ---------------------------------------------------------------------------

describe("DIAG-05 — the tables are actually populated and actually discriminate", () => {
	it("carries at least five positive and seven negative cases", () => {
		// A lint that only runs when data happens to exist is a lint nobody has
		// ever executed (`tests/unit/pinning.test.ts:259-262`).
		expect(PROSE.length, "the plan's floor is five positives").toBeGreaterThanOrEqual(5);
		expect(NOT_PROSE.length, "the plan's floor is seven negatives").toBeGreaterThanOrEqual(7);
	});

	it("has at least one case classifying each way", () => {
		const anyTrue = PROSE.some((c) => isProseToolCall(textMessage(c.text), ACTIVE));
		const anyFalse = NOT_PROSE.some((c) => !isProseToolCall(c.message, c.active ?? ACTIVE));
		expect(
			anyTrue,
			"a predicate proven only against negatives is a predicate that could always return false, " +
				"and it would report a prose rate of 0% forever",
		).toBe(true);
		expect(
			anyFalse,
			"a predicate proven only against positives is a predicate that could always return true, " +
				"and it would retry every turn in the session",
		).toBe(true);
	});

	it("keeps the real-toolCall and mention-only negatives in the table", () => {
		// Named, not counted: deleting either mandatory case would still satisfy the length floor.
		expect(NOT_PROSE.map((c) => c.label)).toContain("a real tool call, narrated as well");
		expect(NOT_PROSE.map((c) => c.label)).toContain("a bare mention of a tool name");
	});
});

// ---------------------------------------------------------------------------
// The pattern itself
// ---------------------------------------------------------------------------

describe("DIAG-05 — the matcher is anchored and bounded by construction", () => {
	it("refuses to build a pattern from an empty name list", () => {
		expect(
			buildProseToolCallPattern([]),
			"a pattern built from zero names is either useless or, once someone 'fixes' it, matches every code block ever printed",
		).toBeUndefined();
	});

	it("uses counted quantifiers rather than unbounded ones", () => {
		const source = buildProseToolCallPattern(ACTIVE)?.source ?? "";
		expect(source, "the pattern must exist before its shape can be asserted").not.toBe("");
		expect(source, "an unbounded whitespace run next to an alternation is the ReDoS shape (T-02-04-01)").not.toContain(
			"\\s*",
		);
		expect(source, "an unanchored .* on untrusted model output is the other ReDoS shape").not.toContain(".*");
		expect(source, "the gap between name, paren and brace must be a counted quantifier").toContain("{0,8}");
	});

	it("is stateless, so repeated calls agree", () => {
		// `redact.ts`'s patterns carry `g` and therefore a persistent lastIndex,
		// which makes every other `.test()` lie. This one must not.
		const message = textMessage('read({"path":"a.txt"})');
		expect(isProseToolCall(message, ACTIVE)).toBe(true);
		expect(isProseToolCall(message, ACTIVE), "a `g` flag crept in and lastIndex is now persisting").toBe(true);
	});

	it("escapes metacharacters in a tool name instead of splicing them in", () => {
		expect(escapeRegExpLiteral("a.b"), "an unescaped dot would match any character").toBe("a\\.b");
		expect(escapeRegExpLiteral("x|y"), "an unescaped pipe would add an alternative nobody registered").toBe("x\\|y");
		// The whole point, end to end: a name with a dot must not match a name
		// that merely has some other character where the dot is.
		const message = textMessage('axb({"k":1})');
		expect(isProseToolCall(message, ["a.b"]), "the dot in the registered name must be literal").toBe(false);
		expect(isProseToolCall(textMessage('a.b({"k":1})'), ["a.b"]), "and the real name must still match").toBe(true);
	});
});

// ---------------------------------------------------------------------------
// The bound
// ---------------------------------------------------------------------------

describe("DIAG-05 — the detector is bounded against a hostile message", () => {
	/** A repeated near-miss (name, whitespace, no paren): the backtracking worst case. */
	const UNIT = "read x write y bash z edit_file w ";

	it("classifies a 1 MB assistant message in under two seconds", () => {
		const adversarial = UNIT.repeat(Math.ceil(1_000_000 / UNIT.length));
		expect(adversarial.length, "the input must actually be about a megabyte").toBeGreaterThanOrEqual(1_000_000);
		const message = textMessage(adversarial);

		const start = Date.now();
		const verdict = isProseToolCall(message, ACTIVE);
		const elapsed = Date.now() - start;

		expect(
			elapsed,
			`isProseToolCall took ${elapsed} ms on a 1 MB message. An unbounded pattern on a large ` +
				"assistant message is a denial of service on the instrument itself — the detector runs " +
				"inside message_end on every single turn, so a hang here hangs the agent",
		).toBeLessThan(2000);

		expect(
			verdict,
			"the adversarial unit nearly matches and never completes; if it classified true the timing " +
				"above measured an early exit and proves nothing about backtracking",
		).toBe(false);
	});
});
