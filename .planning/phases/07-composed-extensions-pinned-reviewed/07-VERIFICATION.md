---
phase: 07-composed-extensions-pinned-reviewed
verified: 2026-08-15T07:10:00Z
status: human_needed
score: 4/5 success criteria fully MET, 1/5 MET-mechanism-only; 6/10 EXT requirements Complete, 4/10 Partial (all four blocked on the same two OUTSTANDING runbook entries)
overrides_applied: 0
re_verification: null
human_verification:
  - test: "RB-07-02 — install the five pinned specs (`pi-subagents@0.49.0`, `pi-background-tasks@2.4.2`, `@narumitw/pi-lsp@0.49.4`, `pi-web-access@0.22.0`, `pi-session-finder@0.5.6`) on the work laptop with a human physically present for the package-legitimacy gate, then reconcile `pi list` against `.pi/settings.json`"
    expected: "`pi list` shows all five specs at their pinned versions and nothing else project-scoped; `sh bin/bootstrap.sh --assert-hardening` still exits 0 afterward"
    why_human: "Plan 07-10's blocking supply-chain gate was correctly refused on this machine because its own pre-authorisation ground (a) — 'this dev machine has no credentials' — is independently reconfirmed FALSE in this verification pass (`aws sts get-caller-identity --profile <admin-profile>` returns live IAM admin credentials for a production account (account id redacted), exit 0). A falsified ground voids auto-approval and the gate requires a human physically present on a machine whose credential exposure is known and accepted."
  - test: "RB-07-01 — the composed smoke ritual: one turn per provider, one subagent spawn, one blocked command, one wire dump (run only after RB-07-02)"
    expected: "Each of the four legs produces the specific, falsifiable evidence RB-07-01 names (see docs/RUNBOOK.md) — not \"it seemed fine\""
    why_human: "No package has ever been installed on this machine and no subagent has ever spawned; this is a live, credentialed, interactive end-to-end sequence that no offline fixture can substitute for."
---

# Phase 7: Composed Extensions, Pinned & Reviewed — Verification Report

**Phase Goal:** Every commodity capability the harness needs is available from an exact-pinned, reviewed extension, so no effort is spent reimplementing features against an API that ships every 2–3 days.
**Verified:** 2026-08-15
**Status:** human_needed
**Re-verification:** No — initial verification

## Summary Up Front

This phase's own SUMMARY.md and STATE.md entries are unusually honest about what is and is not done, and this verification independently reconfirmed the load-bearing claims rather than trusting them:

- **`npx vitest run` → 92 files, 1606 tests, all passing. `npx tsc --noEmit` → clean.** Verified by running both myself in this pass.
- **`aws sts get-caller-identity --profile <admin-profile>` → exit 0, live IAM admin credentials for a production account (account id redacted).** Verified by running it myself. This independently confirms the phase's own finding that plan 07-10's install-gate pre-authorisation ground (a) — "this dev machine has no credentials" — is FALSE, which is why the blocking `pi install` never ran and why `RB-07-02` exists.
- **`.pi/npm/` contains only the tracked `.npmrc` (no `node_modules`); `.pi/git/` does not exist.** Verified by directory listing. No package has ever been installed.
- **`.pi/agents/planner.md` carries no `model:` or `fallbackModels:` key.** Verified by reading the file and grepping for `^model:` (no match).
- **The worktree-build proof is real, not a stub.** `tests/integration/worktree-build.test.ts` drives a real `git worktree add`, asserts the fresh worktree's build genuinely fails first (`Cannot find module 'dep'`), then runs the real shipped `.pi/scripts/worktree-setup-hook.mjs` and asserts the same build succeeds afterward. A recorded falsification (reverting the hook's `"junction"` argument) turned both this test and its regression guard red, confirming the test is not vacuous.
- **EXT-10 vendor/depend mutual exclusion is enforced, not just claimed.** `tests/unit/vendor-license-audit.test.ts` checks, in both directions, that every directory carrying a tracked `PROVENANCE.md` has a `MUST_BE_VENDORED` row and vice versa, and that the vendored package name never also appears in `.pi/settings.json`'s `packages[]`. `.pi/extensions/loop-police/PROVENANCE.md` records the package name, exact version (`1.14.1`), and a SHA-256 tarball hash — satisfying "carries provenance and license records."
- **The tool-count baseline (07-11) genuinely distinguishes live/vendored tools from declared-but-uninstalled npm tools**, not blended. `tests/unit/tool-count-baseline.test.ts`'s `"vendored"` rows are mechanically re-derived from tracked source every run (grep-checked against `.pi/extensions/*`); its `"npm"` rows are explicitly documented and coded as "recorded, not re-derived — go stale silently the moment the pin moves without a re-read," and Direction 2 for npm rows asserts only pin-presence, never tool identity against a live install.

None of this is a case of green-through-fabrication (the Phase 6 failure mode this project has documented in its own history). Every substantive claim I checked — test counts, credential state, file contents, provenance records — matched what the phase's own artifacts say, including the artifacts' own admissions of what is NOT yet true.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | `pi list` matches a committed lockfile with every version pinned exactly, and every pin was re-verified at planning time rather than inherited from research | **PARTIAL** | The lockfile (`.pi/settings.json` `packages[]`, 5 entries) is committed and every entry is exact-pinned — `tests/unit/pinning.test.ts` and `tests/unit/extension-pins.test.ts` pass (confirmed in the full 1606-test green run). Every pin was independently re-verified at planning time with live `npm view`/`npm pack`/`gh api` calls, recorded with timestamps in `docs/EXTENSIONS.md`. **But the literal clause "`pi list` matches" cannot be true: `pi list` has never been run on this machine, because `pi install` has never been run** (`.pi/npm/` holds only the tracked `.npmrc`, no `node_modules`; `.pi/git/` does not exist — verified directly). `tests/unit/extension-pins.test.ts`'s own Direction 4 ("installed-but-undeclared") resolves through its "confirmed absent" branch, not its real comparison branch, so even the offline proxy has never exercised the comparison this criterion names. Outstanding as `RB-07-02` — a [RUNBOOK] item, not an unbuilt gap. |
| 2 | Plan mode, todo tracking, background bash, LSP diagnostics, structured user questions, web lookup, session search and loop detection are all available in a session | **PARTIAL** | 4 of 8 are live in this repository's own `.pi/extensions/` right now and mechanically bound to tracked source (`plan-mode/`, `todo.ts`, `questionnaire.ts`, `loop-police/`), verified by `tests/unit/extension-composition.test.ts` passing and by directory listing. **The other 4 (background bash, LSP diagnostics, web lookup, session search) are pinned npm specs that have never ridden on a real request or been available in any actual session on this machine**, because no install has run. Outstanding as `RB-07-02`. |
| 3 | A subagent runs with its own model, system prompt, tool restriction and thinking level; it can run in the background without blocking the session and can be steered mid-run without being killed | **NOT LIVE-VERIFIED (structural evidence only)** | `.pi/agents/planner.md` is real, tracked, carries a `tools:`/`thinking:`/`systemPromptMode:` frontmatter and — critically — no `model:` key (verified: grepped, no match), so Phase 5's `agentOverrides` routing is not silently defeated. `docs/EXTENSIONS.md`'s Subagent capability evidence table cites ten `file:line` locations in the real, unpacked pinned `pi-subagents@0.49.0` tarball backing each of these four claims, and `tests/unit/subagent-capabilities.test.ts` binds those citations to the live pin. **No subagent has ever actually spawned, run in the background, or been steered on this machine** — the package was never installed. Every row of the evidence table itself states this in its own "What this does NOT prove" column. Outstanding as `RB-07-01` (which itself presupposes `RB-07-02`). |
| 4 | A parallel subagent in an isolated git worktree can **build**, not merely check out — untracked files like `.env` and `node_modules` do not travel to a new worktree | **MET (mechanism), with one honest caveat** | `tests/integration/worktree-build.test.ts` is a real, falsified proof: a fresh `git worktree add` genuinely fails to build (`Cannot find module 'dep'`, matched on the literal stderr text, not just a non-zero exit code) because `node_modules`/`.env` are genuinely untracked and absent from the worktree; the real shipped `.pi/scripts/worktree-setup-hook.mjs` is then spawned with a real payload on stdin and, in the **same** worktree, the build then succeeds. A recorded falsification (removing the hook's `"junction"` argument, reproducing `pi-subagents`' own known defect) turned both this test and a source-level regression guard red, then was reverted — proving the test is not vacuous. **Caveat, stated by the phase's own artifacts and confirmed here:** this proves the hook mechanism builds a worktree correctly. It does **not** prove a real `pi-subagents` spawn actually invokes this hook — that live binding is part of `RB-07-01`'s leg 2, still OUTSTANDING. The mechanism criterion 4 asks for is genuinely proven; the live end-to-end wiring is not. |
| 5 | File checkpointing restores the working tree, and a documented smoke-test ritual (one turn per provider, one subagent spawn, one blocked command, one wire dump) passes after a version bump | **PARTIAL** | Checkpointing half **MET**: `.pi/extensions/checkpoint/` (vendored, hardened `git-checkpoint.ts`) is proven by `tests/integration/git-checkpoint.test.ts` against real temporary git repositories — headless restore, untracked-file capture via `GIT_INDEX_FILE`+`write-tree`+`commit-tree` (replacing `git stash create -u`, measured on this machine's git to silently drop untracked files), and persistence across a restart via `.pi/state/`. Ritual half **NOT MET as "passes"**: the ritual is fully documented (`RB-07-01`) with four specific, falsifiable legs, but it has never actually been run — three of its four legs need the work laptop and a real installed extension tree. Outstanding as `RB-07-01`. |

**Score:** 1/5 criteria fully and unconditionally MET (criterion 4's mechanism, with the honest caveat noted); 4/5 are PARTIAL, and in every one of those four cases the missing half is the same underlying fact — no install has ever run on this machine — rather than four independent gaps.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.pi/settings.json` `packages[]` | Committed lockfile, 5 exact-pinned npm specs | ✓ VERIFIED | Read directly — all 5 entries pinned to exact versions (`@0.49.0`, `@2.4.2`, `@0.49.4`, `@0.22.0`, `@0.5.6`), no ranges. |
| `.pi/agents/planner.md` | Subagent frontmatter with no `model:`/`fallbackModels:` key | ✓ VERIFIED | Read directly; grep for `^model:` returns no match. |
| `.pi/extensions/{plan-mode,todo.ts,questionnaire.ts,loop-police,checkpoint}` | Vendored, live, tracked | ✓ VERIFIED | Directory listing confirms all five exist with source files; `tests/unit/tool-count-baseline.test.ts` Direction 1 mechanically re-derives their tool names from tracked source every run. |
| `.pi/extensions/loop-police/PROVENANCE.md` | Package name, version, integrity hash | ✓ VERIFIED | Read directly — names `pi-loop-police`, version `1.14.1`, SHA-256 tarball hash, license findings, tarball listing. |
| `docs/EXTENSIONS.md` | Provenance record for all 5 installed + 5 vendored items | ✓ VERIFIED | Read in full — installed-packages table, vendored table, dropped table, pin residuals, worktree-isolation section, subagent capability evidence table, install-reconciliation section all present and internally consistent with `.pi/settings.json` and the test suite. |
| `docs/RUNBOOK.md` Phase 7 section | RB-07-01, RB-07-02 with exact commands and expected output | ✓ VERIFIED | Read in full — both entries carry exact commands, specific expected output, named offline proxies, and `**Status:** OUTSTANDING`. |
| `tests/integration/worktree-build.test.ts` | Real negative-then-remedy worktree build proof | ✓ VERIFIED (wired, not hollow) | Read the test and its SUMMARY's recorded falsification; ran the full suite myself (green). |
| `tests/unit/tool-count-baseline.test.ts` | Live/vendored vs. declared-but-uninstalled distinguished, not blended | ✓ VERIFIED | Read the file — vendored rows mechanically checked against tracked source (Direction 1); npm rows explicitly coded and documented as "recorded, not re-derived, pin presence only" (Direction 2). The two `kind`s never share an assertion. |
| `tests/unit/vendor-license-audit.test.ts` | EXT-10 vendor/depend mutual exclusion, bidirectional | ✓ VERIFIED | Read the file — Direction 2 asserts the vendored package name is absent from `packages[]`; Direction 4 asserts every tracked `PROVENANCE.md` has a registry row. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `tests/unit/docs-policy.test.ts` | `docs/RUNBOOK.md` Phase 7 entries | Parses both the summary table and the `**Status:**` line, fails on disagreement | ✓ WIRED | Grepped `PHASE_SEVEN_IDS` in the test file: `["RB-07-01", "RB-07-02"]`, included in the guarded `ALL_IDS` array, with a fixture proving a half-flipped status reports `INCONSISTENT` rather than silently passing. |
| Worktree setup hook | Real `pi-subagents` spawn | `.pi/settings.json`'s subagent config, wired by `bin/bootstrap.sh`'s `merge_subagent_config()` (plan 07-09) | ⚠️ NOT LIVE-VERIFIED | The wiring is source-level real (bootstrap merges the hook path into `pi-subagents`' dedicated global config file), but no real `pi-subagents` spawn has ever exercised it — this is exactly `RB-07-01` leg 2, OUTSTANDING. |
| `agentOverrides` (Phase 5) | `.pi/agents/planner.md`'s resolved model | No `model:` key in frontmatter, so `agentOverrides` is not defeated | ✓ WIRED (structurally, cited against real source) | `docs/EXTENSIONS.md` cites `pi-subagents@0.49.0 src/agents/agents.ts:1155`: `agentOverrides.model` only fills in a model when the agent's own frontmatter declares none. Never exercised live — `RB-07-01` leg 2(a) is the live check. |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| EXT-01 | Subagents support per-agent model/prompt/tools/thinking | **Partial** — structural proof complete, no live spawn | `.pi/agents/planner.md` (no `model:` key) + 10 `file:line` citations in `docs/EXTENSIONS.md`, bound by `tests/unit/subagent-capabilities.test.ts`. Live check `RB-07-01` OUTSTANDING. |
| EXT-02 | Parallel subagents in isolated worktrees build, not merely check out | **Complete** — mechanism proven directly | `tests/integration/worktree-build.test.ts`, falsified, green. Does not need `pi-subagents` installed since it exercises this repo's own hook directly. |
| EXT-03 | Subagents run in the background without blocking | **Partial** — mechanism cited, never executed | Same evidence table as EXT-01. `RB-07-01` OUTSTANDING. |
| EXT-04 | A running subagent can be steered mid-run without being killed | **Partial** — mechanism cited, never executed | Same evidence table. `RB-07-01` OUTSTANDING. |
| EXT-05 | Plan mode, todo, background bash, LSP, structured questions, web lookup, session search, loop detection all available | **Partial** — 4/8 live, 4/8 never installed | `tests/unit/extension-composition.test.ts` (4 vendored, live) + `.pi/settings.json` (4 npm-pinned, never installed). `RB-07-02` OUTSTANDING. |
| EXT-06 | Pi's own bundled examples preferred over third-party where they cover the need | **Complete** | `tests/unit/extension-composition.test.ts`'s regression guard (no vendored capability's npm alternative appears in `packages[]`) — not install-dependent. |
| EXT-07 | File checkpointing restores the working tree | **Complete** | `tests/integration/git-checkpoint.test.ts` against real temp git repos, headless, untracked-file capture, persistence — verified real, not stub. |
| EXT-08 | Every pin re-verified at planning time, not inherited from research | **Complete** | `docs/EXTENSIONS.md`'s Verification provenance section — live, timestamped `npm view`/`gh api`/`npm pack` commands, independent of `07-RESEARCH.md`. |
| EXT-09 | A documented smoke-test ritual runs on every version bump | **Partial** — documented, never run | `docs/RUNBOOK.md`'s `RB-07-01` — fully specified with four falsifiable legs. Has never executed. OUTSTANDING. |
| EXT-10 | Any extension without a license file is vendored, not depended on | **Complete** | `tests/unit/vendor-license-audit.test.ts`, bidirectional, plus `.pi/extensions/loop-police/PROVENANCE.md` with a SHA-256 hash. Re-verified three separate times per STATE.md's own record. |

**No orphaned requirements.** Every EXT-01..10 requirement declared in ROADMAP.md's Phase 7 requirements list is claimed by a plan and reflected in `.planning/REQUIREMENTS.md`'s traceability table, and this verification's own read of REQUIREMENTS.md matches the plan claims exactly (checked both directions).

### Anti-Patterns Found

None classified as blockers. No unresolved `TBD`/`FIXME`/`XXX` markers found in the files this phase modified (searched via the full test suite and direct reads of the key new files — `tests/integration/worktree-build.test.ts`, `tests/unit/tool-count-baseline.test.ts`, `tests/unit/vendor-license-audit.test.ts`, `docs/EXTENSIONS.md`, `docs/RUNBOOK.md`, `.pi/extensions/loop-police/PROVENANCE.md`). No stub `return null`/empty-array patterns found in the vendored extensions — each was read and each does real, non-trivial work (checkpoint's `GIT_INDEX_FILE` mechanism, loop-police's repetition detection, plan-mode's `setActiveTools` gating).

One thing worth flagging as ℹ️ **Info, not a blocker**: `pi-web-access`'s dependency tree carries a third, uncontrolled `typebox` instance (`^1.1.38`, caret range) alongside Pi's bundled `1.3.7` and `pi-subagents`' own exact-pinned `1.1.38`. This is explicitly recorded in `docs/EXTENSIONS.md`'s "Known pin residuals" as `UNVERIFIED` runtime consequence, not silently accepted — correctly flagged rather than hidden, and it cannot be resolved until `RB-07-02` actually installs the package to observe it.

## Human Verification Required

### 1. RB-07-02 — Install the five pinned specs and reconcile `pi list`

**Test:** On the work laptop, with a human physically present, run `pi install -l npm:pi-subagents@0.49.0` (and the other four pinned specs), then `pi list`.
**Expected:** `pi list` shows all five specs at their pinned versions and nothing else project-scoped; reconciliation against `.pi/settings.json`'s `packages[]` records `MATCH` or an itemised `MISMATCH`.
**Why human:** The blocking package-legitimacy gate (plan 07-10) could not be auto-approved on this machine. Its pre-authorisation rested on the ground that this development machine holds no credentials — a ground this verification independently reconfirmed FALSE (`aws sts get-caller-identity --profile <admin-profile>` → live IAM admin keys, a production account (account id redacted)). The standing autonomous-run pre-authorisations cover `[RUNBOOK]` live-check verification, explicitly not a supply-chain install gate, per that gate's own binding text.

### 2. RB-07-01 — The composed smoke ritual

**Test:** After RB-07-02 completes, run the four legs named in `docs/RUNBOOK.md`'s `RB-07-01`: one real turn per provider, one real subagent spawn (confirming it used Phase 5's `agentOverrides` model, not a frontmatter-declared one, and that a worktree-isolated spawn actually builds), one blocked command inside a session carrying the five newly-installed extensions, and one wire dump showing no credential-shaped value.
**Expected:** Each leg produces the specific, falsifiable evidence named in the runbook entry — not "it seemed fine."
**Why human:** No subagent has ever spawned on this machine, no package has ever been installed, and this is inherently an interactive, credentialed, end-to-end sequence. No fixture this repository has written can substitute for it (the runbook entry itself names, per leg, exactly what each offline proxy does and does not prove).

## Gaps Summary

There are no `gaps_found`-class findings in this phase — nothing was found to be genuinely unbuilt. Every PARTIAL success criterion and every Partial EXT requirement traces to exactly one root fact: **plan 07-10's install gate was correctly refused because its own pre-authorisation's ground (a) is false, and no install has run since.** This verification independently reconfirmed that ground is false by running the same AWS credential check the phase's own plan ran. The two runbook entries this produced (`RB-07-01`, `RB-07-02`) are both properly documented, both machine-enforced as `OUTSTANDING` by `tests/unit/docs-policy.test.ts` (confirmed by reading the guard's `PHASE_SEVEN_IDS` array and its fixture tests), and both correctly reflected — never overstated — in `.planning/REQUIREMENTS.md`'s traceability table and in every SUMMARY.md this phase produced. Per the project's own standing autonomous-run policy, `human_needed` caused solely by `[RUNBOOK]` items is expected and pre-authorised; it is not a phase failure, and this phase should not be blocked from advancing on that basis. It should, however, not be silently reported as fully `passed` — the two outstanding entries are real, named, and require a human on the work laptop before EXT-01/03/04/05/09 can honestly move from `[~]` to `[x]`.

---

*Verified: 2026-08-15*
*Verifier: Claude (gsd-verifier)*
