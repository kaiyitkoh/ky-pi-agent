/**
 * 08.1 review fixes -- CR-01 / WR-01 / WR-02 / WR-04.
 *
 * CR-01: the safety guard parses bg_run commands as bash, so the vendored background-tasks shell
 * policy must EXECUTE bash on win32 by default (it used to be cmd.exe). These cases fail on the
 * old behaviour (`resolveShellPolicy("win32", {})` yielded the cmd dialect).
 */
import { describe, expect, it } from "vitest";

import { resolveShellPolicy } from "../../.pi/extensions/background-tasks/src/core/common.ts";
import { redactSecrets } from "../../.pi/extensions/safety/audit.ts";
import { bgShellProblem, guardBgRun } from "../../.pi/extensions/safety/index.ts";

const ctx = { cwd: process.cwd() } as Parameters<typeof guardBgRun>[1];

describe("CR-01 -- executed bg shell matches the parsed (bash) dialect", () => {
	it("win32 with no env defaults to bash, not cmd", () => {
		let dialect: string;
		try {
			dialect = resolveShellPolicy("win32", {}).dialect;
		} catch (err) {
			// No Git Bash found on this machine: failing closed is acceptable; cmd is not.
			expect(String(err)).not.toMatch(/cmd/i);
			return;
		}
		expect(dialect).toBe("bash");
	});

	it("an explicit PI_BG_SHELL=cmd still resolves to cmd (so the guard has something to deny)", () => {
		expect(resolveShellPolicy("win32", { PI_BG_SHELL: "cmd" }).dialect).toBe("cmd");
	});
});

describe("CR-01 -- guard fails closed when the bg shell is not bash/POSIX", () => {
	it("win32: explicit cmd is a problem, default and bash are not", () => {
		expect(bgShellProblem("win32", { PI_BG_SHELL: "cmd" })).toBeDefined();
		expect(bgShellProblem("win32", {})).toBeUndefined();
		expect(bgShellProblem("win32", { PI_BG_SHELL: "bash" })).toBeUndefined();
	});
	it("posix: fish is a problem, bash is not", () => {
		expect(bgShellProblem("linux", { SHELL: "/usr/bin/fish" })).toBeDefined();
		expect(bgShellProblem("linux", { SHELL: "/bin/bash" })).toBeUndefined();
	});
});

describe("WR-01/WR-02 -- guardBgRun", () => {
	it("blocks isAgent true and non-boolean isAgent", () => {
		expect(guardBgRun({ command: "echo ok", isAgent: true }, ctx).kind).toBe("block");
		expect(guardBgRun({ command: "echo ok" }, ctx).kind).toBe("block");
	});
	it("blocks a missing command", () => {
		expect(guardBgRun({ isAgent: false }, ctx).kind).toBe("block");
	});
	it("blocks a protected-branch push, allows echo", () => {
		expect(guardBgRun({ command: "git push origin main", isAgent: false }, ctx).kind).toBe("block");
		expect(guardBgRun({ command: "echo ok", isAgent: false }, ctx).kind).toBe("allow");
	});
});

describe("WR-04 -- audit redaction", () => {
	it("redacts credential values but keeps the command shape", () => {
		const out = redactSecrets(
			'curl -H "Authorization: Bearer abcdef123456" -d token=hunter2 AKIAABCDEFGHIJKLMNOP sk-abcdefghijklmnop1234',
		);
		expect(out).not.toMatch(/abcdef123456|hunter2|AKIAABCDEFGHIJKLMNOP|sk-abcdefghijklmnop1234/);
		expect(out).toContain("curl");
	});
	it("leaves ordinary commands untouched", () => {
		expect(redactSecrets("git status --short")).toBe("git status --short");
	});
});
