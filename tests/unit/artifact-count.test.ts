import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { writeSpecIfGated } from "../../.pi/extensions/grill/index.ts";
import { SPEC_SECTIONS, renderSpecMarkdown, type SpecArtifact } from "../../.pi/extensions/grill/spec-schema.ts";
import { appendProgress, renderProgressAppend } from "../../.pi/extensions/execute/progress.ts";
import { writePlanIfGated } from "../../.pi/extensions/plan-ceremony/index.ts";
import { renderReviewMarkdown, validateReview } from "../../.pi/extensions/quality/review-schema.ts";
import { ARTIFACT_FILES, workDir } from "../../.pi/lib/work-artifacts.ts";
import { repoRoot } from "../helpers/git.ts";

const SLUG = "artifact-probe";
const REPO_WORK = join(repoRoot(), ".pi", "work");

const SPEC: SpecArtifact = {
	goal: "Add refresh-token rotation to the session store.",
	verifiedFacts: [{ claim: "the session store lives here", evidence: ".pi/lib/work-artifacts.ts:131", howVerified: "read the file" }],
	requirementsBody: "R1: rotate refresh tokens on use.\n\nR2: expire tokens after 30 days.",
	errorBehaviours: [
		"IF a token is reused THEN THE SYSTEM SHALL reject the request",
		"IF the store is unreachable THEN THE SYSTEM SHALL fail closed",
		"IF a token expires THEN THE SYSTEM SHALL require re-authentication",
	],
	scopePin: {
		inScope: ["token rotation"],
		outOfScope: [{ item: "password reset", reason: "unrelated to token rotation" }],
		expectedFiles: ["src/auth/session.ts"],
	},
	clarificationsBody: "- Q: none -> A: none",
	assumptionsBody: "none",
	scorecardBody: [
		"| factual-grounding | 0.9 |",
		"| requirement-precision | 0.9 |",
		"| failure-coverage | 0.9 |",
		"| scope-definiteness | 0.9 |",
		"Overall: 0.1",
	].join("\n"),
};

const PLAN = [
	"# PLAN",
	"",
	"- [ ] T001 [R1] edit src/auth/session.ts | verify: npm test",
	"- [ ] T002 [R2] edit src/auth/session.ts | verify: npm test",
	"",
].join("\n");

const progressEntry = (taskId: string, output: string) => ({
	taskId,
	commitSha: "abc1234",
	verificationCommand: "npm test",
	output,
	exitCode: 0,
	recordedAt: Date.UTC(2026, 9, 13),
});

/** Every file and directory under `dir`, relative and forward-slashed. */
function listRecursive(dir: string): { files: string[]; dirs: string[] } {
	const files: string[] = [];
	const dirs: string[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			const rel = relative(dir, full).replace(/\\/g, "/");
			if (entry.isDirectory()) {
				dirs.push(rel);
				walk(full);
			} else {
				files.push(rel);
			}
		}
	};
	walk(dir);
	return { files: files.sort(), dirs: dirs.sort() };
}

/** Throws unless `dir` holds exactly ARTIFACT_FILES' names and no subdirectory. */
function assertArtifactSet(dir: string): void {
	const { files, dirs } = listRecursive(dir);
	if (dirs.length > 0) {
		throw new Error(`unexpected subdirectory under the work dir: ${dirs.join(", ")}`);
	}
	const expected = ARTIFACT_FILES.map((a) => a.name).sort();
	if (JSON.stringify(files) !== JSON.stringify(expected)) {
		throw new Error(`artifact set is [${files.join(", ")}], expected exactly [${expected.join(", ")}]`);
	}
}

function repoWorkSnapshot(): string {
	if (!existsSync(REPO_WORK)) {
		return "absent";
	}
	const { files, dirs } = listRecursive(REPO_WORK);
	return JSON.stringify([...dirs, ...files].map((p) => [p, statSync(join(REPO_WORK, p)).mtimeMs]));
}

function headings(markdown: string): string[] {
	return [...markdown.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1] ?? "");
}

let cwd: string;
let dir: string;
let before: string;

beforeAll(() => {
	before = repoWorkSnapshot();
	cwd = mkdtempSync(join(tmpdir(), "kypi-artifacts-"));
	dir = workDir(cwd, SLUG);
});

afterAll(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("the artifact set is exactly SPEC, PLAN, REVIEW and PROGRESS", () => {
	it("a full run of the four write paths yields exactly ARTIFACT_FILES and no subdirectory", () => {
		expect(writeSpecIfGated(cwd, SLUG, renderSpecMarkdown(SPEC))).toEqual({ ok: true });
		expect(writePlanIfGated(cwd, SLUG, PLAN)).toEqual({ ok: true });
		appendProgress(cwd, SLUG, renderProgressAppend(progressEntry("T001", "ok")));
		const review = validateReview(
			{
				verdicts: [
					{ requirementId: "R1", status: "Implemented", evidence: "src/auth/session.ts:1" },
					{ requirementId: "R2", status: "Implemented", evidence: "src/auth/session.ts:2" },
				],
				findings: [],
				checkedAndCleared: "Checked rotation and expiry paths.",
				classification: "root-cause",
				classificationJustification: "Addresses the cause.",
			},
			["R1", "R2"],
		);
		if (!review.ok) {
			throw new Error(review.reason);
		}
		writeFileSync(join(dir, "REVIEW.md"), renderReviewMarkdown(review.review), "utf-8");

		expect(() => assertArtifactSet(dir)).not.toThrow();
		expect(listRecursive(dir).files).toEqual(ARTIFACT_FILES.map((a) => a.name).sort());
		expect(listRecursive(dir).dirs).toEqual([]);
	});

	it("a planted fifth file turns the check red", () => {
		const extra = join(dir, "scorecard.json");
		writeFileSync(extra, "{}", "utf-8");
		try {
			expect(() => assertArtifactSet(dir)).toThrow(/artifact set is \[.*scorecard\.json.*\], expected exactly/);
		} finally {
			rmSync(extra);
		}
		expect(() => assertArtifactSet(dir)).not.toThrow();
	});

	it("a file tucked into a subdirectory turns the check red", () => {
		const sub = join(dir, "notes");
		mkdirSync(sub);
		writeFileSync(join(sub, "handoff-packet.json"), "{}", "utf-8");
		try {
			expect(() => assertArtifactSet(dir)).toThrow(/unexpected subdirectory/);
		} finally {
			rmSync(sub, { recursive: true, force: true });
		}
	});

	it("PROGRESS.md is appended, not rewritten", () => {
		const file = join(dir, "PROGRESS.md");
		const first = readFileSync(file, "utf-8");
		appendProgress(cwd, SLUG, renderProgressAppend(progressEntry("T002", "second")));
		const second = readFileSync(file, "utf-8");
		expect(second.length).toBeGreaterThan(first.length);
		expect(second.startsWith(first)).toBe(true);
		expect(second).toContain("## T002 @ abc1234");
	});

	it("no discussion-log, decision-log or notes file exists under any work dir (GSD's DISCUSSION-LOG.md is the named anti-pattern)", () => {
		const offenders = listRecursive(dir).files.filter((f) => /discussion|decision|notes|log/i.test(f));
		expect(offenders, "a document no downstream consumer reads is the DISCUSSION-LOG.md anti-pattern").toEqual([]);
	});
});

describe("every artifact and every section has a named consumer", () => {
	const commandNames = (): Set<string> => {
		const names = new Set<string>();
		const extDir = join(repoRoot(), ".pi", "extensions");
		for (const entry of readdirSync(extDir, { withFileTypes: true })) {
			const index = join(extDir, entry.name, "index.ts");
			if (entry.isDirectory() && existsSync(index)) {
				for (const m of readFileSync(index, "utf-8").matchAll(/registerCommand\(\s*"([\w-]+)"/g)) {
					names.add(m[1] ?? "");
				}
			}
		}
		return names;
	};

	it("each ARTIFACT_FILES consumer is non-empty and every slash command it names is registered", () => {
		const registered = commandNames();
		for (const artifact of ARTIFACT_FILES) {
			expect(artifact.consumer.trim().length, `${artifact.name} has no consumer`).toBeGreaterThan(0);
			for (const m of artifact.consumer.matchAll(/\/([a-z]+)\b/g)) {
				expect(registered.has(m[1] ?? ""), `${artifact.name}'s consumer names /${m[1]}, which no extension registers`).toBe(true);
			}
		}
	});

	it("each SPEC_SECTIONS entry names a consumer", () => {
		for (const section of SPEC_SECTIONS) {
			expect(section.consumer.trim().length, `SPEC section ${section.id} has no consumer`).toBeGreaterThan(0);
		}
	});

	// Plan and review declare no section data in production; these tables are cross-checked against the rendered headings.
	const PLAN_CONSUMERS: Record<string, string> = {
		"Task List": "/execute (per-task handoff)",
		"Coverage Matrix": "/review (requirement verdicts against task coverage)",
		"Files Touched": "/review (scope drift baseline)",
	};
	const REVIEW_CONSUMERS: Record<string, string> = {
		Verdicts: "the human reviewer and the MR body",
		Findings: "the human reviewer and the MR body",
		"Scope Drift": "the human reviewer and the MR body",
		"Checked and cleared": "the human reviewer",
		Classification: "the MR body",
	};

	it("PLAN.md's rendered sections are exactly those with a declared consumer", () => {
		expect(headings(readFileSync(join(dir, "PLAN.md"), "utf-8")).sort()).toEqual(Object.keys(PLAN_CONSUMERS).sort());
	});

	it("REVIEW.md's rendered sections are exactly those with a declared consumer", () => {
		expect(headings(readFileSync(join(dir, "REVIEW.md"), "utf-8")).sort()).toEqual(Object.keys(REVIEW_CONSUMERS).sort());
	});
});

describe("the repository's own .pi/work was not touched", () => {
	it("is unchanged after every write above", () => {
		expect(repoWorkSnapshot()).toBe(before);
	});
});
