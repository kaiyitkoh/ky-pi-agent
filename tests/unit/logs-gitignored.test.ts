/**
 * DIAG-07 (second half) — every path the diagnostics writer produces is ignored.
 *
 * The oracle is `git check-ignore -q --no-index` (see ../helpers/git.ts for why
 * both flags are load-bearing; the missing `--no-index` was one of Phase 1's
 * two vacuous passes). It evaluates rules against a STRING, so the literal
 * table below needs no files on disk.
 *
 * TWO HALVES, AND THE SECOND IS THE POINT. A hand-written table proves the
 * declared rules classify the names someone remembered to type. It cannot
 * notice the writer inventing a name nobody predicted — a rotated suffix, a
 * different date format, a stream added in a later plan. So the second half
 * runs the real writer against a real temp filesystem, forces a rotation, and
 * asks git about every path `producedPaths()` reports. The list is asserted
 * non-empty first: an empty set would turn the loop into a pass that verified
 * nothing, which is the failure shape this phase keeps tripping over.
 *
 * SCOPE CAVEAT, RESTATED RATHER THAN OVERCLAIMED. `git add -f` bypasses ignore
 * rules entirely. A green run here means the declared rules classify every
 * produced path correctly, not that a prompt body can never reach a public
 * remote. That is precisely why redaction happens at capture
 * (`.pi/extensions/diagnostics/redact.ts`, plan 02-02) and this test comes
 * second: the ignore rules are the outer control, and the redactor is the one
 * that still holds when someone forces a file into the index.
 * [threat T-02-03-01]
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

/**
 * Every log-path shape this design introduces.
 *
 * `.gitignore:79` covers `.pi/logs/` and `.gitignore:30` is a blanket
 * `*.jsonl`, so each of these is ignored twice over. Both rules are asserted
 * rather than assumed: a future tidy-up that removes one must not be able to
 * pass by leaning on the other silently.
 */
const MUST_BE_IGNORED = [
	".pi/logs/wire-2026-08-13.jsonl",
	".pi/logs/wire-2026-08-13.1.jsonl",
	".pi/logs/turns-2026-08-13.jsonl",
	".pi/logs/turns-2026-08-13.10.jsonl",
	".pi/logs/",
	".pi/logs/sub/whatever.jsonl",
	// SAFE-14 — the audit stream shares the same directory and the same
	// blanket `*.jsonl` rule, but it is a new stream added in Phase 4 and the
	// declared-rules table does not notice a stream nobody typed in.
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
		// Without this, an `isIgnored` that returned true for everything -- a
		// broken git invocation, a wrong cwd, an exit code misread -- would make
		// every assertion in this file vacuously green.
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
			// Small cap so a rotation is forced in a handful of appends: the
			// rotated `.1.jsonl` name is produced by the writer, never typed by a
			// human, and is exactly the kind of path a literal table forgets.
			const opts = { rotateBytes: 400, maxRotated: 3 };
			const filler = "f".repeat(200);

			for (let i = 0; i < 6; i++) {
				appendJsonl(cwd, WIRE_LOG_BASE, { i, filler }, opts);
				appendJsonl(cwd, TURNS_LOG_BASE, { i, filler }, opts);
				// The audit stream shares `producedPaths()` -- it is the same
				// globalThis-keyed set every binding over `.pi/lib/jsonl.ts` writes
				// into -- so a real audit row belongs in the same reality check.
				writeAuditRow(cwd, {
					event: "bash_call",
					tool: "bash",
					command: `echo ${String(i)}`,
					cwd,
					verdict: i % 2 === 0 ? "allow" : "block",
					reason: filler,
				});
				// GATE-07 (WR-06) — the evidence stream shares the same producedPaths()
				// set (same globalThis-keyed writer), same reasoning as the audit row
				// above. Not a real SHA on purpose (repo policy: no 40-hex fixture
				// literal in any test file) -- writeEvidenceRow's own fields are plain
				// strings and this test asserts on the PATH written, never on the row's
				// own SHA content.
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
