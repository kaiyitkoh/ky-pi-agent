---
phase: quick-261013-sit
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .pi/extensions/safety/shell.ts
  - .pi/extensions/safety/infra.ts
  - .pi/extensions/safety/branches.ts
  - .pi/extensions/safety/index.ts
  - .pi/extensions/safety/subagents.ts
  - .pi/lib/settings.ts
  - .pi/extensions/routing/modes.ts
  - .pi/extensions/routing/index.ts
  - .pi/extensions/routing/agent-overrides.ts
  - .pi/extensions/providers/fallback.ts
  - .pi/extensions/grill/scorecard.ts
  - .pi/extensions/grill/index.ts
  - .pi/extensions/plan-ceremony/index.ts
  - .pi/extensions/review/index.ts
  - .pi/extensions/review/mr.ts
  - .pi/extensions/execute/index.ts
  - .pi/extensions/workflows/index.ts
  - .pi/extensions/quality/index.ts
  - tests/fixtures/evasion-corpus.ts
  - tests/unit/shell-deny-list.test.ts
  - tests/unit/infra-policy.test.ts
  - tests/unit/protected-branches.test.ts
  - tests/unit/subagent-guard.test.ts
  - tests/unit/agent-overrides.test.ts
  - tests/unit/default-mode.test.ts
  - tests/unit/workflow-budgets.test.ts
  - tests/integration/ceremony-gates.test.ts
  - tests/integration/fallback-chain.test.ts
  - tests/integration/quick-workflow.test.ts
  - tests/integration/review-command.test.ts
  - tests/integration/mode-switch.test.ts
  - docs/SAFETY.md
  - docs/WORKFLOWS.md
  - docs/ROUTING.md
  - docs/QUALITY.md
  - .planning/CODE-REVIEW-v1.0.md
  - .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-A.md
  - .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-A3.md
  - .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-B.md
  - .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-BC2.md
  - .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-BC3.md
  - .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-C.md
autonomous: true
requirements: [SAFE-03, SAFE-07, SAFE-11, EXT-01, QUAL-08, ROUTE-02, FLOW-08]

must_haves:
  truths:
    - "`cat data.json | python script.py`, `curl -s u | python -m json.tool`, `X | node s.js`, `X | bash s.sh` and `X | python -c \"import sys,json; print(json.load(sys.stdin))\"` are allowed"
    - "`curl … | sh`, bare `| python`/`| node`/`| perl`/`| ruby`, `| bash -s`, any `-i`, `PYTHONINSPECT=`, script operand `-`/`/dev/stdin`, unknown options before the script, `| sh -c sh`, `| bash -c 'bash -s'`, and piped inline code that evaluates its input are still refused with cause generated-script"
    - "cmd, pwsh/powershell, busybox, parallel and osascript on a pipe are refused whatever their arguments"
    - "`python -m foo` is refused when the same command wrote foo.py or anything under foo/"
    - "`terraform -chdir=infra plan` and `terraform -chdir=infra validate` are allowed; `terraform -chdir=infra apply` still confirms"
    - "safety.protectedBranches / safety.pushProtectedBranches in user or project settings ADD branches to the built-ins; main stays first; a malformed value keeps the defaults and warns"
    - "/grill and /plan both allow exactly HARD_QUESTION_BUDGET working turns plus one final write turn, then disarm; Esc-aborted turns still do not count"
    - "A fresh session (startup or /new) resets mode to DEFAULT_MODE unescalated and switches the executor to its routed model unless --model/--provider/--models or a saved default model chose one"
    - "/quick warns instead of refusing on an overfull context, like the input backstop and /execute"
    - "Every fallback hop runs the capability guard and a refused hop is skipped with its reason"
    - "/mode and the subagent pin pick models with one shared function, so /mode's re-pin advice is only shown when re-running would change the pin"
    - "/review computes baseTypecheckFailed at the merge base only when the HEAD typecheck fails"
    - "The subagent child guard resolves pi-subagents from the loaded `subagent` tool's own source path, falling back to the two npm roots, and still refuses launches when nothing resolves"
  artifacts:
    - path: ".pi/extensions/safety/shell.ts"
      provides: "stdinIsCode + piped inline check + -m module write check"
      contains: "stdinIsCode"
    - path: ".pi/extensions/safety/branches.ts"
      provides: "effective protected-branch lists from built-ins + user + project settings"
      exports: ["effectiveBranches", "protectedBranchesFor"]
    - path: ".pi/lib/settings.ts"
      provides: "shared settings-file key reader reused by routing and safety"
      exports: ["readSettingValue"]
    - path: "tests/unit/protected-branches.test.ts"
      provides: "merge, de-dup, ordering and malformed-setting cases"
    - path: "tests/unit/default-mode.test.ts"
      provides: "fresh-session default-mode predicate cases"
  key_links:
    - from: ".pi/extensions/safety/shell.ts#runsGeneratedScript"
      to: "stdinIsCode"
      via: "scan.piped.has(node) && stdinIsCode(...)"
      pattern: "piped\\.has\\(node\\) && stdinIsCode"
    - from: ".pi/extensions/safety/index.ts#buildFacts"
      to: ".pi/extensions/safety/branches.ts#effectiveBranches"
      via: "facts.protectedBranches / pushProtectedBranches"
      pattern: "effectiveBranches\\("
    - from: ".pi/extensions/routing/modes.ts#runSingleShotRole"
      to: ".pi/extensions/providers/fallback.ts#callWithFallback"
      via: "per-hop guard callback"
      pattern: "callWithFallback\\(ctx, \\{[\\s\\S]*\\}, "
---

<objective>
Safety and mode follow-ups, all user-approved: (1) narrow the pipe-into-interpreter refusal to the cases where stdin is read as code; (2) configurable, add-only protected branches; (3) one question/turn budget rule for /grill and /plan; (4) fix or record every remaining deferred v1.0 finding.

Purpose: remove the two highest-friction false positives (piped data into a script, terraform -chdir) without opening a bypass, and close the v1.0 deferred-finding list with decisions.
Output: code + tests + docs in three atomic commits, then one docs commit recording every finding's status.
</objective>

<execution_context>
@C:/Users/Admin/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/Admin/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@./AGENTS.md
@CONTRIBUTING.md
@.planning/STATE.md

Rules that bind every task (AGENTS.md): comments are terse WHY only, no finding/plan/phase IDs or history in code comments; stage explicit paths, never `git add -A`; never push; register no new LLM-facing tool; tests run as `npx vitest run <files> --maxWorkers=2`, one invocation at a time, never the full suite (the orchestrator runs it once at the end). Do not commit PLAN/SUMMARY/STATE.

Directory and per-file line budgets live in tests/unit/workflow-budgets.test.ts (`.pi/extensions/safety` is at 4066/4080 raw lines; `routing/index.ts` 422/430; `review/index.ts` ~170/170; `.pi/lib` 792/800). When a task's growth fails that test, raise the failing WORKFLOW_BUDGETS/DIRECTORY_BUDGETS entry to ceil(actual/10)*10 and append one dated sentence "RAISED X -> Y: <cause>; N raw lines" to its `why`, as earlier entries do. A new file under a budgeted directory may need DIRECTORY_BUDGETS coverage; the test says so. Never touch FEATURES_CEILINGS or WORKFLOW_TEXT_BUDGETS numbers: if a frozen ceiling fails, move logic out of the capped file instead (for /review, into quality/index.ts).

Pi 1.1.0 facts verified at source for this plan (cite these, do not re-derive):
- `SessionStartEvent.reason` is `"startup" | "reload" | "new" | "resume" | "fork"` (node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:562-568).
- `pi.getSettings()` returns global+project merged (types.d.ts:1261-1262), and the merge replaces arrays rather than concatenating them (dist/core/settings-manager.js:19-33), so a project list would hide a user list; the settings manager also empties project settings for an untrusted project (settings-manager.js:349). Hence the branch lists read both files directly.
- `getAgentDir()` and `CONFIG_DIR_NAME` are exported (dist/config.d.ts:98,106).
- Extension `pi.setModel` returns false without auth and never persists a default (dist/core/agent-session.js:2743-2748); it appends a `model_change` entry (agent-session.js:1953).
- CLI model flags are `--provider`, `--model`, `--models` (dist/cli/args.js:63-102).
- `pi.getAllTools()` returns `ToolInfo` with `sourceInfo: SourceInfo` (types.d.ts:1553-1558; `SourceInfo.path` at dist/core/source-info.d.ts:4-10); an extension's tools carry the extension's own sourceInfo, whose path is the extension entry file (dist/core/extensions/loader.js:236-239, dist/core/resource-loader.js:696-707).

<interfaces>
From .pi/extensions/safety/shell.ts (current):
- `runsGeneratedScript(extracted, scan)` at :703-718; the line to change is :716 `return scan.piped.has(node) || invocation.args.some((a) => STDIN_ALIAS.test(a)) || [...invocation.args, ...stdinFiles].some(isWritten);`
- `CAUSE_DETAIL["generated-script"]` at :351-352.
- Available: `INLINE_CODE_FLAGS` (:682-690), `CODE_RUNNER_NAMES`/`isCodeRunner` (:692-696), `STDIN_ALIAS` (:698), `SHELL_RUNNERS` (:30-34), `SHELL_INLINE` (:678), `SCRIPT_INLINE` (:679), `INLINE_CODE_EFFECT`/`INLINE_CODE_BENIGN` (:879-888), `wrappedCommands` (:762), `canonicalise` (:900), `normaliseExecutable` (:207), `writeOperands` (:639). `CanonicalInvocation.assignmentWords` holds both statement-prefix and `env NAME=v` wrapper assignments (:523).
From .pi/extensions/safety/infra.ts: `subcommandKey(args, twoWordParents)` :142-144; `classifyTerraformInvocation(args)` :158-167; `TERRAFORM_ALLOW_SUBCOMMANDS` :110-116.
From .pi/extensions/safety/index.ts: `PROTECTED_BRANCHES` :32, `PUSH_PROTECTED_BRANCHES` :35, `buildFacts` :70-85 (passes them at :78-79), session_start :491-508 (calls `registerChildGuard(sessionId, entryPath, ctx.cwd)`).
From .pi/extensions/safety/policy.ts:266: `facts.protectedBranches[0]` is used as "the" protected branch for an unknown cd target; index 0 must stay `main`.
Consumers of `PROTECTED_BRANCHES` (all `{ currentBranch: currentBranch(ctx.cwd), protectedBranches: PROTECTED_BRANCHES }` commit checks): grill/index.ts:99, plan-ceremony/index.ts:88, review/index.ts:59, execute/index.ts:58, workflows/index.ts:36; plus review/mr.ts:193 `classifyGlabInvocation(..., PROTECTED_BRANCHES)` inside `attemptMr(input, deps)` where `deps.cwd` exists.
From .pi/extensions/safety/subagents.ts: `loadRequiredChildModule(cwd)` :73-84 tries `join(getAgentDir(),"npm")` then `join(cwd, CONFIG_DIR_NAME, "npm")` + `REGISTRY_ENTRY` (:56); `registerChildGuard(sessionId, safetyEntryPath, cwd)` :87-112; test seam `setRequiredChildLoaderForTests`.
From .pi/extensions/routing/modes.ts: `bedrockProfilePrefix(settingsPath)` :113-133 (the repo's existing settings reader: JSON.parse of the agent settings file, parse error treated as absent); `getModeState`/`setMode`/`setEscalated` :71-91; `pickConfiguredCandidate(registry, candidates, opts)` :155; `planRoleCall` :215-235 (guards with `{ ...opts.need, usesToolLoop: usesToolLoop(opts.role) }`); `runSingleShotRole` :287-328 (enters `callWithFallback` only when the resolved model is CHAIN[0]).
From .pi/extensions/routing/index.ts: `applyMode` :36-121 (calls `agentOverridesFor({ mode }, testOverrides?.agentOverridesFor)` :96); `reportMode` :219-244 (compares `readAgentOverride(agent)` with `pickConfiguredCandidate` result :235-239); `restoreModeFromBranch` :258-275 (returns early when no entry; tests in mode-persistence.test.ts case 3b require a null-data payload to leave state untouched, so do NOT change this function); session_start :381-401 (sync, NEVER THROWS).
From .pi/extensions/routing/agent-overrides.ts: `agentOverridesFor(state, opts)` :59-114 (guard-only, no auth check); `AgentOverridesForOptions` :48-54; imports `resolveBedrockRef` from ./modes.ts already.
From .pi/extensions/providers/fallback.ts: `callWithFallback(ctx, opts)` :71-136; `CHAIN` in providers/schema.ts:67-70 (deepseek 1M window, then dashscope 393k).
From .pi/extensions/routing/guard.ts: `guardRoute(model, role, need): GuardVerdict` :94; `GuardVerdict = {ok:true} | {ok:false; reason}` :10; `deriveNeed(ctx, extra)` :66-79.
From .pi/extensions/grill: `HARD_QUESTION_BUDGET = 5` and `nextQuestionSlot` (scorecard.ts:75-76, :121-138; exhausted at asked >= 5); grill/index.ts:165 disarms at `asked > HARD_QUESTION_BUDGET`; plan-ceremony/index.ts:145 disarms at `turns >= HARD_QUESTION_BUDGET`.
From .pi/extensions/quality/index.ts: `runTypecheckAt(cwd, projectTrusted): LegStatus` :148-156; `repoTop(cwd)` :115-118; `runChangeGateStage({cwd, projectTrusted, baseSha, changed, baseTypecheckFailed})` :260-296; test seam EXEC_OVERRIDE_KEY used by `resolveExec` :99-111.
From .pi/extensions/workflows/index.ts:26: `/quick` passes `deriveNeed(ctx, { promptChars })` (with context usage) to `planRoleCall`; execute/index.ts:113 drops `estimatedInputTokens`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pipe rule refuses only when stdin is code; terraform -chdir allowed</name>
  <files>.pi/extensions/safety/shell.ts, .pi/extensions/safety/infra.ts, tests/fixtures/evasion-corpus.ts, tests/unit/shell-deny-list.test.ts, tests/unit/infra-policy.test.ts, tests/unit/workflow-budgets.test.ts, docs/SAFETY.md</files>
  <behavior>
    shell-deny-list TABLE rows (canonicalise verdict):
    - ok: `cat data.json | python script.py` (flip the existing refused row at :412-417), `curl -s https://example.invalid | python -m json.tool`, `cat x | python3 -u -W ignore script.py`, `cat x | node s.js`, `cat x | node --no-warnings s.js`, `cat x | bash s.sh`, `cat x | bash -e s.sh`, `cat x | python -c "import sys,json; print(json.load(sys.stdin))"`, `echo | node -e 'process.stdin.pipe(process.stdout)'` (flip the existing refused row at :419-424), `cat x | perl -ne 'print if /a/'`, `cat x | ruby -e 'puts STDIN.read.upcase'`, `cat x | sh -c 'cat > out.txt'`, `cat x | deno run s.ts`.
    - refused generated-script: `cat x | python`, `cat x | node`, `cat x | perl`, `cat x | ruby`, `cat x | python -u`, `cat x | bash -s`, `cat x | bash -s arg`, `cat x | bash -i s.sh`, `cat x | python -i s.py`, `cat x | perl -pi -e 's/a/b/'`, `cat x | PYTHONINSPECT=1 python s.py`, `cat x | env PYTHONINSPECT=1 python s.py`, `cat x | python -`, `cat x | python --frob s.py` (unknown option), `cat x | node --frob s.js`, `cat x | perl -x`, `cat x | deno repl`, `cat x | ruby -e 'eval STDIN.read'`, `cat x | perl -e 'eval join "", <STDIN>'`, `cat x | node -e "process.stdin.on('data', d => (0,eval)(String(d)))"`, `cat x | python -c "import pickle,sys; pickle.loads(sys.stdin.buffer.read())"`, `cat x | cmd //c s.bat`, `cat x | pwsh -File s.ps1`, `cat x | busybox sh s.sh`, `cat x | osascript s.scpt`; existing `| sh -c sh`, `| bash -c 'bash -s'`, `| bash /dev/stdin`, `| python3 /dev/stdin`, `curl … | sh` rows keep passing.
    - -m write check: `echo x > foo.py; cat d | python -m foo` refused; `echo x > foo/__main__.py; python -m foo` refused (no pipe); `python -m foo` alone ok.
    infra-policy: `terraform -chdir=infra plan` allow, `terraform -chdir=infra validate` allow, `terraform -chdir=a -chdir=b fmt` allow, `terraform -version` allow, `terraform -help` allow, `terraform -chdir=infra apply` confirm, `terraform -chdir=infra state rm x` confirm, `terraform -chdir=infra` confirm (no subcommand), `terraform -chdir=infra show -json` sensitive-read.
  </behavior>
  <action>
Write the failing rows first (TABLE rows in tests/unit/shell-deny-list.test.ts with `expected` and `cause`; BLOCKED rows in tests/fixtures/evasion-corpus.ts from EV-258 onward, class "heredoc-to-script" or "nested-shell", reason "generated-script", one-sentence `why`, reference "safety/shell.ts#runsGeneratedScript"; add one BLOCKED row `terraform -chdir=infra apply -auto-approve` with verdict "confirm", class "infra", reference "safety/infra.ts#classifyTerraformInvocation"; infra rows in tests/unit/infra-policy.test.ts following its existing table shape). Run them, see them fail, then implement.

shell.ts, per the user's pipe rule:
1. Add `ALWAYS_STDIN_CODE = wordSet("cmd pwsh powershell busybox parallel osascript")`.
2. Add `function stdinIsCode(executable: string, args: readonly string[], assignmentWords: readonly string[]): boolean` (executable already normalised). Return true when: the executable is in ALWAYS_STDIN_CODE; any assignment word starts with `PYTHONINSPECT=`; or the per-interpreter scan below finds stdin read as code. Scan args left to right: `--` makes the next word the script operand (none -> true); a word not starting with `-` is the script operand; `-` or any STDIN_ALIAS word as the operand -> true; reaching the end with no operand and no inline/-m -> true (bare runner or options only). Option grammar per family, everything not listed -> true (fail closed):
   - shells (sh bash zsh dash ksh mksh ash csh tcsh fish): a single-dash cluster containing `s` or `i` -> true; a cluster matching SHELL_INLINE (`-c`, `-ec`, `-lc`) -> inline (step 3) with the next word as code; other clusters must use only letters from `aefhklmnpuvxBCEHPT`; `-o`/`+o` take a value word; long `--login --norc --noprofile --posix` boolean, `--rcfile`/`--init-file` take a value.
   - python family (`/^(python[\d.]*|py|pypy[\d.]*)$/`): `-c` -> inline; `-m` or attached `-mNAME` -> allowed (not code), record the module for step 4; `-i` or any cluster containing `i` -> true; boolean `-u -B -E -s -S -O -OO -q -I -P -b -bb -d -R -v -x`; value `-W -X` (next word or attached).
   - node/deno/bun: for deno and bun drop a leading `run` subcommand; `-e -p --eval --print` and deno's `eval` -> inline; `-i`/`--interactive` -> true; boolean `--no-warnings --enable-source-maps --trace-warnings --trace-uncaught --no-deprecation --expose-gc --preserve-symlinks -q --quiet --no-check -A` and any `--allow-*`/`--unstable*`/`--input-type=*`; value `-r --require --import --loader --experimental-loader --env-file --conditions -C --max-old-space-size --title` (next word or `--name=value`); the script operand must look like a path (contains `.`, `/` or `\`), so `deno repl`/`bun repl` -> true.
   - perl, ruby: a cluster containing `i` or `x` -> true; a cluster matching SCRIPT_INLINE (`-e`, `-ne`, `-lne`, `-pe`, `-E`) -> inline; other clusters use only `wWtTnpalc0s` (perl) or `wWnpalc` (ruby); value `-I -M -m` (perl) / `-I -r -E` (ruby), next word or attached.
   - php: `-r` -> inline; `-f FILE` makes FILE the script operand; boolean `-n -q`; value `-d -c -z`.
   - any other code runner (lua, Rscript, …): the first word must be the script operand; any option first -> true.
3. Inline code on a pipe: add `function pipedInlineRunsInput(executable: string, code: string): boolean`. Shells: `const inner = canonicalise(code)`; true if `inner.kind === "refused"` or any inner invocation, or any of its `wrappedCommands(...)`, normalises to a code runner (`isCodeRunner`) or a SHELL_RUNNERS member (this keeps `| sh -c sh` and `| bash -c 'bash -s'` refused). Script runners: true if `PIPED_INLINE_EVAL` matches, a new regex covering evaluators and deserializers that need no parenthesis: words `eval exec\w* compile instance_eval class_eval module_eval instance_exec class_exec Function vm require_relative pickle cPickle marshal Marshal shelve dill yaml YAML Storable`, a `load` not preceded by `.` or a word character (`(?<![.\w])load\b`, so `json.load` stays allowed), and perl `do` followed by a quote, `$` or `<`. The existing `inlineCodeEffect` refusal (canonicalise :919) still runs first for every one-liner, piped or not; do not weaken it.
4. In `runsGeneratedScript` replace `scan.piped.has(node) ||` at :716 with `(scan.piped.has(node) && stdinIsCode(executable, invocation.args, invocation.assignmentWords ?? []))  ||`; keep the STDIN_ALIAS-anywhere and written-file checks unchanged. Extend the same-command-write check for python's `-m NAME`: compute the full written paths once (`[...scan.writeTargets, ...extracted.flatMap((e) => writeOperands(e.invocation))]`, backslashes to `/`, lower-cased); take NAME's first dotted segment `top`; refused if any written path's basename is `top.py` or `top`, or any of its directory segments equals `top`. This applies with or without a pipe.
5. Rewrite CAUSE_DETAIL["generated-script"] (:351-352) to say: a code runner reads its code from a pipe or stdin alias (no script file, -m module or -c/-e code; or -s/-i/PYTHONINSPECT; or a shell/pwsh/cmd/busybox/osascript/parallel on a pipe), or runs a file the same command writes; pass a script file, a module, or inline code that does not evaluate its input. Keep it one template string.

infra.ts (IN-A3-3 fix): in `classifyTerraformInvocation`, drop leading words matching `/^--?chdir=/` before `subcommandKey`; then if the first remaining word is one of `-v -version --version -h -help --help`, return allow (terraform prints and exits); otherwise classify the remainder exactly as today (so `apply` still confirms and `show -json` still dumps). Pass the stripped args to `terraformSecretDump` too. Comment, one line: terraform's only global options precede the subcommand.

docs/SAFETY.md: rewrite the "Scripts the guard cannot read" bullet (~:46-62): a piped code runner is refused only when stdin would be its code (list the refuse cases above), allowed with a script file, `-m module` or inline `-c`/`-e` code that does not evaluate its input; cmd/pwsh/powershell/busybox/parallel/osascript on a pipe always refused; `-m foo` counts foo.py and foo/ as written files. Replace the "Known false positives" sentence: drop `cat data.json | python script.py` and `curl … | python -m json.tool`; keep `X | python script.py -` (a `-` argument anywhere is refused) and unknown interpreter options before the script. Add one residual sentence: inline code on a pipe is checked by a word list of evaluators and deserializers, so an evaluator reached by an unlisted name is not seen. Add terraform: `-chdir=DIR`, `-version` and `-help` are read before the subcommand.

Run tests/unit/workflow-budgets.test.ts; raise the `.pi/extensions/safety` DIRECTORY_BUDGETS entry with one dated sentence naming the pipe grammar and the terraform global options. Commit: `fix(safety): refuse a piped interpreter only when stdin is its code; allow terraform -chdir`.
  </action>
  <verify>
    <automated>npx vitest run tests/unit/shell-deny-list.test.ts tests/unit/evasion-corpus.test.ts tests/unit/infra-policy.test.ts tests/unit/shell-parse.test.ts tests/unit/workflow-budgets.test.ts tests/unit/comment-discipline.test.ts tests/unit/docs-policy.test.ts --maxWorkers=2 && npx tsc --noEmit</automated>
  </verify>
  <done>All behaviour rows pass, every pre-existing piped-refusal row that the user listed as REFUSE still refuses, the two flipped rows are ok, terraform -chdir plan/validate allow while apply confirms, SAFETY.md matches, typecheck clean, one commit.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add-only protected branches from settings; one /grill-/plan turn budget; robust child-guard resolution</name>
  <files>.pi/lib/settings.ts, .pi/extensions/routing/modes.ts, .pi/extensions/safety/branches.ts, .pi/extensions/safety/index.ts, .pi/extensions/safety/subagents.ts, .pi/extensions/grill/scorecard.ts, .pi/extensions/grill/index.ts, .pi/extensions/plan-ceremony/index.ts, .pi/extensions/review/index.ts, .pi/extensions/review/mr.ts, .pi/extensions/execute/index.ts, .pi/extensions/workflows/index.ts, tests/unit/protected-branches.test.ts, tests/unit/subagent-guard.test.ts, tests/integration/ceremony-gates.test.ts, tests/unit/workflow-budgets.test.ts, docs/SAFETY.md, docs/WORKFLOWS.md</files>
  <behavior>
    - protected-branches (temp dirs for agent dir and project, no real settings touched): no settings -> protected ["main","master"], push ["main","master","staging"]; user `safety.protectedBranches: ["release"]` + project `["Release","prod"]` -> protected ["main","master","release","prod"], push ["main","master","staging","release","prod"]; `safety.pushProtectedBranches: ["develop"]` adds to push only; `[" ", "", 3, null, "qa"]` keeps only "qa" with no warning; `"release"` (not an array) or `{}` -> defaults kept plus a warning naming the file and key; unparseable JSON -> defaults kept plus a warning; an entry "MAIN" never moves main from index 0; the user list cannot remove a built-in (there is no removal syntax).
    - subagent-guard: a fake package dir (temp) with package.json name "pi-subagents" and src/api/required-child-extensions.js is found by walking up from a nested entry path given as a subagent source path; a package.json named anything else is skipped; nothing found and both npm roots empty -> registerChildGuard returns ok:false and the launch branch still refuses.
    - ceremony-gates: /grill disarms with an error after HARD_QUESTION_BUDGET + 1 settles (unchanged); /plan stays armed after HARD_QUESTION_BUDGET settles, its turn HARD_QUESTION_BUDGET brief says it is the last turn, and it disarms with an error after HARD_QUESTION_BUDGET + 1 settles; aborted settles count for neither; session_start still disarms both.
  </behavior>
  <action>
Protected branches (closes IN-A-4, per the user's add-only spec):
1. Create `.pi/lib/settings.ts` exporting `readSettingValue(path: string, keys: readonly string[]): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string }` — missing file -> ok with undefined; JSON parse error -> ok:false with the reason; walks `keys` through plain objects, any non-object on the way -> undefined. Refactor `bedrockProfilePrefix` in routing/modes.ts:113-133 to use it, mapping ok:false to undefined so its behaviour is byte-identical (this is the existing reader being reused).
2. Create `.pi/extensions/safety/branches.ts` (named exports only): `BUILTIN_PROTECTED = ["main","master"]`, `BUILTIN_PUSH_ONLY = ["staging"]`; `effectiveBranches(cwd: string, agentDir = getAgentDir()): { protectedBranches: readonly string[]; pushProtectedBranches: readonly string[]; warnings: readonly string[] }` reading `join(agentDir, "settings.json")` then `join(cwd, CONFIG_DIR_NAME, "settings.json")` via `readSettingValue(path, ["safety", key])` for keys `protectedBranches` and `pushProtectedBranches`. Merge order: built-ins, user, project; protected = BUILTIN_PROTECTED + both protectedBranches lists; push = BUILTIN_PROTECTED + BUILTIN_PUSH_ONLY + both protectedBranches lists + both pushProtectedBranches lists (a protected branch is always push-protected). Keep the first spelling, de-dup case-insensitively, trim, skip non-strings and empty strings. A value that is present but not an array, or a file that fails to parse, contributes nothing and adds a warning naming file and key (defaults always survive: fail closed). Also export `protectedBranchesFor(cwd: string): readonly string[]`. One-line WHY comment: files are read directly because Pi's settings merge replaces arrays and drops untrusted project settings, and add-only lists can only tighten.
3. safety/index.ts: keep exporting `PROTECTED_BRANCHES`/`PUSH_PROTECTED_BRANCHES` as the built-ins (tests import them) and re-export `protectedBranchesFor` from ./branches.ts. In `buildFacts` use `effectiveBranches(ctx.cwd)` for both lists (read per call; small files). In session_start compute it once and, for each warning, `writeAuditRow` (event HOOK_AUDIT_EVENT, verdict "block", reason the warning) and `ctx.ui.notify(warning, "warning")` when `ctx.hasUI`.
4. Replace `protectedBranches: PROTECTED_BRANCHES` with `protectedBranches: protectedBranchesFor(ctx.cwd)` at grill/index.ts:99, plan-ceremony/index.ts:88, review/index.ts:59, execute/index.ts:58, workflows/index.ts:36 (keep importing from "../safety/index.ts" so the import edges in workflow-budgets stay the same), and in review/mr.ts:193 use `protectedBranchesFor(deps.cwd)`.
5. docs/SAFETY.md near the push section (~:242-246): document both keys, add-only semantics, main always first, malformed -> defaults + warning, both files read even for an untrusted project, with a two-line settings example in prose (no secrets).

Question budget (IN-B-05 decided, budget unified): add to grill/scorecard.ts `export function turnBudgetSpent(settledTurns: number): boolean` returning `settledTurns > HARD_QUESTION_BUDGET`, WHY comment: the turn after the last question writes the artifact. Use it at grill/index.ts:165 (behaviour unchanged) and plan-ceremony/index.ts:145 (was `>=`, now allows the same final write turn). In plan-ceremony's `before_agent_start` (:123-126), when the armed run's `turns === HARD_QUESTION_BUDGET`, include "This is the last turn: write PLAN.md now." in the injected content (combined with any lastReject text). Keep `if (current === undefined || event.aborted) return;` in both settle handlers: Esc-aborted turns stay uncounted (user decision). Keep `session_start` disarm in both. Update the /plan error text to "<HARD_QUESTION_BUDGET + 1> turns passed". Update tests/integration/ceremony-gates.test.ts:224-232 for the new plan count and add the last-turn brief assertion; keep the grill tests as they are. docs/WORKFLOWS.md (~:388-393): state the shared rule (HARD_QUESTION_BUDGET working turns plus one final write turn, aborted turns uncounted).

Child guard (audit item "subagents.ts:73-81 fixed install path"): in subagents.ts change `registerChildGuard(sessionId, safetyEntryPath, cwd, subagentSourcePaths: readonly string[] = [])` and `loadRequiredChildModule(cwd, subagentSourcePaths)`. Export `resolveRequiredChildModule(sourcePaths: readonly string[], cwd: string): string | undefined`: for each source path, walk up parent directories (stop at the filesystem root) to the first `package.json`; accept it only when its `name` is "pi-subagents" and `join(dir, "src", "api", "required-child-extensions.js")` exists; then fall back to the two existing npm roots. Undefined -> the existing throw, so registration fails and launches stay refused. In safety/index.ts session_start, collect `pi.getAllTools().filter((t) => t.name === "subagent").map((t) => t.sourceInfo.path)` inside a try/catch that yields [] (a stub pi in tests may lack getAllTools), and pass it. Add the resolver tests to tests/unit/subagent-guard.test.ts with temp dirs; keep the existing loader-seam tests green.

Run tests/unit/workflow-budgets.test.ts and raise any failing entry (safety dir, `.pi/lib` dir plus coverage for settings.ts, plan-ceremony/index.ts) with a dated sentence. Commit: `feat(safety): add-only protected branches from settings; unify the /grill and /plan turn budget; resolve pi-subagents from the loaded tool`.
  </action>
  <verify>
    <automated>npx vitest run tests/unit/protected-branches.test.ts tests/unit/subagent-guard.test.ts tests/unit/push-confirm.test.ts tests/unit/git-policy.test.ts tests/unit/safety-entry.test.ts tests/unit/agent-overrides.test.ts tests/integration/ceremony-gates.test.ts tests/integration/review-mr.test.ts tests/unit/workflow-budgets.test.ts tests/unit/comment-discipline.test.ts tests/unit/docs-policy.test.ts --maxWorkers=2 && npx tsc --noEmit</automated>
  </verify>
  <done>Effective lists are built-ins plus both settings files, add-only, main first, malformed values warn and keep defaults; every commit-check caller and the glab classifier use them; /plan matches /grill's budget rule with a last-turn brief; the guard resolves pi-subagents from the loaded tool and still fails closed; bedrockProfilePrefix behaviour unchanged; typecheck clean; one commit.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Routing and review findings (I-6, IN-C-9, IN-BC2-4, IN-C-8, IN-BC3-4, /review base typecheck) and record every decision</name>
  <files>.pi/extensions/routing/modes.ts, .pi/extensions/routing/index.ts, .pi/extensions/routing/agent-overrides.ts, .pi/extensions/providers/fallback.ts, .pi/extensions/workflows/index.ts, .pi/extensions/quality/index.ts, .pi/extensions/review/index.ts, tests/unit/default-mode.test.ts, tests/unit/agent-overrides.test.ts, tests/integration/fallback-chain.test.ts, tests/integration/quick-workflow.test.ts, tests/integration/review-command.test.ts, tests/integration/mode-switch.test.ts, tests/unit/workflow-budgets.test.ts, docs/ROUTING.md, docs/WORKFLOWS.md, docs/QUALITY.md, .planning/CODE-REVIEW-v1.0.md, .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-A.md, .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-A3.md, .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-B.md, .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-BC2.md, .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-BC3.md, .planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW-C.md</files>
  <behavior>
    - default-mode (pure predicate): reason "reload" -> no reset, no apply; reason "new"/"startup"/"resume"/"fork" with no ky:mode entry -> reset; with a ky:mode entry -> no reset (restore handles it); apply executor only when reset AND no message entries AND not a subagent child AND argv has none of `--model --provider --models` (also `--model=`/`--provider=`/`--models=`) AND settings has no defaultModel/defaultProvider; explicit choice -> reset without apply and a reason naming the source.
    - mode-switch (integration, existing faux-session pattern): after /max (escalated or max mode), emitting session_start {reason:"new"} on a branch with no ky:mode entry leaves getModeState() at DEFAULT_MODE, escalated false.
    - agent-overrides: with a registry where the first planner candidate resolves but has no auth and the second has auth, the pin is the second; with no candidate configured the pin falls back to the first guard-passing candidate (old behaviour); without a registry the result is unchanged from today.
    - fallback-chain: a guard callback refusing hop 2 (e.g. contextWindow below the estimate) means hop 2 is never called (faux callCount) and the first failure is returned; a guard refusing every hop throws an error that lists each hop's guard reason.
    - quick-workflow: a context usage above the routed executor's window no longer refuses /quick (the prompt is sent); image/thinking/R1 refusals still refuse.
    - review-command: with the exec override failing tsc at HEAD and passing at the merge base, /review refuses with "the change breaks the typecheck"; failing at both, the gate doubt says the failure predates the change; passing at HEAD, the base check never runs (exec override sees one tsc call).
  </behavior>
  <action>
Decisions (all "fix", per best practice):
- IN-C-9 and I-6 (fix). In routing/modes.ts add a pure `export function freshSessionPlan(input: { reason: string; hasModeEntry: boolean; hasMessages: boolean; isChild: boolean; argv: readonly string[]; settings: { defaultModel?: string; defaultProvider?: string } }): { readonly reset: boolean; readonly applyExecutor: boolean; readonly explicit?: string }` with the behaviour above. In routing/index.ts session_start (:381-401) make the handler async, keep it NEVER THROWS: before `restoreModeFromBranch(branch)`, if `plan.reset` call `setMode(DEFAULT_MODE); setEscalated(false)` (do not edit restoreModeFromBranch; mode-persistence case 3b depends on it). After the pin bookkeeping, if `plan.applyExecutor`: resolve `resolveRoute("executor", { mode: DEFAULT_MODE, escalated: false })`, `pickConfiguredCandidate(ctx.modelRegistry, ...)`, `guardRoute(model, "executor", deriveNeed(ctx, { usesToolLoop: true }))`, then `await pi.setModel(model)` only when ctx.model differs; any refusal or false leaves the model as is and, when `ctx.hasUI`, notifies once with the reason. If `plan.explicit` and ctx.model is not the routed default and `ctx.hasUI`, notify once: executor chosen by <source>; /cheap applies the cheap route. Do not append a ky:mode entry (absence means default). Pi facts: reasons types.d.ts:562-568; setModel never persists agent-session.js:2743-2748; flags args.js:63-102. docs/ROUTING.md: a fresh session and /new start in DEFAULT_MODE unescalated and apply its executor unless a model was chosen explicitly.
- IN-BC2-4 (fix: warn everywhere). workflows/index.ts:26 pass `{ ...deriveNeed(ctx, { promptChars: task.length }), estimatedInputTokens: undefined }` to `planRoleCall`, matching execute/index.ts:113; the routing input backstop (routing/index.ts input handler) already warns with the /compact hint. Add the quick-workflow test with a stubbed getContextUsage. docs/WORKFLOWS.md: one sentence that /quick, /execute and the input backstop all warn rather than refuse on an overfull context.
- IN-C-8 (fix; it is a correctness gap that discloses the prompt to a second vendor for a request that must fail, not a policy bypass). In providers/fallback.ts add an optional third parameter `guard?: (model: Model<Api>) => { readonly ok: true } | { readonly ok: false; readonly reason: string }` (structural, so providers/ does not import routing/); before each hop's `callModel`, a refused hop is skipped with `skipped.push(\`${provider}/${id} (capability guard: ${reason})\`)` and never counts as attempted; reword `allHopsSkippedError` to "no chain hop was usable". In modes.ts `runSingleShotRole` pass `(m) => guardRoute(m, opts.role, { ...need, usesToolLoop: usesToolLoop(opts.role) })`. Update the module header line only if it becomes false.
- IN-BC3-4 (fix: one picker). In agent-overrides.ts add `registry?: ModelRegistryLike` to `AgentOverridesForOptions`; inside the candidate loop, when a registry is given, prefer the first candidate that resolves via `registry.find`, has `registry.hasConfiguredAuth`, and passes the guard; if none is configured, fall back to the first guard-passing candidate (today's behaviour). In routing/index.ts pass `{ ...testOverrides?.agentOverridesFor, registry: ctx.modelRegistry }` from applyMode (:96) and session_start (:390). In `reportMode` (:230-239), for a role with an agent name compute the expected pin from the same `agentOverridesFor({ mode: state.mode }, { registry: ctx.modelRegistry })` result and show the re-pin advice only when the stored pin differs from that expected value; the `routed` display stays from `pickConfiguredCandidate`. docs/ROUTING.md: pins prefer a candidate with configured auth.
- /review baseTypecheckFailed (fix, lazily). In quality/index.ts add `export function typecheckFailsAtCommit(cwd: string, sha: string, projectTrusted: boolean): boolean`: `top = repoTop(cwd)`; create a temp dir with `mkdtempSync(join(tmpdir(), "ky-base-tsc-"))`; `git -C top worktree add --detach <tmp> <sha>` via spawnSync (shell false, windowsHide); if `join(top, "node_modules")` exists, link it into the worktree with `symlinkSync(target, link, "junction")`; run `runTypecheckAt(join(tmp, relative(top, cwd)), projectTrusted)`; return `status === "fail"`. In `finally`: if the link exists and `lstatSync(link).isSymbolicLink()`, `unlinkSync(link)` FIRST (never `rmSync` with recursive on the link: it would follow the junction into the real node_modules), then `git worktree remove --force <tmp>`, then `git worktree prune`, then `rmSync(tmp, { recursive: true, force: true })`. Any thrown error returns false (the HEAD failure then stays visible; never hidden). In review/index.ts keep `baseTypecheckFailed: false` for the first `runChangeGateStage` call; if `gate.typecheck.status === "fail"`, call `typecheckFailsAtCommit(ctx.cwd, base, ctx.isProjectTrusted())`: false -> `return fail(\`review: the change breaks the typecheck (it passes at the merge base ${base}) -- not reviewing:\n${gate.report}\`)`; true -> push the doubt "the typecheck fails at HEAD and already failed at the merge base, so this change did not introduce it". Keep review/index.ts growth to a few lines (frozen ceilings); docs/QUALITY.md: one sentence on the lazy merge-base baseline.

Tests as listed in <behavior>; write each failing first. Run tests/unit/workflow-budgets.test.ts and raise failing entries (routing/index.ts, routing dir, providers dir, quality dir, review/index.ts) with dated sentences. Commit code + tests + docs: `fix(routing,review): default mode at fresh start, one model picker, guarded fallback hops, /quick warns on overfull context, merge-base typecheck baseline`.

Then record every decision (separate docs commit, `docs(review): record status of the deferred v1.0 findings`), using the short SHAs of the three commits above:
- .planning/CODE-REVIEW-v1.0.md: update row I-6 (fixed, T3 sha, "DEFAULT_MODE applied at fresh start unless a model was chosen explicitly") and, in "Info items still open", set IN-A-4 fixed (T2 sha), IN-A2-2 / IN-A3-3 fixed (T1 sha), IN-B-05 "decided (best practice)" — aborted turns are not counted: Esc is the user's interruption, the next settle re-gates whatever was written, and counting would let Esc presses spend the user's budget; also note the /grill-/plan off-by-one unified (T2 sha) — IN-C-8 fixed, IN-C-9 "decided (best practice), fixed": /new resets to DEFAULT_MODE unescalated (T3 sha), IN-BC2-4 fixed: warn everywhere, IN-BC3-4 fixed: one picker. Add two rows for the milestone-audit warnings: "/review baseTypecheckFailed" fixed (T3 sha, lazy merge-base worktree) and "child guard fixed install path" fixed (T2 sha, resolved from the loaded subagent tool, still fails closed). Leave IN-BC2-9 and the other rows untouched.
- Under each finding heading append one line `**Status (2026-10-13):** <fixed in sha | decided (best practice)> — <one-line reason>`: 12.1-REVIEW-A.md IN-A-4 (:466), 12.1-REVIEW-A3.md IN-A3-3 (:160), 12.1-REVIEW-B.md IN-B-05 (:336), 12.1-REVIEW-BC2.md IN-BC2-4 (:272), 12.1-REVIEW-BC3.md IN-BC3-4 (:208), 12.1-REVIEW-C.md IN-C-8 (:507) and IN-C-9 (:515).
  </action>
  <verify>
    <automated>npx vitest run tests/unit/default-mode.test.ts tests/unit/agent-overrides.test.ts tests/integration/mode-switch.test.ts tests/integration/mode-persistence.test.ts tests/integration/model-select-guard.test.ts tests/integration/fallback-chain.test.ts tests/integration/quick-workflow.test.ts tests/integration/review-command.test.ts tests/unit/workflow-budgets.test.ts tests/unit/comment-discipline.test.ts tests/unit/docs-policy.test.ts --maxWorkers=2 && npx tsc --noEmit</automated>
  </verify>
  <done>Fresh sessions and /new reset to DEFAULT_MODE and apply its executor unless a model was chosen explicitly; /quick warns on overfull context; every fallback hop is guarded; /mode and the pins share one picker; /review distinguishes a broken change from a pre-broken base and only pays for the base check when HEAD fails; CODE-REVIEW and the six 12.1 review files record a status and reason for every finding named here; typecheck clean; two commits.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| model -> bash tool | model-authored command strings parsed by shell.ts; the pipe relaxation widens what reaches execution |
| repo files -> safety | project `.pi/settings.json` is attacker-editable in a cloned repo and now feeds the branch lists |
| installed packages -> safety | the child guard imports a pi-subagents module from a resolved path |
| review -> filesystem | a temporary git worktree and a node_modules junction are created and removed |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-sit-01 | Elevation | shell.ts piped inline code | mitigate | shells: re-parse -c code with canonicalise and refuse any inner code runner or SHELL_RUNNERS member (keeps `| sh -c sh`, `| bash -c 'bash -s'` refused); script runners: PIPED_INLINE_EVAL word list for evaluators and deserializers plus the unchanged inlineCodeEffect; corpus rows for each |
| T-sit-02 | Elevation | shell.ts interpreter options | mitigate | per-family option grammar, every unknown option before the script refuses; -s, -i, perl/ruby -x, deno/bun repl, `-` and STDIN aliases refuse |
| T-sit-03 | Elevation | PYTHONINSPECT | mitigate | refuse when any assignment word (prefix or env wrapper) sets PYTHONINSPECT |
| T-sit-04 | Elevation | runner always reading stdin | mitigate | cmd, pwsh/powershell, busybox, parallel, osascript on a pipe refused whatever their args |
| T-sit-05 | Tampering | generated module via -m | mitigate | -m NAME refused when NAME.py, NAME or NAME/... was written in the same command |
| T-sit-06 | Tampering | project settings branch lists | mitigate | add-only merge; built-ins always present and main at index 0; no removal syntax exists |
| T-sit-07 | Denial | malformed settings | mitigate | non-array or unparseable value keeps defaults and warns via notify + audit row |
| T-sit-08 | Elevation | child guard module path | mitigate | accept a resolved path only when the walked-up package.json names pi-subagents (it is the code Pi already loaded); nothing resolved -> registration fails and every launch is refused |
| T-sit-09 | Tampering | /review temp worktree junction | mitigate | unlink the junction before `git worktree remove --force`; never recursive rm on the link; any error returns false so a HEAD failure is never hidden |
| T-sit-10 | Spoofing | default executor at startup | mitigate | apply only on a fresh session with no explicit --model/--provider/--models and no saved default; guard + auth checked; never persisted |
| T-sit-11 | Information disclosure | fallback hop | mitigate | guard each hop so a request that must fail is not sent to the second vendor |
| T-sit-12 | Elevation | terraform -chdir | accept | only `-chdir=` and help/version are skipped; the subcommand is still classified, so apply/destroy/state rm confirm |
</threat_model>

<verification>
Each task runs only its targeted vitest files with --maxWorkers=2, one invocation at a time, plus `npx tsc --noEmit`. The orchestrator runs the full suite once after all three tasks.
Grep gates (comment lines excluded): `grep -v '^\s*//' .pi/extensions/safety/shell.ts | grep -c "stdinIsCode"` >= 2; `grep -c "effectiveBranches(" .pi/extensions/safety/index.ts` >= 1; `grep -c "turnBudgetSpent" .pi/extensions/plan-ceremony/index.ts .pi/extensions/grill/index.ts` gives 1 each; `grep -rnE "(IN|WR|CR|I)-[A-Z0-9]+-?[0-9]+" .pi/extensions --include=*.ts | grep "//"` returns nothing new.
</verification>

<success_criteria>
- Pipe rule matches the user's ALLOW/REFUSE lists exactly; `curl … | sh` stays refused.
- Protected branches configurable, add-only, main first, fail closed on malformed input; all six consumers use the effective list.
- /grill and /plan share one turn-budget predicate with a final write turn; aborted turns uncounted.
- I-6, IN-C-9, IN-BC2-4, IN-C-8, IN-BC3-4, IN-A3-3, IN-A-4, /review baseline and child-guard resolution fixed; IN-B-05 recorded as decided; every status written to CODE-REVIEW-v1.0.md and the 12.1 review files.
- No new LLM-facing tool, no IDs in code comments, no push.
</success_criteria>

<output>
Create `.planning/quick/261013-sit-safety-and-mode-follow-ups-pipe-rule-con/261013-sit-SUMMARY.md` when done (not committed by the executor).
</output>
