/**
 * The submit_review tool schema, the ReviewArtifact shape, validateReview and the REVIEW.md renderer. Pure: no model call, no file read, registers nothing.
 * Do not spell the tool-registration call here (contributing-boundary.test.ts scans comments).
 * WHAT THIS DOES NOT PROVE: `evidence` and `location` are model-written file:line strings, shape-checked only; treat them as claims, never verified facts (docs/WORKFLOWS.md section 4).
 */
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

/** The forced tool-call name. A reviewer that never calls this has reported nothing, by construction. */
export const SUBMIT_REVIEW_TOOL_NAME = "submit_review";

/** Model-facing contract: submit_review is the only sanctioned way to report; prose outside the call is discarded. */
export const SUBMIT_REVIEW_DESCRIPTION =
	"Submit your completed code review. This is the ONLY way to report findings -- any prose you write " +
	"outside this call, in your ordinary assistant message, is discarded and carries no weight with any " +
	"downstream consumer. You must call this exactly once, with every field filled honestly. " +
	"'checkedAndCleared' must describe what you actually examined and found fine; it may never be empty, " +
	"because a silent reviewer is indistinguishable from an absent one. Every finding needs a severity of " +
	"exactly BLOCKER, WARNING, or NIT -- an unclassified finding is rejected before anyone reads it. Every " +
	"stated requirement needs exactly one verdict, with file:line evidence for where you checked. Classify " +
	"the change itself as root-cause, symptomatic, or workaround, with your reasoning; a workaround " +
	"classification requires stating what the proper fix would be and why it was deferred instead.";

/** Closed enums use `StringEnum`, not `Type.Union`/`Type.Literal`, which break against Google's API. */
export const submitReviewParameters = Type.Object({
	verdicts: Type.Array(
		Type.Object({
			requirementId: Type.String({ description: "The requirement id this verdict is about, e.g. R1." }),
			status: StringEnum(["Implemented", "Partial", "Missing"], {
				description: "Your honest verdict for this requirement, based only on what you actually checked.",
			}),
			evidence: Type.String({ description: "file:line -- where you looked to reach this verdict." }),
		}),
	),
	findings: Type.Array(
		Type.Object({
			severity: StringEnum(["BLOCKER", "WARNING", "NIT"], {
				description: "BLOCKER stops the workflow. WARNING does not. NIT is capped -- do not invent NITs to look thorough.",
			}),
			location: Type.String({ description: "file:line -- where the finding is." }),
			concreteFailure: Type.String({ description: "What is actually wrong, concretely -- not a vague concern." }),
			suggestedFix: Type.String({ description: "What you would change to fix it." }),
		}),
	),
	checkedAndCleared: Type.String({
		description: "What was examined and found fine. Never empty -- a silent reviewer is an absent one.",
	}),
	classification: StringEnum(["root-cause", "symptomatic", "workaround"], {
		description: "Is this change a root-cause fix, a symptomatic patch, or a workaround? Be honest.",
	}),
	classificationJustification: Type.String({
		description: "Why you classified the change the way you did.",
	}),
	properFix: Type.Optional(
		Type.String({
			description: "Required when classification is workaround: what the proper fix would be.",
		}),
	),
	deferralReason: Type.Optional(
		Type.String({
			description: "Required when classification is workaround: why the proper fix was deferred instead.",
		}),
	),
});

export interface ReviewVerdict {
	readonly requirementId: string;
	readonly status: "Implemented" | "Partial" | "Missing";
	/** A `file:line` string the MODEL wrote. See this module's own "WHAT THIS DOES NOT PROVE" section. */
	readonly evidence: string;
}

export interface ReviewFinding {
	readonly severity: "BLOCKER" | "WARNING" | "NIT";
	/** A `file:line` string the MODEL wrote. See this module's own "WHAT THIS DOES NOT PROVE" section. */
	readonly location: string;
	readonly concreteFailure: string;
	readonly suggestedFix: string;
}

/** Only produced by validateReview's accept arm; a hand-built artifact would bypass every rule. */
export interface ReviewArtifact {
	readonly verdicts: readonly ReviewVerdict[];
	readonly findings: readonly ReviewFinding[];
	readonly checkedAndCleared: string;
	readonly classification: "root-cause" | "symptomatic" | "workaround";
	readonly classificationJustification: string;
	/** Present only when `classification === "workaround"` -- see branch (7) of {@link validateReview}. */
	readonly properFix?: string;
	/** Present only when `classification === "workaround"` -- see branch (7) of {@link validateReview}. */
	readonly deferralReason?: string;
	/** Computed from git by the caller and never taken from the model's arguments. */
	readonly scopeDrift?: ScopeDriftReport;
	/** Set by the caller after the optional design-level pass; findings it added are already in `findings`. */
	readonly designPass?: DesignPassReport;
}

export interface DesignPassReport {
	readonly ran: boolean;
	readonly note: string;
	readonly signals: object;
}

// Declared structurally so quality/ does not import the review/ module and its git-reading dependency chain.
export interface ScopeDriftReport {
	readonly declared: readonly string[];
	readonly changed: readonly string[];
	readonly drifted: readonly string[];
	readonly undelivered: readonly string[];
}

/** Cap on NIT findings: a reviewer told to find gaps pads with trivia, so over-reporting is rejected as well as under-reporting. */
export const NIT_CAP = 5;

/** Two arms by design, no partial accept: the caller surfaces `reason` and stops. */
export type ReviewValidation =
	| { readonly ok: true; readonly review: ReviewArtifact }
	| { readonly ok: false; readonly reason: string };

const VALID_STATUSES = new Set(["Implemented", "Partial", "Missing"]);
export const SEVERITIES: ReadonlySet<string> = new Set(["BLOCKER", "WARNING", "NIT"]);
const VALID_CLASSIFICATIONS = new Set(["root-cause", "symptomatic", "workaround"]);

const reject = (reason: string): ReviewValidation => ({ ok: false, reason });

const FILE_LINE_PATTERN = /^.+:(\d+)(?:-(\d+))?$/;

/** `path:N` or `path:N-M` with M >= N. */
export function isFileLine(value: string): boolean {
	const match = FILE_LINE_PATTERN.exec(value);
	if (match === null) return false;
	return match[2] === undefined || Number(match[2]) >= Number(match[1]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
	return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function describeValue(value: unknown): string {
	if (value === undefined) return "undefined (absent)";
	if (typeof value === "string") {
		return value.trim().length === 0 ? `${JSON.stringify(value)} (empty or whitespace-only)` : JSON.stringify(value);
	}
	try {
		return `${describeType(value)} ${JSON.stringify(value)}`;
	} catch {
		// NEVER THROWS: JSON.stringify can throw on a circular structure, and a reject reason must still be constructible.
		return describeType(value);
	}
}

function isMember(set: ReadonlySet<string>, value: unknown): value is string {
	return typeof value === "string" && set.has(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * First match wins, in this binding order; every reject reason is built from the received data.
 *   (1) not a plain object, or verdicts/findings not arrays.
 *   (2) a finding severity outside BLOCKER/WARNING/NIT: an unclassified finding cannot pass.
 *   (2b) a verdict status outside Implemented/Partial/Missing: rejected, never coerced to "Missing".
 *   (3) expected requirement ids not all covered, or a verdict for an id not expected.
 *   (3b) more than one verdict for the same requirement id.
 *   (4) a verdict whose evidence is not `<path>:<digits>`.
 *   (5) checkedAndCleared empty or whitespace-only: silence must be impossible.
 *   (6) classification not root-cause/symptomatic/workaround, or justification empty.
 *   (7) workaround without both properFix and deferralReason.
 *   (8) more than NIT_CAP NIT findings.
 *   (9) accept. A review with zero findings and a non-empty checkedAndCleared passes, so the reviewer is never pushed to invent findings.
 */
export function validateReview(raw: unknown, expectedRequirementIds: readonly string[]): ReviewValidation {
	if (!isPlainObject(raw)) return reject(`submit_review arguments must be an object, received ${describeType(raw)} (${describeValue(raw)})`);

	// Drift is computed from git; a model-supplied value would be a verdict on its own work, and ignoring it would hide the attempt.
	const driftKey = Object.keys(raw).find((k) => /drift/i.test(k));
	if (driftKey !== undefined) {
		return reject(`submit_review must not carry "${driftKey}": scope drift is computed from git by the harness, not reported by the reviewer`);
	}

	const { verdicts, findings, checkedAndCleared, classification, classificationJustification, properFix, deferralReason } = raw;
	if (!Array.isArray(verdicts)) return reject(`submit_review.verdicts must be an array, received ${describeType(verdicts)}`);
	if (!Array.isArray(findings)) return reject(`submit_review.findings must be an array, received ${describeType(findings)}`);
	const field = (item: unknown, key: string): unknown => (isPlainObject(item) ? item[key] : undefined);

	const badSeverity = findings.findIndex((f) => !isMember(SEVERITIES, field(f, "severity")));
	if (badSeverity !== -1) {
		return reject(`findings[${badSeverity}].severity must be exactly one of BLOCKER, WARNING, or NIT -- received ${describeValue(field(findings[badSeverity], "severity"))}`);
	}
	const badStatus = verdicts.findIndex((v) => !isMember(VALID_STATUSES, field(v, "status")));
	if (badStatus !== -1) {
		return reject(`verdicts[${badStatus}].status must be exactly one of Implemented, Partial, or Missing -- received ${describeValue(field(verdicts[badStatus], "status"))}`);
	}

	const ids = verdicts.map((v) => { const id = field(v, "requirementId"); return typeof id === "string" ? id : ""; });
	const covered = new Set(ids);
	const expected = new Set(expectedRequirementIds);
	const missingIds = expectedRequirementIds.filter((id) => !covered.has(id));
	if (missingIds.length > 0) {
		return reject(`submit_review is missing a verdict for stated requirement id(s): ${missingIds.join(", ")} -- every stated requirement needs exactly one verdict`);
	}
	const inventedIds = [...covered].filter((id) => id.length > 0 && !expected.has(id));
	if (inventedIds.length > 0) {
		return reject(
			`submit_review carries a verdict for requirement id(s) not among the stated requirements: ${inventedIds.join(", ")} -- ` +
				"inventing a requirement id is the same failure as omitting one",
		);
	}
	const duplicateIds = new Set(ids.filter((id, i) => id.length > 0 && ids.indexOf(id) !== i));
	if (duplicateIds.size > 0) {
		return reject(
			`submit_review carries more than one verdict for requirement id(s): ${[...duplicateIds].join(", ")} -- ` +
				"every stated requirement needs exactly ONE verdict; two verdicts for one id is not a review, it is two",
		);
	}

	for (const [i, verdict] of verdicts.entries()) {
		const evidence = field(verdict, "evidence");
		if (typeof evidence !== "string" || !isFileLine(evidence)) {
			const requirementId = typeof field(verdict, "requirementId") === "string" ? ids[i] : `verdicts[${i}]`;
			return reject(
				`verdict for requirement "${requirementId}" has a malformed evidence string -- expected a ` +
					`"path:line" or "path:start-end" shape, received ${describeValue(typeof evidence === "string" ? evidence : "")}`,
			);
		}
	}

	if (!isNonEmptyString(checkedAndCleared)) {
		return reject(
			"checkedAndCleared must be a non-empty, non-whitespace-only string describing what was examined " +
				`and found fine -- received ${describeValue(checkedAndCleared)}`,
		);
	}
	if (!isMember(VALID_CLASSIFICATIONS, classification)) {
		return reject(`classification must be exactly one of root-cause, symptomatic, or workaround -- received ${describeValue(classification)}`);
	}
	if (!isNonEmptyString(classificationJustification)) {
		return reject(
			`classificationJustification must be a non-empty string explaining the "${classification}" ` +
				`classification -- received ${describeValue(classificationJustification)}`,
		);
	}
	if (classification === "workaround") {
		const missing = [["properFix", properFix], ["deferralReason", deferralReason]].filter(([, v]) => !isNonEmptyString(v)).map(([k]) => k);
		if (missing.length > 0) return reject(`classification "workaround" requires a non-empty properFix and deferralReason -- missing: ${missing.join(", ")}`);
	}

	const nitCount = findings.filter((f) => field(f, "severity") === "NIT").length;
	if (nitCount > NIT_CAP) {
		return reject(`submit_review carries ${nitCount} NIT findings, exceeding the cap of ${NIT_CAP} -- NITs are capped because a reviewer told to find gaps invents them`);
	}

	const text = (item: unknown, key: string): string => String(field(item, key) ?? "");
	// Enum fields are cast, not defaulted: the checks above already rejected anything outside their sets.
	return {
		ok: true,
		review: {
			verdicts: verdicts.map((v) => ({ requirementId: text(v, "requirementId"), status: field(v, "status") as ReviewVerdict["status"], evidence: text(v, "evidence") })),
			findings: findings.map((f) => ({
				severity: field(f, "severity") as ReviewFinding["severity"],
				location: text(f, "location"),
				concreteFailure: text(f, "concreteFailure"),
				suggestedFix: text(f, "suggestedFix"),
			})),
			checkedAndCleared,
			classification: classification as ReviewArtifact["classification"],
			classificationJustification,
			...(isNonEmptyString(properFix) ? { properFix } : {}),
			...(isNonEmptyString(deferralReason) ? { deferralReason } : {}),
		},
	};
}

function pathTable(title: string, paths: readonly string[]): string[] {
	return paths.length === 0 ? [] : [title, "", "| Path |", "| --- |", ...paths.map((p) => `| ${p} |`), ""];
}

function driftLines(drift: ScopeDriftReport | undefined): string[] {
	if (drift === undefined) return ["Scope drift NOT COMPUTED: no git diff was compared against the declared files."];
	const clean = drift.drifted.length === 0 && drift.undelivered.length === 0;
	const table = [...pathTable("Changed but not declared:", drift.drifted), ...pathTable("Declared but not changed:", drift.undelivered)];
	if (drift.undelivered.length > 0) table.pop();
	return clean ? [`No drift detected: ${drift.changed.length} changed file(s), all declared, all declared files changed.`] : table;
}

/** Takes only a validateReview-accepted artifact, so it does no shape validation. */
export function renderReviewMarkdown(review: ReviewArtifact): string {
	const design = review.designPass;
	const designLine =
		design === undefined
			? "No design-pass record was supplied."
			: `${design.ran ? "Ran" : "Did not fire"}: ${design.note} (${Object.entries(design.signals).map(([k, v]) => `${k}=${String(v)}`).join(", ")}).`;
	const findings =
		review.findings.length === 0
			? ['None. See "Checked and cleared" below for what was actually examined.']
			: review.findings.flatMap((f) => [`- **${f.severity}** at \`${f.location}\`: ${f.concreteFailure}`, `  - Suggested fix: ${f.suggestedFix}`]);
	const workaround = review.classification === "workaround" ? ["", `- Proper fix: ${review.properFix ?? ""}`, `- Deferred because: ${review.deferralReason ?? ""}`] : [];
	return [
		"# REVIEW",
		"",
		"## Verdicts",
		"",
		"| Requirement | Status | Evidence |",
		"| --- | --- | --- |",
		...review.verdicts.map((v) => `| ${v.requirementId} | ${v.status} | ${v.evidence} |`),
		"",
		"## Findings",
		"",
		...findings,
		"",
		"## Scope Drift",
		"",
		...driftLines(review.scopeDrift),
		"",
		"## Design review",
		"",
		designLine,
		"",
		"## Checked and cleared",
		"",
		review.checkedAndCleared,
		"",
		"## Classification",
		"",
		`**${review.classification}** -- ${review.classificationJustification}`,
		...workaround,
		"",
		"---",
		"",
		"*Evidence and location strings above are the reviewer's own claims, not verified facts -- see " +
			"`review-schema.ts`'s own \"WHAT THIS DOES NOT PROVE\" section. Scope drift compares path sets from git, not " +
			"whether a change inside a declared file was in scope.*",
		"",
	].join("\n");
}
