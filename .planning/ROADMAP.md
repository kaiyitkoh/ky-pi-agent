# Roadmap: ky-pi-agent

## Overview

The project builds a harness that makes a cheap model produce work you'd trust from an expensive one. The research forced the shape of this roadmap: it is **horizontal layers in dependency order**, because the dependency graph is real rather than stylistic. `callModel()` is an export of the diagnostics layer that both routing and the quality gates import, and you cannot verify a routing decision without the instrument that proves which model actually ran.

So the journey is: harden the machine before any third-party code executes on it (Phase 1) → build the instrument that makes every later claim checkable (Phase 2) → stand up the providers the instrument will measure (Phase 3) → put the real deployment guardrails in place, which have no dependency on routing and every reason to exist from session one (Phase 4) → route explicitly, with hard capability blocks (Phase 5) → prove the whole plumbing path end-to-end at minimum size with a skeletal `/quick` before anything ceremonial is built on it (Phase 6) → compose the commodity extensions on pinned versions (Phase 7) → stack the quality levers, deterministic first (Phase 8) → build the ceremonial workflows the `/quick` skeleton has already validated (Phase 9) → tune the per-turn token budget once the tools that consume it exist (Phase 10) → and only then the UI, which is constrained by a 50× prompt-cache penalty on volatile system-prompt tokens (Phase 11).

Two things about this roadmap are unusual and deliberate. First, **eight of 107 requirements cannot be verified on the development machine at all** — they need live credentials the dev laptop does not have. Those phases make the runbook itself a deliverable and their success criteria distinguish "built and unit-verified with `fauxProvider`" from "verified live on the work laptop". Second, **the root-cause question is still open.** Three candidates survive the research with different evidence quality — prose tool calls, context pollution, and provider misconfiguration. Phase 2 and Phase 10 discriminate between them. The roadmap deliberately does not commit to a fix for a cause that has not been measured.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Bootstrap, Packaging & Supply Chain** - Harden the machine and establish the repo shape before the first `pi install` executes third-party code
- [ ] **Phase 2: Diagnostics — The Instrument** - Wire inspector, the `callModel()` chokepoint, per-turn JSONL, and the prose-tool-call detector
- [ ] **Phase 3: Providers & Credentials** - Structurally complete providers with zero secrets, verified by Phase 2's instrument and a first-run runbook
- [ ] **Phase 4: Safety & Deployment Guardrails** - Server-side branch protection first, then an AST bash guard that fails closed and holds inside subagents
- [ ] **Phase 5: Routing & Capability Guards** - Explicit role→model map, session modes, and hard blocks on impossible routes
- [ ] **Phase 6: Walking Skeleton — `/quick` & the Evidence Gate** - Prove route → guard → execute → evidence → commit end-to-end at minimum size
- [ ] **Phase 7: Composed Extensions, Pinned & Reviewed** - Subagents, plan mode, todos, LSP, web, checkpointing — exact-pinned and re-verified
- [ ] **Phase 8: Quality Gates & Engineering Quality** - Deterministic gates first, then a reviewer that cannot rubber-stamp, calibrated against seeded defects
- [ ] **Phase 9: Ceremonial Workflows** - `/grill` → `/plan` → `/execute` → `/review`, evidence-bearing artifacts, MR to staging never `main`
- [ ] **Phase 10: Context Budget & Progressive Disclosure** - Measure the per-turn floor, cut it, and settle whether context pollution is actually a cause
- [ ] **Phase 11: Terminal UI** - Theme, statusline, header, and subagent widget — all volatile content in TUI chrome, never the system prompt

## Phase Details

### Phase 1: Bootstrap, Packaging & Supply Chain
**Goal**: A cold machine can be brought to a state where installing and running the harness does not execute unreviewed third-party code with full permissions, and the repo shape every later phase writes into exists and loads both ways.
**Depends on**: Nothing (first phase)
**Requirements**: BOOT-01, BOOT-02, BOOT-03, BOOT-04, BOOT-05, BOOT-06, BOOT-07, BOOT-08, BOOT-09, BOOT-10, SAFE-16
**Success Criteria** (what must be TRUE):
  1. A **project-scoped** `.npmrc` sets `ignore-scripts=true`, and the bootstrap script asserts it holds *before* it runs its first `pi install` — a pinning policy applied afterwards is applied to code that already ran. Scoped rather than global by explicit decision: global would break legitimate native builds machine-wide. README and the runbook state the residual gap (a `pi install` from another directory is unprotected) and the setup step for macOS or any second machine.
  2. `pi install https://github.com/kaiyitkoh/ky-pi-agent` on a clean profile loads a hello-world extension, and `cd ky-pi-agent && pi` loads the same extension from `.pi/` with `/reload` working.
  3. CI is green on `windows-latest` and `macos-latest`: every shipped script is POSIX `sh`, checks out with LF on both platforms, and actually executes rather than merely building.
  4. Bootstrap against an unpublished pinned Pi version stops with a message naming the version and the fallback, instead of failing obscurely — versions below 0.74.0 are already gone from npm.
  5. A test proves no credential or runtime-state path is committable, `gh` is left unauthenticated (the only real control over `/share`), and `CONTRIBUTING.md` states the boundary rule: a new capability defaults to command or skill; registering a tool requires justifying its per-request schema cost.
**Plans**: TBD
**Research**: Not needed — packaging, manifest, install surfaces and Windows shell resolution are fully specified at source.

### Phase 2: Diagnostics — The Instrument
**Goal**: Every claim the rest of the project makes about which model ran, what parameters reached it, and what it cost becomes checkable rather than assumed.
**Depends on**: Phase 1
**Requirements**: DIAG-01, DIAG-02, DIAG-03, DIAG-04, DIAG-05, DIAG-06, DIAG-07, DIAG-08
**Success Criteria** (what must be TRUE):
  1. For any model invocation the user can read the exact JSON that went on the wire, with credentials redacted **at capture time** and dumps written only to gitignored paths — a wire inspector is by construction a credential-logging tool feeding a public repo.
  2. A build-failing check proves no model call bypasses the instrument: `modelRegistry.complete` called outside `diagnostics/` fails the build, because provider hooks wire only into the main agent's `streamFn` and any un-chokepointed nested call is invisible.
  3. Every turn appends a JSONL row carrying model, provider, tokens, cost, latency, cache-read ratio and outcome — and no reasoning-token column for Bedrock, which reports none.
  4. When a model writes a tool call as prose (`finish_reason:"stop"` with `tool_calls:null`) the turn is logged as `prose_tool_call` and retried rather than treated as complete. Built and unit-verified with `fauxProvider`; **verified live on the work laptop** that the detector has actually fired on real traffic.
  5. `/budget` reports system-prompt, tool-schema, context-file and skills-index tokens plus `cacheRead` vs `input`, and logs rotate rather than growing unbounded.
**Contains [RUNBOOK] requirements**: DIAG-01, DIAG-05 — the runbook entry for each is a deliverable of this phase, folded into `docs/RUNBOOK.md` in Phase 3.
**Plans**: TBD
**Research**: Not needed — all 33 events, return shapes and blocking semantics are enumerated and verified, and `fauxProvider` gives a complete offline test harness.

### Phase 3: Providers & Credentials
**Goal**: Every provider the harness will route to is structurally complete in-repo with zero secrets, and every credential-dependent behaviour is either unit-verified offline or documented in a runbook the user can execute.
**Depends on**: Phase 2 (the instrument that verifies what actually reaches each provider)
**Requirements**: PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07, PROV-08, PROV-09, PROV-10
**Success Criteria** (what must be TRUE):
  1. A fresh clone contains structurally complete `models.json` and `auth.json`; every value resolves at runtime from `$ENV_VAR` or `!command`, `!command` appears only in `auth.json` (cached per process, never re-executed per request), and no secret is present.
  2. Built and unit-verified with `fauxProvider`: expired SSO produces a message naming the exact `aws sso login --profile <name>` command and is classified **non-retryable** so it cannot burn wall-clock in a retry loop; a DeepSeek-direct → DashScope fallback chain handles quota, transient and unavailable errors.
  3. **Verified live on the work laptop**: a two-turn *tool-calling* sequence against DashScope returns 200 — the first turn always works, so the second is the test — and Bedrock authenticates from a fresh shell via `credential.env.AWS_PROFILE`.
  4. The R1 question is settled with a recorded result: whether `api.deepseek.com` accepts `reasoning_effort: "low"`, and whether it yields materially fewer reasoning tokens than `"high"`. Until it is settled, `/cheap` is not defined in terms of a cheap thinking tier.
  5. `docs/RUNBOOK.md` exists and lists every credential-dependent check with its expected output, so each verification has either passed or is visibly outstanding rather than quietly assumed.
**Contains [RUNBOOK] requirements**: PROV-03, PROV-04, PROV-07, PROV-10 — the runbook (PROV-09) is the phase's own deliverable.
**Plans**: TBD
**Research**: `--research-phase` recommended — three open empirical questions, none answerable from a desk: the R1 low-thinking-tier contract, the real DashScope `contextWindow` (393,216 corroborated by one researcher, UNVERIFIED by another), and whether strict-schema mode reduces the prose-tool-call rate.

### Phase 4: Safety & Deployment Guardrails
**Goal**: A confused model on a laptop where merging to `main` auto-deploys to AWS cannot cause an irreversible action, and the limits of that protection are documented rather than assumed.
**Depends on**: Phase 1 only — safety imports nothing from routing by design, so it can be source-reviewed in isolation. Sequenced here because the deployment risk exists from the first real session, not after routing lands.
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05, SAFE-06, SAFE-07, SAFE-08, SAFE-09, SAFE-10, SAFE-11, SAFE-12, SAFE-13, SAFE-14, SAFE-15, SAFE-17
**Success Criteria** (what must be TRUE):
  1. **Verified live on the work laptop**: a push to a protected GitLab branch is rejected *server-side*, before any harness rule is trusted — this is the only control that is not theatre.
  2. A blocked command stays blocked **inside a spawned subagent** and under `--mode json` where confirmation is deny-by-default, proven by CI tests rather than interactive trial — project-scoped extensions never load in subagents, and `noOpUIContext.confirm` returns `false`.
  3. `g=push; git $g`, `sh -c "..."` and heredoc forms are caught by AST parsing, and anything unparseable is refused rather than allowed; enforcement happens twice, at the hook and inside the wrapped `bash` tool, because a later hook can mutate the input after approval.
  4. Writes are blocked when `HEAD == main` and `glab mr merge` is refused, while `git fetch/rebase/diff/log origin/main` and `git worktree add -b feat main` still work; `.env`, `~/.aws/credentials`, kubeconfig and `*.tfstate` reads are blocked, and `terraform apply|destroy|import`, mutating `aws` calls and `kubectl delete` require confirmation.
  5. At least 30 evasion attempts are each blocked or explicitly documented as out of scope, every allow and block appears in an audit JSONL, and a published table names the bypasses the guard does **not** catch.
**Contains [RUNBOOK] requirements**: SAFE-01.
**Plans**: TBD
**Research**: `--research-phase` recommended — `unbash`'s handling of Git Bash path forms (`/c/Users/...` vs `C:\`) in argument position is UNVERIFIED and is a real cross-platform risk for path-scoped policy. Reading `@ramtinj95/pi-infra-command-guard`'s source (read, do not install) is a genuine research task.

### Phase 5: Routing & Capability Guards
**Goal**: The user chooses which model does which job explicitly, and the harness refuses routes that are impossible rather than degrading silently.
**Depends on**: Phase 2 (to verify), Phase 3 (for models to exist)
**Requirements**: ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, ROUTE-05, ROUTE-06, ROUTE-07, ROUTE-08, ROUTE-09, ROUTE-10, ROUTE-11
**Success Criteria** (what must be TRUE):
  1. `/cheap`, `/balanced` and `/max` swap the whole role→model map across executor, planner, reviewer, advisor, vision and summariser — and the resulting wire dump proves the intended model actually served the next turn.
  2. Mode survives a restart at zero context-token cost, and `/escalate` state is visible and sticky until explicitly cleared.
  3. Impossible routes are refused with a reason instead of degrading silently: image → text-only model, oversized context → small-window model, Bedrock non-Claude with thinking enabled (the configuration is dropped while the UI still offers it), and Bedrock DeepSeek R1 as executor (it supports no tool calling at all).
  4. Single-shot roles run through `callModel()` with per-call reasoning effort and no session mutation; roles needing a tool loop run as subagents.
  5. **Verified live on the work laptop**: Qoder accepts a delegated task and folds the result back, documented as a *foreign agent* that bypasses the harness's tools, safety hooks and wire inspector.
**Contains [RUNBOOK] requirements**: ROUTE-11.
**Plans**: TBD
**Research**: Not needed — the three-tier routing mechanism is verified at source; the virtual-provider path is explicitly out of scope for v1.

### Phase 6: Walking Skeleton — `/quick` & the Evidence Gate
**Goal**: The full plumbing path — route → guard → execute → evidence → commit — runs end to end at the smallest possible size, before any ceremonial workflow is built on top of it.
**Depends on**: Phase 4, Phase 5
**Requirements**: FLOW-01, FLOW-11, GATE-07
**Success Criteria** (what must be TRUE):
  1. `/quick` takes a trivial task from prompt to atomic commit — routed by Phase 5, guarded by Phase 4, logged by Phase 2 — in **≤80 lines**; if it exceeds 100 it has failed.
  2. A completion claim is rejected unless a `tool_result` exit code bound to the current git SHA supports it. Prose in the transcript that merely *looks like* command output does not pass, which matters because the model that writes prose tool calls can also write plausible command output.
  3. CI fails the build when any workflow file exceeds its line budget — the budget exists *before* the cathedral is built, not after.
**Plans**: TBD
**Research**: Not needed — this phase is deliberately minimal and exercises components already verified.

### Phase 7: Composed Extensions, Pinned & Reviewed
**Goal**: Every commodity capability the harness needs is available from an exact-pinned, reviewed extension, so no effort is spent reimplementing features against an API that ships every 2–3 days.
**Depends on**: Phase 1 (packaging), Phase 5 (for `agentOverrides` wiring)
**Requirements**: EXT-01, EXT-02, EXT-03, EXT-04, EXT-05, EXT-06, EXT-07, EXT-08, EXT-09, EXT-10
**Success Criteria** (what must be TRUE):
  1. `pi list` matches a committed lockfile with every version pinned exactly, and every pin was re-verified at planning time rather than inherited from research — the ecosystem ships 13–16 releases/month.
  2. Plan mode, todo tracking, background bash, LSP diagnostics, structured user questions, web lookup, session search and loop detection are all available in a session, with Pi's own bundled examples preferred wherever they cover the need and any extension lacking a license file vendored rather than depended on.
  3. A subagent runs with its own model, system prompt, tool restriction and thinking level; it can run in the background without blocking the session and can be steered mid-run without being killed.
  4. A parallel subagent in an isolated git worktree can **build**, not merely check out — untracked files like `.env` and `node_modules` do not travel to a new worktree.
  5. File checkpointing restores the working tree, and a documented smoke-test ritual (one turn per provider, one subagent spawn, one blocked command, one wire dump) passes after a version bump.
**Plans**: TBD
**Research**: `--research-phase` required — every pin must be re-verified rather than inherited. File checkpointing and provider fallback are explicitly LOW-confidence categories and should be re-surveyed, not installed from the research document.

### Phase 8: Quality Gates & Engineering Quality
**Goal**: A cheap executor's output is caught by the same class of defect a strong model would have caught, at a measured cost, and the fixes it produces are root-cause fixes rather than symptom patches.
**Depends on**: Phase 2 (`callModel()`), Phase 5 (routing), Phase 7 (reviewer subagent, LSP)
**Requirements**: GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-06, GATE-08, GATE-09, GATE-10, QUAL-01, QUAL-02, QUAL-04, QUAL-05, QUAL-06, QUAL-07, QUAL-09
**Success Criteria** (what must be TRUE):
  1. Typecheck, lint, LSP diagnostics and deterministic anti-pattern rules (magic numbers, literal-value special-casing, copy-paste duplication, swallowed exceptions, shipped `TODO`/`FIXME`, N+1 shapes) run and feed errors back **before** any model review, adding no model round trip and no measurable wall-clock.
  2. A seeded defect the cheap executor misses is caught by the gate, and seeded-defect calibration reports what share of injected defects the reviewer actually finds — distinguishing "the code is clean" from "the reviewer is asleep".
  3. Review output carries a per-requirement verdict (Implemented / Partial / Missing) with `file:line` evidence, a mandatory "checked and cleared" section so silence is structurally impossible, BLOCKER/WARNING/NIT classification with unclassified findings rejected as malformed, and a refute-or-promote pass before a BLOCKER can stop work.
  4. Every change is classified root-cause / symptomatic / workaround with written justification on the review pass already being paid for; symptomatic and workaround changes stop the workflow pending explicit approval, and an approved workaround is recorded with what the proper fix would be and why it was deferred.
  5. The wall-clock and token cost the quality layer adds is a recorded number per turn in the JSONL, so the correctness/latency balance is measured and tunable rather than guessed. Nested-role thinking budgets (reviewer, advisor, summariser) apply; main-loop budgets apply only where Phase 2 proved the parameters land.
**Contains [RUNBOOK] requirements**: GATE-10 — the main-loop half is verified live; the nested-role half is `fauxProvider`-verifiable.
**Plans**: TBD
**Research**: Not needed — the comparative survey produced prescriptive artifact schemas, gate definitions and the anti-review-theatre protocol. Implement from it.

### Phase 9: Ceremonial Workflows
**Goal**: The GSD replacement exists — a spec that cannot be written on unverified assumptions, a plan with verification commands, an execution that pastes real output, and a review that opens an MR to staging.
**Depends on**: Phase 4, Phase 5, Phase 6, Phase 7, Phase 8
**Requirements**: FLOW-02, FLOW-03, FLOW-04, FLOW-05, FLOW-06, FLOW-07, FLOW-08, FLOW-09, FLOW-10, QUAL-03, QUAL-08
**Success Criteria** (what must be TRUE):
  1. `/grill` interrogates with an ambiguity scorecard, per-dimension floors, a hard question budget, one question at a time and rotating perspectives — and refuses to write requirements until SPEC.md carries a Verified Codebase Facts table (`claim | evidence (file:line or command output) | how verified`).
  2. SPEC.md states error behaviour as `IF <condition> THEN THE SYSTEM SHALL <response>`, pins scope as a machine-checkable expected-files list, and — for any change framed as a fix — carries a Root Cause section naming the cause with `file:line` evidence and stating why the change addresses the cause rather than the symptom.
  3. `/plan` produces tasks in `T### [P] [R#] verb <explicit path> + verification command` form with a requirement-coverage matrix, and `/execute` appends real pasted command output to PROGRESS.md and commits atomically.
  4. `/review` produces REVIEW.md and opens an MR targeting **staging, never `main`**, with the diff checked against SPEC's expected-files list — and one real feature has shipped end to end this way on the work laptop.
  5. Gate depth scales with the work: `/quick` runs deterministic rules only while the full workflow runs all four quality mechanisms; subagents receive self-contained handoff packets so delegation costs negative tokens in the parent; total artifacts remain SPEC, PLAN, REVIEW plus a PROGRESS append, with no document no downstream consumer reads.
**Plans**: TBD
**Research**: Not needed — artifact schemas, gate definitions and line budgets are already prescriptive.

### Phase 10: Context Budget & Progressive Disclosure
**Goal**: The harness stops being a tax on the model it exists to help, and the open question of whether context pollution actually degrades output quality gets a measured answer.
**Depends on**: Phase 2 (`/budget`), Phase 7, Phase 8, Phase 9 (everything that registers a tool)
**Requirements**: CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06
**Success Criteria** (what must be TRUE):
  1. Named tool profiles (recon / implement / review / full) are set once at `session_start` via `pi.setActiveTools()` and only ever added to — tool *removal* invalidates the prompt cache, and the `context` hook cannot strip tool definitions at all.
  2. `/budget` shows the per-turn floor measurably below the ~1,850-token baseline, and each installed extension's per-turn token cost is a recorded number that either justifies keeping it or removes it.
  3. CI fails when `AGENTS.md` exceeds its token budget, and no volatile content — timestamps, running cost, git branch, changed files — appears in the system prompt.
  4. **Verified live on the work laptop**: a controlled minimal-vs-full-harness experiment produces a recorded answer on whether context pollution actually degrades output quality, so the roadmap's remaining root-cause candidates are discriminated rather than assumed.
**Contains [RUNBOOK] requirements**: CTX-05.
**Plans**: TBD
**Research**: `--research-phase` required — the minimal-vs-full experiment is a research task with a designed protocol, not an implementation task. No study establishes a token threshold; anyone quoting one is guessing.

### Phase 11: Terminal UI
**Goal**: The harness looks and feels like the user's own tool, without any of it costing 50× on the prompt prefix.
**Depends on**: Phase 5 (model/mode state), Phase 7 (subagent activity), Phase 10 (cache discipline)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. A custom theme conforming to Pi's schema, a custom startup header, and a statusline showing model, provider, context remaining, session cost, git branch and changed files all ship.
  2. A live widget shows running subagents and their status.
  3. `cacheRead` stays non-trivial with the full UI enabled, and a wire dump confirms that no volatile value reached the system prompt — every one of them renders in TUI chrome instead.
**Plans**: TBD
**Research**: Not needed — the theme format is exact (53 tokens, 51 required, 4 value formats, hot-reload on edit).
**UI hint**: yes

## Carried-Forward Unknowns

These are open at roadmap time and must not be planned as settled.

| # | Unknown | Where it is settled | Constraint until then |
|---|---------|---------------------|-----------------------|
| R1 | Whether DeepSeek-direct accepts `reasoning_effort: "low"` — two researchers reached opposite conclusions, neither issued a request | Phase 3 (PROV-07), gated behind Phase 2 | `/cheap` must **not** be defined in terms of a cheap thinking tier. Impact is bounded: on the DashScope path `low` → `high` server-side regardless, so this only ever affects DeepSeek-direct. |
| — | Which of three candidates is the actual root cause of "DeepSeek misses bugs Sonnet would catch": prose tool calls (~11%, open upstream issue), context pollution (mechanism verified, degradation evidence medium), or provider misconfiguration (verified for Bedrock non-Claude and DashScope) | Phase 2 (measurement) + Phase 10 (controlled experiment) | Do not commit to a fix for a cause that has not been measured. |
| — | Whether DeepSeek V4 Flash honours `reasoning_effort` at all through Pi's `openai-completions` adapter | Phase 2 — this is what the instrument exists to answer | Main-loop thinking budgets stay gated (GATE-10). |
| — | Runtime behaviour of every third-party extension — nothing was executed during research | Phase 7 | Re-verify every pin at planning time; treat checkpointing and provider fallback as unsettled categories. |

## Verification Split

Eight of 107 requirements need live credentials the development machine does not have. Everything else is verifiable offline with `fauxProvider()`, `SessionManager.inMemory()`, and `--mode rpc` for dialog tests.

| Phase | [RUNBOOK] requirements |
|-------|------------------------|
| 2 — Diagnostics | DIAG-01, DIAG-05 |
| 3 — Providers | PROV-03, PROV-04, PROV-07, PROV-10 |
| 4 — Safety | SAFE-01 |
| 5 — Routing | ROUTE-11 |
| 8 — Quality Gates | GATE-10 (main-loop half only) |
| 10 — Context Budget | CTX-05 |

A phase containing a [RUNBOOK] requirement is not complete until the runbook entry exists **and** the user has executed it. `docs/RUNBOOK.md` is a Phase 3 deliverable (PROV-09) that later phases append to.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

Phase 4 (Safety) has no dependency on Phase 3 (Providers) or Phase 5 (Routing) and is parallel-safe with both; it is sequenced at 4 because execution is sequential (`parallelization: false`) and the deployment risk exists from the first real session.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Bootstrap, Packaging & Supply Chain | 0/TBD | Not started | - |
| 2. Diagnostics — The Instrument | 0/TBD | Not started | - |
| 3. Providers & Credentials | 0/TBD | Not started | - |
| 4. Safety & Deployment Guardrails | 0/TBD | Not started | - |
| 5. Routing & Capability Guards | 0/TBD | Not started | - |
| 6. Walking Skeleton — `/quick` & Evidence Gate | 0/TBD | Not started | - |
| 7. Composed Extensions, Pinned & Reviewed | 0/TBD | Not started | - |
| 8. Quality Gates & Engineering Quality | 0/TBD | Not started | - |
| 9. Ceremonial Workflows | 0/TBD | Not started | - |
| 10. Context Budget & Progressive Disclosure | 0/TBD | Not started | - |
| 11. Terminal UI | 0/TBD | Not started | - |

---
*Roadmap created: 2026-08-13 · Granularity: fine · Coverage: 107/107 v1 requirements mapped*
