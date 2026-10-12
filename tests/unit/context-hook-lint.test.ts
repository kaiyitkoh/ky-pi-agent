import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

const EXT_DIR = ".pi/extensions";

// context_with_system hands a handler the whole transcript; the tool-state fields are how any
// handler declares tools. Raw source, comments included, so a rename or a prose mention is caught.
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
	{ pattern: /\bcontext_with_system\b/, why: "the handler owns prompt and tool declarations" },
	{ pattern: /\btoolsRemoved\b/, why: "a system-shaped message returned from any context handler can remove tools" },
	{ pattern: /\btoolsAdded\b/, why: "a system-shaped message returned from any context handler can add tools" },
];

function sources(): { path: string; text: string }[] {
	return trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
}

describe("context hooks cannot own prompt or tool declarations", () => {
	const scanned = sources();

	it("scans a non-empty set (guards against a vacuous pass)", () => {
		expect(scanned.length).toBeGreaterThanOrEqual(1);
	});

	it("no tracked extension source uses context_with_system or tool-state fields", () => {
		const offenders: string[] = [];
		for (const { path, text } of scanned) {
			for (const { pattern, why } of FORBIDDEN) {
				if (pattern.test(text)) offenders.push(`${path}: ${String(pattern)} (${why})`);
			}
		}
		expect(
			offenders,
			"a handler that owns prompt and tool declarations defeats profile narrowing and prompt-cache stability; no exemptions, vendored code included",
		).toEqual([]);
	});

	it("every pattern fires on an inline offending fixture", () => {
		const fixture = 'pi.on("context_with_system", () => ({ messages: [{ toolsRemoved: [], toolsAdded: [] }] }));';
		const dead = FORBIDDEN.filter(({ pattern }) => !pattern.test(fixture)).map(({ pattern }) => String(pattern));
		expect(dead).toEqual([]);
	});

	it("does not fire on the plain context event", () => {
		const fixture = 'pi.on("context", (event) => ({ messages: event.messages }));';
		expect(FORBIDDEN.some(({ pattern }) => pattern.test(fixture))).toBe(false);
	});
});
