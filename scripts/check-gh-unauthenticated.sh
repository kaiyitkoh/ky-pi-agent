#!/bin/sh
#
# SAFE-16 -- the only control that exists over Pi's `/share`.
#
# ---------------------------------------------------------------------------
# What /share does
# ---------------------------------------------------------------------------
# `/share` exports the ENTIRE session -- source code, prompts, anything pasted
# into the conversation, including secrets -- to `os.tmpdir()/session.html`
# (pi 0.84.1 src/modes/interactive/interactive-mode.ts:5869) and then runs
#   spawn("gh", ["gist", "create", "--public=false", tmpFile])
# on it (:5907). "Secret gist" means unlisted, not private: anyone with the URL
# can read it, and it is stored on GitHub under the authenticated account.
#
# ---------------------------------------------------------------------------
# CLOSED DOOR #1: no extension can block it
# ---------------------------------------------------------------------------
# `/share` is matched as a LITERAL STRING inside the interactive editor's submit
# handler (interactive-mode.ts:2902) and appears in the built-in slash-command
# table (src/core/slash-commands.ts:25). That match happens before extension
# commands are dispatched and before the `input` event fires, so there is no
# hook -- `input`, `tool_call`, or otherwise -- that is upstream of it. The
# authored safety layer cannot reach this. Do not plan around a hook that does
# not exist.
#
# ---------------------------------------------------------------------------
# CLOSED DOOR #2: the gist scope cannot be dropped
# ---------------------------------------------------------------------------
# `gh auth refresh --remove-scopes gist` is not a workaround. `gh auth refresh
# --help` states verbatim that the minimum set of scopes (repo, read:org and
# gist) cannot be removed [VERIFIED: gh 2.93.0, executed 2026-08-13]. Keeping
# `gh` usable for git-over-HTTPS while stripping only `gist` is IMPOSSIBLE.
# `gh auth logout` is the entire remedy. Both doors are closed; this comment
# exists so neither is re-litigated.
#
# ---------------------------------------------------------------------------
# The one branch that stops it
# ---------------------------------------------------------------------------
#   const authResult = spawnSync("gh", ["auth", "status"], {encoding: "utf-8"});
#   if (authResult.status !== 0) { showError(...); return; }
# (interactive-mode.ts:5856-5866). The export at :5869 is downstream of that
# return, so an unauthenticated `gh` aborts /share BEFORE the transcript is ever
# written to disk. `gh auth status` exiting non-zero IS the control. This script
# classifies which side of that branch the machine is on.
#
# Usage: sh scripts/check-gh-unauthenticated.sh [--warn-only]
#
set -e

warn_only=0
case "${1:-}" in
"")
	;;
--warn-only)
	warn_only=1
	;;
*)
	printf 'FATAL: unknown argument: %s\n' "$1" >&2
	printf 'Usage: sh scripts/check-gh-unauthenticated.sh [--warn-only]\n' >&2
	exit 2
	;;
esac

# No `gh` on PATH means the spawnSync at :5856 cannot succeed, so /share takes
# its error branch and returns. Nothing to do.
if ! command -v gh >/dev/null 2>&1; then
	echo "OK: gh is not installed; /share cannot upload."
	exit 0
fi

if gh auth status >/dev/null 2>&1; then
	echo "gh IS authenticated. /share can upload this session to a GitHub gist." >&2
	echo "  The transcript would be exported to the OS temp dir and posted as a" >&2
	echo "  secret gist under the logged-in account. No extension can prevent it." >&2
	echo "  Remedy (the only one): gh auth logout" >&2
	if [ "$warn_only" -eq 1 ]; then
		echo "  --warn-only: reporting the risk, not failing the build." >&2
		exit 0
	fi
	exit 1
fi

echo "OK: gh is unauthenticated; /share aborts before export."
exit 0

# ---------------------------------------------------------------------------
# Why there are two modes
# ---------------------------------------------------------------------------
# The DEV MACHINE runs this with --warn-only. `gh` is legitimately authenticated
# here: the git remote is HTTPS and no SSH key exists, so the `gh` credential is
# how this repo is pushed. Logging out to make a check go green would break the
# developer's git access -- so the dev machine reports the risk and continues.
#
# The WORK LAPTOP runbook runs it BARE, where a non-zero exit is the point.
#
# The live application -- `gh auth logout` executed on the work laptop, then
# confirmed by `gh auth status` exiting non-zero and by /share actually aborting
# in a real Pi session -- is OUTSTANDING. It is recorded in docs/RUNBOOK.md and
# must never be reported as passed on the strength of the unit test, which
# proves the classifier, not the machine.
