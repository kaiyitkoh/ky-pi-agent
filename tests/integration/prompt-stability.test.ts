import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FauxResponseStep, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { transcriptView } from "../helpers/faux.ts";
import { createHarnessSession, type HarnessHandle } from "../helpers/harness-session.ts";

const TRACKED = "ky-volatile-tracked-file.txt";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function git(cwd: string, ...args: string[]): void {
	const r = spawnSync(
		"git",
		["-c", "user.name=t", "-c", "user.email=t@test.invalid", "-c", "commit.gpgsign=false", ...args],
		{ cwd, encoding: "utf-8", shell: false, windowsHide: true },
	);
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

/** Empty string when the three requests share one byte-equal prompt and tool list; otherwise the reason. */
function instabilityReason(contexts: readonly TranscriptContext[]): string {
	if (contexts.length < 2) return "fewer than two captured requests";
	const first = transcriptView(contexts[0]!);
	for (const [i, ctx] of contexts.entries()) {
		const view = transcriptView(ctx);
		const systemCount = ctx.messages.filter((m) => m.role === "system").length;
		if (systemCount !== 1) return `request ${i} carries ${systemCount} system messages`;
		if (view.systemPrompt !== first.systemPrompt) return `request ${i} system prompt differs from request 0`;
		const names = view.tools.map((t) => t.name).join(",");
		if (names !== first.tools.map((t) => t.name).join(",")) return `request ${i} tool names or order differ`;
	}
	return "";
}

const sessions: HarnessHandle[] = [];

afterEach(async () => {
	vi.useRealTimers();
	while (sessions.length > 0) await sessions.pop()!.dispose();
});

function capturing(into: TranscriptContext[]): FauxResponseStep[] {
	const step: FauxResponseStep = (context) => {
		into.push(context);
		return fauxAssistantMessage("ok");
	};
	return [step, step, step];
}

async function runThreeTurns(opts: { profile?: string; extraExtensionSource?: string }): Promise<{
	contexts: TranscriptContext[];
	handle: HarnessHandle;
	tokens: number[];
}> {
	const contexts: TranscriptContext[] = [];
	const handle = await createHarnessSession({ ...opts, responses: capturing(contexts) });
	sessions.push(handle);
	git(handle.cwd, "init", "-q");
	writeFileSync(join(handle.cwd, TRACKED), "one\n");
	git(handle.cwd, "add", "--", TRACKED);
	git(handle.cwd, "commit", "-q", "-m", "init");

	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T12:00:00Z") });
	const tokens: number[] = [];
	for (let turn = 1; turn <= 3; turn++) {
		if (turn > 1) {
			vi.setSystemTime(Date.now() + WEEK_MS);
			git(handle.cwd, "checkout", "-q", "-b", `ky-volatile-branch-${turn}`);
			appendFileSync(join(handle.cwd, TRACKED), `edit ${turn}\n`);
		}
		await handle.session.prompt(`turn ${turn}`);
		tokens.push(handle.session.getSessionStats().tokens.total);
	}
	return { contexts, handle, tokens };
}

describe("system prompt byte stability across turns", () => {
	for (const profile of ["implement", "full"]) {
		it(`profile ${profile}: prompt and tools are identical with a moved clock, branch and dirty tree`, async () => {
			const { contexts, tokens } = await runThreeTurns({ profile });
			expect(contexts).toHaveLength(3);
			// Faux reports zero cost; accumulated token usage is the available proof that session usage moved between turns.
			expect(tokens[1]!).toBeGreaterThan(tokens[0]!);
			expect(tokens[2]!).toBeGreaterThan(tokens[1]!);

			expect(instabilityReason(contexts)).toBe("");
			for (const ctx of contexts) {
				const prompt = transcriptView(ctx).systemPrompt;
				expect(prompt.length).toBeGreaterThan(0);
				expect(prompt).not.toContain("ky-volatile-branch");
				expect(prompt).not.toContain(TRACKED);
				expect(prompt).not.toMatch(/\$\d+\.\d{2}/);
			}
		});
	}

	it("a volatile section makes the same check fail (negative control)", async () => {
		const volatile = `
export default function (pi) {
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.volatile = String(Date.now());
    return undefined;
  });
}
`;
		const { contexts } = await runThreeTurns({ extraExtensionSource: volatile });
		expect(contexts).toHaveLength(3);
		expect(instabilityReason(contexts)).not.toBe("");
	});
});
