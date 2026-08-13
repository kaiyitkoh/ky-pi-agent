# Phase 4: Safety & Deployment Guardrails - Research

**Researched:** 2026-08-14
**Domain:** Bash-AST command guarding, deny-by-default approval protocol, user-scope extension loading, audit logging — on Pi 0.84.1, Windows, no sandbox
**Confidence:** HIGH (every mechanism claim below is verified at `file:line` against Pi 0.84.1's recovered TypeScript, this repo's own code, or an executed `npm pack` of the reference guard package)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Claude's Discretion

Guided by ROADMAP criteria + `.planning/research/`. The policy file format and whether policy lives in JSON or TypeScript; file decomposition inside `safety/` (ARCHITECTURE:161-166 sketches `shell.ts` → canonical invocations, a policy module, and `audit.ts`); the exact `approve_*` tool name and its parameter schema; how one-shot grants are keyed and expired; which built-in tools get wrapped and how the wrapper is installed; the `RB-04-xx` numbering and section ordering in `docs/RUNBOOK.md`; where the SAFE-15 limits table is published (`docs/` is the obvious home) and its exact columns; and how the 30 evasion attempts are organised as a test corpus.

**Decisions taken autonomously during context generation** (per the Standing Operating Policy — the user is asleep; noted here rather than asked):
- Phase slug is `04-safety-deployment-guardrails`, following Phase 3's convention of dropping `&` from the phase title.

### Deferred Ideas (OUT OF SCOPE)

- Routing, `/cheap`/`/balanced`/`/max`, `/escalate` and the capability guard — Phase 5. Safety imports nothing from routing by design.
- `/quick` and the evidence gate that composes routing + safety end to end — Phase 6.
- Third-party extension pins and their source review, including `pi-subagents` itself — Phase 7, where every pin is re-verified at planning time. Phase 4 may *read* `@ramtinj95/pi-infra-command-guard` but installs nothing.
- Quality gates, diff review and advisor escalation — Phase 8.
- OS-level sandboxing (`pi-sandbox`) — out of scope on Windows entirely; revisit only if the user moves to macOS. Phase 4 documents its absence rather than working around it.
- `pi-defender` strict mode (every bash command requires human approval) — recorded as the genuinely strong non-OS control but rejected for a flow-state daily driver. Not v1.
- SAFE-16 (`gh` unauthenticated) — Phase 1, already discharged; `RB-01-01` stands.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAFE-01 | GitLab server-side protected branches verified by an attempted push that fails **[RUNBOOK]** | Environment Availability / Validation Architecture — offline proxy is a local bare repo + `pre-receive` hook; live check stays OUTSTANDING, appended as `RB-04-01` |
| SAFE-02 | Bash commands parsed to an AST with `unbash`, resolving wrappers | Pattern 1, Pattern 2, Code Example "unbash AST vocabulary"; wrapper-resolution reference lifted from `@ramtinj95/pi-infra-command-guard`'s `shell.ts:724-835` |
| SAFE-03 | Anything unparseable fails closed | Pattern 1 (the phase's central finding: node-type deny-list, not `errors.length`), Pitfall 1 |
| SAFE-04 | Writes blocked on `HEAD==main`; reads remain allowed | Pattern 2 (git classification), Pitfall 5, Don't-Hand-Roll row 3, Open Question 3 |
| SAFE-05 | `glab mr merge` blocked | Same policy table as SAFE-04; User Constraints decision 13 |
| SAFE-06 | Reads of `.env`/`~/.aws/credentials`/kubeconfig/`*.tfstate` blocked | Pitfall 3 (Windows path normalisation is the crux); Validation Architecture `path-policy.test.ts` |
| SAFE-07 | `terraform apply\|destroy\|import`, mutating `aws`, `kubectl delete` require confirmation | Code Example "AWS mutating vs. read-only classification", Pitfall 4 |
| SAFE-08 | Writes/deletes outside project directory blocked | Same path-policy design as SAFE-06/13 |
| SAFE-09 | Enforcement happens twice | Pattern 3, Pattern 5 |
| SAFE-10 | Deny-by-default; CI asserts headless deny | Pattern 4, Code Example "deny-by-default confirm shape", Validation Architecture `headless-deny.test.ts` |
| SAFE-11 | Safety extensions install at user scope | Pattern 6, Assumption A1, Open Question 1 |
| SAFE-12 | Blocked-command test passes inside a spawned subagent | Open Question 2 (the phase's most expensive test; concrete proxy design + Phase 7 EXT-09 cross-reference) |
| SAFE-13 | Non-bash surface guarded | User Constraints decision 11; Don't-Hand-Roll table; path-policy design shared with SAFE-06/08 |
| SAFE-14 | Every allow and block written to audit JSONL | Don't-Hand-Roll row 2 (extraction to a shared `.pi/lib/jsonl.ts`), Recommended Project Structure |
| SAFE-15 | Published limits table naming known bypasses | Folded into SAFE-17's corpus as one artifact (Focus E); State of the Art |
| SAFE-17 | ≥30 evasion attempts, each blocked or documented out of scope | Validation Architecture `evasion-corpus.test.ts`; PITFALLS.md's 14-row bypass table as the corpus spine (carried over by reference, not reproduced here to avoid duplication — see `.planning/research/PITFALLS.md:452-468`) |

(SAFE-16 is owned by Phase 1 — already discharged, not addressed here per User Constraints decision 12.)
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted directives that bind this phase's plan, beyond the CONTEXT.md decisions above:

- **Security posture:** extensions execute arbitrary code with full user permissions on a laptop holding live AWS SSO credentials for an account where `main` auto-deploys. Pin exact versions; review or vendor anything in the tool-execution or credential path — directly governs why `@ramtinj95/pi-infra-command-guard` is read, not installed, and why `unbash` is the one new dependency this phase takes on.
- **Windows (Git Bash) now, macOS later. POSIX `sh` throughout.** No PowerShell. Any shell script this phase's plan writes (e.g. a `pre-receive` hook fixture for SAFE-01's offline proxy) must be POSIX `sh`, LF line endings, matching this repo's `.gitattributes` convention.
- **A build step is never added.** Pi loads `.ts` through jiti; `safety/` ships `.ts` directly, same as `diagnostics/`, `harness/`, `providers/`.
- **`typebox` (unscoped) is the only schema library**, peer dependency `"*"`, never bundled, never `@sinclair/typebox`. The `approve_ky_command` tool's parameter schema (Pattern 3) must use `Type.Object`/`StringEnum` from the already-established imports, not `Type.Union`/`Type.Literal` for string enums.
- **`pi-subagents@0.47.1` is the chosen subagents package** (composed in Phase 7, not this phase) — SAFE-12's design must anticipate this specific package's spawn mechanism (`pi-spawn.ts:139-163`, resolving to the `pi` binary or `node <piCliPath>`) even though it is not installed yet, since Open Question 2's proxy design is explicitly built to mirror that mechanism.
- **CONTRIBUTING.md boundary rule** (BOOT-10, already enforced by `tests/unit/contributing-boundary.test.ts`): a new capability defaults to command or skill; registering a tool requires justifying its per-request schema cost. The `approve_ky_command` tool is justified — it is the only way to get a structured, re-issuable approval protocol out of a blocked `tool_call`, per Pattern 3's reasoning for rejecting inline `ctx.ui.confirm()`.

## Summary

Phase 4 builds a mistake-catcher, not a security boundary, and the single highest-value finding of this research is that the mistake-catcher's own reference implementation (`@ramtinj95/pi-infra-command-guard@0.9.1`) does **not** trust `unbash`'s tolerant `parse()` as its fail-closed mechanism. It ships a **hand-rolled 56KB scanner** (`shell.ts`) whose own character-level lexer throws on backtick, `$(`, heredoc `<<`, background `&`, and process substitution `<(`/`>(` *before* `unbash` is ever consulted, and only falls back to `unbash`'s real AST (`recoverAstCommands`) to resolve shell keywords (`if`/`while`/`function`) it cannot otherwise classify. This confirms the orchestrator's own finding from executing `unbash` directly: `unbash@4.0.10` almost never returns `errors.length > 0` for the constructs this phase must deny, so **"fail closed on parse error" cannot be the mechanism — "fail closed on the presence of specific AST node types" must be.** `unbash`'s `dist/types.d.ts` gives the exact vocabulary (`CommandExpansionPart`, `ProcessSubstitutionPart`, `ArithmeticCommandExpansion`, redirect operators `<<`/`<<-`/`<<<`, `Statement.background`), and this document names every one of them with file:line so the planner can write the deny predicate directly against unbash's own AST rather than reimplementing a second scanner.

The second load-bearing finding is a gap in Pi's own extension-loading model that CONTEXT.md's decisions already anticipate but that this research settles concretely: `getAllRegisteredTools()` resolves a tool-name collision **first-registration-wins across extensions** (`dist/core/extensions/runner.js:280-291`), while `tool_call` handler mutation is **last-handler-wins, no re-validation** (`types.d.ts:687-688`). These are two different orderings for two different mechanisms, and both make **extension load order part of the safety extension's threat model** — the safety extension's `registerTool({...bashTool, execute: wrapped})` call must run before any other extension that might also register a tool named `bash`, or the safety wrapper never executes at all. `noOpUIContext` is confirmed at `runner.js:88-119`: `confirm` returns `false`, `select` returns `undefined`, and `hasUI()` is literally `uiContext !== noOpUIContext` — there is no mode-string check anywhere in the mechanism, only an object-identity check, which is why writing the guard as "block unless approved" rather than "approve unless blocked" is the entire difference between fail-closed and fail-open under `--mode json`.

The third load-bearing finding answers Focus C directly: every extension shipped in Phases 1–3 lives under `.pi/extensions/`, which is project-scoped and therefore invisible to headless subagents (`src/core/project-trust.ts`: `resolveProjectTrusted` returns `false` with no UI). The concrete, verified mechanism for user scope is `~/.pi/agent/extensions/<name>/index.ts` (`docs/extensions.md:118`, "Global (subdirectory)"). Because Pi loads `.ts` through jiti with no build step, `bin/bootstrap.sh` does not need to duplicate the safety subsystem's source — it can write a **one-line re-export stub** at that user-scope path pointing at the repo's own `.pi/extensions/safety/index.ts` by absolute path, keeping one copy of the logic while satisfying the auto-discovery requirement for both interactive dogfooding and headless subagents.

**Primary recommendation:** Parse every `bash` command with `unbash@4.0.10`; write a recursive AST-node-type deny-list (not an error-count check) as the SAFE-03 fail-closed mechanism; wrap `bash`/`write`/`edit`/`read` via `pi.registerTool({...createXTool(cwd), execute: wrapped})` sitting alongside a `tool_call` hook for early UX, both consulting one shared policy module; implement approval as block → `approve_ky_command` tool → `ctx.ui.select` → one-shot grant keyed to the exact command string, written deny-by-default so `noOpUIContext` fails closed by construction; install the safety extension at user scope via a bootstrap-written re-export stub; extract the diagnostics JSONL writer's generic parts into a neutral shared module so `safety/audit.ts` never imports from `diagnostics/`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bash command parsing → canonical invocation | Extension (safety/shell.ts) | — | In-process, synchronous, no I/O; must run before every tool execution |
| Policy decision (allow / confirm / deny) | Extension (safety/policy.ts) | — | Pure function over a canonical invocation + policy config; no side effects, easiest to unit test |
| Approval state (pending, granted, one-shot) | Extension (safety/approvals.ts) | Process memory only | Lives for the session; a subagent process gets its own store — this is intentional, not a gap (see Pitfall below) |
| Enforcement (actually blocking execution) | Extension (`tool_call` hook + wrapped tool `execute`) | — | Two tiers *within* the extension tier, per decision 5 — hook for UX/early rejection, wrapped tool `execute` for the actual last-checkpoint enforcement |
| Audit trail | Extension (safety/audit.ts) → filesystem (`.pi/logs/audit-*.jsonl`) | — | Append-only, process-safe across concurrent `pi` processes (subagents), never read back into model context |
| Server-side branch protection | GitLab (external service) | — | The only control enforced somewhere the model has no code execution at all; everything in this phase is defence-in-depth on top of it |
| Extension load scope (user vs project) | Pi runtime (`~/.pi/agent/extensions/`) | Bootstrap script (writes the stub) | Determines whether the extension loads in headless subagents at all — a runtime/deployment concern, not a policy concern |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `unbash` | `4.0.10` [VERIFIED: npm registry, published 2026-08-09] | Bash AST parser | ISC, zero dependencies, `Node >=14`. Confirmed by the orchestrator's own local execution against 24 inputs (see `<additional_context>` — treated here as VERIFIED-by-execution, not re-derived). It is also `@ramtinj95/pi-infra-command-guard`'s own dependency, i.e. the one credible prior-art implementation in this ecosystem chose it too. |

**Installation:**
```bash
npm install unbash@4.0.10
```

`unbash` is ESM-only (`"type": "module"`, no CJS export condition) — this matters only if any test tooling in this repo loads via `require()`; Pi loads `.ts` through jiti (ESM-capable) and this repo's `vitest` config is already ESM, so no additional seam is needed. Not independently verified against this repo's vitest config in this research pass — flag as a Wave-0 smoke check (`import { parse } from "unbash"` inside one vitest file).

### Supporting

None. This phase deliberately installs nothing else (CONTEXT.md decisions 9–10: read, do not install, `@ramtinj95/pi-infra-command-guard` and `cc-safety-net`).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled AST walk over `unbash`'s output | `@ramtinj95/pi-infra-command-guard`'s own 56KB `shell.ts` scanner (copy the *approach*, not the code) | Their scanner is a *second*, hand-written lexer that runs before `unbash` and rejects dangerous syntax at the character level, falling back to `unbash`'s AST only for keyword recovery. It is more defensive but also 56KB of unreviewed-by-us logic reimplemented; for this project's narrower verb list (git/glab/terraform/aws/kubectl/file-path policy vs. their broad infra-tool surface) a direct recursive walk of `unbash`'s AST is proportionate and keeps one parser, not two. |
| Block → approval-tool → re-issue | Inline `ctx.ui.confirm()` inside `tool_call` (Pi's own `permission-gate.ts` example) | Simpler for a TUI-only harness, and Pi's own bundled example does exactly this — but CONTEXT.md decision 4 already locks the two-step protocol, and Pattern 3 below documents why: a dialog blocks the agent inside a hook and gives no structured re-issue path, and the reference guard chose the two-step form for the same reason. |

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `unbash` | npm | published 2026-08-09 (current at time of research) | not queried this session (35.8M/mo reported in CLAUDE.md, unverified independently here) | `github.com/webpro-nl/unbash` [VERIFIED: `npm view unbash repository.url`, executed this session] | `[OK]` [VERIFIED: `python -m slopcheck install unbash`, executed this session — scan phase reported `1 OK`, npm-registry existence + no-hallucination signal both passed] | **Approved** |

**Packages removed due to slopcheck `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** none.

**Provenance note.** `unbash` as the correct package name was not discovered fresh in this research session — it is a locked, binding recommendation carried in from `./CLAUDE.md` (this project's own prior research, itself citing GitHub API and npm registry verification) and from the orchestrator's own direct local execution against 24 real inputs this session. Independently in this session: `npm view unbash version time.modified repository.url license` returned `4.0.10`, `2026-08-09T07:31:38.450Z`, `github.com/webpro-nl/unbash`, `ISC` — consistent with CLAUDE.md's claims — and `slopcheck` returned `OK`. Given execution against real inputs plus two independent registry/scanner checks, this is tagged **VERIFIED**, not `[ASSUMED]`, by the letter of the package-provenance rule ("confirmed via ... AND passing slopcheck verification" — the "official docs" clause does not cleanly apply to a general-purpose parsing library with no vendor docs site, so direct execution + registry + slopcheck is the strongest available triangulation).

No `postinstall` script check was run for `unbash` this session (zero-dependency ISC package; ship-time risk is low, but the planner should run `npm view unbash scripts.postinstall` once at install time per the standard gate, since this research did not).

## Architecture Patterns

### System Architecture Diagram

```
                                   model emits a tool call
                                            │
                                            ▼
                              ┌─────────────────────────┐
                              │   tool_call hook fires   │   safety/index.ts
                              │  (event.toolName, input) │   registered FIRST among
                              └────────────┬─────────────┘   this repo's extensions
                                           │
                     is toolName in {bash, write, edit, read}?
                                           │
                             ┌─────────────┴─────────────┐
                          bash                      write/edit/read
                             │                             │
                             ▼                             ▼
                  ┌───────────────────┐          ┌───────────────────────┐
                  │ unbash.parse(cmd)  │          │ path-only policy check │
                  │ → recursive walk   │          │ (.env, ~/.aws/creds,   │
                  │ node-type deny-list│          │  kubeconfig, *.tfstate,│
                  └─────────┬──────────┘          │  .git/hooks, .bashrc,  │
                            │                      │  .gitconfig, outside   │
              contains CommandExpansionPart,       │  project dir)          │
              ProcessSubstitutionPart,              └───────────┬───────────┘
              heredoc redirect, background,                     │
              or unresolved $VAR in a policy-                   │
              relevant position?                                │
                            │                                    │
                 yes ───────┼─────── no                          │
                  │         │                                    │
                  ▼         ▼                                    ▼
               DENY   canonical invocation              policy decision
              (fail    (wrappers resolved:              (allow / knownRisk /
              closed)  sudo, env, sh -c, xargs)          block outright)
                            │
                            ▼
              policy.ts: HEAD==main writes? glab mr
              merge? terraform apply|destroy|import?
              mutating aws? kubectl delete?
                            │
              ┌─────────────┼─────────────────┐
           allow      requires confirm      deny outright
              │             │                    │
              ▼             ▼                    ▼
        tool_call        block with          block, no
        returns          reason + request     approval path
        undefined        id; model must
        (UX pass)        call approve_ky_
                          command tool
                                │
                                ▼
                    ctx.ui.select() — noOpUIContext.select()
                    returns undefined under --mode json/print,
                    so this branch is UNREACHABLE headless and
                    the block above it is the terminal state
                                │
                     user approves (TUI only) ──► one-shot grant
                     keyed to exact command string
                                │
                                ▼
                     model re-issues the SAME command
                                │
                                ▼
                  ┌─────────────────────────────┐
                  │ wrapped tool execute() —     │  the LAST checkpoint;
                  │ re-runs the SAME policy      │  re-validates because a
                  │ check against the possibly-  │  later-loaded extension's
                  │ mutated event.input          │  tool_call handler may have
                  └─────────────┬────────────────┘  rewritten input after
                                │                    the hook approved it
                       allow ───┼─── deny (throw)
                                │
                                ▼
                        real tool executes
                                │
                                ▼
                  audit.ts appends ALLOW/BLOCK row to
                  .pi/logs/audit-<date>.jsonl (subagent
                  and main session both append to the
                  same date-stamped file safely — proven
                  by the four-concurrent-process test
                  already executed in Phase 2 research)
```

### Recommended Project Structure

```
.pi/
├── extensions/
│   └── safety/
│       ├── index.ts        # tool_call hook registration + tool wrapping, load-ordered FIRST
│       ├── shell.ts         # unbash AST walk → canonical invocation + deny-list predicate
│       ├── policy.ts        # HEAD==main / glab mr merge / tfstate / terraform / aws / kubectl rules
│       ├── approvals.ts     # pending/granted store, one-shot keyed to exact command, in-process
│       └── audit.ts         # thin binding over the shared jsonl module (base="audit")
├── lib/
│   └── jsonl.ts             # extracted from diagnostics/jsonl.ts — generic append/rotate/prune,
│                              # NOT under extensions/, so it is not an auto-discovered entry point
│                              # and extension-layout.test.ts does not need to scope it
└── extensions/
    └── diagnostics/
        └── jsonl.ts          # becomes a thin binding over .pi/lib/jsonl.ts (base="wire"/"turns")
```

### Pattern 1: unbash AST walk with a node-type deny-list, not an error-count check

**What:** Parse with `unbash.parse(command)`. Recursively walk every `Word.parts[]` and every `Redirect` and `Statement` in the resulting `Script`, and **deny** (return a policy verdict of "unparseable — fail closed", not "allow") if the walk finds any of:

- `CommandExpansionPart` (command substitution: `$(...)`, and backtick forms are lexed as an escaped `CommandExpansionPart` too — the orchestrator's own execution confirmed `git $(echo push)` parses cleanly with `errors.length === 0`, so only a node-type check catches it)
- `ProcessSubstitutionPart` (`<(...)`, `>(...)`)
- `ArithmeticCommandExpansion` (command substitution nested inside `$((...))`, a corner unbash's own type vocabulary calls out separately from plain `ArithmeticExpansionPart`)
- Any `Redirect` whose `operator` is `<<`, `<<-`, or `<<<` (heredoc / herestring)
- `Statement.background === true` (the `&` operator — orchestrator confirmed `nohup git push &` parses cleanly)
- `SimpleExpansionPart` or `ParameterExpansionPart` appearing inside the **executable name word** or inside a word matched against a security-relevant policy pattern (an unresolved `$VAR` in *argument* position that the policy never inspects is not itself dangerous; in *command position* it is exactly `g=push; git $g`)
- `errors.length > 0` on the returned `ParsedScript` (kept as a final catch-all, but per the orchestrator's execution this fires almost never for the constructs above — it is not the primary mechanism)

```typescript
// Source: unbash 4.0.10 dist/types.d.ts (read this session, package installed
// in the scratchpad, not the project — DO NOT add unbash to package.json here,
// that is the plan's job)
import { parse } from "unbash";
import type { Word, WordPart, Redirect, Statement, Node } from "unbash";

const DENIED_PART_TYPES = new Set([
  "CommandExpansionPart",
  "ProcessSubstitutionPart",
  "ArithmeticCommandExpansion",
]);

function wordIsUnsafe(word: Word, denyUnresolvedExpansion: boolean): boolean {
  if (!word.parts) return false; // pure Literal text, e.g. plain quoted/unquoted word
  return word.parts.some((part) => {
    if (DENIED_PART_TYPES.has(part.type)) return true;
    if (denyUnresolvedExpansion &&
        (part.type === "SimpleExpansion" || part.type === "ParameterExpansion")) return true;
    if (part.type === "DoubleQuoted" || part.type === "LocaleString") {
      // recurse: a $(...) can hide inside a double-quoted word's children
      return part.parts.some((child) =>
        DENIED_PART_TYPES.has(child.type) ||
        (denyUnresolvedExpansion && (child.type === "SimpleExpansion" || child.type === "ParameterExpansion"))
      );
    }
    return false;
  });
}

function hasHeredocOrBackground(node: Node): boolean {
  if (node.type === "Statement" && node.background === true) return true;
  const redirects: Redirect[] = "redirects" in node ? (node as any).redirects ?? [] : [];
  if (redirects.some((r) => r.operator === "<<" || r.operator === "<<-" || r.operator === "<<<")) return true;
  // recurse into known child-node containers (commands, pipelines, and-or lists, etc.)
  for (const key of Object.keys(node as object)) {
    const value = (node as any)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object" && "type" in child && hasHeredocOrBackground(child)) return true;
      }
    } else if (value && typeof value === "object" && "type" in value) {
      if (hasHeredocOrBackground(value)) return true;
    }
  }
  return false;
}
```

**When to use:** Every `bash` invocation, both at the `tool_call` hook and again inside the wrapped `execute()`.

**Why not trust `errors.length === 0`:** VERIFIED-by-execution (orchestrator, this session): `unbash` returned `errors.length === 0` for `git $(echo push)`, the heredoc-to-script pattern, `nohup git push &`, `sh -c "git push"`, `bash -lc "git push"`, `env -i git push`, and `git -C /c/other/repo push`. If SAFE-03's fail-closed logic checked only `errors.length`, none of these would fail closed. The reference guard's own hand-rolled scanner independently arrives at the same conclusion by rejecting these constructs at the character level rather than trusting `unbash`'s tolerance [VERIFIED: `shell.ts:626-680` in the extracted `@ramtinj95/pi-infra-command-guard@0.9.1` tarball, read this session].

### Pattern 2: Wrapper resolution — sudo, env, sh -c, xargs, nohup

**What:** After confirming a command is not denied by Pattern 1, walk the `Command.name` / `Command.prefix` / `Command.suffix` word values to resolve wrapper executables down to the real invocation, so policy is evaluated against `git push`, not `env`.

**Verified reference implementation** [`shell.ts:724-835`, `extractInvocation()`, read this session from the extracted tarball]: a loop that recognises `env`, `sudo`, `time`, `stdbuf`, `nice`, `command`/`builtin`, `toybox`/`busybox` (each with a known flag table so it can skip past `env -C /dir -u FOO`-style option arguments), and `nohup`/`chronic`/`setsid` (bare pass-through, no flags consumed), accumulating a `wrappers[]` list and returning the resolved `{executable, args}`.

**What the reference implementation deliberately does NOT do:** it does not recursively parse `sh -c "<script>"` as a nested script. Instead, `policy.ts:262-266` treats **any** invocation whose resolved executable is in `SHELL_RUNNERS` (`sh, bash, zsh, dash, fish, xargs, python*, node, perl, ruby`) as automatically "unclassified — requires manual approval" **if the raw segment text contains any of the guarded tool names as a substring**, and denies it outright (in our stricter fail-closed context) otherwise. This is a proportionate design for this project too: our guarded verb list (`git`, `glab`, `terraform`, `aws`, `kubectl`) is narrow enough that a substring containment check over the full unquoted segment text is cheap and catches `sh -c "git push"` without a second recursive parse.

```typescript
// Recommended for this project — deny outright rather than "requires approval",
// because SAFE-03's contract is fail-closed, not fail-to-approval, for anything
// this guard cannot classify with confidence.
const SHELL_RUNNERS = new Set(["sh", "bash", "zsh", "dash", "fish", "xargs",
  "python", "python3", "node", "perl", "ruby"]);
const GUARDED_VERB_PATTERN = /\b(git|glab|terraform|aws|kubectl)\b/i;

function deniesViaShellRunner(resolvedExecutable: string, rawSegmentText: string): boolean {
  return SHELL_RUNNERS.has(resolvedExecutable) && GUARDED_VERB_PATTERN.test(rawSegmentText);
}
```

**When to use:** After the Pattern-1 gate passes, before handing the canonical invocation to `policy.ts`.

### Pattern 3: Block → approval-tool → re-issue, enforced twice

**What:** `tool_call` hook parses and policy-evaluates; on a "requires confirmation" verdict (not an outright deny), it returns `{ block: true, reason }` where `reason` embeds a request id and explicit instructions to call `approve_ky_command`. That tool's `execute()` — which only runs when `ctx.mode === "tui"` and `ctx.hasUI` — drives `ctx.ui.select()`, records a one-shot grant keyed to the **exact command string**, and tells the model to retry. The retried `tool_call` consumes the grant and allows. The wrapped `bash`/`write`/`edit`/`read` tool's `execute()` re-runs the identical policy check independently, so a later extension's `event.input` mutation cannot smuggle a different command through on the strength of an earlier grant.

**Verified reference shape** [`approvals.ts`, full file read this session]:
```typescript
// Source: extracted @ramtinj95/pi-infra-command-guard@0.9.1 approvals.ts —
// pattern to steal, not code to import (that package pulls in openai,
// web-tree-sitter, tree-sitter-bash, ws via a peer dep — CLAUDE.md forbids
// installing it)
class ApprovalStore {
  private pending = new Map<string, PendingApproval>();
  private approved = new Map<string, { count: number; expiresAt: number }>();
  createPending(identity, reason) { /* random id, 10-minute TTL */ }
  validate(requestId, command, reason) {
    // requestId must exist, AND command must match byte-for-byte, AND reason
    // must match — all three, not just the id, so a stale/mismatched retry
    // is refused rather than silently approved
  }
  approve(requestId, command, reason) {
    // deletes the pending entry; stores a ONE-SHOT count keyed on a
    // fingerprint of {source, command, cwd, shell, tty, login} — not on the
    // request id, so the SAME command re-issued through a different tool call
    // still consumes the grant
  }
  consume(identity) { /* count-- ; delete when it hits 0 */ }
}
```

**Approval TTL:** the reference implementation uses a **10-minute** TTL on both the pending request and the granted approval (`APPROVAL_TTL_MS = 10 * 60 * 1000`, `approvals.ts:14`). This is a reasonable default to carry forward — Claude's discretion per CONTEXT.md, but grounded in a verified prior-art number rather than invented from nothing.

**Tool name and parameter schema, verified** [`index.ts:34-47`]: `approve_infra_command` takes `{ request_id, command, reason, summary, flags: [{flag, meaning}], blastRadius }`. The `command` field is deliberately required and validated byte-for-byte against the pending request — this is the mechanism that prevents the model from approving a *different*, edited command than the one that was actually blocked. **Recommend the same shape** for `approve_ky_command`, since it is what closes the exact vulnerability CONTEXT.md decision 5 calls out (a later hook mutating `event.input` after approval).

**Why the guard's own bash-tool wrapper does NOT also register a `tool_call` handler for the literal `bash` tool name** [`index.ts:349-374, 376-393`]: the reference package's `tool_call` hook only intercepts `exec_command`/`functions.exec_command` (its own `code-mode` integration) and leaves `bash` enforcement entirely to the wrapped tool's `execute()`. **This project's CONTEXT.md decision 5 explicitly requires both layers for `bash`** — do not copy this specific omission; it is a place where CONTEXT.md's locked decision is stricter than the reference implementation, for good reason (defence against the exact `event.input`-mutation risk the reference package does not itself face, since it has no known co-installed extension in this project that would race it).

### Pattern 4: Deny-by-default under `noOpUIContext`

**What:** Write every branch as "deny unless an explicit grant exists", never "allow unless a check says no". `noOpUIContext` [VERIFIED: `dist/core/extensions/runner.js:88-119`]:

```javascript
const noOpUIContext = {
    select: async () => undefined,
    confirm: async () => false,
    // ...
    custom: async () => undefined,
};
```

and it is the **constructor default** for `ExtensionRunner.uiContext` [`runner.js:153`: `this.uiContext = noOpUIContext;`], only replaced by `setUIContext(realContext, mode)` when a real TUI or RPC frontend binds. `hasUI()` is literally `this.uiContext !== noOpUIContext` [`runner.js:274-276`] — an object-identity check, not a mode-string branch. This is exactly why `--mode json` and `-p` (print) never bind a real UI context and `hasUI` stays `false` for the whole run, while `--mode rpc` does bind one.

**Anti-pattern this rules out, verified in Pi's own bundled example** (`examples/extensions/permission-gate.ts:19-23`):
```typescript
if (isDangerous) {
    if (!ctx.hasUI) {
        return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
    }
    const choice = await ctx.ui.select(...);
    if (choice !== "Yes") { return { block: true, reason: "Blocked by user" }; }
}
```
This example is correctly deny-by-default *as written* (it blocks when `!ctx.hasUI`), and is cited here as the confirmation that Pi's own docs endorse the shape CONTEXT.md decision 4 requires — but note it still uses inline `ctx.ui.select()`, which Pattern 3 above explains why this project deliberately does not (no structured re-issue, no risk metadata, no TTL). Any variant of this pattern that inverts the condition (`if (ctx.hasUI && !ok) block` — i.e. only blocking when there *is* a UI and it said no) fails open headless, because the `else` branch (no UI) falls through to allow. The CI test for SAFE-10 must assert the deny happens with **no UI bound at all**, not merely that a `confirm()` call returned `false`.

### Pattern 5: Extension load order as part of the threat model

**What:** Two independent, differently-ordered mechanisms both make load order load-bearing:

1. **Tool-name collision across extensions is first-registration-wins** [VERIFIED: `dist/core/extensions/runner.js:280-291`]:
```javascript
/** Get all registered tools from all extensions (first registration per name wins). */
getAllRegisteredTools() {
    const toolsByName = new Map();
    for (const ext of this.extensions) {
        for (const tool of ext.tools.values()) {
            if (!toolsByName.has(tool.definition.name)) {
                toolsByName.set(tool.definition.name, tool);
            }
        }
    }
    return Array.from(toolsByName.values());
}
```
   If safety's wrapped `bash` tool registration loses this race to some other extension's own `bash`-named tool, the safety wrapper never runs at all — silently, with no error.

2. **`tool_call` handler mutation is last-handler-wins, no re-validation** [CONTEXT.md decision 5, citing `types.d.ts:687-688`, confirmed this session]. A later-loaded extension's `tool_call` handler sees the input the safety hook already approved (or denied — but denial short-circuits, so this only matters for allows) and can rewrite it before execution, and Pi performs no re-check.

**Consequence for the plan:** the safety extension must be verified to load and register *before* any other extension in this repo's own `.pi/extensions/` auto-discovery order, and the wrapped-tool `execute()` (Pattern 3's second enforcement layer) is what closes the second gap regardless of load order, because it re-evaluates policy against whatever `event.input` actually reaches execution — not against what the hook saw. This is the concrete justification for CONTEXT.md decision 5's "enforce twice": the hook alone is vulnerable to (2) even if (1) is solved correctly.

### Pattern 6: User-scope installation via a re-export stub, not a file copy

**What:** `~/.pi/agent/extensions/<name>/index.ts` is auto-discovered at global scope regardless of project trust [VERIFIED: `docs/extensions.md:118`]. Because Pi loads `.ts` via jiti with no build step, the file at that path does not need to contain the safety subsystem's logic — it can be a tiny re-export that points, by absolute path, at this repo's own `.pi/extensions/safety/index.ts`.

```typescript
// Written by bin/bootstrap.sh into
// ~/.pi/agent/extensions/ky-safety/index.ts
// The absolute path below is THIS MACHINE's clone location, resolved at
// bootstrap time — it is machine-local state under ~/.pi/agent/, never
// committed to the public repo, and safe to contain an absolute filesystem
// path for exactly that reason.
export { default } from "/absolute/path/to/ky-pi-agent/.pi/extensions/safety/index.ts";
```

**Why this is preferable to copying the directory tree:** a copy creates two sources of truth for the same logic, and a developer iterating on `safety/` inside the repo (dogfooding via `cd ky-pi-agent && pi`, where `.pi/extensions/safety/` loads project-scoped) would silently diverge from the user-scope copy a subagent actually uses, until bootstrap is re-run. A re-export stub has exactly one copy of the logic; `/reload` in the interactive session re-reads the project-scoped copy live, and a freshly spawned subagent process re-resolves the stub's import fresh (jiti has no cross-process cache), so both consumption paths always see the same source.

**Confidence and what was not verified this session:** the mechanism ("jiti loads `.ts` via ESM `import`/`export ... from` including absolute file-path specifiers, and re-resolves on each fresh process") is a reasonable inference from "no build step, jiti loads `.ts` directly" [CITED: `docs/extensions.md:179`] but was **not executed this session** — no scratch `PI_CODING_AGENT_DIR` was spun up to prove a re-export stub actually loads and delegates correctly. **Tag: `[ASSUMED]`, needs a Wave-0 spike test** that writes exactly this stub shape into a throwaway `PI_CODING_AGENT_DIR/extensions/ky-safety-test/index.ts`, runs `pi --offline --mode json -p ...` (or `--list-models`-equivalent sentinel check, following the existing `tests/helpers/pi.ts` pattern), and confirms the extension loaded. If the spike fails, the fallback is a straightforward directory copy in `bin/bootstrap.sh`, at the cost of the two-copies problem above.

### Anti-Patterns to Avoid

- **Trusting `errors.length === 0` as the fail-closed signal:** VERIFIED-by-execution this session and last: `unbash` parses almost every dangerous construct cleanly. See Pattern 1.
- **A `tool_call`-only guard with no wrapped tool:** defeated by any later extension's `event.input` mutation, per Pattern 5(2). CONTEXT.md decision 5 and ARCHITECTURE.md's own Anti-Pattern 3 both already forbid this.
- **`if (ctx.hasUI && !ok) block`:** fails open under `--mode json`/`-p`. See Pattern 4.
- **Recursively parsing `sh -c "<script>"` as a second nested script:** the reference implementation does not do this and neither should this project — a substring-containment check over the shell-runner segment's raw text, denying outright, is cheap and proportionate for this project's narrow guarded-verb list. Building a recursive re-parser is effort this phase does not need to spend.
- **Registering the safety extension anywhere but first in load order, or leaving load order to chance:** per Pattern 5(1), tool-name collisions are first-registration-wins; an untested load order is an untested control.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bash syntax parsing | A regex-based command matcher | `unbash.parse()` walked recursively by node type | Regex is defeated by every row of PITFALLS.md's 14-row bypass table (`g=push; git $g`, `sh -c`, quoting tricks); an AST is not. Verified: `unbash` correctly resolves quoting evasion for free — `g"i"t push` → `name.value === "git"` — because `Word.value` is already quote-resolved. |
| Append-only, rotating, dated JSONL logs | A second writer for the audit log | The generic parts of the existing `.pi/extensions/diagnostics/jsonl.ts` (`appendJsonl`, `rotate`, `pruneLogs`, `logPath`), extracted to a neutral shared module | This project already built, hardened, and tested this exact mechanism in Phase 2 — including the four-concurrent-process-append proof that directly derisks the subagent-and-main-session-both-append-to-the-same-file scenario SAFE-14/SAFE-12 need. Rebuilding it duplicates real engineering risk (torn lines, rotation races) that is already closed. |
| Determining whether `HEAD == main` | Parsing `git branch`/`git status` output with a regex | `git symbolic-ref --short HEAD` (exit 0 → branch name; non-zero → detached HEAD) compared against a configured protected-branch name (default `main`, but read `master` too and prefer whatever `git symbolic-ref refs/remotes/origin/HEAD` reports if available) | `git symbolic-ref` is git's own documented primitive for exactly this question, matching `tests/helpers/git.ts`'s existing house rule ("ask git; do not reimplement it"). |
| Ignore-rule / gitignore coverage for the new audit log | A new gitignore rule and a new gitignore test | Nothing — `.gitignore:30` (`*.jsonl`) already covers any `.pi/logs/audit-*.jsonl` path this phase produces [VERIFIED: `grep -n "jsonl" .gitignore`, executed this session] | Confirm with a targeted extension of the existing `tests/unit/logs-gitignored.test.ts`-style check (asking git, not re-deriving the rule), rather than adding redundant policy. |

**Key insight:** every "don't hand-roll" row above is a case where this project (or a directly-read prior-art extension) has already paid the engineering cost of getting a subtle mechanism right, and Phase 4's job is composition, not reinvention.

## Common Pitfalls

### Pitfall 1: Believing `unbash` parse errors are the fail-closed signal

**What goes wrong:** A guard written as "deny when `errors.length > 0`, allow otherwise" allows almost everything, because `unbash` is a tolerant parser by design.
**Why it happens:** The name "AST parser" implies "will refuse malformed/dangerous input", which conflates syntactic validity with policy safety. `$(...)`, heredocs, and backgrounding are all syntactically valid bash that `unbash` correctly parses into a rich AST — they are dangerous for *policy* reasons, not parse-failure reasons.
**How to avoid:** Pattern 1 above — walk the AST for specific node types.
**Warning signs:** A test corpus where `git $(echo push)` or `nohup git push &` is reported as "allowed" rather than "denied — unparseable in a policy sense."

### Pitfall 2: The `sudo`/`env` wrapper-skip logic accidentally skips past the real command too

**What goes wrong:** `env -u FOO -C /some/dir git push` requires knowing that `-u`/`-C` take a value argument (so the *next* word is consumed as that value, not as the executable), while `-i`/`-0` take none. Getting this table wrong either fails to resolve `env` (treats `-u` as the executable) or over-consumes (treats `/some/dir` as the executable, skipping past `git`).
**Why it happens:** `env`'s (and `sudo`'s) option grammar mixes boolean and value-taking short/long flags with no fixed positional convention.
**How to avoid:** Copy the reference implementation's verified option tables (`ENV_BOOLEAN_OPTIONS`, `ENV_VALUE_OPTIONS`, `SUDO_BOOLEAN_OPTIONS`, `SUDO_VALUE_OPTIONS` in `shell.ts:57-107`) rather than re-deriving them from `man env`/`man sudo` — they are already correct against real option grammars and were the basis for a package that has evidently been used against real infra commands.
**Warning signs:** `sudo -u root git push` resolving to executable `root` instead of `git`.

### Pitfall 3: Windows backslash paths lose their meaning in `Word.value`

**What goes wrong (VERIFIED-by-execution, orchestrator, this session — the single most important settled unknown from ARCHITECTURE.md:631):** for an **unquoted** `cat C:\Users\Admin\.aws\credentials`, `word.text === "C:\\Users\\Admin\\.aws\\credentials"` (raw source slice, correct) but `word.value === "C:UsersAdmin.aws"` — the backslashes are consumed as POSIX escape characters, which is *correct* bash semantics (Git Bash does the same), but means a path-matching policy that reads only `.value` never recognises the intended Windows path at all.
**Why it happens:** Bash treats an unquoted backslash as an escape character. `C:\Users\Admin` is `C:UsersAdmin` once escapes are resolved, because `\U`, `\A` etc. are not recognised escape sequences and bash silently drops the backslash and keeps the following literal character.
**How to avoid:** SAFE-06/SAFE-08's path-matching policy must read `Word.text` (raw source), not `Word.value` (escape-resolved), for any argument being compared against a sensitive-path pattern — or, for double/single-quoted forms (which preserve backslashes in `.value` per the orchestrator's execution), read `.value` there instead. In practice: normalise on `.text`, strip surrounding quote characters if present, and match against both `C:\...` and `/c/...`/`/cygdrive/c/...` forms after normalisation. `~` and `$HOME` are **not** expanded by `unbash` — `.value` is literally the string `"~/.aws/credentials"` — so the policy must expand these itself against the actual home directory before comparing.
**Warning signs:** A path-block rule that fires correctly for `cat "C:\Users\Admin\.aws\credentials"` (quoted) but silently passes `cat C:\Users\Admin\.aws\credentials` (unquoted) — exactly the asymmetry the orchestrator's execution surfaced.

### Pitfall 4: Getting the `aws` mutating/read-only line backwards

**What goes wrong:** A guard that requires confirmation for `aws sts get-caller-identity` or `aws s3 ls` — the two commands a session uses constantly to orient itself — trains the user to approve reflexively, which is a worse security posture than no gate at all (CONTEXT.md decision, "specifics" section).
**Why it happens:** A naive rule like "confirm anything under `aws`" is simpler to write than a verb-classified allowlist, and `sts` sounds credential-adjacent even though `get-caller-identity` specifically returns no secret material.
**How to avoid:** Copy the reference implementation's verified classification exactly (Code Examples section below): `sts get-caller-identity` is explicitly excluded from the sensitive-read rule (`service === "sts" && operation !== "get-caller-identity"`), and any operation matching `/^(?:admin-get|batch-get|describe|get|head|list|lookup|search|simulate|validate)-/` or present in `SAFE_AWS_EXACT_OPERATIONS` (`describe, get, head, help, list, lookup, ls, query, scan, search, select, status, wait`) is allowed outright.
**Warning signs:** A demo session where the harness prompts for confirmation on the very first `aws sts get-caller-identity` orientation call.

### Pitfall 5: Blocking `git worktree add -b feat main` along with `git push` when `HEAD == main`

**What goes wrong:** A naive rule of "block any git subcommand whose arguments mention `main`" also blocks `git worktree add -b feat main`, `git fetch origin main`, `git rebase main`, `git diff main`, and `git log origin/main` — breaking the single most useful escape hatch (creating a feature branch off main) while trying to protect main.
**Why it happens:** "Mentions main" and "writes to the current branch, which happens to be main" are different questions, and the second is the one that matters. `HEAD == main` is a property of the **current checkout**, evaluated independent of the command's arguments; the command itself must then be classified as a write (to the checked-out ref) vs. a read (of any ref, including `main`, from anywhere).
**How to avoid:** Two-step evaluation: (1) is `HEAD` currently `main` (or `master`, or whatever the configured protected-branch name is) — via `git symbolic-ref --short HEAD` in the invocation's resolved `cwd` (not the harness's own `cwd`, since `git -C /other/repo push` changes the working repo entirely — resolve `-C`/`--git-dir` arguments first); (2) is the git subcommand a write-to-current-branch verb (`push` without `-C`/without a different explicit remote-tracking override, `commit`, `merge`, `rebase` **when it rewrites the current branch, not a named argument**, `reset`) vs. a read-only or ref-scoped-write verb (`fetch`, `diff`, `log`, `rebase <other-branch>` read-side, `worktree add -b <newbranch> main` — which reads `main` to create an *unrelated* new branch and checks out the worktree, never mutating `main` itself). Only deny when both (1) and (2) hold.
**Warning signs:** `git worktree add -b feat main` failing in the test corpus — this must be a named allow-case, not merely absent from the deny-list.

### Pitfall 6: Assuming the audit log needs to record tool *output*, not just the command

**Not the same closed door as `docs/DIAGNOSTICS.md`'s Bedrock-credential one**, but the same shape of mistake: the audit log records the **literal command string** the model attempted, which is different from "every credential the command could have touched." A blocked `cat ~/.aws/credentials` command produces an audit row containing the command text itself — which is not secret-shaped — but if the *policy* ever needs to log the *content* of a blocked read for debugging, that content must go through the diagnostics redactor, not straight to the audit JSONL. This phase's audit rows should record `{command, cwd, verdict, reason}`, never tool *output*, to avoid recreating DIAG-07's credential-logging concern in a second log stream.

## Code Examples

### AWS mutating vs. read-only classification (SAFE-07)

```typescript
// Source: extracted @ramtinj95/pi-infra-command-guard@0.9.1 tool-policies.ts:324-338,
// 1436-1484 — read this session, reproduced verbatim as the reference for SAFE-07's
// allow-list. Do NOT install this package; this is the pattern to reimplement.
const SAFE_AWS_EXACT_OPERATIONS = new Set([
  "describe", "get", "head", "help", "list", "lookup",
  "ls", "query", "scan", "search", "select", "status", "wait",
]);
const SAFE_AWS_CONFIGURE_OPERATIONS = new Set(["list", "list-profiles"]);
const SAFE_AWS_SERVICE_OPERATIONS: Record<string, ReadonlySet<string>> = {
  cloudformation: new Set(["estimate-template-cost"]),
  logs: new Set(["filter-log-events", "tail"]),
  rds: new Set(["download-db-log-file-portion"]),
  route53: new Set(["test-dns-answer"]),
  route53domains: new Set(["check-domain-availability"]),
  s3api: new Set(["select-object-content"]),
};

function isSensitiveAwsRead(service: string, operation: string): boolean {
  if (service === "sts" && operation !== "get-caller-identity") return true; // note: get-caller-identity is explicitly excluded
  if (service === "configure" && !SAFE_AWS_CONFIGURE_OPERATIONS.has(operation)) return true;
  if (service === "secretsmanager") return true;
  if (service === "ssm" && /^(?:get-parameter|get-parameter-history|get-parameters|get-parameters-by-path)$/.test(operation)) return true;
  return /(?:access-details|access-token|authorization-token|credentials|federation-token|get-token|login-password|master-user-password|open-id-token|password-data|secret-value|session-token|signin-token|tokens-from-refresh-token)/.test(operation);
}

function isSafeAwsOperation(service: string, operation: string): boolean {
  return (
    SAFE_AWS_SERVICE_OPERATIONS[service]?.has(operation) === true ||
    SAFE_AWS_EXACT_OPERATIONS.has(operation) ||
    /^(?:admin-get|batch-get|describe|get|head|list|lookup|search|simulate|validate)-/.test(operation)
  );
}

// Verified worked examples:
//   aws sts get-caller-identity  → sensitive? no (excluded). safe? operation "get-caller-identity"
//                                   matches /^get-/ → ALLOW.
//   aws s3 ls                    → sensitive? no. safe? "ls" is in SAFE_AWS_EXACT_OPERATIONS → ALLOW.
//   aws s3 rm s3://bucket/key    → sensitive? no. safe? "rm" matches none of the above → CONFIRM/DENY.
//   aws iam create-access-key    → "create-access-key" not in isSafeAwsOperation → CONFIRM.
```

### unbash AST vocabulary the deny predicate must check

```typescript
// Source: unbash@4.0.10 dist/types.d.ts, read this session
// (package installed only in the scratchpad for inspection — not in this repo)
export interface CommandExpansionPart { type: "CommandExpansion"; text: string; script: ParsedScript | undefined; inner: string | undefined; }
export interface ProcessSubstitutionPart { type: "ProcessSubstitution"; text: string; operator: "<" | ">"; script: ParsedScript | undefined; }
export interface ArithmeticCommandExpansion { type: "ArithmeticCommandExpansion"; text: string; inner: string | undefined; script: ParsedScript | undefined; }
export type RedirectOperator = ">" | ">>" | "<" | "<<" | "<<-" | "<<<" | "<>" | "<&" | ">&" | ">|" | "&>" | "&>>";
export interface Redirect { operator: RedirectOperator; target: Word | undefined; body: Word | undefined; /* ... */ }
export interface Statement { type: "Statement"; command: Node; background: boolean | undefined; redirects: Redirect[]; }
export interface Word { text: string; value: string; parts?: WordPart[]; }
```

### Deny-by-default confirm shape confirmed in Pi's own bundled example

```typescript
// Source: Pi 0.84.1, examples/extensions/permission-gate.ts:19-30 (read this session)
if (isDangerous) {
    if (!ctx.hasUI) {
        // In non-interactive mode, block by default
        return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
    }
    const choice = await ctx.ui.select(`⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`, ["Yes", "No"]);
    if (choice !== "Yes") {
        return { block: true, reason: "Blocked by user" };
    }
}
```

### Wrapped built-in tool via spread override — confirmed exported factory

```typescript
// Source: dist/index.d.ts:18 — createBashTool, createEditTool, createWriteTool,
// createReadTool are all exported factories, VERIFIED this session by reading the
// .d.ts directly. This is what makes "wrap a built-in tool's execute()" possible
// without reimplementing the tool.
import { createBashTool, createEditTool, createWriteTool, createReadTool } from "@earendil-works/pi-coding-agent";

const bashTool = createBashTool(process.cwd());
pi.registerTool({
  ...bashTool,
  execute: async (toolCallId, params, signal, onUpdate, ctx) => {
    const verdict = evaluateBashCommand(params.command, ctx.cwd);
    if (!verdict.allow) throw new Error(verdict.reason); // throw -> isError:true to the model
    return bashTool.execute(toolCallId, params, signal, onUpdate, ctx);
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Regex string matching over `git push`/`glab mr merge` | AST parsing via `unbash`, walked for specific node types | This project's own PITFALLS.md research, corroborated by the one credible prior-art extension choosing the same library | Defeats variable indirection, command substitution, nested shells, quoting tricks — the entire PITFALLS.md 14-row bypass table except PATH shadowing, task-runner indirection, and encoding, which remain genuinely out of scope for a bash-AST guard (see SAFE-15's published table below) |
| Trusting a parser's `errors` field as "unparseable" | Node-type presence check on a tolerant parser's full AST | Settled this session by direct execution against 24 real inputs | This is the actual mechanism SAFE-03 must ship; "fail on parse error" would ship a guard that fails closed almost never |

**Deprecated/outdated:** the idea (present in an earlier draft of this project's own PITFALLS.md, corrected there) that a hand-rolled string matcher is "adequate" for a mistake-catcher threat model — it is adequate only against *unobfuscated* mistakes, and a confused model routinely produces the obfuscated forms (variable assignment before a command, `sh -c` wrapping) without any adversarial intent at all.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A re-export stub (`export { default } from "<absolute path>"`) written into `~/.pi/agent/extensions/ky-safety/index.ts` correctly loads and delegates via jiti, and is re-resolved fresh by each new `pi` process (including a subagent's) | Pattern 6 | If jiti caches module resolution in a way that pins a stub to a stale target, or the absolute-path import specifier form is rejected, user-scope loading silently fails and SAFE-11/SAFE-12 ship broken. **Must be spiked in Wave 0** before the plan commits to this mechanism over a directory copy. |
| A2 | `unbash` is ESM-only with no CJS interop issue against this repo's vitest/jiti toolchain | Standard Stack | If there is an interop issue, the parser cannot be imported at all — would surface immediately as a Wave-0 import failure, low actual risk given this repo is already `"type": "module"` |
| A3 | A substring-containment check over a shell-runner segment's raw text (`sh -c "git push"` → deny because the segment text contains `git`) is sufficiently precise for this project's narrow guarded-verb list, without false-positiving on benign commands that merely mention "git" in a string argument | Pattern 2 | Could over-block (e.g., `echo "run git push manually"` inside a `sh -c` wrapper) — acceptable for a fail-closed mistake-catcher per CONTEXT.md's stated posture, but the evasion/false-positive corpus (SAFE-17) should include at least one benign-string-containing-guarded-verb case to confirm the false-positive rate is tolerable |
| A4 | The 10-minute approval TTL and one-shot-per-exact-command-string grant scheme, carried over from the reference implementation, is an appropriate default for this project without modification | Pattern 3 | Low risk — this is explicitly Claude's discretion per CONTEXT.md, and the number is grounded in a working prior-art implementation rather than invented |

**If this table is empty:** not applicable — see rows above.

## Open Questions

1. **Does the Wave-0 re-export-stub spike (A1) actually work on Windows via Git Bash's path handling?**
   - What we know: jiti loads `.ts` via ESM import with no build step; absolute POSIX-style paths (`/c/Users/...`) and Windows paths both parse cleanly in `unbash` argument position (settled this session), but that is a *bash-parsing* fact, not a *jiti-import-specifier* fact.
   - What's unclear: whether a Node/jiti `import` specifier accepts a Windows absolute path (`C:\Users\...\index.ts`) directly, needs a `file://` URL, or needs forward-slash normalisation.
   - Recommendation: Wave 0 of the plan should spike this with a two-line stub and `tests/helpers/pi.ts`'s `runPi()` against a throwaway `PI_CODING_AGENT_DIR`, before any policy logic is written.

2. **What is the cheapest faithful proxy for "blocked inside a spawned subagent" (SAFE-12) given `pi-subagents` is not installed until Phase 7?**
   - What we know: `pi-subagents@0.47.1` spawns a real headless child `pi` process resolving to the `pi` binary or `node <piCliPath>` [PITFALLS.md Pitfall 15, `pi-spawn.ts:139-163`]. That mechanism's safety-relevant properties — no UI bound, `noOpUIContext`, project trust unresolved — are exactly what a plain `pi --mode json` (or `-p`) subprocess spawned via `tests/helpers/pi.ts`'s existing `runPi()` also exhibits, with no third-party package needed.
   - What's unclear: whether the child process can be driven to actually *attempt* a blocked tool call without a live model credential. The credible route is composing `runPi()` (real spawned CLI subprocess) with `tests/helpers/loopback.ts`'s local HTTP capture server (already proven in Phase 3 for DashScope) as a scripted local OpenAI-compatible provider that returns a canned tool call for the blocked command on the first turn — this exact composition (spawned subprocess + loopback provider) has not been done anywhere in this repo yet.
   - Recommendation: treat this as its own Wave-0 spike, separate from A1. If it proves too fragile inside Phase 4's timeline, fall back to testing the *load* half (user-scope loading in a headless process) end-to-end while testing the *policy* half (block predicate correctness) at the unit/session layer with `fauxProvider`, and explicitly note in the plan that full pi-subagents-mediated verification is deferred to Phase 7's EXT-09 smoke-test ritual, which already names "one blocked command" as a required check on every version bump.

3. **Exact list of git subcommands and flags that constitute a "write to the currently-checked-out branch"**
   - What we know: `push` (without an explicit different target via `-C`/remote override), `commit`, `reset`, `merge` (into current branch), `rebase` (when rewriting current branch history, as opposed to `rebase <other>` read-preview forms), `cherry-pick`, `revert` are candidates.
   - What's unclear: the exact flag-level boundary for each (e.g., `git rebase main` while `HEAD` is a feature branch is a legitimate write to the feature branch, not to `main` — so the *target* of the write, not merely the presence of the word "main", is what must be checked; `git commit --amend` while on `main` is unambiguously a write to `main`).
   - Recommendation: the plan should build this as an explicit per-subcommand table (mirroring the reference implementation's `evaluateGit`/`gitApprovalDecision` shape) rather than a single boolean predicate, and the evasion corpus (SAFE-17) should include both the write-when-on-main deny cases and the read-only-on-main allow cases side by side.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `unbash` (npm) | SAFE-02, SAFE-03 (AST parsing) | ✓ (registry reachable this session) | `4.0.10` | — |
| `git` | SAFE-04, SAFE-05 (HEAD detection), `tests/helpers/git.ts` | ✓ (already a hard project dependency, used throughout Phases 1–3) | — | — |
| `pi` CLI on PATH | SAFE-10/SAFE-12 end-to-end tests via `tests/helpers/pi.ts` | ✓ (already required and used by Phases 1–3's load-path tests) | 0.84.1 pinned | — |
| GitLab (live service) | SAFE-01 | ✗ — no network egress, no GitLab credentials on this machine | — | None — this is exactly why SAFE-01 is the phase's one `[RUNBOOK]` requirement; the offline proxy is a local bare repo with a `pre-receive` hook (see below) |
| `slopcheck` (Python/pip) | Package Legitimacy Gate | ✓ (installed this session) | 0.6.1 | — |

**Missing dependencies with no fallback:** GitLab live server-side push-rule verification (SAFE-01) — this is the phase's designed `[RUNBOOK]` gap, not an oversight.

**Missing dependencies with fallback:** none beyond the above.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 (pinned, matches Pi core — already the project's framework across Phases 1–3) |
| Config file | none dedicated — `package.json#scripts.test` = `vitest run`; `test:unit` = `vitest run tests/unit` |
| Quick run command | `npx vitest run tests/unit/<file>.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SAFE-01 | Server-side branch protection verified by an attempted push that fails | manual-only (live GitLab), with an offline proxy | offline proxy: local bare repo + `pre-receive` hook test | ❌ Wave 0 — new fixture |
| SAFE-02 | `unbash` AST resolves wrappers (`sudo`, `env`, `sh -c`, `xargs`) so indirection is caught | unit | `npx vitest run tests/unit/shell-parse.test.ts` | ❌ Wave 0 |
| SAFE-03 | Unparseable-in-policy-sense constructs (command substitution, heredoc, backgrounding) fail closed | unit | `npx vitest run tests/unit/shell-deny-list.test.ts` | ❌ Wave 0 |
| SAFE-04 | Writes blocked on `HEAD==main`; reads (`fetch`/`rebase`/`diff`/`log`/`worktree add -b`) allowed | unit + integration (real git repo via `tests/helpers/git.ts`) | `npx vitest run tests/unit/git-policy.test.ts tests/integration/git-head-main.test.ts` | ❌ Wave 0 |
| SAFE-05 | `glab mr merge` blocked | unit | (same file as SAFE-04's policy table) | ❌ Wave 0 |
| SAFE-06 | Reads of `.env`, `~/.aws/credentials`, kubeconfig, `*.tfstate` blocked | unit | `npx vitest run tests/unit/path-policy.test.ts` | ❌ Wave 0 |
| SAFE-07 | `terraform apply\|destroy\|import`, mutating `aws`, `kubectl delete` require confirmation | unit | `npx vitest run tests/unit/infra-policy.test.ts` | ❌ Wave 0 |
| SAFE-08 | Writes/deletes outside project directory blocked | unit | (same file as SAFE-06's path policy) | ❌ Wave 0 |
| SAFE-09 | Enforcement happens twice (hook + wrapped tool) | session (fauxProvider + SessionManager.inMemory, asserting a mutated `event.input` after hook-allow is still caught by the wrapper) | `npx vitest run tests/integration/double-enforcement.test.ts` | ❌ Wave 0 |
| SAFE-10 | Deny-by-default under `--mode json`; CI asserts the deny headless | end-to-end (`pi --mode json` via `tests/helpers/pi.ts`) | `npx vitest run tests/integration/headless-deny.test.ts` | ❌ Wave 0 — real subprocess, see Open Question 2 |
| SAFE-11 | Safety extensions install at user scope | integration (throwaway `PI_CODING_AGENT_DIR`, load-path pattern already established by `tests/integration/load-paths.test.ts`) | `npx vitest run tests/integration/user-scope-load.test.ts` | ❌ Wave 0 |
| SAFE-12 | Blocked-command test passes inside a spawned subagent | end-to-end (real subprocess; see Open Question 2 for the exact composition and its fallback) | `npx vitest run tests/integration/subagent-block.test.ts` | ❌ Wave 0 — the phase's single most expensive test |
| SAFE-13 | Non-bash surface guarded (`.git/hooks/*`, `.git/config`, `~/.bashrc`, `~/.gitconfig`, CI workflow files) | unit | (same file as SAFE-06/08's path policy, extended) | ❌ Wave 0 |
| SAFE-14 | Every allow and block written to audit JSONL | unit + integration (reuse Phase 2's concurrency proof pattern) | `npx vitest run tests/unit/audit-jsonl.test.ts tests/integration/audit-concurrency.test.ts` | ❌ Wave 0 |
| SAFE-15 | Published limits table | documentation deliverable, verified by a test that the table exists and every evasion-corpus "out of scope" row is represented | `npx vitest run tests/unit/docs-policy.test.ts` (extended) | partial — file exists, needs SAFE-15 rows added |
| SAFE-17 | ≥30 evasion attempts, each blocked or documented out of scope | unit (data-table-driven test over the corpus) | `npx vitest run tests/unit/evasion-corpus.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the specific unit/integration file for the task just completed
- **Per wave merge:** `npx vitest run tests/unit tests/integration` (excluding the SAFE-12 real-subprocess test if it proves too slow for routine runs — flag it `describe.skip` gated behind an explicit env var if wall-clock becomes a problem, but it must still run at phase gate)
- **Phase gate:** full suite green (`npx vitest run`) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/shell-parse.test.ts` — wrapper resolution (SAFE-02)
- [ ] `tests/unit/shell-deny-list.test.ts` — AST node-type deny predicate (SAFE-03)
- [ ] `tests/unit/git-policy.test.ts` + `tests/integration/git-head-main.test.ts` — HEAD==main write/read classification (SAFE-04, SAFE-05)
- [ ] `tests/unit/path-policy.test.ts` — sensitive-path reads and non-bash surface (SAFE-06, SAFE-08, SAFE-13)
- [ ] `tests/unit/infra-policy.test.ts` — terraform/aws/kubectl confirmation gate (SAFE-07)
- [ ] `tests/integration/double-enforcement.test.ts` — hook + wrapper, mutated-input scenario (SAFE-09)
- [ ] `tests/integration/headless-deny.test.ts` — real `pi --mode json` subprocess (SAFE-10)
- [ ] `tests/integration/user-scope-load.test.ts` — throwaway `PI_CODING_AGENT_DIR` load proof (SAFE-11)
- [ ] `tests/integration/subagent-block.test.ts` — the expensive one; spike per Open Question 2 (SAFE-12)
- [ ] `tests/unit/audit-jsonl.test.ts` + `tests/integration/audit-concurrency.test.ts` — reusing the extracted shared jsonl module (SAFE-14)
- [ ] `tests/unit/evasion-corpus.test.ts` — the ≥30-row table (SAFE-17), which doubles as the SAFE-15 published-table source data
- [ ] Extraction spike: `.pi/lib/jsonl.ts` shared module + the two thin bindings in `diagnostics/jsonl.ts` and `safety/audit.ts`, with existing Phase 2 tests re-pointed and still green (no regression)
- [ ] Wave-0 spike for the re-export stub (Open Question 1 / Assumption A1)
- [ ] `RB-04-01` appended to `docs/RUNBOOK.md`, `PHASE_FOUR_IDS = ["RB-04-01"]` added to `tests/unit/docs-policy.test.ts`'s `ALL_IDS`, with an `ENTRY_COMMANDS["RB-04-01"]` pin

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | This phase does not authenticate anything; it gates tool execution |
| V3 Session Management | no | — |
| V4 Access Control | yes | The entire phase *is* an access-control layer over tool execution — deny-by-default, two-layer enforcement (Pattern 3, Pattern 5) |
| V5 Input Validation | yes | `unbash` AST parsing + node-type deny-list is the input-validation control for shell commands; path normalisation (Pitfall 3) is the input-validation control for file-path arguments |
| V6 Cryptography | no | No cryptographic material is generated, stored, or verified by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via shell metacharacters/indirection (`$(...)`, `sh -c`, variable assignment) | Tampering / Elevation of Privilege | AST-based node-type deny-list (Pattern 1), never string matching |
| Post-approval input mutation by a later-loaded extension | Tampering | Two-layer enforcement — wrapped tool `execute()` re-validates independent of what the hook saw (Pattern 3, Pattern 5) |
| Fail-open under headless/CI execution | Elevation of Privilege | Deny-by-default written as the default branch, verified against `noOpUIContext` under `--mode json` (Pattern 4) |
| Audit-log tampering or omission | Repudiation | Append-only writer (already built and hardened in Phase 2), reused rather than reimplemented; every allow *and* every block recorded, not only blocks — an absent guard reads identically to "nothing dangerous happened" otherwise (PITFALLS.md Pitfall 15's warning sign) |
| Extension load-order manipulation (a compromised or misordered co-installed extension registers a competing `bash` tool or a later `tool_call` handler) | Tampering / Denial of Service | Load-order verification as an explicit Wave-0/CI concern (Pattern 5); this is a **residual, documented** risk, not one this phase can fully close — a malicious extension installed *after* the safety extension in load order and granted first-registration on the `bash` tool name would defeat the wrapper layer entirely. This is exactly the class of risk GitLab server-side protection exists to catch regardless. |
| Non-bash tool-execution surface (a custom extension-registered tool that shells out internally) | Elevation of Privilege | Explicitly out of scope for this phase's AST guard (PITFALLS.md's bypass table, "Custom tool" row) — must be named in SAFE-15's published limits table, not silently assumed covered |

## Sources

### Primary (HIGH confidence)
- `@earendil-works/pi-coding-agent@0.84.1` installed at `C:\Users\Admin\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\` — `dist/core/extensions/types.d.ts` (event/result types, lines 600-900), `dist/core/extensions/loader.js` (registerTool implementation), `dist/core/extensions/runner.js` (`noOpUIContext`, `hasUI()`, `getAllRegisteredTools()` first-wins collision resolution), `dist/index.d.ts` (exported tool factories `createBashTool`/`createEditTool`/`createWriteTool`/`createReadTool`), `docs/extensions.md` (extension location table, lines 109-121), `examples/extensions/{permission-gate,protected-paths,confirm-destructive,dirty-repo-guard,git-checkpoint}.ts` — all five named files read in full this session
- `unbash@4.0.10` — `dist/types.d.ts` (full AST vocabulary, read this session), installed and inspected in the scratchpad; not installed into this repo
- `@ramtinj95/pi-infra-command-guard@0.9.1` — full tarball fetched via `npm pack` into the scratchpad, extracted, and read this session: `approvals.ts` (full file), `index.ts` (full file), `shell.ts` (full file, 929 lines), `policy.ts` (full file), `tool-policies.ts` (relevant sections: AWS/git/kubectl/terraform classifiers, lines 121-350, 1331-1700). **Not installed as a project dependency**, per CONTEXT.md decision 9.
- This repository: `.pi/extensions/diagnostics/jsonl.ts` (full file, read this session), `.planning/config.json`, `tests/helpers/{git,pi,loopback}.ts`, `tests/unit/{extension-layout,docs-policy}.test.ts`, `package.json`, `.gitignore`, `docs/RUNBOOK.md`, `docs/DIAGNOSTICS.md`, `.planning/research/{PITFALLS,ARCHITECTURE}.md`

### Secondary (MEDIUM confidence)
- `npm view unbash version time.modified repository.url license` — executed this session, corroborates CLAUDE.md's prior claims
- `python -m slopcheck install unbash` — executed this session, `[OK]` verdict (the subsequent `npm install` step crashed on Windows subprocess invocation before any files changed — confirmed via `git status --porcelain` after the fact)

### Tertiary (LOW confidence)
- None — every substantive claim in this document traces to a `file:line` citation, a session-executed command, or a locked CONTEXT.md decision carried forward verbatim.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — single package, version/publish-date/repo/license/slopcheck all independently confirmed this session
- Architecture (deny-by-default, load order, user-scope loading): HIGH for the parts verified at `file:line` this session; the re-export-stub mechanism (Pattern 6) is `[ASSUMED]` and named as a Wave-0 spike
- Pitfalls: HIGH — every pitfall above is either VERIFIED-by-execution (this session or the orchestrator's) or a direct `file:line` citation
- SAFE-12's testability (Open Question 2): MEDIUM — the mechanism is reasoned from verified facts but the exact composition (spawned subprocess + loopback provider) has not been executed in this repo yet

**Research date:** 2026-08-14
**Valid until:** Pinned to Pi 0.84.1 / unbash 4.0.10. Re-verify before planning if either version has moved — Pi ships every ~2.3 days per PITFALLS.md Pitfall 16.
