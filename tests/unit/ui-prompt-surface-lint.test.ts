import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

const EXT_DIR = ".pi/extensions";
const UI_DIR = ".pi/extensions/ui";

const UI_CUSTOM = /\bui\s*(?:\?\.|\.)\s*custom\s*[(<]/;

const UI_FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
	{ pattern: /systemPrompt/, why: "chrome must never write the system prompt" },
	{ pattern: /promptSnippet/, why: "prompt metadata is part of the cached prefix" },
	{ pattern: /promptGuidelines/, why: "prompt metadata is part of the cached prefix" },
	{ pattern: /registerTool/, why: "a tool here would change the per-turn tool budget" },
	{ pattern: /registerCommand\(/, why: "a command here would change the workflow ratchet" },
	{ pattern: /setActiveTools/, why: "chrome must not change which tools the model sees" },
	{ pattern: /before_agent_start/, why: "this hook is the system prompt rewrite point" },
	{ pattern: /on\(\s*["'](?:context|before_provider_request)["']/, why: "these hooks rewrite what the provider receives" },
	{ pattern: /sendMessage/, why: "chrome must not inject conversation messages" },
	{ pattern: /sendUserMessage/, why: "chrome must not inject conversation messages" },
	{ pattern: /context_with_system/, why: "a prompt-bearing context entry would leak chrome into the prefix" },
	{ pattern: /vendored/i, why: "a file spelling vendored is treated as a vendored entry point by the tool-count baseline" },
];

function violations(text: string): string[] {
	return UI_FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(
		({ pattern, why }) => `${String(pattern)} (${why})`,
	);
}

function vendoredSet(tracked: readonly string[]): Set<string> {
	const set = new Set(tracked);
	const vendored = new Set<string>();
	for (const path of tracked) {
		if (!path.endsWith(".ts")) continue;
		const rest = path.slice(EXT_DIR.length + 1).split("/");
		const siblingMarker = path.replace(/\.ts$/, ".PROVENANCE.md");
		if (set.has(siblingMarker)) {
			vendored.add(path);
			continue;
		}
		if (rest.length > 1 && set.has(`${EXT_DIR}/${rest[0]}/PROVENANCE.md`)) vendored.add(path);
	}
	return vendored;
}

describe("ui prompt surface", () => {
	const tracked = trackedFiles(EXT_DIR);
	const read = (path: string): string => readFileSync(join(repoRoot(), path), "utf-8");
	const vendored = vendoredSet(tracked);
	const authored = tracked.filter((p) => p.endsWith(".ts") && !vendored.has(p)).sort();

	it("derives a vendored set from PROVENANCE markers", () => {
		expect(vendored.size).toBeGreaterThan(0);
		expect(vendored.has(`${EXT_DIR}/questionnaire.ts`)).toBe(true);
		expect(vendored.has(`${EXT_DIR}/todo.ts`)).toBe(true);
		const bgTasks = tracked.filter((p) => p.startsWith(`${EXT_DIR}/background-tasks/`) && p.endsWith(".ts"));
		expect(bgTasks.length).toBeGreaterThan(0);
		for (const p of bgTasks) expect(vendored.has(p), p).toBe(true);
	});

	it("authored extensions never use ui.custom, so every prompt can reach ACP hosts", () => {
		expect(authored.length).toBeGreaterThanOrEqual(10);
		const offenders = authored.filter((p) => UI_CUSTOM.test(read(p)));
		expect(offenders, "use ctx.ui.confirm or ctx.ui.select; custom components have no ACP equivalent").toEqual([]);
	});

	it("the scan sees real confirm and select call sites", () => {
		const texts = authored.map(read);
		expect(texts.some((t) => /\bui\.confirm\(/.test(t))).toBe(true);
		expect(texts.some((t) => /\bui\.select\(/.test(t))).toBe(true);
	});

	it("the ui extension has no prompt, tool, command or message surface", () => {
		const files = tracked.filter((p) => p.startsWith(`${UI_DIR}/`) && p.endsWith(".ts"));
		expect(files.length).toBeGreaterThanOrEqual(4);
		const offenders = files.flatMap((p) => violations(read(p)).map((v) => `${p}: ${v}`));
		expect(offenders, "patterns run on raw source; if the match is in a comment, reword it").toEqual([]);
	});

	it("every forbidden pattern fires on an inline offending fixture", () => {
		const lines: Record<string, string> = {
			systemPrompt: "return { systemPrompt: x };",
			promptSnippet: "promptSnippet: 'x',",
			promptGuidelines: "promptGuidelines: ['x'],",
			registerTool: "pi.registerTool({});",
			registerCommand: "pi.registerCommand('x', {});",
			setActiveTools: "pi.setActiveTools([]);",
			before_agent_start: "pi.on('before_agent_start', f);",
			context: "pi.on(\"context\", f);",
			before_provider_request: "pi.on( 'before_provider_request', f);",
			sendMessage: "pi.sendMessage(m);",
			sendUserMessage: "pi.sendUserMessage(m);",
			context_with_system: "const k = 'context_with_system';",
			vendored: "// Vendored entry",
		};
		for (const { pattern } of UI_FORBIDDEN) {
			expect(
				Object.values(lines).some((l) => pattern.test(l)),
				String(pattern),
			).toBe(true);
		}
		for (const [name, line] of Object.entries(lines)) expect(violations(line).length, name).toBeGreaterThan(0);
	});

	it("flags an inline ui.custom fixture and passes a clean chrome fixture", () => {
		expect(UI_CUSTOM.test("await ctx.ui.custom((tui) => c);")).toBe(true);
		expect(UI_CUSTOM.test("await ctx.ui?.custom<string>(f);")).toBe(true);
		const clean = [
			"ctx.ui.setStatus('k', 'v');",
			"ctx.ui.setHeader(factory);",
			"await ctx.ui.confirm('t', 'm');",
			"await ctx.ui.select('t', ['a']);",
		].join("\n");
		expect(UI_CUSTOM.test(clean)).toBe(false);
		expect(violations(clean)).toEqual([]);
	});
});
