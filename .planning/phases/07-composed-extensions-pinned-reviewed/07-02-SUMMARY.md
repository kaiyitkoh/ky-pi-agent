---
phase: 07-composed-extensions-pinned-reviewed
plan: 02
subsystem: testing
tags: [git-worktree, junction, windows, subagents, ext-02]

requires:
  - phase: 07-composed-extensions-pinned-reviewed
    provides: "docs/EXTENSIONS.md (07-01) — provenance record for pi-subagents@0.49.0, the worktree isolation accepted-residual section this plan's hook implements"
provides:
  - "tests/helpers/worktree.ts — makeTempRepoWithNodeModulesAndEnv, addWorktree, removeWorktree: a real git-worktree fixture helper proving untracked .env/node_modules genuinely do not travel to a fresh worktree"
  - ".pi/scripts/worktree-setup-hook.mjs — the repo-authored subprocess hook that speaks pi-subagents' WorktreeSetupHookInput stdin/stdout JSON contract unmodified, provisioning a fresh worktree with a Windows junction (never a privileged symlink) plus a copied .env"
  - "Direct, executed confirmation on this machine that fs.symlinkSync(src, dst, \"junction\") succeeds without Developer Mode/elevation, resolving through to the real node_modules tree"
affects: [07-05]

tech-stack:
  added: []
  patterns: ["Node subprocess script speaking a stdin-JSON/stdout-JSON contract, placed outside .pi/extensions/ so Pi's loader never tries to load it as an extension"]

key-files:
  created: [tests/helpers/worktree.ts, .pi/scripts/worktree-setup-hook.mjs]
  modified: []

key-decisions:
  - "worktree.ts's own local run() is copied verbatim from git.ts:45-56 rather than importing a shared spawn wrapper -- keeps this module's error semantics independent of git.ts, matching the plan's explicit instruction not to re-declare a second git wrapper with DIFFERENT semantics while still not sharing internal (non-exported) implementation"
  - "commitFile(repo, \"src/index.js\", ...) requires the src/ directory to exist first -- git.ts's commitFile only ever received flat filenames before this plan (evidence-gate.test.ts's a.txt/b.txt); mkdirSync(join(repo, \"src\"), {recursive:true}) is called before commitFile so the nested-path case actually works rather than throwing ENOENT"
  - "the hook treats a worktreePath that does not yet exist as a validation failure (fail closed, empty syntheticPaths, non-zero exit) rather than crashing on symlinkSync's own ENOENT -- consistent with the real invocation order (pi-subagents runs `git worktree add` before spawning the hook, so the directory always exists by the time a real caller invokes it) and with the plan's 'never emit a half-provisioned success' requirement"
  - "containment check (worktreePath must not equal or be an ancestor of repoRoot) runs before existsSync(worktreePath) and before either provisioning step -- checked directly against the manual probe: a worktreePath resolving to an ancestor of repoRoot is refused with nothing written, no directory touched"

requirements-completed: [EXT-02]

duration: ~10min
completed: 2026-08-15
---

# Phase 07 Plan 02: Worktree Fixture Helper and Windows-Safe Setup Hook Summary

**Built and manually proved on this machine the two pieces EXT-02 needs: a real git-worktree test fixture (`tests/helpers/worktree.ts`) and a repo-authored setup hook (`.pi/scripts/worktree-setup-hook.mjs`) that junctions `node_modules` and copies `.env` into a fresh worktree without requiring Windows Developer Mode.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-15T03:18:xxZ (after 07-01's completion commit)
- **Completed:** 2026-08-15T03:24:51+08:00
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments

- `tests/helpers/worktree.ts` — `makeTempRepoWithNodeModulesAndEnv()` builds a temp repo (via `tests/helpers/git.ts`'s `makeTempRepo`/`commitFile`) with a tracked `src/index.js` build-proxy that `require("dep")`s a bare specifier and checks `fs.existsSync(".env")`, plus **genuinely untracked** `node_modules/dep/index.js` and `.env` created with raw `fs` calls and never passed to `git add`. `assertUntracked()` asks `git ls-files` directly and throws if either path is somehow tracked, closing the exact vacuous-fixture trap the plan called out. `addWorktree`/`removeWorktree` wrap real `git worktree add -b <branch> HEAD` and the `remove --force` / `branch -D` / `prune` teardown sequence, mirroring `pi-subagents@0.49.0`'s own invocation shape (`worktree.ts:393, 428, 430, 640, 740`) exactly.
- `.pi/scripts/worktree-setup-hook.mjs` — reads `WorktreeSetupHookInput` JSON on stdin, validates `version === 1` and that `repoRoot`/`worktreePath` are non-empty absolute paths that already exist, asserts `worktreePath` neither equals nor is an ancestor of `repoRoot` before touching the filesystem, junctions `node_modules` with the three-argument `fs.symlinkSync(src, dst, "junction")` form, copies (never links) `.env`, and emits exactly one line of `{"syntheticPaths":[...]}` on stdout. Every failure path emits `{"syntheticPaths":[]}` plus a stderr diagnostic and a non-zero exit — never a half-provisioned success.
- **Manually executed on this machine**, not merely written:
  - The plan's own verification probe (`printf ... | node .pi/scripts/worktree-setup-hook.mjs`) was run against a genuinely existing sibling directory (the printf's literal `$PWD`-based paths needed correcting to real Windows-style absolute paths first — see Issues Encountered). Result: `{"syntheticPaths":["node_modules"]}`, `exit=0`.
  - `fs.lstatSync(...).isSymbolicLink()` on the created link returned `true`, and `fs.existsSync(.../node_modules/vitest)` through the junction returned `true` — the junction genuinely resolves through to this repo's real `node_modules`, without Developer Mode or an elevated shell.
  - `version: 2` payload → `exit=1`, `{"syntheticPaths":[]}`, stderr names the unsupported version.
  - A payload whose `worktreePath` resolves to an ancestor of `repoRoot` → `exit=1`, `{"syntheticPaths":[]}`, and the would-be ancestor directory (`sub/deep`) was never created — confirmed with `ls`.
  - All probe artifacts (`__hook_probe*` directories, temp payload files) were deleted before committing; `git status --short` showed only the two intended new files at every step.

## Task Commits

Each task was committed atomically:

1. **Task 1: tests/helpers/worktree.ts — the temp-repo-with-untracked-files fixture** - `4bd76ac` (test)
2. **Task 2: .pi/scripts/worktree-setup-hook.mjs — the Windows-safe worktree provisioner** - `6f0cc96` (feat)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `tests/helpers/worktree.ts` — real git-worktree fixture helper; exports `makeTempRepoWithNodeModulesAndEnv`, `addWorktree`, `removeWorktree`
- `.pi/scripts/worktree-setup-hook.mjs` — repo-authored, Windows-safe worktree setup hook speaking pi-subagents' documented stdin/stdout JSON contract

## Decisions Made

See `key-decisions` in frontmatter — summarized: (1) `worktree.ts`'s local `run()` is a verbatim copy of `git.ts`'s, kept separate rather than shared since `git.ts` exports no reusable spawn wrapper; (2) `commitFile` needed its parent directory (`src/`) created first, since every prior caller in this repo only ever wrote flat filenames; (3) the hook fails closed on a not-yet-existing `worktreePath` rather than crashing on `symlinkSync`'s own `ENOENT`, matching the real invocation order where `git worktree add` always runs first; (4) containment is checked before existence, so an ancestor-worktreePath payload is refused before any directory probe.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria were verified directly (typecheck, targeted test files, full suite, manual hook probes covering all three named payload shapes) with no Rule 1-4 auto-fix needed.

## Issues Encountered

- The plan's literal verification command (`printf '...' "$PWD" "$PWD/../__hook_probe" ...`) produces a broken path when run from Git Bash on this machine: `$PWD` prints POSIX-style (`/c/Users/...`), and Node's `path.resolve()` on win32 treats a leading `/` as "absolute from the current drive root" rather than translating it to `C:\...`, so `"$PWD/../__hook_probe"` resolved to the nonsensical `C:\c\Users\Admin\Documents\__hook_probe` instead of the intended sibling directory. This is a shell/path-translation artifact of the probe invocation, not a defect in the hook itself — resolved by generating the JSON payload with `node -e` (using `process.cwd()`, which returns a correct Windows-style path) instead of shell-side `$PWD` string concatenation. The hook's own path handling (`path.resolve`, `isAbsolute`) was exercised correctly once given well-formed input; this is recorded so a future caller building the same probe on Windows Git Bash does not lose time on the same translation surprise.

## User Setup Required

None — no external service configuration required. Everything in this plan was built and proved with local `git`, `fs` and `node`, no credentials or network access needed.

## Next Phase Readiness

Both artifacts EXT-02's decisive proof depends on now exist and are independently exercised: `tests/helpers/worktree.ts` is ready to be imported by `tests/integration/worktree-build.test.ts` (a later plan, 07-05 per `07-RESEARCH.md`'s Wave-0 gap list), and `.pi/scripts/worktree-setup-hook.mjs` is ready to be wired into `.pi/settings.json`'s `worktreeSetupHook` configuration once that settings-key path is confirmed (07-RESEARCH.md's Open Question 1, recorded as resolved-at-planning-time by plan 07-09 Task 1). No blockers. The junction mechanism's Windows viability is no longer an assumption — it was executed and observed directly on this machine in this plan, not inferred from research.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: tests/helpers/worktree.ts
- FOUND: .pi/scripts/worktree-setup-hook.mjs
- FOUND: 4bd76ac (test(07-02) commit)
- FOUND: 6f0cc96 (feat(07-02) commit)
