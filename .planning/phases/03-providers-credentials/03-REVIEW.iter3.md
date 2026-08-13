---
phase: 03-providers-credentials
reviewed: 2026-08-14T01:45:00Z
depth: standard
iteration: 2
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
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 3: Code Review Report — Iteration 2

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

All seventeen iteration-1 findings were checked at source. **Fifteen are genuinely
closed** — the original failure scenario is now impossible, not merely harder to
say. Every fix was read against Pi 0.84.1's installed source rather than against
the fix report, and the three claims the fixer flagged as load-bearing were
re-derived independently:

- `provider` really is assigned on `AssistantMessage` **before** the `try` whose
  `catch` sets `errorMessage`, on **both** the adapter path
  (`pi-ai dist/api/bedrock-converse-stream.js:25`, `:218`) **and** the setup-error
  path (`pi-ai dist/api/lazy.js:6` — `createSetupErrorMessage` also sets
  `provider: model.provider`). So WR-05's gate cannot silently suppress PROV-05 on
  a credential failure raised before the stream opens. That was the fix's biggest
  risk and it is not real.
- `auth-storage.js:20-30` matches the fixer's quotation exactly: `mkdirSync(dir,
  { recursive: true, mode: 0o700 })` and `writeFileSync(..., { mode: 0o600 })` +
  `chmodSync(0o600)`, both behind `if (!existsSync(...))`. `ensure_agent_dir`
  (`bin/bootstrap.sh:368-371`) is called from all four creation sites including
  `harden_pi_npm_root:375`, which does run first.
- Everything credential-bearing lives under `getAgentDir()` — `auth.json`,
  `models.json`, `sessions/`, `themes/`, `tools/`, `prompts/`
  (`pi dist/config.js:412-453`). So `mkdir -p` leaving the *parent* `~/.pi` at
  0755 while the leaf is 0700 is not a hole; the CR-02 fix is placed correctly.

`bin/bootstrap.sh` is clean POSIX: `sh -n` passes, and a grep for `local`,
`declare`, `typeset`, `[[`, `sort -V` and array assignment finds nothing outside
the comment that forbids them. No apostrophe survives inside any of the four
single-quoted `node -e` blocks. The new `case 5b` fixtures name a real DashScope
host but are *refused* before anything is written and no request is issued
anywhere in the suite; egress stays closed.

**The four defects below are all one class, and it is the class this project cares
most about: a guard that stays green when its subject is broken.** Two of them
re-open an iteration-1 **BLOCKER** under a one-token edit. Each was proven by
mutation against the real suite — every claim below carries a verified
"649/649 still green" result, not an argument:

| Mutation | Suite result |
|---|---|
| append `\|exceeded` to `QUOTA_PATTERN` | **649 passed** — CR-03 re-opened |
| delete the sentinel row from `NOT_A_PROFILE` **and** the sentinel check from `usableProfileName` | **649 passed** — CR-01 half A re-opened |
| swap the two lines of `resolveProfileName` | **649 passed** |

None of them is incorrect behaviour *today*, which is why none is Critical. All
four are Warnings, and two of them are the reason the iteration-1 blockers are
one careless commit from returning.

`npx tsc --noEmit` is clean and the suite is 649/649 on an unmutated tree. The
working tree was restored after every mutation and is byte-identical to `HEAD`.

## Warnings

### WR-01: CR-01's sentinel guard can be deleted with nothing red — the WR-04 self-comparison was reintroduced in the case written to close CR-01

**File:** `tests/integration/sso-classifier.test.ts:525-530`, `:281-284`,
`.pi/extensions/providers/index.ts:157-159`

**Issue:** Commit `4d88a6e` replaced `expect(ssoRuns.length).toBe(SSO_FIXTURES.length)`
with a hard floor of 6 because "comparing against `SSO_FIXTURES.length` compares
the loop with itself". Commit `4a1e5ee`/`e3e719d` then wrote the *same* comparison
into case 4b:

```ts
expect(notAProfileRuns.length, "...").toBeGreaterThanOrEqual(NOT_A_PROFILE.length);
expect(NOT_A_PROFILE.length).toBeGreaterThanOrEqual(1);
```

`notAProfileRuns` is built by `for (const [label, value] of NOT_A_PROFILE)
notAProfileRuns.push(...)` at `:309-316`, so the first assertion is two views of
one iteration and can only differ if `beforeAll` threw. The only real floor is the
second one, and it is **1** — for a table whose own docstring (`:274-279`) says its
two rows "are rejected by DIFFERENT mechanisms and each would pass under the
other".

So the table can be halved to the metacharacter row, which is caught by
`SAFE_PROFILE_NAME`, and the CR-01 equality check at `index.ts:157-159` — the only
thing that can ever reject `REPLACE_WITH_AWS_PROFILE_NAME`, because that string is
29 characters drawn entirely from the AWS profile charset — becomes free to
delete.

**Verified.** Deleting `["the unedited auth-template placeholder",
PROFILE_TEMPLATE_SENTINEL]` from `NOT_A_PROFILE` and the three-line
`if (trimmed === PROFILE_TEMPLATE_SENTINEL) return undefined;` from
`usableProfileName`: **649 tests passed, 45 files passed.** `tsc --noEmit` is the
only thing that notices, and only because the import goes unused. With both gone,
a hand-copied template entry surfaces
`aws sso login --profile REPLACE_WITH_AWS_PROFILE_NAME` with the RB-03-03 pointer
suppressed — exactly CR-01 §2.

**Fix:** Apply the file's own remedy to its own new table. The floor must be a
literal, and it must equal the number of *mechanisms* the table covers:

```ts
expect(
	NOT_A_PROFILE.length,
	"two rows, rejected by two different mechanisms: the auth-template sentinel by the " +
		"equality check in usableProfileName (no shape bound can ever reject it — it is " +
		"drawn entirely from the AWS profile charset), and the metacharacter name by " +
		"SAFE_PROFILE_NAME. Dropping either row makes its guard deletable with nothing " +
		"red [CR-01, WR-01]",
).toBeGreaterThanOrEqual(2);

expect(
	notAProfileRuns.length,
	"comparing against NOT_A_PROFILE.length compares the loop with itself and is " +
		"satisfied by an empty table — the WR-04 shape, in the case written to close CR-01",
).toBeGreaterThanOrEqual(2);
```

Then re-run the two mutations above and confirm each turns exactly one row red.

---

### WR-02: `QUOTA_PATTERN` can be widened arbitrarily with nothing red — the per-alternative table is not tied to the pattern it claims to pin

**File:** `.pi/extensions/providers/schema.ts:431-432`, `:546-549`,
`tests/integration/fallback-chain.test.ts:625-658`

**Issue:** `QUOTA_ALTERNATIVE_FIXTURES` and case 3b close the *deletion* direction
cleanly: seven fixtures, a floor of 7, and a real minimality check. They close
nothing in the *addition* direction, and addition is the direction CR-03 was about.

Two independent gaps:

1. `QUOTA_ALTERNATIVE_FIXTURES` is a hand-written list of alternative *labels*.
   Nothing derives it from, or compares it against, `QUOTA_PATTERN.source`. A new
   alternative added to the pattern gets no fixture, no `classifyFailure` row and
   no minimality check, and the `>= 7` floor is still satisfied by the seven that
   were already there.
2. The minimality assertion at `:647-658` tests each fixture against **the other
   table entries**, not against `QUOTA_PATTERN`. So its verdict is relative to the
   table, which the new alternative is not in. `schema.ts:547-548` states the
   stronger claim — "Each `text` is chosen so that exactly ONE alternative matches
   it, which is asserted directly by `fallback-chain.test.ts`" — and that claim
   stops being true the moment the pattern and the table diverge.

The only remaining control on widening is `NON_QUOTA_BILLING_FIXTURES`, and both
of its entries are *billing* wording. Any loose token that is not billing-shaped
passes it untouched.

**Verified.** Changing `schema.ts:432` to

```ts
/insufficient_quota|out of budget|quota exceeded|exceeded your current quota|allocated quota|arrearage|exceeded|billing (?:details|quota|limit)/i;
```

gives **649 tests passed, 45 files passed.** With that one token in place,

```ts
classifyFailure(
  "Error code: 400 - {'error': {'message': 'Input length exceeded the maximum allowed for this model'}}",
) === "quota"
```

so `callWithFallback` dials hop 2 and forwards the user's prompt, system prompt and
tool schemas to DashScope to be rejected a second time. That is CR-03 verbatim,
restored by seven characters, against a green suite.

**Fix:** Make the table describe the pattern rather than sit beside it. Split
`QUOTA_PATTERN.source` on top-level `|` and require set equality with the table:

```ts
it("case 3c — every QUOTA_PATTERN alternative has a minimal fixture, and no alternative is unpinned", () => {
	// Top-level alternation only: no alternative in this pattern contains a bare
	// `|` outside the one `(?:details|quota|limit)` group, so split on `|` that
	// is not inside parentheses.
	const declared = QUOTA_PATTERN.source.split(/\|(?![^(]*\))/);
	expect(
		declared.slice().sort(),
		"an alternative was added to QUOTA_PATTERN with no minimal fixture, so it is " +
			"untested in BOTH directions: nothing kills it and — far worse — nothing shows " +
			"what else it now matches. A match here means the whole prompt goes to a second " +
			"vendor, which is the inverted consequence the pattern's own docstring records " +
			"[CR-03, threat T-03-10-01]",
	).toEqual(QUOTA_ALTERNATIVE_FIXTURES.map((entry) => entry.alternative).sort());
});
```

and change the minimality check at `:647-658` to rebuild the pattern from
`declared` minus the alternative under test, so it is asserted against the real
pattern rather than against the fixture table. With that in place, appending
`|exceeded` fails `case 3c` immediately and names the unpinned token.

---

### WR-03: `resolveProfileName`'s stored-before-ambient order is asserted nowhere, and the WR-05 fix made it structurally unreachable in the only harness that drives it

**File:** `.pi/extensions/providers/index.ts:199-205`, `:179-186`,
`tests/helpers/session.ts:255-268`

**Issue:** `resolveProfileName` mirrors Pi's own chain —
`credential?.env?.AWS_PROFILE ?? (await env("AWS_PROFILE"))` — and the docstring at
`:188-198` states why the order is load-bearing: "Naming a different profile than
the one that failed would be worse than naming none." Nothing asserts it.

Every run in `sso-classifier.test.ts` reaches the ambient branch. `withFauxSession`
constructs `ModelRuntime.create({ authPath: join(agentDir, "auth.json"), ... })`
against a file that does not exist and registers a faux provider whose auth
resolves empty (`tests/helpers/session.ts:262-268` and its own docstring at
`:27-28`). `storedProfileName` therefore returns `undefined` on every single run,
so line 201 is dead weight in the test suite.

The WR-05 fix narrowed this further rather than opening it. Because `drive()` now
registers the faux provider under the id `amazon-bedrock`
(`sso-classifier.test.ts:230`), `ctx.modelRegistry.getProviderAuth("amazon-bedrock")`
resolves through the *faux* provider, which shadows Pi's real Bedrock resolver.
Wiring a stored credential now requires a provider registered as `amazon-bedrock`
whose auth is non-empty — a combination no existing seam produces, even though
`ModelRuntime.create({ credentials, ... })` and `InMemoryCredentialStore` are named
in the helper's own docstring at `:21-27`.

**Verified.** Swapping lines 201 and 202 of `index.ts`:

```ts
usableProfileName(process.env[AWS_PROFILE_ENV]) ??
usableProfileName(await storedProfileName(ctx)) ??
```

gives **649 tests passed, 45 files passed.** Concrete consequence on the target
machine: a laptop with `export AWS_PROFILE=personal` and a stored Bedrock
credential naming `work`. Pi dials `work` (stored wins,
`pi-ai src/providers/amazon-bedrock.ts:65`); the inverted handler prints
`aws sso login --profile personal`. The user re-authenticates the wrong profile,
the next turn fails identically, and PROV-05 has made the failure *more* confusing
than the raw SDK string. This is the exact outcome the docstring names.

**Fix:** Wire the `credentials` seam the helper already documents and add the
paired case:

```ts
// tests/helpers/session.ts
credentials?: CredentialStore;   // forwarded to ModelRuntime.create

// tests/integration/sso-classifier.test.ts — case 4c
// Stored says `stored-profile`, ambient says `ambient-profile`. Pi's own chain
// prefers the stored one, so the surfaced command must too: naming the profile
// that did NOT fail sends the user to re-authenticate the wrong one.
expect(message?.errorMessage).toContain(`${AWS_SSO_LOGIN_PREFIX}stored-profile`);
expect(message?.errorMessage).not.toContain("ambient-profile");
```

If the faux-under-`amazon-bedrock` shadowing makes that impossible, unit-test
`resolveProfileName` directly against a stubbed `ExtensionContext` — the function
takes only `ctx.modelRegistry.getProviderAuth`, so a two-line stub covers both
branches without a session at all.

---

### WR-04: `docs/RUNBOOK.md` RB-03-03 still describes the pre-CR-01 installer, on the exact page `PROFILE_PLACEHOLDER_HINT` sends the user to

**File:** `docs/RUNBOOK.md:567-570`, `.pi/extensions/providers/schema.ts:112-113`,
`bin/bootstrap.sh:766-812`

**Issue:** The fix report states "docs/RUNBOOK.md was not touched", but commit
`4a1e5ee` changed the behaviour the runbook describes. RB-03-03 step 2 still reads:

> `bin/bootstrap.sh` writes the same shape from `.pi/templates/auth-template.json`,
> replacing the literal placeholder `REPLACE_WITH_AWS_PROFILE_NAME`; an existing
> `amazon-bedrock` entry is left untouched, so a hand-configured one is never
> clobbered.

Both halves are now wrong in the same direction. Bootstrap never replaced the
placeholder (installing it verbatim *was* CR-01), and it now **withholds the entry
entirely** — `merge_auth_json` skips any template entry carrying a
`REPLACE_WITH_` value at any depth (`bin/bootstrap.sh:786-806`). A fresh run
produces an `auth.json` containing only `dashscope` and `deepseek`.

This is not an incidental doc. `PROFILE_PLACEHOLDER_HINT` is
`" — no AWS profile is configured; see RB-03-03 in docs/RUNBOOK.md"`, appended to
the surfaced message on exactly the path where the user has no profile. So the
operator meeting an expired SSO session is routed to a page that tells them
bootstrap wrote an `amazon-bedrock` entry with a placeholder to edit. They open
`~/.pi/agent/auth.json`, find no such key, and are left reconciling the runbook
against the file. `tests/unit/docs-policy.test.ts` pins RB-03-03's *commands* and
its OUTSTANDING status, not its prose, so nothing catches this.

**Concrete:** `PI_CODING_AGENT_DIR=/tmp/x sh bin/bootstrap.sh; cat /tmp/x/auth.json`
prints two keys where RB-03-03 promises three.

**Fix:** Replace the sentence with what the script does, and keep it in step with
the message the script already prints at `bin/bootstrap.sh:807-811`:

```markdown
   `bin/bootstrap.sh` deliberately does **not** install this entry. The template
   carries `"AWS_PROFILE": "REPLACE_WITH_AWS_PROFILE_NAME"` to document the shape,
   and `merge_auth_json` withholds any entry still holding a `REPLACE_WITH_`
   value — a stored `env.AWS_PROFILE` beats the ambient one in Pi's own chain
   (`pi-ai amazon-bedrock.ts:65`), so installing the placeholder would silently
   break a laptop where `export AWS_PROFILE=…` already worked. The run says which
   entries it withheld and why. `pi auth login` writes the real entry; an existing
   `amazon-bedrock` entry is never touched.
```

Consider adding the sentence to `ENTRY_COMMANDS["RB-03-03"]` in
`tests/unit/docs-policy.test.ts` — or a substring of it — so a third behaviour
change cannot drift the page again silently.

## Info

### IN-01: CR-02's mode assertions have still never executed on any leg

**File:** `tests/integration/templates-install.test.ts:398-425`

**Issue:** Recorded as an acknowledged residual rather than a new defect, because
the mechanism was independently verified here. Case 1c branches on
`process.platform === "win32"` and returns after two existence assertions, so the
`700`/`600` checks run only on `macos-latest`, which per BOOT-07 has never run.
The shell side is correct by reading: `ensure_agent_dir` (`bin/bootstrap.sh:368-371`)
does `mkdir -p` then `chmod 700`, is called from all four creation sites including
`harden_pi_npm_root:375` ahead of `mkdir -p "$PI_NPM_ROOT"`, and `chmod`/`chmodSync`
are not umask-masked. `merge_auth_json:822-823` pairs `{ mode: 0o600 }` with an
explicit `chmodSync`, which is right — `mode` is honoured by `open(2)` on creation
only.

**Fix:** No code change. Track it against BOOT-07; the first macOS run either
confirms it or produces a real finding. Do not restate this as closed until that
leg has run.

---

### IN-02: `grep -v ... > "$_rc_file" || true` truncates the user's `.npmrc` before grep runs, and swallows every non-zero exit

**File:** `bin/bootstrap.sh:416-417`

**Issue:** The `|| true` is justified in the comment for exit 1 only ("it exits 1
when the filtered result is empty, which is a legitimate input"). It also swallows
exit 2 — an unreadable or vanished `.npmrc.kypi-backup`, or a `grep` that dies on a
binary-looking file. The redirection truncates `$_rc_file` *before* `grep` executes,
so on exit 2 the user's `.npmrc` is left empty and then gains only the two appended
lines. The backup written at `:413-415` makes this recoverable and it is announced,
but the file the comment describes as possibly holding
`//registry.internal/:_authToken` is destroyed in place.

**Fix:** Discriminate the one legitimate exit code:

```sh
grep -v '^[[:space:]]*ignore-scripts[[:space:]]*=' "$_rc_file.kypi-backup" \
	>"$_rc_file" || [ "$?" -eq 1 ]
```

---

### IN-03: the IN-05 teardown removes `http.Server`'s own internal connection handler

**File:** `tests/helpers/loopback.ts:324`

**Issue:** `server.removeAllListeners("connection")` is broader than the comment
above it ("its `connection` listener", singular). `server` is an `http.Server`
(`createServer(...)`), and `http.createServer` registers its own `connectionListener`
on the `connection` event. The call removes that too. Harmless on this path — the
server never bound and is closed immediately — but it means the object is no longer
a working HTTP server, so any future edit that retries the bind after this catch
gets a socket-accepting server that never parses a request.

**Fix:** Remove only what this helper added:

```ts
server.removeListener("connection", trackSocket);  // named, hoisted out of :303
server.close();
```

---

### IN-04: case 7c counts a mention inside a test file as "read by something tracked"

**File:** `tests/integration/templates-install.test.ts:1043-1060`

**Issue:** The mechanism chosen over an allowlist — "every name in the managed
block must be READ by something tracked outside the two env templates" — includes
`tests/**` in the consumer set. So a variable is certified as consumed by the very
test that names it. Concrete: re-adding `QODER_PERSONAL_ACCESS_TOKEN=` to
`.pi/templates/env.example` **and** naming the string anywhere under `tests/`
(a fixture, an `AWS_CHAIN_VARIABLES`-style table, a comment) makes case 7c green
again, and the operator is back to being asked to mint a credential for a vendor
03-CONTEXT decision 8 rules out.

Tightening this is free today: all four managed names have non-test consumers —
`DASHSCOPE_API_KEY` and `DEEPSEEK_API_KEY` in `.pi/templates/auth-template.json`,
`AWS_PROFILE` in `.pi/extensions/providers/schema.ts`, `KYPI_DASHSCOPE_BASE_URL` in
`bin/bootstrap.sh` and `docs/RUNBOOK.md` (verified by `git grep -l` excluding
`tests/` and `.planning/`).

**Fix:** Add `&& !path.startsWith("tests/")` to the consumer filter, with the
reason inline: a test that names a variable is documenting a check, not consuming a
credential.

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 2_
