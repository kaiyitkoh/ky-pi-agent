/**
 * Self-tests for tests/helpers/: every later test asserts through them, and their platform quirks (PATH stubs, the `pi`
 * binary, faux payloads) would otherwise surface as mysterious failures in the thing under test.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import type { FauxProviderHandle, Provider, TranscriptContext } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	fauxProvider,
	getCurrentSystemPrompt,
	getCurrentTools,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";

import { buildOpenAiFixturePayload, wrapFauxWithPayload, wrapFauxWithStatus } from "../helpers/faux.ts";
import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { logFilesIn, readJsonl, readTornSafe, withTempLogCwd } from "../helpers/logs.ts";
import { assertLoopbackUrl, withLoopbackCompletions } from "../helpers/loopback.ts";
import { withModelsConfig } from "../helpers/models.ts";
import { requirePiOnPath, runPi } from "../helpers/pi.ts";
import { withFauxSession } from "../helpers/session.ts";
import { commandFor, quoteForWindows } from "../helpers/win-quote.ts";
import { runWithStubBin, withStubBin } from "../helpers/stub-bin.ts";

const scratch = mkdtempSync(join(tmpdir(), "kypi-helpers-"));

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe("git helper", () => {
	it("resolves the repository root", () => {
		expect(existsSync(join(repoRoot(), "package.json"))).toBe(true);
	});

	it("reports tracked files for a pathspec", () => {
		expect(trackedFiles("package.json")).toEqual(["package.json"]);
	});
});

describe("pi helper", () => {
	// No skip: if `pi` is absent this suite must go red.
	it("finds the pi binary and reports its version", () => {
		expect(requirePiOnPath()).toMatch(/^\d+\.\d+\.\d+/);
	});

	it("runs pi and injects --offline", () => {
		const result = runPi(["--version"]);
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});
});

describe("stub-bin helper", () => {
	it("puts its temp directory first on PATH and removes it afterwards", () => {
		let stubDir = "";
		withStubBin({ "kypi-fake": {} }, (env) => {
			const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
			expect(key).toBeDefined();
			stubDir = (env[key as string] ?? "").split(delimiter)[0] as string;
			expect(existsSync(join(stubDir, "kypi-fake.mjs"))).toBe(true);
			expect(existsSync(join(stubDir, "kypi-fake.cmd"))).toBe(true);
			expect(existsSync(join(stubDir, "kypi-fake"))).toBe(true);
		});
		expect(existsSync(stubDir)).toBe(false);
	});

	it("resolves the stub from PATH and honours stdout and exitCode", () => {
		const result = runWithStubBin(
			{ "kypi-fake": { stdout: "STUBBED_OK\n", exitCode: 3 } },
			"kypi-fake",
			["auth", "status"],
		);
		expect(result.stdout).toContain("STUBBED_OK");
		expect(result.status).toBe(3);
	});

	it("logs its own name and argv, one line per invocation", () => {
		const log = join(scratch, "calls.log");
		runWithStubBin({ "kypi-fake": { logTo: log } }, "kypi-fake", ["install", "--offline"]);
		runWithStubBin({ "kypi-fake": { logTo: log } }, "kypi-fake", ["update"]);
		expect(readFileSync(log, "utf-8").split("\n").filter(Boolean)).toEqual([
			"kypi-fake install --offline",
			"kypi-fake update",
		]);
	});

	it("rejects an async fn rather than deleting the stubs mid-await", () => {
		expect(() => withStubBin({ "kypi-fake": {} }, () => Promise.resolve(1))).toThrow(
			/must be synchronous/,
		);
	});

	it("cleans up even when fn throws", () => {
		let stubDir = "";
		expect(() =>
			withStubBin({ "kypi-fake": {} }, (env) => {
				const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") as string;
				stubDir = (env[key] ?? "").split(delimiter)[0] as string;
				throw new Error("boom");
			}),
		).toThrow("boom");
		expect(existsSync(stubDir)).toBe(false);
	});
});

/** The one Windows quoter, on the `shell: true` path Node's DEP0190 warns about. */
describe("quoteForWindows -- one implementation of the DEP0190 hazard", () => {
	it("leaves plain arguments alone", () => {
		// Readability of the command string in a failure message is worth this.
		expect(quoteForWindows("--offline")).toBe("--offline");
		expect(quoteForWindows("C:/Users/x/pi")).toBe("C:/Users/x/pi");
		expect(quoteForWindows("@earendil-works/pi-ai@0.84.1")).toBe("@earendil-works/pi-ai@0.84.1");
	});

	it("quotes anything holding a space or a shell metacharacter", () => {
		expect(quoteForWindows("C:/some dir")).toBe('"C:/some dir"');
		expect(quoteForWindows("a&b")).toBe('"a&b"');
		expect(quoteForWindows("")).toBe('""');
	});

	it("doubles a trailing backslash run so it cannot eat the closing quote", () => {
		// `"C:\some dir\"` must not leave the closing quote escaped and run on into the next argument.
		expect(quoteForWindows("C:\\some dir\\")).toBe('"C:\\some dir\\\\"');
		expect(quoteForWindows("C:\\some dir\\\\")).toBe('"C:\\some dir\\\\\\\\"');
		// A backslash NOT before a quote or the end is literal, so it stays put.
		expect(quoteForWindows("C:\\some dir\\file")).toBe('"C:\\some dir\\file"');
	});

	it("escapes an embedded quote and the backslash run before it", () => {
		// CRT rule: 2n backslashes + `"` is a delimiter, 2n+1 is a literal quote.
		expect(quoteForWindows('say "hi"')).toBe('"say \\"hi\\""');
		expect(quoteForWindows('a\\"b')).toBe('"a\\\\\\"b"');
	});

	it("commandFor folds args into one string on Windows and keeps the array off it", () => {
		expect(commandFor("npm", ["config", "get", "ignore-scripts"], false)).toEqual([
			"npm",
			["config", "get", "ignore-scripts"],
		]);
		// The safe `shell: true` shape: everything in the command, args empty.
		expect(commandFor("pi", ["--offline", "-a", "C:/some dir"], true)).toEqual([
			'pi --offline -a "C:/some dir"',
			[],
		]);
	});
});

/** Compare two absolute paths on a platform where git and node disagree on slashes. */
function normalisePath(path: string): string {
	return resolve(path).replace(/\\/g, "/").toLowerCase();
}

/** `readTornSafe` reports a torn line as data; the strict reader is pointed at the same file and must throw. */
describe("logs helper -- a torn line is a measurement, not an exception", () => {
	// Written at run time: a committed `*.jsonl` fixture is gitignored, so CI would read a file that is not there.
	const MIXED_JSONL = ['{"seq":1,"ok":true}', '{"seq":2,"ok":true}', '{"seq":3,"ok":tr'].join(
		"\n",
	);

	it("readTornSafe returns the good records and the raw text of the torn one", async () => {
		await withTempLogCwd(async (cwd) => {
			const file = join(cwd, "turns-fixture.jsonl");
			writeFileSync(file, `${MIXED_JSONL}\n`, "utf-8");

			const { records, unparseable } = readTornSafe(file);

			expect(
				records,
				"both well-formed records must survive alongside the torn one; a reader that " +
					"drops good records when it meets a bad one under-counts the very thing " +
					"DIAG-08 measures",
			).toEqual([
				{ seq: 1, ok: true },
				{ seq: 2, ok: true },
			]);
			expect(
				unparseable,
				"the torn line must be reported verbatim, so a concurrency failure can be shown " +
					"rather than only counted",
			).toEqual(['{"seq":3,"ok":tr']);
		});
	});

	it("readJsonl throws on the same file, so the two readers are proven different", async () => {
		await withTempLogCwd(async (cwd) => {
			const file = join(cwd, "turns-fixture.jsonl");
			writeFileSync(file, `${MIXED_JSONL}\n`, "utf-8");

			expect(
				() => readJsonl(file),
				"if the strict reader also tolerated a torn line, `readTornSafe`'s tolerance " +
					"would be proving nothing -- the difference between them is the reason both exist",
			).toThrow();
		});
	});

	it("logFilesIn names files, sorts them, and reports an absent directory as empty", async () => {
		await withTempLogCwd(async (cwd) => {
			expect(
				logFilesIn(join(cwd, "does-not-exist")),
				"an absent log directory means the writer produced nothing; making the caller " +
					"guard existsSync first is how that check gets forgotten",
			).toEqual([]);

			writeFileSync(join(cwd, "turns-2026-08-13.jsonl"), "", "utf-8");
			writeFileSync(join(cwd, "wire-2026-08-13.jsonl"), "", "utf-8");
			expect(logFilesIn(cwd)).toEqual(["turns-2026-08-13.jsonl", "wire-2026-08-13.jsonl"]);
		});
	});

	it("removes its temp directory afterwards", async () => {
		let seen = "";
		await withTempLogCwd(async (cwd) => {
			seen = cwd;
			expect(existsSync(cwd)).toBe(true);
		});
		expect(existsSync(seen), "a leaked temp dir per test is how a long run fills a disk").toBe(
			false,
		);
	});
});

/** The faux session runs, and runs outside this repo: inside it Pi would load the repo's large CLAUDE.md into every request. */
describe("session helper -- a real agent run with no network and no credentials", () => {
	it("drives one prompt through the faux provider and disposes cleanly", async () => {
		let seenCwd = "";
		let seenAgentDir = "";

		await withFauxSession({}, async (handle) => {
			seenCwd = handle.cwd;
			seenAgentDir = handle.agentDir;

			await handle.session.prompt("hello");

			expect(
				handle.faux.state.callCount,
				"the session must have reached the provider exactly once; 0 means the prompt " +
					"never produced a request and every hook assertion downstream is vacuous",
			).toBe(1);

			expect(
				normalisePath(handle.cwd).startsWith(normalisePath(repoRoot())),
				`session cwd ${handle.cwd} is inside the repository at ${repoRoot()} -- Pi would ` +
					"load this repo's CLAUDE.md into every faux request and every token measurement " +
					"would be measuring the harness rather than the thing under test",
			).toBe(false);
		});

		expect(existsSync(seenCwd), "the temp cwd must be removed by dispose()").toBe(false);
		expect(existsSync(seenAgentDir), "the temp agentDir must be removed by dispose()").toBe(
			false,
		);
	});
});

/**
 * Plain faux never calls `onPayload`, so a payload-capture test over it asserts nothing. This proves
 * `wrapFauxWithPayload` makes `before_provider_request` fire, requiring a positive count before any content.
 */
describe("faux helper -- before_provider_request actually fires", () => {
	/**
	 * A user-scope recorder. Block body, no return: a non-undefined return from `before_provider_request` replaces the
	 * payload for every later handler and the real request.
	 */
	const CAPTURE_EXTENSION = [
		'import { appendFileSync } from "node:fs";',
		'import { join } from "node:path";',
		"",
		"// Module-scoped: every payload this session saw, in order.",
		"const captured = [];",
		"",
		"export default function (pi) {",
		'	pi.on("before_provider_request", (event, ctx) => {',
		"		captured.push(event.payload);",
		"		appendFileSync(",
		'			join(ctx.cwd, "captured.jsonl"),',
		'			JSON.stringify({ index: captured.length - 1, keys: Object.keys(event.payload) }) + "\\n",',
		'			"utf-8",',
		"		);",
		"		// No return. See the docstring above.",
		"	});",
		"}",
		"",
	].join("\n");

	it("captures at least one payload through before_provider_request", async () => {
		await withFauxSession({ extensionSource: CAPTURE_EXTENSION }, async (handle) => {
			await handle.session.prompt("hello");

			const capturePath = join(handle.cwd, "captured.jsonl");
			const captured = existsSync(capturePath) ? readJsonl(capturePath) : [];

			expect(
				captured.length,
				"ZERO payloads were captured. `before_provider_request` did not fire, which means " +
					"tests/helpers/faux.ts is no longer emitting onPayload -- fauxProvider itself " +
					"never does (pi-ai src/providers/faux.ts:510). Every DIAG-01 and DIAG-07 " +
					"assertion downstream of this helper is therefore vacuous: it iterates an " +
					"empty capture list and passes without executing a single expectation. Fix the " +
					"wrapper; do not weaken this assertion.",
			).toBeGreaterThan(0);

			const first = captured[0] as { keys: string[] };
			expect(
				first.keys,
				"the captured payload must carry the OpenAI-completions shape from " +
					"buildOpenAiFixturePayload, not an invented one -- an unrealistic fixture " +
					"would let a redactor pass here and fail on the wire",
			).toEqual(expect.arrayContaining(["model", "messages", "stream"]));
		});
	});
});

describe("faux helper -- TranscriptContext accessors are not vacuous (pi-ai 1.1.0)", () => {
	// TranscriptContext is structurally assignable to Context, so a builder that
	// still reads `.systemPrompt` / `.tools` compiles and silently reads undefined.
	it("a captured transcript yields a real system prompt, the tool, and exactly one system message", async () => {
		const captured: TranscriptContext[] = [];
		await withFauxSession(
			{
				tools: ["read"],
				responses: [
					(context: TranscriptContext) => {
						captured.push(context);
						return fauxAssistantMessage("ok");
					},
				],
			},
			async (handle) => {
				await handle.session.prompt("hello");
			},
		);

		expect(captured.length, "response factory never ran; assertions below would be vacuous").toBeGreaterThan(0);
		const ctx = captured[0] as TranscriptContext;
		const prompt = getCurrentSystemPrompt(ctx.messages);
		expect(prompt.length).toBeGreaterThan(0);
		expect(prompt).toContain("read");
		expect(getCurrentTools(ctx.messages).map((t) => t.name)).toContain("read");

		const model = { id: "faux-flash" } as Parameters<typeof buildOpenAiFixturePayload>[0];
		const payload = buildOpenAiFixturePayload(model, ctx, undefined) as {
			messages: { role: string; content: unknown }[];
			tools?: { function: { name: string } }[];
		};
		expect(payload.messages.filter((m) => m.role === "system")).toHaveLength(1);
		expect(payload.messages[0]?.content).toBe(prompt);
		expect(payload.tools?.map((t) => t.function.name)).toContain("read");
	});
});

/** What one wrapped provider call reported back to its caller. */
interface StatusCapture {
	/** Every `onResponse` invocation, in order. Its LENGTH is the assertion. */
	statuses: number[];
	/** Every `onPayload` invocation, in order. */
	payloads: unknown[];
	/** The assistant message's text, flattened. */
	text: string;
}

/** Drives one provider call through `wrap(faux)` offline (`modelsPath: null`, no refresh) and records the callbacks. */
async function driveOneCall(wrap: (faux: FauxProviderHandle) => Provider): Promise<StatusCapture> {
	const faux = fauxProvider({ models: [{ id: "faux-flash" }] });
	faux.setResponses([fauxAssistantMessage("the stream survived the wrapper")]);

	const agentDir = mkdtempSync(join(tmpdir(), "kypi-status-"));
	try {
		const runtime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			refreshOnCreate: false,
		});
		runtime.registerNativeProvider(wrap(faux));

		const model = runtime.getModel(faux.provider.id, "faux-flash");
		if (!model) {
			throw new Error(
				"driveOneCall: the faux model did not resolve after registration. The wrapper " +
					"returned something that is not a Provider, or dropped `id` / `getModels` from " +
					"the spread of the inner provider.",
			);
		}

		const statuses: number[] = [];
		const payloads: unknown[] = [];
		const message = await runtime.complete(
			model,
			{ messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
			{
				onResponse: (response) => {
					statuses.push(response.status);
				},
				onPayload: (payload) => {
					payloads.push(payload);
					return undefined;
				},
			},
		);

		const text =
			typeof message.content === "string"
				? message.content
				: message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
		return { statuses, payloads, text };
	} finally {
		try {
			rmSync(agentDir, { recursive: true, force: true, maxRetries: 3 });
		} catch {
			// A leftover temp dir must never mask the test's own result.
		}
	}
}

/**
 * A faux provider reporting a non-200 status: faux itself always reports 200, so a 429-vs-503 test would pass either way.
 * The first case is the control proving the recorder answers 200 when nothing rewrites it.
 */
describe("faux helper -- wrapFauxWithStatus rewrites the status exactly once", () => {
	it("the oracle is live: an unwrapped faux call reports 200, once", async () => {
		const capture = await driveOneCall((faux) => wrapFauxWithPayload(faux));

		expect(
			capture.statuses,
			"a payload-wrapped faux provider must still report faux's own hard-coded 200 exactly " +
				"once. If this is [] the recorder never ran and the 503 case below proves nothing; " +
				"if it is [503] the recorder is not reading the status at all",
		).toEqual([200]);
	});

	it("reports the wrapped status, and reports it exactly once", async () => {
		const capture = await driveOneCall((faux) => wrapFauxWithStatus(faux, 503));

		expect(
			capture.statuses.length,
			`onResponse fired ${capture.statuses.length} time(s) for ONE request. Exactly 1 is the ` +
				"contract, and it is what distinguishes the substitution form from a pre-call: a " +
				"pre-call leaves faux's own hard-coded 200 firing afterwards, so the caller sees " +
				"[503, 200], Phase 2's wire log gets two main.response records under one " +
				"correlation id, and /budget counts a row that never happened. A 2 here means " +
				"someone converted the wrapper back to a pre-call. [threat T-03-01-04]",
		).toBe(1);

		expect(
			capture.statuses[0],
			"the recorded status must be the wrapped 503, not faux's hard-coded 200. NOT because " +
				"the three PROV-08 classes are statuses -- they are not, classifyFailure reads " +
				"the error TEXT and never sees a status -- but because the turns row carries an " +
				"httpStatus column, and fallback-chain case 5 asserts the status the provider " +
				"reported. A 200 here makes that row say every failure was a success [IN-04]",
		).toBe(503);
	});

	it("does not break the stream: the assistant message still arrives intact", async () => {
		const capture = await driveOneCall((faux) => wrapFauxWithStatus(faux, 429));

		expect(
			capture.text,
			"the wrapper substitutes one callback and must otherwise delegate untouched. Empty " +
				"text means the copied options bag lost something the inner provider needed, and " +
				"every fallback-chain assertion about a classified RESPONSE would then be testing " +
				"a broken stream instead",
		).toBe("the stream survived the wrapper");
	});

	it("composes over wrapFauxWithPayload: onPayload still fires and the status is still wrapped", async () => {
		const capture = await driveOneCall((faux) =>
			wrapFauxWithStatus(wrapFauxWithPayload(faux), 429),
		);

		// Non-emptiness first: an empty capture list satisfies every assertion about its contents.
		expect(
			capture.payloads.length,
			"ZERO payloads were captured through the composed wrappers. wrapFauxWithStatus has " +
				"swallowed the payload emission, so any Wave 1 test that wraps for status AND " +
				"asserts on the emitted body is vacuous: it iterates an empty list and passes",
		).toBeGreaterThan(0);

		expect(
			capture.payloads[0],
			"the composed payload must still carry the OpenAI-completions fixture shape, not an " +
				"object the status wrapper substituted",
		).toMatchObject({ model: "faux-flash", stream: true });

		expect(
			capture.statuses,
			"composition must preserve BOTH effects -- a 200 here means the payload wrapper won " +
				"and the status rewrite was lost",
		).toEqual([429]);
	});
});

/**
 * An offline model registry over an arbitrary models.json: claims about templates must be made against the model Pi
 * composed, since Pi accepts an unknown `compat` key in silence.
 */
describe("models helper -- a composed registry with no network and no credentials", () => {
	/** A provider id, model id and env vars no real configuration uses. */
	const PROVIDER = "kypi-fixture";
	const MODEL = "fixture-flash";
	const ABSENT_KEY = "KYPI_FIXTURE_KEY_THAT_DID_NOT_EXIST";
	const PRESENT_KEY = "KYPI_FIXTURE_KEY_THAT_DID_EXIST";

	const INLINE_MODELS = {
		providers: {
			[PROVIDER]: {
				name: "Kypi Fixture",
				// `.invalid` (RFC 2606) resolves nowhere, so no request is possible by construction.
				baseUrl: "https://models.invalid/v1",
				apiKey: `$${ABSENT_KEY}`,
				api: "openai-completions",
				models: [
					{
						id: MODEL,
						contextWindow: 393216,
						compat: { thinkingFormat: "qwen" },
					},
				],
			},
		},
	};

	it("composes the declared model, and composition really happened", async () => {
		await withModelsConfig({ models: INLINE_MODELS }, (handle) => {
			const model = handle.requireModel(PROVIDER, MODEL);

			expect(
				model.contextWindow,
				"the composed model must carry the context window the config declared. A different " +
					"number means the helper handed back something other than Pi's composition, and " +
					"PROV-06 -- no model inherits another provider's context window -- would be " +
					"asserted against the wrong object entirely",
			).toBe(393216);

			// Only the openai-completions arm of `Model.compat` declares `thinkingFormat`, hence the index read.
			const compat = model.compat as Record<string, unknown> | undefined;
			expect(
				compat?.thinkingFormat,
				"the composed compat must carry the declared thinkingFormat. This is the field " +
					"PROV-03 exists for: detectCompat has no DashScope branch, so an unset value " +
					"here means thinking is silently never enabled on the wire",
			).toBe("qwen");

			// maxTokens was never declared, so only Pi can have supplied it: the object is composed, not the config's bytes.
			expect(
				model.maxTokens,
				"maxTokens was not declared in the config, so a defined value can only have come " +
					"from Pi's own defaulting. `undefined` means this helper is handing back the " +
					"parsed template rather than the composed model, and every Trap T6 assertion " +
					"built on it would be a byte-level assertion wearing a composed-model costume",
			).toBeGreaterThan(0);
		});
	});

	it("requireModel THROWS for an unknown model id, naming both ids", async () => {
		await withModelsConfig({ models: INLINE_MODELS }, (handle) => {
			let thrown: unknown;
			try {
				handle.requireModel(PROVIDER, "fixture-renamed-upstream");
			} catch (error) {
				thrown = error;
			}

			expect(
				thrown,
				"requireModel returned instead of throwing. An unresolved model that yields " +
					"undefined is how Assumption A7's renamed-id hazard becomes a silent no-op: " +
					"every assertion about that model's compat, cost and context window would then " +
					"run against undefined and never execute",
			).toBeInstanceOf(Error);

			const message = (thrown as Error).message;
			expect(
				message,
				"the failure must name the provider id, or the reader cannot tell which of the " +
					"config's providers was misspelled",
			).toContain(PROVIDER);
			expect(
				message,
				"the failure must name the model id it asked for, or the remedy is a guess",
			).toContain("fixture-renamed-upstream");
		});
	});

	it("applies env for the callback, and DELETES a key that did not exist before", async () => {
		expect(
			Object.hasOwn(process.env, ABSENT_KEY),
			`${ABSENT_KEY} is already set in this environment, so the deletion assertion below ` +
				"would be testing nothing. Pick a name nothing else uses",
		).toBe(false);

		process.env[PRESENT_KEY] = "original-value";

		try {
			await withModelsConfig(
				{
					models: INLINE_MODELS,
					env: { [ABSENT_KEY]: "resolved-at-runtime", [PRESENT_KEY]: "overridden-value" },
				},
				async (handle) => {
					// The paired positive: presence first, or "absent afterwards" passes for a helper that never set it.
					expect(
						process.env[ABSENT_KEY],
						"the env option must be visible to code running inside the callback -- that " +
							"is the whole seam",
					).toBe("resolved-at-runtime");
					expect(
						process.env[PRESENT_KEY],
						"an env entry must override a variable that already existed, not defer to it",
					).toBe("overridden-value");

					// The env reaches Pi's own config-value resolution, not just process.env; `$ENV_VAR` resolves lazily at
					// getProviderAuth() time.
					const auth = await handle.registry.getProviderAuth(PROVIDER);
					expect(
						auth?.auth.apiKey,
						"the provider's `$ENV_VAR` apiKey must resolve, through Pi, to the value the " +
							"helper put in the environment. `undefined` means the seam never reaches " +
							"config-value resolution at all, and PROV-01's " +
							"`getProviderAuth('dashscope').auth.apiKey === $DASHSCOPE_API_KEY` " +
							"assertion would be comparing two unset values and passing",
					).toBe("resolved-at-runtime");
				},
			);

			expect(
				Object.hasOwn(process.env, ABSENT_KEY),
				"a key that did not exist before the callback must be DELETED afterwards, never " +
					'set to "". Bedrock\'s resolve() chain is `credential.env.AWS_PROFILE ?? ' +
					"process.env.AWS_PROFILE`, and an empty string is a value that satisfies `??` " +
					"while naming no profile -- so a blanked key leaks a wrong answer into every " +
					"sibling test in this worker. [threat T-03-01-03]",
			).toBe(false);

			expect(
				process.env[PRESENT_KEY],
				"a key that DID exist must be restored to its original value, not deleted",
			).toBe("original-value");
		} finally {
			delete process.env[PRESENT_KEY];
		}
	});

	it("removes its temp agent directory afterwards", async () => {
		let seenAgentDir = "";

		await withModelsConfig({ models: INLINE_MODELS }, (handle) => {
			seenAgentDir = handle.agentDir;

			// Paired positive: the files exist while the callback runs.
			expect(existsSync(handle.agentDir)).toBe(true);
			expect(
				existsSync(handle.modelsPath),
				"the models config must exist on disk inside the temp agent dir. If it does not, " +
					"ModelRuntime composed from an absent file and every composed-model assertion " +
					"in this phase is running against Pi's built-in catalogue instead",
			).toBe(true);
			expect(
				handle.modelsPath.startsWith(handle.agentDir),
				"models.json must live inside the temp agent dir. Pi defaults its models STORE to " +
					"`dirname(modelsPath)/models-store.json`, so a modelsPath pointing straight at " +
					".pi/templates/ would aim a writer at this repository. [threat T-03-01-02]",
			).toBe(true);
		});

		expect(
			existsSync(seenAgentDir),
			"a leaked temp agent dir per test is how a long run fills a disk -- and a leaked " +
				"auth.json is worse than untidy",
		).toBe(false);
	});
});

/** Either the response a fetch produced, or the error it rejected with. */
type FetchOutcome =
	| { ok: true; status: number; contentType: string; text: string }
	| { ok: false; error: Error };

/** Fetches `url`, reporting the outcome as data; the signal bounds every call so a hung connect fails, not stalls. */
async function tryFetch(url: string, init: RequestInit = {}): Promise<FetchOutcome> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(5_000), ...init });
		const text = await response.text();
		return {
			ok: true,
			status: response.status,
			contentType: response.headers.get("content-type") ?? "",
			text,
		};
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
	}
}

/**
 * The loopback capture server: it captures, responds with a stream the adapter can finish, refuses a non-loopback host
 * and releases its port on both paths. Whether DashScope accepts anything is a runbook check.
 */
describe("loopback helper -- the wire capture that needs no credential", () => {
	it("captures the request body, and something was actually captured", async () => {
		const sent = { model: "kypi-fixture-flash", messages: [{ role: "user", content: "hi" }] };

		await withLoopbackCompletions({}, async (handle) => {
			const outcome = await tryFetch(`${handle.baseUrl}/chat/completions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(sent),
			});
			expect(
				outcome.ok ? "" : outcome.error.message,
				"the POST to the loopback server did not complete at all, so nothing below is " +
					"about a capture -- fix the server before reading the assertions that follow",
			).toBe("");

			// Non-emptiness first: every assertion below indexes this array.
			expect(
				handle.requests.length,
				"the loopback server recorded ZERO requests after one POST completed against it. " +
					"Its request handler never ran, or it ran and never pushed. Every assertion " +
					"below -- and every Wave 2 assertion about the body Pi emitted -- indexes this " +
					"array, so an empty one makes all of them vacuous",
			).toBe(1);

			const first = handle.requests[0] as (typeof handle.requests)[number];

			expect(
				first.body,
				"the recorded body must deep-equal what was sent. Anything else means the server " +
					"is re-encoding or truncating the bytes it received, and a PROV-03 assertion " +
					"about `enable_thinking` would then be reading this helper's mangling rather " +
					"than Pi's emission",
			).toEqual(sent);

			expect(
				first.headers["content-type"],
				"the recorded headers must be the ones the caller set. PROV-10's evidence includes " +
					"what Pi put in the headers, so headers that arrive blank make half the capture " +
					"unusable",
			).toBe("application/json");

			expect(
				first.method,
				"the verb must be recorded verbatim; a blank method means req.method was never read",
			).toBe("POST");

			expect(
				first.url,
				"the server accepts ANY path under its base on purpose, so an adapter that posts " +
					"somewhere unexpected shows up here as a surprising url rather than as a hang " +
					"against a 404",
			).toBe("/v1/chat/completions");
		});
	});

	it("answers with a stream the adapter can actually finish", async () => {
		await withLoopbackCompletions({}, async (handle) => {
			const outcome = await tryFetch(`${handle.baseUrl}/chat/completions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: "kypi-fixture-flash" }),
			});

			expect(
				outcome.ok,
				"the default reply must be consumable. If this rejected, every Wave 2 test that " +
					"drives Pi's real adapter at this server will hang waiting for a stream that " +
					"never completes, and a hung test is worse than a failing one",
			).toBe(true);
			if (!outcome.ok) {
				return;
			}

			expect(outcome.status, "a non-200 default reply would be read by the adapter as a " +
				"provider error rather than as a completion").toBe(200);
			expect(
				outcome.contentType,
				"the adapter selects its SSE parser from the content type; anything else and the " +
					"body is parsed as a single JSON document and the stream never resolves",
			).toContain("text/event-stream");
			expect(
				outcome.text,
				"an SSE reply with no `data: ` line carries no chunk at all",
			).toContain("data: ");
			expect(
				outcome.text.trimEnd().endsWith("data: [DONE]"),
				`the stream must terminate with the [DONE] sentinel. Without it the adapter waits ` +
					`for more of a stream that will never arrive. Got: ${JSON.stringify(outcome.text.slice(-40))} ` +
					"[threat T-03-03-04]",
			).toBe(true);
		});
	});

	it("refuses a non-loopback host, and does NOT refuse its own baseUrl", async () => {
		await withLoopbackCompletions({}, (handle) => {
			let thrown: unknown;
			try {
				assertLoopbackUrl("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
			} catch (error) {
				thrown = error;
			}

			expect(
				thrown,
				"assertLoopbackUrl returned instead of throwing for a REAL DashScope base URL. " +
					"That is the copy-paste this guard exists to stop: pointed at a real host the " +
					"helper stops capturing and starts issuing live provider requests from a test " +
					"run. [threat T-03-03-01]",
			).toBeInstanceOf(TypeError);

			expect(
				(thrown as Error).message,
				"the refusal must name 127.0.0.1, or the reader is told what is wrong without " +
					"being told what is right -- and the remedy is a guess",
			).toContain("127.0.0.1");

			// The paired positive: a refusal that threw on everything would make the helper unusable.
			expect(
				() => {
					assertLoopbackUrl(handle.baseUrl);
				},
				`assertLoopbackUrl threw for the helper's own ${handle.baseUrl}. A guard that ` +
					"refuses everything passes the negative case above and proves nothing by it",
			).not.toThrow();
		});
	});

	it("releases the port when the callback returns", async () => {
		let baseUrl = "";
		let insideStatus = -1;

		await withLoopbackCompletions({}, async (handle) => {
			baseUrl = handle.baseUrl;
			// Reachable while up, or "unreachable afterwards" passes for a server that never listened.
			const inside = await tryFetch(`${handle.baseUrl}/chat/completions`);
			insideStatus = inside.ok ? inside.status : -1;
		});

		expect(
			insideStatus,
			"the loopback URL was not reachable while the callback ran, so the teardown " +
				"assertion below would pass against a server that never bound",
		).toBe(200);

		const after = await tryFetch(`${baseUrl}/chat/completions`);
		expect(
			after.ok,
			"the port is STILL accepting connections after withLoopbackCompletions resolved. A " +
				"leaked listener holds a port and a live handle for the remainder of the run: the " +
				"next test that binds may collide with it, and vitest may refuse to exit. " +
				"[threat T-03-03-03]",
		).toBe(false);
	});

	it("releases the port even when the callback throws", async () => {
		let baseUrl = "";

		await expect(
			withLoopbackCompletions({}, (handle) => {
				baseUrl = handle.baseUrl;
				throw new Error("boom");
			}),
			"the callback's error must propagate. A helper that swallowed it would turn a failing " +
				"payload assertion into a silent pass",
		).rejects.toThrow("boom");

		const after = await tryFetch(`${baseUrl}/chat/completions`);
		expect(
			after.ok,
			"the server survived a throwing callback. Cleanup belongs in the `finally`, or the " +
				"first failing assertion in a Wave 2 payload test leaks a listener and every " +
				"subsequent case in the run inherits it. [threat T-03-03-03]",
		).toBe(false);
	});
});
