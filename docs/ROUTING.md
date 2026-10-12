# Routing — the role→model map, the mode commands, and the four hard refusals

This file exists so a reader can answer "what model serves the reviewer in
`max` mode, and why can't the executor use Bedrock DeepSeek R1" without
opening `.pi/extensions/routing/`. Phase 5 built three things: an explicit
role→model map with no automatic classification anywhere in it, a capability
guard that refuses four routes that cannot work rather than silently
degrading them, and a delegate tool that hands a whole task to a foreign
agent outside every control this harness builds.

**The contract of this file.** Every claim below carries a `file:line`
citation where one exists in this repository's own source, the same
`[VERIFIED: …]` style `docs/DIAGNOSTICS.md` and `docs/SAFETY.md` use. **If
the code and this document disagree, the code is authoritative and this
document is a bug.** Fix the document; do not fix the code to match the
document.

**Ownership.** `.pi/extensions/routing/` and `.pi/extensions/qoder/` are
Phase 5's subsystem. `tests/unit/routing-map.test.ts` asserts the table below
against `ROLE_MAP` (`.pi/extensions/routing/schema.ts`) in **both**
directions — a row this document names that `ROLE_MAP` does not have, or a
`ROLE_MAP` candidate this document does not name, both fail the build. The
converse half is the one that matters: without it, this document could grow
a row the code does not have, which is exactly how a doc becomes a second
source of truth.

---

## 1. What routing is here

Routing is **three mechanisms, not one**, and which one applies is decided
by the **role**, never per turn — there is no auto-classifier anywhere in
this subsystem. `tests/unit/routing-map.test.ts` pins `routing/schema.ts`'s
exported names against a fixed list and, independently, against a regex for
`classif|detect|infer|guess`, so a future export shaped like a classifier
fails the build before it ships.

- **executor**, plus `/escalate` — a command handler calls `pi.setModel()`
  after `await ctx.waitForIdle()`, which removes the race entirely. The
  mutation is session-visible on purpose: the footer changing is a feature,
  not a side effect — the user can see what they are paying for.
- **reviewer, advisor, vision, summariser** — a single-shot nested completion
  through Phase 2's `callModel()` chokepoint (or Phase 3's
  `callWithFallback()`, which itself calls `callModel()`), with per-call
  reasoning effort and **no session mutation**.
- **planner** — a subagent. It is the one role ROADMAP criterion 4 does not
  explicitly assign, and it needs a tool loop in any realistic reading — it
  reads files — so it cannot be served by one request/response pair.

Every nested single-shot call goes through `callModel()`; nothing in
`routing/` calls the model registry's direct-completion method or its
raw-provider accessor. `tests/unit/chokepoint-lint.test.ts` fails the build
if it does, scanning raw source text with comments included, and grants
`routing/` no exemption.

---

## 2. The role→model table

Generated from `ROLE_MAP` — every mode covers every role explicitly, with no
inheritance or merging between modes: a reader must be able to answer "what
serves `reviewer` in `max`?" from one line. Candidates are **ordered**:
DeepSeek-direct is tried before DashScope for the same model id, because a
model switch needs a target with configured auth on this machine, and the
two providers serve the same model under different credentials — this is
not a second fallback chain, only a preference order for which provider a
caller tries first.

`reviewer` and `advisor` request `"high"` reasoning effort in every mode;
every other role requests none, in every mode. Modes differ by **which
model** serves a role, never by how hard that model is asked to think —
STATE.md's open blocker R1 says `/cheap` must not be defined in terms of a
cheap thinking tier until `RB-03-04` (the DeepSeek "low" effort experiment)
has a result.

| Mode | Role | Candidates (ordered) | Reasoning effort |
|---|---|---|---|
| cheap | executor | `deepseek/deepseek-flash` → `dashscope/deepseek-v4-flash` | — |
| cheap | planner | `deepseek/deepseek-flash` → `dashscope/deepseek-v4-flash` | — |
| cheap | reviewer | `deepseek/deepseek-flash` → `dashscope/deepseek-v4-flash` | high |
| cheap | advisor | `deepseek/deepseek-v4-pro` → `dashscope/deepseek-v4-pro` | high |
| cheap | vision | `amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | — |
| cheap | summariser | `deepseek/deepseek-flash` → `dashscope/deepseek-v4-flash` | — |
| balanced | executor | `deepseek/deepseek-flash` → `dashscope/deepseek-v4-flash` | — |
| balanced | planner | `deepseek/deepseek-v4-pro` → `dashscope/deepseek-v4-pro` | — |
| balanced | reviewer | `deepseek/deepseek-v4-pro` → `dashscope/deepseek-v4-pro` | high |
| balanced | advisor | `amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | high |
| balanced | vision | `amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | — |
| balanced | summariser | `deepseek/deepseek-flash` → `dashscope/deepseek-v4-flash` | — |
| max | executor | `deepseek/deepseek-v4-pro` → `dashscope/deepseek-v4-pro` | — |
| max | planner | `amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | — |
| max | reviewer | `amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | high |
| max | advisor | `amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | high |
| max | vision | `amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | — |
| max | summariser | `deepseek/deepseek-v4-pro` → `dashscope/deepseek-v4-pro` | — |

Both DashScope daily-driver models are `"input":["text"]`
(`.pi/templates/models-template.json`), so `vision` never resolves to
DashScope in any mode — its only real candidate in this table is the one
Bedrock Claude entry verified against this machine's installed `pi-ai`
catalogue on 2026-08-14 (`schema.ts`'s own citation trail).

---

## 3. Commands

- **`/cheap`, `/balanced`, `/max`** — switch the **whole** role→model map:
  the executor's model (via `pi.setModel()`), and — for every role whose
  mechanism is `subagent` (today, only `planner`) — the
  `settings.subagents.agentOverrides` pin those subagents will read. Any
  sticky `/escalate` from before the command ran is cleared as part of the
  switch, because an explicit mode pick is a deliberate re-baseline. Persists
  the mode **name** (not a model id) via a `ky:mode` custom session entry —
  see §5.
- **`/escalate`** (bare, or `on`) — lifts the executor only to `max`'s route,
  **sticky** until explicitly cleared. It does not touch the current mode,
  and it does not touch any other role. Every escalation change also writes
  a durable JSONL record (`escalation-*.jsonl`) naming the previous and new
  executor, so "why was this turn expensive?" has an answer even after the
  session is gone.
- **`/escalate off`** — restores the executor to the current mode's own
  route. Sticky-and-visible was chosen over auto-restore deliberately:
  auto-restore makes a cost spike unexplainable after the fact.
- **`/mode`** — read-only. Prints the current mode, whether `/escalate` is
  active and from which mode, the executor's actual `provider/id` (read from
  the live session, not re-derived), and — for every other role — the model
  it would resolve to right now. Touches no session state.

**A switch that cannot be applied is refused with a reason and leaves the
session exactly as it was.** No configured candidate, a capability-guard
refusal, or `setModel` returning `false` or throwing are all surfaced as an
error message naming the cause; none of them is followed by silently trying
a different model. This is true of every command above — there is no
downgrade path anywhere in this subsystem.

---

### Tool profiles

`pi --ky-profile recon|review|implement|full` narrows the active tool set once, at `session_start`, before the first request. The default is `implement`. An unknown value (matching is case-sensitive, so `Full` is unknown) falls back to `implement` and, when there is a UI, shows a warning naming the value. `full` applies no narrowing. An explicit `--tools`/`-t` allowlist on the command line switches narrowing off entirely, so every tool you name stays declared (`pi --tools read,bash,edit,write,bg_run` keeps `bg_run`). Pi does not expose the allowlist to extensions, so routing detects the flag on the process command line; an SDK caller passing `tools` programmatically is still narrowed. A pi-subagents child is covered only if the package passes its frontmatter tool list as `--tools` on the child's command line; that is not verified offline.

| Tool(s) | recon | review | implement | full |
|---------|-------|--------|-----------|------|
| read, bash, approve_ky_command | yes | yes | yes | yes |
| edit, write, todo | no | no | yes | yes |
| consult_advisor, lsp_diagnostics, lsp_fix | no | yes | yes | yes |
| subagent, bg_wait, subagent_supervisor, subagents_enable | no | yes | yes | yes |
| web_enable | yes | yes | yes | yes |
| web_search, fetch_content, get_search_content, source_check | yes | no | no | yes |
| questionnaire, bg_run, bg_status, bg_logs, bg_kill, qoder_delegate | no | no | no | yes |

Measured per-turn floor (`/budget` formula, from `docs/DIAGNOSTICS.md`): recon 1,773 tok, review 1,900, implement 2,344, full 4,179.

Two rules keep this safe. Pi's registered-but-inactive built-ins (`grep`, `find`, `ls`) are neutral and never removed, because if they are active something chose them. A loadout with neither `edit` nor `write` was already chosen read-only (plan mode, a read-only subagent), so the profile leaves it alone.

A profile is chosen once per session. Changing it means starting a new session, because any mid-session tool change re-prices the cached prefix on DeepSeek and Bedrock. Narrowing applies only to a session with no messages yet: resuming (`pi -c`), forking or `/reload`ing a conversation keeps the loadout its transcript declared, whatever `--ky-profile` says now. Before every prompt the profile is applied once more, but only to tools the transcript has not declared yet, so the request records no removal. That catches a tool switched on after start-up, for example by leaving plan mode: under `implement`, `qoder_delegate` comes back with the pre-plan loadout and is dropped again. Tools that plan mode's read-only loadout already declared (its `bg_*` and `questionnaire` subset) stay, because removing them would re-price the prefix.

---

## 4. The four refusals

Four routes are impossible, and the capability guard (`routing/guard.ts`)
says so **before** dispatch, as a `{ok:false, reason}` value the caller must
read and act on — never a substituted model, never a downgrade.

1. **Image requested against a text-only model.** `model.input` does not
   include `"image"`. Both DashScope daily-driver models are
   `"input":["text"]`, so a `vision` request against either would be refused
   by construction — this is why §2's table routes `vision` to Bedrock Claude
   in every mode instead.
2. **A request larger than the model's context window.** The estimated
   input token count exceeds `model.contextWindow`.
3. **Bedrock, not Claude, with thinking requested.** Pi's own request
   builder (`buildAdditionalModelRequestFields`, pi-ai 0.84.1
   `bedrock-converse-stream.js:889-927`) returns **no thinking field at all**
   for a Bedrock model that is not Claude — **even though the picker still
   offers the thinking level**, because the picker gates on `model.reasoning`
   alone. This is the most dangerous of the four: nothing in the UI hints
   that the setting was silently dropped in transit. The identical Claude
   predicate this guard needs (`isAnthropicClaudeModel`,
   `bedrock-converse-stream.js:542-550`) is not exported from pi-ai's public
   API, so `routing/guard.ts` reproduces it locally rather than importing it
   — a Pi upgrade that moves that predicate will not turn this file red on
   its own; the behaviour is pinned by `tests/unit/capability-guard.test.ts`,
   not by Pi's internals.
4. **Bedrock DeepSeek R1 for a role that needs a tool loop.** Both ids Pi's
   0.84.x catalogue served it under (absent from the Pi 1.1.0 catalogue; the deny-list still guards custom entries) (`deepseek.r1-v1:0` and `us.deepseek.r1-v1:0`)
   support no tool calling at all, and `Model<Api>` carries no field
   anywhere that expresses tool-calling support — so this is an explicit id
   deny-list, not a catalogue predicate, and there is no catalogue field to
   write instead. Scoped by whether the **target role** needs a tool loop
   (derived from `ROLE_MECHANISM`, never by role name), so a tool-less role
   is never over-blocked by a model that happens to be on the deny-list.

---

## 5. What persists, and what it costs

The `ky:mode` custom session entry (`pi.appendEntry("ky:mode", …)`) carries
only the mode name, the `/escalate` flag, `escalatedFrom`, and a timestamp —
**never a model id**. It costs **zero context tokens**: Pi's own
documentation states custom entries do not participate in LLM context
(`docs/extensions.md:1442`), and `tests/integration/mode-persistence.test.ts`
proves it with a positive control alongside the absence claim — the
identical marker string sent as ordinary message content **is** found in the
same captured payload, so the absence assertion is not vacuous.

Pi's own native `model_change` session entry — written on every successful
`setModel()` call — already persists and restores the executor's **actual
model** across a restart; `routing/` never re-implements that. What this
project's own entry restores on `session_start` is strictly narrower: the
mode **name** (because a raw model id alone cannot say whether it came from
`cheap` or `balanced`, if two modes ever share an executor model) and the
`/escalate` sticky bookkeeping.

---

## 6. Qoder: a foreign agent

`qoder_delegate` hands a whole task to Qoder's own hosted agent loop and
folds the result back as tool content. It is registered as a tool — not a
command — because the model must be able to delegate **mid-turn**, and a
skill has no mechanism to make an authenticated HTTP round trip and fold a
streamed result.

**What it bypasses, named in full.** A task handed to Qoder runs inside
Qoder's **own** container, with Qoder's own `Read`/`Write`/`Edit`/`Glob`/
`Grep`/`Bash` tools, entirely outside this harness. None of this project's
own controls apply to that work:

- **Pi's own tools** — Qoder's agent loop does not call them; it has its own.
- **This project's `AGENTS.md` and system prompt** — never sent to Qoder's
  agent; it operates under its own configuration.
- **The Phase 4 safety guard** — branch protection, `terraform`/`kubectl`
  confirmation, `.env`/`*.tfstate` read blocks, the audit log — none of it
  sees or governs what Qoder's agent does.
- **The Phase 2 wire inspector** — no request or response Qoder's own model
  makes is ever captured by this repository's diagnostics; the wire dump and
  the per-turn JSONL are both silent about everything Qoder does.

**On a laptop where merging to `main` auto-deploys to AWS, this means the
harness's guard protects nothing Qoder does on its behalf.** Delegating a
task means trusting Qoder's own agent loop with whatever repository access
its own environment is configured with, outside every control this project
builds. **Treat a delegated result the way you would a pull request from an
unfamiliar contributor — reviewed, never merged on the strength of "an agent
said so."**

**What Qoder is not, stated plainly.** Qoder appears in no `models.json`
entry, no role→model map, no fallback chain and no capability guard anywhere
in this repository — it is not technically possible for it to be a routable
model at all, since Qoder exposes no inference endpoint (verified at
`docs.qoder.com/llms.txt`; Cloud Agents is task orchestration, and the Agent
SDK is a hosted agent loop, not a chat-completions gateway). The only way
the model can reach it is the single registered tool built on top of the
official Cloud Agents HTTP API (`https://api.qoder.com/api/v1/cloud`, a
personal access token in an `Authorization: Bearer` header). The two
unofficial bypass-proxy packages that exist on npm
(`pi-provider-qoder`, `pi-qoder-provider`) are **permanently excluded** —
they reverse-engineer Qoder's undocumented internal endpoints and forge the
signatures that endpoint expects, a breach of Qoder's Terms of Service
(§3.2.6/§3.2.9/§3.2.10) with an irreversible termination clause (§15.2).
Neither is imported, vendored, forked or referenced anywhere in this
repository.

**Configuration.** `QODER_PERSONAL_ACCESS_TOKEN` (a PAT, generated once at
`qoder.com/account/integrations`, shown only once),
`QODER_AGENT_ID` and `QODER_ENVIRONMENT_ID` (a pre-configured agent and
environment — one-time console/API setup, never created per task).

**Two gates, not one.** WR-11 added a human-in-the-loop confirmation on top
of the configuration check above; the two compose as follows:

1. **Unconfigured (any of the three variables unset)** — which is this
   machine's state today and will be CI's state always — the tool is **not
   offered to the model at all**. `qoder_delegate` is registered at load time
   (so this file's own description above still applies once configured) but
   immediately deactivated via `pi.setActiveTools(...)` on `session_start`, so
   it costs no per-request schema tokens and the model cannot call it. There
   is no way to observe the old "refuses actionably, naming what is missing"
   message from a *tool call* on an unconfigured machine — the call is never
   offered in the first place. That refusal text still exists (in
   `resolveQoderConfig`) as a defence-in-depth path, reachable only if the
   deactivation hook itself somehow fails to run.
2. **Configured** — every invocation requires an explicit human selection via
   `ctx.ui.select` ("Delegate to Qoder" / "Cancel") before `delegateTask` is
   ever called, naming the same bypassed-controls statement as this section.
   **Headless and `-p`/`--mode json` refuse by design**: `ctx.hasUI === false`
   is treated identically to an explicit decline — there is no allow-path for
   an unattended run, on purpose (05-CONTEXT.md's security posture). Every
   decision on this branch — approved or declined — is written as a
   `qoder.delegate.confirm` audit record to the same redacted transcript
   `docs/RUNBOOK.md` RB-05-01 describes, never the task text itself.

---

## 7. Limits

What this phase does not prove:

- **Subagent-role routing is not visible in this process's own wire log.**
  A subagent is a separate `pi` process; `planner`'s evidence is the
  `settings.subagents.agentOverrides` write proven in
  `tests/integration/mode-switch.test.ts`, not a wire record.
- **Whether a provider actually honours a requested reasoning effort** is
  `RB-02-01` (one real turn per provider showing the thinking parameters on
  the wire) and `RB-03-04` (the DeepSeek "low" effort experiment) —
  both **OUTSTANDING**.
- **The live Qoder check is `RB-05-01`, OUTSTANDING** — see
  `docs/RUNBOOK.md`. Nothing in this repository's test suite, however green,
  may be read as discharging it: the offline proxy
  (`tests/integration/qoder-delegate.test.ts`) proves the harness parses a
  delegated result shaped like Qoder's documented envelope; it says nothing
  about whether a real personal access token reaches `api.qoder.com`.
