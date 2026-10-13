#!/bin/sh
#
# Install the official OpenSpec skills and prompts at user level, at zero
# per-turn cost. How and why: docs/OPENSPEC.md.
#
# Test seams: PI_CODING_AGENT_DIR, XDG_CONFIG_HOME, PATH.
#
# Usage: sh scripts/openspec-setup.sh [--install-cli | --check | --uninstall | --help]
#   (none)         generate, patch and install the 12 skills and 12 prompts
#   --install-cli  npm install -g the pinned CLI (lifecycle scripts disabled)
#   --check        verify the installed skills and prompts
#   --uninstall    remove exactly the skills and prompts this script owns
#
set -eu

OPENSPEC_VERSION="1.13.2"
OPENSPEC_WORKFLOWS="propose explore new continue apply update ff sync archive bulk-archive verify onboard"
OPENSPEC_SKILLS="openspec-propose openspec-explore openspec-new-change openspec-continue-change openspec-apply-change openspec-update-change openspec-ff-change openspec-sync-specs openspec-archive-change openspec-bulk-archive-change openspec-verify-change openspec-onboard"
FLAG_LINE="disable-model-invocation: true"

usage() {
	printf 'Usage: sh scripts/openspec-setup.sh [--install-cli | --check | --uninstall | --help]\n' >&2
}

if ! printf '%s' "$OPENSPEC_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
	printf 'FATAL: OPENSPEC_VERSION is not an exact x.y.z pin: %s\n' "$OPENSPEC_VERSION" >&2
	exit 2
fi

if [ "$#" -gt 1 ]; then
	printf 'FATAL: this script takes at most one argument; got %s: %s\n' "$#" "$*" >&2
	usage
	exit 2
fi

mode="install"
case "${1:-}" in
"") ;;
--install-cli) mode="install-cli" ;;
--check) mode="check" ;;
--uninstall) mode="uninstall" ;;
--help)
	usage
	exit 0
	;;
*)
	printf 'FATAL: unknown argument: %s\n' "$1" >&2
	usage
	exit 2
	;;
esac

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd -P)

PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
# Pi expands a leading ~ in PI_CODING_AGENT_DIR (config.js expandTildePath), so match it.
case "$PI_AGENT_DIR" in
"~") PI_AGENT_DIR="$HOME" ;;
"~/"*) PI_AGENT_DIR="$HOME/${PI_AGENT_DIR#"~/"}" ;;
esac
# A Windows-style value arrives with backslashes; MSYS tools accept C:/x only.
case "$PI_AGENT_DIR" in
[A-Za-z]:* | '\\'*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
*'\'*)
	case "$PI_AGENT_DIR" in
	*/*) : ;;
	*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
	esac
	;;
esac

case "$PI_AGENT_DIR" in
/* | [A-Za-z]:*) ;;
*) PI_AGENT_DIR="$PWD/$PI_AGENT_DIR" ;;
esac

# Physical path of the nearest existing ancestor plus the not-yet-created rest.
resolve_physical() {
	rp_dir=$1
	rp_rest=""
	while [ ! -d "$rp_dir" ]; do
		rp_rest="/$(basename "$rp_dir")$rp_rest"
		rp_dir=$(dirname "$rp_dir")
	done
	rp_abs=$(CDPATH='' cd -- "$rp_dir" && pwd -P) || return 1
	printf '%s%s\n' "$rp_abs" "$rp_rest"
}

# Lower-cased and drive-letter form, because Windows and macOS paths compare case-insensitively.
comparable_path() {
	cp_path=$1
	if command -v cygpath >/dev/null 2>&1; then
		cp_path=$(cygpath -m "$cp_path")
	fi
	printf '%s\n' "$cp_path" | tr '[:upper:]' '[:lower:]'
}

# Skills committed into the repo would count against the per-turn budget tests.
if ! agent_physical=$(resolve_physical "$PI_AGENT_DIR"); then
	printf 'FATAL: cannot resolve %s to check it is outside this repository.\n' "$PI_AGENT_DIR" >&2
	exit 2
fi
case "$agent_physical" in
*/.. | */../*)
	printf 'FATAL: refusing %s: ".." below a directory that does not exist yet cannot be checked.\n' "$PI_AGENT_DIR" >&2
	exit 2
	;;
esac
agent_cmp=$(comparable_path "$agent_physical")
repo_cmp=$(comparable_path "$REPO_ROOT")
case "$agent_cmp" in
"$repo_cmp" | "$repo_cmp"/*)
	printf 'FATAL: refusing to install into %s: it is inside this repository.\n' "$PI_AGENT_DIR" >&2
	exit 2
	;;
esac

SKILLS_DIR="$PI_AGENT_DIR/skills"
PROMPTS_DIR="$PI_AGENT_DIR/prompts"

# Prints "<flag lines of any value> <exact true lines>" for the first frontmatter block.
flag_counts() {
	awk '
		{ line = $0; sub(/\r$/, "", line) }
		line == "---" && fences < 2 { fences++; next }
		fences == 1 && line ~ /^disable-model-invocation:/ {
			total++
			if (line == "disable-model-invocation: true") exact++
		}
		END { printf "%d %d\n", total, exact }
	' "$1"
}

has_one_flag() {
	[ "$(flag_counts "$1")" = "1 1" ]
}

check_cli_version() {
	if ! command -v openspec >/dev/null 2>&1; then
		printf 'FATAL: openspec is not on PATH. Run: sh scripts/openspec-setup.sh --install-cli\n' >&2
		exit 1
	fi
	have=$(openspec --version | tr -d '\r')
	if [ "$have" != "$OPENSPEC_VERSION" ]; then
		printf 'FATAL: openspec %s is installed but this harness is pinned to %s.\n' "$have" "$OPENSPEC_VERSION" >&2
		printf '  Run: sh scripts/openspec-setup.sh --install-cli\n' >&2
		exit 1
	fi
}

patch_skill() {
	tmp="$1.patched"
	awk '
		{
			line = $0
			eol = ""
			if (line ~ /\r$/) { sub(/\r$/, "", line); eol = "\r" }
		}
		line == "---" && fences < 2 { fences++; print; next }
		fences == 1 {
			if (line ~ /^disable-model-invocation:/) next
			print
			if (line ~ /^name:/) printf "disable-model-invocation: true%s\n", eol
			next
		}
		{ print }
	' "$1" >"$tmp"
	mv "$tmp" "$1"
}

run_check() {
	check_cli_version
	failures=0
	for skill in $OPENSPEC_SKILLS; do
		f="$SKILLS_DIR/$skill/SKILL.md"
		if [ ! -f "$f" ]; then
			printf 'FAIL: missing skill %s\n' "$skill" >&2
			failures=$((failures + 1))
		elif ! has_one_flag "$f"; then
			printf 'FAIL: skill %s lacks exactly one frontmatter "%s" line\n' "$skill" "$FLAG_LINE" >&2
			failures=$((failures + 1))
		fi
	done
	for wf in $OPENSPEC_WORKFLOWS; do
		if [ ! -f "$PROMPTS_DIR/opsx-$wf.md" ]; then
			printf 'FAIL: missing prompt opsx-%s\n' "$wf" >&2
			failures=$((failures + 1))
		fi
	done
	if [ "$failures" -gt 0 ]; then
		exit 1
	fi
	printf 'OK: openspec %s, 12 skills and 12 prompts installed in %s\n' "$OPENSPEC_VERSION" "$PI_AGENT_DIR"
}

run_uninstall() {
	for skill in $OPENSPEC_SKILLS; do
		rm -rf "${SKILLS_DIR:?}/$skill"
	done
	for wf in $OPENSPEC_WORKFLOWS; do
		rm -f "$PROMPTS_DIR/opsx-$wf.md"
	done
	printf 'Removed 12 skills and 12 prompts from %s\n' "$PI_AGENT_DIR"
	printf 'Remaining manual steps:\n'
	printf '  npm uninstall -g @fission-ai/openspec\n'
	printf '  remove the OpenSpec config dir (%%APPDATA%%\\openspec or ~/.config/openspec)\n'
}

run_install() {
	check_cli_version

	work=$(mktemp -d)
	trap 'rm -rf "$work"' EXIT INT TERM
	mkdir -p "$work/proj" "$work/xdg/openspec"
	printf '%s\n' '{"profile":"custom","delivery":"both","workflows":["propose","explore","new","continue","apply","update","ff","sync","archive","bulk-archive","verify","onboard"],"telemetry":{"enabled":false}}' >"$work/xdg/openspec/config.json"

	# The CLI is a native Node process; it needs a Windows-form path for XDG_CONFIG_HOME.
	xdg_native="$work/xdg"
	if command -v cygpath >/dev/null 2>&1; then
		xdg_native=$(cygpath -m "$work/xdg")
	fi

	# Positional "." avoids Git Bash rewriting a path-looking argument.
	(
		cd "$work/proj"
		env XDG_CONFIG_HOME="$xdg_native" OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 \
			OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_NO_AUTO_CONFIG=1 \
			openspec init --tools pi --profile custom . >/dev/null
	)

	gen="$work/proj/.pi"
	missing=0
	for skill in $OPENSPEC_SKILLS; do
		if [ ! -f "$gen/skills/$skill/SKILL.md" ]; then
			printf 'FATAL: openspec did not generate skill %s\n' "$skill" >&2
			missing=$((missing + 1))
		fi
	done
	for wf in $OPENSPEC_WORKFLOWS; do
		if [ ! -f "$gen/prompts/opsx-$wf.md" ]; then
			printf 'FATAL: openspec did not generate prompt opsx-%s\n' "$wf" >&2
			missing=$((missing + 1))
		fi
	done
	if [ "$missing" -gt 0 ]; then
		printf 'Nothing was installed.\n' >&2
		exit 1
	fi

	for skill in $OPENSPEC_SKILLS; do
		patch_skill "$gen/skills/$skill/SKILL.md"
		if ! has_one_flag "$gen/skills/$skill/SKILL.md"; then
			printf 'FATAL: could not patch the frontmatter of %s\n' "$skill" >&2
			exit 1
		fi
	done

	mkdir -p "$SKILLS_DIR" "$PROMPTS_DIR"
	for skill in $OPENSPEC_SKILLS; do
		rm -rf "${SKILLS_DIR:?}/$skill"
		cp -R "$gen/skills/$skill" "$SKILLS_DIR/$skill"
	done
	for wf in $OPENSPEC_WORKFLOWS; do
		cp "$gen/prompts/opsx-$wf.md" "$PROMPTS_DIR/opsx-$wf.md"
	done

	# An upstream rename leaves the old skill indexed; warn rather than delete.
	for d in "$SKILLS_DIR"/openspec-*; do
		[ -d "$d" ] || continue
		name=$(basename "$d")
		case " $OPENSPEC_SKILLS " in
		*" $name "*) ;;
		*) printf 'WARN: unrecognised skill %s in %s; remove it if it is stale.\n' "$name" "$SKILLS_DIR" >&2 ;;
		esac
	done

	# Terminal use of the CLI must not phone home either; deliberately the user's own config.
	env OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_NO_AUTO_CONFIG=1 \
		openspec config set telemetry.enabled false >/dev/null 2>&1 || :
	telemetry=$(env OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_NO_AUTO_CONFIG=1 \
		openspec config get telemetry.enabled 2>/dev/null | tr -d '\r') || telemetry=""
	if [ "$telemetry" != "false" ]; then
		printf 'WARN: telemetry.enabled reads back as "%s", not false; run: openspec config set telemetry.enabled false\n' "$telemetry" >&2
	fi

	printf 'openspec %s: installed 12 skills and 12 prompts into %s\n' "$OPENSPEC_VERSION" "$PI_AGENT_DIR"
	printf '  skills:  /skill:openspec-<name>   (e.g. /skill:openspec-propose)\n'
	printf '  prompts: /opsx-<id>               (e.g. /opsx-propose)\n'
}

case "$mode" in
install-cli)
	npm install -g --ignore-scripts "@fission-ai/openspec@$OPENSPEC_VERSION"
	check_cli_version
	printf 'openspec %s is installed.\n' "$OPENSPEC_VERSION"
	;;
check) run_check ;;
uninstall) run_uninstall ;;
install) run_install ;;
esac
