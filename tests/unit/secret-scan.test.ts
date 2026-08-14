/**
 * CR-01 -- a standing denylist scan over every TRACKED file, so the real
 * account-identifying strings that were committed during Phase 7 cannot be
 * re-introduced silently.
 *
 * ---------------------------------------------------------------------------
 * WHAT HAPPENED, AND WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Plan 07-10 verified the install gate's pre-authorisation ground (a) -- "this
 * dev machine has no credentials" -- by running `aws sts get-caller-identity`
 * and found it FALSE. That finding is correct, important, and must survive.
 * What must NOT survive is the way it was recorded: the real 12-digit AWS
 * account number, the full IAM principal ARN and the named admin profile were
 * written verbatim into `docs/EXTENSIONS.md`, `docs/RUNBOOK.md` and three
 * `.planning/` artifacts, in a repository `CLAUDE.md` describes as public.
 *
 * None of it is a secret in the API-key sense. Jointly it is precise targeting
 * information: an account id is the first thing needed for cross-account role
 * enumeration, and "plaintext long-lived admin keys live on this laptop" names
 * the highest-value target on the machine. `PROJECT.md`'s constraint is
 * unqualified -- "Public repo. No credential may ever be committed. Structure
 * complete, values injected at runtime."
 *
 * Every occurrence has been redacted. This file is what stops the next one.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NEEDLES ARE ASSEMBLED FROM FRAGMENTS
 * ---------------------------------------------------------------------------
 * A denylist that spells its own denied strings is a tracked file containing
 * them -- it would either match itself, or need an exemption, and an exempted
 * file is exactly where a re-introduction would hide. Every literal below is
 * built by joining fragments at run time, so this file scans itself with no
 * carve-out at all. `tests/unit/redact.test.ts:61` already uses this idiom for
 * its Slack-token fixture; this is the same trick for the same reason.
 *
 * ---------------------------------------------------------------------------
 * BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * Direction 1 scans the real tracked tree and must find nothing. On its own
 * that assertion passes for a scanner that matches nothing at all -- the
 * green-but-vacuous shape this repository has been bitten by before. So
 * Direction 2 runs the SAME scanner over a synthetic corpus that carries every
 * needle and asserts each one is reported, and Direction 3 asserts the real
 * scan actually read a non-trivial number of files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

/**
 * One denied string, assembled at run time.
 *
 * `label` is what a failure message says, so a developer who trips this knows
 * WHICH class of identifier they re-introduced without the message itself
 * printing the identifier into CI logs.
 */
interface DeniedLiteral {
	readonly label: string;
	readonly needle: string;
}

/**
 * The literals redacted by CR-01. Assembled from fragments -- see this file's
 * header for why. Case-insensitive matching is applied at the scan site.
 */
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

/**
 * Structural patterns. Unlike {@link DENIED_LITERALS} these generalise beyond
 * the one incident: ANY real AWS account ARN in a tracked file is the same
 * mistake, whoever's account it names.
 */
const DENIED_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
	{
		label: "a real AWS IAM ARN (arn:aws:iam:: followed by a 12-digit account id)",
		// Rebuilt from fragments for the same reason the literals are: the redacted
		// placeholder form `arn:aws:iam::<redacted>:user/<redacted>` must stay
		// legal, and only the digit form must not.
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

/**
 * Tracked text files, read from disk. Binary-ish paths are skipped by
 * extension rather than by content sniffing -- the denied strings are all
 * ASCII, so a `.png` cannot carry one in a form this scan would need to see.
 */
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
		// Vacuity guard. Direction 1 alone is satisfied by a scanner that matches
		// nothing -- a wrong `needle`, a broken `join`, a regex that never compiles
		// to anything. This runs the SAME `scan()` over synthetic text carrying each
		// denied form and asserts each is found.
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
		// `trackedFiles()` returning [] would make Direction 1 pass while reading
		// nothing. The repository is well over 200 tracked files; 100 is a floor
		// that cannot be reached by an empty or single-entry result.
		expect(
			files.length,
			"trackedFiles() returned almost nothing -- Direction 1 scanned an empty tree and proved nothing",
		).toBeGreaterThan(100);
	});

	it("Direction 4 -- this file is itself scanned, with no exemption", () => {
		// The obvious way to make Direction 1 green is to exempt the file that
		// holds the denylist. Assert the opposite: this test file is in the scanned
		// set, which is only possible because every needle is assembled at run time.
		expect(
			files.map((f) => f.path),
			"tests/unit/secret-scan.test.ts must be inside its own scan -- an exempted file is exactly " +
				"where a re-introduced identifier would hide",
		).toContain("tests/unit/secret-scan.test.ts");
	});
});
