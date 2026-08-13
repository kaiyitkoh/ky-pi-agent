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
#   --assert-hardening  the three ignore-scripts assertions only, including the
#                       user scope. Exits 1 if any scope is ineffective.
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
case "$PI_AGENT_DIR" in
	[A-Za-z]:*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
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
		# Deliberately says nothing about the pin being withdrawn. The registry
		# did not answer, so we do not know, and guessing here is the bug.
		printf 'WARN: could not reach the npm registry to verify %s@%s.\n' \
			"$PI_PKG" "$PI_PINNED" >&2
		printf '      The registry did not answer; the pin itself was not checked.\n' >&2
		printf '      Check your network or proxy settings and re-run.\n' >&2
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
harden_pi_npm_root() {
	mkdir -p "$PI_NPM_ROOT"
	_rc_file="$PI_NPM_ROOT/.npmrc"
	if [ ! -f "$_rc_file" ] || ! grep -q '^ignore-scripts=true' "$_rc_file"; then
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
	else
		printf '  %s already hardened\n' "$_rc_file"
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

pi_global_matches_pin() {
	_ls=$(npm ls -g --depth=0 --json 2>/dev/null) || _ls=""
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
	mkdir -p "$PI_AGENT_DIR"
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
const block = src.slice(s, e + END.length) + "\n";
const dst = process.env.KYPI_ENV_DST;
let out;
if (!fs.existsSync(dst)) {
  out = src;
} else {
  const cur = fs.readFileSync(dst, "utf8");
  const ds = cur.indexOf(START);
  const de = cur.indexOf(END);
  if (ds >= 0 && de >= 0) {
    out = cur.slice(0, ds) + block.replace(/\n$/, "") + cur.slice(de + END.length);
  } else {
    out = cur.replace(/\n*$/, "\n") + "\n" + block;
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
# Modes
# ---------------------------------------------------------------------------

usage() {
	cat <<EOF
ky-pi-agent bootstrap - cold-machine setup for the Pi harness.

Usage: sh bin/bootstrap.sh [MODE]

Modes:
  (no arguments)      Full run. Probes tools, verifies the pinned Pi version is
                      still published, hardens and VERIFIES every npm scope,
                      then installs Pi, merges settings and writes .env.example.
                      Safe to re-run: every step is idempotent.
  --check-only        Every probe and every repo-side assertion; mutates
                      nothing. Exits 0 on a clean CI runner. Deterministic
                      output, so two consecutive runs are byte-identical.
  --assert-hardening  Only the three ignore-scripts assertions, including the
                      user scope. Exits 1 with ignore-scripts on stderr if any
                      scope is ineffective. This is the BOOT-01 ordering proof
                      and the runbook re-check.
  --check-version     Only the published-pin preflight.
  --help              This message.

Environment:
  PI_CODING_AGENT_DIR  Pi's own agent-directory override (src/config.ts:516-522).
                       Defaults to \$HOME/.pi/agent. Redirect it to point every
                       user-scope path at a temp directory.
  KYPI_PI_PINNED       Override the pinned Pi version (default ${PI_PINNED}).
  KYPI_SKIP_INSTALL    Set to 1 to skip the global npm install step.
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

	printf 'Summary:\n'
	printf '  repo root          %s\n' "$REPO_ROOT"
	printf '  pi agent dir       %s\n' "$PI_AGENT_DIR"
	printf '  pinned Pi          %s@%s\n' "$PI_PKG" "$PI_PINNED"
	printf '  hardened scopes    repo root, %s, %s\n' "$REPO_NPM_PREFIX" "$PI_NPM_ROOT"
	printf 'Bootstrap complete. Re-check any time with: sh bin/bootstrap.sh --assert-hardening\n'
}

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
