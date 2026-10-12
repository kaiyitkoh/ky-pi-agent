/**
 * A composed faux session: every tracked extension entry point, the repo AGENTS.md and the repo skills
 * loaded together, offline, so the outgoing system prompt and tool list can be measured.
 *
 * Differences from createFauxSession that matter for measurement:
 * - No `tools` allowlist is passed; an allowlist filters registration of every extension tool.
 * - Extensions load as ONE user-scope inline extension (project scope is trust-gated headless).
 * - Paths are normalised before counting so the numbers are equal on every machine and CI OS.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FauxResponseStep, Tool, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, toToolDeclaration } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { type BudgetReport, computeBudget } from "../../.pi/extensions/diagnostics/budget.ts";
import { transcriptView, wrapFauxWithPayload } from "./faux.ts";
import { repoRoot, trackedFiles } from "./git.ts";

const QODER_ENV = [
	"QODER_PERSONAL_ACCESS_TOKEN",
	"QODER_AGENT_ID",
	"QODER_ENVIRONMENT_ID",
	"QODER_BASE_URL",
] as const;

// Pi's extension discovery: `<dir>/*.ts` and `<dir>/<name>/index.ts` (not nested helper files).
const DISCOVERED = /^\.pi\/extensions\/(?:[^/]+\.ts|[^/]+\/index\.ts)$/;

// Same predicate as the extension-layout test: a top-level default export marks an entry point.
const DEFAULT_EXPORT =
	/^[ \t]*export[ \t]+default[ \t]*(async[ \t]+function|function|class|\(|[A-Za-z_$])/m;

export interface HarnessSessionOptions {
	/** Repo-relative entry points to load. Default: every tracked one. */
	entryPoints?: readonly string[];
	/** Copy the real root AGENTS.md into the temp cwd. Default true. */
	agentsMd?: boolean;
	/** Offer the repo `.pi/skills` directory. Default true. */
	skills?: boolean;
	/** Value for the `ky-profile` flag, set before session_start. */
	profile?: string;
	/** Other extension flags, set before session_start. */
	flags?: Record<string, boolean | string>;
	/** A second inline user-scope extension, for negative controls. */
	extraExtensionSource?: string;
	/** Faux steps. Default: one "ok" reply. */
	responses?: FauxResponseStep[];
}

export interface HarnessHandle {
	session: AgentSession;
	cwd: string;
	agentDir: string;
	/** Every outgoing request context, in order. */
	captured: TranscriptContext[];
	dispose(): Promise<void>;
}

export interface FloorMeasurement {
	toolNames: string[];
	systemPromptRaw: string;
	/** Path-normalised. */
	systemPrompt: string;
	budget: BudgetReport;
	/** Sum of JSON.stringify(toToolDeclaration(tool)) lengths: the provider-wire view, never compared with budget. */
	wireToolChars: number;
	systemMessageCount: number;
}

/** Repo-relative extension entry points, derived from git, sorted. */
export function listEntryPoints(): string[] {
	const found = trackedFiles(".pi/extensions")
		.filter((file) => DISCOVERED.test(file))
		.filter((file) => DEFAULT_EXPORT.test(readFileSync(join(repoRoot(), file), "utf-8")))
		.sort();
	if (found.length === 0) {
		throw new Error("listEntryPoints: no tracked extension entry points found under .pi/extensions");
	}
	return found;
}

function forwardSlash(path: string): string {
	return path.replace(/\\/g, "/");
}

function removeQuietly(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	} catch {
		// A leftover temp dir is noise, not a failure.
	}
}

function extensionSource(entryPoints: readonly string[], skillsDir: string | undefined): string {
	const root = forwardSlash(repoRoot());
	const lines = ["export default async function (pi) {"];
	if (skillsDir !== undefined) {
		lines.push(
			`  pi.on("resources_discover", () => ({ skillPaths: [${JSON.stringify(skillsDir)}] }));`,
		);
	}
	for (const entry of entryPoints) {
		lines.push(
			`  await (await import(${JSON.stringify(`${root}/${entry}`)})).default(pi);`,
		);
	}
	lines.push("}", "");
	return lines.join("\n");
}

export async function createHarnessSession(
	opts: HarnessSessionOptions = {},
): Promise<HarnessHandle> {
	const entryPoints = opts.entryPoints ?? listEntryPoints();
	const agentDir = mkdtempSync(join(tmpdir(), "kypi-harness-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "kypi-harness-cwd-"));
	const savedEnv = new Map<string, string | undefined>();
	for (const name of QODER_ENV) {
		savedEnv.set(name, process.env[name]);
		delete process.env[name];
	}
	const restoreEnv = (): void => {
		for (const [name, value] of savedEnv) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	};

	try {
		if (opts.agentsMd !== false) {
			writeFileSync(join(cwd, "AGENTS.md"), readFileSync(join(repoRoot(), "AGENTS.md")));
		}

		const skillsDir = opts.skills === false ? undefined : forwardSlash(join(repoRoot(), ".pi", "skills"));
		const extDir = join(agentDir, "extensions", "kypi-harness");
		mkdirSync(extDir, { recursive: true });
		writeFileSync(join(extDir, "index.ts"), extensionSource(entryPoints, skillsDir), "utf-8");
		if (opts.extraExtensionSource !== undefined) {
			const extra = join(agentDir, "extensions", "kypi-extra");
			mkdirSync(extra, { recursive: true });
			writeFileSync(join(extra, "index.ts"), `${opts.extraExtensionSource}\n`, "utf-8");
		}

		const captured: TranscriptContext[] = [];
		const capture: FauxResponseStep = (context) => {
			captured.push(context);
			return fauxAssistantMessage("ok");
		};

		const faux = fauxProvider({
			models: [{ id: "faux-flash", reasoning: true }],
		});
		faux.setResponses(opts.responses ?? [capture]);

		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			refreshOnCreate: false,
		});
		modelRuntime.registerNativeProvider(wrapFauxWithPayload(faux, undefined));
		const model = modelRuntime.getModel(faux.provider.id, "faux-flash");
		if (!model) throw new Error("createHarnessSession: faux model did not resolve");

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			modelRuntime,
			settingsManager: SettingsManager.inMemory(
				{ extensions: ["-builtin:mcp", "-builtin:llama.cpp", "-builtin:codemode", "-builtin:tool-search"] },
				{},
			),
			sessionManager: SessionManager.inMemory(cwd),
		});

		const flags: Record<string, boolean | string> = { ...(opts.flags ?? {}) };
		if (opts.profile !== undefined) flags["ky-profile"] = opts.profile;
		for (const [name, value] of Object.entries(flags)) {
			session.extensionRunner.setFlagValue(name, value);
		}
		await session.bindExtensions({});

		return {
			session,
			cwd,
			agentDir,
			captured,
			dispose: async (): Promise<void> => {
				try {
					session.dispose();
				} catch {
					// Disposal noise must not mask an assertion.
				}
				restoreEnv();
				removeQuietly(cwd);
				removeQuietly(agentDir);
			},
		};
	} catch (error) {
		restoreEnv();
		removeQuietly(cwd);
		removeQuietly(agentDir);
		throw error;
	}
}

export async function withHarnessSession<T>(
	opts: HarnessSessionOptions,
	fn: (handle: HarnessHandle) => Promise<T>,
): Promise<T> {
	const handle = await createHarnessSession(opts);
	try {
		return await fn(handle);
	} finally {
		await handle.dispose();
	}
}

/** Replace temp dirs and the repo root (both slash forms, longest first) with fixed placeholders. */
export function normalisePaths(
	text: string,
	handle: Pick<HarnessHandle, "cwd" | "agentDir">,
): string {
	const pairs: [string, string][] = [
		[handle.cwd, "<cwd>"],
		[handle.agentDir, "<agent>"],
		[repoRoot(), "<repo>"],
	];
	const variants = pairs.flatMap(([path, placeholder]) => [
		[path, placeholder] as const,
		[forwardSlash(path), placeholder] as const,
	]);
	variants.sort((a, b) => b[0].length - a[0].length);
	let out = text;
	for (const [path, placeholder] of variants) out = out.split(path).join(placeholder);
	return out;
}

export async function measureFloor(opts: HarnessSessionOptions = {}): Promise<FloorMeasurement> {
	return withHarnessSession(opts, async (handle) => {
		await handle.session.prompt("hi");
		const first = handle.captured[0];
		if (first === undefined) throw new Error("measureFloor: no request reached the faux provider");
		const view = transcriptView(first);
		const systemPrompt = normalisePaths(view.systemPrompt, handle);
		const tools: Tool[] = view.tools;
		const budget = computeBudget({
			systemPrompt,
			contextFiles: [],
			skills: [],
			skillsBlock: "",
			tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
			lastUsage: undefined,
			rowsWritten: 0,
		});
		return {
			toolNames: tools.map((t) => t.name),
			systemPromptRaw: view.systemPrompt,
			systemPrompt,
			budget,
			wireToolChars: tools.reduce((n, t) => n + JSON.stringify(toToolDeclaration(t)).length, 0),
			systemMessageCount: first.messages.filter((m) => m.role === "system").length,
		};
	});
}
