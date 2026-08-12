# Feature Research

**Domain:** Personal coding-agent harness (Pi) — spec-driven workflows for making cheap models reliable
**Researched:** 2026-08-12
**Confidence:** HIGH for SDD survey and grilling techniques (primary sources: vendor docs, source files, local GSD install). MEDIUM for model-routing role taxonomy (practitioner reports, few controlled studies). MEDIUM for Pi-kit landscape (npm + repo READMEs, one package unverifiable).

---

## Part 1 — Spec-Driven Development Survey

### 1.1 What each system actually is

#### GitHub spec-kit

**Artifacts.** `/speckit.constitution` → `.specify/memory/constitution.md` (non-negotiable project principles). `/speckit.specify` → `spec.md`. `/speckit.clarify` → edits `spec.md` in place, adding a `## Clarifications` → `### Session YYYY-MM-DD` section. `/speckit.plan` → `plan.md` plus satellite files (`data-model.md`, `research.md`, `contracts/`, `quickstart.md`). `/speckit.tasks` → `tasks.md`. `/speckit.checklist` → `checklists/requirements.md`. `/speckit.analyze` → cross-artifact consistency/coverage check (read-only). `/speckit.implement` → executes `tasks.md`.

**The task format is the single best-designed artifact in the whole survey** ([tasks.md template](https://github.com/github/spec-kit/blob/main/templates/commands/tasks.md)):

```
- [ ] T012 [P] [US1] Create User model in src/models/user.py
```

Task ID + parallel marker + user-story label + verb + **explicit file path**. The template explicitly rejects tasks missing any of those four. That is a ~40-token-per-task convention that eliminates most "which file did you mean" ambiguity.

**Gates.** `/speckit.implement` validates that constitution/spec/plan/tasks all exist before executing. `/speckit.analyze` is an optional pre-implement coverage gate. Checklists act as a "definition of done" gate.

**What practitioners say fails.** Martin Fowler's team [reviewed it directly](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html): spec-kit produces "a LOT of markdown files" that are "repetitive" and "tedious to review," and the reviewer's blunt verdict is **"I'd rather review code than all these markdown files."** The same review found that despite comprehensive specs, agents "frequently ignored instructions" or "went way overboard" — i.e. **the artifact volume did not buy adherence.** It also notes spec-kit is effectively *spec-first* (create a branch per spec) despite aspiring to be spec-anchored — the specs are change requests, not living documentation.

#### AWS Kiro

**Artifacts.** Three files per spec: `requirements.md` (user stories + EARS acceptance criteria), `design.md` (architecture, sequence diagrams, error handling), `tasks.md` (discrete trackable tasks traced back to requirements). Plus two orthogonal features: **steering files** (persistent project context, the `AGENTS.md` analogue) and **agent hooks** (event-driven automations on save/create/delete or manual trigger). [Kiro docs](https://kiro.dev/docs/specs/).

**Workflow and gates.** Linear three-phase: Requirements → Design → Tasks, with **explicit human approval gates between phases**. Kiro also ships a "Quick Spec" variant that auto-generates all three artifacts *without* approval gates — an implicit admission that the ceremony is not always worth it. Tasks execute in dependency "waves" with concurrency inside each wave.

**EARS, honestly assessed.** EARS (Easy Approach to Requirements Syntax, Mavin et al., Rolls-Royce ~2009) is a constrained grammar with a handful of patterns; the ones that matter here are:

| Pattern | Template | Use for |
|---|---|---|
| Ubiquitous | `THE SYSTEM SHALL <response>` | Always-true invariants |
| Event-driven | `WHEN <trigger> THE SYSTEM SHALL <response>` | Happy-path behaviour |
| Unwanted behaviour | `IF <condition> THEN THE SYSTEM SHALL <response>` | **Error handling — the pattern that forces edge-case thinking** |
| State-driven | `WHILE <state> THE SYSTEM SHALL <response>` | Mode-dependent behaviour |
| Optional feature | `WHERE <feature included> THE SYSTEM SHALL <response>` | Config-gated behaviour |

**Verdict: the formalism is worth it selectively, and specifically for the user's failure mode (b) "edge cases and error handling are invented or missing."** The `IF <unwanted condition> THEN` pattern is a *forcing function* — you cannot fill the template without naming a failure condition. The rest of EARS is largely ceremony. The criticism is real and well-sourced: one practitioner used Kiro on a *small bug* and got "4 user stories" and "16 acceptance criteria" — "a sledgehammer to crack a nut" (Fowler). Another observed agents "don't respect all the details of the specs it creates enough to make the time investment in super-detailed specs worthwhile."

**Steal:** the `IF/THEN` unwanted-behaviour pattern as a *mandatory section*, and the requirement→task traceability. **Skip:** full EARS grammar policing, `design.md` as a separate mandatory artifact, and the three-approval-gate cadence.

#### OpenSpec

**The differentiator is the change-proposal model and spec deltas.** Two directories: `openspec/specs/` (source of truth for *current* system behaviour, organised by domain) and `openspec/changes/<name>/` (proposed modifications). Each change folder holds `proposal.md`, `design.md`, `tasks.md`, and `specs/` containing **delta specs** written as three sections: `ADDED Requirements`, `MODIFIED Requirements`, `REMOVED Requirements`. On `archive`, the deltas are merged into the canonical specs and the change folder moves to `changes/archive/` with a date prefix. ([concepts.md](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md))

**Command surface:** `/opsx:explore`, `/opsx:propose`, `/opsx:apply`, `/opsx:archive` as the default quick path; `/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:verify`, `/opsx:bulk-archive`, `/opsx:onboard` in an opt-in expanded profile. The docs explicitly frame the model as **actions, not locked phase gates**, and position OpenSpec as "lighter" than spec-kit with no "rigid phase gates."

**The two-profile design (default quick / opt-in expanded) is the single most transferable structural idea in the survey** — it is progressive disclosure applied to the workflow surface itself.

**Steal:** the ADDED/MODIFIED/REMOVED delta framing (it is *itself* a scope-drift detector — anything not in a delta section is out of scope), the two-profile command surface, and `explore` as a distinct pre-propose thinking step. **Skip:** the persistent `specs/` corpus. On a large multi-stack work repo, maintaining a parallel canonical spec tree is spec-rot waiting to happen, and the user has explicitly ruled out auto-memory for the same reason.

#### Tessl / spec-as-source

**Model.** The spec is the maintained artifact; code is a derived, regenerable output. Generated files are marked `// GENERATED FROM SPEC - DO NOT EDIT`, with 1:1 spec-to-file mapping. Separately, the **Tessl Spec Registry** (open beta since Sept 2025, 10,000+ specs) provides per-library specs so agents "use open source libraries correctly" and avoid API hallucination and version mixups.

**Status check.** What is GA is the registry, governance, and a spec-first workflow tile. The regeneration engine the thesis depends on is **closed beta, JavaScript-only, 1:1 spec-to-file, and demonstrably non-deterministic** ([codemyspec review](https://codemyspec.com/blog/tessl-review)). Fowler's warning is the sharpest: spec-as-source risks inheriting "the downsides of both MDD and LLMs: Inflexibility *and* non-determinism."

**Steal exactly two ideas, and reject the model:**
1. **Library specs as anti-hallucination context.** Pi has no web tool and MCP is out of scope. A tiny per-project `AGENTS.md` section pinning exact library versions and their 3-5 most-misused API signatures is the cheap local version of the Spec Registry, and it directly targets failure mode (a).
2. **Marking machine-owned regions.** Not for source code — for the harness's own generated artifacts (SPEC.md, PLAN.md, MR descriptions), so a human edit is visible and never silently clobbered.

**Reject:** regenerable code. It contradicts atomic commits, contradicts diff review, and would be a catastrophic fit for Terraform owned by another team.

#### GSD (get-shit-done-cc) — the incumbent

Read directly from the local install (`C:/Users/Admin/.claude/get-shit-done`, VERSION **1.42.3**). Actual shape: **≈90 workflow files, ≈60 slash commands, 33 subagent definitions, ≈70 reference documents.**

**Strengths worth preserving — all five are cheap and all five are genuinely load-bearing:**

1. **`spec-phase`'s quantitative ambiguity scoring.** Four weighted dimensions (Goal 35% / Boundary 25% / Constraint 20% / Acceptance 20%), each with a floor (0.75 / 0.70 / 0.65 / 0.70), gate at ambiguity ≤ 0.20 with *all* minimums met. Max 6 rounds, 2-3 questions per round. Crucially it **rotates interview perspectives** — Researcher → Simplifier → Boundary Keeper → Failure Analyst → Seed Closer. This is the best interrogation design found anywhere in the survey and nothing in spec-kit or Kiro matches it. Cost: ~3.5k tokens of workflow text.
2. **The four-type gate taxonomy** (`references/gates.md`): Pre-flight (blocks entry, no partial work), Revision (loops to producer with feedback, iteration-capped, with **stall detection** — escalate early if the issue count stops decreasing), Escalation (surface to human), Abort (stop to prevent damage). ~700 tokens. This is a genuinely reusable vocabulary and should be lifted almost verbatim.
3. **Evidence-gated completion** (`references/verification-patterns.md`). Core principle: *Existence ≠ Implementation.* Four levels — Exists / Substantive / Wired / Functional — with concrete stub-detection greps. Directly targets cheap models claiming success.
4. **Adversarial reviewer stance** (`agents/gsd-code-reviewer.md`). "FORCE stance: assume every submitted implementation contains defects." Ships an explicit list of *how reviewers go soft* (stopping at surface issues; treating "tests pass" as correctness; **downgrading BLOCKER to WARNING to avoid seeming harsh**), and mandates a BLOCKER/WARNING classification on every finding — unclassified findings are invalid output.
5. **Scope guardrail + deferred-ideas capture** (`discuss-phase.md`). A stated heuristic ("does this clarify *how* we implement what's already scoped, or add a new capability?"), a canned redirect script, and a Deferred Ideas bucket so the idea isn't lost. Directly targets failure mode (d).

Also worth keeping: **canonical refs accumulation** (every doc/spec the user mentions mid-conversation is immediately read and recorded with a full relative path — "these are often MORE important than the roadmap refs"), and **checkpoint-per-area** so an interrupted interrogation resumes.

**What is ceremony — measured, not asserted:**

| GSD file | Lines | ≈ tokens | Verdict |
|---|---:|---:|---|
| `workflows/execute-phase.md` | 1,800 | ~23k | Ceremony. Phase/roadmap/state bookkeeping dominates. |
| `workflows/plan-phase.md` | 1,784 | ~23k | Mostly ceremony. Revision loops + subagent orchestration are the 15% worth keeping. |
| `workflows/quick.md` | 1,169 | ~15k | **Ceremony, and self-refuting.** A "no-ceremony path for trivial work" that costs 15k tokens to load. |
| `workflows/code-review.md` | 613 | ~8k | Half ceremony (flag parsing, config gates, depth resolution). |
| `workflows/verify-phase.md` | 543 | ~7k | Mixed. |
| `workflows/discuss-phase.md` | 499 | ~6.5k | Kept under budget only via lazy-loaded mode overlays — good practice. |
| `workflows/spec-phase.md` | 262 | ~3.5k | **Keep. Highest value density in the suite.** |
| `workflows/pr-branch.md` | 157 | ~2k | Reasonable. |

Additional ceremony: the phase/milestone/roadmap/STATE.md bookkeeping layer (`.planning/` with per-phase directories, DISCUSSION-LOG.md that is explicitly "for human reference only and NOT consumed by downstream agents"), 8+ mode flags on a single command (`--power --all --auto --chain --text --batch --analyze` plus advisor mode, with a documented overlay precedence order), and `--auto` modes that answer the user's own clarification questions on their behalf — which defeats the entire purpose of a grilling workflow.

**On DISCUSSION-LOG.md specifically:** an artifact that no downstream consumer reads is pure token cost with zero reliability return. Do not port it.

#### Other credible approaches

**BMAD-METHOD.** Persona-per-role (Analyst, PM, Architect, Scrum Master, Dev, QA/Test Architect, UX) with structured handoffs. Two-phase: a planning stack (Product Brief → PRD → architecture doc) then a per-story dev loop. **The one transferable idea is the hyper-detailed story file as a complete handoff package** — each implementation unit runs in a *fresh chat* and the story file carries everything the dev agent needs (architectural context, implementation guidance, embedded rationale, test criteria). That is exactly the right pattern for a cheap executor with limited attention: don't ask it to hold the whole project, hand it a self-contained unit. The persona theatre itself is cost with no measured benefit.

**Anthropic's own guidance** ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)) is the most directly applicable source in the survey because it is written against the exact constraint the user has — *"LLM performance degrades as context fills. The context window is the most important resource to manage."* Concretely:

- **"Explore first, then plan, then code"** — with an explicit carve-out: *"For tasks where the scope is clear and the fix is small... ask Claude to do it directly... If you could describe the diff in one sentence, skip the plan."* This is direct vendor endorsement of a `/quick` workflow that skips ceremony.
- **"Let Claude interview you"** — a documented prompt pattern: *"Interview me in detail... Ask about technical implementation, UI/UX, edge cases, concerns, and tradeoffs. Don't ask obvious questions, dig into the hard parts I might not have considered. Keep interviewing until we've covered everything, then write a complete spec to SPEC.md."* And the spec quality bar: *"The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step that proves the feature works."* — that sentence alone is a complete SPEC.md schema.
- **"Give Claude a way to verify its work"** — *"Have Claude show evidence rather than asserting success: the test output, the command it ran and what it returned."*
- **"Add an adversarial review step"** — a reviewer in a fresh context *"sees only the diff and the criteria you give it, not the reasoning that produced the change."* With a critical caveat: *"A reviewer prompted to find gaps will usually report some, even when the work is sound... Chasing every finding leads to over-engineering. Tell the reviewer to flag only gaps that affect correctness or the stated requirements."*
- **The CLAUDE.md pruning test** — *"For each line, ask: Would removing this cause Claude to make mistakes? If not, cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"* Apply this test to every line of the harness, not just AGENTS.md.

**gentle-pi (Gentleman-Programming) — the closest Pi-native prior art.** Wraps OpenSpec inside Pi with the chain `init → explore → proposal → spec → design → tasks → apply → verify → sync → archive`, plus commands `/gentle:status`, `/gentle:doctor`, `/gentle:models`, `/gentle:persona`, `/sdd-init`. Notable: **native review as a bounded transaction (`START → FINALIZE → VALIDATE`)**, a durable commit transaction with pre-commit hook validation and **HEAD proof**, dangerous-command blocking, and an explicit "parent sessions remain thin; delegation occurs at the narrowest useful point" principle. Strong confirmation that this project's architecture is on a well-trodden path — and a 10-step chain is more than four workflows should attempt.

**@minhduydev/pi-harness (v2.8.1, 13 releases since 2026-07-27).** Eight lifecycle prompts: `/init`, `/create`, `/fix`, `/plan`, `/research`, `/verify`, `/ship`, `/handoff`. Plus a portable runtime policy at `.pi/APPEND_SYSTEM.md`, an `.pi/ANTI_PATTERNS.md`, a `pi-harness.lock.json` version lock, typed workflow state validation, and "human authority over irreversible actions." Depends on `@minhduydev/pi-subagents@0.13.0` and `@mrclrchtr/supi-ask-user@4.7.0` — confirming the compose-don't-fork strategy and confirming an ask-user extension is the standard solution to Pi's missing `AskUserQuestion`.

> `@preapexis/pi-kit` **could not be verified** — returns 404 on npm. Treat any claim about it as unverified.

### 1.2 Comparison table

| | **spec-kit** | **Kiro** | **OpenSpec** | **Tessl** | **GSD 1.42.3** | **BMAD** | **Anthropic CC** |
|---|---|---|---|---|---|---|---|
| **Persistence model** | Spec-first (branch per spec) | Spec-first, weakly anchored | **Spec-anchored** (`specs/` + deltas) | **Spec-as-source** | Spec-first, phase-scoped | Spec-first | Spec-first, ephemeral |
| **Requirements artifact** | `spec.md` | `requirements.md` (EARS) | delta specs (ADDED/MODIFIED/REMOVED) | `.spec` w/ `@generate`/`@test` | `NN-SPEC.md` | PRD | `SPEC.md` (ad hoc) |
| **Design artifact** | `plan.md` + `data-model.md` + `research.md` + `contracts/` | `design.md` | `design.md` | in spec | `NN-CONTEXT.md` + `NN-PLAN.md` | architecture doc | plan-mode plan |
| **Task artifact** | `tasks.md` (`T### [P] [US#] verb path`) | `tasks.md` (dep waves) | `tasks.md` checklist | n/a | `NN-PLAN.md` XML tasks | story files | TodoWrite |
| **Governance artifact** | `constitution.md` | steering files | — | governance tile | `AGENTS.md`/`CLAUDE.md` + `.continue-here.md` | — | `CLAUDE.md` |
| **Clarification step** | **`/speckit.clarify`** — ≤5 Qs, taxonomy scan, one at a time | requirements phase w/ approval gate | `/opsx:explore` | — | **`spec-phase`** — ambiguity scoring, 6 rounds, rotating perspectives | analyst persona | "let Claude interview you" |
| **Coverage/consistency gate** | **`/speckit.analyze`** + `/speckit.checklist` | task→requirement traceability | `/opsx:verify` | tests in spec | plan-checker (max 3 iters + stall detection) | QA persona | adversarial review subagent |
| **Approval gates** | soft (artifact existence) | **hard, human, per phase** | **explicitly none** ("actions not phases") | code-gen gate | 4-type taxonomy (pre-flight/revision/escalation/abort) | per-story | none |
| **Review artifact** | — | — | — | — | `NN-REVIEW.md` (BLOCKER/WARNING) | QA gate | `/code-review` skill |
| **Escape hatch for trivial work** | none | **Quick Spec** (no gates) | **quick path** (`explore→propose→apply→archive`) | none | `/gsd:quick` (**1,169 lines**) | none | **"skip the plan"** |
| **Ceremony cost** | HIGH (many files, "tedious to review") | HIGH ("sledgehammer") | **LOW–MED** | HIGH | **VERY HIGH** (~90 workflows, 33 agents) | VERY HIGH | **LOW** |
| **Evidence/verification discipline** | checklists | task status | `/opsx:verify` | generated tests | **strongest** (Exists/Substantive/Wired/Functional) | test architect | **"show evidence, don't assert"** |

### 1.3 What to steal — one line each

| Source | Steal | Reject |
|---|---|---|
| spec-kit | `/clarify` taxonomy + ≤5-question budget + one-question-at-a-time + recommended-option-with-reasoning; `T### [P] [REQ] verb <explicit path>` task format; `/analyze` requirement→task coverage check | constitution.md; multi-file plan satellites; 8-command surface |
| Kiro | `IF <condition> THEN THE SYSTEM SHALL` as a **mandatory** error-handling section; requirement→task traceability IDs; steering files ≈ `AGENTS.md` (already decided) | full EARS grammar; mandatory `design.md`; three human approval gates |
| OpenSpec | ADDED/MODIFIED/REMOVED delta framing as a scope pin; **default-quick / opt-in-expanded two-profile surface**; `explore` as a separate pre-spec step | persistent `openspec/specs/` corpus (spec rot) |
| Tessl | library-version + misused-API pinning in `AGENTS.md`; machine-owned region markers on harness artifacts | regenerable code, entirely |
| GSD | ambiguity scorecard + rotating interview perspectives; 4-type gate taxonomy w/ stall detection; Exists/Substantive/Wired/Functional; adversarial reviewer w/ "how reviewers go soft" list + BLOCKER/WARNING mandate; scope guardrail + deferred ideas; canonical-refs accumulation; interrupt checkpoints | phase/milestone/roadmap bookkeeping; DISCUSSION-LOG.md; 8 mode flags; `--auto` self-answering; 1,169-line "quick" |
| BMAD | self-contained handoff unit executed in a **fresh context** | persona theatre |
| Anthropic | evidence-not-assertion; fresh-context adversarial reviewer + the "only correctness gaps" caveat; interview-me prompt; "if you could describe the diff in one sentence, skip the plan"; the CLAUDE.md pruning test applied harness-wide | — |
| gentle-pi | bounded review transaction (START→FINALIZE→VALIDATE); HEAD proof on commit; thin-parent delegation | 10-step chain |

---

## Part 2 — Prescriptive: what the four workflows should contain

Design rules applied throughout: **one artifact per workflow** unless a second one is read by a downstream consumer; every artifact section must have a named consumer; every workflow file has a hard line budget; nothing loads until invoked.

### Workflow 1 — `/grill` → `SPEC.md`

**Budget: ≤ 250 lines of workflow text (~3.5k tokens), one artifact.**

Artifact `.pi/work/<slug>/SPEC.md`, in this order:

| § | Section | Content | Why it exists | Kills failure mode |
|---|---|---|---|---|
| 1 | **Goal** | One falsifiable sentence | Downstream anchor | (c) |
| 2 | **Verified codebase facts** | Table: `claim \| evidence (file:line or command output) \| how verified`. **Every row needs evidence. Unverifiable claims move to §7.** | *The novel artifact.* Nothing in spec-kit/Kiro/OpenSpec has this. | **(a)** |
| 3 | **Requirements** | `R1..Rn`. Each: statement, current state, target state, acceptance criterion as a **runnable command or observable output** | GSD spec-phase rule; Anthropic's "self-contained spec" | (c) |
| 4 | **Error & edge behaviour** | **Mandatory, minimum 3 entries**, each `IF <condition> THEN THE SYSTEM SHALL <response>` | Kiro's one genuinely valuable EARS pattern, used as a forcing function | **(b)** |
| 5 | **Scope pin** | Two explicit lists: In scope / Out of scope. **Out-of-scope must be non-empty**, each with a one-line reason. Files expected to change, by path. | OpenSpec deltas + GSD boundary keeper; the file list is the input to the drift detector in `/review` | **(d)** |
| 6 | **Clarifications log** | `- Q: <question> → A: <answer>` | spec-kit's exact pattern; makes the interrogation auditable and re-readable | (c) |
| 7 | **Assumptions** | Anything not verified in §2, each with a blast-radius note | Honest uncertainty beats confident wrongness | (a) |
| 8 | **Ambiguity scorecard** | 4 dims + score + gate result | GSD; makes "am I done grilling?" mechanical instead of vibes | (c) |

**Gates.**
- *Pre-flight:* not on `main`; `<slug>` free; repo readable.
- *Evidence gate (novel, and the most important gate in the harness):* the workflow may not write §3 until §2 exists and every row carries evidence. Enforced structurally — grill runs read/grep **before** proposing anything.
- *Ambiguity gate:* score ≤ 0.20 with all dimension minimums met, **or** the user explicitly overrides (unmet dimensions get stamped `⚠ ASSUMPTION` into §7).
- *Scope gate:* §5 out-of-scope list non-empty and expected-files list non-empty.

**Command surface: two entry points, no flags.** `/grill <description>` and `/grill --resume`. (OpenSpec's two-profile idea applies at the *workflow set* level here — `/quick` is the light profile, so `/grill` does not need one.)

### Workflow 2 — `/plan` → `PLAN.md`, then `/execute`

**Budget: ≤ 200 lines plan + ≤ 250 lines execute.**

`PLAN.md`:
1. **Task list** in spec-kit format, extended with requirement traceability:
   `- [ ] T003 [P] [R2,R5] Add refresh-token rotation to src/auth/session.ts`
   Every task carries: ID, optional `[P]`, requirement IDs, verb, **explicit file path**, and a **verification command**.
2. **Coverage matrix** — `R1..Rn → T###`. A requirement with zero tasks fails the gate. (spec-kit `/analyze`, done cheaply as a table rather than a whole command.)
3. **Files-touched union** — carried into `/review` as the drift baseline.

`/execute` writes no planning artifact. It appends to `PROGRESS.md`: per task, the commit SHA, the verification command, and **its actual output pasted in**.

**Gates.**
- *Pre-flight:* SPEC.md exists and passed its gate.
- *Coverage gate:* every requirement mapped; every task has a file path and a verification command.
- *Deterministic gate, per task:* typecheck/lint/LSP diagnostics run **before** any model-based check. Free, instant, never wrong.
- *Evidence gate:* a task is not "done" without command output in PROGRESS.md.
- *Revision gate:* deterministic failure → retry, capped at 2, **with stall detection** (if the error count does not drop, escalate immediately rather than burning the cap).
- *Drift abort:* a task attempting to write a file outside the union of SPEC §5 and PLAN §3 halts and asks.

**Execution shape:** one subagent per task, fresh context, receiving a **self-contained handoff** (BMAD's story-file insight): SPEC excerpt for its requirement IDs, the relevant §2 verified facts, its file paths, its verification command. Not the whole SPEC, not the conversation.

### Workflow 3 — `/review` → `REVIEW.md` → MR

**Budget: ≤ 250 lines.**

**Reviewer input contract** — this is a project requirement already and the research confirms it, with one addition:
1. the diff,
2. **full current contents of every touched file** (not just hunks) — *"a process limited to changed lines misses the defects that break production"*,
3. **test + typecheck + lint output** (already run by the deterministic gate — pass the output, don't re-run),
4. **SPEC.md §3 requirements and §4 error behaviour** — so the reviewer checks against intent, not just plausibility,
5. **the files-touched union** — so drift is detectable,
6. *(addition)* **the list of files the diff imports from or is imported by**, gathered by grep. Cross-file breakage is the documented blind spot: *"a change to an API contract might break three downstream consumers."*

`REVIEW.md`:
1. **Requirement verdicts** — one row per `R#`: `Implemented / Partial / Missing`, each with a file:line citation. A reviewer forced to render a verdict per requirement cannot rubber-stamp by silence.
2. **Findings** — `BLOCKER / WARNING / NIT`, each with file:line, the concrete failure it causes, and a suggested fix. GSD's rule: unclassified findings are invalid output.
3. **Scope drift** — files changed that are not in the union.
4. **Checked and cleared** — the anti-theatre section: what the reviewer examined and *why it is fine*. A clean review must still produce content here.

**Anti-review-theatre measures, each grounded in the literature:**
- The reviewer runs in a **fresh subagent context** and sees the diff + criteria, never the implementer's reasoning (Anthropic).
- **Adversarial framing with a named soft-failure list** ("stopping at surface issues", "treating tests-pass as correctness", "downgrading BLOCKER to WARNING to avoid seeming harsh") — from GSD's reviewer agent.
- **Mandatory per-requirement verdict + "checked and cleared"**. Research finding: *"An LLM may silently produce an approval when unsure about a change, unlike a human reviewer who would typically acknowledge uncertainty."* Silence must be structurally impossible.
- **Refute-or-promote on BLOCKERs only.** Each BLOCKER gets one refutation pass before it is accepted ([arXiv 2604.19049](https://arxiv.org/pdf/2604.19049)). This is the counterweight to Anthropic's warning that a reviewer told to find gaps will always find some — and to the documented case where 80+ agents unanimously endorsed a vulnerability *that did not exist*. **Two-sided, not one-sided.**
- **Explicit scope for findings:** *"flag only gaps that affect correctness or the stated requirements"* (Anthropic). Cap NITs; they are the mechanism by which a reviewer that posts 18 comments per PR teaches you to ignore it.
- **Bounded loop:** BLOCKERs → fix → re-review, max 2 iterations with stall detection, then escalate to the user.

**MR step (`glab`).** Verified command surface: `glab mr create | view | list | diff | approve | merge | checkout | note | update | close | reopen | rebase | approvers | revoke | subscribe | todo`. Merge supports queuing behind a green pipeline (`--when-pipeline-succeeds`/auto-merge).

MR description is generated **from SPEC + PLAN + PROGRESS evidence, not from the diff.** Practitioner consensus is unambiguous — the description must carry *what changed, **why** it changed, how it was tested, what risks exist, and where the reviewer should look hardest*; a diff-derived description restates the "what" that the reviewer can already read, and AI-generated descriptions "tend to be verbose" and need filler like "This PR introduces..." trimmed. Sections: Why (SPEC §1), What (requirement list), Verification (pasted evidence from PROGRESS.md), Risk / look-here, Out of scope (SPEC §5), and an **AI-authorship disclosure line** (emerging norm: *"if AI tooling wrote, completed, refactored or rewrote part of a contribution, it should be disclosed"*).

**Gating agent-authored MRs — the layered pattern:** GitLab **server-side protected branches + approval rules are the real control**; `glab mr merge` blocked in the harness is defense-in-depth; CI blocks the merge if core rules fail; human review is reserved for design, correctness, and business alignment. This matches the project's existing decision and the published framework exactly. Given `main` auto-deploys, MRs target **staging**, never `main`.

### Workflow 4 — `/quick`

**Budget: ≤ 80 lines. If it exceeds 100, it has failed.** GSD's 1,169-line `quick.md` is the cautionary example, and Anthropic's own guidance is the licence: *"If you could describe the diff in one sentence, skip the plan."*

No SPEC, no PLAN, no REVIEW. The artifact is the commit.

Guard rails only:
- Hard ceiling on files touched (suggest 3). Exceeding it → *"this is a `/grill` job"* and stop.
- The deterministic gate still runs; still evidence-gated (command output in the commit body or transcript).
- One atomic commit.
- Two consecutive deterministic-gate failures → auto-escalate to `/grill`. (This is the loop-detection requirement, applied where cheap models actually spiral.)

---

## Part 3 — What makes a grilling workflow effective

### 3.1 The four named failure modes, mapped to techniques with real provenance

**(a) Agent assumes something false about the codebase and builds on it.**

The only technique with real support is **verification-before-proposal, structurally enforced**. GSD's `spec-phase` mandates it as a critical rule: *"Scout the codebase BEFORE the first question — grounded questions only."* Its `discuss-phase` has a dedicated `scout_codebase` step budgeted at ~10% of context, and annotates every question with the code context it found (*"You already have a Card component with shadow/rounded variants"*). spec-kit's `/clarify` loads the spec and constitution before the taxonomy scan. Anthropic's phase 1 is Explore, and its prompt guidance is *"point to sources"* and *"reference existing patterns."*

The gap all four leave open: none of them make the agent **record its evidence**. That is the §2 Verified Codebase Facts table. The discipline it enforces is exactly the researcher-agent discipline in this very task — a claim without a citation is a hypothesis, not a fact. Cost: ~15 lines of template plus the reads it forces. Highest reliability-per-token item in the design.

Two supporting techniques: **library/API pinning** in `AGENTS.md` (Tessl Registry's local equivalent — Pi has no web tool, so version-mixup hallucination has no natural corrective), and **canonical refs accumulation** (GSD) so any doc the user names mid-interrogation is read immediately.

**(b) Happy path works; edge cases and error handling invented or missing.**

Three techniques, all real:

1. **A fixed taxonomy scan** rather than open-ended thinking. spec-kit's `/clarify` scans the spec against a named taxonomy and marks each category **Clear / Partial / Missing**: *Functional Scope & Behavior* (core goals, explicit out-of-scope, roles) · *Domain & Data Model* (entities, identity/uniqueness, lifecycle transitions, volume assumptions) · *Interaction & UX Flow* (journeys, **error/empty/loading states**, a11y/i18n) · *Non-Functional* (perf, scale, reliability, observability, security/privacy, compliance) · *Integration & External Dependencies* (**external service failure modes**, formats, versioning) · *Edge Cases & Failure Handling* (**negative scenarios, rate limiting, concurrent-edit conflicts**) · *Constraints & Tradeoffs* · *Terminology* · *Completion Signals* (acceptance-criteria testability) · *Misc/Placeholders* (**TODOs and unquantified adjectives like "robust", "intuitive"**). A checklist finds what free association misses.
2. **The Failure Analyst perspective** (GSD round 4): *"What's the worst thing that could go wrong if we get the requirements wrong?" · "What does a broken version of this look like?" · "What would cause a verifier to reject the output?"*
3. **The `IF/THEN` template as a forcing function** (Kiro/EARS). A mandatory minimum-3-entry section that cannot be filled without naming failure conditions. Template-forced enumeration is more reliable on a cheap model than an instruction to "consider edge cases," because it converts a judgement call into a fill-in-the-blank.

**(c) User's own spec is fuzzy and they only find out when they see wrong output.**

- **Quantitative ambiguity scoring** (GSD): 4 weighted dimensions with per-dimension floors, displayed after every round. Makes "are we done?" mechanical, gives the user a visible progress signal, and — the key property — a *low individual dimension* tells you exactly which question to ask next.
- **Rotating perspectives** (GSD): Researcher → Simplifier → Boundary Keeper → Failure Analyst → Seed Closer. Different lenses surface different blindspots; a single persona asks the same shape of question repeatedly.
- **Recommended-option-with-reasoning** (spec-kit): every multiple-choice question leads with `**Recommended:** Option X - <1-2 sentence reasoning>`, then a table of options, then *"reply with the letter, say 'yes'/'recommended', or give your own short answer."* This is the highest-leverage single technique for a user who does not yet know what they want: **reacting to a concrete proposal is far easier than generating a specification.** It also degrades gracefully — "yes" is a valid answer.
- **One question at a time, ≤5 questions** (spec-kit hard rule; GSD's is 2-3 per round × 6 rounds). Never reveal the queue in advance.
- **Question-quality rules** (spec-kit, unusually specific and worth copying near-verbatim): lead with a full interrogative ending in `?`; a topic label or requirement ID is **never** a valid question; follow immediately with one plain-language *"Why it matters"* sentence; everyday wording only.
- **Impact × Uncertainty prioritisation** (spec-kit): with a 5-question budget, rank candidates by `Impact × Uncertainty` and only ask questions whose answers "materially impact architecture, data modeling, task decomposition, test design, UX behavior, operational readiness, or compliance."
- **Interview, then execute in a fresh session** (Anthropic): the spec is the handoff; the implementation session starts with clean context.
- **Structured options need a real tool.** Pi has no `AskUserQuestion`; `@mrclrchtr/supi-ask-user` is what the published kits use. Falls back to plain-text numbered lists (GSD's `--text` mode).

**(d) Scope drift — builds more or less than asked.**

- **Explicit in/out lists with a non-empty out-of-scope requirement.** Narrative prose does not pin scope; a list does. GSD makes Boundaries mandatory and non-empty; spec-kit's taxonomy has "explicit out-of-scope declarations" as its own category.
- **The scope-creep heuristic and redirect script** (GSD): *"Does this clarify how we implement what's already scoped, or does it add a new capability?"* → capture in Deferred Ideas, redirect, do not act. The deferred bucket matters: an idea that has nowhere to go gets built.
- **Expected-files list as a machine-checkable pin.** Named at grill time, carried through plan, and diffed at review time. This is the only one of the four scope techniques that catches drift *automatically* rather than by the agent's own judgement — which is precisely why a cheap model needs it.
- **ADDED/MODIFIED/REMOVED framing** (OpenSpec): anything not in a delta section is, by construction, out of scope.
- **"Builds less than asked"** is caught by the coverage matrix (`/plan`) and per-requirement verdicts (`/review`), not by the spec.

### 3.2 Techniques deliberately not adopted

| Technique | Source | Why not |
|---|---|---|
| Full EARS grammar across all requirements | Kiro | Verbosity without proportional return; adopt only the `IF/THEN` pattern where it forces edge-case thinking |
| Constitution / project principles file | spec-kit | `AGENTS.md` already covers it; a second governance file competes for the same attention and both get skimmed |
| Persona role-play | BMAD | No measured benefit; GSD's *perspectives* achieve the same blindspot rotation as question sets, at a fraction of the tokens |
| `--auto` self-answering the clarification questions | GSD | Directly defeats the purpose of a grilling workflow. If the work is clear enough to auto-answer, it is a `/quick` job |
| Separate `design.md` | Kiro, OpenSpec | For a solo user on an existing codebase, design detail belongs in PLAN task descriptions; a standalone design doc is written once and read never |
| Unbounded interrogation | — | Question budgets exist in every mature implementation (spec-kit 5, GSD 6 rounds). Interrogation fatigue makes the user click through, which is worse than not asking |

---

## Feature Landscape

*Token costs are estimates: workflow/skill text ≈ 13 tokens per line of markdown. "Per-turn" = paid on every single turn (system-prompt resident). "On-invoke" = paid only when the feature is used. The distinction is the whole ballgame for cheap-model reliability.*

### Table Stakes (needed before this gets used daily)

| Feature | Why Expected | Complexity | Token cost | Notes |
|---|---|---|---|---|
| Working provider auth (Bedrock SSO, DashScope, DeepSeek) with actionable expiry messages | Nothing works without it; an opaque provider error on a laptop with SSO is a daily blocker | MEDIUM | ~0 per-turn | Already a P1 project requirement |
| Explicit role→model routing + session modes | The entire premise. Manual model swapping per task is why people abandon multi-model setups | MEDIUM | ~0 per-turn (config) | No auto-classification — a wrong classifier is undebuggable |
| Deterministic gates (typecheck/lint/LSP) before any model review | Free, instant, never wrong. A meaningful share of "bugs Opus would catch" are type errors | LOW | ~0 (shell) | **Best reliability-per-token item in the harness.** Install an LSP extension |
| Evidence-gated completion | Cheap models falsely claim success. The single most-cited fix, by Anthropic and by GSD | LOW | ~200 per-turn (one rule in `AGENTS.md`) | *"Show evidence rather than asserting success"* |
| Atomic commits, one per task | Universal expectation; makes revert a one-liner instead of archaeology | LOW | ~0 | Anthropic: commit at logical checkpoints, don't auto-commit everything |
| `AGENTS.md` per project, pruned | Every harness has this. Pi loads it | LOW | 300-800 per-turn | Apply the pruning test: *"Would removing this cause a mistake?"* Bloat causes instruction-dropping |
| Structured user questions (ask-user extension) | Grilling is unusable without it; plain-text menus are error-prone | LOW (install) | ~150 per-turn (tool schema) | `@mrclrchtr/supi-ask-user` — used by published kits |
| Subagents with per-agent model + fresh context | Required for the reviewer to be independent and for executor context isolation | MEDIUM (compose) | ~250 per-turn (tool schema) | Compose `pi-subagents`, never fork |
| Safety: HEAD==main write block, `glab mr merge` block, dangerous-command confirm | `main` auto-deploys to AWS. Non-negotiable | MEDIUM | ~0 (hooks are code) | Hook is a mistake-catcher; GitLab protected branches are the real control |
| `/quick` no-ceremony path | Without it, every trivial fix pays full ceremony and the harness gets bypassed entirely | LOW | ~1k on-invoke | **Hard ≤80-line budget** |
| Todos / task tracking + plan mode | Claude Code parity; Pi omits both deliberately | LOW (install) | ~200 per-turn | Commodity extensions |
| Web/doc lookup | Pi has no web tool and MCP is out of scope. Without it the agent cannot check a library API | LOW (install) | ~150 per-turn | Mandatory, not optional |
| Per-turn JSONL log (model, tokens, cost, latency, outcome) | Cannot tune routing without measurement | LOW | ~0 (hook) | Local file, no service |

### Differentiators (why build this instead of using stock Pi + gentle-pi)

| Feature | Value Proposition | Complexity | Token cost | Notes |
|---|---|---|---|---|
| **Verified Codebase Facts table in SPEC.md** | Kills failure mode (a) structurally. **No surveyed system has this** — they all scout the codebase but none force the agent to record evidence | LOW | ~200 on-invoke (template) | Highest reliability-per-token idea in this document |
| **Reviewer context contract (diff + full touched files + test output + SPEC + file union + import graph)** | The documented cause of missed bugs is reviewing hunks in isolation. Explicitly targets bugs of omission and cross-file breakage | MEDIUM | 5-30k on-invoke, in the *reviewer's* context only | Already a project decision; research confirms and adds the import-graph item |
| **Anti-review-theatre protocol** (per-requirement verdicts + "checked and cleared" + refute-or-promote on BLOCKERs) | Documented failure: *LLMs silently approve when unsure.* Silence must be structurally impossible. Refutation pass counters the opposite failure (invented findings) | MEDIUM | ~600 on-invoke | Two-sided. One-sided adversarial framing produces over-engineering |
| **Wire-level request inspector** | Two of four quality levers may be no-ops on non-Anthropic providers. Nobody else ships this. Turns a guess into a measurement | MEDIUM | ~0 per-turn (hook) | Must precede thinking budgets |
| **Machine-checkable scope pin** (expected-files list → diff at review) | Turns scope drift from a judgement call into a `comm` command. The one scope technique that doesn't depend on cheap-model judgement | LOW | ~50 on-invoke | Feeds `/review` §3 |
| **Ambiguity scorecard with per-dimension floors** | Makes "am I done grilling?" mechanical and tells you which question to ask next | LOW | ~400 on-invoke | Lift from GSD spec-phase |
| **Capability guards (vision→text-only, oversized context→small window) as hard blocks** | Eliminates the one routing failure class that is not a judgement call | LOW | ~0 (code) | ~50 lines per the project brief |
| **Advisor escalation at hard decision points** | Cheap executor consults a strong model at named junctures, rather than routing the whole session | MEDIUM | ~150 per-turn (tool) + strong-model calls | Contingent on measured value |
| **Self-contained subagent handoff packets** (BMAD's story-file insight) | A cheap model with a scoped packet beats a cheap model with the whole project. Directly targets the degrades-as-context-fills constraint | MEDIUM | *Negative* — reduces parent context | The core mechanism for cheap-model reliability |
| **`/quick` auto-escalation to `/grill` on repeated gate failure** | Loop detection where cheap models actually spiral | LOW | ~50 on-invoke | Counter-based, not model-judged |
| **Progressive disclosure as an enforced budget** (line caps per workflow, CI-checked) | GSD has this test and still ships a 1,169-line "quick". A budget only works if it's enforced | LOW | *Negative* | Mirror GSD's `workflow-size-budget` test |

### Anti-Features (deliberately NOT built)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Multi-file spec bundles** (`constitution.md` + `spec.md` + `plan.md` + `data-model.md` + `research.md` + `contracts/`) | Feels rigorous; spec-kit does it | Fowler's review: "a LOT of markdown files", "repetitive", "tedious to review", **"I'd rather review code than all these markdown files."** More artifacts = more tokens, more drift surface, more places for the cheap model to lose the thread — and it did not buy adherence | **One artifact per workflow.** SPEC.md, PLAN.md, REVIEW.md. Every section must name its consumer |
| **Persistent canonical spec corpus** (`openspec/specs/`, spec-anchored) | "Living documentation"; specs stay true over time | Spec rot. A parallel spec tree over a large multi-stack work repo becomes stale invisibly — the *exact* reason auto-memory is already out of scope. Fowler notes even the tools aspiring to it don't achieve it | SPEC.md lives with the change and is archived with it. `AGENTS.md` holds the durable facts and rots visibly in a diff |
| **Spec-as-source / regenerable code** | Elegant; the spec becomes the only thing to maintain | Regeneration engine is closed beta, JS-only, **non-deterministic**. Fowler: risks "the downsides of both MDD and LLMs: Inflexibility *and* non-determinism." Incompatible with atomic commits, diff review, and third-party-owned Terraform | Spec-first. Code is the artifact; the spec is scaffolding that gets archived |
| **Full EARS across all requirements** | Rolls-Royce pedigree; forces precision | Verbose; Kiro on a small bug produced 4 user stories and 16 acceptance criteria — "a sledgehammer to crack a nut." Practitioners report agents don't respect that detail enough to justify writing it | `IF <cond> THEN THE SYSTEM SHALL` in the error section **only**, where the template genuinely forces new thinking |
| **Human approval gate between every phase** | Feels safe and controlled | Approval fatigue is the same failure as permission-prompt fatigue — *"After the tenth approval you're not really reviewing anymore, you're just clicking through."* Kiro shipped "Quick Spec" (no gates) as an escape hatch, which tells you what users actually wanted | **One** gate that matters (ambiguity gate at end of `/grill`), plus automatic gates that need no human (deterministic, coverage, evidence, drift) |
| **`--auto` mode that answers its own clarification questions** | Speed; GSD has it | Structurally self-defeating for a grilling workflow. It converts "the user doesn't know what they want" into "the model guessed and nobody noticed" — failure mode (c) with extra steps | `/quick` for work that doesn't need grilling. If it needs grilling, it needs a human |
| **Mode-flag matrices** (`--power --all --auto --chain --text --batch --analyze` with documented overlay precedence) | Flexibility | Combinatorial surface nobody can hold in their head, and every flag is branch logic the cheap model must parse. GSD documents an overlay *precedence order* — that is a smell | Two entry points per workflow at most. OpenSpec's default/expanded profile split if more is ever needed |
| **Artifacts no downstream consumer reads** (GSD's `DISCUSSION-LOG.md`, explicitly "NOT consumed by downstream agents") | Auditability | Pure token cost, zero reliability return, and it rots | The clarifications log **inside** SPEC.md. Same audit value, zero extra files, and it's in the reviewer's context |
| **Auto-classifying router** (RouteLLM-style complexity threshold) | Optimal cost per prompt without thinking about it | A misrouted task produces a bad result with no obvious cause — the exact undebuggable failure already hit with DeepSeek. Already a Key Decision | Explicit role→model map + `/cheap`/`/balanced`/`/max` modes + per-invocation `/escalate` |
| **Strict TDD gate** | Rigour | Fights Terraform and varied-maturity repos. Already out of scope. The real failure is false claims of success, which evidence-gating fixes and TDD does not | Evidence-gated completion; tests when the repo has them |
| **A heavyweight `/quick`** | "Quick should still be safe" | GSD's is 1,169 lines (~15k tokens). Loading 15k tokens of workflow to change two lines is precisely "the harness becomes the bottleneck" | ≤80 lines. Guard rails only: file ceiling, deterministic gate, atomic commit, auto-escalate |
| **Per-turn-resident workflow instructions** | "Make sure the model always follows the process" | Every per-turn token competes with the actual task on a model whose attention is the scarce resource. *"Bloated CLAUDE.md files cause Claude to ignore your actual instructions"* | Skills: name + description resident (~30 tokens), body loaded on invoke |
| **Reviewer that reports every finding it can generate** | Thoroughness | *"A reviewer prompted to find gaps will usually report some, even when the work is sound... Chasing every finding leads to over-engineering."* A tool posting 18 comments per PR teaches you to ignore it | Scope to correctness + stated requirements; cap NITs; refute BLOCKERs before accepting them |
| **Chained auto-advance across all four workflows** | One command, walk away | Compounds errors silently — the documented pattern where an agent introduces a bug then builds three features on top of it. Each of the four workflows is a natural human checkpoint | Explicit invocation. Each workflow ends by printing the next command |
| **Persona role-play for subagents** | BMAD popularised it; feels like a team | Tokens spent on characterisation instead of task context. The blindspot rotation comes from the *question sets*, not the costume | Named perspectives inside one grilling workflow; role-specific *prompts and models* for subagents |
| **Hosted observability / eval SaaS** | Real metrics | Violates zero-spend; already out of scope | JSONL + wire inspector |

---

## Feature Dependencies

```
[Wire-level request inspector]
    └──BLOCKS──> [Per-role thinking budgets]
    └──BLOCKS──> [Confident claims about routing behaviour]

[Provider auth working]
    └──requires──> everything model-related

[Deterministic gates (LSP/typecheck/lint)]
    └──feeds──> [Reviewer context contract]   (pass the output, don't re-run)
    └──feeds──> [/quick auto-escalation]      (2 failures = escalate)
    └──feeds──> [Evidence-gated completion]   (its output IS the evidence)

[SPEC.md §2 Verified Codebase Facts]
    └──requires──> read/grep executed BEFORE proposal (structural, not advisory)
    └──feeds──> [SPEC §3 Requirements]
    └──feeds──> [Reviewer: "was this assumption true?"]

[SPEC.md §5 Scope pin + expected files]
    └──feeds──> [PLAN.md files-touched union]
                     └──feeds──> [REVIEW.md §3 scope drift detection]

[SPEC.md §3 Requirements (R1..Rn)]
    └──feeds──> [PLAN.md coverage matrix]     (zero-task requirement = gate fail)
    └──feeds──> [REVIEW.md §1 per-requirement verdicts]
                     └──enables──> [anti-rubber-stamp]

[Subagents extension]
    └──requires──> [fresh-context reviewer independence]
    └──requires──> [self-contained handoff packets]
    └──enables──> [worktree isolation for parallel tasks]

[ask-user extension]
    └──requires──> [/grill] structured questions
                     (fallback: plain-text numbered lists)

[Progressive disclosure / line budgets]
    └──enables──> everything else fitting in a cheap model's usable attention
    └──requires──> a CI test, or it will not hold

[Atomic commits] ──enables──> [clean diff for review] ──enables──> [MR description from evidence]

[GitLab protected branches (server-side)]
    └──is the real control for──> [main-branch write block]  (hook is defense-in-depth only)

CONFLICTS:
[--auto self-answering]        ⟂ [/grill's purpose]
[persistent spec corpus]       ⟂ [no-auto-memory decision]  (same rot failure)
[multi-file spec bundles]      ⟂ [cheap-model attention budget]
[chained auto-advance]         ⟂ [human checkpoints between workflows]
[reviewer reports everything]  ⟂ [reviewer findings are actionable]
```

### Dependency Notes

- **Wire inspector blocks thinking budgets.** Already a Key Decision; research reinforces it. Also block any *claim* about thinking behaviour in docs until measured.
- **Deterministic gates feed three consumers.** Build once, wire into review context, quick-escalation, and evidence. This is why they are P1 despite being unglamorous.
- **Requirement IDs are the traceability spine.** `R#` in SPEC → `[R#]` on tasks in PLAN → per-`R#` verdict in REVIEW. Cost is a few tokens per line; it is what makes "builds less than asked" mechanically detectable. Kiro and spec-kit both have this; it is the cheapest good idea in the survey.
- **Scope pin only works end-to-end.** A scope list in SPEC that nothing checks is decoration. The value is entirely in the SPEC §5 → PLAN §3 → REVIEW §3 chain.
- **The ask-user extension is on the critical path for `/grill`** and must have a graceful text fallback, or an extension break takes the flagship workflow down.
- **Line budgets need a test.** GSD ships a `workflow-size-budget` test and still has a 1,169-line quick workflow — proving budgets applied unevenly do not hold.

---

## MVP Definition

### Launch With (v1)

Ordered so that each item is usable the day it lands.

- [ ] **Provider auth + explicit role→model map + session modes** — nothing is testable without it
- [ ] **Wire-level request inspector** — gates the honesty of everything downstream; build before quality levers
- [ ] **Deterministic gates** (LSP/typecheck/lint, POSIX sh) — best reliability-per-token, feeds three consumers
- [ ] **Safety hooks** (HEAD==main write block, `glab mr merge` block, dangerous-command confirm, `/share` block, out-of-project write block) — `main` auto-deploys; non-negotiable
- [ ] **`/quick`** (≤80 lines) — the daily-use path; validates gates + atomic commits + evidence with minimum surface
- [ ] **Evidence-gated completion rule in `AGENTS.md`** — ~200 per-turn tokens, targets the headline symptom
- [ ] **`/grill` → SPEC.md** with §1-§8 — the flagship; §2 Verified Facts, §4 IF/THEN errors and §5 scope pin are the three sections that must not be cut
- [ ] **`/plan` → PLAN.md + `/execute`** — task format with file paths and `[R#]` IDs, coverage matrix, per-task atomic commit + evidence
- [ ] **`/review` → REVIEW.md → MR** — full reviewer context contract, per-requirement verdicts, BLOCKER/WARNING/NIT, scope drift, MR body from evidence
- [ ] **Per-turn JSONL log** — cannot tune routing without it
- [ ] **Line-budget CI test** — or the budgets will not hold

### Add After Validation (v1.x)

- [ ] **Refute-or-promote pass on BLOCKERs** — add once the base reviewer runs; trigger is the first over-engineering incident from a phantom finding
- [ ] **Advisor escalation at named decision points** — trigger: JSONL shows a repeated class of cheap-model failure at a specific juncture
- [ ] **Per-role thinking budgets** — trigger: **wire inspector proves the parameters reach the provider**
- [ ] **Worktree isolation + parallel `[P]` task execution** — trigger: a plan with genuinely independent tasks that is slow serially
- [ ] **Library/API pinning section in `AGENTS.md`** (local Tessl-Registry equivalent) — trigger: first observed API hallucination or version mixup
- [ ] **Import-graph expansion in reviewer context** — trigger: first cross-file breakage the reviewer missed
- [ ] **Provider fallback chains** — trigger: first quota-driven work stoppage
- [ ] **Playwright CLI verification skill, evidence-gated** — trigger: first frontend phase
- [ ] **Session search, file checkpointing** — commodity installs, sequence by felt pain

### Future Consideration (v2+)

- [ ] **UI layer** (theme, statusline, startup header, subagent activity widget) — explicitly sequenced last; motivating but must not block a daily driver
- [ ] **OpenSpec-style ADDED/MODIFIED/REMOVED delta format** — defer until a *second* change to the same subsystem makes deltas cheaper than a fresh SPEC
- [ ] **macOS verification via GH Actions matrix** — defer to the first cross-platform need
- [ ] **Qoder Agent SDK as a routed role** — defer until the base three providers are proven

---

## Feature Prioritization Matrix

| Feature | User Value | Impl. Cost | Per-turn token cost | Priority |
|---|---|---|---|---|
| Provider auth + role→model map | HIGH | MEDIUM | ~0 | P1 |
| Deterministic gates before model review | HIGH | LOW | ~0 | P1 |
| Wire-level request inspector | HIGH | MEDIUM | ~0 | P1 |
| Safety hooks (main / merge / dangerous cmd) | HIGH | MEDIUM | ~0 | P1 |
| Evidence-gated completion | HIGH | LOW | ~200 | P1 |
| `/quick` (≤80 lines) | HIGH | LOW | ~1k on-invoke | P1 |
| `/grill` → SPEC.md | HIGH | MEDIUM | ~3.5k on-invoke | P1 |
| — §2 Verified Codebase Facts | HIGH | LOW | ~200 on-invoke | P1 |
| — §4 IF/THEN error section | HIGH | LOW | ~150 on-invoke | P1 |
| — §5 scope pin + expected files | HIGH | LOW | ~50 on-invoke | P1 |
| — §8 ambiguity scorecard | MEDIUM | LOW | ~400 on-invoke | P1 |
| `/plan` + `/execute` w/ `[R#]` traceability | HIGH | MEDIUM | ~6k on-invoke | P1 |
| Coverage matrix gate | HIGH | LOW | ~100 on-invoke | P1 |
| `/review` + reviewer context contract | HIGH | MEDIUM | 5-30k in reviewer ctx | P1 |
| Anti-review-theatre protocol | HIGH | MEDIUM | ~600 on-invoke | P1 |
| MR body from SPEC/PLAN/evidence | MEDIUM | LOW | ~300 on-invoke | P1 |
| Subagents (composed) | HIGH | MEDIUM | ~250 | P1 |
| ask-user extension | HIGH | LOW | ~150 | P1 |
| Web/doc lookup extension | HIGH | LOW | ~150 | P1 |
| Per-turn JSONL log | MEDIUM | LOW | ~0 | P1 |
| Line-budget CI test | MEDIUM | LOW | ~0 | P1 |
| Capability guards | MEDIUM | LOW | ~0 | P2 |
| Self-contained handoff packets | HIGH | MEDIUM | negative | P2 |
| `/quick` auto-escalation | MEDIUM | LOW | ~50 | P2 |
| Refute-or-promote on BLOCKERs | MEDIUM | MEDIUM | ~300 on-invoke | P2 |
| Advisor escalation | MEDIUM | MEDIUM | ~150 | P2 |
| Per-role thinking budgets | UNKNOWN | LOW | ~0 | P2 (blocked) |
| Worktree isolation / parallel tasks | MEDIUM | MEDIUM | ~0 | P2 |
| Library/API pinning in `AGENTS.md` | MEDIUM | LOW | ~200 | P2 |
| Import-graph reviewer expansion | MEDIUM | LOW | in reviewer ctx | P2 |
| Provider fallback chains | MEDIUM | MEDIUM | ~0 | P2 |
| Playwright verification skill | MEDIUM | MEDIUM | ~40 (skill stub) | P3 |
| UI layer | MEDIUM | MEDIUM | ~0 | P3 |
| Delta-spec format | LOW | MEDIUM | ~200 on-invoke | P3 |

---

## Model Routing in Practice

**The common role taxonomy** across systems that actually ship multi-model routing:

| Harness | Roles |
|---|---|
| Kimchi | orchestrator, planner, builder, reviewer, explorer |
| Agyn / research taxonomy | manager, planner, coder, reviewer, executor, tester |
| gentle-pi | global model assignment per persona (`/gentle:models`) |
| This project (as specified) | planning, coding, review, advisor, vision |

The five-to-six role convergence is real, and the project's existing taxonomy matches it. The two roles the survey suggests adding are **explorer/scout** (codebase reconnaissance — high token volume, low reasoning demand, ideal cheap-model work, and it is exactly what `/grill` §2 needs) and **summariser** (compaction/handoff-packet authoring).

**Evidence on tier adequacy — honest state:** the practitioner consensus, not a controlled result, is that *fast/cheap models handle routine implementation well **when given a good plan***, and that the value of a strong model concentrates in **planning** and **review** — the two roles where an error is systemic rather than local. Kimchi's stated principle is the same: reasoning-heavy work to the strong model, repetitive coding to the cheap one, exploration to a third. Cost optimisation is the dominant motivation across all of them.

**For the user's constraint** (DeepSeek V4 Flash main driver, Anthropic via Bedrock where it earns cost, Qoder subscription):

| Role | Recommendation | Rationale | Confidence |
|---|---|---|---|
| Explorer / scout | DeepSeek V4 Flash | High token volume, low reasoning. V4-Flash is 1M context, $0.14/$0.28 per M | HIGH |
| Coding / executor | DeepSeek V4 Flash | Adequate *given a good plan* — which is what `/plan` produces | MEDIUM |
| Planning | Anthropic (Bedrock) or Qoder | Planning errors are systemic; a bad plan makes every downstream task wrong | MEDIUM |
| **Review** | **Anthropic (Bedrock) — the clearest earn-its-cost case** | Reviewer must catch what the writer missed; a same-tier reviewer catches same-tier bugs. Also the role with the highest documented silent-approval risk | MEDIUM-HIGH |
| Advisor | Anthropic, on explicit `/escalate` only | Bounded, user-triggered spend | MEDIUM |
| Vision | Delegate the single turn | Already decided; capability guard makes it a hard block | HIGH |
| Summarise / handoff | DeepSeek V4 Flash | Mechanical | MEDIUM |

Note on the cheap-model diagnosis: DeepSeek V4-Flash (284B total / 13B active, 1M context, re-post-trained 2026-07-31) reportedly beats DeepSeek's own V4-Pro-Preview on all nine of their agent and coding benchmarks. That is vendor-adjacent reporting, not independent evaluation — but it materially weakens the "the model is just weak" hypothesis and strengthens the harness/config hypothesis already recorded in PROJECT.md. **The wire inspector is what settles it.**

---

## Competitor Feature Analysis

| Feature | spec-kit | Kiro | OpenSpec | GSD | Our Approach |
|---|---|---|---|---|---|
| Ambiguity resolution | `/clarify`, ≤5 Qs, taxonomy scan, Impact×Uncertainty | requirements phase + approval gate | `/opsx:explore` | 4-dim weighted score, 6 rounds, rotating perspectives | **Both:** GSD's scorecard + perspectives, spec-kit's taxonomy, ≤5 Qs, recommended-option format |
| Codebase grounding | load spec + constitution | project context | — | `scout_codebase` (~10% ctx), code-annotated questions | **Beyond all:** evidence table with file:line citations, gated |
| Edge-case forcing | taxonomy category | EARS `IF/THEN` | scenarios | Failure Analyst round | **All three:** taxonomy scan + mandatory IF/THEN section + Failure Analyst questions |
| Scope control | out-of-scope taxonomy item | user stories | ADDED/MODIFIED/REMOVED | heuristic + redirect + deferred bucket | **Machine-checkable:** expected-files list diffed at review |
| Traceability | `[US#]` on tasks | task→requirement | tasks in change folder | plan-checker | `R#` → `[R#]` on tasks → per-`R#` verdict; coverage matrix gate |
| Review | — | — | `/opsx:verify` | REVIEW.md, BLOCKER/WARNING, adversarial stance, depth modes | GSD's stance + Anthropic's fresh context + refute-or-promote + "checked and cleared" |
| Trivial-work path | none | Quick Spec (no gates) | quick path | `/quick` (1,169 lines) | `/quick`, **≤80 lines**, auto-escalating |
| Artifact count / change | 6+ | 3 | 4 | 6+ | **3** (SPEC, PLAN, REVIEW) + PROGRESS append |
| Cost discipline | none stated | none stated | "lightweight" | line-budget test (unevenly applied) | Per-turn vs on-invoke accounting for every feature; CI-enforced budgets |

---

## Sources

**Primary — vendor documentation and source**
- GitHub Spec Kit docs — https://github.github.io/spec-kit/ (via Context7 `/websites/github_github_io_spec-kit`, `/github/spec-kit`)
- spec-kit `clarify.md` source (full taxonomy, question-quality rules, Impact×Uncertainty heuristic) — https://github.com/github/spec-kit/blob/main/templates/commands/clarify.md
- spec-kit `tasks.md` task-format rules — https://github.com/github/spec-kit/blob/main/templates/commands/tasks.md
- Kiro specs docs — https://kiro.dev/docs/specs/ · https://kiro.dev/docs/specs/feature-specs/ · https://kiro.dev/blog/introducing-kiro/
- OpenSpec concepts — https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md · README — https://github.com/Fission-AI/OpenSpec
- Tessl launch announcement — https://tessl.io/blog/tessl-launches-spec-driven-framework-and-registry/
- Anthropic, *Best practices for Claude Code* — https://code.claude.com/docs/en/best-practices  **(the most directly applicable source in this survey)**
- Pi docs — https://pi.dev/docs/ · npm `@earendil-works/pi-coding-agent`
- gentle-pi — https://github.com/Gentleman-Programming/gentle-pi
- @minhduydev/pi-harness — https://github.com/MinhDuyDEV/pi-harness · npm v2.8.1
- GitLab CLI `glab mr` reference — https://docs.gitlab.com/cli/mr/

**Primary — local**
- GSD 1.42.3 install, read directly: `workflows/spec-phase.md`, `workflows/discuss-phase.md`, `workflows/quick.md`, `workflows/code-review.md`, `references/gates.md`, `references/questioning.md`, `references/verification-patterns.md`, `references/planner-antipatterns.md`, `agents/gsd-code-reviewer.md`. All line counts measured, not estimated.

**Critical assessment / evidence**
- Martin Fowler (Birgitta Böckeler et al.), *Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl* — https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html  **(the single best critical source)**
- *Spec-driven development: the rebranded BDUF* — https://beyondruntime.substack.com/p/spec-driven-development-the-rebranded
- *Refute-or-Promote: An Adversarial Stage-Gated Multi-Agent Review Methodology* — https://arxiv.org/pdf/2604.19049
- *Are LLMs Reliable Code Reviewers?* (silent approvals; complexity-increases-misjudgment) — https://www.researchsquare.com/article/rs-8993044/latest.pdf
- *The Productivity-Reliability Paradox: Specification-Driven Governance* — https://arxiv.org/pdf/2605.01160 (thesis extracted; empirical detail not retrievable from PDF — **LOW confidence on its numbers**)
- CodeRabbit, *Code context: the evidence behind trustworthy AI code review* — https://www.coderabbit.ai/guides/code-context
- Augment Code, *How we built a high-quality AI code review agent* — https://www.augmentcode.com/blog/how-we-built-high-quality-ai-code-review-agent
- Tessl review (regeneration engine status) — https://codemyspec.com/blog/tessl-review
- EARS notation explained — https://codemyspec.com/blog/ears-notation · Kiro practitioner critique — https://petermcaree.com/posts/kiro-agentic-ide-hype-hope-and-hard-truths/
- Graphite, *AI-generated PR descriptions* — https://graphite.com/guides/ai-generated-pr-descriptions
- Augment Code, *AI model routing guide* — https://www.augmentcode.com/guides/ai-model-routing-guide · Kimchi multi-model harness — https://fossunited.org/c/indiafoss/2026/cfp/5j1ek2p56j
- *Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures* — https://arxiv.org/pdf/2604.03515
- DeepSeek V4-Flash specs/pricing — https://openrouter.ai/deepseek/deepseek-v4-flash · https://benchlm.ai/models/deepseek-v4-flash (**vendor-adjacent benchmark claims: MEDIUM-LOW confidence**)

**Unverified**
- `@preapexis/pi-kit` — 404 on npm; no claims made.
- `mitsupi`, `bestony-pi-preset` — not found in npm registry search for Pi harness packages.

---
*Feature research for: personalised Pi coding-agent harness (spec-driven workflows for cheap-model reliability)*
*Researched: 2026-08-12*
