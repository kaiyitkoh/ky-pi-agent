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
 * THE GUARD SPANS BOTH PHASES. It was written in Phase 1 against a literal
 * `RB-01-\d{2}`, which meant appending Phase 2's entries would have left three
 * new statuses completely unguarded — the one outcome the policy above exists
 * to prevent, arriving quietly through a file that was never touched. The id
 * pattern is now `RB-<phase>-<n>` and {@link ALL_IDS} drives Group B and
 * Group C, so a future phase adds its ids to one array and inherits the whole
 * guard. Group C carries a synthetic `RB-02-01` fixture as well as the Phase 1
 * ones, because a generalisation that only the real file exercises is a
 * generalisation nobody has tested.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../helpers/git.ts";

const ROOT = repoRoot();
const README = readFileSync(join(ROOT, "README.md"), "utf-8");
const RUNBOOK_PATH = join(ROOT, "docs", "RUNBOOK.md");

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

/** Every governed entry, in phase order. A later phase appends its array here. */
const ALL_IDS = [...PHASE_ONE_IDS, ...PHASE_TWO_IDS] as const;

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
	"RB-01-02": ["pi install https://github.com/kaiyitkoh/ky-pi-agent", "pi --list-models"],
	"RB-01-03": ["/reload"],
	// Fragments, not whole command lines: each is short enough to survive a
	// reflow of the surrounding markdown and specific enough that a rewrite
	// dropping the command fails here.
	"RB-02-01": ["tail -n 1 .pi/logs/wire-"],
	"RB-02-02": ["grep -rIEn", ".pi/logs/"],
	// RB-02-03 pins the THREE COUNTING COMMANDS IN FULL, not fragments of them.
	//
	// Fragments were not enough here. Each of these commands carries a fix for a
	// specific defect -- `grep -v '"kind":'` stops the numerator double-counting the
	// turn row beside the standalone record (every detected prose turn leaves both),
	// and the `cat ... |` prefix makes `grep -c` over a rotated glob yield one total
	// instead of `file:count` per file -- and the runbook DESCRIBES those same
	// fragments in the prose underneath the steps. A fragment pin therefore stayed
	// green when the fragment was deleted from the command and left in the
	// explanation, which is the whole failure this pin exists to catch. Pinning the
	// complete line is safe because each command sits inside backticks on one line
	// of a numbered list and is not subject to reflow.
	//
	// A 2-3x inflated prose rate read against a published ~11% baseline would look
	// like loud confirmation of the leading root-cause hypothesis, which is why the
	// numerator command is pinned rather than trusted.
	"RB-02-03": [
		`cat .pi/logs/turns-*.jsonl | grep -F '"event":"prose_tool_call"' | grep -v '"kind":' | wc -l`,
		`cat .pi/logs/turns-*.jsonl | grep -cF '"kind":"turn"'`,
		`cat .pi/logs/turns-*.jsonl | grep -cF '"event":"prose_tool_call_retry_exhausted"'`,
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
					"path (RB-02-02), and a working day of real DeepSeek V4 Flash traffic (RB-02-03).",
			).toBe("OUTSTANDING");
		});
	}
});
