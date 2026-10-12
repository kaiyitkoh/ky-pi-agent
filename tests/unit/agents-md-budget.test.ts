import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	CONTEXT_FILES_CLOSE_MARKER,
	CONTEXT_FILES_OPEN_MARKER,
	estimateTokensFromChars,
	PROJECT_INSTRUCTIONS_WRAPPER_CHARS,
} from "../../.pi/extensions/diagnostics/budget.ts";
import { COMMENT_RULES_SECTION } from "../../.pi/extensions/harness/comment-rules.ts";
import { transcriptView } from "../helpers/faux.ts";
import { repoRoot } from "../helpers/git.ts";
import { createHarnessSession } from "../helpers/harness-session.ts";

interface Budget {
	tokens: number;
	why: string;
}

// Raise only as a visible edit that updates the measured value and date in `why`.
const AGENTS_MD_BUDGET: Budget = {
	tokens: 450,
	why: "measured 414 tokens (1653 chars) on 2026-10-13; 8.7% headroom",
};

const RENDERED_BLOCK_BUDGET: Budget = {
	tokens: 500,
	why:
		"measured 456 tokens (1824 chars = content + 60-char absolute path assumed + per-file wrapper + project_context markers) " +
		"on 2026-10-13; 9.6% headroom. The real path length varies by machine.",
};

const COMMENT_RULES_BUDGET: Budget = {
	tokens: 210,
	why: "measured 198 tokens (792 chars, <code_comments> section as rendered) on 2026-10-13; 6.1% headroom",
};

const ASSUMED_PATH_CHARS = 60;

function readRepo(rel: string): string {
	return readFileSync(join(repoRoot(), rel), "utf8").replace(/\r\n/g, "\n");
}

function checkBudget(
	label: string,
	content: string,
	budgetTokens: number,
	overheadChars = 0,
): { tokens: number; ok: boolean; message: string } {
	const tokens = estimateTokensFromChars(content.length + overheadChars);
	const ok = tokens <= budgetTokens;
	return {
		tokens,
		ok,
		message: ok
			? `${label}: ${tokens} of ${budgetTokens} tokens`
			: `${label} is ${tokens} tokens, over its budget of ${budgetTokens}. Shorten it, or raise the budget in agents-md-budget.test.ts with a visible edit and a why.`,
	};
}

describe("context file token budgets", () => {
	it("root AGENTS.md is within budget", () => {
		const r = checkBudget("AGENTS.md", readRepo("AGENTS.md"), AGENTS_MD_BUDGET.tokens);
		expect(r.ok, `${r.message} (${AGENTS_MD_BUDGET.why})`).toBe(true);
	});

	it("the rendered project-context block is within budget", () => {
		const overhead =
			ASSUMED_PATH_CHARS +
			PROJECT_INSTRUCTIONS_WRAPPER_CHARS +
			CONTEXT_FILES_OPEN_MARKER.length +
			CONTEXT_FILES_CLOSE_MARKER.length;
		const r = checkBudget("rendered project-context block", readRepo("AGENTS.md"), RENDERED_BLOCK_BUDGET.tokens, overhead);
		expect(r.ok, `${r.message} (${RENDERED_BLOCK_BUDGET.why})`).toBe(true);
	});

	it("the injected comment-rules section is within budget", async () => {
		const handle = await createHarnessSession({
			entryPoints: [".pi/extensions/harness/index.ts"],
			agentsMd: false,
			skills: false,
		});
		try {
			await handle.session.prompt("hi");
			expect(handle.captured.length).toBeGreaterThan(0);
			const prompt = transcriptView(handle.captured[0]!).systemPrompt;
			const open = `<${COMMENT_RULES_SECTION}>`;
			const close = `</${COMMENT_RULES_SECTION}>`;
			const start = prompt.indexOf(open);
			expect(start, "the code_comments section was not injected").toBeGreaterThanOrEqual(0);
			const end = prompt.indexOf(close, start);
			expect(end).toBeGreaterThan(start);
			const section = prompt.slice(start, end + close.length);
			const r = checkBudget("code_comments section", section, COMMENT_RULES_BUDGET.tokens);
			expect(r.ok, `${r.message} (${COMMENT_RULES_BUDGET.why})`).toBe(true);
		} finally {
			await handle.dispose();
		}
	});

	it("checker rejects an over-budget AGENTS.md fixture and names the file and both numbers", () => {
		const dir = mkdtempSync(join(tmpdir(), "ky-agents-budget-"));
		try {
			const real = readRepo("AGENTS.md");
			const file = join(dir, "AGENTS.md");
			writeFileSync(file, `${real}${"x".repeat(400)}`);
			const fixture = readFileSync(file, "utf8");
			const r = checkBudget("AGENTS.md", fixture, AGENTS_MD_BUDGET.tokens);
			expect(r.ok).toBe(false);
			expect(r.message).toContain("AGENTS.md");
			expect(r.message).toContain(String(r.tokens));
			expect(r.message).toContain(String(AGENTS_MD_BUDGET.tokens));
			expect(checkBudget("AGENTS.md", real, AGENTS_MD_BUDGET.tokens).ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
