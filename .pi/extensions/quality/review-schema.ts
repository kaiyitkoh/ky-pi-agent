/**
 * GATE-03 / GATE-04 / GATE-05 / QUAL-04 / QUAL-06 — the REVIEW artifact's
 * shape and its validator.
 *
 * PURPOSE. These are PARSER requirements, not prompt requirements. If the
 * harness would accept "LGTM", the requirement is not met however good the
 * reviewer's system prompt is. The mechanism is a forced structured tool
 * call, `submit_review`, whose typebox schema {@link submitReviewParameters}
 * IS the REVIEW artifact's shape -- so Pi's own tool-call JSON-Schema
 * validation rejects a structurally wrong `severity` or `status` before this
 * module's own validator ever runs. {@link validateReview} then enforces
 * every CROSS-FIELD rule a JSON Schema cannot express: verdict coverage
 * against the requirement ids actually under review, a non-empty
 * "checked and cleared" section, and the workaround-implies-proper-fix rule.
 * Together the two layers make silence and vagueness structurally
 * impossible, not merely discouraged by wording.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS PURE
 * ---------------------------------------------------------------------------
 * It makes no model call, reads no file, and registers nothing with Pi. It
 * takes and returns plain data: a tool schema object, a validation function,
 * and a Markdown renderer. The caller -- a future gate-composition module,
 * not built in this plan -- owns handing the schema to `callModel()`'s
 * `tools` parameter, reading the model's tool-call arguments, and writing
 * `renderReviewMarkdown`'s output to disk.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing. It does not spell the tool-registration
 * call, in code or in prose -- `tests/unit/contributing-boundary.test.ts`
 * matches that call's name as a plain substring across every tracked source
 * under `.pi/extensions/`, comments included, and grants this directory no
 * exemption. `submitReviewParameters` is a schema object exported for a
 * FUTURE caller to pass through `callModel()`'s existing `tools?: Tool[]`
 * field (`diagnostics/call-model.ts`) -- the same field `routing/modes.ts`'s
 * `runSingleShotRole` will thread through, per `08-RESEARCH.md` Pattern 2.
 * Nothing in this file calls that field or any registration API itself.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT PROVE
 * ---------------------------------------------------------------------------
 * `evidence` (on a verdict) and `location` (on a finding) are `file:line`
 * strings THE MODEL WROTE. They are shape-validated by {@link validateReview}
 * -- matched against a `<path>:<digits>` pattern -- and nothing more. They
 * are NOT equivalent to `.pi/extensions/workflows/evidence.ts`'s GATE-07
 * evidence: that gate trusts only a structural `isError` boolean Pi's own
 * tool-execution machinery computes from a real process exit code, bound to
 * a git SHA the harness read itself, and it never trusts model-authored
 * text. A `file:line` string here could name a file that does not exist, a
 * line that says nothing of the sort, or a location nobody ever read. No
 * consumer of a validated {@link ReviewArtifact} may treat `evidence` or
 * `location` as a verified fact -- only as a reviewer's CLAIM about where to
 * look, exactly as `docs/WORKFLOWS.md` section 4 states plainly for GATE-07's
 * own ACCEPT verdict: overclaiming here is worse than underclaiming it.
 * [threat T-08-08]
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 *   The `submit_review` tool schema and description (below).
 *   The `ReviewArtifact` shape and its component types.
 *   `validateReview` -- the numbered, binding-order rejection predicate.
 *   `renderReviewMarkdown` -- the on-disk REVIEW.md rendering. WHERE that
 *   rendering lands inside an MR body is Phase 9's problem; this module only
 *   produces the record.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// The submit_review tool schema
// ---------------------------------------------------------------------------

/** The forced tool-call name. A reviewer that never calls this has reported nothing, by construction. */
export const SUBMIT_REVIEW_TOOL_NAME = "submit_review";

/**
 * First-class, model-facing statement of the contract, following
 * `qoder/index.ts`'s `QODER_DELEGATE_DESCRIPTION` discipline: full sentences,
 * because the model reads this and the user may never read `docs/`.
 *
 * States plainly that this is the ONLY sanctioned way to report findings and
 * that anything written outside this call -- prose in the assistant message,
 * a bare "LGTM", a summary paragraph -- is discarded by every downstream
 * consumer and carries no weight whatsoever.
 */
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

/**
 * `Type.Object` schema construction (unscoped `typebox`), matching
 * `qoder/index.ts:77-81`'s style. The three closed string enums below use
 * `StringEnum` from `@earendil-works/pi-ai`, matching `safety/index.ts:459`'s
 * `blast_radius` precedent -- CLAUDE.md's "What NOT to Use" table states
 * `Type.Union`/`Type.Literal` for a string enum breaks against Google's API.
 */
export const submitReviewParameters = Type.Object({
	verdicts: Type.Array(
		Type.Object({
			requirementId: Type.String({ description: "The requirement id this verdict is about, e.g. GATE-03." }),
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

// ---------------------------------------------------------------------------
// The REVIEW artifact shape
// ---------------------------------------------------------------------------

/** One requirement's verdict. Mirrors `submitReviewParameters.verdicts`'s element shape. */
export interface ReviewVerdict {
	readonly requirementId: string;
	readonly status: "Implemented" | "Partial" | "Missing";
	/** A `file:line` string the MODEL wrote. See this module's own "WHAT THIS DOES NOT PROVE" section. */
	readonly evidence: string;
}

/** One finding. Mirrors `submitReviewParameters.findings`'s element shape. */
export interface ReviewFinding {
	readonly severity: "BLOCKER" | "WARNING" | "NIT";
	/** A `file:line` string the MODEL wrote. See this module's own "WHAT THIS DOES NOT PROVE" section. */
	readonly location: string;
	readonly concreteFailure: string;
	readonly suggestedFix: string;
}

/**
 * The whole validated REVIEW artifact. Only ever produced by
 * {@link validateReview}'s accept arm -- there is no other constructor,
 * because a hand-built `ReviewArtifact` would bypass every rule this module
 * exists to enforce.
 */
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
}

/**
 * The NIT cap. Named, not inlined, per this repository's own `magic-number`
 * rule (`.pi/extensions/quality/rules.ts`) -- a bare `5` in branch (8) below
 * would be exactly the anti-pattern this project's own gate exists to catch.
 *
 * NITs are capped because a reviewer instructed to find gaps invents them --
 * this is the anti-review-theatre protocol's OTHER side (08-CONTEXT.md
 * decision 6: "two-sided by design"). An LLM reviewer either silently
 * approves when unsure, or, told explicitly to find something, pads its
 * findings with trivia to look thorough. The BLOCKER/WARNING path guards the
 * first failure mode; this cap guards the second. Five padded NITs are as
 * dishonest a signal as zero real ones.
 */
export const NIT_CAP = 5;

// ---------------------------------------------------------------------------
// validateReview -- the rejection engine
// ---------------------------------------------------------------------------

/**
 * Mirrors `routing/guard.ts`'s `GuardVerdict` and
 * `workflows/evidence.ts`'s `EvidenceVerdict`: deliberately two arms, never
 * three. A caller that receives `{ok: false, ...}` must surface `reason` and
 * stop; there is no partial-accept.
 */
export type ReviewValidation =
	| { readonly ok: true; readonly review: ReviewArtifact }
	| { readonly ok: false; readonly reason: string };

const VALID_STATUSES = new Set(["Implemented", "Partial", "Missing"]);
const VALID_SEVERITIES = new Set(["BLOCKER", "WARNING", "NIT"]);
const VALID_CLASSIFICATIONS = new Set(["root-cause", "symptomatic", "workaround"]);

/** `<anything>:<one or more digits>`, anchored both ends -- the whole string must be exactly this shape. */
const FILE_LINE_PATTERN = /^.+:\d+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The type name for a "received X" clause in a reject reason -- never the caller's own words. */
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

/** A human-legible rendering of an arbitrary received value, for reject reasons -- always built from the data itself. */
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
		// NEVER THROWS: JSON.stringify can throw on a circular structure; a
		// reject reason must still be constructible from whatever arrived.
		return describeType(value);
	}
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * The whole GATE-03/04/05/QUAL-04/QUAL-06 predicate. First-match-wins, in
 * `gateCompletion`'s (`workflows/evidence.ts:101-191`) exact numbered,
 * BINDING-ORDER docstring style. Every reject `reason` is built from the
 * RECEIVED data -- never from a caller-supplied string, so a rejection is
 * always actionable: it names what was expected and what arrived.
 *
 *   (1) `raw` is not a plain object, or `verdicts`/`findings` are not
 *       arrays -> reject as malformed, naming the type that arrived.
 *   (2) ANY finding whose `severity` is not exactly one of
 *       BLOCKER/WARNING/NIT (including absent, empty, lower-case, or an
 *       unknown token) -> REJECT AS MALFORMED, naming the offending index
 *       and the value that arrived. This is GATE-05, and it is code, not
 *       wording -- an unclassified finding is structurally impossible to
 *       let through.
 *   (2b) ANY verdict whose `status` is not exactly one of
 *       Implemented/Partial/Missing -> REJECT AS MALFORMED, naming the
 *       offending index and the value that arrived, mirroring (2)'s
 *       discipline for `severity`. WR-02: branch (9)'s normaliser used to
 *       fabricate `"Missing"` for a `status` it did not recognise (wrong
 *       case, an absent field, an unknown token) instead of rejecting --
 *       silently rewriting an unrecognised value into a verdict the
 *       reviewer never actually gave is the same "fabricate rather than
 *       report absence" failure this module's own omission rule forbids
 *       elsewhere.
 *   (3) `expectedRequirementIds` not fully covered by `verdicts` -> reject,
 *       naming the missing ids. A verdict naming a requirement id NOT in the
 *       expected set is also a reject, naming the extra id -- a reviewer
 *       inventing requirement ids is the same failure as omitting them.
 *   (3b) `verdicts` carries more than one verdict for the SAME requirement
 *       id -> reject, naming the duplicated id(s). WR-01: two verdicts for
 *       one id -- possibly contradictory -- is not a review, it is two, and
 *       a consumer reading `verdicts.find(v => v.requirementId === id)`
 *       would silently see only the first and never know a second existed.
 *   (4) ANY verdict whose `evidence` does not match a `file:line` shape
 *       (`<path>:<digits>`) -> reject, naming the verdict's requirement id
 *       and the string that arrived.
 *   (5) `checkedAndCleared` absent, empty, or whitespace-only -> reject.
 *       This is GATE-04: silence must be structurally impossible.
 *   (6) `classification` not exactly one of
 *       root-cause/symptomatic/workaround, or `classificationJustification`
 *       empty -> reject. This is QUAL-04.
 *   (7) `classification === "workaround"` and either `properFix` or
 *       `deferralReason` is absent or empty -> reject, naming which is
 *       missing. This is QUAL-06: an approved workaround is recorded with
 *       what the proper fix would be and why it was deferred, or it is not a
 *       valid review.
 *   (8) `findings.filter(f => f.severity === "NIT").length > NIT_CAP` ->
 *       reject, naming the count and the cap.
 *   (9) otherwise -> accept, carrying the normalised {@link ReviewArtifact}.
 *
 * A genuinely clean review -- zero findings, a non-empty
 * `checkedAndCleared` -- reaches branch (9) and ACCEPTS. This is deliberate:
 * a gate that cannot express "nothing was wrong" teaches the reviewer to
 * invent findings, which is the exact anti-review-theatre failure this
 * module exists to prevent on the OTHER side of the cap in branch (8).
 */
export function validateReview(raw: unknown, expectedRequirementIds: readonly string[]): ReviewValidation {
	// (1)
	if (!isPlainObject(raw)) {
		return {
			ok: false,
			reason: `submit_review arguments must be an object, received ${describeType(raw)} (${describeValue(raw)})`,
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

	// (2) GATE-05: an unclassified finding is rejected by code, not by wording.
	for (let i = 0; i < findings.length; i++) {
		const finding = findings[i];
		const severity = isPlainObject(finding) ? finding.severity : undefined;
		if (typeof severity !== "string" || !VALID_SEVERITIES.has(severity)) {
			return {
				ok: false,
				reason:
					`findings[${i}].severity must be exactly one of BLOCKER, WARNING, or NIT (GATE-05) -- ` +
					`received ${describeValue(severity)}`,
			};
		}
	}

	// (2b) WR-02: an unrecognised verdict status is malformed, exactly like an unclassified finding -- never silently coerced.
	for (let i = 0; i < verdicts.length; i++) {
		const status = isPlainObject(verdicts[i]) ? (verdicts[i] as Record<string, unknown>).status : undefined;
		if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
			return {
				ok: false,
				reason: `verdicts[${i}].status must be exactly one of Implemented, Partial, or Missing -- received ${describeValue(status)}`,
			};
		}
	}

	// (3) verdict coverage against expectedRequirementIds, in both directions.
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

	// (3b) WR-01: exactly one verdict per requirement id -- a duplicate (even a contradictory one) is not a review, it is two.
	const duplicateIds = verdictRequirementIds.filter((id, i, all) => id.length > 0 && all.indexOf(id) !== i);
	if (duplicateIds.length > 0) {
		return {
			ok: false,
			reason:
				`submit_review carries more than one verdict for requirement id(s): ${[...new Set(duplicateIds)].join(", ")} -- ` +
				"every stated requirement needs exactly ONE verdict; two verdicts for one id is not a review, it is two",
		};
	}

	// (4) evidence must be a file:line-shaped string, per verdict.
	for (let i = 0; i < verdicts.length; i++) {
		const verdict = verdicts[i];
		const requirementId = isPlainObject(verdict) && typeof verdict.requirementId === "string" ? verdict.requirementId : `verdicts[${i}]`;
		const evidence = isPlainObject(verdict) && typeof verdict.evidence === "string" ? verdict.evidence : "";
		if (!FILE_LINE_PATTERN.test(evidence)) {
			return {
				ok: false,
				reason:
					`verdict for requirement "${requirementId}" has a malformed evidence string -- expected a ` +
					`"path:line" shape (<path>:<digits>), received ${describeValue(evidence)}`,
			};
		}
	}

	// (5) GATE-04: silence must be structurally impossible.
	if (!isNonEmptyString(checkedAndCleared)) {
		return {
			ok: false,
			reason:
				"checkedAndCleared must be a non-empty, non-whitespace-only string describing what was examined " +
				`and found fine (GATE-04) -- received ${describeValue(checkedAndCleared)}`,
		};
	}

	// (6) QUAL-04.
	if (typeof classification !== "string" || !VALID_CLASSIFICATIONS.has(classification)) {
		return {
			ok: false,
			reason:
				"classification must be exactly one of root-cause, symptomatic, or workaround (QUAL-04) -- " +
				`received ${describeValue(classification)}`,
		};
	}
	if (!isNonEmptyString(classificationJustification)) {
		return {
			ok: false,
			reason:
				`classificationJustification must be a non-empty string explaining the "${classification}" ` +
				`classification (QUAL-04) -- received ${describeValue(classificationJustification)}`,
		};
	}

	// (7) QUAL-06: an approved workaround is recorded with what the proper fix would be and why it was deferred.
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
					`classification "workaround" requires a non-empty properFix and deferralReason (QUAL-06) -- ` +
					`missing: ${missingWorkaroundFields.join(", ")}`,
			};
		}
	}

	// (8) the NIT cap -- see NIT_CAP's own docstring for why this exists.
	const nitCount = findings.filter((f) => isPlainObject(f) && f.severity === "NIT").length;
	if (nitCount > NIT_CAP) {
		return {
			ok: false,
			reason: `submit_review carries ${nitCount} NIT findings, exceeding the cap of ${NIT_CAP} -- NITs are capped because a reviewer told to find gaps invents them`,
		};
	}

	// (9) accept -- normalise into the validated ReviewArtifact shape. `status` is
	// cast, never defaulted: branch (2b) above already rejected anything not in
	// VALID_STATUSES, so no fallback-to-"Missing" is reachable here (WR-02).
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

// ---------------------------------------------------------------------------
// renderReviewMarkdown -- the on-disk REVIEW.md rendering
// ---------------------------------------------------------------------------

/**
 * Renders a validated {@link ReviewArtifact} as the on-disk `REVIEW.md`
 * shape. WHERE this rendering is folded into an MR body is Phase 9's
 * problem -- this module produces the record, nothing more, matching
 * `workflows/evidence.ts`'s own layering discipline (this module owns
 * production of a record; a later phase owns where it is displayed).
 *
 * Only ever called with a {@link ReviewArtifact} that already came out of
 * {@link validateReview}'s accept arm -- there is no independent shape
 * validation here, because there is no other legitimate constructor for a
 * `ReviewArtifact` in this codebase.
 */
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
			"`review-schema.ts`'s own \"WHAT THIS DOES NOT PROVE\" section.*",
	);
	lines.push("");

	return lines.join("\n");
}
