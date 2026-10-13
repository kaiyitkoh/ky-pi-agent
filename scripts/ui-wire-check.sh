#!/bin/sh
#
# Live prompt-cache check over the local diagnostics logs. Reads already-redacted files only; sends nothing anywhere.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cli="$script_dir/ui-wire-check.mjs"

die() {
	printf '%s\n' "ui-wire-check: $*" >&2
	exit 1
}

command -v node >/dev/null 2>&1 || die "node is required"

exec node "$cli" "$@"
