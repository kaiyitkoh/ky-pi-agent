import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const SCHEMA_PATH = join(
	ROOT,
	"node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json",
);
const THEMES_DIR = join(ROOT, ".pi/themes");
const THEME_PATH = join(THEMES_DIR, "ky.json");

type Json = Record<string, unknown>;

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as {
	properties: Record<string, Json> & { colors: { required: string[]; properties: Json }; export: { properties: Json } };
	required: string[];
};
const REQUIRED = schema.properties.colors.required;
const KNOWN = Object.keys(schema.properties.colors.properties);
const TOP_KEYS = Object.keys(schema.properties);
const EXPORT_KEYS = Object.keys(schema.properties.export.properties);

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PERCEPTUAL = /^(oklch|okhsl)\(/;

function valueProblem(value: unknown, vars: Json, where: string): string | undefined {
	if (typeof value === "number") {
		return Number.isInteger(value) && value >= 0 && value <= 255 ? undefined : `${where}: integer out of range`;
	}
	if (typeof value !== "string") return `${where}: not a string or integer`;
	const seen = new Set<string>();
	let current = value;
	for (;;) {
		if (current === "" || HEX.test(current) || PERCEPTUAL.test(current)) return undefined;
		if (seen.has(current)) return `${where}: vars cycle at ${current}`;
		seen.add(current);
		if (!Object.hasOwn(vars, current)) return `${where}: "${current}" is not a colour or a var`;
		const next = vars[current];
		if (typeof next === "number") return valueProblem(next, vars, where);
		if (typeof next !== "string") return `${where}: var ${current} is not a string or integer`;
		current = next;
	}
}

function themeProblems(theme: Json): string[] {
	const problems: string[] = [];
	for (const key of Object.keys(theme)) if (!TOP_KEYS.includes(key)) problems.push(`unknown top-level key ${key}`);
	for (const key of schema.required) if (!(key in theme)) problems.push(`missing ${key}`);
	const name = theme.name;
	if (typeof name !== "string" || !/^[^/]+$/.test(name) || name === "system") problems.push("bad name");
	if (theme.appearance !== undefined && theme.appearance !== "dark" && theme.appearance !== "light") {
		problems.push("bad appearance");
	}
	const vars = (theme.vars ?? {}) as Json;
	for (const [k, v] of Object.entries(vars)) {
		const p = valueProblem(v, vars, `vars.${k}`);
		if (p) problems.push(p);
	}
	const colors = (theme.colors ?? {}) as Json;
	for (const token of REQUIRED) if (!(token in colors)) problems.push(`missing token ${token}`);
	for (const [k, v] of Object.entries(colors)) {
		if (!KNOWN.includes(k)) problems.push(`unknown token ${k}`);
		const p = valueProblem(v, vars, `colors.${k}`);
		if (p) problems.push(p);
	}
	const exp = (theme.export ?? {}) as Json;
	for (const [k, v] of Object.entries(exp)) {
		if (!EXPORT_KEYS.includes(k)) problems.push(`unknown export key ${k}`);
		const p = valueProblem(v, vars, `export.${k}`);
		if (p) problems.push(p);
	}
	return problems;
}

const loadShipped = (): Json => JSON.parse(readFileSync(THEME_PATH, "utf8")) as Json;
const clone = (): { theme: Json; colors: Json; vars: Json } => {
	const theme = loadShipped();
	return { theme, colors: theme.colors as Json, vars: theme.vars as Json };
};

const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "ky-theme-"));
	temps.push(dir);
	return dir;
};

describe("theme schema sanity", () => {
	it("still has 56 colour tokens, 51 required", () => {
		expect(KNOWN).toHaveLength(56);
		expect(REQUIRED).toHaveLength(51);
	});
});

describe("ky.json structure", () => {
	it("has no problems against the installed schema", () => {
		expect(themeProblems(loadShipped())).toEqual([]);
	});

	it("is named ky and dark", () => {
		const theme = loadShipped();
		expect(theme.name).toBe("ky");
		expect(theme.appearance).toBe("dark");
	});

	it.each<[string, (t: { theme: Json; colors: Json; vars: Json }) => void]>([
		["required token deleted", (t) => delete t.colors.mdHeading],
		["unknown colours key", (t) => (t.colors.bogus = "#000000")],
		["unknown top-level key", (t) => (t.theme.bogus = 1)],
		["reserved name", (t) => (t.theme.name = "system")],
		["name with slash", (t) => (t.theme.name = "a/b")],
		["bad hex", (t) => (t.colors.text = "#12")],
		["integer out of range", (t) => (t.colors.text = 256)],
		["missing var reference", (t) => (t.colors.text = "noSuchVar")],
		[
			"vars cycle",
			(t) => {
				t.vars.a = "b";
				t.vars.b = "a";
				t.colors.text = "a";
			},
		],
	])("rejects: %s", (_label, mutate) => {
		const t = clone();
		mutate(t);
		expect(themeProblems(t.theme).length).toBeGreaterThan(0);
	});
});

describe("project settings", () => {
	const settings = JSON.parse(readFileSync(join(ROOT, ".pi/settings.json"), "utf8")) as Json;

	it("selects the theme by name", () => {
		expect(settings.theme).toBe(loadShipped().name);
	});

	it("leaves packages and extensions unchanged", () => {
		expect(settings.packages).toEqual([
			"npm:@narumitw/pi-lsp@0.49.9",
			"npm:pi-session-finder@0.5.6",
			"npm:pi-subagents@0.76.1",
			"npm:pi-web-access@0.38.0",
		]);
		expect(settings.extensions).toEqual([
			"-builtin:mcp",
			"-builtin:llama.cpp",
			"-builtin:codemode",
			"-builtin:tool-search",
		]);
	});
});

async function loadThemes(themesDir: string) {
	const loader = new DefaultResourceLoader({
		cwd: tempDir(),
		agentDir: tempDir(),
		additionalThemePaths: [themesDir],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: true,
	});
	await loader.reload();
	return loader.getThemes();
}

describe("Pi resource loader", () => {
	it("loads ky with no diagnostics about it", async () => {
		const { themes, diagnostics } = await loadThemes(THEMES_DIR);
		expect(themes.some((t) => t.name === "ky")).toBe(true);
		expect(JSON.stringify(diagnostics)).not.toContain("ky.json");
	});

	it("rejects a copy with an unresolvable colour", async () => {
		const dir = tempDir();
		const themes = join(dir, "themes");
		mkdirSync(themes);
		const t = clone();
		t.colors.text = "noSuchVar";
		writeFileSync(join(themes, "ky.json"), JSON.stringify(t.theme));
		const loaded = await loadThemes(themes);
		const absent = !loaded.themes.some((x) => x.name === "ky");
		const reported = JSON.stringify(loaded.diagnostics).includes("ky.json");
		expect(absent || reported).toBe(true);
	});
});
