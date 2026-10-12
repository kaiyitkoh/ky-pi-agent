/**
 * FLOW-06 -- does `/plan` really refuse without a gated SPEC, and does the
 * only path that writes PLAN.md really run `validatePlan` first, or does it
 * merely look like it does?
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * Seven cases: (0) `/plan` and `/plan-mode` both resolve, proving neither
 * shadowed the other, at zero registered tools; (1) `/plan` on a
 * protected-branch HEAD refuses in `classifyGitInvocation`'s OWN words, at
 * zero provider requests; (2) `/plan` with no `.pi/work/<slug>/SPEC.md`
 * anywhere refuses, at zero provider requests; (3) -- the LOAD-BEARING case
 * -- `/plan` with a SPEC.md present on disk that FAILS `validateSpec` (an
 * evidence-free §2) refuses with the validator's own reason, at zero
 * provider requests; (4) two `.pi/work/` slugs both carrying a SPEC.md, no
 * arg supplied, refuses naming both candidates rather than silently picking
 * one; (5) `writePlanIfGated` with a plan whose coverage is incomplete does
 * NOT create PLAN.md on disk, not merely that it returns a reject verdict.
 *
 * This file does NOT re-prove `validatePlan`'s own 7-branch table
 * (`tests/unit/plan-task-form.test.ts`) or `validateSpec`'s own table
 * (`tests/unit/spec-schema.test.ts` and siblings). It proves `/plan`'s
 * refusal seams and its write path call the REAL gates, in the right order,
 * and that a real Pi session really refuses before ever prompting a model.
 *
 * ---------------------------------------------------------------------------
 * DECISION D-14 -- A REFUSAL MUST COST ZERO PROVIDER REQUESTS
 * ---------------------------------------------------------------------------
 * `faux.state.callCount === 0` after a refusal is what distinguishes
 * "refused before prompting" from "prompted, then reported something" --
 * the same assertion shape `tests/integration/quick-workflow.test.ts` and
 * `tests/integration/grill-command.test.ts` established for their own
 * refusal seams.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { writePlanIfGated } from "../../.pi/extensions/plan-ceremony/index.ts";
import { renderSpecMarkdown, type SpecArtifact } from "../../.pi/extensions/grill/spec-schema.ts";
import { classifyGitInvocation, currentBranch } from "../../.pi/extensions/safety/git.ts";
import { PROTECTED_BRANCHES } from "../../.pi/extensions/safety/index.ts";
import { repoRoot } from "../helpers/git.ts";
import { withFauxSession } from "../helpers/session.ts";

/** Absolute, forward-slashed path of the plan-ceremony extension (`/plan`) this repository ships. */
const PLAN_ENTRY = `${repoRoot()}/.pi/extensions/plan-ceremony/index.ts`.replace(/\\/g, "/");
/** Absolute, forward-slashed path of the vendored plan-mode extension (`/plan-mode`) this repository ships. */
const PLAN_MODE_ENTRY = `${repoRoot()}/.pi/extensions/plan-mode/index.ts`.replace(/\\/g, "/");

/** Both real extensions composed -- no re-implementation, no shim, no stub. */
function composite(): string {
	return [
		"// Generated for tests/integration/plan-command.test.ts. Lives in a temp dir.",
		`import planCeremony from ${JSON.stringify(PLAN_ENTRY)};`,
		`import planMode from ${JSON.stringify(PLAN_MODE_ENTRY)};`,
		"export default function (pi) {",
		"\tplanCeremony(pi);",
		"\tplanMode(pi);",
		"}",
	].join("\n");
}

/** Run one git argv in `cwd`, throwing with the exact failing argv on a non-zero exit. */
function runGit(args: string[], cwd: string): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch in ${cwd}: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed (exit ${result.status}) in ${cwd}: ${result.stderr ?? ""}`);
	}
	return result.stdout ?? "";
}

/** Init a real git repository IN the faux session's own `cwd` -- `/plan` reads `ctx.cwd`. */
function gitInit(cwd: string, branch: string): void {
	runGit(["init"], cwd);
	runGit(["config", "user.email", "plan@test.invalid"], cwd);
	runGit(["config", "user.name", "plan test"], cwd);
	runGit(["checkout", "-b", branch], cwd);
	writeFileSync(join(cwd, "seed.txt"), "seed\n", "utf-8");
	runGit(["add", "--", "seed.txt"], cwd);
	runGit(["commit", "-m", "seed"], cwd);
}

/** A well-formed SPEC artifact -- round-tripped through renderSpecMarkdown, so `validateSpec` is guaranteed to accept it. */
const VALID_SPEC: SpecArtifact = {
	goal: "Add refresh-token rotation to the session store.",
	verifiedFacts: [{ claim: "the session store lives here", evidence: ".pi/lib/work-artifacts.ts:131", howVerified: "read the file" }],
	requirementsBody: "R1: rotate refresh tokens on use.\n\nR2: expire tokens after 30 days.",
	errorBehaviours: [
		"IF a token is reused THEN THE SYSTEM SHALL reject the request",
		"IF the store is unreachable THEN THE SYSTEM SHALL fail closed",
		"IF a token expires THEN THE SYSTEM SHALL require re-authentication",
	],
	scopePin: {
		inScope: ["token rotation"],
		outOfScope: [{ item: "password reset", reason: "unrelated to token rotation" }],
		expectedFiles: ["src/auth/session.ts"],
	},
	clarificationsBody: "- Q: none -> A: none",
	assumptionsBody: "none",
	scorecardBody: [
		"| factual-grounding | 0.9 |",
		"| requirement-precision | 0.9 |",
		"| failure-coverage | 0.9 |",
		"| scope-definiteness | 0.9 |",
		"Overall: 0.1",
	].join("\n"),
};

/** A notification `ctx.ui.notify` recorded. */
interface Notification {
	text: string;
	level?: string;
}

/** Patch `ctx.ui`'s own `notify` METHOD. Copied from `grill-command.test.ts`'s own helper of the same name. */
function captureNotify(ctx: ExtensionCommandContext): { notifications: Notification[]; restore: () => void } {
	const notifications: Notification[] = [];
	const ui = ctx.ui as unknown as { notify: (text: string, level?: string) => void };
	const original = ui.notify;
	ui.notify = (text: string, level?: string) => {
		notifications.push({ text, level });
	};
	return {
		notifications,
		restore: () => {
			ui.notify = original;
		},
	};
}

describe("FLOW-06 -- /plan: registration, and every refusal seam at zero provider requests", () => {
	it("case 0 -- /plan and /plan-mode both resolve, and loading both registers zero tools", async () => {
		await withFauxSession({ extensionSource: composite() }, async ({ session }) => {
			expect(session.extensionRunner.getCommand("plan"), 'getCommand("plan") returned undefined').toBeDefined();
			expect(session.extensionRunner.getCommand("plan-mode"), 'getCommand("plan-mode") returned undefined').toBeDefined();
			expect(
				session.extensionRunner.getAllRegisteredTools().length,
				"neither extension may register a tool (BOOT-10)",
			).toBe(0);
		});
	});

	it("case 1 -- protected branch: /plan refuses with classifyGitInvocation's own reason, at zero provider requests", async () => {
		await withFauxSession({ extensionSource: composite(), tools: ["bash"], responses: [] }, async ({ session, faux, cwd }) => {
			gitInit(cwd, "main");

			const expected = classifyGitInvocation(
				{ subcommand: "commit", args: [] },
				{ currentBranch: currentBranch(cwd), protectedBranches: PROTECTED_BRANCHES },
			);
			expect(expected.kind, "HEAD is not classified \"block\" -- not exercising a genuine branch-policy refusal").toBe("block");
			if (expected.kind !== "block") return;

			const ctx = session.extensionRunner.createCommandContext();
			const command = session.extensionRunner.getCommand("plan");
			expect(command, 'getCommand("plan") returned undefined').toBeDefined();
			if (command === undefined) return;

			const { notifications, restore } = captureNotify(ctx);
			try {
				await command.handler("", ctx);
				expect(notifications.length, "a refusal must still report an outcome").toBe(1);
				expect(notifications[0]?.text, "/plan's refusal text does not equal classifyGitInvocation's own reason").toBe(
					expected.reason,
				);
				expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
				expect(faux.state.callCount, "a branch-policy refusal must cost zero provider requests").toBe(0);
			} finally {
				restore();
			}
		});
	});

	it("case 2 -- no .pi/work/<slug>/SPEC.md anywhere: /plan refuses, at zero provider requests", async () => {
		await withFauxSession({ extensionSource: composite(), tools: ["bash"], responses: [] }, async ({ session, faux, cwd }) => {
			gitInit(cwd, "work");

			const ctx = session.extensionRunner.createCommandContext();
			const command = session.extensionRunner.getCommand("plan");
			expect(command, 'getCommand("plan") returned undefined').toBeDefined();
			if (command === undefined) return;

			const { notifications, restore } = captureNotify(ctx);
			try {
				await command.handler("", ctx);
				expect(notifications.length, "a refusal must still report an outcome").toBe(1);
				expect(notifications[0]?.text, "an absent-SPEC refusal must say so").toContain("SPEC.md found anywhere");
				expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
				expect(faux.state.callCount, "an absent-SPEC refusal must cost zero provider requests").toBe(0);
			} finally {
				restore();
			}
		});
	});

	it("case 3 (LOAD-BEARING) -- a SPEC.md on disk that FAILS validateSpec refuses with the validator's own reason, at zero provider requests", async () => {
		await withFauxSession({ extensionSource: composite(), tools: ["bash"], responses: [] }, async ({ session, faux, cwd }) => {
			gitInit(cwd, "work");

			// Deliberately evidence-free §2 -- structurally identical to grill-command.test.ts's own fixture.
			const brokenSpec = ["## 1. Goal", "", "Do the thing.", ""].join("\n");
			mkdirSync(join(cwd, ".pi", "work", "broken-slug"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "work", "broken-slug", "SPEC.md"), brokenSpec, "utf-8");

			const ctx = session.extensionRunner.createCommandContext();
			const command = session.extensionRunner.getCommand("plan");
			expect(command, 'getCommand("plan") returned undefined').toBeDefined();
			if (command === undefined) return;

			const { notifications, restore } = captureNotify(ctx);
			try {
				await command.handler("broken-slug", ctx);
				expect(notifications.length, "a refusal must still report an outcome").toBe(1);
				expect(
					notifications[0]?.text,
					"the pre-flight must surface validateSpec's OWN reason -- an existence check alone would say something else entirely",
				).toContain("Verified Codebase Facts");
				expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
				expect(faux.state.callCount, "a failing-SPEC refusal must cost zero provider requests").toBe(0);
			} finally {
				restore();
			}
		});
	});

	it("case 4 -- two .pi/work/ slugs both carry a SPEC.md, no arg supplied: /plan refuses naming both, at zero provider requests", async () => {
		await withFauxSession({ extensionSource: composite(), tools: ["bash"], responses: [] }, async ({ session, faux, cwd }) => {
			gitInit(cwd, "work");

			for (const slug of ["alpha-slug", "beta-slug"]) {
				mkdirSync(join(cwd, ".pi", "work", slug), { recursive: true });
				writeFileSync(join(cwd, ".pi", "work", slug, "SPEC.md"), renderSpecMarkdown(VALID_SPEC), "utf-8");
			}

			const ctx = session.extensionRunner.createCommandContext();
			const command = session.extensionRunner.getCommand("plan");
			expect(command, 'getCommand("plan") returned undefined').toBeDefined();
			if (command === undefined) return;

			const { notifications, restore } = captureNotify(ctx);
			try {
				await command.handler("", ctx);
				expect(notifications.length, "a refusal must still report an outcome").toBe(1);
				expect(notifications[0]?.text, "an ambiguous-slug refusal must name alpha-slug").toContain("alpha-slug");
				expect(notifications[0]?.text, "an ambiguous-slug refusal must name beta-slug").toContain("beta-slug");
				expect(notifications[0]?.level, "a refusal is an error, not an info message").toBe("error");
				expect(faux.state.callCount, "an ambiguous-slug refusal must cost zero provider requests").toBe(0);
			} finally {
				restore();
			}
		});
	});
});

describe("FLOW-06 -- writePlanIfGated refuses incomplete coverage, and never creates PLAN.md on disk", () => {
	it("does not create PLAN.md when a task covers R1 but the SPEC also declares R2", () => {
		const cwd = mkdtempSync(join(tmpdir(), "kypi-plan-write-"));
		try {
			mkdirSync(join(cwd, ".pi", "work", "probe-slug"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "work", "probe-slug", "SPEC.md"), renderSpecMarkdown(VALID_SPEC), "utf-8");

			const incompletePlan = [
				"# PLAN",
				"",
				"## Task List",
				"",
				"- [ ] T001 [R1] Add rotation to src/auth/session.ts | verify: npm test",
				"",
			].join("\n");

			const verdict = writePlanIfGated(cwd, "probe-slug", incompletePlan);

			expect(verdict.ok, `expected reject, got: ${JSON.stringify(verdict)}`).toBe(false);
			const planPath = join(cwd, ".pi", "work", "probe-slug", "PLAN.md");
			expect(
				existsSync(planPath),
				"PLAN.md was created on disk despite a reject verdict -- a gate that returns a refusal " +
					"while still writing is the exact failure this asserts against",
			).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
