# Phase 4: Safety & Deployment Guardrails - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

A confused model on a laptop where merging to `main` auto-deploys to AWS cannot cause an irreversible action, and the limits of that protection are documented rather than assumed.

**Requirements:** SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05, SAFE-06, SAFE-07, SAFE-08, SAFE-09, SAFE-10, SAFE-11, SAFE-12, SAFE-13, SAFE-14, SAFE-15, SAFE-17

(SAFE-16 is owned by Phase 1 — the classifier shipped in 01-07 and the runbook sentence is `RB-01-01`. Phase 4 must not re-implement it or renumber its runbook entry.)

**Success criteria (from ROADMAP.md, binding — this is the spec):**

1. **Verified live on the work laptop**: a push to a protected GitLab branch is rejected *server-side*, before any harness rule is trusted — this is the only control that is not theatre.
2. A blocked command stays blocked **inside a spawned subagent** and under `--mode json` where confirmation is deny-by-default, proven by CI tests rather than interactive trial — project-scoped extensions never load in subagents, and `noOpUIContext.confirm` returns `false`.
3. `g=push; git $g`, `sh -c "..."` and heredoc forms are caught by AST parsing, and anything unparseable is refused rather than allowed; enforcement happens twice, at the hook and inside the wrapped `bash` tool, because a later hook can mutate the input after approval.
4. Writes are blocked when `HEAD == main` and `glab mr merge` is refused, while `git fetch/rebase/diff/log origin/main` and `git worktree add -b feat main` still work; `.env`, `~/.aws/credentials`, kubeconfig and `*.tfstate` reads are blocked, and `terraform apply|destroy|import`, mutating `aws` calls and `kubectl delete` require confirmation.
5. At least 30 evasion attempts are each blocked or explicitly documented as out of scope, every allow and block appears in an audit JSONL, and a published table names the bypasses the guard does **not** catch.

**Contains [RUNBOOK] requirements:** SAFE-01 only. There are **no work-laptop credentials, no GitLab access and no network egress from this machine**, so SAFE-01 is planned as an appended `RB-04-xx` entry in the existing `docs/RUNBOOK.md` whose live check is **OUTSTANDING**. It may not be planned as passing. `RB-01-xx`, `RB-02-xx` and `RB-03-xx` already exist — **append, never recreate or renumber**. `tests/unit/docs-policy.test.ts` parses both the summary-table row and the `**Status:**` line of every `RB-<phase>-<n>` entry and reports a disagreement as `INCONSISTENT`; that guard must keep passing.

SAFE-02..SAFE-14 and SAFE-17 carry `[FAUX]`: they are fully verifiable on this machine and must be planned as *passing*, not outstanding. SAFE-15 carries no tag — it is a documentation deliverable (the published limits table) and is likewise verifiable here.

</domain>

<decisions>
## Implementation Decisions

Recorded in PROJECT.md (Key Decisions, Constraints), ROADMAP.md and `.planning/research/{PITFALLS,ARCHITECTURE,STACK}.md`. Binding on this phase; not to be re-derived and not to be re-litigated.

**Already decided, binding:**

1. **Server-side branch protection is verified first, before any harness rule is trusted.** SAFE-01 is criterion 1 for a reason: GitLab protected branches and push rules are the only control enforced where the model has no code execution, so they catch *everything* in the bypass table including every obfuscation class the AST parser misses (PITFALLS Pitfall 13, closing row: "**The only control that is not theatre.**"). The harness guard is a mistake-catcher layered on top of it, never a substitute. The runbook entry must say so.

2. **`unbash@4.0.10` is the parser. Parse to an AST; never string-match.** ISC, zero dependencies. String matching over `git push` / `glab mr merge` is defeated by variable indirection (`g=push; git $g`), command substitution, nested shells (`sh -c`, `bash -lc`, `eval`), heredoc-to-script, `git -C /other/repo`, `env -i` wrappers, task-runner indirection (`npm run deploy`), base64 encoding, backgrounding, quoting tricks (`g"i"t p'u'sh`, `$IFS`), shell functions, PATH shadowing and alternate clients — **all of which a confused model produces naturally, not just an adversary** (PITFALLS Pitfall 13, verified-at-source for the mechanism, reasoned from shell semantics for the enumeration). Resolve wrappers (`sudo`, `env`, `sh -c`, `xargs`) to the underlying invocation.

3. **Anything unparseable fails closed (SAFE-03).** Command substitution, backticks, heredocs and backgrounding are *refused*, not allowed. A parse failure is a deny, not a fallthrough. This is the difference between a guard and a decoration.

4. **Deny-by-default, and the confirmation protocol is block → approval-tool → re-issue — never an inline `confirm()`.** `noOpUIContext.confirm` returns `false` and `select` returns `undefined` under `-p`/RPC/json. A guard shaped `if (ctx.hasUI && !ok) block` therefore **fails open headless** — it silently permits everything in CI (PITFALLS Anti-Pattern 4 / ARCHITECTURE Anti-Pattern 4). Write the deny as the default branch and add a CI test asserting the deny under `--mode json`. The approval flow is: `tool_call` → AST parse → policy deny → create pending approval → block with a request id → model calls `approve_*` → `ctx.ui.select` → grant **one-shot, keyed to the exact command** → model re-issues → hook allows → wrapper re-checks → executes → audit row (ARCHITECTURE "Key data flows" #5).

5. **Enforcement happens twice, and extension load order is part of the security model.** Pi's own extension types document it (`src/core/extensions/types.ts:899-903`): "`event.input` is mutable… Later `tool_call` handlers see earlier mutations. **No re-validation is performed after mutation.**" A later-loaded extension can rewrite a command after your guard approved it. Therefore: hook for UX and early rejection; **wrapped tool `execute` for enforcement** (ARCHITECTURE Anti-Pattern 3, verified as the pattern the one Pi extension that takes infra safety seriously uses).

6. **Safety extensions install at USER scope, and the blocked-command test runs INSIDE a subagent.** Project trust requires a UI; `resolveProjectTrusted` returns `false` with no UI, so **project-scoped extensions do not load in subagents**, which spawn real headless child `pi` processes (`pi-subagents@0.47.1` `src/runs/shared/pi-spawn.ts:139-163`) — PITFALLS Pitfall 15. User-scope extensions load regardless of project trust, so this is entirely avoidable. The failure signature is nasty: a guard that fires in the main session and never appears in the subagent audit log reads as "the subagent did nothing dangerous" rather than "the guard was absent". SAFE-11 and SAFE-12 are two halves of one fix.

7. **`safety/` imports nothing from routing or workflows.** It sits in the credential/exec path and must be source-reviewable in isolation (ARCHITECTURE dependency table: "safety ↔ everything | none — reads policy files, writes audit"). Phase 4 depends on Phase 1 only.

8. **There is no sandbox on Windows, and the phase must say so rather than overclaim.** `pi-sandbox` is macOS/Linux only (`src/extension.ts:114` emits `Sandbox not supported on ${platform}`) and additionally requires `rg` on PATH. The OS-level boundary — the only obfuscation-independent one — is unavailable here. The honest ceiling is a mistake-catcher plus server-side branch protection, and SAFE-15's published table is where that is stated, not hidden.

9. **Read `@ramtinj95/pi-infra-command-guard@0.9.1`; do NOT install it.** Its scope is a near-exact match (terraform apply, kubectl delete, mutating aws/az/gcloud, approval overlay with scoped bypasses) and it defeats indirection because it parses with `unbash`. But it hard-peer-depends on `@howaboua/pi-codex-conversion`, which drags in `openai`, `web-tree-sitter`, `tree-sitter-bash`, `ws` and `js-tiktoken` — a huge unreviewed surface for a guard, and it has 0 stars. **Steal the `unbash` approach and the block→approval-tool→re-issue protocol; write our own** (CLAUDE.md "What NOT to Use"; ROADMAP Phase 4 Research note).

10. **`cc-safety-net` is not the answer either.** 1,482 stars is tempting, but its Pi entry is prebuilt `dist/pi/index.js` — not source-reviewable, which fails the security constraint for tool-path code — and it peer-depends on `@opencode-ai/plugin`. Its canonicalisation is *path* canonicalisation, not AST. Its block-only Pi adapter (`{ block: true, reason }`, never a prompt, fails closed on malformed events) is worth copying as a shape.

11. **The non-bash surface is real and in scope (SAFE-13).** A `write`/`edit` into `.git/hooks/pre-commit`, `.git/config`, `~/.bashrc`, `~/.gitconfig` (`[alias]`) or a CI workflow file is a deferred detonation that no bash matcher sees — a later benign command sets it off. Guard the write/edit tools, not only `bash`.

12. **`/share` cannot be blocked by any extension** (built-in commands are matched before extension commands). That is SAFE-16, already discharged in Phase 1 via machine state (`gh` unauthenticated) and `RB-01-01`. Do not re-open it in Phase 4.

13. **The user's work repo is GitLab and merging to `main` immediately deploys to AWS.** `glab mr merge` *is* the deploy trigger, which is why SAFE-05 names it specifically. Terraform is owned by an infra team, so a merged `.tf` change **is** an infra change — the confirm gate on `terraform apply|destroy|import` is not paranoia about a local plan, it is about the merge.

**Claude's discretion (guided by ROADMAP criteria + `.planning/research/`):**
The policy file format and whether policy lives in JSON or TypeScript; file decomposition inside `safety/` (ARCHITECTURE:161-166 sketches `shell.ts` → canonical invocations, a policy module, and `audit.ts`); the exact `approve_*` tool name and its parameter schema; how one-shot grants are keyed and expired; which built-in tools get wrapped and how the wrapper is installed; the `RB-04-xx` numbering and section ordering in `docs/RUNBOOK.md`; where the SAFE-15 limits table is published (`docs/` is the obvious home) and its exact columns; and how the 30 evasion attempts are organised as a test corpus.

**Decisions taken autonomously during context generation** (per the Standing Operating Policy — the user is asleep; noted here rather than asked):
- Phase slug is `04-safety-deployment-guardrails`, following Phase 3's convention of dropping `&` from the phase title.

</decisions>

<code_context>
## Existing Code Insights

Phases 1-3 created the shape this phase writes into. Do not re-create it. 655 tests green, `tsc --noEmit` clean.

**The scope problem — read this before planning SAFE-11.** Everything shipped so far lives under `.pi/extensions/` and is therefore **project-scoped**: `diagnostics/` (9 files), `providers/` (4 files), `harness/index.ts`. That is correct for those subsystems and *wrong* for safety, which must load in headless subagents where project trust is never granted. The planner must pick the user-scope install path explicitly and test it — `bin/bootstrap.sh` already exists and already has `--check-only` / `--assert-hardening` modes, and `tests/integration/load-paths.test.ts` + `tests/unit/extension-layout.test.ts` already assert on where extensions live. Expect both to need extending rather than replacing.

**Phase 2's JSONL machinery is the audit log's foundation (SAFE-14).** `.pi/extensions/diagnostics/jsonl.ts` (append-only writer), `redact.ts` (redacted-at-capture), `schema.ts`, plus `turns.ts` and `wire.ts` as worked examples, and `tests/unit/jsonl-append-only.test.ts`, `tests/unit/jsonl-rotation.test.ts`, `tests/integration/jsonl-concurrency.test.ts` proving append-only, rotation and concurrent-write behaviour. **Reuse the rotation/append machinery rather than writing a second one** — but keep the import direction such that `safety/` stays independently reviewable (decision 7). If that means the shared writer moves to a neutral location that both import, that is a legitimate refactor; a `safety/ → diagnostics/` import is not. `.pi/audit.jsonl` is the destination named in ARCHITECTURE:462.

**`docs/RUNBOOK.md` already exists** with `RB-01-01..03`, `RB-02-01..03` and `RB-03-01..05`, a stated four-part entry contract (exact command, expected output, offline proxy, status line), per-phase summary tables and per-phase machine-state sections. Phase 4 **appends** an `RB-04-xx` section. `tests/unit/docs-policy.test.ts` parses both the summary-table row and the `**Status:**` line of every entry and reports a disagreement as `INCONSISTENT` — the new entry must satisfy it in both places.

**Also present and directly reusable:** `tests/helpers/{git.ts, pi.ts, stub-bin.ts, win-quote.ts, session.ts, faux.ts, logs.ts, loopback.ts}` — `git.ts` and `stub-bin.ts` in particular are what a `HEAD == main` test and a PATH-shadowing evasion test want; `win-quote.ts` matters because the evasion corpus is full of quoting forms. `.gitignore` already covers `.pi/logs/`, `*.jsonl` — confirm `.pi/audit.jsonl` is covered before assuming it. No build step: Pi loads `.ts` through jiti and a build breaks `/reload`.

**Pi's own bundled examples are on point and take precedence over any extension README** (`%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\examples/extensions/`): `permission-gate.ts`, `protected-paths.ts`, `confirm-destructive.ts`, `dirty-repo-guard.ts`, `git-checkpoint.ts`. Original TypeScript for anything in `dist/` is recoverable from `dist/**/*.js.map` `sourcesContent`. Cite `file:line`; mark anything unverifiable as UNVERIFIED rather than asserting it.

**Verification tools:** `--mode json` (`ctx.mode === "json"`, `ctx.hasUI === false`) is how the headless deny is proven in CI; `SessionManager.inMemory()` and `fauxProvider()` for session-layer wiring; `pi --mode json` in a temp dir parsing JSONL lines for end-to-end. The subagent test (SAFE-12) needs a real spawned child process, which is the expensive one — plan it deliberately.

</code_context>

<specifics>
## Specific Ideas

- **The bypass table in `.planning/research/PITFALLS.md:452-468` is already a 14-row evasion corpus with worked examples.** SAFE-17 needs ≥30 attempts; that table is the spine, and the remaining rows come from expanding each class (three quoting variants, three nesting depths, both Git Bash and Windows path forms). Every row lands in exactly one of two buckets — **blocked** or **explicitly documented as out of scope** — and the out-of-scope bucket *is* the SAFE-15 published table. Build them as one artifact, not two.
- **The Git Bash path question is the phase's one genuine research item.** Whether `unbash` handles `/c/Users/...` versus `C:\Users\...` correctly **in argument position** is recorded UNVERIFIED (ARCHITECTURE:631) and is a real cross-platform risk for path-scoped policy — SAFE-06 (`.env`, `~/.aws/credentials`, kubeconfig, `*.tfstate`) and SAFE-08 (writes outside the project dir) both depend on comparing a parsed argument against a path. Settle it by **executing `unbash` locally against both forms**, not by reading its docs. Whatever the answer, the path comparison must normalise both forms before matching.
- **SAFE-04's allow-list is as important as its deny-list, and it is easy to get backwards.** `git fetch`, `rebase`, `diff`, `log origin/main` and — critically — `git worktree add -b feat main` must still work with `HEAD == main`. `worktree add` *reads* `main` to create a new branch; a naive "any command mentioning main" rule breaks the single most useful escape hatch the user has.
- **SAFE-06 exists because `.tfstate` holds plaintext secrets that would enter model context.** The block is about what reaches the context window, not about file permissions. Note `~/.aws/credentials` may not exist on an SSO machine — the rule is still required, and its test must not depend on the file being present.
- **SAFE-07's `aws` gate must distinguish mutating from read-only calls.** `aws sts get-caller-identity` and `aws s3 ls` are how a session orients itself; gating them makes the harness unusable and trains the user to approve reflexively, which is worse than no gate. `@ramtinj95/pi-infra-command-guard`'s source is the reference for where that line goes.
- **The audit log must record allows, not just blocks (SAFE-14).** A log of blocks alone cannot answer "was the guard even loaded?" — which is precisely the Pitfall 15 failure signature. An allow row in the subagent's audit log is the positive evidence that SAFE-12 is really testing.
- **SAFE-01's runbook entry needs an offline proxy like every other entry.** The four-part contract requires one. The honest proxy is a local test that a push to a branch matching the protected pattern is *attempted* and its rejection is *parsed correctly* — using `tests/helpers/git.ts` against a local bare repo with a pre-receive hook. That proves the harness reads the rejection; only the live check proves GitLab is configured.
- Pi's `tool_call` result shape is `{ block?: boolean, reason?: string, terminate?: boolean }`; `terminate` applies only to a blocked call and only stops the agent when *every* finalized result in the batch terminates. Do not rely on `terminate` as the enforcement mechanism.

</specifics>

<deferred>
## Deferred Ideas

- Routing, `/cheap`/`/balanced`/`/max`, `/escalate` and the capability guard — Phase 5. Safety imports nothing from routing by design.
- `/quick` and the evidence gate that composes routing + safety end to end — Phase 6.
- Third-party extension pins and their source review, including `pi-subagents` itself — Phase 7, where every pin is re-verified at planning time. Phase 4 may *read* `@ramtinj95/pi-infra-command-guard` but installs nothing.
- Quality gates, diff review and advisor escalation — Phase 8.
- OS-level sandboxing (`pi-sandbox`) — out of scope on Windows entirely; revisit only if the user moves to macOS. Phase 4 documents its absence rather than working around it.
- `pi-defender` strict mode (every bash command requires human approval) — recorded as the genuinely strong non-OS control but rejected for a flow-state daily driver. Not v1.
- SAFE-16 (`gh` unauthenticated) — Phase 1, already discharged; `RB-01-01` stands.

</deferred>
