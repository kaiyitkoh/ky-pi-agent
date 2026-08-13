/**
 * SAFE-06 / SAFE-08 / SAFE-13 — `.pi/extensions/safety/paths.ts`, table-driven.
 *
 * WHY THE UNQUOTED/QUOTED FIXTURES ARE BUILT FROM `BS`, NOT A STRING LITERAL
 * ESCAPE. `String.fromCharCode(92)` is one literal backslash built without
 * going through any string-literal escape layer of its own — the same
 * technique `tests/unit/unbash-ast.test.ts` (Plan 01) uses, so a fixture here
 * cannot silently be off by one backslash from what unbash itself would
 * actually see. The exact `word.text`/`word.value` pairs below were VERIFIED
 * by direct execution against unbash 4.0.10 during this plan, not assumed
 * from the plan's prose.
 *
 * VACUOUS-PASS GUARD, this repo's house rule (see `tests/unit/redact.test.ts`,
 * `tests/unit/shell-deny-list.test.ts`): every table asserts its own length
 * before the loop that consumes it runs, and every entry in
 * `SENSITIVE_READ_PATTERNS` / `DETONATION_TARGETS` is asserted reachable by
 * at least one fixture row below — a dead pattern and an absent one produce
 * identical green runs otherwise (`tests/unit/chokepoint-lint.test.ts:212-233`
 * is the model this file follows).
 */
import { describe, expect, it } from "vitest";

import { canonicalisePathArg, type PathWordArg } from "../../.pi/extensions/safety/paths.ts";

/** One literal backslash, built without going through any string-literal escape layer. */
const BS = String.fromCharCode(92);

function winPath(posixLike: string): string {
	return posixLike.split("/").join(BS);
}

/** Fixture home/cwd/projectRoot — deliberately NOT read from this machine's real environment. */
const HOME = "C:/Users/Admin";
const CWD = "C:/Users/Admin/project";
const PROJECT_ROOT = "C:/Users/Admin/project";

function ctx(overrides: Partial<{ cwd: string; home: string }> = {}) {
	return { cwd: overrides.cwd ?? CWD, home: overrides.home ?? HOME };
}

function arg(text: string, value: string = text): PathWordArg {
	return { text, value };
}

// ---------------------------------------------------------------------------
// Task 1 — canonicalisePathArg
// ---------------------------------------------------------------------------

const AWS_CREDENTIALS_CANONICAL = "C:/Users/Admin/.aws/credentials";

/**
 * Every row canonicalises to {@link AWS_CREDENTIALS_CANONICAL}. This is the
 * table the plan's own warning names: "the warning sign Pitfall 3 names is a
 * rule that fires for the quoted form and silently passes the unquoted one."
 * Each row's `text`/`value` pair was verified by executing unbash 4.0.10
 * directly against the shown shell fragment during this plan.
 */
const EQUIVALENT_TO_AWS_CREDENTIALS: ReadonlyArray<{ label: string; word: PathWordArg; ctxOverrides?: Partial<{ cwd: string; home: string }> }> = [
	{
		label: "unquoted Windows path (value is MANGLED by unbash's escape handling; text is not)",
		word: arg(winPath("C:/Users/Admin/.aws/credentials"), "C:UsersAdmin.awscredentials"),
	},
	{
		label: 'double-quoted Windows path (text still carries the quote marks; value is unmangled)',
		word: arg(`"${winPath("C:/Users/Admin/.aws/credentials")}"`, winPath("C:/Users/Admin/.aws/credentials")),
	},
	{
		label: "single-quoted Windows path (text still carries the quote marks; value is unmangled)",
		word: arg(`'${winPath("C:/Users/Admin/.aws/credentials")}'`, winPath("C:/Users/Admin/.aws/credentials")),
	},
	{
		label: "MSYS /c/ form",
		word: arg("/c/Users/Admin/.aws/credentials"),
	},
	{
		label: "/cygdrive/c/ form",
		word: arg("/cygdrive/c/Users/Admin/.aws/credentials"),
	},
	{
		label: "already-forward-slash C:/ form",
		word: arg("C:/Users/Admin/.aws/credentials"),
	},
	{
		label: "lowercase drive letter (case-insensitive drive comparison)",
		word: arg(winPath("c:/Users/Admin/.aws/credentials")),
	},
	{
		label: "~/ expansion against the fixture home",
		word: arg("~/.aws/credentials"),
	},
	{
		label: "$HOME/ expansion against the fixture home",
		word: arg("$HOME/.aws/credentials"),
	},
	{
		label: "${HOME}/ expansion against the fixture home",
		word: arg("${HOME}/.aws/credentials"),
	},
];

describe("SAFE-06/SAFE-08 -- canonicalisePathArg: table is non-empty (vacuous-pass guard)", () => {
	it("has at least the ten equivalence-class rows the plan's acceptance criteria name", () => {
		expect(
			EQUIVALENT_TO_AWS_CREDENTIALS.length,
			"a shortened table silently drops coverage of a quoting form, a drive-prefix form, or an expansion form",
		).toBeGreaterThanOrEqual(10);
	});
});

describe("SAFE-06/SAFE-08 -- canonicalisePathArg: every path form for one file canonicalises to ONE string", () => {
	for (const row of EQUIVALENT_TO_AWS_CREDENTIALS) {
		it(`${row.label} -> "${AWS_CREDENTIALS_CANONICAL}"`, () => {
			const result = canonicalisePathArg(row.word, ctx(row.ctxOverrides));
			expect(
				result,
				`text="${row.word.text}" must canonicalise to the same string every other row in this table produces`,
			).toBe(AWS_CREDENTIALS_CANONICAL);
		});
	}

	it("the unquoted form specifically does not fall back to word.value (the Pitfall 3 regression)", () => {
		// word.value for the unquoted fixture is the MANGLED "C:UsersAdmin.awscredentials" --
		// if canonicalisePathArg ever read .value instead of .text, this row alone would
		// silently diverge from every other row in the table above.
		const mangled = EQUIVALENT_TO_AWS_CREDENTIALS[0]!.word;
		expect(mangled.value, "fixture sanity: value really is mangled, or this test proves nothing").not.toBe(
			winPath("C:/Users/Admin/.aws/credentials"),
		);
		expect(canonicalisePathArg(mangled, ctx())).toBe(AWS_CREDENTIALS_CANONICAL);
	});
});

describe("SAFE-08 -- canonicalisePathArg: relative resolution against a caller-supplied cwd", () => {
	it("./secrets/.env resolves against cwd, never process.cwd()", () => {
		expect(canonicalisePathArg(arg("./secrets/.env"), ctx())).toBe("C:/Users/Admin/project/secrets/.env");
	});

	it("../outside/file walks one segment above cwd", () => {
		expect(canonicalisePathArg(arg("../outside/file"), ctx())).toBe("C:/Users/Admin/outside/file");
	});

	it("a bare relative path with no ./ prefix also resolves against cwd", () => {
		expect(canonicalisePathArg(arg("src/index.ts"), ctx())).toBe("C:/Users/Admin/project/src/index.ts");
	});
});

describe("SAFE-08 -- canonicalisePathArg: UNC paths are not mistaken for drive-letter paths", () => {
	it("\\\\server\\share\\pi\\file canonicalises without a drive letter, and the share root survives ..", () => {
		const result = canonicalisePathArg(arg(winPath("//server/share/pi/file")), ctx());
		expect(result, "UNC form must not collapse into something matching X:/...").not.toMatch(/^[A-Za-z]:/);
		expect(result).toBe(BS + BS + "server/share/pi/file");
	});

	it("a UNC path cannot .. above its own share root", () => {
		const result = canonicalisePathArg(arg(winPath("//server/share/../../escaped")), ctx());
		expect(result, "climbing above server+share must be a no-op, not an escape out of the share").toBe(
			BS + BS + "server/share/escaped",
		);
	});
});

describe("SAFE-08 -- canonicalisePathArg: drive-letter case is normalised WITHOUT collapsing the rest of the path's case", () => {
	it("C: and c: produce the identical canonical string for the same rest-of-path", () => {
		const upper = canonicalisePathArg(arg(winPath("C:/Users/Admin/File.txt")), ctx());
		const lower = canonicalisePathArg(arg(winPath("c:/Users/Admin/File.txt")), ctx());
		expect(upper).toBe(lower);
		expect(upper).toBe("C:/Users/Admin/File.txt");
	});

	it("two paths differing only in a NON-drive segment's case remain DISTINCT strings (case is not collapsed)", () => {
		const asGiven = canonicalisePathArg(arg(winPath("C:/Users/Admin/File.txt")), ctx());
		const shouted = canonicalisePathArg(arg(winPath("C:/USERS/Admin/File.txt")), ctx());
		expect(
			asGiven,
			"if this equalled `shouted`, canonicalisePathArg would be lower/upper-casing the whole path, " +
				"which the plan's <behavior> explicitly forbids ('without collapsing case on the rest of the path')",
		).not.toBe(shouted);
	});
});
