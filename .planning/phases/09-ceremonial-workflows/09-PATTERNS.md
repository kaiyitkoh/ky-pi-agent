# Phase 9: Ceremonial Workflows - Pattern Map

**Mapped:** 2026-08-15
**Files analyzed:** 33 (18 new production files/dirs, 6 extended production files, 10 new test files, 5 extended test/doc files — some rows below group several files under one shape)
**Analogs found:** 30 / 33 direct; 1 NEW SHAPE (skill body — no in-repo precedent); 2 covered by the same directory-level analog as a sibling row

All line numbers below were read directly this session; none are copied from RESEARCH.md without independent verification against the file. Where RESEARCH.md's own re-measurement differs from a stale docstring inside the source (e.g. `workflows/index.ts`), the re-measured figure is what is cited here.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `.pi/extensions/grill/index.ts` | command (thin) | request-response (interactive loop) | `.pi/extensions/workflows/index.ts:1-98` | exact |
| `.pi/extensions/plan-ceremony/index.ts` (name at planner's discretion — must not collide with `plan-mode`) | command (thin) | request-response | `.pi/extensions/workflows/index.ts:1-98` | exact |
| `.pi/extensions/execute/index.ts` | command (thin) | request-response + batch (per-task dispatch) | `.pi/extensions/workflows/index.ts:1-98` | exact |
| `.pi/extensions/review/index.ts` | command (thin) | request-response | `.pi/extensions/workflows/index.ts:1-98` | exact |
| ambiguity-scorecard predicate (e.g. `.pi/extensions/grill/scorecard.ts`) | utility (pure predicate) | transform | `.pi/extensions/workflows/evidence.ts:165-231` (`gateCompletion`) | exact |
| §2 evidence-gate predicate (e.g. `.pi/extensions/grill/evidence-gate.ts`) | utility (pure predicate) | transform | `.pi/extensions/workflows/evidence.ts:165-231` (`gateCompletion`) | exact |
| §4 `IF/THEN` + Root Cause parser (e.g. `.pi/extensions/grill/spec-schema.ts`) | utility (pure parser/validator) | transform | `.pi/extensions/quality/review-schema.ts:319-508` (`validateReview`) | exact |
| task-form + coverage-matrix parser (e.g. `.pi/extensions/plan-ceremony/plan-schema.ts`) | utility (pure parser/validator) | transform | `.pi/extensions/quality/review-schema.ts:319-508` (`validateReview`) | exact |
| expected-files scope-drift checker (e.g. `.pi/extensions/review/scope-drift.ts`) | utility (pure predicate) | transform | `.pi/extensions/workflows/evidence.ts:165-231` (`gateCompletion`) | exact |
| QUAL-08 gate-depth selector (extends `quality/gates.ts` or a sibling pure fn) | utility (pure selector) | transform | `.pi/extensions/quality/gates.ts:417-425` (`shouldRunDesignReview`) | exact |
| subagent-availability probe (e.g. `.pi/extensions/execute/handoff.ts`) | utility (pure predicate) | transform | `.pi/extensions/quality/gates.ts:163-175` (`probeLspAvailability`) | exact |
| handoff-packet builder (same file as above) | utility (pure builder) | transform | `.pi/extensions/quality/reviewer.ts:228+` (`buildReviewerContext`) | role-match |
| SPEC.md / PLAN.md renderer (e.g. `.pi/extensions/grill/spec-schema.ts#renderSpecMarkdown`) | utility (pure renderer) | transform | `.pi/extensions/quality/review-schema.ts:526-579` (`renderReviewMarkdown`) | exact |
| REVIEW.md Scope Drift section (extends `renderReviewMarkdown`) | utility (pure renderer, extended) | transform | `.pi/extensions/quality/review-schema.ts:526-579` | exact |
| `.pi/extensions/safety/git.ts` — `mr create` rule + `classifyGlabInvocation` signature change | utility (pure classifier, extended) | transform | `.pi/extensions/safety/git.ts:449-466` (`classifyGlabInvocation`) + `:254-259` (`GitSubcommandRule`) | exact (same file, same function) |
| `.pi/extensions/plan-mode/index.ts` — rename `"plan"` → `"plan-mode"` | command (vendored, edited) | request-response | `.pi/extensions/plan-mode/index.ts:39-53` (the `/todos`→`/plan-todos` precedent, same file) | exact |
| `.pi/skills/grill/SKILL.md` | skill (procedure body) | — | NEW SHAPE — see below | none in-repo; bundled Pi example only |
| `.pi/skills/plan-ceremony/SKILL.md` | skill (procedure body) | — | NEW SHAPE — see below | none in-repo |
| `.pi/skills/review/SKILL.md` | skill (procedure body) | — | NEW SHAPE — see below | none in-repo |
| handoff agent file (e.g. `.pi/agents/executor-handoff.md`) | agent file | — | `.pi/agents/planner.md` (67 lines, full read) / `.pi/agents/reviewer.md` (42 lines, full read) | exact |
| `.gitignore` — add `.pi/work/` | config | — | existing `.gitignore` entries (pattern only, not a code file) | exact |
| `docs/RUNBOOK.md` — append `RB-09-xx` | doc | — | `docs/RUNBOOK.md:860-914` (`RB-04-01` worked example) | exact |
| `docs/SAFETY.md` — derived limits table | doc (generated, not hand-edited) | — | existing table + `docs-policy.test.ts`'s derivation mechanism | exact |
| a new `docs/*.md` page for the ceremonial workflows (per analog #15's instruction) | doc | — | `docs/WORKFLOWS.md` (Phase 6's `/quick` doc) | exact |
| `tests/unit/grill-scorecard.test.ts` | test (unit) | transform | `tests/unit/git-policy.test.ts` (table-driven predicate test) | role-match |
| `tests/unit/grill-evidence-gate.test.ts` | test (unit) | transform | `tests/unit/evidence-gate.test.ts` (implied sibling of `evidence.ts`, same predicate shape) | role-match |
| `tests/unit/spec-error-behaviour.test.ts` | test (unit) | transform | test file for `review-schema.ts#validateReview` (table-driven malformed-input rejection) | role-match |
| `tests/unit/scope-drift.test.ts` + `tests/integration/scope-drift.test.ts` | test (unit + integration) | transform / real-git-diff | `tests/helpers/git.ts` + `tests/integration/quick-workflow.test.ts:69-80` (temp-repo consumer) | exact |
| `tests/unit/plan-task-form.test.ts` | test (unit) | transform | `review-schema.ts` validator test shape | role-match |
| `tests/integration/execute-workflow.test.ts` | test (integration, real temp git repo) | CRUD (commit) | `tests/integration/quick-workflow.test.ts` (full file) | exact |
| `tests/unit/review-render.test.ts` | test (unit) | transform | `review-schema.ts` renderer test shape | role-match |
| `tests/integration/review-mr.test.ts` | test (integration, stubbed `glab`) | request-response | `tests/helpers/stub-bin.ts` + a `gh`/`glab`-stubbing consumer | exact |
| `tests/unit/handoff-packet.test.ts` | test (unit) | transform | `gates.ts` `probeLspAvailability` test shape | role-match |
| `tests/unit/artifact-count.test.ts` | test (unit, temp-dir filesystem) | file-I/O | `tests/helpers/git.ts#makeTempRepo` pattern | role-match |
| `tests/unit/gate-depth-selector.test.ts` | test (unit) | transform | `quality/gates.ts` `shouldRunDesignReview` test (both-directions assertion) | exact |
| `tests/unit/git-policy.test.ts`, `tests/unit/policy-compose.test.ts`, `tests/fixtures/evasion-corpus.ts` (extend) | test (unit, table-driven) | transform | same files, existing `glab mr merge` rows (`git-policy.test.ts:601-604`, `evasion-corpus.ts:336-338`) | exact — extend, don't duplicate |
| `tests/unit/workflow-budgets.test.ts` (extend: `RESOURCE_EDGES`, `WORKFLOW_TEXT_BUDGETS`, new registry rows) | test (unit, registry) | transform | same file, `WORKFLOW_BUDGETS` (`:101-221`) / `DIRECTORY_BUDGETS` (`:232-459`) | exact |
| `tests/unit/gitignore-policy.test.ts` (extend) | test (unit) | transform | same file, `MUST_BE_IGNORED` (`:38-` ) | exact |
| `tests/unit/docs-policy.test.ts` (extend: `PHASE_NINE_IDS`, `ALL_IDS`, `ENTRY_COMMANDS`) | test (unit, doc↔code derivation) | transform | same file, `PHASE_EIGHT_IDS`/`ALL_IDS` (`:165-176`), `ENTRY_COMMANDS` (`:339+`, `RB-08-*` rows `:509-514`) | exact |
| `tests/unit/checkpoint-store.test.ts` — WR-09 rewrite | test (integration-style, event-gated concurrency) | event-driven | `tests/helpers/qoder-loopback.ts:76-79,132-136,187,195,419-435` (`firstChunkWritten`/`releaseSecondChunk`) via `tests/integration/qoder-delegate.test.ts:133-152,510-560` | exact |

---

## Pattern Assignments

### Group A — Thin commands: `/grill`, `/plan`, `/execute`, `/review`

**Analog:** `.pi/extensions/workflows/index.ts` (99 raw lines, re-measured this session; RESEARCH.md's Pitfall 2 — do not trust the stale "96" narrative in that file's own `WORKFLOW_BUDGETS` `why` string)

**Extension-factory + registerCommand shape** (`workflows/index.ts:18-20`):
```typescript
export default function (pi: ExtensionAPI): void {
	pi.registerCommand("quick", {
		description: "Route, guard, arm evidence, and hand a trivial task to the ordinary prompt loop",
		handler: async (args, ctx) => {
```
Copy: the `export default function (pi: ExtensionAPI): void` factory shape, `pi.registerCommand(name, {description, handler: async (args, ctx) => {...}})`. `ctx` here is `ExtensionCommandContext` — only commands get `waitForIdle`/`fork`/`newSession`/`navigateTree`/`switchSession`/`reload` (Pi 0.84.1 `dist/core/extensions/types.d.ts:254-290`, verified read this session), which `/plan`'s and `/execute`'s multi-turn flows will need and a tool never could.

**Order-is-the-claim dispatch discipline** (`workflows/index.ts:22-63`, the whole handler body): route → guard (reuse `classifyGitInvocation`) → arm (`startRun`) → hand off. Every one of the four new commands should read as one visible top-to-bottom sequence with the same discipline: pre-flight check (SPEC.md exists for `/plan`; PLAN.md exists for `/execute`; REVIEW.md doesn't yet for `/review`) → gate → act.

**Git pre-flight reuse** (`workflows/index.ts:36-40`):
```typescript
const verdict = classifyGitInvocation(
	{ subcommand: "commit", args: [] },
	{ currentBranch: currentBranch(ctx.cwd), protectedBranches: PROTECTED_BRANCHES },
);
if (verdict.kind === "block") return void ctx.ui.notify(verdict.reason, "error");
```
Every one of the four commands needs an equivalent not-on-`main` check before doing anything — copy this exact call shape, not a re-derived one (Correction 3 / CLAUDE.md "Never build a second set of controls").

**Header discipline** (`workflows/index.ts:1-9`): "This header is deliberately short... Terseness here IS the FLOW-01 budget being honoured, not an oversight." Given the new `WORKFLOW_TEXT_BUDGETS` ceilings (`/grill` ≤250, `/plan` ≤200, `/execute` ≤250, `/review` ≤250 — RESEARCH.md Item 1(d)), the same discipline is load-bearing: push rationale into the doc page and the skill body, not the command file's own header.

**What must differ:**
- `/plan`, `/execute`, `/review` are **multi-turn** across separate invocations against the same `.pi/work/<slug>/` state, unlike `/quick`'s single-shot `sendUserMessage`. The state carried between invocations is filesystem state (SPEC.md/PLAN.md existing on disk), not a `globalThis`-keyed run buffer like `evidence.ts`'s `RUN_STATE_KEY` — do not copy the `globalThis` state-slot pattern for cross-command state; that pattern exists specifically for `/quick`'s single-turn evidence buffer that must survive `tool_execution_end`/`agent_end` handlers within one turn.
- None of the four commands register a tool. `/quick` doesn't either — this is not a deviation, it's confirmation the analog is right.
- `/grill`'s interrogation loop hands work to the **ordinary prompt loop** (`pi.sendUserMessage`, `workflows/index.ts:60`), never a nested `call-model` role — RESEARCH.md's Architectural Responsibility Map and Alternatives Considered table are explicit that `ROLES` is fixed (`routing/schema.ts:104-109`) and inventing a seventh role is out of scope.

**Registry moves in the same commit:**
- New `WORKFLOW_BUDGETS` row per command file (`.pi/extensions/grill/index.ts`, `.pi/extensions/plan-ceremony/index.ts`, `.pi/extensions/execute/index.ts`, `.pi/extensions/review/index.ts`), each with a measured-line-count `why` in the exact prose style of `workflow-budgets.test.ts:101-221` (state what grew, cite the plan, `toBe(Math.ceil(actual/10)*10)`).
- New `DIRECTORY_BUDGETS` row per new subsystem directory (`.pi/extensions/grill`, `.pi/extensions/plan-ceremony`, `.pi/extensions/execute`, `.pi/extensions/review`), same prose discipline as `workflow-budgets.test.ts:232-244`.
- New `WORKFLOW_TEXT_BUDGETS` rows (RESEARCH.md Item 1(d)) binding each command file to its declared skill/prompt bodies, ceilings 250/200/250/250 as specified.

---

### Group B — Pure predicates with a documented binding order

**Analog:** `.pi/extensions/workflows/evidence.ts:165-231` (`gateCompletion`) — the six-branch, first-match-wins predicate the prompt names explicitly.

**Signature + doc-comment shape to copy** (`evidence.ts:101-165`, docstring, and `:165-171`, signature):
```typescript
export function gateCompletion(
	records: readonly EvidenceRecord[],
	headSha: string,
	baseSha: string,
	headTree: string,
	baseTree: string,
): EvidenceVerdict {
	if (records.length === 0) {
		return { ok: false, reason: "no structured tool result was recorded..." };
	}
	if (headSha === baseSha) {
		return { ok: false, reason: `no commit was made during this run...` };
	}
	// ... numbered branches, each reject reason built FROM the data, never a caller string
```
Copy: (1) the numbered docstring stating BRANCH ORDER IS BINDING and explaining *why* each branch sits where it does, not just what it does; (2) a two-arm discriminated return type (`{ok:true,...} | {ok:false,reason:string}`), never three arms, never a boolean; (3) reject reasons built from the received data, never a caller-supplied string; (4) the closing "WHAT THIS PREDICATE DOES NOT, AND CANNOT, PROVE" paragraph — every new predicate in this phase needs an equivalent honesty statement about its own limits.

**Three concrete uses in this phase:**
1. **Ambiguity scorecard** — `score ≤ 0.20` AND every per-dimension floor met, else block. First-match-wins over "score too high" vs "floor N unmet", with the reject reason naming which dimension.
2. **§2 evidence-gate** (FLOW-03) — SPEC.md's Verified Codebase Facts table non-empty AND every row has a `file:line`/command-output evidence string, else block writing §3. Directly mirrors `gateCompletion`'s "no record at all → reject" / "record present but doesn't support the claim → reject" shape.
3. **Expected-files scope-drift checker** (FLOW-05) — `git diff --name-only` output vs the declared expected-files array; anything outside the union is flagged. **This one is impure at its boundary** (shells `git diff`) exactly the way `evidence.ts` itself is "PURE EXCEPT FOR TWO CLEARLY SEPARATED IMPURE FUNCTIONS" (`writeEvidenceRow`, `pruneEvidenceLogs`, stated in the module docstring `:29-32`) — keep the diff-shelling function isolated and the drift *comparison* itself pure over two string arrays, injected.

**What must differ:** none of these three touches `globalThis` run state — `gateCompletion` is pure data-in/data-out; only `evidence.ts`'s *module* additionally owns impure run-state accessors that this phase's predicates do not need.

**Registry moves:** whichever file each predicate lands in gets its own `WORKFLOW_BUDGETS`/`WORKFLOW_TEXT_BUDGETS` row (see Group A).

---

### Group C — Parsers that REJECT malformed input as code, not wording

**Analog:** `.pi/extensions/quality/review-schema.ts:319-508` (`validateReview`) — the numbered, binding-order rejection predicate, and its sibling `submitReviewParameters`/`ReviewValidation` types (`:107-146`, `:212-218`).

**The discriminated-union + numbered-branch shape to copy** (`review-schema.ts:212-218`, `:319-326`):
```typescript
export type ReviewValidation =
	| { readonly ok: true; readonly review: ReviewArtifact }
	| { readonly ok: false; readonly reason: string };
// ...
export function validateReview(raw: unknown, expectedRequirementIds: readonly string[]): ReviewValidation {
	// (1)
	if (!isPlainObject(raw)) {
		return { ok: false, reason: `submit_review arguments must be an object, received ${describeType(raw)} (${describeValue(raw)})` };
	}
```
Copy verbatim in spirit for FLOW-04's `IF/THEN` parser, FLOW-06's task-form parser, and QUAL-03's Root Cause gate:
- The three helper functions `isPlainObject`, `describeType`, `describeValue` (`:223-256`) — every reject reason states what type/shape arrived, never invents a generic message.
- The **both-directions coverage check** pattern (`:368-402`, branches (3)/(3b)): missing ids AND invented/duplicated ids are both rejects. FLOW-06's coverage matrix ("every Rn maps to ≥1 task" AND "no task references an unmapped Rn") is the identical shape.
- The **regex-anchored shape check** (`:220-221`, `FILE_LINE_PATTERN = /^.+:\d+$/`, applied at `:404-417`) — FLOW-04's `IF <condition> THEN THE SYSTEM SHALL <response>` and FLOW-06's `T### [P] [R#] verb <path> + verification command` are both this: one named, anchored regex constant, tested against every candidate line, reject naming the offending line and what arrived.
- The **conditional-required-field** pattern (`:447-464`, branch (7): `classification === "workaround"` requires `properFix` AND `deferralReason`) — QUAL-03's "Root Cause section required only for fix-framed changes" is the identical conditional-requirement shape.
- The **normalise-only-in-the-accept-branch** discipline (`:475-507`, branch (9)) — a validated artifact is only ever constructed inside the accept arm; there is no other constructor.

**What must differ:** `review-schema.ts` is explicitly "PURE... makes no model call, reads no file, and registers nothing with Pi" (`:19-22`) — the new parsers are the same, but their *input* is markdown text the model wrote to a file (SPEC.md/PLAN.md draft), not a tool-call's typed arguments object. The malformed-input surface is therefore string/regex parsing of markdown sections rather than `typeof`/`isPlainObject` checks on a JS object — the discipline (numbered branches, binding order, reasons built from received data) carries over exactly; the mechanics of "what counts as malformed" do not.

**Registry moves:** same file's `WORKFLOW_BUDGETS`/`WORKFLOW_TEXT_BUDGETS` rows; if a parser lands inside `quality/` instead of a phase-9 subsystem (unlikely, but the discretion note allows "whether the expected-files drift check lives in a new module or extends `quality/`"), the `quality/` `DIRECTORY_BUDGETS` row has only **2 lines of headroom today** (3748/3750, RESEARCH.md Item 1(c)) — any addition there needs an explicit raise in the same commit.

---

### Group D — Markdown renderers for an artifact

**Analog:** `.pi/extensions/quality/review-schema.ts:526-579` (`renderReviewMarkdown`).

**Shape to copy** (`:526-535`):
```typescript
export function renderReviewMarkdown(review: ReviewArtifact): string {
	const lines: string[] = [];
	lines.push("# REVIEW");
	lines.push("");
	lines.push("## Verdicts");
	lines.push("");
	lines.push("| Requirement | Status | Evidence |");
	lines.push("| --- | --- | --- |");
	for (const verdict of review.verdicts) {
		lines.push(`| ${verdict.requirementId} | ${verdict.status} | ${verdict.evidence} |`);
	}
```
Copy: `string[]` accumulator joined with `"\n"` at the end (`:578`, `return lines.join("\n")`); one `push` block per artifact section with a blank-line separator; table sections rendered as literal markdown pipe tables (not a templating library — there is none, per the zero-new-dependency constraint); a trailing disclaimer paragraph stating what the rendered claims do and do not prove (`:568-576`) — SPEC.md's Verified Codebase Facts table and PLAN.md's coverage matrix both need an equivalent "this is the model's claim, evidence column is what was actually checked" caveat.

**Only ever called on already-validated data** (`:519-524` docstring: "Only ever called with a `ReviewArtifact` that already came out of `validateReview`'s accept arm — there is no independent shape validation here"). Every new renderer (SPEC.md, PLAN.md, and REVIEW.md's new Scope Drift section) must have the identical one-way dependency: parse-and-validate (Group C) happens first and produces a typed artifact; the renderer never re-validates.

**The Scope Drift extension specifically:** `ReviewArtifact` (`:175-185`) has no scope-drift field today and `renderReviewMarkdown` emits exactly four sections (Verdicts, Findings, Checked and cleared, Classification) — confirmed by direct read, not RESEARCH.md's claim alone. Add a new optional field to `ReviewArtifact`, a new `## Scope Drift` `lines.push` block following the exact same accumulator style, and thread it from FLOW-05's checker (Group B) as a value computed by code, never by the reviewer's own `submit_review` call — RESEARCH.md's Pitfall 5 names this exact trap.

**Registry moves:** `quality/review-schema.ts` extension counts against `quality/`'s `DIRECTORY_BUDGETS` row (2 lines of headroom today) — raise required.

---

### Group E — Honest-degradation availability probe

**Analog:** `.pi/extensions/quality/gates.ts:163-175` (`probeLspAvailability`).

```typescript
const LSP_TOOL_NAMES = ["lsp_diagnostics", "lsp_fix"] as const;

export function probeLspAvailability(registeredToolNames: readonly string[]): LegStatus {
	const missing = LSP_TOOL_NAMES.filter((name) => !registeredToolNames.includes(name));
	if (missing.length > 0) {
		return {
			status: "unavailable",
			reason: `missing tool${missing.length > 1 ? "s" : ""} ${missing.join(", ")} — @narumitw/pi-lsp is pinned in ` +
				"settings but not installed (RB-07-02); the live check that would exercise it once installed is RB-08-02",
		};
	}
	return { status: "pass" };
}
```
Copy exactly: (1) a named constant array of the tool names to probe for (`tools/tool-count-baseline.test.ts:132` confirms `pi-subagents` registers `subagent`, `subagent_wait`, `subagent_supervisor`, `intercom`); (2) `missing.length > 0` reported as `"unavailable"`, **never `"pass"`**; (3) the reason string names the pinned-but-not-installed package and its runbook id, exactly as this reason cites `RB-07-02`/`RB-08-02` — the new probe cites `RB-07-02` (pi-subagents not installed) and the new `RB-09-xx` OUTSTANDING id for the live spawn; (4) the module docstring's explicit rule (`gates.ts:17-33`) that this check NEVER reads `.pi/settings.json` (which reports what is *configured*, not what is *loaded*) — read only the live `registeredToolNames` list a caller supplies, exactly the same non-negotiable rule for the subagent probe.

**Three-state type, not boolean** (`gates.ts:111-120`, `LegStatus`): copy the three-arm discriminated union (`pass`/`fail`/`unavailable`) if the handoff-packet probe needs richer states than a boolean; at minimum, never collapse "did not run/is not installed" into either "available" or "unavailable-and-therefore-blocking" — RESEARCH.md's Correction 2 states this explicitly: "An absent subagent layer that reports 'delegated' is Phase 4's headless-guard failure in a new costume."

**What must differ:** the LSP probe has no *builder* half — it only answers "is this usable." FLOW-09 additionally needs a **packet builder** (pure, taking SPEC excerpt + §2 facts + path + verify command and producing the self-contained handoff text) and a **measurement** against `diagnostics/budget.ts#estimateTokensFromChars`/`computeBudget` (`diagnostics/budget.ts:223-225`, confirmed `Math.ceil(chars/4)`). The builder's closest analog is `quality/reviewer.ts#buildReviewerContext` (role-match, not exact — that function assembles a reviewer's six-part contract from live objects; the handoff builder assembles a smaller four-part packet from SPEC/PLAN artifacts already on disk) rather than `probeLspAvailability` itself.

**Registry moves:** wherever this lands (`execute/` per the recommended structure), new `WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS`/`WORKFLOW_TEXT_BUDGETS` rows, per Group A.

---

### Group F — Zero-parent-token structured output (only if `/grill`'s scorecard needs model self-assessment)

**Analog:** `.pi/extensions/quality/review-schema.ts:77,89-98,107-146` (tool name + description + typebox schema) and `.pi/extensions/quality/reviewer.ts:373-420` (the call site).

```typescript
// review-schema.ts:77
export const SUBMIT_REVIEW_TOOL_NAME = "submit_review";
// review-schema.ts:107-146 -- Type.Object with StringEnum, never Type.Union/Type.Literal
export const submitReviewParameters = Type.Object({
	verdicts: Type.Array(Type.Object({
		requirementId: Type.String({ description: "..." }),
		status: StringEnum(["Implemented", "Partial", "Missing"], { description: "..." }),
		evidence: Type.String({ description: "..." }),
	})),
	// ...
});
```
```typescript
// reviewer.ts:376-398 -- the call site: per-call tools array, never pi.registerTool
const tools: Tool[] = [{ name: SUBMIT_REVIEW_TOOL_NAME, description: SUBMIT_REVIEW_DESCRIPTION, parameters: submitReviewParameters }];
const message: AssistantMessage = await runSingleShotRole(ctx, {
	role: "reviewer", systemPrompt: REVIEWER_SYSTEM_PROMPT, messages, need: {}, tools,
});
```
```typescript
// reviewer.ts:402-419 -- absence of the tool call is a REJECT, prose is never accepted
const toolCall = message.content.find((block) => block.type === "toolCall" && block.name === SUBMIT_REVIEW_TOOL_NAME);
if (toolCall === undefined) {
	return { ok: false, reason: `runReview: the reviewer returned no "${SUBMIT_REVIEW_TOOL_NAME}" tool call -- prose was returned instead...` };
}
```
**This is THE escape hatch named in CONTEXT.md decision 4 and CLAUDE.md's boundary rule** — a tool definition built inline, passed per-call to `callModel`'s (here: `runSingleShotRole`'s) `tools?: Tool[]` field, **never** `pi.registerTool`'d. `TOOL_REGISTRATION_ALLOWLIST` (`tests/unit/contributing-boundary.test.ts:257`) stays at exactly five entries as long as this pattern is used instead of a real registration.

**Only use this if the ambiguity scorecard genuinely needs model self-assessment** — CONTEXT.md decision 7 ("exhortation is not a mechanism") and RESEARCH.md's Architectural Responsibility Map both push toward the scorecard being a **pure code computation** over model-supplied facts (Group B), not a nested structured-output call. If the planner decides the model must self-rate ambiguity dimensions, this pattern is the only sanctioned way to collect that structured input.

**What must differ:** `runSingleShotRole` only serves the four `call-model` roles (`reviewer`/`advisor`/`vision`/`summariser`) — it **throws** for `executor`/`planner` roles (`routing/schema.ts:136-147`, `routing/modes.ts:531-536`, confirmed by RESEARCH.md's Verified Codebase Facts). Any nested call in this phase must use one of the four existing roles, most plausibly `advisor` for a `/grill` second-opinion, never a new role.

---

### Group G — Agent file (handoff packet)

**Analogs:** `.pi/agents/reviewer.md` (full read, 42 lines) and `.pi/agents/planner.md` (full read, 67 lines).

**Frontmatter key set (both files, byte-identical set):**
```yaml
---
name: reviewer
description: Adversarial code reviewer -- fresh context, never the implementer's own reasoning; findings scoped to correctness and stated requirements; reports via submit_review only.
tools: read, grep, find, ls
thinking: high
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
---
```
Copy exactly: `name`, `description` (one dense sentence stating role + constraint + output contract), `tools` (explicit allowlist — never omitted), `thinking: high`, `systemPromptMode: replace`, `inheritProjectContext: false`, `inheritSkills: false`. **`model:` and `fallbackModels:` are deliberately absent from both files** — copy that omission, not an oversight to fix.

**The trailing HTML-comment rationale, quoted verbatim from `reviewer.md:27-41`:**
```markdown
<!--
Deliberately no `model:` key in this file's frontmatter, for the identical reason `.pi/agents/planner.md` states:

`pi-subagents@0.49.0 src/agents/agents.ts:1155` reads:

    if (override.model !== undefined && !agentHasFrontmatterField(agent, "model")) {

A settings-level `subagents.agentOverrides` entry (`.pi/extensions/routing/agent-overrides.ts`, ROUTE-05) only fills in a model when the agent's OWN frontmatter has none. If this file ever gains a `model:` line, every `/cheap`, `/balanced`, `/max` and `/escalate` switch stops affecting the reviewer -- its pin becomes permanent and silent.

`fallbackModels:` is withheld for the identical reason.

HONEST STATUS, RECORDED SO IT IS NOT OVERCLAIMED: this phase (08) dispatches the reviewer via `runSingleShotRole` in `.pi/extensions/quality/reviewer.ts` -- `ROLE_MECHANISM.reviewer === "call-model"` -- which never touches `.pi/agents/*.md` or the subagent machinery at all. `AGENT_NAME_BY_ROLE` does not map "reviewer" to this file, and nothing in this repository loads it at runtime today. This file exists for the eventual REAL-subagent path, tracked as `RB-08-03`, OUTSTANDING.
-->
```
The new handoff agent file needs the **same three-part comment shape**: (1) the `model:`/`fallbackModels:` omission rationale, quoted or closely paraphrased; (2) an HONEST STATUS paragraph stating plainly that `pi-subagents` is pinned-not-installed (Correction 2) and this file is exercised **only** by the offline packet-builder unit tests today, never a real dispatch; (3) the live-spawn runbook id (`RB-09-xx`, OUTSTANDING).

**What must differ:** `reviewer.md`'s closing paragraph also asserts prompt-body byte-identity with a production constant (`REVIEWER_SYSTEM_PROMPT` in `reviewer.ts`) enforced by `tests/integration/reviewer-contract.test.ts`. The handoff agent file has no equivalent production constant to stay in sync with (FLOW-09's packet content is built fresh per task, not a fixed system prompt) — omit that specific sub-claim, but keep the "this file is not the live path yet" honesty.

**Registry moves:** `.pi/agents/*.md` is **confirmed by direct grep this session (0 matches for `.pi/agents` in `workflow-budgets.test.ts`) to be scanned by NO glob** in `discoverWorkflowFiles()` (`WORKFLOWS_DIR`/`PROMPTS_DIR`/`SKILLS_DIR`/`EXTENSIONS_DIR` only). This is exactly Item 1(a)'s "genuinely open" hole — the new agent file MUST be added to the new `RESOURCE_EDGES` registry (workflow → `.pi/` paths it loads by name) and covered by the new completeness scanner, or it is invisible to every budget in this repository.

---

### Group H — Skill body (`.pi/skills/*/SKILL.md`)

**NO IN-REPO ANALOG EXISTS.** Confirmed: `.pi/skills/` and `.pi/prompts/` are `.gitkeep`-only (`ls .pi/skills .pi/prompts` this session returns nothing but the directories themselves); `package.json`'s `pi.skills`/`pi.prompts` arrays already declare the paths as resource roots (no extra registration needed — RESEARCH.md's Verified Codebase Facts, confirmed by direct read of `package.json:14-22`). **This is Phase 9's genuinely new shape.** Marked NEW-SHAPE per this task's own instruction not to invent an analog where none exists.

**Nearest available reference (external, not this repo):** Pi 0.84.1's own bundled example, `examples/extensions/dynamic-resources/SKILL.md` (full file, 8 lines, read this session at `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\examples\extensions\dynamic-resources\SKILL.md`):
```markdown
---
name: dynamic-resources
description: Example skill loaded from resources_discover
---

# Dynamic Resources Skill

This skill is provided by the dynamic-resources extension.
```
This is a minimal structural example only — two frontmatter keys (`name`, `description`) and a body — not a procedural-content precedent; it proves the file format compiles and loads, nothing about how a ~150–250-line procedure should be organized. `docs/skills.md`'s own "Skill Structure" section (read this session) documents the fuller shape a real skill may take:
```
my-skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/               # Helper scripts
├── references/            # Detailed docs loaded on-demand
└── assets/
```
Per the Agent Skills specification `docs/skills.md` cites, frontmatter is exactly `name`/`description` (required); "Unknown frontmatter fields are ignored."

**Blast-radius note (why this is genuinely new, not merely unread):**
1. **No test currently exercises a real skill body's content** in this repo — only its *existence and line count* (`workflow-budgets.test.ts`'s `discoverWorkflowFiles()`/completeness check, which is closed per Item 1(a) above). Nothing today asserts what a skill body must *say*.
2. **`scripts/`/`references/`/`assets/` subdirectory files are a confirmed-open hole** (Item 1(a), second bullet: `walkOnDisk` finds them, `discoverWorkflowFiles()`'s `.endsWith(".md")` filter drops them, so they carry zero budget today). If any of the three new skills uses a non-`.md` asset, that file needs a `RESOURCE_EDGES` entry, or it is exactly the offloading hole this phase exists to close.
3. **Table-shaped content over prose is the load-bearing move for staying under `WORKFLOW_TEXT_BUDGETS`** (RESEARCH.md Item 1(d) analysis: the ambiguity-dimension floors, rotating-perspective list and task-form grammar should each be a markdown table, following the *only* in-repo precedent for this specific "compress into a table to respect a budget" move — `plan-mode/read-only.ts`'s own allowlist table, cited at `workflow-budgets.test.ts:328-334` as "compressing it into cleverness to satisfy a line budget is the wrong trade," i.e. the precedent is "use a table because it's the RIGHT shape for this content," not "compress to cheat the counter." Tables still count fully — raw lines, no stripping (D-1).

**Registry moves:** every discovered `.md` skill file automatically requires a `WORKFLOW_BUDGETS` row (enforced by the existing completeness check, `workflow-budgets.test.ts:1027-1040` — do not add a second mechanism for this, per Pitfall 3) plus a `WORKFLOW_TEXT_BUDGETS` row summing it with its command file.

---

### Group I — Extending a safety classifier (`glab mr create`)

**Analog:** `.pi/extensions/safety/git.ts:428-466` (`GLAB_BLOCKED_SUBCOMMANDS`, `GLAB_READ_SUBCOMMANDS`, `classifyGlabInvocation`) and `:254-259` (`GitSubcommandRule` — the same interface, reused, not redefined).

**The `GitSubcommandRule` shape** (`git.ts:254-259`):
```typescript
interface GitSubcommandRule {
	readonly subcommand: string;
	readonly matches: (args: readonly string[]) => boolean;
	readonly why: string;
}
```

**Current tables and classifier** (`git.ts:428-466`, full read):
```typescript
const GLAB_BLOCKED_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{ subcommand: "mr", matches: (args) => args[0] === "merge", why: "an MR merge is the deploy trigger in the user's work repo (CONTEXT.md decision 13)" },
];
const GLAB_READ_SUBCOMMANDS: readonly GitSubcommandRule[] = [
	{ subcommand: "mr", matches: (args) => args[0] === "list" || args[0] === "view", why: "read-only MR inspection" },
	{ subcommand: "ci", matches: (args) => args[0] === "status", why: "read-only pipeline status" },
];

export function classifyGlabInvocation(invocation: GitInvocation): GitVerdict {
	const display = `glab ${invocation.subcommand}${invocation.args.length > 0 ? ` ${invocation.args.join(" ")}` : ""}`;
	const blockRule = GLAB_BLOCKED_SUBCOMMANDS.find((r) => r.subcommand === invocation.subcommand);
	if (blockRule !== undefined && blockRule.matches(invocation.args)) {
		return { kind: "block", reason: `"${display}": ${blockRule.why}` };
	}
	const readRule = GLAB_READ_SUBCOMMANDS.find((r) => r.subcommand === invocation.subcommand);
	if (readRule !== undefined && readRule.matches(invocation.args)) {
		return { kind: "allow" };
	}
	return { kind: "block", reason: `"${display}" is an unclassified glab form -- defaults to block (fail closed, same posture as git)` };
}
```
**Pitfall confirmed, verified this session:** `GLAB_BLOCKED_SUBCOMMANDS`/`GLAB_READ_SUBCOMMANDS` are module-private `const`s (no `export` keyword, confirmed by read) — a new module must add its rule **inside `git.ts` itself**, editing these tables in place, never importing them from outside. `classifyGlabInvocation` is the only exported surface.

**What must differ (the new rule, not a block/read table match, needs a conditional-allow shape neither table expresses today):**
```typescript
{
	subcommand: "mr",
	matches: (args) => {
		if (args[0] !== "create") return false;
		const idx = args.findIndex((a) => a === "--target-branch" || a === "-b");
		if (idx === -1 || args[idx + 1] === undefined) return false; // no target -> GitLab defaults to main -> BLOCK
		const target = args[idx + 1];
		return !protectedBranches.some((b) => b.toLowerCase() === target.toLowerCase());
	},
	why: "mr create is allowed ONLY with an explicit --target-branch that is not protected -- GitLab defaults an omitted target to the project default branch (main), so silence is the deploy trigger",
}
```
This is a **signature change**: `classifyGlabInvocation` today takes no facts argument at all (`git.ts:449`, confirmed), but the `mr create` rule needs `PROTECTED_BRANCHES` (exported from `safety/index.ts:140`, confirmed by grep) to check the *target*. RESEARCH.md's Open Question 1 recommends threading a new, narrower `protectedBranches` parameter — **not** the existing `GitPolicyFacts` type (which also carries `currentBranch`, since `classifyGlabInvocation`'s own module docstring `git.ts:76-79` argues glab's danger is branch-*independent* — the target-branch check is about the *destination*, a genuinely different fact, and both docstrings must state that distinction explicitly rather than silently contradict each other).

**One call site to update:** `.pi/extensions/safety/policy.ts:360-362`:
```typescript
} else if (executable === "glab") {
	strongest = strongerOf(strongest, fromGitVerdict(classifyGlabInvocation(toGitInvocation(invocation))));
}
```

**Registry/test moves in the same commit (all confirmed live files):**
- `tests/fixtures/evasion-corpus.ts` — new allow/block rows for `mr create` (existing `mr merge` block row precedent at `:601-604`, unconditional-block precedent for the `.exe` evasion form at `:336-338`).
- `docs/SAFETY.md`'s derived limits table — **regenerated from the corpus, never hand-edited** (`docs-policy.test.ts`'s `truncationCauseCount()`-style derivation mechanism).
- `tests/unit/git-policy.test.ts` — extend the `Row` table (`:50-59` shape: `{command, rest, kind, currentBranch, expected, why}`), reusing the existing `facts()` helper (`:37-41`) if `classifyGlabInvocation`'s signature grows a facts parameter.
- `tests/unit/policy-compose.test.ts` — the evaluation-order suite, since the call site's signature changes.
- `.pi/extensions/safety` `DIRECTORY_BUDGETS` row — **5 lines of headroom today (4455/4460, RESEARCH.md Item 1(c), confirmed)**, and this edit (a new rule table entry plus a signature-change ripple into `policy.ts`) will very plausibly exceed it. The raise must be in the same commit, with a `why` naming the `mr create` predicate and the `protectedBranches`-threading change, following the CR-04 grandfathering precedent already used elsewhere in this registry (`workflow-budgets.test.ts:112-115`).

---

### Group J — The `/plan` command rename (a forced composition conflict, already precedented once)

**Analog:** `.pi/extensions/plan-mode/index.ts` itself — the `/todos` → `/plan-todos` rename this phase must repeat for `/plan` → `/plan-mode`.

Confirmed live: `.pi/extensions/plan-mode/index.ts:273` registers `"plan"` today (grep-confirmed). The vendoring header's numbered `DEVIATION` list tops out at `DEVIATION 5` (grep-confirmed, `plan-mode/index.ts:119,148`) — the new deviation is **6**.

**What must move in the same commit** (every location independently confirmed present, not merely asserted by RESEARCH.md):
- `.pi/extensions/plan-mode/index.ts:273` — `registerCommand("plan", ...)` → `registerCommand("plan-mode", ...)`.
- `.pi/extensions/plan-mode/index.ts`'s vendoring header (top of file) — append DEVIATION 6, following the exact prose shape of the existing five.
- `.pi/extensions/plan-mode/PROVENANCE.md:61` — numbered deviations list.
- `tests/unit/plan-mode-read-only.test.ts:373` — `commands.get("plan")` → `commands.get("plan-mode")`.
- `tests/unit/workflow-budgets.test.ts:193-211` — the `WORKFLOW_BUDGETS` entry's own `why` string currently says "registers /plan and /plan-todos"; update the prose, and note the file's measured-534-of-540 headroom (6 lines) may be consumed by the deviation-6 comment, forcing a raise in the same commit.
- `docs/EXTENSIONS.md:120` — table row, adjacent to but not literally naming `/plan`.
- **NOT** `.pi/extensions/plan-mode/index.ts:203` (`pi.registerFlag("plan", ...)`) — a structurally separate FLAG namespace, no collision, confirmed by grep; do not touch it.
- **NOT** `.pi/extensions/safety/infra.ts:305` (`"plan"` in `TERRAFORM_ALLOW_SUBCOMMANDS`) — unrelated `terraform plan`, confirmed by grep.

---

### Group K — Tests

#### K1. A test that uses a real temp git repo

**Analogs:** `tests/helpers/git.ts` (full file, 175 lines) — `makeTempRepo(prefix)` (`:121-136`), `commitFile(repo, name, body, message)` (`:144-157`), `headSha(repo)` (`:164-174`), `repoRoot()` (`:64-76`), `isIgnored(path)` (`:85-91`), `trackedFiles(pattern)` (`:100-109`). Best consumer: `tests/integration/quick-workflow.test.ts` (module docstring `:1-68` read in full — states exactly what a walking-skeleton integration test must prove and NOT re-prove).

**What to copy:**
- `makeTempRepo` always creates the repo on a branch named `work` — **never `main`/`master`** — "so no fixture built on top of it depends on this machine's `init.defaultBranch` setting" (`git.ts:112-115`). FLOW-05's/FLOW-07's/FLOW-08's temp-repo tests must do the same.
- Every setup call is individually asserted to succeed, throwing the exact failing argv on a non-zero exit (`git.ts:129-134`) — never a silent half-initialised temp dir.
- `commitFile` never trusts `git commit`'s own stdout; it reads back via `headSha` (`git.ts:141-142` docstring: "never trusted from `git commit`'s own stdout, which this module's header rule says is never parsed").
- `quick-workflow.test.ts`'s own docstring structure (`:1-68`) — "WHAT THIS FILE PROVES, AND WHAT IT DOES NOT" — is the right shape for `execute-workflow.test.ts` and `scope-drift.test.ts`'s integration halves: name the exact cases, then explicitly state what is deliberately NOT re-proven here (e.g. `gateCompletion`'s own predicate table lives in a unit test, not here).
- Decision D-14's pattern (`quick-workflow.test.ts:51-56`): a refusal must cost **zero provider requests** — `faux.state.callCount === 0` after a refusal. Applies directly to `/plan`'s and `/execute`'s pre-flight refusals.

**What must differ:** `git.ts`'s helpers operate on **this repository's own** `repoRoot()` for `isIgnored`/`trackedFiles` (used by `gitignore-policy.test.ts`) but `makeTempRepo` is fully repo-independent — FLOW-05/07/08's tests need `makeTempRepo`, not `repoRoot`.

#### K2. A test that stubs a binary on PATH

**Analog:** `tests/helpers/stub-bin.ts` (full file, 251 lines).

**Constraints load-bearing here** (module docstring, full read):
- **Synchronous by contract** (`:169-171`, `withStubBin<T>(stubs, fn: (env) => T): T`): "`fn` must be SYNCHRONOUS. The temp directory is removed in a `finally`, so an async `fn` would still be running when its stubs vanish — returning a thenable is therefore rejected loudly rather than left to fail at random" (`:205-211` throws a `TypeError` if `fn` returns a thenable). **`review-mr.test.ts` must drive the stubbed `glab` call synchronously inside the callback**, awaiting any promise it needs *before* calling into `withStubBin`, or restructuring so the `glab` invocation itself is the synchronous `spawnSync` call.
- `StubResponse`/`StubSpec`'s argv-conditional `match` array (`:56-111`) — "a single static stdout cannot model a multi-subcommand tool." `glab mr create` vs `glab mr merge` vs `glab ci status` all need distinct `when: [...]` matches in one stub spec, exactly as the module's own npm example illustrates.
- Windows executability discipline (`:20-48`): `.mjs` payload + POSIX launcher + `.cmd` shim, three files per stub — copy `withStubBin`'s own generation code path verbatim; do not hand-roll a second stub generator.
- `runWithStubBin` (`:227-251`) is the convenience wrapper for a single command — use it directly for `review-mr.test.ts`'s `glab mr create` cases rather than calling `withStubBin` + `spawnSync` inline.

**What must differ:** the module's own known-limitation note (`:34-47`) — on Windows, Pi's own internal `spawnSync("gh", [...])` calls run with no shell, so a stub can only ever drive Pi down the FAILURE branch through Pi itself. **This applies to `glab` too if `/review` shells `glab` the same way Pi shells `gh`.** If `/review`'s own `glab mr create` invocation goes through `safety/git.ts`'s guarded bash path (a model-issued `bash` tool call), the stub is reachable normally (the guarded-bash path already runs through a shell per its own docstring); if `/review` calls `glab` directly via a harness-side `pi.exec`/`spawnSync`, check whether that call site passes `shell: true` before assuming a simulated **success** is reachable on Windows.

#### K3. A test that asserts on the OUTGOING provider request

**Analog:** `tests/helpers/faux.ts` (module docstring + `FixturePayloadBuilder` type, `:83-116` read) — factory-form response steps. Best consumer for this phase's shape: `tests/integration/quick-workflow.test.ts` (uses `fauxAssistantMessage`/`fauxText`/`fauxToolCall`, imported `:73`).

**What to copy:** `faux.ts`'s own stated rule (`:33-38`): "Every capture test MUST assert its capture list is non-empty BEFORE asserting anything about its contents... Without the first assertion the second one never runs and the test passes having verified nothing." Any test asserting on what `/grill`'s nested advisor call (if built, per Group F) actually sent needs this two-step assertion, not a single `toMatchObject`.

**What must differ:** `faux.ts` exists specifically because `fauxProvider()`'s stream **never fires `before_provider_request`** — confirmed executed this session per the file's own citation (`:9-24`). If Phase 9 needs to assert on a nested `runSingleShotRole` call's outgoing payload (e.g. proving the handoff packet is genuinely self-contained and does NOT smuggle the whole SPEC), the response step must be the **factory form** `(context, options, state, model) => AssistantMessage`, which receives `context` directly and can assert on it inline, rather than trying to make `before_provider_request` fire.

#### K4. Registry-style gate test with a `why` string and a rounding assertion

**Analog:** `tests/unit/workflow-budgets.test.ts` — `WORKFLOW_BUDGETS` (`:101-221`, full section read) / `DIRECTORY_BUDGETS` (`:232-` +, partial read, first 70 lines of ~230). See Groups A/D/G/I above for the specific rows this phase must add. Entry shape and the `why` prose style are fully quoted above — do not deviate from it (state the plan/finding that caused the growth, the previous figure, the newly measured figure, `rounded up to the next ten`).

**The two mandatory `it.each` assertions** (confirmed by read at `:605-613`/`:615-640` and their `DIRECTORY_BUDGETS` mirrors): `actual <= budget`, AND `budget === Math.ceil(actual/10)*10` — the second is `toBe`, not `toBeLessThan`, so a file that **shrinks** also forces an edit; there is no such thing as "leave extra headroom, it's harmless."

**New registries this phase adds, same file, same idiom (not a new file — RESEARCH.md Open Question 2's recommendation, confirmed sound: `importedSubsystemDirs`, the import-edge half, already lives entirely inside this test file, not production code, so the resource-edge half should too):**
```typescript
const WORKFLOW_TEXT_BUDGETS: readonly { name: string; commandFile: string; bodies: readonly string[]; budget: number; why: string }[] = [
	{ name: "grill", commandFile: ".pi/extensions/grill/index.ts", bodies: [".pi/skills/grill/SKILL.md"], budget: 250, why: "..." },
	// plan (≤200), execute (≤250), review (≤250), quick (≤100, unchanged)
];
const RESOURCE_EDGES: readonly { workflow: string; paths: readonly string[] }[] = [
	// workflow -> every .pi/ path it loads by name: .pi/agents/*.md, non-.md skill assets, pi.exec script paths
];
```
Plus a completeness scanner mirroring `importedSubsystemDirs`' own regex discipline (`:716-746`, fixed-point BFS) — falsify it exactly as `importedSubsystemDirs` itself would be falsified: plant a fixture file reachable only by the new edge kind, confirm the scanner catches it (RESEARCH.md's Known Threat Patterns table, row 4, names this exact falsification requirement).

#### K5. A doc↔code two-directional derivation test

**Analog:** `tests/unit/docs-policy.test.ts` — `PHASE_EIGHT_IDS`/`ALL_IDS` (`:165-176`, full read) and `ENTRY_COMMANDS`'s `RB-08-*` rows (`:509-514`, full read).

```typescript
const PHASE_EIGHT_IDS = ["RB-08-01", "RB-08-02", "RB-08-03"] as const;
const ALL_IDS = [
	...PHASE_ONE_IDS, ...PHASE_TWO_IDS, ...PHASE_THREE_IDS, ...PHASE_FOUR_IDS,
	...PHASE_FIVE_IDS, ...PHASE_SEVEN_IDS, ...PHASE_EIGHT_IDS,
] as const;
```
```typescript
"RB-08-02": ["git checkout -- <file>"],
"RB-08-03": [
	'echo "RB-08-03 live catch rate: <caught>/<total>, $(date -u +%FT%TZ)" >> RB-08-03-RESULT.md',
],
```
Copy exactly: add `PHASE_NINE_IDS = ["RB-09-xx", ...] as const`, splice it into `ALL_IDS` in phase order (append only — never reorder or renumber prior phases, confirmed by the module's own comment at `:31-34`), and add each id's real one-line command(s) to `ENTRY_COMMANDS` in the same change — "adding five `ENTRY_COMMANDS` rows was the entire [change]" (`:34`, the module's own description of how a prior phase closed this).

**The `RUNBOOK.md` worked example to copy** (`docs/RUNBOOK.md:860-914`, full section read, `RB-04-01`):
```markdown
| ID | Check | Status |
|----|-------|--------|
| RB-04-01 | SAFE-01 — a push to a protected GitLab branch is rejected server-side | OUTSTANDING |

### RB-04-01 — SAFE-01: a push to a protected GitLab branch is rejected server-side

**Status:** OUTSTANDING

**Why this cannot be done here.** ...
**Procedure, on the work laptop.** ...
**Expected output.** ...
**Offline proxy:** ...
```
Both the summary-table row AND the `### RB-XX-YY` subsection's `**Status:**` line must agree — `docs-policy.test.ts` reports `INCONSISTENT` (never an acceptable status) if they diverge, confirmed by the test file's own fixture at `:837-850` (`INCONSISTENT` fixture, deliberately constructed with the two places disagreeing).

**What must differ:** `RB-04-01`'s content is GitLab-server-specific; `RB-09-xx`'s content is the end-to-end `/grill → /plan → /execute → /review` ship plus the real `pi-subagents` spawn — write the "Why this cannot be done here" paragraph around Correction 1 (live static IAM admin credentials) and Correction 2 (pinned-not-installed packages), not GitLab access.

#### K6. An event-gated concurrency test (the exact template for the WR-09 fix)

**Analog:** `tests/helpers/qoder-loopback.ts:76-79,132-136,187,195,415-435` (the `firstChunkWritten`/`releaseSecondChunk` deferred-promise gate) via its consumer `tests/integration/qoder-delegate.test.ts:133-152` (`runDelegate`) and `:510-560` (the inactivity-timeout case, which releases the SAME gate after its own assertion).

**The gate-plumbing shape to copy** (`qoder-delegate.test.ts:133-152`):
```typescript
async function runDelegate(...) {
	const { loop, config } = ...;
	// want a genuine two-write arrival. Release the gate as soon as the
	// first chunk lands, so a caller that never inspects mid-stream state
	// (delegateTask cannot hang waiting on a gate nobody else would open)
	void loop.firstChunkWritten.then(() => {
		loop.releaseSecondChunk();
	});
	const folded = await delegateTask({ config, task: DELEGATED_TASK_TEXT, cwd });
	...
}
```
```typescript
// qoder-loopback.ts:419-435 (the producer side)
const firstChunkWrittenGate = createDeferred<void>();
const releaseSecondChunk = (): void => { /* resolves a second deferred, idempotent past-the-end */ };
```
**This is the exact template for the `checkpoint-store.test.ts` WR-09 rewrite** (RESEARCH.md Item 2's own recommendation, confirmed against the real current code at `checkpoint-store.test.ts:217-274`, full read this session):

**Current, confirmed-broken shape** (`checkpoint-store.test.ts:227-263`):
```typescript
const startAt = Number(startAtRaw);
const wait = startAt - Date.now();
if (wait > 0) { await new Promise((r) => setTimeout(r, wait)); }
const startedAt = Date.now();
// ... 150 recordCheckpoint calls ...
const finishedAt = Date.now();
```
```typescript
const startAt = Date.now() + 800; // <- the wall-clock margin to DELETE
const reports = await Promise.all(tags.map((tag) => runWriter(script, [root, tag, "150", String(startAt)])));
expect(latestStart, "...").toBeLessThan(earliestFinish); // <- the timing comparison to REPLACE
```
**The rewrite, following `qoder-loopback.ts`'s event-gate pattern exactly:**
1. Spawn each child with an `"ipc"` stdio slot: `spawn(process.execPath, [script, ...args], {stdio: ["ignore","pipe","pipe","ipc"], timeout: 120_000})` — the existing `timeout: 120_000` (`checkpoint-store.test.ts:169`) stays; it is a real bound, not a margin, and the recommendation explicitly keeps it.
2. Each child sends `process.send({type:"ready"})` immediately after its `import()` resolves (the exact point that today reads `Date.now()`), then blocks on `await new Promise((resolve) => process.once("message", resolve))`.
3. The parent collects all four `"ready"` messages (mirroring `Promise.all([loop.firstChunkWritten, ...])`-style gating) before sending each child `child.send("go")`.
4. **Delete `startAt`/the `wait`/`if (wait > 0)` block outright** — `grep -c "startAt" tests/unit/checkpoint-store.test.ts` must return `0` (or only inside a comment explaining the removal), per RESEARCH.md's own stated acceptance grep.
5. **Strengthen the overlap proof from a timestamp comparison to a structural one** — after all 600 rows are recorded, compute "tag switches" in `readCheckpoints(root)`'s resulting row-order sequence and assert genuine interleaving (a count exceeding a small threshold), replacing `expect(latestStart).toBeLessThan(earliestFinish)` with a property the STORE itself produced, not a `Date.now()` delta the test measured.

**Explicitly PROHIBITED, grep-checkable exactly as for the 08-05 precedent this fix is held to** (RESEARCH.md, quoted verbatim): `retry` · a wider bound · raising `testTimeout` (already 120s) · `it.skip` · `fileParallelism: false`.

**What must differ:** `qoder-loopback.ts`'s gate is an HTTP-server-internal `Promise`/`createDeferred()` pair inside one process (server and client both run in the test's own process, gated via a local promise) — the checkpoint-store fix gates across **separate OS processes** via Node's child IPC channel, which is the mechanism difference RESEARCH.md's own Assumption A2 flags as LOW-MEDIUM confidence (not re-verified against official docs this session, per the no-web-research constraint) with a stated filesystem-sentinel fallback if IPC behaves unexpectedly on Windows `spawn()` targeting a Node child.

---

## Shared Patterns

### Chokepoint hygiene (applies to every new production file)
**Source:** `.pi/extensions/quality/gates.ts:66-77` (module docstring, "CHOKEPOINT HYGIENE" section)
**Apply to:** every new `.ts` file in `grill/`, `plan-ceremony/`, `execute/`, `review/`.
> This file never reaches a model. It does not spell, even in a comment, the documented direct-completion method on the model registry, its simple-options or streaming siblings... the same six-plus-one bypass routes `tests/unit/chokepoint-lint.test.ts` enumerates for DIAG-03. Describing them here in the abstract, rather than naming them, is deliberate.
`chokepoint-lint.test.ts` matches raw source text, **comments included**, with **zero exemption** outside `.pi/extensions/diagnostics/`. Every model call in this phase (the reviewer dispatch, any nested advisor call) must route through `runSingleShotRole` — never write `modelRegistry.complete`, `.completeSimple`, `.stream`, `.getProvider`, `getRegisteredNativeProvider`, a `pi-ai/api/...` deep import, or `ModelRuntime`, in code OR comments, anywhere in the four new subsystems.

### The boundary-rule comment discipline (applies to every pure module)
**Source:** `.pi/extensions/quality/review-schema.ts:28-39`, `.pi/extensions/quality/gates.ts:95-102` (both, "BOUNDARY RULE (BOOT-10)" section, near-identical wording in both files)
**Apply to:** every pure predicate/parser/renderer module in this phase.
> This module registers nothing. It does not spell the tool-registration call, in code or in prose — `tests/unit/contributing-boundary.test.ts` matches that call's name as a plain substring across every tracked source under `.pi/extensions/`, comments included, and grants this directory no exemption.
Copy this exact disclosure into every new pure module's header. `TOOL_REGISTRATION_ALLOWLIST` stays at exactly five (`contributing-boundary.test.ts:257-263`) — Phase 9 must add zero.

### Git pre-flight (branch guard) reuse
**Source:** `.pi/extensions/workflows/index.ts:36-40`
**Apply to:** all four new commands, before any write.
```typescript
const verdict = classifyGitInvocation(
	{ subcommand: "commit", args: [] },
	{ currentBranch: currentBranch(ctx.cwd), protectedBranches: PROTECTED_BRANCHES },
);
if (verdict.kind === "block") return void ctx.ui.notify(verdict.reason, "error");
```

### Numbered, binding-order predicate docstrings
**Source:** `.pi/extensions/workflows/evidence.ts:101-165` (docstring above `gateCompletion`), `.pi/extensions/quality/review-schema.ts:262-318` (docstring above `validateReview`)
**Apply to:** every new predicate/parser in this phase (ambiguity scorecard, §2 evidence gate, §4 IF/THEN parser, task-form parser, scope-drift checker, QUAL-08 selector extension).
Every branch is numbered, states not just what it does but WHY it sits where it does in the order, and every reject reason is built from the received data — never a caller-supplied string.

### Fail-closed default on an unclassified/malformed shape
**Source:** `.pi/extensions/safety/git.ts:462-465` (`classifyGlabInvocation`'s final fallthrough) and `.pi/extensions/quality/review-schema.ts:319-326` (branch (1) of `validateReview`)
**Apply to:** every new parser and the extended `classifyGlabInvocation`.
An unrecognised shape is a BLOCK/REJECT, never a pass-through allow. Never widen a default to make a new case fit; add a named row/branch instead.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `.pi/skills/grill/SKILL.md`, `.pi/skills/plan-ceremony/SKILL.md`, `.pi/skills/review/SKILL.md` | skill (procedure body) | — | See Group H. No skill body exists anywhere in this repository (`.pi/skills/` is `.gitkeep`-only, confirmed by directory listing this session). The only available reference is Pi's own bundled 8-line structural example (`examples/extensions/dynamic-resources/SKILL.md`), which proves file-format compilation, not procedural-content organization. This is a genuinely NEW SHAPE for this codebase, and the phase that writes it is also the phase that must close the `RESOURCE_EDGES`/non-`.md`-asset hole around it. |

---

## Metadata

**Analog search scope:** `.pi/extensions/{workflows,quality,safety,plan-mode,checkpoint}/`, `.pi/agents/`, `.pi/skills/`, `.pi/prompts/`, `tests/{unit,integration,helpers,fixtures}/`, `docs/`, `package.json`'s `pi` manifest, and Pi 0.84.1's installed package (`%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\{docs,examples}`).
**Files scanned (full or targeted read, this session):** `workflows/index.ts` (full, 98 lines), `workflows/evidence.ts` (full, 381 lines), `quality/review-schema.ts` (full, 579 lines), `quality/gates.ts` (full, 425 lines), `quality/reviewer.ts` (targeted, lines 355-420), `safety/git.ts` (targeted, lines 248-490), `safety/policy.ts` (targeted, lines 350-370), `.pi/agents/reviewer.md` (full), `.pi/agents/planner.md` (full), `tests/helpers/git.ts` (full, 175 lines), `tests/helpers/stub-bin.ts` (full, 251 lines), `tests/helpers/faux.ts` (targeted, lines 1-120), `tests/helpers/qoder-loopback.ts` (targeted, grep + line refs), `tests/integration/qoder-delegate.test.ts` (targeted, grep), `tests/integration/quick-workflow.test.ts` (targeted, lines 1-80), `tests/unit/workflow-budgets.test.ts` (targeted, lines 95-302), `tests/unit/git-policy.test.ts` (targeted, lines 1-60), `tests/fixtures/evasion-corpus.ts` (targeted, grep), `tests/unit/docs-policy.test.ts` (targeted, lines 160-180 + grep), `tests/unit/gitignore-policy.test.ts` (targeted, lines 1-60), `tests/unit/checkpoint-store.test.ts` (targeted, lines 160-275), `docs/RUNBOOK.md` (targeted, lines 855-914), Pi 0.84.1's `examples/extensions/dynamic-resources/SKILL.md` (full) and `docs/skills.md` (targeted, grep), `package.json` (targeted, grep).
**Pattern extraction date:** 2026-08-15
