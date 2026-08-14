# Phase 7: Composed Extensions, Pinned & Reviewed - Research

**Researched:** 2026-08-15
**Domain:** Third-party Pi extension composition, supply-chain pinning, git-worktree subagent isolation
**Confidence:** HIGH for everything read from unpacked tarballs, `npm view`, `gh api`, and this machine's own filesystem/`node` behavior; MEDIUM where a claim rests on package README prose only; LOW is flagged inline.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **Assert the hardening BEFORE any install.** `pi install` runs npm lifecycle scripts. Phase 1 built the `ignore-scripts` hardening and `bin/bootstrap.sh --assert-hardening` (needs no network). **Do not install anything into a machine you have not first proven is hardened** — the assertion is a precondition step in the plan, not a closing check.

2. **NEVER write a bare `npm:pkg` or an unrefed git URL into settings.** Versioned specs are pinned and skipped by `pi update`; unrefed ones drift. Phase 1 exported `isPinnedPackageSpec` from `tests/unit/pinning.test.ts` specifically for this phase to import — `/^npm:.+@[0-9]/ || /^(git:|https?:\/\/|ssh:\/\/|git:\/\/).+@.+$/`. **Import it. A second regex is how the two drift apart.** The one documented exemption is our own repo URL (`isOwnRepo`), not extended to anybody else.

3. **DO NOT INSTALL, under any framing:** `pi-provider-qoder` / `pi-qoder-provider`; `cc-safety-net`; `pi-sandbox`; `@ramtinj95/pi-infra-command-guard`; `@gotgenes/pi-subagents-worktrees`; `pi-defender`; `@ayulab/pi-rewind`; `pi-rewind@0.5.0`; `pi-high-availability`; `pi-provider-fallback`.

4. **Anything without a LICENSE file is VENDORED, not depended on (EXT-10).** Vendor into `extensions/vendor/` (or the repo-consistent equivalent under `.pi/`) and reference by local path — a local path in settings is added **without copying** and is untouched by `pi update`. `sebaxzero/pi-loop-police` still reports `license=NONE` on the GitHub API → vendoring stands.

5. **`@earendil-works/*` and `typebox` stay `peerDependencies: "*"` and are never bundled.** Note as a review item: `pi-subagents` declares `typebox` and `jiti` as its own *dependencies*; record what actually happens under Pi's separate module roots rather than asserting either way.

6. **Every extension registering a tool costs per-turn schema tokens on EVERY request** (~1,850 tok/turn measured floor, Phase 2). **Record each installed extension's model-facing tool count and names now, as a committed baseline Phase 10 can measure against.** Phase 10 does the cutting; Phase 7 does the counting.

7. **`pi-background-tasks` also ships "read-only delegated agents" that DUPLICATE the subagents package — filter those resources out, and VERIFY THE REAL FILE PATHS before shipping the filter.** The exclusion globs in STACK.md were never verified against the tarball.

8. **`.pi/agents/*.md` must carry NO `model:` key**, so Phase 5's settings-layer `agentOverrides` wins. Bundled `agents.ts:59-70` parses frontmatter into `{name, description, tools, model, systemPrompt}` and does honour `model:`. Project agents under `.pi/agents/` load only when `agentScope` is `"project"` or `"both"` — default is user-level only.

9. **Be suspicious of green.** Every test written here must be shown to FAIL if its subject is removed, and no test may write outside the repo or a temp dir.

### Claude's Discretion

Where the lockfile lives and its exact format (a committed JSON beside `.pi/settings.json`, or `.pi/settings.json`'s own `packages[]` treated as the lockfile) provided `pi list` can be diffed against it; whether the tool-count baseline is a committed data file or lives in a test; the vendor directory's exact path; how the smoke ritual is documented (`docs/RUNBOOK.md` vs a new `docs/SMOKE.md`) and whether it is scripted; how much of Pi's bundled `git-checkpoint.ts` is adopted verbatim versus hardened; the exact shape of the worktree build proof.

**Decisions taken autonomously during context generation** (Standing Operating Policy — user asleep):
- Phase slug `07-composed-extensions-pinned-reviewed`.
- Pi itself stays pinned at `0.84.1` (0.84.2 exists on npm, not bumped here).
- Download counts are UNVERIFIED (npm `downloads/point/last-month` endpoint is CDN-cached; use `time.modified` and `pushed_at` instead).
- `pi-model-fallback` is DROPPED, not installed.
- File checkpointing is Pi's own bundled `git-checkpoint.ts`, hardened.

### Deferred Ideas (OUT OF SCOPE)

- Measuring and cutting the per-turn token cost of these extensions, `pi.setActiveTools()` progressive disclosure, dynamic tool loading, the `AGENTS.md` budget — **Phase 10**.
- The reviewer subagent's behaviour, seeded-defect calibration, advisor escalation via `contact_supervisor`, per-role thinking budgets — **Phase 8**.
- The ceremonial workflows `/grill`, `/plan`, `/execute`, `/review` — **Phase 9**.
- Statusline, header, subagent activity widget, the authored theme — **Phase 11**. `awesome-pi-themes` is installed/kept as reference material only.
- Bumping Pi from 0.84.1 to 0.84.2 — a separate, testable action.
- Any live-credential execution of the smoke ritual — Phase 7 documents it and proves what it can offline.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXT-01 | Subagents support per-agent model, system prompt, tool restriction, thinking level | pi-subagents `agents.ts:1644` parses `thinking` frontmatter; bundled `subagent/agents.ts:15,58-71` does not. See Architecture Patterns §B. |
| EXT-02 | Parallel subagents build in isolated worktrees; untracked files (`.env`, `node_modules`) don't travel | `src/runs/shared/worktree.ts` fully read; `linkNodeModulesIfPresent` (line 243) is symlink-only and confirmed to fail with `EPERM` on this exact machine; `.env` has zero handling anywhere in the package. See Architecture Patterns §B/§C. |
| EXT-03 | Subagents run in background without blocking | `schemas.ts:327` `async: Type.Optional(Type.Boolean(...))`; `subagent_wait` tool confirmed at `src/runs/background/wait-tool.ts`. |
| EXT-04 | Mid-run steering without killing | `src/extension/steering-notices.ts` — `SUBAGENT_STEERING_MESSAGE_TYPE`, `handleSubagentSteeringNotice`. |
| EXT-05 | Plan mode, todo, background bash, LSP, structured questions, web lookup, session search, loop detection all available | Capability decision table, Architecture Patterns §A. |
| EXT-06 | Bundled examples preferred wherever they cover the need | Same table; corrected recommendation for todo/ask-user given a newly found pin residual in the `rpiv-*` family. |
| EXT-07 | File checkpointing restores the working tree, `git-checkpoint.ts` as fallback | `git-checkpoint.ts` fully read; three defects confirmed and unchanged from CONTEXT.md's citations, verified independently. |
| EXT-08 | Every pin re-verified at planning time; committed lockfile matches `pi list` | `docs/packages.md:30` — `pi list` reads directly from `settings.json`. Lockfile mechanism, Architecture Patterns §D. |
| EXT-09 | Documented smoke-test ritual: one turn/provider, one subagent spawn, one blocked command, one wire dump | Composition plan, Architecture Patterns §I. |
| EXT-10 | Extensions without a LICENSE file are vendored | Tarball LICENSE-file audit, Package Legitimacy Audit table. |
</phase_requirements>

## Summary

Every version in the phase's own re-verified pin table (2026-08-15) was re-checked live today and **none moved again in the last few hours** — `npm view` and `gh api` results are byte-identical to the orchestrator's table. The stack is stable enough to plan against as of this research pass, with the explicit understanding that the planner must re-run the same `npm view`/`gh api` commands at execution time rather than trust this document, per the phase's own thesis.

Three findings materially change what STACK.md/CONTEXT.md assumed, and all three are decisive rather than cosmetic:

1. **`pi-subagents@0.49.0`'s worktree isolation cannot build `node_modules` on this machine today.** `linkNodeModulesIfPresent` (`src/runs/shared/worktree.ts:243-254`) calls unqualified `fs.symlinkSync`, which requires `SeCreateSymbolicLinkPrivilege` on Windows. Tested directly on this machine: **`EPERM`**. A Windows junction (`fs.symlinkSync(..., "junction")`) succeeds with no elevation, but nothing in `pi-subagents` uses one. The composable fix is `ExtensionConfig.worktreeSetupHook` (a real, exposed config key at `src/runs/foreground/subagent-executor.ts:3223-3224` and `src/runs/background/subagent-runner.ts:3794`) — a script this repo authors that creates a junction for `node_modules` and copies/symlinks `.env`, declared through the package's own `syntheticPaths` extension point. This is composition, not a fork, and it is the concrete engineering task EXT-02 exists to name.

2. **`pi-background-tasks@2.4.2`'s "delegated agents" cannot be filtered by any file-path glob**, because they are not separate files. The package manifest declares exactly two extension entry points (`extensions/anthropic-attribution.ts`, `extensions/background-tasks.ts`); the latter's `default export` (`src/extension.ts:206`) unconditionally calls `registerFusionExtension(...)` (line 232) and `registerDelegateExtension(...)` (line 241) in the same function that registers `bg_run`/`bg_status`/`bg_logs`/`bg_kill`. `delegate-child.ts`/`fusion-child.ts` — the files STACK.md's exclusion-glob plan targeted — are never loaded as extensions at all; they are re-export shims for a *child* `pi -e` process. Pi's package filtering (`docs/packages.md:190-216`) operates on file paths layered on top of the manifest, and there is no file boundary here to filter on. Installing this package for `bg_run`/`bg_status`/`bg_logs`/`bg_kill` means accepting all 11 registered tools (`bg_run`, `bg_run_pi_attested`, `bg_status`, `bg_logs`, `bg_kill`, `bg_delegate`, `bg_result`, `fusion_investigate`, `fusion_reason`, `fusion_research`, `fusion_validate`), every one of which carries `promptSnippet` **and** `promptGuidelines`.

3. **`@juicesharp/rpiv-todo`/`rpiv-ask-user-question@2.5.2` and `@narumitw/pi-plan-mode@0.49.3` each carry a caret-range dependency this project cannot pin exactly** — `@juicesharp/rpiv-config@^2.5.2` (both rpiv packages), `typebox@^1.1.24` (both rpiv packages, a second uncontrolled typebox instance), and `@narumitw/pi-tui-kit@^0.49.1` (pi-plan-mode). None of these is a Pi-bundled peer; each resolves via ordinary npm semver at `pi install` time, outside any lockfile this repo controls, and `isPinnedPackageSpec` cannot see transitive ranges — it only governs the top-level `packages[]` entry. Given EXT-06's binding preference for bundled examples "wherever they cover the need," and given Pi's own `todo.ts` (297 lines) and `questionnaire.ts` (448 lines, single-or-multi-question with an "other" free-text option) cover the stated need with **zero** dependencies beyond the standard peers, **the recommendation in this document departs from STACK.md**: vendor/use the bundled `todo.ts` and `questionnaire.ts` instead of installing the two `rpiv-*` packages, and vendor/use the bundled `plan-mode/` instead of `@narumitw/pi-plan-mode`. `@narumitw/pi-lsp@0.49.4` has no such defect (peers only, no caret dependency) and stays as an install.

**Primary recommendation:** Use Pi's bundled examples for plan mode, todo, structured questions, and file checkpointing (all four have a caret-range or headless/untracked-file defect in their third-party alternative, and all four are small enough to vendor safely); install `pi-subagents@0.49.0`, `pi-background-tasks@2.4.2` (accepting and counting all 11 tools), `@narumitw/pi-lsp@0.49.4`, `pi-web-access@0.22.0`, and `pi-session-finder@0.5.6` as exact-pinned npm packages; vendor `pi-loop-police@1.14.1` (no LICENSE file, confirmed). Drop `pi-model-fallback` and `@davideasden/pi-undo` entirely, per CONTEXT.md's already-settled verdicts.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Subagent orchestration (spawn, background, steer) | Extension (Pi host process) | Child `pi` process | `pi-subagents` runs each subagent as an isolated `pi` subprocess; the parent extension owns lifecycle, wait/steer plumbing |
| Worktree isolation | OS filesystem + git | Extension (setup hook) | `git worktree add` is a real git operation; the extension only decides *where* and orchestrates cleanup — untracked-file handling is delegated to a setup hook this repo must author |
| Plan mode / todo / structured questions | Extension (in-session state) | — | Pure session-scoped UI + tool state, no external service |
| LSP diagnostics | Extension → spawned language server | — | `@narumitw/pi-lsp` shells out to language servers; the extension is a thin bridge exposing 2 tools |
| Web lookup | Extension → external HTTP (Exa/DuckDuckGo/Jina) | — | `pi-web-access` makes outbound network calls; genuinely external dependency, not local |
| Session search | Extension → local filesystem (`.pi`/session files) | — | Pure local grep-style search across session history files |
| Loop detection | Extension (event hooks only) | — | Zero model-facing tools; operates purely on `message_update`/`tool_call`/`context` hooks |
| Lockfile / pin verification | Test suite (`tests/unit/`) | `.pi/settings.json` (data) | `.pi/settings.json` `packages[]` is itself the lockfile Pi reads (`pi list`); a vitest test is the enforcement layer, not a separate lockfile file |
| Vendored packages (no-license) | Repo-local files under `.pi/` | — | Referenced by local path in settings; not npm-installed, never touched by `pi update` |

## Standard Stack

### Core — re-verified 2026-08-15 (same-day re-check, no drift from the orchestrator's table)

| Library | Version | Registry fact source | Purpose |
|---------|---------|----------------------|---------|
| `pi-subagents` | 0.49.0 | `[VERIFIED: npm registry 2026-08-15]` version, `dist.fileCount=223`, `dist.unpackedSize=3614501`, `license=MIT`; `[VERIFIED: GitHub API]` `stargazers_count=3138`, `pushed_at=2026-08-14T17:20:03Z`, `archived=false` | Subagent isolation, background execution, mid-run steering, `contact_supervisor` |
| `pi-background-tasks` | 2.4.2 | `[VERIFIED: npm registry 2026-08-15]` `time.modified=2026-08-14T00:08:00Z`, `license=ISC`; peer range `@earendil-works/pi-coding-agent: ^0.81.1 \|\| ^0.82.1 \|\| ^0.83.0 \|\| ^0.84.0` (satisfied by 0.84.1) | `bg_run`/`bg_status`/`bg_logs`/`bg_kill` background bash |
| `@narumitw/pi-lsp` | 0.49.4 | `[VERIFIED: npm registry 2026-08-15]` `time.modified=2026-08-07T09:02:25Z`, `license=MIT`; peers only, no caret runtime dependency | 2-tool LSP diagnostics bridge |
| `pi-web-access` | 0.22.0 | `[VERIFIED: npm registry 2026-08-15]` `time.modified=2026-08-11T21:06:10Z`, `license=MIT`; LICENSE file present in tarball | Web/documentation lookup (4 conditionally-registered tools) |
| `pi-session-finder` | 0.5.6 | `[VERIFIED: npm registry 2026-08-15]` `time.modified=2026-08-02T22:35:53Z`, `license=MIT`; LICENSE file present; 0 model-facing tools (`/find`, `/find-back` commands only) | Session search |
| `pi-loop-police` | 1.14.1 | `[VERIFIED: npm registry 2026-08-15]` `time.modified=2026-08-11T22:04:31Z`, `license="MIT"` in `package.json` **but** `[VERIFIED: GitHub API]` `license: null` and `[VERIFIED: tarball listing]` **no LICENSE file shipped** | Loop detection (0 model-facing tools; 5 event hooks + 1 command) — **must be vendored, EXT-10** |

### Bundled-example substitutes (vendor into this repo; zero npm install)

| Bundled file | Lines | Covers | Why chosen over the npm alternative |
|---|---|---|---|
| `examples/extensions/plan-mode/index.ts` + `utils.ts` | 390 + 168 = 558 | Plan mode | `@narumitw/pi-plan-mode@0.49.3` depends on `@narumitw/pi-tui-kit@^0.49.1` — a caret range this project cannot pin exactly (see Common Pitfalls) |
| `examples/extensions/todo.ts` | 297 | Todo tracking | `@juicesharp/rpiv-todo@2.5.2` depends on `@juicesharp/rpiv-config@^2.5.2` and `typebox@^1.1.24` — same caret-pin defect, plus a second uncontrolled `typebox` module |
| `examples/extensions/questionnaire.ts` | 448 | Structured user questions (single or multi, options + free-text "other") | `@juicesharp/rpiv-ask-user-question@2.5.2` has the identical `rpiv-config`/`typebox` caret defect |
| `examples/extensions/git-checkpoint.ts` | 53 | File checkpointing (hardened per EXT-07's three named defects) | Third-party field re-surveyed and unanimously weaker; see CONTEXT.md's already-settled verdict, independently re-confirmed by reading the file |

### Dropped entirely (already settled in CONTEXT.md, re-confirmed here)

| Package | Reason |
|---|---|
| `pi-model-fallback@0.3.6` | Phase 3/5 already ship `callWithFallback`/routing fallback chain; a second uncoordinated controller is invisible to `chokepoint-lint.test.ts` |
| `@davideasden/pi-undo@0.2.11` | No `license` field in `package.json` (LICENSE file itself IS present in the tarball, `[VERIFIED: tarball listing]` — a narrower defect than CONTEXT.md's wording suggests, but moot: `git-checkpoint.ts` hardening is the chosen path regardless) |

### Version verification commands run (2026-08-15, this session)

```bash
npm view pi-subagents version dist.fileCount dist.unpackedSize license repository.url
npm view @juicesharp/rpiv-todo version time.modified dependencies peerDependencies
npm view @juicesharp/rpiv-ask-user-question version time.modified dependencies peerDependencies
npm view pi-background-tasks version time.modified license
npm view pi-loop-police version time.modified license
npm view @narumitw/pi-plan-mode version time.modified license
npm view @narumitw/pi-lsp version time.modified license
npm view pi-web-access version time.modified license
npm view pi-session-finder version time.modified license
npm view awesome-pi-themes version time.modified license
npm view pi-model-fallback version time.modified license
npm view @davideasden/pi-undo version time.modified license
gh api repos/nicobailon/pi-subagents --jq '{stars,pushed_at,archived,license: .license.spdx_id}'
gh api repos/sebaxzero/pi-loop-police --jq '{license: .license, pushed_at}'
npm view <pkg> scripts.postinstall   # run for every package above — all empty
```

**Result: zero drift from the orchestrator's 2026-08-15 table.** The planner must still re-run these at execution time — this research pass is itself now several hours old and the ecosystem ships 13–16 releases/month.

## Package Legitimacy Audit

`pip install slopcheck` succeeded but the binary landed outside `PATH`; invoked via `python -m slopcheck install <pkgs>` (works, confirmed `slopcheck 0.6.1`). **Caution for the planner: `slopcheck install` attempts a real `npm install` of every `[OK]`-classified package by default** — it is a misnomer, not a dry-run scanner. This run crashed with `FileNotFoundError` before any install executed (the `npm` subprocess spawn failed in this shell), so **no package was actually installed by this research pass**, but the planner must **not** re-run `slopcheck install` bare; use `slopcheck scan` if a non-installing subcommand exists, or accept the scan output already captured below rather than re-invoking.

| Package | Registry | Age (slopcheck) | Source Repo | slopcheck | Disposition |
|---------|----------|------|-------------|-----------|-------------|
| `pi-subagents` | npm | — | github.com/nicobailon/pi-subagents (3,138★) | `[OK]` | Approved |
| `@juicesharp/rpiv-todo` | npm | — | (juicesharp mono) | `[OK]` | Not used — see recommendation above (vendored bundled `todo.ts` instead) |
| `@juicesharp/rpiv-ask-user-question` | npm | — | (juicesharp mono) | `[OK]` | Not used — vendored bundled `questionnaire.ts` instead |
| `pi-background-tasks` | npm | 79 days | github.com/ismailsaleekh/pi-background-tasks | `[OK]` | Approved — install for `bg_*` tools; 6 delegate/fusion tools accepted as measured overhead (see Common Pitfalls) |
| `pi-loop-police` | npm | 51 days | github.com/sebaxzero/pi-loop-police | `[OK]` | Approved but **VENDOR** per EXT-10 (no LICENSE file in tarball, `license: null` on GitHub API despite `"MIT"` in `package.json`) |
| `@narumitw/pi-plan-mode` | npm | 89 days | narumiruna/pi-extensions | `[OK]` | Not used — vendored bundled `plan-mode/` instead (caret dependency on `pi-tui-kit`) |
| `@narumitw/pi-lsp` | npm | 89 days | narumiruna/pi-extensions | `[OK]` | Approved |
| `pi-web-access` | npm | — | nicobailon/pi-web-access (1,093★) | `[OK]` | Approved |
| `pi-session-finder` | npm | 13 days | pungggi/pi-session-finder | `[SUS]` — flagged only for package age (13 days since creation, per slopcheck's own heuristic; the npm `time.modified` for the current version is 2026-08-02 and the underlying package has been maintained since well before that per prior research's star/commit history) | Approved with note — planner should add a `checkpoint:human-verify` per the protocol, or accept given the package is small (10 files, 82 KB), does zero model-facing tool registration, and was already surveyed in STACK.md against 5+ competitors |
| `awesome-pi-themes` | npm | 20 days | isashi/awesome-pi-themes | `[SUS]` — package age | Reference material only (Phase 11), not a runtime dependency of this phase — lower risk tolerance acceptable |
| `@davideasden/pi-undo` | npm | 19 days | DavidEasden/pi-undo | `[SUS]` — package age | Not used (dropped per CONTEXT.md's settled verdict; also 0★, no `license` field) |

**Packages removed due to slopcheck `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `pi-session-finder`, `awesome-pi-themes`, `@davideasden/pi-undo` — all three flagged purely on **package-creation-date** (slopcheck's youth heuristic), not on functional, structural, or provenance grounds. Two of the three (`awesome-pi-themes`, `@davideasden/pi-undo`) are not installed by this phase's plan regardless. `pi-session-finder` is the one live install in this category; the planner should gate it behind a `checkpoint:human-verify` task per the package-legitimacy protocol, or explicitly accept the residual risk with the reasoning above recorded in the plan.

**Package-name provenance note, per the strict rule:** every package name in this document originated in `.planning/research/STACK.md` (2026-08-13), itself built from WebSearch/training-derived discovery. Per the provenance rule, **all package names in this document are tagged `[ASSUMED]` for their name/existence claim**, even though the specific facts about each (version, license, file count, star count, `postinstall` script) were independently `[VERIFIED: npm registry]` / `[VERIFIED: GitHub API]` in this session. This is a real, honest tag — not a formality — and belongs in the Assumptions Log below.

## Architecture Patterns

### System Architecture Diagram

```
User session (interactive pi TUI)
        │
        ├─▶ pi-subagents "subagent" tool ──▶ spawn child `pi` process (isolated context)
        │         │                              │
        │         │  worktree:true?               ├─▶ optional: git worktree add (untracked
        │         │                              │    files do NOT travel — .env, node_modules)
        │         │                              │         │
        │         │                              │         └─▶ worktreeSetupHook (repo-authored
        │         │                              │              script) ──▶ junction node_modules,
        │         │                              │                          copy/symlink .env,
        │         │                              │                          declare syntheticPaths
        │         │                              │
        │         ├─▶ async:true ──▶ background run, subagent_wait / steering-notice channel
        │         └─▶ contact_supervisor ──▶ intercom bridge back to parent session
        │
        ├─▶ pi-background-tasks "background-tasks.ts" (single loaded entry point)
        │         ├─▶ registers bg_run/bg_status/bg_logs/bg_kill/bg_run_pi_attested (wanted)
        │         └─▶ ALSO registers bg_delegate/bg_result + 4 fusion_* tools (unconditional,
        │              same function, cannot be filtered by any file-path glob)
        │
        ├─▶ vendored plan-mode/ (bundled, in-session state machine, /plan command)
        ├─▶ vendored todo.ts (in-session tool + /todos command)
        ├─▶ vendored questionnaire.ts (in-session tool, structured Q&A)
        ├─▶ vendored git-checkpoint.ts, HARDENED (turn_start stash -u, headless restore path,
        │        persisted beyond in-memory Map)
        ├─▶ @narumitw/pi-lsp (2 tools: lsp_diagnostics, lsp_fix) ──▶ spawns language servers
        ├─▶ pi-web-access (4 conditional tools) ──▶ outbound HTTP (Exa/DuckDuckGo/Jina)
        ├─▶ pi-session-finder (/find, /find-back — zero tools) ──▶ local session file grep
        └─▶ vendored pi-loop-police (zero tools, 5 event hooks + /loop-police command)

.pi/settings.json packages[] (git-tracked)  ──is-read-by──▶  `pi list` / Pi's own installer
        │
        └─▶ tests/unit/*.test.ts import isPinnedPackageSpec, assert exact table match
                 AND assert no installed-but-undeclared package exists on disk
```

### Recommended Project Structure

```
.pi/
├── agents/                       # (Phase 7 fills) — .md files, NO model: key
├── extensions/
│   └── vendor/                   # new — vendored no-license / caret-defect packages
│       ├── loop-police/          # pi-loop-police, 2 files, EXT-10 (no LICENSE)
│       ├── plan-mode/            # bundled plan-mode/, EXT-06 preference
│       ├── todo.ts                # bundled todo.ts
│       ├── questionnaire.ts       # bundled questionnaire.ts
│       └── git-checkpoint.ts      # bundled + hardened, EXT-07
├── scripts/
│   └── worktree-setup-hook.mjs   # new — junction node_modules, copy .env (EXT-02)
└── settings.json                 # packages[] gains pi-subagents, pi-background-tasks,
                                   # @narumitw/pi-lsp, pi-web-access, pi-session-finder
                                   # (all npm:<pkg>@<exact-version>) + local paths for vendor/
```

### Pattern A: Capability decision table (EXT-05, EXT-06)

| Capability | Bundled example | Third-party | Decision | Evidence |
|---|---|---|---|---|
| Plan mode | `plan-mode/` (558 lines) — full coverage | `@narumitw/pi-plan-mode@0.49.3` | **Vendor bundled** | Caret dep `pi-tui-kit@^0.49.1`, `[VERIFIED: npm view dependencies]` |
| Todo tracking | `todo.ts` (297 lines) — full coverage, branch-safe state | `@juicesharp/rpiv-todo@2.5.2` | **Vendor bundled** | Caret deps `rpiv-config@^2.5.2`, `typebox@^1.1.24`, `[VERIFIED: npm view dependencies]` |
| Background bash | none bundled | `pi-background-tasks@2.4.2` | **Install** | No bundled equivalent exists among the 80 examples (confirmed by full directory listing) |
| LSP diagnostics | none bundled | `@narumitw/pi-lsp@0.49.4` | **Install** | No bundled equivalent; confirmed no `lsp`-named file in the 80-example directory |
| Structured user questions | `question.ts` (single) / `questionnaire.ts` (single-or-multi, superset) | `@juicesharp/rpiv-ask-user-question@2.5.2` | **Vendor bundled `questionnaire.ts`** | Same caret-defect family as rpiv-todo |
| Web lookup | none bundled | `pi-web-access@0.22.0` | **Install** | No bundled equivalent; confirmed — Pi's own docs state it "intentionally does not include" a web tool |
| Session search | none bundled | `pi-session-finder@0.5.6` | **Install** (flagged `[SUS]` by slopcheck on age; see audit) | No bundled equivalent |
| Loop detection | none bundled | `pi-loop-police@1.14.1` | **Vendor** (no LICENSE file, EXT-10) | Confirmed via `tar -tzf` listing — no `LICENSE`/`LICENCE` entry anywhere in the tarball |

**Confirmed negative claim:** there is no bundled `examples/extensions/` entry for web lookup or LSP among Pi 0.84.1's 80 shipped examples — verified by listing the full directory (`git-checkpoint.ts`, `plan-mode/`, `subagent/`, `todo.ts`, `question.ts`, `questionnaire.ts`, `qna.ts`, and 73 others enumerated; none named `web*`, `lsp*`, `search*`, `loop*`, `fetch*`).

### Pattern B: `pi-subagents@0.49.0` worktree isolation — what it actually does

Source: `src/runs/shared/worktree.ts` (773 lines, read in full).

- `createWorktrees()` → `createSingleWorktree()` (line 381) runs `git -C <toplevel> worktree add <path> -b pi-parallel-<runId>-<index> HEAD` (line 393). This is a real `git worktree add`, matching the standard "no untracked files travel" behavior by design.
- `linkNodeModulesIfPresent()` (lines 243-254): if `<toplevel>/node_modules` exists and no link exists yet at `<worktreePath>/node_modules`, calls **unqualified** `fs.symlinkSync(nodeModulesPath, nodeModulesLinkPath)`. Catches any error and returns `false` silently — no error surfaced to the caller or the model.
  - **Verified directly on this machine** (`node -e "fs.symlinkSync(target, link)"` in a fresh temp dir): fails with `EPERM: operation not permitted, symlink`. This is the standard Windows behavior without Developer Mode enabled or an elevated shell (`SeCreateSymbolicLinkPrivilege`).
  - **Also verified:** `fs.symlinkSync(target, link, "junction")` **succeeds** on this same machine with no special privilege — junctions are a distinct NTFS reparse-point mechanism Windows does not gate behind that privilege.
  - `pi-subagents` never passes `"junction"`; it always calls the unqualified two-argument form, which node auto-detects as `"dir"`/`"file"` type symlinks, not a junction.
- **`.env` (or any dotfile) is never referenced anywhere in the package.** `grep -rn "\.env\b"` across `src/` and `index.ts` returns only `auth.env`/`command.env` object-property accesses, zero literal `.env` filename handling. This is a genuine, unaddressed gap — not a subtle one.
- **The composable fix, confirmed to exist:** `WorktreeSetupHookConfig` (interface at line 71) lets a caller supply a `hookPath` — an executable script invoked post-worktree-creation with a JSON payload (`repoRoot`, `worktreePath`, `agentCwd`, `branch`, `index`, `runId`, `baseCommit`, `agent`) on stdin, and expecting a JSON `{syntheticPaths: string[]}` on stdout (lines 297-379). `syntheticPaths` are removed before every diff/cleanup pass, so a hook-created junction or copied `.env` is correctly excluded from the agent's own patch output.
- **This config is genuinely exposed, not internal-only:** `ExtensionConfig["worktreeSetupHook"]` and `["worktreeSetupHookTimeoutMs"]` are read at `src/runs/foreground/subagent-executor.ts:3223-3224` and `src/runs/background/subagent-runner.ts:3794` — both call sites thread it straight from the package's own settings/config object into `createWorktrees()`.
- **Recommendation:** author `.pi/scripts/worktree-setup-hook.mjs` (or `.sh`, POSIX per house style) that: (1) creates a junction for `node_modules` (`fs.symlinkSync(src, dst, "junction")` — cross-platform: Linux/macOS ignore the third arg and create an ordinary symlink), (2) copies (not symlinks — `.env` should not be shared/mutated across worktrees) the repo's `.env` if present, (3) emits `{"syntheticPaths":["node_modules","<.env-basename-if-copied>"]}`. Configure it via `worktreeSetupHook` in whatever settings surface `pi-subagents` reads (its own config schema — confirm exact settings key path during planning by reading `src/shared/settings.ts` in full, not sampled here).
- **Contact_supervisor / steering / background, confirmed present:** `contact_supervisor` tool registered conditionally by `src/intercom/native-supervisor-channel.ts:301-328` (only if not already present — bridges to a native fallback when the richer `intercom` bridge is unavailable); `SUBAGENT_STEERING_MESSAGE_TYPE` and `handleSubagentSteeringNotice` at `src/extension/steering-notices.ts`; `async: Type.Optional(Type.Boolean(...))` at `src/extension/schemas.ts:327` plus a dedicated `subagent_wait` tool (`src/runs/background/wait-tool.ts`).
- **Thinking level, confirmed present:** `agents.ts:1644` — `frontmatter.thinking !== undefined ? {thinking: frontmatter.thinking === "false" ? false : frontmatter.thinking} : {}`. The bundled example's `agents.ts` (126 lines, read in full) parses only `name`/`description`/`tools`/`model` — no `thinking` key anywhere. **This single fact is what makes EXT-01 only partially covered by the bundled example**, confirming CONTEXT.md's claim independently.
- **Model-facing tools registered by `pi-subagents` at minimum:** `subagent` (`src/extension/index.ts:576-621`) and `subagent_wait` (`src/runs/background/wait-tool.ts`), plus a conditional `contact_supervisor`/`intercom` pair when the native fallback path fires. No `postinstall` script (`[VERIFIED: npm view scripts.postinstall]` — empty). No `promptSnippet`/`promptGuidelines` found anywhere in the package (`grep -rn "promptSnippet\|promptGuidelines"` returns zero hits) — this is notably better cache-prefix hygiene than `pi-background-tasks`.

### Pattern C: proving the worktree "builds", not merely checks out (offline, this repo)

Minimal honest proof design, built on the existing `tests/helpers/git.ts` (`makeTempRepo`, `commitFile`, `headSha` already exist; a `worktree`-specific helper does not yet):

1. `makeTempRepo()` a fresh synthetic repo (never this repo — full `npm ci` against 100+ real dependencies is both slow and requires network, which the phase must avoid).
2. Commit a trivial tracked `src/index.js` that does `require("./dep")` and `fs.existsSync(".env")`.
3. **Outside git**, create an untracked `node_modules/dep/index.js` (a one-line `module.exports = "ok"`) and an untracked `.env` (`KEY=value`) in the temp repo root.
4. Assert: `node src/index.js` in the original temp repo succeeds (proves the fixture is sound).
5. `spawnSync("git", ["worktree", "add", worktreePath, "-b", "test-branch", "HEAD"], {cwd: repo})` — a real worktree add, mirroring `pi-subagents`' own invocation exactly.
6. Assert: `fs.existsSync(join(worktreePath, "node_modules"))` is `false` and `fs.existsSync(join(worktreePath, ".env"))` is `false` — this is the negative proof that untracked files do not travel, independent of any third-party package.
7. Assert: `node src/index.js` **run inside the worktree** throws `Cannot find module` — proves the worktree genuinely cannot build yet.
8. Apply the remedy the plan will ship: junction `node_modules` (`fs.symlinkSync(..., "junction")` — proven to work without elevation on this machine), copy `.env`.
9. Assert: `node src/index.js` inside the worktree now succeeds — proves the remedy is sufficient, using the same synthetic build proxy throughout.
10. Cleanup: `git worktree remove --force`, `git branch -D`.

**What counts as "build" for this repo specifically**, if a higher-fidelity proof is wanted later: `npx tsc --noEmit` is the closest analogue to a real build step for ky-pi-agent (no bundler; jiti loads `.ts` directly per house style) — but running `tsc --noEmit` against a *copy* of this actual repo inside a worktree, with a real `node_modules`, is possible **only via the junction fix**, and doing so inside a vitest run against the live repo risks slowness and side effects on developer state. The synthetic `require()`-based proxy above is the recommended Wave-0-safe proof; a second, slower `tsc --noEmit`-based integration test **may** be added if the plan has budget, but is not required to satisfy EXT-02's letter.

**Windows-specific friction, stated plainly:**
- **Symlink privilege: confirmed EPERM on this exact machine without Developer Mode/elevation.** This is the load-bearing finding — not a theoretical risk.
- **Junction as the workaround: confirmed to work on this exact machine, no elevation needed.**
- **Long paths:** `os.tmpdir()` resolves to a 48-character base path on this machine (`C:\Users\Admin\AppData\Local\Temp\<random>`); `pi-subagents`' own default worktree base dir is `os.tmpdir()` unless `PI_SUBAGENTS_WORKTREE_DIR` is set (`src/runs/shared/worktree.ts:199`), so the >260-character path risk is low by default but not zero on deeply-nested user profiles. `git config core.longpaths` is **unset** on this machine (`[VERIFIED: git config --get core.longpaths` → empty]`) — worth a bootstrap-time note, not necessarily a fix in this phase, since it has not caused a failure in the synthetic proof above.
- **Nothing here is genuinely unprovable offline.** Everything in this pattern was exercised directly on this machine with real `git`, real `fs`, and real `node` — no `RB-07-xx` is needed for EXT-02's mechanism. (An `RB-07-xx` may still be warranted for "does a real `pi-subagents` subagent spawn with `worktree:true` actually invoke the setup hook and build correctly end-to-end" if the plan chooses not to build a full integration test against the real package — see Validation Architecture.)

### Pattern D: the lockfile mechanism (EXT-08)

`docs/packages.md:30` states plainly: `pi list — show installed packages from settings`. This is not a separate lockfile Pi generates; **`pi list` reads directly out of `~/.pi/agent/settings.json` (global) and `.pi/settings.json` (project)**. For this project's project-scoped install (`-l` flag / project settings), `.pi/settings.json`'s own `packages[]` array **is** the thing `pi list` reflects — there is no separate on-disk lockfile format to design.

This resolves the "Claude's discretion" question cleanly: **no new lockfile file is needed.** `.pi/settings.json` (already git-tracked, currently `{}`) becomes the lockfile the moment it gains a `packages[]` array. The enforcement layer is entirely in `tests/unit/`:

1. **Drift detection (a pin changes without a matching commit to the "expected" table):** write a small `EXPECTED_PACKAGES` table as a `const` in the new test file (or reuse/extend `tests/unit/pinning.test.ts`'s existing but currently-vacuous `packages[]` assertion), asserting `.pi/settings.json`'s `packages[]` array deep-equals the expected table exactly (order-independent). This makes a manual, undocumented edit to `.pi/settings.json` fail the build.
2. **Missing-entry detection (an installed package isn't in the lockfile):** since `.pi/npm/` and `.pi/git/` are the actual install destinations for project-scoped packages (`docs/packages.md:64-65,92`) and are gitignored (matching this repo's `.pi/npm/*` pattern), a "package installed but undeclared" state can only be detected live (post-`pi install`), not from a fresh clone. The vitest-level proxy for this is: if `.pi/npm/` or `.pi/git/<host>/` contains a directory whose corresponding `npm:<name>` or `git:<host>/<path>` spec is absent from `.pi/settings.json`'s `packages[]`, fail. This test is necessarily conditional on the directories existing (they won't in CI, which never runs `pi install`) — document that gap rather than hide it.
3. **Both tests import `isPinnedPackageSpec` from `tests/unit/pinning.test.ts`** per decision 2 — never a second regex.

### Pattern E: vendoring mechanics (EXT-10)

Confirmed against `docs/packages.md`: **local paths are added to `packages[]` without copying** (`docs/packages.md:92` describes remote sources being cloned into `.pi/git/`/`~/.pi/agent/git/`; a `local` source type is documented separately in the "Package Sources" section as referencing a path directly by absolute or relative path, with identity determined by "resolved absolute path" per the Scope-and-Deduplication section — i.e. Pi reads the files in place, it does not copy them into its own managed directory). This confirms PROJECT.md's claim.

**Vendor directory:** given this repo's existing convention `.pi/extensions/{diagnostics,harness,providers,qoder,routing,safety,workflows}`, the natural placement is a new sibling `.pi/extensions/vendor/` (each vendored package/example gets its own subdirectory, e.g. `.pi/extensions/vendor/loop-police/`, matching the CONTEXT.md discretion note "vendor into `extensions/vendor/` (or the repo-consistent equivalent under `.pi/`)"). This keeps vendored code inside the same auto-discovered `.pi/extensions/` tree Pi already loads for this project, with no separate `packages[]` local-path entry needed at all — it becomes one more subdirectory Pi auto-discovers, exactly like `harness/` or `safety/` today. (An explicit local-path `packages[]` entry is only strictly necessary if the vendored code lives *outside* the auto-discovered `.pi/extensions/` tree; placing it inside avoids that extra step entirely and is the simpler, more consistent choice.)

**LICENSE-file audit re-confirmed by unpacking every tarball (`tar -tzf <pkg>.tgz | grep -i licen`):**

| Package | LICENSE file in tarball | `package.json` `license` field | Disposition |
|---|---|---|---|
| `pi-web-access` | present | MIT | depend normally |
| `pi-session-finder` | present | MIT | depend normally |
| `pi-loop-police` | **absent** | `"MIT"` (string only, no file) | **vendor (EXT-10)** |
| `@davideasden/pi-undo` | present (real MIT text, copyright DavidEasden 2026) | **absent** (no `license` key at all) | not used regardless (dropped) |
| `awesome-pi-themes` | present | MIT | reference material only |
| `@narumitw/pi-lsp` | present | MIT | depend normally |
| `@narumitw/pi-plan-mode` | present | MIT | not used (vendored bundled instead, for the caret-dependency reason, not licensing) |
| `pi-subagents` | present | MIT | depend normally |
| `pi-background-tasks` | present | ISC | depend normally |

**Nuance worth flagging to the planner:** `@davideasden/pi-undo` is the one package where the *tarball* carries a real LICENSE file but the *`package.json` metadata* does not declare a `license` field — the opposite defect shape from `pi-loop-police` (which declares `"license":"MIT"` in `package.json` but ships no file). CONTEXT.md's wording ("no `license` field... at all") is about the metadata field specifically, and is accurate; it does not mean pi-undo is unlicensed in substance. This distinction is moot for the plan since pi-undo isn't installed either way, but the planner should not conflate the two defect shapes if either package resurfaces later.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subagent process isolation, background execution, mid-run steering | A custom child-process orchestrator | `pi-subagents@0.49.0` | 223 files, 3,138★, actively maintained (pushed yesterday); the exact isolation/background/steering primitives already exist and are exercised by this package's own test suite |
| Worktree creation/cleanup/diff-capture | Custom `git worktree` wrapper | `pi-subagents`' `worktree.ts` | Already handles branch naming, rollback-on-failure, diff capture, and pruning correctly; only the *untracked-file* gap needs a repo-authored setup hook, not a reimplementation |
| Structured multi-choice user prompts with custom UI | A new tool + custom TUI overlay | Bundled `questionnaire.ts` | 448 lines already handles single/multi question, tab navigation, free-text "other" — a solved problem in the exact shape needed |
| LSP diagnostics bridging | A custom LSP client | `@narumitw/pi-lsp` | 13 files, 78 KB, exactly 2 tools; reviewing 13 files is a morning, writing an LSP client is not |
| Web/documentation lookup | A custom fetch-and-summarize tool | `pi-web-access` | Genuinely keyless (Exa/DuckDuckGo/Jina), the only credible zero-cost option surveyed |

**Key insight:** every hand-roll temptation in this phase is dominated by an existing, well-scoped package **except** the untracked-file worktree gap and the delegate/fusion tool-filtering problem — both of which are genuinely this project's job because they are configuration/composition gaps in otherwise-sound third-party code, not missing features to build from scratch.

## Common Pitfalls

### Pitfall 1: Assuming `pi-background-tasks`' delegate/fusion tools can be filtered by a file-path glob

**What goes wrong:** A plan writes `.pi/settings.json` package filter `"extensions": ["extensions/background-tasks.ts", "!extensions/delegate-child.ts", "!extensions/fusion-child.ts"]` believing it suppresses the 6 delegate/fusion tools.

**Why it happens:** STACK.md's original exclusion-glob idea assumed the duplicate tools lived in separate files. They do not — `registerFusionExtension`/`registerDelegateExtension` are called unconditionally inside `src/extension.ts`'s default export, the same function that registers the wanted `bg_*` tools. `delegate-child.ts`/`fusion-child.ts` are re-export shims for a **child** `pi -e` process invocation, never loaded as extensions of the parent session at all — they were never in the manifest's `extensions` array to begin with (`package.json` `pi.extensions` lists exactly `["./extensions/anthropic-attribution.ts", "./extensions/background-tasks.ts"]`).

**How to avoid:** Accept all 11 tools as the installed surface, record all 11 by name in the Phase 7 tool-count baseline (per decision 6), and note the 6 delegate/fusion tools explicitly as "registered but functionally redundant with `pi-subagents`; candidate for `pi.setActiveTools()` exclusion in Phase 10." Do not write a filter glob that silently does nothing — verify it against the real tarball paths if one is attempted, per decision 7's own instruction, and if verification shows (as it does here) that no file-level filter can achieve the goal, **say so in the plan rather than shipping a decorative filter**.

**Warning signs:** A settings filter test that "passes" without ever asserting the tool is actually absent from `pi.getAllTools()` in a real or faux session — a glob matching nothing is silently green.

### Pitfall 2: Trusting `pi-subagents`' worktree isolation to "just work" on Windows

**What goes wrong:** A plan writes `worktree: true` in a chain step or subagent call, runs the offline proof once on a machine where Developer Mode happens to be on, and ships without checking `linkNodeModulesIfPresent`'s silent-failure path.

**Why it happens:** The function catches its own `EPERM` and returns `false` with no error, no log line visible to the model, no field in the tool result that flags degraded mode beyond `nodeModulesLinked: false` deep in `WorktreeInfo`. A subagent spawned into such a worktree will fail to build, and the failure will look like an ordinary code error, not an infrastructure gap.

**How to avoid:** Configure `worktreeSetupHook` (confirmed real, exposed config key) to junction `node_modules` and copy `.env` explicitly, and add the offline proof from Pattern C that demonstrates the exact EPERM/junction split on this class of machine. Do not rely on the package's own default node_modules linking.

**Warning signs:** A worktree-isolated subagent task failing with "module not found" errors that have nothing to do with the actual task.

### Pitfall 3: Believing the `rpiv-*` / `pi-tui-kit` transitive caret ranges are pinnable

**What goes wrong:** A plan installs `@juicesharp/rpiv-todo@2.5.2` (itself an exact pin) and considers criterion 1 satisfied because the top-level `packages[]` entry is exact.

**Why it happens:** `isPinnedPackageSpec` only ever sees the top-level spec string (`npm:@juicesharp/rpiv-todo@2.5.2`). It has no visibility into that package's own `dependencies.@juicesharp/rpiv-config` (`^2.5.2`) or `dependencies.typebox` (`^1.1.24`), both of which npm resolves independently at `pi install` time with no lockfile this repo commits or controls.

**How to avoid:** Either accept and **explicitly document** the residual (a `## Known Pin Residuals` note naming exactly which transitive ranges cannot be exactly pinned by any mechanism this repo owns), or — the recommendation in this document — avoid the packages that carry the defect where a zero-dependency bundled equivalent exists (todo, ask-user-question, plan-mode all qualify; LSP, web-access, session-finder, background-tasks, and subagents do not carry this defect and have no bundled equivalent).

**Warning signs:** A pinning test that only checks the `packages[]` array's own entries and never inspects (or documents not inspecting) what those packages pull in transitively.

### Pitfall 4: Copying `.pi/agents/*.md` sample frontmatter verbatim

**What goes wrong:** Bundled `subagent/agents/scout.md` etc. all carry a `model:` key (e.g. `model: claude-haiku-4-5`). If reused verbatim in this repo's `.pi/agents/`, it defeats Phase 5's `agentOverrides` settings-layer precedence (decision 8, already flagged in CONTEXT.md — independently re-confirmed by reading `agents.ts:59-71`, which parses and honours the `model:` key without conditional logic).

**How to avoid:** Any agent `.md` file this repo ships must omit `model:` entirely, letting `routing/agent-overrides.ts` (Phase 5) be the sole source of model selection.

### Pitfall 5: `slopcheck install` is not a dry-run

**What goes wrong:** Running `slopcheck install <pkgs>` in a plan's verification step, expecting a scan-only report, and it actually shells out to `npm install` for every `[OK]`-classified package.

**How to avoid:** Documented in this session's own experience — the command genuinely attempted `npm install` and only failed to execute because of an environment-specific subprocess spawn issue in this shell, not because slopcheck refused to install. Treat `slopcheck install` output as authoritative for classification, but never run it as a "just checking" step on a machine where you don't want packages actually installed; capture and reuse this research pass's results instead, or use whatever non-installing subcommand slopcheck offers if the planner re-verifies at execution time.

## Code Examples

### Worktree setup hook (EXT-02) — protocol contract, from `pi-subagents` source

```typescript
// Source: pi-subagents@0.49.0 src/runs/shared/worktree.ts:87-101, 318-379
interface WorktreeSetupHookInput {
	version: 1;
	repoRoot: string;
	worktreePath: string;
	agentCwd: string;
	branch: string;
	index: number;
	runId: string;
	baseCommit: string;
	agent?: string;
}
// Hook receives WorktreeSetupHookInput as JSON on stdin.
// Hook must print {"syntheticPaths": ["relative/path", ...]} as JSON on stdout.
// syntheticPaths are removed before every diff/cleanup pass and must be relative,
// non-empty, and must not already be tracked in git (hasTrackedEntries check).
```

### Windows-safe node_modules link (EXT-02 remedy) — verified on this machine

```javascript
// Source: this research session, executed directly, 2026-08-15
const fs = require("node:fs");
// FAILS on Windows without Developer Mode / elevation:
fs.symlinkSync(target, link);                 // EPERM
// SUCCEEDS with no special privilege on the same machine:
fs.symlinkSync(target, link, "junction");     // OK — Windows-only third arg;
                                               // ignored/harmless on POSIX where a plain
                                               // symlink is created instead.
```

### `pi list` reads settings directly (EXT-08)

```
# Source: docs/packages.md:30 (Pi 0.84.1, installed tarball)
pi list                     # show installed packages from settings
```
No separate lockfile format exists; `.pi/settings.json`'s own `packages[]` is what `pi list` reflects for a project-scoped install.

## State of the Art

| Old Approach (STACK.md, 2026-08-13) | Current Approach (this research, 2026-08-15) | When Changed | Impact |
|---|---|---|---|
| Install `@juicesharp/rpiv-todo` / `rpiv-ask-user-question` on download-count evidence | Vendor bundled `todo.ts`/`questionnaire.ts` | This research pass | Removes two caret-range pin residuals; download counts were already flagged UNVERIFIED (CDN-cached) by the orchestrator |
| Exclusion-glob filter for `pi-background-tasks`' delegate/fusion tools | Accept all 11 tools, document 6 as redundant-but-present | This research pass | The originally planned filter mechanism does not exist for this package's file layout |
| `@narumitw/pi-plan-mode` as the plan-mode source | Vendor bundled `plan-mode/` | This research pass | Removes a caret-range dependency (`pi-tui-kit`) |
| Assume worktree isolation "just works" for parallel subagents | Explicit `worktreeSetupHook` authored by this repo | This research pass | Node_modules linking is confirmed broken on this class of machine without it |

**Deprecated/outdated:** the STACK.md exclusion-glob plan for `pi-background-tasks` — superseded by the file-structure finding above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | All package **names** in this document (`pi-subagents`, `pi-background-tasks`, `@narumitw/pi-lsp`, `pi-web-access`, `pi-session-finder`, `pi-loop-police`, `@narumitw/pi-plan-mode`, `@juicesharp/rpiv-*`, `@davideasden/pi-undo`, `awesome-pi-themes`, `pi-model-fallback`) originated in prior WebSearch/training-derived research (STACK.md), not an authoritative Pi-maintained registry. Every fact ABOUT each name (version, license, file count, star count, postinstall script, dependency tree, LICENSE-file presence) was independently `[VERIFIED: npm registry]`/`[VERIFIED: GitHub API]`/`[VERIFIED: tarball listing]` in this session. | Standard Stack, Package Legitimacy Audit | If any name were subtly wrong (typosquat), registry existence alone would not have caught it — though the GitHub star counts (1,000-3,000+ for the primary picks) and multi-day-old publication dates make a slopsquat attack implausible for the core recommendations |
| A2 | `pi-subagents`' exact settings-key path for `worktreeSetupHook` (i.e., where in `.pi/settings.json` or a package-specific config file it is read from) was located at the call-site level (`ExtensionConfig["worktreeSetupHook"]`) but the full config-loading chain in `src/shared/settings.ts` was not read end-to-end in this session | Architecture Patterns §B | The planner must read `src/shared/settings.ts` in full during planning to confirm the exact settings key/file the hook path is configured through, before writing the plan task |
| A3 | `@juicesharp/rpiv-i18n@2.5.2` exists on the npm registry and is a real, currently-published package (`[VERIFIED: npm view version]` → `2.5.2`) — moot for this plan since the `rpiv-*` family is not being installed, but recorded since Question H asked about it explicitly | Package Legitimacy Audit | None — not on the install path given this document's recommendation |
| A4 | `pi-session-finder`'s slopcheck `[SUS]` flag (13-day package age per slopcheck's heuristic) does not reflect the package's actual maintenance history, which STACK.md's original survey (2026-08-13) described as one of several credible competitors surveyed against `pi-sessions` — this research pass did not independently re-verify the package's git commit history or founding date beyond what `npm view time.modified` shows | Package Legitimacy Audit | If the package genuinely is new/unproven despite npm metadata suggesting otherwise, the planner should gate its install behind `checkpoint:human-verify` rather than trust this note |
| A5 | The recommendation to vendor bundled `todo.ts`/`questionnaire.ts`/`plan-mode/` instead of the `rpiv-*`/`pi-plan-mode` packages is this research pass's own judgment call, not an explicit instruction in CONTEXT.md (which lists file-checkpointing and provider-fallback as the only two "explicitly LOW-CONFIDENCE" categories requiring re-survey). It follows directly from EXT-06's binding criterion and the newly-discovered caret-range defect, but the planner should treat it as a strong recommendation open to override, not an unquestionable locked decision | Summary, Standard Stack | If the planner disagrees, install the `rpiv-*`/`pi-plan-mode` packages instead and document the caret-range residual explicitly in the plan's own pin table, per Pitfall 3's fallback guidance |

**If this table is empty:** N/A — five items recorded above, all genuinely worth a second look rather than pro forma.

## Open Questions (RESOLVED at planning time, 2026-08-15)

**Closure record — how each question below was settled during planning:**

- **Q1 (`worktreeSetupHook` settings key path)** — **RESOLVED by plan 07-09, Task 1**, which makes
  "read `src/shared/settings.ts` in full and confirm the exact configuration surface" an explicit
  executable task rather than an assumption, exactly as the recommendation below asks.
- **Q2 (programmatic disable flag for `pi-background-tasks`' fusion/delegate tools)** —
  **DELIBERATELY NOT PURSUED.** Decision **D-07-B** accepts all 11 tools regardless of the answer,
  because the file-glob approach was proven impossible (the tools register unconditionally at
  `src/extension.ts:232,241` and force-re-append via `setActiveTools` on session start). Even a
  working config flag would not change this phase's deliverable; it would change Phase 10's, where
  this package is recorded as the strongest cut target. Carried forward to Phase 10, not closed by
  investigation.
- **Q3 (real `tsc --noEmit` worktree build vs. the synthetic proxy)** — **RESOLVED by plan 07-05**,
  which adopts the synthetic-proxy recommendation below as the required Wave-0 proof, with the
  decisive property that the test **fails before the setup hook runs and passes after** — so it
  discharges "builds, not merely checks out" rather than asserting it.

---

1. **What exact settings key path does `pi-subagents` read `worktreeSetupHook` from?**
   - What we know: the config type carries the key (`ExtensionConfig["worktreeSetupHook"]`) and two call sites thread it into `createWorktrees()`.
   - What's unclear: whether it's `.pi/settings.json` under a package-specific namespace, a dedicated `pi-subagents.config.json`, or an env var fallback — `src/shared/settings.ts` needs a full read, not the partial grep this session performed.
   - Recommendation: first task of the relevant plan wave should be "read `src/shared/settings.ts` in full and confirm the exact configuration surface" before writing the hook-registration task.

2. **Does `pi-background-tasks`' `registerDelegateExtension`/`registerFusionExtension` accept any programmatic disable flag from the *host* extension (as opposed to the package's own internal config)?**
   - What we know: no `process.env` gate exists in either file; no obvious config toggle was found in the grep performed.
   - What's unclear: whether `src/shared/settings.ts`-equivalent config for this package (not read in full either) exposes a `fusion.enabled: false` / `delegate.enabled: false` style switch that would achieve what the file-glob approach cannot.
   - Recommendation: grep `src/core/fusion/config.ts` and any `src/shared/*.ts` config loader for this package specifically before concluding the 11-tool surface is unavoidable; this research pass did not exhaustively rule this out.

3. **Is a full `tsc --noEmit`-based worktree build proof against a real (not synthetic) copy of this repo worth the added complexity/runtime, or does the synthetic `require()` proxy in Pattern C fully discharge EXT-02?**
   - What we know: the synthetic proxy exercises the identical mechanism (`git worktree add`, untracked-file absence, junction remedy) that a real build would.
   - What's unclear: whether the phase's own bar for "not merely check out" is satisfied by a synthetic proxy or demands the real toolchain.
   - Recommendation: ship the synthetic proxy as the required Wave-0 proof; treat a real `tsc --noEmit`-in-worktree integration test as optional stretch goal, not a blocking requirement, given the network/slowness risk of a full `npm ci` inside a temp worktree during CI.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `npm` (registry access) | Package version re-verification at execution time | ✓ | — | — |
| `gh` CLI (authenticated) | GitHub API re-verification | ✓ | — | — |
| `git` | Worktree proof, all pinning | ✓ | 2.54.0.windows.1 | — |
| Windows Developer Mode / elevated shell | `pi-subagents`' default node_modules symlink | ✗ (confirmed EPERM on this machine) | — | Junction-based `worktreeSetupHook` (built in this phase) |
| `python`/`pip` + `slopcheck` | Package legitimacy scan | ✓ (via `python -m slopcheck`, not on PATH directly) | slopcheck 0.6.1 | Manual npm/GitHub verification (also performed) |
| Network egress to `api.qoder.com`, DashScope, Bedrock, etc. | NOT required by this phase | N/A | — | — |

**Missing dependencies with no fallback:** none — the one real gap (symlink privilege) has a working, verified fallback (junction) built into this phase's own plan.

**Missing dependencies with fallback:** Windows Developer Mode/elevation — mitigated by the `worktreeSetupHook` junction approach; no bootstrap-time OS setting change is required for this phase to succeed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 (matches Pi core, already the project standard) |
| Config file | `vitest.config.ts` (existing, from Phase 1) |
| Quick run command | `npx vitest run tests/unit/<new-file>.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXT-01 | Per-agent model/prompt/tools/thinking-level supported | unit (frontmatter parsing) or session-level | `npx vitest run tests/unit/subagent-agents-config.test.ts -x` | ❌ Wave 0 |
| EXT-02 | Worktree build proof (untracked files absent, then remedied) | integration (real `git worktree add`, real `node`, real `fs.symlinkSync`) | `npx vitest run tests/integration/worktree-build.test.ts -x` | ❌ Wave 0 |
| EXT-03 | Background execution doesn't block session | session-level (`fauxProvider` + real spawned child or mocked async path) | `npx vitest run tests/integration/subagent-background.test.ts -x` | ❌ Wave 0 |
| EXT-04 | Mid-run steering without kill | session-level, reading `SUBAGENT_STEERING_MESSAGE_TYPE` events | `npx vitest run tests/integration/subagent-steering.test.ts -x` | ❌ Wave 0 |
| EXT-05/06 | Each capability available; bundled preferred where it covers the need | unit (settings/`packages[]` presence + vendored file presence) | `npx vitest run tests/unit/extension-composition.test.ts -x` | ❌ Wave 0 |
| EXT-07 | Checkpoint restores working tree headlessly, captures untracked files | integration (real temp git repo, real stash, headless path) | `npx vitest run tests/integration/git-checkpoint.test.ts -x` | ❌ Wave 0 |
| EXT-08 | `.pi/settings.json` `packages[]` matches expected pin table; no undeclared installed package | unit, imports `isPinnedPackageSpec` | `npx vitest run tests/unit/extension-pins.test.ts -x` | ❌ Wave 0 |
| EXT-09 | Smoke ritual composes existing RB entries + offline-provable parts | unit/doc-policy style, extends `tests/unit/docs-policy.test.ts` pattern | `npx vitest run tests/unit/docs-policy.test.ts -x` | ✅ (extend existing) |
| EXT-10 | Vendored packages have no `packages[]` npm entry; LICENSE-file audit recorded | unit (filesystem check: vendored dir exists, no matching npm source in settings) | `npx vitest run tests/unit/vendor-license-audit.test.ts -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** the specific new test file for that task.
- **Per wave merge:** `npx vitest run tests/unit/ tests/integration/` (full unit+integration, no live-credential suites — none exist for this phase).
- **Phase gate:** full suite green (`npx vitest run`) + `npx tsc --noEmit` before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `tests/unit/extension-pins.test.ts` — covers EXT-08, imports `isPinnedPackageSpec`
- [ ] `tests/unit/vendor-license-audit.test.ts` — covers EXT-10
- [ ] `tests/unit/extension-composition.test.ts` — covers EXT-05/EXT-06 (presence of vendored files + `packages[]` entries)
- [ ] `tests/integration/worktree-build.test.ts` — covers EXT-02, the decisive new proof from Pattern C
- [ ] `tests/integration/git-checkpoint.test.ts` — covers EXT-07, hardened `git-checkpoint.ts`
- [ ] `tests/helpers/worktree.ts` (new helper, sibling to `tests/helpers/git.ts`) — `makeTempRepoWithNodeModulesAndEnv()`, `addWorktree()` wrapping `git worktree add`/`remove` — shared by the EXT-02 test and any future subagent worktree tests
- [ ] Confirm whether EXT-01/03/04 need real `pi-subagents` package installed in a test fixture directory (session-level, spawning a real child `pi` process) or whether reading the package's own already-passing test suite (`node --experimental-strip-types --test test/unit/*.test.ts` inside the installed package) can be cited as sufficient evidence instead of re-testing third-party behavior — **recommend the latter** for EXT-01/03/04 specifically, reserving this repo's own tests for the composition-specific claims (agent files carry no `model:` key, worktree setup hook is configured and works, tool counts are recorded) rather than re-proving `pi-subagents`' own internals.

*(EXT-09's smoke ritual is documentation, not new test infrastructure beyond extending the existing `docs-policy.test.ts` pattern — see below.)*

### EXT-09 smoke-ritual composition, explicitly

Offline-provable today, by composing existing machinery (no new mechanism):
- **One blocked command** → `safety/shell.ts`/`safety/git.ts` already have a full offline evasion-corpus proof (Phase 4, `tests/integration/*` + `evasion-corpus.ts`). The smoke ritual cites running one representative blocked command interactively and observing the audit JSONL row, which is provable today via the existing test suite as a stand-in, and directly on a real terminal as the actual ritual step.
- **One subagent spawn** → provable via `fauxProvider` + `SessionManager.inMemory()` at the session level (no live credentials needed) for the *mechanism*; a real subagent spawn against a real model is a `[RUNBOOK]`-shaped live check.
- **One wire dump** → `diagnostics/wire.ts` (Phase 2) already proves the capture mechanism offline; a real dump with real content is the same RB-02-01 already OUTSTANDING in `docs/RUNBOOK.md`.
- **One turn per provider** → `providers/fallback.ts` (Phase 3) already composes this; same RB-03-xx family, already OUTSTANDING.

**Genuinely RUNBOOK material (needs the work laptop):** the *composed, single* smoke-test ritual as a real end-to-end sequence — run all four steps back-to-back after a real version bump and confirm nothing regressed — cannot be executed here because three of its four legs (real provider turn, real credential-backed wire dump, real subagent against a real model) already require the work laptop per RB-02-01, RB-03-0x, and would require a new `RB-07-01` for "one real subagent spawn against a real provider, post version-bump." The blocked-command leg is the only one of the four that is *fully* provable offline today. **Append `RB-07-01`** to `docs/RUNBOOK.md` (never renumber RB-01..05) documenting the composed ritual and naming the exact commands to run on the work laptop after any version bump; mark it OUTSTANDING per the standing policy, with the offline proxy being "each of the four legs individually has its own offline proxy test, cited by RB-id, in the existing Phase 2/3/4 sections." `tests/unit/docs-policy.test.ts`'s existing pattern (summary-table row + `### RB-07-01` detail section + `**Status:**` line, both parsed and required to agree) governs this new entry exactly as it governs RB-01..05 — the plan must add `RB-07-01` to `PHASE_SEVEN_IDS` (new array) and append it to `ALL_IDS`, following the Phase 4/5 precedent exactly.

## Security Domain

`security_enforcement` is not set in `.planning/config.json` → treated as enabled, per instructions. This phase's security surface is narrow (composition/pinning, not a new attack surface), but it is not zero: it is the phase that decides which third-party code executes with full user permissions on a credential-bearing laptop.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture (secure component sourcing) | yes | Exact-pin every third-party install; vendor anything without a LICENSE file; `isPinnedPackageSpec` gate (already built, Phase 1) |
| V14 Configuration (dependency management) | yes | `ignore-scripts` hardening (Phase 1) must run before any `pi install` in this phase's plan; `--assert-hardening` is the ordering gate |
| V2/V3/V4 (auth, session, access control) | no | This phase has no auth surface of its own |
| V5 Input Validation | no | No new user-facing input surface introduced by composition |
| V6 Cryptography | no | Not applicable |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious `postinstall` script in a newly-installed extension | Tampering / Elevation of Privilege | `ignore-scripts=true` (Phase 1, project + user scope), asserted via `bin/bootstrap.sh --assert-hardening` before this phase's `pi install` runs. Confirmed empty for every package this phase recommends (`npm view <pkg> scripts.postinstall`, all empty). |
| A caret-range transitive dependency silently upgrading to a compromised version between installs | Tampering | Avoided where a zero-dependency bundled alternative exists (this document's recommendation for todo/ask-user/plan-mode); documented as an accepted residual where it does not (LSP/web-access/session-finder/background-tasks/subagents carry no such defect) |
| A vendored package with no LICENSE file being depended on instead of vendored, creating unclear legal/audit status for code executing with full permissions | Repudiation (of provenance) | EXT-10's rule, enforced by this phase: `pi-loop-police` vendored, not depended on |
| Typosquat / slopsquat package name | Spoofing | `slopcheck` scan run (0 `[SLOP]` results); high star counts (1,000-3,000+) and multi-day publication history on the core recommendations make this class of attack implausible here, though package **names** themselves remain `[ASSUMED]` per the strict provenance rule (see Assumptions Log A1) |

## Sources

### Primary (HIGH confidence)
- `npm view <pkg> version dist.fileCount dist.unpackedSize license repository.url dependencies peerDependencies time scripts.postinstall` — run live for every recommended/considered package, 2026-08-15, this session
- `gh api repos/nicobailon/pi-subagents`, `gh api repos/sebaxzero/pi-loop-police` — run live, 2026-08-15
- `npm pack <pkg>` + `tar -xzf`/`tar -tzf` for `pi-subagents@0.49.0`, `pi-background-tasks@2.4.2`, `@narumitw/pi-lsp@0.49.4`, `@narumitw/pi-plan-mode@0.49.3`, `pi-loop-police@1.14.1`, `@davideasden/pi-undo@0.2.11`, `pi-web-access@0.22.0`, `pi-session-finder@0.5.6` — every source file cited above was read from these tarballs directly, not from a README
- `C:\Users\Admin\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\examples\extensions\` — full 80-file directory listing, and full reads of `git-checkpoint.ts`, `subagent/agents.ts`, `subagent/README.md`, `todo.ts` (partial), `question.ts` (partial), `questionnaire.ts` (partial)
- `C:\Users\Admin\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\packages.md` — full read, `pi list`/filtering/vendoring mechanics
- Direct execution on this machine: `fs.symlinkSync` EPERM/junction test, `git config core.longpaths`, `git --version`
- This repository: `.planning/phases/07-composed-extensions-pinned-reviewed/07-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/PROJECT.md`, `docs/RUNBOOK.md`, `tests/unit/pinning.test.ts`, `tests/unit/docs-policy.test.ts`, `tests/helpers/git.ts`, `.pi/settings.json`, `CONTRIBUTING.md`

### Secondary (MEDIUM confidence)
- `pi-subagents` `README.md`/`src/extension/subagent-guide.ts` prose (not fully read) for feature-list claims not independently traced to source (e.g. exact FleetView UI behavior, `/subagents-fleet` command existence — not verified in this session, carried from CONTEXT.md)

### Tertiary (LOW confidence)
- `python -m slopcheck`'s package-age heuristic for `pi-session-finder`/`awesome-pi-themes`/`@davideasden/pi-undo` — a single heuristic tool's opinion, not cross-verified against actual git commit history for any of the three

## Metadata

**Confidence breakdown:**
- Standard stack (versions/licenses/postinstall): HIGH — every fact independently re-verified live today via `npm view`/`gh api`, zero drift from the orchestrator's prior pass
- Worktree/EPERM/junction findings: HIGH — executed directly on this machine, not inferred
- Delegate/fusion tool-filtering finding: HIGH — read directly from unpacked source, both the manifest and the registration call sites
- Caret-range pin-residual findings: HIGH — read directly from `npm view dependencies`/`peerDependencies` output
- Bundled-vs-third-party recommendation for todo/ask-user/plan-mode: MEDIUM — a reasoned judgment call built on HIGH-confidence facts, explicitly flagged as open to planner override (Assumption A5)
- `pi-subagents` internal settings-key path for `worktreeSetupHook`: MEDIUM — call sites confirmed, exact settings surface not fully traced (Open Question 1)
- Package-name provenance: per the strict rule, all package names are `[ASSUMED]` regardless of the HIGH confidence on the facts about them (Assumption A1)

**Research date:** 2026-08-15
**Valid until:** 3-5 days (this ecosystem ships 13-16 releases/month; the phase's own thesis is that this document must be re-verified, not trusted, at execution time)
</content>

---

## Addendum — orchestrator's independent tarball verification (2026-08-15)

Verified by a second, independent pass that unpacked each tarball with `npm pack` + `tar -xf`
(no `npm install`, no lifecycle scripts). Where this addendum and the body above disagree,
**this addendum wins** — it was read from unpacked package source with exact line numbers.

### A1. `pi-subagents@0.49.0` registers FOUR always-active parent-session tools, not two

The body (§Pattern B) says "`subagent` and `subagent_wait`, plus a conditional
`contact_supervisor`/`intercom` pair". That undercounts the Phase 10 baseline. Verified:

| Tool | Where registered | file:line |
|---|---|---|
| `subagent` | extension factory, unconditional | `src/extension/index.ts:576` (name), `:621` (register) |
| `subagent_wait` | unconditional — the `enabled` flag only changes behaviour and appends a sentence to the description; it does **not** skip registration | `src/runs/background/wait-tool.ts:9`, `:33` |
| `subagent_supervisor` | `session_start` -> `supervisorChannel.start()` -> `registerParentTools()` | `src/extension/index.ts:835` -> `src/intercom/native-supervisor-channel.ts:766`, `:650` |
| `intercom` | same path, same call | `src/intercom/native-supervisor-channel.ts:651` |

`contact_supervisor` is **child-process only** — guarded by `if (!readChildMetadata()) return;`
at `src/intercom/native-supervisor-channel.ts:299`, registered at `:303`. It is not a
parent-session per-turn cost. Likewise `structured_output`
(`src/runs/shared/subagent-prompt-runtime.ts:621`, only when `STRUCTURED_OUTPUT_CAPTURE_ENV` is set).

Confirmed: **zero** `promptSnippet`/`promptGuidelines` hits in the package (good cache-prefix
hygiene), but also **zero** `setActiveTools` hits — all four tools are always live. The real
cost is not the count but the `subagent` tool's parameter schema: ~40 optional fields with long
descriptions (`src/extension/schemas.ts:284`, `:319`), plus **17 slash commands**.

### A2. The `model:` rule is HARDER than Pitfall 4 states — settings CANNOT override frontmatter

Pitfall 4 cites the *bundled example*'s `agents.ts:59-71`. The load-bearing fact is in the
*installed package*: for user/project agents that have frontmatter, an `agentOverrides` setting
**cannot beat** the frontmatter — it only fills gaps.

`pi-subagents/src/agents/agents.ts:1155`:

    if (override.model !== undefined && !agentHasFrontmatterField(agent, "model")) {

`applySubagentDefaultModel` (`:958`) bails identically: `if (agent.model !== undefined) return agent;`.
Builtin agents (no frontmatter file) *are* overridable — `applyBuiltinOverride`, `:1029`.
Project settings beat user settings (`:947`). The shipped doc agrees
(`docs/models.md:12`): per-run override -> agent frontmatter `model` -> `agentOverrides.<name>.model`
-> `subagents.defaultModel` -> parent session model.

**Consequence:** a `model:` key in any `.pi/agents/*.md` this repo ships makes Phase 5's
`routing/agent-overrides.ts` **inert for that agent**. Omitting it is not hygiene, it is the
mechanism. This is directly testable — a plan should assert no shipped agent file contains a
`model:` key, and show the test fails when one is added.

Full frontmatter key list parsed (`src/agents/agents.ts:1527` via a custom YAML-subset parser at
`src/agents/frontmatter.ts:65`, **not** the `yaml` dep — flat `key: value` + folded blocks only).
Required: `name`, `description` (`:1529`). Optional: `package`, `runner`, `tools`, `defaultReads`,
`aliases`/`alias`, `skill`/`skills`, `skillPath`, `model`, `fallbackModels`, `thinking`,
`systemPromptMode`, `inheritProjectContext`, `inheritSkills`, `defaultContext`, `async`,
`timeoutMs`, `turnBudget`, `acceptance`, `acceptanceRole`, `extensions`, `subagentOnlyExtensions`,
`maxSubagentDepth`, `permission`/`permissions`, `toolBudget`, `completionGuard`, `memory`,
`output`, `defaultProgress`, `interactive`. **`thinking` is a real frontmatter key** — EXT-01's
thinking-level requirement is satisfiable in the agent file (emitted to the child as a *model
suffix*, not a flag: `src/runs/shared/pi-args.ts:565`).

### A3. EXT-02 — worktree isolation is source-tree-only; `node_modules` is SYMLINKED to the real one

Exact command sequence, `src/runs/shared/worktree.ts`:
- Preflight (`:138-148`): `git rev-parse --show-toplevel`; `git status --porcelain` scoped with a
  `:!<.pi/subagents dir>` pathspec — **throws "worktree isolation requires a clean git working
  tree" if non-empty**; then `git rev-parse HEAD`.
- Create (`:393`): `git worktree add <path> -b <branch> HEAD`
- Collect (`:516`): `git add -A` inside the worktree
- Teardown (`:428`, `:430`, `:640`, `:740`): `git worktree remove --force`, `git branch -D`, `git worktree prune`

**Untracked files: nothing is copied.** No `cp`/`cpSync`/`git stash`/`--others` anywhere in the
file. `.env` has **zero** handling in the entire package. This is exactly what makes criterion 4
("can BUILD, not merely check out") a real engineering task.

**The one exception is a security finding the plan must address:** `node_modules` is
**symlinked, not copied** (`worktree.ts:243-253`, `linkNodeModulesIfPresent`) via an unqualified
`fs.symlinkSync(nodeModulesPath, nodeModulesLinkPath)`. Two consequences:

1. **Windows:** unqualified `fs.symlinkSync` on a directory needs Developer Mode or elevation and
   otherwise fails `EPERM` — the body's junction remedy (`fs.symlinkSync(..., "junction")`) applies.
2. **Isolation is dependency-tree-shared.** A subagent in an "isolated" worktree has read/write
   access to the **parent repo's real `node_modules`**. A subagent running `npm install`, or any
   package postinstall inside that worktree, mutates the parent dependency tree. Given PROJECT.md's
   security posture (arbitrary extension code, live AWS SSO credentials, `main` auto-deploys), the
   plan must state this explicitly and decide: accept it, or have the setup hook create a real
   `node_modules` instead of a link.

The only sanctioned injection point for untracked files is `runWorktreeSetupHook` (`:336`),
`spawnSync(hook.hookPath, [], { cwd: worktreePath, shell: false })` — opt-in, absolute or
repo-relative path required (`:283`), disabled unless configured. This is where `.env` provisioning
and a Windows-safe `node_modules` strategy both belong.

### A4. Confirmed tool-count baseline for Phase 10 (idle, parent session)

| Package | Always-active tools | Names | `promptSnippet`/`promptGuidelines` | Slash commands |
|---|---|---|---|---|
| `pi-subagents@0.49.0` | **4** | `subagent`, `subagent_wait`, `subagent_supervisor`, `intercom` | **none** | 17 |
| `pi-background-tasks@2.4.2` | **11** | `bg_run`, `bg_run_pi_attested`, `bg_status`, `bg_logs`, `bg_kill`, `bg_delegate`, `bg_result`, `fusion_reason`, `fusion_investigate`, `fusion_research`, `fusion_validate` | **yes — all 11** (13 `promptSnippet` occurrences) | 10 |
| `@narumitw/pi-lsp@0.49.4` | **2** | `lsp_diagnostics` (`src/pi-lsp.ts:50`), `lsp_fix` (`:112`), registered `:146-147` | yes, both | 1 (`/lsp`) |
| `@narumitw/pi-plan-mode@0.49.3` | **0 idle / 2 in plan mode** | `plan_mode_question` (`src/plan-mode.ts:148`), `plan_mode_complete` (`:190`) | yes, both — but gated | 1 (`/plan`) |
| **Idle total if all four installed** | **17** | | | **29 commands** |

`@narumitw/pi-plan-mode` is **the only package of the four that gates its tools**:
`pi.setActiveTools(planModeToolNames())` on entry (`src/plan-mode.ts:848`) and
`withoutRequiredPlanModeTools()` on exit (`src/required-tools.ts:17`). Idle cost is zero. That is
a point in its favour against vendoring the bundled `plan-mode/` example, and the planner should
weigh it against Assumption A5's recommendation rather than treating A5 as settled.

`@narumitw/pi-lsp@0.49.4` registers exactly **2** tools; the other 28 `name:` fields are entries in
`DEFAULT_SERVER_CONFIGS` (`src/adapters.ts:48`) — **LSP server configs, not tools**. (CLAUDE.md
says "17 entries"; the actual count at 0.49.4 is 28. Neither number is a tool count.)

`pi-background-tasks` additionally **force-appends** its tools on session start —
`src/fusion-extension.ts:1273` and `src/delegate-extension.ts:802` both call `pi.setActiveTools(next)`,
so deactivating them from this repo's own extension **will be undone**. Combined with all 11
carrying `promptSnippet`, this package has by far the highest per-turn token tax of the four and
is the single strongest Phase 10 target.

### A5. LICENSE files present in tarball (EXT-10 re-check)

| Package | LICENSE file in tarball | `license` field |
|---|---|---|
| `pi-subagents@0.49.0` | YES — `LICENSE` (MIT, Nico Bailon 2026) | MIT — consistent |
| `pi-background-tasks@2.4.2` | YES — `LICENSE` (ISC) + `THIRD_PARTY_NOTICES.md` | ISC — consistent |
| `@narumitw/pi-lsp@0.49.4` | YES — `LICENSE` (MIT, narumiruna 2026) | MIT — consistent |
| `@narumitw/pi-plan-mode@0.49.3` | YES — `LICENSE` (MIT, same author) | MIT — consistent |
| `pi-loop-police@1.14.1` | NO — GitHub API reports `license=NONE` | `"MIT"` in package.json — **INCONSISTENT -> VENDOR** |
| `@davideasden/pi-undo@0.2.11` | — | **no `license` field at all** — rejected on other grounds too |

`pi-subagents` verbatim manifest — entry points are source-reviewable `.ts`, not prebuilt:

    "pi": { "extensions": ["./index.ts"], "skills": ["./skills"], "prompts": ["./prompts"] }

Note it declares `typebox@1.1.38` as a **dependency, not a peer**, while Pi bundles `1.3.7` —
a second typebox instance is installed. Same major; whether it causes a real schema-validation
break is **UNVERIFIED** and belongs in the plan as a risk to observe, not a claim.

### A6. Still UNVERIFIED after both passes

- **Runtime behaviour of every third-party extension.** Nothing was executed; no Pi install, no
  credentials, no `npm install`. All findings above are static source reads or local `git`/`fs`
  experiments. This is the same carried-forward unknown the ROADMAP names.
- Actual serialized-schema token cost per tool — needs measurement against a running Pi (Phase 10).
- Whether `pi-background-tasks` has an internal disable flag for fusion/delegate beyond file-level
  filtering — not exhaustively ruled out.
- Exact `pi-subagents` settings surface for `worktreeSetupHook` (call sites confirmed, config
  loader not fully traced).
