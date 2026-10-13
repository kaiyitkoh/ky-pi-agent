/**
 * A standing denylist scan over every tracked file, so redacted account-identifying strings (an AWS account id, an
 * IAM principal ARN, an admin profile name) cannot return to this public repo. Needles are assembled from fragments
 * at run time, so this file scans itself with no exemption. A synthetic corpus proves the scanner finds each needle,
 * and a file-count floor proves the real scan read the tree.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

/** One denied string, assembled at run time; `label` names the class in failures without printing the identifier. */
interface DeniedLiteral {
	readonly label: string;
	readonly needle: string;
}

/** The redacted literals, assembled from fragments and matched case-insensitively. */
const DENIED_LITERALS: readonly DeniedLiteral[] = [
	{
		label: "the developer's real 12-digit AWS account number",
		needle: ["148", "761", "664", "205"].join(""),
	},
	{
		label: "the developer's real IAM admin principal name",
		needle: ["iam", "admin"].join(""),
	},
];

/** Structural patterns that generalise beyond one incident: any real AWS account ARN is the same mistake. */
const DENIED_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
	{
		label: "a real AWS IAM ARN (arn:aws:iam:: followed by a 12-digit account id)",
		// From fragments too: the `<redacted>` placeholder form stays legal, only the digit form must not.
		pattern: new RegExp(["arn:aws:", "iam::", "\\d{12}"].join(""), "i"),
	},
];

/** Every hit the scanner found, as `path:line label`. */
function scan(files: readonly { path: string; text: string }[]): string[] {
	const hits: string[] = [];
	for (const { path, text } of files) {
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			const lower = line.toLowerCase();
			for (const { label, needle } of DENIED_LITERALS) {
				if (lower.includes(needle.toLowerCase())) hits.push(`${path}:${i + 1} ${label}`);
			}
			for (const { label, pattern } of DENIED_PATTERNS) {
				if (pattern.test(line)) hits.push(`${path}:${i + 1} ${label}`);
			}
		}
	}
	return hits;
}

/** Tracked text files from disk; binaries skipped by extension, since every needle is ASCII. */
const BINARY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf"];

function trackedTextFiles(): { path: string; text: string }[] {
	const out: { path: string; text: string }[] = [];
	for (const rel of trackedFiles()) {
		if (BINARY_EXTENSIONS.some((ext) => rel.toLowerCase().endsWith(ext))) continue;
		out.push({ path: rel, text: readFileSync(join(repoRoot(), rel), "utf-8") });
	}
	return out;
}

describe("CR-01 -- no account-identifying string may live in a tracked file", () => {
	const files = trackedTextFiles();

	it("Direction 1 -- the tracked tree carries none of the denied identifiers", () => {
		const hits = scan(files);
		expect(
			hits,
			"CR-01: an identifier redacted from this public repository has come back. The finding these " +
				"strings recorded (a live IAM admin principal with long-lived static keys on the dev " +
				"machine) is correct and must be kept -- but state it WITHOUT the account number, the ARN " +
				"or the profile name, as docs/EXTENSIONS.md and docs/RUNBOOK.md now do. See RB-07-03.",
		).toEqual([]);
	});

	it("Direction 2 -- the same scanner reports every needle when one is genuinely present", () => {
		// Vacuity guard: the same scan() over synthetic text carrying each denied form must find each one.
		const synthetic = [
			{ path: "synthetic/account.md", text: `Account ${["148", "761", "664", "205"].join("")} is live\n` },
			{ path: "synthetic/principal.md", text: `profile ${["iam", "admin"].join("")}-production\n` },
			{
				path: "synthetic/arn.md",
				text: `${["arn:aws:", "iam::", "000000000000", ":user/bob"].join("")}\n`,
			},
		];
		const hits = scan(synthetic);

		expect(
			hits.map((h) => h.split(" ")[0]).sort(),
			"the scanner must flag all three synthetic files -- if it flags fewer, Direction 1's empty " +
				"result is a measurement of the scanner, not of the tree",
		).toEqual(["synthetic/account.md:1", "synthetic/arn.md:1", "synthetic/principal.md:1"]);

		// And each label must be reachable, so a denylist row that never fires is visible.
		for (const { label } of DENIED_LITERALS) {
			expect(hits.some((h) => h.includes(label)), `denylist row never fired: ${label}`).toBe(true);
		}
		for (const { label } of DENIED_PATTERNS) {
			expect(hits.some((h) => h.includes(label)), `denylist pattern never fired: ${label}`).toBe(true);
		}
	});

	it("Direction 3 -- the real scan read a non-trivial number of tracked files", () => {
		// An empty trackedFiles() would pass Direction 1 having read nothing; 100 is a floor well below the real count.
		expect(
			files.length,
			"trackedFiles() returned almost nothing -- Direction 1 scanned an empty tree and proved nothing",
		).toBeGreaterThan(100);
	});

	it("Direction 4 -- this file is itself scanned, with no exemption", () => {
		// This file is scanned too, which works only because every needle is assembled at run time.
		expect(
			files.map((f) => f.path),
			"tests/unit/secret-scan.test.ts must be inside its own scan -- an exempted file is exactly " +
				"where a re-introduced identifier would hide",
		).toContain("tests/unit/secret-scan.test.ts");
	});
});
