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
		label: "unresolved expansion as the executable behind a wrapper",
		cmd: "g=git; env $g push origin main",
		expected: "refused",
		cause: "unresolved-expansion-in-command-position",
		why: "the resolved word after env is the real command position, so the plain `$g push` rule must apply there too",
	},
	{
		label: "unresolved expansion as a wrapper operand",
		cmd: 'T="5 terraform"; timeout $T apply',
		expected: "refused",
		cause: "unresolved-expansion-in-command-position",
		why: "word splitting turns the operand into `5 terraform`, so an expansion among the wrapper words can supply the executable",
	},
	{
		label: "literal guarded verb behind a wrapper with an expanded subcommand",
		cmd: "g=push; sudo git $g origin main",
		expected: "refused",
		cause: "unresolved-expansion-in-command-position",
		why: "same as `git $g` typed plainly: the subcommand comes from a variable",
	},
	{
		label: "wrapper with an expansion only in an ordinary argument",
		cmd: 'env A=1 echo "$HOME"',
		expected: "ok",
		why: "the rule covers command position and guarded subcommands, not every argument",
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
		label: "split-quote guarded verb behind an untabulated wrapper option",
		cmd: "env --ignore-signal=PIPE g''it push origin main",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "bash runs `g''it` as `git`, so the guarded-verb test must see the quote-resolved word, not only the raw text",
	},
	{
		label: "split-quote infra verb behind an untabulated sudo option",
		cmd: "sudo -P te''rraform apply",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "same as the env row for sudo and terraform",
	},
	{
		label: "split double quotes behind an untabulated wrapper option",
		cmd: 'env -a x g""it push origin main',
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "an empty double-quoted string joins the same way as an empty single-quoted one",
	},
	{
		label: "split-quote guarded verb inside a shell runner's script",
		cmd: "sh -c 'g''it push origin main'",
		expected: "refused",
		cause: "shell-runner",
		why: "the script string resolves to `git push origin main`, so the runner rule must see past the quotes too",
	},
	{
		label: "unset braced expansion splitting a guarded verb inside a runner's script",
		cmd: "sh -c 'g${u}it push origin main'",
		expected: "refused",
		cause: "shell-runner",
		why: "an unset variable expands to nothing, so the inner shell runs `git`",
	},
	{
		label: "empty positional-parameter expansion splitting a guarded verb",
		cmd: "bash -c 'gi$@t push origin main'",
		expected: "refused",
		cause: "shell-runner",
		why: "`$@` is empty in a -c script with no operands, so the inner shell runs `git`",
	},
	{
		label: "cmd caret escape splitting a guarded verb",
		cmd: 'cmd //c "gi^t push origin main"',
		expected: "refused",
		cause: "shell-runner",
		why: "`^` is cmd.exe's escape character and disappears before cmd runs the word",
	},
	{
		label: "PowerShell backtick escape splitting a guarded verb",
		cmd: "powershell -Command 'g`it push origin main'",
		expected: "refused",
		cause: "shell-runner",
		why: "a backtick is PowerShell's escape character, so PowerShell runs `git`",
	},
	{
		label: "runner script with an expansion but no guarded verb (negative control)",
		cmd: "sh -c 'echo ${HOME} $1'",
		expected: "ok",
		why: "removing expansions only adds matches, so a script with no guarded verb stays allowed",
	},
	{
		label: "unknown npm global option before exec with a guarded verb",
		cmd: "npm --loglevel silent exec openspec update",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "the guard cannot tell whether an unknown global option takes a value, so a later runner subcommand fails closed",
	},
	{
		label: "find -exec running a guarded verb",
		cmd: "find . -exec git push origin main \\;",
		expected: "refused",
		cause: "shell-runner",
		why: "find runs its -exec command per match, the same shape as xargs",
	},
	{
		label: "busybox handing a guarded verb to its own shell",
		cmd: "busybox ash -c 'git push origin main'",
		expected: "refused",
		cause: "shell-runner",
		why: "busybox resolves to ash, which is a shell runner",
	},
	{
		label: "npx -w with a path that merely contains a guarded word",
		cmd: "npx -w packages/app vitest run tests/git-policy.test.ts",
		expected: "ok",
		why: "-w takes a value, so the resolution is confident and the path's `git` does not trigger the unresolved-wrapper refusal",
	},
	{
		label: "find without an -exec primary",
		cmd: "find . -name git",
		expected: "ok",
		why: "find is only a runner when it has an -exec-family primary",
	},
	{
		label: "find rooted at openspec running a read-only -exec",
		cmd: "find openspec -name '*.md' -exec wc -l {} +",
		expected: "ok",
		why: "find runs only the words after -exec; the search root is not part of the command it runs",
	},
	{
		label: "find with a guarded word in a -path pattern",
		cmd: "find . -name '*.md' -path '*openspec*' -exec cat {} \\;",
		expected: "ok",
		why: "a -path pattern is a filter, not part of the -exec command",
	},
	{
		label: "fd rooted at openspec running a read-only -x",
		cmd: "fd -e md . openspec -x wc -l",
		expected: "ok",
		why: "same as find for fd's -x",
	},
	{
		label: "node running a script whose name only contains a guarded word",
		cmd: "node scripts/gen-openspec.mjs",
		expected: "ok",
		why: "the script file is opaque to this guard; a guarded word inside its name does not make it that tool",
	},
	{
		label: "find rooted at openspec whose -exec runs a guarded verb (negative control)",
		cmd: "find openspec -name '*.md' -exec git add {} +",
		expected: "refused",
		cause: "shell-runner",
		why: "the words after -exec still name a guarded verb",
	},
	{
		label: "fd -x running a guarded verb (negative control)",
		cmd: "fd -e md . openspec -x openspec validate",
		expected: "refused",
		cause: "shell-runner",
		why: "the words after -x name a guarded verb",
	},
	{
		label: "a script named for a guarded verb stays refused (negative control)",
		cmd: "sh scripts/openspec-setup.sh",
		expected: "refused",
		cause: "shell-runner",
		why: "a script file whose name starts with a guarded verb is treated as that tool's entry point",
	},
	{
		label: "a guarded verb after an opaque script operand (negative control)",
		cmd: "node scripts/gen-openspec.mjs git push origin main",
		expected: "refused",
		cause: "shell-runner",
		why: "only the script operand is exempt; later words are still tested",
	},
	{
		label: "unknown wrapper option with no guarded verb",
		cmd: "env --frobnicate ls",
		expected: "ok",
		why: "the unresolved-wrapper refusal is gated on a guarded verb in the segment, so an ordinary command is not over-blocked",
	},
	{
		label: "brace expansion builds the executable and subcommand",
		cmd: "{git,push} origin HEAD:main",
		expected: "refused",
		cause: "non-literal-command-name",
		why: "bash expands the braces to `git push origin HEAD:main` after the guard has read one opaque word",
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
	{
		label: "a literal guarded command piped into a shell",
		cmd: "echo 'git push origin feat:main' | sh",
		expected: "refused",
		cause: "generated-script",
		why: "a shell with no script operand reads its script from the pipe, which the per-segment check never sees",
	},
	{
		label: "an encoded script decoded into a shell",
		cmd: "echo Z2l0IHB1c2g= | base64 -d | sh",
		expected: "refused",
		cause: "generated-script",
		why: "the piped script is refused whatever produces it",
	},
	{
		label: "a piped interpreter reading stdin through -",
		cmd: "cat x | node -",
		expected: "refused",
		cause: "generated-script",
		why: "`-` names stdin as the script",
	},
	{
		label: "a bare word after a shell option is not a script file",
		cmd: "cat x | bash -o pipefail",
		expected: "refused",
		cause: "generated-script",
		why: "pipefail is the value of -o, so bash still reads its script from the pipe",
	},
	{
		label: "xargs feeding piped words into a shell's code",
		cmd: "echo q | xargs -I{} sh -c {}",
		expected: "refused",
		cause: "generated-script",
		why: "the replacement string puts each piped line into the -c code",
	},
	{
		label: "a script written and run in one command",
		cmd: "echo 'git push origin feat:main' > x.sh; sh x.sh",
		expected: "refused",
		cause: "generated-script",
		why: "the redirect writes the script the next segment runs",
	},
	{
		label: "a file written then run by path after a cd",
		cmd: "echo x > a.sh; cd sub; ./a.sh",
		expected: "refused",
		cause: "generated-script",
		why: "written and run files are compared by basename because a cd may sit between",
	},
	{
		label: "a written file fed to a shell through an input redirect",
		cmd: "echo z > x.sh; sh < x.sh",
		expected: "refused",
		cause: "generated-script",
		why: "the input redirect is the script",
	},
	{
		label: "a piped interpreter running a script file (negative control)",
		cmd: "cat data.json | python script.py",
		expected: "ok",
		why: "the pipe is data; the script is a file operand",
	},
	{
		label: "a piped interpreter with inline code (negative control)",
		cmd: "echo | node -e 'process.stdin.pipe(process.stdout)'",
		expected: "ok",
		why: "-e makes the code an argument, which the runner rule already checks",
	},
	{
		label: "a script file run without being written here (negative control)",
		cmd: "sh scripts/check.sh",
		expected: "ok",
		why: "an existing script file is opaque, a published limit",
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

const NON_LITERAL_REFUSED: readonly string[] = [
	"{git,push} origin HEAD:main",
	"{terraform,apply} -auto-approve",
	"{aws,s3,rm} s3://b --recursive",
	"gi? push",
	"/usr/bin/gi[t] push",
	"~/bin/git push",
	"git$' 'push",
	"git push{,} origin main",
];

const NON_LITERAL_OK: readonly string[] = [
	"[ -f x ]",
	"[[ -n \"$a\" ]]",
	"'git' status",
	'"git" status',
	"$'git' status",
	"echo {a,b}",
	"ls *.md",
];

describe("fail-closed command-name predicate", () => {
	it.each(NON_LITERAL_REFUSED)("refuses %s", (cmd) => {
		const verdict = canonicalise(cmd);
		expect(verdict.kind).toBe("refused");
		if (verdict.kind === "refused") expect(verdict.cause).toBe("non-literal-command-name");
	});

	it("refuses a brace-built executable behind a wrapper", () => {
		expect(canonicalise("sudo {git,push} origin main").kind).toBe("refused");
	});

	it.each(NON_LITERAL_OK)("accepts %s", (cmd) => {
		expect(canonicalise(cmd).kind).toBe("ok");
	});
});

const RUNNER_REFUSED: readonly string[] = [
	"trap 'git push origin HEAD:main' EXIT",
	"trap 'terraform apply -auto-approve' EXIT",
	". git-push.sh",
	"source ./git-push.sh",
	"alias p='git push'; p",
	"hash -p /usr/bin/git g; g push",
	"enable -f x git",
	"alias p=push; git p origin main",
];

describe("builtins that carry command text", () => {
	it.each(RUNNER_REFUSED)("refuses %s as a shell runner", (cmd) => {
		const verdict = canonicalise(cmd);
		expect(verdict.kind).toBe("refused");
		if (verdict.kind === "refused") expect(verdict.cause).toBe("shell-runner");
	});

	it("leaves a trap without a guarded verb alone", () => {
		expect(canonicalise("trap 'rm -f tmp' EXIT").kind).toBe("ok");
	});
});
