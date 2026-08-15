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
 * ---------------------------------------------------------------------------
 * Event-gated stream splitting, not a duration (2026-08 flake fix)
 * ---------------------------------------------------------------------------
 * This helper used to split a stream response across two `res.write()` calls
 * separated by a fixed millisecond delay option (default 20ms; WR-07's
 * inactivity-timeout test overrode it to 400ms). That WALL-CLOCK duration is
 * what made `tests/integration/qoder-delegate.test.ts` intermittently red:
 * its own `elapsed` assertion started its clock BEFORE `delegateTask`, so
 * `elapsed` additionally covered three HTTP round trips and six synchronous
 * `appendFileSync` transcript writes before the client's 60ms injected
 * deadline even armed (`client.ts:706-710`) -- against a 340ms total slack
 * budget, that is routinely exceeded under vitest's fork-parallel scheduling
 * jitter on Windows. No WIDER duration fixes this: any fixed number is a race
 * against however loaded the machine happens to be at that moment.
 *
 * That delay option is gone. In its place, `QoderLoopbackHandle` exposes
 * `firstChunkWritten` (a promise that resolves once the first -- or only --
 * chunk has genuinely been written to the response) and `releaseSecondChunk`
 * (a caller-controlled gate the server awaits before writing the second half
 * of a split stream). A test now awaits `firstChunkWritten` to know, as a
 * FACT, that the first read already happened, instead of guessing at a
 * duration long enough for it to probably have happened. Nothing here is a
 * duration: the server writes chunk one, resolves a promise, and waits on
 * another promise only the test resolves.
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
	 * character offset into `frames`. The server writes the first chunk,
	 * resolves the handle's `firstChunkWritten` promise, then AWAITS the
	 * handle's `releaseSecondChunk()` gate before writing the second chunk and
	 * ending the response -- an event a test controls, never a duration it
	 * races. Omitted (or out of range) means the whole body is written in one
	 * call, and `firstChunkWritten` still resolves once that single write has
	 * happened, so a caller may always await it without hanging.
	 */
	splitStreamAt?: number;
	/** Per-endpoint status overrides. */
	statusOverrides?: QoderLoopbackStatusOverrides;
	/**
	 * Override the session id returned by `POST /sessions`, in place of the
	 * default `sess_kypi_loopback_<n>`. WR-08's own test uses this to prove the
	 * client refuses (rather than blindly splices into a request path) a
	 * server-supplied id shaped like `../../etc/passwd` or containing a `?`/`#`
	 * -- a value the DEFAULT id generator can never produce on its own.
	 */
	sessionIdOverride?: string;
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
	/**
	 * Resolves once the stream response's first chunk (or its only chunk, when
	 * `splitStreamAt` was not set) has genuinely been written. Await this
	 * before asserting anything that depends on "the first read already
	 * happened" -- it is a FACT the server reports, replacing the old
	 * millisecond-delay option that only approximated it.
	 */
	firstChunkWritten: Promise<void>;
	/**
	 * Release the gate the server is awaiting before it writes a split
	 * stream's second chunk. Idempotent -- calling it more than once, or when
	 * `splitStreamAt` was never set, is a harmless no-op. Teardown calls this
	 * itself if a test never does, so a test that returns early (a failed
	 * assertion, an early `return`) can never deadlock the helper.
	 */
	releaseSecondChunk: () => void;
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
 * calls gated on the caller-controlled `releaseGate` promise rather than a
 * wall-clock delay -- see the module docstring's "Event-gated stream
 * splitting" section for why a duration could not do this reliably.
 */
async function writeStreamBody(
	res: ServerResponse,
	status: number,
	frames: string,
	splitAt: number | undefined,
	onFirstChunkWritten: () => void,
	releaseGate: Promise<void>,
): Promise<void> {
	res.writeHead(status, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "close",
	});
	if (status < 200 || status >= 300) {
		res.end();
		// No bytes were ever written -- still resolve the gate so a caller that
		// unconditionally awaits `firstChunkWritten` (rather than branching on
		// the status it forced) is never left hanging.
		onFirstChunkWritten();
		return;
	}
	if (splitAt !== undefined && splitAt > 0 && splitAt < frames.length) {
		res.write(frames.slice(0, splitAt));
		// The FIRST chunk genuinely landed on the wire -- a caller can now await
		// this as a FACT, replacing the old delay-based option that only
		// approximated "the first read happened" with a wall-clock guess.
		onFirstChunkWritten();
		await releaseGate;
		res.write(frames.slice(splitAt));
	} else {
		res.write(frames);
		onFirstChunkWritten();
	}
	res.end();
}

/** A minimal resolvable-from-outside promise, used for the event gates below. */
function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

/**
 * Stand a Cloud-Agents-shaped capture server on `127.0.0.1`, await `fn` with
 * it, then close it and release the port.
 *
 * The server is closed in the `finally` and the close is AWAITED, so the
 * next test binds against a port this one has genuinely given back.
 * Lingering keep-alive sockets are destroyed for the same reason. Every
 * in-flight responder is tracked and AWAITED here too, after the
 * second-chunk gate is force-released -- a responder still pending at
 * teardown is a live timer leaked into a neighbouring test's event loop.
 * [threat T-08-16]
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

	// The event gate replacing the old delay-based option (see the module
	// docstring's "Event-gated stream splitting" section). `firstChunkWritten`
	// resolves once the stream's first (or only) chunk has genuinely been
	// written; `releaseSecondChunk` is the caller-controlled gate the server
	// awaits before writing a split stream's second chunk.
	const firstChunkWrittenGate = createDeferred<void>();
	const secondChunkGate = createDeferred<void>();
	let secondChunkReleased = false;
	const releaseSecondChunk = (): void => {
		if (secondChunkReleased) {
			return;
		}
		secondChunkReleased = true;
		secondChunkGate.resolve();
	};

	// Every in-flight request responder, tracked so teardown can await it
	// instead of leaving one running past the server close.
	const pendingResponders = new Set<Promise<void>>();

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
						id: opts.sessionIdOverride ?? `sess_kypi_loopback_${sessionCounter}`,
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
					await writeStreamBody(
						res,
						status,
						frames,
						opts.splitStreamAt,
						firstChunkWrittenGate.resolve,
						secondChunkGate.promise,
					);
					return;
				}

				// An unrecognised path or method arrives at the test as a captured
				// request with a surprising `url`, matching `loopback.ts`'s own
				// "accept any path" convention -- a routing mistake surfaces as
				// data, not as a hang against a 404 the client never expected.
				writeJson(res, 404, { error: `qoder-loopback: no route for ${method} ${url}` });
			};

			// Tracked, not fire-and-forget: teardown awaits every entry here
			// before it destroys sockets and closes the server, so a responder
			// still mid-flight (e.g. awaiting `secondChunkGate`) can never
			// outlive its own test. [threat T-08-16]
			const responderPromise: Promise<void> = answer().catch((error: unknown) => {
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
			pendingResponders.add(responderPromise);
			void responderPromise.finally(() => {
				pendingResponders.delete(responderPromise);
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
		return await fn({
			baseUrl,
			port: address.port,
			received,
			firstChunkWritten: firstChunkWrittenGate.promise,
			releaseSecondChunk,
		});
	} finally {
		// Release the gate FIRST: a test that failed (or returned early) before
		// calling `releaseSecondChunk` itself must not deadlock teardown on a
		// responder that is awaiting a gate nobody will ever open.
		releaseSecondChunk();
		// Now await every tracked responder -- one still pending here (e.g.
		// mid-`writeStreamBody`, having just had its gate released) is a live
		// timer that must finish before the sockets it is writing to are
		// destroyed out from under it.
		await Promise.allSettled(pendingResponders);
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
