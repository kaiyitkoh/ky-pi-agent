/**
 * The reviewer's fixed context contract reaches the wire, asserted on the captured outgoing request rather than on
 * `buildReviewerContext`'s return value. The fixture is a real repo where `src/a.ts` imports `src/b.ts` and a
 * zero-context diff touches only `a.ts`, whose full contents carry a marker and a secret-shaped token the diff lacks.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	getCurrentSystemPrompt,
} from "@earendil-works/pi-ai";

import { beforeAll, describe, expect, it } from "vitest";

import {
	buildImportGraph,
	buildReviewerContext,
	runReview,
	type ReviewerContractInput,
} from "../../.pi/extensions/quality/reviewer.ts";
import { getModeState, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { SECRET_FIXTURE_TOKEN, transcriptView, wrapFauxWithPayload } from "../helpers/faux.ts";
import { commitFile, makeTempRepo } from "../helpers/git.ts";
import { createFauxSession, waitForConfiguredAuth } from "../helpers/session.ts";

// -----------------------------------------------------------------------------
// The real-repo fixture: A imports B, then a change touching A only
// -----------------------------------------------------------------------------

const NON_SECRET_CONTROL = "this-line-must-survive-redaction-xyz789";

/** `git diff`, zero context, from a temp repo — never a fabricated string. */
function gitDiff(repo: string, from: string, to: string, path: string): string {
	const result = spawnSync("git", ["diff", "--unified=0", from, to, "--", path], {
		cwd: repo,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`git diff failed to launch in "${repo}": ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`git diff failed (exit ${result.status}) in "${repo}": ${result.stderr}`);
	}
	return result.stdout ?? "";
}

interface RepoFixture {
	diff: string;
	fullContentsA: string;
	changedLine: string;
	/** Present in full contents, absent from the zero-context diff — the "far from the change" line. */
	farFromChangeLine: string;
}

/** The temp-repo fixture; `src/a.ts` imports `./b.ts`, so the import graph has the edge `src/a.ts -> ./b.ts`. */
function buildRepoFixture(): RepoFixture {
	const repo = makeTempRepo("kypi-reviewer-contract-");
	// commitFile needs the parent directory to exist.
	mkdirSync(join(repo, "src"), { recursive: true });

	commitFile(repo, "src/b.ts", "export const B = 1;\n", "add b");

	const farFromChangeLine = 'export const KEEP_MARKER = "unchanged-marker-value";';
	const secretLine = `// SECRET_FIXTURE_LINE: ${SECRET_FIXTURE_TOKEN}`;
	const controlLine = `// CONTROL_FIXTURE_LINE: ${NON_SECRET_CONTROL}`;

	const before = [
		'import { B } from "./b.ts";',
		"",
		secretLine,
		controlLine,
		farFromChangeLine,
		"",
		"export function useA() {",
		"  return B;",
		"}",
		"",
	].join("\n");
	const shaBefore = commitFile(repo, "src/a.ts", before, "add a (imports b)");

	const changedLine = "  return B + 1;";
	const after = [
		'import { B } from "./b.ts";',
		"",
		secretLine,
		controlLine,
		farFromChangeLine,
		"",
		"export function useA() {",
		changedLine,
		"}",
		"",
	].join("\n");
	commitFile(repo, "src/a.ts", after, "change a: return B + 1");

	const diff = gitDiff(repo, shaBefore, "HEAD", "src/a.ts");
	const fullContentsA = readFileSync(join(repo, "src/a.ts"), "utf-8");

	// The marker, secret and control lines must be absent from the diff, or the full-contents assertion is vacuous.
	if (diff.includes(farFromChangeLine) || diff.includes(SECRET_FIXTURE_TOKEN) || diff.includes(NON_SECRET_CONTROL)) {
		throw new Error(
			"buildRepoFixture: the marker/secret/control lines leaked into the zero-context diff -- the " +
				"fixture no longer proves full-contents carries something the diff does not",
		);
	}
	if (!diff.includes(changedLine.trim())) {
		throw new Error(`buildRepoFixture: the diff does not contain the changed line "${changedLine.trim()}"`);
	}

	return { diff, fullContentsA, changedLine, farFromChangeLine };
}

function buildContract(repoFixture: RepoFixture): { contract: ReviewerContractInput; requirementIds: string[] } {
	const touchedFiles = [{ path: "src/a.ts", contents: repoFixture.fullContentsA }];
	const requirements = [
		{ id: "GATE-02", text: "The reviewer sees the fixed six-element context contract." },
		{ id: "QUAL-04", text: "The change is classified root-cause, symptomatic, or workaround." },
	];
	const contract: ReviewerContractInput = {
		diff: repoFixture.diff,
		touchedFiles,
		gateReport: "typecheck: PASS\nlint: PASS\nlsp: UNAVAILABLE (RB-08-02)\nanti-pattern: PASS",
		requirements,
		filesTouchedUnion: ["src/a.ts"],
		importGraph: buildImportGraph(touchedFiles.map((f) => ({ path: f.path, text: f.contents }))),
	};
	return { contract, requirementIds: requirements.map((r) => r.id) };
}

// -----------------------------------------------------------------------------
// Session/faux plumbing
// -----------------------------------------------------------------------------

interface CapturedRequest {
	context: TranscriptContext;
	options: SimpleStreamOptions | undefined;
}

/** Every message's raw content text, joined; JSON.stringify would escape the quotes KEEP_MARKER's line carries. */
function capturedText(capture: CapturedRequest | undefined): string {
	if (capture === undefined) {
		return "";
	}
	return transcriptView(capture.context)
		.messages
		.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
		.join("\n");
}

const VALID_SUBMIT_REVIEW_ARGS = {
	verdicts: [
		{ requirementId: "GATE-02", status: "Implemented", evidence: "src/a.ts:8" },
		{ requirementId: "QUAL-04", status: "Implemented", evidence: "src/a.ts:8" },
	],
	findings: [],
	checkedAndCleared: "Checked src/a.ts end to end; the change is a one-line arithmetic fix with no side effects.",
	classification: "root-cause",
	classificationJustification: "The change fixes the actual computation, not a symptom of it.",
};

const MISSING_CHECKED_AND_CLEARED_ARGS = {
	...VALID_SUBMIT_REVIEW_ARGS,
	checkedAndCleared: "",
};

interface Run {
	captures: CapturedRequest[];
	callCountBeforeTruncated: number;
	callCountAfterTruncated: number;
	truncatedThrew: boolean;
	truncatedMessage: string;
	successResult: Awaited<ReturnType<typeof runReview>>;
	proseResult: Awaited<ReturnType<typeof runReview>>;
	malformedResult: Awaited<ReturnType<typeof runReview>>;
	repoFixture: RepoFixture;
	requirementIds: string[];
}

async function runFixture(): Promise<Run> {
	setMode("cheap");
	setEscalated(false);
	expect(getModeState().mode, "test setup did not reset the mode slot to cheap").toBe("cheap");

	const repoFixture = buildRepoFixture();
	const { contract, requirementIds } = buildContract(repoFixture);

	const handle = await createFauxSession({
		responses: [fauxAssistantMessage("warm", { stopReason: "stop" })],
	});

	try {
		const captures: CapturedRequest[] = [];

		const deepseekFaux = fauxProvider({
			provider: "deepseek",
			models: [
				{
					id: "deepseek-flash",
					reasoning: true,
					input: ["text"],
					cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 },
				},
			],
		});

		deepseekFaux.setResponses([
			// The review call: a factory capturing the outgoing context and options.
			(context, options) => {
				captures.push({ context, options });
				return fauxAssistantMessage(fauxToolCall("submit_review", VALID_SUBMIT_REVIEW_ARGS), {
					stopReason: "toolUse",
				});
			},
			// 2 -- negative control: prose only, no submit_review call at all.
			() => fauxAssistantMessage("Looks fine to me. LGTM!", { stopReason: "stop" }),
			// 3 -- negative control: submit_review called, but checkedAndCleared is empty.
			() =>
				fauxAssistantMessage(fauxToolCall("submit_review", MISSING_CHECKED_AND_CLEARED_ARGS), {
					stopReason: "toolUse",
				}),
		]);

		handle.modelRuntime.registerNativeProvider(wrapFauxWithPayload(deepseekFaux, undefined));
		await handle.modelRuntime.setRuntimeApiKey("deepseek", "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, "deepseek");

		await handle.session.prompt("warm up");
		const ctx = handle.session.extensionRunner.createCommandContext();

		// ---- case: the successful review call ---------------------------------
		const successResult = await runReview(ctx, { contract, requirementIds });

		// ---- negative control: prose, no submit_review ------------------------
		const proseResult = await runReview(ctx, { contract, requirementIds });

		// ---- negative control: submit_review missing checkedAndCleared --------
		const malformedResult = await runReview(ctx, { contract, requirementIds });

		// ---- negative control: a truncated contract must throw BEFORE any
		// request is made -- zero provider calls, not merely a rejected review.
		const callCountBeforeTruncated = deepseekFaux.state.callCount;
		let truncatedThrew = false;
		let truncatedMessage = "";
		try {
			await runReview(ctx, {
				contract: { ...contract, diff: "" },
				requirementIds,
			});
		} catch (error) {
			truncatedThrew = true;
			truncatedMessage = error instanceof Error ? error.message : String(error);
		}
		const callCountAfterTruncated = deepseekFaux.state.callCount;

		return {
			captures,
			callCountBeforeTruncated,
			callCountAfterTruncated,
			truncatedThrew,
			truncatedMessage,
			successResult,
			proseResult,
			malformedResult,
			repoFixture,
			requirementIds,
		};
	} finally {
		await handle.dispose();
	}
}

let run: Run;

describe("GATE-02 -- the reviewer's fixed context contract reaches the wire", () => {
	beforeAll(async () => {
		run = await runFixture();
	}, 60_000);

	it("captured at least one outgoing request (vacuity guard, asserted first)", () => {
		expect(
			run.captures.length,
			"no outgoing request was captured at all -- every assertion below would be checking nothing",
		).toBeGreaterThan(0);
	});

	it("the six contract elements all reach the CAPTURED outgoing request", () => {
		const capture = run.captures[0];
		expect(capture).toBeDefined();
		const messagesText = capturedText(capture);

		// (1) the diff.
		expect(messagesText, "the diff text is not present in the captured outgoing request").toContain(
			run.repoFixture.changedLine.trim(),
		);

		// (2) A line of file A's full contents that the diff lacks: what distinguishes full contents from the diff.
		expect(
			messagesText,
			"the touched file's full contents (specifically a line the diff does not carry) is not present " +
				"in the captured outgoing request",
		).toContain(run.repoFixture.farFromChangeLine);

		// (3) the gate report.
		expect(messagesText, "the gate report string is not present in the captured outgoing request").toContain(
			"typecheck: PASS",
		);
		expect(messagesText).toContain("anti-pattern: PASS");

		// (4) every requirement id and its text.
		expect(messagesText).toContain("GATE-02");
		expect(messagesText).toContain("The reviewer sees the fixed six-element context contract.");
		expect(messagesText).toContain("QUAL-04");
		expect(messagesText).toContain("The change is classified root-cause, symptomatic, or workaround.");

		// (5) every path in the files-touched union.
		expect(messagesText).toContain("src/a.ts");

		// (6) the import graph edge A -> B.
		expect(
			messagesText,
			"the import graph edge src/a.ts -> ./b.ts is not present in the captured outgoing request",
		).toContain("src/a.ts imports ./b.ts");
	});

	it("the tools array on the wire contains exactly one tool named submit_review", () => {
		const capture = run.captures[0];
		const tools = capture ? transcriptView(capture.context).tools : [];
		expect(tools.length, "the tools array reaching the request is not length 1").toBe(1);
		expect(tools[0]?.name).toBe("submit_review");
	});

	it("the system prompt on the wire carries every named soft-failure phrase, asserted individually", () => {
		const systemPrompt = getCurrentSystemPrompt(run.captures[0]?.context.messages ?? []);
		expect(systemPrompt.length, "no system prompt reached the captured request at all").toBeGreaterThan(0);

		expect(systemPrompt, 'missing "Stopping at surface issues"').toContain("Stopping at surface issues");
		expect(systemPrompt, 'missing "Treating tests-pass as correctness"').toContain(
			"Treating tests-pass as correctness",
		);
		expect(systemPrompt, 'missing "Downgrading BLOCKER to WARNING to avoid seeming harsh"').toContain(
			"Downgrading BLOCKER to WARNING to avoid seeming harsh",
		);
		expect(systemPrompt, 'missing "Approving when unsure"').toContain("Approving when unsure");
	});

	it("the secret-shaped token is absent from the wire, paired with a control string that survives", () => {
		const messagesText = capturedText(run.captures[0]);
		expect(
			messagesText.includes(SECRET_FIXTURE_TOKEN),
			"the secret-shaped fixture token reached the captured outgoing request unredacted",
		).toBe(false);
		expect(
			messagesText.includes(NON_SECRET_CONTROL),
			"the non-secret control string was redacted too -- redactString is mangling ordinary text",
		).toBe(true);
	});

	it("a faux response returning prose with no submit_review call is refused, naming that prose arrived", () => {
		expect(run.proseResult.ok, "runReview accepted a review with no submit_review tool call").toBe(false);
		if (!run.proseResult.ok) {
			expect(run.proseResult.reason).toContain("submit_review");
			expect(run.proseResult.reason.toLowerCase()).toContain("prose");
		}
	});

	it("a submit_review call missing checkedAndCleared is refused by the validator, not merely accepted", () => {
		expect(run.malformedResult.ok, "runReview accepted a submit_review call with an empty checkedAndCleared").toBe(
			false,
		);
		if (!run.malformedResult.ok) {
			expect(run.malformedResult.reason).toContain("checkedAndCleared");
		}
	});

	it("a genuinely valid submit_review call is accepted", () => {
		expect(run.successResult.ok, `runReview rejected a valid review: ${JSON.stringify(run.successResult)}`).toBe(
			true,
		);
	});

	it("a truncated contract (one element removed) throws before any request, with ZERO provider calls", () => {
		expect(run.truncatedThrew, "runReview did not throw for a contract missing its diff element").toBe(true);
		expect(run.truncatedMessage).toContain("diff");
		expect(
			run.callCountAfterTruncated,
			"a provider call was made even though the contract was truncated -- a refusal that still costs a " +
				"request is not a refusal",
		).toBe(run.callCountBeforeTruncated);
	});
});

// -----------------------------------------------------------------------------
// buildReviewerContext: the six missing-element cases
// -----------------------------------------------------------------------------

describe("buildReviewerContext -- throws naming which of the six elements is absent", () => {
	const repoFixture = buildRepoFixture();
	const { contract: validContract } = buildContract(repoFixture);

	it("diff absent", () => {
		expect(() => buildReviewerContext({ ...validContract, diff: "" })).toThrow(/diff/);
	});
	it("touchedFiles absent", () => {
		expect(() => buildReviewerContext({ ...validContract, touchedFiles: [] })).toThrow(/touchedFiles/);
	});
	it("gateReport absent", () => {
		expect(() => buildReviewerContext({ ...validContract, gateReport: "" })).toThrow(/gateReport/);
	});
	it("requirements absent", () => {
		expect(() => buildReviewerContext({ ...validContract, requirements: [] })).toThrow(/requirements/);
	});
	it("filesTouchedUnion absent", () => {
		expect(() => buildReviewerContext({ ...validContract, filesTouchedUnion: [] })).toThrow(/filesTouchedUnion/);
	});
	it("an empty importGraph is valid and renders as no edges", () => {
		const rendered = buildReviewerContext({ ...validContract, importGraph: [] });
		expect(rendered).toContain("none: no JavaScript or TypeScript file changed");
	});
	it("a genuinely complete contract does not throw", () => {
		expect(() => buildReviewerContext(validContract)).not.toThrow();
	});
});
