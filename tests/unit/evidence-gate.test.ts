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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { currentSha } from "../../.pi/extensions/safety/git.ts";
import { gateCompletion, type EvidenceRecord } from "../../.pi/extensions/workflows/evidence.ts";
import { commitFile, headSha, makeTempRepo } from "../helpers/git.ts";

const tempDirs: string[] = [];

const repo = makeTempRepo("quick-evidence-");
tempDirs.push(repo);

/** First commit -- the "stale" SHA every R2/M1 row records evidence against. */
const shaA = commitFile(repo, "a.txt", "one", "first commit");
/** Second commit -- the repo's current HEAD, what every claim is made against. */
const shaB = commitFile(repo, "b.txt", "two", "second commit");

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
		name: "R3 -- failed command at the current SHA",
		records: [record("bash", shaB, true)],
		expected: "reject",
		reasonMustContain: ["bash"],
		why: "a record with isError:true at HEAD, with no passing record, must reject naming the failing tool",
	},
	{
		name: "A1 -- structured, non-error, at HEAD, and a commit genuinely landed (baseSha !== headSha)",
		records: [record("bash", shaB, false)],
		expected: "accept",
		reasonMustContain: [],
		why: "the one accepted shape: a non-error tool result captured at the SHA that is still HEAD, with HEAD having actually moved since the run was armed",
	},
	{
		name: "M1 -- no borrowing: stale-but-passing plus fresh-but-failing",
		records: [record("bash", shaA, false), record("bash", shaB, true)],
		expected: "reject",
		reasonMustContain: ["bash"],
		why: "a passing record from a DIFFERENT sha may not be borrowed to rescue a claim at HEAD -- only records already at headSha are considered for the isError check",
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

	for (const row of ROWS) {
		it(row.name, () => {
			const head = currentSha(repo);
			const verdict = gateCompletion(row.records, head, row.baseSha ?? shaA);

			if (row.expected === "accept") {
				expect(verdict.ok, `${row.why} -- got ${JSON.stringify(verdict)}`).toBe(true);
				if (verdict.ok) {
					expect(verdict.sha).toBe(head);
					expect(verdict.sha).toBe(shaB);
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
		const verdict = gateCompletion([], currentSha(repo), shaA);
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

afterAll(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});
