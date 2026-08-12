# ky-pi-agent

## What This Is

A personalised coding-agent harness built on [Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`, MIT, by Mario Zechner / Earendil Works), distributed as a public GitHub repo at `git@github.com:kaiyitkoh/ky-pi-agent.git` that is both Pi-installable (`pi install https://github.com/kaiyitkoh/ky-pi-agent`) and bootstrappable on a cold machine.

It exists to make *cheap models reliable*. The user's daily driver is intended to be DeepSeek V4 Flash, with stronger models (Anthropic via AWS Bedrock) reserved for the specific moments where they earn their cost. Everything in the harness — routing, quality gates, subagents, workflows, safety — serves that one goal: get Claude-Code-grade output from models that cost a fraction of Claude.

For the user: an AI Scientist who also does full-stack development across frontend, backend, and AWS infrastructure via Terraform, on large multi-stack codebases.

## Core Value

**A harness that makes a cheap model produce work you'd trust from an expensive one — without the harness itself becoming the bottleneck.**

If the routing is elegant, the UI is beautiful, and the workflows are sophisticated, but DeepSeek Flash still misses bugs that Sonnet would catch, the project has failed. Everything else is negotiable against this.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**Model routing & providers**
- [ ] Explicit role→model mapping (planning, coding, review, advisor, vision) — no auto-classification
- [ ] Capability guards that hard-block impossible routes (image → text-only model, oversized context → small-window model)
- [ ] Session modes (`/cheap`, `/balanced`, `/max`) swapping the whole role→model map, plus per-invocation `/escalate`
- [ ] AWS Bedrock provider working with IAM Identity Center SSO, including detection of expired credentials with an actionable message (not an opaque provider error)
- [ ] Alibaba DashScope as a custom OpenAI-compatible provider in `models.json` — **not** Pi's built-in `qwen-token-plan` provider, which uses a different host and a different key namespace (`sk-sp-` prepaid) incompatible with pay-as-you-go `sk-` keys
- [ ] Qoder as a **delegate tool only** via its official Agent SDK — Qoder exposes no inference endpoint (verified via `docs.qoder.com/llms.txt`; Cloud Agents is task orchestration, the SDK is a hosted agent loop), so it cannot be a model in the routing map. Hands off a whole task, folds the result back. Never via an unofficial bypass proxy.
- [ ] Provider fallback chains on quota/transient/unavailable errors within Bedrock/DashScope, using a maintained extension as a stopgap the authored router later absorbs
- [ ] Credentials blank-but-ready: every provider structurally complete in-repo, secrets resolved at runtime via `auth.json` `$ENV_VAR` / `!command` interpolation. Nothing secret ever committed.

**Diagnostics (blocks trusting any routing decision)**
- [ ] Wire-level request inspector via `before_provider_request` / `after_provider_response` — dumps the exact JSON payload per provider, so thinking/effort/caching parameters are observed, not assumed
- [ ] Per-turn JSONL log: model, provider, tokens, cost, latency, outcome
- [ ] First-run verification runbook the user executes on the work laptop (where credentials exist)

**Quality levers (all budget-dialed, stacking)**
- [ ] Deterministic gates first — LSP / type-check / lint errors fed back before any model review
- [ ] Strong-model diff review, fed the diff **plus touched files plus test/typecheck output** (a diff alone misses bugs of omission and cross-file breakage)
- [ ] Per-role thinking budgets — *contingent on the wire inspector proving thinking parameters actually reach the provider*
- [ ] Advisor escalation — cheap executor consults a stronger model at hard decision points

**Subagents**
- [ ] Per-agent model, system prompt, tool restriction, and thinking level
- [ ] Git worktree isolation for parallel agents
- [ ] Background / async execution
- [ ] Mid-run steering
- [ ] Composed from a maintained extension with pinned exact versions — **not forked** (`pi-subagents` ships ~15 releases/month; a fork is permanent divergence)

**Workflows (the GSD replacement)**
- [ ] `grill → spec` — interrogate until the spec is unambiguous, verified against real code. Targets four named failure modes: wrong assumptions about the codebase, underspecified edge cases, user not knowing what they want, scope drift
- [ ] `plan → execute` — task breakdown, then execution with subagents and routing
- [ ] `review → MR → staging` — strong-model review, MR creation with a real description, merge to staging
- [ ] `quick` — no-ceremony path for trivial work, atomic commits only
- [ ] Informed by a survey of spec-kit, AWS Kiro, OpenSpec, and Tessl — combining the best of each rather than adopting one

**Safety**
- [ ] Block-and-confirm dialog on dangerous commands via the `tool_call` hook
- [ ] Block writes when `HEAD == main`; block `glab mr merge`; allow read-only operations against main (`git fetch/rebase/diff/log origin/main`, `git worktree add -b feat main`)
- [ ] GitLab server-side protected branches configured as the *real* control — the harness rule is defense-in-depth
- [ ] No file writes or deletes outside the project directory
- [ ] Secrets and state read guard: `.env`, `~/.aws/credentials`, kubeconfig, `*.tfstate`
- [ ] Confirm-gate mutating infra commands: `terraform apply/destroy/import`, mutating `aws` CLI calls, `kubectl delete`
- [ ] Block `/share` (uploads the session to a GitHub gist — unacceptable on a work laptop)
- [ ] Loop detection (a cheap-model failure mode specifically)
- [ ] Auto-retry and failover on 429 / expired SSO / connection errors
- [ ] Audit log of every blocked and confirmed action
- [ ] Supply chain: exact-version pins, never unpinned `pi install`, safety-critical extensions vendored or source-reviewed

**Claude Code parity**
- [ ] Plan mode
- [ ] Todo / task tracking
- [ ] Background bash
- [ ] File checkpointing (Pi's `/tree` and `/fork` rewind the *conversation*, not the working tree)
- [ ] Structured multiple-choice user prompts (an `AskUserQuestion` analogue)
- [ ] Web / documentation lookup (Pi has no web tool at all, and MCP is out of scope)

**Context & verification**
- [ ] Per-project `AGENTS.md` only — explicitly **no** auto-learned memory (stale facts fail invisibly; `AGENTS.md` fails visibly in a diff)
- [ ] Session search for retrieval-on-demand
- [ ] Playwright CLI against localhost for pre-push verification, evidence-gated
- [ ] Vision handled by delegating the single turn to a vision model, never switching the session
- [ ] Evidence-gated completion: no claim of success — build passes, tests pass, endpoint works — without real command output in the transcript

**UI (sequenced last)**
- [ ] Custom theme
- [ ] Custom statusline — model, provider, context remaining, session cost, git branch, changed files
- [ ] Custom startup header
- [ ] Live subagent activity widget

**Cross-platform**
- [ ] Works on Windows (via Git Bash — Pi requires a bash shell on Windows; WSL is not required) and macOS
- [ ] All hooks, gates, and scripts POSIX `sh` — never PowerShell
- [ ] GitHub Actions matrix (`windows-latest` + `macos-latest`) providing real macOS verification, since macOS cannot be tested locally

### Out of Scope

- **MCP** — not part of the user's workflow; one less layer. Note this compounds with Pi having no web tool, so a web extension becomes mandatory.
- **Auto-learned / semantic memory** — stale facts fail invisibly. `AGENTS.md` is inspectable and diffable.
- **Qoder via unofficial proxy** — the Pi-specific proxy advertises WAF bypass and signature forging; Qoder's ToS §3.2.6/§3.2.9/§3.2.10 bar this, §2.4 permits suspension without notice, §15.2 makes termination irreversible.
- **Qoder as a routable model** — not technically possible. No inference endpoint exists. Delegate tool only.
- **A virtual provider for routing** (`pi.registerProvider`) in v1 — its unique benefit is automatic per-turn routing, which this project explicitly rejected, and it costs the `/model` picker, `PI_MODEL` accuracy, and cost accounting. `pi-router`, `pi-smart-router` and `pi-model-auto` all take this path; we deliberately do not.
- **Forking a subagent extension** — ~15 releases/month upstream makes a fork permanent unpaid maintenance.
- **Hosted observability SaaS** (Braintrust, LangSmith) — violates zero-spend; Braintrust self-hosting is Enterprise-only.
- **Self-hosted Langfuse** — needs Postgres + ClickHouse; violates the low-infra constraint. Local JSONL instead.
- **Strict TDD** — would fight Terraform and varied-maturity repos. Evidence-gating fixes the actual failure (false claims of success); TDD does not.
- **Browser automation built into the harness** — the user already uses Playwright CLI; a skill driving their existing flow is cheaper and better.
- **Porting GSD wholesale** — ~60 skills built on Claude Code's `Agent` / `TodoWrite` / `AskUserQuestion` / `ExitPlanMode` and `.claude/agents`. The skill *files* would load (Pi implements the Agent Skills standard and is more lenient than Anthropic's), but their tool calls fail. Building four native workflows instead.

## Context

**Where the user is coming from.** Heavy daily Claude Code user, driving it with `--dangerously-skip-permissions` because Anthropic earned that trust over many sessions. Uses the GSD skill suite for almost everything. Tried DeepSeek under the Claude Code harness via Alibaba Cloud and got poor results; diagnosed it as bad harness/model pairing. Specific complaint: *"DeepSeek doesn't think enough and misses a lot of bugs that Opus or Sonnet would have caught."*

**That diagnosis is unproven, and research narrowed the likely causes considerably.** Four researchers verified against Pi's published TypeScript (recovered from npm tarballs and sourcemaps), not documentation.

*Falsified — do not act on these:*
- The claim that Pi sends DeepSeek's `reasoning_effort` at the wrong nesting level. Two researchers independently confirmed Pi emits `{"thinking":{"type":"enabled"},"reasoning_effort":"high"}`, exactly as DeepSeek's Thinking Mode guide specifies.

*Confirmed at source:*
- Pi's Bedrock adapter returns `undefined` for thinking configuration on every non-Claude model (`bedrock-converse-stream.ts`, `buildAdditionalModelRequestFields`). Extended thinking is only requested for Claude on Bedrock.
- Bedrock Converse populates no reasoning-token usage, so thinking-token cost is unmeasurable there.
- Bedrock DeepSeek is R1/V3/V3.2 only — no V4 — and R1 supports no tool calling, making it unusable as an executor.
- DeepSeek emits tool calls as prose in `content` instead of `tool_calls` roughly 11% of the time (DeepSeek-V3 issue #1244, still open and titled for V4-Pro). Thinking budgets do not address this; `strict` schema mode is the documented mitigation.
- DeepSeek silently ignores `temperature`/`top_p`/penalties in thinking mode, and thinking is on by default.
- Pi's `detectCompat` has **no Alibaba/DashScope/Qwen branch**, so a custom DashScope provider silently receives `thinkingFormat: "openai"` (Qwen never thinks) and `requiresReasoningContentOnAssistantMessages: false` (DeepSeek returns 400 on the *second* turn of any tool sequence). This is the strongest candidate for the user's original bad experience.
- Pi's built-in `qwen-token-plan` provider uses a different host and a `sk-sp-` prepaid key namespace; a pay-as-you-go DashScope `sk-` key will not work with it.

*Unresolved:* whether Pi correctly restricts DeepSeek V4 to `high`/`max` thinking levels, or wrongly filters out a supported `low` tier. Two researchers reached opposite conclusions. Settle before relying on a cheap thinking tier.

**Per-role thinking budgets must still not be built until the wire inspector proves the parameters reach the provider** — but the reason is now the Bedrock non-Claude gap and the DashScope compat gap, not a wire-format bug.

**The strongest remaining hypothesis: context pollution.** Measured by importing Pi's own `buildSystemPrompt` and tool factories: the floor is **~1,850 tokens/turn** — ~756 for the system prompt with 7 tools, plus ~1,106 for the tool JSON schemas in the request payload. The dominant term is the payload `tools[]` array, which `promptSnippet` discipline does nothing about; `pi.setActiveTools()` is the only real lever, and the `context` hook **cannot** strip tool definitions. Every extension registering a tool adds to this on *every turn*. With Opus it is invisible; with DeepSeek Flash it is a credible cause of "doesn't think enough, misses things."

Compounding this: DeepSeek cache reads are ~50× cheaper than fresh input, so a single volatile token in the system prompt (a timestamp, a live statusline value) invalidates the cached prefix and costs 50× on the whole prefix every turn. Progressive disclosure is therefore an economic constraint, not an aesthetic one.

**Pi's actual shape.** Seven built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) — not four, as widely repeated; the four are an internal default in `system-prompt.ts`. Pi's docs state verbatim that it "intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash." There is **no sandbox and no permission system** — Pi's default is effectively permanent bypass mode. Pi ships a release every 2–3 days; the package registry holds 5,562 packages.

**Assets in Pi itself that reduce what must be built or installed:**
- `fauxProvider()` in `@earendil-works/pi-ai` — a scripted mock provider with `setResponses()`, call counting, and controllable streaming rate. Public API, undocumented outside the `.d.ts`. This makes the entire credential-dependent surface testable without API keys, which is decisive given the development machine has none.
- Pi's own tarball ships a 390-line plan-mode implementation and 60+ extension examples. Zero supply-chain risk, guaranteed API-current, preferred over third-party wherever they cover the need.
- `ctx.modelRegistry.complete(model, context, options)` — in-process nested LLM call to any model, no session mutation, per-call reasoning effort. This is what makes role→model routing achievable.

**Safety-relevant mechanics discovered in source:**
- The `tool_call` hook as a string matcher is trivially defeated (`g=push; git $g`, `sh -c`, heredocs). `unbash@4.0.10` — a zero-dep bash parser at 35.8M downloads/month — is the fix; read how `@ramtinj95/pi-infra-command-guard` applies it rather than installing that package (it drags in `openai` and `tree-sitter`).
- `pi install` runs **npm lifecycle scripts** with no `--ignore-scripts` on any path, and the pnpm branch sets `--config.strict-dep-builds=false`. Arbitrary code executes before the extension loader or the trust prompt. Mitigated by one line in `~/.npmrc`, which must precede the first install.
- Confirm dialogs **fail closed headless** — `noOpUIContext.confirm` returns `false` — so a guard written as `if (ctx.hasUI && !ok) block` fails **open** under `-p`/RPC. Requires an explicit CI test.
- Project-scoped extensions do not load in subagents (no UI ⇒ no trust), so safety guards must be user-scoped.
- Extensions can mutate tool input after approval with no re-validation, making extension load order part of the security model.
- `/share` cannot be blocked by any extension — built-in commands are matched before extension commands and before the `input` event. The only control is `gh` auth state.
- Provider hooks wire only into the main agent's `streamFn`; nested `complete()` calls bypass them, forcing a single `callModel()` chokepoint.
- `pi-sandbox`, the only genuinely robust guard, is macOS/Linux only. On Windows the honest ceiling is a mistake-catcher.

**The deployment fact that dominates safety design.** In the user's work repo, merging to `main` immediately deploys to AWS. `main` is not a branch — it is a deploy trigger. Terraform is owned by an infra team, so a merged `.tf` change *is* an infra change.

**Testing reality.** No API keys are available on the development machine. Everything credential-dependent must be built with mocked providers and verified by the user on the work laptop via a documented runbook.

## Constraints

- **Budget**: Zero spend beyond model API tokens. No SaaS subscriptions, no paid tiers, no hosted services. Open-source and self-hosted only.
- **Infrastructure**: Strong preference for zero background services — it should work from a cold laptop with Pi installed.
- **Complexity**: *"Don't overcomplicate things as complicated harness will result in lower performance."* Resolved via progressive disclosure rather than feature cuts: anything that cannot justify its per-turn token cost becomes a skill (name + description only until invoked) or moves into a subagent's isolated context.
- **Composition**: ~11 installed extensions + ~4 authored subsystems. Install commodity features (plan mode, todos, background bash, checkpointing, LSP, loop detection, web access, subagents, ask-user, session search, themes); author only the critical path (safety/gates, routing + capability guard, workflows, wire inspector). Reimplementing commodity features against an API shipping every 2–3 days is a maintenance tax, not an improvement.
- **Platform**: Windows (Git Bash) now, macOS later. POSIX `sh` throughout.
- **Secrets**: Public repo. No credential may ever be committed. Structure complete, values injected at runtime.
- **Security posture**: Extensions execute arbitrary code with full user permissions on a laptop holding live AWS SSO credentials for an account where `main` auto-deploys. Pin exact versions; review or vendor anything in the tool-execution or credential path.
- **Experience level**: New to Pi. Design decisions must be explainable, and the harness must remain debuggable by someone still learning the platform.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build native workflows rather than port GSD | GSD's ~60 skills depend on Claude Code tools that don't exist in Pi; four focused workflows cover the real usage | — Pending |
| Explicit role→model routing, not auto-classification | An auto-classifier that's wrong gives a bad result with no obvious cause — the same debugging problem the user already hit | — Pending |
| Capability guards as a hard block | Eliminates the one routing failure class that isn't a judgment call (vision, context overflow) for ~50 lines | — Pending |
| Wire inspector before quality levers | Two of the four levers may be no-ops on non-Anthropic providers; building mitigations on an undiagnosed cause is cargo-culting | — Pending |
| Deterministic gates before model review | Type errors and lint failures are a meaningful share of "bugs Opus would catch" — free, instant, never wrong | — Pending |
| Diff review gets diff + touched files + test output | A reviewer seeing only the diff misses bugs of omission and cross-file breakage | — Pending |
| `AGENTS.md` only, no auto-memory | Auto-learned memory goes stale invisibly; `AGENTS.md` goes stale in a diff | — Pending |
| Evidence-gated completion, tests optional | Fixes the actual failure (models falsely claiming success) without fighting repos of varied testing maturity | — Pending |
| Block writes on `HEAD == main` + block `glab mr merge`, not a blanket "main" matcher | A naive matcher breaks `git fetch/rebase/diff/log origin/main` and `git worktree add -b feat main` | — Pending |
| GitLab server-side branch protection is the real control | The `tool_call` hook is a string matcher, not a security boundary | — Pending |
| Qoder via official PAT + Agent SDK | Bypass proxies breach Qoder ToS and risk irreversible account termination; the official API gives the same capacity | — Pending |
| Compose subagents, never fork | ~15 upstream releases/month makes a fork permanent unpaid maintenance | — Pending |
| Progressive disclosure as an architectural principle | Resolves "don't overcomplicate" without cutting features; directly targets a plausible cause of the cheap-model symptom | — Pending |
| Repo *and* Pi package, not either/or | A `package.json` costs one file, a bootstrap script one more; choosing means being worse at one for no saving | — Pending |
| UI layer sequenced last | Genuinely wanted and motivating, but must not block a working daily driver; also gated by cache economics — volatile system-prompt tokens cost 50× on the whole prefix | — Pending |
| Route via `ctx.modelRegistry.complete()`, `setModel` at idle, and subagents — not a virtual provider | Verified at source as the mechanism Pi's own `summarize.ts`/`handoff.ts` use; avoids losing the `/model` picker and cost accounting | — Pending |
| Test with `fauxProvider()` rather than live credentials | Makes the credential-dependent surface testable on a machine with no API keys | — Pending |
| Prefer Pi's own bundled examples over third-party extensions where they cover the need | Zero supply-chain risk, guaranteed current against an API that ships every 2–3 days | — Pending |
| Project-scoped `.npmrc` with `ignore-scripts=true`, not global | `pi install` runs npm lifecycle scripts; arbitrary code executes before the trust prompt. Scoped because global `ignore-scripts` breaks legitimate native builds machine-wide. Residual gap — a `pi install` from another directory is unprotected — is documented rather than hidden | — Pending |
| Autonomous runs build and mark live checks outstanding | The 8 [RUNBOOK] requirements need credentials the dev machine lacks; blocking on them would stall progress, while silently passing them would repeat the project's original failure of building on unverified assumptions | — Pending |
| Qoder demoted from routable model to delegate tool | No inference endpoint exists — verified at `docs.qoder.com/llms.txt` | — Pending |
| GitHub Actions matrix for macOS verification | macOS cannot be tested locally; free on public repos; the alternative is shipping unverified | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-13 after domain research — corrected assumptions on DeepSeek wire format, Qoder capability, and context budget*
