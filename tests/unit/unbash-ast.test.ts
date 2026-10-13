/**
 * Characterises the third-party unbash parser, so a parser change fails here first. unbash is tolerant (`git
 * $(echo push)`, `sh -c "git push"` parse cleanly), so the guard must deny on node types, not parse errors. A clean
 * parse returns `errors: undefined`, hence `(script.errors ?? []).length`. Each table asserts its own length first.
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
 * `Word.value` and `Word.parts` are lazy prototype getters absent from Object.keys, so a walk built on Object.keys
 * never descends into a substitution inside a Word; both are read explicitly at every level.
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

/** Every `type` value anywhere in the tree, by a generic walk; numeric pos/end fields are skipped. */
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
// Group 1: every construct the guard must fail closed on parses without error
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
// Group 2: the node-type, operator and background literals a deny walk keys on
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
		// Each positive row's opposite: without it a predicate that always returns true passes.
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
// Group 3: Windows paths, text vs value, and the non-expansion of `~` and `$HOME`
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
