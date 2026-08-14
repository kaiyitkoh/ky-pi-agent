/**
 * ky-pi-agent — Qoder Cloud Agents HTTP client: config resolution, the
 * three-step request sequence and a defensive SSE parser. (ROUTE-11)
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * This module is the impure-but-testable half of the Qoder delegate tool:
 * everything needed to turn a plain-language task into a folded text result
 * from Qoder's own hosted agent loop, without touching Pi's extension API at
 * all. `index.ts` (this directory's sibling) is the only file that wires this
 * into a registered tool; nothing here registers anything.
 *
 *   - {@link resolveQoderConfig} — pure. Reads no environment itself; the
 *     caller hands in an environment object. Refuses, never guesses, and
 *     never throws.
 *   - {@link parseSseFrames} — pure, incremental. Feed it whatever chunk
 *     arrived; it returns the frames that completed and the leftover partial
 *     block to prepend to the next chunk. See its own docstring for the
 *     exact incremental-feeding recipe.
 *   - {@link foldDelegatedResult} — pure. Accumulates the delegated agent's
 *     own message text out of a frame list, ignoring its thinking traffic and
 *     completing on the session's own idle signal.
 *   - {@link delegateTask} — impure. The three-step HTTP sequence, streamed
 *     and folded, with a redacted transcript written to a gitignored log.
 *
 * ---------------------------------------------------------------------------
 * THE FOREIGN AGENT STATEMENT
 * ---------------------------------------------------------------------------
 * A task handed to {@link delegateTask} runs inside Qoder's OWN hosted agent
 * loop, with Qoder's own Read/Write/Edit/Glob/Grep/Bash tools, against a
 * container this repository does not control. None of this harness's own
 * controls apply to that work: not Pi's own tools, not this project's
 * AGENTS.md or system prompt, not the Phase 4 safety guard (branch
 * protection, `terraform`/`kubectl` confirmation, `.env`/`*.tfstate` read
 * blocks, the audit log), and not the Phase 2 wire inspector — no request or
 * response Qoder's own model makes is ever captured by this repository's
 * diagnostics. On a laptop where merging to `main` auto-deploys to AWS, this
 * means the harness's guard protects nothing Qoder does on its behalf. See
 * `index.ts`'s tool description for the user/model-facing statement of the
 * same fact, and `docs/ROUTING.md` for the full paragraph.
 *
 * ---------------------------------------------------------------------------
 * OFFICIAL SURFACE ONLY
 * ---------------------------------------------------------------------------
 * This client speaks only the official Cloud Agents HTTP API documented at
 * `docs.qoder.com`: a personal access token in an `Authorization: Bearer`
 * header, against `https://api.qoder.com/api/v1/cloud`. Two unofficial
 * packages exist on npm (`pi-provider-qoder`, `pi-qoder-provider`) that
 * instead reverse-engineer Qoder's own undocumented internal endpoints and
 * forge the signatures that endpoint expects — a breach of Qoder's Terms of
 * Service with an irreversible termination clause (05-RESEARCH.md Part C /
 * STACK.md §5 carry the exact ToS section numbers). Neither is imported,
 * vendored, forked or referenced by anything below; this file has zero
 * runtime dependencies beyond Node's own `fetch`.
 *
 * ---------------------------------------------------------------------------
 * UNVERIFIED — the SSE event-type enum, and why the live check stays
 * OUTSTANDING (RB-05-01)
 * ---------------------------------------------------------------------------
 * The Qoder docs page fetched for this phase showed exactly three event
 * `type` values (`agent.thinking`, `agent.message`, `session.status_idle`)
 * and never claimed that list was exhaustive. There is no PAT and no network
 * egress on this machine, so whether a real session emits additional event
 * types (a tool-use event from Qoder's own internal agent, an error event, a
 * different status transition) is UNVERIFIED. {@link parseSseFrames} and
 * {@link foldDelegatedResult} are written to fail safely on an unrecognised
 * `event:`/`data.type` value — skip it, never throw, never hang — precisely
 * because the enum is known-incomplete. Whether a real PAT against a real
 * `agent_id`/`environment_id` actually produces this envelope end-to-end is
 * the live check named `RB-05-01` in `docs/RUNBOOK.md`, and it is
 * OUTSTANDING by construction until run by hand on the work laptop. Nothing
 * in this file, and nothing green in this repository's test suite, may be
 * read as discharging it.
 *
 * ---------------------------------------------------------------------------
 * QODER IS A DELEGATE TOOL, NEVER A ROUTABLE MODEL
 * ---------------------------------------------------------------------------
 * Qoder appears in no `models.json` entry, no role→model map, no fallback
 * chain and no capability guard anywhere in this repository. The only way the
 * model can reach it is the one registered tool `index.ts` builds on top of
 * the exports below (05-CONTEXT.md decision 11).
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULES
 * ---------------------------------------------------------------------------
 * This file never spells the tool-registration call, not even in a comment
 * — `tests/unit/contributing-boundary.test.ts` matches it as a plain
 * substring across every tracked source under `.pi/extensions/`, and only
 * `index.ts` is allowlisted. It also never calls the direct-model-completion
 * route or hands back a raw provider object — `tests/unit/chokepoint-lint.
 * test.ts` scans this directory too, with no exemption.
 *
 * ---------------------------------------------------------------------------
 * TRANSCRIPT AND REDACTION
 * ---------------------------------------------------------------------------
 * The one credential this file ever handles — the personal access token — is
 * placed in exactly one place, the `Authorization` header of each outgoing
 * request, and is NEVER placed into a transcript record at all (not
 * redacted-after-the-fact; simply never written). Every transcript record
 * this file does write passes through `diagnostics/redact.ts`'s `redactDeep`
 * before {@link writeQoderTranscript} appends it, reusing DIAG-07's one
 * redaction rule rather than inventing a second, and lands only under the
 * gitignored `.pi/logs/` tree via `.pi/lib/jsonl.ts#appendJsonl` (own base
 * name `"qoder"`, never shared with diagnostics' or safety's own streams). A
 * transcript write failure never breaks the delegated task itself — mirrors
 * `safety/audit.ts#writeAuditRow`'s own "never throws" contract.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 *   client.ts (this file) — config resolution, SSE parsing, the HTTP client.
 *   index.ts              — the registered tool, its description and schema.
 */
import { appendJsonl } from "../../lib/jsonl.ts";
import { redactDeep } from "../diagnostics/redact.ts";

// -----------------------------------------------------------------------------
// Environment variable names and defaults
// -----------------------------------------------------------------------------

/** The personal access token. Generated once at qoder.com/account/integrations, shown only once. */
export const QODER_TOKEN_ENV = "QODER_PERSONAL_ACCESS_TOKEN";

/** A pre-configured agent id — one-time console/API setup, never created per task. See the module docstring. */
export const QODER_AGENT_ID_ENV = "QODER_AGENT_ID";

/** A pre-configured environment id — same one-time-setup posture as {@link QODER_AGENT_ID_ENV}. */
export const QODER_ENVIRONMENT_ID_ENV = "QODER_ENVIRONMENT_ID";

/** Optional override, for the loopback fixture a later plan builds — see the base-URL refusal below. */
export const QODER_BASE_URL_ENV = "QODER_BASE_URL";

/** The real Cloud Agents base URL, used whenever {@link QODER_BASE_URL_ENV} is unset. */
export const DEFAULT_QODER_BASE_URL = "https://api.qoder.com/api/v1/cloud";

/** The personal access token's required prefix. A token that lacks it is not a Qoder PAT. */
const TOKEN_PREFIX = "pt-";

/** Own base name for the transcript stream, distinct from diagnostics' and safety's own bases. */
const QODER_LOG_BASE = "qoder";

/**
 * Upper bound on a delegated task's length, checked after trimming.
 *
 * ASVS V5 input validation on the one model-supplied field this tool accepts,
 * mirroring `safety/index.ts`'s `approve_ky_command` params validation. A
 * bound this generous (roughly the length of a long paragraph of
 * instructions) exists to catch a runaway or adversarial payload, not to
 * constrain a genuine task description.
 */
export const MAX_TASK_CHARS = 20_000;

// -----------------------------------------------------------------------------
// Config resolution — pure
// -----------------------------------------------------------------------------

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
 * Resolve and validate the Qoder configuration from an injected environment
 * object. Pure: never reads the environment itself (the caller supplies it),
 * never throws, and never guesses a default for a credential or an id — only
 * for the base URL, whose documented default is public information.
 *
 * Refusal order: missing variables first (naming every missing one and the
 * one-time setup step for each kind), then the token's shape, then the base
 * URL's scheme. A caller that fixes the first refusal and calls again will
 * reach the next one in turn rather than seeing every failure class at once.
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

	// The base-URL seam a later plan's loopback fixture uses. Enforced HERE,
	// not merely at a call site, mirroring `tests/helpers/loopback.ts`'s own
	// `assertLoopbackUrl` discipline: a copy-paste that reintroduces a real,
	// non-TLS host must fail loudly rather than quietly carry a bearer
	// credential to it. The literal `127.0.0.1` below is this file's own
	// independent check -- it does not share a constant with any test helper.
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

// -----------------------------------------------------------------------------
// SSE parsing — pure, incremental
// -----------------------------------------------------------------------------

/**
 * One parsed SSE frame. `id`/`event` are the field lines the envelope
 * carries; `data` is the `data:` line(s) already JSON-parsed, or `undefined`
 * when the line was absent or did not parse -- never a throw. See the module
 * docstring's UNVERIFIED section: `event` may be any string, not only the
 * three documented so far.
 */
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
		// A field line with no colon carries no value the envelope defines.
		// Ignored rather than treated as an error -- see the module docstring's
		// UNVERIFIED section: this parser is deliberately tolerant of shapes it
		// was not shown.
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
				// Any other field name (SSE also defines `retry:`, and Qoder could
				// add its own) is ignored rather than fatal -- the same tolerant
				// posture the module docstring states for `event`/`data.type`.
				break;
		}
	}

	const rawData = dataLines.join("\n");
	let data: unknown;
	try {
		data = rawData.length > 0 ? JSON.parse(rawData) : undefined;
	} catch {
		// A malformed `data:` line is data to the caller, not a crash. See the
		// module docstring: this parser never throws on untrusted network input.
		data = undefined;
	}

	return { id, event, data };
}

/**
 * Parse as many complete frames as `chunk` contains, returning the leftover
 * partial block as `rest`.
 *
 * INCREMENTAL FEEDING RECIPE. This function is stateless per call; the
 * caller carries state by threading `rest` back in:
 *
 * ```ts
 * let buffer = "";
 * const frames: SseFrame[] = [];
 * for (const piece of incomingChunks) {
 *   const parsed = parseSseFrames(buffer + piece);
 *   frames.push(...parsed.frames);
 *   buffer = parsed.rest;
 * }
 * ```
 *
 * This is exactly what {@link delegateTask} does against a real `fetch`
 * stream, and what `tests/unit/qoder-client.test.ts` does against two
 * arbitrary chunk splits of the same fixture to prove the split point cannot
 * change the resulting frame sequence.
 *
 * Frames are separated by a blank line (`\n\n`; `\r\n\r\n` is normalised to
 * the same shape first, since Qoder's transport may use either).
 */
export function parseSseFrames(chunk: string): ParseSseResult {
	const normalized = chunk.replace(/\r\n/g, "\n");
	const blocks = normalized.split("\n\n");
	// The last element is either "" (chunk ended exactly on a blank line) or a
	// not-yet-terminated block -- either way it is not a complete frame yet.
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

// -----------------------------------------------------------------------------
// Folding — pure accumulation over a frame list
// -----------------------------------------------------------------------------

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

/**
 * Fold a frame list into the delegated agent's accumulated text.
 *
 * Accumulates `event_delta` frames whose parent `event_start` announced
 * `agent.message`, concatenating `delta.content.text` for
 * `delta.type === "content_delta"`, until a `session.status_idle` frame
 * arrives. `agent.thinking` deltas accumulate separately into
 * {@link FoldedResult.thinkingText} rather than the result text.
 *
 * UNRECOGNISED `event_start` TYPES, MALFORMED PAYLOAD SHAPES AND UNKNOWN
 * TOP-LEVEL `data.type` VALUES ARE ALL IGNORED, NEVER FATAL -- the module
 * docstring's UNVERIFIED section states why: the documented event enum is
 * known-incomplete, and a parser that assumed completeness would throw or
 * hang the first time a real PAT exercised it.
 */
export function foldDelegatedResult(frames: readonly SseFrame[]): FoldedResult {
	let text = "";
	let thinkingText = "";
	let done = false;
	let stopReason: string | undefined;
	const kindByEventId = new Map<string, EventKind>();

	for (const frame of frames) {
		const record = readRecord(frame.data);
		if (record === undefined) {
			continue;
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
			continue;
		}

		if (type === "event_delta") {
			const eventId = readString(record.event_id);
			const delta = readRecord(record.delta);
			if (eventId === undefined || delta === undefined || readString(delta.type) !== "content_delta") {
				continue;
			}
			const content = readRecord(delta.content);
			const deltaText = content === undefined ? undefined : readString(content.text);
			if (deltaText === undefined) {
				continue;
			}
			const kind = kindByEventId.get(eventId);
			if (kind === "message") {
				text += deltaText;
			} else if (kind === "thinking") {
				thinkingText += deltaText;
			}
			// kind "other" or unrecognised eventId: ignored, per the docstring.
			continue;
		}

		if (type === "session.status_idle") {
			done = true;
			const sr = readRecord(record.stop_reason);
			const srType = sr === undefined ? undefined : readString(sr.type);
			if (srType !== undefined) {
				stopReason = srType;
			}
			continue;
		}

		// Any other top-level `data.type` (or a frame with no recognisable type
		// at all) is silently ignored -- see the UNVERIFIED section above.
	}

	return { text, thinkingText, done, stopReason };
}

// -----------------------------------------------------------------------------
// Transcript — redacted, own base, never throws
// -----------------------------------------------------------------------------

/**
 * Redact `record` and append it to the `qoder` transcript stream. Never
 * throws -- a logging failure must not break the delegated task itself,
 * mirroring `safety/audit.ts#writeAuditRow`'s own contract. The
 * `Authorization` header value is never passed to this function at all; see
 * the call sites in {@link delegateTask}.
 *
 * WR-03: exported so `index.ts` can write the `qoder.delegate.confirm`
 * audit record through this SAME redacted writer/stream rather than
 * inventing a second one -- `index.ts` never touches `QODER_LOG_BASE` or
 * `redactDeep` directly.
 */
export function writeQoderTranscript(cwd: string, record: Record<string, unknown>): void {
	try {
		appendJsonl(cwd, QODER_LOG_BASE, redactDeep(record));
	} catch {
		// Swallowed deliberately -- see this function's own docstring.
	}
}

// -----------------------------------------------------------------------------
// The impure HTTP sequence
// -----------------------------------------------------------------------------

/**
 * WR-07: the SSE read loop's inactivity deadline. `while (!folded.done) {
 * await reader.read() }` used to terminate only on `session.status_idle`, on
 * stream close, or on `signal` abort -- a Qoder session that keeps the
 * connection open with no bytes at all (a stalled agent, a dropped
 * keepalive) pinned the tool call forever, with the only escape being the
 * user pressing Esc. Five minutes is deliberately generous: long enough that
 * a real delegation's thinking/message deltas (which reset the deadline on
 * every chunk, never on a fixed wall-clock budget) are never cut short, short
 * enough that a genuinely stalled connection is reported rather than hung on
 * indefinitely.
 */
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
	/**
	 * Test-only injection seam for {@link STREAM_INACTIVITY_TIMEOUT_MS}.
	 * Production code NEVER passes this -- it defaults to the real five-minute
	 * constant. Exists so a loopback test can prove the stall-detection
	 * behaviour without actually waiting five minutes.
	 */
	readonly inactivityTimeoutMs?: number;
}

/** `Authorization`/`Content-Type` headers shared by every request in the sequence. */
function requestHeaders(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * Cancel a stream reader, swallowing any error the cancellation itself
 * raises. WR-07: called right before the inactivity-timeout error is thrown,
 * so a pending `reader.read()` is unblocked and the `finally` block's
 * `reader.releaseLock()` does not itself throw on a still-in-progress read.
 * Never allowed to mask the real (timeout) error that follows it.
 */
async function cancelReaderQuietly(reader: ReadableStreamDefaultReader<Uint8Array>, reason: string): Promise<void> {
	try {
		await reader.cancel(reason);
	} catch {
		// Best-effort -- see this function's own doc comment.
	}
}

/**
 * Run the three-step Cloud Agents sequence and fold the streamed result back
 * into plain text: create a session, send the task as a `user.message` event,
 * then stream and fold events until `session.status_idle`.
 *
 * Validates `task` (non-empty after trimming, bounded by {@link MAX_TASK_CHARS})
 * before sending anything -- ASVS V5, the same posture `safety/index.ts`'s
 * `approve_ky_command` takes with its own params.
 *
 * Every request carries `Authorization: Bearer <token>`; the token is never
 * placed anywhere else, including any transcript record this function writes.
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
	// WR-08: `sessionId` comes from an UNTRUSTED network response and is
	// spliced into two request paths below. An id containing `../`, `?`, `#`
	// or a space would re-target or mangle the request -- the same
	// input-validation posture this file already applies to the model-
	// supplied `task` (MAX_TASK_CHARS / the empty-task refusal above), now
	// applied to the server-supplied id it did not previously cover. Reject
	// with the offending value in the message (never silently truncate or
	// coerce it) rather than relying on `encodeURIComponent` alone -- an id
	// this file cannot validate is an id this file should refuse to use, not
	// merely escape and hope the peer's own routing tolerates.
	if (!/^[A-Za-z0-9._-]{1,128}$/.test(sessionId)) {
		throw new Error(
			`Qoder delegate: session create returned a session id that does not look like one ` +
				`(${JSON.stringify(sessionId)}) -- refusing to splice it into a request path.`,
		);
	}
	const encodedSessionId = encodeURIComponent(sessionId);

	writeQoderTranscript(cwd, {
		event: "qoder.event.send.request",
		url: `${config.baseUrl}/sessions/${encodedSessionId}/events`,
		taskChars: trimmed.length,
	});

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

	// WR-06: request/response transcript records for the stream-open step,
	// mirroring the two steps above. RB-05-01 step 4 tells the operator to read
	// the transcript for a 401/403 "on any of the three requests" -- before
	// this fix, the stream open (step 3) wrote NEITHER a request NOR a
	// response record, so a 401/403 here left the transcript showing two clean
	// 200s and then nothing, and the operator running the one live check this
	// phase deliberately leaves OUTSTANDING would be looking at a log that
	// cannot show the failure the runbook told them to look for.
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
	const decoder = new TextDecoder();
	let buffer = "";
	const allFrames: SseFrame[] = [];
	let folded: FoldedResult = { text: "", thinkingText: "", done: false };
	let lastReportedThinking = "";

	// WR-07: the inactivity deadline. `lastProgressAt` resets on every chunk
	// (see the loop body below), never on a fixed wall-clock budget from the
	// stream's own start -- see STREAM_INACTIVITY_TIMEOUT_MS's own doc comment
	// for why a genuinely long delegation must not be cut short by this.
	const inactivityTimeoutMs = opts.inactivityTimeoutMs ?? STREAM_INACTIVITY_TIMEOUT_MS;
	let lastProgressAt = Date.now();

	try {
		while (!folded.done) {
			const remaining = inactivityTimeoutMs - (Date.now() - lastProgressAt);
			if (remaining <= 0) {
				await cancelReaderQuietly(reader, "inactivity timeout");
				throw new Error(
					`Qoder delegate: the event stream produced no bytes for ${inactivityTimeoutMs}ms -- ` +
						"treating the connection as stalled rather than hanging indefinitely.",
				);
			}

			// Race the read against the REMAINING budget, not the full deadline --
			// so a read that starts partway through the window cannot silently
			// extend the deadline past what "no bytes for N ms" actually means.
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
				// Cancel the reader BEFORE throwing: a pending reader.read() call
				// makes releaseLock() in the finally block below throw its own
				// ("cannot release a reader lock when a read() call is in
				// progress"), which would mask this actionable error behind a
				// confusing second one. cancel() unblocks that pending read.
				await cancelReaderQuietly(reader, "inactivity timeout");
				throw new Error(
					`Qoder delegate: the event stream produced no bytes for ${inactivityTimeoutMs}ms -- ` +
						"treating the connection as stalled rather than hanging indefinitely.",
				);
			}

			const { value, done: streamDone } = raced;
			if (streamDone) {
				break;
			}
			// Progress: reset the deadline. A genuinely long delegation that keeps
			// producing bytes (even slowly) is never cut off by this timeout.
			lastProgressAt = Date.now();

			buffer += decoder.decode(value, { stream: true });
			const parsed = parseSseFrames(buffer);
			buffer = parsed.rest;
			allFrames.push(...parsed.frames);
			folded = foldDelegatedResult(allFrames);
			if (opts.onThinking && folded.thinkingText !== lastReportedThinking) {
				lastReportedThinking = folded.thinkingText;
				opts.onThinking(folded.thinkingText);
			}
		}
	} finally {
		reader.releaseLock();
	}

	// CR-03: flush what the transport left unterminated. A server that closes
	// the body without a final blank line after the last frame -- a common SSE
	// server behaviour this file's own module docstring already says the
	// envelope is UNVERIFIED about -- must not cost the last frame (often
	// session.status_idle itself, or the final content_delta). `decoder.decode()`
	// with no argument flushes any pending multi-byte sequence the streaming
	// decode above left buffered.
	buffer += decoder.decode();
	if (buffer.trim().length > 0) {
		const flushed = parseSseFrames(`${buffer}\n\n`);
		allFrames.push(...flushed.frames);
		folded = foldDelegatedResult(allFrames);
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

	// CR-03: `done` must be CHECKED, not merely recorded. A connection dropped
	// mid-stream, a server-side 5xx after headers, or an early close (without a
	// session.status_idle frame ever arriving) must never be handed back to the
	// model as a complete, trustworthy answer -- the transcript would show
	// done:false, but nothing upstream of this function ever reads that field.
	if (!folded.done) {
		throw new Error(
			"Qoder delegate: the event stream ended without a session.status_idle frame after " +
				`${folded.text.length} characters -- the delegated result is incomplete and must not be ` +
				"treated as an answer.",
		);
	}

	return folded;
}
