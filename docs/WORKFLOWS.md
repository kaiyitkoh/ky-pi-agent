# Workflows — `/quick`'s rationale, evicted from its own header

`.pi/extensions/workflows/index.ts` carries a header short enough to fit the
line budget this document explains. The reasoning that header cannot hold
lives here instead — relocated, not deleted. If the header reads thin, follow
its pointer here.

**The contract of this file.** As with `docs/SAFETY.md` and `docs/ROUTING.md`,
if the code and this document disagree, the code is authoritative and this
document is a bug. Fix the document; do not fix the code to match the
document.

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

`/quick`'s handler runs seven checks, in this exact order, and the order is
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
   (not a second `/quick`) would silently arm anyway, and `agent_end` would
   attribute that other turn's tool results (and its accept/reject verdict)
   to a task `/quick` never actually commissioned.
5. **Arm the evidence run.** `startRun` records the working directory and the
   SHA that is `HEAD` right now, before any work happens.
6. **Hand the task to the ordinary prompt loop.** `/quick` does not run a
   second, nested model call for the work itself — `runSingleShotRole` is
   built for the four single-shot roles only and throws when handed the
   `executor` role by design [modes.ts:401-406]. The task the command was
   given becomes a message sent through `pi.sendUserMessage`, which the
   session's own prompt loop — the model `/cheap`/`/balanced`/`/max` already
   selected — then acts on with its own tool calls, exactly as it would for
   any other prompt.
7. **Gate at `agent_end`, not at an awaited idle.** A command handler's
   `ctx.waitForIdle()` exists, but in a headless session it is bound to a
   no-op that resolves immediately [runner.js:260] — a `/quick` that awaited
   it would evaluate the completion gate before the model had done anything
   at all, and would look correct while proving nothing. Pi's own `agent_end`
   event is what actually fires once the triggered turn is over, in both
   interactive and headless sessions, so the gate is wired there instead. The
   SHA read at this point is defensive: `currentSha` fails closed by design
   (throws rather than returning a sentinel), so a repository that becomes
   unreadable mid-run (a destructive command, a transient `index.lock`) must
   still produce a REJECT verdict and disarm the run, never leave `/quick`
   silently and permanently armed.

Two Pi event handlers do the remaining work: one records every `tool_result`
seen while a run is armed, and one calls `endRun` when `agent_end` fires,
reporting whatever verdict comes back and disarming the run either way.

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

**The budget is enforced per file, and as a directory aggregate.** A file
close to its own limit could be "fixed" by moving logic into a private helper
that only `/quick` ever calls — same total code, smaller number on the one
file a reviewer checks. The aggregate exists so that move does not shrink
anything that matters: raising it requires a deliberate edit to a committed
number, in the same commit as the growth that needs it, the same discipline
this repository already applies to a runbook status. A helper module that
would exist on its own merits, with its own tests, independent of `/quick`,
is a different thing than an offloading helper — but "legitimate" is a
judgement no test can make on its own, which is why the aggregate is the
mechanism that actually holds the line, not a promise.

**The numbers themselves are not restated here.** `tests/unit/workflow-budgets.test.ts`
is the single authoritative registry of every workflow file's budget and the
directory aggregate. Stating a number in this document as well would create
a second copy that could silently drift from the one the build actually
enforces — read the registry, not this paragraph, for what the current
figures are.

## 4. Evidence, not narration — and what that phrase does and does not claim

A completion claim from a model that can write plausible prose is worth
exactly as much as the structured evidence behind it. `.pi/extensions/workflows/evidence.ts`'s
gate trusts `isError` — a boolean Pi's own tool-execution machinery computes
from the real process exit code — and never trusts the model's transcript
text, which is exactly the failure shape `.pi/extensions/diagnostics/prose.ts`'s
detector exists to catch on the other end of a turn: a model that can
describe having made a tool call can equally describe having finished
successfully. `/quick` records only structured `tool_result` events while a
run is armed, and the completion verdict at `agent_end` is computed from
those records and two SHAs — never from anything the model said.

**The `baseSha`/`headSha` rule.** `startRun` captures `HEAD` at arm time
(`baseSha`); `agent_end` reads `HEAD` again once the triggered turn is over
(`headSha`). The gate's first substantive check is `headSha !== baseSha` — if
`HEAD` never moved, no commit landed during the run, and every tool result
recorded is trivially "at HEAD" only because nothing was ever committed to
move it; this is what stops `bash echo hi` (or a bare `read`, not even a
command) from satisfying a completion claim on its own.

**Any recorded failure rejects, regardless of when HEAD moved.** If ANY
tool result recorded during the run has `isError === true`, the run rejects
— even if a commit landed afterwards. This check runs BEFORE the SHA
narrowing precisely so a verification failure cannot be "aged out" of
relevance by a later commit: within one `/quick` run, every recorded result
belongs to the same task, and a failure recorded at the pre-commit SHA is
still a fact about that task after the commit lands.

**What an ACCEPT verdict actually guarantees, stated plainly because
overclaiming here is worse than underclaiming it:** a commit landed during
the run, made through a tool call Pi's own machinery executed and that
exited 0, and no tool result recorded anywhere in the run carried a
structured failure. **What it does NOT guarantee:** that the commit's diff
contains the claimed work, or that anything was meaningfully verified at
all. An empty commit (`git commit --allow-empty`) and a commit of wholly
unrelated content both still ACCEPT, because distinguishing "the commit
contains the work" from "the commit is empty" needs a diff or a tree hash,
which this phase does not have — that is Phase 8's job. `/quick`'s own
notification text says this directly on acceptance
(`quick: a commit landed at <sha> with no failed tool result -- the work
itself is NOT verified`) rather than the stronger, and false, "evidence
accepted."
