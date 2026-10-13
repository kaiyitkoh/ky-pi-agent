/**
 * ROUTE-05 — `.pi/extensions/routing/agent-overrides.ts`, proven against real
 * files in a temp directory: shape, refusals, sibling-key preservation and
 * idempotence.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY CASE OWNS ITS OWN TEMP DIRECTORY
 * ---------------------------------------------------------------------------
 * `writeAgentOverrides` mutates a real settings.json file. Every case below
 * passes an explicit `settingsPath` inside a fresh `mkdtempSync` directory
 * (removed in `afterEach`) — this file NEVER lets `resolveSettingsPath()`
 * resolve to this machine's real `getAgentDir()` location except in the one
 * case that specifically tests the default-path branch, and that case ALSO
 * points `PI_CODING_AGENT_DIR` at a temp directory first.
 *
 * ---------------------------------------------------------------------------
 * REFUSAL CASES ASSERT BYTES, NOT JUST `ok:false`
 * ---------------------------------------------------------------------------
 * A writer that refuses and truncates is worse than one that throws — only a
 * byte comparison of the file before/after tells them apart. Every refusal
 * case below captures the file's exact text (or its absence) before calling
 * `writeAgentOverrides`, and re-reads it afterward to prove nothing moved.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCE ASSERTS `mtimeMs`, NOT ONLY CONTENT
 * ---------------------------------------------------------------------------
 * Content equality alone would pass against an implementation that rewrites
 * identical bytes on every call — exactly the mtime churn the plan's
 * byte-idempotence discipline exists to prevent (mirroring
 * `bin/bootstrap.sh`'s own "settings.json kyPiAgent already current --
 * unchanged" no-op path). `statSync(path).mtimeMs` is compared across both
 * writes.
 *
 * ---------------------------------------------------------------------------
 * FALSIFICATION RECORDED IN THE SUMMARY, NOT HERE
 * ---------------------------------------------------------------------------
 * Per the plan's own acceptance criteria, a falsification was executed after
 * this file was committed: `writeAgentOverrides`'s merge step was mutated
 * from `subagents.agentOverrides = overrides` (preserving `subagents`'
 * other keys) to `root.subagents = { agentOverrides: overrides }` (replacing
 * the whole `subagents` object, clobbering `subagents.defaultModel`). The
 * "preserves kyPiAgent and subagents.defaultModel" case went red as
 * expected; the mutation was then reverted. See 05-05-SUMMARY.md for the
 * exact failure message.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
	agentOverridesFor,
	resolveSettingsPath,
	restorePlannerPin,
	writeAgentOverrides,
	type AgentOverridesForOptions,
} from "../../.pi/extensions/routing/agent-overrides.ts";
import { AGENT_NAME_BY_ROLE, MODES, ROLE_MAP } from "../../.pi/extensions/routing/schema.ts";

// -----------------------------------------------------------------------------
// Temp-dir hygiene (mirrors tests/helpers/logs.ts#withTempLogCwd)
// -----------------------------------------------------------------------------

let tempDirs: string[] = [];

function freshSettingsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "kypi-agent-overrides-"));
	tempDirs.push(dir);
	return join(dir, "settings.json");
}

/**
 * CR-01: the suite-wide value `tests/setup/agent-dir.ts`'s `beforeAll`
 * already set for this file, captured here so the "resolves under
 * PI_CODING_AGENT_DIR" case below can restore it instead of `delete`-ing the
 * variable outright -- deleting would punch a hole in the suite-wide guard
 * for the rest of this file's cases. See that file's own docstring.
 */
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
		// Built from the REAL ROLE_MAP (never hand-typed from scratch) with only
		// planner's candidate list replaced, so every other role's shape stays
		// realistic and only the one guard-blocked candidate is under test.
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
		// WR-10: this case is DELIBERATELY SELF-FULFILLING at the unit level --
		// it derives an ok:false result, chooses not to call writeAgentOverrides,
		// and then asserts the file it never touched does not exist. That
		// assertion would hold unchanged even if `applyMode` (the REAL caller,
		// in `.pi/extensions/routing/index.ts`) unwrapped an ok:false derivation
		// and wrote `{}` anyway -- this test cannot see that regression because
		// it never drives the caller at all. The claim this case name states
		// ("writeAgentOverrides is never REACHED") is actually proven by
		// `tests/integration/mode-switch.test.ts` case 5, which drives the REAL
		// `/balanced` command (via `routing/index.ts`'s WR-10 test-only
		// `agentOverridesFor` seam) against a role map with the SAME guard-
		// blocked planner candidate used here, and asserts the CALLER's own
		// observable behaviour: the step-6 notification names the refusal and
		// the role, and the injected settings.json carries no "subagents" key.
		// This unit case is kept as a narrower, faster proof of
		// `agentOverridesFor`'s own derivation (ok:false, naming the role and
		// reason) -- it is not, on its own, evidence about `writeAgentOverrides`
		// or any caller.
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

		// The caller discipline `writeAgentOverrides`'s own doc comment states:
		// a caller must not invoke it on an ok:false derivation. This case proves
		// that discipline by simply never calling it, and asserting the file
		// still does not exist -- the settings write path was never touched BY
		// THIS TEST. See this case's own updated comment above for what it does
		// NOT prove.
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
			kyPiAgent: { plannerPinRestore: { had: false } },
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
		expect(written.kyPiAgent).toEqual({ ...initial.kyPiAgent, plannerPinRestore: { had: false } });
		expect(written.subagents.defaultModel).toBe("dashscope/deepseek-v4-pro");
		expect(written.subagents.agentOverrides).toEqual(overrides);
	});
});

describe("writeAgentOverrides -- WR-02: a filesystem error refuses, it never throws", () => {
	it("a settingsPath whose parent directory does not exist -> ok:false, never throws", () => {
		// A fresh temp dir owned by this test (removed in afterEach via
		// tempDirs), but the settings.json target sits under a NESTED
		// subdirectory that is never created -- writeFileSync's temp-file write
		// hits ENOENT for want of a parent directory, exactly the "missing
		// ~/.pi/agent parent directory on a fresh machine" case WR-02 names.
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
	// `renameSync` cannot be made to fail reliably, cross-platform, through
	// filesystem tricks alone: a rename onto an existing regular file target
	// SUCCEEDS by design (that is what atomicity relies on), and a directory
	// target instead fails EARLIER, at the `readFileSync(path)` guard above
	// the write/rename section, never reaching it at all -- neither shape
	// proves the temp file was cleaned up. `node:fs` is mocked for this ONE
	// case, real everywhere else in this file, and unmocked/reset immediately
	// after so no other case in this file is affected.
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

		// THE LOAD-BEARING ASSERTION: no `*.tmp` file survives in the target's
		// directory -- before this fix, the temp file `writeFileSync` created
		// was left orphaned in the user's GLOBAL ~/.pi/agent/ directory forever
		// whenever renameSync failed.
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

		// A small real delay so a buggy implementation that DOES rewrite would
		// show a detectably different mtime -- a same-tick write could otherwise
		// coincidentally share a millisecond and mask the bug.
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
