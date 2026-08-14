# Phase 7: Composed Extensions, Pinned & Reviewed - Context

**Gathered:** 2026-08-15
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Every commodity capability the harness needs comes from an exact-pinned, reviewed extension — so no effort is spent reimplementing features against an API that ships every 2–3 days.

**Requirements:** EXT-01, EXT-02, EXT-03, EXT-04, EXT-05, EXT-06, EXT-07, EXT-08, EXT-09, EXT-10

**Depends on:** Phase 1 (packaging, `.pi/settings.json`, the `ignore-scripts` hardening and `bin/bootstrap.sh --assert-hardening`, `isPinnedPackageSpec`), Phase 5 (`agentOverrides` wiring). In practice it also consumes Phase 2 (the wire dump the smoke ritual demands), Phase 3 (`providers/fallback.ts`) and Phase 4 (the blocked command the smoke ritual demands).

**Success criteria (from ROADMAP.md, binding — this is the spec):**

1. `pi list` matches a committed lockfile with every version pinned exactly, and **every pin was re-verified at planning time** rather than inherited from research — the ecosystem ships 13–16 releases/month.
2. Plan mode, todo tracking, background bash, LSP diagnostics, structured user questions, web lookup, session search and loop detection are all available in a session, with **Pi's own bundled examples preferred wherever they cover the need** and any extension lacking a license file **vendored** rather than depended on.
3. A subagent runs with its own model, system prompt, tool restriction and thinking level; it can run in the background without blocking the session and can be steered mid-run without being killed.
4. A parallel subagent in an isolated git worktree can **build**, not merely check out — untracked files like `.env` and `node_modules` do not travel to a new worktree.
5. File checkpointing restores the working tree, and a documented smoke-test ritual (one turn per provider, one subagent spawn, one blocked command, one wire dump) passes after a version bump.

**Contains [RUNBOOK] requirements: NONE** in the ROADMAP's verification split. Everything here is verifiable offline or with npm-registry / GitHub-API reads. **If a check genuinely needs the work laptop, append an `RB-07-xx` entry marked OUTSTANDING — never claim it.** `RB-01/02/03/04/05-xx` exist; **append, never renumber**. `tests/unit/docs-policy.test.ts` reads the status from *two* places (the summary-table row and the `**Status:**` line under `### RB-07-xx — …`) and reports `INCONSISTENT` — never an acceptable status — if they disagree. Note the realistic candidates: criterion 5's smoke ritual is *documented* here and *run* on a credentialed machine; criterion 4's worktree build is provable offline in a temp repo and should be, not deferred.

</domain>

<decisions>
## Implementation Decisions

Recorded in PROJECT.md (Key Decisions, Constraints), ROADMAP.md, CONTRIBUTING.md and `.planning/research/{ARCHITECTURE,PITFALLS,STACK,SUMMARY}.md`. Binding on this phase; not to be re-derived and not to be re-litigated.

**Already decided, binding:**

1. **Assert the hardening BEFORE any install.** `pi install` runs npm lifecycle scripts. Phase 1 built the `ignore-scripts` hardening and `bin/bootstrap.sh --assert-hardening` (needs no network). **Do not install anything into a machine you have not first proven is hardened** — the assertion is a precondition step in the plan, not a closing check.

2. **NEVER write a bare `npm:pkg` or an unrefed git URL into settings.** Versioned specs are pinned and skipped by `pi update`; unrefed ones drift. Phase 1 **exported `isPinnedPackageSpec` from `tests/unit/pinning.test.ts` specifically for this phase to import** — `/^npm:.+@[0-9]/ || /^(git:|https?:\/\/|ssh:\/\/|git:\/\/).+@.+$/`. **Import it. A second regex is how the two drift apart.** The one documented exemption is our own repo URL (`isOwnRepo`), and it is not extended to anybody else.

3. **DO NOT INSTALL, under any framing:** `pi-provider-qoder` / `pi-qoder-provider` (WAF bypass + COSY signature forging; breach Qoder ToS §3.2.6/§3.2.9/§3.2.10); `cc-safety-net` (prebuilt `dist/pi/index.js`, not source-reviewable); `pi-sandbox` (macOS/Linux only, no Windows path); `@ramtinj95/pi-infra-command-guard` (drags in `openai` + `web-tree-sitter`; read-only reference, already consumed in Phase 4); `@gotgenes/pi-subagents-worktrees` (peer-depends on a *third* subagents package and silently no-ops otherwise); `pi-defender` (declares `pi-tui` as a **dependency** not a peer → installs a second, stale `pi-tui`); `@ayulab/pi-rewind` (archived repo, GPL-3.0, belongs to the Oh My Pi fork); `pi-rewind@0.5.0`; `pi-high-availability`; `pi-provider-fallback`.

4. **Anything without a LICENSE file is VENDORED, not depended on (EXT-10).** Vendor into `extensions/vendor/` (or the repo-consistent equivalent under `.pi/`) and reference by local path — a local path in settings is added **without copying** and is untouched by `pi update`. **Re-verified 2026-08-15: `sebaxzero/pi-loop-police` still reports `license=NONE` on the GitHub API despite `"MIT"` in `package.json` → the vendoring requirement stands.** The same defect was found on `nicobailon/pi-rewind-hook` (`license=NONE`), and `@davideasden/pi-undo@0.2.11` has **no `license` field in its `package.json` at all**.

5. **`@earendil-works/*` and `typebox` stay `peerDependencies: "*"` and are never bundled** — a second module instance breaks type/instance identity across the boundary. Note as a review item, not a blocker: `pi-subagents` declares `typebox` and `jiti` as its own *dependencies*; Pi loads packages with separate module roots, so record what actually happens rather than asserting either way.

6. **Every extension registering a tool costs per-turn schema tokens on EVERY request** (~1,850 tok/turn measured floor, Phase 2). **Record each installed extension's model-facing tool count and names now, as a committed baseline Phase 10 can measure against.** Prefer few model-facing tools — this is why `@narumitw/pi-lsp` (2 tools, 13 files, 78 KB) beat `pi-lens` (18.6 MB, 1,294 files). Phase 10 does the cutting; Phase 7 does the counting.

7. **`pi-background-tasks` also ships "read-only delegated agents" that DUPLICATE the subagents package — filter those resources out, and VERIFY THE REAL FILE PATHS before shipping the filter.** The exclusion globs in `.planning/research/STACK.md` were **never verified against the tarball**. A glob that matches nothing is a filter that silently does nothing.

8. **`.pi/agents/*.md` must carry NO `model:` key**, so Phase 5's settings-layer `agentOverrides` wins. Verified at source: Pi's bundled `examples/extensions/subagent/agents.ts:59-70` parses frontmatter into `{name, description, tools, model, systemPrompt}` and **does** honour `model:`; all four sample agents (`agents/scout.md` etc.) carry `model: claude-haiku-4-5`/`claude-sonnet-*`. **The samples must not be copied verbatim.** Note also `agents.ts:107-113`: project agents under `.pi/agents/` are loaded **only** when `agentScope` is `"project"` or `"both"` — the default is user-level only, so repo-local agents need that setting explicitly.

9. **Be suspicious of green.** Phase 4's review needed six iterations and 11 blockers; Phase 5's found the suite writing into the developer's real `~/.pi/agent/settings.json`. Every test written here must be shown to FAIL if its subject is removed, and **no test may write outside the repo or a temp dir** — that applies with particular force to a phase whose subject is *installing things*.

**Claude's discretion (guided by ROADMAP criteria + `.planning/research/`):**
Where the lockfile lives and its exact format (a committed JSON beside `.pi/settings.json`, or `.pi/settings.json`'s own `packages[]` treated as the lockfile) provided `pi list` can be diffed against it; whether the tool-count baseline is a committed data file or lives in a test; the vendor directory's exact path; how the smoke ritual is documented (`docs/RUNBOOK.md` vs a new `docs/SMOKE.md`) and whether it is scripted; how much of Pi's bundled `git-checkpoint.ts` is adopted verbatim versus hardened; the exact shape of the worktree build proof.

**Decisions taken autonomously during context generation** (per the Standing Operating Policy — the user is asleep; noted here rather than asked):

- Phase slug is `07-composed-extensions-pinned-reviewed`, following Phases 3–6's convention of dropping `&` and punctuation.
- **Pi itself stays pinned at `0.84.1`.** npm now serves `0.84.2`, but the `@earendil-works/*` family is version-locked and `devDependencies` pin `0.84.1`; a runtime bump is a separate, testable action, not a side effect of an extensions phase. Recorded as a follow-up, not done here.
- **Download counts are treated as UNVERIFIED.** The npm `downloads/point/last-month` endpoint returned figures **byte-identical to STACK.md's 2026-08-13 numbers for all 14 packages** — implausible for a rolling 30-day window, so the endpoint is CDN-cached. Freshness judgements in this phase rest on npm `time.modified` and GitHub `pushed_at`, both of which did move. Do not re-cite download counts as evidence.
- **`pi-model-fallback` is DROPPED, not installed** — see the low-confidence verdicts below.
- **File checkpointing is Pi's own bundled `git-checkpoint.ts`, hardened** — see the low-confidence verdicts below.

</decisions>

<code_context>
## Existing Code Insights

Phases 1–6 built the machine this phase installs onto. 1,440 tests green, `tsc --noEmit` clean. **Read the real signatures and the real files before planning against them.**

**Phase 1 — packaging and supply chain (the precondition).**
- `package.json` `pi` manifest points at `./.pi/extensions`, `./.pi/skills`, `./.pi/prompts`, `./.pi/themes`. `dependencies: { unbash: "4.0.10" }`. `peerDependencies` are the five `"*"` entries. `devDependencies` pin `@earendil-works/pi-{ai,coding-agent}@0.84.1`, `typebox@1.3.7`, `typescript@5.9.3`, `vitest@4.1.9`, `@types/node@24.12.4`.
- **`.pi/settings.json` is currently `{}`** — there is no `packages[]` yet. This phase creates it. `tests/unit/pinning.test.ts` already asserts *"every third-party entry in `.pi/settings.json` `packages[]` carries a ref"*; that assertion currently passes vacuously and becomes load-bearing the moment this phase writes the first entry.
- `bin/bootstrap.sh` supports `--assert-hardening` (the three `ignore-scripts` assertions, no network, no install) and `--check-only`. `.npmrc` and `.pi/npm/.npmrc` are the hardened scopes.
- Existing pinning tests to extend rather than duplicate: `pinning.test.ts`, `ci-pinning.test.ts`, `npmrc-policy.test.ts`, `manifest.test.ts`, `version-gate.test.ts`, `template-tracked.test.ts`, `extension-layout.test.ts`.

**`.pi/` today (all tracked):** `extensions/{diagnostics,harness,providers,qoder,routing,safety,workflows}`, `lib/jsonl.ts`, `npm/.npmrc`, `settings.json`, `templates/`, and **empty `agents/`, `prompts/`, `skills/`, `themes/` (each just a `.gitkeep`)**. `.pi/agents/` is the directory this phase fills.

**Phase 5 — `.pi/extensions/routing/agent-overrides.ts`** is the settings layer that must win over agent-file frontmatter (decision 8). Read it before writing any `.pi/agents/*.md`.

**Phase 2/3/4 — what the smoke ritual (criterion 5) exercises:** one wire dump comes from `diagnostics/wire.ts` + `.pi/logs/` (gitignored); one blocked command from `safety/shell.ts` `canonicalise()` / `safety/git.ts` `classifyGitInvocation()`; one turn per provider from `providers/fallback.ts` `callWithFallback` over the `dashscope` provider in `.pi/templates/models-template.json`. `docs/RUNBOOK.md` already documents the credentialed procedures (`RB-02-01` is literally "one real turn per provider produces a wire dump") — **the smoke ritual should compose the existing entries, not re-describe them.**

**Pi 0.84.1 is installed at `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\` and ships 80 `examples/extensions/`.** These are the EXT-06 candidates, verified by reading them:

- **`examples/extensions/git-checkpoint.ts` — 53 lines** (not ~100 as research estimated). Read it; it is the EXT-07 base and **as shipped it does not satisfy EXT-07**. Three concrete defects the plan must address, all cited:
  - `git-checkpoint.ts:33-36` — `if (!ctx.hasUI) { return; }` before any restore. **It does nothing headless**, which is precisely the Phase 4 review finding ("a guard that was entirely absent headless") repeating in a new place.
  - `git-checkpoint.ts:22` — `pi.exec("git", ["stash", "create"])` with **no `-u`**, so untracked files are never captured. EXT-02's `.env`/`node_modules` concern and EXT-07's "restores the working tree" both land here.
  - `git-checkpoint.ts:11,29,49-51` — checkpoints are an in-memory `Map`, restore is offered **only** on `session_before_fork`, and `agent_end` clears them. Nothing survives `/reload` or a restart.
- **`examples/extensions/plan-mode/` — 390 lines `index.ts` + 168 lines `utils.ts` = 558 lines** (research cited only the 390). Written by the Pi author, guaranteed API-current, fully readable — the ROADMAP's own "Alternatives Considered" calls vendoring it a *strong* option given the safety posture. Weigh it against `@narumitw/pi-plan-mode@0.49.3`, which pulls `@narumitw/pi-tui-kit@^0.49.1` (a **floating caret range** in a dependency — relevant to criterion 1).
- **`examples/extensions/subagent/` — 1,015 lines `index.ts` + 126 lines `agents.ts`**, plus `agents/{scout,planner,reviewer,worker}.md` and `prompts/{implement,scout-and-plan,implement-and-review}.md`. Its `README.md` documents isolated context, parallel (max 8, 4 concurrent), streaming, abort — but **no worktree isolation, no non-blocking background, no mid-run steering, and no thinking-level frontmatter key** (`agents.ts` parses only `name`, `description`, `tools`, `model`). **EXT-01 is partly covered; EXT-02, EXT-03 and EXT-04 are not.** That gap is the justification for `pi-subagents` — and it should be stated that way in the plan, because EXT-06 requires preferring the bundled example *wherever it covers the need*, not everywhere.
- Also present and worth checking against EXT-05 before installing a third-party equivalent: `todo.ts` (297 lines), `question.ts`, `questionnaire.ts`, `qna.ts`, `inline-bash.ts`, `bash-spawn-hook.ts`, `dynamic-tools.ts`, `permission-gate.ts`, `protected-paths.ts`, `dirty-repo-guard.ts`, `auto-commit-on-exit.ts`, `provider-payload.ts`, `status-line.ts`, `custom-header.ts`, `custom-footer.ts`.
- Useful exports confirmed in use by the bundled example: `CONFIG_DIR_NAME`, `getAgentDir()`, `parseFrontmatter()` from `@earendil-works/pi-coding-agent`.

**Original TypeScript for anything in `dist/` is recoverable from `dist/**/*.js.map` `sourcesContent`.** Cite `file:line`; mark anything unverifiable as **UNVERIFIED** rather than asserting it.

**Test helpers already available — reuse, do not rewrite:** `tests/helpers/{faux.ts, session.ts, models.ts, pi.ts, logs.ts, git.ts, stub-bin.ts, win-quote.ts, loopback.ts, qoder-loopback.ts, bootstrap-repo.ts}`. For this phase the load-bearing ones are **`git.ts`** (temp repo — the only honest way to prove criterion 4's worktree build), **`bootstrap-repo.ts`**, and **`pi.ts`**.

**CI — `.github/workflows/ci.yml`**: `posix-lint` (ubuntu, ShellCheck + pin-audit) and `test` on `windows-latest`/`macos-latest` running `npm ci --ignore-scripts`, `npx vitest run`, `sh -n bin/bootstrap.sh`, `sh bin/bootstrap.sh --check-only`, `scripts/check-gh-unauthenticated.sh --warn-only`, `npx tsc --noEmit`. **A failing vitest test is already a failing build on both platforms** — that is where the lockfile/pin assertions belong. Do not invent a second CI mechanism.

</code_context>

<specifics>
## Specific Ideas

### The re-verified pin table (2026-08-15) — this is EXT-08's evidence, and it must be re-run at execution time, not copied from here

Verified against the live npm registry (`npm view <pkg> version license repository.url dist.fileCount dist.unpackedSize dependencies peerDependencies time`) and the GitHub REST API (`gh api repos/<owner>/<repo>` → `stargazers_count`, `pushed_at`, `archived`, `license.spdx_id`).

| Package | STACK.md (2026-08-13) | Re-verified (2026-08-15) | Change |
|---|---|---|---|
| `@earendil-works/pi-coding-agent` | 0.84.1 | **0.84.2** latest; 0.84.1 installed & pinned | +1 patch — **not bumped here** |
| `pi-subagents` | 0.47.1, 216 files, 3.4 MB, 3,110★ | **0.49.0**, 223 files, 3.61 MB, 3,138★, pushed 2026-08-14 | **+2 minor** |
| `@juicesharp/rpiv-todo` | 2.4.0 | **2.5.2**, published 2026-08-14 | **+1 minor** |
| `@juicesharp/rpiv-ask-user-question` | 2.4.0 | **2.5.2**, published 2026-08-14 | **+1 minor** |
| `pi-background-tasks` | 2.3.0 | **2.4.2**, published 2026-08-14, ISC | **+1 minor** |
| `@narumitw/pi-plan-mode` | 0.49.3 | 0.49.3, published 2026-08-05 | none |
| `@narumitw/pi-lsp` | 0.49.4 | 0.49.4, 13 files, 78 KB | none |
| `pi-loop-police` | 1.14.1, **no LICENSE** | 1.14.1, repo still **`license=NONE`** | none — **vendoring stands** |
| `pi-web-access` | 0.22.0, 1,070★ | 0.22.0, 1,093★ | none |
| `pi-session-finder` | 0.5.6 | 0.5.6, peer `pi-tui >=0.83.0` | none |
| `awesome-pi-themes` | 1.1.9 | 1.1.9 | none |
| `pi-model-fallback` | 0.3.6 | 0.3.6, 1★ | none — **dropped, see below** |
| `@davideasden/pi-undo` | 0.2.11 | 0.2.11, **no `license` field in package.json**, 0★ | **new defect** |

**Four of thirteen pins moved in two days.** That is the phase's own thesis demonstrated, and it is why the plan must re-run this table at execution time rather than trust the numbers above.

Watch items surfaced by the re-verification, for the plan to resolve rather than inherit:
- `@juicesharp/rpiv-{todo,ask-user-question}@2.5.2` depend on `@juicesharp/rpiv-config@^2.5.2` (**caret**) and peer-depend on `@juicesharp/rpiv-i18n@"*"`. The i18n resolution under Pi's `npm install --omit=dev` is a **known-unverified** item carried from research — settle it by inspection, or carry it forward honestly as `RB-07-xx`.
- `pi-background-tasks@2.4.2` peer-depends on `@earendil-works/pi-coding-agent@^0.81.1 || ^0.82.1 || ^0.83.0 || ^0.84.0` — satisfied by 0.84.1, and a real constraint on any future Pi bump.
- `pi-subagents@0.49.0` declares `typebox@1.1.38` and `jiti@2.7.0` as **dependencies** (Pi bundles `typebox@1.3.7`). Record the observed behaviour under Pi's separate module roots; do not assert it either way.

### Verdict on the two explicitly LOW-CONFIDENCE categories

**File checkpointing → adopt Pi's bundled `git-checkpoint.ts` and harden it. The third-party field is still weak; it got weaker.**
- `@davideasden/pi-undo@0.2.11` (the tentative pick, chosen on freshness alone): unchanged since 2026-08-05, repo at **0★**, and **no `license` field in `package.json`**. Under EXT-10 it must be vendored anyway — and if the choice is between vendoring 28 third-party files and vendoring 53 lines written by the Pi author, it is not a close call.
- `@pi-plugins/checkpoint@0.1.2` (the architecturally correct design — restores files on `/tree` navigation): still 0.1.2, unchanged since 2026-08-05, and it depends on **`effect@4.0.0-beta.103` and `@effect/platform-node@4.0.0-beta.103`** — a *beta* of a large functional-programming runtime, in the tool path, on a machine holding live AWS SSO credentials. Disqualified by the security posture, not by maturity.
- `pi-rewind-hook@1.8.5`: repo now 161★ but **`license=NONE`** on the GitHub API — the same defect as `pi-loop-police` — and stale since 2026-07-28.
- `pi-rewind@0.5.0` (2026-03-31) and `@ayulab/pi-rewind` (archived, GPL-3.0) are already on the do-not-install list.
- **So: EXT-07's own escape hatch is the right answer.** But adopting it verbatim fails the criterion — see the three cited defects in `<code_context>`. The plan must harden the headless path, capture untracked files, and make restore reachable outside `session_before_fork`, then **prove the working tree is actually restored in a temp git repo**, not assert it.

**Provider fallback → DROP `pi-model-fallback@0.3.6`. Do not install it.**
- Phase 3 shipped `.pi/extensions/providers/fallback.ts` (`callWithFallback`, `classifyFailure`) and Phase 5 shipped routing with a fallback chain (`usesFallbackChain`). The authored router covers the need — which STACK.md itself predicted ("Probably the right end state").
- The package is unchanged since 2026-08-03, 1★, and was only ever chosen for being small enough to read end to end.
- **The decisive argument is not adoption, it is architecture:** installing it puts a *second, uncoordinated* fallback mechanism in the model-call path — one that `tests/unit/chokepoint-lint.test.ts` does not see and the Phase 2 wire inspector does not record. Two fallback controllers disagreeing is worse than either alone.
- No requirement in EXT-01..EXT-10 asks for provider fallback. **Record the drop and its rationale as a phase artifact** so the decision is not silently re-opened in Phase 8.

### The traps this phase most plausibly falls into

- **Copying a version out of STACK.md.** Four pins moved in 48 hours. The re-verification is the deliverable, not the paperwork around it.
- **A lockfile that nothing compares against.** Criterion 1 says *"`pi list` matches a committed lockfile"*. A committed list that no test diffs is decoration. The comparison must fail the build when it drifts — and, like the workflow-budget registry in Phase 6, it must also fail when an installed package is **absent** from the lockfile, not only when a listed one mismatches.
- **Asserting the worktree instead of proving it.** Criterion 4 is explicit that checkout is not enough: the worktree must **build**. `git worktree add` copies **no untracked files** — `.env` and `node_modules` stay behind by design, which is exactly why a fresh worktree fails to build. The proof needs a real temp repo (`tests/helpers/git.ts`), a real `git worktree add`, and a real build step in it. Windows long-path and symlink friction is a live risk here, not a theoretical one; if it genuinely cannot be proven on this machine, that is an `RB-07-xx`, not a claim.
- **Shipping an exclusion glob that matches nothing.** Decision 7. Unpack the `pi-background-tasks` tarball, read the real paths, then write the filter — and add a test that the filter still matches something, or the next version bump silently un-filters the duplicate agents.
- **Letting a sample agent's `model:` key through.** Decision 8. Pi's own samples all carry one; copying them defeats Phase 5.
- **Installing before asserting hardening.** Decision 1. The order is the control.
- **Re-enabling UI gates.** `workflow.ui_phase` and `ui_safety_gate` are `false` deliberately. This phase has no UI surface; the themes package is reference material for Phase 11.

</specifics>

<deferred>
## Deferred Ideas

- Measuring and **cutting** the per-turn token cost of these extensions, `pi.setActiveTools()` progressive disclosure, dynamic tool loading, the `AGENTS.md` budget (CTX-01..06) — **Phase 10**. Phase 7 only records the baseline tool counts Phase 10 will measure against.
- The reviewer subagent's *behaviour* — non-rubber-stamping, seeded-defect calibration (GATE-08), advisor escalation via `contact_supervisor` (GATE-09), per-role thinking budgets (GATE-10), deterministic anti-pattern rules (QUAL-01/02) — **Phase 8**. Phase 7 makes a subagent *possible*; Phase 8 makes it *good*.
- The ceremonial workflows `/grill`, `/plan`, `/execute`, `/review` — **Phase 9**. They consume these extensions; they are not built here.
- Statusline, header, subagent activity widget, the authored theme (UI-01..05) — **Phase 11**. `awesome-pi-themes` is installed/kept as *reference material* only.
- Bumping Pi from 0.84.1 to 0.84.2 (and the version-locked `@earendil-works/*` family with it) — a separate, testable action with its own smoke-ritual run. This phase pins the ritual that would validate such a bump; it does not perform one.
- Any live-credential execution of the smoke ritual. Phase 7 **documents** it and proves what it can offline; the credentialed run belongs to the work laptop and, if it cannot be closed here, to an `RB-07-xx` entry marked OUTSTANDING.

</deferred>
