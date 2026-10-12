import { describe, expect, it } from "vitest";

import { emitWithoutComments, extractComments, findIdTokens, lineMetrics } from "../helpers/comment-scan.ts";

describe("comment scanner self-tests", () => {
	it("never treats string, regex or template contents as comments", () => {
		const src = [
			'const u = "http://x//y";',
			"const r = /\\/\\//;",
			"const t = `// not`;",
			"// real one",
			"/* block */",
			"/** doc */",
			"export {};",
		].join("\n");
		expect(extractComments(src)).toHaveLength(3);
	});

	it("classifies lines as comment-only or code", () => {
		const src = ["// a", "/*", " * b", " */", "", "const a = 1;", "const b = 2; // trailing", "", "const c = 3;"].join(
			"\n",
		);
		expect(lineMetrics(src)).toEqual({ comment: 4, code: 3 });
	});

	it("matches ID-shaped tokens and skips technical ones", () => {
		for (const id of ["WR-15", "T-04-01", "RB-01-03", "D-02", "WR2-04", "Phase 7", "plan 08-11", "iteration 3", "08-RESEARCH", "07-07-SUMMARY"]) {
			expect(findIdTokens(`// see ${id} here`), id).toContain(id);
		}
		for (const ok of ["UTF-8", "SHA-256", "50-56", "CVE-2021"]) {
			expect(findIdTokens(`// uses ${ok} here`), ok).toEqual([]);
		}
	});

	it("emit ignores comment edits but sees string edits", () => {
		const a = 'const s = "a//b"; // one\n';
		expect(emitWithoutComments(a)).toBe(emitWithoutComments('const s = "a//b"; // two, longer\n'));
		expect(emitWithoutComments(a)).not.toBe(emitWithoutComments('const s = "a//c"; // one\n'));
	});
});
