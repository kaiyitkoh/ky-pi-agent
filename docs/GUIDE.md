# Guide: using ky-pi-agent day to day

This is the tutorial. Install first (`docs/RUNBOOK.md`, "Work laptop: start
here"); the reference docs are linked at the end of each section.

## 1. First launch

Start Pi in any git repository from Git Bash:

```
cd ~/work/my-service
pi
```

The header shows two lines:

```
ky-pi-agent 0.1.0 · pi 1.1.0 · cheap
/ commands · ! bash · esc interrupt
```

A fresh session starts in `cheap` mode and puts its executor,
`deepseek/deepseek-flash`, on the session (or `dashscope/deepseek-v4-flash`
without a DeepSeek key). Passing `--model`, `--provider` or `--models` keeps
your model instead.

Pi's own footer shows model, context percentage, session cost, git branch and
cache hits. The harness adds one `ky-statusline` segment on its third line:

```
cheap · 950k left · 2 changed · 1 agent
```

| Part | Meaning |
|---|---|
| `cheap` | Current mode. `cheap↑` means `/escalate` is on. |
| `950k left` | Tokens left in the context window. |
| `2 changed` | Uncommitted files in the repo (yellow when above 0). |
| `1 agent` | Running subagents; hidden when none. |

Check that everything resolved:

```
/mode
```

```
mode: cheap (not escalated)
executor: deepseek/deepseek-flash
planner: deepseek/deepseek-flash
reviewer: deepseek/deepseek-flash
advisor: deepseek/deepseek-v4-pro
vision: amazon-bedrock/apac.anthropic.claude-sonnet-4-5-20250929-v1:0
summariser: deepseek/deepseek-flash
```

A role whose provider has no key shows `unavailable (...)` with the reason.
`/ky-hello` confirms the harness loaded at all.

## 2. A typical day

### A small fix: `/quick`

Use it for anything you could describe in one sentence. Work on a feature
branch with a clean tree:

```
!git switch -c fix/usage-typo
/quick fix the typo "recieve" in the usage string in src/cli.ts
```

`/quick` checks the route, the branch and the tree, then hands the task to the
model with one rule: end in exactly one atomic commit. When the agent settles,
the deterministic gate (typecheck, lint, anti-pattern rules) runs on the
committed change and you see one of:

- `quick: HEAD moved to <sha>, a new commit on the base with a changed tree; ... -- the work itself is NOT verified`:
  accepted. The gate passed; read the diff yourself.
- `quick: UNVERIFIED -- ...`: committed, but no check applied (for example a
  Terraform or docs change).
- `quick: ...` in red: rejected, with the reason (no commit, a dirty tree, a
  gate failure).

Every outcome is a row in `.pi/logs/evidence-*.jsonl`.

### A feature: `/grill`, `/plan`, `/execute`, `/review`

Artifacts live in `.pi/work/<slug>/`: `SPEC.md`, `PLAN.md`, `PROGRESS.md`,
`REVIEW.md`, nothing else.

**1. `/grill`** interrogates the request before any code exists:

```
!git switch -c feat/json-export
/grill add a --json flag to the export command
```

The slug is derived from the text (`add-a-json-flag-to-the-export-command`).
The model reads the code first, then asks at most 5 questions, one per turn,
each from a different perspective. Answer in plain text. It writes `SPEC.md`
only when the gate accepts it: a Verified Codebase Facts table with file:line
evidence, requirements, `IF <condition> THEN THE SYSTEM SHALL <response>` error
behaviour, and an expected-files list. If the budget runs out first, continue
with `/grill --resume`.

**2. `/plan`** turns the gated SPEC into tasks:

```
/plan add-a-json-flag-to-the-export-command
```

Each task line is `T### [P] [R#] verb <path>` plus a verification command,
and every requirement must be covered. The model gets 6 turns to produce a
`PLAN.md` that passes; run `/plan` again to continue.

**3. `/execute`** runs one task at a time:

```
/execute
```

With one plan in the repo the slug is optional. Each run takes the next task
without a PROGRESS entry, delegates it to the `executor-handoff` subagent when
`pi-subagents` is available (otherwise runs it in this session), and records
it only when there is one atomic commit, the verification command exits 0 on
that commit, and only declared files changed. Repeat until it says
`every PLAN task already has a PROGRESS entry`.

| Flag | When |
|---|---|
| `--reset` | A task is escalated after repeated rejected attempts; inspect it first. |
| `--repin` | You edited SPEC or PLAN on purpose; you confirm the new content. |
| `--rebase-base` | You rebased or committed yourself; you confirm the moved base. |

**4. Push, then `/review`:**

```
!git push -u origin feat/json-export:feat/json-export
/review
```

`/review` reruns the deterministic gate, sends a fresh-context reviewer the
diff, every touched file, the gate report, the requirements and the import
graph, refutes or promotes every BLOCKER, and adds a design-level pass when a
signal fires (8 or more files, a query in a loop, a schema or migration path,
an added or removed export, or `/escalate`). It writes `REVIEW.md`, then opens
an MR with `glab` against `staging`, never `main`. A Partial or Missing
verdict, scope drift or a symptomatic fix asks `Open the MR anyway?` first; a
surviving BLOCKER stops it. Docs: `docs/WORKFLOWS.md`, `docs/QUALITY.md`.

## 3. Modes and models

| Command | Executor | Planner | Reviewer | Advisor |
|---|---|---|---|---|
| `/cheap` (default) | Flash | Flash | Flash | V4 Pro |
| `/balanced` | Flash | V4 Pro | V4 Pro | Sonnet 4.5 |
| `/max` | V4 Pro | Sonnet 4.5 | Sonnet 4.5 | Sonnet 4.5 |

Vision is Sonnet 4.5 in every mode. The summariser is Flash, or V4 Pro in
`max`. Each DeepSeek route tries DeepSeek-direct, then DashScope.

Prices from Pi's catalogue and the Bedrock template, USD per million tokens:

| Model | Input | Output | Cache read |
|---|---|---|---|
| DeepSeek Flash (`deepseek-flash`) | 0.30 | 1.20 | 0.006 |
| DeepSeek V4 Pro | 1.32 | 3.96 | 0.044 |
| Claude Sonnet 4.5 (Bedrock) | 3.30 | 16.50 | 0.33 |

DashScope prices are placeholders (0) until `RB-03-05` records them, so its
turns log a cost of 0. Cache reads are about 50 times cheaper than fresh input,
which is why nothing volatile ever enters the system prompt.

- `/balanced` before a review-heavy session; `/max` for a hard design problem.
- `/escalate` lifts only the executor to V4 Pro and stays on until
  `/escalate off`; it also makes `/review` run the design pass.
- `/mode` shows the result. A switch is refused, and the session left alone,
  when the target model has no key or fails the capability guard.
- `/model` still works, but a switch to a model that cannot do the job (an
  image for a text-only model, thinking Bedrock would drop, R1 as executor) is
  reverted with the reason.

Docs: `docs/ROUTING.md`.

## 4. Safety prompts, and how to answer them

The guard is a mistake-catcher; GitLab's branch protection is the real control.
Most refusals are plain blocks the model reads and works around. These ask you:

| Prompt | Why | Answer |
|---|---|---|
| `Allow this git push?` | A push to a non-protected branch. Shows the command and the resolved remote and branch. | Yes only if the branch is the one you meant. It times out (refuses) after 5 minutes. |
| `Approve this command?` (Approve / Deny) | The model called `approve_ky_command` for a blocked `terraform apply`, mutating `aws` or `kubectl delete`. Shows the command, the model's summary and blast radius, and the block reason. | Read the command, not the summary. Approve covers that exact command once, for 10 minutes; the model then re-issues it. |
| `Allow this change to extension code?` | A write under `.pi/extensions`, `.pi/npm`, `~/.pi/agent/extensions` or to `~/.pi/agent/models.json`, which Pi runs with full permissions. | Usually no, unless you asked for that change. |
| `Allow this subagent definition change?` | The model asked `pi-subagents` to change an agent definition or a schedule. | Usually no; agent definitions are edited by you. |
| `Restore code state to this checkpoint?` | You ran `/fork` at a point with a checkpoint. | Yes to rewind files with the conversation. |
| `Record with no deterministic check?` | `/execute`: no gate leg applies (for example Terraform). | Yes if you checked the change yourself. |
| `Re-pin the SPEC and PLAN?`, `Re-pin the drift base?` | `/execute --repin`, `--rebase-base`. | Yes if the listed changes are yours. |
| `Open the MR anyway?` | `/review` found doubts (listed). | Only if every listed reason is acceptable. |

Never prompted, always blocked: pushes to `main`, `master`, `staging` or any
branch in `safety.protectedBranches`; force and tag pushes; any write while
`HEAD` is protected (`run "git switch -c <new-branch>" as its own command
first`); `glab mr merge`; reads of `.env`, `~/.aws/credentials`, kubeconfig and
`*.tfstate`; writes outside the repo; a code runner reading a pipe
(`curl ... | sh`); heredocs. In `pi -p`, `--mode json` and subagents every
prompt above is refused, because nobody can answer. Your own `!` commands are
not guarded. Docs: `docs/SAFETY.md`.

## 5. Subagents

From `pi-subagents` 0.76.1, with two agents from this repo:

- `planner`: read-only (`read`, `grep`, `find`, `ls`), produces a plan; its
  model follows the mode.
- `executor-handoff`: runs one `/execute` task from a self-contained packet.

```
/run planner plan adding retries to src/http/client.ts --bg
/subagents-fleet
/subagents-steer <run-id> also cover the timeout path
/subagents-stop <run-id>
```

The model can also spawn them with the `subagent` tool and wait with
`bg_wait`. Every child loads the safety guard (a launch is refused if it
cannot), and a push that would ask is refused in a child. `/subagent-cost`
shows what the children spent. Docs: `docs/EXTENSIONS.md`.

## 6. Background tasks, LSP, web, session search, checkpoints

| Feature | Use |
|---|---|
| Background tasks | `/bg npm run dev`, `/jobs`, `/logs <id>`, `/kill <id>`, `/tasks`. The model calls `bg_enable` first to load `bg_run`, `bg_status`, `bg_logs`, `bg_kill`. A command that needs approval is refused in `bg_run`; run it through `bash`. |
| LSP | The model calls `lsp_diagnostics` (all profiles but `recon`); `lsp_fix` is in `full`. `/lsp` shows the server config. |
| Web | Keyless search and fetch. Active in `recon` and `full`; in `implement` the model calls `web_enable` first. `/search` browses stored results. |
| Session search | `/find retry backoff` searches every session in every project and jumps to a match; `/find-back` jumps back. |
| Checkpoints | A working-tree checkpoint is taken at every turn (200 kept). `/checkpoint-restore` lists them; `/checkpoint-restore 3f2a9c1e` restores one, deleting files absent from it, and prints `undo with /checkpoint-restore <sha>`. |
| Undo a conversation | Pi's `/tree` and `/fork`; `/fork` offers to restore files too. |
| Plan mode | `/plan-mode` or Ctrl+Alt+P toggles read-only exploration; `pi --plan` starts in it; `/plan-todos` shows progress. |
| Todos | The model keeps a list with `todo`; `/todos` shows it. |

## 7. OpenSpec (opt-in)

Nothing is installed by bootstrap. To opt in:

```
sh scripts/openspec-setup.sh --install-cli
sh scripts/openspec-setup.sh
sh scripts/openspec-setup.sh --check
```

In a work repo, `openspec init --tools none`, then `/skill:openspec-explore` or
`/opsx-propose`. The skills cost nothing per turn until invoked; telemetry is
off. `openspec init` and `update` go through the approval prompt. Docs:
`docs/OPENSPEC.md`.

## 8. `/budget` and diagnostics

```
/budget
```

prints the per-turn token floor: system prompt (base, context files, skills),
tool schemas with the largest first, the last turn's `cacheRead` vs `input`,
and how many turn rows this session wrote. Logs, all redacted and gitignored,
under `.pi/logs/` of the repo you work in:

| File | Holds |
|---|---|
| `wire-<date>.jsonl` | Every provider request and response. |
| `turns-<date>.jsonl` | One row per turn and nested call: model, tokens, cost, latency, cache ratio, quality cost. |
| `audit-<date>.jsonl` | Every safety allow and block. |
| `evidence-<date>.jsonl` | Every `/quick` and `/execute` verdict. |
| `escalation-<date>.jsonl` | Every `/escalate` on and off. |

The most expensive turn today:

```
grep '"kind":"turn"' .pi/logs/turns-$(date +%F).jsonl | node -e 'let m=null;require("readline").createInterface({input:process.stdin}).on("line",l=>{const r=JSON.parse(l);if(!m||r.cost.total>m.cost.total)m=r}).on("close",()=>console.log(m.model,m.cost.total,m.corr))'
```

Machine health: `sh bin/bootstrap.sh --check-only` (changes nothing, needs the
network) and `sh bin/bootstrap.sh --assert-hardening`. Cache stability:
`sh scripts/ui-wire-check.sh --session <id> --probe <text>`. Docs:
`docs/DIAGNOSTICS.md`.

## 9. Tool profiles: `--ky-profile`

Chosen once per session; a smaller set costs fewer tokens on every turn.

| Profile | Active tools (besides `read`, `bash`, `approve_ky_command`, `web_enable`) | Floor |
|---|---|---|
| `recon` | web search and fetch; no `edit` or `write` | 1,699 tok |
| `review` | `consult_advisor`, `lsp_diagnostics`, subagent tools | 1,827 tok |
| `implement` (default) | `review`'s set plus `edit`, `write`, `todo`, `bg_enable` | 2,342 tok |
| `full` | everything: web, `lsp_fix`, the `bg_*` tools, `questionnaire`, `qoder_delegate` | 4,106 tok |

```
pi --ky-profile recon
```

Change profile by starting a new session: a mid-session tool change re-prices
the cached prefix. An explicit `--tools` list turns profiles off. Profiles are
a cost control; the guard still checks every call.

## 10. Getting reliable output from DeepSeek Flash

- Name the file and the expected result: "in `src/cli.ts`, make `--help` exit
  0", not "fix the help".
- Small and scoped goes through `/quick`; anything you would have to explain
  twice goes through `/grill` first. The questions are the cheap part.
- Give every PLAN task a verification command that really tests it; the
  evidence gate believes exit codes, not prose.
- Keep the tree clean and stay on a feature branch, so the gates check only
  the model's change.
- Stuck on a decision? Ask it to `consult_advisor`. Stuck on the whole task?
  `/escalate`, then `/escalate off`.
- Stay in `implement`; avoid `/model` and profile changes mid-session, which
  break the prompt cache.
- Run `/compact` before the context fills; the statusline shows what is left.
- A prose tool call is re-prompted once; loop police nudges a repeating loop.
  If you see either often, the task is too vague.

## 11. Ten common problems

| Symptom | Fix |
|---|---|
| `/mode` or `/quick` is an unknown command in a work repo | `sh bin/bootstrap.sh --global-setup`, then `pi list` should show `(filtered)`. |
| `default mode cheap: executor not applied: ...` | No DeepSeek or DashScope key in this shell: `RUNBOOK.md` step 3, then a new Git Bash window. |
| Every tool call blocked: `ky-safety: the safety extension at <path> is missing` | The checkout moved: re-run `sh bin/bootstrap.sh` from where it is now. |
| Pi exits at start with `Cannot find module 'unbash'` | `sh bin/bootstrap.sh` (it runs `npm ci`), restart Pi. |
| Pi exits at start: `Tool "bash" conflicts with ...` | Two copies of the harness: `pi remove` the git package. |
| `quick: the working tree has uncommitted or untracked changes (...)` | `git stash -u` or commit, then retry. |
| `HEAD is "main" (protected) ...` | `!git switch -c feat/<name>`, then retry. |
| `quick: session model is not the routed executor (...)` | You changed `/model`; run `/cheap` (or your mode). |
| `... a turn is already in flight ...` with nothing running | `/reload`. |
| `AWS SSO credentials are expired or missing. Run: aws sso login --profile <name>` | Run that command; restart Pi if the next turn still fails. |

More, including Bedrock and DashScope errors, in `docs/RUNBOOK.md` section 11.
