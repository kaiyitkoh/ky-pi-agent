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

const PIPE_ROWS: readonly DenyRow[] = [
	{ label: "piped data: curl -s https://example.invalid | python -m json.tool", cmd: "curl -s https://example.invalid | python -m json.tool", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | python3 -u -W ignore script.py", cmd: "cat x | python3 -u -W ignore script.py", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | node s.js", cmd: "cat x | node s.js", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | node --no-warnings s.js", cmd: "cat x | node --no-warnings s.js", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | bash s.sh", cmd: "cat x | bash s.sh", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | bash -e s.sh", cmd: "cat x | bash -e s.sh", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | python -c \"import sys,json; print(json.load(sys.stdin))\"", cmd: "cat x | python -c \"import sys,json; print(json.load(sys.stdin))\"", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | perl -ne 'print if /a/'", cmd: "cat x | perl -ne 'print if /a/'", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | ruby -e 'puts STDIN.read.upcase'", cmd: "cat x | ruby -e 'puts STDIN.read.upcase'", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | sh -c 'cat > out.txt'", cmd: "cat x | sh -c 'cat > out.txt'", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat x | deno run s.ts", cmd: "cat x | deno run s.ts", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: python -m foo", cmd: "python -m foo", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "piped data: cat d | python -m foo", cmd: "cat d | python -m foo", expected: "ok", why: "stdin is data, not the interpreter's code" },
	{ label: "pipe grammar: cat x | python", cmd: "cat x | python", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | node", cmd: "cat x | node", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | perl", cmd: "cat x | perl", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | ruby", cmd: "cat x | ruby", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | python -u", cmd: "cat x | python -u", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | bash -s", cmd: "cat x | bash -s", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | bash -s arg", cmd: "cat x | bash -s arg", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | bash -i s.sh", cmd: "cat x | bash -i s.sh", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | python -i s.py", cmd: "cat x | python -i s.py", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | perl -pi -e 's/a/b/'", cmd: "cat x | perl -pi -e 's/a/b/'", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | PYTHONINSPECT=1 python s.py", cmd: "cat x | PYTHONINSPECT=1 python s.py", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | env PYTHONINSPECT=1 python s.py", cmd: "cat x | env PYTHONINSPECT=1 python s.py", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: PYTHONINSPECT=1; cat x | python s.py", cmd: "PYTHONINSPECT=1; cat x | python s.py", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | python -", cmd: "cat x | python -", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | python --frob s.py", cmd: "cat x | python --frob s.py", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | node --frob s.js", cmd: "cat x | node --frob s.js", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | perl -x", cmd: "cat x | perl -x", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | deno repl", cmd: "cat x | deno repl", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | ruby -e 'eval STDIN.read'", cmd: "cat x | ruby -e 'eval STDIN.read'", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | perl -e 'eval join \"\", <STDIN>'", cmd: "cat x | perl -e 'eval join \"\", <STDIN>'", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | node -e \"process.stdin.on('data', d => (0,eval)(String(d)))\"", cmd: "cat x | node -e \"process.stdin.on('data', d => (0,eval)(String(d)))\"", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | python -c \"import pickle,sys; pickle.loads(sys.stdin.buffer.read())\"", cmd: "cat x | python -c \"import pickle,sys; pickle.loads(sys.stdin.buffer.read())\"", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | cmd //c s.bat", cmd: "cat x | cmd //c s.bat", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | pwsh -File s.ps1", cmd: "cat x | pwsh -File s.ps1", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | busybox sh s.sh", cmd: "cat x | busybox sh s.sh", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | osascript s.scpt", cmd: "cat x | osascript s.scpt", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | python -m code", cmd: "cat x | python -m code", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: cat x | python s.py -", cmd: "cat x | python s.py -", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: echo x > foo.py; cat d | python -m foo", cmd: "echo x > foo.py; cat d | python -m foo", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: echo x > foo/__main__.py; python -m foo", cmd: "echo x > foo/__main__.py; python -m foo", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
	{ label: "pipe grammar: echo x > foo.py; python -m foo.bar", cmd: "echo x > foo.py; python -m foo.bar", expected: "refused", cause: "generated-script", why: "stdin may be read as code, or the module was just written" },
];

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
		label: "a piped interpreter running a script file",
		cmd: "cat data.json | python script.py",
		expected: "ok",
		why: "the pipe is the script's data; its code comes from the file",
	},
	{
		label: "a piped interpreter with inline code that does not evaluate its input",
		cmd: "echo | node -e 'process.stdin.pipe(process.stdout)'",
		expected: "ok",
		why: "the inline code is the program; the pipe is data",
	},
	{
		label: "a piped shell given /dev/stdin as its script",
		cmd: "echo 'git push origin feat:main' | bash /dev/stdin",
		expected: "refused",
		cause: "generated-script",
		why: "/dev/stdin is the pipe, whatever its path shape",
	},
	{
		label: "a piped shell given /dev/fd/0",
		cmd: "echo 'git push origin feat:main' | sh /dev/fd/0",
		expected: "refused",
		cause: "generated-script",
		why: "/dev/fd/0 is the pipe",
	},
	{
		label: "a piped shell given /proc/self/fd/0",
		cmd: "echo 'git push origin feat:main' | sh /proc/self/fd/0",
		expected: "refused",
		cause: "generated-script",
		why: "/proc/self/fd/0 is the pipe",
	},
	{
		label: "a piped python given /dev/stdin",
		cmd: "echo 'git push origin feat:main' | python3 /dev/stdin",
		expected: "refused",
		cause: "generated-script",
		why: "the same alias for any code runner",
	},
	{
		label: "an inline shell that runs a shell reading the pipe",
		cmd: "echo 'git push origin feat:main' | sh -c sh",
		expected: "refused",
		cause: "generated-script",
		why: "the inner sh inherits the pipe as its script",
	},
	{
		label: "an inline shell that runs bash -s",
		cmd: "echo 'git push origin feat:main' | bash -c 'bash -s'",
		expected: "refused",
		cause: "generated-script",
		why: "bash -s reads the inherited pipe",
	},
	{
		label: "a stdin alias without a pipe",
		cmd: "sh /dev/stdin",
		expected: "refused",
		cause: "generated-script",
		why: "a code runner never reads its code from a stdin alias",
	},
	{
		label: "a bare-name script written then run",
		cmd: "echo 'git push origin feat:main' > p; sh p",
		expected: "refused",
		cause: "generated-script",
		why: "the file name has no dot or slash",
	},
	{
		label: "a bare-name script written then run with an option",
		cmd: "echo 'terraform apply -auto-approve' > p && bash -e p",
		expected: "refused",
		cause: "generated-script",
		why: "options before the file do not hide it",
	},
	{
		label: "a script written by tee then run",
		cmd: "echo 'git push origin feat:main' | tee p && sh p",
		expected: "refused",
		cause: "generated-script",
		why: "tee writes the file the shell runs",
	},
	{
		label: "a script copied then run",
		cmd: "echo 'git push origin feat:main' > p.sh; cp p.sh q; sh q",
		expected: "refused",
		cause: "generated-script",
		why: "cp writes q, which the shell runs",
	},
	{
		label: "an interpreter reading data from an input redirect (negative control)",
		cmd: "python solve.py < input.txt",
		expected: "ok",
		why: "a file redirect is data the guard can name; only a pipe or a file this command wrote is refused",
	},
	{
		label: "a piped tee (negative control)",
		cmd: "npm test 2>&1 | tee test.log",
		expected: "ok",
		why: "tee is not a code runner",
	},
	{
		label: "a script file run without being written here (negative control)",
		cmd: "sh scripts/check.sh",
		expected: "ok",
		why: "an existing script file is opaque, a published limit",
	},
	{
		label: "xargs in front of env",
		cmd: "echo git push origin HEAD:main | xargs env",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "env runs the piped words as a command",
	},
	{
		label: "xargs in front of nice",
		cmd: "echo git push origin HEAD:main | xargs nice",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "any wrapper under xargs runs the piped words",
	},
	{
		label: "xargs in front of timeout",
		cmd: "echo git push origin HEAD:main | xargs timeout 60",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "timeout's command comes from the pipe",
	},
	{
		label: "xargs in front of command",
		cmd: "echo terraform apply -auto-approve | xargs command",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "command runs its first argument",
	},
	{
		label: "xargs -0 in front of sudo",
		cmd: "echo git push origin HEAD:main | xargs -0 sudo",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "xargs options do not hide the wrapper",
	},
	{
		label: "xargs in front of a package manager with no subcommand",
		cmd: "echo exec git push | xargs npm",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "npm's subcommand comes from the pipe",
	},
	{
		label: "xargs with an option it does not know",
		cmd: "ls | xargs --frobnicate wc",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "the command xargs runs cannot be found past an unknown option",
	},
	{
		label: "find -exec in front of a wrapper",
		cmd: "find . -name x -exec env {} ;",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "the wrapper runs the found names",
	},
	{
		label: "xargs feeding a shell's inline code",
		cmd: "echo q | xargs sh -c 'eval \"$1\"' _",
		expected: "refused",
		cause: "generated-script",
		why: "the piped words reach inline code as arguments it may run",
	},
	{
		label: "find -exec running inline shell code",
		cmd: "find . -name '*.sh' -exec sh -c 'echo {}' ';'",
		expected: "refused",
		cause: "generated-script",
		why: "found names are pasted into the code",
	},
	{
		label: "xargs running python on a module (negative control)",
		cmd: "find . -name '*.py' | xargs python -m py_compile",
		expected: "ok",
		why: "the piped words are file arguments to a named module",
	},
	{
		label: "xargs running node on a script file (negative control)",
		cmd: "git diff --name-only | xargs node scripts/lint.mjs",
		expected: "ok",
		why: "the piped words are arguments to a named script",
	},
	{
		label: "xargs running bash -n on each file (negative control)",
		cmd: "ls *.sh | xargs -n1 bash -n",
		expected: "ok",
		why: "the piped words are script files bash only checks",
	},
	{
		label: "xargs running grep (negative control)",
		cmd: "rg -l TODO | xargs grep -n FIXME",
		expected: "ok",
		why: "an ordinary utility over piped file names",
	},
	{
		label: "xargs with no command (negative control)",
		cmd: "echo a b | xargs",
		expected: "ok",
		why: "xargs runs echo by default",
	},
	{
		label: "find -exec running wc (negative control)",
		cmd: "find . -name '*.ts' -exec wc -l {} +",
		expected: "ok",
		why: "an ordinary utility over found names",
	},
	{
		label: "an unresolvable wrapper reading a pipe",
		cmd: "echo x | env -x cat",
		expected: "refused",
		cause: "unresolved-wrapper",
		why: "an unknown env option may hide a code runner that reads the pipe",
	},
	{
		label: "awk system()",
		cmd: "awk 'BEGIN{system(\"git push origin feat:main\")}'",
		expected: "refused",
		cause: "command-string-program",
		why: "awk's system() runs a shell command",
	},
	{
		label: "gawk command piped to getline",
		cmd: "gawk 'BEGIN{\"id\" | getline x}'",
		expected: "refused",
		cause: "command-string-program",
		why: "a string piped to getline is a command",
	},
	{
		label: "awk print piped to a command",
		cmd: "awk '{print $0 | \"sh\"}' f",
		expected: "refused",
		cause: "command-string-program",
		why: "print into a pipe runs the command",
	},
	{
		label: "GNU sed e command",
		cmd: "sed -n '1e git push origin feat:main' package.json",
		expected: "refused",
		cause: "command-string-program",
		why: "the e command runs a shell command",
	},
	{
		label: "GNU sed s///e flag",
		cmd: "sed 's/.*/date/e' f",
		expected: "refused",
		cause: "command-string-program",
		why: "the e flag runs the pattern space as a command",
	},
	{
		label: "sed writing to a device",
		cmd: "sed -n 'w /dev/fd/3' f",
		expected: "refused",
		cause: "command-string-program",
		why: "w /dev/... writes to a descriptor or device",
	},
	{
		label: "tar --to-command",
		cmd: "tar -cf /dev/null --to-command='git push origin feat:main' x",
		expected: "refused",
		cause: "command-string-program",
		why: "tar runs the command for each member",
	},
	{
		label: "tar -I",
		cmd: "tar -I 'sh -c x' -xf a.tar",
		expected: "refused",
		cause: "command-string-program",
		why: "-I names a compression program to run",
	},
	{
		label: "tar --use-compress abbreviation",
		cmd: "tar --use-comp='sh -c x' -xf a.tar",
		expected: "refused",
		cause: "command-string-program",
		why: "GNU tar accepts any unambiguous prefix of a long option",
	},
	{
		label: "rsync -e",
		cmd: "rsync -e 'git push origin feat:main #' a b:c",
		expected: "refused",
		cause: "command-string-program",
		why: "-e names the remote shell rsync runs",
	},
	{
		label: "rsync -e in a cluster",
		cmd: "rsync -avze 'sh -c x' a b:c",
		expected: "refused",
		cause: "command-string-program",
		why: "a bundled e still takes the shell",
	},
	{
		label: "bat --pager",
		cmd: "bat --paging=always --pager='git push origin feat:main' README.md",
		expected: "refused",
		cause: "command-string-program",
		why: "bat runs its pager",
	},
	{
		label: "less",
		cmd: "less '+!git push origin feat:main' README.md",
		expected: "refused",
		cause: "command-string-program",
		why: "an interactive pager can run commands",
	},
	{
		label: "vim",
		cmd: "vim -c '!git push origin feat:main' -c q",
		expected: "refused",
		cause: "command-string-program",
		why: "an editor can run commands",
	},
	{
		label: "make --eval",
		cmd: "make --eval='x:;git push origin feat:main' x",
		expected: "refused",
		cause: "command-string-program",
		why: "--eval adds a rule whose recipe runs",
	},
	{
		label: "make -f -",
		cmd: "echo 'x:;id' | make -f - x",
		expected: "refused",
		cause: "command-string-program",
		why: "the makefile comes from stdin",
	},
	{
		label: "sort --compress-program",
		cmd: "sort --compress-program='git push origin feat:main' x",
		expected: "refused",
		cause: "command-string-program",
		why: "sort runs the compressor",
	},
	{
		label: "awk under xargs",
		cmd: "ls | xargs awk 'BEGIN{system(\"id\")}'",
		expected: "refused",
		cause: "command-string-program",
		why: "the command xargs runs is classified too",
	},
	{
		label: "plain awk (negative control)",
		cmd: "awk -F, '{print $2}' data.csv",
		expected: "ok",
		why: "an awk program that runs nothing",
	},
	{
		label: "awk with a logical or (negative control)",
		cmd: "awk '$1 == \"a\" || $1 == \"b\" {print}' f",
		expected: "ok",
		why: "|| is not a pipe",
	},
	{
		label: "plain sed (negative control)",
		cmd: "sed -n '1,5p' f",
		expected: "ok",
		why: "printing lines runs nothing",
	},
	{
		label: "sed -i substitution with e in the text (negative control)",
		cmd: "sed -i 's/e/x/g' f",
		expected: "ok",
		why: "an e inside the pattern is not the e flag",
	},
	{
		label: "sed delete (negative control)",
		cmd: "sed '/^#/d;/^$/d' f",
		expected: "ok",
		why: "d is not e",
	},
	{
		label: "plain tar (negative control)",
		cmd: "tar -czf out.tgz src",
		expected: "ok",
		why: "no program option",
	},
	{
		label: "plain rsync (negative control)",
		cmd: "rsync -avz src/ dst/",
		expected: "ok",
		why: "no remote shell option",
	},
	{
		label: "plain bat (negative control)",
		cmd: "bat --paging=never README.md",
		expected: "ok",
		why: "no pager runs",
	},
	{
		label: "plain sort and make (negative control)",
		cmd: "sort -u f && make test",
		expected: "ok",
		why: "no command-string option",
	},
	{
		label: "python one-liner opening a file for write",
		cmd: "python -c \"open('.git/hooks/pre-commit','w').write('x')\"",
		expected: "refused",
		cause: "inline-code-effect",
		why: "inline code that opens a file can write anywhere",
	},
	{
		label: "python one-liner reading a secret",
		cmd: "python -c \"print(open('.env').read())\"",
		expected: "refused",
		cause: "inline-code-effect",
		why: "open() reads a path the classifier never sees",
	},
	{
		label: "python one-liner starting a process",
		cmd: "python3 -c \"import subprocess; subprocess.run(['ls'])\"",
		expected: "refused",
		cause: "inline-code-effect",
		why: "subprocess starts a program",
	},
	{
		label: "node one-liner writing a file",
		cmd: "node -e \"require('fs').writeFileSync('x','y')\"",
		expected: "refused",
		cause: "inline-code-effect",
		why: "fs writes a file",
	},
	{
		label: "node one-liner through a dynamic import",
		cmd: "node -e \"import('node:fs').then((m) => m.rmSync('x'))\"",
		expected: "refused",
		cause: "inline-code-effect",
		why: "a dynamic import loads fs",
	},
	{
		label: "perl one-liner calling system",
		cmd: "perl -e 'system(\"id\")'",
		expected: "refused",
		cause: "inline-code-effect",
		why: "system starts a program",
	},
	{
		label: "perl one-liner with backticks",
		cmd: "perl -e 'print `id`'",
		expected: "refused",
		cause: "inline-code-effect",
		why: "backticks start a program",
	},
	{
		label: "ruby one-liner writing a file",
		cmd: "ruby -e 'File.write(\"x\", \"y\")'",
		expected: "refused",
		cause: "inline-code-effect",
		why: "File writes a file",
	},
	{
		label: "python print (negative control)",
		cmd: "python -c 'print(1)'",
		expected: "ok",
		why: "a pure print",
	},
	{
		label: "node console.log (negative control)",
		cmd: "node -e 'console.log(1)'",
		expected: "ok",
		why: "a pure print",
	},
	{
		label: "node reading package.json version (negative control)",
		cmd: "node -p \"require('./package.json').version\"",
		expected: "ok",
		why: "requiring a JSON file only parses it",
	},
	{
		label: "python json dumps (negative control)",
		cmd: "python3 -c \"import json; print(json.dumps({'a': 1}))\"",
		expected: "ok",
		why: "a pure computation",
	},
	{
		label: "node stdout write (negative control)",
		cmd: "node -e \"process.stdout.write('x')\"",
		expected: "ok",
		why: "writing to stdout is printing",
	},
	{
		label: "perl print (negative control)",
		cmd: "perl -e 'print \"hi\"'",
		expected: "ok",
		why: "a pure print",
	},
	...PIPE_ROWS,
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
	"~user/bin/git push",
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
	"~/x.sh",
	"~/bin/git status",
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
