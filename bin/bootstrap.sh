#!/bin/sh
#
# ky-pi-agent cold-machine bootstrap.
#
# Takes a machine with Node and git to one that can run this harness safely.
# It hardens every npm scope Pi can reach, proves each one through npm itself,
# and only then installs anything. Details: docs/RUNBOOK.md.
#
# Ordering rule: ignore-scripts=true must be in force before the first
# `pi install`; a postinstall that already ran cannot be undone. run_full() and
# run_global_setup() assert first and install after.
#
# Portability: strict POSIX sh (no arrays, no `local`, no double-bracket tests),
# LF endings, never PowerShell. All JSON is read and written by `node -e`,
# never by a stream editor.
#
# Modes
#   (no args)           full run: probe, verify, harden, install, configure
#   --global-setup      hardening assertions, user settings merge, theme, agent
#                       scan dir and the pinned composed packages; touches no
#                       credential, model, env or safety-stub file
#   --check-only        every probe and repo-side assertion, mutates nothing,
#                       needs network for the published-pin preflight
#   --assert-hardening  the ignore-scripts assertions only; offline-safe
#   --check-version     the published-pin preflight only
#   --help              this list
#
# Test seams: PI_CODING_AGENT_DIR (Pi's own variable), KYPI_PI_PINNED,
# KYPI_SKIP_INSTALL.
#
set -eu

PI_PKG="@earendil-works/pi-coding-agent"
PI_PINNED="${KYPI_PI_PINNED:-1.1.0}"
NODE_MIN="22.19.0"
BOOTSTRAP_VERSION="1"

# Resolved from the script's own location so any cwd works.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
# MSYS tools accept C:/x and reject C:\x, so a drive-letter or UNC value from a
# Node-launched caller is normalised. A POSIX path may legally hold a backslash,
# hence the no-forward-slash condition on the catch-all arm.
case "$PI_AGENT_DIR" in
[A-Za-z]:* | '\\'*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
*'\'*)
	case "$PI_AGENT_DIR" in
	*/*) : ;;
	*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
	esac
	;;
esac
PI_NPM_ROOT="$PI_AGENT_DIR/npm"
REPO_NPM_PREFIX="$REPO_ROOT/.pi/npm"
REPO_SETTINGS="$REPO_ROOT/.pi/settings.json"

MISSING_REQUIRED=0

# Prepended to every embedded node script that writes: temp file in the same
# directory, then rename, so a crash never leaves a truncated credential file.
# The embedded scripts are single-quoted shell strings and may hold no apostrophe.
KYPI_ATOMIC_JS='
const writeAtomic = (file, data, mode) => {
  const nodeFs = require("node:fs");
  const tmp = file + ".tmp-" + process.pid;
  nodeFs.writeFileSync(tmp, data, mode === undefined ? "utf8" : { encoding: "utf8", mode });
  try { nodeFs.renameSync(tmp, file); } catch (e) {
    try { nodeFs.unlinkSync(tmp); } catch (e2) { /* nothing to clean */ }
    throw e;
  }
};
'

# ---------------------------------------------------------------------------
# Ask npm about files, not about the shell that launched us
# ---------------------------------------------------------------------------
# npm ranks npm_config_* environment variables above every .npmrc, so an
# inherited one makes each assertion below answer about the launcher, not the
# files. Valid shell names are unset; any name no POSIX shell can unset
# (npm_config_ignore-scripts, npm_config_//registry...:_authToken) is refused,
# because certifying a control we did not exercise is worse than stopping.
# The prefix match is case-insensitive: Windows hands children NPM_CONFIG_*.
# Bracket classes instead of a sed `I` flag, which is not POSIX.
sanitise_npm_env() {
	_keys=$(env | sed -n \
		's/^\([Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_[A-Za-z0-9_]*\)=.*/\1/p' || true)
	for _k in $_keys; do
		unset "$_k" || true
	done

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

# A missing optional tool warns and never aborts: glab is absent on CI and on
# this machine.
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
# Published-pin preflight
# ---------------------------------------------------------------------------
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
		# Only E404 is discriminated; E401, E403, ETARGET and network failures
		# all land here, so the message reports what npm said and guesses nothing.
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
# Hardening
# ---------------------------------------------------------------------------
# Assert the effect through npm, never the existence of a file: npm resolves the
# project config from --prefix when given and Pi always passes --prefix.
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

# The scopes a checkout covers itself: the developer's own `npm install` (cwd =
# repo root) and project-scope `pi install -l` (prefix <repo>/.pi/npm).
assert_repo_scopes() {
	assert_ignore_scripts_for "repo root ($REPO_ROOT)" "$REPO_ROOT" ""
	assert_ignore_scripts_for "project prefix ($REPO_NPM_PREFIX)" "" "$REPO_NPM_PREFIX"
}

assert_user_scope() {
	assert_ignore_scripts_for "user-scope prefix ($PI_NPM_ROOT)" "" "$PI_NPM_ROOT"
}

# Pi creates the agent dir 0700 and auth.json 0600 only when they are absent,
# so a plain `mkdir -p` here would leave the directory 0755 permanently
# (pi dist/core/auth-storage.js:21-31). chmod is best-effort: on Windows it only
# toggles the read-only bit.
ensure_agent_dir() {
	mkdir -p "$PI_AGENT_DIR"
	chmod 700 "$PI_AGENT_DIR" 2>/dev/null || true
}

# `pi install npm:*` at user scope is the gap no committed file can close. Only
# the ignore-scripts line is ours; a private registry or auth token already in
# this .npmrc is the user's and must survive.
harden_pi_npm_root() {
	ensure_agent_dir
	mkdir -p "$PI_NPM_ROOT"
	_rc_file="$PI_NPM_ROOT/.npmrc"

	if [ ! -f "$_rc_file" ]; then
		{
			printf '%s\n' '# Written by ky-pi-agent bin/bootstrap.sh. See docs/RUNBOOK.md.'
			printf '%s\n' '#'
			printf '%s\n' '# Pi installs user-scope extension packages with'
			printf '%s\n' '#   npm install --prefix ~/.pi/agent/npm ...'
			printf '%s\n' '# and passes no --ignore-scripts on any code path.'
			printf '%s\n' '#'
			printf '%s\n' '# npm resolves the project config from --prefix, not cwd, so NO file inside'
			printf '%s\n' '# the ky-pi-agent repo can cover this path. This one can.'
			printf '%s\n' 'ignore-scripts=true'
		} >"$_rc_file"
		printf '  wrote %s\n' "$_rc_file"
	elif grep -q '^ignore-scripts=true' "$_rc_file"; then
		printf '  %s already hardened\n' "$_rc_file"
	else
		# The 0600 backup is written first and kept: the file may hold a registry
		# token and a failed rebuild with no copy is unrecoverable. grep exit 1
		# (empty result) is legitimate; exit 2 must abort with the backup intact.
		: >"$_rc_file.kypi-backup"
		chmod 600 "$_rc_file.kypi-backup" 2>/dev/null || true
		cat "$_rc_file" >"$_rc_file.kypi-backup"
		grep -v '^[[:space:]]*ignore-scripts[[:space:]]*=' "$_rc_file.kypi-backup" \
			>"$_rc_file" || [ "$?" -eq 1 ]
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

# Absent is "not applied yet" (check-only must pass on a clean runner); present
# but ineffective is real breakage and always fatal.
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

# `npm ls -g` exits 1 for an extraneous or unmet-peer tree while still printing
# valid JSON, so the JSON is judged and the exit code is not.
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
	# The published package declares no postinstall, so --ignore-scripts is free.
	npm install -g --ignore-scripts "${PI_PKG}@${PI_PINNED}"
}

# The composed packages, their disables and the theme come from the committed
# .pi/settings.json so there is one source of truth. Merge is additive: user
# packages, extensions, theme and kyPiAgent keys we do not own survive, and a
# different pinned version of one of our packages is refused, never re-pinned.
merge_settings() {
	if [ ! -f "$REPO_SETTINGS" ]; then
		printf 'FATAL: missing %s\n' "$REPO_SETTINGS" >&2
		exit 1
	fi
	ensure_agent_dir
	KYPI_SETTINGS="$PI_AGENT_DIR/settings.json" \
		KYPI_REPO_SETTINGS="$REPO_SETTINGS" \
		KYPI_AGENTS_DIR="$REPO_ROOT/.pi/agents" \
		KYPI_BOOTSTRAP_VERSION="$BOOTSTRAP_VERSION" \
		KYPI_HARDENED_NPM_ROOT="$PI_NPM_ROOT" \
		KYPI_PIN="$PI_PINNED" \
		node -e "$KYPI_ATOMIC_JS"'
const fs = require("node:fs");
const p = process.env.KYPI_SETTINGS;
const readObject = (file, what) => {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8").trim() || "{}"); } catch (e) {
    console.error("FATAL: " + file + " is not valid JSON (" + e.message + "). Refusing to " + what + " it.");
    process.exit(1);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("FATAL: " + file + " is not a JSON object. Refusing to " + what + " it.");
    process.exit(1);
  }
  return parsed;
};
const repo = readObject(process.env.KYPI_REPO_SETTINGS, "trust");
const obj = fs.existsSync(p) ? readObject(p, "touch") : {};
const before = JSON.stringify(obj);

const sourceOf = (entry) => (typeof entry === "string" ? entry : entry && typeof entry.source === "string" ? entry.source : "");
// Identity is the package name; the trailing @version is not part of it.
const identityOf = (source) => {
  const s = source.replace(/^npm:/, "");
  const at = s.lastIndexOf("@");
  return at > 0 ? s.slice(0, at) : s;
};
const asList = (value, name) => {
  if (value === undefined) { return []; }
  if (!Array.isArray(value)) {
    console.error("FATAL: " + p + " has a " + name + " key that is not an array. Refusing to touch it.");
    process.exit(1);
  }
  return value;
};

const packages = asList(obj.packages, "packages");
const added = [];
for (const pin of asList(repo.packages, "packages")) {
  const want = sourceOf(pin);
  if (!want.startsWith("npm:")) { continue; }
  const existing = packages.map(sourceOf).find((s) => s.startsWith("npm:") && identityOf(s) === identityOf(want));
  if (existing === undefined) { packages.push(pin); added.push(want); continue; }
  if (existing !== want) {
    console.error("FATAL: " + p + " already pins " + existing + " but this checkout pins " + want + ".");
    console.error("       A pinned version you chose is never re-pinned silently. Remove the entry or");
    console.error("       change the pin in .pi/settings.json deliberately, then re-run.");
    process.exit(1);
  }
}
if (packages.length > 0) { obj.packages = packages; }

const extensions = asList(obj.extensions, "extensions");
for (const entry of asList(repo.extensions, "extensions")) {
  if (!extensions.includes(entry)) { extensions.push(entry); added.push(entry); }
}
if (extensions.length > 0) { obj.extensions = extensions; }

if (obj.theme === undefined && typeof repo.theme === "string") { obj.theme = repo.theme; added.push("theme " + repo.theme); }

const agentsDir = process.env.KYPI_AGENTS_DIR.replace(/\\/g, "/");
if (obj.subagents !== undefined && (obj.subagents === null || typeof obj.subagents !== "object" || Array.isArray(obj.subagents))) {
  console.error("FATAL: " + p + " has a subagents key that is not a JSON object. Refusing to touch it.");
  process.exit(1);
}
const subagents = obj.subagents === undefined ? {} : obj.subagents;
const scanDirs = asList(subagents.agentScanDirs, "subagents.agentScanDirs");
if (!scanDirs.includes(agentsDir)) { scanDirs.push(agentsDir); added.push("agentScanDirs " + agentsDir); }
subagents.agentScanDirs = scanDirs;
obj.subagents = subagents;

const owned = {
  bootstrapVersion: process.env.KYPI_BOOTSTRAP_VERSION,
  hardenedNpmRoot: process.env.KYPI_HARDENED_NPM_ROOT,
  piPinned: process.env.KYPI_PIN,
};
obj.kyPiAgent = Object.assign({}, obj.kyPiAgent, owned);

if (JSON.stringify(obj) === before) {
  console.log("  settings.json kyPiAgent already current - unchanged");
  process.exit(0);
}
writeAtomic(p, JSON.stringify(obj, null, 2) + "\n");
console.log("  settings.json kyPiAgent key merged");
for (const a of added) { console.log("  settings.json added " + a); }
'
}

# Byte-compared so a second run writes nothing. A user theme of the same name is
# replaced: the file is the harness's own.
install_theme() {
	_theme_src="$REPO_ROOT/.pi/themes/ky.json"
	_theme_dst="$PI_AGENT_DIR/themes/ky.json"
	if [ ! -f "$_theme_src" ]; then
		printf 'FATAL: missing theme %s\n' "$_theme_src" >&2
		exit 1
	fi
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

# One `pi install npm:<name>@<exact>` per pinned package, user scope, after the
# hardening assertions have passed.
install_composed_packages() {
	if [ "${KYPI_SKIP_INSTALL:-0}" = "1" ]; then
		printf '  skipped: KYPI_SKIP_INSTALL=1\n'
		return 0
	fi
	if ! command -v pi >/dev/null 2>&1; then
		printf 'FATAL: pi not found on PATH, so the composed packages cannot be installed.\n' >&2
		exit 1
	fi
	_specs=$(KYPI_REPO_SETTINGS="$REPO_SETTINGS" node -e '
const fs = require("node:fs");
const repo = JSON.parse(fs.readFileSync(process.env.KYPI_REPO_SETTINGS, "utf8"));
for (const entry of repo.packages || []) {
  const source = typeof entry === "string" ? entry : entry && entry.source;
  if (typeof source === "string" && /^npm:.+@[0-9]/.test(source)) { console.log(source); }
}
')
	for _spec in $_specs; do
		printf '  pi install %s\n' "$_spec"
		pi install "$_spec"
	done
}

# Marked-region copy: replace between the markers, append when absent, create
# when the target is absent. Byte-identical on a second run.
write_env_template() {
	_src="$REPO_ROOT/.pi/templates/env.example"
	_dst="$REPO_ROOT/.env.example"
	if [ ! -f "$_src" ]; then
		printf 'FATAL: missing template %s\n' "$_src" >&2
		exit 1
	fi
	KYPI_ENV_SRC="$_src" KYPI_ENV_DST="$_dst" node -e "$KYPI_ATOMIC_JS"'
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
const block = src.slice(s, e + END.length);
const dst = process.env.KYPI_ENV_DST;
let out;
if (!fs.existsSync(dst)) {
  out = src;
} else {
  const cur = fs.readFileSync(dst, "utf8");
  const ds = cur.indexOf(START);
  const de = cur.indexOf(END);
  // Presence is not enough: an END above a START makes the slices overlap and
  // the file grows on every run.
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
writeAtomic(dst, out);
console.log("  .env.example written from .pi/templates/env.example");
'
}

# ---------------------------------------------------------------------------
# models.json and auth.json: the files Pi actually reads
# ---------------------------------------------------------------------------
# Pi resolves both from the agent directory only (pi dist/config.js:423-425), so
# the committed templates are inert until installed here. Both refuse a target
# that is not valid JSON and report "already current - unchanged" on a no-op.
#
#   models.json  replaces providers.dashscope, and merges the template's
#                providers.amazon-bedrock models by id. Every other provider,
#                model and user edit survives.
#   auth.json    merge-if-absent per provider key; an existing key is never
#                modified.
#
# Neither writes a secret: the templates hold $ENV_VAR references only.
merge_models_json() {
	_src="$REPO_ROOT/.pi/templates/models-template.json"
	if [ ! -f "$_src" ]; then
		printf 'FATAL: missing template %s\n' "$_src" >&2
		exit 1
	fi
	ensure_agent_dir
	# Values cross into node through KYPI_* variables, never by interpolation
	# into the JS source: a base URL is caller-supplied text.
	KYPI_MODELS_SRC="$_src" \
		KYPI_MODELS_DST="$PI_AGENT_DIR/models.json" \
		KYPI_DASHSCOPE_BASE_URL="${KYPI_DASHSCOPE_BASE_URL:-}" \
		node -e "$KYPI_ATOMIC_JS"'
const fs = require("node:fs");
const src = process.env.KYPI_MODELS_SRC;
const dst = process.env.KYPI_MODELS_DST;

// Whole-line // comments only: a naive strip would eat the https:// in baseUrl.
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
const bedrockNext = parsed.providers["amazon-bedrock"];
if (bedrockNext !== undefined && (bedrockNext === null || typeof bedrockNext !== "object" || !Array.isArray(bedrockNext.models))) {
  console.error("FATAL: " + src + " has a providers.amazon-bedrock entry without a models array. Refusing to guess what to install.");
  process.exit(1);
}

// The workspace-dedicated host names a workspace id that must never enter a
// public repo, so it arrives here. It is validated because a typo that lands
// as http:// would put the bearer key on the wire in cleartext.
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
const outProviders = providers === undefined ? {} : providers;
let changed = false;

if (JSON.stringify(outProviders.dashscope) === JSON.stringify(next)) {
  console.log("  models.json providers.dashscope already current - unchanged");
} else {
  outProviders.dashscope = next;
  changed = true;
  console.log("  models.json providers.dashscope key merged");
}

if (bedrockNext !== undefined) {
  const current = outProviders["amazon-bedrock"];
  if (current !== undefined && (current === null || typeof current !== "object" || Array.isArray(current) ||
      (current.models !== undefined && !Array.isArray(current.models)))) {
    console.error("FATAL: " + dst + " has a providers.amazon-bedrock entry that is not an object with a models array. Refusing to touch it.");
    process.exit(1);
  }
  const merged = current === undefined ? Object.assign({}, bedrockNext, { models: [] }) : current;
  const models = merged.models === undefined ? [] : merged.models;
  const touched = [];
  for (const model of bedrockNext.models) {
    const at = models.findIndex((m) => m && m.id === model.id);
    if (at < 0) { models.push(model); touched.push(model.id); continue; }
    if (JSON.stringify(models[at]) !== JSON.stringify(model)) { models[at] = model; touched.push(model.id); }
  }
  if (touched.length === 0 && current !== undefined) {
    console.log("  models.json providers.amazon-bedrock already current - unchanged");
  } else {
    merged.models = models;
    outProviders["amazon-bedrock"] = merged;
    changed = true;
    console.log("  models.json providers.amazon-bedrock models merged: " + touched.join(", "));
  }
}

if (!changed) { process.exit(0); }
obj.providers = outProviders;
writeAtomic(dst, JSON.stringify(obj, null, 2) + "\n");
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
		node -e "$KYPI_ATOMIC_JS"'
const fs = require("node:fs");
const src = process.env.KYPI_AUTH_SRC;
const dst = process.env.KYPI_AUTH_DST;

// Strict JSON in both directions: Pi reads auth.json strictly, and a
// destination holding a comment is not a file this script may rewrite.
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

// An entry still carrying a REPLACE_WITH_ placeholder is not installed: Pi
// resolves a stored env.AWS_PROFILE ahead of the ambient one
// (pi-ai src/providers/amazon-bedrock.ts:65), so the placeholder would shadow a
// working `export AWS_PROFILE=...`. No apostrophe may appear anywhere in this
// embedded script, comments included; it is a single-quoted shell string.
const SENTINEL = "REPLACE_WITH_";
const carriesSentinel = (node) => {
  if (typeof node === "string") { return node.startsWith(SENTINEL); }
  if (Array.isArray(node)) { return node.some(carriesSentinel); }
  if (node !== null && typeof node === "object") { return Object.values(node).some(carriesSentinel); }
  return false;
};

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
// Mode 0600 applies only on creation, so chmod covers a file made looser earlier.
writeAtomic(dst, JSON.stringify(obj, null, 2) + "\n", 0o600);
try { fs.chmodSync(dst, 0o600); } catch (e) { /* Windows: toggles the read-only bit only */ }
console.log("  auth.json provider entries added: " + added.join(", "));
'
}

# ---------------------------------------------------------------------------
# pi-subagents worktree hook
# ---------------------------------------------------------------------------
# pi-subagents reads this dedicated file, not settings.json (src/extension/
# config.ts:90-92). Only the two worktreeSetupHook keys are replaced; any other
# key survives. The path is absolute because the file is user scope and applies
# in every repo. Tab indent matches pi-subagents own saveConfig().
merge_subagent_config() {
	ensure_agent_dir
	_subagent_config_dir="$PI_AGENT_DIR/extensions/subagent"
	mkdir -p "$_subagent_config_dir"
	KYPI_SUBAGENT_CONFIG="$_subagent_config_dir/config.json" \
		KYPI_WORKTREE_HOOK="$REPO_ROOT/.pi/scripts/worktree-setup-hook.mjs" \
		node -e "$KYPI_ATOMIC_JS"'
const fs = require("node:fs");
const p = process.env.KYPI_SUBAGENT_CONFIG;
// A native child receives an auto-converted backslash form of a Windows path.
const hookPath = process.env.KYPI_WORKTREE_HOOK.replace(/\\/g, "/");
const timeoutMs = 30000;

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
if (obj.worktreeSetupHook === hookPath && obj.worktreeSetupHookTimeoutMs === timeoutMs) {
  console.log("  subagent config.json worktreeSetupHook already current - unchanged");
  process.exit(0);
}
obj.worktreeSetupHook = hookPath;
obj.worktreeSetupHookTimeoutMs = timeoutMs;
writeAtomic(p, JSON.stringify(obj, null, "\t") + "\n");
console.log("  subagent config.json worktreeSetupHook key merged: " + p);
'
}

# ---------------------------------------------------------------------------
# Safety extension at user scope
# ---------------------------------------------------------------------------
# A project-scoped extension never loads headless (trust resolves false with no
# UI), and the absence reads as "nothing dangerous happened". The user-scope
# stub loads the checkout's guard regardless of trust.
#
# The stub imports the target unconditionally: an existence check against the
# project copy would skip BOTH copies in an untrusted headless run. When the
# target itself is missing, the stub blocks every tool call instead of loading
# nothing. Both copies loading is a duplicate hook, which the deferral marker
# keyed on toolCallId tolerates (docs/SAFETY.md, "Load order is part of this").
#
# Backslashes are normalised before the path is embedded in a TS string literal,
# where they would be escape sequences.
install_safety_extension() {
	_safety_src="$REPO_ROOT/.pi/extensions/safety/index.ts"
	if [ ! -f "$_safety_src" ]; then
		printf 'FATAL: missing safety extension entry point %s\n' "$_safety_src" >&2
		exit 1
	fi
	ensure_agent_dir
	_safety_dir="$PI_AGENT_DIR/extensions/ky-safety"
	_safety_stub="$_safety_dir/index.ts"
	mkdir -p "$_safety_dir"
	KYPI_SAFETY_SRC="$_safety_src" \
		KYPI_SAFETY_STUB="$_safety_stub" \
		node -e "$KYPI_ATOMIC_JS"'
const fs = require("node:fs");
const specifier = process.env.KYPI_SAFETY_SRC.replace(/\\/g, "/");
const dst = process.env.KYPI_SAFETY_STUB;
const literal = JSON.stringify(specifier);
const out = [
  "// Generated by ky-pi-agent bin/bootstrap.sh. See docs/RUNBOOK.md.",
  "//",
  "// Loads the safety extension at user scope so it applies regardless of project",
  "// trust. If the checkout was moved or deleted, every tool call is blocked",
  "// rather than running unguarded.",
  "import { existsSync } from \"node:fs\";",
  "",
  "export default async function (pi) {",
  "  if (!existsSync(" + literal + ")) {",
  "    pi.on(\"tool_call\", () => ({",
  "      block: true,",
  "      reason: \"ky-safety: the safety extension is missing at \" + " + literal + " + \". Every tool call is blocked. Re-run bin/bootstrap.sh from a ky-pi-agent checkout.\",",
  "    }));",
  "    return;",
  "  }",
  "  const mod = await import(" + literal + ");",
  "  await mod.default(pi);",
  "}",
  "",
].join("\n");
if (fs.existsSync(dst) && fs.readFileSync(dst, "utf8") === out) {
  console.log("  " + dst + " already current - unchanged");
  process.exit(0);
}
writeAtomic(dst, out);
console.log("  wrote " + dst);
'
}

# Absent is "not applied yet"; present but pointing at a missing target is a
# moved or deleted clone and is fatal in every mode.
report_safety_extension() {
	_safety_stub="$PI_AGENT_DIR/extensions/ky-safety/index.ts"
	if [ ! -f "$_safety_stub" ]; then
		printf '  WARN user-scope safety extension not installed: %s is absent\n' "$_safety_stub"
		printf '       remedy: run bin/bootstrap.sh with no arguments to apply\n'
		return 0
	fi
	KYPI_SAFETY_STUB="$_safety_stub" node -e '
const fs = require("node:fs");
const stub = process.env.KYPI_SAFETY_STUB;
const text = fs.readFileSync(stub, "utf8");
const m = text.match(/await import\("([^"]+)"\)/);
if (!m) {
  console.error("FATAL: " + stub + " does not contain the expected dynamic-import line. Refusing to trust it.");
  process.exit(1);
}
if (!fs.existsSync(m[1])) {
  console.error("FATAL: " + stub + " points at " + m[1] + ", which does not exist.");
  console.error("       This usually means the repository clone that wrote this stub was moved or deleted.");
  console.error("       Every tool call is blocked until it is rewritten.");
  console.error("       Remedy: run bin/bootstrap.sh with no arguments to rewrite it.");
  process.exit(1);
}
console.log("  " + stub + " -> " + m[1] + " (target exists)");
'
}

# Exactly one safety delivery path per machine. The stub plus a git package of
# this repo is two diverging copies and fails. A user-level git or local package
# resolving to this checkout only warns: it double-loads inside this repo.
report_delivery_paths() {
	_dp_settings="$PI_AGENT_DIR/settings.json"
	_dp_stub="$PI_AGENT_DIR/extensions/ky-safety/index.ts"
	if [ ! -f "$_dp_settings" ]; then
		printf '  no user settings.json - nothing to compare\n'
		return 0
	fi
	KYPI_DP_SETTINGS="$_dp_settings" KYPI_DP_STUB="$_dp_stub" KYPI_DP_REPO="$REPO_ROOT" node -e '
const fs = require("node:fs");
const path = require("node:path");
const file = process.env.KYPI_DP_SETTINGS;
let obj;
try { obj = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {
  console.error("FATAL: " + file + " is not valid JSON (" + e.message + ").");
  process.exit(1);
}
const list = obj && Array.isArray(obj.packages) ? obj.packages : [];
const sources = list.map((e) => (typeof e === "string" ? e : e && typeof e.source === "string" ? e.source : ""));
const norm = (s) => s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const repo = norm(process.env.KYPI_DP_REPO);
const gitRepo = /github\.com[\/:]kaiyitkoh\/ky-pi-agent(\.git)?(@|\/|$)/i;
const git = sources.filter((s) => gitRepo.test(s));
const local = sources.filter((s) => {
  if (/^(npm|git|https?|ssh):/i.test(s) || gitRepo.test(s) || s === "") { return false; }
  const bare = s.replace(/^local:/i, "");
  return norm(path.resolve(path.dirname(file), bare)) === repo;
});
const stub = fs.existsSync(process.env.KYPI_DP_STUB);
for (const s of git.concat(local)) {
  console.log("  WARN user-level package " + s + " loads this checkout, so it double-loads inside this repo");
}
if (git.length > 0 && stub) {
  console.error("FATAL: one delivery path only: the user-scope safety stub and the git package " + git[0] + " are both configured.");
  console.error("       They are two copies of the guard that can diverge. Keep the stub (bin/bootstrap.sh)");
  console.error("       or the git package (pi install), never both. Remove one and re-run.");
  process.exit(1);
}
if (git.length === 0 && local.length === 0) { console.log("  one delivery path (no user-level package loads this checkout)"); }
'
}

# The --check-only counterpart of merge_subagent_config. The hook path is
# absolute and user scope, so a moved or deleted clone breaks worktree spawns in
# every repo on the machine; absent config is a WARN, a dangling path is fatal.
report_subagent_config() {
	_sa_cfg="$PI_AGENT_DIR/extensions/subagent/config.json"
	if [ ! -f "$_sa_cfg" ]; then
		printf '  WARN worktree setup hook not wired: %s is absent\n' "$_sa_cfg"
		printf '       remedy: run bin/bootstrap.sh with no arguments to apply\n'
		return 0
	fi
	KYPI_SUBAGENT_CONFIG="$_sa_cfg" node -e '
const fs = require("node:fs");
const p = process.env.KYPI_SUBAGENT_CONFIG;
let obj;
try { obj = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) {
  console.error("FATAL: " + p + " is not valid JSON (" + e.message + "). Refusing to trust it.");
  process.exit(1);
}
if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
  console.error("FATAL: " + p + " is not a JSON object. Refusing to trust it.");
  process.exit(1);
}
const hook = obj.worktreeSetupHook;
if (typeof hook !== "string" || hook === "") {
  console.error("FATAL: " + p + " carries no worktreeSetupHook.");
  console.error("       Remedy: re-run bin/bootstrap.sh with no arguments.");
  process.exit(1);
}
if (!fs.existsSync(hook)) {
  console.error("FATAL: " + p + " points at " + hook + ", which does not exist.");
  console.error("       This config is written at USER scope, so every subagent worktree spawn on this");
  console.error("       machine -- in every repository -- is affected, not just this one.");
  console.error("       This usually means the repository clone that wrote it was moved or deleted.");
  console.error("       Remedy: run bin/bootstrap.sh with no arguments to rewrite it.");
  process.exit(1);
}
console.log("  " + p + " -> " + hook + " (target exists)");
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
                      then installs Pi, merges user settings (composed packages,
                      builtin disables, theme, agent scan dir), installs the ky
                      theme and the composed packages, writes .env.example,
                      installs the models.json / auth.json templates, installs
                      the safety extension at user scope and wires the worktree
                      setup hook into pi-subagents' own config file. Safe to
                      re-run: every step is idempotent.
  --global-setup      Asserts the ignore-scripts scopes, then merges user
                      settings, installs the theme and installs the pinned
                      composed packages. Touches no credential, model, env or
                      safety-stub file.
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
  KYPI_SKIP_INSTALL    Set to 1 to skip every npm and pi install step.
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
	printf 'Safety extension (user scope):\n'
	report_safety_extension
	printf 'Safety delivery path:\n'
	report_delivery_paths
	printf 'Worktree setup hook (user scope, machine-wide):\n'
	report_subagent_config
	printf 'check-only complete.\n'
}

run_global_setup() {
	sanitise_npm_env
	printf 'ky-pi-agent bootstrap --global-setup\n'
	printf 'Node:\n'
	require_node
	printf 'Hardening assertions (ignore-scripts) - must all pass before any install:\n'
	assert_repo_scopes
	assert_user_scope
	printf 'Configuration:\n'
	merge_settings
	install_theme
	printf 'Composed packages:\n'
	install_composed_packages
	printf 'Global setup complete.\n'
}

# Every hardening assertion, and the write that makes the user scope pass one,
# precedes install_pi and install_composed_packages. Do not reorder: an install
# that already ran lifecycle scripts cannot be retroactively protected.
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
	install_theme
	write_env_template
	merge_models_json
	merge_auth_json
	install_safety_extension
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
"")
	run_full
	;;
--global-setup)
	run_global_setup
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
