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

1. `cat .pi/logs/turns-*.jsonl | grep -F '"event":"prose_tool_call"' | grep -v '"kind":' | wc -l`
2. `cat .pi/logs/turns-*.jsonl | grep -cF '"kind":"turn"'`
3. `cat .pi/logs/turns-*.jsonl | grep -cF '"event":"prose_tool_call_retry_exhausted"'`
4. Open the log and find one turn carrying `prose_tool_call`, then read the
   turn immediately after it.

**Expected output.** Steps 1 and 2 give a numerator and a denominator; their
ratio is the measured prose rate, to be compared against the ~11% baseline
reported in the open DeepSeek-V3 issue. Step 3 is the turns where the nudge did
not work, and is worth recording beside the rate rather than folded into it.
Step 4 must find at least one instance where the following turn contains a real
tool call — that is what distinguishes "the retry recovered the turn" from "the
retry bought a second paragraph of prose". A day that produces a zero numerator
is a result worth recording too, but it is not this check passing: it means the
rate is low enough that the sample is too small, and the check stays open for a
longer window.

**Why each step is shaped the way it is.** Every detected prose turn leaves *two*
records carrying `event: prose_tool_call` — the turn's own composed row and the
standalone out-of-band record — and only the standalone one has no `kind`. So
step 1 counts the ACTIONS by dropping the turn rows with `grep -v '"kind":'`.
Without that filter the numerator is roughly doubled against a denominator that
is correct, and since the comparison is against a published ~11% baseline, a
2-3x inflated rate would read as loud confirmation of the leading root-cause
hypothesis. The `cat` is not decoration either: `grep -c` over a glob prints
`file:count` per file rather than one total, so with any rotation at all the
un-piped form yields neither a numerator nor a denominator. `-F` pins the
pattern as a fixed string; the trailing `"` is what already keeps
`prose_tool_call_retry_exhausted` out of step 1's count, which is why step 3
has to ask for it separately.

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
