# Phase 8: Quality Gates & Engineering Quality - Research

**Researched:** 2026-08-15
**Domain:** Local-source verification of Pi 0.84.1's extension API + the seven genuinely open mechanism questions named in the task brief. Per ROADMAP.md, the comparative survey is **already done** (`.planning/research/{FEATURES,PITFALLS,ARCHITECTURE,SUMMARY}.md`) and is binding — this document does not re-survey review-theatre literature, linter ecosystems, or LLM-reviewer papers.
**Confidence:** HIGH for every claim carrying a `file:line` citation against the installed `node_modules` copies of `@earendil-works/pi-coding-agent@0.84.1` / `@earendil-works/pi-ai@0.84.1`. MEDIUM/LOW flagged inline where the answer is a recommendation rather than a verified fact.

## Summary

Seven questions were open at task-brief time. Six resolve cleanly from source. **One resolves into a real, previously-unnoticed defect in already-shipped Phase 5 code**, and it changes what GATE-10's nested half must build:

`runSingleShotRole` (`.pi/extensions/routing/modes.ts:409`) always builds `api = { reasoningEffort: plan.reasoningEffort }` — the `openai-completions` option shape — regardless of which API the resolved model actually uses. But `reviewer`/`advisor` resolve to `amazon-bedrock` (`bedrock-converse-stream` API) in `balanced` and `max` mode, and `vision` resolves there in **every** mode (`routing/schema.ts:218,258-268`). `BedrockOptions` (`pi-ai/dist/api/bedrock-converse-stream.d.ts:6-11`) has no `reasoningEffort` field at all — it reads `reasoning?: ThinkingLevel` and `thinkingBudgets?: ThinkingBudgets`. So today, on Bedrock, `reasoningEffort: "high"` is silently dropped on the floor: TypeScript accepts it (the call site's `model: Model<Api>` param widens `TApi` to the whole `Api` union, so `ModelsApiStreamOptions<Api>` is a union across every provider's option shape and `{reasoningEffort}` structurally matches the `openai-completions` member), and the existing `[FAUX]` proof (`tests/integration/single-shot-roles.test.ts`) never catches it because a faux provider reads whatever key the test script tells it to read, irrespective of which real API it stands in for. **This is exactly the class of bug GATE-10's nested half exists to catch, in code that predates this phase.** It must be fixed as part of GATE-10, not merely "proven."

The other six questions have direct, defensible answers: QUAL-01's six rules split cleanly into syntax-only (`ts.createSourceFile`, no `ts.Program`/checker) detectors with named, honest false-positive scope, and two of them (special-casing, N+1) are only partially decidable and must ship as WARNING-tier signals, never build-failing on their own. QUAL-02's "no measurable wall-clock" is provable as two separate claims — a measured wall-clock budget (the rules never build a `ts.Program`, so they are cheap relative to the `tsc --noEmit` leg already being paid for) and a structural "no model round trip" claim (a plain import-graph assertion, matching the `chokepoint-lint` precedent). The LSP probe has a real, if slightly indirect, answer: `pi.getAllTools()`/`pi.getActiveTools()` exist only on `ExtensionAPI` (available in the extension factory closure), never on `ExtensionContext` (what `ctx` is, everywhere else) — so the gate module must be handed a tool-name list by its caller, not derive it from `ctx` itself. The REVIEW.md schema question resolves in favour of a fenced-JSON-inside-Markdown hybrid, using `opts.tools` on the nested reviewer call (a `CallModelOptions.tools?: Tool[]` field already exists) rather than free-form prose parsing. The boundary-rule sweep surfaces exactly one place a new tool is plausibly required — GATE-09's advisor escalation, because the *executor* (the model) must be able to invoke it mid-turn — and that must be flagged, not silently built.

**Primary recommendation:** Build a new `.pi/extensions/quality/` subsystem (mirroring the `routing/`, `workflows/`, `providers/` shape — pure schema/predicate modules plus one thin impure dispatch layer), fix the Bedrock-shape gap in `runSingleShotRole` as GATE-10's first task (it blocks proving GATE-10 honestly), and keep every new capability at COMMAND/plain-module scope except the one advisor-consult tool GATE-09 plausibly requires.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deterministic gate runner (typecheck/lint/LSP/anti-pattern) | Local process (Node, sync/subprocess) | — | Runs before any model call; no network tier involved at all |
| QUAL-01 anti-pattern rules | Local process (TS compiler API, syntax-only) | — | Same tier as above; deliberately never touches a `ts.Program`/type checker to stay cheap |
| Reviewer (GATE-02..06) | Model tier, nested call via `callModel()` | Local process (output parser/validator) | The model produces findings; the harness (local process) validates and rejects malformed output — the boundary the requirement itself draws |
| Calibration harness (GATE-08) | Test infrastructure (`tests/`) | Model tier (drives reviewer via `fauxProvider`) | Not a runtime capability at all — it is how this phase proves the reviewer isn't theatre, and belongs beside `pinning.test.ts`/`tool-count-baseline.test.ts` |
| Advisor escalation (GATE-09) | Model tier (executor, mid-turn) → nested model tier (advisor) | Tool-registration surface | The one place a capability must be reachable **from inside the model's own turn** — see Q6 below |
| Quality-layer cost record (QUAL-09) | Local process (JSONL writer) | — | Extends the existing Phase 2 `TurnRow`/`diagnostics/turns.ts` pipeline; not a new tier |
| Root-cause/symptomatic/workaround classification (QUAL-04..06) | Model tier (reviewer's own output) | Local process (parser enforces the taxonomy is present and closed) | Same shape as the requirement verdicts — model produces, harness validates |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Recorded in PROJECT.md (Key Decisions, Constraints), ROADMAP.md, REQUIREMENTS.md, CONTRIBUTING.md and `.planning/research/{FEATURES,PITFALLS,ARCHITECTURE,SUMMARY}.md`. Binding on this phase; not to be re-derived and not to be re-litigated.

**TWO CORRECTIONS TO PROJECT-WIDE ASSUMPTIONS:**

1. **The dev machine DOES hold live credentials** — `aws sts get-caller-identity` exits 0 against long-lived static IAM **admin** keys in plaintext at `~/.aws/credentials`. Do NOT execute `[RUNBOOK]` items against these credentials; do NOT issue provider inference requests; treat every supply-chain/tool-execution decision as running next to live admin credentials.
2. **Phase 7 installed NOTHING.** `pi-subagents@0.49.0`, `@narumitw/pi-lsp@0.49.4`, `pi-web-access@0.22.0`, `pi-background-tasks@2.4.2`, `pi-session-finder@0.5.6` are pinned in `.pi/settings.json` `packages[]` and NOT INSTALLED. Build and unit-verify everything offline against `callModel()` and `fauxProvider`. Structure the LSP-diagnostics gate to degrade honestly (report `UNAVAILABLE`, never silently pass) when the extension is absent. Put anything needing the installed extensions behind an appended `RB-08-xx` entry marked OUTSTANDING. Do not plan around installing them.

**Already decided, binding:**

1. Deterministic gates run FIRST, ALWAYS, add no model round trip. "No measurable wall-clock" must be made measurable, not repeated as a claim.
2. Every model call goes through Phase 2's `callModel()` chokepoint. `tests/unit/chokepoint-lint.test.ts` makes `modelRegistry.complete` outside `diagnostics/` a build failure. Do not weaken/exempt it; no second escape hatch for the reviewer.
3. Boundary rule (BOOT-10, CONTRIBUTING.md): new capability defaults to COMMAND (0 tokens) or SKILL (~40-60 tok index). A TOOL requires answering (a) must the model call it mid-turn, (b) measured schema token cost, (c) why can't a skill carry it — in writing, plus extending `TOOL_REGISTRATION_ALLOWLIST` (currently exactly 4 entries) in the same change. Any new tool also needs a `TOOL_COUNT_BASELINE` row. Phase 10 will cut this baseline — do not inflate it here.
4. Nested-role thinking budgets (reviewer/advisor/summariser) are UNBLOCKED and must be built+proved via `fauxProvider`. Main-loop budgets stay GATED behind `RB-02-01` (OUTSTANDING) — `RB-08-xx`, append only.
5. The reviewer context contract is fixed: diff + FULL CONTENTS of every touched file + test/typecheck output (passed from the deterministic stage, not re-run) + SPEC requirements + files-touched union + the import graph.
6. Anti-review-theatre protocol is two-sided: fresh subagent context, adversarial framing with a named soft-failure list, mandatory per-requirement verdict, mandatory "checked and cleared", findings scoped to correctness/stated requirements with NITs capped, bounded loop (max 2 iterations + stall detection). Refute-or-promote applies to BLOCKERs ONLY.
7. Exhortation is explicitly NOT the mechanism. QUAL-01..09 are the enforcement, not prose in a prompt.
8. `/quick` already composes route → guard → execute → evidence → commit (Phase 6). The deterministic gate stage must be callable *from* it without breaking its ≤80-line budget (`tests/unit/workflow-budgets.test.ts`). Put gate logic in a module `/quick` calls; do not inline it.
9. Be suspicious of green — every test written here must be shown to FAIL if its subject is removed; no test may write outside the repo or a temp dir.

### Claude's Discretion

Where the deterministic gate module lives and its exact function boundary; whether the reviewer is a command, a skill, or a vendored extension (subject to the boundary rule); the exact `REVIEW.md` on-disk schema and whether it is Markdown-with-a-parser or JSON-with-a-renderer; whether the seeded-defect corpus lives in `tests/fixtures/` or a dedicated directory; the JSONL field names for QUAL-09; whether the anti-pattern rules are one module or one module per rule; how the refute-or-promote pass is sequenced (second `callModel` vs. structured second section of the same response — criterion 4 constrains QUAL-04, not GATE-06).

### Deferred Ideas (OUT OF SCOPE)

- QUAL-03 (SPEC.md Root Cause section) and QUAL-08 (gate depth scales with workflow) — Phase 9.
- `/grill`, `/plan`, `/execute`, `/review` as ceremonial workflows, and the `glab` MR step — Phase 9. Phase 8 produces the *record* and its schema only.
- Measuring/cutting per-turn token cost, `pi.setActiveTools()` profiles, dynamic tool loading, `AGENTS.md` budget — Phase 10. Do not inflate the 4-tool/1015-token baseline.
- The minimal-vs-full-harness controlled experiment (root-cause discrimination) — Phase 10, `[RUNBOOK]`.
- Statusline/subagent widget/authored theme — Phase 11.
- Any live-credential execution: main-loop thinking-budget wire proof, reviewer via a real `pi-subagents` spawn, LSP gate against a real language server, any provider inference request — each becomes `RB-08-xx`, OUTSTANDING, never claimed passed.
- Installing the five pinned specs — `RB-07-02`, already OUTSTANDING, not this phase's job.
- Resolving the unpushed-history identifier risk — `RB-07-03`, needs the user.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GATE-01 | Deterministic gates (typecheck, lint, LSP diagnostics, anti-pattern) run and feed errors back before any model review | Q1 (rule detection approach), Q2 (wall-clock proof), Q3 (LSP probe mechanism) |
| GATE-02 | Reviewer receives the fixed context contract (diff, full files, test/typecheck output, SPEC, files-touched union, import graph) | Q5 (structured output / `opts.tools`), existing `runSingleShotRole` entry point |
| GATE-03 | Per-requirement verdict (Implemented/Partial/Missing) with `file:line` | Q5 (schema design) |
| GATE-04 | Mandatory "checked and cleared" section | Q5 (schema design, validator rejects absence) |
| GATE-05 | BLOCKER/WARNING/NIT classification; unclassified findings REJECTED AS MALFORMED by code | Q5 (parse-or-generate boundary; structured tool-call output vs regex) |
| GATE-06 | Refute-or-promote pass before a BLOCKER can stop work | Q5 (schema), Q6 (sequencing is Claude's discretion per CONTEXT.md) |
| GATE-08 | Seeded-defect calibration measures reviewer catch rate | Q7 (corpus mechanics, scorer-honesty proof) |
| GATE-09 | Advisor escalation lets the executor consult a stronger model mid-turn via `callModel()` | Q6 (boundary-rule verdict — the one plausible new TOOL) |
| GATE-10 | Nested-role thinking budgets built+proved; main-loop stays gated | Q4 (the Bedrock-shape defect and its fix) |
| QUAL-01 | Six deterministic anti-pattern rule classes via TS compiler API | Q1 |
| QUAL-02 | Anti-pattern rules run inside the existing deterministic stage, no model round trip, no measurable wall-clock | Q2 |
| QUAL-04 | Reviewer classifies every change root-cause/symptomatic/workaround, as extra structure on the review pass already paid for | Q5, Q6 |
| QUAL-05 | Symptomatic/workaround changes stop the workflow pending explicit approval | Q5 (schema carries the stop signal; enforcement is the calling workflow's job, mostly Phase 9) |
| QUAL-06 | Approved workaround recorded with proper-fix rationale | Q5 (schema field) |
| QUAL-07 | Design-level review pass fires conditionally, on signals or `/escalate` | Q6 (GATE-09's advisor path is the natural carrier — same nested-call mechanism) |
| QUAL-09 | Wall-clock/token cost of the quality layer recorded per turn in JSONL | Q2's measurement mechanism feeds this field directly; CONTEXT.md's 3-edit recipe (schema.ts / turns.ts / producers) |
</phase_requirements>

## Standard Stack

### Core

No new runtime or dev dependency — `tests/unit/pinning.test.ts:253` asserts `devDependencies` is exactly six pins, and adding any lint/AST package fails the build (see CONTEXT.md's own binding decision). Everything in this phase is built from what's already pinned:

| Library | Version | Purpose | Why Standard (here) |
|---------|---------|---------|--------------|
| `typescript` | `5.9.3` (already pinned, `package.json`) | QUAL-01's six rules, syntax-only via `ts.createSourceFile` | Already a devDependency and already in the tool path via `tsc --noEmit`; zero new supply-chain surface on a machine holding live IAM admin credentials |
| `vitest` | `4.1.9` (already pinned) | Calibration harness, gate-module tests, `fauxProvider`-driven reviewer tests | Existing test runner; no new tool |
| `@earendil-works/pi-ai` peer (`typebox` `1.3.7`) | already pinned | Typing the reviewer's tool-call schema (GATE-05's structured-output shape) | Same peer every other tool schema in this repo already uses |

**Version verification:** `typescript@5.9.3` confirmed present at `node_modules/@earendil-works/pi-ai`... — actually pinned directly in this repo's own `package.json devDependencies` (unchanged from Phase 1; re-checked live in this session by reading `node_modules/@earendil-works/pi-ai/dist/types.d.ts` and `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`, both present and importable). No `npm view` was needed — nothing new is being installed.

### Supporting

No supporting packages. The whole point of QUAL-01's autonomously-decided mechanism (TS compiler API, not `ast-grep`) is that nothing new is added.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TS compiler API (syntax-only) for QUAL-01 | `ast-grep` (as REQUIREMENTS.md's literal wording names) | Fails `pinning.test.ts:253` outright; already ruled out in CONTEXT.md, not re-litigated here |
| A fenced-JSON-in-Markdown REVIEW.md | A tool-call-only structured output (`opts.tools` + forced call, no prose at all) | Considered and recommended below (Q5) — more robust than free-form Markdown a regex parses, and Pi's own `examples/extensions/structured-output.ts` demonstrates the pattern with `terminate: true` |
| A registered `consult_advisor` tool for GATE-09 | Routing GATE-09 through `/escalate` only (no tool) | `/escalate` lifts the *executor's own* model — it does not let the executor consult a *second* model mid-turn while keeping its own. The requirement's wording ("lets the executor consult a stronger model at a decision point") does not match `/escalate`'s mechanism. See Q6. |

**Installation:** None. Nothing to install.

## Package Legitimacy Audit

Not applicable — **this phase installs zero external packages.** `pinning.test.ts:253`'s exactly-six-devDependencies assertion is itself the enforcement mechanism, and it already exists. No `slopcheck`/`npm view`/registry check was run because there is nothing to check.

**Packages removed due to slopcheck `[SLOP]` verdict:** none (nothing evaluated).
**Packages flagged as suspicious `[SUS]`:** none (nothing evaluated).

## Architecture Patterns

### System Architecture Diagram

```
                 ┌──────────────────────────────────────────────────────────┐
                 │  /quick (existing, Phase 6) or a future full workflow      │
                 │  (Phase 9) — the ONLY callers of the deterministic gate    │
                 └───────────────────────┬──────────────────────────────────┘
                                          │ (1) touched-file set + diff
                                          ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │  .pi/extensions/quality/gates.ts  (pure, no ctx, no I/O   │
                 │  beyond reading the files it's handed)                    │
                 │    - typecheck leg: shells `tsc --noEmit` (subprocess,    │
                 │      already exists in CI/CONTRIBUTING.md)                │
                 │    - lint leg: this repo's own vitest-based structural    │
                 │      gates (already exist, unchanged)                    │
                 │    - LSP leg: probes `lsp_diagnostics`/`lsp_fix` presence │
                 │      via a tool-name list HANDED IN by the caller (Q3) —  │
                 │      PASS / FAIL / UNAVAILABLE, never silently PASS       │
                 │    - QUAL-01 leg: 6 syntax-only ts.createSourceFile rules │
                 └───────────────────────┬──────────────────────────────────┘
                                          │ (2) GateResult (errors, per-leg
                                          │     timing, UNAVAILABLE markers)
                                          ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │  Caller decides: errors present → feed back BEFORE any    │
                 │  model review (GATE-01's ordering). Clean → proceed.      │
                 └───────────────────────┬──────────────────────────────────┘
                                          │ (3) diff + full touched files +
                                          │     gate output + SPEC reqs +
                                          │     files-touched union + import
                                          │     graph  (GATE-02's fixed contract)
                                          ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │  runSingleShotRole(ctx, {role:"reviewer", messages,       │
                 │  systemPrompt, tools:[reviewFindingTool]})                │
                 │    → planRoleCall → guardRoute → callModel()/             │
                 │      callWithFallback()  (Phase 2 chokepoint, unchanged)  │
                 │    → GATE-10 fix: api shape now branches on               │
                 │      model.api ("openai-completions" vs                  │
                 │      "bedrock-converse-stream" vs "anthropic-messages")   │
                 └───────────────────────┬──────────────────────────────────┘
                                          │ (4) AssistantMessage carrying a
                                          │     structured tool call
                                          ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │  .pi/extensions/quality/reviewer.ts — parses/validates    │
                 │  the tool-call arguments against the REVIEW.md schema:    │
                 │    - per-requirement verdict present for every SPEC req   │
                 │    - "checked and cleared" section present (non-empty)    │
                 │    - every finding has a BLOCKER/WARNING/NIT tag,         │
                 │      unrecognized tag → REJECTED AS MALFORMED (GATE-05)   │
                 │    - every change has root-cause/symptomatic/workaround   │
                 │      (QUAL-04)                                            │
                 └───────────────────────┬──────────────────────────────────┘
                                          │ (5) if any BLOCKER present
                                          ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │  Refute-or-promote pass — ONE more nested call per        │
                 │  BLOCKER, same reviewer role, adversarial-framed prompt   │
                 │  asking it to defend or withdraw (GATE-06)                │
                 └───────────────────────┬──────────────────────────────────┘
                                          │ (6) final verdict + cost record
                                          ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │  diagnostics/turns.ts — QUAL-09's field(s) added to       │
                 │  TurnRow via the existing 3-edit recipe (schema.ts,       │
                 │  turns.ts, producers) — the quality-layer's OWN share of  │
                 │  wall-clock/tokens, not the turn total                    │
                 └──────────────────────────────────────────────────────────┘

  SEPARATE, mid-turn path (GATE-09):
                 ┌──────────────────────────────────────────────────────────┐
                 │  Executor's own turn, model-initiated                     │
                 │    → consult_advisor tool call (NEW — the one tool this   │
                 │      phase plausibly registers, see Q6)                   │
                 │    → runSingleShotRole(ctx, {role:"advisor", ...})        │
                 │    → same Phase 2 chokepoint, same GATE-10 api-shape fix  │
                 └──────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
.pi/extensions/quality/
├── gates.ts          # GATE-01, QUAL-01/02 — pure deterministic gate runner + 6 anti-pattern rules
├── reviewer.ts        # GATE-02..06, QUAL-04..06 — prompt contract, REVIEW.md schema, parser/validator
├── advisor.ts          # GATE-09 — the consult_advisor tool (if the tool route is taken, see Q6)
├── calibration.ts       # GATE-08 — pure scoring function (corpus result → catch-rate number); NOT registered with Pi at all
└── index.ts            # entry point: wires gates.ts into /quick (extends the existing command, ≤80-line budget preserved), registers advisor.ts's tool if built

tests/fixtures/seeded-defects/    # GATE-08's corpus — six real, observed failure classes (see CONTEXT.md's table), each a real git diff a temp repo can apply/revert
tests/unit/quality-gates.test.ts        # QUAL-01 rule-by-rule positive/negative tables
tests/unit/quality-schema.test.ts        # REVIEW.md schema validator: malformed-finding rejection, missing-verdict rejection, missing-"checked and cleared" rejection
tests/integration/reviewer-calibration.test.ts   # GATE-08: corpus × fauxProvider-scripted reviewer × scorer, INCLUDING the deliberately-blind-reviewer negative control (Q7)
tests/integration/gate10-nested-thinking.test.ts  # GATE-10: fauxProvider response-factory asserting outgoing api shape per model.api (the Bedrock-shape fix's own proof)
```

### Pattern 1: Pure gate runner, thin impure caller (matches `evidence.ts`/`routing/modes.ts` house style)

**What:** `gates.ts` exports pure functions taking already-read file contents / an already-resolved tool-name list, never `ctx` directly. A thin wrapper in `index.ts` (or `/quick`'s own handler) does the I/O (reading files, calling `ctx`-adjacent things) and calls the pure function.
**When to use:** Every deterministic-gate leg in this phase. Matches `evidence.ts`'s own stated discipline ("PURE EXCEPT FOR TWO CLEARLY SEPARATED IMPURE FUNCTIONS").
**Example:**
```typescript
// Source: pattern extracted from .pi/extensions/workflows/evidence.ts (existing code, this repo)
export function probeLspAvailability(activeToolNames: readonly string[]): "pass" | "unavailable" {
  const required = ["lsp_diagnostics", "lsp_fix"];
  return required.every((name) => activeToolNames.includes(name)) ? "pass" : "unavailable";
}
// Caller (inside the extension factory closure, where `pi: ExtensionAPI` is in scope):
// probeLspAvailability(pi.getAllTools().map(t => t.name))
```

### Pattern 2: Structured reviewer output via a forced tool call, not prose parsing

**What:** Give the nested reviewer call a single-purpose tool (e.g. `submit_review`) whose typebox schema IS the REVIEW.md shape (verdicts array, findings array with a closed `severity` enum, a non-empty `checkedAndCleared` string, a `classification` enum). The reviewer's structured tool-call arguments are already JSON-Schema-validated by Pi's own tool-call machinery before the harness ever sees them.
**When to use:** GATE-02..06, QUAL-04.
**Example:**
```typescript
// Source: pattern adapted from examples/extensions/structured-output.ts
// (@earendil-works/pi-coding-agent@0.84.1, installed copy, read this session)
import { Type } from "typebox";
const submitReviewTool = {
  name: "submit_review",
  description: "Submit the structured code review. This is your only way to report findings.",
  parameters: Type.Object({
    verdicts: Type.Array(Type.Object({
      requirementId: Type.String(),
      status: Type.Union([Type.Literal("Implemented"), Type.Literal("Partial"), Type.Literal("Missing")]),
      evidence: Type.String({ description: "file:line" }),
    })),
    findings: Type.Array(Type.Object({
      severity: Type.Union([Type.Literal("BLOCKER"), Type.Literal("WARNING"), Type.Literal("NIT")]),
      location: Type.String({ description: "file:line" }),
      concreteFailure: Type.String(),
      suggestedFix: Type.String(),
    })),
    checkedAndCleared: Type.String({ description: "What was examined and found fine. Never empty." }),
    classification: Type.Union([Type.Literal("root-cause"), Type.Literal("symptomatic"), Type.Literal("workaround")]),
    classificationJustification: Type.String(),
  }),
  // CallModelOptions.tools accepts this per the CallModelOptions signature already
  // stated in the task brief: `tools?: Tool[]`
};
```
Passed as `runSingleShotRole(ctx, { role: "reviewer", messages, systemPrompt, tools: [submitReviewTool] })` — note `RunSingleShotRoleOptions` in the CURRENT code (`.pi/extensions/routing/modes.ts:366-371`) has no `tools` field yet; this is a required, small extension to that interface, threading straight through to `callModel`'s existing `tools?: Tool[]` (per the task brief's own stated `CallModelOptions` shape) — not a new mechanism, an unused parameter finally being used.

### Anti-Patterns to Avoid

- **Regex-"AST" rules for QUAL-01:** Phase 4 already paid for this lesson (`git.exe push` exact-string matching). QUAL-01's rules must walk real `ts.SyntaxKind` nodes via `ts.createSourceFile`, never `String.match`.
- **Free-form Markdown REVIEW.md parsed by a hand-written regex:** fragile in exactly the way GATE-05 forbids ("LGTM" must be structurally impossible to emit, not merely discouraged). Use the forced-tool-call shape (Pattern 2) instead.
- **Assuming `.pi/settings.json` `packages[]` tells you what's installed:** it lists five packages that are pinned and NOT installed (Correction 2). The LSP probe must read observable runtime state (`pi.getAllTools()`), never the settings file.
- **Reusing `{reasoningEffort}` for every nested call regardless of `model.api`:** the exact defect this research found in already-shipped code (Q4). GATE-10 must branch on `model.api`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured, schema-validated model output | A free-text parser with regex extraction | A tool with a typebox schema, forced via `tools:[...]` on the nested `callModel()` call | Pi's own tool-call machinery already validates JSON Schema before the harness sees the arguments (`examples/extensions/structured-output.ts` is Pi's own sanctioned pattern for exactly this) |
| TS syntax walking | A hand-rolled tokenizer/regex over source text | `ts.createSourceFile` + `ts.forEachChild`/`ts.SyntaxKind` matching | Already-pinned `typescript@5.9.3` gives a real, typed AST for zero new supply-chain surface; a regex "AST" is Phase 4's `git.exe push` mistake repeating |
| Wall-clock measurement | A custom timing library | `process.hrtime.bigint()` / `Date.now()` deltas around the gate call, asserted against a stated budget in a unit test | No library needed; this is exactly what `TurnRow.latencyMs` already does elsewhere in this repo (`turn_start`+`turn_end` delta) |
| Tool-availability probing | Parsing `.pi/settings.json` or shelling `pi list` | `pi.getAllTools()` / `pi.getActiveTools()` from the `ExtensionAPI` closure | The settings file lists pinned-but-not-installed packages (Correction 2); only the runtime tool registry reflects what's actually loaded |

**Key insight:** every "don't hand-roll" item above already has a sanctioned Pi mechanism or an existing in-repo precedent. Nothing in this phase needs new machinery outside what Phase 2/5's `callModel()`/`runSingleShotRole()` already provide — it needs those mechanisms *used correctly* (the `tools` parameter, the `model.api` discriminant) rather than extended.

## Common Pitfalls

### Pitfall 1: The Bedrock reasoning-effort shape gap (GATE-10's actual job)

**What goes wrong:** `runSingleShotRole` unconditionally builds `{reasoningEffort: plan.reasoningEffort}` and hands it to `callModel()` regardless of the resolved model's `api`. On Bedrock (`bedrock-converse-stream`), the correct fields are `reasoning?: ThinkingLevel` and `thinkingBudgets?: ThinkingBudgets` — `reasoningEffort` is not read at all there.
**Why it happens:** `Model<TApi>`'s generic parameter is erased to the whole `Api` union at this call site (`plan.model: Model<Api>`, not a narrowed literal), so TypeScript's structural union-membership check accepts an object that only matches ONE member of the union (`OpenAICompletionsOptions`), and nothing catches the mismatch for the others at compile time.
**How to avoid:** Add a small pure function `buildNestedApiOptions(model: Model<Api>, effort: "high"|"max"|undefined): ModelsApiStreamOptions<Api> | undefined` that switches on `model.api` — `"openai-completions"` → `{reasoningEffort: effort}`; `"bedrock-converse-stream"` → `{reasoning: effort}`; `"anthropic-messages"` → `{thinkingEnabled: effort !== undefined, thinkingBudgetTokens: <a chosen constant per level, since anthropic-messages takes a token count not a level>}`. Call it from `runSingleShotRole` in place of the current inline ternary at `modes.ts:409`.
**Warning signs:** A `fauxProvider` test that registers its faux model under a generic id and reads `options.reasoningEffort` unconditionally will report success even when the production code would silently drop the field for a Bedrock-routed role — exactly what `tests/integration/single-shot-roles.test.ts` does today. GATE-10's own proof must register faux providers **per real `api` id** (`"bedrock-converse-stream"` as well as `"openai-completions"`) and assert the API-appropriate field name on each, or it repeats the same blind spot.

### Pitfall 2: QUAL-01's rules drowning the signal on this codebase's own style

**What goes wrong:** A naive swallowed-exception rule flags every deliberate `catch { return undefined; }` in `evidence.ts`/`safety/audit.ts` (both documented "NEVER THROWS" by design). A naive magic-number rule flags every byte-size constant already correctly named (`WIRE_ROTATE_BYTES = 32_000_000`) plus every test fixture literal. A naive N+1 rule flags the worktree tests' legitimate one-`pi.exec`-per-worktree loops (no bulk git API exists).
**Why it happens:** These six patterns are real code smells in general but this repo already follows a strict "narrowing guard"/"never throws by contract" house style that looks syntactically identical to the anti-pattern in isolation.
**How to avoid:** Each rule needs an explicit, narrow suppression mechanism — an allowlist directory (test fixtures exempt from magic-number and duplication rules), a magic comment convention for deliberate swallowed exceptions (mirroring this repo's own "NEVER THROWS (decision D-D...)" docstring style), and WARNING-tier (never build-failing alone) status for the two rules (special-casing, N+1) that are only partially decidable. See Q1 below for the full per-rule breakdown.
**Warning signs:** The rules ship and immediately produce dozens of findings on the existing 1,791-test, `tsc --noEmit`-clean codebase — a sign the rule needs narrowing, not that the codebase is suddenly full of anti-patterns.

### Pitfall 3: A calibration harness that can only ever report the reviewer's own self-assessment

**What goes wrong:** GATE-08 exists specifically because a reviewer can rubber-stamp; a calibration suite that scripts the SAME reviewer prompt/behavior for both the "should catch" and "control" cases will report a high catch rate regardless of whether the mechanism actually discriminates.
**Why it happens:** It's tempting to build the corpus and the scorer as one artifact and declare success when the number is computed at all (CONTEXT.md's own words: "the phase is complete when the number exists and is reproducible, not when the number is good").
**How to avoid:** The scorer itself needs a negative-control test: drive it with a `fauxProvider` response scripted to ALWAYS return "no concerns, all Implemented" (a deliberately blind reviewer) against the full seeded-defect corpus, and assert the reported catch rate is low (ideally 0, since none of the seeded defects would be found) — proving the scorer can report a bad number, not just a good one. See Q7.
**Warning signs:** `tests/integration/reviewer-calibration.test.ts` has no case where the scripted reviewer is deliberately wrong.

### Pitfall 4: Registering the advisor-consult capability as a command instead of a tool (or vice versa, without writing the justification)

**What goes wrong:** GATE-09's own wording ("lets the *executor* consult a stronger model at a decision point") requires the model itself, mid-turn, to trigger the consult. A command cannot be invoked by the model — `pi/src/core/system-prompt.ts` contains no reference to registered commands anywhere (CONTRIBUTING.md's own citation); commands are read solely by the interactive command list. Building GATE-09 as a command silently fails to meet the requirement's own wording; building it as a tool without writing CONTRIBUTING.md's three answers and extending the allowlist violates the boundary rule.
**How to avoid:** See Q6 below — flag this loudly, answer the three questions in writing, extend `TOOL_REGISTRATION_ALLOWLIST` (`tests/unit/contributing-boundary.test.ts:215-220`, currently 4 entries) and add a `TOOL_COUNT_BASELINE` row (`tests/unit/tool-count-baseline.test.ts:128`) in the same change.

## Code Examples

### The `CallModelOptions.tools` field, already present and unused by any current caller

```typescript
// Source: task brief's own stated shape, cross-checked against
// .pi/extensions/diagnostics/call-model.ts (496 lines, this repo)
export interface CallModelOptions<TApi extends Api> {
  role: string;
  model: Model<TApi>;
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];  // <-- exists today; no current caller in this repo sets it
  api?: WithoutCaptures<ModelsApiStreamOptions<TApi>>;
  signal?: AbortSignal;
}
```
Grep confirms no existing `.pi/extensions/` call site sets `tools` on a `callModel`/`runSingleShotRole` invocation — GATE-02's reviewer contract and GATE-09's advisor tool are this phase's first users of that field.

### `ExtensionAPI` vs `ExtensionContext` — where `getAllTools`/`getActiveTools` actually live

```typescript
// Source: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
// ExtensionContext (line 209) — what `ctx` is, EVERYWHERE (event handlers,
// command handlers via ExtensionCommandContext extends ExtensionContext at
// line 254): no getAllTools, no getActiveTools, no setActiveTools anywhere
// in this interface or its extension.

// ExtensionAPI (line 866) — the `pi` object passed ONLY to the extension
// factory function, `export default function(pi: ExtensionAPI) {...}`:
export interface ExtensionAPI {
  // ...
  getActiveTools(): string[];        // line 946
  getAllTools(): ToolInfo[];         // line 948
  setActiveTools(toolNames: string[]): void;  // line 950
  // ...
}
```
Consequence: a gate module that needs to know whether `lsp_diagnostics`/`lsp_fix` are registered cannot derive that from `ctx` inside a command handler or event hook. The tool-name list must be captured once, in the extension factory's own closure (`export default function(pi) { const activeTools = pi.getAllTools().map(t=>t.name); pi.registerCommand("quick", {...}) }`), or the pure gate function must accept the list as a parameter from a caller that has `pi` in scope.

### Bedrock's actual nested-call options shape, vs OpenAI-completions'

```typescript
// Source: node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.d.ts:1-35
export interface BedrockOptions extends StreamOptions {
  region?: string;
  profile?: string;
  toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
  reasoning?: ThinkingLevel;            // <-- NOT reasoningEffort
  thinkingBudgets?: ThinkingBudgets;    // <-- per-LEVEL map, not a single token count
  interleavedThinking?: boolean;
  thinkingDisplay?: "summarized" | "omitted";
  // ...
}

// Source: node_modules/@earendil-works/pi-ai/dist/api/openai-completions.d.ts:4-9
export interface OpenAICompletionsOptions extends StreamOptions {
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  thinkingBudgets?: ThinkingBudgets;
}

// Source: node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.d.ts:9-19
// (non-Bedrock direct Anthropic — not in this project's routing table today,
// included because it's the third member of the ModelsApiStreamOptions<Api>
// union any generically-typed nested call could theoretically hit)
export interface AnthropicMessagesOptions {
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;   // <-- singular count, not a per-level map
}
```

### `Model<TApi>.api` — the discriminant the fix needs

```typescript
// Source: node_modules/@earendil-works/pi-ai/dist/types.d.ts:661-676
export interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;              // <-- the literal to switch on
  provider: ProviderId;
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  // ...
}
```

## State of the Art

| Old Approach (as CONTEXT.md's own framing states it) | Current Approach (verified this session) | When Changed | Impact |
|--------------------------------------------------------|--------------------------------------------|---------------|--------|
| "`reasoningEffort`/`thinkingEnabled`/`thinkingBudgetTokens` have no dedicated field — they ride inside `opts.api`" (implies one shape) | Three DIFFERENT shapes exist depending on `model.api`: `{reasoningEffort}` (openai-completions), `{reasoning, thinkingBudgets}` (bedrock-converse-stream), `{thinkingEnabled, thinkingBudgetTokens}` (anthropic-messages) — found in this research session, not previously documented anywhere in this repo | This session, 2026-08-15 | GATE-10's nested half is not "thread the existing shape through and prove it" — it is "fix the shape-selection bug, then prove the fix" |
| "reviewer output is Markdown, parsed" (implicit in FEATURES.md's REVIEW.md prose description) | A forced structured tool call (typebox schema) is more robust and is a documented, sanctioned Pi pattern (`examples/extensions/structured-output.ts`) | N/A — this is a recommendation, not a Pi-version-driven change | GATE-05's "unclassified findings rejected as malformed" becomes largely free: Pi's own tool-call JSON-Schema validation already rejects a call whose `severity` isn't one of the three literals, before the harness's own validator even runs |

**Deprecated/outdated:** Nothing Pi-version-related changed this session (still 0.84.1). The one correction is internal to this repository's own Phase 5 code, not to Pi.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The reviewer should be dispatched via `runSingleShotRole(ctx, {role:"reviewer", ...})` rather than a real `pi-subagents` spawn, given Correction 2 (nothing installed) | Architecture Patterns, Summary | LOW — this is close to forced by Correction 2 and REQUIREMENTS.md's `[FAUX]` tag on every GATE-0x requirement; the alternative (a real subagent spawn) is explicitly out of scope this phase |
| A2 | `.pi/extensions/quality/` is the right new subsystem name/location | Recommended Project Structure | LOW — explicitly Claude's discretion per CONTEXT.md; any consistent naming works, `tests/unit/extension-layout.test.ts`'s structural rules (flat, one level under `.pi/extensions/`) are the only hard constraint |
| A3 | `anthropic-messages`'s `thinkingBudgetTokens` needs "a chosen constant per level" mapping, since this project's routing table never resolves a role to a raw (non-Bedrock) Anthropic model today | Pitfall 1 | LOW — dead code path today (no `anthropic-messages`-API entry in `ROLE_MAP`), included for completeness/future-proofing only; safe to defer or stub with a TODO-free explicit `throw` if a future model resolves there unexpectedly |
| A4 | The advisor-consult capability is the one place a new TOOL is justified, rather than reworking `/escalate` or building a new command | Q6, Pitfall 4 | MEDIUM — this is a reading of GATE-09's prose ("lets the executor consult... via callModel()"); if the actual intended shape is "a workflow decision, not mid-turn", the tool route would be over-scoped. Flagged loudly per the task brief's explicit instruction; the planner/user should confirm before committing the schema-cost bump |

**If this table is empty:** N/A — see above.

## Open Questions

1. **Does GATE-09's advisor tool need `terminate: false` behavior, or should it end the executor's turn like `structured_output`'s example does?**
   - What we know: `structured_output.ts`'s example uses `terminate: true` for a genuinely final answer.
   - What's unclear: an advisor CONSULT is mid-turn, not a final answer — the executor should keep working after hearing the advisor's opinion, so `terminate` should almost certainly be `false` (or omitted, Pi's default). No `ToolDefinition.execute` return-shape default was verified either way in this session.
   - Recommendation: default to no `terminate` field (i.e., normal continuation); confirm against `ToolDefinition`'s documented default in the planning phase.

2. **Does `pi.getAllTools()` reflect a package that registered but is deferred-loaded/inactive (per this project's own progressive-disclosure plans for Phase 10), or only currently-active tools?**
   - What we know: `getAllTools()` and `getActiveTools()` are documented as distinct methods (`GetAllToolsHandler` vs `GetActiveToolsHandler`), implying `getAllTools()` returns registered-but-possibly-inactive tools while `getActiveTools()` returns only the active subset.
   - What's unclear: this session did not execute either method against a real session; the distinction is read from type/doc-comment text only, not observed.
   - Recommendation: the LSP probe should use `getAllTools()` (broader — catches "registered but deferred" as still meaningfully "available"), with a unit test asserting the chosen semantics against a real (in-process, not spawned) Pi extension test harness akin to `tests/helpers/session.ts`, before relying on it.

## Environment Availability

Skipped — this phase has no external tool/service dependency beyond what's already pinned and present (`typescript@5.9.3`, `vitest@4.1.9`, both confirmed present in `node_modules/` this session). No new CLI, runtime, or service is introduced.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 |
| Config file | `vitest.config.ts` (testTimeout/hookTimeout 120_000, `pool:"forks"` default, `globalSetup`/`setupFiles` dirty-file + real-agent-dir tripwires) |
| Quick run command | `npx vitest run tests/unit` |
| Full suite command | `npx vitest run && npx tsc --noEmit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GATE-01 | Deterministic gates run before any model review, in order, feeding errors back | unit + integration | `npx vitest run tests/unit/quality-gates.test.ts tests/integration/quality-gate-order.test.ts` | ❌ Wave 0 |
| GATE-02 | Reviewer receives the full fixed contract | integration | `npx vitest run tests/integration/reviewer-contract.test.ts` | ❌ Wave 0 |
| GATE-03 | Per-requirement verdict with file:line | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "verdict"` | ❌ Wave 0 |
| GATE-04 | Mandatory "checked and cleared", non-empty | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "checked and cleared"` | ❌ Wave 0 |
| GATE-05 | Unclassified findings rejected as malformed | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "malformed"` | ❌ Wave 0 |
| GATE-06 | Refute-or-promote before a BLOCKER stops work | integration | `npx vitest run tests/integration/refute-or-promote.test.ts` | ❌ Wave 0 |
| GATE-08 | Seeded-defect calibration reports a catch rate, including a low-number negative control | integration | `npx vitest run tests/integration/reviewer-calibration.test.ts` | ❌ Wave 0 |
| GATE-09 | Executor can consult advisor mid-turn via `callModel()` | integration | `npx vitest run tests/integration/advisor-consult.test.ts` | ❌ Wave 0 |
| GATE-10 | Nested api-shape correctness per `model.api`, incl. the Bedrock-shape fix | unit + integration | `npx vitest run tests/unit/routing-dispatch.test.ts tests/integration/gate10-nested-thinking.test.ts` | Unit file exists (extend); integration file ❌ Wave 0 |
| QUAL-01 | Six anti-pattern rules, positive+negative per rule, on real repo files as a suppression/false-positive check | unit | `npx vitest run tests/unit/quality-gates.test.ts -t "QUAL-01"` | ❌ Wave 0 |
| QUAL-02 | No model round trip (structural), wall-clock under a stated budget (measured) | unit | `npx vitest run tests/unit/quality-gates.test.ts -t "QUAL-02"` | ❌ Wave 0 |
| QUAL-04 | root-cause/symptomatic/workaround present on every finding | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "classification"` | ❌ Wave 0 |
| QUAL-05 | symptomatic/workaround stops the workflow pending approval | integration | `npx vitest run tests/integration/quality-gate-order.test.ts -t "stop"` | ❌ Wave 0 |
| QUAL-06 | Approved workaround recorded with proper-fix rationale | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "workaround"` | ❌ Wave 0 |
| QUAL-07 | Design-level review fires conditionally, not on every task | unit | `npx vitest run tests/unit/quality-gates.test.ts -t "QUAL-07"` | ❌ Wave 0 |
| QUAL-09 | Quality-layer cost recorded per turn, omission rule honoured | unit + integration | `npx vitest run tests/unit/turns-composition.test.ts tests/integration/turns-log.test.ts -t "quality"` | Both files exist (extend) |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/unit`
- **Per wave merge:** `npx vitest run && npx tsc --noEmit`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/quality-gates.test.ts` — QUAL-01 (all six rules, positive+negative+suppression), QUAL-02 (wall-clock budget + no-model-round-trip structural assertion), QUAL-07 (conditional-fire predicate), GATE-01 (per-leg PASS/FAIL/UNAVAILABLE)
- [ ] `tests/unit/quality-schema.test.ts` — GATE-03/04/05, QUAL-04/06 (REVIEW.md schema validator, both directions per CONTRIBUTING.md's "every control assertion ships with the case that must fail")
- [ ] `tests/integration/reviewer-contract.test.ts` — GATE-02 (the fixed context contract actually reaches the nested call)
- [ ] `tests/integration/refute-or-promote.test.ts` — GATE-06
- [ ] `tests/integration/reviewer-calibration.test.ts` — GATE-08, INCLUDING the deliberately-blind-reviewer negative control (Pitfall 3 / Q7)
- [ ] `tests/integration/advisor-consult.test.ts` — GATE-09
- [ ] `tests/integration/gate10-nested-thinking.test.ts` — GATE-10, registering faux providers under BOTH `"openai-completions"` and `"bedrock-converse-stream"` api ids and asserting the API-appropriate field name on each (the fix's own proof; must fail against today's code before the fix, per Pitfall 1)
- [ ] `tests/fixtures/seeded-defects/` — GATE-08's corpus itself: six fixtures, one per the CONTEXT.md-specified real failure class, each a git-diff-shaped injectable defect with a known-correct "reviewer should flag this" answer
- [ ] Extend (not create) `tests/unit/routing-dispatch.test.ts` and `.pi/extensions/routing/modes.ts` — the Bedrock-shape fix itself (Pitfall 1) is a Wave 0/1 prerequisite for GATE-10, since GATE-10's proof cannot be honest against the current code
- [ ] Extend `tests/unit/contributing-boundary.test.ts` (`TOOL_REGISTRATION_ALLOWLIST`) and `tests/unit/tool-count-baseline.test.ts` (`TOOL_COUNT_BASELINE`) IF the advisor tool is built (Q6/Pitfall 4)
- [ ] Extend `tests/unit/docs-policy.test.ts` — add `PHASE_EIGHT_IDS` to `ALL_IDS` and the corresponding rows to `ENTRY_COMMANDS`, per CONTEXT.md's explicit instruction, in the same change as any `RB-08-xx` entry

## Security Domain

**Standing fact, restated because it governs every decision in this phase:** extensions execute arbitrary code with full user permissions on a machine holding live static IAM **admin** credentials in plaintext at `~/.aws/credentials` (Correction 1, `.planning/STATE.md` Blockers/Concerns, verified `aws sts get-caller-identity` exit 0 this milestone). Nothing built in Phase 8 may assume this dev machine is safe to run experimentally against; the "no credentials" premise this project's early planning used is false.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | This phase adds no auth surface |
| V3 Session Management | No | No new session state beyond the existing `globalThis`-keyed slots this repo already uses for mode/evidence-run state (same pattern GATE-08's calibration state, if any, should follow) |
| V4 Access Control | Partial | The boundary rule IS this project's access-control discipline for capability surface — see Q6. GATE-09's advisor tool, if built, is a new model-invocable surface and must be scoped as narrowly as `qoder/index.ts`'s own refusal-as-thrown-Error pattern (`.pi/extensions/qoder/client.ts`) |
| V5 Input Validation | **Yes** | The reviewer's structured tool-call output IS the input-validation surface this phase must build (GATE-05's "rejected as malformed by code"). Use typebox schemas (already the project's standard, per `qoder/index.ts`'s own 1315-byte measured schema) — never hand-rolled regex parsing of free-form model output |
| V6 Cryptography | No | No new credential/crypto surface. The reviewer's context contract (diff + full files) MAY contain secret-shaped content if a touched file happens to be sensitive — but that risk is already owned by Phase 2's `redactDeep`/`redactString` (`.pi/extensions/diagnostics/redact.ts`), which the reviewer's context-building step must reuse, never re-implement (see Don't Hand-Roll precedent already established project-wide) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A reviewer's tool-call arguments contain a `file:line` citation string built from model-authored text (not tool-verified), reused elsewhere as if it were ground truth | Tampering / Spoofing | GATE-03's `file:line` field is EVIDENCE THE MODEL WROTE, not a verified fact — never treat it as equivalent to `evidence.ts`'s `tool_result`-derived evidence. State this distinction explicitly in the reviewer schema's own documentation, mirroring `docs/WORKFLOWS.md`'s own "what an ACCEPT verdict does NOT guarantee" discipline |
| The advisor-consult tool becomes a second, uncoordinated route to a model that bypasses the diagnostics chokepoint if built carelessly (e.g., a hand-rolled fetch instead of `runSingleShotRole`) | Elevation of Privilege / Repudiation | `tests/unit/chokepoint-lint.test.ts` already build-fails any `modelRegistry.complete` outside `diagnostics/` — the advisor tool's `execute()` must call `runSingleShotRole`/`callModel`, never construct its own provider call. This is enforced today by the existing lint; no new control needed, only correct usage |
| A quality-layer JSONL field (QUAL-09) silently reports `0` for a cost/latency that was never measured, fabricating a measurement | Tampering (data integrity) | The omission rule already documented in `docs/DIAGNOSTICS.md` ("a ratio of nothing is not zero") applies identically to whatever field(s) QUAL-09 adds — omit, never zero-fill |
| A seeded-defect fixture (GATE-08's corpus) accidentally ships as REAL code rather than a test-only injectable diff, introducing an actual vulnerability class (e.g., the "swallowed exception" or "TODO shipped as fix" defect classes are, by construction, things this project's own QUAL-01 rule would need to detect) into `.pi/extensions/` proper | Tampering | Corpus fixtures live under `tests/fixtures/seeded-defects/` and are applied to a `tests/helpers/git.ts` `makeTempRepo()` — never applied to this repository's own working tree. QUAL-01's own rules must exempt `tests/fixtures/**` from their own scan (Pitfall 2 / the TODO-rule cross-reference), or the corpus becomes un-shippable |

## Sources

### Primary (HIGH confidence — file:line citations against installed packages, this session)

- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — `ExtensionContext` (line 209), `ExtensionCommandContext` (254), `ExtensionAPI` incl. `getActiveTools`/`getAllTools`/`setActiveTools` (866-950), `ToolInfo` (1142), `GetActiveToolsHandler`/`GetAllToolsHandler` (1140-1145)
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/structured-output.ts` — the sanctioned forced-tool-call structured-output pattern (`terminate: true`, typebox schema)
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts` — `Api`/`KnownApi` (15-16), `ThinkingLevel`/`ThinkingBudgets` (23-36), `Model<TApi>` incl. `.api` field (661-676)
- `node_modules/@earendil-works/pi-ai/dist/models.d.ts` — `ModelsApiStreamOptions<TApi>` (45), `ApiStreamOptions<TApi>` conditional-distributes-over-union (`types.d.ts:179`)
- `node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.d.ts` — `BedrockOptions` (1-35): `reasoning`, `thinkingBudgets`, no `reasoningEffort`
- `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.d.ts` — `OpenAICompletionsOptions` (4-9): `reasoningEffort`, no `reasoning`
- `node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.d.ts` — `thinkingEnabled`/`thinkingBudgetTokens` (9-19)
- `.pi/extensions/routing/modes.ts:409` — the exact line building `{reasoningEffort}` unconditionally
- `.pi/extensions/routing/schema.ts:218,246-271` — `ROLE_MAP` showing reviewer/advisor resolve to `amazon-bedrock` in balanced/max, vision in every mode
- `tests/integration/single-shot-roles.test.ts:269,274,513,536,542` — the existing `[FAUX]` proof, confirmed to script `reasoningEffort` generically without per-api-shape discrimination
- `tests/unit/contributing-boundary.test.ts:215-220` — current `TOOL_REGISTRATION_ALLOWLIST` (4 entries)
- `tests/unit/tool-count-baseline.test.ts:128-140` — `TOOL_COUNT_BASELINE` shape and existing rows
- `tests/unit/docs-policy.test.ts:142-151` — `PHASE_SEVEN_IDS`/`ALL_IDS` pattern this phase must extend with `PHASE_EIGHT_IDS`
- `.pi/extensions/workflows/evidence.ts` (full file) — the pure-predicate/thin-impure-caller house style this phase's `gates.ts` should follow
- `tests/helpers/git.ts:64,85,100,121,144,164` — `makeTempRepo`/`commitFile`/`headSha` exports available for GATE-08's corpus mechanics
- `CONTRIBUTING.md:39-57` — the boundary rule's exact three questions and the allowlist-extension requirement
- `docs/DIAGNOSTICS.md` (full file) — the omission rule, the TurnRow field-addition 3-edit recipe, the reasoning-key closed-door precedent QUAL-09 must respect
- `docs/WORKFLOWS.md` (full file) — `/quick`'s exact dispatch shape and line-budget discipline the deterministic gate module must compose into without inlining
- `.planning/phases/08-quality-gates-engineering-quality/08-CONTEXT.md` (full file) — the binding spec for this phase
- `.planning/REQUIREMENTS.md` (GATE-*/QUAL-* blocks) — exact requirement wording
- `.planning/ROADMAP.md` (Phase 8 section) — success criteria, `[RUNBOOK]` split
- `.planning/STATE.md` (Blockers/Concerns, Standing Operating Policy) — Corrections 1/2, autonomous-run policy
- `.planning/research/FEATURES.md:185-248` — the prescriptive REVIEW.md schema and reviewer input contract this phase implements from
- `.planning/research/PITFALLS.md:694-712` (Pitfall 20) — review-theatre framing, already binding, not re-derived

### Secondary (MEDIUM confidence)

- None — every claim in this document either carries a direct file:line citation or is explicitly logged in the Assumptions Log above.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nothing new is installed; the constraint (`pinning.test.ts:253`) was read directly, not inferred
- Architecture: HIGH for the Bedrock-shape defect (direct source citation, cross-checked against the existing test that fails to catch it); MEDIUM for the recommended `.pi/extensions/quality/` layout (Claude's discretion per CONTEXT.md, no single correct answer)
- Pitfalls: HIGH for Pitfall 1 (verified defect with citations); MEDIUM for Pitfalls 2-4 (reasoned from this codebase's documented style and the requirement's own wording, not independently executed)

**Research date:** 2026-08-15
**Valid until:** 30 days (no external ecosystem dependency to go stale; the one thing that could invalidate this document is a Pi version bump changing `ExtensionAPI`/`ModelsApiStreamOptions` shapes — re-verify against `dist/**/*.d.ts` before planning if `@earendil-works/pi-coding-agent`'s pinned version changes)

## RESEARCH COMPLETE

**Phase:** 8 - Quality Gates & Engineering Quality
**Confidence:** HIGH

### Key Findings

- **A real, previously-undocumented defect exists in already-shipped Phase 5 code**: `runSingleShotRole` (`.pi/extensions/routing/modes.ts:409`) always sends the OpenAI-completions `{reasoningEffort}` shape, but `reviewer`/`advisor`/`vision` resolve to Bedrock (`bedrock-converse-stream`, fields `reasoning`/`thinkingBudgets`) in balanced/max mode and every mode respectively — thinking is silently never enabled there today, and the existing `[FAUX]` test doesn't catch it because faux providers don't enforce real API option shapes. GATE-10's nested half must fix this, not merely prove the existing code.
- QUAL-01's six rule classes split into four reliably syntax-only detectors (magic numbers, duplication, swallowed exceptions, shipped TODO/FIXME — all provable via `ts.createSourceFile`, no type checker) and two only-partially-decidable ones (special-casing, N+1) that must ship as WARNING-tier signals with explicit suppression mechanisms, or they will drown this codebase's own deliberate "never-throws-by-contract" and "one-`pi.exec`-per-worktree" style with false positives.
- The LSP-availability probe's correct API is `pi.getAllTools()`/`pi.getActiveTools()`, but those exist ONLY on `ExtensionAPI` (the factory-function closure), never on `ExtensionContext` (`ctx`, everywhere else) — the gate module must be handed the tool-name list by a caller with `pi` in scope, not derive it from `ctx`.
- GATE-05's "unclassified findings rejected as malformed by code" is best satisfied by a forced structured tool call (typebox schema, Pi's own sanctioned `examples/extensions/structured-output.ts` pattern) rather than free-form Markdown parsed by regex — `CallModelOptions.tools?: Tool[]` already exists and is unused by any current caller.
- The boundary-rule sweep surfaces exactly one plausible new TOOL requirement: GATE-09's advisor escalation, because the executor (the model) must invoke it mid-turn, which neither a command nor a skill can do. Flagged per the task brief's explicit instruction — the planner/user should confirm this reading before the schema-cost bump (4→5 tools) is committed.

### File Created

`.planning/phases/08-quality-gates-engineering-quality/08-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Nothing new installed; the no-new-dependency constraint read directly from `pinning.test.ts:253` |
| Architecture | HIGH (defect), MEDIUM (layout) | The Bedrock-shape gap is a direct, cross-checked source citation; the recommended module layout is explicitly Claude's discretion |
| Pitfalls | HIGH (Pitfall 1), MEDIUM (Pitfalls 2-4) | Pitfall 1 is a verified code defect; the others are reasoned from this repo's documented conventions, not independently executed |

### Open Questions

- Whether `pi.getAllTools()` includes deferred/inactive-but-registered tools or only active ones (affects the LSP probe's exact semantics; not executed this session — see Open Questions above).
- Whether GATE-09's advisor tool should set `terminate` at all (likely no, since it's mid-turn consultation, not a final answer — no default behavior was verified against `ToolDefinition`'s actual runtime default).

### Ready for Planning

Research complete. The planner should treat the Bedrock-shape fix (Pitfall 1) as a Wave 0/1 prerequisite task for GATE-10 — every other GATE-10 proof depends on it being fixed first, or the proof itself repeats today's blind spot. The planner should also explicitly decide (and record, per CONTRIBUTING.md's three written answers) whether GATE-09 gets a new tool, given the baseline-inflation caution in CONTEXT.md's own binding decisions.
