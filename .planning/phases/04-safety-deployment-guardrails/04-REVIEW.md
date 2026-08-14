---
phase: 04-safety-deployment-guardrails
reviewed: 2026-08-14T12:05:00Z
depth: standard
iteration: 5
files_reviewed: 16
files_reviewed_list:
  - .pi/extensions/safety/index.ts
  - .pi/extensions/safety/approvals.ts
  - .pi/extensions/safety/policy.ts
  - .pi/extensions/safety/paths.ts
  - .pi/extensions/safety/audit.ts
  - bin/bootstrap.sh
  - docs/SAFETY.md
  - docs/RUNBOOK.md
  - tests/fixtures/evasion-corpus.ts
  - tests/unit/evasion-corpus.test.ts
  - tests/unit/policy-compose.test.ts
  - tests/unit/approvals.test.ts
  - tests/unit/safety-entry.test.ts
  - tests/integration/bootstrap-safety-stub.test.ts
  - tests/integration/double-enforcement.test.ts
  - tests/helpers/session.ts
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: clean
---

# Phase 4: Code Review Report (iteration 5 — FINAL VERIFICATION)

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 16
**Status:** clean (0 blockers, 0 warnings). WR-19 and IN-01..IN-04 were closed in a
follow-up cleanup pass — see `04-REVIEW-FIX.md` "Iteration 6". Only IN-05 (local
machine state: re-run `bin/bootstrap.sh` so the installed user-scope stub matches the
fixed generator) and IN-06 (the 14 accepted-and-documented limitations, published in
`docs/SAFETY.md`) remain, and neither requires a code change.

## Summary

Executed, not read. **All five iteration-4 findings are genuinely resolved.**
CR-11's livelock is gone and I re-drove my own prior probe end to end to prove
it; WR-15's dangling citations now resolve to text that exists and the
corrected claim is true; WR-16 is published with its real executed verdict in
both the corpus and the doc; WR-17 is closed without over-blocking and without
flipping any previously-blocked case; WR-18's replacement test is genuinely
falsifiable (I reverted the `toolCallId` keying in a scratch copy and watched
the oracle go red).

I also independently re-ran the suite (`1179/1179`, 67 files, **raw exit 0**),
`npm run typecheck` (clean), and `git status --porcelain` after the run
(**empty**). None of those numbers were taken on trust.

**One new finding, and it does not block the phase.** CR-11's fix — letting
any hook sharing the same `event.toolCallId` re-defer — also removes WR-12's
unguarded-window bound entirely when a `toolCallId` is *replayed*. Measured:
`markHookDeferred` grants **1000 of 1000** consecutive deferrals for a
replayed id, versus **1 of 1000** for distinct ids. It is reachable only
behind the already-accepted T-04-08 tool-name collision plus a prior human
approval, is command-bound, and no *document* claims otherwise — but
`HOOK_DEFER_TTL_MS`'s own docstring does. See **WR-19**.

### Verification of the five iteration-4 findings

| ID | Verdict | Executed evidence |
|----|---------|-------------------|
| **CR-11** | **FIXED** — all four acceptance criteria hold | See the four-criteria table below. Independent single-process driver, two jiti loads (`moduleCache:false`, `modA !== modB` asserted), both `tool_call` hooks driven exactly as `runner.js#emitToolCall` does (`:701-719`, read at source: iterate every extension's handler list in load order, return on the first `block`). |
| **WR-15** | **FIXED** | `grep -rn "WR-07" docs/ bin/ .pi/extensions/` → **zero** hits for any `WR-07 note` citation; the string was removed, not merely made to resolve. `bin/bootstrap.sh:955` and `.pi/extensions/safety/index.ts:779` (plus `approvals.ts:361`) now cite *"`docs/SAFETY.md`'s Load order is part of this"*, which exists at `docs/SAFETY.md:159` and carries the new bullet at `:193-223`. **The corrected claim is TRUE**, checked point by point: both copies do load (executed, tool lists identical), each registers its own hook (executed), the "at worst a duplicate block" claim is explicitly retracted, and the replacement claim ("the approval protocol survives it, exactly once") is what my own probe measures. |
| **WR-16** | **PUBLISHED, honestly** | Both rows executed through the real `evaluate()` with the corpus's own `FACTS`: `EV-73` (`\\localhost\C$\Users\tester\.aws`) → `allow`; `EV-74` (`C:/Users/otheruser/.aws`) → `allow`. Both are `OUT-OF-SCOPE` in the corpus and both have a table row in `docs/SAFETY.md:156-157`. The *narrowing claim* is accurate: the forward-slash UNC spelling (`//localhost/C$/...`) also returns `allow` (the row's own `why` asserts this and it is true), while the single-FILE rule still fires — `grep { path: "//localhost/C$/Users/tester/.aws/credentials" }` → `block` and `read { path: "C:/Users/otheruser/.aws/credentials" }` → `block`. A published gap, correctly stated. |
| **WR-17** | **FIXED, and it did not reopen anything** | Executed with `home = projectRoot = C:/Users/tester`: bare `grep`/`find`/`ls` with no `path` → **block** (was `allow`); explicit `path: "."` and explicit `path: "C:/Users/tester"` → **block** (unchanged). **Not over-blocked into uselessness**: with `projectRoot = C:/repo` a bare `grep`/`find`/`ls` still → `allow`; with a project *nested under* `$HOME` (`C:/Users/tester/Documents/proj`) a bare `grep`, `path:"src"` and `path:"."` all → `allow`. **No previously-blocked case became allow** — removing an exemption can only add blocks, and the full 40-row block/allow matrix I re-ran confirms it (see the regression sweep). Both halves of WR-14 that were *keepers* survive: `C:/repo/tests/fixtures/.ssh/known_hosts_fixture` and `C:/repo/node_modules/pkg/.aws` still `allow`. |
| **WR-18** | **FIXED — the test can genuinely FAIL** | Copied `.pi/extensions/safety/` into a gitignored scratch tree, reverted `markHookDeferred`'s `return existing.toolCallId === toolCallId` back to `return false`, and re-drove the identical oracle: `round2` came back **blocked by hook B** (the exact CR-11 livelock), which is precisely the assertion `bootstrap-safety-stub.test.ts:656-662` makes (`round2.blocked` must be `false`). Against the real tree: `round2` **not blocked**. `npx vitest run tests/integration/bootstrap-safety-stub.test.ts` → **7 passed**. Scratch tree removed; `git status --porcelain` empty. |

### CR-11 — the four acceptance criteria, executed

| # | Criterion | Result |
|---|-----------|--------|
| (i) | headless in this repo the guard installs with a non-empty tool list AND event list | **PASS.** Generated the stub with the *production* generator (`bin/bootstrap.sh:923-972`, extracted verbatim and run), then drove it through jiti in a process whose `cwd` is `C:\Users\Admin\Documents\ky-pi-agent` — a directory that *does* contain `.pi/extensions/safety/index.ts`. Both loads: `tools ["bash","read","write","edit","approve_ky_command"]`, `events ["tool_call","session_start"]`. |
| (ii) | under a genuine double load, block → approve → re-issue lets the command through **exactly once** | **PASS.** `round1` → blocked by **A** (mints one pending; hook B never runs — `emitToolCall` returns on the first block, so no duplicate pending). `approve()` → `true`. `round2` (new `toolCallId`) → **not blocked by either hook**; `granted.size` still `1` (the hook layer never consumes). Simulated wrapper `consume()` → `true`; a second `consume()` → `false`. `round3` → blocked by **A** again. Exactly once. |
| (iii) | a mutated command after approval still blocks (SAFE-09) | **PASS.** With the grant for `terraform apply` live, `bash { command: "terraform destroy" }` → **blocked by A** (different `requestKey`, never granted). The wrapper half is independently proven by `tests/integration/double-enforcement.test.ts` (untouched by iteration 5; case 2 hook-allow + wrapper-block pair, case 3 paired negative control). |
| (iv) | approvals stay one-shot, command-bound and expiring, and cannot be consumed twice | **PASS.** Executed against `approvals.ts` with an injected clock: `validate` true at `T`, false at `T+TTL+1`; `approve` false past TTL; `peek` false past TTL; `consume` false past TTL; `approve` with the wrong `command` → `false`, wrong `reason` → `false`, correct triple → `true`; `consume` once `true`, twice `false`. `approve_ky_command.execute()` re-driven directly: `hasUI:false` → throws, `select→"Deny"` → throws, `select→undefined` → throws, `select→"approve"` (wrong case) → throws, `select→"Approve"` → returns. Deny-by-default intact. |

**Did keying on `toolCallId` create the opposite bug?** Partially — and this is
the one thing the fix pass did not check. A **genuinely distinct re-issue does
NOT get a free pass**: with an unconsumed grant, `x-2` defers once and `x-3`
is **blocked**, exactly WR-12's bound. A **replayed `toolCallId` DOES get a
free pass**, repeatedly: `x-2` re-issued three times in a row all deferred.
Quantified directly against `markHookDeferred` with a fixed clock: **1000/1000
deferrals granted for a replayed id, 1/1000 for distinct ids**. See **WR-19**.

### Final evasion-suite numbers (executed independently, not read from the fix report)

Driven through the real `evaluate()` with the corpus's own fixture facts
(`cwd`/`projectRoot = C:/repo`, `home = C:/Users/tester`, `HEAD = main`):

```
total corpus cases          : 74
blocked by real evaluate()  : 60
NOT blocked (allow)         : 14
bucket mismatches           : none
duplicate corpus ids        : none
not-blocked ids             : EV-09 EV-27 EV-35 EV-36 EV-38 EV-39 EV-40 EV-41
                              EV-42 EV-56 EV-57 EV-65 EV-73 EV-74
OUT-OF-SCOPE ids in corpus  : (identical set)
EV table rows in docs/SAFETY.md : (identical set)
not-blocked but not in doc  : []
doc row but still blocked   : []
OUT-OF-SCOPE but not in doc : []
doc row but not OUT-OF-SCOPE: []
```

**Delta against iteration 4's 12: exactly `EV-73` and `EV-74`, nothing else.**
I re-derived the previous 12 and diffed: no other id moved, in either
direction, and no row was re-bucketed or softened. `docs/SAFETY.md`'s "Known
bypasses" table lists exactly this 14-id set, cross-checked in **both**
directions. (`EV-28`/`EV-30` appear inside the section text but only as prose
cross-references within `EV-27`'s own cell; `evasion-corpus.test.ts`'s
`tableRowIds()` regex correctly counts row *identifiers* only, so this is not
a doc/corpus drift.)

### Regression sweep (all clean unless noted)

- **Deny-by-default holds everywhere I could reach it.** All seven governed
  tool names × `null` / `[]` / `"x"` / `7` / `undefined` → `block`. `{}` →
  `block` for `bash`/`read`/`write`/`edit`; `allow` for `grep`/`find`/`ls`
  (the documented absent-optional-`path` default, evaluated against
  `projectRoot`, which is not sensitive in the fixture). `read {path:""}`,
  `read {path:42}`, `grep {path:[…]}`, `grep {glob:[…]}`, `find {path:3}` →
  all `block`. Unknown tool name → `allow` (documented design boundary,
  EV-42). A throwing `currentBranchFor` oracle → `block`.
- **Every previously-blocked shape still blocks**: `git push`,
  `git push --force origin main`, `git commit`, `glab mr merge`,
  `/usr/bin/env git push`, `env.exe git push`, `/usr/bin/sudo git push`,
  `/usr/bin/nohup git push`, `bash.exe -c "git push"`, `/usr/bin/xargs git
  push`, `g=push; git $g`, `/usr/bin/env aws secretsmanager
  get-secret-value`; `terraform apply` / `kubectl delete pod x` (and their
  `/usr/bin/env` forms) → `confirm`. Paired negatives intact: `git status`,
  `git -C /repo status`, `git --no-pager log`, `echo hi`,
  `/usr/bin/env echo hi`, `terraform plan`, `aws s3 ls`, `kubectl get pods` →
  `allow`.
- **CR-07 fully intact** (14 shapes re-run): `~/.aws` directory, `ls ~/.aws`,
  `find ~/.ssh`, `~`, `C:/`, `$HOME`, `~/.aws/../.aws`, `glob:".env"`,
  `~/.kube`, `~/.gnupg`, MSYS `/c/...`, `/cygdrive/c/...`, case-variant
  `C:/USERS/TESTER/.AWS`, trailing slash, `read ~/.aws/credentials` — all
  `block`.
- **Detonation + containment intact**: `~/.bashrc`, `~/.gitconfig`,
  `.git/hooks/pre-commit`, `.github/workflows/x.yml`, `.gitlab-ci.yml`,
  `C:/other/file.txt` → `block`; `src/a.ts` → `allow`.
- **`RB-04-01` is still `OUTSTANDING` in BOTH places** — `docs/RUNBOOK.md:862`
  (summary table) and `:866` (`**Status:** OUTSTANDING`). Not flipped.
- **The iteration-5 code diff is minimal and contains no smuggled behaviour.**
  Stripped of comments, the whole of `80f53b1` + `c5884c7` + `c940907` across
  `.pi/extensions/safety/` is: the `HookDeferredMarker` interface, the map's
  value type, the sweep's field access, `markHookDeferred`'s new parameter and
  its two changed lines, the hook's call site, and WR-17's removal of the
  four-line exemption plus its now-unused import. Nothing else.
- **Tautology check (fifth and final pass), every test touched in iteration 5:**
  - `bootstrap-safety-stub.test.ts` CR-11 case — **genuinely falsifiable**,
    proved by scratch-copy revert (above). This is the first iteration in five
    in which this file's double-load case can actually fail for its stated
    reason.
  - `approvals.test.ts` CR-11 cases (`:210-222`) — falsifiable: the
    same-`toolCallId`-returns-true assertions fail outright against the
    `return false` shape.
  - `policy-compose.test.ts` WR-14/WR-17 block — falsifiable: restoring the
    exemption flips the rewritten case from `block` to `allow`; the four
    CR-07 RE-RUN cases in the same block are unchanged and still pass.
  - `evasion-corpus.ts` EV-73/EV-74 — driven by Group A′ through the real
    `evaluate()` and asserted to return `allow`, so the published limit
    cannot go stale silently; Group B's `tableRowIds()` count is derived from
    the corpus, never transcribed. Both directions verified independently by
    me as well.
  - `safety-entry.test.ts` WR-12 case (distinct `toolCallId`s per round) —
    **not** a CR-11 regression test and correctly does not claim to be: it
    passes both before and after the `toolCallId` change, because it is a
    *bound-preservation* test. Non-vacuous for its own claim (it fails if
    `markHookDeferred` ever returns `true` unconditionally).

## Critical Issues

None.

## Warnings

### WR-19: CR-11's same-`toolCallId` exemption removes WR-12's unguarded-window bound entirely for a REPLAYED `toolCallId`, and `HOOK_DEFER_TTL_MS`'s own docstring now over-claims

**File:** `.pi/extensions/safety/approvals.ts:385-393` (`markHookDeferred`);
`:122-134` (`HOOK_DEFER_TTL_MS`'s docstring, the false claim);
`.pi/extensions/safety/index.ts:680` (the call site)

**Disposition: does NOT block the phase.** This is a narrow, conditional
robustness regression, not a live fail-open on any path reachable in this
repository today. It should be closed (or published) in a follow-up, not
treated as a gate on shipping Phase 4.

**Issue.** `markHookDeferred` returns `true` for *every* call sharing an
unexpired marker's `toolCallId`. That is exactly right for the CR-11 case (N
loaded copies, one tool call). It is also unconditionally true for the *same
id presented N times*, which is a different thing. Executed against the real
function with a fixed clock:

```
same-toolCallId    deferrals granted in 1000 consecutive ms : 1000
distinct-toolCallId deferrals granted in 1000 consecutive ms:    1
```

And through the real double-loaded hooks, with a grant left unconsumed:

```
re-issue "x-2"  -> deferred (not blocked)     <- WR-12's one allowed deferral
re-issue "x-3"  -> BLOCKED                     <- WR-12's bound, preserved
re-issue "x-2"  -> deferred   (replay)
re-issue "x-2"  -> deferred   (replay)
re-issue "x-2"  -> deferred   (replay)
```

`HOOK_DEFER_TTL_MS`'s docstring states the marker's *"only job is to bound the
maximum UNGUARDED window if the wrapper never runs at all (the documented
T-04-08 tool-name collision …)"*. For a replayed id that bound no longer
exists: the unguarded window becomes the grant's full `APPROVAL_TTL_MS` (10
minutes) with unlimited executions, instead of WR-12's ~1 per 5 s. That is the
exact "code no longer matches its own docstring" shape `docs/SAFETY.md`'s
Authority section calls a false sense of security.

**Reachability, stated honestly.** All three must hold: (a) an approval grant
is never consumed — which requires this extension's own wrapper not to be the
one that executes, i.e. the T-04-08 tool-name collision (documented, accepted,
compensated by SAFE-01, and not present in this repo today: `grep`/`find`/`ls`
cannot produce a `confirm` verdict at all, so they are not a second route);
(b) a human has already approved that exact command (grants are command-bound
— only the approved command benefits); (c) the model/provider re-uses the same
`toolCallId`, which is possible because Pi passes the *provider's* id straight
through (`pi-agent-core/dist/agent-loop.js:268,301,337,462` — `toolCallId:
toolCall.id`, never harness-generated). Nothing in `docs/SAFETY.md` states a
bound that this contradicts, so no published claim is false; the false claim is
confined to the source docstring.

**Fix (one of two, both small).** Either bound the same-id case explicitly:

```ts
interface HookDeferredMarker {
    readonly toolCallId: string;
    readonly count: number;       // how many hooks of THIS tool call deferred
    readonly expiresAt: number;
}
// ...
if (existing !== undefined && existing.expiresAt > now) {
    if (existing.toolCallId !== toolCallId) return false;
    if (existing.count >= MAX_HOOKS_PER_TOOL_CALL) return false;  // e.g. 4
    store.hookDeferred.set(requestKey, { ...existing, count: existing.count + 1 });
    return true;
}
```

…or, if the count cap is judged not worth the state, correct
`HOOK_DEFER_TTL_MS`'s docstring to say what it now actually bounds ("one
deferral per distinct `toolCallId` per window; a replayed id is not bounded")
and add one line to `docs/SAFETY.md`'s "Load order is part of this" bullet so
the residual is published rather than only true.

## Info

### IN-01: `paths.ts#sameCanonicalPath`'s export rationale is now stale, and the export itself is unused outside its own module

**File:** `.pi/extensions/safety/paths.ts:314-323`
WR-17 removed `policy.ts`'s only import of it. The docstring still says
*"Exported for WR-14: `policy.ts#evaluateSearchRootField` needs the SAME 'are
these the same canonical path' test … to decide whether the session's project
root and home directory canonicalise identically"* — no caller does that any
more. `grep -rn sameCanonicalPath .pi/ tests/` shows four remaining uses, all
inside `paths.ts` itself (kubeconfig + four detonation rules), and no test
imports it. Not dead code (the function is used), but a dead `export` with a
false justification attached. **Fix:** drop the `export` keyword and the
"Exported for WR-14" paragraph, or keep the export and say plainly it is
retained for future callers.

### IN-02: the corpus's own prose still says `evaluate()` governs four tool names

**File:** `tests/fixtures/evasion-corpus.ts:57-62`, `:646`
Carried unchanged from iterations 2–5 (info-tier, correctly outside
`fix_scope: critical_warning`). The module docstring still says *"the four
tool names `evaluate()` actually governs"* and EV-42's `why` still says *"a
fifth tool name"*. Both false: `policy.ts` governs seven. **Fix:** say seven;
EV-42's `why` should read "an eighth tool name it does not recognise".

### IN-03: `docs/SAFETY.md`'s EV-42 row says "a sixth-party tool name"

**File:** `docs/SAFETY.md:152`
Artifact of the four→seven rewrite. Should read "an eighth tool name".

### IN-04: audit rows for a `grep` blocked on its `glob` still record an empty `command`

**File:** `.pi/extensions/safety/index.ts:211-223`
Carried from iterations 2–5 (info-tier, out of fix scope).
`extractCommandOrPath` reads `record.path` for every non-`bash` tool, so a
blocked `grep { pattern: "=", glob: ".env" }` writes `command: ""` — losing
the exact field that caused the block. **Fix:** for `grep`, fall back to
`glob`, then `pattern`.

### IN-05: machine state — the installed stub is still the pre-CR-06 shape, and no trust decision is recorded

**File:** `~/.pi/agent/extensions/ky-safety/index.ts` (not tracked)
Re-verified this session, unchanged since iteration 4: the live stub is still
`export { default } from "C:/Users/Admin/Documents/ky-pi-agent/.pi/extensions/safety/index.ts";`
(383 bytes, mtime 2026-08-14 05:53) — `bin/bootstrap.sh` has not been re-run
since `c3f5d2c`. `~/.pi/agent/trust.json` does not exist. Consequence worth
recording: the *fixed* stub (the one carrying CR-09/CR-11's own comment text)
is not what is installed. Old and new stubs register identically, so nothing
is unguarded — but `bin/bootstrap.sh` should be re-run before this phase is
called done on this machine, or the next reader will diff the installed bytes
against the generator and think the fix did not land.

### IN-06: accepted-and-documented limitations (no action required)

**File:** `docs/SAFETY.md:133-157` ("Known bypasses this guard does not
catch") — `:144` EV-09, `:145` EV-27, `:146-152` EV-35/36/38/39/40/41/42,
`:153` EV-56, `:154` EV-57, `:155` EV-65, **`:156` EV-73, `:157` EV-74**;
plus `docs/SAFETY.md:104-131` ("What this guard does not register (WR-09)")
and `:159-223` ("Load order is part of this" — T-04-08, the mutable
`event.input` risk, and the newly-published double-load bullet at `:193-223`).

All **fourteen** not-blocked corpus rows are published there, driven through
the real `evaluate()` by `evasion-corpus.test.ts` Group A′ so the published
limit cannot go stale silently, and cross-checked in both directions by Group
B (I re-derived both directions independently above; both diffs are empty).
`docs/SAFETY.md` does not over-claim anywhere I could falsify it: it opens
with "a **mistake-catcher, not a security boundary**", states there is no
OS-level sandbox on Windows, names GitLab server-side branch protection as the
only non-theatre control, honestly narrows the `grep`/`find`/`ls` guarantee to
hook-only, and now honestly retracts the "at worst a duplicate block" claim by
name instead of quietly rewording it. `RB-04-01` remains correctly
`OUTSTANDING` in both places in `docs/RUNBOOK.md`. These are legitimate
dispositions for this phase and are **not** blockers.

---

## Bottom line

**Is this safety layer honest about what it does and does not catch on
Windows, and is it fit to ship as a mistake-catcher?** Yes, on both counts,
and after five adversarial passes that is a real result rather than a
courtesy: the fourteen published bypasses are exactly the fourteen the real
`evaluate()` lets through — I derived that set myself, in both directions,
without reading the fix report's numbers — the document leads with
"mistake-catcher, not a security boundary", names GitLab's server-side
protection as the only control that is not theatre, and this pass is the first
in which a false claim was retracted *by name* in the same commit that fixed
the thing it was false about, rather than quietly reworded. The confirm →
approve → re-issue protocol now genuinely survives the double load this repo's
own bootstrap creates — block, one approval, one execution, then blocked again
— and I proved the test that pins that can fail, which no previous iteration
of this file could say. What remains is one narrow, conditional robustness
gap: the mechanism that lets every loaded copy's hook defer for one tool call
also lets a *replayed* tool-call id defer without limit, which only bites
behind the already-accepted T-04-08 collision and only for a command a human
already approved — it makes a source docstring over-claim, not a published
document, and it is a follow-up rather than a gate. Ship it, re-run
`bin/bootstrap.sh` so the installed stub matches the fixed generator, and
carry WR-19 forward.

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — iteration 5, FINAL verification_
