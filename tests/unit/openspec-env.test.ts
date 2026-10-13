import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import harness from "../../.pi/extensions/harness/index.ts";

const NAMES = ["OPENSPEC_TELEMETRY", "DO_NOT_TRACK", "OPENSPEC_NO_UPDATE_CHECK", "OPENSPEC_NO_AUTO_CONFIG"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
	for (const n of NAMES) saved.set(n, process.env[n]);
	process.env.OPENSPEC_TELEMETRY = "1";
	for (const n of NAMES.slice(1)) delete process.env[n];
});

afterEach(() => {
	for (const [n, v] of saved) {
		if (v === undefined) delete process.env[n];
		else process.env[n] = v;
	}
});

function load() {
	const pi = { on: vi.fn(), registerCommand: vi.fn(), registerProvider: vi.fn(), registerTool: vi.fn() };
	harness(pi as unknown as ExtensionAPI);
	return pi;
}

describe("harness extension OpenSpec opt-outs", () => {
	it("force-sets all four, overriding an inherited telemetry opt-in", () => {
		load();
		expect(process.env.OPENSPEC_TELEMETRY).toBe("0");
		expect(process.env.DO_NOT_TRACK).toBe("1");
		expect(process.env.OPENSPEC_NO_UPDATE_CHECK).toBe("1");
		expect(process.env.OPENSPEC_NO_AUTO_CONFIG).toBe("1");
	});

	it("still registers no tool", () => {
		expect(load().registerTool).not.toHaveBeenCalled();
	});

	it("restores the pre-test values between tests", () => {
		expect(process.env.OPENSPEC_TELEMETRY).toBe("1");
		expect(process.env.DO_NOT_TRACK).toBeUndefined();
	});
});
