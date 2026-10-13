/**
 * ROUTE-11's OFFLINE PROXY -- `RB-05-01`'s four-part runbook contract names
 * THIS file as the offline proxy. Do not rename this path without updating
 * `docs/RUNBOOK.md` in the same commit; `tests/unit/docs-policy.test.ts`
 * asserts the named path exists on disk.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * This file drives `.pi/extensions/qoder/client.ts#delegateTask` against a
 * REAL `node:http` server on `127.0.0.1` (`tests/helpers/qoder-loopback.ts`)
 * shaped like Qoder's documented Cloud Agents API. It proves the harness
 * CONSTRUCTS the three-request sequence correctly (method, path, auth
 * header, JSON body) and PARSES a response shaped like Qoder's own
 * documented SSE envelope correctly (folding `agent.message` deltas,
 * ignoring `agent.thinking` deltas and unrecognised event types, completing
 * on `session.status_idle`).
 *
 * It proves NOTHING about whether a real personal access token against a
 * real `agent_id`/`environment_id` produces this exact envelope from
 * Qoder's real Cloud Agents host -- that host is never dialled by this
 * file, not even indirectly (`assertQoderLoopbackUrl` in the helper this
 * file uses refuses any non-loopback host before a `baseUrl` is ever
 * handed out). That live check is `RB-05-01` in `docs/RUNBOOK.md`, and it
 * is OUTSTANDING by construction: there is no personal access token and no
 * network egress on this machine, and nothing green in this file may be
 * read as discharging it. See `.pi/extensions/qoder/client.ts`'s own
 * module docstring (`DEFAULT_QODER_BASE_URL`) for the real host string --
 * it is never spelled out again in this file, not even in a comment, so a
 * grep for it here finds nothing to target by mistake.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { logDir } from "../../.pi/lib/jsonl.ts";
import {
	DEFAULT_QODER_BASE_URL,
	delegateTask,
	type FoldedResult,
	MAX_TASK_CHARS,
	QODER_AGENT_ID_ENV,
	QODER_BASE_URL_ENV,
	QODER_ENVIRONMENT_ID_ENV,
	QODER_TOKEN_ENV,
	resolveQoderConfig,
} from "../../.pi/extensions/qoder/client.ts";
import { logFilesIn, readTornSafe, withTempLogCwd } from "../helpers/logs.ts";
import { type QoderLoopbackHandle, withQoderLoopback } from "../helpers/qoder-loopback.ts";

// -----------------------------------------------------------------------------
// Fixture credential -- obviously fake, documented as such, and it never
// leaves this machine: the loopback server never inspects the value, and
// Qoder's real Cloud Agents host is never dialled anywhere in this file.
// [threat T-05-23]
// -----------------------------------------------------------------------------
const FIXTURE_TOKEN = "pt-kypi-loopback-fixture-not-a-credential";
const FIXTURE_AGENT_ID = "agent-kypi-fixture";
const FIXTURE_ENVIRONMENT_ID = "env-kypi-fixture";

/** Build an injected env object pointed at the loopback server. */
function fixtureEnv(baseUrl: string): NodeJS.ProcessEnv {
	return {
		[QODER_TOKEN_ENV]: FIXTURE_TOKEN,
		[QODER_AGENT_ID_ENV]: FIXTURE_AGENT_ID,
		[QODER_ENVIRONMENT_ID_ENV]: FIXTURE_ENVIRONMENT_ID,
		[QODER_BASE_URL_ENV]: baseUrl,
	};
}

// -----------------------------------------------------------------------------
// A frame script distinct from tests/unit/qoder-client.test.ts's own fixture:
// this one gives `agent.thinking` a DELTA of its own, carrying text that
// appears NOWHERE in the message deltas. Without a distinct thinking text,
// "the folded result does not contain the thinking text" would be satisfied
// by a fixture that never produced any thinking text at all -- the same
// "absence assertion needs a control body" discipline Phase 3 recorded for
// the compat-block wire proof (05-CONTEXT.md, `dashscope-payload.test.ts`).
// -----------------------------------------------------------------------------

const THINKING_START =
	"id: evt_think\n" +
	"event: event_start\n" +
	'data: {"event":{"id":"evt_think","type":"agent.thinking"},"type":"event_start"}\n';

const THINKING_DELTA =
	"id: evt_think\n" +
	"event: event_delta\n" +
	'data: {"delta":{"content":{"text":"PONDERING_KYPI_SECRET_XYZ","type":"text"},"index":0,"type":"content_delta"},"event_id":"evt_think","type":"event_delta"}\n';

const MESSAGE_START =
	"id: evt_msg\n" +
	"event: event_start\n" +
	'data: {"event":{"id":"evt_msg","type":"agent.message"},"type":"event_start"}\n';

const MESSAGE_DELTA_1 =
	"id: evt_msg\n" +
	"event: event_delta\n" +
	'data: {"delta":{"content":{"text":"Hello ","type":"text"},"index":0,"type":"content_delta"},"event_id":"evt_msg","type":"event_delta"}\n';

/** An unrecognised event type, injected mid-stream. Must be ignored, not fatal. */
const UNKNOWN_FRAME =
	"id: evt_unknown\n" +
	"event: agent.tool_use\n" +
	'data: {"type":"agent.tool_use","tool":"mystery"}\n';

const MESSAGE_DELTA_2 =
	"id: evt_msg\n" +
	"event: event_delta\n" +
	'data: {"delta":{"content":{"text":"world","type":"text"},"index":1,"type":"content_delta"},"event_id":"evt_msg","type":"event_delta"}\n';

const STATUS_IDLE =
	"id: evt_idle\n" +
	"event: session.status_idle\n" +
	'data: {"id":"evt_idle","type":"session.status_idle","stop_reason":{"type":"end_turn"}}\n';

const FRAMES =
	[THINKING_START, THINKING_DELTA, MESSAGE_START, MESSAGE_DELTA_1, UNKNOWN_FRAME, MESSAGE_DELTA_2, STATUS_IDLE].join(
		"\n",
	) + "\n";

const DELEGATED_TASK_TEXT = "summarise the open PRs";

/** Resolve a config against the loopback, failing the test loudly (not silently) if it refuses. */
function resolveFixtureConfig(baseUrl: string): { token: string; agentId: string; environmentId: string; baseUrl: string } {
	const resolved = resolveQoderConfig(fixtureEnv(baseUrl));
	if (!resolved.ok) {
		throw new Error(`test fixture itself refused to resolve: ${resolved.message}`);
	}
	return resolved.config;
}

/** Run one delegateTask call against a fresh loopback + temp log cwd, returning both. */
async function runDelegate(
	loopbackOpts: Parameters<typeof withQoderLoopback>[0],
): Promise<{ loop: QoderLoopbackHandle; folded: FoldedResult; cwd: string }> {
	return await withTempLogCwd(async (cwd) => {
		return await withQoderLoopback(loopbackOpts, async (loop) => {
			const config = resolveFixtureConfig(loop.baseUrl);
			// Callers of this shared helper that pass `splitStreamAt` (e.g. the
			// "split across two writes" case below) do not care about the
			// stall-detection behaviour WR-07 exercises directly -- they only
			// want a genuine two-write arrival. Release the gate as soon as the
			// FIRST chunk has genuinely landed (an event, never a duration) so
			// `delegateTask` cannot hang waiting on a gate nobody else would open.
			void loop.firstChunkWritten.then(() => {
				loop.releaseSecondChunk();
			});
			const folded = await delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd });
			return { loop, folded, cwd };
		});
	});
}

describe("qoder-delegate -- the exact three-request sequence, in order", () => {
	it("posts /sessions, then GETs .../events/stream, then posts .../events -- with the right auth and content-type", async () => {
		const { loop } = await runDelegate({ frames: FRAMES });

		// Non-vacuity, before anything else is asserted about the contents.
		expect(loop.received.length).toBeGreaterThan(0);
		expect(loop.received).toHaveLength(3);

		const [sessionReq, streamReq, eventReq] = loop.received;

		expect(sessionReq?.method).toBe("POST");
		expect(sessionReq?.url).toBe("/sessions");

		expect(eventReq?.method).toBe("POST");
		expect(eventReq?.url).toMatch(/^\/sessions\/[^/]+\/events$/);

		expect(streamReq?.method).toBe("GET");
		expect(streamReq?.url).toMatch(/^\/sessions\/[^/]+\/events\/stream$/);

		// Every request carries the bearer token, exactly.
		for (const req of loop.received) {
			expect(req.headers.authorization).toBe(`Bearer ${FIXTURE_TOKEN}`);
		}

		// The two POSTs carry Content-Type: application/json.
		expect(sessionReq?.headers["content-type"]).toMatch(/application\/json/);
		expect(eventReq?.headers["content-type"]).toMatch(/application\/json/);
	});

	it("reads the session id the server minted in step 1's response and uses it in step 2 and step 3's path", async () => {
		const { loop } = await runDelegate({ frames: FRAMES });
		expect(loop.received.length).toBeGreaterThan(0);

		// The session id is minted by the SERVER in its response to step 1
		// (qoder-loopback.ts's `sess_kypi_loopback_<n>`), never supplied by the
		// client -- so the id is read back from where the CLIENT used it (the
		// path of steps 2 and 3), which is the observable proof that
		// `delegateTask` actually parsed the create-session response rather
		// than fabricating a path.
		const eventsMatch = /^\/sessions\/([^/]+)\/events$/.exec(loop.received[2]?.url ?? "");
		expect(eventsMatch, `the events url "${loop.received[2]?.url}" did not match the expected shape`).not.toBeNull();
		const sessionId = eventsMatch?.[1] as string;
		expect(sessionId).toMatch(/^sess_kypi_loopback_\d+$/);

		expect(loop.received[1]?.url).toBe(`/sessions/${sessionId}/events/stream`);
	});

	it("the events POST body carries exactly one user.message event whose content is the delegated task text", async () => {
		const { loop } = await runDelegate({ frames: FRAMES });
		expect(loop.received.length).toBeGreaterThan(0);

		const body = loop.received[2]?.body as
			| { events?: { type?: unknown; content?: { type?: unknown; text?: unknown }[] }[] }
			| undefined;
		expect(body?.events).toHaveLength(1);
		expect(body?.events?.[0]?.type).toBe("user.message");
		expect(body?.events?.[0]?.content).toHaveLength(1);
		expect(body?.events?.[0]?.content?.[0]?.type).toBe("text");
		expect(body?.events?.[0]?.content?.[0]?.text).toBe(DELEGATED_TASK_TEXT);
	});
});

describe("qoder-delegate -- the folded result is the agent.message text only", () => {
	it("equals the concatenated agent.message deltas and does NOT contain the agent.thinking text", async () => {
		const { loop, folded } = await runDelegate({ frames: FRAMES });
		expect(loop.received.length).toBeGreaterThan(0);

		expect(folded.text).toBe("Hello world");
		expect(folded.done).toBe(true);
		expect(folded.stopReason).toBe("end_turn");

		// THE PAIRED POSITIVE. Without proving the thinking text was genuinely
		// produced and accumulated SOMEWHERE, its absence from `folded.text`
		// would be indistinguishable from a fixture that never emitted any
		// thinking text at all.
		expect(folded.thinkingText).toContain("PONDERING_KYPI_SECRET_XYZ");

		// THE NEGATIVE THIS CASE EXISTS FOR.
		expect(folded.text).not.toContain("PONDERING_KYPI_SECRET_XYZ");
	});

	it("ignores an unknown event type injected mid-stream and still completes on session.status_idle", async () => {
		// FRAMES already contains UNKNOWN_FRAME between the two message deltas
		// (see the module-level fixture) -- this case names that fact
		// explicitly and checks the server genuinely sent it, so "ignored" is
		// distinguishable from "never arrived".
		expect(FRAMES).toContain("agent.tool_use");

		const { loop, folded } = await runDelegate({ frames: FRAMES });
		expect(loop.received.length).toBeGreaterThan(0);

		expect(folded.done).toBe(true);
		expect(folded.stopReason).toBe("end_turn");
		expect(folded.text).toBe("Hello world");
	});

	it("yields the identical folded result whether a frame is delivered split across two writes", async () => {
		const unsplit = await runDelegate({ frames: FRAMES });
		expect(unsplit.loop.received.length).toBeGreaterThan(0);

		// Split mid-way through the second message delta's JSON payload -- the
		// case that catches a parser that only works when a whole frame
		// arrives in one read (mirrors tests/unit/qoder-client.test.ts's own
		// "mid-line" split case, but exercised over a REAL socket this time).
		const splitAt = FRAMES.indexOf('"text":"world') + '"text":"wor'.length;
		const split = await runDelegate({ frames: FRAMES, splitStreamAt: splitAt });
		expect(split.loop.received.length).toBeGreaterThan(0);

		expect(split.folded.text).toBe(unsplit.folded.text);
		expect(split.folded.thinkingText).toBe(unsplit.folded.thinkingText);
		expect(split.folded.done).toBe(unsplit.folded.done);
		expect(split.folded.stopReason).toBe(unsplit.folded.stopReason);

		// Non-vacuity for the split case specifically: prove it actually
		// completed and produced the same non-empty result, not that both
		// sides independently produced nothing.
		expect(split.folded.text).toBe("Hello world");
		expect(split.folded.done).toBe(true);
	});
});

describe("qoder-delegate -- failure surfaces as an error, never a hang or a silent empty result", () => {
	it("a non-2xx on POST /sessions surfaces as an error whose message names the status", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES, statusOverrides: { sessions: 503 } }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);

				await expect(delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd })).rejects.toThrow(/503/);

				// Non-vacuity: the failing request really was recorded, and only
				// that one request was made -- the client did not proceed to the
				// events or stream endpoints after the session create failed.
				expect(loop.received.length).toBeGreaterThan(0);
				expect(loop.received).toHaveLength(1);
				expect(loop.received[0]?.url).toBe("/sessions");
			});
		});
	});
});

describe("qoder-delegate -- the missing-PAT refusal happens before any network attempt", () => {
	it("with QODER_PERSONAL_ACCESS_TOKEN absent, zero requests are ever recorded on the loopback", async () => {
		await withQoderLoopback({ frames: FRAMES }, async (loop) => {
			const envWithoutToken: NodeJS.ProcessEnv = {
				[QODER_AGENT_ID_ENV]: FIXTURE_AGENT_ID,
				[QODER_ENVIRONMENT_ID_ENV]: FIXTURE_ENVIRONMENT_ID,
				[QODER_BASE_URL_ENV]: loop.baseUrl,
			};

			const resolved = resolveQoderConfig(envWithoutToken);
			expect(resolved.ok).toBe(false);
			if (!resolved.ok) {
				expect(resolved.message).toContain(QODER_TOKEN_ENV);
			}

			// THE LOAD-BEARING ASSERTION. resolveQoderConfig is pure and
			// delegateTask REQUIRES an already-validated QoderConfig -- there is
			// no code path from a refused resolution to a fetch() call. A test
			// that only checked the error message would pass against a client
			// that dialled first and refused afterwards; this proves the
			// refusal happens strictly BEFORE any socket is opened, by
			// construction of the type signature `delegateTask` exposes, and by
			// observing the server's own request log stayed empty for the
			// entire scope of this callback.
			expect(loop.received).toHaveLength(0);
		});
	});
});

describe("qoder-delegate -- WR-09: the ASVS V5 task-validation refusals happen before any network attempt", () => {
	it("refuses a whitespace-only task before any request is issued", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				await expect(delegateTask({ config, task: "   \n\t ", cwd })).rejects.toThrow(/empty after trimming/);
				// THE LOAD-BEARING HALF: zero requests, not merely the right
				// message -- see the sibling missing-PAT describe block's own
				// identical discipline for why the message alone is not enough.
				expect(loop.received).toHaveLength(0);
			});
		});
	});

	it("refuses a task one character over MAX_TASK_CHARS, naming the limit, with zero requests", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				const overLimitTask = "x".repeat(MAX_TASK_CHARS + 1);
				await expect(delegateTask({ config, task: overLimitTask, cwd })).rejects.toThrow(
					new RegExp(`over the ${MAX_TASK_CHARS}-character limit`),
				);
				expect(loop.received).toHaveLength(0);
			});
		});
	});

	it("accepts a task exactly AT MAX_TASK_CHARS (the paired positive -- the limit is inclusive, not off-by-one)", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				const atLimitTask = "x".repeat(MAX_TASK_CHARS);
				const folded = await delegateTask({ config, task: atLimitTask, cwd });
				expect(loop.received.length).toBeGreaterThan(0);
				expect(folded.done).toBe(true);
			});
		});
	});
});

describe("qoder-delegate -- the transcript never carries the token or an Authorization value", () => {
	it("writes a redacted transcript under cwd/.pi/logs that contains neither the fixture token nor an Authorization value", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				await delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd });

				expect(loop.received.length).toBeGreaterThan(0);
			});

			const dir = logDir(cwd);
			const files = logFilesIn(dir);
			const qoderFile = files.find((name) => name.startsWith("qoder-"));
			expect(
				qoderFile,
				`no qoder-*.jsonl transcript found under ${dir} (saw: ${files.join(", ") || "<none>"})`,
			).toBeDefined();

			const { records, unparseable } = readTornSafe(join(dir, qoderFile as string));
			expect(unparseable).toHaveLength(0);
			// Non-vacuity: the transcript actually contains something to check.
			expect(records.length).toBeGreaterThan(0);

			const serialized = JSON.stringify(records);
			expect(serialized).not.toContain(FIXTURE_TOKEN);
			expect(serialized.toLowerCase()).not.toContain("authorization");
			expect(serialized.toLowerCase()).not.toContain("bearer");
		});
	});
});

describe("qoder-delegate -- CR-03: a truncated stream is never handed back as a complete answer", () => {
	it("a final frame with no terminating blank line is still folded in (the trailing-buffer flush), and the call still completes", async () => {
		// Deliberately NOT `+ "\n"` after the join -- FRAMES (the module-level
		// fixture) appends that trailing newline, which is what gives the LAST
		// frame (STATUS_IDLE) a full blank-line terminator. Without it, the
		// server closes the body right after STATUS_IDLE's own single trailing
		// "\n" -- exactly the "SSE server ends the body with the last frame not
		// followed by a blank line" shape this file's own module docstring and
		// client.ts's CR-03 fix both name. Before the fix, this frame (often
		// the one carrying session.status_idle) would sit unparsed in the
		// reader's buffer forever and delegateTask would either hang or return
		// with `done: false`; the fix flushes it after the read loop exits.
		const framesWithNoTrailingBlankLine = [
			THINKING_START,
			THINKING_DELTA,
			MESSAGE_START,
			MESSAGE_DELTA_1,
			MESSAGE_DELTA_2,
			STATUS_IDLE,
		].join("\n");
		expect(
			framesWithNoTrailingBlankLine.endsWith("\n\n"),
			"fixture precondition is wrong -- this frame text must NOT end with a full blank-line terminator",
		).toBe(false);

		const { loop, folded } = await runDelegate({ frames: framesWithNoTrailingBlankLine });
		expect(loop.received.length).toBeGreaterThan(0);

		expect(folded.done, "the flushed trailing frame did not register as session.status_idle").toBe(true);
		expect(folded.stopReason).toBe("end_turn");
		expect(folded.text).toBe("Hello world");
	});

	it("a stream closed before session.status_idle throws, naming the accumulated character count, rather than returning a truncated result", async () => {
		// No STATUS_IDLE frame at all -- the server closes the connection after
		// the message deltas, simulating a dropped connection, a server-side
		// 5xx after headers, or an early close. Before the fix, delegateTask
		// returned `folded` regardless of `done`, and index.ts's tool handler
		// handed `folded.text` ("Hello world") back to the model as a complete
		// answer with no error and no marker.
		const framesWithNoIdle = [THINKING_START, THINKING_DELTA, MESSAGE_START, MESSAGE_DELTA_1, MESSAGE_DELTA_2].join(
			"\n",
		) + "\n\n";
		expect(framesWithNoIdle).not.toContain("session.status_idle");

		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: framesWithNoIdle }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);

				await expect(delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd })).rejects.toThrow(
					/event stream ended without a session\.status_idle frame/,
				);

				// Non-vacuity: the stream endpoint really was reached, and the two
				// prior requests (session create, event send) both completed.
				expect(loop.received.length).toBeGreaterThan(0);
				expect(loop.received).toHaveLength(3);
			});
		});
	});
});

describe("qoder-delegate -- WR-06: the stream-open step writes its own request/response transcript records", () => {
	it("the transcript carries qoder.stream.open.request and qoder.stream.open.response(status:200), not just the two prior steps", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				await delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd });
				expect(loop.received.length).toBeGreaterThan(0);
			});

			const dir = logDir(cwd);
			const files = logFilesIn(dir);
			const qoderFile = files.find((name) => name.startsWith("qoder-"));
			expect(qoderFile, `no qoder-*.jsonl transcript found under ${dir}`).toBeDefined();

			const { records, unparseable } = readTornSafe(join(dir, qoderFile as string));
			expect(unparseable).toHaveLength(0);
			expect(records.length).toBeGreaterThan(0);

			const events = records as { event?: unknown; status?: unknown; url?: unknown }[];

			// RB-05-01 step 4 names "a 401/403 on any of the three requests" as
			// the failure signal that matters most -- before this fix, the
			// stream-open step (this one) was the ONE step of the three that
			// wrote neither half, so this is the paired-presence proof for the
			// event this fix adds, not merely the two the file already covered.
			const streamRequest = events.find((e) => e.event === "qoder.stream.open.request");
			const streamResponse = events.find((e) => e.event === "qoder.stream.open.response");
			expect(
				streamRequest,
				"no qoder.stream.open.request record was written -- the stream-open step's request half " +
					"is still missing from the transcript",
			).toBeDefined();
			expect(String(streamRequest?.url)).toMatch(/\/sessions\/[^/]+\/events\/stream$/);
			expect(
				streamResponse,
				"no qoder.stream.open.response record was written -- the stream-open step's response " +
					"half is still missing from the transcript",
			).toBeDefined();
			expect(
				streamResponse?.status,
				"the qoder.stream.open.response record does not carry the HTTP status a 401/403 would show up in",
			).toBe(200);

			// Paired positive: the two PRIOR steps this file already knew to
			// write their own request/response pairs -- proving the reader and
			// the fixture are both live, not that this file's own event names
			// happen to be absent from an instrument that captures nothing.
			expect(events.some((e) => e.event === "qoder.session.create.request")).toBe(true);
			expect(events.some((e) => e.event === "qoder.event.send.request")).toBe(true);
		});
	});
});

describe("qoder-delegate -- WR-07: a stalled stream (no bytes at all) is reported, never hung on indefinitely", () => {
	it("throws an actionable inactivity-timeout error when the server goes silent between two writes, using an injected short timeout", async () => {
		// `delegateTask`'s own `inactivityTimeoutMs` is a TEST-ONLY injection
		// seam (see client.ts's own doc comment on DelegateTaskOptions) --
		// production never passes it, defaulting to the real five-minute
		// STREAM_INACTIVITY_TIMEOUT_MS. Injecting a short one here is what makes
		// this stall-detection behaviour provable without an actual five-minute
		// wait. The loopback server splits the stream body into two writes and
		// then holds the second one behind `loop.releaseSecondChunk()` -- a
		// gate this test never calls until AFTER the rejection assertion below,
		// so the server genuinely goes silent rather than racing a wall-clock
		// guess at when it would. See tests/helpers/qoder-loopback.ts's own
		// docstring ("Event-gated stream splitting") for why the previous
		// duration-based version of this fixture made this file intermittently
		// red.
		const injectedTimeoutMs = 60;
		// Split right at the frame boundary AFTER the first `agent.message`
		// delta (rather than at the string midpoint) -- the `textChars > 0`
		// assertion below needs the first chunk to contain at least one
		// COMPLETE, parseable frame, not merely half the byte count. Splitting
		// mid-frame would leave `folded.text` empty until the (never-sent)
		// second chunk arrived, which is a fact about SSE framing, not about
		// timing.
		const splitAt = FRAMES.indexOf(UNKNOWN_FRAME);

		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES, splitStreamAt: splitAt }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);

				const delegatePromise = delegateTask({
					config,
					task: DELEGATED_TASK_TEXT,
					cwd,
					inactivityTimeoutMs: injectedTimeoutMs,
				});

				try {
					// The property the deleted `>= 60ms` wall-clock bound was
					// standing in for: the first read genuinely happened. This is a
					// FACT the server reports, not a duration long enough for it to
					// probably have happened by.
					await loop.firstChunkWritten;

					await expect(delegatePromise).rejects.toThrow(/no bytes for \d+ms/);
				} finally {
					// A failed assertion above must not leave the server's responder
					// awaiting a gate nobody will ever open -- release it here too,
					// as well as relying on the helper's own teardown, which does
					// the same thing as a second line of defence.
					loop.releaseSecondChunk();
				}

				// Non-vacuity: the stream endpoint really was reached (all
				// three requests happened) before the timeout fired.
				expect(loop.received.length).toBeGreaterThan(0);
				expect(loop.received).toHaveLength(3);
			});

			// WR-06: a terminal transcript record for the inactivity-timeout path.
			// Before this fix, the transcript ended at
			// "qoder.stream.open.response: 200" with nothing following a stall --
			// the same gap WR-06 originally closed for the stream-open step itself.
			const dir = logDir(cwd);
			const files = logFilesIn(dir);
			const qoderFile = files.find((name) => name.startsWith("qoder-"));
			expect(qoderFile, `no qoder-*.jsonl transcript found under ${dir}`).toBeDefined();
			const { records } = readTornSafe(join(dir, qoderFile as string));
			const failedRecords = (
				records as { event?: unknown; cause?: unknown; afterMs?: unknown; textChars?: unknown }[]
			).filter((r) => r.event === "qoder.delegate.failed");
			expect(
				failedRecords,
				"no qoder.delegate.failed record was written for the inactivity-timeout path",
			).toHaveLength(1);
			expect(failedRecords[0]?.cause).toBe("inactivity-timeout");

			// STRICTLY STRONGER than the deleted `60 <= (Date.now() delta) < 400`
			// wall-clock bound: `afterMs` is the deadline the client actually armed
			// (client.ts:706-710,720 -- `afterMs: inactivityTimeoutMs`), proving
			// the injection seam is wired to the real deadline -- the first
			// bound's whole purpose. `textChars > 0` proves bytes were folded
			// before the stall was declared -- the second bound's whole purpose.
			// Both are read from the LOSSLESS transcript record the client itself
			// wrote, and neither depends on scheduler timing the way a
			// `Date.now()` delta does.
			expect(failedRecords[0]?.afterMs).toBe(injectedTimeoutMs);
			expect(failedRecords[0]?.textChars).toBeGreaterThan(0);
		});
	});

	it(
		"WR-04: does NOT time out across THREE inter-chunk gaps whose SUM exceeds the injected budget, " +
			"while every INDIVIDUAL gap stays under it -- the only shape that distinguishes reset-on-progress " +
			"from a fixed budget, proved with an INJECTED CLOCK rather than a real sleep",
		async () => {
			// The paired positive, tightened per WR-04, then de-flaked again per
			// WR2-03 (`08-REVIEW.md` iteration 2). The prior version used ONE
			// gap (~50ms) against a MUCH larger budget (2000ms): a client that
			// arms a single fixed timeout at stream-open time and never resets it
			// would STILL pass that case, because 50ms elapsed is nowhere near
			// 2000ms regardless of reset behaviour -- the test's own comment
			// claimed to prove reset-on-progress but never actually forced a
			// choice between the two implementations.
			//
			// WR-04's own fix split the stream into FOUR chunks (three gaps) and
			// used a REAL 150ms sleep between each release against a 300ms
			// budget -- correct in shape (proves SUM > budget while every
			// INDIVIDUAL gap stays under it, which DOES force the choice), but
			// the review found the margin was only 2x (down from the prior
			// version's ~40x), and on a loaded CI runner a real scheduler hiccup
			// during any ONE real 150ms sleep could push that single gap over the
			// real 300ms budget, making delegateTask genuinely and CORRECTLY
			// reject -- a false-failure risk in the TEST, not a bug in the code
			// under test, and one that widening the margin cannot honestly fix
			// per this phase's own de-flake prohibitions (no widened elapsed
			// bounds).
			//
			// WR2-03's fix, following 08-05's own "root cause eliminated at its
			// source, no wall-clock delay option" discipline: `delegateTask` now
			// accepts an injected `now` AND an `onProgress` callback (both
			// `DelegateTaskOptions`, test-only). `onProgress` fires from INSIDE
			// the read loop, exactly once per reset, immediately after
			// `lastProgressAt` is captured -- so bumping the injected clock and
			// releasing the NEXT chunk from within this callback guarantees the
			// client's OWN next remaining-check sees EXACTLY one gap's worth of
			// elapsed time, never more, never less, and never dependent on
			// whether the server's write or the client's read happens to be
			// scheduled first (an earlier version of this fix drove the bump off
			// the SERVER's own `chunkWritten` event instead, independently of the
			// client's consumption -- since nothing then throttled the test's own
			// loop to the client's pace, it could race ahead and dump all three
			// bumps in before the client had processed even the first chunk,
			// which is worse than non-deterministic: it is UNFALSIFIABLE, since a
			// mutated non-resetting client happened to still pass). The four
			// chunks still arrive over a REAL socket -- nothing about the
			// transport is faked -- but the TEST never once waits in real time:
			// this file's own 20-test run, including this case, completes in
			// well under a second, immune to CI scheduler jitter entirely, not
			// merely less exposed to it.
			//
			// The only assertions below are on the OUTCOME (`folded.done`,
			// `folded.text`), never on how much time passed -- exactly the prior
			// version's own discipline, preserved here.
			// WR3-03 (`08-REVIEW.md` iteration 3): `nowCalls` makes the injected
			// clock self-defending. This whole case's proof rests on
			// `delegateTask`'s deadline arithmetic actually reading `opts.now` --
			// without it, the seam is production surface added for one test with
			// nothing pinning it: deleting `opts.now`'s only use (e.g. hardcoding
			// `const now = Date.now;` inside `delegateTask`, ignoring the option
			// entirely) leaves all 20 tests in this file green, because real
			// elapsed time across four loopback chunks is a few milliseconds
			// against a 300ms budget regardless of reset behaviour. Counting
			// calls and asserting `> 0` closes that: a client that never consults
			// `opts.now` at all leaves this counter at zero.
			const injectedTimeoutMs = 300;
			const interGapMs = 150;
			let fakeElapsedMs = 0;
			let nowCalls = 0;
			const now = (): number => {
				nowCalls += 1;
				return fakeElapsedMs;
			};
			let progressCount = 0;
			const splitPoints = [Math.floor(FRAMES.length / 4), Math.floor(FRAMES.length / 2), Math.floor((3 * FRAMES.length) / 4)];

			await withTempLogCwd(async (cwd) => {
				await withQoderLoopback({ frames: FRAMES, splitStreamAtMultiple: splitPoints }, async (loop) => {
					const config = resolveFixtureConfig(loop.baseUrl);

					const folded = await delegateTask({
						config,
						task: DELEGATED_TASK_TEXT,
						cwd,
						inactivityTimeoutMs: injectedTimeoutMs,
						now,
						// Fires once per chunk READ that is not the terminal stream-close
						// read -- four times for this four-chunk split (chunks 0-2 each
						// precede a real gap the test controls; chunk 3 also resets, since
						// the fold only observes `done` AFTER processing it, and the loop
						// exits on the NEXT `while` check rather than reading again).
						// `releaseNextChunk` is idempotent past the last boundary
						// (`qoder-loopback.ts`'s own contract), so the 4th, boundary-less
						// call here is a harmless no-op. Measured, not guessed: run 5x,
						// always exactly 4 -- see the commit this test landed in.
						onProgress: () => {
							progressCount += 1;
							fakeElapsedMs += interGapMs;
							loop.releaseNextChunk();
						},
					});

					expect(loop.received.length).toBeGreaterThan(0);
					expect(
						progressCount,
						"onProgress must have fired once per chunk read (four, for a four-chunk split) -- otherwise this test proved nothing about reset-on-progress",
					).toBe(4);
					expect(
						nowCalls,
						"delegateTask never consulted the injected clock -- this case's whole proof rests on the deadline " +
							"arithmetic reading opts.now, so a green run without it proves nothing",
					).toBeGreaterThan(0);
					expect(folded.done).toBe(true);
					expect(folded.text).toBe("Hello world");
				});
			});
		},
	);
});

describe("qoder-delegate -- WR-08: a malformed server-supplied session id is refused, never spliced raw into a request path", () => {
	it("a session id containing path-traversal characters is refused before the second request is ever made", async () => {
		// The DEFAULT loopback session id generator can never produce this --
		// `sessionIdOverride` is the seam that lets this test hand the CLIENT a
		// server response shaped like a malicious id, which is exactly the
		// untrusted-input scenario WR-08 describes (`sessionId` comes from a
		// network response the client does not control).
		const maliciousId = "../../etc/passwd?x=1#y";

		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES, sessionIdOverride: maliciousId }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);

				await expect(delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd })).rejects.toThrow(
					/does not look like one/,
				);

				// THE LOAD-BEARING ASSERTION: only the FIRST request (session
				// create, the one that returned the malicious id) was ever made.
				// A client that validated too late -- after already splicing the
				// id into the events-POST path -- would still show a second
				// request here, just possibly a mangled one.
				expect(loop.received.length).toBeGreaterThan(0);
				expect(loop.received).toHaveLength(1);
				expect(loop.received[0]?.url).toBe("/sessions");
			});

			// WR-06: a terminal transcript record for the malformed-session-id
			// path -- the same gap WR-06 originally closed for the stream-open
			// step. Before this fix the transcript ended at
			// "qoder.session.create.response: 200" with nothing following.
			const dir = logDir(cwd);
			const files = logFilesIn(dir);
			const qoderFile = files.find((name) => name.startsWith("qoder-"));
			expect(qoderFile, `no qoder-*.jsonl transcript found under ${dir}`).toBeDefined();
			const { records } = readTornSafe(join(dir, qoderFile as string));
			const failedRecords = (records as { event?: unknown; cause?: unknown }[]).filter(
				(r) => r.event === "qoder.delegate.failed",
			);
			expect(
				failedRecords,
				"no qoder.delegate.failed record was written for the malformed-session-id path",
			).toHaveLength(1);
			expect(failedRecords[0]?.cause).toBe("malformed-session-id");
			// Never the offending id verbatim, even in the failure record -- it is
			// untrusted network input and this file's own module docstring holds
			// the transcript to the "never the token, never Authorization" bar;
			// WR-06 extends the same discipline to this new record.
			const serialized = JSON.stringify(records);
			expect(serialized).not.toContain(maliciousId);
		});
	});

	it("a well-formed session id containing a real '/' is refused the same way (the shape check, not merely a blocklist)", async () => {
		// A slash is not on any blocklist enumerated anywhere in this file --
		// this proves the check is a POSITIVE shape match
		// (`/^[A-Za-z0-9._-]{1,128}$/`), not a denylist of specific dangerous
		// substrings that a differently-shaped bad id could slip past.
		const idWithSlash = "sess/nested";

		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES, sessionIdOverride: idWithSlash }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);

				await expect(delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd })).rejects.toThrow(
					/does not look like one/,
				);
				expect(loop.received).toHaveLength(1);
			});
		});
	});
});

describe("qoder-delegate -- this file never dials the real host", () => {
	it("resolveQoderConfig's own documented default base URL is never used by any case in this file", () => {
		// Every fixture config in this file supplies QODER_BASE_URL_ENV pointed
		// at the loopback handle; this asserts the module's own real default
		// (defined once in client.ts and imported here, never re-typed in this
		// file) resolves to a non-loopback https host, which is a coarse,
		// mechanical proof that the loopback override -- not this default --
		// is what every other case in this file actually dialled.
		expect(DEFAULT_QODER_BASE_URL.startsWith("https://")).toBe(true);
		expect(new URL(DEFAULT_QODER_BASE_URL).hostname).not.toBe("127.0.0.1");
	});
});

describe("qoder-delegate -- the stream is open before the task is sent", () => {
	it("receives frames the server emits the moment the task arrives", async () => {
		const { folded, loop } = await runDelegate({ frames: FRAMES, liveStreamOnly: true });
		expect(loop.received.length).toBeGreaterThan(0);
		expect(folded.text).toBe("Hello world");
		expect(folded.done).toBe(true);
	});
});

describe("qoder-delegate -- a failed remote turn is an error", () => {
	for (const reason of ["error", "interrupted"]) {
		it(`throws naming stop_reason ${reason} instead of returning the partial text`, async () => {
			const idle = STATUS_IDLE.replace('"end_turn"', `"${reason}"`);
			const frames = [MESSAGE_START, MESSAGE_DELTA_1, idle].join("\n") + "\n";
			await expect(runDelegate({ frames })).rejects.toThrow(new RegExp(`stop_reason "${reason}"`));
		});
	}
});

describe("qoder-delegate -- Esc cancels the remote turn", () => {
	it("posts the cancel endpoint and rejects as aborted when the signal fires mid-stream", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES, splitStreamAt: 40 }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				const controller = new AbortController();
				const run = delegateTask({
					config,
					task: DELEGATED_TASK_TEXT,
					cwd,
					signal: controller.signal,
					onProgress: () => controller.abort(),
				});
				await expect(run).rejects.toThrow(/aborted/);
				const cancel = loop.received.find((req) => req.method === "POST" && /\/cancel$/.test(req.url));
				expect(cancel, "no cancel request reached the server").toBeDefined();
				expect(cancel?.headers.authorization).toBe(`Bearer ${FIXTURE_TOKEN}`);
			});
		});
	});
});
