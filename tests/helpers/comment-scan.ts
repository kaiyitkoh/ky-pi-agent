import ts from "typescript";
import { trackedFiles } from "./git.ts";

export interface CommentRange {
	pos: number;
	end: number;
	text: string;
}

/** Comments are trivia on leaf tokens, so string, template and regex contents are never mistaken for comments. */
export function extractComments(text: string): CommentRange[] {
	const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
	const seen = new Map<number, ts.CommentRange>();
	const add = (ranges?: ts.CommentRange[]): void => {
		for (const range of ranges ?? []) seen.set(range.pos, range);
	};
	const walk = (node: ts.Node): void => {
		const kids = node.getChildren(sf);
		if (kids.length === 0) {
			add(ts.getLeadingCommentRanges(text, node.getFullStart()));
			add(ts.getTrailingCommentRanges(text, node.getEnd()));
		} else {
			for (const kid of kids) walk(kid);
		}
	};
	walk(sf);
	return [...seen.values()]
		.sort((a, b) => a.pos - b.pos)
		.map((c) => ({ pos: c.pos, end: c.end, text: text.slice(c.pos, c.end) }));
}

/** A line with a trailing comment counts as code; blank lines are excluded. */
export function lineMetrics(raw: string): { comment: number; code: number } {
	const text = raw.replace(/\r\n/g, "\n");
	const mask = new Uint8Array(text.length);
	for (const c of extractComments(text)) mask.fill(1, c.pos, c.end);
	let comment = 0;
	let code = 0;
	let offset = 0;
	for (const line of text.split("\n")) {
		let hasContent = false;
		let allMasked = true;
		for (let i = 0; i < line.length; i++) {
			if (/\s/.test(line[i])) continue;
			hasContent = true;
			if (mask[offset + i] === 0) {
				allMasked = false;
				break;
			}
		}
		if (hasContent) {
			if (allMasked) comment++;
			else code++;
		}
		offset += line.length + 1;
	}
	return { comment, code };
}

export const ID_PATTERN = new RegExp(
	String.raw`\b(?:` +
		String.raw`[A-Z][A-Z0-9]{0,5}-\d{1,3}(?:\.\d+)?(?:-\d{1,3})?` +
		String.raw`|(?:[Pp]hase|[Pp]lan|[Ii]teration)\s+\d+(?:\.\d+)?(?:-\d+)?` +
		String.raw`|\d{2}(?:\.\d)?-(?:\d{2}-)?(?:RESEARCH|REVIEW|CONTEXT|PLAN|SUMMARY|VERIFICATION|UAT)` +
		String.raw`)\b`,
	"g",
);

/** Extend only with evidence of a real false positive. */
export const NON_ID_TOKENS = /^(?:UTF-8|UTF-16|SHA-1|SHA-256|SHA-512|AES-256|ISO-8601|HTTP-2|GPT-\d|TLS-1)$/;

export function findIdTokens(commentText: string): string[] {
	ID_PATTERN.lastIndex = 0;
	const hits: string[] = [];
	for (const m of commentText.matchAll(ID_PATTERN)) {
		if (!NON_ID_TOKENS.test(m[0])) hits.push(m[0]);
	}
	return hits;
}

// Vendored or copied upstream code is exempt. The checkpoint subsystem is deliberately absent:
// it is re-authored, not copied (see .pi/extensions/checkpoint/PROVENANCE.md).
export const VENDORED_EXEMPT: readonly string[] = [
	".pi/extensions/background-tasks/",
	".pi/extensions/loop-police/",
	".pi/extensions/plan-mode/",
	".pi/extensions/todo.ts",
	".pi/extensions/questionnaire.ts",
];

export function isExempt(path: string): boolean {
	return VENDORED_EXEMPT.some((prefix) => path.startsWith(prefix));
}

const LINE_CITATION = /((?:[\w.-]+\/)+[\w.-]+\.ts):\d+/g;

/** In-repo `path.ts:N` citations go stale on any edit; cite a symbol (`path.ts#name`) instead. */
export function findRepoLineCitations(commentText: string, repoFiles: readonly string[]): string[] {
	const hits: string[] = [];
	for (const m of commentText.matchAll(LINE_CITATION)) {
		const cited = m[1].replace(/^\.\//, "");
		if (repoFiles.some((f) => f === cited || f.endsWith(`/${cited}`))) hits.push(m[0]);
	}
	return hits;
}

export function authoredFiles(): string[] {
	return trackedFiles(".pi/extensions")
		.filter((p) => p.endsWith(".ts") && !isExempt(p))
		.sort();
}

export function subsystemOf(path: string): string {
	return path.slice(".pi/extensions/".length).split("/")[0];
}

export function emitWithoutComments(text: string): string {
	return ts.transpileModule(text, {
		fileName: "x.ts",
		compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true },
	}).outputText;
}
