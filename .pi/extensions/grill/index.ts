/**
 * /grill command: two entry points, no flags, gated. Procedure lives in the "grill" skill and docs/WORKFLOWS.md.
 * Registers one command, zero tools; interrogation goes through pi.sendUserMessage, never a nested model call.
 * While armed, each turn is told its question slot, and each turn's SPEC.md is re-gated and re-rendered.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { workDir, workSlugs } from "../../lib/work-artifacts.ts";
import { ledgerFile } from "../execute/ledger.ts";
import { commitRefusal, ensureHarnessIgnored } from "../execute/progress.ts";
import { HARD_QUESTION_BUDGET, INTERVIEW_PERSPECTIVES, nextQuestionSlot } from "./scorecard.ts";
import { validateGatedSpec } from "./spec-gate.ts";
import { gateRequirementsAuthorship, renderSpecMarkdown, type SpecGateVerdict } from "./spec-schema.ts";
import { registerGatedTurns, type GatedRun } from "./turns.ts";

const SPEC_FILE_NAME = "SPEC.md";

/** A `.pi/work/<slug>/` slug from free text; `workDir` is the SLUG_PATTERN authority, so an illegal result surfaces as a caught refusal. */
function deriveSlug(description: string): string {
	return description
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

/** The only function that writes a gated SPEC.md: authorship first, then the full gate every reader applies; only the re-rendered artifact reaches disk. */
export function writeSpecIfGated(cwd: string, slug: string, markdown: string): SpecGateVerdict {
	const factsVerdict = gateRequirementsAuthorship(markdown);
	if (!factsVerdict.ok) return factsVerdict;
	const validated = validateGatedSpec(markdown);
	if (!validated.ok) return { ok: false, reason: validated.reason };
	const dir = workDir(cwd, slug);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, SPEC_FILE_NAME), renderSpecMarkdown(validated.spec), "utf-8");
	return { ok: true };
}

/** The per-turn instruction: which question slot this is, or that the budget is spent, plus the last gate refusal. */
function turnBrief(run: GatedRun): string {
	const slot = nextQuestionSlot(run.turns);
	const lines = [
		"exhausted" in slot
			? `${slot.reason}. Write .pi/work/${run.slug}/${SPEC_FILE_NAME} now and ask nothing further.`
			: `Question ${slot.index + 1} of ${HARD_QUESTION_BUDGET}: ask exactly one question as the ${INTERVIEW_PERSPECTIVES[slot.index]?.label} (${INTERVIEW_PERSPECTIVES[slot.index]?.surfaces}), or write .pi/work/${run.slug}/${SPEC_FILE_NAME} if every gate already clears.`,
	];
	if (run.lastReject !== undefined) lines.push(`The last ${SPEC_FILE_NAME} was refused by the gate: ${run.lastReject}`);
	return lines.join("\n");
}

export default function (pi: ExtensionAPI): void {
	const arm = registerGatedTurns(pi, {
		workflow: "grill",
		file: SPEC_FILE_NAME,
		customType: "grill-turn",
		gate: writeSpecIfGated,
		brief: turnBrief,
		spent: `question budget spent with no gated ${SPEC_FILE_NAME} -- downstream commands will refuse it; run "/grill --resume" to continue`,
	});

	pi.registerCommand("grill", {
		description: "Interrogate a change into a gated SPEC.md before any plan or code exists",
		handler: async (args, ctx) => {
			// Order is the claim: parse -> git guard -> resolve slug -> idle guard -> hand off.
			const task = args.trim();
			if (task === "" || (task !== "--resume" && task.startsWith("-"))) {
				return void ctx.ui.notify('grill: usage is "/grill <description>" or "/grill --resume"', "error");
			}
			let slug: string;
			try {
				const refusal = commitRefusal(ctx.cwd);
				if (refusal !== undefined) return void ctx.ui.notify(refusal, "error");
				if (task === "--resume") {
					const latest = workSlugs(ctx.cwd)[0];
					if (latest === undefined) return void ctx.ui.notify("grill --resume: no .pi/work/ directory exists to resume", "error");
					slug = latest;
					if (!existsSync(join(workDir(ctx.cwd, slug), SPEC_FILE_NAME))) {
						return void ctx.ui.notify(`grill --resume: .pi/work/${slug} holds no ${SPEC_FILE_NAME} draft to resume`, "error");
					}
				} else {
					slug = deriveSlug(task);
					if (existsSync(workDir(ctx.cwd, slug))) {
						return void ctx.ui.notify(`grill: .pi/work/${slug} already exists -- run "/grill --resume" instead`, "error");
					}
					// A fresh SPEC must not inherit an earlier run's accepted tasks, whose ids restart at T001.
					const stale = ledgerFile(ctx.cwd, slug);
					if (existsSync(stale)) return void ctx.ui.notify(`grill: ${stale} still records an earlier /execute run of "${slug}" -- delete that file yourself, or reword the task`, "error");
				}
				const ignoredNow = ensureHarnessIgnored(ctx.cwd);
				if (ignoredNow !== undefined) ctx.ui.notify(`grill: ${ignoredNow}`, "info");
			} catch (err) {
				return void ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}

			if (!ctx.isIdle()) return void ctx.ui.notify("grill: a turn is already in flight -- wait for it to finish", "error");

			// A resume is the user's explicit choice to keep asking, so it starts a fresh budget.
			arm(ctx.cwd, slug);
			const description = task === "--resume" ? `resume the interrogation already in progress in .pi/work/${slug}` : task;
			pi.sendUserMessage(
				`Read the "grill" skill before doing anything else, then interrogate this request: ${description}\n\n` +
					"Read and grep the codebase BEFORE proposing anything. Ask exactly ONE question per turn, " +
					`rotating perspective per the skill's own table. Work in .pi/work/${slug}/.`,
			);
		},
	});
}
