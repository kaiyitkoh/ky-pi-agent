/**
 * DIAG-08 / SAFE-14 — the writer is open-write-close per record, and a stream
 * is a build failure, wherever in the tree it might be opened.
 *
 * ---------------------------------------------------------------------------
 * THE GATE `jsonl.ts` ALREADY CLAIMED TO HAVE
 * ---------------------------------------------------------------------------
 * `.pi/lib/jsonl.ts`'s module docstring states the rule and its enforcement:
 * the stream constructor "is deliberately NOT spelled anywhere in this file
 * ... A plain-substring grep over this file for that constructor is the
 * mechanical proof that no stream is opened here."
 *
 * That grep did not exist when this file was first written for the
 * diagnostics-only writer. This file is the check.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SCANNED SET WIDENED PAST DIAGNOSTICS
 * ---------------------------------------------------------------------------
 * The writer moved to `.pi/lib/jsonl.ts` (04-02) so the safety audit log
 * (SAFE-14) could reuse it without `safety/` importing from `diagnostics/`.
 * That means TWO more directories can now reach `appendFileSync`-equivalent
 * territory: `.pi/lib` itself, and `.pi/extensions/safety`, which binds to it
 * the same way `.pi/extensions/diagnostics` does. A gate that kept scanning
 * only the old directory would silently stop protecting the file that
 * actually writes, and would never see a second writer introduced next to it
 * in `safety/`.
 *
 * ---------------------------------------------------------------------------
 * WHY IT MATTERS MORE THAN A STYLE RULE
 * ---------------------------------------------------------------------------
 * RESEARCH §10.3 measured four concurrent Node processes appending ~950 B records
 * to one shared file: 6000 of 6000 lines, zero unparseable, and `renameSync`
 * succeeding with an append handle open in this process and in a child
 * [VERIFIED: executed 2026-08-13, win32, node v24.16.0]. That result depends
 * ENTIRELY on open-write-close per record. A held file descriptor keeps writing
 * into the file that was renamed away, so every record after a rotation would land
 * in the rotated file and be lost from the live one.
 *
 * `tests/integration/jsonl-concurrency.test.ts` cannot catch that: it uses raw
 * `appendFileSync` in its generated child and only borrows `logPath` for the
 * filename, so it proves an OPERATING-SYSTEM property (which its own header says)
 * and would stay green if `appendJsonl` were swapped for a buffered stream
 * tomorrow. `tests/unit/jsonl-rotation.test.ts` would not catch it either: it
 * writes from one process, where a stream's buffer is flushed by the same process
 * that reads it back.
 *
 * ---------------------------------------------------------------------------
 * THE VACUOUS-PASS GUARDS, ALL THREE
 * ---------------------------------------------------------------------------
 * The shape is `chokepoint-lint.test.ts`'s, for the same reasons and with the same
 * failure modes in mind:
 *
 *   1. the scanned set is asserted non-empty — a grep over no files is a green run
 *      that verified nothing;
 *   2. every pattern is run against an inline offending fixture and asserted to
 *      fire, because a dead pattern and a clean tree produce byte-identical output;
 *   3. `jsonl.ts` is asserted to still CONTAIN the append call, so gutting the
 *      writer entirely cannot turn this gate green by removing everything it
 *      objects to.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";

/**
 * The scanned tree: every directory that can reach the shared writer, or write
 * a log directly. Diagnostics binds to it, safety binds to it, and the writer
 * itself lives in `.pi/lib`.
 */
const SCANNED_DIRS = [".pi/extensions/diagnostics", ".pi/lib", ".pi/extensions/safety"] as const;

/** The one file that does the writing, and the one this rule is really about. */
const WRITER_FILE = ".pi/lib/jsonl.ts";

/**
 * The sanctioned call, spelled once, in the one file allowed to make it.
 *
 * Asserted PRESENT in the writer, so a change that removed the append along with
 * the stream cannot pass this gate by leaving nothing to object to.
 */
const SANCTIONED_WRITE = "appendFileSync";

/**
 * Every route to a held file descriptor, each with the reason it is banned.
 *
 * All three are matched against RAW SOURCE, comments included, exactly as
 * BOOT-10's boundary rule and DIAG-03's chokepoint gate are. That is what makes
 * the check survive an alias or a destructured import — and it is why `jsonl.ts`
 * still describes the constructor in words rather than naming it.
 */
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

/**
 * A synthetic source carrying one offending form per pattern.
 *
 * INLINE, and asserted below never to be read from disk. A fixture file under
 * `.pi/extensions/` would be enumerated by the scan itself and fail the gate it
 * exists to prove.
 */
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
		// A pattern set proven only against a clean tree is a set that could be
		// uniformly broken — a stray anchor, an escaping slip during a rename — and
		// never noticed, because a dead pattern and a clean repository produce
		// byte-identical output.
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
