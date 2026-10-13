# Remote control: Orca + Lark (research 2026-10-13, awaiting user decisions)

- Orca = stablyai/orca (MIT, ~90.8k★, desktop v1.4.224 2026-10-10, iOS + Android). Multi-agent desktop app, git worktrees; Pi supported natively.
- Pi modes in Orca: terminal (full TUI, Orca injects a status extension via separate Pi settings dir — VERIFY harness + user-level skills still load) and chat (`pi --mode rpc`; approvals enforced by Pi → our guard; confirm/select/input become phone approval cards; setStatus/widgets/notify dropped; custom-TUI questionnaire likely not rendered — VERIFY).
- Phone link: Orca Relay (Stably-hosted GCP, sign-in, cost/E2E unverified, not self-hostable) or direct LAN/Tailscale pairing (self-hosted, free). Push notifications always via push.onorca.dev.
- Orca has no Lark/Feishu support. Lark long-connection (WebSocket) mode needs no inbound port (`@larksuiteoapi/node-sdk` 1.75.0).
- Pi↔Feishu bridges: `pi-feishu-connector` 0.3.0 (MIT, allowlists + strict approval, 0★, low adoption) best design; `pi-feishu` 1.1.5 (Lark intl domain, no allowlist); others rejected (no source / UNLICENSED).
- Lark Starter free ≤20 users but 10,000 API calls/month; chat history retained 18 months; data residency unverified.
- Safeguards: remote = strict mode (every push/terraform/mutating AWS needs explicit approval), allowlisted identity/device, kill switch + auto-expiry, secret redaction to chat/push, short SSO sessions / read-only profile, exact pins + source review.
- Options: A Orca+Tailscale (low effort, recommended first); B Lark bot→Pi RPC (medium); C both.
- Related pending: git push rule → ask-for-approval on feature branches, hard block main/staging/--force, refuse when no UI.
