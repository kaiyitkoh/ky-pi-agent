// Loaded only by tests/integration/load-paths.test.ts to prove a factory failure is reported.
export default function brokenExtension(): never {
	throw new Error("broken-extension fixture: factory failure");
}
