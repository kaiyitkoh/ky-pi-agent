/**
 * A `127.0.0.1` HTTP+SSE fixture shaped like Qoder's Cloud Agents envelope (three endpoints, `id:`/`event:`/`data:`
 * frames, completion on `session.status_idle`), separate from loopback.ts's OpenAI-completions shape. It proves the
 * client builds and folds that envelope, not that the real service produces it. `127.0.0.1` is written twice on
 * purpose: one shared constant could move the bind and the guard together. Split streams are event-gated, never timed.
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
	/** Raw SSE frame text for the stream body; defaults to {@link DEFAULT_QODER_SSE_FRAMES}. */
	frames?: string;
	/**
	 * Split the stream into two writes at this offset; the second waits for `releaseSecondChunk()`. Omitted means one
	 * write. Ignored when `splitStreamAtMultiple` is set.
	 */
	splitStreamAt?: number;
	/** Split into more than two writes at these offsets, each gated on `releaseNextChunk()`: proves a deadline resets per chunk. */
	splitStreamAtMultiple?: readonly number[];
	/** Per-endpoint status overrides. */
	statusOverrides?: QoderLoopbackStatusOverrides;
	/** Override the session id `POST /sessions` returns, e.g. a path-traversal shape the default generator never makes. */
	sessionIdOverride?: string;
	/** Replace the whole `POST /sessions` JSON body, e.g. with `null`, to prove the client refuses a body that is not an object. */
	sessionBodyOverride?: { readonly body: unknown };
	/** Deliver frames only to a stream already open when the events POST arrives, so a late subscriber loses them. */
	liveStreamOnly?: boolean;
}

/** What the callback gets. */
export interface QoderLoopbackHandle {
	/** `http://127.0.0.1:<port>` — already passed through {@link assertQoderLoopbackUrl}. */
	baseUrl: string;
	/** The ephemeral port the OS handed out. */
	port: number;
	/** Every request received, in order. Assert non-empty before asserting on contents. */
	received: QoderLoopbackRequest[];
	/** Resolves once the stream's first (or only) chunk has been written. */
	firstChunkWritten: Promise<void>;
	/** Opens the gate before a split stream's second chunk. Idempotent; teardown calls it so an early return cannot deadlock. */
	releaseSecondChunk: () => void;
	/** With `splitStreamAtMultiple`, `chunkWritten[i]` resolves once chunk `i` is written; otherwise empty. */
	chunkWritten: readonly Promise<void>[];
	/** Opens the gate before the next chunk of a multi-split stream; a no-op past the last gate. */
	releaseNextChunk: () => void;
}

/** Throws unless `url` is on loopback; exported so a test can prove the refusal fires. */
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

	// The second independent `127.0.0.1` literal.
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

// The RESEARCH C.3 sample, verbatim: the default stream body.

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

/** The documented sample stream, used when a caller supplies no `frames`. */
export const DEFAULT_QODER_SSE_FRAMES =
	[DEFAULT_THINKING_START, DEFAULT_MESSAGE_START, DEFAULT_MESSAGE_DELTA, DEFAULT_STATUS_IDLE].join("\n") + "\n";


const SESSIONS_PATH_RE = /^\/sessions\/?$/;
const EVENTS_PATH_RE = /^\/sessions\/([^/]+)\/events\/?$/;
const CANCEL_PATH_RE = /^\/sessions\/([^/]+)\/cancel\/?$/;
const STREAM_PATH_RE = /^\/sessions\/([^/]+)\/events\/stream\/?$/;

/** JSON-encode and write a full response in one call. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text, "utf8") });
	res.end(text);
}

/** Writes `frames` as the stream body, optionally split in two around the caller-controlled `releaseGate`. */
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
		// Nothing written: still resolve, so a caller awaiting `firstChunkWritten` never hangs.
		onFirstChunkWritten();
		return;
	}
	if (splitAt !== undefined && splitAt > 0 && splitAt < frames.length) {
		res.write(frames.slice(0, splitAt));
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

/** Writes `frames` in chunks at `points`, awaiting `gates[i]` before chunk `i + 1`. */
async function writeStreamBodyMultiSplit(
	res: ServerResponse,
	status: number,
	frames: string,
	points: readonly number[],
	onChunkWritten: (index: number) => void,
	gates: readonly Promise<void>[],
): Promise<void> {
	res.writeHead(status, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "close",
	});
	if (status < 200 || status >= 300) {
		res.end();
		// Nothing written: still resolve every gate a caller might await.
		for (let i = 0; i < points.length + 1; i++) {
			onChunkWritten(i);
		}
		return;
	}
	const boundaries = [0, ...points, frames.length];
	for (let i = 0; i < boundaries.length - 1; i++) {
		res.write(frames.slice(boundaries[i] as number, boundaries[i + 1] as number));
		onChunkWritten(i);
		if (i < gates.length) {
			await gates[i];
		}
	}
	res.end();
}

/**
 * Stands a Cloud-Agents-shaped server on `127.0.0.1` for `fn`, then force-releases the gates, awaits every in-flight
 * responder, destroys sockets and awaits the close, so nothing leaks into the next test.
 */
export async function withQoderLoopback<T>(
	opts: QoderLoopbackOptions,
	fn: (handle: QoderLoopbackHandle) => T | Promise<T>,
): Promise<T> {
	const received: QoderLoopbackRequest[] = [];
	const frames = opts.frames ?? DEFAULT_QODER_SSE_FRAMES;
	const overrides = opts.statusOverrides ?? {};

	const sockets = new Set<{ destroy: () => void }>();

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

	// One gate per chunk boundary, popped in order by `releaseNextChunk`.
	const multiSplitPoints = opts.splitStreamAtMultiple ?? [];
	const chunkWrittenGates = Array.from({ length: multiSplitPoints.length + (multiSplitPoints.length > 0 ? 1 : 0) }, () => createDeferred<void>());
	const nextChunkGates = Array.from({ length: multiSplitPoints.length }, () => createDeferred<void>());
	let nextGateIndex = 0;
	const releaseNextChunk = (): void => {
		const gate = nextChunkGates[nextGateIndex];
		if (gate === undefined) {
			return;
		}
		nextGateIndex += 1;
		gate.resolve();
	};

	// Tracked so teardown can await them.
	const pendingResponders = new Set<Promise<void>>();

	let sessionCounter = 0;
	const eventsPosted = createDeferred<void>();
	let eventsPostedFlag = false;

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
					// Swallowed: `body === undefined` reaches the test as data.
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
			// Recorded before responding, so a non-2xx override still leaves a capture.
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
					if (opts.sessionBodyOverride !== undefined) {
						writeJson(res, status, opts.sessionBodyOverride.body);
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
					eventsPostedFlag = true;
					eventsPosted.resolve();
					return;
				}

				if (method === "POST" && CANCEL_PATH_RE.test(url)) {
					writeJson(res, 202, { status: "canceling" });
					return;
				}

				if (method === "GET" && STREAM_PATH_RE.test(url)) {
					const status = overrides.stream ?? 200;
					if (status < 200 || status >= 300) {
						res.writeHead(status, { "content-type": "application/json" });
						res.end(JSON.stringify({ error: `qoder-loopback: stream open forced to HTTP ${status}` }));
						return;
					}
					if (opts.liveStreamOnly === true) {
						res.writeHead(status, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "close" });
						res.flushHeaders();
						if (!eventsPostedFlag) {
							await eventsPosted.promise;
							res.write(frames);
						}
						res.end();
						firstChunkWrittenGate.resolve();
						return;
					}
					if (multiSplitPoints.length > 0) {
						await writeStreamBodyMultiSplit(
							res,
							status,
							frames,
							multiSplitPoints,
							(index) => chunkWrittenGates[index]?.resolve(),
							nextChunkGates.map((gate) => gate.promise),
						);
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

				// An unknown route is captured as data rather than hanging the client on a 404.
				writeJson(res, 404, { error: `qoder-loopback: no route for ${method} ${url}` });
			};

			const responderPromise: Promise<void> = answer().catch((error: unknown) => {
				// Never throw from a handler: the client would see a transport failure that hides what happened.
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
		// Port 0: an ephemeral port, so parallel workers cannot collide.
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", rejectListening);
			resolveListening();
		});
	}).catch((error: unknown) => {
		// Tear down before rethrowing: this catch runs before the try below, so its finally never runs.
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
	assertQoderLoopbackUrl(baseUrl);

	try {
		return await fn({
			baseUrl,
			port: address.port,
			received,
			firstChunkWritten: firstChunkWrittenGate.promise,
			releaseSecondChunk,
			chunkWritten: chunkWrittenGates.map((gate) => gate.promise),
			releaseNextChunk,
		});
	} finally {
		// Release the gates first, so a responder awaiting one cannot deadlock teardown.
		releaseSecondChunk();
		eventsPosted.resolve();
		for (const gate of nextChunkGates) {
			gate.resolve();
		}
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
