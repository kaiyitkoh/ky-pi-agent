/**
 * Design-level review pass: derives the firing signals from the change and, when they fire, asks one extra
 * reviewer call for complexity, scalability and abstraction-fit findings. Registers nothing.
 */
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

import { addQualityCost } from "../diagnostics/quality-cost.ts";
import { redactString } from "../diagnostics/redact.ts";
import { deriveNeed } from "../routing/guard.ts";
import { runSingleShotRole } from "../routing/modes.ts";
import type { DesignReviewSignals } from "./gates.ts";
import { isFileLine, type ReviewFinding } from "./review-schema.ts";
import type { ReviewRequirement } from "./reviewer.ts";

const LOOP_START = /\b(?:for|while)\s*\(|\.(?:forEach|map|flatMap)\(|^\s*for\s+\w+\s+in\b|^\s*async\s+for\b/;
const QUERY_CALL = /\.(?:query|find|findOne|findMany|execute)\(|\bfetch\(|\bawait\s+db\.|\bSELECT\b/;
// Lines after a loop header that still count as inside its body; a heuristic, a false positive costs one call.
const LOOP_BODY_WINDOW = 8;
const DATA_MODEL_PATH = /(?:^|[\/])(?:migrations?|models)[\/]|schema|\.(?:prisma|sql|graphql|gql)$/i;
const CODE_FILE = /\.[cm]?[tj]sx?$/;
const EXPORT_LINE = /^[+-]\s*export\s/;

/** Pure over the unified diff text; `escalated` comes from the routing mode state. */
export function computeDesignSignals(input: {
	readonly changed: readonly string[];
	readonly diffText: string;
	readonly escalated: boolean;
}): DesignReviewSignals {
	let loopWrapsQuery = false;
	let publicInterfaceChanged = false;
	let currentFile = "";
	let sinceLoop = Number.POSITIVE_INFINITY;

	for (const line of input.diffText.split("\n")) {
		// A path git still quotes (a tab, a quote, a backslash) arrives as "b/..."; the quotes are not part of it.
		const header = /^diff --git "?a\/.+ "?b\/(.*?)"?$/.exec(line);
		if (header !== null) {
			currentFile = header[1] ?? "";
			sinceLoop = Number.POSITIVE_INFINITY;
			continue;
		}
		if (line.startsWith("@@")) {
			sinceLoop = Number.POSITIVE_INFINITY;
			continue;
		}
		if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("-")) {
			if (EXPORT_LINE.test(line) && CODE_FILE.test(currentFile)) publicInterfaceChanged = true;
			continue;
		}
		const body = line.startsWith("+") || line.startsWith(" ") ? line.slice(1) : "";
		if (line.startsWith("+") && EXPORT_LINE.test(line) && CODE_FILE.test(currentFile)) publicInterfaceChanged = true;
		if (LOOP_START.test(body)) sinceLoop = 0;
		if (sinceLoop <= LOOP_BODY_WINDOW && QUERY_CALL.test(body) && line.startsWith("+")) loopWrapsQuery = true;
		sinceLoop += 1;
	}

	return {
		filesTouched: input.changed.length,
		loopWrapsQuery,
		dataModelChanged: input.changed.some((p) => DATA_MODEL_PATH.test(p)),
		publicInterfaceChanged,
		escalateRequested: input.escalated,
	};
}

const DESIGN_TOOL_NAME = "submit_design_review";

const designParameters = Type.Object({
	findings: Type.Array(
		Type.Object({
			severity: StringEnum(["BLOCKER", "WARNING", "NIT"], { description: "BLOCKER only for a design defect that makes the change fail at realistic scale." }),
			location: Type.String({ description: "file:line -- where the finding is." }),
			concreteFailure: Type.String({ description: "The concrete failure, with the input size or access pattern that triggers it." }),
			suggestedFix: Type.String({ description: "The smallest change that removes it." }),
		}),
	),
});

const DESIGN_SYSTEM_PROMPT = `You are a design-level reviewer with fresh context. A correctness review of this change already ran; do not repeat it. Report only: algorithmic complexity that degrades at realistic input sizes (queries or I/O inside loops, quadratic scans), scalability limits, and abstractions that do not fit the problem (needless layers, leaked internals, widened public interfaces). Every finding needs a file:line location and a concrete failure, not a preference. Report nothing you cannot tie to code in the change; an empty findings list is a valid answer. Call ${DESIGN_TOOL_NAME} exactly once; prose outside that call is discarded.`;

export interface DesignReviewResult {
	readonly findings: readonly ReviewFinding[];
	readonly notice?: string;
}

const SEVERITIES = new Set(["BLOCKER", "WARNING", "NIT"]);

/** Each well-formed finding, and how many malformed ones were dropped; one bad item never discards the rest. */
function parseFindings(raw: unknown): { readonly findings: ReviewFinding[]; readonly dropped: number } | undefined {
	const list = (raw as { findings?: unknown } | undefined)?.findings;
	if (!Array.isArray(list)) return undefined;
	const findings: ReviewFinding[] = [];
	for (const item of list) {
		const f = (item !== null && typeof item === "object" ? item : {}) as Record<string, unknown>;
		const { severity, location, concreteFailure, suggestedFix } = f;
		if (
			typeof severity === "string" && SEVERITIES.has(severity) &&
			typeof location === "string" && isFileLine(location) &&
			typeof concreteFailure === "string" && concreteFailure.trim() !== "" &&
			typeof suggestedFix === "string" && suggestedFix.trim() !== ""
		) {
			findings.push({ severity: severity as ReviewFinding["severity"], location, concreteFailure, suggestedFix });
		}
	}
	return { findings, dropped: list.length - findings.length };
}

/** One extra reviewer call. An unusable reply yields no findings and a notice: the correctness review already stands. */
export async function runDesignReview(
	ctx: ExtensionContext,
	input: { readonly diffText: string; readonly changed: readonly string[]; readonly requirements: readonly ReviewRequirement[] },
): Promise<DesignReviewResult> {
	const content = redactString(
		[
			"# Changed files",
			input.changed.map((p) => `- ${p}`).join("\n"),
			"# Stated requirements",
			input.requirements.map((r) => `- ${r.id}: ${r.text}`).join("\n"),
			"# Diff",
			input.diffText,
		].join("\n\n"),
	);
	const tools: Tool[] = [
		{ name: DESIGN_TOOL_NAME, description: "Report the design-level findings. The only accepted output.", parameters: designParameters },
	];
	const messages: Message[] = [{ role: "user", content, timestamp: Date.now() }];
	const start = process.hrtime.bigint();
	let message: AssistantMessage;
	try {
		message = await runSingleShotRole(ctx, {
			role: "reviewer",
			systemPrompt: DESIGN_SYSTEM_PROMPT,
			messages,
			need: deriveNeed(ctx, { promptChars: content.length + DESIGN_SYSTEM_PROMPT.length }),
			tools,
		});
	} catch (err) {
		return { findings: [], notice: `the design pass failed (${err instanceof Error ? err.message : String(err)}); it added no findings` };
	}
	addQualityCost({ ms: Number(process.hrtime.bigint() - start) / 1_000_000, tokens: message.usage.totalTokens });

	const call = message.content.find(
		(b): b is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => b.type === "toolCall" && b.name === DESIGN_TOOL_NAME,
	);
	const parsed = call === undefined ? undefined : parseFindings(call.arguments);
	if (parsed === undefined) return { findings: [], notice: `the design pass returned no usable ${DESIGN_TOOL_NAME} call; it added no findings` };
	return parsed.dropped === 0 ? { findings: parsed.findings } : { findings: parsed.findings, notice: `the design pass dropped ${parsed.dropped} malformed finding(s) and kept ${parsed.findings.length}` };
}
