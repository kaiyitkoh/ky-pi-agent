# ky-pi-agent

A personal coding-agent harness built on [Pi](https://pi.dev). It makes a cheap
model (DeepSeek V4 Flash) produce work you would trust from an expensive one.

**Status: work in progress.** Everything below is built and proven offline by
the test suite. The live checks (real providers, the work laptop, a real
GitLab) are listed in `docs/RUNBOOK.md` and are still **OUTSTANDING**.

## What this is

Extensions, agents, a theme and templates over Pi 1.1.0: routing, safety,
evidence-gated workflows, quality gates and diagnostics. Commands cost zero
tokens per turn, so almost everything is a command. Day-to-day use is in
[docs/GUIDE.md](docs/GUIDE.md).

## Capabilities

| Area | Name | What it does |
|---|---|---|
| Workflow | `/quick <task>` | Small task, one atomic commit, deterministic gate at settle, evidence row. |
| Workflow | `/grill <description>`, `/grill --resume` | Up to 5 questions, one per turn, into a gated `SPEC.md`. |
| Workflow | `/plan [slug]` | Gated SPEC into `PLAN.md`: `T###` tasks, each with a path and verification command. |
| Workflow | `/execute [slug]` | Next PLAN task, evidence-gated, appends `PROGRESS.md`; `--reset`, `--repin`, `--rebase-base`. |
| Workflow | `/review [slug]` | Gates, model review, refute-or-promote, design pass on signals; `REVIEW.md`; MR to `staging`. |
| Mode | `/cheap` (default), `/balanced`, `/max` | Switch the whole role-to-model map and the subagent pins. |
| Mode | `/escalate`, `/escalate off` | Lift the executor to `max`'s model, sticky until cleared. |
| Mode | `/mode` | Show mode, escalation and every role's resolved model. |
| Route | executor | Flash (`cheap`, `balanced`), V4 Pro (`max`). |
| Route | planner, reviewer, advisor, summariser | Flash, V4 Pro or Claude Sonnet 4.5 by mode; see `docs/ROUTING.md`. |
| Route | vision | Claude Sonnet 4.5 on Bedrock in every mode, prefix `kyPiAgent.bedrockProfilePrefix` (default `apac.`). |
| Route | fallback | Reviewer, advisor, vision, summariser calls retry DeepSeek-direct, then DashScope, on quota or outage errors. The executor takes the first candidate with a key. |
| Route | capability guard | Refuses images to text-only models, oversized prompts, thinking Bedrock would drop, R1 as executor. |
| Safety | bash AST guard | `unbash` parse; refuses indirection, `$(...)`, nested shells, heredocs (`docs/SAFETY.md`). |
| Safety | strict pipe rule | Any code runner (`sh`, `python`, `node`, `psql`, ...) reading a pipe is refused. |
| Safety | protected branches | `main`, `master`, `staging` built in, add more in settings; no writes or pushes there. |
| Safety | push confirm | Feature-branch push asks (5 min timeout); refused in print, json and subagents. |
| Safety | infra confirm | `terraform apply`, mutating `aws`, `kubectl delete`: blocked until `approve_ky_command` is approved. |
| Safety | path guard | Blocks reads of `.env`, `~/.aws/credentials`, kubeconfig, `*.tfstate`; writes outside the repo. |
| Safety | audit log | Every allow and block in `.pi/logs/audit-*.jsonl`. |
| Safety | fail-closed stub | User-scope stub blocks every tool call if the guard cannot load. |
| Gate | evidence gate | Completion is judged on tool exit codes and the git SHA, never on transcript text. |
| Gate | deterministic stage | typecheck, lint, LSP (always UNAVAILABLE), six anti-pattern rules on the change. |
| Gate | reviewer | Per-requirement verdicts, BLOCKER/WARNING/NIT, "checked and cleared", root-cause class. |
| Gate | prose-tool-call retry | Re-prompts once when the model writes a tool call as text. |
| Gate | loop police | Detects repeated tool loops; `/loop-police` (`reset`, `set KEY=VAL`, `save`). |
| Gate | comment rules | WHY-only comment rules injected into every project's system prompt. |
| Subagent | `planner` | Read-only plan, model pinned by the mode (`.pi/agents/planner.md`). |
| Subagent | `executor-handoff` | Runs one `/execute` task from a handoff packet (`.pi/agents/executor-handoff.md`). |
| Subagent | `pi-subagents` 0.76.1 | `/run`, `/subagents`, `/subagents-fleet`, `/subagents-steer`, `/subagents-stop`; every child loads the guard. |
| Tool | `read`, `bash`, `edit`, `write` | Pi built-ins, wrapped so the guard re-checks the arguments that execute. |
| Tool | `approve_ky_command` | Asks you to approve one blocked command; one-shot, 10 minute expiry. |
| Tool | `consult_advisor` | One nested call to a stronger advisor at a decision point. |
| Tool | `todo` / `/todos` | Todo list on the current branch. |
| Tool | `bg_enable`, `bg_run`, `bg_status`, `bg_logs`, `bg_kill`, `questionnaire` | Background shell tasks and structured questions, loaded on demand. |
| Tool | `lsp_diagnostics`, `lsp_fix` | LSP diagnostics (`@narumitw/pi-lsp`); `/lsp` shows the config. |
| Tool | `web_search`, `fetch_content`, `get_search_content`, `source_check`, `web_enable` | Keyless web lookup (`pi-web-access`); `/search`, `/websearch`, `/curator`. |
| Tool | `subagent`, `bg_wait`, `subagent_supervisor`, `subagents_enable` | Spawn, wait for and steer subagents. |
| Tool | `qoder_delegate` | Hands a whole task to Qoder Cloud Agents (`full` profile only, a foreign agent). |
| Other | `/plan-mode`, `pi --plan`, Ctrl+Alt+P | Read-only plan mode; `/plan-todos` shows its progress. |
| Other | `/bg <cmd>`, `/jobs`, `/logs <id>`, `/kill <id>`, `/tasks`, `/bg-tasks`, `/bg-clear` | Background task commands. |
| Other | `/checkpoint-restore [sha]` | List per-turn working-tree checkpoints, or restore one (prints its undo SHA). |
| Other | `/find <words>`, `/find-back` | Search every session (`pi-session-finder`). |
| Other | `/budget` | Per-turn token floor: system prompt, tools, context files, skills, cache. |
| Other | `/ky-hello` | Harness liveness check. |
| Profile | `pi --ky-profile recon\|review\|implement\|full` | Tool set per session; `implement` is the default. |
| UI | `ky` theme, header, `ky-statusline` | Header: versions and mode. Footer adds mode, tokens left, changed files, agents. |
| Opt-in | OpenSpec | `sh scripts/openspec-setup.sh`; `/skill:openspec-<name>`, `/opsx-<name>`, zero per-turn cost. |

## Install

Node >= 22.19.0, and Git Bash on Windows. The full procedure, including keys
and Bedrock, is `docs/RUNBOOK.md`, section "Work laptop: start here".

**Path B (recommended): clone and bootstrap.**

```
git clone https://github.com/kaiyitkoh/ky-pi-agent && cd ky-pi-agent
sh bin/bootstrap.sh
sh bin/bootstrap.sh --check-only
pi list
```

`pi list` shows the four npm packages and `<checkout path> (filtered)`: the
harness package with `!.pi/extensions/safety/**` filtered out, because the
safety stub already loads the guard.

**Path A:** `pi install git:github.com/kaiyitkoh/ky-pi-agent@v1.0.1`. The two
paths are alternatives, so pick one delivery path, never both: two copies of
the guard can diverge, and `--check-only` fails when both are configured.

## Documentation

- [docs/GUIDE.md](docs/GUIDE.md): how to use it day to day
- [docs/RUNBOOK.md](docs/RUNBOOK.md): install, live checks, troubleshooting
- [docs/ROUTING.md](docs/ROUTING.md): role-to-model table, modes, refusals, tool profiles
- [docs/SAFETY.md](docs/SAFETY.md): what the guard catches, and what it does not
- [docs/WORKFLOWS.md](docs/WORKFLOWS.md): `/quick` and the four ceremonial workflows
- [docs/QUALITY.md](docs/QUALITY.md): deterministic gates, reviewer, calibration
- [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md): logs, redaction, per-turn floor
- [docs/EXTENSIONS.md](docs/EXTENSIONS.md): provenance of every pinned or vendored extension
- [docs/UI.md](docs/UI.md): theme, header, statusline
- [docs/OPENSPEC.md](docs/OPENSPEC.md): the opt-in OpenSpec skills
- [CONTRIBUTING.md](CONTRIBUTING.md): the boundary rule for tools vs commands; `AGENTS.md` for code conventions

## Supply chain

Pi installs extensions without `--ignore-scripts`, so a package's npm lifecycle
scripts run with your permissions. `ignore-scripts=true` is set in the repo
`.npmrc`, `.pi/npm/.npmrc`, and (by `bin/bootstrap.sh`) `~/.pi/agent/npm/.npmrc`.
Verify with `sh bin/bootstrap.sh --assert-hardening`.

These are **not covered**: third-party git packages, and any `pi install` on a machine
where bootstrap has never run. For those, prefix the single command:

```
npm_config_ignore_scripts=true pi install https://github.com/other/package
```

Never export that variable persistently: Pi passes it to every command it runs.

## Session sharing

Pi's `/share` uploads the whole session to a gist whenever `gh` is logged in,
and no extension can block it. Check with `sh scripts/check-gh-unauthenticated.sh`;
the control is `gh auth logout` (set up git over SSH first).

## Development

```
npm install
npx tsc --noEmit
npx vitest run <file> --maxWorkers=2
```

Windows Git Bash now, macOS later; shell code is POSIX `sh`. This is a public
repository: no credentials are committed, and provider values resolve at
runtime from the environment or `~/.pi/agent/auth.json`.

## License

See [LICENSE](LICENSE). Pi is MIT-licensed, by Mario Zechner / Earendil Works.
