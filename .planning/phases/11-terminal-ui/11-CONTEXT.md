# Phase 11: Terminal UI - Context

**Gathered:** 2026-10-13
**Status:** Ready for planning
**Mode:** Auto-generated from user-locked decisions (2026-10-13); orchestrator facts below are binding

<domain>
## Phase Boundary

The harness looks and feels like the user's own tool, without any of it costing 50x on the prompt prefix.

**Requirements:** UI-01, UI-02, UI-03, UI-04, UI-05 (REQUIREMENTS.md). Requirement IDs belong in planning artifacts only, never in code comments.

**Depends on:** Phase 5 (model/mode state, routing), Phase 7 (pi-subagents composed via `.pi/settings.json`), Phase 10 (cache discipline, `/budget`, prompt-stability tests), Phase 2 (wire inspector / per-turn JSONL with `cacheRead`).

**Success criteria (ROADMAP.md, binding):**

1. A custom theme conforming to Pi's schema, a custom startup header, and a statusline showing model, provider, context remaining, session cost, git branch and changed files all ship.
2. A live widget shows running subagents and their status.
3. `cacheRead` stays non-trivial with the full UI enabled, and a wire dump confirms that no volatile value reached the system prompt — every one of them renders in TUI chrome instead.

**Out of scope:** Zed / `pi-acp` / any GUI front-end (that is Phase 13 — do not touch `.planning/phases/13-*`). Upgrading Pi (stay on 1.1.0; do NOT move to 1.2.0). Hermes Agent.
</domain>

<decisions>
## Implementation Decisions

### User-locked (2026-10-13)

1. **Terminal UI now, portable-first.** Option C from `.planning/research/PHASE-11-FRONTEND-OPTIONS.md`, minus the Zed half (moved to Phase 13). Build Phase 11 from mechanisms that also surface through `pi-acp` later wherever possible:
   - Statusline via `ctx.ui.setStatus(key, text)` footer entries (not a fully custom footer component) unless source shows `setStatus` cannot carry the required fields; if a custom footer/header component is used, it must be additive and degrade cleanly when `ctx.hasUI` is false or the mode is rpc/json/print.
   - **All user prompts** in authored extensions go through `ctx.ui.confirm` / `ctx.ui.select` (these reach Zed via ACP). Audit authored extensions (`.pi/extensions/*`, excluding vendored files with PROVENANCE.md) for any prompt that uses `ctx.ui.custom`/bespoke components and either convert it or document why it must stay. Vendored files are not rewritten.
   - Subagent widget may be terminal-only (`setWidget`).
2. **Theme:** dark, muted, low-noise; colour reserved for status (model, cost, errors/warnings). `awesome-pi-themes` is reference material only — not installed, not vendored. Ship one authored theme JSON in `.pi/themes/` (package manifest already lists `./.pi/themes`).
   - **Pi 1.1.0 theme schema: 56 colour tokens, 51 required** (verified in `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json`; CLAUDE.md's "53" is 0.84-era and stale). Research must enumerate the tokens from that file and a test must validate the shipped theme against the installed schema (all required present, no unknown keys, value formats legal, `vars` references resolve).
   - Pi 1.x defaults to the `system` theme. Decide (and document) how the user selects the authored theme — settings key in `.pi/settings.json` vs instructions — verifying the settings key at source.
3. **Volatile data never in the system prompt.** Cost, context %, git branch, changed files, model/provider, subagent status, timestamps: TUI chrome only. No `before_agent_start` `systemPrompt` change and no `promptSnippet`/`promptGuidelines` introduced by this phase. No new registered tool (CONTRIBUTING.md boundary rule); `tool-count-baseline` and workflow-budget tests must not change.
4. **Use Pi 1.x features rather than authoring parallel ones.** Pi 1.x is fullscreen-by-default TUI. Examples: `durationMs` on `tool_execution_end`, the tool-renderer registry, built-in footer data (context usage via `ctx.getContextUsage()`, session cost from session entries / usage), any built-in git-branch provider. Research verifies at source what 1.1.0 already shows in its default footer/header and only adds what is missing — do not duplicate a field Pi already renders unless the custom version replaces it.
5. **`cacheRead`-stays-high needs live inference.** Build the offline tooling: a test (fauxProvider + in-memory session) proving that, with every UI extension loaded and UI state changing across turns (model switch, cost change, branch change, file change, subagent start/stop), the system prompt bytes sent on the wire are identical turn to turn and contain none of the volatile values; plus a wire-dump check script/command the user can run live. Add `docs/RUNBOOK.md` entry `RB-11-xx` (OUTSTANDING) for the live `cacheRead` check.
6. **pi-subagents** is installed via `.pi/settings.json` (`npm:pi-subagents@0.76.1`). Research reads its published source (read only, never execute install scripts) to find which events / `pi.events` channels / session entries expose running subagents and status. If those cannot be observed offline, build the widget against a faithful stub of the exact event shapes found in source and add an `RB-11-xx` OUTSTANDING entry for the live check.
7. **Stay on Pi 1.1.0.** Verify every API claim against `node_modules/@earendil-works/pi-coding-agent/dist/**` (`.d.ts` + `.js`), not docs.

### Already decided, binding (from prior phases)

- Extensions are `.ts` loaded by jiti, entry `.pi/extensions/<name>/index.ts`; no build step.
- Comments follow root `AGENTS.md` (WHY-only, no phase/requirement/review IDs, no history).
- `pinning.test.ts` asserts the exact dependency set — no new npm dependency.
- Public repo: no credentials, account ids, hostnames.
- POSIX `sh` only for scripts.
- Be suspicious of green: each new test must fail when its subject is removed.
- Live checks the dev machine cannot run go into `docs/RUNBOOK.md` as OUTSTANDING; the phase still completes.

### CPU budget (hard)
Targeted tests only: `npx vitest run <file> --maxWorkers=2`; `npx tsc --noEmit` once per plan; never concurrent test runs; sequential plan execution. Full suite ONCE at verification. Known flake: `audit-concurrency`. Do not raise budgets to pass tests.

### Claude's discretion
Extension layout (one `ui` extension vs header/status/widget split); exact palette; header content (keep it short — harness name, version, active mode/route); how changed-files count is computed (`git status --porcelain` via `pi.exec`, throttled/cached, refreshed on `turn_end`/`tool_execution_end`, never blocking the turn, safe when not a git repo); whether a `/theme`-like helper command is needed at all.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` — Phase 11 section
- `.planning/REQUIREMENTS.md` — UI-01..UI-05
- `.planning/research/PHASE-11-FRONTEND-OPTIONS.md` — front-end decision
- `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json` — theme schema (56 / 51)
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — `ctx.ui` surface, events
- `node_modules/@earendil-works/pi-coding-agent/docs/{themes,extensions,tui}.md` — secondary to source
- `.pi/extensions/diagnostics/` — wire inspector / per-turn JSONL (`cacheRead`)
- Phase 10 artifacts (`.planning/phases/10-context-budget-progressive-disclosure/`) — prompt-stability tests and `/budget`
- `docs/RUNBOOK.md` — append `RB-11-xx`
- `CONTRIBUTING.md` — boundary rule
- `AGENTS.md` — comment rules
</canonical_refs>
