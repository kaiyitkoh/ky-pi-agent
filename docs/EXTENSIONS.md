# Extensions — provenance for every third-party pin this phase depends on

This file exists because a pin copied out of a research document is not a
pin. Four of thirteen candidate versions moved between `.planning/research/STACK.md`
(2026-08-13) and `07-CONTEXT.md` (2026-08-15) — 48 hours apart. Phase 7's
whole thesis is that every version, license and repository fact it depends on
is re-resolved live, at the moment the phase actually executes, not inherited
from a document that is by definition already stale by the time anyone reads
it.

**The contract of this file**, matching `docs/DIAGNOSTICS.md` and
`docs/SAFETY.md`: if the code (`.pi/settings.json` `packages[]`,
`tests/unit/pinning.test.ts`, the vendored files under `.pi/extensions/`) and
this document disagree, **the code is authoritative and this document is a
bug.** Fix the document; do not fix the code to match the document. Any
future version bump must re-run the commands in the next section rather than
trust the numbers recorded here.

**Sections:** Verification provenance, Installed packages, Vendored (not
depended on), Dropped (with reasons), Known Pin Residuals, Worktree isolation
(accepted residual), Download counts are not evidence.

---

## Verification provenance

Run date: **2026-08-14 / 2026-08-15** (session spanning the date boundary;
timestamps below are the actual command-output UTC times, not a single
calendar day).

**Hardening precondition — Task 1 of this plan, run before any registry or
tarball command below:**

```
$ sh bin/bootstrap.sh --assert-hardening
Hardening assertions (ignore-scripts):
  ignore-scripts=true  repo root (/c/Users/Admin/Documents/ky-pi-agent)
  ignore-scripts=true  project prefix (/c/Users/Admin/Documents/ky-pi-agent/.pi/npm)
  ignore-scripts=true  user-scope prefix (/c/Users/Admin/.pi/agent/npm)
All npm scopes are hardened.
exit=0
```

Run at `2026-08-14T19:09:39Z`. The three assertions it reports are the repo
root scope, the project `.pi/npm` prefix scope, and the user-scope
`~/.pi/agent/npm` prefix — every scope `pi install` can write into. This is
the ordering control for the whole phase: `pi install` runs npm lifecycle
scripts (`bin/bootstrap.sh`'s own header, BOOT-01), and no install task
anywhere in Phase 7 may run against a machine this assertion has not first
certified. It exited 0 before any `npm view`, `npm pack`, or `gh api` call
in this document was made.

**Live re-resolution commands, run in this session against the real
registry/API/tarballs:**

```
npm view <pkg> version license repository.url dependencies peerDependencies \
  scripts.postinstall scripts.preinstall scripts.install time.modified \
  dist.fileCount dist.unpackedSize

gh api repos/<owner>/<repo> --jq '{stars: .stargazers_count, pushed_at, archived, license: .license.spdx_id}'

npm pack <pkg>@<resolved-version>   # run from a scratch dir, never this repo or ~/.pi
tar -tf <tarball> | grep -i licen
```

Run against all six packages this phase's research names as installable or
vendorable candidates: `pi-subagents`, `pi-background-tasks`,
`@narumitw/pi-lsp`, `pi-web-access`, `pi-session-finder`, `pi-loop-police`.
`npm pack` was run in a directory under this session's scratchpad temp
directory (outside the repo and outside `~/.pi`), and the temp directory was
deleted after the tarball listings were captured. No `npm install`,
`pi install`, or `slopcheck install` was executed by this plan — `npm pack`
downloads a tarball without running lifecycle scripts, and `tar -tf` never
extracts it.

---

## Installed packages

Five packages, exact-pinned as `npm:<name>@<version>`. Every version below
was resolved live in this session and is **UNCHANGED** against `07-CONTEXT.md`'s
2026-08-15 re-verified table — no drift in the hours between context
generation and this plan's execution.

| Package | Version | License field | LICENSE in tarball | Repository | `pushed_at` | Archived | Lifecycle scripts | Capability |
|---|---|---|---|---|---|---|---|---|
| `pi-subagents` | `0.49.0` | MIT | yes | `nicobailon/pi-subagents` | `2026-08-14T19:08:02Z` | false | none (postinstall/preinstall/install all empty) | Subagent isolation, background execution (`async`), mid-run steering, `contact_supervisor` escalation, per-agent model/prompt/tools/thinking |
| `pi-background-tasks` | `2.4.2` | ISC | yes | `ismailsaleekh/pi-background-tasks` | `2026-08-13T23:58:10Z` | false | none | `bg_run`/`bg_status`/`bg_logs`/`bg_kill` background bash (plus 7 delegate/fusion tools accepted as unavoidable overhead — see below) |
| `@narumitw/pi-lsp` | `0.49.4` | MIT | yes | `narumiruna/pi-extensions` | `2026-08-14T16:17:22Z` | false | none | 2-tool LSP diagnostics bridge (`lsp_diagnostics`, `lsp_fix`) |
| `pi-web-access` | `0.22.0` | MIT | yes | `nicobailon/pi-web-access` | `2026-08-12T19:44:51Z` | false | none | Web/documentation lookup (Exa, DuckDuckGo, Jina Reader — genuinely keyless) |
| `pi-session-finder` | `0.5.6` | MIT | yes | `pungggi/pi-session-finder` | `2026-08-02T22:35:36Z` | false | none | Session search (`/find`, `/find-back` commands; zero model-facing tools) |

Model-facing tool counts and names for each of these are **not restated
here**. `tests/unit/tool-count-baseline.test.ts` is the authoritative
registry Phase 10 measures against, per the Phase 6 D-8 precedent (see
`docs/WORKFLOWS.md`'s own "no numbers here" discipline for the same reason:
a doc that can grow a number the code does not have becomes a second source
of truth).

`pi-background-tasks`' peer range
`@earendil-works/pi-coding-agent: ^0.81.1 || ^0.82.1 || ^0.83.0 || ^0.84.0`
is satisfied by this repo's pinned `0.84.1`, and is a real constraint on any
future Pi bump — the union of four caret ranges still excludes `0.85.x`.

---

## Vendored, not depended on

Per decision 4 (CONTEXT.md): anything without a LICENSE file is vendored,
never installed as a dependency (EXT-10). Per EXT-06 and the research pass's
own finding (07-RESEARCH.md Pitfall 3), three further items are vendored
because their only third-party alternative carries a transitive caret-range
dependency this repo cannot exactly pin, and Pi's own bundled example covers
the need in full.

| Vendored item | Reason | Upstream provenance |
|---|---|---|
| `pi-loop-police` | EXT-10 — GitHub API reports `license: null` (re-confirmed live this session, `gh api repos/sebaxzero/pi-loop-police`), and the packed tarball (`npm pack pi-loop-police@1.14.1` + `tar -tf`) ships **no LICENSE/LICENCE file at all** despite `"license":"MIT"` in `package.json` | npm `pi-loop-police@1.14.1`, 11 files, 110,059 bytes unpacked, `time.modified=2026-08-11T22:04:31Z` |
| `plan-mode/` (`index.ts` + `utils.ts` + `read-only.ts`), registers `/plan-mode` (renamed from `/plan` by plan 09-03, DEVIATION 6 — the ceremonial `/plan` workflow now owns that name) | EXT-06 — the npm alternative `@narumitw/pi-plan-mode@0.49.3` depends on `@narumitw/pi-tui-kit@^0.49.1`, a caret range `isPinnedPackageSpec` cannot see and this repo cannot exactly pin | Pi 0.84.1 `examples/extensions/plan-mode/index.ts` (390 lines) + `utils.ts` (168 lines) = 558 lines |
| `todo.ts` | EXT-06 — the npm alternative `@juicesharp/rpiv-todo@2.5.2` depends on `@juicesharp/rpiv-config@^2.5.2` and `typebox@^1.1.24`, both caret ranges | Pi 0.84.1 `examples/extensions/todo.ts` (297 lines) |
| `questionnaire.ts` | EXT-06 — the npm alternative `@juicesharp/rpiv-ask-user-question@2.5.2` carries the identical `rpiv-config`/`typebox` caret defect | Pi 0.84.1 `examples/extensions/questionnaire.ts` (448 lines) |
| `git-checkpoint.ts`, hardened | EXT-07 — the shipped 53-line file does nothing headless (`git-checkpoint.ts:33-36`, `if (!ctx.hasUI) return`), never captures untracked files (`:22`, `pi.exec("git",["stash","create"])` with no `-u`), and stores checkpoints in an in-memory `Map` cleared on `agent_end` (`:11,29,49-51`); every third-party file-checkpointing alternative surveyed is weaker still (see Dropped, below) | Pi 0.84.1 `examples/extensions/git-checkpoint.ts` (53 lines), hardened by a later plan in this phase's wave |

**Flat placement rule (decision D-07-D).** Every vendored item above sits
FLAT under `.pi/extensions/`, never nested under a `vendor/` parent
directory — `.pi/extensions/loop-police/`, not
`.pi/extensions/vendor/loop-police/`. `tests/unit/extension-layout.test.ts:58`
defines `NESTED_INDEX` as
`/^\.pi\/extensions\/[^/]+\/index\.ts$/` — exactly one directory level below
`.pi/extensions/`. A `vendor/` parent directory would push every vendored
entry point to two levels deep, which this regex does not match and which
`/reload` therefore cannot hot-reload (per `tests/unit/extension-layout.test.ts`'s
own BOOT-05 structural precondition). `07-RESEARCH.md`'s suggested
`.pi/extensions/vendor/<name>/` layout is superseded by this decision, which
was settled in `07-CONTEXT.md`'s `<settled_decisions>` block specifically
because the test enforces the flat shape structurally, not as a style
preference.

---

## Dropped, with reasons

These names appeared in prior research (`STACK.md`, `07-CONTEXT.md`,
`07-RESEARCH.md`) and are **not** installed or vendored by this phase.
Recorded so Phase 8 does not silently re-open a settled decision.

| Package | Reason dropped |
|---|---|
| `pi-model-fallback` | Phase 3 (`.pi/extensions/providers/fallback.ts`, `callWithFallback`/`classifyFailure`) and Phase 5's routing (`usesFallbackChain`) already cover the need. Installing it would put a **second, uncoordinated** fallback controller in the model-call path — one `tests/unit/chokepoint-lint.test.ts` does not see and the Phase 2 wire inspector does not record. Two fallback controllers disagreeing is worse than either alone. This is an architectural objection, not an adoption/star-count one: the package is unchanged since 2026-08-03, 1★, but that is not why it is dropped. |
| `@davideasden/pi-undo` | No `license` field in `package.json` at all (the LICENSE file itself IS present in the tarball — a narrower defect than the missing-metadata framing suggests, but moot). File checkpointing is served by hardening Pi's own `git-checkpoint.ts` instead. |
| `@pi-plugins/checkpoint` | Depends on `effect@4.0.0-beta.*` and `@effect/platform-node@4.0.0-beta.*` — a beta functional-programming runtime in the tool-execution path, on a machine holding live AWS SSO credentials. Disqualified by the security posture, not by maturity (v0.1.2). |
| `pi-rewind-hook` | GitHub API reports `license: null` — the same defect shape as `pi-loop-police`, on a package this phase does not have separate EXT-10 budget to vendor. |
| `@juicesharp/rpiv-todo` | Depends on `@juicesharp/rpiv-config@^2.5.2` (caret) and `typebox@^1.1.24` (caret, a second uncontrolled typebox instance). Vendored bundled `todo.ts` covers the need with zero dependencies beyond the standard peers. |
| `@juicesharp/rpiv-ask-user-question` | Same caret-range defect family as `rpiv-todo`. Vendored bundled `questionnaire.ts` instead. |
| `@narumitw/pi-plan-mode` | Depends on `@narumitw/pi-tui-kit@^0.49.1` (caret). Vendored bundled `plan-mode/` instead. |
| `pi-provider-qoder`, `pi-qoder-provider` | Standing do-not-install (07-CONTEXT.md decision 3) — WAF-bypass body encoding and COSY signature forging against `gateway.qoder.sh`; breach Qoder ToS §3.2.6/§3.2.9/§3.2.10. |
| `cc-safety-net` | Standing do-not-install — prebuilt `dist/pi/index.js`, not source-reviewable. |
| `pi-sandbox` | Standing do-not-install — macOS/Linux only (`sandbox-exec`/`bubblewrap`), no Windows path. |
| `@ramtinj95/pi-infra-command-guard` | Standing do-not-install — hard peer dependency on `@howaboua/pi-codex-conversion`, which drags in `openai`, `web-tree-sitter`, `tree-sitter-bash`, `ws`. Already consumed as a read-only reference in Phase 4. |
| `@gotgenes/pi-subagents-worktrees` | Standing do-not-install — peer-depends on a third subagents package (`@gotgenes/pi-subagents >=16.4.0`) and silently no-ops against `pi-subagents`, this phase's actual pick. |
| `pi-defender` | Standing do-not-install — declares `pi-tui` as a `dependency`, not a `peerDependency`, installing a second, stale copy. |
| `@ayulab/pi-rewind` | Standing do-not-install — repo `ayu-exorcist/oh-my-pi` is archived; GPL-3.0. |
| `pi-rewind@0.5.0`, `pi-high-availability`, `pi-provider-fallback` | Standing do-not-install — stale (last push 2026-03-31 / 2026-03-19), or unmaintained (147 dl/mo, no publish since 2026-06-22). |

---

## Known pin residuals

`isPinnedPackageSpec` (`tests/unit/pinning.test.ts`) governs only the
top-level `packages[]` spec string this repo writes into
`.pi/settings.json` — `npm:pi-subagents@0.49.0`, for example. It has no
visibility into what that package's own `dependencies`/`peerDependencies`
resolve to at `pi install` time; those are ordinary npm semver, outside any
lockfile this repo controls. Re-derived from Task 2's live `npm view <pkg>
dependencies` output (not copied from `07-RESEARCH.md`, which surveyed a
different candidate set):

| Package | Dependency | Range | Residual |
|---|---|---|---|
| `pi-web-access` | `@mozilla/readability` | `^0.6.0` | caret |
| `pi-web-access` | `linkedom` | `^0.16.0` | caret |
| `pi-web-access` | `p-limit` | `^6.1.0` | caret |
| `pi-web-access` | `promise.try` | `^2.0.1` | caret |
| `pi-web-access` | `turndown` | `^7.2.0` | caret |
| `pi-web-access` | `typebox` | `^1.1.38` | caret — a **third** uncontrolled `typebox` instance (Pi bundles `1.3.7`; `pi-subagents` pins its own `1.1.38` exact) |
| `pi-web-access` | `unpdf` | `^1.6.2` | caret |
| `pi-web-access` | `undici` | `^8.9.0` | caret |
| `pi-subagents` | `typebox` | `1.1.38` | exact (no caret), but a **second module instance** alongside Pi's bundled `1.3.7` — Pi loads packages with separate module roots |
| `pi-subagents` | `jiti` | `2.7.0` | exact, second module instance |
| `pi-subagents` | `yaml` | `2.8.3` | exact, second module instance |
| `pi-background-tasks` | `turndown` | `7.2.4` | exact |
| `@narumitw/pi-lsp` | — | — | peers only, no runtime dependency |
| `pi-session-finder` | — | — | peers only, no runtime dependency |

The runtime consequence of the second/third `typebox` instance is marked
**UNVERIFIED** per decision 5 — an observation to carry forward, not a claim
this plan makes either way. `pi-web-access` is the only one of the five
installed packages carrying genuine transitive caret ranges; `pi-subagents`'
own dependencies are exact pins in their own right; `pi-background-tasks`'
single dependency is likewise exact.

---

## Worktree isolation — accepted residual

`pi-subagents@0.49.0`'s `linkNodeModulesIfPresent`
(`src/runs/shared/worktree.ts:243-254`) symlinks — does not copy —
`node_modules` into a worktree using the unqualified two-argument
`fs.symlinkSync(target, link)` form, which requires
`SeCreateSymbolicLinkPrivilege` on Windows and fails `EPERM` on this class of
machine without Developer Mode or elevation (07-RESEARCH.md Pattern B,
verified directly on this machine). An "isolated" subagent worktree therefore
either fails to build `node_modules` at all, or — if a workaround is
misapplied — gains read/write access to the parent repo's real dependency
tree rather than a genuinely isolated one.

**Decision taken: accepted for this phase.** The setup hook this phase ships
(`worktreeSetupHook`, a real exposed config key at
`src/runs/foreground/subagent-executor.ts:3223-3224` and
`src/runs/background/subagent-runner.ts:3794`) uses a Windows junction
(`fs.symlinkSync(src, dst, "junction")`, confirmed to work with no elevation
on this machine) for the same reason a real `npm ci` per worktree is
rejected: it costs minutes and network on every subagent spawn. The
mitigating control is not technical isolation — it is behavioural: a
subagent that runs a package-manager install (`npm install`, `npm ci`, etc.)
inside a junctioned `node_modules` mutates the **parent repo's real tree**,
not a private copy. That gap is named here as a **Phase 8 follow-up**,
not solved in Phase 7.

**Link mechanism, re-measured by `tests/integration/worktree-build.test.ts`
(07-05, not merely assumed from 07-02's own measurement):**

| Form | Result on this machine, 2026-08-15 |
|---|---|
| `fs.symlinkSync(target, link, "junction")` — the form the shipped hook uses | **Succeeds unconditionally**, no Developer Mode / elevation needed. Asserted every run; this is the mechanism the positive proof (build succeeds in the worktree after the hook runs) depends on. |
| `fs.symlinkSync(target, link)` — the unqualified two-argument form `pi-subagents`' own `linkNodeModulesIfPresent` uses | **Measured, not asserted**: `EPERM: operation not permitted` on this machine, same as 07-02's manual probe. This outcome is environment-dependent (Developer Mode / elevation / POSIX) — the test reports whichever outcome occurs rather than asserting `EPERM` universally, so the suite does not fail on a correctly-configured machine. |

A source-level regression guard in the same test file rejects an unqualified
two-argument `symlinkSync(` call site in
`.pi/scripts/worktree-setup-hook.mjs`. Falsified before this plan's commit:
reverting the hook's third `"junction"` argument turned both the regression
guard **and** the step-8/step-9 positive build proof red (the hook itself now
fails closed with `EPERM` and exits non-zero, so the worktree build was never
reached) — see `07-05-SUMMARY.md` for the exact failing test names.

**Reminder, restated from the paragraph above:** the junction points at the
**parent's real `node_modules`**, not a private copy — a subagent running a
package-manager install inside its worktree mutates the parent tree. Still a
**Phase 8 follow-up**, not solved here.

### Second accepted residual: the hook is wired at MACHINE scope, and it copies `.env` (WR-03)

Added by the Phase 7 code review. `T-07-07` above records the
`node_modules`-sharing residual and `T-07-08` records why `.env` is copied
rather than linked. Neither records the consequence of the two combined with
the **scope** the hook is wired at.

`bin/bootstrap.sh#merge_subagent_config` writes `worktreeSetupHook` into
`pi-subagents`' own config file, which is **user-scope**
(`<agentDir>/extensions/subagent/config.json`, plan 07-09) — there is no
project-scope alternative, and the hook path must be absolute for the same
reason. So the hook applies to **every repository the operator ever runs Pi
in on this machine**, and in each of them a worktree-isolated subagent spawn
copies **that repository's `.env`** into a fresh worktree directory
`pi-subagents` places wherever it likes, commonly outside the repo.

**Decision taken: accepted, narrowed, and stated.** The copy is kept — most
build steps a subagent runs need it, and dropping it would make the
worktree-build proof this phase ships a different and weaker claim. It is
narrowed three ways, all of them covered by
`tests/integration/worktree-build.test.ts`'s WR-08 block:

- The copy **never overwrites** an existing `.env` in the worktree. It used
  to, unconditionally — in a repository where `.env` is *tracked* (bad
  practice, common for non-secret defaults) `git worktree add` checks it out
  and the hook replaced it, then declared it synthetic, which makes
  `pi-subagents` delete it before every diff/cleanup pass.
- A copy that IS made is `chmod 0600` best-effort rather than inheriting
  whatever mode the source carried.
- A skipped copy is reported on stderr, never silent.

**What is still true and not solved here:** a secret-bearing file leaves its
repository's directory tree, in every repository on this machine, whenever a
worktree subagent spawns. The alternative — opting in per repository — needs
a project-scope config surface `pi-subagents@0.49.0` does not expose. Named
as a **Phase 8 follow-up** alongside `T-07-07`, not silently carried.

### Third accepted residual: checkpoint capture writes untracked file content into `.git/objects` (WR-19)

Also added by the Phase 7 code review, and it is the *converse* of the
`.gitignore` scope boundary `.pi/extensions/checkpoint/git.ts` already states.

`createCheckpoint` captures every untracked-but-not-ignored file on **every
turn** — that is defect 2's fix and it is the point of the module. The
consequence is that their content is written into `.git/objects`, where it
**survives deleting the file, survives `git checkout`, and is recoverable by
anyone holding the repository directory**. In a repository where a secrets
file is untracked and **not** matched by `.gitignore` — a `config.local.yaml`,
a downloaded `.pem` under a name the patterns miss, a `terraform.tfstate`
variant — a secret is persisted there on every turn.

Note also that `index.ts`'s provenance header frames the *opposite* as the
defect being fixed ("`.env`-class untracked work is silently never captured").
Both cannot be right. `git.ts`'s SCOPE BOUNDARY is the accurate one, and it now
says so.

**Decision taken: mitigated, not solved.** `git add -A` is now run with
`CHECKPOINT_EXCLUDE_PATHSPECS` applied to **both** `add -A` call sites (the
capture, and the "what exists now" side of the restore's set difference), so
an excluded path is absent from both trees and can therefore never be captured
*nor deleted by a restore*. That symmetry is why the exclusions live in one
exported constant rather than two literal lists. It is two lists composed into
one:

- `SECRET_EXCLUDE_PATHSPECS` — `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`,
  `id_ed25519*`, `*credentials`, `*.tfstate`, `*.tfstate.*`. The leading `*`
  on `*credentials` is load-bearing (WR2-05): a git pathspec with no wildcard
  is a literal path match, so the bare `credentials` form excluded only a
  repo-root file of that name while `sub/.aws/credentials` — the shape the
  exclusion is named for — was captured on every turn. Git's `*` crosses `/`
  without `:(glob)` magic, which is why `*.pem` beside it always matched at
  any depth.
- `MACHINE_STATE_EXCLUDE_PATHSPECS` — `.pi/state`, `.pi/logs`, `node_modules`,
  `.env`, `.terraform`.

**What is still true:** a secret under an unremarkable name is still captured.
This repository's own `.gitignore` is thorough, which is why the review rated
this a warning rather than a blocker; the extension is written to be
repo-agnostic and cannot assume the next repository's is.

### The restore half of the same residual (CR2-03) — closed, not accepted

The second review iteration found that the argument above had a hole large
enough to be a blocker on its own, and it is recorded here because
`docs/EXTENSIONS.md` previously described only the *capture* hazard and said
nothing about restore.

`git add -A` respects `.gitignore` **and nothing else**. So "gitignored paths
cannot enter the added set and cannot be deleted" was a statement about the
repository the session happens to be in, not about this extension. In a
repository that does not ignore them, `.pi/state/`, `.env`, `node_modules/`
and `.terraform/` were ordinary untracked-non-ignored paths, landed in the
added set, and were **deleted by a restore** — including this extension's own
checkpoint store, which `store.ts` creates moments after each capture.
Measured on a fresh repository with no `.gitignore`: after one restore,
`.pi/state/checkpoints.json` was gone and `readCheckpoints()` returned `[]`,
so every other checkpoint became unreachable and the extension reported "no
checkpoints recorded yet". `package.json` declares
`pi.extensions: ["./.pi/extensions"]`, so the documented `pi install` path
loads this at user scope and it applies to every repository the operator
opens.

`MACHINE_STATE_EXCLUDE_PATHSPECS` closes it by name rather than by
`.gitignore`, and `git.ts`'s docstring no longer claims the set difference is
safer than `git clean -fd` for untracked-non-ignored paths — for those it was
identical. `tests/integration/git-checkpoint.test.ts` case 7 asserts it **in a
repository with no `.gitignore` at all**, which is what makes it an assertion
about the mechanism.

**Restore is reversible.** Whatever survives the exclusions, the CR-02
contract still requires deleting files created after the checkpoint, some of
which the user may have written by hand. `restoreCheckpoint` therefore takes a
checkpoint of the current tree *first*, anchors it under
`refs/kypi-checkpoints/`, and returns its SHA as `undoSha`; both call sites in
`index.ts` show the user `/checkpoint-restore <undoSha>`. Case 8 proves the
round trip byte-exactly.

---

## Download counts are not evidence

The npm `downloads/point/last-month` endpoint returned figures
byte-identical to `07-STACK.md`'s 2026-08-13 numbers for every package
surveyed, across a two-day gap — implausible for a genuinely rolling 30-day
window, and the conclusion `07-CONTEXT.md` and `07-RESEARCH.md` both already
reached: the endpoint is CDN-cached. Freshness judgements in this repository
rest on npm `time.modified` and GitHub `pushed_at` instead, both of which
demonstrably moved during this very session (`pi-subagents`' `pushed_at`
advanced from `2026-08-14T17:20:03Z` at context-generation time to
`2026-08-14T19:08:02Z` at this plan's execution time — under two hours
later). Do not re-cite a download count as evidence of anything in this
repository.

---

## Subagent capability evidence

EXT-03 (background execution without blocking) and EXT-04 (mid-run steering
without killing) are claims about **third-party runtime behaviour**. Nothing
in this section was executed — no `pi install`, no credentials, no spawned
process. Every row below is a citation read directly from the unpacked
`pi-subagents@0.76.1` tarball (`npm pack pi-subagents@0.76.1 --ignore-scripts`
+ `tar -xf` into an empty scratch directory, never installed or run),
**re-derived in Phase 08.1 plan 04 from the published compiled `.js`** rather
than renamed from the 0.49.0 `.ts` citations (the file layout moved from
`.ts` to tsc output, so no old line number survives). The package ships no
`.ts`; see "Compiled-JS exception (Phase 08.1)" below.
`tests/unit/subagent-capabilities.test.ts` binds every `pi-subagents` row's
Version cell to whatever `.pi/settings.json`'s `packages[]` currently pins —
the row goes stale, not silently correct, the moment that pin moves without a
re-read.

**Complete tool list the pinned package registers** (grep of `registerTool(`
in `src/`, 0.76.1): `subagent` (`src/extension/index.js:667,699`; also the
fan-out child copy `src/extension/fanout-child.js:213,229`), `bg_wait`
(`src/runs/background/wait-tool.js:28,34`, called from
`src/extension/index.js:712`), `subagents_enable` (the dynamic-activation
loader, `src/extension/tool-activation.js:78,114`), `contact_supervisor`
(child side `src/intercom/native-supervisor-channel.js:183,192`; herdr bridge
`src/extension/herdr-pi-bridge.js:96`), a parent-side supervisor tool built at
`native-supervisor-channel.js:655`, and child-runtime-only tools
(`src/runs/shared/subagent-prompt-runtime.js:439`, the watchdog diff tool at
`:488`). 0.49.0's `subagent_wait` is now `bg_wait`; `intercom` is no longer a
tool this package registers (it is only referenced as an event tool name at
`native-supervisor-channel.js:597`). The loader `subagents_enable` carries a
`promptSnippet` (`tool-activation.js:82`), so activating `subagent` through it
rebuilds the system prompt — a Phase 10 measurement item, not a change here.

**A correction, stated plainly (carried from 07-09, re-confirmed at 0.76.1).**
`agentScope` is not a `.pi/settings.json` key; it exists only as a per-tool-call
parameter on the `subagent` tool's own schema (`src/extension/schemas.js:228`),
resolved by `resolveExecutionAgentScope()` (`src/agents/agent-scope.js:1-5`)
to `"both"` whenever a caller omits it. `.pi/agents/planner.md` is therefore
already discovered by the per-call default — no `.pi/settings.json` write
exists to make. The repo's own half (the tracked agent file, and the pinned
`packages[]` entry) is asserted separately by
`tests/unit/subagent-capabilities.test.ts`'s Binding 4.

**Two behaviours that CHANGED between 0.49.0 and 0.76.1, found while
re-deriving.** (1) The frontmatter-`model:` guard on `agentOverrides` is gone:
`applyBuiltinOverride` sets `next.model = override.model` unconditionally
(`src/agents/agents.js:1211-1215`) and project agents receive overrides via
`applyCustomAgentOverrides` (`agents.js:1340-1356`, applied at `:2646`).
`.pi/agents/*.md` still carry no `model:` key (conservative invariant kept by
`tests/unit/subagent-agents-config.test.ts`). (2) On Windows the background
runner is **not** detached (`src/runs/shared/background-process-options.js:3`,
`detached: platform !== "win32"`); the `subagent` tool's `async` flag now
defaults to the config's `asyncByDefault` (`src/extension/schemas.js:221`,
`src/extension/index.js:9`). Neither is exercised here; both are RB-07-01
observation items on this Windows machine.

| Requirement | Mechanism | Package | Version | Evidence | What this proves | What this does NOT prove |
|---|---|---|---|---|---|---|
| EXT-01 | Agent frontmatter's `thinking` key is read into the resolved per-agent run config | pi-subagents | 0.76.1 | src/agents/agents.js:2044 | The `thinking: high` line in `.pi/agents/planner.md` is a real, parsed frontmatter field, not inert prose | This mechanism was read from source and never executed; nothing here shows the planner subagent actually receives `thinking:"high"` on a real run. The live check is `RB-07-01` (OUTSTANDING). |
| EXT-01 | `agentOverrides.model` (settings-level routing) is applied to project/user agents through `applyCustomAgentOverrides`, and `override.model` is assigned unconditionally (the 0.49.0 frontmatter guard no longer exists) | pi-subagents | 0.76.1 | src/agents/agents.js:1211 | Phase 5's `/cheap`/`/balanced`/`/max`/`/escalate` routing writes reach `.pi/agents/*.md` agents whether or not frontmatter declares a model; `.pi/agents/planner.md` still carries no `model:` key as a conservative invariant | This mechanism was read from source and never executed; nothing here shows a live `agentOverrides` write actually reaches the planner subagent's resolved model at runtime. The live check is `RB-07-01` (OUTSTANDING). |
| EXT-01 | `subagent`, `bg_wait` and the `subagents_enable` loader are registered by the extension factory; `contact_supervisor` is registered child-side only; `intercom` is no longer a registered tool | pi-subagents | 0.76.1 | src/extension/index.js:699 | The tool-count baseline (`tests/unit/tool-count-baseline.test.ts`) names the tools the pinned package actually registers; `bg_wait` is the renamed 0.49.0 `subagent_wait` | This mechanism was read from source and never executed; nothing here shows these tools actually appear in a real model's registered or active tool list at runtime (the loader makes `subagent` inactive until called). The live check is `RB-07-01` (OUTSTANDING). |
| EXT-03 | `async` is an optional boolean on the `subagent` tool's own parameter schema ("Background; default asyncByDefault. false only to block parent.") | pi-subagents | 0.76.1 | src/extension/schemas.js:221 | The tool accepts a request to run in the background rather than block the calling turn, and background is the configured default | This mechanism was read from source and never executed; nothing here shows a real model ever sets `async` or that doing so behaves as described. The live check is `RB-07-01` (OUTSTANDING). |
| EXT-03 | A dedicated `bg_wait` tool is registered alongside `subagent`, giving the model a separate call to block on background completion later | pi-subagents | 0.76.1 | src/runs/background/wait-tool.js:28 | Background execution and collecting its result are two distinct tool calls, not one tool that silently blocks internally | This mechanism was read from source and never executed; nothing here shows `bg_wait` is ever actually invoked or that it blocks as documented. The live check is `RB-07-01` (OUTSTANDING). |
| EXT-03 | An async dispatch spawns a separate runner Node process (`spawn(command, args, { ...backgroundProcessOptions(), stdio: ["ignore", ...] })`); `detached` is true on non-Windows platforms only | pi-subagents | 0.76.1 | src/runs/background/async-execution.js:484 | "Does not block" is a process-tree fact: the spawning call does not `await` the child. `src/runs/shared/background-process-options.js:3` shows `detached: platform !== "win32"` (a Windows-relevant difference from 0.49.0), and `async-execution.js:464` shows the `--mode rpc` argument list used for a binary-host launch | This mechanism was read from source and never executed; nothing here shows a runner process actually survives, runs a real model turn, or writes a usable result on this or any machine (Windows included). The live check is `RB-07-01` (OUTSTANDING). |
| EXT-03 | The async call returns an `AgentToolResult` carrying `runId`/`asyncId` in `details` before the spawned work finishes; the eventual output is written under `DIRS.results` and collected later | pi-subagents | 0.76.1 | src/runs/background/async-execution.js:2011 | Non-blocking mechanics: the calling turn receives a start acknowledgement immediately, not the child's eventual output; the result path is `resultFilePath(DIRS.results, id)` (`async-execution.js:1867`) and `bg_wait` is the separate later read | This mechanism was read from source and never executed; nothing here shows the calling turn actually continues productively, or that the eventual result arrives, on a real run. The live check is `RB-07-01` (OUTSTANDING). |
| EXT-04 | The `steer` action's `mode` parameter (`steer`/`follow_up`/`auto`) is a distinct delivery-timing field on the `subagent` tool schema, separate from the stop/interrupt actions | pi-subagents | 0.76.1 | src/extension/schemas.js:173 | The package's own schema carries the property this requirement needs: a steer is a message delivery with a mode, not a kill signal | This mechanism was read from source and never executed; nothing here shows a real running child actually receives and acts on a steer message rather than ignoring it. The live check is `RB-07-01` (OUTSTANDING). |
| EXT-04 | The file-based control inbox validates `{ type: "steer" }` as a request shape (with its own mode check) separate from interrupt/stop requests, using a portable inbox because Windows cannot deliver `SIGUSR2`/`SIGBREAK` cross-process (the module header says so) | pi-subagents | 0.76.1 | src/runs/background/control-channel.js:137 | Steering and termination are different message types carried through the same portable inbox, which is the Windows-relevant mechanism on this machine | This mechanism was read from source and never executed; nothing here shows the running runner actually distinguishes these message types correctly at runtime. The live check is `RB-07-01` (OUTSTANDING). |
| EXT-04 | `deliverSteerRequest` records a `failed` steering target when the run is no longer `running`; otherwise a `running` step is `routed`, a `pending` step is `scheduled`, and any other step status is `failed`; within the cited block no terminal run state is set | pi-subagents | 0.76.1 | src/runs/background/subagent-runner.js:2575 | This is what distinguishes steering from abort at the code level: delivery requires the run to still be running and the block shown sets no terminal state; interrupt/stop are separate request types | This mechanism was read from source and never executed; nothing here shows a real child actually keeps running and incorporates a delivered steer message into its next turn. The live check is `RB-07-01` (OUTSTANDING). |

**The boundary, stated once more in plain words.** The ten rows above
establish two things and nothing further: (1) the cited mechanisms exist in
`pi-subagents@0.76.1`'s own published JavaScript, read in Phase 08.1 plan 04,
and (2) this repository's own composition (`.pi/agents/planner.md`, tracked,
no `model:` key; `.pi/settings.json`'s `packages[]` pinning
`pi-subagents@0.76.1`) is real and machine-asserted. They establish
**nothing** about what actually happens when a real model calls the `subagent`
tool against a real provider, or sends a real `steer` action at a real running
child — that is runtime behaviour, and runtime behaviour was not observed. The
live check for all of it is `RB-07-01` (OUTSTANDING), which composes this
evidence with the existing `RB-02-01` and `RB-03-0x` legs into the one
end-to-end smoke ritual this project's standing policy requires.

### Compiled-JS exception (Phase 08.1)

The review rule in this repository is "source-reviewable `.ts` for anything in
the tool-execution path". **No Pi-1.x-compatible `pi-subagents` release ships
`.ts`**: `pi-subagents@0.76.1` ships 311 `.js` files of unminified tsc output
(`pi.extensions: ["./index.js"]`), with `.d.ts` and `.js.map` files whose
sourcemaps carry no `sourcesContent`. The exception is accepted (orchestrator
resolution 2, 08.1) under these mitigations:

- **Exact pin**, `npm:pi-subagents@0.76.1`, chosen at least 3 days after
  publication (0.77.0, published 2026-10-10, was under 3 days old at execution
  time and was not taken).
- **No install lifecycle scripts** (`npm view` shows no `preinstall`/`install`/
  `postinstall`/`prepare`); **exact-pinned runtime dependencies** `jiti 2.7.0`,
  `yaml 2.8.3`, `acorn 8.18.0`, `undici 8.10.2`, `@js-temporal/polyfill 0.5.1`.
- **Bundle reviewed for exec/network surfaces** (unminified, greppable):
  `node:child_process` is imported by 33 files, among them
  `src/runs/background/async-execution.js:4` (runner spawn),
  `src/runs/shared/worktree.js:2` and `worktree-setup-command.js:1` (git /
  setup hook), `src/runs/shared/acceptance.js:1`,
  `src/runs/shared/external-cli-runner.js:2`, `src/workflows/host-command.js:1`,
  `src/agents/agents.js:4` and `skills.js:4` (`execSync`), and the herdr /
  ghostty inspector clients. `node:net` servers appear only in the herdr
  bridge (`src/extension/herdr-pi-bridge.js:175`, `herdr-connection.js:3`,
  `herdr-placed-run.js:3`). No `fetch(` call and no `from "undici"` import was
  found under `src/`; `process.env` is read in 43 files (runner and child
  configuration). This is a surface inventory, not a line-by-line audit.
- **The safety hook governs every tool the package registers** (the
  `tool_call` hook is name-agnostic apart from the deny table in
  `docs/SAFETY.md`), and child `pi` processes load the user-scope safety stub
  (`tests/integration/subagent-block.test.ts`). `subagent` itself was already
  inside that boundary in Phase 7.
- **The rule stands for everything else**: the other npm packages ship `.ts`
  source at their extension entry points (one disclosed caveat below), and
  every vendored extension is `.ts`.

`pi-web-access@0.38.0` is a partial case of the same exception: its
`pi.extensions` entry is `["./dist"]`, a 1.06 MB bundled build of the `.ts`
source it also publishes (`dist/index.js`, `dist/mcp-cli.js`). Source and
bundle were not diffed against each other; the published `.ts` was the review
subject and the bundle is covered by the same exact-pin / age /
no-install-script mitigations. This caveat is recorded here and is a candidate
for vendoring if Phase 10 finds a reason to carry the package.

---

## Install reconciliation

**Run date: 2026-08-14/2026-08-15** (session spanning the date boundary;
timestamps below are the actual command-output UTC times). This section
records plan 07-10's execution. **No install ran.** The blocking human
gate (Task 2) was not satisfied, so `pi install` was never invoked. Every
fact below is a legitimacy-review finding, not an installed-and-observed
one — read the verdict at the bottom before anything else in this section.

### Gate outcome: NOT SATISFIED

The user's standing pre-authorisation for this checkpoint rested on three
stated grounds. Each was verified rather than taken on faith, per the
package-legitimacy protocol's explicit non-auto-approvable status for this
gate:

| Ground | Claim | Verification result |
|---|---|---|
| (a) | "This dev machine has no credentials — no AWS SSO, no provider keys." | **FALSE.** `aws sts get-caller-identity --profile <admin-profile>` returned exit 0, resolving a live IAM **admin** principal for a production account, backed by long-lived static keys in plaintext at `~/.aws/credentials` plus an SSO cache. The account number, principal ARN and profile name are deliberately **not** recorded here — this is a public repository and jointly they are precise targeting information (see `RB-07-03`). The operator knows which profile is meant and can re-run the command to check this claim. The blast radius the pre-authorisation assumed away is real and large. |
| (b) | `bin/bootstrap.sh --assert-hardening` exits 0 | **TRUE** — re-verified in this plan (see below). |
| (c) | Every spec exact-pinned | **TRUE** — re-verified in this plan (see below). |

Because ground (a) is falsified, the pre-authorisation does not carry.
Plan 07-10's own Task 2 text is explicit and binding: this checkpoint is
"NOT auto-approvable and must not be skipped on the strength of
`workflow.auto_advance` or the autonomous-run policy — the standing
pre-authorisations cover verification `human_needed` and `gaps_found`, not
a supply-chain gate." The autonomous-run policy's own Standing Operating
Policy (`STATE.md`) forbids asking the user anything until the milestone
completes and forbids waiting — so this plan did not ask and did not
block. It performed the review the gate exists for, recorded the
falsified ground, and took the plan's own documented fallback (below)
rather than installing.

**No install command of any kind — `pi install`, `npm install`,
`npm i`, `pi update`, or any command that fetches package contents and
makes them executable — was run anywhere in this plan.** `npm view` and
`npm pack` (download-only, no lifecycle scripts, no extraction beyond a
scratch temp directory outside this repo and outside `~/.pi`) and `gh api`
(read-only) were the only network commands used, per the sanctioned
technique already established in `07-01-SUMMARY.md` and `07-09-SUMMARY.md`.

### Hardening — before and after this plan's review commands

```
$ sh bin/bootstrap.sh --assert-hardening      # Task 1, BEFORE any review command
Hardening assertions (ignore-scripts):
  ignore-scripts=true  repo root (/c/Users/Admin/Documents/ky-pi-agent)
  ignore-scripts=true  project prefix (/c/Users/Admin/Documents/ky-pi-agent/.pi/npm)
  ignore-scripts=true  user-scope prefix (/c/Users/Admin/.pi/agent/npm)
All npm scopes are hardened.
exit=0
```
Run at `2026-08-14T21:45:41Z`.

```
$ sh bin/bootstrap.sh --assert-hardening      # Task 3, AFTER the review (no install occurred)
Hardening assertions (ignore-scripts):
  ignore-scripts=true  repo root (/c/Users/Admin/Documents/ky-pi-agent)
  ignore-scripts=true  project prefix (/c/Users/Admin/Documents/ky-pi-agent/.pi/npm)
  ignore-scripts=true  user-scope prefix (/c/Users/Admin/.pi/agent/npm)
All npm scopes are hardened.
exit=0
```
Run at `2026-08-14T21:48:15Z`. Both exit 0. `git status --porcelain` showed
no modification to `.npmrc` or `.pi/npm/.npmrc` at any point in this plan;
`.pi/npm/` on disk contains only the tracked `.npmrc` control file (no
`node_modules/`), and `.pi/git/` does not exist — both consistent with "no
install ran."

### Per-package legitimacy evidence (Task 2 review, all five pinned specs)

Read-only methods only: `npm view <pkg>@<version>` (registry metadata),
`npm pack <pkg>@<version>` + `tar -tf`/`tar -xf` into a scratch temp
directory outside this repo (download + list/extract, never install, never
execute), `gh api` (repository facts). The scratch directory was deleted
after inspection. Cross-checked against `07-01-SUMMARY.md`'s live-resolved
record (2026-08-14T19:09–19:14Z) for drift.

| Package | Pinned version | Resolved on registry? | License field | LICENSE file in tarball | Source shape | Repository | `pushed_at` (this session) | Archived | Do-not-install list? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| `pi-subagents` | `0.49.0` | Yes — `npm view pi-subagents version` (no arg) resolves to `0.49.0`, matching the pin exactly | MIT | Yes (`package/LICENSE`) | `.ts` source (192 `.ts` files under `src/`); zero `dist/*.js` | `nicobailon/pi-subagents`, 3,140★ | `2026-08-14T21:44:39Z` | false | No | **Would-install** (identity confirmed; blocked only by the gate outcome above, not by any legitimacy finding) |
| `pi-background-tasks` | `2.4.2` | Yes — latest resolves to `2.4.2` | ISC | Yes | `.ts` source (49 `.ts` files); zero `dist/*.js` | `ismailsaleekh/pi-background-tasks`, 9★ | `2026-08-13T23:58:10Z` | false | No | **Would-install** |
| `@narumitw/pi-lsp` | `0.49.4` | Yes — latest resolves to `0.49.4` | MIT | Yes | `.ts` source (10 `.ts` files); zero `dist/*.js` | `narumiruna/pi-extensions`, 328★ | `2026-08-14T16:17:22Z` | false | No | **Would-install** |
| `pi-web-access` | `0.22.0` | Yes — latest resolves to `0.22.0` | MIT | Yes | `.ts` source (56 `.ts` files); zero `dist/*.js` | `nicobailon/pi-web-access`, 1,095★ | `2026-08-14T21:42:50Z` | false | No | **Would-install** |
| `pi-session-finder` | `0.5.6` | Yes — latest resolves to `0.5.6` | MIT | Yes | `.ts` source (5 `.ts` files); zero `dist/*.js` | `pungggi/pi-session-finder`, 3★ | `2026-08-02T22:35:36Z` | false | No | **Would-install** |

**Drift check against `07-01-SUMMARY.md`:** all five versions are
UNCHANGED. Two `pushed_at` values moved since the 07-01 run — `pi-subagents`
(`2026-08-14T19:08:02Z` → `2026-08-14T21:44:39Z`) and `pi-web-access`
(`2026-08-12T19:44:51Z` → `2026-08-14T21:42:50Z`) — both are repository
activity, not version bumps (the pinned versions still resolve as latest
on the registry). This is the same "the endpoint keeps moving" finding
`docs/EXTENSIONS.md`'s "Download counts are not evidence" section already
names for `pushed_at` generally; recorded here rather than silently
treated as agreement with a stale snapshot.

**Do-not-install cross-check:** none of the five pinned specs matches any
entry on the standing do-not-install list (`pi-provider-qoder`,
`pi-qoder-provider`, `cc-safety-net`, `pi-sandbox`,
`@ramtinj95/pi-infra-command-guard`, `@howaboua/pi-codex-conversion`,
`@gotgenes/pi-subagents-worktrees`, `pi-defender`, `@ayulab/pi-rewind`,
`pi-rewind`, `pi-high-availability`, `pi-provider-fallback`,
`pi-model-fallback`, `pi-lens`, `@davideasden/pi-undo`).

**Pinning re-verification:** `npx vitest run tests/unit/pinning.test.ts`
(35 tests) re-run in this plan, exit 0 — includes the pre-existing
`"every third-party entry in .pi/settings.json packages[] carries a ref"`
assertion, which calls the file's own exported `isPinnedPackageSpec`
against the live `.pi/settings.json` content. No second pinning regex was
written; the exported function was imported and reused, per this plan's
own constraint.

**Model-facing tool call-site counts, observed this session (informal —
not the authoritative baseline).** `grep`-counted `.registerTool(` call
sites (allowing an optional TypeScript generic parameter) in each
extracted tarball, main-session entry points only where distinguishable
from a separate child-process entry point:

| Package | `.registerTool(` call sites found | Note |
|---|---|---|
| `@narumitw/pi-lsp` | 2 | `lspDiagnosticsTool`, `lspFixTool` at `src/pi-lsp.ts:146-147` — matches the existing "Installed packages" table row above |
| `pi-subagents` | 7 total call sites; 4 resolve into the main session (`index.ts:621`, `native-supervisor-channel.ts:311,328`, `wait-tool.ts:33`) | `fanout-child.ts:189` is a separate nested-process entry point, excluded — matches `07-12-SUMMARY.md`'s finding of exactly 4 |
| `pi-web-access` | 4, each gated by its own `*Enabled` flag (`index.ts:1635,2207,2301,2619`) | Conditional on config; up to 4 |
| `pi-background-tasks` | 10 total call sites across `extension.ts` (5), `delegate-extension.ts` (2), `fusion-extension.ts` (1 wrapper, invoked 4×), `delegate-child-extension.ts` (1, child-process entry point), `fusion-child-extension.ts` (1, child-process entry point) | Not fully deduplicated into a main-session tool count in this review — this repository's authoritative registry is `tests/unit/tool-count-baseline.test.ts` (plan 07-11), per the same "not restated here" discipline the "Installed packages" section above already states. Recorded here only as this session's raw observation, not as a substitute baseline. |
| `pi-session-finder` | 0 | Matches the existing table row ("zero model-facing tools") |

### Task 3: install reconciliation verdict — UNVERIFIED

Per plan 07-10's own documented fallback: *"if `pi install` cannot complete
on this machine for any reason ... record the exact command, the exact
failure output, and stop. Mark the reconciliation UNVERIFIED in Task 4's
section and state that plan 07-13 must append a second runbook entry
(`RB-07-02`) marked OUTSTANDING for it. Never write MATCH for a `pi list`
you did not observe."*

- **Exact command that would have been run:** not executed. No `pi install`
  invocation of any kind was made.
- **Reason no install was attempted:** the blocking supply-chain gate
  (Task 2) was **not satisfied** — ground (a) of the user's
  pre-authorisation ("this dev machine has no credentials") is **false**,
  as verified above. This is a gate failure, not a technical install
  failure (no PATH issue, no project-trust refusal, no network failure was
  encountered or would have been reached).
- **`pi list` output:** not captured. **No `MATCH` or `MISMATCH` verdict is
  written — the verdict is `UNVERIFIED`, honestly, because no `pi list` was
  ever run.**
- **Reconciliation verdict: `UNVERIFIED`.**
- **Runbook handoff:** plan 07-13 must append a second runbook entry,
  `RB-07-02`, marked **OUTSTANDING**, distinct from `RB-07-01` (the
  end-to-end subagent smoke ritual). `RB-07-02` covers: (1) running
  `pi install` for the five pinned specs with a human physically present to
  satisfy the package-legitimacy gate on a machine whose real credential
  exposure is known and accepted, and (2) capturing and reconciling `pi list`
  against `.pi/settings.json`'s `packages[]` for the first time.

### `tests/unit/extension-pins.test.ts` — Direction 4 remains unexercised

`npx vitest run tests/unit/extension-pins.test.ts` (52 tests) re-run in
this plan, exit 0. Its Direction 4 ("installed-but-undeclared") is
**CONDITIONAL** and, on this machine at this moment, resolves through the
"confirmed absent" branch: `.pi/npm/node_modules` does not exist (only the
tracked `.pi/npm/.npmrc` file is present) and `.pi/git/` does not exist, so
the test asserts absence rather than checking installed-package identity
against `packages[]`. **This direction has not been exercised against a
real installed tree by this plan or any prior plan in this phase** — that
remains true until `RB-07-02` runs. The test passing here proves the test's
"nothing on disk" branch works, not that the installed-but-undeclared check
itself has ever fired against real npm output.

### The honest limit of this section

`.pi/npm/` and `.pi/git/` are gitignored (`.gitignore:154-157`), and CI
never runs `pi install`. Even had this plan's gate been satisfied and an
install completed, any resulting reconciliation would have been a local
observation on one machine at one moment — the lockfile
(`.pi/settings.json` `packages[]`) and the tests that diff against it
(`tests/unit/extension-pins.test.ts`, `tests/unit/pinning.test.ts`) are
what travels in the repository. As it stands, this plan proves only the
legitimacy-review half: every pinned spec resolves to the version claimed,
carries a LICENSE file, ships reviewable `.ts` source, comes from a
non-archived repository matching the expected owner, and appears on no
do-not-install list. It proves **nothing** about what `pi install` actually
does on this machine, because that command was never run. `RB-07-02`
(OUTSTANDING, plan 07-13) is what will close that gap, alongside the
already-outstanding `RB-07-01` end-to-end smoke ritual.
