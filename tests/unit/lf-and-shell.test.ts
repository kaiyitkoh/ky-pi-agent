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
 *   CONFORMANCE (partially here). Executing a script under `sh` does not prove
 *   it is POSIX `sh`: Git-for-Windows `sh` and macOS `/bin/sh` are both bash in
 *   POSIX mode, so `sh script.sh` passing proves only that bash-in-posix-mode
 *   accepted it. ShellCheck under `--shell=sh` is the full conformance gate and
 *   is preinstalled on ubuntu-24.04 only -- that is the `posix-lint` job in
 *   `.github/workflows/ci.yml`.
 *
 *   But `dash` IS a genuine POSIX shell rather than bash in a costume, and it
 *   ships with Git for Windows (`/usr/bin/dash`) and is `/bin/sh` itself on
 *   every Debian-family runner. `dash -n` therefore parses each script under a
 *   real `sh` grammar, which catches `local`, `echo -e`, `${var:offset:len}`,
 *   `$'…'`, `function f()`, arrays and `+=` -- none of which the four-pattern
 *   bashism regex below can see. That gate runs here. It is not a substitute
 *   for ShellCheck (a parse is not a lint: `dash -n` says nothing about
 *   unquoted expansions or BSD-vs-GNU flag differences), and it is not a fake
 *   local conformance check either -- it is a real POSIX parser giving a real
 *   verdict.
 *
 *   The `dash -n` cases SKIP when no `dash` is on the machine, which is the one
 *   place this file departs from the repo's usual throw-rather-than-skip rule.
 *   The reason is specific: macOS ships no `dash` at all, so throwing would
 *   turn the macos-latest leg red for a tool that platform has never had, and a
 *   red build nobody can fix is how a gate gets deleted. The resolution outcome
 *   is asserted and printed by its own always-running case, so a skip is
 *   visible rather than silent.
 *
 * Why bytes and not `grep -P` / `file`: neither behaves identically on Windows,
 * macOS and Linux. A Buffer byte comparison behaves identically everywhere.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

const ROOT = repoRoot();

/**
 * A real POSIX shell, if this machine has one.
 *
 * Ordered by specificity. `/usr/bin/dash` is where Git for Windows puts it;
 * `/bin/dash` is Debian/Ubuntu, where it is also `/bin/sh`; a bare `dash` picks
 * up a PATH install. Deliberately does NOT fall back to `sh` -- the entire
 * point is that `sh` is bash in POSIX mode on both platforms this project
 * targets, so accepting it would turn a real gate into a tautology.
 */
export function resolvePosixShell(): string | undefined {
	for (const candidate of ["/usr/bin/dash", "/bin/dash", "dash"]) {
		const probe = spawnSync(candidate, ["-c", ":"], { encoding: "utf-8", windowsHide: true });
		if (!probe.error && probe.status === 0) {
			return candidate;
		}
	}
	return undefined;
}

const POSIX_SHELL = resolvePosixShell();

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
 *   `typeset`   ksh/bash builtin; dash has none.
 *   `local`     not in POSIX (shellcheck SC3043); dash accepts it, other `sh`
 *               implementations do not, and the header of `bin/bootstrap.sh`
 *               forbids it outright.
 *   `${v^^}`    bash-4 case modification; a syntax error on bash 3.2.
 *   `${v,,}`    same.
 *
 * `declare`, `typeset` and `local` are invisible to `dash -n` below: a parse
 * does not resolve builtins, so `dash -n` exits 0 on all three while
 * `sh bin/bootstrap.sh` would die with `declare: not found` on the ubuntu CI
 * leg, where /bin/sh IS dash. This table is therefore the only offline gate
 * that sees them, and the reason they are listed here rather than left to
 * shellcheck (ubuntu-only in CI, and not installed on the Windows dev box).
 * They are anchored to statement position so prose in a comment or the word
 * "local" inside a string cannot trip them.
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
	{
		label: "declare / typeset (bash builtin; dash has neither)",
		pattern: /^[ \t]*(declare|typeset)[ \t]+/m,
	},
	{ label: "local (not POSIX; shellcheck SC3043)", pattern: /^[ \t]*local[ \t]+/m },
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
		expect(findBashisms("declare x=1\n")).toContain(
			"declare / typeset (bash builtin; dash has neither)",
		);
		expect(findBashisms("typeset -A m\n")).toContain(
			"declare / typeset (bash builtin; dash has neither)",
		);
		expect(findBashisms("f() {\n\tlocal x=1\n}\n")).toContain(
			"local (not POSIX; shellcheck SC3043)",
		);
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
		// `local` / `declare` are anchored to statement position, so prose and
		// string contents must not trip them -- the same disable-the-lint risk.
		expect(findBashisms("# no local variables here\n")).toEqual([]);
		expect(findBashisms('  echo "a local copy"\n')).toEqual([]);
		expect(findBashisms("# we declare nothing\n")).toEqual([]);
		// …but the class exclusion must not blind it to the real keyword.
		expect(findBashisms('if [[ "$a" == "$b" ]]; then :; fi')).toContain(
			"[[ ... ]] double-bracket test",
		);
	});
});

describe("BOOT-06 -- every shipped script parses under a REAL POSIX shell", () => {
	it("reports whether a real POSIX shell was found (a skip must be visible)", () => {
		// This case always runs. Without it, `dash` silently vanishing from the
		// machine would turn the whole block below into skipped-and-green, which
		// is the same false assurance as having no gate. On Windows and on any
		// Debian-family runner this must resolve; only macOS legitimately cannot.
		if (POSIX_SHELL === undefined) {
			expect(
				process.platform,
				"no dash found. Windows (Git for Windows ships /usr/bin/dash) and Linux " +
					"(dash IS /bin/sh) both have one, so its absence there is a broken " +
					"environment, not a portability fact. Install dash rather than " +
					"accepting the skip.",
			).toBe("darwin");
			return;
		}
		expect(POSIX_SHELL).toMatch(/dash/);
	});

	for (const rel of shellScripts) {
		it.skipIf(POSIX_SHELL === undefined)(
			`${rel} parses under dash, not merely under bash-in-posix-mode`,
			() => {
				const result = spawnSync(POSIX_SHELL as string, ["-n", join(ROOT, rel)], {
					encoding: "utf-8",
					windowsHide: true,
				});
				expect(result.error, `${POSIX_SHELL} failed to run`).toBeUndefined();
				expect(
					result.status,
					`${rel} is not POSIX sh. ${POSIX_SHELL} said:\n${result.stderr}\n` +
						"Git-Bash `sh` and macOS /bin/sh are bash in POSIX mode and will " +
						"happily accept constructs dash rejects; dash is the arbiter here.",
				).toBe(0);
			},
		);
	}

	it.skipIf(POSIX_SHELL === undefined)(
		"rejects a bashism the four-pattern regex cannot see (the gate is live)",
		() => {
			// A parse gate that only ever sees valid input has never demonstrated
			// that it can fail. `function f() { ... }` is a ksh/bash function
			// definition, is a syntax error in POSIX sh, and matches none of the
			// BASHISMS patterns above -- which is precisely why this gate is worth
			// having alongside them.
			const dir = mkdtempSync(join(tmpdir(), "kypi-dash-"));
			try {
				const bad = join(dir, "bashism.sh");
				writeFileSync(bad, "#!/bin/sh\nfunction greet() {\n  echo hi\n}\ngreet\n", "utf-8");
				const rejected = spawnSync(POSIX_SHELL as string, ["-n", bad], {
					encoding: "utf-8",
					windowsHide: true,
				});
				expect(
					rejected.status,
					`${POSIX_SHELL} accepted \`function f() { … }\`, so it is not behaving as a ` +
						"POSIX shell and this gate proves nothing",
				).not.toBe(0);
				expect(findBashisms("function greet() {\n  echo hi\n}\n")).toEqual([]);

				// …and accepts the POSIX spelling of the same thing, so the gate is
				// not simply rejecting everything.
				const good = join(dir, "posix.sh");
				writeFileSync(good, "#!/bin/sh\ngreet() {\n  echo hi\n}\ngreet\n", "utf-8");
				const accepted = spawnSync(POSIX_SHELL as string, ["-n", good], {
					encoding: "utf-8",
					windowsHide: true,
				});
				expect(accepted.status, accepted.stderr).toBe(0);
			} finally {
				rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
			}
		},
	);
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
