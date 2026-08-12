# Phase 1: Bootstrap, Packaging & Supply Chain - Research

**Researched:** 2026-08-13
**Domain:** Pi package authoring, npm supply-chain hardening, cross-platform POSIX shell CI, git-ignore provability
**Confidence:** HIGH (almost every claim below was executed or read at source on this machine this session)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Copied verbatim from `.planning/phases/01-bootstrap-packaging-supply-chain/01-CONTEXT.md`:

1. **Project-scoped `.npmrc`, not global.** `ignore-scripts=true` lives in a `.npmrc` inside the repo. Explicitly NOT `~/.npmrc` — global would break packages with legitimate native builds (`sharp`, `better-sqlite3`, `node-gyp`) machine-wide. The residual gap is real and must be documented rather than hidden: a `pi install` run from any other directory is unprotected. README and the runbook must state this, including the setup step required when installing on macOS or any second machine.

2. **Repo AND Pi package, not either/or.** A `package.json` manifest costs one file and a bootstrap script costs one more; choosing between them means being worse at one for no saving. Both load paths must work.

3. **No build step.** Pi loads `.ts` directly through jiti. Adding a build breaks `/reload` hot-reloading for zero gain.

4. **GitHub Actions matrix for real macOS verification.** macOS cannot be tested locally on this machine; the matrix (`windows-latest` + `macos-latest`) is how macOS gets verified at all.

### Claude's Discretion

Repo layout details, script structure, test framework wiring, CI workflow specifics, and the exact form of the hello-world extension. Guided by the ROADMAP success criteria, `.planning/research/ARCHITECTURE.md` (repo structure and the boundary rule), and `.planning/research/STACK.md` (exact versions and packaging shape).

### Deferred Ideas (OUT OF SCOPE)

- Publishing to npm under a package name — the git install path is sufficient for v1.
- SSH remote — no key exists on this machine; HTTPS with `gh` auth works. Revisit before work-laptop setup.
- A global `~/.npmrc` hardening — explicitly rejected by the user in favour of project scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description (verbatim from REQUIREMENTS.md) | Research Support |
|----|---------------------------------------------|------------------|
| BOOT-01 | A **project-scoped** `.npmrc` in the repo sets `ignore-scripts=true`, asserted by the bootstrap script before its first `pi install` — `pi install` executes npm lifecycle scripts with no `--ignore-scripts` on any code path. Deliberately **not** global… The tradeoff is that a `pi install` run from another directory is unprotected; README and the runbook must state this, including the setup step when installing on macOS or any second machine. | §1 Supply Chain — **the scoping model in the requirement is materially wrong and was disproved by execution.** The repo `.npmrc` protects one of Pi's two install paths and *not* the one the requirement assumes. Exact coverage matrix, plus three additional controls, in §1. |
| BOOT-02 | User can install the harness on a clean machine with `pi install https://github.com/kaiyitkoh/ky-pi-agent` | §2 Load Path A — verified clone location, ref semantics, `npm install` cwd, manifest resolution, and an executed credential-free proof. |
| BOOT-03 | User can bootstrap a cold machine with `bin/bootstrap.sh` — installs Pi, verifies `bash`/`git`/`aws`/`glab`/`gh` presence, writes the env-var template, makes idempotent marked-region edits | §5 Node gate, §1.4 install command shape (mirrors Pi's own `--ignore-scripts` self-update), Environment Availability (glab and jq absent here), Pattern 4 (marked regions). |
| BOOT-04 | Bootstrap fails loudly with an actionable message if the pinned Pi version has been unpublished from npm (versions below 0.74.0 are already gone) | §3 — registry queried this session: 40 versions, oldest `0.74.0`. Exit codes and JSON shapes captured; E404-vs-network discrimination specified. |
| BOOT-05 | `cd ky-pi-agent && pi` loads the harness from `.pi/` so the repo dogfoods itself, with `/reload` working | §2 Load Path B — executed and proven, including the project-trust gate that makes the naive CI assertion fail. |
| BOOT-06 | All shell code is POSIX `sh` and all shipped scripts check out LF on both platforms | §4 — `.gitattributes` `eol=lf` proven to override `core.autocrlf=true` locally; shellcheck availability per runner image resolved. |
| BOOT-07 | CI runs the full test suite on `windows-latest` and `macos-latest`, giving real macOS verification without a Mac | §4 — runner image contents verified (Node, Git Bash path, gh, shellcheck), `shell: bash` semantics cited from GitHub docs. |
| BOOT-08 | Every third-party dependency is pinned to an exact version, with a committed lockfile | §8 + Standard Stack — exact versions verified on the registry; the peerDeps-vs-pinning tension and the unpinned-`pi install`-URL tension both named. |
| BOOT-09 | No credential can be committed — `.gitignore` covers every runtime state and secret path, verified by a test | §6 — every Pi credential/state path enumerated at source; `git check-ignore -q` established as the exact test primitive; **two live gaps found in the current `.gitignore`, one of which silently defeats BOOT-01**. |
| BOOT-10 | `CONTRIBUTING.md` states the boundary rule: a new capability defaults to command or skill; registering a tool requires justifying its per-request schema cost | §9 — grounded at source: tool name+description+JSON Schema are serialised into `tools[]` on every request; commands appear nowhere in system-prompt construction. |
| SAFE-16 | `gh` is left unauthenticated on the work laptop and this is stated in the runbook — `/share` cannot be blocked by any extension, and aborting on `gh auth status` is the only control | §6.3 — `/share` handler read at source; **`gh auth refresh --remove-scopes gist` verified impossible** (gist is a non-removable minimum scope), so logout is genuinely the only control. `gh` is currently **authenticated with `gist` scope on this dev machine** — the test must not assert on machine state. |
</phase_requirements>

---

## Summary

Three things dominate planning for this phase, and two of them contradict what the requirements currently assume.

**First: the supply-chain control described in BOOT-01 does not do what the requirement says it does.** I executed the real attack. Pi has two package-install code paths with *different npm working directories*. For git packages, Pi runs `npm install --omit=dev` with `cwd` set to the freshly cloned package directory — so a `.npmrc` committed inside *our* repo is read and does protect *our own* dependency install. For npm packages, Pi runs `npm install <spec> --prefix <installRoot> --legacy-peer-deps` with **no cwd override**, and npm resolves its "project" `.npmrc` from `--prefix`, not from cwd. I proved this with a real package carrying a malicious `postinstall`: with the repo `.npmrc` present and cwd inside the repo, **the postinstall still ran**. The repo-scoped `.npmrc` is therefore necessary but nowhere near sufficient. Three additional controls exist, all verified by execution, and the cheapest correct one is an `.npmrc` inside `~/.pi/agent/npm/` — which is neither global nor repo-scoped, breaks no native builds anywhere on the machine, and covers the exact directory Pi installs extension packages into.

**Second: the two load paths genuinely work off one set of files, and I proved it end to end without credentials.** A sentinel extension at `.pi/extensions/<name>/index.ts` plus `"pi": {"extensions": ["./.pi/extensions"]}` in `package.json` loads (a) as a project-local extension when you `cd` into the repo, and (b) as a package when the directory is consumed from an unrelated cwd. `pi --offline -a --list-models` renders a provider registered by that extension, which gives CI a real, executable, credential-free assertion for both BOOT-02 and BOOT-05. The `-a` is load-bearing: project resources are gated behind project trust, and non-interactive modes never prompt — without it the assertion silently returns nothing.

**Third: the repo's existing `.gitignore` currently ignores `.npmrc`, which makes BOOT-01 unshippable as written.** The file cannot be committed, so it cannot reach a clone, so the one install path the repo `.npmrc` does cover is also unprotected. A second gap (`.pi/git/`) is present. Both are one-line fixes, but they must be caught in Wave 0 or the phase ships a control that does nothing.

**Primary recommendation:** Root the package at `.pi/`, ship the repo `.npmrc` *and* have `bin/bootstrap.sh` write `~/.pi/agent/npm/.npmrc` before its first `pi install`, and make every success criterion an executed command in CI — `pi --offline -a --list-models | grep <sentinel>` for the load paths, `git check-ignore -q` over a candidate-path table for BOOT-09, and `sh` execution plus `shellcheck -s sh` for BOOT-06.

---

## Decisions taken autonomously

The user is asleep; these were decided rather than asked, each consistent with recorded decisions in PROJECT.md / ROADMAP.md / CONTEXT.md.

1. **Add `~/.pi/agent/npm/.npmrc` (written by bootstrap) as a second control alongside the repo `.npmrc`.** The user rejected `~/.npmrc` because global `ignore-scripts` breaks legitimate native builds machine-wide (PROJECT.md Key Decisions). `~/.pi/agent/npm/.npmrc` has none of that blast radius — it is read only when npm is invoked with `--prefix ~/.pi/agent/npm`, which only Pi does, and only for extension packages. The recorded decision's *rationale* is fully preserved; only the false belief that the repo `.npmrc` alone suffices is corrected. The repo `.npmrc` still ships, as decided.
2. **The hello-world sentinel registers a command and a provider, not a tool.** BOOT-10 makes "default to command or skill" the house rule; a sentinel that registers a tool would violate the rule the same phase writes down. A registered provider is also what makes the credential-free `--list-models` assertion possible.
3. **`shellcheck -s sh` runs as a third `ubuntu-latest` lint job, not on the matrix.** ShellCheck 0.9.0 is preinstalled on `ubuntu-24.04` and absent from both `windows-latest` and `macos-latest`. The matrix requirement (BOOT-07) is about *running the test suite* on Windows and macOS; adding a lint-only Ubuntu job satisfies BOOT-06 without installing tooling on the matrix legs. Zero cost on a public repo.
4. **`package-lock.json`, not `npm-shrinkwrap.json`.** Pi consumes our repo via `git clone` + `npm install` at the clone root, where `package-lock.json` applies. Shrinkwrap only matters for npm-published packages, which is a Deferred Idea.
5. **The SAFE-16 automated test asserts the *classifier*, not the machine.** `gh` is legitimately authenticated on this dev machine (needed for HTTPS git push — CONTEXT.md notes no SSH key exists). The CI test unit-tests the check script against injected exit codes; the machine-state assertion lives in the runbook and is marked outstanding for the work laptop.
6. **`@types/node` pinned to `24.12.4`** to match Pi core's own devDependency exactly, rather than the current `26.2.0`. Type-compatibility with Pi's shipped `.d.ts` is the thing that matters, per the same reasoning that pins TypeScript to 5.9.3.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Blocking npm lifecycle scripts | npm config resolution (`.npmrc` at the install cwd/prefix) | bootstrap script (asserts + writes) | npm decides; nothing in Pi or in an extension can intercept an install that happens before the extension loader runs |
| Package/extension discovery | Pi's package manager + extension loader (host) | `package.json#pi` manifest (our declaration) | Pi owns resolution; we only declare paths |
| Dogfood load (`cd repo && pi`) | Pi project-resource loader, gated by project trust | `.pi/extensions/**` layout | trust is a Pi-owned input gate, not something the repo can grant itself |
| Version-pin enforcement | committed `package-lock.json` + exact `devDependencies` | bootstrap preflight (`npm view`) | the lockfile pins the tree; the preflight catches an unpublished *host* |
| Line-ending normalisation | `.gitattributes` (`eol=lf`) | CI assertion on checked-out bytes | gitattributes beats `core.autocrlf`; CI proves it on the actual runner |
| Credential non-committability | `.gitignore` + `git check-ignore` | CI test over a candidate-path table | git is the only enforcement point; a test is the only proof |
| `/share` suppression | machine state (`gh` auth) | runbook sentence | verified at source: no extension hook can reach `/share` |
| Cross-platform shell correctness | `shellcheck -s sh` (conformance) | `sh <script>` execution on both runners (behaviour) | Git-Bash `sh` and macOS `/bin/sh` are both bash-in-posix-mode; execution alone does not prove POSIX conformance |

---

## §1 Supply chain: `ignore-scripts` scoping and ordering (BOOT-01)

### 1.1 What Pi actually does — read at source

Pi has exactly two package-install code paths. Both were read in the TypeScript recovered from `dist/**/*.js.map` `sourcesContent`.

**Path A — git source** (`pi install https://github.com/...`):

```
git clone <repo> <targetDir>
[git checkout <ref>]           # only if a ref was given
npm install --omit=dev         # cwd = targetDir
```

- `[VERIFIED: pi src/core/package-manager.ts:1823-1830]` — `runCommand("git", ["clone", ...])`, then `if (existsSync(join(targetDir,"package.json"))) await this.runNpmCommand(this.getGitDependencyInstallArgs(), { cwd: targetDir })`.
- `[VERIFIED: pi src/core/package-manager.ts:1745-1751]` — `getGitDependencyInstallArgs()` returns `["install","--omit=dev"]`, or plain `["install"]` when `npmCommand` is configured.
- `[VERIFIED: pi src/core/package-manager.ts:2078-2087]` — clone root is `join(agentDir,"git")` for user scope, `join(cwd, CONFIG_DIR_NAME, "git")` for project scope. Matches `docs/packages.md:92`.
- **No `--ignore-scripts` anywhere on this path.**

**Path B — npm source** (`pi install npm:foo@1.2.3`):

```
npm install <spec> --prefix <installRoot> --legacy-peer-deps    # cwd = Pi's process cwd
```

- `[VERIFIED: pi src/core/package-manager.ts:1781-1785]` — `installNpm` calls `runNpmCommand(getNpmInstallArgs([spec], installRoot))` with **no `options.cwd`**.
- `[VERIFIED: pi src/core/package-manager.ts:1758-1778]` — npm branch returns `["install", ...specs, "--prefix", installRoot, "--legacy-peer-deps"]`; the pnpm branch additionally sets `--config.strict-dep-builds=false`.
- `[VERIFIED: pi src/core/package-manager.ts:1998-2007]` — `installRoot` is `~/.pi/agent/npm` (user) or `<cwd>/.pi/npm` (project). Matches `docs/settings.md:203`.
- `[VERIFIED: pi src/core/package-manager.ts:2582-2588]` — `spawnCommand` passes `cwd: options?.cwd` (undefined ⇒ inherit) and `env: getEnv()`, where `getEnv()` returns `process.env` on Windows/macOS (`src/core/package-manager.ts:6-23`). **The environment is inherited**, which is what makes the env-var control in §1.3 work.
- **No `--ignore-scripts` anywhere on this path.**

Contrast, and this is the sharpest evidence that the omission is deliberate rather than an oversight: **Pi installs *itself* with `--ignore-scripts`.** `[VERIFIED: pi src/config.ts:170-177]` — `npm install -g --ignore-scripts --min-release-age=0 <spec>`; same flag on the pnpm, yarn and bun branches (`src/config.ts:136,148,158`). Pi protects its own self-update and does not protect your extension installs.

### 1.2 How npm resolves the project `.npmrc` — executed, not assumed

npm 11.13.0 on this machine. Every row below was run.

| cwd | `--prefix` | `.npmrc` present at | `npm config get ignore-scripts` |
|-----|-----------|---------------------|-------------------------------|
| `A` | — | `A` | `true` |
| `B` | — | (none) | `false` |
| `A` | `B` | `A` | **`false`** |
| `B` | `A` | `A` | **`true`** |
| `A/sub` (no package.json) | — | `A` | `true` (walks up) |

`[VERIFIED: executed 2026-08-13, npm 11.13.0]`. Also confirmed: `npm --ignore-scripts <subcommand>` works with the flag *before* the subcommand, and `npm_config_ignore_scripts=true` in the environment works.

**`--prefix` overrides cwd for project-`.npmrc` resolution.** That single fact is the crux of BOOT-01.

### 1.3 The real attack, executed

A package `evil-pkg` with a `postinstall` that writes a sentinel file into the temp directory.

| Scenario | Command shape | Repo `.npmrc` at cwd? | Result |
|----------|---------------|----------------------|--------|
| Pi's npm path, no prefix `.npmrc` | `npm install file:evil --prefix root1 --legacy-peer-deps` (cwd = repo with `.npmrc`) | yes | **POSTINSTALL RAN** |
| Pi's npm path, `.npmrc` inside the prefix dir | `npm install file:evil --prefix root2 --legacy-peer-deps` | yes | blocked |
| Pi's git path, clone without `.npmrc` | `npm install --omit=dev` (cwd = clone) | n/a | **POSTINSTALL RAN** |
| Pi's git path, clone *with* committed `.npmrc` | `npm install --omit=dev` (cwd = clone) | yes (committed) | blocked |

`[VERIFIED: executed 2026-08-13]`

### 1.4 Coverage matrix — what the repo `.npmrc` does and does not cover

| Install action | npm cwd / prefix | Repo `.npmrc` covers it? |
|----------------|------------------|--------------------------|
| `npm install` by the developer inside the repo | cwd = repo | **yes** |
| `pi install https://github.com/kaiyitkoh/ky-pi-agent` (our own deps) | cwd = clone of *our repo*, which contains our committed `.npmrc` | **yes — but only if `.npmrc` is actually committed (see §6.2)** |
| `pi install git:github.com/other/pkg` (third-party deps) | cwd = *their* clone dir | **no** |
| `pi install npm:any-package` | prefix = `~/.pi/agent/npm` | **no** — proven above |
| `pi -e npm:any-package` (temporary) | prefix = a temp dir under `~/.pi/agent` | **no** |
| Project-scope `pi install -l …` | prefix = `<repo>/.pi/npm` | **no** (prefix wins over the repo root) |
| Auto-install of missing project packages on startup (`docs/packages.md:43`) | same as above | **no** |

### 1.5 The four available controls, ranked

| # | Control | Covers | Blast radius | Verdict |
|---|---------|--------|--------------|---------|
| 1 | `.npmrc` at repo root with `ignore-scripts=true` | dev installs + our own clone's deps | repo only | **Ship** — locked decision, and genuinely covers two real paths |
| 2 | `.npmrc` at `~/.pi/agent/npm/` with `ignore-scripts=true`, written by bootstrap | **all `pi install npm:*` at user scope** — the largest gap | only npm invocations using `--prefix ~/.pi/agent/npm`, i.e. only Pi extension installs | **Ship** — see Decisions taken autonomously #1. Pi creates this directory itself (`ensureNpmProject`, `src/core/package-manager.ts:1975-1986`) and writes a `.gitignore` there; adding `.npmrc` is safe and survives, because Pi only ever creates files that are absent |
| 3 | `.npmrc` at `<repo>/.pi/npm/` (project-scope installs) | project-scope `pi install -l` | repo only | **Ship** — one more file, closes the `-l` variant |
| 4 | `npm_config_ignore_scripts=true` in the environment of the `pi` process | everything Pi spawns | **too wide** — the env is inherited by the `bash` tool too (`spawnCommand` passes `env: getEnv()`), so a legitimate `npm install` inside a user project during a session would silently skip native builds | **Do not set persistently.** Document as a per-command ritual: `npm_config_ignore_scripts=true pi install <url>` |

Control 2 does **not** cover third-party *git* packages, because their clone directory is created fresh by `git clone` and we cannot pre-place a file there. `[VERIFIED: pi src/core/package-manager.ts:1819-1830]`. For those, the documented ritual is control 4 as a one-shot prefix, or `pi install` followed by review. This residual gap must appear in the README and runbook honestly, alongside the one the requirement already names.

### 1.6 Ordering (the "asserts it holds *before* its first `pi install`" clause)

The assertion is trivially satisfiable and worth doing properly:

```sh
assert_ignore_scripts() {
    dir=$1
    got=$(cd "$dir" && npm config get ignore-scripts 2>/dev/null)
    [ "$got" = "true" ] || {
        printf 'FATAL: ignore-scripts is not enabled for %s (got: %s)\n' "$dir" "$got" >&2
        printf 'Refusing to run pi install: npm lifecycle scripts would execute before review.\n' >&2
        exit 1
    }
}
```

For the `--prefix` case the equivalent probe is `npm config get ignore-scripts --prefix "$HOME/.pi/agent/npm"` — verified above that `--prefix` selects the project config, so this reads the right file.

---

## §2 The two load paths (BOOT-02, BOOT-05, success criterion 2)

### 2.1 Path A — `pi install <git url>`

- Accepted forms: bare protocol URLs (`https://`, `http://`, `ssh://`, `git://`) without the `git:` prefix; shorthand only with `git:` `[CITED: docs/packages.md:85-86]`.
- Clone target: `~/.pi/agent/git/<host>/<path>` (user) or `.pi/git/<host>/<path>` (project) `[CITED: docs/packages.md:92]` `[VERIFIED: src/core/package-manager.ts:2078-2087]`.
- Writes the source string into `~/.pi/agent/settings.json` by default; `-l` writes project settings instead `[CITED: docs/packages.md:43]`.
- `npm install` runs **only if the clone has a `package.json`** `[VERIFIED: src/core/package-manager.ts:1827-1830]`.
- **Ref pinning:** `pi install https://github.com/kaiyitkoh/ky-pi-agent` has *no ref*, so it is **not pinned** — `pi update --extensions` reconciles it to the tracked default branch. Refs are only pinned when written as `…@v1` `[CITED: docs/packages.md:90-91]`. This is in direct tension with BOOT-08; see §8.3.
- Resource resolution from the manifest: non-glob entries go through `resolve(root, entry)` and then directory collection; glob entries use `globSync(entry, { cwd: root, dot: false })` `[VERIFIED: src/core/package-manager.ts:2290-2305]`. **Prefer the literal `"./.pi/extensions"` over a glob** — `dot: false` makes glob behaviour around dot-prefixed segments fragile.
- Directory collection for extensions: `collectAutoExtensionEntries` first checks the directory itself for a pi manifest or `index.ts`; otherwise it scans one level, taking `*.ts`/`*.js` files and, for each subdirectory, a nested manifest or `index.ts`/`index.js` `[VERIFIED: src/core/package-manager.ts:530-612]`.
- **Two gotchas inside that scan:** entries whose name starts with `.` are skipped (`:577`), and `.gitignore` / `.ignore` / `.fdignore` **in that directory only** are honoured (`:571-572`, `IGNORE_FILE_NAMES` at `:203`, `addIgnoreRules` at `:245-263`). Parent `.gitignore` files are *not* read. Practical rule: **never place a `.gitignore` inside `.pi/extensions/`.**

### 2.2 Path B — project-local `.pi/`

Auto-discovered with **no `settings.json` declaration required**:

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/*.ts` | global |
| `~/.pi/agent/extensions/*/index.ts` | global |
| `.pi/extensions/*.ts` | project-local |
| `.pi/extensions/*/index.ts` | project-local |

`[CITED: docs/extensions.md:115-120]` `[VERIFIED: src/core/extensions/loader.ts:652-684, 710-712]`. Note this discovery path does **not** apply `.gitignore` rules and does not skip dotfiles — it is a plain `readdirSync`, unlike the package path.

Also auto-discovered project-local: `.pi/skills/`, `.pi/prompts/`, `.pi/themes/` `[VERIFIED: src/core/resource-loader.ts:818-821]`, `.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md` (`:1023,:1037`). Prompt discovery is **non-recursive** — flat `.md` files only `[VERIFIED: src/core/package-manager.ts:456-491]`.

**Project trust gates all of it.** A project counts as trust-requiring if it has `.pi/settings.json`, `.pi/extensions|skills|prompts|themes`, `.pi/SYSTEM.md`/`APPEND_SYSTEM.md`, or `.agents/skills` `[CITED: docs/security.md:11-17]`. Non-interactive modes never prompt; without a saved decision they fall back to `defaultProjectTrust` (default `"ask"`, which **ignores** the resources). `--approve`/`-a` overrides for one run `[CITED: docs/security.md:27; docs/settings.md:16]`.

### 2.3 One set of files serves both paths — executed proof

Scratch package: `package.json` = `{"name":"kypi-loadtest","keywords":["pi-package"],"pi":{"extensions":["./.pi/extensions"]}}`; extension at `.pi/extensions/hello/index.ts` registering provider `kypi-selftest` with model `kypi-hello-world` and a command.

| Test | Command | Result |
|------|---------|--------|
| CLI extension | `pi -e <pkg>/.pi/extensions/hello/index.ts --list-models` | sentinel present |
| **Project-local (BOOT-05)** | `cd <pkg> && pi -a --list-models` | **sentinel present** |
| Project-local, no `-a` (control) | `cd <pkg> && pi --list-models` | **absent** — trust gate |
| **Package manifest (BOOT-02)** | `cd ~ && pi -e <pkg> --list-models` | **sentinel present** |
| Offline | `cd <pkg> && pi --offline -a --list-models` | sentinel present |
| Both at once | `cd <pkg> && pi --offline -a -e <copy> --list-models` | loads, no error |

`[VERIFIED: executed 2026-08-13, pi 0.84.1]`

This gives CI its assertion:

```sh
pi --offline -a --list-models | grep -q 'ky-harness-selftest' \
  || { echo "FAIL: harness extension did not load"; exit 1; }
```

`--offline` disables all startup network operations (update checks, package update checks, telemetry) `[CITED: docs/settings.md:83]` — worth having in CI for determinism.

### 2.4 Double-load caveat

If the user both `pi install`s the repo globally **and** `cd`s into it, the extension loads twice from two different absolute paths. Deduplication is by canonical path, so it does not dedupe. Commands are stored per-extension-instance in a `Map` keyed by name (`src/core/extensions/loader.ts:273-280`), so there is **no throw** — you get duplicate entries in the command list. Non-fatal, but README should say: dogfood *or* install globally, not both.

### 2.5 `/reload`

- `/reload` (and `ctx.reload()`) emits `session_shutdown`, reloads resources, then emits `session_start{reason:"reload"}` and `resources_discover{reason:"reload"}` `[CITED: docs/extensions.md:1291-1292]`.
- Hot-reload works **only for auto-discovered locations** — `pi -e ./path.ts` is for quick tests `[CITED: docs/extensions.md:7]`. This is the concrete payoff of the `.pi/` dogfood layout and the reason the "no build step" decision matters.
- Code after `await ctx.reload()` still runs from the pre-reload version; treat reload as terminal `[CITED: docs/extensions.md:1294-1298]`.
- `pi.registerTool()` and `pi.registerProvider()` after startup take effect without `/reload` `[CITED: docs/extensions.md:1342, 1709]`.

### 2.6 Minimal `package.json`

```json
{
  "name": "ky-pi-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "keywords": ["pi-package"],
  "engines": { "node": ">=22.19.0" },
  "pi": {
    "extensions": ["./.pi/extensions"],
    "skills": ["./.pi/skills"],
    "prompts": ["./.pi/prompts"],
    "themes": ["./.pi/themes"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "0.84.1",
    "@earendil-works/pi-ai": "0.84.1",
    "typebox": "1.3.7",
    "typescript": "5.9.3",
    "vitest": "4.1.9",
    "@types/node": "24.12.4"
  }
}
```

- `keywords: ["pi-package"]` `[CITED: docs/packages.md:118]`.
- Peer-list is verbatim from `docs/packages.md:171`: `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox` — "list them in `peerDependencies` with a `"*"` range and do not bundle them."
- The same packages appear in `devDependencies` at exact versions **so local typechecking and vitest have real `.d.ts` and real modules**. `npm install --omit=dev` in the consumer clone skips them, and at runtime jiti aliases every one of those specifiers to Pi's own bundled copy `[VERIFIED: src/core/extensions/loader.ts:118-140]` — including a legacy alias mapping `@sinclair/typebox` → the same unscoped `typebox` entry.
- `"private": true` is safe: the npm-publish path is a Deferred Idea, and git installs ignore `private`.

---

## §3 Version pinning and unpublish detection (BOOT-04)

### 3.1 Registry state, queried this session

```
npm view @earendil-works/pi-coding-agent versions --json
  → 40 versions, first "0.74.0", last "0.84.1"
npm view @earendil-works/pi-coding-agent dist-tags --json
  → { "legacy-node20": "0.74.2", "latest": "0.84.1" }
```

`[VERIFIED: npm registry, executed 2026-08-13]`. The ROADMAP claim that "versions below 0.74.0 are already gone from npm" is **confirmed at the registry**, not inherited.

### 3.2 Exit codes and output shapes

| Query | Exit | stdout |
|-------|------|--------|
| `npm view <pkg>@0.84.1 version --json` | `0` | `"0.84.1"` |
| `npm view <pkg>@0.73.0 version --json` | `1` | `{"error":{"code":"E404","summary":"No match found for version 0.73.0", ...}}` |
| `npm view @earendil-works/definitely-not-a-pkg version --json` | `1` | `{"error":{"code":"E404","summary":"Not Found - GET …"}}` |

`[VERIFIED: executed 2026-08-13]`

**Critical nuance:** a network failure also exits non-zero. A check that treats any non-zero exit as "unpublished" will tell a user on a flaky connection that Pi has been yanked. Discriminate on the literal `E404` in stdout.

### 3.3 The concrete POSIX-sh check

```sh
PI_PKG="@earendil-works/pi-coding-agent"
PI_PINNED="0.84.1"

check_pi_version_published() {
    out=$(npm view "${PI_PKG}@${PI_PINNED}" version --json 2>/dev/null)
    if [ -n "$out" ] && [ "${out#*\"0}" != "$out" ] && [ "${out#*error}" = "$out" ]; then
        return 0
    fi
    case "$out" in
        *E404*)
            latest=$(npm view "$PI_PKG" version 2>/dev/null || echo "unknown")
            cat >&2 <<EOF
FATAL: pinned Pi version ${PI_PINNED} is no longer published on npm.

  Pinned:            ${PI_PKG}@${PI_PINNED}
  Latest on npm:     ${latest}
  Oldest surviving:  run: npm view ${PI_PKG} versions --json

Earendil Works unpublishes old versions; everything below 0.74.0 is already gone.

Fallback:
  1. Edit PI_PINNED in bin/bootstrap.sh to ${latest}
  2. Re-read the Pi CHANGELOG for breaking extension-API changes
  3. Re-run: sh bin/bootstrap.sh
EOF
            exit 1
            ;;
        *)
            echo "WARN: could not reach the npm registry to verify ${PI_PKG}@${PI_PINNED}." >&2
            echo "      Check your network, or re-run with --offline to skip this preflight." >&2
            exit 1
            ;;
    esac
}
```

Note the message names **the version and the fallback**, which is the literal success criterion. The `latest` lookup is best-effort and degrades to `unknown`.

### 3.4 Installing Pi

Mirror Pi's own self-update command shape `[VERIFIED: src/config.ts:170-177]`:

```sh
npm install -g --ignore-scripts "${PI_PKG}@${PI_PINNED}"
```

`--ignore-scripts` here is free — Pi has no install scripts (`scripts` in the published `package.json` are build-only; no `postinstall`) `[VERIFIED: installed package.json]`.

---

## §4 POSIX sh, LF, and CI (BOOT-06, BOOT-07, success criterion 3)

### 4.1 `.gitattributes` — already correct, and proven

The repo's existing `.gitattributes` (`* text=auto eol=lf`, plus explicit `*.sh text eol=lf`) is sufficient. Proven by execution on this machine, which has `core.autocrlf=true` set locally:

| Scenario | Bytes of `run.sh` after `git checkout` |
|----------|---------------------------------------|
| `.gitattributes` with `eol=lf`, `core.autocrlf=true` | `"#!/bin/sh\necho hi\n"` — **LF preserved** |
| No `.gitattributes`, `core.autocrlf=true` | `"#!/bin/sh\r\necho hi\r\n"` — CRLF, plus git warns |

`[VERIFIED: executed 2026-08-13, git 2.54.0.windows.1]`

Consequence: the `actions/checkout` autocrlf question is **moot**. `eol=lf` in `.gitattributes` wins regardless of the runner's `core.autocrlf`. No `with:` configuration on `actions/checkout` is needed for this. **Do not** add a `git config core.autocrlf false` step and call it the fix; the attribute is the fix and the CI assertion is the proof.

### 4.2 The CI assertion that actually proves it

```yaml
- name: Assert shipped scripts checked out with LF
  shell: bash
  run: |
    fail=0
    for f in $(git ls-files 'bin/*.sh' 'scripts/*.sh' '*.sh'); do
      if node -e "process.exit(require('fs').readFileSync('$f').includes(13)?1:0)"; then :; else
        echo "CRLF found in $f"; fail=1
      fi
    done
    exit $fail
```

Uses `node` rather than `grep -P`/`file`, because neither behaves identically across the three platforms, and node is a hard prerequisite anyway.

### 4.3 Runner facts, verified against the runner-images manifests

| | `windows-latest` (Windows Server 2025) | `macos-latest` (macOS 15) | `ubuntu-latest` (24.04) |
|---|---|---|---|
| Node default | 22.23.2 | 22.23.1 | 22.23.1 |
| Meets Pi `>=22.19.0` | yes | yes | yes |
| Git Bash | `C:\Program Files\Git\bin\bash.exe` (Git 2.55.0.windows.3) | n/a | n/a |
| `bash` version | (Git Bash) | **3.2.57** | 5.x |
| `gh` | 2.97.0 | 2.96.0 | present |
| `shellcheck` | **absent** | **absent** | **0.9.0** |

`[CITED: github.com/actions/runner-images — Windows2025-Readme.md, macos-15-arm64-Readme.md, Ubuntu2404-Readme.md, fetched 2026-08-13]`

Two things follow. macOS ships **bash 3.2**, so anything bash-4-only (associative arrays, `${var^^}`) fails there — irrelevant if the POSIX-sh rule is actually honoured, but it is the failure mode that catches people who write "portable bash". And Pi's documented Windows shell lookup order — settings `shellPath` → `C:\Program Files\Git\bin\bash.exe` → `bash.exe` on PATH `[CITED: docs/windows.md:3-7]` — resolves to entry #2 on the Windows runner with no configuration.

### 4.4 `shell: bash` semantics

On Windows runners, `shell: bash` uses "the bash shell included with Git for Windows", invoked as `bash --noprofile --norc -eo pipefail {0}`; the default shell on Windows without `shell:` is **pwsh** `[CITED: docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax]`. Every step in this project's workflows must therefore carry `shell: bash` explicitly, or set it once via `defaults.run.shell: bash`.

Note the distinction that matters for BOOT-06: `shell: bash` runs **bash**, not `sh`. Executing a script under bash does not prove it is POSIX `sh`. Both Git-for-Windows `sh` and macOS `/bin/sh` are bash in POSIX mode, so even `sh script.sh` does not prove conformance. **ShellCheck is what proves it**, hence the separate Ubuntu lint job.

### 4.5 Recommended workflow shape

```yaml
name: ci
on: [push, pull_request]
defaults:
  run:
    shell: bash

jobs:
  posix-lint:                      # BOOT-06 conformance
    runs-on: ubuntu-latest         # shellcheck 0.9.0 preinstalled
    steps:
      - uses: actions/checkout@<pinned-sha>
      - run: shellcheck --shell=sh --severity=style $(git ls-files '*.sh')

  test:                            # BOOT-07
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: actions/setup-node@<pinned-sha>
        with: { node-version: '22.19.0' }
      - run: npm ci --ignore-scripts
      - run: npx vitest run                       # unit + integration
      - run: sh -n bin/bootstrap.sh               # syntax, both platforms
      - run: sh bin/bootstrap.sh --check-only     # EXECUTES, no mutation
      - run: npx tsc --noEmit                     # typecheck against Pi .d.ts
```

Pin actions by commit SHA, not tag — consistent with the project's supply-chain posture. `--fail-fast: false` so a Windows-only failure does not hide a macOS-only one, which is the entire point of the matrix.

"Actually executes rather than merely building" (success criterion 3) is satisfied by the `sh bin/bootstrap.sh --check-only` step: the bootstrap must therefore be written with a **dry-run / check-only mode from the start** that runs every probe and assertion and mutates nothing. Design it in; retrofitting it is painful.

---

## §5 Node version gate (BOOT-03)

- `[VERIFIED: installed @earendil-works/pi-coding-agent@0.84.1 package.json]` — `"engines": { "node": ">=22.19.0" }`. Same field on `@earendil-works/pi-ai@0.84.1`.
- `legacy-node20` dist-tag is frozen at `0.74.2` `[VERIFIED: npm dist-tags, 2026-08-13]`.
- Local machine: Node v24.16.0, npm 11.13.0 `[VERIFIED: executed]`.

Bootstrap assertion, POSIX-sh, no `sort -V` (absent/inconsistent on macOS):

```sh
require_node() {
    command -v node >/dev/null 2>&1 || { echo "FATAL: node not found. Install Node >= 22.19.0." >&2; exit 1; }
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);
             if (a<22 || (a===22 && b<19)) {
               console.error("FATAL: Node "+process.versions.node+" < 22.19.0 required by @earendil-works/pi-coding-agent");
               process.exit(1);
             }' || exit 1
}
```

Using node to compare node's own version avoids every shell version-comparison trap and is available by definition.

---

## §6 Credential and runtime-state non-committability (BOOT-09, SAFE-16)

### 6.1 Every path Pi writes, enumerated at source

**User-scope (outside the repo — not committable by construction, but must be named in the docs):**

| Path | What | Source |
|------|------|--------|
| `~/.pi/agent/` | agent dir root; overridable via `PI_CODING_AGENT_DIR` | `src/config.ts:516-522` |
| `~/.pi/agent/auth.json` | **credentials**, written mode `0o600` | `src/config.ts:533-535`; `src/core/auth-storage.ts:23,64,106,188` |
| `~/.pi/agent/models.json` | model catalogue (may contain `!command` / `$ENV` refs) | `src/config.ts:528-530` |
| `~/.pi/agent/settings.json` | global settings, incl. installed package list | `src/config.ts:538-540` |
| `~/.pi/agent/trust.json` | project trust decisions | `docs/security.md:19` |
| `~/.pi/agent/sessions/` | **full transcripts** | `src/config.ts:558-561` |
| `~/.pi/agent/pi-debug.log` | debug log | `src/config.ts:563-566` |
| `~/.pi/agent/npm/`, `~/.pi/agent/git/` | installed packages | `src/core/package-manager.ts:2006, 2086` |
| `~/.pi/agent/tools/`, `bin/`, `themes/`, `prompts/` | managed resources | `src/config.ts:543-556` |

`auth.json`'s `0o600` is a **no-op against Windows ACLs** — `chmodSync` on Windows only toggles the read-only bit. State this in the runbook rather than relying on it.

**Project-scope (inside the repo — these are the committable risk):**

| Path | Committable? | Note |
|------|-------------|------|
| `.pi/settings.json` | **must be committed** | project harness config, no secrets |
| `.pi/extensions/**`, `.pi/skills/**`, `.pi/prompts/**`, `.pi/themes/**`, `.pi/agents/**` | **must be committed** | the harness itself |
| `.pi/sessions/` | never | reachable via `sessionDir: ".pi/sessions"` — that exact value is the documented example `[CITED: docs/settings.md:216]` |
| `.pi/npm/`, `.pi/git/` | never | project-scope package installs (`src/core/package-manager.ts:2004, 2084`). Pi writes a `.gitignore` containing `*` into these when it creates them (`:1988-1996`) — belt, but add braces |
| `.pi/logs/**`, `.pi/state/**`, `.pi/audit.jsonl`, `.pi/*.jsonl` | never | this project's own Phase 2/4 artifacts |
| `.pi/auth.json` | never | not written by Pi at project scope, but a plausible mistake |

### 6.2 Current `.gitignore` — probed with `git check-ignore`, two real gaps

| Candidate path | Status now |
|---|---|
| `.pi/sessions/x.jsonl` | IGNORED ✓ |
| `.pi/auth.json` | IGNORED ✓ |
| `.pi/logs/wire-2026-08-13.jsonl` | IGNORED ✓ |
| `.pi/audit.jsonl` | IGNORED ✓ |
| `.pi/state/mode.json` | IGNORED ✓ |
| `.pi/npm/node_modules/x` | IGNORED ✓ (only via the global `node_modules/` rule) |
| `.env`, `.env.local`, `auth.json`, `.aws/credentials`, `kubeconfig`, `terraform.tfstate` | IGNORED ✓ |
| `.pi/settings.json`, `.pi/extensions/hello/index.ts`, `package-lock.json` | committable ✓ (correct) |
| **`.pi/git/github.com/a/b`** | **committable ✗ — GAP** |
| **`.npmrc`** | **IGNORED ✗ — BLOCKS BOOT-01** |

`[VERIFIED: executed `git check-ignore -q` in the repo, 2026-08-13]`

**`.gitignore:56` is `.npmrc`.** The repo `.npmrc` that BOOT-01 requires cannot be committed, therefore cannot reach a clone, therefore the one install path it does cover (§1.4 row 2) is also unprotected. This is the highest-value finding in this document: without the fix, BOOT-01 ships a file that exists only on the author's disk.

Fix, verified:

```gitignore
.npmrc          # keep ignoring nested/user npmrc, which may carry _authToken
!/.npmrc        # …but the project-scoped root one is a supply-chain control and MUST be committed
```

`[VERIFIED: executed]` — with those two lines, `git check-ignore -q .npmrc` exits 1 (not ignored) while `git check-ignore -q sub/.npmrc` exits 0 (ignored). Add a content assertion too: the committed root `.npmrc` must contain **only** `ignore-scripts=true` and comments — never `_authToken`, `//registry…:_auth`, or any `_password`. That check belongs in the same test.

Also add: `.pi/npm/` and `.pi/git/`.

### 6.3 SAFE-16 — `/share` and `gh`

Read at source. `handleShareCommand` (`src/modes/interactive/interactive-mode.ts:5855`):

```ts
const authResult = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
if (authResult.status !== 0) {
    this.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
    return;
}
```
`[VERIFIED: src/modes/interactive/interactive-mode.ts:5856-5866]` — and on the success path, the session is exported to `os.tmpdir()/session.html` (`:5869`) before `spawn("gh", ["gist","create","--public=false", tmpFile])` (`:5907`).

`/share` is matched as a literal string inside the interactive editor's submit handler (`:2902`), and appears in the built-in slash-command table (`src/core/slash-commands.ts:25`). It is dispatched before any extension command and before the `input` event — confirming PROJECT.md's claim that no extension can block it. **`gh auth status` returning non-zero is the entire control.**

Two further findings:

- **The scope workaround does not exist.** `gh auth refresh --remove-scopes gist` cannot work: *"The minimum set of scopes (`repo`, `read:org`, and `gist`) cannot be removed."* `[VERIFIED: `gh auth refresh --help`, gh 2.93.0, executed 2026-08-13]`. Dropping only the `gist` scope while keeping `gh` usable for git-over-HTTPS is **impossible**. `gh auth logout` is the only control. Record this as a closed door so nobody re-litigates it.
- **`gh` is currently authenticated on this dev machine** — `gh auth status` exits 0, account `kaiyitkoh`, token scopes `'gist', 'read:org', 'repo', 'workflow'` `[VERIFIED: executed]`. It is there because the git remote is HTTPS and no SSH key exists (CONTEXT.md). So the SAFE-16 test **must not** assert on local machine state; see Decisions taken autonomously #5 and the Validation Architecture entry.

### 6.4 The BOOT-09 test

`git check-ignore -q <path>` is the correct primitive: exit **0 = ignored**, exit **1 = not ignored**. Verified subtleties:

- It works on **paths that do not exist**, so the test needs no fixture files.
- `git check-ignore -v` exits 0 even when the matching rule is a *negation* (it reports the matching line). **Never use `-v`'s exit code**; use `-q`.
- `git add -f` bypasses everything — the test proves policy, not omnipotence. Say so in the docstring rather than overclaiming.

Shape it as a table-driven vitest test with two arrays (`MUST_BE_IGNORED`, `MUST_BE_COMMITTABLE`) so both directions are asserted; a `.gitignore` that ignores `.pi/extensions/` would otherwise pass a one-directional test while breaking the harness.

---

## §7 Repo shape for later phases

Derived from ROADMAP phases 2–11 and `.planning/research/ARCHITECTURE.md:138-206`, reconciled against Pi's verified discovery rules.

```
ky-pi-agent/
├── .npmrc                       # ignore-scripts=true — COMMITTED (see §6.2)
├── .gitattributes               # exists
├── .gitignore                   # needs the two fixes in §6.2
├── package.json                 # pi manifest, peerDeps, exact devDeps, engines
├── package-lock.json            # committed (BOOT-08)
├── tsconfig.json                # noEmit typecheck only
├── vitest.config.ts
├── README.md  LICENSE  CONTRIBUTING.md  CLAUDE.md
├── bin/
│   └── bootstrap.sh             # POSIX sh; --check-only mode for CI
├── scripts/
│   └── check-gh-unauthenticated.sh
├── .pi/                         # dogfood dir AND package.json#pi target
│   ├── settings.json            # committed, no secrets
│   ├── extensions/
│   │   └── harness/index.ts     # Phase 1 sentinel: command + provider
│   │   # P2 diagnostics/  P4 safety/  P5 routing/  P9 workflows/
│   ├── skills/                  # SKILL.md folders (recursive)
│   ├── prompts/                 # FLAT .md only — discovery is non-recursive
│   ├── themes/                  # P11
│   ├── agents/                  # P7 subagent .md definitions
│   └── templates/               # copied to ~ by bootstrap, never read at runtime
├── docs/
│   └── RUNBOOK.md               # created P3; Phase 1 appends the BOOT-01 + SAFE-16 entries
├── tests/
│   ├── unit/                    # gitignore-policy, npmrc-policy, version-check, gh-check
│   └── integration/             # load-path assertions via `pi --offline -a --list-models`
└── .github/workflows/ci.yml
```

Rules this layout obeys, each verified:
- `.pi/extensions/*/index.ts` is auto-discovered project-locally `[VERIFIED: loader.ts:652-684]` **and** reachable from the manifest `[VERIFIED: package-manager.ts:2290-2305]` — one set of files, both paths (§2.3).
- `.pi/prompts/` must be flat `[VERIFIED: package-manager.ts:456-491]`.
- No `.gitignore` inside `.pi/extensions/` (§2.1).
- No build step; jiti loads `.ts` `[CITED: docs/extensions.md:179]`.
- No `bootstrap.ps1` — POSIX `sh` only, and Git Bash is a hard Pi prerequisite on Windows anyway `[CITED: docs/windows.md:3]`.
- Empty future directories need a `.gitkeep`. Note `.gitignore:31` already has a bare `!.gitkeep`.

`.pi/settings.json` at minimum: `{}` plus whatever project config is genuinely needed. Its presence is itself a trust trigger `[CITED: docs/security.md:11-13]`, but `.pi/extensions/` triggers trust anyway, so this costs nothing. **Paths inside `.pi/settings.json` resolve relative to `.pi`, not the repo root** `[CITED: docs/settings.md:238]` — a classic off-by-one-directory trap.

---

## §8 Testing stack bootstrap (BOOT-08)

### 8.1 Versions — pinned to Pi core's own, verified

Pi 0.84.1's own `devDependencies` `[VERIFIED: installed package.json]`:

```
"typescript": "5.9.3",  "vitest": "4.1.9",  "@types/node": "24.12.4"
```

Registry latest as of 2026-08-13: `typescript` 7.0.2, `vitest` 4.1.10, `@types/node` 26.2.0, `typebox` 1.3.13 `[VERIFIED: npm view]`. Deliberately not taken — matching Pi's `.d.ts` is the objective. `vitest@4.1.9` engines: `^20.0.0 || ^22.0.0 || >=24.0.0` `[VERIFIED]`.

### 8.2 `tsconfig.json` — typecheck only, no emit

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": [".pi/extensions/**/*.ts", "tests/**/*.ts", "*.config.ts"]
}
```

Rationale, each tied to a verified fact:
- `noEmit` — jiti compiles at load; a build step breaks `/reload` `[CITED: docs/extensions.md:7,179]`.
- `moduleResolution: "bundler"` + `allowImportingTsExtensions` — Pi's own source imports with explicit `.ts` extensions (e.g. `import { CONFIG_DIR_NAME } from "../config.ts"` at `src/core/package-manager.ts:31`), and jiti resolves them. Without these two, matching that style fails typecheck.
- `verbatimModuleSyntax` — forces `import type`, which is what the extension examples use (`docs/extensions.md:159`).
- `skipLibCheck` — Pi ships a large `.d.ts` surface; checking it is not our job.
- `"type": "module"` in `package.json` matches Pi's own `"type": "module"` `[VERIFIED]`.

### 8.3 The BOOT-08 tensions — both real, both need a planner decision

1. **`peerDependencies: "*"` is mandated but is the opposite of an exact pin.** `docs/packages.md:171` requires the `"*"` range. Resolution: peers are *not third-party dependencies we install* — they are host-provided and jiti-aliased to Pi's bundled copies `[VERIFIED: loader.ts:118-140]`. The exact pin lives in `devDependencies` and in `package-lock.json`. State this in CONTRIBUTING so a future reader does not "fix" the `"*"`.
2. **`pi install https://github.com/kaiyitkoh/ky-pi-agent` is an unpinned git spec.** BOOT-02 mandates that literal command; `docs/packages.md:90` says only `…@ref` forms are pinned. Resolution: our own repo unpinned is acceptable (we control it and `pi update` reconciling to our default branch is desired); **third-party** packages must always carry a ref. Encode that as a lint over `settings.json`: every entry in `packages[]` must match `^npm:.+@[0-9]` or `^(git:|https://|ssh://).+@.+$`. That lint is cheap now and is exactly what Phase 7 needs.

### 8.4 `fauxProvider` — where it lives (for Phase 2, confirmed now)

- Located at `@earendil-works/pi-ai/providers/faux` — `dist/providers/faux.{js,d.ts}` exist and the package `exports` map includes `"./providers/*"` `[VERIFIED: installed @earendil-works/pi-ai@0.84.1]`.
- **Caveat worth carrying forward:** jiti's alias map covers `@earendil-works/pi-ai`, `/compat`, `/oauth`, and `/providers/all` — **not** `/providers/faux` `[VERIFIED: loader.ts:118-140]`. So `fauxProvider` is directly importable in **vitest** (where pi-ai is a real devDependency), but an *extension loaded through jiti* importing that subpath resolves through ordinary node resolution rather than an alias. Phase 2 should keep faux usage in tests, not in extension code.

---

## §9 CONTRIBUTING.md boundary rule (BOOT-10) — grounded at source

The rule: *a new capability defaults to command or skill; registering a tool requires justifying its per-request schema cost.* Three source facts make it verifiable rather than stylistic.

1. **Tool name + description + full JSON Schema ride in every request payload.** `convertTools()` maps each active tool to `{type:"function", function:{name, description, parameters}}`, where `parameters` is the TypeBox-generated JSON Schema verbatim `[VERIFIED: pi-ai src/api/openai-completions.ts:1337-1370]`. This array is rebuilt and sent on every request.
2. **Commands appear nowhere in system-prompt construction.** `src/core/system-prompt.ts` handles `promptGuidelines` (`:16,:33,:108`) and renders a `Guidelines:` section (`:128`); it contains **no reference to registered commands**. Commands are read only by the interactive mode's command list (`interactive-mode.ts:626,694`) `[VERIFIED]`. Per-turn token cost of a command: **zero**.
3. **Adding a tool with prompt metadata invalidates the prompt cache.** `promptGuidelines` bullets are appended flat into the system prompt, so activating such a tool rebuilds the prefix. With DeepSeek cache reads ~50× cheaper than fresh input (PROJECT.md:137), that is an economic cost, not an aesthetic one.

Suggested CONTRIBUTING wording, in the project's own register:

> **Boundary rule.** A new capability is a **command** or a **skill** unless you can state why it must be a tool.
> A tool's `name`, `description` and complete JSON Schema are serialised into `tools[]` on **every** provider request (`pi-ai/src/api/openai-completions.ts:1337`). A command costs **zero** tokens — commands are never rendered into the system prompt (`pi/src/core/system-prompt.ts`). A skill costs ~40–60 tokens for name, description and path; its body loads only when read.
> To register a tool, your PR must answer: (a) must the *model* call this mid-turn, or is the *user* the initiator? (b) what is the measured token cost of its schema? (c) why can a skill not carry this as a procedure? An unanswered (a) is an automatic no.
> Corollary: lazily-loaded tools omit `promptSnippet` and `promptGuidelines` — activating a tool that has them rebuilds the system prompt and invalidates the provider cache prefix.

---

## Standard Stack

### Core

| Package | Version | Purpose | Why this exact version |
|---------|---------|---------|------------------------|
| `@earendil-works/pi-coding-agent` | **0.84.1** | the host being extended | latest on npm; `engines: >=22.19.0` `[VERIFIED: registry + installed package.json]` |
| Node.js | **≥22.19.0** | runtime | hard `engines` requirement `[VERIFIED: installed package.json]` |
| `typescript` | **5.9.3** | authoring | Pi core's own devDependency; latest is 7.0.2 and deliberately not taken `[VERIFIED: installed package.json]` |
| `vitest` | **4.1.9** | tests | Pi core's own devDependency; latest is 4.1.10 `[VERIFIED]` |
| `@types/node` | **24.12.4** | types | Pi core's own devDependency; latest is 26.2.0 `[VERIFIED]` |
| `typebox` | **1.3.7** (peer `"*"`) | tool schemas | Pi bundles 1.3.7; jiti aliases both `typebox` and `@sinclair/typebox` to it `[VERIFIED: installed package.json; loader.ts:133-139]` |
| `jiti` | 2.7.0 (bundled by Pi) | TS loading | Pi's own dependency — never declare it `[VERIFIED: installed package.json]` |

### Supporting

| Package | Version | Purpose | When |
|---------|---------|---------|------|
| `@earendil-works/pi-ai` | 0.84.1 (peer `"*"`, dev-pinned) | `Type`, `StringEnum`, `fauxProvider` | dev/test only in Phase 1 |
| `shellcheck` | 0.9.0 (runner-preinstalled) | POSIX conformance gate | CI Ubuntu job only — not installed locally or on the matrix |

### Alternatives considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| repo `.npmrc` alone | `~/.npmrc` global | rejected by the user: breaks native builds machine-wide. The `~/.pi/agent/npm/.npmrc` control gets the coverage without the blast radius |
| `package-lock.json` | `npm-shrinkwrap.json` | shrinkwrap only matters when published to npm — a Deferred Idea. Pi installs our repo at the clone *root*, where the lockfile applies |
| Ubuntu shellcheck job | `choco install shellcheck` / `brew install shellcheck` on the matrix | adds install time and a package manager dependency to both matrix legs for zero extra signal |
| `pi -a --list-models` sentinel | a full `pi --mode json -p "…"` smoke test | requires credentials; none exist on this machine or in CI |
| vitest | `node --test` via tsx | loses watch/mocking ergonomics and diverges from Pi core |

**Installation:**

```bash
npm install --save-dev --save-exact \
  @earendil-works/pi-coding-agent@0.84.1 \
  @earendil-works/pi-ai@0.84.1 \
  typebox@1.3.7 typescript@5.9.3 vitest@4.1.9 @types/node@24.12.4
```

`--save-exact` matters: without it npm writes `^`, and BOOT-08 says exact. Configure it durably by adding `save-exact=true` to the committed `.npmrc` alongside `ignore-scripts=true`.

---

## Package Legitimacy Audit

Ecosystem: **npm** (forced explicitly — `slopcheck` auto-detected PyPI from the working directory and reported `typebox` and `@types/node` as hallucinated, which is an ecosystem artefact, not a finding).

| Package | Registry | Age / latest | Source repo | slopcheck (npm) | Postinstall | Disposition |
|---------|----------|--------------|-------------|-----------------|-------------|-------------|
| `typescript` | npm | 7.0.2 latest; 5.9.3 pinned | microsoft/TypeScript | `[OK]` | none | Approved |
| `@types/node` | npm | 26.2.0 latest; 24.12.4 pinned | DefinitelyTyped | `[OK]` | none | Approved |
| `typebox` | npm | 1.3.13 latest; 1.3.7 peer | sinclairzx81/typebox | `[OK]` | n/a (peer, never installed) | Approved |
| `vitest` | npm | 4.1.10 latest; 4.1.9 pinned | vitest-dev/vitest | `[SUS]` — "suspiciously close to 'vite'" | none | **Approved — false positive.** Pure name-similarity heuristic. `vitest` is Pi core's own declared devDependency at exactly 4.1.9 `[VERIFIED: installed package.json]` |
| `@earendil-works/pi-coding-agent` | npm | 0.84.1 | earendil-works/pi-mono | `[OK]` | none | Approved |
| `@earendil-works/pi-ai` | npm | 0.84.1 | earendil-works/pi-mono | `[OK]` (info: "name ends with -ai … package is established") | none | Approved |

**Removed due to `[SLOP]`:** none.
**Flagged `[SUS]`:** `vitest` — dismissed with source-level evidence above; no `checkpoint:human-verify` needed.
**Postinstall audit:** `npm view <pkg> scripts.postinstall` returned empty for all three installed dev deps `[VERIFIED: executed]`.

Tooling: `slopcheck` 0.6.1, invoked as `python -m slopcheck scan --pkg npm <name> --json`. Note for future phases: **always pass `--pkg npm`**; the default ecosystem detection is wrong in this repo and `slopcheck install` will happily `pip install` a same-named PyPI package.

---

## Architecture Patterns

### System architecture — install and load flows

```
COLD MACHINE
     │
     ├─► sh bin/bootstrap.sh
     │      │
     │      ├─ require_node()  ────────────► FAIL: "Node X < 22.19.0"
     │      ├─ probe bash/git/gh/aws/glab ─► WARN on optional, FAIL on required
     │      ├─ check_pi_version_published() ┐
     │      │      npm view pkg@PIN --json  │ E404 ─► FAIL naming version + fallback
     │      │                               │ other non-zero ─► FAIL "registry unreachable"
     │      ├─ write ~/.pi/agent/npm/.npmrc  ◄── CONTROL 2  (must precede any pi install)
     │      ├─ assert repo/.npmrc = true     ◄── CONTROL 1
     │      ├─ assert prefix npmrc = true    ◄── verifies CONTROL 2 took
     │      ├─ npm i -g --ignore-scripts pi@PIN
     │      ├─ marked-region merge into ~/.pi/agent/settings.json   (idempotent)
     │      └─ write .env.example / templates
     │
     ├─► PATH A: pi install https://github.com/kaiyitkoh/ky-pi-agent
     │      git clone ──► ~/.pi/agent/git/github.com/kaiyitkoh/ky-pi-agent
     │      npm install --omit=dev   (cwd = clone; reads the CLONE's .npmrc ✓)
     │      settings.json packages[] += source
     │      startup ──► readPiManifest ──► ./.pi/extensions ──► collectAutoExtensionEntries
     │                                                              │
     └─► PATH B: cd ky-pi-agent && pi                               │
            project_trust gate ──(declined)──► resources skipped    │
                   │ (trusted / -a)                                 │
                   └─► .pi/extensions/*/index.ts ───────────────────┤
                                                                    ▼
                                                          jiti load (aliases
                                                          @earendil-works/*,
                                                          typebox → Pi's copies)
                                                                    │
                                                                    ▼
                                                    pi.registerCommand (0 tok)
                                                    pi.registerProvider ──► visible in
                                                                            `pi --list-models`
                                                                            ◄── CI assertion
```

### Pattern 1: Sentinel-provider load proof

**What:** the hello-world extension registers a provider whose model id is a unique sentinel string.
**Why:** it is the only way found to prove extension load without credentials, a TTY, or a model call. `--list-models` renders registered providers; `pi.registerProvider` calls from a factory are queued and flushed at runner init `[CITED: docs/extensions.md:1709]`.

```typescript
// .pi/extensions/harness/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SELFTEST_MODEL_ID = "ky-harness-selftest";

export default function (pi: ExtensionAPI) {
  // Command, not tool — the BOOT-10 boundary rule, dogfooded on day one.
  pi.registerCommand("ky-hello", {
    description: "ky-pi-agent liveness check",
    handler: async (_args, ctx) => { ctx.ui.notify("ky-pi-agent loaded", "info"); },
  });

  // A dead-endpoint provider whose sole purpose is to be observable in `pi --list-models`.
  pi.registerProvider("ky-harness", {
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "unused",
    api: "openai-completions",
    models: [{
      id: SELFTEST_MODEL_ID, name: SELFTEST_MODEL_ID,
      reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192, maxTokens: 1024,
    }],
  });
}
```

`[VERIFIED: this exact shape executed successfully in all three load modes on 2026-08-13]`

Remove or gate the provider once Phase 3 lands real providers, or it will clutter the `/model` picker.

### Pattern 2: Ordered supply-chain preflight

**What:** every `.npmrc` control is written *and re-read through `npm config get`* before the first `pi install`.
**Why:** writing a file proves nothing — `npm config get` proves npm actually resolves it, which is precisely the assumption that turned out false in §1.3. Assert the effect, never the file.

### Pattern 3: Table-driven, bidirectional ignore test

```typescript
const MUST_BE_IGNORED = [
  ".pi/sessions/s.jsonl", ".pi/logs/wire.jsonl", ".pi/audit.jsonl",
  ".pi/state/mode.json", ".pi/auth.json", ".pi/npm/package.json",
  ".pi/git/github.com/o/r/package.json", ".env", ".env.local",
  "auth.json", "models.local.json", ".aws/credentials", "kubeconfig",
  "terraform.tfstate", "x.pem", "id_rsa", "sub/.npmrc",
];
const MUST_BE_COMMITTABLE = [
  ".npmrc", ".pi/settings.json", ".pi/extensions/harness/index.ts",
  ".pi/skills/x/SKILL.md", ".pi/prompts/quick.md", ".pi/themes/ky.json",
  "package.json", "package-lock.json", "bin/bootstrap.sh",
  ".github/workflows/ci.yml", "docs/RUNBOOK.md",
];
// isIgnored(p) === spawnSync("git", ["check-ignore", "-q", p]).status === 0
```

Both directions matter: a `.gitignore` that swallowed `.pi/extensions/` would pass a one-directional test and silently break the harness.

### Pattern 4: Idempotent marked regions

```
// ky-pi-agent managed:start
  … generated JSON/text …
// ky-pi-agent managed:end
```

Replace only between the markers; append the block if absent; never rewrite the whole file. For `~/.pi/agent/settings.json` (real JSON, no comments allowed) the equivalent is a **key-namespaced merge**: read, `JSON.parse`, replace only keys the harness owns, write back with the original indentation. Do the parse/merge in `node -e`, not in shell — `jq` is **not installed on this machine** (Environment Availability below).

### Anti-patterns to avoid

- **Asserting the repo `.npmrc` exists and calling BOOT-01 done.** It does not cover `pi install npm:*`. Proven, §1.3.
- **`git check-ignore -v` exit codes.** Returns 0 on a *negation* match. Use `-q`.
- **`jq` in bootstrap or CI.** Absent here; node is present by definition.
- **`shell:` omitted in a workflow step.** Windows defaults to pwsh, and the POSIX script silently never runs as intended.
- **Treating any non-zero `npm view` exit as "unpublished".** Offline users get a false yank alarm.
- **A `.gitignore` inside `.pi/extensions/`.** Honoured by package-path discovery (`package-manager.ts:571`) and would silently drop extensions from the `pi install` path while leaving the dogfood path working — the worst possible failure shape.
- **Registering a tool in the hello-world.** Contradicts BOOT-10 on the first commit.
- **`sort -V` / bash-4 syntax in bootstrap.** macOS runner is bash 3.2 and BSD userland.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| "is this path ignored?" | a `.gitignore` parser | `git check-ignore -q` | negation, precedence, nested files, `.git/info/exclude`, core.excludesFile — git is the only correct oracle |
| "does npm honour our config?" | reading `.npmrc` and diffing | `npm config get <key> [--prefix <dir>]` | the whole bug in §1 is that file location ≠ effective config |
| "is this version published?" | HTTP GET on registry.npmjs.org | `npm view <pkg>@<ver> version --json` | honours registry config, auth, proxies; documented JSON error shape |
| "did the extension load?" | parsing Pi logs | `pi --offline -a --list-models` + sentinel grep | a supported, credential-free, exit-coded surface |
| line-ending normalisation | a checkout hook | `.gitattributes` `eol=lf` | proven to beat `core.autocrlf`; runs before any hook could |
| POSIX-sh conformance | a custom linter | `shellcheck --shell=sh` | Git-Bash `sh` and macOS `/bin/sh` are both bash-in-posix-mode; execution cannot prove conformance |
| Node version comparison in sh | `sort -V` / string compare | `node -e` on `process.versions.node` | no `sort -V` on BSD; node is a hard prerequisite anyway |
| JSON edits in bootstrap | `sed`/`awk` on JSON | `node -e` read-parse-merge-write | `jq` is not installed here; sed-on-JSON is how settings files get corrupted |

**Key insight:** every control in this phase is a claim about a *third-party tool's effective behaviour* — npm's config resolution, git's ignore precedence, GitHub's shell selection, Pi's discovery order. In every single case the only trustworthy verification is to ask that tool, not to inspect the file you wrote for it. §1.3 is the proof: a correct file in a plausible location, and the postinstall still ran.

---

## Runtime State Inventory

This phase creates state outside the repo. Enumerated so the plan can make each step idempotent and reversible.

| Category | Items | Action required |
|----------|-------|-----------------|
| Stored data | None — no database or datastore exists yet | None. Verified: repo contains only planning artifacts, README, LICENSE, `.gitignore`, `.gitattributes`, CLAUDE.md |
| Live service config | `~/.pi/agent/settings.json` (`packages[]` gains our repo after `pi install`); `~/.pi/agent/trust.json` (gains a decision when the repo is trusted). Neither is in git | Marked-region / key-namespaced merge, never whole-file rewrite. Bootstrap must be safe to re-run. Document `pi remove <source>` as the undo |
| OS-registered state | Global npm install of `@earendil-works/pi-coding-agent@0.84.1` into `C:\Users\Admin\AppData\Roaming\npm` (present already at 0.84.1). No scheduled tasks, services or daemons | Bootstrap must detect an existing correct version and no-op rather than reinstall |
| Secrets / env vars | `gh` credential in the OS keyring — **already authenticated on this machine with `gist` scope** (`gh auth status` exit 0). No `~/.pi/agent/auth.json` is written by this phase. `.env.example` is a template with no values | Do **not** log the user out on the dev machine — it is how git-over-HTTPS authenticates (no SSH key). SAFE-16 applies to the work laptop and belongs in the runbook |
| Build artifacts | None — the "no build step" decision means no `dist/`. `node_modules/` and `package-lock.json` are created by the first `npm install` | `package-lock.json` is committed (BOOT-08); `node_modules/` already ignored |

**The canonical question — after every file in the repo is correct, what machine state still matters?** Three things: (1) whether `~/.pi/agent/npm/.npmrc` exists, because the repo cannot reach that directory; (2) whether `gh` is logged in, because no repo file can change it; (3) whether the globally installed Pi is the pinned version, because a stale global Pi silently changes extension-API behaviour. All three are bootstrap responsibilities and all three must be re-checkable by `bootstrap.sh --check-only`.

---

## Common Pitfalls

### Pitfall 1: The `.npmrc` that protects nothing

**What goes wrong:** repo `.npmrc` with `ignore-scripts=true` is committed, the box is ticked, and `pi install npm:some-extension` executes a `postinstall` with full user permissions on a laptop holding live AWS SSO credentials.
**Why:** npm resolves the project config from `--prefix` when given, and Pi always passes `--prefix` on the npm path (`package-manager.ts:1778`).
**How to avoid:** write `~/.pi/agent/npm/.npmrc` too, and assert with `npm config get ignore-scripts --prefix "$HOME/.pi/agent/npm"`.
**Warning sign:** a bootstrap that checks a *file's existence* rather than `npm config get` output.

### Pitfall 2: `.gitignore` swallows the control file

**What goes wrong:** `.gitignore:56` is `.npmrc`; the control file is never committed; a fresh clone (including the one Pi makes) has no protection.
**Why:** the ignore rule was written for `.npmrc` files carrying `_authToken`, which is correct for nested/user npmrc and wrong for a root policy file.
**How to avoid:** `!/.npmrc` negation plus a content assertion that the committed file carries no auth token.
**Warning sign:** `git status` never shows `.npmrc` as untracked.

### Pitfall 3: The project-trust silent zero

**What goes wrong:** CI runs `pi --list-models | grep sentinel`, gets nothing, and the "fix" is to weaken the assertion.
**Why:** non-interactive modes never prompt for trust and default to `"ask"`, which *ignores* project resources `[CITED: docs/security.md:27]`.
**How to avoid:** `-a` in every CI invocation, and keep the no-`-a` control case as its own asserted test so the gate itself is proven live.
**Warning sign:** the assertion passes locally (where `trust.json` has a saved decision) and fails in CI.

### Pitfall 4: `shell:` omitted on the Windows leg

**What goes wrong:** the step runs under pwsh; `sh bin/bootstrap.sh` either errors oddly or PowerShell mangles quoting, and someone "fixes" it with a `.ps1`.
**Why:** pwsh is the Windows-runner default `[CITED: docs.github.com workflow-syntax]`.
**How to avoid:** `defaults: { run: { shell: bash } }` at workflow level.

### Pitfall 5: `.gitignore` inside `.pi/extensions/`

**What goes wrong:** extensions load when you `cd` into the repo but vanish for anyone who `pi install`s it.
**Why:** the package discovery path reads `.gitignore` in the scanned directory (`package-manager.ts:249,571`); the project-local path does not (`loader.ts:652-684`). The two paths disagree.
**Warning sign:** BOOT-05 green, BOOT-02 red, with no error message anywhere.

### Pitfall 6: Double registration from dogfood + global install

**What goes wrong:** duplicate commands in the palette after the user does both.
**Why:** dedup is by canonical path; clone and repo are different paths (§2.4).
**How to avoid:** README states dogfood *or* global, not both. Non-fatal, so do not over-engineer it.

### Pitfall 7: `slopcheck` on the wrong ecosystem

**What goes wrong:** `slopcheck install <npm names>` in this repo resolves against **PyPI**, declares `typebox` and `@types/node` hallucinated, and *actually pip-installs* a same-named PyPI package for anything that does exist.
**Why:** ecosystem auto-detection from project files; this repo currently has no `package.json` at all.
**How to avoid:** always `--pkg npm` / `--ecosystem npm`. Encountered and recovered from during this research session.

---

## Code Examples

### Committed `.npmrc` (repo root)

```ini
# ky-pi-agent supply-chain control. See CONTRIBUTING.md and docs/RUNBOOK.md.
#
# Pi runs npm lifecycle scripts with no --ignore-scripts on any code path
# (src/core/package-manager.ts:1750, :1778 in pi 0.84.1), while installing
# *itself* with --ignore-scripts (src/config.ts:174). This file closes the gap
# for installs whose npm cwd is this repo — which is the developer's own
# `npm install`, and the `npm install --omit=dev` Pi runs inside a clone of
# THIS repo (package-manager.ts:1829).
#
# It does NOT cover `pi install npm:...`, because Pi passes --prefix and npm
# resolves the project config from --prefix, not cwd. That gap is closed by
# ~/.pi/agent/npm/.npmrc, written by bin/bootstrap.sh.
#
# Deliberately NOT in ~/.npmrc: a global ignore-scripts breaks legitimate
# native builds (sharp, better-sqlite3, node-gyp) machine-wide.
ignore-scripts=true
save-exact=true
```

### Bootstrap: write and verify control 2

```sh
PI_NPM_ROOT="${HOME}/.pi/agent/npm"

harden_pi_npm_root() {
    mkdir -p "$PI_NPM_ROOT"
    rc="${PI_NPM_ROOT}/.npmrc"
    if [ ! -f "$rc" ] || ! grep -q '^ignore-scripts=true' "$rc"; then
        printf '# Written by ky-pi-agent bin/bootstrap.sh. See docs/RUNBOOK.md.\nignore-scripts=true\n' > "$rc"
    fi
    got=$(npm config get ignore-scripts --prefix "$PI_NPM_ROOT" 2>/dev/null)
    [ "$got" = "true" ] || {
        echo "FATAL: ignore-scripts not effective for ${PI_NPM_ROOT} (got: ${got})" >&2
        echo "       Refusing to continue: pi install npm:* would run lifecycle scripts." >&2
        exit 1
    }
}
```

### `scripts/check-gh-unauthenticated.sh` (SAFE-16)

```sh
#!/bin/sh
# SAFE-16. /share exports the session and uploads it as a secret gist.
# It cannot be blocked by any extension: it is matched as a literal string in
# the interactive submit handler before extension commands and before the
# `input` event (pi 0.84.1 src/modes/interactive/interactive-mode.ts:2902).
# The ONLY control is `gh auth status` exiting non-zero
# (interactive-mode.ts:5858-5861).
#
# Note: dropping only the gist scope is impossible — `gh auth refresh --help`
# states repo, read:org and gist are the non-removable minimum set.
# Logging out is the control.
set -e
warn_only=0
[ "$1" = "--warn-only" ] && warn_only=1

if ! command -v gh >/dev/null 2>&1; then
    echo "OK: gh is not installed; /share cannot upload."; exit 0
fi
if gh auth status >/dev/null 2>&1; then
    echo "gh IS authenticated. /share can upload this session to a GitHub gist." >&2
    echo "On the work laptop, run: gh auth logout" >&2
    [ "$warn_only" -eq 1 ] && exit 0
    exit 1
fi
echo "OK: gh is unauthenticated; /share aborts before export."
```

Dev machine runs it with `--warn-only`; the work-laptop runbook runs it bare.

---

## State of the Art

| Old approach | Current approach | Impact |
|--------------|------------------|--------|
| "one `~/.npmrc` line fixes `pi install`" (PROJECT.md:148) | four scoped controls; the repo one covers 2 of 6 install shapes | PROJECT.md:148 is **falsified as stated** — `~/.npmrc` *would* have worked, but the user rejected it, and the accepted substitute does not cover the same paths without control 2 |
| Manual "does it load?" check | `pi --offline -a --list-models` + sentinel | BOOT-02/BOOT-05 become CI-assertable with zero credentials |
| `.gitignore` reviewed by eye | `git check-ignore -q` table test, both directions | BOOT-09 becomes a real gate; found 2 live gaps immediately |
| Pin from research memory | `npm view` at plan time | `typescript` moved to 7.0.2 and `vitest` to 4.1.10 since the research doc; Pi's own pins are still 5.9.3/4.1.9 |

**Deprecated / do not use:**
- `@sinclair/typebox` — jiti aliases it to unscoped `typebox` anyway (`loader.ts:137-139`), but declaring it is still wrong; use unscoped `typebox`.
- `@earendil-works/pi-coding-agent@0.74.2` (`legacy-node20`) — ten minors stale; only exists for Node 20.
- `gh auth refresh --remove-scopes gist` as a `/share` mitigation — **impossible**, verified.

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.16.0 (≥22.19.0) | — |
| npm | BOOT-01/03/04/08 | ✓ | 11.13.0 | — |
| `pi` | BOOT-02/05 | ✓ | 0.84.1 (global) | — |
| bash (Git Bash) | BOOT-06, Pi on Windows | ✓ | 5.3.9 at `/usr/bin/bash`; Pi's lookup finds `C:\Program Files\Git\bin\bash.exe` | — |
| git | everything | ✓ | 2.54.0.windows.1 | — |
| `gh` | SAFE-16 | ✓ | 2.93.0 — **authenticated, `gist` scope** | — |
| `aws` | BOOT-03 probe | ✓ | AWS CLI v2 | probe warns, never fails |
| `glab` | BOOT-03 probe | **✗** | — | probe **warns**; GitLab work is Phase 4/9 and lives on the work laptop |
| `jq` | — | **✗** | — | **use `node -e` for all JSON.** Do not introduce a jq dependency |
| `shellcheck` | BOOT-06 | ✗ locally, ✗ on both matrix runners, ✓ on `ubuntu-latest` (0.9.0) | — | dedicated Ubuntu lint job |
| `curl` | — | ✓ | mingw64 | — |
| Python | slopcheck only | ✓ | 3.14 + slopcheck 0.6.1 | — |

**Missing with no fallback:** none.
**Missing with fallback:** `glab` (warn-only probe), `jq` (use node), `shellcheck` (Ubuntu job).

---

## Validation Architecture

### Test framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 |
| Config file | **none — Wave 0 creates `vitest.config.ts`** |
| Quick run (per task commit) | `npx vitest run tests/unit` |
| Full suite (per wave merge) | `npx vitest run && npx tsc --noEmit` |
| Phase gate | full suite green on `windows-latest` **and** `macos-latest`, plus the Ubuntu shellcheck job |

### Requirements → test map

| Req | Observable signal | Sampling method (exact command) | Failure mode it catches | Offline? |
|-----|-------------------|--------------------------------|-------------------------|----------|
| BOOT-01 | `npm config get ignore-scripts` = `true` for **repo root**, `~/.pi/agent/npm`, and `<repo>/.pi/npm` | `npx vitest run tests/unit/npmrc-policy.test.ts` — spawns `npm config get ignore-scripts` with cwd/`--prefix` per scope; plus an end-to-end case installing a local fixture package with a `postinstall` and asserting the sentinel file is **absent** | the §1.3 failure: file present, effective config false, script runs anyway | ✅ (local fixture, no registry) |
| BOOT-01 (ordering) | bootstrap exits non-zero **before** any `pi install` when the control is absent | `sh bin/bootstrap.sh --check-only` under a `PI_CODING_AGENT_DIR` pointing at a temp dir with no `.npmrc` → expect exit 1 and the word `ignore-scripts` on stderr | a policy applied after code already executed | ✅ |
| BOOT-02 | sentinel model id in `--list-models` when the package is loaded from an unrelated cwd | `cd $(mktemp -d) && pi --offline -e "$REPO" --list-models \| grep -q ky-harness-selftest` | broken `pi` manifest, wrong relative path, dot-prefix/glob resolution failure | ✅ |
| BOOT-02 (real clone) | same, through an actual `git clone` + `npm install --omit=dev` | `git clone "$REPO" "$T" && (cd "$T" && npm install --omit=dev) && pi --offline -e "$T" --list-models \| grep -q …` | `.npmrc` or manifest files not actually committed; devDeps needed at runtime | ✅ (clones the local path, no network) |
| BOOT-03 | every probe reports, required tools fail, optional tools warn | `sh bin/bootstrap.sh --check-only` asserted for exit 0 and for the strings `glab` + `optional`; a second run asserts byte-identical output (idempotence) | non-idempotent edits; a missing optional tool aborting the run | ✅ |
| BOOT-04 | actionable message naming version + fallback | unit test invoking the version-check function with `PI_PINNED=0.73.0` → expect exit 1, stderr containing `0.73.0` and `Fallback`; a second case simulating a network error → expect a *different*, non-"unpublished" message | telling an offline user their pinned Pi was yanked | ⚠️ needs the registry for the true-negative case; use a recorded fixture for the offline leg |
| BOOT-05 | sentinel present with `-a`, **absent** without | `cd "$REPO" && pi --offline -a --list-models \| grep -q …` **and** `pi --offline --list-models \| grep -qv …` | silently asserting nothing because the trust gate ate the resources | ✅ |
| BOOT-05 (`/reload`) | extension re-registers after reload | ⚠️ `/reload` needs an interactive session; **assert structurally instead**: every shipped extension lives under an auto-discovered path (`.pi/extensions/*.ts` or `*/index.ts`), which is the documented precondition for hot-reload (`docs/extensions.md:7`) | an extension wired only through `-e`, which cannot hot-reload | ✅ (structural) |
| BOOT-06 | no `\r` in any tracked `*.sh`; shellcheck clean | matrix: `node`-based CR scan over `git ls-files '*.sh'`; ubuntu: `shellcheck --shell=sh $(git ls-files '*.sh')` | CRLF checkout on Windows; bashisms that die on macOS bash 3.2 | ✅ |
| BOOT-07 | both matrix legs green | the workflow itself, `fail-fast: false` | a macOS-only break invisible on this machine | ✅ in CI |
| BOOT-08 | no `^`/`~`/`*` in `dependencies`/`devDependencies`; lockfile committed; every `settings.json` `packages[]` entry carries a version or ref | `npx vitest run tests/unit/pinning.test.ts` — parses `package.json` (allow-listing only the five documented peers), asserts `package-lock.json` is tracked via `git ls-files`, regex-checks package specs | a caret pin drifting the tree; an unpinned third-party extension source |  ✅ |
| BOOT-09 | `git check-ignore -q` verdict for every path in both tables | `npx vitest run tests/unit/gitignore-policy.test.ts`; plus a content assertion that the committed `.npmrc` has no `_authToken`/`_auth`/`_password` | the two live gaps found in §6.2; a future rule swallowing `.pi/extensions/` | ✅ |
| BOOT-10 | `CONTRIBUTING.md` exists and contains the rule; no tool is registered anywhere in `.pi/extensions/**` in Phase 1 | test asserts the file matches `/default.*command or skill/i` **and** that `grep -r "registerTool" .pi/extensions` finds nothing | writing the rule and breaking it in the same commit | ✅ |
| SAFE-16 | the check script classifies both states correctly; README + runbook state the control | unit test invoking `scripts/check-gh-unauthenticated.sh` with a **stubbed `gh` on `PATH`** returning exit 0 then exit 1, asserting the script's exit code inverts; plus a docs-content assertion | asserting on real machine state and failing for a developer legitimately logged in | ✅ — **but the live control is [RUNBOOK]-shaped: `gh auth logout` on the work laptop stays OUTSTANDING** |

### Sampling rate

- **Per task commit:** `npx vitest run tests/unit`
- **Per wave merge:** `npx vitest run && npx tsc --noEmit`
- **Phase gate:** full CI green on `windows-latest` + `macos-latest` + the Ubuntu shellcheck job, before `/gsd:verify-work`

### Wave 0 gaps

- [ ] `package.json` — no manifest exists; everything below depends on it
- [ ] `vitest.config.ts` — no test framework configured
- [ ] `tsconfig.json` — no typecheck
- [ ] `tests/helpers/git.ts` — `isIgnored(path)` wrapper around `git check-ignore -q`
- [ ] `tests/helpers/pi.ts` — `runPi(args, cwd)` wrapper capturing stdout/exit
- [ ] `tests/helpers/stub-bin.ts` — PATH-prepending stub factory (needed for the `gh` test)
- [ ] `tests/fixtures/evil-postinstall/` — local package with a sentinel-writing `postinstall` (BOOT-01 end-to-end)
- [ ] **`.gitignore` fixes — `!/.npmrc`, `.pi/npm/`, `.pi/git/`. Blocking: BOOT-01 is unshippable until the first one lands**
- [ ] Framework install: `npm install --save-dev --save-exact vitest@4.1.9 typescript@5.9.3 @types/node@24.12.4 @earendil-works/pi-coding-agent@0.84.1 @earendil-works/pi-ai@0.84.1 typebox@1.3.7`

### Outstanding (not verifiable here)

- **SAFE-16 live:** `gh auth logout` on the work laptop, confirmed by `gh auth status` exiting non-zero. Runbook entry is a Phase 1 deliverable; the check stays **OUTSTANDING**.
- **BOOT-02 against the real GitHub URL:** requires a clean profile and network; the local-clone test above is the offline proxy. Add a runbook line.
- **`/reload` behavioural proof:** requires an interactive TTY session. Structural assertion only; note in the runbook.

---

## Security Domain

`security_enforcement` is not set to `false`, so this section applies. Phase 1 is infrastructure, not an application; most ASVS categories do not apply, and saying so explicitly is more useful than inventing controls.

### Applicable ASVS categories

| ASVS category | Applies | Standard control |
|---------------|---------|------------------|
| V2 Authentication | no | no authentication surface in this phase |
| V3 Session Management | no | no sessions |
| V4 Access Control | **partial** | Pi's project-trust gate is an input-loading guard, not a security boundary `[CITED: docs/security.md:31]`. Treated as such throughout |
| V5 Input Validation | **yes** | version strings and package specs parsed with explicit patterns; the pinning lint is itself input validation over `settings.json` |
| V6 Cryptography | no | nothing cryptographic is authored; `auth.json`'s `0o600` is Pi's, and is a no-op on Windows ACLs |
| **V14 Configuration** | **yes — the whole phase** | `ignore-scripts`, exact pins, committed lockfile, pinned action SHAs, no secrets in the repo |
| **V10 Malicious Code** | **yes — the whole phase** | npm lifecycle scripts are arbitrary code executing with full user permissions before Pi's extension loader or trust prompt run |

### Known threat patterns for this stack

| Pattern | STRIDE | Standard mitigation | Status after this phase |
|---------|--------|--------------------|------------------------|
| Malicious `postinstall` during `pi install` | Elevation of Privilege | `ignore-scripts` at every install cwd/prefix Pi uses | **Mitigated for npm-source and our-own-clone paths; residual gap on third-party *git* packages** (fresh clone dir; §1.5) |
| Dependency confusion / typosquat | Spoofing | slopcheck + exact pins + committed lockfile | Mitigated for Phase 1's six packages; Phase 7 must re-run |
| Credential exfiltration via committed secret | Information Disclosure | `.gitignore` + `git check-ignore` test | Mitigated once the §6.2 fixes land |
| Session transcript exfiltration via `/share` | Information Disclosure | `gh` logged out (only control; verified no alternative) | **Control identified and scripted; live application to the work laptop is OUTSTANDING** |
| Supply-chain drift on an unpinned CI action | Tampering | pin `uses:` by commit SHA | Planner must enforce; tags are mutable |
| Unpinned git package source moving under you | Tampering | `…@<tag-or-sha>` on every third-party source | Lint specified in §8.3 |
| Stale global Pi silently changing extension-API behaviour | Tampering | bootstrap asserts the installed global version equals the pin | Specified in Runtime State Inventory |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | Writing `~/.pi/agent/npm/.npmrc` survives Pi's own management of that directory | §1.5 control 2 | Low. `ensureNpmProject` only creates `package.json` and `.gitignore` when **absent** and never deletes (`package-manager.ts:1975-1996`), so the file should persist — but I did not run a `pi install` to observe a full cycle. **Verify in Wave 1 with a real install into a throwaway `PI_CODING_AGENT_DIR`.** |
| A2 | `pi install https://github.com/kaiyitkoh/ky-pi-agent` against the real remote behaves as `pi -e <local dir>` did | §2.3 | Low-medium. The code path is read and verified; the *network* leg was not exercised. Mitigated by the local-clone test. |
| A3 | `actions/checkout` needs no line-ending configuration | §4.1 | Low. `eol=lf` overriding `core.autocrlf` was proven locally with git 2.54; runner git is 2.55. The CI CR-scan is the backstop that makes being wrong loud. |
| A4 | ShellCheck 0.9.0 on `ubuntu-latest` is stable enough to depend on | §4.3 | Low. Read from the current runner-images manifest; runner images change. Failure mode is a red lint job, not a false green. |
| A5 | `--offline` does not suppress extension loading | §2.3 | **Low — actually verified**: `pi --offline -a --list-models` returned the sentinel. Listed here only because I did not read `--offline`'s implementation. |
| A6 | No Phase 1 requirement is formally `[RUNBOOK]` | Phase Requirements | Low — read directly from REQUIREMENTS.md:16-25 and :68; none of BOOT-01..10 or SAFE-16 carries a tag. SAFE-16's *live* control is nonetheless work-laptop-only and is treated as outstanding. |

---

## Open Questions

1. **Does a `pi install` into a hardened `~/.pi/agent/npm` leave the `.npmrc` intact across install, update and remove?**
   - Known: Pi only writes `package.json`/`.gitignore` there when absent, and never removes the directory (`package-manager.ts:1975-1996`).
   - Unclear: whether `npm uninstall --prefix` or a future Pi version prunes the directory.
   - Recommendation: bootstrap re-asserts on every run (already specified), and `--check-only` makes it cheap to re-verify. No blocker.

2. **Should the repo also ship `.pi/npm/.npmrc` for project-scope installs?**
   - Known: project-scope installs use `--prefix <repo>/.pi/npm` (`package-manager.ts:2004`), which the repo-root `.npmrc` does not cover.
   - Unclear: whether this project will ever use `pi install -l`.
   - Recommendation: ship it. One file, closes a whole row of the coverage matrix, and `docs/packages.md:43` notes Pi auto-installs missing *project* packages on startup after trust — which is exactly the unattended case worth covering.

3. **How should the `.pi/git/` ignore rule interact with Pi's own auto-written `.gitignore`?**
   - Known: Pi writes `*\n!.gitignore\n` into install roots it creates (`package-manager.ts:1988-1996`).
   - Unclear: only whether that file is created before or after the first thing lands in it.
   - Recommendation: add the explicit rule anyway. Redundant is correct here.

---

## Project Constraints (from CLAUDE.md)

Directives extracted from `./CLAUDE.md` that bind this phase; the planner should verify each plan against them.

- Ship `.ts` directly; **no build step** (jiti loads TypeScript; a build breaks `/reload`).
- Never bundle `@earendil-works/*` or `typebox` — `peerDependencies: "*"`.
- Unscoped `typebox`, never `@sinclair/typebox`.
- TypeScript **5.9.3**, vitest **4.1.9** — match Pi, not latest.
- `keywords: ["pi-package"]`.
- POSIX `sh` throughout; never PowerShell.
- `.gitattributes` with `* text=auto eol=lf` and `*.sh text eol=lf`.
- Never write a bare `npm:pkg` or an unrefed git URL into `settings.json` for third-party packages.
- Pin exact versions; review or vendor anything in the tool-execution or credential path.
- Public repo: no credential may ever be committed.
- Prefer Pi's own bundled examples over third-party extensions.
- GSD workflow enforcement: file changes go through a GSD command.

---

## Sources

### Primary (HIGH confidence — read or executed at source this session)

Installed package root: `C:/Users/Admin/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent` (0.84.1). TypeScript recovered from `dist/**/*.js.map` `sourcesContent` (198 files) into the session scratchpad; `@earendil-works/pi-ai` recovered likewise (173 files).

- `src/core/package-manager.ts` — `:6-23` env inheritance; `:203,:245-263` ignore-file handling; `:456-491` non-recursive prompt discovery; `:530-612` extension discovery; `:1740-1785` npm command construction and `installNpm`; `:1804-1836` `installGit`; `:1975-1996` `ensureNpmProject`/`ensureGitIgnore`; `:1998-2007,:2078-2087` install roots; `:2147-2305` manifest resolution
- `src/core/extensions/loader.ts` — `:118-140` jiti alias map; `:265-300` register* implementations; `:652-684` `discoverExtensionsInDir`; `:710-712` project-local path
- `src/core/pi-manifest.ts` — full file; manifest shape
- `src/config.ts` — `:491` `CONFIG_DIR_NAME`; `:516-566` all user config paths; `:136,148,158,174` self-update `--ignore-scripts`
- `src/core/auth-storage.ts` — `:23,64,106,188` `0o600`
- `src/core/system-prompt.ts` — `:16,33,108,128` guidelines; **absence** of command references
- `src/modes/interactive/interactive-mode.ts` — `:2902` `/share` literal match; `:5855-5910` share handler, `gh auth status`, gist create
- `src/core/slash-commands.ts:25` — `/share` built-in registration
- `pi-ai/src/api/openai-completions.ts:1337-1370` — `convertTools`
- `docs/packages.md` — `:20,43,63-66,85-93,114,118,133,160-165,169-173,224-228`
- `docs/extensions.md` — `:7,109-120,139-152,179,1276-1300,1342,1709`
- `docs/settings.md` — `:12-22,57,203,216,238-248`
- `docs/security.md` — `:11-31`
- `docs/windows.md` — `:3-7`
- `examples/extensions/hello.ts` — bundled minimal example (79 example entries total)
- npm registry, executed 2026-08-13 — `@earendil-works/pi-coding-agent` versions (40, oldest 0.74.0) and dist-tags; `vitest`/`typescript`/`typebox`/`@types/node` latest and specific-version existence; `scripts.postinstall` empty for all three dev deps
- Local execution, 2026-08-13 — npm `.npmrc` resolution matrix; postinstall attack (4 scenarios); `pi --list-models` load-path matrix (6 scenarios); `.gitattributes` vs `core.autocrlf`; `git check-ignore` semantics and the repo's current coverage; `gh auth status` and `gh auth refresh --help`; tool availability probe

### Secondary (MEDIUM confidence)

- `docs.github.com` workflow-syntax — `shell: bash` on Windows uses "the bash shell included with Git for Windows", `bash --noprofile --norc -eo pipefail {0}`; pwsh is the Windows default
- `github.com/actions/runner-images` — `Windows2025-Readme.md`, `macos-15-arm64-Readme.md`, `Ubuntu2404-Readme.md` (Node, Git Bash path, gh, shellcheck)
- `slopcheck` 0.6.1 npm-ecosystem scan of the six packages

### Tertiary (LOW confidence — used only as corroboration)

- `.planning/research/ARCHITECTURE.md:138-206` — repo layout and boundary rule; independently re-verified against Pi source above
- `.planning/research/STACK.md`, `CLAUDE.md` — version dossier; every Phase 1-relevant claim re-verified at the registry or the installed package this session

---

## Metadata

**Confidence breakdown:**

- Supply chain (§1) — **HIGH**. Read at source and confirmed by executing a real postinstall attack across four scenarios. The correction to BOOT-01's scoping model is the highest-confidence finding here.
- Load paths (§2) — **HIGH**. Six executed scenarios plus the source of the discovery code.
- Version pinning / unpublish (§3) — **HIGH**. Registry queried; exit codes and JSON shapes captured verbatim.
- CI / line endings (§4) — **HIGH** locally (autocrlf override proven by execution); **MEDIUM** for runner specifics, which come from current runner-image manifests that change over time.
- Node gate (§5) — **HIGH**. Read from the installed `package.json`.
- Credentials / gitignore (§6) — **HIGH**. Paths read at source; ignore verdicts executed against the real repo; two gaps found.
- Repo shape (§7) — **HIGH** on the Pi-imposed rules, **MEDIUM** on the future-phase directory guesses, which are derived from ROADMAP intent.
- Testing stack (§8) — **HIGH** on versions; **MEDIUM** on the `tsconfig` shape, which is reasoned from Pi's own import style rather than copied from a shipped config.
- Boundary rule (§9) — **HIGH**. Both the positive (tools in `tools[]`) and negative (commands absent from the system prompt) claims read at source.

**Research date:** 2026-08-13
**Valid until:** 2026-09-12 for the npm/git/CI mechanics; **2026-08-20** for anything version-specific — Pi ships every 2–3 days and this document pins 0.84.1 throughout. Re-run the registry queries in §3 and §8 at plan time if more than a week has passed.
