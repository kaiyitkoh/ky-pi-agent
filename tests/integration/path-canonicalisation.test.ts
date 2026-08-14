/**
 * CR-02 -- `buildFacts` (`.pi/extensions/safety/index.ts`) canonicalises the
 * impure `ctx.cwd` and `os.homedir()` before handing them to `evaluate()` as
 * `PolicyFacts.projectRoot`/`.home`, so a write INSIDE the project is
 * actually allowed on the one platform this phase targets.
 *
 * This file DOUBLES as WR-02's regression proof: the real write only lands
 * inside `cwd` (asserted below via `readFileSync(join(cwd, RELATIVE_PATH))`)
 * if the wrapped tool that actually executes was built from `ctx.cwd`, not
 * from a single `process.cwd()`-closed-over instance captured once at
 * registration time -- confirmed by execution: reverting ONLY the WR-02 half
 * of the fix (keeping CR-02's `buildFacts` canonicalisation intact) still
 * turns this same test red with an `ENOENT` reading the probe file back from
 * `cwd`, because the write silently landed under the vitest process's own
 * cwd (this repository's root) instead.
 *

 * ---------------------------------------------------------------------------
 * WHY A REAL SESSION, NOT A UNIT FIXTURE
 * ---------------------------------------------------------------------------
 * `paths.ts#classifyPathWrite` and `policy.ts#evaluate` both stay pure --
 * they take `PolicyFacts`/`PathPolicyFacts` as plain data and never touch
 * `ctx.cwd`/`os.homedir()` themselves. The bug this finding fixes lives
 * ENTIRELY in `index.ts#buildFacts`, the one place those impure values become
 * the facts object `evaluate()` reads. A fixture table over `paths.ts`/
 * `policy.ts` directly (as `tests/unit/path-policy.test.ts` and
 * `tests/unit/policy-compose.test.ts` do) can prove those pure functions
 * behave correctly GIVEN already-canonical facts, but cannot prove
 * `buildFacts` actually produces canonical facts from a REAL, impure
 * `ctx.cwd` -- only driving the real wrapped `write` tool through a real
 * session does that.
 *
 * `tests/helpers/session.ts#createFauxSession`'s own `cwd` is
 * `mkdtempSync(join(tmpdir(), "kypi-cwd-"))`, which on Windows returns a
 * NATIVE BACKSLASH absolute path (`C:\Users\...\AppData\Local\Temp\kypi-cwd-...`)
 * with no extra setup needed -- exactly the shape the reviewer's own executed
 * evidence used (`projectRoot = C:\Users\Admin\Documents\ky-pi-agent`).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT TEST
 * ---------------------------------------------------------------------------
 * The FAIL-OPEN half of CR-02 (an un-canonicalised `facts.home` making the
 * `~/.bashrc` detonation rule silently stop matching) is proven at the
 * `paths.ts`/`policy.ts` unit level instead
 * (`tests/unit/path-policy.test.ts`, `tests/unit/policy-compose.test.ts`) --
 * driving a REAL write to this machine's REAL `~/.bashrc` through a real
 * session, even one this guard is expected to block, is a real-file-system
 * side effect this test suite does not need to risk to prove the point.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssistantMessage, Context, FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import { resetSafetyInstalledForTests } from "../../.pi/extensions/safety/index.ts";
import { logPath } from "../../.pi/lib/jsonl.ts";
import { AUDIT_LOG_BASE } from "../../.pi/extensions/safety/schema.ts";
import { repoRoot } from "../helpers/git.ts";
import { readJsonl } from "../helpers/logs.ts";
import { withFauxSession } from "../helpers/session.ts";
import { existsSync } from "node:fs";

const RELATIVE_PATH = "cr-02-canonicalisation-probe.txt";
const CONTENT = "kypi-cr-02-positive-control";

interface AuditRowShape {
	event?: string;
	tool?: string;
	command?: string;
	verdict?: "allow" | "block";
	reason?: string;
}

function readAudit(cwd: string): AuditRowShape[] {
	const file = logPath(cwd, AUDIT_LOG_BASE);
	if (!existsSync(file)) {
		throw new Error(`${file} does not exist -- the safety extension likely never loaded`);
	}
	return readJsonl(file) as AuditRowShape[];
}

function lastToolResult(context: Context): { isError: boolean; text: string } | undefined {
	const msg = [...context.messages].reverse().find((m) => m.role === "toolResult");
	if (msg === undefined || msg.role !== "toolResult") {
		return undefined;
	}
	const text = msg.content.map((block) => (block.type === "text" ? block.text : "")).join("");
	return { isError: msg.isError, text };
}

function capturing(into: Context[], reply: AssistantMessage): FauxResponseStep {
	return ((context: Context): AssistantMessage => {
		into.push(context);
		return reply;
	}) as FauxResponseStep;
}

describe("CR-02 -- a write inside the project root is allowed on a native-backslash cwd", () => {
	it("write({ path: 'relative-file.txt' }) inside the session's own (backslash-native) cwd is ALLOWED, not blocked as 'outside the project root'", async () => {
		resetSafetyInstalledForTests();
		const outgoing: Context[] = [];

		await withFauxSession(
			{
				extensionPath: `${repoRoot()}/.pi/extensions/safety/index.ts`,
				tools: ["write"],
				responses: [
					fauxAssistantMessage([fauxToolCall("write", { path: RELATIVE_PATH, content: CONTENT })], {
						stopReason: "toolUse",
					}),
					capturing(outgoing, fauxAssistantMessage([fauxText("done")], { stopReason: "stop" })),
				],
			},
			async ({ session, cwd }) => {
				await session.prompt("write the probe file");

				const rows = readAudit(cwd);
				expect(rows.length, "no audit rows at all -- the safety extension likely never loaded").toBeGreaterThan(0);

				// THE FIX ITSELF: CR-02 pre-fix, buildFacts handed the raw backslash
				// `ctx.cwd` through as `projectRoot` unnormalised, so `paths.ts`'s
				// `rootedSegmentsOf` parsed it as root "/" with one giant segment --
				// EVERY write, including one inside the project, was blocked with
				// "resolves outside the project root".
				const blockedAsOutsideRoot = rows.filter(
					(r) => r.verdict === "block" && (r.reason ?? "").includes("resolves outside the project root"),
				);
				expect(
					blockedAsOutsideRoot,
					"CR-02: a write to a RELATIVE path inside the session's own cwd must never be classified " +
						`as outside the project root. Rows:\n${JSON.stringify(rows, null, 2)}`,
				).toEqual([]);

				const wrapperAllow = rows.filter(
					(r) => r.event === "safety.wrapped_execute" && r.verdict === "allow" && r.tool === "write",
				);
				expect(
					wrapperAllow.length,
					`the wrapper must have allowed the write. Rows:\n${JSON.stringify(rows, null, 2)}`,
				).toBeGreaterThan(0);

				// The write genuinely reached the real tool -- proof this is not
				// merely "the guard stayed out of the way of a call that would have
				// no-opped anyway".
				expect(outgoing.length, "the closing reply must have been reached for its context to be captured").toBe(1);
				const result = lastToolResult(outgoing[0] as Context);
				expect(result?.isError, "the real write must have succeeded, not thrown").toBe(false);

				const written = readFileSync(join(cwd, RELATIVE_PATH), "utf-8");
				expect(written).toBe(CONTENT);
			},
		);
	});
});
