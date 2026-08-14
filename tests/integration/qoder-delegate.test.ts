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
			const folded = await delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd });
			return { loop, folded, cwd };
		});
	});
}

describe("qoder-delegate -- the exact three-request sequence, in order", () => {
	it("posts /sessions, then posts .../events, then GETs .../events/stream -- with the right auth and content-type", async () => {
		const { loop } = await runDelegate({ frames: FRAMES });

		// Non-vacuity, before anything else is asserted about the contents.
		expect(loop.received.length).toBeGreaterThan(0);
		expect(loop.received).toHaveLength(3);

		const [sessionReq, eventReq, streamReq] = loop.received;

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
		const eventsMatch = /^\/sessions\/([^/]+)\/events$/.exec(loop.received[1]?.url ?? "");
		expect(eventsMatch, `step 2's url "${loop.received[1]?.url}" did not match the expected shape`).not.toBeNull();
		const sessionId = eventsMatch?.[1] as string;
		expect(sessionId).toMatch(/^sess_kypi_loopback_\d+$/);

		expect(loop.received[2]?.url).toBe(`/sessions/${sessionId}/events/stream`);
	});

	it("the events POST body carries exactly one user.message event whose content is the delegated task text", async () => {
		const { loop } = await runDelegate({ frames: FRAMES });
		expect(loop.received.length).toBeGreaterThan(0);

		const body = loop.received[1]?.body as
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
		// wait. The loopback server is told to split the stream body into two
		// writes with a real gap BETWEEN them (`splitDelayMs`) that is
		// deliberately LONGER than the injected timeout -- the gap itself, not
		// the connection closing, is what must trip the deadline.
		const injectedTimeoutMs = 60;
		const splitDelayMs = 400;

		const splitAt = Math.floor(FRAMES.length / 2);

		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback(
				{ frames: FRAMES, splitStreamAt: splitAt, splitDelayMs },
				async (loop) => {
					const config = resolveFixtureConfig(loop.baseUrl);

					const start = Date.now();
					await expect(
						delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd, inactivityTimeoutMs: injectedTimeoutMs }),
					).rejects.toThrow(/no bytes for \d+ms/);
					const elapsed = Date.now() - start;

					// Non-vacuity: the stream endpoint really was reached (all
					// three requests happened) before the timeout fired.
					expect(loop.received.length).toBeGreaterThan(0);
					expect(loop.received).toHaveLength(3);

					// The timeout fired close to the INJECTED budget, not close to
					// splitDelayMs (which would mean the real 5-minute default was
					// used instead of the injected seam) and not near-instantly
					// (which would mean it fired on the FIRST read, before the
					// server's first chunk had any chance to arrive at all).
					expect(
						elapsed,
						`the call took ${elapsed}ms, expected roughly the injected ${injectedTimeoutMs}ms budget -- ` +
							"either the injection seam is not wired to the actual deadline, or the timeout fired " +
							"on the wrong read",
					).toBeGreaterThanOrEqual(injectedTimeoutMs);
					expect(
						elapsed,
						`the call took ${elapsed}ms -- too close to splitDelayMs (${splitDelayMs}ms) for the ` +
							"injected timeout to plausibly be what fired",
					).toBeLessThan(splitDelayMs);
				},
			);
		});
	});

	it("does NOT time out when bytes keep arriving, even across a real inter-chunk delay shorter than the injected budget", async () => {
		// The paired positive: an injected timeout LONGER than the gap between
		// chunks must let a genuinely (if slowly) progressing stream complete
		// normally -- proving the deadline resets on progress rather than being
		// a fixed budget from the stream's own start.
		const injectedTimeoutMs = 2000;
		const splitDelayMs = 50;
		const splitAt = Math.floor(FRAMES.length / 2);

		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES, splitStreamAt: splitAt, splitDelayMs }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);

				const folded = await delegateTask({
					config,
					task: DELEGATED_TASK_TEXT,
					cwd,
					inactivityTimeoutMs: injectedTimeoutMs,
				});

				expect(loop.received.length).toBeGreaterThan(0);
				expect(folded.done).toBe(true);
				expect(folded.text).toBe("Hello world");
			});
		});
	});
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
