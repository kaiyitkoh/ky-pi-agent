# Orca as desktop front-end for the harness (research 2026-10-13, Orca main @ e713bcb)

Recommendation: terminal mode first; chat (RPC) mode later.

## Launch
- Terminal: `pi [agentDefaultArgs.pi] "<prompt>"` in ConPTY, cwd = Orca worktree. Chat: `pi --mode rpc [args]` (Pi ≥0.84; refuses --mode/-p/--session/--resume/--continue/--fork in args).
- ~/.pi/agent NOT hidden (terminal leaves PI_CODING_AGENT_DIR; chat sets it to same dir). Project `.pi/` loads from cwd.
- Orca writes `orca-titlebar-spinner.ts`, `orca-prefill.ts`, `orca-agent-status.ts` into ~/.pi/agent/extensions (inert without ORCA_PANE_KEY; not removed on uninstall #27397; Windows TUI 2-3s lag #27363 — Win11 26200 + Pi 1.1.0). Disable via `agentStatusHooksEnabled`.
- `agentDefaultArgs.pi` (e.g. `--ky-profile implement`), `agentDefaultEnv.pi`; `agentCmdOverrides.pi` = exe path only.

## Feature survival
- Terminal: everything. Chat: notify/setStatus/setWidget/setTitle dropped; confirm/select/input/editor → cards; questionnaire refuses (mode≠tui, questionnaire.ts:155); slash commands listed, behaviour unverified.
- Worktrees: harness config must be tracked/global or new Orca worktrees lack it; project-trust may prompt per worktree (unverified).

## Safety
- Push guard refuses when `!ctx.hasUI || ctx.mode !== "tui"` (safety/index.ts:376) → in chat mode no card, always refused. Fix: allow rpc when hasUI.
- Orca's own git buttons (push incl. --force-with-lease, gh/glab merge incl. auto-merge) bypass the guard — only server-side branch protection stops them. Chat mode is full-access; Pi extensions are the only gate. `orca terminal send` possible bypass (unverified).

## Windows / privacy / version
- NSIS installer `orca-windows-setup.exe` (no winget). Stable builds signed "SignPath Foundation" (verify Get-AuthenticodeSignature).
- Telemetry ON by default (PostHog): set `ORCA_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, `ORCA_DIAGNOSTICS_DISABLED=1` + Privacy pane. No sign-in for desktop. Update checks GitHub + onorca.dev nudge; download only on click; no off switch found.
- Pin: v1.4.216 (2026-09-28, ≥2 weeks, terminal only) vs v1.4.224 (2026-10-10, first Pi chat mode).

## Setup checklist (work laptop)
1. IT OK; Git for Windows + Node ≥22.19.
2. Env vars above before first launch.
3. Install pinned version, verify signature.
4. Telemetry off, default view Terminal, terminalWindowsShell = Git Bash, mobile off, never click Update.
5. agentDefaultArgs.pi = `--ky-profile implement`.
6. Optional: agentStatusHooksEnabled off.
7. Harness config tracked/global; check /budget, statusline, feature-branch push confirm.
8. Never use Orca Push/Merge on main; GitLab protects main.

## Harness changes needed (for the Orca phase)
- Push guard: allow `mode === "rpc"` with hasUI; keep json/print/subagents refusing.
- Questionnaire: RPC fallback to sequential select/input.
- Important questions via confirm/select, not custom.
- Budget/routing alerts also as messages, not only setStatus.
- Docs: Orca env config + uninstall cleanup; optionally ignore `@orca-managed-pi-extension` files outside Orca.

## Open questions for the user
- Harness installed globally or per work repo; is `.pi/` tracked there?
- v1.4.224 (chat mode, 3 days old) or v1.4.216 (terminal only)?
- Allow Orca's git buttons at all?
- Is #27363 lag theirs → disable Orca's Pi extensions?
- Can IT block onorca.dev / PostHog?
