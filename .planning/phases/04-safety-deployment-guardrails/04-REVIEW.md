---
phase: 04-safety-deployment-guardrails
reviewed: 2026-08-14T10:40:00Z
depth: standard
iteration: 3
files_reviewed: 21
files_reviewed_list:
  - .pi/extensions/safety/approvals.ts
  - .pi/extensions/safety/audit.ts
  - .pi/extensions/safety/git.ts
  - .pi/extensions/safety/index.ts
  - .pi/extensions/safety/infra.ts
  - .pi/extensions/safety/paths.ts
  - .pi/extensions/safety/policy.ts
  - .pi/extensions/safety/shell.ts
  - bin/bootstrap.sh
  - docs/SAFETY.md
  - docs/RUNBOOK.md
  - tests/fixtures/evasion-corpus.ts
  - tests/global-teardown.ts
  - tests/helpers/bootstrap-repo.ts
  - tests/integration/bootstrap-check-only.test.ts
  - tests/integration/bootstrap-safety-stub.test.ts
  - tests/integration/headless-deny.test.ts
  - tests/integration/npmrc-ordering.test.ts
  - tests/integration/path-canonicalisation.test.ts
  - tests/integration/templates-install.test.ts
  - tests/unit/approvals.test.ts
  - tests/unit/contributing-boundary.test.ts
  - tests/unit/evasion-corpus.test.ts
  - tests/unit/path-policy.test.ts
  - tests/unit/safety-entry.test.ts
  - vitest.config.ts
findings:
  critical: 2
  warning: 2
  info: 5
  total: 9
status: issues_found
---

# Phase 4: Code Review Report (iteration 3 — FINAL)

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 21 source + 5 supporting test files
**Status:** issues_found

## Summary

Executed, not read: **7 of the 8 iteration-2 findings are genuinely fixed**
(CR-06, CR-07, WR-09, WR-10, WR-11, WR-12 fully; CR-08 only for the three
shapes it names). The suite is 1152/1152 green and the working tree is clean
after a full `npx vitest run` — I confirmed both, and confirmed the
`.env.example` corruption is genuinely gone.

**Two blockers remain, both of them created or left open by this fix pass, and
neither published in `docs/SAFETY.md`:**

1. **CR-09 (new, introduced by the CR-06 fix).** Moving the dedup into the
   bootstrap-generated stub swapped one fail-open for another. The stub gates
   on `existsSync(<cwd>/.pi/extensions/safety/index.ts)` — the file being on
   disk. Pi loads the project-scoped copy only when the project is *trusted*
   (`package-manager.js:1980`, `if (projectTrusted) { addResources("extensions", …) }`),
   and `resolveProjectTrusted` returns **`false` with no UI**
   (`project-trust.js`: `if (!options.projectTrustContext.hasUI) return false;`)
   absent a persisted decision — and there is no `~/.pi/agent/trust.json` on
   this machine. So in any headless run rooted at this repository (`--mode
   json`, `-p`, a spawned subagent) the project copy does not load, the stub
   sees the file and returns, and **neither registers**. Executed: the stub run
   with `cwd` = the repo root registers `[]` tools and `[]` events. This is
   verbatim the failure signature `install_safety_extension`'s own comment
   (`bin/bootstrap.sh:839-843`) says the user-scope stub exists to close.
2. **CR-10 (CR-08 partially fixed).** `normaliseExecutable`'s own contract
   (`shell.ts:330-333`) is "*every* caller that gates on a bare verb name MUST
   route through this function". CR-08 routed two of the four such gates in
   `shell.ts`. `resolveWrappers`' three (`lower === "env"`, `lower === "sudo"`,
   `PASSTHROUGH_WRAPPERS.has(lower)`) still compare a raw `.toLowerCase()`.
   Executed against the real `evaluate()` on a protected `main`:
   `/usr/bin/env git push`, `env.exe git push`, `/usr/bin/sudo git push`,
   `/usr/bin/nohup git push`, `/usr/bin/env terraform apply`,
   `/usr/bin/env aws secretsmanager get-secret-value` and
   `/usr/bin/env kubectl delete pod x` **all return `allow`**, while every
   bare-name spelling blocks. `/usr/bin/env` is the canonical POSIX spelling
   and `env.exe` is the Git-for-Windows one — the same argument CR-03 made for
   `git.exe`. No corpus row, no `docs/SAFETY.md` row.

Everything else in `<regression_hunt>` came back clean. Deny-by-default holds
on every branch I could reach: malformed/`null`/array/non-string input on all
seven tool names blocks; a throwing `currentBranchFor` oracle blocks; all four
`approve_ky_command` non-affirmative branches throw and leave no grant;
`writeAuditRow` swallows its own write failures so an audit failure cannot
convert a block into a swallowed hook exception. `RB-04-01` is still
`OUTSTANDING` in both `docs/RUNBOOK.md:862` and `:866`. Corpus honesty holds in
both directions (numbers below). No assertion was softened in the four
bootstrap-repo-refactored integration files — `templates-install.test.ts` case
5c still asserts non-zero exit, `"managed markers"` in stderr, a byte-identical
file and single markers; `bootstrap-safety-stub.test.ts` cases 6/7 still drive
the real generated stub through jiti in a real subprocess `cwd`.

### Verification of the eight iteration-2 findings

| ID | Verdict | Executed evidence |
|----|---------|-------------------|
| **CR-06** | **FIXED** (see CR-09 for the new location's own problem) | Two invocations of the real default export against two fresh `pi` objects in one process: load #1 `["bash","read","write","edit","approve_ky_command"]` / `["tool_call","session_start"]`, load #2 **identical**. `globalThis.__kyPiSafetyExtensionInstalled` and `resetSafetyInstalledForTests` appear nowhere in the tree. `/reload` no longer yields an empty tool list. |
| **CR-07** | **FIXED** (one residual, published) | `grep {path:"~/.aws"}` → `block` ("is at or above a sensitive location"); `ls {path:"~/.aws"}` → `block`; `grep {path:"C:/Users/tester"}` (`$HOME`) → `block`; `grep {path:["~/.aws/credentials"]}` → `block` (malformed); `find {path:"~/.ssh"}` → `block`; `grep {path:"C:/"}`, `{path:".."}`, `{path:"~/.aws/../.aws"}` → `block`. Absent `path` now evaluates against `projectRoot` (allows in a normal project, as designed). Only `glob:".env*"` still allows — published as **EV-65**. |
| **CR-08** | **PARTIALLY FIXED** | The three named shapes now block: `bash.exe -c "git push"`, `/bin/sh -c "git push"`, `/usr/bin/xargs git push` (plus `sh.exe -c "git push"`, `BASH -c`, `"/bin/sh" -c`). Paired negative `sh.exe -c "ls"` still allows. `git.exe -C /other/repo push` recovers its `cwdOverride` (oracle asked for `/other/repo`). **But** `resolveWrappers`' own gates were not routed — see **CR-10**. |
| **WR-09** | **FIXED** | `grep`/`find`/`ls` are no longer registered. Measured net per-turn delta over the exact `{type:"function",function:{name,description,parameters}}` shape: `bash` 0, `read` 0, `write` 0, `edit` 0 (byte-identical to Pi's own builtins, so first-registration-wins replacement is genuinely free), `approve_ky_command` **+275** (1099 bytes) — **total 275**, exactly what `contributing-boundary.test.ts:92-103` records. `grep`/`find`/`ls` measured at 260/154/118 = 532 tokens *not* paid. The BOOT-10 (b) justification is true again, verbatim, with no edit needed. `tool_call`'s filter still names all seven, so enforcement at the hook layer survives at zero schema cost. |
| **WR-10** | **FIXED** | `path-policy.test.ts`'s WR-10 block builds a genuinely backslash-rooted `HOME`/`PROJECT_ROOT` via the file's own `BS`/`winPath` helpers, asserts `toContain("shell rc file")` **and** `not.toContain("resolves outside the project root")` for `~/.bashrc` and the gitconfig equivalent, with a paired in-project allow. `path-canonicalisation.test.ts`'s false docstring claim is corrected and now names the file that actually carries the coverage. |
| **WR-11** | **FIXED** | `safety-entry.test.ts`'s WR-11 block drives the **registered** `approve_ky_command.execute()` for all three branches with a real seeded pending entry, asserting both the throw and `peek() === false`. I re-drove all four branches directly (including `select() -> "Approve "` with a trailing space and `select()` throwing): every one THREW with no grant created. `headless-deny.test.ts:70-79`'s false claim is corrected. |
| **WR-12** | **FIXED** | Drove the real `tool_call` hook: issue 1 → BLOCK (mints pending), `approve()`, issue 2 → DEFER (`undefined`), issue 3 → **BLOCK**, issue 4 → BLOCK. Approval protocol still one-shot and command-bound: with a fresh grant present, presenting `terraform destroy` at the wrapper THREW while the original grant survived (SAFE-09); the wrapper then consumed the grant once (reached the real bash, `terraform: command not found`) and the second identical call blocked. `HOOK_DEFER_TTL_MS = 5_000`, swept in `sweepExpired`, cleared by `consume()`. |

### Final evasion-suite numbers (executed)

Driven through the real `evaluate()` with `home = C:/Users/tester`,
`projectRoot = C:/repo`, `HEAD = main`:

```
total corpus cases          : 65
blocked by real evaluate()  : 53
NOT blocked (allow)         : 12
bucket mismatches           : none
not-blocked ids             : EV-09 EV-27 EV-35 EV-36 EV-38 EV-39 EV-40 EV-41 EV-42 EV-56 EV-57 EV-65
OUT-OF-SCOPE ids in corpus  : (identical set)
EV ids in docs/SAFETY.md    : (identical set)
in doc but not OUT-OF-SCOPE : []
OUT-OF-SCOPE but not in doc : []
not-blocked but not in doc  : []
```

The limitations table lists **exactly** the not-blocked set, in both
directions. No row was re-bucketed, softened, or moved to `OUT-OF-SCOPE` to
appear caught. The caveat is that this inventory does not *cover* CR-10's
shapes at all — they are absent from the corpus, so the table's own
completeness claim is honest about what it contains but the artifact is
incomplete as a coverage inventory.

## Critical Issues

### CR-09: the CR-06 relocation reintroduces a total fail-open in the UNTRUSTED-project case — headless, neither copy of the guard loads

**File:** `bin/bootstrap.sh:865-877`, `:919-925`;
`tests/integration/bootstrap-safety-stub.test.ts:416-446`
**Blocks the phase:** yes. This is a real defect, not a documented limitation —
nothing in `docs/SAFETY.md` mentions it.

**Issue.** The generated stub decides whether to register by asking whether the
project-scoped copy *exists on disk*:

```ts
if (existsSync(join(process.cwd(), ".pi", "extensions", "safety", "index.ts"))) {
  return;
}
```

That is a proxy for "the project copy already registered", and it is wrong in
exactly the case SAFE-11 exists for. Verified at source in the installed
`@earendil-works/pi-coding-agent@0.84.1`:

- `dist/core/package-manager.js:1980` — project `.pi/extensions/` is
  auto-discovered **only** inside `if (projectTrusted) { … }`.
- `dist/core/resource-loader.js:256-257` — the pre-trust bootstrap pass
  explicitly "keeps project-local extensions/packages out".
- `dist/core/project-trust.js` — `resolveProjectTrusted` ends with
  `if (!options.projectTrustContext.hasUI) { return false; }`, reached whenever
  the trust store holds no decision for this cwd.
- `~/.pi/agent/trust.json` does not exist on this machine, so there is no
  persisted decision to short-circuit that.

So for `--mode json`, `-p`, or any spawned subagent with `cwd` inside this
repository: the project copy is filtered out for lack of trust, the user-scope
stub finds the file on disk and returns, and **nothing registers**. Executed —
the real generated stub shape driven through jiti with `cwd` = the repo root:

```
cwd=C:\Users\Admin\Documents\ky-pi-agent
  tools : []
  events: []
```

`bin/bootstrap.sh:839-843` states this exact hazard as the reason the
user-scope install exists: *"Project-scoped extensions never load without an
interactive trust grant … so a headless subagent silently never loads a
project-scoped guard, and the absence reads as 'nothing dangerous happened'
rather than 'the guard was absent'. That is exactly the failure signature this
function closes."* After the CR-06 fix, it no longer closes it.

Two aggravating factors:

- **`bootstrap-safety-stub.test.ts` case 7 asserts this behaviour is correct**
  (`toEqual([])` when the file is present at cwd), so the suite now locks the
  fail-open in.
- **`headless-deny.test.ts` cannot catch it**: it uses
  `tests/helpers/session.ts#writeUserScopeShim`, which writes an
  **unconditional** `export { default } from "…"` — a different shape from what
  `install_safety_extension` now generates. The one test that proves headless
  enforcement works is testing a shim production no longer writes.

**Fix.** The stub must not infer "already registered" from a file's existence.
Two workable shapes:

1. Have the stub register unconditionally, and dedupe on a marker Pi rebuilds
   per runner build rather than on `globalThis` — e.g. have the *project* copy
   set a flag on the `pi` object it is handed (`(pi as any).__kySafetyInstalled`),
   which the stub then checks. `ExtensionAPI` instances are per-runner-build,
   so this distinguishes the WR-07 double-load from `/reload` correctly, unlike
   `globalThis`, and is correct under untrusted-project too (the project copy
   never runs, never sets the flag, so the stub registers).
2. Or accept a duplicate `tool_call` hook as the lesser evil (it produces
   duplicate audit rows and a double block, never a missed block) and drop the
   dedup entirely — WR-07 was a *warning* about noisy audit rows; CR-09 is a
   *blocker* about zero enforcement, and trading the second for the first is
   backwards.

Whichever is chosen: add an integration case that drives the generated stub
with `cwd` = a directory that *does* contain `.pi/extensions/safety/index.ts`
but where the project copy was **not** loaded, and assert the stub registers.
Then point `tests/helpers/session.ts#writeUserScopeShim` at the same bytes
`install_safety_extension` writes, so `headless-deny.test.ts` exercises
production's shim rather than a simplified one.

---

### CR-10: `resolveWrappers`' three bare-verb gates were not routed through `normaliseExecutable` — `/usr/bin/env git push` and `env.exe git push` are ALLOWED

**File:** `.pi/extensions/safety/shell.ts:585-587`, `:610`, `:626` (contract
stated at `:330-333`)
**Blocks the phase:** yes. Same class as CR-03/CR-08, both of which this
project already ruled blocker-tier; and unlike EV-27/EV-65 this one is not
published anywhere.

**Issue.** `normaliseExecutable`'s docstring says every caller gating on a bare
verb name must route through it. `resolveWrappers` gates on four bare verb
names and routes through none of them:

```ts
const lower = word.toLowerCase();       // :585-586
if (lower === "env")  { … }             // :587
if (lower === "sudo") { … }             // :610
if (PASSTHROUGH_WRAPPERS.has(lower)) { … } // :626
```

A path-qualified or `.exe`-suffixed wrapper is therefore never recognised as a
wrapper. The loop breaks immediately, `executable` becomes the *wrapper's own
path*, the real verb lands in `args`, and neither the git/glab gate
(`policy.ts:354,360`), the infra gate (`infra.ts:420-427`) nor the shell-runner
rule ever sees it. Executed against the real `evaluate()` with
`currentBranchFor: () => "main"`, `protectedBranches: ["main","master"]`:

```
env git push                                                   block    exe=git
/usr/bin/env git push                                          allow    exe=/usr/bin/env
env.exe git push                                               allow    exe=env.exe
env sh -c "git push"                                           block    (shell-runner)
/usr/bin/env sh -c "git push"                                  allow    exe=/usr/bin/env
sudo git push                                                  block    exe=git
/usr/bin/sudo git push                                         allow    exe=/usr/bin/sudo
nohup git push                                                 block    exe=git
/usr/bin/nohup git push                                        allow    exe=/usr/bin/nohup
env terraform apply                                            confirm  exe=terraform
/usr/bin/env terraform apply                                   allow    exe=/usr/bin/env
env kubectl delete pod x                                       confirm  exe=kubectl
/usr/bin/env kubectl delete pod x                              allow    exe=/usr/bin/env
/usr/bin/env aws secretsmanager get-secret-value --secret-id x allow    exe=/usr/bin/env
```

`/usr/bin/env` is the canonical POSIX spelling — it is not adversarial, and
`shell.ts`'s own module docstring already names `env -i git push` and
`sudo -u root git push` as the shapes wrapper resolution exists to handle
(EV-44, EV-45 in the corpus, both in the bare spelling only). This defeats
SAFE-04, SAFE-05, SAFE-06 and SAFE-07 in one line each, and
`docs/SAFETY.md` publishes no limitation covering it.

**Fix.** Route all three, in the same commit as corpus rows:

```ts
// shell.ts#resolveWrappers
while (i < values.length) {
    const word = values[i];
    const verb = normaliseExecutable(word);   // not word.toLowerCase()

    if (verb === "env")  { wrappers.push("env");  /* … */ continue; }
    if (verb === "sudo") { wrappers.push("sudo"); /* … */ continue; }
    if (PASSTHROUGH_WRAPPERS.has(verb)) { wrappers.push(verb); /* … */ continue; }
    break;
}
```

Add `/usr/bin/env git push`, `env.exe git push`, `/usr/bin/sudo git push` and
`/usr/bin/env terraform apply` as `BLOCKED` corpus rows in the
`executable-normalisation` class next to EV-58..EV-60, plus a paired negative
(`/usr/bin/env echo hi` → allow) so the rule cannot degenerate. Then add a
`shell-parse.test.ts` `WRAPPER_TABLE` assertion that every wrapper name is
compared post-normalisation, so the fourth call site cannot be missed the way
this one was.

## Warnings

### WR-13: the BUG-01 regression guard fires but does not fail the run — `npx vitest run` exits 0 with the tripwire tripped

**File:** `tests/global-teardown.ts:107-117`; `vitest.config.ts:19`
**Issue.** The guard's logic is correct and genuinely non-vacuous — I proved
that by adding a throwaway test that appends to the tracked `.env.example`:

```
Test Files  1 passed (1)
      Tests  1 passed (1)
error during close Error: tests/global-teardown.ts: the test suite left tracked file(s) modified …
  .env.example
```

But the process exit code is **0**, confirmed twice on separate runs
(`raw exit code: 0`). Vitest reports a `globalSetup` teardown throw as an
`error during close` on stderr and does not translate it into a failing exit
status. So in CI, and for any `npm test && …` chain, the tripwire is
decorative: the exact regression it was written to catch would ship green.

The fix report's own proof stopped at "the run's `error during close` failed on
global teardown" — it observed the message and never checked the status code.
That is the same shape as the coverage-claim defects this phase has now caught
three times: a test that appears to gate and does not.

**Fix.** Do not rely on a teardown throw for the gate. Either assert inside a
real test file that runs last, or make the teardown record its verdict to a
file that a `tests/unit/zz-tracked-files-clean.test.ts` reads and asserts on.
Simplest reliable shape:

```ts
// tests/global-teardown.ts — in the teardown closure
if (newlyDirtied.length > 0) {
    process.exitCode = 1;                 // survives vitest swallowing the throw
    console.error(message);
    throw new Error(message);             // keep the throw for the human-readable output
}
```

Then re-run the throwaway-dirty-file probe and assert the **exit code**, not
just the message, before calling it proven.

### WR-14: `SENSITIVE_SEARCH_ROOT_SEGMENTS` matches any `.aws`/`.kube`/`.ssh`/`.gnupg` segment anywhere in the path, and an absent `path` blocks outright when the session root is `$HOME`

**File:** `.pi/extensions/safety/paths.ts:535-541`;
`.pi/extensions/safety/policy.ts:499-502`
**Issue.** Two false-positive shapes the CR-07 fix introduces, both fail-closed
(so not security defects) but both of the "annoying enough to get the guard
disabled" class `04-CONTEXT.md`'s `<specifics>` names as the real risk:

- `isSensitiveSearchRoot` uses `parts.some(part => SENSITIVE_SEARCH_ROOT_SEGMENTS.has(...))`,
  so a legitimate in-project path containing a `.ssh` or `.aws` segment
  anywhere — `C:/repo/tests/fixtures/.ssh/known_hosts_fixture`,
  `node_modules/<pkg>/.aws/` — is denied. Every other rule in `paths.ts` is
  careful to anchor its segment match (`hasSegmentPair`, `parentDirOf`); this
  one is not.
- `evaluateSearchRootField` maps an absent `path` to `facts.projectRoot`, and
  `isSensitiveSearchRoot`'s `isWithinRoot(facts.home, canonicalPath)` half
  returns `true` when `projectRoot === home`. Executed: with
  `projectRoot = home`, a bare `grep {pattern:"x"}` / `find {}` / `ls {}`
  blocks. A session opened directly in `$HOME` therefore cannot list anything.

Impact today is nil because `grep`/`find`/`ls` are not active (WR-09), which is
precisely why this is a WARNING and not a blocker — but it becomes live the
moment anything activates them.
**Fix.** Anchor the segment test to a path that is at or under `$HOME`
(`isWithinRoot(canonicalPath, facts.home) && parts.some(...)`), and exempt the
absent-`path` case when `projectRoot === home` (a search rooted at the session's
own project root is the tool's documented default and blocking it is not a
defensible reading of SAFE-06).

## Info

### IN-01: the corpus's own prose still says `evaluate()` governs four tool names

**File:** `tests/fixtures/evasion-corpus.ts:57-62`, `:570`
Carried unchanged from iteration 2 (info-tier, correctly outside
`fix_scope: critical_warning`). The module docstring still reads *"Every row but
one uses `bash`/`read`/`write`/`edit` — the four tool names `evaluate()`
actually governs"*, which is now false in both halves: the corpus contains
`grep`/`find`/`ls` rows (EV-52..EV-55, EV-61..EV-65) and `policy.ts` governs
seven. EV-42's `why` likewise still says "a fifth tool name".
**Fix:** say seven; EV-42's `why` should read "an eighth tool name it does not
recognise".

### IN-02: `docs/SAFETY.md`'s EV-42 row says "a sixth-party tool name"

**File:** `docs/SAFETY.md:144`
An artifact of the four→seven rewrite ("sixth" was correct when the list held
five names). Should read "an eighth tool name".

### IN-03: the stub currently installed on this machine is the PRE-CR-06 shape

**File:** `~/.pi/agent/extensions/ky-safety/index.ts` (not tracked)
The live stub is still the unconditional `export { default } from "…"` —
`bin/bootstrap.sh` has not been re-run since `c3f5d2c`. Two consequences worth
recording so a later reader does not misread the machine's behaviour: the
WR-07 double-load is live here today, and CR-09's fail-open is *not* yet live
here (the old stub registers regardless of trust). Re-running
`sh bin/bootstrap.sh` is what switches the machine from the first state to the
second — do not do that until CR-09 is fixed.

### IN-04: audit rows for a `grep` blocked on its `glob` still record an empty `command`

**File:** `.pi/extensions/safety/index.ts:211-223`
Carried from iteration 2 (IN-04, info-tier, out of fix scope).
`extractCommandOrPath` reads `record.path` for every non-`bash` tool, so a
blocked `grep { pattern: "=", glob: ".env" }` writes `command: ""` — losing the
exact field that caused the block.
**Fix:** for `grep`, fall back to `glob`, then `pattern`.

### IN-05: accepted-and-documented limitations (no action required)

**File:** `docs/SAFETY.md:125-147` ("Known bypasses this guard does not catch"),
lines `:136` (EV-09), `:137` (EV-27), `:138-144` (EV-35, EV-36, EV-38, EV-39,
EV-40, EV-41, EV-42), `:145` (EV-56), `:146` (EV-57), `:147` (EV-65); plus
`docs/SAFETY.md:96-123` ("What this guard does not register (WR-09)") and
`:167-182` (T-04-08 load order).

All twelve not-blocked corpus rows are published there, driven through the real
`evaluate()` by `evasion-corpus.test.ts`'s Group A′ so the published limit
cannot go stale silently, and cross-checked in both directions by Group B. The
new `EV-65` (`grep { glob: ".env*" }`) is a legitimate disposition for this
phase. `docs/SAFETY.md` does not over-claim anywhere I could falsify it — its
opening line still says "a **mistake-catcher, not a security boundary**", the
`grep`/`find`/`ls` bullet (`:59-75`) now correctly narrows to what
`isSensitiveSearchRoot` actually does and explicitly names the glob wildcard as
a published gap, and the WR-09 section honestly states that `grep`/`find`/`ls`
get hook-only, single-layer enforcement. Recorded here so a later reader does
not mistake any of it for an omission.

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — iteration 3, FINAL re-review_
