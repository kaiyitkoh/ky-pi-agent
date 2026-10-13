# ky-pi-agent

A personalised coding-agent harness built on [Pi](https://pi.dev).

**Status: work in progress.** Everything below is built and proven offline by
the test suite. The live checks (real providers, the work laptop, a real
GitLab) are listed in `docs/RUNBOOK.md` and are still **OUTSTANDING**.

## What this is

A configuration and extension layer over Pi: model routing, quality gates,
subagents, workflows, safety rules and diagnostics, packaged as a single repo.

The goal is to make cheap models produce work you would trust from an expensive
one, without the harness itself becoming the bottleneck. The daily driver is
DeepSeek V4 Flash; stronger models (DeepSeek V4 Pro, Claude Sonnet 4.5 on AWS
Bedrock) are reserved for the roles and moments where they earn their cost.

It is built for one person's workflow. It is public because there is no reason
for it not to be, not because it is intended as a general-purpose tool.

**Setting up a new machine?** Follow `docs/RUNBOOK.md`, section
"Work laptop: start here", top to bottom. It is self-contained: what works
without each provider, prerequisites, every environment variable and where to
persist it in Git Bash, clone and bootstrap, loading the harness in every
repository, Bedrock through AWS SSO (profile, region, prefix, model access and
the hand-written `auth.json` entry), a verify command with expected output for
each provider, every setting, the live checks, update, rollback, uninstall and
a troubleshooting table.

## Install

Requires Node >= 22.19.0 and, on Windows, Git for Windows (Git Bash). Pi is
pinned at 1.1.0.

Two paths. They are **alternatives, not a sequence**, so
pick one delivery path: the bootstrap stub or the git package, never both.

**Path A — install as a Pi package, pinned to a release ref:**

```
pi install git:github.com/kaiyitkoh/ky-pi-agent@v1.0.1
```

A bare URL with no ref is not supported: `pi update` would not move it, and an
unpinned clone is unreviewed code. The ref is an exact tag or commit. The
package manifest declares the agent definitions (`pi.subagents.agents`), so
they travel with it.

**Path B — clone and bootstrap (recommended for the work laptop):**

```
git clone https://github.com/kaiyitkoh/ky-pi-agent
cd ky-pi-agent
sh bin/bootstrap.sh
sh bin/bootstrap.sh --global-setup
sh bin/bootstrap.sh --check-only
pi list
```

The full run hardens every npm scope, then installs this checkout's own
dependencies with `npm ci --ignore-scripts` from the lockfile (the guard
imports `unbash` from the checkout; without the dependencies Pi exits at
start in every repository), Pi 1.1.0, the four composed packages at exact pins,
the `ky` theme, the `models.json`/`auth.json` templates and a user-scope safety
stub that loads this checkout's guard and blocks every tool call if the guard
fails to load. Once the stub exists it adds this checkout as a user-level
package with its safety extension filtered out
(`"extensions": ["!.pi/extensions/safety/**"]`), so the harness commands
(`/mode`, `/quick`, `/plan`, `/review`, ...) load in every repository and
`pi list` shows `<checkout path> (filtered)` (set `kyPiAgent.harnessPackage`
to `false` to opt out), and registers this checkout's `.pi/agents` as a
subagent scan directory. It merges rather than overwrites: your own packages,
extensions, theme and `kyPiAgent` keys survive, and a different pinned version of one of
ours is refused; an entry you already have for this checkout is kept as you
configured it. `--global-setup` re-runs the dependency check and the settings
merge and refuses unless a full run has installed the safety stub (or the git
package is configured). `--check-only` changes nothing: it reports missing
dependencies and a missing harness entry as `WARN` lines. `sh bin/bootstrap.sh --help` lists every mode.

Do one or the other, **not both**. The stub loads this checkout's guard; a git
package carries its own copy, and two copies can diverge.
`sh bin/bootstrap.sh --check-only` fails when both are configured, and when a
git package sits beside the local harness entry: that is two copies of the
whole harness, and Pi refuses to start on their conflicting tools. Trusting
this checkout as a project is harmless: the package entry already names its
extensions, so Pi does not load them again, and should the guard load twice
anyway, the second copy finds the first on Pi's event bus, registers no tool
(two registrations of `bash` would make Pi exit with
`Tool "bash" conflicts with ...`) and adds only a second blocking `tool_call`
hook. Trusting another clone or worktree of this repository is not: its
extensions come from a second path and conflict.

## Commands and modes

Commands cost zero per-turn tokens, so almost everything is a command.

**Routing**

| Command | Does |
|---|---|
| `/cheap`, `/balanced`, `/max` | Switch the whole role→model map (executor and subagent pins). |
| `/escalate` (`on`) / `/escalate off` | Lift the executor to `max`'s route, sticky until cleared; each change is logged. |
| `/mode` | Show the mode, escalation state and every role's resolved model. |

A fresh session starts in `cheap` and applies its executor, unless `--model`,
`--provider` or `--models` was passed, in which case your model is kept.

**Workflows**

| Command | Does |
|---|---|
| `/quick` | Route, guard, arm evidence and hand a small task to the normal prompt loop. |
| `/grill` | Interrogate a change into a gated `SPEC.md` before any plan or code. |
| `/plan` | Turn a gated SPEC into a coverage-complete `PLAN.md`. |
| `/execute` | Run the next unfinished PLAN task, evidence-gated, appending `PROGRESS.md`. |
| `/review` | Review against SPEC and PLAN, write `REVIEW.md`, open an MR against `staging`. |

Artifacts live under `.pi/work/<slug>/`. See `docs/WORKFLOWS.md`.

**Plan mode, todos, background tasks, recovery**

| Command / flag | Does |
|---|---|
| `pi --plan`, `/plan-mode`, Ctrl+Alt+P | Start in, or toggle, read-only plan mode. |
| `/plan-todos` | Show plan progress. |
| `/todos` | Show the todo list on the current branch. |
| `/bg <command>`, `/jobs`, `/logs <id>`, `/kill <id>` | Start, list, read and stop tracked background shell tasks. |
| `/tasks`, `/bg-tasks`, `/bg-clear` | Background task manager UI; clear finished notices. |
| `/checkpoint-restore [sha]` | List working-tree checkpoints, or restore one. |
| `/loop-police` | Loop-detector status; `reset`, `set KEY=VAL`, `save`. |
| `/budget` | Per-turn token budget: system prompt, tools, context files, skills, cache. |
| `/ky-hello` | Liveness check for the harness. |

**Tool profiles.** `pi --ky-profile recon|review|implement|full` picks the tool
set for a session (default `implement`). Smaller profiles cost fewer tokens
every turn; `bg_enable` loads the background tools on demand. An explicit
`--tools` list switches profiles off. See `docs/ROUTING.md`, "Tool profiles".

## Routing and providers

Six roles (executor, planner, reviewer, advisor, vision, summariser) each map
to an ordered candidate list per mode. Providers:

- **DeepSeek** (Pi's built-in provider): `deepseek-flash` and `deepseek-v4-pro`.
- **DashScope** (Alibaba, a custom provider from the models template): the same
  two models, tried after DeepSeek-direct.
- **Amazon Bedrock**: Claude Sonnet 4.5 for vision, and the advisor, planner
  and reviewer in the stronger modes. The inference-profile prefix comes from
  `kyPiAgent.bedrockProfilePrefix` (default `apac.`).
- **Qoder** (optional): not a provider; `qoder_delegate` hands a task to Qoder's
  Cloud Agents API and folds the result back.

A capability guard refuses a model that cannot do the job (an image for a
text-only model, a prompt over the context window, thinking a Bedrock model
would never receive, a tool loop on DeepSeek R1) and says why; a refused switch leaves the session unchanged. Credentials are resolved at
runtime from `~/.pi/agent/auth.json` and the environment. See `docs/ROUTING.md`.

## Safety

`.pi/extensions/safety/` is a mistake-catcher, not a security boundary; the
real control is GitLab's server-side branch protection. The guard parses every
bash command into an AST (`unbash`) instead of matching strings, and:

- refuses variable indirection, command substitution and nested shells that
  hide a guarded verb (`g=push; git $g`, `sh -c "git push"`);
- applies a **strict pipe rule**: any code runner (`sh`, `python`, `node`,
  `psql` and many more) whose stdin is a pipe is refused, whatever its
  arguments, and heredocs are refused everywhere;
- **protected branches**: `main`, `master` and `staging` are built in;
  `safety.protectedBranches` and `safety.pushProtectedBranches` in settings add
  more (add-only). Pushes to them, force pushes and tag pushes are blocked; a
  push to any other branch asks you, and refuses when nobody can be asked
  (print, json, subagents);
- gates `terraform apply`, mutating cloud CLIs and writes to credential paths
  behind a confirm or a block, with an audit log.

See `docs/SAFETY.md` for exactly what is caught and what is not.

## Subagents

Subagents come from the pinned `pi-subagents` package. This repo ships two
agent definitions in `.pi/agents/`: `planner` (read-only, produces a plan) and
`executor-handoff` (works from a handoff packet). The planner's model is pinned
by the current mode. Every child loads the safety guard (a launch is refused if
it cannot), and a push that would ask is refused in a child because nobody can
answer.

## UI

The `ky` theme, a two-line header (harness version, Pi version, mode) and one
`ky-statusline` footer segment (mode, tokens left, changed files, running
subagents). Nothing UI-related enters the system prompt, so it cannot break the
prompt cache. See `docs/UI.md`.

## OpenSpec (opt-in)

`sh scripts/openspec-setup.sh --install-cli` then `sh scripts/openspec-setup.sh`
installs the official OpenSpec skills and prompts at user level, each flagged so
it costs nothing per turn until you type `/skill:openspec-<name>` or
`/opsx-<name>`. Nothing is installed by bootstrap. See `docs/OPENSPEC.md`.

## Diagnostics

Every turn writes redacted JSONL under `.pi/logs/` in the working repo:
`wire-<date>.jsonl` (request and response payloads), `turns-<date>.jsonl` (one
row per turn, with tokens and cost) and `audit-<date>.jsonl` (safety
decisions). A detector re-prompts when a cheap model writes a tool call as
prose. `/budget` shows the per-turn token floor. See `docs/DIAGNOSTICS.md`.

## Documentation

- `docs/RUNBOOK.md` — live checks and the work-laptop start-here checklist
- `docs/ROUTING.md` — role→model table, mode commands, refusals, tool profiles
- `docs/SAFETY.md` — what the guard catches and what it does not
- `docs/WORKFLOWS.md` — `/quick` and the four ceremonial workflows
- `docs/QUALITY.md` — deterministic gates, the reviewer and calibration
- `docs/DIAGNOSTICS.md` — log format, redaction and the per-turn floor
- `docs/EXTENSIONS.md` — provenance of every pinned or vendored extension
- `docs/UI.md` — theme, header and statusline
- `docs/OPENSPEC.md` — the opt-in OpenSpec skills

## Supply chain — what is protected and what is not

The asymmetry that justifies all of this: **Pi installs *itself* with
`--ignore-scripts`, but installs *extensions* without it.** There is no code
path in `pi install` that passes `--ignore-scripts`. So a third-party package
you install into your agent runs its npm lifecycle scripts with your full user
permissions, on a laptop that may hold live cloud credentials.

The control is `ignore-scripts=true`, placed in every npm scope Pi can reach.
It is not one file, because npm resolves its project config from `--prefix`
when one is given and from the current directory otherwise, and Pi always
passes `--prefix` on the npm path.

**Covered** by the committed root `.npmrc`:

- your own `npm install` inside this repo
- the `npm install --omit=dev` that Pi runs inside a clone of *this* repo

**Covered** after bootstrap, by `~/.pi/agent/npm/.npmrc`:

- every `pi install npm:<package>` at user scope — the largest gap, and one no
  committed file in this repo can reach

**Covered** by the committed `.pi/npm/.npmrc`:

- project-scope installs (`pi install -l`)

**Not covered:**

- **Third-party *git* packages.** Their clone directory is created fresh by
  `git clone`, so there is no file we can pre-place inside it. Third-party git
  packages are **not covered** by anything in this repo, and cannot be.
- **Any `pi install` on a machine where bootstrap has never been run.** The
  user-scope control is machine state, not repo state.

For both uncovered cases, use a one-shot environment prefix on the single
command:

```
npm_config_ignore_scripts=true pi install https://github.com/other/package
```

**Do not export `npm_config_ignore_scripts` persistently.** Pi passes its
inherited environment to everything it spawns, including the `bash` tool, so a
persistent setting would silently skip legitimate native builds inside any
project you work on during a session. Per-command, or not at all.

Verify with `sh bin/bootstrap.sh --assert-hardening`, which exits non-zero if
any npm scope still permits lifecycle scripts and needs no network.
`sh bin/bootstrap.sh --check-only` performs every probe without changing
anything, and **needs the network**: the published-pin preflight asks the npm
registry whether the pinned Pi version still exists and exits 1 if it cannot.

## Session sharing

Pi's built-in `/share` uploads the **entire session transcript** to a GitHub
gist, and no extension can block it. The only control is that Pi checks
`gh auth status` first and aborts when it exits non-zero. Check the current
state with:

```
sh scripts/check-gh-unauthenticated.sh
```

Apply the control with `gh auth logout`. On a machine that uses git-over-HTTPS
that also removes your git credential, so set up SSH first. Dropping only the
`gist` scope is not possible.

## Platform

Windows (Git Bash) now, macOS later. Shell code is POSIX `sh`.

## Secrets

This is a public repository. No credentials are committed. Provider
configuration is structurally complete, with values resolved at runtime from
the environment or `~/.pi/agent/auth.json`.

## Development

```
npm install
npx tsc --noEmit
npx vitest run <file> --maxWorkers=2
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules that are expensive to
rediscover, in particular the boundary rule governing when a new capability
may become a tool rather than a command or a skill, and `AGENTS.md` for code
conventions.

## License

See [LICENSE](LICENSE). Pi itself is MIT-licensed and is a separate project by
Mario Zechner / Earendil Works.
