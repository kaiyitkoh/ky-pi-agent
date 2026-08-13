#!/bin/sh
#
# ky-pi-agent cold-machine bootstrap.
#
# One script that takes a machine with Node and git on it to a machine that can
# run this harness safely. It hardens every npm scope Pi can reach, PROVES each
# one through npm itself, and only then installs anything.
#
# ---------------------------------------------------------------------------
# The ordering clause (BOOT-01) is the whole point
# ---------------------------------------------------------------------------
# "ignore-scripts=true precedes the first `pi install`. A pinning policy applied
# afterwards is applied to code that already ran."  A postinstall that has
# already executed cannot be un-executed by a control written a second later,
# and this machine holds live AWS SSO credentials. So the full run asserts, and
# refuses to continue, BEFORE it reaches the install step. That ordering is
# enforced structurally: see run_full() near the bottom, where every hardening
# call is written above the install call and the reason is stated inline.
#
# ---------------------------------------------------------------------------
# Portability rules this file obeys
# ---------------------------------------------------------------------------
#   * Strict POSIX sh. No arrays, no `local`, no bash double-bracket tests, no
#     bash-4 case-conversion expansions. The macOS CI runner is bash 3.2 with
#     BSD userland; `sh` is the only target that is the same language on both.
#   * No version-sort flag on `sort` - absent/inconsistent on BSD. Node
#     compares node, which is exact and needs no external tool.
#   * No external JSON processor - not installed here, and not worth a
#     dependency. All JSON is read/parsed/merged/written by `node -e`.
#     Never a stream editor on JSON; that is how settings files get corrupted.
#   * Never PowerShell. Windows runs this through Git Bash.
#   * LF line endings, enforced by .gitattributes (`*.sh text eol=lf`).
#
# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------
#   (no args)           full run: probe, verify, harden, install, configure
#   --check-only        every probe and repo-side assertion, mutates nothing,
#                       exits 0 on a clean CI runner. Deterministic stdout.
#                       NEEDS NETWORK: one of the probes is the published-pin
#                       preflight, which exits 1 when the registry is silent.
#   --assert-hardening  the three ignore-scripts assertions only, including the
#                       user scope. Exits 1 if any scope is ineffective. The
#                       offline-safe mode: it touches no network.
#   --check-version     the published-pin preflight only.
#   --help              this list.
#
# Test seams: PI_CODING_AGENT_DIR (Pi's own variable, src/config.ts:516-522),
# KYPI_PI_PINNED, KYPI_SKIP_INSTALL.
#
set -eu

PI_PKG="@earendil-works/pi-coding-agent"
PI_PINNED="${KYPI_PI_PINNED:-0.84.1}"
NODE_MIN="22.19.0"
BOOTSTRAP_VERSION="1"

# Resolve the repo from the script's own location so the script is correct from
# any cwd - including the `sh /abs/path/bin/bootstrap.sh` shape the tests use.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
# A Windows-style value (from a Node-launched test, say) arrives with
# backslashes. MSYS tools take C:/x happily and C:\x not at all, so normalise -
# but only for a drive-letter path, never for a genuine POSIX one.
# A UNC path (\\server\share\pi) arrives the same way and is NOT drive-lettered;
# Windows roaming profiles genuinely land on them. `//server/share/...` is the
# form MSYS accepts, and `tr` maps the leading pair too, which is what we want.
case "$PI_AGENT_DIR" in
[A-Za-z]:* | '\\'*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
*'\'*)
	# Any other value carrying a backslash and no forward slash is a Windows
	# path in some shape we did not enumerate. A genuine POSIX path may legally
	# contain a backslash, so the no-forward-slash condition is what keeps this
	# from corrupting one.
	case "$PI_AGENT_DIR" in
	*/*) : ;;
	*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
	esac
	;;
esac
PI_NPM_ROOT="$PI_AGENT_DIR/npm"
REPO_NPM_PREFIX="$REPO_ROOT/.pi/npm"

MISSING_REQUIRED=0

# ---------------------------------------------------------------------------
# Ask npm about files, not about the shell that launched us
# ---------------------------------------------------------------------------
# [VERIFIED: executed 2026-08-13, npm 11.13.0] `npm run` and `npx` export the
# fully resolved config into the child as npm_config_* variables, and npm ranks
# environment config ABOVE every .npmrc. Running this script through an npm
# script - or from a test suite launched by one - would therefore make every
# assertion below answer `true` for a directory containing no config at all.
# That is not a cosmetic false positive: it would certify a control that had
# never been exercised. Strip them, so npm answers from files only.
#
# Stripping is only half the job. The strip pattern matches valid shell
# identifiers only, because that is all `unset` accepts: npm also honours keys
# no POSIX shell can remove - npm_config_ignore-scripts (a hyphen),
# npm_config_//registry.npmjs.org/:_authToken (slashes and a colon). Under
# `dash` a special-builtin `unset` error kills the shell outright, `|| true`
# included [VERIFIED: executed 2026-08-13, dash rc=2], so `unset` cannot be the
# remedy for those names.
#
# It is TEMPTING to dismiss them as per-registry auth rather than policy keys.
# That is false, and it was a live false-certification: `@npmcli/config` matches
# /^npm_config_/i and only normalises `_`->`-` for non-nerf-darted keys, so
# `npm_config_ignore-scripts=true` arrives already in canonical form, outranks
# every .npmrc, and made `--assert-hardening` print "All npm scopes are
# hardened" for a directory containing no .npmrc at all
# [VERIFIED: executed 2026-08-13, npm 11.13.0].
#
# So the second pass REFUSES rather than strips. Any npm_config_* surviving the
# strip means no assertion below is about the files on disk, and a refusal is
# strictly better than a certificate we cannot back. The refusal is deliberately
# indiscriminate - it fires on an _authToken key too - because this script has
# no way to tell which surviving key npm will let outrank a file, and guessing
# is exactly the mistake that shipped. The remedy is a clean shell, which is
# always available.
#
# THE PREFIX MATCH IS CASE-INSENSITIVE, AND THAT IS LOAD-BEARING ON WINDOWS.
# [VERIFIED: executed 2026-08-13, vitest 4.1.9 / node 24.16.0] a Node test
# runner hands its children the SAME keys upper-cased - NPM_CONFIG_IGNORE_SCRIPTS
# rather than npm_config_ignore_scripts. Windows environment names are
# case-insensitive and npm lower-cases before reading, so the upper-case form is
# every bit as effective; a lower-case-only strip therefore leaves the override
# in place and the script certifies a control it never exercised. Written as
# explicit bracket classes rather than a `I`/`/i` flag: neither is POSIX, and
# the macOS runner is BSD sed.
sanitise_npm_env() {
	_keys=$(env | sed -n \
		's/^\([Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_[A-Za-z0-9_]*\)=.*/\1/p' || true)
	for _k in $_keys; do
		unset "$_k" || true
	done

	# Second pass: whatever is left, npm still honours and we cannot remove.
	# The class here is [^=] - every name, not just shell-legal ones - so a
	# hyphen, a slash or a colon is caught rather than silently skipped.
	_stuck=$(env | sed -n \
		's/^\([Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_[^=]*\)=.*/\1/p' || true)
	if [ -n "$_stuck" ]; then
		printf 'FATAL: npm configuration is being overridden by environment variables\n' >&2
		printf '       this script cannot unset, so no assertion below would be about\n' >&2
		printf '       the files on disk:\n' >&2
		printf '%s\n' "$_stuck" | sed 's/^/         /' >&2
		printf '       npm ranks environment config above every .npmrc, so certifying\n' >&2
		printf '       ignore-scripts here would certify the launcher, not the control.\n' >&2
		printf '       Remedy: start a clean shell (these names cannot be unset by any\n' >&2
		printf '       POSIX shell, so `unset` and `env -u` are both unavailable) and\n' >&2
		printf '       re-run. Do not run this script through `npm run` or `npx`.\n' >&2
		exit 1
	fi
}

# ---------------------------------------------------------------------------
# Probes
# ---------------------------------------------------------------------------

require_node() {
	if ! command -v node >/dev/null 2>&1; then
		printf 'FATAL: node not found on PATH. Install Node >= %s (required by %s).\n' \
			"$NODE_MIN" "$PI_PKG" >&2
		exit 1
	fi
	# Node compares node. Every sh version-comparison trick is either absent on
	# BSD or wrong on a two-digit component, and node is a hard prerequisite by
	# definition, so there is nothing to gain by doing this in the shell.
	node -e 'const v = process.versions.node;
const parts = v.split(".").map(Number);
if (parts[0] < 22 || (parts[0] === 22 && parts[1] < 19)) {
  console.error("FATAL: Node " + v + " < 22.19.0 required by @earendil-works/pi-coding-agent");
  console.error("       Install Node >= 22.19.0 and re-run.");
  process.exit(1);
}
console.log("  node " + v + " (>= 22.19.0 required)");' || exit 1
}

probe_one() {
	_name=$1
	_kind=$2
	if _found=$(command -v "$_name" 2>/dev/null); then
		printf '  %-8s %-8s %-8s %s\n' "$_name" "$_kind" "found" "$_found"
		return 0
	fi
	if [ "$_kind" = "required" ]; then
		printf '  %-8s %-8s %-8s %s\n' "$_name" "$_kind" "MISSING" "install it and re-run"
		MISSING_REQUIRED=$((MISSING_REQUIRED + 1))
	else
		printf '  %-8s %-8s %-8s %s\n' "$_name" "$_kind" "WARN" "not installed (optional)"
	fi
	return 0
}

# A missing optional tool warns and never aborts. `glab` in particular is absent
# on this machine and on both CI runners - GitLab work is Phase 4/9 and lives on
# the work laptop - so making it required would turn every green run red for a
# capability nothing in this phase uses.
probe_tools() {
	printf 'Tool probe:\n'
	printf '  %-8s %-8s %-8s %s\n' "TOOL" "KIND" "STATUS" "DETAIL"
	probe_one sh required
	probe_one git required
	probe_one node required
	probe_one npm required
	probe_one bash optional
	probe_one gh optional
	probe_one aws optional
	probe_one glab optional
	if [ "$MISSING_REQUIRED" -gt 0 ]; then
		printf 'FATAL: %s required tool(s) missing. Install them and re-run.\n' \
			"$MISSING_REQUIRED" >&2
		exit 1
	fi
}

# ---------------------------------------------------------------------------
# Published-pin preflight (BOOT-04)
# ---------------------------------------------------------------------------
# Earendil Works unpublishes old versions: 40 versions survive and the oldest is
# 0.74.0 [VERIFIED: npm registry, 2026-08-13]. A pin can therefore vanish under
# a machine that has not been bootstrapped in a while.
#
# The discrimination is on the literal E404 token in `npm view`'s JSON error
# output, NOT on the exit code - a network failure exits non-zero too, and a
# check that conflates them tells an offline user their pin was withdrawn. That
# is a worse failure than no check at all, because it sends them to edit a
# perfectly good pin.
check_pi_version_published() {
	_out=$(npm view "${PI_PKG}@${PI_PINNED}" version --json 2>/dev/null) && _rc=0 || _rc=$?
	if [ "$_rc" -eq 0 ] && [ -n "$_out" ] && [ "${_out#*error}" = "$_out" ]; then
		printf '  %s@%s is published on npm\n' "$PI_PKG" "$PI_PINNED"
		return 0
	fi
	case "$_out" in
	*E404*)
		_latest=$(npm view "$PI_PKG" version 2>/dev/null || echo "unknown")
		[ -n "$_latest" ] || _latest="unknown"
		cat >&2 <<EOF
FATAL: pinned Pi version ${PI_PINNED} is no longer published on npm.

  Package:           ${PI_PKG}
  Pinned:            ${PI_PKG}@${PI_PINNED}
  Latest on npm:     ${_latest}
  Oldest surviving:  run: npm view ${PI_PKG} versions --json

Earendil Works unpublishes old versions; everything below 0.74.0 is already gone.

Fallback:
  1. Set KYPI_PI_PINNED=${_latest}, or edit the PI_PINNED line in bin/bootstrap.sh
  2. Re-read the Pi CHANGELOG for breaking extension-API changes before trusting it
  3. Re-run: sh bin/bootstrap.sh
EOF
		exit 1
		;;
	*)
		# Deliberately says nothing about the pin being withdrawn. We do not
		# know, and guessing there is the bug the E404 split exists to avoid.
		#
		# It says nothing about the CAUSE either, for the same reason. Only E404
		# is discriminated above; everything else lands here - E403 (a proxy or
		# registry policy), E401/ENEEDAUTH (a scoped registry wanting
		# credentials), ETARGET, and a corporate mirror carrying the package but
		# not the version. "Check your network or proxy settings" is actionable
		# for one of those and misdirection for the rest, so report the token npm
		# actually produced and let the operator read it.
		printf 'WARN: could not verify %s@%s against the registry.\n' \
			"$PI_PKG" "$PI_PINNED" >&2
		if [ -n "$_out" ]; then
			printf '      npm said: %s\n' "$_out" >&2
		else
			printf '      npm produced no output; the registry did not answer.\n' >&2
		fi
		printf '      The pin itself was NOT checked. Look for E401/ENEEDAUTH (registry\n' >&2
		printf '      auth), E403 (proxy or policy), ETARGET (version absent from a\n' >&2
		printf '      mirror), or no output at all (network).\n' >&2
		exit 1
		;;
	esac
}

# ---------------------------------------------------------------------------
# Hardening (BOOT-01)
# ---------------------------------------------------------------------------
# Assert the EFFECT, through npm, never the existence of a file. RESEARCH 1.3
# proved in the field that a correctly-written .npmrc in a plausible location
# can still be ineffective, because npm resolves the project config from
# --prefix when one is given and from cwd otherwise, and Pi always passes
# --prefix on the npm path (package-manager.ts:1778).
#
# Arguments: <label> <cwd-or-empty> <prefix-or-empty>
assert_ignore_scripts_for() {
	_label=$1
	_acwd=$2
	_aprefix=$3

	if [ -n "$_aprefix" ]; then
		_got=$(npm config get ignore-scripts --prefix "$_aprefix" 2>/dev/null) || _got=""
	elif [ -n "$_acwd" ]; then
		_got=$(cd "$_acwd" && npm config get ignore-scripts 2>/dev/null) || _got=""
	else
		_got=$(npm config get ignore-scripts 2>/dev/null) || _got=""
	fi
	_got=$(printf '%s' "$_got" | tr -d ' \t\r\n')

	if [ "$_got" = "true" ]; then
		printf '  ignore-scripts=true  %s\n' "$_label"
		return 0
	fi

	printf 'FATAL: ignore-scripts is not enabled for %s (got: %s)\n' \
		"$_label" "${_got:-<no answer>}" >&2
	printf 'Refusing to run pi install: npm lifecycle scripts would execute before review.\n' >&2
	exit 1
}

# The two scopes a checkout can cover on its own: the developer's own
# `npm install` (cwd = repo root, which is also the cwd Pi uses for the
# `npm install --omit=dev` inside a clone of THIS repo), and project-scope
# `pi install -l`, whose prefix is <repo>/.pi/npm.
assert_repo_scopes() {
	assert_ignore_scripts_for "repo root ($REPO_ROOT)" "$REPO_ROOT" ""
	assert_ignore_scripts_for "project prefix ($REPO_NPM_PREFIX)" "" "$REPO_NPM_PREFIX"
}

assert_user_scope() {
	assert_ignore_scripts_for "user-scope prefix ($PI_NPM_ROOT)" "" "$PI_NPM_ROOT"
}

# The largest gap, and the one no committed file can close: `pi install npm:*`
# at user scope. Pi creates this directory itself (ensureNpmProject,
# package-manager.ts:1975-1986) and only ever creates files that are absent, so
# a .npmrc placed here survives.
#
# NEVER A WHOLE-FILE REWRITE, for the same reason merge_settings is careful
# below: this is a normal npm project config for the user-scope prefix, and a
# private registry, a proxy or a //registry.internal/:_authToken are all
# legitimate contents. Truncating it is credential destruction, not hardening.
# Only the `ignore-scripts` line is ours; everything else is the user's.
#
# Byte-idempotent: the repair branch leaves `ignore-scripts=true` in the file,
# so every later run takes the "already hardened" branch and writes nothing.
# Create the agent directory the way PI would, and never any looser.
#
# Pi creates it 0700 and the auth file 0600, but ONLY when they are absent:
#
#   pi 0.84.1 dist/core/auth-storage.js:21-31
#     ensureParentDir()  { if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 }); }
#     ensureFileExists() { if (!existsSync(this.authPath)) { writeFileSync(..., { mode: 0o600 }); ... } }
#
# So a plain `mkdir -p` gets there first, 0777 & ~umask lands 0755, and Pi's
# existence guard then short-circuits FOREVER. Pi re-chmods auth.json on every
# write, so the FILE is repaired at the first `pi auth login` - but the
# DIRECTORY MODE IS NEVER REPAIRED AT ALL. That directory holds auth.json,
# models.json and Pi's session transcripts, which .gitignore already describes
# as able to contain source code, prompts and secrets.
#
# CALLED FROM harden_pi_npm_root TOO, and that is the load-bearing call: it runs
# FIRST in a full run and `mkdir -p "$PI_AGENT_DIR/npm"` creates the parent as a
# side effect. Tightening only the three merge_* sites would leave the ordinary
# path creating the directory 0755 before any of them is reached.
#
# chmod is best-effort: on Windows it toggles the read-only bit and nothing
# else, which is why docs/RUNBOOK.md carries the Phase 1 note that 0600 is a
# no-op there. A failure to tighten is not a reason to abort a bootstrap.
ensure_agent_dir() {
	mkdir -p "$PI_AGENT_DIR"
	chmod 700 "$PI_AGENT_DIR" 2>/dev/null || true
}

harden_pi_npm_root() {
	# Before the npm root, so the PARENT is never created 0755 as a side effect.
	ensure_agent_dir
	mkdir -p "$PI_NPM_ROOT"
	_rc_file="$PI_NPM_ROOT/.npmrc"

	if [ ! -f "$_rc_file" ]; then
		{
			printf '%s\n' '# Written by ky-pi-agent bin/bootstrap.sh. See docs/RUNBOOK.md.'
			printf '%s\n' '#'
			printf '%s\n' '# Pi installs user-scope extension packages with'
			printf '%s\n' '#   npm install --prefix ~/.pi/agent/npm ...'
			printf '%s\n' '# and passes no --ignore-scripts on any code path'
			printf '%s\n' '# (pi 0.84.1 src/core/package-manager.ts:1750, :1778).'
			printf '%s\n' '#'
			printf '%s\n' '# npm resolves the project config from --prefix, not cwd, so NO file inside'
			printf '%s\n' '# the ky-pi-agent repo can cover this path. This one can.'
			printf '%s\n' 'ignore-scripts=true'
		} >"$_rc_file"
		printf '  wrote %s\n' "$_rc_file"
	elif grep -q '^ignore-scripts=true' "$_rc_file"; then
		printf '  %s already hardened\n' "$_rc_file"
	else
		# Back up FIRST, then rebuild from the backup: every line the user put
		# there is carried over, and only an existing (wrong) ignore-scripts
		# setting is dropped, because a later duplicate would not reliably win.
		# `|| true` on the grep: it exits 1 when the filtered result is empty,
		# which is a legitimate input (a one-line `ignore-scripts=false` file),
		# not an error, and `set -e` would otherwise abort mid-write.
		# THE BACKUP IS A DURABLE COPY OF A FILE THAT MAY HOLD A CREDENTIAL - the
		# comment above says so itself (a private registry, a proxy, a
		# //registry.internal/:_authToken). It is kept, because the rebuild below
		# is the only thing standing between the user and a hand-written npm
		# config, and a failed rebuild with no copy is unrecoverable. But it is
		# created 0600 BEFORE anything is written into it, and its existence is
		# reported as something to delete rather than as a courtesy.
		#
		# Overwriting rather than rotating is deliberate: the repair branch is
		# byte-idempotent, so a second repair only happens after the user edits the
		# file again, and the copy worth having is the current one.
		: >"$_rc_file.kypi-backup"
		chmod 600 "$_rc_file.kypi-backup" 2>/dev/null || true
		cat "$_rc_file" >"$_rc_file.kypi-backup"
		grep -v '^[[:space:]]*ignore-scripts[[:space:]]*=' "$_rc_file.kypi-backup" \
			>"$_rc_file" || true
		{
			printf '%s\n' '# Added by ky-pi-agent bin/bootstrap.sh. See docs/RUNBOOK.md.'
			printf '%s\n' 'ignore-scripts=true'
		} >>"$_rc_file"
		printf '  updated %s (ignore-scripts line added; every other line kept)\n' "$_rc_file"
		printf '  previous contents backed up at %s.kypi-backup (mode 0600)\n' "$_rc_file"
		printf '  DELETE THAT BACKUP once you have checked the result: an .npmrc may hold a\n'
		printf '  registry auth token, and this copy persists until you remove it.\n'
	fi

	assert_user_scope
}

# Non-fatal user-scope report for --check-only, which must exit 0 on a clean CI
# runner where bootstrap has never run. An absent control file is "not applied
# yet" and gets a remedy; a PRESENT file that npm still ignores is real
# breakage, and that is fatal in every mode.
report_user_scope() {
	if [ ! -f "$PI_NPM_ROOT/.npmrc" ]; then
		printf '  WARN user-scope npm hardening not applied: %s is absent\n' "$PI_NPM_ROOT/.npmrc"
		printf '       remedy: run bin/bootstrap.sh with no arguments to apply\n'
		return 0
	fi
	assert_user_scope
}

# ---------------------------------------------------------------------------
# Install and configure
# ---------------------------------------------------------------------------

# `npm ls` exits 1 for a global tree holding any extraneous, invalid or
# unmet-peer package - a very common state - while still printing perfectly good
# JSON on stdout. Discarding the output on a non-zero exit would therefore make
# this answer "not installed" on such a machine and re-run `npm install -g` on
# every single bootstrap, contradicting BOOT-03's "safe to re-run: every step is
# idempotent". Judge the JSON, not the exit code.
pi_global_matches_pin() {
	_ls=$(npm ls -g --depth=0 --json 2>/dev/null || true)
	[ -n "$_ls" ] || return 1
	printf '%s' "$_ls" | KYPI_Q_PKG="$PI_PKG" KYPI_Q_VER="$PI_PINNED" node -e '
const fs = require("node:fs");
let tree;
try { tree = JSON.parse(fs.readFileSync(0, "utf8")); } catch (e) { process.exit(1); }
const deps = (tree && tree.dependencies) || {};
const entry = deps[process.env.KYPI_Q_PKG];
process.exit(entry && entry.version === process.env.KYPI_Q_VER ? 0 : 1);
'
}

install_pi() {
	if [ "${KYPI_SKIP_INSTALL:-0}" = "1" ]; then
		printf '  skipped: KYPI_SKIP_INSTALL=1\n'
		return 0
	fi
	if pi_global_matches_pin; then
		printf '  %s@%s already installed globally - no action\n' "$PI_PKG" "$PI_PINNED"
		return 0
	fi
	printf '  installing %s@%s ...\n' "$PI_PKG" "$PI_PINNED"
	# --ignore-scripts mirrors Pi's own self-update shape (src/config.ts:170-177)
	# and is free here: the published package declares no postinstall.
	npm install -g --ignore-scripts "${PI_PKG}@${PI_PINNED}"
}

# Key-namespaced merge: read, parse, replace only the kyPiAgent key, write back.
# Never a whole-file rewrite - this file also holds the user's installed-package
# list and their own settings, and `pi remove <source>` is the documented undo
# for the part we do not own.
merge_settings() {
	ensure_agent_dir
	KYPI_SETTINGS="$PI_AGENT_DIR/settings.json" \
		KYPI_BOOTSTRAP_VERSION="$BOOTSTRAP_VERSION" \
		KYPI_HARDENED_NPM_ROOT="$PI_NPM_ROOT" \
		KYPI_PIN="$PI_PINNED" \
		node -e '
const fs = require("node:fs");
const p = process.env.KYPI_SETTINGS;
let raw = "{}";
if (fs.existsSync(p)) { raw = fs.readFileSync(p, "utf8").trim() || "{}"; }
let obj;
try { obj = JSON.parse(raw); } catch (e) {
  console.error("FATAL: " + p + " is not valid JSON (" + e.message + "). Refusing to touch it.");
  process.exit(1);
}
if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
  console.error("FATAL: " + p + " is not a JSON object. Refusing to touch it.");
  process.exit(1);
}
const next = {
  bootstrapVersion: process.env.KYPI_BOOTSTRAP_VERSION,
  hardenedNpmRoot: process.env.KYPI_HARDENED_NPM_ROOT,
  piPinned: process.env.KYPI_PIN,
};
if (JSON.stringify(obj.kyPiAgent) === JSON.stringify(next)) {
  console.log("  settings.json kyPiAgent already current - unchanged");
  process.exit(0);
}
obj.kyPiAgent = next;
fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
console.log("  settings.json kyPiAgent key merged");
'
}

# Marked-region copy. Replace only between the markers when the target exists,
# append the block when the markers are absent, create the whole file when the
# target is absent. Byte-identical on a second run.
write_env_template() {
	_src="$REPO_ROOT/.pi/templates/env.example"
	_dst="$REPO_ROOT/.env.example"
	if [ ! -f "$_src" ]; then
		printf 'FATAL: missing template %s\n' "$_src" >&2
		exit 1
	fi
	KYPI_ENV_SRC="$_src" KYPI_ENV_DST="$_dst" node -e '
const fs = require("node:fs");
const START = "# ky-pi-agent managed:start";
const END = "# ky-pi-agent managed:end";
const src = fs.readFileSync(process.env.KYPI_ENV_SRC, "utf8");
const s = src.indexOf(START);
const e = src.indexOf(END);
if (s < 0 || e < 0) {
  console.error("FATAL: template is missing its managed markers");
  process.exit(1);
}
// No trailing newline here. It used to be appended and then stripped again at
// the replacement site, which read as if the two paths handled trailing
// newlines differently when they do not. The append path adds it explicitly.
const block = src.slice(s, e + END.length);
const dst = process.env.KYPI_ENV_DST;
let out;
if (!fs.existsSync(dst)) {
  out = src;
} else {
  const cur = fs.readFileSync(dst, "utf8");
  const ds = cur.indexOf(START);
  const de = cur.indexOf(END);
  // ORDER, NOT MERELY PRESENCE. `ds >= 0 && de >= 0` was satisfied by a file
  // whose END marker sits ABOVE its START marker - a plausible outcome of a
  // manual merge or a copy-paste. The two slices then OVERLAP:
  // cur.slice(0, ds) still contains END, and cur.slice(de + END.length) still
  // contains START plus everything after it. The result is duplicated content
  // and duplicated markers, and it is NOT idempotent - every later bootstrap
  // run grows the file further. This is a tracked file in a public repo.
  if (ds >= 0 && de > ds) {
    out = cur.slice(0, ds) + block + cur.slice(de + END.length);
  } else if (ds >= 0 || de >= 0) {
    console.error("FATAL: " + dst + " has managed markers that are out of order or half present.");
    console.error("       Rewriting it would duplicate content and duplicate the markers, and the");
    console.error("       damage would compound on every later run. Fix the markers by hand so");
    console.error("       start precedes end, or delete the file and re-run to regenerate it.");
    process.exit(1);
  } else {
    out = cur.replace(/\n*$/, "\n") + "\n" + block + "\n";
  }
}
if (fs.existsSync(dst) && fs.readFileSync(dst, "utf8") === out) {
  console.log("  .env.example already current - unchanged");
  process.exit(0);
}
fs.writeFileSync(dst, out, "utf8");
console.log("  .env.example written from .pi/templates/env.example");
'
}

# ---------------------------------------------------------------------------
# Install the two config templates into the directory Pi actually reads
# ---------------------------------------------------------------------------
# Pi resolves models.json and auth.json from the AGENT DIRECTORY only -
# join(getAgentDir(), "models.json") [pi 0.84.1 dist/config.js:423-425], and
# ~/.pi/agent/auth.json [docs/providers.md:111]. There is no project-scope form
# of either, so the two files committed under .pi/templates/ are read by nothing
# until these two functions put them somewhere Pi looks.
#
# Both follow merge_settings above: read, parse with node, REFUSE to touch a
# target that is not valid JSON, replace only the key that is ours, and report
# "already current - unchanged" on a no-op so a second run is byte-identical.
#
# The two files get DIFFERENT merge semantics, on purpose:
#
#   models.json  key-namespaced REPLACE of providers.dashscope. That key is the
#                harness's own definition, exactly as settings.json's kyPiAgent
#                key is, and it must be updatable: the documented remedy when
#                RB-03-01 cannot resolve the shared host is "set
#                KYPI_DASHSCOPE_BASE_URL and re-run bootstrap", which a
#                write-only-when-absent rule would silently ignore. Every other
#                provider, model override and user edit in the file survives.
#
#   auth.json    per-key merge-if-ABSENT. This file may hold the user's live
#                credentials for every provider they have ever configured, and
#                clobbering it is the worst outcome in this phase. An existing
#                key is never modified, never merged into, never reordered.
#
# Neither belongs in --check-only (which mutates nothing) or in
# --assert-hardening (the ordering proof, which must need no network and no
# templates). Both run in run_full after install_pi: they configure Pi, they do
# not gate the BOOT-01 hardening ordering.
#
# NOTHING HERE WRITES A SECRET. Both templates carry $ENV_VAR references only.
#
# THAT IS NOT A REASON TO IGNORE FILE MODES, AND TREATING IT AS ONE WAS A BUG.
# This script does not write a secret, but it CREATES THE CONTAINER THE SECRETS
# WILL LIVE IN, and by creating it first it disables Pi's own control: Pi
# creates ~/.pi/agent 0700 and auth.json 0600 only when they are ABSENT
# (dist/core/auth-storage.js:21-31). Both creation sites therefore match Pi's
# modes - see ensure_agent_dir above and the explicit mode on the auth write
# below. The "0600 is a no-op on Windows" note in docs/RUNBOOK.md (Phase 1
# machine-state notes) is referenced rather than restated, and is why both are
# best-effort rather than fatal.
merge_models_json() {
	_src="$REPO_ROOT/.pi/templates/models-template.json"
	if [ ! -f "$_src" ]; then
		printf 'FATAL: missing template %s\n' "$_src" >&2
		exit 1
	fi
	ensure_agent_dir
	# Every value crosses into node through a KYPI_* variable, never through
	# shell interpolation into the JS source: a base URL is caller-supplied text
	# and would otherwise be a code-injection seam in this script.
	KYPI_MODELS_SRC="$_src" \
		KYPI_MODELS_DST="$PI_AGENT_DIR/models.json" \
		KYPI_DASHSCOPE_BASE_URL="${KYPI_DASHSCOPE_BASE_URL:-}" \
		node -e '
const fs = require("node:fs");
const src = process.env.KYPI_MODELS_SRC;
const dst = process.env.KYPI_MODELS_DST;

// The template carries whole-line // comments deliberately - models.json is
// comment-stripped by Pi (src/core/model-config.ts:261) and every number in it
// has to carry its source. JSON.parse does not accept them. The strip is
// WHOLE-LINE ONLY, which is what the template promises in its own header: a
// naive strip of every // would eat the https:// inside baseUrl.
let parsed;
try {
  parsed = JSON.parse(
    fs.readFileSync(src, "utf8")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n"),
  );
} catch (e) {
  console.error("FATAL: " + src + " is not valid JSON once whole-line // comments are removed (" + e.message + ").");
  process.exit(1);
}
const next = parsed && parsed.providers ? parsed.providers.dashscope : undefined;
if (next === null || typeof next !== "object" || Array.isArray(next)) {
  console.error("FATAL: " + src + " defines no providers.dashscope object. Refusing to guess what to install.");
  process.exit(1);
}
// The only value this installer transforms. The committed template carries the
// shared international host; the workspace-dedicated form names a workspace id,
// which must never enter a public repository, so it arrives here instead.
//
// VALIDATED, BECAUSE THE RUNBOOK TELLS OPERATORS TO TYPE IT UNDER PRESSURE.
// RB-03-01 makes setting this the first documented remedy, with a copy-paste
// one-liner. A value that lands as http:// - a typo, or a copied internal
// gateway - means Pi sends the resolved $DASHSCOPE_API_KEY as a cleartext
// Authorization: Bearer header on every request, with no signal anywhere:
// baseUrl is never interpolated and never validated by Pi either
// (provider-composer.ts:142). A value that is not a URL at all fails much
// later, inside the adapter, as an opaque fetch error.
const override = process.env.KYPI_DASHSCOPE_BASE_URL;
if (override) {
  let parsedUrl;
  try { parsedUrl = new URL(override); } catch (e) {
    console.error("FATAL: KYPI_DASHSCOPE_BASE_URL is not a parseable absolute URL: " + override);
    console.error("       Expected something like https://<workspace-id>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1");
    process.exit(1);
  }
  if (parsedUrl.protocol !== "https:") {
    console.error("FATAL: KYPI_DASHSCOPE_BASE_URL must be https. Got: " + override);
    console.error("       Pi sends the resolved $DASHSCOPE_API_KEY as a bearer token on every");
    console.error("       request, so an http:// endpoint puts the key on the wire in cleartext.");
    process.exit(1);
  }
  next.baseUrl = override;
}

let raw = "{}";
if (fs.existsSync(dst)) { raw = fs.readFileSync(dst, "utf8").trim() || "{}"; }
let obj;
try { obj = JSON.parse(raw); } catch (e) {
  console.error("FATAL: " + dst + " is not valid JSON (" + e.message + "). Refusing to touch it.");
  console.error("       Note Pi strips // comments from models.json and JSON.parse does not, so a");
  console.error("       commented file lands here too. Merge providers.dashscope by hand rather");
  console.error("       than letting this script rewrite the file without your comments.");
  process.exit(1);
}
if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
  console.error("FATAL: " + dst + " is not a JSON object. Refusing to touch it.");
  process.exit(1);
}
const providers = obj.providers;
if (providers !== undefined && (providers === null || typeof providers !== "object" || Array.isArray(providers))) {
  console.error("FATAL: " + dst + " has a providers key that is not a JSON object. Refusing to touch it.");
  process.exit(1);
}
if (providers !== undefined && JSON.stringify(providers.dashscope) === JSON.stringify(next)) {
  console.log("  models.json providers.dashscope already current - unchanged");
  process.exit(0);
}
obj.providers = providers === undefined ? {} : providers;
obj.providers.dashscope = next;
fs.writeFileSync(dst, JSON.stringify(obj, null, 2) + "\n", "utf8");
console.log("  models.json providers.dashscope key merged");
'
}

merge_auth_json() {
	_src="$REPO_ROOT/.pi/templates/auth-template.json"
	if [ ! -f "$_src" ]; then
		printf 'FATAL: missing template %s\n' "$_src" >&2
		exit 1
	fi
	ensure_agent_dir
	KYPI_AUTH_SRC="$_src" \
		KYPI_AUTH_DST="$PI_AGENT_DIR/auth.json" \
		node -e '
const fs = require("node:fs");
const src = process.env.KYPI_AUTH_SRC;
const dst = process.env.KYPI_AUTH_DST;

// No comment stripping here, in either direction: auth.json is read as strict
// JSON by Pi, so a template carrying a comment would already be broken and a
// destination carrying one is not a file this script may silently rewrite.
let tpl;
try { tpl = JSON.parse(fs.readFileSync(src, "utf8")); } catch (e) {
  console.error("FATAL: " + src + " is not valid JSON (" + e.message + ").");
  process.exit(1);
}
if (tpl === null || typeof tpl !== "object" || Array.isArray(tpl)) {
  console.error("FATAL: " + src + " is not a JSON object. Refusing to guess what to install.");
  process.exit(1);
}

let raw = "{}";
if (fs.existsSync(dst)) { raw = fs.readFileSync(dst, "utf8").trim() || "{}"; }
let obj;
try { obj = JSON.parse(raw); } catch (e) {
  console.error("FATAL: " + dst + " is not valid JSON (" + e.message + "). Refusing to touch it.");
  console.error("       This file holds credentials. A refusal is always better than a rewrite:");
  console.error("       fix the JSON by hand and re-run, or move it aside if it is disposable.");
  process.exit(1);
}
if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
  console.error("FATAL: " + dst + " is not a JSON object. Refusing to touch it.");
  process.exit(1);
}

// An entry still carrying an unedited REPLACE_WITH_ placeholder is NOT installed.
//
// This is not cosmetic. Pi resolves Bedrock as
//   credential?.env?.AWS_PROFILE ?? (await env("AWS_PROFILE"))
// [pi-ai 0.84.1 src/providers/amazon-bedrock.ts:65], i.e. the STORED value wins
// over the ambient one. Installing REPLACE_WITH_AWS_PROFILE_NAME on a laptop
// where `export AWS_PROFILE=work` already made Bedrock work therefore does not
// merely fail to help - it silently breaks a working machine, and every later
// request resolves a profile that does not exist. docs/RUNBOOK.md RB-03-03
// step 1 tells the operator to check `echo $AWS_PROFILE`, which is exactly the
// state this would have shadowed.
//
// Skipping leaves the ambient branch in Pi working, and leaves `pi auth login`
// free to write the real entry. The template still documents the SHAPE; it just
// stops being installed as though it were configuration.
//
// NO APOSTROPHE MAY APPEAR ANYWHERE IN THIS EMBEDDED SCRIPT, comments included:
// the whole block is a POSIX sh single-quoted string, so one apostrophe ends it
// and the rest is parsed as shell. `sh -n bin/bootstrap.sh` catches it, and
// tests/unit/lf-and-shell.test.ts runs that parse over every tracked *.sh.
const SENTINEL = "REPLACE_WITH_";
const carriesSentinel = (node) => {
  if (typeof node === "string") { return node.startsWith(SENTINEL); }
  if (Array.isArray(node)) { return node.some(carriesSentinel); }
  if (node !== null && typeof node === "object") { return Object.values(node).some(carriesSentinel); }
  return false;
};

// MERGE-IF-ABSENT, per provider key. An existing entry is left exactly as it
// was - not merged into, not normalised, not reordered. "Absent" means absent,
// never "absent or different": a dashscope entry holding the real key must
// survive a re-run untouched, and so must a provider this template never heard
// of. [threat T-03-06-01]
const added = [];
const skipped = [];
for (const key of Object.keys(tpl)) {
  if (Object.prototype.hasOwnProperty.call(obj, key)) { continue; }
  if (carriesSentinel(tpl[key])) { skipped.push(key); continue; }
  obj[key] = tpl[key];
  added.push(key);
}
if (skipped.length > 0) {
  console.log("  auth.json entries NOT installed (still hold a " + SENTINEL + " placeholder): " + skipped.join(", "));
  console.log("       installing one would SHADOW a working ambient value, so it is left out on purpose.");
  console.log("       Configure it with `pi auth login` (choose \"AWS profile\"), or add the entry to");
  console.log("       " + dst + " by hand. See RB-03-03 in docs/RUNBOOK.md.");
}
if (added.length === 0) {
  console.log("  auth.json already current - unchanged");
  process.exit(0);
}
// mode 0600 on CREATION, then an explicit chmod for the update case: `mode` is
// honoured by open(2) only when the file does not already exist, so a file this
// script created 0644 on an earlier run would keep that mode forever otherwise.
// Pi does exactly this pair (dist/core/auth-storage.js:26-30) and is right to:
// this is the file a credential is about to be written into.
fs.writeFileSync(dst, JSON.stringify(obj, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
try { fs.chmodSync(dst, 0o600); } catch (e) { /* Windows: toggles the read-only bit only */ }
console.log("  auth.json provider entries added: " + added.join(", "));
'
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

usage() {
	cat <<EOF
ky-pi-agent bootstrap - cold-machine setup for the Pi harness.

Usage: sh bin/bootstrap.sh [MODE]

Modes:
  (no arguments)      Full run. Probes tools, verifies the pinned Pi version is
                      still published, hardens and VERIFIES every npm scope,
                      then installs Pi, merges settings, writes .env.example and
                      installs the models.json / auth.json templates into the
                      agent directory. Safe to re-run: every step is idempotent.
  --check-only        Every probe and every repo-side assertion; mutates
                      nothing. Exits 0 on a clean CI runner. Deterministic
                      output, so two consecutive runs are byte-identical.
                      REQUIRES NETWORK: the published-pin preflight is one of
                      the probes and exits 1 if the registry does not answer.
  --assert-hardening  Only the three ignore-scripts assertions, including the
                      user scope. Exits 1 with ignore-scripts on stderr if any
                      scope is ineffective. This is the BOOT-01 ordering proof
                      and the runbook re-check, and it needs no network.
  --check-version     Only the published-pin preflight.
  --help              This message.

Environment:
  PI_CODING_AGENT_DIR  Pi's own agent-directory override (src/config.ts:516-522).
                       Defaults to \$HOME/.pi/agent. Redirect it to point every
                       user-scope path at a temp directory.
  KYPI_PI_PINNED       Override the pinned Pi version (default ${PI_PINNED}).
  KYPI_SKIP_INSTALL    Set to 1 to skip the global npm install step.
  KYPI_DASHSCOPE_BASE_URL
                       DashScope endpoint written into the installed models.json.
                       Set it to the workspace-dedicated regional form - a host
                       whose first label is your own workspace id - so that id
                       lives only in ~/.pi/agent/models.json and never in this
                       public repo. Unset uses the shared international host the
                       template carries. RB-03-01 in docs/RUNBOOK.md is the entry
                       that tells you when to set it.
EOF
}

run_check_version() {
	sanitise_npm_env
	check_pi_version_published
}

run_assert_hardening() {
	sanitise_npm_env
	printf 'Hardening assertions (ignore-scripts):\n'
	assert_repo_scopes
	assert_user_scope
	printf 'All npm scopes are hardened.\n'
}

run_check_only() {
	sanitise_npm_env
	printf 'ky-pi-agent bootstrap --check-only (no mutations)\n'
	printf 'Node:\n'
	require_node
	probe_tools
	printf 'Pinned Pi version:\n'
	check_pi_version_published
	printf 'Hardening assertions (ignore-scripts):\n'
	assert_repo_scopes
	report_user_scope
	printf 'check-only complete.\n'
}

# BOOT-01 ORDERING CLAUSE, ENFORCED HERE.
# Every hardening assertion, and the write that makes the user scope pass one,
# happen BEFORE install_pi. Do not reorder these lines: an install that has
# already run lifecycle scripts cannot be retroactively protected, and this is
# the only place in the harness where that ordering is expressible.
run_full() {
	sanitise_npm_env
	printf 'ky-pi-agent bootstrap\n'
	printf 'Node:\n'
	require_node
	probe_tools
	printf 'Pinned Pi version:\n'
	check_pi_version_published
	printf 'Hardening (ignore-scripts) - must all pass before any install:\n'
	assert_repo_scopes
	harden_pi_npm_root

	printf 'Pi install:\n'
	install_pi
	printf 'Configuration:\n'
	merge_settings
	write_env_template
	merge_models_json
	merge_auth_json

	printf 'Summary:\n'
	printf '  repo root          %s\n' "$REPO_ROOT"
	printf '  pi agent dir       %s\n' "$PI_AGENT_DIR"
	printf '  pinned Pi          %s@%s\n' "$PI_PKG" "$PI_PINNED"
	printf '  hardened scopes    repo root, %s, %s\n' "$REPO_NPM_PREFIX" "$PI_NPM_ROOT"
	printf 'Bootstrap complete. Re-check any time with: sh bin/bootstrap.sh --assert-hardening\n'
}

# `case "${1:-}"` inspects $1 only, so every later operand would be silently
# discarded: `--check-only --assert-hardening` would run check-only and drop the
# ordering proof without a word, and `--check-only --chek-only` would not even
# catch the typo the single-argument form does. This script's entire contract is
# WHICH assertions ran, so a dropped mode flag is a false report of what was
# checked, not a convenience.
if [ "$#" -gt 1 ]; then
	printf 'FATAL: this script takes at most one mode argument; got %s: %s\n' "$#" "$*" >&2
	usage >&2
	exit 2
fi

case "${1:-}" in
"")
	run_full
	;;
--check-only)
	run_check_only
	;;
--assert-hardening)
	run_assert_hardening
	;;
--check-version)
	run_check_version
	;;
--help | -h)
	usage
	;;
*)
	printf 'FATAL: unknown argument: %s\n' "$1" >&2
	usage >&2
	exit 2
	;;
esac
