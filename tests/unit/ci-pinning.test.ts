/**
 * ci.yml, the only place third-party code runs with a checkout and a token and the only macOS leg: every action is
 * pinned to a 40-hex SHA (a tag can be repointed), both matrix legs run with fail-fast off, no step falls through to
 * pwsh, and the workflow executes the shipped scripts. Read as text: no YAML parser is a declared dependency.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";

const ROOT = repoRoot();
const WORKFLOW_REL = ".github/workflows/ci.yml";
const WORKFLOW_PATH = join(ROOT, WORKFLOW_REL);

/**
 * True for `owner/repo[/subdir]@<40 lowercase hex>`. Tags, short SHAs (collision-attackable), uppercase hex (typed by
 * hand) and `docker://` or `./local` forms are rejected; this predicate is where any exception gets decided.
 */
export function isShaPinnedActionRef(ref: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*@[0-9a-f]{40}$/.test(ref);
}

/** Lines that are entirely a comment carry no policy and are dropped first. */
function isCommentLine(line: string): boolean {
	return line.trim().startsWith("#");
}

/** The workflow without wholly-commented lines: a lint that fires on prose gets deleted. */
export function withoutCommentLines(text: string): string {
	return text
		.split("\n")
		.filter((line) => !isCommentLine(line))
		.join("\n");
}

/** Every `uses:` value in the workflow, with the trailing comment kept. */
export function actionReferences(text: string): Array<{ ref: string; comment: string }> {
	const out: Array<{ ref: string; comment: string }> = [];
	for (const line of text.split("\n")) {
		if (isCommentLine(line)) {
			continue;
		}
		const match = /^\s*-?\s*uses:\s*([^\s#]+)\s*(#.*)?$/.exec(line);
		if (match) {
			out.push({ ref: match[1], comment: (match[2] ?? "").trim() });
		}
	}
	return out;
}

/** The workflow-level default shell: the indented block under a column-zero `defaults:` key. */
export function workflowDefaultShell(text: string): string | undefined {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => /^defaults:\s*$/.test(line));
	if (start < 0) {
		return undefined;
	}
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === "") {
			continue;
		}
		if (!/^\s/.test(line)) {
			return undefined;
		}
		const match = /^\s*shell:\s*([^\s#]+)/.exec(line);
		if (match) {
			return match[1];
		}
	}
	return undefined;
}

/** Every explicit `shell:` value anywhere in the workflow. */
export function declaredShells(text: string): string[] {
	return text
		.split("\n")
		.filter((line) => !isCommentLine(line))
		.map((line) => /^\s*shell:\s*([^\s#]+)/.exec(line))
		.filter((match): match is RegExpExecArray => match !== null)
		.map((match) => match[1]);
}

/** Count of steps carrying a `run:` with a value (the `defaults:` key has none). */
export function runStepCount(text: string): number {
	return text
		.split("\n")
		.filter((line) => !isCommentLine(line))
		.filter((line) => /^\s*-?\s*run:\s*\S/.test(line)).length;
}

describe("ci.yml exists", () => {
	it("is present -- this test never tolerates its subject being absent", () => {
		expect(
			existsSync(WORKFLOW_PATH),
			`${WORKFLOW_REL} is missing; BOOT-07 has no CI to assert on`,
		).toBe(true);
	});
});

const workflow = readFileSync(WORKFLOW_PATH, "utf-8");
/** What the workflow DOES, with the prose about what it does removed. */
const executable = withoutCommentLines(workflow);
const references = actionReferences(workflow);

describe("the SHA predicate itself is proven, independently of ci.yml", () => {
	// Asserted against inline cases so the lint is demonstrated live rather than
	// inferred from the current file happening to pass.
	const PINNED = [
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
		"actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
		"owner/repo/sub-action@0000000000000000000000000000000000000000",
	];

	const UNPINNED = [
		"actions/checkout@v5",
		"actions/checkout@v7.0.1",
		"actions/checkout@main",
		"actions/checkout@3d3c42e", // abbreviated
		"actions/checkout@3D3C42E5AAC5BA805825DA76410C181273BA90B1", // uppercase
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1a", // 41 hex
		"actions/checkout",
		"docker://alpine:3.19",
		"./.github/actions/local",
		"",
	];

	for (const ref of PINNED) {
		it(`treats "${ref}" as pinned`, () => {
			expect(isShaPinnedActionRef(ref)).toBe(true);
		});
	}

	for (const ref of UNPINNED) {
		it(`treats "${ref}" as unpinned`, () => {
			expect(isShaPinnedActionRef(ref)).toBe(false);
		});
	}
});

/**
 * The audited (SHA, tag) pairs, the offline half of the gate: an unchecked tag comment let a v7.0.0 commit ship
 * labelled v5.0.0. Resolve with `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` and edit this table
 * in the same change; the `pin-audit` CI step re-resolves online on every run.
 */
export const AUDITED_PINS: ReadonlyArray<{
	readonly action: string;
	readonly sha: string;
	readonly tag: string;
}> = [
	{
		action: "actions/checkout",
		sha: "3d3c42e5aac5ba805825da76410c181273ba90b1",
		tag: "v7.0.1",
	},
	{
		action: "actions/setup-node",
		sha: "820762786026740c76f36085b0efc47a31fe5020",
		tag: "v7.0.0",
	},
];

/** The bare tag from a trailing `# v7.0.1` comment, or undefined. */
export function tagFromComment(comment: string): string | undefined {
	const match = /^#\s*(v?\d+(?:\.\d+)*)\s*$/.exec(comment.trim());
	return match ? match[1] : undefined;
}

describe("T-01-24 -- no CI action can move under this project", () => {
	it("declares at least one action", () => {
		// Zero references would make every assertion below vacuous.
		expect(references.length).toBeGreaterThan(0);
	});

	for (const { ref, comment } of references) {
		it(`pins ${ref.split("@")[0]} by commit SHA`, () => {
			expect(
				isShaPinnedActionRef(ref),
				`\`uses: ${ref}\` is not a 40-hex commit SHA. Tags are mutable -- resolve it with ` +
					"`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`",
			).toBe(true);
		});

		it(`keeps a version-shaped tag comment beside ${ref.split("@")[0]}`, () => {
			// The tag comment is what tells current from stale without a network call, so it must look like a version.
			expect(
				tagFromComment(comment),
				`\`uses: ${ref}\` needs a trailing \`# v<version>\` comment; got ${JSON.stringify(comment)}`,
			).toBeDefined();
		});

		it(`resolves ${ref.split("@")[0]} to the audited (SHA, tag) pair`, () => {
			// The comment and the SHA must both match a pair resolved through the API.
			const [action, sha] = ref.split("@");
			const audited = AUDITED_PINS.find((p) => p.action === action);
			expect(
				audited,
				`\`${action}\` is not in AUDITED_PINS. Resolve it with ` +
					`\`gh api repos/${action}/git/ref/tags/<tag> --jq .object.sha\` and add the pair ` +
					"in this change, or the tag comment is an unchecked claim.",
			).toBeDefined();
			if (!audited) {
				return;
			}
			expect(
				sha,
				`\`${action}\` is pinned at ${sha} but the audited SHA for ${audited.tag} is ${audited.sha}`,
			).toBe(audited.sha);
			expect(
				tagFromComment(comment),
				`\`${action}@${sha}\` is commented \`${comment}\` but that SHA is ${audited.tag}. ` +
					"A tag comment two majors out inverts the reason the comment exists.",
			).toBe(audited.tag);
		});
	}

	it("audits every action the workflow references (no silent additions)", () => {
		// De-duplicated: `actions/checkout` legitimately appears once per job.
		const referenced = [...new Set(references.map(({ ref }) => ref.split("@")[0]))].sort();
		const audited = AUDITED_PINS.map((p) => p.action).sort();
		expect(
			referenced,
			"every `uses:` in ci.yml must have an AUDITED_PINS entry, and every entry must " +
				"still be used -- a stale entry is a pin nobody re-resolves",
		).toEqual(audited);
	});

	it("rejects a mislabelled or malformed tag comment (the assertion is live)", () => {
		// Inline cases prove the table can fail; the first three are shapes a non-empty-comment check accepted.
		expect(tagFromComment("# banana")).toBeUndefined();
		expect(tagFromComment("# see below")).toBeUndefined();
		expect(tagFromComment("")).toBeUndefined();
		expect(tagFromComment("# v5.0.0")).toBe("v5.0.0");
		expect(tagFromComment("#v7.0.0")).toBe("v7.0.0");
		expect(tagFromComment("# 4")).toBe("4");

		// The real setup-node SHA carrying the wrong v5 label.
		const setupNode = AUDITED_PINS.find((p) => p.action === "actions/setup-node");
		expect(setupNode?.tag).toBe("v7.0.0");
		expect(tagFromComment("# v5.0.0")).not.toBe(setupNode?.tag);
	});
});

describe("BOOT-07 -- both matrix legs run, and neither can mask the other", () => {
	it("names windows-latest and macos-latest", () => {
		expect(workflow).toContain("windows-latest");
		expect(workflow).toContain("macos-latest");
	});

	it("runs the lint on a pinned ubuntu image, the only runner with shellcheck", () => {
		expect(workflow).toMatch(/\n {2}posix-lint:\n(?: {4}.*\n)*? {4}runs-on: ubuntu-\d+\.\d+\n/);
		expect(workflow).toMatch(/shellcheck\s+--shell=sh/);
	});

	it("disables fail-fast", () => {
		expect(
			workflow,
			"without `fail-fast: false` a Windows failure cancels the macOS leg, " +
				"and macOS is verified nowhere else in this project",
		).toMatch(/^\s*fail-fast:\s*false\s*$/m);
	});
});

describe("T-01-27 -- no step can fall through to pwsh", () => {
	it("sets a bash shell for every run step", () => {
		const fallback = workflowDefaultShell(workflow);
		if (fallback === undefined) {
			// No workflow-level default: every run step must carry its own.
			const shells = declaredShells(workflow);
			expect(shells.length).toBeGreaterThanOrEqual(runStepCount(workflow));
			expect(shells.every((s) => s === "bash")).toBe(true);
			return;
		}
		expect(fallback).toBe("bash");
	});

	it("declares no non-bash shell anywhere", () => {
		// Catches a single step overriding the workflow default with pwsh, cmd
		// or powershell -- which the default-shell assertion alone would miss.
		for (const shell of declaredShells(workflow)) {
			expect(shell, `\`shell: ${shell}\` is not bash`).toBe("bash");
		}
	});

	it("references no PowerShell script", () => {
		expect(
			/\.ps1\b/.test(workflow),
			"Pi hard-requires a bash on Windows and resolves Git Bash with no configuration " +
				"(docs/windows.md:3-7); a PowerShell helper is never the fix",
		).toBe(false);
	});

	it("recognises a missing default and a pwsh override (the assertions are live)", () => {
		expect(workflowDefaultShell("jobs:\n  a:\n    runs-on: x\n")).toBeUndefined();
		expect(workflowDefaultShell("defaults:\n  run:\n    shell: bash\n")).toBe("bash");
		expect(workflowDefaultShell("defaults:\n  run:\n    shell: pwsh\n")).toBe("pwsh");
		expect(declaredShells("      - run: x\n        shell: pwsh\n")).toEqual(["pwsh"]);
		expect(runStepCount("      - run: npx vitest run\n      - run: |\n          echo hi\n")).toBe(2);
	});
});

describe("T-01-25 / T-01-28 -- the legs execute rather than merely build", () => {
	it("executes the bootstrap in check-only mode", () => {
		expect(
			workflow,
			"`sh bin/bootstrap.sh --check-only` is what makes ROADMAP criterion 3 " +
				'("actually executes rather than merely building") true',
		).toMatch(/sh bin\/bootstrap\.sh --check-only/);
	});

	it("syntax-checks the bootstrap under sh on both legs", () => {
		expect(workflow).toMatch(/sh -n bin\/bootstrap\.sh/);
	});

	it("runs the full vitest suite, not just the unit directory", () => {
		expect(workflow).toMatch(/npx vitest run\s*$/m);
	});

	it("installs the pinned Pi globally BEFORE running the suite", () => {
		// The load-path tests throw when `pi` is absent, so the install must precede the suite.
		const install = workflow.indexOf(
			"npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.1.0",
		);
		const suite = workflow.indexOf("npx vitest run");
		expect(install, "the pinned global Pi install step is missing").toBeGreaterThan(-1);
		expect(suite, "the vitest step is missing").toBeGreaterThan(-1);
		expect(install).toBeLessThan(suite);
	});

	it("installs dependencies with lifecycle scripts disabled", () => {
		// A runner installs a dependency tree before anything reviews it, so lifecycle scripts stay off there too.
		expect(workflow).toContain("npm ci --ignore-scripts");
		// Over the comment-stripped text: the raw file mentions `npm install` in prose.
		expect(executable).not.toMatch(/npm (ci|install)(?![^\n]*--ignore-scripts)/);
	});

	it("would still catch an unflagged install (the comment strip did not blind it)", () => {
		// Stripping comments weakens the check, so prove it still fails on a real violation and tolerates the prose.
		expect(withoutCommentLines("      - run: npm ci\n")).toMatch(
			/npm (ci|install)(?![^\n]*--ignore-scripts)/,
		);
		expect(withoutCommentLines("      # note: npm install would run scripts\n")).not.toMatch(
			/npm (ci|install)(?![^\n]*--ignore-scripts)/,
		);
		// An inline trailing comment is NOT a comment line, so it is still policy.
		expect(withoutCommentLines("      - run: npm ci # oops\n")).toMatch(
			/npm (ci|install)(?![^\n]*--ignore-scripts)/,
		);
	});

	it("reports the /share exposure without failing the build", () => {
		// Runners' `gh` is authenticated through GITHUB_TOKEN, so a bare check fails every run; --warn-only keeps it visible.
		expect(workflow).toMatch(/check-gh-unauthenticated\.sh --warn-only/);
	});

	it("typechecks against Pi's shipped .d.ts", () => {
		expect(workflow).toMatch(/npx tsc --noEmit/);
	});

	it("re-resolves every tag comment through the API (the online half of CR-03)", () => {
		// This step checks the hand-typed AUDITED_PINS table against the registry on every run.
		expect(
			workflow,
			"the `pin-audit` step is the only thing that can catch a tag comment " +
				"drifting from its SHA after the table was written",
		).toMatch(/name:\s*pin-audit/);
		expect(workflow).toMatch(/gh api "repos\/\$repo\/git\/ref\/tags\/\$tag"/);
	});

	it("tests the Node floor Pi declares and the current 24.x line", () => {
		expect(executable).toMatch(/node:\s*\[[^\]]*'22\.19\.0'[^\]]*\]/);
		expect(executable).toMatch(/node:\s*\[[^\]]*'24\.x'[^\]]*\]/);
		expect(executable).toMatch(/node-version:\s*\$\{\{\s*matrix\.node\s*\}\}/);
	});

	it("has a Linux leg in the test matrix", () => {
		expect(executable).toMatch(/os:\s*\[[^\]]*ubuntu-latest[^\]]*\]/);
	});

	it("peels annotated tags in the pin audit instead of trusting the first object sha", () => {
		expect(executable).toMatch(/\.object\.type/);
		expect(executable).toMatch(/git\/tags\//);
		expect(executable).toMatch(/while \[ "\$\{actual%% \*\}" = "tag" \]/);
	});
});
