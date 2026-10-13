# Phase 11: Terminal UI - Research

**Researched:** 2026-10-13
**Domain:** Pi 1.1.0 TUI chrome (theme JSON, footer status, startup header, widgets) with a byte-stable system prompt
**Confidence:** HIGH on Pi API/theme/footer (read at source); MEDIUM on pi-subagents behaviour (published source read, never executed, not installed here)

All Pi claims below were read from `node_modules/@earendil-works/pi-coding-agent/dist/**` (1.1.0) unless tagged otherwise. pi-subagents@0.76.1 was fetched with `npm pack --ignore-scripts` into the scratchpad and read only.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
1. **Terminal UI now, portable-first.** Option C from `.planning/research/PHASE-11-FRONTEND-OPTIONS.md`, minus the Zed half (moved to Phase 13). Build Phase 11 from mechanisms that also surface through `pi-acp` later wherever possible:
   - Statusline via `ctx.ui.setStatus(key, text)` footer entries (not a fully custom footer component) unless source shows `setStatus` cannot carry the required fields; if a custom footer/header component is used, it must be additive and degrade cleanly when `ctx.hasUI` is false or the mode is rpc/json/print.
   - **All user prompts** in authored extensions go through `ctx.ui.confirm` / `ctx.ui.select` (these reach Zed via ACP). Audit authored extensions (`.pi/extensions/*`, excluding vendored files with PROVENANCE.md) for any prompt that uses `ctx.ui.custom`/bespoke components and either convert it or document why it must stay. Vendored files are not rewritten.
   - Subagent widget may be terminal-only (`setWidget`).
2. **Theme:** dark, muted, low-noise; colour reserved for status (model, cost, errors/warnings). `awesome-pi-themes` is reference material only - not installed, not vendored. Ship one authored theme JSON in `.pi/themes/` (package manifest already lists `./.pi/themes`).
   - **Pi 1.1.0 theme schema: 56 colour tokens, 51 required** (verified in `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json`; CLAUDE.md's "53" is 0.84-era and stale). Research must enumerate the tokens from that file and a test must validate the shipped theme against the installed schema (all required present, no unknown keys, value formats legal, `vars` references resolve).
   - Pi 1.x defaults to the `system` theme. Decide (and document) how the user selects the authored theme - settings key in `.pi/settings.json` vs instructions - verifying the settings key at source.
3. **Volatile data never in the system prompt.** Cost, context %, git branch, changed files, model/provider, subagent status, timestamps: TUI chrome only. No `before_agent_start` `systemPrompt` change and no `promptSnippet`/`promptGuidelines` introduced by this phase. No new registered tool (CONTRIBUTING.md boundary rule); `tool-count-baseline` and workflow-budget tests must not change.
4. **Use Pi 1.x features rather than authoring parallel ones.** Pi 1.x is fullscreen-by-default TUI. Examples: `durationMs` on `tool_execution_end`, the tool-renderer registry, built-in footer data (context usage via `ctx.getContextUsage()`, session cost from session entries / usage), any built-in git-branch provider. Research verifies at source what 1.1.0 already shows in its default footer/header and only adds what is missing - do not duplicate a field Pi already renders unless the custom version replaces it.
5. **`cacheRead`-stays-high needs live inference.** Build the offline tooling: a test (fauxProvider + in-memory session) proving that, with every UI extension loaded and UI state changing across turns (model switch, cost change, branch change, file change, subagent start/stop), the system prompt bytes sent on the wire are identical turn to turn and contain none of the volatile values; plus a wire-dump check script/command the user can run live. Add `docs/RUNBOOK.md` entry `RB-11-xx` (OUTSTANDING) for the live `cacheRead` check.
6. **pi-subagents** is installed via `.pi/settings.json` (`npm:pi-subagents@0.76.1`). Research reads its published source (read only, never execute install scripts) to find which events / `pi.events` channels / session entries expose running subagents and status. If those cannot be observed offline, build the widget against a faithful stub of the exact event shapes found in source and add an `RB-11-xx` OUTSTANDING entry for the live check.
7. **Stay on Pi 1.1.0.** Verify every API claim against `node_modules/@earendil-works/pi-coding-agent/dist/**` (`.d.ts` + `.js`), not docs.

Already decided, binding (prior phases): extensions are `.ts` loaded by jiti, entry `.pi/extensions/<name>/index.ts`, no build step; comments follow root `AGENTS.md` (WHY-only, no phase/requirement/review IDs, no history); `pinning.test.ts` asserts the exact dependency set (no new npm dependency); public repo (no credentials/account ids/hostnames); POSIX `sh` only; each new test must fail when its subject is removed; live checks the dev machine cannot run go into `docs/RUNBOOK.md` as OUTSTANDING; CPU budget: targeted `npx vitest run <file> --maxWorkers=2`, `npx tsc --noEmit` once per plan, no concurrent runs, full suite once at verification (known flake `audit-concurrency`).

### Claude's Discretion
Extension layout (one `ui` extension vs header/status/widget split); exact palette; header content (keep it short - harness name, version, active mode/route); how changed-files count is computed (`git status --porcelain` via `pi.exec`, throttled/cached, refreshed on `turn_end`/`tool_execution_end`, never blocking the turn, safe when not a git repo); whether a `/theme`-like helper command is needed at all.

### Deferred Ideas (OUT OF SCOPE)
Zed / `pi-acp` / any GUI front-end (Phase 13 - do not touch `.planning/phases/13-*`). Upgrading Pi (stay on 1.1.0; do NOT move to 1.2.0). Hermes Agent.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Custom theme conforming to Pi's schema | Schema enumerated (56 tokens / 51 required), value formats, `vars`, selection via `theme` setting, load-path verification, validation approach without new deps (sections Theme, Validation Architecture) |
| UI-02 | Statusline: model, provider, context remaining, session cost, git branch, changed files, in TUI chrome | Default footer already renders 5 of 6 fields; only changed files + route/provider-guarantee + context-remaining are added via one `setStatus` key (section Statusline) |
| UI-03 | Custom startup header | `ctx.ui.setHeader(factory)` at `session_start`, tui-only guard, replaces built-in header; behaviour with `quietStartup` verified (section Header) |
| UI-04 | Live widget of running subagents and status | pi-subagents@0.76.1 already ships two live widgets (`subagent-async`, `subagent-fleet-status`) covering foreground and async runs; authored work is a count in the statusline plus event-shape stub test; see Open Question 1 |
| UI-05 | No UI element invalidates the system-prompt cache; cacheRead non-trivial | Existing `prompt-stability.test.ts` pattern extended with a recording UI context; live check via footer `CH%`, turns-log `cacheRead`, and a wire-dump script (RB-11-xx) |
</phase_requirements>

## Summary

Pi 1.1.0's default footer already renders most of UI-02. `FooterComponent.render` (`dist/modes/interactive/components/footer.js`) draws: line 1 `cwd (git-branch) - session name`; line 2 cumulative `up/down/R(cacheRead)/W(cacheWrite)/CH%(latest cache hit rate)/$cost` + `context%/window (auto)` on the left and `(provider) model - thinking-level` on the right (provider only when more than one provider has available models AND the line fits); line 3 all `setStatus` entries sorted by key, space-joined, truncated to width. Missing from it: changed-files count, the active route/mode, a guaranteed provider, and a "remaining" (not "used") context figure. Those are the only things to author, and `setStatus` can carry all of them, so no custom footer component is needed. Cost, git branch, cache-hit rate and context use already come from Pi and must NOT be recomputed or duplicated.

pi-subagents@0.76.1 ships its own live TUI widgets (`WIDGET_KEY = "subagent-async"`, async jobs tree, 4 jobs max, 1 s animation; and `subagent-fleet-status`, which also covers `state.foregroundControls`, i.e. foreground runs). It is pinned but NOT installed on this machine (`RB-07-02` OUTSTANDING; `.pi/npm` and `~/.pi/agent/npm` are empty), so the widget can only be proven by a live check. Authoring a second widget would stack two near-identical panels. Recommendation: author only a compact subagent count in the statusline (driven by `tool_execution_start/end` with `toolName === "subagent"` plus the `subagent:*` `pi.events`), test it offline against stubbed event shapes taken from source, and add an OUTSTANDING live check that the composed widget renders. This departs from the literal reading of locked decision 6 and success criterion 2 - see Open Question 1.

The volatile-data risk is small in this repo: no authored extension injects volatile text into the system prompt today. The only `before_agent_start` writers are `harness` (static comment-rules section) and `background-tasks` (vendored, static shell policy); `grill` and `plan-ceremony` return a hidden `message`, not a system prompt. `promptSnippet`/`promptGuidelines` exist only in vendored `background-tasks` and are already lint-guarded by `prompt-metadata-lint.test.ts`. The new phase therefore adds: one new extension directory (`.pi/extensions/ui/`), one theme JSON, one `theme` key in `.pi/settings.json`, tests, a live-check script and RUNBOOK/docs entries - and it must add zero tools and zero prompt text.

**Primary recommendation:** One authored extension `.pi/extensions/ui/` (pure formatter module + thin `index.ts`) that sets a single `ky-statusline` status entry and a tui-only header, and never touches prompts or tools; ship `.pi/themes/ky.json` with hex `vars`, select it with `"theme": "ky"` in `.pi/settings.json`; prove stability by extending the `prompt-stability.test.ts` pattern with a recording `uiContext`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Theme colours | Pi TUI renderer (theme JSON loaded by resource loader) | `.pi/settings.json` `theme` key | Pure presentation, no extension code |
| Statusline fields model/cost/ctx%/branch | Pi built-in footer | - | Already rendered at source; do not duplicate |
| Changed-files count, route, remaining ctx | Authored extension (`setStatus`) | `pi.exec('git')` | Not provided by Pi; `setStatus` also reaches rpc hosts |
| Startup header | Authored extension (`setHeader`) tui-only | - | rpc/json/print have no header surface |
| Subagent live widget | pi-subagents (composed package) | Authored count in statusline | Package ships it; avoid a duplicate panel |
| System-prompt stability | Existing extensions + test gate | Wire-dump script (live) | Guarantee is "UI never writes the prompt"; proved offline, cache hit live |
| Prompt surface (confirm/select only) | Authored extensions | Lint test | `ui.custom` is TUI-only |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@earendil-works/pi-coding-agent` | 1.1.0 (installed, pinned) | Host; `ExtensionUIContext`, `FooterDataProvider`, theme loader | Locked; no upgrade [VERIFIED: node_modules package.json] |
| `@earendil-works/pi-tui` | 1.1.0 | `Component`, `Text`, `visibleWidth`, `truncateToWidth` for the header | Already a peer; vendored extensions import it [VERIFIED: tui.d.ts] |
| `vitest` | 4.1.11 (installed) | Tests | Existing harness |

### Supporting
None. No new dependency (the `pinning.test.ts` exact-set rule). Theme validation is a hand-written structural check against the installed `theme-schema.json`; `typebox` is a devDependency but is not needed.

**Installation:** none.

**Version verification:** `node_modules/@earendil-works/pi-coding-agent/package.json` reports `"version": "1.1.0"` [VERIFIED: local read]. pi-subagents version read from the tarball packed as `pi-subagents@0.76.1` [VERIFIED: npm pack, `--ignore-scripts`, never executed].

## Package Legitimacy Audit

No external packages are installed or recommended in this phase. `pi-subagents@0.76.1` is already pinned (Phase 7) and was only packed and read, never installed or run.

**Packages removed due to slopcheck [SLOP] verdict:** none (n/a)
**Packages flagged as suspicious [SUS]:** none (n/a)

## Architecture Patterns

### System Architecture Diagram

```
 Pi session events                         pi.events bus (shared across extensions)
 (session_start, turn_end,                 ky.routing.mode_changed {mode, escalated, model}   <- routing ext
  tool_execution_start/end,                subagent:async-started / async-complete /
  model_select, agent_settled)             foreground-complete / child-status                  <- pi-subagents
          |                                          |
          v                                          v
   +-----------------------------  .pi/extensions/ui/index.ts  -----------------------------+
   | state: { mode, escalated, provider, ctxLeft, changedFiles, agentsRunning }             |
   |   refresh triggers -> read ctx.getContextUsage() (cheap) ; schedule git probe (throttled)|
   |   git probe: pi.exec('git',['--no-optional-locks','status','--porcelain']) single-flight|
   |              code!=0 / killed / ENOENT -> changedFiles = undefined (segment hidden)     |
   +------------------+------------------------------------------------+-------------------+
                      | formatStatusline(state, theme) (pure)          | header factory (tui only)
                      v                                                v
        ctx.ui.setStatus("ky-statusline", text)            ctx.ui.setHeader((tui, theme) => Component)
                      |                                                |
                      v                                                v
   Pi footer line 3 (joined with other statuses)           headerContainer (replaces built-in header)
   Pi footer lines 1-2 (cwd+branch, tokens, R/W/CH%, $, ctx%, (provider) model) = Pi built-in

   System prompt path (UNCHANGED, never touched by ui/):  before_agent_start -> prompt -> provider
   pi-subagents widgets ("subagent-async", "subagent-fleet-status") -> setWidget -> above editor
```

### Recommended Project Structure
```
.pi/extensions/ui/
  index.ts        # thin wiring: events -> state -> setStatus/setHeader; no formatting logic
  statusline.ts   # pure: formatStatusline(state, fg), formatHeader(...), parsePorcelain(stdout)
  git-probe.ts    # throttle + single-flight wrapper around an injected exec function
.pi/themes/ky.json
tests/unit/ui-theme.test.ts            # schema conformance + real Pi load
tests/unit/ui-statusline.test.ts       # pure formatter + git-probe logic
tests/unit/ui-prompt-surface-lint.test.ts   # no ui.custom outside vendored; ui/ writes no prompt/tool
tests/integration/ui-prompt-stability.test.ts   # recording UI + state changes + negative control
scripts/ui-wire-check.sh (+ .mjs)      # live check of wire dump + cacheRead
docs/UI.md (short) + RUNBOOK RB-11-xx
```
The `.pi/lib` and `.pi/extensions/<dir>/<helper>.ts` convention (non-entry modules have no default export) satisfies `extension-layout.test.ts` `isEntryPoint`.

### Pattern 1: Statusline as one deterministic `setStatus` key
**What:** One key (`ky-statusline`) holding all authored segments. The footer sorts keys alphabetically and joins values with a space on a single line, truncating to terminal width (footer.js "extension statuses" block), so one key controls segment order and total width. `sanitizeStatusText` only collapses `\r\n\t` and runs of spaces; ANSI escapes survive, so `ctx.ui.theme.fg(...)` colouring works (plan-mode already does this).
**When to use:** always; this is the portable path (rpc forwards `setStatus` as an `extension_ui_request`; print/json use a no-op UI) [VERIFIED: rpc-mode.js:101-111, runner.js:132].
**Example:**
```typescript
// Source: footer.js (extension statuses), types.d.ts ExtensionUIContext
const text = formatStatusline({ mode, escalated, provider, ctxLeftTokens, changedFiles, agentsRunning }, (c, s) => ctx.ui.theme.fg(c, s));
ctx.ui.setStatus("ky-statusline", text); // undefined clears
```
Segments (keep short; colour reserved for status): `balanced - deepseek | 870k left | 3 changed | 2 agents`. Omit a segment when its value is unknown (not a git repo, usage null after compaction). Do not repeat model id, cost, branch or context % (Pi renders them).

### Pattern 2: Recording UI context for offline tests
**What:** `bindExtensions({ uiContext, mode: "tui" })`. With no `uiContext` the runner uses `noOpUIContext` and `ctx.hasUI` is false [VERIFIED: runner.js:132-203, 404-406], so a UI-less test of a UI extension is vacuous. Provide a plain-object recording UI (record `setStatus`, `setWidget`, `setHeader`, `setTitle`; stub the rest) with a plain `theme` stub (`fg: (_c, s) => s`, `bold`). `wrapUIPromptContext` spreads the object (`...ui`), so a `theme` getter is evaluated once; use a plain value.
**Gap in the helper:** `tests/helpers/harness-session.ts` calls `session.bindExtensions({})` with no way to pass a UI. Add an optional `uiContext?: ExtensionUIContext` and `mode?` to `HarnessSessionOptions` and forward it; all other callers are unaffected.

### Pattern 3: Throttled single-flight git probe
**What:** `pi.exec` is `spawn(..., { shell: false })`, accepts `{ cwd, timeout, signal }`, and returns `{ stdout, stderr, code, killed }`; a spawn failure resolves `code: 1` rather than rejecting [VERIFIED: exec.js:10-75, loader.js:326-329]. Probe with `git --no-optional-locks status --porcelain` (the same `--no-optional-locks` Pi's own branch probe uses, footer-data-provider.js:49) so it cannot contend with the agent's own git index lock. Count non-empty lines. Rules: single-flight (ignore triggers while one is in flight, then run once more), minimum interval about 2 s, effective interval `max(2 s, 4x last duration)`, timeout 5 s, never awaited inside an event handler that blocks a turn (fire and forget; on resolve, update state and `setStatus`). Non-zero code or `killed` -> `changedFiles = undefined`, hide segment; code 128 (not a repo) stops further probing until the next `session_start`. Triggers: `session_start`, `turn_end`, `tool_execution_end` where `toolName` is `edit`, `write` or `bash`. Never poll on a timer.
**Windows:** `git` resolves via PATH with `shell:false`; `--porcelain` output is LF-delimited; `execCommand` sets no `windowsHide`, which is harmless from a console TUI. Do not use `-z` unless counting NUL-delimited records. Wrap everything in try/catch: after `/reload` or session replacement a stale `ctx`/`pi` throws via `assertActive` (runner.js `createContext`).

### Pattern 4: Header (tui only)
`ctx.ui.setHeader((tui, theme) => component)` at `session_start` when `ctx.mode === "tui"`. It replaces `builtInHeader` in place (interactive-mode.js `setExtensionHeader`); with `quietStartup: true` the built-in header is `Text("")` and is still replaceable. `resetExtensionUI()` clears it on reload/session switch and `session_start` re-fires, so set it in `session_start` every time. The component's `render(width)` reads module state at render time, so the mode/route stays live without baking colours. Content: `ky-pi-agent <package version> - pi <VERSION> - <mode>`, one or two lines. The built-in header also shows keybinding hints and onboarding text; replacing it drops them, so keep one dim hint line (`/ commands`, `!` bash, interrupt key) via `keyText("app.interrupt")` from the package root exports (`keyHint`, `keyText` are exported). Read the package version from `package.json` once (loop-police already uses `dirname(fileURLToPath(import.meta.url))`).

### Anti-Patterns to Avoid
- **Custom `setFooter`:** a full footer would re-implement cwd/branch/tokens/cost/cache stats that Pi already renders and would be a no-op over rpc.
- **Baking theme colours into `setStatus` and expecting them to track a theme switch:** the string keeps the old ANSI codes until the next refresh. Refresh on `turn_end` is enough; do not add a theme listener.
- **Calling `ctx.getContextUsage()` per frame or from a timer:** it projects the whole branch each call (agent-session.js:3438+). Call it at event boundaries only.
- **`ctx.ui.setTheme("ky")` from the extension:** it would override the user's `/settings` choice every session.
- **A second subagent widget:** duplicates pi-subagents' panels.
- **Any `systemPrompt`, `sections`, `promptSnippet` or `promptGuidelines` in `ui/`:** enforced by a lint test (below).

## Theme (UI-01) - verified at source

**Schema** (`dist/modes/interactive/theme/theme-schema.json`, Draft-07): top level `required: ["name","colors"]`, `additionalProperties: false`; properties `$schema`, `name` (pattern `^[^/]+$`; `system` is reserved), `appearance` (`"dark"|"light"`, auto-detected if omitted), `vars` (map of colour values), `colors`, `export` (optional `pageBg`, `cardBg`, `infoBg`). `colors` has `additionalProperties: false`, 56 properties, 51 required.

**Colour value** (`$defs.colorValue`): a string (hex `#RGB`/`#RRGGBB`, `oklch(...)`/`okhsl(...)`, a `vars` key, or `""` = terminal default) or an integer 0-255 (256-palette index). Variable references may chain; circular and missing references throw (`resolveVarRefs`, theme.js:23-37).

**The 56 tokens** (51 required + 5 optional marked *):
accent, border, borderAccent, borderMuted, success, error, warning, muted, dim, text, thinkingText, selectedBg, scrollbarTrack*, scrollbarThumb*, searchMatchBg*, searchMatchText*, userMessageBg, userMessageText, customMessageBg, customMessageText, customMessageLabel, toolPendingBg, toolSuccessBg, toolErrorBg, toolTitle, toolOutput, mdHeading, mdLink, mdLinkUrl, mdCode, mdCodeBlock, mdCodeBlockBorder, mdQuote, mdQuoteBorder, mdHr, mdListBullet, toolDiffAdded, toolDiffRemoved, toolDiffContext, syntaxComment, syntaxKeyword, syntaxFunction, syntaxVariable, syntaxString, syntaxNumber, syntaxType, syntaxOperator, syntaxPunctuation, thinkingOff, thinkingMinimal, thinkingLow, thinkingMedium, thinkingHigh, thinkingXhigh, thinkingMax*, bashMode.
Background tokens (rendered as bg): selectedBg, searchMatchBg, userMessageBg, customMessageBg, toolPendingBg, toolSuccessBg, toolErrorBg (`BACKGROUND_TOKENS`, theme.js:381). Fallbacks when optional tokens are omitted: scrollbarTrack->muted, scrollbarThumb->text, thinkingMax->thinkingXhigh, searchMatchBg->selectedBg, searchMatchText->text (theme.js:42-50).

**Authoring rules:** use hex `vars` (portable, readable, testable by regex) rather than the built-ins' `okhsl(...)`; set `appearance: "dark"`; `$schema` URL as the built-in `dark.json` uses; include the 5 optional tokens explicitly. Palette intent: neutral blue-grey for chrome (text, muted, dim, borders, markdown, syntax kept low-chroma), with saturated colour only on `accent`, `success`, `warning`, `error`, `thinking*` levels and tool pending/success/error backgrounds. Exact values are the planner's/implementer's call; they are validated by tests, not by taste.

**Selection:** the setting key is `theme` (settings-manager.js `getThemeSetting()` reads `settings.theme`; project settings deep-merge over global). A package theme is registered before the theme is applied (`setRegisteredThemes` at interactive-mode.js:417, `applyFromSettings` at :710), so `"theme": "ky"` in `.pi/settings.json` works for a theme shipped via `pi.themes` and also via the project's `.pi/themes` auto-discovery (resource-loader.js:761; duplicates are deduped by name). Recommendation: add `"theme": "ky"` to `.pi/settings.json` (the file today has only `packages` and `extensions`; no test asserts the full key set - `extension-pins.test.ts` checks `packages[]` equality and the absence of `agentScope` only), and document that a user of the installed package selects it via `/settings` -> Theme or `--use-theme ky` (CLI flag, documented in themes.md). Caveat to document: a project `theme` key beats a global one, and `/settings` writes the global key, so inside this repo `/settings` cannot override it; edit `.pi/settings.json` locally. No `/theme` helper command is needed.

**Hot reload:** only `<agent-dir>/themes/<name>.json` is watched (theme.js:593-640); a package or project theme needs `/reload` after edits.

**Validation without new deps:** Pi's real validator (`validateThemeJson`, typebox) is installed only by interactive mode and is not reachable (package `exports` expose only `.`). Test in two layers: (1) a structural check of `ky.json` against the installed `theme-schema.json` read via `fs` (required keys present, no unknown keys in `colors`/`export`/top level, `name` pattern, every value matches hex/`okhsl`/`oklch`/int 0-255/`""`/resolves to a `vars` key, `vars` have no cycles); (2) a real-load check through Pi: `new DefaultResourceLoader({ ..., additionalThemePaths: [".pi/themes"] })` then `reload()` and assert `getThemes().themes` contains `ky` with no diagnostics (the loader runs `loadThemeFromPath` -> `createTheme` -> `new Theme`, which throws on unresolved vars or unparsable colours). The exact `DefaultResourceLoader` constructor options must be confirmed in Wave 0 (see Open Question 3). The live proof (`/settings` lists `ky`, no startup theme diagnostic, colours look right) is an OUTSTANDING runbook item because it needs a terminal.

## What Pi's default footer already shows (decide: reuse, add)

| Required field | Pi 1.1.0 default | Action |
|---|---|---|
| model | right side of line 2, `state.model.id`, plus thinking level, plus `-> routed.model.id` for virtual models | Reuse |
| provider | `(provider) ` prefix only if `getAvailableProviderCount() > 1` and the line fits (footer.js "Prepend the provider") | Add provider to the authored segment so it is never dropped |
| context remaining | `used%/window (auto)`, red above 90, yellow above 70; `?` right after compaction | Reuse the %; add `N left` tokens segment (derived from `getContextUsage()`, hidden when `tokens === null`) |
| session cost | `$x.xxx` summed over all entries incl. `usage` entries (cache-warming refreshes) and tool-result usage; hidden at $0; `(sub)` for subscription providers | Reuse; do NOT recompute (a recompute would miss `usage` entries and diverge) |
| git branch | line 1 `cwd (branch)` from `FooterDataProvider.getGitBranch()`; fs-watcher based; `ReadonlyFooterDataProvider.getGitBranch/onBranchChange` also exposed to custom footers | Reuse |
| changed files | not rendered | Add (`git status --porcelain` probe) |
| route/mode | not rendered | Add from `ky.routing.mode_changed` and restored from `ky:mode` custom entries |
| cache hit | `R<tokens>` and `CH<n>%` (latest request) | Reuse as the zero-effort live cache signal for UI-05 |

How cost works at source if ever needed: `addUsageToTotals` (core/usage-totals.js) sums `usage.cost.total` over session entries of type `usage`, assistant `message` entries, `toolResult` messages carrying `usage`, and `compaction`/`branch_summary` entries with `usage`; `ctx.getContextUsage()` returns `{ tokens | null, contextWindow, percent | null }`. `durationMs` already exists on `tool_execution_end` and `ToolRenderContext`, and the built-in bash renderer uses it; the tool-renderer registry (`pi.registerToolRenderer`) is not needed for any UI-0x requirement and is deliberately not adopted.

Routing state: `routing/index.ts` emits `pi.events` topic `ky.routing.mode_changed` with `{ mode, escalated, model }` and persists `ky:mode` custom entries (`KyModeData { mode, escalated, escalatedFrom?, at }`). Subscribe to the event string (the file's own rule: "signalling is an event, never an import") and on `session_start` restore from the latest `ky:mode` entry in `ctx.sessionManager.getBranch()`.

## Subagents (UI-04) - pi-subagents@0.76.1 source findings

- Installed? No. `.pi/npm` and `~/.pi/agent/npm` are empty; the package is only pinned in `.pi/settings.json`. Authored-extension harness sessions never load it, so its widget is not observable offline.
- It ships its own widgets (`src/shared/types.js:117,126-127`; `src/tui/render.js:2970-2995`; `src/tui/fleet-status.js:13,637`): `subagent-async` (async jobs tree, `MAX_WIDGET_JOBS = 4`, 1 s animation, rpc gets a text snapshot via `encodeAsyncStatusSnapshotWidget`) and `subagent-fleet-status` (roster; entries include `state.foregroundControls`, i.e. foreground runs). Both are keyed `setWidget` calls with component factories, so they coexist with authored widgets under other keys.
- Observation channels (all on the shared `pi.events` bus; string constants at `src/shared/types.js:7-20`):
  - `subagent:async-started` - payload fields include `id`, `pid`, `sessionId`, `mode`, `agent`, `agents[]`, `chain`, `cwd`, `asyncDir` (`src/runs/background/async-execution.js:1409`, `:1986`).
  - `subagent:async-complete` - `id`/`runId`, `agent`, `mode`, `state` (`complete|failed|stopped`), `success`, `timestamp` (`result-watcher.js:528`, `subagent-executor.js:2922`).
  - `subagent:foreground-complete` - `id`, `runId`, `source: "foreground"`, `agent`, `success`, `state`, `exitCode`, `timestamp` (`subagent-executor.js:583`).
  - `subagent:child-status` - `{ type: "subagent.child-status", version: 1, runId, childId, status ("started"|"stopping"|...), agent, ts, source, asyncDir, stepIndex? }` (`rpc.js:472`, `subagent-executor.js:5358`, `async-job-tracker.js:283`).
  - Pi-native: `tool_execution_start/end` with `toolName === "subagent"` (the package itself keys on `event.toolName !== "subagent"` in its `tool_result` hook) - this is the only signal that exists for a foreground run in flight and is observable offline with a faux tool.
- Recommended authored behaviour: keep an in-memory set of running ids/toolCallIds; segment `N agents` shown when `N > 0`. Increment on `subagent:async-started` and on `tool_execution_start` of a `subagent` call (foreground), decrement on `subagent:async-complete` / `tool_execution_end`. Treat payloads defensively (every field optional); an unrecognised shape must degrade to "no segment", never throw.
- The offline stub test emits the exact shapes above via `pi.events.emit` and asserts the count and clearing; it is a stub of an observed shape, so the live check stays OUTSTANDING.

## Authored-extension audit (prompt surface and system-prompt writers)

| Question | Finding |
|---|---|
| Existing `setStatus`/`setWidget` users | `plan-mode` (vendored: status key `plan-mode`, widget key `plan-todos`) and `background-tasks` (vendored: status + widget key `background-tasks`) only. No authored extension uses them; no key collides with `ky-statusline` |
| `before_agent_start` writers | `harness/index.ts` (static comment-rules section, mutates `systemPromptOptions.sections`), `background-tasks` (vendored, static shell policy). `grill`, `plan-ceremony`, `plan-mode` return a hidden/display message (not the system prompt) |
| Volatile injection into system prompt | None found. `plan-mode-context` message is a per-turn custom message when plan mode is on (Phase 10 accepted: `/plan` toggle is the sanctioned mid-session change) |
| `promptSnippet`/`promptGuidelines` | Only vendored `background-tasks`; `prompt-metadata-lint.test.ts` already bans `${`, `Date`, `process.cwd/env`, exec, git commands in them |
| `ctx.ui.custom` | Only in vendored files: `questionnaire.ts` (`questionnaire.PROVENANCE.md`), `todo.ts` (`todo.PROVENANCE.md`), `background-tasks/src/extension.ts` (`background-tasks/PROVENANCE.md`). Authored prompts all use `ui.select` (`safety`, `checkpoint`, `qoder`) or `ui.confirm` (`execute` x2, `review`). Nothing to convert |
| Required work | Add a lint test that fails when a non-vendored tracked `.ts` under `.pi/extensions/` contains `ui.custom`, with the vendored set derived from `PROVENANCE.md` presence (dir-level) or `<name>.PROVENANCE.md` (flat file), asserted non-empty and with a negative control; and that `.pi/extensions/ui/` contains none of: `systemPrompt`, `promptSnippet`, `promptGuidelines`, `registerTool`, `setActiveTools`, `context_with_system`. Note `chokepoint-lint` and `contributing-boundary` scan raw source including comments, so `ui/` must not spell the forbidden tool-registration or model-call phrases even in prose |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cost / cache-hit / context % display | A recomputation | Pi's built-in footer | Pi sums `usage` entries and cache-warming refreshes; a recompute drifts |
| Git branch display | `git rev-parse` polling | Footer's branch (fs-watcher, `--no-optional-locks`) | Already correct incl. worktrees/reftable |
| Git branch for changed-files cwd handling | Walking `.git` | `pi.exec('git', ...)` and read the exit code | Non-repo = non-zero exit |
| Subagent roster/widget | A tree/animation widget | pi-subagents' own widgets | Package maintains it against its own state |
| Theme validation | An ajv/typebox pipeline | fs read of `theme-schema.json` + Pi's loader via `DefaultResourceLoader` | No new dependency allowed |
| Terminal title | `setTitle` calls | Pi's `updateTerminalTitle` | Pi already sets it and resets on reload |
| Tool-duration display | A tool renderer | Built-in (bash renderer shows `durationMs`) | Out of scope |

## Common Pitfalls

### Pitfall 1: A vacuously green UI test
**What goes wrong:** the test asserts the system prompt is stable but the UI code never ran because the session had no UI (`hasUI` false, no-op `setStatus`).
**Why:** `bindExtensions({})` selects `noOpUIContext`.
**Avoid:** pass a recording `uiContext`; assert `setStatus` was called with changing text across turns BEFORE comparing prompts; keep a negative control (an extra extension that writes a volatile `sections` entry must make the same check fail, as `prompt-stability.test.ts` already does).

### Pitfall 2: Faux reports zero cost
**What goes wrong:** "cost changes between turns" cannot be shown with faux usage.
**Avoid:** assert on accumulated token usage as the existing test does, or seed cost via a faux model with non-zero `cost` or a seeded `usage` session entry in `beforeBind`. The statusline does not display cost, so cost need only be present in session state to prove the prompt ignores it.

### Pitfall 3: Status line eats the footer
**What goes wrong:** statuses from several extensions are space-joined on ONE line and truncated; a long authored status pushes `plan-mode`/background-tasks statuses off the edge.
**Avoid:** one key, short segments (target under 40 visible columns), segments omitted when unknown. Key `ky-statusline` sorts after `background-tasks` and before `plan-mode`; accept that order.

### Pitfall 4: Stale ctx after reload
**What goes wrong:** async git probe resolves after `/reload` or a session switch, calls `ctx.ui.setStatus` on a dead context, and throws.
**Avoid:** generation counter bumped on `session_start`/`session_shutdown`; ignore results from older generations; wrap `setStatus` in try/catch.

### Pitfall 5: Header never appears
**What goes wrong:** `setHeader` called before the TUI built its header returns silently (`if (!this.builtInHeader) return`).
**Avoid:** call from `session_start` (runs after header creation: interactive-mode.js ~760 then `rebindCurrentSession` ~782); do not call from the factory body. Live check covers it.

### Pitfall 6: Hidden prompt coupling through the system-prompt options
**What goes wrong:** `harness` mutates `systemPromptOptions.sections` in `before_agent_start`; a UI extension that also touches options would change bytes.
**Avoid:** `ui/` registers no `before_agent_start` handler at all; lint-enforced.

### Pitfall 7: Theme name collisions and reserved names
`system` is reserved and a custom theme named `system` is ignored; names with `/` throw. Use `ky`.

## Code Examples

### Pure porcelain count (testable without git)
```typescript
// Counts entries in `git status --porcelain` output; empty output is a clean tree.
export function parsePorcelain(stdout: string): number {
	return stdout.split("\n").filter((line) => line.trim() !== "").length;
}
```

### Probe wiring (sketch)
```typescript
// Source: dist/core/extensions/loader.js:326 (pi.exec), dist/core/exec.js
const r = await pi.exec("git", ["--no-optional-locks", "status", "--porcelain"], { cwd: ctx.cwd, timeout: 5000 });
if (r.killed || r.code !== 0) state.changedFiles = undefined; // 128 = not a repo: stop probing until next session_start
else state.changedFiles = parsePorcelain(r.stdout);
```

### Recording UI for tests
```typescript
// bindExtensions accepts { uiContext, mode } (dist/core/agent-session.d.ts ExtensionBindings)
const calls: { key: string; text: string | undefined }[] = [];
const ui = {
	...noopMethods, // select/confirm/input/editor/custom -> undefined/false; notify; widgets; etc.
	theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s },
	setStatus: (key: string, text: string | undefined) => void calls.push({ key, text }),
} as unknown as ExtensionUIContext;
await session.bindExtensions({ uiContext: ui, mode: "tui" });
```

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted.

## State of the Art

| Old (CLAUDE.md, 0.84 era) | Current (1.1.0 verified) | Impact |
|---|---|---|
| 53 theme tokens, 51 required | 56 tokens (51 required); new optional `scrollbarTrack`, `searchMatchBg`, `searchMatchText` | Include all 5 optionals; test expects 56/51 from the installed schema, not a literal |
| Default theme dark/light | Default is generated `system` theme (queries terminal colours; 100 ms wait) | Must set `theme` explicitly to get `ky` |
| Footer data minimal | `FooterDataProvider` exposes branch, statuses, provider count, `onBranchChange` | No custom footer needed |
| No `durationMs` | `durationMs` on `tool_execution_end` and tool render context | Already shown by built-in bash renderer |
| `cacheWarming` n/a | Pi replays stable prefix by default (`"streaming"`), refresh usage added to session totals, `showCacheMissNotices` setting available | Footer cost includes warming spend; `showCacheMissNotices: true` is a free live cache-miss alarm for the RB check |

**Deprecated/outdated:** `docs/EXTENSIONS.md` "Pi 1.x capabilities not adopted" list item "Phase 11's cost display should account for [the cache warmer]" - satisfied by reusing Pi's footer cost.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pi-subagents' own widgets satisfy UI-04's "live widget shows running subagents and status" in a real session (read from source, never executed) | Subagents | UI-04 unmet live; fallback is a thin authored widget on the same events (design in Subagents section) |
| A2 | `session_start` fires on `bindExtensions` in a headless faux session (the routing source comment says it does not fire in a bare `createAgentSession`) | Pattern 2 | Offline tests must call the handler path differently; verify in Wave 0 with a 1-line probe test |
| A3 | `tool_execution_start/end` fire for a faux-driven tool call named `subagent` | Subagents | Count logic untestable offline via Pi events; use `pi.events.emit` stubs only |
| A4 | `git status --porcelain` cost stays acceptable in the user's large monorepos with the 2 s / 4x backoff | Pattern 3 | Visible lag on huge repos; mitigation is the timeout and backoff, tunable constants |
| A5 | `DefaultResourceLoader` options accept `additionalThemePaths` and expose `getThemes().diagnostics` as `resource-loader.d.ts` suggests (line 78, 302) | Theme | Layer-2 theme test needs a different Pi entry point |

## Open Questions

1. **Author a subagent widget or rely on pi-subagents'?**
   - Known: the package ships both a jobs widget and a fleet roster covering foreground and async runs; it is uninstalled here so nothing can be proven offline; locked decision 6 and the success criterion read as if an authored widget is expected.
   - Unclear: whether the user wants the composed widget to count as UI-04.
   - Recommendation: plan the statusline count + stub-event tests + OUTSTANDING live check, and put the thin authored widget behind an explicit decision task (default: not built). Suggested thin design if built: `setWidget("ky-agents", lines, { placement: "belowEditor" })`, string-array form (rpc-compatible), max 10 lines (Pi truncates at `MAX_WIDGET_LINES = 10`), cleared with `undefined`.
2. **Header content vs losing the built-in hints** - default recommendation above (one dim hint line); user may prefer a fully minimal header.
3. **Exact `DefaultResourceLoader` constructor shape** for the Wave 0 theme test (see A5).
4. **Does the user want `showCacheMissNotices: true` added to `.pi/settings.json`?** It is a documented built-in setting that surfaces cache misses live. Not required by any UI-0x; offered as the runbook step instead of a repo change.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | tests | yes | >= 22.19 (engines) | - |
| git | changed-files probe + tests | yes (tests already spawn it) | - | segment hidden when absent |
| pi-subagents | UI-04 live widget | no (pinned, not installed; RB-07-02) | 0.76.1 pinned | stub-event tests + OUTSTANDING live check |
| Live inference key | UI-05 cacheRead | no on this machine | - | RB-11-xx on the work laptop |
| Interactive TTY | theme/header/footer visual proof | no in CI | - | RB-11-xx OUTSTANDING |

**Missing with no fallback:** none blocking. **Missing with fallback:** all four live items above go to RUNBOOK as OUTSTANDING.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.11 (`vitest.config.ts`, `maxWorkers: 2`, `passWithNoTests: false`, global setup tripwire, agent-dir isolation) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/unit/ui-statusline.test.ts --maxWorkers=2` |
| Full suite command | `npx vitest run` (once, at verification; `audit-concurrency` is a known flake) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | `ky.json` has all 51 required tokens, no unknown keys, legal values, resolving vars; token set derived from installed schema (56/51), not hard-coded | unit | `npx vitest run tests/unit/ui-theme.test.ts --maxWorkers=2` | Wave 0 |
| UI-01 | Pi's loader accepts the theme (no diagnostics), `.pi/settings.json` `theme` equals the shipped theme name | unit | same file | Wave 0 |
| UI-02 | `formatStatusline` omits unknown segments, never repeats model/cost/branch, stays under width budget; `parsePorcelain`; probe throttle/single-flight/non-repo/killed behaviour with a fake exec and fake clock | unit | `npx vitest run tests/unit/ui-statusline.test.ts --maxWorkers=2` | Wave 0 |
| UI-02/03 | With recording UI, `session_start` sets header (tui only) and statusline; `hasUI` false/rpc/print make no UI calls and no throw | integration | `npx vitest run tests/integration/ui-chrome.test.ts --maxWorkers=2` | Wave 0 |
| UI-04 | Stubbed `subagent:*` events and `subagent` tool execution start/end drive the count up and back to zero; malformed payloads ignored | unit/integration | `npx vitest run tests/unit/ui-statusline.test.ts tests/integration/ui-chrome.test.ts --maxWorkers=2` | Wave 0 |
| UI-05 | All extensions + recording UI; 3+ turns with model switch, routing event, branch change, file edit, subagent events, seeded usage: system prompt and tool list byte-identical across requests, none of the volatile values present, `setStatus` text DID change; negative control with a volatile section fails | integration | `npx vitest run tests/integration/ui-prompt-stability.test.ts --maxWorkers=2` | Wave 0 |
| UI-05 | No `ui.custom` in non-vendored sources; `ui/` has no prompt/tool surface; vacuity guards and fixture negatives | unit | `npx vitest run tests/unit/ui-prompt-surface-lint.test.ts --maxWorkers=2` | Wave 0 |
| UI-05 (live) | cacheRead ratio on turn 2+ non-trivial with full UI; wire dump system prompt hash equal across turns; no volatile value | manual (RB-11-xx) | `sh scripts/ui-wire-check.sh` on the work laptop | Wave 0 (script + offline test of its parser) |
| Regression | tool count, workflow budgets, pinning, prompt-stability unchanged | existing | `npx vitest run tests/unit/tool-count-baseline.test.ts tests/unit/workflow-budgets.test.ts tests/unit/pinning.test.ts tests/integration/prompt-stability.test.ts --maxWorkers=2` | exist |

Mutation discipline (each new test must fail when its subject is removed): theme test fails if a required token is deleted or an unknown key added (fixture-based negatives inside the test); statusline test fails if a segment is dropped; stability test negative control; lint test with an inline offending fixture. Also run `context-floor.test.ts` once at verification: the new extension must add a zero-char, zero-tool row (the attribution closure test enumerates every entry point automatically).

### Sampling Rate
- **Per task commit:** the single targeted test file for that task.
- **Per wave merge:** the 4 regression files above plus the new UI files, one run at a time.
- **Phase gate:** `npx tsc --noEmit` once per plan; full suite once before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/helpers/harness-session.ts` - add optional `uiContext`/`mode` forwarding to `bindExtensions`, plus a `tests/helpers/recording-ui.ts` recorder.
- [ ] `tests/unit/ui-theme.test.ts`, `ui-statusline.test.ts`, `ui-prompt-surface-lint.test.ts`; `tests/integration/ui-chrome.test.ts`, `ui-prompt-stability.test.ts`.
- [ ] Probe test confirming A2/A3 (does `session_start` / `tool_execution_*` fire under `bindExtensions` with faux).
- [ ] `scripts/ui-wire-check.sh` (+ `.mjs`, patterned on `ctx-experiment.sh`) and its parser unit test.
- [ ] Docs: `docs/UI.md` (short), `docs/RUNBOOK.md` Phase 11 section with `RB-11-01..` all OUTSTANDING (suggested: 01 theme/header/footer visual and `/settings` listing, 02 subagent widgets with `RB-07-02` as precondition, 03 live cacheRead + wire dump).

### Live wire-dump check (RB-11-xx content)
Existing evidence sources: footer `R<tokens> CH<n>%` (Pi built-in); `.pi/logs/turns-<date>.jsonl` rows carry `cacheRead`, `input` and `corr`; `.pi/logs/wire-<date>.jsonl` `main.request` records carry the redacted provider payload keyed by `corr` (`docs/DIAGNOSTICS.md`). The script should: take the last N `main.request` records of one `sessionId`, extract the system/instructions text from the provider-specific payload location (OpenAI-compatible `messages[0]` with role system/developer; Bedrock `system[]`), hash it and report equal/unequal across requests, grep the extracted text for the user-supplied volatile probes (current branch name, `$` cost pattern, a changed-file name), and compute the turns-log ratio `cacheRead / (input + cacheRead)` for turns 2+. Run it after: two plain turns, then a model switch (`/cheap`/`/balanced`), an edited file, and a subagent run. Expected: identical hashes, no probe hits, turn-2 ratio high. Note `/plan` toggles are a sanctioned prompt change (RB-10-02) and must be excluded from this check. Record the result line in `RB-11-0x-RESULT.md` per existing runbook convention.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | - |
| V3 Session Management | no | - |
| V4 Access Control | no | the `ui/` extension adds no tool and no capability |
| V5 Input Validation | yes | treat `pi.events` payloads and `git` output as untrusted: defensive field access, bounded string length, strip control characters before `setStatus` (Pi only collapses whitespace) |
| V6 Cryptography | no | - |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Terminal escape injection via event/file-name text rendered in the footer or header | Tampering | Strip C0/C1 control characters and ESC from any externally derived text (agent names, file names) before formatting; only own `theme.fg` sequences may carry ANSI |
| Secret/path leakage into status or logs | Information disclosure | Status shows counts and mode names only; no paths, hostnames or account ids; the wire-check script reads already-redacted logs |
| Command execution in the status path | Elevation | Fixed argv for `pi.exec('git', [...])`, `shell:false`, no user-controlled arguments, read-only subcommand |
| Hang/DoS from slow `git status` | Denial of service | Timeout 5 s, single-flight, backoff, never awaited inside a turn-blocking handler |
| Theme/Settings tampering via project files | Tampering | Project settings only load when the project is trusted (`isProjectTrusted`); the theme is data, not code |

## Sources

### Primary (HIGH confidence)
- `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/footer.js` - complete default footer rendering
- `.../dist/core/footer-data-provider.{js,d.ts}` - branch provider, statuses, provider count
- `.../dist/modes/interactive/theme/{theme-schema.json,theme.js,theme-json.js,theme-controller.js,dark.json}` - schema, resolution, selection, watcher
- `.../dist/core/settings-manager.{js,d.ts}` - `theme` key, project/global merge, trust
- `.../dist/core/extensions/{types.d.ts,runner.js,loader.js}` - `ExtensionUIContext`, `noOpUIContext`, `hasUI`, `bindExtensions`, `pi.exec`
- `.../dist/modes/interactive/interactive-mode.js` (setExtensionWidget/Header/Status, `MAX_WIDGET_LINES = 10`, header lifecycle) and `.../modes/rpc/rpc-mode.js` (rpc UI behaviour)
- `.../dist/core/{exec.js,usage-totals.js,agent-session.js getContextUsage}`; `docs/settings.md` cacheWarming/showCacheMissNotices
- pi-subagents@0.76.1 tarball (npm pack --ignore-scripts; read only): `src/shared/types.js`, `src/tui/{render,fleet-status,fleet}.js`, `src/extension/index.js`, `src/runs/background/{async-execution,result-watcher,notify}.js`, `src/runs/foreground/subagent-executor.js`
- Repo: `.pi/extensions/**`, `tests/helpers/harness-session.ts`, `tests/integration/prompt-stability.test.ts`, `tests/unit/{prompt-metadata-lint,context-hook-lint,extension-pins,contributing-boundary}.test.ts`, `docs/{RUNBOOK,DIAGNOSTICS,EXTENSIONS}.md`

### Secondary (MEDIUM confidence)
- `node_modules/@earendil-works/pi-coding-agent/docs/themes.md` (selection/hot-reload prose, consistent with source)

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; everything read at source.
- Architecture: HIGH for theme/footer/header/status; MEDIUM for subagent event shapes (read, never run).
- Pitfalls: HIGH for harness/UI-context vacuity (read at source); MEDIUM for git-probe cost on very large repos.

**Research date:** 2026-10-13
**Valid until:** 2026-11-12 (Pi pinned at 1.1.0, so stable; revisit only if the pin moves)
