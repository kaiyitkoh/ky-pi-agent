# Phase 9: Ceremonial Workflows - Research

**Researched:** 2026-08-15
**Domain:** Codebase verification (Phase 4/5/6/7/8 export surface) + two settlement items (sideways-ratchet design, WR-09 root cause). Per the ROADMAP, no external/comparative research was performed — `.planning/research/FEATURES.md` Part 2 is the prescriptive artifact spec and is implemented from, not re-derived.
**Confidence:** HIGH (every claim below is either `[VERIFIED: file:line]`, `[VERIFIED: command output]`, or explicitly `[ASSUMED]`/`[UNVERIFIED]` where it could not be checked)

## Summary

Every Phase 4/5/6/7/8 export CONTEXT.md's `<code_context>` names was checked against the real source and matches, with two corrections: (1) `GLAB_BLOCKED_SUBCOMMANDS` and `GLAB_READ_SUBCOMMANDS` in `safety/git.ts` are **not exported** (module-private consts) — a planner reaching for them directly from outside `git.ts` will find nothing; the extension point for `glab mr create` is `classifyGlabInvocation` itself, which is exported. (2) `.pi/extensions/workflows/index.ts` is measured at **99 raw lines today, not 96** — the registry's own `why` narrative is three lines stale (an uncommitted-to-the-registry edit from the most recent WR2-06 commit), though the declared budget (100) still happens to be correct because 99 rounds up to 100. This means `/quick` has **one line of headroom**, not four, before its budget must move to 110 in the same commit as any edit.

Both `<must_settle>` items are resolved with hard evidence, not restated hypotheses. **Item 1** (the sideways-ratchet hole): every one of the nine `WORKFLOW_BUDGETS` files and eleven `DIRECTORY_BUDGETS` directories is measured **exactly at** its ratchet ceiling today (rounds to the declared budget with zero slack) — confirmed by running the actual test suite (64/64 green) and independently re-measuring every entry with the test's own `countRawLines`/`filesInDir` functions. CONTEXT.md's claimed hole is real but **narrower than stated**: `.pi/skills/**.md` and `.pi/prompts/**.md` bodies are *already* fully closed by `discoverWorkflowFiles()`'s existing glob plus the registry-completeness test (`tests/unit/workflow-budgets.test.ts:1031`) — every discovered `.md` skill/prompt file already *requires* a `WORKFLOW_BUDGETS` entry today. The genuinely open holes are: `.pi/agents/*.md` (not scanned by any glob at all), non-`.md` assets nested inside a skill/prompt directory (walked but filtered out by the `.endsWith(".md")` check), and any file referenced only by a string path handed to `pi.exec` — none of these currently has a directory-level ratchet either, since `commandDirs` only admits `.ts`/`.js` sources.

**Item 2** (WR-09 flake): CONFIRMED by direct measurement, not just plausible. The writer child's boot cost (Node process start + dynamic `import()` of `store.ts` through native TS type-stripping) measures **590–614ms in complete isolation** — already 74–77% of the 800ms overlap barrier — and **807–970ms under modest simulated load** (8–16 concurrent busy processes), i.e. it exceeds the entire budget outright. The overlap assertion (`latestStart < earliestFinish`) currently survives only because the four children's boot-time *variance* stays smaller than their shared write-loop duration (145–255ms); under real in-suite scheduling noise (16 other test files spawn real OS processes) that variance is not bounded. The 600-row assertion has a second, structurally distinct failure path — `store.ts`'s `withLock` silently degrades to running **unlocked** after 2000ms of contention (`store.ts:210-243`) — but this session's measurements (sub-2ms per-call lock hold time) did not come close to triggering it, so it is reported as a real but unconfirmed secondary risk, not the primary cause.

**Primary recommendation:** Implement `/grill`, `/plan`, `/execute`, `/review` as Pi **commands** (never prompt templates — Pi's prompt templates are pure markdown expansion with no code path, so none of criteria 1–3's structural gates are implementable in one), each backed by a **skill** for the verbose procedural content the command's own code does not need to parse. Extend `classifyGlabInvocation` (not a new classifier) for `glab mr create`. Fix WR-09 with an IPC ready/release handshake (`spawn(..., {stdio:[...,"ipc"]})`), deleting the wall-clock margin outright, on the exact 08-05 precedent.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLOW-02 | `/grill` interrogates with ambiguity scorecard, per-dimension floors, hard question budget, one question at a time, rotating perspectives | Command-vs-skill placement resolved below; no new routing role needed — ROLES is fixed by decision, interrogation runs in the ordinary prompt loop like `/quick` does (`workflows/index.ts:60`), not a nested `call-model` role |
| FLOW-03 | SPEC.md's Verified Codebase Facts table gate | FEATURES.md §156-179 is prescriptive; `docs-policy.test.ts`'s pattern for a mandatory-non-empty section is the model to copy |
| FLOW-04 | `IF <condition> THEN THE SYSTEM SHALL` error behaviour | No existing code precedent; pure spec-template text, verified as in-scope-only (§4, per CONTEXT.md decision 3) |
| FLOW-05 | expected-files scope pin, machine-checkable at review | CONFIRMED entirely new build — no `expectedFiles`/diff-vs-scope mechanism exists anywhere in the codebase today (grep-verified) |
| FLOW-06 | `/plan` task form + coverage matrix | Precedent: `review-schema.ts`'s `validateReview`/`StringEnum` pattern for structured, code-validated output |
| FLOW-07 | `/execute` pastes real output, atomic commit | Direct reuse of `workflows/evidence.ts`'s `gateCompletion`/`startRun`/`endRun` (Phase 6) — same SHA/tree-based gate `/quick` uses |
| FLOW-08 | `/review` → REVIEW.md → MR to staging | `renderReviewMarkdown` exists but is missing a Scope Drift section (extend, don't rebuild); MR step must extend `classifyGlabInvocation` for `mr create` — Item 1(a)/(e) below |
| FLOW-09 | self-contained handoff packets, negative parent tokens | `pi-subagents` NOT installed — probe via `registeredToolNames()` for `subagent`/`subagent_wait`/`subagent_supervisor`/`intercom` (`tool-count-baseline.test.ts:132`, CONFIRMED); degrade honestly per Phase 8's `probeLspAvailability` precedent; measure with `diagnostics/budget.ts#computeBudget`/`estimateTokensFromChars` |
| FLOW-10 | three artifacts total, no unread document | FEATURES.md's per-section consumer table is the enforcement mechanism to copy |
| QUAL-03 | Root Cause section for fix-framed changes | Template text in SPEC §4-adjacent section; no code precedent, gated the same way as §2 |
| QUAL-08 | gate depth scales with workflow | `quality/gates.ts#shouldRunDesignReview`/`DESIGN_REVIEW_FILE_SPAN` is the existing pure-selector shape to extend, not `workflows/index.ts` |
</phase_requirements>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **THREE ARTIFACTS TOTAL — SPEC, PLAN, REVIEW — plus a PROGRESS append.** Every artifact section must have a named downstream consumer; a section with none does not ship.
2. **The artifact schemas are already prescriptive** — `.planning/research/FEATURES.md` Part 2 specifies SPEC.md §1–§8, PLAN.md's three parts, PROGRESS append, REVIEW.md's four sections, the reviewer's six-item input contract, the MR body's six sections. Implement it, do not redesign it.
3. **Anti-features. Do NOT build:** multi-file spec bundles · persistent canonical spec corpus · spec-as-source/regenerable code · full EARS grammar (only `IF <cond> THEN THE SYSTEM SHALL`, only in §4) · human approval gate between every phase · `--auto` self-answering · mode-flag matrices · artifacts no consumer reads · chained auto-advance. `/grill` has exactly two entry points: `/grill <description>` and `/grill --resume`, no flags.
4. **Boundary rule (BOOT-10).** Command (0 tokens) or skill (~40-60 tok index) by default; a tool requires answering (a) must the model call it mid-turn, (b) measured schema cost, (c) why not a skill — plus extending `TOOL_REGISTRATION_ALLOWLIST` and `TOOL_COUNT_BASELINE` in the same change. Allowlist is currently exactly 5 entries. **Phase 9 must add ZERO tools.** Thin command + thick skill; `submit_review`'s per-call `tools:[...]` pattern (never `pi.registerTool`) is the escape hatch for anything genuinely model-facing.
5. **Every model call goes through `callModel()`.** `chokepoint-lint.test.ts` fails the build on `modelRegistry.complete`/`.completeSimple`/`.stream`/`.getProvider`/`getRegisteredNativeProvider`/pi-ai api imports/`ModelRuntime`, matched against raw source including comments, outside `.pi/extensions/diagnostics/`. Route roles through `runSingleShotRole`.
6. **Be suspicious of green.** Every test must be shown to fail if its subject is removed. No test writes outside the repo or a temp dir.
7. **Exhortation is not a mechanism.** Criteria 1–3 and 5 are parser/predicate requirements, not prompt wording.
8. **UI gates stay disabled** (`ui_phase`, `ui_safety_gate`, `ui_review` all `false`). Do not re-enable.
9. **No new npm dependency.** `pinning.test.ts:253` asserts exactly six devDependencies. `.npmrc` has `ignore-scripts=true`.

**THREE CORRECTIONS TO PROJECT-WIDE ASSUMPTIONS:**
1. The dev machine DOES hold live static IAM admin credentials in plaintext at `~/.aws/credentials`. Do NOT execute `[RUNBOOK]` items; do NOT issue provider inference requests.
2. Phase 7 installed NOTHING. `pi-subagents`, `@narumitw/pi-lsp`, `pi-web-access`, `pi-background-tasks`, `pi-session-finder` are pinned, not installed. Do not plan around installing them.
3. The work repo is GitLab; merging to `main` auto-deploys to AWS. `/review` opens an MR targeting **staging, never main**. Reuse Phase 4's `classifyGlabInvocation`/`classifyGitInvocation`, extend, never bypass.

**THE SIDEWAYS-RATCHET DECISION (already made, this phase implements it):** a workflow's code is the transitive closure over exactly two edge kinds: (i) static relative imports (already walked by `importedSubsystemDirs` — done, do not rebuild) and (ii) non-import resource edges — a declared `RESOURCE_EDGES` registry (workflow → `.pi/` paths loaded by name) plus a completeness scanner that fails on any undeclared `.pi/…`-shaped path literal in a discovered workflow source/skill/prompt body. Plus (iii) a new `WORKFLOW_TEXT_BUDGETS` registry = own command source + every declared skill/prompt body, summed per workflow: `/grill` ≤250 · `/plan` ≤200 · `/execute` ≤250 · `/review` ≤250 · `/quick` ≤100 (unchanged). Kept separate from `DIRECTORY_BUDGETS` deliberately — a merged closure budget would charge `/quick` with quality+safety+diagnostics ≈13k lines and be meaningless.

**`/plan` COLLIDES with `.pi/extensions/plan-mode/index.ts:273`.** Rename the vendored copy `plan` → `plan-mode`, following Phase 7's `/todos` → `/plan-todos` precedent, record it as the next numbered DEVIATION (6), give `/plan` to the ceremonial workflow.

**`.pi/work/<slug>/` is the artifact directory and MUST be gitignored.** Add to `.gitignore` and a representative path to `MUST_BE_IGNORED` in `gitignore-policy.test.ts`, same commit.

**The intermittently-red `checkpoint-store.test.ts` WR-09 case is folded into this phase** (Phase 7 code, hit during Phase 8).

### Claude's Discretion

Whether each workflow's procedure lives in `.pi/skills/<name>/SKILL.md` or `.pi/prompts/<name>.md`; the on-disk representation of the ambiguity scorecard and per-dimension floors; how rotating perspectives are enumerated; the exact PROGRESS.md append format; whether the expected-files drift check lives in a new module or extends `quality/`; how `/execute`'s per-task subagent dispatch degrades when the subagent layer is absent; JSONL field names for any new record.

### Deferred Ideas (OUT OF SCOPE)

- Measuring and cutting per-turn token cost, `pi.setActiveTools()` profiles, named tool profiles, dynamic tool loading, `AGENTS.md` token budget, minimal-vs-full-harness experiment (CTX-05, `[RUNBOOK]`) — **Phase 10**. Phase 9 must not inflate the 5-tool baseline; it does not get to cut it either.
- Statusline, subagent-activity widget, authored theme, startup header — **Phase 11**. `.pi/themes/` stays `.gitkeep`.
- Any live-credential/live-service execution: the real end-to-end feature ship, the real `glab mr create`, any real `pi-subagents` spawn — each becomes `RB-09-xx`, OUTSTANDING, never claimed as passed here.
- Installing the five pinned specs — `RB-07-02`, not this phase's job.
- Resolving unpushed-history identifier risk — `RB-07-03`, needs the user.
- R1 (DeepSeek `reasoning_effort: "low"`) — `RB-03-04`, OUTSTANDING. `/cheap` must not be defined by a cheap thinking tier.
</user_constraints>

## Project Constraints (from CLAUDE.md)

- Zero spend beyond model API tokens; no SaaS; open-source/self-hosted only.
- Windows (Git Bash) now, macOS later; POSIX `sh` throughout; never PowerShell in scripts.
- Public repo; no credential may ever be committed.
- Pin exact versions; review or vendor anything in the tool-execution/credential path.
- `jiti` loads `.ts` directly — never add a build step.
- `typebox` (unscoped) for schemas, `StringEnum` from `@earendil-works/pi-ai` for string enums — never `Type.Union`/`Type.Literal` (breaks Google's API), never `@sinclair/typebox`.
- `vitest@4.1.9` matches Pi core's own pin.
- Register all tools, activate few via `pi.setActiveTools()`; omit `promptSnippet`/`promptGuidelines` on lazily-loaded tools (rebuilds system prompt, invalidates cache).
- These directives are consistent with CONTEXT.md's locked decisions above (no contradiction found).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `/grill` interrogation loop | Harness extension (command) | Skill (procedure text) | Needs `read`/`grep` for the evidence gate and a structural refuse-until-§2-exists check — a skill alone cannot validate anything, only narrate it |
| Ambiguity scorecard scoring | Harness extension (pure function) | — | Machine-checkable score/floor comparison; must not be left to the model's own judgement (Decision 7) |
| SPEC/PLAN/REVIEW artifact writes | Harness extension | `.pi/work/<slug>/` (filesystem) | Command writes the file after validating it; the model proposes content, the command enforces shape |
| Task-form / coverage-matrix validation | Harness extension (pure function) | — | Regex/structural validation, same pattern as `review-schema.ts#validateReview` |
| Evidence gate (`/execute`) | Harness extension (`workflows/evidence.ts`, reused) | — | Already built (Phase 6); FLOW-07 is composition, not a new gate |
| Expected-files scope-drift check | Harness extension (new, pure) | `git diff --name-only` (subprocess) | Entirely new — confirmed no existing mechanism (see Verified Codebase Facts) |
| Reviewer dispatch + `submit_review` | Harness extension (`quality/reviewer.ts`, reused) | Routing (`runSingleShotRole`, role `"reviewer"`) | Zero-parent-token pattern already proven; Phase 9 extends `renderReviewMarkdown`, doesn't rebuild the reviewer |
| MR open (`glab mr create`) | Harness extension → subprocess (`glab`) | `safety/git.ts#classifyGlabInvocation` (gate) | Must route through the existing safety classifier, extended, never a second control |
| Subagent handoff packet | Harness extension (pure builder) | `pi-subagents` tool surface (probed, absent today) | Build/measure offline; dispatch degrades honestly to `UNAVAILABLE` |
| Line-budget enforcement | Test suite (`workflow-budgets.test.ts`) | — | CI-enforced, not a runtime concern |

## Standard Stack

No new external packages. This phase is 100% authored TypeScript over existing Phase 2/4/5/6/8 exports plus `node:*`, `typescript@5.9.3`, `typebox`, per CLAUDE.md and `pinning.test.ts:253`'s exactly-six-devDependencies gate.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| A Pi **command** for `/grill`/`/plan`/`/execute`/`/review` | A Pi **prompt template** (`.pi/prompts/grill.md`) | RULED OUT for all four — prompt templates are pure markdown expansion with `$1`/`$@` substitution and zero code execution [VERIFIED: Pi 0.84.1 `docs/prompt-templates.md`]. None of criteria 1, 2, 3 or 5's structural gates (evidence-before-write, task-form validation, coverage matrix, depth scaling) are expressible in a template. |
| A Pi command | A bare **skill** with no command wrapper | RULED OUT as the sole mechanism — a skill is read and interpreted by the model, never validated by code (Decision 7's "exhortation is not a mechanism"); `/quick`'s own precedent and `CONTRIBUTING.md`'s boundary rule make the same argument [VERIFIED: `docs/WORKFLOWS.md:15-24`] |
| Reusing `runSingleShotRole(role:"reviewer")` for the dispatched reviewer | Adding a new routing role for `/grill`'s interrogator or `/execute`'s per-task worker | RULED OUT — `routing/schema.ts:104-109`'s own comment states `ROLES` is fixed at six names "verbatim... Do not rename or add to this list — it is the phase's own spec" [VERIFIED]. `/grill`'s interrogation runs in the ordinary prompt loop (the already-routed executor model), exactly as `/quick` hands work to `pi.sendUserMessage` rather than a nested call [VERIFIED: `workflows/index.ts:60`, `docs/WORKFLOWS.md` §2 step 7] |

## Architecture Patterns

### System Architecture Diagram

```
User types /grill "add X"
        │
        ▼
 grill/index.ts (command, thin)
        │  1. pre-flight: not on main, <slug> free, repo readable
        │     (reuses classifyGitInvocation — Phase 4)
        ▼
 read/grep the codebase (Pi built-in tools, model-driven)
        │  evidence accumulates into §2 candidate rows
        ▼
 evidence gate (pure predicate, code-enforced)
        │  BLOCKS §3 authorship until §2 non-empty AND every row has evidence
        ▼
 ambiguity scorecard (pure function: 4 dims, floors, score ≤0.20)
        │  loop: one question at a time, rotating perspective, hard budget
        ▼
 SPEC.md written to .pi/work/<slug>/SPEC.md  (§1-§8, per FEATURES.md)
        │
        ▼
User types /plan
        │
        ▼
 plan/index.ts (command, thin) — pre-flight: SPEC.md exists + gated
        │
        ▼
 task-list + coverage-matrix generation (model proposes, code validates)
        │  T### [P] [R#] verb <path> + verification command  — regex-checked
        │  coverage gate: every Rn maps to ≥1 task
        ▼
 PLAN.md written
        │
        ▼
User types /execute
        │
        ▼
 execute/index.ts (command, thin) — one subagent per task (or degraded)
        │  handoff packet: SPEC excerpt (Rn), §2 facts, path, verify cmd
        │  deterministic gate per task (quality/gates.ts, reused)
        ▼
 PROGRESS.md append: SHA, command, REAL pasted output
        │  reuses workflows/evidence.ts#gateCompletion (Phase 6, unmodified)
        ▼
User types /review
        │
        ▼
 review/index.ts (command, thin)
        │  builds ReviewerContractInput (quality/reviewer.ts, reused)
        │  + NEW: expected-files diff (git diff --name-only vs SPEC §5)
        ▼
 runReview() → runSingleShotRole(role:"reviewer", tools:[submit_review])
        │  zero-parent-token: tool def is per-call, never pi.registerTool'd
        ▼
 REVIEW.md rendered (renderReviewMarkdown, EXTENDED with Scope Drift §)
        │
        ▼
 classifyGlabInvocation("mr create", target=staging)  — EXTENDED (Item 1a)
        │  BLOCKS if target absent or target ∈ PROTECTED_BRANCHES
        ▼
 glab mr create --target-branch staging   (subprocess, gated)
```

### Recommended Project Structure

```
.pi/extensions/
├── grill/
│   └── index.ts          # command: /grill, thin — pre-flight, evidence gate, scorecard
├── plan-ceremony/         # avoid "plan/" — collides with plan-mode's own concept; pick a name
│   └── index.ts          # command: /plan (after plan-mode's own /plan renamed to /plan-mode)
├── execute/
│   └── index.ts          # command: /execute, handoff packet builder (pure, exported for tests)
├── review/
│   └── index.ts          # command: /review, expected-files diff, glab mr create call
└── plan-mode/
    └── index.ts          # EXISTING, vendored — registerCommand("plan", ...) → registerCommand("plan-mode", ...), DEVIATION 6

.pi/skills/
├── grill/SKILL.md         # ambiguity-scorecard rubric, rotating-perspective list, question templates
├── plan-ceremony/SKILL.md # task-form template, coverage-matrix instructions
└── review/SKILL.md        # anti-review-theatre soft-failure list (mirrors .pi/agents/reviewer.md's prose)

.pi/work/<slug>/            # GITIGNORED — SPEC.md, PLAN.md, REVIEW.md, PROGRESS.md
```

### Pattern 1: Zero-parent-token structured output (the `submit_review` pattern)
**What:** A tool definition (typebox schema) built inline and passed to `callModel`'s `tools` option per-call, never through `pi.registerTool`.
**When to use:** Any workflow needing the model to return validated structured data (e.g. a `/grill` "submit_scorecard" call, if the ambiguity scorecard needs model self-assessment rather than a pure code computation).
**Example:**
```typescript
// Source: .pi/extensions/quality/reviewer.ts:373-410 (VERIFIED, this repo)
const tools: Tool[] = [{
	name: SUBMIT_REVIEW_TOOL_NAME,
	description: SUBMIT_REVIEW_DESCRIPTION,
	parameters: submitReviewParameters, // typebox Type.Object with StringEnum, never Type.Union
}];
const message = await runSingleShotRole(ctx, {
	role: "reviewer", systemPrompt: REVIEWER_SYSTEM_PROMPT, messages, need: {}, tools,
});
// message.content is scanned for a toolCall block named SUBMIT_REVIEW_TOOL_NAME;
// absence is treated as failure (prose is never accepted), never validated blind.
```

### Pattern 2: StringEnum for any model-facing schema
**Example:**
```typescript
// Source: .pi/extensions/quality/review-schema.ts:107-146 (VERIFIED)
status: StringEnum(["Implemented", "Partial", "Missing"], { description: "..." }),
// NEVER Type.Union([Type.Literal("Implemented"), ...]) -- documented to break Google's API
```

### Pattern 3: Thin command + doc-relocated rationale (the `/quick` precedent)
**What:** Keep the command file's header short; move the "why" into `docs/WORKFLOWS.md`-style prose.
**Example:** `.pi/extensions/workflows/index.ts:1-9`'s header explicitly states "This header is deliberately short... Terseness here IS the FLOW-01 budget being honoured." Given the new `WORKFLOW_TEXT_BUDGETS` ceilings (250/200/250/250 lines), the same discipline is load-bearing for all four new commands.

### Anti-Patterns to Avoid
- **A prompt template standing in for a command:** loses every structural gate; confirmed impossible per Pi's own docs.
- **Re-deriving `classifyGitInvocation`/`classifyGlabInvocation` inline in a new module:** Correction 3 explicitly forbids a second control; extend the existing exported functions.
- **Registering a new routing role** for interrogation or per-task execution: `ROLES` is fixed by decision; use the ordinary prompt loop (`pi.sendUserMessage`) or the existing four `call-model` roles.
- **A skill body reached only by a path literal that the ratchet cannot see** (agent `.md` files, non-`.md` skill assets, `pi.exec`-referenced scripts) — exactly what Item 1's `RESOURCE_EDGES` scanner exists to close.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Branch/MR safety classification | A second `mr create` gate ad hoc in the review command | Extend `classifyGlabInvocation` (`safety/git.ts:449`) | Correction 3; a second control is exactly the failure mode the whole safety layer exists to prevent |
| Evidence-gated commit verification | A new SHA/tree comparison for `/execute` | `workflows/evidence.ts#gateCompletion`/`startRun`/`endRun` (Phase 6, unmodified) | Already handles the 6-branch predicate including the empty-commit tree-comparison fix (08-12) |
| Reviewer dispatch + structured output validation | A second reviewer call path | `quality/reviewer.ts#runReview` + `review-schema.ts#validateReview` | GATE-01..GATE-08 already built and tested; Phase 9 wires and dials, does not rebuild |
| Token cost measurement for handoff packets | A custom char-counter | `diagnostics/budget.ts#estimateTokensFromChars`/`computeBudget` | Already the project's one honest (labelled, non-tokenizer) estimate; no new dependency permitted anyway |
| Structured model output | Hand-rolled JSON parsing of free text | `typebox` `Type.Object` + `StringEnum`, `Tool[]` passed per-call | Matches `review-schema.ts`'s proven pattern; avoids the documented Google-API string-enum bug |

**Key insight:** Phase 9's entire job is composition — every piece of enforcement machinery it needs (evidence gating, reviewer dispatch, deterministic gates, tool-count/allowlist tracking, runbook status parsing) already exists from Phases 4–8. The risk is not "what do we build" but "what do we accidentally rebuild."

## Common Pitfalls

### Pitfall 1: Confusing "GLAB_BLOCKED_SUBCOMMANDS exists" with "it's importable"
**What goes wrong:** A plan that writes `import { GLAB_BLOCKED_SUBCOMMANDS } from "../safety/git.ts"` to add an `mr create` row will fail to compile — the const is module-private (no `export` keyword, `git.ts:429,438`).
**Why it happens:** CONTEXT.md's code_context section names the tables as if reachable; they are, but only by editing `git.ts` itself.
**How to avoid:** The `mr create` allow rule must be added as a new predicate row inside `git.ts`'s own `GLAB_BLOCKED_SUBCOMMANDS`/`GLAB_READ_SUBCOMMANDS` tables (or a new table), not consumed externally. `classifyGlabInvocation` itself IS exported and is the only call site a Phase 9 module should import.

### Pitfall 2: Assuming `/quick` has 4 lines of headroom
**What goes wrong:** A plan that budgets a tiny edit to `workflows/index.ts` "because there's 4 lines of headroom to 100" will discover the real number is 1 line (measured 99, not the registry's stated 96).
**Why it happens:** The registry's `why` narrative was not updated after the most recent commit (`dc4cc16`, WR2-06) added a 3-line comment.
**How to avoid:** Re-measure with `countRawLines` before planning any edit to this specific file; do not trust the `why` string's stated figure. (This does not affect the declared *budget* of 100, which is still correct — only the narrative text is stale.)

### Pitfall 3: Believing the skill/prompt-body hole is as wide as CONTEXT.md implies
**What goes wrong:** Building a `RESOURCE_EDGES` scanner that re-covers `.pi/skills/**.md` and `.pi/prompts/**.md` bodies, which are ALREADY closed by `discoverWorkflowFiles()` + the per-file completeness check (`workflow-budgets.test.ts:1027-1040`).
**Why it happens:** CONTEXT.md's decision text names "a skill body, a prompt template" as part of the hole without distinguishing "discovered but uncounted" from "not discovered at all."
**How to avoid:** Scope the new scanner to what is genuinely invisible: `.pi/agents/*.md` (zero glob coverage anywhere in the test file), non-`.md` files inside a skill/prompt directory (walked, then filtered out), and `pi.exec`-referenced paths (never globbed by anything). Re-closing the already-closed part wastes the phase's own line budget on redundant machinery.

### Pitfall 4: Trusting the WR-09 test's own 800ms constant as "enough margin"
**What goes wrong:** A shallow fix that just raises `800` to e.g. `2000` — this is the explicitly PROHIBITED "wider bound" from the 08-05 precedent, and this session's own measurement shows boot cost already exceeds 970ms under only moderate load, so any fixed constant remains a race against however loaded the machine is.
**How to avoid:** Delete the wall-clock margin outright; replace with an IPC ready/release handshake (Item 2's recommendation below).

### Pitfall 5: Building `expectedFiles` scope-drift as part of the model's own output
**What goes wrong:** Asking the reviewer model to self-report scope drift (e.g., via a new `submitReviewParameters` field) rather than computing it deterministically from `git diff --name-only` vs SPEC §5's list.
**Why it happens:** `filesTouchedUnion` is already a fact FED to the reviewer as context (`reviewer.ts:130-133`), which looks like an obvious place to also compute drift.
**How to avoid:** FLOW-05 requires the check be "machine-checkable against the diff" — Decision 7 ("exhortation is not a mechanism") applies directly. Compute drift with code (`git diff --name-only` vs the declared expected-files array) and render it as its own REVIEW.md section, independent of what the model reports.

## Code Examples

### Extending `classifyGlabInvocation` for `mr create` (Item 1a's exact edit)
```typescript
// Source: .pi/extensions/safety/git.ts:428-441 (VERIFIED — current state)
const GLAB_BLOCKED_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{ subcommand: "mr", matches: (args) => args[0] === "merge", why: "..." },
];
const GLAB_READ_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{ subcommand: "mr", matches: (args) => args[0] === "list" || args[0] === "view", why: "..." },
	{ subcommand: "ci", matches: (args) => args[0] === "status", why: "..." },
];
// classifyGlabInvocation (:449-466) checks BLOCKED first, then READ, else falls
// through to the fail-closed "unclassified glab form" block at :462-465.
// "glab mr create" today matches NEITHER table -> falls through -> BLOCKED.
//
// Minimal edit: add an mr-create allow rule to GLAB_READ_SUBCOMMANDS (renaming
// the table, or adding a third table, since "create" is a write in GitLab's
// domain but the classifier's own binary blocked/read split does not model a
// conditional allow -- the predicate itself must inspect args for an explicit
// --target-branch/-b flag whose value is NOT in PROTECTED_BRANCHES):
{
	subcommand: "mr",
	matches: (args) => {
		if (args[0] !== "create") return false;
		const idx = args.findIndex((a) => a === "--target-branch" || a === "-b");
		if (idx === -1 || args[idx + 1] === undefined) return false; // no target -> GitLab defaults to main -> BLOCK
		const target = args[idx + 1];
		return !PROTECTED_BRANCHES.some((b) => b.toLowerCase() === target.toLowerCase());
	},
	why: "mr create is allowed ONLY with an explicit --target-branch that is not protected -- " +
		"GitLab defaults an omitted target to the project default branch (main), so silence is the deploy trigger",
},
// PROTECTED_BRANCHES must be threaded in (classifyGlabInvocation currently
// takes no facts argument at all -- signature change required, propagated to
// its one call site in policy.ts:361).
```
Files that must move in the same commit: `tests/fixtures/evasion-corpus.ts` (new `mr create` allow/block rows), `docs/SAFETY.md`'s derived limits table (regenerated from the corpus by `docs-policy.test.ts`'s `truncationCauseCount()` mechanism — do not hand-edit), `tests/unit/git-policy.test.ts` (the `classifyGitInvocation`/`classifyGlabInvocation` fixture-table suite), `tests/unit/policy-compose.test.ts` (evaluation-order suite, since `classifyGlabInvocation`'s signature changes).

### `/plan` rename (Item 1e)
```
// Source: .pi/extensions/plan-mode/index.ts:39-53 (VERIFIED) -- the precedent to follow exactly:
//   1. `pi.registerCommand("todos", ...)` renamed to `pi.registerCommand("plan-todos", ...)`,
//      description changed... Forced by a genuine composition conflict...
//      Resolved deliberately here (Standing Rule 8, settled in 07-07-PLAN.md's own
//      <verified_composition_conflict>): the general `/todos` name stays with `todo.ts`
//      ..., and this file's plan-progress listing takes the more specific `/plan-todos` name.
```
Places the rename must be reflected (all VERIFIED present today):
- `.pi/extensions/plan-mode/index.ts:273` (`registerCommand("plan", ...)` → `"plan-mode"`)
- `.pi/extensions/plan-mode/index.ts:1-90` (vendoring header's numbered changes list — add item 5/DEVIATION 6)
- `.pi/extensions/plan-mode/PROVENANCE.md:61` (numbered deviations list)
- `tests/unit/plan-mode-read-only.test.ts:373` (`commands.get("plan")` → `commands.get("plan-mode")`)
- `tests/unit/workflow-budgets.test.ts:193-211` (WORKFLOW_BUDGETS `why` string says "registers /plan and /plan-todos")
- `docs/EXTENSIONS.md:120` (table row, no literal `/plan` text but adjacent)
- NOT `.pi/extensions/plan-mode/index.ts:203` (`pi.registerFlag("plan", ...)`) — this is Pi's FLAG namespace, structurally separate from the COMMAND namespace; no collision, no rename needed, but do not conflate the two when searching for "plan" occurrences.
- NOT `.pi/extensions/safety/infra.ts:305` (`"plan"` in `TERRAFORM_ALLOW_SUBCOMMANDS` — `terraform plan`, unrelated)

## State of the Art

Not applicable in the usual sense — this is a codebase-verification task, not a technology survey. The one relevant "old → current" shift is internal: Phase 8's CR-04/WR2-04 closed the *import*-reachability half of the offloading hole; this phase closes the *resource-edge* half. No external technology changed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | vitest 4.x defaults to `pool:"forks"` with `maxForks = availableParallelism()-1` when unset in `vitest.config.ts` | Item 2 / Validation Architecture | LOW — not re-verified against vitest's own docs in this session (web research explicitly out of scope for this phase); `vitest.config.ts` is confirmed to set none of `pool`/`poolOptions`/`fileParallelism` either way, so the qualitative point (real OS-level parallelism, unbounded by config) holds regardless of the exact default |
| A2 | Node's child IPC channel (`stdio:[...,"ipc"]`) works identically for `spawn()` targeting a Node.js child on Windows as it does for `fork()` | Item 2 recommendation | LOW-MEDIUM — this is standard, stable Node.js `child_process` behavior from training knowledge, not verified via Context7/official docs in this session per the phase's no-web-research constraint; if wrong, the fallback (a filesystem sentinel file: child writes `ready-<tag>`, parent polls, then writes `go`, child polls) achieves the same event-gating property, just with added disk I/O per poll |
| A3 | Rotating perspectives / ambiguity-scorecard scoring can be done via prompt instruction inside the ordinary conversation loop, without a new routing role | Architectural Responsibility Map | LOW — directly follows from `ROLES` being fixed by decision (`schema.ts:104-109`, VERIFIED) and `/quick`'s own no-nested-call precedent (VERIFIED); the only way this is wrong is if the planner decides interrogation genuinely needs a second-opinion nested call, which remains available via the existing `advisor` role with no new role required either way |

**If this table is empty:** N/A — three assumptions logged above, all LOW or LOW-MEDIUM risk, none load-bearing for the phase's pass/fail gates.

## Open Questions

1. **Does `classifyGlabInvocation`'s signature change (adding a `facts`-like parameter for `PROTECTED_BRANCHES`) ripple into `policy.ts`'s evaluation-order docstring, which currently states `classifyGlabInvocation` "takes no branch facts at all"?**
   - What we know: `policy.ts:361` calls it today with no facts argument; the module docstring (`git.ts:76-79`) explicitly argues glab's danger is branch-independent.
   - What's unclear: whether threading `PROTECTED_BRANCHES` into `classifyGlabInvocation` (needed for the `mr create` target check) contradicts that documented rationale, or is additive to it (branch-independence is about the CURRENT branch; the target-branch check is about the DESTINATION, a different fact).
   - Recommendation: the plan should thread `protectedBranches` as a new, separate parameter (not `GitPolicyFacts`, which also carries `currentBranch`) and update both docstrings to state the distinction explicitly — glab classification remains independent of `currentBranch`, but not independent of the destination branch name.

2. **Where exactly does `RESOURCE_EDGES` completeness-scanning live — inside `workflow-budgets.test.ts` itself, or a new production module?**
   - What we know: `importedSubsystemDirs` (the import-edge half) lives entirely inside the TEST file, not production code — it is a test-time analysis, not a runtime mechanism.
   - What's unclear: whether the resource-edge scanner should follow the same test-only pattern (simplest, no production code, no line-budget cost) or needs a production-side declaration (e.g., a workflow module exporting its own `RESOURCE_EDGES` list, analogous to `AGENT_NAME_BY_ROLE`).
   - Recommendation: follow the test-only precedent — `importedSubsystemDirs` proves a test-side static scanner is sufficient and costs nothing against the line budgets it's protecting. A `RESOURCE_EDGES` registry can live in `workflow-budgets.test.ts` itself (declared per-workflow, checked for completeness the same way `WORKFLOW_BUDGETS` is).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` | evidence gate, MR flow, expected-files diff | ✓ | (system) | — |
| `glab` | `/review`'s MR step | UNVERIFIED (not probed this session — `stub-bin.ts` provides an offline stand-in for tests; CONTEXT.md notes `RB-09-xx` for the real binary) | — | `tests/helpers/stub-bin.ts` stubs `glab` on `PATH` for all offline tests |
| `pi-subagents` (npm) | FLOW-09's real handoff spawn | ✗ (pinned, not installed — Correction 2) | — | Probe by `registeredToolNames()`; degrade to `UNAVAILABLE`, never silent pass |
| Node ≥22.19.0 | runtime | ✓ | v24.16.0 (measured this session) | — |

**Missing dependencies with no fallback:** none — every missing dependency (`pi-subagents`, real `glab`) has an established offline proxy pattern already used elsewhere in this repo.

**Missing dependencies with fallback:** `pi-subagents` (probe-and-degrade), `glab` (stub-bin.ts for tests; real binary's actual presence on the work laptop is untested here per the RUNBOOK constraint).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 [VERIFIED: `package.json` devDependencies, `npx vitest run` executed this session] |
| Config file | `vitest.config.ts` — no `pool`/`poolOptions`/`fileParallelism` set |
| Quick run command | `npx vitest run tests/unit/<file>.test.ts` |
| Full suite command | `npx vitest run` (100 files / ~1900+ tests as of Phase 8 close) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLOW-02 | `/grill` refuses to advance past the ambiguity gate below score 0.20 / unmet floor | unit | `pytest`-equivalent: `npx vitest run tests/unit/grill-scorecard.test.ts` | ❌ Wave 0 |
| FLOW-03 | SPEC.md write is structurally blocked until §2 non-empty with evidence on every row | unit | `npx vitest run tests/unit/grill-evidence-gate.test.ts` | ❌ Wave 0 |
| FLOW-04 | Every §4 entry matches `IF .* THEN THE SYSTEM SHALL .*`, minimum 3 entries enforced | unit | `npx vitest run tests/unit/spec-error-behaviour.test.ts` | ❌ Wave 0 |
| FLOW-05 | expected-files list is non-empty; a diff outside it is flagged | unit + integration (real temp git repo diff) | `npx vitest run tests/unit/scope-drift.test.ts tests/integration/scope-drift.test.ts` | ❌ Wave 0 |
| FLOW-06 | task regex `T### [P] [R#] verb <path> + verification command`; coverage matrix rejects an unmapped Rn | unit | `npx vitest run tests/unit/plan-task-form.test.ts` | ❌ Wave 0 |
| FLOW-07 | PROGRESS.md append carries real pasted output; commit is atomic (reuses `gateCompletion`) | integration (real temp git repo) | `npx vitest run tests/integration/execute-workflow.test.ts` | ❌ Wave 0 |
| FLOW-08 | REVIEW.md carries all four sections including the new Scope Drift; MR call routes through `classifyGlabInvocation` | unit + integration (`stub-bin.ts` for `glab`) | `npx vitest run tests/unit/review-render.test.ts tests/integration/review-mr.test.ts` | ❌ Wave 0 |
| FLOW-09 | handoff packet builder is pure; token measurement is negative vs. parent baseline; `UNAVAILABLE` reported honestly when `subagent` tool absent | unit | `npx vitest run tests/unit/handoff-packet.test.ts` | ❌ Wave 0 |
| FLOW-10 | no artifact beyond SPEC/PLAN/REVIEW/PROGRESS is written to `.pi/work/<slug>/` | unit (filesystem assertion in a temp dir) | `npx vitest run tests/unit/artifact-count.test.ts` | ❌ Wave 0 |
| QUAL-03 | Root Cause section required and gated identically to §2 for fix-framed SPECs | unit | (folded into `spec-error-behaviour.test.ts` or its own file) | ❌ Wave 0 |
| QUAL-08 | `/quick` remains deterministic-only; full workflow runs all four quality mechanisms — a pure selector, asserted both directions | unit | `npx vitest run tests/unit/gate-depth-selector.test.ts` | ❌ Wave 0 |
| (existing) glab `mr create` gate | allow-with-target / block-without-target / merge-still-blocked | unit | `npx vitest run tests/unit/git-policy.test.ts` (extend) | ✓ exists |
| (existing) sideways-ratchet closure | resource-edge completeness scan; `WORKFLOW_TEXT_BUDGETS` per-workflow sum | unit | `npx vitest run tests/unit/workflow-budgets.test.ts` (extend) | ✓ exists |
| (folded-in) WR-09 de-flake | 10x-repetition determinism, mutation falsification (08-05 pattern) | unit + repetition | `npx vitest run tests/unit/checkpoint-store.test.ts` × 10 | ✓ exists (to be modified) |

### Sampling Rate
- **Per task commit:** the specific new/modified test file(s) for that task
- **Per wave merge:** `npx vitest run` (full suite) + `npx tsc --noEmit`
- **Phase gate:** full suite green, `tsc --noEmit` clean, `checkpoint-store.test.ts` run 10x consecutively green (mirroring the 08-05 falsification budget) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/grill-scorecard.test.ts` — FLOW-02
- [ ] `tests/unit/grill-evidence-gate.test.ts` — FLOW-03
- [ ] `tests/unit/spec-error-behaviour.test.ts` — FLOW-04, QUAL-03
- [ ] `tests/unit/scope-drift.test.ts` + `tests/integration/scope-drift.test.ts` — FLOW-05
- [ ] `tests/unit/plan-task-form.test.ts` — FLOW-06
- [ ] `tests/integration/execute-workflow.test.ts` — FLOW-07
- [ ] `tests/unit/review-render.test.ts` + `tests/integration/review-mr.test.ts` — FLOW-08
- [ ] `tests/unit/handoff-packet.test.ts` — FLOW-09
- [ ] `tests/unit/artifact-count.test.ts` — FLOW-10
- [ ] `tests/unit/gate-depth-selector.test.ts` — QUAL-08
- [ ] Extend `tests/unit/git-policy.test.ts`, `tests/unit/policy-compose.test.ts`, `tests/fixtures/evasion-corpus.ts` — `mr create`
- [ ] Extend `tests/unit/workflow-budgets.test.ts` — new `WORKFLOW_TEXT_BUDGETS`, `RESOURCE_EDGES`, four new `WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS` entries
- [ ] Extend `tests/unit/gitignore-policy.test.ts` — `.pi/work/` entry
- [ ] Extend `tests/unit/docs-policy.test.ts` — `PHASE_NINE_IDS`, `ALL_IDS`, `ENTRY_COMMANDS`
- [ ] Modify `tests/unit/checkpoint-store.test.ts` — WR-09 event-gated rewrite

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | This phase adds no auth surface; `glab`'s own CLI credential handling is out of scope, unchanged |
| V3 Session Management | no | No session concept introduced |
| V4 Access Control | yes | Extending `classifyGlabInvocation` — the branch-protection/target-branch check IS the access control, reusing Phase 4's fail-closed pattern (deny unknown, deny unmatched shape) |
| V5 Input Validation | yes | Task-form regex validation, expected-files list validation, ambiguity-scorecard bounds, `submitReviewParameters`-style typebox schemas for any new structured output — all pure, code-enforced predicates, never model-trusted |
| V6 Cryptography | no | No crypto surface; no new secret handling |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A model-authored `mr create --target-branch main` slipping through as an "explicit target" | Tampering/EoP | The new predicate must reject any target matching `PROTECTED_BRANCHES` case-insensitively, mirroring `isProtected`'s existing comparison (`git.ts:333-335`) |
| A model fabricating expected-files/scope-drift compliance in prose rather than the code-computed diff | Repudiation | FLOW-05's check must be computed by `git diff --name-only`, never accepted as a model claim (Pitfall 5 above) |
| A handoff packet leaking more than the declared SPEC excerpt (e.g., accidentally including the full session context) | Information Disclosure | `inheritProjectContext: false` + `inheritSkills: false` + `systemPromptMode: replace` on any agent file, exactly as `.pi/agents/planner.md`/`reviewer.md` already do [VERIFIED] |
| A `RESOURCE_EDGES` scanner with a loose regex that fails to catch a real `.pi/`-shaped path literal, silently re-opening the offloading hole it exists to close | Tampering (of the budget control itself) | Model the scanner's pattern strictness on `importedSubsystemDirs`' own regex discipline; falsify it the same way (plant a fixture file reachable only by the new edge kind, confirm the scanner catches it, per the `grill/steps.ts` precedent in `workflow-budgets.test.ts:754-758`) |

## Verified Codebase Facts

| Claim | Evidence (file:line or command output) | How Verified |
|---|---|---|
| `GLAB_BLOCKED_SUBCOMMANDS`/`GLAB_READ_SUBCOMMANDS` are module-private, not exported | `.pi/extensions/safety/git.ts:429,438` — `const`, no `export` keyword | [VERIFIED: Read] |
| `classifyGlabInvocation` IS exported; `glab mr create` today falls through to the fail-closed "unclassified glab form" block | `.pi/extensions/safety/git.ts:449-466` | [VERIFIED: Read] |
| `PROTECTED_BRANCHES = ["main","master"]`, exported | `.pi/extensions/safety/index.ts:140` | [VERIFIED: grep] |
| `policy.ts`'s evaluation order dispatches to `classifyGitInvocation`/`classifyGlabInvocation` only when executable is literally `git`/`glab` | `.pi/extensions/safety/policy.ts:359-361` | [VERIFIED: Read] |
| `GUARDED_VERB_PATTERN = /\b(git\|glab\|terraform\|aws\|kubectl)\b/i` | `.pi/extensions/safety/shell.ts:150` | [VERIFIED: grep] |
| `.pi/extensions/workflows/index.ts` measures **99 raw lines today**, not the registry's stated 96 | `node countRawLines` output this session: `99` | [VERIFIED: command output, `wc -l` cross-checked at 98 lines + trailing newline = 99 per the test's own `split("\n").length` method] |
| `workflow-budgets.test.ts` 64/64 tests pass with the current registry, despite the stale `why` narrative | `npx vitest run tests/unit/workflow-budgets.test.ts` → `Test Files 1 passed (1)`, `Tests 64 passed (64)` | [VERIFIED: command output, this session] |
| Every `WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS` entry currently measures EXACTLY at its declared ceiling (rounds to the declared budget with zero slack) | Full re-measurement table below, produced by a script mirroring `countRawLines`/`filesInDir` | [VERIFIED: command output, this session] |
| `importedSubsystemDirs` matches only `/\bfrom\s+["'](\.\.?\/[^"']+)["']/` — misses any non-import path reference | `tests/unit/workflow-budgets.test.ts:730` | [VERIFIED: Read] |
| `.pi/skills/**.md` and `.pi/prompts/**.md` bodies ARE discovered by `discoverWorkflowFiles()` and MUST have a `WORKFLOW_BUDGETS` entry (completeness check) | `tests/unit/workflow-budgets.test.ts:553-584` (discovery), `:1027-1040` (completeness) | [VERIFIED: Read] |
| Non-`.md` files inside `.pi/skills/**`/`.pi/prompts/**` are walked but filtered out by the `.endsWith(".md")` check — invisible to the whole mechanism | `tests/unit/workflow-budgets.test.ts:577-579` | [VERIFIED: Read] |
| `.pi/agents/*.md` is scanned by NO glob in `workflow-budgets.test.ts` (WORKFLOWS_DIR/PROMPTS_DIR/SKILLS_DIR/EXTENSIONS_DIR only) | grep for `.pi/agents` in the test file → 0 matches; `.pi/agents/{planner,reviewer}.md` confirmed to exist on disk | [VERIFIED: grep + `ls`] |
| No `expectedFiles`/scope-drift/diff-vs-expected mechanism exists anywhere in the codebase | `grep -rn "expectedFiles"` across `.pi/extensions` and `tests/` → 0 matches; `filesTouchedUnion` exists only as a rendered fact fed TO the reviewer, never diffed by code | [VERIFIED: grep] |
| `renderReviewMarkdown` emits Verdicts/Findings/Checked-and-cleared/Classification — no Scope Drift section | `.pi/extensions/quality/review-schema.ts:526-579` | [VERIFIED: Read] |
| `ReviewArtifact` interface has no scope-drift field | `.pi/extensions/quality/review-schema.ts:175-185` | [VERIFIED: Read] |
| The zero-parent-token pattern: `submit_review`'s tool def is built inline and passed to `runSingleShotRole(...,{tools})`, never `pi.registerTool`'d | `.pi/extensions/quality/reviewer.ts:373-410` | [VERIFIED: Read] |
| `ROLES = ["executor","planner","reviewer","advisor","vision","summariser"]`, fixed by decision text | `.pi/extensions/routing/schema.ts:104-109` | [VERIFIED: Read] |
| `runSingleShotRole` serves only the four `call-model` roles (reviewer/advisor/vision/summariser); throws for `executor` (`set-model`) or `planner` (`subagent`) | `.pi/extensions/routing/schema.ts:136-147`, `.pi/extensions/routing/modes.ts:531-536` | [VERIFIED: Read] |
| `/quick` hands its actual work to the ordinary prompt loop via `pi.sendUserMessage`, never a nested call | `.pi/extensions/workflows/index.ts:60` | [VERIFIED: Read] |
| `pi-subagents` registers 4 parent-visible tool names: `subagent`, `subagent_wait`, `subagent_supervisor`, `intercom` | `tests/unit/tool-count-baseline.test.ts:132` | [VERIFIED: grep] |
| `.pi/agents/planner.md`/`reviewer.md` deliberately omit `model:`/`fallbackModels:` frontmatter keys, with an HTML-comment rationale citing `pi-subagents@0.49.0 src/agents/agents.ts:1155` | `.pi/agents/planner.md:50-66`, `.pi/agents/reviewer.md:27-41` | [VERIFIED: Read] |
| `TOOL_REGISTRATION_ALLOWLIST` is exactly 5 entries | `tests/unit/contributing-boundary.test.ts:257-263` | [VERIFIED: Read] |
| `pinning.test.ts` requires exactly 6 devDependencies; current `package.json` has exactly 6 | `tests/unit/pinning.test.ts:245-257`; `package.json` devDependencies keys | [VERIFIED: Read + command output] |
| `MUST_BE_IGNORED` has 27 entries (≥20 required), `MUST_BE_COMMITTABLE` has 24 (≥17 required); `.pi/work/` is NOT in `.gitignore` today | `tests/unit/gitignore-policy.test.ts:38-135`; grep of `.gitignore` | [VERIFIED: Read + grep] |
| Highest existing runbook id is `RB-08-03`; `PHASE_EIGHT_IDS` already present in `docs-policy.test.ts` (added by Phase 8's closing plan) | `tests/unit/docs-policy.test.ts:165-176`; `docs/RUNBOOK.md:1314-1426` | [VERIFIED: grep] |
| Runbook entry shape: summary-table row `\| RB-XX-YY \| ... \| STATUS \|` + detail subsection `### RB-XX-YY — ...` with `**Status:**` line, both required to agree | `docs/RUNBOOK.md:860-914` (RB-04-01 worked example) | [VERIFIED: Read] |
| Highest existing `DEVIATION` label in `plan-mode/` is 5; next available is 6 | grep for `DEVIATION [0-9]` across `.pi/extensions/plan-mode/` → max match is `DEVIATION 5` | [VERIFIED: grep] |
| `.pi/extensions/plan-mode/index.ts` also calls `pi.registerFlag("plan", ...)` — a SEPARATE namespace from `registerCommand`, no rename needed | `.pi/extensions/plan-mode/index.ts:203` | [VERIFIED: grep] |
| Pi's package manifest (`package.json`'s `pi` field) already declares `.pi/skills` and `.pi/prompts` as resource paths — no extra registration needed for new skill/prompt files | `package.json` `pi.skills`/`pi.prompts` arrays | [VERIFIED: Read] |
| Skill discovery: `.pi/skills/` root `.md` files AND `SKILL.md`-containing directories, both recursive, project-scoped and gated behind project trust; skill body loaded only on `read`, XML index carries only name/description/location | Pi 0.84.1 `docs/skills.md` (Locations, Discovery rules sections); `formatSkillsForPrompt` source recovered from `dist/core/skills.js.map`'s `sourcesContent`, lines 336-360 | [VERIFIED: official docs + recovered TypeScript source, this session] |
| Prompt templates are pure markdown expansion (`$1`/`$@`/`${1:-default}` substitution only), non-recursive discovery, zero code execution capability | Pi 0.84.1 `docs/prompt-templates.md` (full file read) | [VERIFIED: official docs, this session] |
| `ExtensionCommandContext` (commands only) extends `ExtensionContext` with `getSystemPromptOptions`, `waitForIdle`, `newSession`, `fork`, `navigateTree`, `switchSession`, `reload` | Pi 0.84.1 `dist/core/extensions/types.d.ts:254-290` | [VERIFIED: Read, installed package] |
| `estimateTokensFromChars(chars) = Math.ceil(chars/4)`, the honest labelled non-tokenizer estimate | `.pi/extensions/diagnostics/budget.ts:223-225` | [VERIFIED: Read] |
| `runQuickGateStage(cwd, projectTrusted): GateResult` — signature includes `projectTrusted` (added by the most recent commit, WR2-06) | `.pi/extensions/quality/index.ts:390`; `.pi/extensions/workflows/index.ts:45` (call site) | [VERIFIED: Read] |
| `WR-09` test spawns 4 children asynchronously via `spawn` (not `spawnSync`), barrier is `startAt = Date.now()+800`, overlap asserted via `latestStart < earliestFinish` | `tests/unit/checkpoint-store.test.ts:217-274` | [VERIFIED: Read] |
| Writer-child boot cost (process start → `import()` resolved) measures 587-614ms in complete isolation (5 solo runs) | Measured this session, temp script mirroring the test's own generated writer | [VERIFIED: command output, this session] |
| Writer-child boot cost measures 789-970ms under 8-16 concurrent busy processes (simulated suite load) | Measured this session, 3 runs at each load level | [VERIFIED: command output, this session] |
| `store.ts`'s `withLock` degrades to running UNLOCKED after `LOCK_MAX_WAIT_MS = 2_000`ms of contention, by design | `.pi/extensions/checkpoint/store.ts:190-243` | [VERIFIED: Read] |
| `vitest.config.ts` sets no `pool`/`poolOptions`/`fileParallelism` | `vitest.config.ts` (full file read) | [VERIFIED: Read] |
| 16 files under `tests/integration/` spawn real OS processes via `spawn`/`spawnSync` | grep for `spawn(\|spawnSync(` across `tests/integration/` | [VERIFIED: grep, this session] |
| `08-05-SUMMARY.md`'s prohibited-mechanism list for the qoder-delegate de-flake: `retry`, a wider bound, raising `testTimeout`, `it.skip`, `fileParallelism: false` | `.planning/phases/08-quality-gates-engineering-quality/08-05-SUMMARY.md:79-84,158-163` | [VERIFIED: Read] |

## Item 1 — The Sideways Ratchet: Decision and Diff

### (a) The residual hole, precisely scoped

CONTEXT.md's decision text names the hole as "a skill body, a prompt template, an agent file (`.pi/agents/*.md`), a JSON table, or a script handed to `pi.exec`." Verified against the actual scanning code (`discoverWorkflowFiles()`, `tests/unit/workflow-budgets.test.ts:553-584`):

- **`.pi/skills/**.md` and `.pi/prompts/**.md` bodies — ALREADY CLOSED.** `discoverWorkflowFiles()` globs `trackedFiles(SKILLS_DIR)`/`walkOnDisk(SKILLS_DIR)` and `trackedFiles(PROMPTS_DIR)`/`walkOnDisk(PROMPTS_DIR)`, filters to `.endsWith(".md")`, and the registry-completeness test (`:1027-1040`) fails if any discovered file lacks a `WORKFLOW_BUDGETS` entry. Any `.md` skill or prompt body Phase 9 writes is therefore *forced* into the per-file budget the moment it exists, with no extra machinery needed. CONTEXT.md's own decision text is not wrong that these are budget-relevant, but they are not part of the *hole* — they are already gated.
- **`.pi/agents/*.md` — GENUINELY OPEN.** No glob in the test file's four scanned roots (`WORKFLOWS_DIR`, `PROMPTS_DIR`, `SKILLS_DIR`, `EXTENSIONS_DIR`) includes `.pi/agents/`. `.pi/agents/planner.md` and `reviewer.md` exist today and are completely invisible to `workflow-budgets.test.ts`.
- **Non-`.md` assets inside a skill/prompt directory — GENUINELY OPEN.** Pi's own skill structure explicitly allows `scripts/`, `references/`, `assets/` subdirectories with arbitrary file types (`docs/skills.md`'s "Skill Structure" section). `walkOnDisk` finds these files, but `discoverWorkflowFiles()`'s filter (`p.endsWith(".md")`) drops them before they ever reach `WORKFLOW_BUDGETS`.
- **A script referenced by `pi.exec` — GENUINELY OPEN, currently theoretical.** No file under `.pi/extensions/` today calls `pi.exec` with a repo-relative script path (existing `pi.exec` call sites pass `git`/hook commands directly, `.pi/extensions/checkpoint/index.ts:34`, `.pi/extensions/loop-police/loop-police.ts:351`) — this is a forward-looking closure, not a repair of an existing live leak.
- **No directory-level ratchet exists for `.pi/skills/` or `.pi/prompts/` as directories**, because `commandDirs` (`:775-777`) is built only from `isCommandSource` (`.ts`/`.js` files containing `registerCommand(`) plus `importedSubsystemDirs` (also `.ts`/`.js`-only). A `.md` file can never enter `commandDirs`. So while every individual `.md` skill/prompt file is per-file budgeted, nothing stops an *additional*, non-`.md` file from hiding beside it with zero ratchet at all — which is exactly the second and third bullets above.

**Conclusion:** the hole is real but narrower than stated. Scope the new `RESOURCE_EDGES` completeness scanner at: (1) `.pi/agents/*.md`, (2) non-`.md` files under `.pi/skills/**`/`.pi/prompts/**`, (3) any `.pi/`-shaped path literal appearing in a discovered workflow/skill/prompt source that names a file not covered by (1) or (2) either. Do not duplicate the already-working `.md` skill/prompt-body closure.

### (b) Current mechanism, with line numbers, for a surgical diff

| Function | Location | What it does |
|---|---|---|
| `countRawLines(relPath)` | `tests/unit/workflow-budgets.test.ts:462-464` | `readFileSync(f,"utf-8").split("\n").length` — the one counting method every assertion uses |
| `walkOnDisk(rel)` | `:478-493` | Recursive on-disk file listing under `rel`, `isDirectory()`-gated so a flat file returns `[]` |
| `isCommandSource(p)` | `:508-517` | `.ts`/`.js` extension AND contains `"registerCommand("`; non-throwing on a missing file (WR-04) |
| `filesInDir(dir)` | `:532-538` | Union of `trackedFiles(dir)` ∪ `walkOnDisk(dir)`, filtered to `.ts`/`.js` under `dir/`, existsSync-checked |
| `discoverWorkflowFiles()` | `:553-584` | Union of tracked+on-disk under `WORKFLOWS_DIR`/`PROMPTS_DIR`/`SKILLS_DIR`/`EXTENSIONS_DIR`, filtered to (workflows `.ts`/`.js`) ∪ (prompts/skills `.md`) ∪ (any other extensions `.ts`/`.js` that `isCommandSource`) |
| `resolveLocalImport(fromFile, specifier)` | `:667-676` | Resolves one relative `from "..."` specifier to a repo-relative path, trying `.ts`/`.js`/`index.ts`/`index.js` |
| `importedSubsystemDirs(commandFiles)` | `:716-746` | Fixed-point BFS over `/\bfrom\s+["'](\.\.?\/[^"']+)["']/` matches, seeded from `commandFiles`, mapping `.pi/extensions/*` hits to their subsystem root (`slice(0,3)`) and other `.pi/*` hits to `dirname` |
| `commandDirs` | `:775-777` (inline in the `describe` block) | `Set([...commandFiles subsystem roots, ...importedSubsystemDirs(commandFiles)])` |
| `WORKFLOW_BUDGETS` | `:101-221` | Per-file registry: `{file, budget, why}[]`, 9 entries today |
| `DIRECTORY_BUDGETS` | `:232-459` | Per-directory registry: `{dir, budget, why}[]`, 11 entries today |

Both registries carry two `it.each` assertions: `actual <= budget` (`:605-613` per-file, `:801-810` per-directory) and `budget === Math.ceil(actual/10)*10` (`:615-640` per-file, `:812-830` per-directory) — the latter is `toBe`, not `toBeLessThan`, so a file that shrinks also forces an edit. `/quick` additionally carries the explicit, greppable `toBeLessThanOrEqual(100)` at `:642-656`, independent of the registry.

### (c) Measured line counts, this session (2026-08-15) — headroom table

All figures produced by re-running the test's own `countRawLines`/`filesInDir` logic in a standalone script, cross-checked by `npx vitest run tests/unit/workflow-budgets.test.ts` (64/64 green).

**WORKFLOW_BUDGETS (per file):**

| File | Measured raw lines | Declared budget | `ceil(actual/10)*10` | Headroom to next bump |
|---|---|---|---|---|
| `.pi/extensions/workflows/index.ts` | 99 | 100 | 100 ✓ | **1 line** |
| `.pi/extensions/workflows/evidence.ts` | 381 | 390 | 390 ✓ | 9 lines |
| `.pi/extensions/routing/index.ts` | 681 | 690 | 690 ✓ | 9 lines |
| `.pi/extensions/harness/index.ts` | 99 | 100 | 100 ✓ | **1 line** |
| `.pi/extensions/diagnostics/budget.ts` | 703 | 710 | 710 ✓ | 7 lines |
| `.pi/extensions/checkpoint/index.ts` | 244 | 250 | 250 ✓ | 6 lines |
| `.pi/extensions/loop-police/loop-police.ts` | 1303 | 1310 | 1310 ✓ | 7 lines |
| `.pi/extensions/plan-mode/index.ts` | 534 | 540 | 540 ✓ | 6 lines |
| `.pi/extensions/todo.ts` | 357 | 360 | 360 ✓ | 3 lines |

**DIRECTORY_BUDGETS (per directory, whole `.ts`/`.js` total):**

| Directory | Measured total | Files | Declared budget | `ceil(total/10)*10` | Headroom |
|---|---|---|---|---|---|
| `.pi/extensions/workflows` | 480 | 2 | 480 | 480 ✓ | **0 lines** |
| `.pi/extensions/routing` | 2356 | 5 | 2360 | 2360 ✓ | 4 lines |
| `.pi/extensions/harness` | 99 | 1 | 100 | 100 ✓ | 1 line |
| `.pi/extensions/diagnostics` | 3967 | 10 | 3970 | 3970 ✓ | 3 lines |
| `.pi/extensions/checkpoint` | 1064 | 3 | 1070 | 1070 ✓ | 6 lines |
| `.pi/extensions/loop-police` | 1326 | 2 | 1330 | 1330 ✓ | 4 lines |
| `.pi/extensions/plan-mode` | 1222 | 3 | 1230 | 1230 ✓ | 8 lines |
| `.pi/extensions/safety` | 4455 | 9 | 4460 | 4460 ✓ | **5 lines** |
| `.pi/extensions/quality` | 3748 | 8 | 3750 | 3750 ✓ | 2 lines |
| `.pi/extensions/providers` | 1430 | 4 | 1430 | 1430 ✓ | **0 lines** |
| `.pi/lib` | 687 | 2 | 690 | 690 ✓ | 3 lines |
| `.pi/extensions/todo.ts` (flat "dir") | 0 | 0 | 0 | 0 ✓ | 0 (structural) |

**Every single entry in both registries is currently within its own rounding bucket (headroom ranges from 0 to 9 lines) — none has meaningful slack.** The `safety/` directory (5 lines headroom) is the one this phase WILL touch (`git.ts`'s `mr create` rule, plus the `PROTECTED_BRANCHES`-threading change) — the plan must budget a `DIRECTORY_BUDGETS` raise for `.pi/extensions/safety` in the same commit as that edit, following the CR-04 grandfathering precedent (raise with a stated `why`, previous figure named).

### (d) The per-workflow `WORKFLOW_TEXT_BUDGETS` proposal — mechanical feasibility

**Is it mechanically checkable with what exists?** Yes, with new registry code, following the exact `WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS` pattern (a declared array + `countRawLines` summed per workflow + a `toBe(expected-sum)` freshness assertion). Nothing about it requires new production code — like `WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS` themselves, it can live entirely in the test file.

**Cleanest way to bind a workflow NAME to its command source and its bodies:** a declared registry, e.g.:
```typescript
const WORKFLOW_TEXT_BUDGETS: readonly { name: string; commandFile: string; bodies: readonly string[]; budget: number; why: string }[] = [
  { name: "grill", commandFile: ".pi/extensions/grill/index.ts", bodies: [".pi/skills/grill/SKILL.md"], budget: 250, why: "..." },
  // ...
];
```
A `registerCommand("<name>"` literal-string match (mirroring `isCommandSource`'s `COMMAND_MARKER` substring check) is a viable AUTOMATIC binding, but a **declared registry is the safer choice**: it makes the command↔skill/prompt association an explicit, reviewable fact (matching the project's stated preference throughout Phases 1-8 for declared tables over inferred ones — e.g. `AGENT_NAME_BY_ROLE`, `WORKFLOW_BUDGETS` itself), and it sidesteps a genuine ambiguity a naming-convention approach would have to solve anyway: nothing in Pi's skill/prompt-loading contract requires a skill named `grill` to be the ONE a command named `grill` uses (a workflow may legitimately use multiple skills, or share one, per CONTEXT.md's own discretion note).

**Risk: is ~950 lines of workflow text enough?** The five ceilings sum to 250+200+250+250+100 = 1050 lines (including the unchanged `/quick` at 100). Against that: `.pi/agents/reviewer.md`'s existing prose body alone is **41 lines** (measured: the file `Read` above spans lines 1-42), and `.pi/agents/planner.md` is **67 lines** — both far short of any of the new ceilings, suggesting the budget is workable for prose alone. The real risk named by CONTEXT.md is legitimate: an ambiguity-scorecard rubric, a rotating-perspectives enumeration, AND a task-form specification are each naturally table-shaped content that reads far more compactly as a markdown table (a handful of lines) than as prose paragraphs (dozens of lines) — e.g. `.pi/extensions/plan-mode/read-only.ts`'s own precedent (an allowlist TABLE, explicitly chosen over prose specifically because "compressing it into cleverness to satisfy a line budget is the wrong trade," `workflow-budgets.test.ts:328-334`) is the pattern to follow: push the ambiguity-dimension floors, the rotating-perspective list, and the task-form grammar into TABLES inside the skill body, not paragraphs. Tables still count fully against `WORKFLOW_TEXT_BUDGETS` (raw lines, no stripping — same D-1 rule as everywhere else), so this does not evade the ratchet; it just uses the line budget efficiently, exactly as intended.

### (e) The `/plan` command collision

Confirmed: `.pi/extensions/plan-mode/index.ts:273` registers `"plan"` today. Phase 7's precedent (the `/todos`→`/plan-todos` rename) is quoted verbatim in the Code Examples section above. The next available `DEVIATION` number is **6** (highest existing is 5, at `plan-mode/index.ts:119,148`). Every place the rename must be reflected is listed, with verified file:line citations, in the Code Examples section above.

## Item 2 — WR-09 Root Cause

**CONFIRMED, not merely plausible.** The overlap-timing assertion (`latestStart < earliestFinish`, `checkpoint-store.test.ts:258-263`) is the one directly evidenced to fail under load; the 600-row assertion has a real but unconfirmed second failure path.

### Which assertion fails, and by what mechanism

- **Overlap assertion — CONFIRMED primary mechanism.** The writer child's cost from process start to `import()` resolving (i.e., the time before it ever reads `Date.now()` for its `wait` calculation) measures:
  - **587–614ms in complete isolation** (5 solo runs, no contention at all) — already 73–77% of the 800ms budget with zero load.
  - **789–970ms under 8–16 concurrent busy processes** (simulated suite-level contention) — this **exceeds the entire 800ms budget outright**, for every one of the four children simultaneously, not intermittently.
  
  When `wait <= 0` (boot exceeded `startAt`), a child proceeds immediately with no sleep — this is not itself a bug, but it means the overlap guarantee the barrier is supposed to provide now depends entirely on how much the four children's *individual* boot times vary from each other, which is unbounded by anything in the test. In this session's own measurements the overlap held (189–225ms gap) only because all four children's boot-time variance stayed under their shared ~150–255ms write-loop duration — a coincidence of this specific machine's current load pattern, not a property the test guarantees. Under real in-suite scheduling (16 other files spawning real OS processes concurrently, per the grep count above), the variance is plausibly larger, which is exactly the reported ~1-in-30 rate.

- **600-row assertion — a real, structurally DIFFERENT, UNCONFIRMED secondary mechanism.** `store.ts`'s `withLock` (`:210-243`) degrades to running the read-modify-write **unlocked** after `LOCK_MAX_WAIT_MS = 2_000`ms of failed lock-acquisition retries — by explicit design ("Degrading to unlocked rather than failing is deliberate," `:204-208`). This is a genuinely separate code path from the overlap-timing race: it would produce a **lost update** (row count < 600) rather than a timing-assertion failure, and it could in principle fire independently of whether the overlap assertion also fails. This session's own measurements do not support it as the dominant cause here: per-call lock hold time (write + rename of a JSON array) was on the order of 1.2–1.7ms even under the heaviest simulated load tested, three orders of magnitude below the 2000ms ceiling. **Both assertions CAN fail, by different mechanisms — but only the overlap-timing mechanism is evidenced by this session's measurements as the one actually producing the reported flake rate.** The lock-timeout path remains a real, undemonstrated residual risk under conditions this session did not reproduce (e.g., a much slower disk, a CI runner far more resource-constrained than this dev machine).

### The deterministic, event-gated fix (on the 08-05 pattern)

Read against `08-05-SUMMARY.md` (the `qoder-delegate.test.ts` de-flake, quoted verbatim above): the pattern is **replace a wall-clock duration standing in for "this happened" with a real event, delete the duration outright, and assert on a lossless recorded property instead of a Date.now() delta.**

**Recommended mechanism: Node's built-in child IPC channel** (`spawn(execPath, args, {..., stdio: ["ignore","pipe","pipe","ipc"]})`), not stdin release and not a filesystem sentinel:

1. Parent spawns each child with an `"ipc"` stdio slot (Node.js supports this for any spawned Node.js child process, not only `fork()`).
2. Each child, immediately after its `import()` of `store.ts` resolves (the exact point that currently reads `Date.now()` for the `wait` calculation), sends `process.send({ type: "ready" })` and then blocks on `await new Promise((resolve) => process.once("message", resolve))`.
3. The parent's `runWriter()` helper collects each child's `"ready"` message via `child.on("message", ...)`, and `Promise.all()`s across all four before sending each child `child.send("go")`.
4. Children, released, proceed straight into their 150 `recordCheckpoint` calls, recording `startedAt`/`finishedAt` exactly as today.
5. **The wall-clock `startAt`/800ms margin (`checkpoint-store.test.ts:250`, and the `wait`/`if (wait > 0)` logic in the generated writer script, `:230-231`) is deleted outright** — there is no longer anything for a duration to race against; release happens only once every child has genuinely finished booting.
6. **Strengthen the overlap proof from a timestamp comparison to a structural one**, per the CONTEXT.md's own suggestion and the 08-05 precedent of preferring a lossless recorded property: after all 600 rows are recorded, compute the sequence of tags in `readCheckpoints(root)`'s resulting array order and assert genuine interleaving occurred (e.g., count "tag switches" in the sequence and assert it exceeds a small structural threshold — proving the four processes' writes landed interleaved in the shared file, not in four contiguous blocks). This is a property the SUBJECT itself produced (the store's own row order under its own lock), not a `Date.now()` delta measured by the test.

**Why IPC works on Windows:** Node's `child_process` IPC channel is implemented cross-platform (named pipes on Windows, Unix domain sockets on POSIX) and is Node's own standard mechanism for parent↔child signaling — the same mechanism `fork()` uses internally (`fork()` is `spawn()` with `"ipc"` pre-added and `execPath` pre-filled). `[ASSUMED — A2 in the Assumptions Log]`: not re-verified against Context7/official docs this session per the phase's no-web-research constraint; if this assumption is wrong, the fallback (a filesystem-sentinel ready/release handshake — child writes `ready-<tag>` after `import()`, parent polls for all four, then writes a `go` file, child polls for it) achieves the identical event-gating property using only `node:fs`, at the cost of poll-interval latency (immaterial here — even a 5ms poll interval is far below the margins this bug is about).

**Explicitly PROHIBITED for this fix, grep-checkable exactly as for 08-05** (state these in the eventual plan's own acceptance criteria):
```
git diff <before>..<after> | grep -nE "retry:|it\.skip|describe\.skip|\.todo\(|testTimeout|fileParallelism"
-> must find NONE
grep -c "startAt" tests/unit/checkpoint-store.test.ts  -> must be 0 (or only in a comment explaining its removal)
```
`retry` · a wider bound · raising `testTimeout` (already 120s, was never the issue) · `it.skip` · `fileParallelism: false`.

## Traps

- **Claiming the sideways-ratchet hole is fully closed by re-covering `.md` skill/prompt bodies.** That part was already closed by Phase 8's own `discoverWorkflowFiles()` glob and completeness check — a plan that "fixes" it re-does existing work and burns the phase's own `WORKFLOW_TEXT_BUDGETS` allowance on redundant test code, while leaving `.pi/agents/*.md` and non-`.md` skill assets genuinely open.
- **Editing `safety/git.ts` without budgeting the raise.** The `.pi/extensions/safety` directory has exactly 5 lines of headroom today; the `mr create` predicate plus a `PROTECTED_BRANCHES`-threading signature change will exceed it. The `DIRECTORY_BUDGETS` entry MUST move in the same commit, with a stated `why`, per the CR-04 precedent — silently exceeding it fails the build outright (`toBeLessThanOrEqual`).
- **Treating the WR-09 fix as "raise 800 to something bigger."** Directly prohibited by the 08-05 precedent this phase is explicitly held to, and demonstrated here to be structurally unsound anyway — boot cost under even modest load (970ms) already exceeds a hypothetical 900ms/1000ms bump; there is no safe constant.
- **Building `expectedFiles`/scope-drift as a model-reported field rather than a code-computed diff.** FLOW-05 explicitly requires "machine-checkable"; a model self-report is exactly the "exhortation is not a mechanism" anti-pattern Decision 7 names.
- **A fifth artifact.** Any temptation to add a "scorecard.json" or "handoff-packet.json" as a persisted, named file rather than an in-memory/ephemeral computation risks violating FLOW-10's three-artifacts-plus-PROGRESS cap — check every new on-disk file against "does a downstream consumer read this," per Decision 1/7.
- **Assuming `pi-subagents`' absence means FLOW-09 can be stubbed with a TODO.** The requirement is explicit that the packet BUILDER and its token MEASUREMENT must be built and unit-tested now, offline; only the live spawn is deferred to `RB-09-xx`.
- **Reading `renderReviewMarkdown` as "done" for FLOW-08.** It emits four sections, but not the one FEATURES.md and this phase's own success criterion 4 need (Scope Drift) — extension required, not just reuse.

## Sources

### Primary (HIGH confidence — direct source read, this session)
- `.pi/extensions/safety/git.ts`, `policy.ts`, `index.ts`, `shell.ts` (grep) — classifier exports, evaluation order, `GUARDED_VERB_PATTERN`
- `.pi/extensions/routing/schema.ts`, `modes.ts` — `ROLES`, `ROLE_MECHANISM`, `runSingleShotRole`
- `.pi/extensions/workflows/index.ts`, `docs/WORKFLOWS.md` (full read) — `/quick` dispatch shape, evidence gate, budget rationale
- `.pi/extensions/quality/gates.ts`, `index.ts`, `reviewer.ts`, `review-schema.ts` — all named exports, `renderReviewMarkdown`'s output shape, the `submit_review` zero-parent-token pattern
- `.pi/extensions/diagnostics/call-model.ts`, `budget.ts`, `quality-cost.ts` — exports
- `.pi/agents/planner.md`, `reviewer.md` (full read) — frontmatter discipline, model-key rationale
- `.pi/extensions/plan-mode/index.ts`, `PROVENANCE.md` — vendoring header, DEVIATION numbering, the `/todos`→`/plan-todos` precedent
- `.pi/extensions/checkpoint/store.ts` (full read) — `withLock`, `recordCheckpoint`, lock degradation
- `tests/unit/checkpoint-store.test.ts` (full read, WR-09 section) — barrier mechanism, assertions
- `tests/unit/workflow-budgets.test.ts` (full read of registries + all discovery/analysis functions) — `WORKFLOW_BUDGETS`, `DIRECTORY_BUDGETS`, `importedSubsystemDirs`, `discoverWorkflowFiles`, completeness checks
- `tests/unit/contributing-boundary.test.ts`, `tool-count-baseline.test.ts`, `pinning.test.ts`, `gitignore-policy.test.ts`, `docs-policy.test.ts` — allowlist/registry contents
- `docs/RUNBOOK.md` — entry shape (RB-04-01 worked example)
- Pi 0.84.1 official docs: `docs/skills.md`, `docs/prompt-templates.md`, `docs/extensions.md`, `docs/packages.md` (installed at `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent`)
- Pi 0.84.1 `dist/core/extensions/types.d.ts` — `ExtensionCommandContext` interface
- Pi 0.84.1 `dist/core/skills.js.map` `sourcesContent` — `formatSkillsForPrompt` recovered TypeScript, lines 336-360
- Command output, this session: `npx vitest run tests/unit/workflow-budgets.test.ts` (64/64 green), a standalone re-measurement script mirroring `countRawLines`/`filesInDir`, and the WR-09 writer-child boot/write-time measurements (solo + 8/16-process simulated load)
- `.planning/phases/08-quality-gates-engineering-quality/08-05-SUMMARY.md` (full read) — the event-gating precedent

### Secondary (MEDIUM confidence)
- None used — the narrow scope of this research task meant every claim was either directly verified against source/docs/command output, or explicitly logged as an assumption.

### Tertiary (LOW confidence)
- Assumption A2 (Node IPC channel behavior on Windows for `spawn()`, not just `fork()`) — training knowledge, not re-verified this session per the no-web-research constraint. See Assumptions Log for the fallback if wrong.

## Metadata

**Confidence breakdown:**
- Phase 4/5/6/7/8 export verification: HIGH — every named export checked against real source with file:line citations; two discrepancies found and corrected (private glab tables, stale line-count narrative)
- Item 1 (sideways ratchet): HIGH — measured, not inferred; the hole's scope was narrowed with direct evidence from the test's own discovery functions
- Item 2 (WR-09): HIGH for the overlap-assertion mechanism (directly measured and reproduced the near-budget-exhaustion condition); MEDIUM for the 600-row/lock-degradation mechanism (real code path confirmed to exist, but not reproduced as an actual failure this session)
- Pi platform facts (skills/prompts/ctx): HIGH — official docs plus recovered TypeScript source, both read directly this session

**Research date:** 2026-08-15
**Valid until:** This is a fast-moving repository (Phase 8 closed the same day this research was written) — treat any line-count or "current state" claim as valid only until the next commit touches the relevant file. The architectural/mechanism claims (command-vs-prompt-template capability, `ROLES` being fixed, the ratchet's discovery-function behavior) are stable until the next phase that touches those specific modules.
