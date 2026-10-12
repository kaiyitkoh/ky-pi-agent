/**
 * The /grill -> SPEC.md section parser and the §2 evidence gate, as code rather than prompt wording.
 * gateRequirementsAuthorship is a pure predicate with a binding branch order: §3 may not be authored until §2 exists and every row carries evidence.
 * It checks that a citation is shaped like evidence (file:line or labelled command output), not that it is true; /grill's read pass and /review cover that.
 * Pure: no model call, no file read, registers nothing.
 */


/** The eight SPEC.md section identifiers, in FEATURES.md Part 2's order. */
export type SpecSectionId =
	| "goal"
	| "verifiedFacts"
	| "requirements"
	| "errorBehaviour"
	| "scopePin"
	| "clarifications"
	| "assumptions"
	| "scorecard";

export interface SpecSectionDescriptor {
	readonly id: SpecSectionId;
	readonly ordinal: number;
	readonly heading: string;
	/** The downstream reader of this section; a section with no named consumer does not ship. */
	readonly consumer: string;
}

/** The eight SPEC.md sections in prescribed order, frozen per entry so a caller cannot mutate the shared table. */
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


/** Matches `## <n>. <Heading>` or `## <Heading>` (numeral optional), capturing the heading text. Line-anchored so a mid-sentence `##` is never a heading. */
export const HEADING_PATTERN = /^##\s+(?:\d+\.\s+)?(.+?)\s*$/gm;

export interface ParsedHeading {
	readonly headingText: string;
	readonly body: string;
}

/** Splits SPEC.md into headings and bodies. Returns every heading, including unknown or duplicated ones, so callers can reject them instead of never seeing them. */
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

/** Looks up a heading by descriptor text (case-insensitive). Returns only the first match; duplication checks must inspect the full parse. */
export function findSection(headings: readonly ParsedHeading[], section: SpecSectionDescriptor): ParsedHeading | undefined {
	return headings.find((h) => h.headingText.toLowerCase() === section.heading.toLowerCase());
}


/**
 * The two accepted evidence shapes, full-match anchored: `file:line` (path of [w./-], 1-300 chars) or `command output: <text>` (non-blank, up to 500 chars).
 * Bounded with no nested unbounded quantifier to avoid catastrophic backtracking.
 * Rejected: bare assertions, a lone URL, the word "verified" alone.
 */
export const EVIDENCE_PATTERN = /^(?:[\w./-]{1,300}:\d+|command output:\s*\S.{0,500})$/i;

export interface VerifiedFact {
	readonly claim: string;
	readonly evidence: string;
	readonly howVerified: string;
}

/** A markdown pipe-table data row, line-anchored; header and separator rows are filtered by isSeparatorRow. */
const TABLE_ROW_PATTERN = /^\|(.+)\|\s*$/gm;

function isSeparatorRow(cells: readonly string[]): boolean {
	return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

/** Parses the §2 table into claim | evidence | how-verified rows. A row with missing cells keeps them as empty strings, never dropped, so the gate can name it. */
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
		// The header row's first cell is "claim"; exclude it by content.
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


/** Two arms, never three: a reject must be surfaced and §3 refused; there is no partial accept. */
export type SpecGateVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Resolves a required entry from SPEC_SECTIONS at module load with a definite return type. NEVER THROWS in practice: the frozen table holds both ids; the guard only fails loudly if an edit drops one. */
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
 * May /grill write §3? First match wins, in this binding order; every reject reason is built from the received data.
 * (1) §2 heading absent.
 * (2) §2 present with zero data rows.
 * (3) a row with an empty claim, before (4) so a claimless row is reported for the real defect.
 * (4) an evidence cell failing EVIDENCE_PATTERN.
 * (5) a row with an empty howVerified.
 * (6) §3 already present while any of (1)-(5) fired: reject, restating the underlying §2 defect (folded in by withRequirementsGuard).
 * (7) otherwise accept; a populated §2 with no §3 yet accepts, since this gates authorship of §3.
 */
export function gateRequirementsAuthorship(markdown: string): SpecGateVerdict {
	const headings = parseSpecSections(markdown);
	const factsSection = findSection(headings, VERIFIED_FACTS_SECTION);
	const requirementsSection = findSection(headings, REQUIREMENTS_SECTION);
	const requirementsPresent = requirementsSection !== undefined;

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

	return { ok: true };
}

/** Frames a §2 defect with the "§3 already present" ordering violation when §3 exists; otherwise returns the defect alone. */
function withRequirementsGuard(section2Defect: string, requirementsPresent: boolean): string {
	if (requirementsPresent) {
		return (
			`the "${REQUIREMENTS_SECTION.heading}" section (§3) is present, but requirements may not be ` +
			`authored on unverified facts: ${section2Defect}`
		);
	}
	return section2Defect;
}


/**
 * The §4 EARS-lite form: `IF <condition> THEN THE SYSTEM SHALL <response>`, the only EARS pattern adopted.
 * Upper case and no `i` flag on purpose: a case-insensitive match would let ordinary prose pass. Rejected: lower case, no THEN clause, SHOULD, bare sentences.
 * Captures are bounded lazy `S.{0,2000}?` and the pattern is anchored, so a 10 KB non-matching entry fails in bounded steps.
 */
export const IF_THEN_PATTERN = /^IF\s+(\S.{0,2000}?)\s+THEN THE SYSTEM SHALL\s+(\S.{0,2000}?)$/;

/** Minimum §4 entry count (FEATURES.md Part 2 line 167), named for the magic-number rule. */
export const MIN_ERROR_BEHAVIOURS = 3;

/** A markdown bullet item ("-" or "*"), capturing the text after the marker. Shared by §4 and §5 parsing. */
const LIST_ITEM_PATTERN = /^[-*]\s+(\S.*)$/gm;

/** Parses §4 into one entry per bullet. A malformed entry is returned as-is, never dropped, so validateSpec's shape check can see it. */
export function parseErrorBehaviours(sectionBody: string): readonly string[] {
	return Array.from(sectionBody.matchAll(LIST_ITEM_PATTERN)).map((m) => (m[1] ?? "").trim());
}


export interface ScopeExclusion {
	readonly item: string;
	readonly reason: string;
}

/** The parsed §5 Scope Pin. outOfScope and expectedFiles must be non-empty, enforced by validateSpec; the parser returns what was written. */
export interface ScopePin {
	readonly inScope: readonly string[];
	readonly outOfScope: readonly ScopeExclusion[];
	readonly expectedFiles: readonly string[];
}

/** Separator between an out-of-scope item and its reason. A missing separator yields an empty reason, which validateSpec rejects. */
const OUT_OF_SCOPE_SEPARATOR = " — ";

/** Bold-labelled §5 subsection header (**In scope:**, **Out of scope:**, **Expected files:**), line-anchored and case-insensitive. */
const SCOPE_SUBSECTION_PATTERN = /^\*\*(.+?):\*\*\s*$/gim;

/** Slices body to the text after the first header matching `label`, up to the next header. Absent means empty. */
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
 * A repo-relative path: [w./-] only, so globs fail to match; also rejects a leading / and any .. segment. 1-300 chars, anchored.
 * Globs are rejected on purpose: the /review drift detector compares real diff paths and cannot match globs, and an over-broad entry would widen its allowance.
 */
export const EXPECTED_FILE_PATTERN = /^(?!\/)(?!\.\.(?:\/|$))(?!.*\/\.\.(?:\/|$))[\w./-]{1,300}$/;

/** Parses §5 into ScopePin: three bold-labelled bullet sublists; out-of-scope bullets are split on OUT_OF_SCOPE_SEPARATOR. */
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


/**
 * Tokens that make a SPEC "fix-framed", matched case-insensitively against the Goal.
 * Known imprecision: a fix whose Goal avoids all of them is not caught. A caller may pass `{ fixFramed: true }` to validateSpec to override.
 */
export const FIX_FRAMING_MARKERS: readonly string[] = Object.freeze(["fix", "bug", "regression", "defect", "broken"]);

export function isFixFramed(goalText: string): boolean {
	const lower = goalText.toLowerCase();
	return FIX_FRAMING_MARKERS.some((marker) => lower.includes(marker));
}

export interface RootCause {
	readonly cause: string;
	readonly whyNotSymptom: string;
}

/** Root Cause heading text. Not a ninth SPEC_SECTIONS entry: that table is frozen and this section is only conditionally required. */
const ROOT_CAUSE_HEADING = "Root Cause";

/** The unanchored `file:line` half of EVIDENCE_PATTERN, for finding a citation inside a Root Cause sentence. Bounded to 300 chars. */
const ROOT_CAUSE_CITATION_PATTERN = /[\w./-]{1,300}:\d+/;

/** Single-line text after a bold inline label (`**Cause:** text`), case-insensitive; empty when absent. Bounded to 2000 chars. */
function extractLabelledField(body: string, label: string): string {
	const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]{0,2000})`, "i");
	return (pattern.exec(body)?.[1] ?? "").trim();
}

/** Parses Root Cause into two single-line bold fields, `**Cause:**` and `**Why not the symptom:**`. Called only from validateSpec branch (8). */
export function parseRootCause(sectionBody: string): RootCause {
	return {
		cause: extractLabelledField(sectionBody, "Cause"),
		whyNotSymptom: extractLabelledField(sectionBody, "Why not the symptom"),
	};
}


/** The validated SPEC artifact; only validateSpec's accept arm (branch 9) constructs one. */
export interface SpecArtifact {
	readonly goal: string;
	readonly verifiedFacts: readonly VerifiedFact[];
	readonly requirementsBody: string;
	readonly errorBehaviours: readonly string[];
	readonly scopePin: ScopePin;
	readonly clarificationsBody: string;
	readonly assumptionsBody: string;
	readonly scorecardBody: string;
	readonly rootCause?: RootCause;
}

/** Two arms, never three. */
export type SpecValidation = { readonly ok: true; readonly spec: SpecArtifact } | { readonly ok: false; readonly reason: string };

export interface ValidateSpecOptions {
	readonly fixFramed?: boolean;
}

const ERROR_BEHAVIOUR_SECTION = requiredSection("errorBehaviour");
const SCOPE_PIN_SECTION = requiredSection("scopePin");
const GOAL_SECTION = requiredSection("goal");
const CLARIFICATIONS_SECTION = requiredSection("clarifications");
const ASSUMPTIONS_SECTION = requiredSection("assumptions");
const SCORECARD_SECTION = requiredSection("scorecard");

const KNOWN_HEADINGS: ReadonlySet<string> = new Set([
	...SPEC_SECTIONS.map((s) => s.heading.toLowerCase()),
	ROOT_CAUSE_HEADING.toLowerCase(),
]);

/** Branch (1): an unknown or duplicated heading is malformed input to fix before any content check. */
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
 * Whole-document gate; first match wins, in this binding order; every reject reason is built from the received data.
 * (1) an unknown or duplicated heading.
 * (2) gateRequirementsAuthorship (§2) stays first among content checks.
 * (3) §1 Goal absent or empty.
 * (4) §4 entry count below MIN_ERROR_BEHAVIOURS.
 * (5) any §4 entry failing IF_THEN_PATTERN, quoting it and its 1-based index.
 * (6) §5 out-of-scope empty, or an item with no reason.
 * (7) §5 expected-files empty, or an entry failing EXPECTED_FILE_PATTERN.
 * (8) Root Cause, only when `options.fixFramed ?? isFixFramed(goal)`: absent section, empty cause, no file:line citation, empty or identical "why not the symptom".
 * (9) accept, constructing SpecArtifact, the only place that does.
 * Proves shape only: not that §4 is right, §5 is complete, or a citation is real.
 */
export function validateSpec(markdown: string, options?: ValidateSpecOptions): SpecValidation {
	const headings = parseSpecSections(markdown);

	const malformedReason = findMalformedHeadingReason(headings);
	if (malformedReason !== undefined) {
		return { ok: false, reason: malformedReason };
	}

	const factsVerdict = gateRequirementsAuthorship(markdown);
	if (!factsVerdict.ok) {
		return { ok: false, reason: factsVerdict.reason };
	}

	const goalSection = findSection(headings, GOAL_SECTION);
	const goal = (goalSection?.body ?? "").trim();
	if (goal.length === 0) {
		return {
			ok: false,
			reason: `the "${GOAL_SECTION.heading}" section (§1) is absent or empty -- every downstream reader needs a single falsifiable anchor sentence`,
		};
	}

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


/** Renders a validated SpecArtifact as SPEC.md, a string[] joined with newlines. Only called with validateSpec's accept output. */
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
