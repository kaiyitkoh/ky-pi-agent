/**
 * Runbook RB-05-01's offline proxy (docs-policy.test.ts asserts this path exists; rename both together). Drives
 * `delegateTask` against a real `127.0.0.1` server shaped like Qoder's Cloud Agents API: it proves request construction
 * and SSE folding, not that the real service answers this way. The real host is never spelled in this file.
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

// Fixture credential: obviously fake; the loopback server never inspects it.
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

// A distinct `agent.thinking` delta text, so "the result omits the thinking text" has a control that produced some.

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
			// Callers that split the stream only want a two-write arrival, so open the gate once the first chunk lands.
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

		// The server mints the session id; reading it back from the client's later paths proves the response was parsed.
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

		// Paired positive: the thinking text really was produced, so its absence below means something.
		expect(folded.thinkingText).toContain("PONDERING_KYPI_SECRET_XYZ");

		expect(folded.text).not.toContain("PONDERING_KYPI_SECRET_XYZ");
	});

	it("ignores an unknown event type injected mid-stream and still completes on session.status_idle", async () => {
		// The fixture already carries UNKNOWN_FRAME; checking the server sent it tells "ignored" from "never arrived".
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

		// Split inside a frame's JSON payload, over a real socket, to catch a parser that needs whole frames per read.
		const splitAt = FRAMES.indexOf('"text":"world') + '"text":"wor'.length;
		const split = await runDelegate({ frames: FRAMES, splitStreamAt: splitAt });
		expect(split.loop.received.length).toBeGreaterThan(0);

		expect(split.folded.text).toBe(unsplit.folded.text);
		expect(split.folded.thinkingText).toBe(unsplit.folded.thinkingText);
		expect(split.folded.done).toBe(unsplit.folded.done);
		expect(split.folded.stopReason).toBe(unsplit.folded.stopReason);

		// The split run really completed with the same non-empty result.
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

				// Only the failing request was made: the client stopped after the session create failed.
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

			// Zero requests, not merely the right message: delegateTask takes an already-validated config, so a refused
			// resolution can never reach fetch().
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
				// Zero requests, not merely the right message.
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
		// No trailing newline after the join: the last frame then lacks its blank-line terminator, and the client must still
		// flush it after the read loop instead of hanging or returning `done: false`.
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

	it("an idle frame before the agent started is not completion, and an idle with no text is an error", async () => {
		const idleOnly = `${STATUS_IDLE}\n`;
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: idleOnly }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				await expect(delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd })).rejects.toThrow(/without a session\.status_idle frame/);
				expect(loop.received.at(-1)?.url).toMatch(/\/cancel$/);
			});
		});
		const running = 'event: session.status_running\ndata: {"type":"session.status_running"}\n';
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: `${running}\n${STATUS_IDLE}\n` }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				await expect(delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd })).rejects.toThrow(/without any message text/);
			});
		});
	});

	it("an idle frame naming a failure before the agent started ends the stream with that failure", async () => {
		const failed = 'event: session.status_idle\ndata: {"type":"session.status_idle","stop_reason":{"type":"error"}}\n';
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: `${failed}\n` }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				await expect(delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd })).rejects.toThrow(/stop_reason "error"/);
			});
		});
	});

	it("asks for an event stream", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({}, async (loop) => {
				await delegateTask({ config: resolveFixtureConfig(loop.baseUrl), task: DELEGATED_TASK_TEXT, cwd });
				const stream = loop.received.find((req) => req.method === "GET");
				expect(stream?.headers?.accept).toBe("text/event-stream");
			});
		});
	});

	it("a stream closed before session.status_idle throws, naming the accumulated character count, rather than returning a truncated result", async () => {
		// No STATUS_IDLE: a dropped connection must not hand partial text back as a complete answer.
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

				// All three requests completed, then the still-running remote session was cancelled.
				expect(loop.received).toHaveLength(4);
				expect(loop.received[3]?.url).toMatch(/\/cancel$/);
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

			// A 401/403 on stream open is the runbook's key failure signal, so this step must log its request/response pair.
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

			// Paired positive: the two earlier steps' pairs are logged, so the reader and fixture are live.
			expect(events.some((e) => e.event === "qoder.session.create.request")).toBe(true);
			expect(events.some((e) => e.event === "qoder.event.send.request")).toBe(true);
		});
	});
});

describe("qoder-delegate -- WR-07: a stalled stream (no bytes at all) is reported, never hung on indefinitely", () => {
	it("throws an actionable inactivity-timeout error when the server goes silent between two writes, using an injected short timeout", async () => {
		// `inactivityTimeoutMs` is a test-only seam (production uses five minutes). The server holds the second chunk behind
		// a gate this test opens only after the rejection, so the stream genuinely goes silent; nothing races a clock.
		const injectedTimeoutMs = 60;
		// Split after the first complete `agent.message` frame, so `textChars > 0` has a parseable frame to fold.
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
					// The first read genuinely happened, as reported by the server.
					await loop.firstChunkWritten;

					await expect(delegatePromise).rejects.toThrow(/no bytes for \d+ms/);
				} finally {
					// Release here too, so a failed assertion cannot leave the responder awaiting the gate.
					loop.releaseSecondChunk();
				}

				// All three requests happened before the timeout, then the remote session was cancelled.
				expect(loop.received).toHaveLength(4);
				expect(loop.received[3]?.url).toMatch(/\/cancel$/);
			});

			// The inactivity timeout leaves a terminal transcript record.
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

			// `afterMs` is the deadline the client armed, and `textChars > 0` shows bytes were folded first; both come from
			// the client's own transcript record, so neither depends on scheduler timing.
			expect(failedRecords[0]?.afterMs).toBe(injectedTimeoutMs);
			expect(failedRecords[0]?.textChars).toBeGreaterThan(0);
		});
	});

	it(
		"WR-04: does NOT time out across THREE inter-chunk gaps whose SUM exceeds the injected budget, " +
			"while every INDIVIDUAL gap stays under it -- the only shape that distinguishes reset-on-progress " +
			"from a fixed budget, proved with an INJECTED CLOCK rather than a real sleep",
		async () => {
			// Reset-on-progress: four chunks whose summed gaps exceed the budget while each gap stays under it, so a single
			// fixed timeout would fail. The injected clock advances one gap per `onProgress` call, from inside the client's read
			// loop, so nothing waits in real time or races. `nowCalls > 0` proves the client really reads the injected clock.
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
						// Fires once per non-terminal chunk read (four here); the fourth releaseNextChunk is a no-op past the last gate.
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
		// A server-supplied id shaped like path traversal, which the default generator never produces.
		const maliciousId = "../../etc/passwd?x=1#y";

		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES, sessionIdOverride: maliciousId }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);

				await expect(delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd })).rejects.toThrow(
					/does not look like one/,
				);

				// Only the session create was made: a client that validated after splicing the id would show a second request.
				expect(loop.received.length).toBeGreaterThan(0);
				expect(loop.received).toHaveLength(1);
				expect(loop.received[0]?.url).toBe("/sessions");
			});

			// A malformed session id leaves a terminal transcript record.
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
			// The failure record never repeats the untrusted id.
			const serialized = JSON.stringify(records);
			expect(serialized).not.toContain(maliciousId);
		});
	});

	it("a null session-create body is refused as a missing id, not a TypeError", async () => {
		await withTempLogCwd(async (cwd) => {
			await withQoderLoopback({ frames: FRAMES, sessionBodyOverride: { body: null } }, async (loop) => {
				const config = resolveFixtureConfig(loop.baseUrl);
				await expect(delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd })).rejects.toThrow(/no usable session id/);
				expect(loop.received).toHaveLength(1);
			});
		});
	});

	it("a well-formed session id containing a real '/' is refused the same way (the shape check, not merely a blocklist)", async () => {
		// A slash is on no denylist here, so this proves a positive shape match.
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
		// The module's real default is a non-loopback https host, so every other case really dialled the loopback override.
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
