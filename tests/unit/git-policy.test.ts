/**
 * SAFE-04 / SAFE-05 — `.pi/extensions/safety/git.ts`, table-driven.
 *
 * A `{ command, currentBranch, expected, why }` table over `classifyGitInvocation`
 * and `classifyGlabInvocation`. Every ALLOW row named in the plan's `<behavior>`
 * is present EXPLICITLY (04-RESEARCH.md Pitfall 5: "this must be a named
 * allow-case, not merely absent from the deny-list") — `git worktree add -b feat
 * main`, `git fetch origin main`, `git diff main`, `git log origin/main` and
 * `git rebase feature` all appear as their own rows with `currentBranch: "main"`,
 * paired with BLOCK rows for `push`, `commit --amend`, `reset --hard`, `merge
 * other` on the same branch, and a paired-flip row proving `git push` is ALLOWED
 * once `currentBranch` is a feature branch — the whole point of Pitfall 5 is
 * that "mentions main" and "writes to the CURRENT branch, which happens to be
 * main" are different questions, so both directions of the flip must be visible
 * in one table rather than trusted from either row alone.
 *
 * VACUOUS-PASS GUARD (this repo's house rule — `tests/unit/path-policy.test.ts`,
 * `tests/unit/shell-deny-list.test.ts`): the row table asserts its own length
 * before use, and every `subcommand` key present in `GIT_WRITE_SUBCOMMANDS` /
 * `GIT_READ_SUBCOMMANDS` is asserted reachable by at least one row below — a
 * dead table entry and an absent one would otherwise produce identical green
 * runs.
 */
import { describe, expect, it } from "vitest";

import {
	classifyGitInvocation,
	classifyGlabInvocation,
	currentBranch,
	DETACHED_HEAD,
	GIT_READ_SUBCOMMANDS,
	GIT_WRITE_SUBCOMMANDS,
	type GitInvocation,
	type GitPolicyFacts,
} from "../../.pi/extensions/safety/git.ts";

const PROTECTED: readonly string[] = ["main", "master"];

function facts(currentBranch: string): GitPolicyFacts {
	return { currentBranch, protectedBranches: PROTECTED };
}

/** `"push --force"` -> `{ subcommand: "push", args: ["--force"] }`. Test-only convenience; the module never parses raw strings itself. */
function invocation(afterVerb: string): GitInvocation {
	const parts = afterVerb.trim().length === 0 ? [] : afterVerb.trim().split(/\s+/);
	const [subcommand, ...args] = parts;
	return { subcommand: subcommand ?? "", args };
}

interface Row {
	/** Display form, e.g. `"git push"` or `"glab mr merge"`. Not parsed — informational only. */
	readonly command: string;
	/** Everything after `git`/`glab`, fed to {@link invocation}. */
	readonly rest: string;
	readonly kind: "git" | "glab";
	readonly currentBranch: string;
	readonly expected: "allow" | "block";
	readonly why: string;
}

const ROWS: readonly Row[] = [
	// -------------------------------------------------------------------------
	// BLOCK on main -- writes to the checked-out branch
	// -------------------------------------------------------------------------
	{ command: "git push", rest: "push", kind: "git", currentBranch: "main", expected: "block", why: "a write regardless of refspec -- the refspec target cannot be trusted from argv alone" },
	{ command: "git push --force", rest: "push --force", kind: "git", currentBranch: "main", expected: "block", why: "still a push" },
	{ command: "git push -f", rest: "push -f", kind: "git", currentBranch: "main", expected: "block", why: "still a push, short flag" },
	{ command: "git commit", rest: "commit", kind: "git", currentBranch: "main", expected: "block", why: "unconditional write to the checked-out branch" },
	{ command: "git commit --amend", rest: "commit --amend", kind: "git", currentBranch: "main", expected: "block", why: "unambiguously a write to the checked-out branch" },
	{ command: "git reset --hard", rest: "reset --hard", kind: "git", currentBranch: "main", expected: "block", why: "moves the checked-out branch's tip" },
	{ command: "git merge other", rest: "merge other", kind: "git", currentBranch: "main", expected: "block", why: "merges into the checked-out branch" },
	{ command: "git cherry-pick abc123", rest: "cherry-pick abc123", kind: "git", currentBranch: "main", expected: "block", why: "writes a new commit onto the checked-out branch" },
	{ command: "git revert abc123", rest: "revert abc123", kind: "git", currentBranch: "main", expected: "block", why: "writes a new commit onto the checked-out branch" },
	{ command: "git am patch.mbox", rest: "am patch.mbox", kind: "git", currentBranch: "main", expected: "block", why: "applies patches as commits onto the checked-out branch" },
	{ command: "git apply diff.patch", rest: "apply diff.patch", kind: "git", currentBranch: "main", expected: "block", why: "writes the tree -- not --check/--stat/--numstat" },
	{ command: "git rebase", rest: "rebase", kind: "git", currentBranch: "main", expected: "block", why: "bare rebase rewrites the checked-out branch's history against its upstream" },
	{ command: "git bisect start", rest: "bisect start", kind: "git", currentBranch: "main", expected: "block", why: "unclassified subcommand -- fail closed per SAFE-03's posture" },

	// -------------------------------------------------------------------------
	// ALLOW on main -- named allow rows (Pitfall 5: must be explicit, not absence)
	// -------------------------------------------------------------------------
	{ command: "git fetch", rest: "fetch", kind: "git", currentBranch: "main", expected: "allow", why: "reads from a remote, never mutates the checked-out branch" },
	{ command: "git fetch origin main", rest: "fetch origin main", kind: "git", currentBranch: "main", expected: "allow", why: "still a fetch -- mentioning \"main\" in argv is not the question" },
	{ command: "git diff", rest: "diff", kind: "git", currentBranch: "main", expected: "allow", why: "read-only comparison" },
	{ command: "git diff main", rest: "diff main", kind: "git", currentBranch: "main", expected: "allow", why: "still a diff -- comparing against main is not writing to main" },
	{ command: "git log", rest: "log", kind: "git", currentBranch: "main", expected: "allow", why: "read-only history view" },
	{ command: "git log origin/main", rest: "log origin/main", kind: "git", currentBranch: "main", expected: "allow", why: "still a log -- naming main in argv is not the question" },
	{ command: "git status", rest: "status", kind: "git", currentBranch: "main", expected: "allow", why: "read-only" },
	{ command: "git show abc123", rest: "show abc123", kind: "git", currentBranch: "main", expected: "allow", why: "read-only object inspection" },
	{ command: "git branch", rest: "branch", kind: "git", currentBranch: "main", expected: "allow", why: "list form" },
	{ command: "git remote -v", rest: "remote -v", kind: "git", currentBranch: "main", expected: "allow", why: "read-only remote listing" },
	{ command: "git stash list", rest: "stash list", kind: "git", currentBranch: "main", expected: "allow", why: "read-only -- the only stash form this table allows" },
	{ command: "git worktree add -b feat main", rest: "worktree add -b feat main", kind: "git", currentBranch: "main", expected: "allow", why: "the escape hatch -- reads main to create an UNRELATED branch, never mutates main itself" },
	{ command: "git worktree list", rest: "worktree list", kind: "git", currentBranch: "main", expected: "allow", why: "read-only" },
	{ command: "git worktree add second main", rest: "worktree add second main", kind: "git", currentBranch: "main", expected: "allow", why: "pinned decision: worktree add WITHOUT -b checking out main into a second worktree does not mutate main either" },
	{ command: "git rebase feature", rest: "rebase feature", kind: "git", currentBranch: "main", expected: "allow", why: "read-preview form against a named OTHER branch -- rewrites feature, not the checked-out branch" },
	{ command: "git apply --check diff.patch", rest: "apply --check diff.patch", kind: "git", currentBranch: "main", expected: "allow", why: "--check is a dry run -- does not write the tree" },

	// -------------------------------------------------------------------------
	// The paired flip -- same write, non-protected branch
	// -------------------------------------------------------------------------
	{ command: "git push origin feature/x:feature/x", rest: "push origin feature/x:feature/x", kind: "git", currentBranch: "feature/x", expected: "allow", why: "the rule is about the CHECKED-OUT branch, not about the word \"main\" appearing anywhere" },
	{ command: "git commit --amend", rest: "commit --amend", kind: "git", currentBranch: "feature/x", expected: "allow", why: "same write, non-protected branch" },
	{ command: "git reset --hard", rest: "reset --hard", kind: "git", currentBranch: "feature/x", expected: "allow", why: "same write, non-protected branch" },

	// -------------------------------------------------------------------------
	// CR-05 -- push targets a protected branch BY REFSPEC, independent of HEAD
	// -------------------------------------------------------------------------
	{
		command: "git push --force origin main",
		rest: "push --force origin main",
		kind: "git",
		currentBranch: "feature/x",
		expected: "block",
		why: "confirmed by execution: names main literally as the push destination while HEAD is a feature branch -- previously allowed outright because the write table was only ever consulted when HEAD itself was protected",
	},
	{
		command: "git push origin HEAD:main",
		rest: "push origin HEAD:main",
		kind: "git",
		currentBranch: "feature/x",
		expected: "block",
		why: "the refspec's destination side (after the colon) names a protected branch -- must block regardless of HEAD",
	},
	{
		command: "git push origin feature/x:main",
		rest: "push origin feature/x:main",
		kind: "git",
		currentBranch: "feature/x",
		expected: "block",
		why: "same as above -- the SOURCE side names the current feature branch, but the DESTINATION is main",
	},
	{ command: "git push origin +main", rest: "push origin +main", kind: "git", currentBranch: "feature/x", expected: "block", why: "a leading + is the force-push spelling of the same destination" },
	{ command: "git push origin +refs/heads/main", rest: "push origin +refs/heads/main", kind: "git", currentBranch: "feature/x", expected: "block", why: "force marker and refs/heads/ prefix are both stripped" },
	{ command: "git push origin +feature/x:main", rest: "push origin +feature/x:main", kind: "git", currentBranch: "feature/x", expected: "block", why: "forced src:dst refspec naming a protected destination" },
	{ command: "git push --mirror origin", rest: "push --mirror origin", kind: "git", currentBranch: "feature/x", expected: "block", why: "--mirror pushes every ref, protected ones included" },
	{ command: "git push --all --force origin", rest: "push --all --force origin", kind: "git", currentBranch: "feature/x", expected: "block", why: "--all pushes every branch, protected ones included" },
	{ command: "git push --branches origin", rest: "push --branches origin", kind: "git", currentBranch: "feature/x", expected: "block", why: "--branches is the newer spelling of --all" },
	{ command: "git push origin +feature/x:feature/x", rest: "push origin +feature/x:feature/x", kind: "git", currentBranch: "feature/x", expected: "allow", why: "force-pushing a non-protected branch stays allowed" },
	{
		command: "git push origin feature/x:feature/x",
		rest: "push origin feature/x:feature/x",
		kind: "git",
		currentBranch: "feature/x",
		expected: "allow",
		why: "the paired negative -- a push whose destination is NOT a protected branch, from a non-protected HEAD, must still be allowed, so the rule cannot degenerate into \"any push is blocked\"",
	},
	{ command: "git push -u origin HEAD:refs/heads/feature/x", rest: "push -u origin HEAD:refs/heads/feature/x", kind: "git", currentBranch: "feature/x", expected: "allow", why: "explicit full-ref destination that is not protected" },
	{ command: "git push -o ci.skip origin feature/x:feature/x", rest: "push -o ci.skip origin feature/x:feature/x", kind: "git", currentBranch: "feature/x", expected: "allow", why: "-o consumes its value, so the remote and refspec are still found" },
	{ command: "git push --repo origin feature/x:feature/x", rest: "push --repo origin feature/x:feature/x", kind: "git", currentBranch: "feature/x", expected: "allow", why: "--repo names the remote, so every positional is a refspec" },
	{ command: "git push origin --delete feature/old", rest: "push origin --delete feature/old", kind: "git", currentBranch: "feature/x", expected: "allow", why: "--delete names the destination directly, and it is not protected" },
	{ command: "git push origin --delete main", rest: "push origin --delete main", kind: "git", currentBranch: "feature/x", expected: "block", why: "deleting a protected branch" },
	{ command: "git push origin :main", rest: "push origin :main", kind: "git", currentBranch: "feature/x", expected: "block", why: "empty-source refspec deletes the protected destination" },
	{ command: "git push", rest: "push", kind: "git", currentBranch: "feature/x", expected: "block", why: "a bare push takes its destination from remote.<r>.push / push.default, which argv cannot show" },
	{ command: "git push origin", rest: "push origin", kind: "git", currentBranch: "feature/x", expected: "block", why: "remote but no refspec: destination comes from config" },
	{ command: "git push -o ci.skip origin", rest: "push -o ci.skip origin", kind: "git", currentBranch: "feature/x", expected: "block", why: "-o's value must not be mistaken for the remote, leaving origin as a refspec" },
	{ command: "git push origin feature/x", rest: "push origin feature/x", kind: "git", currentBranch: "feature/x", expected: "block", why: "a bare source has its destination chosen by remote.<r>.push when configured" },
	{ command: "git push origin :", rest: "push origin :", kind: "git", currentBranch: "feature/x", expected: "block", why: "the matching refspec pushes every same-named branch, main included (confirmed against a bare remote)" },
	{ command: "git push origin +:", rest: "push origin +:", kind: "git", currentBranch: "feature/x", expected: "block", why: "forced matching refspec" },
	{ command: "git push origin refs/heads/*:refs/heads/*", rest: "push origin refs/heads/*:refs/heads/*", kind: "git", currentBranch: "feature/x", expected: "block", why: "a wildcard destination reaches every branch (confirmed against a bare remote)" },
	{ command: "git push origin +refs/heads/*:refs/heads/*", rest: "push origin +refs/heads/*:refs/heads/*", kind: "git", currentBranch: "feature/x", expected: "block", why: "forced wildcard refspec" },
	{ command: "git push origin --prune refs/heads/*:refs/heads/*", rest: "push origin --prune refs/heads/*:refs/heads/*", kind: "git", currentBranch: "feature/x", expected: "block", why: "wildcard refspec behind an unrelated flag" },
	{ command: "git push origin feature/x:heads/main", rest: "push origin feature/x:heads/main", kind: "git", currentBranch: "feature/x", expected: "block", why: "git DWIMs heads/main to refs/heads/main on the remote" },
	{ command: "git push origin feature/x:HEAD", rest: "push origin feature/x:HEAD", kind: "git", currentBranch: "feature/x", expected: "block", why: "the remote's HEAD is its default branch" },
	{ command: "git push -fo x origin feature/x:feature/x", rest: "push -fo x origin feature/x:feature/x", kind: "git", currentBranch: "feature/x", expected: "block", why: "a clustered short flag ending in a value-taking flag is refused rather than parsed" },

	// -------------------------------------------------------------------------
	// glab -- blocked unconditionally on every branch (the deploy trigger)
	// -------------------------------------------------------------------------
	{ command: "glab mr merge", rest: "mr merge", kind: "glab", currentBranch: "main", expected: "block", why: "the MR merge IS the deploy trigger (decision 13)" },
	{ command: "glab mr merge", rest: "mr merge", kind: "glab", currentBranch: "feature/x", expected: "block", why: "unconditional on branch -- the merge target is what deploys, not HEAD" },
	{ command: "glab mr merge 123", rest: "mr merge 123", kind: "glab", currentBranch: "main", expected: "block", why: "merge with an explicit IID is still a merge" },
	{ command: "glab mr merge --auto-merge", rest: "mr merge --auto-merge", kind: "glab", currentBranch: "main", expected: "block", why: "merge with a flag is still a merge" },
	{ command: "glab mr list", rest: "mr list", kind: "glab", currentBranch: "main", expected: "allow", why: "read-only" },
	{ command: "glab mr view", rest: "mr view", kind: "glab", currentBranch: "main", expected: "allow", why: "read-only" },
	{ command: "glab ci status", rest: "ci status", kind: "glab", currentBranch: "main", expected: "allow", why: "read-only" },
	{ command: "glab repo clone", rest: "repo clone", kind: "glab", currentBranch: "main", expected: "block", why: "unclassified subcommand -- fail closed" },

	// -------------------------------------------------------------------------
	// PLAN 09-04 (FLOW-08) -- glab mr create, a conditional allow on the
	// invocation's own DESTINATION target, independent of currentBranch
	// -------------------------------------------------------------------------
	{ command: "glab mr create --target-branch staging", rest: "mr create --target-branch staging", kind: "glab", currentBranch: "main", expected: "allow", why: "an explicit, present, non-protected target -- the separated form" },
	{ command: "glab mr create --target-branch=staging", rest: "mr create --target-branch=staging", kind: "glab", currentBranch: "main", expected: "allow", why: "the = form of the same flag" },
	{ command: "glab mr create -b staging", rest: "mr create -b staging", kind: "glab", currentBranch: "main", expected: "allow", why: "the -b short flag" },
	{ command: "glab mr create --target-branch staging --draft --title x", rest: "mr create --target-branch staging --draft --title x", kind: "glab", currentBranch: "main", expected: "allow", why: "unrelated flags after the leading target flag" },
	{ command: "glab mr create --draft --target-branch staging --title x", rest: "mr create --draft --target-branch staging --title x", kind: "glab", currentBranch: "main", expected: "block", why: "the target must come first: an earlier value-taking flag could swallow it (`--title --target-branch staging`)" },
	{ command: "glab mr create --title --target-branch staging", rest: "mr create --title --target-branch staging", kind: "glab", currentBranch: "main", expected: "block", why: "pflag gives --title the value \"--target-branch\", so the real target is omitted and defaults to the protected branch" },
	{ command: "glab mr create --target-branch staging --target-branch main", rest: "mr create --target-branch staging --target-branch main", kind: "glab", currentBranch: "main", expected: "block", why: "a repeated flag keeps its last value in pflag, so this targets main" },
	{ command: "glab mr create -b staging --target-branch=main", rest: "mr create -b staging --target-branch=main", kind: "glab", currentBranch: "main", expected: "block", why: "mixed spellings of a repeated target flag" },
	{ command: "glab mr create --target-branch=refs/heads/main", rest: "mr create --target-branch=refs/heads/main", kind: "glab", currentBranch: "main", expected: "block", why: "refs/heads/ prefix is normalised before the protected comparison" },
	{ command: "glab mr create -bmain", rest: "mr create -bmain", kind: "glab", currentBranch: "main", expected: "block", why: "attached short-flag value is refused rather than parsed" },
	{ command: "glab mr create -db staging", rest: "mr create -db staging", kind: "glab", currentBranch: "main", expected: "block", why: "clustered short flags containing b are refused rather than parsed" },
	{ command: "glab mr create", rest: "mr create", kind: "glab", currentBranch: "main", expected: "block", why: "no explicit target -- GitLab defaults an omitted target to the project default branch, so silence is the deploy trigger" },
	{ command: "glab mr create --target-branch main", rest: "mr create --target-branch main", kind: "glab", currentBranch: "main", expected: "block", why: "the target is a protected branch" },
	{ command: "glab mr create --target-branch MAIN", rest: "mr create --target-branch MAIN", kind: "glab", currentBranch: "main", expected: "block", why: "case-insensitive match against protected branch names, mirroring isProtected" },
	{ command: "glab mr create --target-branch master", rest: "mr create --target-branch master", kind: "glab", currentBranch: "main", expected: "block", why: "master is also protected" },
	{ command: "glab mr merge --target-branch staging", rest: "mr merge --target-branch staging", kind: "glab", currentBranch: "main", expected: "block", why: "the blocked-subcommand table is consulted before the mr create conditional-allow -- a merge carrying a target-branch flag is still a merge" },
];

describe("SAFE-04/SAFE-05 -- git-policy.test.ts: table is non-empty (vacuous-pass guard)", () => {
	it("has at least the rows the plan's acceptance criteria name", () => {
		expect(ROWS.length, "a shortened table silently drops a named allow or block case").toBeGreaterThanOrEqual(28);
	});
});

describe("SAFE-04/SAFE-05 -- classifyGitInvocation / classifyGlabInvocation over the table", () => {
	for (const row of ROWS) {
		it(`${row.command} on "${row.currentBranch}" -> ${row.expected} (${row.why})`, () => {
			const inv = invocation(row.rest);
			const verdict =
				row.kind === "git"
						? classifyGitInvocation(inv, facts(row.currentBranch))
						: classifyGlabInvocation(inv, facts(row.currentBranch).protectedBranches);

			expect(
				verdict.kind,
				`expected ${row.expected} for "${row.command}" on "${row.currentBranch}", got ${verdict.kind}` +
					(verdict.kind === "block" ? ` (${verdict.reason})` : ""),
			).toBe(row.expected);
		});
	}
});

describe("git push with config overrides", () => {
	it.each([["push.default=matching"], ["remote.origin.push=refs/heads/feature/x:refs/heads/main"], ["branch.feature/x.merge=refs/heads/main"]])(
		"-c %s blocks even with an explicit safe refspec",
		(override) => {
			const verdict = classifyGitInvocation(
				{ subcommand: "push", args: ["origin", "feature/x:feature/x"], configOverrides: [override] },
				facts("feature/x"),
			);
			expect(verdict.kind).toBe("block");
		},
	);

	it("an unrelated -c override does not block", () => {
		const verdict = classifyGitInvocation(
			{ subcommand: "push", args: ["origin", "feature/x:feature/x"], configOverrides: ["core.quotePath=false"] },
			facts("feature/x"),
		);
		expect(verdict.kind).toBe("allow");
	});
});

describe("glab mr create target normalisation", () => {
	it("trims whitespace around the target before the protected comparison", () => {
		const verdict = classifyGlabInvocation({ subcommand: "mr", args: ["create", "--target-branch", "main "] }, PROTECTED);
		expect(verdict.kind).toBe("block");
	});
});

describe("SAFE-04/SAFE-05 -- liveness guard: every table key is exercised", () => {
	const gitSubcommandsUsed = new Set(ROWS.filter((r) => r.kind === "git").map((r) => invocation(r.rest).subcommand));
	const glabSubcommandsUsed = new Set(
		ROWS.filter((r) => r.kind === "glab").map((r) => invocation(r.rest).subcommand),
	);

	it("every GIT_WRITE_SUBCOMMANDS key is exercised by at least one row", () => {
		const dead = GIT_WRITE_SUBCOMMANDS.map((r) => r.subcommand).filter((s) => !gitSubcommandsUsed.has(s));
		expect(dead, `these write-table subcommands have no fixture row: ${dead.join(", ")}`).toEqual([]);
	});

	it("every GIT_READ_SUBCOMMANDS key is exercised by at least one row", () => {
		const dead = GIT_READ_SUBCOMMANDS.map((r) => r.subcommand).filter((s) => !gitSubcommandsUsed.has(s));
		expect(dead, `these read-table subcommands have no fixture row: ${dead.join(", ")}`).toEqual([]);
	});

	it("both write and read tables are non-empty (guards against a vacuous coverage check)", () => {
		expect(GIT_WRITE_SUBCOMMANDS.length).toBeGreaterThan(0);
		expect(GIT_READ_SUBCOMMANDS.length).toBeGreaterThan(0);
	});

	it("glab rows exercise both a blocked and an allowed subcommand form", () => {
		expect(glabSubcommandsUsed.has("mr"), "no glab \"mr\" row -- mr merge/list/view are the whole point").toBe(true);
		expect(glabSubcommandsUsed.has("ci"), "no glab \"ci\" row").toBe(true);
	});
});

describe("SAFE-04 -- currentBranch is exported with a symbolic-ref oracle and a named detached value", () => {
	it("DETACHED_HEAD is a distinct, non-empty sentinel string", () => {
		expect(typeof DETACHED_HEAD).toBe("string");
		expect(DETACHED_HEAD.length).toBeGreaterThan(0);
	});

	it("currentBranch is a function (the real spawnSync-backed proof lives in the integration test)", () => {
		expect(typeof currentBranch).toBe("function");
	});
});
