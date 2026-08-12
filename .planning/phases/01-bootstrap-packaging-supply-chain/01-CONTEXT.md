# Phase 1: Bootstrap, Packaging & Supply Chain - Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

A cold machine can be brought to a state where installing and running the harness does not execute unreviewed third-party code with full permissions, and the repo shape every later phase writes into exists and loads both ways.

**Requirements:** BOOT-01, BOOT-02, BOOT-03, BOOT-04, BOOT-05, BOOT-06, BOOT-07, BOOT-08, BOOT-09, BOOT-10, SAFE-16

</domain>

<decisions>
## Implementation Decisions

Most decisions for this phase were already made during project initialization and are recorded in PROJECT.md (Key Decisions) and the research documents. They are restated here because they are binding on this phase and were resolved by the user, not at Claude's discretion.

**User-decided, binding:**

1. **Project-scoped `.npmrc`, not global.** `ignore-scripts=true` lives in a `.npmrc` inside the repo. Explicitly NOT `~/.npmrc` — global would break packages with legitimate native builds (`sharp`, `better-sqlite3`, `node-gyp`) machine-wide. The residual gap is real and must be documented rather than hidden: a `pi install` run from any other directory is unprotected. README and the runbook must state this, including the setup step required when installing on macOS or any second machine.

2. **Repo AND Pi package, not either/or.** A `package.json` manifest costs one file and a bootstrap script costs one more; choosing between them means being worse at one for no saving. Both load paths must work.

3. **No build step.** Pi loads `.ts` directly through jiti. Adding a build breaks `/reload` hot-reloading for zero gain.

4. **GitHub Actions matrix for real macOS verification.** macOS cannot be tested locally on this machine; the matrix (`windows-latest` + `macos-latest`) is how macOS gets verified at all.

**Claude's discretion:**
Repo layout details, script structure, test framework wiring, CI workflow specifics, and the exact form of the hello-world extension. Guided by the ROADMAP success criteria, `.planning/research/ARCHITECTURE.md` (repo structure and the boundary rule), and `.planning/research/STACK.md` (exact versions and packaging shape).

</decisions>

<code_context>
## Existing Code Insights

The repo currently contains only planning artifacts, `README.md`, `LICENSE`, `.gitignore`, `.gitattributes`, and `CLAUDE.md`. There is no source code yet — this phase creates the shape everything else writes into.

Already in place and not to be re-created:
- `.gitattributes` pinning LF for `*.sh`, `*.ts`, `*.json`, `*.md` and CRLF for `*.bat`/`*.cmd`/`*.ps1` (relevant to BOOT-06)
- `.gitignore` covering node_modules, build output, secrets, cloud credential artifacts, `.pi/sessions|cache|logs|state`, and OS cruft (relevant to BOOT-09 — the requirement is a *test* proving it holds, not the file itself)
- Git remote on HTTPS (`https://github.com/kaiyitkoh/ky-pi-agent.git`) because no SSH key exists on this machine
- Pi `0.84.1` already installed globally; Node v24.16.0; npm 11.13.0; Git Bash present at `C:\Program Files\Git\bin\bash.exe`

Verified environment facts that constrain this phase:
- Pi **requires a bash shell on Windows**. Lookup order is `shellPath` setting → `C:\Program Files\Git\bin\bash.exe` → `bash.exe` on PATH. WSL is not required; Git Bash suffices.
- Pi versions below 0.74.0 are **unpublished from npm**, so any pin has a shelf life measured in months (BOOT-04 exists because of this).
- `pi install` runs npm lifecycle scripts with no `--ignore-scripts` on any code path, and the pnpm branch sets `--config.strict-dep-builds=false` (BOOT-01 exists because of this).
- `/share` cannot be blocked by any extension — built-in slash commands are matched before extension commands and before the `input` event. Aborting on `gh auth status` is the only control (SAFE-16).
- `auth.json`'s `0600` permission is a no-op on Windows ACLs.

</code_context>

<specifics>
## Specific Ideas

Drawn from research and binding on planning:

- Root the package at `.pi/` so `package.json#pi` and the dogfood directory are the same files — `cd ky-pi-agent && pi` then loads the harness being edited, with `/reload`.
- Declare `peerDependencies` and never bundle `@earendil-works/*` or `typebox` — bundling creates a second module instance and breaks `instanceof`.
- Use unscoped `typebox`, **not** `@sinclair/typebox` (the legacy scoped fork produces schemas Pi cannot validate).
- Match Pi's TypeScript version (5.9.3) rather than latest.
- `keywords: ["pi-package"]` in `package.json`.
- Bootstrap edits must be idempotent via marked regions, so re-running is safe.
- `CONTRIBUTING.md` must state the boundary rule (BOOT-10): a new capability defaults to command or skill; registering a tool requires justifying its per-request schema cost, because tool descriptions and JSON schemas ride in *every* request payload.

</specifics>

<deferred>
## Deferred Ideas

- Publishing to npm under a package name — the git install path is sufficient for v1.
- SSH remote — no key exists on this machine; HTTPS with `gh` auth works. Revisit before work-laptop setup.
- A global `~/.npmrc` hardening — explicitly rejected by the user in favour of project scope.

</deferred>
