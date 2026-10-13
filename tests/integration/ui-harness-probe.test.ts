import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { createHarnessSession, type HarnessHandle, type HarnessSessionOptions } from "../helpers/harness-session.ts";
import { createRecordingUI } from "../helpers/recording-ui.ts";

const STASH_KEY = "__kyUiTestPi";
const sessions: HarnessHandle[] = [];

afterEach(async () => {
	delete (globalThis as Record<string, unknown>)[STASH_KEY];
	while (sessions.length > 0) await sessions.pop()!.dispose();
});

const SESSION_START_SRC = `
export default function (pi) {
  pi.on("session_start", (_e, ctx) => {
    ctx.ui.setStatus("ky-probe", ctx.mode + ":" + ctx.hasUI);
  });
}`;

const TOOL_SRC = `
export default function (pi) {
  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description: "probe",
    parameters: { type: "object", properties: {} },
    async execute() { return { content: [{ type: "text", text: "done" }], details: {} }; },
  });
  pi.on("tool_execution_start", (e, ctx) => ctx.ui.setStatus("ky-probe-tool", "start:" + e.toolName + ":" + e.toolCallId));
  pi.on("tool_execution_end", (e, ctx) => ctx.ui.setStatus("ky-probe-tool", "end:" + e.toolName + ":" + e.toolCallId));
}`;

const BUS_SRC = `
export default function (pi) {
  globalThis.${STASH_KEY} = pi;
  pi.on("session_start", (_e, ctx) => {
    pi.events.on("ky.probe", (data) => ctx.ui.setStatus("ky-probe-bus", "n:" + data.n));
  });
}`;

async function open(
	src: string,
	withUi: boolean,
	responses?: HarnessSessionOptions["responses"],
) {
	const rec = createRecordingUI();
	const handle = await createHarnessSession({
		entryPoints: [],
		extraExtensionSource: src,
		...(withUi ? { uiContext: rec.ui, mode: "tui" as const } : {}),
		...(responses !== undefined ? { responses } : {}),
	});
	sessions.push(handle);
	return { rec, handle };
}

describe("headless faux session with a recording UI", () => {
	it("fires session_start with ctx.mode tui and ctx.hasUI true", async () => {
		const { rec } = await open(SESSION_START_SRC, true);
		expect(rec.statuses("ky-probe")).toEqual(["tui:true"]);
	});

	it("records nothing without a bound UI (no-op default)", async () => {
		const { rec } = await open(SESSION_START_SRC, false);
		expect(rec.calls).toEqual([]);
	});

	it("fires tool_execution_start and _end for a faux call to a tool named subagent", async () => {
		const { rec, handle } = await open(TOOL_SRC, true, [
			fauxAssistantMessage(fauxToolCall("subagent", {}, { id: "call-1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("ok"),
		]);
		await handle.session.prompt("go");
		expect(rec.statuses("ky-probe-tool")).toEqual(["start:subagent:call-1", "end:subagent:call-1"]);
	});

	it("lets a test emit on the shared pi.events bus through a stashed pi", async () => {
		const { rec } = await open(BUS_SRC, true);
		const stashed = (globalThis as Record<string, unknown>)[STASH_KEY] as {
			events: { emit(channel: string, data: unknown): void };
		};
		stashed.events.emit("ky.probe", { n: 1 });
		expect(rec.statuses("ky-probe-bus")).toEqual(["n:1"]);
	});
});
