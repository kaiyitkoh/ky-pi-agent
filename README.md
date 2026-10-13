# ky-pi-agent

A personalised coding-agent harness built on [Pi](https://pi.dev).

**Status: work in progress. Nothing here is finished or verified. There is no
usable release yet.**

## What this is

A configuration and extension layer over Pi — model routing, quality gates,
subagents, workflows, and safety rules — packaged as a single repo.

The goal is to make cheap models produce work you would trust from an expensive
one, without the harness itself becoming the bottleneck. The intended daily
driver is a low-cost model, with stronger models reserved for the specific
points where they earn their cost.

It is being built for one person's workflow. It is public because there is no
reason for it not to be, not because it is intended as a general-purpose tool.

## Install

Two paths. They are **alternatives, not a sequence** — pick one delivery path:
the bootstrap stub or the git package, never both.

**Path A — install as a Pi package, pinned to a release ref:**

```
pi install git:github.com/kaiyitkoh/ky-pi-agent@v1.0.0
```

A bare URL with no ref is not supported: `pi update` would not move it, and an
unpinned clone is unreviewed code. The ref is an exact tag or commit. The
package manifest declares the agent definitions (`pi.subagents.agents`), so
they travel with it.

**Path B — clone and bootstrap:**

```
git clone https://github.com/kaiyitkoh/ky-pi-agent
cd ky-pi-agent
sh bin/bootstrap.sh
```

Bootstrap also writes the user-level Pi settings: the four composed packages at
exact pins, the `ky` theme, and this checkout's `.pi/agents` as a subagent scan
directory, so the harness is available in every repository. It merges rather
than overwrites: your own packages, extensions, theme and `kyPiAgent` keys
survive, and a different pinned version of one of ours is refused.
`sh bin/bootstrap.sh --global-setup` runs only that part.

Do one or the other, **not both**. The bootstrap installs a user-scope safety
stub that loads this checkout's guard; a git package carries its own copy, and
two copies can diverge. `sh bin/bootstrap.sh --check-only` fails when both are
configured. Separately, installing globally *and* dogfooding by `cd`-ing into
the repo loads the extension twice from two different absolute paths, which
Pi's canonical-path deduplication does not merge. It is non-fatal and not worth
engineering around, so the rule is: dogfood, or install globally, never both.

Neither path is finished yet.

## Supply chain — what is protected and what is not

The asymmetry that justifies all of this: **Pi installs *itself* with
`--ignore-scripts`, but installs *extensions* without it.** There is no code
path in `pi install` that passes `--ignore-scripts`. So a third-party package
you install into your agent runs its npm lifecycle scripts with your full user
permissions, on a laptop that may hold live cloud credentials.

The control is `ignore-scripts=true`, placed in every npm scope Pi can reach.
It is not one file, because npm resolves its project config from `--prefix`
when one is given and from the current directory otherwise, and Pi always
passes `--prefix` on the npm path. A single correctly-written file in a
plausible location does not cover the paths that matter.

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

For both uncovered cases, the ritual is a one-shot environment prefix on the
single command:

```
npm_config_ignore_scripts=true pi install https://github.com/other/package
```

**Do not export `npm_config_ignore_scripts` persistently.** Pi passes its
inherited environment to everything it spawns, including the `bash` tool, so a
persistent setting would silently skip legitimate native builds inside any
project you work on during a session. Per-command, or not at all.

## Second machine / macOS setup

The repo-scoped `.npmrc` travels with the clone. The user-scope control does
**not** — it lives at `~/.pi/agent/npm/.npmrc`, which is machine state, and
`bin/bootstrap.sh` is how each machine acquires it.

1. Install Node ≥ 22.19.0 and Git. On Windows this means Git for Windows, which
   provides the Git Bash `sh` that every script here targets.
2. Clone the repo and `cd` into it.
3. Run `sh bin/bootstrap.sh`. It probes tools, verifies the pinned Pi version
   is still published, hardens and *proves* every npm scope, and only then
   installs anything. It is safe to re-run.
4. Verify with `sh bin/bootstrap.sh --assert-hardening`. This exits non-zero if
   any npm scope still permits lifecycle scripts, and it asks npm rather than
   inspecting the files — the effect is what matters, not the file.

`sh bin/bootstrap.sh --check-only` is the non-mutating variant that CI runs: it
performs every probe and every repo-side assertion, changes nothing, and exits
0 on a clean runner where bootstrap has never been applied.

**`--check-only` needs the network.** One of its probes is the published-pin
preflight (BOOT-04), which asks the npm registry whether the pinned Pi version
still exists, and a registry that does not answer is a hard `exit 1` — the
script refuses to guess whether a pin was withdrawn or the network was down.
Offline, use `sh bin/bootstrap.sh --assert-hardening`, which touches nothing but
the local npm configuration.

## Session sharing

Pi's built-in `/share` uploads the **entire session transcript** — source,
prompts, anything pasted in — to a GitHub gist. No extension can block it:
built-in slash commands are dispatched before extension commands and before the
`input` event, so there is no hook upstream of it.

The only control is that Pi checks `gh auth status` first and aborts when it
exits non-zero. Check the current state with:

```
sh scripts/check-gh-unauthenticated.sh
```

Apply the control with `gh auth logout`. Note the cost: on a machine that uses
git-over-HTTPS, that also removes your git credential. Dropping only the `gist`
scope is not an option — `repo`, `read:org` and `gist` are documented as a
non-removable minimum set.

## Verification status

`docs/RUNBOOK.md` lists every check that cannot be executed on the development
machine — the ones needing the work laptop, a clean profile, or an interactive
terminal. Each carries its command, its expected output, and a status. Checks
that have not been run are marked **OUTSTANDING**, never passed.

## Platform

Targets Windows (via Git Bash) and macOS. Shell code is POSIX `sh`.

## Secrets

This is a public repository. No credentials are committed. Provider
configuration is kept structurally complete with values resolved at runtime
from the environment.

## Development

```
npm install
npm test
npm run typecheck
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules that are expensive to
rediscover — in particular the boundary rule governing when a new capability
may become a tool rather than a command or a skill.

## License

See [LICENSE](LICENSE). Pi itself is MIT-licensed and is a separate project by
Mario Zechner / Earendil Works.

---

This README will be rewritten as the project takes shape.
