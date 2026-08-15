# Requirements: ky-pi-agent

**Defined:** 2026-08-13
**Core Value:** A harness that makes a cheap model produce work you'd trust from an expensive one — without the harness itself becoming the bottleneck.

**Scope decision:** everything in v1. Phase count expanded (granularity: fine) rather than scope cut.

**Verification split.** Requirements marked **[FAUX]** are fully testable on the development machine using `fauxProvider()` from `@earendil-works/pi-ai` (scripted mock provider, no keys, no network). Requirements marked **[RUNBOOK]** require live credentials and are verified by the user on the work laptop against a documented procedure. A requirement is not Complete until its designated verification has actually run.

**Checkbox legend.** `[ ]` not started · `[~]` **partial — built and verified offline, but a named live check has not run** · `[x]` complete, its designated verification has actually executed. The checkbox is what a reader skims, so it must not claim more than the Traceability row beside it. `[~]` always names the outstanding check inline; correcting a checkbox *downward* needs no ceremony, promoting one to `[x]` requires that a human executed the named check.

---

## v1 Requirements

### Bootstrap & Supply Chain

- [x] **BOOT-01**: A **project-scoped** `.npmrc` in the repo sets `ignore-scripts=true`, asserted by the bootstrap script before its first `pi install` — `pi install` executes npm lifecycle scripts with no `--ignore-scripts` on any code path. Deliberately **not** global: `ignore-scripts` in `~/.npmrc` breaks packages with legitimate native builds machine-wide. The tradeoff is that a `pi install` run from another directory is unprotected; README and the runbook must state this, including the setup step when installing on macOS or any second machine.
- [~] **BOOT-02**: User can install the harness on a clean machine with `pi install https://github.com/kaiyitkoh/ky-pi-agent` — *offline half complete (local clone + `npm install --omit=dev`, `tests/integration/load-paths.test.ts` case 2); the real-URL install on a clean profile is `RB-01-02`, **OUTSTANDING***
- [x] **BOOT-03**: User can bootstrap a cold machine with `bin/bootstrap.sh` — installs Pi, verifies `bash`/`git`/`aws`/`glab`/`gh` presence, writes the env-var template, makes idempotent marked-region edits
- [x] **BOOT-04**: Bootstrap fails loudly with an actionable message if the pinned Pi version has been unpublished from npm (versions below 0.74.0 are already gone)
- [~] **BOOT-05**: `cd ky-pi-agent && pi` loads the harness from `.pi/` so the repo dogfoods itself, with `/reload` working — *`.pi/` dogfood load and the structural hot-reload precondition are proven offline; live `/reload` in a TTY is `RB-01-03`, **OUTSTANDING***
- [~] **BOOT-06**: All shell code is POSIX `sh` and all shipped scripts check out LF on both platforms — *the LF half is proven on this machine and on both CI legs; the POSIX-conformance half now has a local `dash -n` parse gate, but `shellcheck --shell=sh` runs only in the `posix-lint` CI job, which has **never executed***
- [~] **BOOT-07**: CI runs the full test suite on `windows-latest` and `macos-latest`, giving real macOS verification without a Mac — *`ci.yml` exists and is statically asserted end-to-end by `tests/unit/ci-pinning.test.ts`; the workflow has **never actually run** and cannot be triggered from this machine*
- [x] **BOOT-08**: Every third-party dependency is pinned to an exact version, with a committed lockfile
- [x] **BOOT-09**: No credential can be committed — `.gitignore` covers every runtime state and secret path, verified by a test
- [x] **BOOT-10**: `CONTRIBUTING.md` states the boundary rule: a new capability defaults to command or skill; registering a tool requires justifying its per-request schema cost

### Diagnostics

- [ ] **DIAG-01**: Every provider request and response is captured via `before_provider_request` / `after_provider_response` / `before_provider_headers`, showing the exact JSON on the wire **[FAUX]** + **[RUNBOOK]**
- [x] **DIAG-02**: All model invocations route through a single exported `callModel()` chokepoint — provider hooks wire only into the main agent's `streamFn`, so a direct `modelRegistry.complete()` is invisible to the inspector **[FAUX]**
- [x] **DIAG-03**: A lint or test fails the build if `modelRegistry.complete` is called outside `diagnostics/` **[FAUX]**
- [x] **DIAG-04**: Every turn appends a JSONL record — model, provider, tokens, cost, latency, cache-read ratio, outcome (no reasoning-token column for Bedrock; it reports none) **[FAUX]**
- [ ] **DIAG-05**: A detector identifies prose tool calls — `finish_reason:"stop"` with `tool_calls:null` and a function name in `content` — logs `event: prose_tool_call`, and retries rather than treating the turn as complete **[FAUX]** + **[RUNBOOK]**
- [x] **DIAG-06**: `/budget` reports system-prompt tokens, tool-schema tokens, context-file tokens, skills-index tokens, and `cacheRead` vs `input` **[FAUX]**
- [x] **DIAG-07**: Captured payloads are redacted at capture time and written only to gitignored paths — a wire inspector is by construction a credential-logging tool feeding a public repo **[FAUX]**
- [x] **DIAG-08**: Diagnostic logs rotate rather than growing unbounded **[FAUX]**

### Providers & Credentials

- [x] **PROV-01**: `models.json` and `auth.json` ship as structurally complete templates with zero secrets, resolved at runtime via `$ENV_VAR` and `!command`
- [x] **PROV-02**: `!command` interpolation appears only in `auth.json` (cached per process), never in `models.json` (re-executed on every provider request)
- [~] **PROV-03**: DashScope is configured as a custom provider with an **explicit** full `compat` block — Pi's `detectCompat` has no `aliyuncs.com` branch, so defaults silently disable thinking and 400 on the second turn of any tool sequence **[RUNBOOK]** — *the block is shipped and proven twice offline: deep-equal against the composed `compat` (`tests/unit/dashscope-compat.test.ts`) and on real emitted bytes through Pi's own adapter (`tests/integration/dashscope-payload.test.ts`). Both prove what Pi **emits**; whether DashScope **accepts** it is `RB-03-01`, **OUTSTANDING***
- [~] **PROV-04**: Bedrock authenticates via `credential.env.AWS_PROFILE` in `auth.json`, which Pi checks before process env — survives a fresh shell, contains no secret, templatable in-repo **[RUNBOOK]** — *the template, the merge-if-absent installer and the resolution order are proven offline with every variable in Pi's chain blanked (`tests/unit/bedrock-auth.test.ts`); authenticating from a fresh shell against a real IAM Identity Center session is `RB-03-03`, **OUTSTANDING***
- [x] **PROV-05**: Expired SSO credentials produce an actionable message naming the exact `aws sso login --profile <name>` command, and are classified **non-retryable** so they don't burn wall-clock in a retry loop **[FAUX]**
- [~] **PROV-06**: Every model carries accurate capability metadata — `input[]`, per-provider true `contextWindow`, `cost` — and never inherits a context window from a different provider's entry for the same model — *the invariant is complete and enforced (no templated model inherits the identically-named DeepSeek-direct context window or cost table), and every all-zero placeholder price is on the `COST_UNVERIFIED` allowlist and named in the runbook. The real output cap and the real per-token price are `RB-03-05`, **OUTSTANDING***
- [~] **PROV-07**: The R1 experiment is run and recorded: does `api.deepseek.com` accept `reasoning_effort: "low"`, and does it produce materially fewer reasoning tokens than `"high"` **[RUNBOOK]** — *the experiment is written, executable and unit-proven (`tests/unit/r1-unclamp.test.ts`: Pi 0.84.1 clamps `low` to `high`, the `modelOverrides` unclamp removes the clamp), with a pre-committed threshold. It has **not been run** — that is `RB-03-04`, **OUTSTANDING**, and until it has a result `/cheap` is not defined in terms of a cheap thinking tier*
- [x] **PROV-08**: A DeepSeek-direct → DashScope fallback chain handles quota, transient, and unavailable errors **[FAUX]**
- [x] **PROV-09**: A first-run runbook documents every credential-dependent verification the user performs on the work laptop, with expected output for each — *`docs/RUNBOOK.md` carries eleven entries across Phases 1–3, each with an exact command, precise expected output, a named offline proxy that exists on disk, and a status; `tests/unit/docs-policy.test.ts` parses both the summary table and the `**Status:**` line and reports a disagreement as `INCONSISTENT`. Phases 4, 5, 8 and 10 append their own sections*
- [~] **PROV-10**: A two-turn tool-calling sequence against DashScope returns 200 — the first turn always works, so the second is the test **[RUNBOOK]** — *the mechanism is proven on real bytes with a paired negative control: Pi inserts `reasoning_content` on the replayed assistant message, and deleting the compat key removes it (`tests/integration/dashscope-payload.test.ts`). The provider's 200 on the **second** turn is `RB-03-02`, **OUTSTANDING**, and cannot be substituted*

### Safety

- [~] **SAFE-01**: GitLab server-side protected branches and approval rules are configured and verified by attempting a push that must fail — the only control that is not theatre **[RUNBOOK]** — *the offline proxy is shipped and green (`tests/integration/gitlab-push-protection.test.ts`: a real push to a real local bare repo with a rejecting `pre-receive` hook is refused, a paired non-protected push succeeds, and the harness's own `classifyPushFailure()` classifies a protected rejection and an ordinary non-fast-forward rejection differently). Whether GitLab is actually configured on the work laptop is `RB-04-01`, **OUTSTANDING***
- [x] **SAFE-02**: Bash commands are parsed to an AST with `unbash`, resolving wrappers (`sudo`, `env`, `sh -c`, `xargs`) so `g=push; git $g` and `bash -lc "..."` are caught **[FAUX]**
- [x] **SAFE-03**: Anything unparseable — command substitution, backticks, heredocs, backgrounding — **fails closed** **[FAUX]**
- [x] **SAFE-04**: Writes are blocked when `HEAD == main`, while read-only operations against main (`fetch`, `rebase`, `diff`, `log`, `worktree add -b feat main`) remain allowed **[FAUX]**
- [x] **SAFE-05**: `glab mr merge` is blocked — in the user's work repo, the MR merge is the deploy trigger **[FAUX]**
- [x] **SAFE-06**: Reads of `.env`, `~/.aws/credentials`, kubeconfig, and `*.tfstate` are blocked — tfstate holds plaintext secrets that would enter model context **[FAUX]**
- [x] **SAFE-07**: `terraform apply|destroy|import`, mutating `aws` CLI calls, and `kubectl delete` require explicit confirmation **[FAUX]**
- [x] **SAFE-08**: File writes and deletes outside the project directory are blocked **[FAUX]**
- [x] **SAFE-09**: Enforcement happens **twice** — at the `tool_call` hook and inside a wrapped `bash` tool — because later hooks can mutate `event.input` after approval and Pi performs no re-validation **[FAUX]**
- [x] **SAFE-10**: Confirmation uses block → approval-tool → re-issue, not an inline `confirm()`, and is **deny-by-default**; a CI test asserts the deny under `--mode json` where `noOpUIContext.confirm` returns `false` **[FAUX]**
- [x] **SAFE-11**: Safety extensions install at **user scope** — project-scoped extensions don't load in subagents, which spawn headless and therefore never grant trust **[FAUX]**
- [x] **SAFE-12**: The blocked-command test passes **inside a spawned subagent**, not only in the interactive session **[FAUX]**
- [x] **SAFE-13**: The non-bash surface is guarded — `.git/hooks/*`, `.git/config`, `~/.bashrc`, `~/.gitconfig`, CI workflow files **[FAUX]**
- [x] **SAFE-14**: Every allow and every block is written to an audit JSONL **[FAUX]**
- [x] **SAFE-15**: A documented table lists known bypasses the guard does not catch — an honest limits statement, not a claim of completeness
- [ ] **SAFE-16**: `gh` is left unauthenticated on the work laptop and this is stated in the runbook — `/share` cannot be blocked by any extension, and aborting on `gh auth status` is the only control
- [x] **SAFE-17**: At least 30 evasion attempts are tested, each either blocked or explicitly documented as out of scope **[FAUX]**

### Routing

- [x] **ROUTE-01**: An explicit role→model map covers executor, planner, reviewer, advisor, vision, and summariser — no auto-classification
- [x] **ROUTE-02**: `/cheap`, `/balanced`, `/max` swap the whole role→model map via `pi.setModel()` from a command after `await ctx.waitForIdle()`, which removes the race **[FAUX]**
- [x] **ROUTE-03**: `/escalate` pulls a stronger model for one invocation, and the elevated state is visible and sticky until cleared **[FAUX]**
- [x] **ROUTE-04**: Single-shot roles (review, advisor, vision, summarise) run through `callModel()` → `ctx.modelRegistry.complete()` with per-call reasoning effort, not by mutating session state **[FAUX]** — *the pure plan/dispatch pipeline (`resolveRoute`, `pickConfiguredCandidate`, `planRoleCall`, `runSingleShotRole`) was proven at the unit level in plan 05-04 (`tests/unit/routing-dispatch.test.ts`); the `[FAUX]` session-level proof — `tests/integration/single-shot-roles.test.ts` (plan 05-08) driving `runSingleShotRole` against a real faux session and reading back the wire/turns records — proves the nested-row identity, no-session-mutation, per-call-reasoning-effort-on-the-wire (both directions) and zero-cost-guard-refusal properties*
- [x] **ROUTE-05**: Roles needing a tool loop run as subagents **[FAUX]**
- [x] **ROUTE-06**: Capability guards hard-block impossible routes: image → text-only model; oversized context → small-window model **[FAUX]**
- [x] **ROUTE-07**: A capability guard hard-blocks Bedrock non-Claude models with thinking enabled — `buildAdditionalModelRequestFields` silently drops it while the UI still offers the setting **[FAUX]**
- [x] **ROUTE-08**: A capability guard hard-blocks Bedrock DeepSeek R1 as an executor — it supports no tool calling at all **[FAUX]**
- [x] **ROUTE-09**: Mode selection persists across restarts via `pi.appendEntry`, costing zero context tokens **[FAUX]**
- [x] **ROUTE-10**: Every mode switch produces a wire dump proving the intended model was actually used **[FAUX]**
- [~] **ROUTE-11**: Qoder is available as a delegate tool that hands off a whole task and folds the result back — explicitly a foreign agent that bypasses the harness's tools, safety hooks, and wire inspector, and documented as such **[RUNBOOK]** — *the delegate tool is built and registered (`.pi/extensions/qoder/{client,index}.ts`, plan 05-03): a pure config refusal, a tolerant incremental SSE parser and the three-step Cloud Agents HTTP sequence, proven offline against a real `127.0.0.1` HTTP+SSE loopback fixture (`tests/unit/qoder-client.test.ts`, `tests/integration/qoder-delegate.test.ts`, plans 05-03/05-06) with no PAT and no network egress on this machine, and documented as a foreign agent in both the tool's own description and `docs/ROUTING.md` §6 (plan 05-12). Whether a real PAT against a real `agent_id`/`environment_id` actually reaches `api.qoder.com` and folds a result back is `RB-05-01`, appended to `docs/RUNBOOK.md` (plan 05-12), and stays **OUTSTANDING***

### Composed Extensions

- [~] **EXT-01**: Subagents support per-agent model, system prompt, tool restriction, and thinking level — *the structural proof is complete offline: `.pi/agents/planner.md` ships no `model:`/`fallbackModels:` key so Phase 5's `agentOverrides` is not silently defeated (`07-04-SUMMARY.md`), and ten `file:line` citations against the real pinned `pi-subagents@0.49.0` tarball back the model/system-prompt/tool-restriction/thinking-level claims (`docs/EXTENSIONS.md`'s Subagent capability evidence table, `tests/unit/subagent-capabilities.test.ts`). No package has ever been installed and no subagent has ever actually spawned on this machine — that live proof is `RB-07-01`, **OUTSTANDING***
- [x] **EXT-02**: Parallel subagents run in isolated git worktrees, verified to **build**, not merely check out — untracked files like `.env` and `node_modules` do not travel to a new worktree — *this is this repository's own worktree-setup hook, proven directly by `tests/integration/worktree-build.test.ts` without needing `pi-subagents` installed*
- [~] **EXT-03**: Subagents can run in the background without blocking the session — *the concrete mechanism is cited end to end against the real pinned tarball — the `async` parameter, the unconditional `subagent_wait` registration, and the detached-child-process dispatch through to a real `pi --mode json -p` process (`docs/EXTENSIONS.md`'s Subagent capability evidence table, findings 1–3; `tests/unit/subagent-capabilities.test.ts`). No package has ever been installed, so no background run has ever actually executed — `RB-07-01`, **OUTSTANDING***
- [~] **EXT-04**: A running subagent can be steered mid-run without killing it — *the `steer` action, the file-based control-inbox shape distinct from `interrupt`/`stop`/`timeout`, and `deliverSteerRequest`'s running-step gate are cited against the real pinned tarball (`docs/EXTENSIONS.md`'s Subagent capability evidence table, findings 4–6; `tests/unit/subagent-capabilities.test.ts`). No package has ever been installed, so no subagent has ever actually been steered — `RB-07-01`, **OUTSTANDING***
- [~] **EXT-05**: Plan mode, todo tracking, background bash, LSP diagnostics, structured user questions, web lookup, session search, and loop detection are available — *four capabilities (plan mode, todo tracking, structured user questions, loop detection) are vendored, live in this session right now, and mechanically bound to their tracked source (`tests/unit/extension-composition.test.ts`). The other four (background bash, LSP diagnostics, web lookup, session search) are pinned npm specs in `.pi/settings.json` that have **never been installed** — plan 07-10's install gate was found NOT SATISFIED (its own pre-authorisation ground that this machine holds no credentials is false), so none of the four has ever ridden on a real request or been "available" in an actual session. Installing and reconciling them is `RB-07-02`, **OUTSTANDING***
- [x] **EXT-06**: Pi's own bundled examples are preferred over third-party packages wherever they cover the need — *a decision fact, not an install-dependent one; enforced by `tests/unit/extension-composition.test.ts`'s EXT-06 regression guard (no vendored capability's npm alternative may appear in `packages[]`)*
- [x] **EXT-07**: File checkpointing restores the working tree, with Pi's bundled `git-checkpoint.ts` as the fallback if no third-party option proves sound — *vendored, not install-dependent*
- [x] **EXT-08**: Every pin is re-verified at planning time rather than inherited from research — the ecosystem ships 13–16 releases/month — *re-verified independently in plans 07-01, 07-10 and 07-11, not install-dependent*
- [~] **EXT-09**: A documented smoke-test ritual runs on every version bump: one turn per provider, one subagent spawn, one blocked command, one wire dump — *the ritual is documented as a composed sequence in `docs/RUNBOOK.md`'s `RB-07-01`, citing the existing Phase 2/3 entries for legs 1 and 4 and naming the exact steps for legs 2 and 3. Three of its four legs need the work laptop and a real installed extension tree; only the blocked-command leg has a complete offline proxy. Running it is `RB-07-01`, **OUTSTANDING***
- [x] **EXT-10**: Any extension without a license file is vendored rather than depended on — *not install-dependent; `pi-loop-police`'s missing LICENSE was re-verified three times independently (`07-06-SUMMARY.md`)*

### Quality Gates

- [~] **GATE-01**: Deterministic gates — typecheck, lint, LSP diagnostics — run and feed errors back **before** any model review **[FAUX]** — *typecheck, lint and the QUAL-01 anti-pattern legs run for real inside `/quick` (plan 08-11); the LSP leg's `probeLspAvailability` mechanism is proven offline in both states, but `@narumitw/pi-lsp` has never been installed on this machine, so this leg has only ever reported `UNAVAILABLE`, never `FAIL` against a real language server. `RB-08-02`, **OUTSTANDING***
- [~] **GATE-02**: A fresh-context reviewer subagent receives the full contract: diff, every touched file in full, test and typecheck output, SPEC requirements, files-touched union, and the import graph **[FAUX]** — *`buildReviewerContext`'s six-element contract is proven to reach a captured outgoing request intact and redacted (`tests/integration/reviewer-contract.test.ts`, plan 08-07). `.pi/agents/reviewer.md` ships deliberately unwired — the reviewer is dispatched via `runSingleShotRole`, not a real `pi-subagents` spawn — because the package has never been installed. `RB-08-03`, **OUTSTANDING***
- [x] **GATE-03**: Review output gives a per-requirement verdict (Implemented / Partial / Missing) with file:line evidence **[FAUX]**
- [x] **GATE-04**: Review output includes a mandatory "checked and cleared" section, so silence is structurally impossible **[FAUX]**
- [x] **GATE-05**: Findings are classified BLOCKER / WARNING / NIT, and unclassified findings are rejected as malformed **[FAUX]**
- [x] **GATE-06**: BLOCKERs go through a refute-or-promote pass before they can stop work — reviewers told to find gaps invent them **[FAUX]**
- [x] **GATE-07**: Task completion is gated on `tool_result` exit codes bound to a git SHA, never on transcript text — a model that writes prose tool calls can also write plausible command output **[FAUX]**
- [~] **GATE-08**: Seeded-defect calibration measures what the reviewer actually catches, distinguishing "the code is clean" from "the reviewer is asleep" **[FAUX]** — *the corpus (six real Phase 3-7 incidents), the scorer (`scoreCalibration`, a raw ratio) and all six required negative controls (blind, shotgun, name-drop, kitchen-sink, two-needle-kitchen-sink, generic-derivable-phrase — every one proven to score 0) are complete and proven offline (plan 08-10, hardened by WR3-01/WR3-02 in `08-REVIEW.md` iteration 3 and CR3C-01 in `08-REVIEW-R3CHECK.md`). The recorded 2/6 = 0.333... catch rate — corrected down from an undisclosed 3/6 that WR3-02 proved had been held constant by construction, and unaffected by CR3C-01's own needle-independence fix — is a SCRIPTED faux reviewer's number, proving the pipeline, not a live model's judgement; no live reviewer has ever run against this corpus. `RB-08-03`, **OUTSTANDING***
- [x] **GATE-09**: Advisor escalation lets the executor consult a stronger model at a decision point via `callModel()` **[FAUX]**
- [~] **GATE-10**: Per-role thinking budgets apply on the nested path (reviewer, advisor, summariser); main-loop budgets apply only if the wire inspector proved the parameters land **[FAUX]** + **[RUNBOOK]** — *the nested half is fixed and proven offline (`buildNestedApiOptions`, `tests/integration/gate10-nested-thinking.test.ts`, plan 08-01): a real per-`model.api` bug (Bedrock nested calls silently dropping their thinking field) was found and fixed. The main-loop half — reading a real wire dump to confirm the parameters land on `pi.setModel()`'s own dispatch — is `RB-08-01`, **OUTSTANDING***

### Engineering Quality

The harness must produce root-cause fixes that scale, not symptom patches. Exhortation in `AGENTS.md` is explicitly **not** the mechanism — agents ignore comprehensive instructions, so this is enforced structurally. Gate depth scales with the work so the quality layer never becomes the bottleneck.

- [x] **QUAL-01**: Deterministic anti-pattern rules (ast-grep + lint) detect magic numbers where a constant belongs, special-casing on a literal input value, copy-paste duplication, swallowed exceptions, `TODO`/`FIXME` shipped as a fix, and N+1 query shapes **[FAUX]**
- [x] **QUAL-02**: Those rules run inside the existing deterministic gate stage, adding no model round trip and no measurable wall-clock **[FAUX]**
- [x] **QUAL-03**: For any change framed as a fix, SPEC.md carries a **Root Cause** section naming the cause with `file:line` evidence and stating why the change addresses the cause rather than the symptom — gated the same way as Verified Codebase Facts **[FAUX]** — *`validateSpec`'s branch (8) (`.pi/extensions/grill/spec-schema.ts`, plan 09-06): fix-framed detection via `isFixFramed`/`FIX_FRAMING_MARKERS` (with an explicit override), the conditional gate itself (absent section, empty cause, no file:line citation, empty or cause-identical "why not the symptom" — each its own reject), proved by a fixture table (3 rejects) plus a mandatory non-fix-framed accept case and falsification (c) proving the conditionality is load-bearing*
- [x] **QUAL-04**: The reviewer classifies every change as **root-cause / symptomatic / workaround** with written justification, as extra structure on the review pass already being paid for — not an extra call **[FAUX]**
- [x] **QUAL-05**: Any change classified symptomatic or workaround stops the workflow and requires the user's explicit approval before it can ship **[FAUX]**
- [x] **QUAL-06**: An approved workaround is recorded in the MR body with what the proper fix would be and why it was deferred, so the debt is visible rather than silent **[FAUX]**
- [x] **QUAL-07**: A design-level review pass covering algorithmic complexity, scalability, and abstraction fit fires **conditionally** — on signals (diff spans many files, a loop wraps a query, a data model or public interface changes) or on explicit `/escalate` — never on every task **[FAUX]**
- [x] **QUAL-08**: Gate depth scales with the workflow: `/quick` runs deterministic rules only; the full workflow runs all four mechanisms **[FAUX]**
- [x] **QUAL-09**: The wall-clock and token cost added by the quality layer is recorded per turn in the JSONL, so the correctness/latency balance is a measured number and can be tuned rather than guessed **[FAUX]** — *the ledger mechanism (plan 08-04) is exercised by real producers — the deterministic gate stage, the reviewer, the refute pass, the advisor consult — each calling `addQualityCost` exactly once per pass; plan 08-11 proves a real, live-session `/quick` turn's own `kind:"turn"` JSONL row carries `qualityMs`, read off disk rather than an in-memory peek, with a paired negative control proving a blocked gate's cost is never billed to a later, unrelated turn*

### Workflows

- [x] **FLOW-01**: `/quick` executes trivial work with no ceremony, in **≤80 lines**, enforced by a CI line-budget test
- [x] **FLOW-02**: `/grill` interrogates until the spec is unambiguous, using an ambiguity scorecard with per-dimension floors, a hard question budget, one question at a time, and rotating interview perspectives
- [x] **FLOW-03**: `/grill` produces SPEC.md containing a **Verified Codebase Facts** table — `claim | evidence (file:line or command output) | how verified` — and refuses to write requirements until it exists
- [x] **FLOW-04**: SPEC.md states error behaviour as `IF <condition> THEN THE SYSTEM SHALL <response>`, which cannot be filled in without naming a failure — *`IF_THEN_PATTERN`/`MIN_ERROR_BEHAVIOURS`/`parseErrorBehaviours` and `validateSpec`'s branches (4)/(5) (`.pi/extensions/grill/spec-schema.ts`, plan 09-06): exact-uppercase-keyword forcing function, a named minimum-3 count, per-entry shape rejection naming the offending entry; falsifications (a) (case) and (b) (count) both confirmed load-bearing*
- [ ] **FLOW-05**: SPEC.md pins scope as an expected-files list, machine-checkable against the diff at review time — *DECLARATION half only (plan 09-06): `ScopePin`/`EXPECTED_FILE_PATTERN`/`parseScopePin` and `validateSpec`'s branches (6)/(7) enforce a non-empty, reasoned out-of-scope list and a non-empty expected-files list of legal repo-relative paths (no leading `/`, no `..`, no glob — falsification (d) confirmed load-bearing). The DIFF half — comparing this list against a real `git diff` — is plan 09-14's job; FLOW-05 closes there*
- [x] **FLOW-06**: `/plan` produces PLAN.md with tasks in the form `T### [P] [R#] verb <explicit path> + verification command`, plus a requirement-coverage matrix — *MACHINE-CHECKABLE half only (plan 09-09): `TASK_LINE_PATTERN`/`parseTaskLine`/`parsePlanTasks` and `validatePlan`'s 7 numbered branches enforce the task-line shape and both-directions requirement coverage (falsifications (a)/(b) confirmed each coverage direction independently load-bearing). Wiring this into `/plan`'s actual write path is plan 09-10's job; FLOW-06 closes there*
- [ ] **FLOW-07**: `/execute` appends to PROGRESS.md with pasted real command output, and commits atomically
- [ ] **FLOW-08**: `/review` produces REVIEW.md and opens an MR targeting **staging, never main**
- [ ] **FLOW-09**: Subagents receive self-contained handoff packets, so delegation costs negative tokens in the parent
- [ ] **FLOW-10**: The total artifact set is SPEC, PLAN, REVIEW plus a PROGRESS append — no document that no downstream consumer reads
- [x] **FLOW-11**: Every workflow has a CI-enforced line budget

### Context Budget

- [ ] **CTX-01**: Named tool profiles (recon / implement / review / full) are set once at `session_start` and only added to — tool *removal* invalidates the prompt cache **[FAUX]**
- [ ] **CTX-02**: `pi.setActiveTools()` is the mechanism; the `context` hook cannot strip tool definitions and is not used for this **[FAUX]**
- [ ] **CTX-03**: `AGENTS.md` has a hard token budget enforced in CI
- [ ] **CTX-04**: No volatile content — timestamps, running cost, git branch, changed files — appears in the system prompt; DeepSeek cache reads are ~50× cheaper than fresh input, so one volatile token re-prices the whole prefix every turn **[FAUX]**
- [ ] **CTX-05**: A controlled minimal-vs-full-harness experiment measures whether context pollution actually degrades output quality **[RUNBOOK]**
- [ ] **CTX-06**: Per-extension per-turn token cost is measured and recorded, so every installed extension can be justified

### Terminal UI

- [ ] **UI-01**: A custom theme ships, conforming to Pi's theme schema
- [ ] **UI-02**: A statusline shows model, provider, context remaining, session cost, git branch, and changed files — rendered in TUI chrome, never in the system prompt
- [ ] **UI-03**: A custom startup header ships
- [ ] **UI-04**: A live widget shows running subagents and their status
- [ ] **UI-05**: No UI element introduces a system-prompt cache invalidation, verified by watching `cacheRead` stay non-trivial

---

## v2 Requirements

Deferred. Tracked but not in the current roadmap.

### Foreign Agents
- **QODR-01**: Richer Qoder Cloud Agents integration beyond single-task delegation
- **CCB-01**: Claude Code bridge as an escalation target, contingent on verifying `pi-claude-bridge` works against a Bedrock-backed Claude Code rather than a Pro/Max subscription

### Evaluation
- **EVAL-01**: A frozen task set drawn from real repos, scored via Pi's SDK and `--mode json`
- **EVAL-02**: Model-vs-model comparison on that task set, turning role assignment from taste into measurement

### Workflow
- **SDD-01**: OpenSpec-style ADDED / MODIFIED / REMOVED delta specs
- **PLAY-01**: Playwright localhost verification as an evidence-gated skill
- **LIB-01**: Library-version and misused-API pinning in `AGENTS.md`

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| MCP | Not part of the user's workflow. Compensated by a mandatory web extension, since Pi has no web tool. |
| Auto-learned / semantic memory | Stale facts fail invisibly. `AGENTS.md` fails visibly in a diff. |
| Qoder as a routable model | No inference endpoint exists — verified at `docs.qoder.com/llms.txt`. Not technically possible. |
| Qoder via unofficial proxy | The published Pi packages contain WAF-bypass encoding and RSA/AES signature forging. Breaches Qoder ToS §3.2.6/§3.2.9/§3.2.10; §15.2 makes termination irreversible. |
| Virtual provider for routing | Its unique benefit is automatic per-turn routing, explicitly rejected. Costs the `/model` picker and cost accounting. |
| Forking a subagent extension | ~15 upstream releases/month makes a fork permanent unpaid maintenance. |
| Auto-classifying model router | An auto-router that is wrong gives a bad result with no obvious cause — the exact debugging problem the user already had. |
| Hosted observability SaaS | Violates zero-spend. Braintrust self-hosting is Enterprise-only. |
| Self-hosted Langfuse | Needs Postgres + ClickHouse. Violates the low-infra constraint. Local JSONL instead. |
| Strict TDD | Fights Terraform and varied-maturity repos. Evidence-gating fixes the actual failure. |
| Browser automation in the harness | The user already has a Playwright CLI flow; a skill wrapping it is cheaper. |
| Porting GSD wholesale | ~60 skills at ~40–60 tokens of index each is ~3,000 tokens/turn of pure index, and they depend on Claude Code tools Pi lacks. |
| Multi-file spec bundles | Artifact volume does not buy adherence — Fowler's team found agents ignored comprehensive specs anyway. |
| Persistent canonical spec corpus | Same invisible-rot failure already rejected for auto-memory. |
| Spec-as-source / regenerable code | Closed beta, JS-only, non-deterministic. |
| Full EARS grammar | Documented as a sledgehammer. Only `IF/THEN THE SYSTEM SHALL` is adopted. |
| Approval gate between every phase | Approval fatigue is permission-prompt fatigue by another name. |
| `--auto` self-answering clarification | Structurally defeats a grilling workflow — converts "user doesn't know what they want" into "the model guessed and nobody noticed". |
| Mode-flag matrices with precedence rules | A documented precedence order between flags is itself the smell. |
| Exhortation as the quality mechanism | "Write robust, long-term, scalable code" in `AGENTS.md` is the weakest possible lever — Fowler's team documented agents ignoring comprehensive specs. `AGENTS.md` may carry the standard as context, but QUAL-01…09 are the enforcement. |
| Design-level review on every task | Would make the harness the bottleneck it exists to remove. Fires on signals or `/escalate` only. |
| A build step | Pi loads `.ts` through jiti. A build breaks `/reload` for zero gain. |
| `@sinclair/typebox` | Legacy scoped fork; produces schemas Pi cannot validate. Use unscoped `typebox`. |
| `@gotgenes/pi-subagents-worktrees` | Bridges a third subagents package and silently no-ops otherwise. Both candidate packages have worktrees natively. |
| Installing `@ramtinj95/pi-infra-command-guard` | Hard peer-depends on a package dragging in `openai`, `web-tree-sitter`, `tree-sitter-bash`, `ws`. Read its `unbash` approach; write our own. |

---

## Traceability

Populated during roadmap creation. Full phase definitions in `.planning/ROADMAP.md`.

| Phase | Name |
|-------|------|
| 1 | Bootstrap, Packaging & Supply Chain |
| 2 | Diagnostics — The Instrument |
| 3 | Providers & Credentials |
| 4 | Safety & Deployment Guardrails |
| 5 | Routing & Capability Guards |
| 6 | Walking Skeleton — `/quick` & the Evidence Gate |
| 7 | Composed Extensions, Pinned & Reviewed |
| 8 | Quality Gates & Engineering Quality |
| 9 | Ceremonial Workflows |
| 10 | Context Budget & Progressive Disclosure |
| 11 | Terminal UI |

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOOT-01 | Phase 1 | Complete — control shipped and live-verified at all three npm scopes; the residual gap (third-party git packages, and any machine bootstrap has not run on) is stated as **not covered** in `README.md` per the requirement's own wording |
| BOOT-02 | Phase 1 | Complete offline — proven by `tests/integration/load-paths.test.ts` case 2 (local clone + `npm install --omit=dev`). The real-URL install on a clean profile is `RB-01-02`, **OUTSTANDING** |
| BOOT-03 | Phase 1 | Complete |
| BOOT-04 | Phase 1 | Complete |
| BOOT-05 | Phase 1 | Complete offline — `.pi/` dogfood load proven by `tests/integration/load-paths.test.ts`; the structural hot-reload precondition by `tests/unit/extension-layout.test.ts`. Live `/reload` in a TTY is `RB-01-03`, **OUTSTANDING** |
| BOOT-06 | Phase 1 | Complete offline — LF proven by `tests/unit/lf-and-shell.test.ts` and by the CR scan on both CI legs; POSIX syntax proven locally by a `dash -n` parse of every tracked `*.sh` (dash is a genuine POSIX shell, unlike Git-Bash `sh`). `shellcheck --shell=sh --severity=style` is the full conformance gate and lives in the `posix-lint` job, which has **never actually run** |
| BOOT-07 | Phase 1 | Complete statically — `ci.yml` fully asserted by `tests/unit/ci-pinning.test.ts`; the workflow has **never actually run**, and cannot be triggered from this machine |
| BOOT-08 | Phase 1 | Complete |
| BOOT-09 | Phase 1 | Complete |
| BOOT-10 | Phase 1 | Complete |
| DIAG-01 | Phase 2 | Pending |
| DIAG-02 | Phase 2 | Complete |
| DIAG-03 | Phase 2 | Complete |
| DIAG-04 | Phase 2 | Complete |
| DIAG-05 | Phase 2 | Pending |
| DIAG-06 | Phase 2 | Complete |
| DIAG-07 | Phase 2 | Complete |
| DIAG-08 | Phase 2 | Complete |
| PROV-01 | Phase 3 | Complete |
| PROV-02 | Phase 3 | Complete |
| PROV-03 | Phase 3 | Partial — the explicit `compat` block is shipped and proven both as composed and as emitted bytes; provider acceptance is `RB-03-01`, **OUTSTANDING**. Not complete |
| PROV-04 | Phase 3 | Partial — `credential.env.AWS_PROFILE` resolution, the template and the merge-if-absent installer are proven offline; a fresh shell against a real SSO session is `RB-03-03`, **OUTSTANDING**. Not complete |
| PROV-05 | Phase 3 | Complete |
| PROV-06 | Phase 3 | Partial — the cross-provider invariant and the `COST_UNVERIFIED` allowlist are complete and enforced in both directions; the real cap and per-token price are `RB-03-05`, **OUTSTANDING**. Not complete |
| PROV-07 | Phase 3 | Partial — the experiment is written, executable and unit-proven with a pre-committed threshold; it has never been run, which is `RB-03-04`, **OUTSTANDING**. Not complete |
| PROV-08 | Phase 3 | Complete |
| PROV-09 | Phase 3 | Complete — `docs/RUNBOOK.md` carries eleven entries across Phases 1–3, all `OUTSTANDING` and machine-enforced as such by `tests/unit/docs-policy.test.ts` in both the summary table and the detail subsection |
| PROV-10 | Phase 3 | Partial — `reasoning_content` on the replayed assistant message is proven on real bytes with a paired negative; the second turn's 200 is `RB-03-02`, **OUTSTANDING**. Not complete |
| SAFE-01 | Phase 4 | Partial — the offline proxy (`tests/integration/gitlab-push-protection.test.ts`, plan 04-12) is shipped and green: a real push to a real local bare repo with a rejecting `pre-receive` hook is refused, the paired non-protected push succeeds, and `classifyPushFailure()` classifies a protected rejection and an ordinary non-fast-forward rejection differently. Whether GitLab is actually configured on the work laptop is `RB-04-01`, **OUTSTANDING**. Not complete |
| SAFE-02 | Phase 4 | Complete — plans 04-01, 04-03 |
| SAFE-03 | Phase 4 | Complete — plans 04-03, 04-07 |
| SAFE-04 | Phase 4 | Complete — plan 04-05 |
| SAFE-05 | Phase 4 | Complete — plan 04-05 |
| SAFE-06 | Phase 4 | Complete — plan 04-04 |
| SAFE-07 | Phase 4 | Complete — plan 04-06 |
| SAFE-08 | Phase 4 | Complete — plan 04-04 |
| SAFE-09 | Phase 4 | Complete — plan 04-08 |
| SAFE-10 | Phase 4 | Complete — plans 04-07, 04-08, 04-09 |
| SAFE-11 | Phase 4 | Complete — plans 04-01, 04-09 |
| SAFE-12 | Phase 4 | Complete — plan 04-10 |
| SAFE-13 | Phase 4 | Complete — plan 04-04 |
| SAFE-14 | Phase 4 | Complete — plans 04-02, 04-08, 04-10 |
| SAFE-15 | Phase 4 | Complete — plan 04-11 |
| SAFE-16 | Phase 1 | Pending — second clause DONE (runbook entry `RB-01-01` written in 01-10, classifier shipped in 01-07); first clause OUTSTANDING — `gh auth logout` has not been run on the work laptop. Not completable from this machine |
| SAFE-17 | Phase 4 | Complete — plan 04-11 |
| ROUTE-01 | Phase 5 | Complete |
| ROUTE-02 | Phase 5 | Complete |
| ROUTE-03 | Phase 5 | Complete |
| ROUTE-04 | Phase 5 | Complete — plan pipeline (05-04) plus [FAUX] session proof (05-08, `tests/integration/single-shot-roles.test.ts`) |
| ROUTE-05 | Phase 5 | Complete |
| ROUTE-06 | Phase 5 | Complete |
| ROUTE-07 | Phase 5 | Complete |
| ROUTE-08 | Phase 5 | Complete |
| ROUTE-09 | Phase 5 | Complete |
| ROUTE-10 | Phase 5 | Complete |
| ROUTE-11 | Phase 5 | Partial — the delegate tool is built, registered and proven offline (config refusal, SSE parser, `tests/unit/qoder-client.test.ts`, plan 05-03; the three-request sequence and folded result against a real loopback fixture, `tests/integration/qoder-delegate.test.ts`, plan 05-06), and documented as a foreign agent in `docs/ROUTING.md` §6 (plan 05-12). The live check against a real PAT is `RB-05-01`, appended to `docs/RUNBOOK.md` (plan 05-12), **OUTSTANDING**. Not complete |
| EXT-01 | Phase 7 | Partial — the frontmatter proof (`.pi/agents/planner.md` ships no `model:` key) and ten `file:line` citations against the pinned `pi-subagents@0.49.0` tarball are complete offline (`docs/EXTENSIONS.md`, `tests/unit/subagent-capabilities.test.ts`, plans 07-04/07-09/07-12); no subagent has ever actually spawned, which is `RB-07-01`, **OUTSTANDING**. Not complete |
| EXT-02 | Phase 7 | Complete — this repository's own worktree-setup hook, proven directly by `tests/integration/worktree-build.test.ts` (plans 07-02/07-05), no install needed |
| EXT-03 | Phase 7 | Partial — the concrete background-execution mechanism (the `async` parameter, unconditional `subagent_wait`, detached-child dispatch to a real `pi --mode json -p` process) is cited against the pinned tarball (`docs/EXTENSIONS.md`, `tests/unit/subagent-capabilities.test.ts`, plan 07-12); no background run has ever actually executed, which is `RB-07-01`, **OUTSTANDING**. Not complete |
| EXT-04 | Phase 7 | Partial — the mid-run-steering mechanism (`steer`'s file-based control inbox, `deliverSteerRequest`'s running-step gate) is cited against the pinned tarball (`docs/EXTENSIONS.md`, `tests/unit/subagent-capabilities.test.ts`, plan 07-12); no subagent has ever actually been steered, which is `RB-07-01`, **OUTSTANDING**. Not complete |
| EXT-05 | Phase 7 | Partial — four vendored capabilities (plan mode, todo tracking, structured user questions, loop detection) are live and mechanically bound to tracked source (`tests/unit/extension-composition.test.ts`, plan 07-11); the four npm-backed capabilities (background bash, LSP diagnostics, web lookup, session search) are pinned but have **never been installed** — plan 07-10's install gate was found NOT SATISFIED, so none has ever been "available" in a real session. Installing and reconciling is `RB-07-02`, **OUTSTANDING**. Not complete |
| EXT-06 | Phase 7 | Complete — a decision fact enforced by `tests/unit/extension-composition.test.ts`'s regression guard, not install-dependent |
| EXT-07 | Phase 7 | Complete — vendored, not install-dependent |
| EXT-08 | Phase 7 | Complete — re-verified independently in plans 07-01, 07-10 and 07-11, not install-dependent |
| EXT-09 | Phase 7 | Partial — the composed ritual is documented as a single sequence in `docs/RUNBOOK.md`'s `RB-07-01` (plan 07-13), citing existing Phase 2/3 entries for two of its four legs and naming the exact steps for the other two; running it is `RB-07-01`, **OUTSTANDING**. Not complete |
| EXT-10 | Phase 7 | Complete — not install-dependent; `pi-loop-police`'s missing LICENSE re-verified three times independently (plan 07-06) |
| GATE-01 | Phase 8 | Partial — typecheck, lint and the QUAL-01 anti-pattern legs are wired into a real `/quick` (plan 08-11); the LSP leg's mechanism is proven offline in both states, but `@narumitw/pi-lsp` has never been installed, so it has only ever reported `UNAVAILABLE`. `RB-08-02`, **OUTSTANDING**. Not complete |
| GATE-02 | Phase 8 | Partial — the six-element reviewer context contract reaches a captured outgoing request intact and redacted (`tests/integration/reviewer-contract.test.ts`, plan 08-07); `.pi/agents/reviewer.md` ships deliberately unwired because the reviewer dispatches via `runSingleShotRole`, never a real `pi-subagents` spawn (never installed). `RB-08-03`, **OUTSTANDING**. Not complete |
| GATE-03 | Phase 8 | Complete |
| GATE-04 | Phase 8 | Complete |
| GATE-05 | Phase 8 | Complete |
| GATE-06 | Phase 8 | Complete |
| GATE-07 | Phase 6 | Complete |
| GATE-08 | Phase 8 | Partial — the corpus (six real Phase 3-7 incidents), the pure scorer and required negative controls (blind/shotgun/name-drop/kitchen-sink/two-needle-kitchen-sink/generic-derivable-phrase, all score 0) are complete and proven offline (plan 08-10, hardened WR3-01/WR3-02 in `08-REVIEW.md` iteration 3 and CR3C-01 in `08-REVIEW-R3CHECK.md`); the recorded 2/6 catch rate (corrected from an undisclosed 3/6, WR3-02; unaffected by CR3C-01) is a SCRIPTED faux reviewer's number, proving the pipeline rather than a live model's judgement. `RB-08-03`, **OUTSTANDING**. Not complete |
| GATE-09 | Phase 8 | Complete |
| GATE-10 | Phase 8 | Partial — the nested half is fixed and proven offline: a real Bedrock per-`model.api` defect (nested calls silently dropping their thinking field) was found and fixed (plan 08-01). The main-loop half needs a real wire dump confirming `pi.setModel()`'s own dispatch carries the parameters. `RB-08-01`, **OUTSTANDING**. Not complete |
| QUAL-01 | Phase 8 | Complete |
| QUAL-02 | Phase 8 | Complete |
| QUAL-03 | Phase 9 | Complete — plan 09-06's `validateSpec` branch (8) conditional Root Cause gate |
| QUAL-04 | Phase 8 | Complete |
| QUAL-05 | Phase 8 | Complete |
| QUAL-06 | Phase 8 | Complete |
| QUAL-07 | Phase 8 | Complete |
| QUAL-08 | Phase 9 | Complete |
| QUAL-09 | Phase 8 | Complete — the ledger mechanism (plan 08-04) is exercised by real producers, and plan 08-11 proves a live-session `/quick` turn's own JSONL row carries `qualityMs`, read off disk, with a paired negative control against cost leaking to an unrelated turn |
| FLOW-01 | Phase 6 | Complete |
| FLOW-02 | Phase 9 | Complete |
| FLOW-03 | Phase 9 | Complete |
| FLOW-04 | Phase 9 | Complete — plan 09-06's `IF_THEN_PATTERN`/`validateSpec` branches (4)/(5) |
| FLOW-05 | Phase 9 | Partial — plan 09-06 built the declaration half (`validateSpec` branches (6)/(7)); the diff half is plan 09-14's job, FLOW-05 closes there |
| FLOW-06 | Phase 9 | Partial — plan 09-09 built the machine-checkable half (`validatePlan`, both-directions coverage); wiring into `/plan`'s write path is plan 09-10's job, FLOW-06 closes there |
| FLOW-07 | Phase 9 | Pending |
| FLOW-08 | Phase 9 | Pending |
| FLOW-09 | Phase 9 | Pending |
| FLOW-10 | Phase 9 | Pending |
| FLOW-11 | Phase 6 | Complete |
| CTX-01 | Phase 10 | Pending |
| CTX-02 | Phase 10 | Pending |
| CTX-03 | Phase 10 | Pending |
| CTX-04 | Phase 10 | Pending |
| CTX-05 | Phase 10 | Pending |
| CTX-06 | Phase 10 | Pending |
| UI-01 | Phase 11 | Pending |
| UI-02 | Phase 11 | Pending |
| UI-03 | Phase 11 | Pending |
| UI-04 | Phase 11 | Pending |
| UI-05 | Phase 11 | Pending |

**Coverage:**
- v1 requirements: **107 total** — corrected from 105. The earlier count predated the QUAL-01…09 Engineering Quality group. Counted by category: BOOT 10 · DIAG 8 · PROV 10 · SAFE 17 · ROUTE 11 · EXT 10 · GATE 10 · QUAL 9 · FLOW 11 · CTX 6 · UI 5.
- Mapped to phases: **107**
- Unmapped: **0** ✓
- Duplicates: **0** ✓ — every requirement maps to exactly one phase

**Per-phase counts:** P1: 11 · P2: 8 · P3: 10 · P4: 16 · P5: 11 · P6: 3 · P7: 10 · P8: 16 · P9: 11 · P10: 6 · P11: 5 = 107

**Placement notes where a requirement crosses a category boundary:**

| Requirement | Placed in | Why not the obvious phase |
|-------------|-----------|---------------------------|
| SAFE-16 (`gh` unauthenticated) | Phase 1 | `/share` cannot be blocked by any extension — built-in commands are matched before extension commands. The only control is machine state, set at bootstrap, and it must hold from session one. The runbook sentence is appended in Phase 3. |
| GATE-07 (evidence gate on exit codes) | Phase 6 | It is the "evidence" leg of the walking skeleton's route → guard → execute → evidence → commit path, and it interacts with the Phase 2 prose-tool-call detector to fabricate evidence if built late. |
| FLOW-11 (CI line budgets) | Phase 6 | The budget must constrain the ceremonial workflows *before* they are written. GSD's 1,169-line "quick" is the counterexample. |
| QUAL-01, QUAL-02 (anti-pattern rules) | Phase 8 | They run inside the existing deterministic gate stage — same stage, no extra model round trip. |
| QUAL-03 (Root Cause section) | Phase 9 | It is a SPEC.md section gated the same way as Verified Codebase Facts, so it belongs with the spec workflow. |
| QUAL-04…07 (classification, approval, debt record, design pass) | Phase 8 | Extra structure on the review pass already being paid for, not an extra call. |
| QUAL-08 (gate depth scales) | Phase 9 | The `/quick`-vs-full split is a workflow property; it can only be expressed once both workflows exist. |
| QUAL-09 (quality-layer cost per turn) | Phase 8 | It extends the Phase 2 JSONL schema, but the number is unfillable until the quality layer exists. |

**[RUNBOOK] distribution (13 of 107):** Phase 2 — DIAG-01, DIAG-05 · Phase 3 — PROV-03, PROV-04, PROV-07, PROV-10 · Phase 4 — SAFE-01 · Phase 5 — ROUTE-11 · Phase 8 — GATE-01 (the LSP leg), GATE-02 (the reviewer subagent spawn), GATE-08 (the live calibration run), GATE-10 (main-loop half) · Phase 10 — CTX-05. Corrected from "8" to "13" by plan 08-13's reconciliation — the prior count predated this phase's own honest accounting of GATE-01/02/08's live-blocked halves and undercounted even the pre-existing nine.

*Note: GATE-10 and DIAG-01/05 carry both [FAUX] and [RUNBOOK] tags — the offline half is verifiable on the dev machine, the live half is not.*

---
*Requirements defined: 2026-08-13*
*Last updated: 2026-08-13 — traceability populated from ROADMAP.md; total corrected 105 → 107*
