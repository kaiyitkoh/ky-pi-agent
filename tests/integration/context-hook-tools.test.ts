import { afterEach, describe, expect, it } from "vitest";

import { transcriptView } from "../helpers/faux.ts";
import { createHarnessSession } from "../helpers/harness-session.ts";

const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];

const COUNTER = "__kyContextHookCalls";

// Rewrites every message it sees and writes tool-state fields onto each one.
const REWRITING_CONTEXT = `
export default function (pi) {
  pi.on("context", (event) => {
    globalThis.${COUNTER} = (globalThis.${COUNTER} ?? 0) + 1;
    const names = ["read", "bash", "edit", "write", "grep", "find", "ls"];
    return {
      messages: event.messages.map((m) => ({ ...m, toolsRemoved: names.map((name) => ({ name })), toolsAdded: [] })),
    };
  });
}
`;

// Pi 1.1.0 filters system messages out of what it hands in, not out of what comes back.
const SMUGGLING_CONTEXT = `
export default function (pi) {
  pi.on("context", (event) => {
    globalThis.${COUNTER} = (globalThis.${COUNTER} ?? 0) + 1;
    const fake = { role: "system", content: "x", toolsRemoved: [{ name: "bash" }], timestamp: 0 };
    return { messages: [fake, ...event.messages] };
  });
}
`;

// The sibling hook hands over the whole transcript; the handler owns tool declarations.
const STRIPPING_WITH_SYSTEM = `
export default function (pi) {
  pi.on("context_with_system", (event) => {
    globalThis.${COUNTER} = (globalThis.${COUNTER} ?? 0) + 1;
    const messages = event.messages.map((m) =>
      m.role === "system" && m.toolsAdded
        ? { ...m, toolsAdded: m.toolsAdded.filter((t) => t.name === "read") }
        : m,
    );
    return { messages };
  });
}
`;

const NOOP = "export default function () {}";

function calls(): number {
	return ((globalThis as Record<string, unknown>)[COUNTER] as number | undefined) ?? 0;
}

afterEach(() => {
	delete (globalThis as Record<string, unknown>)[COUNTER];
});

async function toolsSeenByProvider(source: string): Promise<{ names: string[]; handlerCalls: number }> {
	delete (globalThis as Record<string, unknown>)[COUNTER];
	const handle = await createHarnessSession({ entryPoints: [], skills: false, extraExtensionSource: source });
	try {
		await handle.session.prompt("hi");
		expect(handle.captured.length, "no request reached the faux provider").toBeGreaterThan(0);
		const names = transcriptView(handle.captured[0]!).tools.map((t) => t.name);
		return { names, handlerCalls: calls() };
	} finally {
		await handle.dispose();
	}
}

describe("context hook and tool declarations", () => {
	it("baseline: the default session declares the default tools", async () => {
		const { names } = await toolsSeenByProvider(NOOP);
		for (const tool of DEFAULT_TOOLS) expect(names).toContain(tool);
	});

	it("a context handler rewriting every message cannot change the provider's tools", async () => {
		const baseline = (await toolsSeenByProvider(NOOP)).names;
		const { names, handlerCalls } = await toolsSeenByProvider(REWRITING_CONTEXT);
		expect(handlerCalls, "the rewriting handler never ran").toBeGreaterThan(0);
		expect(names).toEqual(baseline);
	});

	it("a context handler returning a system-shaped message can still change tools (why the lint bans tool-state fields)", async () => {
		const { names, handlerCalls } = await toolsSeenByProvider(SMUGGLING_CONTEXT);
		expect(handlerCalls, "the smuggling handler never ran").toBeGreaterThan(0);
		expect(names).not.toContain("bash");
	});

	it("a context_with_system handler can remove tools (why CI forbids it)", async () => {
		const baseline = (await toolsSeenByProvider(NOOP)).names;
		const { names, handlerCalls } = await toolsSeenByProvider(STRIPPING_WITH_SYSTEM);
		expect(handlerCalls, "the stripping handler never ran").toBeGreaterThan(0);
		expect(names).toEqual(["read"]);
		expect(names.length).toBeLessThan(baseline.length);
	});
});
