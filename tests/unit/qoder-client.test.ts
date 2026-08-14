/**
 * ky-pi-agent — the Qoder client's refusal path and SSE parser, proven
 * offline. (ROUTE-11)
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT. Every case below runs against
 * `.pi/extensions/qoder/client.ts`'s pure exports with no network, no
 * mutation of the real process environment (the config resolver takes an
 * injected environment object) and no filesystem write. It proves the harness PARSES a Qoder
 * session-and-event-stream envelope correctly and REFUSES actionably when
 * required configuration is absent or malformed. It proves NOTHING about
 * what `api.qoder.com` actually sends for a real PAT and a real
 * `agent_id`/`environment_id` -- that is `RB-05-01` in `docs/RUNBOOK.md`,
 * and it is OUTSTANDING by construction until run by hand on the work
 * laptop. Nothing in this file may be read as discharging it.
 */
import { describe, expect, it } from "vitest";
import {
	DEFAULT_QODER_BASE_URL,
	foldDelegatedResult,
	parseSseFrames,
	QODER_AGENT_ID_ENV,
	QODER_BASE_URL_ENV,
	QODER_ENVIRONMENT_ID_ENV,
	QODER_TOKEN_ENV,
	resolveQoderConfig,
	type SseFrame,
} from "../../.pi/extensions/qoder/client.ts";

// -----------------------------------------------------------------------------
// The RESEARCH C.3 sample, verbatim -- one blank-line-terminated frame per
// block, in the exact order the docs page showed them.
// -----------------------------------------------------------------------------

const THINKING_START =
	'id: evt_00jjujk9fbnr55q5rtyp\n' +
	"event: event_start\n" +
	'data: {"event":{"id":"evt_00jjujk9fbnr55q5rtyp","type":"agent.thinking"},"type":"event_start"}\n';

const MESSAGE_START =
	'id: evt_00jjujk9fbnr4wkj2gh8\n' +
	"event: event_start\n" +
	'data: {"event":{"id":"evt_00jjujk9fbnr4wkj2gh8","type":"agent.message"},"type":"event_start"}\n';

const MESSAGE_DELTA =
	'id: evt_00jjujk9fbnr4wkj2gh8\n' +
	"event: event_delta\n" +
	'data: {"delta":{"content":{"text":"Hello","type":"text"},"index":0,"type":"content_delta"},"event_id":"evt_00jjujk9fbnr4wkj2gh8","type":"event_delta"}\n';

const STATUS_IDLE =
	"id: evt_b2c3d4e5f6a7b8c9\n" +
	"event: session.status_idle\n" +
	'data: {"id":"evt_b2c3d4e5f6a7b8c9","type":"session.status_idle","stop_reason":{"type":"end_turn"},"processed_at":"2026-05-18T03:40:50.987654321Z"}\n';

/** The four frames, blank-line separated, with a trailing blank line -- the shape a real stream ends a batch with. */
const SSE_FIXTURE = [THINKING_START, MESSAGE_START, MESSAGE_DELTA, STATUS_IDLE].join("\n") + "\n";

// -----------------------------------------------------------------------------
// resolveQoderConfig -- the refusal path
// -----------------------------------------------------------------------------

describe("resolveQoderConfig -- refuses, never guesses", () => {
	it("refuses an empty environment, naming the token variable", () => {
		const result = resolveQoderConfig({});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain(QODER_TOKEN_ENV);
		}
	});

	it("refuses a present token with agent/environment ids missing, naming the missing variable and the setup step", () => {
		const result = resolveQoderConfig({ [QODER_TOKEN_ENV]: "pt-abcdefghijklmnop" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain(QODER_AGENT_ID_ENV);
			expect(result.message).toContain(QODER_ENVIRONMENT_ID_ENV);
			expect(result.message).toMatch(/console|API/);
			expect(result.message).toMatch(/one-time|once/);
		}
	});

	it("refuses a token that does not start with pt-, saying so", () => {
		const result = resolveQoderConfig({
			[QODER_TOKEN_ENV]: "sk-not-a-qoder-token",
			[QODER_AGENT_ID_ENV]: "agent-1",
			[QODER_ENVIRONMENT_ID_ENV]: "env-1",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toMatch(/pt-/);
		}
	});

	it("resolves ok:true with the documented default base URL when QODER_BASE_URL is unset", () => {
		const result = resolveQoderConfig({
			[QODER_TOKEN_ENV]: "pt-abcdefghijklmnop",
			[QODER_AGENT_ID_ENV]: "agent-1",
			[QODER_ENVIRONMENT_ID_ENV]: "env-1",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.config.baseUrl).toBe(DEFAULT_QODER_BASE_URL);
			expect(result.config.token).toBe("pt-abcdefghijklmnop");
			expect(result.config.agentId).toBe("agent-1");
			expect(result.config.environmentId).toBe("env-1");
		}
	});

	it("accepts a 127.0.0.1 loopback QODER_BASE_URL even over plain http", () => {
		const result = resolveQoderConfig({
			[QODER_TOKEN_ENV]: "pt-abcdefghijklmnop",
			[QODER_AGENT_ID_ENV]: "agent-1",
			[QODER_ENVIRONMENT_ID_ENV]: "env-1",
			[QODER_BASE_URL_ENV]: "http://127.0.0.1:4180/api",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.config.baseUrl).toBe("http://127.0.0.1:4180/api");
		}
	});

	it("refuses a QODER_BASE_URL that is neither https: nor 127.0.0.1 loopback", () => {
		const result = resolveQoderConfig({
			[QODER_TOKEN_ENV]: "pt-abcdefghijklmnop",
			[QODER_AGENT_ID_ENV]: "agent-1",
			[QODER_ENVIRONMENT_ID_ENV]: "env-1",
			[QODER_BASE_URL_ENV]: "http://example.com/api",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toMatch(/127\.0\.0\.1|https/);
		}
	});
});

// -----------------------------------------------------------------------------
// parseSseFrames -- the tolerant, incremental parser
// -----------------------------------------------------------------------------

describe("parseSseFrames -- the RESEARCH C.3 sample, whole and split", () => {
	it("parses the whole fixture in one call into the expected frame types and ids", () => {
		const { frames, rest } = parseSseFrames(SSE_FIXTURE);
		expect(rest).toBe("");
		expect(frames.map((f) => f.event)).toEqual(["event_start", "event_start", "event_delta", "session.status_idle"]);
		expect(frames[0]?.id).toBe("evt_00jjujk9fbnr55q5rtyp");
		expect(frames[3]?.id).toBe("evt_b2c3d4e5f6a7b8c9");
	});

	/** Feed `chunks` through parseSseFrames one at a time, threading `rest`. */
	function feedIncrementally(chunks: string[]): SseFrame[] {
		let buffer = "";
		const frames: SseFrame[] = [];
		for (const piece of chunks) {
			const parsed = parseSseFrames(buffer + piece);
			frames.push(...parsed.frames);
			buffer = parsed.rest;
		}
		return frames;
	}

	it("yields the identical frame sequence whether split on a \\n boundary or mid-line", () => {
		const whole = feedIncrementally([SSE_FIXTURE]);

		// Split A: on a clean newline boundary, inside the fixture.
		const newlineSplitPoint = SSE_FIXTURE.indexOf("\nevent: event_delta");
		const splitOnNewline = feedIncrementally([
			SSE_FIXTURE.slice(0, newlineSplitPoint),
			SSE_FIXTURE.slice(newlineSplitPoint),
		]);

		// Split B: mid-line, inside the `data:` payload of the delta frame --
		// the case that catches a parser that only works when a whole frame
		// arrives in one read.
		const midLineSplitPoint = SSE_FIXTURE.indexOf('"content":{"text":"Hel') + '"content":{"text":"Hel'.length;
		const splitMidLine = feedIncrementally([
			SSE_FIXTURE.slice(0, midLineSplitPoint),
			SSE_FIXTURE.slice(midLineSplitPoint),
		]);

		expect(splitOnNewline).toEqual(whole);
		expect(splitMidLine).toEqual(whole);
		// Non-vacuity: prove the fixture is actually exercised, not an empty split.
		expect(whole.length).toBeGreaterThan(0);
	});

	it("produces data: undefined for a malformed data: line, without throwing", () => {
		const malformed = "id: evt_bad\nevent: event_delta\ndata: {this is not json\n\n";
		expect(() => parseSseFrames(malformed)).not.toThrow();
		const { frames } = parseSseFrames(malformed);
		expect(frames).toHaveLength(1);
		expect(frames[0]?.id).toBe("evt_bad");
		expect(frames[0]?.data).toBeUndefined();
	});
});

// -----------------------------------------------------------------------------
// foldDelegatedResult -- pure accumulation
// -----------------------------------------------------------------------------

describe("foldDelegatedResult -- accumulates agent.message text only, tolerates the unknown", () => {
	it("ignores agent.thinking and returns only the agent.message content, completing on session.status_idle", () => {
		const { frames } = parseSseFrames(SSE_FIXTURE);
		const folded = foldDelegatedResult(frames);
		expect(folded.text).toBe("Hello");
		expect(folded.thinkingText).toBe("");
		expect(folded.done).toBe(true);
		expect(folded.stopReason).toBe("end_turn");
	});

	it("ignores an unknown event type in the middle of the stream and still completes on session.status_idle", () => {
		const UNKNOWN_FRAME =
			"id: evt_unknown_1\n" + "event: agent.tool_use\n" + 'data: {"type":"agent.tool_use","tool":"mystery"}\n';
		const withUnknown =
			[THINKING_START, MESSAGE_START, MESSAGE_DELTA, UNKNOWN_FRAME, STATUS_IDLE].join("\n") + "\n";

		const { frames } = parseSseFrames(withUnknown);
		// The unknown frame really is in the parsed list -- otherwise "ignored"
		// would be indistinguishable from "never parsed at all".
		expect(frames.some((f) => f.event === "agent.tool_use")).toBe(true);

		const folded = foldDelegatedResult(frames);
		expect(folded.text).toBe("Hello");
		expect(folded.done).toBe(true);
		expect(folded.stopReason).toBe("end_turn");
	});

	it("does not complete when no session.status_idle frame has arrived", () => {
		const { frames } = parseSseFrames([THINKING_START, MESSAGE_START, MESSAGE_DELTA].join("\n") + "\n");
		const folded = foldDelegatedResult(frames);
		expect(folded.done).toBe(false);
		expect(folded.text).toBe("Hello");
	});
});

// -----------------------------------------------------------------------------
// This file itself: no real-environment read, no socket
// -----------------------------------------------------------------------------

describe("this file's own discipline", () => {
	it("reads no real process environment anywhere in its own source", async () => {
		const { readFileSync } = await import("node:fs");
		const { fileURLToPath } = await import("node:url");
		const self = readFileSync(fileURLToPath(import.meta.url), "utf-8");
		// Built from parts rather than written as a literal, so this very
		// assertion cannot trip the acceptance grep it exists to satisfy.
		const forbidden = ["process", "env"].join("\\.");
		expect(self.match(new RegExp(forbidden, "g")) ?? []).toHaveLength(0);
	});
});
