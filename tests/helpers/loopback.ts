/**
 * A `127.0.0.1` OpenAI-completions capture server: what Pi actually put on the
 * wire, with no credential and no egress.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * `fauxProvider` payloads are fixtures THIS repository writes.
 * `tests/helpers/faux.ts` says so at length and Phase 2 correctly refused to
 * over-claim from them: `buildOpenAiFixturePayload` is our idea of what an
 * OpenAI-completions body looks like, so asserting on it proves that our
 * fixture builder agrees with our assertion and nothing else.
 *
 * This helper closes that gap without a key and without a socket leaving the
 * machine. Stand a `node:http` server on `127.0.0.1`, point a provider's
 * `baseUrl` at it, and let Pi's REAL `openai-completions` adapter build, encode
 * and send the request body. The bytes captured here were produced by Pi, not
 * by us.
 *
 * ---------------------------------------------------------------------------
 * Why a loopback URL is a sound stand-in for DashScope
 * ---------------------------------------------------------------------------
 * `detectCompat(model)` keys entirely on `model.provider` compared against a
 * fixed list of provider ids, and on `model.baseUrl.includes(...)` against a
 * fixed list of host substrings — `api.z.ai`, `api.together.ai`, `api.moonshot.`,
 * `openrouter.ai`, `api.cloudflare.com`, `gateway.ai.cloudflare.com`,
 * `integrate.api.nvidia.com`, `api.ant-ling.com`, `cerebras.ai`, `api.x.ai`,
 * `chutes.ai`, `deepseek.com`, `opencode.ai`
 * [VERIFIED: pi-ai 0.84.1 `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:1161-1221`].
 * There is no `aliyuncs`, `dashscope`, `model studio` or `qwen` branch anywhere
 * in that function [VERIFIED: executed 2026-08-13 — `grep -c aliyuncs` on that
 * file is `0`].
 *
 * `http://127.0.0.1:<port>/v1` matches none of those substrings, and neither
 * does a DashScope base URL. So for a provider whose id is also not on the
 * hard-coded list, the detected `compat` for a loopback URL is identical to the
 * detected `compat` for DashScope, and the emission path through
 * `openai-completions` is therefore byte-for-byte the DashScope path except for
 * the URL string itself. That is what makes a capture here evidence about
 * DashScope rather than evidence about a local test server.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * It proves what Pi EMITS. It says nothing whatsoever about what DashScope
 * ACCEPTS. A body that this server records perfectly may still be rejected by
 * the real provider — a wrong `enable_thinking` spelling, a field the gateway
 * refuses, a model id that does not exist in the caller's workspace. Those are
 * `RB-03-01` (a DashScope turn returns 200) and `RB-03-02` (the second turn of
 * a tool-calling sequence returns 200 rather than the `reasoning_content` 400)
 * in `docs/RUNBOOK.md`, both OUTSTANDING, and nothing green in this repository
 * may be read as discharging either of them.
 *
 * Requirements served: PROV-03 (the explicit DashScope `compat` block reaches
 * the wire) and PROV-10 (`requiresReasoningContentOnAssistantMessages` puts
 * `reasoning_content` on an assistant message carrying a tool call).
 *
 * ---------------------------------------------------------------------------
 * Loopback only, enforced HERE and not at the call site
 * ---------------------------------------------------------------------------
 * {@link assertLoopbackUrl} throws before {@link withLoopbackCompletions} hands
 * its `baseUrl` to anybody, so a copy-paste that reintroduces a real host fails
 * loudly instead of quietly issuing a live provider request from CI with
 * whatever credentials the runner happens to hold. [threat T-03-03-01]
 *
 * The literal `127.0.0.1` is deliberately written out TWICE — once in the
 * `listen` call, once in the refusal — rather than shared through one constant.
 * A shared constant is exactly the shape that defeats the guard: editing it to
 * a real host would move the bind and the assertion together, they would still
 * agree, and the refusal would pass while the server it describes was no longer
 * on loopback. Two independent literals cannot agree by accident.
 *
 * ---------------------------------------------------------------------------
 * Asynchronous by design
 * ---------------------------------------------------------------------------
 * `withStubBin` in `tests/helpers/stub-bin.ts` rejects a thenable callback
 * because it deletes its temp directory the instant the callback returns.
 * {@link withLoopbackCompletions} is the ASYNC mirror — `tests/helpers/logs.ts`
 * `withTempLogCwd` is the shape to compare it against — and must NOT copy that
 * guard: the whole point is that the server outlives an awaited callback. The
 * distinction is recorded as a rule at `tests/helpers/session.ts:53-61`.
 *
 * ---------------------------------------------------------------------------
 * Throw, never soften
 * ---------------------------------------------------------------------------
 * Every failure path throws with the remedy in the message. There is
 * deliberately no escape hatch that removes a case when a prerequisite is
 * missing; an auditor grepping this directory for one must find nothing,
 * because a helper that excuses itself turns CI green having verified nothing.
 *
 * Zero dependencies: `node:http` only. `tests/unit/pinning.test.ts` asserts
 * `devDependencies` equals exactly the six audited pins, so no test-server
 * package may ever be added here. [threat T-03-03-SC]
 */
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";

/** One request the server received, recorded before any response is written. */
export interface LoopbackRequest {
	/** `POST` for a completions call. Recorded so a wrong verb is visible. */
	method: string;
	/**
	 * The request-target as Pi sent it, e.g. `/v1/chat/completions`.
	 *
	 * The server accepts ANY path under its base rather than only the one the
	 * adapter is expected to use: a path mismatch must surface here as a
	 * captured request with a surprising `url`, not as a test that hangs against
	 * a 404 the adapter never expected.
	 */
	url: string;
	/** Raw request headers, lower-cased by Node. */
	headers: IncomingHttpHeaders;
	/** The body exactly as it arrived, before any parsing. */
	rawBody: string;
	/**
	 * `JSON.parse(rawBody)` when it parses, `undefined` when it does not.
	 *
	 * A parse failure arrives at the test as data. Throwing inside the request
	 * handler would surface as a socket error at the adapter, which reads as a
	 * transport problem and hides the actual finding — that Pi sent something
	 * that is not JSON.
	 */
	body: unknown;
}

/** How the server should answer. Anything not supplied uses the default SSE reply. */
export interface LoopbackOptions {
	/**
	 * Replace the whole response for a test that needs an error shape.
	 *
	 * The capture has already been recorded on the handle before this runs, so a
	 * responder that writes a 429 does not cost the test its assertion.
	 */
	respond?: (request: LoopbackRequest, response: ServerResponse) => void | Promise<void>;
}

/** What the callback gets. */
export interface LoopbackHandle {
	/** `http://127.0.0.1:<port>/v1` — already passed through {@link assertLoopbackUrl}. */
	baseUrl: string;
	/** The ephemeral port the OS handed out. */
	port: number;
	/**
	 * Every request received, in arrival order.
	 *
	 * Assert this is non-empty BEFORE asserting anything about its contents. A
	 * server that captured nothing satisfies every assertion about the bodies it
	 * holds without executing one of them. [threat T-03-03-05]
	 */
	requests: LoopbackRequest[];
}

/**
 * Throw unless `url` is on loopback.
 *
 * Exported so a test can prove the refusal actually fires — a guard nobody
 * exercises is a guard nobody knows is dead.
 */
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

	// The second of the two independent `127.0.0.1` literals. See the module
	// docstring: sharing one constant with the `listen` call below would let a
	// single edit move both and keep them agreeing.
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

/**
 * The default reply: a minimal but VALID OpenAI-completions SSE sequence.
 *
 * One chunk with an assistant text delta, one with a `finish_reason`, then the
 * `data: [DONE]` sentinel. Without a terminating sentinel the adapter waits for
 * more of a stream that will never arrive and the test hangs rather than fails.
 * [threat T-03-03-04]
 */
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
 * Stand a completions-shaped capture server on `127.0.0.1`, await `fn` with it,
 * then close it and release the port.
 *
 * The server is closed in the `finally` and the close is AWAITED, so the next
 * test binds against a port this one has genuinely given back. Lingering
 * keep-alive sockets are destroyed for the same reason: `server.close()` only
 * stops new connections, and one held socket keeps both the port and the
 * process alive. [threat T-03-03-03]
 */
export async function withLoopbackCompletions<T>(
	opts: LoopbackOptions,
	fn: (handle: LoopbackHandle) => T | Promise<T>,
): Promise<T> {
	const requests: LoopbackRequest[] = [];

	// Structural, so `node:net`'s `Duplex` need not be imported: the only thing
	// wanted from a socket here is the ability to destroy it.
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
				// Deliberately swallowed: `body === undefined` IS the finding, and it
				// reaches the test as data. See LoopbackRequest.body.
				body = undefined;
			}

			const record: LoopbackRequest = {
				method: req.method ?? "",
				url: req.url ?? "",
				headers: req.headers,
				rawBody,
				body,
			};
			// Recorded BEFORE the response is written, so an overriding responder
			// that returns an error shape still leaves the caller its capture.
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
				// Never throw out of a request handler: an uncaught throw here is an
				// unhandled rejection in the server, which surfaces at the adapter as
				// a transport failure and hides whatever the responder actually did.
				const detail = error instanceof Error ? error.message : String(error);
				if (!res.headersSent) {
					res.writeHead(500, { "content-type": "text/plain" });
				}
				res.end(`kypi-loopback responder threw: ${detail}\n`);
			});
		});
	});

	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
		});
	});

	await new Promise<void>((resolveListening, rejectListening) => {
		server.once("error", rejectListening);
		// The first of the two independent `127.0.0.1` literals. Port 0 asks the OS
		// for a free ephemeral port, so parallel vitest workers cannot collide.
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", rejectListening);
			resolveListening();
		});
	}).catch((error: unknown) => {
		// TEAR DOWN BEFORE RETHROWING. This `catch` runs BEFORE the `try` below, so
		// its `finally` never executes: without these two lines the server object
		// and its `connection` listener survive the throw. In practice the server
		// never bound so no port leaks, but the listener does, and there is no
		// second chance to remove it.
		server.removeAllListeners("connection");
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
			// `cause`, so the underlying EACCES / EADDRINUSE code survives. Flattening
			// the error into `detail` alone loses `error.code` and the original stack,
			// which are the two things that say WHICH of the three causes it was.
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
	// The guard runs on the URL about to be handed out, so a caller cannot forget
	// it and an edit to the bind host above cannot escape it.
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
