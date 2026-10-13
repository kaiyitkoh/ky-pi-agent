/**
 * Documentation policy — the README's honesty obligations and the runbook's
 * outstanding-status guard.
 *
 * THE RULE THIS FILE ENCODES. Per the standing operating policy for this
 * project, a `[RUNBOOK]`-shaped check is *built*, *unit-verified offline*, and
 * then *recorded as outstanding*. It is never reported as passed. Moving a
 * status to passed requires a human to have executed the command on the
 * machine that has the missing thing — the work laptop, a clean profile, a
 * TTY — and read the output. Because that is exactly the kind of claim that
 * decays into an assumption, the flip must be a deliberate edit that fails
 * this test until the test is updated in the same change. A status that can be
 * changed silently is not a status; it is a wish.
 *
 * WHY THE README IS IN SCOPE OF A TEST AT ALL. ROADMAP success criterion 1
 * makes the README load-bearing: the supply-chain control has real residual
 * gaps, and those gaps are mitigated *only* by the operator knowing about
 * them. An over-reassuring README is therefore not a documentation problem,
 * it is the vulnerability. Group A asserts the specific strings that carry the
 * honesty, so a tidy-up rewrite cannot quietly drop them.
 *
 * THE VACUOUS-PASS GUARD. Group B scans the runbook for test-file references
 * and asserts each one exists on disk. That scan is asserted non-empty first:
 * a regex that matches nothing would otherwise pass while proving nothing —
 * the failure shape this phase has already tripped over more than once.
 *
 * THE GUARD SPANS THREE PHASES. It was written in Phase 1 against a literal
 * `RB-01-\d{2}`, which meant appending Phase 2's entries would have left three
 * new statuses completely unguarded — the one outcome the policy above exists
 * to prevent, arriving quietly through a file that was never touched. The id
 * pattern is now `RB-<phase>-<n>` and {@link ALL_IDS} drives Group B and
 * Group C, so a future phase adds its ids to one array and inherits the whole
 * guard. Phase 3 is the first phase to collect on that promise: extending
 * {@link ALL_IDS} and adding five {@link ENTRY_COMMANDS} rows was the entire
 * change, and `ID_RE`, {@link runbookEntryStatuses} and both loops below were
 * left alone. Group C carries a synthetic `RB-02-01` fixture and a synthetic
 * `RB-03-01` fixture as well as the Phase 1 ones, because a generalisation
 * that only the real file exercises is a generalisation nobody has tested.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	REDACTED_HEADER_KEY_RE,
	TRUNCATION_PLACEHOLDER,
} from "../../.pi/extensions/diagnostics/redact.ts";
import { repoRoot } from "../helpers/git.ts";
import { RULE_IDS } from "../../.pi/extensions/quality/rules.ts";
import { DEFECT_CLASSES } from "../fixtures/seeded-defects/index.ts";
import { ARTIFACT_FILES } from "../../.pi/lib/work-artifacts.ts";
import { SPEC_SECTIONS } from "../../.pi/extensions/grill/spec-schema.ts";
import { AMBIGUITY_DIMENSIONS } from "../../.pi/extensions/grill/scorecard.ts";
import { GATE_DEPTH_BY_WORKFLOW, QUALITY_MECHANISMS } from "../../.pi/extensions/quality/gates.ts";

const ROOT = repoRoot();
const README = readFileSync(join(ROOT, "README.md"), "utf-8");
const RUNBOOK_PATH = join(ROOT, "docs", "RUNBOOK.md");
const DIAGNOSTICS_PATH = join(ROOT, "docs", "DIAGNOSTICS.md");
const QUALITY_PATH = join(ROOT, "docs", "QUALITY.md");
const REDACT_SOURCE_PATH = join(ROOT, ".pi", "extensions", "diagnostics", "redact.ts");

/** The Phase 1 entries this file governs. */
const PHASE_ONE_IDS = ["RB-01-01", "RB-01-02", "RB-01-03"] as const;

/**
 * The Phase 2 entries this file governs.
 *
 * All three need the work laptop and live provider credentials: a real turn per
 * provider (RB-02-01), a real credential passing through the capture path
 * (RB-02-02), and a working day of real DeepSeek V4 Flash traffic (RB-02-03).
 */
const PHASE_TWO_IDS = ["RB-02-01", "RB-02-02", "RB-02-03"] as const;

/**
 * The Phase 3 entries this file governs.
 *
 * All five need the work laptop and a credential this machine does not hold: a
 * live DashScope key for the wire-level compat check (RB-03-01) and the
 * two-turn tool-calling check (RB-03-02), an IAM Identity Center session for
 * Bedrock (RB-03-03), a live DeepSeek-direct key for the R1 token counts
 * (RB-03-04), and a Model Studio console login for the real cap and price
 * (RB-03-05). Every one of them has a green offline proxy in this repository,
 * and not one of those proxies is the check — which is the entire reason this
 * array exists rather than a `[x]` in a requirements file.
 */
const PHASE_THREE_IDS = ["RB-03-01", "RB-03-02", "RB-03-03", "RB-03-04", "RB-03-05"] as const;

/**
 * The Phase 4 entry this file governs.
 *
 * SAFE-01 needs the work laptop specifically: this machine has no GitLab
 * access, no work-laptop credentials, and no network egress, so whether
 * GitLab's protected-branch rule is actually configured on `main` is a fact
 * about a server this machine cannot reach. `tests/integration/gitlab-push-protection.test.ts`
 * proves the harness reads and classifies a server-side rejection correctly
 * against a real local bare repo and a real `pre-receive` hook subprocess —
 * and that proof is not this check, which is exactly why the array exists
 * rather than a `[x]` in a requirements file.
 */
const PHASE_FOUR_IDS = ["RB-04-01", "RB-04-02"] as const;

/**
 * The Phase 5 entry this file governs.
 *
 * ROUTE-11 needs the work laptop specifically: this machine has no
 * `QODER_PERSONAL_ACCESS_TOKEN`, no pre-configured agent or environment, and
 * no network egress to `api.qoder.com`, so whether a real personal access
 * token authenticates and a real delegation completes is a fact about a
 * service this machine cannot reach. `tests/integration/qoder-delegate.test.ts`
 * proves the harness constructs the right requests and parses a response
 * shaped like Qoder's documented envelope, against a real local
 * `127.0.0.1` HTTP+SSE fixture — and that proof is not this check, which is
 * exactly why the array exists rather than a `[x]` in a requirements file.
 */
const PHASE_FIVE_IDS = ["RB-05-01"] as const;

/**
 * The Phase 7 entries this file governs.
 *
 * No `PHASE_SIX_IDS` exists between this array and {@link PHASE_FIVE_IDS} —
 * Phase 6 (Quality Gates walking skeleton) added no runbook entries, so this
 * is simply the next append, per "append, never renumber." An empty
 * placeholder array would add nothing but a stale-looking gap; its absence is
 * intentional and this comment is the record of why.
 *
 * EXT-09 needs the work laptop specifically, and for more of its four legs
 * than any prior single Phase 7 requirement: a real turn per provider
 * (`RB-02-01`/`RB-03-0x`, composed rather than restated), a real subagent
 * spawn against a real installed `pi-subagents` package, and a real wire
 * dump — only the blocked-command leg is fully provable offline
 * (`tests/integration/subagent-block.test.ts`,
 * `tests/unit/evasion-corpus.test.ts`). `RB-07-02` is a second, distinct
 * entry Phase 7 could not avoid: plan 07-10's blocking package-legitimacy
 * install gate was found NOT SATISFIED on this machine (its own
 * pre-authorisation ground — "no credentials on this machine" — is FALSE,
 * live AWS SSO / static admin keys are present), so no package has ever
 * been installed and `pi list` has never been reconciled against
 * `.pi/settings.json`. `RB-07-01`'s second and third legs presuppose
 * `RB-07-02` has already run.
 *
 * `RB-07-03` was appended by this phase's code-review fix pass (CR-01). The
 * real AWS account number, IAM principal ARN and admin profile name recorded
 * by plan 07-10 have been redacted from every tracked file and are guarded by
 * `tests/unit/secret-scan.test.ts` — but they remain in local, unpushed commit
 * objects, and the choice between rewriting 400-plus commits of history and
 * accepting the exposure is the account owner's to make, not an agent's. It is
 * OUTSTANDING for that reason and not because a machine could not do it.
 */
const PHASE_SEVEN_IDS = ["RB-07-01", "RB-07-02", "RB-07-03"] as const;

/**
 * The Phase 8 entries this file governs.
 *
 * Three ids, each blocked by a fact already recorded in a PRIOR phase's own
 * runbook section rather than a new one this phase discovers: `RB-08-01`
 * (GATE-10's main-loop half) needs live provider credentials this machine
 * does not hold, exactly like `RB-02-01`, and is gated behind it directly.
 * `RB-08-02` (GATE-01's LSP leg) and `RB-08-03` (GATE-02/GATE-08's live
 * reviewer and live calibration run) are both gated behind `RB-07-02` —
 * nothing has ever been installed on this machine, so neither
 * `@narumitw/pi-lsp` nor a real `pi-subagents` spawn has ever run. All three
 * ids are cited BY NAME in code and test comments written before this phase's
 * closing plan (`quality/gates.ts`'s `probeLspAvailability` docstring names
 * `RB-08-02`; `tests/unit/subagent-agents-config.test.ts`'s
 * `UNROUTED_AGENT_ALLOWLIST` and `quality/calibration.ts`'s own header name
 * `RB-08-03`) — this array is what turns those forward references into
 * governed entries rather than dangling ones.
 */
const PHASE_EIGHT_IDS = ["RB-08-01", "RB-08-02", "RB-08-03"] as const;
const PHASE_EIGHT_TWO_IDS = ["RB-08-04"] as const;
const PHASE_NINE_IDS = ["RB-09-01", "RB-09-02", "RB-09-03"] as const;
const PHASE_TEN_IDS = ["RB-10-01", "RB-10-02", "RB-10-03"] as const;
const PHASE_ELEVEN_IDS = ["RB-11-01", "RB-11-02", "RB-11-03"] as const;
const PHASE_TWELVE_IDS = ["RB-12-01", "RB-12-02", "RB-12-03", "RB-12-04", "RB-12-05", "RB-12-06", "RB-12-07"] as const;

/** Every governed entry, in phase order. A later phase appends its array here. */
const ALL_IDS = [
	...PHASE_ONE_IDS,
	...PHASE_TWO_IDS,
	...PHASE_THREE_IDS,
	...PHASE_FOUR_IDS,
	...PHASE_FIVE_IDS,
	...PHASE_SEVEN_IDS,
	...PHASE_EIGHT_IDS,
	...PHASE_EIGHT_TWO_IDS,
	...PHASE_NINE_IDS,
	...PHASE_TEN_IDS,
	...PHASE_ELEVEN_IDS,
	...PHASE_TWELVE_IDS,
] as const;

/**
 * Matches any runbook entry id, of any phase.
 *
 * Deliberately `RB-<2 digits>-<2 digits>` rather than a literal phase number:
 * the Phase 1 version was `RB-01-\d{2}`, so Phase 2's entries would have been
 * invisible to the parser and their statuses unguarded.
 */
const ID_RE = /RB-\d{2}-\d{2}/g;

/**
 * Extracts the recorded status token for every `RB-<phase>-<n>` id in a runbook.
 *
 * Two independent sources are read and required to agree:
 *
 *   - the summary table row  `| RB-01-01 | ... | OUTSTANDING |`
 *   - the detail subsection  `### RB-01-01 — ...` followed by `**Status:** X`
 *
 * Requiring agreement is the point. A partial flip — someone marks the table
 * passed and forgets the subsection, or vice versa — is the most likely way
 * this file goes wrong in practice, and it would leave a reader with two
 * contradictory answers and no signal. Disagreement is reported as
 * `INCONSISTENT`, which is never an acceptable status, so the suite fails
 * either way.
 *
 * Returns `MISSING` for an id that appears with no status at all: per the
 * runbook's own contract, an entry without a status line is a bug in the file.
 */
export function runbookEntryStatuses(markdown: string): Record<string, string> {
	const ids = Array.from(new Set(markdown.match(ID_RE) ?? []));
	const out: Record<string, string> = {};

	for (const id of ids) {
		const fromTable = tableStatus(markdown, id);
		const fromSection = sectionStatus(markdown, id);

		if (fromTable !== undefined && fromSection !== undefined) {
			out[id] = fromTable === fromSection ? fromTable : "INCONSISTENT";
		} else {
			out[id] = fromTable ?? fromSection ?? "MISSING";
		}
	}
	return out;
}

/** Normalise a raw status cell to its leading token: `PASSED — 2026-08-13` -> `PASSED`. */
function normaliseStatus(raw: string): string {
	const cleaned = raw.replace(/[*`]/g, "").trim();
	const token = cleaned.split(/[\s—-]+/)[0] ?? "";
	return token.toUpperCase();
}

/** Status read from a summary-table row whose first cell is exactly `id`. */
function tableStatus(markdown: string, id: string): string | undefined {
	for (const line of markdown.split("\n")) {
		if (!line.trimStart().startsWith("|")) continue;
		const cells = line.split("|").slice(1, -1).map((c) => c.trim());
		if (cells.length < 2) continue;
		if (cells[0].replace(/[*`]/g, "") !== id) continue;
		const last = cells[cells.length - 1];
		if (last === "") continue;
		return normaliseStatus(last);
	}
	return undefined;
}

/** Status read from the `**Status:**` line inside the `### <id> …` subsection. */
function sectionStatus(markdown: string, id: string): string | undefined {
	const lines = markdown.split("\n");
	let inSection = false;

	for (const line of lines) {
		const heading = /^(#{2,6})\s+(.*)$/.exec(line);
		if (heading) {
			inSection = heading[2].includes(id);
			continue;
		}
		if (!inSection) continue;
		const status = /^\s*\*\*Status:\*\*\s*(.+?)\s*$/.exec(line);
		if (status) return normaliseStatus(status[1]);
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Group A — README obligations
// ---------------------------------------------------------------------------

/**
 * Each entry is a string the README must contain, paired with the reason it is
 * load-bearing. The reason travels with the assertion so a future reader who
 * hits the failure knows what was being protected rather than just deleting
 * the row.
 */
const README_REQUIRED: readonly (readonly [string, string])[] = [
	["ignore-scripts", "the name of the control itself; without it the README describes nothing"],
	[
		"npm_config_ignore_scripts",
		"the one-shot ritual for the paths no committed file can cover — the only mitigation the uncovered cases have",
	],
	["bin/bootstrap.sh", "how a second machine acquires the user-scope control, which does not travel with a clone"],
	["--assert-hardening", "the verification step that makes the setup instruction checkable rather than hopeful"],
	["--check-only", "the non-mutating variant, so a reader knows there is a way to look without changing anything"],
	["22.19.0", "Pi's hard Node engine floor; a second machine below it fails obscurely"],
	["gh auth logout", "the only control over /share, per SAFE-16"],
	["check-gh-unauthenticated.sh", "how to see which side of that control the machine is currently on"],
	["not covered", "the literal honesty clause required by ROADMAP success criterion 1"],
	["CONTRIBUTING.md", "the boundary rule lives there and the README is the only path to it"],
	["pick one delivery path", "the stub and a git package are two diverging copies of the guard"],
	["pi install git:github.com/kaiyitkoh/ky-pi-agent@", "the git install must carry a ref; an unrefed install is never moved by pi update"],
];

/**
 * A run of 40+ characters drawn only from the token alphabet.
 *
 * This is a paste guard, not a secret scanner. The README is public and is
 * written on a machine holding live credentials; the realistic accident is a
 * terminal paste that carried a token along with the command. Ordinary prose,
 * paths and URLs break the run on a space, dot or slash long before 40.
 */
const TOKEN_SHAPED = /[A-Za-z0-9+/=_-]{40,}/g;

/** A Windows absolute path from this developer's machine. Assembled, not written. */
const DEV_ABS_PATH = `C:${String.fromCharCode(92)}Users${String.fromCharCode(92)}`;

describe("Group A — README states what the supply-chain control does not cover", () => {
	for (const [needle, why] of README_REQUIRED) {
		it(`contains ${JSON.stringify(needle)}`, () => {
			expect(README, `README.md must contain ${JSON.stringify(needle)} — ${why}`).toContain(needle);
		});
	}

	it("never shows an unrefed pi install of this repository", () => {
		const unrefed = README.match(/pi install (?:https?:[/][/]|git:)github[.]com[/]kaiyitkoh[/]ky-pi-agent(?!@)/g) ?? [];
		expect(unrefed, "an unrefed git install is never moved by pi update; pin it to a tag or commit").toEqual([]);
	});

	it("keeps the work-in-progress framing it was written with", () => {
		expect(
			README,
			"the status paragraph is the README's most honest line and predates this phase; extending the " +
				"document must not quietly promote it to a finished project",
		).toContain("Status: work in progress");
		expect(README).toContain("## What this is");
	});

	it("leaks no token-shaped string", () => {
		const hits = README.match(TOKEN_SHAPED) ?? [];
		expect(
			hits,
			"a 40+ character token-alphabet run in a public README is almost always a pasted credential; " +
				"if this is a false positive, narrow the pattern deliberately rather than deleting the check",
		).toEqual([]);
	});

	it("leaks no absolute path from the development machine", () => {
		expect(
			README.includes(DEV_ABS_PATH),
			"README.md contains a developer-machine absolute path — it is public, and such a path is both " +
				"useless to a reader and an unnecessary disclosure of the local layout",
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Group B — runbook structure
// ---------------------------------------------------------------------------

/** The command each entry must name, so the reader has nothing to guess at. */
const ENTRY_COMMANDS: Readonly<Record<string, readonly string[]>> = {
	"RB-01-01": ["sh scripts/check-gh-unauthenticated.sh", "gh auth logout"],
	"RB-01-02": ["pi install git:github.com/kaiyitkoh/ky-pi-agent@v1.0.0", "pi --list-models"],
	"RB-01-03": ["/reload"],
	// Fragments, not whole command lines: each is short enough to survive a
	// reflow of the surrounding markdown and specific enough that a rewrite
	// dropping the command fails here.
	"RB-02-01": ["tail -n 1 .pi/logs/wire-"],
	"RB-02-02": ["grep -rIEn", ".pi/logs/"],
	// RB-02-03 pins the FOUR COUNTING COMMANDS IN FULL, not fragments of them.
	//
	// Fragments were not enough here. Each of these commands carries a fix for a
	// specific defect -- the `grep -F '"kind":"turn"'` prefilter stops the numerator
	// double-counting the standalone record beside the turn row (a detected prose turn
	// can leave both, and they share the same `event` value), and the `cat ... |`
	// prefix makes `grep -c` over a rotated glob yield one total instead of
	// `file:count` per file -- and the runbook DESCRIBES those same fragments in the
	// prose underneath the steps. A fragment pin therefore stayed green when the
	// fragment was deleted from the command and left in the explanation, which is the
	// whole failure this pin exists to catch. Pinning the complete line is safe
	// because each command sits inside backticks on one line of a numbered list and is
	// not subject to reflow.
	//
	// [WR-01R] The NUMERATOR counts TURN ROWS, not the kind-less action records. The
	// verdict is stamped on the turn accumulator before the retry budget is consulted
	// (`index.ts`), so every detected prose turn leaves a turn row; the kind-less
	// record is written only when a retry was actually issued, and `MAX_PROSE_RETRIES`
	// is 1 per agent run, so every prose turn after the first in a run is invisible to
	// it. Measured on a fixture holding both shapes: the action count reports 1/3 where
	// the turn-row count reports the true 2/3.
	//
	// Read against a published ~11% baseline, an inflated rate looks like loud
	// confirmation of the leading root-cause hypothesis and a deflated one looks like
	// refutation. Both directions are pinned rather than trusted, which is why the
	// action commands are also here: steps 3 and 4 must sum to step 1.
	"RB-02-03": [
		`cat .pi/logs/turns-*.jsonl | grep -F '"kind":"turn"' | grep -cF '"event":"prose_tool_call"'`,
		`cat .pi/logs/turns-*.jsonl | grep -cF '"kind":"turn"'`,
		`cat .pi/logs/turns-*.jsonl | grep -F '"event":"prose_tool_call"' | grep -v '"kind":' | wc -l`,
		`cat .pi/logs/turns-*.jsonl | grep -cF '"event":"prose_tool_call_retry_exhausted"'`,
	],
	// PHASE 3 PINS WHOLE ONE-LINE COMMANDS, following RB-02-03's lesson above
	// rather than RB-02-01/02's fragments. Every command below sits inside
	// backticks on a single line of a numbered list, so it is not subject to
	// reflow, and each is distinct from every other command in the file --
	// verified once by counting occurrences in the runbook, because a pin that
	// also matches a neighbouring entry's command stays green when the entry that
	// owns it drops it, which is the same blindness the fragment pins had.
	//
	// Each of these five entries needs a credential this machine does not hold,
	// so the commands are the only thing about them that CAN be checked here.
	// Pinning them is what stops a documentation tidy-up leaving an operator to
	// reconstruct the step -- and a step that gets reconstructed gets done
	// differently every time, in a runbook whose whole value is that two runs are
	// comparable.

	// The request record carries the compat block on the wire; the response
	// record is the 200 that says DashScope accepted it. Both are needed: a 200
	// with no `enable_thinking` is a finding, not a pass. The base-URL export is
	// pinned whole because the remedy is worthless in halves -- exporting the
	// variable without re-running bootstrap changes nothing on disk.
	"RB-03-01": [
		`cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 1`,
		`grep -F '"kind":"main.response"' .pi/logs/wire-$(date +%F).jsonl | tail -n 1`,
		`export KYPI_DASHSCOPE_BASE_URL="https://<WorkspaceId>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" && sh bin/bootstrap.sh`,
	],

	// `tail -n 2`, not `-n 1`: the FIRST turn of a tool sequence always works, so
	// a procedure that reads one record reads the turn that cannot fail. The
	// turns command is what surfaces the provider's message when the second
	// request 4xx'd and therefore left no response record at all.
	"RB-03-02": [
		`cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 2`,
		`cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"kind":"turn"' | tail -n 2`,
	],

	// The `&& echo` half is not decoration and must not be dropped: `aws sso
	// login` sets no environment variable, so a successful login with an empty
	// `AWS_PROFILE` is precisely the state in which Bedrock does not work and
	// everything looks configured. The turns-row command is provider-filtered so
	// it cannot be satisfied by some other provider's row.
	"RB-03-03": [
		`aws sso login --profile X && echo $AWS_PROFILE`,
		`cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"provider":"amazon-bedrock"' | tail -n 1`,
	],

	// Step 1 is the stop condition for the whole experiment -- a malformed
	// `modelOverrides` edit invalidates every measurement below it -- and steps 4
	// and 5 are the two records the four recorded fragments come from.
	"RB-03-04": [
		"pi --list-models | grep deepseek-flash",
		`tail -n 5 .pi/logs/wire-$(date +%F).jsonl`,
		`cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"kind":"turn"' | tail -n 1`,
	],

	// The vitest run is the step that makes the console reading land in the
	// repository rather than in a note: the allowlist is asserted in both
	// directions, so a price written into the template without the matching
	// allowlist removal fails there and nowhere else.
	"RB-03-05": [
		"npx vitest run tests/unit/model-metadata.test.ts",
		`pi --list-models | grep -F 'deepseek-v4-pro'`,
	],

	// PHASE 4 PINS WHOLE ONE-LINE COMMANDS TOO, same discipline as Phase 3. The
	// clean-up step is pinned alongside the check itself -- a runbook step that
	// leaves a stray commit sitting on `main` locally is a step half-written.
	"RB-04-01": [
		"cd <work-repo> && git checkout main && git pull",
		`echo "RB-04-01 push-protection check $(date -u +%FT%TZ)" >> RB-04-01-CHECK.md && git add RB-04-01-CHECK.md && git commit -m "RB-04-01: protected-branch push check (not meant to land)"`,
		"git push origin main",
		"git reset --hard HEAD~1",
	],
	"RB-04-02": [`pi -p "run: git push -u origin rb-04-02"`, "git push origin --delete rb-04-02"],

	// PHASE 5 PINS WHOLE ONE-LINE COMMANDS TOO, same discipline as Phases 3-4.
	// The credential/id exports are pinned whole because a placeholder-only
	// half (naming the env var but not the export line) is not something an
	// operator can copy-paste, and the transcript-read command is the only
	// step that surfaces the pass/fail signal without a live PAT to inspect
	// interactively.
	"RB-05-01": [
		"export QODER_PERSONAL_ACCESS_TOKEN=pt-<paste the token from qoder.com/account/integrations>",
		"export QODER_AGENT_ID=<agent-id> QODER_ENVIRONMENT_ID=<environment-id>",
		`cat .pi/logs/qoder-$(date +%F).jsonl | tail -n 5`,
	],

	// PHASE 7 PINS WHOLE ONE-LINE COMMANDS TOO, same discipline as Phases 3-5.
	// RB-07-01's second leg deliberately does NOT pin `pi list` -- that command
	// belongs to RB-07-02 alone, and RB-07-01's own procedure text points at
	// RB-07-02's reconciliation step by id instead of restating the command.
	// Verified by grep before commit: `git status --porcelain` and the audit
	// tail command below each occur exactly once in docs/RUNBOOK.md, and every
	// `pi install -l npm:...` line plus `pi list` occur only inside RB-07-02's
	// own section -- so an entry that drops its own copy cannot stay green on
	// a neighbouring entry's.
	"RB-07-01": [
		"git status --porcelain",
		`tail -n 1 .pi/logs/audit-$(date +%F).jsonl`,
	],
	// RB-07-03 pins the two DISCOVERY commands, not the remedy: `git filter-repo`
	// is named in prose as Option A but is deliberately NOT pinned here, because
	// the operator may legitimately choose Option B (accept and rotate) and a
	// pinned remedy command would imply one branch is the expected one. Both
	// commands below were grepped before commit and occur exactly once in
	// docs/RUNBOOK.md, inside RB-07-03's own section.
	"RB-07-03": [
		"git ls-remote --heads origin",
		'git log --all --oneline -S"$KYPI_REDACTED_ACCOUNT_ID"',
	],
	"RB-07-02": [
		"pi install -l npm:pi-subagents@0.76.1",
		"pi install -l npm:@narumitw/pi-lsp@0.49.9",
		"pi install -l npm:pi-web-access@0.38.0",
		"pi install -l npm:pi-session-finder@0.5.6",
		"pi list",
		"npx vitest run tests/unit/extension-pins.test.ts",
	],

	// PHASE 8 PINS WHOLE ONE-LINE COMMANDS TOO, same discipline as Phases 3-7.
	// RB-08-01 deliberately does NOT re-pin RB-02-01's own
	// `tail -n 1 .pi/logs/wire-$(date +%F).jsonl` fragment -- that exact whole
	// line already sits inside RB-02-01's own procedure, and pinning it a
	// second time here would make BOTH entries' pins go green if either one's
	// step dropped its own copy. RB-08-01's own read command is a distinct
	// three-provider form instead. RB-08-02 and RB-08-03 do not re-pin any of
	// RB-07-02's five `pi install -l ...` lines or its `pi list` line, for the
	// identical reason RB-07-01 already established for that command.
	// Verified by grep before commit: every command below occurs exactly once
	// in docs/RUNBOOK.md, inside its own entry's section.
	"RB-08-01": [
		`cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 3`,
	],
	"RB-08-02": ["git checkout -- <file>"],
	"RB-08-04": ['pi -p "Quote the first bullet under the Code comments heading in your system prompt, verbatim."'],
	"RB-08-03": [
		'echo "RB-08-03 live catch rate: <caught>/<total>, $(date -u +%FT%TZ)" >> RB-08-03-RESULT.md',
	],

	// Whole one-line commands, each occurring exactly once in the runbook (asserted in Group B).
	"RB-09-01": [
		"cat .pi/work/<slug>/PROGRESS.md",
		"git diff --name-only $(git merge-base HEAD staging)..HEAD",
	],
	"RB-09-02": ["glab mr create --help | grep -i description", "glab mr view <iid>"],
	"RB-09-03": [
		"npx vitest run tests/unit/handoff-packet.test.ts --maxWorkers=2",
		'echo "RB-09-03 parent-token delta: <live>, packet <tokens>, $(date -u +%FT%TZ)" >> RB-09-03-RESULT.md',
	],

	"RB-10-01": [
		"npx vitest run tests/unit/ctx-experiment.test.ts --maxWorkers=2",
		"KY_EXP_MODEL=<provider/model> KY_EXP_KEY_VAR=<KEY_ENV_NAME> sh scripts/ctx-experiment.sh",
		'echo "RB-10-01 decision: <DEGRADES|NO_DETECTABLE_EFFECT|INCONCLUSIVE>, d=<d> [<lo>,<hi>], label=<discrimination>, $(date -u +%FT%TZ)" >> RB-10-01-RESULT.md',
	],
	"RB-10-02": [
		'echo "RB-10-02 turn-2 cacheRead ratio: <ratio>, after /plan toggle: <ratio>, $(date -u +%FT%TZ)" >> RB-10-02-RESULT.md',
	],
	"RB-10-03": [
		'echo "RB-10-03 <package> delta per profile: <recon>/<review>/<implement>/<full>, $(date -u +%FT%TZ)" >> RB-10-03-RESULT.md',
	],

	"RB-11-01": [
		"pi --use-theme ky",
		'echo "RB-11-01 theme ky listed=<yes|no>, header=<yes|no>, ky-statusline segments=<text>, $(date -u +%FT%TZ)" >> RB-11-01-RESULT.md',
	],
	"RB-11-02": [
		'echo "RB-11-02 pi-subagents widget seen=<yes|no>, blocking run agents=<n>, background run agents=<n>, back to none=<yes|no>, $(date -u +%FT%TZ)" >> RB-11-02-RESULT.md',
	],
	"RB-11-03": [
		'probe="ky-probe-$(date +%s)" && git switch -c "$probe" && echo x > "$probe.txt"',
		'sh scripts/ui-wire-check.sh --session <id> --probe "$probe"',
		'echo "RB-11-03 ui-wire-check <PASS|FAIL|INSUFFICIENT>, turn-2 cacheRead ratio: <ratio>, $(date -u +%FT%TZ)" >> RB-11-03-RESULT.md',
	],

	"RB-12-01": [
		"sh scripts/openspec-setup.sh --install-cli",
		"sh scripts/openspec-setup.sh --check",
		'echo "RB-12-01 openspec <version> on <machine>, --check exit <code>, $(date -u +%FT%TZ)" >> RB-12-01-RESULT.md',
	],
	"RB-12-02": [
		'echo "RB-12-02 /budget skills slice before=<chars> after=<chars>, /skill:openspec-explore expanded=<yes|no>, /opsx-explore expanded=<yes|no>, $(date -u +%FT%TZ)" >> RB-12-02-RESULT.md',
	],
	"RB-12-03": [
		"openspec config get telemetry.enabled",
		'echo "RB-12-03 telemetry.enabled=<value>, edge.openspec.dev requests seen=<n>, $(date -u +%FT%TZ)" >> RB-12-03-RESULT.md',
	],
	"RB-12-04": [
		"npm view @fission-ai/openspec time --json",
		'echo "RB-12-04 bumped <old> -> <new>, tarball reviewed=<yes|no>, --check exit <code>, $(date -u +%FT%TZ)" >> RB-12-04-RESULT.md',
	],
	"RB-12-05": [
		"sh bin/bootstrap.sh --global-setup",
		'echo "RB-12-05 packages loaded=<yes|no>, theme ky=<yes|no>, agents listed=<yes|no>, child push blocked=<yes|no>, plain command names=<yes|no>, $(date -u +%FT%TZ)" >> RB-12-05-RESULT.md',
	],
	"RB-12-06": [
		"aws bedrock list-inference-profiles --region <region>",
		"apac.anthropic.claude-sonnet-4-5-20250929-v1:0",
		'echo "RB-12-06 apac profile listed=<yes|no>, prefix in use=<prefix>, $(date -u +%FT%TZ)" >> RB-12-06-RESULT.md',
	],
	"RB-12-07": [
		'echo "RB-12-07 confirm card shown=<yes|no>, decline refused=<yes|no>, timeout refused=<yes|no>, $(date -u +%FT%TZ)" >> RB-12-07-RESULT.md',
	],
};

/** Matches a repo-relative test path mentioned anywhere in the runbook prose. */
const PROXY_PATH_RE = /tests\/[A-Za-z0-9._\-/]+\.test\.ts/g;

describe("Group B — the runbook is structurally complete", () => {
	it("exists", () => {
		expect(
			existsSync(RUNBOOK_PATH),
			"docs/RUNBOOK.md is where every check that cannot run on this machine is recorded. Without " +
				"the file those checks are not outstanding, they are forgotten",
		).toBe(true);
	});

	const runbook = readFileSync(RUNBOOK_PATH, "utf-8");

	for (const id of ALL_IDS) {
		it(`declares ${id} in a summary-table row marked OUTSTANDING`, () => {
			const row = runbook
				.split("\n")
				.find((line) => line.trimStart().startsWith("|") && line.includes(id));
			expect(row, `no summary-table row for ${id}`).toBeDefined();
			expect(
				row,
				`the ${id} table row must carry OUTSTANDING — the table is what a reader skims, so a stale ` +
					"row is a false all-clear even when the detail section below is correct",
			).toContain("OUTSTANDING");
		});

		it(`names the exact command(s) for ${id}`, () => {
			for (const cmd of ENTRY_COMMANDS[id]) {
				expect(
					runbook,
					`${id} must name ${JSON.stringify(cmd)} verbatim — a runbook step the operator has to ` +
						"reconstruct is a step that gets done differently every time",
				).toContain(cmd);
			}
		});
	}

	it("every Phase 9 pin occurs exactly once in the runbook", () => {
		for (const id of PHASE_NINE_IDS) {
			for (const cmd of ENTRY_COMMANDS[id]) {
				expect(
					runbook.split(cmd).length - 1,
					`${id} pin ${JSON.stringify(cmd)} must occur exactly once; a repeat lets another entry satisfy it`,
				).toBe(1);
			}
		}
	});

	it("names an offline proxy test for each entry, and every named test exists on disk", () => {
		const referenced = Array.from(new Set(runbook.match(PROXY_PATH_RE) ?? []));

		expect(
			referenced.length,
			"no test paths referenced in docs/RUNBOOK.md — this assertion scans that set, so an empty one " +
				"would pass while verifying nothing",
		).toBeGreaterThanOrEqual(ALL_IDS.length);

		const missing = referenced.filter((rel) => !existsSync(join(ROOT, rel)));
		expect(
			missing,
			"the runbook points at offline-proxy tests that do not exist. A runbook citing a proxy that " +
				"was never written is worse than no runbook: it converts an open question into a false " +
				"claim of partial coverage",
		).toEqual([]);
	});

	it("governs every entry the runbook declares — an id outside ALL_IDS is an unguarded status", () => {
		// [Rule 2 — missing critical functionality, added by plan 03-11] Everything
		// else in this file asserts that the ids in ALL_IDS are OUTSTANDING. Nothing
		// asserted the converse: that ALL_IDS covers the file. Both loops iterate
		// ALL_IDS, so DELETING `...PHASE_THREE_IDS` from it leaves five live checks
		// with no assertion at all and the suite GREENER than before -- the same
		// silent shape as Phase 1's literal `RB-01-\d{2}`, arriving through a
		// one-token edit instead of through a new phase. A guard that can be
		// disarmed by removing something is not a guard.
		//
		// This reads the ids OUT OF THE FILE, so a sixth Phase 3 entry appended
		// without extending PHASE_THREE_IDS also fails here rather than landing
		// unguarded.
		const declared = Object.keys(runbookEntryStatuses(runbook));

		expect(
			declared.length,
			"no RB-<phase>-<n> id parsed out of docs/RUNBOOK.md at all, so the comparison below has " +
				"nothing on one side of it and cannot fail",
		).toBeGreaterThanOrEqual(ALL_IDS.length);

		const ungoverned = declared.filter((id) => !(ALL_IDS as readonly string[]).includes(id));
		expect(
			ungoverned,
			"docs/RUNBOOK.md declares these ids and no phase array in this file lists them, so their " +
				"statuses are parsed and then asserted by nothing. Add them to the phase array for " +
				"their phase -- that is the entire cost of inheriting this guard, and it is why the " +
				"id pattern was generalised in the first place.",
		).toEqual([]);
	});

	it("RB-03-03 describes the installer this repository actually ships [WR-04]", () => {
		// THE ONLY DOC/BEHAVIOUR PAIR IN THIS FILE, AND IT EARNS ITS PLACE. Every
		// other assertion here pins a COMMAND or a STATUS; this one pins prose,
		// because the prose in question is reachable from a running session.
		// `PROFILE_PLACEHOLDER_HINT` is
		// " — no AWS profile is configured; see RB-03-03 in docs/RUNBOOK.md" and it
		// is appended on exactly the path where the user has NO profile. So the
		// operator who meets an expired SSO session is routed to this page — and it
		// used to tell them bootstrap had written an `amazon-bedrock` entry with a
		// placeholder to edit. They open the file, find no such key, and are left
		// reconciling the runbook against reality at the worst possible moment.
		//
		// The claim was true when it was written and was invalidated by the CR-01
		// fix, which made `merge_auth_json` WITHHOLD any entry still carrying a
		// `REPLACE_WITH_` value. Nothing noticed: the ENTRY_COMMANDS pins cover
		// this entry's commands and its OUTSTANDING status, not its explanation.
		//
		// BOTH SIDES ARE ASSERTED, which is what makes this a guard rather than a
		// second copy of the sentence. If a later change makes bootstrap install
		// the entry after all, the behaviour half goes red and the doc half is then
		// the thing to update — in the same commit, which is the whole point.
		const section = runbook.slice(
			runbook.indexOf("### RB-03-03"),
			runbook.indexOf("### RB-03-04"),
		);

		expect(
			section.length,
			"the RB-03-03 detail section could not be sliced out of docs/RUNBOOK.md, so every " +
				"assertion below is about an empty string. The headings this slice keys on are " +
				"`### RB-03-03` and `### RB-03-04`",
		).toBeGreaterThan(0);

		// THE BEHAVIOUR HALF, read out of the script rather than trusted.
		const bootstrap = readFileSync(join(ROOT, "bin", "bootstrap.sh"), "utf-8");
		expect(
			bootstrap,
			"bin/bootstrap.sh no longer withholds template entries that still carry a " +
				"REPLACE_WITH_ placeholder. That was the CR-01 fix: a stored env.AWS_PROFILE beats " +
				"the ambient one in Pi's own chain, so installing the placeholder silently breaks a " +
				"laptop where `export AWS_PROFILE=…` already worked. If this was reverted " +
				"deliberately, RB-03-03's step 2 now describes the wrong installer and must be " +
				"rewritten in the same commit [WR-04, CR-01]",
		).toContain("if (carriesSentinel(tpl[key])) { skipped.push(key); continue; }");

		// THE DOC HALF.
		expect(
			section,
			"RB-03-03 step 2 must say that bootstrap does NOT install the amazon-bedrock entry. " +
				"This is the page PROFILE_PLACEHOLDER_HINT sends the operator to on exactly the " +
				"path where they have no profile, so a page describing a placeholder that was " +
				"never written leaves them reconciling the runbook against an auth.json that holds " +
				"only dashscope and deepseek [WR-04]",
		).toContain("does **not** install this entry");

		expect(
			section,
			"RB-03-03 must still name the literal the template ships, because that is the string " +
				"the operator is looking for and the one the SSO classifier rejects before " +
				"interpolating it into a copy-pasteable command [CR-01]",
		).toContain("REPLACE_WITH_AWS_PROFILE_NAME");

		expect(
			section.includes("replacing the literal placeholder"),
			"RB-03-03 has been restored to the pre-CR-01 wording: bootstrap never replaced the " +
				"placeholder — installing it verbatim WAS CR-01 — and it now withholds the entry " +
				"entirely [WR-04]",
		).toBe(false);
	});

	it("records the two findings that would otherwise be re-litigated", () => {
		expect(
			runbook,
			"the --remove-scopes closed door must stay written down: repo, read:org and gist are gh's " +
				"documented non-removable minimum set, so logout is the only remedy",
		).toContain("--remove-scopes");
		expect(
			runbook,
			"auth.json's 0600 mode is a no-op against Windows ACLs and must not be mistaken for a control",
		).toContain("0600");
	});
});

// ---------------------------------------------------------------------------
// Group C — the outstanding-status guard
// ---------------------------------------------------------------------------

const FIXTURE_OUTSTANDING = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-01-01 | example check | OUTSTANDING |",
	"",
	"### RB-01-01 — example check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

const FIXTURE_PASSED = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-01-01 | example check | PASSED — 2026-08-13 |",
	"",
	"### RB-01-01 — example check",
	"",
	"**Status:** PASSED — 2026-08-13",
	"",
].join("\n");

const FIXTURE_HALF_FLIPPED = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-01-01 | example check | OUTSTANDING |",
	"",
	"### RB-01-01 — example check",
	"",
	"**Status:** PASSED — 2026-08-13",
	"",
].join("\n");

const FIXTURE_NO_STATUS = ["### RB-01-01 — example check", "", "Some prose and no status line.", ""].join("\n");

/**
 * The same two-source shape carrying a PHASE 2 id.
 *
 * The Phase 1 fixtures above cannot tell a generalised `RB-\d{2}-\d{2}` apart
 * from the literal `RB-01-\d{2}` it replaced — both match `RB-01-01`. Without a
 * fixture whose id starts `RB-02`, the generalisation would be proven only by
 * the real runbook, i.e. by the very file the guard is supposed to police.
 */
const FIXTURE_PHASE_TWO = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-02-01 | example phase 2 check | OUTSTANDING |",
	"",
	"### RB-02-01 — example phase 2 check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

const FIXTURE_PHASE_TWO_HALF_FLIPPED = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-02-01 | example phase 2 check | PASSED — 2026-08-13 |",
	"",
	"### RB-02-01 — example phase 2 check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

/**
 * The same two-source shape carrying a PHASE 3 id.
 *
 * Written for the reason {@link FIXTURE_PHASE_TWO} states and which has not
 * expired: the generalised parser is proven off the real runbook only, and the
 * real runbook is the file this guard exists to police. A phase array can be
 * extended while the parser silently fails to see the new shape, and that
 * failure is not a red suite — it is `statuses[id] === undefined`, which the
 * loop below would report as "RB-03-01 is recorded as undefined". These two
 * fixtures are what make that impossible.
 */
const FIXTURE_PHASE_THREE = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-03-01 | example phase 3 check | OUTSTANDING |",
	"",
	"### RB-03-01 — example phase 3 check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

const FIXTURE_PHASE_THREE_HALF_FLIPPED = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-03-01 | example phase 3 check | PASSED — 2026-08-14 |",
	"",
	"### RB-03-01 — example phase 3 check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

/**
 * The same two-source shape carrying a PHASE 7 id.
 *
 * Written for the reason {@link FIXTURE_PHASE_TWO} states and which has not
 * expired: Phase 6 added no ids at all, so {@link PHASE_SEVEN_IDS} is the
 * first array appended since Phase 5 and the first proof that a phase gap in
 * {@link ALL_IDS}'s composition does not itself break the generalised parser.
 * Without this fixture, `RB-07-01`/`RB-07-02` would be proven only by the
 * real runbook — the file this guard exists to police.
 */
const FIXTURE_PHASE_SEVEN = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-07-01 | example phase 7 check | OUTSTANDING |",
	"",
	"### RB-07-01 — example phase 7 check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

const FIXTURE_PHASE_SEVEN_HALF_FLIPPED = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-07-01 | example phase 7 check | PASSED — 2026-08-15 |",
	"",
	"### RB-07-01 — example phase 7 check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

/**
 * The same two-source shape carrying a PHASE 8 id.
 *
 * Written for the reason {@link FIXTURE_PHASE_TWO} states and which has not
 * expired: {@link PHASE_EIGHT_IDS} was appended on the promise that the
 * generalised parser already covers it. Without this fixture, `RB-08-01`
 * would be proven only by the real runbook — the file this guard exists to
 * police — and the disagreement guard below (the whole point of this plan's
 * own `test_integrity` obligation) would be exercised only against a file
 * this suite already asserts is consistent, which proves the parser can read
 * an agreeing pair but not that it CATCHES a disagreeing one.
 */
const FIXTURE_PHASE_EIGHT = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-08-01 | example phase 8 check | OUTSTANDING |",
	"",
	"### RB-08-01 — example phase 8 check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

const FIXTURE_PHASE_EIGHT_HALF_FLIPPED = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-08-01 | example phase 8 check | PASSED — 2026-08-15 |",
	"",
	"### RB-08-01 — example phase 8 check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

const FIXTURE_PHASE_NINE_HALF_FLIPPED = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-09-01 | example phase 9 check | PASSED — 2026-10-13 |",
	"",
	"### RB-09-01 — example phase 9 check",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

const FIXTURE_PHASE_NINE_BOTH_FLIPPED = FIXTURE_PHASE_NINE_HALF_FLIPPED.replace(
	"**Status:** OUTSTANDING",
	"**Status:** PASSED — 2026-10-13",
);

/**
 * A malformed id in the same two-source shape.
 *
 * Widening the pattern is one edit away from widening it too far — `RB-[\d-]+`
 * would match this, and then an id that corresponds to no entry in
 * {@link ALL_IDS} would be parsed, statused and silently ignored by both
 * loops. `RB-<2 digits>-<2 digits>` is the shape the file actually uses, and
 * this fixture is what holds the pattern to it.
 */
const FIXTURE_MALFORMED_ID = [
	"| ID | Check | Status |",
	"|----|-------|--------|",
	"| RB-2-1 | single-digit phase and index | OUTSTANDING |",
	"",
	"### RB-2-1 — single-digit phase and index",
	"",
	"**Status:** OUTSTANDING",
	"",
].join("\n");

describe("Group C — the parser catches a status flip", () => {
	it("reads OUTSTANDING", () => {
		expect(runbookEntryStatuses(FIXTURE_OUTSTANDING)).toEqual({ "RB-01-01": "OUTSTANDING" });
	});

	it("reads PASSED, so the guard below is proven live rather than assumed", () => {
		expect(
			runbookEntryStatuses(FIXTURE_PASSED),
			"if the parser could not see PASSED, asserting OUTSTANDING against the real file would be a " +
				"tautology — it would pass no matter what the file said",
		).toEqual({ "RB-01-01": "PASSED" });
	});

	it("reports a half-flip as INCONSISTENT", () => {
		expect(runbookEntryStatuses(FIXTURE_HALF_FLIPPED)).toEqual({ "RB-01-01": "INCONSISTENT" });
	});

	it("reports an entry with no status line as MISSING", () => {
		expect(runbookEntryStatuses(FIXTURE_NO_STATUS)).toEqual({ "RB-01-01": "MISSING" });
	});

	it("reads a Phase 2 id, so the generalised pattern is exercised off the real file", () => {
		expect(
			runbookEntryStatuses(FIXTURE_PHASE_TWO),
			"the id pattern was widened from RB-01-\\d{2} to RB-\\d{2}-\\d{2}; if that widening had not " +
				"landed, this fixture would parse to {} and the Phase 2 half of the guard below would " +
				"assert OUTSTANDING against undefined",
		).toEqual({ "RB-02-01": "OUTSTANDING" });
	});

	it("reports a Phase 2 half-flip as INCONSISTENT", () => {
		expect(runbookEntryStatuses(FIXTURE_PHASE_TWO_HALF_FLIPPED)).toEqual({
			"RB-02-01": "INCONSISTENT",
		});
	});

	it("reads a Phase 3 id, so the third phase's statuses are parsed rather than assumed", () => {
		expect(
			runbookEntryStatuses(FIXTURE_PHASE_THREE),
			"PHASE_THREE_IDS was added to ALL_IDS on the promise that the parser already generalises. " +
				"If it does not, the loop below asserts OUTSTANDING against undefined for five entries " +
				"that need a live credential — the exact silent gap this file exists to prevent",
		).toEqual({ "RB-03-01": "OUTSTANDING" });
	});

	it("reports a Phase 3 half-flip as INCONSISTENT", () => {
		expect(runbookEntryStatuses(FIXTURE_PHASE_THREE_HALF_FLIPPED)).toEqual({
			"RB-03-01": "INCONSISTENT",
		});
	});

	it("reads a Phase 7 id, so the parser survives a phase gap (Phase 6 added no ids)", () => {
		expect(
			runbookEntryStatuses(FIXTURE_PHASE_SEVEN),
			"PHASE_SEVEN_IDS was appended straight after PHASE_FIVE_IDS, with no PHASE_SIX_IDS in " +
				"between. If the parser or either loop below silently assumed phase arrays are " +
				"numbered contiguously, this fixture — the first one exercised after that gap — is " +
				"where it would show up as RB-07-01 recorded as undefined",
		).toEqual({ "RB-07-01": "OUTSTANDING" });
	});

	it("reports a Phase 7 half-flip as INCONSISTENT", () => {
		expect(runbookEntryStatuses(FIXTURE_PHASE_SEVEN_HALF_FLIPPED)).toEqual({
			"RB-07-01": "INCONSISTENT",
		});
	});

	it("reads a Phase 8 id, so the disagreement guard is proven off a fixture and not only off the real file", () => {
		expect(
			runbookEntryStatuses(FIXTURE_PHASE_EIGHT),
			"PHASE_EIGHT_IDS was appended straight after PHASE_SEVEN_IDS. If the parser silently assumed " +
				"phase arrays are numbered contiguously or capped at seven, this fixture is where it would " +
				"show up as RB-08-01 recorded as undefined",
		).toEqual({ "RB-08-01": "OUTSTANDING" });
	});

	it("reports a Phase 9 half-flip as INCONSISTENT, and a full flip as PASSED (which the live-check guard rejects)", () => {
		expect(runbookEntryStatuses(FIXTURE_PHASE_NINE_HALF_FLIPPED)).toEqual({ "RB-09-01": "INCONSISTENT" });
		expect(runbookEntryStatuses(FIXTURE_PHASE_NINE_BOTH_FLIPPED)).toEqual({ "RB-09-01": "PASSED" });
	});

	it("reports a Phase 8 half-flip as INCONSISTENT — the whole point of this plan's own test_integrity obligation", () => {
		expect(
			runbookEntryStatuses(FIXTURE_PHASE_EIGHT_HALF_FLIPPED),
			"a docs-policy test that cannot detect a one-sided status flip on the very phase that introduced " +
				"it is worthless — this is the disagreement fixture required to go red, and it must do so " +
				"BEFORE this file is asserted consistent against the real, agreeing docs/RUNBOOK.md below",
		).toEqual({ "RB-08-01": "INCONSISTENT" });
	});

	it("does not recognise a malformed id, so the widened pattern stays a shape and not a wildcard", () => {
		expect(
			runbookEntryStatuses(FIXTURE_MALFORMED_ID),
			"RB-2-1 is not the id shape docs/RUNBOOK.md uses. A pattern loose enough to match it would " +
				"also parse ids that appear in no phase array, which the two loops below would then " +
				"silently skip — a status that is read and never asserted is not guarded",
		).toEqual({});
	});
});

describe("Group C — every live check is still OUTSTANDING", () => {
	const statuses = runbookEntryStatuses(readFileSync(RUNBOOK_PATH, "utf-8"));

	for (const id of ALL_IDS) {
		it(`${id} is OUTSTANDING`, () => {
			expect(
				statuses[id],
				`${id} is recorded as ${statuses[id]}. None of these three can be executed on the ` +
					"development machine — they need the work laptop, a clean profile, or a TTY. Marking " +
					"one passed is a claim that a human ran the command and read the output. If that " +
					"genuinely happened, date-stamp the status in docs/RUNBOOK.md and update this test " +
					"in the same commit, so the claim is reviewable. Never flip it to make a build green. " +
					"The Phase 2 three need the work laptop and live provider credentials specifically: " +
					"one real turn per provider (RB-02-01), a real credential passing through the capture " +
					"path (RB-02-02), and a working day of real DeepSeek V4 Flash traffic (RB-02-03). " +
					"The Phase 3 five need the work laptop, a live DashScope key and an IAM Identity " +
					"Center session: what DashScope accepts on the wire (RB-03-01), its 200 on the second " +
					"turn of a tool sequence (RB-03-02), Bedrock authenticating from a fresh shell " +
					"(RB-03-03), the R1 reasoning-token counts (RB-03-04), and the real cap and price " +
					"from the Model Studio console (RB-03-05). Each has a green offline proxy in this " +
					"repository, and not one of those proxies is the check.",
			).toBe("OUTSTANDING");
		});
	}
});

// ---------------------------------------------------------------------------
// Group D — the published redaction contract still describes the redactor
// ---------------------------------------------------------------------------

/**
 * `docs/DIAGNOSTICS.md`'s Redaction section.
 *
 * WHY THIS GROUP EXISTS [WR-02R]. `docs/DIAGNOSTICS.md` is the document a reader
 * consults to INTERPRET a dump, so a divergence here is not a stale comment — it
 * is a wrong reading of evidence. The redactor was changed to apply the key rule
 * inside payloads and to write `[redacted:truncated]` for two further causes, and
 * the published contract still named one cause and called rule 1 "By header key".
 * A reader who saw the sentinel would have concluded the payload was
 * pathologically deep when in fact a credential-named key was present.
 *
 * Group B pins runbook COMMANDS. Nothing pinned the contract, which is exactly
 * how it drifted.
 */
function redactionSection(): string {
	const doc = readFileSync(DIAGNOSTICS_PATH, "utf-8");
	const start = doc.indexOf("\n## Redaction");
	expect(
		start,
		"docs/DIAGNOSTICS.md has no `## Redaction` section. Every assertion below scans that section, " +
			"so an absent or renamed heading would make this whole group vacuous",
	).toBeGreaterThan(-1);
	const rest = doc.slice(start + 1);
	const end = rest.indexOf("\n## ");
	return end === -1 ? rest : rest.slice(0, end);
}

/**
 * How many code paths in `redact.ts` can produce {@link TRUNCATION_PLACEHOLDER}.
 *
 * Counted out of the source rather than transcribed, so ADDING a fourth cause
 * fails this file instead of only diverging from it. That is the whole point:
 * WR-02R was a behaviour change that no test noticed.
 */
function truncationCauseCount(): number {
	const source = readFileSync(REDACT_SOURCE_PATH, "utf-8");
	return source.split(`return ${"TRUNCATION_PLACEHOLDER"};`).length - 1;
}

/** English for the counts this doc could plausibly have to state. */
const COUNT_WORDS: Readonly<Record<number, string>> = {
	1: "one",
	2: "two",
	3: "three",
	4: "four",
	5: "five",
	6: "six",
};

describe("Group D — the redaction contract matches the redactor", () => {
	const section = redactionSection();

	it("is not vacuous: the section really is the redaction contract", () => {
		expect(
			section.length,
			"the extracted section is too short to be the contract, so every assertion below would be " +
				"asserting against nearly nothing",
		).toBeGreaterThan(500);
		expect(
			section,
			"the section must state the capture-time rule, which is the property DIAG-07 actually " +
				"requires — a redactor applied at read time is not this control",
		).toContain("at capture");
	});

	it("names the truncation sentinel verbatim, imported rather than retyped", () => {
		expect(
			section,
			`the contract must spell ${TRUNCATION_PLACEHOLDER} exactly as the code writes it. A reader ` +
				"greps a dump for the literal, so a paraphrase in the doc is a reader who cannot find it",
		).toContain(TRUNCATION_PLACEHOLDER);
	});

	it("states as many causes for the sentinel as redact.ts actually has", () => {
		const causes = truncationCauseCount();
		expect(
			causes,
			"no `return TRUNCATION_PLACEHOLDER;` found in redact.ts at all. The count below is derived " +
				"from that source, so a zero would make this assertion vacuous — if the sentinel is now " +
				"produced some other way, teach this function the new shape",
		).toBeGreaterThan(0);

		const word = COUNT_WORDS[causes];
		expect(word, `no English word wired up for ${causes} causes`).toBeDefined();

		expect(
			section,
			`redact.ts has ${causes} code paths that write ${TRUNCATION_PLACEHOLDER}, so the contract ` +
				`must say "exactly ${word} causes". It said "one" while the code had three, and one ` +
				"sentinel meaning three different things is the difference between a reader concluding " +
				"'the payload was pathologically deep' and 'a credential-named key was present'",
		).toContain(`exactly ${word} causes`);
	});

	it("names each of the three causes, not just their number", () => {
		// Cue phrases, one per cause, chosen to survive a reflow of the prose while
		// being specific enough that deleting a cause fails here.
		for (const cue of ["depth", "node", "credential-named key", "not a plain object"]) {
			expect(
				section,
				`the contract must name the ${JSON.stringify(cue)} cause. A count with no causes listed ` +
					"tells a reader the sentinel is ambiguous without telling them between what",
			).toContain(cue);
		}
	});

	it("no longer describes the key rule as header-only", () => {
		expect(
			section.includes("**By header key.**"),
			"`walk` applies the key rule to plain-object keys INSIDE a payload, not only to header maps, " +
				"and it replaces the whole subtree under such a key. Calling the rule 'By header key' " +
				"understates the redactor and misleads anyone reasoning about what a clean dump proves",
		).toBe(false);
		expect(
			section,
			"the contract must say the key rule reaches inside payloads, which is the half that changed",
		).toContain("and to object keys inside a");
	});

	it("carries the open key pattern exactly as the code compiles it", () => {
		expect(
			section,
			"the open pattern is what catches a header nobody predicted, so the doc must carry the real " +
				"one. A drifted copy invites a reader to conclude a key is covered when it is not",
		).toContain(REDACTED_HEADER_KEY_RE.source);
	});

	it("states that null and undefined pass through, and why", () => {
		expect(
			section,
			"`null` under a credential-named key means 'delete this header'. Rewriting it to a " +
				"placeholder would misreport a deletion as a secret, and a reader who does not know " +
				"that will read a surviving `null` as a redaction failure",
		).toContain("delete this header");
	});
});

// ---------------------------------------------------------------------------
// Group E — docs/QUALITY.md cannot drift from RULE_IDS or DEFECT_CLASSES,
// in EITHER direction — following the docs/ROUTING.md <-> ROLE_MAP precedent
// (05-12, tests/unit/routing-map.test.ts). The CONVERSE direction is the one
// that matters, per docs/SAFETY.md's own corpus-derived-limits discipline:
// without it, docs/QUALITY.md could grow a rule id or defect-class id the
// code does not have, which is exactly how a doc becomes a second, driftable
// source of truth.
// ---------------------------------------------------------------------------

/** A lowercase, hyphenated, backtick-quoted token — the shape every rule id and defect-class id in this repository actually uses. */
const HYPHENATED_CODE_SPAN_RE = /`([a-z]+(?:-[a-z]+)+)`/g;

/**
 * Slice one numbered `## N. <title>` section out of `docs/QUALITY.md`,
 * mirroring `redactionSection()`'s and `routing-map.test.ts`'s own
 * `roleModelTableSection()` extraction discipline — scoped to the section so
 * a mention elsewhere in the document cannot accidentally satisfy or break
 * this check.
 */
function qualitySection(doc: string, heading: string): string {
	const start = doc.indexOf(heading);
	expect(
		start,
		`docs/QUALITY.md has no ${JSON.stringify(heading.trim())} heading — every assertion below scans ` +
			"that section, so an absent or renamed heading would make this whole group vacuous",
	).toBeGreaterThan(-1);
	const rest = doc.slice(start + heading.length);
	const end = rest.indexOf("\n## ");
	return end === -1 ? rest : rest.slice(0, end);
}

describe("Group E — docs/QUALITY.md agrees with RULE_IDS and DEFECT_CLASSES, in both directions", () => {
	it("exists", () => {
		expect(
			existsSync(QUALITY_PATH),
			"docs/QUALITY.md is the quality layer's own document — the rule table and the defect-class " +
				"table below are published there",
		).toBe(true);
	});

	const doc = readFileSync(QUALITY_PATH, "utf-8");
	const ruleSection = qualitySection(doc, "\n## 2. The six anti-pattern rules (QUAL-01)");
	const calibrationSection = qualitySection(doc, "\n## 6. Calibration");

	it("RULE_IDS has more than one entry (non-vacuity)", () => {
		expect(
			RULE_IDS.length,
			"RULE_IDS is empty or a singleton — the checks below would iterate almost nothing and pass " +
				"without checking a real list",
		).toBeGreaterThan(1);
	});

	it("every RULE_IDS entry appears in docs/QUALITY.md's rule table", () => {
		const missing = RULE_IDS.filter((id) => !ruleSection.includes(id));
		expect(
			missing,
			"docs/QUALITY.md's rule table does not name these RULE_IDS entries — a reader of the " +
				"document would not know these rules exist",
		).toEqual([]);
	});

	it("every rule-id-shaped token the table names is a real RULE_IDS entry (the converse)", () => {
		const found = Array.from(new Set(Array.from(ruleSection.matchAll(HYPHENATED_CODE_SPAN_RE), (m) => m[1])));
		expect(
			found.length,
			"no rule-id-shaped token found in docs/QUALITY.md's rule section — this assertion scans " +
				"that set, so an empty one would pass while verifying nothing",
		).toBeGreaterThan(0);

		const invented = found.filter((id) => !(RULE_IDS as readonly string[]).includes(id));
		expect(
			invented,
			"docs/QUALITY.md's rule table names these ids and RULE_IDS has no entry matching any of " +
				"them — the document has grown a rule the code does not have, which is exactly how a " +
				"doc becomes a second, driftable source of truth. Falsified by hand: adding a fake id " +
				"(e.g. `unbounded-recursion`) to the rule table turns this exact case red, naming the " +
				"invented id, before being reverted",
		).toEqual([]);
	});

	it("DEFECT_CLASSES has more than one entry (non-vacuity)", () => {
		expect(
			DEFECT_CLASSES.length,
			"DEFECT_CLASSES is empty or a singleton — the checks below would iterate almost nothing and " +
				"pass without checking a real list",
		).toBeGreaterThan(1);
	});

	it("every DEFECT_CLASSES entry appears in docs/QUALITY.md's calibration section", () => {
		const missing = DEFECT_CLASSES.filter((id) => !calibrationSection.includes(id));
		expect(
			missing,
			"docs/QUALITY.md's calibration section does not name these DEFECT_CLASSES entries — a " +
				"reader of the document would not know these defect classes exist",
		).toEqual([]);
	});

	it("every defect-class-id-shaped token the section names is a real DEFECT_CLASSES entry (the converse)", () => {
		const found = Array.from(
			new Set(Array.from(calibrationSection.matchAll(HYPHENATED_CODE_SPAN_RE), (m) => m[1])),
		);
		expect(
			found.length,
			"no defect-class-id-shaped token found in docs/QUALITY.md's calibration section — this " +
				"assertion scans that set, so an empty one would pass while verifying nothing",
		).toBeGreaterThan(0);

		const invented = found.filter((id) => !(DEFECT_CLASSES as readonly string[]).includes(id));
		expect(
			invented,
			"docs/QUALITY.md's calibration section names these ids and DEFECT_CLASSES has no entry " +
				"matching any of them — the document has grown a defect class the code does not have. " +
				"Falsified by hand: adding a fake id (e.g. `off-by-one`) to the calibration section " +
				"turns this exact case red, before being reverted",
		).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Group F — docs/WORKFLOWS.md agrees with the workflow code tables, in both directions
// ---------------------------------------------------------------------------

const WORKFLOWS_PATH = join(ROOT, "docs", "WORKFLOWS.md");
const BUDGETS_SOURCE = readFileSync(join(ROOT, "tests", "unit", "workflow-budgets.test.ts"), "utf-8");

/** Body of one `## N. …` section of docs/WORKFLOWS.md, up to the next `## `. */
function workflowsSection(doc: string, heading: string): string {
	const start = doc.indexOf(heading);
	expect(start, `docs/WORKFLOWS.md has no ${JSON.stringify(heading.trim())} heading; the group would be vacuous`).toBeGreaterThan(-1);
	const rest = doc.slice(start + heading.length);
	const end = rest.indexOf("\n## ");
	return end === -1 ? rest : rest.slice(0, end);
}

/** Data rows of the first markdown table in a section, as trimmed cells (header and separator dropped). */
function tableRows(section: string): string[][] {
	const rows = section
		.split("\n")
		.filter((l) => l.trimStart().startsWith("|"))
		.map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
	return rows.slice(2);
}

const unquote = (cell: string): string => cell.replace(/`/g, "");

/** The frozen ceilings and workflow rows, read from the budgets registry's source: its constants are not exported. */
function budgetRegistry(): { ceilings: Record<string, number>; rows: { name: string; commandFile: string; bodies: string[] }[] } {
	const ceilingBlock = /const FEATURES_CEILINGS[^=]*=\s*\{([^}]*)\}/.exec(BUDGETS_SOURCE);
	expect(ceilingBlock, "FEATURES_CEILINGS literal not found in workflow-budgets.test.ts").not.toBeNull();
	const ceilings: Record<string, number> = {};
	for (const m of ceilingBlock![1].matchAll(/(\w+):\s*(\d+)/g)) ceilings[m[1]] = Number(m[2]);

	const start = BUDGETS_SOURCE.indexOf("const WORKFLOW_TEXT_BUDGETS");
	expect(start, "WORKFLOW_TEXT_BUDGETS not found in workflow-budgets.test.ts").toBeGreaterThan(-1);
	const rows: { name: string; commandFile: string; bodies: string[] }[] = [];
	const rowRe = /name:\s*"(\w+)",\s*commandFile:\s*"([^"]+)",\s*bodies:\s*\[([^\]]*)\]/g;
	for (const m of BUDGETS_SOURCE.slice(start).matchAll(rowRe)) {
		rows.push({ name: m[1], commandFile: m[2], bodies: Array.from(m[3].matchAll(/"([^"]+)"/g), (b) => b[1]) });
	}
	return { ceilings, rows };
}

describe("Group F — docs/WORKFLOWS.md agrees with the workflow code tables, in both directions", () => {
	const doc = readFileSync(WORKFLOWS_PATH, "utf-8");

	it("declares the code authoritative and the Phase 9 live checks outstanding", () => {
		expect(doc).toContain("the code is authoritative");
		for (const id of PHASE_NINE_IDS) expect(doc, `${id} must be named in the STATUS section`).toContain(id);
		expect(doc).toContain("no subagent has ever spawned");
	});

	it("workflow table matches WORKFLOW_TEXT_BUDGETS and FEATURES_CEILINGS", () => {
		const { ceilings, rows: codeRows } = budgetRegistry();
		expect(codeRows.length, "no workflow rows parsed from the registry").toBeGreaterThan(1);
		const docRows = tableRows(workflowsSection(doc, "\n## 5. ")).map((r) => ({
			name: unquote(r[0]),
			commandFile: unquote(r[1]),
			body: r[2] === "none" ? "none" : unquote(r[2]),
			ceiling: Number(r[3]),
		}));
		expect(docRows.map((r) => r.name).sort(), "doc and code disagree on the set of workflows").toEqual(
			codeRows.map((r) => r.name).sort(),
		);
		for (const code of codeRows) {
			const row = docRows.find((r) => r.name === code.name)!;
			expect(row.commandFile, `${code.name}: command file`).toBe(code.commandFile);
			expect(row.body, `${code.name}: skill body`).toBe(code.bodies.length === 0 ? "none" : code.bodies.join(", "));
			expect(row.ceiling, `${code.name}: ceiling`).toBe(ceilings[code.name]);
		}
	});

	it("artifact table matches ARTIFACT_FILES (names and consumers)", () => {
		const docRows = tableRows(workflowsSection(doc, "\n## 6. "));
		expect(docRows.map((r) => unquote(r[0])), "doc and code disagree on the artifact set").toEqual(
			ARTIFACT_FILES.map((a) => a.name),
		);
		for (const a of ARTIFACT_FILES) {
			const row = docRows.find((r) => unquote(r[0]) === a.name)!;
			expect(row[1], `${a.name}: consumer`).toBe(a.consumer);
		}
	});

	it("gate-depth table matches GATE_DEPTH_BY_WORKFLOW", () => {
		const docRows = tableRows(workflowsSection(doc, "\n## 7. "));
		const code = Object.entries(GATE_DEPTH_BY_WORKFLOW);
		expect(docRows.map((r) => unquote(r[0])).sort(), "doc and code disagree on the set of workflows").toEqual(
			code.map(([k]) => k).sort(),
		);
		for (const [workflow, mechanisms] of code) {
			const row = docRows.find((r) => unquote(r[0]) === workflow)!;
			expect(unquote(row[1]).split(", "), `${workflow}: mechanisms`).toEqual([...mechanisms]);
		}
		expect(new Set(code.flatMap(([, m]) => m)), "a mechanism used in the table is missing from QUALITY_MECHANISMS").toEqual(
			new Set(QUALITY_MECHANISMS.map((m) => m.id)),
		);
	});

	it("SPEC outline matches SPEC_SECTIONS", () => {
		const docRows = tableRows(workflowsSection(doc, "\n## 8. "));
		expect(docRows.map((r) => r[1]), "doc and code disagree on the SPEC sections").toEqual(
			SPEC_SECTIONS.map((s) => s.heading),
		);
		for (const s of SPEC_SECTIONS) {
			const row = docRows.find((r) => r[1] === s.heading)!;
			expect(Number(row[0]), `${s.heading}: ordinal`).toBe(s.ordinal);
			expect(row[2], `${s.heading}: consumer`).toBe(s.consumer);
		}
	});

	it("ambiguity dimension table matches AMBIGUITY_DIMENSIONS and their floors", () => {
		const docRows = tableRows(workflowsSection(doc, "\n## 9. "));
		expect(docRows.map((r) => unquote(r[0])), "doc and code disagree on the dimensions").toEqual(
			AMBIGUITY_DIMENSIONS.map((d) => d.id),
		);
		for (const d of AMBIGUITY_DIMENSIONS) {
			const row = docRows.find((r) => unquote(r[0]) === d.id)!;
			expect(Number(row[1]), `${d.id}: floor`).toBe(d.floor);
		}
	});
});
