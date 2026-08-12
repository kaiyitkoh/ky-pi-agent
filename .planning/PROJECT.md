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
- [ ] Qoder via its **official** Personal Access Token + Agent SDK / Cloud Agents API — never via an unofficial bypass proxy
- [ ] Provider fallback chains on quota/transient/unavailable errors (Qoder → Aliyun), using a maintained extension
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
- **Qoder via unofficial proxy** — the Pi-specific proxy advertises WAF bypass and signature forging; Qoder's ToS §3.2.6/§3.2.9/§3.2.10 bar this, §2.4 permits suspension without notice, §15.2 makes termination irreversible. The official PAT + Agent SDK provides the same capacity with no exposure.
- **Forking a subagent extension** — ~15 releases/month upstream makes a fork permanent unpaid maintenance.
- **Hosted observability SaaS** (Braintrust, LangSmith) — violates zero-spend; Braintrust self-hosting is Enterprise-only.
- **Self-hosted Langfuse** — needs Postgres + ClickHouse; violates the low-infra constraint. Local JSONL instead.
- **Strict TDD** — would fight Terraform and varied-maturity repos. Evidence-gating fixes the actual failure (false claims of success); TDD does not.
- **Browser automation built into the harness** — the user already uses Playwright CLI; a skill driving their existing flow is cheaper and better.
- **Porting GSD wholesale** — ~60 skills built on Claude Code's `Agent` / `TodoWrite` / `AskUserQuestion` / `ExitPlanMode` and `.claude/agents`. The skill *files* would load (Pi implements the Agent Skills standard and is more lenient than Anthropic's), but their tool calls fail. Building four native workflows instead.

## Context

**Where the user is coming from.** Heavy daily Claude Code user, driving it with `--dangerously-skip-permissions` because Anthropic earned that trust over many sessions. Uses the GSD skill suite for almost everything. Tried DeepSeek under the Claude Code harness via Alibaba Cloud and got poor results; diagnosed it as bad harness/model pairing. Specific complaint: *"DeepSeek doesn't think enough and misses a lot of bugs that Opus or Sonnet would have caught."*

**That diagnosis is unproven and may be a configuration bug.** Adversarial research found: Pi's Bedrock adapter returns `undefined` for thinking configuration on non-Anthropic models — extended thinking is only *requested* for Claude on Bedrock. DeepSeek's API documents `reasoning_effort` nested inside a `thinking` object while Pi sends it top-level, and Pi's DeepSeek `thinkingLevelMap` never emits `low`. Qwen on DashScope requires `compat.thinkingFormat: "qwen"` to enable thinking at all. `deepseek-chat` and `deepseek-reasoner` were retired 2026-07-24; current models are `deepseek-v4-flash` / `deepseek-v4-pro`, where thinking is a request parameter rather than a model choice. There is also a documented DeepSeek agentic failure mode — emitting tool calls as prose in `content` instead of `tool_calls` roughly 11% of the time — that thinking budgets do not address. **Per-role thinking budgets must not be built until the wire inspector proves the parameters reach the provider.**

**A second plausible cause of the same symptom: context pollution.** Pi's base system prompt is ~400 tokens. Every extension that registers a tool or prompt snippet adds to it on *every turn*. With Opus this is invisible; with DeepSeek Flash a bloated system prompt is a credible cause of "doesn't think enough, misses things." Hence progressive disclosure as an architectural principle rather than a nicety.

**Pi's actual shape.** Seven built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) — not four, as widely repeated; the four are an internal default in `system-prompt.ts`. Pi's docs state verbatim that it "intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash." There is **no sandbox and no permission system** — Pi's default is effectively permanent bypass mode. The `tool_call` hook can block, but it is a string matcher over commands, trivially defeated (`g=push; git $g`, `sh -c`, heredocs). It is a mistake-catcher, not a security boundary. Pi ships a release every 2–3 days; the package registry holds 5,562 packages.

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
| UI layer sequenced last | Genuinely wanted and motivating, but must not block a working daily driver | — Pending |
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
*Last updated: 2026-08-12 after initialization*
