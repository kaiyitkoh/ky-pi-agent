import { describe, expect, it } from "vitest";

import {
	renderReviewMarkdown,
	submitReviewParameters,
	validateReview,
	type ReviewArtifact,
} from "../../.pi/extensions/quality/review-schema.ts";

const IDS = ["FLOW-05"];

function payload(): Record<string, unknown> {
	return {
		verdicts: [{ requirementId: "FLOW-05", status: "Implemented", evidence: "src/a.ts:1" }],
		findings: [],
		checkedAndCleared: "Checked the diff comparison paths.",
		classification: "root-cause",
		classificationJustification: "Addresses the cause.",
	};
}

function artifact(extra: Partial<ReviewArtifact> = {}): ReviewArtifact {
	const result = validateReview(payload(), IDS);
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return { ...result.review, ...extra };
}

const DRIFTED = { declared: ["a.ts"], changed: ["a.ts", "rogue.ts"], drifted: ["rogue.ts"], undelivered: [] };
const CLEAN = { declared: ["a.ts"], changed: ["a.ts"], drifted: [], undelivered: [] };

describe("REVIEW.md Scope Drift section", () => {
	it("lists drifted paths, third after Findings", () => {
		const md = renderReviewMarkdown(artifact({ scopeDrift: DRIFTED }));
		expect(md).toContain("| rogue.ts |");
		const order = ["## Verdicts", "## Findings", "## Scope Drift", "## Checked and cleared"].map((h) => md.indexOf(h));
		expect(order.every((i) => i >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	it("renders a distinct no-drift line when clean", () => {
		expect(renderReviewMarkdown(artifact({ scopeDrift: CLEAN }))).toContain("No drift detected");
	});

	it("renders a different NOT COMPUTED line when absent", () => {
		const clean = renderReviewMarkdown(artifact({ scopeDrift: CLEAN }));
		const absent = renderReviewMarkdown(artifact());
		expect(absent).toContain("NOT COMPUTED");
		expect(absent).not.toContain("No drift detected");
		expect(clean).not.toContain("NOT COMPUTED");
	});
});

describe("the model cannot supply drift", () => {
	it("validateReview rejects a scope drift property, naming it", () => {
		const result = validateReview({ ...payload(), scopeDrift: { drifted: [] } }, IDS);
		expect(result.ok).toBe(false);
		expect((result as { reason: string }).reason).toContain("scopeDrift");
	});

	it("submitReviewParameters has no drift property", () => {
		expect(Object.keys(submitReviewParameters.properties).filter((k) => /drift/i.test(k))).toEqual([]);
	});
});
