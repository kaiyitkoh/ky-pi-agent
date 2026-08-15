# Phase 8: Quality Gates & Engineering Quality - Pattern Map

**Mapped:** 2026-08-15
**Files analyzed:** 27 (14 new, 13 modified)
**Analogs found:** 27 / 27 (every file has at least a role-match; several have an exact match)

This is a mature codebase with a strict house style. The single most important
transferable rule, present in every analog below and binding on every new file
this phase adds: **pure logic modules take plain data and return plain data
(no `ctx`, no I/O), one thin impure module does the I/O/dispatch, and the
extension's `index.ts` wires modules together and registers nothing it doesn't
have to.** A second rule that is new-in-this-phase but already precedented by
`qoder/index.ts` and `safety/index.ts`: **every tool registration pays the
BOOT-10 toll in the same commit** — `TOOL_REGISTRATION_ALLOWLIST` entry with
written (a)/(b)/(c) answers, plus a `TOOL_COUNT_BASELINE` row.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `.pi/extensions/quality/gates.ts` | utility (pure classifier/aggregator) | batch / transform | `.pi/extensions/safety/shell.ts` (AST-walking) + `.pi/extensions/workflows/evidence.ts` (pure predicate house style) | exact (role+flow) |
| `.pi/extensions/quality/reviewer.ts` | service (schema/prompt-contract/validator) | request-response (nested model call) + transform (parse/validate) | `.pi/extensions/routing/guard.ts` (two-arm verdict) + `.pi/extensions/qoder/index.ts` (typebox tool schema, refusal-as-thrown-Error) | role-match |
| `.pi/extensions/quality/advisor.ts` | tool (mid-turn, model-invocable) | request-response | `.pi/extensions/qoder/index.ts` (`qoder_delegate` — the only other mid-turn nested-model tool in the repo) | exact |
| `.pi/extensions/quality/calibration.ts` | utility (pure scoring function, NOT registered) | batch / transform | `.pi/extensions/diagnostics/budget.ts`'s `computeBudget` (pure aggregation) + `.pi/extensions/workflows/evidence.ts`'s `gateCompletion` (pure predicate) | role-match |
| `.pi/extensions/quality/index.ts` | config (extension entry point) | event-driven | `.pi/extensions/safety/index.ts` (largest entry point; registration-order + idempotency docstring) + `.pi/extensions/workflows/index.ts` (small command wiring, ≤80-line discipline) | exact |
| `.pi/agents/reviewer.md` | config (agent file) | n/a | `.pi/agents/planner.md` | exact |
| `tests/fixtures/seeded-defects/*` | test fixture | file-I/O | `tests/helpers/git.ts` (`makeTempRepo`/`commitFile`/`headSha`) + `tests/helpers/qoder-loopback.ts` (purpose-built fixture helper) | role-match |
| `tests/unit/quality-gates.test.ts` | test (unit) | batch | `tests/unit/chokepoint-lint.test.ts` + `tests/unit/contributing-boundary.test.ts` (vacuity-guard pattern, inline offending fixture) | exact |
| `tests/unit/quality-schema.test.ts` | test (unit, schema validator) | transform | `tests/unit/docs-policy.test.ts`'s `runbookEntryStatuses` (two-source-agreement / malformed-input parsing pattern) + `tests/unit/chokepoint-lint.test.ts` (vacuity guard) | role-match |
| `tests/integration/reviewer-contract.test.ts` | test (integration, session-level) | request-response via `fauxProvider` | `tests/integration/single-shot-roles.test.ts` | exact |
| `tests/integration/refute-or-promote.test.ts` | test (integration) | request-response via `fauxProvider` | `tests/integration/single-shot-roles.test.ts` | exact |
| `tests/integration/reviewer-calibration.test.ts` | test (integration, negative-control) | request-response via `fauxProvider` | `tests/integration/single-shot-roles.test.ts` + `tests/helpers/faux.ts`'s `wrapFauxWithStatus` (a wrapper that DELIBERATELY produces the wrong-branch case, proving the harness can report bad) | role-match |
| `tests/integration/advisor-consult.test.ts` | test (integration) | request-response via `fauxProvider` | `tests/integration/single-shot-roles.test.ts` | exact |
| `tests/integration/gate10-nested-thinking.test.ts` | test (integration) | request-response via `fauxProvider`, per-`api`-shape | `tests/integration/single-shot-roles.test.ts` (same harness; this file's job is to register faux providers under BOTH `"openai-completions"` and `"bedrock-converse-stream"` and assert the API-appropriate field) | exact |
| `docs/QUALITY.md` (new docs companion) | docs | n/a | `docs/DIAGNOSTICS.md` / `docs/WORKFLOWS.md` (the "if code and doc disagree, code is authoritative" contract) | exact |
| `docs/RUNBOOK.md` (modified — append RB-08-xx) | docs | n/a | `docs/RUNBOOK.md`'s own `RB-07-01`/`RB-07-02` entries (freshest two-place status structure) | exact |
| `docs/DIAGNOSTICS.md` (modified — QUAL-09 field) | docs | n/a | same file's existing "Row types" section | exact |
| `docs/WORKFLOWS.md` (modified — deterministic-gate composition, possibly the empty-commit tree-hash closure) | docs | n/a | same file's own §2/§4 | exact |
| `.pi/extensions/routing/modes.ts` (modified — Bedrock-shape fix + `tools` field) | service (dispatch layer) | request-response | itself (pre-existing file; the fix is `buildNestedApiOptions` branching on `model.api`, modelled on `guard.ts`'s block-ordered pure-function style) | exact |
| `.pi/extensions/diagnostics/schema.ts` (modified — QUAL-09 field) | model (row type + constants) | n/a | itself; follow the `TurnRow.thinkingLevel?`/`TurnRow.httpStatus?` precedent exactly (omission rule) | exact |
| `.pi/extensions/diagnostics/turns.ts` (modified — QUAL-09 field composition) | utility (pure row composer) | transform | itself; follow the `if (input.thinkingLevel !== undefined) row.thinkingLevel = ...` conditional-assign at `turns.ts:279` | exact |
| `.pi/extensions/diagnostics/call-model.ts` (modified — pass QUAL-09 field from the two `recordTurn` sites) | service (chokepoint) | request-response | itself, `recordTurn` call sites at `:465` (error path) and `:481` (success path) | exact |
| `.pi/extensions/diagnostics/index.ts` (modified — `turn_end` handler, main-loop QUAL-09 value) | service (event handler) | event-driven | itself, `turn_end` handler (~`:632` per RESEARCH) | exact |
| `.pi/extensions/workflows/evidence.ts` (modified — IF the empty-commit tree-hash gap is closed) | utility (pure predicate) | transform | itself; `gateCompletion`'s existing first-match-wins ordered-branch style is the template for a sixth branch | exact |
| `tests/unit/routing-dispatch.test.ts` (extended — Bedrock-shape fix proof) | test (unit) | batch | itself; `tests/unit/capability-guard.test.ts`-style millisecond fixture table (per `guard.ts`'s own docstring) | exact |
| `tests/unit/contributing-boundary.test.ts` (extended IFF advisor tool built) | test (unit, policy) | batch | itself — extend `TOOL_REGISTRATION_ALLOWLIST` with a 5th (a)/(b)/(c) entry, following the `qoder/index.ts` entry's shape exactly | exact |
| `tests/unit/tool-count-baseline.test.ts` (extended IFF advisor tool built) | test (unit, policy) | batch | itself — add a `"vendored"` row to `TOOL_COUNT_BASELINE` | exact |
| `tests/unit/docs-policy.test.ts` (extended — `PHASE_EIGHT_IDS`) | test (unit, policy) | batch | itself — follow the `PHASE_SEVEN_IDS`/`FIXTURE_PHASE_SEVEN` append pattern | exact |
| `tests/unit/workflow-budgets.test.ts` (extended IF `quality/index.ts` registers a command or `/quick` grows) | test (unit, ratchet) | batch | itself — add `WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS` rows for `.pi/extensions/quality/` | exact |
| `tests/unit/turns-composition.test.ts` (extended — QUAL-09) | test (unit) | transform | itself, alongside `composeTurnRow`'s omission-rule tests | exact |
| `tests/integration/turns-log.test.ts` (extended — QUAL-09) | test (integration) | file-I/O | itself | exact |
| `tests/integration/qoder-delegate.test.ts` (MODIFIED, not created — flake fix) | test (integration) | event-based (stall-detection, not elapsed-time) | itself; the WR-07 `it` block at `:501-571` | exact |
| `tests/helpers/qoder-loopback.ts` (MODIFIED, not created — flake fix) | test fixture / helper | event-driven (gate promises, not `setTimeout` durations) | itself; `writeStreamBody` (`:241-271`, `splitDelayMs` at option `:121`), `void answer().catch(...)` at `:374`, teardown at `:441-453` | exact |
| `.pi/extensions/qoder/client.ts` (touched only if `now?: () => number` injection is added, optional per RESEARCH) | service | request-response | itself, `lastProgressAt`/`inactivityTimeoutMs` at `:701-770` | exact |

## Pattern Assignments

### `.pi/extensions/quality/gates.ts` (utility, batch/transform)

**Analogs:** `.pi/extensions/safety/shell.ts` (AST-walking classifier — the "parse, don't string-match" precedent QUAL-01 must follow) and `.pi/extensions/workflows/evidence.ts` (pure-predicate / thin-impure-caller house style, first-match-wins ordering).

**Module docstring shape to copy** (`safety/shell.ts:1-115`, `workflows/evidence.ts:1-40`): a long header explaining WHY the mechanism was chosen (AST over regex, citing the exact prior failure — `git.exe push` exact-string matching), what the module does NOT prove, and a `BOUNDARY RULE (BOOT-10)` closing paragraph stating the module registers nothing and does not spell the tool-registration call even in prose:

```typescript
/**
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
```
(verbatim from `workflows/evidence.ts:34-39`)

**AST-walking pattern to copy** (`safety/shell.ts:362-504`) — generic recursive walkers over `ts.createSourceFile`'s AST, one walker per fact needed, never a single monolithic walker mixing concerns:

```typescript
// safety/shell.ts:381-402 — the shape: collect every node matching a
// predicate into a Set/array, recursing through every "walkable" key.
function collectTypes(node: unknown, found: Set<string>): void {
	if (node === null || typeof node !== "object") return;
	if (Array.isArray(node)) { for (const item of node) collectTypes(item, found); return; }
	const obj = node as Record<string, unknown>;
	if (typeof obj.type === "string") found.add(obj.type);
	for (const key of walkableKeys(obj)) {
		if (key === "pos" || key === "end") continue;
		collectTypes(obj[key], found);
	}
}
```
For QUAL-01's `ts.createSourceFile` walk, replace the `.type`-string-based walk with `ts.forEachChild`/`node.kind` — same shape, different AST library. Each of the six rules should be its own named function returning a list of findings, never a single 200-line function.

**Two-arm/discriminated verdict pattern to copy** (`routing/guard.ts:120-127`, `workflows/evidence.ts:69-73`):

```typescript
// routing/guard.ts:120-127
export type GuardVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };
```
For GATE-01's PASS/FAIL/**UNAVAILABLE** (three arms, not two — CONTEXT.md is explicit that UNAVAILABLE is not a PASS), model it as a three-literal discriminated union, e.g. `{ status: "pass" } | { status: "fail"; findings: ... } | { status: "unavailable"; reason: string }`, never a boolean plus a nullable field.

**First-match-wins ordered predicate with a numbered, binding-order comment** (`workflows/evidence.ts:101-191`, `gateCompletion`) — copy this shape for any ordered decision in `gates.ts` (e.g. "which leg's failure is reported first"):

```typescript
/**
 * The pure predicate. First-match-wins, mirroring `classifyGitInvocation`'s
 * structure. BRANCH ORDER IS BINDING:
 *   (1) ... -> reject, naming ...
 *   (2) ... -> reject: ...
 * ...
 */
export function gateCompletion(records, headSha, baseSha): EvidenceVerdict { ... }
```

**LSP-probe pattern** (RESEARCH's own worked example, matching `evidence.ts`'s pure-function style):

```typescript
// Source: RESEARCH.md Pattern 1, matching evidence.ts's own discipline
export function probeLspAvailability(activeToolNames: readonly string[]): "pass" | "unavailable" {
	const required = ["lsp_diagnostics", "lsp_fix"];
	return required.every((name) => activeToolNames.includes(name)) ? "pass" : "unavailable";
}
// Caller (inside the extension factory closure, where `pi: ExtensionAPI` is in scope):
//   probeLspAvailability(pi.getAllTools().map(t => t.name))
```
`gates.ts` itself never touches `pi`/`ctx` — the tool-name list is a parameter, exactly as `evidence.ts`'s `gateCompletion` takes `records`/`headSha`/`baseSha` as parameters rather than reading state itself.

---

### `.pi/extensions/quality/reviewer.ts` (service, request-response + transform)

**Analogs:** `.pi/extensions/routing/guard.ts` (verdict shape, purity discipline) + `.pi/extensions/qoder/index.ts` (typebox schema construction, refusal-as-thrown-Error, `writeQoderTranscript`-style audit-on-every-branch discipline) + Pi's own `examples/extensions/structured-output.ts` (forced tool-call pattern, per RESEARCH Pattern 2).

**Structured-output schema pattern** (RESEARCH's own worked example, matching `qoder/index.ts:64-81`'s `Type.Object` construction style):

```typescript
// qoder/index.ts:64-81 — the schema-construction shape to copy
import { Type } from "typebox";
const qoderDelegateSchema = Type.Object({
	task: Type.String({ description: "The task to delegate ..." }),
});
```
Applied to the reviewer's `submit_review` schema (RESEARCH's Pattern 2 excerpt):
```typescript
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
};
```
**Do not use `Type.Union`/`Type.Literal` for a plain string enum where `StringEnum` from `@earendil-works/pi-ai` would do** — CLAUDE.md's "What NOT to Use" table says the `Type.Union`/`Type.Literal` shape breaks against Google's API. `safety/index.ts:459` (`blast_radius: StringEnum([...])`) is the in-repo precedent to copy for closed string-enum fields (`severity`, `classification`, verdict `status`); reserve `Type.Union([Type.Literal(...)])` only where RESEARCH's own excerpt already used it and StringEnum genuinely does not apply.

**Refusal-as-thrown-Error, actionable message** (`qoder/index.ts:126-131`, `safety/index.ts:510-515`) — the pattern every "malformed tool-call output" rejection in the reviewer's parser should follow: name what was expected, what arrived, and the remedy, never an opaque failure.

**Dispatch through `runSingleShotRole`, never a second chokepoint** — `reviewer.ts` must call `.pi/extensions/routing/modes.ts`'s `runSingleShotRole(ctx, { role: "reviewer", messages, systemPrompt, tools: [submitReviewTool] })`, per `routing/modes.ts:373-447`'s own docstring and the chokepoint-lint gate. `RunSingleShotRoleOptions` (`modes.ts:366-371`) needs a new `tools?: Tool[]` field threaded straight to `callModel`'s existing `opts.tools` (`call-model.ts:461` already reads `opts.tools`) — this is a small, additive change to an existing interface, not a new mechanism.

**Redaction reuse, never re-implementation** — the reviewer's context-building step (diff + full touched files) must reuse `.pi/extensions/diagnostics/redact.ts`'s `redactString`/`redactDeep`, exactly as `workflows/evidence.ts:41,91` already imports and calls `redactString`.

---

### `.pi/extensions/quality/advisor.ts` (tool, request-response)

**Analog:** `.pi/extensions/qoder/index.ts` — the only other file in this repository registering a tool the model invokes mid-turn to reach a "foreign" capability. Copy its full shape:

1. **Boundary-rule justification block ABOVE the registration** (`qoder/index.ts:12-24`) — a module docstring section literally titled "THIS EXTENSION REGISTERS A TOOL ON PURPOSE" naming the three written answers and pointing at the `TOOL_REGISTRATION_ALLOWLIST` entry that must land in the same commit.
2. **Description as a first-class statement** (`qoder/index.ts:93-105`, `QODER_DELEGATE_DESCRIPTION`) — the tool's `description` field names what it bypasses/does, in full sentences, because "the model reads the description and the user may never read `docs/`".
3. **Session_start deactivation when unconfigured/inapplicable** (`qoder/index.ts:303-311`) — if the advisor route can be structurally inapplicable in some mode (e.g. GATE-09 firing only when there is a stronger model to consult), deactivate the tool via `pi.setActiveTools(pi.getActiveTools().filter(...))` from `session_start`, **never from the factory** (`qoder/index.ts:260-302`'s own citation of why `pi.getActiveTools()`/`setActiveTools()` throw during extension load).
4. **Dispatch through `runSingleShotRole(ctx, { role: "advisor", ... })`**, exactly as `reviewer.ts` does for the reviewer role — never a hand-rolled `fetch`/provider call (this is explicitly named in RESEARCH's "Known Threat Patterns" table as an Elevation-of-Privilege risk the chokepoint-lint gate already prevents by construction, so long as `advisor.ts` uses `runSingleShotRole`).
5. **No `terminate: true`** on the tool result — an advisor consult is mid-turn, the executor keeps working afterward (RESEARCH's Open Question 1 recommendation; contrast with `examples/extensions/structured-output.ts`'s `terminate: true`, which is for a genuinely final answer).

**BOOT-10 toll, paid in the same commit** — follow `tests/unit/contributing-boundary.test.ts:113-140`'s `qoder/index.ts` entry as the template for the advisor's own (a)/(b)/(c) paragraph, and `tests/unit/tool-count-baseline.test.ts`'s vendored-row shape (`":204-221` `.pi/extensions/todo.ts` row) for the new `TOOL_COUNT_BASELINE` entry, with the schema byte count measured the same way (`Buffer.byteLength(JSON.stringify(payload), "utf8")`, `Math.ceil(bytes/4)` per `diagnostics/budget.ts:223-224`).

---

### `.pi/extensions/quality/calibration.ts` (utility, batch/transform, NOT registered)

**Analogs:** `.pi/extensions/diagnostics/budget.ts`'s `computeBudget` (pure aggregation over already-collected data) and `.pi/extensions/workflows/evidence.ts`'s `gateCompletion` (pure predicate, no `ctx`).

The scorer must be a **pure function** `(corpusResult, reviewerFindings) => { catchRate: number; perDefectClass: Record<string, boolean> }` — no `ctx`, no I/O, no fauxProvider dependency inside the module itself, so it is separately testable from the corpus and the injection (RESEARCH's Pitfall 3 — "a calibration harness that grades itself"). Follow `evidence.ts`'s discipline of documenting, in the module header, **what the function does NOT prove** — here, that a scorer never itself executed against a real (non-scripted) reviewer is not proof the reviewer is honest, only proof the scorer can tell the difference between a good and bad transcript.

---

### `.pi/extensions/quality/index.ts` (config, event-driven entry point)

**Analogs:** `.pi/extensions/safety/index.ts` (largest entry point — registration-order docstring, idempotency-per-call discipline) and `.pi/extensions/workflows/index.ts` (78 lines, composes sibling pure modules, registers a command that calls into them).

**Composition-not-reimplementation rule** (`workflows/index.ts:1-9`): the header states plainly that the file "Composes Phase 5 routing, Phase 4 git safety and the Phase 6 evidence gate; reimplements none of them" and that terseness in this file "IS the FLOW-01 budget being honoured, not an oversight." `quality/index.ts` should be the equivalent thin composition layer over `gates.ts`/`reviewer.ts`/`advisor.ts`/`calibration.ts`.

**Registration-order discipline, if `quality/index.ts` also wraps tools or hooks** (`safety/index.ts:32-46`): tool registrations first, hooks after, and a documented statement of what first-registration-wins means for load order.

**`/quick` integration**: per CONTEXT.md decision 8, the deterministic gate stage must be **callable from `/quick`, not inlined into it** — `workflows/index.ts` stays at its current 78 lines (`tests/unit/workflow-budgets.test.ts`'s hard 80-line ceiling for `.pi/extensions/workflows/index.ts`), and `quality/gates.ts`'s exported function is imported and called from inside `workflows/index.ts`'s existing handler body, exactly the way it already imports `planRoleCall`/`classifyGitInvocation`/`endRun` from sibling subsystems (`workflows/index.ts:10-14`).

**Directory ratchet**: `.pi/extensions/quality/` is a NEW command-adjacent directory. If any file in it spells `registerCommand(` (unlikely — the gate stage is called FROM `/quick`, not registered as its own command) or `registerTool(` (the advisor tool), `tests/unit/workflow-budgets.test.ts`'s `DIRECTORY_BUDGETS` registry needs a new entry sized `Math.ceil(actual/10)*10`, following the exact `why`-field discipline every existing entry uses (`workflow-budgets.test.ts:101-193`).

---

### `.pi/agents/reviewer.md` (config, agent file)

**Analog:** `.pi/agents/planner.md` — copy verbatim in structure:

```markdown
---
name: reviewer
description: <one sentence>
tools: <minimal allowlist>
thinking: high
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
---

<system prompt body>

<!--
Deliberately no `model:` key in this file's frontmatter.

`pi-subagents@0.49.0 src/agents/agents.ts:1155` reads:

    if (override.model !== undefined && !agentHasFrontmatterField(agent, "model")) {

A settings-level `subagents.agentOverrides` entry (written by
`.pi/extensions/routing/agent-overrides.ts`, ROUTE-05) only fills in a model
when the agent's OWN frontmatter has none. If this file ever gains a `model:`
line, every `/cheap`, `/balanced`, `/max` and `/escalate` switch stops
affecting the reviewer -- its pin becomes permanent and silent.

`fallbackModels:` is withheld for the identical reason.
-->
```
(source: `.pi/agents/planner.md:1-66`, verbatim)

**Note:** per RESEARCH, the reviewer/advisor mechanism in THIS phase is `runSingleShotRole`, not a real `pi-subagents` spawn (Correction 2 — nothing installed). Whether `.pi/agents/reviewer.md` is even load-bearing this phase (vs. purely a prompt string owned by `reviewer.ts`) is worth flagging to the planner: `AGENT_NAME_BY_ROLE` in `routing/schema.ts:334-336` only maps roles whose `ROLE_MECHANISM` is `"subagent"` (today: only `planner`). If the reviewer stays `"call-model"` mechanism, an agent `.md` file may not be consumed by anything at runtime this phase — the planner should decide whether `reviewer.md` is written now (for the eventual real-subagent path) or deferred, and if written now, `reviewer.ts`'s own system prompt should be the single source of truth either way (no drift between the `.md` and the string).

---

### `tests/fixtures/seeded-defects/*` (test fixture, file-I/O)

**Analog:** `tests/helpers/git.ts`'s `makeTempRepo`/`commitFile`/`headSha` (`git.ts:121-174`) — the only honest way to build a seeded-defect diff, per RESEARCH's Known Threat Patterns table ("Corpus fixtures live under `tests/fixtures/seeded-defects/` and are applied to a `tests/helpers/git.ts` `makeTempRepo()` — never applied to this repository's own working tree").

```typescript
// git.ts:121-136 — the shape every corpus fixture builder should use
export function makeTempRepo(prefix: string): string {
	const repo = mkdtempSync(join(tmpdir(), prefix));
	const setup: string[][] = [
		["init"], ["config", "user.email", "quick@test.invalid"],
		["config", "user.name", "quick test"], ["checkout", "-b", "work"],
	];
	for (const args of setup) {
		const { status } = run(args, repo);
		if (status !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${status}) while making temp repo ${repo}`);
	}
	return repo;
}
```
Each of the six real-incident defect classes (CONTEXT.md's table) should be a small builder function `(repo: string) => void` that commits the defective shape via `commitFile`, mirroring `qoder-loopback.ts`'s pattern of one purpose-built fixture module per distinct protocol shape rather than one shared generic fixture trying to cover all six.

**QUAL-01 exemption**: `tests/fixtures/**` must be exempted from `gates.ts`'s own magic-number/duplication/TODO rules (RESEARCH's Known Threat Patterns table, last row) — otherwise the corpus becomes un-shippable, since a seeded "shipped TODO" defect fixture would itself trip the TODO rule if it were scanned.

---

### `tests/unit/quality-gates.test.ts` / `tests/unit/quality-schema.test.ts` (test, unit)

**Analogs:** `tests/unit/chokepoint-lint.test.ts` and `tests/unit/contributing-boundary.test.ts` — both are the canonical vacuity-guard shape this phase's own subject (test suspicion) demands.

**The three-part vacuity guard to copy** (`chokepoint-lint.test.ts:166-233`, `contributing-boundary.test.ts:254-286`):
1. Assert the scanned set is non-empty.
2. Assert the set REMAINING after any exemption/allowlist is non-empty.
3. Prove every rule/pattern fires against an INLINE offending fixture (never read from disk — a fixture file under the scanned tree would be caught by the scan itself and fail the gate it exists to prove):

```typescript
// chokepoint-lint.test.ts:212-233 — the "prove every pattern is live" shape
it("proves every forbidden pattern is live against an inline offending fixture", () => {
	const dead = FORBIDDEN.filter(({ pattern }) => !pattern.test(OFFENDING_FIXTURE)).map(
		({ pattern, why }) => `${String(pattern)} — ${why}`,
	);
	expect(dead, "these patterns matched NOTHING in the synthetic offending source...").toEqual([]);
});
```
For QUAL-01's six rules, each rule needs both a positive fixture (a real anti-pattern shape it must flag) and a negative fixture drawn from this repo's OWN deliberate style (a `catch { return undefined; }` documented "NEVER THROWS by contract", per `evidence.ts`/`safety/audit.ts`) that it must NOT flag — this is the false-positive suppression RESEARCH's Pitfall 2 names explicitly.

For `quality-schema.test.ts`'s "unclassified finding rejected as malformed" and "missing checked-and-cleared rejected" assertions, follow `docs-policy.test.ts`'s `runbookEntryStatuses` two-source-agreement pattern (`docs-policy.test.ts:181-235`) as the template for "two things must agree, disagreement is reported as a distinct third state, never silently resolved":

```typescript
// docs-policy.test.ts:189-192 — disagreement is its own reportable state,
// never silently picked one way
if (fromTable !== undefined && fromSection !== undefined) {
	out[id] = fromTable === fromSection ? fromTable : "INCONSISTENT";
}
```

---

### `tests/integration/{reviewer-contract,refute-or-promote,reviewer-calibration,advisor-consult,gate10-nested-thinking}.test.ts` (test, integration, `fauxProvider`)

**Analog:** `tests/integration/single-shot-roles.test.ts` — the direct, only precedent for testing `runSingleShotRole` through `fauxProvider` without a real credential.

**How the live `ExtensionContext` is obtained** (`single-shot-roles.test.ts:20-45`): `routing/modes.ts` is imported directly as a plain module (never loaded as an extension), and `AgentSession#extensionRunner.createCommandContext()` hands back a live `ExtensionCommandContext` immediately after `createAgentSession()` returns — no extension load, no prompt required. `diagnostics/` IS still loaded (via `extensionSource`) only because the turn-row writers live in its hooks.

**Response-factory pattern for asserting the OUTGOING request** (RESEARCH's own citation of `faux.ts`'s builders): `fauxProvider`'s response steps may be a `(context, options, state, model) => AssistantMessage` factory rather than a static message, which is exactly what `gate10-nested-thinking.test.ts` needs to assert `options.reasoningEffort` vs `options.reasoning` vs `options.thinkingEnabled` per `model.api`. Register faux providers under BOTH `"openai-completions"` and `"bedrock-converse-stream"` API ids (RESEARCH's Pitfall 1 warning: a test that only ever registers a generic faux id repeats today's exact blind spot).

**`tests/helpers/session.ts`'s `withFauxSession`** — async-disposal pattern (no skip escape hatch, throws with the remedy in the message) is the required shape for any new session-level helper this phase's integration tests add.

**Negative-control shape for `reviewer-calibration.test.ts`** (RESEARCH Pitfall 3 + `tests/helpers/faux.ts`'s `wrapFauxWithStatus` as the closest existing "deliberately wrong" wrapper precedent, `faux.ts:365-396`): script a reviewer response that ALWAYS returns "no concerns, all Implemented" against the full corpus and assert the reported catch rate is low — proving the scorer can report a bad number, not only a good one.

---

### `.pi/extensions/routing/modes.ts` (modified — the Bedrock-shape fix, GATE-10's actual first task)

**The exact defect, verified this session** at `modes.ts:409`:
```typescript
const api = plan.reasoningEffort !== undefined ? { reasoningEffort: plan.reasoningEffort } : undefined;
```
This always builds the `openai-completions` shape regardless of `plan.model.api`. `reviewer`/`advisor` resolve to `amazon-bedrock` in `balanced`/`max` mode (`routing/schema.ts:255-269`), where the correct shape is `{ reasoning, thinkingBudgets }` (`BedrockOptions`, no `reasoningEffort` field at all).

**Fix pattern to copy**: a new pure function, styled exactly like `guard.ts`'s block-ordered predicates (named blocks, each documented, `switch`/`if` on `model.api`), e.g.:
```typescript
// New function, modelled on guard.ts's per-block-documented style
export function buildNestedApiOptions(
	model: Model<Api>,
	effort: "high" | "max" | undefined,
): ModelsApiStreamOptions<Api> | undefined {
	if (effort === undefined) return undefined;
	switch (model.api) {
		case "openai-completions": return { reasoningEffort: effort } as ModelsApiStreamOptions<Api>;
		case "bedrock-converse-stream": return { reasoning: effort } as ModelsApiStreamOptions<Api>;
		case "anthropic-messages": return { thinkingEnabled: true, thinkingBudgetTokens: /* per-level constant */ } as ModelsApiStreamOptions<Api>;
		default: { const exhaustive: never = model.api; return exhaustive; }
	}
}
```
Call it from `runSingleShotRole` (`modes.ts:409`) in place of the current inline ternary. The `default: { const exhaustive: never = ...; }` exhaustiveness-check idiom is already used in this codebase (`safety/shell.ts:576-579`, `describeCause`'s `switch`) — copy it so a future fourth `Api` member is a compile error here, not a silent gap.

---

### `.pi/extensions/diagnostics/schema.ts` / `turns.ts` / `call-model.ts` / `index.ts` (modified — QUAL-09's three-edit recipe)

**The omission rule, stated at `schema.ts:249-257`** (`TurnRow.reasoning?`) and implemented at `turns.ts:243-245`:
```typescript
// turns.ts:243-245 — the omission-rule idiom to copy exactly
if (usage.reasoning !== undefined) {
	row.reasoning = usage.reasoning;
}
```
QUAL-09's new field must follow this exact shape: declared optional on `TurnRow` (`schema.ts`) with a docstring stating "OPTIONAL, AND THE KEY IS OMITTED ... never `0` and never `null`" (mirroring `schema.ts:249-257`'s `reasoning` field docstring or `:298` `thinkingLevel`'s one-liner), added optional to `TurnRowInput` (`turns.ts:89-117`), and conditionally assigned in `composeTurnRow` at the exact spot `turns.ts:279` uses for `thinkingLevel`:
```typescript
// turns.ts:279 — the precedent CONTEXT.md names directly
if (input.thinkingLevel !== undefined) {
	row.thinkingLevel = input.thinkingLevel;
}
```
Then threaded from the two `recordTurn(...)` call sites in `call-model.ts` (`:465` error path, `:481` success path — both already pass `httpStatus` the same optional way) and/or `diagnostics/index.ts`'s `turn_end` handler for the main-loop half.

**`docs/DIAGNOSTICS.md` must be updated in the same change** — its own contract states "if the code and this document disagree, the code is authoritative and this document is a bug" (`DIAGNOSTICS.md:16`); the new field needs a row in the "Row types" section following the exact prose shape used for `reasoning`/`cacheReadRatio`/`thinkingLevel`.

---

### `.pi/extensions/workflows/evidence.ts` (modified, IF the empty-commit gap is closed this phase)

**Pattern**: add a SIXTH branch to `gateCompletion`'s existing first-match-wins predicate (`evidence.ts:145-191`), preserving the exact numbered-comment discipline:
```typescript
// evidence.ts:101-127 — the branch-order comment style every new branch must extend
/**
 *   (6) [new] no diff/tree-hash evidence the commit contains the claimed
 *       work -> reject, naming ... — see docs/WORKFLOWS.md §4 for why this
 *       residual was deferred to Phase 8.
 */
```
The deterministic gate stage (`quality/gates.ts`) already computes a diff for the reviewer's own context contract (GATE-02) — RESEARCH notes this closure is "nearly free once that exists." If the plan does NOT close this gap, `docs/WORKFLOWS.md` §4's existing honest wording ("HEAD moved … the work itself is NOT verified") must be left intact, not quietly dropped (CONTEXT.md's explicit instruction).

---

### `tests/unit/docs-policy.test.ts` (extended — `PHASE_EIGHT_IDS`)

**Exact append pattern** (`docs-policy.test.ts:110-152`, `PHASE_SEVEN_IDS` and its comment block):
```typescript
// docs-policy.test.ts:142 — the append-only pattern, verbatim shape
const PHASE_SEVEN_IDS = ["RB-07-01", "RB-07-02", "RB-07-03"] as const;
// ... becomes, for Phase 8:
const PHASE_EIGHT_IDS = ["RB-08-01", /* ... */] as const;
const ALL_IDS = [...PHASE_ONE_IDS, /* ... */, ...PHASE_SEVEN_IDS, ...PHASE_EIGHT_IDS] as const;
```
Each new id needs: (1) a summary-table row AND a `### RB-08-xx` detail section both marked `OUTSTANDING` in `docs/RUNBOOK.md`, (2) an `ENTRY_COMMANDS["RB-08-xx"]` array of exact, verbatim commands (`docs-policy.test.ts:315-472`'s per-phase commented block, e.g. `"RB-07-01": [...]`), and (3) — per this file's own Group C discipline — a synthetic `FIXTURE_PHASE_EIGHT`/`FIXTURE_PHASE_EIGHT_HALF_FLIPPED` pair (`docs-policy.test.ts:757-777`'s `FIXTURE_PHASE_SEVEN` shape) so the generalised two-source-agreement parser is proven off a fixture and not only off the real file.

**`docs/RUNBOOK.md` entry shape** (`RUNBOOK.md:1029-1043`, `RB-07-01`):
```markdown
### RB-08-xx — <title>

**Status:** OUTSTANDING

**Why this cannot be done here.** <cite Correction 1/2 as applicable> ...

**Precondition.** ...

**Procedure, on the work laptop, ...:**
1. ...
```

---

### `tests/integration/qoder-delegate.test.ts` + `tests/helpers/qoder-loopback.ts` (MODIFIED — the diagnosed flake fix)

These are **modified, not created**. The fix (fully diagnosed in RESEARCH/CONTEXT, confirmed against the real files this session) is:

1. **`qoder-loopback.ts`**: replace the `splitDelayMs` duration-based gate (`writeStreamBody`, `:241-271`, delay parameter documented at `:112-121`) with an event: add `firstChunkWritten: Promise<void>` and `releaseSecondChunk: Promise<void>` to `QoderLoopbackHandle` (`:135-148`), and have the server resolve `firstChunkWritten` after its first `res.write()` then `await` the caller-supplied gate before its second. The existing responder-dispatch pattern to preserve exactly: `void answer().catch(...)` at `:374-384` (never let a responder throw out of the request handler — convert to a 500 and continue) and the teardown ordering at `:441-453` (`finally`: destroy every tracked socket, THEN `await` `server.close()` — the CONTEXT.md fix note says this `void`-then-destroy sequencing is itself part of the leaked-timer bug and must become an `await`).
2. **`qoder-delegate.test.ts`**: replace the `elapsed` bound assertions at `:539-549` (`toBeGreaterThanOrEqual(injectedTimeoutMs)` / `toBeLessThan(splitDelayMs)`) with `await loop.firstChunkWritten` before asserting the rejection, then assert on the LOSSLESSLY-recorded transcript fields instead of wall-clock: `afterMs === injectedTimeoutMs` and `textChars > 0`, read from the `qoder.delegate.failed` record already written by `client.ts:717-722`/`:752-757` (`afterMs: inactivityTimeoutMs, textChars: folded.text.length`) — this is confirmed to be **strictly stronger** than the timing bound it replaces and has zero timing dependence.
3. **`client.ts`** (optional hardening per RESEARCH): add `readonly now?: () => number` to `DelegateTaskOptions` and use it at the three `Date.now()` call sites (`:706`, `:710`, `:770`) — but do NOT reach for `vi.useFakeTimers`, which RESEARCH notes would deadlock the `Promise.race` at `:734` (the read side needs a real event loop; zero `useFakeTimers` calls exist anywhere in this repo today).

Follow the exact transcript-write pattern already established at `client.ts:717-722` for any new terminal record this fix needs — `writeQoderTranscript(cwd, { event: "qoder.delegate.failed", cause: "inactivity-timeout", afterMs, textChars })`.

## Shared Patterns

### Chokepoint discipline (DIAG-02/03)
**Source:** `.pi/extensions/diagnostics/call-model.ts` (496 lines), enforced by `tests/unit/chokepoint-lint.test.ts`.
**Apply to:** `quality/reviewer.ts`, `quality/advisor.ts`, `quality/calibration.ts` (never calls a model itself), and any test helper touching a nested call.
Every nested model call in this phase goes through `runSingleShotRole()` (`.pi/extensions/routing/modes.ts`), which itself calls `callModel()`/`callWithFallback()`. No new file outside `.pi/extensions/diagnostics/` may spell `modelRegistry.complete`, `.completeSimple`, `.stream`/`.streamSimple`, `.getProvider`, `getRegisteredNativeProvider`, a `pi-ai/api/*` deep import, or `ModelRuntime` — **not even in a comment**. Describe the forbidden call in prose instead, the way `routing/modes.ts`'s own docstring does ("the direct-completion method on the model registry").

### The BOOT-10 boundary rule and its toll
**Source:** `CONTRIBUTING.md`, enforced by `tests/unit/contributing-boundary.test.ts` and `tests/unit/tool-count-baseline.test.ts`.
**Apply to:** `quality/advisor.ts` (the one plausible new tool this phase registers). Every new tool needs, in the SAME commit: (a) a written "must the model call this mid-turn" answer, (b) a MEASURED (not estimated) schema byte/token count via `Buffer.byteLength(JSON.stringify(payload), "utf8")` then `Math.ceil(bytes/4)`, (c) a written "why can't a skill carry this" answer, an allowlist entry in `contributing-boundary.test.ts`, and a `TOOL_COUNT_BASELINE` row in `tool-count-baseline.test.ts`. `quality/gates.ts`, `reviewer.ts`, `calibration.ts`, and `index.ts` (unless it wraps a tool) must NOT register a tool and must not even mention `registerTool` in prose — grep-matched as a plain substring.

### Omission rule for optional JSONL fields
**Source:** `.pi/extensions/diagnostics/schema.ts`/`turns.ts`, documented in `docs/DIAGNOSTICS.md`.
**Apply to:** QUAL-09's new `TurnRow` field(s). "A ratio/measurement of nothing is not zero." Every optional field is assigned with an explicit `if (x !== undefined) row.x = x;` guard, never defaulted, never written as `null`.

### Vacuity-guard test discipline
**Source:** `tests/unit/chokepoint-lint.test.ts`, `tests/unit/contributing-boundary.test.ts`, `tests/unit/workflow-budgets.test.ts`.
**Apply to:** every new unit test this phase writes (CONTEXT.md decision 9: "every test written here must be shown to FAIL if its subject is removed"). Three checks: scanned set non-empty; set-after-exemption non-empty; every rule/pattern proven live against an INLINE fixture (never a fixture file inside the scanned tree).

### Line-budget ratchet
**Source:** `tests/unit/workflow-budgets.test.ts`.
**Apply to:** any file under `.pi/extensions/quality/` that registers a command, and the whole `.pi/extensions/quality/` directory total if any file in it registers a command or tool. Budget = `Math.ceil(actual/10)*10`, raised only with a dated, reasoned `why` in the same commit as the growth.

### Redaction reuse
**Source:** `.pi/extensions/diagnostics/redact.ts`, used by `evidence.ts:41,91` and `turns.ts:71,290`.
**Apply to:** `reviewer.ts`'s context-building (diff + full file contents may carry secret-shaped content) and any new JSONL writer this phase adds (QUAL-09's cost record, calibration results if logged).

## No Analog Found

None. Every file this phase plausibly needs has at least a role-matched analog in the existing 1,791-test codebase, which is itself the phase's central finding worth restating: a plan that invents a new house style here would be inconsistent with the engineering-quality discipline it is meant to enforce.

## Metadata

**Analog search scope:** `.pi/extensions/{workflows,routing,safety,diagnostics,qoder}/`, `.pi/agents/`, `tests/{unit,integration,helpers}/`, `docs/{DIAGNOSTICS,WORKFLOWS,RUNBOOK}.md`.
**Files scanned/read in full or targeted sections:** `workflows/{evidence,index}.ts`, `routing/{guard,modes,schema}.ts`, `safety/{shell,index}.ts`, `diagnostics/{schema,turns,call-model}.ts`, `qoder/{index,client}.ts`, `.pi/agents/planner.md`, `tests/unit/{chokepoint-lint,contributing-boundary,tool-count-baseline,docs-policy,workflow-budgets}.test.ts`, `tests/integration/{single-shot-roles,qoder-delegate}.test.ts`, `tests/helpers/{faux,git,session,qoder-loopback}.ts`, `docs/{DIAGNOSTICS,RUNBOOK}.md`.
**Pattern extraction date:** 2026-08-15

## PATTERN MAPPING COMPLETE

**Phase:** 8 - Quality Gates & Engineering Quality
**Files classified:** 27
**Analogs found:** 27 / 27

### Coverage
- Files with exact analog: 22
- Files with role-match analog: 5
- Files with no analog: 0

### Key Patterns Identified
- Every new subsystem in this repo is pure-logic-modules + one thin impure dispatch layer + a small entry-point `index.ts` that composes without reimplementing — `quality/` must follow `workflows/`/`routing/`/`safety/`'s exact three-tier shape.
- Structured, schema-validated model output is achieved by a forced tool call with a typebox schema (`qoder/index.ts`'s pattern, Pi's own `structured-output.ts` example), not by parsing free-form Markdown — this is GATE-05's whole mechanism.
- The omission rule ("absent, never zero, never null" for optional JSONL fields) and the vacuity-guard test discipline (non-empty scanned set, non-empty post-exemption set, inline offending fixture) are load-bearing, repo-wide conventions this phase must not violate anywhere it touches `diagnostics/schema.ts`/`turns.ts` or writes a new unit test.
- A real, previously-shipped defect (`routing/modes.ts:409`, the Bedrock reasoning-effort shape gap) is a Wave 0/1 prerequisite for GATE-10 and has a direct fix pattern already precedented by `guard.ts`'s block-ordered, exhaustiveness-checked style.
- The `qoder-delegate.test.ts`/`qoder-loopback.ts` flake fix is a **modification**, not new-file work, and its fix pattern (event-gated promises replacing duration-based `setTimeout` racing, asserting on the lossless transcript record instead of `elapsed` wall-clock) is fully diagnosed and cross-verified against the real source this session.

### File Created
`.planning/phases/08-quality-gates-engineering-quality/08-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns and exact `file:line` excerpts in PLAN.md files for every wave of Phase 8.
