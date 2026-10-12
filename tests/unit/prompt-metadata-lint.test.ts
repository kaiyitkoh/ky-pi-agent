import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

const EXT_DIR = ".pi/extensions";

// Prompt metadata is re-serialised into the system prompt; any per-run value in it re-prices the cached prefix.
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
	{ pattern: /\$\{/, why: "template interpolation" },
	{ pattern: /\bDate\b/, why: "clock source" },
	{ pattern: /\bprocess\s*\.\s*cwd\b/, why: "cwd source" },
	{ pattern: /\bprocess\s*\.\s*env\b/, why: "environment source" },
	{ pattern: /\b(?:execSync|spawnSync|execFile|exec)\s*\(/, why: "command execution" },
	{ pattern: /\bgit\s+(?:status|branch|rev-parse|log|diff|config)\b/, why: "git state as a command source" },
];

const PROPERTY_START = /^[ \t]*(promptSnippet|promptGuidelines)[ \t]*:/gm;
const MAX_VALUE_CHARS = 8000;

/** Value text of a property starting at `from`: up to the first top-level comma or closing bracket. Quote-aware, bounded. */
function extractValue(text: string, from: number): string {
	let depth = 0;
	let quote: string | undefined;
	const limit = Math.min(text.length, from + MAX_VALUE_CHARS);
	for (let i = from; i < limit; i++) {
		const ch = text[i]!;
		if (quote !== undefined) {
			if (ch === "\\") i++;
			else if (ch === quote) quote = undefined;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === "`") quote = ch;
		else if (ch === "[" || ch === "(" || ch === "{") depth++;
		else if (ch === "]" || ch === ")" || ch === "}") {
			if (depth === 0) return text.slice(from, i);
			depth--;
		} else if (ch === "," && depth === 0) return text.slice(from, i);
	}
	return text.slice(from, limit);
}

export function metadataValues(text: string): { name: string; value: string }[] {
	const found: { name: string; value: string }[] = [];
	for (const match of text.matchAll(PROPERTY_START)) {
		found.push({ name: match[1]!, value: extractValue(text, match.index + match[0].length) });
	}
	return found;
}

function violations(text: string): string[] {
	const out: string[] = [];
	for (const { name, value } of metadataValues(text)) {
		for (const { pattern, why } of FORBIDDEN) {
			if (pattern.test(value)) out.push(`${name}: ${String(pattern)} (${why})`);
		}
	}
	return out;
}

describe("prompt metadata is static", () => {
	const sources = trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));

	it("finds at least one promptSnippet and promptGuidelines (guards against a vacuous pass)", () => {
		const all = sources.flatMap((s) => metadataValues(s.text));
		expect(all.some((v) => v.name === "promptSnippet")).toBe(true);
		expect(all.some((v) => v.name === "promptGuidelines")).toBe(true);
	});

	it("no tracked extension builds prompt metadata from interpolation, clock, cwd, env, exec or git", () => {
		const offenders = sources.flatMap((s) => violations(s.text).map((v) => `${s.path}: ${v}`));
		expect(
			offenders,
			"promptSnippet and promptGuidelines are part of the cached system prompt prefix; keep them static strings",
		).toEqual([]);
	});

	it("every forbidden pattern fires on an inline offending fixture", () => {
		const fixtures: Record<string, string> = {
			"\$\{": "  promptSnippet: `branch ${name}`,\n",
			Date: "  promptGuidelines: [String(Date.now())],\n",
			cwd: "  promptSnippet: process.cwd(),\n",
			env: "  promptSnippet: process.env.HOME,\n",
			exec: "  promptGuidelines: [execSync('ls')],\n",
			git: "  promptSnippet: 'now run git status first',\n",
		};
		const fired = Object.values(fixtures).map((f) => violations(f).length > 0);
		expect(fired.every(Boolean)).toBe(true);
		for (const { pattern } of FORBIDDEN) {
			expect(
				Object.values(fixtures).some((f) => metadataValues(f).some((v) => pattern.test(v.value))),
				String(pattern),
			).toBe(true);
		}
	});

	it("passes a static fixture and ignores prose mentions", () => {
		const fixture = [
			"  promptSnippet: 'Stop a task by ID',",
			"  promptGuidelines: [",
			"    'Use bg_kill when asked; the task id is enough.',",
			"  ],",
			" * promptGuidelines: ${Date.now()} in a comment is not a property",
		].join("\n");
		expect(metadataValues(fixture).map((v) => v.name)).toEqual(["promptSnippet", "promptGuidelines"]);
		expect(violations(fixture)).toEqual([]);
	});
});
