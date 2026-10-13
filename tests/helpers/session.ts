/**
 * A live in-memory Pi session against `fauxProvider`: no network, no credentials, no writes into this repository.
 * The extension under test loads at USER scope, because project `.pi/extensions` is trust-gated and trust resolves
 * false headless. `cwd` is always a temp dir outside the repo, or Pi walks up into this repo's large CLAUDE.md.
 * Failures throw with the remedy; nothing here skips.
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
import type { AgentSession, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { type FixturePayloadBuilder, wrapFauxWithPayload } from "./faux.ts";

/** Module-private: the helper writes the extension and returns its `agentDir`, so no test rebuilds the path. */
const EXTENSION_UNDER_TEST = "kypi-under-test";

/** `reasoning: true` keeps `reasoningEffort` unclamped; non-zero rates make a cost assertion more than `0 === 0`. */
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
	/** Scripted responses; a factory step can assert on the outgoing request. Default: one "ok", so nothing hangs. */
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
	 * Provider id the faux provider registers under (default: faux's own), for gates on `AssistantMessage.provider`.
	 * It replaces a built-in of the same id, and its auth still resolves empty.
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
 * Writes a user-scope shim that dynamically imports `targetAbsPath`: the same shape `bin/bootstrap.sh` generates, so
 * this drives production's own stub bytes. Backslashes become forward slashes, since `C:\Users` in a string literal
 * is escape sequences. Returns the shim path.
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
		// A leftover temp dir must never mask the test's own result.
	}
}

/** A live faux-backed session; the caller owns `dispose()`, so prefer {@link withFauxSession}. */
export async function createFauxSession(
	opts: FauxSessionOptions = {},
): Promise<FauxSessionHandle> {
	// `cwd` stays outside this repository; only `kypi-` mkdtemp paths are ever removed.
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

/** Runs `fn` against a fresh faux session, disposing it in a `finally` even when an assertion throws. */
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

/** Polls `hasConfiguredAuth`: after `setRuntimeApiKey` resolves, its cached snapshot lags by a few ms (measured). */
export async function waitForConfiguredAuth(modelRuntime: ModelRuntime, providerId: string, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!modelRuntime.hasConfiguredAuth(providerId)) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitForConfiguredAuth: ${providerId} never reported configured auth within ${timeoutMs}ms after setRuntimeApiKey resolved.`);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/** A notification `ctx.ui.notify` recorded. */
export interface Notification {
	text: string;
	level?: string;
}

/**
 * Replaces `ctx.ui` with a recorder. `defineProperty`, not assignment: the command context's `ui` is a getter-only
 * accessor (pi 1.1.0 dist/core/extensions/runner.js:618-620, :728).
 */
export function withCapturedNotify(ctx: ExtensionContext, notifications: Notification[]): void {
	Object.defineProperty(ctx, "ui", {
		value: { notify: (text: string, level?: string) => void notifications.push({ text, level }) },
		writable: true,
		configurable: true,
		enumerable: true,
	});
}

/** Polls `predicate` every 5ms until true, or throws naming `label`. */
export async function waitFor(predicate: () => boolean, timeoutMs = 5000, label = "condition"): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error(`waitFor: "${label}" was not met within ${timeoutMs}ms`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/**
 * Patches the shared `ctx.ui.notify` method, so notifications from event contexts (e.g. `agent_end`) are recorded too:
 * every context's `ui` getter returns the same `runner.uiContext` (pi 1.1.0 dist/core/extensions/runner.js:618-620).
 * Callers must `restore()` in a `finally`.
 */
export function captureNotify(ctx: ExtensionContext): { notifications: Notification[]; restore: () => void } {
	const notifications: Notification[] = [];
	const ui = ctx.ui as unknown as { notify: (text: string, level?: string) => void };
	const original = ui.notify;
	ui.notify = (text, level) => void notifications.push({ text, level });
	return { notifications, restore: () => void (ui.notify = original) };
}
