/**
 * A `127.0.0.1` OpenAI-completions capture server, so tests assert on bytes Pi's real adapter sent, not on our fixtures.
 * A loopback URL takes the same `detectCompat` path as a DashScope URL (neither matches its host list:
 * pi-ai dist/api/openai-completions.js `detectCompat`), but this proves only what Pi emits, never what DashScope accepts.
 * The two `127.0.0.1` literals (bind and refusal) are deliberately separate, so one edit cannot move both.
 */
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

/** One request the server received, recorded before any response is written. */
export interface LoopbackRequest {
	/** `POST` for a completions call. Recorded so a wrong verb is visible. */
	method: string;
	/** The request-target as sent; any path is accepted so a mismatch shows up here rather than as a hang on a 404. */
	url: string;
	/** Raw request headers, lower-cased by Node. */
	headers: IncomingHttpHeaders;
	/** The body exactly as it arrived, before any parsing. */
	rawBody: string;
	/** Parsed body, or `undefined` when it is not JSON: that finding reaches the test as data, not a socket error. */
	body: unknown;
}

/** How the server should answer. Anything not supplied uses the default SSE reply. */
export interface LoopbackOptions {
	/** Replaces the whole response; the capture is already recorded, so an error reply keeps the assertion. */
	respond?: (request: LoopbackRequest, response: ServerResponse) => void | Promise<void>;
}

/** What the callback gets. */
export interface LoopbackHandle {
	/** `http://127.0.0.1:<port>/v1` — already passed through {@link assertLoopbackUrl}. */
	baseUrl: string;
	/** The ephemeral port the OS handed out. */
	port: number;
	/** Every request received, in order. Assert it is non-empty first, or assertions over it pass vacuously. */
	requests: LoopbackRequest[];
}

/** Throws unless `url` is on loopback; exported so a test can prove the refusal fires. */
export function assertLoopbackUrl(url: string): void {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		throw new TypeError(
			`assertLoopbackUrl: ${JSON.stringify(url)} is not a parseable URL, so its host cannot ` +
				"be checked and it must not be used. Pass an absolute URL of the form " +
				"http://127.0.0.1:<port>/v1.",
		);
	}

	// The second of the two independent `127.0.0.1` literals.
	if (hostname !== "127.0.0.1") {
		throw new TypeError(
			[
				`assertLoopbackUrl: refusing ${JSON.stringify(url)} — its host is ${JSON.stringify(hostname)}, not 127.0.0.1.`,
				"",
				"This helper captures what Pi emits by standing a server on loopback and letting",
				"the real adapter talk to it. Pointed at a real host it stops being a capture and",
				"becomes a live provider request issued from a test run, with whatever credentials",
				"the machine holds. That is egress from CI, and it is what this refusal exists to",
				"prevent. [threat T-03-03-01]",
				"",
				"Remedy: use the `baseUrl` from the handle `withLoopbackCompletions` gives you, which",
				"is always http://127.0.0.1:<port>/v1. Verifying real-provider acceptance is RB-03-01",
				"and RB-03-02 in docs/RUNBOOK.md and is done by hand on a machine with credentials —",
				"never from this suite.",
			].join("\n"),
		);
	}
}

/** A minimal valid SSE reply; without the `[DONE]` sentinel the adapter waits forever. */
function defaultSseBody(model: string): string {
	const created = Math.floor(Date.now() / 1000);
	const base = { id: "chatcmpl-kypi-loopback", object: "chat.completion.chunk", created, model };

	const delta = {
		...base,
		choices: [{ index: 0, delta: { role: "assistant", content: "loopback" }, finish_reason: null }],
	};
	const final = {
		...base,
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};

	return `data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(final)}\n\ndata: [DONE]\n\n`;
}

/** The model id to echo back, when the captured body carried one. */
function modelOf(body: unknown): string {
	if (typeof body === "object" && body !== null) {
		const named = (body as { model?: unknown }).model;
		if (typeof named === "string" && named.length > 0) {
			return named;
		}
	}
	return "kypi-loopback";
}

/**
 * Awaits `fn` with a loopback capture server, then closes it, awaiting the close and destroying keep-alive sockets so
 * the port is genuinely released for the next test.
 */
export async function withLoopbackCompletions<T>(
	opts: LoopbackOptions,
	fn: (handle: LoopbackHandle) => T | Promise<T>,
): Promise<T> {
	const requests: LoopbackRequest[] = [];

	const sockets = new Set<{ destroy: () => void }>();

	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});
		req.on("end", () => {
			const rawBody = Buffer.concat(chunks).toString("utf-8");

			let body: unknown;
			try {
				body = JSON.parse(rawBody) as unknown;
			} catch {
				// `body === undefined` is the finding.
				body = undefined;
			}

			const record: LoopbackRequest = {
				method: req.method ?? "",
				url: req.url ?? "",
				headers: req.headers,
				rawBody,
				body,
			};
			// Recorded before responding, so an error-shaped responder still leaves the capture.
			requests.push(record);

			const answer = async (): Promise<void> => {
				if (opts.respond) {
					await opts.respond(record, res);
					return;
				}
				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					connection: "close",
				});
				res.end(defaultSseBody(modelOf(body)));
			};

			void answer().catch((error: unknown) => {
				// Never throw from the handler: it would surface at the adapter as a transport failure.
				const detail = error instanceof Error ? error.message : String(error);
				if (!res.headersSent) {
					res.writeHead(500, { "content-type": "text/plain" });
				}
				res.end(`kypi-loopback responder threw: ${detail}\n`);
			});
		});
	});

	// Named so the bind-failure path removes only this listener, not http's own `connectionListener`.
	const trackSocket = (socket: Socket): void => {
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
		});
	};
	server.on("connection", trackSocket);

	await new Promise<void>((resolveListening, rejectListening) => {
		server.once("error", rejectListening);
		// The first `127.0.0.1` literal. Port 0 lets the OS pick, so parallel workers cannot collide.
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", rejectListening);
			resolveListening();
		});
	}).catch((error: unknown) => {
		// This catch runs before the `try` below, so its `finally` never runs: tear down here, removing only our listener.
		server.removeListener("connection", trackSocket);
		server.close();

		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(
			[
				`withLoopbackCompletions: could not bind a server on 127.0.0.1 (${detail}).`,
				"",
				"This helper is how the suite observes what Pi puts on the wire without a",
				"credential and without egress, so the case that needed it must go red rather than",
				"quietly pass having observed nothing.",
				"",
				"Remedy: check that loopback binding is permitted for this process — a host",
				"firewall, a container without a loopback interface, or an exhausted ephemeral",
				"port range are the three causes seen in practice.",
			].join("\n"),
			// `cause` keeps `error.code` (EACCES / EADDRINUSE) and the original stack.
			{ cause: error },
		);
	});

	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error(
			`withLoopbackCompletions: the server reported a non-TCP address (${JSON.stringify(address)}), ` +
				"so no port can be read back and no baseUrl can be built. This helper only ever " +
				"listens on a TCP port; a pipe or an unbound server means the listen call above " +
				"was changed.",
		);
	}

	const baseUrl = `http://127.0.0.1:${address.port}/v1`;
	// Guarding the URL about to be handed out, so no caller or bind-host edit can skip it.
	assertLoopbackUrl(baseUrl);

	try {
		return await fn({ baseUrl, port: address.port, requests });
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
