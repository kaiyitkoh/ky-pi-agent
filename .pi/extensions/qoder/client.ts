/**
 * Qoder Cloud Agents HTTP client: config resolution, SSE parser, three-step request sequence. Registers nothing; index.ts does.
 * resolveQoderConfig and parseSseFrames are pure and never throws on bad input.
 * Delegated work runs in Qoder's hosted loop, outside this harness's guard and wire inspector (docs/ROUTING.md).
 * Official API only (docs.qoder.com, Bearer PAT at https://api.qoder.com/api/v1/cloud); the unofficial npm providers forge signatures against Qoder's ToS.
 * The SSE event enum is known-incomplete, so unknown events are skipped; the live check is in docs/RUNBOOK.md.
 */
import { appendJsonl, QODER_LOG_BASE } from "../../lib/jsonl.ts";
import { redactDeep } from "../diagnostics/redact.ts";

/** The personal access token. Generated once at qoder.com/account/integrations, shown only once. */
export const QODER_TOKEN_ENV = "QODER_PERSONAL_ACCESS_TOKEN";

/** A pre-configured agent id; created once, never per task. */
export const QODER_AGENT_ID_ENV = "QODER_AGENT_ID";

/** A pre-configured environment id; same one-time setup as the agent id. */
export const QODER_ENVIRONMENT_ID_ENV = "QODER_ENVIRONMENT_ID";

/** Optional override; only https or a 127.0.0.1 loopback URL is accepted. */
export const QODER_BASE_URL_ENV = "QODER_BASE_URL";

/** The real Cloud Agents base URL, used whenever {@link QODER_BASE_URL_ENV} is unset. */
export const DEFAULT_QODER_BASE_URL = "https://api.qoder.com/api/v1/cloud";

/** The personal access token's required prefix. A token that lacks it is not a Qoder PAT. */
const TOKEN_PREFIX = "pt-";

/** Upper bound on a delegated task's length after trimming; catches a runaway payload (ASVS V5). */
export const MAX_TASK_CHARS = 20_000;

/** The resolved, validated configuration {@link delegateTask} needs. */
export interface QoderConfig {
	readonly token: string;
	readonly agentId: string;
	readonly environmentId: string;
	readonly baseUrl: string;
}

/** What {@link resolveQoderConfig} returns: a validated config, or a refusal with an actionable message. */
export type QoderConfigResult =
	| { readonly ok: true; readonly config: QoderConfig }
	| { readonly ok: false; readonly message: string };

/**
 * Resolve and validate config from an injected environment; never throws and never guesses a credential or id.
 * Refusals come one class at a time: missing variables, then token shape, then base-URL scheme.
 */
export function resolveQoderConfig(env: NodeJS.ProcessEnv): QoderConfigResult {
	const token = env[QODER_TOKEN_ENV];
	const agentId = env[QODER_AGENT_ID_ENV];
	const environmentId = env[QODER_ENVIRONMENT_ID_ENV];

	const missing: string[] = [];
	if (!token) missing.push(QODER_TOKEN_ENV);
	if (!agentId) missing.push(QODER_AGENT_ID_ENV);
	if (!environmentId) missing.push(QODER_ENVIRONMENT_ID_ENV);

	if (missing.length > 0) {
		const parts: string[] = [`Qoder delegate refused: ${missing.join(", ")} not set.`];
		if (missing.includes(QODER_TOKEN_ENV)) {
			parts.push(
				`Generate a personal access token once at qoder.com/account/integrations (shown only ` +
					`once) and export it as ${QODER_TOKEN_ENV}.`,
			);
		}
		if (missing.includes(QODER_AGENT_ID_ENV) || missing.includes(QODER_ENVIRONMENT_ID_ENV)) {
			parts.push(
				`${QODER_AGENT_ID_ENV} and ${QODER_ENVIRONMENT_ID_ENV} are one-time Qoder console/API ` +
					"setup values -- an agent and an environment are created once and reused, never " +
					"per task. Create them once via the Qoder console or API and export the resulting ids.",
			);
		}
		return { ok: false, message: parts.join(" ") };
	}

	if (!(token as string).startsWith(TOKEN_PREFIX)) {
		return {
			ok: false,
			message:
				`Qoder delegate refused: ${QODER_TOKEN_ENV} does not start with "${TOKEN_PREFIX}" -- this ` +
				"does not look like a Qoder personal access token. Re-check the value generated at " +
				"qoder.com/account/integrations.",
		};
	}

	const rawBaseUrl = env[QODER_BASE_URL_ENV];
	const baseUrl = rawBaseUrl !== undefined && rawBaseUrl.length > 0 ? rawBaseUrl : DEFAULT_QODER_BASE_URL;

	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		return {
			ok: false,
			message: `Qoder delegate refused: ${QODER_BASE_URL_ENV} (${JSON.stringify(baseUrl)}) is not a parseable URL.`,
		};
	}

	// Enforced here, not at a call site, so a real non-TLS host can never receive the bearer credential;
	// the literal is independent of tests/helpers/loopback.ts.
	const isLoopback = parsed.hostname === "127.0.0.1";
	if (parsed.protocol !== "https:" && !isLoopback) {
		return {
			ok: false,
			message:
				`Qoder delegate refused: ${QODER_BASE_URL_ENV} (${JSON.stringify(baseUrl)}) is neither ` +
				"https: nor a 127.0.0.1 loopback URL -- refusing to send a bearer credential to an " +
				"unencrypted, non-loopback host.",
		};
	}

	return { ok: true, config: { token: token as string, agentId: agentId as string, environmentId: environmentId as string, baseUrl } };
}

/** One parsed SSE frame; `data` is JSON-parsed or `undefined`, and `event` may be any string. */
export interface SseFrame {
	readonly id?: string;
	readonly event?: string;
	readonly data: unknown;
}

/** What {@link parseSseFrames} returns for one call. */
export interface ParseSseResult {
	/** Every frame that completed (a full field block terminated by a blank line) inside this call's input. */
	readonly frames: SseFrame[];
	/** The trailing, not-yet-terminated block, if any -- prepend it to the next chunk. */
	readonly rest: string;
}

/** One field line, split on the first `:` with a single leading space stripped per the SSE spec. */
function splitField(line: string): { readonly field: string; readonly value: string } | undefined {
	const idx = line.indexOf(":");
	if (idx === -1) {
			// No colon: no defined value, ignored.
		return undefined;
	}
	const field = line.slice(0, idx);
	let value = line.slice(idx + 1);
	if (value.startsWith(" ")) {
		value = value.slice(1);
	}
	return { field, value };
}

/** Parse one already-isolated, blank-line-terminated field block into a frame. */
function parseOneFrame(block: string): SseFrame {
	let id: string | undefined;
	let event: string | undefined;
	const dataLines: string[] = [];

	for (const rawLine of block.split("\n")) {
		if (rawLine.length === 0) {
			continue;
		}
		const split = splitField(rawLine);
		if (split === undefined) {
			continue;
		}
		switch (split.field) {
			case "id":
				id = split.value;
				break;
			case "event":
				event = split.value;
				break;
			case "data":
				dataLines.push(split.value);
				break;
			default:
					// Other fields (`retry:`, future Qoder fields) are ignored.
				break;
		}
	}

	const rawData = dataLines.join("\n");
	let data: unknown;
	try {
		data = rawData.length > 0 ? JSON.parse(rawData) : undefined;
	} catch {
			// Malformed data is data to the caller; this parser never throws on untrusted input.
		data = undefined;
	}

	return { id, event, data };
}

/**
 * Parse the complete frames in `chunk`, returning the unterminated tail as `rest`. Stateless: feed `rest + nextChunk`.
 * Frames end at a blank line; CRLF is normalised first.
 */
export function parseSseFrames(chunk: string): ParseSseResult {
	const normalized = chunk.replace(/\r\n/g, "\n");
	const blocks = normalized.split("\n\n");
	// The last element is "" or an unterminated block.
	const rest = blocks.pop() ?? "";

	const frames: SseFrame[] = [];
	for (const block of blocks) {
		if (block.trim().length === 0) {
			continue;
		}
		frames.push(parseOneFrame(block));
	}
	return { frames, rest };
}

/** What kind of `event_start` announced a given `event_id`, if recognised. */
type EventKind = "message" | "thinking" | "other";

/** The accumulated result of folding a frame list. */
export interface FoldedResult {
	/** The delegated agent's own message text, concatenated in arrival order. */
	readonly text: string;
	/** The delegated agent's thinking text, concatenated in arrival order -- surfaced as progress, never as the result. */
	readonly thinkingText: string;
	/** Whether a `session.status_idle` frame was seen -- the completion signal. */
	readonly done: boolean;
	/** `stop_reason.type` from the idle frame, when present. */
	readonly stopReason?: string;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** Incremental fold state: each frame is read once, and message text is joined only when a result is requested. */
export interface ResultFolder {
	/** Fold more frames into the running state. */
	push(frames: readonly SseFrame[]): void;
	/** The result so far. */
	result(): FoldedResult;
}

/** Start an incremental fold; see {@link foldDelegatedResult} for the frame semantics. */
export function createResultFolder(): ResultFolder {
	const textChunks: string[] = [];
	let thinkingText = "";
	let done = false;
	let stopReason: string | undefined;
	const kindByEventId = new Map<string, EventKind>();

	function foldFrame(frame: SseFrame): void {
		const record = readRecord(frame.data);
		if (record === undefined) {
			return;
		}
		const type = readString(record.type);

		if (type === "event_start") {
			const inner = readRecord(record.event);
			const innerId = inner === undefined ? undefined : readString(inner.id);
			const innerType = inner === undefined ? undefined : readString(inner.type);
			if (innerId !== undefined) {
				const kind: EventKind = innerType === "agent.message" ? "message" : innerType === "agent.thinking" ? "thinking" : "other";
				kindByEventId.set(innerId, kind);
			}
			return;
		}

		if (type === "event_delta") {
			const eventId = readString(record.event_id);
			const delta = readRecord(record.delta);
			if (eventId === undefined || delta === undefined || readString(delta.type) !== "content_delta") {
				return;
			}
			const content = readRecord(delta.content);
			const deltaText = content === undefined ? undefined : readString(content.text);
			if (deltaText === undefined) {
				return;
			}
			const kind = kindByEventId.get(eventId);
			if (kind === "message") {
				textChunks.push(deltaText);
			} else if (kind === "thinking") {
				thinkingText += deltaText;
			}
			return;
		}

		if (type === "session.status_idle") {
			done = true;
			const sr = readRecord(record.stop_reason);
			const srType = sr === undefined ? undefined : readString(sr.type);
			if (srType !== undefined) {
				stopReason = srType;
			}
		}
	}

	return {
		push(frames) {
			for (const frame of frames) {
				foldFrame(frame);
			}
		},
		result() {
			return { text: textChunks.join(""), thinkingText, done, stopReason };
		},
	};
}

/**
 * Fold frames into the delegated agent's text: `agent.message` deltas accumulate until `session.status_idle`,
 * `agent.thinking` deltas separately. Unknown event types and malformed shapes are ignored because the documented enum is incomplete.
 */
export function foldDelegatedResult(frames: readonly SseFrame[]): FoldedResult {
	const folder = createResultFolder();
	folder.push(frames);
	return folder.result();
}

// -----------------------------------------------------------------------------
// Transcript — redacted, own base, never throws
// -----------------------------------------------------------------------------

/**
 * Redact `record` and append it to the `qoder` transcript stream; never throws, so logging cannot break the task.
 * Exported so index.ts writes its confirm record through the same redacted writer. The bearer token is never passed here.
 */
export function writeQoderTranscript(cwd: string, record: Record<string, unknown>): void {
	try {
		appendJsonl(cwd, QODER_LOG_BASE, redactDeep(record));
	} catch {
		// Swallowed deliberately -- see this function's own docstring.
	}
}

/** Inactivity deadline for the SSE read loop, reset on every chunk, so a long delegation survives and a stalled connection is reported. */
export const STREAM_INACTIVITY_TIMEOUT_MS = 5 * 60_000;

/** What {@link delegateTask} needs. */
export interface DelegateTaskOptions {
	/** Already-validated config from {@link resolveQoderConfig}. */
	readonly config: QoderConfig;
	/** The task to delegate, in plain language. Validated (trimmed, bounded) before it is sent. */
	readonly task: string;
	/** The session's own cwd, for the redacted transcript. */
	readonly cwd: string;
	/** Cancels the whole sequence -- threaded through so Esc during the main turn cancels this too. */
	readonly signal?: AbortSignal;
	/** A human-readable session title. Defaults to a fixed string when omitted. */
	readonly title?: string;
	/** Called with the accumulated thinking text each time it grows, for tool-call progress. */
	readonly onThinking?: (thinkingText: string) => void;
	/** Test-only seam for STREAM_INACTIVITY_TIMEOUT_MS. */
	readonly inactivityTimeoutMs?: number;
	/** Test-only clock seam (default `Date.now`). */
	readonly now?: () => number;
	/** Test-only: called once per chunk that resets the deadline, so a test can step its injected clock in lockstep with the read loop. */
	readonly onProgress?: () => void;
}

/** `Authorization`/`Content-Type` headers shared by every request in the sequence. */
function requestHeaders(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** Cancel a stream reader, swallowing cancellation errors so they never mask the timeout error that follows. */
async function cancelReaderQuietly(reader: ReadableStreamDefaultReader<Uint8Array>, reason: string): Promise<void> {
	try {
		await reader.cancel(reason);
	} catch {
			// Best-effort.
	}
}

/** Upper bound on the best-effort remote cancel, so Esc is never held up by an unreachable host. */
const CANCEL_TIMEOUT_MS = 5_000;

function abortedError(): Error {
	const error = new Error("Qoder delegate: aborted by the user; a remote cancel was requested.");
	error.name = "AbortError";
	return error;
}

/** `POST /sessions/{id}/cancel` (docs.qoder.com/cloud-agents/sessions.md, "Cancel Semantics"); best effort, never throws. */
async function cancelRemoteSession(
	config: QoderConfig,
	headers: Record<string, string>,
	encodedSessionId: string,
	cwd: string,
): Promise<void> {
	let status: number | undefined;
	try {
		const response = await fetch(`${config.baseUrl}/sessions/${encodedSessionId}/cancel`, {
			method: "POST",
			headers,
			signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
		});
		status = response.status;
	} catch {
		status = undefined;
	}
	writeQoderTranscript(cwd, { event: "qoder.session.cancel", status });
}

/**
 * Run the three-step sequence: create a session, open the event stream, send the task as `user.message`, fold until `session.status_idle`.
 * A stop_reason other than `end_turn` throws; an abort cancels the remote turn.
 * The task is validated (non-empty, bounded) first; the token goes only in the Authorization header, never in a transcript.
 */
export async function delegateTask(opts: DelegateTaskOptions): Promise<FoldedResult> {
	const trimmed = opts.task.trim();
	if (trimmed.length === 0) {
		throw new Error("Qoder delegate refused: the task is empty after trimming.");
	}
	if (trimmed.length > MAX_TASK_CHARS) {
		throw new Error(
			`Qoder delegate refused: the task is ${trimmed.length} characters, over the ${MAX_TASK_CHARS}-character limit.`,
		);
	}

	const { config, signal, cwd } = opts;
	const headers = requestHeaders(config.token);

	writeQoderTranscript(cwd, {
		event: "qoder.session.create.request",
		url: `${config.baseUrl}/sessions`,
		agentId: config.agentId,
		environmentId: config.environmentId,
	});

	const sessionResponse = await fetch(`${config.baseUrl}/sessions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			agent: { id: config.agentId, type: "agent" },
			environment_id: config.environmentId,
			title: opts.title ?? "ky-pi-agent delegated task",
		}),
		signal,
	});
	writeQoderTranscript(cwd, { event: "qoder.session.create.response", status: sessionResponse.status });
	if (!sessionResponse.ok) {
		throw new Error(`Qoder delegate: session create failed with HTTP ${sessionResponse.status}.`);
	}
	const sessionBody = (await sessionResponse.json()) as { id?: unknown };
	const sessionId = readString(sessionBody.id);
	if (sessionId === undefined || sessionId.length === 0) {
		throw new Error("Qoder delegate: session create returned no usable session id.");
	}
	// The id is untrusted network input spliced into request paths; refuse a malformed one instead of escaping it.
	if (!/^[A-Za-z0-9._-]{1,128}$/.test(sessionId)) {
		// Terminal transcript record so the log shows why the sequence stopped; the offending id is not echoed here.
		writeQoderTranscript(cwd, { event: "qoder.delegate.failed", cause: "malformed-session-id" });
		throw new Error(
			`Qoder delegate: session create returned a session id that does not look like one ` +
				`(${JSON.stringify(sessionId)}) -- refusing to splice it into a request path.`,
		);
	}
	const encodedSessionId = encodeURIComponent(sessionId);

	// The stream is opened before the task is sent so no early frame can be missed.
	writeQoderTranscript(cwd, {
		event: "qoder.stream.open.request",
		url: `${config.baseUrl}/sessions/${encodedSessionId}/events/stream`,
	});

	const streamResponse = await fetch(`${config.baseUrl}/sessions/${encodedSessionId}/events/stream`, {
		method: "GET",
		headers: { Authorization: headers.Authorization },
		signal,
	});
	writeQoderTranscript(cwd, { event: "qoder.stream.open.response", status: streamResponse.status });
	if (!streamResponse.ok || streamResponse.body === null) {
		throw new Error(`Qoder delegate: opening the event stream failed with HTTP ${streamResponse.status}.`);
	}

	const reader = streamResponse.body.getReader();

	writeQoderTranscript(cwd, {
		event: "qoder.event.send.request",
		url: `${config.baseUrl}/sessions/${encodedSessionId}/events`,
		taskChars: trimmed.length,
	});

	try {
		const eventResponse = await fetch(`${config.baseUrl}/sessions/${encodedSessionId}/events`, {
			method: "POST",
			headers,
			body: JSON.stringify({ events: [{ type: "user.message", content: [{ type: "text", text: trimmed }] }] }),
			signal,
		});
		writeQoderTranscript(cwd, { event: "qoder.event.send.response", status: eventResponse.status });
		if (!eventResponse.ok) {
			throw new Error(`Qoder delegate: sending the task failed with HTTP ${eventResponse.status}.`);
		}
	} catch (error) {
		await cancelReaderQuietly(reader, "task send failed");
		reader.releaseLock();
		if (signal?.aborted) {
			await cancelRemoteSession(config, headers, encodedSessionId, cwd);
			throw abortedError();
		}
		throw error;
	}

	const decoder = new TextDecoder();
	let buffer = "";
	const folder = createResultFolder();
	let folded: FoldedResult = folder.result();
	let lastReportedThinking = "";

	// Inactivity deadline: reset on every chunk, never a fixed budget from stream start. `now` is injectable in tests.
	const inactivityTimeoutMs = opts.inactivityTimeoutMs ?? STREAM_INACTIVITY_TIMEOUT_MS;
	const now = opts.now ?? Date.now;
	let lastProgressAt = now();

	try {
		while (!folded.done) {
			const remaining = inactivityTimeoutMs - (now() - lastProgressAt);
			if (remaining <= 0) {
				await cancelReaderQuietly(reader, "inactivity timeout");
				// Terminal transcript record, as for the malformed-session-id branch.
				writeQoderTranscript(cwd, {
					event: "qoder.delegate.failed",
					cause: "inactivity-timeout",
					afterMs: inactivityTimeoutMs,
					textChars: folded.text.length,
				});
				throw new Error(
					`Qoder delegate: the event stream produced no bytes for ${inactivityTimeoutMs}ms -- ` +
						"treating the connection as stalled rather than hanging indefinitely.",
				);
			}

			// Race against the remaining budget so a late-starting read cannot extend the deadline.
			const TIMED_OUT = Symbol("qoder-stream-read-timed-out");
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			const raced = await Promise.race([
				reader.read(),
				new Promise<typeof TIMED_OUT>((resolve) => {
					timeoutHandle = setTimeout(() => resolve(TIMED_OUT), remaining);
				}),
			]);
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
			}

			if (raced === TIMED_OUT) {
				// Cancel before throwing: a pending read() makes releaseLock() throw and mask this error.
				await cancelReaderQuietly(reader, "inactivity timeout");
				// Same terminal record as the pre-loop check.
				writeQoderTranscript(cwd, {
					event: "qoder.delegate.failed",
					cause: "inactivity-timeout",
					afterMs: inactivityTimeoutMs,
					textChars: folded.text.length,
				});
				throw new Error(
					`Qoder delegate: the event stream produced no bytes for ${inactivityTimeoutMs}ms -- ` +
						"treating the connection as stalled rather than hanging indefinitely.",
				);
			}

			const { value, done: streamDone } = raced;
			if (streamDone) {
				break;
			}
			// Progress: reset the deadline.
			lastProgressAt = now();
			// Test-only synchronisation point.
			opts.onProgress?.();

			buffer += decoder.decode(value, { stream: true });
			const parsed = parseSseFrames(buffer);
			buffer = parsed.rest;
			folder.push(parsed.frames);
			folded = folder.result();
			if (opts.onThinking && folded.thinkingText !== lastReportedThinking) {
				lastReportedThinking = folded.thinkingText;
				opts.onThinking(folded.thinkingText);
			}
		}
	} catch (error) {
		if (signal?.aborted) {
			await cancelReaderQuietly(reader, "aborted");
			await cancelRemoteSession(config, headers, encodedSessionId, cwd);
			throw abortedError();
		}
		throw error;
	} finally {
		reader.releaseLock();
	}

	// Flush what the transport left unterminated: a server may close without a final blank line and drop the last frame.
	buffer += decoder.decode();
	if (buffer.trim().length > 0) {
		const flushed = parseSseFrames(`${buffer}\n\n`);
		folder.push(flushed.frames);
		folded = folder.result();
		if (opts.onThinking && folded.thinkingText !== lastReportedThinking) {
			lastReportedThinking = folded.thinkingText;
			opts.onThinking(folded.thinkingText);
		}
	}

	writeQoderTranscript(cwd, {
		event: "qoder.delegate.result",
		done: folded.done,
		stopReason: folded.stopReason,
		textChars: folded.text.length,
	});

	if (folded.stopReason !== undefined && folded.stopReason !== "end_turn") {
		throw new Error(
			`Qoder delegate: the remote session ended with stop_reason "${folded.stopReason}" after ` +
				`${folded.text.length} characters -- the result is not a completed answer.`,
		);
	}

	// Check `done`: a dropped or early-closed stream must not be returned as a complete answer.
	if (!folded.done) {
		throw new Error(
			"Qoder delegate: the event stream ended without a session.status_idle frame after " +
				`${folded.text.length} characters -- the delegated result is incomplete and must not be ` +
				"treated as an answer.",
		);
	}

	return folded;
}
