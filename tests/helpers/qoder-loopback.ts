/**
 * A `127.0.0.1` HTTP+SSE fixture shaped for Qoder's Cloud Agents envelope —
 * ROUTE-11's offline proxy, the file `docs/RUNBOOK.md`'s `RB-05-01` will
 * name via `tests/integration/qoder-delegate.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * Why this is a SEPARATE helper from `tests/helpers/loopback.ts`
 * ---------------------------------------------------------------------------
 * `loopback.ts` captures Pi's own `openai-completions` adapter talking OpenAI
 * completions SSE (`data: {...}\n\n` chunks terminated by `data: [DONE]`).
 * Qoder's Cloud Agents envelope is a different shape entirely — three
 * sequential endpoints (`POST /sessions`, `POST /sessions/{id}/events`,
 * `GET /sessions/{id}/events/stream`) and an `id:`/`event:`/`data:` SSE
 * envelope with no `[DONE]` sentinel; completion is signalled by a
 * `session.status_idle` frame instead (05-RESEARCH.md Part C.3). Reusing
 * `defaultSseBody` would be the wrong shape (05-RESEARCH.md A.8 says this
 * explicitly), so this is a small, purpose-built sibling, not a fork.
 *
 * ---------------------------------------------------------------------------
 * Loopback only, enforced HERE and not at the call site
 * ---------------------------------------------------------------------------
 * {@link assertQoderLoopbackUrl} throws before {@link withQoderLoopback} hands
 * its `baseUrl` out, so a copy-paste that reintroduces a real host fails
 * loudly instead of quietly carrying a bearer credential to
 * `api.qoder.com` from CI. [threat T-05-22]
 *
 * The literal `127.0.0.1` is written out TWICE — once in the `listen` call,
 * once in the refusal — never shared through one constant. A shared constant
 * is exactly the shape that defeats the guard: editing it to a real host
 * would move the bind and the assertion together and they would still agree,
 * so the refusal would pass while the server it describes was no longer on
 * loopback. Two independent literals cannot agree by accident. This mirrors
 * `tests/helpers/loopback.ts#assertLoopbackUrl`'s own stated discipline
 * exactly.
 *
 * ---------------------------------------------------------------------------
 * What this proves, and what it does not
 * ---------------------------------------------------------------------------
 * A test built on this helper proves the harness's own HTTP client
 * (`.pi/extensions/qoder/client.ts#delegateTask`) constructs the right
 * requests and correctly parses and folds a response shaped like Qoder's own
 * documented envelope. It proves NOTHING about whether a real personal
 * access token against a real `agent_id`/`environment_id` produces this
 * exact envelope from `api.qoder.com` — that is `RB-05-01` in
 * `docs/RUNBOOK.md`, and it stays OUTSTANDING by construction until run by
 * hand on the work laptop with real credentials and real network egress,
 * neither of which exist on this machine. [threat T-05-24 -- also: a leaked
 * listener or a hung stream in CI would itself be a denial-of-service risk;
 * the server closes in a `finally` and every failure path (non-2xx, unknown
 * event type) is written to terminate rather than hang]
 *
 * ---------------------------------------------------------------------------
 * Fixture credential in a public repo
 * ---------------------------------------------------------------------------
 * This file records whatever `Authorization` header a caller's client sends
 * it, but never itself contains a credential-shaped literal — the fixture
 * token belongs to the test file that uses this helper, documented there as
 * obviously synthetic. [threat T-05-23]
 *
 * Zero dependencies: `node:http` only, matching `loopback.ts`'s own stated
 * discipline. `tests/unit/pinning.test.ts` asserts `devDependencies` equals
 * exactly six audited pins, so no test-server package may be added here.
 */
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

/** One request the server received, recorded before any response is written. */
export interface QoderLoopbackRequest {
	/** `POST` for the two mutating endpoints, `GET` for the stream. */
	method: string;
	/** The request-target as the client sent it, e.g. `/sessions`. */
	url: string;
	/** Raw request headers, lower-cased by Node. */
	headers: IncomingHttpHeaders;
	/** The body exactly as it arrived, before any parsing. */
	rawBody: string;
	/** `JSON.parse(rawBody)` when it parses (and a body was sent), `undefined` otherwise. */
	body: unknown;
}

/** Per-endpoint HTTP status overrides, for the non-2xx failure cases. */
export interface QoderLoopbackStatusOverrides {
	/** Status for `POST /sessions`. Defaults to 200. */
	sessions?: number;
	/** Status for `POST /sessions/{id}/events`. Defaults to 200. */
	events?: number;
	/** Status for `GET /sessions/{id}/events/stream`. Defaults to 200. */
	stream?: number;
}

/** How the server should answer. Anything not supplied uses the documented default shapes. */
export interface QoderLoopbackOptions {
	/**
	 * Raw SSE frame text written to the stream response body.
	 *
	 * Defaults to {@link DEFAULT_QODER_SSE_FRAMES} (the RESEARCH C.3 sample
	 * verbatim: one `agent.thinking` `event_start`, one `agent.message`
	 * `event_start`, one `event_delta`, and a terminal `session.status_idle`
	 * with `stop_reason.type === "end_turn"`). A caller that needs a
	 * distinct-text thinking delta, an injected unknown event type, or a
	 * multi-chunk message supplies its own frame text here.
	 */
	frames?: string;
	/**
	 * Split the stream body into two separate `res.write()` calls at this
	 * character offset into `frames`, with a short delay between them, so a
	 * frame genuinely arrives split across two reads on the client side
	 * rather than merely being split by the parser's own bookkeeping.
	 * Omitted (or out of range) means the whole body is written in one call.
	 */
	splitStreamAt?: number;
	/**
	 * Milliseconds to wait between the two `res.write()` calls `splitStreamAt`
	 * triggers. Defaults to 20 (long enough to force two genuinely separate
	 * socket reads, per `splitStreamAt`'s own doc comment). WR-07's
	 * inactivity-timeout test overrides this to something LONGER than the
	 * `inactivityTimeoutMs` it injects into `delegateTask`, so the gap itself
	 * is what proves the stall-detection fires. Ignored when `splitStreamAt`
	 * is not set.
	 */
	splitDelayMs?: number;
	/** Per-endpoint status overrides. */
	statusOverrides?: QoderLoopbackStatusOverrides;
}

/** What the callback gets. */
export interface QoderLoopbackHandle {
	/** `http://127.0.0.1:<port>` — already passed through {@link assertQoderLoopbackUrl}. */
	baseUrl: string;
	/** The ephemeral port the OS handed out. */
	port: number;
	/**
	 * Every request received, in arrival order.
	 *
	 * Assert this is non-empty BEFORE asserting anything about its contents.
	 * A server that captured nothing satisfies every assertion about the
	 * bodies it holds without executing one of them.
	 */
	received: QoderLoopbackRequest[];
}

/**
 * Throw unless `url` is on loopback.
 *
 * Exported so a test can prove the refusal actually fires — a guard nobody
 * exercises is a guard nobody knows is dead.
 */
export function assertQoderLoopbackUrl(url: string): void {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		throw new TypeError(
			`assertQoderLoopbackUrl: ${JSON.stringify(url)} is not a parseable URL, so its host cannot ` +
				"be checked and it must not be used. Pass an absolute URL of the form http://127.0.0.1:<port>.",
		);
	}

	// The second of the two independent `127.0.0.1` literals. See the module
	// docstring: sharing one constant with the `listen` call below would let a
	// single edit move both and keep them agreeing.
	if (hostname !== "127.0.0.1") {
		throw new TypeError(
			[
				`assertQoderLoopbackUrl: refusing ${JSON.stringify(url)} — its host is ${JSON.stringify(hostname)}, not 127.0.0.1.`,
				"",
				"This helper proves the harness's own Qoder client by standing a server on loopback and",
				"letting the real client talk to it. Pointed at a real host it stops being a proof of",
				"parsing and becomes a live request to api.qoder.com issued from a test run, carrying",
				"whatever bearer token the fixture happens to hold. That is egress from CI, and it is",
				"what this refusal exists to prevent. [threat T-05-22]",
				"",
				"Remedy: use the `baseUrl` from the handle `withQoderLoopback` gives you, which is",
				"always http://127.0.0.1:<port>. Verifying that api.qoder.com accepts a real PAT is",
				"RB-05-01 in docs/RUNBOOK.md and is done by hand on the work laptop -- never from this",
				"suite.",
			].join("\n"),
		);
	}
}

// -----------------------------------------------------------------------------
// The RESEARCH C.3 sample, verbatim -- the default stream body.
// -----------------------------------------------------------------------------

const DEFAULT_THINKING_START =
	"id: evt_00jjujk9fbnr55q5rtyp\n" +
	"event: event_start\n" +
	'data: {"event":{"id":"evt_00jjujk9fbnr55q5rtyp","type":"agent.thinking"},"type":"event_start"}\n';

const DEFAULT_MESSAGE_START =
	"id: evt_00jjujk9fbnr4wkj2gh8\n" +
	"event: event_start\n" +
	'data: {"event":{"id":"evt_00jjujk9fbnr4wkj2gh8","type":"agent.message"},"type":"event_start"}\n';

const DEFAULT_MESSAGE_DELTA =
	"id: evt_00jjujk9fbnr4wkj2gh8\n" +
	"event: event_delta\n" +
	'data: {"delta":{"content":{"text":"Hello","type":"text"},"index":0,"type":"content_delta"},"event_id":"evt_00jjujk9fbnr4wkj2gh8","type":"event_delta"}\n';

const DEFAULT_STATUS_IDLE =
	"id: evt_b2c3d4e5f6a7b8c9\n" +
	"event: session.status_idle\n" +
	'data: {"id":"evt_b2c3d4e5f6a7b8c9","type":"session.status_idle","stop_reason":{"type":"end_turn"},"processed_at":"2026-05-18T03:40:50.987654321Z"}\n';

/**
 * The documented RESEARCH C.3 sample stream, blank-line separated, used when
 * a caller does not supply `opts.frames`.
 */
export const DEFAULT_QODER_SSE_FRAMES =
	[DEFAULT_THINKING_START, DEFAULT_MESSAGE_START, DEFAULT_MESSAGE_DELTA, DEFAULT_STATUS_IDLE].join("\n") + "\n";

// -----------------------------------------------------------------------------
// Routing
// -----------------------------------------------------------------------------

const SESSIONS_PATH_RE = /^\/sessions\/?$/;
const EVENTS_PATH_RE = /^\/sessions\/([^/]+)\/events\/?$/;
const STREAM_PATH_RE = /^\/sessions\/([^/]+)\/events\/stream\/?$/;

/** JSON-encode and write a full response in one call. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text, "utf8") });
	res.end(text);
}

/**
 * Write `frames` as the stream body, optionally split into two `res.write()`
 * calls with a delay between them so a genuinely separate read occurs on the
 * client side rather than a single coalesced chunk.
 */
async function writeStreamBody(
	res: ServerResponse,
	status: number,
	frames: string,
	splitAt: number | undefined,
	splitDelayMs = 20,
): Promise<void> {
	res.writeHead(status, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "close",
	});
	if (status < 200 || status >= 300) {
		res.end();
		return;
	}
	if (splitAt !== undefined && splitAt > 0 && splitAt < frames.length) {
		res.write(frames.slice(0, splitAt));
		// A real delay, not a same-tick second write: two write() calls issued
		// back-to-back on loopback can still coalesce into one TCP read. The
		// delay forces a genuinely separate arrival on the client's stream
		// reader, which is the whole point of this option.
		await new Promise<void>((resolve) => {
			setTimeout(resolve, splitDelayMs);
		});
		res.write(frames.slice(splitAt));
	} else {
		res.write(frames);
	}
	res.end();
}

/**
 * Stand a Cloud-Agents-shaped capture server on `127.0.0.1`, await `fn` with
 * it, then close it and release the port.
 *
 * The server is closed in the `finally` and the close is AWAITED, so the
 * next test binds against a port this one has genuinely given back.
 * Lingering keep-alive sockets are destroyed for the same reason.
 */
export async function withQoderLoopback<T>(
	opts: QoderLoopbackOptions,
	fn: (handle: QoderLoopbackHandle) => T | Promise<T>,
): Promise<T> {
	const received: QoderLoopbackRequest[] = [];
	const frames = opts.frames ?? DEFAULT_QODER_SSE_FRAMES;
	const overrides = opts.statusOverrides ?? {};

	// Structural, so `node:net`'s `Duplex` need not be imported: the only
	// thing wanted from a socket here is the ability to destroy it.
	const sockets = new Set<{ destroy: () => void }>();

	let sessionCounter = 0;

	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});
		req.on("end", () => {
			const rawBody = Buffer.concat(chunks).toString("utf-8");

			let body: unknown;
			if (rawBody.length > 0) {
				try {
					body = JSON.parse(rawBody) as unknown;
				} catch {
					// Deliberately swallowed: `body === undefined` IS the finding, and
					// it reaches the test as data, matching `loopback.ts`'s own
					// convention.
					body = undefined;
				}
			}

			const record: QoderLoopbackRequest = {
				method: req.method ?? "",
				url: req.url ?? "",
				headers: req.headers,
				rawBody,
				body,
			};
			// Recorded BEFORE the response is written, so a non-2xx override still
			// leaves the caller its capture. [non-vacuity]
			received.push(record);

			const method = record.method;
			const url = record.url;

			const answer = async (): Promise<void> => {
				if (method === "POST" && SESSIONS_PATH_RE.test(url)) {
					sessionCounter += 1;
					const status = overrides.sessions ?? 200;
					if (status < 200 || status >= 300) {
						writeJson(res, status, { error: `qoder-loopback: session create forced to HTTP ${status}` });
						return;
					}
					writeJson(res, status, {
						id: `sess_kypi_loopback_${sessionCounter}`,
						type: "session",
						status: "idle",
						created_at: new Date().toISOString(),
					});
					return;
				}

				if (method === "POST" && EVENTS_PATH_RE.test(url)) {
					const status = overrides.events ?? 200;
					if (status < 200 || status >= 300) {
						writeJson(res, status, { error: `qoder-loopback: event send forced to HTTP ${status}` });
						return;
					}
					writeJson(res, status, { ok: true });
					return;
				}

				if (method === "GET" && STREAM_PATH_RE.test(url)) {
					const status = overrides.stream ?? 200;
					if (status < 200 || status >= 300) {
						res.writeHead(status, { "content-type": "application/json" });
						res.end(JSON.stringify({ error: `qoder-loopback: stream open forced to HTTP ${status}` }));
						return;
					}
					await writeStreamBody(res, status, frames, opts.splitStreamAt, opts.splitDelayMs);
					return;
				}

				// An unrecognised path or method arrives at the test as a captured
				// request with a surprising `url`, matching `loopback.ts`'s own
				// "accept any path" convention -- a routing mistake surfaces as
				// data, not as a hang against a 404 the client never expected.
				writeJson(res, 404, { error: `qoder-loopback: no route for ${method} ${url}` });
			};

			void answer().catch((error: unknown) => {
				// Never throw out of a request handler: an uncaught throw here is
				// an unhandled rejection in the server, which surfaces at the
				// client as a transport failure and hides whatever the responder
				// actually did.
				const detail = error instanceof Error ? error.message : String(error);
				if (!res.headersSent) {
					res.writeHead(500, { "content-type": "text/plain" });
				}
				res.end(`qoder-loopback responder threw: ${detail}\n`);
			});
		});
	});

	const trackSocket = (socket: Socket): void => {
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
		});
	};
	server.on("connection", trackSocket);

	await new Promise<void>((resolveListening, rejectListening) => {
		server.once("error", rejectListening);
		// The first of the two independent `127.0.0.1` literals. Port 0 asks the
		// OS for a free ephemeral port, so parallel vitest workers cannot
		// collide.
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", rejectListening);
			resolveListening();
		});
	}).catch((error: unknown) => {
		// TEAR DOWN BEFORE RETHROWING -- this `catch` runs BEFORE the `try`
		// below, so its `finally` never executes.
		server.removeListener("connection", trackSocket);
		server.close();

		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(
			[
				`withQoderLoopback: could not bind a server on 127.0.0.1 (${detail}).`,
				"",
				"This helper is how the suite observes the Qoder client's own request construction",
				"and stream parsing without a credential and without egress, so the case that needed",
				"it must go red rather than quietly pass having observed nothing.",
				"",
				"Remedy: check that loopback binding is permitted for this process -- a host",
				"firewall, a container without a loopback interface, or an exhausted ephemeral port",
				"range are the three causes seen in practice.",
			].join("\n"),
			{ cause: error },
		);
	});

	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error(
			`withQoderLoopback: the server reported a non-TCP address (${JSON.stringify(address)}), so no ` +
				"port can be read back and no baseUrl can be built.",
		);
	}

	const baseUrl = `http://127.0.0.1:${address.port}`;
	// The guard runs on the URL about to be handed out, so a caller cannot
	// forget it and an edit to the bind host above cannot escape it.
	assertQoderLoopbackUrl(baseUrl);

	try {
		return await fn({ baseUrl, port: address.port, received });
	} finally {
		for (const socket of sockets) {
			socket.destroy();
		}
		sockets.clear();
		await new Promise<void>((resolveClose) => {
			server.close(() => {
				resolveClose();
			});
		});
	}
}
