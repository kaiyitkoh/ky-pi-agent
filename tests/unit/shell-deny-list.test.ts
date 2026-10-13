/**
 * SAFE-03 — the fail-closed node-type deny predicate, table-driven.
 *
 * WHY THIS IS NOT AN `errors.length` TEST. Every REFUSED row below is chosen
 * from `tests/unit/unbash-ast.test.ts`'s own tolerance table (Plan 01,
 * executed) — each one parses with `errors.length === 0`. If this predicate
 * were "deny when `errors.length > 0`", every REFUSED row here would instead
 * come back "ok", and this file's job is to prove that does NOT happen.
 *
 * VACUOUS-PASS GUARD (this repo's house rule, see
 * `tests/unit/redact.test.ts` / `tests/unit/unbash-ast.test.ts`): the table's
 * length is asserted before the loop that consumes it runs, and every
 * distinct cause `.pi/extensions/safety/shell.ts` can return is asserted
 * reachable by at least one row — a cause no fixture produces is a branch no
 * test exercises.
 *
 * TWO DOCUMENTED DEVIATIONS FROM 04-03-PLAN.md's LITERAL FIXTURE TEXT, per
 * this plan's own read_first instruction to prefer the executed AST over the
 * plan's prose when they disagree (see `shell.ts`'s module docstring for the
 * full reasoning, executed and re-verified in this file):
 *
 * 1. The "arithmetic command expansion" row uses `echo $(( $(echo 1) ))`,
 *    not the plan's literal `git $((1+1))` — executed against unbash,
 *    `git $((1+1))` produces `ArithmeticExpansion`/`ArithmeticBinary`, never
 *    `ArithmeticCommandExpansion`; only a command substitution NESTED inside
 *    an arithmetic expansion produces that node type.
 * 2. The "unresolved expansion" row's cause is asserted via the actual AST
 *    shape: `git $g origin main` places the unresolved `$g` in `suffix[0]`
 *    (the git subcommand position), not in `Command.name` — `shell.ts`
 *    refuses it because `git` is a guarded verb whose ARGUMENTS are also
 *    checked, not only its executable-name word.
 */
import { describe, expect, it } from "vitest";

import {
	canonicalise,
	DENIED_PART_TYPES,
	HEREDOC_OPERATORS,
	SHELL_REFUSAL_CAUSES,
	type ShellRefusalCause,
} from "../../.pi/extensions/safety/shell.ts";

interface DenyRow {
	readonly label: string;
	readonly cmd: string;
	readonly expected: "refused" | "ok";
	readonly cause?: ShellRefusalCause;
	readonly why: string;
}

const TABLE: readonly DenyRow[] = [
	{
		label: "command substitution $(...)",
		cmd: "git $(echo push)",
		expected: "refused",
		cause: "command-substitution",
		why: "SAFE-03 truth: refused even though unbash reports zero parse errors",
	},
	{
		label: "backtick command substitution",
		cmd: "git `printf push`",
		expected: "refused",
		cause: "command-substitution",
		why: "backticks lex to the same CommandExpansion node kind as $(...) (plan <behavior>)",
	},
	{
		label: "process substitution, read form",
		cmd: "diff <(git log) <(git log origin/main)",
		expected: "refused",
		cause: "process-substitution",
		why: "plan <behavior>: refused, cause process-substitution",
	},
	{
		label: "process substitution, write form",
		cmd: "tee >(git push)",
		expected: "refused",
		cause: "process-substitution",
		why: "ProcessSubstitutionPart.operator can be '<' or '>' -- both must be caught, not just the read form",
	},
	{
		label: "arithmetic command expansion (nested command substitution)",
		cmd: "echo $(( $(echo 1) ))",
		expected: "refused",
		cause: "arithmetic-expansion",
		why: "the exact fixture tests/unit/unbash-ast.test.ts proves produces ArithmeticCommandExpansion -- see module docstring deviation note",
	},
	{
		label: "heredoc-to-script",
		cmd: "cat > /tmp/d.sh <<'EOF'\ngit push\nEOF\nsh /tmp/d.sh",
		expected: "refused",
		cause: "heredoc",
		why: "plan <behavior>: heredoc form refused, cause heredoc",
	},
	{
		label: "dash-stripping heredoc",
		cmd: "git push <<-EOF\nfoo\nEOF",
		expected: "refused",
		cause: "heredoc",
		why: "HEREDOC_OPERATORS must include <<- distinctly from <<",
	},
	{
		label: "herestring",
		cmd: "git push <<< foo",
		expected: "refused",
		cause: "heredoc",
		why: "HEREDOC_OPERATORS must include <<< (herestring), not only the two heredoc forms",
	},
	{
		label: "backgrounded command",
		cmd: "nohup git push &",
		expected: "refused",
		cause: "background",
		why: "plan <behavior>: nohup git push & refused, cause background",
	},
	{
		label: "unresolved expansion selects the git subcommand",
		cmd: "g=push; git $g origin main",
		expected: "refused",
		cause: "unresolved-expansion-in-command-position",
		why: "plan <behavior> and truths: refused because the command word carries an unresolved expansion",
	},
	{
		label: "unresolved expansion as the executable itself",
		cmd: "CMD=git; $CMD push",
		expected: "refused",
		cause: "unresolved-expansion-in-command-position",
		why: "a dynamic EXECUTABLE (not just a dynamic argument) must also be refused -- Command.name itself carries the expansion here",
	},
	{
		label: "unknown wrapper option in front of a guarded verb",
		cmd: "env --frobnicate git push",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "the option is outside env's grammar, so the word after it may not be what runs; with a guarded verb in the segment that uncertainty must deny, not resolve to an unclassified executable",
	},
	{
		label: "assignment left in command position after a non-assigning wrapper",
		cmd: "nohup A=1 terraform apply",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "nohup does not consume NAME=value, so the resolved executable would be the assignment word, never terraform",
	},
	{
		label: "unknown wrapper option with no guarded verb",
		cmd: "env --frobnicate ls",
		expected: "ok",
		why: "the unresolved-wrapper refusal is gated on a guarded verb in the segment, so an ordinary command is not over-blocked",
	},
	{
		label: "unparseable input (final catch-all)",
		cmd: 'git "push',
		expected: "refused",
		cause: "parse-error",
		why: "unbash reports a real parse error (unterminated double quote) for this one -- the catch-all, kept last per the plan",
	},
	{
		label: "plain git status",
		cmd: "git status",
		expected: "ok",
		why: "plan <behavior>: NOT refused -- the fail-closed rule is a node-type rule, not a blanket deny",
	},
	{
		label: "argument-position expansion on a non-guarded command",
		cmd: 'echo "$HOME"',
		expected: "ok",
		why: "plan <behavior>: NOT refused for the expansion alone -- echo is not a guarded verb and the policy never inspects this argument",
	},
	{
		label: "quoting evasion resolves to a literal, unremarkable command",
		cmd: "g\"i\"t p'u'sh",
		expected: "ok",
		why: "plan <behavior>: NOT refused by this predicate -- unbash resolves quoting into Word.value === \"git\"/\"push\"; the DENY here is policy's job, not the parser's",
	},
];

describe("SAFE-03 -- shell-deny-list table is non-empty (vacuous-pass guard)", () => {
	it("has at least the six mandatory REFUSED rows plus the three mandatory NOT-REFUSED rows", () => {
		expect(TABLE.length, "a shortened table silently drops coverage of an adversarial or benign fixture").toBeGreaterThanOrEqual(
			14,
		);
		const refusedCount = TABLE.filter((r) => r.expected === "refused").length;
		const okCount = TABLE.filter((r) => r.expected === "ok").length;
		expect(refusedCount, "must cover every REFUSED fixture named in the plan's acceptance criteria").toBeGreaterThanOrEqual(6);
		expect(okCount, "must cover every NOT-REFUSED fixture named in the plan's acceptance criteria").toBeGreaterThanOrEqual(3);
	});
});

describe("SAFE-03 -- canonicalise() node-type deny predicate", () => {
	for (const row of TABLE) {
		it(`"${row.cmd.split("\n")[0]}" (${row.label}) -> ${row.expected}${row.cause ? ` (${row.cause})` : ""}`, () => {
			const verdict = canonicalise(row.cmd);
			expect(verdict.kind, row.why).toBe(row.expected);
			if (row.expected === "refused" && verdict.kind === "refused" && row.cause !== undefined) {
				expect(verdict.cause, `${row.why} -- got cause "${verdict.cause}"`).toBe(row.cause);
			}
		});
	}
});

/**
 * `"shell-runner"` is deliberately excluded from this file's coverage set: it
 * can only fire after wrapper resolution (Task 2), and its paired
 * refused/not-refused fixtures (`sh -c "git push"` vs `sh -c "ls"`) live in
 * `tests/unit/shell-parse.test.ts`, which asserts it directly. Every OTHER
 * cause `shell.ts` exports must still be reachable from this file alone.
 */
const CAUSES_COVERED_BY_THIS_FILE: readonly ShellRefusalCause[] = SHELL_REFUSAL_CAUSES.filter(
	(c) => c !== "shell-runner",
);

describe("SAFE-03 -- every distinct cause this file is responsible for is reachable by at least one fixture", () => {
	it("CAUSES_COVERED_BY_THIS_FILE is fully covered by the table above", () => {
		expect(
			CAUSES_COVERED_BY_THIS_FILE.length,
			"SHELL_REFUSAL_CAUSES minus shell-runner must be non-empty, or this guard proves nothing",
		).toBeGreaterThan(0);
		const observed = new Set(TABLE.map((r) => r.cause).filter((c): c is ShellRefusalCause => c !== undefined));
		for (const cause of CAUSES_COVERED_BY_THIS_FILE) {
			expect(
				observed.has(cause),
				`cause "${cause}" is exported but no fixture row in THIS file produces it -- a branch no test exercises`,
			).toBe(true);
		}
	});
});

describe("SAFE-03 -- DENIED_PART_TYPES / HEREDOC_OPERATORS export the executed vocabulary", () => {
	it("DENIED_PART_TYPES matches the three node types proven in tests/unit/unbash-ast.test.ts", () => {
		expect([...DENIED_PART_TYPES].sort()).toEqual(
			["ArithmeticCommandExpansion", "CommandExpansion", "ProcessSubstitution"].sort(),
		);
	});

	it("HEREDOC_OPERATORS matches the three redirect operators proven in tests/unit/unbash-ast.test.ts", () => {
		expect([...HEREDOC_OPERATORS].sort()).toEqual(["<<", "<<-", "<<<"].sort());
	});
});
