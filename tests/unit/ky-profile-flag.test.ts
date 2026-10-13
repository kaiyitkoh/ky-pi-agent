/**
 * An unknown --ky-profile value still falls back to implement, but says so instead of failing silently.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import routing from "../../.pi/extensions/routing/index.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

function startWith(flag: unknown, hasUI: boolean): { notes: [string, string][]; active: string[] } {
	const handlers = new Map<string, Handler>();
	let active = ["read", "bash", "edit", "write", "qoder_delegate"];
	const pi = {
		registerCommand: () => {},
		registerFlag: () => {},
		on: (name: string, handler: Handler) => handlers.set(name, handler),
		getFlag: () => flag,
		getActiveTools: () => active,
		setActiveTools: (next: string[]) => {
			active = next;
		},
	} as unknown as ExtensionAPI;
	routing(pi);
	const notes: [string, string][] = [];
	const ctx = {
		hasUI,
		ui: { notify: (message: string, level: string) => notes.push([message, level]) },
		sessionManager: { getBranch: () => [] },
	};
	handlers.get("session_start")!({ type: "session_start", reason: "startup" }, ctx);
	return { notes, active };
}

describe("--ky-profile validation", () => {
	it("warns on an unknown value and still applies implement", () => {
		const { notes, active } = startWith("ful", true);
		expect(notes).toEqual([['unknown --ky-profile "ful"; using implement', "warning"]]);
		expect(active).not.toContain("qoder_delegate");
	});

	it("is case-sensitive: Full is unknown", () => {
		expect(startWith("Full", true).notes).toHaveLength(1);
	});

	it("stays quiet for a known value or no flag", () => {
		expect(startWith("full", true).notes).toEqual([]);
		expect(startWith(undefined, true).notes).toEqual([]);
	});

	it("does not touch the UI without one", () => {
		expect(startWith("ful", false).notes).toEqual([]);
	});
});
