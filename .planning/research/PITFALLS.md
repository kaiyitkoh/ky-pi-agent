# Pitfalls Research

**Domain:** Personal coding-agent harness on Pi, optimising cheap models (DeepSeek V4 Flash) with selective escalation to Anthropic via AWS Bedrock
**Researched:** 2026-08-13
**Confidence:** HIGH for provider quirks and Pi internals (verified by reading Pi's own TypeScript source, recovered from published sourcemaps); MEDIUM for ecosystem/community claims; explicitly marked per pitfall.

## How This Was Verified

Most claims below were checked against **primary source code**, not documentation or blog posts. Method:

```bash
npm pack @earendil-works/pi-ai@0.84.1
npm pack @earendil-works/pi-coding-agent@0.84.1
# every dist/**/*.js.map contains full sourcesContent — the original TypeScript
```

This recovers 371 original `.ts` files across both packages. Every claim tagged **VERIFIED (source)** below carries a file and line reference into that recovered source and can be re-checked in one command. Pinned to **Pi 0.84.1 / pi-ai 0.84.1** (published 2026-08-07). Pi ships every ~2.3 days, so re-verify at the version you pin.

**Headline correction:** one of the adversarial review's central claims — that Pi sends DeepSeek's `reasoning_effort` in the wrong place — **is false**. Pi is correct and DeepSeek's docs agree with Pi. Building a "fix" for it would have been wasted work. Details in Pitfall 3.

---

## Critical Pitfalls

### Pitfall 1: Extended thinking is silently never requested for non-Claude models on Bedrock

**Status: VERIFIED (source).**

**What goes wrong:**
`buildAdditionalModelRequestFields()` returns `undefined` for every Bedrock model that is not an Anthropic Claude model. `additionalModelRequestFields` is the *only* channel through which Converse carries thinking configuration. Any reasoning setting for DeepSeek, Qwen, Nova, or Llama on Bedrock is dropped before the request is built. There is no warning, no error, and no log line.

`@earendil-works/pi-ai@0.84.1` → `src/api/bedrock-converse-stream.ts:1096-1144`:

```ts
function buildAdditionalModelRequestFields(
	model: Model<"bedrock-converse-stream">,
	options: BedrockOptions,
): Record<string, any> | undefined {
	if (!options.reasoning || !model.reasoning) {
		return undefined;
	}

	if (isAnthropicClaudeModel(model)) {
		...   // adaptive thinking / budget_tokens / anthropic_beta
		return result;
	}

	return undefined;   // <-- every non-Claude Bedrock model lands here
}
```

**Why it happens:**
Bedrock has no cross-vendor thinking parameter. Each model family defines its own `additionalModelRequestFields` schema, so Pi implements only the one it can validate. The UI still lets you pick a thinking level for a model whose catalog entry has `reasoning: true` (e.g. `deepseek.v3.2`, `qwen.qwen3-32b-v1:0`, both `reasoning: true` in Pi's Bedrock catalog), so the setting *appears* to apply.

**Consequence for this project:**
It is only a live problem if you route a non-Claude model through Bedrock. Given DeepSeek V4 is not on Bedrock at all (Pitfall 6) and the plan is Claude-via-Bedrock plus DeepSeek-via-DeepSeek-direct, this quirk mostly does **not** bite — but it becomes an invisible trap the moment someone adds `deepseek.v3.2` or a Qwen model on Bedrock as a "cheap Bedrock fallback" and assumes thinking works.

**How to avoid:**
- Wire inspector must dump `additionalModelRequestFields` explicitly for Bedrock, and assert it is non-`undefined` whenever a thinking level is set.
- Add a capability-guard rule: `provider == amazon-bedrock && !model.id.includes("anthropic") && thinkingLevel != off` → refuse the route with an explicit message, rather than silently degrading.
- Do not treat `model.reasoning === true` in Pi's catalog as "thinking will be requested". It only means "the model can reason", not "this adapter will ask it to".

**Warning signs:**
A Bedrock non-Claude model producing zero `reasoningTokens`, no thinking block in output, and identical latency/quality regardless of thinking level.

**Phase to address:** Diagnostics / wire inspector (detection), Routing + capability guards (hard block).

---

### Pitfall 2: Bedrock Converse never reports reasoning tokens, so thinking cost is unmeasurable there

**Status: VERIFIED (source).**

**What goes wrong:**
`handleMetadata()` populates only `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`. There is no reasoning/thinking token field.

`src/api/bedrock-converse-stream.ts:589-602`:

```ts
if (event.usage) {
	output.usage.input = event.usage.inputTokens || 0;
	output.usage.output = event.usage.outputTokens || 0;
	output.usage.cacheRead = event.usage.cacheReadInputTokens || 0;
	output.usage.cacheWrite = event.usage.cacheWriteInputTokens || 0;
	output.usage.totalTokens = event.usage.totalTokens || output.usage.input + output.usage.output;
	calculateCost(model, output.usage);
}
```

**Why it matters here specifically:**
The project's whole thesis is "spend strong-model tokens only where they earn their cost". Thinking tokens are billed as output tokens and are the dominant cost of an escalation. On Bedrock they are folded into `outputTokens` with no breakdown — so the per-turn JSONL log can record *total* cost but cannot attribute it to thinking vs answer. You cannot answer "was `/max` worth it?" from Bedrock data alone.

**How to avoid:**
- Accept it. Do not build a thinking-cost-attribution feature that only works on one provider.
- Log `thinkingLevel` as a *requested input* alongside total output tokens, and compare cost across levels empirically (A/B the same task at `low` vs `high`) rather than trying to decompose a single response.
- If thinking-token attribution turns out to matter, use the Anthropic direct API (which returns a thinking block you can measure) for calibration runs, and extrapolate to Bedrock.

**Warning signs:** A cost dashboard where Bedrock thinking always reads 0.

**Phase to address:** Diagnostics (per-turn JSONL schema design — do not design a column you cannot fill).

---

### Pitfall 3: The "DeepSeek `reasoning_effort` nesting" bug does not exist — Pi is correct

**Status: VERIFIED FALSE. The adversarial review's claim is wrong.**

**The claim:** DeepSeek documents `reasoning_effort` nested inside a top-level `thinking` object; Pi sends it top-level; therefore effort is ignored.

**What the source actually shows.** `src/api/openai-completions.ts:796-806`:

```ts
} else if (compat.thinkingFormat === "deepseek" && model.reasoning) {
	if (options?.reasoningEffort) {
		(params as any).thinking = { type: "enabled" };
	} else if (model.thinkingLevelMap?.off !== null) {
		(params as any).thinking = { type: "disabled" };
	}
	if (options?.reasoningEffort && compat.supportsReasoningEffort) {
		(params as any).reasoning_effort =
			model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
	}
}
```

Pi emits `{"thinking": {"type": "enabled"}, "reasoning_effort": "high"}` — a `thinking` object *and* a sibling top-level `reasoning_effort`.

**What DeepSeek documents.** The Thinking Mode guide gives exactly this shape for OpenAI format:

```json
{"thinking": {"type": "enabled"}, "reasoning_effort": "high"}
```

with `{"thinking": {"type": "enabled/disabled"}}` and `{"reasoning_effort": "low/high/max"}` presented as two distinct control parameters. (The API *reference* page renders `reasoning_effort` under the thinking section in a way that reads as nesting — that is almost certainly the source of the review's error.)

**Verdict: Pi's DeepSeek thinking wiring is correct. Do not "fix" it.** The residual risk is only that DeepSeek changes the contract; the wire inspector covers that.

**Phase to address:** Diagnostics (confirm on the wire once, then stop worrying about it). Remove any planned remediation work for this from the roadmap.

---

### Pitfall 4: Pi's DeepSeek catalog removes the `low` thinking tier that DeepSeek actually supports — there is no cheap thinking mode

**Status: VERIFIED (source + official docs). This is the real version of the "never emits low" claim.**

**What goes wrong:**
DeepSeek's API accepts `reasoning_effort` of `low`, `high`, `max` (with `medium`/`xhigh` mapped to `high`). Pi's bundled catalog entry for both V4 models declares:

`@earendil-works/pi-ai@0.84.1` → `dist/providers/data/deepseek.json`:

```json
"thinkingLevelMap": {"minimal": null, "low": null, "medium": null, "high": "high", "max": "max"}
```

And `src/models.ts:900-911` filters any level mapped to `null` out of the supported set:

```ts
export function getSupportedThinkingLevels<TApi extends Api>(model: Model<TApi>): ModelThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	return EXTENDED_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		...
	});
}
```

So the only selectable levels for `deepseek-v4-flash` / `deepseek-v4-pro` are **`off`, `high`, `max`**. `clampThinkingLevel` walks *upward* from the requested index, so asking for `low` silently becomes `high`, and asking for `minimal` becomes `high`.

For a harness whose entire purpose is cost control, this is significant: **your cheap executor has no cheap thinking setting.** Every turn with thinking on is at least `high`. Thinking tokens bill at output rate ($0.28/Mtok flash, $0.87/Mtok pro per Pi's catalog), so this is a direct, permanent multiplier on the daily driver's cost.

**Subtlety worth knowing.** The `null` only removes the level from the *selectable set*. At the API layer the expression is `model.thinkingLevelMap?.[level] ?? options.reasoningEffort`, and `null ?? "low"` evaluates to `"low"` — so the wire would happily carry `low` if something set it. The block is in the catalog and the session, not the adapter.

**How to avoid:**
Override the catalog in your own `models.json` rather than accepting the bundled entry:

```json
"thinkingLevelMap": { "minimal": "low", "low": "low", "medium": "high", "high": "high", "max": "max" }
```

Then verify on the wire that `reasoning_effort: "low"` is actually sent and that DeepSeek accepts it (400 vs 200). This restores a genuine cheap tier and makes `/cheap` mean something.

**Warning signs:**
`/think low` on DeepSeek producing the same token counts and latency as `/think high`; the thinking-level picker showing only three options.

**Phase to address:** Providers (catalog override), Diagnostics (verify on wire before trusting it), Quality levers (per-role thinking budgets depend entirely on this).

---

### Pitfall 5: DeepSeek silently ignores `temperature`, `top_p`, `presence_penalty`, `frequency_penalty` in thinking mode — and thinking is on by default

**Status: VERIFIED (official DeepSeek docs).**

**What goes wrong:**
DeepSeek's docs state plainly that in thinking mode these parameters are accepted without error and have **no effect**: *"for compatibility with existing software, setting these parameters will not trigger an error but will also have no effect."* `presence_penalty` and `frequency_penalty` are additionally marked deprecated and non-functional generally. Thinking mode is **enabled by default** with default effort `high` when the `thinking` parameter is omitted.

**Why it bites this project:**
Any per-role tuning that reaches for temperature — "review at temperature 0 for determinism", "planning at 0.7 for exploration" — is a **no-op on the daily driver** whenever thinking is on, which is most of the time. You will A/B two configurations, observe no difference, and draw the wrong conclusion about the harness rather than about the parameter.

Note Pi *does* explicitly send `thinking: {type: "disabled"}` when thinking is off (because `thinkingLevelMap.off` is `undefined`, not `null`, so the `!== null` branch fires) — so Pi does not accidentally leave thinking on. The default-on behaviour only bites a hand-rolled provider config that omits the `thinking` object entirely.

**How to avoid:**
- Do not build temperature into the role→model map for DeepSeek. Document it as unavailable.
- Control determinism through prompt structure and evidence gates, not sampling knobs.
- If a role genuinely needs low temperature, that role must run with thinking `off` — and then you should ask why a non-thinking cheap model is doing that job.
- Any custom `models.json` provider entry for DeepSeek must emit the `thinking` object explicitly; omitting it silently gives you `high` effort and its cost.

**Warning signs:** Sampling-parameter changes with zero measurable effect on output variance.

**Phase to address:** Providers (config), Quality levers (do not build a temperature lever).

---

### Pitfall 6: Bedrock has no DeepSeek V4, and Bedrock's DeepSeek R1 cannot call tools at all

**Status: VERIFIED (Pi's own Bedrock catalog + AWS/LangChain reports).**

Pi 0.84.1's bundled Bedrock catalog (`dist/providers/data/amazon-bedrock.json`, 114 models) contains exactly three DeepSeek entries plus one cross-region alias:

| Model id | reasoning | context |
|---|---|---|
| `deepseek.r1-v1:0` | true | 128,000 |
| `us.deepseek.r1-v1:0` | true | 128,000 |
| `deepseek.v3-v1:0` | true | 163,840 |
| `deepseek.v3.2` | true | 163,840 |

No V4 Flash, no V4 Pro. DeepSeek-R1 on Bedrock Converse does not support tool use — `ChatBedrockConverse` with R1 returns *"This model doesn't support tool use"* (langchain-aws issue #447), and AWS re:Post has an open question asking when tool calling will arrive for V3.1 on Converse.

**Consequence:** "Run the cheap executor on Bedrock so there is one credential and one bill" is not available. R1 is unusable as an executor (no tools). V3/V3.2 are a generation behind the intended daily driver and would additionally hit Pitfall 1 (no thinking). Bedrock is for Claude only in this design.

**How to avoid:**
- Fix the architecture now: **Bedrock = Claude escalation only. DeepSeek = direct DeepSeek API.** Two credentials, deliberately.
- Add a capability guard that refuses any Bedrock DeepSeek/Qwen model for the executor role, so a future "let's consolidate on Bedrock" impulse fails loudly.
- Do not put `deepseek.r1-v1:0` in any role map. A tool-less model in an agent loop produces prose that looks like work and does nothing.

**Warning signs:** `ValidationException` mentioning tool use; a subagent that "explains what it would do" and never edits a file.

**Phase to address:** Providers, Routing + capability guards.

---

### Pitfall 7: DeepSeek emits tool calls as prose ~11% of the time, and this is still open for V4

**Status: VERIFIED as open and current for V4.**

**What goes wrong:**
DeepSeek intermittently writes the function name and JSON arguments into `content` as text, with `finish_reason: "stop"` and `tool_calls: null`. The harness sees a normal assistant message and the tool never runs. Downstream tool execution **silently fails** — no error, no retry, the agent just moves on believing it acted.

Primary source: [deepseek-ai/DeepSeek-V3 issue #1244](https://github.com/deepseek-ai/DeepSeek-V3/issues/1244), titled for **DeepSeek-V4-Pro**, still open, with a measured baseline of 15/19 correct, **2/19 (11%) bugged**, 2/19 legitimately-text. Corroborated across independent stacks — [sglang #17561](https://github.com/sgl-project/sglang/issues/17561) (V3.2, same signature), [vllm #28219](https://github.com/vllm-project/vllm/issues/28219) (R1 distill), [openclaw #85918](https://github.com/openclaw/openclaw/issues/85918) (DSML markup in tool turns), and a [HuggingFace discussion on DeepSeek-V4-Pro](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/discussions/209) about DSML tool-call markup leaking into output. No fix or official mitigation is documented in the issue thread.

**Why this is the single most important pitfall for this project.**
The user's stated complaint is *"DeepSeek misses a lot of bugs that Opus or Sonnet would have caught."* An 11% silent tool-call drop rate produces exactly that phenomenology: the model "decides" to read a file or run the tests, the call evaporates, and it reasons onward from a gap it does not know it has. This is a far more likely root cause than thinking budgets, and unlike thinking budgets it is not fixable by configuration.

**How to avoid (this is buildable and high-value):**
1. **Detector in `after_provider_response` / the assistant-message path.** Flag any assistant message where `finish_reason == "stop"`, `tool_calls` is empty, and `content` matches a registered tool name followed by a `{` or contains DSML-ish markup. Log it to the per-turn JSONL as `event: prose_tool_call`. This alone converts an invisible failure into a measured one — and gives a real number for how much it matters on the user's workload.
2. **Retry-on-detection.** On detection, re-issue the same turn (optionally with `tool_choice: "required"`). Cheap: one extra flash call.
3. **Enable strict schema mode.** Pi's `detectCompat` sets `supportsStrictMode: true` for DeepSeek (`src/api/openai-completions.ts:1522`), so strict tool schemas are already available on this path. Strict mode constrains *argument* shape; it does not by itself force the model into the `tool_calls` channel, so treat it as complementary to (1) and (2), not a substitute. **UNVERIFIED** whether strict mode measurably reduces the prose-fallthrough rate — worth measuring once the detector exists.
4. **Never let "no tool call" mean "done".** Evidence-gated completion (already planned) is the backstop: if the transcript contains no real `tool_result` showing the build passed, the turn is not complete regardless of what the model wrote.

**Warning signs:**
Assistant messages containing a tool name followed by a JSON object; agents claiming to have run a command with no corresponding tool output; occasional Chinese-language reasoning preceding the prose call (noted in #1244).

**Phase to address:** Diagnostics (detector + JSONL event) — this should be in the *first* diagnostics phase, ahead of thinking budgets. Quality levers (retry, evidence gate).

---

### Pitfall 8: A custom OpenAI-compatible provider entry for DashScope gets the *wrong* compat defaults, breaking thinking and multi-turn tool calls

**Status: VERIFIED (source). This is the highest-severity finding for the planned DashScope integration.**

**What goes wrong:**
Pi's compat auto-detection is keyed on hard-coded provider ids and base-URL substrings. `src/api/openai-completions.ts:1442-1540` checks for zai, together, moonshot, openrouter, cloudflare, nvidia, ant-ling, cerebras, xai, chutes, opencode, and `deepseek.com`. **There is no branch for DashScope, Model Studio, `aliyuncs.com`, or Qwen at all.**

So a `models.json` entry pointing at `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (or a workspace-dedicated domain) falls through to the generic defaults, and gets:

| Setting | What you get | What you need | Damage |
|---|---|---|---|
| `thinkingFormat` | `"openai"` | `"qwen"` for Qwen; `"deepseek"` for DeepSeek | Qwen hybrid models **never think** — `enable_thinking` is never sent. DeepSeek gets no `thinking` object. |
| `requiresReasoningContentOnAssistantMessages` | `false` (it is `isDeepSeek`-gated) | `true` for DeepSeek | `reasoning_content` is dropped on tool-call round-trips → **HTTP 400** on the second turn of any tool sequence |
| `supportsStore` | `true` (`isNonStandard` is false) | `false` | `store` param sent to a provider that may reject it |
| `supportsDeveloperRole` | `true` | `false` | `developer` role sent instead of `system` |
| `contextWindow` | whatever you write | true provider cap | If you copy Pi's `1000000` from the direct-DeepSeek entry, the capability guard is calibrated against a window DashScope does not serve |

The `qwen` branch itself is correct once enabled (`src/api/openai-completions.ts:760-767` sends top-level `enable_thinking` plus `reasoning_effort`; `extra_body` in Alibaba's docs is Python-SDK framing for the same top-level JSON fields) — but it is **unreachable without an explicit `compat.thinkingFormat: "qwen"`**.

**How to avoid — write the compat block explicitly, never rely on detection:**

```jsonc
{
  "id": "qwen3-...",
  "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "reasoning": true,
  "compat": {
    "thinkingFormat": "qwen",
    "supportsStore": false,
    "supportsDeveloperRole": false
  }
}
```

and for any DeepSeek model served via DashScope:

```jsonc
"compat": {
  "thinkingFormat": "deepseek",
  "requiresReasoningContentOnAssistantMessages": true,
  "supportsStore": false,
  "supportsDeveloperRole": false
}
```

Then confirm each field on the wire before trusting it. **This is the single strongest argument for building the wire inspector first** — every one of these is invisible from the UI and every one degrades quality silently rather than erroring.

**Related DashScope traps (VERIFIED from Alibaba Model Studio docs):**
- **Keys are region-scoped and non-portable.** Each region has its own access domain, API key, and model list; they cannot be used across regions. A Singapore key against the Beijing domain fails; a key created in the wrong workspace sees a different model list.
- **Workspace-dedicated domains are now recommended** — `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com` replacing `https://dashscope-intl.aliyuncs.com` for Singapore. If you hard-code the shared domain, you inherit the shared-tier stability profile.
- **DashScope caps DeepSeek context below the 1M the model supports.** The specific figure of 393,216 tokens is **UNVERIFIED** — I could not confirm it against Alibaba's docs. The actionable point survives regardless: **do not copy `contextWindow: 1000000` from Pi's direct-DeepSeek entry into a DashScope entry.** Determine the real cap empirically and set the capability guard to it, or the guard will pass requests the provider rejects.

**Warning signs:** Qwen responses with no thinking block despite a thinking level set; HTTP 400 on the *second* turn of a DeepSeek tool sequence (the first turn works, which makes it look intermittent); context-overflow errors below your configured window.

**Phase to address:** Providers (explicit compat blocks), Diagnostics (wire inspector must run before this is trusted), Routing (context-window truth per provider).

---

### Pitfall 9: Pi's built-in `qwen-token-plan` provider is a different host and a different key namespace

**Status: VERIFIED (source).**

`@earendil-works/pi-ai@0.84.1` → `src/providers/qwen-token-plan.ts`:

```ts
baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
auth: { apiKey: envApiKeyAuth("Qwen Token Plan API key", ["QWEN_TOKEN_PLAN_API_KEY"]) },
```

There are three such providers (`qwen-token-plan`, `qwen-token-plan-cn`, `qwen-token-plan-individual`) and none of them is DashScope pay-as-you-go. Different subdomain (`token-plan.` vs `dashscope-intl.` / `{WorkspaceId}.`), different env var, different billing product. A pay-as-you-go `sk-` DashScope key will not authenticate against it.

PROJECT.md already records this decision correctly. The pitfall is **regression**: someone runs `/login`, sees "Qwen" in the provider list, picks it, pastes the DashScope key, gets a 401, and concludes DashScope is broken.

**How to avoid:** Ship the custom provider entry in `models.json` and document in the runbook: *"Do not use the built-in Qwen providers. They are a different Alibaba product."* Consider a startup assertion that fails if `QWEN_TOKEN_PLAN_API_KEY` is set.

**Phase to address:** Providers, First-run runbook.

---

### Pitfall 10: Bedrock + SSO — `aws sso login` alone does not satisfy Pi's credential gate, and EC2 instance profiles are unsupported

**Status: VERIFIED (source). All three sub-claims confirmed.**

`@earendil-works/pi-ai@0.84.1` → `src/providers/amazon-bedrock.ts`, `resolve()` accepts exactly:

1. `credential.key` (stored bearer token)
2. `AWS_BEARER_TOKEN_BEDROCK`
3. `credential.env.AWS_PROFILE` **or** ambient `AWS_PROFILE`
4. `AWS_ACCESS_KEY_ID` **and** `AWS_SECRET_ACCESS_KEY`
5. `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` or `..._FULL_URI` (ECS task role)
6. `AWS_WEB_IDENTITY_TOKEN_FILE`

...and otherwise `return undefined`.

Three consequences, each verified:

- **`aws sso login` sets no environment variable.** It writes a token cache under `~/.aws/sso/cache/`. Unless `AWS_PROFILE` is exported, condition 3 fails and Pi reports no Bedrock credentials even though the AWS SDK itself would resolve fine. Having a single `[default]` SSO profile in `~/.aws/config` does **not** help — `AWS_PROFILE` must be literally set.
- **The "Existing AWS credential chain" login option stores nothing.** It prompts *"Configure AWS credentials, then press Enter to continue"* and returns `{ type: "api_key" }` — no `key`, no `env`. On the next `resolve()` it contributes nothing and you fall through to the env-var checks anyway. It is a no-op that looks like a configuration step.
- **EC2 IMDS / instance profiles are unsupported.** ECS task roles and web-identity are checked; EC2 instance metadata is not. On an EC2 dev box with an attached instance profile and no env vars, Pi refuses to use Bedrock.

**How to avoid — the working incantation:**
- Preferred: `pi auth login` → Amazon Bedrock → **"AWS profile"** → type the profile name. This persists `env: { AWS_PROFILE: "<name>" }` into `auth.json`, so it survives shell restarts and satisfies condition 3 without polluting the global environment.
- Or export `AWS_PROFILE` in the shell profile that launches Pi (note: a GUI-launched terminal may not inherit it).
- Bake into the first-run runbook: `aws sso login --profile X && echo $AWS_PROFILE` — if the echo is empty, Bedrock will not work regardless of a successful SSO login.

**Phase to address:** Providers, First-run runbook (this is exactly the class of thing the runbook exists for, since it cannot be tested on the dev machine).

---

### Pitfall 11: Expired SSO surfaces as a raw SDK error with no reauth path

**Status: VERIFIED (source).**

`formatBedrockError` (`src/api/bedrock-converse-stream.ts:357-374`) maps only five known exception names (`InternalServerException`, `ModelStreamErrorException`, `ValidationException`, `ThrottlingException`, `ServiceUnavailableException`) to friendly prefixes. A credentials/SSO expiry is none of these — it falls through to the raw message. There is no branch that recognises credential expiry and no reauth prompt.

Worse, retry classification is string-matching-based: the code comments note that downstream retry logic *"matches patterns like `server.?error` and `service.?unavailable`"* against `errorMessage`. An SSO expiry that happens to be wrapped in a 5xx-shaped message could be retried repeatedly against a credential that will never become valid — burning wall-clock in the middle of a long agent run.

**How to avoid:**
- PROJECT.md already lists "detection of expired credentials with an actionable message" as a requirement. Implement it in `after_provider_response`: match `ExpiredToken`, `ExpiredTokenException`, `InvalidGrantException`, `CredentialsProviderError`, `The SSO session ... has expired`, and `UnrecognizedClientException`, and surface `Run: aws sso login --profile <name>`.
- Mark these **non-retryable** in your own retry wrapper so a dead credential fails in one turn, not after exponential backoff.
- SSO sessions are typically 8-12 hours; on a full working day this fires roughly daily. It is not an edge case.

**Phase to address:** Providers (error mapping), Safety (retry/failover behaviour).

---

### Pitfall 12: `pi install` runs npm lifecycle scripts — arbitrary code executes before any Pi code loads

**Status: VERIFIED (source). Highest-severity supply-chain finding.**

`@earendil-works/pi-coding-agent@0.84.1` → `src/core/package-manager.ts:1758-1779`:

```ts
private getNpmInstallArgs(specs: string[], installRoot: string): string[] {
	const packageManagerName = this.getPackageManagerName();
	if (packageManagerName === "bun") {
		return ["install", ...specs, "--cwd", installRoot, "--omit=peer"];
	}
	if (packageManagerName === "pnpm") {
		return ["install", ...specs, "--prefix", installRoot,
			"--config.auto-install-peers=false",
			"--config.strict-peer-dependencies=false",
			"--config.strict-dep-builds=false"];   // <-- explicitly re-enables dep build scripts
	}
	return ["install", ...specs, "--prefix", installRoot, "--legacy-peer-deps"];
}
```

**No `--ignore-scripts` on any path.** So `pi install npm:some-extension` executes `preinstall`/`install`/`postinstall` hooks for that package **and its entire transitive dependency tree**, with full user permissions, at install time — before Pi's extension loader runs, before the project-trust prompt, and regardless of whether you ever enable the extension. Choosing pnpm does not help: Pi explicitly passes `--config.strict-dep-builds=false`, disabling pnpm 10's default blocking of dependency build scripts.

**Why this is acute for this machine specifically:**
The laptop holds live AWS SSO credentials for an account where merging to `main` auto-deploys. The 2026 npm threat landscape is dominated by exactly this vector: the May 2026 "Mini Shai-Hulud" campaign (TanStack, Mistral AI, UiPath, 160+ npm/PyPI packages) propagates via install scripts, steals cloud credentials, and installs a destructive persistent daemon; a separate strain specifically enumerates AI-developer-tool credentials (Anthropic, OpenAI, Gemini, Cohere, Mistral, Groq, xAI). The keyv/cacheable compromise (Aug 2026) came from a hijacked maintainer account, not a typosquat — so "I recognise the package name" is not protection.

The candidate install surface is ~11 extensions plus their dependency closures, drawn from **7,276 npm packages carrying the `pi-package` keyword** (verified via the npm registry search API, 2026-08-13) — none of which is reviewed by anyone.

**How to avoid — concrete, in priority order:**
1. **Set `ignore-scripts=true` in `~/.npmrc` before the first `pi install`.** This is the single highest-value line of configuration in the whole project. A handful of packages with native builds may then need a deliberate `npm rebuild`; that trade is obviously worth it here.
2. **Or point Pi at a wrapper.** The `npmCommand` setting (`src/core/settings-manager.ts:925-933`, argv-style `string[]`) lets you substitute the package-manager binary. A two-line shim that appends `--ignore-scripts` gives per-Pi enforcement without changing global npm behaviour.
3. **Pin exact versions, always.** `isExactNpmVersion` (`package-manager.ts:49`) only treats a fully-valid semver as pinned; anything else resolves to `@latest` on install *and* on `pi update`. An unpinned entry means every update is an unreviewed code drop.
4. **Two-tier vetting.** Anything in the tool-execution or credential path (safety extensions, provider/fallback extensions, subagents) → read the source or vendor it. Cosmetic extensions (themes, statusline) → pin and move on. Note that even safety extensions touch credentials: `pi-defender@1.9.1` reads `GH_TOKEN`/`GITHUB_TOKEN`, shells out to `gh auth token`, and parses `~/.config/gh/hosts.yml` for an OAuth token (for its `/defender:report-issue` feature). Legitimate, but it is exactly the code path a compromised version would weaponise.
5. **Install into a throwaway VM/container first**, run `npm ls --all`, diff the dependency closure against expectations, then replicate the pinned set on the work laptop.
6. **Reduce blast radius:** keep SSO sessions short, keep the deploy-triggering credential out of the default profile, and rely on GitLab server-side protection (Pitfall 14) rather than on the laptop being clean.

**Known malicious Pi packages:** none found. I searched and found no reported compromise of any `pi-package`-keyword package as of 2026-08-13. Treat that as *absence of evidence* — the ecosystem is ~7 months old, unmonitored, and has no security contact. Do not read it as evidence of absence.

**Warning signs:** an install that takes unusually long or produces network activity; new files in `~/.aws`, `~/.ssh`, `~/.npmrc`; unexpected `gh` API calls; a dependency closure that grows by dozens of packages for a cosmetic extension.

**Phase to address:** Bootstrap (npmrc + pinning policy before the first install), Safety/supply chain.

---

### Pitfall 13: The `tool_call` hook is a mistake-catcher, not a security boundary — and it can be un-done by another extension

**Status: VERIFIED (source) for the mechanism; bypass enumeration is reasoned from shell semantics.**

Pi's own extension types document the ordering hazard explicitly (`src/core/extensions/types.ts:899-903`):

```
 * `event.input` is mutable. Mutate it in place to patch tool arguments before execution.
 * Later `tool_call` handlers see earlier mutations. No re-validation is performed after mutation.
```

So a later-loaded extension can rewrite a command *after* your guard inspected and approved it, and Pi will not re-check. Extension load order is therefore part of your security model, which is a bad place to be.

**Concretely, how a string matcher over `git push` / `glab mr merge` is defeated.** All of these are things a *confused model* will produce naturally, not just an adversary:

| Technique | Example | Why the matcher misses |
|---|---|---|
| Variable indirection | `g=push; git $g origin main` | literal `git push` never appears |
| Command substitution | `git $(echo push)` / `git \`printf push\`` | resolved by the shell, not by you |
| Nested shell | `sh -c 'git push'`, `bash -lc "..."`, `eval "$CMD"` | payload is a quoted argument |
| Heredoc → script | `cat > /tmp/d.sh <<'EOF' ... EOF; sh /tmp/d.sh` | two innocuous commands |
| Different repo | `git -C /other/repo push` | your cwd assumptions do not hold |
| Env wrapper | `env -i git push`, `GIT_DIR=... git push` | prefix breaks anchored patterns |
| Task-runner indirection | `npm run deploy`, `make deploy`, `just ship` | the dangerous verb is in a file |
| Encoding | `echo Z2l0IHB1c2g= \| base64 -d \| sh` | no plaintext at all |
| Backgrounding | `nohup ... &`, `setsid`, `at now` | escapes the turn; may outlive the session |
| Quoting/whitespace | `g"i"t p'u'sh`, `git\` + newline + `push`, `$IFS` tricks | trivially defeats naive regex |
| Shell function/alias | `d(){ git push; }; d` | definition and call are separate |
| PATH shadowing | write a `git` shim earlier on `PATH` | your matcher watches the name, not the binary |
| Different client | `glab`, `hub`, `curl` to the GitLab API with `$GITLAB_TOKEN` | you did not enumerate every client |
| **Not bash at all** | `write`/`edit` into `.git/hooks/pre-commit`, `.bashrc`, `.gitconfig[alias]`, a CI file | a later benign command detonates it |
| Custom tool | any extension-registered tool that shells out internally | fires `tool_call` with an unknown `input` shape your bash matcher does not parse |

**What each option actually gives you:**

| Option | Catches | Misses | Verdict |
|---|---|---|---|
| Hand-rolled `tool_call` matcher | literal, unobfuscated dangerous commands | everything in the table above | **Adequate mistake-catcher.** Correct choice for the stated threat model. Do not over-invest. |
| `pi-defender` pattern mode | curated regex set (`rm -rf`, `sudo`, `curl \| bash`, `git push --force`, ...), plus path-level `zeroAccess`/`readOnly`/`noDelete` guards; splits `&&`/`\|\|` chains and approves each sub-command | same obfuscation classes | Better-curated version of the same idea. **VERIFIED** feature set from package source/README. |
| `pi-defender` **strict mode** | *every* bash command requires human approval; whitelist to auto-approve | human fatigue; still opaque for `sh -c "$(curl ...)"` | **The genuinely strong non-OS control**, because a human reads the literal string. Costs interactivity — probably right for `main`-adjacent work, wrong for a flow-state daily driver. |
| `pi-sandbox` | OS-level FS + network confinement via `@carderne/sandbox-runtime` (fork of Anthropic's) — a real boundary, obfuscation-independent | **macOS and Linux only.** `src/extension.ts:114` emits `Sandbox not supported on ${platform}`. Requires `rg` on PATH at init. Its own README warns the browser-support config "opens significant security loopholes" | **The only real boundary — and unavailable on Windows.** Adopt when the user moves to macOS; cannot be the Windows answer. **VERIFIED** from package source. |
| `@ramtinj95/pi-infra-command-guard` | approval gate for infra/cloud/container/secret commands — closest match to the terraform/aws/kubectl requirement | not independently source-reviewed here (**UNVERIFIED**) | Evaluate by reading its source; it targets exactly this project's confirm-gate list |
| **GitLab protected branches + push rules** | *everything*, including all of the above, because it is enforced where the model has no code execution | nothing relevant | **The only control that is not theatre.** |

**How to avoid the trap:**
1. **Configure GitLab server-side protection first, in phase order, before writing a single hook.** Protected `main` with no-one allowed to push and merge restricted to a human-approved MR is the actual control. Everything local is defence-in-depth.
2. Write the local matcher for **the mistake, not the adversary**. `HEAD == main` + `glab mr merge` is the right granularity; do not chase obfuscation.
3. **Guard the non-bash surface too.** `write`/`edit` to `.git/hooks/*`, `.git/config`, `~/.bashrc`, `~/.gitconfig`, and CI files are the cheapest real bypass and the easiest to block, because those are exact paths, not patterns.
4. **Own the load order.** Load your safety extension and assume nothing about what runs after it. If you adopt a second guard extension, verify it does not mutate `input`.
5. **Install safety extensions at USER scope, never project scope** (see Pitfall 15).
6. **Audit-log every allow and every block** with the literal command string. When something slips through, the log is how you learn which pattern to add — and it is the only way to distinguish "the guard worked" from "the guard never fired".

**Phase to address:** Safety — but with GitLab server-side config as an explicit, *earlier* deliverable than the hook.

---

### Pitfall 14: `/share` uploads the session to a world-readable-by-URL gist, and `PI_OFFLINE` does not stop it

**Status: VERIFIED (source). Complete telemetry surface enumerated below.**

`src/core/slash-commands.ts:25`:

```ts
{ name: "share", description: "Share session as a secret GitHub gist" },
```

A GitHub **secret gist is not private** — it is unlisted. Anyone with the URL can read it, it is not access-controlled, and it does not expire. On a work laptop, `/share` on a session containing proprietary source, internal hostnames, or an accidentally-echoed token is a disclosure event.

Mitigating detail: `getShareViewerUrl` (`src/config.ts:502-508`) returns `${base}#${gistId}` — the gist id sits in the URL *fragment*, which browsers do not send to the server, so `pi.dev` does not receive the id. The gist itself remains the exposure.

**Complete network surface of Pi 0.84.1** (every outbound URL in the source, verified by exhaustive grep):

| Endpoint | Purpose | Disabled by |
|---|---|---|
| `https://pi.dev/api/report-install?version=` | install telemetry, `User-Agent` only | `PI_OFFLINE` **and** `PI_TELEMETRY=0` / settings toggle (both gates checked) |
| `https://pi.dev/api/latest-version` | update check | `PI_OFFLINE`, `PI_SKIP_VERSION_CHECK` |
| `https://api.github.com/repos/.../releases/latest` | tool/extension version lookup | `PI_OFFLINE` |
| GitHub gist API | `/share` | **nothing** — no env var gates it |
| `https://pi.dev/session/#<gistId>` | share viewer link (client-side fragment) | `PI_SHARE_VIEWER_URL` overrides the base |
| Attribution headers (`HTTP-Referer: https://pi.dev`, `X-OpenRouter-Title: pi`, `X-BILLING-INVOKE-ORIGIN: Pi`, `User-Agent: pi-coding-agent`) | OpenRouter / NVIDIA / Cloudflare only | `PI_TELEMETRY=0` — `getDefaultAttributionHeaders` returns `undefined` |
| npm registry | `pi install` / `pi update` | `PI_OFFLINE` (`isOfflineModeEnabled()` short-circuits update checks) |

**What the flags actually control (VERIFIED):**
- `PI_OFFLINE` (or `--offline`) — "disable startup network operations". `main.ts:572-575` shows `--offline` sets *both* `PI_OFFLINE=1` and `PI_SKIP_VERSION_CHECK=1`. It gates the version check, install telemetry, and package update checks. It does **not** gate `/share`, and obviously does not gate model API calls.
- `PI_TELEMETRY` — install telemetry **only**, plus provider attribution headers. Accepts `1/true/yes` and `0/false/no`; when unset, falls back to the settings toggle.
- `PI_SKIP_VERSION_CHECK` — the version check only.

**Reassuring finding worth recording:** there is **no analytics endpoint, no crash reporter, no session-content upload, and no prompt/completion logging** anywhere in Pi's source. The only content that ever leaves the machine (beyond model API calls) is what `/share` sends, and that requires an explicit user action. Pi's telemetry posture is genuinely minimal.

**How to avoid:**
- Block `/share` in the harness (already a requirement). Implement it as a slash-command interception **and** verify it cannot be reached via a differently-named alias.
- Set `PI_OFFLINE=1` and `PI_TELEMETRY=0` in the work-laptop profile. Note the cost: `PI_OFFLINE` also disables `pi install`/`pi update` network access, so bootstrap and updates need it unset — script that explicitly rather than leaving it permanently off.
- Do **not** attempt to block network access wholesale; model API calls need it, and a blanket block will produce confusing failures.
- Since the harness repo is public: the wire inspector dumps request payloads that will contain `Authorization` headers, AWS SigV4 signatures, and full prompt bodies. **Redact secrets at capture time and gitignore the dump directory.** A wire inspector is, by construction, a credential-logging tool.

**Phase to address:** Safety (block `/share`), Diagnostics (redaction is a *requirement* of the inspector, not a nicety), Bootstrap (env defaults).

---

### Pitfall 15: Project-scoped extensions silently do not load in subagents or any non-interactive mode

**Status: VERIFIED (source). Directly undermines the safety design if missed.**

`src/core/project-trust.ts`:

```ts
if (!options.projectTrustContext.hasUI) {
	return false;
}
```

Project trust is required to load project-scoped extensions, packages, and `.pi/` resources. When there is no UI to prompt with, `resolveProjectTrusted` returns `false` — project extensions do not load. And `pi-subagents@0.47.1` spawns real child `pi` processes (`src/runs/shared/pi-spawn.ts:139-163` → `getPiSpawnCommand` resolving to the pi binary or `node <piCliPath>`), which run headless.

**Net effect: a safety extension installed at project scope protects your interactive session and nothing else.** Subagents — which are precisely where a cheap model runs unsupervised with less context — run unguarded. Same for `pi --print`, CI, and any scripted invocation.

User-scope extensions load regardless of project trust, so this is entirely avoidable.

**How to avoid:**
- **Install every safety-critical extension at user scope.** Reserve project scope for cosmetics and project-specific prompts.
- Add a startup assertion in your own extension: if the guard's own scope is project-level, warn loudly.
- Verification test for the runbook: launch a subagent that attempts a blocked command and confirm it is blocked. Do not assume.
- Set `defaultProjectTrust` deliberately. `"always"` defeats the trust prompt entirely (dangerous when opening a cloned repo containing a malicious `.pi/` extension); `"never"` breaks project resources silently. `"ask"` is correct but means headless runs get nothing.

**Warning signs:** A guard that fires in the main session and never appears in the subagent audit log — which reads as "the subagent did nothing dangerous" rather than "the guard was absent".

**Phase to address:** Safety, Subagents.

---

### Pitfall 16: Pinning protects you from churn until the pinned version is unpublished

**Status: VERIFIED (registry).**

Release cadence, measured from the npm registry on 2026-08-13:

| Package | Versions | Window | Rate |
|---|---|---|---|
| `@earendil-works/pi-coding-agent` | 40 (0.74.0 → 0.84.1) | 2026-05-07 → 2026-08-07 | ~13/month, one every ~2.3 days |
| `pi-subagents` | 109 (0.3.0 → 0.47.1) | 2026-01-24 → 2026-08-12 | ~16/month; **13 in the first 12 days of August alone** |

Both claims in the brief are confirmed. But the more useful finding:

**`npm view @earendil-works/pi-coding-agent@0.60.0` returns 404.** Everything below 0.74.0 has been removed from the registry. Pi's own `dist-tags` carry `legacy-node20: 0.74.2` as the oldest supported line. So a bootstrap script that pins an exact Pi version has a **shelf life measured in months** — pin 0.84.1 today and a cold-machine bootstrap in six months may fail with E404 on a version that no longer exists.

**What breaks when you pin:**
- Bootstrap eventually 404s (above).
- Extensions pinned against an older Pi may not load against a newer host, and vice versa: Pi's CHANGELOG shows real breaking changes to the extension surface — the TypeBox 1.3.7 upgrade removed `Type.Base`, `Type.Awaited`, `Type.Promise`, `Type.Iterator`, `Type.Options`, `Value.Mutate` with an explicit *"Extensions using removed APIs must migrate"*; `compat.sendSessionIdHeader` was removed from `models.json` (replaced by `sessionAffinityFormat`); `ModelsStreamTransforms` was renamed; `ModelRuntime.getAll()/find()/getSnapshot()/getAuthOptions()` were removed. The pi-ai root entrypoint has been aliased to `/compat` **with an announced future removal** — a scheduled break already on the calendar.
- Model catalogs are baked into the pinned version. Pinning Pi pins its `deepseek.json` and `amazon-bedrock.json`. When DeepSeek ships V5, your pinned Pi will not know it exists.

**What breaks when you don't pin:**
- ~13-16 unreviewed code drops per month onto a machine with live deploy credentials (compounds Pitfall 12).
- `pi update` resolves unpinned entries to `@latest` (`package-manager.ts:1146`), so a routine update is an unreviewed dependency bump across the whole extension set.
- Silent behaviour changes mid-investigation. Debugging "why is DeepSeek worse today" while the harness updated underneath you is the exact failure the wire inspector exists to prevent — and an unpinned harness reintroduces it.

**Discipline observed (good news):** Pi's CHANGELOG is 5,436 lines, uses explicit `### Breaking Changes` / `### Removed` sections, credits PRs and issues, and gives concrete migration instructions. That is unusually good for a project moving this fast. It does **not** amount to a deprecation *policy* — there is no stated support window and no semver-major signal (everything is 0.x, so semver gives you no protection at all).

**How to avoid:**
1. **Pin exact versions for extensions; pin a caret or minor range for Pi itself**, and treat Pi upgrades as a scheduled, deliberate act.
2. **Vendor the bootstrap fallback.** If the pinned Pi version 404s, fall back to `latest` with a loud warning rather than failing the bootstrap.
3. **Read `### Breaking Changes` in the CHANGELOG on every Pi bump.** It is the single highest-value 60 seconds in the maintenance loop.
4. **Budget one maintenance session per month.** At 13-16 releases/month across ~11 extensions, drift is not optional; the only question is whether you pay it in scheduled batches or in surprise breakage mid-task.
5. **Smoke test after every bump:** one turn per provider, one subagent spawn, one blocked command, one wire-inspector dump. Ten minutes, catches almost everything.
6. **PROJECT.md's "compose, never fork" decision is correct and this data supports it** — 16 releases/month is unforkable.

**Phase to address:** Bootstrap (pinning + fallback), and a standing maintenance ritual documented in the repo.

---

### Pitfall 17: Windows portability — the specific things that break

**Status: VERIFIED (source) except where noted.**

**`auth.json` permissions are not enforced on Windows.** `src/core/auth-storage.ts` writes with `{ mode: 0o600 }` and calls `chmodSync(this.authPath, 0o600)` in three places. On Windows, Node's `chmod` only toggles the read-only attribute; it does not touch ACLs. So `auth.json` — holding API keys and the stored `AWS_PROFILE` — inherits directory ACLs and is readable by any process running as the user. Pi's code *looks* like it protects the file and does not.
*Mitigation:* store nothing in `auth.json` that isn't already reachable from the environment. PROJECT.md's `$ENV_VAR` / `!command` interpolation plan is exactly right — it keeps secrets out of the file. Make that non-negotiable rather than a preference.

**Bash children are not detached on Windows.** `src/core/tools/bash.ts`: `detached: process.platform !== "win32"`. Pi compensates with `trackDetachedChildPid` / `killProcessTree`, but process-group semantics differ, so `nohup`/`&`/`setsid` inside a Git Bash child behave differently than on macOS. Backgrounded jobs and long-running dev servers are the most likely place for orphaned processes to accumulate on Windows.

**Shell discovery is narrow.** `src/utils/shell.ts:67-120` checks, in order: an explicit `shellPath` setting → `%ProgramFiles%\Git\bin\bash.exe` → `%ProgramFiles(x86)%\Git\bin\bash.exe` → `bash.exe` anywhere on `PATH`. A per-user Git install (`%LOCALAPPDATA%\Programs\Git`) is **not** in the known-locations list and only works if `bash.exe` is on `PATH`. A WSL `bash.exe` on `PATH` will be picked up and will resolve Windows paths incorrectly.
*Mitigation:* set `shellPath` explicitly in settings and assert it at startup. Do not rely on discovery.

**`getShellConfig` may use stdin transport.** `bash.ts` branches on `shellConfig.commandTransport === "stdin"` and pipes the command instead of passing `-c`. Quoting behaviour differs between the two paths, so a command that works on one platform can break on the other purely from quoting. Test hook scripts on both.

**Path normalisation is partial.** `buildSystemPrompt` does `cwd.replace(/\\/g, "/")` for the prompt, so the *model* sees forward slashes — but tool inputs, git output, and your own hook code will see backslashes. Any path comparison in a safety hook (e.g. "is this write outside the project directory?") must normalise both sides and handle drive-letter case (`C:` vs `c:`) or it will fail open.

**Line endings.** Git Bash + `core.autocrlf` means hook scripts and generated files can acquire CRLF. A `sh` script with CRLF fails with `$'\r': command not found`. *Mitigation:* commit `.gitattributes` with `*.sh text eol=lf` from day one. This is a five-minute fix that costs an hour to diagnose later.

**`pi-sandbox` does not run on Windows** (Pitfall 13). The strongest safety option is macOS/Linux only.

**CLI differences.** `aws` and `glab` on Windows return Windows-style paths and may prompt differently for credentials; `glab` config lives in a different location. **UNVERIFIED** in detail — worth an explicit runbook check.

**How to avoid:**
- POSIX `sh` for every hook and script (already a constraint — hold the line).
- `.gitattributes` with `eol=lf` in the first commit.
- Explicit `shellPath`, asserted at startup.
- Normalise paths on both sides of every comparison; write a single shared helper and use it everywhere.
- The planned GitHub Actions `windows-latest` + `macos-latest` matrix is the right answer for the untestable half. Make the matrix run the *hooks*, not just a build — a green build on macOS says nothing about whether the safety matcher works there.

**Phase to address:** Bootstrap (gitattributes, shellPath), Safety (path normalisation), CI (matrix).

---

### Pitfall 18: Context pollution — what actually costs tokens in Pi, and what doesn't

**Status: VERIFIED (source) for Pi's mechanics; MEDIUM for the degradation evidence.**

The hypothesis in PROJECT.md is plausible but needs correcting on the mechanics. Reading `src/core/system-prompt.ts` end to end:

**Pi's base system prompt is genuinely small** — roughly 350-450 tokens: a one-paragraph role statement, the tools list, a short guidelines list, and a block of Pi-documentation pointers. That last block (7 bullets about where Pi's own docs live) is ~150 tokens of pure overhead for a user who never asks about Pi itself, and it is present on **every turn**.

**Registered tools do NOT bloat the system prompt.** Line 82: `const visibleTools = tools.filter((name) => !!toolSnippets?.[name])`. A tool appears in the prompt's "Available tools" list only if the caller supplies a one-line snippet. The real cost of tools is the **JSON schema array in the API request body**, which is a separate budget the system prompt never shows you. This matters: the intuition "I registered 20 tools so my system prompt is huge" is wrong, while "I registered 20 tools so my request is huge" is right. Measure the request, not the prompt.

**What does inline into the system prompt, every turn:**
- **`AGENTS.md` verbatim**, wrapped in `<project_context>` / `<project_instructions path="...">`. Whatever you put in AGENTS.md, you pay for on every single turn.
- **Skills: name + description + absolute file path per skill**, in an `<available_skills>` XML block plus a 3-line preamble (`formatSkillsForPrompt`, `src/core/skills.ts:335-361`). Roughly 40-60 tokens per skill. Progressive disclosure works — the *body* is only read on demand — but the index is not free. Sixty skills is roughly 3,000 tokens/turn of pure index. PROJECT.md's decision not to port GSD's ~60 skills is quantitatively as well as architecturally correct.
- `appendSystemPrompt` and `promptGuidelines` from extensions, deduplicated by exact string (`guidelinesSet`) — so near-duplicate guidelines from two extensions both survive.

**Evidence that this hurts weaker models specifically.** [Chroma's "Context Rot"](https://www.trychroma.com/research/context-rot) evaluated 18 frontier models (GPT-4.1, Claude 4, Gemini 2.5, Qwen3) and found **every one degrades as input length grows**, including on trivial retrieval and text-replication tasks. Two findings are directly actionable here: performance collapses faster when the target is semantically *similar* to its surroundings, and — counterintuitively — coherent well-structured input degrades attention *more* than shuffled input. A tidy, well-written AGENTS.md full of plausible-sounding instructions is therefore closer to worst-case than best-case input.

**Honest caveat:** the Chroma work is on frontier models and does not isolate *system-prompt* bloat from total-context bloat, and I found **no study establishing a specific token threshold at which a weaker model degrades**. Anyone quoting a magic number is guessing. Treat "system prompt bloat degrades DeepSeek" as a **credible, unproven hypothesis** — which means it must be *measured*, not designed around.

**A cache dimension nobody mentions, and it may dominate.** Pi's DeepSeek catalog prices cache reads at **$0.0028/Mtok against $0.14/Mtok for fresh input — a 50× discount**, with `cacheWrite: 0`. The system prompt is the most cacheable thing in the request *provided it is byte-identical between turns*. Two planned features threaten that: a statusline or header that injects anything varying (time, cost-so-far, git branch) into the system prompt, and any per-turn logging that mutates prompt content. **Injecting one changing token at the top of the system prompt costs 50× on the entire prefix, every turn.** Keep all volatile content in the TUI chrome or in user messages, never in the system prompt.

**How to avoid — measure first, then cut:**
1. **The wire inspector must report, per turn: system-prompt tokens, tool-schema tokens, context-file tokens, skills-index tokens, `cacheRead` vs `input`.** Five numbers. Without them every context decision is guesswork.
2. **Run the controlled experiment**, since this is the second candidate root cause of the user's original complaint: same task, same model, minimal harness vs full harness. If quality does not move, context pollution is not the problem and you have saved yourself an architecture built on a wrong premise.
3. **Cap AGENTS.md.** Give it a hard token budget (say 500) and enforce it in CI. It is the one file that grows without anyone noticing.
4. **Watch `cacheRead`.** If it is near zero on turn 3+, something is busting the cache — find it before optimising anything else.
5. **Consider `customPrompt`** to drop the ~150-token Pi-docs block, accepting that you lose Pi self-documentation.
6. **Count schemas, not prose.** Every extension-registered tool adds a JSON schema to every request. Prefer skills (index-only) over tools for anything not needed on most turns.

**Phase to address:** Diagnostics (measurement must come first — this is the second reason the wire inspector is phase-one), then Context.

---

### Pitfall 19: Evidence gating is only real if it reads tool results, not model prose

**Status: reasoned from Pi's verified event model; MEDIUM confidence on the failure rate.**

**What goes wrong:**
The stated requirement is "no claim of success without real command output in the transcript". The failure mode is that a model **writes** convincing command output. A cheap model producing a plausible `PASS 24 tests` block inside its own message is a well-known behaviour, and a naive gate that greps the transcript for "tests passed" is satisfied by it. The gate then certifies fabricated evidence — worse than no gate, because it manufactures confidence.

This compounds sharply with Pitfall 7: when a tool call evaporates into prose, the model's *next* message is written as though the tool had run. So the two failure modes actively cooperate to produce fabricated evidence.

**How to avoid — the distinction is architectural, not a matter of care:**
- Pi's hook model gives you two separate channels. `tool_result` events (`src/core/extensions/types.ts:911-960`) carry `content`, `isError`, and per-tool `details` from **actual execution**. Assistant message content is **model-authored**. Gate exclusively on the former.
- **Maintain gate state outside the conversation.** Record `{toolCallId, command, exitCode, timestamp}` from `tool_result` into your JSONL as the turn happens. At completion, check that ledger — not the transcript. The model cannot write into it.
- **Gate on exit codes, not on output text.** "Did `npm test` exit 0 within the last N turns, on the current HEAD?" is unfakeable. "Does the output say tests passed?" is trivially fakeable.
- **Bind evidence to a commit.** Evidence from before the last edit is stale. Store the git SHA with each piece of evidence and invalidate on change — otherwise the model runs tests, then makes three more edits, then claims the earlier green run.
- Reuse the Pitfall 7 detector: if a turn contains a prose tool call, mark the turn's evidence as suspect.

**Warning signs:** Completion claims with no matching `tool_result` in the JSONL; suspiciously well-formatted command output; evidence timestamps predating the last edit.

**Phase to address:** Diagnostics (the JSONL ledger is the substrate), Workflows (the gate consumes it).

---

### Pitfall 20: Review theatre — a cheap reviewer rubber-stamps, and a strong reviewer with a bad payload misses

**Status: reasoned; MEDIUM confidence.**

**What goes wrong:**
Two distinct failures wearing the same clothes. **(a)** The reviewing model approves nearly everything. A model asked "does this look right?" after a long agreeable context will say yes; agreement is the cheap path. You get a green review on every MR and learn nothing. **(b)** The reviewer is strong and honest but is shown only a diff, so it cannot see bugs of omission (the error case never handled), cross-file breakage (the caller you didn't update), or that the tests do not actually exercise the change.

PROJECT.md already addresses (b) — "diff plus touched files plus test/typecheck output" is the right payload. (a) is unaddressed and is the more insidious one, because it produces a *positive* signal.

**How to avoid:**
- **Fresh context, always.** Run review in a subagent with no history of the implementation. A reviewer that watched the code being written is invested in it.
- **Force a decision with structure.** Demand a verdict token and at least one specific concern, or an explicit "no concerns" with a stated reason it examined. Free-form "looks good to me" should be rejected by the harness as malformed, not accepted as a pass.
- **Calibrate with seeded defects.** Periodically inject a known bug and confirm the reviewer catches it. This is the only way to distinguish "the code is clean" from "the reviewer is asleep" — and it directly measures the project's core hypothesis (does a stronger reviewer catch what DeepSeek missed?). Cheap to build, and it produces the number that justifies the whole escalation design.
- **Deterministic gates first** (already planned, and correct): typecheck, lint, LSP diagnostics. Free, instant, never sycophantic. Never spend a review token on something a compiler proves.
- **Track review outcomes in the JSONL.** If the approval rate is ~100% over a few weeks, the reviewer is theatre regardless of how good the model is.

**Phase to address:** Quality levers, Workflows.

---

### Pitfall 21: Spec-driven workflows fail by ceremony, not by omission

**Status: reasoned; MEDIUM confidence.**

Recurring failure patterns in spec-driven agent workflows, mapped to what this project has already decided:

| Failure | What it looks like | Mitigation (and whether PROJECT.md covers it) |
|---|---|---|
| **Spec written, then ignored** | The spec is produced, then the executor works from the conversation instead | Feed the spec into the executor's context as the *authoritative* artefact; make the execute step read it from disk, not from history. **Not yet covered.** |
| **Ceremony outgrows the work** | A one-line fix goes through grill→spec→plan→execute→review | The `quick` path exists — the risk is that it is *never chosen*. Make the workflow itself refuse: if the change is under N files/lines, `quick` is the default and ceremony must be explicitly requested. **Partially covered.** |
| **Spec goes stale** | Implementation diverges; the spec now describes a system that does not exist | Timestamp + git SHA the spec. Re-read and diff it at review time. Either update it or delete it — a stale spec is worse than none because it misleads the next reviewer. **Not covered.** |
| **Over-specification** | The spec pins implementation detail, so the executor cannot use a better approach and either fights it or ignores it | Specify observable behaviour and constraints; leave mechanism to the executor. The `grill` step should be interrogating *requirements*, not designing. **Design risk in the `grill → spec` step.** |
| **Grill never terminates** | Interrogation continues past useful, burning tokens and patience | Hard cap on grill rounds, plus an explicit "enough — write the spec" exit the user can pull at any time. **Not covered.** |
| **Plan-mode drift** | The plan is approved, then execution wanders | Plan becomes a checklist the executor ticks off; deviations require surfacing, not silence. |
| **Spec produced by the same model that will execute it** | Both share the same blind spots, so the spec encodes the misunderstanding | Grill/spec with the *stronger* model; execute with the cheap one. This is precisely where escalation earns its cost — one strong-model spec amortises across many cheap execution turns. **Aligns with the project thesis; make it explicit in the role map.** |

**Phase to address:** Workflows. Recommendation: build `quick` **first**. It is the smallest, the most used, and it establishes the routing/safety/evidence plumbing that the ceremonial workflows then reuse. Building `grill → spec` first risks a beautiful ceremony on top of unproven foundations.

---

### Pitfall 22: Multi-agent fan-out — cost, worktrees, and orphans

**Status: mixed; per-item confidence noted.**

**Cost blow-up is the headline risk.** Fan-out multiplies token spend by the branching factor, and every subagent re-reads context the parent already has. Four subagents at 30k context each is 120k tokens before any work happens. On a project whose *purpose* is cost control, an unbudgeted fan-out can cost more than doing the task on Sonnet directly — which would be a genuinely embarrassing outcome. *Mitigation:* per-session subagent budget with a hard cap; log fan-out cost as its own JSONL field; measure "cost of N subagents on flash" against "cost of one turn on the strong model" for real tasks and let the number decide, not intuition.

**Subagents lose context and redo work.** A fresh subagent does not know what the parent already discovered, so it re-greps, re-reads, re-derives. Charged at full rate each time. *Mitigation:* pass findings explicitly in the subagent prompt rather than expecting rediscovery; prefer one subagent with good context over three with none.

**Worktree isolation edge cases** (**UNVERIFIED** in detail — not exercised here):
- Untracked and ignored files (`.env`, `node_modules`, local config, `.terraform/`) do **not** come along to a new worktree. An agent in a fresh worktree may fail to build for reasons that look like code errors.
- Parallel agents editing the same file in different worktrees produce a merge conflict at integration — after both have been paid for.
- `git worktree add` from a repo whose `main` is a deploy trigger needs care that the new branch is not accidentally pushed.
- Worktree cleanup: abandoned worktrees accumulate and `git worktree prune` is not automatic.
- On Windows, worktrees plus long paths plus symlink-free checkouts is a known friction area.
*Mitigation:* verify worktree setup with a build, not just a checkout; assign non-overlapping file scopes to parallel agents; add explicit teardown to the subagent lifecycle.

**Orphaned processes** (**VERIFIED** mechanism): Pi tracks child PIDs (`trackDetachedChildPid`) and kills process trees, but on Windows children are not detached (Pitfall 17), and background work spawned by a subagent that itself was spawned by Pi is two levels deep. Dev servers and watchers are the usual survivors. *Mitigation:* every background job gets a timeout; the harness records spawned PIDs in the JSONL; a `/cleanup` command kills anything the session started. Verify on Windows specifically.

**Background jobs that never terminate:** a subagent waiting on a process that never exits consumes a slot and eventually the wall clock. *Mitigation:* hard timeouts on subagent runs, surfaced as failures rather than hangs.

**Phase to address:** Subagents.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| Build thinking budgets before the wire inspector | Feels like progress on the core complaint | May be a total no-op (Pitfalls 1, 4, 8); you will "tune" a parameter that never arrives and draw conclusions from noise | **Never.** PROJECT.md already forbids this — hold the line |
| Trust Pi's bundled catalog for a custom provider | Zero config | Wrong compat, wrong context window, silent quality loss (Pitfall 8) | Never for DashScope; acceptable for the built-in `deepseek` provider, which is correct |
| Unpinned `pi install` | One less field to maintain | ~13-16 unreviewed code drops/month onto a machine with deploy credentials | Never |
| Skip `ignore-scripts` | Native deps just work | Arbitrary code execution on every install and update (Pitfall 12) | Never on this laptop |
| Blanket "main" string matcher | One line of code | Breaks `git fetch/rebase/diff/log origin/main` and `git worktree add -b feat main` | Never — PROJECT.md already rejects this |
| Grep the transcript for evidence | Simple to write | Model fabricates the evidence; gate certifies fiction (Pitfall 19) | Never |
| Project-scope the safety extension | Keeps config with the project | Silently absent in subagents and headless runs (Pitfall 15) | Never for safety; fine for themes |
| Put dynamic data in the system prompt | Easy statusline/context | 50× cost on the whole prefix by busting the cache (Pitfall 18) | Never |
| Skip macOS CI until later | Faster now | Ships unverified on a platform you cannot test; POSIX bugs found by the user | Acceptable only pre-first-macOS-use, and only if CI is scaffolded |
| Fork an extension to fix one bug | Immediate unblock | 16 releases/month of permanent unpaid divergence | Never — already a Key Decision |
| Skip redaction in the wire inspector | Ships a turn sooner | Credential-logging tool feeding a **public** repo | Never |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| AWS Bedrock (SSO) | Assuming `aws sso login` is enough | Export `AWS_PROFILE`, or use `pi auth login` → "AWS profile" to persist it (Pitfall 10) |
| AWS Bedrock ("credential chain" option) | Selecting it and believing it configured something | It stores nothing. Use "AWS profile" instead |
| AWS Bedrock (non-Claude) | Setting a thinking level and assuming it applies | It is dropped. Guard the route (Pitfall 1) |
| AWS Bedrock (DeepSeek) | Expecting V4, or using R1 as an executor | Only R1/V3/V3.2 exist; R1 has no tool use (Pitfall 6) |
| DeepSeek direct | Assuming Pi's `reasoning_effort` placement is wrong | It is correct. Verify once, move on (Pitfall 3) |
| DeepSeek direct | Tuning temperature for determinism | Ignored in thinking mode, which is the default (Pitfall 5) |
| DeepSeek direct | Trusting `low`/`medium` thinking levels | Removed by Pi's catalog; override `thinkingLevelMap` (Pitfall 4) |
| DeepSeek anywhere | Treating a missing tool call as "the model chose not to" | ~11% are dropped prose calls. Detect and retry (Pitfall 7) |
| DashScope | Relying on compat auto-detection | No detection branch exists. Write `compat` explicitly (Pitfall 8) |
| DashScope | Reusing a key across regions | Keys are region- and workspace-scoped and non-portable |
| Qwen via Pi's built-in provider | Using `qwen-token-plan` with a `sk-` DashScope key | Different host and key namespace (Pitfall 9) |
| GitLab | Relying on the local hook to protect `main` | Server-side protected branches are the only real control (Pitfall 13) |
| npm / `pi install` | Assuming install is inert | Lifecycle scripts run with full permissions (Pitfall 12) |
| GitHub `/share` | Reading "secret gist" as "private" | Unlisted, world-readable by URL, permanent. Block it (Pitfall 14) |

## Performance and Cost Traps

| Trap | Symptoms | Prevention | When It Bites |
|---|---|---|---|
| Cache-busting system prompt | `cacheRead` near zero after turn 2; cost ~50× expected | Keep all volatile data out of the system prompt | Immediately, every session |
| Thinking forced to `high` minimum on DeepSeek | Output-token cost far above estimate | Override `thinkingLevelMap` to restore `low` | Every thinking turn |
| Skills index growth | System prompt creeping up ~50 tokens per skill | Cap skill count; audit the index in the wire inspector | Past ~20 skills |
| AGENTS.md growth | Silent per-turn token creep | Hard token budget enforced in CI | Past ~500 tokens |
| Subagent fan-out | Session cost spikes on parallel work | Per-session subagent budget; log fan-out cost | Any parallel workflow |
| Retry storms on expired SSO | Long stalls mid-run, repeated identical failures | Classify credential errors as non-retryable | Roughly daily, at SSO expiry |
| Context-window mismatch | Provider rejects requests the guard allowed | Set `contextWindow` per-provider, not per-model-family | Long sessions on DashScope |
| Prose-tool-call retries | Cost creeps ~11% above baseline on tool-heavy turns | Accept it; it is far cheaper than the silent failure | Every tool-heavy session |

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| `pi install` without `ignore-scripts` | Credential theft / destructive daemon via a compromised transitive dep, on a machine with deploy credentials | `ignore-scripts=true` in `~/.npmrc` before the first install (Pitfall 12) |
| Unpinned extension versions | Every update is unreviewed code execution | Exact-version pins; scheduled, reviewed bumps |
| Installing from awesome-pi.site rankings | 6,996 auto-discovered, LLM-blurbed entries with no editorial or security review (VERIFIED from the site's own description); npm shows 7,276 `pi-package` packages | Use it for discovery only. Vet by reading source; judge by author, repo, tests, and dependency count — never by list position |
| Committing the wire-inspector dumps | Auth headers, SigV4 signatures, full prompts in a **public** repo | Redact at capture; gitignore the dump dir; add a CI secret-scan |
| Relying on `auth.json` 0600 on Windows | `chmod` is a no-op on Windows ACLs; keys readable by any user process | Keep secrets in env / `!command`, not in the file (Pitfall 17) |
| Project-scoped safety extension | Guard silently absent in subagents and headless runs | User scope only (Pitfall 15) |
| `defaultProjectTrust: "always"` | A cloned repo's `.pi/` extension runs automatically | Leave it as `"ask"` |
| `/share` reachable | Permanent unlisted publication of proprietary code | Block the command; verify no alias path (Pitfall 14) |
| Trusting the bash matcher as a boundary | A confused model bypasses it via any row of the Pitfall 13 table | GitLab server-side protection as the real control |
| Second guard extension mutating `input` | Post-approval rewrite; Pi does **not** re-validate (VERIFIED, `types.ts:899-903`) | Control load order; verify no other extension mutates tool input |

## "Looks Done But Isn't" Checklist

- [ ] **Thinking budgets:** verified on the wire that `thinking` and `reasoning_effort` (or `additionalModelRequestFields`) actually appear in the request body for *each* provider — not just that the UI accepted the setting
- [ ] **DeepSeek thinking tiers:** confirmed `low` is selectable *and* accepted (HTTP 200), after overriding `thinkingLevelMap`
- [ ] **DashScope provider:** `compat` block written explicitly; `thinkingFormat`, `requiresReasoningContentOnAssistantMessages`, `supportsStore`, `supportsDeveloperRole` each confirmed on the wire
- [ ] **DashScope multi-turn:** a two-turn *tool-calling* sequence completes without a 400 (the first turn always works — test the second)
- [ ] **Bedrock:** works in a fresh shell with only `aws sso login` run, or the runbook explicitly says to export `AWS_PROFILE`
- [ ] **Expired SSO:** deliberately expired the session and confirmed an actionable message, not an opaque SDK error, and no retry storm
- [ ] **Prose tool calls:** the detector has actually fired at least once on real traffic (if it never fires over a week of tool-heavy work, suspect the detector, not the model)
- [ ] **Safety hook:** tested inside a **subagent**, not just the interactive session
- [ ] **Safety hook:** tested against `sh -c`, `git -C`, variable indirection, and a `write` to `.git/hooks/pre-commit` — and the results documented as known-misses, so nobody later mistakes it for a boundary
- [ ] **GitLab protected branches:** configured server-side and verified by attempting a push, before the local hook is trusted
- [ ] **`/share`:** blocked and verified unreachable
- [ ] **Wire inspector:** redacts `Authorization`, `x-amz-*`, and API keys; dump directory gitignored
- [ ] **Evidence gate:** gates on `tool_result` exit codes bound to a git SHA, not on transcript text
- [ ] **Cache:** `cacheRead` is non-trivial by turn 3 (proves the system prompt is byte-stable)
- [ ] **Cross-platform:** hooks executed on `macos-latest` in CI, not merely built
- [ ] **Bootstrap:** cold-machine run succeeds, and degrades gracefully if a pinned version has been unpublished
- [ ] **`.gitattributes`:** `*.sh text eol=lf` committed
- [ ] **Subagent cleanup:** no orphaned processes after a background run on Windows

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Built thinking budgets on a no-op parameter | MEDIUM | Build the inspector, identify which providers actually receive it, gate the feature per-provider rather than deleting it |
| DashScope compat wrong | LOW | Add the `compat` block; no architectural change needed — this is why explicit config beats detection |
| Malicious package installed | **HIGH** | Rotate every credential on the machine (AWS SSO, DeepSeek, DashScope, GitHub, GitLab); audit CloudTrail for the SSO role; audit git history on auto-deploying repos; assume the laptop is compromised |
| Pinned Pi version unpublished | LOW | Bump to the nearest surviving version; read `### Breaking Changes` between the two |
| Extension broke on a Pi bump | LOW-MEDIUM | Roll back the Pi pin, check upstream for a matching release, wait — do **not** fork |
| Safety hook bypassed, `main` pushed | HIGH if deployed | Server-side protection should have prevented it. If it did not, that is the fix — not a better regex |
| Session shared to a gist | **HIGH / irreversible** | Delete the gist, assume it was scraped, rotate anything visible in it. Prevention is the only real control |
| Context bloat degraded quality | LOW | It is config, not architecture — cut skills, trim AGENTS.md, use `customPrompt`. Cheap *if* you measured first |
| Fan-out cost blow-up | LOW | Cap subagent count per session; the JSONL tells you where it went |

## Pitfall-to-Phase Mapping

Phase names are indicative; map to whatever the roadmap calls them.

| Pitfall | Prevention Phase | Verification |
|---|---|---|
| 12 npm lifecycle scripts | **Bootstrap (first)** | `npm config get ignore-scripts` returns `true` before any `pi install` |
| 16 version churn / unpublished pins | **Bootstrap** | Cold-machine bootstrap succeeds; fallback path exercised |
| 17 Windows portability | **Bootstrap** | `.gitattributes` committed; explicit `shellPath`; CI matrix green on hooks |
| 1 Bedrock thinking Claude-only | **Diagnostics** → Routing | Inspector shows `additionalModelRequestFields`; guard blocks the bad route |
| 3 DeepSeek nesting (non-issue) | **Diagnostics** | One inspector dump confirms; remove remediation work from the roadmap |
| 4 No `low` tier on DeepSeek | **Diagnostics** → Providers | `low` selectable and accepted after catalog override |
| 5 Sampling params ignored | **Providers** | Documented; no temperature lever built for DeepSeek |
| 7 Prose tool calls (~11%) | **Diagnostics (early)** → Quality | Detector fires on real traffic; rate recorded in JSONL |
| 8 DashScope compat | **Providers** | Two-turn tool sequence returns 200 |
| 9 `qwen-token-plan` confusion | **Providers** + runbook | Runbook states it; startup assertion optional |
| 10 Bedrock SSO gate | **Providers** + runbook | Fresh-shell test documented in the runbook |
| 11 SSO expiry UX | **Providers / Safety** | Expired-session test yields actionable text, no retry storm |
| 2 No Bedrock reasoning tokens | **Diagnostics** | JSONL schema does not contain an unfillable column |
| 18 Context pollution | **Diagnostics** → Context | Five token numbers per turn; controlled minimal-vs-full experiment run |
| 13 Hook bypasses | **Safety** — GitLab config *before* the hook | Server-side push rejection verified; known-misses documented |
| 15 Project-scope extensions | **Safety** | Blocked command test passes *inside a subagent* |
| 14 `/share` + telemetry | **Safety** + Bootstrap | `/share` unreachable; `PI_OFFLINE`/`PI_TELEMETRY` set |
| 6 Bedrock DeepSeek gap | **Routing / capability guards** | Guard refuses Bedrock DeepSeek for executor role |
| 19 Fabricated evidence | **Diagnostics (ledger)** → Workflows | Gate reads `tool_result` exit codes bound to a git SHA |
| 20 Review theatre | **Quality levers** | Seeded-defect calibration catches injected bugs |
| 21 SDD ceremony | **Workflows** — build `quick` first | `quick` is the default for small changes |
| 22 Multi-agent | **Subagents** | Budget cap enforced; no orphans after a Windows background run |

**Ordering consequences this research forces:**

1. `ignore-scripts` must be set **before the first `pi install`**, so it belongs to bootstrap, ahead of everything.
2. The **wire inspector is load-bearing for four separate pitfalls** (1, 4, 8, 18) and cannot be deferred. PROJECT.md's "wire inspector before quality levers" decision is confirmed and, if anything, understated.
3. The **prose-tool-call detector should land in the first diagnostics phase**, not with quality levers. It is the most likely root cause of the user's original complaint, it is measurable, and measuring it is cheap.
4. **GitLab server-side branch protection is a phase deliverable, not a note.** It must precede trusting the local hook.
5. **`quick` before the ceremonial workflows.** It exercises routing, safety, and evidence plumbing at the smallest possible size.

## Sources

**Primary — source code read directly** (recovered from published npm sourcemaps, HIGH confidence):
- `@earendil-works/pi-ai@0.84.1`: `src/api/bedrock-converse-stream.ts`, `src/api/openai-completions.ts`, `src/models.ts`, `src/types.ts`, `src/providers/amazon-bedrock.ts`, `src/providers/deepseek.ts`, `src/providers/qwen-token-plan.ts`, `dist/providers/data/{deepseek,amazon-bedrock}.json`
- `@earendil-works/pi-coding-agent@0.84.1`: `src/core/system-prompt.ts`, `src/core/skills.ts`, `src/core/package-manager.ts`, `src/core/telemetry.ts`, `src/core/provider-attribution.ts`, `src/core/auth-storage.ts`, `src/core/project-trust.ts`, `src/core/extensions/types.ts`, `src/core/tools/bash.ts`, `src/utils/shell.ts`, `src/config.ts`, `src/cli/args.ts`, `CHANGELOG.md` (5,436 lines)
- `pi-subagents@0.47.1`: `src/runs/shared/pi-spawn.ts`
- `pi-sandbox@0.6.3`: `src/extension.ts`, `README.md`
- `pi-defender@1.9.1`: `src/index.ts`, `README.md`
- npm registry metadata: version history, publish timestamps, `keywords:pi-package` search (7,276 results, 2026-08-13)

**Official documentation:**
- [DeepSeek Thinking Mode guide](https://api-docs.deepseek.com/guides/thinking_mode/) — JSON shapes, ignored sampling params, thinking-on-by-default, effort values
- [DeepSeek Create Chat Completion reference](https://api-docs.deepseek.com/api/create-chat-completion) — parameter table, deprecated penalties
- [DeepSeek reasoning model guide](https://api-docs.deepseek.com/guides/reasoning_model) — current model names
- [Alibaba Model Studio: regions and endpoints](https://www.alibabacloud.com/help/en/model-studio/regions/) — region-scoped keys, workspace-dedicated domains
- [Alibaba Model Studio: obtaining an API key](https://www.alibabacloud.com/help/en/model-studio/get-api-key)
- [Amazon Bedrock DeepSeek model parameters](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-deepseek.html)

**Issue trackers and community (MEDIUM confidence, cross-corroborated):**
- [deepseek-ai/DeepSeek-V3 #1244](https://github.com/deepseek-ai/DeepSeek-V3/issues/1244) — prose tool calls, 11% measured, open, V4-Pro
- [sgl-project/sglang #17561](https://github.com/sgl-project/sglang/issues/17561) — same signature on V3.2
- [vllm-project/vllm #28219](https://github.com/vllm-project/vllm/issues/28219) — R1 distill
- [openclaw/openclaw #85918](https://github.com/openclaw/openclaw/issues/85918) — DSML text in V4 tool turns
- [HuggingFace DeepSeek-V4-Pro discussion #209](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/discussions/209) — DSML markup
- [langchain-ai/langchain-aws #447](https://github.com/langchain-ai/langchain-aws/issues/447) — R1 on Bedrock Converse rejects tool use
- [AWS re:Post — tool calling for DeepSeek V3.1 in Bedrock Converse](https://repost.aws/questions/QU83cNU6P_Q0iJnkD9Tl4JIw/when-will-aws-add-tool-calling-support-for-deepseek-v3-1-in-bedrock-converse)

**Research and threat intelligence:**
- [Chroma — Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://www.trychroma.com/research/context-rot) — 18 models, universal degradation
- [Orca Security — TanStack and 160+ npm/PyPI packages compromised (Mini Shai-Hulud)](https://orca.security/resources/blog/tanstack-npm-supply-chain-worm/)
- [Wiz — keyv and cacheable npm supply chain attack](https://www.wiz.io/blog/keyv-and-cacheable-npm-supply-chain-attack)
- [Phoenix Security — Supply chain attacks 2026: npm, PyPI, VS Code, AI agents](https://phoenix.security/accelerating-supply-chain-attacks-npm-pypi-vsx-ai-enabled-2026/)
- [awesome-pi.site](https://awesome-pi.site/) — self-described "auto-discovered, LLM curated"; 6,996 extensions

**Explicitly UNVERIFIED (flagged inline):**
- DeepSeek `deepseek-chat` / `deepseek-reasoner` retirement date of 2026-07-24 (the *retirement* is corroborated — neither model appears in DeepSeek's docs or Pi's 0.84.1 catalog — but the exact date is not)
- DashScope DeepSeek context cap of exactly 393,216 tokens
- Whether OpenAI `strict` schema mode measurably reduces DeepSeek's prose-tool-call rate
- `@ramtinj95/pi-infra-command-guard` internals (package exists at 0.9.1; source not reviewed)
- `glab` / `aws` CLI behavioural differences on Windows
- Git worktree edge cases (reasoned from general git behaviour, not exercised on Pi)

---
*Pitfalls research for: personal Pi-based coding-agent harness optimising cheap models with selective strong-model escalation*
*Researched: 2026-08-13*
*Pinned to Pi 0.84.1 / pi-ai 0.84.1 / pi-subagents 0.47.1 — re-verify source claims at the version you pin*
