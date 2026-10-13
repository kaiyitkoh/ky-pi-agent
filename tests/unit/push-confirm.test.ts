/**
 * git push policy: force, protected and ambiguous destinations block; a resolved feature-branch push asks;
 * config-derived destinations are trusted only when nothing else in the command can change them first.
 */
import { spawnSync } from "node:child_process";

import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { classifyGitInvocation, DETACHED_HEAD, type GitPolicyFacts, type GitVerdict } from "../../.pi/extensions/safety/git.ts";
import safety from "../../.pi/extensions/safety/index.ts";
import { evaluate, type PolicyFacts } from "../../.pi/extensions/safety/policy.ts";
import { withTempLogCwd } from "../helpers/logs.ts";

const PROTECTED = ["main", "master"];
const PUSH_PROTECTED = [...PROTECTED, "staging"];

function configOf(entries: Record<string, string>): (key: string) => readonly string[] {
	return (key) => (key in entries ? [entries[key]] : []);
}

function classify(argv: string, opts: { head?: string; config?: Record<string, string>; trusted?: boolean } = {}): GitVerdict {
	const facts: GitPolicyFacts = {
		currentBranch: opts.head ?? "feat",
		protectedBranches: PROTECTED,
		pushProtectedBranches: PUSH_PROTECTED,
		readConfig: configOf(opts.config ?? {}),
		configTrusted: opts.trusted ?? true,
	};
	const args = argv.split(/\s+/).filter((a) => a !== "");
	return classifyGitInvocation({ subcommand: "push", args }, facts);
}

const UPSTREAM_MAIN = { "push.default": "upstream", "branch.feat.merge": "refs/heads/main", "branch.feat.remote": "origin" };

describe("push destinations that always block", () => {
	it.each([
		["origin main", {}],
		["origin feat:main", {}],
		["origin feat:staging", {}],
		["origin HEAD:refs/heads/staging", {}],
		["origin --delete staging", {}],
		["origin :main", {}],
		["--force origin feat:feat", {}],
		["-f origin feat:feat", {}],
		["-uf origin feat:feat", {}],
		["--force-with-lease origin feat:feat", {}],
		["--force-with-lease=feat:abc origin feat:feat", {}],
		["--force-if-includes origin feat:feat", {}],
		["origin +feat:feat", {}],
		["origin +feat", {}],
		["--mirror origin", {}],
		["--all origin", {}],
		["--tags origin", {}],
		["--prune origin feat:feat", {}],
		["origin tag v1", {}],
		["--frobnicate origin feat:feat", {}],
		["-o merge_request.merge_when_pipeline_succeeds origin feat:feat", {}],
		["--recurse-submodules=on-demand origin feat:feat", {}],
		["origin feat:feat", { "push.recurseSubmodules": "on-demand" }],
		["origin feat:feat", { "submodule.recurse": "true" }],
	])("git push %s with config %j", (argv, config) => {
		expect(classify(argv, { config }).kind).toBe("block");
	});
});

describe("implicit destinations resolve through config, never silently to a protected branch", () => {
	it("bare push under push.default=upstream tracking main blocks, and asks once the upstream is a feature branch", () => {
		expect(classify("", { config: UPSTREAM_MAIN }).kind).toBe("block");
		const ok = classify("", { config: { ...UPSTREAM_MAIN, "branch.feat.merge": "refs/heads/feat" } });
		expect(ok.kind).toBe("ask");
	});

	it("push.default=simple checks a differently named upstream too", () => {
		expect(classify("", { config: { "branch.feat.merge": "refs/heads/main", "branch.feat.remote": "origin" } }).kind).toBe("block");
		expect(classify("", { config: { "branch.feat.merge": "refs/heads/feat", "branch.feat.remote": "origin" } }).kind).toBe("ask");
	});

	it("bare source `git push origin feat` follows push.default=upstream to main and blocks; without it asks", () => {
		expect(classify("origin feat", { config: UPSTREAM_MAIN }).kind).toBe("block");
		expect(classify("-u origin feat").kind).toBe("ask");
	});

	it("remote.<r>.push may remap a bare source or a bare push, so both block while it is set", () => {
		const remap = { "remote.origin.push": "refs/heads/feat:refs/heads/main" };
		expect(classify("origin feat", { config: remap }).kind).toBe("block");
		expect(classify("", { config: remap }).kind).toBe("block");
		expect(classify("origin feat:feat", { config: remap }).kind).toBe("ask");
	});

	it("push.default matching and nothing block; current asks for HEAD", () => {
		expect(classify("", { config: { "push.default": "matching" } }).kind).toBe("block");
		expect(classify("", { config: { "push.default": "nothing" } }).kind).toBe("block");
		expect(classify("", { config: { "push.default": "current" } }).kind).toBe("ask");
		expect(classify("", { head: "staging", config: { "push.default": "current" } }).kind).toBe("block");
	});

	it("HEAD as a source resolves to the checked-out branch; detached HEAD blocks", () => {
		expect(classify("origin HEAD").kind).toBe("ask");
		expect(classify("origin HEAD", { head: "staging" }).kind).toBe("block");
		expect(classify("origin HEAD", { head: DETACHED_HEAD }).kind).toBe("block");
		expect(classify("", { head: DETACHED_HEAD }).kind).toBe("block");
	});

	it("HEAD on main blocks even an explicit feature destination", () => {
		expect(classify("origin feat:feat", { head: "main" }).kind).toBe("block");
		expect(classify("", { head: "main" }).kind).toBe("block");
	});

	it("an untrusted or unreadable config blocks implicit destinations but still asks for explicit ones", () => {
		expect(classify("origin feat", { trusted: false }).kind).toBe("block");
		expect(classify("", { trusted: false }).kind).toBe("block");
		expect(classify("origin feat:feat", { trusted: false }).kind).toBe("ask");
		const noConfig = classifyGitInvocation({ subcommand: "push", args: [] }, { currentBranch: "feat", protectedBranches: PROTECTED, configTrusted: true });
		expect(noConfig.kind).toBe("block");
	});

	it("the prompt names the exact command, the resolved remote and the branch", () => {
		const verdict = classify("-u", { config: { "branch.feat.pushRemote": "fork" } });
		expect(verdict.kind).toBe("ask");
		if (verdict.kind !== "ask") return;
		expect(verdict.prompt).toContain("git push -u");
		expect(verdict.prompt).toContain("Remote: fork");
		expect(verdict.prompt).toContain("Branch: feat");
	});
});

describe("evaluate(): config is trusted only for a push that runs on its own", () => {
	const facts = (config: Record<string, string> = {}): PolicyFacts => ({
		cwd: "/repo",
		projectRoot: "/repo",
		home: "/home/u",
		currentBranchFor: () => "feat",
		protectedBranches: PROTECTED,
		pushProtectedBranches: PUSH_PROTECTED,
		gitConfigFor: (_dir, key) => configOf(config)(key),
	});

	it.each([
		["git push origin feat", "ask"],
		["git push -u origin feat 2>&1", "ask"],
		["git push", "ask"],
		["git push origin feat | tail -5", "block"],
		["git config push.default upstream && git push origin feat", "block"],
		["git checkout main && git push", "block"],
		["cd sub && git push origin feat", "block"],
		["GIT_CONFIG_COUNT=1 git push origin feat", "block"],
		["env GIT_DIR=/x git push origin feat", "block"],
		["git --git-dir=/x push origin feat", "block"],
		["git push origin feat:feat && echo done", "ask"],
		["git push origin feat:feat && terraform apply", "block"],
		["git push origin a:a && git push origin b:b", "block"],
		["git push origin feat:staging", "block"],
	])("%s -> %s", (command, expected) => {
		expect(evaluate("bash", { command }, facts()).kind).toBe(expected);
	});

	it("a sole bare push still follows config to main and blocks", () => {
		expect(evaluate("bash", { command: "git push origin feat" }, facts(UPSTREAM_MAIN)).kind).toBe("block");
	});
});

describe("tool_call hook: ask confirms in the TUI only, and the wrapper honours the answer once", () => {
	function load(): { hook: (event: unknown, ctx: ExtensionContext) => Promise<{ block?: boolean; reason?: string } | undefined>; bash: ToolDefinition<never, unknown> } {
		const handlers = new Map<string, unknown>();
		const tools = new Map<string, ToolDefinition<never, unknown>>();
		safety({
			on: (event: string, handler: unknown) => handlers.set(event, handler),
			registerTool: (tool: ToolDefinition<never, unknown>) => tools.set(tool.name, tool),
		} as unknown as ExtensionAPI);
		return { hook: handlers.get("tool_call") as never, bash: tools.get("bash") as ToolDefinition<never, unknown> };
	}

	function initRepo(cwd: string): void {
		const r = spawnSync("git", ["init", "-q", "-b", "feat", cwd], { encoding: "utf-8", windowsHide: true });
		expect(r.status, r.stderr).toBe(0);
	}

	function ctxOf(cwd: string, ui: { hasUI: boolean; mode: string; confirm?: (title: string, message: string) => Promise<boolean> }): ExtensionContext {
		return { cwd, hasUI: ui.hasUI, mode: ui.mode, ui: { confirm: ui.confirm } } as unknown as ExtensionContext;
	}

	it("no UI, or a non-TUI mode, refuses without prompting", async () => {
		const { hook } = load();
		await withTempLogCwd(async (cwd) => {
			initRepo(cwd);
			let asked = 0;
			const confirm = async (): Promise<boolean> => (asked++, true);
			for (const [hasUI, mode] of [[false, "json"], [false, "print"], [true, "rpc"]] as const) {
				const result = await hook({ toolName: "bash", input: { command: "git push origin feat" }, toolCallId: `tc-${mode}` }, ctxOf(cwd, { hasUI, mode, confirm }));
				expect(result?.block, `${mode} must refuse`).toBe(true);
			}
			expect(asked).toBe(0);
		});
	});

	it("a protected push never prompts", async () => {
		const { hook } = load();
		await withTempLogCwd(async (cwd) => {
			initRepo(cwd);
			let asked = 0;
			const result = await hook(
				{ toolName: "bash", input: { command: "git push origin feat:main" }, toolCallId: "tc-main" },
				ctxOf(cwd, { hasUI: true, mode: "tui", confirm: async () => (asked++, true) }),
			);
			expect(result?.block).toBe(true);
			expect(asked).toBe(0);
		});
	});

	it("deny blocks; approve shows the resolved branch, allows, and the wrapper consumes the grant once", async () => {
		const { hook, bash } = load();
		await withTempLogCwd(async (cwd) => {
			initRepo(cwd);
			const command = "git push origin feat:feat";
			const denied = await hook({ toolName: "bash", input: { command }, toolCallId: "tc-deny" }, ctxOf(cwd, { hasUI: true, mode: "tui", confirm: async () => false }));
			expect(denied?.block).toBe(true);
			expect(denied?.reason).toContain("declined");

			let message = "";
			const ctx = ctxOf(cwd, { hasUI: true, mode: "tui", confirm: async (_t, m) => ((message = m), true) });
			const approved = await hook({ toolName: "bash", input: { command }, toolCallId: "tc-ok" }, ctx);
			expect(approved).toBeUndefined();
			expect(message).toContain(command);
			expect(message).toContain("Remote: origin");
			expect(message).toContain("Branch: feat");

			const execute = (bash as unknown as { execute: (...a: unknown[]) => Promise<unknown> }).execute;
			const guardText = "needs human confirmation";
			const first = await execute("tc-ok", { command }, undefined, undefined, ctx).then(
				() => "",
				(err: unknown) => String(err),
			);
			expect(first, "the confirmed push must pass the wrapper (git itself may then fail: no remote)").not.toContain(guardText);
			const second = await execute("tc-again", { command }, undefined, undefined, ctx).then(
				() => "",
				(err: unknown) => String(err),
			);
			expect(second, "the grant is one-shot").toContain(guardText);
		});
	}, 30_000);
});
