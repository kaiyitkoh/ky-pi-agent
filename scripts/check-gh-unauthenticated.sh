#!/bin/sh
#
# Classifies whether Pi's /share can upload this session's transcript.
#
# /share exports the whole session (source, prompts, pasted secrets) and uploads
# it. Pi 1.1.0 tries Radius first and only then falls back to a gist
# (pi dist/modes/interactive/session-share.js), so there are two doors:
#   - a stored Radius credential uploads without gh at all;
#   - an authenticated gh posts a secret gist, which is unlisted, not private.
# No extension hook is upstream of the literal /share match
# (pi interactive-mode.js), and `gh auth refresh --remove-scopes gist` cannot
# drop the minimum scopes, so the controls are: no stored Radius credential and
# `gh auth logout`.
#
# Usage: sh scripts/check-gh-unauthenticated.sh [--warn-only]
#
# The dev machine runs --warn-only because its gh credential is how this repo is
# pushed. The work laptop runs it bare, where a non-zero exit is the point. The
# unit test proves the classifier, not the machine.
#
set -e

usage_error() {
	printf 'FATAL: %s\nUsage: sh scripts/check-gh-unauthenticated.sh [--warn-only]\n' "$1" >&2
	exit 2
}

# A second operand would be silently discarded by `case "${1:-}"`.
[ "$#" -le 1 ] || usage_error "this script takes at most one argument; got $#: $*"

warn_only=0
case "${1:-}" in
"") ;;
--warn-only) warn_only=1 ;;
*) usage_error "unknown argument: $1" ;;
esac

agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
failed=0

# Shell builtins only, so the check works with a minimal PATH. A "radius" key
# anywhere in the file counts: a false positive fails safe.
radius_found=0
if [ -f "$agent_dir/auth.json" ]; then
	while IFS= read -r line || [ -n "$line" ]; do
		case "$line" in
		*'"radius"'*) radius_found=1 ;;
		esac
	done <"$agent_dir/auth.json"
fi
if [ "$radius_found" -eq 1 ]; then
	echo "Radius IS configured in $agent_dir/auth.json. /share uploads the session to" >&2
	echo "  Radius first, without gh, so logging gh out does not stop it." >&2
	echo "  Remedy: sign out of Radius in Pi (/logout) so no radius entry remains." >&2
	failed=1
fi

# gh prefers GH_TOKEN/GITHUB_TOKEN over its store, and `gh auth token` reads the
# store without the network: `gh auth status` alone exits non-zero offline or
# when another host's token is broken, reporting a usable token as absent.
if ! command -v gh >/dev/null 2>&1; then
	if [ "$failed" -eq 0 ]; then
		echo "OK: gh is not installed; /share cannot upload."
		exit 0
	fi
elif [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ] || gh auth token >/dev/null 2>&1 || gh auth status >/dev/null 2>&1; then
	echo "gh IS authenticated. /share can upload this session to a GitHub gist." >&2
	echo "  The transcript would be exported to the OS temp dir and posted as a" >&2
	echo "  secret gist under the logged-in account. No extension can prevent it." >&2
	echo "  Remedy: gh auth logout, and unset GH_TOKEN and GITHUB_TOKEN" >&2
	failed=1
fi

if [ "$failed" -eq 1 ]; then
	if [ "$warn_only" -eq 1 ]; then
		echo "  --warn-only: reporting the risk, not failing the build." >&2
		exit 0
	fi
	exit 1
fi

echo "OK: gh is unauthenticated and no Radius credential is stored; /share cannot upload."
exit 0
