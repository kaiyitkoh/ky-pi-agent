/**
 * DIAG-01 / DIAG-07 — a live in-memory session produces an ordered, redacted,
 * gitignored wire dump.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * This is the OFFLINE PROXY named by `RB-02-01` and `RB-02-02`. It proves the
 * capture pipeline and the redactor against FIXTURES: that all three hooks fire
 * in order on a real `createAgentSession`, that the record carries the request
 * that was actually built, that the plaintext of a planted credential never
 * reaches the bytes on disk, and that every produced path is gitignored.
 *
 * It says NOTHING about what a real DeepSeek, DashScope or Bedrock request
 * looks like on the wire. The faux payload is transcribed from
 * `openai-completions.ts:681-760`, which makes it realistic and does not make
 * it real; faux's headers are `{}` (`pi-ai src/providers/faux.ts:510`), so no
 * live `Authorization` value has ever passed through the redactor. Both live
 * halves stay **OUTSTANDING** in `docs/RUNBOOK.md`. Never report them as
 * passing on the strength of this file. (RESEARCH §12.)
 *
 * ---------------------------------------------------------------------------
 * PITFALL 1 — the vacuous pass this whole phase was reorganised around
 * ---------------------------------------------------------------------------
 * `fauxProvider` never calls `options.onPayload`
 * [VERIFIED: pi-ai 0.84.1 src/providers/faux.ts:510 — `grep -n onPayload` in
 * that file returns nothing], and Pi wires `before_provider_request` to exactly
 * that callback (`src/core/sdk.ts:294-360`). So under a PLAIN faux session the
 * payload hook never fires, the wire log is never created, and a test written
 * as "prompt, then assert on the captured payload" passes having verified
 * nothing. `wrapFauxWithPayload` in `tests/helpers/faux.ts` is what makes the
 * hook fire at all, and case 1 below asserts a strictly positive record count
 * BEFORE it looks at any content.
 *
 * The extension under test loads at USER scope through `writeUserScopeShim`:
 * project-scoped `.pi/extensions` is gated behind project trust, which resolves
 * `false` headless with no UI to answer the prompt, and a silently absent
 * extension is another green run over nothing (RESEARCH §8.4).
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { Model, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import { beforeAll, describe, expect, it } from "vitest";

import { logDir, logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { WIRE_LOG_BASE, WIRE_TAIL_MESSAGES, type WireKind } from "../../.pi/extensions/diagnostics/schema.ts";
import { redactDeep } from "../../.pi/extensions/diagnostics/redact.ts";
import { boundRequestPayload, captureRequestPayload } from "../../.pi/extensions/diagnostics/wire.ts";
import {
	buildOpenAiFixturePayload,
	SECRET_FIXTURE_TOKEN,
	transcriptView,
	withSecretHeader,
} from "../helpers/faux.ts";
import { isIgnored, repoRoot } from "../helpers/git.ts";
import { logFilesIn, readTornSafe } from "../helpers/logs.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Absolute path of the diagnostics extension this repository ships. */
const EXTENSION_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;

/** The order Pi fires the three provider hooks in (RESEARCH §2.3). */
const EXPECTED_ORDER: WireKind[] = ["main.headers", "main.request", "main.response"];

/** The shape this file asserts on. Imported kinds, never retyped literals. */
interface Row {
	kind?: WireKind;
	corr?: string;
	payload?: { model?: string; messages?: unknown[] };
	messageCount?: number;
	messagesHash?: string;
	status?: number;
	headers?: Record<string, string | null>;
}

/** What one prompt against the instrumented session produced. */
interface Capture {
	rows: Row[];
	unparseable: string[];
	/** Raw bytes of the wire log, as they sit on disk. */
	text: string;
	/** Every log file that exists under the session cwd, relative to it. */
	relativePaths: string[];
	/** The `Context` the provider was handed, captured by the response factory. */
	context: TranscriptContext | undefined;
	model: Model<string> | undefined;
}

/**
 * Run one prompt through a real session with the diagnostics extension loaded,
 * and hand back everything the assertions below need.
 *
 * One session, one prompt, five cases: re-running the session per case would
 * quintuple the wall clock for no extra coverage, and the cases are about
 * different properties of the SAME dump.
 */
async function captureOnePrompt(): Promise<Capture> {
	let seenContext: TranscriptContext | undefined;
	let seenModel: Model<string> | undefined;

	return await withFauxSession(
		{
			extensionPath: EXTENSION_ENTRY,
			// The credential is planted INSIDE the payload, which is where the real
			// hazard lives: no adapter puts the API key in the body (RESEARCH §1.3,
			// 12 verified call sites), but everything the model read this session
			// travels in `messages[]`.
			buildPayload: (model, context, options) =>
				withSecretHeader(buildOpenAiFixturePayload(model, context, options)),
			responses: [
				(context, _options, _state, model) => {
					// A response FACTORY, not a canned message: this is the only way to
					// see the `Context` the provider was actually handed, which is what
					// turns "we logged something" into "we logged the request".
					seenContext = context;
					seenModel = model;
					return fauxAssistantMessage("ok", { stopReason: "stop" });
				},
			],
		},
		async ({ session, cwd }) => {
			await session.prompt("hello");

			const file = logPath(cwd, WIRE_LOG_BASE);
			const { records, unparseable } = readTornSafe(file);

			// WHY NOT `producedPaths()`. The extension under test is loaded by PI,
			// through jiti, which keeps its own module registry — so the `jsonl.ts`
			// instance that did the writing is not the one this test file imported,
			// and the in-process produced-path set is empty here no matter what the
			// session wrote. Verified by running it: case 5 failed on an empty list
			// while cases 1-4 passed over a fully populated log file. Reading the
			// directory is the honest oracle at this boundary, and it is also the
			// stronger one: it reports what a session actually left on disk rather
			// than what a bookkeeping set believes it left. The `producedPaths()`
			// route is covered in-process by tests/unit/logs-gitignored.test.ts.
			const dir = logDir(cwd);
			return {
				rows: records as Row[],
				unparseable,
				text: readFileSync(file, "utf8"),
				// Repo-relative in SHAPE: the temp cwd is not the repository, but the
				// path under it is exactly what the ignore rules classify. `sep`, not
				// a literal backslash — this must also be right on the macOS CI leg.
				relativePaths: logFilesIn(dir).map((name) =>
					relative(cwd, join(dir, name)).split(sep).join("/"),
				),
				context: seenContext,
				model: seenModel,
			};
		},
	);
}

let capture: Capture;

describe("DIAG-01 / DIAG-07 — the wire dump of one live turn", () => {
	beforeAll(async () => {
		capture = await captureOnePrompt();
	});

	it("case 1 — the three hooks fired, in order, for one correlated request", () => {
		expect(
			capture.rows.length,
			"the wire log holds zero records, so no capture hook ran at all and EVERY assertion " +
				"below is vacuous. The likeliest cause is the extension not loading: it must sit at " +
				"USER scope, via writeUserScopeShim — project-scoped `.pi/extensions` is gated behind " +
				"project trust, which resolves false headless",
		).toBeGreaterThan(0);

		// PITFALL 1 lives on THIS assertion, not on the count above. Under a plain
		// faux provider the headers and response hooks still fire, so a wire log
		// with records in it exists and only the payload record is missing. A
		// non-empty file is therefore not evidence that the payload hook ran.
		expect(
			capture.rows.some((r) => r.kind === "main.request"),
			"the wire log has records but NO main.request among them, which is Pitfall 1 exactly: " +
				"`fauxProvider` never calls `options.onPayload` (pi-ai faux.ts:510) and Pi wires " +
				"`before_provider_request` to that callback, so the payload hook does not fire unless " +
				"the provider is wrapped by `wrapFauxWithPayload` (tests/helpers/faux.ts). The headers " +
				"and response hooks fire regardless, which is what makes this failure mode look green " +
				"to a record-count guard",
		).toBe(true);

		expect(
			capture.unparseable,
			"a line of the wire log could not be parsed as JSON. The writer is open-write-close per " +
				"record precisely so this cannot happen from a single process",
		).toEqual([]);

		const correlations = [...new Set(capture.rows.map((r) => r.corr))];
		expect(
			correlations.length,
			"one prompt is one logical provider request, so every record must share one correlation " +
				"id. More than one means either a retry re-fired a hook — which Pi's docs say cannot " +
				"happen (docs/extensions.md:676) — or the id was issued from the wrong hook",
		).toBe(1);

		expect(
			correlations[0],
			"the correlation id fell back to its `uncorrelated` sentinel, which means the headers " +
				"hook did not run before the request hook and the ordering assertion below is " +
				"measuring something other than what it says",
		).not.toBe("uncorrelated");

		expect(
			capture.rows.map((r) => r.kind),
			"the recorded hook order must be headers -> request -> response (RESEARCH §2.3): " +
				"`transformHeaders` runs in ModelRuntime.prepareRequest, the body is assembled after " +
				"it, and onResponse fires once the HTTP response arrives",
		).toEqual(EXPECTED_ORDER);
	});

	it("case 2 — the recorded payload IS the outgoing request", () => {
		// This is the case that separates "we logged something" from "we logged
		// the request". Without it, a handler that wrote a constant would satisfy
		// case 1 completely.
		const request = capture.rows.find((r) => r.kind === "main.request");
		expect(request, "no main.request record was written").toBeDefined();

		expect(
			capture.context,
			"the faux response factory never ran, so there is nothing to compare the recorded " +
				"payload against and this case proves nothing",
		).toBeDefined();

		expect(
			request?.payload?.model,
			"the recorded payload names a different model from the one the provider was called " +
				"with. A dump that reports the wrong model is worse than no dump: Phase 5's routing " +
				"decisions are made on exactly this field",
		).toBe(capture.model?.id);

		// `buildOpenAiFixturePayload` prepends a `system` message when the context
		// carries a system prompt (openai-completions.ts:681-760 does the same), so
		// the arithmetic is the assertion rather than a bare equality.
		//
		// pi-ai 1.1.0: the system prompt is now a `role: "system"` message INSIDE
		// `context.messages`, so counting `messages.length` and adding 1 for the
		// prompt would double count it. Count the non-system messages (what the
		// builder iterates) plus one when the replayed prompt is non-empty (the
		// single system message the builder emits).
		const view = capture.context ? transcriptView(capture.context) : undefined;
		const expectedMessages = (view?.messages.length ?? 0) + (view?.systemPrompt ? 1 : 0);
		expect(
			request?.messageCount,
			"the recorded message count differs from the context the provider received. The dump " +
				"would be describing a request that was never sent",
		).toBe(expectedMessages);
		expect(request?.messagesHash, "the full-history hash is missing from the request row").toMatch(/^[0-9a-f]{16}$/);
		expect(request?.payload?.messages?.length).toBe(Math.min(expectedMessages, WIRE_TAIL_MESSAGES));

		const response = capture.rows.find((r) => r.kind === "main.response");
		expect(
			response?.status,
			"the response record must carry the HTTP status the hook reported (faux always answers " +
				"200, faux.ts:510). It is the only field `after_provider_response` contributes, and it " +
				"is optional on a turns row because this hook never fires on a provider error",
		).toBe(200);
	});

	it("case 3 — DIAG-07: the plaintext credential is not in the bytes on disk", () => {
		expect(
			capture.text.length,
			"the wire log file is empty, so the two assertions below would pass over nothing",
		).toBeGreaterThan(0);

		expect(
			capture.text.includes(SECRET_FIXTURE_TOKEN),
			"a credential planted in the outgoing payload reached the log file in plaintext. " +
				"Redaction happens AT CAPTURE, not at read: a dump that ever holds a live key on disk " +
				"inside a public repository is a breach the moment it is written, and a reader that " +
				"would have masked it changes nothing. Neither does .gitignore, which one `git add -f` " +
				"defeats",
		).toBe(false);

		expect(
			capture.text.includes("[redacted:"),
			"nothing in the dump was redacted at all. The payload carried a bearer-shaped value under " +
				"an `authorization` key, so both halves of the redactor — key name and value shape — " +
				"should have fired; a file with no placeholder means the capture path is not calling " +
				"the redactor",
		).toBe(true);
	});

	it("case 4 — the paired positive: real content survived the redactor", () => {
		// Without this, an empty, truncated or all-placeholder file satisfies case
		// 3 perfectly while destroying the instrument's entire value.
		const modelId = capture.model?.id;
		expect(modelId, "the faux model id is unknown, so there is nothing to look for").toBeTruthy();

		expect(
			capture.text.includes(String(modelId)),
			`the model id ${String(modelId)} is absent from the dump. A redactor that blanked ` +
				"everything would pass case 3 and leave a log nobody can read — over-redaction is a " +
				"failure too, just a quieter one",
		).toBe(true);
	});

	it("case 5 — every path the writer produced is gitignored", () => {
		expect(
			capture.relativePaths.length,
			"the session left no log file at all, so the loop below iterates nothing and this case " +
				"is a pass that verified nothing",
		).toBeGreaterThan(0);

		expect(
			capture.relativePaths.some((p) => p.startsWith(".pi/") && p.endsWith(".jsonl")),
			"no path of the expected `.pi/logs/<base>-<date>.jsonl` shape was produced, so the loop " +
				"below may be classifying files this subsystem did not write",
		).toBe(true);

		for (const path of capture.relativePaths) {
			expect(
				isIgnored(path),
				`the writer produced ${path} and git says it is committable. Every diagnostic log holds ` +
					"the full prompt body of every turn, and this repository is public",
			).toBe(true);
		}
	});
});

describe("wire request rows stay bounded as history grows", () => {
	function payloadWith(turns: number): unknown {
		return {
			model: "m",
			messages: Array.from({ length: turns }, (_, i) => ({ role: "user", content: `turn ${i} ${"x".repeat(200)}` })),
		};
	}

	it("keeps the last WIRE_TAIL_MESSAGES, the full count and a hash", () => {
		const bounded = boundRequestPayload(payloadWith(50));
		expect((bounded.payload as { messages: unknown[] }).messages).toHaveLength(WIRE_TAIL_MESSAGES);
		expect(bounded.messageCount).toBe(50);
		expect(bounded.messagesHash).toMatch(/^[0-9a-f]{16}$/);
		expect(boundRequestPayload(payloadWith(50)).messagesHash).toBe(bounded.messagesHash);
		expect(boundRequestPayload(payloadWith(49)).messagesHash).not.toBe(bounded.messagesHash);
	});

	it("row size is flat between 10 and 50 turns", () => {
		const size = (turns: number): number => JSON.stringify(boundRequestPayload(payloadWith(turns))).length;
		expect(size(50)).toBeLessThan(size(10) * 1.2);
	});

	it("a long history does not spend the redactor's budget, so the kept tail is never truncated", () => {
		const history = Array.from({ length: 60 }, (_, i) => ({ role: "user", content: Array.from({ length: 2000 }, () => ({ type: "text", text: `old ${i}` })) }));
		const tail = { role: "user", content: "the newest prompt" };
		const redactedFirst = JSON.stringify(boundRequestPayload(redactDeep({ model: "m", messages: [...history, tail] })).payload);
		expect(redactedFirst, "non-vacuity: redacting the whole history first does exhaust the budget").toContain("[redacted:truncated]");
		const captured = JSON.stringify(captureRequestPayload({ model: "m", messages: [...history, tail] }).payload);
		expect(captured).toContain("the newest prompt");
		expect(captured).not.toContain("[redacted:truncated]");
	});

	it("passes a payload with no messages array through unchanged", () => {
		const input = { model: "m", input: ["a"] };
		expect(boundRequestPayload(input)).toEqual({ payload: input });
	});
});
