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
 *   IF_THEN_PATTERN, MIN_ERROR_BEHAVIOURS, parseErrorBehaviours -- the §4
 *   EARS-lite (FLOW-04) parser.
 *   ScopePin, EXPECTED_FILE_PATTERN, parseScopePin -- the §5 scope-pin
 *   (FLOW-05 declaration half) parser.
 *   FIX_FRAMING_MARKERS, isFixFramed, RootCause, parseRootCause -- QUAL-03's
 *   conditional Root Cause gate inputs.
 *   validateSpec -- the whole-document, numbered, binding-order gate
 *   (delegates §2 to gateRequirementsAuthorship).
 *   renderSpecMarkdown -- the on-disk SPEC.md rendering.
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

// ---------------------------------------------------------------------------
// IF_THEN_PATTERN, MIN_ERROR_BEHAVIOURS, parseErrorBehaviours -- the §4 parser
// ---------------------------------------------------------------------------

/**
 * The EARS-lite forcing function `FEATURES.md` Part 2 line 167 prescribes
 * for §4: `IF <condition> THEN THE SYSTEM SHALL <response>`. This project
 * adopts ONLY this one EARS pattern -- not the full EARS grammar (no
 * ubiquitous/event-driven/state-driven/optional-feature/unwanted-behaviour
 * variants). See `09-06-PLAN.md`'s own `<plan_specific_warnings>`.
 *
 * CASE DISCIPLINE IS DELIBERATE. The three keywords -- `IF`, `THEN THE
 * SYSTEM SHALL` -- must appear in EXACT upper case, matched with NO `i`
 * flag. The entire point of an EARS-lite forcing function is that it cannot
 * be satisfied by ordinary prose; a case-insensitive match would let
 * "if x then the system shall y" -- indistinguishable from a sentence a
 * model wrote without ever consulting the required form -- through
 * unnoticed. DELIBERATELY REJECTED, stated here so the rule is visible
 * beside the pattern: a lower-case variant (`if x then the system shall y`),
 * a missing THEN clause, `THE SYSTEM SHOULD` (a different, weaker modal),
 * and a bare sentence with none of the structure at all.
 *
 * BOUNDED FOR BACKTRACKING SAFETY [threat T-09-06-04]. Both the condition
 * and response captures are `\S.{0,2000}?` -- a bounded, LAZY quantifier,
 * not `.+` or `.*` -- so a pathological single §4 entry (a 10 KB line with
 * no `THEN THE SYSTEM SHALL` anywhere in it) fails within a bounded number
 * of steps rather than driving unbounded backtracking. There is no nested
 * quantifier over an unbounded group anywhere in this pattern. Anchored at
 * both ends (`^`/`$`, no `m` flag) so a caller applying this per-entry
 * (never against a whole multi-line section body) gets a FULL-match
 * verdict, matching `review-schema.ts`'s `FILE_LINE_PATTERN` discipline.
 */
export const IF_THEN_PATTERN = /^IF\s+(\S.{0,2000}?)\s+THEN THE SYSTEM SHALL\s+(\S.{0,2000}?)$/;

/**
 * The minimum §4 entry count `FEATURES.md` Part 2 line 167 states
 * ("Mandatory, minimum 3 entries"). Named, not inlined, per this
 * repository's own `magic-number` rule (`.pi/extensions/quality/rules.ts`)
 * -- a bare `3` at every comparison site would be exactly the anti-pattern
 * this project's own gate exists to catch.
 */
export const MIN_ERROR_BEHAVIOURS = 3;

/**
 * Matches a markdown bullet list item ("-" or "*" marker), capturing the
 * text after the marker. Anchored to the start of a line (`m` flag).
 * Shared by {@link parseErrorBehaviours} (§4's single-level list) and
 * {@link parseScopePin} (§5's three sublists) -- all four lists share the
 * identical bullet shape.
 */
const LIST_ITEM_PATTERN = /^[-*]\s+(\S.*)$/gm;

/**
 * Parse §4's body text into one entry per bullet list item.
 *
 * A malformed entry (ordinary prose, wrong case, wrong modal, an empty
 * response) is returned AS-IS, never dropped -- dropping it here is exactly
 * how a non-conforming §4 entry becomes invisible to {@link validateSpec}'s
 * own shape check, the same discipline `parseVerifiedFacts` documents for a
 * malformed §2 row.
 */
export function parseErrorBehaviours(sectionBody: string): readonly string[] {
	return Array.from(sectionBody.matchAll(LIST_ITEM_PATTERN)).map((m) => (m[1] ?? "").trim());
}

// ---------------------------------------------------------------------------
// ScopePin, EXPECTED_FILE_PATTERN, parseScopePin -- the §5 parser
// ---------------------------------------------------------------------------

/** One §5 out-of-scope entry: the excluded item and its mandatory one-line reason. */
export interface ScopeExclusion {
	readonly item: string;
	readonly reason: string;
}

/**
 * The parsed §5 Scope Pin: two explicit lists (in scope / out of scope,
 * `FEATURES.md` Part 2 line 168) plus the expected-files list that "is the
 * input to the drift detector in `/review`" (same line). `outOfScope` and
 * `expectedFiles` are the two lists FLOW-05 requires non-empty;
 * {@link validateSpec} enforces that, not this parser -- this function
 * returns exactly what was written, empty lists included.
 */
export interface ScopePin {
	readonly inScope: readonly string[];
	readonly outOfScope: readonly ScopeExclusion[];
	readonly expectedFiles: readonly string[];
}

/**
 * The separator between an out-of-scope item and its mandatory one-line
 * reason, e.g. `- rewriting the format entirely — out of scope for a
 * concurrency fix`. An entry with no separator parses to an EMPTY reason
 * (never dropped, never defaulted to a placeholder string) -- it is
 * {@link validateSpec}'s own branch (6), not this parser, that rejects it.
 */
const OUT_OF_SCOPE_SEPARATOR = " — ";

/**
 * Matches a bold-labelled subsection header within §5's body -- `**In
 * scope:**`, `**Out of scope:**`, `**Expected files:**` -- anchored to the
 * start of a line (`m` flag), case-insensitive (`i` flag) so an author's
 * own capitalisation choice cannot silently defeat the parser. Captures the
 * label text without the surrounding `**`/`:**` markers.
 */
const SCOPE_SUBSECTION_PATTERN = /^\*\*(.+?):\*\*\s*$/gim;

/**
 * Slices `body` down to the text following the FIRST subsection header
 * whose label matches `label` (case-insensitively), up to the next
 * subsection header or the end of `body`. Returns an empty string when the
 * label is absent -- the same "absent means empty, never invisible" rule
 * {@link parseVerifiedFacts} follows for a missing table cell.
 */
function extractScopeSubsection(body: string, label: string): string {
	const matches = Array.from(body.matchAll(SCOPE_SUBSECTION_PATTERN));
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		if ((match?.[1] ?? "").trim().toLowerCase() !== label.toLowerCase()) {
			continue;
		}
		const start = (match?.index ?? 0) + (match?.[0]?.length ?? 0);
		const end = i + 1 < matches.length ? (matches[i + 1]?.index ?? body.length) : body.length;
		return body.slice(start, end);
	}
	return "";
}

/**
 * A repo-relative path: word characters, `.`, `/` and `-` ONLY -- the
 * character class itself excludes every glob metacharacter (`*`, `?`, `[`,
 * `]`, `{`, `}`, `!`), so a glob simply fails to match rather than needing a
 * separate lookahead to name each excluded symbol. Additionally rejects a
 * leading `/` (an absolute path) and a `..` path segment, whether leading
 * or embedded (`../x`, `x/../y`, or a bare `..`), via two negative
 * lookaheads. Bounded to 300 characters, anchored both ends.
 *
 * DELIBERATELY REJECTS A GLOB. FLOW-05's own text states the expected-files
 * list "is the input to the drift detector in `/review`" -- comparing a
 * real `git diff --name-only` entry against a glob pattern would make "is
 * this path inside the declared union" undecidable without a glob matcher
 * nobody has written [threat T-09-06-01: an over-broad expected-files entry
 * widens the drift detector's allowance to the whole filesystem].
 */
export const EXPECTED_FILE_PATTERN = /^(?!\/)(?!\.\.(?:\/|$))(?!.*\/\.\.(?:\/|$))[\w./-]{1,300}$/;

/**
 * Parse §5's body text into {@link ScopePin}. Each of the three sublists
 * ("In scope", "Out of scope", "Expected files") is a bold-labelled
 * subsection ({@link SCOPE_SUBSECTION_PATTERN}) containing a bullet list
 * ({@link LIST_ITEM_PATTERN}). An out-of-scope bullet is split on
 * {@link OUT_OF_SCOPE_SEPARATOR}; an entry with no separator parses to an
 * empty `reason` (see that constant's own doc comment for why).
 */
export function parseScopePin(sectionBody: string): ScopePin {
	const inScope = Array.from(extractScopeSubsection(sectionBody, "In scope").matchAll(LIST_ITEM_PATTERN)).map(
		(m) => (m[1] ?? "").trim(),
	);

	const outOfScope: ScopeExclusion[] = Array.from(
		extractScopeSubsection(sectionBody, "Out of scope").matchAll(LIST_ITEM_PATTERN),
	).map((m) => {
		const raw = (m[1] ?? "").trim();
		const sepIndex = raw.indexOf(OUT_OF_SCOPE_SEPARATOR);
		if (sepIndex === -1) {
			return { item: raw, reason: "" };
		}
		return { item: raw.slice(0, sepIndex).trim(), reason: raw.slice(sepIndex + OUT_OF_SCOPE_SEPARATOR.length).trim() };
	});

	const expectedFiles = Array.from(extractScopeSubsection(sectionBody, "Expected files").matchAll(LIST_ITEM_PATTERN)).map(
		(m) => (m[1] ?? "").trim(),
	);

	return { inScope, outOfScope, expectedFiles };
}

// ---------------------------------------------------------------------------
// FIX_FRAMING_MARKERS, isFixFramed, RootCause, parseRootCause -- QUAL-03's inputs
// ---------------------------------------------------------------------------

/**
 * The tokens that make a SPEC "fix-framed" for QUAL-03's purposes, matched
 * case-insensitively as a substring against §1's Goal text. Frozen, named,
 * not inlined.
 *
 * KNOWN IMPRECISION, STATED HONESTLY: a change that IS a fix but whose Goal
 * sentence avoids every one of these words (e.g. "Make the checkpoint store
 * serialise concurrent writers") is NOT caught by this heuristic. This is a
 * deliberate, bounded trade -- QUAL-03 needs SOME mechanical trigger, and a
 * substring match on the one section every SPEC already has (§1) is
 * simpler and more auditable than a model-authored self-classification this
 * project's own anti-review-theatre stance (08-CONTEXT.md decision 6) would
 * then need to gate in turn. A caller who knows independently that a change
 * is fix-framed may pass `{ fixFramed: true }` to {@link validateSpec} and
 * bypass this heuristic entirely.
 */
export const FIX_FRAMING_MARKERS: readonly string[] = Object.freeze(["fix", "bug", "regression", "defect", "broken"]);

/** Pure. Case-insensitive substring test of `goalText` against {@link FIX_FRAMING_MARKERS}. */
export function isFixFramed(goalText: string): boolean {
	const lower = goalText.toLowerCase();
	return FIX_FRAMING_MARKERS.some((marker) => lower.includes(marker));
}

/** The parsed (optional) Root Cause section: the named cause and why the change addresses it rather than the symptom. */
export interface RootCause {
	readonly cause: string;
	readonly whyNotSymptom: string;
}

/**
 * The Root Cause section's heading text. NOT one of {@link SPEC_SECTIONS}'
 * eight frozen entries -- see {@link parseRootCause}'s own doc comment for
 * why.
 */
const ROOT_CAUSE_HEADING = "Root Cause";

/**
 * The `file:line` half of {@link EVIDENCE_PATTERN}, WITHOUT anchors, for
 * scanning a longer free-text field (a Root Cause paragraph) for the
 * PRESENCE of a citation rather than requiring the whole field to be
 * nothing else. QUAL-03 requires "file:line evidence" WITHIN a narrative
 * sentence, not a bare citation as the field's entire content -- a
 * different requirement in shape from `EVIDENCE_PATTERN`'s own §2
 * table-cell use, so this is a second named constant, not a re-export.
 * Bounded (`{1,300}`), for the same backtracking-safety reason as
 * `EVIDENCE_PATTERN`'s own path segment.
 */
const ROOT_CAUSE_CITATION_PATTERN = /[\w./-]{1,300}:\d+/;

/**
 * Extracts the single-line text following a bold-labelled inline field,
 * e.g. `**Cause:** some text`, case-insensitively. Returns an empty string
 * when the label is absent. Bounded to 2000 characters with no `\n` in the
 * captured class -- Root Cause's two fields are single-line by this
 * module's own convention (see {@link parseRootCause}), so this never
 * needs to span lines.
 */
function extractLabelledField(body: string, label: string): string {
	const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]{0,2000})`, "i");
	return (pattern.exec(body)?.[1] ?? "").trim();
}

/**
 * Parse a Root Cause section's body text into {@link RootCause}. Convention:
 * two bold-labelled single-line fields, `**Cause:**` and `**Why not the
 * symptom:**`. Called only from {@link validateSpec}'s branch (8), on the
 * body of a heading located by text match against {@link ROOT_CAUSE_HEADING}
 * -- Root Cause is NOT added as a ninth {@link SPEC_SECTIONS} entry, because
 * that table's own module docstring calls it "frozen" and QUAL-03's Root
 * Cause section is CONDITIONALLY required, not one of the eight sections
 * every SPEC carries unconditionally.
 */
export function parseRootCause(sectionBody: string): RootCause {
	return {
		cause: extractLabelledField(sectionBody, "Cause"),
		whyNotSymptom: extractLabelledField(sectionBody, "Why not the symptom"),
	};
}

// ---------------------------------------------------------------------------
// validateSpec -- the whole-document, numbered, binding-order gate
// ---------------------------------------------------------------------------

/**
 * The whole validated SPEC artifact. Only ever produced by
 * {@link validateSpec}'s accept arm (branch 9) -- there is no other
 * constructor.
 */
export interface SpecArtifact {
	readonly goal: string;
	readonly verifiedFacts: readonly VerifiedFact[];
	readonly requirementsBody: string;
	readonly errorBehaviours: readonly string[];
	readonly scopePin: ScopePin;
	readonly clarificationsBody: string;
	readonly assumptionsBody: string;
	readonly scorecardBody: string;
	/** Present only when this SPEC is fix-framed (QUAL-03) -- see {@link validateSpec} branch (8). */
	readonly rootCause?: RootCause;
}

/** Mirrors {@link SpecGateVerdict}: deliberately two arms, never three. */
export type SpecValidation = { readonly ok: true; readonly spec: SpecArtifact } | { readonly ok: false; readonly reason: string };

/** Optional override for {@link validateSpec}'s fix-framing determination -- see {@link FIX_FRAMING_MARKERS}'s own doc comment. */
export interface ValidateSpecOptions {
	readonly fixFramed?: boolean;
}

const ERROR_BEHAVIOUR_SECTION = requiredSection("errorBehaviour");
const SCOPE_PIN_SECTION = requiredSection("scopePin");
const GOAL_SECTION = requiredSection("goal");
const CLARIFICATIONS_SECTION = requiredSection("clarifications");
const ASSUMPTIONS_SECTION = requiredSection("assumptions");
const SCORECARD_SECTION = requiredSection("scorecard");

/**
 * Every heading {@link validateSpec} accepts: the eight
 * {@link SPEC_SECTIONS} plus the conditionally-required Root Cause section.
 */
const KNOWN_HEADINGS: ReadonlySet<string> = new Set([
	...SPEC_SECTIONS.map((s) => s.heading.toLowerCase()),
	ROOT_CAUSE_HEADING.toLowerCase(),
]);

/**
 * Branch (1)'s own check, factored out for readability: an unknown heading,
 * or the SAME heading appearing twice, is malformed input a caller must fix
 * before any content check below is meaningful.
 */
function findMalformedHeadingReason(headings: readonly ParsedHeading[]): string | undefined {
	const seen = new Set<string>();
	for (const heading of headings) {
		const lower = heading.headingText.toLowerCase();
		if (!KNOWN_HEADINGS.has(lower)) {
			return (
				`unknown heading "${heading.headingText}" -- a SPEC.md may only contain the eight SPEC_SECTIONS ` +
				`headings plus an optional "${ROOT_CAUSE_HEADING}" section`
			);
		}
		if (seen.has(lower)) {
			return `heading "${heading.headingText}" appears more than once -- each SPEC.md section may appear at most once`;
		}
		seen.add(lower);
	}
	return undefined;
}

/**
 * FLOW-04 / FLOW-05 (declaration half) / QUAL-03 -- the whole-document,
 * numbered, BINDING-ORDER gate, in {@link gateRequirementsAuthorship}'s own
 * docstring style. Every reject `reason` is built FROM THE RECEIVED DATA.
 *
 *   (1) an unknown or duplicated heading -> reject. Malformed structural
 *       input; nothing below is meaningful until this is fixed.
 *   (2) delegate to {@link gateRequirementsAuthorship} -- the §2 gate stays
 *       FIRST among content checks, because every later check (§4's
 *       entries, §5's paths, a Root Cause citation) is downstream of the
 *       same "requirements are not authored on unverified facts" principle
 *       §2 itself enforces; a SPEC failing §2 has nothing worth checking
 *       further.
 *   (3) §1 Goal absent or empty -> reject. Every downstream reader needs
 *       the single falsifiable anchor sentence.
 *   (4) §4 entry count below {@link MIN_ERROR_BEHAVIOURS} -> reject.
 *   (5) ANY §4 entry failing {@link IF_THEN_PATTERN} -> reject, quoting the
 *       offending entry and its 1-based index. Sits after (4): a count
 *       defect is reported before a shape defect on an entry that may not
 *       even be meant as one of the required three.
 *   (6) §5's out-of-scope list empty, or ANY out-of-scope item with no
 *       reason -> reject. FLOW-05's declaration half: "Out-of-scope must be
 *       non-empty, each with a one-line reason" (`FEATURES.md` Part 2).
 *   (7) §5's expected-files list empty, or ANY entry failing
 *       {@link EXPECTED_FILE_PATTERN} -> reject, naming the offending path.
 *       Sits after (6): scope's exclusions are checked before scope's
 *       inclusions, matching FEATURES.md's own listed order.
 *   (8) QUAL-03's conditional Root Cause gate, fired only when
 *       `options.fixFramed ?? isFixFramed(goal)` -- an absent section, an
 *       empty cause, a cause with no file:line citation, an empty
 *       "why not the symptom", or one identical to the cause text, are
 *       each their own reject. Sits LAST among content checks: a
 *       fix-framed SPEC's Root Cause is extra structure ON TOP of an
 *       otherwise well-formed document, matching QUAL-03's own "gated the
 *       same way as Verified Codebase Facts" wording -- it does not
 *       replace any earlier check.
 *   (9) otherwise -> accept, constructing {@link SpecArtifact} -- the ONLY
 *       place in this file that does so.
 *
 * WHAT THIS VALIDATOR DOES NOT, AND CANNOT, PROVE: it proves the SPEC has
 * the required SHAPE. It cannot prove the §4 error behaviours are the
 * RIGHT ones for this change, that the §5 expected-files list is COMPLETE
 * (only that it is non-empty and every entry is a legal path -- `/review`'s
 * own drift detector, built in a later plan, is what compares it against a
 * real diff), or that a stated Root Cause is the REAL one. A fabricated
 * citation naming a real file at a real line is shaped correctly and
 * passes here, exactly as {@link gateRequirementsAuthorship}'s own "WHAT
 * THIS PREDICATE DOES NOT, AND CANNOT, PROVE" section states for §2.
 */
export function validateSpec(markdown: string, options?: ValidateSpecOptions): SpecValidation {
	const headings = parseSpecSections(markdown);

	// (1)
	const malformedReason = findMalformedHeadingReason(headings);
	if (malformedReason !== undefined) {
		return { ok: false, reason: malformedReason };
	}

	// (2)
	const factsVerdict = gateRequirementsAuthorship(markdown);
	if (!factsVerdict.ok) {
		return { ok: false, reason: factsVerdict.reason };
	}

	// (3)
	const goalSection = findSection(headings, GOAL_SECTION);
	const goal = (goalSection?.body ?? "").trim();
	if (goal.length === 0) {
		return {
			ok: false,
			reason: `the "${GOAL_SECTION.heading}" section (§1) is absent or empty -- every downstream reader needs a single falsifiable anchor sentence`,
		};
	}

	// (4)
	const errorBehaviourSection = findSection(headings, ERROR_BEHAVIOUR_SECTION);
	const errorBehaviours = parseErrorBehaviours(errorBehaviourSection?.body ?? "");
	if (errorBehaviours.length < MIN_ERROR_BEHAVIOURS) {
		return {
			ok: false,
			reason:
				`the "${ERROR_BEHAVIOUR_SECTION.heading}" section (§4) has ${errorBehaviours.length} entries, fewer ` +
				`than the required minimum of ${MIN_ERROR_BEHAVIOURS} (FLOW-04)`,
		};
	}

	// (5)
	for (let i = 0; i < errorBehaviours.length; i++) {
		const entry = errorBehaviours[i];
		if (entry === undefined || !IF_THEN_PATTERN.test(entry)) {
			return {
				ok: false,
				reason:
					`entry ${i + 1} of the "${ERROR_BEHAVIOUR_SECTION.heading}" section (§4) does not match the ` +
					`required "IF <condition> THEN THE SYSTEM SHALL <response>" form (FLOW-04) -- received ${JSON.stringify(entry ?? "")}`,
			};
		}
	}

	// (6)/(7)
	const scopePinSection = findSection(headings, SCOPE_PIN_SECTION);
	const scopePin = parseScopePin(scopePinSection?.body ?? "");

	if (scopePin.outOfScope.length === 0) {
		return {
			ok: false,
			reason:
				`the "${SCOPE_PIN_SECTION.heading}" section's (§5) out-of-scope list is empty -- FLOW-05 requires a ` +
				"non-empty out-of-scope list, each with a one-line reason",
		};
	}
	for (let i = 0; i < scopePin.outOfScope.length; i++) {
		const exclusion = scopePin.outOfScope[i];
		if (exclusion !== undefined && exclusion.reason.length === 0) {
			return {
				ok: false,
				reason: `out-of-scope entry ${i + 1} ("${exclusion.item}") in the "${SCOPE_PIN_SECTION.heading}" section (§5) carries no reason`,
			};
		}
	}
	if (scopePin.expectedFiles.length === 0) {
		return {
			ok: false,
			reason:
				`the "${SCOPE_PIN_SECTION.heading}" section's (§5) expected-files list is empty -- FLOW-05's ` +
				"declaration half requires at least one declared file",
		};
	}
	for (let i = 0; i < scopePin.expectedFiles.length; i++) {
		const path = scopePin.expectedFiles[i];
		if (path === undefined || !EXPECTED_FILE_PATTERN.test(path)) {
			return {
				ok: false,
				reason:
					`expected-files entry ${i + 1} in the "${SCOPE_PIN_SECTION.heading}" section (§5) is not a valid ` +
					`repo-relative path (no leading "/", no ".." segment, no glob) -- received ${JSON.stringify(path ?? "")}`,
			};
		}
	}

	// (8)
	const fixFramed = options?.fixFramed ?? isFixFramed(goal);
	let rootCause: RootCause | undefined;
	if (fixFramed) {
		const rootCauseHeading = headings.find((h) => h.headingText.toLowerCase() === ROOT_CAUSE_HEADING.toLowerCase());
		if (rootCauseHeading === undefined) {
			return {
				ok: false,
				reason: `this SPEC is fix-framed (QUAL-03) but carries no "${ROOT_CAUSE_HEADING}" section naming the cause with file:line evidence`,
			};
		}
		const parsed = parseRootCause(rootCauseHeading.body);
		if (parsed.cause.length === 0) {
			return { ok: false, reason: `this SPEC's "${ROOT_CAUSE_HEADING}" section (QUAL-03) names no cause` };
		}
		if (!ROOT_CAUSE_CITATION_PATTERN.test(parsed.cause)) {
			return {
				ok: false,
				reason: `this SPEC's "${ROOT_CAUSE_HEADING}" section's cause (QUAL-03) carries no file:line citation -- received ${JSON.stringify(parsed.cause)}`,
			};
		}
		if (parsed.whyNotSymptom.length === 0) {
			return {
				ok: false,
				reason: `this SPEC's "${ROOT_CAUSE_HEADING}" section (QUAL-03) does not state why the change addresses the cause rather than the symptom`,
			};
		}
		if (parsed.whyNotSymptom.trim() === parsed.cause.trim()) {
			return {
				ok: false,
				reason: `this SPEC's "${ROOT_CAUSE_HEADING}" section's "why not the symptom" text (QUAL-03) is identical to its cause text -- these must be distinct`,
			};
		}
		rootCause = parsed;
	}

	// (9)
	const factsSection = findSection(headings, VERIFIED_FACTS_SECTION);
	const requirementsSection = findSection(headings, REQUIREMENTS_SECTION);
	const clarificationsSection = findSection(headings, CLARIFICATIONS_SECTION);
	const assumptionsSection = findSection(headings, ASSUMPTIONS_SECTION);
	const scorecardSection = findSection(headings, SCORECARD_SECTION);

	const spec: SpecArtifact = {
		goal,
		verifiedFacts: parseVerifiedFacts(factsSection?.body ?? ""),
		requirementsBody: (requirementsSection?.body ?? "").trim(),
		errorBehaviours,
		scopePin,
		clarificationsBody: (clarificationsSection?.body ?? "").trim(),
		assumptionsBody: (assumptionsSection?.body ?? "").trim(),
		scorecardBody: (scorecardSection?.body ?? "").trim(),
		...(rootCause !== undefined ? { rootCause } : {}),
	};

	return { ok: true, spec };
}

// ---------------------------------------------------------------------------
// renderSpecMarkdown -- the on-disk SPEC.md rendering
// ---------------------------------------------------------------------------

/**
 * Renders a validated {@link SpecArtifact} as the on-disk `SPEC.md` shape,
 * copying `renderReviewMarkdown`'s accumulator shape exactly: a `string[]`
 * pushed to per section, joined with `"\n"`. Only ever called with a
 * {@link SpecArtifact} that already came out of {@link validateSpec}'s
 * accept arm (branch 9) -- there is no independent shape validation here,
 * because there is no other legitimate constructor for a `SpecArtifact` in
 * this codebase.
 */
export function renderSpecMarkdown(spec: SpecArtifact): string {
	const lines: string[] = [];

	lines.push("# SPEC");
	lines.push("");

	lines.push(`## ${GOAL_SECTION.ordinal}. ${GOAL_SECTION.heading}`);
	lines.push("");
	lines.push(spec.goal);
	lines.push("");

	lines.push(`## ${VERIFIED_FACTS_SECTION.ordinal}. ${VERIFIED_FACTS_SECTION.heading}`);
	lines.push("");
	lines.push("| Claim | Evidence | How Verified |");
	lines.push("| --- | --- | --- |");
	for (const fact of spec.verifiedFacts) {
		lines.push(`| ${fact.claim} | ${fact.evidence} | ${fact.howVerified} |`);
	}
	lines.push("");

	lines.push(`## ${REQUIREMENTS_SECTION.ordinal}. ${REQUIREMENTS_SECTION.heading}`);
	lines.push("");
	lines.push(spec.requirementsBody);
	lines.push("");

	lines.push(`## ${ERROR_BEHAVIOUR_SECTION.ordinal}. ${ERROR_BEHAVIOUR_SECTION.heading}`);
	lines.push("");
	for (const entry of spec.errorBehaviours) {
		lines.push(`- ${entry}`);
	}
	lines.push("");

	lines.push(`## ${SCOPE_PIN_SECTION.ordinal}. ${SCOPE_PIN_SECTION.heading}`);
	lines.push("");
	lines.push("**In scope:**");
	lines.push("");
	for (const item of spec.scopePin.inScope) {
		lines.push(`- ${item}`);
	}
	lines.push("");
	lines.push("**Out of scope:**");
	lines.push("");
	for (const exclusion of spec.scopePin.outOfScope) {
		lines.push(`- ${exclusion.item}${OUT_OF_SCOPE_SEPARATOR}${exclusion.reason}`);
	}
	lines.push("");
	lines.push("**Expected files:**");
	lines.push("");
	for (const path of spec.scopePin.expectedFiles) {
		lines.push(`- ${path}`);
	}
	lines.push("");

	lines.push(`## ${CLARIFICATIONS_SECTION.ordinal}. ${CLARIFICATIONS_SECTION.heading}`);
	lines.push("");
	lines.push(spec.clarificationsBody);
	lines.push("");

	lines.push(`## ${ASSUMPTIONS_SECTION.ordinal}. ${ASSUMPTIONS_SECTION.heading}`);
	lines.push("");
	lines.push(spec.assumptionsBody);
	lines.push("");

	lines.push(`## ${SCORECARD_SECTION.ordinal}. ${SCORECARD_SECTION.heading}`);
	lines.push("");
	lines.push(spec.scorecardBody);
	lines.push("");

	if (spec.rootCause !== undefined) {
		lines.push(`## ${ROOT_CAUSE_HEADING}`);
		lines.push("");
		lines.push(`**Cause:** ${spec.rootCause.cause}`);
		lines.push("");
		lines.push(`**Why not the symptom:** ${spec.rootCause.whyNotSymptom}`);
		lines.push("");
	}

	lines.push("---");
	lines.push("");
	lines.push(
		"*The §2 evidence column records what was checked and by what method. This rendered document is the " +
			"model's claim plus that record -- not a proof. See this module's own \"WHAT THIS VALIDATOR DOES " +
			'NOT, AND CANNOT, PROVE" section.*',
	);
	lines.push("");

	return lines.join("\n");
}
