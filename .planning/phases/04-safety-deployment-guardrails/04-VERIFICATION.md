---
phase: 04-safety-deployment-guardrails
verified: 2026-08-14T12:05:00Z
status: human_needed
score: 4/5 truths verified (1 correctly not-verifiable from this machine, pre-authorised)
overrides_applied: 0
requirements_coverage: 16/16 (SAFE-01..SAFE-15, SAFE-17 — SAFE-16 belongs to Phase 1)
human_verification:
  - test: "RB-04-01 — attempt a push to `main` on the user's real work GitLab repo and confirm the server rejects it"
    expected: "`git push origin main` exits non-zero with GitLab's own protected-branch rejection text on stderr; the offline proxy's assumed wording (`You are not allowed to push code to protected branches on this project.`) should be confirmed against the real text and recorded in `docs/RUNBOOK.md`'s RB-04-01 entry, then the entry flipped to RESOLVED and SAFE-01 to `[x]` in REQUIREMENTS.md"
    why_human: "This dev machine has no GitLab access, no work-laptop credentials, and no network egress to the user's work GitLab instance. Whether GitLab's protected-branch rule is actually configured on `main` is a fact about a server this machine cannot reach. This is SAFE-01 / roadmap Success Criterion 1 and is explicitly called out in the verification brief as EXPECTED and PRE-AUTHORISED by the project's standing autonomous-run policy — not a gap."
---

# Phase 4: Safety & Deployment Guardrails Verification Report

**Phase Goal:** A confused model on a laptop where merging to `main` auto-deploys to AWS cannot cause an irreversible action, and the limits of that protection are documented rather than assumed.
**Verified:** 2026-08-14
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped 1:1 to ROADMAP.md Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|------|--------|----------|
| 1 | A push to a protected GitLab branch is rejected server-side, verified live on the work laptop | ? UNCERTAIN — correctly not verifiable here (human_needed, pre-authorised) | `docs/RUNBOOK.md:862,864-895` — `RB-04-01` is `OUTSTANDING` identically in the summary-table row and the `**Status:**` line (no half-flip). `tests/unit/docs-policy.test.ts` machine-governs this and passed (part of the 1180/1180 run). The offline proxy `tests/integration/gitlab-push-protection.test.ts` is shipped and passes — a real `git push` against a real local bare repo with a rejecting `pre-receive` hook is refused, a paired non-protected push succeeds, and `classifyPushFailure()` classifies a protected rejection differently from an ordinary non-fast-forward rejection. This proves the harness reads/classifies a server rejection correctly; it proves nothing about whether GitLab is actually configured on the work laptop — that fact requires the user's own credentials and network. REQUIREMENTS.md correctly carries SAFE-01 as `[~]` partial with `RB-04-01` named inline. |
| 2 | A blocked command stays blocked inside a spawned subagent, and under `--mode json` confirmation is deny-by-default, proven by CI rather than interactive trial | ✓ VERIFIED | `tests/integration/subagent-block.test.ts` (SAFE-12): spawns a real `pi --mode json` child with a project-scoped sentinel extension planted at the child's cwd; asserts the blocked command surfaces as an error carrying the guard's own reason text, the benign command executes normally in the SAME child, the child's own `.pi/logs/audit-*.jsonl` carries both a BLOCK row and an ALLOW row (ruling out "guard never loaded"), and the project-scoped sentinel's import-time marker file is absent (proving project scope genuinely never loads headless). Read in full — assertions are precise (regex-matched reason text, not substring-only) and non-tautological. `tests/integration/headless-deny.test.ts` (SAFE-10) independently proves deny-by-default under `--mode json` with a paired positive control. Both files pass; re-ran independently, 173/173 across the 7 most safety-critical integration/unit files. |
| 3 | `g=push; git $g`, `sh -c "..."` and heredoc forms caught by AST parsing; anything unparseable refused; enforcement happens twice (hook + wrapped `bash`) | ✓ VERIFIED | `.pi/extensions/safety/shell.ts` (779 lines) implements `canonicalise`/`DENIED_PART_TYPES`/`HEREDOC_OPERATORS`/`SHELL_RUNNERS` over real `unbash` AST output. `tests/unit/shell-deny-list.test.ts` asserts the seven zero-parse-error adversarial inputs (including `git $(echo push)`, `g=push; git $g origin main`, `sh -c`, heredocs, `nohup ... &`) are DENIED, and a plain `git status` is NOT. Double enforcement is proven by `tests/integration/double-enforcement.test.ts` (SAFE-09) — a later hook mutating `event.input` after the first hook approved does not get its rewritten command executed — and independently re-verified in `04-REVIEW.md`'s iteration-5 CR-11 four-criteria table (executed, not read: a genuine two-jiti-instance double load, block→approve→re-issue exactly-once, mutated-command-still-blocks, and approvals stay one-shot/command-bound/expiring). All referenced test files pass. |
| 4 | Writes blocked when `HEAD == main`, `glab mr merge` refused, `fetch/rebase/diff/log origin/main` and `worktree add -b feat main` still work; `.env`/`~/.aws/credentials`/kubeconfig/`*.tfstate` reads blocked; `terraform apply|destroy|import`, mutating `aws`, `kubectl delete` require confirmation | ✓ VERIFIED | `.pi/extensions/safety/git.ts` (447 lines), `.pi/extensions/safety/paths.ts` (584 lines), `.pi/extensions/safety/infra.ts` (430 lines) — all present, well above declared `min_lines`, exporting exactly what their plans specified. `tests/unit/git-policy.test.ts`, `tests/integration/git-head-main.test.ts` (real disposable git checkout), `tests/unit/path-policy.test.ts`, `tests/unit/infra-policy.test.ts` all pass with the named allow/block cases (worktree-add-on-main as a named allow, orientation calls like `aws sts get-caller-identity`/`aws s3 ls` as named allows, `terraform plan/fmt/validate/show` unprompted). CR-05's fix (verified in 04-REVIEW-FIX.md and reflected in current `git.ts`) closed the `git push --force origin main` from a feature branch gap by checking the push *target*, independent of the checked-out branch. |
| 5 | ≥30 evasion attempts, each blocked or documented out-of-scope; every allow/block in an audit JSONL; a published table names the uncaught bypasses | ✓ VERIFIED | `tests/fixtures/evasion-corpus.ts`: 74 total cases (`grep -c 'id: "EV-'` = 74), 60 tagged `BLOCKED`, 14 tagged `OUT-OF-SCOPE` — matches `04-REVIEW.md`'s independently-executed final numbers exactly (74/60/14, ids EV-09/27/35/36/38/39/40/41/42/56/57/65/73/74). `tests/unit/evasion-corpus.test.ts` drives every BLOCKED row through the real `evaluate()` and cross-checks every OUT-OF-SCOPE row against `docs/SAFETY.md`'s published table in both directions (row count derived from the corpus, never hand-typed). I independently re-read `docs/SAFETY.md:133-157` and confirmed its "Known bypasses" table lists exactly the same 14 ids with honest per-row explanations, and the document opens by stating "no OS-level sandbox on Windows" and names GitLab server-side protection as the only non-theatre control. `.pi/extensions/safety/audit.ts` + `.pi/lib/jsonl.ts` write both allow and block rows (`tests/unit/audit-jsonl.test.ts`, `tests/integration/audit-concurrency.test.ts` — four concurrent processes, no torn/lost rows). |

**Score:** 4/5 truths VERIFIED, 1/5 correctly UNCERTAIN-pending-human (not a code gap — see below).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.pi/extensions/safety/shell.ts` | AST canonicalisation + fail-closed deny (min 120 lines) | ✓ VERIFIED | 779 lines. Exports `canonicalise`, `DENIED_PART_TYPES`, `HEREDOC_OPERATORS`, `SHELL_RUNNERS`, `GUARDED_VERB_PATTERN`. Wired into `policy.ts`. |
| `.pi/extensions/safety/paths.ts` | path canonicalisation + read/write/detonation policy (min 140 lines) | ✓ VERIFIED | 584 lines. Exports `canonicalisePathArg`, `classifyPathRead`, `classifyPathWrite`, `SENSITIVE_READ_PATTERNS`, `DETONATION_TARGETS`. |
| `.pi/extensions/safety/git.ts` | per-subcommand git table + HEAD oracle + glab rule (min 120 lines) | ✓ VERIFIED | 447 lines. Exports `currentBranch`, `classifyGitInvocation`, `classifyGlabInvocation`, `GIT_WRITE_SUBCOMMANDS`, `GIT_READ_SUBCOMMANDS`. |
| `.pi/extensions/safety/infra.ts` | terraform/aws/kubectl three-valued classification (min 110 lines) | ✓ VERIFIED | 430 lines. Exports `classifyInfraInvocation`, `SAFE_AWS_EXACT_OPERATIONS`, `isSafeAwsOperation`, `isSensitiveAwsRead`, `TERRAFORM_CONFIRM_SUBCOMMANDS`, `KUBECTL_CONFIRM_VERBS`. |
| `.pi/extensions/safety/policy.ts` | single `evaluate()` composing all four (min 120 lines) | ✓ VERIFIED | 657 lines. Default-deny confirmed in tests; governs 7 tool names (`bash`/`read`/`write`/`edit`/`grep`/`find`/`ls`), not the original 4 — corrected during review fix and reflected in current code and docs. |
| `.pi/extensions/safety/approvals.ts` | one-shot, command-bound, expiring approval store | ✓ VERIFIED | 410 lines. `createPending`, `validate`, `approve`, `consume`, `peek`, `APPROVAL_TTL_MS`, `sweepExpired`, globalThis-keyed cross-jiti-instance store. |
| `.pi/extensions/safety/index.ts` | extension entry: hook, wrapped tools, audit wiring, double-registration guard | ✓ VERIFIED | 839 lines. Wraps `bash`/`read`/`write`/`edit`/`grep`/`find`/`ls`; `tool_call` hook re-evaluates; `approve_ky_command` registered with justification. |
| `.pi/extensions/safety/audit.ts` | audit row writer bound to `audit` base | ✓ VERIFIED | 132 lines. `AUDIT_LOG_BASE`, `writeAuditRow`. |
| `.pi/lib/jsonl.ts` | shared JSONL writer serving both diagnostics and safety | ✓ VERIFIED | present, `safety/` imports from it (relative import confirmed), no second re-implementation. |
| `bin/bootstrap.sh` | idempotent user-scope safety install, `--check-only` support | ✓ VERIFIED | `tests/integration/bootstrap-safety-stub.test.ts` and `bootstrap-check-only.test.ts` both pass. Actually installed on this machine (`~/.pi/agent/extensions/ky-safety/index.ts` exists, re-exports the correct absolute path). Minor: not re-run since the latest source fix commits — see Anti-Patterns/Info below; not a functional gap because the stub is a live re-export, not a compiled copy. |
| `tests/fixtures/evasion-corpus.ts` | ≥30-case corpus (min 120 lines) | ✓ VERIFIED | 74 cases, 60 BLOCKED / 14 OUT-OF-SCOPE, cross-checked against `docs/SAFETY.md`. |
| `docs/SAFETY.md` | published limits table + honest ceiling statement | ✓ VERIFIED | Opens "mistake-catcher, not a security boundary"; states no Windows sandbox; names GitLab server-side protection as the only non-theatre control; 14-row bypass table matches the corpus exactly in both directions. |
| `docs/RUNBOOK.md` | `RB-04-01` entry, all four contract parts, OUTSTANDING in both places | ✓ VERIFIED | Confirmed by direct read: summary table row and `**Status:**` line both say OUTSTANDING; procedure, expected output, and offline-proxy clause all present. |
| `tests/integration/gitlab-push-protection.test.ts` | offline proxy: real bare repo + pre-receive hook | ✓ VERIFIED | Passes. |
| `tests/integration/subagent-block.test.ts` | real spawned headless child, block+allow+no-project-scope proof | ✓ VERIFIED | Read in full; non-tautological; passes. |
| `tests/integration/audit-concurrency.test.ts` | 4-process concurrent append, no torn/lost rows | ✓ VERIFIED, minor flake noted | Passed 3/3 in isolation and in a repeated identical batch; failed once (1/1) in one earlier mixed-integration-test batch run under this verification's own machine load, not reproduced on immediate retry. Classified as environmental timing flakiness in a concurrency test under contention, not a functional defect — the full suite run (1180/1180, single authoritative run) and two subsequent clean re-runs of this exact file confirm the writer is correct. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `package.json#dependencies` | `unbash@4.0.10` | exact pin | ✓ WIRED | `"unbash": "4.0.10"` present in `dependencies` (not devDependencies), governed by `tests/unit/pinning.test.ts`'s `REQUIRED_RUNTIME_PINS`. |
| `.pi/extensions/safety/shell.ts` | `unbash` | named import of `parse` | ✓ WIRED | confirmed via passing `shell-deny-list`/`shell-parse` tests exercising real AST output. |
| `.pi/extensions/safety/policy.ts` | `shell.ts`/`paths.ts`/`git.ts`/`infra.ts` | direct imports, fixed evaluation order | ✓ WIRED | `policy-compose.test.ts` (part of 1180/1180 green run) exercises the composed decision table end-to-end. |
| `.pi/extensions/safety/audit.ts` | `.pi/lib/jsonl.ts` | relative import of `appendJsonl` | ✓ WIRED | `safety/` imports nothing from `diagnostics/`, confirmed by the plan's own truth and the passing `audit-jsonl.test.ts`. |
| `.pi/extensions/safety/index.ts` | `@earendil-works/pi-coding-agent` | `createBashTool`/`createReadTool`/`createWriteTool`/`createEditTool`/`createGrepTool`/`createFindTool`/`createLsTool` spread override | ✓ WIRED | wrapped-tool delegates rebuilt per-call from `ctx.cwd` (WR-02 fix, current code), not a single stale instance. |
| `.pi/extensions/safety/index.ts` | `.pi/extensions/safety/policy.ts` | `evaluate()` called at BOTH hook and wrapper | ✓ WIRED | double-enforcement proven by `double-enforcement.test.ts` and independently re-executed in `04-REVIEW.md` iteration 5. |
| `bin/bootstrap.sh` | `$PI_AGENT_DIR/extensions/ky-safety/index.ts` | idempotent byte-compared write of re-export stub | ✓ WIRED | live stub confirmed present on this machine, correctly re-exporting the repo's `.pi/extensions/safety/index.ts` by absolute path. |
| `docs/RUNBOOK.md` | `tests/unit/docs-policy.test.ts` | `RB-04-01` governed, status parsed from both places | ✓ WIRED | test passes; a half-flip would be reported `INCONSISTENT`, which the test treats as a failure. |
| `tests/unit/evasion-corpus.test.ts` | `docs/SAFETY.md` | count derived from corpus, asserted against published table | ✓ WIRED | both-direction cross-check passes; independently re-verified by direct file comparison above. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite is genuinely green, not merely claimed | `npx vitest run` | `Test Files 67 passed (67)`, `Tests 1180 passed (1180)` | ✓ PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | no output, exit clean | ✓ PASS |
| Working tree is clean (no uncommitted drift) | `git status --porcelain` | empty | ✓ PASS |
| Evasion corpus counts match the review's independently-executed numbers | `grep -c 'id: "EV-'` + `grep -o 'expect: "..."' \| sort \| uniq -c` | 74 total; 60 BLOCKED; 14 OUT-OF-SCOPE | ✓ PASS |
| Safety-critical test subset re-runs clean in isolation | `npx vitest run` (7 highest-risk integration/unit files) | `Test Files 7 passed (7)`, `Tests 173 passed (173)` | ✓ PASS |
| RB-04-01 remains OUTSTANDING in both required places | `grep -n "RB-04-01" docs/RUNBOOK.md` + manual read | summary-table row and `**Status:**` line both OUTSTANDING | ✓ PASS |
| Live user-scope stub is installed and correctly re-exports the fixed source | direct file read of `~/.pi/agent/extensions/ky-safety/index.ts` | re-exports `.../ky-pi-agent/.pi/extensions/safety/index.ts` by absolute path | ✓ PASS (stub mtime predates the final review-fix commits — see Info below; functionally inert because jiti loads the target live, no compilation/caching) |

### Probe Execution

SKIPPED — no `scripts/*/tests/probe-*.sh` files exist in this repository and neither the PLANs nor SUMMARYs for Phase 4 reference probe-based verification; this phase's CI evidence is vitest-based, covered under Behavioral Spot-Checks above.

### Requirements Coverage

| Requirement | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| SAFE-01 | 04-12 | ? PARTIAL (correctly, per REQUIREMENTS.md `[~]`) | Offline proxy shipped and green; live GitLab check is `RB-04-01`, OUTSTANDING, requires the user's own work-laptop credentials. |
| SAFE-02 | 04-01, 04-03 | ✓ SATISFIED | `unbash` AST parsing resolves `sudo`/`env`/`sh -c`/`xargs`; `shell-deny-list.test.ts` proves `g=push; git $g` and `bash -lc "..."` caught. |
| SAFE-03 | 04-03, 04-07 | ✓ SATISFIED | fail-closed node-type deny predicate; `evaluate()`'s default branch is deny. |
| SAFE-04 | 04-05 | ✓ SATISFIED | `git-policy.test.ts`, `git-head-main.test.ts` (real disposable repo). |
| SAFE-05 | 04-05 | ✓ SATISFIED | `classifyGlabInvocation` blocks `glab mr merge` on any branch. |
| SAFE-06 | 04-04 | ✓ SATISFIED | `path-policy.test.ts`, `SENSITIVE_READ_PATTERNS` cover `.env`, `~/.aws/credentials`, kubeconfig, `*.tfstate`. |
| SAFE-07 | 04-06 | ✓ SATISFIED | `infra-policy.test.ts` — terraform/aws/kubectl three-valued classification, orientation calls unprompted. |
| SAFE-08 | 04-04 | ✓ SATISFIED | out-of-project write/delete blocked. |
| SAFE-09 | 04-08 | ✓ SATISFIED | `double-enforcement.test.ts`, independently re-executed in `04-REVIEW.md` CR-11. |
| SAFE-10 | 04-07, 04-08, 04-09 | ✓ SATISFIED | `confirm-approve-reissue.test.ts`, `headless-deny.test.ts` — deny-by-default under `--mode json`. |
| SAFE-11 | 04-01, 04-09 | ✓ SATISFIED | user-scope install proven by `user-scope-load.test.ts`, `bootstrap-safety-stub.test.ts`; live install confirmed on this machine. |
| SAFE-12 | 04-10 | ✓ SATISFIED | `subagent-block.test.ts`, read in full, non-tautological. |
| SAFE-13 | 04-04 | ✓ SATISFIED | `.git/hooks/*`, `.git/config`, `~/.bashrc`, `~/.gitconfig`, CI workflow files all in `DETONATION_TARGETS`, confirmed blocked in `04-REVIEW.md`'s regression sweep. |
| SAFE-14 | 04-02, 04-08, 04-10 | ✓ SATISFIED | `audit-jsonl.test.ts`, `audit-concurrency.test.ts` — allow and block rows both written, no torn/lost rows under 4-process concurrency. |
| SAFE-15 | 04-11 | ✓ SATISFIED | `docs/SAFETY.md`'s "Known bypasses" table, 14 rows, cross-checked against the corpus in both directions. |
| SAFE-17 | 04-11 | ✓ SATISFIED | 74-case corpus (>30 required), 60 BLOCKED + 14 documented OUT-OF-SCOPE. |

No orphaned requirements — all 16 IDs mapped to this phase in REQUIREMENTS.md appear in at least one plan's `requirements:` field, and every plan's declared requirement IDs appear in REQUIREMENTS.md under Phase 4. SAFE-16 correctly belongs to Phase 1 and is out of scope here.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `~/.pi/agent/extensions/ky-safety/index.ts` (installed, not tracked) | n/a | stub mtime (05:53) predates the final review-fix commits (up to `04-REVIEW.md`'s iteration 5, ~11:49-11:50) | ℹ️ Info | Cosmetic only. The stub is `export { default } from "<absolute path to repo's .pi/extensions/safety/index.ts>"` — jiti loads the target live on every `pi` invocation with no build/cache step, so the installed byte-age of the stub file itself does not affect which code actually runs. Confirmed independently: the review's own IN-05 finding states the same ("old and new stubs register identically, so nothing is unguarded") and I verified the stub's re-export target path is correct and points at the current source tree. Re-running `bin/bootstrap.sh` would refresh the stub's own comment text but changes no behaviour. Not a gap. |
| `.pi/extensions/safety/approvals.ts:385-393` | `markHookDeferred` | WR-19 (04-REVIEW.md): a REPLAYED `toolCallId` gets unlimited hook-level deferrals (1000/1000 in the reviewer's own measurement) vs. 1/1000 for a distinct id, removing WR-12's unguarded-window bound for that one case | ℹ️ Info (reviewer-classified, disposition: does not block the phase) | Reachable only behind three conjunctive conditions: (a) the already-accepted T-04-08 tool-name-collision scenario (not present in this repo today — `grep`/`find`/`ls` cannot produce a `confirm` verdict), (b) a human has already approved the exact command, and (c) the provider replays the same `toolCallId`. No published document (`docs/SAFETY.md`, `docs/RUNBOOK.md`) makes a claim this contradicts; the over-claim is confined to a source docstring. Carried forward as a named follow-up (WR-19), correctly not gated on for phase completion. |
| `tests/integration/audit-concurrency.test.ts` | n/a | one non-reproduced failure in a mixed-suite batch run during this verification session, under machine load from concurrently-running vitest subsets | ℹ️ Info | Re-ran 3× in isolation (pass/pass/pass) and 1× in an identical mixed batch (pass) immediately after; also passed as part of the single authoritative full-suite run (1180/1180). Classified as timing-sensitive flakiness under contention from real subprocess spawns, not a defect in the writer under test. |

No debt markers (`TBD`/`FIXME`/`XXX`) found anywhere in `.pi/extensions/safety/`, `bin/bootstrap.sh`, `docs/SAFETY.md`, `docs/RUNBOOK.md`, or the phase's key test files. No `TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented" strings found in the same set. No stub-shaped `return null`/`return {}`/`return []`/`=> {}` patterns found in `index.ts`, `policy.ts`, or `approvals.ts` outside test files.

### Human Verification Required

### 1. RB-04-01 — live GitLab protected-branch push rejection

**Test:** On the work laptop, with a local clone of the real work GitLab repository: `git checkout main && git pull`, make a trivial disposable commit, `git push origin main`, observe the result, then `git reset --hard HEAD~1` to discard the local commit (it must never actually reach `main`).
**Expected:** `git push origin main` exits non-zero with GitLab's own protected-branch rejection text on stderr. Record the actual rejection text verbatim in `docs/RUNBOOK.md`'s `RB-04-01` entry and confirm it matches (or note where it differs from) the offline proxy's assumed wording (`You are not allowed to push code to protected branches on this project.`). Once confirmed, flip `RB-04-01`'s status to RESOLVED in both places (`docs/RUNBOOK.md`'s summary table row and its `**Status:**` line — a half-flip is reported `INCONSISTENT` by `tests/unit/docs-policy.test.ts`) and flip `SAFE-01` from `[~]` to `[x]` in `.planning/REQUIREMENTS.md`.
**Why human:** This dev machine has no GitLab access, no work-laptop credentials, and no network egress to the user's work GitLab instance. Whether GitLab's protected-branch rule and push rules are actually configured on `main` is a fact about a server this machine cannot reach — no local test, however well-constructed, can substitute for asking GitLab directly. This is explicitly named in the phase goal itself ("the limits of that protection are documented rather than assumed") and is pre-authorised by the project's standing autonomous-run policy as an expected `human_needed` outcome, not a gap.

### Gaps Summary

No code gaps found. All 15 fully-in-scope requirements (SAFE-02 through SAFE-15, SAFE-17) are genuinely implemented, substantively wired, and covered by tests that were independently re-run in this verification session (full suite: 1180/1180 tests, 67 files, clean `tsc --noEmit`, clean `git status`). The evasion corpus's published numbers (74 total, 60 blocked, 14 documented out-of-scope) were independently re-derived from the repository files, not taken from `04-REVIEW.md`'s prose, and match exactly. `tests/integration/subagent-block.test.ts` was read in full and found to be a genuine, non-tautological proof of SAFE-12 (real spawned child, real audit-log evidence, real project-scope-absence proof).

The single outstanding item, SAFE-01 / roadmap Success Criterion 1 (live GitLab server-side push rejection), is correctly `[~]` partial in `REQUIREMENTS.md` and correctly `OUTSTANDING` in `docs/RUNBOOK.md`'s `RB-04-01` in both required places. This is not a code gap: the offline proxy that can be tested here is shipped, green, and independently re-verified. It requires the user's own credentials and network access to the real work GitLab instance, which this environment does not have. Per the verification brief's explicit instruction, this drives the phase status to `human_needed` rather than `gaps_found`, and this outcome is pre-authorised and expected — not a finding that blocks the phase.

Two info-tier items are carried forward, both already disclosed and disposed of by the phase's own independently-executed final code review (`04-REVIEW.md`, iteration 5, status `clean`, 0 blockers, 0 warnings requiring action): WR-19 (a narrow, conditionally-reachable robustness regression in replayed-`toolCallId` deferral bounding, confined to a source docstring over-claim with no published-document contradiction) and IN-05 (the installed user-scope stub's byte-age, cosmetic only since jiti loads the re-export target live). Neither is a functional gap and neither requires action to consider this phase's goal achieved.

---

_Verified: 2026-08-14_
_Verifier: Claude (gsd-verifier)_
