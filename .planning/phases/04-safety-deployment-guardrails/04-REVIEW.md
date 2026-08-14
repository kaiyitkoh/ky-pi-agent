---
phase: 04-safety-deployment-guardrails
reviewed: 2026-08-14T09:20:00Z
depth: standard
iteration: 2
files_reviewed: 24
files_reviewed_list:
  - .pi/extensions/safety/approvals.ts
  - .pi/extensions/safety/audit.ts
  - .pi/extensions/safety/git.ts
  - .pi/extensions/safety/index.ts
  - .pi/extensions/safety/infra.ts
  - .pi/extensions/safety/paths.ts
  - .pi/extensions/safety/policy.ts
  - .pi/extensions/safety/schema.ts
  - .pi/extensions/safety/shell.ts
  - .pi/lib/jsonl.ts
  - docs/RUNBOOK.md
  - docs/SAFETY.md
  - tests/fixtures/evasion-corpus.ts
  - tests/integration/audit-concurrency.test.ts
  - tests/integration/confirm-approve-reissue.test.ts
  - tests/integration/double-enforcement.test.ts
  - tests/integration/headless-deny.test.ts
  - tests/integration/path-canonicalisation.test.ts
  - tests/unit/approvals.test.ts
  - tests/unit/contributing-boundary.test.ts
  - tests/unit/evasion-corpus.test.ts
  - tests/unit/git-policy.test.ts
  - tests/unit/infra-policy.test.ts
  - tests/unit/path-policy.test.ts
  - tests/unit/policy-compose.test.ts
  - tests/unit/safety-entry.test.ts
  - tests/unit/shell-parse.test.ts
findings:
  critical: 3
  warning: 4
  info: 5
  total: 12
status: issues_found
---

# Phase 4: Code Review Report (iteration 2 — re-review after `--fix`)

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

The suite is green (212/212 across the nine safety files I re-ran) and the fix
report claims 13/13. By execution, **7 of 13 are genuinely fixed, 2 are
partially fixed and still exploitable, 1 is honestly accepted-and-published,
and 3 are fixed in code but whose claimed test coverage does not exist.** The
fix pass also introduced one new fail-open that is strictly worse than the
finding it closed.

Verified fixed by re-running the original executed evidence: **CR-01** (the
confirm→approve→re-issue protocol now completes, is one-shot at the wrapper, and
a mutated command after approval still blocks — all four steps executed below),
**CR-02** (both halves: a write inside a native-backslash project root is now
allowed, and `~/.bashrc` now blocks via the *bashrc* rule rather than
accidentally via containment), **CR-05** (refspec checked independently of
`HEAD`, with the paired negative holding), **WR-03**, **WR-04**, **WR-05**,
**WR-06**. `RB-04-01` is still `OUTSTANDING` in both `docs/RUNBOOK.md:862` and
`:866` — not flipped.

The three blockers below are all things I executed against the real modules:

1. **CR-06 (new, introduced by the WR-07 fix):** the `globalThis` "already
   installed" flag makes the safety extension a permanent process-wide no-op
   after its first load. Pi's `/reload` calls the factory again with a fresh
   `api` in the same process, so **after any `/reload` the session runs with
   Pi's unwrapped built-in `bash`/`read`/`write`/`edit` and no `tool_call`
   hook at all.** Executed: second install registers `[]` tools and `[]` hooks.
2. **CR-07 (CR-04 partially fixed):** `evaluateGrep` catches exactly the two
   literal examples I wrote in the last review and nothing else. Proven end to
   end against the real Pi `grep` tool: `grep { pattern:
   "aws_secret_access_key", path: "~/.aws" }` → verdict `allow`, and the tool
   returns `aws_secret_access_key = SUPERSECRET123` into model context.
   `docs/SAFETY.md:59-63` now claims this surface is "governed by the same
   table `read` uses", which it is not.
3. **CR-08 (CR-03 partially fixed):** `normaliseExecutable` was added and wired
   into `policy.ts`/`infra.ts` — but `shell.ts`'s own two bare-verb gates
   (`findShellRunnerDenial`, `extractGitCwdOverride`) still compare raw
   `.toLowerCase()`. Executed: `bash.exe -c "git push"`, `/bin/sh -c "git
   push"`, `sh.exe -c "git push"` and `/usr/bin/xargs git push` all return
   `allow`, while their bare-name spellings block.

Separately, the CR-04 fix has a cost the phase never accounted for: Pi's
default active tool set is `["read","bash","edit","write"]`
[`dist/core/sdk.js:132,136`] — `grep`/`find`/`ls` are registered but **not
active**. Registering them as extension tools *activates* them
(`_refreshToolRegistry`'s `includeAllExtensionTools: true`,
`agent-session.js:158-161`, `:1993-2003`), adding a measured **532 tokens per
turn** while `contributing-boundary.test.ts:100-104` still records the BOOT-10
justification "the four WRAPPED tools … add ZERO net schema cost". See WR-09.

Finally, the fix pass repeated the exact defect that let CR-01 ship in the
first place: an untrue coverage claim in a test docstring.
`headless-deny.test.ts:70-79` is **byte-for-byte unchanged** and still points
at two files that do not cover the confirm path, and the new
`path-canonicalisation.test.ts:42-48` asserts that CR-02's fail-open half "is
proven at the `paths.ts`/`policy.ts` unit level" in two files that contain no
backslash-rooted fixture at all. See WR-10 and WR-11.

## Verification of the 13 prior findings

| ID | Verdict | Executed evidence |
|----|---------|-------------------|
| CR-01 | **FIXED** | Drove the real hook + real wrapper: issue → `BLOCK` with request id; `approve()`; retry → hook returns `undefined` (defer); wrapper → real bash ran (`terraform: command not found`, i.e. the *tool's* error, not the guard's); 2nd retry → hook `BLOCK` again and wrapper throws the confirm reason; a **mutated** command presented after approval → wrapper blocks. One-shot holds, not a permanent allowlist. |
| CR-02 | **FIXED** (both halves) | With real `ctx.cwd`/`homedir()`: pre-fix shape blocks `write src/index.ts` as "resolves outside the project root" and blocks `~/.bashrc` for the *wrong* reason; post-fix `write src/index.ts` → `allow`, `~/.bashrc` → block *"is the user's shell rc file"*, `~/.gitconfig`/`~/.bash_profile` likewise. Test coverage of the fail-open half is missing — see WR-10. |
| CR-03 | **PARTIALLY FIXED** | `git.exe push`, `/usr/bin/git push`, `./git push`, `terraform.exe apply`, `kubectl.exe delete`, `aws.exe secretsmanager get-secret-value`, `glab.exe mr merge`, `env git.exe push` all now non-allow. But `bash.exe -c "git push"`, `/bin/sh -c "git push"`, `/usr/bin/xargs git push` still `allow`. See **CR-08**. |
| CR-04 | **PARTIALLY FIXED** | The four corpus rows (EV-52..EV-55) block. `grep { path: "~/.aws" }`, `grep { glob: ".env*" }`, `grep { pattern }` with no path, `ls { path: "~/.aws" }` all `allow`; the first proven to return real credential text. See **CR-07**. |
| CR-05 | **FIXED** | On `feature/x`: `git push origin HEAD:main`, `git push --force origin main`, `git push origin feature/x:main`, `git push origin refs/heads/main` → `block`; `git push origin feature/x` → `allow` (paired negative holds). |
| WR-01 | **ACCEPTED-AND-DOCUMENTED** | EV-56 (`.env::$DATA`) / EV-57 (`ENV~1`) added as `OUT-OF-SCOPE`; published at `docs/SAFETY.md:104-105`; Group A' now asserts both genuinely return `allow`, so the limit cannot go stale silently. Legitimate outcome. |
| WR-02 | **FIXED** | Every delegate is now built per call from `ctx.cwd`; the registration-time instance is metadata only. Verified `createLocalBashOperations` holds no per-instance state (`core/tools/bash.js:43-68`), so per-call construction is genuinely free and loses no shell state. |
| WR-03 | **FIXED** | Group A' drives every `OUT-OF-SCOPE` row through the real `evaluate()` and asserts `allow`. Corpus diff since `e30e44e` shows **no** row re-bucketed BLOCKED→OUT-OF-SCOPE; the 11 doc rows and 11 corpus rows match in both directions. |
| WR-04 | **FIXED** | Both children now `import { writeAuditRow }` from the real `audit.ts` via `pathToFileURL`. Residual oracle weakness noted as IN-02. |
| WR-05 | **FIXED** | `sweepExpired()` at the top of `createPending()`; `approvals.test.ts` inspects the raw `globalThis` store so it distinguishes "swept" from "expired but present". |
| WR-06 | **FIXED** | On protected `main`: `git -C /repo status`, `git --no-pager log`, `git -c user.name=x diff` → `allow`; `git -C /repo push` → still `block`. |
| WR-07 | **REGRESSED** | The cure disables the whole guard after `/reload`. See **CR-06**. |
| WR-08 | **PARTIALLY FIXED** | Three of four bullets are now true. The sensitive-read bullet (`docs/SAFETY.md:59-63`) became a **new** over-claim about `grep` — see CR-07. |

## Critical Issues

### CR-06: the WR-07 idempotency guard silently disables the entire safety extension after `/reload`

**File:** `.pi/extensions/safety/index.ts:720`, `:739-751`
**Issue:** The default export sets `globalThis.__kyPiSafetyExtensionInstalled = true`
on first run and returns immediately on every subsequent run **for the lifetime
of the process**. Pi's `/reload` is a second run in the same process:
`AgentSession#reload` (`dist/core/agent-session.js:2052`) builds a brand-new
`ExtensionRunner` and a brand-new tool registry, then `loadExtension` calls
`await factory(api)` again with a fresh `api`
(`dist/core/extensions/loader.js:409`). The module itself may come from
`extensionCache`, but the *factory is still invoked* — and it now no-ops.

Executed, against the real entry point:

```
load #1 tools : ["bash","read","write","edit","grep","find","ls","approve_ky_command"]
load #1 events: ["tool_call","session_start"]
load #2 tools : []          <-- this is what /reload gets
load #2 events: []
```

After a `/reload` the session therefore runs with Pi's **unwrapped** built-in
`bash`/`read`/`write`/`edit` (`_refreshToolRegistry` repopulates them from
`_baseToolDefinitions`) and **no `tool_call` hook**. Both enforcement layers are
gone, silently, with no error anywhere. That is strictly worse than the
duplicate audit rows WR-07 asked to fix. `/reload` is not a corner case here —
CLAUDE.md's stack table names it explicitly ("a build step … breaks `/reload`")
and Phase 1 shipped a dedicated `/reload` structural-precondition test.

Two further consequences of putting the flag on `globalThis`:

- Any other extension loaded earlier that happens to write
  `globalThis.__kyPiSafetyExtensionInstalled = true` disables this guard
  entirely. A security control should not expose a global kill switch.
- `resetSafetyInstalledForTests()` is exported production code whose only
  purpose is to defeat the guard, and three test files now have to call it
  (`safety-entry.test.ts:71,238,276`, `double-enforcement.test.ts:187,229,293`,
  `confirm-approve-reissue.test.ts:159`, `path-canonicalisation.test.ts:103`).
  That churn is the design telling you the flag is at the wrong scope.

**Fix:** do not dedupe at process scope. The duplicate-load hazard is
specifically *two paths registering in one runner build*; `/reload` is *one path
registering in a new runner build*, and a process-wide flag cannot tell them
apart. Two workable options:

1. Move the guard into the user-scope stub, where it belongs. Have
   `bin/bootstrap.sh#install_safety_extension` emit a stub that no-ops when the
   project copy is present:

```ts
// ~/.pi/agent/extensions/ky-safety/index.ts (generated)
import { existsSync } from "node:fs";
import { join } from "node:path";
export default async function (pi) {
    // The project-scoped copy is auto-discovered and registers first; loading
    // this stub as well would register a SECOND tool_call handler.
    if (existsSync(join(process.cwd(), ".pi", "extensions", "safety", "index.ts"))) return;
    (await import("<repo>/.pi/extensions/safety/index.ts")).default(pi);
}
```

2. Or, if the guard must stay in `index.ts`, key it on something Pi recreates
   per runner build rather than on `globalThis` — and add a test that models
   `/reload` (two invocations that MUST both register) alongside the existing
   test that models the double load (two invocations where the second must not).
   The current `safety-entry.test.ts:274-308` only asserts the second case, so
   it locks in the bug.

Either way this needs an integration test that runs `pi` and issues `/reload`,
then asserts an audit row still appears for a subsequent blocked command.

---

### CR-07: `grep` is still a working credential-exfiltration path — the CR-04 fix covers only the two literal examples from the last review

**File:** `.pi/extensions/safety/policy.ts:454-526`; `docs/SAFETY.md:59-63`
**Issue:** `evaluateGrep` canonicalises `path`/`glob` and runs them through
`classifyPathRead`, whose patterns match on **basename + parent segment**
(`paths.ts:370-403`). `grep`'s `path` is documented as *"Directory or file to
search (default: current directory)"* (`dist/core/tools/grep.js`, `grepSchema`),
so a directory never matches any pattern while grep happily recurses into it and
returns file **contents**.

Executed end to end against the real `createGrepTool`, with a fixture home
containing `.aws/credentials`:

```
safety verdict for grep over the .aws DIRECTORY: allow
grep output contains the secret: true
--- output ---
credentials:2: aws_secret_access_key = SUPERSECRET123
```

The same probe run against `evaluate()` shows how narrow the coverage is:

```
grep {"pattern":".","path":"~/.aws/credentials"}                 block   <- the review's example
grep {"pattern":"=","glob":".env"}                               block   <- the review's example
grep {"pattern":"aws_secret_access_key","path":"~/.aws"}         allow
grep {"pattern":"...","path":"C:/Users/tester/.aws/"}            allow
grep {"pattern":"SECRET","glob":".env*"}                         allow
grep {"pattern":"SECRET"}                                        allow   (no path = whole tree)
grep {"pattern":"password","path":"C:/Users/tester"}             allow
ls   {"path":"~/.aws"}                                           allow
grep {"pattern":"x","path":["~/.aws/credentials"]}               allow   (non-string path silently ignored)
```

For contrast, `read { path: "~/.aws/credentials" }` and `bash { command: "cat
~/.aws/credentials" }` both block. So the guard is materially weaker on the
surface the fix claims to have closed than on the ones it already covered.

The honesty failure compounds it. `docs/SAFETY.md:59-63` now reads *"block
through the `read` tool directly, quoted bash arguments, and `grep`'s own
`path`/`glob` parameters (`grep`/`find`/`ls` … are governed by the same table
`read` uses)"*, and `tests/fixtures/evasion-corpus.ts` has **no**
`OUT-OF-SCOPE` row for any of the shapes above. SAFE-15's contract is that an
unpublished limit is the vulnerability; this is an unpublished limit created by
a fix.

**Fix (both halves, as before):**
1. Make `evaluateGrep`/`evaluateFindOrLs` containment-aware rather than
   basename-aware — a `path` that is *at or above* any sensitive location must
   be denied, not just a path that *is* one:

```ts
/** Deny when the search root would reach a sensitive location, not only when it IS one. */
const SENSITIVE_DIR_SEGMENTS = [".aws", ".kube", ".ssh", ".gnupg"] as const;

function searchRootIsSensitive(canonicalPath: string, facts: PolicyFacts): boolean {
    const { parts } = rootedSegmentsOf(canonicalPath);          // export this from paths.ts
    if (parts.some((p) => SENSITIVE_DIR_SEGMENTS.includes(p.toLowerCase() as never))) return true;
    // A search root at or above $HOME reaches every one of them.
    return isWithinRoot(facts.home, canonicalPath);              // note the argument order
}
```
   and treat a *missing* `path` as "the project root" rather than as `allow`, so
   `grep { pattern }` is evaluated against the same rule as `grep { path: "." }`.
   A non-string `path`/`glob` should block as malformed, matching
   `read`/`write`'s own `extractStringField` posture, not be silently skipped.
2. Whatever remains uncovered after (1) — glob wildcards in particular — gets an
   explicit `OUT-OF-SCOPE` corpus row and a `docs/SAFETY.md` table row **in the
   same commit**, and the `:59-63` bullet must be narrowed to exactly what the
   code does.

---

### CR-08: the CR-03 normalisation was not applied to `shell.ts`'s own two bare-verb gates — `bash.exe -c "git push"` and `/bin/sh -c "git push"` are ALLOWED

**File:** `.pi/extensions/safety/shell.ts:642-645`, `:703-707` (contract stated
at `:330-333`)
**Issue:** `normaliseExecutable` (`shell.ts:335-338`) says in its own docstring:
*"Every caller that gates on a bare verb name … MUST route through this function
rather than reading `invocation.executable` directly."* Two callers inside
`shell.ts` itself do not:

- `findShellRunnerDenial` (`:705`) — `SHELL_RUNNERS.has(inv.executable.toLowerCase())`
- `extractGitCwdOverride` (`:643`) — `executable.toLowerCase() !== "git"`

Executed against the real `evaluate()` with `currentBranchFor: () => "main"`,
`protectedBranches: ["main"]`:

```
bash -c "git push"            block   (shell-runner)
bash.exe -c "git push"        allow
/bin/sh -c "git push"         allow
sh.exe -c "git push"          allow
/usr/bin/xargs git push       allow
```

`/bin/sh -c` and `bash.exe` are not adversarial spellings — they are ordinary
Git-Bash-on-Windows spellings, the same argument CR-03 made for `git.exe`.
`shell.ts`'s own module docstring names `sh -c "git push"` and `xargs git push`
as the exact shapes the shell-runner rule exists to catch, and
`docs/SAFETY.md:36-39` publishes that claim without qualification. The
`extractGitCwdOverride` miss is quieter but real: `git.exe -C /other/repo push`
loses its `cwdOverride`, so the `HEAD` oracle is asked about the *wrong*
repository.

**Fix:** route both through the shared helper, in the same commit as corpus rows.

```ts
// shell.ts
function extractGitCwdOverride(executable: string, args: readonly string[]): string | undefined {
    if (normaliseExecutable(executable) !== "git") return undefined;
    // ...
}

function findShellRunnerDenial(invocations: readonly CanonicalInvocation[]): CanonicalInvocation | undefined {
    return invocations.find(
        (inv) => SHELL_RUNNERS.has(normaliseExecutable(inv.executable)) && GUARDED_VERB_PATTERN.test(inv.rawSegment),
    );
}
```

Add `bash.exe -c "git push"`, `/bin/sh -c "git push"` and `/usr/bin/xargs git
push` as `BLOCKED` corpus rows next to EV-44..EV-51, and a `sh.exe -c "ls"` →
allow paired negative so the rule cannot degenerate.

## Warnings

### WR-09: wrapping `grep`/`find`/`ls` ACTIVATES three tools Pi does not activate by default, at a measured 532 tokens/turn, against a stale BOOT-10 justification

**File:** `.pi/extensions/safety/index.ts:400-427`;
`tests/unit/contributing-boundary.test.ts:83-112`
**Issue:** My own CR-04 called `grep`/`find`/`ls` "default-active". Checked at
source, that was wrong: Pi 0.84.1's default active set is
`["read","bash","edit","write"]` (`dist/core/sdk.js:132,136`), and this
repository's `.pi/settings.json` is `{}`, so nothing overrides it.
`grep`/`find`/`ls` are *registered* but not *active* — the model cannot call
them. Registering them as **extension** tools flips that: `_refreshToolRegistry`
is invoked with `includeAllExtensionTools: true` at boot and on reload
(`agent-session.js:158-161`, `:2061-2064`) and pushes every extension tool into
the active set (`:1993-2003`).

So the fix handed the model three new callable tools in order to guard them —
and the guard is the incomplete one in CR-07. Measured cost, using this
project's own estimator (`chars/4`) over the exact
`{type:"function",function:{name,description,parameters}}` shape Pi sends:

```
grep  bytes=1039  ~tokens=260
find  bytes= 616  ~tokens=154
ls    bytes= 472  ~tokens=118            total 532 tokens/turn
```

That is ~2.9x the 275-token cost the phase measured and justified, on a project
whose stated core value is that the harness must not become the bottleneck.
Meanwhile `contributing-boundary.test.ts:100-104` still records, as the BOOT-10
(b) justification, *"The four WRAPPED tools (`bash`/`read`/`write`/`edit`) add
ZERO net schema cost: they are registrations of tools Pi already ships and would
already be serialised into every request whether or not this file wraps them"* —
now false in both the count and the claim. (One thing that is fine:
`createGrepTool`/`createFindTool`/`createLsTool` carry no `promptSnippet` or
`promptGuidelines`, verified at runtime, so no system-prompt rebuild.)

**Fix:** decide deliberately and record it. Either (a) keep the wrappers and
update the (b) justification with the seven tool names and the measured 532
tokens, accepting the cost explicitly; or (b) do not register `grep`/`find`/`ls`
as tools at all — leave them inactive, keep only the `tool_call` hook's
tool-name filter covering them (which costs nothing and still audits/denies if
a future session activates them), and say so in `docs/SAFETY.md`. Option (b) is
cheaper and strictly safer given CR-07.

### WR-10: CR-02's fail-open half has no test, and the new test's docstring claims otherwise

**File:** `tests/integration/path-canonicalisation.test.ts:40-48`;
`tests/unit/path-policy.test.ts:41-43`; `tests/unit/policy-compose.test.ts:32-40`
**Issue:** The original CR-02 fix asked for a backslash-rooted `PROJECT_ROOT`/
`HOME` fixture in both unit tables. Neither was added — `path-policy.test.ts`
still hardcodes `HOME = "C:/Users/Admin"` / `PROJECT_ROOT = "C:/Users/Admin/project"`
and `policy-compose.test.ts` still hardcodes `projectRoot: "C:/repo"`,
`home: "C:/Users/tester"`. The new integration test covers only the
*fail-closed* half (a write inside the project) and its own docstring says so —
then asserts:

> "The FAIL-OPEN half of CR-02 … is proven at the `paths.ts`/`policy.ts` unit
> level instead (`tests/unit/path-policy.test.ts`, `tests/unit/policy-compose.test.ts`)"

That is not true of either file. This is the same defect as
`headless-deny.test.ts:70-79` — the unverified coverage claim that let CR-01
ship — reproduced one iteration later. The code is correct (executed above:
`~/.bashrc` now blocks via the `bashrc` rule with a real `homedir()`), but
nothing in the suite would notice if `toCanonicalRoot(homedir())` were reverted
to `homedir()`, because `classifyPathWrite`'s containment rule blocks
`~/.bashrc` anyway — for the wrong reason.
**Fix:** add a second `describe` to `path-policy.test.ts` whose `HOME`/
`PROJECT_ROOT` are built with the file's existing `BS` helper
(`String.fromCharCode(92)`), and assert on the block **reason** (`"is the user's
shell rc file"`), not merely on `kind === "block"` — the reason string is the
only thing that distinguishes the detonation rule from the containment rule.
Then delete the false claim from `path-canonicalisation.test.ts`'s docstring.

### WR-11: `approve_ky_command.execute()` has zero test coverage, and `headless-deny.test.ts`'s false coverage claim is unchanged

**File:** `tests/integration/headless-deny.test.ts:70-79`;
`.pi/extensions/safety/index.ts:499-577`
**Issue:** `headless-deny.test.ts` is not in the diff since `e30e44e` — its
claim that the confirm/`approve_ky_command` path "is unit-proven in
`tests/unit/safety-entry.test.ts` and `tests/integration/double-enforcement.test.ts`"
is still there and still false. The fix report says
`confirm-approve-reissue.test.ts` makes it true, but that file's own docstring
(`:21-34`) explicitly states it bypasses `approve_ky_command` and calls
`approve()` directly. Grepping the whole suite: no test ever invokes
`approve_ky_command`'s `execute()`. The three deny-by-default branches
T-04-03 names — `validate()` refusal, `hasUI === false`, and
`ctx.ui.select()` returning `undefined` — are unexercised.

I executed all three directly and they behave correctly:

```
hasUI=false (headless)       : THREW (refused)   grant created: false
hasUI=true, select -> "Deny" : THREW (refused)   grant created: false
hasUI=true, select -> undef  : THREW (refused)   grant created: false
```

So this is a coverage and honesty defect, not a live bug — but it is the single
branch where "approve only on an explicit affirmative" is enforced, on a public
repo whose SAFETY.md sells that property.
**Fix:** add three cases to `safety-entry.test.ts` driving the registered
`approve_ky_command` tool's `execute()` with a stub `ctx` for each of
`{hasUI:false}`, `{hasUI:true, ui:{select:()=>"Deny"}}`,
`{hasUI:true, ui:{select:()=>undefined}}`, asserting it throws AND that
`peek(requestKey)` is `false` afterwards. Then correct
`headless-deny.test.ts:70-79` to name the file that actually proves it.

### WR-12: the hook now defers on `peek`, so a grant can go unconsumed for its whole 10-minute TTL if this extension's wrapper is not what runs

**File:** `.pi/extensions/safety/index.ts:652-667`;
`.pi/extensions/safety/approvals.ts:259-266`
**Issue:** CR-01's fix moved the hook from "always block a `confirm`" to "return
`undefined` whenever an unexpired grant exists, and let the wrapper consume it".
The wrapper is the only consumer. If the tool that actually executes is *not*
this file's wrapper — the documented T-04-08 case where another extension wins
the `bash` name under first-registration-wins, or the CR-06 case where the
wrapper was never registered at all — then nothing consumes the grant, `peek()`
keeps returning `true`, and **every** re-issue of that exact command runs
unguarded until `APPROVAL_TTL_MS` expires. Before the fix, one approval could
never unblock anything; now one approval can unblock an unbounded number of
executions in a 10-minute window under a failure mode this project has already
written down as live.
**Fix:** make the deferral self-limiting. Have the hook stamp a short-lived
single-use "hook deferred" marker keyed on the same `requestKey` (a second map
in `approvals.ts`, TTL of seconds not minutes) and refuse to defer twice for the
same key without an intervening `consume()`. Add a test that calls the hook
twice with a grant present and no wrapper execution in between, asserting the
second call blocks.

## Info

### IN-01: `evaluate()` docstrings and corpus prose still say "exactly bash/read/write/edit"

**File:** `tests/fixtures/evasion-corpus.ts:55-62`, `:536`
**Issue:** The corpus module docstring ("Every row but one uses `bash`/`read`/
`write`/`edit` — the four tool names `evaluate()` actually governs") and EV-42's
`why` ("evaluate() governs exactly bash/read/write/edit by name — a fifth tool
name…") were not updated when EV-52..EV-55 added `grep`/`find`/`ls` rows.
`policy.ts` and `docs/SAFETY.md` both say seven.
**Fix:** update both strings to seven; EV-42's `why` should say "an eighth tool
name it does not recognise".

### IN-02: the audit-concurrency count assertion cannot falsify the held-descriptor hazard its docstring says it now catches

**File:** `tests/integration/audit-concurrency.test.ts:9-19`, `:434-454`
**Issue:** WR-04's real ask — children exercise the shipped writer — is met. But
the docstring goes further: *"A rewrite of `appendJsonl` that held a stream open
and lost every post-rotation record would have stayed GREEN here under the old
hand-rolled shape."* The new assertion sums records across the live file **and
every rotated fragment** (`:436-440`), and a held descriptor writes into the
renamed inode, which is still one of those fragments. Total would still be 200.
The actual control for that hazard remains `jsonl-append-only.test.ts`'s grep
ban, as the file's own note concedes.
**Fix:** either soften the docstring to what the oracle proves, or add an
assertion that the **live** file's own record count is non-zero after the final
rotation, which a stream-holding writer would fail.

### IN-03: CR-05's fixtures live only in `git-policy.test.ts`, not in the evasion corpus

**File:** `tests/fixtures/evasion-corpus.ts`
**Issue:** The CR-05 fix added four rows to `git-policy.test.ts` (good, and they
would go red on revert — the pre-fix verdict for all three positives was
`allow`), but `git push --force origin main` from a feature branch never enters
the corpus, so it is absent from the artifact SAFE-17 designates as the
guard's coverage inventory.
**Fix:** add it, plus `git push origin HEAD:main`, as `BLOCKED` rows with
`class: "different-repo"` or a new `refspec-target` class.

### IN-04: audit rows for `grep`/`find`/`ls` calls with no `path` record an empty `command`

**File:** `.pi/extensions/safety/index.ts:219-231`
**Issue:** `extractCommandOrPath` reads `record.path` for every non-`bash` tool.
A blocked `grep { pattern: "=", glob: ".env" }` therefore writes an audit row
whose `command` column is `""` — losing the exact field that caused the block.
**Fix:** for `grep`, fall back to `glob`, then to `pattern`, so the row can
explain itself later.

### IN-05: accepted-and-documented limitations (no action required)

**File:** `docs/SAFETY.md:104-105`; `tests/fixtures/evasion-corpus.ts:609-626`
WR-01's NTFS alternate-data-stream (`EV-56`) and 8.3 short-name (`EV-57`)
aliases are published as `OUT-OF-SCOPE` rows in the "Known bypasses" table and
are now driven through the real `evaluate()` by Group A', so the published limit
cannot go stale silently. This is a legitimate disposition for this phase and
does not block. Recorded here so a later reader does not mistake it for an
omission.

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — iteration 2, re-review after `--fix`_
