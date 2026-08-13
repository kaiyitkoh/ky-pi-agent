---
phase: 01-bootstrap-packaging-supply-chain
reviewed: 2026-08-13T09:55:00Z
depth: deep
files_reviewed: 24
files_reviewed_list:
  - bin/bootstrap.sh
  - scripts/check-gh-unauthenticated.sh
  - .pi/extensions/harness/index.ts
  - .github/workflows/ci.yml
  - package.json
  - package-lock.json
  - tsconfig.json
  - vitest.config.ts
  - .npmrc
  - .pi/npm/.npmrc
  - .pi/settings.json
  - .pi/templates/env.example
  - .env.example
  - .gitignore
  - .gitattributes
  - README.md
  - CONTRIBUTING.md
  - docs/RUNBOOK.md
  - tests/helpers/git.ts
  - tests/helpers/pi.ts
  - tests/helpers/stub-bin.ts
  - tests/fixtures/evil-postinstall/package.json
  - tests/unit/*.test.ts
  - tests/integration/*.test.ts
findings:
  critical: 3
  warning: 12
  info: 6
  total: 21
fixed_at: 2026-08-13T10:25:00Z
outcomes:
  fixed: 21
  skipped: 0
  partial: 1
open_medium_or_above: 0
status: clean
---

# Phase 1: Code Review Report

**Reviewed:** 2026-08-13T09:55:00Z
**Depth:** deep
**Files Reviewed:** 24 (15 test files counted as two globs)
**Status:** clean — all 21 findings resolved 2026-08-13, see [Resolution](#resolution)

## Resolution

Every finding was fixed. Each of the three CRITICALs was reproduced live before
being touched and its **original reproduction command re-run afterwards**; the
transcripts are in the fix agent's report. `npm test` is 248/248 green across 15
files and `npx tsc --noEmit` exits 0 on the final tree.

| ID | Outcome | Commit | Note |
|---|---|---|---|
| CR-01 | **fixed** | `2ca6eb5` | Second, *refusing* pass over the full `[^=]` name class. `unset` cannot be the remedy (dash rc=2). Reproduction now exits 1. |
| CR-02 | **fixed** | `12c7362` | Back up, preserve every other line, append the control. Byte-idempotent. `SECRET-TOKEN-VALUE` survives. |
| CR-03 | **fixed** | `fd77007` | Kept the SHA (it is the current major), corrected the comment to `# v7.0.0`. Both refs re-resolved live; `01-08-SUMMARY.md:39,72,91` and `STATE.md:100` corrected. |
| WR-01 | **fixed** | `36612b0` | `npm ls -g` output kept on non-zero exit; the JSON parse is the arbiter. |
| WR-02 | **fixed** | `36612b0` | Took the *document it* option, not the split: `--check-only` is CI's only pin check and moving the probe would drop BOOT-04 from the matrix. Stated in `README.md`, `docs/RUNBOOK.md` and both of the script's help texts, naming `--assert-hardening` as the offline-safe mode. |
| WR-03 | **fixed** | `36612b0` | Reports the token npm produced instead of asserting a cause. |
| WR-04 | **fixed** | `59a3e83` | Rationale corrected to what a fresh clone actually does (101 packages, four of the five peers — `pi-coding-agent` resolves through the dev edge). New assertion: every non-dev `@earendil-works/*` lock entry is `0.84.1`. Pinning gate itself untouched. |
| WR-05 | **fixed** | `789e788` | BOOT-02/05/06/07 → `[~]` with the outstanding check named inline, plus a checkbox legend. BOOT-06's bare "Complete" row brought into line. Downward only. |
| WR-06 | **fixed** | `b0d82c6` | Five poison shapes × three directions. Mutation-proven both ways against the real script. |
| WR-07 | **fixed** | `84aef9b` | `dash -n` over every tracked `*.sh`. Refuses to fall back to `sh`; skips only on darwin and asserts that; live positive control feeds dash a `function f()` it must reject. |
| WR-08 | **fixed** | `fd77007` | Offline: explicit `AUDITED_PINS` (SHA, tag) table + version-shaped comment + no-silent-additions check. Online: `pin-audit` step re-resolving through `gh api`. Mutation-proven — restoring `# v5.0.0` turns it red. |
| WR-09 | **fixed** | `36612b0` | Both tracked scripts reject extra operands with exit 2. |
| WR-10 | **fixed** | `813424e` | Kept `.env.example` tracked (`.gitignore` has an explicit negation for it and a fresh clone needs it); closed the actual hazard, divergence, with an offline gate on the managed regions. |
| WR-11 | **fixed** | `468c674` | Vacuous line removed. Also rejected the review's repair suggestion, with reasoning: the leak it targets is the *real* `gh`, which writes no log either, so an always-on stub would not make an empty log evidential. |
| WR-12 | **fixed** | `ea62245` | One `tests/helpers/win-quote.ts`; four copies deleted; the previously-untested function now has cases including the trailing-backslash bug. |
| IN-01 | **fixed** | `d0d2aa5` | Dead `!.gitkeep` removed, replaced by a note pointing at the `.pi/npm/*` pair that is the working example. |
| IN-02 | **fixed** | `ea62245` | Six dead placeholders removed; the four genuinely-empty directories keep theirs. *Landed in `ea62245` rather than `d0d2aa5` through a staging mistake — content correct, attribution wrong, recorded in `d0d2aa5`'s message rather than rewritten on `main`.* |
| IN-03 | **fixed** | `d0d2aa5` | `push: { branches: [main] }`. |
| IN-04 | **fixed** | `d0d2aa5` | Lint moved onto the comment-stripped text, with cases proving it did not go blind. |
| IN-05 | **fixed (partial, deliberately)** | `d0d2aa5` | Picker text fixed. Registration **not** gated: registering IS the BOOT-02/BOOT-05 observation and the sentinel a human looks for in `RB-01-03`, so an env seam would trade a cosmetic problem for a verification one. Phase 3 removes the extension outright. |
| IN-06 | **fixed** | `36612b0` | UNC and generic-backslash normalisation. Verified `\\server\share\pi` → `//server/share/pi`, and a POSIX path containing a backslash left alone. |

One defect **not** in this review was found and fixed while fixing CR-02: the
bashism lint's `/\[\[/` flagged POSIX bracket-expression classes such as
`[[:space:]]`, i.e. it fired on the correct portable construct. Narrowed to
`/\[\[(?!:)/` with near-misses and a paired positive — `71aebfc`.

Nothing was skipped. The single partial (IN-05) is Info-tier and its unfixed
half is a deliberate, argued decision rather than deferred work.

## Summary

Phase 1 is unusually well-defended for a first phase: the tests are two-directional,
the vacuity guards are real, `tsc --noEmit` is clean, `npx vitest run tests/unit`
is 201/201 green, the worktree is unchanged after a full unit run, and a secret
scan over every tracked non-planning file finds no token-shaped string and no
developer-machine absolute path.

That said, the review found three defects that must be fixed before this ships,
two of them in `bin/bootstrap.sh` — the file the phase itself calls
"the security-critical one" — and both **reproduced live on this machine**, not
inferred:

1. The `npm_config_*` environment sanitiser fixed in 01-06 is still incomplete.
   A single hyphenated key makes `--assert-hardening` print
   **"All npm scopes are hardened"** for a directory containing no `.npmrc` at
   all. This is the exact false-certification the function exists to prevent,
   one casing deeper than 01-06 found it.
2. `harden_pi_npm_root` **truncates** an existing `~/.pi/agent/npm/.npmrc`. A
   private-registry URL and an `_authToken` placed there by the user are
   silently destroyed with no backup and no warning — in a script whose own
   comments forbid whole-file rewrites for exactly this reason two functions
   further down.
3. `actions/setup-node@8207627…` is tagged **v7.0.0**, not `v5.0.0` as the
   `ci.yml` comment, `01-08-SUMMARY.md` and `STATE.md` all record. The summary's
   claim that both SHAs "were resolved through the live GitHub API" is
   falsifiable and false for this one.

Two systemic themes run through the warnings. First, several honesty claims are
narrower than the artefacts state: `--check-only` is documented as inert and
re-runnable "any time" but hard-fails offline; `CONTRIBUTING.md` states peers
"are never installed by us" while `npm install --omit=dev` in a clone installs
101 packages; `REQUIREMENTS.md` ticks `[x]` on requirements whose live halves are
`OUTSTANDING`. Second, the phase's own strongest rule — "every control assertion
ships with the case that must fail" — is not applied to the sanitiser itself,
which has no dedicated test at all.

`docs/RUNBOOK.md` is clean: all three Phase 1 entries read `OUTSTANDING` in both
table and subsection, and the guard that enforces that is genuinely live.

## Critical Issues

### CR-01: `sanitise_npm_env` misses hyphenated `npm_config_*` keys — the BOOT-01 gate certifies a control that does not exist

**Outcome: fixed** (`2ca6eb5`). Reproduced live first, then re-run after the fix: the poisoned command now exits 1 naming `npm_config_ignore-scripts`, against a directory that is still empty. The strip pass is retained and separately proven still effective (a hardened dir poisoned with `npm_config_ignore_scripts=false` still exits 0).

**File:** `bin/bootstrap.sh:97-103` (sed pattern at `:98-99`)

**Issue:** The sanitiser's regex is
`^\([Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_[A-Za-z0-9_]*\)=`. The character class
excludes `-`, and the `=` anchor means a key such as
`npm_config_ignore-scripts` produces **no match at all** — it is neither
unset nor reported. npm reads it anyway: `@npmcli/config` matches
`/^npm_config_/i` and only normalises `_`→`-` for non-nerf-darted keys, so
`ignore-scripts` arrives already in canonical form and outranks every `.npmrc`.

The header comment at `:82-86` justifies leaving un-unsettable keys alone on the
grounds that "They are per-registry auth, not policy keys." That is false for
this key: it is un-unsettable by any POSIX shell *and* it is the exact policy key
the whole script is a claim about.

Reproduced on this machine (2026-08-13, npm 11.13.0, Git Bash `sh`):

```
$ TMPAGENT=$(mktemp -d)
$ PI_CODING_AGENT_DIR="$TMPAGENT" sh bin/bootstrap.sh --assert-hardening
FATAL: ignore-scripts is not enabled for user-scope prefix (/tmp/…/npm) (got: false)     # rc=1, correct

$ env "npm_config_ignore-scripts=true" PI_CODING_AGENT_DIR="$TMPAGENT" sh bin/bootstrap.sh --assert-hardening
  ignore-scripts=true  user-scope prefix (/tmp/…/npm)
All npm scopes are hardened.                                                             # rc=0, WRONG
```

The directory contains no `.npmrc`. In `run_full` this same assertion is the only
thing standing between the run and `install_pi`.

Confirmed separately that the sed genuinely drops it:

```
$ env 'npm_config_ignore-scripts=true' NPM_CONFIG_FOO=1 sh -c \
    "env | sed -n 's/^\([Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_[A-Za-z0-9_]*\)=.*/\1/p'"
NPM_CONFIG_FOO          # the hyphen key is invisible
```

And that `unset` cannot be the remedy — under `dash` a special-builtin error
kills the shell even inside an `|| true` list (`rc=2`), which is why the fix must
be *detect and refuse*, not *strip*.

**Fix:** add a second, refusing pass for policy keys no shell can unset. Keep the
existing strip for shell-legal names.

```sh
sanitise_npm_env() {
	_keys=$(env | sed -n \
		's/^\([Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_[A-Za-z0-9_]*\)=.*/\1/p' || true)
	for _k in $_keys; do
		unset "$_k" || true
	done

	# Keys npm honours but no POSIX shell can `unset` (hyphens, dots, slashes).
	# Silently ignoring them lets an environment certify a control that has no
	# file behind it, which is worse than having no assertion at all.
	_stuck=$(env | sed -n \
		's/^\([Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_[^=]*[^A-Za-z0-9_=][^=]*\)=.*/\1/p' || true)
	if [ -n "$_stuck" ]; then
		printf 'FATAL: npm configuration is being overridden by environment variables\n' >&2
		printf '       this script cannot remove, so no assertion below would be\n' >&2
		printf '       about the files on disk:\n' >&2
		printf '%s\n' "$_stuck" | sed 's/^/         /' >&2
		printf '       Unset them and re-run (env -u is not available for these names;\n' >&2
		printf '       start a clean shell).\n' >&2
		exit 1
	fi
}
```

Also add the negative control the phase's own rule demands — a test that poisons
the environment with `npm_config_ignore-scripts=true` **and** with
`NPM_CONFIG_IGNORE_SCRIPTS=true` and asserts `--assert-hardening` still exits 1
against an empty `PI_CODING_AGENT_DIR`. See WR-06.

---

### CR-02: `harden_pi_npm_root` truncates an existing user `.npmrc`, destroying registry credentials

**Outcome: fixed** (`12c7362`). Three branches as suggested. Re-running the exact reproduction now reports `updated … (ignore-scripts line added; every other line kept)` plus the backup path, and `grep -c SECRET-TOKEN-VALUE` returns 1. Edge cases executed: absent file, a file whose only line is `ignore-scripts=false` (`grep -v` yields empty — guarded with `|| true` against `set -e`), and a file with no trailing newline. Byte-identical on re-run, so `bootstrap-check-only.test.ts`'s idempotence case still passes.

**File:** `bin/bootstrap.sh:269-290` (the write at `:272-284`)

**Issue:** The guard is
`if [ ! -f "$_rc_file" ] || ! grep -q '^ignore-scripts=true' "$_rc_file"; then`
followed by a `>` redirect. Any pre-existing `~/.pi/agent/npm/.npmrc` that does
not already contain that literal line is **overwritten in full**. That file is a
normal npm project config for the user-scope prefix: a private registry, a proxy,
a `//registry.internal/:_authToken` are all legitimate contents, and Pi's
`ensureNpmProject` only ever creates files that are absent, so a user file there
survives everything except this script.

The same script argues the opposite position two functions later
(`:337-340`): *"Never a whole-file rewrite - this file also holds the user's
installed-package list and their own settings."* `merge_settings` is careful;
`harden_pi_npm_root` is not, and the file it clobbers is the one that can hold a
credential.

Reproduced (2026-08-13):

```
$ printf 'registry=https://npm.example.internal/\n//npm.example.internal/:_authToken=SECRET-TOKEN-VALUE\nignore-scripts=false\n' \
    > "$TMPAGENT/npm/.npmrc"
$ KYPI_SKIP_INSTALL=1 PI_CODING_AGENT_DIR="$TMPAGENT" sh bin/bootstrap.sh
  wrote /tmp/…/npm/.npmrc
$ grep -c SECRET-TOKEN-VALUE "$TMPAGENT/npm/.npmrc"
0                     # registry, token and all other settings destroyed
```

The reported line is `wrote <path>` — nothing tells the operator that anything
was removed.

**Fix:** append or rewrite only the `ignore-scripts` line, and never discard
unknown content. Back up before any destructive step.

```sh
harden_pi_npm_root() {
	mkdir -p "$PI_NPM_ROOT"
	_rc_file="$PI_NPM_ROOT/.npmrc"

	if [ ! -f "$_rc_file" ]; then
		{
			printf '%s\n' '# Written by ky-pi-agent bin/bootstrap.sh. See docs/RUNBOOK.md.'
			# … existing comment block …
			printf '%s\n' 'ignore-scripts=true'
		} >"$_rc_file"
		printf '  wrote %s\n' "$_rc_file"
	elif grep -q '^ignore-scripts=true' "$_rc_file"; then
		printf '  %s already hardened\n' "$_rc_file"
	else
		# Preserve every other line. This file can hold a private registry and
		# an _authToken; truncating it is credential destruction, not hardening.
		cp "$_rc_file" "$_rc_file.kypi-backup"
		grep -v '^[[:space:]]*ignore-scripts[[:space:]]*=' "$_rc_file.kypi-backup" \
			>"$_rc_file"
		printf '%s\n' 'ignore-scripts=true' >>"$_rc_file"
		printf '  updated %s (previous contents kept at %s.kypi-backup)\n' \
			"$_rc_file" "$_rc_file"
	fi

	assert_user_scope
}
```

---

### CR-03: the pinned `actions/setup-node` SHA is v7.0.0, not the v5.0.0 recorded everywhere

**Outcome: fixed** (`fd77007`). Confirmed live, both directions: `v5.0.0` → `a0853c24…`, and the pinned `8207627…` → tags `v7.0.0`, `v7`. Kept the SHA and corrected the comment to `# v7.0.0` — v7 is the current major and already the code in use, so repinning to v5 would be a downgrade for no reason. `checkout@3d3c42e5…` re-resolved cleanly to `v7.0.1` and was left alone. `01-08-SUMMARY.md:39,72,91` and `STATE.md:100` now record the correction rather than the false provenance claim. The tag↔SHA gate from WR-08 shipped in the same commit.

**File:** `.github/workflows/ci.yml:96`
**Also:** `.planning/phases/01-bootstrap-packaging-supply-chain/01-08-SUMMARY.md:39,72,91`, `.planning/STATE.md:100`

**Issue:** `ci.yml:96` reads
`uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v5.0.0`.
Resolved against the GitHub API on 2026-08-13:

```
$ gh api repos/actions/setup-node/git/ref/tags/v5.0.0 --jq .object.sha
a0853c24544627f65ddf259abe73b1d18a591444          # ← what v5.0.0 actually is

$ gh api repos/actions/setup-node/commits/820762786026740c76f36085b0efc47a31fe5020 \
    --jq '.commit.message' | head -1
Migrate to ESM and upgrade dependencies (#1574)   # dated 2026-07-14

$ gh api "repos/actions/setup-node/tags?per_page=20" --jq '.[]|select(.commit.sha=="820762786026740c76f36085b0efc47a31fe5020").name'
v7.0.0
v7
```

`actions/checkout@3d3c42e5…` is correct — it really is `v7.0.1`. Only setup-node
is mislabelled, and it is off by two major versions.

This matters for three reasons. (a) `ci.yml:30-34` states the tag comment exists
precisely so a reader can judge staleness without a network call; a comment
claiming v5 on a v7 pin inverts that. (b) `01-08-SUMMARY.md:72` asserts both SHAs
"were resolved through the live GitHub API during execution" and `:91` repeats it
— for this action that claim is provably untrue, which contaminates the phase's
provenance record. (c) `tests/unit/ci-pinning.test.ts` cannot catch it (see
WR-08), so nothing in the repo will ever notice.

The SHA is a genuine `actions/setup-node` commit, so CI would still function.
The defect is the recorded identity, not the runtime behaviour.

**Fix:** decide which release is intended and make the three records agree.

```yaml
# If v7 is intended (it is the current major, and the SHA already used):
- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0

# If v5 was intended:
- uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
```

Then correct `01-08-SUMMARY.md:39,72,91` and `STATE.md:100`, and add the
tag↔SHA agreement check from WR-08.

## Warnings

### WR-01: `pi_global_matches_pin` treats any non-zero `npm ls -g` as "not installed"

**Outcome: fixed** (`36612b0`). Applied as suggested; the reasoning is now inline above the function.

**File:** `bin/bootstrap.sh:309-320`

**Issue:** `_ls=$(npm ls -g --depth=0 --json 2>/dev/null) || _ls=""` discards the
output whenever npm exits non-zero. `npm ls` exits 1 for a global tree that has
any extraneous, invalid or unmet-peer package — a very common state — while still
printing perfectly good JSON on stdout. On such a machine `install_pi` runs
`npm install -g` on every single bootstrap, contradicting BOOT-03's "safe to
re-run: every step is idempotent" (`:436`) and the
`already installed globally - no action` path at `:328`. It exits 0 on this
machine today, so the defect is latent, not observed.

**Fix:** keep the output and let the JSON parse be the arbiter.

```sh
pi_global_matches_pin() {
	# `npm ls` exits 1 on any extraneous/invalid global package while still
	# emitting valid JSON. Judge the JSON, not the exit code.
	_ls=$(npm ls -g --depth=0 --json 2>/dev/null || true)
	[ -n "$_ls" ] || return 1
	printf '%s' "$_ls" | KYPI_Q_PKG="$PI_PKG" KYPI_Q_VER="$PI_PINNED" node -e '…'
}
```

### WR-02: `--check-only` hard-fails without network, while three documents call it inert and always-available

**Outcome: fixed** (`36612b0`) — took the second option, deliberately. Splitting the probe out is cleaner in the abstract, but `--check-only` is the only step in either CI leg that checks the pin, so moving it would silently drop BOOT-04 from the matrix. Documented the requirement in all four places instead (`README.md`, `docs/RUNBOOK.md`, and both the script header and `usage()`), each naming `--assert-hardening` as the offline-safe mode.

**File:** `bin/bootstrap.sh:468-480` (calls `check_pi_version_published` at `:475`), refusal path at `:205-213`
**Also:** `README.md:112-114`, `docs/RUNBOOK.md:172-182`, `.github/workflows/ci.yml:140-141`

**Issue:** `--check-only` performs a live `npm view` and `exit 1`s when the
registry does not answer. `README.md:112-114` describes it as "performs every
probe and every repo-side assertion, changes nothing, and exits 0 on a clean
runner"; `docs/RUNBOOK.md:172-177` offers it as one of the two commands that make
the three pieces of machine state "re-checkable at any time". Neither mentions
that it needs network. Consequences: both CI matrix legs fail on a registry blip
in a step whose stated job is repo-side assertions;
`tests/integration/bootstrap-check-only.test.ts` cases 1–3 fail offline for a
reason unrelated to what they assert; and an operator following the runbook on a
plane is told, correctly but uselessly, to check their proxy settings.

**Fix:** either split the network probe out of `--check-only` (leaving
`--check-version` as the only mode that touches the registry), or state the
network requirement in `README.md:112-114` and `docs/RUNBOOK.md:179-182` and
accept that the CI step is network-coupled. The first is cleaner; the
`--check-only` docstring at `:38-39` already promises "every probe and repo-side
assertion", which the pin check is not.

### WR-03: every non-E404 registry failure is reported as "could not reach the npm registry"

**Outcome: fixed** (`36612b0`). Applied as suggested, with the E401/E403/ETARGET/no-output shortlist added to the message so the reported token is readable.

**File:** `bin/bootstrap.sh:184-214` (the `*)` arm at `:205-213`)

**Issue:** The classifier is a two-way split on the literal `E404` token, which
is exactly right for the yank-versus-outage distinction it was built for. But
everything else lands in the outage arm: `E403` (blocked by a proxy or a registry
policy), `E401`/`ENEEDAUTH` (a scoped registry needing credentials), `ETARGET`,
and a corporate mirror that has the package but not the version. Each of those
gets "The registry did not answer; the pin itself was not checked. Check your
network or proxy settings" — actionable advice for one cause and misdirection for
four.

**Fix:** report the token you saw rather than asserting a cause.

```sh
*)
	printf 'WARN: could not verify %s@%s against the registry.\n' "$PI_PKG" "$PI_PINNED" >&2
	if [ -n "$_out" ]; then
		printf '      npm said: %s\n' "$_out" >&2
	else
		printf '      npm produced no output; the registry did not answer.\n' >&2
	fi
	printf '      The pin itself was NOT checked. Network, proxy or registry auth.\n' >&2
	exit 1
	;;
```

### WR-04: `CONTRIBUTING.md` and `pinning.test.ts` state peers are never installed; they install 101 packages

**Outcome: fixed** (`59a3e83`). Re-verified on a fresh clone (2026-08-13, npm 11.13.0): 101 packages, and precisely **four** of the five peers — `typebox`, `pi-ai`, `pi-agent-core`, `pi-tui` — plus `pi-telemetry`. `pi-coding-agent` is *not* among them; npm resolves it through the devDependency edge and marks it `dev` in the lock. Both texts now say that. The pinning gate is unchanged; the review's optional suggestion was also taken, so every non-dev `@earendil-works/*` lock entry is asserted at `0.84.1` (with a non-emptiness guard so a lock-format change cannot make it vacuous).

**File:** `CONTRIBUTING.md:64-73`, `tests/unit/pinning.test.ts:44-54`

**Issue:** Both say peers "are not installed at runtime: jiti aliases every one
of them to Pi's own bundled copies" / "Peers are never installed by us." npm 7+
installs the root project's own `peerDependencies`. Verified on a fresh clone:

```
$ git clone <repo> /tmp/kypi-clone && cd /tmp/kypi-clone
$ npm install --omit=dev --dry-run
add typebox 1.3.7
add @earendil-works/pi-tui 0.84.1
add @earendil-works/pi-telemetry 0.84.1
add @earendil-works/pi-ai 0.84.1
add @earendil-works/pi-agent-core 0.84.1
… added 101 packages
```

`npm install --omit=dev` is the exact command Pi runs inside a clone of this repo
(`package-manager.ts:1829`), so every consumer of
`pi install https://github.com/kaiyitkoh/ky-pi-agent` receives the whole AWS SDK,
`openai`, `@anthropic-ai/sdk` and `@google/genai` a second time. Two mitigating
facts, both checked: the committed lockfile has non-dev entries for all 101 and
pins them, and the clone's `.npmrc` blocks lifecycle scripts. So this is not a
live drift today — but the written rationale for tolerating `"*"` is wrong, and
the moment the lock is regenerated the `"*"` peers resolve to whatever is latest.

**Fix:** correct both texts to say what actually happens — "the `"*"` peers *are*
installed into a clone by `npm install --omit=dev`; the committed
`package-lock.json` is the only thing pinning them, which is why the lockfile is
a BOOT-08 obligation and not a convenience" — and consider adding an assertion
that the lock's non-dev `@earendil-works/*` entries are all `0.84.1`.

### WR-05: `REQUIREMENTS.md` ticks `[x]` on requirements whose live halves are OUTSTANDING

**Outcome: fixed** (`789e788`). All four are `[~]` with the outstanding check named inline, and a checkbox legend defines `[~]` so it is not mystery syntax. BOOT-06's traceability row, which said a bare "Complete", was brought into line with the others at the same time. Downward only — nothing was promoted.

**File:** `.planning/REQUIREMENTS.md:17` (BOOT-02), `:20` (BOOT-05), `:21` (BOOT-06), `:22` (BOOT-07)

**Issue:** BOOT-02's text is "User can install the harness on a clean machine with
`pi install <url>`" — that is `RB-01-02`, `OUTSTANDING`. BOOT-05's text ends "with
`/reload` working" — that is `RB-01-03`, `OUTSTANDING`. BOOT-07 is "CI runs the
full test suite on windows-latest and macos-latest" and its own traceability row
at `:235` admits the workflow "has **never actually run**". All three carry `[x]`.
The traceability rows at `:230,233,235` are honest; the checkboxes are not, and
the checkbox is what a reader skims — the precise argument
`tests/unit/docs-policy.test.ts:221-224` makes about the runbook's summary table,
applied inconsistently to this file.

BOOT-06 (`:21`, row `:234` says bare "Complete") has the same shape: its
POSIX-conformance half rests entirely on a `posix-lint` job that has never
executed.

**Fix:** use a partial marker for these four and let the row carry the
qualification, e.g. `- [~] **BOOT-02**: … (offline half complete; live install is
RB-01-02, OUTSTANDING)`. SAFE-16 at `:68` already does the honest thing by
staying unchecked.

### WR-06: the security fix from 01-06 has no dedicated regression test

**Outcome: fixed** (`b0d82c6`). Table extended beyond the review's three rows to five (adding a mixed-case form and the upper-cased hyphen form) and made two-directional, since a table that only asserts "exits 1" is satisfied by a script that fails whenever any `npm_config_*` is present — a brick, not a sanitiser. So: unhardened+poison → 1, hardened+strippable poison → 0, hardened+un-unsettable poison → 1 *and* the key is named, plus a no-poison baseline anchoring the rest. Mutation-proven in both directions against the real script — deleting the refusal pass reddens the four hyphen rows; narrowing the strip back to lower-case-only reddens the three casing rows and the baseline.

**File:** `bin/bootstrap.sh:97-103`; no covering test anywhere in `tests/`

**Issue:** `grep -rn "NPM_CONFIG" tests/` returns nothing. The case-insensitive
strip that 01-06 identified as a live false-certification is guarded only
incidentally, by `tests/integration/npmrc-ordering.test.ts:151-164` case 1, and
only because vitest happens to hand children upper-cased keys. Verified that it
does on this machine:

```
KEYS: ["NPM_CONFIG_CACHE",…,"NPM_CONFIG_IGNORE_SCRIPTS",…]
```

That coverage is a side effect of the launcher, not an assertion. Run the suite
with a runner that does not export those keys and the guard silently evaporates —
and CR-01 shows the same function still has a hole nothing catches.

**Fix:** add an explicit table-driven case to `npmrc-ordering.test.ts`, one poison
key per row, each asserting `--assert-hardening` exits 1 against an empty
`PI_CODING_AGENT_DIR`:

```ts
for (const [key, why] of [
	["npm_config_ignore_scripts", "the form npm run exports on POSIX"],
	["NPM_CONFIG_IGNORE_SCRIPTS", "the form a Node runner exports on Windows"],
	["npm_config_ignore-scripts", "the form no shell can unset — must REFUSE, not pass"],
] as const) {
	it(`refuses to certify an empty scope when ${key} is set (${why})`, () => {
		const run = runBootstrap(["--assert-hardening"], {
			agentDir: tempDir("kypi-agentdir-"),
			env: { ...process.env, [key]: "true" } as Record<string, string>,
		});
		expect(run.status, `stdout:\n${run.stdout}`).toBe(1);
	});
}
```

### WR-07: POSIX conformance is deferred entirely to a CI job that has never run, while a real POSIX shell is present locally

**Outcome: fixed** (`84aef9b`), with one deliberate departure from the suggested code. The review's version throws when `dash` is absent; these cases **skip** instead, because macOS ships no `dash` at all and throwing would redden the macos-latest leg for a tool that platform has never had — a red build nobody can fix is how a gate gets deleted. Three guards keep the skip from becoming false assurance: `resolvePosixShell()` refuses to fall back to `sh` (which is bash-in-POSIX-mode on both target platforms, so accepting it would make the gate a tautology); an always-running case asserts a skip can only happen on `darwin`, so it is visible; and a live positive control feeds `dash` a `function f() { … }` it must reject alongside the POSIX spelling it must accept. Both shipped scripts pass. `CONTRIBUTING.md:166-170` and `STATE.md`, which both said conformance was CI-only, now say what is covered where — a parse is not a lint, so this is a floor under the ShellCheck job, not a replacement.

**File:** `tests/unit/lf-and-shell.test.ts:20-26,64-74`, `CONTRIBUTING.md:166-170`

**Issue:** The file argues, correctly, that Git-for-Windows `sh` and macOS
`/bin/sh` are both bash in POSIX mode and that ShellCheck is the real
conformance gate — then concludes that the only offline check possible is a
four-pattern bashism regex (`[[`, `sort -V`, `declare -A`, `${v^^}`), because "a
fake local conformance check would be worse than none". But `/usr/bin/dash` ships
with Git for Windows and *is* a genuine POSIX shell, not bash in a costume:

```
$ ls -l /usr/bin/dash
-rwxr-xr-x 1 … 117939 … /usr/bin/dash
$ dash -n bin/bootstrap.sh && dash -n scripts/check-gh-unauthenticated.sh && echo OK
OK
$ dash bin/bootstrap.sh --help | head -1
ky-pi-agent bootstrap - cold-machine setup for the Pi harness.
```

Both scripts pass today, so nothing is broken — but the phase shipped the weakest
available offline proxy and marked BOOT-06 "Complete" on a CI gate that has never
executed. Four regexes will not catch `local`, `echo -e`, `${var:offset:len}`,
`$'…'`, `function f()`, arrays, or `+=`.

**Fix:** add a `dash -n` (skip-free, throwing) case per tracked `*.sh` alongside
the regex, guarded by the same non-empty check the file already uses:

```ts
const DASH = "/usr/bin/dash"; // Git for Windows and every Linux runner ship it
for (const rel of shellScripts) {
	it(`${rel} parses under a real POSIX shell, not bash-in-posix-mode`, () => {
		const r = spawnSync(DASH, ["-n", join(ROOT, rel)], { encoding: "utf-8" });
		expect(r.error, `${DASH} unavailable — install dash rather than skipping`).toBeUndefined();
		expect(r.status, `${rel} is not POSIX sh:\n${r.stderr}`).toBe(0);
	});
}
```

### WR-08: `ci-pinning.test.ts` never checks that the tag comment matches the SHA

**Outcome: fixed** (`fd77007`) — both halves, and the offline half went further than suggested. Offline: the version-shaped-comment regex, *plus* an explicit `AUDITED_PINS` (action, SHA, tag) table asserted against the workflow, *plus* a check that every `uses:` has a table entry and every entry is still used, so a new unaudited action cannot slip in. Live cases prove the three shapes the old `/^#\s*\S+/` accepted (`# banana`, `# see below`, empty) now fail. Mutation-proven: restoring `# v5.0.0` turns exactly the setup-node row red. Online: a `pin-audit` step in `posix-lint` re-resolving every comment through `gh api repos/<o>/<r>/git/ref/tags/<tag>`, refusing a vacuous pass when it matches no lines. Its extraction and its negative control were both executed locally against the live API before shipping.

**File:** `tests/unit/ci-pinning.test.ts:188-195`

**Issue:** The assertion is `expect(comment).toMatch(/^#\s*\S+/)` — any non-empty
comment passes. `# v5.0.0` on a v7.0.0 commit satisfies it, which is how CR-03
shipped. The test's own stated purpose ("A bare SHA is unreviewable. The tag
comment is what lets a reader tell 'current' from 'two years stale'") is not
served by a check that accepts `# banana`.

**Fix:** the comparison needs the network, which this suite deliberately avoids —
so make the offline half stronger and put the online half where it belongs:

- offline: require the comment to look like a version ref,
  `expect(comment).toMatch(/^#\s*v?\d+(\.\d+)*(\s|$)/)`;
- online: add a `pin-audit` step to the `posix-lint` job that resolves each
  `uses:` comment through `gh api repos/<o>/<r>/git/ref/tags/<tag>` and fails on
  a mismatch. It has `GITHUB_TOKEN`, it already runs on Ubuntu, and it would have
  caught CR-03 on the first push.

### WR-09: `bin/bootstrap.sh` silently ignores every argument after the first

**Outcome: fixed** (`36612b0`). Applied to both tracked scripts. Verified: `--check-only --assert-hardening` → 2, `--check-only --chek-only` → 2, `--warn-only --oops` → 2, and every single valid invocation unchanged.

**File:** `bin/bootstrap.sh:513-534`; same shape in `scripts/check-gh-unauthenticated.sh:51-62`

**Issue:** `case "${1:-}" in` inspects `$1` only. `sh bin/bootstrap.sh
--check-only --assert-hardening` runs check-only and discards the second mode
with no diagnostic; `sh bin/bootstrap.sh --chek-only` correctly errors, but
`sh bin/bootstrap.sh --check-only --chek-only` does not. For a script whose
entire contract is *which* assertions ran, a silently-dropped mode flag is a
false report of what was checked.

**Fix:** reject extra operands in both scripts.

```sh
if [ "$#" -gt 1 ]; then
	printf 'FATAL: this script takes at most one mode argument; got %s: %s\n' "$#" "$*" >&2
	usage >&2
	exit 2
fi
```

### WR-10: the full bootstrap rewrites a tracked file, and two tests must undo it

**Outcome: fixed** (`813424e`) — a variant of the review's second option. `.env.example` stays tracked: `.gitignore` carries an explicit `!.env.example` negation for it, it is the file a reader of the repo looks for, and untracking would leave a fresh clone with no env template until bootstrap runs. `write_env_template` is *already* a no-op when the output would be byte-identical (the `readFileSync(dst) === out` guard), so while the two files agree a consumer's bootstrap writes nothing and their checkout stays clean — the hazard is divergence, not tracking. Closed that with an offline gate asserting the two managed regions match, carrying its own live case proving the comparison can fail. The integration tests' restore dance is left in place as belt-and-braces.

**File:** `bin/bootstrap.sh:379-419` (`write_env_template`, target `$REPO_ROOT/.env.example`)
**Also:** `tests/integration/npmrc-ordering.test.ts:189,258-266`, `tests/integration/bootstrap-check-only.test.ts:252,307-317`

**Issue:** `.env.example` is tracked (`git ls-files` confirms) and is generated by
every full run. Two integration tests must snapshot its bytes and restore them in
a `finally` for the suite to be worktree-safe — a tell that the design is
fighting the tests. If a run is killed between the write and the restore, or if
`.pi/templates/env.example` and `.env.example` ever diverge, a consumer's
`sh bin/bootstrap.sh` leaves their checkout dirty for a file they did not edit.
Today the two files are byte-identical, so nothing is observed.

**Fix:** either stop tracking `.env.example` (add it to `.gitignore`, drop it
from `MUST_BE_COMMITTABLE` in `gitignore-policy.test.ts:106`, and let bootstrap
own it as generated output), or make `write_env_template` a no-op when the
managed region already matches and remove the tracked copy from bootstrap's
responsibilities. Keeping a file both tracked and machine-generated is what
forces the restore dance.

### WR-11: case 4's provenance assertion in the `gh` suite is vacuous

**Outcome: fixed** (`468c674`) — took the delete option, and the review's repair option is rejected with reasoning recorded in the file. Always writing a logging stub would not make an empty log evidential either: the leak this is meant to catch is the **real** `gh`, and the real `gh` writes to no log, so `[]` stays consistent with the leak. Replaced with the pair that genuinely discriminates on a machine where `gh` *is* authenticated — the not-installed message specifically (rather than the substring `cannot upload`, which the authenticated branch also prints) plus the absence of `gh IS authenticated` on stderr. The removal is documented in place so a later reader does not re-add it thinking coverage went missing.

**File:** `tests/unit/gh-unauthenticated.test.ts:228`

**Issue:** `expect(run.ghCalls).toEqual([])` cannot fail. When
`ghExitCode === null` the stub map is `{}` (`:125`), so no `gh` stub is ever
written and no `logTo` is ever wired — the log file cannot exist, so `ghCalls` is
`[]` by construction whether or not the real `gh` ran. The comment above it
claims it proves "the narrowed PATH really was narrow"; it proves nothing. The
genuine control is the pair at `:222-223` (status 0 and `cannot upload`), which
would indeed go red if the real, authenticated `gh` leaked through.

**Fix:** either delete the line and the comment, or make it real by always
creating a logging stub and narrowing PATH to exclude it:

```ts
// Always wire a logging `gh`, then narrow PATH so it is NOT reachable.
// Now an empty log is evidence, not an artefact of never having a stub.
```

### WR-12: two divergent `quoteForWindows` implementations, one of them broken on trailing backslashes

**Outcome: fixed** (`ea62245`). Extracted to `tests/helpers/win-quote.ts` rather than exported from `pi.ts` as suggested — a dedicated module avoids `stub-bin.ts` having to import the `pi`-binary helper, which would couple the stub harness to the CLI wrapper. All four copies deleted and importing the shared one. The function no test exercised now has cases: plain passthrough, quoting on spaces and metacharacters, the trailing-backslash case that was the `stub-bin.ts` bug, embedded quotes with a preceding backslash run, and `commandFor`'s POSIX-vs-Windows shapes. The CRT argv rules it implements are documented in the module.

**File:** `tests/helpers/stub-bin.ts:217-219` vs `tests/helpers/pi.ts:64-69` (a third copy at `tests/unit/npmrc-policy.test.ts:79-84`, a fourth inline at `tests/integration/load-paths.test.ts:71`)

**Issue:** `pi.ts` does the careful thing —
`.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")` — while `stub-bin.ts`
does `arg.replace(/"/g, '\\"')` and nothing about trailing backslashes, so an
argument such as `C:\some dir\` becomes `"C:\some dir\"` and the closing quote is
escaped away. `load-paths.test.ts:71` is weaker still: bare `"${a}"` with no
escaping at all. All four are on the `shell: true` Windows path that Node's
DEP0190 warns about. Inputs are test-controlled today, so this is latent.

**Fix:** export the `pi.ts` implementation once and import it in the other three
call sites; delete the copies. Four hand-rolled quoters for one documented
Windows hazard is three too many.

## Info

### IN-01: `!.gitkeep` is a dead rule

**Outcome: fixed** (`d0d2aa5`). Deleted, and replaced with a note pointing at the `.pi/npm/*` + `!/.pi/npm/.npmrc` pair — the live example of that rule, which works only because the directory is excluded by contents rather than by name.

**File:** `.gitignore:31`
**Issue:** No preceding pattern matches `.gitkeep` (`logs/` and `*.log` do not),
and git cannot re-include a file inside an excluded directory anyway — so if the
intent was to keep `logs/.gitkeep`, it does not work. The rule has no effect
either way.
**Fix:** delete it, or move it to where it would matter and prove it with a row
in `gitignore-policy.test.ts`.

### IN-02: leftover `.gitkeep` placeholders in directories that now hold real files

**Outcome: fixed** (`ea62245`; attribution recorded in `d0d2aa5`). All six removed; the four genuinely-empty directories keep theirs. Confirmed nothing in `tests/`, `README.md` or `CONTRIBUTING.md` referenced any of them.

**File:** `bin/.gitkeep`, `scripts/.gitkeep`, `docs/.gitkeep`, `.github/workflows/.gitkeep`, `tests/integration/.gitkeep`, `.pi/extensions/.gitkeep`
**Issue:** All six directories now contain tracked content, so the placeholders
are dead. `.pi/extensions/.gitkeep` is the one worth watching: it is an extra
entry in a directory Pi walks with two different discovery paths.
**Fix:** remove the five that are certainly dead; keep only placeholders for
directories that are still genuinely empty (`.pi/skills`, `.pi/prompts`,
`.pi/themes`, `.pi/agents`).

### IN-03: CI runs twice on every pull-request branch

**Outcome: fixed** (`d0d2aa5`). Applied as suggested, with the zero-spend reasoning inline.

**File:** `.github/workflows/ci.yml:50-52`
**Issue:** Bare `on: push:` plus `pull_request:` means a PR from a branch in this
repo triggers both events. Harmless, but it doubles macOS minutes on a project
whose stated constraint is zero spend.
**Fix:** `on: { push: { branches: [main] }, pull_request: }`.

### IN-04: the `--ignore-scripts` workflow lint is text-matching over comments too

**Outcome: fixed** (`d0d2aa5`). Runs over a `withoutCommentLines()` view. Stripping comments makes the assertion weaker by construction, so three cases prove it did not go blind: an unflagged `run: npm ci` still matches, an inline trailing comment is still policy, and the prose that used to break it no longer does.

**File:** `tests/unit/ci-pinning.test.ts:292`
**Issue:** `expect(workflow).not.toMatch(/npm (ci|install)(?![^\n]*--ignore-scripts)/)`
scans the raw file, comments included. Any future explanatory comment mentioning
`npm install` without the flag on the same line turns the gate red for a
non-defect. `actionReferences`/`declaredShells` already strip comment lines; this
assertion does not.
**Fix:** run it over the comment-stripped text those helpers already produce.

### IN-05: the sentinel provider puts an unreachable model in the user's picker with no gate

**Outcome: partially fixed, deliberately** (`d0d2aa5`). The second half of the suggestion — a name that reads as diagnostic-only — is applied: the picker now shows `ky-pi-agent load-path sentinel (diagnostic only, not routable)`. The `id` is unchanged, so every load-path grep still matches (`load-paths.test.ts` 4/4). The first half, gating registration behind an env seam, is **not** applied and will not be: registering *is* the observation. `pi --list-models` on an untouched checkout is the entire BOOT-02/BOOT-05 proof, and the sentinel is also what a human looks for when running `RB-01-03` (`/reload` in a TTY). Gating it would mean the default run no longer demonstrates the load path — trading a cosmetic problem for a verification one. The file's LIFETIME note now records this decision, and Phase 3 removes the extension outright.

**File:** `.pi/extensions/harness/index.ts:55-83`
**Issue:** `ky-harness-selftest` points at `http://127.0.0.1:1/v1` and is
registered unconditionally, so it appears in `/model` for anyone who installs the
package. The file's own LIFETIME note (`:14-16`) flags this. Selecting it fails
with a connection error rather than anything explanatory.
**Fix:** gate registration behind an env seam the tests already set, e.g.
`if (process.env.KYPI_SELFTEST_PROVIDER === "1" || <always, until Phase 3>)`, and
give the model a name that reads as diagnostic-only in the picker.

### IN-06: `PI_CODING_AGENT_DIR` normalisation covers drive-letter paths only

**Outcome: fixed** (`36612b0`). Both remedies, not one: the leading-backslash case is added to the pattern, *and* any other backslash-bearing value with no forward slash is normalised — with the no-forward-slash condition guarding a genuine POSIX path that legally contains a backslash. Verified through the real script: `\\server\share\pi` → `//server/share/pi`, `C:\Users\Admin\nope` → `C:/Users/Admin/nope`, `/tmp/we\ird` left untouched.

**File:** `bin/bootstrap.sh:64-66`
**Issue:** The `case "$PI_AGENT_DIR" in [A-Za-z]:*)` guard converts backslashes
for `C:\…` but not for a UNC path (`\\server\share\pi`), which arrives with
backslashes and is then used verbatim in `mkdir -p` and `--prefix`. Roaming
profiles on Windows do land on UNC paths.
**Fix:** extend the case to `[A-Za-z]:* | //* | \\\\*)`, or normalise
unconditionally when the value contains a backslash and no forward slash.

---

_Reviewed: 2026-08-13T09:55:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

_Fixed: 2026-08-13T10:25:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Outcome: 21/21 resolved (20 fixed, 1 fixed-in-part by argued decision, 0 skipped) + 1 additional defect found and fixed. `npm test` 248/248, `npx tsc --noEmit` exit 0._
