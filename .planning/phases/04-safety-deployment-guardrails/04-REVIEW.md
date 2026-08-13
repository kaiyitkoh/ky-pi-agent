---
phase: 04-safety-deployment-guardrails
reviewed: 2026-08-14T00:00:00Z
depth: standard
files_reviewed: 39
files_reviewed_list:
  - .pi/extensions/diagnostics/jsonl.ts
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
  - bin/bootstrap.sh
  - docs/RUNBOOK.md
  - docs/SAFETY.md
  - tests/fixtures/evasion-corpus.ts
  - tests/integration/audit-concurrency.test.ts
  - tests/integration/bootstrap-safety-stub.test.ts
  - tests/integration/double-enforcement.test.ts
  - tests/integration/git-head-main.test.ts
  - tests/integration/gitlab-push-protection.test.ts
  - tests/integration/headless-deny.test.ts
  - tests/integration/subagent-block.test.ts
  - tests/integration/user-scope-load.test.ts
  - tests/unit/approvals.test.ts
  - tests/unit/audit-jsonl.test.ts
  - tests/unit/contributing-boundary.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/evasion-corpus.test.ts
  - tests/unit/git-policy.test.ts
  - tests/unit/infra-policy.test.ts
  - tests/unit/jsonl-append-only.test.ts
  - tests/unit/logs-gitignored.test.ts
  - tests/unit/path-policy.test.ts
  - tests/unit/pinning.test.ts
  - tests/unit/policy-compose.test.ts
  - tests/unit/safety-entry.test.ts
  - tests/unit/shell-deny-list.test.ts
  - tests/unit/shell-parse.test.ts
  - tests/unit/unbash-ast.test.ts
findings:
  critical: 5
  warning: 8
  info: 0
  total: 13
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 39
**Status:** issues_found

## Summary

The parsing layer (`shell.ts`), the classifier tables (`git.ts`, `infra.ts`, `paths.ts`) and
the audit writer (`.pi/lib/jsonl.ts`, `safety/audit.ts`) are genuinely well built, and the
runbook/status machinery in `docs-policy.test.ts` is one of the few doc guards in this repo
that cannot be disarmed by deleting an id. `RB-04-01` is correctly OUTSTANDING in both the
summary table and the detail section.

But the suite is green because it never exercises the shapes the harness actually produces at
runtime. **Every** fixture in `path-policy.test.ts`, `policy-compose.test.ts` and
`evasion-corpus.test.ts` supplies a forward-slash `cwd`/`home`/`projectRoot` (`"C:/repo"`),
while `index.ts#buildFacts` feeds the real `ctx.cwd` and `os.homedir()`, which on the target
platform are backslash strings. Every fixture spells executables as bare lower-case words,
while Windows/Git Bash routinely produces `git.exe` and absolute-path invocations. I ran the
real modules against the real shapes; the results are in CR-02 and CR-03 and both are
reproducible in ten lines of Node.

Three of the five criticals are outright fail-OPEN (CR-03, CR-04, CR-05: a protected-branch
push, a mutating infra call and a secrets read all reach execution). One is fail-CLOSED but
harness-breaking (CR-02: `write`/`edit` are unusable on Windows). One kills the whole
approval protocol (CR-01: `approve_ky_command` cannot ever unblock anything — the hook never
consumes the grant it told the model to obtain).

Notably, `headless-deny.test.ts:70-79` claims the confirm/approve path "is unit-proven in
`tests/unit/safety-entry.test.ts` and `tests/integration/double-enforcement.test.ts`". Neither
file touches it. That unverified claim is what let CR-01 ship.

## Critical Issues

### CR-01: The confirm → approve → re-issue protocol can never complete; `approve_ky_command` is dead code

**File:** `.pi/extensions/safety/index.ts:543-559` (and `:246-256`)
**Issue:** The `tool_call` hook handles a `confirm` verdict by *unconditionally* calling
`createPending()` and returning `{ block: true }`. It never calls `consume()`. `consume()` is
only reached from `wrapperOutcome()` (`index.ts:246`), which only runs inside the wrapped
tool's `execute()` — and `execute()` is never reached, because the hook already blocked the
call.

Concrete failure: the model runs `terraform apply` → hook blocks with `request_id=A` → model
calls `approve_ky_command` → the human selects **Approve** → `approve()` stores a grant keyed
on `requestKey` → the model re-issues the identical `terraform apply` → the hook re-evaluates,
gets `confirm` again, mints a *fresh* pending `request_id=B`, and blocks again. Forever. Every
`confirm` verdict is a permanent block: `terraform apply|destroy|import|state rm|state mv|
taint|untaint|force-unlock|workspace delete`, every mutating `aws` call, `kubectl delete|apply|
replace|patch|scale|drain|cordon|exec`, and every unclassified terraform/kubectl verb
(`infra.ts:350-353`, `:391-394`). The 275-token schema cost justified in
`contributing-boundary.test.ts:92-103` buys nothing, and `granted`/`pending` grow one entry per
attempt with no sweep (see WR-05).

No test covers this: `safety-entry.test.ts` asserts registration shape only;
`double-enforcement.test.ts` uses `cat terraform.tfstate`, a hard `block`, never a `confirm`;
`headless-deny.test.ts:70-79` explicitly states the confirm path is out of scope while
asserting — incorrectly — that those two files prove it.

**Fix:** consume the grant in the hook, before minting a new pending, and keep the wrapper's
consume as the second layer:

```ts
if (verdict.kind === "confirm") {
    if (consume(verdict.requestKey)) {
        writeAuditRow(ctx.cwd, {
            event: HOOK_AUDIT_EVENT, tool: toolName, command, cwd: ctx.cwd,
            verdict: "allow",
            reason: `hook: one-shot approval grant consumed -- ${verdict.reason}`,
        });
        return undefined; // let it reach the wrapper, which re-evaluates independently
    }
    const requestId = createPending(verdict.requestKey, command, verdict.reason);
    // ... existing block path
}
```

Note this makes the grant single-use across BOTH layers, so the wrapper must re-derive its
own authorisation rather than calling `consume()` a second time on the same key — e.g. have
the hook stamp a short-lived, single-use "hook already consumed" marker keyed on the same
`requestKey`, or move the consume to the wrapper only and have the hook return `undefined`
when a grant exists (`peek`) without removing it. Whichever is chosen, add an integration
test that drives block → `approve_ky_command` → re-issue → **execution**, because nothing in
the suite does today.

---

### CR-02: `buildFacts` hands un-canonicalised Windows paths to the path policy — all writes blocked, all home detonation targets dead

**File:** `.pi/extensions/safety/index.ts:160-172` (consumed at `paths.ts:328-338`, `:442-458`)
**Issue:** `buildFacts` sets `projectRoot: ctx.cwd` and `home: homedir()` verbatim. On Windows
both are backslash strings (`C:\Users\Admin\Documents\ky-pi-agent`). `paths.ts` canonicalises
the *target* path to forward slashes but never re-normalises `facts.projectRoot` or
`facts.home` — `rootedSegmentsOf()` (`paths.ts:212-233`) only recognises `X:/`, so a `C:\...`
root parses as root `"/"` with one giant segment.

Executed against the real modules (Node 24.16.0, win32):

```
projectRoot = C:\Users\Admin\Documents\ky-pi-agent
write "src/index.ts"
  -> canonical "C:/Users/Admin/Documents/ky-pi-agent/src/index.ts"
  -> block: "... resolves outside the project root "C:\Users\Admin\Documents\ky-pi-agent""
```

Two consequences:

1. **Fail-closed, harness-breaking:** every `write` and `edit`, including files inside the
   project, is blocked on the one platform this phase targets. The harness cannot edit its own
   source.
2. **Fail-open, latent:** the four home-anchored `DETONATION_TARGETS` (`bashrc`,
   `bash-profile`, `profile`, `gitconfig`, `paths.ts:441-459`) build their comparand as
   `` `${facts.home}/.bashrc` `` — `C:\Users\Admin/.bashrc` — which `sameCanonicalPath` can never
   match against `C:/Users/Admin/.bashrc`. Proven: with the real `homedir()` the verdict reason
   is *"resolves outside the project root"*; with the fixture-shaped forward-slash home it is
   *"is the user's shell rc file"*. The moment (1) is fixed by normalising only `projectRoot`,
   writes to `~/.bashrc` become allowed whenever the session cwd is at or above the home
   directory. SAFE-13 is currently passing by coincidence.

`path-policy.test.ts:41-43` and `policy-compose.test.ts:33-38` both hardcode `C:/...` fixtures,
so neither shape is covered.

**Fix:** normalise in `buildFacts` and add a backslash-rooted fixture to both unit tables.

```ts
import { homedir } from "node:os";
const toCanonicalRoot = (p: string) =>
    canonicalisePathArg({ text: p, value: p }, { cwd: p, home: p });

function buildFacts(ctx: ExtensionContext): PolicyFacts {
    const cwd = toCanonicalRoot(ctx.cwd);
    return { cwd, projectRoot: cwd, home: toCanonicalRoot(homedir()), /* ... */ };
}
```

Then add to `path-policy.test.ts`'s tables a `PROJECT_ROOT`/`HOME` pair built with `BS`
(the file already has the helper) so the regression cannot come back.

---

### CR-03: Executable matching is exact-string — `git.exe push`, `/usr/bin/git push`, `terraform.exe apply` all ALLOW

**File:** `.pi/extensions/safety/policy.ts:318-330`; `.pi/extensions/safety/infra.ts:414-425`
**Issue:** `evaluateInvocation` gates on `executable.toLowerCase() === "git"` / `=== "glab"`, and
`classifyInfraInvocation` on `=== "aws"` / `"terraform"` / `"kubectl"`. `CanonicalInvocation.executable`
is the literal argv[0] word after wrapper resolution — never basename-reduced, never
extension-stripped. `SHELL_RUNNERS` does not catch it either (`git.exe` is not a runner).

Executed against the real `evaluate()` with `currentBranchFor: () => "main"`,
`protectedBranches: ["main"]`:

```
"git push"                                              block
"git.exe push"                                          allow
"/usr/bin/git push"                                     allow
"./git push"                                            allow
"terraform.exe apply"                                   allow
"kubectl.exe delete pod x"                              allow
"aws.exe secretsmanager get-secret-value --secret-id x" allow
"glab.exe mr merge"                                     allow
"env git.exe push"                                      allow
```

`git.exe` is not an adversarial spelling on this platform — it is what Git for Windows installs
and what a model that has seen `where git` output will type. This defeats SAFE-04, SAFE-05,
SAFE-06 (the aws sensitive-read arm) and SAFE-07 simultaneously, is absent from
`tests/fixtures/evasion-corpus.ts`, and is not listed in `docs/SAFETY.md`'s "Known bypasses"
table — so the published limits table currently overstates coverage.

**Fix:** reduce to a basename and strip a Windows executable extension before every comparison,
in one shared helper used by `policy.ts` and `infra.ts`:

```ts
/** argv[0] -> the comparable verb: basename, lower-cased, PATHEXT suffix removed. */
export function normaliseExecutable(executable: string): string {
    const base = executable.replace(/\\/g, "/").split("/").pop() ?? executable;
    return base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
}
```

Add `git.exe push`, `/usr/bin/git push`, `terraform.exe apply` and `glab.exe mr merge` as
`BLOCKED` rows to the evasion corpus in the same commit.

---

### CR-04: Pi's built-in `grep` / `find` / `ls` tools are unguarded and unaudited — SAFE-06 is bypassed by a default tool

**File:** `.pi/extensions/safety/policy.ts:421-436`; `.pi/extensions/safety/index.ts:517-526`;
`docs/SAFETY.md:83-93`
**Issue:** `evaluate()` governs four tool names and the hook returns `undefined` for everything
else. Pi 0.84.1 ships **seven** built-in tools — verified in
`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js`:
`allToolNames = new Set(["read","bash","edit","write","grep","find","ls"])`. `grep`'s schema
(same file, `grep.js`) is `{ pattern, path?, glob?, ignoreCase?, literal?, context?, limit? }`
and it returns matching **lines of file content**.

So `grep { pattern: ".", path: "C:/Users/Admin/.aws/credentials" }` — or
`grep { pattern: "=", glob: ".env" }` — returns the secret straight into the model's context,
with no verdict, no block, and **no audit row at all**. This is the exact class SAFE-06 exists
to prevent, reachable by a default-active tool with no shell involved, and it is markedly
*easier* for a confused model to reach than the bash and `read` routes the guard does cover.

`docs/SAFETY.md:51-53` states sensitive reads "block through both the `read` tool directly and
quoted bash arguments" and the "Known bypasses" table names only `EV-42` ("any
extension-registered tool that shells out internally"). Pi's own built-in `grep`/`find`/`ls`
are neither extension-registered nor named anywhere. SAFE-15's deliverable is the honest limits
table; this omission makes it dishonest.

**Fix (both halves required):**
1. Wrap and evaluate `grep`/`find`/`ls` — at minimum apply `classifyPathRead` to `grep.path`
   and refuse a `glob` that matches a sensitive-read pattern; `find`/`ls` leak names rather
   than contents and can be audit-only. Extend `evaluate()`'s switch and the hook's tool-name
   filter together (they must stay in sync), and add the tool names to `safety-entry.test.ts`'s
   expected registration list.
2. Until (1) lands, add explicit `OUT-OF-SCOPE` corpus rows and `docs/SAFETY.md` table rows for
   `grep`, `find` and `ls` by name.

---

### CR-05: `git push --force origin main` from a feature branch is ALLOWED — the refspec target is never inspected

**File:** `.pi/extensions/safety/git.ts:277-281` (with `:206-211`)
**Issue:** `classifyGitInvocation` returns `{ kind: "allow" }` immediately when `HEAD` is not
protected, before the write table is consulted at all. The push rule's own `why` string says
*"a write regardless of refspec — the refspec target cannot be trusted from argv alone"*, but
that reasoning is only applied on the protected-`HEAD` branch of the function.

Executed with `currentBranchFor: () => "feature/x"`, `protectedBranches: ["main"]`:

```
"git push origin HEAD:main"        allow
"git push origin feature/x:main"   allow
"git push --force origin main"     allow
```

The last one names `main` literally in argv and is allowed. This is the single headline
behaviour of the phase (do not let the model push to `main`) failing on a plain, non-obfuscated
command, and the compensating control named for it — `RB-04-01`, GitLab server-side protection
— is OUTSTANDING and unverified. It appears in neither the evasion corpus nor
`docs/SAFETY.md`'s bypass table, while `docs/SAFETY.md:43-50` presents the git rules as the
protected-branch control.

**Fix:** evaluate the refspec independently of `HEAD`. Block a `push` whose argv contains any
positional token whose destination side (`src:dst`, or a bare ref) case-insensitively matches a
protected branch, regardless of the checked-out branch:

```ts
function pushTargetsProtected(args: readonly string[], protectedBranches: readonly string[]): boolean {
    return args.some((a) => {
        if (a.startsWith("-")) return false;
        const dst = a.includes(":") ? a.slice(a.indexOf(":") + 1) : a;
        const leaf = dst.replace(/^refs\/heads\//, "");
        return protectedBranches.some((b) => b.toLowerCase() === leaf.toLowerCase());
    });
}
```

Then add `git push origin HEAD:main` and `git push --force origin main` (on `feature/x`) as
`BLOCKED` corpus rows, and add a `git push origin feature/x` on `feature/x` → allow row as the
paired negative so the new rule cannot degenerate into "any push is blocked".

## Warnings

### WR-01: Windows path aliasing (NTFS ADS, 8.3 short names) defeats every path rule and is unpublished

**File:** `.pi/extensions/safety/paths.ts:274-281`, `:309-312`
**Issue:** `canonicalisePathArg` is pure text manipulation — no `realpath`, no filesystem
canonicalisation (deliberately, per the module docstring). On NTFS two aliases survive that:

```
read { path: ".env::$DATA" }  -> evaluate() = allow ; fs.readFileSync succeeds, returns SECRET=abc123
read { path: "ENV~1"      }  -> evaluate() = allow ; fs.readFileSync succeeds, returns SECRET=abc123
```

Both verified by execution on this machine (8.3 name generation is enabled on `C:`; `dir /x`
reports `.env` as `ENV~1`). The same aliases apply to `~/.aws/credentials`, `*.tfstate` and
every `DETONATION_TARGETS` entry. A trailing-space alias (`.env `) was tested and does **not**
work through Node, so it is not a gap.

These are adversarial rather than confused-model shapes, which is consistent with the
"mistake-catcher" ceiling — but SAFE-15's contract is that unpublished limits are the
vulnerability. **Fix:** either strip an `::$DATA`/`:<stream>` suffix and reject a basename
matching `/~\d$/` in `basenameOf()`, or add both to the corpus as `OUT-OF-SCOPE` rows with
matching `docs/SAFETY.md` table entries.

### WR-02: The wrapped tools execute against `process.cwd()` while policy evaluates against `ctx.cwd`

**File:** `.pi/extensions/safety/index.ts:300-340`
**Issue:** `registerWrappedTools` captures `const cwd = process.cwd()` once at extension-load
time and passes it to `createBashTool`/`createReadTool`/`createWriteTool`/`createEditTool`. The
built-in path tools resolve every relative path against that closed-over `cwd`
(`dist/core/tools/read.js:134,158`, cited in this file's own docstring), while
`classifyAtWrapper` evaluates containment against `ctx.cwd`. When the two differ the guard
checks one root and the write lands under another — a genuine check-here/act-there split.
`double-enforcement.test.ts` runs with exactly that divergence (session cwd is a temp dir,
`process.cwd()` is the repo root) and passes only because its fixtures are `echo`.
**Fix:** derive the tool cwd from the same source as the policy facts, or re-create the
delegate tools per call from `ctx.cwd`; at minimum add an assertion that the two agree and
block when they do not.

### WR-03: `OUT-OF-SCOPE` corpus rows are never driven through `evaluate()` — a real bypass can be hidden by re-bucketing

**File:** `tests/unit/evasion-corpus.test.ts:72-87`, `:129-177`
**Issue:** Group A drives only `BLOCKED` rows through `evaluate()`. Group B checks that every
`OUT-OF-SCOPE` row's id/class appears in `docs/SAFETY.md` and that the doc has no extra ids —
a *documentation* consistency check, not a behavioural one. So the disarm path is mechanical:
if a `BLOCKED` row regresses to `allow`, flipping `expect` to `OUT-OF-SCOPE` and pasting one
markdown row turns the suite green while the guard is weaker. The corpus docstring's claim that
every bucket was "observed by execution" is never re-verified on any later run.
**Fix:** add a Group A' asserting each `OUT-OF-SCOPE` row genuinely returns `allow`. That makes
the bucket falsifiable in both directions and turns "we published this limit" into "this limit
still exists".

### WR-04: The audit concurrency proof exercises a re-implementation, not the writer under test

**File:** `tests/integration/audit-concurrency.test.ts:103-209`
**Issue:** Both child scripts hand-roll `appendFileSync` + a rotate-before-write loop rather
than importing `appendJsonl`/`writeAuditRow` from `.pi/lib/jsonl.ts`. The test therefore proves
that *Windows `appendFileSync` is atomic for ~200-byte records* — it would stay green if
`appendJsonl` were rewritten to hold a stream and lose every post-rotation record, which is
precisely the hazard `.pi/lib/jsonl.ts:52-58` says the test exists to rule out. (Partially
mitigated by `jsonl-append-only.test.ts`'s grep ban on stream constructors, which is a
different oracle for a different claim.)
**Fix:** have the children `import { writeAuditRow } from ".../safety/audit.ts"` (they are
`.mjs` in a temp dir; Node 22+/24 can load the `.ts` directly as the other probes in this repo
do) so the assertion is about the shipped writer.

### WR-05: `pending` and `granted` grow without bound; nothing ever sweeps expired entries

**File:** `.pi/extensions/safety/approvals.ts:165-170`, `:224-232`
**Issue:** `createPending` inserts on every confirm-block and nothing removes an expired
pending except a successful `approve()` for that exact id. An expired grant is only removed if
someone calls `consume()` for its key. With CR-01 in place, every retry of a confirmed command
mints another permanent pending entry, in a `globalThis`-keyed map that outlives `/reload`.
Over a long session this is unbounded growth keyed by model behaviour.
**Fix:** sweep both maps for `expiresAt <= now` at the top of `createPending()` (cheap,
amortised, no timer), and add a test that asserts the pending map shrinks after the TTL with an
injected clock.

### WR-06: Any global `git` option before the subcommand makes the invocation "unclassified", producing false blocks

**File:** `.pi/extensions/safety/policy.ts:311-313`
**Issue:** `toGitInvocation` takes `args[0]` as the subcommand verbatim. `git -C /repo status`,
`git --no-pager log`, `git -c user.name=x diff` therefore classify with `subcommand === "-C"` /
`"--no-pager"` / `"-c"` and hit the fail-closed unknown-subcommand arm (`git.ts:307-313`) —
blocked whenever `HEAD` is protected, even though every one of them is a read. `EV-12`/`EV-13`
record this as "a precision gap, not a security one", but the direction that matters for
adoption is the other one: 04-CONTEXT.md's own stated failure mode is a guard annoying enough
that the user disables it, and blocking `git -C … status` on `main` is exactly that. The same
class applies to `SHELL_RUNNERS` + `GUARDED_VERB_PATTERN`: `node scripts/deploy-aws.js` is
refused because the raw segment contains `aws` (`shell.ts:675-679`).
**Fix:** skip leading `-`-prefixed tokens (consuming the value of `-C`/`-c`/`--git-dir`/
`--work-tree`/`--namespace`) before selecting the subcommand — the same tabulated-arity
approach `resolveWrappers` already uses for `env`/`sudo`. Add `git -C /repo status` → allow and
`git -C /repo push` → block as paired rows.

### WR-07: The safety extension loads twice in this repository (user-scope stub + project-scope auto-discovery)

**File:** `bin/bootstrap.sh:864-902`; `package.json` `pi.extensions: ["./.pi/extensions"]`
**Issue:** `install_safety_extension` writes `~/.pi/agent/extensions/ky-safety/index.ts`
re-exporting `<repo>/.pi/extensions/safety/index.ts`. When `pi` runs inside this trusted repo,
Pi also auto-discovers the project-scoped copy. Both default exports run, so
`registerToolCallHook` registers **two** `tool_call` handlers and `registerWrappedTools`
registers `bash`/`read`/`write`/`edit` twice (first-registration-wins silently discards the
second set). Observable effects: two audit rows per tool call, and two `pending` entries minted
per `confirm` block (compounding WR-05). `bootstrap-safety-stub.test.ts` only inspects the
written bytes, never a session that has both scopes live.
**Fix:** make the entry point idempotent — guard the default export behind a
`globalThis`-keyed "already installed" flag (the same slot pattern `approvals.ts` already
uses), and assert single registration in a session test that has both scopes present.

### WR-08: `docs/SAFETY.md` claims coverage the code does not deliver in three places

**File:** `docs/SAFETY.md:24-26`, `:43-50`, `:51-53`, `:61-67`
**Issue:** Four specific over-claims, each falsified above:
- `:24-26` "governs exactly four tool names … denies by construction" omits that Pi's own
  `grep`/`find`/`ls` are equally default-active and unguarded (CR-04).
- `:43-50` presents the git rules as the protected-branch control without stating that a push
  whose *refspec* targets `main` from a non-`main` `HEAD` is allowed (CR-05).
- `:51-53` "sensitive reads … block through both the `read` tool directly and quoted bash
  arguments" — true, but the easiest route (`grep`) is unmentioned (CR-04), as are the NTFS
  aliases (WR-01).
- `:61-67` "a `write`/`edit` into … `~/.bashrc`, `~/.bash_profile`, `~/.profile`,
  `~/.gitconfig` … blocks" — on Windows those four rules never fire at all (CR-02); the block
  observed today comes from the containment rule for an unrelated reason.

The document's own `## Authority` section says a stale claim here "is not a documentation nit,
it is a false sense of security". **Fix:** land the code fixes above, then re-derive these
bullets; where a limit is accepted rather than fixed, add it to the corpus as `OUT-OF-SCOPE`
so `evasion-corpus.test.ts` Group B keeps the table honest.

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
