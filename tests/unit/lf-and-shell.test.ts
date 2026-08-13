/**
 * BOOT-06, local half: line endings and macOS portability.
 *
 * BOOT-06 has two halves and only one of them can be asserted here.
 *
 *   LINE ENDINGS (this file). A shell script checked out with CRLF fails on
 *   macOS with a misleading `bad interpreter: /bin/sh^M` error. `.gitattributes`
 *   (`* text=auto eol=lf`) is the fix -- proven on this machine to win even with
 *   `core.autocrlf=true` set locally [RESEARCH.md 4.1, executed 2026-08-13, git
 *   2.54.0.windows.1]. This test is the PROOF, not the remedy: it reads the
 *   working-tree bytes and fails if any CR survived. The same scan runs on both
 *   CI matrix legs, because the platform that could break it is the platform
 *   that must assert it.
 *
 *   PORTABILITY (this file, partially). macOS runners ship bash 3.2.57 and BSD
 *   userland [CITED: actions/runner-images macos-15-arm64-Readme.md]. The
 *   constructs that die there -- `[[`, `sort -V`, `declare -A`, `${v^^}` -- are
 *   asserted absent.
 *
 *   CONFORMANCE (NOT here, and it cannot be). Executing a script does not prove
 *   it is POSIX `sh`: Git-for-Windows `sh` and macOS `/bin/sh` are both bash in
 *   POSIX mode, so `sh script.sh` passing proves only that bash-in-posix-mode
 *   accepted it. ShellCheck under `--shell=sh` is what proves conformance, and
 *   it is preinstalled on ubuntu-24.04 only. That is the `posix-lint` job in
 *   `.github/workflows/ci.yml`, and it is deliberately not simulated here --
 *   a fake local conformance check would be worse than none.
 *
 * Why bytes and not `grep -P` / `file`: neither behaves identically on Windows,
 * macOS and Linux. A Buffer byte comparison behaves identically everywhere.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

const ROOT = repoRoot();

/** ASCII carriage return. The single byte that breaks a script on macOS. */
const CR = 0x0d;

/** True when the buffer holds a CR byte anywhere. */
export function hasCarriageReturn(bytes: Buffer): boolean {
	return bytes.includes(CR);
}

/**
 * Constructs that are valid bash-4/GNU and are NOT valid on a macOS runner.
 *
 * Deliberately narrow. Every entry is something observed to break on bash 3.2
 * or BSD userland, not a stylistic preference:
 *
 *   `[[`        bash/ksh keyword; `sh` has only `[`.
 *   `sort -V`   GNU version sort; absent on BSD sort.
 *   `declare`   bash builtin; `sh` has none. `-A` additionally needs bash 4.
 *   `${v^^}`    bash-4 case modification; a syntax error on bash 3.2.
 *   `${v,,}`    same.
 *
 * The `[[` pattern excludes a following `:`, because `[[:space:]]`, `[[:alpha:]]`
 * and friends are POSIX bracket-expression character classes -- fully portable,
 * and the correct way to write a whitespace class in a portable `grep` BRE. The
 * naive `/\[\[/` flagged `grep -v '^[[:space:]]*ignore-scripts'` in
 * `bin/bootstrap.sh` as a bashism, which is precisely the kind of false positive
 * that gets a lint disabled rather than fixed.
 *
 * A shell script legitimately needing any of these is a script that must
 * declare `#!/bin/bash` and be excluded from the POSIX guarantee -- at which
 * point the shebang assertion below goes red first, which is the desired order.
 */
const BASHISMS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
	{ label: "[[ ... ]] double-bracket test", pattern: /\[\[(?!:)/ },
	{ label: "sort -V (GNU version sort, absent on BSD)", pattern: /\bsort\s+-V\b/ },
	{ label: "declare -A (bash 4 associative array)", pattern: /\bdeclare\s+-A\b/ },
	{ label: "${v^^} / ${v,,} bash 4 case modification", pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*(\^\^|,,)/ },
];

/** Every bashism label found in `text`. Empty means portable. */
export function findBashisms(text: string): string[] {
	return BASHISMS.filter((b) => b.pattern.test(text)).map((b) => b.label);
}

const shellScripts = trackedFiles("*.sh");

describe("BOOT-06 -- the tracked shell-script set", () => {
	it("is non-empty and holds both shipped scripts", () => {
		// A scan over an empty set passes vacuously, which is the failure mode
		// this whole file exists to avoid. Naming the two known scripts means a
		// pathspec that silently stops matching goes red instead of green.
		expect(shellScripts.length).toBeGreaterThanOrEqual(2);
		expect(shellScripts).toContain("bin/bootstrap.sh");
		expect(shellScripts).toContain("scripts/check-gh-unauthenticated.sh");
	});
});

describe("BOOT-06 -- no CR byte survives checkout", () => {
	for (const rel of shellScripts) {
		it(`${rel} contains no carriage return`, () => {
			const bytes = readFileSync(join(ROOT, rel));
			expect(bytes.length, `${rel} is empty`).toBeGreaterThan(0);
			expect(
				hasCarriageReturn(bytes),
				`${rel} contains a CR byte in the WORKING TREE. On macOS this fails as ` +
					"`bad interpreter: /bin/sh^M`. The remedy is .gitattributes (`*.sh text eol=lf`) " +
					"plus a fresh checkout -- never a git config change on one machine.",
			).toBe(false);
		});
	}

	it("detects a CR when one is present (the assertion is live)", () => {
		// Proven against a synthetic buffer rather than by mutating a tracked
		// file: a test that only ever sees clean input has never demonstrated
		// that it can fail.
		expect(hasCarriageReturn(Buffer.from("#!/bin/sh\necho hi\n", "utf-8"))).toBe(false);
		expect(hasCarriageReturn(Buffer.from("#!/bin/sh\r\necho hi\r\n", "utf-8"))).toBe(true);
		expect(hasCarriageReturn(Buffer.from([0x61, CR, 0x62]))).toBe(true);
	});
});

describe("BOOT-06 -- every shipped script is POSIX sh, not bash", () => {
	for (const rel of shellScripts) {
		it(`${rel} declares #!/bin/sh`, () => {
			const text = readFileSync(join(ROOT, rel), "utf-8");
			expect(
				text.startsWith("#!/bin/sh\n"),
				`${rel} must open with the exact line \`#!/bin/sh\`; ` +
					`found: ${JSON.stringify(text.slice(0, 20))}`,
			).toBe(true);
		});

		it(`${rel} uses no bash-4 or GNU-only construct`, () => {
			const found = findBashisms(readFileSync(join(ROOT, rel), "utf-8"));
			expect(
				found,
				`${rel} uses ${found.join(", ")} -- the macOS runner is bash 3.2 with BSD userland`,
			).toEqual([]);
		});
	}

	it("flags each bashism when it is present (the assertion is live)", () => {
		expect(findBashisms('if [ -n "$x" ]; then :; fi')).toEqual([]);
		expect(findBashisms('if [[ -n "$x" ]]; then :; fi')).toContain("[[ ... ]] double-bracket test");
		expect(findBashisms("printf '%s\\n' \"$v\" | sort -V")).toContain(
			"sort -V (GNU version sort, absent on BSD)",
		);
		expect(findBashisms("declare -A map")).toContain("declare -A (bash 4 associative array)");
		expect(findBashisms('echo "${name^^}"')).toContain(
			"${v^^} / ${v,,} bash 4 case modification",
		);
		expect(findBashisms('echo "${name,,}"')).toContain(
			"${v^^} / ${v,,} bash 4 case modification",
		);
		// Near-misses that must NOT trip it, or the lint becomes noise someone
		// disables: a bracket expression inside a case pattern, a plain parameter
		// expansion, and POSIX bracket-expression character classes -- which open
		// with a literal `[[` and are the portable way to write a whitespace class.
		expect(findBashisms('case "$p" in [A-Za-z]:*) : ;; esac')).toEqual([]);
		expect(findBashisms('echo "${out#*error}"')).toEqual([]);
		expect(findBashisms("grep -v '^[[:space:]]*ignore-scripts[[:space:]]*='")).toEqual([]);
		expect(findBashisms("sed 's/[[:alpha:]][[:digit:]]//'")).toEqual([]);
		// …but the class exclusion must not blind it to the real keyword.
		expect(findBashisms('if [[ "$a" == "$b" ]]; then :; fi')).toContain(
			"[[ ... ]] double-bracket test",
		);
	});
});

describe("BOOT-06 -- .gitattributes is what makes the byte assertion hold", () => {
	// The byte scan above reads THIS machine's working tree. It stays true on a
	// fresh clone only because of these rules, so assert the rules exist rather
	// than reimplementing their semantics.
	const attributes = readFileSync(join(ROOT, ".gitattributes"), "utf-8");

	it("normalises every text file to LF", () => {
		expect(attributes).toMatch(/^\*\s+text=auto\s+eol=lf\s*$/m);
	});

	it("pins *.sh to LF explicitly", () => {
		const shRule = attributes
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line.startsWith("*.sh"));
		expect(shRule, ".gitattributes has no `*.sh` rule").toBeDefined();
		expect(shRule).toContain("eol=lf");
	});
});
