/**
 * The wire and turns logs on disk prove the model a mode named really served the next turn, for the executor and for a
 * single-shot role; a spy on `setModel` would prove only intent. Two switches to different models, rows sliced by
 * position (every main-loop row's role is "session"), single-shot rows joined by `corr` with a never-routed negative
 * control. Subagent routing is out of reach: a subagent is a separate process with its own logs.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SESSION_TURN_ROLE } from "../../.pi/extensions/diagnostics/index.ts";
import { logPath } from "../../.pi/extensions/diagnostics/jsonl.ts";
import { TURNS_LOG_BASE, WIRE_LOG_BASE, type RowKind, type WireKind } from "../../.pi/extensions/diagnostics/schema.ts";
import { runSingleShotRole, setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
import { ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";
import { buildOpenAiFixturePayload, wrapFauxWithPayload } from "../helpers/faux.ts";
import { repoRoot } from "../helpers/git.ts";
import { readTornSafe } from "../helpers/logs.ts";
import { createFauxSession, waitForConfiguredAuth } from "../helpers/session.ts";

/** Absolute paths of the two extensions this repository ships, composed into one fixture. */
const DIAGNOSTICS_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;
const ROUTING_ENTRY = `${repoRoot()}/.pi/extensions/routing/index.ts`;

/** The real diagnostics and routing extensions, composed exactly as production loads them. */
const EXTENSION_SOURCE = [
	"// Generated for tests/integration/wire-proof.test.ts. Lives in a temp dir.",
	`import diagnostics from ${JSON.stringify(DIAGNOSTICS_ENTRY)};`,
	`import routing from ${JSON.stringify(ROUTING_ENTRY)};`,
	"",
	"export default function (pi) {",
	"\tdiagnostics(pi);",
	"\trouting(pi);",
	"}",
].join("\n");

/** A turns row as this file reads it back off disk. */
interface TurnsRow {
	kind?: RowKind;
	role?: string;
	corr?: string;
	provider?: string;
	model?: string;
}

/** A wire record as this file reads it back off disk. */
interface WireRow {
	kind?: WireKind;
	corr?: string;
	role?: string;
	payload?: Record<string, unknown>;
}

/** Read a log that may not exist yet — absence is a finding, not an exception. */
function readRows<T>(file: string): T[] {
	if (!existsSync(file)) {
		return [];
	}
	const { records, unparseable } = readTornSafe(file);
	if (unparseable.length > 0) {
		throw new Error(`${file} holds ${unparseable.length} unparseable line(s): ${unparseable[0]}`);
	}
	return records as T[];
}

/** Only the rows `turn_end` writes: `kind:"turn"`. Error/session rows carry no `kind`. */
function turnKindRows(rows: readonly TurnsRow[]): TurnsRow[] {
	return rows.filter((row) => row.kind === "turn");
}

/** A model registered on this fixture's `deepseek` faux provider that no route ever selects. */
const NEVER_ROUTED_MODEL_ID = "kypi-wire-proof-never-routed-negative-control";

/** What the whole fixture produced, read once and asserted on by every case below. */
interface Run {
	balancedExecutor: { provider: string; id: string };
	maxExecutor: { provider: string; id: string };
	reviewerModel: { provider: string; id: string };

	turnsCountBeforeSwitch1: number;
	newTurnRowsAfterSwitch1: TurnsRow[];
	firstTurnRowAfterSwitch1: TurnsRow | undefined;

	turnsCountBeforeSwitch2: number;
	newTurnRowsAfterSwitch2: TurnsRow[];
	firstTurnRowAfterSwitch2: TurnsRow | undefined;

	allMainLoopTurnRows: TurnsRow[];

	mainRequestForSwitch1: WireRow | undefined;
	mainRequestForSwitch2: WireRow | undefined;
	mainLoopWireRecords: WireRow[];

	nestedTurnRow: TurnsRow | undefined;
	nestedWireRecords: WireRow[];

	advisorRef: { provider: string; id: string };
	executorModelAtAdvisorCall: { provider: string | undefined; id: string | undefined };
	turnsAfterAdvisor: TurnsRow[];
	wireAfterAdvisor: WireRow[];
	advisorTurnRow: TurnsRow | undefined;
	advisorWireRecords: WireRow[];

	fullTurnsRaw: string;
	fullWireRaw: string;
}

async function runFixture(): Promise<Run> {
	// Deterministic starting state: another test file in this worker may have set the shared mode slot.
	setMode("cheap");
	setEscalated(false);

	const balancedExecutor = ROLE_MAP.balanced.executor.candidates[0];
	const maxExecutor = ROLE_MAP.max.executor.candidates[0];
	const reviewerModel = ROLE_MAP.max.reviewer.candidates[0];
	if (balancedExecutor === undefined || maxExecutor === undefined || reviewerModel === undefined) {
		throw new Error(
			"routing/schema.ts's ROLE_MAP no longer has a first candidate for balanced.executor, " +
				"max.executor or max.reviewer -- this fixture's own model choices depend on those entries",
		);
	}
	if (balancedExecutor.id === maxExecutor.id) {
		throw new Error(
			"balanced and max resolve the SAME executor model id in ROLE_MAP -- the two-switches proof " +
				"below needs two different observed models, or it would hold even for a router that does " +
				"nothing",
		);
	}
	if (reviewerModel.provider === maxExecutor.provider && reviewerModel.id === maxExecutor.id) {
		throw new Error(
			"max's reviewer route resolves the SAME model as max's executor route -- the single-shot " +
				"proof below needs the nested call to name a DIFFERENT model than the session's executor, " +
				"or a nested row naming the right model would prove nothing about routing",
		);
	}

	const handle = await createFauxSession({ extensionSource: EXTENSION_SOURCE });

	try {
		// ---- the executor-tier faux provider: both candidates ROLE_MAP names ---
		const executorFaux = fauxProvider({
			provider: balancedExecutor.provider,
			models: [
				{ id: balancedExecutor.id, reasoning: true, input: ["text"], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } },
				{ id: maxExecutor.id, reasoning: true, input: ["text"], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } },
				// The negative control: registered, resolvable, and never a member of
				// any candidate list any route in this fixture resolves.
				{ id: NEVER_ROUTED_MODEL_ID, reasoning: true, input: ["text"], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.5 } },
			],
		});
		executorFaux.setResponses([
			fauxAssistantMessage("balanced-turn-reply", { stopReason: "stop" }),
			fauxAssistantMessage("max-turn-reply", { stopReason: "stop" }),
		]);
		handle.modelRuntime.registerNativeProvider(wrapFauxWithPayload(executorFaux, buildOpenAiFixturePayload));
		await handle.modelRuntime.setRuntimeApiKey(balancedExecutor.provider, "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, balancedExecutor.provider);

		// ---- the single-shot faux provider: a model different from every ----
		// ---- executor candidate above, so the nested proof is not vacuous ----
		const reviewerFaux = fauxProvider({
			provider: reviewerModel.provider,
			models: [{ id: reviewerModel.id, reasoning: true, input: ["text", "image"], cost: { input: 3, output: 6, cacheRead: 0.3, cacheWrite: 4.5 } }],
		});
		reviewerFaux.setResponses([fauxAssistantMessage("reviewer-nested-reply", { stopReason: "stop" })]);
		handle.modelRuntime.registerNativeProvider(wrapFauxWithPayload(reviewerFaux, buildOpenAiFixturePayload));
		await handle.modelRuntime.setRuntimeApiKey(reviewerModel.provider, "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, reviewerModel.provider);

		const ctx = handle.session.extensionRunner.createCommandContext();
		const turnsFile = logPath(handle.cwd, TURNS_LOG_BASE);
		const wireFile = logPath(handle.cwd, WIRE_LOG_BASE);

		// =====================================================================
		// TASK 1 — the executor path: two switches, two models, position-sliced
		// =====================================================================

		// ---- switch 1: balanced --------------------------------------------
		const balancedCommand = handle.session.extensionRunner.getCommand("balanced");
		if (balancedCommand === undefined) {
			throw new Error('getCommand("balanced") returned undefined -- the routing extension did not register it');
		}
		const turnsCountBeforeSwitch1 = turnKindRows(readRows<TurnsRow>(turnsFile)).length;

		await balancedCommand.handler("", ctx);
		await handle.session.prompt("first turn, after switching to balanced");

		const turnRowsAfterSwitch1 = turnKindRows(readRows<TurnsRow>(turnsFile));
		const newTurnRowsAfterSwitch1 = turnRowsAfterSwitch1.slice(turnsCountBeforeSwitch1);
		const firstTurnRowAfterSwitch1 = newTurnRowsAfterSwitch1[0];

		const wireAfterSwitch1 = readRows<WireRow>(wireFile);
		const mainRequestForSwitch1 = wireAfterSwitch1.find(
			(record) => record.kind === "main.request" && record.corr === firstTurnRowAfterSwitch1?.corr,
		);

		// ---- switch 2: max ---------------------------------------------------
		const maxCommand = handle.session.extensionRunner.getCommand("max");
		if (maxCommand === undefined) {
			throw new Error('getCommand("max") returned undefined -- the routing extension did not register it');
		}
		const turnsCountBeforeSwitch2 = turnRowsAfterSwitch1.length;

		await maxCommand.handler("", ctx);
		await handle.session.prompt("second turn, after switching to max");

		const turnRowsAfterSwitch2 = turnKindRows(readRows<TurnsRow>(turnsFile));
		const newTurnRowsAfterSwitch2 = turnRowsAfterSwitch2.slice(turnsCountBeforeSwitch2);
		const firstTurnRowAfterSwitch2 = newTurnRowsAfterSwitch2[0];

		const wireAfterSwitch2 = readRows<WireRow>(wireFile);
		const mainRequestForSwitch2 = wireAfterSwitch2.find(
			(record) => record.kind === "main.request" && record.corr === firstTurnRowAfterSwitch2?.corr,
		);

		const allMainLoopTurnRows = turnRowsAfterSwitch2;
		const mainLoopWireRecords = wireAfterSwitch2.filter((record) => (record.kind ?? "").startsWith("main."));

		// =====================================================================
		// TASK 2 — the single-shot path: reviewer, joined by corr, negative control
		// =====================================================================

		const turnsCountBeforeNested = readRows<TurnsRow>(turnsFile).length;

		await runSingleShotRole(ctx, {
			role: "reviewer",
			messages: [{ role: "user", content: "please review this change", timestamp: Date.now() }],
		});

		const turnsAfterNested = readRows<TurnsRow>(turnsFile);
		const wireAfterNested = readRows<WireRow>(wireFile);
		const nestedTurnRow = turnsAfterNested
			.slice(turnsCountBeforeNested)
			.find((row) => row.kind === "nested" && row.role === "reviewer");
		const nestedWireRecords = nestedTurnRow === undefined ? [] : wireAfterNested.filter((record) => record.corr === nestedTurnRow.corr);

		// cheap.advisor: its first candidate is no CHAIN member and differs from balanced.advisor, so no other route here
		// can be mistaken for it.

		// Back on balanced first, so the session executor (flash tier) cannot equal cheap.advisor's pro-tier candidate.
		await balancedCommand.handler("", ctx);
		// Set the routing state directly: the claim is cheap's role map, not the /cheap command, which Task 1 covers.
		setMode("cheap");
		setEscalated(false);

		const advisorRef = ROLE_MAP.cheap.advisor.candidates[0];
		if (advisorRef === undefined) {
			throw new Error("ROLE_MAP.cheap.advisor has no first candidate -- this fixture's own assumption failed");
		}

		const executorModelAtAdvisorCall = { provider: ctx.model?.provider, id: ctx.model?.id };

		// Same ModelRef as maxExecutor, so it resolves against the already-authed provider; one more scripted response.
		executorFaux.appendResponses([fauxAssistantMessage("advisor-nested-reply", { stopReason: "stop" })]);

		const turnsCountBeforeAdvisor = readRows<TurnsRow>(turnsFile).length;

		await runSingleShotRole(ctx, {
			role: "advisor",
			messages: [{ role: "user", content: "please advise on this change", timestamp: Date.now() }],
		});

		const turnsAfterAdvisor = readRows<TurnsRow>(turnsFile);
		const wireAfterAdvisor = readRows<WireRow>(wireFile);
		const advisorTurnRow = turnsAfterAdvisor
			.slice(turnsCountBeforeAdvisor)
			.find((row) => row.kind === "nested" && row.role === "advisor");
		const advisorWireRecords =
			advisorTurnRow === undefined ? [] : wireAfterAdvisor.filter((record) => record.corr === advisorTurnRow.corr);

		return {
			balancedExecutor,
			maxExecutor,
			reviewerModel,
			turnsCountBeforeSwitch1,
			newTurnRowsAfterSwitch1,
			firstTurnRowAfterSwitch1,
			turnsCountBeforeSwitch2,
			newTurnRowsAfterSwitch2,
			firstTurnRowAfterSwitch2,
			allMainLoopTurnRows,
			mainRequestForSwitch1,
			mainRequestForSwitch2,
			mainLoopWireRecords,
			nestedTurnRow,
			nestedWireRecords,
			advisorRef,
			executorModelAtAdvisorCall,
			turnsAfterAdvisor,
			wireAfterAdvisor,
			advisorTurnRow,
			advisorWireRecords,
			fullTurnsRaw: JSON.stringify(turnsAfterAdvisor),
			fullWireRaw: JSON.stringify(wireAfterAdvisor),
		};
	} finally {
		await handle.dispose();
	}
}

let run: Run;
let settingsDir: string;
// Captured so `afterAll` restores the suite's PI_CODING_AGENT_DIR guard (tests/setup/agent-dir.ts) rather than deleting it.
let suiteAgentDir: string | undefined;

describe("ROUTE-10 -- the wire dump proves the intended model served the turn", () => {
	beforeAll(async () => {
		// A successful switch writes settings.subagents.agentOverrides, which would otherwise land in this machine's real settings.
		suiteAgentDir = process.env.PI_CODING_AGENT_DIR;
		settingsDir = mkdtempSync(join(tmpdir(), "kypi-wire-proof-settings-"));
		process.env.PI_CODING_AGENT_DIR = settingsDir;
		// The fixture registers the bare Bedrock id, so the inference-profile prefix is switched off.
		writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ kyPiAgent: { bedrockProfilePrefix: "" } }), "utf-8");
		run = await runFixture();
	}, 60_000);

	afterAll(() => {
		if (suiteAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = suiteAgentDir;
		}
		rmSync(settingsDir, { recursive: true, force: true, maxRetries: 3 });
	});

	// -------------------------------------------------------------------------
	// Task 1 -- the executor path
	// -------------------------------------------------------------------------

	it("case 1 -- switching to balanced and running a turn leaves the FIRST new kind:\"turn\" row naming balanced's executor model", () => {
		expect(
			run.newTurnRowsAfterSwitch1.length,
			`no kind:"turn" row appeared after the switch to balanced and a prompt (before-count was ` +
				`${run.turnsCountBeforeSwitch1}); the rows-after-switch slice is empty and every ` +
				"assertion below would be vacuous",
		).toBeGreaterThan(0);

		expect(run.firstTurnRowAfterSwitch1, "no first row to key the assertions below off of").toBeDefined();
		expect(
			run.firstTurnRowAfterSwitch1?.role,
			`the row carried role ${JSON.stringify(run.firstTurnRowAfterSwitch1?.role)} instead of ` +
				`${JSON.stringify(SESSION_TURN_ROLE)} -- a reader could mistake this for a role-filtered ` +
				"read, which is exactly RESEARCH's Pitfall 1",
		).toBe(SESSION_TURN_ROLE);
		expect(
			run.firstTurnRowAfterSwitch1?.provider,
			"the turn row's provider does not name balanced's executor candidate",
		).toBe(run.balancedExecutor.provider);
		expect(
			run.firstTurnRowAfterSwitch1?.model,
			"the turn row's model does not name balanced's executor candidate -- the mode switch did " +
				"not change which model actually served the next turn",
		).toBe(run.balancedExecutor.id);
	});

	it("case 2 -- switching to max and running a second turn leaves a DIFFERENT model on the next new turn row", () => {
		expect(
			run.newTurnRowsAfterSwitch2.length,
			`no kind:"turn" row appeared after the switch to max and a second prompt (before-count was ` +
				`${run.turnsCountBeforeSwitch2}); the rows-after-switch slice is empty`,
		).toBeGreaterThan(0);

		expect(run.firstTurnRowAfterSwitch2, "no first row to key the assertions below off of").toBeDefined();
		expect(run.firstTurnRowAfterSwitch2?.role).toBe(SESSION_TURN_ROLE);
		expect(
			run.firstTurnRowAfterSwitch2?.provider,
			"the turn row's provider does not name max's executor candidate",
		).toBe(run.maxExecutor.provider);
		expect(
			run.firstTurnRowAfterSwitch2?.model,
			"the turn row's model does not name max's executor candidate",
		).toBe(run.maxExecutor.id);

		// Two switches to two different observed models: one switch holds even for a router that does nothing.
		expect(
			run.firstTurnRowAfterSwitch2?.model,
			"the two switches produced the SAME observed model on the wire -- the proof above would " +
				"hold even for a router that never actually changed anything",
		).not.toBe(run.firstTurnRowAfterSwitch1?.model);
	});

	it("case 3 -- the main.request wire record for each executor turn names the same model as its turn row, cross-checked independently", () => {
		expect(
			run.mainRequestForSwitch1,
			"no main.request wire record shares a correlation id with the balanced-mode turn row -- the " +
				"two logs cannot be joined for this turn",
		).toBeDefined();
		expect(
			run.mainRequestForSwitch1?.payload?.model,
			"the main.request payload for the balanced-mode turn does not name the model the turn row " +
				"itself claims -- two independently-written records disagree",
		).toBe(run.balancedExecutor.id);

		expect(
			run.mainRequestForSwitch2,
			"no main.request wire record shares a correlation id with the max-mode turn row",
		).toBeDefined();
		expect(
			run.mainRequestForSwitch2?.payload?.model,
			"the main.request payload for the max-mode turn does not name the model the turn row itself " +
				"claims",
		).toBe(run.maxExecutor.id);
	});

	it("case 4 -- every main-loop turn row this session produced carries role: SESSION_TURN_ROLE, and none is ever filtered by role:\"executor\"", () => {
		expect(
			run.allMainLoopTurnRows.length,
			"no main-loop turn rows were collected across both switches, so the loop below iterates " +
				"nothing and this case proves nothing",
		).toBeGreaterThan(0);

		for (const row of run.allMainLoopTurnRows) {
			expect(
				row.role,
				`a main-loop row carried role ${JSON.stringify(row.role)} -- the executor path is proven ` +
					'by provider/model on the next kind:"turn" row, never by filtering on role:"executor", ' +
					"which finds zero rows and passes vacuously",
			).toBe(SESSION_TURN_ROLE);
		}
	});

	// -------------------------------------------------------------------------
	// Task 2 -- the single-shot path
	// -------------------------------------------------------------------------

	it("case 5 -- runSingleShotRole(reviewer) leaves exactly one nested turn row naming a model DIFFERENT from the session's executor", () => {
		expect(
			run.nestedTurnRow,
			"no kind:\"nested\" row with role \"reviewer\" appeared after runSingleShotRole -- either the " +
				"call never dispatched or the row never reached disk",
		).toBeDefined();
		expect(run.nestedTurnRow?.provider, "the nested row's provider does not name the reviewer route's model").toBe(
			run.reviewerModel.provider,
		);
		expect(run.nestedTurnRow?.model, "the nested row's model does not name the reviewer route's model").toBe(
			run.reviewerModel.id,
		);

		// The proof that this is routing and not coincidence: the session's own
		// executor at this point is max's model, a DIFFERENT one.
		expect(
			run.nestedTurnRow?.model,
			"the nested row's model is the SAME as the session's own executor model -- a nested row " +
				"naming the right model would prove nothing about routing if the two were never distinct",
		).not.toBe(run.maxExecutor.id);
	});

	it("case 6 -- the nested wire records, joined by corr (never by position), share the reviewer row's model on the wire", () => {
		expect(
			run.nestedWireRecords.length,
			"no wire records share the nested turn row's correlation id -- the join by corr found nothing",
		).toBeGreaterThan(0);

		const nestedRequest = run.nestedWireRecords.find((record) => record.kind === "nested.request");
		expect(nestedRequest, "no nested.request record was found among the corr-joined wire records").toBeDefined();
		expect(
			nestedRequest?.payload?.model,
			"the nested.request payload does not name the reviewer route's model",
		).toBe(run.reviewerModel.id);

		for (const record of run.nestedWireRecords) {
			expect(
				record.role,
				`a nested wire record joined by corr carried role ${JSON.stringify(record.role)} instead of ` +
					'"reviewer"',
			).toBe("reviewer");
		}
	});

	it("case 7 -- the main-loop wire records in this session carry NO role field at all, unlike the nested ones", () => {
		expect(
			run.mainLoopWireRecords.length,
			"no main-loop wire records were collected, so the loop below iterates nothing",
		).toBeGreaterThan(0);

		for (const record of run.mainLoopWireRecords) {
			expect(
				Object.keys(record),
				"a main.* wire record carries a role key -- only the nested path stamps role, so a " +
					"reader who finds one on a main.* record would misread which mechanism produced it",
			).not.toContain("role");
		}

		expect(
			run.nestedWireRecords.some((record) => record.role === "reviewer"),
			"none of the nested wire records carried role:\"reviewer\" -- the contrast this case makes " +
				"would be comparing nothing against nothing",
		).toBe(true);
	});

	it("case 8 -- the nested call's correlation id differs from the surrounding main-loop turns' correlation ids", () => {
		const mainLoopCorrs = new Set(run.allMainLoopTurnRows.map((row) => row.corr));
		expect(mainLoopCorrs.size, "no main-loop correlation ids were collected to compare against").toBeGreaterThan(0);

		expect(
			run.nestedTurnRow?.corr,
			"the nested row carries no correlation id at all",
		).toBeTruthy();
		expect(
			mainLoopCorrs.has(run.nestedTurnRow?.corr ?? ""),
			"the nested call's correlation id collides with a main-loop turn's -- the two mechanisms " +
				"would be indistinguishable in the log",
		).toBe(false);
	});

	it("case 9 -- the negative control: a registered-but-never-routed model appears in NEITHER log, proving the reader reads", () => {
		expect(
			run.fullTurnsRaw.length,
			"the turns log capture is empty, so the absence check below would be vacuous",
		).toBeGreaterThan(0);
		expect(
			run.fullWireRaw.length,
			"the wire log capture is empty, so the absence check below would be vacuous",
		).toBeGreaterThan(0);

		expect(
			run.fullTurnsRaw.includes(NEVER_ROUTED_MODEL_ID),
			"the never-routed model id appears in the turns log even though no route in this fixture " +
				"ever selected it",
		).toBe(false);
		expect(
			run.fullWireRaw.includes(NEVER_ROUTED_MODEL_ID),
			"the never-routed model id appears in the wire log even though no route in this fixture " +
				"ever selected it",
		).toBe(false);

		// THE PAIRED POSITIVE. Without it, an instrument that captured nothing at
		// all would satisfy the two absences above just as well as a working one.
		expect(
			run.fullTurnsRaw.includes(run.maxExecutor.id) && run.fullWireRaw.includes(run.maxExecutor.id),
			"a model that WAS routed in this fixture (max's executor) is absent from one of the logs -- " +
				"the negative control above would be passing over a reader that finds nothing at all",
		).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Task 3 -- cheap's own leg
	// -------------------------------------------------------------------------

	it('case 10 -- cheap.advisor leaves exactly one nested turn row naming cheap\'s OWN route, not a CHAIN member and not the session\'s executor', () => {
		// Non-vacuity FIRST.
		expect(
			run.turnsAfterAdvisor.length,
			"no rows were captured after the advisor call at all, so the lookup below is searching nothing",
		).toBeGreaterThan(0);

		expect(
			run.advisorTurnRow,
			'no kind:"nested" row with role "advisor" appeared after runSingleShotRole -- either the call ' +
				"never dispatched or the row never reached disk",
		).toBeDefined();
		expect(
			run.advisorTurnRow?.provider,
			"the nested advisor row's provider does not name cheap.advisor's own resolved candidate",
		).toBe(run.advisorRef.provider);
		expect(
			run.advisorTurnRow?.model,
			"cheap's advisor route did not serve the turn -- the nested row's model does not name " +
				"cheap.advisor's own resolved candidate",
		).toBe(run.advisorRef.id);

		// Routing, not the session's own executor leaking through: the fixture made the two ids distinct.
		expect(
			run.advisorTurnRow?.model,
			"the nested advisor row's model is the SAME as the session's own executor model at the time " +
				"of the call -- a nested row naming the right model would prove nothing about cheap's OWN " +
				"role map if the two were never distinct",
		).not.toBe(run.executorModelAtAdvisorCall.id);

		// Not a CHAIN member, so this cannot pass on callWithFallback's restart-at-CHAIN[0] path.
		expect(run.advisorRef.id).not.toBe("deepseek-flash");
	});

	it("case 11 -- the advisor call's nested.request wire record, joined by corr, independently names the same model", () => {
		expect(
			run.advisorWireRecords.length,
			"no wire records share the advisor turn row's correlation id -- the join by corr found nothing",
		).toBeGreaterThan(0);

		const advisorRequest = run.advisorWireRecords.find((record) => record.kind === "nested.request");
		expect(advisorRequest, "no nested.request record was found among the corr-joined wire records").toBeDefined();
		expect(
			advisorRequest?.payload?.model,
			"the nested.request payload does not name cheap.advisor's own resolved candidate -- the two " +
				"independently-written records disagree",
		).toBe(run.advisorRef.id);

		for (const record of run.advisorWireRecords) {
			expect(
				record.role,
				`a nested wire record joined by corr carried role ${JSON.stringify(record.role)} instead of ` +
					'"advisor"',
			).toBe("advisor");
		}
	});
});
