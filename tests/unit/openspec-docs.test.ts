/**
 * docs/OPENSPEC.md and the RUNBOOK section must name the same pin as
 * scripts/openspec-setup.sh, and the operator doc must carry the load-bearing
 * commands and the rejection evidence. Doc-only: reads files, runs nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPENSPEC_SKILL_NAMES } from "../fixtures/openspec-skills.ts";
import { repoRoot } from "../helpers/git.ts";

const read = (...p: string[]) => readFileSync(join(repoRoot(), ...p), "utf8");

/** Tokens in `required` that `doc` does not contain. */
function missingTokens(doc: string, required: readonly string[]): string[] {
	return required.filter((t) => !doc.includes(t));
}

/** Parse the single pin constant from the setup script. */
function scriptVersion(): string {
	const m = /^OPENSPEC_VERSION="(\d+\.\d+\.\d+)"$/m.exec(read("scripts", "openspec-setup.sh"));
	if (!m) throw new Error("OPENSPEC_VERSION constant not found in scripts/openspec-setup.sh");
	return m[1] as string;
}

/** The Phase 12 section of the runbook, from its heading to the next H2 or end. */
function runbookPhase12(runbook: string): string {
	const start = runbook.indexOf("## Phase 12 — OpenSpec Opt-in Skill");
	if (start < 0) return "";
	const rest = runbook.slice(start + 3);
	const next = rest.search(/\n## /);
	return next < 0 ? rest : rest.slice(0, next);
}

/** True when `section` names `@fission-ai/openspec@<version>`. */
const namesPin = (section: string, version: string) => section.includes(`@fission-ai/openspec@${version}`);

describe("docs/OPENSPEC.md", () => {
	const doc = read("docs", "OPENSPEC.md");
	const v = scriptVersion();

	it("names the same pin as the setup script", () => {
		expect(namesPin(doc, v)).toBe(true);
	});

	it("carries the required commands, flags and evidence anchors", () => {
		const required = [
			`npm install -g --ignore-scripts @fission-ai/openspec@${v}`,
			"sh scripts/openspec-setup.sh --install-cli",
			"sh scripts/openspec-setup.sh --check",
			"sh scripts/openspec-setup.sh --uninstall",
			"disable-model-invocation: true",
			"OPENSPEC_TELEMETRY=0",
			"DO_NOT_TRACK=1",
			"OPENSPEC_NO_UPDATE_CHECK=1",
			"OPENSPEC_NO_AUTO_CONFIG=1",
			"/skill:openspec-",
			"/opsx-",
			"openspec-pi@0.2.1",
			"extensions/openspec.ts:243",
			"extensions/openspec.ts:201",
		];
		expect(missingTokens(doc, required)).toEqual([]);
	});

	it("names all twelve skills", () => {
		expect(missingTokens(doc, OPENSPEC_SKILL_NAMES)).toEqual([]);
	});

	it("negative control: a doc missing a required token is reported", () => {
		expect(missingTokens("nothing here", ["openspec-pi@0.2.1"])).toEqual(["openspec-pi@0.2.1"]);
	});
});
