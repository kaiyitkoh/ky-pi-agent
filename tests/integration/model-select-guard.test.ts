/**
 * The routing extension undoes a model switch to an incapable executor and refuses prompts while the
 * current model fails the guard. Pi 1.1.0 fires `model_select` after the switch and ignores its return,
 * so the revert is a second `setModel`; the R1 id rule stands in for any refusal because it is id-based.
 */
import { afterEach, describe, expect, it } from "vitest";

import { createHarnessSession, type HarnessHandle } from "../helpers/harness-session.ts";
import { createRecordingUI, type RecordedUICall } from "../helpers/recording-ui.ts";

const LOG_KEY = "__kypiModelSelectGuardLog";
const CAPABLE = "faux-flash";
const R1 = "deepseek.r1-v1:0";
const R1_US = "us.deepseek.r1-v1:0";

const PROBE = [
	"export default function (pi) {",
	`  pi.on("model_select", (event) => { (globalThis[${JSON.stringify(LOG_KEY)}] ??= []).push(event.source + ":" + event.model.id); });`,
	"}",
].join("\n");

interface Setup {
	handle: HarnessHandle;
	calls: RecordedUICall[];
}

let open: HarnessHandle | undefined;

async function setup(fauxModels: string[]): Promise<Setup> {
	(globalThis as Record<string, unknown>)[LOG_KEY] = [];
	const recording = createRecordingUI();
	const handle = await createHarnessSession({
		entryPoints: [".pi/extensions/routing/index.ts"],
		fauxModels,
		extraExtensionSource: PROBE,
		uiContext: recording.ui,
		agentsMd: false,
		skills: false,
	});
	open = handle;
	await grantAuth(handle);
	return { handle, calls: recording.calls };
}

/** A faux provider under its own id resolves no auth, so `pi.setModel` and cycling refuse until a runtime key is set. */
async function grantAuth(handle: HarnessHandle): Promise<void> {
	const provider = handle.session.model?.provider;
	if (provider === undefined) throw new Error("session has no model");
	const runtime = handle.session.modelRuntime;
	await runtime.setRuntimeApiKey(provider, "faux-key");
	const deadline = Date.now() + 2000;
	while (!runtime.hasConfiguredAuth(provider)) {
		if (Date.now() > deadline) throw new Error("runtime key never became visible");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function log(): string[] {
	return [...(((globalThis as Record<string, unknown>)[LOG_KEY] as string[] | undefined) ?? [])];
}

function errors(calls: RecordedUICall[]): string[] {
	return calls.filter((c) => c.method === "notify" && c.key === "error").map((c) => String(c.value));
}

function modelOf(handle: HarnessHandle, id: string) {
	const found = handle.session.modelRuntime.getModels().find((m) => m.id === id);
	if (found === undefined) throw new Error(`faux model ${id} missing`);
	return found;
}

afterEach(async () => {
	await open?.dispose();
	open = undefined;
});

describe("model_select revert", () => {
	it("a /model-style switch to R1 is reverted with an error and exactly one extra setModel", async () => {
		const { handle, calls } = await setup([CAPABLE, R1]);
		await handle.session.setModel(modelOf(handle, R1));

		expect(handle.session.model?.id).toBe(CAPABLE);
		expect(log()).toEqual([`set:${R1}`, `set:${CAPABLE}`]);
		expect(errors(calls).join("\n")).toContain(R1);
	});

	it("a cycle onto R1 is reverted", async () => {
		const { handle, calls } = await setup([CAPABLE, R1]);
		await handle.session.cycleModel("forward");

		expect(handle.session.model?.id).toBe(CAPABLE);
		expect(log()[0]).toBe(`cycle:${R1}`);
		expect(errors(calls).length).toBeGreaterThan(0);
	});

	it("never reverts onto a model that also fails the guard", async () => {
		const { handle, calls } = await setup([R1, R1_US]);
		await handle.session.setModel(modelOf(handle, R1_US));

		expect(handle.session.model?.id).toBe(R1_US);
		expect(log()).toEqual([`set:${R1_US}`]);
		expect(errors(calls).length).toBeGreaterThan(0);
	});

	it("a capable switch is left alone", async () => {
		const { handle, calls } = await setup([CAPABLE, "faux-other"]);
		await handle.session.setModel(modelOf(handle, "faux-other"));

		expect(handle.session.model?.id).toBe("faux-other");
		expect(log()).toEqual(["set:faux-other"]);
		expect(errors(calls)).toEqual([]);
	});

	it("a restore event for a failing model is not reverted", async () => {
		const { handle } = await setup([CAPABLE, R1]);
		await handle.session.extensionRunner.emit({
			type: "model_select",
			model: modelOf(handle, R1),
			previousModel: modelOf(handle, CAPABLE),
			source: "restore",
		});

		expect(handle.session.model?.id).toBe(CAPABLE);
		expect(log()).toEqual([`restore:${R1}`]);
	});
});

describe("input backstop", () => {
	it("refuses a prompt while the current model fails the guard", async () => {
		const { handle, calls } = await setup([R1]);
		await handle.session.prompt("hello");

		expect(handle.captured).toHaveLength(0);
		expect(errors(calls).join("\n")).toContain("Prompt not sent");
	});

	it("lets a prompt through on a capable model", async () => {
		const { handle, calls } = await setup([CAPABLE]);
		await handle.session.prompt("hello");

		expect(handle.captured).toHaveLength(1);
		expect(errors(calls)).toEqual([]);
	});
});
