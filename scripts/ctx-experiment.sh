#!/bin/sh
#
# Runs the pre-registered minimal-vs-full context experiment end to end.
#
# SAFETY: the minimal arm gives a model bash and no safety layer, so every trial
# runs in a disposable repo under a scrubbed environment (env -i with an explicit
# allowlist). Nothing from the operator's environment crosses except PATH, the
# Windows system root, and the single provider key variable named by KY_EXP_KEY_VAR.
# HOME, USERPROFILE, TMP/TEMP and the Pi agent dir all point into the per-trial root.
#
# Required env: KY_EXP_MODEL (provider/model id), KY_EXP_KEY_VAR (NAME of the variable
# holding the provider key). Optional: KY_EXP_SEED, KY_EXP_REPEATS, KY_EXP_DEFECTS,
# KY_EXP_PI, KY_EXP_OUT.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cli="$script_dir/ctx-experiment.mjs"

die() {
	printf '%s\n' "ctx-experiment: $*" >&2
	exit 1
}

[ -n "${KY_EXP_MODEL:-}" ] || die "KY_EXP_MODEL is required (provider/model id)"
[ -n "${KY_EXP_KEY_VAR:-}" ] || die "KY_EXP_KEY_VAR is required (the NAME of the env var holding the provider key)"
case "$KY_EXP_KEY_VAR" in
	*[!A-Za-z0-9_]* | [0-9]* | [Aa][Ww][Ss]_*) die "KY_EXP_KEY_VAR is not an acceptable variable name: $KY_EXP_KEY_VAR" ;;
esac
key_value=$(printenv "$KY_EXP_KEY_VAR" 2>/dev/null || true)
[ -n "$key_value" ] || die "environment variable $KY_EXP_KEY_VAR is not set"

seed=${KY_EXP_SEED:-20261013}
pi_bin=${KY_EXP_PI:-pi}
out=${KY_EXP_OUT:-logs/ctx-experiment/$(date -u +%Y%m%dT%H%M%SZ)}
repeat_args=
if [ -n "${KY_EXP_REPEATS:-}" ]; then
	repeat_args="--repeats $KY_EXP_REPEATS"
fi

mkdir -p "$out"
out=$(CDPATH= cd -- "$out" && pwd)
# shellcheck disable=SC2086
node "$cli" plan --seed "$seed" $repeat_args --defects "${KY_EXP_DEFECTS:-}" >"$out/trials.tsv"
: >"$out/failures.tsv"
pad_file="$out/pad.txt"
node "$cli" pad "$pad_file"

# Native-style paths where available so a Windows pi sees paths it understands.
native() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
	else
		printf '%s\n' "$1"
	fi
}

tab=$(printf '\t')
newline='
'
total=$(wc -l <"$out/trials.tsv" | tr -d ' ')
count=0

while IFS="$tab" read -r trial_id arm defect repeat <&3; do
	count=$((count + 1))
	file_id=$(printf '%s' "$trial_id" | tr -c 'A-Za-z0-9_.-' '_')
	trial_root=$(mktemp -d)
	mkdir -p "$trial_root/home" "$trial_root/tmp" "$trial_root/agent"
	node "$cli" prepare "$defect" "$(native "$trial_root")"
	node "$cli" settings "$(native "$trial_root/agent")" "$arm"

	pad_arg=
	if [ "$arm" = "C" ]; then
		pad_arg=$(native "$pad_file")
	fi
	arm_args=$(node "$cli" args "$arm" $pad_arg)
	prompt=$(cat "$trial_root/prompt.md")

	root_native=$(native "$trial_root")
	old_ifs=$IFS
	IFS=$newline
	set -f
	# shellcheck disable=SC2086
	set -- $arm_args
	set +f
	IFS=$old_ifs

	printf '%s\n' "[$count/$total] $trial_id" >&2
	status=0
	(
		cd "$trial_root/repo"
		env -i PATH="$PATH" HOME="$root_native/home" USERPROFILE="$root_native/home" \
			TMP="$root_native/tmp" TEMP="$root_native/tmp" TMPDIR="$root_native/tmp" \
			PI_CODING_AGENT_DIR="$root_native/agent" ${SYSTEMROOT:+SYSTEMROOT="$SYSTEMROOT"} \
			"$KY_EXP_KEY_VAR=$key_value" \
			"$pi_bin" --model "$KY_EXP_MODEL" "$@" "$prompt" \
			</dev/null >"$out/$file_id.jsonl" 2>"$out/$file_id.stderr.log"
	) || status=$?
	if [ "$status" -ne 0 ]; then
		printf '%s\t%s\n' "$trial_id" "$status" >>"$out/failures.tsv"
	fi
	rm -rf "$trial_root"
done 3<"$out/trials.tsv"

node "$cli" summarise "$out"
