# Phase 5: Routing & Capability Guards - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

The user chooses which model does which job explicitly, and the harness refuses routes that are impossible rather than degrading silently.

**Requirements:** ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, ROUTE-05, ROUTE-06, ROUTE-07, ROUTE-08, ROUTE-09, ROUTE-10, ROUTE-11

**Depends on:** Phase 2 (to verify — `callModel()`, the wire dump, the chokepoint lint), Phase 3 (for models to exist — the DashScope provider template and `callWithFallback`).

**Success criteria (from ROADMAP.md, binding — this is the spec):**

1. `/cheap`, `/balanced` and `/max` swap the whole role→model map across executor, planner, reviewer, advisor, vision and summariser — and the resulting wire dump proves the intended model actually served the next turn.
2. Mode survives a restart at zero context-token cost, and `/escalate` state is visible and sticky until explicitly cleared.
3. Impossible routes are refused with a reason instead of degrading silently: image → text-only model, oversized context → small-window model, Bedrock non-Claude with thinking enabled (the configuration is dropped while the UI still offers it), and Bedrock DeepSeek R1 as executor (it supports no tool calling at all).
4. Single-shot roles run through `callModel()` with per-call reasoning effort and no session mutation; roles needing a tool loop run as subagents.
5. **Verified live on the work laptop**: Qoder accepts a delegated task and folds the result back, documented as a *foreign agent* that bypasses the harness's tools, safety hooks and wire inspector.

**Contains [RUNBOOK] requirements:** ROUTE-11 only. There are **no work-laptop credentials, no `QODER_PERSONAL_ACCESS_TOKEN` and no network egress from this machine**, so ROUTE-11 is planned as an appended `RB-05-xx` entry in the existing `docs/RUNBOOK.md` whose live check is **OUTSTANDING**. It may not be planned as passing. `RB-01-xx`, `RB-02-xx`, `RB-03-xx` and `RB-04-xx` already exist — **append, never recreate or renumber**. `tests/unit/docs-policy.test.ts` parses both the summary-table row and the `**Status:**` line of every `RB-<phase>-<n>` entry and reports a disagreement as `INCONSISTENT`; that guard must keep passing.

ROUTE-02..ROUTE-10 carry `[FAUX]`: they are fully verifiable on this machine with `fauxProvider` + `SessionManager.inMemory()` and must be planned as *passing*, not outstanding. ROUTE-01 carries no tag — it is the role→model map itself, a committed artifact, and is likewise verifiable here.

</domain>

<decisions>
## Implementation Decisions

Recorded in PROJECT.md (Key Decisions, Constraints), ROADMAP.md and `.planning/research/{ARCHITECTURE,PITFALLS,STACK,SUMMARY}.md`. Binding on this phase; not to be re-derived and not to be re-litigated.

**Already decided, binding:**

1. **Routing is THREE mechanisms, not one — and which one applies is decided by the role, not per turn.** (ARCHITECTURE:50-57, the executive answer to the project's highest-risk question.)
   - **Executor + `/escalate`** → `pi.setModel()` from a **command handler**, after `await ctx.waitForIdle()`. The wait removes the race entirely. The visible footer change is a *feature*: the user can see what they are paying for.
   - **Single-shot roles (review, advisor, vision, summarise)** → `ctx.modelRegistry.complete()` **via Phase 2's `callModel()` chokepoint**, with per-call reasoning effort and **no session mutation**.
   - **Roles needing a tool loop** → **subagents**.

2. **DO NOT build a virtual `streamSimple` provider.** Explicitly out of scope for v1 (ARCHITECTURE:57). Three of the four surveyed router extensions use it, and it is the right tool for *automatic per-turn* routing — which is precisely the thing this project's first Key Decision rejects ("explicit role→model mapping, no auto-classification"). Its costs are concrete: it takes over the `/model` picker, `PI_MODEL` reports the virtual id rather than the real one (`docs/environment-variables.md:27`), thinking-level clamping runs against the virtual model's `reasoning` flag and `thinkingLevelMap`, and cost accounting depends on forwarding the real `Model` object downstream (`pi-router`'s mirror models carry `cost: {0,0,0,0}`). Keep it as a documented escape hatch for a later milestone; do not plan it.

3. **Mode persistence is `pi.appendEntry`, not a file and not context.** *"Custom entries do NOT participate in LLM context"* (`docs/extensions.md:1442`) — that is what "zero context-token cost" in criterion 2 means, and it is what makes ROUTE-09 checkable. Entries are restored from `ctx.sessionManager.getBranch()` on `session_start`. Namespace the entry type (`ky:mode`, ARCHITECTURE:238).

4. **The four hard capability blocks are refusals with a reason, never a silent downgrade** (ROUTE-06/07/08):
   - image input → a model whose `input` is `["text"]`. Both DashScope models in `.pi/templates/models-template.json` are `"input": ["text"]` (lines 116, 159), so this fires on the realistic daily-driver configuration, not a hypothetical one.
   - oversized context → a small-`contextWindow` model.
   - **Bedrock non-Claude with thinking enabled**: `buildAdditionalModelRequestFields` returns `undefined` for every non-Claude Bedrock model **while the UI still offers the thinking level**, because the catalogue says `reasoning: true`. The configuration is dropped in silence. This is the most dangerous of the four because nothing in the UI hints at it.
   - **Bedrock DeepSeek R1 as executor**: it supports **no tool calling at all**. An executor that cannot call a tool is not an executor.

5. **The mode switch also writes `settings.subagents.agentOverrides`.** A mode that changes the main session's model but leaves subagents on their old pins has swapped half the map — and criterion 1 says *the whole* role→model map. Phase 7 wires the subagent package itself; Phase 5 owns the override write and must keep it forward-compatible with that.

6. **Every claim about which model served a turn is proven by Phase 2's wire dump, not asserted** (ROUTE-10, criterion 1). This is why Phase 2 came first. A test that asserts "we called `setModel('x')`" proves nothing about what went on the wire; a test that reads the wire record and finds model `x` does.

7. **Routing MUST go through the Phase 2 chokepoint.** `tests/unit/chokepoint-lint.test.ts` is a build-failing lint: `modelRegistry.complete` called outside `diagnostics/` fails the build (DIAG-02). Routing calls `callModel()`; it never calls `complete()` itself.

8. **`safety/` imports nothing from routing, BY DESIGN — keep the direction.** ARCHITECTURE's dependency table: "safety ↔ everything | none — reads policy files, writes audit", so `safety/` stays source-reviewable in isolation because it sits in the credential/exec path. Routing may import from `diagnostics/` (ARCHITECTURE:543, "the one intentional coupling") and from `providers/`. **Routing may not create a cycle and safety must not gain a routing import.** For cross-subsystem signalling (e.g. statusline), use `pi.events.on/emit` rather than an import (ARCHITECTURE:547).

9. **`setModel` can fail, and the failure must be handled, not hoped through.** It returns `false` when there is no API key for the target model and it can throw (ARCHITECTURE:496; `pi-bifrost` carries an entire `reliability-store` because of this). A `/cheap` that silently no-ops and leaves the session on the expensive model is the exact "degrading silently" failure criterion 3 forbids.

10. **Fallback is Phase 3's `callWithFallback`, and its chain is DeepSeek-direct → DashScope.** `.pi/extensions/providers/fallback.ts` says in its own header that it "is a named-export service module, consumed by Phase 5's router". Reuse it; do not write a second chain. `classifyFailure` is already exported for direct assertion, and a `fatal` class stops the chain outright.

11. **ROUTE-11 — the Qoder tension, RESOLVED IN FAVOUR OF THE ROADMAP.** `.planning/research/SUMMARY.md` §R3 says "In v1: nothing — remove it from the routing table, the fallback chain, and the capability guard", deferring delegate-tool status to v2+; the ROADMAP (the later, approved artifact) makes it a Phase 5 success criterion. **These forbid different things: SUMMARY forbids Qoder as a MODEL/provider/fallback-hop; the ROADMAP asks for it as a DELEGATE TOOL.** Resolution: **plan ROUTE-11 as a delegate tool only — never a routable model, never a `models.json` entry, never a hop in the fallback chain, never an entry in the role→model map or the capability guard.** Its only official surface is the PAT (`QODER_PERSONAL_ACCESS_TOKEN`, `pt-…`) plus the Cloud Agents API at `https://api.qoder.com/api/v1/cloud`. **Never a bypass proxy** — `pi-provider-qoder@0.3.0` and `pi-qoder-provider@0.2.2` ship WAF-bypass body encoding and COSY RSA/AES-CBC/MD5 signature forging against `gateway.qoder.sh`, breaching Qoder ToS §3.2.6/§3.2.9/§3.2.10 with §15.2 making termination irreversible.

12. **The Qoder delegate tool is a FOREIGN AGENT and its bypass is a first-class, user-facing statement.** Pi's tools, `AGENTS.md`, system prompt, **safety hooks** and **wire inspector** all bypass it — it is a hosted agent loop with its own `Read/Write/Edit/Glob/Grep/Bash`. On a laptop where merging to `main` auto-deploys to AWS, that means the Phase 4 guard does not protect anything Qoder does. SUMMARY §R3 calls this "a significant caveat, not a footnote"; criterion 5 says "documented as such". It belongs in `docs/` prose and in the tool's own description, not in a comment.

**Claude's discretion (guided by ROADMAP criteria + `.planning/research/`):**
Whether the role→model map lives in TypeScript or JSON and where (a `routing/roles.ts` table versus a settings key); the exact command names beyond `/cheap`, `/balanced`, `/max`, `/escalate` (and how `/escalate off` / clearing is spelled); how the capability guard is decomposed and whether it is one predicate table or one function per block; the file split inside `routing/` (ARCHITECTURE:155-158 sketches `modes.ts`); how mode state is surfaced visibly (statusline via `pi.events`, a `model_select` handler, or command output) given Phase 11 owns the real UI; the `RB-05-xx` numbering and section ordering in `docs/RUNBOOK.md`; where the foreign-agent caveat is published in `docs/` and its exact wording; and how the subagent `agentOverrides` write is shaped so Phase 7 can adopt it without rewriting.

**Decisions taken autonomously during context generation** (per the Standing Operating Policy — the user is asleep; noted here rather than asked):
- Phase slug is `05-routing-capability-guards`, following Phases 3 and 4's convention of dropping `&` from the phase title.
- The ROUTE-11 v1/v2 timing conflict is resolved in favour of the ROADMAP (decision 11 above), because the ROADMAP is the later, approved artifact and the two documents forbid different things.

</decisions>

<code_context>
## Existing Code Insights

Phases 1–4 created the shape this phase writes into. Do not re-create it. 1,180 tests green, `tsc --noEmit` clean. **Read the real API before planning against it** — every item below is a concrete export, not an assumption.

**Phase 2 — `.pi/extensions/diagnostics/` (9 files) is the contract routing consumes.**
- `call-model.ts` exports `callModel<TApi>(ctx, opts)` and `CallModelOptions<TApi>`. Its own docstring says: *"THIS IS A CROSS-PHASE CONTRACT. Phases 5 (ROUTE-04, GATE-09) and 8 import this interface. It carries payload, response AND header capture from day one precisely so neither phase has to widen it later."* **Plan against the existing signature; do not widen it.** Fields: `role` (mandatory, deliberately not defaulted — it is the join key), `model`, `systemPrompt?`, `messages`, `tools?`, `api?` (per-API options — this is where `reasoningEffort` goes, and the four capture keys are stripped from the type by `WithoutCaptures`), `signal?` (defaults to `ctx.signal`, so Esc cancels nested work).
- Spread order inside `callModel` is the enforcement: `opts.api` goes in **first** so the captures always win. A caller cannot suppress its own capture. Routing must not try to.
- `tests/unit/chokepoint-lint.test.ts` fails the build on `modelRegistry.complete` outside `diagnostics/`. `tests/unit/call-model-containment.test.ts` and `tests/unit/wire-nonmutating.test.ts` are the worked examples for asserting on a nested call.
- `jsonl.ts` / `schema.ts` / `wire.ts` / `turns.ts` / `redact.ts` / `budget.ts` are the wire-dump and per-turn machinery ROUTE-10 reads back. `index.ts` exports `rowsWrittenThisSession()`, `noteRowWritten()`, `safeHandler()` and the event/where constants.

**Phase 3 — `.pi/extensions/providers/` (4 files) and `.pi/templates/`.**
- `fallback.ts` exports `callWithFallback(...)`, `CallWithFallbackOptions = Omit<CallModelOptions<Api>, "model">`, and `classifyFailure(errorText)`. Header states it is "consumed by Phase 5's router".
- `.pi/templates/models-template.json` defines exactly one provider, `dashscope`, with `deepseek-v4-flash` and `deepseek-v4-pro` — both `"reasoning": true`, both `"input": ["text"]`, both `"contextWindow": 393216`, with the explicit `compat` block (PROV-03). **There is deliberately no Bedrock entry**: Bedrock is configured through `auth.json` (`credential.env.AWS_PROFILE`) against Pi's built-in catalogue. The capability guard therefore reads Bedrock model metadata from `ctx.modelRegistry`, not from this file.
- `sso.ts`, `schema.ts` round out the provider subsystem. `tests/unit/model-metadata.test.ts` and `tests/unit/r1-unclamp.test.ts` already exist and are directly relevant to ROUTE-07/08 — **extend rather than duplicate**.
- **Consequence for ROUTE-06 the planner must not miss:** with both daily-driver models text-only, the *vision* role cannot be served by DashScope at all. The role→model map must name a real vision-capable model (Bedrock Claude) or the vision role is a refusal by construction — and that refusal is criterion 3's first clause, so it must be a *reasoned block with a message*, not a crash.

**Phase 4 — `.pi/extensions/safety/` (9 files: `approvals, audit, git, index, infra, paths, policy, schema, shell`).** It imports nothing from routing and must keep importing nothing from routing. Routing does not import it either; the two subsystems meet only in Phase 6's `/quick`.

**`docs/RUNBOOK.md` already exists** with `RB-01-01..03`, `RB-02-01..03`, `RB-03-01..05` and `RB-04-01`, a stated four-part entry contract (exact command, expected output, offline proxy, status line), per-phase summary tables and per-phase machine-state sections. Phase 5 **appends** an `RB-05-xx` section. `tests/unit/docs-policy.test.ts` parses both the summary-table row and the `**Status:**` line and reports a disagreement as `INCONSISTENT`.
`docs/` also already holds `DIAGNOSTICS.md` and `SAFETY.md` — a `docs/ROUTING.md` is the obvious, convention-consistent home for the role→model table and the foreign-agent caveat.

**Directly reusable test helpers:** `tests/helpers/{faux.ts, session.ts, models.ts, pi.ts, logs.ts, git.ts, stub-bin.ts, win-quote.ts, loopback.ts}`. `faux.ts` + `session.ts` + `models.ts` are the three this phase leans on hardest — `fauxProvider` can assert on the **outgoing request**, which is how "the intended model actually served the next turn" is proven without credentials. `loopback.ts` is the honest offline proxy for the Qoder HTTP surface.

**No build step.** Pi loads `.ts` through jiti; a build breaks `/reload`. Ship `.ts` and point `pi.extensions` at it.

**Pi's own bundled examples and published TypeScript take precedence over any extension README** (`%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\`). `summarize.ts` and `handoff.ts` are the reference for the nested-`complete()` path. Original TypeScript for anything in `dist/` is recoverable from `dist/**/*.js.map` `sourcesContent`. Cite `file:line`; mark anything unverifiable as **UNVERIFIED** rather than asserting it.

</code_context>

<specifics>
## Specific Ideas

- **`ctx.reload()` and the command-only surface matter here.** `ctx.waitForIdle()`, `ctx.getSystemPromptOptions()`, `ctx.newSession()`, `ctx.fork()` and `ctx.reload()` exist **only on `ExtensionCommandContext`**, not on the `ExtensionContext` handed to tools and event handlers. `/cheap` etc. must therefore be **commands**, not tools — which is also what ROUTE-02 says. A capability guard that wants to refuse from inside a tool cannot call `waitForIdle`, so the guard's refusal path must be synchronous and message-shaped.
- **`ctx.scopedModels` is the right source for "which models may this session use"**, not `getAvailable()` — it reflects `--models` / `enabledModels`. An empty list means "all models usable". Getting this backwards produces a router that offers models the user has deliberately scoped out.
- **`ctx.modelRegistry.getProviderAuth(id)` resolves key/headers/baseUrl/env *without loading a model*.** That is exactly what a pre-flight "would `setModel` return false?" check needs, and it turns decision 9 from a `try/catch` into a *refusal with a reason* before anything mutates.
- **The `/escalate` stickiness is a debuggability decision, not laziness.** ARCHITECTURE:55: sticky + visible beats auto-restore, because auto-restore makes "why was this turn expensive?" unanswerable after the fact. Every escalation should write a row so cost spikes are explainable — Phase 2's JSONL already has the machinery.
- **ROUTE-09's "zero context tokens" is a testable claim, not a slogan.** The test is: append the mode entry, rebuild the context, and assert the entry's payload appears in **no** message that reaches the provider — `fauxProvider`'s request capture is the instrument. Asserting only that `appendEntry` was called proves the wrong thing.
- **ROUTE-07 is the block that must be tested against Pi's real behaviour, not a mock of it.** The whole point is that the UI offers a thinking level the request silently drops. Verify `buildAdditionalModelRequestFields` returning `undefined` for a non-Claude Bedrock model at source (pi-ai `dist/api/bedrock-converse-stream.js` + its `.map`), cite `file:line`, and make the guard's test assert on the *catalogue* condition (`reasoning: true` + Bedrock + non-Claude) so it keeps firing if Pi's internals move.
- **Criterion 1 names six roles — executor, planner, reviewer, advisor, vision, summariser — and criterion 4 splits them by mechanism.** Reviewer, advisor, vision and summariser are the single-shot four named in ROUTE-04. Executor is `setModel`. **Planner is the one role criterion 4 does not explicitly assign**; it needs a tool loop in any realistic reading (it reads files), so it lands in the subagent bucket with ROUTE-05. State that assignment explicitly in the map rather than leaving it inferred.
- **ROUTE-11's runbook entry needs an offline proxy like every other entry.** The four-part contract requires one. The honest proxy is `tests/helpers/loopback.ts` serving a canned Cloud Agents session + SSE event stream, proving the harness *parses* a delegated result and folds it back; only the live check proves a real PAT reaches `api.qoder.com`. The delegate tool must fail with a clear message when `QODER_PERSONAL_ACCESS_TOKEN` is unset — which is its state on this machine and will be its state in CI.
- **Do not let the Qoder tool leak a PAT into a public repo.** It is a credential in a tool path; reuse `diagnostics/redact.ts` at capture rather than inventing a second redaction rule, and keep any transcript it produces on a gitignored path.
- **Subagents default to inheriting the parent model** (ARCHITECTURE:400) — so pin child models explicitly in `agentOverrides`. Also noted there: a forked context over an Anthropic parent with signed thinking blocks forces the child's thinking off, which bites if the reviewer is a Bedrock Claude fed a forked context.

</specifics>

<deferred>
## Deferred Ideas

- The virtual `streamSimple` provider and automatic per-turn routing — not v1; documented escape hatch for a later milestone only (ARCHITECTURE:57).
- Qoder as a **model, provider or fallback hop** — permanently excluded (SUMMARY §R3, C2). Only the delegate tool is in scope, per decision 11.
- `/quick` and the evidence gate that composes routing + safety end to end — Phase 6.
- Installing and pinning `pi-subagents` itself, and its source review — Phase 7, where every pin is re-verified at planning time. Phase 5 writes the `agentOverrides` shape; Phase 7 wires the package.
- Quality gates, the non-rubber-stamping reviewer and advisor escalation policy — Phase 8. Phase 5 provides the *route*; Phase 8 decides *when* to escalate.
- Ceremonial workflows (`/grill`, `/plan`, `/execute`, `/review`) — Phase 9.
- Per-turn context budget and progressive disclosure (`pi.setActiveTools`) — Phase 10. Do not tune token cost here.
- Statusline, header and the subagent widget — Phase 11. Phase 5 emits the state; Phase 11 renders it.
- Worktree isolation for subagents — v1.x, and its planning phase must first verify the invocation path at the pinned version and prove a worktree can *build*, not merely check out (SUMMARY §R4).

</deferred>
