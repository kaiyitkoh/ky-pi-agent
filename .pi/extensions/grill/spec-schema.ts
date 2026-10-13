/**
 * The /grill -> SPEC.md section parser and the §2 evidence gate, as code rather than prompt wording.
 * gateRequirementsAuthorship: §3 may not be authored until §2 exists and every row carries evidence.
 * It checks that a citation is shaped like evidence (file:line or labelled command output), not that it is true; /grill's read pass and /review cover that.
 * Pure: no model call, no file read, registers nothing.
 */

/** The eight SPEC.md section identifiers, in FEATURES.md Part 2's order. */
export type SpecSectionId = "goal" | "verifiedFacts" | "requirements" | "errorBehaviour" | "scopePin" | "clarifications" | "assumptions" | "scorecard";

export interface SpecSectionDescriptor {
	readonly id: SpecSectionId;
	readonly ordinal: number;
	readonly heading: string;
	/** The downstream reader of this section; a section with no named consumer does not ship. */
	readonly consumer: string;
}

/** The eight SPEC.md sections in prescribed order; `ordinal` is the position. */
export const SPEC_SECTIONS: readonly SpecSectionDescriptor[] = Object.freeze(
	([
		["goal", "Goal", "every downstream reader (plan, execute, review) as the single falsifiable anchor sentence"],
		["verifiedFacts", "Verified Codebase Facts", "this module's own gateRequirementsAuthorship, which refuses §3 authorship until this section is populated with evidence"],
		["requirements", "Requirements", "/plan (each Rn becomes plan tasks) and /review (requirement verdicts are read against this section)"],
		["errorBehaviour", "Error and Edge Behaviour", "/plan (each entry becomes an acceptance case) and /review (requirement verdicts read against this section too)"],
		["scopePin", "Scope Pin", "/review's drift detector, which compares the expected-files list here against the files a PLAN.md actually touched"],
		["clarifications", "Clarifications Log", "a future human or agent re-reading this SPEC, so the interrogation that produced it stays auditable"],
		["assumptions", "Assumptions", "/review, which must not treat an assumption stamped here as a verified fact from §2"],
		["scorecard", "Ambiguity Scorecard", "the ambiguity gate itself -- a mechanical, re-readable record of why /grill judged itself done"],
	] as const).map(([id, heading, consumer], i) => Object.freeze({ id, ordinal: i + 1, heading, consumer })),
);

/** Matches `## <n>. <Heading>` or `## <Heading>`, capturing the heading text. Line-anchored so a mid-sentence `##` is never a heading. */
export const HEADING_PATTERN = /^##\s+(?:\d+\.\s+)?(.+?)\s*$/gm;

export interface ParsedHeading {
	readonly headingText: string;
	readonly body: string;
}

/** Splits SPEC.md into headings and bodies. Returns every heading, including unknown or duplicated ones, so callers can reject them. */
export function parseSpecSections(markdown: string): readonly ParsedHeading[] {
	const matches = Array.from(markdown.matchAll(HEADING_PATTERN));
	return matches.map((match, i) => ({
		headingText: match[1]?.trim() ?? "",
		body: markdown.slice(match.index + match[0].length, matches[i + 1]?.index ?? markdown.length),
	}));
}

/** The first heading matching the descriptor (case-insensitive); duplication checks must inspect the full parse. */
export function findSection(headings: readonly ParsedHeading[], section: SpecSectionDescriptor): ParsedHeading | undefined {
	return headings.find((h) => h.headingText.toLowerCase() === section.heading.toLowerCase());
}

/**
 * The two accepted evidence shapes, full-match anchored: `file:line` (path of [w./-], 1-300 chars) or `command output: <text>` (non-blank, up to 500 chars).
 * Bounded with no nested unbounded quantifier. Rejected: bare assertions, a lone URL, the word "verified" alone.
 */
export const EVIDENCE_PATTERN = /^(?:[\w./-]{1,300}:\d+|command output:\s*\S.{0,500})$/i;

export interface VerifiedFact {
	readonly claim: string;
	readonly evidence: string;
	readonly howVerified: string;
}

/** A markdown pipe-table row, line-anchored. */
const TABLE_ROW_PATTERN = /^\|(.+)\|\s*$/gm;

const isSeparatorRow = (cells: readonly string[]): boolean => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));

/** Parses the §2 table into claim | evidence | how-verified rows. Missing cells stay as empty strings, never dropped, so the gate can name the row. */
export function parseVerifiedFacts(sectionBody: string): readonly VerifiedFact[] {
	return Array.from(sectionBody.matchAll(TABLE_ROW_PATTERN)).flatMap((match) => {
		const cells = (match[1] ?? "").split("|").map((c) => c.trim());
		const [claim = "", evidence = "", howVerified = ""] = cells;
		// The header row's first cell is "claim".
		return isSeparatorRow(cells) || claim.toLowerCase() === "claim" ? [] : [{ claim, evidence, howVerified }];
	});
}

export type SpecGateVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const section = (id: SpecSectionId): SpecSectionDescriptor => SPEC_SECTIONS.find((s) => s.id === id) as SpecSectionDescriptor;
const GOAL_SECTION = section("goal");
const VERIFIED_FACTS_SECTION = section("verifiedFacts");
const REQUIREMENTS_SECTION = section("requirements");
const ERROR_BEHAVIOUR_SECTION = section("errorBehaviour");
const SCOPE_PIN_SECTION = section("scopePin");
const CLARIFICATIONS_SECTION = section("clarifications");
const ASSUMPTIONS_SECTION = section("assumptions");
const SCORECARD_SECTION = section("scorecard");

/**
 * May /grill write §3? First match wins:
 * (1) §2 absent; (2) §2 with zero data rows; (3) a row with an empty claim, before (4) so it is reported for the real defect;
 * (4) an evidence cell failing EVIDENCE_PATTERN; (5) an empty howVerified.
 * When §3 is already present, each reason also names the ordering violation. A populated §2 with no §3 yet accepts.
 */
export function gateRequirementsAuthorship(markdown: string): SpecGateVerdict {
	const headings = parseSpecSections(markdown);
	const requirementsPresent = findSection(headings, REQUIREMENTS_SECTION) !== undefined;
	const reject = (defect: string): SpecGateVerdict => ({
		ok: false,
		reason: requirementsPresent ? `the "${REQUIREMENTS_SECTION.heading}" section (§3) is present, but requirements may not be authored on unverified facts: ${defect}` : defect,
	});
	const facts2 = `the "${VERIFIED_FACTS_SECTION.heading}" section (§2)`;
	const factsSection = findSection(headings, VERIFIED_FACTS_SECTION);
	if (factsSection === undefined) return reject(`${facts2} is absent from this SPEC -- requirements may not be authored before verified codebase facts exist`);
	const facts = parseVerifiedFacts(factsSection.body);
	if (facts.length === 0) return reject(`${facts2} exists but its table has zero data rows -- an empty facts table is a facts table that was never actually filled in`);
	const claimless = facts.findIndex((f) => f.claim.length === 0);
	if (claimless !== -1) return reject(`row ${claimless + 1} of ${facts2} has an empty claim cell`);
	const unevidenced = facts.findIndex((f) => !EVIDENCE_PATTERN.test(f.evidence));
	if (unevidenced !== -1) {
		const fact = facts[unevidenced] as VerifiedFact;
		return reject(
			`row ${unevidenced + 1} of ${facts2}, claim "${fact.claim}", has a malformed evidence cell -- expected a "file:line" citation or a ` +
				`"command output: ..." citation, received ${JSON.stringify(fact.evidence)}`,
		);
	}
	const unverified = facts.findIndex((f) => f.howVerified.length === 0);
	if (unverified !== -1) return reject(`row ${unverified + 1} of ${facts2}, claim "${facts[unverified]?.claim ?? ""}", has an empty "how verified" cell`);
	return { ok: true };
}

/**
 * The §4 EARS-lite form, the only EARS pattern adopted. Upper case and no `i` flag on purpose: a case-insensitive match would let ordinary prose pass.
 * Captures are bounded lazy `S.{0,2000}?` and the pattern is anchored, so a 10 KB non-matching entry fails in bounded steps.
 */
export const IF_THEN_PATTERN = /^IF\s+(\S.{0,2000}?)\s+THEN THE SYSTEM SHALL\s+(\S.{0,2000}?)$/;

/** Minimum §4 entry count (FEATURES.md Part 2 line 167). */
export const MIN_ERROR_BEHAVIOURS = 3;

/** A markdown bullet item ("-" or "*"), capturing the text after the marker. */
const LIST_ITEM_PATTERN = /^[-*]\s+(\S.*)$/gm;

const listItems = (body: string): string[] => Array.from(body.matchAll(LIST_ITEM_PATTERN)).map((m) => (m[1] ?? "").trim());

/** Parses §4 into one entry per bullet. A malformed entry is returned as-is, never dropped, so validateSpec can see it. */
export function parseErrorBehaviours(sectionBody: string): readonly string[] {
	return listItems(sectionBody);
}

export interface ScopeExclusion {
	readonly item: string;
	readonly reason: string;
}

/** The parsed §5 Scope Pin; validateSpec enforces that outOfScope and expectedFiles are non-empty. */
export interface ScopePin {
	readonly inScope: readonly string[];
	readonly outOfScope: readonly ScopeExclusion[];
	readonly expectedFiles: readonly string[];
}

/** A missing separator yields an empty reason, which validateSpec rejects. */
const OUT_OF_SCOPE_SEPARATOR = " — ";

/** Bold-labelled §5 subsection header (**In scope:**), line-anchored and case-insensitive. */
const SCOPE_SUBSECTION_PATTERN = /^\*\*(.+?):\*\*\s*$/gim;

/** The text after the first header matching `label`, up to the next header; absent means empty. */
function extractScopeSubsection(body: string, label: string): string {
	const matches = Array.from(body.matchAll(SCOPE_SUBSECTION_PATTERN));
	const i = matches.findIndex((m) => (m[1] ?? "").trim().toLowerCase() === label.toLowerCase());
	const match = matches[i];
	return match === undefined ? "" : body.slice(match.index + match[0].length, matches[i + 1]?.index ?? body.length);
}

/**
 * A repo-relative path: [w./-] only, so globs fail; also rejects a leading / and any .. segment. 1-300 chars, anchored.
 * The /review drift detector compares real diff paths and cannot match globs, and an over-broad entry would widen its allowance.
 */
export const EXPECTED_FILE_PATTERN = /^(?!\/)(?!\.\.(?:\/|$))(?!.*\/\.\.(?:\/|$))[\w./-]{1,300}$/;

/** Parses §5 into three bold-labelled bullet sublists; out-of-scope bullets are split on OUT_OF_SCOPE_SEPARATOR. */
export function parseScopePin(sectionBody: string): ScopePin {
	const outOfScope = listItems(extractScopeSubsection(sectionBody, "Out of scope")).map((raw) => {
		const sepIndex = raw.indexOf(OUT_OF_SCOPE_SEPARATOR);
		return sepIndex === -1 ? { item: raw, reason: "" } : { item: raw.slice(0, sepIndex).trim(), reason: raw.slice(sepIndex + OUT_OF_SCOPE_SEPARATOR.length).trim() };
	});
	return { inScope: listItems(extractScopeSubsection(sectionBody, "In scope")), outOfScope, expectedFiles: listItems(extractScopeSubsection(sectionBody, "Expected files")) };
}

/** Tokens that make a SPEC "fix-framed", matched case-insensitively against the Goal. A fix whose Goal avoids them all is not caught; callers may pass `{ fixFramed: true }`. */
export const FIX_FRAMING_MARKERS: readonly string[] = Object.freeze(["fix", "bug", "regression", "defect", "broken"]);

export function isFixFramed(goalText: string): boolean {
	const lower = goalText.toLowerCase();
	return FIX_FRAMING_MARKERS.some((marker) => lower.includes(marker));
}

export interface RootCause {
	readonly cause: string;
	readonly whyNotSymptom: string;
}

/** Not a ninth SPEC_SECTIONS entry: that table is frozen and this section is only conditionally required. */
const ROOT_CAUSE_HEADING = "Root Cause";

/** The unanchored `file:line` half of EVIDENCE_PATTERN, for a citation inside a Root Cause sentence. */
const ROOT_CAUSE_CITATION_PATTERN = /[\w./-]{1,300}:\d+/;

/** Single-line text after a bold inline label (`**Cause:** text`), case-insensitive; empty when absent. */
function extractLabelledField(body: string, label: string): string {
	return (new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]{0,2000})`, "i").exec(body)?.[1] ?? "").trim();
}

/** Parses Root Cause into its two single-line bold fields, `**Cause:**` and `**Why not the symptom:**`. */
export function parseRootCause(sectionBody: string): RootCause {
	return { cause: extractLabelledField(sectionBody, "Cause"), whyNotSymptom: extractLabelledField(sectionBody, "Why not the symptom") };
}

/** The validated SPEC artifact; only validateSpec's accept arm constructs one. */
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

export type SpecValidation = { readonly ok: true; readonly spec: SpecArtifact } | { readonly ok: false; readonly reason: string };

export interface ValidateSpecOptions {
	readonly fixFramed?: boolean;
}

const KNOWN_HEADINGS: ReadonlySet<string> = new Set([...SPEC_SECTIONS.map((s) => s.heading.toLowerCase()), ROOT_CAUSE_HEADING.toLowerCase()]);

/** An unknown or duplicated heading is malformed input to fix before any content check. */
function findMalformedHeadingReason(headings: readonly ParsedHeading[]): string | undefined {
	const seen = new Set<string>();
	for (const heading of headings) {
		const lower = heading.headingText.toLowerCase();
		if (!KNOWN_HEADINGS.has(lower)) {
			return `unknown heading "${heading.headingText}" -- a SPEC.md may only contain the eight SPEC_SECTIONS headings plus an optional "${ROOT_CAUSE_HEADING}" section`;
		}
		if (seen.has(lower)) return `heading "${heading.headingText}" appears more than once -- each SPEC.md section may appear at most once`;
		seen.add(lower);
	}
	return undefined;
}

/** The fix-framed Root Cause defect, or undefined when the section names a cited cause and a distinct reason it is not the symptom. */
function rootCauseDefect(parsed: RootCause | undefined): string | undefined {
	const named = `this SPEC's "${ROOT_CAUSE_HEADING}" section`;
	if (parsed === undefined) return `this SPEC is fix-framed (QUAL-03) but carries no "${ROOT_CAUSE_HEADING}" section naming the cause with file:line evidence`;
	if (parsed.cause.length === 0) return `${named} (QUAL-03) names no cause`;
	if (!ROOT_CAUSE_CITATION_PATTERN.test(parsed.cause)) return `${named}'s cause (QUAL-03) carries no file:line citation -- received ${JSON.stringify(parsed.cause)}`;
	if (parsed.whyNotSymptom.length === 0) return `${named} (QUAL-03) does not state why the change addresses the cause rather than the symptom`;
	if (parsed.whyNotSymptom === parsed.cause) return `${named}'s "why not the symptom" text (QUAL-03) is identical to its cause text -- these must be distinct`;
	return undefined;
}

/**
 * Whole-document gate; first match wins:
 * (1) an unknown or duplicated heading; (2) gateRequirementsAuthorship (§2); (3) §1 Goal absent or empty;
 * (4) fewer than MIN_ERROR_BEHAVIOURS §4 entries; (5) a §4 entry failing IF_THEN_PATTERN;
 * (6) §5 out-of-scope empty, or an item with no reason; (7) §5 expected-files empty, or an entry failing EXPECTED_FILE_PATTERN;
 * (8) when `options.fixFramed ?? isFixFramed(goal)`, a Root Cause defect.
 * Proves shape only: not that §4 is right, §5 is complete, or a citation is real.
 */
export function validateSpec(markdown: string, options?: ValidateSpecOptions): SpecValidation {
	const reject = (reason: string): SpecValidation => ({ ok: false, reason });
	const headings = parseSpecSections(markdown);
	const body = (s: SpecSectionDescriptor): string => findSection(headings, s)?.body ?? "";

	const malformedReason = findMalformedHeadingReason(headings);
	if (malformedReason !== undefined) return reject(malformedReason);
	const factsVerdict = gateRequirementsAuthorship(markdown);
	if (!factsVerdict.ok) return factsVerdict;

	const goal = body(GOAL_SECTION).trim();
	if (goal.length === 0) return reject(`the "${GOAL_SECTION.heading}" section (§1) is absent or empty -- every downstream reader needs a single falsifiable anchor sentence`);

	const errorBehaviours = parseErrorBehaviours(body(ERROR_BEHAVIOUR_SECTION));
	const error4 = `the "${ERROR_BEHAVIOUR_SECTION.heading}" section (§4)`;
	if (errorBehaviours.length < MIN_ERROR_BEHAVIOURS) {
		return reject(`${error4} has ${errorBehaviours.length} entries, fewer than the required minimum of ${MIN_ERROR_BEHAVIOURS} (FLOW-04)`);
	}
	const badEntry = errorBehaviours.findIndex((entry) => !IF_THEN_PATTERN.test(entry));
	if (badEntry !== -1) {
		return reject(`entry ${badEntry + 1} of ${error4} does not match the required "IF <condition> THEN THE SYSTEM SHALL <response>" form (FLOW-04) -- received ${JSON.stringify(errorBehaviours[badEntry])}`);
	}

	const scopePin = parseScopePin(body(SCOPE_PIN_SECTION));
	const scope5 = `the "${SCOPE_PIN_SECTION.heading}" section`;
	if (scopePin.outOfScope.length === 0) {
		return reject(`${scope5}'s (§5) out-of-scope list is empty -- FLOW-05 requires a non-empty out-of-scope list, each with a one-line reason`);
	}
	const reasonless = scopePin.outOfScope.findIndex((x) => x.reason.length === 0);
	if (reasonless !== -1) return reject(`out-of-scope entry ${reasonless + 1} ("${scopePin.outOfScope[reasonless]?.item}") in ${scope5} (§5) carries no reason`);
	if (scopePin.expectedFiles.length === 0) {
		return reject(`${scope5}'s (§5) expected-files list is empty -- FLOW-05's declaration half requires at least one declared file`);
	}
	const badPath = scopePin.expectedFiles.findIndex((p) => !EXPECTED_FILE_PATTERN.test(p));
	if (badPath !== -1) {
		return reject(
			`expected-files entry ${badPath + 1} in ${scope5} (§5) is not a valid repo-relative path (no leading "/", no ".." segment, no glob) -- ` +
				`received ${JSON.stringify(scopePin.expectedFiles[badPath])}`,
		);
	}

	let rootCause: RootCause | undefined;
	if (options?.fixFramed ?? isFixFramed(goal)) {
		const heading = headings.find((h) => h.headingText.toLowerCase() === ROOT_CAUSE_HEADING.toLowerCase());
		rootCause = heading === undefined ? undefined : parseRootCause(heading.body);
		const defect = rootCauseDefect(rootCause);
		if (defect !== undefined) return reject(defect);
	}

	const spec: SpecArtifact = {
		goal,
		verifiedFacts: parseVerifiedFacts(body(VERIFIED_FACTS_SECTION)),
		requirementsBody: body(REQUIREMENTS_SECTION).trim(),
		errorBehaviours,
		scopePin,
		clarificationsBody: body(CLARIFICATIONS_SECTION).trim(),
		assumptionsBody: body(ASSUMPTIONS_SECTION).trim(),
		scorecardBody: body(SCORECARD_SECTION).trim(),
		...(rootCause !== undefined ? { rootCause } : {}),
	};
	return { ok: true, spec };
}

/** Renders a validated SpecArtifact as SPEC.md. No trailer after the last section: it would parse back into that section's body, so a re-render would change the file. */
export function renderSpecMarkdown(spec: SpecArtifact): string {
	const heading = (s: SpecSectionDescriptor): string => `## ${s.ordinal}. ${s.heading}`;
	const bullets = (items: readonly string[]): string[] => items.map((item) => `- ${item}`);
	const rootCause = spec.rootCause === undefined ? [] : [`## ${ROOT_CAUSE_HEADING}`, "", `**Cause:** ${spec.rootCause.cause}`, "", `**Why not the symptom:** ${spec.rootCause.whyNotSymptom}`, ""];
	return [
		"# SPEC", "",
		heading(GOAL_SECTION), "", spec.goal, "",
		heading(VERIFIED_FACTS_SECTION), "", "| Claim | Evidence | How Verified |", "| --- | --- | --- |",
		...spec.verifiedFacts.map((f) => `| ${f.claim} | ${f.evidence} | ${f.howVerified} |`), "",
		heading(REQUIREMENTS_SECTION), "", spec.requirementsBody, "",
		heading(ERROR_BEHAVIOUR_SECTION), "", ...bullets(spec.errorBehaviours), "",
		heading(SCOPE_PIN_SECTION), "",
		"**In scope:**", "", ...bullets(spec.scopePin.inScope), "",
		"**Out of scope:**", "", ...bullets(spec.scopePin.outOfScope.map((x) => `${x.item}${OUT_OF_SCOPE_SEPARATOR}${x.reason}`)), "",
		"**Expected files:**", "", ...bullets(spec.scopePin.expectedFiles), "",
		heading(CLARIFICATIONS_SECTION), "", spec.clarificationsBody, "",
		heading(ASSUMPTIONS_SECTION), "", spec.assumptionsBody, "",
		heading(SCORECARD_SECTION), "", spec.scorecardBody, "",
		...rootCause,
	].join("\n");
}
