import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	AUTHORED_SCRIPT_ROOTS,
	VENDORED_EXEMPT,
	authoredFiles,
	authoredScriptFiles,
	extractAnyComments,
	extractHashComments,
	emitWithoutComments,
	extractComments,
	findIdTokens,
	findRepoLineCitations,
	findUnversionedCitations,
	isExempt,
	lineMetrics,
	subsystemOf,
} from "../helpers/comment-scan.ts";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

// Must stay empty: do not add entries back.
const PENDING_CLEANUP: readonly string[] = [];

const isPending = (path: string): boolean => PENDING_CLEANUP.some((prefix) => path.startsWith(prefix));

interface Hit {
	line: number;
	token: string;
}

function idHits(source: string): Hit[] {
	const text = source.replace(/\r\n/g, "\n");
	const hits: Hit[] = [];
	for (const c of extractComments(text)) {
		for (const token of findIdTokens(c.text)) {
			const offset = c.pos + c.text.indexOf(token);
			hits.push({ line: text.slice(0, offset).split("\n").length, token });
		}
	}
	return hits;
}

const read = (path: string): string => readFileSync(join(repoRoot(), path), "utf-8");

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
		for (const id of [
			"WR-15",
			"T-04-01",
			"RB-01-03",
			"D-02",
			"WR2-04",
			"Phase 7",
			"plan 08-11",
			"iteration 3",
			"08-RESEARCH",
			"07-07-SUMMARY",
			"D-D",
			"ADR-0001",
			"wr-01",
			"cr2-03",
			"#6998",
			"08.2-13",
		]) {
			expect(findIdTokens(`// see ${id} here`), id).toContain(id);
		}
		for (const ok of ["UTF-8", "SHA-256", "50-56", "CVE-2021", "2026-08-13", "pi 1.1.0", "0.84.1-beta", "&#8212;", "a-b"]) {
			expect(findIdTokens(`// uses ${ok} here`), ok).toEqual([]);
		}
	});

	it("emit ignores comment edits but sees string edits", () => {
		const a = 'const s = "a//b"; // one\n';
		expect(emitWithoutComments(a)).toBe(emitWithoutComments('const s = "a//b"; // two, longer\n'));
		expect(emitWithoutComments(a)).not.toBe(emitWithoutComments('const s = "a//c"; // one\n'));
	});
});

describe("script comment scanner", () => {
	it("catches an ID in a hash comment but not a plain explanation", () => {
		const sh = ["#!/bin/sh", "# fixes WR-03", "echo hi # Windows needs LF here", 'url="https://x/#a" # per D-02'].join("\n");
		const hits = extractHashComments(sh).flatMap((c) => findIdTokens(c.text));
		expect(hits).toEqual(["WR-03", "D-02"]);
	});

	it("skips the shebang, quoted hashes and URL fragments", () => {
		const src = ["#!/bin/sh", 'echo "# not a comment"', "echo 'a # b'", "curl https://x/#frag", "key=a#b"].join("\n");
		expect(extractHashComments(src)).toEqual([]);
	});

	it("dispatches .mjs to the JS scanner and .yml to the hash scanner", () => {
		expect(extractAnyComments("a.mjs", "// per D-02\nconst a = '#x';").map((c) => c.text)).toEqual(["// per D-02"]);
		expect(extractAnyComments("a.yml", "a: 1 # per D-02").map((c) => c.text)).toEqual(["# per D-02"]);
	});

	it("covers every script type and is not vacuous", () => {
		const files = authoredScriptFiles();
		for (const ext of [".sh", ".mjs", ".yml", ".npmrc"]) {
			expect(files.some((f) => f.endsWith(ext)), ext).toBe(true);
		}
		expect(files).toContain("vitest.config.ts");
		expect(AUTHORED_SCRIPT_ROOTS.length).toBeGreaterThan(5);
	});

	it("has no plan/requirement/review IDs in script or config comments", () => {
		const offenders: string[] = [];
		for (const f of authoredScriptFiles()) {
			const text = read(f).replace(/\r\n/g, "\n");
			for (const c of extractAnyComments(f, text)) {
				for (const token of findIdTokens(c.text)) {
					offenders.push(`${f}:${text.slice(0, c.pos).split("\n").length} ${token}`);
				}
			}
		}
		expect(offenders, `Delete history and IDs from these comments:\n${offenders.join("\n")}`).toEqual([]);
	});

	it("has no line-number citations in script or config comments", () => {
		const repoFiles = trackedFiles().filter((p) => /\.(?:ts|md|json)$/.test(p) && !isExempt(p));
		const offenders: string[] = [];
		for (const f of authoredScriptFiles()) {
			const text = read(f).replace(/\r\n/g, "\n");
			for (const c of extractAnyComments(f, text)) {
				const line = text.slice(0, c.pos).split("\n").length;
				for (const hit of [...findRepoLineCitations(c.text, repoFiles), ...findUnversionedCitations(c.text, repoFiles)]) {
					offenders.push(`${f}:${line} ${hit}`);
				}
			}
		}
		expect(offenders, `Cite a symbol, or put the version before the citation:\n${offenders.join("\n")}`).toEqual([]);
	});
});

describe("comment discipline", () => {
	const files = authoredFiles();
	const sources = new Map(files.map((f) => [f, read(f)] as const));

	it("is not vacuous", () => {
		expect(files.length).toBeGreaterThanOrEqual(40);
		const total = [...sources.values()].reduce((n, src) => n + extractComments(src).length, 0);
		expect(total).toBeGreaterThanOrEqual(1);
		const tracked = trackedFiles(".pi/extensions");
		for (const prefix of VENDORED_EXEMPT) {
			expect(tracked.some((p) => p.startsWith(prefix)), prefix).toBe(true);
		}
	});

	it("PENDING_CLEANUP is empty: every authored file is under the ID gate", () => {
		expect(PENDING_CLEANUP).toEqual([]);
	});

	it("keeps PENDING_CLEANUP free of stale entries", () => {
		const stale: string[] = [];
		for (const entry of PENDING_CLEANUP) {
			const members = files.filter((f) => f.startsWith(entry));
			expect(members.length, `${entry} matches no authored file`).toBeGreaterThanOrEqual(1);
			const ids = members.reduce((n, f) => n + idHits(sources.get(f) ?? "").length, 0);
			if (ids === 0) stale.push(entry);
		}
		expect(stale, `no IDs left; remove from PENDING_CLEANUP: ${stale.join(", ")}`).toEqual([]);
	});

	it("flags an ID in a comment through the gate code path", () => {
		const hits = idHits("const a = 1;\n// see WR-15\n");
		expect(hits).toEqual([{ line: 2, token: "WR-15" }]);
	});

	it("has no plan/requirement/review IDs in comments outside PENDING_CLEANUP", () => {
		const offenders: string[] = [];
		for (const f of files) {
			if (isPending(f)) continue;
			for (const h of idHits(sources.get(f) ?? "")) offenders.push(`${f}:${h.line} ${h.token}`);
		}
		expect(
			offenders,
			`Delete history and IDs from these comments (strings are out of scope):\n${offenders.join("\n")}`,
		).toEqual([]);
	});

	it("flags an in-repo file:line citation but not an external one", () => {
		const repo = [".pi/extensions/safety/git.ts", "tests/unit/a.test.ts"];
		expect(findRepoLineCitations("// see safety/git.ts:171", repo)).toEqual(["safety/git.ts:171"]);
		expect(findRepoLineCitations("// see .pi/extensions/safety/git.ts:1-2", repo)).toEqual([".pi/extensions/safety/git.ts:1"]);
		expect(findRepoLineCitations("// see safety/git.ts#currentSha", repo)).toEqual([]);
		expect(findRepoLineCitations("// pi-ai src/types.ts:179", repo)).toEqual([]);
		expect(findRepoLineCitations("// see docs/SAFETY.md:12", ["docs/SAFETY.md"])).toEqual(["docs/SAFETY.md:12"]);
	});

	it("cites in-repo code by symbol, never by line number", () => {
		const repoFiles = trackedFiles().filter((p) => /\.(?:ts|md|json)$/.test(p) && !isExempt(p));
		const offenders: string[] = [];
		for (const f of files) {
			for (const c of extractComments(sources.get(f) ?? "")) {
				for (const hit of findRepoLineCitations(c.text, repoFiles)) offenders.push(`${f}: ${hit}`);
			}
		}
		expect(offenders, `Replace with a path.ts#symbol reference:\n${offenders.join("\n")}`).toEqual([]);
	});

	it("flags an unversioned external file:line citation", () => {
		expect(findUnversionedCitations("// see runner.js:410", [])).toEqual(["runner.js:410"]);
		expect(findUnversionedCitations("// see pi 1.1.0 runner.js:410", [])).toEqual([]);
		expect(findUnversionedCitations("// see pkg@2.6.9 src/x.ts:3", [])).toEqual([]);
		expect(findUnversionedCitations("// see runner.js#emitMessageEnd", [])).toEqual([]);
		expect(findUnversionedCitations("// see docs/extensions.md:676", [])).toEqual(["docs/extensions.md:676"]);
		expect(findUnversionedCitations("// 127.0.0.1 runner.js:410", [])).toEqual(["runner.js:410"]);
		expect(
			findUnversionedCitations(`// pi 1.1.0 runner.js:410 is the anchor; far beyond it, ${"x".repeat(60)} skills.js:155`, []),
		).toEqual(["skills.js:155"]);
	});

	it("treats a bare tracked basename as an in-repo citation", () => {
		const repo = [".pi/extensions/diagnostics/budget.ts"];
		expect(findRepoLineCitations("// pi 1.1.0 runner.js:410; see budget.ts:225", repo)).toEqual(["budget.ts:225"]);
		expect(findUnversionedCitations("// see budget.ts:225", repo)).toEqual([]);
		expect(findRepoLineCitations("// see @scope/pkg/budget.ts:3", repo)).toEqual([]);
	});

	it("anchors every external file:line citation to a version", () => {
		const repoFiles = trackedFiles().filter((p) => /\.(?:ts|md|json)$/.test(p) && !isExempt(p));
		const offenders: string[] = [];
		for (const f of files) {
			for (const c of extractComments(sources.get(f) ?? "")) {
				for (const hit of findUnversionedCitations(c.text, repoFiles)) offenders.push(`${f}: ${hit}`);
			}
		}
		expect(offenders, `Add the version read (pi 1.1.0 file.js:N) or drop the line number:\n${offenders.join("\n")}`).toEqual([]);
	});

	it("reports comment ratio", () => {
		interface Row {
			comment: number;
			code: number;
			ids: number;
		}
		const add = (a: Row, b: Row): Row => ({ comment: a.comment + b.comment, code: a.code + b.code, ids: a.ids + b.ids });
		const fmt = (r: Row): string =>
			`comment=${r.comment} code=${r.code} ratio=${((100 * r.comment) / Math.max(1, r.comment + r.code)).toFixed(1)}% ids=${r.ids}`;
		const zero: Row = { comment: 0, code: 0, ids: 0 };
		const measure = (src: string): Row => ({ ...lineMetrics(src), ids: idHits(src).length });
		const rows = files.map((f) => [f, measure(sources.get(f) ?? "")] as const);
		const ratio = (r: Row): number => r.comment / Math.max(1, r.comment + r.code);
		for (const [f, r] of [...rows].sort((a, b) => ratio(b[1]) - ratio(a[1]))) {
			console.info(`COMMENT_RATIO file=${f} ${fmt(r)}`);
		}
		const bySub = new Map<string, Row>();
		for (const [f, r] of rows) bySub.set(subsystemOf(f), add(bySub.get(subsystemOf(f)) ?? zero, r));
		for (const [name, r] of [...bySub].sort()) console.info(`COMMENT_RATIO subsystem=${name} ${fmt(r)}`);
		console.info(`COMMENT_RATIO total=authored ${fmt(rows.reduce((a, [, r]) => add(a, r), zero))}`);
		const nonBg = trackedFiles(".pi/extensions").filter(
			(p) => p.endsWith(".ts") && !p.startsWith(".pi/extensions/background-tasks/"),
		);
		console.info(`COMMENT_RATIO total=non-background ${fmt(nonBg.reduce((a, f) => add(a, measure(read(f))), zero))}`);
		expect(rows.length).toBeGreaterThanOrEqual(40);
	});
});
