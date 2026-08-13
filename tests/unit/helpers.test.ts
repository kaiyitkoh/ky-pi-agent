/**
 * Self-tests for the phase's test harness.
 *
 * Not in the plan's file list; added because the three helpers in
 * tests/helpers/ are what every later plan in this phase asserts THROUGH, and
 * nothing else exercises `runPi` or `withStubBin` at all. A typecheck proves
 * they compile, not that a stub is reachable on PATH or that the `pi` binary
 * runs -- and both of those are platform-specific enough to have already
 * produced two verified Windows surprises (see the module docstrings). A
 * broken helper here would surface in Plan 05/06 as a mysterious failure in
 * the thing under test.
 *
 * Phase 2 extends the same precedent to its own three Wave 0 helpers --
 * `logs.ts`, `session.ts` and `faux.ts` -- at the bottom of this file. The
 * `faux.ts` block is the one that matters most: it is the guard against a
 * whole class of vacuously-green DIAG-01/DIAG-07 tests.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import type { FauxProviderHandle, Provider } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";

import { wrapFauxWithPayload, wrapFauxWithStatus } from "../helpers/faux.ts";
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
	// Deliberately not guarded by a skip: if `pi` is absent, this suite must go
	// red. A skipped load-path test is a vacuous pass.
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

/**
 * The single Windows quoter, asserted directly.
 *
 * There were four hand-rolled copies of this across the suite and two were
 * wrong -- `stub-bin.ts` escaped quotes but not trailing backslashes, and
 * `load-paths.test.ts` did no escaping at all. All four are now one function,
 * and it is a function no test exercised, on the `shell: true` path Node's
 * DEP0190 warns about. Inputs are test-controlled today, which is exactly why
 * it needs asserting rather than assuming.
 */
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
		// THE stub-bin.ts BUG. `"C:\some dir\"` leaves the closing quote escaped,
		// so the argument runs on into whatever follows it on the command line.
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

// ===========================================================================
// Phase 2, Wave 0 helpers. See the note at the top of this file.
// ===========================================================================

/** Compare two absolute paths on a platform where git and node disagree on slashes. */
function normalisePath(path: string): string {
	return resolve(path).replace(/\\/g, "/").toLowerCase();
}

/**
 * The two JSONL readers, and the difference between them.
 *
 * The whole point of `readTornSafe` is that it reports a torn line as DATA
 * rather than raising it as an exception -- DIAG-08 is a measurement ("0 of 800
 * records torn"), and a reader that throws turns that measurement into a stack
 * trace at record 217. Asserting only that `readTornSafe` succeeds would not
 * prove the two readers differ at all; so the strict reader is pointed at the
 * SAME file and required to throw.
 */
describe("logs helper -- a torn line is a measurement, not an exception", () => {
	// Inline, and written at run time into a temp dir. A committed fixture named
	// `*.jsonl` would be silently untracked (.gitignore:30 is a blanket
	// `*.jsonl`), so CI would run this against a file that is not there.
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

/**
 * The in-memory agent session really runs, and really runs OUTSIDE this repo.
 *
 * The second assertion is not hygiene. Pi walks up from `cwd` collecting
 * context files; from anywhere inside this repository that means loading a
 * 49 KB `CLAUDE.md` into every faux request -- measured at 12,725 input tokens
 * for a one-word prompt. Any later `/budget` or token-accounting test would
 * then be measuring this repo's own instructions. [threat T-02-01-02]
 */
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
 * PITFALL 1 -- the guard this whole plan exists for.
 *
 * `fauxProvider` never calls `onPayload` (pi-ai src/providers/faux.ts:510), so
 * under a PLAIN faux session `before_provider_request` never fires and a
 * capture list is always empty. A DIAG-01 or DIAG-07 test written as "register
 * faux, prompt, assert the captured payload" would then pass while asserting
 * nothing, because its loop over an empty list never executes a single
 * expectation.
 *
 * `wrapFauxWithPayload` is the fix. This block is the proof that the fix is
 * live: it loads a user-scope extension that records every payload
 * `before_provider_request` hands it, runs one prompt, and requires the count
 * to be strictly positive BEFORE looking at any content.
 */
describe("faux helper -- before_provider_request actually fires", () => {
	/**
	 * The extension under test, as source. Written into `<agentDir>/extensions/`
	 * at USER scope by the session helper -- project scope is gated behind
	 * project trust, which resolves false headless.
	 *
	 * The handler has a BLOCK body and no return. Returning any non-undefined
	 * value from `before_provider_request` REPLACES the request payload for
	 * every later handler and for the real request
	 * (pi 0.84.1 src/core/extensions/runner.ts:1030-1033), so an expression-bodied
	 * arrow that happened to return something would silently rewrite the wire.
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

// ===========================================================================
// Phase 3, Wave 0 helpers. Same precedent as the Phase 2 block above: every
// seam a later plan asserts THROUGH gets a live case here, so a seam that
// silently stopped working fails in this file rather than turning some Wave 1
// assertion vacuous. [threat T-03-01-05]
// ===========================================================================

/** What one wrapped provider call reported back to its caller. */
interface StatusCapture {
	/** Every `onResponse` invocation, in order. Its LENGTH is the assertion. */
	statuses: number[];
	/** Every `onPayload` invocation, in order. */
	payloads: unknown[];
	/** The assistant message's text, flattened. */
	text: string;
}

/**
 * Drive exactly one provider call through `wrap(faux)` and record what the
 * caller's callbacks saw.
 *
 * The runtime is constructed the way `tests/helpers/session.ts` does it --
 * `modelsPath: null` so the developer's own `models.json` is never read, and
 * `refreshOnCreate: false` so nothing touches the network -- and the temp agent
 * directory is removed in the `finally`.
 */
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
			// A leftover temp dir is noise, not a failure.
		}
	}
}

/**
 * PROV-08's seam -- a faux provider that can report a status other than 200.
 *
 * `fauxProvider` runs `onResponse({ status: 200, headers: {} })` unconditionally
 * (pi-ai 0.84.1 src/providers/faux.ts:510), so a fallback-chain test meaning to
 * distinguish quota (429) from unavailable (503) would, without this wrapper, be
 * asserting against a 200 in both cases and passing either way.
 *
 * The first case is the live-oracle control, in the shape
 * `logs-gitignored.test.ts:74-83` uses: it proves the recorder answers 200 when
 * nothing rewrites the status, so the 503 in the case below it came from the
 * wrapper rather than from a recorder that says 503 to everything.
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

		// Non-emptiness FIRST -- the house rule. An empty capture list satisfies
		// every assertion about its contents without executing one of them.
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
 * The PROV-01 / PROV-03 / PROV-04 / PROV-06 / PROV-07 seam -- an offline model
 * registry over an arbitrary models.json.
 *
 * Every structural claim this phase makes about the shipped templates has to be
 * made against the model Pi COMPOSED, never against the template's bytes: Pi
 * validates models.json with typebox and accepts an unknown `compat` key in
 * silence, so a template carrying `supportsStoore: false` passes every
 * byte-level assertion ever written about it while configuring nothing
 * (Trap T6).
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
				// `.invalid` is reserved by RFC 2606 and resolves nowhere. Nothing in
				// this block issues a request, and this makes that true by
				// construction rather than by assertion.
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

			// `Model.compat` is a four-arm union keyed on the API family, and only
			// the openai-completions arm declares `thinkingFormat`. Reading it
			// through an index signature is the honest narrowing here: the
			// assertion is about the value Pi composed, not about which arm the
			// type checker picked.
			const compat = model.compat as Record<string, unknown> | undefined;
			expect(
				compat?.thinkingFormat,
				"the composed compat must carry the declared thinkingFormat. This is the field " +
					"PROV-03 exists for: detectCompat has no DashScope branch, so an unset value " +
					"here means thinking is silently never enabled on the wire",
			).toBe("qwen");

			// The positive control that the object is COMPOSED and not the config's
			// own bytes: maxTokens was never declared, so only Pi can have supplied
			// it. A test reading the template JSON would find `undefined` here.
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
					// The paired positive. "Absent afterwards" is satisfied by a helper
					// that never set the key at all, so presence is asserted first.
					expect(
						process.env[ABSENT_KEY],
						"the env option must be visible to code running inside the callback -- that " +
							"is the whole seam",
					).toBe("resolved-at-runtime");
					expect(
						process.env[PRESENT_KEY],
						"an env entry must override a variable that already existed, not defer to it",
					).toBe("overridden-value");

					// The env must reach Pi's own config-value resolution, not just
					// process.env -- that round trip IS PROV-01. (It says nothing about
					// ordering relative to ModelRuntime.create: `$ENV_VAR` values are
					// resolved lazily at getProviderAuth() time, verified by swapping
					// the two statements and watching this stay green. The ordering
					// rationale lives in tests/helpers/models.ts.)
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

			// Paired positive: the files must exist WHILE the callback runs, or the
			// cleanup assertion below is satisfied by a helper that wrote nothing.
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

/**
 * Fetch `url` and report the outcome as data.
 *
 * The signal bounds every call: a case here asserts a fetch FAILS, and a hung
 * connect would otherwise stall the whole suite rather than fail it. The body
 * is drained on the success path so the socket is not left half-read.
 */
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
 * The PROV-03 / PROV-10 seam -- a loopback server that records what Pi emitted.
 *
 * This is the seam that turns "the source says Pi sends `enable_thinking`" into
 * "the wire shows Pi sent `enable_thinking`", with no credential and no egress.
 * Four properties have to hold before any Wave 2 payload assertion built on it
 * means anything, and each gets a case: it CAPTURES (a server that recorded
 * nothing makes every body assertion vacuous, [threat T-03-03-05]); it RESPONDS
 * with a stream the adapter can finish (otherwise the payload test hangs rather
 * than fails, [threat T-03-03-04]); it REFUSES a non-loopback host before
 * handing out a URL ([threat T-03-03-01]); and it RELEASES its port, on the
 * clean path and on the throwing path alike ([threat T-03-03-03]).
 *
 * What none of this proves: that DashScope accepts anything. That is RB-03-01
 * and RB-03-02 in docs/RUNBOOK.md, both OUTSTANDING.
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

			// Non-emptiness FIRST -- the house rule. Every assertion below indexes
			// this array, so an empty one turns them all into a pass that verified
			// nothing: a server that captured zero requests satisfies "the recorded
			// body has no `store` key" perfectly. [threat T-03-03-05]
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

			// The paired positive. Without it a refusal that threw on EVERYTHING --
			// including the handle's own URL -- would satisfy the assertions above
			// while making the helper unusable.
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
			// The paired positive, taken BEFORE teardown: the URL must be reachable
			// while the server is up, or "unreachable afterwards" is satisfied by a
			// server that never listened at all.
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
