/**
 * An in-memory Pi agent session: no network, no credentials, no writes into
 * this repository.
 *
 * ---------------------------------------------------------------------------
 * Why any of this exists
 * ---------------------------------------------------------------------------
 * Every diagnostics requirement in this phase is a claim about what happens
 * inside a *real* agent run — which extension hook fired, in what order, with
 * what payload. A unit test over a pure function cannot make that claim, and
 * driving the real `pi` binary cannot inspect the objects. So the tests drive
 * `createAgentSession()` directly against `fauxProvider`, which needs no key
 * and touches no socket: faux auth resolves empty
 * (`pi-ai src/providers/faux.ts:689`).
 *
 * The skeleton below was executed end to end before it was written down
 * [VERIFIED: executed 2026-08-13, node 24.16.0, Pi 0.84.1 — RESEARCH.md §8.4].
 * Four things in it are counter-intuitive enough to be worth stating, because
 * three of them are corrections to earlier planning documents:
 *
 *   1. **The in-memory credential store named by ARCHITECTURE.md and
 *      CONTEXT.md does not exist in Pi 0.84.1** — the symbol is not exported
 *      and is deliberately not spelled anywhere in this file, so nobody greps
 *      for it and concludes it is available. The real primitives are
 *      `ModelRuntime.create({ credentials?, authPath })`
 *      (`model-runtime.ts:68-69`) and `AuthStorage.inMemory()`
 *      (`core/auth-storage.ts:357`). Neither is needed here — faux resolves
 *      empty auth, so `authPath` may point at a file that does not exist.
 *   2. **`SettingsManager.inMemory(settings, options)` takes two arguments**
 *      (`settings-manager.ts:157`). Calling it with one is a type error under
 *      `strict`.
 *   3. **The extension under test must load at USER scope**, i.e.
 *      `<agentDir>/extensions/<name>/index.ts`. Project-scoped
 *      `.pi/extensions` is gated behind project trust, which returns `false`
 *      headless with no UI to answer it. See {@link writeUserScopeShim}.
 *   4. **`cwd` is a temp directory outside this repository, always.** Pi walks
 *      up from `cwd` collecting context files; from anywhere inside this repo
 *      that means loading a 49 KB `CLAUDE.md` into every faux request
 *      (measured: 12,725 input tokens for a one-word prompt). A test that
 *      wants a context file plants its own small one through `cwdFiles`.
 *      [threat T-02-01-02]
 *
 * ---------------------------------------------------------------------------
 * Throw, never skip
 * ---------------------------------------------------------------------------
 * Every failure path here throws with the remedy in the message. There is
 * deliberately no skip escape hatch anywhere in this file, and an auditor
 * grepping for one should find nothing — a helper that removes itself when a
 * prerequisite is missing turns CI green having verified nothing, which is the
 * exact failure mode this phase exists to eliminate. The wording discipline is
 * copied from `tests/helpers/pi.ts`. [threat T-02-01-04]
 *
 * ---------------------------------------------------------------------------
 * Asynchronous by design
 * ---------------------------------------------------------------------------
 * `withStubBin` in `tests/helpers/stub-bin.ts` rejects a thenable callback,
 * because it deletes its temp directory the instant the callback returns.
 * {@link withFauxSession} is the ASYNC mirror of that helper and must NOT copy
 * the guard: it `await`s the callback inside the `try` and disposes in the
 * `finally`, so an async callback is the normal case rather than the error.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
	Api,
	FauxModelDefinition,
	FauxProviderHandle,
	FauxResponseStep,
	Model,
} from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { type FixturePayloadBuilder, wrapFauxWithPayload } from "./faux.ts";

/**
 * Directory name the user-scope extension under test is written into.
 *
 * Module-private: no test needs to name it, because the helper both writes the
 * extension and hands back the `agentDir` it lives under. Exporting it would
 * invite a test to reconstruct the path by hand instead.
 */
const EXTENSION_UNDER_TEST = "kypi-under-test";

/**
 * The default faux model.
 *
 * `reasoning: true` so `reasoningEffort` is not clamped away, and non-zero cost
 * rates so `calculateCost(model, usage)` produces a number a test can
 * distinguish from the all-zero `usage.cost` faux hardcodes
 * (`pi-ai src/providers/faux.ts:264`). A cost assertion against bare faux is
 * `0 === 0`.
 */
const DEFAULT_MODELS: FauxModelDefinition[] = [
	{
		id: "faux-flash",
		reasoning: true,
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 },
	},
];

export interface FauxSessionOptions {
	/** Faux model definitions. Default: one `faux-flash` with non-zero cost rates. */
	models?: FauxModelDefinition[];
	/**
	 * Scripted responses handed to `faux.setResponses`. A step may be a factory
	 * `(context, options, state, model) => AssistantMessage`, which is how a
	 * test asserts on the OUTGOING request.
	 *
	 * Default: one `"ok"` assistant message, so a caller who forgets does not
	 * hang waiting on an empty script.
	 */
	responses?: FauxResponseStep[];
	/** Tool allowlist forwarded to `createAgentSession`. Default: no tools. */
	tools?: string[];
	/** Absolute path to an extension entry file, loaded at user scope via a shim. */
	extensionPath?: string;
	/** Inline TypeScript written as the user-scope extension instead of a shim. */
	extensionSource?: string;
	/** Relative path to content, planted in the temp cwd before the session starts. */
	cwdFiles?: Record<string, string>;
	/** Payload builder forwarded to `wrapFauxWithPayload`. */
	buildPayload?: FixturePayloadBuilder;
	/**
	 * Provider id the faux provider registers under. Default: faux's own.
	 *
	 * WHY THIS SEAM EXISTS. `AssistantMessage.provider` is a required field
	 * [pi-ai 0.84.1 dist/types.d.ts:299] and an extension may legitimately gate
	 * on it — the SSO classifier does, because its remedy is meaningless for a
	 * non-AWS vendor (WR-05). A test for such a gate has to be able to say which
	 * provider the message came from, in BOTH directions, or the gate is only
	 * ever exercised on the branch that returns early.
	 *
	 * `registerNativeProvider` replaces a built-in of the same id, so passing
	 * `"amazon-bedrock"` here yields a faux provider under that id whose auth
	 * still resolves empty. Nothing is dialled and no credential is read.
	 */
	providerId?: string;
}

export interface FauxSessionHandle {
	session: AgentSession;
	faux: FauxProviderHandle;
	model: Model<Api>;
	modelRuntime: ModelRuntime;
	/** Temp working directory. Guaranteed to be outside this repository. */
	cwd: string;
	/** Temp Pi agent directory. Holds `extensions/` and a notional `auth.json`. */
	agentDir: string;
	dispose(): Promise<void>;
}

/**
 * Write a user-scope extension that imports and calls another file's default
 * export.
 *
 * Pi discovers user extensions at `<agentDir>/extensions/<name>/index.ts`.
 * Project-scoped `.pi/extensions` is NOT usable here: project resources are
 * gated behind project trust, and headless there is no UI to answer the prompt,
 * so trust resolves `false` and the extension silently never loads (RESEARCH
 * §8.4). A silently-absent extension under test is a green run that proved
 * nothing, so the shim route is mandatory rather than convenient.
 *
 * CR-09: this shape (a dynamic `import()` inside an `async function` wrapper,
 * unconditional -- no existence check, no dedup) is deliberately kept in sync
 * with the REAL stub `bin/bootstrap.sh#install_safety_extension` generates,
 * not a simplified `export { default } from "..."` re-export. The review that
 * found CR-09 named exactly this mismatch as an aggravating factor: an
 * earlier version of this helper wrote a static re-export, a DIFFERENT shape
 * from what production actually generates, so `headless-deny.test.ts` (the
 * one test that exercises the confirm/UI path through a real user-scope
 * stub) was never actually driving production's own bytes. If a future
 * change reintroduces a bug in `install_safety_extension`'s own generated
 * content -- a bad specifier normalisation, say -- this helper producing the
 * SAME shape gives that class of bug a chance to surface here too, instead
 * of only in `bootstrap-safety-stub.test.ts`.
 *
 * The module specifier has every backslash replaced with a forward slash:
 * `C:\Users\...` inside a TypeScript string literal is a set of escape
 * sequences, not a path, and on Windows that is every path.
 *
 * @returns the absolute path of the shim that was written.
 */
export function writeUserScopeShim(agentDir: string, name: string, targetAbsPath: string): string {
	const dir = join(agentDir, "extensions", name);
	mkdirSync(dir, { recursive: true });
	const specifier = targetAbsPath.replace(/\\/g, "/");
	const shim = join(dir, "index.ts");
	writeFileSync(
		shim,
		[
			"// Generated user-scope shim -- see tests/helpers/session.ts. Lives in a temp dir.",
			"// CR-09: kept in the same shape bin/bootstrap.sh#install_safety_extension",
			"// actually generates -- an unconditional dynamic import, not a static",
			"// re-export -- so this shim exercises production's own bytes.",
			"export default async function (pi) {",
			`  const mod = await import(${JSON.stringify(specifier)});`,
			"  await mod.default(pi);",
			"}",
			"",
		].join("\n"),
		"utf-8",
	);
	return shim;
}

/** Write an inline extension source as the user-scope extension under test. */
function writeUserScopeSource(agentDir: string, name: string, source: string): string {
	const dir = join(agentDir, "extensions", name);
	mkdirSync(dir, { recursive: true });
	const entry = join(dir, "index.ts");
	writeFileSync(entry, source.endsWith("\n") ? source : `${source}\n`, "utf-8");
	return entry;
}

/** Best-effort temp-dir removal. Never masks a real assertion result. */
function removeQuietly(dir: string): void {
	try {
		// maxRetries is the Windows convention in this repo: file handles linger.
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	} catch {
		// A leftover temp dir is noise, not a failure. [threat T-02-01-05]
	}
}

/**
 * Build a live in-memory agent session backed by the payload-emitting faux
 * provider.
 *
 * The caller owns `dispose()`. Prefer {@link withFauxSession}, which calls it
 * for you even when the body throws.
 */
export async function createFauxSession(
	opts: FauxSessionOptions = {},
): Promise<FauxSessionHandle> {
	// Two separate temp dirs. `cwd` is deliberately outside this repository --
	// see note 4 in the module docstring. Only paths produced by mkdtempSync
	// with a `kypi-` prefix are ever removed. [threat T-02-01-01]
	const agentDir = mkdtempSync(join(tmpdir(), "kypi-session-"));
	const cwd = mkdtempSync(join(tmpdir(), "kypi-cwd-"));

	try {
		for (const [relative, content] of Object.entries(opts.cwdFiles ?? {})) {
			const target = join(cwd, relative);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, content, "utf-8");
		}

		if (opts.extensionSource !== undefined && opts.extensionPath !== undefined) {
			throw new Error(
				"createFauxSession: pass `extensionSource` OR `extensionPath`, not both. " +
					"Two entry points at the same user-scope path would silently overwrite " +
					"each other and the test would assert against whichever won.",
			);
		}
		if (opts.extensionSource !== undefined) {
			writeUserScopeSource(agentDir, EXTENSION_UNDER_TEST, opts.extensionSource);
		} else if (opts.extensionPath !== undefined) {
			writeUserScopeShim(agentDir, EXTENSION_UNDER_TEST, opts.extensionPath);
		}

		const models = opts.models ?? DEFAULT_MODELS;
		const first = models[0];
		if (first === undefined) {
			throw new Error(
				"createFauxSession: `models` was empty. Pass at least one FauxModelDefinition, " +
					"or omit the option to get the default `faux-flash`.",
			);
		}

		const faux = fauxProvider(
			opts.providerId === undefined ? { models } : { models, provider: opts.providerId },
		);
		faux.setResponses(opts.responses ?? [fauxAssistantMessage("ok")]);

		const modelRuntime = await ModelRuntime.create({
			// The file need not exist; faux auth resolves empty.
			authPath: join(agentDir, "auth.json"),
			// null, not undefined: do NOT read the developer's ~/.pi/agent/models.json.
			modelsPath: null,
			// No catalogue refresh, so no network call at construction time.
			refreshOnCreate: false,
		});
		modelRuntime.registerNativeProvider(wrapFauxWithPayload(faux, opts.buildPayload));

		const model = modelRuntime.getModel(faux.provider.id, first.id);
		if (!model) {
			throw new Error(
				`createFauxSession: the faux model ${faux.provider.id}/${first.id} did not resolve ` +
					"after registerNativeProvider. Registering `faux.provider` instead of " +
					"`wrapFauxWithPayload(faux)` still resolves, so this is not that mistake -- " +
					"check the model id in `models[0]`.",
			);
		}

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			modelRuntime,
			// Two arguments -- see note 2 in the module docstring.
			settingsManager: SettingsManager.inMemory({}, {}),
			sessionManager: SessionManager.inMemory(cwd),
			tools: opts.tools ?? [],
		});

		return {
			session,
			faux,
			model,
			modelRuntime,
			cwd,
			agentDir,
			dispose: async (): Promise<void> => {
				try {
					session.dispose();
				} catch {
					// Disposal noise must not mask the assertion that just ran.
				}
				removeQuietly(cwd);
				removeQuietly(agentDir);
			},
		};
	} catch (error) {
		removeQuietly(cwd);
		removeQuietly(agentDir);
		throw error;
	}
}

/**
 * Run `fn` against a fresh faux session, then dispose it.
 *
 * Asynchronous by design -- see the module docstring. The callback is awaited
 * inside the `try` so the temp directories still exist for its whole lifetime,
 * and `dispose()` runs in the `finally` so a thrown assertion still cleans up.
 */
export async function withFauxSession<T>(
	opts: FauxSessionOptions,
	fn: (handle: FauxSessionHandle) => Promise<T>,
): Promise<T> {
	const handle = await createFauxSession(opts);
	try {
		return await fn(handle);
	} finally {
		await handle.dispose();
	}
}
