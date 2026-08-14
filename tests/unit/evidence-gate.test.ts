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
import {
	armedCwd,
	endRun,
	gateCompletion,
	isRunArmed,
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
	{
		name: "CR-01c (iteration 2, PROBE F) -- a failure at the STALE sha cannot be buried by a later commit's own passing record at headSha",
		records: [record("bash", shaA, true), record("bash", shaB, false)],
		baseSha: shaA,
		expected: "reject",
		reasonMustContain: ["bash"],
		why:
			"PROBE F, verbatim: a verification command fails (isError:true, captured at the pre-commit sha), then a " +
			"commit lands (its own tool_result is a passing record at the new HEAD). Before this branch existed the " +
			"predicate narrowed to records AT headSha before ever inspecting isError, so the failing record -- sitting " +
			"at baseSha, not headSha -- was silently discarded and this shape ACCEPTED. The failure must reject " +
			"regardless of where HEAD ends up.",
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

describe("WR-03: armedCwd() reports the cwd the run was armed against", () => {
	it("returns undefined before any startRun(), the exact armed cwd once armed, and undefined again once disarmed", () => {
		expect(armedCwd(), "no run armed yet").toBeUndefined();

		startRun(repo, shaA);
		expect(
			armedCwd(),
			"armedCwd() must return the exact cwd startRun() was called with, not some other ambient cwd",
		).toBe(repo);

		recordToolResult({ ts: Date.now(), toolName: "bash", command: "echo hi", isError: false, sha: shaB });
		endRun(shaB);
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
		expect(endRun(shaB)).toBeUndefined();
	});

	it("a second startRun() discards the first buffer entirely (WR-01's pinned behaviour)", () => {
		startRun(repo, shaA);
		recordToolResult(record("bash", shaA, false));
		expect(isRunArmed()).toBe(true);

		startRun(repo, shaB); // re-arms; the first run's one record must not survive
		expect(isRunArmed()).toBe(true);
		const verdict = endRun(shaB);
		expect(verdict?.ok).toBe(false);
		if (verdict?.ok === false) {
			expect(verdict.reason).toContain("structured");
		}
		expect(isRunArmed()).toBe(false);
	});

	it("endRun() disarms: a second endRun() call with no intervening startRun() returns undefined", () => {
		startRun(repo, shaA);
		recordToolResult(record("bash", shaB, false));
		expect(endRun(shaB)?.ok).toBe(true);
		expect(endRun(shaB)).toBeUndefined();
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
