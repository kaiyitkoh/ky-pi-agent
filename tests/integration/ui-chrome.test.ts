import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { createHeaderComponent, formatHeaderLines } from "../../.pi/extensions/ui/header.ts";

const identityFg = (_color: string, text: string): string => text;

describe("header", () => {
	it("renders the title and hint lines", () => {
		const lines = formatHeaderLines(
			{ harnessVersion: "0.1.0", piVersion: "1.1.0", mode: "cheap", escalated: false, interruptKey: "esc" },
			identityFg,
		);
		expect(lines).toEqual(["ky-pi-agent 0.1.0 · pi 1.1.0 · cheap", "/ commands · ! bash · esc interrupt"]);
	});

	it("omits a missing harness version and marks escalation", () => {
		const lines = formatHeaderLines(
			{ piVersion: "1.1.0", mode: "max", escalated: true, interruptKey: "esc" },
			identityFg,
		);
		expect(lines[0]).toBe("ky-pi-agent · pi 1.1.0 · max↑");
	});

	it("never lets an escape sequence in the mode reach the output", () => {
		const lines = formatHeaderLines({ piVersion: "1.1.0", mode: "\u001b[31mred\u001b[0m" }, identityFg);
		expect(lines.join("\n")).not.toContain("\u001b");
		expect(lines[0]).toContain("red");
	});

	it("truncates to the width and reflects live info on the next render", () => {
		let info: { mode: string; escalated: boolean } = { mode: "cheap", escalated: false };
		const component = createHeaderComponent(() => ({ piVersion: "1.1.0", ...info }), { fg: identityFg });
		const first = component.render(20);
		expect(first.length).toBe(2);
		for (const line of first) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
		info = { mode: "max", escalated: true };
		expect(component.render(80)[0]).toContain("max↑");
	});
});
