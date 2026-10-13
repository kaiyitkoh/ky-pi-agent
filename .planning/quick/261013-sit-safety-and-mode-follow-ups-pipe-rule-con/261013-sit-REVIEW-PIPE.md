---
phase: 261013-sit-safety-and-mode-follow-ups-pipe-rule-con
reviewed: 2026-10-13T00:00:00Z
depth: deep
scope: commit b6dc540 (diff against b6dc540^)
files_reviewed: 4
files_reviewed_list:
  - .pi/extensions/safety/shell.ts
  - tests/unit/shell-deny-list.test.ts
  - tests/fixtures/evasion-corpus.ts
  - docs/SAFETY.md
findings:
  critical: 5
  warning: 7
  info: 2
  total: 14
status: resolved
---

# Quick 261013-sit: Code Review Report (strict pipe rule restore, b6dc540)

**Reviewed:** 2026-10-13
**Depth:** deep
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Bringing back the strict pipe rule is the right call. The strict rule itself (`scan.piped.has(node)` on any `runsCode` invocation) holds up. The new checks around it are mostly text-shaped heuristics, and each one has a gap where it is gated or parsed. Five of those gaps fail open. Three of the five are new checks that miss the most common launcher or option form. Over-refusals of everyday commands were confirmed with `.probe.mts`. The two most serious are deleting a `.pyc`/`.py` before running Python, and `2>/dev/null` making the word `null` count as a written file. Two new tests pass because a different rule fires, not the one they name.

Verdicts marked "probed" were checked with `node .probe.mts`. The others come from reading the code path end to end. This review describes the fail-open gaps by their structure and gives no working payloads.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: The startup-variable check only fires when a listed code runner is present, so `npm`/`pnpm`/`yarn`/`make` honour `NODE_OPTIONS` unchecked

**File:** `.pi/extensions/safety/shell.ts:774-775`
**Fix status:** fixed in dbac8c5.
**Issue:** `setsStartupVariable` returns true only when `runsCode(inv)` or a wrapped command runs code. `npm`, `pnpm`, `yarn`, `npx`-less `vitest`/`tsc`/`jest`, `make` and `pip` are not in `CODE_RUNNER_NAMES`, but each one starts Node or Python and inherits `NODE_OPTIONS`, `PYTHONSTARTUP` and the rest. Probed: `NODE_OPTIONS=--require=./setup.js npm test` returns **ok**. A `--require`/`--import` (including `data:` URLs) set this way loads code the guard never sees. The `NODE_OPTIONS_BENIGN` carve-out and the SAFETY.md example (`NODE_OPTIONS=--max-old-space-size=4096 npm run build`) suggest this case was meant to be covered.
**Fix:** Refuse a non-benign startup variable no matter what the executable is. The variable itself is the risk:
```ts
const setsStartupVariable = (command: string): boolean =>
	STARTUP_VARIABLE.test(command.replace(NODE_OPTIONS_BENIGN, ""));
```
If that refuses too much, gate it on a broad launcher set (`npm pnpm yarn bun make pip tox nox rake bundle gem` plus `runsCode`) rather than `runsCode` alone.

### CR-02: `STARTUP_VARIABLE` is case-sensitive, but environment names are case-insensitive on Windows, the primary platform

**File:** `.pi/extensions/safety/shell.ts:719-720`
**Fix status:** fixed in dbac8c5.
**Issue:** Git Bash passes variables to native Windows processes. Windows environment lookups, and Node's `process.env` and getenv on win32, ignore case. A lower-case or mixed-case spelling of `NODE_OPTIONS`, `PYTHONSTARTUP` and the others therefore takes effect but does not match `/\b(BASH_ENV|NODE_OPTIONS|...)\b/`. I did not run this against a live interpreter. The conclusion follows from the regex having no `i` flag.
**Fix:** Add the `i` flag to both `STARTUP_VARIABLE` and `NODE_OPTIONS_BENIGN`. Add a test with a mixed-case name.

### CR-03: `find -exec` / `fd -x` with `{}` as the runner's script operand is not covered by the written-file check

**File:** `.pi/extensions/safety/shell.ts:765, 851-865`
**Fix status:** fixed in dbac8c5.
**Issue:** `inputPicksCode` applies only when the outer command is `xargs` or `parallel`. For `find`/`fd`, `wrappedRefusal` passes a runner whose only argument is `{}` (no inline flag and no stdin alias). In `runsGeneratedScript`, `wrapped.filter(runsCode).some(w => w.args.some(isWritten))` tests the literal `{}`, which never matches a written basename. The written name appears only in `find`'s own `-name` argument, and `mentionsName` is evaluated only for `runsCode(invocation)`, which `find` is not. A script written earlier in the same command and then run through `find ... -exec <shell> {}` comes back **ok**. That is the same gap this commit closed for `xargs`/`parallel`. `writesPythonCode` covers only the Python version of it.
**Fix:** When a wrapped runner's script operand is a placeholder (`{}`, `{/}`, `{.}`, or any word containing `{`), refuse it whenever the command writes any file. Alternatively, run `mentionsName` and `isWritten` over the outer `find`/`fd` arguments when any wrapped command `runsCode`.

### CR-04: `programFiles` misses clustered short options and GNU long-option prefixes, so the sed/awk program can still come from stdin or a written file

**File:** `.pi/extensions/safety/shell.ts:731-740`
**Fix status:** fixed in dbac8c5.
**Issue:** The match is `a === n || a.startsWith(n)`. sed and gawk parse options with getopt, so `-f` can come after other flags in one word (`-n` plus `f`, or `-E` plus `n` plus `f`). Those words do not start with `-f`, and the next word, which is the program file, is never examined. `sedScripts` and `commandStringProgram` see no inline script in that case, and sed is not a code runner, so the command passes. GNU sed's `e` command runs a shell, so this restores what the check was added to block. In the same function, the long forms ignore the unambiguous-prefix rule that this file already handles elsewhere with `longOptionIn` (for example `--fi=`).
**Fix:** Parse short clusters. If an option word matches `^-[^-]*f$` (sed: `^-[nrsuzEf]*f$`), the next word is the program file. If `f` appears inside the cluster, the rest of the word is the program file. Use `longOptionIn(a, ["--file"])` / `["--file", "--exec"]` for the long forms. Add corpus entries for the clustered form, both with a stdin alias and with a written file.

### CR-05: A privilege shell with no command (`sudo -s`, `sudo -i`, `doas -s`) is only refused on a pipe, not when its stdin is redirected from a written file

**File:** `.pi/extensions/safety/shell.ts:751-760`
**Fix status:** fixed in dbac8c5.
**Issue:** The new branch `executable === "" && invocation.wrappers.length > 0 && scan.piped.has(node)` covers only a pipe. Two other paths miss it:
- `runners.length > 0` gates the compound-read/stdin-rebind check, and `runsCode` of an empty executable is false.
- The command's own `<` redirect (`stdinFiles`) is checked only after `if (!runsCode(invocation)) return false`.

So a same-command-written file fed to `sudo -s` through `<`, or through `exec 0<`, comes back **ok**. That bypasses the stdin-is-code rule with a root shell. `su` is safe only because it happens to be in `CODE_RUNNER_NAMES`.
**Fix:** Treat an empty executable behind a wrapper as a code runner everywhere, not only for pipes:
```ts
const shellWithoutCommand = (e: ExtractedInvocation) =>
	normaliseExecutable(e.invocation.executable) === "" && e.invocation.wrappers.length > 0;
const runners = extracted.filter((e) => runsCode(e.invocation) || shellWithoutCommand(e));
// and in the per-invocation callback, before `if (!runsCode(...))`:
if (shellWithoutCommand({ invocation, node } as ExtractedInvocation) && (scan.piped.has(node) || stdinFiles.some(isWritten))) return true;
```

## Warnings

### WR-01: Deleting a Python file counts as writing importable code, so `rm -f x.pyc && pytest` is refused

**File:** `.pi/extensions/safety/shell.ts:743-749, 760`
**Fix status:** fixed in dbac8c5. Deletions do not count as writes; edit-then-test is listed as a known false positive.
**Issue:** `writtenPaths` includes `writeOperands`, which returns the targets of `rm`, `rmdir`, `shred`, `truncate` and `touch`. Removing a file cannot inject code. Probed refusals: `rm -f src/cache.pyc && python main.py`, and `sed -i 's/foo/bar/' src/app.py && pytest -q`. The `sed -i`/`perl -pi` edit-then-test loop is one of the agent's most common shapes. Refusing it is defensible, since the edited code is not inspected, but SAFETY.md does not list it as a known false positive.
**Fix:** Exclude deletions (`rm`, `rmdir`, `shred`) from `writesPythonCode`, and probably from `written` altogether. Add `sed -i ... x.py && pytest` to the documented false positives, and suggest splitting it into two tool calls.

### WR-02: Startup variables are matched in the raw command text, so any mention refuses

**File:** `.pi/extensions/safety/shell.ts:774-775`
**Fix status:** fixed in dbac8c5.
**Issue:** `STARTUP_VARIABLE.test(command)` matches the name anywhere: in grep patterns, in echo arguments, or in a path. Probed refusals: `grep -rn PYTHONSTARTUP docs/ && python x.py`, `grep -r NODE_OPTIONS . ; node x.js` and `echo $PERL5LIB && perl x.pl`. Searching the repo for these variable names and then running a script is a normal debugging step.
**Fix:** Match only places that set the variable: prefix `assignmentWords`, `scriptAssignments`, `export`/`declare`/`typeset` arguments, and `env` assignments. Keep the raw-text match only as the fallback when the command cannot be resolved.

### WR-03: `/dev/null` and `/dev/stderr` add `null` and `stderr` to the written set, so option values with those words refuse

**File:** `.pi/extensions/safety/shell.ts:744-746`
**Fix status:** fixed in dbac8c5.
**Issue:** `mentionable` filters out `/dev/` and `nul`, but `written` does not. A `2>/dev/null` therefore makes `isWritten("null")` true. Combined with the new `optionValues`, the probed command `node app.js --default=null 2>/dev/null` is refused. The same happens with `--log stderr ... > /dev/stderr`.
**Fix:** Apply the same filter to both sets:
```ts
const realWrites = writtenPaths.filter((p) => !/^(\/dev\/|nul$)/i.test(p));
const written = new Set(realWrites.map(baseOf));
const mentionable = [...written].filter((b) => b !== "");
```

### WR-04: `REPLACE_OPTION` scans the runner's own arguments and has no end anchor

**File:** `.pi/extensions/safety/shell.ts:848, 853`
**Fix status:** fixed in dbac8c5.
**Issue:** `outer.args.some((a) => REPLACE_OPTION.test(a))` runs over every `xargs` argument, including the wrapped runner's own arguments. The regex `^(-[0oprtx]*[Ii]|--replace)` also has no end anchor. Probed: `ls | xargs python s.py -i` is refused, and any `-include...`, `-I...` or `--replace-all` argument passed to the script is refused too. This fails closed, but it is noisy.
**Fix:** Check only the `xargs`/`parallel` option words before the command index, which `xargsCommand` already computes. Return that index, or have `xargsCommand` report `replace: boolean`.

### WR-05: Two new tests pass through a different rule from the one they name

**File:** `tests/unit/shell-deny-list.test.ts` (rows "stdin rebind: exec 0< a written file" and "input runner: xargs reads a written arg file")
**Fix status:** fixed in dbac8c5. The exec row uses a non-Python file and a shell; the xargs row is relabelled for the rule that fires.
**Issue:**
- `echo x > p.py; exec 0<p.py; python3` is refused by `writesPythonCode` (the file name ends in `.py`), so the `stdinRebinds` code never decides the outcome.
- `echo x > f; xargs -a f sh` is refused by `inputPicksCode` (`sh` has no operand), not by any written-file logic.

Both regression guards would stay green if their feature were deleted.
**Fix:** Use a name that is not Python and a runner that does not hit `writesPythonCode`, for example `echo x > p; exec 0<p; sh`. For the xargs row, use a fixed script operand together with a written arg file, or relabel the row so it names the rule that actually fires.

### WR-06: Wrong comment, and too narrow a match, for the stdin-rebind check

**File:** `.pi/extensions/safety/shell.ts:747-748`
**Fix status:** fixed in dbac8c5.
**Issue:**
- The comment says "a bare `< f` rebind[s] stdin for every later command". That is false in bash: a redirect-only statement opens and closes the file and affects nothing afterwards. Only `exec` persists. AGENTS.md says a wrong comment is worse than none, and the false premise also causes an over-refusal.
- The `exec` test is `c.name.value === "exec"`. It is not normalised and does not look through wrappers, so `builtin exec 0<f` and `command exec 0<f` are not seen.

**Fix:** Drop `c.name === undefined` and change the comment to "`exec 0<f` rebinds stdin for every later command". Match `exec` after wrapper resolution, using the extracted invocation whose `executable` normalises to `exec` with no arguments.

### WR-07: The startup-variable list is inconsistent about library-path variables

**File:** `.pi/extensions/safety/shell.ts:719`
**Fix status:** fixed in dbac8c5. LD_PRELOAD, DYLD_INSERT_LIBRARIES and JAVA_TOOL_OPTIONS added; search-path variables (PERL5LIB dropped) are documented as choosing only among existing files.
**Issue:** `PERL5LIB` is listed, but the equivalent search-path and preload variables for the other runners are missing: `RUBYLIB`, `NODE_PATH`, `PYTHONPATH`, `PYTHONHOME`, `PYTHONUSERBASE`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES` and `JAVA_TOOL_OPTIONS`. Each one makes a runner load code it was not asked to load. `writesPythonCode` covers part of the Python case, but only when the file is written in the same command.
**Fix:** Either add these names, or document in SAFETY.md why only `PERL5LIB` among the library-path variables is listed.

## Info

### IN-01: `mentionsName` is a lexical heuristic with uneven boundaries

**File:** `.pi/extensions/safety/shell.ts:728`
**Fix status:** fixed in dbac8c5.
**Issue:** The left boundary excludes `.` and `-`, but the right boundary excludes only `.`. The escaping is correct. Any matcher keyed on the literal name misses a file name that inline code builds at runtime. Only `INLINE_CODE_EFFECT` covers that, and only for the runners it knows. The comment does not say that the check is best-effort.
**Fix:** Make the two boundaries symmetric, or document why they differ. Add "best-effort; a computed name is not seen" to the SAFETY.md residuals.

### IN-02: SAFETY.md's known-false-positive list is incomplete

**File:** `docs/SAFETY.md` (generated-script paragraph)
**Fix status:** fixed in dbac8c5.
**Issue:** It lists `cat data.json | python script.py`, `python -m json.tool` on a pipe and `python gen.py > out.py`. It does not list the confirmed refusals of edit-then-test (WR-01), mentions of variable names (WR-02), `/dev/null` (WR-03), and a data file passed as an argument after the same command writes it (`echo data > input.txt && python solve.py input.txt`, which was already refused before this commit).
**Fix:** Extend the list, or fix WR-01 to WR-03 and then list what remains.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
