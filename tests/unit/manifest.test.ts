/**
 * Manifest shape assertions.
 *
 * Scope: the SHAPE of package.json — the parts Pi's package loader and the
 * project's binding constraints depend on. Exact version-pin auditing and the
 * settings.json package-spec lint are Plan 04's job, not this file's.
 *
 * Sources for each assertion:
 *   - keywords ["pi-package"]                docs/packages.md:118
 *   - pi.extensions as a LITERAL path        package-manager.ts:2290-2305
 *     (globSync runs with dot:false, so glob forms are fragile around the
 *     dot-prefixed ".pi" segment — a literal path skips globbing entirely)
 *   - the five peers at range "*"            docs/packages.md:171
 *   - no build step                          docs/extensions.md:7,179 (jiti
 *     loads .ts directly; a build breaks /reload)
 */
import { describe, expect, it } from "vitest";

import manifest from "../../package.json" with { type: "json" };

const PEER_NAMES = [
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-tui",
	"typebox",
] as const;

describe("package.json manifest shape", () => {
	it("is an ESM package", () => {
		expect(manifest.type).toBe("module");
	});

	it("declares the pi-package keyword so the gallery and tooling can find it", () => {
		expect(manifest.keywords).toContain("pi-package");
	});

	it("pins the Node engine to Pi 0.84.1's hard requirement", () => {
		expect(manifest.engines.node).toBe(">=22.19.0");
	});

	it("points pi.extensions at a literal path, not a glob", () => {
		expect(manifest.pi.extensions).toEqual(["./.pi/extensions"]);
		for (const entry of manifest.pi.extensions) {
			expect(entry).not.toMatch(/[*?[\]{}]/);
		}
	});

	it("declares the other three pi resource directories", () => {
		expect(manifest.pi.skills).toEqual(["./.pi/skills"]);
		expect(manifest.pi.prompts).toEqual(["./.pi/prompts"]);
		expect(manifest.pi.themes).toEqual(["./.pi/themes"]);
	});

	it("declares the agent definitions for pi-subagents so they travel with the package", () => {
		expect(manifest.pi.subagents).toEqual({ agents: ["./.pi/agents"] });
	});

	it("declares exactly the five host-provided peers at range *", () => {
		const peers = manifest.peerDependencies as Record<string, string>;
		expect(Object.keys(peers).sort()).toEqual([...PEER_NAMES].sort());
		for (const name of PEER_NAMES) {
			// "*" is mandated by docs/packages.md:171 and is NOT a pin regression:
			// peers are host-provided and jiti-aliased to Pi's bundled copies
			// (loader.ts:118-140). The exact pin lives in devDependencies.
			expect(peers[name]).toBe("*");
		}
	});

	it("has no build script — a build step breaks /reload", () => {
		const scripts = manifest.scripts as Record<string, string>;
		expect(scripts.build).toBeUndefined();
		expect(scripts.typecheck).toBe("tsc --noEmit");
	});
});
