---
phase: 01-bootstrap-packaging-supply-chain
plan: 03
subsystem: extensions
tags: [load-paths, sentinel, project-trust, reload, boot-02, boot-05]
requires:
  - pi-package-manifest
  - vitest-test-framework
  - tsconfig-typecheck
  - pi-cli-runner
  - git-ignore-oracle
provides:
  - load-path-sentinel-extension
  - boot02-executed-load-proof
  - boot05-executed-load-proof
  - trust-gate-negative-control
  - reload-precondition-assertion
affects:
  - .pi/extensions/
  - tests/integration/
tech-stack:
  added: []
  patterns:
    - "Sentinel-provider load proof: a dead-endpoint provider turns \"did the extension load?\" into an exit code, with no credential and no TTY"
    - "Every negative control is paired with a positive on the same fixture, so absence can only mean the gate fired"
    - "Command + provider, never a tool — the BOOT-10 boundary rule dogfooded on the first commit of real code"
key-files:
  created:
    - .pi/extensions/harness/index.ts
    - tests/integration/load-paths.test.ts
    - tests/unit/extension-layout.test.ts
  modified: []
decisions:
  - "Case 4's trust-gate control pairs the no-`-a` absence with an `-a` positive on the SAME fresh PI_CODING_AGENT_DIR — absence alone could equally mean the fresh agent dir broke Pi outright"
  - "Cases 1 and 2 run from a fresh temp cwd AND a fresh PI_CODING_AGENT_DIR, so the `-e` package path is proven in isolation from this machine's saved trust decisions"
  - "The extension docstring names the forbidden call as \"the tool-registration call\" rather than spelling it, so the file passes its own grep audit"
metrics:
  duration: ~18 min
  completed: 2026-08-13
  tasks: 3
  commits: 3
---

# Phase 1 Plan 03: Load-Path Sentinel & Executed Load Proofs Summary

Shipped the `ky-harness-selftest` sentinel extension and turned ROADMAP success criterion 2 from an assertion into four executed proofs — package path, real clone, dogfood path, and the trust gate itself as its own negative control.

## What Was Built

**Task 1 — the sentinel extension (commit `16383e3`)**

`.pi/extensions/harness/index.ts`, 84 lines, the first real code in the repo. It exports `SELFTEST_MODEL_ID = "ky-harness-selftest"` (and `SELFTEST_PROVIDER_ID = "ky-harness"`), and its default export does exactly two things: registers the `ky-hello` command, and registers a provider at `http://127.0.0.1:1/v1` with `apiKey: "unused"` carrying one model whose `id` and `name` are both the sentinel.

Port 1 is unassignable. The provider exists to be *observable*, never to be called — `pi --list-models` renders the models of every provider a loaded extension registered, and provider registrations made during the factory are queued and flushed once the runner binds its context (`docs/extensions.md:1709`). That is the whole trick: a unique model id makes "did the extension load?" answerable by exit code, with no credential, no TTY and no model call.

It registers a command and a provider and **no tool**. That is BOOT-10's boundary rule dogfooded on the first commit of real code: a tool's name, description and complete JSON Schema are serialised into `tools[]` on every provider request (`pi-ai src/api/openai-completions.ts:1337-1370`), while a command costs exactly zero per-turn tokens because `src/core/system-prompt.ts` contains no reference to registered commands. The file header records the rule, the citations, the removal deadline (Phase 3, or the dead model clutters `/model`), and the two layout prohibitions — no build step, no `.gitignore` under `.pi/extensions/`.

`registerCommand`'s handler type is `(args: string, ctx: ExtensionCommandContext) => Promise<void>` (`dist/core/extensions/types.d.ts:856`), not the `void | Promise<void>` the plan's interface note gave, so the handler is `async`. Caught by `tsc`, not by inspection.

**Task 2 — executed load-path proofs (commit `b8e576b`)**

`tests/integration/load-paths.test.ts`, four cases, all through `runPi`, all importing `SELFTEST_MODEL_ID` from the extension rather than duplicating the literal. `requirePiOnPath()` runs in `beforeAll` so a missing binary fails the suite loudly.

| Case | Requirement | Invocation | Assertion |
|---|---|---|---|
| 1 | BOOT-02 package path | `pi --offline -e <repoRoot> --list-models`, fresh temp cwd, fresh agent dir | sentinel present |
| 2 | BOOT-02 real clone | `git clone` → `npm install --omit=dev` → `pi --offline -e <clone> --list-models` | sentinel present |
| 3 | BOOT-05 dogfood | `pi --offline -a --list-models`, cwd = repoRoot | sentinel present |
| 4 | BOOT-05 control | same, **without** `-a`, fresh `PI_CODING_AGENT_DIR` | sentinel **absent**, then present again with `-a` on the same dir |

The header comment records the double-load caveat (dogfood + global install produces duplicate command entries; dedup is by canonical path; non-fatal, README's problem not the code's).

**Task 3 — `/reload` structural precondition (commit `eb7d64a`)**

`tests/unit/extension-layout.test.ts`, four assertions. Every tracked `.ts` under `.pi/extensions/` must match `.pi/extensions/<name>.ts` or `.pi/extensions/<dir>/index.ts`; the set must be non-empty; no `.gitignore` exists under `.pi/extensions/` on disk *or* in the index; `package.json`'s `pi.extensions` contains the literal `./.pi/extensions` and no `*`, `?`, `[`, or `!`.

Its docstring states in the first paragraph that this is the **offline proxy** for an **OUTSTANDING** live check recorded in `docs/RUNBOOK.md`, and that the live check must never be reported as passed on the strength of this file.

## Key Implementation Details

**`PI_CODING_AGENT_DIR` is what makes the trust-gate control honest.** It relocates everything Pi keeps under `~/.pi/agent` — including `trust.json` — verified at `dist/config.js:397` (`ENV_AGENT_DIR = \`${APP_NAME.toUpperCase()}_CODING_AGENT_DIR\``) and `:412-418` (`getAgentDir()` reads it before falling back to `homedir()`). Without it, case 4 would pass or fail according to whatever decision this machine happened to have saved, which is exactly the failure mode research Pitfall 3 warns about.

**But a fresh agent dir is also a confound, and the plan did not account for it.** Case 4 as specified asserts only *absence*. An absent sentinel is equally consistent with "the trust gate dropped the project resources" and "pointing Pi at an empty agent directory broke it outright". Those are indistinguishable from an absence assertion, so case 4 could itself have been a vacuous pass — the precise defect it exists to prevent in case 3. Case 4 now runs both invocations against the *same* `PI_CODING_AGENT_DIR`, changing nothing but the flag:

```
PI_CODING_AGENT_DIR=<fresh>  pi --offline --list-models      -> 0 matches
PI_CODING_AGENT_DIR=<same>   pi --offline -a --list-models   -> 1 match
```

Executed 2026-08-13. The only variable is `-a`, so the difference can only be the gate.

**Cases 1 and 2 run from an unrelated cwd with a fresh agent dir.** Running `pi -e <clone>` with cwd = the clone would leave the result ambiguous between the package path and the project-local path. Both cases now use a separate `mkdtemp` cwd, so what they prove is unambiguously the manifest path.

**`npm install --omit=dev` in the clone installs 101 packages, not zero.** The five `peerDependencies` are declared at `"*"`, and npm 7+ auto-installs peers, so the runtime install pulls the `@earendil-works` family and its transitive deps from the registry. This is correct and it is what a real consumer experiences, but it means case 2 is the one test in the suite that requires network egress — `--offline` covers Pi, not npm. It completes in ~5 s locally and has the full 120 s timeout.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Case 4's absence assertion could not distinguish "gate fired" from "Pi broke"**
- **Found during:** Task 2
- **Issue:** The plan specifies case 4 as an absence assertion under a fresh `PI_CODING_AGENT_DIR`. Absence is also what you observe if the empty agent directory prevents Pi from producing any model list at all, which would make the control — the thing guaranteeing cases 1–3 are not vacuous — itself vacuous. Threat T-01-09 is specifically about a load assertion silently returning nothing.
- **Fix:** Added a paired positive inside case 4: the same fresh `PI_CODING_AGENT_DIR`, the same cwd, `-a` added and nothing else changed, asserted to contain the sentinel. Both runs also assert `status === 0`.
- **Files modified:** `tests/integration/load-paths.test.ts`
- **Commit:** `b8e576b`

**2. [Rule 2 - Missing critical functionality] Cases 1 and 2 were ambiguous between the two load paths**
- **Found during:** Task 2
- **Issue:** Running `pi -e <dir>` with cwd inside that same directory means a pass could come from project-local discovery rather than the manifest. The two cases exist specifically to prove the manifest path.
- **Fix:** Both run from a dedicated `mkdtemp` cwd with a fresh `PI_CODING_AGENT_DIR`.
- **Files modified:** `tests/integration/load-paths.test.ts`
- **Commit:** `b8e576b`

**3. [Rule 1 - Bug] `registerCommand` handler must return `Promise<void>`**
- **Found during:** Task 1
- **Issue:** The plan's interface note gives `(args, ctx) => void | Promise<void>`. The shipped type is `handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>` (`dist/core/extensions/types.d.ts:856`). A synchronous handler fails `tsc --noEmit`.
- **Fix:** Handler declared `async`.
- **Files modified:** `.pi/extensions/harness/index.ts`
- **Commit:** `16383e3`

**4. [Rule 1 - Bug, pre-empted] The extension docstring would have tripped its own grep audit**
- **Found during:** Task 1, before first write
- **Issue:** Task 1's verify greps the source for the tool-registration call name and fails if present, and Plan 09 greps `.pi/extensions/**` for the same string. A header comment saying "must never call `registerTool`" makes the file match. This is the third instance of the pattern in this phase (Plan 01's `.npmrc` comment, Plan 02's `pi.ts` docstring).
- **Fix:** The prohibition is written as "must NEVER register a tool" / "the tool-registration call". The rule is stated at least as clearly and the file passes its own audit.
- **Files modified:** `.pi/extensions/harness/index.ts`
- **Commit:** `16383e3`

No architectural changes, no auth gates, no checkpoints, no package installs.

## Decisions Made

1. **Paired positive inside the negative control.** A control that cannot fail for the right reason is not a control. Costs one extra 3-second Pi invocation.
2. **`SELFTEST_PROVIDER_ID` exported alongside the model id** — unlisted in the plan. Phase 3 has to unregister or gate this provider by name; a second duplicated literal at that point is how the removal quietly misses.
3. **Case 2's network dependency accepted rather than engineered around.** `npm install --omit=dev` with `"*"` peers reaches the registry. Making it offline would need a pre-seeded cache and would stop testing what a real consumer experiences. Documented instead.
4. **Task 3 enumerates from the git index, not the disk.** `trackedFiles` is the oracle; an untracked file on the author's disk is not something a consumer receives, and the whole point of the layout rule is what ships.

## Verification Results

Every plan-level check, executed 2026-08-13:

```
npx tsc --noEmit                                        -> exit 0
npx vitest run                                          -> 5 files, 82 tests passed
npx vitest run tests/integration/load-paths.test.ts     -> 4 passed (11.9 s)
npx vitest run tests/unit/extension-layout.test.ts      -> 4 passed
cd $(mktemp -d) && pi --offline -e <repo> --list-models | grep -q ky-harness-selftest -> 0
cd <repo>       && pi --offline -a       --list-models | grep -q ky-harness-selftest -> 0
grep -E '(it|describe|ctx|test)\.skip|\btodo\b' tests/integration/load-paths.test.ts -> no matches
```

**Mutation checks — every assertion is live.**

Task 1/2, extension disabled (`index.ts` → `index.ts.disabled`), raw commands:

| Assertion | Sentinel matches | Verdict |
|---|---|---|
| case 1 — `-e <repo>` from temp cwd | 0 | would fail ✓ |
| case 3 — `-a` in repo | 0 | would fail ✓ |
| `npx vitest run tests/integration` | file failed to collect | red ✓ |

Case 2 clones `HEAD`, so a working-tree rename cannot reach it — it was mutated at the right layer instead. In a throwaway clone the sentinel was `git rm`'d and committed, then `npm install --omit=dev` and `pi -e <that clone> --list-models` → **0 matches**. The case-2 assertion discriminates. No history in this repo was rewritten; the mutation lived and died in `/tmp`.

Task 3:

| Mutation | Result |
|---|---|
| tracked `.pi/extensions/harness/helper.ts` added | FAIL — `expected [ '.pi/extensions/harness/helper.ts' ] to deeply equal []` |
| `.pi/extensions/harness/.gitignore` created | FAIL — `expected [ '.pi/extensions/harness/.gitignore' ] to deeply equal []` |
| both removed | 4 passed, `git status --short` clean |

## Requirements Satisfied

- **BOOT-02** — proven by execution on two independent surfaces: the manifest path from an unrelated cwd, and a real `git clone` + `npm install --omit=dev` that additionally proves the control files are genuinely committed and that nothing in `devDependencies` is needed at runtime. The live `pi install https://github.com/kaiyitkoh/ky-pi-agent` against the real remote stays **OUTSTANDING** (needs a clean profile and GitHub egress); the local-path clone is its offline proxy.
- **BOOT-05** — proven by execution: `-a` with cwd = repoRoot shows the sentinel; the identical run without `-a` on the same fresh agent dir does not. The `/reload` behavioural check stays **OUTSTANDING** (needs an interactive TTY); the structural path assertion is its offline proxy and says so in its own docstring.

## Known Stubs

None. The dead-endpoint provider is not a stub — it is a fully functional, deliberately unroutable observable, and its removal deadline (Phase 3) is written into the file header. No placeholder values, no unwired components, no `FIXME`.

## Threat Flags

None. This plan adds one network endpoint literal (`http://127.0.0.1:1/v1`) which is already in the plan's threat register as T-01-11, disposition **accept**: loopback, unassignable port, literal `apiKey: "unused"`, never routed to.

## Notes for Next Plan

- `docs/RUNBOOK.md` does not exist yet. Three entries must land there and all three are named in code or tests already: `gh auth logout` on the work laptop (SAFE-16), the live `pi install <github url>` (BOOT-02), and `/reload` re-registration (BOOT-05). `tests/unit/extension-layout.test.ts` names the file in its docstring; do not let that reference dangle past this phase.
- The README owes two sentences: **dogfood *or* install globally, not both** (duplicate command entries, RESEARCH 2.4), and the dead-endpoint sentinel's existence so nobody reports `ky-harness-selftest` as a bug.
- `tests/integration/` now has content, so `passWithNoTests: false` is satisfied from both directions.
- Case 2 needs network for `npm install`. Any future "fully offline test run" claim must exclude it or pre-seed the npm cache.
- Phase 3 must unregister or gate provider `ky-harness`; import `SELFTEST_PROVIDER_ID` rather than retyping the name.
- CI must `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.1` before `npm test`, or `requirePiOnPath()` fails the integration suite by design.

## Self-Check: PASSED

All 3 claimed files exist on disk (`.pi/extensions/harness/index.ts`, `tests/integration/load-paths.test.ts`, `tests/unit/extension-layout.test.ts`). All 3 claimed commits (`16383e3`, `b8e576b`, `eb7d64a`) exist in git history. Full suite green and working tree clean at time of writing. Verified 2026-08-13.
