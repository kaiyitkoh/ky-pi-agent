/**
 * The safety extension loaded twice in one runtime: the bootstrap stub plus a
 * trusted checkout's own `.pi/extensions/safety`. Pi turns two extensions
 * registering one tool name into a load error and exits
 * (core/resource-loader.js detectExtensionConflicts, main.js), so the second
 * copy must register no tool, yet keep a blocking tool_call hook.
 *
 * Driven through Pi's real DefaultResourceLoader, whose reload() runs the same
 * conflict detection the CLI does.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";

const GUARD = join(repoRoot(), ".pi", "extensions", "safety", "index.ts").replace(/\\/g, "/");
const GUARD_TOOLS = ["approve_ky_command", "bash", "edit", "read", "write"];

let scratch: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
}

/** Same shape bin/bootstrap.sh#install_safety_extension writes: a dynamic import of the guard. */
function writeStub(dir: string, name: string): string {
	mkdirSync(join(dir, name), { recursive: true });
	const file = join(dir, name, "index.ts");
	writeFileSync(
		file,
		`export default async function (pi) {\n  const mod = await import(${JSON.stringify(GUARD)});\n  await mod.default(pi);\n}\n`,
		"utf-8",
	);
	return file;
}

async function loadBoth(): Promise<{ loader: DefaultResourceLoader; cwd: string }> {
	const cwd = tempDir("kypi-double-cwd-");
	const agentDir = tempDir("kypi-double-agent-");
	const stub = writeStub(tempDir("kypi-double-stub-"), "ky-safety");
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: SettingsManager.inMemory({}, {}),
		additionalExtensionPaths: [stub, GUARD],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	return { loader, cwd };
}

function toolNames(loader: DefaultResourceLoader): string[][] {
	return loader.getExtensions().extensions.map((ext) => [...ext.tools.keys()].sort());
}

describe("safety extension double load", () => {
	afterEach(() => {
		for (const dir of scratch) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		scratch = [];
	});

	it("the second copy registers no tool, so Pi reports no conflict", async () => {
		const { loader } = await loadBoth();
		const result = loader.getExtensions();

		expect(result.errors).toEqual([]);
		expect(toolNames(loader)).toEqual([GUARD_TOOLS, []]);
	}, 60_000);

	it("both copies keep a tool_call hook, and the second one still blocks", async () => {
		const { loader, cwd } = await loadBoth();
		const [first, second] = loader.getExtensions().extensions;
		const ctx = { cwd, hasUI: false, mode: "print" };
		const event = { type: "tool_call", toolName: "bash", toolCallId: "call-1", input: { command: "terraform apply" } };

		for (const ext of [first, second]) {
			const hooks = ext?.handlers.get("tool_call") ?? [];
			expect(hooks).toHaveLength(1);
			const verdict = (await hooks[0]?.(event, ctx)) as { block?: boolean } | undefined;
			expect(verdict?.block).toBe(true);
		}
		expect(second?.handlers.has("session_start")).toBe(false);
	}, 60_000);

	it("a subagent definition change confirmed in the first hook is not asked again by the second", async () => {
		const { loader, cwd } = await loadBoth();
		const [first, second] = loader.getExtensions().extensions;
		let asked = 0;
		const ctx = { cwd, hasUI: true, mode: "tui", ui: { confirm: async () => (asked += 1) > 0 } };
		const run = async (toolCallId: string) => {
			const event = { type: "tool_call", toolName: "subagent", toolCallId, input: { action: "create", name: "x" } };
			const verdicts = [];
			for (const ext of [first, second]) verdicts.push(await ext?.handlers.get("tool_call")?.[0]?.(event, ctx));
			return verdicts;
		};

		expect(await run("call-a")).toEqual([undefined, undefined]);
		expect(asked).toBe(1);
		await run("call-b");
		expect(asked, "a different tool call asks again").toBe(2);
	}, 60_000);

	it("after the runtime is invalidated, as /reload does, the next load registers in full again", async () => {
		const { loader } = await loadBoth();
		loader.getExtensions().runtime.invalidate();

		await loader.reload();

		expect(loader.getExtensions().errors).toEqual([]);
		expect(toolNames(loader)).toEqual([GUARD_TOOLS, []]);
	}, 60_000);
});
