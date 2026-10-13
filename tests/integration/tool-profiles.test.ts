/**
 * Tool profiles narrow the active set at session start, and on each idle prompt to tools the transcript has not declared.
 * Mutation proofs: T1 fails if routing applies the profile "full" always (recon would declare bg_run);
 * T2 fails if a mid-session removal stopped writing toolsRemoved; completeness fails if a table entry is dropped
 * (the injectable-table block proves findUnclassified reports it); the plan cases fail if the read-only guard is removed.
 */
import type { FauxResponseStep, TranscriptContext } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	fauxToolCall,
	getCurrentTools,
	hasNonAdditiveToolChanges,
	resolveTranscriptTools,
} from "@earendil-works/pi-ai";
import { tmpdir } from "node:os";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
	findUnclassified,
	TOOL_PROFILES,
	type ProfileName,
} from "../../.pi/extensions/routing/profiles.ts";
import { transcriptView } from "../helpers/faux.ts";
import { createHarnessSession, type HarnessHandle, listEntryPoints, withHarnessSession } from "../helpers/harness-session.ts";

function steps(n: number, sink: TranscriptContext[]): FauxResponseStep[] {
	return Array.from({ length: n }, () => (context: TranscriptContext) => {
		sink.push(context);
		return fauxAssistantMessage("ok");
	});
}

async function declared(opts: Parameters<typeof createHarnessSession>[0]): Promise<string[]> {
	const sink: TranscriptContext[] = [];
	return withHarnessSession({ ...opts, responses: steps(1, sink) }, async (h) => {
		await h.session.prompt("hi");
		return getCurrentTools(sink[0]!.messages).map((t) => t.name);
	});
}

/** Stands in for pi-lsp, which the offline harness does not load; the table classifies lsp_fix as full-only. */
const LSP_FIX_STUB = `export default function (pi) {
	pi.registerTool({
		name: "lsp_fix",
		label: "lsp fix",
		description: "stub",
		parameters: { type: "object", properties: {} },
		async execute() {
			return { content: [{ type: "text", text: "ok" }], details: undefined };
		},
	});
}`;

const systemCount = (c: TranscriptContext): number => c.messages.filter((m) => m.role === "system").length;

describe("T1: narrowing happens before the first request", () => {
	it("non-vacuity: full declares bg_run and questionnaire", async () => {
		const names = await declared({ profile: "full" });
		expect(names).toContain("bg_run");
		expect(names).toContain("questionnaire");
	});

	const expectations: Record<string, { has: string[]; lacks: string[] }> = {
		recon: { has: ["read", "bash", "approve_ky_command"], lacks: ["edit", "write", "todo", "bg_run", "questionnaire", "subagent"] },
		review: { has: ["read", "bash", "consult_advisor", "approve_ky_command"], lacks: ["edit", "write", "todo", "bg_run", "questionnaire"] },
		implement: { has: ["read", "bash", "edit", "write", "todo", "consult_advisor", "approve_ky_command", "bg_enable"], lacks: ["qoder_delegate", "lsp_fix", "web_search", "questionnaire", "bg_run", "bg_status"] },
	};

	for (const [profile, want] of Object.entries(expectations)) {
		it(`${profile}: one system message, no removal, additive-only on request 2`, async () => {
			const sink: TranscriptContext[] = [];
			await withHarnessSession({ profile, responses: steps(2, sink) }, async (h) => {
				await h.session.prompt("one");
				await h.session.prompt("two");
				const first = sink[0]!;
				expect(systemCount(first)).toBe(1);
				for (const m of first.messages) {
					if (m.role === "system") expect((m as { toolsRemoved?: unknown[] }).toolsRemoved ?? []).toEqual([]);
				}
				const names = getCurrentTools(first.messages).map((t) => t.name);
				for (const n of want.has) expect(names, `${profile} should declare ${n}`).toContain(n);
				for (const n of want.lacks) expect(names, `${profile} should not declare ${n}`).not.toContain(n);
				for (const n of names) {
					const allowed = TOOL_PROFILES[n];
					if (allowed !== undefined) expect(allowed, n).toContain(profile as ProfileName);
				}
				expect(hasNonAdditiveToolChanges(sink[1]!.messages)).toBe(false);
				expect(systemCount(sink[1]!)).toBe(1);
			});
		});
	}

	it("default behaves like implement", async () => {
		expect((await declared({})).sort()).toEqual((await declared({ profile: "implement" })).sort());
	});

	it("full applies no narrowing at all", async () => {
		const withoutRouting = listEntryPoints().filter((e) => !e.includes("/routing/"));
		expect((await declared({ profile: "full" })).sort()).toEqual([...(await declared({ entryPoints: withoutRouting })), "bg_enable"].sort());
	});

	it("implement: calling bg_enable declares the background tools and questionnaire on the next request, removing nothing", async () => {
		const sink: TranscriptContext[] = [];
		const responses: FauxResponseStep[] = [
			(context: TranscriptContext) => {
				sink.push(context);
				return fauxAssistantMessage([fauxToolCall("bg_enable", {})]);
			},
			...steps(1, sink),
		];
		await withHarnessSession({ profile: "implement", responses }, async (h) => {
			await h.session.prompt("start a dev server");
			const before = getCurrentTools(sink[0]!.messages).map((t) => t.name);
			const after = getCurrentTools(sink[1]!.messages).map((t) => t.name);
			expect(before).not.toContain("bg_run");
			for (const n of ["bg_run", "bg_status", "bg_logs", "bg_kill", "questionnaire"]) expect(after, n).toContain(n);
			expect(hasNonAdditiveToolChanges(sink[1]!.messages)).toBe(false);
		});
	});
});

describe("T2: a removal after start poisons anchoring", () => {
	it("records toolsRemoved and never anchors again", async () => {
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ profile: "implement", responses: steps(3, sink) }, async (h) => {
			await h.session.prompt("one");
			const active = h.session.getActiveToolNames();
			expect(active).toContain("todo");
			h.session.setActiveToolsByName(active.filter((n) => n !== "todo"));
			await h.session.prompt("two");
			const second = sink[1]!;
			expect(systemCount(second)).toBe(2);
			const removed = second.messages.flatMap((m) =>
				m.role === "system" ? ((m as { toolsRemoved?: { name: string }[] }).toolsRemoved ?? []) : [],
			);
			expect(removed.map((r) => r.name)).toContain("todo");
			expect(hasNonAdditiveToolChanges(second.messages)).toBe(true);

			h.session.setActiveToolsByName(active);
			await h.session.prompt("three");
			expect(resolveTranscriptTools(sink[2]!.messages, true).anchorsAdditions).toBe(false);
		});
	});
});

const removedNames = (c: TranscriptContext): string[] =>
	c.messages.flatMap((m) => (m.role === "system" ? ((m as { toolsRemoved?: { name: string }[] }).toolsRemoved ?? []) : []).map((t) => t.name));

describe("a transcript's loadout is never narrowed again", () => {
	it("reopening a full-profile transcript under the default keeps lsp_fix and writes no removal", async () => {
		const sessionManager = SessionManager.inMemory(tmpdir());
		await withHarnessSession({ profile: "full", extraExtensionSource: LSP_FIX_STUB, sessionManager, responses: steps(1, []) }, async (h) => {
			await h.session.prompt("one");
		});
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ extraExtensionSource: LSP_FIX_STUB, sessionManager, responses: steps(1, sink) }, async (h) => {
			expect(h.session.getActiveToolNames()).toContain("lsp_fix");
			await h.session.prompt("two");
			expect(getCurrentTools(sink[0]!.messages).map((t) => t.name)).toContain("lsp_fix");
			expect(removedNames(sink[0]!)).toEqual([]);
		});
	});

	it("session_start on reload in a session with no messages leaves the active set alone", async () => {
		await withHarnessSession({ extraExtensionSource: LSP_FIX_STUB }, async (h) => {
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "lsp_fix"]);
			await h.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
			expect(h.session.getActiveToolNames()).toContain("lsp_fix");
		});
	});

	it("a reload after a request records no removal", async () => {
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ extraExtensionSource: LSP_FIX_STUB, responses: steps(2, sink) }, async (h) => {
			await h.session.prompt("one");
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "lsp_fix"]);
			await h.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
			expect(h.session.getActiveToolNames()).toContain("lsp_fix");
			await h.session.prompt("two");
			expect(removedNames(sink[1]!)).toEqual([]);
		});
	});

	it("a tool activated after start-up narrowing, before any request, is dropped before the first request", async () => {
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ extraExtensionSource: LSP_FIX_STUB, responses: steps(1, sink) }, async (h) => {
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "lsp_fix"]);
			await h.session.prompt("one");
			expect(getCurrentTools(sink[0]!.messages).map((t) => t.name)).not.toContain("lsp_fix");
			expect(removedNames(sink[0]!)).toEqual([]);
		});
	});

	it("a dropped lsp_fix leaves the system prompt byte-stable across turns", async () => {
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ extraExtensionSource: LSP_FIX_STUB, responses: steps(2, sink) }, async (h) => {
			await h.session.prompt("one");
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "lsp_fix"]);
			await h.session.prompt("two");
			const [first, second] = [transcriptView(sink[0]!), transcriptView(sink[1]!)];
			expect(second.tools.map((t) => t.name)).not.toContain("lsp_fix");
			expect(second.systemPrompt).toBe(first.systemPrompt);
			expect(systemCount(sink[1]!)).toBe(1);
		});
	});

	it("a follow-up queued mid-run keeps a tool activated during that run", async () => {
		const sink: TranscriptContext[] = [];
		let h!: HarnessHandle;
		let queued: Promise<void> | undefined;
		const responses: FauxResponseStep[] = [
			(c) => {
				sink.push(c);
				h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "lsp_fix"]);
				queued = h.session.prompt("follow", { streamingBehavior: "followUp" });
				return fauxAssistantMessage("ok");
			},
			(c) => {
				sink.push(c);
				return fauxAssistantMessage("ok");
			},
		];
		await withHarnessSession({ extraExtensionSource: LSP_FIX_STUB, responses }, async (handle) => {
			h = handle;
			await h.session.prompt("one");
			await queued;
			expect(sink.length, "non-vacuity: the follow-up reached the provider").toBe(2);
			expect(getCurrentTools(sink[1]!.messages).map((t) => t.name)).toContain("lsp_fix");
		});
	});

	it("a new empty session is still narrowed", async () => {
		await withHarnessSession({ extraExtensionSource: LSP_FIX_STUB }, async (h) => {
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "lsp_fix"]);
			expect(h.session.getActiveToolNames(), "non-vacuity: lsp_fix is active before session_start").toContain("lsp_fix");
			await h.session.extensionRunner.emit({ type: "session_start", reason: "new" });
			expect(h.session.getActiveToolNames()).not.toContain("lsp_fix");
		});
	});
});

describe("an explicit --tools allowlist is never narrowed", () => {
	const tools = ["read", "bash", "edit", "write", "lsp_fix"];

	it("negative control: without --tools on argv the default profile drops lsp_fix", async () => {
		expect(await declared({ tools, extraExtensionSource: LSP_FIX_STUB })).not.toContain("lsp_fix");
	});

	it("with --tools on argv every named tool is declared", async () => {
		const saved = process.argv;
		process.argv = [...saved, "--tools", tools.join(",")];
		try {
			expect((await declared({ tools, extraExtensionSource: LSP_FIX_STUB })).sort()).toEqual([...tools].sort());
		} finally {
			process.argv = saved;
		}
	});
});

describe("completeness", () => {
	it("every registered tool is classified", async () => {
		await withHarnessSession({ profile: "full" }, async (h) => {
			const names = h.session.getAllTools().map((t) => t.name);
			expect(names.length).toBeGreaterThan(10);
			expect(findUnclassified(names), "classify these in routing/profiles.ts").toEqual([]);
		});
	});

	it("mutation: a table missing todo is reported", () => {
		const { todo: _drop, ...without } = TOOL_PROFILES;
		expect(findUnclassified(["todo"], without)).toEqual(["todo"]);
	});
});

describe("plan mode survives the default profile", () => {
	const check = (names: string[]): void => {
		for (const n of ["grep", "find", "ls", "questionnaire"]) expect(names, n).toContain(n);
		expect(names).not.toContain("edit");
		expect(names).not.toContain("write");
	};

	it("--plan keeps the read-only loadout", async () => {
		check(await declared({ profile: "implement", flags: { plan: true } }));
	});

	it("--plan, then leaving plan mode, declares the profile's tools and removes none", async () => {
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ profile: "implement", flags: { plan: true }, responses: steps(2, sink) }, async (h) => {
			await h.session.prompt("one");
			await h.session.prompt("/plan-mode");
			expect(h.session.getActiveToolNames(), "non-vacuity: leaving plan mode restores it").toContain("qoder_delegate");
			await h.session.prompt("two");
			const names = getCurrentTools(sink[1]!.messages).map((t) => t.name);
			expect(names).toContain("edit");
			expect(names, "plan mode never declared it, so the profile drops it").not.toContain("qoder_delegate");
			expect(removedNames(sink[1]!)).toEqual([]);
		});
	});

	// Pins a documented, accepted limit: Pi starts a triggerTurn turn without emitting `input`, so that turn is not narrowed.
	it("accepted limitation: a triggerTurn turn after leaving plan mode keeps tools outside the profile", async () => {
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ profile: "implement", flags: { plan: true }, responses: steps(2, sink) }, async (h) => {
			await h.session.prompt("one");
			await h.session.prompt("/plan-mode");
			await h.session.sendCustomMessage({ customType: "x", content: "go", display: true }, { triggerTurn: true });
			expect(sink.length, "non-vacuity: the triggered turn reached the provider").toBe(2);
			const names = getCurrentTools(sink[1]!.messages).map((t) => t.name);
			expect(names).toContain("qoder_delegate");
			expect(removedNames(sink[1]!)).toEqual([]);
		});
	});

	it("a restored plan-mode entry keeps the read-only loadout", async () => {
		check(
			await declared({
				profile: "implement",
				beforeBind: (session) => {
					session.sessionManager.appendCustomEntry("plan-mode", { enabled: true, todos: [], executing: false });
				},
			}),
		);
	});
});
