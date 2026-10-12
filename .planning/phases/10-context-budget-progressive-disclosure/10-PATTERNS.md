# Phase 10: Context Budget & Progressive Disclosure - Pattern Map

**Mapped:** 2026-10-13
**Files analyzed:** 24 (12 new, 12 modified)
**Analogs found:** 23 / 24

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.pi/extensions/routing/profiles.ts` (new) | utility (pure table) | transform | `.pi/extensions/routing/modes.ts` / `schema.ts` | role-match |
| `.pi/extensions/routing/index.ts` (mod: flag + `session_start`) | extension entry | event-driven | `.pi/extensions/qoder/index.ts:135-147` (+ `plan-mode/index.ts:216,496`) | exact |
| `.pi/extensions/background-tasks/src/core/shell-policy.ts` (mod: gate on `bg_run`) | vendored hook | event-driven | self (`registerShellPolicyGuidance`, lines 160-176) | exact |
| `.pi/extensions/diagnostics/budget.ts` (mod: floor line, per-profile summary) | utility (pure) | transform | self (`computeBudget`, `estimateTokensFromChars`) | exact |
| `.pi/extensions/diagnostics/ctx-experiment.ts` (new) | utility (pure) | transform/batch | `.pi/extensions/quality/calibration.ts` + `diagnostics/prose.ts` | role-match |
| `scripts/ctx-experiment.sh` + aggregator (new) | script | batch | `bin/bootstrap.sh` (POSIX sh convention) | partial |
| `tests/helpers/harness-session.ts` (new) | test helper | request-response | `tests/helpers/session.ts` | exact |
| `tests/integration/tool-profiles.test.ts` (new) | test (faux) | event-driven | `tests/integration/qoder-tool.test.ts:180-225` | exact |
| `tests/integration/context-hook-tools.test.ts` (new) | test (faux) | event-driven | `tests/unit/comment-rules-delivery.test.ts` (`capturePrompt`) | role-match |
| `tests/integration/prompt-stability.test.ts` (new) | test (faux) | request-response | `tests/unit/comment-rules-delivery.test.ts:25-50` | exact |
| `tests/integration/context-floor.test.ts` (new) | test (faux) | transform | `tests/unit/budget-command.test.ts` + `budget-sections.test.ts` | role-match |
| `tests/unit/agents-md-budget.test.ts` (new) | test (unit) | file-I/O | `tests/unit/comment-rules-delivery.test.ts` (`readRepo`) | role-match |
| `tests/unit/context-hook-lint.test.ts`, `prompt-metadata-lint.test.ts` (new) | test (source lint) | file-I/O | `tests/unit/chokepoint-lint.test.ts` | exact |
| `tests/unit/ctx-experiment.test.ts` (new) | test (unit + faux) | transform | `tests/unit/quality-gates.test.ts` / calibration tests | role-match |
| `tests/unit/tool-count-baseline.test.ts` (mod) | test | file-I/O | self (`TOOL_COUNT_BASELINE`, lines 124-248) | exact |
| `tests/unit/contributing-boundary.test.ts` (mod, only if a tool changes) | test | file-I/O | self (`TOOL_REGISTRATION_ALLOWLIST`, line 257) | exact |
| `tests/unit/workflow-budgets.test.ts` (mod: routing, diagnostics ratchets) | test | file-I/O | self (entries at ~357, ~372) | exact |
| `tests/unit/docs-policy.test.ts` (mod: `PHASE_TEN_IDS`, pins) | test | file-I/O | self (lines ~160-190, ~516-533) | exact |
| `docs/RUNBOOK.md` (mod: RB-10-01..03) | docs | n/a | RB-09-03 entry (lines 1583-1597) | exact |
| `docs/EXTENSIONS.md` (mod: decisions, cost table) | docs | n/a | its own "Pi 1.x capabilities not adopted" section | exact |
| `tests/helpers/session.ts` (mod only if all-tools option added there) | test helper | n/a | self | exact |

## Pattern Assignments

### `.pi/extensions/routing/index.ts` (extension entry, event-driven)

**Analog:** `.pi/extensions/qoder/index.ts:135-147` (narrowing at `session_start`), `.pi/extensions/plan-mode/index.ts:216-221` (flag registration), `routing/index.ts:296-309` (existing handler to extend).

**Narrowing pattern** (qoder/index.ts:135-147): never in the factory (`get/setActiveTools` throw until the runtime binds), best-effort try/catch.
```typescript
pi.on("session_start", () => {
	try {
		if (!resolveQoderConfig(process.env).ok) {
			pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "qoder_delegate"));
		}
	} catch {
			// Swallowed deliberately; execute() still refuses.
	}
});
```

**Flag pattern** (plan-mode/index.ts:216-221):
```typescript
pi.registerFlag("plan", {
	description: "Start in plan mode (read-only exploration)",
	type: "boolean",
	default: false,
});
```
Use `type: "string"`, name `ky-profile`, default `implement`, read with `pi.getFlag("ky-profile")` inside the handler.

**Existing handler to extend, same file** (routing/index.ts:296-309): add the profile call to this `session_start` (or a sibling) and keep the try/catch.
```typescript
pi.on("session_start", (_event, ctx) => {
	try {
		restoreModeFromBranch(ctx.sessionManager.getBranch());
	} catch {
		// Swallowed deliberately.
	}
});
```
Import style (lines 5-16): type-only imports from `@earendil-works/pi-coding-agent`, relative imports with explicit `.ts`. File header says "registers commands only (never a tool...)": do not say the tool-registration substring in comments (Pitfall 8). Pitfall 5: when plan mode is restored enabled, union its managed set or skip narrowing. Apply the Pattern 1 intersection from RESEARCH (`getActiveTools().filter(allow.has)`), skip when profile is `full`.

### `.pi/extensions/routing/profiles.ts` (utility, transform)

**Analog:** `routing/modes.ts` and `routing/schema.ts` (pure tables and resolvers, named exports). Named exports only: a default export makes it an entry point (`extension-layout.test.ts` `isEntryPoint` = `DEFAULT_EXPORT.test(source)`). Shape: `PROFILE_TOOLS: Record<ProfileName, readonly string[]>`, `resolveProfile(flag: unknown)` that falls back to the default on unknown input (copy the `isModeName` validate-then-default idiom from `restoreModeFromBranch`, routing/index.ts:262-264), `applyProfile(active, profile)`. Membership table is in RESEARCH "Profile design".

### `background-tasks/src/core/shell-policy.ts` (vendored, event-driven)

**Analog:** self, lines 160-176 (read the section above 160 for the `applyShellPolicyGuidance` early-return pattern; it already has `return undefined` branches).
```typescript
export function createShellPolicyGuidanceHandler(policy: ResolvedShellPolicy) {
  return (event: BeforeAgentStartEvent): BeforeAgentStartEventResult | undefined =>
    applyShellPolicyGuidance(event, policy);
}
```
Add an early `return undefined` when `event.systemPromptOptions.selectedTools` lacks `bg_run`. This is a PROVENANCE deviation: record it in the vendored extension's PROVENANCE file (see `.pi/extensions/questionnaire.PROVENANCE.md` for entry shape) and note vendored files are exempt from the comment rules. Vendored file uses 2-space indent and single quotes, unlike the rest of the repo (tabs, double quotes).

### `.pi/extensions/diagnostics/budget.ts` (utility, transform)

**Analog:** self. Single estimator and formula to reuse (lines 86-88, 204-225):
```typescript
export function estimateTokensFromChars(chars: number): number {
	return Math.ceil(chars / 4);
}
...
size(tool.name.length + tool.description.length + JSON.stringify(tool.parameters ?? null).length)
```
Extend `computeBudget`/`BudgetReport` with a `floor` (systemPrompt + toolSchemas) field; keep the pure-function shape, exported string constants for labels (lines 19-79 pattern), and update `budget-command.test.ts` for the new line. Do not fork the estimator. `diagnostics/` may spell model-call names; other directories may not. Raise the `diagnostics` ratchet (currently 1930) with a `why`.

### `.pi/extensions/diagnostics/ctx-experiment.ts` (utility, transform/batch)

**Analog:** `.pi/extensions/quality/calibration.ts` (pure grader, `scoreCalibration(expected, findings): CalibrationResult`, lines 93+) and `diagnostics/prose.ts` (`isProseToolCall`). Reuse both, do not re-implement. Corpus: `SEEDED_DEFECTS` from `tests/fixtures/seeded-defects/index.ts:316` (each has `build(repo)` and `expected`). Header comment must not cite CTX-05 or RB-10-01 (comment-discipline). No default export. No model call. Pre-registered constants (`DEGRADE_POINTS`) next to `decide` per RESEARCH "Draft decision function".

### `tests/helpers/harness-session.ts` (test helper, request-response)

**Analog:** `tests/helpers/session.ts` (full file). Copy: temp `agentDir` + `cwd` via `mkdtempSync(join(tmpdir(), "kypi-..."))` (lines 247-248), faux model registration (lines 279-302), try/catch cleanup with `removeQuietly`, `withFauxSession`-style async wrapper (lines 346-356), "throw, never skip" wording discipline.

**Key divergence** (session.ts:304-313): omit the `tools` key so extension tools register, and call `bindExtensions({})`:
```typescript
const { session } = await createAgentSession({
	cwd, agentDir, model, modelRuntime,
	settingsManager: SettingsManager.inMemory({}, {}),
	sessionManager: SessionManager.inMemory(cwd),
	tools: opts.tools ?? [],   // <-- omit for the composed harness
});
```
Extension loading: inline user-scope source via `writeUserScopeSource` / `writeUserScopeShim` (lines 192-222; shim shape mirrors `bin/bootstrap.sh#install_safety_extension`). Compose by awaiting every entry point, derived from `trackedFiles(".pi/extensions")` filtered by `isEntryPoint` (`tests/unit/extension-layout.test.ts:95`, `tests/helpers/git.ts:100`); never hard-code the list. Copy real `AGENTS.md` into the temp cwd (never run cwd inside the repo: session.ts docstring note 4). Settings should disable `-builtin:mcp`, `-builtin:llama.cpp`, `-builtin:codemode`, `-builtin:tool-search` (RESEARCH Pattern 2 code). Session.ts header cites 0.84.1 and 12,725: update that stale text only in docs, not behaviour.

### `tests/integration/tool-profiles.test.ts` (faux, event-driven)

**Analog:** `tests/integration/qoder-tool.test.ts:180-225`. Pattern: fire `session_start` explicitly (headless does not), non-vacuity guard (assert tool present BEFORE asserting absence), then assert absence.
```typescript
// handle.session.extensionRunner.emit({ type: "session_start", reason: "startup" })
// or: await handle.session.bindExtensions({})
```
Assertions from RESEARCH T1/T2: one `role==="system"` message across two requests; `hasNonAdditiveToolChanges(ctxs[1].messages) === false`; completeness test over `session.getAllTools()`; plan-mode resume case; mutation check with a fixture table missing one tool. Capture the outgoing context in a response factory (faux never fires `onPayload`).

### `tests/integration/prompt-stability.test.ts`, `context-hook-tools.test.ts` (faux)

**Analog:** `tests/unit/comment-rules-delivery.test.ts:25-50` (`capturePrompt`):
```typescript
responses: [
	(context) => {
		prompt = transcriptView(context).systemPrompt;
		return fauxAssistantMessage("ok");
	},
],
```
`transcriptView` from `tests/helpers/faux.ts:104-114` returns `{ systemPrompt, tools, messages }`; use `context.messages.filter(m => m.role === "system").length`. Use one response factory per turn (three), advance `Date.now` (vi fake timers or stub) between prompts, never assert the cwd path. Include the volatile-section negative control as a second inline extension. `context-hook-tools` needs a positive control: `context_with_system` does strip; `context` does not.

### `tests/unit/context-hook-lint.test.ts`, `prompt-metadata-lint.test.ts` (source lint)

**Analog:** `tests/unit/chokepoint-lint.test.ts` (header lines 1-60; body follows the same shape). Copy: `EXT_DIR = ".pi/extensions"`, `trackedFiles` + `readFileSync(join(repoRoot(), p))`, three vacuity guards (scanned set non-empty, post-exemption set non-empty, every pattern fires on an inline offending fixture). Match raw source, comments included. For metadata lint, exclude `background-tasks/` internals only if justified and written beside the exclusion.

### `tests/unit/agents-md-budget.test.ts` (unit, file-I/O)

**Analog:** `tests/unit/comment-rules-delivery.test.ts:14-23`:
```typescript
function readRepo(rel: string): string {
	return readFileSync(join(repoRoot(), rel), "utf8").replace(/\r\n/g, "\n");
}
```
Import `estimateTokensFromChars` and `PROJECT_INSTRUCTIONS_WRAPPER_CHARS` from `diagnostics/budget.ts`, `COMMENT_RULES_TEXT` from `harness/comment-rules.ts`. Write the checker as a function taking content and budget, run it on the real file and on an over-budget temp fixture (must fail). Budgets: 450 / 500 / 210 tok per RESEARCH; each raise is an edit with a why.

### `tests/unit/tool-count-baseline.test.ts` (mod)

**Analog:** self. Rows live in `TOOL_COUNT_BASELINE` (line 124); drift detection via `extractRegisteredToolNames` (line 284). Runtime enumeration is the completeness source for safety-wrapped tools (the unit test cannot see them). Any tool change updates this and `TOOL_REGISTRATION_ALLOWLIST` (contributing-boundary.test.ts:257-262) in the same commit. Do not put unverified token numbers on npm rows.

### `tests/unit/workflow-budgets.test.ts` (mod)

**Analog:** self, entries at lines 355-380:
```typescript
{
	dir: ".pi/extensions/routing",
	budget: 1020,
	why: "WR-03 widened ... measured 1019 raw lines across 5 files 2026-10-13, rounded up to the next ten",
},
```
Append to `why` with the re-measure and round up to the next ten; never raise silently. Both `routing` (profiles.ts adds a file) and `diagnostics` (budget.ts, ctx-experiment.ts) need it.

### `tests/unit/docs-policy.test.ts` (mod) and `docs/RUNBOOK.md`

**Analog:** docs-policy lines 160-176 and 516-533.
```typescript
const PHASE_NINE_IDS = ["RB-09-01", "RB-09-02", "RB-09-03"] as const;
const ALL_IDS = [ ..., ...PHASE_NINE_IDS ] as const;
// pin map:
"RB-09-03": [
	"npx vitest run tests/unit/handoff-packet.test.ts --maxWorkers=2",
	'echo "RB-09-03 parent-token delta: <live>, packet <tokens>, $(date -u +%FT%TZ)" >> RB-09-03-RESULT.md',
],
```
Add `PHASE_TEN_IDS = ["RB-10-01","RB-10-02","RB-10-03"]`, append to `ALL_IDS`, add pin rows whose strings occur exactly once in the runbook. Runbook entry shape (RUNBOOK.md:1545-1547 table rows, 1583-1597 section): table row, `### RB-10-0N - ...` heading, `**Status:** OUTSTANDING`, "Why this cannot be done here", "Precondition" (RB-07-02 for 03), "Procedure, on the work laptop", "Offline baseline", "Expected output", "Offline proxy:" naming `tests/unit/...test.ts` paths. Use `<work-repo>` style placeholders; no account ids.

## Shared Patterns

### Faux session and session_start
**Source:** `tests/helpers/session.ts:241-337`, `tests/integration/qoder-tool.test.ts:180-225`. Apply to every faux test in this phase. Headless `createAgentSession` does not fire `session_start`; call `bindExtensions({})` or `extensionRunner.emit`. Always add a non-vacuity guard.

### Reading the outgoing prompt/tools
**Source:** `tests/helpers/faux.ts:104-114` (`transcriptView`). Never read `.systemPrompt` off the context directly (silently undefined in 1.x).

### One estimator
**Source:** `.pi/extensions/diagnostics/budget.ts:86-88`. Every size in tests and `/budget` goes through `estimateTokensFromChars`; record the formula beside each number; never mix `/budget` formula with wire estimate.

### Source-lint convention (self-tested greps)
**Source:** `tests/unit/chokepoint-lint.test.ts`. Apply to the two new lints. Three vacuity guards plus a fixture per pattern.

### Comment and naming gates on new files
**Source:** RESEARCH Pitfall 8. Say "the tool-registration call", never the literal registration substring, in comments outside the allowlist; no model-call method names outside `diagnostics/`; no phase/requirement/review IDs in code comments; named exports only unless the file is intentionally an entry point.

### Ratchets and baselines edited in the same change
`workflow-budgets.test.ts`, `tool-count-baseline.test.ts`, `contributing-boundary.test.ts`, `docs-policy.test.ts`. Each edit carries a visible `why`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `scripts/` launcher for the live experiment (POSIX sh loop + node aggregator) | script | batch | No existing trial-loop script; follow `bin/*.sh` POSIX sh and LF conventions (`lf-and-shell.test.ts`) and RESEARCH "CTX-05 design" for content. Verify the actual directory choice (`scripts/` vs `bin/`) against `lf-and-shell.test.ts` and `extension-layout` before creating |

## Metadata

**Analog search scope:** `.pi/extensions/{routing,diagnostics,qoder,plan-mode,quality,harness,background-tasks}`, `tests/{helpers,unit,integration,fixtures}`, `docs/RUNBOOK.md`.
**Files scanned:** about 25 read in whole or part (targeted reads; large test files read by section).
**Pattern extraction date:** 2026-10-13
