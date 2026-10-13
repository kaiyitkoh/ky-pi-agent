/**
 * routing/agent-overrides.ts against real files in temp directories: shape, refusals, sibling-key preservation and
 * idempotence. Every case passes an explicit settingsPath, so the real agent dir is never written. Refusals compare
 * bytes, since a writer that refuses and truncates looks like one that refuses cleanly; idempotence compares mtimeMs,
 * since rewriting identical bytes passes a content check.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
	agentOverridesFor,
	resolveSettingsPath,
	plannerPinHeld,
	readAgentOverride,
	restorePlannerPin,
	writeAgentOverrides,
	type AgentOverridesForOptions,
} from "../../.pi/extensions/routing/agent-overrides.ts";
import { AGENT_NAME_BY_ROLE, MODES, ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";

// -----------------------------------------------------------------------------
// Temp-dir hygiene
// -----------------------------------------------------------------------------

let tempDirs: string[] = [];

function freshSettingsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "kypi-agent-overrides-"));
	tempDirs.push(dir);
	return join(dir, "settings.json");
}

/** The suite-wide value tests/setup/agent-dir.ts set, restored rather than deleted so its guard holds for later cases. */
let suiteAgentDir: string | undefined;
beforeAll(() => {
	suiteAgentDir = process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	}
	tempDirs = [];
	if (suiteAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = suiteAgentDir;
	}
});

describe("agentOverridesFor -- Bedrock inference-profile prefix", () => {
	const BARE = "amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0";

	it("max pins the planner to the prefixed id that routing requests, default apac.", () => {
		const result = agentOverridesFor({ mode: "max" }, { settingsPath: freshSettingsPath() });
		expect(result.ok && result.overrides.planner?.model).toBe("amazon-bedrock/apac.anthropic.claude-sonnet-4-5-20250929-v1:0");
	});

	it('an empty prefix pins the bare id; another prefix is applied as written', () => {
		const bare = freshSettingsPath();
		writeFileSync(bare, JSON.stringify({ kyPiAgent: { bedrockProfilePrefix: "" } }), "utf-8");
		expect(agentOverridesFor({ mode: "max" }, { settingsPath: bare })).toEqual({ ok: true, overrides: expect.objectContaining({ planner: { model: BARE } }) });
		const us = freshSettingsPath();
		writeFileSync(us, JSON.stringify({ kyPiAgent: { bedrockProfilePrefix: "us." } }), "utf-8");
		const result = agentOverridesFor({ mode: "max" }, { settingsPath: us });
		expect(result.ok && result.overrides.planner?.model).toBe("amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0");
	});

	it("an invalid prefix setting refuses the pin, naming the setting", () => {
		const bad = freshSettingsPath();
		writeFileSync(bad, JSON.stringify({ kyPiAgent: { bedrockProfilePrefix: "APAC" } }), "utf-8");
		const result = agentOverridesFor({ mode: "max" }, { settingsPath: bad });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("bedrockProfilePrefix");
	});
});

// -----------------------------------------------------------------------------
// agentOverridesFor -- shape
// -----------------------------------------------------------------------------

describe("agentOverridesFor -- shape (ROUTE-05)", () => {
	it("returns ok:true with one entry per subagent-mechanism role, keyed by AGENT_NAME_BY_ROLE's values", () => {
		const expectedKeys = Object.values(AGENT_NAME_BY_ROLE).sort();
		expect(expectedKeys.length, "vacuity guard: AGENT_NAME_BY_ROLE must name at least one agent").toBeGreaterThan(0);

		const result = agentOverridesFor({ mode: "cheap" });
		expect(result.ok, `expected ok:true, got ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(Object.keys(result.overrides).sort()).toEqual(expectedKeys);
	});

	it("every entry's model carries a '/' separator (provider/id shape)", () => {
		const result = agentOverridesFor({ mode: "balanced" });
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		for (const [agentName, entry] of Object.entries(result.overrides)) {
			expect(entry.model, `${agentName}'s model must be "<provider>/<id>"-shaped`).toMatch(/^[^/]+\/[^/]+$/);
		}
	});

	it("max mode's override model differs from cheap's for at least one agent (non-vacuity)", () => {
		const cheap = agentOverridesFor({ mode: "cheap" });
		const max = agentOverridesFor({ mode: "max" });
		expect(cheap.ok).toBe(true);
		expect(max.ok).toBe(true);
		if (!cheap.ok || !max.ok) {
			return;
		}
		const differs = Object.keys(cheap.overrides).some(
			(agentName) => cheap.overrides[agentName]?.model !== max.overrides[agentName]?.model,
		);
		expect(differs, "cheap and max produced byte-identical overrides -- the map did not swap").toBe(true);
	});
});

// -----------------------------------------------------------------------------
// agentOverridesFor -- REGRESSION GATE over all three modes
// -----------------------------------------------------------------------------

describe("agentOverridesFor -- regression gate: the REAL ROLE_MAP never guard-blocks a subagent role", () => {
	it("is non-vacuous: MODES names at least the three expected modes", () => {
		expect(MODES.length).toBeGreaterThanOrEqual(3);
	});

	for (const mode of MODES) {
		it(`mode "${mode}": every real subagent-role pin resolves to ok:true`, () => {
			const result = agentOverridesFor({ mode });
			expect(
				result.ok,
				`mode "${mode}" produced a guard-blocked subagent pin: ` +
					`${result.ok ? "" : result.reason} -- this is the regression this gate exists to catch`,
			).toBe(true);
		});
	}
});

// -----------------------------------------------------------------------------
// agentOverridesFor -- paired negative (guard-blocked fixture, non-vacuity)
// -----------------------------------------------------------------------------

describe("agentOverridesFor -- guard-blocked fixture (ROUTE-08 wired through ROUTE-05)", () => {
	it("a fixture role map whose only planner candidate is a no-tool-calling model yields ok:false naming the role", () => {
		// The real ROLE_MAP with only planner's candidates replaced, so only the guard-blocked candidate is under test.
		const blockedRoleMap: AgentOverridesForOptions["roleMap"] = {
			cheap: {
				...ROLE_MAP.cheap,
				planner: { candidates: [{ provider: "amazon-bedrock", id: "us.deepseek.r1-v1:0" }] },
			},
			balanced: ROLE_MAP.balanced,
			max: ROLE_MAP.max,
		};

		const result = agentOverridesFor({ mode: "cheap" }, { roleMap: blockedRoleMap });

		expect(result.ok, `expected ok:false, got ${JSON.stringify(result)}`).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.reason).toContain("planner");
		expect(result.reason.toLowerCase()).toContain("tool calling");
	});

	it("writeAgentOverrides is never reached for a guard-blocked derivation -- no settings file is created", () => {
		// Proves only agentOverridesFor's own ok:false derivation. That the real caller never writes on it is proven by
		// tests/integration/mode-switch.test.ts, which drives /balanced against the same guard-blocked candidate.
		const settingsPath = freshSettingsPath();
		expect(existsSync(settingsPath), "vacuity guard: the fresh path must not already exist").toBe(false);

		const blockedRoleMap: AgentOverridesForOptions["roleMap"] = {
			cheap: {
				...ROLE_MAP.cheap,
				planner: { candidates: [{ provider: "amazon-bedrock", id: "us.deepseek.r1-v1:0" }] },
			},
			balanced: ROLE_MAP.balanced,
			max: ROLE_MAP.max,
		};

		const result = agentOverridesFor({ mode: "cheap" }, { roleMap: blockedRoleMap });
		expect(result.ok).toBe(false);

		expect(existsSync(settingsPath)).toBe(false);
	});
});

// -----------------------------------------------------------------------------
// resolveSettingsPath -- injected vs default
// -----------------------------------------------------------------------------

describe("resolveSettingsPath", () => {
	it("returns the injected settingsPath verbatim when given", () => {
		const injected = join(tmpdir(), "some-dir", "settings.json");
		expect(resolveSettingsPath({ settingsPath: injected })).toBe(injected);
	});

	it("resolves under PI_CODING_AGENT_DIR when no settingsPath is injected (the default branch)", () => {
		const dir = mkdtempSync(join(tmpdir(), "kypi-agent-dir-"));
		tempDirs.push(dir);
		process.env.PI_CODING_AGENT_DIR = dir;

		const resolved = resolveSettingsPath();

		expect(resolved.startsWith(dir), `expected "${resolved}" to resolve under "${dir}"`).toBe(true);
		expect(resolved.endsWith("settings.json")).toBe(true);
	});
});

// -----------------------------------------------------------------------------
// writeAgentOverrides -- creation, preservation, refusals, idempotence
// -----------------------------------------------------------------------------

describe("writeAgentOverrides -- creation", () => {
	it("writing into a missing file creates it with { subagents: { agentOverrides: {...} } }", () => {
		const settingsPath = freshSettingsPath();
		expect(existsSync(settingsPath)).toBe(false);

		const overrides = { planner: { model: "dashscope/deepseek-v4-flash" } };
		const result = writeAgentOverrides(overrides, { settingsPath });

		expect(result.ok, `expected ok:true, got ${JSON.stringify(result)}`).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.written).toBe(true);
		expect(existsSync(settingsPath)).toBe(true);

		const written = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(written).toEqual({
			subagents: { agentOverrides: overrides },
			kyPiAgent: { plannerPinRestore: { hadOverrides: false, keys: { planner: { had: false } }, owners: [{ pid: process.pid, at: expect.any(Number) }] } },
		});
	});
});

describe("writeAgentOverrides -- sibling-key preservation", () => {
	it("preserves kyPiAgent and subagents.defaultModel byte-for-byte, replacing only agentOverrides", () => {
		const settingsPath = freshSettingsPath();
		const initial = {
			kyPiAgent: { bootstrapVersion: "1.2.3", hardenedNpmRoot: "/x/npm", piPinned: "1.1.0" },
			subagents: { defaultModel: "dashscope/deepseek-v4-pro" },
		};
		writeFileSync(settingsPath, `${JSON.stringify(initial, null, 2)}\n`, "utf-8");

		const overrides = { planner: { model: "amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0" } };
		const result = writeAgentOverrides(overrides, { settingsPath });

		expect(result.ok, `expected ok:true, got ${JSON.stringify(result)}`).toBe(true);

		const written = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(written.kyPiAgent).toEqual({
			...initial.kyPiAgent,
			plannerPinRestore: { hadOverrides: false, keys: { planner: { had: false } }, owners: [{ pid: process.pid, at: expect.any(Number) }] },
		});
		expect(written.subagents.defaultModel).toBe("dashscope/deepseek-v4-pro");
		expect(written.subagents.agentOverrides).toEqual(overrides);
	});
});

describe("writeAgentOverrides -- WR-02: a filesystem error refuses, it never throws", () => {
	it("a settingsPath whose parent directory does not exist -> ok:false, never throws", () => {
		// The settings target sits under a parent that is never created, as on a fresh machine with no ~/.pi/agent.
		const dir = mkdtempSync(join(tmpdir(), "kypi-agent-overrides-missing-parent-"));
		tempDirs.push(dir);
		const settingsPath = join(dir, "does-not-exist", "settings.json");
		expect(existsSync(settingsPath)).toBe(false);

		let result: ReturnType<typeof writeAgentOverrides> | undefined;
		expect(() => {
			result = writeAgentOverrides({ planner: { model: "dashscope/deepseek-v4-flash" } }, { settingsPath });
		}, "writeAgentOverrides threw instead of returning a refusal -- the module docstring's own " + '"returns a refusal rather than throwing" contract is exactly what WR-02 found broken').not.toThrow();

		expect(result?.ok, `expected ok:false, got ${JSON.stringify(result)}`).toBe(false);
		if (result?.ok !== false) {
			return;
		}
		expect(result.reason).toContain(settingsPath);
		expect(existsSync(settingsPath), "a refusal must never leave a partial file behind").toBe(false);
	});
});

describe("writeAgentOverrides -- WR-02: the write is atomic, no temp file is left behind on success", () => {
	it("a successful write leaves no stray `<path>.<pid>.tmp` file beside the target", () => {
		const settingsPath = freshSettingsPath();
		const result = writeAgentOverrides({ planner: { model: "dashscope/deepseek-v4-flash" } }, { settingsPath });
		expect(result.ok).toBe(true);

		const dir = dirname(settingsPath);
		const leftover = readdirSync(dir).filter((name) => name.includes(".tmp"));
		expect(leftover, `stray temp file(s) left behind: ${JSON.stringify(leftover)}`).toHaveLength(0);
	});
});

describe("writeAgentOverrides -- WR-07: a renameSync failure cleans up the temp file and still refuses (never throws)", () => {
	// renameSync cannot be made to fail through the filesystem alone (a file target succeeds, a directory fails earlier),
	// so node:fs is mocked for this one case and reset straight after.
	afterEach(() => {
		vi.doUnmock("node:fs");
		vi.resetModules();
	});

	it("renameSync throwing leaves NO `*.tmp` file behind, and the call still returns ok:false rather than throwing", async () => {
		const settingsPath = freshSettingsPath();

		vi.resetModules();
		vi.doMock("node:fs", async () => {
			const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
			return {
				...actual,
				renameSync: vi.fn(() => {
					// Simulates EPERM/EXDEV/a Windows antivirus or indexer lock --
					// this project's own target platform (CLAUDE.md).
					throw new Error("EPERM: simulated rename failure for the WR-07 regression test");
				}),
			};
		});

		const { writeAgentOverrides: writeAgentOverridesMocked } = await import(
			"../../.pi/extensions/routing/agent-overrides.ts"
		);

		let result: ReturnType<typeof writeAgentOverridesMocked> | undefined;
		expect(() => {
			result = writeAgentOverridesMocked({ planner: { model: "dashscope/deepseek-v4-flash" } }, { settingsPath });
		}, "a renameSync failure must be caught and returned as a refusal, never rethrown past the caller").not.toThrow();

		expect(result?.ok, `expected ok:false, got ${JSON.stringify(result)}`).toBe(false);

		// No temp file may survive a failed rename in the user's global agent directory.
		const dir = dirname(settingsPath);
		const leftover = existsSync(dir) ? readdirSync(dir).filter((name) => name.includes(".tmp")) : [];
		expect(leftover, `stray temp file(s) left behind after a renameSync failure: ${JSON.stringify(leftover)}`).toHaveLength(0);
	});
});

describe("writeAgentOverrides -- refusals leave the file BYTE-UNCHANGED", () => {
	it("invalid JSON -> ok:false, file unchanged", () => {
		const settingsPath = freshSettingsPath();
		const badText = "{ this is not valid JSON,,, }";
		writeFileSync(settingsPath, badText, "utf-8");

		const result = writeAgentOverrides({ planner: { model: "dashscope/deepseek-v4-flash" } }, { settingsPath });

		expect(result.ok, `expected ok:false, got ${JSON.stringify(result)}`).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.reason).toContain(settingsPath);
		expect(readFileSync(settingsPath, "utf-8")).toBe(badText);
	});

	it("a top-level array -> ok:false, file unchanged", () => {
		const settingsPath = freshSettingsPath();
		const arrayText = `${JSON.stringify([1, 2, 3], null, 2)}\n`;
		writeFileSync(settingsPath, arrayText, "utf-8");

		const result = writeAgentOverrides({ planner: { model: "dashscope/deepseek-v4-flash" } }, { settingsPath });

		expect(result.ok).toBe(false);
		expect(readFileSync(settingsPath, "utf-8")).toBe(arrayText);
	});

	it("a top-level null -> ok:false, file unchanged", () => {
		const settingsPath = freshSettingsPath();
		const nullText = "null\n";
		writeFileSync(settingsPath, nullText, "utf-8");

		const result = writeAgentOverrides({ planner: { model: "dashscope/deepseek-v4-flash" } }, { settingsPath });

		expect(result.ok).toBe(false);
		expect(readFileSync(settingsPath, "utf-8")).toBe(nullText);
	});

	it('"subagents" present but not an object -> ok:false, file unchanged', () => {
		const settingsPath = freshSettingsPath();
		const initial = { subagents: "not-an-object" };
		const initialText = `${JSON.stringify(initial, null, 2)}\n`;
		writeFileSync(settingsPath, initialText, "utf-8");

		const result = writeAgentOverrides({ planner: { model: "dashscope/deepseek-v4-flash" } }, { settingsPath });

		expect(result.ok, `expected ok:false, got ${JSON.stringify(result)}`).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.reason).toContain("subagents");
		expect(readFileSync(settingsPath, "utf-8")).toBe(initialText);
	});

	it('"subagents" present as an array -> ok:false, file unchanged (Array.isArray must be checked, not merely typeof)', () => {
		const settingsPath = freshSettingsPath();
		const initial = { subagents: [1, 2] };
		const initialText = `${JSON.stringify(initial, null, 2)}\n`;
		writeFileSync(settingsPath, initialText, "utf-8");

		const result = writeAgentOverrides({ planner: { model: "dashscope/deepseek-v4-flash" } }, { settingsPath });

		expect(result.ok).toBe(false);
		expect(readFileSync(settingsPath, "utf-8")).toBe(initialText);
	});
});

describe("writeAgentOverrides -- byte-idempotence", () => {
	it("writing the same overrides twice: the second call reports written:false, bytes AND mtimeMs unchanged", async () => {
		const settingsPath = freshSettingsPath();
		const overrides = { planner: { model: "dashscope/deepseek-v4-flash" } };

		const first = writeAgentOverrides(overrides, { settingsPath });
		expect(first.ok).toBe(true);
		if (!first.ok) {
			return;
		}
		expect(first.written).toBe(true);

		const textAfterFirst = readFileSync(settingsPath, "utf-8");
		const mtimeAfterFirst = statSync(settingsPath).mtimeMs;

		// A real delay, so a rewrite cannot hide inside the same millisecond.
		await new Promise((resolve) => setTimeout(resolve, 20));

		const second = writeAgentOverrides(overrides, { settingsPath });
		expect(second.ok, `expected ok:true, got ${JSON.stringify(second)}`).toBe(true);
		if (!second.ok) {
			return;
		}
		expect(second.written, "the second identical write must report written:false").toBe(false);

		const textAfterSecond = readFileSync(settingsPath, "utf-8");
		const mtimeAfterSecond = statSync(settingsPath).mtimeMs;

		expect(textAfterSecond).toBe(textAfterFirst);
		expect(mtimeAfterSecond, "a no-op write must not touch mtime -- content equality alone is not enough").toBe(
			mtimeAfterFirst,
		);
	});
});

describe("settings files with a BOM or no content", () => {
	const pin = { planner: { model: "dashscope/deepseek-v4-flash" } };

	it("reads and pins through a leading BOM, as Pi's own settings reader does", () => {
		const settingsPath = freshSettingsPath();
		writeFileSync(settingsPath, `﻿${JSON.stringify({ theme: "ky" })}`, "utf-8");
		expect(writeAgentOverrides(pin, { settingsPath })).toMatchObject({ ok: true, written: true });
		expect(readAgentOverride("planner", { settingsPath })).toBe(pin.planner.model);
		expect(plannerPinHeld({ settingsPath })).toBe(true);
		expect(restorePlannerPin({ settingsPath })).toMatchObject({ ok: true, restored: true });
		expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({ theme: "ky" });
	});

	it("treats a blank file as an empty object on both write and restore", () => {
		const settingsPath = freshSettingsPath();
		writeFileSync(settingsPath, "  \n", "utf-8");
		expect(restorePlannerPin({ settingsPath })).toMatchObject({ ok: true, restored: false });
		expect(writeAgentOverrides(pin, { settingsPath })).toMatchObject({ ok: true, written: true });
		expect(readAgentOverride("planner", { settingsPath })).toBe(pin.planner.model);
	});
});

describe("restorePlannerPin", () => {
	const pin = { planner: { model: "dashscope/deepseek-v4-flash" } };

	function seed(body: unknown): { settingsPath: string; bytes: string } {
		const settingsPath = freshSettingsPath();
		const bytes = `${JSON.stringify(body, null, 2)}
`;
		writeFileSync(settingsPath, bytes, "utf-8");
		return { settingsPath, bytes };
	}

	it("restores the prior bytes when the file had no subagents key", () => {
		const { settingsPath, bytes } = seed({ theme: "ky", kyPiAgent: { bootstrapVersion: "1.2.3" } });
		expect(writeAgentOverrides(pin, { settingsPath }).ok).toBe(true);
		expect(readFileSync(settingsPath, "utf-8")).not.toBe(bytes);

		const result = restorePlannerPin({ settingsPath });
		expect(result).toMatchObject({ ok: true, restored: true });
		expect(readFileSync(settingsPath, "utf-8")).toBe(bytes);
	});

	it("restores an existing agentOverrides value and keeps the first original across several pins", () => {
		const original = { reviewer: { model: "deepseek/deepseek-flash" } };
		const { settingsPath, bytes } = seed({ subagents: { defaultModel: "x", agentOverrides: original } });
		writeAgentOverrides(pin, { settingsPath });
		writeAgentOverrides({ planner: { model: "dashscope/deepseek-v4-pro" } }, { settingsPath });

		expect(restorePlannerPin({ settingsPath }).ok).toBe(true);
		expect(readFileSync(settingsPath, "utf-8")).toBe(bytes);
	});

	it("restores a crash-left marker in a later process", () => {
		const { settingsPath, bytes } = seed({ theme: "ky" });
		writeAgentOverrides(pin, { settingsPath });
		const left = readFileSync(settingsPath, "utf-8");
		expect(left).toContain("plannerPinRestore");

		expect(restorePlannerPin({ settingsPath })).toMatchObject({ ok: true, restored: true });
		expect(readFileSync(settingsPath, "utf-8")).toBe(bytes);
	});

	it("is a no-op without a marker, byte-unchanged, and for a missing file", () => {
		const { settingsPath, bytes } = seed({ subagents: { agentOverrides: pin } });
		expect(restorePlannerPin({ settingsPath })).toMatchObject({ ok: true, restored: false });
		expect(readFileSync(settingsPath, "utf-8")).toBe(bytes);
		expect(restorePlannerPin({ settingsPath: join(dirname(settingsPath), "absent.json") })).toMatchObject({ ok: true, restored: false });
	});

	it("does not add a marker when the pin equals what is already there", () => {
		const { settingsPath, bytes } = seed({ subagents: { agentOverrides: pin } });
		writeAgentOverrides(pin, { settingsPath });
		expect(readFileSync(settingsPath, "utf-8")).toBe(bytes);
	});

	it("merges per key and restores only the pinned key, keeping overrides added during the session", () => {
		const reviewer = { model: "deepseek/deepseek-flash" };
		const { settingsPath } = seed({ subagents: { agentOverrides: { reviewer } } });
		writeAgentOverrides(pin, { settingsPath });
		expect(JSON.parse(readFileSync(settingsPath, "utf-8")).subagents.agentOverrides).toEqual({ reviewer, ...pin });

		const added = { model: "deepseek/deepseek-pro" };
		const mid = JSON.parse(readFileSync(settingsPath, "utf-8"));
		mid.subagents.agentOverrides["executor-handoff"] = added;
		writeFileSync(settingsPath, JSON.stringify(mid), "utf-8");

		expect(restorePlannerPin({ settingsPath })).toMatchObject({ ok: true, restored: true });
		const after = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(after.subagents.agentOverrides).toEqual({ reviewer, "executor-handoff": added });
		expect(after.kyPiAgent).toBeUndefined();
	});

	it("another live process never undoes the pin; the owner, or the first process after the owner died, does", () => {
		const { settingsPath, bytes } = seed({ theme: "ky" });
		writeAgentOverrides(pin, { settingsPath, pid: 111 });
		const pinned = readFileSync(settingsPath, "utf-8");

		expect(restorePlannerPin({ settingsPath, pid: 222, isAlive: () => true })).toMatchObject({ ok: true, restored: false });
		expect(readFileSync(settingsPath, "utf-8")).toBe(pinned);

		expect(restorePlannerPin({ settingsPath, pid: 222, isAlive: () => false })).toMatchObject({ ok: true, restored: true });
		expect(readFileSync(settingsPath, "utf-8")).toBe(bytes);

		writeAgentOverrides(pin, { settingsPath, pid: 111 });
		expect(restorePlannerPin({ settingsPath, pid: 111, isAlive: () => true })).toMatchObject({ ok: true, restored: true });
		expect(readFileSync(settingsPath, "utf-8")).toBe(bytes);
	});

	it("with two pinning sessions, the pin survives until the last one ends", () => {
		const { settingsPath, bytes } = seed({ theme: "ky" });
		writeAgentOverrides(pin, { settingsPath, pid: 111 });
		writeAgentOverrides({ planner: { model: "dashscope/deepseek-v4-pro" } }, { settingsPath, pid: 222 });

		expect(restorePlannerPin({ settingsPath, pid: 111, isAlive: () => true })).toMatchObject({ restored: false });
		expect(JSON.parse(readFileSync(settingsPath, "utf-8")).kyPiAgent.plannerPinRestore.owners.map((o: { pid: number }) => o.pid)).toEqual([222]);
		expect(restorePlannerPin({ settingsPath, pid: 222, isAlive: () => true })).toMatchObject({ restored: true });
		expect(readFileSync(settingsPath, "utf-8")).toBe(bytes);
	});

	it("an owner unseen for a day no longer holds the pin, even when its pid still answers", () => {
		const { settingsPath, bytes } = seed({ theme: "ky" });
		const day = 24 * 60 * 60 * 1000;
		writeAgentOverrides(pin, { settingsPath, pid: 111, now: 1_000 });
		expect(restorePlannerPin({ settingsPath, pid: 222, isAlive: () => true, now: 1_000 + day - 1 })).toMatchObject({ restored: false });
		expect(restorePlannerPin({ settingsPath, pid: 222, isAlive: () => true, now: 1_000 + day })).toMatchObject({ restored: true });
		expect(readFileSync(settingsPath, "utf-8")).toBe(bytes);
	});

	it("a re-pin refreshes the owner's time, so a live session that keeps pinning keeps its pin", () => {
		const { settingsPath } = seed({ theme: "ky" });
		const hour = 60 * 60 * 1000;
		writeAgentOverrides(pin, { settingsPath, pid: 111, now: 0 });
		writeAgentOverrides(pin, { settingsPath, pid: 111, now: 20 * hour });
		expect(restorePlannerPin({ settingsPath, pid: 222, isAlive: () => true, now: 30 * hour })).toMatchObject({ restored: false });
	});

	it("an owner time in the future, after the clock stepped back, counts as expired, and its own re-pin refreshes it", () => {
		const { settingsPath } = seed({ theme: "ky" });
		const hour = 60 * 60 * 1000;
		writeAgentOverrides(pin, { settingsPath, pid: 111, now: 10 * hour });
		writeAgentOverrides(pin, { settingsPath, pid: 111, now: 0 });
		expect(JSON.parse(readFileSync(settingsPath, "utf-8")).kyPiAgent.plannerPinRestore.owners).toEqual([{ pid: 111, at: 0 }]);
		writeAgentOverrides(pin, { settingsPath, pid: 111, now: 10 * hour });
		expect(restorePlannerPin({ settingsPath, pid: 222, isAlive: () => true, now: 0 })).toMatchObject({ restored: true });
	});

	it("an owner recorded as a bare pid by an older marker counts as expired", () => {
		const { settingsPath } = seed({ subagents: { agentOverrides: pin }, kyPiAgent: { plannerPinRestore: { hadOverrides: false, keys: { planner: { had: false } }, owners: [111] } } });
		expect(restorePlannerPin({ settingsPath, pid: 222, isAlive: () => true })).toMatchObject({ restored: true });
	});

	it("plannerPinHeld and readAgentOverride report the shared file's pin", () => {
		const { settingsPath } = seed({ theme: "ky" });
		expect(plannerPinHeld({ settingsPath })).toBe(false);
		expect(readAgentOverride("planner", { settingsPath })).toBeUndefined();
		writeAgentOverrides(pin, { settingsPath, pid: 111 });
		expect(plannerPinHeld({ settingsPath })).toBe(true);
		expect(readAgentOverride("planner", { settingsPath })).toBe(pin.planner.model);
	});

	it("restores a marker written before per-key pins", () => {
		const original = { reviewer: { model: "deepseek/deepseek-flash" } };
		const { settingsPath } = seed({ subagents: { agentOverrides: pin }, kyPiAgent: { plannerPinRestore: { had: true, value: original } } });
		expect(restorePlannerPin({ settingsPath })).toMatchObject({ ok: true, restored: true });
		expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({ subagents: { agentOverrides: original } });
	});

	it("refuses invalid JSON without touching it", () => {
		const settingsPath = freshSettingsPath();
		writeFileSync(settingsPath, "{ nope", "utf-8");
		expect(restorePlannerPin({ settingsPath }).ok).toBe(false);
		expect(readFileSync(settingsPath, "utf-8")).toBe("{ nope");
	});
});

// -----------------------------------------------------------------------------
// End-to-end: agentOverridesFor -> writeAgentOverrides, real files
// -----------------------------------------------------------------------------

describe("agentOverridesFor + writeAgentOverrides -- end to end against a real file", () => {
	it("a real mode's derived overrides write successfully and round-trip through JSON.parse", () => {
		const settingsPath = freshSettingsPath();
		const derived = agentOverridesFor({ mode: "max" });
		expect(derived.ok).toBe(true);
		if (!derived.ok) {
			return;
		}

		const result = writeAgentOverrides(derived.overrides, { settingsPath });
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.written).toBe(true);

		const written = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(written.subagents.agentOverrides).toEqual(derived.overrides);
	});
});

describe("agentOverridesFor -- registry-aware pick", () => {
	const [first, second] = ROLE_MAP.cheap.planner.candidates;
	const stubModel = (ref: { provider: string; id: string }) => ({ provider: ref.provider, id: ref.id }) as never;
	const registryWithAuth = (authed: readonly string[]) => ({
		find: (provider: string, id: string) => stubModel({ provider, id }),
		hasConfiguredAuth: (m: { provider: string; id: string }) => authed.includes(`${m.provider}/${m.id}`),
	});
	const planner = (registry?: ReturnType<typeof registryWithAuth>) => {
		const r = agentOverridesFor({ mode: "cheap" }, { settingsPath: freshSettingsPath(), registry });
		return r.ok ? r.overrides[AGENT_NAME_BY_ROLE.planner as string]?.model : undefined;
	};

	it("pins the first candidate that has configured auth", () => {
		expect(planner(registryWithAuth([`${second.provider}/${second.id}`]))).toBe(`${second.provider}/${second.id}`);
	});

	it("falls back to the first guard-passing candidate when none is configured", () => {
		expect(planner(registryWithAuth([]))).toBe(`${first.provider}/${first.id}`);
	});

	it("is unchanged without a registry", () => {
		expect(planner()).toBe(`${first.provider}/${first.id}`);
	});
});
