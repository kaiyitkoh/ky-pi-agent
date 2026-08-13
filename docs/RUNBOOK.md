# Runbook — checks that cannot be executed on the development machine

This file exists because some things cannot be proven from a desk. A check
lands here when it needs the work laptop, a clean Pi profile, network egress,
an interactive terminal, or live credentials — none of which the development
machine can supply honestly.

**The contract of this file.** Every entry carries four things:

1. the **exact command**, copy-pasteable, with no placeholder to guess at;
2. the **expected output**, specific enough that "it seemed fine" is not an
   acceptable result;
3. the **offline proxy** — the test in this repo that verifies as much of the
   behaviour as can be verified without the missing thing, so the residual
   uncertainty is narrow and named;
4. a **status line**, which is either `OUTSTANDING` or a date-stamped
   `PASSED — YYYY-MM-DD`.

An entry with no status line is a bug in this file. A status may only move to
passed by a human who actually ran the command and read the output; it may
never be inferred from a green unit test, because the unit test proves the
classifier and not the machine. `tests/unit/docs-policy.test.ts` enforces the
Phase 1 statuses mechanically, so flipping one is a deliberate edit that
breaks the suite until the test is updated in the same change.

**Ownership.** `docs/RUNBOOK.md` is formally a Phase 3 deliverable (PROV-09),
and later phases append their own sections to it. Phase 1 creates the file
early rather than waiting, because three Phase 1 checks would otherwise be
lost between now and then — and a check nobody wrote down is a check nobody
runs.

---

## Phase 1 — Bootstrap, Packaging & Supply Chain

| ID | Check | Status |
|----|-------|--------|
| RB-01-01 | SAFE-16 — `gh` left unauthenticated on the work laptop | OUTSTANDING |
| RB-01-02 | BOOT-02 — `pi install` against the real GitHub URL on a clean profile | OUTSTANDING |
| RB-01-03 | BOOT-05 — `/reload` re-registers the extension | OUTSTANDING |

### RB-01-01 — SAFE-16: `gh` left unauthenticated on the work laptop

**Status:** OUTSTANDING

**Why this cannot be done here.** `gh` is legitimately authenticated on the
development machine. The git remote is HTTPS and no SSH key exists, so the
`gh` credential is how this repository is pushed; logging out here would break
git access and prove nothing. The control matters on the **work laptop**,
which holds the credentials worth protecting.

**What the control is.** Pi's `/share` exports the entire session transcript
to a temporary file and posts it as a secret gist. It cannot be blocked by any
extension — it is matched as a literal string in the interactive submit
handler and dispatched before extension commands and before the `input` event.
The one branch that stops it is Pi's own `gh auth status` check: when that
exits non-zero, `/share` shows an error and returns *before* the transcript is
written to disk. So `gh auth status` exiting non-zero **is** the entire
control.

**Procedure, on the work laptop:**

1. `sh scripts/check-gh-unauthenticated.sh`
   Run it **bare** — not `--warn-only`, which is the development-machine mode
   that reports the risk and continues. Expect exit status **1** and the
   message `gh IS authenticated. /share can upload this session to a GitHub
   gist.` on stderr.
2. `gh auth logout`
3. `sh scripts/check-gh-unauthenticated.sh`
   Expect exit status **0** and `OK: gh is unauthenticated; /share aborts
   before export.` on stdout.
4. Start a real interactive Pi session and type `/share`. Expect it to abort
   with `GitHub CLI is not logged in. Run 'gh auth login' first.` and to write
   nothing.

**Closed door — do not re-litigate.** `gh auth refresh --remove-scopes gist`
cannot be used to keep `gh` usable for git-over-HTTPS while removing the gist
capability. `gh auth refresh --help` states that the minimum set of scopes —
`repo`, `read:org` and `gist` — cannot be removed. `gh auth logout` is the
only remedy.

**Cost of applying it.** On a machine using git-over-HTTPS, logging out also
removes the git credential. Set up SSH first if that machine needs to push.

**Offline proxy:** `tests/unit/gh-unauthenticated.test.ts` — drives the
classifier script against stubbed `gh` binaries in both directions and asserts
the stub's own call log, so a PATH-ordering mistake cannot silently turn the
test into an assertion about the developer's real keyring. It proves the
classifier is correct. It says nothing about the work laptop's state.

### RB-01-02 — BOOT-02: `pi install` against the real GitHub URL on a clean profile

**Status:** OUTSTANDING

**Why this cannot be done here.** It needs a Pi profile with no prior state
and network egress to GitHub. The development machine's profile already has
this repository's packages and trust decisions recorded, so an install here
would exercise the update path rather than the first-install path.

**Procedure:**

1. Start from a clean profile, or point Pi's agent directory at an empty one:
   `export PI_CODING_AGENT_DIR=/tmp/pi-clean-check`
2. `pi install https://github.com/kaiyitkoh/ky-pi-agent`
3. `pi --list-models`

**Expected output:** the sentinel model id `ky-harness-selftest` appears in the
model list. Its presence is the proof that the package manifest resolved, the
extension directory was collected, and the extension loaded.

**Undo:** `pi remove <source>`, where `<source>` is the URL string as written
into `settings.json`. If a throwaway `PI_CODING_AGENT_DIR` was used, deleting
that directory is sufficient.

**Note on the URL.** The form above carries no ref, so it is *not* pinned —
`pi update --extensions` will reconcile it to the tracked default branch.
Pinning requires an explicit `@<tag-or-commit>` suffix.

**Offline proxy:** `tests/integration/load-paths.test.ts` case 2 — clones this
repository locally and runs `npm install --omit=dev` in the clone, then loads
it as a package and asserts the sentinel. It exercises the same code path with
a local clone standing in for the network fetch.

### RB-01-03 — BOOT-05: `/reload` re-registers the extension

**Status:** OUTSTANDING

**Why this cannot be done here.** `/reload` is an interactive slash command
with no non-interactive equivalent; it requires a TTY. There is no `--reload`
flag and no scriptable path to it.

**Procedure:**

1. `cd ky-pi-agent && pi`
2. Accept the project-trust prompt. Without trust, project-local resources
   under `.pi/` are ignored entirely and the test is vacuous.
3. Edit `SELFTEST_MODEL_ID` in `.pi/extensions/harness/index.ts` to a new
   value.
4. Run `/reload`.
5. Confirm the **new** value appears — via the model picker in the same
   session, or by exiting and running a fresh `pi --list-models`.

**Expected output:** the edited sentinel id, not the old one. Hot reload works
only for auto-discovered locations; an extension loaded with `pi -e <path>` is
for quick tests and does not participate.

**Offline proxy:** `tests/unit/extension-layout.test.ts` — asserts the
documented structural precondition for hot reload, that every shipped
extension sits at an auto-discovered path. That is a necessary condition for
`/reload` to work, not a sufficient one, which is exactly why this entry
stays open.

---

### Phase 1 machine-state notes

These belong nowhere else and are easy to get wrong.

**`auth.json` mode `0600` is a no-op on Windows.** `~/.pi/agent/auth.json` is
written with mode `0600`, which on Windows toggles only the read-only bit —
Node's `chmodSync` does not touch NTFS ACLs. Do **not** treat that mode as a
permission control on Windows.

**Three pieces of machine state no file in this repository can reach:**

1. whether `~/.pi/agent/npm/.npmrc` exists — the repo cannot write outside
   itself, and this is the file that covers every user-scope `pi install`;
2. whether `gh` is logged in — see RB-01-01;
3. whether the globally installed Pi matches the pin — a stale global Pi
   silently changes extension-API behaviour.

All three are re-checkable at any time:

```
sh bin/bootstrap.sh --check-only
sh bin/bootstrap.sh --assert-hardening
```

`--check-only` mutates nothing and exits 0 on a clean runner where bootstrap
has never been applied. **It does, however, require network access**: its
published-pin preflight asks the npm registry whether the pin still exists, and
exits 1 when the registry does not answer rather than guessing which of
"withdrawn" and "offline" it is looking at. On a plane, skip it.
`--assert-hardening` is the stricter one *and* the offline-safe one: it asks npm
about all three scopes including the user scope, touches no network, and exits 1
if any of them still permits lifecycle scripts.

---

## Phase 2 — Diagnostics — The Instrument

Phase 2 built the instrument: a redacted wire dump, a per-turn JSONL row, a
nested-call chokepoint, a prose-tool-call detector with a capped retry, and
`/budget`. Six of its eight requirements are verifiable offline and are
complete. The three checks below are the residue — the parts that need a real
model, a real credential and a real working day, none of which the development
machine has. `docs/DIAGNOSTICS.md` describes the logs these checks read.

`tests/unit/docs-policy.test.ts` guards these statuses exactly as it guards the
Phase 1 ones: it parses both the summary-table row and the `**Status:**` line
of every `RB-<phase>-<n>` entry, and a disagreement between the two is reported
as `INCONSISTENT`, which is never an acceptable status.

| ID | Check | Status |
|----|-------|--------|
| RB-02-01 | DIAG-01 — one real turn per provider produces a wire dump showing the thinking parameters | OUTSTANDING |
| RB-02-02 | DIAG-07 — no live credential appears in any dump | OUTSTANDING |
| RB-02-03 | DIAG-05 — the detector has fired on real DeepSeek V4 Flash traffic | OUTSTANDING |

### RB-02-01 — DIAG-01: one real turn per provider produces a wire dump showing the thinking parameters

**Status:** OUTSTANDING

**Why this cannot be done here.** There are no live model credentials on the
development machine and no provider egress from it. Every Phase 2 capture test
runs against `fauxProvider`, whose payload this repository builds itself — so
those tests prove the capture apparatus and assert nothing whatsoever about what
a real adapter emits. Only real traffic can do that. A fixture that agrees with
itself is not evidence.

**Procedure, on the work laptop:**

1. Run one ordinary turn with the DeepSeek-direct model selected — any prompt
   that produces an assistant message will do.
2. Read the last wire record:
   `tail -n 1 .pi/logs/wire-$(date +%F).jsonl`
3. Switch to the Bedrock Claude model, run one more ordinary turn, and read the
   last record again with the same command.

**Expected output.** The record is one JSON object per line; the request record
is the one whose `kind` is `main.request`, and its `payload` is the body Pi
handed the adapter.

- **DeepSeek-direct:** the payload contains a `thinking` object whose `type` is
  the string `enabled`, **and** a sibling `reasoning_effort` key at the top
  level of the payload — not nested inside `thinking`. Both must be present.
  A payload carrying `thinking` and no `reasoning_effort`, or the effort nested
  one level down, is a finding, not a pass.
- **Bedrock Claude:** the payload contains a non-empty
  `additionalModelRequestFields`. An absent or `{}` value means the thinking
  configuration never reached Converse.

"It looked like there was thinking in there" is not an acceptable result for
either provider. Record the two payload fragments verbatim in the phase notes.

**What this is the apparatus for.** The Carried-Forward Unknown behind the whole
project — *does DeepSeek V4 Flash honour `reasoning_effort` through Pi's
`openai-completions` adapter?* — is answered by looking at this dump. Phase 2
does **not** answer it. Phase 2 builds the thing that will, and Phase 3's
provider work is what points it at a live endpoint. Do not read a green Phase 2
suite as an answer to that question; it is an answer to a different one.

**Offline proxy:** `tests/integration/wire-capture.test.ts` — drives a live
in-memory session with an `onPayload`-emitting faux provider and proves the
three hooks fire in the order `main.headers` → `main.request` →
`main.response` under one correlation id, that the capture handler returns
`undefined` and therefore does not rewrite the outgoing request, and that the
bytes read back off disk are redacted. It proves the instrument works. It says
nothing about what a real provider payload looks like, which is the only thing
this entry is about.

### RB-02-02 — DIAG-07: no live credential appears in any dump

**Status:** OUTSTANDING

**Why this cannot be done here.** `fauxProvider` resolves no auth, so the
headers reaching `before_provider_headers` on this machine are empty unless a
test puts a fake secret in them by hand. No real credential has ever passed
through the capture path here, which means the redactor has been proven against
fixtures this repository wrote and against nothing else. The question this entry
asks — *does the pattern list cover the credentials the work laptop actually
holds?* — cannot be asked on a machine that holds none.

**Procedure, on the work laptop:** run this **after** RB-02-01, so the logs
contain at least one real request per provider.

1. `grep -rIEn 'sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|Bearer [A-Za-z0-9._-]{20,}' .pi/logs/`
2. Open the `main.headers` record from the same run and read the
   `authorization` entry.

**Expected output.** Step 1 prints nothing and exits non-zero — `grep` exits 1
when it matches nothing, which is the passing case here. Step 2 shows every
credential-shaped header rendering as a `[redacted:` placeholder followed by a
character count, never as a value. A single match in step 1 is a stop-everything
result: the log directory is gitignored but `git add -f` overrides ignore rules,
and the repository is public.

**Closed door — do not re-litigate.** A Bedrock SigV4 signature can never appear
in one of these dumps, so do not write a version of this check that looks for
one and do not treat its absence as evidence of anything. SigV4 is applied by
the AWS SDK's Smithy signing middleware, downstream of everything Pi hands over,
and `ProviderRequestOptions.headers` documents that on Bedrock the reserved
headers `x-amz-*`, `authorization` and `host` are silently ignored to preserve
SigV4 / bearer auth (`pi-ai 0.84.1 src/types.ts:148-153`). This check is
therefore written around the DeepSeek / DashScope bearer-token path, where a
token genuinely does pass through the hook. A Bedrock-aimed version would report
a clean pass while exercising nothing at all — the worst possible outcome for a
security check.

**Offline proxy:** `tests/unit/redact.test.ts` — drives the matcher in both
directions over fixture payloads and header maps: every secret shape in the
pattern table is proven to be replaced, and a clean payload is proven to survive
byte-identical, so a redactor that mangles ordinary text fails as surely as one
that leaks. It proves the matcher is correct about the patterns it knows. It
says nothing about whether that list covers the credentials on the work laptop.

### RB-02-03 — DIAG-05: the detector has fired on real DeepSeek V4 Flash traffic

**Status:** OUTSTANDING

**Why this cannot be done here.** The ~11% prose-tool-call failure mode only
manifests on real model output. Offline the detector is fed messages this
repository wrote to make it fire, which measures the predicate and not the
model. The number this project actually needs — *how often does the daily driver
do this, and does one retry recover the turn?* — requires a working day of real
DeepSeek V4 Flash traffic.

**Procedure, on the work laptop,** after a working day of ordinary use:

1. `cat .pi/logs/turns-*.jsonl | grep -F '"kind":"turn"' | grep -cF '"event":"prose_tool_call"'`
2. `cat .pi/logs/turns-*.jsonl | grep -cF '"kind":"turn"'`
3. `cat .pi/logs/turns-*.jsonl | grep -F '"event":"prose_tool_call"' | grep -v '"kind":' | wc -l`
4. `cat .pi/logs/turns-*.jsonl | grep -cF '"event":"prose_tool_call_retry_exhausted"'`
5. Open the log and find one turn carrying `prose_tool_call`, then read the
   turn immediately after it.

**Expected output.** Steps 1 and 2 give a numerator and a denominator; their
ratio is the measured prose rate, to be compared against the ~11% baseline
reported in the open DeepSeek-V3 issue. Steps 3 and 4 are the two ACTIONS the
detector took — a retry issued, and a retry refused because the per-run budget
was already spent — and they exist to be reconciled, not folded in:
**step 3 + step 4 must equal step 1.** If the sum is *higher*, an action was
taken but the turn it belongs to is absent from step 1 — its row never reached
disk, or it lost its `event` slot to a competing verdict (see the caveat below).
Both directions of that loss push the sum up, not down. If the sum is *lower*, a
turn row carries the verdict but its action record never reached disk: `index.ts`
stamps `turn.event` *before* either `writeTurnsRow` call, so an append that
throws is swallowed into a `diagnostics.error` row while `turn_end` still writes
the verdict row. Step 4 on its own is
also the count of turns where the nudge was never attempted, which is worth
recording beside the rate. Step 5 must find at least one instance where the
following turn contains a real tool call — that is what distinguishes "the retry
recovered the turn" from "the retry bought a second paragraph of prose". A day
that produces a zero numerator is a result worth recording too, but it is not
this check passing: it means the rate is low enough that the sample is too small,
and the check stays open for a longer window.

**Why each step is shaped the way it is.** Every detected prose turn leaves a
turn row carrying `event: prose_tool_call`, because `index.ts` stamps the verdict
on the turn accumulator *before* it consults the retry budget. It does **not**
always leave the kind-less standalone record: that one is written only when a
retry was actually issued, and `MAX_PROSE_RETRIES` is `1` per agent run, so in
any run with two or more prose turns every prose turn after the first writes
`prose_tool_call_retry_exhausted` instead. Counting the kind-less records
therefore UNDER-counts the rate — on a run with two prose turns out of three it
reports 1/3 where the truth is 2/3 (measured on a fixture holding both shapes).
Counting turn rows without the `grep -F '"kind":"turn"'` prefilter OVER-counts it
instead, because the standalone record carries the same `event` value; against a
published ~11% baseline an inflated rate reads as loud confirmation of the
leading root-cause hypothesis and a deflated one reads as refutation, so the
numerator is pinned in `tests/unit/docs-policy.test.ts` rather than trusted. The
`cat` is not decoration either: `grep -c` over a glob prints `file:count` per
file rather than one total, so with any rotation at all the un-piped form yields
neither a numerator nor a denominator. `-F` pins the pattern as a fixed string,
and its trailing `"` is what keeps `prose_tool_call_retry_exhausted` out of
steps 1 and 3, which is why step 4 has to ask for it separately.

**One caveat, which is why step 3 + step 4 is worth checking rather than
optional.** A turn row carries exactly one `event`, and on a turn where
`ctx.model` is undefined the degraded-cost marker wins that slot — losing a
fabricated-zero-cost warning is worse than losing the prose verdict. Such a turn
is absent from step 1 while still contributing to step 3 or step 4, so the
reconciliation identity is the thing that makes the loss visible instead of
silent.

**Offline proxies:** `tests/unit/prose-detector.test.ts` and
`tests/integration/prose-retry.test.ts`. The first drives the predicate over a
positive and a negative table — including the false positive that matters, a
message that merely *mentions* a tool name — and bounds it against a megabyte of
adversarial text. The second proves, on a live in-memory session, that the
detector's effect happens exactly once: one follow-up user message inside the
same agent run, a second prose response logged as
`prose_tool_call_retry_exhausted`, and no third model call. Together they prove
the predicate and the capped retry. They say nothing about whether the detector
has ever fired on real traffic, or at what rate — which is the entire question.

---

## Phase 3 — Providers & Credentials

Phase 3 made every provider the harness routes to structurally complete in the
repository: a DashScope provider whose `compat` block is written out in full, a
Bedrock credential that carries a profile name and no secret, an SSO-expiry
classifier, a DeepSeek-direct → DashScope fallback chain, and the templates and
installer that put the first two into `~/.pi/agent/`. Everything above was
verified offline — against Pi's real `openai-completions` adapter, a loopback
capture server, and a composed `ModelRuntime` — and every one of those proofs
answers the same question: *what does Pi emit?* The five checks below ask the
other question — *what does the provider accept, and what are the real
numbers?* — and none of them can be asked from a machine that holds no
credential and issues no provider request.

This section is PROV-09 itself. It is the deliverable that makes the other four
`[RUNBOOK]` requirements honest: PROV-03, PROV-04, PROV-07 and PROV-10 are
built and unit-verified, and each is recorded in `.planning/REQUIREMENTS.md` as
partial with its `RB-03-xx` id named inline, never as complete.

`tests/unit/docs-policy.test.ts` guards these statuses exactly as it guards the
Phase 1 and Phase 2 ones: it parses both the summary-table row and the
`**Status:**` line of every `RB-<phase>-<n>` entry, and a disagreement between
the two is reported as `INCONSISTENT`, which is never an acceptable status.

| ID | Check | Status |
|----|-------|--------|
| RB-03-01 | PROV-03 — the explicit DashScope `compat` block is correct on the wire and DashScope accepts it | OUTSTANDING |
| RB-03-02 | PROV-10 — a two-turn tool-calling sequence against DashScope returns 200 on the second turn | OUTSTANDING |
| RB-03-03 | PROV-04 — Bedrock authenticates from a fresh shell via `credential.env.AWS_PROFILE` | OUTSTANDING |
| RB-03-04 | PROV-07 — the R1 experiment, run and recorded | OUTSTANDING |
| RB-03-05 | PROV-06 — the real DashScope context cap and per-token price | OUTSTANDING |

### RB-03-01 — PROV-03: the explicit DashScope compat block is correct on the wire and DashScope accepts it

**Status:** OUTSTANDING

**Why this cannot be done here.** There is no DashScope credential on the
development machine and no egress to `aliyuncs.com` from it.
`tests/integration/dashscope-payload.test.ts` drives Pi's **real**
`openai-completions` adapter and reads the **real bytes** off a socket, so the
emitted body is not a fixture — but the server on the other end of that socket
is one this repository wrote, and it accepts everything it is sent. Whether
Alibaba accepts the same body is a fact about Alibaba.

**Procedure, on the work laptop:**

1. Select `dashscope/deepseek-v4-flash` and run one ordinary turn — any prompt
   that produces an assistant message will do.
2. `cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 1`
3. `grep -F '"kind":"main.response"' .pi/logs/wire-$(date +%F).jsonl | tail -n 1`

**Expected output.** Step 3 must show `status: 200`. Step 2's `payload` is the
body Pi handed the adapter, and every key below is checked **individually** —
"the payload looked right" is not a result:

- **`enable_thinking`**, at the top level of the payload. Its absence means
  `compat.thinkingFormat` never resolved to `"qwen"` and thinking was silently
  never enabled — the failure that is invisible from the UI.
- **`reasoning_effort`**, also at the **top level**, a sibling of
  `enable_thinking` and not nested inside any object.
- **`max_tokens`**, and **not** `max_completion_tokens`. Pi emits this key only
  when the caller sets `options.maxTokens`; if neither key is present, re-run
  the turn through a path that sets one rather than recording an absence as a
  pass.
- **no `store`** key anywhere in the payload.
- **no message whose `role` is `developer`**.
- **no `strict`** on any entry of `tools[]`.
- **no `prompt_cache_key`** and **no `prompt_cache_retention`**.

Paste the payload fragment verbatim into this entry when the status flips. A
200 with a missing `enable_thinking` is a finding, not a pass: the request
succeeded and the capability did not.

**If the host does not resolve, or returns 404 — read this first.** Whether the
DeepSeek models are served on the legacy shared Singapore domain is
**UNVERIFIED**: Alibaba's DeepSeek page lists Singapore only in
workspace-dedicated form, and lists `dashscope-intl.aliyuncs.com` under "legacy
domains (still functional)". That is the single most likely reason this entry
fails the first time, and the remedy is already built:

```
export KYPI_DASHSCOPE_BASE_URL="https://<WorkspaceId>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" && sh bin/bootstrap.sh
```

`<WorkspaceId>` is the caller's own workspace id, read from the Model Studio
console. It is deliberately **not** committed — `baseUrl` is never interpolated
by Pi, so a dedicated URL in the repository would be a hard-coded,
account-identifying literal in a public repo and wrong on every other machine.
`merge_models_json` **replaces** `providers.dashscope`, so this works on a
machine that has already bootstrapped and not only on a clean install.

**The `thinkingFormat` contingency.** If the dump shows DashScope rejecting
`enable_thinking` for a DeepSeek model, flipping `compat.thinkingFormat` from
`"qwen"` to `"deepseek"` in `.pi/templates/models-template.json` is a one-key
change: `tests/unit/dashscope-compat.test.ts` deep-equals the **composed**
compat block, so the flip is one key plus one expected value and cannot be made
silently. Do not flip it on a hunch — upstream issue
`earendil-works/pi#6998` was closed in favour of `"qwen"` for exactly these
models.

**Offline proxies:** `tests/unit/dashscope-compat.test.ts` — deep-equals the
compat block Pi composes from the shipped template, so a typo'd key (which
typebox accepts in silence) fails rather than doing nothing — and
`tests/integration/dashscope-payload.test.ts`, which asserts each of the seven
present/absent conditions above on real emitted bytes, with a control body that
proves the absences are evidence rather than an artefact of the request shape.
Together they prove what Pi **composes** and what Pi **emits**. They say
nothing about what DashScope **accepts**, which is this entry.

### RB-03-02 — PROV-10: a two-turn tool-calling sequence against DashScope returns 200

**Status:** OUTSTANDING

**Why this cannot be done here.** Same missing thing as RB-03-01: no DashScope
credential, no provider egress. The specific failure this entry tests is a
**provider-side** 400 on the second request of a tool sequence, so a loopback
server that returns 200 to everything cannot produce it — and the first turn of
such a sequence always works, which is why the failure reads as intermittent
rather than as a misconfiguration.

**Procedure, on the work laptop:**

1. Select `dashscope/deepseek-v4-flash`.
2. Ask something that forces **two tool turns**, e.g. `Read package.json, then
   read the file its "main" field points at.` Two turns of chat will not do:
   the round-trip that carries an assistant message back to the provider is
   what triggers the 400.
3. `cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 2`
4. `cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"kind":"turn"' | tail -n 2`

**Expected output.** Step 3 gives two `main.request` records. The **second**
must contain a replayed assistant message carrying `tool_calls` **and** a
`reasoning_content` key. A value of `""` is correct and expected — Pi inserts
the empty string, and the requirement is that the key is present at all. A
`main.response` record must follow that second request with `status: 200`.

**An absent `main.response` after the second request is the signal.** A 4xx
throws before the response hook runs, so the record is never written — its
absence *is* the finding. Step 4's second turns row will then carry
`outcome: "error"` with the provider's own message, which is the text to record
here verbatim. That is a finding, not a pass, and it means
`requiresReasoningContentOnAssistantMessages` did not take effect.

**Offline proxy:** `tests/integration/dashscope-payload.test.ts` — drives Pi's
real `openai-completions` adapter against a loopback server with the shipped
compat block over a replayed two-turn context, and asserts
`reasoning_content` is present on the replayed assistant message, with the
paired negative that deleting the compat key removes it. It proves the exact
mechanism. It says nothing about the provider's 200 on the second turn, which
is this entry and cannot be substituted.

### RB-03-03 — PROV-04: Bedrock authenticates from a fresh shell via `credential.env.AWS_PROFILE`

**Status:** OUTSTANDING

**Why this cannot be done here.** There is no AWS profile, no IAM Identity
Center session and no Bedrock access on the development machine.
`tests/unit/bedrock-auth.test.ts` blanks all seven variables in Pi's resolution
chain and asserts the stored `env.AWS_PROFILE` wins — which proves the
*mechanism* without reading this machine's state, and is exactly why it cannot
also prove that a real session authenticates.

**Procedure, on the work laptop, from a shell that has just been opened:**

1. `aws sso login --profile X && echo $AWS_PROFILE`

   `X` is the profile name from `~/.aws/config`. Do not paste the real profile
   name, an account id or an SSO start URL into this file — it is public. **An
   empty echo means Bedrock will not work regardless of a successful SSO
   login**: `aws sso login` writes a token cache under `~/.aws/sso/cache/` and
   sets no environment variable at all, so with nothing in `AWS_PROFILE` Pi
   reports no Bedrock credentials even though the AWS SDK itself would resolve
   fine. A single `[default]` SSO profile does not help.
2. Configure the persisting form: `pi auth login` → **Amazon Bedrock** → **"AWS
   profile"**, and enter that same profile name. Never choose **"Existing AWS
   credential chain"** — that branch stores `{ "type": "api_key" }` with no
   `key` and no `env`. It is a no-op that looks like configuration, and it is
   the single most likely way this check is reported as done while nothing was
   configured.

   `bin/bootstrap.sh` deliberately does **not** install this entry. The
   template `.pi/templates/auth-template.json` carries
   `"AWS_PROFILE": "REPLACE_WITH_AWS_PROFILE_NAME"` to document the shape, and
   `merge_auth_json` withholds any template entry still holding a
   `REPLACE_WITH_` value at any depth — a stored `env.AWS_PROFILE` beats the
   ambient one in Pi's own chain (`pi-ai amazon-bedrock.ts:65`), so installing
   the placeholder would not merely fail to help: it would silently break a
   laptop where `export AWS_PROFILE=…` already worked, which is the very state
   step 1 above tells you to check. The run prints which entries it withheld
   and why. A fresh `PI_CODING_AGENT_DIR` therefore gets an `auth.json` holding
   `dashscope` and `deepseek` and **no** `amazon-bedrock` key — that is
   correct, not a failed bootstrap. `pi auth login` writes the real entry, and
   an existing `amazon-bedrock` entry is never touched, so a hand-configured
   one is never clobbered.
3. Open a **new** shell, export nothing, select a Bedrock Claude model and run
   one ordinary turn.
4. `cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"provider":"amazon-bedrock"' | tail -n 1`

**Expected output.** Step 4 prints a turns row with `outcome: "ok"` and a
non-zero token count. The fresh shell in step 3 is the whole point: it is what
distinguishes a credential that persists from one that happened to be in the
environment of the terminal where it was configured.

**The one live check of the SSO classifier, folded in here.** Plan 03-08 ships
a `message_end` classifier that rewrites six credential-failure strings into a
single actionable line naming `aws sso login --profile <resolved>` and marks
them non-retryable. **All six strings are fixtures this repository wrote.**
When the SSO session next expires — 8 to 12 hours, so roughly once a working
day — run one more turn and record here, verbatim:

- the exact error text the run produced, and
- whether the `aws sso login --profile …` line appeared.

Both outcomes are results. If the reauth line did **not** appear, the real
message is a seventh shape and belongs in `SSO_FIXTURES` with its source
recorded; paste the raw text into this entry either way. Do not report this
sub-check as passed on the strength of a green offline suite: the suite proves
the matcher, not the message.

**Closed door — do not re-litigate.** The classifier is a `message_end` handler
and must not be rewritten as an `after_provider_response` one.
`after_provider_response` never fires on a provider error — a 4xx/5xx throws
before the response hook is reached — so such a handler would be dead code, and
its test would have to fabricate the event to pass. `message_end` runs before
the retry gate reads the mutated message, which is what makes the
non-retryable classification take effect.

**Offline proxies:** `tests/unit/bedrock-auth.test.ts` — resolves
`credential.env.AWS_PROFILE` through Pi's own auth context in both directions,
with every variable in the resolution chain blanked so the assertion is about
the stored credential and not about this machine — and
`tests/integration/sso-classifier.test.ts`, which drives the classifier over
all six fixtures on a live in-memory session and proves non-retryability by
call count (`callCount === 1`) against a retryable control in the same harness.
They prove the resolution order and the classifier. They say nothing about
whether a real SSO session authenticates, or what a real expiry says.

### RB-03-04 — PROV-07: the R1 experiment, run and recorded

**Status:** OUTSTANDING

**Why this cannot be done here.** R1 asks two questions and only the second one
matters: (a) does `api.deepseek.com` accept `reasoning_effort: "low"`, and (b)
does `"low"` produce materially fewer reasoning tokens than `"high"`. Two
researchers reached opposite conclusions on (a) without either issuing a
request. (b) is a **token count** from a real provider and cannot be desk-work
at all. Note the mechanical obstacle, which is settled and is not the question:
`deepseek-v4-flash` ships `thinkingLevelMap.low = null`, so
`clampThinkingLevel` walks `"low"` forward to `"high"` and **Pi 0.84.1 with the
built-in catalogue can never send `"low"`**. The null mapping suppresses
*selection*, not *emission* — unclamping is therefore sufficient and no adapter
change is needed.

**Preparation, one-time, on the work laptop.** Add the unclamp to
`~/.pi/agent/models.json`. It is a `modelOverrides` entry because
`applyModelOverride` **merges** `thinkingLevelMap`, so the rest of the map, the
compat block and the cost table are untouched:

```jsonc
{
  "providers": {
    "deepseek": {
      "modelOverrides": {
        "deepseek-v4-flash": { "thinkingLevelMap": { "low": "low" } }
      }
    }
  }
}
```

**Procedure:**

1. `pi --list-models | grep deepseek-v4-flash`

   Confirms the override parsed. A `Warning: errors loading models.json` line
   means the edit is malformed and **everything below is invalid** — stop and
   fix the file first.
2. Start `pi`, select `deepseek/deepseek-v4-flash`, and set the thinking level
   to **low**. If the picker does not offer `low`, the override did not apply —
   stop. `tests/unit/r1-unclamp.test.ts` proves the picker *does* offer it once
   the override is present, so this step failing is about the edit and not
   about Pi.
3. Send this fixed prompt, and use the **same string** in both legs:

   `Prove that the sum of the first n odd positive integers is n squared, then state the value for n = 47.`
4. `tail -n 5 .pi/logs/wire-$(date +%F).jsonl`

   Find the record whose `kind` is `main.request`.
5. `cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"kind":"turn"' | tail -n 1`
6. Set the thinking level to **high**, send the **same** prompt, and repeat
   steps 4 and 5.

**Expected output, by outcome:**

| Outcome | `main.request` payload | `main.response` / turns row |
|---|---|---|
| **accepted-and-cheaper** | `"thinking":{"type":"enabled"}` and a top-level `"reasoning_effort":"low"` | `main.response` `status: 200`; the low leg's `reasoning` is materially below the high leg's |
| **accepted-but-not-cheaper** | same | `status: 200`, and the low leg's `reasoning` is between 60% and 100% of the high leg's |
| **rejected** | same | **no `main.response` record at all** — a 4xx throws before the response hook, so its absence *is* the signal — and the turns row carries `outcome: "error"` with an `Error code: 400 …` message quoting the offending parameter |
| **no breakdown reported** | same | the `reasoning` key is **absent from both** turns rows. `reasoning` is omitted when the provider reports no breakdown, so this is a fourth outcome — "DeepSeek V4 Flash reports no reasoning-token breakdown through this adapter" — and it is a **result worth recording, not a failed run** |

**"Materially" is pre-committed, before the numbers are seen:**

```
low.reasoning <= 0.6 * high.reasoning
```

It is written down here in advance so the outcome is a **decision and not a
vibe**. Do not renegotiate the threshold after reading the two numbers.

**Recording.** The status flips to `PASSED — YYYY-MM-DD` only when **four
fragments are pasted verbatim into this entry**: both `main.request` payloads
and both turns rows. Then, and only then, append the one-line conclusion to the
R1 row of `.planning/ROADMAP.md`'s Carried-Forward Unknowns and to
`.planning/PROJECT.md`'s Key Decisions.

**Not part of Phase 3.** If the answer is accepted-and-cheaper, graduating the
`modelOverrides` unclamp from a manual edit into
`.pi/templates/models-template.json` is a **follow-up**, because `/cheap` is
Phase 5. Until this entry has a result, `/cheap` must not be defined in terms
of a cheap thinking tier.

**Offline proxy:** `tests/unit/r1-unclamp.test.ts` — composes the override
through a real `ModelRuntime` and proves the experiment is *executable*: that
the clamp exists without the override, that the override removes it, and that
`"low"` survives selection. It answers **nothing** about what
`api.deepseek.com` does with the value, which is the entire question.

### RB-03-05 — PROV-06: the real DashScope context cap and per-token price

**Status:** OUTSTANDING

**Why this cannot be done here.** Alibaba's public English documentation gives
no per-token price for these models — it says to see the Model Studio console —
and gives no per-model output cap for these ids. Both figures are therefore
UNVERIFIED in the shipped template: the cost block is an all-zero **visible
placeholder** and `maxTokens` is a deliberately conservative `65536`, low
enough that being wrong costs a truncation rather than an unexplained 400. A
console is behind a login this machine does not have.

**The two models this entry owns**, which are exactly the `COST_UNVERIFIED`
allowlist in `tests/unit/model-metadata.test.ts`:

- `dashscope/deepseek-v4-flash`
- `dashscope/deepseek-v4-pro`

**Procedure, on the work laptop:**

1. In the Model Studio console, open each model's card and read three numbers:
   the **per-million input price**, the **per-million output price** (and the
   cached-input price if one is listed), and the **maximum output tokens**.
   Record the currency and the date read — prices move, and an undated figure
   is the next unverified number.
2. Confirm the context window on the same card. The template ships `393216`,
   sourced from Alibaba's DeepSeek-on-Model-Studio page ("393,216 in total").
   If the console disagrees, the console wins and the template comment's
   citation must be replaced rather than supplemented.
3. Write all of it back into `.pi/templates/models-template.json`: real `cost`
   numbers, the real `maxTokens`, and the `UNVERIFIED` comment markers removed
   from exactly the figures that are now sourced — each replaced by the source
   and the date, in the file's existing citation style.
4. In the **same commit**, remove each newly-priced model from `COST_UNVERIFIED`
   in `tests/unit/model-metadata.test.ts`. The list is asserted in both
   directions, so a stale entry fails as loudly as a missing one.
5. `npx vitest run tests/unit/model-metadata.test.ts`
6. `pi --list-models | grep -F 'deepseek-v4-pro'`

**Expected output.** Step 5 exits 0. Step 6 shows the DashScope entry beside
Pi's built-in DeepSeek-direct entry for the same id, with **different**
numbers — that contrast is PROV-06's whole point, and two identical rows means
one provider's figures were copied into the other's entry.

**Why this entry exists at all.** An all-zero cost renders as "free" in a cost
report, and a number nobody sourced is eventually believed.
`tests/unit/model-metadata.test.ts` asserts that every all-zero-cost templated
model is on the allowlist **and** that every id on the allowlist is named in
this file, so a placeholder price cannot ship without a live check that will
replace it. This entry is that check.

**Offline proxy:** `tests/unit/model-metadata.test.ts` — proves the DashScope
entry never inherits the identically-named DeepSeek-direct context window or
cost table, that every placeholder is on the allowlist and named here, and that
the template keeps its `UNVERIFIED` mark. It cannot learn the numbers; that is
what a console login is for.

---

### Phase 3 machine-state notes

These belong to no single entry and are each easy to get wrong.

**Do not use the built-in Qwen token-plan providers.** `qwen-token-plan` and
its siblings are a **different Alibaba product**: a different host
(`token-plan.ap-southeast-1.maas.aliyuncs.com`), a different environment
variable (`QWEN_TOKEN_PLAN_API_KEY`) and a different key namespace (`sk-sp-`
prepaid keys). The named regression is a user running `pi auth login`, seeing
"Qwen", pasting a pay-as-you-go DashScope `sk-` key into it, receiving a 401
and concluding that DashScope is broken. The harness defines its own
`dashscope` provider and that is the only one to configure.

**Closed door — do not re-litigate.** The built-in Qwen token-plan provider is
not a shortcut to DashScope and never will be. It is a separate product with a
separate key namespace, not a differently-named endpoint for the same one.

**DashScope keys are region- and workspace-scoped, and non-portable.** A
Singapore key fails against the Beijing domain. A key issued in a different
workspace authenticates and then sees a different model list, which surfaces as
"the model does not exist" rather than as an auth error. When a key that works
elsewhere fails here, check the region and the workspace before checking
anything else.

**Closed door — do not re-litigate.** No Phase 3 check may look for a Bedrock
SigV4 signature in a wire dump. `RB-02-02` already owns that closed door:
signing is applied by the AWS SDK's Smithy middleware downstream of everything
Pi hands over, and on Bedrock the reserved headers are silently ignored to
preserve SigV4 auth. A Bedrock-aimed credential-leak check would report a clean
pass while exercising nothing at all — the worst possible outcome for a
security check.

**`auth.json` file permissions.** See the `0600`-on-Windows note in the Phase 1
machine-state notes above. It is unchanged and is not restated here; the Phase 3
templates keep secrets out of `auth.json` entirely for exactly that reason —
`amazon-bedrock` stores a **profile name**, and every other provider stores a
`$ENV_VAR` reference.

**One fixture-fidelity gap with no id of its own.** Every error string the
DeepSeek-direct → DashScope fallback chain classifies is a fixture this
repository wrote; only the retryable/fatal split is anchored on Pi's own
exported predicate. Whether a real DashScope arrears failure actually says
`Arrearage`, and whether a real rate limit and a real 5xx classify as
`transient` and `unavailable`, is unproven and unprovable here. It gets no
`RB-03-xx` id because PROV-08 is `[FAUX]` and every input is exercised offline
by `tests/integration/fallback-chain.test.ts`; it is recorded here so that the
first real failure of each kind on the work laptop is captured and compared
rather than merely survived.

---

## Phase 4 — Safety & Deployment Guardrails

Phase 4 built the mistake-catcher: an `unbash`-parsed AST guard over
`bash`/`read`/`write`/`edit`, a `git`/`glab` policy that blocks writes when
`HEAD` is protected and blocks `glab mr merge` unconditionally, sensitive-path
reads and mutating-infra confirmation gates, enforcement duplicated at the
`tool_call` hook and again inside each wrapped tool, a JSONL audit of every
allow and every block, a 30-plus evasion corpus, and the published limits
table at `docs/SAFETY.md` that names exactly what the guard does not catch.
Sixteen of its seventeen SAFE requirements are fully verifiable on this
machine and are complete. The one check below is the residual — and it is the
one control in this entire stack that is not theatre.

**Server-side branch protection is verified first, before any harness rule is
trusted.** Everything `.pi/extensions/safety/` does is a mistake-catcher for
the *confused-model* case, layered on top of GitLab's own server-side
enforcement — never a substitute for it. GitLab protected branches are
enforced where the model has no code execution at all, which is why they
catch every row of `docs/SAFETY.md`'s "Known bypasses" table, including the
classes the AST guard itself documents as out of scope (`hub push`, a direct
GitLab REST `PUT` against the merge-requests API, `npm run deploy`, a
`PATH`-shadowed `git` shim — none visible to a local parser, all stopped by
GitLab refusing the push). This machine has no GitLab access, no work-laptop
credentials, and no network egress, so the live check below is planned
OUTSTANDING and may never be reported as passed on the strength of anything
built in this repository. `docs/SAFETY.md` states the same thing in full, from
the guard's side.

`tests/unit/docs-policy.test.ts` guards this status exactly as it guards the
Phase 1, 2 and 3 ones: it parses both the summary-table row and the
`**Status:**` line of every `RB-<phase>-<n>` entry, and a disagreement between
the two is reported as `INCONSISTENT`, which is never an acceptable status.

| ID | Check | Status |
|----|-------|--------|
| RB-04-01 | SAFE-01 — a push to a protected GitLab branch is rejected server-side | OUTSTANDING |

### RB-04-01 — SAFE-01: a push to a protected GitLab branch is rejected server-side

**Status:** OUTSTANDING

**Why this cannot be done here.** This machine has no GitLab access, no
work-laptop credentials, and no network egress to the user's work GitLab
instance. Whether GitLab's protected-branch rule and push rules are actually
configured on `main` is a fact about a server this machine cannot reach — no
local test can substitute for asking GitLab directly.
`tests/integration/gitlab-push-protection.test.ts` drives a REAL `git push`
against a REAL local bare repository and a REAL `pre-receive` hook subprocess,
which is as far as a proof can go without the server itself — but the server
on the other end of that push is one this repository wrote, and it accepts or
rejects whatever its own fixture hook says. Whether GitLab does the same is a
fact about GitLab.

**Procedure, on the work laptop.** `<work-repo>` is a local clone of the
user's GitLab work repository. Its remote URL is deliberately not written
here — it is company-identifying information and this file is public.

1. `cd <work-repo> && git checkout main && git pull`
2. `echo "RB-04-01 push-protection check $(date -u +%FT%TZ)" >> RB-04-01-CHECK.md && git add RB-04-01-CHECK.md && git commit -m "RB-04-01: protected-branch push check (not meant to land)"`
3. `git push origin main`

**Expected output.** Step 3 must exit non-zero with GitLab's own
protected-branch rejection on stderr — specific enough that "it seemed fine"
is not an acceptable result. Record the ACTUAL rejection text observed,
verbatim, in this entry when the status flips:
`tests/integration/gitlab-push-protection.test.ts`'s fixture hook REPRODUCES
GitLab's wording (`You are not allowed to push code to protected branches on
this project.`) rather than capturing it, and this run is the only
opportunity to confirm the real text matches what the offline proxy assumed.

4. `git reset --hard HEAD~1`

   Step 4 discards the local check commit. It must never actually reach
   `main`, protected or not, regardless of the outcome of step 3.

**Offline proxy:** `tests/integration/gitlab-push-protection.test.ts` — drives
a real `git push` against a real local bare repository with a `pre-receive`
hook that reproduces GitLab's rejection wording; asserts the push is rejected
with that text on stderr; asserts a push to a non-protected branch against the
identical hook SUCCEEDS (the paired control that rules out "this hook rejects
everything"); and drives the harness's own `classifyPushFailure()` classifier
in both directions — a real protected-branch rejection and a real
non-fast-forward rejection, produced by genuinely diverging two clones — and
asserts they classify differently. It proves the harness reads and classifies
a server-side rejection correctly. It proves nothing at all about whether
GitLab is actually configured on the work laptop, which is this entry.
