---
phase: 261013-grs-safety-guard-git-push-confirm-policy
reviewed: 2026-10-13T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - .pi/extensions/safety/git.ts
  - .pi/extensions/safety/policy.ts
  - .pi/extensions/safety/index.ts
  - .pi/extensions/safety/approvals.ts
  - .pi/extensions/safety/shell.ts
  - tests/unit/push-confirm.test.ts
findings:
  critical: 8
  warning: 6
  info: 2
  total: 16
status: resolved
---

# Quick 261013-grs: Code Review Report

**Reviewed:** 2026-10-13
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

Reviewed `git diff 690c7b9^ 690c7b9`. This change turns feature-branch pushes into an `ask` verdict and resolves implicit destinations by reimplementing git's push-destination logic in TypeScript. That reimplementation is incomplete in several places that matter. The incomplete inputs are argv precedence, refname DWIM, symbolic refs, `remote.<r>.mirror`, legacy remote files, config includes, `$HOME` and `push.pushOption`. Each gap lets a push reach `main`/`staging`, or trigger a server-side merge, while the human sees a confirm prompt naming a harmless feature branch. That outcome is worse than the old block, because the human is now the one who approves the push.

All of the setup steps a bypass needs are allowed on a feature branch: `git config ...`, `git symbolic-ref ...`, a `write` into `.git/remotes/` or `.git/branches/`, and a `write` of a `.gitconfig` inside the project. Several findings were confirmed by calling `evaluate()` directly (node type-stripping probe in the scratchpad). Each reported verdict is the actual output.

## Critical Issues

### CR-01: `--repo` is resolved with the wrong precedence, so the guard reads a different remote's config than git uses

**File:** `.pi/extensions/safety/git.ts:261-262`
**Issue:** `const remote = repo ?? positionals[0]` treats `--repo` as the winner and every positional as a refspec. In git (`builtin/push.c` cmd_push: `if (argc > 0) { repo = argv[0]; set_refspecs(argv + 1, ...) }`), the positional repository **overrides** `--repo` ("If both are specified, the command-line argument takes precedence"). Probe:
`git push --repo=origin evil feat` with `remote.evil.push=refs/heads/feat:refs/heads/main` returns `ask` with "Remote: origin / Branch: evil, feat". Git actually pushes `feat` to remote `evil`, where `remote.evil.push` maps it to `main`.
**Fix:** Match git. If there is any positional, it is the remote and the rest are refspecs; `--repo` applies only when there are no positionals. Simpler still, refuse `--repo` combined with any positional:
```ts
const remote = positionals.length > 0 ? positionals[0] : repo;
const refspecs = positionals.slice(1).filter((r) => !r.startsWith("^"));
```

### CR-02: A bare source spelled `heads/<b>` skips the `push.default=upstream` mapping

**File:** `.pi/extensions/safety/git.ts:282-301` (`branchOf` at 205)
**Issue:** `branchOf` strips only `refs/heads/`. Git's `count_refspec_match("heads/feat", local_refs)` strongly matches `refs/heads/feat`, and `refspec_append_mapped` then maps it through `branch.feat.merge`. The guard instead looks up `branch.heads/feat.merge` (unset) and reports the same name. Probe with `push.default=upstream` and `branch.feat.merge=refs/heads/main`: `git push origin heads/feat` returns `ask` with "Branch: heads/feat". Git pushes `heads/feat:refs/heads/main`.
**Fix:** Have git resolve the source instead of DWIM-ing in TypeScript. Run `git rev-parse --symbolic-full-name <src>` in the push's directory, require the result to start with `refs/heads/`, then use that name for the `branch.<name>.merge` lookup. Refuse anything else.

### CR-03: A bare source that is a local symbolic ref pushes to the symref's target

**File:** `.pi/extensions/safety/git.ts:282-301`
**Issue:** When a refspec has no destination, git's `match_explicit_refs` sets the destination to `refs_resolve_ref_unsafe(matched_src->name)`. That follows symrefs, which is the same mechanism that makes `git push origin HEAD` work. After `git symbolic-ref refs/heads/feat refs/heads/main` (allowed on a feature branch), `git push origin feat` pushes to `refs/heads/main`. The guard reports "Branch: feat" and asks.
**Fix:** As in CR-02, resolve the source with `git rev-parse --symbolic-full-name` (this follows symrefs) and use the resolved name both as the destination and for the upstream lookup. Alternatively, refuse when `git symbolic-ref -q refs/heads/<name>` succeeds.

### CR-04: `remote.<r>.mirror=true` is not checked, so a "feature-branch" push mirrors and force-updates every ref

**File:** `.pi/extensions/safety/git.ts:305-328` and `341-384`
**Issue:** In `builtin/push.c` do_push, `if (remote->mirror) flags |= TRANSPORT_PUSH_MIRROR|TRANSPORT_PUSH_FORCE`. With no refspec, `setup_default_push_refspecs` is skipped and every ref is pushed with force. Local `main` force-updates remote `main`, and remote refs missing locally are deleted. Probe: config `remote.origin.mirror=true` and command `git push origin` returns `ask` with "Branch: feat". With an explicit `feat:feat`, the push silently becomes a force push, which the policy forbids on every branch. `git config remote.origin.mirror true` is not itself blocked.
**Fix:** In `planPush`, once the effective remote is known (both refspec and no-refspec paths), refuse when `lastConfig(facts, \`remote.${remote}.mirror\`)` is a git-true boolean (`true|yes|on|1`, case-insensitive).

### CR-05: Legacy `$GIT_DIR/remotes/<name>` and `$GIT_DIR/branches/<name>` files supply push refspecs that the guard never reads

**File:** `.pi/extensions/safety/git.ts:293, 312`
**Issue:** The only remap check is `remote.<r>.push` in config. Git's `remote.c` (`read_remotes_file` / `read_branches_file`) loads a remote that is not configured from `.git/remotes/<name>` (`Push:` lines) or `.git/branches/<name>`. A branches file always adds `HEAD:refs/heads/<frag>`, and `<frag>` defaults to the default branch name. `paths.ts` blocks writes only to `.git/hooks/*` and `.git/config`, so `write .git/branches/x` containing the real URL, followed by `git push x`, pushes HEAD to `main`. The guard asks with "Remote: x / Branch: feat".
**Fix:** Require the effective remote to be a configured remote (`remote.<r>.url` non-empty) or an explicit URL/path. Otherwise refuse. Also consider adding `.git/remotes/` and `.git/branches/` to the deferred-detonation write paths.

### CR-06: `-c include.path=` / `-c includeIf.*` (and `--config-env`) inject push config past the `-c` filter

**File:** `.pi/extensions/safety/git.ts:194, 342`
**Issue:** `PUSH_CONFIG_KEY` is a denylist (`push.|remote.|branch.|submodule.`). Git's `config_with_options` honours `include.path` from command-line `-c` (an absolute or `~/` path is required). So `git -c include.path=/c/.../proj/x.cfg push origin feat`, where `x.cfg` sets `push.default=upstream` and `branch.feat.merge=refs/heads/main`, passes the filter. `configTrusted` ignores overrides, and the probe returns `ask` with "Branch: feat". The same gap covers `core.hooksPath`, `core.sshCommand`, `remote.*` via an include, and similar keys.
**Fix:** Invert the filter. Any `-c`/`--config-env` on a push makes config untrusted and refuses implicit destinations. Explicit `src:dst` can stay allowed only if the key is on a small allow-list (for example `user.*`, `color.*`), and anything matching `^include` should be refused outright.

### CR-07: An assignment-only statement such as `HOME=sub;` before the push is invisible, so the guard reads different config than git uses

**File:** `.pi/extensions/safety/shell.ts:403-404`, `.pi/extensions/safety/policy.ts:160-165, 209`
**Issue:** `extractInvocations` drops nodes with no command name, so `HOME=sub; git push origin feat` yields one invocation. That makes `sole` true, `assignments` unset and `configTrusted` true. `HOME` is already exported, so git reads `sub/.gitconfig`, which the `write` tool may create because only `~/.gitconfig` is blocked. That file can set `push.default=upstream` plus `branch.feat.merge=refs/heads/main`. Probe: `HOME=sub; git push origin feat` returns `ask`, and the prompt reads only `git push origin feat`. The same applies to any other variable that is already exported (`XDG_CONFIG_HOME`, and `GIT_*` when set in Pi's environment).
**Fix:** Make `extractInvocations` record that an assignment-only statement exists (for example a `ShellVerdict.hasBareAssignments` flag), and set `configTrusted=false` when it is present. Simplest: trust config only when the whole command parses to exactly one command node with no prefix.

### CR-08: The `push.pushOption` config bypasses the merge-option block

**File:** `.pi/extensions/safety/git.ts:192, 227-229`
**Issue:** `PUSH_OPTION_MERGES` is only checked against argv `-o`/`--push-option`. Git sends every `push.pushOption` value when no `-o` is given (git-config(1)). After `git config push.pushOption merge_request.merge_when_pipeline_succeeds` (plus `merge_request.create`), every confirmed feature push asks GitLab to auto-merge into the default branch. That is the deploy trigger this rule exists to block. Probe: `git push origin feat:feat` with that config returns `ask`.
**Fix:** In `planPush`, when no `-o` is given, read `facts.readConfig("push.pushOption")` and apply the same test. If argv `-o` is given, git ignores the config, so only argv matters.

## Warnings

### WR-01: The confirm prompt shows a reconstructed `git push ...`, not the exact command

**File:** `.pi/extensions/safety/git.ts:385, 404`; `.pi/extensions/safety/index.ts:437`
**Issue:** `display` is rebuilt from the post-global-option args. It drops `-C <dir>`, `-c k=v`, `--bare`, `--exec-path`, `NAME=value` prefixes, earlier `;` statements and every other segment of the bash command. `git -C ../work-repo push origin feat:feat` is shown as `git push origin feat:feat` against a different repository. CR-07's `HOME=sub;` is likewise hidden. `docs/SAFETY.md` promises "the exact command".
**Fix:** In the hook, prepend the raw `command` (the bash input) to the prompt, for example `ctx.ui.confirm("Allow this git push?", \`${command}\n\n${verdict.prompt}\`)`. Keep the resolved remote/branch lines underneath.

### WR-02: A grant is keyed on command text only, not on the destination the human approved

**File:** `.pi/extensions/safety/index.ts:154-158, 426-446`; `.pi/extensions/safety/approvals.ts:116-120, 151-158`
**Issue:** The wrapper consumes the grant for any `ask` verdict with the same `requestKey`. If config, HEAD or legacy remote files change between the confirm and the wrapper (a parallel tool call in the same batch), the same text can resolve to a different non-protected branch or remote, and it still runs. If a later extension's `tool_call` hook blocks the call after this one granted it, the grant lives for `APPROVAL_TTL_MS` (10 min). Once the 5 s deferral marker expires, an identical re-issue defers at line 427 without asking again.
**Fix:** Store `verdict.prompt` (resolved remote and targets) in the grant. Have `consume` take the wrapper's freshly computed prompt and grant only on an exact match. Give `grantConfirmed` a short TTL (about `HOOK_DEFER_TTL_MS`), because the wrapper should run immediately.

### WR-03: `--receive-pack` / `--exec` (and their config equivalents) run arbitrary commands inside an approved push

**File:** `.pi/extensions/safety/git.ts:182, 224-230`
**Issue:** `--receive-pack`/`--exec` are accepted value flags. For a local-path remote, git runs that value through the shell (`connect.c`, `use_shell`). Probe: `git push --receive-pack="git push origin feat:main #" . feat:feat` returns `ask` with "Branch: feat". The nested push is never seen by the guard. `remote.<r>.receivepack`, `core.sshCommand` and `core.hooksPath`/`pre-push` hooks are the same class. They are set by allowed `git config` calls and do not appear in the prompt.
**Fix:** Refuse `--receive-pack`/`--exec` on push, and refuse when `remote.<r>.receivepack`, `core.sshCommand` or `core.hooksPath` is set for the effective remote/repo. Otherwise document this class in the Known bypasses table next to EV-38.

### WR-04: The prompt shows a branch git will not actually push to (bare `HEAD`, multi-valued `branch.<b>.merge`)

**File:** `.pi/extensions/safety/git.ts:286-301`
**Issue:** Git's `set_refspecs` maps a bare source through upstream only when `count_refspec_match` finds exactly one local ref. `HEAD` is not in that list, so `git push origin HEAD` always pushes to the current branch name, and the guard applies the upstream mapping anyway. Probe: `HEAD` with `branch.feat.merge=refs/heads/other` shows "Branch: other", but git pushes `feat`. With two `branch.feat.merge` values git requires `merge_nr == 1` and falls back to the same name, while the guard shows the last value. Neither case reaches a protected branch, but the human approves the wrong target.
**Fix:** Do not apply upstream mapping to `HEAD`/`@`. Map only when `readConfig("branch.<b>.merge").length === 1`.

### WR-05: The submodule-recursion check misses git boolean spellings and ignores config order

**File:** `.pi/extensions/safety/git.ts:331-338`
**Issue:** Git parses `submodule.recurse` with `git_config_bool`, so `yes`, `on` and `1` also mean on-demand for push. Only `"true"` is checked. In `git_push_config`, `push.recurseSubmodules` and `submodule.recurse` overwrite one variable in config-read order: a local `submodule.recurse=true` beats a system or global `push.recurseSubmodules=no`. The guard instead lets any `push.recurseSubmodules` value win.
**Fix:** Treat any git-true value of `submodule.recurse` as recursing. Refuse whenever either key is set to a recursing value, regardless of the other.

### WR-06: Tags and MR-creating push options are inconsistent with the stated policy

**File:** `.pi/extensions/safety/git.ts:174-192`
**Issue:** `--tags` is refused ("only branch pushes can be confirmed"), but `--follow-tags` is on the safe list and `push.followTags` is never read. Both push tags, and tag pipelines are a common deploy trigger. `-o merge_request.create` (whose target defaults to the protected default branch) or `-o merge_request.target=main` is allowed. The glab path refuses the equivalent `glab mr create` with no non-protected `--target-branch` because "silence is the trigger".
**Fix:** Remove `--follow-tags` from `PUSH_SAFE_LONG` and refuse when `push.followTags` is true. Refuse `merge_request.create` unless a `merge_request.target=<non-protected>` option is also given, and refuse any `merge_request.target` naming a protected branch.

## Info

### IN-01: JSDoc on non-exported functions (AGENTS.md "JSDoc only on exported API")

**File:** `.pi/extensions/safety/git.ts:220, 266, 272, 281, 304, 330, 340`; `.pi/extensions/safety/policy.ts:119`
**Issue:** New internal helpers (`parsePushArgs`, `lastConfig`, `configDerivedTargets`, `resolveBareSource`, `resolveNoRefspec`, `submoduleRefusal`, `planPush`, `GIT_REPO_REDIRECT_OPTIONS`) carry `/** */` JSDoc. No phase or ticket IDs were introduced in the diff.
**Fix:** Turn them into `//` WHY-comments where the reason is non-obvious; otherwise delete them.

### IN-02: The tests pin only the resolver's own model, not git's behaviour

**File:** `tests/unit/push-confirm.test.ts:18-32, 116-123`
**Issue:** Every resolution test injects a hand-written `readConfig`, so the tests agree with the TypeScript model by construction. None runs a real `git push --dry-run --porcelain` against a local bare remote to check the resolved destination, which would have caught CR-01 through CR-05. The "prompt names the exact command" test only asserts the reconstructed `display`.
**Fix:** Add integration cases using a temp bare repo as `origin`: `git push --dry-run --porcelain --no-verify`, parse the `src:dst` lines, and assert that whenever the guard says `ask`, git's destination set equals the prompt's. Include the CR-01..CR-08 shapes as regression rows.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Resolution (fix commit a109822)

- CR-01: `--repo` refused. CR-02/CR-03/WR-04: sources and HEAD resolved by `git rev-parse --symbolic-full-name`; every `branch.<b>.merge` value checked. CR-04: `remote.<r>.mirror` refused. CR-05: a named remote must have `remote.<r>.url` in git config. CR-06: any `-c`/`--config-env` refuses a push. CR-07: assignment-only statements count toward the sole-statement rule. CR-08/WR-06: `merge_request.*` options refused from `-o` and `push.pushOption`; `--follow-tags`/`push.followTags` refused.
- WR-01: dialog shows the real bash command plus resolved remote/branch. WR-02: requestKey includes the resolved destination; confirmed grants live 30s. WR-03: `--receive-pack`, `--exec`, `remote.<r>.receivepack` refused. WR-05: any non-false `submodule.recurse`, any `push.recurseSubmodules` other than no/check refuses.
- IN-02: real-repository tests added (heads/ DWIM, symref alias, HEAD via alias, legacy remote, mirror).
- IN-01 accepted: non-exported helpers keep one-line `/** */` comments, matching the existing file convention and passing comment-discipline tests.
