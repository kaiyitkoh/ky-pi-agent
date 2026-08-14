/**
 * ROUTE-10 — the wire dump proves the model a mode intended is the model that
 * actually served the next turn. This file starts with the executor half:
 * `/balanced` and `/max`, driven twice, read back from `turns-*.jsonl` and
 * `wire-*.jsonl`. The single-shot half (`runSingleShotRole`) is added by a
 * later commit in this same plan, which extends this file rather than
 * duplicating its fixture.
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
 * in `routing/schema.ts`'s `ROLE_MAP` (`deepseek-v4-flash` vs
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
import { setEscalated, setMode } from "../../.pi/extensions/routing/modes.ts";
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

/** What the whole fixture produced, read once and asserted on by every case below. */
interface Run {
	balancedExecutor: { provider: string; id: string };
	maxExecutor: { provider: string; id: string };

	turnsCountBeforeSwitch1: number;
	newTurnRowsAfterSwitch1: TurnsRow[];
	firstTurnRowAfterSwitch1: TurnsRow | undefined;

	turnsCountBeforeSwitch2: number;
	newTurnRowsAfterSwitch2: TurnsRow[];
	firstTurnRowAfterSwitch2: TurnsRow | undefined;

	allMainLoopTurnRows: TurnsRow[];

	mainRequestForSwitch1: WireRow | undefined;
	mainRequestForSwitch2: WireRow | undefined;
}

async function runFixture(): Promise<Run> {
	// Deterministic starting state regardless of which other test file in this
	// worker touched the shared globalThis mode slot first (routing/modes.ts's
	// own STATE-SLOT HAZARD documentation).
	setMode("cheap");
	setEscalated(false);

	const balancedExecutor = ROLE_MAP.balanced.executor.candidates[0];
	const maxExecutor = ROLE_MAP.max.executor.candidates[0];
	if (balancedExecutor === undefined || maxExecutor === undefined) {
		throw new Error(
			"routing/schema.ts's ROLE_MAP no longer has a first candidate for balanced.executor or " +
				"max.executor -- this fixture's own model choices depend on those entries",
		);
	}
	if (balancedExecutor.id === maxExecutor.id) {
		throw new Error(
			"balanced and max resolve the SAME executor model id in ROLE_MAP -- the two-switches proof " +
				"below needs two different observed models, or it would hold even for a router that does " +
				"nothing",
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
			],
		});
		executorFaux.setResponses([
			fauxAssistantMessage("balanced-turn-reply", { stopReason: "stop" }),
			fauxAssistantMessage("max-turn-reply", { stopReason: "stop" }),
		]);
		handle.modelRuntime.registerNativeProvider(wrapFauxWithPayload(executorFaux, buildOpenAiFixturePayload));
		await handle.modelRuntime.setRuntimeApiKey(balancedExecutor.provider, "kypi-fixture-not-a-real-key");
		await waitForConfiguredAuth(handle.modelRuntime, balancedExecutor.provider);

		const ctx = handle.session.extensionRunner.createCommandContext();
		const turnsFile = logPath(handle.cwd, TURNS_LOG_BASE);
		const wireFile = logPath(handle.cwd, WIRE_LOG_BASE);

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

		return {
			balancedExecutor,
			maxExecutor,
			turnsCountBeforeSwitch1,
			newTurnRowsAfterSwitch1,
			firstTurnRowAfterSwitch1,
			turnsCountBeforeSwitch2,
			newTurnRowsAfterSwitch2,
			firstTurnRowAfterSwitch2,
			allMainLoopTurnRows,
			mainRequestForSwitch1,
			mainRequestForSwitch2,
		};
	} finally {
		await handle.dispose();
	}
}

let run: Run;
let settingsDir: string;

describe("ROUTE-10 -- the wire dump proves the intended model served the turn", () => {
	beforeAll(async () => {
		// See the module docstring's "WHY PI_CODING_AGENT_DIR IS SET" section --
		// a successful executor switch also writes settings.subagents.
		// agentOverrides, which defaults to this machine's real global Pi
		// settings file when this variable is unset.
		settingsDir = mkdtempSync(join(tmpdir(), "kypi-wire-proof-settings-"));
		process.env.PI_CODING_AGENT_DIR = settingsDir;
		run = await runFixture();
	}, 60_000);

	afterAll(() => {
		delete process.env.PI_CODING_AGENT_DIR;
		rmSync(settingsDir, { recursive: true, force: true, maxRetries: 3 });
	});

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
});
