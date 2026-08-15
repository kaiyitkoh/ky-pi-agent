/**
 * FLOW-03 — the `/grill` -> `SPEC.md` section parser and the §2 evidence
 * gate: the phase's single most important gate, built as CODE, not as
 * prompt wording.
 *
 * PURPOSE. `.planning/research/FEATURES.md` Part 2 (lines 158-179) names an
 * eight-section, ordered `SPEC.md` and states the evidence gate in prose:
 * "the workflow may not write §3 until §2 exists and every row carries
 * evidence." Exhortation is not a mechanism. If the harness would accept a
 * `SPEC.md` with an empty §2, the requirement is not met however good the
 * `/grill` system prompt is. {@link gateRequirementsAuthorship} is that
 * mechanism: a pure predicate over raw markdown text, with a binding branch
 * order, that a future `/grill` write path (plan 09-08) must consult before
 * it may write §3's content. This module builds the predicate only; wiring
 * it to `/grill`'s actual write path is plan 09-08's job, per this plan's
 * own frontmatter (`requirements: ["FLOW-03"]`, closed only when 09-08
 * lands).
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS PURE
 * ---------------------------------------------------------------------------
 * It makes no model call, reads no file, and registers nothing with Pi. It
 * takes and returns plain data: a frozen section table, a markdown parser,
 * a fact-table parser, and a gate predicate. The caller -- `/grill`'s own
 * command file, built in plan 09-08 -- owns reading `SPEC.md` off disk,
 * calling {@link parseSpecSections} and {@link gateRequirementsAuthorship}
 * over its text, and refusing to let the model write §3 on a reject verdict.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing. It does not spell the tool-registration
 * call, in code or in prose -- `tests/unit/contributing-boundary.test.ts`
 * matches that call's name as a plain substring across every tracked source
 * under `.pi/extensions/`, comments included, and grants this directory no
 * exemption. Nothing in this file calls a registration API of any kind.
 *
 * ---------------------------------------------------------------------------
 * CHOKEPOINT HYGIENE (DIAG-03 / QUAL-02's structural claim)
 * ---------------------------------------------------------------------------
 * This file never reaches a model. It does not spell, even in a comment, the
 * documented direct-completion method on the model registry, its
 * simple-options or streaming siblings, the method that hands back a raw
 * provider object, the other route to a raw provider object, a deep import
 * under the pi-ai package's adapter path, or the model runtime class name --
 * the same six-plus-one bypass routes `tests/unit/chokepoint-lint.test.ts`
 * enumerates for DIAG-03. Describing them here in the abstract, rather than
 * naming them, is deliberate: `chokepoint-lint.test.ts` matches raw source
 * text, comments included, and grants this module no exemption.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PREDICATE DOES NOT, AND CANNOT, PROVE
 * ---------------------------------------------------------------------------
 * {@link gateRequirementsAuthorship} checks that every claim in §2 carries a
 * citation SHAPED like evidence (a `file:line` reference or a labelled
 * command-output block) and that the citation cell is non-empty. It cannot,
 * and does not try to, check that the cited line actually says what the
 * claim says, or that the cited command was ever really run -- a fabricated
 * citation naming a real file at a real line, or a plausible-looking command
 * transcript nobody ran, is SHAPED correctly and passes here. That is what
 * `/grill`'s own read/grep pass (which produces the citations in the first
 * place) and `/review`'s reviewer (which receives the full contents of every
 * touched file, per `review-schema.ts`'s own analogous disclosure) are for.
 * `09-CONTEXT.md` decision 6 records that Phase 6's evidence gate accepted a
 * FABRICATED completion claim through three consecutive rounds of green
 * tests -- overclaiming what a shape check proves here would repeat exactly
 * that failure. See {@link EVIDENCE_PATTERN}'s own doc comment for the
 * precise shapes accepted and rejected.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 *   SPEC_SECTIONS -- the frozen, ordered eight-section table.
 *   HEADING_PATTERN, parseSpecSections -- the markdown section splitter.
 *   EVIDENCE_PATTERN, VerifiedFact, parseVerifiedFacts -- the §2 table parser.
 *   gateRequirementsAuthorship -- the numbered, binding-order §2 evidence gate.
 */

// ---------------------------------------------------------------------------
// SPEC_SECTIONS -- the frozen, ordered section table
// ---------------------------------------------------------------------------

/** The eight `SPEC.md` section identifiers, in `FEATURES.md` Part 2's order. */
export type SpecSectionId =
	| "goal"
	| "verifiedFacts"
	| "requirements"
	| "errorBehaviour"
	| "scopePin"
	| "clarifications"
	| "assumptions"
	| "scorecard";

/** One row of {@link SPEC_SECTIONS}. */
export interface SpecSectionDescriptor {
	readonly id: SpecSectionId;
	readonly ordinal: number;
	readonly heading: string;
	/**
	 * The downstream reader of this section, named per `FEATURES.md` Part 2's
	 * own design rule: "every artifact section must have a named consumer" --
	 * a section with no named consumer does not ship, so the consumer is a
	 * field on the data, not prose a reader might skip.
	 */
	readonly consumer: string;
}

/**
 * The eight `SPEC.md` sections, `FEATURES.md` Part 2 lines 162-171, in
 * their prescribed order. Frozen, and each entry frozen individually, so a
 * caller cannot mutate the ordinal or heading text of a shared constant out
 * from under every other consumer of this module.
 */
export const SPEC_SECTIONS: readonly SpecSectionDescriptor[] = Object.freeze([
	Object.freeze({
		id: "goal",
		ordinal: 1,
		heading: "Goal",
		consumer: "every downstream reader (plan, execute, review) as the single falsifiable anchor sentence",
	}),
	Object.freeze({
		id: "verifiedFacts",
		ordinal: 2,
		heading: "Verified Codebase Facts",
		consumer: "this module's own gateRequirementsAuthorship, which refuses §3 authorship until this section is populated with evidence",
	}),
	Object.freeze({
		id: "requirements",
		ordinal: 3,
		heading: "Requirements",
		consumer: "/plan (each Rn becomes plan tasks) and /review (requirement verdicts are read against this section)",
	}),
	Object.freeze({
		id: "errorBehaviour",
		ordinal: 4,
		heading: "Error and Edge Behaviour",
		consumer: "/plan (each entry becomes an acceptance case) and /review (requirement verdicts read against this section too)",
	}),
	Object.freeze({
		id: "scopePin",
		ordinal: 5,
		heading: "Scope Pin",
		consumer: "/review's drift detector, which compares the expected-files list here against the files a PLAN.md actually touched",
	}),
	Object.freeze({
		id: "clarifications",
		ordinal: 6,
		heading: "Clarifications Log",
		consumer: "a future human or agent re-reading this SPEC, so the interrogation that produced it stays auditable",
	}),
	Object.freeze({
		id: "assumptions",
		ordinal: 7,
		heading: "Assumptions",
		consumer: "/review, which must not treat an assumption stamped here as a verified fact from §2",
	}),
	Object.freeze({
		id: "scorecard",
		ordinal: 8,
		heading: "Ambiguity Scorecard",
		consumer: "the ambiguity gate itself -- a mechanical, re-readable record of why /grill judged itself done",
	}),
]);

// ---------------------------------------------------------------------------
// parseSpecSections -- the markdown section splitter
// ---------------------------------------------------------------------------

/**
 * Matches a markdown ATX heading of the exact form `## <n>. <Heading Text>`
 * or `## <Heading Text>` (the leading `<n>.` is optional, since a SPEC in
 * progress may not yet carry the numeral), capturing the heading text after
 * any leading numeral. Anchored to the start of a line (`m` flag) so a `##`
 * appearing mid-sentence in body text is never mistaken for a heading.
 *
 * Named and exported, per this repository's own house rule
 * (`review-schema.ts`'s `FILE_LINE_PATTERN`, `work-artifacts.ts`'s
 * `SLUG_PATTERN`): a regex used to make a structural decision is a named
 * constant, never inlined at its call site.
 */
export const HEADING_PATTERN = /^##\s+(?:\d+\.\s+)?(.+?)\s*$/gm;

/**
 * The result of {@link parseSpecSections}: which heading text was found, in
 * document order, alongside the raw body text that followed it (up to the
 * next heading or end of document).
 */
export interface ParsedHeading {
	readonly headingText: string;
	readonly body: string;
}

/**
 * Split raw `SPEC.md` markdown into headings and their body text.
 *
 * Returns EVERY heading found, including one that does not match any
 * {@link SPEC_SECTIONS} heading text and including a heading that appears
 * more than once -- an unknown or duplicated heading is MALFORMED input, not
 * something to silently ignore, so the caller ({@link gateRequirementsAuthorship}
 * and any future stricter validator) can see and reject it. Dropping an
 * unrecognised or repeated heading here would make it invisible to every
 * consumer downstream, which is exactly how a malformed SPEC slips through.
 */
export function parseSpecSections(markdown: string): readonly ParsedHeading[] {
	const matches = Array.from(markdown.matchAll(HEADING_PATTERN));
	const headings: ParsedHeading[] = [];

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const headingText = match?.[1]?.trim() ?? "";
		const startOfBody = (match?.index ?? 0) + (match?.[0]?.length ?? 0);
		const endOfBody = i + 1 < matches.length ? (matches[i + 1]?.index ?? markdown.length) : markdown.length;
		const body = markdown.slice(startOfBody, endOfBody);
		headings.push({ headingText, body });
	}

	return headings;
}

/**
 * Look up a {@link ParsedHeading} by its {@link SpecSectionDescriptor}
 * heading text (case-insensitive, trimmed), returning `undefined` when the
 * heading is absent from the parsed document. A caller checking for
 * duplication must inspect the full `parseSpecSections()` output directly --
 * this helper deliberately returns only the FIRST match, since "is it
 * present at all" and "is it present exactly once" are different questions
 * and {@link gateRequirementsAuthorship} needs both, separately.
 */
export function findSection(headings: readonly ParsedHeading[], section: SpecSectionDescriptor): ParsedHeading | undefined {
	return headings.find((h) => h.headingText.toLowerCase() === section.heading.toLowerCase());
}

// ---------------------------------------------------------------------------
// EVIDENCE_PATTERN, VerifiedFact, parseVerifiedFacts -- the §2 table parser
// ---------------------------------------------------------------------------

/**
 * The two accepted evidence-citation shapes, anchored at both ends so a
 * `.test()` call reports a FULL match, never a substring hit (matching
 * `review-schema.ts`'s `FILE_LINE_PATTERN` discipline, `:220-221`):
 *
 *   (1) `file:line` -- a bounded path followed by `:` and one or more
 *       digits, e.g. `.pi/lib/jsonl.ts:606`. The path segment is restricted
 *       to characters that legitimately appear in a repo-relative path
 *       (word characters, `.`, `/`, `-`) and is bounded (1-300 characters)
 *       so a pathological input cannot drive catastrophic backtracking
 *       [threat T-09-05-03] -- there is no nested quantifier over an
 *       unbounded group anywhere in this pattern.
 *   (2) `command output: <text>` -- a labelled command-output citation, the
 *       form `FEATURES.md`'s own §2 row prescribes as the second accepted
 *       evidence shape ("evidence (file:line or command output)"). The
 *       label is matched case-insensitively and requires at least one
 *       non-whitespace character after the colon, bounded to 500 characters
 *       for the same backtracking reason.
 *
 * DELIBERATELY NOT ACCEPTED, stated here so the rule is visible beside the
 * pattern rather than only in a test: a bare assertion with no citation
 * shape at all (e.g. "it works"), a URL alone with no `file:line` or command
 * label, and the bare word "verified" with nothing else -- none of these
 * name a place to look, which is the entire point of requiring evidence.
 */
export const EVIDENCE_PATTERN = /^(?:[\w./-]{1,300}:\d+|command output:\s*\S.{0,500})$/i;

/** One row of the §2 Verified Codebase Facts table. */
export interface VerifiedFact {
	readonly claim: string;
	readonly evidence: string;
	readonly howVerified: string;
}

/**
 * A markdown pipe-table data row: `| cell | cell | cell |`, tolerating an
 * optional trailing `|`-less form and surrounding whitespace. Anchored to
 * the start of a line (`m` flag). Does not match a header row or a
 * separator row (`| --- | --- | --- |`) -- callers filter those with
 * {@link isSeparatorRow}.
 */
const TABLE_ROW_PATTERN = /^\|(.+)\|\s*$/gm;

/** A markdown table separator row, e.g. `| --- | --- | --- |` or `|---|---|---|`. */
function isSeparatorRow(cells: readonly string[]): boolean {
	return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

/**
 * Parse the §2 body text's markdown pipe table into {@link VerifiedFact}
 * rows: `claim | evidence | how verified`.
 *
 * A row with a missing cell (fewer than three pipe-delimited cells) is
 * returned WITH the missing cell(s) as an empty string, never dropped --
 * dropping a malformed row here is exactly how an evidence-free claim
 * becomes invisible to {@link gateRequirementsAuthorship}'s row-index-based
 * reject reasons. The header row and the `---` separator row are excluded
 * (matched by heading text and by {@link isSeparatorRow} respectively), so
 * only genuine data rows reach the caller.
 */
export function parseVerifiedFacts(sectionBody: string): readonly VerifiedFact[] {
	const rowMatches = Array.from(sectionBody.matchAll(TABLE_ROW_PATTERN));
	const facts: VerifiedFact[] = [];

	for (const match of rowMatches) {
		const rawCells = (match[1] ?? "").split("|").map((c) => c.trim());
		if (isSeparatorRow(rawCells)) {
			continue;
		}
		const [first, ...rest] = rawCells;
		if (first === undefined) {
			continue;
		}
		// The header row's first cell is literally "claim" (case-insensitive) --
		// exclude it by content, since it carries no data to report on.
		if (first.toLowerCase() === "claim") {
			continue;
		}
		const claim = first;
		const evidence = rest[0] ?? "";
		const howVerified = rest[1] ?? "";
		facts.push({ claim, evidence, howVerified });
	}

	return facts;
}

// ---------------------------------------------------------------------------
// gateRequirementsAuthorship -- the §2 evidence gate
// ---------------------------------------------------------------------------

/**
 * Mirrors `review-schema.ts`'s `ReviewValidation` and `workflows/evidence.ts`'s
 * `EvidenceVerdict`: deliberately TWO arms, never three. A caller receiving
 * `{ok: false, ...}` must surface `reason` and refuse to let the model write
 * §3; there is no partial-accept.
 */
export type SpecGateVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Resolves a required entry out of {@link SPEC_SECTIONS} at module load time,
 * with a definite (never-`undefined`) return type -- so every later reference
 * to {@link REQUIREMENTS_SECTION}/{@link VERIFIED_FACTS_SECTION} needs no
 * repeated narrowing, inside this module's own functions or across a closure
 * boundary TypeScript's control-flow analysis does not carry a module-scoped
 * `const`'s narrowing across. NEVER THROWS in practice -- `SPEC_SECTIONS` is
 * a fixed, frozen literal declared directly above with both ids present; this
 * guards against a future edit silently dropping one of them, which would
 * otherwise make every call below throw on a confusing `undefined.heading`
 * instead of failing loudly at the point of the actual mistake.
 */
function requiredSection(id: SpecSectionId): SpecSectionDescriptor {
	const section = SPEC_SECTIONS.find((s) => s.id === id);
	if (section === undefined) {
		throw new Error(`spec-schema.ts: SPEC_SECTIONS is missing its '${id}' entry`);
	}
	return section;
}

const REQUIREMENTS_SECTION = requiredSection("requirements");
const VERIFIED_FACTS_SECTION = requiredSection("verifiedFacts");

/**
 * The whole FLOW-03 predicate: `/grill` may not write §3 (Requirements)
 * content until §2 (Verified Codebase Facts) exists and every row carries
 * evidence. First-match-wins, in `gateCompletion`'s
 * (`workflows/evidence.ts:101-231`) exact numbered, BINDING-ORDER docstring
 * style. Every reject `reason` is built FROM THE RECEIVED DATA -- never from
 * a caller-supplied string -- so a rejection always names the offending row,
 * claim or value, per this plan's own `must_haves.truths`.
 *
 *   (1) §2 heading absent from the parsed document -> reject, naming that
 *       the Verified Codebase Facts section itself was never written. Sits
 *       FIRST so "you never wrote §2 at all" is its own distinguishable
 *       reason, not folded into "you wrote an empty one".
 *   (2) §2 present but its table has zero data rows -> reject. Sits
 *       immediately after (1) for exactly the reason (1)'s own comment
 *       states: an absent section and a present-but-empty one are different
 *       facts about what the author did, and a reader debugging a rejection
 *       needs to know which one happened.
 *   (3) ANY row with an empty `claim` -> reject, naming the row's 1-based
 *       index. Sits before (4): a claimless row's evidence cell is
 *       meaningless to inspect until the claim itself is known to exist.
 *   (4) ANY row whose `evidence` cell fails {@link EVIDENCE_PATTERN} ->
 *       reject, naming the row's 1-based index, the claim text and the
 *       evidence string that arrived. Sits after (3) because checking
 *       evidence shape on a row that has no claim at all would report the
 *       wrong defect first.
 *   (5) ANY row with an empty `howVerified` -> reject, naming the row's
 *       1-based index and the claim text.
 *   (6) §3 (Requirements) heading present in the document WHILE any of
 *       (1)-(5) would have fired against §2 -> THE ACTUAL GATE: reject,
 *       stating plainly that requirements may not be authored on unverified
 *       facts, and restating the underlying §2 defect this branch is really
 *       about (never merely "§3 came too early"). Sits LAST, after every §2
 *       shape check, so a caller reading the reason learns the real defect
 *       driving the refusal, not only the ordering violation on top of it.
 *   (7) otherwise -> accept. A SPEC with a fully populated, evidenced §2 and
 *       NO §3 yet also reaches here and ACCEPTS -- this predicate governs
 *       the AUTHORSHIP of §3's content, not §3's mere presence or absence
 *       (branch (6) only fires when §3 already exists alongside a broken
 *       §2), matching this plan's own acceptance criterion.
 *
 * WHAT THIS PREDICATE DOES NOT, AND CANNOT, PROVE: see this module's own
 * header docstring section of the same name. In short -- it checks that a
 * citation is SHAPED like evidence and is present; it cannot check that the
 * cited line says what the claim says. That is what `/grill`'s read/grep
 * pass and `/review` are for.
 */
export function gateRequirementsAuthorship(markdown: string): SpecGateVerdict {
	const headings = parseSpecSections(markdown);
	const factsSection = findSection(headings, VERIFIED_FACTS_SECTION);
	const requirementsSection = findSection(headings, REQUIREMENTS_SECTION);
	const requirementsPresent = requirementsSection !== undefined;

	// (1) §2 heading absent entirely.
	if (factsSection === undefined) {
		return {
			ok: false,
			reason: withRequirementsGuard(
				`the "${VERIFIED_FACTS_SECTION.heading}" section (§2) is absent from this SPEC -- requirements ` +
					"may not be authored before verified codebase facts exist",
				requirementsPresent,
			),
		};
	}

	const facts = parseVerifiedFacts(factsSection.body);

	// (2) §2 present, zero data rows.
	if (facts.length === 0) {
		return {
			ok: false,
			reason: withRequirementsGuard(
				`the "${VERIFIED_FACTS_SECTION.heading}" section (§2) exists but its table has zero data rows -- ` +
					"an empty facts table is a facts table that was never actually filled in",
				requirementsPresent,
			),
		};
	}

	// (3) any empty claim -- checked BEFORE (4)'s evidence-shape check, so a
	// claimless row is reported for the defect that actually makes it
	// meaningless to inspect, not for an evidence cell nobody can attribute
	// to anything yet.
	for (let i = 0; i < facts.length; i++) {
		const fact = facts[i];
		if (fact === undefined || fact.claim.length === 0) {
			return {
				ok: false,
				reason: withRequirementsGuard(
					`row ${i + 1} of the "${VERIFIED_FACTS_SECTION.heading}" section (§2) has an empty claim cell`,
					requirementsPresent,
				),
			};
		}
	}

	// (4) any evidence cell that fails EVIDENCE_PATTERN -- checked AFTER (3),
	// so every row reaching here is known to carry a non-empty claim.
	for (let i = 0; i < facts.length; i++) {
		const fact = facts[i];
		if (fact === undefined) {
			continue;
		}
		if (!EVIDENCE_PATTERN.test(fact.evidence)) {
			return {
				ok: false,
				reason: withRequirementsGuard(
					`row ${i + 1} of the "${VERIFIED_FACTS_SECTION.heading}" section (§2), claim "${fact.claim}", has a ` +
						`malformed evidence cell -- expected a "file:line" citation or a "command output: ..." citation, ` +
						`received ${JSON.stringify(fact.evidence)}`,
					requirementsPresent,
				),
			};
		}
	}

	// (5) any empty howVerified.
	for (let i = 0; i < facts.length; i++) {
		const fact = facts[i];
		if (fact === undefined || fact.howVerified.length === 0) {
			return {
				ok: false,
				reason: withRequirementsGuard(
					`row ${i + 1} of the "${VERIFIED_FACTS_SECTION.heading}" section (§2), claim "${fact?.claim ?? ""}", has an empty "how verified" cell`,
					requirementsPresent,
				),
			};
		}
	}

	// (6) the ACTUAL gate, folded into every branch above via
	// withRequirementsGuard() rather than re-checked as a separate physical
	// branch here: by construction, reaching this point means every (1)-(5)
	// check already passed against §2, so there is no remaining §2 defect for
	// a "§3 present while §2 is broken" branch to fire against -- had one
	// existed, one of (1)-(5) above would already have returned with the §3
	// -aware reason text withRequirementsGuard() builds. This is what "sits
	// LAST" means operationally: (6)'s distinguishing wording is attached to
	// every earlier reject the instant §3 is already present, rather than
	// re-detected independently after the fact.
	//
	// (7) otherwise -> accept. Reached whether or not §3 already exists --
	// this predicate governs AUTHORSHIP of §3's content, not its mere
	// presence.
	return { ok: true };
}

/**
 * Attaches branch (6)'s "§3 already present" framing to a §2 defect
 * description when `requirementsPresent` is true, so the reason names the
 * underlying defect rather than only the ordering violation on top of it.
 * When §3 is absent, the defect description alone is the caller's clearest
 * signal -- there is no ordering violation to additionally name.
 */
function withRequirementsGuard(section2Defect: string, requirementsPresent: boolean): string {
	if (requirementsPresent) {
		return (
			`the "${REQUIREMENTS_SECTION.heading}" section (§3) is present, but requirements may not be ` +
			`authored on unverified facts: ${section2Defect}`
		);
	}
	return section2Defect;
}
