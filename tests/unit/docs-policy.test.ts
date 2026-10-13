/**
 * Documentation policy: the README's honesty obligations and the runbook's status guard. A runbook check is recorded
 * OUTSTANDING until a human runs it, and flipping a status must be a deliberate edit that fails here until this file
 * changes too. The README is in scope because its stated gaps are the only mitigation those gaps have.
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

/** Runbook entries this file governs; each needs a machine, credential or human this one does not have. */
const PHASE_ONE_IDS = ["RB-01-01", "RB-01-02", "RB-01-03"] as const;
const PHASE_TWO_IDS = ["RB-02-01", "RB-02-02", "RB-02-03"] as const;
const PHASE_THREE_IDS = ["RB-03-01", "RB-03-02", "RB-03-03", "RB-03-04", "RB-03-05"] as const;
const PHASE_FOUR_IDS = ["RB-04-01", "RB-04-02"] as const;
const PHASE_FIVE_IDS = ["RB-05-01"] as const;
const PHASE_SEVEN_IDS = ["RB-07-01", "RB-07-02", "RB-07-03"] as const;
const PHASE_EIGHT_IDS = ["RB-08-01", "RB-08-02", "RB-08-03"] as const;
const PHASE_EIGHT_TWO_IDS = ["RB-08-04"] as const;
const PHASE_NINE_IDS = ["RB-09-01", "RB-09-02", "RB-09-03"] as const;
const PHASE_TEN_IDS = ["RB-10-01", "RB-10-02", "RB-10-03"] as const;
const PHASE_ELEVEN_IDS = ["RB-11-01", "RB-11-02", "RB-11-03"] as const;
const PHASE_TWELVE_IDS = ["RB-12-01", "RB-12-02", "RB-12-03", "RB-12-04", "RB-12-05", "RB-12-06", "RB-12-07", "RB-12-08"] as const;

/** Entries a human has completed; each must carry a date-stamped PASSED instead of OUTSTANDING. */
const PASSED_IDS: ReadonlySet<string> = new Set(["RB-07-03"]);

/** Every governed entry, in phase order. */
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

/** Any runbook id, of any phase: a literal phase number would leave later phases unguarded. */
const ID_RE = /RB-\d{2}-\d{2}/g;

/**
 * The status token of every `RB-<phase>-<n>` id, read from both the summary table and the `### <id>` subsection's
 * `**Status:**` line. A disagreement (a half-done flip) reports `INCONSISTENT`; an id with no status reports `MISSING`.
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

/** Strings the README must contain, each with the reason it is load-bearing. */
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

/** A paste guard, not a secret scanner: 40+ token-alphabet characters, which prose, paths and URLs never reach. */
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
	"RB-01-02": ["pi install git:github.com/kaiyitkoh/ky-pi-agent@v1.0.1", "pi --list-models"],
	"RB-01-03": ["/reload"],
	// Fragments: short enough to survive a markdown reflow.
	"RB-02-01": ["tail -n 1 .pi/logs/wire-"],
	"RB-02-02": ["grep -rIEn", ".pi/logs/"],
	// Pinned in full: the prefilter and `cat ... |` prefix each fix a counting defect, and the runbook prose describes
	// them too, so a fragment pin stays green when the command loses its fix. Steps 3 and 4 must sum to step 1.
	"RB-02-03": [
		`cat .pi/logs/turns-*.jsonl | grep -F '"kind":"turn"' | grep -cF '"event":"prose_tool_call"'`,
		`cat .pi/logs/turns-*.jsonl | grep -cF '"kind":"turn"'`,
		`cat .pi/logs/turns-*.jsonl | grep -F '"event":"prose_tool_call"' | grep -v '"kind":' | wc -l`,
		`cat .pi/logs/turns-*.jsonl | grep -cF '"event":"prose_tool_call_retry_exhausted"'`,
	],
	// From here on, whole one-line commands, each distinct from every other in the runbook.

	// The request record carries the compat block; the response record is DashScope's 200 accepting it.
	"RB-03-01": [
		`cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 1`,
		`grep -F '"kind":"main.response"' .pi/logs/wire-$(date +%F).jsonl | tail -n 1`,
		`export KYPI_DASHSCOPE_BASE_URL="https://<WorkspaceId>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" && sh bin/bootstrap.sh`,
	],

	// `tail -n 2`: the first turn of a tool sequence always works, so reading one record reads the wrong turn.
	"RB-03-02": [
		`cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 2`,
		`cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"kind":"turn"' | tail -n 2`,
	],

	// `&& echo $AWS_PROFILE` matters: `aws sso login` sets no variable, so an empty profile looks configured.
	"RB-03-03": [
		`aws sso login --profile X && echo $AWS_PROFILE`,
		`cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"provider":"amazon-bedrock"' | tail -n 1`,
	],

	// Step 1 is the stop condition; steps 4 and 5 hold the recorded fragments.
	"RB-03-04": [
		"pi --list-models | grep deepseek-flash",
		`tail -n 5 .pi/logs/wire-$(date +%F).jsonl`,
		`cat .pi/logs/turns-$(date +%F).jsonl | grep -F '"kind":"turn"' | tail -n 1`,
	],

	// The vitest run asserts the price allowlist in both directions.
	"RB-03-05": [
		"npx vitest run tests/unit/model-metadata.test.ts",
		`pi --list-models | grep -F 'deepseek-v4-pro'`,
	],

	// The clean-up step is pinned too: a check that leaves a stray commit on main is half-written.
	"RB-04-01": [
		"cd <work-repo> && git checkout main && git pull",
		`echo "RB-04-01 push-protection check $(date -u +%FT%TZ)" >> RB-04-01-CHECK.md && git add RB-04-01-CHECK.md && git commit -m "RB-04-01: protected-branch push check (not meant to land)"`,
		"git push origin main",
		"git reset --hard HEAD~1",
	],
	"RB-04-02": [`pi -p "run: git push -u origin rb-04-02"`, "git push origin --delete rb-04-02"],

	"RB-05-01": [
		"export QODER_PERSONAL_ACCESS_TOKEN=pt-<paste the token from qoder.com/account/integrations>",
		"export QODER_AGENT_ID=<agent-id> QODER_ENVIRONMENT_ID=<environment-id>",
		`cat .pi/logs/qoder-$(date +%F).jsonl | tail -n 5`,
	],

	// `pi list` belongs to RB-07-02 alone, so RB-07-01 cannot stay green on its neighbour's copy.
	"RB-07-01": [
		"git status --porcelain",
		`tail -n 1 .pi/logs/audit-$(date +%F).jsonl`,
	],
	// Discovery commands only: the remedy is the operator's choice between two options.
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

	// A pin already owned by another entry is not repeated, so either entry dropping its copy still fails.
	"RB-08-01": [
		`cat .pi/logs/wire-$(date +%F).jsonl | grep -F '"kind":"main.request"' | tail -n 3`,
	],
	"RB-08-02": ["git checkout -- <file>"],
	"RB-08-04": ['pi -p "Quote the first bullet under the Code comments heading in your system prompt, verbatim."'],
	"RB-08-03": [
		'echo "RB-08-03 live catch rate: <caught>/<total>, $(date -u +%FT%TZ)" >> RB-08-03-RESULT.md',
	],

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
	"RB-12-08": [
		"sh bin/bootstrap.sh",
		'echo "RB-12-08 stub rewritten=<yes|no>, try/catch present=<yes|no>, --check-only exit <code>, $(date -u +%FT%TZ)" >> RB-12-08-RESULT.md',
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
		const want = PASSED_IDS.has(id) ? "PASSED" : "OUTSTANDING";
		it(`declares ${id} in a summary-table row marked ${want}`, () => {
			const row = runbook
				.split("\n")
				.find((line) => line.trimStart().startsWith("|") && line.includes(id));
			expect(row, `no summary-table row for ${id}`).toBeDefined();
			if (want === "PASSED") {
				expect(row).toContain("PASSED");
				return;
			}
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
		// The converse of the loops above: an id the runbook declares but no phase array lists is asserted by nothing.
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
		// Doc and behaviour both asserted: the placeholder hint routes an operator with no AWS profile to this section.
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
		const bootstrap = readFileSync(join(ROOT, "bin", "bootstrap.mjs"), "utf-8");
		expect(
			bootstrap,
			"bin/bootstrap.mjs no longer withholds template entries that still carry a " +
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

/** One runbook entry in the two-source shape: a summary-table row and a `### <id>` subsection. */
function fixture(id: string, tableStatus: string, sectionStatus: string | undefined): string {
	return [
		"| ID | Check | Status |",
		"|----|-------|--------|",
		`| ${id} | example check | ${tableStatus} |`,
		"",
		`### ${id} — example check`,
		"",
		sectionStatus === undefined ? "Some prose and no status line." : `**Status:** ${sectionStatus}`,
		"",
	].join("\n");
}

/** Ids from several phases, so the generalised pattern is proven off fixtures and not only off the real runbook. */
const FIXTURE_IDS = ["RB-01-01", "RB-02-01", "RB-03-01", "RB-07-01", "RB-08-01", "RB-09-01"] as const;

describe("Group C — the parser catches a status flip", () => {
	it.each(FIXTURE_IDS)("reads %s as OUTSTANDING", (id) => {
		expect(runbookEntryStatuses(fixture(id, "OUTSTANDING", "OUTSTANDING"))).toEqual({ [id]: "OUTSTANDING" });
	});

	it.each(FIXTURE_IDS)("reads %s as PASSED, so the guard below is live rather than a tautology", (id) => {
		expect(runbookEntryStatuses(fixture(id, "PASSED — 2026-08-13", "PASSED — 2026-08-13"))).toEqual({ [id]: "PASSED" });
	});

	it.each(FIXTURE_IDS)("reports a half-flip of %s, in either source, as INCONSISTENT", (id) => {
		expect(runbookEntryStatuses(fixture(id, "OUTSTANDING", "PASSED — 2026-08-13"))).toEqual({ [id]: "INCONSISTENT" });
		expect(runbookEntryStatuses(fixture(id, "PASSED — 2026-08-13", "OUTSTANDING"))).toEqual({ [id]: "INCONSISTENT" });
	});

	it("reports an entry with no status line as MISSING", () => {
		const noStatus = fixture("RB-01-01", "", undefined).split("\n").slice(4).join("\n");
		expect(runbookEntryStatuses(noStatus)).toEqual({ "RB-01-01": "MISSING" });
	});

	it("does not recognise a malformed id, so the widened pattern stays a shape and not a wildcard", () => {
		expect(
			runbookEntryStatuses(fixture("RB-2-1", "OUTSTANDING", "OUTSTANDING")),
			"a pattern loose enough to match RB-2-1 would parse ids no phase array lists, which nothing then asserts",
		).toEqual({});
	});
});

describe("Group C — every live check is still OUTSTANDING", () => {
	const statuses = runbookEntryStatuses(readFileSync(RUNBOOK_PATH, "utf-8"));

	for (const id of ALL_IDS) {
		if (PASSED_IDS.has(id)) {
			it(`${id} is PASSED`, () => expect(statuses[id]).toBe("PASSED"));
			continue;
		}
		it(`${id} is OUTSTANDING`, () => {
			expect(
				statuses[id],
				`${id} is recorded as ${statuses[id]}. It needs a machine, credential or human this one lacks, and each ` +
					"offline proxy is not the check. Flip it only after a human ran it: date-stamp the status in " +
					"docs/RUNBOOK.md and add the id to PASSED_IDS in the same commit. Never flip it to make a build green.",
			).toBe("OUTSTANDING");
		});
	}
});

// ---------------------------------------------------------------------------
// Group D — the published redaction contract still describes the redactor
// ---------------------------------------------------------------------------

/** docs/DIAGNOSTICS.md's Redaction section: the contract a reader uses to interpret a dump. */
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

/** Code paths in redact.ts that produce TRUNCATION_PLACEHOLDER, counted from source so a new cause fails here. */
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
		// One cue per cause, short enough to survive a reflow.
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
// Group E — docs/QUALITY.md agrees with RULE_IDS and DEFECT_CLASSES in both directions, so the doc never becomes
// a second source of truth
// ---------------------------------------------------------------------------

/** A backtick-quoted lowercase hyphenated token: the shape of every rule and defect-class id. */
const HYPHENATED_CODE_SPAN_RE = /`([a-z]+(?:-[a-z]+)+)`/g;

/** One `## N. <title>` section of docs/QUALITY.md, so a mention elsewhere cannot satisfy or break the check. */
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
				"them — the document has grown a rule the code does not have",
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
				"matching any of them — the document has grown a defect class the code does not have",
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
			expect(unquote(row[1]) === "none" ? [] : unquote(row[1]).split(", "), `${workflow}: mechanisms`).toEqual([...mechanisms]);
		}
		expect(new Set(code.flatMap(([, m]) => m)), "a mechanism used in the table is missing from QUALITY_MECHANISMS").toEqual(
			new Set(QUALITY_MECHANISMS.filter((m) => m.production).map((m) => m.id)),
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

describe("install docs describe what bootstrap now does, not manual workarounds", () => {
	const runbook = readFileSync(RUNBOOK_PATH, "utf-8");
	const startHere = runbook.slice(runbook.indexOf("## Work laptop: start here"), runbook.indexOf("### 6. Bedrock"));
	const codeLines = (text: string): string[] =>
		[...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].flatMap((m) => (m[1] ?? "").split("\n").map((l) => l.trim()));
	const pathBStart = README.indexOf("**Path B");
	const pathB = README.slice(pathBStart, README.indexOf("\n## ", pathBStart));

	it("neither tells the reader to run npm ci or to hand-write the harness package entry", () => {
		expect(startHere.length).toBeGreaterThan(0);
		for (const [name, text] of [["runbook start-here", startHere], ["README Path B", pathB]] as const) {
			expect(codeLines(text), `${name}: bootstrap runs npm ci itself`).not.toContain("npm ci --ignore-scripts");
			expect(text, `${name}: bootstrap writes the filtered package entry itself`).not.toContain("pwd -W");
		}
	});

	it("both keep the verify commands and the filter they can see in pi list", () => {
		for (const text of [startHere, pathB]) {
			expect(codeLines(text)).toEqual(expect.arrayContaining(["sh bin/bootstrap.sh --check-only", "pi list"]));
			expect(text).toContain("!.pi/extensions/safety/**");
			expect(text).toContain("(filtered)");
		}
		expect(codeLines(startHere)).toContain("sh bin/bootstrap.sh --assert-hardening");
	});

	it("neither warns against trusting the checkout, which is now harmless", () => {
		for (const text of [startHere, README]) expect(text).not.toMatch(/never trust the (ky-pi-agent )?checkout/i);
	});
});
