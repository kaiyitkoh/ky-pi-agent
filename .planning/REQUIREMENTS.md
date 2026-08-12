# Requirements: ky-pi-agent

**Defined:** 2026-08-13
**Core Value:** A harness that makes a cheap model produce work you'd trust from an expensive one — without the harness itself becoming the bottleneck.

**Scope decision:** everything in v1. Phase count expanded (granularity: fine) rather than scope cut.

**Verification split.** Requirements marked **[FAUX]** are fully testable on the development machine using `fauxProvider()` from `@earendil-works/pi-ai` (scripted mock provider, no keys, no network). Requirements marked **[RUNBOOK]** require live credentials and are verified by the user on the work laptop against a documented procedure. A requirement is not Complete until its designated verification has actually run.

---

## v1 Requirements

### Bootstrap & Supply Chain

- [ ] **BOOT-01**: `~/.npmrc` sets `ignore-scripts=true` before any `pi install` runs, verified by an assertion in the bootstrap script — `pi install` executes npm lifecycle scripts with no `--ignore-scripts` on any code path
- [ ] **BOOT-02**: User can install the harness on a clean machine with `pi install https://github.com/kaiyitkoh/ky-pi-agent`
- [ ] **BOOT-03**: User can bootstrap a cold machine with `bin/bootstrap.sh` — installs Pi, verifies `bash`/`git`/`aws`/`glab`/`gh` presence, writes the env-var template, makes idempotent marked-region edits
- [ ] **BOOT-04**: Bootstrap fails loudly with an actionable message if the pinned Pi version has been unpublished from npm (versions below 0.74.0 are already gone)
- [ ] **BOOT-05**: `cd ky-pi-agent && pi` loads the harness from `.pi/` so the repo dogfoods itself, with `/reload` working
- [ ] **BOOT-06**: All shell code is POSIX `sh` and all shipped scripts check out LF on both platforms
- [ ] **BOOT-07**: CI runs the full test suite on `windows-latest` and `macos-latest`, giving real macOS verification without a Mac
- [ ] **BOOT-08**: Every third-party dependency is pinned to an exact version, with a committed lockfile
- [ ] **BOOT-09**: No credential can be committed — `.gitignore` covers every runtime state and secret path, verified by a test
- [ ] **BOOT-10**: `CONTRIBUTING.md` states the boundary rule: a new capability defaults to command or skill; registering a tool requires justifying its per-request schema cost

### Diagnostics

- [ ] **DIAG-01**: Every provider request and response is captured via `before_provider_request` / `after_provider_response` / `before_provider_headers`, showing the exact JSON on the wire **[FAUX]** + **[RUNBOOK]**
- [ ] **DIAG-02**: All model invocations route through a single exported `callModel()` chokepoint — provider hooks wire only into the main agent's `streamFn`, so a direct `modelRegistry.complete()` is invisible to the inspector **[FAUX]**
- [ ] **DIAG-03**: A lint or test fails the build if `modelRegistry.complete` is called outside `diagnostics/` **[FAUX]**
- [ ] **DIAG-04**: Every turn appends a JSONL record — model, provider, tokens, cost, latency, cache-read ratio, outcome (no reasoning-token column for Bedrock; it reports none) **[FAUX]**
- [ ] **DIAG-05**: A detector identifies prose tool calls — `finish_reason:"stop"` with `tool_calls:null` and a function name in `content` — logs `event: prose_tool_call`, and retries rather than treating the turn as complete **[FAUX]** + **[RUNBOOK]**
- [ ] **DIAG-06**: `/budget` reports system-prompt tokens, tool-schema tokens, context-file tokens, skills-index tokens, and `cacheRead` vs `input` **[FAUX]**
- [ ] **DIAG-07**: Captured payloads are redacted at capture time and written only to gitignored paths — a wire inspector is by construction a credential-logging tool feeding a public repo **[FAUX]**
- [ ] **DIAG-08**: Diagnostic logs rotate rather than growing unbounded **[FAUX]**

### Providers & Credentials

- [ ] **PROV-01**: `models.json` and `auth.json` ship as structurally complete templates with zero secrets, resolved at runtime via `$ENV_VAR` and `!command`
- [ ] **PROV-02**: `!command` interpolation appears only in `auth.json` (cached per process), never in `models.json` (re-executed on every provider request)
- [ ] **PROV-03**: DashScope is configured as a custom provider with an **explicit** full `compat` block — Pi's `detectCompat` has no `aliyuncs.com` branch, so defaults silently disable thinking and 400 on the second turn of any tool sequence **[RUNBOOK]**
- [ ] **PROV-04**: Bedrock authenticates via `credential.env.AWS_PROFILE` in `auth.json`, which Pi checks before process env — survives a fresh shell, contains no secret, templatable in-repo **[RUNBOOK]**
- [ ] **PROV-05**: Expired SSO credentials produce an actionable message naming the exact `aws sso login --profile <name>` command, and are classified **non-retryable** so they don't burn wall-clock in a retry loop **[FAUX]**
- [ ] **PROV-06**: Every model carries accurate capability metadata — `input[]`, per-provider true `contextWindow`, `cost` — and never inherits a context window from a different provider's entry for the same model
- [ ] **PROV-07**: The R1 experiment is run and recorded: does `api.deepseek.com` accept `reasoning_effort: "low"`, and does it produce materially fewer reasoning tokens than `"high"` **[RUNBOOK]**
- [ ] **PROV-08**: A DeepSeek-direct → DashScope fallback chain handles quota, transient, and unavailable errors **[FAUX]**
- [ ] **PROV-09**: A first-run runbook documents every credential-dependent verification the user performs on the work laptop, with expected output for each
- [ ] **PROV-10**: A two-turn tool-calling sequence against DashScope returns 200 — the first turn always works, so the second is the test **[RUNBOOK]**

### Safety

- [ ] **SAFE-01**: GitLab server-side protected branches and approval rules are configured and verified by attempting a push that must fail — the only control that is not theatre **[RUNBOOK]**
- [ ] **SAFE-02**: Bash commands are parsed to an AST with `unbash`, resolving wrappers (`sudo`, `env`, `sh -c`, `xargs`) so `g=push; git $g` and `bash -lc "..."` are caught **[FAUX]**
- [ ] **SAFE-03**: Anything unparseable — command substitution, backticks, heredocs, backgrounding — **fails closed** **[FAUX]**
- [ ] **SAFE-04**: Writes are blocked when `HEAD == main`, while read-only operations against main (`fetch`, `rebase`, `diff`, `log`, `worktree add -b feat main`) remain allowed **[FAUX]**
- [ ] **SAFE-05**: `glab mr merge` is blocked — in the user's work repo, the MR merge is the deploy trigger **[FAUX]**
- [ ] **SAFE-06**: Reads of `.env`, `~/.aws/credentials`, kubeconfig, and `*.tfstate` are blocked — tfstate holds plaintext secrets that would enter model context **[FAUX]**
- [ ] **SAFE-07**: `terraform apply|destroy|import`, mutating `aws` CLI calls, and `kubectl delete` require explicit confirmation **[FAUX]**
- [ ] **SAFE-08**: File writes and deletes outside the project directory are blocked **[FAUX]**
- [ ] **SAFE-09**: Enforcement happens **twice** — at the `tool_call` hook and inside a wrapped `bash` tool — because later hooks can mutate `event.input` after approval and Pi performs no re-validation **[FAUX]**
- [ ] **SAFE-10**: Confirmation uses block → approval-tool → re-issue, not an inline `confirm()`, and is **deny-by-default**; a CI test asserts the deny under `--mode json` where `noOpUIContext.confirm` returns `false` **[FAUX]**
- [ ] **SAFE-11**: Safety extensions install at **user scope** — project-scoped extensions don't load in subagents, which spawn headless and therefore never grant trust **[FAUX]**
- [ ] **SAFE-12**: The blocked-command test passes **inside a spawned subagent**, not only in the interactive session **[FAUX]**
- [ ] **SAFE-13**: The non-bash surface is guarded — `.git/hooks/*`, `.git/config`, `~/.bashrc`, `~/.gitconfig`, CI workflow files **[FAUX]**
- [ ] **SAFE-14**: Every allow and every block is written to an audit JSONL **[FAUX]**
- [ ] **SAFE-15**: A documented table lists known bypasses the guard does not catch — an honest limits statement, not a claim of completeness
- [ ] **SAFE-16**: `gh` is left unauthenticated on the work laptop and this is stated in the runbook — `/share` cannot be blocked by any extension, and aborting on `gh auth status` is the only control
- [ ] **SAFE-17**: At least 30 evasion attempts are tested, each either blocked or explicitly documented as out of scope **[FAUX]**

### Routing

- [ ] **ROUTE-01**: An explicit role→model map covers executor, planner, reviewer, advisor, vision, and summariser — no auto-classification
- [ ] **ROUTE-02**: `/cheap`, `/balanced`, `/max` swap the whole role→model map via `pi.setModel()` from a command after `await ctx.waitForIdle()`, which removes the race **[FAUX]**
- [ ] **ROUTE-03**: `/escalate` pulls a stronger model for one invocation, and the elevated state is visible and sticky until cleared **[FAUX]**
- [ ] **ROUTE-04**: Single-shot roles (review, advisor, vision, summarise) run through `callModel()` → `ctx.modelRegistry.complete()` with per-call reasoning effort, not by mutating session state **[FAUX]**
- [ ] **ROUTE-05**: Roles needing a tool loop run as subagents **[FAUX]**
- [ ] **ROUTE-06**: Capability guards hard-block impossible routes: image → text-only model; oversized context → small-window model **[FAUX]**
- [ ] **ROUTE-07**: A capability guard hard-blocks Bedrock non-Claude models with thinking enabled — `buildAdditionalModelRequestFields` silently drops it while the UI still offers the setting **[FAUX]**
- [ ] **ROUTE-08**: A capability guard hard-blocks Bedrock DeepSeek R1 as an executor — it supports no tool calling at all **[FAUX]**
- [ ] **ROUTE-09**: Mode selection persists across restarts via `pi.appendEntry`, costing zero context tokens **[FAUX]**
- [ ] **ROUTE-10**: Every mode switch produces a wire dump proving the intended model was actually used **[FAUX]**
- [ ] **ROUTE-11**: Qoder is available as a delegate tool that hands off a whole task and folds the result back — explicitly a foreign agent that bypasses the harness's tools, safety hooks, and wire inspector, and documented as such **[RUNBOOK]**

### Composed Extensions

- [ ] **EXT-01**: Subagents support per-agent model, system prompt, tool restriction, and thinking level
- [ ] **EXT-02**: Parallel subagents run in isolated git worktrees, verified to **build**, not merely check out — untracked files like `.env` and `node_modules` do not travel to a new worktree
- [ ] **EXT-03**: Subagents can run in the background without blocking the session
- [ ] **EXT-04**: A running subagent can be steered mid-run without killing it
- [ ] **EXT-05**: Plan mode, todo tracking, background bash, LSP diagnostics, structured user questions, web lookup, session search, and loop detection are available
- [ ] **EXT-06**: Pi's own bundled examples are preferred over third-party packages wherever they cover the need
- [ ] **EXT-07**: File checkpointing restores the working tree, with Pi's bundled `git-checkpoint.ts` as the fallback if no third-party option proves sound
- [ ] **EXT-08**: Every pin is re-verified at planning time rather than inherited from research — the ecosystem ships 13–16 releases/month
- [ ] **EXT-09**: A documented smoke-test ritual runs on every version bump: one turn per provider, one subagent spawn, one blocked command, one wire dump
- [ ] **EXT-10**: Any extension without a license file is vendored rather than depended on

### Quality Gates

- [ ] **GATE-01**: Deterministic gates — typecheck, lint, LSP diagnostics — run and feed errors back **before** any model review **[FAUX]**
- [ ] **GATE-02**: A fresh-context reviewer subagent receives the full contract: diff, every touched file in full, test and typecheck output, SPEC requirements, files-touched union, and the import graph **[FAUX]**
- [ ] **GATE-03**: Review output gives a per-requirement verdict (Implemented / Partial / Missing) with file:line evidence **[FAUX]**
- [ ] **GATE-04**: Review output includes a mandatory "checked and cleared" section, so silence is structurally impossible **[FAUX]**
- [ ] **GATE-05**: Findings are classified BLOCKER / WARNING / NIT, and unclassified findings are rejected as malformed **[FAUX]**
- [ ] **GATE-06**: BLOCKERs go through a refute-or-promote pass before they can stop work — reviewers told to find gaps invent them **[FAUX]**
- [ ] **GATE-07**: Task completion is gated on `tool_result` exit codes bound to a git SHA, never on transcript text — a model that writes prose tool calls can also write plausible command output **[FAUX]**
- [ ] **GATE-08**: Seeded-defect calibration measures what the reviewer actually catches, distinguishing "the code is clean" from "the reviewer is asleep" **[FAUX]**
- [ ] **GATE-09**: Advisor escalation lets the executor consult a stronger model at a decision point via `callModel()` **[FAUX]**
- [ ] **GATE-10**: Per-role thinking budgets apply on the nested path (reviewer, advisor, summariser); main-loop budgets apply only if the wire inspector proved the parameters land **[FAUX]** + **[RUNBOOK]**

### Engineering Quality

The harness must produce root-cause fixes that scale, not symptom patches. Exhortation in `AGENTS.md` is explicitly **not** the mechanism — agents ignore comprehensive instructions, so this is enforced structurally. Gate depth scales with the work so the quality layer never becomes the bottleneck.

- [ ] **QUAL-01**: Deterministic anti-pattern rules (ast-grep + lint) detect magic numbers where a constant belongs, special-casing on a literal input value, copy-paste duplication, swallowed exceptions, `TODO`/`FIXME` shipped as a fix, and N+1 query shapes **[FAUX]**
- [ ] **QUAL-02**: Those rules run inside the existing deterministic gate stage, adding no model round trip and no measurable wall-clock **[FAUX]**
- [ ] **QUAL-03**: For any change framed as a fix, SPEC.md carries a **Root Cause** section naming the cause with `file:line` evidence and stating why the change addresses the cause rather than the symptom — gated the same way as Verified Codebase Facts **[FAUX]**
- [ ] **QUAL-04**: The reviewer classifies every change as **root-cause / symptomatic / workaround** with written justification, as extra structure on the review pass already being paid for — not an extra call **[FAUX]**
- [ ] **QUAL-05**: Any change classified symptomatic or workaround stops the workflow and requires the user's explicit approval before it can ship **[FAUX]**
- [ ] **QUAL-06**: An approved workaround is recorded in the MR body with what the proper fix would be and why it was deferred, so the debt is visible rather than silent **[FAUX]**
- [ ] **QUAL-07**: A design-level review pass covering algorithmic complexity, scalability, and abstraction fit fires **conditionally** — on signals (diff spans many files, a loop wraps a query, a data model or public interface changes) or on explicit `/escalate` — never on every task **[FAUX]**
- [ ] **QUAL-08**: Gate depth scales with the workflow: `/quick` runs deterministic rules only; the full workflow runs all four mechanisms **[FAUX]**
- [ ] **QUAL-09**: The wall-clock and token cost added by the quality layer is recorded per turn in the JSONL, so the correctness/latency balance is a measured number and can be tuned rather than guessed **[FAUX]**

### Workflows

- [ ] **FLOW-01**: `/quick` executes trivial work with no ceremony, in **≤80 lines**, enforced by a CI line-budget test
- [ ] **FLOW-02**: `/grill` interrogates until the spec is unambiguous, using an ambiguity scorecard with per-dimension floors, a hard question budget, one question at a time, and rotating interview perspectives
- [ ] **FLOW-03**: `/grill` produces SPEC.md containing a **Verified Codebase Facts** table — `claim | evidence (file:line or command output) | how verified` — and refuses to write requirements until it exists
- [ ] **FLOW-04**: SPEC.md states error behaviour as `IF <condition> THEN THE SYSTEM SHALL <response>`, which cannot be filled in without naming a failure
- [ ] **FLOW-05**: SPEC.md pins scope as an expected-files list, machine-checkable against the diff at review time
- [ ] **FLOW-06**: `/plan` produces PLAN.md with tasks in the form `T### [P] [R#] verb <explicit path> + verification command`, plus a requirement-coverage matrix
- [ ] **FLOW-07**: `/execute` appends to PROGRESS.md with pasted real command output, and commits atomically
- [ ] **FLOW-08**: `/review` produces REVIEW.md and opens an MR targeting **staging, never main**
- [ ] **FLOW-09**: Subagents receive self-contained handoff packets, so delegation costs negative tokens in the parent
- [ ] **FLOW-10**: The total artifact set is SPEC, PLAN, REVIEW plus a PROGRESS append — no document that no downstream consumer reads
- [ ] **FLOW-11**: Every workflow has a CI-enforced line budget

### Context Budget

- [ ] **CTX-01**: Named tool profiles (recon / implement / review / full) are set once at `session_start` and only added to — tool *removal* invalidates the prompt cache **[FAUX]**
- [ ] **CTX-02**: `pi.setActiveTools()` is the mechanism; the `context` hook cannot strip tool definitions and is not used for this **[FAUX]**
- [ ] **CTX-03**: `AGENTS.md` has a hard token budget enforced in CI
- [ ] **CTX-04**: No volatile content — timestamps, running cost, git branch, changed files — appears in the system prompt; DeepSeek cache reads are ~50× cheaper than fresh input, so one volatile token re-prices the whole prefix every turn **[FAUX]**
- [ ] **CTX-05**: A controlled minimal-vs-full-harness experiment measures whether context pollution actually degrades output quality **[RUNBOOK]**
- [ ] **CTX-06**: Per-extension per-turn token cost is measured and recorded, so every installed extension can be justified

### Terminal UI

- [ ] **UI-01**: A custom theme ships, conforming to Pi's theme schema
- [ ] **UI-02**: A statusline shows model, provider, context remaining, session cost, git branch, and changed files — rendered in TUI chrome, never in the system prompt
- [ ] **UI-03**: A custom startup header ships
- [ ] **UI-04**: A live widget shows running subagents and their status
- [ ] **UI-05**: No UI element introduces a system-prompt cache invalidation, verified by watching `cacheRead` stay non-trivial

---

## v2 Requirements

Deferred. Tracked but not in the current roadmap.

### Foreign Agents
- **QODR-01**: Richer Qoder Cloud Agents integration beyond single-task delegation
- **CCB-01**: Claude Code bridge as an escalation target, contingent on verifying `pi-claude-bridge` works against a Bedrock-backed Claude Code rather than a Pro/Max subscription

### Evaluation
- **EVAL-01**: A frozen task set drawn from real repos, scored via Pi's SDK and `--mode json`
- **EVAL-02**: Model-vs-model comparison on that task set, turning role assignment from taste into measurement

### Workflow
- **SDD-01**: OpenSpec-style ADDED / MODIFIED / REMOVED delta specs
- **PLAY-01**: Playwright localhost verification as an evidence-gated skill
- **LIB-01**: Library-version and misused-API pinning in `AGENTS.md`

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| MCP | Not part of the user's workflow. Compensated by a mandatory web extension, since Pi has no web tool. |
| Auto-learned / semantic memory | Stale facts fail invisibly. `AGENTS.md` fails visibly in a diff. |
| Qoder as a routable model | No inference endpoint exists — verified at `docs.qoder.com/llms.txt`. Not technically possible. |
| Qoder via unofficial proxy | The published Pi packages contain WAF-bypass encoding and RSA/AES signature forging. Breaches Qoder ToS §3.2.6/§3.2.9/§3.2.10; §15.2 makes termination irreversible. |
| Virtual provider for routing | Its unique benefit is automatic per-turn routing, explicitly rejected. Costs the `/model` picker and cost accounting. |
| Forking a subagent extension | ~15 upstream releases/month makes a fork permanent unpaid maintenance. |
| Auto-classifying model router | An auto-router that is wrong gives a bad result with no obvious cause — the exact debugging problem the user already had. |
| Hosted observability SaaS | Violates zero-spend. Braintrust self-hosting is Enterprise-only. |
| Self-hosted Langfuse | Needs Postgres + ClickHouse. Violates the low-infra constraint. Local JSONL instead. |
| Strict TDD | Fights Terraform and varied-maturity repos. Evidence-gating fixes the actual failure. |
| Browser automation in the harness | The user already has a Playwright CLI flow; a skill wrapping it is cheaper. |
| Porting GSD wholesale | ~60 skills at ~40–60 tokens of index each is ~3,000 tokens/turn of pure index, and they depend on Claude Code tools Pi lacks. |
| Multi-file spec bundles | Artifact volume does not buy adherence — Fowler's team found agents ignored comprehensive specs anyway. |
| Persistent canonical spec corpus | Same invisible-rot failure already rejected for auto-memory. |
| Spec-as-source / regenerable code | Closed beta, JS-only, non-deterministic. |
| Full EARS grammar | Documented as a sledgehammer. Only `IF/THEN THE SYSTEM SHALL` is adopted. |
| Approval gate between every phase | Approval fatigue is permission-prompt fatigue by another name. |
| `--auto` self-answering clarification | Structurally defeats a grilling workflow — converts "user doesn't know what they want" into "the model guessed and nobody noticed". |
| Mode-flag matrices with precedence rules | A documented precedence order between flags is itself the smell. |
| Exhortation as the quality mechanism | "Write robust, long-term, scalable code" in `AGENTS.md` is the weakest possible lever — Fowler's team documented agents ignoring comprehensive specs. `AGENTS.md` may carry the standard as context, but QUAL-01…09 are the enforcement. |
| Design-level review on every task | Would make the harness the bottleneck it exists to remove. Fires on signals or `/escalate` only. |
| A build step | Pi loads `.ts` through jiti. A build breaks `/reload` for zero gain. |
| `@sinclair/typebox` | Legacy scoped fork; produces schemas Pi cannot validate. Use unscoped `typebox`. |
| `@gotgenes/pi-subagents-worktrees` | Bridges a third subagents package and silently no-ops otherwise. Both candidate packages have worktrees natively. |
| Installing `@ramtinj95/pi-infra-command-guard` | Hard peer-depends on a package dragging in `openai`, `web-tree-sitter`, `tree-sitter-bash`, `ws`. Read its `unbash` approach; write our own. |

---

## Traceability

Populated during roadmap creation. Full phase definitions in `.planning/ROADMAP.md`.

| Phase | Name |
|-------|------|
| 1 | Bootstrap, Packaging & Supply Chain |
| 2 | Diagnostics — The Instrument |
| 3 | Providers & Credentials |
| 4 | Safety & Deployment Guardrails |
| 5 | Routing & Capability Guards |
| 6 | Walking Skeleton — `/quick` & the Evidence Gate |
| 7 | Composed Extensions, Pinned & Reviewed |
| 8 | Quality Gates & Engineering Quality |
| 9 | Ceremonial Workflows |
| 10 | Context Budget & Progressive Disclosure |
| 11 | Terminal UI |

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOOT-01 | Phase 1 | Pending |
| BOOT-02 | Phase 1 | Pending |
| BOOT-03 | Phase 1 | Pending |
| BOOT-04 | Phase 1 | Pending |
| BOOT-05 | Phase 1 | Pending |
| BOOT-06 | Phase 1 | Pending |
| BOOT-07 | Phase 1 | Pending |
| BOOT-08 | Phase 1 | Pending |
| BOOT-09 | Phase 1 | Pending |
| BOOT-10 | Phase 1 | Pending |
| DIAG-01 | Phase 2 | Pending |
| DIAG-02 | Phase 2 | Pending |
| DIAG-03 | Phase 2 | Pending |
| DIAG-04 | Phase 2 | Pending |
| DIAG-05 | Phase 2 | Pending |
| DIAG-06 | Phase 2 | Pending |
| DIAG-07 | Phase 2 | Pending |
| DIAG-08 | Phase 2 | Pending |
| PROV-01 | Phase 3 | Pending |
| PROV-02 | Phase 3 | Pending |
| PROV-03 | Phase 3 | Pending |
| PROV-04 | Phase 3 | Pending |
| PROV-05 | Phase 3 | Pending |
| PROV-06 | Phase 3 | Pending |
| PROV-07 | Phase 3 | Pending |
| PROV-08 | Phase 3 | Pending |
| PROV-09 | Phase 3 | Pending |
| PROV-10 | Phase 3 | Pending |
| SAFE-01 | Phase 4 | Pending |
| SAFE-02 | Phase 4 | Pending |
| SAFE-03 | Phase 4 | Pending |
| SAFE-04 | Phase 4 | Pending |
| SAFE-05 | Phase 4 | Pending |
| SAFE-06 | Phase 4 | Pending |
| SAFE-07 | Phase 4 | Pending |
| SAFE-08 | Phase 4 | Pending |
| SAFE-09 | Phase 4 | Pending |
| SAFE-10 | Phase 4 | Pending |
| SAFE-11 | Phase 4 | Pending |
| SAFE-12 | Phase 4 | Pending |
| SAFE-13 | Phase 4 | Pending |
| SAFE-14 | Phase 4 | Pending |
| SAFE-15 | Phase 4 | Pending |
| SAFE-16 | Phase 1 | Pending |
| SAFE-17 | Phase 4 | Pending |
| ROUTE-01 | Phase 5 | Pending |
| ROUTE-02 | Phase 5 | Pending |
| ROUTE-03 | Phase 5 | Pending |
| ROUTE-04 | Phase 5 | Pending |
| ROUTE-05 | Phase 5 | Pending |
| ROUTE-06 | Phase 5 | Pending |
| ROUTE-07 | Phase 5 | Pending |
| ROUTE-08 | Phase 5 | Pending |
| ROUTE-09 | Phase 5 | Pending |
| ROUTE-10 | Phase 5 | Pending |
| ROUTE-11 | Phase 5 | Pending |
| EXT-01 | Phase 7 | Pending |
| EXT-02 | Phase 7 | Pending |
| EXT-03 | Phase 7 | Pending |
| EXT-04 | Phase 7 | Pending |
| EXT-05 | Phase 7 | Pending |
| EXT-06 | Phase 7 | Pending |
| EXT-07 | Phase 7 | Pending |
| EXT-08 | Phase 7 | Pending |
| EXT-09 | Phase 7 | Pending |
| EXT-10 | Phase 7 | Pending |
| GATE-01 | Phase 8 | Pending |
| GATE-02 | Phase 8 | Pending |
| GATE-03 | Phase 8 | Pending |
| GATE-04 | Phase 8 | Pending |
| GATE-05 | Phase 8 | Pending |
| GATE-06 | Phase 8 | Pending |
| GATE-07 | Phase 6 | Pending |
| GATE-08 | Phase 8 | Pending |
| GATE-09 | Phase 8 | Pending |
| GATE-10 | Phase 8 | Pending |
| QUAL-01 | Phase 8 | Pending |
| QUAL-02 | Phase 8 | Pending |
| QUAL-03 | Phase 9 | Pending |
| QUAL-04 | Phase 8 | Pending |
| QUAL-05 | Phase 8 | Pending |
| QUAL-06 | Phase 8 | Pending |
| QUAL-07 | Phase 8 | Pending |
| QUAL-08 | Phase 9 | Pending |
| QUAL-09 | Phase 8 | Pending |
| FLOW-01 | Phase 6 | Pending |
| FLOW-02 | Phase 9 | Pending |
| FLOW-03 | Phase 9 | Pending |
| FLOW-04 | Phase 9 | Pending |
| FLOW-05 | Phase 9 | Pending |
| FLOW-06 | Phase 9 | Pending |
| FLOW-07 | Phase 9 | Pending |
| FLOW-08 | Phase 9 | Pending |
| FLOW-09 | Phase 9 | Pending |
| FLOW-10 | Phase 9 | Pending |
| FLOW-11 | Phase 6 | Pending |
| CTX-01 | Phase 10 | Pending |
| CTX-02 | Phase 10 | Pending |
| CTX-03 | Phase 10 | Pending |
| CTX-04 | Phase 10 | Pending |
| CTX-05 | Phase 10 | Pending |
| CTX-06 | Phase 10 | Pending |
| UI-01 | Phase 11 | Pending |
| UI-02 | Phase 11 | Pending |
| UI-03 | Phase 11 | Pending |
| UI-04 | Phase 11 | Pending |
| UI-05 | Phase 11 | Pending |

**Coverage:**
- v1 requirements: **107 total** — corrected from 105. The earlier count predated the QUAL-01…09 Engineering Quality group. Counted by category: BOOT 10 · DIAG 8 · PROV 10 · SAFE 17 · ROUTE 11 · EXT 10 · GATE 10 · QUAL 9 · FLOW 11 · CTX 6 · UI 5.
- Mapped to phases: **107**
- Unmapped: **0** ✓
- Duplicates: **0** ✓ — every requirement maps to exactly one phase

**Per-phase counts:** P1: 11 · P2: 8 · P3: 10 · P4: 16 · P5: 11 · P6: 3 · P7: 10 · P8: 16 · P9: 11 · P10: 6 · P11: 5 = 107

**Placement notes where a requirement crosses a category boundary:**

| Requirement | Placed in | Why not the obvious phase |
|-------------|-----------|---------------------------|
| SAFE-16 (`gh` unauthenticated) | Phase 1 | `/share` cannot be blocked by any extension — built-in commands are matched before extension commands. The only control is machine state, set at bootstrap, and it must hold from session one. The runbook sentence is appended in Phase 3. |
| GATE-07 (evidence gate on exit codes) | Phase 6 | It is the "evidence" leg of the walking skeleton's route → guard → execute → evidence → commit path, and it interacts with the Phase 2 prose-tool-call detector to fabricate evidence if built late. |
| FLOW-11 (CI line budgets) | Phase 6 | The budget must constrain the ceremonial workflows *before* they are written. GSD's 1,169-line "quick" is the counterexample. |
| QUAL-01, QUAL-02 (anti-pattern rules) | Phase 8 | They run inside the existing deterministic gate stage — same stage, no extra model round trip. |
| QUAL-03 (Root Cause section) | Phase 9 | It is a SPEC.md section gated the same way as Verified Codebase Facts, so it belongs with the spec workflow. |
| QUAL-04…07 (classification, approval, debt record, design pass) | Phase 8 | Extra structure on the review pass already being paid for, not an extra call. |
| QUAL-08 (gate depth scales) | Phase 9 | The `/quick`-vs-full split is a workflow property; it can only be expressed once both workflows exist. |
| QUAL-09 (quality-layer cost per turn) | Phase 8 | It extends the Phase 2 JSONL schema, but the number is unfillable until the quality layer exists. |

**[RUNBOOK] distribution (8 of 107):** Phase 2 — DIAG-01, DIAG-05 · Phase 3 — PROV-03, PROV-04, PROV-07, PROV-10 · Phase 4 — SAFE-01 · Phase 5 — ROUTE-11 · Phase 8 — GATE-10 (main-loop half) · Phase 10 — CTX-05.

*Note: GATE-10 and DIAG-01/05 carry both [FAUX] and [RUNBOOK] tags — the offline half is verifiable on the dev machine, the live half is not.*

---
*Requirements defined: 2026-08-13*
*Last updated: 2026-08-13 — traceability populated from ROADMAP.md; total corrected 105 → 107*
