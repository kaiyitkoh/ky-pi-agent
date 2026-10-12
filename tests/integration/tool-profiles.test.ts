/**
 * Tool profiles narrow the active set once, before the first provider request.
 * Mutation proofs: T1 fails if routing applies the profile "full" always (recon would declare bg_run);
 * T2 fails if a mid-session removal stopped writing toolsRemoved; completeness fails if a table entry is dropped
 * (the injectable-table block proves findUnclassified reports it); the plan cases fail if the read-only guard is removed.
 */
import type { FauxResponseStep, TranscriptContext } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
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
import { SHELL_POLICY_SECTION } from "../../.pi/extensions/background-tasks/src/core/shell-policy.ts";
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
		implement: { has: ["read", "bash", "edit", "write", "todo", "consult_advisor", "approve_ky_command"], lacks: ["bg_run", "questionnaire", "web_search"] },
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
		expect((await declared({ profile: "full" })).sort()).toEqual((await declared({ entryPoints: withoutRouting })).sort());
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
	it("reopening a full-profile transcript under the default keeps bg_run and writes no removal", async () => {
		const sessionManager = SessionManager.inMemory(tmpdir());
		await withHarnessSession({ profile: "full", sessionManager, responses: steps(1, []) }, async (h) => {
			await h.session.prompt("one");
		});
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ sessionManager, responses: steps(1, sink) }, async (h) => {
			expect(h.session.getActiveToolNames()).toContain("bg_run");
			await h.session.prompt("two");
			expect(getCurrentTools(sink[0]!.messages).map((t) => t.name)).toContain("bg_run");
			expect(removedNames(sink[0]!)).toEqual([]);
		});
	});

	it("session_start on reload in a session with no messages leaves the active set alone", async () => {
		await withHarnessSession({}, async (h) => {
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "bg_run"]);
			await h.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
			expect(h.session.getActiveToolNames()).toContain("bg_run");
		});
	});

	it("a reload after a request records no removal", async () => {
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ responses: steps(2, sink) }, async (h) => {
			await h.session.prompt("one");
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "bg_run"]);
			await h.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
			expect(h.session.getActiveToolNames()).toContain("bg_run");
			await h.session.prompt("two");
			expect(removedNames(sink[1]!)).toEqual([]);
		});
	});

	it("a tool activated after start-up narrowing, before any request, is dropped before the first request", async () => {
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ responses: steps(1, sink) }, async (h) => {
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "qoder_delegate"]);
			await h.session.prompt("one");
			expect(getCurrentTools(sink[0]!.messages).map((t) => t.name)).not.toContain("qoder_delegate");
			expect(removedNames(sink[0]!)).toEqual([]);
		});
	});

	it("a dropped bg_run leaves no shell-policy section and the system prompt byte-stable across turns", async () => {
		const sink: TranscriptContext[] = [];
		await withHarnessSession({ responses: steps(2, sink) }, async (h) => {
			await h.session.prompt("one");
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "bg_run"]);
			await h.session.prompt("two");
			const [first, second] = [transcriptView(sink[0]!), transcriptView(sink[1]!)];
			expect(second.tools.map((t) => t.name)).not.toContain("bg_run");
			expect(second.systemPrompt).not.toContain(SHELL_POLICY_SECTION);
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
				h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "bg_run"]);
				queued = h.session.prompt("follow", { streamingBehavior: "followUp" });
				return fauxAssistantMessage("ok");
			},
			(c) => {
				sink.push(c);
				return fauxAssistantMessage("ok");
			},
		];
		await withHarnessSession({ responses }, async (handle) => {
			h = handle;
			await h.session.prompt("one");
			await queued;
			expect(sink.length, "non-vacuity: the follow-up reached the provider").toBe(2);
			expect(getCurrentTools(sink[1]!.messages).map((t) => t.name)).toContain("bg_run");
		});
	});

	it("a new empty session is still narrowed", async () => {
		await withHarnessSession({}, async (h) => {
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "bg_run"]);
			expect(h.session.getActiveToolNames(), "non-vacuity: bg_run is active before session_start").toContain("bg_run");
			await h.session.extensionRunner.emit({ type: "session_start", reason: "new" });
			expect(h.session.getActiveToolNames()).not.toContain("bg_run");
		});
	});
});

describe("an explicit --tools allowlist is never narrowed", () => {
	const tools = ["read", "bash", "edit", "write", "bg_run"];

	it("negative control: without --tools on argv the default profile drops bg_run", async () => {
		expect(await declared({ tools })).not.toContain("bg_run");
	});

	it("with --tools on argv every named tool is declared", async () => {
		const saved = process.argv;
		process.argv = [...saved, "--tools", tools.join(",")];
		try {
			expect((await declared({ tools })).sort()).toEqual([...tools].sort());
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
