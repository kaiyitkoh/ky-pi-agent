/**
 * ROUTE-10 — the wire dump proves the model a mode intended is the model that
 * actually served the next turn, for both routed mechanisms this repository
 * has: the executor (`/balanced`, `/max`) and a single-shot role
 * (`runSingleShotRole`).
 *
 * ---------------------------------------------------------------------------
 * THE FILE'S CONTRACT, IN ONE LINE
 * ---------------------------------------------------------------------------
 * A spy proves intent; the wire record proves service. Every assertion below
 * reads `turns-*.jsonl` and `wire-*.jsonl` off disk — the bytes Phase 2's
 * chokepoint and main-loop hooks actually wrote — and NONE of it may be
 * replaced by a spy on Pi's own `setModel` entry point, however convenient a
 * future refactor makes that. A test asserting "`setModel` was called" proves
 * the harness's intent; this file proves the request that followed really
 * carried the model the switch named. This file contains no assertion on
 * whether `setModel` was called at all — the acceptance grep for that
 * literal, run outside this header, must report zero.
 *
 * ---------------------------------------------------------------------------
 * THE EXECUTOR HALF — TWO SWITCHES, NOT ONE (RESEARCH Pitfall 1)
 * ---------------------------------------------------------------------------
 * A single switch proves nothing: if the session's starting model already
 * happened to be the target, the "proof" would hold even for a router that
 * does nothing. `/balanced` and `/max` resolve DIFFERENT executor candidates
 * in `routing/schema.ts`'s `ROLE_MAP` (`deepseek-flash` vs
 * `deepseek-v4-pro`), so driving both and asserting the two observed models
 * differ is what makes either assertion mean anything.
 *
 * Every row lookup below is sliced by POSITION — the count of `kind:"turn"`
 * rows present before a switch, and the rows that appear after it — never by
 * filtering on `role`. `diagnostics/index.ts`'s own `SESSION_TURN_ROLE`
 * constant is what every main-loop row carries, always `"session"`; a filter
 * on `role === "executor"` would find zero rows and pass having proven
 * nothing, which RESEARCH names as the single most likely way this file could
 * be green and worthless. Case 4 below asserts `role` equals that constant
 * explicitly, on every main-loop row this fixture produces, and never filters
 * on anything else.
 *
 * ---------------------------------------------------------------------------
 * THE SINGLE-SHOT HALF — JOINED BY `corr`, WITH A NEGATIVE CONTROL
 * ---------------------------------------------------------------------------
 * The single-shot role's model (`reviewer`, resolved to Bedrock Claude in
 * `max` mode) is deliberately DIFFERENT from the session's executor model at
 * that point (`deepseek/deepseek-v4-pro`) — if they were the same, a nested
 * row naming the right model would prove nothing about routing having
 * happened at all. Nested and main-loop records are joined by `corr`
 * explicitly, never by array position: `wire.ts`'s own module docstring
 * states the serial-loop assumption behind correlation ids, and a
 * position-based join would quietly depend on that assumption in a way a
 * future concurrent path would break without this file ever noticing.
 *
 * A third, registered-but-never-routed model is asserted absent from BOTH
 * logs. Phase 2 and Phase 3 both recorded that a presence assertion with no
 * paired absence, or an absence with no paired presence, can be satisfied by
 * an instrument that reads nothing — this is that pairing for the reader
 * itself, not just for one fixture's data.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT PROVE
 * ---------------------------------------------------------------------------
 * Subagent-role routing (the `planner` role) is NOT provable from this
 * process's own wire log — a subagent is a SEPARATE `pi` process
 * (05-RESEARCH.md §A.2), so nothing this process writes to `turns-*`/`wire-*`
 * can say what model a subagent actually ran on. ROUTE-05's evidence is the
 * `settings.subagents.agentOverrides` write proven in
 * `tests/integration/mode-switch.test.ts` case 2 (plan 05-07) — a pin being
 * written correctly, not a subagent process having honoured it. Nor does this
 * file say anything about a real DeepSeek or Bedrock request: every model
 * here is `fauxProvider`, wrapped so it emits the request-shaped payload a
 * real adapter assembles (`tests/helpers/faux.ts`), which is realistic and is
 * not the real thing.
 *
 * ---------------------------------------------------------------------------
 * WHY `PI_CODING_AGENT_DIR` IS SET FOR EVERY CASE HERE
 * ---------------------------------------------------------------------------
 * A successful executor switch also writes `settings.subagents.agentOverrides`
 * (ROUTE-05, `routing/index.ts`'s own `applyMode`) to `getAgentDir()/
 * settings.json`, which defaults to this MACHINE's real global Pi settings
 * file when the environment variable is unset — exactly the trap
 * `tests/integration/mode-switch.test.ts` cases 2/4 already avoid by injecting
 * a temp directory. Every switch this file drives does the same.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
import { createFauxSession, type FauxSessionHandle } from "../helpers/session.ts";

/** Absolute paths of the two extensions this repository ships, composed into one fixture. */
const DIAGNOSTICS_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;
const ROUTING_ENTRY = `${repoRoot()}/.pi/extensions/routing/index.ts`;

/**
 * The user-scope extension under test: the real diagnostics extension (main-
 * loop turn/wire capture) plus the real routing extension (`/balanced`,
 * `/max`), composed exactly the way production loads them — one extension
 * calling both default exports, no probe and no shortcut.
 */
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

/**
 * Poll `modelRuntime.hasConfiguredAuth(providerId)` until it reports `true`.
 * Copied from `tests/integration/mode-switch.test.ts` — see that file's
 * header for the measured async gap this closes: a faux provider registered
 * under a real provider id resolves configured auth only after a handful of
 * milliseconds of polling, not synchronously after the grant resolves.
 */
async function waitForConfiguredAuth(
	modelRuntime: FauxSessionHandle["modelRuntime"],
	providerId: string,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (!modelRuntime.hasConfiguredAuth(providerId)) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(
				`waitForConfiguredAuth: ${providerId} never reported configured auth within ${timeoutMs}ms ` +
					"after setRuntimeApiKey resolved. See tests/integration/mode-switch.test.ts's header for " +
					"the measured async gap.",
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
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

	// WR-01: cheap's own leg -- see TASK 3 below.
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
	// Deterministic starting state regardless of which other test file in this
	// worker touched the shared globalThis mode slot first (routing/modes.ts's
	// own STATE-SLOT HAZARD documentation).
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

		// =====================================================================
		// TASK 3 — WR-01: cheap.advisor, closing the "cheap leg is unproven"
		// adjudication gap. `max.reviewer` above (Task 2) proves the single-
		// shot MECHANISM; it says nothing about `cheap`'s OWN role map, and
		// nothing anywhere else in this file ever serves a turn in cheap mode
		// at all. `ROLE_MAP.cheap.advisor`'s first candidate
		// (deepseek/deepseek-v4-pro) is deliberately NOT a `CHAIN` member
		// (CHAIN only knows deepseek-v4-FLASH) and is distinct from
		// `balanced.advisor`'s Bedrock Claude -- so this is a route no other
		// case in this file can be mistaken for.
		// =====================================================================

		// Switch back to balanced FIRST, purely so the session's own executor
		// sits on the FLASH tier (deepseek-v4-flash) -- a different id than
		// cheap.advisor's PRO-tier candidate (deepseek-v4-pro), which happens
		// to be byte-identical to max's OWN executor candidate. Without this,
		// "the advisor route differs from the session's own executor" would be
		// comparing deepseek-v4-pro against deepseek-v4-pro and would be
		// vacuously true for the wrong reason.
		await balancedCommand.handler("", ctx);
		// The routing module's OWN state, set directly (not via the /cheap
		// command) so this task exercises cheap's role map without a second
		// settings.json write or a second model_select event to reason about --
		// ROADMAP criterion 1's claim under test here is "cheap's role map
		// resolves and dispatches correctly", not "the /cheap command also
		// switches the executor", which Task 1's own two cases already prove
		// for balanced/max.
		setMode("cheap");
		setEscalated(false);

		const advisorRef = ROLE_MAP.cheap.advisor.candidates[0];
		if (advisorRef === undefined) {
			throw new Error("ROLE_MAP.cheap.advisor has no first candidate -- this fixture's own assumption failed");
		}

		const executorModelAtAdvisorCall = { provider: ctx.model?.provider, id: ctx.model?.id };

		// cheap.advisor's resolved candidate (deepseek/deepseek-v4-pro) is
		// byte-identical to maxExecutor's ModelRef, so it already resolves
		// against executorFaux's own registered "deepseek" native provider and
		// its already-granted auth -- no new provider registration needed, only
		// a third scripted response appended to the SAME queue Task 1's two
		// switches already consumed two entries from.
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
// WR-05 (iteration 3): captured so `afterAll` can RESTORE this suite's own
// `PI_CODING_AGENT_DIR` guard instead of `delete`-ing it -- see
// `tests/setup/agent-dir.ts`'s own docstring ("must restore this suite
// value afterward, never merely delete it -- deleting would punch a hole
// in this guard for the REST of that file's cases"). Matches the shape
// `mode-switch.test.ts` and `agent-overrides.test.ts` already use.
let suiteAgentDir: string | undefined;

describe("ROUTE-10 -- the wire dump proves the intended model served the turn", () => {
	beforeAll(async () => {
		// See the module docstring's "WHY PI_CODING_AGENT_DIR IS SET" section --
		// a successful executor switch also writes settings.subagents.
		// agentOverrides, which defaults to this machine's real global Pi
		// settings file when this variable is unset.
		suiteAgentDir = process.env.PI_CODING_AGENT_DIR;
		settingsDir = mkdtempSync(join(tmpdir(), "kypi-wire-proof-settings-"));
		process.env.PI_CODING_AGENT_DIR = settingsDir;
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

		// THE PROOF THAT MAKES CASE 1 MEAN ANYTHING: a single switch could hold
		// even for a router that does nothing, if the session's starting model
		// happened to already be the target. Two switches to two DIFFERENT
		// observed models is what closes that gap.
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
	// Task 3 -- WR-01: cheap's own leg, closed
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

		// Paired distinctness (WR-01's own requirement): this is ROUTING, not
		// the session's own executor model leaking through. The fixture
		// deliberately switched the executor back to balanced's flash-tier
		// model before this call so the two ids cannot coincide by construction
		// (see runFixture's own TASK 3 comment for why that switch is needed).
		expect(
			run.advisorTurnRow?.model,
			"the nested advisor row's model is the SAME as the session's own executor model at the time " +
				"of the call -- a nested row naming the right model would prove nothing about cheap's OWN " +
				"role map if the two were never distinct",
		).not.toBe(run.executorModelAtAdvisorCall.id);

		// CR-02's own concern, restated as a positive here: cheap.advisor's
		// candidate is NOT a CHAIN member (CHAIN only knows deepseek-v4-flash),
		// so this proof is NOT running through callWithFallback's
		// restart-at-CHAIN[0] path -- it is impossible for this assertion to
		// pass on the strength of a hardcoded chain head, unlike the reviewer
		// route WR-01 originally flagged.
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
