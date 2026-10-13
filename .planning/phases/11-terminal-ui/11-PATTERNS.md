# Phase 11: Terminal UI - Pattern Map

**Mapped:** 2026-10-13
**Files analyzed:** 17 (new or modified)
**Analogs found:** 15 / 17

Comment rules (root `AGENTS.md`) apply to every file below: WHY-only, no phase/requirement IDs, no history. `ui/` must not spell tool-registration, model-call or prompt-surface words even in prose (`chokepoint-lint`, `contributing-boundary` scan raw source).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.pi/extensions/ui/index.ts` | extension entry (thin wiring) | event-driven | `.pi/extensions/routing/index.ts` (events/session_start) + `.pi/extensions/plan-mode/index.ts` (setStatus) + `.pi/extensions/loop-police/index.ts` (entry shape) | role-match |
| `.pi/extensions/ui/statusline.ts` | utility (pure formatters) | transform | `.pi/extensions/safety/git.ts` / `.pi/extensions/quality/verdict.ts` (pure helper next to `index.ts`) | role-match |
| `.pi/extensions/ui/git-probe.ts` | utility (throttle, single-flight) | request-response (async exec) | `.pi/extensions/safety/git.ts` (git via injected exec) | partial |
| `.pi/themes/ky.json` | config (theme) | n/a | none in repo; `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json` | external-reference |
| `.pi/settings.json` (modify: add `"theme": "ky"`) | config | n/a | itself | exact |
| `tests/helpers/harness-session.ts` (modify: `uiContext?`, `mode?`) | test helper | request-response | itself, `beforeBind` option | exact |
| `tests/helpers/recording-ui.ts` | test helper | event-driven | `tests/helpers/faux.ts` (recorder style) | role-match |
| `tests/unit/ui-theme.test.ts` | test | transform | `tests/unit/prompt-metadata-lint.test.ts` (fixture negatives) | role-match |
| `tests/unit/ui-statusline.test.ts` | test | transform | `tests/unit/prompt-metadata-lint.test.ts` | role-match |
| `tests/unit/ui-prompt-surface-lint.test.ts` | test (source lint) | file-I/O | `tests/unit/prompt-metadata-lint.test.ts` | exact |
| `tests/integration/ui-chrome.test.ts` | test | event-driven | `tests/integration/prompt-stability.test.ts` | role-match |
| `tests/integration/ui-prompt-stability.test.ts` | test | event-driven | `tests/integration/prompt-stability.test.ts` | exact |
| `scripts/ui-wire-check.sh` + `scripts/ui-wire-check.mjs` | script | batch / file-I/O | `scripts/ctx-experiment.sh` + `ctx-experiment.mjs` | exact |
| `tests/unit/ui-wire-check.test.ts` (parser) | test | transform | `tests/unit/ctx-experiment.test.ts` | exact |
| `docs/UI.md` | docs | n/a | `docs/DIAGNOSTICS.md`, `docs/ROUTING.md` | role-match |
| `docs/RUNBOOK.md` (append Phase 11 section) | docs | n/a | Phase 10 section, lines 1604-1667 | exact |
| `.pi/themes/.gitkeep` | housekeeping | n/a | n/a | no analog (decide: leave) |

## Pattern Assignments

### `.pi/extensions/ui/index.ts` (extension entry, event-driven)

**Analogs:** `.pi/extensions/loop-police/index.ts` (entry convention), `.pi/extensions/routing/index.ts` (event subscription, session_start restore, swallow-errors), `.pi/extensions/plan-mode/index.ts` (statusline colouring).

**Entry-point rule:** `.pi/extensions/<dir>/index.ts` with a default export; helpers in the same dir have no default export (`extension-layout.test.ts` `isEntryPoint`). Per `docs/RUNBOOK`/AGENTS: no build step, `.ts` imports use the `.ts` extension (see `safety/index.ts`: `import { currentBranch } from "./git.ts";`).

**Imports pattern** (`safety/index.ts` lines 1-17 style):
```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { formatStatusline, parsePorcelain } from "./statusline.ts";
```
Do not import from `../routing/`; the routing file's rule is "signalling is an event, never an import". Subscribe to the string literal `"ky.routing.mode_changed"` (declared at `routing/schema.ts:123`, `export const ROUTING_EVENT = "ky.routing.mode_changed"`). Payload emitted at `routing/index.ts:105-109` and `:200`:
```typescript
pi.events.emit(ROUTING_EVENT, {
	mode,
	escalated: false,
	model: `${candidate.model.provider}/${candidate.model.id}`,
});
```

**session_start + never-throws pattern** (`routing/index.ts` lines 311-326):
```typescript
pi.on("session_start", (event, ctx) => {
	try {
		const branch = ctx.sessionManager.getBranch();
		restoreModeFromBranch(branch);
		...
	} catch {
		// Swallowed deliberately.
	}
});
```
Copy: wrap every handler body in try/catch (stale ctx after reload throws via `assertActive`); restore route from the latest `ky:mode` custom entry in `ctx.sessionManager.getBranch()`; set header only when `ctx.mode === "tui"`; bump a generation counter on `session_start`/`session_shutdown` and drop async git results from older generations.

**setStatus colouring pattern** (`plan-mode/index.ts` lines 226-230, vendored, read-only reference):
```typescript
ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
ctx.ui.setStatus("plan-mode", undefined);
```
Use one key `"ky-statusline"`; `undefined` clears. Guard with `ctx.hasUI`. No `before_agent_start` handler, no `registerTool`, no `setActiveTools`, no `systemPrompt`/`promptSnippet`/`promptGuidelines`.

**Note on test of session_start:** `routing/index.ts:251` comment says `session_start` does not fire in a headless `createAgentSession`; probe under `bindExtensions({ uiContext, mode: "tui" })` first (RESEARCH A2) and drive handlers directly with recorded events if it does not fire.

**Subagent count:** subscribe with `pi.events.on("subagent:async-started" | "subagent:async-complete" | "subagent:foreground-complete" | "subagent:child-status", ...)` and `pi.on("tool_execution_start"|"tool_execution_end")` filtered on `toolName === "subagent"`; every payload field optional, unknown shape yields no segment.

---

### `.pi/extensions/ui/statusline.ts` (utility, transform)

**Analog:** pure-helper-beside-entry layout used by `.pi/extensions/safety/{policy,paths,git}.ts` and `.pi/extensions/quality/{verdict,rules}.ts`. Keep it free of Pi imports so the unit test needs no session.

**Core pattern (from RESEARCH, code example):**
```typescript
export function parsePorcelain(stdout: string): number {
	return stdout.split("\n").filter((line) => line.trim() !== "").length;
}
```
`formatStatusline(state, fg)` takes `fg: (color, text) => string` as a parameter (so tests pass `(_c, s) => s`). Segments omitted when unknown; never repeats model id, cost, branch or context % (Pi renders them). Strip C0/C1/ESC from every externally derived string (agent names, file names) before formatting; only `fg` output may carry ANSI. Target under 40 visible columns.

---

### `.pi/extensions/ui/git-probe.ts` (utility, async request-response)

**Analog:** `.pi/extensions/safety/git.ts` (git through an oracle with explicit exit-code handling; its header documents the "ask git, do not reimplement" rule). Take an injected `exec` and clock so tests use a fake exec plus fake time.

**Core call** (RESEARCH, from `dist/core/extensions/loader.js:326`, `dist/core/exec.js`):
```typescript
const r = await pi.exec("git", ["--no-optional-locks", "status", "--porcelain"], { cwd: ctx.cwd, timeout: 5000 });
if (r.killed || r.code !== 0) state.changedFiles = undefined; // 128 = not a repo: stop probing until next session_start
else state.changedFiles = parsePorcelain(r.stdout);
```
Rules to encode: single-flight with one trailing re-run; interval `max(2s, 4x last duration)`; never awaited inside a turn-blocking handler; triggers `session_start`, `turn_end`, `tool_execution_end` for `edit|write|bash`; no timer. Fixed argv, `shell:false`.

---

### `.pi/themes/ky.json` (config)

**No in-repo analog** (`.pi/themes/` holds only `.gitkeep`). Reference: `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json` for `$schema` URL and structure; `theme-schema.json` in the same dir for the contract.
Rules: top-level `name: "ky"`, `appearance: "dark"`, hex `vars`, all 51 required `colors` tokens plus the 5 optional (`scrollbarTrack`, `scrollbarThumb`, `searchMatchBg`, `searchMatchText`, `thinkingMax`), no unknown keys. Do not name it `system`. Package manifest already lists `./.pi/themes`.

---

### `.pi/settings.json` (modify)

Current content (whole file):
```json
{
  "packages": [
    "npm:@narumitw/pi-lsp@0.49.9",
    "npm:pi-session-finder@0.5.6",
    "npm:pi-subagents@0.76.1",
    "npm:pi-web-access@0.38.0"
  ],
  "extensions": [
    "-builtin:mcp",
    "-builtin:llama.cpp",
    "-builtin:codemode",
    "-builtin:tool-search"
  ]
}
```
Add `"theme": "ky"` only. `extension-pins.test.ts` checks `packages[]` equality and absence of `agentScope`; do not touch `packages`. Do not add `showCacheMissNotices`.

---

### `tests/helpers/harness-session.ts` (modify)

Add two optional fields to `HarnessSessionOptions` (lines 56-81, same doc-comment style) and forward at line 234:
```typescript
/** Runs after the session exists and before extensions bind, e.g. to seed session entries. */
beforeBind?: (session: AgentSession) => void;
```
```typescript
opts.beforeBind?.(session);
await session.bindExtensions({});   // becomes { uiContext: opts.uiContext, mode: opts.mode } only when provided
```
Without a `uiContext`, Pi uses `noOpUIContext` and `ctx.hasUI` is false, so a UI test is vacuous. Keep default behaviour byte-identical for all other callers (pass `{}` when neither is set). `listEntryPoints()` (line 104) auto-includes the new `ui/index.ts`; `context-floor.test.ts` will then enumerate it (expect a zero-char, zero-tool row).

### `tests/helpers/recording-ui.ts` (test helper)

Plain-object `ExtensionUIContext` recorder (not a getter; `wrapUIPromptContext` spreads it). From RESEARCH:
```typescript
const calls: { key: string; text: string | undefined }[] = [];
const ui = {
	...noopMethods, // select/confirm/input/editor/custom -> undefined/false; notify; widgets
	theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s },
	setStatus: (key: string, text: string | undefined) => void calls.push({ key, text }),
} as unknown as ExtensionUIContext;
```
Also record `setHeader`, `setWidget`, `setTitle`.

---

### `tests/integration/ui-prompt-stability.test.ts` (test, event-driven)

**Analog:** `tests/integration/prompt-stability.test.ts` (copy structure wholesale).

**Imports + helpers** (lines 1-39): `fauxAssistantMessage`, `transcriptView` from `../helpers/faux.ts`, `createHarnessSession`, `instabilityReason(contexts)`.

**Capturing steps** (lines 46-58):
```typescript
function capturing(into: TranscriptContext[]): FauxResponseStep[] {
	const step: FauxResponseStep = (context) => {
		into.push(context);
		return fauxAssistantMessage("ok");
	};
	return [step, step, step];
}
```

**Volatile mutation loop** (lines 70-85): fake `Date` only, `vi.setSystemTime(Date.now() + WEEK_MS)`, `git checkout -q -b ky-volatile-branch-N`, `appendFileSync` tracked file, `session.prompt()`, collect `getSessionStats().tokens.total`. Extend with: pass recording `uiContext` + `mode: "tui"`, a routing event via `handle.session.extensionRunner`/`pi.events.emit("ky.routing.mode_changed", ...)`, model switch, subagent events, seeded `usage` entry via `beforeBind`.

**Assertions** (lines 88-109):
```typescript
expect(instabilityReason(contexts)).toBe("");
for (const ctx of contexts) {
	const prompt = transcriptView(ctx).systemPrompt;
	expect(prompt.length).toBeGreaterThan(0);
	expect(prompt).not.toContain("ky-volatile-branch");
	expect(prompt).not.toContain(TRACKED);
	expect(prompt).not.toMatch(/\$\d+\.\d{2}/);
}
```
Add BEFORE these: assert recorded `setStatus("ky-statusline", ...)` text DID change across turns (anti-vacuity). Keep the negative control (lines 98-113: inline `extraExtensionSource` writing `event.systemPromptOptions.sections.volatile = String(Date.now())`, expect `instabilityReason(...)` not empty). Faux reports zero cost; use token totals as the existing test does.

### `tests/integration/ui-chrome.test.ts` (test)

Same harness; cases: tui mode sets header + status; `hasUI` false / `mode: "rpc"|"print"|"json"` makes no header call and does not throw; subagent stub events (`subagent:async-started` then `subagent:async-complete`) move the count up and back to zero; malformed payloads ignored; non-git cwd hides the changed-files segment.

---

### `tests/unit/ui-prompt-surface-lint.test.ts` (test, source lint)

**Analog:** `tests/unit/prompt-metadata-lint.test.ts` (exact structure).

**Source enumeration** (lines 1-8, 69-74):
```typescript
import { repoRoot, trackedFiles } from "../helpers/git.ts";
const EXT_DIR = ".pi/extensions";
const sources = trackedFiles(EXT_DIR)
	.filter((p) => p.endsWith(".ts"))
	.sort()
	.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
```
**Patterns to copy:** `FORBIDDEN` table of `{ pattern, why }` (lines 9-18); vacuity guard test (`finds at least one ...`, lines 76-80) asserting the vendored set derived from `PROVENANCE.md` presence (dir-level `<dir>/PROVENANCE.md` or flat `<name>.PROVENANCE.md`) is non-empty; offender list `expect(offenders, "message").toEqual([])` (lines 83-89); inline-fixture test proving every pattern fires (lines 91-108); clean-fixture test (lines 110-122). Rules to enforce: no `ui.custom` in non-vendored tracked `.ts`; `.pi/extensions/ui/` contains none of `systemPrompt`, `promptSnippet`, `promptGuidelines`, `registerTool`, `setActiveTools`, `context_with_system`, `before_agent_start`. Note `trackedFiles` uses git, so the new files must be `git add`ed before this test sees them.

### `tests/unit/ui-theme.test.ts` and `tests/unit/ui-statusline.test.ts`

**Analog:** `prompt-metadata-lint.test.ts` fixture-negative style (each rule has an inline offending fixture that must fail). Theme test reads `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json` via `fs`, derives required/known token sets from it (expect 56/51 from the file, not literals), and checks `ky.json`: required present, no unknown keys at top/colors/export, `name` pattern, value legal (hex / `oklch(` / `okhsl(` / int 0-255 / `""` / resolves to a `vars` key), no `vars` cycles, and `.pi/settings.json` `theme === name`. Layer 2: real load through `DefaultResourceLoader` (confirm option names `additionalThemePaths`, `getThemes().diagnostics` at `dist/core/resource-loader.d.ts` first; fall back to structural-only and say so in SUMMARY).

---

### `scripts/ui-wire-check.sh` + `scripts/ui-wire-check.mjs` (script, batch)

**Analog:** `scripts/ctx-experiment.sh` (+ `ctx-experiment.mjs`, `ctx-experiment-core.ts`).

**Shell conventions** (ctx-experiment.sh lines 15-24):
```sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cli="$script_dir/ctx-experiment.mjs"

die() {
	printf '%s\n' "ctx-experiment: $*" >&2
	exit 1
}
```
Plus required-env validation with `die` (lines 26-27), the `native()` cygpath helper (lines 63-69) for Windows paths, and a thin `.sh` delegating logic to `node "$cli" <subcommand>`. Put parsing (system-prompt extraction from OpenAI-compatible `messages[0]` role system/developer and Bedrock `system[]`, hashing, volatile-probe grep, `cacheRead / (input + cacheRead)` for turns 2+) in testable code (the `.mjs` or a `.ts` core as `ctx-experiment-core.ts` does) and unit test it. Inputs: `.pi/logs/wire-<date>.jsonl` `main.request` records keyed by `corr`, `.pi/logs/turns-<date>.jsonl` (see `docs/DIAGNOSTICS.md`). POSIX `sh` only.

### `tests/unit/ui-wire-check.test.ts`

**Analog:** `tests/unit/ctx-experiment.test.ts` and `ctx-experiment-launcher.test.ts` (core parser and launcher tests). Include a negative fixture (differing system prompt hashes, volatile probe hit) that must be reported.

---

### `docs/RUNBOOK.md` (append) and `docs/UI.md`

**Analog:** Phase 10 section (`docs/RUNBOOK.md` lines 1604-1667). Insert the Phase 11 section before `## Phase 12 — OpenSpec Opt-in Skill` (line 1675). Format to copy:
```markdown
## Phase 11 — Terminal UI

| ID | Check | Status |
|----|-------|--------|
| RB-11-01 | ... | OUTSTANDING |

### RB-11-03 — live cacheRead with the full UI

**Status:** OUTSTANDING

**Why this cannot be done here.** ...

**Procedure, on the work laptop.**

1. ...
4. Record the result: `echo "RB-11-03 ... , $(date -u +%FT%TZ)" >> RB-11-03-RESULT.md`

**Expected output.** ...

**Offline proxy:** `tests/integration/ui-prompt-stability.test.ts` ...
```
Suggested IDs: RB-11-01 theme/header/footer visual and `/settings` lists `ky` (needs TTY, `/reload` after theme edits); RB-11-02 pi-subagents widget plus statusline segment during a real run (precondition RB-07-02); RB-11-03 live cacheRead + `sh scripts/ui-wire-check.sh` (offer `showCacheMissNotices` as an optional step; exclude `/plan` toggles per RB-10-02). `docs/UI.md`: short; document theme selection (`"theme": "ky"`, project key beats global so `/settings` cannot override inside this repo, `--use-theme ky`), what Pi's footer already shows, the single `ky-statusline` key, header, and that the subagent widget is composed from pi-subagents.

---

## Shared Patterns

### Never-throws event handlers
**Source:** `.pi/extensions/routing/index.ts` lines 311-326, 328-339
**Apply to:** every handler in `ui/index.ts`
```typescript
try { ... } catch {
	// Swallowed deliberately.
}
```
A UI failure must not block a turn or session start.

### Events as the cross-extension channel
**Source:** `.pi/extensions/routing/schema.ts:123`, `routing/index.ts:105,200` (`pi.events.emit(ROUTING_EVENT, ...)`)
**Apply to:** `ui/index.ts` (subscribe by string literal; no import from `routing/`).

### Prompt surface stays untouched
**Source:** `tests/unit/prompt-metadata-lint.test.ts` (FORBIDDEN table) and `tests/integration/prompt-stability.test.ts`
**Apply to:** all of `ui/`; enforced by the new lint and stability tests. Only prompt-writers today: `harness` (static section), vendored `background-tasks`.

### User prompts via `ctx.ui.confirm` / `ctx.ui.select` only
**Source:** audit result in RESEARCH: authored prompts already use `ui.select` (`safety`, `checkpoint`, `qoder`) and `ui.confirm` (`execute` x2, `review`); `ui.custom` appears only in vendored `questionnaire.ts`, `todo.ts`, `background-tasks/src/extension.ts`. Nothing to convert; the lint test locks it in.

### Test discipline
**Source:** `prompt-metadata-lint.test.ts` (vacuity guard, offender list with message, inline fixtures), `prompt-stability.test.ts` (negative control)
**Apply to:** all new tests. Each must fail when its subject is removed. Run `npx vitest run <file> --maxWorkers=2`, one at a time; `npx tsc --noEmit` once per plan.

### Git helpers in tests
**Source:** `tests/integration/prompt-stability.test.ts` lines 14-23 (`spawnSync("git", ["-c","user.name=t","-c","user.email=t@test.invalid","-c","commit.gpgsign=false", ...], { shell: false, windowsHide: true })`) and `tests/helpers/git.ts` (`repoRoot`, `trackedFiles`).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.pi/themes/ky.json` | theme config | n/a | No authored theme exists; use Pi's `dark.json` and `theme-schema.json` as the contract |
| header component in `ui/index.ts` | TUI component | render | No authored `setHeader`/component; use `ctx.ui.setHeader((tui, theme) => component)` from `types.d.ts` and `Text`, `visibleWidth`, `truncateToWidth` from `@earendil-works/pi-tui` (vendored extensions already import it); render reads module state at render time |

## Metadata

**Analog search scope:** `.pi/extensions/**`, `tests/helpers`, `tests/unit`, `tests/integration`, `scripts`, `docs/RUNBOOK.md`, `.pi/settings.json`, `.pi/themes`
**Files scanned:** about 25 read or grepped
**Pattern extraction date:** 2026-10-13
