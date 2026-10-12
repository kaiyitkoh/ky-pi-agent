/**
 * The /execute handoff packet: a pure builder, a measurement, and an honest probe for the subagent layer.
 * Pure: plain data in and out, no ctx, no I/O. Registers nothing and never reaches a model, so it names none of the
 * bypass routes that tests/unit/chokepoint-lint.test.ts and contributing-boundary.test.ts scan for in raw source.
 */
import type { LegStatus } from "../quality/gates.ts";
import type { SpecArtifact, VerifiedFact } from "../grill/spec-schema.ts";
import type { ParsedTask } from "../plan-ceremony/plan-schema.ts";
import { estimateTokensFromChars } from "../diagnostics/budget.ts";

/**
 * Tool names a real dispatch needs: `subagent` (spawn) and `bg_wait` (block on the result).
 * pi-subagents@0.76.1 src/extension/index.js:667,699 and src/runs/background/wait-tool.js:28,34.
 * Registered regardless of dynamic activation (pi-subagents@0.76.1 tool-activation.js:78,114); child-to-parent tools are deliberately not probed.
 */
export const SUBAGENT_TOOL_NAMES = ["subagent", "bg_wait"] as const;

/**
 * The subagent-dispatch leg: requires BOTH names in `registeredToolNames` and names the missing set.
 * Never reads settings: that reports what is configured, not what is loaded.
 */
export function probeSubagentAvailability(registeredToolNames: readonly string[]): LegStatus {
	const missing = SUBAGENT_TOOL_NAMES.filter((name) => !registeredToolNames.includes(name));
	if (missing.length > 0) {
		return {
			status: "unavailable",
			reason:
				`missing tool${missing.length > 1 ? "s" : ""} ${missing.join(", ")} — pi-subagents@0.76.1 is pinned in ` +
				"settings but not installed (RB-07-02); the live check that would exercise a real spawn once " +
				"installed is RB-09-03",
		};
	}
	return { status: "pass" };
}

/** What a child executor receives: the task id plus its requirement excerpts, facts, paths and verification command; no SPEC or conversation. */
export interface HandoffPacket {
	readonly taskId: string;
	/** The §3 entry text for each of this task's `[R#]` ids, in citation order. */
	readonly requirementExcerpts: readonly string[];
	/** The §2 rows referenced by those excerpts; see selectReferencedFacts. */
	readonly verifiedFacts: readonly VerifiedFact[];
	/** The task's own declared file path(s). */
	readonly filePaths: readonly string[];
	readonly verificationCommand: string;
}

/** One §3 requirement entry, as `parseRequirementEntries` finds it. */
interface SpecRequirementEntry {
	readonly id: string;
	readonly text: string;
}

/** One `R<digits>: <body>` entry in a §3 body. Body is a bounded lazy quantifier (never `.+`) for backtracking safety. */
const REQUIREMENT_ENTRY_PATTERN = /\bR(\d{1,4}):\s*(\S[\s\S]{0,2000}?)(?=\s*\bR\d{1,4}:|$)/g;

/** Every `R<id>: <text>` entry in a §3 body; ids written without the colon convention yield no entry. */
function parseRequirementEntries(requirementsBody: string): readonly SpecRequirementEntry[] {
	const entries: SpecRequirementEntry[] = [];
	for (const match of requirementsBody.matchAll(REQUIREMENT_ENTRY_PATTERN)) {
		const digits = match[1];
		if (digits === undefined) {
			continue;
		}
		entries.push({ id: `R${digits}`, text: (match[0] ?? "").trim() });
	}
	return entries;
}

/** A fact travels with the packet when its `claim` appears case-insensitively in the excerpt text; not "all of them", which would defeat the bounded packet. */
function selectReferencedFacts(verifiedFacts: readonly VerifiedFact[], requirementExcerpts: readonly string[]): readonly VerifiedFact[] {
	const haystack = requirementExcerpts.join("\n\n").toLowerCase();
	return verifiedFacts.filter((fact) => haystack.includes(fact.claim.toLowerCase()));
}

/**
 * Build the packet for one task. THROWS when a cited requirement id has no §3 entry, or the task lacks a
 * file path or verification command: validatePlan should already make each impossible.
 */
export function buildHandoffPacket(input: { readonly spec: SpecArtifact; readonly task: ParsedTask }): HandoffPacket {
	const { spec, task } = input;
	const entriesById = new Map(parseRequirementEntries(spec.requirementsBody).map((entry) => [entry.id, entry] as const));

	const requirementExcerpts: string[] = [];
	for (const id of task.requirementIds) {
		const entry = entriesById.get(id);
		if (entry === undefined) {
			throw new Error(
				`buildHandoffPacket: task ${task.id} cites requirement ${id}, but the SPEC's Requirements section ` +
					`(§3) carries no "${id}:" entry -- a packet built on a missing requirement is a silently ` +
					"under-specified child",
			);
		}
		requirementExcerpts.push(entry.text);
	}

	if (task.path === undefined) {
		throw new Error(`buildHandoffPacket: task ${task.id} carries no explicit file path -- a validated PLAN.md cannot reach this`);
	}
	if (task.verificationCommand === undefined) {
		throw new Error(`buildHandoffPacket: task ${task.id} carries no verification command -- a validated PLAN.md cannot reach this`);
	}

	return {
		taskId: task.id,
		requirementExcerpts,
		verifiedFacts: selectReferencedFacts(spec.verifiedFacts, requirementExcerpts),
		filePaths: [task.path],
		verificationCommand: task.verificationCommand,
	};
}

/** Render a packet as the text a child would receive; this is what measurePacketDelta measures. */
export function renderHandoffPacket(packet: HandoffPacket): string {
	const lines: string[] = [];

	lines.push(`# Handoff Packet: ${packet.taskId}`);
	lines.push("");

	lines.push("## Requirement Excerpts");
	lines.push("");
	lines.push(packet.requirementExcerpts.join("\n\n"));
	lines.push("");

	lines.push("## Verified Facts");
	lines.push("");
	for (const fact of packet.verifiedFacts) {
		lines.push(`- ${fact.claim} (evidence: ${fact.evidence}; how verified: ${fact.howVerified})`);
	}
	lines.push("");

	lines.push("## File Paths");
	lines.push("");
	for (const path of packet.filePaths) {
		lines.push(`- ${path}`);
	}
	lines.push("");

	lines.push("## Verification Command");
	lines.push("");
	lines.push(packet.verificationCommand);
	lines.push("");

	return lines.join("\n");
}

/** {@link measurePacketDelta}'s return shape. */
export interface PacketDeltaMeasurement {
	readonly packetTokens: number;
	readonly parentTokens: number;
	readonly deltaTokens: number;
	readonly method: string;
}

/**
 * Measure a packet against the parent-context text it replaces with estimateTokensFromChars (diagnostics/budget.ts#estimateTokensFromChars,
 * chars/4, not a tokenizer). Measures, never asserts: neither sign of `deltaTokens` is a target.
 */
export function measurePacketDelta(input: { readonly packetText: string; readonly parentContextText: string }): PacketDeltaMeasurement {
	const packetTokens = estimateTokensFromChars(input.packetText.length);
	const parentTokens = estimateTokensFromChars(input.parentContextText.length);
	return {
		packetTokens,
		parentTokens,
		deltaTokens: packetTokens - parentTokens,
		method: "estimateTokensFromChars (Math.ceil of chars divided by four), diagnostics/budget.ts -- NOT a tokenizer",
	};
}
