/**
 * The JSONL writer is open-write-close per record, and no stream is opened anywhere it could reach (.pi/lib,
 * diagnostics, safety). A held descriptor keeps writing into a file that was renamed away, losing every record after
 * a rotation, and neither the concurrency nor the rotation test can see that. Vacuity guards: the scanned set is
 * non-empty, every pattern fires on a fixture, and jsonl.ts still contains the append call.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

/** Every directory that can reach the shared writer or write a log directly. */
const SCANNED_DIRS = [".pi/extensions/diagnostics", ".pi/lib", ".pi/extensions/safety"] as const;

/** The one file that does the writing, and the one this rule is really about. */
const WRITER_FILE = ".pi/lib/jsonl.ts";

/** The sanctioned call, asserted present so removing the writer cannot pass by leaving nothing to object to. */
const SANCTIONED_WRITE = "appendFileSync";

/** Every route to a held file descriptor, matched against raw source (comments included) so aliases cannot hide it. */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
	{
		pattern: /createWriteStream/,
		why: "a held fd keeps writing into the file that was renamed away, so every record after a rotation is lost from the live file",
	},
	{
		pattern: /WriteStream/,
		why: "the same hazard reached through the class rather than the factory",
	},
	{
		pattern: /\bopenSync\b/,
		why: "a raw descriptor is the same hazard with no helper in front of it",
	},
	{
		pattern: /\bappendFile\s*\(/,
		why: "the CALLBACK form is asynchronous, so two appends from one process can interleave inside a line -- the torn record DIAG-08 exists to rule out",
	},
];

/** One offending form per pattern, inline: a fixture file under .pi/extensions/ would fail the gate it proves. */
const OFFENDING_FIXTURE = [
	'import { createWriteStream, openSync, appendFile } from "node:fs";',
	'const s = createWriteStream(file, { flags: "a" });',
	"const t: WriteStream = s;",
	'const fd = openSync(file, "a");',
	"appendFile (file, text, () => {});",
	"",
].join("\n");

/** Tracked `.ts` sources under every {@link SCANNED_DIRS} entry, from the index's view. */
function allSources(): { path: string; text: string }[] {
	return SCANNED_DIRS.flatMap((dir) => trackedFiles(dir))
		.filter((p) => p.endsWith(".ts"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
}

describe("DIAG-08 / SAFE-14 — no writer module opens a stream or a raw descriptor", () => {
	const sources = allSources();

	it("finds tracked sources to scan (guards against a vacuous pass)", () => {
		expect(
			sources.length,
			`no tracked .ts under ${SCANNED_DIRS.join(", ")} — every assertion below scans this set, so ` +
				"an empty one turns the whole gate into a pass that verified nothing. Phase 1 tripped this " +
				"exact class twice",
		).toBeGreaterThanOrEqual(1);

		expect(
			sources.map((s) => s.path),
			`${WRITER_FILE} must be in the scanned set. It is the file the rule is about, and a rename ` +
				"that moved it out would leave the gate passing over its siblings while the writer went " +
				"unchecked",
		).toContain(WRITER_FILE);
	});

	it("opens no stream and no raw descriptor anywhere in the subsystem", () => {
		const offenders: string[] = [];
		for (const source of sources) {
			for (const { pattern, why } of FORBIDDEN) {
				if (pattern.test(source.text)) {
					offenders.push(`${source.path}: matched ${String(pattern)} — ${why}`);
				}
			}
		}

		expect(
			offenders,
			"RESEARCH §10.3's concurrency result — 6000 of 6000 lines intact across four processes, " +
				"with `renameSync` succeeding while append handles were open — depends ENTIRELY on " +
				"open-write-close per record. Neither jsonl-concurrency.test.ts (raw appendFileSync in " +
				"its child) nor jsonl-rotation.test.ts (one process, same process flushes and reads) can " +
				"detect a buffered writer, which is why the rule is enforced as text. If the match is in " +
				"a COMMENT, reword it: these patterns are matched against raw source on purpose, and " +
				"describing the hazard in prose is the documented alternative that jsonl.ts's own " +
				"docstring already uses",
		).toEqual([]);
	});

	it("proves every forbidden pattern is live against an inline offending fixture", () => {
		// A dead pattern and a clean tree produce identical output, so each pattern must fire on something.
		const dead = FORBIDDEN.filter(({ pattern }) => !pattern.test(OFFENDING_FIXTURE)).map(
			({ pattern, why }) => `${String(pattern)} — ${why}`,
		);

		expect(
			dead,
			"these patterns matched NOTHING in the synthetic offending source, so they are dead and the " +
				"assertion above is passing for them no matter what the tree contains",
		).toEqual([]);

		expect(
			OFFENDING_FIXTURE.split("\n").length,
			"the fixture must carry one offending line per pattern plus the import; a shrunken fixture " +
				"is how a pattern quietly stops being exercised while the liveness case still passes on " +
				"the ones that remain",
		).toBeGreaterThanOrEqual(FORBIDDEN.length + 1);

		expect(
			OFFENDING_FIXTURE.includes(SANCTIONED_WRITE),
			"the fixture must NOT contain the sanctioned call: it exists to be rejected, and a fixture " +
				"that also carries the legitimate form would let the writer assertion below be satisfied " +
				"by the wrong file",
		).toBe(false);
	});

	it("still finds the sanctioned append in the writer, so a gutted writer cannot pass", () => {
		// Without this, deleting the whole body of `appendJsonl` would satisfy every
		// assertion above perfectly — there would be nothing left to object to.
		const writer = sources.find((s) => s.path === WRITER_FILE);

		expect(
			writer?.text.includes(SANCTIONED_WRITE),
			`${WRITER_FILE} no longer contains ${SANCTIONED_WRITE}. Either the writer stopped writing, ` +
				"or the append was renamed — in which case the patterns above are watching for a " +
				"spelling that no longer exists and the whole rule is unenforced",
		).toBe(true);
	});
});
