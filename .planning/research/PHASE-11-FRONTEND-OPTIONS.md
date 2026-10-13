# Phase 11 — terminal vs GUI front-end (research 2026-10-13, awaiting user decision)

Pi's TUI is the primary interface. Real front-ends exist and all wrap Pi as a subprocess (`--mode rpc` / SDK), so the authored safety guard keeps working under any of them.

| Front-end | Type | Version | Adoption | Windows |
|---|---|---|---|---|
| `pi-acp` (svkozak) | ACP adapter → Zed agent panel | 0.0.34 (2026-09-24) | 538,712 dl/mo, 727★, MIT | Unstated; open bug: session paths truncated at spaces |
| `pi-gui` | Electron desktop app | v1.0.1 (2026-09-26) | 1,223★, MIT | Yes (unsigned) |
| `@jmfederico/pi-web` | Web UI extension | 1.202610.1 | 10,203 dl/mo | Unstated |
| `@hyperdreamer/pi-webui` | Web UI | 1.24.1 | 2,204 dl/mo | Unstated |

- No official Earendil desktop/web UI; no VS Code/JetBrains extension.
- Through `pi-acp`, `ctx.ui.confirm/select` (safety prompts) reach Zed; `setWidget`/`setStatus`/themes/extension slash commands do not.
- "Hermes Agent" = NousResearch/hermes-agent — a separate agent, not a UI; cannot host Pi. Adopting it replaces the harness.
- Pi is now 1.2.0 on npm (2026-10-12); repo pinned 1.1.0.

## Options
- **A. Terminal-only Phase 11 (as planned).** Zero deps; no GUI diffs.
- **B. GUI instead (`pi-gui`).** Richest; large Electron surface, unsigned, chases a fast-moving API.
- **C. Both — recommended.** Slim Phase 11 to portable pieces (theme, `setStatus` footer, all prompts via `ctx.ui.confirm/select`, volatile data out of system prompt), plus an optional documented Zed + `pi-acp@0.0.34` setup (thin reviewable TS adapter; guard still runs in Pi). Subagent widget terminal-only.
- **D. Hermes Agent.** Not recommended — abandons the harness.

Open question for the user: include Zed/`pi-acp` in Phase 11, or its own optional phase?
