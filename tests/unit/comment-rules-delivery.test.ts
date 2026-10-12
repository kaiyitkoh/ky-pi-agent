import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
	COMMENT_RULES_HEADING,
	COMMENT_RULES_SECTION,
	COMMENT_RULES_TEXT,
	hasCommentRulesHeading,
} from "../../.pi/extensions/harness/comment-rules.ts";
import { transcriptView } from "../helpers/faux.ts";
import { repoRoot } from "../helpers/git.ts";
import { withFauxSession } from "../helpers/session.ts";

const HARNESS = resolve(repoRoot(), ".pi/extensions/harness/index.ts");

function readRepo(rel: string): string {
	return readFileSync(join(repoRoot(), rel), "utf8").replace(/\r\n/g, "\n");
}

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

async function capturePrompt(opts: {
	extensionPath?: string;
	extensionSource?: string;
	cwdFiles?: Record<string, string>;
}): Promise<{ prompt: string; calls: number }> {
	let prompt = "";
	return withFauxSession(
		{
			...opts,
			responses: [
				(context) => {
					prompt = transcriptView(context).systemPrompt;
					return fauxAssistantMessage("ok");
				},
			],
		},
		async (h) => {
			await h.session.prompt("hi");
			return { prompt, calls: h.faux.state.callCount };
		},
	);
}

describe("comment rules constant", () => {
	it("is short, starts with the heading and has a valid section name", () => {
		expect(COMMENT_RULES_TEXT.startsWith(COMMENT_RULES_HEADING)).toBe(true);
		expect(COMMENT_RULES_TEXT.split("\n").length).toBeLessThanOrEqual(15);
		expect(COMMENT_RULES_TEXT).not.toContain("Vendored");
		expect(COMMENT_RULES_SECTION).toMatch(/^[a-z][a-z0-9_-]*$/);
	});
});

describe("comment rules heading match", () => {
	it("matches a level-2 heading line regardless of case, spacing or CRLF", () => {
		for (const text of ["## Code comments", "x\n## Code Comments\ny", "##  code comments  ", "a\r\n## Code comments\r\nb"]) {
			expect(hasCommentRulesHeading(text), JSON.stringify(text)).toBe(true);
		}
	});

	it("ignores other levels, inline mentions and fenced samples", () => {
		for (const text of [
			"### Code comments",
			"See the ## Code comments section",
			"## Code comments and more",
			"```md\n## Code comments\n```\n",
			"~~~\n## Code comments\n~~~",
		]) {
			expect(hasCommentRulesHeading(text), JSON.stringify(text)).toBe(false);
		}
	});
});

describe("harness delivers the comment rules", () => {
	it("injects once as <code_comments> in a project without the heading", async () => {
		const { prompt, calls } = await capturePrompt({ extensionPath: HARNESS });
		expect(calls).toBe(1);
		expect(prompt).toContain("<code_comments>");
		expect(occurrences(prompt, COMMENT_RULES_HEADING)).toBe(1);
	});

	it("injects nothing when a context file already carries the heading", async () => {
		const { prompt } = await capturePrompt({
			extensionPath: HARNESS,
			cwdFiles: { "AGENTS.md": `${COMMENT_RULES_TEXT}\n` },
		});
		expect(occurrences(prompt, COMMENT_RULES_HEADING)).toBe(1);
		expect(prompt).not.toContain("<code_comments>");
	});

	it("still injects when a context file only has a level-3 or fenced heading", async () => {
		const { prompt } = await capturePrompt({
			extensionPath: HARNESS,
			cwdFiles: { "AGENTS.md": "### Code comments\n- local note\n\n```md\n## Code comments\n```\n" },
		});
		expect(prompt).toContain("<code_comments>");
	});

	it("is absent without the harness (non-vacuity)", async () => {
		const { prompt } = await capturePrompt({
			extensionSource: "export default function () {}\n",
		});
		expect(occurrences(prompt, COMMENT_RULES_HEADING)).toBe(0);
	});

	it("never returns a forced system prompt", () => {
		expect(readRepo(".pi/extensions/harness/index.ts")).not.toContain("systemPrompt:");
	});
});

describe("AGENTS.md and CLAUDE.md", () => {
	it("AGENTS.md carries the rules verbatim plus the vendored exemption, in <=15 lines", () => {
		const agents = readRepo("AGENTS.md");
		expect(agents, "AGENTS.md must contain COMMENT_RULES_TEXT verbatim").toContain(
			`${COMMENT_RULES_TEXT}\n- Vendored`,
		);
		const lines = agents.split("\n");
		const start = lines.indexOf(COMMENT_RULES_HEADING);
		let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
		if (end === -1) end = lines.length;
		const block = lines.slice(start, end).join("\n").trim().split("\n");
		expect(block.length).toBeLessThanOrEqual(15);
		expect(lines.length).toBeLessThanOrEqual(46);
	});

	it("CLAUDE.md first non-empty line is @AGENTS.md", () => {
		const first = readRepo("CLAUDE.md")
			.split("\n")
			.find((l) => l.trim() !== "");
		expect(first).toBe("@AGENTS.md");
	});

	it("Pi loads AGENTS.md, not CLAUDE.md, at the repo root", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "ky-agentdir-"));
		try {
			const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
			const root = norm(repoRoot());
			const files = loadProjectContextFiles({ cwd: repoRoot(), agentDir });
			const atRoot = files.filter((f) => norm(f.path).replace(/\/[^/]+$/, "") === root);
			expect(atRoot.map((f) => norm(f.path).split("/").pop())).toEqual(["agents.md"]);
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
