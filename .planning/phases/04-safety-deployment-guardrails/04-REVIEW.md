---
phase: 04-safety-deployment-guardrails
reviewed: 2026-08-14T11:05:00Z
depth: standard
iteration: 4
files_reviewed: 19
files_reviewed_list:
  - .pi/extensions/safety/index.ts
  - .pi/extensions/safety/paths.ts
  - .pi/extensions/safety/policy.ts
  - .pi/extensions/safety/shell.ts
  - .pi/extensions/safety/approvals.ts
  - bin/bootstrap.sh
  - docs/SAFETY.md
  - docs/RUNBOOK.md
  - tests/fixtures/evasion-corpus.ts
  - tests/unit/evasion-corpus.test.ts
  - tests/unit/policy-compose.test.ts
  - tests/unit/shell-parse.test.ts
  - tests/helpers/session.ts
  - tests/integration/bootstrap-safety-stub.test.ts
  - tests/integration/headless-deny.test.ts
  - tests/integration/global-teardown-exit-code.test.ts
  - tests/global-teardown.ts
  - vitest.config.ts
  - tests/fixtures/global-teardown-probe.txt
findings:
  critical: 1
  warning: 4
  info: 6
  total: 11
status: issues_found
---

# Phase 4: Code Review Report (iteration 4 — FINAL VERIFICATION)

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Executed, not read. **Three of the four iteration-3 findings are genuinely
fixed** (CR-10, WR-13 fully; WR-14 for the symptoms it names). **CR-09 is half
fixed**: the fail-open is really gone — I re-ran my own prior probe and the
real generated stub now registers the full tool set headless with `cwd` = this
repository — but the *accepted* double-load the fixer traded it for is **not**
the harmless thing the code claims it is. The full suite is 1175/1175 green
(exit 0, tree clean after the run — I ran it).

**The one blocker:** the fixer's own justification, repeated verbatim in
`bin/bootstrap.sh`, `.pi/extensions/safety/index.ts` and the commit message, is
that a double load produces *"duplicate audit rows and, at worst, a duplicate
block — never a missed one."* Executed against the real `tool_call` hooks from
two independent loads of the real extension in one process: a human-approved
command **can never be re-issued successfully**. Hook A defers (`peek` +
`markHookDeferred` → `true`), hook B sees the marker already set, falls through
to its mint-a-fresh-pending path, and **blocks**. The grant is never consumed,
so it stays in the store and the cycle repeats forever (I drove four rounds,
including one past `HOOK_DEFER_TTL_MS`). That is not a duplicate block; it is
**SAFE-10's entire confirm → approve → re-issue protocol dead** in exactly the
configuration the trade creates (project trusted + session rooted in this
repo + user-scope stub installed — i.e. the developer's own interactive daily
driver, one trust prompt away on this machine today). It is fail-closed, so it
is not a security hole; it is a correctness defect that makes the guard
unusable for `terraform apply` / `kubectl delete` and is the textbook shape of
"annoying enough to get the guard disabled" that `04-CONTEXT.md` names as the
real risk.

Additionally, **the acceptance is published nowhere a reader will find it**.
Both `bin/bootstrap.sh:889` and `.pi/extensions/safety/index.ts:763` point the
reader at *"`docs/SAFETY.md`'s WR-07 note"*. `grep -rn "WR-07" docs/` returns
**nothing**. There is no WR-07 note, no double-load section, nothing about the
trade anywhere in `docs/`.

### Verification of the four iteration-3 findings

| ID | Verdict | Executed evidence |
|----|---------|-------------------|
| **CR-09** | **PARTIALLY FIXED** — (a) yes, (b) **no**, (c) **no** | (a) Generated the stub with the *production* generator extracted verbatim from `bin/bootstrap.sh:916-961`, pointed at the real `.pi/extensions/safety/index.ts`, drove it through **jiti** in a real subprocess with `cwd = C:\Users\Admin\Documents\ky-pi-agent` (which *does* contain `.pi/extensions/safety/index.ts`): `{"tools":["bash","read","write","edit","approve_ky_command"],"events":["tool_call","session_start"]}`. My iteration-3 probe returned `[]`/`[]`; the fail-open is genuinely closed. (b) See **CR-11** — the accepted double-load is NOT harmless. Duplicate `registerTool` *is* harmless (`runner.js:280-291` `getAllRegisteredTools`, first-per-name wins, no error — read at source), and no grant is double-consumed; but the duplicate `tool_call` hook permanently defeats the approval protocol. (c) `grep -rn "WR-07" docs/` → no match; both citing files point at a section that does not exist. |
| **CR-10** | **FIXED** | All seven shapes re-run through the real `evaluate()` (`home=C:/Users/tester`, `projectRoot=C:/repo`, HEAD=`main`): `/usr/bin/env git push` **block**, `env.exe git push` **block**, `/usr/bin/sudo git push` **block**, `/usr/bin/nohup git push` **block**, `/usr/bin/env terraform apply` **confirm**, `/usr/bin/env kubectl delete pod x` **confirm**, `/usr/bin/env aws secretsmanager get-secret-value --secret-id x` **block**. All seven are in the corpus as `BLOCKED` (EV-66..EV-72). Paired negatives intact: `/usr/bin/env echo hi` → allow, `echo hi` → allow, `env git status` → allow. Extra shapes I added all block: `ENV.EXE`, `/usr/bin/env.cmd`, `C:\Windows\System32\env.exe`, `./env`, `/usr/bin/time`, and the nested `/usr/bin/env /usr/bin/sudo /usr/bin/nohup git push`. **Non-vacuous, proved by revert:** with `const verb = normaliseExecutable(word)` reverted to `word.toLowerCase()` in a scratch copy of `safety/`, exactly EV-66..EV-72 flip to `allow` (7 corpus failures). |
| **WR-13** | **FIXED** | Real `npx vitest run` subprocess with a throwaway test appending to the tracked probe fixture: tripwire message on stderr **and `RAW EXIT CODE: 1`**. Restored the fixture, removed the probe, re-ran `npx vitest run tests/unit/shell-parse.test.ts`: **`RAW EXIT CODE: 0`**, no tripwire text. My iteration-3 finding was exit 0 in both directions; that is fixed. Full-suite run afterwards: exit 0, `git status --porcelain` empty. |
| **WR-14** | **FIXED for its named symptoms; CR-07 NOT reopened; two NEW narrowing gaps created** | CR-07 re-run, all still **block**: `grep {path:"~/.aws"}`, `ls {path:"~/.aws"}`, `find {path:"~/.ssh"}`, `grep {path:"C:/Users/tester"}` (`$HOME`), `grep {path:"~"}`, `grep {path:["~/.aws/credentials"]}` (malformed), `grep {path:"C:/"}`, `grep {path:".."}`, `grep {path:"~/.aws/../.aws"}`, `~/.kube`, `~/.gnupg`, `~/.aws/credentials`, `read ~/.aws/credentials`, `grep {glob:".env"}`. Aliasing forms also still block: MSYS `/c/...`, `/cygdrive/c/...`, `$HOME/...`, `${HOME}/...`, trailing slash, case-variant `C:/USERS/TESTER/.AWS`, relative `.aws` from `cwd=$HOME`, explicit `path === $HOME` and explicit `path:"."` when `cwd===home` (correctly NOT exempted). Intended relief works. **But** see **WR-16**/**WR-17**. **Non-vacuous, proved by revert:** with the `$HOME` anchor and the absent-path exemption reverted in a scratch copy, all three WR-14 relief cases flip back to `block` while the paired negative stays `block`. |

### Final evasion-suite numbers (executed)

Driven through the real `evaluate()` with `home = C:/Users/tester`,
`projectRoot = C:/repo`, `HEAD = main`:

```
total corpus cases          : 72
blocked by real evaluate()  : 60
NOT blocked (allow)         : 12
bucket mismatches           : none
not-blocked ids             : EV-09 EV-27 EV-35 EV-36 EV-38 EV-39 EV-40 EV-41 EV-42 EV-56 EV-57 EV-65
OUT-OF-SCOPE ids in corpus  : (identical set)
EV ids in docs/SAFETY.md    : (identical set)
in doc but not OUT-OF-SCOPE : []
OUT-OF-SCOPE but not in doc : []
not-blocked but not in doc  : []
doc rows but blocked        : []
```

`docs/SAFETY.md`'s "Known bypasses" table lists **exactly** the not-blocked
set, cross-checked in **both** directions, with no row re-bucketed or softened.
The caveat carried from iteration 3 still holds and is now larger: the corpus
covers what it contains honestly, but it contains **no row at all** for the two
new WR-16/WR-17 gaps below, nor for the CR-11 protocol failure.

### Regression sweep (all clean unless noted)

- **Deny-by-default holds.** All seven governed tool names × `null` / `[]` /
  `"x"` / `7` / `undefined` → `block`. `{}` → `block` for
  `bash`/`read`/`write`/`edit`; `allow` for `grep`/`find`/`ls` (the documented
  absent-optional-`path` default, evaluated against `projectRoot`). Unknown
  tool → `allow` (documented design boundary, EV-42). A throwing
  `currentBranchFor` oracle → `block`.
- **`resolveWrappers` cannot loop forever** — every branch advances `i` before
  `continue`.
- **Duplicate `registerTool` is safe** — verified at source in
  `runner.js:280-291`: first registration per name wins, silently, no error.
- **No grant is double-consumed** — only a wrapper calls `consume()`, and only
  the first-registered wrapper ever executes. Store inspected directly after
  four hook rounds: `granted.size === 1`, never negative-consumed.
- **`RB-04-01` is still `OUTSTANDING`** in both `docs/RUNBOOK.md:862` (summary
  table) and `:866` (`**Status:** OUTSTANDING`). Not flipped.
- **`tests/helpers/session.ts#writeUserScopeShim` now emits production's own
  bytes** (unconditional dynamic-import wrapper), so `headless-deny.test.ts`'s
  real `pi --mode json` runs exercise the shipped shim shape. Correctly fixed.
- **Tautology check (fourth pass).** `global-teardown-exit-code.test.ts`,
  `shell-parse.test.ts`'s `WRAPPER_TABLE` rows and `policy-compose.test.ts`'s
  WR-14 block are all genuinely falsifiable (proved by scratch-copy revert
  above). `bootstrap-safety-stub.test.ts` cases 6/7 are genuine. **Case 8 is
  not** — see **WR-18**.

## Critical Issues

### CR-11: the accepted double-load permanently breaks the confirm → approve → re-issue protocol (SAFE-10) — the "at worst a duplicate block" justification is false

**File:** `.pi/extensions/safety/index.ts:664-674` (the hook's defer branch);
`.pi/extensions/safety/approvals.ts:352-360` (`markHookDeferred`);
`bin/bootstrap.sh:880-891` and `.pi/extensions/safety/index.ts:758-769` (the
false justification)
**Blocks the phase:** **yes.** A real defect, not a documented limitation — the
only place the trade is described is code comments, and what they describe is
not what happens.

**Issue.** CR-09's fix removed all dedupe from the generated stub and accepted
that both copies of the extension may load. Each load registers its own
`tool_call` hook. Pi runs **every** extension's `tool_call` handler in load
order and returns on the first `block`
[`dist/core/extensions/runner.js#emitToolCall`, read at source]. WR-12's
`markHookDeferred` is keyed on `requestKey` alone, so it cannot tell "the
second hook of the *same* tool call" from "a second *re-issue* that never
consumed its grant" — the case it was written to bound.

Executed: two independent jiti loads of the real `.pi/extensions/safety/index.ts`
in one process, each handed a fresh `pi`, both hooks driven in order exactly as
`emitToolCall` does, on `bash { command: "terraform apply" }`:

```
loadA tools: ["bash","read","write","edit","approve_ky_command"] hooks: 1
loadB tools: ["bash","read","write","edit","approve_ky_command"] hooks: 1

round 1 (fresh)              A -> BLOCK  (mints pending 329b9f86-...)
approve(id, command, reason) -> true
round 2 (re-issue)           A -> undefined (defer)   B -> BLOCK  (mints a NEW pending)
round 3 (immediately after)  A -> BLOCK   (marker still live)
  granted.size = 1   pending.size = 2   hookDeferred.size = 1
round 4 (after HOOK_DEFER_TTL_MS)  A -> undefined (defer)   B -> BLOCK
```

The approved command is **never** allowed through, in any round, ever. The
grant is never consumed, so it survives its full `APPROVAL_TTL_MS` doing
nothing, and each retry mints another pending entry. `approve_ky_command`
becomes dead code again — the exact condition CR-01 (iteration 1) existed to
fix, reintroduced by a different route.

Reachability on this machine **today**: `~/.pi/agent/extensions/ky-safety/index.ts`
exists and is unconditional (it is still the pre-CR-06 static re-export, which
registers exactly the same way), and `~/.pi/agent/trust.json` is absent. The
moment the user answers the trust prompt once in this repository, Pi
auto-discovers `.pi/extensions/safety/` as well
[`package-manager.js:1980`] and the double load — and this livelock — is live
for every `terraform`/`kubectl`/`aws` confirm.

**Fix.** Make the deferral marker per-*tool-call*, not per-*command*.
`event.toolCallId` is on `ToolCallEventBase`
[`dist/core/extensions/types.d.ts:648-651`], is stable across every hook in one
call, and is different for a genuine re-issue — which is precisely the
distinction `markHookDeferred` needs and `requestKey` alone cannot make:

```ts
// index.ts, in the confirm branch
if (peek(verdict.requestKey) && markHookDeferred(`${verdict.requestKey}::${event.toolCallId}`)) {
    /* ...defer... */
}
// approvals.ts#consume: clear every marker whose key starts with `${requestKey}::`
```

Both hooks of one tool call then defer (the wrapper runs once and consumes
once); a *second re-issue* with no intervening `consume()` still blocks, so
WR-12's bound is preserved. Add a regression case that drives **two hooks in
one process** through block → approve → re-issue and asserts the re-issue is
**not** blocked — the property `bootstrap-safety-stub.test.ts` case 8 currently
claims to pin but cannot (see WR-18).

Alternatively, restore a *correct* dedupe (Option 1 from iteration 3's CR-09,
using a marker Pi rebuilds per runner build rather than `globalThis`), but the
`toolCallId` change is smaller and fixes the protocol regardless of how many
copies load.

## Warnings

### WR-15: the accepted double-load is published nowhere — two source files cite a `docs/SAFETY.md` "WR-07 note" that does not exist

**File:** `bin/bootstrap.sh:889`; `.pi/extensions/safety/index.ts:763`;
`docs/SAFETY.md` (absent section)
**Issue.** Both files justify removing the dedupe by pointing the reader at
*"`docs/SAFETY.md`'s WR-07 note"* for how the residual duplicate load is
*"published rather than hidden."* It is not published at all:
`grep -rn "WR-07" docs/` returns nothing, and `docs/SAFETY.md` contains no
section on double loading. `docs/SAFETY.md`'s own **Authority** section says a
stale claim there "is not a documentation nit, it is a false sense of
security"; a dangling citation to a section that was never written is the same
class of defect, and it is what let CR-11 ship unexamined.
**Fix.** Add a short section to `docs/SAFETY.md` (next to "Load order is part
of this") stating: both copies may load when the project is trusted; what that
costs; and — once CR-11 is fixed — that the approval protocol survives it. If
CR-11 is *not* fixed, that section must say plainly that in-band approval does
not work in a trusted session inside this repository. Do not leave the
citations pointing at nothing either way.

### WR-16: WR-14's `$HOME` anchoring re-opens the sensitive search root for UNC and other-profile spellings that were blocked before this pass

**File:** `.pi/extensions/safety/paths.ts:553-559`
**Issue.** `isSensitiveSearchRoot`'s segment check is now gated on
`isWithinRoot(canonicalPath, facts.home)`. `isWithinRoot` compares
`rootedSegmentsOf().root` first, so **any path under a different root fails the
gate outright**, even when it names the same real directory. Executed
(`home = C:/Users/tester`):

```
allow   grep { path: "\\\\localhost\\C$\\Users\\tester\\.aws" }   (UNC to the user's OWN ~/.aws)
allow   grep { path: "//localhost/C$/Users/tester/.aws" }         (forward-slash UNC, same directory)
allow   grep { path: "C:/Users/otheruser/.aws" }                  (another profile's credentials dir)
block   grep { path: "//localhost/C$/Users/tester/.aws/credentials" }   (the FILE rule still fires)
```

All three `allow` rows **blocked before this fix** (the old unanchored
`parts.some(...)` matched the `.aws` segment regardless of root). This is
strictly a new gap, created by a narrowing, with no corpus row and no
`docs/SAFETY.md` entry. The specific-file rules (`classifyPathRead`) are
unaffected — but the whole point of CR-07 was that a *recursive search rooted
at the directory* returns file **contents** without ever naming a file.

Impact today is nil because `grep`/`find`/`ls` are not registered (WR-09) and
Pi does not activate them — which is why this is a WARNING, not a blocker —
but it becomes live the moment anything activates them.

**Fix.** Anchor on *reaching* home rather than on sharing home's root, e.g.
compare the tail segments: keep the `isWithinRoot` fast path, and additionally
treat a path whose segments contain `[...homeSegments, <sensitive>]` (or whose
final segments match `facts.home`'s own trailing segments followed by a
sensitive segment) as sensitive. Failing that, publish the UNC/other-profile
form as an `OUT-OF-SCOPE` corpus row plus a `docs/SAFETY.md` line, next to
EV-56/EV-57 (which are the same "no filesystem canonicalisation" family).

### WR-17: WR-14's absent-`path` exemption makes a bare `grep`/`find`/`ls` recursively search `$HOME` when the session is rooted there

**File:** `.pi/extensions/safety/policy.ts:523-527`
**Issue.** When `facts.projectRoot` and `facts.home` canonicalise identically,
a genuinely absent `path` short-circuits to `allow` **before**
`isSensitiveSearchRoot` runs. Executed with `projectRoot = home = C:/Users/tester`:

```
allow   grep { pattern: "x" }      (no path)
allow   find { }                   (no path)
allow   ls   { }                   (no path)
block   grep { pattern: "x", path: "C:/Users/tester" }   (explicit — correctly NOT exempt)
block   grep { pattern: "x", path: "." }                 (explicit — correctly NOT exempt)
```

`grep` with no `path` searches its own cwd **recursively**, so in a session
opened directly in `$HOME` a bare
`grep { pattern: "aws_secret_access_key" }` walks `~/.aws/credentials` and
returns the matching lines — the precise leak SAFE-06 exists to stop, and the
one CR-07's fix closed. The exemption was prescribed by iteration 3's own WR-14
fix text, so this is a review-induced regression, not a fixer improvisation —
but it is still a fail-open, it is undocumented, and it has no corpus row.
Dormant for the same reason as WR-16 (`grep`/`find`/`ls` unregistered).

**Fix.** Do not exempt the whole check. Exempt only the
`isWithinRoot(facts.home, canonicalPath)` *ancestor* half (which is what fired
spuriously) and keep the segment half live, so a bare search from `$HOME` is
still evaluated against `~/.aws`/`~/.ssh`/`~/.kube`/`~/.gnupg`:

```ts
if (pathWasAbsent && sessionRootIsHome) {
    return isSensitiveSearchRoot(canonicalPath, pathFacts) && /* segment half only */ ...
}
```
Simplest concrete shape: split `isSensitiveSearchRoot` into
`hasSensitiveSegmentUnderHome()` and `reachesHome()`, and have this branch call
only the former. Then add a corpus row for the bare-`grep`-in-`$HOME` shape in
whichever bucket the chosen behaviour puts it.

### WR-18: `bootstrap-safety-stub.test.ts` case 8 pins the double-load trade with an oracle that structurally cannot observe it

**File:** `tests/integration/bootstrap-safety-stub.test.ts:476-517`
**Issue.** Case 8 claims to prove *"registering twice is the accepted trade,
never a missed block"* by calling `runDriverAt(cwdWithCopy, stub)` **twice** —
two separate `node` child processes. Two separate processes share no
`globalThis`, no approvals store and no hook list, so "the same full tool set
comes back twice" is true by construction and would remain true no matter how
badly the in-process double load behaved. The property the test names lives
entirely *inside one process*, and this test never enters that state. My own
in-process probe (CR-11) shows the real behaviour is the opposite of what this
case asserts is safe. This is the fourth consecutive iteration in which this
phase has shipped a test whose oracle cannot fail for its stated reason.
**Fix.** Replace the two-subprocess shape with a single driver process that
loads the stub **twice** into two fresh `pi` objects, then drives both
recorded `tool_call` hooks in sequence — the way `emitToolCall` does — through
block → `approve()` → re-issue, and asserts the re-issue is **not** blocked
(after CR-11 is fixed). That is the only oracle that can distinguish "duplicate
block" from "permanently blocked".

## Info

### IN-01: the corpus's own prose still says `evaluate()` governs four tool names

**File:** `tests/fixtures/evasion-corpus.ts:57-62`, `:644`
Carried unchanged from iterations 2–3 (info-tier, correctly outside
`fix_scope: critical_warning`). The module docstring still says *"the four tool
names `evaluate()` actually governs"* and EV-42's `why` still says *"a fifth
tool name"*. Both are false: `policy.ts` governs seven, and the corpus itself
holds `grep`/`find`/`ls` rows. **Fix:** say seven; EV-42's `why` should read
"an eighth tool name it does not recognise".

### IN-02: `docs/SAFETY.md`'s EV-42 row says "a sixth-party tool name"

**File:** `docs/SAFETY.md:144`
Artifact of the four→seven rewrite. Should read "an eighth tool name".

### IN-03: machine state — the installed stub is still the pre-CR-06 shape, and no trust decision is recorded

**File:** `~/.pi/agent/extensions/ky-safety/index.ts` (not tracked)
Verified this session: the live stub is still
`export { default } from "C:/Users/Admin/Documents/ky-pi-agent/.pi/extensions/safety/index.ts";`
— `bin/bootstrap.sh` has not been re-run since `c3f5d2c`. `~/.pi/agent/trust.json`
does not exist. Consequences worth recording so a later reader does not
misread the machine: CR-09's fail-open is **not** live here (the old stub is
also unconditional), and CR-11's livelock is **not** live *yet* — it arms the
first time the trust prompt is answered "yes" in this repository. Re-running
`sh bin/bootstrap.sh` changes nothing about either, since old and new stubs
register identically.

### IN-04: audit rows for a `grep` blocked on its `glob` still record an empty `command`

**File:** `.pi/extensions/safety/index.ts:211-223`
Carried from iterations 2–3 (info-tier, out of fix scope).
`extractCommandOrPath` reads `record.path` for every non-`bash` tool, so a
blocked `grep { pattern: "=", glob: ".env" }` writes `command: ""` — losing the
exact field that caused the block. **Fix:** for `grep`, fall back to `glob`,
then `pattern`.

### IN-05: a failing safety-extension factory leaves the session unguarded with only a logged error

**File:** `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:399-417`
Not introduced by this pass and not actionable inside this phase, recorded so
it is not rediscovered. `loadExtension` catches every factory throw and returns
`{ extension: null, error }`; the session continues without the guard. The new
stub shape (an async factory doing a dynamic `import()`) and the old one (a
static re-export) fail identically here. `bin/bootstrap.sh --check-only`'s
`report_safety_extension` (which fatals when the stub's target does not exist)
is the only compensating control, and it only covers the missing-file case.

### IN-06: accepted-and-documented limitations (no action required)

**File:** `docs/SAFETY.md:125-147` ("Known bypasses this guard does not
catch") — `:136` EV-09, `:137` EV-27, `:138-144` EV-35/36/38/39/40/41/42,
`:145` EV-56, `:146` EV-57, `:147` EV-65; plus `docs/SAFETY.md:96-123`
("What this guard does not register (WR-09)") and `:149-182` ("Load order is
part of this", T-04-08).

All **twelve** not-blocked corpus rows are published there, driven through the
real `evaluate()` by `evasion-corpus.test.ts` Group A′ so the published limit
cannot go stale silently, and cross-checked in both directions by Group B (I
re-derived both directions independently above; both diffs are empty).
`docs/SAFETY.md` does not over-claim anywhere I could falsify it: it still
opens with "a **mistake-catcher, not a security boundary**", states there is no
OS-level sandbox on Windows, names GitLab server-side branch protection as the
only non-theatre control, and honestly narrows the `grep`/`find`/`ls`
guarantee to hook-only. These are legitimate dispositions for this phase and
are **not** blockers. `RB-04-01` remains correctly `OUTSTANDING` in both places
in `docs/RUNBOOK.md`.

---

## Bottom line

**Is this safety layer honest about what it does and does not catch on
Windows?** Mostly yes, and unusually so — the twelve published bypasses are
exactly the twelve the real `evaluate()` lets through, verified in both
directions and re-verified behaviourally on every test run, and the document
leads with "mistake-catcher, not a security boundary" and names GitLab's
server-side protection as the only control that is not theatre. Where it is
*not* honest is at the seams this fix pass just moved: the code justifies its
newly-accepted double load with a claim ("at worst a duplicate block") that is
false in a way that kills SAFE-10 outright, and it points the reader at a
`docs/SAFETY.md` section that was never written; and WR-14's `$HOME` anchoring
quietly narrowed a deny rule such that a UNC or other-profile spelling of the
user's own `~/.aws`, and a bare search from a `$HOME`-rooted session, now pass
— both undocumented, both absent from the corpus, both dormant only because
`grep`/`find`/`ls` are not registered. The catching machinery is in good shape;
the honesty layer has three fresh holes in it, and one of them is a live
correctness defect.

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — iteration 4, FINAL verification_
