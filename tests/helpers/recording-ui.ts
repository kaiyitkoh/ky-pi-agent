import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";

export type RecordedUICall = {
	method: "setStatus" | "setWidget" | "setHeader" | "setFooter" | "setTitle" | "notify";
	key?: string;
	value: unknown;
};

const identity = (...args: unknown[]): string => String(args[args.length - 1]);

/** Builds an ExtensionUIContext that records chrome calls so a test can assert on them with ctx.hasUI true. */
export function createRecordingUI(): {
	ui: ExtensionUIContext;
	calls: RecordedUICall[];
	statuses(key: string): (string | undefined)[];
	lastHeaderFactory(): unknown;
} {
	const calls: RecordedUICall[] = [];
	// A plain value, not a getter: Pi's prompt wrapper spreads the ui object, which would drop a getter.
	const theme = {
		fg: identity,
		bg: identity,
		bold: identity,
		italic: identity,
		underline: identity,
		dim: identity,
		strikethrough: identity,
		inverse: identity,
	} as unknown as Theme;

	const ui: ExtensionUIContext = {
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
		editor: async () => undefined,
		notify: (message, type) => {
			calls.push({ method: "notify", key: type, value: message });
		},
		onTerminalInput: () => () => {},
		setStatus: (key, text) => {
			calls.push({ method: "setStatus", key, value: text });
		},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: (key: string, content: unknown) => {
			calls.push({ method: "setWidget", key, value: content });
		},
		setFooter: (factory) => {
			calls.push({ method: "setFooter", value: factory });
		},
		setHeader: (factory) => {
			calls.push({ method: "setHeader", value: factory });
		},
		setTitle: (title) => {
			calls.push({ method: "setTitle", value: title });
		},
		custom: async () => undefined as never,
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		theme,
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};

	return {
		ui,
		calls,
		statuses: (key) =>
			calls
				.filter((c) => c.method === "setStatus" && c.key === key)
				.map((c) => c.value as string | undefined),
		lastHeaderFactory: () => [...calls].reverse().find((c) => c.method === "setHeader")?.value,
	};
}
