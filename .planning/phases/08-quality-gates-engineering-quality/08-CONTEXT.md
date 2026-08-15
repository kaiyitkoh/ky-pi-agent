# Phase 8: Quality Gates & Engineering Quality - Context

**Gathered:** 2026-08-15
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

A cheap executor's output is caught by the same class of defect a strong model would have caught, at a measured cost, and the fixes it produces are root-cause fixes rather than symptom patches.

**Requirements:** GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-06, GATE-08, GATE-09, GATE-10, QUAL-01, QUAL-02, QUAL-04, QUAL-05, QUAL-06, QUAL-07, QUAL-09

Deliberately NOT in this phase: **GATE-07** is already `[x]` complete (Phase 6's evidence gate — `tool_result` exit codes bound to a git SHA). **QUAL-03** (SPEC.md Root Cause section) and **QUAL-08** (gate depth scales with the workflow) belong to **Phase 9**, because both are properties of ceremonial artifacts that do not exist yet. Phase 8 builds the *mechanisms* QUAL-08 will later dial; it does not build the dial.

**Depends on:** Phase 2 (`callModel()` chokepoint, the JSONL turns ledger, the wire inspector, `/budget`), Phase 5 (routing — role planning, capability guard, `agentOverrides`), Phase 6 (`/quick` and the evidence gate — the first consumer of a deterministic gate stage), Phase 7 (`.pi/agents/planner.md` as the agent-file template, the vendored extension tree, `docs/EXTENSIONS.md`). **Phase 7's dependency is materially weaker than the ROADMAP assumed — see the two corrections below.**

**Success criteria (from ROADMAP.md, binding — this is the spec):**

1. Typecheck, lint, LSP diagnostics and **deterministic** anti-pattern rules (magic numbers, literal-value special-casing, copy-paste duplication, swallowed exceptions, shipped `TODO`/`FIXME`, N+1 shapes) run and feed errors back **before** any model review, adding **no model round trip and no measurable wall-clock**.
2. A seeded defect the cheap executor misses is caught by the gate, and **seeded-defect calibration** reports what share of injected defects the reviewer actually finds — distinguishing "the code is clean" from "the reviewer is asleep".
3. Review output carries a per-requirement verdict (Implemented / Partial / Missing) with `file:line` evidence, a **mandatory "checked and cleared" section** so silence is structurally impossible, BLOCKER/WARNING/NIT classification with **unclassified findings REJECTED AS MALFORMED**, and a **refute-or-promote pass** before a BLOCKER can stop work.
4. Every change is classified **root-cause / symptomatic / workaround** with written justification **on the review pass already being paid for**; symptomatic and workaround changes **STOP the workflow** pending explicit approval, and an approved workaround is recorded with what the proper fix would be and why it was deferred.
5. The wall-clock and token cost the quality layer adds is a **RECORDED NUMBER PER TURN in the JSONL**, so the correctness/latency balance is measured and tunable rather than guessed.

**Contains [RUNBOOK] requirements: GATE-10, main-loop half only.** The nested-role half (reviewer / advisor / summariser thinking budgets) is `fauxProvider`-verifiable and must be **built and proved here** — it is unblocked, because `modelRegistry.complete()` takes exact per-call `reasoningEffort` / `thinkingEnabled` / `thinkingBudgetTokens` and Phase 2's `callModel()` already routes them. The **main-loop** half stays gated on Phase 2 having proved the parameters actually land on the wire, which is `RB-02-01` and still OUTSTANDING. **Do not conflate the two halves.** Append `RB-08-xx`; `RB-01-01` … `RB-07-03` exist — **append, never renumber**. `tests/unit/docs-policy.test.ts` reads each status from *two* places (the summary-table row and the `**Status:**` line under `### RB-08-xx — …`) and reports `INCONSISTENT` — never an acceptable status — if they disagree; add the new ids to `PHASE_EIGHT_IDS` and `ALL_IDS` and their commands to `ENTRY_COMMANDS` in the same change.

</domain>

<decisions>
## Implementation Decisions

Recorded in PROJECT.md (Key Decisions, Constraints), ROADMAP.md, REQUIREMENTS.md, CONTRIBUTING.md and `.planning/research/{FEATURES,PITFALLS,ARCHITECTURE,SUMMARY}.md`. Binding on this phase; not to be re-derived and not to be re-litigated.

### *** TWO CORRECTIONS TO PROJECT-WIDE ASSUMPTIONS — READ BEFORE PLANNING ***

**1. The dev machine DOES hold live credentials.** Phase 7 verified `aws sts get-caller-identity` exits 0 against **long-lived static IAM admin keys in plaintext at `~/.aws/credentials`**. The project's "no credentials on the dev machine" premise is **false as a security assumption**; it holds only in the narrow sense that no *provider inference* key is configured for Pi. Consequences binding on every plan in this phase: **do NOT execute `[RUNBOOK]` items against these credentials; do NOT issue provider inference requests; treat any supply-chain or tool-execution decision as running next to live admin credentials.** See `.planning/STATE.md` → Blockers/Concerns.

**2. Phase 7 installed NOTHING.** The package-legitimacy gate (plan 07-10) correctly refused to auto-approve. `pi-subagents@0.49.0`, `@narumitw/pi-lsp@0.49.4`, `pi-web-access@0.22.0`, `pi-background-tasks@2.4.2` and `pi-session-finder@0.5.6` are **reviewed, pinned in `.pi/settings.json` `packages[]`, and NOT INSTALLED** — one approval away, recorded in `docs/EXTENSIONS.md` and in `RB-07-02` (OUTSTANDING). The ROADMAP says Phase 8 depends on Phase 7 for "reviewer subagent, LSP". **Plan accordingly:**

- Build and unit-verify **everything** offline against Phase 2's `callModel()` and `fauxProvider`.
- Structure the **LSP-diagnostics gate so it degrades honestly when the LSP extension is absent** — report `UNAVAILABLE`, **never silently pass**. An absent LSP that reports "clean" is precisely the Phase 4 failure ("a guard entirely absent headless while its tests passed") reappearing.
- Put anything that genuinely needs the installed extensions behind an **appended `RB-08-xx` entry marked OUTSTANDING**.
- **Do not plan around installing them yourself.** The reviewer subagent's *agent file*, *prompt contract*, *output parser* and *calibration harness* are all authorable and testable with nothing installed; only the live `pi-subagents` spawn is not.

### Already decided, binding

1. **Deterministic gates run FIRST, ALWAYS, and add no model round trip.** They are the best reliability-per-token item in the harness and feed three downstream consumers (the reviewer payload, the JSONL cost record, the workflow gate). Criterion 1's "no measurable wall-clock" is an assertion the plan must *make measurable*, not a claim to repeat.

2. **Every model call goes through Phase 2's `callModel()` chokepoint.** `tests/unit/chokepoint-lint.test.ts` makes a `modelRegistry.complete` call outside `diagnostics/` a **build failure**. The reviewer, the advisor and the summariser are all nested calls through `callModel()`. **Do not weaken or exempt this lint**, and do not add a second escape hatch for the reviewer.

3. **Boundary rule (BOOT-10, `CONTRIBUTING.md`).** A new capability defaults to **COMMAND (0 tokens)** or **SKILL (~40–60 tok index)**; registering a **TOOL** requires answering three questions in writing — (a) must the *model* call it mid-turn, (b) what is the *measured* schema token cost, (c) why can a skill not carry it — and extending `TOOL_REGISTRATION_ALLOWLIST` in `tests/unit/contributing-boundary.test.ts` in the same change. The current allowlist is exactly four entries (`safety/index.ts`, `qoder/index.ts`, `todo.ts`, `questionnaire.ts`) = the measured **4 tools / 1015 tokens** live baseline. **Phase 10 will cut this — do not inflate it here.** Any tool this phase does register must also gain a `TOOL_COUNT_BASELINE` row in `tests/unit/tool-count-baseline.test.ts`, which fails on an entry point that registers a tool without one.

4. **Nested-role thinking budgets are UNBLOCKED; main-loop budgets stay GATED.** Stated again because conflating them is the single most likely planning error in this phase. Reviewer / advisor / summariser budgets are cheap and verifiable through `callModel()` + `fauxProvider`, which can assert on the **outgoing** request. Main-loop budgets are `RB-08-xx`.

5. **The reviewer context contract is fixed and complete** (GATE-02): diff + **FULL CONTENTS of every touched file** + test/typecheck output + SPEC requirements + files-touched union + **the import graph**. A reviewer seeing only the diff misses bugs of omission and cross-file breakage — that is the documented cause, not a preference. The test/typecheck output is **passed from the deterministic stage, not re-run**.

6. **The anti-review-theatre protocol is TWO-SIDED by design.** LLM reviewers silently approve when unsure, **and** a reviewer told to find gaps will invent them. Structural countermeasures: fresh subagent context (never the implementer's reasoning); adversarial framing with a **named soft-failure list** ("stopping at surface issues", "treating tests-pass as correctness", "downgrading BLOCKER to WARNING to avoid seeming harsh"); mandatory per-requirement verdict; mandatory "checked and cleared"; findings scoped to correctness + stated requirements with NITs capped; bounded loop (BLOCKER → fix → re-review, max 2 iterations, with stall detection). **Refute-or-promote applies to BLOCKERs ONLY** — one refutation pass each, before a BLOCKER can stop work.

7. **Exhortation is explicitly NOT the mechanism.** `AGENTS.md` saying "write robust code" is the weakest possible lever (REQUIREMENTS.md, Engineering Quality preamble). QUAL-01…09 are the enforcement. A plan whose deliverable is prose in a prompt has not met the requirement.

8. **`/quick` already exists and already composes route → guard → execute → evidence → commit** (Phase 6, `docs/WORKFLOWS.md`). The deterministic gate stage must be callable *from* it without breaking its **≤80-line budget**, enforced by `tests/unit/workflow-budgets.test.ts`. Put the gate logic in a module `/quick` calls; do not inline it.

9. **Be suspicious of green.** This is the phase whose subject *is* that suspicion, so it applies with maximum force: every test written here must be shown to FAIL if its subject is removed, and no test may write outside the repo or a temp dir. Phase 7's review found a test **labelled "MUTATION-VERIFIED" that survived its own mutation**.

### Claude's discretion (guided by ROADMAP criteria + `.planning/research/`)

Where the deterministic gate module lives and its exact function boundary; whether the reviewer is a command, a skill, or a vendored extension (subject to the boundary rule); the exact `REVIEW.md` on-disk schema and whether it is Markdown-with-a-parser or JSON-with-a-renderer; whether the seeded-defect corpus lives in `tests/fixtures/` or a dedicated directory; the JSONL field names for QUAL-09; whether the anti-pattern rules are one module or one module per rule; how the refute-or-promote pass is sequenced (second `callModel` vs. structured second section of the same response — note criterion 4 says the *classification* is "extra structure on the review pass already being paid for", which constrains QUAL-04 but not GATE-06).

### Decisions taken autonomously during context generation

*(Per the Standing Operating Policy — the user is asleep; noted here rather than asked.)*

- **Phase slug is `08-quality-gates-engineering-quality`**, following Phases 3–7's convention of dropping `&` and punctuation.
- **QUAL-01's "ast-grep" is satisfied by the TypeScript compiler API, not by installing `ast-grep`.** The requirement names ast-grep as a *mechanism example*; its substance is the six rule classes. `typescript@5.9.3` is **already a pinned devDependency** and already in the tool path via `tsc --noEmit`, so it gives a real, typed AST at **zero new supply-chain surface** — decisive on a machine that Correction 1 establishes is holding live IAM admin keys. **This is not merely preferable, it is close to forced:** `tests/unit/pinning.test.ts:253` asserts `Object.keys(devDependencies)` equals **exactly six audited pins** (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@types/node`, `typebox`, `typescript`, `vitest`). Any new lint or ast-grep dependency **fails that test** and demands a full Package Legitimacy Audit — the same gate Phase 7 correctly refused to auto-approve. This is precisely why `chokepoint-lint.test.ts` is a hand-rolled grep rather than an ESLint rule. `.npmrc` is also hardened with `ignore-scripts=true`, so a package needing a postinstall would break the bootstrap regardless. **A regex-based "AST" rule is still not acceptable** — that is Phase 4's `git.exe push` exact-string failure repeating; the rules must walk real syntax nodes, which `typescript` gives for free.
- **"lint" in GATE-01 means the repo's own authored structural gates plus `tsc --noEmit`.** The de-facto lint layer here is **vitest**: `chokepoint-lint`, `contributing-boundary`, `jsonl-append-only`, `extension-layout`, `pinning`, `gitignore-policy`, `docs-policy`, `npmrc-policy`, `secret-scan`, `ci-pinning`, `lf-and-shell`, `evasion-corpus`. Of criterion 1's four gate legs, **only typecheck exists today** — lint-as-anti-pattern-rules, LSP diagnostics and the six QUAL-01 rules are all new build. `npm test` + `npm run typecheck` are the existing CI-enforced gate on `windows-latest` and `macos-latest`.
- **The flaky `tests/integration/qoder-delegate.test.ts` is folded into this phase** — see `<specifics>`. It is Phase 3 code, but "the suite is only usually green" makes every "tests green" claim in this project unfalsifiable, which is exactly what this phase exists to prevent.

</decisions>

<code_context>
## Existing Code Insights

Phases 1–7 built the machine this phase gates. **1,791 tests green, `tsc --noEmit` clean.** Read the real signatures and the real files before planning against them.

**`.pi/` today (every file tracked):**

```
.pi/agents/planner.md
.pi/extensions/checkpoint/{git,index,store}.ts + PROVENANCE.md
.pi/extensions/diagnostics/{budget,call-model,index,jsonl,prose,redact,schema,turns,wire}.ts
.pi/extensions/harness/index.ts
.pi/extensions/loop-police/{index,loop-police}.ts + .json + PROVENANCE.md
.pi/extensions/plan-mode/{index,read-only,utils}.ts + PROVENANCE.md
.pi/extensions/providers/{fallback,index,schema,sso}.ts
.pi/extensions/qoder/{client,index}.ts
.pi/extensions/routing/{agent-overrides,guard,index,modes,schema}.ts
.pi/extensions/safety/{approvals,audit,git,index,infra,paths,policy,schema,shell}.ts
.pi/extensions/todo.ts + .PROVENANCE.md
.pi/extensions/questionnaire.ts + .PROVENANCE.md
.pi/extensions/workflows/{evidence,index}.ts
.pi/lib/jsonl.ts
.pi/settings.json   (packages[] — five pinned specs, NOT INSTALLED)
.pi/templates/{auth,models}-template.json
.pi/skills/ .pi/prompts/ .pi/themes/   (still just .gitkeep — nothing here yet)
```

**Phase 2 — the instrument this phase must extend, not duplicate.**
- `.pi/extensions/diagnostics/call-model.ts` (496 lines) is the **chokepoint**:
  ```ts
  export interface CallModelOptions<TApi extends Api> {
    role: string;            // MANDATORY, no default — the join key for turns <-> wire
    model: Model<TApi>; systemPrompt?: string; messages: Message[]; tools?: Tool[];
    api?: WithoutCaptures<ModelsApiStreamOptions<TApi>>;   // <-- thinking params live HERE
    signal?: AbortSignal;    // defaults to ctx.signal
  }
  export async function callModel<TApi extends Api>(ctx, opts): Promise<AssistantMessage>
  ```
  **`reasoningEffort` / `thinkingEnabled` / `thinkingBudgetTokens` have no dedicated field — they are per-API pass-through inside `opts.api`.** GATE-10's nested half is therefore about threading and *proving* them, not about adding a parameter. `thinkingBudgetTokens` is currently threaded nowhere in `.pi/`; only `thinkingLevel` (a string, from `ctx.thinkingLevel`) is recorded, and only on main-loop rows. Each call emits 3 wire records + exactly 1 `kind:"nested"` turns row, **on both success and throw**, all containment-wrapped.
- **`.pi/extensions/routing/modes.ts` `runSingleShotRole(ctx, {role, messages, systemPrompt?, need})` is the Phase 8 entry point for a reviewer or advisor call.** It plans via `planRoleCall`, then dispatches through `callWithFallback()` when the resolved model is the chain HEAD, else `callModel()` directly, and sets `api = { reasoningEffort }` only when the route declares one. **`ROLES` already contains `reviewer`, `advisor` and `summariser`** (`routing/schema.ts`), with `ROLE_MECHANISM`, `AGENT_NAME_BY_ROLE` and a `RoleRoute.reasoningEffort?: "high" | "max"` per mode in `ROLE_MAP`. **The roles exist and are routed — this phase gives them behaviour. Do not invent a parallel role system.**
- `.pi/extensions/diagnostics/schema.ts` defines `TurnRow`; `docs/DIAGNOSTICS.md` §"The turns row" documents **every field and its provenance** and is the contract QUAL-09 extends. Two rules there are binding on any new field:
  - **The omission rule.** An optional field is *genuinely absent* from the JSON, never present-and-`null` and never present-and-`0`. "A ratio of nothing is not zero." Any consumer treating a missing key as `0` reintroduces exactly the fabrication this rule prevents.
  - **Rows that are not turns carry no `kind`.** That is the discriminator; per-turn totals sum over `kind:"turn"`. A quality-layer cost record must decide deliberately whether it is a field on the turn row or a separate `event`-bearing row, and `docs/DIAGNOSTICS.md` must be updated in the same change (the doc's own contract: "if the code and this document disagree, the code is authoritative and this document is a bug").
  **The exact recipe for adding QUAL-09's field is three edits, no more:** (1) add the optional field to `TurnRow` in `schema.ts`, honouring the omission rule; (2) add the matching optional to `TurnRowInput` in `diagnostics/turns.ts` and assign it conditionally in `composeTurnRow` (`if (input.x !== undefined) row.x = input.x;` — the existing pattern at `turns.ts:279`); (3) pass it from the producers — `call-model.ts`'s two `recordTurn(...)` sites (`:465`, `:481`) and/or `diagnostics/index.ts`'s `turn_end` handler (~`:632`). Note `TurnRow.latencyMs` **already exists** as the turn's wall clock, so QUAL-09's number is the *quality-layer share*, not the turn total — a distinction the plan must state or the field will be meaningless. `cost` is always **recomputed** via `calculateCost`, never copied from `usage.cost` (fauxProvider hardcodes zeros).
- `.pi/extensions/diagnostics/budget.ts` (702 lines) + `tests/unit/budget-{command,sections}.test.ts`. `computeBudget` is **pure**. **`/budget` today reports tokens and chars only — no dollar cost and no wall-clock.** Dollar cost exists solely on `TurnRow.cost` in `turns-*.jsonl` and **nothing aggregates it yet.** That aggregation is the QUAL-09 gap, and it is a real gap, not a rename.
- `.pi/extensions/diagnostics/wire.ts` — the wire inspector; `fauxProvider` response steps may be a **factory receiving `(context, options, state, model)`**, so a test can assert on the **outgoing** `reasoningEffort`. That is exactly how GATE-10's nested half gets proved with no provider and no credentials.
- `tests/unit/chokepoint-lint.test.ts` — the BUILD-FAILING lint. Exempt prefix is the **directory** `".pi/extensions/diagnostics/"`; `CHOKEPOINT_BYPASS_ALLOWLIST` is empty by design. Seven forbidden patterns, matched against **raw source including comments**: `modelRegistry.complete`, `.completeSimple`, `.stream|.streamSimple`, `.getProvider`, `getRegisteredNativeProvider`, `from "@earendil-works/pi-ai/api/…"`, `ModelRuntime`. Explicitly permitted: `.find`, `.getAvailable`, `.getAll`, `.hasConfiguredAuth`, `.getProviderAuthStatus`, `.registerProvider`. **Consequence for this phase: a new reviewer or gate file outside `diagnostics/` may not even mention those strings in a comment.**

**Phase 5 — `.pi/extensions/routing/`.** `guard.ts` (capability guard), `modes.ts`, `agent-overrides.ts` (writes `settings.subagents.agentOverrides`; `agentOverridesFor` is **pure** and test-injectable), `index.ts`. The reviewer and advisor are *roles*: route them through the existing role machinery, do not hardcode a model.

**Phase 6 — `.pi/extensions/workflows/{evidence,index}.ts`.** `/quick` is a **command** (0 per-turn tokens), `index.ts` is 78 lines, and `docs/WORKFLOWS.md` §2 documents its seven ordered checks. `evidence.ts` (335 lines) is the GATE-07 evidence gate; `gateCompletion(records, headSha, baseSha)` is now a **first-match-wins five-branch predicate with binding order** (empty → reject; `headSha === baseSha` → reject; any `isError` anywhere → reject, deliberately *before* the SHA narrowing so a later commit cannot age out a failure; no record at `headSha` → reject as stale; else accept). It reads **only** Pi's structural `isError` and a SHA the harness read itself — never `message.content`. The fabricated-claim hole was closed over three review iterations.

**One residual on that gate is explicitly deferred TO THIS PHASE, and is in scope:** an **empty commit (`git commit --allow-empty`) or a commit of wholly unrelated content still ACCEPTS.** Distinguishing "the commit contains the work" needs a diff or tree hash, and `evidence.ts:136-143` plus `docs/WORKFLOWS.md` §4 both name **Phase 8** as its owner. The accept notification is currently worded honestly around the gap ("HEAD moved … the work itself is NOT verified"). Closing it is a natural GATE-01/QUAL-04 companion task — the deterministic stage already computes a diff for the reviewer payload, so the tree comparison is nearly free once that exists. **If the plan does not close it, it must say so and leave the honest wording intact — it must not be quietly dropped.**

Treat the Phase 6 incident itself as a seeded-defect class (below), not as history.

**Phase 7 — the reviewer's raw material.**
- `.pi/agents/planner.md` is the **template for `.pi/agents/reviewer.md`**: frontmatter `name / description / tools / thinking / systemPromptMode: replace / inheritProjectContext: false / inheritSkills: false`, and a trailing HTML comment explaining the **deliberate absence of a `model:` key**. A `model:` key here permanently and silently pins the agent, defeating Phase 5 (`pi-subagents@0.49.0 src/agents/agents.ts:1155` only fills a model when the agent's own frontmatter has none). `fallbackModels:` is withheld for the same reason. **Copy the discipline, and the comment, verbatim in spirit.**
- `docs/EXTENSIONS.md` carries the provenance record, the per-package model-facing tool counts, and the honest `UNVERIFIED` install-reconciliation verdict. `@narumitw/pi-lsp@0.49.4` registers exactly **two** tools — `lsp_diagnostics` and `lsp_fix` (`src/pi-lsp.ts:146-147`). Those are the names the LSP gate probes for; the gate must not assume they are present.

**Enforcement machinery this phase must extend rather than sidestep:**
| File | What it enforces |
|---|---|
| `tests/unit/chokepoint-lint.test.ts` | `modelRegistry.complete` outside `diagnostics/` = build failure |
| `tests/unit/contributing-boundary.test.ts` | `TOOL_REGISTRATION_ALLOWLIST` — 4 entries today |
| `tests/unit/tool-count-baseline.test.ts` | every tool-registering entry point needs a `TOOL_COUNT_BASELINE` row |
| `tests/unit/workflow-budgets.test.ts` | `/quick` ≤80 lines |
| `tests/unit/docs-policy.test.ts` | `RB-xx-yy` status consistency across two places; `PHASE_*_IDS` + `ALL_IDS` + `ENTRY_COMMANDS` |
| `tests/unit/lf-and-shell.test.ts` | POSIX `sh` only, LF, `dash -n` parse |
| `.github/workflows/ci.yml` | vitest + `tsc --noEmit` on `windows-latest` and `macos-latest`; **a failing vitest test is already a failing build** — do not invent a second CI mechanism |

**Test helpers already available — reuse, do not rewrite:** `tests/helpers/{faux,session,models,pi,logs,git,stub-bin,win-quote,loopback,qoder-loopback,bootstrap-repo}.ts`. For this phase the load-bearing ones are **`faux.ts`** (scripted provider; response steps may be a factory receiving `(context, options, state, model)`, so you can assert on the outgoing `reasoningEffort` — this is how GATE-10's nested half is proved), **`session.ts`**, **`git.ts`** (temp repo — the only honest way to build a seeded-defect diff), and **`logs.ts`** (JSONL assertions for QUAL-09).

**Tooling that EXISTS vs. does NOT.** Exists: `typescript@5.9.3` (+ `tsconfig.json`, `npx tsc --noEmit` in CI), `vitest@4.1.9`, `unbash@4.0.10` (runtime dep, Phase 4's AST parser — the precedent for "parse, don't match strings"), exactly three npm scripts (`test`, `test:unit`, `typecheck`), and exactly one file in `scripts/` (`check-gh-unauthenticated.sh`). **Verified absent across the whole repo:** any ESLint / oxlint / Biome / Prettier config, any `ast-grep` / `sgconfig.yml` / `.ast-grep/` (the string "ast-grep" appears nowhere in the repo outside `REQUIREMENTS.md`), any `lint` script, any LSP-diagnostics runner, any duplication or complexity tool, and any installed Pi extension. **Adding any of them trips `tests/unit/pinning.test.ts:253`** — see the decisions section.

**Test layout:** `tests/unit/` 62 files, `tests/integration/` 35 files, **97 `*.test.ts` total**. `vitest.config.ts` sets `environment: "node"`, `testTimeout`/`hookTimeout` `120_000`, `passWithNoTests: false`, `globalSetup: ["./tests/global-teardown.ts"]` (a dirty-tracked-file tripwire) and `setupFiles: ["./tests/setup/agent-dir.ts"]` (**blocks any test resolving `getAgentDir()` to the real `~/.pi/agent`** — the Phase 5 escaped-side-effect defect, already fixed structurally; keep it that way). Phase-8-adjacent tests that already exist and should be extended rather than duplicated: `chokepoint-lint`, `evidence-gate`, `capability-guard`, `routing-{map,dispatch}`, `agent-overrides`, `budget-{command,sections}`, `call-model-containment`, and integration `call-model`, `quick-workflow`, `turns-log`, `wire-proof`.

**Pi 0.84.1 is at `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\`** and ships 80 `examples/extensions/`. Original TypeScript for anything in `dist/` is recoverable from `dist/**/*.js.map` `sourcesContent`. **Cite `file:line`; mark anything unverifiable as UNVERIFIED rather than asserting it.**

</code_context>

<specifics>
## Specific Ideas

### The seeded-defect corpus — built from THIS project's real, observed failures

Success criterion 2 asks calibration to distinguish "the code is clean" from "the reviewer is asleep". A corpus of invented synthetic bugs (an off-by-one, a null deref) measures the wrong thing, because it is not what this harness actually gets wrong. **This project has already generated five real failure classes across six phases. Use them.**

| # | Real incident | Phase | Defect class to seed |
|---|---|---|---|
| 1 | An evidence gate **ACCEPTED a fabricated completion claim**, through three consecutive rounds of green tests | 6 | Fabricated evidence — a claim with no matching `tool_result`, output that predates the last edit |
| 2 | A **wire-proof test that structurally could not distinguish a routing decision from a hardcoded chain head** | 5 | Tautological test — passes identically whether the subject exists or not |
| 3 | A suite **writing into the developer's real `~/.pi/agent/settings.json`** | 5 | Escaped side effect — a test touching state outside the repo/temp dir |
| 4 | A guard **entirely absent headless while its tests passed**; **exact-string matching that allowed `git.exe push`** | 4 | Absent-in-the-real-path guard; string matching where parsing is required |
| 5 | Three "fixes" to tautological tests **that were themselves tautological** | 3 | Symptomatic fix — the recurrence QUAL-04 exists to classify |
| 6 | A test **labelled "MUTATION-VERIFIED" that survived its own mutation** | 7 | A label asserting a property the code does not have |

**The recurring class is *tests that cannot fail*.** A calibration suite without mutation/falsification defects is measuring the wrong thing. The corpus should therefore be dominated by defects that are *invisible to a green test run* — which is also the only honest way to demonstrate that the deterministic stage (which runs the tests) is genuinely insufficient and the model reviewer is genuinely earning its cost.

Calibration reports a **catch rate**, per defect class, as a number — not a verdict. A run where the reviewer catches 2 of 6 is a *result*, and the phase is complete when the number exists and is reproducible, **not** when the number is good. Fabricating or tuning to a target here would be defect class #1 committed by this phase itself.

### The LSP gate, given the extension is not installed

Three states, and the third is the one that matters:

- **PASS** — the LSP extension is present and reported no diagnostics.
- **FAIL** — present, and reported diagnostics; these feed back before any model review.
- **UNAVAILABLE** — not present. **This is not a pass.** It must be reported distinctly, propagate as "this check did not run", and be visible in whatever the gate returns to `/quick` and to the JSONL. Silence here is Phase 4's headless-guard failure in a new costume.

The probe must be against **observable reality** (is the extension loaded / are `lsp_diagnostics` and `lsp_fix` registered), not against `.pi/settings.json` `packages[]` — that file lists five packages that are pinned and **not installed**, so reading it would report available for a gate that cannot run. The live check belongs in an `RB-08-xx` entry marked OUTSTANDING.

### The intermittently-red integration test — DIAGNOSE and FIX, do not paper over

`tests/integration/qoder-delegate.test.ts` (686 lines, 11 `describe`, 20 `it`) is red roughly **1 run in 5**. It is pre-existing **Phase 3** code. **The root cause was diagnosed during context generation and is CONFIRMED — the plan implements the fix, it does not re-investigate.**

**The failing assertion is one line: `qoder-delegate.test.ts:545-549`, `expect(elapsed).toBeLessThan(400)`.** In the `WR-07` inactivity-timeout case (`:501-571`): `injectedTimeoutMs = 60` (`:512`), `splitDelayMs = 400` (`:513`), and `const start = Date.now()` is taken at `:523` **before `delegateTask`** — so `elapsed` (`:527`) contains three full HTTP round trips and six synchronous JSONL appends (`client.ts:602,619,654,666,679,689` → `appendFileSync` + `mkdirSync`) *before* the 60 ms deadline arms at `client.ts:706-710`. Total slack for all of that plus `setTimeout` overshoot is **340 ms**. Under vitest's defaults — `vitest.config.ts` sets no `pool`/`poolOptions`/`fileParallelism`, so `pool: "forks"` with `maxForks = availableParallelism() - 1` — and with 17 of 33 integration files spawning real child processes (`audit-concurrency.test.ts:309` and `jsonl-concurrency.test.ts:168` each fan out 4 OS processes writing up to 200 KB), 340 ms of combined fetch + fsync + timer drift on Windows is routinely exceeded. `Date.now()` at `client.ts:710` keeps counting through event-loop starvation, so a starved worker trips the pre-read branch *late* and inflates `elapsed` too. Secondary manifestation of the same cause: starvation >400 ms **before** `client.ts:706` puts both server writes in the socket buffer, the client never sees a gap, and `rejects.toThrow` at `:524` fails instead. Ruled out with evidence: `lastProgressAt` is written in exactly two places (`client.ts:706`, `:770`), both test-controlled, and `signal` is not in the `Promise.race`; ports are ephemeral (`qoder-loopback.ts:401`); log cwd, `PI_CODING_AGENT_DIR` and the `globalThis` JSONL caches are all per-file-temp-dir keyed and cannot collide.

**The deterministic fix — make the stall an EVENT, not a duration:**
1. Replace `splitDelayMs` (`qoder-loopback.ts:121,247,263-265`) with a caller-supplied gate: a `releaseSecondChunk: Promise<void>` plus a `firstChunkWritten: Promise<void>` on `QoderLoopbackHandle`. The server writes half one, resolves `firstChunkWritten`, then awaits the gate.
2. **`await` the responder instead of `void`-ing it** (`qoder-loopback.ts:374` is `void answer().catch(...)`, and `withQoderLoopback`'s teardown at `:443-452` destroys sockets while that 400 ms timer may still be pending in the same worker event loop — a live timer leaked into neighbouring tests).
3. In the test: `await loop.firstChunkWritten` — which proves the "the first read really happened" property the `>= 60` bound was standing in for — then assert the rejection, then release the gate.
4. **Delete both elapsed bounds (`:539-549`).** The property they were approximating is already recorded losslessly: `client.ts:720/:755` write `afterMs: inactivityTimeoutMs` and `textChars: folded.text.length` into the transcript. Asserting `afterMs === 60` and `textChars > 0` is **strictly stronger** than `60 <= elapsed < 400` and has zero timing dependence.
5. Optional hardening: add `readonly now?: () => number` to the options and use it at `client.ts:706,710,770`. Note that full `vi.useFakeTimers` would **deadlock** the `Promise.race` at `client.ts:734` — the read side needs a real event loop. (There are currently zero `useFakeTimers` in the repo.)

Explicitly **not** acceptable, each a QUAL-04 "symptomatic" or "workaround" by this phase's own definition: a retry; a wider bound; raising `testTimeout` (already 120 s — the flake is not a timeout); `it.skip`; or serialising the suite with `fileParallelism: false`, which hides the same race behind a global slowdown.

This is squarely engineering quality: **a suite that is only usually green makes every "tests green" claim in this project unfalsifiable** — the exact property Phase 8 exists to establish.

### The traps this phase most plausibly falls into

- **Building the reviewer as a prompt and calling it a gate.** GATE-03/04/05 are *parser* requirements: an unclassified finding must be **rejected as malformed by code**, not discouraged by wording. If the harness would accept "LGTM", the requirement is not met however good the prompt is.
- **A calibration harness that grades itself.** The corpus, the injection, and the scoring must be separable, and the scorer must be shown to report a *low* number when handed a deliberately blind reviewer. A calibration suite that only ever reports 100% is defect class #2.
- **Conflating GATE-10's two halves.** Nested = build it and prove it with `fauxProvider`. Main loop = `RB-08-xx`, OUTSTANDING, never passing.
- **Letting the deterministic stage cost a round trip.** QUAL-02 is explicit: same stage, no extra model call, no measurable wall-clock. Measure it; do not assert it.
- **Regex "AST" rules.** Phase 4 already learned this the expensive way (`git.exe push`). Walk syntax nodes.
- **Registering a tool because it is convenient.** Boundary rule, three written answers, allowlist + baseline updated in the same change. Phase 10 is going to cut this number.
- **Executing a `[RUNBOOK]` item because the credentials happen to work.** Correction 1. They work; that is the problem, not the permission.
- **Re-enabling UI gates.** `workflow.ui_phase`, `ui_safety_gate` and `ui_review` are `false` deliberately. This phase has no UI surface.

</specifics>

<deferred>
## Deferred Ideas

- **QUAL-03** (SPEC.md Root Cause section, gated like Verified Codebase Facts) and **QUAL-08** (gate depth scales with the workflow) — **Phase 9**. Both are properties of ceremonial artifacts Phase 8 does not build. Phase 8 builds the mechanisms; Phase 9 dials them.
- `/grill`, `/plan`, `/execute`, `/review` as ceremonial workflows, and the `glab` MR step that QUAL-06's "recorded in the MR body" ultimately lands in — **Phase 9**. Phase 8 must produce the *record* and its schema; where it is rendered is Phase 9's problem.
- Measuring and **cutting** per-turn token cost, `pi.setActiveTools()` profiles, dynamic tool loading, the `AGENTS.md` budget — **Phase 10**. Phase 8 must not inflate the 4-tool / 1015-token baseline.
- The minimal-vs-full-harness controlled experiment that discriminates the three root-cause candidates for "DeepSeek misses bugs Sonnet would catch" — **Phase 10**, and it is `[RUNBOOK]` (CTX-05).
- Statusline / subagent activity widget / authored theme — **Phase 11**.
- **Any live-credential execution**: the main-loop thinking-budget wire proof, the reviewer running through a real `pi-subagents` spawn, the LSP gate against a real language server, and any provider inference request. Each becomes an `RB-08-xx` entry marked **OUTSTANDING** — built here, proved offline here, **never claimed as passed here**.
- Installing the five pinned specs — that is `RB-07-02`, already OUTSTANDING, and is **not** this phase's job.
- Resolving the unpushed-history identifier risk — `RB-07-03`, needs the user.

</deferred>
