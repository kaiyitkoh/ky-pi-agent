# Diagnostics — what the logs contain and what they do not

This file exists so a later phase can read `.pi/logs/` without reading the code.
Phase 2 built an instrument: every model request this harness makes leaves a
redacted copy of its bytes in one stream and a per-turn row of numbers in
another. Phases 5, 8 and 10 are all supposed to answer questions from those two
files — *which model actually ran*, *was `/max` worth it for the reviewer*, *how
often does the daily driver write a tool call in prose*. None of that works if
the meaning of a column has to be reverse-engineered from a hook handler.

**The contract of this file.** It is the schema of record for
`.pi/logs/wire-<date>.jsonl` and `.pi/logs/turns-<date>.jsonl`. Every field
named here exists in `.pi/extensions/diagnostics/schema.ts`, and every claim
about behaviour carries a `file:line` citation in the same
`[VERIFIED: …]` / `[CITED: …]` style the source files use. **If the code and
this document disagree, the code is authoritative and this document is a bug.**
Fix the document; do not fix the code to match the document.

**Ownership.** `.pi/extensions/diagnostics/` is Phase 2's subsystem. `callModel`
is its cross-phase export and Phases 5 and 8 import it. Later phases add fields
to these rows; when they do, they add a row to the tables here in the same
change.

---

## Where the logs live and how they rotate

Two streams, both under Pi's config directory:

```
.pi/logs/wire-YYYY-MM-DD.jsonl        the redacted request/response dump   (DIAG-01, DIAG-07)
.pi/logs/wire-YYYY-MM-DD.1.jsonl      rotated; a larger N is older
.pi/logs/turns-YYYY-MM-DD.jsonl       one row per turn AND per nested call (DIAG-04)
.pi/logs/turns-YYYY-MM-DD.1.jsonl
```

The directory is `join(cwd, CONFIG_DIR_NAME, "logs")`, never a hardcoded `.pi` —
a rebranded Pi distribution uses a different config directory name, and
`CONFIG_DIR_NAME` is exported for exactly that reason. The date is **local**,
not UTC, because a log is read by a human in their own day.

| Knob | Value | Constant |
|---|---|---|
| Rotate `wire-*` at | 32 MB | `WIRE_ROTATE_BYTES` |
| Rotate `turns-*` at | 8 MB | `TURNS_ROTATE_BYTES` |
| Rotated files kept per stream per day | 10 | `MAX_ROTATED_FILES` |
| Days of history kept | 14 | `RETENTION_DAYS` |

A captured payload measured ~50 KB in this repository, so 32 MB is roughly 600
turns — about a heavy day — and still opens in an editor. A turn row is ~600 B,
so 8 MB is roughly 14,000 turns. Beyond `MAX_ROTATED_FILES` the oldest file is
unlinked, oldest-first. Retention is pruned at `session_start`, which also
writes a `diagnostics.session_start` record carrying `prunedFiles`.

Records are appended with an open-write-close per record, never through a
long-lived stream. That is deliberate: a writer holding a file descriptor across
a rename keeps writing into the *rotated* file, and with per-call open-write-close
that window is a single write. Concurrent appends from four separate processes
were executed at three record sizes and produced no torn lines
[VERIFIED: executed 2026-08-13, win32, node v24.16.0 — 02-RESEARCH.md §10.3].

**Both paths are gitignored, and that is the outer control, not the real one.**
`tests/unit/logs-gitignored.test.ts` asks `git check-ignore --no-index` about
every path the writer actually produced — not a hand-written list of names
someone remembered, but `producedPaths()` after a forced rotation. A green run
there means the declared rules classify every produced path correctly. It does
**not** mean a prompt body can never reach a public remote: `git add -f` bypasses
ignore rules entirely. That is precisely why redaction happens at capture and the
ignore rules come second.

---

## The turns row

One JSON object per line. Every field of `TurnRow`, its meaning, and the hook it
came from. Provenance is 02-RESEARCH.md §5.5; the type is
`.pi/extensions/diagnostics/schema.ts`.

| Field | Optional | Meaning | Source |
|---|---|---|---|
| `ts` | | `Date.now()` at row composition | — |
| `kind` | | `"turn"` for a main-loop turn, `"nested"` for a `callModel` | — |
| `role` | | the executor this ran as: `"session"` on the main loop, `opts.role` on a nested call | — |
| `sessionId` | | `ctx.sessionManager.getSessionId()` | — |
| `corr` | | correlation id joining this row to its `wire-*` records | `before_provider_headers` / `callModel` |
| `turnIndex` | yes | the turn's index in the session; absent on a nested call, which has no turn | `turn_end` |
| `provider` | | provider id as the message reports it | `message_end` |
| `model` | | model id as requested | `message_end` |
| `responseModel` | yes | present **only when it differs from `model`** — OpenRouter `auto` reports the model it resolved to | `message_end` |
| `input` | | prompt tokens | `message_end` |
| `output` | | completion tokens, **including** reasoning tokens | `message_end` |
| `cacheRead` | | tokens served from the prefix cache | `message_end` |
| `cacheWrite` | | tokens written to the prefix cache | `message_end` |
| `cacheWrite1h` | yes | the subset of `cacheWrite` written with **1h retention**. **Key omitted unless the provider reports the split** — only Anthropic does [VERIFIED: pi-ai 0.84.1 `dist/types.d.ts:258-259`]. Recorded because `calculateCost` prices this portion at **2x the `input` rate**, not the `cacheWrite` rate [VERIFIED: pi-ai `dist/models.js:538-543`], so without this column `cost.cacheWrite` cannot be reproduced from the row | `message_end` |
| `totalTokens` | | provider-reported total | `message_end` |
| `reasoning` | yes | reasoning tokens, a subset of `output`. **Key omitted when the provider reports no breakdown** — see the closed door below | `message_end` |
| `cacheReadRatio` | yes | `cacheRead / (input + cacheRead)`; **omitted unless the denominator is strictly positive**, because a ratio of nothing is not zero — and a non-finite denominator is not a measurement either, so it is omitted rather than serialised as `null` | derived |
| `cost` | | `{input, output, cacheRead, cacheWrite, total}` in dollars | derived via `calculateCost` |
| `latencyMs` | | `turn_end` wall clock minus `turn_start.timestamp` | `turn_start` + `turn_end` |
| `stopReason` | | the provider's own word, one of the seven members of Pi's union | `message_end` |
| `rawStopReason` | yes | the provider's unmapped string, when it supplied one | `message_end` |
| `outcome` | | this project's coarse verdict, mapped from `stopReason` through `OUTCOME_BY_STOP_REASON`. Kept **alongside** `stopReason`, never instead of it: the mapping is an interpretation and the evidence for it must stay readable | derived |
| `errorMessage` | yes | `message.errorMessage`, passed through the redactor; absent when there was none | `message_end` |
| `toolCalls` | | count of `content[].type === "toolCall"` in the assistant message | `message_end` |
| `toolResults` | yes | `event.toolResults.length`; absent on a nested call | `turn_end` |
| `httpStatus` | yes | HTTP status as `onResponse` reported it. **Only ever present on a `kind:"nested"` row** — `turn_end` never derives one, so a main-loop turn never carries it, successful or not. On a nested call `callModel` always supplies an `onResponse`, so the field is present whenever an HTTP response was seen — **including on an errored row**, where `outcome:"error"` and `httpStatus:200` legitimately sit side by side | `callModel`'s `onResponse` |
| `thinkingLevel` | yes | the **requested** thinking level, recorded because Bedrock makes the thinking cost undecomposable after the fact | `ctx.thinkingLevel` |
| `qualityMs` | yes | the quality layer's **own share** of this turn's wall clock — the deterministic gate stage plus any nested review calls it issued. **Key omitted when the quality layer did not run on this turn** — never `0`, never `null`. This is **not** the turn total: `latencyMs` is the turn total, `qualityMs` is the portion of it the quality layer spent, and the two are not comparable without that distinction | `quality-cost.ts#takeQualityCost`, drained once at `turn_end` |
| `qualityTokens` | yes | the quality layer's own summed input+output tokens for this turn. Same omission rule as `qualityMs`. A nested quality-layer call **also** emits its own `kind:"nested"` row with its own `cost` — `qualityTokens` is an attribution convenience layered on top of those rows, not a replacement for them, so a token counted here is also counted on that nested row. Summing `qualityTokens` across `kind:"turn"` rows and separately summing `totalTokens` across `kind:"nested"` rows measures the same spend from two different groupings; adding the two together double-counts it, and that is expected, not a bug | `quality-cost.ts#takeQualityCost`, drained once at `turn_end` |
| `event` | yes | set only on an out-of-band or marked row: `prose_tool_call`, `prose_tool_call_retry_exhausted`, `diagnostics.error`, `diagnostics.model_unavailable` | varies |

**The omission rule, stated once for all of the above.** An optional field is
*genuinely absent* from the JSON, not present-and-`null` and not present-and-`0`.
The composer assigns optional fields after building the object literal, so
`Object.keys` can tell "not reported" apart from "reported as zero". Any consumer
that treats a missing key as `0` is reintroducing exactly the fabrication this
rule exists to prevent.

### Rows that are not turns

Some records in `turns-*.jsonl` carry **no `kind`**. That is the discriminator: a
per-turn total sums over `kind:"turn"`, and these are deliberately excluded.

| `event` | What happened | Extra fields |
|---|---|---|
| `diagnostics.session_start` | a session began; retention was pruned | `prunedFiles` |
| `diagnostics.error` | a diagnostics handler threw and was caught | `where` (the handler name), `error` (redacted) |
| `prose_tool_call` | the detector fired and a retry was sent | `tool`, `corr`, `sessionId` |
| `prose_tool_call_retry_exhausted` | the detector fired again with the retry budget already spent | `tool`, `corr`, `sessionId` |

A `diagnostics.error` row exists because Pi catches every exception thrown by an
extension handler and routes it to `emitError`, which produces no visible output
[VERIFIED: pi 0.84.1 src/core/extensions/runner.ts:861-870, observed live during
Phase 2 research]. Without this row a broken instrument looks exactly like a
quiet one: the log simply stops. Two more markers exist for the same reason —
`diagnostics.model_unavailable` on a row whose cost was computed from a degraded
zero-rate model shape, and a `diagnostics.error` with
`where: "turn_end.no_message"` on a turn that produced no assistant message at
all. A missing measurement is written down as missing; it is never a skipped
append.

---

## The `reasoning` key — a closed door, do not re-litigate

**Absence of `reasoning` means the provider does not report a reasoning
breakdown. It does not mean zero thinking tokens were billed.**

Bedrock's Converse metadata handler assigns `input`, `output`, `cacheRead`,
`cacheWrite` and `totalTokens` and never assigns `reasoning`, so it stays
`undefined` [VERIFIED: pi-ai 0.84.1 src/api/bedrock-converse-stream.ts:589-602].
The OpenAI-compatible adapter does assign it, from
`completion_tokens_details.reasoning_tokens`
[VERIFIED: pi-ai src/api/openai-completions.ts:1404]. So on a Bedrock Claude row
the key is absent while thinking tokens were unambiguously charged, and on a
DeepSeek row it is present.

Writing `0` there would report Bedrock thinking as free — a fabricated
measurement, and the specific thing the project's locked decisions forbid.
Writing `null` invites a chart that renders it as zero anyway. The key is
omitted. If you need "was thinking requested on this turn?", read
`thinkingLevel`, which is the requested input and is recorded for precisely this
reason.

---

## The wire record

One JSON object per line in `wire-*.jsonl`. Six record kinds:

| `kind` | Carries | When |
|---|---|---|
| `main.headers` | `headers` (redacted) | `before_provider_headers`, main loop |
| `main.request` | `payload` (redacted) | `before_provider_request`, main loop |
| `main.response` | `status`, optional `headers` | `after_provider_response`, main loop |
| `nested.headers` | `headers` (redacted) | `callModel`'s `transformHeaders` |
| `nested.request` | `payload` (redacted) | `callModel`'s `onPayload` |
| `nested.response` | `status`, optional `headers` | `callModel`'s `onResponse` |

Every record also carries `ts`, `corr`, and optionally `role` and `sessionId`.
Response headers are worth keeping — rate limits, request ids and cache
indicators live there — but `headers` is optional on the response arm because
Bedrock supplies only `x-amzn-requestid`
[VERIFIED: pi-ai src/api/bedrock-converse-stream.ts:255-261] and Pi's own docs
warn that a provider abstracting HTTP may expose none at all
[CITED: pi 0.84.1 docs/extensions.md:708].

**`corr` is the join key.** It is `<sessionId>#<n>`, where `n` is a process-wide
counter, and it is what ties a `turns-*` row to the bytes that produced it. The
counter lives on `globalThis` rather than in a module-level variable: jiti can
produce two instances of one module in a single process, and two instances each
starting at 1 stamp the same id into the same log — which mis-joins a nested
call's bytes onto a different call's row. That was observed, not theorised, while
plan 02-07 was written. A wrong join looks like an answer, which makes it worse
than no id at all.

**There is no per-attempt id, and its absence is deliberate.** On the main loop
`before_provider_headers` fires once per *logical* request: `transformHeaders`
runs inside `ModelRuntime.prepareRequest`
[VERIFIED: pi src/core/model-runtime.ts:590-593] while provider-level retries
happen further down, wrapped around the SDK call
[VERIFIED: pi-ai src/api/openai-completions.ts:245-252]. Pi's docs say it
outright: *"Runs once per provider request; retries reuse the same headers rather
than re-firing the hook."* [CITED: pi 0.84.1 docs/extensions.md:676]. So `corr`
identifies one headers/request/response triple. An `attempt` field is absent
rather than fabricated. A row carrying `corr: "uncorrelated"` is a record
composed before any id had been issued.

---

## Redaction

**Redaction happens at capture, inside the hook, never at read.** A log file is
only ever written already-clean; nothing downstream is trusted to sanitise it.
`redactDeep` returns a *new* structure and never mutates its argument, because
`before_provider_request` hands over the live payload and an in-place edit would
change what the provider actually receives.

Two independent rules, and the key rule is stronger than the shape rule:

1. **By key name**, applied to header maps *and to object keys inside a payload*.
   A closed list — `authorization`, `x-api-key`, `api-key`,
   `cf-aig-authorization`, `x-goog-api-key`, `proxy-authorization`, `cookie`,
   `set-cookie` — plus an open pattern for any key that *names* a credential:
   `/(^|[-_])(api[-_]?key|token|secret|credential|password)([-_]|$)/i`. The list
   goes stale the first time a provider invents a header; the pattern is what
   catches `x-session-token` and `client-secret` without having predicted them.

   This is **not header-only**. A captured payload can nest a header map, and
   `{ authorization: "…" }` there is the same credential it would be in the
   header hook. A string value under such a key becomes `[redacted:<n> chars]`;
   **any other value becomes `[redacted:truncated]` and the whole subtree under
   the key goes** — a key that says "credential" is better evidence than any
   shape heuristic, so `{ authorization: { scheme: "Bearer", token: "short123" } }`
   is not left to shape matching that would miss a short or unusual secret.
   Over-redacting is the right way to be wrong here. `null` and `undefined` are
   the one exception and pass through: `null` means *delete this header*, and
   rewriting it would misreport a deletion as a secret.
2. **By value shape**, applied to strings anywhere in a payload. Eleven patterns:
   `sk-…`, `AKIA…`, `ASIA…`, `gh[pous]_…`, `github_pat_…`, `xox[bp]-…`, `AIza…`,
   `pt-…`, a PEM private-key header, `Bearer …`, and an
   `aws_secret_access_key = …` line. This second rule is the one that matters
   most in practice: the realistic hazard is not the API key — the wire payload
   never carries it — but a `.env` or a `*.tfstate` the model read into
   `messages[]`.

**Two placeholders, and they mean different things.**

`[redacted:<n> chars]` preserves the length, and is written for a **string** that
matched either rule. Keeping the length makes *"was a credential present at all,
and roughly which one?"* answerable from a dump without the dump containing the
answer.

`[redacted:truncated]` preserves nothing, and has **exactly three causes**, which
a reader cannot tell apart from the dump alone:

- a subtree that blew the **depth** budget (24) or the **node** budget (200,000)
  — replaced wholesale rather than partially walked, because a partial walk would
  look like data;
- a **non-string, non-nullish value under a credential-named key**, per rule 1;
- **any object that is not a plain object or an array** — a class instance, a
  `Map`, a `Set`, a typed array. These used to be returned by reference and
  un-walked while `JSON.stringify` still emitted their enumerable properties, so
  a credential-shaped string inside one reached disk verbatim. `Date` is the one
  exception and survives as its own ISO string, because an ISO timestamp matches
  no credential shape and mangling clean data is a failure too.

So a `[redacted:truncated]` in a dump does **not** by itself mean the payload was
pathologically deep. It is equally likely that a credential-named key was present
or that an adapter handed over a class instance.

**The fidelity cost, stated.** The third cause fires at the payload **root** too.
If an adapter ever hands `before_provider_request` something that is not a plain
object, the whole record's `payload` becomes the bare string
`[redacted:truncated]` and that request is lost from the dump. Nothing today is
known to do that — but the only evidence that real payloads are plain objects is a
hand-built fixture, and `tests/integration/wire-capture.test.ts` says of it that
this "makes it realistic and does not make it real". A wire dump that is suddenly
one placeholder per request is this, not a depth explosion.

`tests/unit/redact.test.ts` drives the matcher in **both** directions: every
pattern has a sample proving it fires, and clean samples prove ordinary text
survives byte-identical. A redactor that mangles prose fails the instrument as
surely as one that leaks.

---

## Known limits

Three things this instrument genuinely cannot do. They are written down because
a control that names what it does not cover is a control, and one that implies
completeness is a liability — the same honest-limits posture SAFE-15 requires of
the bash guard.

### Closed door — do not re-litigate: Bedrock credentials never reach the inspector

SigV4 is applied by the AWS SDK's Smithy signing middleware, downstream of
everything Pi hands over, and `ProviderRequestOptions.headers` documents that on
Bedrock the reserved headers `x-amz-*`, `authorization` and `host` are **silently
ignored** to preserve SigV4 / bearer auth
[CITED: pi-ai 0.84.1 src/types.ts:148-153]. The wire inspector therefore never
sees a Bedrock credential in `before_provider_headers`, and no amount of work on
the redactor changes that.

Two consequences. First, the dump is **incomplete on Bedrock by construction**;
saying so is more honest than implying otherwise. Second, `RB-02-02` — the live
check that no real credential survives into a dump — is written around the
DeepSeek / DashScope bearer-token path, where a token genuinely does pass through
the hook. A Bedrock-aimed version of that check would report a clean pass while
exercising nothing.

### Closed door — do not re-litigate: the chokepoint gate does not close every route

`callModel` is the only sanctioned route to the model API, and
`tests/unit/chokepoint-lint.test.ts` fails the build when another file under
`.pi/extensions/` spells a bypass. The gate is a regex over committed text. These
routes reach a model without passing through `callModel`, and the gate cannot
close them:

1. `ModelRegistry.getProvider(id)` and `getRegisteredNativeProvider(name)` hand
   back a `Provider` whose `.stream()` / `.streamSimple()` bypass everything
   [pi src/core/model-registry.ts:96-98, 143-145]. The gate bans the two accessor
   names; it cannot ban holding the object.
2. The model runtime class is a public export of the package
   [pi src/index.ts:184], so it can be constructed directly. The gate bans the
   bare identifier, which a rename defeats.
3. `@earendil-works/pi-ai` exposes `./api/*` subpaths, so an adapter's `stream`
   can be deep-imported outright. The gate bans that import specifier, which a
   dynamic `import()` of a computed string defeats.
4. String-built property access (`ctx["model" + "Registry"]`), a
   destructured-then-renamed registry, and `eval` defeat any grep by
   construction.
5. A **composed third-party extension** (Phase 7) is not under `.pi/extensions/`
   at all, so it is outside the scanned set entirely.
6. `pi.registerProvider` with a hand-written `streamSimple` that calls a real
   endpoint. This is **the realistic future gap**, because ARCHITECTURE.md keeps
   the virtual provider as a deliberate escape hatch.

A model call that goes around `callModel` produces no wire records and no turns
row. It is invisible to every cost figure in this project, not merely
under-counted.

### Closed door — do not re-litigate: `after_provider_response` never fires on a provider error

The adapter's `onResponse` call sits *after* the retry wrapper
[VERIFIED: pi-ai src/api/openai-completions.ts:239], and a 4xx/5xx throws into
the catch at `:590` instead. So `main.response` is absent for exactly the requests
most worth reading.

The consequence is a design rule, not a caveat: **no field of a turns row is
derived from `after_provider_response`.** The row's spine is
`turn_start` + `message_end` + `turn_end`, all three of which fire on a failed
turn. The response hook contributes one optional field, `httpStatus`, and
nothing else. A row built from it would be missing exactly the turns that matter,
and the log would look quiet rather than broken.

---

## Token figures are estimates; character counts are not

`/budget` and any token figure this subsystem derives from a string use
`Math.ceil(chars / 4)`, with roughly **±20% error**. Three things about that,
copied from `budget.ts` rather than re-derived:

- **The formula is Pi's own**, and the only counter Pi ships
  [VERIFIED: pi 0.84.1 src/core/compaction/compaction.ts:266-291, the formula at
  :274]. Pi's `estimateTokens` is exported but takes an `AgentMessage`, not a
  string, so a report about prompt *fragments* needs the same arithmetic spelled
  out locally.
- **No tokenizer exists and none may be added.** Neither
  `@earendil-works/pi-coding-agent` nor `@earendil-works/pi-ai` depends on
  `tiktoken`, `gpt-tokenizer` or anything like them, and
  `tests/unit/pinning.test.ts` fails the build if a dependency appears. Making
  this number exact would trade a labelled ±20% estimate for an unreviewed
  package in a public repo on a laptop holding live AWS credentials.
- **Characters are the measurement; tokens are the estimate.** Every character
  count `/budget` prints is exact. The provider's own `usage.input` from the last
  assistant turn is printed beside the estimates as ground truth, and the
  `input`/`output` columns of a turns row are provider-reported, not estimated.

`/budget` is a **command** and not the other kind of registration, for two
independent reasons. A command costs exactly zero per-turn tokens, whereas the
other kind serialises a name, a description and a complete JSON Schema into
`tools[]` on every single provider request
[VERIFIED: pi-ai 0.84.1 src/api/openai-completions.ts:1337-1370] — so a report
about per-turn token cost would itself become a per-turn token cost, and the
instrument would become the thing it measures. Independently of that,
`getSystemPromptOptions()` — the only exact source of the context-file list and
the skill list — exists on `ExtensionCommandContext` and **not** on the
`ExtensionContext` an event handler or a tool receives
[VERIFIED: pi 0.84.1 dist/core/extensions/types.d.ts:256 versus :219-249]. It
could not have been built the other way.

---

## Per-turn floor

The floor is what every request carries before the user types: the system prompt
plus every active tool schema. `/budget` prints it as one line
(`per-turn floor (system prompt + tool schemas)`), rounded once from the char sum.

**Method.** `tests/integration/context-floor.test.ts` builds a composed faux session
(`tests/helpers/harness-session.ts`): every extension Pi's loader discovers (`*.ts` and `*/index.ts`, including re-exported defaults), the real
`AGENTS.md` and the repo skills, offline, no provider call. It captures the first
outgoing request and runs `computeBudget` over the prompt and tool list. Unit:
`/budget`'s formula, `Math.ceil(chars/4)`, tools counted as
`name + description + JSON(parameters)`. Text is path-normalised (`<cwd>`, `<agent>`,
`<repo>`) so the figures are identical on every machine. Measured 2026-10-13 on
win32, Node 24.16.0, Pi 1.1.0. The four pinned packages in `.pi/settings.json` are
not installed in this harness, so their cost is not in these numbers (it is measured
separately). The Phase 2 figure of 1,850 tokens is the bare-Pi-plus-context-file
configuration, not this composed one.

**BEFORE (no cuts applied).**

| Configuration | system chars | tool chars | floor chars | floor tokens | tools |
|---|---|---|---|---|---|
| bare Pi | 2758 | 2544 | 5302 | 1326 | 4 |
| bare Pi + AGENTS.md | 4567 | 2544 | 7111 | 1778 | 4 |
| full composed | 8479 | 8450 | 16929 | 4233 | 12 |

The wire estimate for the composed tool list (`toToolDeclaration` JSON) is 9206 chars
against 8450 by the `/budget` formula. The two are never compared with each other.
The 4,233 figure is within 1% of the 4,255 estimated in research (the measured
value is the one that counts). Qoder's tool is deactivated when unconfigured, and no
installed package is loaded.

**Per-extension deltas** (floor of bare + AGENTS.md + one entry point, minus bare +
AGENTS.md; zero rows are real measurements):

| Entry point | chars | tokens | tools added | verdict |
|---|---|---|---|---|
| background-tasks/index.ts | 6191 | 1548 | bg_run, bg_status, bg_logs, bg_kill (plus a system-prompt section) | profile-gate |
| quality/index.ts | 511 | 128 | consult_advisor | budgeted |
| questionnaire.ts | 1185 | 297 | questionnaire | profile-gate |
| safety/index.ts | 248 | 62 | approve_ky_command | keep |
| todo.ts | 310 | 78 | todo | profile-gate |
| skills index | 1373 | 344 | none | budgeted |
| checkpoint, diagnostics, execute, grill, harness, loop-police, plan-ceremony, plan-mode, providers, qoder, review, routing, workflows | 0 | 0 | none | keep |

Sum check: bare + AGENTS.md plus all deltas equals the composed floor with a residual
of 0 chars (tolerance 32).

**AFTER (profiles plus the shell-policy gate).** Same method, same session, measured
2026-10-13 on win32, Node 24.16.0, with `measureFloor({ profile })`. The delta column is
against the BEFORE full composed floor of 4,233 tokens.

| Profile | system chars | tool chars | floor tokens | delta vs BEFORE | tools |
|---|---|---|---|---|---|
| recon | 5162 | 2107 | 1818 | -2415 (-57.0%) | 3 |
| review | 5162 | 2618 | 1945 | -2288 (-54.1%) | 4 |
| implement (default) | 5162 | 4391 | 2389 | -1844 (-43.6%) | 7 |
| full | 8479 | 8450 | 4233 | 0 | 12 |

Wire estimate (`toToolDeclaration` JSON), reported separately and never compared with
the table above: recon 2359, review 2912, implement 4937, full 9206 tool chars.

The shell-policy section (about 128 tokens) is now absent from recon, review and
implement and present in full, unchanged. Per-profile CI ceilings in
`tests/integration/context-floor.test.ts` (`FLOOR_CEILINGS`) sit under 3% above these
measured values.

**The ~1,850 target.** Claimed for recon only: its measured floor is 1,818 tokens, at or
below 1,850. The default profile (implement) lands at 2,389, so the literal 1,850 figure
is not met there; the claim for it is the measured 43.6% reduction from BEFORE.

**Levers not taken.** Pi's `docs` section needs a full custom prompt that drops tool
snippets, which is a decision for a cheap model; it is tested as an optional arm in the
experiment protocol and is not adopted by default.

---

## The prose-tool-call event, and the lever deliberately not pulled

`prose_tool_call` means a finalized assistant message *described* a tool call in
prose instead of emitting one. The predicate is anchored to the live active-tool
list, requires an immediately-following `{`, and requires the message to contain
no real tool call at all — the false positive that matters is an explanation to
the user that merely mentions a tool name, and it is a mandatory negative in
`tests/unit/prose-detector.test.ts`.

When it fires, three things happen: the turn's own row is stamped
`event: prose_tool_call` **alongside** its `stopReason`; a separate kind-less
record is appended immediately, carrying the `tool` the model meant to call; and
one follow-up user message is injected. `prose_tool_call_retry_exhausted` means
the detector fired again with the retry budget already spent —
`MAX_PROSE_RETRIES` is 1, because a second prose response is a signal rather than
something to keep paying for.

**The retry is a follow-up user message inside the same agent run, and it
executes nothing.** It names no tool and quotes nothing the model wrote:
interpolating the matched tool name would splice untrusted model output back into
a prompt for a second pass.

**The lever not pulled.** Returning a replacement message from `message_end` with
the parsed prose promoted into a real `toolCall` content block makes the agent
loop actually execute the tool, at zero extra model calls. It was executed during
research and it works [02-RESEARCH.md §6.4, executed 2026-08-13]. It is
deliberately not the default for three reasons: it executes a tool whose
arguments were regex-scraped out of untrusted prose, on a laptop where merging to
`main` auto-deploys and Phase 4's command guard has not shipped; it rewrites
session history to claim the model emitted a call it never emitted, corrupting
the very measurement Phase 10 reads; and a wrong parse produces a *silently wrong
action* rather than a visible retry. **It becomes an available lever for
read-only tools once Phase 4 has shipped** — that is the condition, and it is the
whole condition.

One further flag exists and is off: `PROSE_RETRY_FORCES_TOOL_CHOICE` is `false`
and registers no handler at all. Whether forcing `tool_choice: "required"` on the
retry reduces the prose rate is **UNVERIFIED**, and it belongs to Phase 10, after
a baseline rate exists to compare against.

---

## How to read a log

All three examples assume `sh` and the log directory of the current project.

**Find the most expensive turn today.** Filter to real turns first — the
kind-less records have no cost:

```sh
grep '"kind":"turn"' .pi/logs/turns-$(date +%F).jsonl \
  | node -e 'let m=null;require("readline").createInterface({input:process.stdin}).on("line",l=>{const r=JSON.parse(l);if(!m||r.cost.total>m.cost.total)m=r}).on("close",()=>console.log(m.model,m.cost.total,m.corr))'
```

**Find every turn where the detector fired.** Note the two meanings: the turn row
carries the VERDICT, the kind-less record carries the ACTION, and both use the
same `event` value. For the prose *rate* you want the verdicts, one per detected
turn:

```sh
cat .pi/logs/turns-*.jsonl | grep -F '"kind":"turn"' | grep -cF '"event":"prose_tool_call"'
```

Do **not** count the kind-less records for the rate. The verdict is stamped on the
turn accumulator before the retry budget is consulted, so every detected prose
turn has a turn row; the kind-less record is written only when a retry was
actually issued, and `MAX_PROSE_RETRIES` is `1` per agent run, so every prose turn
after the first in a run is missing from it. The actions are still worth counting
— as a reconciliation, where *retries issued + retries refused* must equal the
numerator above:

```sh
cat .pi/logs/turns-*.jsonl | grep -F '"event":"prose_tool_call"' | grep -v '"kind":' | wc -l
cat .pi/logs/turns-*.jsonl | grep -cF '"event":"prose_tool_call_retry_exhausted"'
```

`cat` first in every one of them: `grep -c` over a glob prints `file:count` per
file rather than one total, so with any rotation the un-piped counting form yields
no single number. `RB-02-03` in `docs/RUNBOOK.md` carries these commands as a
procedure, with the denominator and the reconciliation identity.

**Join a turns row to its wire records.** Take the row's `corr` and grep the
other stream for it; you should get a headers/request/response triple, or a pair
when the request errored and `after_provider_response` never fired:

```sh
grep -F '"corr":"<paste the corr value here>"' .pi/logs/wire-$(date +%F).jsonl
```

---

## Context-pollution experiment

**Question.** Does the full harness make a cheap model catch fewer real defects than bare Pi does, and if so is the cause harness
behaviour, sheer prompt mass, prose tool calls, or a misconfigured provider route?

**Corpus.** The six seeded defects in `tests/fixtures/seeded-defects/index.ts`, each built into a disposable git repo. Every trial
sends the same review-only prompt (`buildTrialPrompt`) and the model answers with one JSON review. Scoring reuses the existing
calibration grader, so a trial is "caught" only when a finding names the right file and the right failure.

**Arms.**

| Arm | Name | Isolates |
|-----|------|----------|
| A | minimal | Bare Pi: no extensions, skills, context files or prompt templates. The baseline. |
| B | harness-implement | The harness as installed, default `implement` profile. |
| F | harness-full | The harness with the `full` tool profile. The primary comparison is F against A. |
| C | padded-minimal | A plus inert repo prose of the measured floor difference between F as it runs and A (`PAD_TOKENS` = 2,653 estimated tokens: the `full` floor without AGENTS.md, because a trial repo has none, minus the bare floor), separating token mass from harness behaviour. |

**Design.** Paired and interleaved: each (defect, repeat) block runs all four arms contiguously in a seeded order and blocks are
shuffled, so provider drift lands on every arm alike. One look at a fixed R=10 repeats (`REPEATS`; 6 defects x 10 x 4 arms = 240
trials). There is no second stage and no pooling: a second look at the same z inflates the error rates of both `DEGRADES` and
`NO_DETECTABLE_EFFECT`. A larger run is a new experiment, pre-registered with its own R and seed, and is never pooled with this
one. `KY_EXP_REPEATS` exists for smoke tests only. The seed is `KY_EXP_SEED` (default 20261013).

**Metrics.** Catch rate per arm, excluded-trial count, malformed-output count, prose-tool-call rate, unmatched findings, input and cache-read tokens. A prose tool call is judged against the tools its arm declares (`armActiveTools`): the four built-ins for A and C, the
`implement` subset for B, and the measured `full` list (`FULL_ARM_TOOLS`) for F.

**Pre-registered decision rule.** Pinned by `scripts/ctx-experiment-core.ts` and its tests, so changing it after seeing data
shows up as a test edit. With d = catch(F) - catch(A) and a 90% Newcombe interval (z = 1.6449):

- `DEGRADES` when d <= -0.15 (`DEGRADE_POINTS`) and the interval's upper bound is below zero.
- `NO_DETECTABLE_EFFECT` when the interval's lower bound is above -0.15.
- `INCONCLUSIVE` otherwise.

**Exclusions.** A trial that exits non-zero (it is listed in `failures.tsv`), produces no assistant message, or ends with
`stopReason` `error` or `aborted` measured the infrastructure, not the model. It is excluded: neither a catch nor a miss, and
counted per arm as `excluded` in `summary.json` and on stdout. Failures are not arm-neutral (the largest prompt draws the most
rate-limit and schema rejections), so any comparison involving an arm with more than 5% of its planned trials excluded
(`MAX_EXCLUDED_SHARE`) is `INCONCLUSIVE`, and so is the discrimination that depends on it.

**Discrimination.**

| Outcome | Reading |
|---------|---------|
| Prose-tool-call rate >= 0.10 and at least half the misses fall in prose trials (any arm) | `prose-tool-calls` |
| F `DEGRADES` vs A, and C does not degrade vs A | `harness-behaviour` (the harness does it, not the token mass) |
| F `DEGRADES` vs A, and C also `DEGRADES` vs A | `context-pollution` (token mass alone hurts) |
| No effect, but A itself catches under 50% | `neither`; if a second-route run of A is healthy, `provider-misconfiguration` |
| Anything else | `inconclusive` |

**Power, honestly.** 60 trials per arm detects only large effects. `INCONCLUSIVE` is a valid and expected answer for a modest
effect; it is not a failure of the run and must not be rerun with a different rule or topped up with more repeats.

**How to run.** On the work laptop, from the repo root (check `node --version` is >= 22.19; on an older 22.x build run with
`NODE_OPTIONS=--experimental-strip-types`):

```sh
KY_EXP_MODEL=deepseek/deepseek-v4-flash KY_EXP_KEY_VAR=DEEPSEEK_API_KEY sh scripts/ctx-experiment.sh
```

`KY_EXP_MODEL` is the same provider/model id for every arm. `KY_EXP_KEY_VAR` is the NAME of the variable holding the provider
key; only that one variable is passed to pi. Names the launcher sets itself (`PATH`, `HOME`, `USERPROFILE`, `TMP`, `TEMP`,
`TMPDIR`, `SYSTEMROOT`, any `PI_*`) and any `AWS_*` name are refused, case-insensitively, before any trial starts. Optional: `KY_EXP_SEED`, `KY_EXP_REPEATS`, `KY_EXP_DEFECTS` (comma list),
`KY_EXP_PI` (default `pi`), `KY_EXP_OUT` (default `logs/ctx-experiment/<UTC timestamp>`). Output is `trials.tsv`, one `.jsonl` and
`.stderr.log` per trial, `failures.tsv`, `summary.json`, and a human summary on stdout. `logs/` and `*.jsonl` are gitignored.
Cost: 240 model calls with a few thousand input tokens each; budget it as a few dollars at cheap-model prices.

**Safety envelope.** The minimal arm has bash and no safety layer, and the laptop holds live AWS credentials. Each trial therefore
runs in a disposable temp repo with an environment that `ctx-experiment.mjs run` builds from an allowlist (PATH, Windows
`SYSTEMROOT`, the one key variable); HOME, USERPROFILE, TMP and `PI_CODING_AGENT_DIR` point into a per-trial temp root; the prompt
is review-only; there is no `eval`. The key is passed in the child's environment object, never as a command-line argument, so it
does not appear in process listings or process-creation audit logs. No `AWS_*` variable can cross, and
`tests/unit/ctx-experiment-launcher.test.ts` proves both against a fake pi and argv-recording `node`/`env` shims. Arms B and F load this
checkout as a local package, so nothing is fetched from a registry.

**What the envelope does not do.** It isolates environment variables only, not the filesystem. The model in arms A and C
runs `bash` as the operator's own OS user with no safety layer, so absolute paths such as `~/.aws/credentials`,
`~/.aws/sso/cache/`, the real `~/.pi/agent/auth.json` and the Windows Credential Manager stay reachable. The review-only
prompt makes that unlikely, but nothing enforces it. Run the experiment only from an OS account, container or VM that holds no
cloud credentials and no real Pi auth file.

**Status.** The live run is `RB-10-01` in `docs/RUNBOOK.md`: **OUTSTANDING**. Everything above was verified offline against a
fake pi; no number here is a measured model result.

---

## What has not been verified

`docs/RUNBOOK.md` carries the three Phase 2 checks that need a real model, a real
credential and a real working day — `RB-02-01`, `RB-02-02` and `RB-02-03`. All
three are **OUTSTANDING** and machine-enforced as such by
`tests/unit/docs-policy.test.ts`. Everything in this document describes what the
instrument does against `fauxProvider` and against fixtures this repository
wrote. Nothing here is a claim about what a real DeepSeek or Bedrock payload
looks like; that claim is what `RB-02-01` exists to establish.
