# Requirements check, 2026-10-14

After the codebase-wide production pass (HEAD `cc3f184` plus this check's
commit). Each requirement was matched to the code that implements it and the
test that proves it, by grep; a sample of 23 test files was then run. "Held"
means the requirement still holds at its recorded level: a `[~]` requirement
stays partial until its named live `RB-` check in `docs/RUNBOOK.md` runs.

## Summary

| Result | Count |
|---|---|
| Held | 132 (99 complete, 33 partial pending a live check) |
| Held, guard added (unasserted before) | 2: CMT-05, UPG-05 |
| Held, stale text fixed | 3: SAFE-01, GATE-02, EXT-01 |
| Deviation, not fixed | 1: FLOW-01 |
| Broken by the refactors | 0 |
| Total | 138 (122 v1 + 16 standing) |

Tests run, one invocation at a time with `--maxWorkers=2`, all green:
`tests/unit/` docs-policy, traceability, secret-scan, comment-discipline,
pinning, openspec-docs, model-metadata, shell-deny-list, push-confirm,
protected-branches, routing-dispatch, evidence-gate, prose-detector,
quality-schema, grill-scorecard, design-review, subagent-guard,
comment-rules-delivery, lf-and-shell, workflow-budgets;
`tests/integration/` bootstrap-safety-stub, quick-workflow, prose-retry.
`npx tsc --noEmit` exits 0. Rows marked "(ran)" cite one of these files.

## Fixes made

- **CMT-05:** the 35% ceiling was printed, never asserted. `comment-discipline`
  now fails above it (authored ratio today: 18.4%).
- **UPG-05:** `maxWorkers: 2` had no test. `pinning` now imports
  `vitest.config.ts` and asserts it.
- **SAFE-01:** the text credited "the harness's own `classifyPushFailure()`";
  that function left `safety/git.ts` in 12.1-02 and lives only in the test.
  REQUIREMENTS and `RB-04-01` now say so.
- **GATE-02:** REQUIREMENTS and `RB-08-03` still described
  `.pi/agents/reviewer.md`, removed in 12.1-08 because it shadowed
  pi-subagents' builtin `reviewer`. Text and the RB-08-03 step corrected.
- **EXT-01:** the text cited the `pi-subagents@0.49.0` tarball; the pin and the
  evidence table are 0.76.1.

## Open

- **FLOW-01:** the requirement says `/quick` in 80 lines or fewer; it is 87.
  The CI ceiling is 100 (ROADMAP: "if it exceeds 100 it has failed") and holds.
  The file has been over 80 since 2026-10-13, and the refactor cut it from 97.
  Getting under 80 means moving hooks into a helper or joining lines, which
  `docs/WORKFLOWS.md` §3 names as gaming the budget. Decide: amend the target
  to the enforced ceiling, or trim the file.
- **Weak evidence, not broken:** vendored loop police has no behavioural test
  here (source-shape and composition tests only); GATE-05's real proof
  (`quality-schema`) does not cite the ID; `isFixFramed`, `parseScopePin`,
  `parsePlanTasks` and `TASK_LINE_PATTERN` are tested only through
  `validateSpec` and `validatePlan`.

## v1 requirements

| Requirement | Summary | Status | Code | Test |
|---|---|---|---|---|
| BOOT-01 | Project `.npmrc` ignore-scripts, asserted before install | Held | `.npmrc`; `bin/bootstrap.sh` (ignore-scripts assertion) | integration/npmrc-ordering, unit/npmrc-policy |
| BOOT-02 | `pi install <repo URL>` on clean machine | Held (partial: live RB check outstanding) | `package.json` `pi` manifest | integration/load-paths (case 2), unit/extension-layout |
| BOOT-03 | `bin/bootstrap.sh` cold-machine bootstrap, tool probes | Held | `bin/bootstrap.sh`, `bin/bootstrap.mjs` | integration/bootstrap-check-only |
| BOOT-04 | Loud failure if pinned Pi unpublished | Held | `bin/bootstrap.sh` (`npm view ${PI_PKG}@${PI_PINNED}`) | unit/version-gate |
| BOOT-05 | `.pi/` dogfood load, `/reload` works | Held (partial: live RB check outstanding) | `package.json` pi.extensions `./.pi/extensions` | integration/load-paths, unit/extension-layout |
| BOOT-06 | POSIX sh, LF checkout | Held (partial: live RB check outstanding) | `.gitattributes`, `*.sh` | unit/lf-and-shell (`dash -n`, CR scan; /usr/bin/dash present) (ran) |
| BOOT-07 | CI on windows-latest + macos-latest | Held (partial: live RB check outstanding) | `.github/workflows/ci.yml` | unit/ci-pinning |
| BOOT-08 | Exact pins + committed lockfile | Held | `package.json`, `package-lock.json` | unit/pinning (ran) |
| BOOT-09 | `.gitignore` covers secrets/state, tested | Held | `.gitignore` | unit/gitignore-policy |
| BOOT-10 | CONTRIBUTING boundary rule for tools | Held | `CONTRIBUTING.md` | unit/contributing-boundary, unit/tool-count-baseline |
| DIAG-01 | Capture provider request/response/headers on wire | Held (partial: live RB check outstanding) | diagnostics/wire.ts `registerWireHooks`, `captureRequestPayload` | integration/wire-capture, unit/wire-nonmutating, unit/diagnostics-entry |
| DIAG-02 | Single `callModel()` chokepoint | Held | diagnostics/call-model.ts `callModel` | integration/call-model, unit/call-model-containment |
| DIAG-03 | Lint fails on `modelRegistry.complete` outside diagnostics | Held | (lint lives in test) | unit/chokepoint-lint |
| DIAG-04 | Per-turn JSONL row | Held | diagnostics/turns.ts `composeTurnRow`, `cacheReadRatio` | unit/turn-row, unit/turn-hooks, integration/turns-log |
| DIAG-05 | Prose tool-call detector + retry | Held (partial: live RB check outstanding) | diagnostics/prose.ts `isProseToolCall`; schema.ts `MAX_PROSE_RETRIES`, `PROSE_RETRY_PROMPT` | unit/prose-detector, integration/prose-retry (ran) |
| DIAG-06 | `/budget` section token report | Held | diagnostics/budget.ts `computeBudget`, `registerBudgetCommand` | unit/budget-command, integration/budget, unit/budget-sections |
| DIAG-07 | Redact at capture, gitignored paths | Held | diagnostics/redact.ts `redactDeep`, `redactHeaders`; lib/secret-patterns.ts | unit/redact, unit/logs-gitignored, integration/wire-capture |
| DIAG-08 | Log rotation | Held | lib/jsonl.ts `rotate`, `pruneLogs`; schema.ts `WIRE_ROTATE_BYTES` | unit/jsonl-rotation, unit/jsonl-append-only, integration/jsonl-concurrency |
| PROV-01 | Secret-free models/auth templates | Held | `.pi/templates/{models,auth}-template.json` | integration/templates-install, unit/template-tracked |
| PROV-02 | `!command` only in auth.json | Held | `.pi/templates/*` | unit/command-interpolation, integration/templates-install |
| PROV-03 | DashScope explicit compat block | Held (partial: live RB check outstanding) | `.pi/templates/models-template.json` | unit/dashscope-compat, integration/dashscope-payload |
| PROV-04 | Bedrock via `credential.env.AWS_PROFILE` | Held (partial: live RB check outstanding) | providers/index.ts `resolveProfileName`; schema.ts `AWS_PROFILE_ENV` | unit/bedrock-auth |
| PROV-05 | Expired SSO: actionable, non-retryable | Held | providers/sso.ts `classifySso`, `SSO_PATTERNS` | integration/sso-classifier, unit/bedrock-auth |
| PROV-06 | Accurate per-provider capability metadata | Held (partial: live RB check outstanding) | `.pi/templates/models-template.json` (`COST_UNVERIFIED` is test-side) | unit/model-metadata (ran) |
| PROV-07 | R1 low-vs-high reasoning experiment | Held (partial: live RB check outstanding) | none in prod (docs/RUNBOOK.md RB-03-04; by design) | unit/r1-unclamp |
| PROV-08 | DeepSeek→DashScope fallback chain | Held | providers/fallback.ts `callWithFallback`, `classifyFailure`; schema.ts `CHAIN` | integration/fallback-chain |
| PROV-09 | First-run runbook with expected outputs | Held | `docs/RUNBOOK.md` | unit/docs-policy (no ID; `INCONSISTENT` status check) (ran) |
| PROV-10 | DashScope two-turn tool sequence 200 | Held (partial: live RB check outstanding) | models-template compat | integration/dashscope-payload |
| SAFE-01 | Server-side protected branches, push must fail | Held, text fixed | no production classifier (removed 12.1-02); text now says the test's own classifier | integration/gitlab-push-protection |
| SAFE-02 | unbash AST, wrapper resolution | Held | safety/shell.ts `canonicalise`, `wrappedCommands` | unit/shell-parse, unit/unbash-ast |
| SAFE-03 | Unparseable fails closed | Held | shell.ts `DENIED_PART_TYPES`, `SHELL_REFUSAL_CAUSES` | unit/shell-parse, unit/shell-deny-list, unit/unbash-ast (ran) |
| SAFE-04 | Block writes when HEAD==main | Held | safety/git.ts `classifyGitInvocation`, `currentBranch` | unit/git-policy, integration/git-head-main |
| SAFE-05 | Block `glab mr merge` | Held | git.ts `classifyGlabInvocation` | unit/git-policy |
| SAFE-06 | Block .env/creds/kubeconfig/tfstate reads | Held | safety/paths.ts `classifyPathRead`, `SENSITIVE_READ_PATTERNS` | unit/path-policy, integration/double-enforcement |
| SAFE-07 | Infra mutations require confirmation | Held | safety/infra.ts `classifyInfraInvocation`, `TERRAFORM_CONFIRM_SUBCOMMANDS` | unit/infra-policy |
| SAFE-08 | Block writes outside project | Held | paths.ts `classifyPathWrite` | unit/path-policy |
| SAFE-09 | Enforce at tool_call hook and wrapped bash | Held | safety/index.ts `registerToolCallHook`, `registerWrapped(createBashTool)` | integration/double-enforcement |
| SAFE-10 | Deny-by-default confirm; approve_ky_command | Held | safety/index.ts `CONFIRM_TIMEOUT_MS`, `APPROVE_TOOL_NAME`; approvals.ts | unit/approvals, unit/push-confirm, integration/headless-deny (ran) |
| SAFE-11 | Safety at user scope; child guard | Held | bin/bootstrap.mjs `writeStub`; safety/subagents.ts `registerChildGuard` | integration/user-scope-load, integration/bootstrap-safety-stub, integration/subagent-block (ran) |
| SAFE-12 | Block test passes inside subagent | Held | safety/subagents.ts `CHILD_GUARD_ID` | integration/subagent-block |
| SAFE-13 | Guard .git/hooks, .bashrc, CI files | Held | paths.ts `DETONATION_TARGETS`, `GUARD_CODE_TARGETS` | unit/path-policy |
| SAFE-14 | Audit JSONL of every allow/block | Held | safety/audit.ts `writeAuditRow` | unit/audit-jsonl, integration/audit-concurrency |
| SAFE-15 | Documented known-bypass table | Held | docs/SAFETY.md "Known bypasses…" | unit/evasion-corpus (Group B cross-check) |
| SAFE-16 | `gh` unauthenticated, in runbook | Held (partial: live RB check outstanding) | scripts/check-gh-unauthenticated.sh | unit/gh-unauthenticated, unit/docs-policy (ran) |
| SAFE-17 | ≥30 evasion attempts tested | Held | fixtures/evasion-corpus.ts | unit/evasion-corpus (`toBeGreaterThanOrEqual(30)`; no ID-cite in .test.ts) |
| ROUTE-01 | Explicit role→model map | Held | routing/schema.ts `ROLE_MAP`, `ROLES` | unit/routing-map |
| ROUTE-02 | /cheap /balanced /max via setModel after idle | Held | routing/index.ts `registerCommand(mode)`; schema.ts `MODES` | integration/mode-switch |
| ROUTE-03 | /escalate sticky elevated state | Held | routing/modes.ts `setEscalated`; index.ts `escalate` | integration/escalate, unit/routing-dispatch (ran) |
| ROUTE-04 | Single-shot roles via callModel, per-call effort | Held | modes.ts `runSingleShotRole`, `planRoleCall`, `resolveRoute` | integration/single-shot-roles, unit/routing-dispatch (ran) |
| ROUTE-05 | Tool-loop roles run as subagents | Held | schema.ts `ROLE_MECHANISM`; modes.ts `usesToolLoop` | integration/mode-switch, unit/agent-overrides |
| ROUTE-06 | Capability guard: image/context window | Held | routing/guard.ts `guardRoute`, `deriveNeed` | unit/capability-guard, integration/model-select-guard |
| ROUTE-07 | Block Bedrock non-Claude with thinking | Held | guard.ts `isAnthropicClaudeModel`, `guardRoute` | unit/capability-guard (no ID; "Block 3") |
| ROUTE-08 | Block Bedrock R1 as executor | Held | guard.ts `guardRoute` (deny-list) | unit/capability-guard, unit/agent-overrides |
| ROUTE-09 | Mode persists via appendEntry | Held | schema.ts `MODE_ENTRY_TYPE`; index.ts `restoreModeFromBranch` | integration/mode-persistence |
| ROUTE-10 | Wire dump proves model per switch | Held | diagnostics/wire.ts + routing `ROUTING_EVENT` | integration/wire-proof |
| ROUTE-11 | Qoder delegate tool (foreign agent) | Held (partial: live RB check outstanding) | qoder/client.ts `delegateTask`, `parseSseFrames`, `resolveQoderConfig` | unit/qoder-client, integration/qoder-delegate, integration/qoder-tool |
| EXT-01 | Subagent per-agent model/prompt/tools/thinking | Held, text fixed | `.pi/agents/planner.md`, routing/agent-overrides.ts; tarball version in text corrected to 0.76.1 | unit/subagent-capabilities, unit/subagent-agents-config |
| EXT-02 | Worktrees build, untracked files don't travel | Held | `.pi/scripts/worktree-setup-hook.mjs` | integration/worktree-build |
| EXT-03 | Background subagents | Held (partial: live RB check outstanding) | none local (pi-subagents tarball cite) | unit/subagent-capabilities |
| EXT-04 | Mid-run steering | Held (partial: live RB check outstanding) | none local (`deliverSteerRequest` is pi-subagents) | unit/subagent-capabilities |
| EXT-05 | Plan/todo/bg/LSP/ask/web/search/loop available | Held (partial: live RB check outstanding) | plan-mode/, todo.ts, questionnaire.ts, loop-police/; `.pi/settings.json` packages | unit/extension-composition |
| EXT-06 | Prefer Pi bundled examples | Held | vendored plan-mode/todo/questionnaire | unit/extension-composition |
| EXT-07 | File checkpointing restores tree | Held | checkpoint/git.ts `createCheckpoint`, `restoreCheckpoint` | integration/git-checkpoint, unit/checkpoint-store |
| EXT-08 | Pins re-verified at planning time | Held | `.pi/settings.json` | unit/extension-pins |
| EXT-09 | Smoke-test ritual per version bump | Held (partial: live RB check outstanding) | docs/RUNBOOK.md RB-07-01 | unit/docs-policy (RB-07-01 rows; no ID) (ran) |
| EXT-10 | Unlicensed extensions vendored | Held | loop-police/PROVENANCE.md | unit/vendor-license-audit |
| GATE-01 | Deterministic gates before model review | Held (partial: live RB check outstanding) | quality/gates.ts `runTypecheckLeg`, `runAntiPatternLeg`, `probeLspAvailability`; index.ts `runChangeGateStage` | unit/quality-gates, unit/quality-production-exec |
| GATE-02 | Reviewer gets six-element contract | Held, text fixed | quality/reviewer.ts `buildReviewerContext`; stale `.pi/agents/reviewer.md` reference removed from REQUIREMENTS and RB-08-03 | integration/reviewer-contract, unit/reviewer-import-graph |
| GATE-03 | Per-requirement verdict with file:line | Held | quality/review-schema.ts `validateReview`, `isFileLine` | unit/quality-schema (ran) |
| GATE-04 | Mandatory "checked and cleared" | Held | review-schema.ts `validateReview` | unit/quality-schema (ran) |
| GATE-05 | BLOCKER/WARNING/NIT; unclassified rejected | Held | review-schema.ts `SEVERITIES`, `NIT_CAP` | unit/quality-schema (ID-cite is only in grill-evidence-gate, unrelated) (ran) |
| GATE-06 | Refute-or-promote BLOCKERs | Held | quality/verdict.ts `runRefuteOrPromote` | integration/refute-or-promote |
| GATE-07 | Completion gated on exit codes + SHA | Held | workflows/evidence.ts `gateCompletion`, `onlyCommitsSince` | unit/evidence-gate, integration/quick-workflow (ran) |
| GATE-08 | Seeded-defect reviewer calibration | Held (partial: live RB check outstanding) | quality/calibration.ts `scoreCalibration` | integration/reviewer-calibration |
| GATE-09 | Advisor consult via callModel | Held | quality/advisor.ts `executeConsultAdvisor` | integration/advisor-consult |
| GATE-10 | Nested per-role thinking budgets | Held (partial: live RB check outstanding) | routing/modes.ts `buildNestedApiOptions` | integration/gate10-nested-thinking |
| QUAL-01 | Anti-pattern rules (magic no., N+1, TODO…) | Held | quality/rules.ts `runAntiPatternRules`, `ruleNPlusOne` etc. | unit/quality-rules |
| QUAL-02 | Rules inside deterministic stage, no model call | Held | gates.ts `runAntiPatternLeg` | unit/quality-gates |
| QUAL-03 | Root Cause section for fix-framed SPEC | Held | grill/spec-schema.ts `validateSpec`, `isFixFramed`, `parseRootCause` | unit/spec-error-behaviour |
| QUAL-04 | Reviewer classifies root-cause/symptomatic/workaround | Held | review-schema.ts (classification) | integration/reviewer-contract, unit/quality-schema (ran) |
| QUAL-05 | Symptomatic/workaround stops workflow | Held | verdict.ts `decideWorkflowStop` | integration/quality-gate-order, integration/refute-or-promote |
| QUAL-06 | Workaround recorded in MR body | Held | review/mr.ts `buildMrBody` | integration/review-mr (no ID; "records the proper fix and deferral") |
| QUAL-07 | Conditional design-review pass | Held | quality/design-review.ts `computeDesignSignals`, `runDesignReview`; gates.ts `shouldRunDesignReview`, `DESIGN_REVIEW_FILE_SPAN` | unit/design-review, unit/quality-gates, integration/review-command (ran) |
| QUAL-08 | Gate depth scales by workflow | Held | gates.ts `GATE_DEPTH_BY_WORKFLOW`, `gateDepthFor` | unit/gate-depth-selector (no ID) |
| QUAL-09 | Quality cost per turn in JSONL | Held | diagnostics/quality-cost.ts `addQualityCost`, `takeQualityCost` | integration/turns-log, unit/turn-row, integration/advisor-consult |
| FLOW-01 | `/quick` ≤80 lines, CI budget | Deviation | workflows/index.ts is 87 raw lines: under the enforced 100-line ceiling, over the 80-line target (over 80 since 2026-10-13; the refactor cut it from 97) | unit/workflow-budgets (ceiling 100, file budget 90), integration/quick-workflow (ran) |
| FLOW-02 | /grill scorecard, floors, budget 5, rotation | Held | grill/scorecard.ts `gateAmbiguity`, `HARD_QUESTION_BUDGET`=5, `nextQuestionSlot` | unit/grill-scorecard, integration/grill-command, integration/ceremony-gates (ran) |
| FLOW-03 | Verified Codebase Facts before requirements | Held | spec-schema.ts `gateRequirementsAuthorship`, `parseVerifiedFacts` | unit/grill-evidence-gate, integration/grill-command |
| FLOW-04 | IF/THEN error behaviour, min 3 | Held | spec-schema.ts `IF_THEN_PATTERN`, `MIN_ERROR_BEHAVIOURS` | unit/spec-error-behaviour (via `validateSpec`) |
| FLOW-05 | Expected-files scope pin vs diff | Held | spec-schema.ts `parseScopePin`; review/scope-drift.ts `compareScope`, `changedFilesSince` | unit/spec-error-behaviour, unit/review-render, unit/scope-drift, integration/scope-drift |
| FLOW-06 | PLAN.md task-line form + coverage matrix | Held | plan-ceremony/plan-schema.ts `validatePlan`, `TASK_LINE_PATTERN`; index.ts `writePlanIfGated` | unit/plan-task-form, integration/plan-command |
| FLOW-07 | /execute PROGRESS append + atomic commit | Held | execute/progress.ts `appendProgress`, `driftAbort` | integration/execute-workflow (no ID) |
| FLOW-08 | /review REVIEW.md + MR to staging | Held (partial: live RB check outstanding) | review/mr.ts `openMr`, `MR_TARGET_BRANCH`="staging" | integration/review-mr, integration/review-command |
| FLOW-09 | Self-contained handoff packets | Held (partial: live RB check outstanding) | execute/handoff.ts `buildHandoffPacket`, `measurePacketDelta` | unit/handoff-packet |
| FLOW-10 | Artifact set = SPEC/PLAN/REVIEW/PROGRESS | Held | .pi/lib/work-artifacts.ts `ARTIFACT_FILES` | unit/artifact-count, unit/work-artifacts |
| FLOW-11 | Every workflow line-budgeted | Held | (registry in test) | unit/workflow-budgets (ran) |
| CTX-01 | Named tool profiles at session_start | Held | routing/profiles.ts `TOOL_PROFILES`, `applyProfile` | integration/tool-profiles, unit/tool-profiles-table |
| CTX-02 | setActiveTools, not context hook | Held | profiles.ts `applyProfile`; routing/loader.ts `registerBgLoader` | integration/context-hook-tools, unit/context-hook-lint |
| CTX-03 | AGENTS.md hard token budget | Held | `AGENTS.md` | unit/agents-md-budget |
| CTX-04 | No volatile content in system prompt | Held | (ui/ chrome only) | integration/prompt-stability |
| CTX-05 | Minimal-vs-full harness experiment | Held (partial: live RB check outstanding) | scripts/ctx-experiment-core.ts, ctx-experiment.sh | unit/ctx-experiment, unit/ctx-experiment-launcher |
| CTX-06 | Per-extension per-turn token cost | Held (partial: live RB check outstanding) | diagnostics/budget.ts `estimateTokensFromChars` | integration/context-floor, unit/tool-count-baseline |
| UI-01 | Custom theme ships | Held (partial: live RB check outstanding) | `.pi/themes/ky.json` | unit/ui-theme |
| UI-02 | Statusline model/ctx/cost/branch/files | Held (partial: live RB check outstanding) | ui/statusline.ts `formatStatusline`; ui/git-probe.ts | unit/ui-statusline, integration/ui-chrome |
| UI-03 | Custom startup header | Held (partial: live RB check outstanding) | ui/header.ts `formatHeaderLines`, `createHeaderComponent` | integration/ui-chrome |
| UI-04 | Live subagent widget | Held (partial: live RB check outstanding) | ui/agents.ts `createAgentTracker`, `SUBAGENT_BUS_TOPICS` | integration/ui-chrome (bus stubs), unit/ui-statusline |
| UI-05 | No UI cache invalidation | Held (partial: live RB check outstanding) | ui/index.ts | integration/ui-prompt-stability, unit/ui-prompt-surface-lint |
| CMT-01 | AGENTS.md rules ≤15 lines; CLAUDE.md @AGENTS.md | Held | `AGENTS.md`, `CLAUDE.md` | unit/comment-rules-delivery (no ID) (ran) |
| CMT-02 | Rules delivered to every project | Held (partial: live RB check outstanding) | harness/comment-rules.ts `COMMENT_RULES_TEXT`, `hasCommentRulesHeading`; harness/index.ts | unit/comment-rules-delivery (ran) |
| CMT-03 | Fail on IDs in authored comments | Held | (scanner in tests/helpers/comment-scan.ts) | unit/comment-discipline (ran) |
| CMT-04 | Report per-file and total comment ratio | Held | — | unit/comment-discipline ("reports comment ratio", console only) (ran) |
| CMT-05 | Authored comment ratio ≤35% | Held, guard added | — | unit/comment-discipline: now asserts authored ratio <= 35% (measured 18.4%) (ran) |
| UPG-01 | Pi family 1.1.0; typebox/vitest match; piPinned | Held | package.json devDeps; bin/bootstrap.mjs `piPinned` | unit/pinning (`PI_FAMILY_PIN`), integration/templates-install (piPinned) (ran) |
| UPG-02 | TranscriptContext faux helper; re-verified | Held | tests/helpers/faux.ts, harness-session.ts | integration/call-model, budget, prompt-stability… (no ID) |
| UPG-03 | Guard covers powershell + codemode nested calls | Held | safety/index.ts (powershell), routing/profiles.ts | integration/new-tool-paths |
| UPG-04 | Re-pinned; bg-tasks vendored + peer-patched | Held | .pi/extensions/background-tasks/ (+PROVENANCE.md) | integration/background-tasks-load, unit/extension-pins |
| UPG-05 | vitest maxWorkers 2; tsc + suite pass | Held, guard added | vitest.config.ts:11 `maxWorkers: 2` | unit/pinning "vitest worker cap" asserts maxWorkers 2; tsc --noEmit exit 0 (ran) |
| UPG-06 | Shrinkwrap removal documented + mitigated | Held | CONTRIBUTING.md:114 | unit/pinning ("does not use npm-shrinkwrap.json"); doc text untested (ran) |
| OSPEC-1 | openspec CLI pinned; telemetry/update/autoconfig off | Held (partial: live RB check outstanding) | scripts/openspec-setup.sh `OPENSPEC_VERSION="1.13.2"`; harness/index.ts:21 env force-set | unit/openspec-env, integration/openspec-setup |
| OSPEC-2 | Skills at user level, disable-model-invocation | Held (partial: live RB check outstanding) | scripts/openspec-setup.sh | integration/openspec-zero-cost, unit/openspec-skills, integration/openspec-setup |
| OSPEC-3 | Guard classifies openspec; openspec/ ignored | Held | infra.ts `OPENSPEC_ALLOW_SUBCOMMANDS`, `OPENSPEC_CONFIRM_SUBCOMMANDS`; `.gitignore:181` `/openspec/` | unit/infra-policy, unit/gitignore-policy |
| OSPEC-4 | Install/upgrade docs; openspec-pi rejected | Held (partial: live RB check outstanding) | docs/OPENSPEC.md, bin/bootstrap.sh | unit/openspec-docs (ran) |

## Standing requirements

| Requirement | Summary | Status | Code | Test |
|---|---|---|---|---|
| S-01 | Make cheap models reliable | Held | workflows/evidence.ts `gateCompletion`; diagnostics/prose.ts `isProseToolCall` + `MAX_PROSE_RETRIES`; loop-police/loop-police.ts `loopPolice`, `detectSemanticLoop`; quality/gates.ts `GATE_DEPTH_BY_WORKFLOW` | unit/evidence-gate, unit/prose-detector, integration/prose-retry, unit/quality-gates, integration/quality-gate-order; loop police: only unit/loop-police-hook-egress (source shape) + extension-composition — no behavioural detection test (ran) |
| S-02 | Zero spend beyond model tokens | Held | package.json `dependencies` = typescript 5.9.3, unbash 4.0.10 only | unit/pinning `REQUIRED_RUNTIME_PINS`, "BOOT-08.5 runtime dependencies block" (ran) |
| S-03 | Self-hosted, local JSONL, no services | Held | .pi/lib/jsonl.ts `appendJsonl`, `rotate`; safety/audit.ts; workflows/evidence.ts `EVIDENCE_LOG_BASE` | unit/jsonl-append-only, unit/jsonl-rotation, unit/logs-gitignored, integration/turns-log |
| S-04 | POSIX sh on Windows Git Bash | Held | bin/*.sh, scripts/*.sh, `.gitattributes` | unit/lf-and-shell (`dash -n`, CR scan, bash-4 constructs) (ran) |
| S-05 | No secrets in public repo | Held | `.gitignore`; .pi/lib/secret-patterns.ts | unit/secret-scan, unit/gitignore-policy, unit/template-tracked (ran) |
| S-06 | Exact pins | Held | package.json, package-lock.json, `.pi/settings.json` packages | unit/pinning, unit/extension-pins `isPinnedPackageSpec`, unit/ci-pinning (ran) |
| S-07 | Concise WHY-only comments, rules injected elsewhere | Held | harness/comment-rules.ts `COMMENT_RULES_TEXT`/`COMMENT_RULES_HEADING`; injected from harness/index.ts (before_agent_start) | unit/comment-discipline, unit/comment-rules-delivery (≤15 lines, injects once, not when heading present) (ran) |
| S-08 | Strict pipe rule: piped code runner refused | Held | safety/shell.ts `runsGeneratedScript` (`scan.piped.has(node)`, shell.ts:783), cause `generated-script` | unit/shell-deny-list `PIPE_ROWS` (e.g. `cat x \| node s.js` → refused), unit/policy-compose (ran) |
| S-09 | Push confirm + protected branches | Held | safety/index.ts `CONFIRM_TIMEOUT_MS`=300_000, `PROTECTED_BRANCHES`; safety/branches.ts `effectiveBranches`, `BUILTIN_PROTECTED` | unit/push-confirm ("rpc … 5 minute timeout"), unit/protected-branches (ran) |
| S-10 | /grill and /plan budgets | Held | grill/scorecard.ts `HARD_QUESTION_BUDGET`=5; grill/turns.ts `TURN_BUDGET`=budget+1 (shared by plan-ceremony/index.ts) | unit/grill-scorecard, integration/ceremony-gates ("same hard turn budget as /grill"), unit/workflow-budgets (line budgets grill 110, plan 100) (ran) |
| S-11 | Evidence gate | Held | workflows/evidence.ts `gateCompletion`, `recordToolResult`, `onlyCommitsSince` | unit/evidence-gate (ran) |
| S-12 | /quick deterministic gate at agent_settled | Held | workflows/settle.ts `settleQuickRun`, `armQuickSettle`; quality/index.ts `runChangeGateStage` | integration/quick-workflow ("/quick gates its own change at agent_settled") (ran) |
| S-13 | /review with design review | Held | review/index.ts; quality/design-review.ts `runDesignReview`; gates.ts `shouldRunDesignReview` | unit/design-review, integration/review-command (ran) |
| S-14 | Subagent guard | Held | safety/subagents.ts `classifySubagentCall`, `registerChildGuard`, `SUBAGENT_READ_ONLY_ACTIONS` | unit/subagent-guard, integration/subagent-block (ran) |
| S-15 | Bedrock `apac.` prefix setting | Held | routing/schema.ts `BEDROCK_PROFILE_PREFIX_SETTING`="kyPiAgent.bedrockProfilePrefix", `BEDROCK_PROFILE_PREFIX_DEFAULT`="apac."; modes.ts `bedrockProfilePrefix`, `resolveBedrockRef` | unit/routing-dispatch:426-455 (default apac., "us.", "" bare, invalid rejected), unit/agent-overrides (ran) |
| S-16 | Bootstrap npm ci, filtered harness entry, fail-closed stub | Held | bin/bootstrap.sh:277-290 `npm ci --ignore-scripts`; bin/bootstrap.mjs:206 `extensions: ["!.pi/extensions/safety/**"]`, `writeStub`, `reportDelivery` | integration/templates-install case 4f (npm ci after hardening) + :943 (filtered entry); integration/bootstrap-check-only cases 5-7e, 9; integration/bootstrap-safety-stub case 9 (missing target blocks every tool call) (ran) |
