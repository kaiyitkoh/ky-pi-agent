---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 05-06-PLAN.md
last_updated: "2026-08-14T06:19:24.475Z"
last_activity: 2026-08-14
progress:
  total_phases: 11
  completed_phases: 4
  total_plans: 56
  completed_plans: 50
  percent: 36
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-13)

**Core value:** A harness that makes a cheap model produce work you'd trust from an expensive one — without the harness itself becoming the bottleneck.
**Current focus:** Phase 05 — routing-capability-guards

## Current Position

Phase: 05 (routing-capability-guards) — EXECUTING
Plan: 7 of 12
Status: Ready to execute
Last activity: 2026-08-14

Progress: [█████████░] 89%

**Read that 100% carefully — it is the most misleading number in this file.**
The denominator is *plans written so far* — Phase 1's 10, Phase 2's 11 and
Phase 3's 11. Phases 4-11 are not yet planned, so it will grow and the
percentage will fall. The honest phase-level figure is **3 of 11 phases with
their plans executed**, and Phase 3 additionally carries **five OUTSTANDING
live checks** (`RB-03-01..05`) and **five partial requirements**, so "complete"
means "everything a machine without credentials can do has been done".

## Performance Metrics

**Velocity:**

- Total plans completed: 44
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 10 | - | - |
| 02 | 11 | - | - |
| 03 | 11 | - | - |
| 04 | 12 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 15m | 3 tasks | 10 files |
| Phase 01 P02 | 20m | 2 tasks | 6 files |
| Phase 01 P03 | 18m | 3 tasks | 3 files |
| Phase 01 P04 | 18m | 2 tasks | 2 files |
| Phase 01 P05 | 35m | 2 tasks | 3 files |
| Phase 01 P07 | 18m | 2 tasks | 2 files |
| Phase 01 P06 | 30m | 2 tasks | 4 files |
| Phase 01 P08 | 22m | 2 tasks | 3 files |
| Phase 01 P09 | 20m | 2 tasks | 2 files |
| Phase 01 P10 | 25m | 3 tasks | 3 files |
| Phase 02 P01 | 20m | 3 tasks | 4 files |
| Phase 02 P02 | 12m | 3 tasks | 3 files |
| Phase 02 P03 | 35m | 3 tasks | 7 files |
| Phase 02 P04 | 20m | 2 tasks | 3 files |
| Phase 2 P5 | 40m | 3 tasks | 5 files |
| Phase 02 P06 | 35m | 2 tasks | 3 files |
| Phase 02 P07 | ~45m | 3 tasks | 4 files |
| Phase 02 P08 | 40m | 2 tasks | 5 files |
| Phase 02 P09 | ~40m | 2 tasks | 4 files |
| Phase 02 P10 | 55m | 3 tasks | 6 files |
| Phase 02 P11 | 25m | 3 tasks | 3 files |
| Phase 03 P01 | 35m | 3 tasks | 3 files |
| Phase 03 P02 | 25m | 3 tasks | 5 files |
| Phase 3 P3 | 25m | 2 tasks | 2 files |
| Phase 03 P04 | ~20m | 2 tasks | 2 files |
| Phase 03 P05 | ~20m | 2 tasks | 2 files |
| Phase 03 P06 | ~30m | 2 tasks | 2 files |
| Phase 03 P07 | ~35m | 2 tasks | 1 files |
| Phase 03 P08 | ~50m | 3 tasks | 4 files |
| Phase 03 P09 | ~40m | 2 tasks | 1 files |
| Phase 03 P10 | ~45m | 3 tasks | 4 files |
| Phase 3 P11 | 55m | 3 tasks | 4 files |
| Phase 04 P01 | 15min | 3 tasks | 5 files |
| Phase 04 P02 | 13min | 2 tasks | 7 files |
| Phase 04 P03 | 20min | 2 tasks | 3 files |
| Phase 04 P04 | 25min | 2 tasks | 2 files |
| Phase 04 P05 | 25min | 2 tasks | 3 files |
| Phase 04 P06 | 25min | 2 tasks | 2 files |
| Phase 04 P07 | 45min | 2 tasks | 4 files |
| Phase 04 P08 | 50min | 2 tasks | 4 files |
| Phase 04 P09 | 44min | 2 tasks | 3 files |
| Phase 04 P11 | 65min | 2 tasks | 5 files |
| Phase 04 P10 | 35min | 2 tasks | 2 files |
| Phase 04 P12 | 25m | 3 tasks | 5 files |
| Phase 05 P01 | 35m | 2 tasks | 2 files |
| Phase 05 P02 | ~20min | 2 tasks | 2 files |
| Phase 05 P03 | ~30m | 3 tasks | 4 files |
| Phase 05 P04 | ~15min | 2 tasks | 2 files |
| Phase 05 P05 | ~25min | 2 tasks | 2 files |
| Phase 05 P06 | 35m | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Horizontal layers in dependency order — `callModel()` is a Phase 2 export that Phases 5 and 8 import; routing cannot be verified without the instrument that proves which model ran.
- [Roadmap]: `ignore-scripts=true` precedes the first `pi install` (Phase 1). A pinning policy applied afterwards is applied to code that already ran.
- [Roadmap]: The prose-tool-call detector lives in Diagnostics (Phase 2), not Quality Gates — it is the leading root-cause candidate and it interacts with evidence-gating to fabricate evidence.
- [Roadmap]: Safety (Phase 4) depends on Phase 1 only, not on routing. GitLab server-side protected branches ship before any hook is trusted.
- [Roadmap]: A skeletal `/quick` is pulled forward to Phase 6 as a walking skeleton, exercising route → guard → execute → evidence → commit before any ceremonial workflow is built on it.
- [Phase 01]: .pi/npm ignored in contents form (.pi/npm/*) so !/.pi/npm/.npmrc can re-include the control file — git cannot re-include a file under an excluded directory
- [Phase 01]: peerDependencies stay at range * per docs/packages.md:171 — peers are jiti-aliased to Pi's bundled copies; the exact pin lives in devDependencies + package-lock.json
- [Phase 01]: git check-ignore needs --no-index, not just -q — the index masks ignore rules for tracked paths, which would have made the entire MUST_BE_COMMITTABLE half of the BOOT-09 test a vacuous pass
- [Phase 01]: test helpers throw rather than skip when a prerequisite binary is missing — a skipped load-path test is a green CI run that verified nothing
- [Phase 01]: on Windows a PATH stub cannot simulate gh SUCCESS inside Pi (Pi spawns gh with shell:false; Node returns EINVAL on .cmd since CVE-2024-27980) — write SAFE-16 as the not-authenticated assertion
- [Phase 01]: a negative control must be paired with a positive on the same fixture — case 4's no--a absence is only meaningful because adding -a and nothing else flips it back to present on the same fresh PI_CODING_AGENT_DIR
- [Phase 01]: PI_CODING_AGENT_DIR relocates trust.json (dist/config.js:397,412-418) — every load-path test uses a fresh one so verdicts come from the gate, not from this machine's saved decisions
- [Phase 01]: the sentinel extension registers a command and a dead-endpoint provider and never a tool — BOOT-10's boundary rule dogfooded on the first commit of real code
- [Phase 01]: npx and npm run export the resolved config as npm_config_* and npm ranks env above every .npmrc — supply-chain probes must strip npm_config_* or they measure the launcher, not the control
- [Phase 01]: user-scope npm hardening is asserted as a MECHANISM against a throwaway agent dir; the live machine-state check belongs to bin/bootstrap.sh --assert-hardening which has now been run for real on this machine (~/.pi/agent/npm/.npmrc exists, --assert-hardening exits 0)
- [Phase 01]: isPinnedPackageSpec is exported from tests/unit/pinning.test.ts for Phase 7 to import — no production module exists yet and a second regex is how the two drift apart
- [Phase 01]: bootstrap splits --check-only (CI, exits 0 on a clean runner) from --assert-hardening (the ordering proof, exits 1 there) — one flag cannot be both
- [Phase 01]: bootstrap strips npm_config_* before every npm query — run under npm/npx it would otherwise certify a control it never exercised, the same trap Plan 04 hit
- [Phase 01]: E404-token discrimination replaces RESEARCH's leading-quote-zero heuristic, which would misclassify any 1.x pin as unpublished
- [Phase 01]: the full bootstrap was run for real on this machine — ~/.pi/agent/npm/.npmrc now exists, so BOOT-01 user-scope is live-verified, not just mechanism-verified
- [Phase 01]: /share cannot be blocked by any extension — it is a literal-string match in the interactive submit handler (interactive-mode.ts:2902), dispatched before extension commands and before the input event; gh auth status exiting non-zero is the entire control
- [Phase 01]: dropping only the gist scope is a closed door — repo, read:org and gist are gh's documented non-removable minimum set, so gh auth logout is the only remedy
- [Phase 01]: SAFE-16's script ships --warn-only because gh is legitimately authenticated on the dev machine for git-over-HTTPS; CI and the dev box use it, the work-laptop runbook runs the script bare
- [Phase 01]: every stubbed-binary test case asserts the stub's own call log — without it a PATH-ordering mistake silently turns the suite into an assertion about the developer's real keyring
- [Phase 01]: sanitise_npm_env must match npm_config_ case-INSENSITIVELY — a Node test runner upper-cases the keys and Windows env names are case-insensitive, so the lower-case-only strip made --assert-hardening report true for an empty directory
- [Phase 01]: execution order is proven by a recorded argv log, never by reading the script — and every ordering comparison is preceded by non-emptiness assertions, since Math.max of an empty array is -Infinity and Math.min is Infinity
- [Phase 01]: the stub npm answers argv-conditionally (StubSpec.match) rather than answering true to all four questions — a stub that answers true to 'npm view ... version' would let a version-gate regression pass unseen
- [Phase 01]: CI action SHAs are resolved live with gh api repos/<o>/<r>/commits/<tag> --jq .sha, never transcribed — actions/checkout@3d3c42e (v7.0.1), actions/setup-node@8207627 (**v7.0.0**). Corrected 2026-08-13 by code review CR-03: the setup-node comment shipped as v5.0.0 and the "resolved live" claim was false for it — v5.0.0 is a0853c24, and 8207627 is tagged v7.0.0/v7. A tag comment that no test checks is a claim, not a pin, so ci-pinning.test.ts now holds an explicit (SHA, tag) table and posix-lint re-resolves every comment through the API
- [Phase 01]: posix-lint is a separate ubuntu-latest job, not a matrix step — shellcheck is preinstalled only there, and sh execution cannot prove POSIX conformance since Git-Bash sh and macOS /bin/sh are both bash in POSIX mode
- [Phase 01]: no line-ending fix-up step in CI — .gitattributes eol=lf is the fix and the node CR-byte scan is the proof; a git config step would mask a broken .gitattributes
- [Phase 01]: the CI lint reads ci.yml as TEXT — yaml exists only transitively under Pi, and declaring it would break pinning.test.ts's exactly-six-devDependencies assertion
- [Phase 01]: the three BOOT-10 source facts were re-verified in Pi 0.84.1's recovered TypeScript, not inherited — convertTools at openai-completions.ts:1337-1372 is called at :731, system-prompt.ts's only 'command' hit is preamble prose at :121, and skills.ts:350-356 emits name/description/location only
- [Phase 01]: the registerTool scan is a plain substring per 01-VALIDATION's BOOT-10 wording — it survives bracket access and aliasing, at the cost that extensions may not name the call even in a comment
- [Phase 01]: TOOL_REGISTRATION_ALLOWLIST is empty and named so a later phase extends it with an (a)/(b)/(c) justification instead of deleting the test
- [Phase 01]: the npm_config_ignore_scripts persistence hazard cites bash.ts:105 + shell.ts:122-134 (the bash tool spreads process.env) — package-manager's getEnv() is private and covers only Pi's own npm spawns
- [Phase 01]: a runbook status is parsed from BOTH the summary table and the detail subsection and the two must agree — a half-flip returns INCONSISTENT, because updating the skim-able table and forgetting the subsection is the likeliest real failure and would otherwise leave two contradictory answers with no signal
- [Phase 01]: the outstanding-status parser is asserted against a PASSED fixture as well as an OUTSTANDING one — without the PASSED case, asserting OUTSTANDING on the real file is a tautology that passes whatever the file says
- [Phase 01]: docs/RUNBOOK.md is created in Phase 1 though PROV-09 (Phase 3) owns it — the ownership is stated inline so Phase 3 appends rather than rewrites, and the three Phase 1 checks are not lost in between
- [Phase 01]: the README's 'not covered' clause is asserted case-sensitively — Task 1's own case-insensitive regex passed against the capitalised heading while the prose instance was split across a line break, i.e. present in spirit and absent as a string
- [Phase 02]: fauxProvider never calls onPayload (pi-ai faux.ts:510) so before_provider_request never fires under a plain faux session — tests/helpers/faux.ts wraps the provider to emit it at the adapter position, and every capture test must assert captured.length > 0 before asserting content
- [Phase 02]: the extension under test loads at USER scope (<agentDir>/extensions/<name>/index.ts) — project-scoped .pi/extensions is gated behind project trust, which resolves false headless with no UI to answer it
- [Phase 02]: the faux session cwd is always a temp dir outside this repo — from inside it Pi walks up and loads the 49 KB CLAUDE.md into every faux request (12,725 input tokens for a one-word prompt), so any token measurement would be measuring the harness
- [Phase 02]: two JSONL readers, not one — readTornSafe reports a torn line as data because DIAG-08 is a measurement, and readJsonl throws so a writer bug in a test-authored file stays loud; the difference is asserted on the same fixture
- [Phase 02]: an extension entry point is a file with a default export at statement position — the BOOT-05 layout gate now partitions .pi/extensions/ into entry points (must sit at an auto-discovered path) and imported modules (must sit under <dir>/), closing PATTERNS blocker B1 without widening the regex
- [Phase 02]: the wire payload never carries the API key (RESEARCH §1.3, 12 verified onPayload call sites) — so the redactor matches secret-SHAPED values as well as credential-named header keys; the real hazard is a .env or *.tfstate the model read into messages[]
- [Phase 02]: a word boundary is added to the sk- and pt- patterns only, against RESEARCH's literal list — risk-assessment-documents is sk- plus 24 token characters, and a redactor that mangles ordinary paths fails DIAG-07's negative control as surely as one that leaks
- [Phase 02]: DIAG-07 stays Pending after plan 02-02 — the requirement names redaction at capture AND gitignored paths, and this plan ships only the redactor; nothing calls it until wire.ts (02-05)
- [Phase 02]: createWriteStream is deliberately not spelled in jsonl.ts — the plan's own acceptance grep and its docstring instruction were mutually exclusive, and blocker B3's lesson (a substring gate matches prose) says keep the gate live and state the rule in words
- [Phase 02]: the four concurrency children are spawned asynchronously with a wall-clock barrier, never spawnSync — spawnSync blocks, so four calls in a loop are strictly serial and still produce 1600 clean lines while proving nothing; the latest-start-precedes-earliest-finish assertion is what makes a serialised run fail
- [Phase 02]: path confinement in jsonl.ts is two layers (a character allowlist on base, plus a resolved-path containment assertion) and the falsification run proved each catches inputs the other does not — '..' slips past containment, 'wire/../../evil' slips past a loosened allowlist
- [Phase 02]: DIAG-08 is complete and DIAG-07 stays Pending — DIAG-07 names redaction AT CAPTURE as well as gitignored paths, and nothing calls the redactor on a payload until wire.ts (02-05)
- [Phase 02]: DIAG-05 stays Pending after plan 02-04 — this plan ships the classifier only; the capped retry effect, the prose_tool_call row and the exhausted row are 02-09, and the live half is RB-02-03 (OUTSTANDING)
- [Phase 02]: AssistantMessage is re-exported type-only from schema.ts rather than imported from pi-ai a second time — it keeps the diagnostics subsystem's single-pi-ai-import-site rule true while prose.ts stays at zero value imports, and re-declaring the shape locally would trade a compile error for a silent miss the day Pi renames a content-block type
- [Phase 02]: a ninth negative case (unread({...})) was added to the prose table after a falsification run proved the pattern's leading word boundary was undetectable by the plan's eight — removing \b left all 21 tests green, and a guard no test can break is a guard that is not there
- [Phase 2]: 02-07: the diagnostics correlation counter lives on globalThis — Two jiti module instances of wire.ts in one process both start at 1 and both stamp <sessionId>#1 into the same wire log, silently mis-joining nested wire records onto a different call's turns row. Observed, then falsified: six records shared one id.
- [Phase 2]: 02-07: session_start does not fire in a headless createAgentSession — Measured with a five-event probe: nothing fires before the first prompt; then before_agent_start, turn_start, before_provider_headers, agent_end. Pi emits it from AgentSession's extension-binding step (agent-session.ts:1761), which the headless factory does not reach. Any in-session test needing ctx must prompt first.
- [Phase 2]: 02-07: spread order, not the type system, stops a caller suppressing callModel's capture — Api is KnownApi | (string & {}), so the option-bag union always carries pi-ai's Record<string, unknown> fallback arm and accepts onPayload for a Model<Api>. Verified by compiling it. opts.api is spread first and the captures overwrite it; asserted at runtime by tests/integration/call-model.test.ts case 2c.
- [Phase 2]: 02-08: DIAG-04 complete — the turn row spine is turn_start + message_end + turn_end, never after_provider_response — that hook never fires on a provider error
- [Phase 2]: 02-08: the correlation id is captured at message_end, not turn_end: a nested callModel during tool execution issues its own id and would otherwise be stamped onto the turn row
- [Phase 2]: 02-08: a degraded computation is MARKED (event: diagnostics.model_unavailable), so a zero cost is never indistinguishable from a computed one
- [Phase 2]: 02-09: prose retry is follow-up injection, not tool-call promotion — promotion executes a tool with regex-scraped arguments before Phase 4's guard exists
- [Phase 2]: 02-09: DIAG-05 stays Pending — the [FAUX] half is complete end to end, RB-02-03 (live DeepSeek prose rate) is OUTSTANDING
- [Phase 2]: 02-09: PROSE_RETRY_FORCES_TOOL_CHOICE is false and registers NO handler — the tool_choice lever's effect is UNVERIFIED and belongs to Phase 10
- [Phase 2]: 02-09: two negative controls can cover for each other — one live fixture per detector gate, each individually falsified
- [Phase 2]: 02-10: DIAG-06 COMPLETE — [FAUX]-only and every input is exercised offline; no runbook entry is needed, unlike DIAG-01 and DIAG-05
- [Phase 2]: 02-10: base is the prompt with the located regions REMOVED, never total-minus-sections — a subtracted base makes base+ctx+skills===total an identity that holds however wrong the arithmetic is (falsification A2 passes on duplicated regions; A fails at 916 vs 714)
- [Phase 2]: 02-10: a marker warning fires only when the section was EXPECTED — the plan's literal wording would warn on every session with no skills, contradicting its own integration case 2
- [Phase 2]: 02-10: a negative assertion needs a marker that COULD be found — falsification I2 aliased the skills marker to 'Guidelines:', text the real prompt genuinely contains, to prove skillsFound===false reads the prompt rather than agreeing with itself
- [Phase 2]: 02-11: the runbook status guard is generalised to RB-<phase>-<n>, not extended phase by phase — appending RB-02 entries to a guard hardcoded at /RB-01-\d{2}/g would have landed three unguarded statuses through a file nobody touched, which is the exact silent failure the policy exists to prevent
- [Phase 2]: 02-11: the widened id pattern is held to a SHAPE by a malformed-id fixture — falsified both ways (narrowed back to RB-01 => 5 failures; widened to RB-[\d-]+ => the malformed case fails), because a pattern loose enough to parse an id in no phase array reads a status that nothing then asserts
- [Phase 2]: 02-11: RB-02-02 targets the DeepSeek/DashScope bearer path and never Bedrock — SigV4 is applied by Smithy middleware downstream of Pi and reserved headers are silently ignored (pi-ai types.ts:148-153), so a Bedrock-aimed credential-leak check would report a clean pass while exercising nothing
- [Phase 2]: 02-11: docs/DIAGNOSTICS.md declares the CODE authoritative and itself a bug on disagreement, and its TurnRow field list was checked against schema.ts by script with the checker falsified — a schema document nobody can verify is a second source of truth
- [Phase 2]: 02-11: DIAG-01 and DIAG-05 stay Pending at phase end — six of eight DIAG requirements are complete, and the two [RUNBOOK] halves (RB-02-01, RB-02-03) are OUTSTANDING because this machine has no live credentials
- [Phase 03]: 03-01: wrapFauxWithStatus SUBSTITUTES onResponse in a copy of the options bag, never pre-calls it -- a pre-call leaves faux's hard-coded 200 firing afterwards, so the caller sees [503, 200], the wire log gets two main.response records under one correlation id and /budget counts a row that never happened. Falsified: the pre-call form turns two cases red.
- [Phase 03]: 03-01: withModelsConfig COPIES the models config into its own temp agent dir even when handed a template path -- Pi defaults the models store to dirname(modelsPath)/models-store.json, so a modelsPath aimed at .pi/templates/ would aim a writer at this repository
- [Phase 03]: 03-01: $ENV_VAR config values resolve LAZILY at getProviderAuth() time, not at composition time -- falsified by moving applyEnv below ModelRuntime.create and watching the test stay green; the assertion message was rewritten to claim only what it proves
- [Phase 03]: 03-01: Pi's process-lifetime !command cache cannot be cleared from a test -- clearApiKeyCache is re-exported from core/model-registry.ts but not from the package root, so PROV-02's cached-vs-uncached proof must do both resolutions inside ONE withModelsConfig callback
- [Phase 03]: 03-02: trackedFiles() membership, not isIgnored(), is the load-bearing half of the Trap T1 guard -- git mv FORCES an ignored path into the index, so renaming auth-template.json to auth.example.json left the ignore half green and only the tracked-name case turned red
- [Phase 03]: 03-02: both config templates are validated by RUNNING Pi's own loaders (stripJsonComments+JSON.parse; ReadOnlyAuthStorage.load/read) over the real files, never by a local regex strip or by reading the validator -- the auth run also proved the DASHSCOPE_API_KEY env reference interpolates and env.AWS_PROFILE survives raw
- [Phase 03]: 03-02: where the plan's task prose conflicted with its own acceptance greps (a baseUrl comment naming the workspace-dedicated host, a header naming the out-of-scope vendor), the greps won and the prose was rephrased -- a comment is text like any other and a gate that greps to zero means zero
- [Phase 3]: 03-03: the 127.0.0.1 literal is duplicated between the loopback listen call and the refusal on purpose — a shared constant lets one edit move the bind and its guard together
- [Phase 03]: 03-04: the templated model set is a set difference against a registry composed over an empty providers object, so no literal id list can go stale
- [Phase 03]: 03-04: PROV-06's general cross-provider loop is scoped to templated models — a blanket form is false by design in Pi's own catalogue (Bedrock and Anthropic share Claude ids at 200,000)
- [Phase 03]: 03-05: PROV-04 and PROV-07 stay incomplete — both carry an OUTSTANDING live half (RB-03-03 / RB-03-04) and Trap T12 forbids marking a [RUNBOOK] requirement passing on a green offline half
- [Phase 03]: 03-05: Bedrock credential tests blank all seven variables in resolve()'s chain, not just AWS_PROFILE — Pi's auth context treats an empty value as absent, so blanking asserts machine state without reading it
- [Phase 03]: 03-07: PROV-02 is a CALL-SITE rule, not a filename rule -- proven by subprocess count: the same !command logs ONE invocation for two resolutions from auth.json (auth-storage.ts:442-448 -> the memoised resolver) and TWO from models.json apiKey (resolveConfigValueOrThrow -> the uncached one). Falsified by moving the credential between the two files and watching 2 become 1.
- [Phase 03]: 03-07: the PROV-02 counter is a generated counter.mjs, not a stub-bin PATH stub -- withStubBin is synchronous by contract and deletes its directory the moment the callback returns (stub-bin.ts:205-211), and every resolution here is awaited. Pi runs the command through Git Bash -c, so the .cmd-launcher Windows caveat never arises and neither direction needed narrowing.
- [Phase 03]: 03-07: the inline-fixture guard scans for a distinctive MARKER string, not for registerProvider( -- harness/index.ts:79 legitimately registers a provider, and the first draft failed on correct code
- [Phase 03]: the SSO classifier is a message_end handler that REPLACES the finalized message — after_provider_response never fires on a provider error (Trap T2), and message_end runs before the retry gate reads the mutated object
- [Phase 03]: the original SDK text is carried on the message's diagnostics[] and kept OUT of errorMessage — isRetryableAssistantError reads errorMessage and nothing else, so an `(original: ...)` suffix silently restores 3 retries at 2s/4s/8s against a dead credential (Trap T4)
- [Phase 03]: a callCount === 1 assertion is only a measurement when paired with a retryable control in the SAME harness — all six SSO strings are ALREADY non-retryable under Pi 0.84.1, so the 1 would hold with the extension uninstalled
- [Phase 03]: 03-09: an absence assertion on a wire body needs a CONTROL BODY, not just a paired presence -- the shipped block's missing store/developer/strict/prompt_cache_* is only evidence because the same request with those five compat fields deleted emits every one of them. Falsified twelve ways; F9 (requestCount forced to 0) turned seven cases red on the vacuity guard.
- [Phase 03]: 03-09: cacheRetention:long + sessionId are set on EVERY capture -- prompt_cache_* is gated on the caller asking for long retention (openai-completions.ts:699-704), so a test that never asks would show the fields absent whatever the compat block said
- [Phase 03]: 03-09: PROV-03 and PROV-10 stay incomplete -- this is the strongest offline evidence either will get (Pi's real adapter, real bytes) and it still proves only what Pi EMITS; RB-03-01 and RB-03-02 are what DashScope ACCEPTS and both stay OUTSTANDING
- [Phase 03]: 03-09: Q7 recorded as a two-directional assertion -- Pi already sends strict:false on every function wherever supportsStrictMode is left to detection, so turning strict ON is a tool-authoring change (constrainedSampling) and not a compat switch; Phase 8/10 starts from an executed fact
- [Phase 03]: 03-10: the quota table is consulted BEFORE Pi's retry predicate -- Pi calls every quota string non-retryable and is right to, but 'do not retry' and 'do not try somebody else' are different decisions and Pi only makes the first; checking Pi first collapses quota into fatal and the chain never advances on the one failure a second vendor is most certain to survive. Falsified: F3 and F10 each turn four cases red.
- [Phase 03]: 03-10: the A7 "every chain entry resolves" case runs against a registry composed from the SHIPPED template, never against the faux session -- falsification F7 renamed CHAIN's second model id and ONLY the composed-registry case went red, because the fixture registers its faux providers under CHAIN's own ids and therefore renames itself along with them
- [Phase 03]: 03-10: every hop asserts the resolved model carries THIS run's faux api id -- F11 (registration omitted) resolved Pi's REAL built-in deepseek entry instead ("expected openai-completions to be faux:..."), so without the identity guard a failed registration silently measures the wrong provider
- [Phase 03]: 03-10: a rejection and a returned failure are classified by ONE rule over the provider-controlled TEXT -- a message-shaped signature would need a second rule for facade rejections, which is how the same outage advances down one path and stops down the other; Pi's predicate is fed a two-field probe because stopReason and errorMessage are exactly what it reads (pi-ai dist/utils/retry.js:165-172)
- [Phase 03]: 03-10: a mutation that fails to COMPILE proves nothing and looks identical to one that passed -- Git Bash rewrote a leading-slash regex argument into C:/Program Files/Git/... and two falsification runs reported "no tests" rather than a failure; both were re-run with the slash removed
- [Phase 03]: 03-11: the runbook status guard could be DISARMED, not only forgotten -- both loops iterate ALL_IDS, so deleting ...PHASE_THREE_IDS left five live checks unasserted and dropped the suite from 78 to 63 tests with NOTHING red. A Rule 2 case now reads the declared ids OUT OF docs/RUNBOOK.md and asserts every one is governed (falsification F7)
- [Phase 03]: 03-11: all five RB-03 statuses are OUTSTANDING and machine-enforced in BOTH the summary table and the Status line -- a half-flip reports INCONSISTENT (F1), a full flip reports PASSED (F2), and both fail the suite. Nine falsifications; every one turned a green suite red with a targeted message
- [Phase 03]: 03-11: Phase 3 pins WHOLE one-line commands in ENTRY_COMMANDS and each pin was verified to occur EXACTLY ONCE in the runbook -- RB-02-03's fragment lesson plus its converse, since a pin that also matches a neighbouring entry's command stays green when the entry that owns it drops it
- [Phase 03]: 03-11: five PROV requirements complete (01, 02, 05, 08, 09) and five PARTIAL with their RB-03 id named inline (03/RB-03-01, 04/RB-03-03, 06/RB-03-05, 07/RB-03-04, 10/RB-03-02) -- the status table says 'Partial ... Not complete' rather than Phase 1's 'Complete offline', because the file's own legend defines [~] as partial and it is the only shape a skimmer cannot misread as done
- [Phase 03]: 03-11: a falsification restore via git checkout -- silently DELETED uncommitted Task 2 edits, and two mutations then reported a green 58-test run against the pre-edit file. Commit the change before falsifying it; a mutation run against an unmutated original is indistinguishable from a passing one
- [Phase 04-01]: unbash Word.value/Word.parts are self-memoizing getters, not own enumerable properties -- a plain Object.keys() tree walk silently never descends into a command substitution or expansion hidden inside a Word; walkableKeys() adds them via an 'in' check
- [Phase 04-01]: the user-scope re-export stub loads in a real spawned pi process on Windows on the first execution -- no file:// URL or directory-copy fallback needed; this is the mechanism Plan 09's bootstrap wires
- [Phase 04-01]: ParsedScript.errors is undefined on a clean unbash parse, not [] -- every downstream policy check must read (script.errors ?? []).length
- [Phase 04-02]: safety/audit.ts does not import diagnostics/index.ts's safeHandler -- CONTEXT.md decision 7's isolation reading wins over the providers/index.ts precedent
- [Phase 04-02]: writeAuditRow never throws -- catches and returns undefined on failure so an audit write failure cannot turn a BLOCK into an unhandled exception
- [Phase 04-02]: shared JSONL writer moved to .pi/lib/jsonl.ts (outside .pi/extensions/, never auto-discovered) so diagnostics and safety can both bind to the hardened Phase 2 writer without importing each other
- [Phase 04]: unresolved-expansion-in-command-position checks Command.name always AND a guarded verb's suffix[] args, not argv[0] alone -- the plan's g=push; git $g example places the expansion in the subcommand position
- [Phase 04]: shell-runner + guarded-verb combos (sh -c "git push") are denied outright, never routed to approval, per SAFE-03's fail-closed contract
- [Phase 04]: UNC leading backslash pair preserved as a distinct root marker in canonicalisePathArg (not collapsed to // as bootstrap.sh's tr does), per the plan's explicit wording, so a UNC canonical form stays structurally distinct from a drive-letter form
- [Phase 04]: classifyPathRead/classifyPathWrite take an already-canonical path string, not a raw PathWordArg -- callers run canonicalisePathArg first; no allowed-outside-root is defined for writes, defaulting to block per the plan's stated default
- [Phase 04]: worktree add is unconditionally allowed with or without -b/-B -- neither form mutates the named ref, only reads it to populate a second working directory
- [Phase 04]: classifyGitInvocation resolves protection AND write-classification as two independent steps (HEAD==protected via currentBranch, then a per-subcommand predicate table), denying only when both hold -- rebase and apply carry complementary write/read predicates over their own argv rather than a static write/read label
- [Phase 04]: currentBranch returns the distinct DETACHED_HEAD sentinel on any non-zero git symbolic-ref exit, never undefined -- a caller's === comparison against a protected-branch name would otherwise silently fail open on a detached checkout
- [Phase 04-06]: SAFE-07: AWS sensitive-read checked before safe-operation, falsified by reversing the checks and watching tests go red before restoring
- [Phase 04-06]: SAFE-07: unknown terraform subcommands and unknown kubectl verbs default to confirm, not allow or a hard block -- distinct from git.ts's protected-HEAD posture
- [Phase 04]: policy.ts's bash argument scan applies classifyPathRead only (never classifyPathWrite) to avoid blocking ordinary absolute-path arguments — classifyPathWrite's project-root containment would false-positive on most bash args outside the repo; SAFE-13 detonation targets are exercised directly via the write/edit tool surface instead
- [Phase 04]: approvals.ts grants are keyed on requestKey (a content fingerprint), never on the caller-chosen request id — the id identifies one approval conversation; only a fingerprint of the actual command/tool/cwd is safe to trust as the thing being authorised, preventing a laundered-command approval (T-04-09)
- [Phase 04]: safety/index.ts: wrapped-tool delegate calls omit ctx (4 args, not 5) -- matches AgentTool.execute's real declared type at pi-agent-core/dist/types.d.ts:348
- [Phase 04]: safety/index.ts: classifyAtWrapper() (never throws) and wrapperOutcome() (writes exactly one audit row, then returns or throws) are split to avoid a double-audit-row bug found and fixed before the first commit
- [Phase 04]: approve_ky_command's schema cost was MEASURED (1099 bytes -> 275 tokens via diagnostics/budget.ts's chars/4 estimator), not estimated, per CONTRIBUTING.md boundary rule (b)
- [Phase 04]: headless-deny.test.ts scripts the spawned pi process's model turn via an in-process fauxProvider driver extension, not a cross-process loopback HTTP server — the loopback composition RESEARCH.md suggested hung deterministically (5/5) when spawned from inside vitest while succeeding outside it; fauxProvider registered inside the spawned process itself has no network dependency and was reliable across 7 consecutive runs
- [Phase 04]: EV-08 (eval "git push") was a genuine shell.ts defect, fixed by adding "eval" to SHELL_RUNNERS with a regression row in the pre-existing shell-parse test suite — eval executes its argument as shell code in the current shell, the same hides-a-guarded-verb shape sh -c already catches; found while assigning corpus buckets by execution
- [Phase 04]: EV-09 (variable-indirection through eval) remains a published OUT-OF-SCOPE limit even after the EV-08 fix — the guarded-verb text lives in a separate command node's assignment, never in eval's own raw segment, so no substring check can see it without resolving arbitrary shell-variable content, which 04-RESEARCH.md rules out of scope
- [Phase 04]: docs/SAFETY.md's published limits table is derived from tests/fixtures/evasion-corpus.ts, never hand-typed, with the converse asserted so the doc cannot grow a limit the corpus does not know about — following docs-policy.test.ts's truncationCauseCount() discipline, so SAFE-17 (the corpus) and SAFE-15 (the published table) stay one artifact instead of two that drift apart
- [Phase 04-10]: subagent-block.test.ts scripts blocked-then-benign commands into ONE spawned pi child via a two-turn faux driver, keeping the phase's most expensive test to a single process launch while proving both BLOCK and allow-as-evidence in the same run
- [Phase 04-10]: audit-concurrency.test.ts hand-constructs AuditRow-shaped JSON in generated child scripts rather than importing the TS writer into a spawned process, mirroring jsonl-concurrency.test.ts's DIAG-08 pattern of testing the writer's documented contract against real OS concurrency
- [Phase 04-10]: project-scoped sentinel evidence is an import-time file write, not a registered command -- proves jiti never imported the module, the strongest available proof of SAFE-11's mechanism from outside Pi's own source
- [Phase 04-12]: SAFE-01 stays [~] partial, never [x] -- the offline proxy proves the harness reads and classifies a server-side rejection correctly, not that GitLab is configured; RB-04-01 is OUTSTANDING
- [Phase 04-12]: The non-fast-forward negative control for classifyPushFailure() is a genuinely diverged real git rejection, not a fabricated string, so the classifier's negative direction is measured against real git output
- [Phase 04-12]: RB-04-01 names the work repo as <work-repo> rather than a real URL, following the RB-03-01/RB-03-03 precedent for account-identifying information in a public repo
- [Phase 04-12]: Phase 4 is complete -- all seventeen SAFE requirements accounted for: sixteen [x] (SAFE-02..15, SAFE-17), SAFE-01 [~] partial with RB-04-01 OUTSTANDING, SAFE-16 untouched (Phase 1's). Full suite (1083 tests, 64 files) and tsc --noEmit green
- [Phase 05]: 05-01: withModelsConfig's composed registry resolves Pi's built-in Bedrock and DeepSeek-direct catalogue entries through the same registry.find() call as the DashScope template entries -- verified live (1220 total models, Bedrock Claude resolved with input:[text,image]) -- so no second hand-rolled catalogue reader was built for the vision role
- [Phase 05]: 05-01: reasoningEffort is a per-role constant (reviewer/advisor: high; others: none), identical across cheap/balanced/max in every case, and KyModeData carries only mode name + escalation bookkeeping since Pi's native model_change session entry already persists the executor model
- [Phase 05]: 05-02: ROUTE-08's deny-list is scoped by need.usesToolLoop (caller-supplied, from ROLE_MECHANISM), never by a role name -- R1 blocks only when the target role needs a tool loop, so a tool-less role like summariser is not over-blocked
- [Phase 05]: 05-02: isAnthropicClaudeModel is a local re-implementation of pi-ai's unexported bedrock-converse-stream.js predicate, with a residual-coupling comment matching providers/schema.ts's QUOTA_PATTERN precedent -- behaviour pinned by tests/unit/capability-guard.test.ts, not by Pi's internals
- [Phase 05]: 05-03: qoder/index.ts is the second TOOL_REGISTRATION_ALLOWLIST entry (after safety/index.ts) -- schema measured at 1315 bytes / 329 tokens via createRequire(package.json)+typebox, per CONTRIBUTING.md's (b) rule
- [Phase 05]: 05-03: qoder/client.ts refusal is a thrown Error (Pi converts to isError:true), not a returned isError field -- AgentToolResult carries no isError property on this Pi version
- [Phase 05]: 05-04: usesToolLoop(role) is derived inside planRoleCall and RoleNeed omits usesToolLoop entirely from the caller-facing type -- ROUTE-08's scope is a compile-time guarantee, not just a documented convention
- [Phase 05]: 05-04: pickConfiguredCandidate's refusal names each candidate as (did not resolve) or (no configured auth) distinctly, proven by a mixed-failure candidate list in the same test
- [Phase 05]: 05-04: the guard-precedence falsification had to mutate the success branch (build the ok:true value before the guard ran, discard its verdict), not merely reorder when mechanism is computed relative to the guard call -- the latter mutation changes nothing observable since the ok:false path never carries mechanism regardless of ordering
- [Phase 05]: 05-05: the write target is the GLOBAL getAgentDir()/settings.json, never the project-scoped git-tracked .pi/settings.json -- resolves 05-RESEARCH.md Assumption A1 per the standing policy
- [Phase 05]: 05-05: agentOverridesFor builds a structural Model<Api> fixture from a candidate's {provider,id} rather than a registry lookup -- sound because the only need field ever set is usesToolLoop:true, so only guardRoute's ROUTE-08 deny-list block can fire through this call path
- [Phase 05]: 05-05: agentOverridesFor gained an injectable AgentOverridesForOptions seam (production never passes it) so the guard-blocked fixture test could avoid mutating the shared ROLE_MAP module singleton other routing tests also import
- [Phase 05]: 05-06: qoder-loopback.ts is a purpose-built sibling to loopback.ts, not a reuse -- Qoder's id:/event:/data: envelope is a different shape from OpenAI-completions SSE
- [Phase 05]: 05-06: the split-frame proof forces a genuine two-read arrival via a 20ms delay between two res.write() calls on a real socket, not a synthetic string split
- [Phase 05]: 05-06: the session id threaded through steps 2/3 is read back from the client's own outgoing URL, never from the request body of step 1 -- the request body is what the client sent, not what the server's response contained

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

- **UNRESOLVED (R1)**: Whether DeepSeek-direct accepts `reasoning_effort: "low"`. Settled by one request in Phase 3 (PROV-07), gated behind Phase 2. Until then `/cheap` must not be defined in terms of a cheap thinking tier.
- **Root cause still open**: prose tool calls vs context pollution vs provider misconfiguration. Phase 2 measures, Phase 10 discriminates. Do not commit to a fix for an unmeasured cause.
- **No credentials on the dev machine**: 8 of 107 requirements are [RUNBOOK] and need the work laptop. `docs/RUNBOOK.md` (PROV-09, Phase 3) is the deliverable that carries them. **The file now exists and PROV-09 is discharged** — Phase 1 created it in Plan 10, Phase 2 and Phase 3 appended, and it now carries eleven entries. Phases 4, 5, 8 and 10 append their own sections and each must add its ids to one array in `tests/unit/docs-policy.test.ts`; since 03-11 a test fails if they do not.
- **Five Phase 3 checks are OUTSTANDING and machine-enforced as such**: `RB-03-01` (PROV-03, does DashScope accept the compat block on the wire), `RB-03-02` (PROV-10, the 200 on the **second** turn of a tool sequence), `RB-03-03` (PROV-04, Bedrock from a fresh shell — plus the one live check of the SSO classifier, whose six strings are all fixtures this repo wrote), `RB-03-04` (PROV-07, the R1 experiment, threshold pre-committed at `low.reasoning <= 0.6 * high.reasoning`), `RB-03-05` (PROV-06, the real DashScope cap and per-token price). Each has a green offline proxy and **not one of those proxies is the check**. PROV-03, PROV-04, PROV-06, PROV-07 and PROV-10 are `[~]` partial in REQUIREMENTS.md with their id named inline.
- **R1 is still open after Phase 3.** Two sub-findings are settled — the API documents `low`, and Pi 0.84.1 with the built-in catalogue clamps it to `high` so it can never be sent without a `modelOverrides` unclamp — and neither is the answer. The token count is `RB-03-04`. **`/cheap` must not be defined in terms of a cheap thinking tier** (Phase 5).
- **Three Phase 1 checks are OUTSTANDING and machine-enforced as such**: `RB-01-01` (SAFE-16, `gh auth logout` on the work laptop), `RB-01-02` (BOOT-02, `pi install` against the real URL on a clean profile), `RB-01-03` (BOOT-05, `/reload` in a TTY). Each is recorded in `docs/RUNBOOK.md` with its exact command, expected output and offline proxy. `tests/unit/docs-policy.test.ts` parses both the summary table and the detail subsection and fails if either is flipped to passed, or if the two disagree. Flipping one requires a human to have executed it and must be a deliberate edit in the same commit as the test change.
- **SAFE-16 is half-shipped, deliberately**: the classifier (`scripts/check-gh-unauthenticated.sh`) is proven in both directions, but the live control — `gh auth logout` on the work laptop — is **OUTSTANDING** and must never be reported as passed. `gh` stays authenticated on this dev box; it is how the repo is pushed over HTTPS. Runbook entry is `RB-01-01`.
- **BOOT-07's live CI run is OUTSTANDING**: `.github/workflows/ci.yml` exists, is valid YAML, and is statically proven (both action SHAs resolved against the GitHub API, matrix `[windows-latest, macos-latest]`, `fail-fast: false`, every execution step asserted by `tests/unit/ci-pinning.test.ts`). It has **never run** — GitHub Actions cannot be triggered from this machine. macOS behaviour, ShellCheck's verdict on the two tracked scripts, and whether the pinned global Pi install satisfies the load-path tests on a runner are all unverified until the first push. Do not report a green tick that does not exist. **It has no `docs/RUNBOOK.md` entry yet** — Plan 10 seeded only the three checks its plan named. A later phase should add it alongside `RB-01-01..03`.
- **`shellcheck` is not installed on this machine**: full `--shell=sh` conformance of `bin/bootstrap.sh` and `scripts/check-gh-unauthenticated.sh` is UNVERIFIED locally. Narrowed by code review WR-07: `/usr/bin/dash` IS present (Git for Windows ships it) and is a genuine POSIX shell rather than bash in POSIX mode, so `tests/unit/lf-and-shell.test.ts` now parses every tracked `*.sh` with `dash -n` in addition to the four-construct bashism regex. Both scripts pass. A parse is not a lint — unquoted expansions and BSD-vs-GNU flag differences still need the Ubuntu `posix-lint` job, which has never run.
- **Moving platform**: Pi ships every 2–3 days; the composed extension ecosystem ships 13–16 releases/month. Every pin must be re-verified at Phase 7 planning time, not inherited from research.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Standing Operating Policy — Autonomous Run

Set by the user on 2026-08-13 before an unattended overnight run. **In force until the v1.0 milestone completes.**

1. **Delegate to subagents.** Planning, execution, and review run in spawned agents, not inline. The orchestrator context must stay lean across an 11-phase run — it will not survive otherwise.
2. **Code review after every phase**, in a spawned agent, checking end-to-end that no bugs or regressions were introduced. Not advisory: findings get fixed before advancing.
3. **Do not ask the user anything until the milestone is done.** Two standing pre-authorisations:
   - Verification `human_needed` caused by `[RUNBOOK]` items → build it, write the runbook entry, mark the live check **outstanding** (never "passed"), continue.
   - Verification `gaps_found` → this means something was genuinely *not built*, which is not the same as not-yet-verified-live and is **not** covered by the above. Close the gap; do not silently advance.
4. **Follow Pi's own documentation and bundled examples** over third-party blog posts or extension READMEs. Verify against published TypeScript (recoverable from `dist/**/*.js.map` `sourcesContent`) and cite `file:line`. Mark anything unverifiable as UNVERIFIED rather than asserting it.
5. **`workflow.skip_discuss` is `true`** — each phase uses its ROADMAP goal and success criteria as the spec. Grey-area implementation choices are at Claude's discretion, guided by the ROADMAP criteria and `.planning/research/`.
6. **Always pass `--research` to `plan-phase`.** Without it, `plan-phase` prompts "Research before planning Phase N?" whenever `RESEARCH.md` is missing — which is every phase. The flag forces research and skips the prompt. `nyquist_validation` requires `RESEARCH.md` anyway, so research must run regardless.
7. **UI gates are disabled deliberately** (`ui_phase`, `ui_safety_gate`, `ui_review` all `false`). GSD's frontend detector is a case-insensitive substring match on `UI|interface|frontend|component|layout|page|screen|view|form|dashboard|widget`, and **all 11 phases trip it** — Phase 1 matches because "package" contains "page". With the safety gate on, `plan-phase` exits outright on a phase with no `UI-SPEC.md`. Phase 11 is a *terminal* UI, not the web frontend the UI-SPEC contract is designed for, so the gate has nothing correct to contribute here. Do not re-enable.
8. **Do not ruminate.** The decisions are already made and written down. Agents implement PROJECT.md, ROADMAP.md and the research documents — they do not re-derive or re-litigate them. If a choice is genuinely open, pick the option consistent with the recorded decisions, note it in one line, and move on.

Everything the user cares about is already captured in PROJECT.md (Key Decisions, Constraints), REQUIREMENTS.md (107 requirements with `[FAUX]`/`[RUNBOOK]` tags), and ROADMAP.md (per-phase success criteria and Carried-Forward Unknowns). Those are the contract — build to them.

## Session Continuity

Last session: 2026-08-14T06:19:24.464Z
Stopped at: Completed 05-06-PLAN.md
Resume file: None

Next: `/gsd:autonomous` — Phase 1 has CONTEXT.md already, so it resumes at plan-phase.
