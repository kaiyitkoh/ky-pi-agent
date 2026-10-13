/**
 * GATE-07 — `.pi/extensions/workflows/evidence.ts`, table-driven.
 *
 * A `{name, records, expected, reasonMustContain, why}` table over
 * `gateCompletion`, following `git-policy.test.ts`'s shape. Every SHA in
 * this file comes from a REAL repository (`tests/helpers/git.ts`'s
 * `makeTempRepo`/`commitFile`/`headSha`) — no 40-character hex literal
 * appears anywhere below, because a gate whose SHA is a fixture constant
 * cannot distinguish "bound correctly" from "bound to nothing".
 *
 * Every rejection is asserted on its REASON string (`capability-guard.test
 * .ts`'s house convention: never merely on `ok === false`), and the table's
 * own non-emptiness is asserted first — this repo's standing vacuous-pass
 * guard (`git-policy.test.ts`, `extension-layout.test.ts`).
 *
 * MUTATION ARGUMENTS. Four falsifications of `gateCompletion` (deleting
 * branch 1, weakening branch 2's equality, deleting branch 3, and forcing an
 * always-reject return) plus one falsification of `currentSha` were each
 * executed by hand against this file's real `npx vitest run` output, then
 * reverted. The observed RED output for each is recorded in
 * `06-01-SUMMARY.md`, not merely asserted here.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { currentSha, currentTree } from "../../.pi/extensions/safety/git.ts";
import {
	armedCwd,
	endRun,
	gateCompletion,
	isRunArmed,
	isStrictDescendant,
	onlyCommitsSince,
	recordFromToolResult,
	recordToolResult,
	startRun,
	type EvidenceRecord,
} from "../../.pi/extensions/workflows/evidence.ts";
import { commitFile, headSha, makeTempRepo } from "../helpers/git.ts";

const tempDirs: string[] = [];

const repo = makeTempRepo("quick-evidence-");
tempDirs.push(repo);

/** First commit -- the "stale" SHA every R2/M1 row records evidence against. */
const shaA = commitFile(repo, "a.txt", "one", "first commit");
/** Second commit -- the repo's current HEAD, what every claim is made against. */
const shaB = commitFile(repo, "b.txt", "two", "second commit");

/** The tree object id of `shaA`, read directly via `git rev-parse <sha>^{tree}` -- `currentTree` only reads HEAD's tree, so an older commit's tree needs its own lookup. */
function treeOfSha(cwd: string, sha: string): string {
	const result = spawnSync("git", ["rev-parse", `${sha}^{tree}`], { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (result.status !== 0) {
		throw new Error(`git rev-parse ${sha}^{tree} failed (exit ${result.status}) in ${cwd}`);
	}
	return (result.stdout ?? "").trim();
}

/** GATE-01: shaA's tree -- genuinely different from shaB's tree below, since the second commit adds a new file rather than amending the first. */
const treeA = treeOfSha(repo, shaA);
/** GATE-01: shaB's tree -- `repo`'s HEAD is still shaB at this point, so `currentTree` (the real production function) reads it directly. */
const treeB = currentTree(repo);

/** Maps a fixture SHA to its already-computed tree -- the only two SHAs `ROWS`' `baseSha` ever names. */
function treeForSha(sha: string): string {
	if (sha === shaA) return treeA;
	if (sha === shaB) return treeB;
	throw new Error(`treeForSha: no known tree for sha ${sha} -- ROWS only ever names shaA or shaB`);
}

/** A convincing fabricated transcript. NEVER fed to `records` -- R1 proves the gate never looked at it. */
const FABRICATED_TRANSCRIPT = "$ npm test\nexit 0\nAll 12 tests passed.";

function record(toolName: string, sha: string, isError: boolean): EvidenceRecord {
	return { ts: Date.now(), toolName, command: `echo ${toolName}`, isError, sha };
}

interface Row {
	readonly name: string;
	readonly records: readonly EvidenceRecord[];
	/** Defaults to `shaA` when omitted -- distinct from `shaB` (HEAD), so the CR-01 branch never fires by accident. */
	readonly baseSha?: string;
	readonly expected: "accept" | "reject";
	readonly reasonMustContain: readonly string[];
	readonly why: string;
	readonly failedToolCalls?: number;
}

const ROWS: readonly Row[] = [
	{
		name: "R1 -- fabricated prose, no structured tool result at all",
		records: [],
		expected: "reject",
		reasonMustContain: ["structured", "tool result"],
		why: "a transcript-shaped string claiming success is not evidence; the gate must reject on an empty record set regardless of what any transcript text says",
	},
	{
		name: "CR-01a -- HEAD never moved: no commit landed, one passing record at the unchanged HEAD",
		records: [record("bash", shaB, false)],
		baseSha: shaB,
		expected: "reject",
		reasonMustContain: ["no commit", shaB],
		why: "PROBE A: `bash echo hi` with no commit must not satisfy a completion claim just because the record happens to sit at an unmoved HEAD",
	},
	{
		name: "CR-01b -- HEAD never moved: no commit landed, no tool result at all either",
		records: [],
		baseSha: shaB,
		expected: "reject",
		reasonMustContain: ["structured", "tool result"],
		why: "PROBE B: a bare `read`, with no commit and no bash call, must reject at branch (1) -- empty records -- before the CR-01 branch is even reached",
	},
	{
		name: "R2 -- stale SHA: evidence recorded at A, claim made at head (B)",
		records: [record("bash", shaA, false)],
		expected: "reject",
		reasonMustContain: [shaA, shaB],
		why: "evidence captured at an older commit than HEAD must not satisfy a claim made now",
	},
	{
		name: "R3 -- a failed command at the current SHA is logged, not fatal",
		records: [record("bash", shaB, true)],
		expected: "accept",
		reasonMustContain: [],
		failedToolCalls: 1,
		why: "a commit landed with evidence at HEAD; the failed call is counted, and the declared verification is the caller's check",
	},
	{
		name: "A1 -- structured, non-error, at HEAD, and a commit genuinely landed (baseSha !== headSha)",
		records: [record("bash", shaB, false)],
		expected: "accept",
		reasonMustContain: [],
		why: "the one accepted shape: a non-error tool result captured at the SHA that is still HEAD, with HEAD having actually moved since the run was armed",
	},
	{
		name: "M1 -- stale-but-passing plus fresh-but-failing still has evidence at HEAD",
		records: [record("bash", shaA, false), record("bash", shaB, true)],
		expected: "accept",
		reasonMustContain: [],
		failedToolCalls: 1,
		why: "only the presence of a record at HEAD is required; the failure is counted",
	},
	{
		name: "D-01 -- exploratory failures before a clean commit: no-match grep, red test, failed edit",
		records: [
			record("grep", shaA, true),
			record("bash", shaA, true),
			record("edit", shaA, true),
			record("bash", shaB, false),
		],
		baseSha: shaA,
		expected: "accept",
		reasonMustContain: [],
		failedToolCalls: 3,
		why: "a task passes when it produced a commit and its declared verification passes at the end; intermediate non-zero exits are logged, not fatal",
	},
	{
		name: "D-01 -- failures only at a stale sha and nothing at HEAD still rejects as stale",
		records: [record("bash", shaA, true)],
		expected: "reject",
		reasonMustContain: [shaA, shaB],
		why: "dropping the any-failure branch must not weaken the stale-evidence branch",
	},
];

describe("GATE-07 -- gateCompletion", () => {
	it("the table is non-empty (vacuous-pass guard)", () => {
		expect(ROWS.length, "an empty table would make every assertion below pass having checked nothing").toBeGreaterThan(0);
	});

	it("shaA and shaB are two genuinely different real SHAs, not fixture constants", () => {
		expect(shaA).toMatch(/^[0-9a-f]{40}$/);
		expect(shaB).toMatch(/^[0-9a-f]{40}$/);
		expect(shaA).not.toBe(shaB);
	});

	it("GATE-01: treeA and treeB are two genuinely different real trees, not fixture constants -- the second commit adds a file rather than amending the first", () => {
		expect(treeA).toMatch(/^[0-9a-f]{40}$/);
		expect(treeB).toMatch(/^[0-9a-f]{40}$/);
		expect(treeA).not.toBe(treeB);
	});

	for (const row of ROWS) {
		it(row.name, () => {
			const head = currentSha(repo);
			const headTree = currentTree(repo);
			const baseSha = row.baseSha ?? shaA;
			const verdict = gateCompletion(row.records, head, baseSha, headTree, treeForSha(baseSha), isStrictDescendant(repo, baseSha, head));

			if (row.expected === "accept") {
				expect(verdict.ok, `${row.why} -- got ${JSON.stringify(verdict)}`).toBe(true);
				if (verdict.ok) {
					expect(verdict.sha).toBe(head);
					expect(verdict.sha).toBe(shaB);
					expect(verdict.failedToolCalls).toBe(row.failedToolCalls ?? 0);
				}
				return;
			}

			expect(verdict.ok, `${row.why} -- got ${JSON.stringify(verdict)}`).toBe(false);
			if (!verdict.ok) {
				for (const substring of row.reasonMustContain) {
					expect(verdict.reason, `reason must name ${JSON.stringify(substring)}: "${verdict.reason}"`).toContain(
						substring,
					);
				}
			}
		});
	}

	it("R1's reason contains no substring of the fabricated transcript -- the gate never looked at it", () => {
		const verdict = gateCompletion([], currentSha(repo), shaA, currentTree(repo), treeA, true);
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason).not.toContain("exit 0");
			expect(verdict.reason).not.toContain("npm test");
			expect(verdict.reason).not.toContain("All 12 tests passed");
		}
		// The fixture itself really does contain the string the reason must not echo,
		// so the negative assertion above is meaningful rather than vacuous.
		expect(FABRICATED_TRANSCRIPT).toContain("exit 0");
	});
});

describe("WR-03: armedCwd() reports the cwd the run was armed against", () => {
	it("returns undefined before any startRun(), the exact armed cwd once armed, and undefined again once disarmed", () => {
		expect(armedCwd(), "no run armed yet").toBeUndefined();

		startRun(repo, shaA, treeA);
		expect(
			armedCwd(),
			"armedCwd() must return the exact cwd startRun() was called with, not some other ambient cwd",
		).toBe(repo);

		recordToolResult({ ts: Date.now(), toolName: "bash", command: "echo hi", isError: false, sha: shaB });
		endRun(shaB, treeB);
		expect(armedCwd(), "endRun() disarms -- armedCwd() must go back to undefined").toBeUndefined();
	});
});

describe("WR-06 -- recordFromToolResult never copies a value body, and redacts what it does copy", () => {
	it("copies only `command`/`path`, never any other field on toolInput (e.g. a file body)", () => {
		const SECRET_BODY = "AKIAABCDEFGHIJKLMNOP and the rest of a file nobody should see";
		const record = recordFromToolResult({
			toolName: "write",
			toolInput: { path: "x.ts", content: SECRET_BODY },
			isError: false,
			sha: shaB,
		});
		expect(record.command).toBe("x.ts");
		expect(JSON.stringify(record)).not.toContain(SECRET_BODY);
		expect(JSON.stringify(record)).not.toContain("AKIAABCDEFGHIJKLMNOP");
	});

	it("redacts a secret-shaped command before it is ever stored", () => {
		const record = recordFromToolResult({
			toolName: "bash",
			toolInput: { command: "curl -H 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwx' https://x" },
			isError: false,
			sha: shaB,
		});
		expect(record.command).not.toContain("sk-abcdefghijklmnopqrstuvwx");
		expect(record.command).toContain("[redacted:");
	});
});

describe("WR-06 -- run-state machinery (startRun / recordToolResult / isRunArmed / endRun)", () => {
	it("isRunArmed() is false, and recordToolResult()/endRun() are no-ops, before any startRun()", () => {
		expect(isRunArmed()).toBe(false);
		recordToolResult(record("bash", shaB, false)); // must not throw, must record nothing observable
		expect(endRun(shaB, treeB)).toBeUndefined();
	});

	it("a second startRun() discards the first buffer entirely (WR-01's pinned behaviour)", () => {
		startRun(repo, shaA, treeA);
		recordToolResult(record("bash", shaA, false));
		expect(isRunArmed()).toBe(true);

		startRun(repo, shaB, treeB); // re-arms; the first run's one record must not survive
		expect(isRunArmed()).toBe(true);
		const verdict = endRun(shaB, treeB);
		expect(verdict?.ok).toBe(false);
		if (verdict?.ok === false) {
			expect(verdict.reason).toContain("structured");
		}
		expect(isRunArmed()).toBe(false);
	});

	it("endRun() disarms: a second endRun() call with no intervening startRun() returns undefined", () => {
		startRun(repo, shaA, treeA);
		recordToolResult(record("bash", shaB, false));
		expect(endRun(shaB, treeB)).toBeDefined();
		expect(endRun(shaB, treeB)).toBeUndefined();
	});
});

describe("currentSha", () => {
	it("returns the same 40-char lowercase hex string git rev-parse HEAD prints, and matches headSha()", () => {
		expect(currentSha(repo)).toMatch(/^[0-9a-f]{40}$/);
		expect(currentSha(repo)).toBe(headSha(repo));
		expect(currentSha(repo)).toBe(shaB);
	});

	it("throws on a directory that is not a git repository", () => {
		const notARepo = mkdtempSync(join(tmpdir(), "quick-not-a-repo-"));
		tempDirs.push(notARepo);
		expect(() => currentSha(notARepo)).toThrow();
	});
});

/**
 * GATE-01 (Phase 8, plan 08-12) -- `gateCompletion`'s sixth ordered branch:
 * `headTree === baseTree` rejects. This is the exact residual `evidence.ts`'s
 * own docstring and `docs/WORKFLOWS.md` section 4 both named as Phase 8's
 * job: an empty commit (`git commit --allow-empty`) moves `HEAD` and its SHA
 * without moving its tree. A dedicated repo, separate from `repo` above, so
 * these commits cannot shift what `head`/`shaA`/`shaB` mean for any ROW in
 * the table above (`ROWS`' `it`s read `currentSha(repo)` fresh on every
 * run -- a later commit to the SAME repo would silently change what "HEAD"
 * means for every row that ran after it).
 */
describe("GATE-01 -- gateCompletion branch (6): the tree-comparison close of the empty-commit gap", () => {
	const gate01Repo = makeTempRepo("quick-evidence-gate01-");
	tempDirs.push(gate01Repo);
	const gate01BaseSha = commitFile(gate01Repo, "seed.txt", "seed", "seed commit");
	const gate01BaseTree = currentTree(gate01Repo);

	it("EMPTY COMMIT: git commit --allow-empty moves the SHA but not the tree -- gateCompletion rejects, naming both tree ids", () => {
		const result = spawnSync("git", ["commit", "--allow-empty", "-m", "empty commit"], {
			cwd: gate01Repo,
			encoding: "utf-8",
			shell: false,
			windowsHide: true,
		});
		expect(result.status, "git commit --allow-empty must itself succeed, or this test proves nothing").toBe(0);

		const emptyHeadSha = currentSha(gate01Repo);
		const emptyHeadTree = currentTree(gate01Repo);
		// The fixture really is the shape under test: SHA moved, tree did not.
		expect(emptyHeadSha, "an allow-empty commit must still produce a NEW sha").not.toBe(gate01BaseSha);
		expect(emptyHeadTree, "an allow-empty commit's tree must be byte-identical to its parent's -- that IS the empty-commit shape").toBe(gate01BaseTree);

		const verdict = gateCompletion(
			[record("bash", emptyHeadSha, false)],
			emptyHeadSha,
			gate01BaseSha,
			emptyHeadTree,
			gate01BaseTree,
			isStrictDescendant(gate01Repo, gate01BaseSha, emptyHeadSha),
		);
		expect(verdict.ok, `an empty commit must not satisfy a completion claim -- this is the exact gap Phase 8 closes -- got ${JSON.stringify(verdict)}`).toBe(false);
		if (!verdict.ok) {
			expect(verdict.reason, "the rejection reason must name both tree ids").toContain(emptyHeadTree);
			expect(verdict.reason, "the rejection reason must name both tree ids").toContain(gate01BaseTree);
		}
	});

	it("PAIRED POSITIVE: a commit that genuinely changes a file, from the same base, accepts", () => {
		const changedSha = commitFile(gate01Repo, "real-change.txt", "real content", "a real change");
		const changedTree = currentTree(gate01Repo);
		expect(changedTree, "a commit that adds a new file must produce a genuinely different tree").not.toBe(gate01BaseTree);

		const verdict = gateCompletion(
			[record("bash", changedSha, false)],
			changedSha,
			gate01BaseSha,
			changedTree,
			gate01BaseTree,
			isStrictDescendant(gate01Repo, gate01BaseSha, changedSha),
		);
		expect(verdict.ok, `a genuine content change must still accept -- without this, branch (6) would reject everything -- got ${JSON.stringify(verdict)}`).toBe(true);
	});

	it("a failed tool result no longer rejects when the tree changed and evidence sits at HEAD; the failure is counted", () => {
		const changedHeadSha = currentSha(gate01Repo);
		const changedHeadTree = currentTree(gate01Repo);
		expect(changedHeadTree).not.toBe(gate01BaseTree);

		const verdict = gateCompletion(
			[record("bash", changedHeadSha, true)],
			changedHeadSha,
			gate01BaseSha,
			changedHeadTree,
			gate01BaseTree,
			isStrictDescendant(gate01Repo, gate01BaseSha, changedHeadSha),
		);
		expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
		if (verdict.ok) expect(verdict.failedToolCalls).toBe(1);
	});

	it("currentTree throws on a directory that is not a git repository -- no sentinel, matching currentSha's contract", () => {
		const notARepo = mkdtempSync(join(tmpdir(), "quick-not-a-repo-tree-"));
		tempDirs.push(notARepo);
		expect(() => currentTree(notARepo)).toThrow();
	});
});

describe("a HEAD move that is not a new commit on the base is rejected", () => {
	const r = makeTempRepo("quick-evidence-ancestry-");
	tempDirs.push(r);
	const first = commitFile(r, "one.txt", "one", "first");
	const second = commitFile(r, "two.txt", "two", "second");

	it("a checkout back to an earlier commit moves HEAD and changes the tree, and still rejects", () => {
		const checkout = spawnSync("git", ["checkout", "--detach", first], { cwd: r, encoding: "utf-8", shell: false, windowsHide: true });
		expect(checkout.status, checkout.stderr).toBe(0);
		const head = currentSha(r);
		expect(head).toBe(first);
		expect(isStrictDescendant(r, second, head)).toBe(false);
		const verdict = gateCompletion([record("bash", head, false)], head, second, currentTree(r), treeOfSha(r, second), isStrictDescendant(r, second, head));
		expect(verdict.ok, JSON.stringify(verdict)).toBe(false);
		if (!verdict.ok) expect(verdict.reason).toContain("not a new commit");
	});

	it("through endRun: an armed run whose HEAD was reset backwards rejects", () => {
		spawnSync("git", ["checkout", "--detach", second], { cwd: r, shell: false, windowsHide: true });
		startRun(r, second, treeOfSha(r, second));
		spawnSync("git", ["reset", "--hard", first], { cwd: r, shell: false, windowsHide: true });
		recordToolResult(record("bash", first, false));
		const verdict = endRun(currentSha(r), currentTree(r));
		expect(verdict?.ok, JSON.stringify(verdict)).toBe(false);
	});

	it("a commit on top of the base is a strict descendant; the base itself is not", () => {
		const third = commitFile(r, "three.txt", "three", "third");
		expect(isStrictDescendant(r, first, third)).toBe(true);
		expect(isStrictDescendant(r, third, third)).toBe(false);
		expect(isStrictDescendant(r, "", third)).toBe(false);
	});
});

describe("only commits the run made count: a pull, merge or second-hand commit rejects", () => {
	const OLD_DATE = "2020-01-01T00:00:00Z";
	const git = (cwd: string, args: string[], env: Record<string, string> = {}) => {
		const r = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true, env: { ...process.env, ...env } });
		expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
	};
	/** A repo on `main` at `base`, with branch `upstream` one commit ahead, dated long before any run is armed. */
	function setup(): { r: string; base: string } {
		const r = makeTempRepo("quick-evidence-fresh-");
		tempDirs.push(r);
		const base = commitFile(r, "base.txt", "base", "base");
		git(r, ["checkout", "-q", "-b", "upstream"]);
		writeFileSync(join(r, "theirs.ts"), "export const theirs = 1;\n");
		git(r, ["add", "theirs.ts"]);
		git(r, ["commit", "-q", "-m", "teammate work"], { GIT_AUTHOR_DATE: OLD_DATE, GIT_COMMITTER_DATE: OLD_DATE });
		git(r, ["checkout", "-q", "-"]);
		return { r, base };
	}
	const settle = (r: string) => {
		recordToolResult(record("bash", currentSha(r), false));
		return endRun(currentSha(r), currentTree(r));
	};

	it("a fast-forward pull of a teammate's earlier commit rejects", () => {
		const { r, base } = setup();
		startRun(r, base, currentTree(r));
		git(r, ["merge", "--ff-only", "-q", "upstream"]);
		const verdict = settle(r);
		expect(verdict?.ok, JSON.stringify(verdict)).toBe(false);
		if (verdict !== undefined && !verdict.ok) expect(verdict.reason).toContain("did not make");
	});

	it("a merge commit made during the run rejects", () => {
		const { r, base } = setup();
		startRun(r, base, currentTree(r));
		commitFile(r, "mine.ts", "export const mine = 1;", "my work");
		git(r, ["merge", "--no-ff", "-q", "-m", "merge upstream", "upstream"]);
		expect(settle(r)?.ok).toBe(false);
	});

	it("a cherry-pick keeps the old author date and rejects", () => {
		const { r, base } = setup();
		startRun(r, base, currentTree(r));
		git(r, ["cherry-pick", "upstream"]);
		expect(settle(r)?.ok).toBe(false);
	});

	it("PAIRED POSITIVE: one or two commits made during the run accept", () => {
		const { r, base } = setup();
		startRun(r, base, currentTree(r));
		commitFile(r, "mine.ts", "export const mine = 1;", "my work");
		commitFile(r, "mine2.ts", "export const mine2 = 2;", "my follow-up");
		const verdict = settle(r);
		expect(verdict?.ok, JSON.stringify(verdict)).toBe(true);
		expect(onlyCommitsSince(r, base, currentSha(r), Date.now() - 60_000)).toBe(true);
	});
});

afterAll(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});
