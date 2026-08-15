# Phase 9: Ceremonial Workflows - Context

**Gathered:** 2026-08-15
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

The GSD replacement exists — a spec that cannot be written on unverified assumptions, a plan with verification commands, an execution that pastes real output, and a review that opens an MR to staging.

**Requirements:** FLOW-02, FLOW-03, FLOW-04, FLOW-05, FLOW-06, FLOW-07, FLOW-08, FLOW-09, FLOW-10, QUAL-03, QUAL-08

**Depends on:** Phase 4 (`classifyGitInvocation` / `classifyGlabInvocation` / `PROTECTED_BRANCHES` / `currentBranch` — the MR and protected-branch controls, which Phase 9 **extends, never duplicates**), Phase 5 (`runSingleShotRole`, the `ROLES` table, `agentOverridesFor`), Phase 6 (`/quick`, `evidence.ts`'s `gateCompletion`, and FLOW-11's line-budget registry), Phase 7 (`.pi/agents/{planner,reviewer}.md`, the five pinned-but-**uninstalled** packages), Phase 8 (`.pi/extensions/quality/` — the four quality mechanisms this phase dials).

**Deliberately NOT in this phase:** FLOW-01 and FLOW-11 are Phase 6's and already `[x]`. GATE-01..10 and QUAL-01/02/04/05/06/07/09 are Phase 8's and already built — **Phase 9 wires and dials them; it does not rebuild them.** Everything about cutting per-turn token cost, `pi.setActiveTools()` profiles and the `AGENTS.md` budget is Phase 10.

**Success criteria (from ROADMAP.md, binding — this is the spec):**

1. `/grill` interrogates with an ambiguity scorecard, per-dimension floors, a **hard question budget**, **one question at a time** and **rotating perspectives** — and **REFUSES to write requirements** until SPEC.md carries a Verified Codebase Facts table (`claim | evidence (file:line or command output) | how verified`).
2. SPEC.md states error behaviour as `IF <condition> THEN THE SYSTEM SHALL <response>`, pins scope as a **machine-checkable expected-files list**, and — for any change framed as a fix — carries a **Root Cause** section naming the cause with `file:line` evidence and stating why the change addresses the cause rather than the symptom.
3. `/plan` produces tasks in `T### [P] [R#] verb <explicit path> + verification command` form with a requirement-coverage matrix, and `/execute` appends **REAL PASTED** command output to PROGRESS.md and commits atomically.
4. `/review` produces REVIEW.md and opens an MR targeting **staging, never `main`**, with the diff checked against SPEC's expected-files list — **and one real feature has shipped end to end this way on the work laptop**.
5. Gate depth **SCALES with the work**: `/quick` runs deterministic rules only while the full workflow runs all four quality mechanisms; subagents receive **self-contained handoff packets** so delegation costs **negative tokens in the parent**; total artifacts remain SPEC, PLAN, REVIEW plus a PROGRESS append, with **NO DOCUMENT NO DOWNSTREAM CONSUMER READS**.

**Contains [RUNBOOK] work.** Criterion 4's second clause — *"one real feature has shipped end to end this way on the work laptop"* — is inherently a live check against the user's GitLab work repo. It is `RB-09-xx`, **OUTSTANDING**, and FLOW-08 stays `[~]` partial with that id named inline. So is any live `pi-subagents` handoff spawn (the packages are pinned and **not installed**). `RB-01-01 … RB-08-03` exist — **append `RB-09-xx`, never renumber**. `tests/unit/docs-policy.test.ts` reads each status from *two* places (the summary-table row and the `**Status:**` line under `### RB-09-xx — …`) and reports `INCONSISTENT` — never an acceptable status — if they disagree; add the new ids to a `PHASE_NINE_IDS` array **and** `ALL_IDS`, and their whole one-line commands to `ENTRY_COMMANDS`, in the same change.

</domain>

<decisions>
## Implementation Decisions

Recorded in PROJECT.md (Key Decisions, Constraints), ROADMAP.md, REQUIREMENTS.md, CONTRIBUTING.md and `.planning/research/{FEATURES,PITFALLS,ARCHITECTURE,SUMMARY}.md`. Binding on this phase; not to be re-derived and not to be re-litigated.

### *** THREE CORRECTIONS TO PROJECT-WIDE ASSUMPTIONS — READ BEFORE PLANNING ***

**1. The dev machine DOES hold live credentials.** Long-lived **static IAM admin keys in plaintext at `~/.aws/credentials`**, verified in Phase 7 (`aws sts get-caller-identity` exits 0). The "no credentials on the dev machine" premise is **false as a security assumption**; it holds only in the narrow sense that no *provider inference* key is configured for Pi. Binding on every plan here: **do NOT execute `[RUNBOOK]` items against these credentials; do NOT issue provider inference requests; treat any tool-execution decision as running next to live admin credentials.** See `.planning/STATE.md` → Blockers/Concerns.

**2. Phase 7 installed NOTHING.** `pi-subagents@0.49.0`, `@narumitw/pi-lsp@0.49.4`, `pi-web-access@0.22.0`, `pi-background-tasks@2.4.2` and `pi-session-finder@0.5.6` are reviewed, pinned in `.pi/settings.json` `packages[]`, and **NOT INSTALLED** — one approval away (`docs/EXTENSIONS.md`, `RB-07-02` OUTSTANDING). Consequence for FLOW-09 (criterion 5's handoff packets): **build the packet builder and its measurement offline; unit-verify it with no extension installed; degrade HONESTLY** — probe by *registered tool names* (`subagent`, `subagent_wait`) exactly as Phase 8's `probeLspAvailability(registeredToolNames)` does, and report a distinct `UNAVAILABLE`, **never a silent pass**. An absent subagent layer that reports "delegated" is Phase 4's headless-guard failure in a new costume. The live spawn is an appended `RB-09-xx` marked **OUTSTANDING**. **Do not plan around installing them yourself.**

**3. The work repo is GitLab and merging to `main` auto-deploys to AWS.** `/review` opens an MR targeting **staging, NEVER `main`**. Phase 4 already owns these controls — `classifyGlabInvocation` (`safety/git.ts:449`) blocks `glab mr merge` unconditionally on every branch, and `classifyGitInvocation` (`:375`) blocks writes when `HEAD == main`. **Reuse them. Do not build a second set.** See the `glab mr create` finding in `<code_context>` — it is currently blocked by the fail-closed default and this phase must extend the existing classifier, not bypass it.

### Already decided, binding

1. **THREE ARTIFACTS TOTAL — SPEC, PLAN, REVIEW — plus a PROGRESS append.** This is FLOW-10 and it is the research lesson the whole phase exists to obey. Fowler's team reviewed spec-kit and concluded *"I'd rather review code than all these markdown files"*, finding agents *"frequently ignored instructions"* DESPITE comprehensive specs; Kiro shipped a gate-free "Quick Spec" escape hatch; GSD's own `quick.md` is **1,169 lines (~15k tokens)** — a no-ceremony path costing 15k tokens to load is self-refuting. **Artifact volume does not buy adherence.** Every artifact section must have a **named downstream consumer**, and a section with none does not ship. GSD's `DISCUSSION-LOG.md` ("for human reference only and NOT consumed by downstream agents") is the named anti-pattern.

2. **The artifact schemas are already prescriptive — implement them, do not redesign them.** `.planning/research/FEATURES.md` Part 2 specifies SPEC.md §1–§8 with a per-section consumer and failure mode, PLAN.md's three parts, `/execute`'s PROGRESS append, REVIEW.md's four sections, the reviewer's six-item input contract, the MR body's six sections (including the **AI-authorship disclosure line**), and every gate. Read it; build it.

3. **Anti-features. Do NOT build:** multi-file spec bundles · a persistent canonical spec corpus · spec-as-source / regenerable code · full EARS grammar (adopt **ONLY** `IF <cond> THEN THE SYSTEM SHALL` and **only** in §4) · a human approval gate between every phase · `--auto` self-answering clarification questions (**structurally defeats a grilling workflow**) · mode-flag matrices · artifacts no downstream consumer reads · chained auto-advance. `/grill` has **two entry points and no flags**: `/grill <description>` and `/grill --resume`.

4. **Boundary rule (BOOT-10, `CONTRIBUTING.md`).** A capability defaults to **COMMAND (0 tokens — commands are not in the system prompt)** or **SKILL (~40–60 tok index, body on read)**; registering a **TOOL** requires answering (a) must the *model* call it mid-turn, (b) what is the *measured* schema token cost, (c) why can a skill not carry it — in writing, plus extending `TOOL_REGISTRATION_ALLOWLIST` in `tests/unit/contributing-boundary.test.ts` and adding a `TOOL_COUNT_BASELINE` row in `tests/unit/tool-count-baseline.test.ts`, **in the same change**. The allowlist is currently **exactly five entries** (`safety/index.ts`, `qoder/index.ts`, `todo.ts`, `questionnaire.ts`, `quality/index.ts`) = the **5-tool live baseline**. **Phase 10 is going to CUT this number. This phase must add ZERO.** The established pattern is **thin command (control flow; `waitForIdle`/`fork`/`newSession` are command-only) + thick skill (the procedure)**, and Phase 8's `submit_review` shows the escape hatch for anything genuinely model-facing: a tool **definition passed per-call to `callModel({tools:[...]})`**, never `pi.registerTool`'d, so it costs nothing in the parent's per-turn schema.

5. **Every model call goes through Phase 2's `callModel()` chokepoint.** `tests/unit/chokepoint-lint.test.ts` makes a `modelRegistry.complete` call outside `diagnostics/` a **build failure**, and the exempt prefix is the *directory* `.pi/extensions/diagnostics/`. Seven forbidden patterns are matched against **raw source including comments** — a new workflow file may not even *mention* `modelRegistry.complete`, `.completeSimple`, `.stream`, `.getProvider`, `getRegisteredNativeProvider`, `from "@earendil-works/pi-ai/api/…"` or `ModelRuntime` in a comment. Route roles through `runSingleShotRole` (`routing/modes.ts`). **Do not weaken or exempt this lint.**

6. **Be suspicious of green.** Every test written here must be shown to FAIL if its subject is removed, and no test may write outside the repo or a temp dir. Phase 7's review found a test **labelled "MUTATION-VERIFIED" that survived its own mutation**; Phase 5's suite wrote into the developer's real `~/.pi/agent/settings.json`; Phase 6's evidence gate accepted a fabricated completion claim through **three consecutive rounds of green tests**.

7. **Exhortation is not a mechanism.** A gate whose deliverable is prose in a prompt has not met the requirement. Criterion 1's "REFUSES to write requirements", criterion 2's "machine-checkable expected-files list", criterion 3's task *form*, and criterion 5's "gate depth SCALES" are all **parser/predicate requirements** — code that rejects malformed input, not wording that discourages it. If the harness would accept a SPEC.md with an empty §2, the requirement is not met however good the prompt is.

8. **UI gates stay disabled.** `workflow.ui_phase`, `ui_safety_gate`, `ui_review` are `false` deliberately. Do not re-enable them or route through `gsd:ui-phase`.

9. **No new npm dependency.** `tests/unit/pinning.test.ts:253` asserts `devDependencies` is **exactly six** audited pins. `.npmrc` is hardened with `ignore-scripts=true`. Everything here is authored TypeScript over `node:*`, `typescript@5.9.3`, `typebox` and `unbash@4.0.10`.

### Claude's discretion (guided by ROADMAP criteria + `.planning/research/`)

Whether each workflow's procedure lives in `.pi/skills/<name>/SKILL.md` or `.pi/prompts/<name>.md` (both are budgeted discovery directories — see the ratchet decision below); the on-disk representation of the ambiguity scorecard and its per-dimension floors; how the rotating perspectives are enumerated; the exact `PROGRESS.md` append format; whether the expected-files drift check lives in a new module or extends `quality/`; how `/execute`'s per-task subagent dispatch degrades when the subagent layer is absent; the JSONL field names for any new record.

### Decisions taken autonomously during context generation

*(Per the Standing Operating Policy — the user is asleep; noted here rather than asked.)*

- **Phase slug is `09-ceremonial-workflows`**, following Phases 3–8's convention of dropping `&` and punctuation.

- **THE SIDEWAYS-RATCHET DECISION — MADE, NOT DEFERRED AGAIN.** The ROADMAP defers to this phase the question of *what "a workflow's code" means across subsystem boundaries*. **Decision: a workflow's code is the transitive closure of everything it can reach, over exactly TWO edge kinds, and both are enforced.**
  - **(i) Static relative imports** — already walked, transitively and to fixed point, by `importedSubsystemDirs()` (`tests/unit/workflow-budgets.test.ts:716`, added by Phase 8's CR-04 and widened by WR2-04). Directories reached this way get a `DIRECTORY_BUDGETS` ratchet. **This half is done; do not rebuild it.**
  - **(ii) NON-IMPORT RESOURCE EDGES — the general case Phase 6 and Phase 8 both left open, and this phase's job.** After (i), the only remaining way one `.pi/` file reaches another is a **path named as a string**: a skill body, a prompt template, an agent file (`.pi/agents/*.md`), a JSON table, or a script handed to `pi.exec`. `importedSubsystemDirs` matches `/\bfrom\s+["'](\.\.?\/[^"']+)["']/` and sees **none** of them. Close it with a declared `RESOURCE_EDGES` registry (workflow → the `.pi/` paths it loads by name) **plus a completeness scanner that fails on any `.pi/…`-shaped path literal appearing in a discovered workflow source, skill body or prompt body that is not declared**. Declared edges feed the same directory ratchet as (i). This is the general case: after (ii), every edge is either a static import (walked) or a path literal (scanned), and a file reached by neither cannot be reached at all.
  - **(iii) A NEW PER-WORKFLOW TEXT BUDGET**, because the directory ratchet answers "did lines move?" and never answers "how much does invoking this workflow cost?". `WORKFLOW_TEXT_BUDGETS` = raw lines of a workflow's **own command source + every skill/prompt body it declares**, summed per workflow. This is the number `.planning/research/FEATURES.md` Part 2 actually specifies, and summing command + body is what stops the thin-command/thick-skill split from being an evasion. **Numbers, from FEATURES.md verbatim: `/grill` ≤ 250 · `/plan` ≤ 200 · `/execute` ≤ 250 · `/review` ≤ 250 · `/quick` ≤ 100 (unchanged).** `DIRECTORY_BUDGETS`' existing entries and the `Math.ceil(actual/10)*10` rounding assertion are **unchanged in mechanism** — a raise remains a visible edit with a `why`, in the same commit as the growth.
  - Rationale for keeping the two budgets separate rather than merging them: a merged per-workflow closure budget would charge `/quick` with `quality/` (3,748) + `safety/` (4,455) + `diagnostics/` (3,967) + `.pi/lib` (687) ≈ 13k lines and be instantly meaningless. **The text budget bounds what the model reads; the directory ratchet bounds where lines hide. Different consumers, different numbers, both enforced.**

- **`/plan` COLLIDES with a shipped command and the vendored copy yields.** `.pi/extensions/plan-mode/index.ts:273` registers `plan` (and `:278` `plan-todos`) — Phase 7's vendored copy of Pi's bundled `examples/extensions/plan-mode/`. Phase 7 already renamed that package's `todos` → `plan-todos` to avoid colliding with `todo.ts:343`, and recorded it as a numbered DEVIATION in the vendoring header. **Follow that exact precedent: rename `plan` → `plan-mode` in the vendored copy, record it as the next numbered DEVIATION with the reason, and give `/plan` to the ceremonial workflow.** The research names `/plan` explicitly and it is the name the user will type; a vendored example is the thing that moves.

- **`.pi/work/<slug>/` is the artifact directory and it is GITIGNORED.** The research puts SPEC/PLAN/REVIEW at `.pi/work/<slug>/`. This is a **public repo** and the artifacts describe features of the user's **work** codebase — committing them would leak exactly what PROJECT.md's secrets constraint forbids, and they are per-feature scratch, not harness source. Add `.pi/work/` to `.gitignore` **and** a representative path to `MUST_BE_IGNORED` in `tests/unit/gitignore-policy.test.ts` in the same change (the array is asserted `>= 20` entries and every entry is checked with `git check-ignore --no-index`, per Phase 1's finding that the index masks ignore rules for tracked paths).

- **The intermittently-red `tests/unit/checkpoint-store.test.ts` WR-09 case is folded into this phase** — see `<specifics>`. It is Phase 7 code, but *a suite that is only usually green makes every claim in this project unfalsifiable*, and this is the phase whose artifacts are all evidence claims.

</decisions>

<code_context>
## Existing Code Insights

Phases 1–8 built everything this phase composes. **2,024 tests green, `tsc --noEmit` clean.** Read the real signatures before planning against them; **cite `file:line`; mark anything unverifiable as UNVERIFIED rather than asserting it.**

**Commands that exist today** (`grep -rn 'registerCommand(' .pi/extensions/`): `checkpoint-restore` (`checkpoint/index.ts:130`), `budget` (`diagnostics/budget.ts:632`), `ky-hello` (`harness/index.ts:70`), `loop-police` (`loop-police/loop-police.ts:781`), **`plan` and `plan-todos`** (`plan-mode/index.ts:273,278` — see the collision decision), the routing modes + `escalate` + `mode` (`routing/index.ts:634,646,661`), `todos` (`todo.ts:343`), **`quick`** (`workflows/index.ts:19`). `.pi/skills/`, `.pi/prompts/` and `.pi/themes/` are still **`.gitkeep` only** — this phase writes the first real skill or prompt in the repo.

**Tools registered today — the 5-tool baseline** (`grep -rn 'registerTool(' .pi/extensions/`): `approve_ky_command` (`safety/index.ts:489`; `:391,:400,:409,:418` are *wrappers* re-registering existing tools, not new ones), the qoder delegate tool (`qoder/index.ts:112`), `consult_advisor` (`quality/index.ts:416`), the questionnaire tool (`questionnaire.ts:147`), `todo` (`todo.ts:195`). **`submit_review` is NOT among them** — `review-schema.ts:77` defines it as a tool the reviewer's *nested* `callModel` receives, which is the zero-parent-cost pattern this phase must copy.

**Phase 4 — the MR controls, and the one gap `/review` must close.**
- `safety/git.ts:449 classifyGlabInvocation(invocation)`. `GLAB_BLOCKED_SUBCOMMANDS` (`:429`) blocks `glab mr merge` **unconditionally on every branch** — "the danger is the merge target on GitLab's server, not the branch checked out on this laptop". `GLAB_READ_SUBCOMMANDS` (`:438`) allows exactly `mr list`, `mr view`, `ci status`. **Everything else returns `{kind:"block", reason:"… unclassified glab form -- defaults to block (fail closed …)"}` (`:462`).**
- **Therefore `glab mr create` is BLOCKED TODAY.** Criterion 4 cannot ship without extending this classifier. **Extend it, do not bypass it** (Correction 3): add an `mr create` rule that allows **only** when an explicit target branch is present and is not in `PROTECTED_BRANCHES` (`safety/index.ts:140` = `["main","master"]`), and blocks when the target is absent — GitLab defaults an omitted target to the **project default branch**, which is `main`, so silence here is the deploy trigger. `glab mr merge` stays unconditionally blocked. Add the new forms to `tests/fixtures/evasion-corpus.ts` and to the published limits table in `docs/SAFETY.md`, which `docs-policy.test.ts` derives from the corpus in both directions.
- `currentBranch(cwd)` (`git.ts:144`) returns the distinct `DETACHED_HEAD` sentinel (`:134`) on any non-zero `git symbolic-ref`, never `undefined`; `currentSha` (`:173`) and `currentTree` (`:206`) both throw on non-zero exit (fail closed, no sentinel).

**Phase 6 — `/quick`, the evidence gate, and the budget registry.**
- `.pi/extensions/workflows/index.ts` is **96 raw lines** against a 100 ceiling asserted twice (the `WORKFLOW_BUDGETS` entry *and* an explicit greppable `toBeLessThanOrEqual(100)` at `workflow-budgets.test.ts:642`). It already calls `runQuickGateStage` after the git pre-flight and before `startRun`. **There is almost no headroom — `/quick` must not grow.**
- `evidence.ts` (381 lines) — `gateCompletion(records, headSha, baseSha)` is a **first-match-wins six-branch predicate with binding order** (empty → reject; `headSha === baseSha` → reject; `headTree === baseTree` → reject, Phase 8's 08-12 close of the empty-commit hole; any `isError` anywhere → reject, deliberately *before* the SHA narrowing; no record at `headSha` → reject as stale; else accept). It reads **only** Pi's structural `isError` and a SHA the harness read itself — never `message.content`. **`/execute`'s "commits atomically" + "pasted real output" is this gate's second consumer; reuse it.**
- `tests/unit/workflow-budgets.test.ts` (1,051 lines) is FLOW-11 and is **the mechanism that exists to protect this phase from itself** — its own module docstring says so, and it names `/grill`, `/plan`, `/execute` and `/review` by name three times. Read the whole file before touching it. Key machinery: `countRawLines` (`:462`, raw `split("\n").length`, decision D-1 — no stripping of any kind), `walkOnDisk` (`:478`), `isCommandSource` (`:508`, non-throwing by construction — WR-04), `filesInDir` (`:532`, recursive, tracked ∪ on-disk), `discoverWorkflowFiles` (`:553`, union of `workflows/` `.ts|.js` + `.pi/prompts/**.md` + `.pi/skills/**.md` + **any** `.pi/extensions/**` file spelling `registerCommand(`), `resolveLocalImport` (`:667`), `importedSubsystemDirs` (`:716`, fixed-point transitive walk with a `visitedFiles` cycle guard), and `commandDirs` (`:775`, subsystem root via `p.split("/").slice(0,3)`, unioned with the import walk). Both registries carry a `budget === Math.ceil(actual/10)*10` assertion (`:615`, `:812`) — **`toBe`, not `toBeLessThan`: a file that SHRINKS also requires the edit**, because headroom accumulated by shrinking is silent slack.
- **Live directory totals to plan against** (measured 2026-08-15, in the registry's own `why` strings): `workflows` 477/480 · `quality` 3,748/3,750 · `safety` 4,455/4,460 · `diagnostics` 3,967/3,970 · `routing` 2,356/2,360 · `providers` 1,430/1,430 · `plan-mode` 1,222/1,230 · `checkpoint` 1,064/1,070 · `loop-police` 1,326/1,330 · `.pi/lib` 687/690 · `harness` 99/100. **Every one is within ten lines of its ratchet.** Any edit to any of these files requires the registry number and its `why` to move in the same commit.

**Phase 7 — the agent-file template and the uninstalled packages.**
- `.pi/agents/planner.md` and `.pi/agents/reviewer.md` are the templates for any handoff agent file: frontmatter `name / description / tools / thinking / systemPromptMode: replace / inheritProjectContext: false / inheritSkills: false`, and a trailing HTML comment explaining the **deliberate absence of a `model:` key** — a `model:` key permanently and silently pins the agent, defeating Phase 5 (`pi-subagents@0.49.0 src/agents/agents.ts:1155` fills a model only when the agent's own frontmatter has none). `fallbackModels:` is withheld for the same reason. **Copy the discipline and the comment verbatim in spirit.** `inheritProjectContext: false` + `inheritSkills: false` + `systemPromptMode: replace` is also *how* a handoff packet costs negative tokens: the child starts from nothing but the packet.
- `docs/EXTENSIONS.md` carries the provenance record, per-package model-facing tool counts, and the honest `UNVERIFIED` install-reconciliation verdict. `tool-count-baseline.test.ts:128` records that `pi-subagents` would register **four** parent-visible tools (`subagent`, `subagent_wait`, `subagent_supervisor`, `intercom`) — those are the names an availability probe looks for.

**Phase 8 — `.pi/extensions/quality/` (8 files, 3,748 lines), the four mechanisms QUAL-08 dials.**
- `gates.ts:123 GATE_LEGS = ["typecheck","lint","lsp","anti-pattern"]`; `gates.ts:336 runDeterministicGates(...)`; `gates.ts:163 probeLspAvailability(registeredToolNames): LegStatus` — **the honest-degradation precedent to copy for the subagent probe**; `gates.ts:417 shouldRunDesignReview(signals)` and `DESIGN_REVIEW_FILE_SPAN = 8` (`:388`) — an existing, pure, machine-checkable depth selector, which is the shape QUAL-08's dial should take.
- `index.ts:390 runQuickGateStage(cwd, projectTrusted): GateResult` — the deterministic-only entry point `/quick` already calls. `index.ts:163 registeredToolNames()`. `index.ts:261 productionExec`, `:343 setQuickGateExecOverrideForTests`.
- `reviewer.ts:228 buildReviewerContext(input: ReviewerContractInput)` and `:296 buildImportGraph(...)` — GATE-02's fixed six-part contract (diff + **full contents of every touched file** + test/typecheck output **passed from the deterministic stage, not re-run** + SPEC requirements + files-touched union + import graph). `:329 REVIEWER_SYSTEM_PROMPT`, `:373 runReview(ctx, input)`.
- `review-schema.ts:319 validateReview(raw, expectedRequirementIds): ReviewValidation` and `:526 renderReviewMarkdown(review)` — **REVIEW.md's renderer already exists.** `NIT_CAP = 5` (`:200`). Unclassified findings are **rejected as malformed by code**.
- `calibration.ts:220 scoreCalibration(...)`, `advisor.ts:169 executeConsultAdvisor(...)`, `rules.ts:95 RULE_IDS` (the six QUAL-01 rule classes) with `SUPPRESSION_MARKER = "quality-allow:"` (`:140`).
- `docs/QUALITY.md` is the published contract; its rule table and calibration section are asserted against `RULE_IDS`/`DEFECT_CLASSES` **in both directions**.

**Diagnostics / cost.** `diagnostics/quality-cost.ts` (241 lines) holds the process-wide quality-layer ledger — `takeQualityCost()` drains it, and Phase 8's WR-06 fix replaced a blanket drain with `refundQualityCost({ms})` because draining the whole ledger silently erased other contributors' already-recorded cost mid-turn. **FLOW-09's "negative tokens in the parent" is a MEASURABLE claim** — measure the packet against the parent context it replaces using `diagnostics/budget.ts`'s existing chars/4 estimator (`computeBudget` is pure), record it, and **do not assert it**. Criterion 5 says delegation *costs* negative tokens; a number that comes out positive is a result, not a failure to hide.

**Enforcement machinery this phase must extend rather than sidestep:**
| File | What it enforces |
|---|---|
| `tests/unit/workflow-budgets.test.ts` | FLOW-11 — per-file + per-directory line budgets, completeness both ways, `budget === ceil(actual/10)*10` |
| `tests/unit/chokepoint-lint.test.ts` | `modelRegistry.complete` outside `diagnostics/` = build failure (raw source, comments included) |
| `tests/unit/contributing-boundary.test.ts` | `TOOL_REGISTRATION_ALLOWLIST` — **5 entries; add none** |
| `tests/unit/tool-count-baseline.test.ts` | every tool-registering entry point needs a `TOOL_COUNT_BASELINE` row |
| `tests/unit/docs-policy.test.ts` | `RB-xx-yy` status consistency across two places; `PHASE_*_IDS` + `ALL_IDS` + `ENTRY_COMMANDS`; doc↔code table derivations |
| `tests/unit/gitignore-policy.test.ts` | `MUST_BE_IGNORED` / `MUST_BE_COMMITTABLE`, via `git check-ignore --no-index` |
| `tests/unit/pinning.test.ts:253` | `devDependencies` is **exactly six** pins |
| `tests/unit/extension-layout.test.ts` | entry point = a file with a default export at statement position, at an auto-discovered path |
| `tests/unit/lf-and-shell.test.ts` | POSIX `sh` only, LF, `dash -n` parse of every tracked `*.sh` |
| `.github/workflows/ci.yml` | vitest + `tsc --noEmit` on `windows-latest` and `macos-latest` — **a failing vitest test is already a failing build**; do not invent a second CI mechanism |

**Test helpers already available — reuse, do not rewrite:** `tests/helpers/{faux,session,models,pi,logs,git,stub-bin,win-quote,loopback,qoder-loopback,bootstrap-repo}.ts`. Load-bearing here: **`git.ts`** (temp repo — the only honest way to exercise a diff, an expected-files drift check or an atomic commit), **`faux.ts`** (response steps may be a **factory receiving `(context, options, state, model)`**, so a test can assert on the **outgoing** request), **`session.ts`**, **`stub-bin.ts`** (a stubbed `glab` on PATH is how the MR step is proved offline — note it is **synchronous by contract** and deletes its directory the moment the callback returns), **`logs.ts`**.

**Test layout:** `tests/unit/` and `tests/integration/`, `vitest.config.ts` sets `environment: "node"`, `testTimeout`/`hookTimeout` `120_000`, `passWithNoTests: false`, `globalSetup: ["./tests/global-teardown.ts"]` (dirty-tracked-file tripwire) and `setupFiles: ["./tests/setup/agent-dir.ts"]` (**blocks any test resolving `getAgentDir()` to the real `~/.pi/agent`**). No `pool`/`poolOptions`/`fileParallelism` is set, so vitest defaults to `pool: "forks"` with `maxForks = availableParallelism() - 1`.

**Pi 0.84.1 is at `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\`** and ships 80 `examples/extensions/`. Original TypeScript for anything in `dist/` is recoverable from `dist/**/*.js.map` `sourcesContent`. **Follow Pi's own documentation and bundled examples over blog posts or extension READMEs.**

</code_context>

<specifics>
## Specific Ideas

### The line budget, restated as the thing that must not fail

This phase **is** the cathedral the budget exists to constrain. `workflow-budgets.test.ts`'s own docstring says it is *"the only thing standing between Phase 9 and that outcome"*. Two failure shapes to refuse explicitly:

1. **Growth with a raise attached.** A raise is legitimate *only* when the lines are load-bearing and the `why` says what grew and why the budget must not pressure it out. Phase 7's `plan-mode` raise (640 → 970 for an AST allowlist table in the tool-execution path) is the model of a good one.
2. **Offloading.** Moving procedure text out of a budgeted body into an unbudgeted place. Phase 8 found the live instance — **3,406 lines of `/quick` gate logic in `.pi/extensions/quality/`**, invisible because that directory spells `registerCommand(` nowhere. The static-import half is now closed; the resource-edge half is this phase's decision above. **A skill body loaded by path is exactly the shape that would slip through today.**

### FLOW-09 — handoff packets, and what "negative tokens" must mean

BMAD's insight is the self-contained unit executed in a **fresh context**. The packet is: the SPEC excerpt for the task's requirement IDs, the relevant §2 verified facts, the task's file paths, and its verification command. **Not the whole SPEC, not the conversation.** The mechanism that makes it *negative* in the parent is `inheritProjectContext: false` + `inheritSkills: false` + `systemPromptMode: replace` on the agent file plus the parent never reading the child's working context back — only its result. Build the packet builder pure and test it pure; probe availability by registered tool name; report `UNAVAILABLE` distinctly; put the live spawn in `RB-09-xx`.

### The intermittently-red WR-09 case — DIAGNOSE and ROOT-CAUSE FIX

`tests/unit/checkpoint-store.test.ts` §`WR-09 -- concurrent recorders do not lose each other's entries` (`:197-274`) fails roughly **1 run in 30 of the full suite**, is green **16/16 in isolation**, and has been independently hit by three separate agents under load. It is Phase 7 code.

**Leading hypothesis, to be CONFIRMED by the plan before it is fixed** (offered with evidence so the plan investigates the right thing first, not so it skips investigating):

- The overlap barrier is a **wall-clock margin**: `const startAt = Date.now() + 800` (`:250`), passed to each child, which does `const wait = startAt - Date.now(); if (wait > 0) await sleep(wait)` (`:230-231`).
- Each child pays Node process boot **plus a dynamic `import()` of `.pi/extensions/checkpoint/store.ts` through a `file://` URL** (`:219,:226`) — TypeScript, so native type-stripping compile cost — **before** it reads the clock. In isolation that is far under 800 ms and the barrier holds. In-suite, with `pool: "forks"` at `availableParallelism() - 1` and neighbouring integration files each fanning out four more OS processes, a child can boot **after** `startAt`, in which case `wait <= 0` and it starts immediately, potentially after a sibling that started on time has already finished its 150 fast read-modify-write cycles.
- The assertion that then fails is `expect(latestStart).toBeLessThan(earliestFinish)` (`:258-263`) — the *overlap* proof, not the 600-row lost-update assertion. That matches the symptom exactly: **load-dependent, in-suite only, and about timing rather than correctness.**

**The fix must make the barrier an EVENT, not a duration** — the same 08-05 pattern the `qoder-delegate` de-flake was held to. Sketch: each child prints a `ready` line **after** its `import()` resolves, then blocks on stdin; the parent waits for all four `ready` lines and only then releases them; the wall-clock `startAt` and its 800 ms margin are **deleted**. Consider strengthening the overlap proof from a timestamp comparison to a structural one (a child does not finish until it has observed at least one row written by another tag), so the property is proved rather than inferred. The child is spawned with `timeout: 120_000` (`:169`), a real timeout and not a margin, which bounds a released-gate deadlock honestly.

**Explicitly NOT acceptable, each a QUAL-04 "symptomatic" or "workaround" by this project's own definition, and each grep-checkable exactly as for the Phase 8 `qoder-delegate` fix:** `retry` · a wider bound · raising `testTimeout` (already 120 s — the flake is not a timeout) · `it.skip` · `fileParallelism: false` (hides the same race behind a global slowdown).

### The traps this phase most plausibly falls into

- **Writing four beautiful prompt files and calling it a workflow.** Criteria 1–3 and 5 are parser requirements. `/grill` must *structurally* refuse to emit §3 while §2 is empty or evidence-free; the expected-files list must be *diffed*, by code, against the real diff; the task form must be *validated*; the depth dial must be a *pure selector* asserted in both directions.
- **A fifth artifact.** FLOW-10 caps it at three plus a PROGRESS append. Anything else needs a named downstream consumer that actually reads it, or it does not ship.
- **Growing `/quick`.** It is at 96 of 100, and criterion 5 requires it to stay deterministic-only. QUAL-08's dial belongs in the shared selector, not in `workflows/index.ts`.
- **Registering a tool because it is convenient.** Five is the baseline, Phase 10 is going to cut it, and Phase 8 already demonstrated the zero-cost alternative (`submit_review`).
- **Bypassing the safety layer to get the MR open.** Extend `classifyGlabInvocation`. A `/review` that shells out around the guard is a second set of controls, which Correction 3 forbids.
- **Executing a `[RUNBOOK]` item because the credentials happen to work.** Correction 1. They work; that is the problem, not the permission.
- **Claiming criterion 4 is met.** Its second clause needs the work laptop. It is `RB-09-xx`, OUTSTANDING, and FLOW-08 is `[~]`.
- **Re-litigating the artifact schemas.** FEATURES.md Part 2 already specifies them section by section, with the consumer and the failure mode each one kills.

</specifics>

<deferred>
## Deferred Ideas

- Measuring and **cutting** per-turn token cost, `pi.setActiveTools()` profiles, named tool profiles, dynamic tool loading, the `AGENTS.md` token budget, and the minimal-vs-full-harness controlled experiment (CTX-05, `[RUNBOOK]`) — **Phase 10**. This phase must not inflate the 5-tool baseline; it does not get to cut it either.
- Statusline, the subagent-activity widget, the authored theme and the startup header — **Phase 11**. `.pi/themes/` stays `.gitkeep` here.
- **Any live-credential or live-service execution**: the end-to-end feature shipped through `/grill → /plan → /execute → /review` on the work laptop, the real `glab mr create` against the work GitLab, and any real `pi-subagents` handoff spawn. Each becomes an `RB-09-xx` entry marked **OUTSTANDING** — built here, proved offline here, **never claimed as passed here**.
- Installing the five pinned specs — `RB-07-02`, already OUTSTANDING, **not this phase's job**.
- Resolving the unpushed-history identifier risk — `RB-07-03`, needs the user.
- `BOOT-07`'s live CI run — still has no runbook entry; a later phase should add it alongside `RB-01-01..03`.
- R1 (whether DeepSeek-direct's `reasoning_effort: "low"` yields materially fewer reasoning tokens) — `RB-03-04`, OUTSTANDING. `/cheap` must not be defined in terms of a cheap thinking tier.

</deferred>
</content>
</invoke>
