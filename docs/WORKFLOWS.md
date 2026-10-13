# Workflows — `/quick`'s rationale, and the four ceremonial workflows

`.pi/extensions/workflows/index.ts` carries a header short enough to fit the
line budget this document explains. The reasoning that header cannot hold
lives here instead — relocated, not deleted. If the header reads thin, follow
its pointer here.

**The contract of this file.** As with `docs/SAFETY.md` and `docs/ROUTING.md`,
if the code and this document disagree, the code is authoritative and this
document is a bug. Fix the document; do not fix the code to match the
document.

Sections 1 to 4 explain `/quick`. Sections 5 to 11 describe `/grill`,
`/plan`, `/execute` and `/review`. The tables in sections 5 to 9 are
asserted against the code in both directions by
`tests/unit/docs-policy.test.ts`: a row the code does not have, or a code
row the table omits, fails the suite. The prose in sections 10 and 11 is not
derived and is not asserted.

## 1. What `/quick` is

`/quick` is a Pi **command**, registered with `registerCommand`, and it is
never a tool and never a skill. `CONTRIBUTING.md`'s boundary rule is the
reason: a command is the zero-per-turn-token surface, a tool's schema rides on
every provider request whether or not the model ever calls it, and a skill is
text the model reads and interprets rather than code that can validate a
route or a git branch against real state. `/quick` needs to call
`planRoleCall` and `classifyGitInvocation` and compare a captured SHA against
`HEAD` — none of that is available to a skill, and none of it should cost a
schema on every turn the way a tool would. See `CONTRIBUTING.md`'s boundary
rule for the full argument; it is not re-argued here.

`/quick` **composes** Phase 5 routing, Phase 4 safety and Phase 2
diagnostics. It re-implements none of them. Every refusal `/quick` reports is
a reason string produced by calling the real routing or safety function —
never retyped, never paraphrased. A `/quick` that hardcoded its own refusal
wording, or that re-derived a routing or guard decision instead of calling
the function that already makes it, would have proved nothing about this
harness's route → guard → execute → evidence → commit composition, which is
the entire point of the walking skeleton.

## 2. The dispatch shape

`/quick`'s handler runs eight checks, in this exact order, and the order is
the whole claim being tested:

1. **Pre-flight the route.** Call `planRoleCall` for the `executor` role. A
   refusal is reported verbatim and the command returns — no turn is
   triggered, no provider request is spent.
2. **Session-model match.** The session's own active model (`ctx.model`) must
   equal the routed executor `planRoleCall` just resolved. If the session is
   on a different model — most commonly because no `/cheap`, `/balanced` or
   `/max` has been run yet this session — `/quick` refuses with
   `quick: session model is not the routed executor (<provider>/<id>)`. The
   remedy is exactly one of those three mode commands: they are what makes
   the routed executor the session's active model in the first place
   (`routing/index.ts`'s `setModel` call).
3. **Pre-flight the branch policy.** Call `classifyGitInvocation` against the
   branch `currentBranch` reports right now. A block verdict is reported
   verbatim and the command returns.
4. **Run-in-flight guard.** Refuses with
   `quick: a turn is already in flight -- wait for it to finish` when EITHER
   a `/quick` run is already armed (`isRunArmed()`) OR the session itself is
   not idle (`!ctx.isIdle()`). The second half of this condition exists
   because Pi queues a message typed mid-stream rather than rejecting it —
   without it, a `/quick` typed while an ORDINARY turn is still streaming
   (not a second `/quick`) would silently arm anyway, and the settle would
   attribute that other turn's tool results (and its verdict) to a task
   `/quick` never actually commissioned.
   The same step then adds `.pi/work/`, `.pi/logs/` and `.pi/state/` to the
   repo's `info/exclude` (as `/execute` does) and refuses a working tree with
   uncommitted or untracked changes, naming them: a cheap model's
   `git add -A` would sweep them into the run's commit, and the settle would
   refuse that tree anyway. The brief tells the model to stage only the files
   it changed.
5. **Scan nothing before the work.** No gate runs ahead of the model: the
   change does not exist yet, so there is nothing to check. The deterministic
   change gate (`quality/index.ts#runChangeGateStage`, four legs described in
   `docs/QUALITY.md`) runs once, at settle, on the committed change
   (`base..HEAD`) in the target repo. A run that fails it is rejected there,
   not refused here. The gate does not bill the turn ledger: it runs after
   the last `turn_end`, so billing it would charge the next, unrelated turn.
6. **Arm the evidence run.** `startRun` records the working directory and the
   SHA that is `HEAD` right now, before any work happens.
7. **Hand the task to the ordinary prompt loop.** `/quick` does not run a
   second, nested model call for the work itself — `runSingleShotRole` is
   built for the four single-shot roles only and throws when handed the
   `executor` role by design [modes.ts:401-406]. The task the command was
   given becomes a message sent through `pi.sendUserMessage`, which the
   session's own prompt loop — the model `/cheap`/`/balanced`/`/max` already
   selected — then acts on with its own tool calls, exactly as it would for
   any other prompt.
8. **Gate at settle (`agent_settled`), not at an awaited idle.** A command handler's
   `ctx.waitForIdle()` exists, but in a headless session it is bound to a
   no-op that resolves immediately [runner.js:260] — a `/quick` that awaited
   it would evaluate the completion gate before the model had done anything
   at all, and would look correct while proving nothing. Pi's own `agent_settled`
   event is what actually fires once the triggered turn is over, in both
   interactive and headless sessions, so the gate is wired there instead. The
   SHA read at this point is defensive: `currentSha` fails closed by design
   (throws rather than returning a sentinel), so a repository that becomes
   unreadable mid-run (a destructive command, a transient `index.lock`) must
   still produce a REJECT verdict and disarm the run, never leave `/quick`
   silently and permanently armed.

Five Pi event handlers do the remaining work. One records every
`tool_execution_end` seen while a run is armed and started, not
`tool_result`, which is never emitted for a call `prepareToolCall` resolves
as `kind: "immediate"`: a call this repository's own safety layer blocked, a
schema-validation failure, an unknown tool, or an abort. `tool_execution_end`
fires for every finalized call, including all four of those. One settles the
run when `agent_settled` fires, writing exactly one evidence row and
disarming the run either way. One, on `session_start`, disarms any run left
orphaned by a prior session that never reached `agent_settled`, writes a
reject row for it, and then prunes aged evidence logs.

The last two, on `input` and `before_agent_start`, bind the run to its own
prompt. `pi.sendUserMessage` is fire-and-forget, and Pi can drop the prompt
before the agent starts: no model, expired auth (routine with Bedrock SSO),
compaction in progress, or an `input` handler that refuses it. A run armed
for that prompt is pending until a prompt containing its text reaches
`before_agent_start`. While pending it records no tool call and no settle
ends it, so a turn triggered some other way cannot be attributed to it. Any
other prompt that reaches `input` or `before_agent_start` first disarms it,
with no verdict and no row. A second `/quick` or `/execute` while a run is
pending is refused with the in-flight message, which names `/reload` as the
way to clear a prompt that failed to start. `/reload` fires `session_start`.

These two facts — that a nested single-shot call cannot serve the executor,
and that `waitForIdle` is a no-op in the shape every headless session in this
repository uses — are the reason the dispatch shape looks the way it does. A
future reader who does not know them will look at this file and "simplify"
it back into something that races the model's own turn.

## 3. The line budget, and what a line is

`/quick`'s whole reason for existing is to prove that trivial work needs no
ceremony. A command file that grows past a small budget has failed that
claim regardless of what it accomplishes.

**A line means a raw line** — `readFileSync(f, "utf-8").split("\n").length`.
No comment stripping, no blank-line stripping, no parsing. Two reasons hold
this, not one:

- A comment-excluding count measures a different artifact than the one that
  ships. A file with a heavily commented body can pass a "non-comment lines"
  budget while still being the same size a reader actually has to read; the
  budget would then constrain nothing anyone experiences opening the file.
- Any comment-excluding counter is a heuristic — string literals containing
  `//`, block comments, JSX-like text — and every heuristic here is more
  brittle than the thing it is trying to measure. Counting raw lines is the
  one count that cannot be gamed by reformatting.

**The header is a deliberate, stated exception to house style.** Every other
entry point in `.pi/extensions/` carries a long docstring header; applied
unmodified to a budget this small, the header alone would exceed it. So
`/quick`'s header is kept short on purpose, says only what the command is,
that this document holds the rationale, and that the terseness is the budget
being honoured rather than an oversight — nothing else. The rationale is not
lost, it is relocated here.

**The budget is enforced per file, and as a per-directory ratchet over every
directory a command source reaches by import.** (WR2-04, `08-REVIEW.md`
iteration 2, corrected the two claims this paragraph used to overclaim —
see below.) A file close to its own limit could be "fixed" by moving logic
into a private helper that only `/quick` ever calls — same total code,
smaller number on the one file a reviewer checks. There is now ONE ratchet
per directory reached this way (WR3-06, `08-REVIEW.md` iteration 3: not
restated as a count here — the prior count and enumeration drifted from
`DIRECTORY_BUDGETS` in the very commit that wrote them, which is exactly
what the next paragraph's own rule exists to prevent; see
`tests/unit/workflow-budgets.test.ts`'s `DIRECTORY_BUDGETS` for the current
list), not a single combined figure, each raised by a deliberate edit to a
committed number, in the same commit as the growth that needs it, the same
discipline this repository already applies to a runbook status. A helper
module that would
exist on its own merits, with its own tests, independent of `/quick`, is a
different thing than an offloading helper — but "legitimate" is a judgement
no test can make on its own, which is why the ratchets are the mechanism
that actually holds the line, not a promise.

**"Reaches by import" is a genuine, transitive fixed point, not a one-hop
lookup.** `.pi/extensions/quality/` and `.pi/extensions/safety/` register no
command of their own — `workflows/index.ts` imports directly into both, and
that direct (depth-1) hop is how they were first discovered (CR-04). A
command source's import graph does not stop at depth 1, though: `routing/
index.ts` imports `./modes.ts`, and `modes.ts` — never itself a command
source, and never itself imported directly by any command file — imports
`../providers/fallback.ts` and `../providers/schema.ts`. The registry's
`importedSubsystemDirs` (`tests/unit/workflow-budgets.test.ts`) walks this
to a fixed point from every discovered command source, so a subsystem
reached only through an intermediate file — Phase 9's `/grill`, `/plan`,
`/execute` or `/review` delegating into a sibling directory two or three
files deep — is caught the same way `quality/` was, without needing its own
`registerCommand(` call anywhere in the chain. The walk is also no longer
limited to `.pi/extensions/`: a resolved import landing under any other
local `.pi/` directory (`.pi/lib`, a shared library `jsonl.ts`/`win-quote.ts`
live in today, reached by five subsystems) is ratcheted too, mapped to its
own immediate directory rather than a subsystem-root slice. An import
resolving outside `.pi/` entirely (a package specifier, a test helper) is
never ratcheted — that is not local harness code this control's own stated
scope ever claimed to cover.

**The numbers themselves are not restated here.** `tests/unit/workflow-budgets.test.ts`
is the single authoritative registry of every workflow file's budget and
every per-directory ratchet. Stating a number in this document as well would
create a second copy that could silently drift from the one the build
actually enforces — read the registry, not this paragraph, for what the
current figures are.

## 4. Evidence, not narration — and what that phrase does and does not claim

A completion claim from a model that can write plausible prose is worth
exactly as much as the structured evidence behind it. `.pi/extensions/workflows/evidence.ts`'s
gate trusts `isError` — a boolean Pi's own tool-execution machinery computes
from the real process exit code — and never trusts the model's transcript
text, which is exactly the failure shape `.pi/extensions/diagnostics/prose.ts`'s
detector exists to catch on the other end of a turn: a model that can
describe having made a tool call can equally describe having finished
successfully. `/quick` records `tool_execution_end` — not `tool_result` — for
every finalized tool call while a run is armed and started: a call
this repository's own safety layer BLOCKED, a schema-validation failure, an
unknown tool, and an abort are all reported by Pi through `tool_execution_end`
but never through `tool_result`, so a run in which one of those four occurred
is no longer structurally invisible to the gate. A capture that itself throws
(the SHA read cannot find a readable repository) is recorded as its own
synthetic FAILING entry rather than silently dropped — dropping it would
read, incorrectly, as "no failure happened." The completion verdict at
settle is computed from those records and two SHAs — never from
anything the model said.

**The `baseSha`/`headSha` rule.** `startRun` captures `HEAD` at arm time
(`baseSha`); the settle step reads `HEAD` again once the triggered turn is over
(`headSha`). The gate's first substantive check is `headSha !== baseSha` — if
`HEAD` never moved, no commit landed during the run, and every tool result
recorded is trivially "at HEAD" only because nothing was ever committed to
move it; this is what stops `bash echo hi` (or a bare `read`, not even a
command) from satisfying a completion claim on its own.

**The completion rule (D-01): a task passes when it produced a commit AND the declared verification passes at the end; intermediate non-zero exits, failed tool calls and blocked-then-approved calls are logged, not fatal.** A model that retries a failing command until it works has done the job; rejecting it for the first failure would punish ordinary debugging. Every finalized call is still recorded, and the count of failed ones is written to the evidence row (`failedToolCalls`) so the log shows what the run went through. What "declared verification" means differs per workflow. For `/execute` it is the task's verification command, checked by `checkVerification` against the call captured by tool call id: a clean run of that command at the commit being recorded is required. For `/quick` it is the deterministic change gate (`runChangeGateStage`) run once the run settles. The legs read files from disk, so `/quick` first refuses a working tree that is not the commit (uncommitted or untracked paths), exactly as `/execute` does; a clean tree is the commit, so the gate checks what was committed. A failing leg rejects the run. When no leg can check the change (a Terraform, Python or docs-only commit), the run is recorded as `unverified`, never `accept`, and the notice is a warning. Every run writes exactly one evidence row, carrying its final verdict (`accept`, `reject` or `unverified`), after every check has decided; `/execute` does the same, so a run rejected on its verification command, a dirty tree, drift or the gate never leaves an `accept` row behind. A capture that itself throws is a counted failed record, not fatal on its own, but an unreadable `HEAD` at settle still rejects.

**Settle runs on `agent_settled`, not `agent_end`.** `agent_settled` is the event that carries the `aborted` flag, which the settle step needs. An aborted settle disarms the run and records nothing: no verdict, no evidence row.

**What an ACCEPT verdict actually guarantees, stated plainly because
overclaiming here is worse than underclaiming it:** HEAD is a NEW commit
built on top of the commit recorded at arm time (`git merge-base
--is-ancestor base head`, and HEAD is not the base), its tree DIFFERS from
the tree recorded at arm time, and evidence was captured at that HEAD.
`checkout`, `switch` and `reset` move HEAD to a commit that already existed;
moving backwards or sideways is not a commit, so it REJECTS with "not a new
commit on top of <base>". A rebase onto another upstream also rejects; for
`/execute`, `--rebase-base` is the way past it.

**Only commits the run made count.** Ancestry alone would accept a `git pull`,
a merge, a cherry-pick or a `reset` forward, because each lands on a
descendant of the base. So every commit in `base..HEAD` must also have exactly
one parent (no merge commit, no root commit) and an author time AND a
committer time no earlier than two minutes before the run was armed
(`onlyCommitsSince`, `COMMIT_CLOCK_TOLERANCE_MS`). The two minutes absorb a
clock stepped back mid-run by an NTP correction or a resume from sleep. A
teammate's pulled commit, or a cherry-picked one, keeps its original author
time and rejects. Several fresh commits are accepted, so a follow-up fix
commit is not punished. The read passes `-c log.showSignature=false`,
`--no-show-signature` and an explicit `--format`, and any row that is not
`<one parent>|<author time>|<committer time>` rejects, so a signing user's
gitconfig cannot turn their own commits into rejections.

The residuals, which still pass with stock git flags: a commit someone else
made after the run was armed (or up to two minutes before), pulled in by
fast-forward; a teammate commit dated ahead of local time by clock skew;
`git rebase --ignore-date` or `--reset-author-date` of a fetched branch;
`git merge --squash other`, which makes one fresh single-parent commit of
someone else's content; `git commit -C <sha> --reset-author`; and any commit
whose dates were set with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, including an
export left in the shell, which can also falsely reject. The drift check and
the reviewer are the defences there.

**The empty-commit branch.**
`gateCompletion` (`.pi/extensions/workflows/evidence.ts`) checks, after the
`headSha === baseSha` and ancestry branches and before the evidence-at-HEAD
branch, that `headTree === baseTree`
rejects, naming both tree ids. `HEAD^{tree}` is read via
`.pi/extensions/safety/git.ts`'s `currentTree` (mirroring `currentSha`'s
fail-closed contract exactly — no sentinel for an unknown tree, throws on a
non-zero exit) at both arm time (`baseTree`) and at settle
(`headTree`). An empty commit (`git commit --allow-empty`) moves the SHA
but never the tree, and now REJECTS rather than accepting, naming both
tree ids in the reason.

**What remains open, and is a DIFFERENT, permanent limit, not a bug this
phase failed to fix:** a commit of wholly unrelated content, whose tree
genuinely DIFFERS from the tree at arm time, still ACCEPTS — deciding
whether a diff contains the CLAIMED work is a semantic judgement no
predicate over tree or SHA equality can make. `/quick`'s own notification
text says only what was checked
(`quick: HEAD moved to <sha>, a new commit on the base with a changed tree;
<n> failed tool call(s) logged; <gate legs> -- the work itself is NOT
verified`), never the stronger "evidence accepted."

## 5. The workflows and their text ceilings

Each command is a Pi command, never a tool. The ceiling is the frozen
FEATURES.md number for that workflow, summed over the command file and its
skill body (`FEATURES_CEILINGS` and `WORKFLOW_TEXT_BUDGETS` in
`tests/unit/workflow-budgets.test.ts`). Supporting modules are bound by the
per-directory ratchets instead, as section 3 explains.

| Workflow | Command file | Skill body | Ceiling |
|---|---|---|---|
| `grill` | `.pi/extensions/grill/index.ts` | `.pi/skills/grill/SKILL.md` | 250 |
| `plan` | `.pi/extensions/plan-ceremony/index.ts` | `.pi/skills/plan-ceremony/SKILL.md` | 200 |
| `execute` | `.pi/extensions/execute/index.ts` | none | 250 |
| `review` | `.pi/extensions/review/index.ts` | none | 250 |
| `quick` | `.pi/extensions/workflows/index.ts` | none | 100 |

## 6. The artifact set

`.pi/work/<slug>/` holds exactly these four files and nothing else
(`ARTIFACT_FILES` in `.pi/lib/work-artifacts.ts`;
`tests/unit/artifact-count.test.ts` drives the real write paths and compares
the directory to this list). A file with no named consumer does not ship.

| File | Consumer (verbatim from `ARTIFACT_FILES`) |
|---|---|
| `SPEC.md` | /plan (pre-flight gate: SPEC.md must exist and have passed its own ambiguity gate) and /review (requirement verdicts read against SPEC §3/§4) |
| `PLAN.md` | /execute (per-task self-contained handoff) and /review (the files-touched union is the drift baseline) |
| `REVIEW.md` | the human reviewer and the MR (requirement verdicts, findings and the checked-and-cleared section) |
| `PROGRESS.md` | /review's MR body (pasted verification evidence -- commit SHA, verification command, actual output -- per task) |

## 7. Gate depth per workflow

`GATE_DEPTH_BY_WORKFLOW` in `.pi/extensions/quality/gates.ts`. A table row
says which mechanisms the workflow is allowed to run, not that every run
exercised them. Calibration is offline only and is listed for no workflow. `/review` runs the deterministic, model-review and
refute-or-promote mechanisms on a live change and does not run calibration,
which scores seeded-defect fixtures and has no meaning for a live diff.
`/execute` runs only the deterministic mechanism, on the committed change.
`/grill` and `/plan` consult none of these; their gates are the SPEC and PLAN
validators. Each command's notice names only the mechanisms it actually runs.

The deterministic mechanism is `runChangeGateStage` in `/quick` (at settle, on the committed change once the working tree is shown to be that commit), `/execute` (on the committed change) and `/review` (at HEAD). It checks the work repo's change rather than this harness, through the four legs described in `docs/QUALITY.md`: typecheck, lint, LSP (always UNAVAILABLE) and the anti-pattern rules. A finding already present at the base commit is not counted. `/execute` and `/quick` skip the typecheck leg when it already failed on the base tree, because such a failure cannot be blamed on the change.

`/review` also decides on the MR. It resolves the merge base from remote-tracking `staging` first, then local `staging`, and otherwise refuses with a fetch hint. A Partial or Missing requirement verdict needs approval before the MR opens (a surviving BLOCKER still stops without approval), the MR body lists every verdict, and opening the MR writes one audit row (tool `glab`, event `mr_create`, no body text). The row's verdict is the classifier's: `block` only for a refusal. A glab that was allowed and then failed or timed out is `allow`, with the failure in the reason, because the MR may already exist on GitLab.

A leg that cannot run is UNAVAILABLE, never a pass. Each PROGRESS entry
carries a `Deterministic gate:` line naming every leg's status, and the MR's
Verification section shows it. When no leg ran at all (a Terraform, Python or
docs-only change, or an untrusted project), `/execute` records the task only
after the user approves with `ctx.ui.confirm`, and `/quick` writes an
`unverified` evidence row with a warning. A declined prompt, or a
session with no UI, records nothing and counts no attempt. `/review` adds
"no deterministic check applies" to the reasons that need approval before
the MR opens. A typecheck failure at `/review` time also needs approval
rather than refusing, because `/review` has no base-tree baseline. A new
anti-pattern finding refuses outright.

| Workflow | Mechanisms |
|---|---|
| `quick` | `deterministic` |
| `grill` | none |
| `plan` | none |
| `execute` | `deterministic` |
| `review` | `deterministic`, `model-review`, `refute-or-promote` |

## 8. The SPEC.md outline

`SPEC_SECTIONS` in `.pi/extensions/grill/spec-schema.ts`. Root Cause is a
conditional ninth section, required only for a change framed as a fix, and is
deliberately not a table entry.

| § | Heading | Consumer (verbatim from `SPEC_SECTIONS`) |
|---|---|---|
| 1 | Goal | every downstream reader (plan, execute, review) as the single falsifiable anchor sentence |
| 2 | Verified Codebase Facts | this module's own gateRequirementsAuthorship, which refuses §3 authorship until this section is populated with evidence |
| 3 | Requirements | /plan (each Rn becomes plan tasks) and /review (requirement verdicts are read against this section) |
| 4 | Error and Edge Behaviour | /plan (each entry becomes an acceptance case) and /review (requirement verdicts read against this section too) |
| 5 | Scope Pin | /review's drift detector, which compares the expected-files list here against the files a PLAN.md actually touched |
| 6 | Clarifications Log | a future human or agent re-reading this SPEC, so the interrogation that produced it stays auditable |
| 7 | Assumptions | /review, which must not treat an assumption stamped here as a verified fact from §2 |
| 8 | Ambiguity Scorecard | the ambiguity gate itself -- a mechanical, re-readable record of why /grill judged itself done |

## 9. The ambiguity dimensions

`AMBIGUITY_DIMENSIONS` in `.pi/extensions/grill/scorecard.ts`. While
`/grill` is armed, every turn is told its question slot (`nextQuestionSlot`)
and every SPEC.md the model writes is run through `writeSpecIfGated` at the
end of the turn: a passing SPEC is re-rendered and the interrogation ends; a
refusal is handed to the next turn. When the hard question budget runs out
without a passing SPEC, `/grill` stops with an error. A dimension still below
its floor is not overridable: SPEC.md stays refused, and `/grill --resume`
starts a fresh budget as the user's explicit choice to keep asking. `/plan`
re-gates PLAN.md the same way and stops with an error after the same hard
turn budget. Each workflow command claims the session when it arms
(`.pi/lib/active-workflow.ts`). An armed `/grill` or `/plan` stands down as
soon as another command claims it, and at `session_start`, so its per-turn
brief never reaches an unrelated turn. The overall score that is gated is the stricter of the model's own `Overall:`
value and 1 minus the mean dimension score, so every dimension at its 0.7
floor still fails the 0.2 gate.

`validateGatedSpec` in `.pi/extensions/grill/spec-gate.ts` is the one SPEC
gate. `/grill` writes through it, and `/plan`, `/execute` and `/review`
re-run it on every invocation, so a SPEC.md written directly with the write
tool is refused downstream exactly as `/grill` would refuse it.

| Dimension | Floor |
|---|---|
| `factual-grounding` | 0.7 |
| `requirement-precision` | 0.7 |
| `failure-coverage` | 0.7 |
| `scope-definiteness` | 0.7 |

## 10. Rationale the command headers were told to leave out

This section is prose. Nothing asserts it.

**Why `/plan` displaced the vendored example.** Pi's example plan mode was
vendored with a `/plan` command of its own. Two commands cannot share a name,
so the vendored copy was renamed `/plan-mode` (DEVIATION 6 in its
`PROVENANCE.md`, following the earlier `/todos` to `/plan-todos` rename)
and the name went to the ceremonial workflow. Its directory is
`plan-ceremony` for the same reason. The Pi flag namespace is separate from
the command namespace and needed no rename.

**Why `.pi/work/` is git-ignored.** The artifacts describe features of a
private work codebase, and this repository is public. They are per-feature
scratch, not harness source. In the work repo nothing ignores them, or the
harness's `.pi/logs/` and `.pi/state/`, by default. So `/grill`, `/execute`
and `/review` append whichever of the three is not yet ignored to that repo's
`.git/info/exclude` (never committed). Harness state then never shows in
`git status` and never reaches a `git add -A`. PROGRESS.md keeps
only the verification run's output, redacted and cut to its last 8,000
characters.

**Why the MR targets staging.** `main` auto-deploys. `/review` names the
target as a constant and passes it explicitly on every call; it never relies
on glab's default. The git/glab classifier is the single refuser of an absent
or protected target, and `glab mr merge` is blocked unconditionally. The MR
body is built from recorded evidence (the harness ledger's accepted
entries, described below), not from the model's account of its own work, and
carries a disclosure line. Because glab opens the MR for the pushed branch,
`/review` refuses unless every PLAN task has an accepted entry, every
recorded commit is on HEAD's history, the last recorded commit is HEAD, and
`<remote>/<current branch>` is HEAD. The remote is the branch's configured
remote, or `origin`. `/review` passes that branch to glab as
`--source-branch`, so the MR opens from the branch that was checked rather
than whatever `@{u}` happens to track. The check reads the local
remote-tracking ref, which is only as fresh as the last push or fetch.

**Why the drift check is computed.** Scope drift is the difference between
`git diff --name-only <base>..HEAD` and the union of SPEC's expected files and
PLAN's files-touched, in both directions: drifted (changed, not declared) and
undelivered (declared, not changed). The reviewer cannot supply it, and a
review artifact that carries a model-supplied drift field is rejected. An
empty declaration makes every change drift. `/execute` measures drift from
the last accepted entry, or from the base it pins on a slug's first run,
never from the HEAD of a fresh attempt: a rejected or halted commit stays in
every later diff until it is reverted.

A rebase onto `staging`, or a legitimate commit of the user's own to an
undeclared file, would otherwise HALT every later `/execute` and refuse
`/review`. The recovery is `/execute <slug> --rebase-base`, and only the user
can approve it. It shows the paths changed since the base that SPEC and PLAN
do not declare, and the pinned and current write allowance, through
`ctx.ui.confirm`. On approval it records a new base at HEAD, with the current
allowance, in the ledger. It never prompts the model. `/review` then exempts
entries recorded before the re-pin from the "on HEAD's history" check, treats
the re-pinned commit as the last verified point, and adds a line to the MR's
Verification section saying the earlier entries were verified on commits a
rebase may have replaced. An intended SPEC/PLAN change with no rebase uses
`--repin` instead (below), so it never reads as one.
`/review` diffs from `git merge-base HEAD staging`, and any drifted path needs
explicit approval before the MR opens. It reads the
committed diff only, and `/review` refuses to start while any non-ignored
path is uncommitted or untracked. A rename
reports both paths (`--no-renames`), so a move out of an undeclared path
drifts.

**Why `/execute` appends only after these checks.** The PROGRESS.md append
happens only when the unmodified `gateCompletion` accepts, a bash call whose
command equals the task's verification command ran cleanly at the commit
being recorded (seen on `tool_execution_start`, since `tool_execution_end`
carries no arguments), and `driftAbort` allows every path git reports as
changed. PROGRESS.md records that run's own output and exit code, bound to a
harness-read commit SHA; no other tool output is kept. The verification run
and the settle gate both run on the working tree, so both require
`git status` to be clean (harness state is ignored, as above): a file the model forgot to `git add` would otherwise let a check
pass that the commit cannot. Each rejection is logged. Once a task passes
`REVISION_CAP` rejections, or two deterministic-gate rejections in a row fail
to lower the gate's finding count, `/execute` refuses it until the user runs
`/execute <slug> --reset`. Any other rejection has no count, so it never
reads as a stall. `gateCompletion` rejects a run with any failed tool result,
so a red-then-green test loop inside one attempt is rejected; the brief tells
the model not to run a check it expects to fail. The
shared workflows
settle handler stands aside while an `/execute` run is armed, so the result
does not depend on extension load order, which Pi takes from an unsorted
directory listing. An `/execute` run whose `agent_settled` never arrived is
cleared at `session_start`, and `/quick` clears one before it arms, because
an `/execute` slot with no shared run armed can only be a leak.

**Why the record is a signed ledger, not PROGRESS.md.** The executor can
write any file, so state kept in PROGRESS.md could be edited to erase the
revision cap, move the drift base or add a finished task. `/execute` keeps
that state in `<git common dir>/kypi-ledger/<slug>.<worktree>.jsonl`,
outside the work tree. `<worktree>` is a short hash of the worktree's top
level, so another worktree of the same repo never inherits a slug's rows. The
ledger outlives `.pi/work/<slug>/`, so `/grill` refuses a new task whose slug
still has a ledger in this worktree and names the file. Deleting that file
yourself is the way to reuse the description. This covers the pinned base, the write allowance pinned with it,
rejections, resets, and each accepted entry's full text. Every row is
HMAC-SHA256 signed with a random key in the same directory, and carries its
slug inside the signed body. A row that fails its signature refuses
`/execute` and `/review` outright. A missing key beside existing rows is a
refusal, never a fresh start. PROGRESS.md is a readable copy. Done-task
detection, the drift base, the revision cap and the MR's Verification
section all read the ledger, so an entry typed into PROGRESS.md changes
nothing. `/execute` and `/review` also refuse when SPEC's expected files and
PLAN's files-touched no longer match the allowance pinned with the base, so
a model cannot widen its own allowance to absorb drift.

The task list and the SPEC are pinned the same way. The base row also
records each task's full line (its description), requirement ids, path and
verification command, and a SHA-256 of SPEC.md. `.pi/work/` sits in the work
tree and the model writes SPEC.md and PLAN.md during `/grill` and `/plan`, so
it cannot be a protected path; instead `/execute` and `/review` refuse when
PLAN.md's tasks or SPEC.md differ from the pin (a later task's description
rewritten, a requirement id moved, a verification command changed, a task
deleted or added, any SPEC edit). The next brief is therefore only ever built
from pinned content, and the verification command an attempt is checked
against is the pinned one, fixed when the run is armed.

A legitimate SPEC or PLAN edit (fixing a wrong verification command for a task
not yet run, say) is accepted with `/execute <slug> --repin`. It shows the
pinned and current allowance, task lines and whether SPEC.md changed through
`ctx.ui.confirm`, and on approval appends a `pin` row. A `pin` row never moves
the drift base and is not a rebase: `/review` keeps checking every recorded
commit against HEAD's history and adds no rebase line to the MR.
`--rebase-base` also re-pins this content, alongside the base. A ledger
written before the full task line and SPEC hash were pinned refuses until it
is re-pinned.

The key is protected by the safety path guard, not by the operating system.
Any `read`/`write`/`edit` path, or any bash argument, that passes through a
`kypi-ledger` segment is refused. A process that reads the key by a route
that guard does not see could forge rows. That covers the published bash
residuals in docs/SAFETY.md, such as a glob (`.git/kypi*/key`), a variable,
or an interpreter that builds the path at run time.

**Why the handoff probe reports `UNAVAILABLE`.** `pi-subagents` is pinned
and not installed. The probe checks for the minimum tools a handoff needs and
never reads the settings file, so on a machine without them `/execute`
degrades to the ordinary prompt loop and says so. A "delegated" label on that
path would be a false claim.

**What these do and do not prove.** The offline tests prove the gates, the
renderers, the argv classification and the packet arithmetic against scripted
input and temp git repositories. They do not prove that a model drives the
four commands well, that GitLab accepts the MR, that the installed glab
accepts `--description`, or that a subagent spawns. The packet-size
figure of -447 estimated tokens (134 against 581, `Math.ceil(chars / 4)`, not
a tokenizer) is one fixture's estimate, and the tests assert its arithmetic,
never its sign.

## 11. Status

OUTSTANDING: `RB-09-01` (one real feature end to end on the work laptop),
`RB-09-02` (a real `glab mr create --target-branch staging`) and `RB-09-03`
(a real `pi-subagents` handoff and the live token delta). No feature has
shipped end to end through this workflow, and no subagent has ever spawned.
Requirements FLOW-08 and FLOW-09 are therefore partial.
