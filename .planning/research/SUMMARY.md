# Project Research Summary

**Project:** ky-pi-agent — a personalised coding-agent harness on Pi that makes cheap models reliable
**Domain:** Developer tooling / agent harness extension (Pi `@earendil-works/pi-coding-agent@0.84.1`)
**Researched:** 2026-08-12 → 2026-08-13
**Confidence:** HIGH for Pi platform mechanics (source-verified) · MEDIUM for provider wire behaviour (nothing executed — no credentials) · LOW for third-party extension runtime behaviour

> **Read this first.** All four researchers verified claims against Pi's published TypeScript (recovered from npm tarballs and sourcemaps at 0.84.1), not documentation alone. Several findings **contradict PROJECT.md**, and two researchers contradict **each other**. Every conflict is resolved or explicitly marked UNRESOLVED below — nothing has been averaged. See **Corrected Assumptions** and **Cross-Document Conflicts** before using anything else in this file.

---

## Executive Summary

This is a **harness-over-a-moving-platform** project, and the research changed its centre of gravity. PROJECT.md's founding hypothesis was that DeepSeek "doesn't think enough" because Pi mis-sends thinking parameters. Two researchers independently falsified the headline version of that claim at source: **Pi's DeepSeek wire format is correct** (`{"thinking":{"type":"enabled"}, "reasoning_effort":"high"}` — a `thinking` object *and* a sibling top-level `reasoning_effort`, exactly what DeepSeek documents). The "nesting bug" is dead. What survives are three different, better-evidenced causes: (1) **DeepSeek emits tool calls as prose ~11% of the time** with `finish_reason:"stop"` and `tool_calls:null` — the call evaporates, the model reasons onward from a gap it does not know it has, which is precisely the phenomenology of "misses bugs Sonnet would catch"; (2) **context pollution is ~4× worse than PROJECT.md assumes** — the measured per-turn floor is ~1,850 tokens, not ~400, and the dominant term is the tool-schema array in the request payload, which no amount of `promptSnippet` discipline touches; (3) **two real, silent thinking defects** — Bedrock drops thinking configuration for every non-Claude model, and a hand-written DashScope provider silently gets `thinkingFormat:"openai"` (thinking never enabled) because Pi's compat auto-detection has no branch for `aliyuncs.com`. All three are invisible from the UI. All three are only diagnosable with the wire inspector. **PROJECT.md's "wire inspector before quality levers" decision is confirmed and, if anything, understated** — it is load-bearing for four separate pitfalls, and the prose-tool-call detector belongs in that same first phase, not with quality levers.

The recommended build is **compose the commodity, author the critical path, and instrument before you tune**. Pi 0.84.1 on Node ≥22.19.0, TypeScript 5.9.3 (match Pi, not latest), `typebox` unscoped as a peer, vitest 4.1.9, `unbash@4.0.10` (zero-dep bash AST parser) for the safety layer, and eleven exact-pinned extensions. Four authored subsystems: `diagnostics/` (wire inspector, JSONL, and the single `callModel()` chokepoint), `routing/` (role map, modes, capability guards), `safety/` (AST guard + tool wrapper + audit), `workflows/` (four thin commands over thick skills). The repo is `.pi/`-rooted so it dogfoods itself: `cd ky-pi-agent && pi` loads the harness you are editing. Two findings materially de-risk the "no API keys on the dev machine" constraint and the "extensions execute arbitrary code" constraint respectively: **`fauxProvider()` in `@earendil-works/pi-ai` is a public scripted mock provider** that makes the entire credential-dependent surface testable offline, and **Pi ships ~80 working extension examples plus a 390-line plan-mode implementation in its own tarball** — zero supply-chain risk, guaranteed API-current, written by the Pi author, and preferable to third-party equivalents wherever they cover the need.

The risks that matter are supply-chain and self-deception, not architecture. **`pi install` runs npm lifecycle scripts with no `--ignore-scripts` on any code path** — arbitrary code executes with full permissions before Pi's loader runs, before the trust prompt, on a laptop holding live AWS SSO credentials for an account where merging to `main` auto-deploys. The fix is one line in `~/.npmrc` and it must precede the first install; nothing else in the project has a better cost/benefit ratio. The self-deception risks are structural and each has a verified mechanism: `noOpUIContext.confirm` returns `false` headless, so the obvious guard shape (`if (ctx.hasUI && !ok) block`) **fails open** in `-p`/RPC/CI; project-scoped extensions do not load in subagents (no UI ⇒ no trust), so a project-scoped safety guard protects the interactive session and nothing else; provider hooks wire only into the main agent's `streamFn`, so nested `complete()` calls bypass the wire inspector entirely unless every one funnels through a single chokepoint; and `/share` **cannot be blocked by an extension at all** — built-in slash commands are matched before extension commands and before the `input` event. The real controls are, in order: GitLab server-side protected branches, `ignore-scripts=true`, exact version pins, user-scope safety extensions, and an unauthenticated `gh` on the work laptop.

---

## Key Findings

### Recommended Stack

Everything in the core stack is pinned to match Pi exactly rather than to latest, because type-identity across the extension boundary is what actually matters. Pi loads `.ts` directly through jiti — **there is no build step**, and adding one breaks `/reload` hot-reloading for zero gain. The eleven composed extensions are exact-pinned; two of them are explicitly LOW confidence and are called out as such rather than presented as settled.

**Core technologies:**

- **`@earendil-works/pi-coding-agent` 0.84.1** — the host. MIT, Node ≥22.19.0, ships `docs/` (35 files, 12,196 lines) and ~80 extension examples inside the npm tarball.
- **TypeScript 5.9.3** — deliberately not 7.x. Pi pins 5.9.3; match it. Revisit when Pi moves.
- **`typebox` (unscoped) as a peer with `"*"`** — **not** `@sinclair/typebox`, which is the legacy scoped fork at 0.34.52 and produces schemas Pi cannot validate. Bundling any `@earendil-works/*` or `typebox` creates a second module instance and breaks `instanceof`.
- **vitest 4.1.9** — matches Pi core; plurality choice among extension authors; no extra runtime on the Windows/macOS CI matrix.
- **`unbash@4.0.10`** — ISC, **zero dependencies**, the answer to "the `tool_call` hook is a string matcher, trivially defeated". Parse to AST, resolve wrappers (`sudo`/`env`/`sh -c`/`xargs`), match resolved command nodes, and **fail closed on anything unparseable** (`$(...)`, backticks, heredocs, background `&`).
- **`fauxProvider()` from `@earendil-works/pi-ai`** — public scripted mock provider (`fauxAssistantMessage`, `fauxToolCall`, `fauxThinking`, response *factories* that can assert on the outgoing request). Makes the whole credential-dependent surface testable with no keys, no network, no disk. **Caveat: exported from the main entry and typed in `.d.ts` but not in `docs/` — no stability guarantee. Pin `pi-ai` exactly.**
- **Pi's own bundled examples** — `permission-gate.ts`, `protected-paths.ts`, `confirm-destructive.ts`, `dirty-repo-guard.ts`, `git-checkpoint.ts`, `provider-payload.ts`, `dynamic-tools.ts`, and a **390-line plan-mode implementation**. Prefer these over third-party packages wherever they cover the need.
- **`@ramtinj95/pi-infra-command-guard@0.9.1` — read it, do not install it.** Its scope is a near-exact match for the terraform/aws/kubectl confirm-gate requirement and it is the only Pi extension doing real AST parsing, but it hard-peer-depends on `@howaboua/pi-codex-conversion`, which drags in `openai`, `web-tree-sitter`, `tree-sitter-bash`, and `ws`. Steal the `unbash` approach and the block→approval-tool→re-issue protocol; write your own.

**Composed extension set (11, exact-pinned):** `pi-subagents@0.47.1` (214k dl/mo, worktrees + `contact_supervisor` native), `@narumitw/pi-plan-mode@0.49.3`, `@juicesharp/rpiv-todo@2.4.0`, `@juicesharp/rpiv-ask-user-question@2.4.0`, `pi-background-tasks@2.3.0` (filter out its duplicate delegated-agent tools), `@narumitw/pi-lsp@0.49.4` (76 KB, 13 files, 2 model-facing tools — chosen over `pi-lens`'s 18.6 MB / 1,294 files precisely because it is reviewable and cheap in schema tokens), `pi-loop-police@1.14.1` (⚠ no LICENSE file — vendor it), `pi-web-access@0.22.0` (mandatory — Pi has no web tool and MCP is out of scope), `pi-session-finder@0.5.6`, `awesome-pi-themes@1.1.9` (reference material), plus two flagged below.

**⚠ Two LOW-confidence picks — do not launder these into the roadmap as settled:**
- **File checkpointing — every option in the category is weak.** The most-starred (`pi-rewind`, 104★) was last pushed **2026-03-31**, 4½ months stale against an API shipping every 2–3 days; the second (`@ayulab/pi-rewind`) is on an **archived** repo and belongs to a different fork. The recommendation (`@davideasden/pi-undo@0.2.11`) wins on freshness, not on evidence. The architecturally correct option (`@pi-plugins/checkpoint`, restores files on `/tree` navigation) is at v0.1.2 and too new to bet on. **Fallback: vendor Pi's own ~100-line `examples/extensions/git-checkpoint.ts`.**
- **Provider fallback (`pi-model-fallback@0.3.6`, 49 KB, 1★, 682 dl/mo)** — chosen only because it is small enough to read end-to-end in 20 minutes. Treat as a stopgap; `pi-subagents` already has per-agent `fallbackModels`, Pi has built-in `retry` settings, and the authored router should probably own this.

### Expected Features

The SDD survey (spec-kit, Kiro, OpenSpec, Tessl, GSD 1.42.3 read locally, BMAD, Anthropic's own guidance) converges on one lesson: **artifact volume does not buy adherence.** Fowler's team reviewed spec-kit directly and concluded "I'd rather review code than all these markdown files," and found agents "frequently ignored instructions" *despite* comprehensive specs. Kiro shipped a gate-free "Quick Spec" escape hatch, which tells you what users actually wanted. GSD's own `quick.md` is 1,169 lines (~15k tokens) — a no-ceremony path that costs 15k tokens to load is self-refuting. The design consequence is a hard budget per workflow, CI-enforced, and **three artifacts total** (SPEC, PLAN, REVIEW) plus a PROGRESS append.

**Must have (table stakes):**
- Working provider auth with **actionable** expiry messages (Bedrock SSO, DeepSeek-direct, DashScope)
- Explicit role→model routing + session modes — no auto-classification
- Deterministic gates (typecheck/lint/LSP) before any model review — best reliability-per-token item in the harness, and it feeds three downstream consumers
- Evidence-gated completion — gated on `tool_result` **exit codes bound to a git SHA**, never on transcript text
- Wire-level request inspector + per-turn JSONL — gates the honesty of everything downstream
- Safety: `HEAD == main` write block, `glab mr merge` block, dangerous-command confirm, out-of-project write block
- `/quick`, **≤80 lines**; atomic commits; pruned `AGENTS.md`
- Composed commodity: subagents, plan mode, todos, ask-user, web lookup, LSP

**Should have (differentiators — why this exists rather than stock Pi + gentle-pi):**
- **SPEC.md §2 "Verified Codebase Facts" table** — `claim | evidence (file:line or command output) | how verified`. **No surveyed system has this.** They all scout the codebase; none force the agent to *record its evidence*. Highest reliability-per-token idea in the research, ~200 tokens on-invoke, and it structurally kills the "agent assumed something false and built on it" failure mode.
- **Reviewer context contract** — diff + full contents of every touched file + test/typecheck output + SPEC requirements + files-touched union + **the import graph** (the research addition). Reviewing hunks in isolation is the documented cause of missed cross-file breakage.
- **Anti-review-theatre protocol** — per-requirement verdicts (Implemented/Partial/Missing with file:line), a mandatory "checked and cleared" section, BLOCKER/WARNING/NIT with unclassified findings rejected as malformed, and **refute-or-promote on BLOCKERs only**. Two-sided by design: LLM reviewers silently approve when unsure, *and* a reviewer told to find gaps will invent them.
- **Machine-checkable scope pin** — expected-files list in SPEC §5 → PLAN files-touched union → diffed at review. The only scope technique that does not depend on cheap-model judgement.
- **Ambiguity scorecard with per-dimension floors** + rotating interview perspectives (lifted from GSD `spec-phase.md`, 262 lines, the highest value-density file in that suite).
- **Self-contained subagent handoff packets** (BMAD's story-file insight) — *negative* token cost in the parent; the core mechanism for cheap-model reliability.
- **Progressive disclosure as a CI-enforced budget** — GSD ships a `workflow-size-budget` test and still has a 1,169-line "quick", proving unevenly-applied budgets do not hold.

**Defer (v1.x / v2+):** refute-or-promote pass · advisor escalation (trigger: JSONL shows a repeated failure class at a named juncture) · per-role thinking budgets (**trigger: wire inspector proves the parameters land**) · worktree isolation + parallel `[P]` tasks · library/API pinning in `AGENTS.md` · import-graph reviewer expansion · provider fallback chains · Playwright verification skill · UI layer (explicitly last) · OpenSpec-style delta specs.

**Explicit anti-features:** multi-file spec bundles · persistent canonical spec corpus (same rot failure as auto-memory, already rejected) · spec-as-source/regenerable code · full EARS grammar (adopt only `IF <cond> THEN THE SYSTEM SHALL` in the mandatory error section) · human approval gate between every phase (approval fatigue = permission-prompt fatigue) · `--auto` self-answering clarification questions (structurally defeats a grilling workflow) · mode-flag matrices · artifacts no downstream consumer reads (GSD's `DISCUSSION-LOG.md`) · auto-classifying router · chained auto-advance.

### Architecture Approach

One git repo, two consumption modes (`pi install <url>` and `bin/bootstrap.sh`), rooted at **`.pi/`** so `package.json#pi` and the dogfood directory are the same files — `cd ky-pi-agent && pi` loads the harness you are editing, with `/reload`. Four authored extensions over a pinned composed layer, with a **boundary rule** that decides where every capability lands: tool (costs description + JSON schema in *every request*, ~40–200 tok) · **command (0 tokens — commands are not in the system prompt)** · skill (~40–60 tok index, body on read) · prompt template (0 until invoked; flat discovery, regex substitution only, no bash/includes/recursion) · subagent (0 in the parent — the point) · config (0). **A new capability defaults to command or skill; registering a tool requires justifying its per-request schema cost.**

**Major components:**
1. **`diagnostics/`** — wire inspector (`before_provider_request` / `after_provider_response` / `before_provider_headers`), per-turn JSONL, `/budget`, log rotation, redaction, and **the single exported `callModel()` chokepoint**. Non-optional: provider hooks are wired only into the main agent's `streamFn` (`dist/core/sdk.js:170-215`), so a direct `ctx.modelRegistry.complete()` **fires none of them**. Add a lint/test forbidding `modelRegistry.complete` outside `diagnostics/`.
2. **`routing/`** — three-tier model selection, not one mechanism: `pi.setModel()` from a **command** (after `await ctx.waitForIdle()`, which removes the race entirely) for the executor and `/escalate`; `ctx.modelRegistry.complete()` via `callModel()` for single-shot roles (review, advisor, vision, summarise); **subagents** for roles needing a tool loop. **Do not build a virtual `streamSimple` provider in v1** — it is the right tool for *automatic* per-turn routing, which is exactly what the project has decided not to do, and it takes over the `/model` picker and complicates cost accounting.
3. **`safety/`** — enforced **twice**: `tool_call` hook for UX and early rejection, *plus* a wrapped built-in `bash` tool whose `execute` re-checks and throws. Necessary because later `tool_call` handlers can mutate `event.input` after yours approved it and **Pi performs no re-validation**. Plus block→approval-tool→re-issue instead of an inline `confirm()`, an `unbash` AST guard that fails closed, audit JSONL, and **no imports from routing or workflows** so it can be source-reviewed in isolation.
4. **`workflows/`** — thin command (control flow; `waitForIdle`/`fork`/`newSession` are command-only) + thick skill (the procedure, ~50 tok/turn index instead of full length) + git-visible markdown state in `.work/<slug>/`. `pi.appendEntry` for *harness* state (0 tokens, survives restart, never enters LLM context); files for *work product*.

**Measured per-turn budget** (produced by importing Pi 0.84.1's own `buildSystemPrompt` and tool factories):

| Item | Cost | Lives in |
|---|---|---|
| System prompt, 7 built-in tools, no skills, no AGENTS.md | **~756 tok** | system prompt, every request |
| Built-in tool descriptions (7) | ~399 tok | payload `tools[]`, every request |
| Built-in tool JSON schemas (7) | ~707 tok | payload `tools[]`, every request |
| One custom tool with `promptSnippet` + 1 guideline | +~37 tok | system prompt |
| Skills block header + each skill | ~112 tok + 40–60 tok each | system prompt |
| **Floor** | **~1,850 tok/turn** | |

### Critical Pitfalls

1. **`pi install` runs npm lifecycle scripts — no `--ignore-scripts` on any path** (`package-manager.ts:1758-1779`; the pnpm branch explicitly passes `--config.strict-dep-builds=false`, re-enabling what pnpm 10 blocks by default). Arbitrary code, full permissions, before the loader and before the trust prompt, from a pool of 7,276 `pi-package` npm packages nobody reviews, onto a laptop with live deploy credentials. **Fix: `ignore-scripts=true` in `~/.npmrc` before the first `pi install`** (or a `npmCommand` wrapper shim). This is the single highest-value line of configuration in the project.
2. **DeepSeek emits tool calls as prose ~11% of the time** — `finish_reason:"stop"`, `tool_calls:null`, the function name and JSON args written into `content`. The tool never runs, no error, no retry, and the model's *next* message is written as though it had. Most likely root cause of the user's original complaint, and it compounds with evidence-gating: the two failure modes cooperate to fabricate evidence. **Fix: a detector in the assistant-message path logging `event: prose_tool_call` to JSONL, retry-on-detection (optionally `tool_choice:"required"`), and never let "no tool call" mean "done".** Ship it in the *first* diagnostics phase.
3. **Silent thinking drops on two paths.** Bedrock: `buildAdditionalModelRequestFields()` returns `undefined` for every non-Claude model, and the UI still offers a thinking level because the catalog says `reasoning:true`. DashScope: Pi's `detectCompat()` has **no branch for `aliyuncs.com`**, so a custom provider falls through to `thinkingFormat:"openai"` — `enable_thinking` never sent, thinking silently off — plus `requiresReasoningContentOnAssistantMessages:false`, which produces an **HTTP 400 on the second turn of any tool sequence** (the first turn works, so it looks intermittent). **Fix: write `compat` explicitly, never rely on detection; capability-guard the Bedrock non-Claude route; confirm each field on the wire.**
4. **Guards that fail open, and guards that are absent.** `noOpUIContext.confirm` returns `false` in `-p`/json mode — correct *only* if the code is written "block unless explicitly approved"; written as `if (ctx.hasUI && !ok) block` it permits everything headless. And project trust requires a UI, so **project-scoped extensions do not load in subagents** (which spawn real headless child `pi` processes) — a project-scoped safety extension protects the interactive session and nothing else. **Fix: deny-by-default + a CI test asserting the deny under `--mode json`; install every safety-critical extension at USER scope; test the blocked command *inside a subagent*.**
5. **Cache-busting the system prompt costs 50×.** Pi's DeepSeek catalog prices cache reads at $0.0028/Mtok against $0.14/Mtok fresh input. **One volatile token at the top of the system prompt re-prices the entire prefix, every turn.** Hard constraint on the statusline/header/UI work: all volatile content (time, cost-so-far, git branch, changed files) lives in TUI chrome or user messages, **never** in the system prompt. Watch `cacheRead`: if near zero by turn 3, find what is busting it before optimising anything else.

**Also load-bearing:** `/share` cannot be blocked by an extension (see conflicts) · expired SSO surfaces as a raw SDK error with no reauth branch and may be *retried* by string-matched 5xx classification, burning wall-clock mid-run — classify credential errors as non-retryable · Pi versions below 0.74.0 are **unpublished from npm**, so a pinned bootstrap has a shelf life of months and needs a loud fallback · `auth.json`'s `0600` is a no-op on Windows ACLs, so keep secrets out of the file and use `$ENV_VAR` / `!command` (and put `!command` in `auth.json`, which caches for the process lifetime — **never** in `models.json`, which re-executes on *every provider request*).

---

## Corrected Assumptions

Every PROJECT.md claim the research falsified or materially changed. **The roadmapper must treat these as the current truth.**

| # | PROJECT.md says | Research found | Evidence | Action |
|---|---|---|---|---|
| C1 | "DeepSeek documents `reasoning_effort` nested inside a `thinking` object while Pi sends it top-level" | **FALSE.** DeepSeek documents `{"thinking":{"type":"enabled"}, "reasoning_effort":"high"}` — a `thinking` object *and* a sibling top-level field. Pi emits exactly that. The API *reference* page renders `reasoning_effort` under the thinking section in a way that reads as nesting; that is the source of the error. | `openai-completions.ts:796-806`, falsified independently by STACK and PITFALLS; DeepSeek Thinking Mode guide | **Delete all planned remediation.** The wire-inspector gate on thinking budgets stays — but its justification is now Bedrock + DashScope, not DeepSeek-direct. |
| C2 | "Provider fallback chains (Qoder → Aliyun)" | **Not constructible.** Qoder's official API has no inference endpoint. Cloud Agents is agent-task orchestration (define agent → container environment → session → SSE of high-level events); the Agent SDK's `query()` is a hosted agent loop with its own `Read/Write/Edit/Glob/Grep/Bash`. `docs.qoder.com/llms.txt` contains no chat-completions or model-inference page. | STACK §5, verified three ways | **Drop Qoder from routing and fallback entirely.** See conflict R3. |
| C3 | "`@gotgenes/pi-subagents-worktrees` as the worktree bridge" | Peer-depends on `@gotgenes/pi-subagents >=16.4.0` and its own README says it **does nothing** if that package is not loaded. It bridges a *third* subagents package. | STACK §6, package manifest + README | **Remove from the plan.** Both recommended packages have worktree isolation natively. |
| C4 | "Pi's base system prompt is ~400 tokens" as the per-turn budget | **~1,850 tok/turn floor** — 756 (system prompt, 7 tools) + 1,106 (tool descriptions + JSON schemas in the payload `tools[]`). ~400 counts only the prose prompt with the 4-tool default. The dominant term is the payload array. | ARCHITECTURE, measured by importing Pi's own builders; mechanism independently confirmed by PITFALLS 18 | **Restate the budget as ~1,850.** The lever is `pi.setActiveTools()`. `promptSnippet` omission saves ~37 tok and keeps ~150 — it is theatre. The `context` hook **cannot** strip tool definitions (`ContextEventResult` is `{messages?}` only). There is **no `defaultTools` setting**. |
| C5 | "Block `/share` … via the `tool_call` hook" | **Impossible.** Built-in slash commands are matched in the interactive editor's submit handler *before* extension commands and before the `input` event. No hook sees `/share`; registering a command named `share` does not shadow it. | ARCHITECTURE Anti-Pattern 7, `interactive-mode.js:2295-2430` | **Restate as: make `/share` fail.** `handleShareCommand` runs `gh auth status` first and aborts if `gh` is missing or unauthenticated — keep `gh` unauthenticated on the work laptop, optionally add a PATH shim, put it in the runbook. Editor-component wrapping is UNVERIFIED and fragile; do not depend on it. |
| C6 | "Extended thinking is only *requested* for Claude on Bedrock" | **CONFIRMED at source by both researchers** — the one original suspicion that survived; it now needs a capability guard rather than investigation. | `bedrock-converse-stream.ts:1096-1144` | Hard-block `provider==amazon-bedrock && !claude && thinkingLevel!=off`. Also: Bedrock Converse reports **no reasoning tokens at all** — do not design a JSONL column you cannot fill. |
| C7 | "Qwen on DashScope requires `compat.thinkingFormat:'qwen'`" | Confirmed and **broadened**: applies to DeepSeek-on-DashScope too (`thinkingFormat:"deepseek"` + `requiresReasoningContentOnAssistantMessages:true`), and the failure is not limited to thinking — it produces a 400 on the second turn of a tool sequence. | PITFALLS 8 + STACK §3a, both at `openai-completions.ts:1442-1540` | Write the whole `compat` block explicitly for every DashScope model. |
| C8 | Per-role thinking budgets are contingent and possibly unbuildable | **Inverted for the nested path.** `modelRegistry.complete()` takes exact per-call `reasoningEffort` / `thinkingEnabled` / `thinkingBudgetTokens`. Per-role thinking budgets are *cheap and verifiable* on the nested path (advisor, reviewer, summariser); only the **main loop** is limited to session-scoped `pi.setThinkingLevel()`. | ARCHITECTURE Pattern 2, `pi-ai/dist/api/*.d.ts` | Split the requirement: nested-role thinking budgets unblocked as soon as `callModel()` exists; main-loop budgets stay gated on the wire inspector. |
| C9 | "Bedrock SSO … export `AWS_PROFILE`" (implied) | Better: **`credential.env.AWS_PROFILE` in `auth.json` is checked *before* process env.** Survives a fresh shell, does not leak into unrelated tooling, contains **no secret**, therefore templatable in-repo. Also: `/login` → "Existing AWS credential chain" **stores nothing** and is a no-op that looks like configuration; EC2 instance profiles are unsupported. | STACK §3b + PITFALLS 10, `amazon-bedrock.ts` `resolve()` | Ship `config/auth.json.example` with the `env` block. Runbook: `aws sso login --profile X && echo $AWS_PROFILE`. |
| C10 | "~11 installed extensions … install commodity features" | Holds, with two caveats: **file checkpointing and provider fallback are LOW-confidence categories**, and **Pi's own tarball examples should be preferred over third-party packages wherever they cover the need** (390-line plan mode, `permission-gate.ts`, `git-checkpoint.ts`, `protected-paths.ts`). | STACK §6 + Alternatives table | Add "check Pi's bundled examples first" to the extension-selection rule. |

---

## Cross-Document Conflicts — Resolved

### R1. DeepSeek thinking levels — **UNRESOLVED, settle with one request**

**PITFALLS 4:** DeepSeek's API accepts `low`/`high`/`max`; Pi's catalog nulls `minimal`/`low`/`medium` and `getSupportedThinkingLevels()` filters nulls out, so the only selectable levels are `off`/`high`/`max`. `clampThinkingLevel` walks *upward*, so `/think low` silently becomes `high`. For a cost-control harness, "your cheap executor has no cheap thinking setting" is a permanent output-token multiplier. Fix: override `thinkingLevelMap`.

**STACK correction 2:** the same map is **correct**, because DeepSeek V4 accepts only `high` and `max`, with `low`/`medium`→`high` and `xhigh`→`max` mapped server-side. Pi hides levels the model cannot honour rather than sending values that get silently rewritten.

**Resolution: the mechanism is agreed; only the API contract is disputed, and the sources are not the same source.**
- Both agree, at source, on Pi's behaviour: the catalog nulls the low tiers, `getSupportedThinkingLevels` filters them, and the *adapter* would happily carry `low` if something set it (`model.thinkingLevelMap?.[level] ?? options.reasoningEffort`, and `null ?? "low"` → `"low"`). The block is in the catalog and the session, not the wire.
- The disputed fact is what `api.deepseek.com` accepts. **PITFALLS cites DeepSeek's own Thinking Mode guide and Create Chat Completion reference, which render `reasoning_effort` as `low/high/max`. STACK cites `alibabacloud.com/help/en/model-studio/deepseek-api` — an *Alibaba DashScope* page — and attributes "DeepSeek confirms" without a separate citation.** On source proximity, PITFALLS has the better evidence for the direct endpoint; STACK has the better evidence for DashScope. Most likely truth: **both are right about different endpoints**, and STACK generalised a DashScope-documented server-side mapping onto DeepSeek-direct.
- **Neither researcher issued a request.** Marking this UNRESOLVED.

**What settles it (cheap, one request, no code):** POST to `api.deepseek.com` with `{"thinking":{"type":"enabled"},"reasoning_effort":"low"}`. HTTP 400, or 200 with reasoning-token counts indistinguishable from `"high"` ⇒ STACK is right and the catalog is faithful. 200 with materially fewer reasoning tokens ⇒ PITFALLS is right and the override restores a genuine cheap tier.

**Roadmap instruction:** a **Phase 2 (Providers) experiment gated behind Phase 1 (wire inspector)**, not a design input. Do **not** define `/cheap` semantics around the existence of a low thinking tier until the request has been made. The override is trivially reversible. Impact is bounded either way: on the DashScope path `low`→`high` server-side regardless, so this only ever affects DeepSeek-direct.

### R2. `reasoning_effort` nesting — **DEAD, both researchers falsified it independently**

Not a conflict; a convergence worth recording because PROJECT.md still treats thinking-budget levers as contingent on it. STACK and PITFALLS read the same code (`openai-completions.ts:796-806`) from different starting assumptions and both concluded Pi is correct. PITFALLS calls it its "headline correction": *"Building a 'fix' for it would have been wasted work."* **Remove any nesting-related remediation from the roadmap.** Keep the wire-inspector-before-quality-levers gate — it now earns its place on Bedrock non-Claude (C6), DashScope compat (C7), the low-tier question (R1), and context budget (C4).

### R3. Qoder — **STACK wins; Qoder is not a provider and is not in v1**

STACK is the only document with direct evidence, and it is strong: the Cloud Agents API is orchestration (agent → environment → session → SSE of high-level events, cursor-paginated), the Agent SDK is a hosted agent loop with its own tools, and `docs.qoder.com/llms.txt` — the complete documentation index — has no inference endpoint. It also unpacked both `pi-*-qoder` npm packages and found WAF-bypass body encoding and COSY RSA/AES-CBC/MD5 signature forging against `gateway.qoder.sh`, confirming PROJECT.md's exclusion with evidence rather than inference.

**Consistency check:** ARCHITECTURE's integration table lists "Qoder (official PAT) → `pi.registerProvider`, **or `models.json` if it is plain OpenAI-compatible**" — that conditional is falsified; it is not. FEATURES defers "Qoder Agent SDK as a routed role" to v2+ — "routed role" is also not constructible. Neither contradicts STACK's evidence; both simply predate it.

**What Qoder CAN be, plainly:**
- **In v1: nothing.** Remove it from the routing table, the fallback chain, and the capability guard.
- **At v2+, optionally: a delegate tool only** — `qoder_task({prompt, repo})` creating a Cloud Agents session and streaming SSE back as tool content. It is a *foreign agent*, not a model: Pi's tools, `AGENTS.md`, system prompt, safety hooks, and wire inspector **all bypass it**. Given the safety posture (a machine where `main` auto-deploys) and the instrument-first principle, that is a significant caveat, not a footnote.
- **The fallback chain becomes DeepSeek-direct → DashScope**, both real inference endpoints and both already required. Constructible and strictly simpler.

### R4. Subagent worktrees — **not actually contradictory; different granularity**

STACK: do not install `@gotgenes/pi-subagents-worktrees` (bridges only `@gotgenes/pi-subagents`, silently no-ops otherwise); `pi-subagents` has worktrees natively via `worktree: true` on **workflow runs**, `@tintinweb/pi-subagents` via `isolation: worktree` in **agent frontmatter**.

ARCHITECTURE: enumerated `pi-subagents@0.47.1`'s **agent frontmatter** from its `docs/agents.md` — `name, aliases, description, tools, extensions, model, fallbackModels, thinking, systemPromptMode, inheritProjectContext, inheritSkills, skills, skillPath, defaultContext, output, defaultReads, defaultProgress, async` — with **no `worktree` key**.

**Resolution: both are accurate.** In the recommended package, worktree isolation is a property of a *workflow run*, not of an agent definition — so its absence from the frontmatter list is expected, not a contradiction. The bridge package stays excluded (C3). Two live caveats: **neither researcher exercised a worktree run** (UNVERIFIED), and PITFALLS 22 flags real edge cases — untracked/ignored files (`.env`, `node_modules`, `.terraform/`) do not travel to a new worktree so a fresh agent may fail to build for reasons that look like code errors; parallel agents on the same file conflict *after* both have been paid for; Windows worktrees + long paths are a known friction area; cleanup is not automatic. **Roadmap: worktree isolation is v1.x, and its planning phase must first verify the actual invocation path at the pinned version and prove a worktree can *build*, not just check out.**

### R5. Context budget floor — **ARCHITECTURE's number stands; the two documents agree on mechanism**

ARCHITECTURE measured ~1,850 tok/turn (756 system prompt with 7 built-in tool snippets + 399 descriptions + 707 schemas). PITFALLS 18 independently states the base system prompt is ~350–450 tok and that **registered tools do not bloat the system prompt but do bloat the request body** (`buildSystemPrompt` lists a tool only if the caller supplied a snippet; `description` + `parameters` go into the request regardless). Same mechanism measured at two points: PITFALLS' 350–450 is the prose-only prompt; ARCHITECTURE's 756 includes the seven built-in tool snippets (558 with the 4-tool default). **No conflict — PROJECT.md's ~400 is simply the wrong quantity to budget against.**

**Consequences the roadmapper must carry forward:**
- Per-turn floor is **~1,850 tok**, ±20% on tokenizer ratio (character counts exact; use `usage.input` from the wire log for anything that matters).
- **`pi.setActiveTools()` is the only real lever.** Tool *removal* never uses deferred loading and invalidates the prompt cache — set the profile once at `session_start`, then only add.
- Native deferred loading exists only on Anthropic ≥4.5 and OpenAI gpt-5.4+; **DeepSeek gets the full-list fallback**, so the win comes entirely from starting small.
- The `context` hook cannot strip tool definitions. There is no `defaultTools` setting. `promptSnippet` omission is ~37 tok of theatre.
- Skills index: ~112 tok header + 40–60 tok per skill. PROJECT.md's decision not to port GSD's ~60 skills is quantitatively correct (~3,000 tok/turn of pure index).
- **The 50× cache-read asymmetry (critical for the UI phase)** — keep volatile content out of the system prompt entirely.

### R6. `/share` blocking — **ARCHITECTURE wins** (see C5)

PITFALLS 14 recommends "a slash-command interception"; ARCHITECTURE verified at the dispatch site that no extension can see `/share`. ARCHITECTURE has the specific evidence. The control is `gh` auth, not a hook. PITFALLS' *other* `/share` findings stand: a GitHub "secret" gist is unlisted, not private, permanent, and world-readable by URL; `PI_OFFLINE` does **not** gate it; Pi's network surface is otherwise minimal (no analytics, no crash reporter, no session-content upload, no prompt logging).

---

## Implications for Roadmap

Reconciled across ARCHITECTURE's dependency-derived build order, PITFALLS' five "ordering consequences this research forces", and FEATURES' MVP list.

### Phase 0: Bootstrap, packaging, and supply chain
**Rationale:** Two things must be true *before the first `pi install`* or they cannot be fixed later — `ignore-scripts=true` in `~/.npmrc`, and an exact-pinning policy. Everything else executes third-party code on a laptop with live deploy credentials. Also establishes the repo shape every later phase writes into.
**Delivers:** `package.json` with `pi` manifest → `./.pi/*`, `peerDependencies` (never bundled), `keywords:["pi-package"]` · `bin/bootstrap.sh` (POSIX sh, marked-region idempotent edits, **loud fallback if the pinned Pi version has been unpublished**) · `.gitattributes` with `*.sh text eol=lf` · explicit `shellPath` asserted at startup · `.gitignore` for all runtime state · `PI_OFFLINE`/`PI_TELEMETRY` defaults · `gh` left unauthenticated (the real `/share` control) · CI matrix skeleton (`windows-latest` + `macos-latest` × Node 22/24) · a hello-world extension proving both `pi install <repo>` and the `.pi/` dogfood path load · the **boundary rule written into CONTRIBUTING**.
**Avoids:** Pitfalls 12, 16, 17, 14.
**Exit test:** `npm config get ignore-scripts` is `true` before any `pi install`; both load paths work on Windows and macOS.

### Phase 1: Diagnostics — the instrument
**Rationale:** Load-bearing for four separate pitfalls and for the founding diagnosis. `callModel()` is a Phase 1 artifact that routing and quality gates import — the ordering is structural, not a preference. Building anything else first means building on an unmeasured assumption, the exact failure the project already had once.
**Delivers:** the three provider hooks · **the `callModel()` chokepoint** with per-call `onPayload`/`onResponse` · per-turn JSONL (**no reasoning-token column for Bedrock; it does not exist**) · `/budget` reporting five numbers (system-prompt tok, tool-schema tok, context-file tok, skills-index tok, `cacheRead` vs `input`) · **the prose-tool-call detector** · redaction at capture + gitignored dumps (a wire inspector is by construction a credential-logging tool, feeding a public repo) · log rotation.
**Avoids:** Pitfalls 1, 2, 3, 4, 7, 8, 18, 19.
**Exit test:** a wire dump per provider showing whether thinking/effort params arrive; the prose-tool-call detector has fired on real traffic; `cacheRead` non-trivial by turn 3.

### Phase 2: Providers and credentials
**Rationale:** Structurally complete, secrets blank, verified by Phase 1's instrument. Parallel with Phase 3.
**Delivers:** `models.json` / `auth.json` templates with `$ENV_VAR` / `!command` (in `auth.json` only) · DashScope custom provider with an **explicit** full `compat` block · Bedrock via `credential.env.AWS_PROFILE` · SSO-expiry classification mapped to `Run: aws sso login --profile <name>` and marked **non-retryable** · the **R1 low-thinking-tier experiment** · capability metadata (`input[]`, true `contextWindow` per provider, `cost`) · first-run runbook.
**Avoids:** Pitfalls 5, 6, 8, 9, 10, 11.
**Exit test:** two-turn *tool-calling* sequence on DashScope returns 200 (the first turn always works — test the second); no secret in the repo.

### Phase 3: Safety — parallel with Phase 2, not after
**Rationale:** Safety has zero dependency on routing, and the deployment risk exists from the very first real session. **GitLab server-side protected branches are an earlier deliverable than the hook** — the only control that is not theatre.
**Delivers:** GitLab protected branches + approval rules verified by attempting a push · `unbash` AST → canonical invocations, failing closed · policy (`HEAD==main` writes, `glab mr merge`, `.env`/`~/.aws/credentials`/kubeconfig/`*.tfstate` reads, `terraform apply|destroy|import`, mutating `aws`, `kubectl delete`) · **hook + wrapped-bash-tool double enforcement** · block→approval-tool→re-issue · **deny-by-default with a CI test asserting the deny under `--mode json`** · non-bash surface guarded (`.git/hooks/*`, `.git/config`, `~/.bashrc`, `~/.gitconfig`, CI files) · audit JSONL of every allow and block · **user-scope installation** · a documented table of known misses.
**Avoids:** Pitfalls 13, 15, 17; Anti-Patterns 3 & 4.
**Exit test:** the blocked-command test passes **inside a subagent**; ~30 evasion attempts each blocked or explicitly documented as out of scope.

### Phase 4: Routing
**Rationale:** Depends on Phase 1 to verify and Phase 2 for models to exist. Three-tier mechanism, no virtual provider.
**Delivers:** role→model map · `/cheap` `/balanced` `/max` via `pi.setModel()` from commands after `waitForIdle()` · sticky, visible `/escalate` · capability guards as hard blocks (vision→text-only, oversized context→small window, **Bedrock non-Claude + thinking**, **Bedrock DeepSeek as executor**) · mode persistence via `pi.appendEntry` (0 tokens) · `settings.subagents.agentOverrides` written by the mode switch.
**Exit test:** every mode switch produces a wire dump proving the intended model was used.

### Phase 5: Composed extensions, pinned and reviewed
**Delivers:** the 11 exact-pinned extensions · `.pi/agents/*.md` with **no `model:` key** (so the settings layer wins) · a committed lockfile · a smoke-test ritual for every bump (one turn per provider, one subagent spawn, one blocked command, one wire dump).
**Exit test:** `pi list` matches the lockfile; a reviewer subagent runs end to end.

### Phase 6: Quality gates
**Delivers:** LSP/typecheck/lint gates first · strong-model diff review via a fresh-context reviewer subagent fed the **full contract** · anti-review-theatre protocol · **seeded-defect calibration** (the only way to distinguish "the code is clean" from "the reviewer is asleep", and it produces the number that justifies the whole escalation design) · advisor escalation via `callModel()` · **nested-role thinking budgets (unblocked by C8); main-loop budgets only if Phase 1 proved the parameters land.**
**Exit test:** a seeded bug that DeepSeek misses and the gate catches.

### Phase 7: Workflows — `/quick` first
**Rationale:** PITFALLS is explicit: build `/quick` **before** the ceremonial workflows. Smallest, most used, and it exercises the routing/safety/evidence plumbing at minimum size. Consider pulling a skeletal `/quick` forward to the Phase 3/4 boundary as plumbing validation.
**Delivers:** `/quick` (**≤80 lines; if it exceeds 100 it has failed**) · `/grill` → SPEC.md §1–8 (uncuttable: §2 Verified Codebase Facts, §4 mandatory `IF/THEN` errors, §5 scope pin) · `/plan` → PLAN.md with `T### [P] [R#] verb <explicit path> + verification command` and a coverage matrix · `/execute` → PROGRESS.md with pasted command output · `/review` → REVIEW.md → MR targeting **staging, never `main`** · line-budget CI test.
**Exit test:** one real feature shipped end to end on the work laptop.

### Phase 8: Progressive-disclosure tuning
**Delivers:** measurement via `/budget` · named tool profiles (`recon`/`implement`/`review`/`full`) set at `session_start` and only added to · demotion of tools to skills/commands · AGENTS.md hard token budget in CI · **the controlled minimal-vs-full-harness experiment** that settles whether context pollution is actually a cause.

### Phase 9: UI
**Delivers:** theme (53 colour tokens, 51 required) · statusline · startup header · subagent activity widget — **all volatile content in TUI chrome, never in the system prompt** (50× cache penalty).

### Phase Ordering Rationale

- **Phase 0 before everything, non-negotiable.** `ignore-scripts` must be set before the first `pi install`; a pin policy set afterwards is applied to code that already ran.
- **Phase 1 before Phases 4 and 6, structurally.** `callModel()` is a Phase 1 export both import.
- **Phase 3 parallel to 2 and 4, not after.** Safety imports nothing from routing (deliberately), and the deploy risk exists from session one.
- **Prose-tool-call detector in Phase 1, not Phase 6.** Most likely root cause, measurable, cheap to measure.
- **GitLab server-side config is a Phase 3 deliverable, not a note.**
- **`/quick` before the ceremonial workflows** — a walking skeleton precedes a cathedral.

### Research Flags

**Phases likely needing `/gsd:plan-phase --research-phase`:**
- **Phase 2 (Providers)** — three open empirical questions, none answerable from a desk: the R1 low-thinking-tier contract, the real DashScope `contextWindow` (393,216 corroborated by STACK from Alibaba's docs, marked **UNVERIFIED** by PITFALLS), and whether strict-schema mode reduces the prose-tool-call rate. These need **live verification on the work laptop** — plan the phase around a verification runbook.
- **Phase 3 (Safety)** — `unbash`'s handling of Git Bash path forms (`/c/Users/...` vs `C:\`) in argument position is UNVERIFIED and a real cross-platform risk for path-scoped policy. The `@ramtinj95/pi-infra-command-guard` source read is a genuine research task (read, do not install).
- **Phase 5 (Composed extensions)** — versions move at 13–16 releases/month; **every pin must be re-verified at planning time**, not inherited from this document. Checkpointing and fallback are LOW confidence and should be re-surveyed.
- **Phase 8** — the controlled minimal-vs-full experiment is a research task with a designed protocol, not an implementation task.

**Phases with standard patterns (skip research-phase):**
- **Phase 0** — packaging, manifest, install surfaces, theme schema, Windows shell resolution fully specified at source.
- **Phase 1** — all 33 events, return shapes and blocking semantics enumerated and verified; `fauxProvider` gives a complete offline test harness.
- **Phase 6 / Phase 7** — FEATURES already did the comparative survey with prescriptive artifact schemas, gate definitions, and line budgets. Implement from it.
- **Phase 9** — theme format exact (53 tokens, 4 value formats, hot-reload on edit).

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** for Pi API, packaging, provider configs, theme schema, `fauxProvider` (read from the 0.84.1 tarball). **MEDIUM** for third-party extension *behaviour* (README/manifest-derived; **nothing was executed**). **LOW** for file checkpointing and provider fallback, flagged in-line. |
| Features | **MEDIUM-HIGH** — SDD survey from primary vendor sources plus a local GSD 1.42.3 read with measured line counts. **MEDIUM** for the routing role taxonomy (practitioner reports, few controlled studies). **MEDIUM-LOW** for DeepSeek V4-Flash benchmark claims (vendor-adjacent). |
| Architecture | **HIGH** for hook wiring, event surface, `callModel()` necessity, `setActiveTools` semantics, `/share` dispatch, boundary rule — read from `dist/` or bundled docs, third-party mechanisms verified by reading source not READMEs. Token counts **exact in characters, ±20% in tokens**. |
| Pitfalls | **HIGH** for the 14 items tagged VERIFIED (source), each with a file:line into TypeScript recovered from sourcemaps, re-checkable in one command. **MEDIUM** for ecosystem claims and reasoned items (13, 19–22). |

**Overall confidence:** **HIGH** on Pi platform mechanics · **MEDIUM** on provider wire behaviour (no request was ever issued) · **LOW** on third-party extension runtime behaviour and the two flagged extension categories.

### VERIFIED at source vs UNVERIFIED

**VERIFIED at source** (re-checkable against the 0.84.1 tarballs / sourcemaps):
Pi's 33 events and return shapes · `tool_call` mutability with no re-validation · provider hooks wired only into the main agent `streamFn` · `noOpUIContext.confirm → false` · project trust requires UI ⇒ no project extensions in subagents · built-in slash commands matched before extension commands (`/share` unblockable) · `buildAdditionalModelRequestFields` returns `undefined` for non-Claude Bedrock · Bedrock `resolve()` order and `credential.env.AWS_PROFILE` precedence · Bedrock reports no reasoning tokens · `formatBedrockError` maps only five exception names · Pi's DeepSeek `thinking`+`reasoning_effort` emission · `getSupportedThinkingLevels` filtering `null` · `detectCompat` has no `aliyuncs.com` branch · `qwen-token-plan` host/key namespace · `getNpmInstallArgs` with no `--ignore-scripts` · `isExactNpmVersion` semantics · `auth.json` vs `models.json` `!command` caching · Windows shell resolution order (4 steps, docs list 3) · `chmod 0600` no-op on Windows · system-prompt/tool-schema token measurements · theme schema (53 tokens, 51 required) · `fauxProvider` API surface · Qoder's doc index containing no inference endpoint · the two `pi-*-qoder` packages' WAF-bypass and signature-forging code · release cadences and the unpublishing of Pi < 0.74.0.

**UNVERIFIED — do not plan as if these are settled:**
- **Whether DeepSeek-direct accepts `reasoning_effort: "low"`** (R1) — the one live contradiction between researchers.
- Whether DeepSeek V4 Flash honours `reasoning_effort` **at all** through Pi's `openai-completions` adapter — precisely what Phase 1 exists to answer.
- The DashScope DeepSeek context cap of exactly **393,216** tokens. The actionable point survives either way: **never copy `contextWindow: 1000000` from Pi's direct-DeepSeek entry into a DashScope entry.**
- **Runtime behaviour of every third-party extension** — nothing was executed.
- The `pi-background-tasks` resource-filter globs in the install block — **verify the real paths before shipping that filter**.
- Whether `@juicesharp/rpiv-i18n` (a peer dep) resolves under Pi's `npm install --omit=dev`.
- Git worktree behaviour under `pi-subagents` (R4), and Windows worktree/long-path friction.
- `unbash` handling of Git Bash path forms in argument position.
- Whether strict schema mode reduces DeepSeek's prose-tool-call rate.
- Whether a virtual-provider `streamSimple` preserves `/session` cost accounting (moot unless a later milestone adopts one).
- **Per-turn system-prompt token cost of each individual extension** — needs measurement against a running Pi; "the single most important number for the cheap-model hypothesis".
- `glab` / `aws` CLI behavioural differences on Windows.

### Gaps to Address

- **R1 (DeepSeek low tier)** — one request settles it. First item of Phase 2, gated behind Phase 1. Until then, `/cheap` must not be *defined* in terms of a low thinking tier.
- **No credentials on the dev machine** — mitigated better than expected by `fauxProvider` + `SessionManager.inMemory()` + `InMemoryCredentialStore` for session tests, and `--mode rpc` (where `hasUI` is `true` and a test client can *answer* a `confirm()`) for dialog tests. Everything genuinely credential-dependent goes into the **first-run runbook**, a Phase 2 deliverable and a real artifact.
- **The root-cause question is still open.** Three candidates with different evidence quality: prose tool calls (~11%, open upstream issue, MEDIUM), context pollution (mechanism VERIFIED, degradation evidence MEDIUM — Chroma's Context Rot covers frontier models and does not isolate system-prompt bloat; **no study establishes a token threshold, and anyone quoting one is guessing**), and provider misconfiguration (VERIFIED for Bedrock non-Claude and DashScope). Phase 1 + Phase 8's experiment discriminate between them. **The roadmap should not commit to a fix for a cause that has not been measured.**
- **Two LOW-confidence extension picks** — plan Phase 5 to re-survey rather than to install from this document.
- **Pin shelf life** — versions below 0.74.0 are already gone from npm. Bootstrap needs a fallback-to-latest path with a loud warning; a standing monthly maintenance session is a real cost at 13–16 releases/month across ~11 extensions.
- **Tokenizer imprecision** — all token figures ±20%. For anything that matters, read `usage.input` from the wire log.

---

## Sources

Full source lists live in each research file. Aggregated by tier:

### Primary (HIGH confidence)
- **`@earendil-works/pi-coding-agent@0.84.1` npm tarball** — bundled `docs/` (35 files, 12,196 lines); `dist/core/**` (`extensions/types.d.ts`, `extensions/runner.js`, `sdk.js`, `system-prompt.js`, `skills.js`, `model-registry.d.ts`, `package-manager.ts`, `project-trust.ts`, `auth-storage.ts`, `settings-manager.ts`, `tools/bash.ts`, `prompt-templates.js`); `dist/modes/interactive/interactive-mode.js`; `dist/utils/shell.js`; theme schema + `dark.json`; ~80 bundled `examples/extensions/`; `CHANGELOG.md` (5,436 lines)
- **`@earendil-works/pi-ai@0.84.1` npm tarball** — `api/bedrock-converse-stream.{js,ts}`, `api/openai-completions.{js,ts}`, `models.ts`, `providers/amazon-bedrock.ts`, `providers/deepseek.ts`, `providers/qwen-token-plan.ts`, `providers/faux.{js,d.ts}`, `providers/data/*.json`
- **Sourcemap recovery method** — `npm pack` + `dist/**/*.js.map` `sourcesContent` recovers 371 original `.ts` files across both packages; every VERIFIED claim re-checkable in one command
- Third-party tarballs unpacked and read as *source*: `pi-subagents@0.47.1`, `@tintinweb/pi-subagents@0.15.0`, `@gotgenes/pi-subagents-worktrees@0.3.0`, `@ramtinj95/pi-infra-command-guard@0.9.1`, `cc-safety-net@2.0.3`, `pi-defender@1.9.1`, `pi-sandbox@0.6.3`, `pi-router@0.5.0`, `pi-smart-router@0.16.0`, `pi-model-auto@0.2.2`, `pi-bifrost@0.4.0`, `@firstpick/pi-extension-tools@0.1.8`, `@narumitw/*`, `@juicesharp/rpiv-*`, `pi-loop-police@1.14.1`, `awesome-pi-themes@1.1.9`, `pi-provider-qoder@0.3.0`, `@minhduydev/pi-harness@2.8.1`
- npm registry + downloads API and GitHub REST API (authenticated `gh`) — every version, publish date, download count, `pushed_at`, star count, `archived` flag, queried **2026-08-13**
- Vendor docs: DeepSeek Thinking Mode guide + Create Chat Completion reference · Alibaba Model Studio (DeepSeek API, regions/endpoints, OpenAI compatibility) · AWS Bedrock DeepSeek model parameters · Qoder Cloud Agents docs + `llms.txt` · GitHub spec-kit (`clarify.md`, `tasks.md`) · Kiro specs docs · OpenSpec `concepts.md` · **Anthropic, *Best practices for Claude Code*** · GitLab `glab mr` reference
- Local: **GSD 1.42.3 install**, read directly with measured line counts

### Secondary (MEDIUM confidence)
- `deepseek-ai/DeepSeek-V3` issue #1244 (prose tool calls, 11% measured, open, V4-Pro) corroborated across sglang #17561, vllm #28219, openclaw #85918, HuggingFace V4-Pro discussion #209
- `langchain-ai/langchain-aws` #447 + AWS re:Post — R1 on Bedrock Converse rejects tool use
- pi issue #6998 — DeepSeek-via-Aliyun should use `thinkingFormat=qwen`; **closed**, fix verified present in the 0.84.1 catalogue
- Chroma, *Context Rot* — mechanism suggestive, **does not isolate system-prompt bloat and establishes no threshold**
- Martin Fowler / Böckeler et al., *Understanding Spec-Driven Development* — the best critical source on SDD
- *Refute-or-Promote* (arXiv 2604.19049) · *Are LLMs Reliable Code Reviewers?* (silent approvals) · CodeRabbit and Augment Code on reviewer context
- Supply-chain threat intel: Orca (TanStack / Mini Shai-Hulud, 160+ packages), Wiz (keyv/cacheable), Phoenix Security 2026

### Tertiary (LOW confidence — flagged, not laundered)
- DeepSeek V4-Flash benchmark claims (openrouter / benchlm) — **vendor-adjacent, not independent**
- *The Productivity-Reliability Paradox* (arXiv 2605.01160) — thesis only; empirical detail not retrievable
- awesome-pi.site — self-described "auto-discovered, LLM curated", 6,996 entries, **no editorial or security review**; discovery only, never a selection criterion
- Third-party extension README claims generally (nothing executed)

### Explicitly rejected
- DeepSeek's own *"Using DeepSeek with Oh My Pi"* page — it is for **Oh My Pi**, a different fork on an archived repo, and prescribes `compat` keys (`supportsToolChoice`, `requiresReasoningContentForToolCalls`, `requiresAssistantContentForToolCalls`) and a `models.yml` file that **do not exist in Pi**.
- `pi-provider-qoder@0.3.0` / `pi-qoder-provider@0.2.2` — WAF-bypass body encoding and COSY RSA/AES-CBC/MD5 signature forging against `gateway.qoder.sh`, verified from the bundle. Breach Qoder ToS §3.2.6/§3.2.9/§3.2.10; §15.2 makes termination irreversible.
- `@preapexis/pi-kit` — 404 on npm; no claims made.

---
*Research completed: 2026-08-13*
*Ready for roadmap: yes — subject to the Corrected Assumptions and the one UNRESOLVED item (R1)*
