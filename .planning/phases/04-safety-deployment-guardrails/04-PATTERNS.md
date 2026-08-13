# Phase 4: Safety & Deployment Guardrails - Pattern Map

**Mapped:** 2026-08-14
**Files analyzed:** 24 (7 new source files, 3 modified source/config files, 1 new doc, 13 new test files + 3 modified test files)
**Analogs found:** 21 / 24 (3 have no close analog — see "No Analog Found")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `.pi/extensions/safety/index.ts` | middleware (extension entry point) | event-driven (tool_call hook + registerTool wrapping) | `.pi/extensions/diagnostics/index.ts` | role-match (entry-point shape identical; no existing `tool_call`/`registerTool` analog in-repo) |
| `.pi/extensions/safety/shell.ts` | utility (AST walk / classifier) | transform | `.pi/extensions/providers/sso.ts` (classifier shape) + RESEARCH.md Pattern 1 (unbash-specific) | role-match |
| `.pi/extensions/safety/policy.ts` | utility (pure decision function) | transform | `.pi/extensions/diagnostics/budget.ts` (pure compute functions) + `.pi/extensions/providers/sso.ts` (classify → verdict shape) | role-match |
| `.pi/extensions/safety/approvals.ts` | store (in-process state) | CRUD (create/validate/consume) | none in-repo; RESEARCH.md Pattern 3 (`ApprovalStore` sketch, stolen not copied) | no analog — new shape |
| `.pi/extensions/safety/audit.ts` | utility (thin binding over shared JSONL writer) | file-I/O | `.pi/extensions/diagnostics/jsonl.ts` (the writer this binds to) | exact (same writer, different `base`) |
| `.pi/lib/jsonl.ts` | utility (extracted generic module) | file-I/O | `.pi/extensions/diagnostics/jsonl.ts` (source of the extraction) | exact (literal extraction) |
| `.pi/extensions/diagnostics/jsonl.ts` (modified) | utility (thin re-export binding) | file-I/O | itself, pre-extraction | exact (refactor, not rewrite) |
| `package.json` (modified) | config | — | existing `devDependencies`/`peerDependencies` blocks | exact |
| `bin/bootstrap.sh` (modified — new function) | config/install script | file-I/O (idempotent merge-write) | `merge_settings()` / `merge_models_json()` in the same file | exact |
| `docs/RUNBOOK.md` (modified — append RB-04-01) | doc | — | `RB-03-xx` entries (five-part contract) | exact |
| `docs/SAFETY.md` (new — SAFE-15 limits table) | doc | — | `docs/DIAGNOSTICS.md` (published schema/limits doc) | role-match |
| `tests/unit/contributing-boundary.test.ts` (modified) | test | — | itself (extend `TOOL_REGISTRATION_ALLOWLIST`) | exact |
| `tests/unit/docs-policy.test.ts` (modified) | test | — | itself (extend `ALL_IDS`/`ENTRY_COMMANDS`, following the Phase 3 precedent) | exact |
| `tests/unit/jsonl-append-only.test.ts` (modified) | test | — | itself (extend scanned set / writer assertion for the extraction) | exact |
| `tests/unit/shell-parse.test.ts` | test | transform | `tests/unit/redact.test.ts` / `tests/unit/prose-detector.test.ts` (pure-function table-driven unit test) | role-match |
| `tests/unit/shell-deny-list.test.ts` | test | transform | same as above | role-match |
| `tests/unit/git-policy.test.ts` | test | transform | `tests/unit/bedrock-auth.test.ts` (pure classifier, both directions) | role-match |
| `tests/integration/git-head-main.test.ts` | test | CRUD (real git repo) | none in-repo uses a real git checkout under test yet; `tests/helpers/git.ts` is the primitive | no analog — new composition of an existing helper |
| `tests/unit/path-policy.test.ts` | test | transform | `tests/unit/redact.test.ts` (pattern-table unit test) | role-match |
| `tests/unit/infra-policy.test.ts` | test | transform | `tests/unit/redact.test.ts` | role-match |
| `tests/integration/double-enforcement.test.ts` | test | event-driven (session-layer) | `tests/integration/prose-retry.test.ts` (fauxProvider + live session, asserts hook effect) | role-match |
| `tests/integration/headless-deny.test.ts` | test | request-response (real subprocess) | `tests/integration/load-paths.test.ts` case 4 (the trust-gate control: real `pi` subprocess, negative assertion) | exact |
| `tests/integration/user-scope-load.test.ts` | test | request-response (real subprocess) | `tests/integration/load-paths.test.ts` cases 1–3 | exact |
| `tests/integration/subagent-block.test.ts` | test | request-response (real subprocess + loopback) | `tests/integration/load-paths.test.ts` (subprocess) + `tests/helpers/loopback.ts` (scripted server) composed | role-match (RESEARCH Open Question 2 — novel composition) |
| `tests/unit/audit-jsonl.test.ts` | test | file-I/O | `tests/unit/jsonl-rotation.test.ts` | exact |
| `tests/integration/audit-concurrency.test.ts` | test | file-I/O (concurrent subprocesses) | `tests/integration/jsonl-concurrency.test.ts` | exact |
| `tests/unit/evasion-corpus.test.ts` | test | transform (data-table-driven) | `tests/unit/redact.test.ts` (fixture-table + inline-fixture-liveness pattern) | role-match |
| SAFE-01 offline proxy (new integration test, e.g. `tests/integration/gitlab-push-protection.test.ts`) | test | file-I/O (local bare repo + hook) | `tests/helpers/git.ts` (git-oracle helper) + `tests/helpers/stub-bin.ts` shape | role-match — new composition |

## Pattern Assignments

### `.pi/extensions/safety/index.ts` (extension entry point, event-driven)

**Analog:** `.pi/extensions/diagnostics/index.ts` for entry-point shape, load order and `safeHandler`-style failure containment; `.pi/extensions/providers/index.ts` for "why a new directory, not an addition to an existing sealed one."

**Entry-point contract, exactly what makes an extension auto-discovered and hot-reloadable** (`.pi/extensions/diagnostics/index.ts:432` / `.pi/extensions/harness/index.ts:68`):
```typescript
export default function (pi: ExtensionAPI): void {
	pi.on("session_start", safeHandler<SessionStartEvent>("session_start", (_event, ctx) => { ... }));
	// registerTool / registerCommand calls go here
}
```
This is the shape `tests/unit/extension-layout.test.ts`'s `isEntryPoint()` (`tests/unit/extension-layout.test.ts:95`) keys on: a statement-position `export default function (pi) {…}`. Every sibling module (`shell.ts`, `policy.ts`, `approvals.ts`, `audit.ts`) must carry **no default export**, or the layout test reclassifies it as an entry point that must sit at `.pi/extensions/<dir>/index.ts` itself.

**Failure containment, imported not re-implemented** (`.pi/extensions/providers/index.ts:71-79,101`):
```typescript
import { safeHandler } from "../diagnostics/index.ts";
...
pi.on("message_end", safeHandler<MessageEndEvent, MessageEndReplacement>(HANDLER_NAME, async (event, ctx) => { ... }));
```
`providers/index.ts` demonstrates the sanctioned way to reuse `diagnostics/index.ts`'s `safeHandler` — import the named export only; never call the diagnostics module's own `default` export. The same import is the right move for `safety/index.ts`, so a thrown exception inside the `tool_call` hook or a wrapped tool's `execute()` leaves an audit row instead of vanishing into Pi's own swallowed-exception path (`dist/core/extensions/runner.js:861-870`, cited at `.pi/extensions/diagnostics/index.ts:87-93`).

**Why a new directory, not an addition to `diagnostics/`** (`.pi/extensions/providers/index.ts:63-70`): the same reasoning applies twice over here — `tests/unit/diagnostics-entry.test.ts` asserts an exact hook count and command count for `diagnostics/index.ts`, and (new to this phase) CONTEXT.md decision 7 additionally forbids `safety/` importing anything from `diagnostics/` except the narrow `safeHandler` reuse the providers extension already established as acceptable. **Confirm with the planner whether even `safeHandler` reuse is inside decision 7's "imports nothing from routing or workflows"** — decision 7 names routing/workflows, not diagnostics, and the Don't-Hand-Roll table explicitly permits reusing the *audit* writer but is silent on `safeHandler`; the safest reading, given "source-reviewable in isolation," is that `safety/` should define its own minimal failure wrapper rather than import even `safeHandler` from `diagnostics/`. Flag this as a plan-time decision, not a settled pattern.

**No `tool_call`/`registerTool` analog exists in this repo.** Every extension shipped in Phases 1–3 registers only commands and event hooks (`.pi/extensions/harness/index.ts:36`, `.pi/extensions/diagnostics/index.ts:28-39`, `.pi/extensions/providers/index.ts` uses `message_end` only) — `tests/unit/contributing-boundary.test.ts` currently bans `registerTool` everywhere under `.pi/extensions/` via an **empty** `TOOL_REGISTRATION_ALLOWLIST` (`tests/unit/contributing-boundary.test.ts:80`). Safety's wrapped `bash`/`write`/`edit`/`read` tools and the `approve_ky_command` tool are the **first** tool registrations in this codebase. **The plan must add `.pi/extensions/safety/index.ts` to `TOOL_REGISTRATION_ALLOWLIST` in the same commit that registers a tool**, with the (a)/(b)/(c) justification CONTRIBUTING.md requires (`CONTRIBUTING.md:39-46`) written beside the entry — RESEARCH.md's own text ("The `approve_ky_command` tool is justified…") is the (a)/(b)/(c) answer to transcribe. For the wrapped-tool pattern itself (not the gate), use RESEARCH.md's own verified Code Example (`04-RESEARCH.md:593-611`, `createBashTool`/`createEditTool`/`createWriteTool`/`createReadTool` spread-override) — there is no in-repo prior art for this, so cite RESEARCH.md directly rather than a codebase file.

**Load-order verification.** Per RESEARCH Pattern 5, `getAllRegisteredTools()` is first-registration-wins — `safety/index.ts` must be verified to register before any other extension that might also name a tool `bash`. No in-repo test currently asserts extension load *order* (only load *path*); `tests/integration/load-paths.test.ts` is the closest scaffold to extend or copy for an order assertion, but none exists today — treat as new.

---

### `.pi/extensions/safety/shell.ts` (utility, transform)

**Analog:** `.pi/extensions/providers/sso.ts` for the shape of a pure classifier module (input → verdict union, no I/O, no `ctx`), and RESEARCH.md Pattern 1 / Pattern 2 for the unbash-specific walk logic itself (there is no in-repo unbash usage to copy from — this is genuinely new).

**Pure classifier shape to copy** (`.pi/extensions/providers/sso.ts`, referenced from `.pi/extensions/providers/index.ts:282`):
```typescript
const verdict = classifySso(original);
if (verdict.kind !== "sso-credential") { return; }
```
`sso.ts` takes a string and returns a discriminated verdict object with no side effects — the same shape `shell.ts` needs for "denied / needs-wrapper-resolution / clean," and it is what makes the module unit-testable with zero session machinery (mirrors `tests/unit/bedrock-auth.test.ts`'s "resolve in both directions, no session" style).

**The AST walk itself has no in-repo analog** and must be built from RESEARCH.md Pattern 1 (`04-RESEARCH.md:264-348`, the node-type deny-list over `unbash`'s `Word`/`Redirect`/`Statement` types) and Pattern 2 (`04-RESEARCH.md:329-350`, wrapper resolution for `sudo`/`env`/`sh -c`/`xargs`). Cite RESEARCH.md `file:line` directly in the plan for this file; there is nothing in this codebase to point at instead.

**Purity discipline to copy** (`.pi/extensions/diagnostics/redact.ts:59-65`): "No imports [beyond the parser], no I/O, no dependency… hand-rolled and kept short enough to read end to end." `shell.ts` should follow the same purity contract — it is handed untrusted command text and must be independently unit-testable via `tests/unit/shell-parse.test.ts`/`shell-deny-list.test.ts` with no `ctx`, no filesystem, no faux session.

---

### `.pi/extensions/safety/policy.ts` (utility, transform)

**Analog:** `.pi/extensions/diagnostics/budget.ts` for "pure compute functions, ctx-free, exported so a unit test can drive them with inline fixtures" and `.pi/extensions/providers/sso.ts` for the classify → verdict → message shape.

**Pure-function discipline** (`.pi/extensions/diagnostics/budget.ts:44-50`):
```
PURITY. {@link sliceSystemPrompt}, {@link computeBudget} and {@link formatBudgetReport}
touch no `ctx` member and no filesystem. They take strings and numbers and
return strings and numbers, which is what lets tests/unit/budget-sections.test.ts
drive them against inline fixtures in milliseconds...
```
`policy.ts`'s `HEAD==main` / `glab mr merge` / terraform / aws / kubectl / path rules should be written the same way: pure functions over a canonical invocation (from `shell.ts`) plus caller-supplied facts (current branch name, cwd, resolved path), never reading `ctx` directly. That is what lets `tests/unit/git-policy.test.ts`, `path-policy.test.ts` and `infra-policy.test.ts` be table-driven unit tests with zero session machinery, and what lets `tests/integration/git-head-main.test.ts` supply the one fact (`HEAD`) that genuinely needs a real git repo without pulling the rest of policy into an integration test.

**AWS mutating/read-only classification — copy verbatim from RESEARCH, not from this repo** (`04-RESEARCH.md:519-561`, the `SAFE_AWS_EXACT_OPERATIONS`/`isSensitiveAwsRead`/`isSafeAwsOperation` code example, reproduced from the read-but-not-installed `@ramtinj95/pi-infra-command-guard@0.9.1`). No in-repo file has this classification; RESEARCH.md is the citation.

**`git symbolic-ref` as the HEAD oracle, not string parsing** — Don't-Hand-Roll row 3 (`04-RESEARCH.md:471`): `git symbolic-ref --short HEAD`, matching the house rule `tests/helpers/git.ts:6` already states ("ask git; do not reimplement it") and already applies via `repoRoot()`/`isIgnored()`/`trackedFiles()`. `policy.ts`'s HEAD check should shell out through the same discipline `tests/helpers/git.ts:42-53`'s `run()` demonstrates (`spawnSync("git", args, {cwd, encoding:"utf-8", shell:false, windowsHide:true})`), though the production code lives in the extension, not the test helper — the helper is the pattern to copy, not the module to import (extensions must not import from `tests/`).

---

### `.pi/extensions/safety/approvals.ts` (in-process store, CRUD)

**No in-repo analog.** This is a genuinely new shape (an in-memory `Map`-backed pending/granted store with TTLs) — nothing in `diagnostics/` or `providers/` keeps mutable session-lifetime state shaped like this (the closest structural cousin, `diagnostics/index.ts`'s `inFlight`/`proseRetriesThisRun` module-level `let`s, is a single-slot accumulator, not a keyed store).

**Steal the shape from RESEARCH.md's Pattern 3** (`04-RESEARCH.md:356-379`), reproduced there from the read-but-not-installed reference guard's `approvals.ts` — `createPending`, `validate` (id + command + reason must all match, not just the id), `approve` (deletes pending, stores a one-shot grant keyed to a fingerprint, not the request id), `consume`. **Do not import that package**; re-implement the same shape.

**One in-repo precedent worth citing for the "module-level state duplicated across jiti module instances" hazard**: `.pi/extensions/diagnostics/index.ts:192-224`'s `ROWS_WRITTEN_KEY` docstring — jiti gives each extension's own import graph a separate module registry, so a plain module-level `Map` in `approvals.ts` could exist as two different instances if both `safety/index.ts` and a wrapped tool's `execute()` reach it through different import paths. If that risk applies here (it will, since the `tool_call` hook and the wrapped tool's `execute()` both need to read/write the same approval store), the `globalThis`-keyed-slot pattern at `.pi/extensions/diagnostics/index.ts:224` is the fix to copy, not a plain module `let`/`Map`.

---

### `.pi/extensions/safety/audit.ts` (thin binding, file-I/O)

**Analog:** `.pi/extensions/diagnostics/jsonl.ts` is not just the analog — it is the writer this file must bind to, per CONTEXT.md decision 7 (`safety/` must not import `diagnostics/`) combined with the Don't-Hand-Roll instruction to reuse the JSONL machinery. **The resolution the research already settled**: extract the generic parts of `.pi/extensions/diagnostics/jsonl.ts` (`appendJsonl`, `rotate`, `pruneLogs`, `logPath`, `logDir`) into `.pi/lib/jsonl.ts` (a neutral location, **not** under `.pi/extensions/`, so `tests/unit/extension-layout.test.ts` never needs to scope it — confirmed by that test's own `EXT_DIR = ".pi/extensions"` root at `tests/unit/extension-layout.test.ts:53`). Then:
- `.pi/extensions/diagnostics/jsonl.ts` becomes a thin re-export binding over `.pi/lib/jsonl.ts` (base names `"wire"`/`"turns"`, `OWNED_BASES` unchanged in meaning).
- `.pi/extensions/safety/audit.ts` becomes a second thin binding, base name `"audit"`, writing `{command, cwd, verdict, reason}` rows per RESEARCH Pitfall 6 (never tool *output*).

**Ownership scoping to preserve** (`.pi/extensions/diagnostics/jsonl.ts:99-116`, the `OWNED_BASES` docstring): `pruneLogs` deletes only files whose base name is in an explicit owned-bases allowlist, never by shape. Whatever module ends up owning retention for `audit-*.jsonl` (likely `.pi/lib/jsonl.ts` itself, parameterized, or a second `pruneLogs` caller in `safety/index.ts`'s `session_start`) must add `"audit"` to whatever the moved `OWNED_BASES` becomes — a retention rule scoped by shape rather than ownership would let the diagnostics prune step silently delete the safety audit log or vice versa.

**Confinement/validation to preserve exactly** (`.pi/extensions/diagnostics/jsonl.ts:139,167-198`): the `BASE_RE` allowlist and `assertInsideLogDir` throw-on-escape check are what stop a `base` string from ever resolving outside the log directory. Nothing about the extraction should weaken this — `.pi/lib/jsonl.ts` should keep both checks exactly as `diagnostics/jsonl.ts:139-198` has them today.

**CRITICAL GOTCHA for the planner — `tests/unit/jsonl-append-only.test.ts` hardcodes the writer's location.** `DIAGNOSTICS_DIR = ".pi/extensions/diagnostics"` (`tests/unit/jsonl-append-only.test.ts:59`) and `WRITER_FILE = ".pi/extensions/diagnostics/jsonl.ts"` (`:62`) are both literals, and the test asserts `WRITER_FILE`'s raw source still contains `appendFileSync` (`SANCTIONED_WRITE`, `:70`) — this is the "gutting the writer cannot turn the gate green" proof (`:47-49`). **Once `appendFileSync` moves to `.pi/lib/jsonl.ts`, this assertion goes red** unless the test is updated in the same change: either point `WRITER_FILE` at `.pi/lib/jsonl.ts` and widen the scanned tree to include it (the four forbidden-stream patterns currently protect only `.pi/extensions/diagnostics/`, so `.pi/lib/jsonl.ts` and `.pi/extensions/safety/audit.ts` need the same forbidden-pattern coverage — right now nothing scans either path), or keep a re-exported reference of the constant that satisfies the substring check. Treat this as a required, not incidental, edit — the plan must extend `tests/unit/jsonl-append-only.test.ts`'s scanned tree and `WRITER_FILE`/`SANCTIONED_WRITE` assertions in the same commit as the extraction.

---

### `.pi/lib/jsonl.ts` (extracted generic module, file-I/O)

**Analog:** the pre-extraction `.pi/extensions/diagnostics/jsonl.ts` itself — this is a literal move of `appendJsonl`, `rotate`, `pruneLogs`, `logPath`, `logDir`, `producedPaths`, `resetProducedPaths` and their supporting internals (`escapeForRegExp`, `cachedSize`, `isRegularFile`, `regularFileSize`, `unlinkQuietly`, `dateStamp`, `assertInsideLogDir`, the `sizeCache`/`produced` module state), out of `.pi/extensions/diagnostics/` and into a directory `package.json`'s `pi.extensions` manifest does not scan.

**What must NOT move**: `OWNED_BASES` (`.pi/extensions/diagnostics/jsonl.ts:116`) is diagnostics-specific (`[WIRE_LOG_BASE, TURNS_LOG_BASE]`) — the extracted module's retention function needs `ownedBases` supplied by the caller (each binding passes its own list), not a hardcoded diagnostics-only array, or `safety/audit.ts`'s `pruneLogs` call would delete nothing it owns, or worse, both bindings sharing one hardcoded list would let either delete the other's logs.

**Test impact beyond `jsonl-append-only.test.ts`** (see above): `tests/unit/jsonl-rotation.test.ts:37` and `tests/integration/jsonl-concurrency.test.ts:54` import `logDir`/`logPath`/`appendJsonl`/etc. **from `.pi/extensions/diagnostics/jsonl.ts`**, not from a hypothetical `.pi/lib/jsonl.ts` path. As long as `diagnostics/jsonl.ts` re-exports the moved names under the same identifiers, these two test files need **no changes** — this is the whole point of a "thin re-export binding" rather than a breaking move. Verify this re-export is exhaustive (every currently-exported name from `diagnostics/jsonl.ts` still resolves through it) before treating those two tests as unaffected.

---

### `package.json` (modified — `unbash@4.0.10`)

**Analog:** the existing `devDependencies`/`peerDependencies` blocks (`package.json:33-47`), and the pinning rules `tests/unit/pinning.test.ts` already enforces over them.

**Where it must land, and why it cannot land in `devDependencies`:** `tests/unit/pinning.test.ts:253-256` asserts `Object.keys(devDependencies)` equals **exactly** the six audited pins (`REQUIRED_DEV_PINS`, `:95-102`) — `unbash` in `devDependencies` fails that test immediately. It must go into a **new top-level `dependencies` field** (`package.json` currently has none), which `EXACT_FIELDS` (`tests/unit/pinning.test.ts:84`) already covers for the no-range-operator rule, so no change to `pinning.test.ts` itself is needed for that half. `unbash: "4.0.10"` (exact, no `^`/`~`) is the correct entry — this matches CONTEXT.md decision 2 / RESEARCH's Standard Stack table (`04-RESEARCH.md:120-131`) and CLAUDE.md's "Runtime deps must be in `dependencies`" rule.

**One thing to verify, not assume:** `tests/unit/pinning.test.ts` does not currently assert anything about a `dependencies` field's *contents* beyond the range-operator check (there is no `REQUIRED_DEPENDENCIES` allowlist analogous to `REQUIRED_DEV_PINS`) — so adding `unbash` to a new `dependencies` block should not require a `pinning.test.ts` edit, but re-run that file after the edit to confirm no other assertion (e.g., one iterating "all dependency-like fields") breaks.

**Package legitimacy note carried from RESEARCH**, not from this repo: `unbash`'s `postinstall` script has not been checked in this research pass (`04-RESEARCH.md:155`) — `npm view unbash scripts.postinstall` is a Wave-0 gate item, not yet satisfied.

---

### `bin/bootstrap.sh` (modified — user-scope extension install, SAFE-11)

**Analog:** `merge_settings()` (`bin/bootstrap.sh:494-527`) and `merge_models_json()` / `merge_auth_json()` (`:634-834`) — all three are the "read, parse with `node -e`, replace only the key/section that is ours, write back, report unchanged on a no-op" idiom this script uses everywhere it touches JSON, and `write_env_template()` (`:532-588`) is the analog for a **marked-region** file write (start/end sentinel, idempotent, never a whole-file clobber).

**The new function needed** (RESEARCH Pattern 6, `04-RESEARCH.md:439-455`): write a re-export stub at `~/.pi/agent/extensions/ky-safety/index.ts` (or `$PI_AGENT_DIR/extensions/ky-safety/index.ts`, respecting the same `PI_AGENT_DIR` variable already resolved at `bin/bootstrap.sh:63-83`) containing:
```typescript
export { default } from "/absolute/path/to/ky-pi-agent/.pi/extensions/safety/index.ts";
```
Follow `write_env_template`'s idempotency discipline (`bin/bootstrap.sh:581-586`, "already current — unchanged" short-circuit comparing existing bytes to the computed output) rather than an unconditional overwrite — a stub this script keeps re-writing on every bootstrap run is harmless but noisy, and idempotent-by-byte-comparison is the established house style. The absolute path must be built from `$REPO_ROOT` (already resolved at `bin/bootstrap.sh:60-61`) with backslashes normalized to forward slashes exactly as `tests/helpers/session.ts:180`'s `writeUserScopeShim()` does it (`targetAbsPath.replace(/\\/g, "/")`), for the same reason stated there: "a path inside a TypeScript string literal is a set of escape sequences on Windows, not a path."

**Where to call it from `run_full()`**: alongside `merge_settings`/`write_env_template`/`merge_models_json`/`merge_auth_json` (`bin/bootstrap.sh:928-931`) — after `install_pi`, since it configures Pi rather than gating the BOOT-01 hardening ordering (the same placement rule stated in the comment block above those four calls, `:836-841`).

**Test-side session helper already proves the mechanism works**, and is the pattern to imitate in a Wave-0 spike before wiring bootstrap: `tests/helpers/session.ts:177-192`'s `writeUserScopeShim()` is the exact re-export-stub shape, already exercised by every faux-session test that passes `extensionPath` (RESEARCH's Assumption A1 spike should use this helper directly rather than re-deriving the stub shape).

**`--assert-hardening` / `--check-only` extension**: `docs/RUNBOOK.md`'s Phase 1 machine-state notes point at `sh bin/bootstrap.sh --check-only` and `--assert-hardening` (`docs/RUNBOOK.md:174-186`) as the two re-checkable modes; whichever new user-scope-install verification SAFE-11 needs should follow `report_user_scope()`'s non-fatal-when-absent / fatal-when-present-but-wrong pattern (`bin/bootstrap.sh:443-450`) if it needs a `--check-only`-safe read-only check.

---

### `docs/RUNBOOK.md` (modified — append `RB-04-01`)

**Analog:** any `RB-03-xx` entry, e.g. `RB-03-03` (`docs/RUNBOOK.md:540-624`) for the fullest example of the four-part contract (exact command, expected output, offline proxy, status line) plus a "closed door" subsection, or the simpler `RB-01-01` (`docs/RUNBOOK.md:42-89`) for the shortest complete example.

**The exact four-part contract to reproduce** (`docs/RUNBOOK.md:8-24`):
1. the exact command, copy-pasteable, no placeholder;
2. the expected output, specific enough that "it seemed fine" fails;
3. the offline proxy — the in-repo test that verifies as much as possible without the missing thing (SAFE-01's is the local bare-repo + `pre-receive` hook test, per CONTEXT.md's specifics section);
4. a status line: `**Status:** OUTSTANDING`.

**Both places the status must appear, verbatim, and agreeing** — this is what `tests/unit/docs-policy.test.ts` mechanically enforces (see below): a summary-table row (`| RB-04-01 | ... | OUTSTANDING |`) **and** a `### RB-04-01 — …` subsection ending in a `**Status:** OUTSTANDING` line. `RB-03-03`'s pair (`docs/RUNBOOK.md:417,540,542`) is the cleanest template — table row first, detail subsection second, identical status token in both.

**Section header and ownership pattern**: `## Phase 3 — Providers & Credentials` (`docs/RUNBOOK.md:389`) with a summary table (`:413-419`) followed by per-entry `### RB-03-0N — …` subsections and a trailing `### Phase 3 machine-state notes` section (`:776`) — `## Phase 4 — Safety & Deployment Guardrails` should follow the identical shape: intro paragraph, summary table with the single `RB-04-01` row, one detail subsection, and (if warranted) a machine-state notes subsection for anything SAFE-15's published-limits material doesn't already cover.

**GitLab-specific offline-proxy content to cite in the entry**: RESEARCH's own recommendation (`04-RESEARCH.md:99`, "The honest proxy is a local test that a push to a branch matching the protected pattern is attempted and its rejection is parsed correctly — using `tests/helpers/git.ts` against a local bare repo with a pre-receive hook") — this is the offline proxy `RB-04-01` names, and it needs a POSIX `sh` `pre-receive` hook fixture (LF line endings, per CLAUDE.md's `.gitattributes` rule) as a new small artifact this phase creates, most naturally alongside the new integration test rather than as a tracked top-level script.

---

### `docs/SAFETY.md` (new — SAFE-15 published limits table)

**Analog:** `docs/DIAGNOSTICS.md`'s `## Redaction` section as a *published-contract* doc that a test cross-checks against source (see `tests/unit/docs-policy.test.ts` Group D, `docs-policy.test.ts:730-868`) — the closest existing example of "a doc that names exact behavior and gets pinned against the code that produces it."

**Structural pattern to copy**: Group D's mechanism (`tests/unit/docs-policy.test.ts:747-826`) — a section is sliced out of the doc by heading markers, its length is asserted non-trivial (vacuous-pass guard), and specific cue phrases / literal counts are asserted present, **derived from source where possible** (`truncationCauseCount()` counts `return TRUNCATION_PLACEHOLDER;` occurrences in `redact.ts` rather than hardcoding a number). SAFE-15's table should get the same treatment: `tests/unit/evasion-corpus.test.ts` (or an extension of `docs-policy.test.ts`) should assert that every "out of scope" row in the corpus is represented in `docs/SAFETY.md`'s published table, ideally by deriving the count from the corpus data structure rather than a hand-typed number — mirroring `truncationCauseCount()`'s "count out of the source rather than transcribe" discipline.

**Content spine**: PITFALLS.md's 14-row bypass table (`.planning/research/PITFALLS.md:452-468`, cited by CONTEXT.md specifics and RESEARCH's phase-requirements table for SAFE-15/SAFE-17) is the spine; `04-RESEARCH.md`'s own State of the Art table (`:617`) names the three bypass classes that stay genuinely out of scope for a bash-AST guard: PATH shadowing, task-runner indirection, and encoding.

---

### `tests/unit/contributing-boundary.test.ts` (modified)

**Analog:** itself — `TOOL_REGISTRATION_ALLOWLIST` (`tests/unit/contributing-boundary.test.ts:80`) is explicitly designed to be extended, "EMPTY BY DESIGN… To add an entry you must also add the (a)/(b)/(c) justification from CONTRIBUTING.md next to it, in the same commit."

**Required edit**: add `.pi/extensions/safety/index.ts` (and any other file that calls `registerTool` — likely only `index.ts` if the wrapped-tool factories are constructed there) to `TOOL_REGISTRATION_ALLOWLIST`, with the three answers inline as a comment, following the exact style CONTRIBUTING.md itself models (`CONTRIBUTING.md:41-46`). This is a **required**, not optional, test edit — omitting it fails `tests/unit/contributing-boundary.test.ts`'s "registers no tool anywhere under `.pi/extensions/`" assertion (`:122-135`) the moment `safety/index.ts` calls `pi.registerTool`.

---

### `tests/unit/docs-policy.test.ts` (modified — extend for Phase 4)

**Analog:** itself, following the exact precedent set when Phase 3 was added (`tests/unit/docs-policy.test.ts:33-38`, "Phase 3 is the first phase to collect on that promise: extending `ALL_IDS` and adding five `ENTRY_COMMANDS` rows was the entire change").

**Required edits, mechanically identical to the Phase 3 addition**:
1. Add `const PHASE_FOUR_IDS = ["RB-04-01"] as const;` (naming convention matches `PHASE_THREE_IDS` at `:79`).
2. Add it to `ALL_IDS` (`:82`): `[...PHASE_ONE_IDS, ...PHASE_TWO_IDS, ...PHASE_THREE_IDS, ...PHASE_FOUR_IDS]`.
3. Add an `"RB-04-01": [...]` entry to `ENTRY_COMMANDS` (`:245`) naming the exact command fragment(s) `RB-04-01` must contain verbatim in the runbook — per the RB-02-03/RB-03-xx lesson (`:254-267`), **pin whole one-line commands, not fragments**, when the command sits inside backticks on a single numbered-list line.
4. No change needed to `ID_RE`, `runbookEntryStatuses`, or the two parsing loops — the generalized `RB-\d{2}-\d{2}` pattern (`:91`) already covers a Phase 4 id, exactly as it already covered Phase 3 without modification.

**Nothing else in this file needs touching** — `ALL_IDS.length` guards (`:395`, `:425`) and the "every live check is still OUTSTANDING" loop (`:706`) all iterate `ALL_IDS`, so they inherit the new entry automatically once step 2 above lands.

---

### `tests/unit/shell-parse.test.ts`, `shell-deny-list.test.ts`, `path-policy.test.ts`, `infra-policy.test.ts` (new, pure-function table-driven unit tests)

**Analog:** `tests/unit/redact.test.ts` (pattern-table-plus-inline-fixture-liveness shape) and `tests/unit/prose-detector.test.ts` (positive/negative table over a pure predicate, "including the false positive that matters").

**The shape to copy** (inferred from `redact.ts`'s own docstring at `.pi/extensions/diagnostics/redact.ts:52-57` and the sibling `chokepoint-lint.test.ts`/`jsonl-append-only.test.ts` "prove every forbidden pattern is live against an inline fixture" idiom, `tests/unit/chokepoint-lint.test.ts:212-233`):
- a table of `{input, expectedVerdict, why}` fixtures, run through `describe.each`/a loop of `it()`s;
- at least one adversarial/evasion case per PITFALLS.md bypass row relevant to that file's scope;
- a "the predicate really can return the opposite answer" liveness check — `chokepoint-lint.test.ts:212-233`'s "proves every forbidden pattern is live against an inline offending fixture" is the exact discipline: a dead pattern and a clean tree produce byte-identical output, so each pattern must be proven to fire on *something*.

**For `shell-deny-list.test.ts` specifically**: RESEARCH's own verified negative cases are the fixture spine — `git $(echo push)`, the heredoc-to-script pattern, `nohup git push &`, `sh -c "git push"`, `bash -lc "git push"`, `env -i git push`, `git -C /c/other/repo push` — all confirmed to parse with `errors.length === 0` (`04-RESEARCH.md:327`), which is exactly what makes them the right adversarial cases for "assert these are DENIED even though `unbash` reports no parse error."

---

### `tests/unit/git-policy.test.ts` / `tests/integration/git-head-main.test.ts`

**Analog:** `tests/unit/bedrock-auth.test.ts` for the unit half (pure resolution logic, both directions, no session) and `tests/helpers/git.ts`'s own `run()`/`repoRoot()` pattern for the integration half (a real git repo, oracle-style, "ask git, don't reimplement it").

**Split rationale to copy**: `bedrock-auth.test.ts`'s own docstring pattern (cited from `.pi/extensions/providers/index.ts:179-186`) — resolve the *logic* (write-vs-read classification given a branch name and a parsed command) as a pure function tested with fixtures in `git-policy.test.ts`, and reserve `git-head-main.test.ts` for the one fact that genuinely needs a real repository: `git symbolic-ref --short HEAD` against an actual checkout, mirroring how `tests/helpers/git.ts`'s `run()` (`tests/helpers/git.ts:42-53`) spawns real git with `shell:false`.

**Allow-case fixtures required, not optional** — Pitfall 5 (`04-RESEARCH.md:506-511`): `git worktree add -b feat main`, `git fetch origin main`, `git rebase main` (read-preview form), `git diff main`, `git log origin/main` must all appear as **allow** fixtures, not merely be absent from a deny list — "this must be a named allow-case… not merely absent."

---

### `tests/integration/double-enforcement.test.ts` (SAFE-09)

**Analog:** `tests/integration/prose-retry.test.ts` — a live in-memory session (via `withFauxSession`/`createFauxSession` from `tests/helpers/session.ts`) that proves a hook's *effect*, not just its predicate, including an exact call-count assertion.

**Specific mechanism to compose**: `withFauxSession({ extensionPath: ..., tools: [...] })` from `tests/helpers/session.ts:220-336`, with the extension under test loaded via `writeUserScopeShim` (already how every user-scope-loading test in this repo works, per that file's own note 3 in its docstring, `tests/helpers/session.ts:32-35`: "the extension under test must load at USER scope… project-scoped `.pi/extensions` is gated behind project trust"). The test needs to simulate a **later-registered handler mutating `event.input` after the safety hook approved it** — this is a novel scenario with no exact in-repo precedent, but the faux-session machinery (register two extensions, or two `pi.on("tool_call", …)` handlers in one test extension, second one mutating the event) is the right tool, following the "register the extension under test, script a tool call via `faux.setResponses([fauxToolCall(...)])`, assert on what actually executed" shape `tests/helpers/faux.ts` and `tests/helpers/session.ts` jointly support.

---

### `tests/integration/headless-deny.test.ts` (SAFE-10) / `tests/integration/user-scope-load.test.ts` (SAFE-11)

**Analog:** `tests/integration/load-paths.test.ts` — exact structural match for both. Case 4 in that file (`load-paths.test.ts:179-204`, "the same run WITHOUT `-a` must not see the sentinel," paired with a positive control) is the precise shape `headless-deny.test.ts` needs: run `pi --mode json` (or `-p`) against a scripted blocked command and assert the deny happens with **no UI bound at all**, paired against a control run proving the harness would otherwise allow it.

**Mechanism to reuse directly**: `requirePiOnPath()` (throws, never skips — `tests/helpers/pi.ts:83-110`) and `runPi()` (`tests/helpers/pi.ts:118-140`), plus `PI_CODING_AGENT_DIR` redirection (`load-paths.test.ts:97-102`'s `freshAgentEnv()`) for a throwaway agent directory — exactly what `user-scope-load.test.ts` needs to prove SAFE-11 without touching the developer's real `~/.pi/agent`.

**The `--mode json`/`noOpUIContext` assertion itself has no in-repo precedent** (no test currently exercises `--mode json` specifically) — RESEARCH Pattern 4 (`04-RESEARCH.md:387-412`) is the citation for *why* this must be a real subprocess run under `--mode json` rather than a unit test asserting `ctx.hasUI === false`: the object-identity check (`runner.js:274-276`) is a real Pi mechanism, not a string-mode branch, so only an actual `--mode json` invocation proves it.

---

### `tests/integration/subagent-block.test.ts` (SAFE-12)

**Analog:** `tests/integration/load-paths.test.ts` (real spawned `pi` subprocess) composed with `tests/helpers/loopback.ts` (`withLoopbackCompletions`, a scripted local OpenAI-compatible HTTP server) — RESEARCH's Open Question 2 names this exact composition as **not yet done anywhere in this repo** (`04-RESEARCH.md:642`), making this the single most novel test file in the phase.

**What to reuse verbatim**: `withLoopbackCompletions`'s `respond` override (`tests/helpers/loopback.ts:126-134`) to script a canned tool-call response on the first turn, `runPi()`/`requirePiOnPath()` for the spawned subprocess, and a `models.json` pointed at the loopback `baseUrl` via `tests/helpers/models.ts`'s `withModelsConfig()` (or a bespoke temp `models.json`, since `withModelsConfig` builds a `ModelRegistry` in-process rather than spawning `pi` — check whether `subagent-block.test.ts` needs the in-process registry helper at all, or only needs a temp `models.json` file on disk for the spawned `pi` process to read). **Fallback per RESEARCH's own recommendation** (`04-RESEARCH.md:643`): if the full composition proves too fragile, split into a load-half proof (reuse `user-scope-load.test.ts`'s mechanism) and a policy-half proof at the `fauxProvider`/session layer (reuse `double-enforcement.test.ts`'s mechanism), explicitly noting in the plan that full `pi-subagents`-mediated verification is deferred to Phase 7.

---

### `tests/unit/audit-jsonl.test.ts` / `tests/integration/audit-concurrency.test.ts` (SAFE-14)

**Analog:** `tests/unit/jsonl-rotation.test.ts` and `tests/integration/jsonl-concurrency.test.ts` — near-exact structural match, since `safety/audit.ts` is a thin binding over the same extracted `.pi/lib/jsonl.ts` writer.

**Reuse the same helpers**: `tests/helpers/logs.ts`'s `withTempLogCwd`, `logFilesIn`, `readJsonl` (strict, for a file the test itself wrote), `readTornSafe` (tolerant, for the concurrent-write proof — "a torn record is a measurement, not an exception," `tests/helpers/logs.ts:114-120`). `tests/integration/jsonl-concurrency.test.ts:48-56` spawns real child processes (`node:child_process.spawn`) each independently appending — that is the shape `audit-concurrency.test.ts` needs, four processes standing in for "main session + subagents all writing the same audit file," which is precisely the scenario RESEARCH's own diagram calls out (`04-RESEARCH.md:236-241`).

**The one new assertion beyond the diagnostics precedent**: SAFE-14 requires **allow rows, not just block rows** (RESEARCH's specifics section: "A log of blocks alone cannot answer 'was the guard even loaded?'"). `jsonl-rotation.test.ts`/`jsonl-concurrency.test.ts` have no equivalent "two different row kinds, assert both appear" requirement — this is a genuinely new assertion to add, not purely inherited from the analog.

---

### `tests/unit/evasion-corpus.test.ts` (SAFE-17 / SAFE-15)

**Analog:** `tests/unit/redact.test.ts`'s fixture-table shape, generalized to ≥30 rows, each tagged `blocked` or `out-of-scope` (never a third bucket) — the CONTEXT.md specifics section is explicit that this is "one artifact, not two" serving both SAFE-17's corpus and SAFE-15's published table.

**Corpus spine, already written**: `.planning/research/PITFALLS.md:452-468`'s 14-row bypass table, expanded per-class (three quoting variants, three nesting depths, both Git Bash and Windows path forms) per CONTEXT.md's specifics section. Every row must exercise the real `shell.ts`/`policy.ts` pipeline built earlier in the phase, not a re-derived mini-parser — this test is the integration point that proves the earlier unit tests compose correctly across the whole guarded-verb list.

---

### SAFE-01 offline proxy (new integration test — local bare repo + `pre-receive` hook)

**Analog:** `tests/helpers/git.ts` for "spawn real git, never parse its output by hand" and `tests/helpers/stub-bin.ts`'s temp-directory-with-cleanup shape for constructing a disposable git repository.

**No existing test in this repo drives a real git server-side hook** — this is new composition. The pattern to follow: `mkdtempSync` a bare repo (`git init --bare`), write a POSIX `sh` `pre-receive` hook (LF endings, matching CLAUDE.md's `.gitattributes` convention and `tests/unit/lf-and-shell.test.ts`'s enforcement of it) that rejects a push naming the protected branch pattern, then attempt a push via `spawnSync("git", ["push", ...])` mirroring `tests/helpers/git.ts:42-53`'s `run()` shape (`shell:false`, `encoding:"utf-8"`, `windowsHide:true`) and assert the push fails with the hook's own rejection text on stderr. Clean up via `rmSync(..., {recursive:true, force:true, maxRetries:3})`, the Windows-handle-lingering convention already used throughout `tests/helpers/{session,logs,models}.ts`.

## Shared Patterns

### Failure containment (`safeHandler`-style wrapping)
**Source:** `.pi/extensions/diagnostics/index.ts:379-430` (`safeHandler`), reused by `.pi/extensions/providers/index.ts:101,229-231`.
**Apply to:** `safety/index.ts`'s `tool_call` hook and wrapped-tool `execute()` bodies — **but confirm against CONTEXT.md decision 7 first** (see the `safety/index.ts` section above) whether importing `safeHandler` from `diagnostics/` is acceptable, or whether `safety/` needs its own minimal equivalent for full import-direction independence.
```typescript
export function safeHandler<E, R = undefined>(
	where: string,
	fn: (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>,
): (event: E, ctx: ExtensionContext) => Promise<R | undefined> {
	return async (event: E, ctx: ExtensionContext): Promise<R | undefined> => {
		try {
			const result = await fn(event, ctx);
			return (result ?? undefined) as R | undefined;
		} catch (err) {
			try { /* write an audit/turns row with DIAGNOSTICS_ERROR_EVENT-equivalent */ }
			catch { /* the instrument cannot instrument its own inability to write */ }
			return undefined;
		}
	};
}
```
Pi swallows every exception an extension handler throws (`dist/core/extensions/runner.js:861-870`) — without this wrapper, a bug in the safety guard fails silently open in exactly the way CONTEXT.md decision 4 forbids.

### Append-only, rotating, dated JSONL logs
**Source:** `.pi/extensions/diagnostics/jsonl.ts` (to be extracted into `.pi/lib/jsonl.ts`).
**Apply to:** `safety/audit.ts`, per the Don't-Hand-Roll table row and CONTEXT.md decision 7's reuse requirement.
```typescript
export function appendJsonl(cwd: string, base: string, record: unknown, opts: AppendOptions = {}): string {
	const now = opts.now ?? new Date();
	const file = logPath(cwd, base, now);
	// rotate-before-write-if-would-exceed-cap, appendFileSync only, never a stream
	appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
	return file;
}
```
**Never introduce a stream here** — `.pi/extensions/diagnostics/jsonl.ts:26-37`'s rule (open-write-close per record is what makes rename-based rotation safe under concurrent subagent writers) applies identically to the extracted module.

### Windows subprocess quoting
**Source:** `tests/helpers/win-quote.ts` (`quoteForWindows`, `commandFor`) — the single shared implementation after four hand-rolled, two-of-four-wrong copies were consolidated.
**Apply to:** any new test that spawns `git`, `pi`, or `npm` as a subprocess (SAFE-01's offline proxy, `headless-deny.test.ts`, `user-scope-load.test.ts`, `subagent-block.test.ts`). Never re-derive quoting logic; import `quoteForWindows`/`commandFor` from `tests/helpers/win-quote.ts`.

### Real subprocess, never skip
**Source:** `tests/helpers/pi.ts:83-110` (`requirePiOnPath`), restated in `tests/helpers/session.ts:44-51` and `tests/helpers/models.ts:70-77`.
**Apply to:** every new integration test in this phase. "There is deliberately no skip escape hatch anywhere in this file, and an auditor grepping for one should find nothing — a helper that removes itself when a prerequisite is missing turns CI green having verified nothing." Throw with the exact remedy command in the message; never `it.skip`.

### Vacuous-pass guards on every scanning test
**Source:** `tests/unit/chokepoint-lint.test.ts:172-188`, `tests/unit/extension-layout.test.ts:147-162`, `tests/unit/contributing-boundary.test.ts:114-120`.
**Apply to:** any new test in this phase that scans a file set (e.g., a hypothetical extension of `jsonl-append-only.test.ts`'s scanned tree, or a new grep-based gate over `safety/`). Always assert the scanned set is non-empty **before** asserting the negative property over it, and always prove every pattern fires against an inline offending fixture.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `.pi/extensions/safety/approvals.ts` | store | CRUD | No in-repo module keeps a keyed, TTL'd, one-shot-consumable state store. RESEARCH.md Pattern 3 (citing the read-but-not-installed reference guard's `approvals.ts`) is the pattern to steal instead of a codebase file. |
| `tests/integration/git-head-main.test.ts` | test | CRUD (real git repo under test) | No existing test drives a real, mutable git checkout as its subject (existing tests only ask git *about* this repo via `tests/helpers/git.ts`'s read-only oracle functions). New composition of `tests/helpers/git.ts`'s spawn pattern against a disposable repo. |
| `tests/integration/subagent-block.test.ts` | test | request-response (spawned subprocess + loopback provider) | RESEARCH's own Open Question 2 states this exact composition (`runPi()` + `withLoopbackCompletions`) "has not been done anywhere in this repo yet." Compose from two proven-separately helpers rather than looking for a single analog. |
| SAFE-01 offline proxy test (bare repo + `pre-receive` hook) | test | file-I/O (real git server-side hook) | No existing test writes and exercises a git hook. Compose from `tests/helpers/git.ts`'s spawn discipline and `tests/helpers/stub-bin.ts`'s disposable-directory-with-cleanup shape. |
| The `approve_ky_command` tool's typebox parameter schema | (part of `safety/index.ts`) | — | No `registerTool` call exists anywhere in this codebase yet — this phase's tools are the first. Follow CLAUDE.md's `StringEnum` guidance and RESEARCH.md's Code Example (`04-RESEARCH.md:593-611`) rather than an in-repo tool-schema file. |

## Metadata

**Analog search scope:** `.pi/extensions/{diagnostics,providers,harness}/**`, `tests/unit/**`, `tests/integration/**`, `tests/helpers/**`, `docs/{RUNBOOK,DIAGNOSTICS}.md`, `bin/bootstrap.sh`, `package.json`, `CONTRIBUTING.md`, `.gitignore`.
**Files scanned:** 9 extension source files (full read), 2 CONTEXT/RESEARCH docs (full read), 2 docs (RUNBOOK.md full, DIAGNOSTICS.md referenced via docs-policy.test.ts's own extraction), 1 install script (full read), 9 test files (full read: chokepoint-lint, extension-layout, docs-policy, pinning, ci-pinning, gh-unauthenticated, load-paths, contributing-boundary, jsonl-append-only excerpt), 9 test helpers (full read: git, stub-bin, win-quote, pi, session, faux, logs, loopback, models).
**Pattern extraction date:** 2026-08-14
