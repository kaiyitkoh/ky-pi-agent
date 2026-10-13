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

`pi --ky-profile recon|review|implement|full` narrows the active tool set at session start, and on each idle prompt to tools the transcript has not declared (see below). The default is `implement`. An unknown value (matching is case-sensitive, so `Full` is unknown) falls back to `implement` and, when there is a UI, shows a warning naming the value. `full` removes only the `bg_enable` loader, because every tool it loads is already active there. An explicit `--tools`/`-t` allowlist on the command line switches narrowing off entirely, so every tool you name stays declared (`pi --tools read,bash,edit,write,bg_run` keeps `bg_run`). Pi does not expose the allowlist to extensions, so routing detects the flag on the process command line; an SDK caller passing `tools` programmatically is still narrowed. A pi-subagents child is covered only if the package passes its frontmatter tool list as `--tools` on the child's command line; that is not verified offline.

| Tool(s) | recon | review | implement | full |
|---------|-------|--------|-----------|------|
| read, bash, approve_ky_command | yes | yes | yes | yes |
| edit, write, todo | no | no | yes | yes |
| bg_enable | no | no | yes | no |
| consult_advisor, lsp_diagnostics | no | yes | yes | yes |
| lsp_fix | no | no | no | yes |
| subagent, bg_wait, subagent_supervisor, subagents_enable | no | yes | yes | yes |
| web_enable | yes | yes | yes | yes |
| web_search, fetch_content, get_search_content, source_check | yes | no | no | yes |
| questionnaire, bg_run, bg_status, bg_logs, bg_kill | no | no | on demand | yes |
| qoder_delegate | no | no | no | yes |

Measured per-turn floor (`/budget` formula, from `docs/DIAGNOSTICS.md`): recon 1,699 tok, review 1,827, implement 2,342, full 4,106. Under `implement`, `questionnaire` and the `bg_*` tools are loaded on demand by the `bg_enable` loader (`routing/loader.ts`, 90 tokens): the model calls it, and the tools, plus background-tasks' shell-policy prompt section, appear on its next request. Carrying them by default would cost about 1,835 tokens on every turn, the same as `full`. The loader has no prompt metadata of its own; activating the bg tools rebuilds the system prompt once, as any lazily loaded tool with prompt metadata does.

Two rules keep this safe. Pi's registered-but-inactive built-ins (`grep`, `find`, `ls`) are neutral and never removed, because if they are active something chose them. A loadout with neither `edit` nor `write` was already chosen read-only (plan mode, a read-only subagent), so the profile leaves it alone.

A profile is chosen once per session. Changing it means starting a new session, because any mid-session tool change re-prices the cached prefix on DeepSeek and Bedrock. Narrowing applies only to a session with no messages yet: resuming (`pi -c`), forking or `/reload`ing a conversation keeps the loadout its transcript declared, whatever `--ky-profile` says now. Before every prompt you type or a command sends, the profile is applied once more, but only to tools the transcript has not declared yet, so the request records no removal. This runs on Pi's `input` event, before any extension builds the system prompt, so no prompt section (such as background-tasks' shell policy) is written for a tool it drops. A message queued while the agent is running is left alone. That catches a tool switched on after start-up, for example by leaving plan mode with `/plan-mode` and then typing: under `implement`, `qoder_delegate` comes back with the pre-plan loadout and is dropped again. Tools that plan mode's read-only loadout already declared (its `bg_*` and `questionnaire` subset) stay, because removing them would re-price the prefix.

Turns an extension starts itself with `triggerTurn` are **not** narrowed, because Pi starts them without emitting `input`. These include plan mode's "Execute the plan" choice, loop-police's nudges and background-tasks' completion follow-ups. The one that matters is plan mode under `--plan`: plan mode saves its pre-plan loadout before routing narrows it, so choosing "Execute the plan" declares the full loadout (`bg_run`, `qoder_delegate` and the rest) and the transcript keeps it for the rest of the session. To keep the profile's cost, leave plan mode with `/plan-mode` and type the next prompt instead, or start without `--plan` and enter plan mode later. `tests/integration/tool-profiles.test.ts` pins this behaviour, so a fix will fail that test and has to update it.

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
3. **Thinking requested on a Bedrock reasoning model whose request carries
   none.** Pi's request builder (`buildAdditionalModelRequestFields`, pi-ai
   1.1.0 `bedrock-converse-stream.js:1011`) emits a thinking field for Claude
   and for models whose id or name contains `gpt-` (including `gpt-oss`), and
   **nothing at all** for every other Bedrock reasoning model — **even though
   the picker still offers the thinking level**, because the picker gates on
   `model.reasoning` alone. Nothing in the UI hints that the setting was
   silently dropped in transit. Claude and `gpt-` models are therefore not
   refused. The Claude predicate (`isAnthropicClaudeModel`) is not exported
   from pi-ai, so `routing/guard.ts` reproduces it locally; the behaviour is
   pinned by `tests/unit/capability-guard.test.ts`, not by Pi's internals.
4. **Bedrock DeepSeek R1 for a role that needs a tool loop.** Any id ending
   in `deepseek.r1-v1:0`, under any inference-profile prefix (`us.`, `eu.`,
   `global.` and so on). Pi 1.1.0's catalogue no longer carries it; the rule
   still guards a custom `models.json` entry. R1 supports no tool calling at
   all, and `Model<Api>` carries no field expressing tool-calling support, so
   this is an id rule, not a catalogue predicate. Scoped by whether the
   **target role** needs a tool loop (derived from `ROLE_MECHANISM`, never by
   role name), so a tool-less role is never over-blocked.

### Where the guard runs

`deriveNeed(ctx, extra)` in `routing/guard.ts` builds the executor's guard
input from the live session: estimated tokens (current context usage plus the
prompt length divided by four plus any extra), whether the thinking level is
anything but `off`, and the tool-loop flag. The image need comes only from the
images attached to the prompt being sent, never from session history: for a
text-only model pi-ai already replaces earlier images with a placeholder
(pi-ai 1.1.0 `dist/api/transform-messages.js`), so an old screenshot never
blocks a mode switch. The mode commands and `/escalate` check the candidate
with it before switching.

Nested single-shot roles (reviewer, advisor, refutation, design review) never
use the session's need. `runSingleShotRole` builds it with `nestedNeed` from
the request it is about to send: its own messages, system prompt and tools
(characters divided by four), any image in those messages, and the route's
`reasoningEffort`. A long main session therefore never refuses an advisor
call, and the session's thinking level never decides a nested call.

The built-in `/model` picker and `Ctrl+P` bypass those commands, and Pi's
`model_select` event is notification-only in Pi 1.1.0 (`types.d.ts:859-866`):
it fires after the switch and its return value is ignored. Enforcement is
therefore undo plus refuse:

- On `model_select` with source `set` or `cycle`, the executor guard runs on
  the new model. If it refuses, the previous model is restored with one
  `setModel` call, guarded against re-entry, and the message says whether the
  revert worked and which thinking level the session now has (Pi applies the
  per-model or global default on every switch). A failed revert is reported as
  failed. The previous model is only restored if it passes the guard itself.
- A Bedrock reasoning model that fails only the thinking block is kept and its
  thinking is set to `off`: Pi resets thinking on every switch, so the user
  could never turn it off first.
- If the refused model is also the saved default (the picker's "set as
  default" persists before `model_select` fires, and an extension cannot write
  Pi's default), the message says so: the next start would boot on it.
- A `restore` event (resuming a session) is never reverted.
- An `input` handler refuses an interactive prompt (`{ action: "handled" }`)
  whenever the current model fails the image, thinking or R1 block, which
  covers a restored session and any switch the revert could not undo. A
  context larger than the window only warns and points at `/compact`; Pi's
  own compaction and retry handle it. Prompts an extension sends
  (`source: "extension"`) are checked the same way: `/grill`, `/plan` and
  third-party follow-ups run no guard of their own. `/quick` and `/execute`
  guard before they arm, so the backstop only refuses their prompt when the
  model changed in between; the run then stays pending, records nothing, and
  the next prompt disarms it. Slash commands run before `input`, so
  `/cheap`, `/balanced` and `/max` always remain available to recover.
- An internal error in either handler is swallowed: a guard bug must not
  brick a session.

### Bedrock inference profiles

The Bedrock Claude route (vision, and advisor in `balanced`/`max`) is written
once in `routing/schema.ts` as the bare id
`anthropic.claude-sonnet-4-5-20250929-v1:0`. The id actually requested is the
inference-profile prefix plus that id, taken from the setting
`kyPiAgent.bedrockProfilePrefix` in `<agent-dir>/settings.json`:

- absent: `apac.`
- `""`: the bare id
- any other value must match a lower-case region prefix such as `us.` or
  `global.`; anything else refuses the Bedrock candidate with a message naming
  the setting.

Pi 1.1.0's catalogue carries Sonnet 4.5 under the bare id and the `au.`,
`eu.`, `global.`, `jp.` and `us.` prefixes, but not `apac.`. The template
`.pi/templates/models-template.json` therefore adds an
`apac.anthropic.claude-sonnet-4-5-20250929-v1:0` model (its name contains
`claude` so prompt caching and thinking match). When a prefixed id cannot be
found the refusal names the setting and lists the catalogue prefixes. Whether
AWS serves the apac profile in your account is a live check on the work
laptop, recorded in `docs/RUNBOOK.md` (RB-12-06).

### Planner pin

`/cheap`, `/balanced` and `/max` write `subagents.agentOverrides` into the
user-level settings file, which every repo shares. A Bedrock Claude pin gets
the same inference-profile prefix as routing (`resolveBedrockRef` in
`routing/modes.ts`), so `/max` pins the id Bedrock actually serves; an invalid
prefix setting refuses the pin.

The pin is merged per agent key, so overrides the user set for other agents
stay. The marker `kyPiAgent.plannerPinRestore` in the same file records, for
each key a pin changed, its value before the first pin, plus `owners`: the
pid of each session that pinned and when it last wrote the pin. When a session
ends (not on `/reload`), and at every session start, the process removes its
own entry, every pid that is no longer running, and every owner that has not
written the pin for 24 hours, even if its pid still answers. Windows reuses
pids quickly, and a service process's pid answers `EPERM`, which reads as
alive, so a bare pid check could keep a crash-left pin forever. A session
refreshes its time whenever it pins, at session start or on a mode switch.
Only when no owner is left are the pinned keys restored; overrides added
during the session are kept. So:

- a subagent child never touches the pin (it skips the bookkeeping when
  `PI_SUBAGENT_CHILD=1`, and is never an owner anyway);
- a second terminal starting or ending does not restore a live session's pin;
- a crash-left marker is cleaned by the next process that starts, or after
  24 hours at the latest.

A session never runs on someone else's pin without saying so. At session
start, while any session's pin is in the file, a session writes its own
mode's pin, the default `cheap` included; with no pin in the file a `cheap`
session writes nothing. A pin prefers the first candidate that resolves, has
configured auth and passes the guard, and falls back to the first
guard-passing candidate when none is configured. `/mode` reads the planner the
settings file actually pins and, when it differs from the pin that re-running
the mode command would write (the same picker), says which model subagents run
and that re-running the mode command re-pins it.

A fresh session and `/new` start in the default mode, unescalated, and apply
its executor, unless a model was chosen explicitly: `--model`, `--provider` or
`--models` on the command line, or a saved `defaultModel` or `defaultProvider`
in the user or project settings. In that case the chosen model is kept, a
notice names the source, and `/cheap` applies the default route. The switch is
never persisted.

The file is still shared: when two sessions are in different modes, the last
writer's models apply to both until one switches again or a new session
starts. A session idle for more than 24 hours without a mode switch loses its
ownership, as does one whose recorded time is over a minute in the future
(the clock stepped back), so a later process may restore the user's own
overrides under it, whatever model those name. The
read-modify-write of the file is not locked across processes: two sessions
starting or ending in the same instant can lose one owner entry, and the pin
is then restored early to the user's own override or held until the 24-hour
expiry.

### Accepted decisions

- **The planner role is never dispatched by `/plan`.** `/plan` runs on the
  session model. Wiring a role call into `plan-ceremony/index.ts` would push
  that file past its frozen 200-line ceiling (it is 155 lines today), so the
  planner row in §2 only shapes the subagent pin.
- **Turns started with `triggerTurn` are not narrowed by tool profiles**,
  because Pi emits no `input` for them (see §3). Accepted as a limitation.
- **Tool profiles.** `lsp_fix` is only in `full`; `questionnaire` and the
  `bg_*` tools are loaded on demand in `implement` through `bg_enable`
  (§3); `qoder_delegate` is only in `full` because it is a paid,
  confirm-gated remote delegate.

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
