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
`deepseek-flash` (Pi 1.1.0) was assumed to ship `thinkingLevelMap.low = null`, so
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
        "deepseek-flash": { "thinkingLevelMap": { "low": "low" } }
      }
    }
  }
}
```

**Procedure:**

1. `pi --list-models | grep deepseek-flash`

   Confirms the override parsed. A `Warning: errors loading models.json` line
   means the edit is malformed and **everything below is invalid** — stop and
   fix the file first.
2. Start `pi`, select `deepseek/deepseek-flash`, and set the thinking level
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

---

## Phase 5 — Routing & Capability Guards

Phase 5 built the router: an explicit role→model map covering six roles
across three modes, a capability guard that refuses four impossible routes
before dispatch, zero-context-token mode persistence proven on the wire, and
a `qoder_delegate` tool that hands a whole task to a foreign agent and folds
the result back. Ten of its eleven ROUTE requirements are fully verifiable
offline with `fauxProvider` and a real loopback HTTP+SSE server, and are
complete. The one check below is the residue — whether a real Qoder personal
access token against a real agent and environment actually completes a
delegation, which no fixture this repository wrote can answer.

`tests/unit/docs-policy.test.ts` guards this status exactly as it guards the
Phase 1, 2, 3 and 4 ones: it parses both the summary-table row and the
`**Status:**` line of every `RB-<phase>-<n>` entry, and a disagreement between
the two is reported as `INCONSISTENT`, which is never an acceptable status.

| ID | Check | Status |
|----|-------|--------|
| RB-05-01 | Qoder delegates a task and folds the result back through the Cloud Agents API | OUTSTANDING |

### RB-05-01 — Qoder delegates a task and folds the result back

**Status:** OUTSTANDING

**Why this cannot be done here.** There is no `QODER_PERSONAL_ACCESS_TOKEN`,
no pre-configured agent or environment, and no network egress to
`api.qoder.com` from this machine. `tests/integration/qoder-delegate.test.ts`
drives the real client (`.pi/extensions/qoder/client.ts`) against a
`127.0.0.1` loopback server shaped like Qoder's own documented Cloud Agents
envelope — but the server on the other end of that loopback is one this
repository wrote, and it accepts whatever it is scripted to accept. Whether a
real personal access token against a real agent and environment authenticates
and completes a delegation is a fact about Qoder's own service.

**Procedure, on the work laptop:**

1. Generate a personal access token once at
   `qoder.com/account/integrations` (shown only once), and create (or reuse)
   an agent and an environment via the Qoder console/API — a one-time setup,
   never repeated per task:
   `export QODER_PERSONAL_ACCESS_TOKEN=pt-<paste the token from qoder.com/account/integrations>`
2. Export the pre-configured agent and environment ids:
   `export QODER_AGENT_ID=<agent-id> QODER_ENVIRONMENT_ID=<environment-id>`
3. Start `pi` in this repository and ask the model to delegate a small,
   low-risk task through `qoder_delegate` — for example, "Use qoder_delegate
   to ask Qoder to reply with the single word OK." **An approval dialog will
   appear; select "Delegate to Qoder."** This is WR-11's human-in-the-loop
   confirmation gate (`docs/ROUTING.md` §6, "Two gates") — it requires an
   interactive UI and **this check cannot be run headlessly** (`-p` or
   `--mode json` refuse by design, with no allow-path).
4. Read the redacted transcript this repository wrote for the run:
   `cat .pi/logs/qoder-$(date +%F).jsonl | tail -n 5`

**Expected output.** The tool's own return value — what the model sees — is
a non-empty folded `agent.message` result returned as tool content. The
transcript's `qoder.delegate.result` record shows `done: true`, and the
stream terminated because a `session.status_idle` frame arrived with
`stop_reason.type === "end_turn"`. **The failure signal that matters most:**
a `401` or `403` on any of the three requests (visible in the transcript's
`*.response` records, by HTTP status) means the personal access token is
wrong, expired, or the agent/environment ids belong to a different account —
not a transient failure, and not something a retry fixes.

**Offline proxy:** `tests/integration/qoder-delegate.test.ts` — drives
`delegateTask` against a real `127.0.0.1` HTTP+SSE fixture shaped for the
Cloud Agents envelope (`tests/helpers/qoder-loopback.ts`), proving the exact
three-request sequence, the folded-result thinking/message separation, a
genuine cross-socket split-frame case, the non-2xx and missing-PAT failure
paths, and the redacted transcript. It proves the harness constructs the
right requests and parses a response shaped like Qoder's documented envelope
correctly. It says nothing about whether a real personal access token
reaches `api.qoder.com` or what a real delegation returns, which is this
entry and cannot be substituted.

---

## Phase 7 — Composed Extensions, Pinned & Reviewed

Phase 7 composed four pinned npm packages (`pi-subagents@0.76.1`,
`@narumitw/pi-lsp@0.49.9`, `pi-web-access@0.38.0`, `pi-session-finder@0.5.6`)
with six vendored extensions
(`.pi/extensions/{todo,questionnaire,plan-mode,loop-police,checkpoint,background-tasks}`;
`background-tasks` is `pi-background-tasks@2.6.9` vendored process-only in 08.1-05), wired
the worktree-isolation setup hook the subagent runner needs, and closed
EXT-01 through EXT-08 and EXT-10 against real pinned source rather than a
fixture: `docs/EXTENSIONS.md`'s Subagent capability evidence table
(EXT-01/EXT-03/EXT-04, plan 07-12), `tests/unit/extension-composition.test.ts`
(EXT-05/EXT-06, plan 07-11) and `tests/unit/tool-count-baseline.test.ts` (the
Phase 10 tool-schema handoff, plan 07-11). The blocking package-legitimacy
install gate (plan 07-10, Task 2) was found **NOT SATISFIED** on this
machine: its own pre-authorisation rested on the ground that this development
machine holds no credentials, and that ground is FALSE — live AWS SSO /
static admin keys are present (`aws sts get-caller-identity --profile
<admin-profile>` returned exit 0, resolving live IAM admin credentials for a
production account; the account number, principal ARN and profile name are
deliberately not recorded in this public repository — see `RB-07-03`).
No package has ever been installed here. That single fact is why this section
carries **two** outstanding entries instead of one: `RB-07-01` is the
composed smoke ritual EXT-09 names, and `RB-07-02` is the install-and-
reconcile step every one of `RB-07-01`'s four legs presupposes but which has
itself never run.

`tests/unit/docs-policy.test.ts` guards these statuses exactly as it guards the
Phase 1 through 5 ones: it parses both the summary-table row and the
`**Status:**` line of every `RB-<phase>-<n>` entry, and a disagreement between
the two is reported as `INCONSISTENT`, which is never an acceptable status.

| ID | Check | Status |
|----|-------|--------|
| RB-07-01 | EXT-09 — the composed smoke ritual: one turn per provider, one subagent spawn, one blocked command, one wire dump | OUTSTANDING |
| RB-07-02 | install the five pinned specs and reconcile `pi list` against `.pi/settings.json` | OUTSTANDING |
| RB-07-03 | decide, before the first `git push`, what to do about the account identifiers still present in unpushed local history | OUTSTANDING |

### RB-07-01 — EXT-09: the composed smoke ritual, run after any version bump

**Status:** OUTSTANDING

**Why this cannot be done here.** This machine has no provider credentials, no
installed `pi-subagents` package on disk (`RB-07-02` is OUTSTANDING), and no
interactive session outside this repository's own test harness. The composed
ritual is by definition an end-to-end sequence against real models and a real
installed extension tree, and no fixture this repository wrote can stand in
for either. State it plainly, without hedging: none of the four legs below has
ever run on this machine.

**Precondition.** Run this only after `RB-07-02` has completed — the second
and third legs need the five packages actually installed, not merely pinned
in `.pi/settings.json`.

**Procedure, on the work laptop, after any version bump — a pin change in
`.pi/settings.json` or a Pi / `@earendil-works/*` upgrade:**

1. **One turn per provider.** Run the procedure in `RB-02-01` for each
   configured provider (DeepSeek-direct, DashScope, Bedrock Claude) and
   confirm each produces a wire dump. Where the provider is DashScope and the
   prompt forces two tool turns, this also exercises `RB-03-02`'s check; where
   it is Bedrock, this is `RB-03-03`'s turn. This leg introduces no new
   command of its own — see the cited ids for the exact procedure, rather
   than restating it here.
2. **One subagent spawn.** Confirm the five installed packages are still
   current per `RB-07-02`'s own reconciliation step — then confirm the
   working tree is clean: `git status --porcelain`. Worktree-isolated
   subagents call `resolveRepoState()` (`pi-subagents@0.76.1
   src/runs/shared/worktree.js:196-205`), which runs the equivalent check
   scoped to exclude `.pi/subagents` and throws `"worktree isolation
   requires a clean git working tree. Commit or stash changes first."` on
   any non-empty result — an operational precondition, not a suggestion.
   Then spawn the `planner`
   subagent (`.pi/agents/planner.md`) on a small task and confirm two things:
   (a) it ran with the model Phase 5's `agentOverrides` selected for the
   `planner` role, and **not** a `model:` key read from the agent's own
   frontmatter — `.pi/agents/planner.md` deliberately ships no such key
   (`07-04-SUMMARY.md`), and one creeping back in would silently defeat
   `/cheap` `/balanced` `/max` `/escalate` for this agent without any visible
   error; (b) if the spawn used worktree isolation, the worktree genuinely
   **builds** — dependencies resolve and the entry point runs — rather than
   merely checking out, since a broken `node_modules` junction fails at build
   time, not at `git worktree add` time.
3. **One blocked command.** There is no Phase 4 `[RUNBOOK]` id for this leg
   because it is the one leg with a complete offline proxy — see below. Run
   one representative blocked command (for example `terraform destroy`,
   unconfirmed) interactively, inside a session that actually has
   `pi-subagents` installed, and confirm the audit JSONL row appears:
   `tail -n 1 .pi/logs/audit-$(date +%F).jsonl`. This is the one leg
   composing does not weaken: the guard binds to the tool name at the
   `tool_call` hook regardless of which other extensions are active
   (`07-07-SUMMARY.md`'s T-07-27 finding), so a blocked command inside a
   session carrying five newly-installed extensions is exactly as covered as
   one inside a bare session.
4. **One wire dump.** Cite `RB-02-01` — confirm a dump lands under
   `.pi/logs/wire-$(date +%F).jsonl` and carries no credential-shaped value,
   which is `RB-02-02`'s subject and is not re-litigated here.

**Expected output, specific and falsifiable per leg — never "it seemed
fine":**

- Leg 1: a wire dump file exists for each provider and names the thinking
  parameters exactly as `RB-02-01` (and, where applicable, `RB-03-01`
  through `RB-03-03`) specify.
- Leg 2: `RB-07-02`'s own reconciliation still reports `MATCH`; the
  subagent result returns; the recorded model matches Phase 5's routing
  table for the `planner` role, not the model the frontmatter would imply if
  it carried one; if worktree-isolated, the worktree's own build step exits
  0.
- Leg 3: the blocked command produces a `BLOCK` verdict to the model and
  exactly one new audit row — not zero, not two.
- Leg 4: the dump contains no credential-shaped value under the patterns
  `RB-02-02`'s procedure greps for.

**Offline proxy — named by path, with what each one does and does not
prove:**

- `tests/integration/worktree-build.test.ts` — proves the worktree-isolation
  mechanism and this repository's own setup hook: symlinking `node_modules`
  into the new worktree and building the checked-out tree. It does **not**
  prove that `pi-subagents` actually invokes this hook on a real spawn — that
  binding is wired into `pi-subagents`' own global config file
  (`07-09-SUMMARY.md`) and nothing in this repository's test suite spawns
  `pi-subagents`' real spawn path; only leg 2 above does.
- `tests/unit/subagent-capabilities.test.ts` — proves ten `file:line`
  citations against the pinned `pi-subagents@0.76.1` tarball are genuine and
  bound to the exact pinned version (`docs/EXTENSIONS.md`'s Subagent
  capability evidence table). It proves the citations are real source, not
  that the mechanisms they cite behave correctly once actually invoked in a
  live session.
- `tests/integration/subagent-block.test.ts` — proves a blocked command stays
  blocked inside a real spawned headless `pi --mode json` child process whose
  working directory carries a project-scoped `.pi/extensions/` sentinel, with
  the audit row as evidence. It proves this repository's own guard
  composition survives that spawn topology, not that `pi-subagents`' real
  spawn topology matches the proxy's in every respect.
- `tests/unit/evasion-corpus.test.ts` and `tests/unit/audit-jsonl.test.ts` —
  prove the blocked-command classifier and the audit writer respectively,
  over 30-plus fixtures this repository wrote. Neither has ever classified a
  command actually typed by a real model inside a session carrying the five
  newly-installed extensions.
- `tests/integration/wire-capture.test.ts` (Phase 2) and
  `tests/integration/dashscope-payload.test.ts` (Phase 3) — prove the
  capture and redaction mechanism against a faux provider and a loopback
  server this repository wrote. They say nothing about what a real provider
  payload looks like, which is legs 1 and 4 of this ritual and cannot be
  substituted.

### RB-07-02 — install the five pinned specs and reconcile `pi list`

**Status:** OUTSTANDING

**Why this cannot be done here.** Plan 07-10's blocking package-legitimacy
checkpoint could not be auto-approved: its pre-authorisation's ground (a) —
"this development machine has no credentials" — was verified rather than
assumed and found FALSE (`aws sts get-caller-identity --profile
<admin-profile>` returned exit 0, resolving live long-lived static IAM **admin**
keys present at `~/.aws/credentials`, plus an SSO cache; the account number,
principal ARN and profile name are deliberately not recorded in this public
repository — see `RB-07-03`). Per that
checkpoint's own binding text, this gate is not auto-approvable on the
strength of the standing autonomous-run pre-authorisations, which cover
`[RUNBOOK]` verification, not a supply-chain install gate. No install command
of any kind (`pi install`, `npm install`, `pi update`) has ever run in this
repository — confirmed by `.pi/npm/` holding only the tracked `.npmrc` and
`.pi/git/` not existing at all (`docs/EXTENSIONS.md`'s Install reconciliation
section, plan 07-10). **This is not a technical install failure** — no PATH
issue, no project-trust refusal, and no network failure was encountered or
would even have been reached. It is a gate that requires a human physically
present, on a machine whose real credential exposure is now known rather than
assumed absent.

**Re-armed by the Phase 08.1 re-pin.** Plan 08.1-04 re-pinned `pi-subagents`,
`@narumitw/pi-lsp` and `pi-web-access` (offline review only: published-file
review plus an `@earendil-works/*` import-resolution proxy against Pi 1.1.0;
nothing was installed or loaded). `RB-07-01` ("run after any version bump")
and this entry therefore now name the new specs and both remain OUTSTANDING.

**Procedure, on the work laptop, with a human physically present to satisfy
the package-legitimacy gate:**

1. Re-confirm each of the four pinned specs' identity against the registry
   and repository pages named in `docs/EXTENSIONS.md`'s per-package
   legitimacy evidence table — that review is current as of 2026-08-14/15 and
   should be re-run if this procedure runs materially later, since the
   ecosystem ships 13-16 releases/month.
2. `pi install -l npm:pi-subagents@0.76.1`
3. `pi install -l npm:@narumitw/pi-lsp@0.49.9`
4. `pi install -l npm:pi-web-access@0.38.0`
5. `pi install -l npm:pi-session-finder@0.5.6`
6. `pi list`
7. Reconcile step 6's output against `.pi/settings.json`'s `packages[]`:
   every spec must appear at its pinned version, and `pi list` must contain
   nothing that `packages[]` does not declare. Record the verdict as `MATCH`
   or an itemised `MISMATCH` — never "looks right".
8. Re-run `sh bin/bootstrap.sh --assert-hardening` and confirm it still exits
   0 — an install that silently rewrote an `.npmrc` is exactly the kind of
   regression this repository has caught before.
9. `npx vitest run tests/unit/extension-pins.test.ts`

**Expected output.** Step 6 lists all four specs at their pinned versions and
nothing else project-scoped. Step 8 exits 0. Step 9 exits 0, and its own
Direction 4 ("installed-but-undeclared") now resolves through its real branch
for the first time, because `.pi/npm/` exists — record whether it passed
through the real branch or the "confirmed absent" branch this time, since
only the former is new information this machine has never had before.

**Offline proxy:** `tests/unit/pinning.test.ts` and
`tests/unit/extension-pins.test.ts` — assert `.pi/settings.json`'s
`packages[]` is exact-pinned and, on Direction 4, that nothing installed is
undeclared. But Direction 4's own installed-but-undeclared check has never
fired against real npm output — it resolves through the "confirmed absent"
branch whenever `.pi/npm/node_modules` and `.pi/git/` do not exist, which is
the case on this machine right now (`07-10-SUMMARY.md`). It proves the
lockfile-comparison mechanism is sound. It does not prove `pi install` and
`pi list` agree in practice, which is this entry and cannot be substituted.

### RB-07-03 — the account identifiers redacted from the working tree are still in local history

**Status:** OUTSTANDING

**What happened.** Plan 07-10 verified the install gate's pre-authorisation
ground (a) — "this dev machine has no credentials" — by actually running
`aws sts get-caller-identity` and found it **FALSE**. That finding is correct
and it stays. The way it was *recorded* was not: the real 12-digit AWS account
number, the full IAM principal ARN and the named admin profile were written
verbatim into `docs/EXTENSIONS.md`, `docs/RUNBOOK.md` and three `.planning/`
artifacts, in a repository `PROJECT.md` describes as public and whose
constraint is unqualified — *"Public repo. No credential may ever be
committed."*

None of those strings is a secret in the API-key sense. Jointly they are
precise targeting information: an account id is the first thing needed for
cross-account role enumeration and `sts:AssumeRole` probing, and the
"long-lived static admin keys in plaintext on this laptop" line names the
highest-value target on the machine.

**The good news, verified rather than assumed.** *Nothing containing these
strings has ever been pushed.* The remote's `refs/heads/main` resolves to a
commit reachable in 15 commits (step 1 below re-checks this), all of which predate
Phase 7; the identifiers were introduced by three Phase 7 commits that are
among the 400-plus commits ahead of the remote. Searching the pushed history
directly found nothing. So this is a **must-decide-before-the-first-push**
item, not a completed public disclosure.

**What has already been done (no human needed).**

- Every occurrence has been redacted from every tracked file in the working
  tree. The finding, its force and its checkability all survive — the docs now
  say "a live IAM **admin** principal for a production account" and name the
  profile as `<admin-profile>`, following the `RB-04-01` `<work-repo>`
  precedent. The operator knows which profile is meant and can re-run the
  command to check the claim.
- `tests/unit/secret-scan.test.ts` now scans every tracked file for those
  identifiers on every test run, in both directions, with no exemption for
  itself. A re-introduction turns the suite red.

**What is OUTSTANDING, and why a human must decide it.** The strings remain in
**local, unpushed commit objects**. Rewriting 400-plus commits of history is
destructive and irreversible, and choosing to accept the exposure instead is a
risk decision only the account's owner can make. This agent will not do either
unasked.

**Procedure, before the first `git push` to the public remote — pick ONE:**

1. Confirm the identifiers really are unpushed and really are still in local
   history:
   - `git ls-remote --heads origin`
   - `git log --all --oneline -S"$KYPI_REDACTED_ACCOUNT_ID"`
     (export `KYPI_REDACTED_ACCOUNT_ID` in the shell first; it is deliberately
     not written down in this repository)
2. **Option A — rewrite.** Run a history filter (`git filter-repo --replace-text`
   with the account id, ARN and profile name as replacements) over the whole
   local history, then force-push. Every commit SHA after the first affected
   commit changes; any other clone must be re-cloned. This is the only option
   that makes the strings unrecoverable.
3. **Option B — accept.** Push as-is and treat the identifiers as public.
   Then rotate that principal's access keys and re-scope it away from
   long-lived static admin credentials, because the "plaintext admin keys on
   this laptop" claim is the part that actually matters and it is true.
4. Whichever is chosen, record the choice and its date in this entry and flip
   the status — in **both** the summary-table row and the `**Status:**` line
   above, or `tests/unit/docs-policy.test.ts` reports `INCONSISTENT`.

**Expected output.** Step 1's `git ls-remote` names a remote `main` that does
not contain any of the redacted strings. After Option A, the same
`git log --all --oneline -S...` search returns nothing. After Option B, it
still returns the three Phase 7 commits and the entry records that this is
accepted rather than missed.

**Offline proxy:** `tests/unit/secret-scan.test.ts` — proves no *tracked file*
carries any of the denied identifiers, and (Direction 2) that the scanner
genuinely fires when one is present, so the empty result is a measurement
rather than a broken matcher. It says nothing about **commit objects**, which
is this entry and cannot be substituted: a working tree can be clean while
every historical blob still holds the string.

---

## Phase 8 — Quality Gates & Engineering Quality

Phase 8 built the quality layer end to end — a four-leg deterministic gate
stage (`quality/gates.ts`), the REVIEW artifact's forced schema and validator
(`quality/review-schema.ts`), a reviewer dispatched through the Phase 2
chokepoint (`quality/reviewer.ts`), refute-or-promote and the bounded review
loop (`quality/verdict.ts`), advisor escalation (`quality/advisor.ts`), and a
seeded-defect calibration harness (`quality/calibration.ts`,
`tests/fixtures/seeded-defects/`) — and wired the deterministic stage into a
real, running `/quick` (plan 08-11). Every mechanism is proven offline against
a scripted `fauxProvider`; none of it has ever run against a live model, a
really-installed `@narumitw/pi-lsp`, or a real `pi-subagents` spawn, for the
same two reasons Phase 7 already recorded: **Correction 1** — this machine's
live AWS SSO / static admin credentials are not a permission to run a
`[RUNBOOK]` item, and it holds no *provider* inference credentials regardless
— and **Correction 2** — the five packages Phase 7 pinned, including
`pi-subagents@0.76.1` and `@narumitw/pi-lsp@0.49.9`, have never been
installed (`RB-07-02`, OUTSTANDING). Three entries follow, each citing the
prior-phase entry that blocks it rather than restating that entry's own
procedure.

`tests/unit/docs-policy.test.ts` guards these statuses exactly as it guards
every earlier phase's: it parses both the summary-table row and the
`**Status:**` line of every `RB-<phase>-<n>` entry, and a disagreement
between the two is reported as `INCONSISTENT`, which is never an acceptable
status.

| ID | Check | Status |
|----|-------|--------|
| RB-08-01 | GATE-10 — main-loop thinking budgets land on the wire, one real turn per provider | OUTSTANDING |
| RB-08-02 | GATE-01 — the LSP leg against a really-installed `@narumitw/pi-lsp` and a real language server | OUTSTANDING |
| RB-08-03 | GATE-02/GATE-08 — the reviewer through a real `pi-subagents` spawn, and a live-model calibration run | OUTSTANDING |

### RB-08-01 — GATE-10: main-loop thinking budgets land on the wire

**Status:** OUTSTANDING

**Why this cannot be done here.** Plan 08-01 fixed and proved the NESTED
half of GATE-10 offline: `buildNestedApiOptions` sends the correct
per-`model.api` thinking shape for a nested single-shot call (reviewer,
advisor, vision, summariser), against two faux providers registered under
the real `ROLE_MAP`-resolved api ids. GATE-10's own requirement text draws
the line explicitly — *"main-loop budgets apply only if the wire inspector
proved the parameters land"* — and the main loop's own dispatch
(`pi.setModel()`, Pi's ordinary session turn loop) is a structurally
different code path from `runSingleShotRole`, one this repository does not
control the internals of. Reading a real wire dump is the only way to answer
it, and that needs the same thing `RB-02-01` needs and does not have: live
provider credentials and egress from this machine. This entry is gated
behind `RB-02-01`, itself OUTSTANDING for the identical reason.

**Precondition.** Run this only after `RB-02-01`'s own procedure has been
run at least once on the work laptop — the same credentials, the same wire
log location, no separate setup.

**Procedure, on the work laptop, one real turn per provider with a
main-loop thinking level actually selected:**

1. Run `/balanced` or `/max` (either sets a non-default main-loop thinking
   level for the `executor` role; `/cheap` does not, and is not a
   discriminating case for this check).
2. Run one ordinary turn with each configured provider selected in turn
   (DeepSeek-direct, DashScope, Bedrock Claude) — reuse `RB-02-01`'s own
   step 1/3 procedure rather than restating it here.
3. After each turn, read the last three request records so all three
   providers' turns are visible in one read:
   `cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 3`
4. Compare each provider's payload against the SAME per-`model.api` shape
   plan 08-01 proved for the nested path — a `thinking`/`reasoning_effort`
   pair for DeepSeek-direct, `enable_thinking`/`reasoning_effort` for
   DashScope, a non-empty `additionalModelRequestFields` for Bedrock Claude
   — and confirm the effort itself matches the mode just selected, not only
   that some thinking field is present.

**Expected output.** Each provider's `main.request` record carries the
thinking parameters `RB-02-01` already documents for that provider, with an
effort value matching the main-loop mode actually selected in step 1 — not
merely present, but present at the configured level.

**Offline proxy:** `tests/integration/gate10-nested-thinking.test.ts` (plan
08-01) — proves `buildNestedApiOptions` selects the correct per-`model.api`
thinking shape for a NESTED single-shot call, on two faux providers
registered under `ROLE_MAP`'s own resolved candidates. It proves the nested
path's shape-selection logic is correct. It says nothing about the main
loop's own dispatch, which never calls `buildNestedApiOptions` at all and is
this entry, and cannot be substituted.

### RB-08-02 — GATE-01: the LSP leg against a really-installed language server

**Status:** OUTSTANDING

**Why this cannot be done here.** `quality/gates.ts#probeLspAvailability`
reads the live, registered tool-name list — never `.pi/settings.json` — and
on this machine that list never contains `lsp_diagnostics`/`lsp_fix`,
because `@narumitw/pi-lsp@0.49.9` is pinned and **not installed**
(Correction 2, `RB-07-02`, OUTSTANDING). The LSP leg's `UNAVAILABLE` state,
now genuinely wired into a real `/quick` run (plan 08-11), is not a finding
about the leg's own logic — it is the honest, structurally-distinct-from-PASS
report of an absent dependency. Whether the leg reports `FAIL` against a
real type error, once the package and a real language server are both
present, cannot be exercised without them.

**Precondition.** Run this only after `RB-07-02` has completed — installing
the five pinned specs, including `@narumitw/pi-lsp@0.49.9`, and reconciling
`pi list` against `.pi/settings.json`.

**Procedure, on the work laptop, after `RB-07-02`:**

1. Start an interactive Pi session in this repository (`cd ky-pi-agent && pi`)
   with a language server available for TypeScript on this machine (per
   `docs/EXTENSIONS.md`'s documented invocation for `@narumitw/pi-lsp` — this
   step is written as the documented invocation, not a verified command,
   since the package has never run here; treat its exact shape as
   UNVERIFIED until this procedure runs for real).
2. Confirm both `lsp_diagnostics` and `lsp_fix` are registered:
   `pi --list-tools` (or the session's own `/tools` listing, whichever this
   Pi version ships — UNVERIFIED, record which one actually worked).
3. Introduce one real, deliberate type error into a tracked `.ts` file
   outside `.pi/extensions/quality/` (a mismatched return type is enough),
   save it, and run `/quick` against a task naming that file.
4. Read the gate report `/quick` prints on a block, or the turn's own
   `qualityMs`-carrying JSONL row on a clean run, and confirm the LSP leg's
   entry reads `FAIL` — naming the real error — rather than `UNAVAILABLE`.
5. Revert the deliberate error before continuing (`git checkout -- <file>`).

**Expected output.** Step 2 lists both tool names. Step 4's gate report
shows the LSP leg as `FAIL`, carrying the real diagnostic text the language
server produced — never `UNAVAILABLE`, which is the state this repository
has only ever observed with nothing installed.

**Offline proxy:** `tests/unit/quality-gates.test.ts` (plan 08-06) — proves
`probeLspAvailability` correctly reports `UNAVAILABLE` when the supplied
registered-tool-name list is missing either `lsp_diagnostics` or `lsp_fix`
(naming which), and correctly reports the leg as a live participant in
`GateResult` — never silently blocking — when it is. It proves the
three-state mechanism is sound. It has never observed a real language
server's own diagnostic output, which is this entry and cannot be
substituted.

### RB-08-03 — GATE-02/GATE-08: the reviewer through a real subagent spawn, and a live calibration run

**Status:** OUTSTANDING

**Why this cannot be done here.** Two separate claims, bundled into one
entry because both are blocked by the identical fact. `.pi/agents/reviewer.md`
(plan 08-07) ships deliberately unwired — no `AGENT_NAME_BY_ROLE` mapping —
because the reviewer is dispatched via `runSingleShotRole` (`call-model`
mechanism), not a real `pi-subagents` spawn; wiring it up is `pi-subagents`
work this machine cannot exercise, since the package has never been
installed (Correction 2, `RB-07-02`, OUTSTANDING). Separately,
`tests/fixtures/seeded-defects/`'s calibration run (plan 08-10, corrected
WR3-02 in `08-REVIEW.md` iteration 3) reports a **scripted** faux
reviewer's catch rate — 2 of 6, 0.333... — which measures the scorer, not
a model's judgement: no live reviewer, of any kind, has ever run against
this corpus. (This number was 3 of 6, 0.5, before WR3-02: the fixture's
`false-label` finding had been edited in the same commit that raised the
matcher's needle bar, which held the reported number constant by
construction rather than by measurement — see `docs/QUALITY.md`'s own
WR3-02 disclosure for the full account.) Both halves need the same two
things this machine does not have: `pi-subagents` actually installed, and
a live model credential.

**Precondition.** Run this only after `RB-07-02` has completed.

**Procedure, on the work laptop, after `RB-07-02`:**

1. Wire `.pi/agents/reviewer.md` into `AGENT_NAME_BY_ROLE` (retiring
   `tests/unit/subagent-agents-config.test.ts`'s `UNROUTED_AGENT_ALLOWLIST`
   entry this phase added for it) and spawn it as a real subagent on a small
   real diff, confirming it receives the six-element contract
   `quality/reviewer.ts#buildReviewerContext` assembles and returns a
   `submit_review` tool call `quality/review-schema.ts#validateReview`
   accepts.
2. Run the seeded-defect calibration corpus (`tests/fixtures/seeded-defects/`)
   through the now-real reviewer instead of the scripted faux one used in
   plan 08-10's own test, and record the resulting `CalibrationResult` —
   `caught`/`total`/`catchRate`/`perDefectClass`/`unmatchedFindings` — exactly
   as `quality/calibration.ts#scoreCalibration` reports it, never rounded and
   never accompanied by a verdict string.
3. Record the real catch rate, distinct from the 0.333... scripted number
   `08-10-SUMMARY.md` originally recorded (corrected to 2/6 by WR3-02,
   `08-REVIEW.md` iteration 3):
   `echo "RB-08-03 live catch rate: <caught>/<total>, $(date -u +%FT%TZ)" >> RB-08-03-RESULT.md`

**Expected output.** Step 1: the spawned reviewer's tool call passes
`validateReview` (or is rejected with a named, specific reason — either
outcome is informative; a spawn that never calls `submit_review` at all is
the failure this entry is watching for). Step 2: a `CalibrationResult` with
a real, non-scripted `catchRate` — expected to differ from 2/6, in either
direction, since a live model was never tuned to this corpus the way the
scripted reviewer was.

**Offline proxy:** `tests/integration/reviewer-contract.test.ts` (plan
08-07) and `tests/integration/reviewer-calibration.test.ts` (plan 08-10) —
prove the context contract reaches a captured outgoing request intact and
redacted, and that `scoreCalibration` computes a real, reproducible,
non-rounded ratio from real input, against a `fauxProvider` this repository
scripted itself. Both prove the pipeline is sound end to end. Neither has
ever seen a real model's judgement or a real `pi-subagents` spawn topology,
which is this entry and cannot be substituted.

## Phase 08.1 - Pi 1.x Upgrade

Dated install log, not an outstanding check (no RB id).

### Global install log (2026-10-13, local; 2026-10-12T16:27Z)

- Pre-state: `pi --version` 0.84.1; `kyPiAgent` `{"bootstrapVersion":"1","hardenedNpmRoot":"~/.pi/agent/npm","piPinned":"0.84.1"}`
- Command: `sh bin/bootstrap.sh` (internally `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.1.0`)
- Post-state: `pi --version` 1.1.0; `npm ls -g --depth=0` shows `%APPDATA%\npm` with `@earendil-works/pi-coding-agent@1.1.0`; `kyPiAgent` `{"bootstrapVersion":"1","hardenedNpmRoot":"~/.pi/agent/npm","piPinned":"1.1.0"}`
- Bootstrap also rewrote the user-scope `ky-safety/index.ts` stub (old re-export format); post-install `sh bin/bootstrap.sh --check-only` exits 0.

### Operator steps for another machine

1. Close all Pi sessions first (Windows EBUSY on the global package otherwise).
2. Run `sh bin/bootstrap.sh`.
3. Expect `pi --version` to print 1.1.0.

### Notes

- `powershell` must never be added to `defaultTools`; the safety guard is bash-AST based.
- Pi 1.x defaults to a fullscreen TUI; `tuiMode: "regular"` restores scrollback if that is unwanted (user preference).
- `RB-07-01` and `RB-07-02` remain OUTSTANDING, now against the re-pinned specs in `.pi/settings.json`.
- Supply-chain posture after Pi dropped its shrinkwrap: see CONTRIBUTING.md.

## Phase 08.2 - Comment Discipline

Phase 08.2 delivers the code-comment rules to every project Pi runs in. The offline half is proven by a faux session; the live half needs a real provider credential and the installed package.

| ID | Check | Status |
| --- | --- | --- |
| RB-08-04 | CMT-02 — the harness injects the comment rules into a real Pi session in another project | OUTSTANDING |

### RB-08-04 — CMT-02: comment rules reach a real session in another project

**Status:** OUTSTANDING

**Why this cannot be done here.** It needs a live provider credential and the package installed into Pi, neither of which this machine has for a throwaway project.

**Offline proxy:** `tests/unit/comment-rules-delivery.test.ts` drives a faux session and asserts the rules appear once in the outgoing system prompt.

Steps:

1. `cd` into a project without its own `## Code comments` heading.
2. Run the exact command `pi -p "Quote the first bullet under the Code comments heading in your system prompt, verbatim."`
3. Expected output begins `Default to no comment`.
4. Record the date and result.

## Phase 9 — Ceremonial Workflows

Phase 9 built `/grill`, `/plan`, `/execute` and `/review` and proved each offline: the SPEC and PLAN gates, the evidence-gated PROGRESS append, computed scope drift, the REVIEW.md renderer, the MR step against a stubbed `glab`, and the pure handoff-packet builder. None of it has run against a live model, a real GitLab, or a real `pi-subagents` spawn, for the two reasons recorded in Phases 7 and 8: **Correction 1** (this machine holds live static AWS admin credentials and no provider inference key, so it must not be used to exercise a live check) and **Correction 2** (`pi-subagents` is pinned and never installed, `RB-07-02`). Three entries follow. `docs/WORKFLOWS.md` describes what the code does and states the same limits.

| ID | Check | Status |
|----|-------|--------|
| RB-09-01 | FLOW-08 — one real feature shipped end to end through `/grill`, `/plan`, `/execute`, `/review` on the work laptop | OUTSTANDING |
| RB-09-02 | FLOW-08 — a real `glab mr create --target-branch staging` against the work GitLab | OUTSTANDING |
| RB-09-03 | FLOW-09 — a real `pi-subagents` handoff spawn consuming a packet, and the measured parent-token delta | OUTSTANDING |

### RB-09-01 — FLOW-08: one feature end to end through the four workflows

**Status:** OUTSTANDING

**Why this cannot be done here.** It needs a live provider inference key and a real work repository. This machine holds live static IAM admin credentials in plaintext at `~/.aws/credentials` and no provider inference key is configured for Pi (Corrections 1 and 2), so it must not run a live feature.

**Procedure, on the work laptop.**

1. In `<work-repo>`, pick one small real feature and run `/grill`, then `/plan`, then `/execute` until every task is done, then `/review`.
2. Read the artifacts the run left: `cat .pi/work/<slug>/PROGRESS.md`
3. Compare what changed against what SPEC.md declared: `git diff --name-only $(git merge-base HEAD staging)..HEAD`
4. Record the date, the slug and whether REVIEW.md's Scope Drift section agreed with step 3.

**Expected output.** Four files under `.pi/work/<slug>/` (SPEC.md, PLAN.md, PROGRESS.md, REVIEW.md) and nothing else; PROGRESS.md entries each carry a real commit SHA and pasted command output; REVIEW.md's drift lists match step 3. A refusal at any gate with a named reason is also informative.

**Offline proxy:** `tests/integration/grill-command.test.ts`, `tests/integration/plan-command.test.ts`, `tests/integration/execute-workflow.test.ts`, `tests/integration/scope-drift.test.ts` and `tests/unit/artifact-count.test.ts`. They prove each command's gates against scripted input and a temp git repo. They are not the check: no model has ever driven the four commands in sequence.

### RB-09-02 — FLOW-08: a real merge request targeting staging

**Status:** OUTSTANDING

**Why this cannot be done here.** It needs the work GitLab and an authenticated `glab`. The repository is named `<work-repo>` here and never by URL: this file is public, and account-identifying hosts and paths do not belong in it (`RB-07-03`).

**Procedure, on the work laptop.**

1. Confirm the flag `/review` uses for the MR body exists in the installed glab: `glab mr create --help | grep -i description`
2. Run `/review` on a branch of `<work-repo>` that has a staging target.
3. Inspect the result: `glab mr view <iid>`
4. Record whether the MR opened, its target branch, and whether the body matches the evidence in PROGRESS.md.

**Expected output.** The MR exists, its target is `staging`, and its description carries the evidence-built body with the disclosure line. Open question this run settles: `mr.ts` passes the body with `--description-file`, and that flag name has never been checked against a real glab. If step 1 shows no such flag, `/review` fails on a real MR even though the stub passes, and that is a bug to fix in `mr.ts`. `/review` diffs against `git merge-base HEAD staging`, so the run also needs a local `staging` ref.

**Offline proxy:** `tests/integration/review-mr.test.ts` drives the MR step against an injected executor and a stubbed `glab` on PATH. It proves the harness classifies the argv before executing and always names an explicit staging target. It proves nothing about GitLab accepting the request, the target existing, or server-side branch protection (`RB-04-01`).

### RB-09-03 — FLOW-09: a real subagent handoff and the measured token delta

**Status:** OUTSTANDING

**Why this cannot be done here.** `pi-subagents` is pinned and not installed.

**Precondition.** `RB-07-02` (install the five pinned specs, with a human physically present for the package-legitimacy gate) must complete FIRST. Nothing is installed to satisfy this entry.

**Procedure, on the work laptop, after `RB-07-02`:**

1. Confirm the offline builder still passes: `npx vitest run tests/unit/handoff-packet.test.ts --maxWorkers=2`
2. Run `/execute` on a PLAN.md with at least four tasks so it dispatches a task as a real subagent consuming a handoff packet. Without the subagent tools it degrades to the ordinary prompt loop and says so; that outcome does not satisfy this entry.
3. Read the parent session's token usage for the dispatch turn and the packet size, and compare with the baseline below.
4. Record the result: `echo "RB-09-03 parent-token delta: <live>, packet <tokens>, $(date -u +%FT%TZ)" >> RB-09-03-RESULT.md`

**Offline baseline (estimate, not a tokenizer).** For a five-requirement SPEC and four-task PLAN fixture, `estimateTokensFromChars` (`Math.ceil(chars / 4)`) gave packetTokens=134, parentTokens=581, deltaTokens=-447 (534 vs 2322 chars). The packet was smaller than the context it replaces for that fixture. The live run reports its own sign as measured; a positive delta is a real result and is recorded as one.

**Expected output.** A spawned subagent that works from the packet alone, and a recorded live delta beside the -447 estimate.

**Offline proxy:** `tests/unit/handoff-packet.test.ts` covers the pure packet builder, the `UNAVAILABLE` availability probe and the delta arithmetic. No subagent has ever spawned, and the arithmetic asserts no sign.
