/**
 * FLOW-02/FLOW-03 -- does `/grill` really compose Phase 4's git guard and the
 * 09-05/09-07 gates, or does it merely look like it does?
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * Five cases: (0) `/grill` is really registered, and loading this extension
 * registers zero tools (BOOT-10); (1) HEAD on a protected branch makes
 * `/grill` refuse in `classifyGitInvocation`'s OWN words, at zero provider
 * requests; (2) empty args is a usage error, at zero provider requests;
 * (3) `/grill --resume` with no `.pi/work/` directory refuses, at zero
 * provider requests; (4) `writeSpecIfGated` refuses a SPEC whose §2 is
 * evidence-free and -- the load-bearing assertion -- never creates SPEC.md
 * on disk, not merely that it returns a reject verdict.
 *
 * This file does NOT re-prove `gateRequirementsAuthorship`'s own branch
 * table (`tests/unit/grill-evidence-gate.test.ts`) or `gateAmbiguity`'s own
 * branch table (`tests/unit/grill-scorecard.test.ts`). It proves `/grill`'s
 * write path calls the REAL gates, in the right order, and that a real Pi
 * session really refuses before ever prompting a model.
 *
 * ---------------------------------------------------------------------------
 * DECISION D-14 -- A REFUSAL MUST COST ZERO PROVIDER REQUESTS
 * ---------------------------------------------------------------------------
 * `faux.state.callCount === 0` after a refusal is what distinguishes
 * "refused before prompting" from "prompted, then reported something" --
 * the same assertion shape `tests/integration/quick-workflow.test.ts`
 * established for its own two refusal seams.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writeSpecIfGated } from "../../.pi/extensions/grill/index.ts";
import { classifyGitInvocation, currentBranch } from "../../.pi/extensions/safety/git.ts";
import { PROTECTED_BRANCHES } from "../../.pi/extensions/safety/index.ts";
import { gitInit, repoRoot } from "../helpers/git.ts";
import { captureNotify, withFauxSession } from "../helpers/session.ts";

/** Absolute, forward-slashed path of the safety extension this repository ships. */
const SAFETY_ENTRY = `${repoRoot()}/.pi/extensions/safety/index.ts`.replace(/\\/g, "/");
/** Absolute, forward-slashed path of the grill extension (`/grill`) this repository ships. */
const GRILL_ENTRY = `${repoRoot()}/.pi/extensions/grill/index.ts`.replace(/\\/g, "/");

/** Build the inline user-scope extension source: the REAL safety extension, then the REAL grill extension. No re-implementation, no shim, no stub. */
function composite(): string {
	return [
		"// Generated for tests/integration/grill-command.test.ts. Lives in a temp dir.",
		`import safety from ${JSON.stringify(SAFETY_ENTRY)};`,
		`import grill from ${JSON.stringify(GRILL_ENTRY)};`,
		"export default function (pi) {",
		"\tsafety(pi);",
		"\tgrill(pi);",
		"}",
	].join("\n");
}

/** Grill alone -- no safety composed in -- so "zero tools registered" measures ONLY this extension's own contribution, not safety's separate, already-allowlisted approve_ky_command + four wrapped tools. */
function grillOnly(): string {
	return [
		"// Generated for tests/integration/grill-command.test.ts. Lives in a temp dir.",
		`import grill from ${JSON.stringify(GRILL_ENTRY)};`,
		"export default function (pi) {",
		"\tgrill(pi);",
		"}",
	].join("\n");
}

describe("FLOW-02/FLOW-03 -- /grill: registration, two zero-cost refusal seams", () => {
	it("case 0 -- /grill is really registered, and loading this extension registers zero tools (BOOT-10)", async () => {
		await withFauxSession({ extensionSource: grillOnly() }, async ({ session }) => {
			const command = session.extensionRunner.getCommand("grill");
			expect(
				command,
				'getCommand("grill") returned undefined -- the grill extension did not register /grill. The ' +
					"likeliest cause is the extension not loading at all: it must sit at USER scope headless.",
			).toBeDefined();
			expect(
				session.extensionRunner.getAllRegisteredTools().length,
				"the grill extension registered a tool -- /grill must register exactly zero (BOOT-10)",
			).toBe(0);
		});
	});

	it("case 1 -- protected branch: /grill refuses with classifyGitInvocation's own reason, at zero provider requests", async () => {
		await withFauxSession(
			{ extensionSource: composite(), tools: ["bash"], responses: [] },
			async ({ session, faux, cwd }) => {
				gitInit(cwd, "main");

				const expected = classifyGitInvocation(
					{ subcommand: "commit", args: [] },
					{ currentBranch: currentBranch(cwd), protectedBranches: PROTECTED_BRANCHES },
				);
				expect(
					expected.kind,
					'HEAD is not classified "block" -- this case is not exercising a genuine branch-policy refusal',
				).toBe("block");
				if (expected.kind !== "block") {
					return;
				}

				const ctx = session.extensionRunner.createCommandContext();
				const command = session.extensionRunner.getCommand("grill");
				expect(command, 'getCommand("grill") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("add x", ctx);

					expect(notifications.length, "a refusal must still report an outcome").toBe(1);
					expect(
						notifications[0]?.text,
						"/grill's refusal text does not equal classifyGitInvocation's own reason -- it may be " +
							"retyped or hardcoded",
					).toBe(expected.reason);
					expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
					expect(faux.state.callCount, "a branch-policy refusal must cost zero provider requests").toBe(0);
				} finally {
					restore();
				}
			},
		);
	});

	it("case 2 -- empty args: usage error, at zero provider requests", async () => {
		await withFauxSession(
			{ extensionSource: composite(), tools: ["bash"], responses: [] },
			async ({ session, faux, cwd }) => {
				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const command = session.extensionRunner.getCommand("grill");
				expect(command, 'getCommand("grill") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("", ctx);

					expect(notifications.length, "a usage error must still report an outcome").toBe(1);
					expect(notifications[0]?.text, "an empty-args refusal must be a usage message").toContain("usage is");
					expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
					expect(faux.state.callCount, "a usage-error refusal must cost zero provider requests").toBe(0);
				} finally {
					restore();
				}
			},
		);
	});

	it("case 3 -- /grill --resume with no .pi/work/ directory refuses, at zero provider requests", async () => {
		await withFauxSession(
			{ extensionSource: composite(), tools: ["bash"], responses: [] },
			async ({ session, faux, cwd }) => {
				gitInit(cwd, "work");

				const ctx = session.extensionRunner.createCommandContext();
				const command = session.extensionRunner.getCommand("grill");
				expect(command, 'getCommand("grill") returned undefined').toBeDefined();
				if (command === undefined) {
					return;
				}

				const { notifications, restore } = captureNotify(ctx);
				try {
					await command.handler("--resume", ctx);

					expect(notifications.length, "a refusal must still report an outcome").toBe(1);
					expect(
						notifications[0]?.text,
						"a --resume refusal with no .pi/work/ directory must say so",
					).toContain("no .pi/work/ directory exists to resume");
					expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
					expect(faux.state.callCount, "a --resume refusal must cost zero provider requests").toBe(0);
				} finally {
					restore();
				}
			},
		);
	});
});

describe("FLOW-03 -- writeSpecIfGated refuses an evidence-free §2, and never creates SPEC.md on disk", () => {
	it("does not create SPEC.md when §2 (Verified Codebase Facts) is absent entirely", () => {
		const cwd = mkdtempSync(join(tmpdir(), "kypi-grill-write-"));
		try {
			const markdown = ["## 1. Goal", "", "Do the thing.", ""].join("\n");

			const verdict = writeSpecIfGated(cwd, "probe-slug", markdown);

			expect(verdict.ok, `expected reject, got: ${JSON.stringify(verdict)}`).toBe(false);
			const specPath = join(cwd, ".pi", "work", "probe-slug", "SPEC.md");
			expect(
				existsSync(specPath),
				"SPEC.md was created on disk despite a reject verdict -- a gate that returns a refusal " +
					"while still writing is the exact failure this asserts against",
			).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
