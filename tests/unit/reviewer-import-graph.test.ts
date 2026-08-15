/**
 * WR-05 — `buildImportGraph`'s declared-graph regex, proved directly.
 *
 * `tests/integration/reviewer-contract.test.ts` and `reviewer-calibration.
 * test.ts` both exercise `buildImportGraph` only indirectly, through
 * fixtures that happen to use plain `import ... from` statements -- neither
 * ever fed it a re-export. This file is the one place that proves the
 * `export ... from` half directly, with the exact re-export shape the code
 * review cited (`.pi/extensions/loop-police/index.ts`'s own
 * `export { loopPolice as default } from "./loop-police.ts";`).
 */
import { describe, expect, it } from "vitest";

import { buildImportGraph } from "../../.pi/extensions/quality/reviewer.ts";

describe("buildImportGraph -- import ... from, proved first (paired positive)", () => {
	it("an ordinary import is recorded", () => {
		const graph = buildImportGraph([{ path: "src/a.ts", text: 'import { b } from "./b.ts";\n' }]);
		expect(graph).toEqual([{ from: "src/a.ts", to: ["./b.ts"] }]);
	});

	it("a multi-line destructured import is recorded (the reason the regex is not line-anchored)", () => {
		const text = ['import {', "\ta,", "\tb,", '} from "./ab.ts";', ""].join("\n");
		const graph = buildImportGraph([{ path: "src/a.ts", text }]);
		expect(graph).toEqual([{ from: "src/a.ts", to: ["./ab.ts"] }]);
	});
});

describe("WR-05 -- export ... from (re-exports) are recorded, not silently dropped", () => {
	it("a named re-export is recorded -- the exact shape the review cited (loop-police/index.ts)", () => {
		const text = 'export { loopPolice as default } from "./loop-police.ts";\n';
		const graph = buildImportGraph([{ path: ".pi/extensions/loop-police/index.ts", text }]);
		expect(graph).toEqual([{ from: ".pi/extensions/loop-police/index.ts", to: ["./loop-police.ts"] }]);
	});

	it("a barrel re-export (export * from) is recorded", () => {
		const text = 'export * from "./everything.ts";\n';
		const graph = buildImportGraph([{ path: "src/barrel.ts", text }]);
		expect(graph).toEqual([{ from: "src/barrel.ts", to: ["./everything.ts"] }]);
	});

	it("a file mixing an ordinary import AND a re-export records BOTH specifiers, in file order", () => {
		const text = ['import { helper } from "./helper.ts";', 'export { thing } from "./thing.ts";', ""].join("\n");
		const graph = buildImportGraph([{ path: "src/mixed.ts", text }]);
		expect(graph).toEqual([{ from: "src/mixed.ts", to: ["./helper.ts", "./thing.ts"] }]);
	});

	it(
		"REGRESSION PROOF: a file that ONLY re-exports (no import statement at all) used to produce an EMPTY " +
			"`to` array -- a false positive statement that the file depends on nothing",
		() => {
			const text = 'export { x } from "./x.ts";\n';
			const graph = buildImportGraph([{ path: "src/reexport-only.ts", text }]);
			expect(
				graph[0]?.to,
				"an import-graph entry with an empty `to` for a file that DOES re-export something is exactly " +
					"the pre-WR-05 bug: it reads as 'declares no dependencies', which is false",
			).not.toEqual([]);
			expect(graph[0]?.to).toEqual(["./x.ts"]);
		},
	);
});

describe("buildImportGraph -- still out of scope, deliberately (unchanged by WR-05)", () => {
	it("a bare side-effect import (no `from` clause) is NOT recorded", () => {
		const text = 'import "./side-effect.ts";\n';
		const graph = buildImportGraph([{ path: "src/a.ts", text }]);
		expect(graph).toEqual([{ from: "src/a.ts", to: [] }]);
	});

	it("a dynamic import() call is NOT recorded", () => {
		const text = 'const mod = await import("./dynamic.ts");\n';
		const graph = buildImportGraph([{ path: "src/a.ts", text }]);
		expect(graph).toEqual([{ from: "src/a.ts", to: [] }]);
	});
});
