# Orca + Pi harness in a local VM, phone access, no cloud hosting (research 2026-10-14)

Builds on ORCA-DESKTOP-SETUP.md and REMOTE-ORCA-LARK.md; does not repeat them.
Versions checked 2026-10-14: Orca desktop v1.4.224 (2026-10-10), Orca main @ e713bcb (2026-10-12), Orca mobile app.json 0.0.55,
WSL 3.0.3 (2026-10-09), Headscale v0.29.5 (2026-10-13), `@larksuiteoapi/node-sdk` 1.75.0 (2026-10-12), Pi 1.1.0.

## Recommendation
**A (primary): Hyper-V Ubuntu Server VM on the work laptop, headless `orca-ide serve` + Pi + harness inside it; phone and the laptop's
own Orca desktop are both *clients* paired to the VM over LAN or company VPN; Orca Relay off; no Lark.** Strictest no-third-party
path that still gives a phone UI (only Stably's push gateway and the App Store remain, both optional or one-off).
**B (add-on, only if "no cloud hosting" = "we host nothing"): a Lark bot in the same VM over long connection (outbound wss only).**
Accept that every message, card and approval goes through Lark's cloud.
Fallback if IT will not enable Hyper-V: hardened WSL2 (weaker; see the table).

## 1. VM options on a Windows work laptop
| Option | Isolation (FS / net / creds) | Laptop cost | IT friction | Orca in it |
|---|---|---|---|---|
| **Hyper-V** (Win 11 Pro/Ent) | Separate kernel. No shared FS unless Enhanced Session drive/clipboard redirection is on (turn it off). Default Switch is NAT: the VM reaches the internet *and* everything the host can reach, including the corporate VPN. Creds: none unless copied in. **Strong.** | Fixed or dynamic RAM; 2 vCPU / 4 GB is enough for headless Pi + orcad | Admin to enable the feature (+reboot), SLAT + VT in BIOS, user in Hyper-V Administrators. Often already active under VBS/Credential Guard. | Headless `orca-ide serve` (orcad = Node, no display); a GUI desktop guest also works |
| **WSL2** | Shares one utility VM with every distro. **Defaults are weak**: `/mnt/c` automounted (the host's `~/.aws` is readable) and interop on (the guest can run `powershell.exe` as you, a full escape). Harden in `/etc/wsl.conf`: `[automount] enabled=false`, `[interop] enabled=false, appendWindowsPath=false`; non-sudo agent user (root can undo wsl.conf at the next restart). Net: NAT by default, or `mirrored`; the Hyper-V firewall applies (`firewall=true`). **Medium at best.** | Lowest: 50% RAM cap by default (set `memory=`), idles out (`vmIdleTimeout` 60 s, `instanceIdleTimeout` 15 s; set -1) | Admin only on first install; often policy-controlled by Intune (LOW, verify) | Linux `orca-ide serve`. Orca for Windows can also open WSL terminals, but that keeps the runtime on the host: wrong for isolation |
| **VirtualBox 7.2.x** | Full VM; shared folders/clipboard off by default. NAT with easy per-VM port forwards. **Strong.** | Like Hyper-V; slower and less reliable when Hyper-V/VBS is active (runs on the Windows Hypervisor Platform) | Admin to install the kernel driver; corporate EDR often flags it | Same as Hyper-V |
| **VMware Workstation Pro** (free for commercial use since Nov 2024) | Full VM; **strong** | Like Hyper-V; runs on WHP when Hyper-V is on | Admin install, Broadcom account to download, licence review by IT | Same |
| **Windows Sandbox** | Strong kernel isolation, but **disposable**: state is wiped on close; network on by default; one instance only; Windows guest only | Light | Pro/Ent; admin to enable | Unsuitable as an always-on server; testing only |

**Pick Hyper-V.** It is already on the box (Win 11 Pro 26200), is first-party (least IT friction once enabled), and gives real kernel
isolation with nothing shared by default. WSL2 shares too much with the host by design.

**What the VM gets:**
- its own `git clone`, with a GitLab project access token or deploy key at Developer role, so it can push feature branches but cannot touch protected `main`/staging;
- its own Pi `auth.json` holding only model API keys, ideally a separate low-limit DeepSeek/DashScope key;
- **no AWS SSO cache, no admin profile, no `~/.aws` from the host.** If it needs AWS at all, use a read-only SSO permission set or a separate sandbox account, with the shortest session duration;
- no browser profile with corporate SSO cookies;
- a snapshot/checkpoint taken before first use, so you can roll back.

## 2. Orca topology (source: orca main e713bcb, docs/site/content/docs/*.mdx)
- **Headless works.** `orca-ide serve --pairing-address <ip> [--port 6768] --mobile-pairing` prints a mobile QR/link
  (remote-servers.mdx §orca serve; src/cli/specs/serve.ts).
  - It runs on orcad, Orca's Node server, by default. This corrects the earlier "Xvfb + 6 vCPU" estimate.
  - `orca serve service` (systemd) and `--supervise` are Linux/mac only ("not available on Windows yet", serve-service.ts:55). That is another reason for a Linux VM.
- **The laptop's Orca desktop can be a client:** Settings → Remote Orca Servers → Add Server. The VM owns the agents, so the host only provides the UI.
- **Three phone paths:**
  1. Orca Relay (Stably cloud, requires sign-in);
  2. direct `ws://host:6768`, which works over LAN, Tailscale, WireGuard or a VPN ("Address: IP, host:port, ws:// / wss://", mobile.mdx:87);
  3. a tunnel.
  "Sign-in is required for Relay only" (mobile.mdx:42), so **LAN/VPN with no third-party relay is supported.**
  The docs warn: never forward 6768 to the public internet (remote-servers.mdx:120).
- **Pairing and crypto:**
  - The QR offer embeds the server's X25519 public key. Traffic is then encrypted at the application layer with tweetnacl `box` (X25519 + XSalsa20-Poly1305) over plain ws:// (src/main/runtime/e2ee-keypair.ts:1-3, src/shared/e2ee-crypto.ts:11-53).
  - Encrypting at the application layer means scanning the QR in person pins the key, so a middlebox on the VPN cannot read the traffic.
  - Each client gets its own revocable device token. Revoking it under Shared Server Access disconnects the client immediately (remote-servers.mdx:115-118). Pairing links expire after a few minutes.
- **Bind address:**
  - The desktop runtime stays on loopback until something pairs, then binds `0.0.0.0` (runtime-rpc-lifecycle.ts:156-172). The `serve` path binds wide.
  - orcad on its own defaults to `127.0.0.1` and takes literal-IP `--bind` (orcad-bind-address.ts).
  - Restrict access with the VM firewall (ufw: allow 6768 only from the host/VPN subnet).
- **Remaining Stably egress:**
  - push notifications always go to `https://push.onorca.dev`, unless `ORCA_PUSH_GATEWAY_URL` is set (packaged builds; push-gateway-origin.ts:4). Turn notifications off for a strict setup;
  - telemetry: set `ORCA_TELEMETRY_DISABLED=1`;
  - update checks;
  - the app-store install itself.

## 3. Lark bot without cloud hosting
- **Long connection needs no inbound port.** The SDK README (1.75.0) says: "only need to ensure that the running environment has the ability to access the public network, no need to provide public IP or domain name". The bot can run in the VM.
- **Use the SDK's `Channel` module** (`transport: 'websocket'` is the default). It has `dmAllowlist`/`groupAllowlist` and `cardAction` events.
  - Card buttons need a `card.action.trigger` subscription (node-sdk docs/channel.md:61-90, 272).
  - The README still says long connection "does not support callback subscriptions". That contradicts channel.md, so **verify that card clicks arrive over WS** (MEDIUM).
- **Other constraints:** handlers must return within 3 s or Lark re-pushes (process asynchronously and dedupe), and only one client per app receives each event.
- **What leaves the network:**
  - an outbound TLS WebSocket from the VM to Lark's open platform, plus HTTPS API calls to send replies;
  - **the content is plaintext to Lark**: "subsequent event pushes are all plaintext data" inside TLS. Lark is not end-to-end encrypted.
- **What Lark can see and keep** (18-month retention per prior research; tenant admins can audit/export depending on plan, LOW):
  - every prompt you send;
  - every agent reply, including diffs, file paths, error output and any secret that leaks into output;
  - every approval click and your user id.
- **Readings:**
  - "No cloud *hosting*": acceptable. You host nothing, and Lark is a SaaS messenger you already use.
  - "No third-party cloud at all": **Lark is disallowed.** Only Orca over LAN/VPN (relay off, push off) or SSH from the phone qualifies.
  - Honest footnote: the model APIs (DeepSeek, Bedrock) are themselves third-party cloud, and they see more than Lark does. Under the strict reading only local models would comply.

## 4. Phone → VM reachability
- **VM networking first.** Hyper-V's Default Switch NAT is not reachable from outside the host. Choose one:
  - (a) an External switch bridged to Wi-Fi: the VM gets its own LAN IP. Corporate Wi-Fi with 802.1X/NAC may refuse the extra MAC, and a VPN adapter cannot be bridged;
  - (b) **recommended: keep NAT** plus `netsh interface portproxy add v4tov4 listenport=6768 connectaddress=<vm-ip>` (admin), and a Windows Firewall inbound rule scoped to the VPN/LAN subnet. Corporate GPO may disable local firewall rules (LOW, ask IT);
  - (c) WSL2 only: `networkingMode=mirrored` makes VM ports appear on the host's IPs; a Hyper-V firewall rule is still needed.
- **Company VPN:** both the phone and the laptop join the VPN, and the phone dials the laptop's VPN IP:6768 (port-proxied to the VM).
  - Works **only if the VPN allows client-to-client routing.** Zscaler ZPA-style and many GlobalProtect/AnyConnect setups block it (LOW, needs IT).
  - Also needs IT's OK to run a listener on a managed laptop.
- **LAN only:** the phone on the same home Wi-Fi, dialling the laptop's IP. Simplest; works only when you are near the laptop.
- **Headscale v0.29.5:**
  - The control server must be reachable by the phone. On a laptop behind NAT or VPN that means it is only reachable when the phone could already reach the laptop, so it adds nothing.
  - Its default config also pulls Tailscale's public DERP map (`derp.urls: controlplane.tailscale.com/derpmap/default`, config-example.yaml:114), which is a third-party relay. You would have to disable that and run embedded DERP over TLS.
  - Real value only with an always-on public host, which is cloud. **Skip.**
- **Plain WireGuard:** the phone app needs inbound UDP to the laptop. That is fine on a home LAN (pointless there, since LAN already works), and impossible from cellular without a public IP or port forward on the home router.
  - Home-router WireGuard (phone → router → LAN → laptop) is the one no-cloud remote path. It requires the laptop to sit on home Wi-Fi and IT to tolerate it.
- **Sleep or lid closed:** the VM pauses with the host, Modern Standby drops networking, and the phone shows "can't reach desktop" (mobile.mdx:113). Agents stop mid-turn.
  - Lark long connection drops too; Lark re-pushes undelivered events briefly, and messages sent while asleep may be lost or late.
  - Fixes: plug in, set "lid close: do nothing" and sleep "never" on AC (IT policy may override); in the VM, set Hyper-V Automatic Stop Action = Save.
  - Without an always-on box, the honest summary is: **remote control only while the laptop is awake and on a reachable network.**

## 5. Safety
- **The guard runs unchanged in the VM.** Pi 1.1.0 on Linux, POSIX sh, unbash parsing.
- **Confirms do reach the phone:**
  - `canConfirm` already accepts `ctx.hasUI && (mode === "tui" || "rpc")` (.pi/extensions/safety/index.ts:44-46), with a 300 s confirm timeout that refuses (index.ts:41).
  - Orca chat mode turns `ctx.ui.confirm` into a phone approval card. Terminal mode shows the TUI prompt in the phone's terminal view.
  - The questionnaire still refuses outside the TUI (prior research).
- **Risks:**
  - **phone loss or theft:** an unlocked phone holds an Orca device token and a Lark session;
  - **session hijack:** a stolen device token, a Lark account takeover, or a QR/link photographed during pairing;
  - **prompt injection:** Lark messages forwarded from others, or links pasted into chat, plus repo/web content read by the agent, steering it toward exfiltration via `curl` or git push;
  - **approval fatigue:** small screen plus "approve" taps;
  - **the VM reaching corporate internal hosts:** NAT goes through the host's VPN;
  - **Orca's own git buttons bypass Pi's guard:** only server-side branch protection stops them.
- **Mitigations:**
  - in the VM, no AWS admin credentials and a token that cannot push `main`. Least privilege matters more than any prompt;
  - a fixed Lark open_id allowlist (empty = deny), DMs only, ignore forwarded messages;
  - every push/terraform/mutating `aws`/`kubectl` call confirms, with no "always allow" from the phone;
  - **read-only by default from the phone:** start remote sessions in plan mode or a read-only profile, and require an explicit, expiring unlock (needs harness design);
  - revoke Orca grants and use the `/stop` kill switch when the phone is lost; enable phone biometrics on the app;
  - VM egress firewall: allow only model APIs, git host, Lark and package mirrors; block RFC1918/corporate ranges except the host's port-proxy;
  - redact secrets in bot output and keep an approval audit log;
  - roll back the VM snapshot after an incident.

## 6. Architectures
**A, Hyper-V VM + Orca (no third party except optional push):**
1. IT approval: Hyper-V enable plus a listener on 6768.
2. Ubuntu Server 24.04 VM, 2 vCPU / 4 GB, Default Switch, Enhanced Session off, checkpoint.
3. Install Node ≥22.19, Pi 1.1.0 and the harness; set up a scoped git token and a model-only auth.json.
4. Install the Orca Linux build pinned to v1.4.224. Set `ORCA_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, and (optionally) a dummy `ORCA_PUSH_GATEWAY_URL`.
5. Run `orca-ide serve --port 6768 --pairing-address <laptop-VPN-or-LAN-IP> --mobile-pairing` under systemd; ufw restricts 6768.
6. On the host, set up portproxy plus a scoped firewall rule.
7. Pair the phone by scanning the QR in person, with Relay off; pair the laptop's Orca desktop as a client.
8. Test a feature-branch push confirm from the phone, test revocation, test sleep behaviour.

**B, add a Lark bridge (author ~400-600 lines, Hermes design, per REMOTE-ORCA-LARK.md):**
1. Create a Lark (larksuite.com) self-built app with `Domain.Lark`.
2. Run the Channel module over websocket with a dmAllowlist, a `card.action.trigger` subscription, and the bot driving `pi --mode rpc`.
3. Set up an egress allowlist entry for open.larksuite.com.

## Open questions for the user
1. Will IT enable Hyper-V and allow an inbound listener and portproxy? If not, accept hardened WSL2?
2. Which reading: "no cloud hosting" (Lark OK) or "no third-party cloud" (Lark out, push off)?
3. Does the company VPN allow phone-to-laptop (client-to-client) traffic, and may a personal phone join it?
4. Is phone use needed away from the home LAN? If so, without an always-on host only the VPN or a home-router WireGuard works.
5. Does the VM need any AWS access? If yes, can a read-only permission set or a sandbox account be created?
6. Is "laptop must stay awake and plugged in" acceptable?

## Sources
- Orca repo stablyai/orca @ e713bcb: docs/site/content/docs/{ways-to-run,remote-servers,mobile,terminal}.mdx; src/main/runtime/e2ee-keypair.ts, src/shared/e2ee-crypto.ts, runtime-rpc/runtime-rpc-lifecycle.ts, orcad/orcad-bind-address.ts, push/push-gateway-origin.ts, cli/specs/serve.ts, cli/handlers/serve-service.ts (HIGH)
- WSL config: https://learn.microsoft.com/en-us/windows/wsl/wsl-config (updated 2026-09-16) (HIGH)
- Windows Sandbox: https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/ (2026-10-08) (HIGH)
- Hyper-V requirements: https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v (HIGH)
- VMware free commercial: https://www.virtualizationhowto.com/2024/11/vmware-workstation-pro-now-free-for-all-users-even-businesses/ (MEDIUM)
- VirtualBox 7.2 + Hyper-V: https://www.phoronix.com/news/VirtualBox-7.2-Released (MEDIUM; performance under Hyper-V unmeasured)
- Lark SDK: github.com/larksuite/node-sdk README §Long Connection + docs/channel.md; npm 1.75.0 (HIGH; card-over-WS MEDIUM)
- Headscale: github.com/juanfont/headscale config-example.yaml, v0.29.5 (HIGH)
- Corporate VPN client-to-client, Intune WSL policy, GPO firewall merge: general knowledge (LOW, ask IT)

## 7. EC2 alternative: RUNBOOK ONLY (nothing is launched by any agent; the user applies every step)
Prices are AWS public price list, ap-southeast-1, on-demand Linux, publication 2026-10-12 (EC2) / 2026-09-17 (VPC), effective 2026-10-01; 730 h/month.

**Architecture: Graviton (arm64) is supported end to end.**
- Orca v1.4.224 ships `orca-ide_1.4.224_arm64.deb`, an aarch64 rpm and an arm64 AppImage (release assets), and orcad prebuilds are built for ARM64 (.github/actions/prepare-orcad-prebuilds/action.yml:33).
- Pi 1.1.0's dependencies are pure JS + WASM (photon-node, quickjs-wasi), so it is arch-neutral.
- Arm64 is about 20% cheaper than x86 here: t4g.large $0.0848/h vs t3.large $0.1056/h.

**Size for one user** (Pi + headless `orca-ide serve` + Node + git + the vitest suite at `--maxWorkers=2`):
| | Type | vCPU/RAM | $/h | 24/7 | Schedule 10 h × 22 d (220 h) |
|---|---|---|---|---|---|
| Minimum | t4g.large | 2 / 8 GiB | 0.0848 | $61.90 | $18.66 |
| **Recommended** | **t4g.xlarge** | 4 / 16 GiB | 0.1696 | $123.81 | $37.31 |
| Sustained CPU | m8g.xlarge | 4 / 16 GiB | 0.2244 | $163.81 | $49.37 |

- t4g runs in unlimited mode by default, so a full-suite burst above baseline costs $0.04/vCPU-h in surplus credits. That is cents per run, and acceptable for occasional 3–10 minute runs. If the full suite runs many times a day, use m8g.
- **Disk:** gp3 40 GiB at $0.096/GB-mo = $3.84/mo. The free baseline of 3,000 IOPS / 125 MB/s is ample, so provision no extra (extra would be $0.006/IOPS-mo). EBS bills even while the instance is stopped.

**Account and network:**
- a **separate dev/sandbox account** in the org, never the auto-deploy account, with SCPs denying IAM user/key creation;
- a VPC with **private subnets only and no public IP** (public IPv4 would be $0.005/h ≈ $3.65/mo, and is a needless exposure);
- an instance profile allowing only `bedrock:InvokeModel` + `bedrock:InvokeModelWithResponseStream` on the specific `apac.` inference-profile ARNs **and** the underlying foundation-model ARNs in each apac destination region (cross-region profiles require both; MEDIUM, verify against the Bedrock IAM docs), plus `AmazonSSMManagedInstanceCore`;
- no access keys and no admin role;
- IMDSv2 required, hop limit 1.

**NAT vs VPC endpoints.** The counter-intuitive finding is that endpoints cost about the same as NAT:
- Interface endpoints are $0.013/h per AZ + $0.01/GB. Bedrock-runtime + ssm + ssmmessages + ec2messages = 4 × $9.49 = **$37.96/mo in one AZ, billed 24/7 even when the instance is stopped**.
- A NAT gateway is $0.059/h + $0.059/GB = **$43.07/mo + data**, also 24/7.
- Endpoints alone give **no internet**. That means no npm, no GitLab/GitHub (unless routed via the company VPN), no DeepSeek/DashScope APIs, no Lark long connection, and no Orca/apt updates.
- So the harness, which uses cheap non-Bedrock models, needs egress anyway.
- **Recommendation:** use SSM endpoints only if policy forbids NAT. Otherwise use a single-AZ NAT gateway, or for a personal sandbox a t4g.nano NAT instance ($3.87/mo, self-patched). Either way, add a free S3 gateway endpoint (Amazon Linux repos) and an egress allowlist (security group / Network Firewall is extra cost) covering model APIs, git host, npm, Lark and Bedrock.
- Note that the Bedrock endpoint saves only NAT per-GB on Bedrock traffic.

**Access:**
- SSM Session Manager for the shell; `aws ssm start-session --document-name AWS-StartPortForwardingSession` to forward 6768 to the laptop's Orca desktop. No inbound security group rules.
- **Phone, option 1: company VPN → instance.** Needs a site-to-site/Transit Gateway route from the corporate network to the dev VPC (IT-owned; ~$0.05/h per attachment, LOW), plus a security group allowing 6768 from the VPN CIDR only. Pair Orca mobile directly with Relay off.
- **Phone, option 2: a Lark long-connection bot on the instance.** Needs NAT egress; Lark still sees all content (§3).
- The instance does not sleep with the laptop, which is its main advantage.

**Operations:**
- **Backups:** a DLM daily EBS snapshot policy keeping 7 snapshots at $0.05/GB-mo, incremental, likely under $1/mo. Keep the code in git, so the disk is disposable.
- **Patching:** SSM Patch Manager baseline with a weekly maintenance window, or `dnf-automatic`/`unattended-upgrades`. Pin Orca and Pi versions and upgrade them deliberately.
- **Schedule:** EventBridge Scheduler calling `ec2:StopInstances`/`StartInstances` on weekdays, e.g. 09:00–19:00 SGT, plus a CloudWatch alarm that stops the instance when CPU stays under 5% for 60 minutes. Scheduler is effectively free at this volume (LOW).
- Set an AWS Budgets alert at $50.

**Monthly total, recommended** (t4g.xlarge scheduled + 40 GiB + snapshots + NAT gateway 24/7): about **$37 + $4 + $1 + $43 ≈ $85**. With a NAT instance instead: about **$46**. Running 24/7: about $172 (NAT GW) or $132 (NAT instance).
- This **breaks the "zero spend beyond tokens" constraint** unless the company pays.

**Laptop VM vs EC2:**
| | Laptop Hyper-V VM | EC2 dev account |
|---|---|---|
| Cost | $0 | ~$46–85/mo scheduled |
| Isolation from host AWS SSO | Good (separate kernel, nothing shared) | Best (different machine and account; role-only creds) |
| Available when the laptop sleeps | No | Yes |
| Phone path | LAN or company VPN, if client-to-client is allowed | Company VPN, if routed to the VPC; or Lark |
| IT asks | Enable Hyper-V, inbound listener | New account/VPC, VPN route, budget approval |
| "No cloud hosting" | Satisfied | **Violates it**: this is cloud hosting, just in your own account |

**Verdict:** the laptop VM is the default because it is free and satisfies "no cloud hosting". Choose EC2 only if always-on availability matters and the company funds a sandbox account.

### Sources for section 7
- EC2 prices: b0.p.awsstatic.com meteredUnitMaps ec2-ondemand Asia Pacific (Singapore) Linux, hawkFilePublicationDate 2026-10-12 (HIGH)
- NAT GW / gp3 / IOPS / snapshot / t4g credit: pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-southeast-1/index.csv, Last-Modified 2026-10-12, effective 2026-10-01 (HIGH)
- VPC endpoints: .../AmazonVPC/current/ap-southeast-1/index.json, publicationDate 2026-09-17 (HIGH); public IPv4 $0.005/h: https://aws.amazon.com/vpc/pricing/ (HIGH)
- Orca arm64: GitHub release v1.4.224 asset list (HIGH); Pi 1.1.0 deps: `npm view @earendil-works/pi-coding-agent@1.1.0 dependencies` (HIGH)
- Bedrock cross-region IAM, ec2messages-endpoint necessity, Scheduler cost, TGW/VPN cost: not re-verified this session (LOW/MEDIUM)
