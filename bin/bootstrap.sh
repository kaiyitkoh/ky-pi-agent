#!/bin/sh
#
# ky-pi-agent cold-machine bootstrap: takes a machine with Node and git to one
# that can run this harness safely. It hardens every npm scope Pi can reach,
# proves each one through npm itself, and only then installs. docs/RUNBOOK.md.
#
# Ordering rule: ignore-scripts=true must be in force before the first install;
# a postinstall that already ran cannot be undone.
#
# Strict POSIX sh, LF endings. Every JSON read and write is in bin/bootstrap.mjs.
# Modes and environment: see usage() below.
#
set -eu

PI_PKG="@earendil-works/pi-coding-agent"
PI_PINNED="${KYPI_PI_PINNED:-1.1.0}"
NODE_MIN="22.19.0"
BOOTSTRAP_VERSION="1"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
# MSYS tools accept C:/x and reject C:\x, so a drive-letter or UNC value from a
# Node-launched caller is normalised. A POSIX path may legally hold a backslash,
# hence the no-forward-slash condition on the catch-all arm.
# shellcheck disable=SC1003 # '\\' and '\' are literal backslashes, not escaped quotes
case "$PI_AGENT_DIR" in
[A-Za-z]:* | '\\'*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
*/*) ;;
*'\'*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
esac
PI_NPM_ROOT="$PI_AGENT_DIR/npm"
REPO_NPM_PREFIX="$REPO_ROOT/.pi/npm"
STUB="$PI_AGENT_DIR/extensions/ky-safety/index.ts"
SUBAGENT_CONFIG="$PI_AGENT_DIR/extensions/subagent/config.json"
REMEDY='       remedy: run bin/bootstrap.sh with no arguments to apply'

MISSING_REQUIRED=0

steps() {
	KYPI_REPO_ROOT="$REPO_ROOT" KYPI_AGENT_DIR="$PI_AGENT_DIR" KYPI_PI_PKG="$PI_PKG" \
		KYPI_PI_PIN="$PI_PINNED" KYPI_BOOTSTRAP_VERSION="$BOOTSTRAP_VERSION" \
		node "$SCRIPT_DIR/bootstrap.mjs" "$@"
}

die() {
	printf 'FATAL: %s\n' "$1" >&2
	exit 1
}

need_file() {
	[ -f "$2" ] || die "missing $1$2"
}

install_skipped() {
	[ "${KYPI_SKIP_INSTALL:-0}" = "1" ] || return 1
	printf '  skipped: KYPI_SKIP_INSTALL=1\n'
}

# Absent is "not applied yet" (check-only must pass on a clean runner).
warn_absent() {
	printf '  WARN %s: %s is absent\n%s\n' "$1" "$2" "$REMEDY"
}

# Pi creates the agent dir 0700 only when absent, so a plain `mkdir -p` would
# leave it 0755 (pi dist/core/auth-storage.js). chmod is best-effort on Windows.
ensure_agent_dir() {
	mkdir -p "$PI_AGENT_DIR"
	chmod 700 "$PI_AGENT_DIR" 2>/dev/null || true
}

# npm ranks npm_config_* environment variables above every .npmrc, so an
# inherited one makes each assertion answer about the launcher, not the files.
# Valid shell names are unset; a name no POSIX shell can unset
# (npm_config_ignore-scripts) is refused: certifying a control we did not
# exercise is worse than stopping. bash passes such names on; dash drops them.
# Case-insensitive because Windows hands children NPM_CONFIG_*; bracket classes
# because a sed `I` flag is not POSIX.
sanitise_npm_env() {
	_keys=$(env | sed -n 's/^\([Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_[A-Za-z0-9_]*\)=.*/\1/p' || true)
	for _k in $_keys; do
		unset "$_k" || true
	done
	_stuck=$(env | sed -n 's/^\([Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_[^=]*\)=.*/\1/p' || true)
	[ -n "$_stuck" ] || return 0
	{
		printf 'FATAL: npm configuration is being overridden by environment variables\n'
		printf '       this script cannot unset, so no assertion below would be about\n'
		printf '       the files on disk:\n'
		printf '%s\n' "$_stuck" | sed 's/^/         /'
		cat <<'EOF'
       npm ranks environment config above every .npmrc, so certifying
       ignore-scripts here would certify the launcher, not the control.
       Remedy: start a clean shell (these names cannot be unset by any
       POSIX shell, so `unset` and `env -u` are both unavailable) and
       re-run. Do not run this script through `npm run` or `npx`.
EOF
	} >&2
	exit 1
}

require_node() {
	command -v node >/dev/null 2>&1 ||
		die "node not found on PATH. Install Node >= $NODE_MIN (required by $PI_PKG)."
	node -e 'const v = process.versions.node;
const [major, minor] = v.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  console.error("FATAL: Node " + v + " < 22.19.0 required by @earendil-works/pi-coding-agent");
  console.error("       Install Node >= 22.19.0 and re-run.");
  process.exit(1);
}
console.log("  node " + v + " (>= 22.19.0 required)");' || exit 1
}

probe_one() {
	if _found=$(command -v "$1" 2>/dev/null); then
		_status=found
	elif [ "$2" = "required" ]; then
		_status=MISSING _found="install it and re-run"
		MISSING_REQUIRED=$((MISSING_REQUIRED + 1))
	else
		_status=WARN _found="not installed (optional)"
	fi
	printf '  %-8s %-8s %-8s %s\n' "$1" "$2" "$_status" "$_found"
}

# A missing optional tool warns and never aborts: glab is absent on CI.
probe_tools() {
	printf 'Tool probe:\n'
	printf '  %-8s %-8s %-8s %s\n' "TOOL" "KIND" "STATUS" "DETAIL"
	for _tool in sh git node npm; do probe_one "$_tool" required; done
	for _tool in bash gh aws glab; do probe_one "$_tool" optional; done
	[ "$MISSING_REQUIRED" -eq 0 ] ||
		die "$MISSING_REQUIRED required tool(s) missing. Install them and re-run."
}

# Earendil Works unpublishes old versions, so a pin can vanish. The split is on
# the literal E404 token in npm's JSON error, not the exit code: a network
# failure exits non-zero too, and calling that "withdrawn" sends an offline
# user to edit a good pin.
check_pi_version_published() {
	_out=$(npm view "${PI_PKG}@${PI_PINNED}" version --json 2>/dev/null) && _rc=0 || _rc=$?
	if [ "$_rc" -eq 0 ] && [ -n "$_out" ] && [ "${_out#*error}" = "$_out" ]; then
		printf '  %s@%s is published on npm\n' "$PI_PKG" "$PI_PINNED"
		return 0
	fi
	case "$_out" in
	*E404*)
		_latest=$(npm view "$PI_PKG" version 2>/dev/null || true)
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
		;;
	*)
		# E401, E403, ETARGET and network failures all land here, so the message
		# reports what npm said and guesses nothing.
		{
			printf 'WARN: could not verify %s@%s against the registry.\n' "$PI_PKG" "$PI_PINNED"
			if [ -n "$_out" ]; then
				printf '      npm said: %s\n' "$_out"
			else
				printf '      npm produced no output; the registry did not answer.\n'
			fi
			printf '      The pin itself was NOT checked. Look for E401/ENEEDAUTH (registry\n'
			printf '      auth), E403 (proxy or policy), ETARGET (version absent from a\n'
			printf '      mirror), or no output at all (network).\n'
		} >&2
		;;
	esac
	exit 1
}

# Assert the effect through npm, never the existence of a file: npm resolves the
# project config from --prefix when given, and Pi always passes --prefix.
# Arguments: <label> <cwd-or-empty> <prefix-or-empty>
assert_ignore_scripts_for() {
	if [ -n "$3" ]; then
		_got=$(npm config get ignore-scripts --prefix "$3" 2>/dev/null) || _got=""
	else
		_got=$(cd "${2:-.}" && npm config get ignore-scripts 2>/dev/null) || _got=""
	fi
	_got=$(printf '%s' "$_got" | tr -d ' \t\r\n')
	if [ "$_got" = "true" ]; then
		printf '  ignore-scripts=true  %s\n' "$1"
		return 0
	fi
	printf 'FATAL: ignore-scripts is not enabled for %s (got: %s)\n' "$1" "${_got:-<no answer>}" >&2
	printf 'Refusing to run pi install: npm lifecycle scripts would execute before review.\n' >&2
	exit 1
}

# The developer's own `npm install` (cwd = repo root) and `pi install -l`.
assert_repo_scopes() {
	assert_ignore_scripts_for "repo root ($REPO_ROOT)" "$REPO_ROOT" ""
	assert_ignore_scripts_for "project prefix ($REPO_NPM_PREFIX)" "" "$REPO_NPM_PREFIX"
}

assert_user_scope() {
	assert_ignore_scripts_for "user-scope prefix ($PI_NPM_ROOT)" "" "$PI_NPM_ROOT"
}

# `pi install npm:*` at user scope is the gap no committed file can close. Only
# the ignore-scripts line is ours; a registry or auth token already in this
# .npmrc is the user's and must survive.
harden_pi_npm_root() {
	ensure_agent_dir
	mkdir -p "$PI_NPM_ROOT"
	_rc_file="$PI_NPM_ROOT/.npmrc"
	if [ ! -f "$_rc_file" ]; then
		cat >"$_rc_file" <<'EOF'
# Written by ky-pi-agent bin/bootstrap.sh. See docs/RUNBOOK.md.
#
# Pi installs user-scope extension packages with
#   npm install --prefix ~/.pi/agent/npm ...
# and passes no --ignore-scripts on any code path.
#
# npm resolves the project config from --prefix, not cwd, so NO file inside
# the ky-pi-agent repo can cover this path. This one can.
ignore-scripts=true
EOF
		printf '  wrote %s\n' "$_rc_file"
	elif grep -q '^ignore-scripts=true' "$_rc_file"; then
		printf '  %s already hardened\n' "$_rc_file"
	else
		# The 0600 backup is written first and kept: the file may hold a registry
		# token. grep exit 1 (empty result) is legitimate; 2 aborts, backup intact.
		: >"$_rc_file.kypi-backup"
		chmod 600 "$_rc_file.kypi-backup" 2>/dev/null || true
		cat "$_rc_file" >"$_rc_file.kypi-backup"
		grep -v '^[[:space:]]*ignore-scripts[[:space:]]*=' "$_rc_file.kypi-backup" \
			>"$_rc_file" || [ "$?" -eq 1 ]
		printf '%s\n' '# Added by ky-pi-agent bin/bootstrap.sh. See docs/RUNBOOK.md.' \
			'ignore-scripts=true' >>"$_rc_file"
		printf '  updated %s (ignore-scripts line added; every other line kept)\n' "$_rc_file"
		printf '  previous contents backed up at %s.kypi-backup (mode 0600)\n' "$_rc_file"
		printf '  DELETE THAT BACKUP once you have checked the result: an .npmrc may hold a\n'
		printf '  registry auth token, and this copy persists until you remove it.\n'
	fi
	assert_user_scope
}

# Present but ineffective is real breakage and always fatal.
report_user_scope() {
	if [ -f "$PI_NPM_ROOT/.npmrc" ]; then
		assert_user_scope
	else
		warn_absent "user-scope npm hardening not applied" "$PI_NPM_ROOT/.npmrc"
	fi
}

# The stub imports this checkout's guard, which imports unbash from here; with no
# node_modules every tool call is blocked. Succeeds when every pin is installed;
# otherwise leaves the problems in _problems, and exits on an unreadable manifest.
checkout_deps_current() {
	_problems=$(steps checkout-deps) && _rc=0 || _rc=$?
	if [ "$_rc" -ne 0 ] && [ "$_rc" -ne 3 ]; then
		printf '%s\n' "$_problems" >&2
		exit 1
	fi
	[ "$_rc" -eq 0 ]
}

# npm ci rather than npm install: the lockfile is the reviewed tree, and the repo
# .npmrc (ignore-scripts, asserted first) applies because cwd is the root.
install_checkout_deps() {
	install_skipped && return 0
	if checkout_deps_current; then
		printf '  every dependency in package.json is installed at its pin - no action\n'
		return 0
	fi
	printf '%s\n' "$_problems" | sed 's/^/  /'
	printf '  npm ci deletes node_modules first: close every Pi session, or a held file\n'
	printf '  leaves it half-deleted and Pi cannot start in any repository\n'
	printf '  npm ci --ignore-scripts (in %s) ...\n' "$REPO_ROOT"
	if ! (cd "$REPO_ROOT" && npm ci --ignore-scripts); then
		printf 'FATAL: npm ci failed in %s.\n' "$REPO_ROOT" >&2
		printf '       On Windows, close every Pi session first: Pi holds files open (EBUSY/EPERM).\n' >&2
		printf '       Until a re-run succeeds, Pi cannot load the harness. Re-run: sh bin/bootstrap.sh\n' >&2
		exit 1
	fi
}

report_checkout_deps() {
	if checkout_deps_current; then
		printf '  every dependency in package.json is installed at its pin\n'
		return 0
	fi
	printf '%s\n' "$_problems" | sed 's/^/  WARN /'
	printf '       the stub blocks every tool call and the harness package fails to load,\n'
	printf '       so Pi exits at start in every repository\n%s\n' "$REMEDY"
}

# `npm ls -g` exits 1 for an extraneous or unmet-peer tree while still printing
# valid JSON, so the JSON is judged and the exit code is not.
install_pi() {
	install_skipped && return 0
	if npm ls -g --depth=0 --json 2>/dev/null | steps pi-global-matches; then
		printf '  %s@%s already installed globally - no action\n' "$PI_PKG" "$PI_PINNED"
		return 0
	fi
	printf '  installing %s@%s ...\n' "$PI_PKG" "$PI_PINNED"
	# The published package declares no postinstall, so --ignore-scripts is free.
	npm install -g --ignore-scripts "${PI_PKG}@${PI_PINNED}"
}

# The composed packages, disables and theme come from the committed
# .pi/settings.json, the one source of truth; the merge is additive.
merge_settings() {
	need_file "" "$REPO_ROOT/.pi/settings.json"
	ensure_agent_dir
	steps settings
}

# This checkout as a user-level package carries the harness commands into every
# repo. Skipped when a git package of this repo delivers the harness, when an
# entry for this checkout exists, or when kyPiAgent.harnessPackage is false.
merge_harness_package() {
	ensure_agent_dir
	steps harness-package
}

# Byte-compared so a second run writes nothing. A user theme of the same name is
# replaced: the file is the harness's own.
install_theme() {
	_theme_src="$REPO_ROOT/.pi/themes/ky.json"
	_theme_dst="$PI_AGENT_DIR/themes/ky.json"
	need_file "theme " "$_theme_src"
	ensure_agent_dir
	mkdir -p "$PI_AGENT_DIR/themes"
	if [ -f "$_theme_dst" ] && cmp -s "$_theme_src" "$_theme_dst"; then
		printf '  %s already current - unchanged\n' "$_theme_dst"
		return 0
	fi
	cp "$_theme_src" "$_theme_dst.tmp-$$"
	mv "$_theme_dst.tmp-$$" "$_theme_dst"
	printf '  wrote %s\n' "$_theme_dst"
}

# One `pi install npm:<name>@<exact>` per pinned package, user scope.
install_composed_packages() {
	install_skipped && return 0
	command -v pi >/dev/null 2>&1 ||
		die "pi not found on PATH, so the composed packages cannot be installed."
	_specs=$(steps composed-specs)
	for _spec in $_specs; do
		printf '  pi install %s\n' "$_spec"
		pi install "$_spec"
	done
}

write_env_template() {
	need_file "template " "$REPO_ROOT/.pi/templates/env.example"
	steps env-template
}

# Pi reads models.json and auth.json from the agent directory only
# (pi dist/config.js), so the committed templates are inert until installed.
# Neither writes a secret: the templates hold $ENV_VAR references only.
merge_models_json() {
	need_file "template " "$REPO_ROOT/.pi/templates/models-template.json"
	ensure_agent_dir
	steps models-json
}

merge_auth_json() {
	need_file "template " "$REPO_ROOT/.pi/templates/auth-template.json"
	ensure_agent_dir
	steps auth-json
}

merge_subagent_config() {
	ensure_agent_dir
	mkdir -p "$PI_AGENT_DIR/extensions/subagent"
	steps subagent-config
}

# The stub loads the guard regardless of project trust and blocks every tool
# call when it cannot; docs/RUNBOOK.md, "The user-scope safety stub", says why.
install_safety_extension() {
	need_file "safety extension entry point " "$REPO_ROOT/.pi/extensions/safety/index.ts"
	ensure_agent_dir
	mkdir -p "$PI_AGENT_DIR/extensions/ky-safety"
	steps write-stub
}

report_safety_extension() {
	if [ -f "$STUB" ]; then
		steps report-stub
	else
		warn_absent "user-scope safety extension not installed" "$STUB"
	fi
}

report_subagent_config() {
	if [ -f "$SUBAGENT_CONFIG" ]; then
		steps report-subagent-config
	else
		warn_absent "worktree setup hook not wired" "$SUBAGENT_CONFIG"
	fi
}

usage() {
	cat <<EOF
ky-pi-agent bootstrap - cold-machine setup for the Pi harness.

Usage: sh bin/bootstrap.sh [MODE]

Modes:
  (no arguments)      Full run. Probes tools, verifies the pinned Pi version is
                      still published, hardens and VERIFIES every npm scope,
                      then installs this checkout's own dependencies (npm ci
                      from the lockfile), installs Pi, merges user settings
                      (composed packages, builtin disables, theme, agent scan
                      dir), installs the ky
                      theme and the composed packages, writes .env.example,
                      installs the models.json / auth.json templates, installs
                      the safety extension at user scope, then adds this
                      checkout as the harness package with the safety
                      extension filtered out, and wires the worktree
                      setup hook into pi-subagents' own config file. Safe to
                      re-run: every step is idempotent.
  --global-setup      Asserts the ignore-scripts scopes and that the safety
                      guard reaches every repo (a current stub from a full
                      run, or the git package), then installs this checkout's
                      dependencies, merges user settings, installs the theme
                      and installs the pinned composed packages, then adds
                      the harness package. Touches no credential, model, env
                      or safety-stub file.
  --check-only        Every probe and every repo-side assertion; mutates
                      nothing. Exits 0 on a clean CI runner. Deterministic
                      output, so two consecutive runs are byte-identical.
                      REQUIRES NETWORK: the published-pin preflight is one of
                      the probes and exits 1 if the registry does not answer.
  --assert-hardening  Only the ignore-scripts assertions, including the user
                      scope. Exits 1 with ignore-scripts on stderr if any
                      scope is ineffective. Needs no network.
  --check-version     Only the published-pin preflight.
  --help              This message.

Environment:
  PI_CODING_AGENT_DIR  Pi's own agent-directory override (src/config.ts:516-522).
                       Defaults to \$HOME/.pi/agent. Redirect it to point every
                       user-scope path at a temp directory.
  KYPI_PI_PINNED       Override the pinned Pi version (default ${PI_PINNED}).
  KYPI_SKIP_INSTALL    Set to 1 to skip every npm and pi install step,
                       npm ci in this checkout included.
  KYPI_DASHSCOPE_BASE_URL
                       DashScope endpoint written into the installed models.json.
                       Set it to the workspace-dedicated regional form - a host
                       whose first label is your own workspace id - so that id
                       lives only in ~/.pi/agent/models.json and never in this
                       public repo. Unset keeps an https endpoint already
                       installed, else uses the shared international host
                       the template carries. RB-03-01 in docs/RUNBOOK.md is the entry
                       that tells you when to set it.
EOF
}

run_assert_hardening() {
	printf 'Hardening assertions (ignore-scripts):\n'
	assert_repo_scopes
	assert_user_scope
	printf 'All npm scopes are hardened.\n'
}

run_check_only() {
	printf 'ky-pi-agent bootstrap --check-only (no mutations)\n'
	printf 'Node:\n'
	require_node
	probe_tools
	printf 'Pinned Pi version:\n'
	check_pi_version_published
	printf 'Hardening assertions (ignore-scripts):\n'
	assert_repo_scopes
	report_user_scope
	printf 'Checkout dependencies:\n'
	report_checkout_deps
	printf 'Safety extension (user scope):\n'
	report_safety_extension
	printf 'Safety delivery path:\n'
	steps delivery
	printf 'Worktree setup hook (user scope, machine-wide):\n'
	report_subagent_config
	printf 'check-only complete.\n'
}

run_global_setup() {
	printf 'ky-pi-agent bootstrap --global-setup\n'
	printf 'Node:\n'
	require_node
	printf 'Hardening assertions (ignore-scripts) - must all pass before any install:\n'
	assert_repo_scopes
	assert_user_scope
	printf 'Safety delivery path - must hold before anything is installed machine-wide:\n'
	steps require-delivery
	printf 'Checkout dependencies:\n'
	install_checkout_deps
	printf 'Configuration:\n'
	merge_settings
	merge_harness_package
	install_theme
	printf 'Composed packages:\n'
	install_composed_packages
	printf 'Global setup complete.\n'
}

# Every hardening assertion, and the write that makes the user scope pass one,
# precedes every install. Do not reorder.
run_full() {
	printf 'ky-pi-agent bootstrap\n'
	printf 'Node:\n'
	require_node
	probe_tools
	printf 'Pinned Pi version:\n'
	check_pi_version_published
	printf 'Hardening (ignore-scripts) - must all pass before any install:\n'
	assert_repo_scopes
	harden_pi_npm_root

	printf 'Checkout dependencies:\n'
	install_checkout_deps
	printf 'Pi install:\n'
	install_pi
	printf 'Configuration:\n'
	merge_settings
	install_theme
	write_env_template
	merge_models_json
	merge_auth_json
	printf 'Safety delivery path:\n'
	steps delivery --will-write-stub
	install_safety_extension
	merge_harness_package
	merge_subagent_config
	printf 'Composed packages:\n'
	install_composed_packages

	printf 'Summary:\n'
	printf '  repo root          %s\n' "$REPO_ROOT"
	printf '  pi agent dir       %s\n' "$PI_AGENT_DIR"
	printf '  pinned Pi          %s@%s\n' "$PI_PKG" "$PI_PINNED"
	printf '  hardened scopes    repo root, %s, %s\n' "$REPO_NPM_PREFIX" "$PI_NPM_ROOT"
	printf 'Bootstrap complete. Re-check any time with: sh bin/bootstrap.sh --assert-hardening\n'
}

# `case "${1:-}"` sees $1 only, so a second operand would be dropped silently
# and the report of which assertions ran would be false.
if [ "$#" -gt 1 ]; then
	printf 'FATAL: this script takes at most one mode argument; got %s: %s\n' "$#" "$*" >&2
	usage >&2
	exit 2
fi

case "${1:-}" in
"" | --global-setup | --check-only | --assert-hardening | --check-version) sanitise_npm_env ;;
--help | -h)
	usage
	exit 0
	;;
*)
	printf 'FATAL: unknown argument: %s\n' "$1" >&2
	usage >&2
	exit 2
	;;
esac

case "${1:-}" in
"") run_full ;;
--global-setup) run_global_setup ;;
--check-only) run_check_only ;;
--assert-hardening) run_assert_hardening ;;
--check-version) check_pi_version_published ;;
esac
