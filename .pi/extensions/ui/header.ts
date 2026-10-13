import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { type Fg, sanitizeLabel } from "./statusline.ts";

export interface HeaderInfo {
	harnessVersion?: string;
	piVersion?: string;
	mode?: string;
	escalated?: boolean;
	interruptKey?: string;
}

/** Two lines: identity and route on the first, a dim keybinding hint on the second. */
export function formatHeaderLines(info: HeaderInfo, fg: Fg): string[] {
	const sep = fg("dim", " · ");
	const parts: string[] = [];
	const harnessVersion = sanitizeLabel(info.harnessVersion, 16);
	parts.push(fg("accent", harnessVersion === undefined ? "ky-pi-agent" : `ky-pi-agent ${harnessVersion}`));
	const piVersion = sanitizeLabel(info.piVersion, 16);
	if (piVersion !== undefined) parts.push(fg("muted", `pi ${piVersion}`));
	const mode = sanitizeLabel(info.mode, 12);
	if (mode !== undefined) parts.push(fg("accent", mode) + (info.escalated ? fg("warning", "↑") : ""));

	const key = sanitizeLabel(info.interruptKey, 12) ?? "esc";
	return [parts.join(sep), fg("dim", `/ commands · ! bash · ${key} interrupt`)];
}

/** Reads info on every render so a mode change shows without rebuilding the header. */
export function createHeaderComponent(getInfo: () => HeaderInfo, theme: { fg: Fg }): Component {
	return {
		render: (width: number) => formatHeaderLines(getInfo(), theme.fg).map((line) => truncateToWidth(line, width)),
		invalidate: () => {},
	};
}
