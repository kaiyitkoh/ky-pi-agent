/**
 * FLOW-09 — the `/execute` handoff packet: a pure builder, a real
 * measurement, and an honest, never-silent probe for the subagent layer that
 * would eventually carry it.
 *
 * BUILD IT OFFLINE AND MEASURE IT HONESTLY. Phase 7 installed nothing —
 * `pi-subagents@0.49.0` is pinned in this project's settings file's
 * `packages[]` list (line 6) and NOT INSTALLED (`RB-07-02`, OUTSTANDING).
 * This module builds the packet and its measurement now, unit-verified with no
 * extension installed, and degrades HONESTLY when asked whether a real
 * dispatch is possible: {@link probeSubagentAvailability} probes by
 * REGISTERED TOOL NAME and reports a distinct `unavailable`, never a silent
 * `pass`. An absent subagent layer that reports "delegated" is Phase 4's
 * headless-guard failure in a new costume.
 *
 * THE PACKET'S CONTRACT, VERBATIM (`.planning/research/FEATURES.md` Part 2,
 * line 202): "SPEC excerpt for its requirement IDs, the relevant §2 verified
 * facts, its file paths, its verification command. Not the whole SPEC, not
 * the conversation." {@link HandoffPacket} has exactly those four content
 * fields, plus the task id.
 *
 * "NEGATIVE TOKENS" IS A MEASUREMENT, NOT AN ASSERTION. Criterion 5 says
 * delegation *costs* negative tokens in the parent. {@link measurePacketDelta}
 * measures the packet against the parent-context text it would replace, with
 * Phase 2's existing estimator, and RECORDS the number. A positive delta is a
 * result to record, not a failure to tune away — nothing in this module or
 * its own test file may assert the SIGN of that number.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers nothing. It does not spell the tool-registration
 * call, in code or in prose — `tests/unit/contributing-boundary.test.ts`
 * matches that call's name as a plain substring across every tracked source
 * under `.pi/extensions/`, comments included, and grants this directory no
 * exemption.
 *
 * ---------------------------------------------------------------------------
 * CHOKEPOINT HYGIENE (DIAG-03 / QUAL-02's structural claim)
 * ---------------------------------------------------------------------------
 * This file never reaches a model. It does not spell, even in a comment, the
 * documented direct-completion method on the model registry, its
 * simple-options or streaming siblings, the method that hands back a raw
 * provider object, the other route to a raw provider object, a deep import
 * under the pi-ai package's adapter path, or the model runtime class name —
 * the same six-plus-one bypass routes `tests/unit/chokepoint-lint.test.ts`
 * enumerates for DIAG-03. Describing them here in the abstract, rather than
 * naming them, is deliberate: `chokepoint-lint.test.ts` matches raw source
 * text, comments included, and grants this module no exemption.
 *
 * ---------------------------------------------------------------------------
 * PURITY
 * ---------------------------------------------------------------------------
 * Every export in this module is pure: plain data in, plain data out. No
 * `ctx`, no filesystem, no subprocess, nothing awaited. `probeSubagentAvailability`
 * takes the live registered-tool-name list as a plain parameter — the same
 * discipline `.pi/extensions/quality/gates.ts#probeLspAvailability` follows
 * and for the identical reason (see that module's own docstring): the caller
 * that actually holds Pi's `ExtensionAPI` supplies the list, this module
 * never derives it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT, AND CANNOT, PROVE
 * ---------------------------------------------------------------------------
 * {@link probeSubagentAvailability} proves the required tool NAMES are absent
 * from a supplied list; it cannot prove a real spawn would work once they are
 * present — that live check is `RB-09-03`, OUTSTANDING (added by plan 09-17,
 * alongside `RB-07-02`, the install itself). {@link measurePacketDelta}
 * proves the packet's estimated size relative to a supplied parent-context
 * string; it cannot prove what a real `pi-subagents` child would actually be
 * sent over the wire — that live check is the same `RB-09-03`. Neither gap is
 * hidden: both are named here and in this module's own test file.
 */
import type { LegStatus } from "../quality/gates.ts";
import type { SpecArtifact, VerifiedFact } from "../grill/spec-schema.ts";
import type { ParsedTask } from "../plan-ceremony/plan-schema.ts";
import { estimateTokensFromChars } from "../diagnostics/budget.ts";

// ---------------------------------------------------------------------------
// probeSubagentAvailability — the honest-degradation probe
// ---------------------------------------------------------------------------

/**
 * The two tool names a real dispatch genuinely needs: `subagent` (spawn) and
 * `subagent_wait` (block on the result). Both are registered unconditionally
 * by `pi-subagents@0.49.0` into the PARENT session
 * (`tests/unit/tool-count-baseline.test.ts:132`'s own recorded citation:
 * `src/extension/index.ts:578` for `subagent`, `:623` -> `registerWaitTool`
 * for `subagent_wait`).
 *
 * The other two parent-session tools that same row names —
 * `subagent_supervisor` and `intercom` — are deliberately NOT probed here:
 * both exist only to let an already-running child talk back to its
 * supervisor mid-run (`native-supervisor-channel.ts:650-651`, per that same
 * row's citation); neither is needed to spawn a task and wait for its
 * result, which is the whole of what `/execute`'s one-subagent-per-task shape
 * (`FEATURES.md` Part 2 line 202) requires. Probing for the minimum
 * genuinely needed, rather than all four, means a future harness that wires
 * only spawn-and-wait (no mid-run steering) is correctly reported available.
 */
export const SUBAGENT_TOOL_NAMES = ["subagent", "subagent_wait"] as const;

/**
 * The subagent-dispatch leg. Requires BOTH {@link SUBAGENT_TOOL_NAMES} to be
 * present in `registeredToolNames` — a partial registration is exactly the
 * shape a boolean check would get wrong, so the missing-name set is always
 * named explicitly, mirroring `probeLspAvailability`'s own contract
 * (`.pi/extensions/quality/gates.ts:163-175`).
 *
 * NEVER reads the project's settings file — that file reports what is
 * CONFIGURED, not what is LOADED (`gates.ts:17-33`'s own rule, carried
 * verbatim here). Reading it to decide availability would report "available"
 * for a dispatch that cannot possibly run, because `pi-subagents@0.49.0` is
 * pinned there and NOT installed.
 */
export function probeSubagentAvailability(registeredToolNames: readonly string[]): LegStatus {
	const missing = SUBAGENT_TOOL_NAMES.filter((name) => !registeredToolNames.includes(name));
	if (missing.length > 0) {
		return {
			status: "unavailable",
			reason:
				`missing tool${missing.length > 1 ? "s" : ""} ${missing.join(", ")} — pi-subagents@0.49.0 is pinned in ` +
				"settings but not installed (RB-07-02); the live check that would exercise a real spawn once " +
				"installed is RB-09-03",
		};
	}
	return { status: "pass" };
}

// ---------------------------------------------------------------------------
// HandoffPacket, buildHandoffPacket — the pure packet builder
// ---------------------------------------------------------------------------

/**
 * The whole handoff packet a child executor would receive: exactly the four
 * content fields `FEATURES.md` Part 2 line 202 names, plus the task id.
 * Nothing here carries the whole SPEC, the PLAN, or any conversation text.
 */
export interface HandoffPacket {
	readonly taskId: string;
	/** The §3 entry text for each of this task's `[R#]` ids, in citation order. */
	readonly requirementExcerpts: readonly string[];
	/** The §2 rows whose `claim` is referenced by those requirement excerpts — see {@link selectReferencedFacts}. */
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

/**
 * Matches one `R<digits>: <body>` entry inside a §3 `requirementsBody`, per
 * this repository's own recorded convention
 * (`tests/integration/plan-command.test.ts:96`: `"R1: rotate refresh tokens
 * on use.\n\nR2: expire tokens after 30 days."`). The body is captured
 * lazily up to the next `R<digits>:` entry or the end of the text, so `m[0]`
 * (the whole match) is exactly one entry's text, already trimmed of trailing
 * whitespace by construction.
 *
 * BOUNDED FOR BACKTRACKING SAFETY, matching `spec-schema.ts`'s own
 * `IF_THEN_PATTERN` discipline: the body capture is `[\s\S]{0,2000}?`, a
 * bounded lazy quantifier, never `.+`/`.*` — no nested quantifier over an
 * unbounded group.
 */
const REQUIREMENT_ENTRY_PATTERN = /\bR(\d{1,4}):\s*(\S[\s\S]{0,2000}?)(?=\s*\bR\d{1,4}:|$)/g;

/**
 * Every `R<id>: <text>` entry found in a §3 `requirementsBody`, keyed by its
 * own id. A body written without this repository's `"R<id>:"` convention
 * (e.g. a bare inline reference with no colon) yields no entry for that id —
 * see {@link buildHandoffPacket}'s own throw for what that means for a
 * caller.
 */
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

/**
 * The DECLARED, DOCUMENTED selection rule for which §2 verified facts travel
 * with a packet: a fact is "referenced by" this task's requirement excerpts
 * when its `claim` text appears, case-insensitively, as a substring of the
 * concatenated excerpt text. This is a real, checkable rule — not "all of
 * them" (which would defeat the whole point of a self-contained, bounded
 * packet) and not an unstated heuristic a reader would have to reverse
 * engineer from the code alone.
 */
function selectReferencedFacts(verifiedFacts: readonly VerifiedFact[], requirementExcerpts: readonly string[]): readonly VerifiedFact[] {
	const haystack = requirementExcerpts.join("\n\n").toLowerCase();
	return verifiedFacts.filter((fact) => haystack.includes(fact.claim.toLowerCase()));
}

/**
 * Build the packet for one task, pure: no `ctx`, no I/O, no model call.
 *
 * THROWS when `task.requirementIds` cites an id with no matching §3 entry in
 * `spec` — a packet built on a missing requirement is a silently
 * under-specified child, and `validatePlan`'s coverage direction two
 * (`plan-schema.ts:477-487`) should already have prevented a task from
 * citing an id the SPEC never declared at all; reaching here means either
 * that invariant broke, or the §3 body names the id without this
 * repository's own `"R<id>:"` entry convention (see
 * {@link parseRequirementEntries}'s own docstring). THROWS, for the
 * identical "this should already be impossible" reason, when the task
 * carries no file path or no verification command — `validatePlan`'s
 * branches (4)/(5) already require both before a `PlanArtifact` can exist.
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

// ---------------------------------------------------------------------------
// renderHandoffPacket — the text a child would actually receive
// ---------------------------------------------------------------------------

/**
 * Render a {@link HandoffPacket} as the text a real child executor would
 * receive, accumulator-style (`renderReviewMarkdown`'s shape,
 * `review-schema.ts:526-579`): a `string[]` pushed to per section, joined
 * with `"\n"`. This is what {@link measurePacketDelta} measures.
 */
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

// ---------------------------------------------------------------------------
// measurePacketDelta — the real measurement, never an assertion
// ---------------------------------------------------------------------------

/** {@link measurePacketDelta}'s return shape. */
export interface PacketDeltaMeasurement {
	readonly packetTokens: number;
	readonly parentTokens: number;
	readonly deltaTokens: number;
	readonly method: string;
}

/**
 * Measure a rendered packet against the parent-context text it would
 * replace, using Phase 2's own char-based estimator
 * (`estimateTokensFromChars`, `.pi/extensions/diagnostics/budget.ts:223-225`
 * -- `Math.ceil(chars/4)`, Pi's own heuristic, not a tokenizer; no tokenizer
 * dependency exists or may be added, per that file's own docstring).
 *
 * THIS FUNCTION MEASURES. IT DOES NOT ASSERT. `deltaTokens` is
 * `packetTokens - parentTokens`; a negative result means the packet is
 * SMALLER than the parent context it replaces (criterion 5's claimed
 * "negative tokens"), a positive result means it is larger. Both are real,
 * recordable outcomes -- neither this function nor its own caller may treat
 * either sign as a target to tune the fixture toward.
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
