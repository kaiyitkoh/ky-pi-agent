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
const VALID_SEVERITIES = new Set(["BLOCKER", "WARNING", "NIT"]);
const VALID_CLASSIFICATIONS = new Set(["root-cause", "symptomatic", "workaround"]);

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
	if (value === undefined) {
		return "undefined";
	}
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	return typeof value;
}

function describeValue(value: unknown): string {
	if (value === undefined) {
		return "undefined (absent)";
	}
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
	if (!isPlainObject(raw)) {
		return {
			ok: false,
			reason: `submit_review arguments must be an object, received ${describeType(raw)} (${describeValue(raw)})`,
		};
	}

	// Drift is computed from git; a model-supplied value would be a verdict on its own work, and ignoring it would hide the attempt.
	const driftKey = Object.keys(raw).find((k) => /drift/i.test(k));
	if (driftKey !== undefined) {
		return {
			ok: false,
			reason: `submit_review must not carry "${driftKey}": scope drift is computed from git by the harness, not reported by the reviewer`,
		};
	}

	const { verdicts, findings, checkedAndCleared, classification, classificationJustification, properFix, deferralReason } = raw;

	if (!Array.isArray(verdicts)) {
		return {
			ok: false,
			reason: `submit_review.verdicts must be an array, received ${describeType(verdicts)}`,
		};
	}
	if (!Array.isArray(findings)) {
		return {
			ok: false,
			reason: `submit_review.findings must be an array, received ${describeType(findings)}`,
		};
	}

	for (let i = 0; i < findings.length; i++) {
		const finding = findings[i];
		const severity = isPlainObject(finding) ? finding.severity : undefined;
		if (typeof severity !== "string" || !VALID_SEVERITIES.has(severity)) {
			return {
				ok: false,
				reason:
					`findings[${i}].severity must be exactly one of BLOCKER, WARNING, or NIT -- ` +
					`received ${describeValue(severity)}`,
			};
		}
	}

	for (let i = 0; i < verdicts.length; i++) {
		const status = isPlainObject(verdicts[i]) ? (verdicts[i] as Record<string, unknown>).status : undefined;
		if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
			return {
				ok: false,
				reason: `verdicts[${i}].status must be exactly one of Implemented, Partial, or Missing -- received ${describeValue(status)}`,
			};
		}
	}

	const verdictRequirementIds = verdicts.map((v) => (isPlainObject(v) && typeof v.requirementId === "string" ? v.requirementId : ""));
	const coveredIds = new Set(verdictRequirementIds);
	const expectedSet = new Set(expectedRequirementIds);

	const missingIds = expectedRequirementIds.filter((id) => !coveredIds.has(id));
	if (missingIds.length > 0) {
		return {
			ok: false,
			reason:
				`submit_review is missing a verdict for stated requirement id(s): ${missingIds.join(", ")} -- ` +
				"every stated requirement needs exactly one verdict",
		};
	}

	const inventedIds = verdictRequirementIds.filter((id, index, all) => id.length > 0 && !expectedSet.has(id) && all.indexOf(id) === index);
	if (inventedIds.length > 0) {
		return {
			ok: false,
			reason:
				`submit_review carries a verdict for requirement id(s) not among the stated requirements: ${inventedIds.join(", ")} -- ` +
				"inventing a requirement id is the same failure as omitting one",
		};
	}

	const duplicateIds = verdictRequirementIds.filter((id, i, all) => id.length > 0 && all.indexOf(id) !== i);
	if (duplicateIds.length > 0) {
		return {
			ok: false,
			reason:
				`submit_review carries more than one verdict for requirement id(s): ${[...new Set(duplicateIds)].join(", ")} -- ` +
				"every stated requirement needs exactly ONE verdict; two verdicts for one id is not a review, it is two",
		};
	}

	for (let i = 0; i < verdicts.length; i++) {
		const verdict = verdicts[i];
		const requirementId = isPlainObject(verdict) && typeof verdict.requirementId === "string" ? verdict.requirementId : `verdicts[${i}]`;
		const evidence = isPlainObject(verdict) && typeof verdict.evidence === "string" ? verdict.evidence : "";
		if (!isFileLine(evidence)) {
			return {
				ok: false,
				reason:
					`verdict for requirement "${requirementId}" has a malformed evidence string -- expected a ` +
					`"path:line" or "path:start-end" shape, received ${describeValue(evidence)}`,
			};
		}
	}

	if (!isNonEmptyString(checkedAndCleared)) {
		return {
			ok: false,
			reason:
				"checkedAndCleared must be a non-empty, non-whitespace-only string describing what was examined " +
				`and found fine -- received ${describeValue(checkedAndCleared)}`,
		};
	}

	if (typeof classification !== "string" || !VALID_CLASSIFICATIONS.has(classification)) {
		return {
			ok: false,
			reason:
				"classification must be exactly one of root-cause, symptomatic, or workaround -- " +
				`received ${describeValue(classification)}`,
		};
	}
	if (!isNonEmptyString(classificationJustification)) {
		return {
			ok: false,
			reason:
				`classificationJustification must be a non-empty string explaining the "${classification}" ` +
				`classification -- received ${describeValue(classificationJustification)}`,
		};
	}

	if (classification === "workaround") {
		const missingWorkaroundFields: string[] = [];
		if (!isNonEmptyString(properFix)) {
			missingWorkaroundFields.push("properFix");
		}
		if (!isNonEmptyString(deferralReason)) {
			missingWorkaroundFields.push("deferralReason");
		}
		if (missingWorkaroundFields.length > 0) {
			return {
				ok: false,
				reason:
					`classification "workaround" requires a non-empty properFix and deferralReason -- ` +
					`missing: ${missingWorkaroundFields.join(", ")}`,
			};
		}
	}

	const nitCount = findings.filter((f) => isPlainObject(f) && f.severity === "NIT").length;
	if (nitCount > NIT_CAP) {
		return {
			ok: false,
			reason: `submit_review carries ${nitCount} NIT findings, exceeding the cap of ${NIT_CAP} -- NITs are capped because a reviewer told to find gaps invents them`,
		};
	}

	// status is cast, not defaulted: branch (2b) already rejected anything outside VALID_STATUSES.
	const normalisedVerdicts: ReviewVerdict[] = verdicts.map((v) => {
		const obj = v as Record<string, unknown>;
		return {
			requirementId: String(obj.requirementId ?? ""),
			status: obj.status as ReviewVerdict["status"],
			evidence: String(obj.evidence ?? ""),
		};
	});

	const normalisedFindings: ReviewFinding[] = findings.map((f) => {
		const obj = f as Record<string, unknown>;
		return {
			severity: obj.severity as ReviewFinding["severity"],
			location: String(obj.location ?? ""),
			concreteFailure: String(obj.concreteFailure ?? ""),
			suggestedFix: String(obj.suggestedFix ?? ""),
		};
	});

	const review: ReviewArtifact = {
		verdicts: normalisedVerdicts,
		findings: normalisedFindings,
		checkedAndCleared,
		classification: classification as ReviewArtifact["classification"],
		classificationJustification,
		...(isNonEmptyString(properFix) ? { properFix } : {}),
		...(isNonEmptyString(deferralReason) ? { deferralReason } : {}),
	};

	return { ok: true, review };
}

/** Takes only a validateReview-accepted artifact, so it does no shape validation. */
export function renderReviewMarkdown(review: ReviewArtifact): string {
	const lines: string[] = [];

	lines.push("# REVIEW");
	lines.push("");

	lines.push("## Verdicts");
	lines.push("");
	lines.push("| Requirement | Status | Evidence |");
	lines.push("| --- | --- | --- |");
	for (const verdict of review.verdicts) {
		lines.push(`| ${verdict.requirementId} | ${verdict.status} | ${verdict.evidence} |`);
	}
	lines.push("");

	lines.push("## Findings");
	lines.push("");
	if (review.findings.length === 0) {
		lines.push("None. See \"Checked and cleared\" below for what was actually examined.");
	} else {
		for (const finding of review.findings) {
			lines.push(`- **${finding.severity}** at \`${finding.location}\`: ${finding.concreteFailure}`);
			lines.push(`  - Suggested fix: ${finding.suggestedFix}`);
		}
	}
	lines.push("");

	lines.push("## Scope Drift");
	lines.push("");
	const drift = review.scopeDrift;
	if (drift === undefined) {
		lines.push("Scope drift NOT COMPUTED: no git diff was compared against the declared files.");
	} else {
		if (drift.drifted.length === 0 && drift.undelivered.length === 0) {
			lines.push(`No drift detected: ${drift.changed.length} changed file(s), all declared, all declared files changed.`);
		}
		if (drift.drifted.length > 0) {
			lines.push("Changed but not declared:");
			lines.push("");
			lines.push("| Path |");
			lines.push("| --- |");
			for (const path of drift.drifted) {
				lines.push(`| ${path} |`);
			}
			lines.push("");
		}
		if (drift.undelivered.length > 0) {
			lines.push("Declared but not changed:");
			lines.push("");
			lines.push("| Path |");
			lines.push("| --- |");
			for (const path of drift.undelivered) {
				lines.push(`| ${path} |`);
			}
		}
	}
	lines.push("");

	lines.push("## Design review");
	lines.push("");
	const design = review.designPass;
	if (design === undefined) {
		lines.push("No design-pass record was supplied.");
	} else {
		const signalText = Object.entries(design.signals).map(([k, v]) => `${k}=${String(v)}`).join(", ");
		lines.push(`${design.ran ? "Ran" : "Did not fire"}: ${design.note} (${signalText}).`);
	}
	lines.push("");

	lines.push("## Checked and cleared");
	lines.push("");
	lines.push(review.checkedAndCleared);
	lines.push("");

	lines.push("## Classification");
	lines.push("");
	lines.push(`**${review.classification}** -- ${review.classificationJustification}`);
	if (review.classification === "workaround") {
		lines.push("");
		lines.push(`- Proper fix: ${review.properFix ?? ""}`);
		lines.push(`- Deferred because: ${review.deferralReason ?? ""}`);
	}
	lines.push("");

	lines.push(
		"---",
	);
	lines.push("");
	lines.push(
		"*Evidence and location strings above are the reviewer's own claims, not verified facts -- see " +
			"`review-schema.ts`'s own \"WHAT THIS DOES NOT PROVE\" section. Scope drift compares path sets from git, not " +
			"whether a change inside a declared file was in scope.*",
	);
	lines.push("");

	return lines.join("\n");
}
