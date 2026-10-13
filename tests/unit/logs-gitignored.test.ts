/**
 * Every path the diagnostics writer produces is git-ignored. A literal table checks the declared rules; a second half
 * runs the real writer, forces a rotation and asks git about every path it actually produced, since a table cannot
 * notice a name nobody predicted. `git add -f` bypasses ignore rules, which is why redaction happens at capture.
 */
import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
	appendJsonl,
	producedPaths,
	resetProducedPaths,
} from "../../.pi/extensions/diagnostics/jsonl.ts";
import { TURNS_LOG_BASE, WIRE_LOG_BASE } from "../../.pi/extensions/diagnostics/schema.ts";
import { writeAuditRow } from "../../.pi/extensions/safety/audit.ts";
import { writeEvidenceRow } from "../../.pi/extensions/workflows/evidence.ts";
import { isIgnored } from "../helpers/git.ts";
import { withTempLogCwd } from "../helpers/logs.ts";

/** Every log-path shape, each asserted against both the `.pi/logs/` and the blanket `*.jsonl` rule. */
const MUST_BE_IGNORED = [
	".pi/logs/wire-2026-08-13.jsonl",
	".pi/logs/wire-2026-08-13.1.jsonl",
	".pi/logs/turns-2026-08-13.jsonl",
	".pi/logs/turns-2026-08-13.10.jsonl",
	".pi/logs/",
	".pi/logs/sub/whatever.jsonl",
	// The audit stream shares the directory, but the table would not notice a stream nobody typed in.
	".pi/logs/audit-2026-08-14.jsonl",
	".pi/logs/audit-2026-08-14.1.jsonl",
	// GATE-07 (WR-06) — same reasoning, for the evidence stream Phase 6 added.
	".pi/logs/evidence-2026-08-14.jsonl",
	".pi/logs/evidence-2026-08-14.1.jsonl",
] as const;

describe("DIAG-07 — the declared log paths are not committable", () => {
	it("asserts a meaningful number of paths", () => {
		expect(
			MUST_BE_IGNORED.length,
			"the table below is the policy half of this test; shrinking it to one entry would leave " +
				"the rotated and nested shapes unasserted while the file still looked green",
		).toBeGreaterThanOrEqual(6);
	});

	it.each(MUST_BE_IGNORED)("ignores %s", (path) => {
		expect(
			isIgnored(path),
			`${path} MUST be ignored but git says it is committable. A diagnostic log holds the full ` +
				"prompt body of every turn, and this repository is public",
		).toBe(true);
	});

	it("says a normal source file is NOT ignored (the oracle is live)", () => {
		// Guards against an `isIgnored` that returns true for everything.
		expect(
			isIgnored("README.md"),
			"git reported README.md as ignored. That cannot be right, so the oracle itself is broken " +
				"and every `toBe(true)` above is meaningless rather than reassuring",
		).toBe(false);
	});
});

describe("DIAG-07 / SAFE-14 — the paths the writer ACTUALLY produced are ignored", () => {
	it("checks git against a real run rather than a remembered list", async () => {
		resetProducedPaths();

		const relativePaths = await withTempLogCwd(async (cwd) => {
			// A small cap forces a rotation, so the writer-made `.1.jsonl` name is checked too.
			const opts = { rotateBytes: 400, maxRotated: 3 };
			const filler = "f".repeat(200);

			for (let i = 0; i < 6; i++) {
				appendJsonl(cwd, WIRE_LOG_BASE, { i, filler }, opts);
				appendJsonl(cwd, TURNS_LOG_BASE, { i, filler }, opts);
				// The audit stream writes into the same globalThis-keyed producedPaths() set.
				writeAuditRow(cwd, {
					event: "bash_call",
					tool: "bash",
					command: `echo ${String(i)}`,
					cwd,
					verdict: i % 2 === 0 ? "allow" : "block",
					reason: filler,
				});
				// So does the evidence stream. Not a real SHA: no 40-hex literal in any test file, and only the path is asserted.
				writeEvidenceRow(cwd, {
					verdict: i % 2 === 0 ? "accept" : "reject",
					reason: filler,
					baseSha: "not-a-real-sha-base",
					headSha: "not-a-real-sha-head",
					recordCount: 1,
					tools: ["bash"],
				});
			}

			// Repo-relative, forward-slash: the temp cwd is not the repo, but the
			// SHAPE of the path under it is what the ignore rules classify.
			return producedPaths().map((p) => relative(cwd, p).split("\\").join("/"));
		});

		expect(
			relativePaths.length,
			"the writer reported producing no paths at all. Every assertion below iterates this list, " +
				"so an empty one turns the reality check into a pass that verified nothing — assert it " +
				"non-empty before looping, never after",
		).toBeGreaterThan(0);

		expect(
			relativePaths.some((p) => /\.\d+\.jsonl$/.test(p)),
			"no rotated `.<n>.jsonl` path was produced, so the run never crossed the size cap and this " +
				"test is only re-checking the live file names the table above already covers. Lower " +
				"`rotateBytes` or append more records",
		).toBe(true);

		for (const path of relativePaths) {
			expect(
				isIgnored(path),
				`the writer produced ${path} and git says it is committable. This is the assertion the ` +
					"literal table cannot make: the writer invented a name nobody predicted and no ignore " +
					"rule covers it",
			).toBe(true);
		}
	});
});
