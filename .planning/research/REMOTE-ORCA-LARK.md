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

## Follow-up (2026-10-13): EC2 host, Orca self-hostability, Lark vs Feishu
- Host: EC2 fits (Pi is CPU-light). t4g.small ~$12/mo, t4g.medium ~$25/mo 24/7 (us-east-1; SG ~+26%); stopped ≈ $2-5/mo disk. Orca headless needs Xvfb, ~6 vCPU/12 GB (~$120+/mo, unverified), arm64 unverified. Lightsail $12/$24 simpler. Fargate poor fit; Cloud9 closed to new customers.
- MUST be a separate dev account/VPC, not the auto-deploy account; least-privilege instance role; zero inbound (SSM + Tailscale / Lark long-connection). Needs company approval; changes "zero spend" if company-billed.
- Orca: `orca serve` headless on Linux; LAN/Tailscale pairing needs no account; relay optional (`ORCA_RELAY_URL`, unofficial self-host); push always via push.onorca.dev (`ORCA_PUSH_GATEWAY_URL`, no self-host); telemetry off via `ORCA_TELEMETRY_DISABLED=1`. Verdict: self-hosted enough with Tailscale pairing + telemetry off + push off/accepted.
- Lark (Singapore entity, larksuite.com, open.larksuite.com) vs Feishu (Beijing, feishu.cn, open.feishu.cn); separate tenants. Node SDK defaults to Feishu; Lark needs `domain: Domain.Lark`. Check: app name / login URL / admin console domain.

## Hermes Lark design + bridge recommendation (2026-10-13)
- Hermes: `plugins/platforms/feishu/adapter.py` (Python, lark-oapi), long-connection default, `FEISHU_DOMAIN=lark`, `FEISHU_ALLOWED_USERS` allowlist, approval cards (Allow once/session/always/deny) verified by clicker+chat, 5-min timeout=deny, per-chat sessions, secrets in env.
- Existing Pi bridges unsuitable: `pi-feishu-connector` (~10k lines, empty allowlist + first-DM-becomes-owner, regex approvals bypassing Pi confirm) ; `pi-feishu` (~1.9k lines, no allowlist).
- Recommendation: author ~400-600-line bridge on `@larksuiteoapi/node-sdk` (pinned), Hermes design. Must-haves: long-connection only; fixed allowlist, empty=deny; DMs only; approval cards wired to Pi ctx.ui.confirm/select (guard stays sole gate) with clicker/chat/dedupe/5-min-deny; no "always" from phone; secrets via env; per-chat session + /stop kill switch; secret redaction + rate/size limits; audit log of approvals.
- Orca over company VPN: likely works (any reachable address, port 6768, ws://) unless VPN client isolation; check IT policy.
