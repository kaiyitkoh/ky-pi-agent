# Phase 6: Walking Skeleton — `/quick` & the Evidence Gate - Pattern Map

**Mapped:** 2026-08-14
**Files analyzed:** 6 new/modified (`workflows/index.ts`, `workflows/evidence.ts`, `safety/git.ts` addition, 3 test files)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `.pi/extensions/workflows/index.ts` (`/quick` command) | route/dispatch (command, not tool) | request-response | `.pi/extensions/harness/index.ts` (registration shape) + `.pi/extensions/routing/index.ts:632-666` (multi-command, `ctx.ui.notify` refusal) | role-match, exact shape |
| `.pi/extensions/workflows/evidence.ts` (GATE-07 predicate) | utility, pure predicate | transform | `.pi/extensions/routing/guard.ts:127,212-267` (`GuardVerdict`) and `.pi/extensions/safety/git.ts:186` (`GitVerdict`) | exact |
| Evidence record append path | utility, structured-record append | event-driven / file-I/O | `.pi/extensions/safety/audit.ts` (thin binding over `.pi/lib/jsonl.ts`) | exact |
| `currentSha(cwd)` in `.pi/extensions/safety/git.ts` | utility, spawnSync git-read | request-response | `currentBranch(cwd)`, same file, lines 144-158 | exact — copy verbatim, change args |
| `tests/unit/workflow-budgets.test.ts` (FLOW-11) | test, registry-completeness | batch/policy | `tests/unit/extension-layout.test.ts` (disk-vs-declared-set completeness) | exact pattern, no line-counting precedent |
| `tests/unit/evidence-gate.test.ts` (GATE-07) | test, pure-predicate table | transform | `tests/unit/git-policy.test.ts` (table-driven, paired negative/positive) | exact |
| `tests/integration/quick-workflow.test.ts` (FLOW-01) | test, session-level | request-response | `tests/integration/mode-switch.test.ts` (invokes a registered command via `extensionRunner`) + `tests/integration/headless-deny.test.ts` (real safety enforcement) | exact |

## Pattern Assignments

### `.pi/extensions/workflows/index.ts` — command registration

**Analog A — minimal shape:** `.pi/extensions/harness/index.ts:68-98`
```typescript
export default function (pi: ExtensionAPI): void {
	// A command, not a tool. Zero per-turn tokens. See BOUNDARY RULE above.
	pi.registerCommand("ky-hello", {
		description: "ky-pi-agent liveness check",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`ky-pi-agent loaded (sentinel: ${SELFTEST_MODEL_ID})`, "info");
		},
	});
```

**Analog B — refusal + argument parsing:** `.pi/extensions/routing/index.ts:646-659`
```typescript
pi.registerCommand("escalate", {
	description: "Lift the executor ...",
	handler: async (args, ctx) => {
		const arg = args.trim();
		if (arg !== "" && arg !== "on" && arg !== "off") {
			ctx.ui.notify(
				`escalate: unrecognized argument ${JSON.stringify(arg)} -- accepted forms are: ...`,
				"error",
			);
			return;
		}
		await applyEscalate(pi, ctx, arg !== "off");
	},
});
```

**House style for refusal surfacing:** `ctx.ui.notify(msg, "error")` + `return` — never thrown, never a rejected promise. `/quick` should follow this: a `PlanResult`/`GuardVerdict`/evidence-gate rejection is reported via `ctx.ui.notify(reason, "error")`, and the verbatim `reason` string from the real function (never retyped) per CONTEXT.md's wire-proof discipline.

**CRITICAL FINDING for FLOW-01's line budget:** every existing entry point in this repo carries a long `/** ... */` file-header docstring **that counts toward its own line total** — `harness/index.ts` is 98 lines total, of which the header (lines 1-47) is 47 lines and the actual `export default function` body (lines 68-98) is only ~31 lines. `routing/index.ts` is 680 lines; `diagnostics/index.ts` is 696; `safety/index.ts` is 839. **If FLOW-01's ≤80-line count includes the header in the house style used everywhere else in this repo, there is effectively zero budget left for code** — a docstring half as thorough as `harness/index.ts`'s own already consumes more than half the budget. This is the single most concrete risk RESEARCH.md's Q2 flags but does not quantify. The plan must explicitly decide: either `/quick`'s header is deliberately terse (a few lines, breaking house style — and that break should be stated as a conscious exception, not silent), or the registry's line-count function should exclude header comments (which RESEARCH.md's Q2 recommends against — "raw lines... is what the ROADMAP's '≤80 lines' plainly means"). Do not let this be discovered at review time.

**Line counts of every `.pi/extensions/*.ts` file, for calibration (wc -l):**

| File | Lines |
|---|---|
| `harness/index.ts` | 98 |
| `safety/schema.ts` | 78 |
| `safety/audit.ts` | 132 |
| `diagnostics/jsonl.ts` | 139 |
| `providers/sso.ts` | 173 |
| `qoder/index.ts` | 312 |
| `providers/fallback.ts` | 303 |
| `providers/index.ts` | 328 |
| `routing/schema.ts` | 336 |
| `diagnostics/prose.ts` | 204 |
| `diagnostics/turns.ts` | 302 |
| `routing/guard.ts` | 268 |
| `diagnostics/schema.ts` | 357 |
| `diagnostics/redact.ts` | 356 |
| `safety/infra.ts` | 430 |
| `safety/approvals.ts` | 410 |
| `diagnostics/wire.ts` | 401 |
| `routing/modes.ts` | 447 |
| `safety/git.ts` | 447 |
| `routing/agent-overrides.ts` | 488 |
| `diagnostics/call-model.ts` | 496 |
| `safety/paths.ts` | 584 |
| `safety/policy.ts` | 657 |
| `routing/index.ts` | 680 |
| `diagnostics/index.ts` | 696 |
| `diagnostics/budget.ts` | 702 |
| `safety/shell.ts` | 779 |
| `qoder/client.ts` | 825 |
| `safety/index.ts` | 839 |

**The smallest file in the whole tree is `safety/schema.ts` at 78 lines** — a pure constants/type file with almost no docstring. No existing entry-point (default-export) file in this repo is anywhere near 80 lines; `harness/index.ts` at 98 is the smallest entry point and it is already over the FLOW-01 target. **This is direct empirical evidence that the house style, applied unmodified, cannot fit ≤80 lines** — the plan must budget the header deliberately short for this one file.

### `.pi/extensions/workflows/evidence.ts` — pure predicate (GATE-07)

**Analog — verdict shape:** `.pi/extensions/routing/guard.ts:127`
```typescript
export type GuardVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };
```
and `.pi/extensions/safety/git.ts:186`
```typescript
export type GitVerdict = { readonly kind: "allow" } | { readonly kind: "block"; readonly reason: string };
```
**House style is split**: `routing/` uses `{ok:true}|{ok:false,reason}`; `safety/`/`paths.ts` use `{kind:"allow"}|{kind:"block",reason}`. RESEARCH.md's Q1 already cites both as the exact existing exports `/quick` composes (`PlanResult` is `ok:true/false`; `GitVerdict`/`ShellVerdict`/`PathVerdict` are `kind:allow/block`). Since GATE-07 is new and does not extend either subsystem, either is defensible — recommend `{ok:true}|{ok:false,reason}` to match `GuardVerdict`/`PlanResult`, since GATE-07 sits closer to routing's "verdict about a claim" semantics than to safety's "verdict about a command."

**Signature shape to follow** (pure, no I/O, unit-testable with plain fixtures — `guard.ts:212` `guardRoute(model, role, need): GuardVerdict`): a function taking `{evidence: ToolResultRecord[] | undefined, claimSha: string, headSha: string}` and returning the verdict, with the three rejection branches (no matching record / stale SHA / `isError`) and one acceptance branch, exactly mirroring `classifyGitInvocation`'s first-match-wins structure (`git.ts:310+`).

### Structured-record append (evidence capture path)

**Analog — thin binding over `.pi/lib/jsonl.ts`:** `.pi/extensions/safety/audit.ts:39-40,82-110`
```typescript
import { appendJsonl, pruneLogs } from "../../lib/jsonl.ts";
import { AUDIT_LOG_BASE, AUDIT_ROTATE_BYTES, type AuditRow, type AuditVerdict } from "./schema.ts";
...
export function writeAuditRow(cwd: string, input: AuditRowInput, opts: WriteAuditRowOptions = {}): string | undefined {
	const row: AuditRow = { ts: input.ts ?? Date.now(), event: input.event, /* ...named fields, never spread... */ };
	try {
		return appendJsonl(cwd, AUDIT_LOG_BASE, row, { rotateBytes: opts.rotateBytes ?? AUDIT_ROTATE_BYTES, now: opts.now });
	} catch {
		return undefined; // never rethrow — see module docstring
	}
}
```
**Copy this exactly** for the evidence-record writer: bind `.pi/lib/jsonl.ts`'s `appendJsonl`/`pruneLogs` directly (not through `diagnostics/jsonl.ts` or `safety/audit.ts`'s own binding — CONTEXT.md decision 8 keeps subsystems import-free of each other; `workflows/` gets its own thin binding, its own owned base name e.g. `"evidence"`, and its own `ownedBases` list for `pruneLogs`, same "ownership, not shape" rule `diagnostics/jsonl.ts:76-85` documents). Base name must match `BASE_RE` (`^[A-Za-z0-9][A-Za-z0-9_-]*$`, RESEARCH.md Q1) — `"evidence"` is valid. Logs land in the gitignored `.pi/logs/` (confirmed by `diagnostics/jsonl.ts` and `safety/audit.ts` docstrings — never grepped separately, both cite the same `.pi/lib/jsonl.ts` mechanism).

### `currentSha(cwd)` — new export in `.pi/extensions/safety/git.ts`

**Analog — copy verbatim, change the argv:** `.pi/extensions/safety/git.ts:144-158`
```typescript
export function currentBranch(cwd: string): string {
	const result = spawnSync("git", ["symbolic-ref", "--short", "HEAD"], {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`git symbolic-ref --short HEAD failed to launch in "${cwd}": ${result.error.message}`);
	}
	if (result.status === 0) {
		return (result.stdout ?? "").trim();
	}
	return DETACHED_HEAD;
}
```
`currentSha(cwd)` should be `spawnSync("git", ["rev-parse", "HEAD"], {...same options...})`, same error-throw-on-launch-failure, but note: unlike `currentBranch`, there is no natural "detached" sentinel for a SHA read failure — a non-zero exit (no repo, no commits yet) should probably `throw`, not return a sentinel, since GATE-07 has no safe default for "current SHA is unknown" (an unknown SHA can never legitimately match evidence). State this choice explicitly in the plan rather than silently copying the sentinel pattern. **No SHA reader exists anywhere in this repo today** (confirmed by RESEARCH.md Q1/Q3 and by re-grep here) — this is new production code, not a wrapper around an existing helper.

### `tests/unit/workflow-budgets.test.ts` — FLOW-11, registry completeness

**Analog — disk-vs-declared-set completeness, both directions:** `tests/unit/extension-layout.test.ts:135-213`
```typescript
const sources = trackedFiles(EXT_DIR).filter((p) => p.endsWith(".ts")).sort();
...
it("has every entry point at an auto-discovered path", () => {
	const offenders = entryPoints.filter((p) => !FLAT.test(p) && !NESTED_INDEX.test(p));
	expect(offenders, "...").toEqual([]);
});
```
This is the exact shape FLOW-11 needs: build the on-disk/tracked set (`trackedFiles(...)` from `tests/helpers/git.ts`, filtered to workflow files by naming convention), compare against the registry's declared keys, and assert equality in **both directions** — registry entries missing from disk, and disk files missing from the registry (CONTEXT.md decision 5(c)). **No file in this repo counts lines of a `.ts` file today** (RESEARCH.md SEAM RISK 3, confirmed) — the counting function itself (`readFileSync(path,"utf-8").split("\n").length`) is new, small, self-contained; only the completeness-check *shape* has a direct analog. Use `repoRoot()`/`trackedFiles()` from `tests/helpers/git.ts` exactly as `extension-layout.test.ts:51` does — do not re-implement path resolution.

**Vacuous-pass guard, house convention (present in every one of `extension-layout.test.ts`, `chokepoint-lint.test.ts`, `git-policy.test.ts`):** assert the scanned set is non-empty *before* asserting properties over it (`extension-layout.test.ts:147-162`) — a budget test over an empty registry would pass having checked nothing.

### `tests/unit/evidence-gate.test.ts` — GATE-07 pure-predicate table

**Analog — table-driven, paired positive/negative, no vacuous pass:** `tests/unit/git-policy.test.ts:1-23,37-48`
```typescript
interface Row {
	readonly command: string;
	readonly rest: string;
	readonly kind: "git" | "glab";
	// ...expected verdict, why
}
```
Pattern to copy: one `Row` interface (`{name, evidence, claimSha, headSha, expected: "accept"|"reject", why}`), a flat array covering the four GATE-07 scenarios from RESEARCH.md Q4 (fabricated/no-record, stale-SHA, non-zero-exit, and the one acceptance), asserted with `for (const row of rows) it(row.name, ...)`, table non-emptiness asserted first. **Every rejection must assert on the reason string**, not merely `ok === false` — `capability-guard.test.ts`'s docstring states this explicitly ("never merely on `ok === false`") and is the binding house convention; a predicate that always returns the same hardcoded reason would still pass a bare boolean check.

For the stale-SHA case specifically, use a **real temp git repo** (`tests/helpers/git.ts` pattern — `repoRoot()`/`trackedFiles()` are read-only helpers today; RESEARCH.md's Q4 says this file needs extending with a **commit-producing** helper, since neither `tests/helpers/git.ts` nor any other helper currently creates commits or reads a SHA). This is new helper code, not a copy of existing helper code — model it on `bootstrap-repo.ts` if that file already scaffolds a temp repo (check before writing new scaffolding).

### `tests/integration/quick-workflow.test.ts` — FLOW-01 session-level

**Analog A — invoking a registered command against a live session:** `tests/integration/mode-switch.test.ts:300-333`
```typescript
const command = session.extensionRunner.getCommand("balanced");
expect(command, 'getCommand("balanced") returned undefined').toBeDefined();
if (command === undefined) return;

const ctx = session.extensionRunner.createCommandContext();
const before = ctx.model;
await command.handler("", ctx);
```
This is the load-bearing mechanism for driving `/quick` in a test: `session.extensionRunner.getCommand("quick")` then `session.extensionRunner.createCommandContext()` then `await command.handler(args, ctx)`. `createCommandContext()` is available immediately after `createAgentSession()` returns (no warm-up prompt needed) — confirmed at `mode-switch.test.ts:59-66`. Build the session via `tests/helpers/session.ts`'s `withFauxSession`/`createFauxSession`, loading `/quick` at **USER scope** via `extensionPath`/`writeUserScopeShim` (`session.ts:192-213`) — project-scoped `.pi/extensions` is gated behind project trust and resolves `false` headless (RESEARCH.md Q1, `session.ts:32-35`).

**Analog B — real safety enforcement, real subprocess, when faux-in-process cannot prove it:** `tests/integration/headless-deny.test.ts:1-90` — if the guard-refusal assertion needs `noOpUIContext` to be genuinely bound (not just asserted about), this file's pattern (a real spawned `pi --mode json` subprocess, driven via a driver extension that calls `pi.registerProvider(faux.provider)` inside the child process itself, via `tests/helpers/pi.ts`'s `runPi()`) is the fallback RESEARCH.md Q4 pre-authorizes if the in-process faux session proves insufficient — same fallback Phase 4 itself took. Try the in-process `withFauxSession` route first; only fall back to a spawned `pi` if it cannot observe what's needed.

**`tests/integration/` files actually present (30 total)**, most relevant beyond the two above: `mode-persistence.test.ts`, `single-shot-roles.test.ts`, `escalate.test.ts`, `double-enforcement.test.ts`, `confirm-approve-reissue.test.ts`, `gitlab-push-protection.test.ts` — all candidates for secondary reference if the routing/guard composition needs more than `mode-switch.test.ts` alone shows.

**Helper functions confirmed present and their real signatures:**
- `tests/helpers/git.ts`: `repoRoot(): string`, `isIgnored(path: string): boolean`, `trackedFiles(pattern = "."): string[]`. **No commit-producing or SHA-reading helper exists** — must be added if GATE-07's stale-SHA test needs one beyond what `bootstrap-repo.ts` already offers.
- `tests/helpers/session.ts`: `createFauxSession(opts: FauxSessionOptions): Promise<FauxSessionHandle>`, `withFauxSession(opts, fn): Promise<T>`, `writeUserScopeShim(agentDir, name, targetAbsPath): string`. `FauxSessionOptions` includes `extensionPath`/`extensionSource`, `cwdFiles`, `tools`, `responses`, `models`, `providerId`.
- `tests/setup/agent-dir.ts`: vitest `setupFiles` entry (`vitest.config.ts:24`) — sets `PI_CODING_AGENT_DIR` to a fresh temp dir at module scope before any test body runs. **No new test-isolation seam is needed**; every test file inherits this automatically.

## Shared Patterns

### Verdict shape (refusal-with-a-reason)
**Source:** `.pi/extensions/routing/guard.ts:127` (`GuardVerdict`) — recommended house style for GATE-07's new predicate.
**Apply to:** `workflows/evidence.ts`, and `/quick`'s own dispatch of `planRoleCall`'s `PlanResult`.
```typescript
export type GuardVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };
```

### Refusal surfacing in a command handler
**Source:** `.pi/extensions/routing/index.ts:646-659`
**Apply to:** `/quick`'s handler — `ctx.ui.notify(reason, "error"); return;`, never thrown, reason string read from the real verdict, never retyped as a literal.

### JSONL append, thin binding per subsystem
**Source:** `.pi/extensions/safety/audit.ts` (full file — 132 lines, smallest full example of the pattern)
**Apply to:** the evidence-record writer. Own base name, own `ownedBases` list for pruning, never throw on write failure, bind `.pi/lib/jsonl.ts` directly rather than importing another subsystem's binding.

### spawnSync git read, one-shot
**Source:** `.pi/extensions/safety/git.ts:144-158` (`currentBranch`)
**Apply to:** the new `currentSha(cwd)`. Same options object (`shell:false, windowsHide:true, encoding:"utf-8"`), same launch-failure throw; decide deliberately whether a non-zero exit throws or returns a sentinel (no existing sentinel fits a SHA).

### Registry completeness, both directions
**Source:** `tests/unit/extension-layout.test.ts:135-213`
**Apply to:** `tests/unit/workflow-budgets.test.ts` — declared-but-absent and present-but-undeclared must both fail the build.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Line-counting function itself (`split("\n").length` over a workflow file) | utility | transform | No file in this repo counts lines of TypeScript today; small enough to write directly per RESEARCH.md Q2's recommendation. |
| Commit-producing test-git-helper (if `bootstrap-repo.ts` doesn't already cover it) | test helper | file-I/O | `tests/helpers/git.ts` is read-only (ignore/tracking); check `bootstrap-repo.ts` before writing a new one. |

## Metadata

**Analog search scope:** `.pi/extensions/{harness,routing,safety,diagnostics}/`, `tests/unit/{extension-layout,git-policy,capability-guard,chokepoint-lint,pinning}.test.ts`, `tests/integration/{mode-switch,headless-deny}.test.ts`, `tests/helpers/{git,session}.ts`
**Files scanned:** 29 `.pi/extensions/*.ts` (full `wc -l`), 6 test files (partial/targeted reads), 2 test helpers (full reads)
**Pattern extraction date:** 2026-08-14
