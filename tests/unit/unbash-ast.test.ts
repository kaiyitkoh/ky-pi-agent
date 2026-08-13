/**
 * SAFE-02 / SAFE-03 -- the unbash AST vocabulary, proven by execution.
 *
 * WHY THIS FILE IS A CHARACTERISATION TEST, NOT A UNIT TEST OF OUR CODE. There
 * is no `shell.ts` yet -- this is Wave 0. Every fact below is a fact about the
 * THIRD-PARTY PARSER: when `unbash` moves (it ships every few days per
 * CLAUDE.md), this file goes red first and names exactly which fact died,
 * before a single line of policy code has to take the blame.
 *
 * WHY "errors.length === 0" MATTERS AT ALL. `04-RESEARCH.md` Pattern 1 is the
 * phase's central finding: `unbash` is a TOLERANT parser. `git $(echo push)`,
 * `nohup git push &`, `sh -c "git push"` and friends all parse with no error --
 * proven below -- which is exactly why SAFE-03's fail-closed mechanism cannot
 * be "deny on parse error." It must be "deny on the PRESENCE of specific AST
 * node types," and this file is the executed proof of the vocabulary that
 * predicate will be written against.
 *
 * ONE CORRECTION TO 04-RESEARCH.md, RECORDED HERE RATHER THAN SILENTLY FIXED:
 * the research document's code examples write `errors.length === 0` as though
 * `errors` were always an array. Executed against unbash 4.0.10, a clean parse
 * returns `errors: undefined`, not `errors: []` -- `ParsedScript.errors` is
 * declared `ParseError[] | undefined` in `dist/types.d.ts`. Every assertion
 * below reads `(script.errors ?? []).length`, which is correct for both shapes
 * and is the form Plan 03's deny predicate must also use.
 *
 * VACUOUS-PASS GUARD, this repo's house rule (see tests/unit/redact.test.ts's
 * own docstring): every fixture table below asserts its own length against the
 * count this file's own docstring/acceptance criteria claim, BEFORE the loop
 * that consumes it runs. A table emptied by a bad merge must fail loudly.
 */
import { parse } from "unbash";
import type { ParsedScript, Statement, Word } from "unbash";

import { describe, expect, it } from "vitest";

/** One literal backslash, built without going through any string-literal escape layer. */
const BS = String.fromCharCode(92);

function winPath(posixLike: string): string {
	return posixLike.split("/").join(BS);
}

/** The Windows path every asymmetry fixture below is built from. */
const RAW_WIN_PATH = winPath("C:/Users/Admin/.aws/credentials");

function parseOne(command: string): ParsedScript {
	return parse(command);
}

function errorCount(script: ParsedScript): number {
	return (script.errors ?? []).length;
}

/** The first statement's Word suffix at `index` (0-based, after the command name). */
function suffixWord(script: ParsedScript, index = 0): Word {
	const stmt = script.commands[0] as Statement;
	const command = stmt.command as unknown as { suffix: Word[] };
	const word = command.suffix[index];
	if (word === undefined) {
		throw new Error(`suffixWord(${index}): fixture has no suffix word at that index -- fixture is wrong, not the parser`);
	}
	return word;
}

/**
 * `Word.value` and `Word.parts` -- confirmed by direct execution -- are
 * SELF-MEMOIZING GETTERS on unbash's internal `WordImpl` class, not own
 * enumerable properties: `Object.keys(word)` reports only `["text", "pos",
 * "end"]` until `.value`/`.parts` is actually read, even though `"value" in
 * word` and `"parts" in word` are both `true` from the start (an `in` check
 * walks the prototype chain; `Object.keys` does not). A walker built purely
 * on `Object.keys` therefore silently never descends into a command
 * substitution, process substitution or expansion hidden inside a `Word` --
 * exactly the omission that would make Plan 03's deny predicate blind to
 * every adversarial fixture in the tolerance table above. The two lazy names
 * are added to every level's key set explicitly, via direct property access
 * (which forces the getter), rather than trusted to `Object.keys`.
 */
const LAZY_WORD_KEYS = ["value", "parts"] as const;

function walkableKeys(obj: Record<string, unknown>): string[] {
	const keys = new Set(Object.keys(obj));
	for (const lazy of LAZY_WORD_KEYS) {
		if (!keys.has(lazy) && lazy in obj) {
			keys.add(lazy);
		}
	}
	return [...keys];
}

/**
 * Every value found under any `type` field anywhere in the parsed tree.
 *
 * A generic, untyped walk -- deliberately. This file characterises the
 * parser's OUTPUT shape; it is not, and must not become, a preview of
 * Plan 03's `shell.ts` deny-predicate walk. `pos`/`end` are skipped only
 * because they are numeric position fields present on every node and would
 * otherwise add nothing but noise to a `type`-collecting walk.
 */
function collectNodeTypes(node: unknown, found: Set<string>): void {
	if (node === null || typeof node !== "object") {
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) {
			collectNodeTypes(item, found);
		}
		return;
	}
	const obj = node as Record<string, unknown>;
	if (typeof obj.type === "string") {
		found.add(obj.type);
	}
	for (const key of walkableKeys(obj)) {
		if (key === "pos" || key === "end") {
			continue;
		}
		collectNodeTypes(obj[key], found);
	}
}

/** Every `Redirect.operator` value found anywhere in the parsed tree. */
function collectRedirectOperators(node: unknown, found: Set<string>): void {
	if (node === null || typeof node !== "object") {
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) {
			collectRedirectOperators(item, found);
		}
		return;
	}
	const obj = node as Record<string, unknown>;
	if (Array.isArray(obj.redirects)) {
		for (const redirect of obj.redirects as Record<string, unknown>[]) {
			if (typeof redirect.operator === "string") {
				found.add(redirect.operator);
			}
		}
	}
	for (const key of walkableKeys(obj)) {
		if (key === "pos" || key === "end") {
			continue;
		}
		collectRedirectOperators(obj[key], found);
	}
}

/** True if any `Statement` node anywhere in the tree has `background === true`. */
function anyStatementBackgrounded(node: unknown): boolean {
	if (node === null || typeof node !== "object") {
		return false;
	}
	if (Array.isArray(node)) {
		return node.some((item) => anyStatementBackgrounded(item));
	}
	const obj = node as Record<string, unknown>;
	if (obj.type === "Statement" && obj.background === true) {
		return true;
	}
	return walkableKeys(obj)
		.filter((key) => key !== "pos" && key !== "end")
		.some((key) => anyStatementBackgrounded(obj[key]));
}

describe("SAFE-02/SAFE-03 -- import surface (Assumption A2)", () => {
	it("imports `parse` from the bare `unbash` specifier and it returns a Script", () => {
		const script = parseOne("git push");
		expect(script.type, "unbash's ESM export resolved under this repo's vitest/jiti toolchain").toBe("Script");
	});
});

// ---------------------------------------------------------------------------
// Group 1: the tolerance table -- every construct SAFE-03 must fail-closed on,
// each one proven here to parse WITHOUT a parse error.
// ---------------------------------------------------------------------------

interface ToleranceRow {
	readonly label: string;
	readonly cmd: string;
	readonly why: string;
}

const TOLERANCE_TABLE: readonly ToleranceRow[] = [
	{
		label: "command substitution $(...)",
		cmd: "git $(echo push)",
		why: "an error-count check would let variable/command-substitution indirection straight through",
	},
	{
		label: "heredoc-to-script",
		cmd: "cat <<'SCRIPT' > x.sh\ngit push\nSCRIPT\nsh x.sh",
		why: "writing a script via heredoc and executing it is a two-statement script with no parse error anywhere in it",
	},
	{
		label: "backgrounded command",
		cmd: "nohup git push &",
		why: "backgrounding is syntactically valid bash; only Statement.background tells the deny predicate anything happened",
	},
	{
		label: "sh -c wrapper",
		cmd: 'sh -c "git push"',
		why: "the guarded verb is hidden inside a double-quoted string argument to a shell runner",
	},
	{
		label: "bash -lc wrapper",
		cmd: 'bash -lc "git push"',
		why: "same shell-runner indirection as sh -c, different runner name",
	},
	{
		label: "env -i wrapper",
		cmd: "env -i git push",
		why: "env is a legitimate wrapper unbash parses cleanly; only wrapper-resolution (Plan 03) sees through it",
	},
	{
		label: "git -C to another repo",
		cmd: "git -C /c/other/repo push",
		why: "-C changes the working repo entirely, and unbash has no opinion about that -- it is pure syntax to the parser",
	},
];

describe("SAFE-03 -- tolerance table: unbash reports NO parse error for any of these", () => {
	it("covers all seven adversarial inputs named in the plan's <behavior> block", () => {
		expect(
			TOLERANCE_TABLE.length,
			"a table shorter than seven rows silently drops one of the named adversarial inputs, " +
				"and the loop below would pass having exercised fewer cases than the plan requires",
		).toBe(7);
	});

	for (const row of TOLERANCE_TABLE) {
		it(`"${row.cmd.split("\n")[0]}" (${row.label}) parses with errors.length === 0`, () => {
			const script = parseOne(row.cmd);
			expect(errorCount(script), `${row.why} -- if this is nonzero, the fixture itself is malformed bash`).toBe(0);
		});
	}
});

// ---------------------------------------------------------------------------
// Group 2: the vocabulary table -- the exact node-type / operator / background
// literals a recursive deny-predicate walk (Plan 03's shell.ts) can key on.
// ---------------------------------------------------------------------------

interface VocabRow {
	readonly label: string;
	readonly cmd: string;
	readonly expectPartType?: string;
	readonly expectOperator?: string;
	readonly expectBackground?: true;
}

const VOCAB_TABLE: readonly VocabRow[] = [
	{ label: "command substitution part", cmd: "git $(echo push)", expectPartType: "CommandExpansion" },
	{
		label: "process substitution part (read form)",
		cmd: "diff <(git log) <(git log origin)",
		expectPartType: "ProcessSubstitution",
	},
	{
		label: "process substitution part (write form)",
		cmd: "tee >(git push)",
		expectPartType: "ProcessSubstitution",
	},
	{
		label: "arithmetic command expansion",
		cmd: "echo $(( $(echo 1) ))",
		expectPartType: "ArithmeticCommandExpansion",
	},
	{ label: "heredoc redirect", cmd: "git push <<EOF\nfoo\nEOF", expectOperator: "<<" },
	{ label: "dash-stripping heredoc redirect", cmd: "git push <<-EOF\nfoo\nEOF", expectOperator: "<<-" },
	{ label: "herestring redirect", cmd: "git push <<< foo", expectOperator: "<<<" },
	{ label: "backgrounded statement", cmd: "nohup git push &", expectBackground: true },
];

describe("SAFE-02/SAFE-03 -- vocabulary table: the exact literals a deny-predicate walk keys on", () => {
	it("covers at least the eight dangerous constructs the plan names", () => {
		expect(
			VOCAB_TABLE.length,
			"a table shorter than eight rows silently drops coverage of a node type or operator the plan requires",
		).toBeGreaterThanOrEqual(8);
	});

	for (const row of VOCAB_TABLE) {
		it(`"${row.cmd.split("\n")[0]}" (${row.label}) surfaces the exact literal`, () => {
			const script = parseOne(row.cmd);
			expect(errorCount(script), "vocabulary fixtures must also be clean parses, per the tolerance table above").toBe(
				0,
			);

			if (row.expectPartType !== undefined) {
				const types = new Set<string>();
				collectNodeTypes(script, types);
				expect(
					types.has(row.expectPartType),
					`expected node type "${row.expectPartType}" not found anywhere in the parsed tree for "${row.cmd}" -- ` +
						`observed types: ${[...types].sort().join(", ")}`,
				).toBe(true);
			}

			if (row.expectOperator !== undefined) {
				const operators = new Set<string>();
				collectRedirectOperators(script, operators);
				expect(
					operators.has(row.expectOperator),
					`expected redirect operator "${row.expectOperator}" not found for "${row.cmd}" -- ` +
						`observed operators: ${[...operators].sort().join(", ")}`,
				).toBe(true);
			}

			if (row.expectBackground === true) {
				expect(
					anyStatementBackgrounded(script),
					`expected some Statement.background === true for "${row.cmd}"`,
				).toBe(true);
			}
		});
	}

	it("a CLEAN command exhibits none of the eight vocabulary facts (negative control)", () => {
		// Pairs every positive row above with the one fixture that could produce
		// the opposite answer -- the same discipline redact.test.ts uses. Without
		// this, a deny predicate that always returns true would pass every row
		// above and this file would have proven nothing about precision.
		const script = parseOne("git push");
		const types = new Set<string>();
		collectNodeTypes(script, types);
		const operators = new Set<string>();
		collectRedirectOperators(script, operators);

		for (const row of VOCAB_TABLE) {
			if (row.expectPartType !== undefined) {
				expect(types.has(row.expectPartType), `"git push" must not contain ${row.expectPartType}`).toBe(false);
			}
			if (row.expectOperator !== undefined) {
				expect(operators.has(row.expectOperator), `"git push" must not contain redirect ${row.expectOperator}`).toBe(
					false,
				);
			}
		}
		expect(anyStatementBackgrounded(script), '"git push" must not be backgrounded').toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Group 3: the Windows-path asymmetry -- text vs value, and the non-expansion
// of `~` and `$HOME`. The single most important settled unknown named in
// 04-RESEARCH.md Pitfall 3.
// ---------------------------------------------------------------------------

describe("SAFE-06/SAFE-08 -- Windows path asymmetry: word.text vs word.value", () => {
	it("unquoted: word.value drops the backslashes that word.text preserves", () => {
		const script = parseOne(`cat ${RAW_WIN_PATH}`);
		expect(errorCount(script)).toBe(0);
		const word = suffixWord(script);

		expect(word.text, "the raw source slice must preserve every backslash verbatim").toBe(RAW_WIN_PATH);
		expect(
			word.value.includes(BS),
			"unbash treats an unquoted backslash as a POSIX escape character and drops it -- " +
				"a path-matching policy reading .value alone silently never recognises this path",
		).toBe(false);
		expect(word.text, "text and value must actually DIFFER, or this fixture proves nothing").not.toBe(word.value);
	});

	it("double-quoted: word.value RETAINS the backslashes", () => {
		const script = parseOne(`cat "${RAW_WIN_PATH}"`);
		expect(errorCount(script)).toBe(0);
		const word = suffixWord(script);

		expect(
			word.value.includes(BS),
			"double quotes suppress the escape interpretation the unquoted case exhibits above -- " +
				"a policy reading .value here must expect the backslashes to survive",
		).toBe(true);
		expect(word.value).toBe(RAW_WIN_PATH);
	});

	it("single-quoted: word.value RETAINS the backslashes", () => {
		const script = parseOne(`cat '${RAW_WIN_PATH}'`);
		expect(errorCount(script)).toBe(0);
		const word = suffixWord(script);

		expect(word.value.includes(BS), "single quotes take everything literally, backslashes included").toBe(true);
		expect(word.value).toBe(RAW_WIN_PATH);
	});

	it("~ is NOT expanded -- word.value is the literal tilde form", () => {
		const script = parseOne("cat ~/.aws/credentials");
		expect(errorCount(script)).toBe(0);
		const word = suffixWord(script);

		expect(
			word.value,
			"unbash performs no home-directory expansion; a policy comparing against the real home " +
				"directory must expand ~ itself before matching",
		).toBe("~/.aws/credentials");
	});

	it("$HOME is NOT expanded -- it survives as a SimpleExpansion part, not a resolved value", () => {
		const script = parseOne("cat $HOME/.aws/credentials");
		expect(errorCount(script)).toBe(0);
		const word = suffixWord(script);

		expect(word.value, "the literal, unresolved form must be what .value reports").toBe("$HOME/.aws/credentials");

		const types = new Set<string>();
		collectNodeTypes(word, types);
		expect(
			types.has("SimpleExpansion"),
			"a policy that only ever reads .value would never know an environment-variable expansion " +
				"was present at all -- it must also inspect .parts for SimpleExpansion/ParameterExpansion",
		).toBe(true);
	});
});
