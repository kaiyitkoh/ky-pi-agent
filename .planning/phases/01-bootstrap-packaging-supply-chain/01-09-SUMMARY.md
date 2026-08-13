---
phase: 01-bootstrap-packaging-supply-chain
plan: 09
subsystem: contributor-policy
tags: [boot-10, boundary-rule, contributing, token-economics, vitest]
requires:
  - git-ignore-oracle
  - load-path-sentinel-extension
  - vitest-test-framework
provides:
  - boot10-boundary-rule
  - boot10-compliance-gate
  - tool-registration-allowlist
affects:
  - CONTRIBUTING.md
  - tests/
tech-stack:
  added: []
  patterns:
    - "A documented rule ships with the test that enforces it, in the same commit"
    - "An exception is an allow-list entry with a written justification, never a deleted test"
    - "Every scan-for-a-forbidden-string assertion is preceded by a non-emptiness guard"
    - "A cited claim is read out of the vendor's own source, not quoted from a prior document"
key-files:
  created:
    - CONTRIBUTING.md
    - tests/unit/contributing-boundary.test.ts
  modified: []
decisions:
  - "The three source facts were re-verified against Pi 0.84.1's recovered TypeScript rather than inherited from RESEARCH.md — all three hold, and two gained a second citation (the convertTools call site at :731, and skills.ts:350-356 for the skill cost)"
  - "The tool-registration scan is a plain substring, matching 01-VALIDATION.md's BOOT-10 wording — it survives bracket access and aliasing, at the price that extensions may not name the call even in a comment"
  - "The allow-list is empty and exported by name so a later phase extends it with an (a)/(b)/(c) justification instead of deleting the test"
  - "The npm_config_ignore_scripts persistence hazard is cited to bash.ts:105 + shell.ts:122-134 (the bash tool spreads process.env), not to the package-manager getEnv() the plan named — both are true, the bash-tool path is the one that bites a user mid-session"
metrics:
  duration: ~20 min
  completed: 2026-08-13
  tasks: 2
  commits: 2
---

# Phase 1 Plan 09: BOOT-10 Boundary Rule Summary

The house rule that governs every later phase's capability decisions is now written with three source-cited facts behind it, and a test proves Phase 1 does not break it in the commit that writes it.

## What Was Built

**Task 1 — `CONTRIBUTING.md` (commit `d41c88d`, 171 lines)**

Five sections, no ceremony — no code of conduct, no PR template, no triage process, because there is one contributor.

| Section | What it fixes |
|---|---|
| Boundary rule | A new capability **defaults to a command or skill**; a tool must answer (a) must the *model* call this mid-turn, (b) what is the measured schema cost, (c) why can a skill not carry this as a procedure. Unanswered (a) is an automatic no. Corollary: lazily-loaded tools omit `promptSnippet`/`promptGuidelines`. |
| Dependency policy | Exact pins + committed lockfile; the `peerDependencies: "*"` explanation, so nobody "fixes" it; unscoped `typebox`; the package-source ref rule and this repo's single documented exemption. |
| Supply chain | Three `.npmrc` scopes tabulated with what each covers, the **third-party git gap stated honestly**, the one-shot `npm_config_ignore_scripts=true` ritual, and why it must never be persistent. |
| Repo rules | No build step; POSIX `sh`; never a `.gitignore` under `.pi/extensions/`; flat `.pi/prompts/`; auto-discovered extension paths; every control assertion ships with the case that must fail. |
| Verifying a change | `npx vitest run tests/unit`, `npx vitest run && npx tsc --noEmit`, and what CI adds on top — including that `shellcheck` is a CI-only gate, so a green local run does not cover it. |

**Task 2 — `tests/unit/contributing-boundary.test.ts` (commit `9882e9b`, 5 tests)**

| # | Assertion | Guards against |
|---|---|---|
| 1 | `CONTRIBUTING.md` matches `/default.*command or skill/i` | the rule being reworded out of existence |
| 2 | it contains `openai-completions.ts:1337` | the rule decaying into an unsupported style preference |
| 3 | the tracked `.ts`/`.js` set under `.pi/extensions/` is **non-empty** | assertion 4 passing vacuously |
| 4 | no file in that set contains `registerTool`, minus an empty allow-list | the phase breaking its own rule |
| 5 | at least one contains `registerCommand` | the rule being satisfied by an extension that does nothing |

The plan asked for three assertions; there are five. Splitting the rule from its citation, and giving the non-emptiness guard its own name, means a failure says which half broke.

## Key Implementation Details

**Every citation was re-derived from source, not inherited.** The plan and `RESEARCH.md` §9 supply three facts; the standing policy says to verify against Pi's own published TypeScript. All three were recovered from `dist/**/*.js.map` `sourcesContent` on the installed Pi 0.84.1 and all three hold:

| Claim | Verified at | Result |
|---|---|---|
| A tool's name, description and full JSON Schema ride in `tools[]` on every request | `pi-ai/src/api/openai-completions.ts:1337-1372` (`convertTools`, `parameters: tool.parameters // TypeBox already generates JSON Schema`), called at `:731` (`params.tools = convertTools(activeTools, compat)`) | **confirmed**, plus the call site the research did not name |
| A command costs zero — commands appear nowhere in system-prompt construction | `pi/src/core/system-prompt.ts`, whole file (163 lines): the only `/command/i` hit is prose in the preamble at `:121` | **confirmed** |
| A skill costs name + description + path; body loads on read | `pi/src/core/skills.ts:350-356` emits exactly `<name>`, `<description>`, `<location>`; `:344` tells the model to use the read tool for the body | **confirmed**, and now cited (RESEARCH asserted the ~40–60 token figure without a file) |

Four supporting citations were verified the same way rather than copied: `docs/packages.md:171` (the five peers with `"*"`), `loader.ts:118-139` (the alias map, including `@sinclair/typebox` → the same entry at `:136-138`), `docs/packages.md:90` (refs are pinned and `pi update` does not move them), `package-manager.ts:456-491` (`collectAutoPromptEntries` — one `readdirSync`, no recursion, so prompts are flat), `docs/extensions.md:179` (jiti, no compilation) and `:7` (auto-discovery is the `/reload` precondition), `docs/windows.md:3-7` (bash is a hard prerequisite).

**One citation was corrected.** The plan said Pi "passes `env: getEnv()` to everything it spawns". `getEnv()` is real but private to `package-manager.ts:6-9` and used only for Pi's own npm spawns (`:2583`, `:2596`, `:2664`). The path that actually bites a user who exports `npm_config_ignore_scripts` persistently is the **`bash` tool**, which spawns with `env: env ?? getShellEnv()` (`pi/src/core/tools/bash.ts:105`), and `getShellEnv()` returns `{...process.env}` with only `PATH` adjusted (`pi/src/utils/shell.ts:122-134`). CONTRIBUTING cites both.

**The scan is a substring, not a call-shaped regex.** `01-VALIDATION.md`'s BOOT-10 row says the string "appears nowhere under `.pi/extensions/**`". A substring survives `pi["registerTool"]`, a destructured alias and a `const t = "registerTool"` indirection — the same class of evasion the safety layer must defeat later. The price is that an extension may not name the call even in a comment, which is why `.pi/extensions/harness/index.ts` (Plan 03) already says "the tool-registration call". That trade-off is written into the constant's docstring so the next person does not loosen it by accident.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] Two assertions beyond the plan's three**

- **Found during:** Task 2
- **Issue:** The plan's prose asks for the rule, the citation, the non-vacuous scan and the positive half — four things under a heading that says "three assertions". Bundling the citation into the rule assertion, or the guard into the scan, produces a failure message that does not say which half broke.
- **Fix:** Five named tests in two `describe` blocks.
- **Files modified:** `tests/unit/contributing-boundary.test.ts`
- **Commit:** `9882e9b`

**2. [Rule 1 — Bug] The rule sentence did not match the rule's own regex**

- **Found during:** Task 1 verification
- **Issue:** The first draft read "defaults to a command or a skill". `/default.*command or skill/i` — the literal regex in the BOOT-10 validation row and in the plan's `must_haves` — does not match that, because of the second article. The verify step caught it, which is the argument for having a machine-checkable phrasing at all.
- **Fix:** "defaults to a command or skill".
- **Files modified:** `CONTRIBUTING.md`
- **Commit:** `d41c88d`

No architectural changes, no auth gates, no checkpoints, no package installs. No `[RUNBOOK]` item is touched by this plan, so nothing here is outstanding.

## Decisions Made

1. **The allow-list is empty and named, not absent.** A later phase that genuinely needs a tool has an obvious, reviewable move — add a path plus its (a)/(b)/(c) answers — instead of the tempting one, which is deleting the test. The header docstring says so explicitly.
2. **The substring scan over a call-shaped regex**, per the validation row's wording. Documented trade-off rather than a silent choice.
3. **Two citations per fact where a second exists.** A single line number is one refactor away from being wrong; the definition plus its call site is much harder to invalidate silently.
4. **CONTRIBUTING states the third-party git gap rather than implying three `.npmrc` files close it.** Overclaiming coverage is the same false-assurance failure this phase has now caught three times.

## Verification Results

Every plan-level and acceptance check, executed:

```
node -e "<the plan's CONTRIBUTING regex battery>"       ->  CONTRIBUTING_OK 171 lines
npx vitest run tests/unit/contributing-boundary.test.ts ->  5 passed
npx tsc --noEmit                                        ->  exit 0
npm test                                                ->  14 files, 183 tests passed
```

**Mutation checks — all four gates are live** (each restored immediately; `git diff --stat` empty after every one):

| Mutation | Result |
|---|---|
| rule sentence → "should probably be a slash command" | `× states that a new capability defaults to a command or skill` — 1 failed, 4 passed |
| `openai-completions.ts:1337-1372` → "(somewhere)" | `× keeps the source citation…` — 1 failed, 4 passed |
| `pi.registerTool("x", {})` appended to the sentinel extension | `× registers no tool anywhere under .pi/extensions/` — 1 failed, 4 passed |
| the same string in a bare comment | `× registers no tool anywhere under .pi/extensions/` — 1 failed, 4 passed |
| `EXT_DIR` → a non-existent directory | `× finds at least one tracked extension source` **and** `× exercises the sanctioned surface` — 2 failed, 3 passed |

The last row is the one that matters: it proves the vacuous-pass guard and the positive-half assertion both fire, so assertion 4's green is a statement about real files rather than about an empty list.

## Requirements Satisfied

- **BOOT-10** — the boundary rule is written, grounded in three facts each re-verified at `file:line` in Pi 0.84.1's own source, and enforced by a test that asserts both the statement and the compliance, with a non-emptiness guard and a positive control. ROADMAP success criterion 5's third clause is now true rather than asserted.

## Known Stubs

None. `TOOL_REGISTRATION_ALLOWLIST` is empty **by design and by policy** for the whole of Phase 1 — it is the current correct value, not a placeholder, and its emptiness is what assertion 4 asserts. Nothing in `CONTRIBUTING.md` is a TODO or a forward reference to unwritten content; the two files it points at (`tests/unit/pinning.test.ts`, `tests/unit/npmrc-policy.test.ts`) both exist and are green.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema. One markdown file and one test; the test reads only tracked files inside the repo and writes nothing.

Threat-model dispositions discharged: **T-01-29** (unjustified tool registrations inflating the per-turn prompt) — rule plus enforcing scan; **T-01-30** (a future contributor "fixing" `peerDependencies: "*"`) — CONTRIBUTING carries the `packages.md:171` and `loader.ts:118-139` citations, and `pinning.test.ts` already allow-lists exactly those five keys; **T-01-31** (a rule stated but unenforced) — the non-emptiness guard and the positive control, both mutation-proven; **T-01-32** (`npm_config_ignore_scripts` set persistently) — accepted and documented, with the `bash.ts:105` / `shell.ts:122-134` inheritance reason.

## Notes for Next Plan

- **Plan 10 (docs/runbook) should link CONTRIBUTING from `README.md`.** Nothing currently points at it; a house rule nobody finds is a house rule nobody follows. `README.md` is still the "will be rewritten" placeholder.
- **The outstanding live checks are unchanged by this plan** and still owed by the runbook: SAFE-16's `gh auth logout` on the work laptop, BOOT-07's first CI run, BOOT-05's interactive `/reload`, and `shellcheck --shell=sh`. None is affected here.
- **Later phases extend `TOOL_REGISTRATION_ALLOWLIST`; they do not delete the test.** Phase 4's safety layer and Phase 7's subagent wiring are the two most likely to want a tool — both should be able to answer (a) cleanly or should be commands.
- **If a shipped extension ever needs to discuss tool registration in prose**, use "the tool-registration call" as `harness/index.ts` does. The scan is a substring and will not distinguish a comment from a call.

## Self-Check: PASSED

- `CONTRIBUTING.md` — FOUND
- `tests/unit/contributing-boundary.test.ts` — FOUND
- commit `d41c88d` — FOUND
- commit `9882e9b` — FOUND

Working tree clean after every mutation restore. Full suite re-run green after the final commit (14 files, 183 tests). Verified 2026-08-13.
