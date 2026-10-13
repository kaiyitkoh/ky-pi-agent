/**
 * Line endings and macOS portability for tracked shell scripts. A CRLF script fails on macOS with `bad interpreter`,
 * so working-tree bytes are scanned for CR. Bash-4/GNU constructs that die on macOS bash 3.2 or BSD userland are
 * asserted absent. `dash -n` parses each script under a real POSIX grammar (sh is bash in POSIX mode on both
 * targets); it skips only where no dash exists (macOS), and its resolution is reported by an always-running case.
 * ShellCheck in CI is the full conformance gate.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

const ROOT = repoRoot();

/** A real POSIX shell, if present; never falls back to `sh`, which is bash in POSIX mode on both targets. */
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
 * Constructs valid in bash 4/GNU but broken on a macOS runner, or (declare, typeset, local) invisible to `dash -n`
 * yet fatal where /bin/sh is dash. Anchored to statement position so prose cannot trip them. The `[[` pattern skips
 * `[[:class:]]`, a portable POSIX bracket expression. A script that needs any of these must declare `#!/bin/bash`.
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
		// Naming the known scripts makes a pathspec that stops matching fail rather than pass vacuously.
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
		// A synthetic buffer proves the scan can fail, without mutating a tracked file.
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
		// Near-misses that must not trip it, including POSIX character classes, which open with a literal `[[`.
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
		// Always runs, so dash vanishing cannot turn the block below into skipped-and-green; only macOS may lack it.
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
			// `function f() { ... }` is invalid POSIX sh and matches no BASHISMS pattern, so this proves the gate can fail.
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
	// The byte scan holds on a fresh clone only because of these rules, so assert they exist.
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
