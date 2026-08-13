# Phase 3: Providers & Credentials - Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Every provider the harness will route to is structurally complete in-repo with zero secrets, and every credential-dependent behaviour is either unit-verified offline or documented in a runbook the user can execute.

**Requirements:** PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07, PROV-08, PROV-09, PROV-10

**Success criteria (from ROADMAP.md, binding — this is the spec):**

1. A fresh clone contains structurally complete `models.json` and `auth.json`; every value resolves at runtime from `$ENV_VAR` or `!command`, `!command` appears only in `auth.json` (cached per process, never re-executed per request), and no secret is present.
2. Built and unit-verified with `fauxProvider`: expired SSO produces a message naming the exact `aws sso login --profile <name>` command and is classified **non-retryable** so it cannot burn wall-clock in a retry loop; a DeepSeek-direct → DashScope fallback chain handles quota, transient and unavailable errors.
3. **Verified live on the work laptop**: a two-turn *tool-calling* sequence against DashScope returns 200 — the first turn always works, so the second is the test — and Bedrock authenticates from a fresh shell via `credential.env.AWS_PROFILE`.
4. The R1 question is settled with a recorded result: whether `api.deepseek.com` accepts `reasoning_effort: "low"`, and whether it yields materially fewer reasoning tokens than `"high"`. Until it is settled, `/cheap` is not defined in terms of a cheap thinking tier.
5. `docs/RUNBOOK.md` exists and lists every credential-dependent check with its expected output, so each verification has either passed or is visibly outstanding rather than quietly assumed.

**Contains [RUNBOOK] requirements:** PROV-03, PROV-04, PROV-07 and PROV-10. There are **no credentials on this machine and no provider egress from it**, so each of these is planned as *built + unit-verified offline with `fauxProvider`* **plus** an appended `RB-03-xx` entry in the existing `docs/RUNBOOK.md` whose live check is **OUTSTANDING**. None of them may be planned as passing. PROV-09 — the runbook itself — is this phase's own deliverable and is the thing that makes the other four honest: it must list every credential-dependent check with its exact command and expected output.

PROV-05 and PROV-08 carry `[FAUX]` only: they are fully verifiable on this machine and must be planned as *passing*, not outstanding.

</domain>

<decisions>
## Implementation Decisions

Recorded in PROJECT.md (Key Decisions, Constraints), ROADMAP.md and `.planning/research/{PITFALLS,ARCHITECTURE,STACK}.md`. Binding on this phase; not to be re-derived and not to be re-litigated.

**Already decided, binding:**

1. **DashScope's `compat` block is written out in full, explicitly, for every model — never left to detection.** `detectCompat` keys on hard-coded provider ids and base-URL substrings and has **no branch for DashScope, Model Studio, `aliyuncs.com` or Qwen** (`src/api/openai-completions.ts:1442-1540`; PITFALLS Pitfall 8, status VERIFIED-at-source). The two failures this causes are both silent: `thinkingFormat` falls back to `"openai"` so thinking is never enabled, and `requiresReasoningContentOnAssistantMessages` falls back to `false` so `reasoning_content` is dropped on tool-call round-trips and the provider returns **HTTP 400 on the second turn of any tool sequence**. The first turn always works, which is why it reads as intermittent. This is the strongest single candidate for the user's original bad experience with DeepSeek, and PROV-10 exists to test the second turn specifically.

2. **Never copy `contextWindow: 1000000` from Pi's built-in direct-DeepSeek entry into a DashScope entry.** The specific figure 393,216 is corroborated by one researcher and marked **UNVERIFIED** by another (PITFALLS:317). The actionable rule survives either way, and PROV-06 forbids a model inheriting a context window from a different provider's entry for the same model. Whatever number is written must be sourced or marked UNVERIFIED in-file, and the runbook must carry the empirical check.

3. **Bedrock authenticates via `credential.env.AWS_PROFILE` in `auth.json`.** Pi checks it *before* process env, it survives a fresh shell, and it contains no secret — so it is templatable in a public repo (PITFALLS Pitfall 10). `aws sso login` alone sets **no** environment variable; it writes a token cache under `~/.aws/sso/cache/`, so without `AWS_PROFILE` literally set Pi reports no Bedrock credentials even though the AWS SDK would resolve fine. A single `[default]` SSO profile does not help. `/login` → "Existing AWS credential chain" stores nothing — it is a no-op that looks like configuration. EC2 instance profiles are unsupported.

4. **Expired SSO is classified non-retryable and gets an actionable message.** `formatBedrockError` (`src/api/bedrock-converse-stream.ts:357-374`) maps only five exception names, none of them credential expiry, so an SSO expiry falls through to the raw SDK message; worse, downstream retry classification is string-matching (`server.?error`, `service.?unavailable`), so a 5xx-shaped expiry can be retried against a credential that will never become valid. SSO sessions are 8-12 hours, so this fires roughly daily on a working day — not an edge case. The fix is a `after_provider_response`-class classifier matching `ExpiredToken`, `ExpiredTokenException`, `InvalidGrantException`, `CredentialsProviderError`, `The SSO session ... has expired` and `UnrecognizedClientException`, surfacing the exact `aws sso login --profile <name>` command.

5. **`!command` may appear only in `auth.json`.** `auth.json`'s `!command` values are cached for the process lifetime; `models.json`'s are resolved **at request time on every request with no caching, TTL, stale reuse or recovery** — a deliberate Pi design choice (`docs/models.md:172`). A `!command` in `models.json` is therefore a per-request subprocess spawn in the hot path. PROV-02 is a mechanical rule and wants a mechanical test.

6. **Bedrock reports no reasoning tokens and no thinking config for non-Claude models.** `buildAdditionalModelRequestFields()` returns `undefined` for every non-Claude model, and Converse populates no reasoning-token usage. Bedrock DeepSeek is R1/V3/V3.2 only (no V4) and R1 supports no tool calling, so it is not an executor. Do not plan a "cheap Bedrock fallback".

7. **Not Pi's built-in `qwen-token-plan` provider.** Different host (`token-plan.*.maas.aliyuncs.com`), different key namespace (`sk-sp-` prepaid); a pay-as-you-go DashScope `sk-` key returns 401 against it. The named regression risk is a user running `/login`, seeing "Qwen", pasting the DashScope key and concluding DashScope is broken — so the runbook should say so explicitly.

8. **Qoder is not a provider and is not in v1.** No inference endpoint exists; Cloud Agents is orchestration. It must not appear in `models.json`, the routing table or the fallback chain. **The fallback chain is DeepSeek-direct → DashScope** (PROV-08).

9. **R1 stays open and is settled by one live request, not by desk work.** Two researchers reached opposite conclusions on whether `api.deepseek.com` accepts `reasoning_effort: "low"`; neither issued a request. Plan PROV-07 as a **runbook experiment with a recorded result**, never as a design input. Until it is settled, `/cheap` must **not** be defined in terms of a cheap thinking tier. Impact is bounded: on the DashScope path `low` → `high` server-side regardless, so it only ever affects DeepSeek-direct.

10. **Keep secrets out of `auth.json` entirely.** Its `0600` mode is a no-op on Windows — Node's `chmodSync` toggles only the read-only attribute and never touches NTFS ACLs, so the file is readable by any process running as the user. Pi's code *looks* like it protects the file and does not. This is already recorded in `docs/RUNBOOK.md`'s Phase 1 machine-state notes; the phase should reference it, not restate it as new.

11. **Phase 3 is verified BY Phase 2's instrument.** The wire dump is the only way any of the `compat` fields above is observable — every one of them is invisible from the UI and degrades quality silently rather than erroring. Plan against the API Phase 2 actually exported (below), not an assumed one.

**Claude's discretion (guided by ROADMAP criteria + `.planning/research/`):**
The exact model set and ids per provider; which DashScope base-URL form to template (shared `dashscope-intl` vs workspace-dedicated `{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com` — the latter is Alibaba's current recommendation but embeds a workspace id); the mechanism by which in-repo templates reach `~/.pi/agent/` (see code context — this is a genuine fork); the shape of the fallback-chain implementation (extension vs authored module) and its error taxonomy; file decomposition; the RB-03-xx numbering and section ordering in `docs/RUNBOOK.md`; and how the R1 result is recorded once known.

**Decisions taken autonomously during context generation** (per the Standing Operating Policy — the user is asleep; noted here rather than asked):
- Phase slug is `03-providers-credentials`, following Phase 1's convention of dropping `&` from the phase title.
- `QODER_PERSONAL_ACCESS_TOKEN` already exists in `.pi/templates/env.example` as a Phase 1 artifact. It is a variable *name*, not a secret, and removing it is not a Phase 3 requirement — so it stays. That is not a licence to add Qoder anywhere else; decision 8 stands.

</decisions>

<code_context>
## Existing Code Insights

Phases 1 and 2 created the shape this phase writes into. Do not re-create it. 514 tests green, `tsc --noEmit` clean.

**The scope problem, verified at source — read this before planning PROV-01.**
`models.json` is resolved **only** from the agent directory: `join(getAgentDir(), "models.json")` (`dist/config.js:423-425`, and again at `dist/core/agent-session-services.js:59`, `dist/core/model-runtime.js:76`, `dist/core/sdk.js:71`, `dist/package-manager-cli.js:356`). `auth.json` is likewise `~/.pi/agent/auth.json` (`docs/providers.md:111`). **There is no project-scope `models.json` and no project-scope `auth.json`** — a file committed at `.pi/models.json` in this repo is read by nothing. So "a fresh clone contains structurally complete `models.json` and `auth.json`" is satisfied by in-repo **templates plus a path into the agent directory**, and the planner must pick that path explicitly. Two candidates, both consistent with recorded decisions:
  - templates in-repo (alongside the existing `.pi/templates/env.example`) installed by `bin/bootstrap.sh`, which already exists and already has `--check-only` / `--assert-hardening` modes; or
  - programmatic `pi.registerProvider()` from a project extension under `.pi/extensions/` — which *is* project-scoped and does load from a clone (`ARCHITECTURE.md:160` sketches `providers.ts` for exactly this; `docs/extensions.md:190-218` documents an async factory).
  Whichever is chosen, PROV-01's zero-secret and `$ENV_VAR`/`!command` properties and PROV-02's `!command`-only-in-`auth.json` rule apply to the templated files, and both want a test rather than a claim.

**Phase 2's instrument, which is how this phase is verified** (`.pi/extensions/diagnostics/`):
- `call-model.ts` exports `callModel(ctx, opts)` and `CallModelOptions<TApi>` — an explicitly documented **cross-phase contract** carrying `role` (mandatory, undefaulted), `model`, `systemPrompt`, `messages`, `tools`, `api?: WithoutCaptures<ModelsApiStreamOptions<TApi>>` and `signal`. The four capture keys are stripped from the type and the spread order enforces it: a caller cannot suppress its own capture. Phase 3's fallback chain and SSO classifier should consume this, not `ctx.modelRegistry.complete()` — which is build-failing outside `diagnostics/` by DIAG-03.
- `wire.ts` / `redact.ts` / `schema.ts` — redacted-at-capture wire records with a `kind` union (`main.headers` → `main.request` → `main.response`) under one correlation id, written to `.pi/logs/wire-<date>.jsonl`.
- `turns.ts` / `jsonl.ts` — one row per turn *and* per nested call in `.pi/logs/turns-<date>.jsonl`; `budget.ts` — the `/budget` command; `prose.ts` — the prose-tool-call detector with a capped retry.
- `docs/DIAGNOSTICS.md` documents the JSONL schemas, so the runbook can cite field names without citing code.

**`docs/RUNBOOK.md` already exists** with RB-01-01/02/03 and RB-02-01/02/03, a stated four-part entry contract (exact command, expected output, offline proxy, status line) and a Phase 1 machine-state section. Phase 3 **appends** an `RB-03-xx` section; it must not recreate the file. `tests/unit/docs-policy.test.ts` parses both the summary-table row and the `**Status:**` line of every `RB-<phase>-<n>` entry and reports a disagreement as `INCONSISTENT` — that guard must keep passing, and the new entries must satisfy it. Note the file's own header says PROV-09 is where it formally belongs: Phase 1 created it early so three checks would not be lost. Phase 3 is where that ownership is discharged.

**Also present:** `.pi/templates/env.example` (variable *names* only, `DASHSCOPE_API_KEY`, `DEEPSEEK_API_KEY`, `AWS_PROFILE`, `QODER_PERSONAL_ACCESS_TOKEN`, copied into `.env.example` between managed markers by bootstrap); `.pi/settings.json` is `{}`; `.pi/extensions/harness/index.ts` holds the sentinel model id used by the Phase 1 load-path tests; `.gitignore` already covers `.pi/auth.json`, `.pi/logs/`, `*.jsonl`; `tests/{unit,integration,helpers,fixtures}/` with reusable helpers (`git.ts`, `pi.ts`, `stub-bin.ts`, `win-quote.ts`) — reuse them rather than adding parallel ones. No build step: Pi loads `.ts` through jiti and a build breaks `/reload`.

**Offline verification tools:** `fauxProvider()` from `@earendil-works/pi-ai` (`setResponses` / `appendResponses`, response **factories** receiving `(context, options, state, model)` so a test can assert on the *outgoing* request, `fauxAssistantMessage({ stopReason, errorMessage, ... })` for the error paths PROV-05 and PROV-08 need, and `state.callCount` to prove a non-retryable error was attempted exactly once), `SessionManager.inMemory()`, `InMemoryCredentialStore`, and `pi.registerProvider(faux.provider)`. `ctx.modelRegistry.getProviderAuth(id)` resolves key/headers/baseUrl/env **without loading a model** — the natural way to test `auth.json` interpolation offline.

</code_context>

<specifics>
## Specific Ideas

- The explicit DashScope `compat` blocks are already drafted in `.planning/research/PITFALLS.md:285-312` — one for Qwen models (`thinkingFormat: "qwen"`, `supportsStore: false`, `supportsDeveloperRole: false`) and one for DeepSeek-via-DashScope (`thinkingFormat: "deepseek"`, `requiresReasoningContentOnAssistantMessages: true`, plus the same two `false`s). Use them as the starting point and confirm each field on the wire via Phase 2's dump rather than trusting the draft.
- The Qwen thinking branch itself is correct once reached (`src/api/openai-completions.ts:760-767` sends top-level `enable_thinking` plus `reasoning_effort`); Alibaba's `extra_body` framing is Python-SDK packaging of the same top-level JSON fields. The bug is unreachability, not the branch.
- DashScope keys are **region- and workspace-scoped and non-portable** — a Singapore key against the Beijing domain fails, and a key from the wrong workspace sees a different model list. Worth a runbook line, because the failure looks like "DashScope is broken".
- PROV-10's live check is a **two-turn tool-calling** sequence, not two turns of chat: the round-trip that carries `reasoning_content` back is what triggers the 400.
- PROV-04's runbook procedure should include `aws sso login --profile X && echo $AWS_PROFILE` — an empty echo means Bedrock will not work regardless of a successful SSO login (PITFALLS:370) — and should state that the persisting path is `pi auth login` → Amazon Bedrock → **"AWS profile"**, not "Existing AWS credential chain".
- PROV-05's offline test must assert **both halves**: the message names the exact command *and* the classifier reports non-retryable, proven by call count rather than by reading the classifier.
- PROV-08's error taxonomy is quota / transient / unavailable — three named classes, each with a test. Note that Pi has built-in `retry` settings and `pi-subagents` has per-agent `fallbackModels`; the recorded position (`.planning/research/STACK.md`, "Alternatives Considered") is that the authored router should own fallback and `pi-model-fallback` is at most a stopgap. Phase 5 owns routing; Phase 3 owns the chain for these three error classes only.
- A Bedrock SigV4 signature can never appear in a wire dump — signing is downstream of everything Pi hands over, and `ProviderRequestOptions.headers` documents that `x-amz-*`, `authorization` and `host` are silently ignored on Bedrock (`pi-ai 0.84.1 src/types.ts:148-153`). RB-02-02 already records this as a closed door. Do not write a Phase 3 check that looks for one.
- PROV-06's "never inherits a context window from a different provider's entry for the same model" is a testable invariant across the templated model set, not a code comment.

</specifics>

<deferred>
## Deferred Ideas

- Routing, `/cheap`, and the capability guard that reads `input[]` — Phase 5. Phase 3 supplies accurate capability metadata; it does not decide who gets routed where. `/cheap` in particular must not be defined in terms of a cheap thinking tier until R1 is settled.
- Per-role and main-loop thinking budgets — Phase 8, GATE-10, still gated on measurement.
- Whether strict-schema mode reduces the prose-tool-call rate — flagged in the ROADMAP as one of Phase 3's three research questions but it is a *quality-gate* lever; the controlled root-cause experiment is Phase 10. Phase 3 records the finding, it does not act on it.
- Third-party extension pins, including `pi-model-fallback` — Phase 7, where every pin is re-verified at planning time.
- Qoder in any form, including as a delegate tool — out of v1 entirely.
- The safety layer's `.pi/audit.jsonl` and command guard — Phase 4.

</deferred>
