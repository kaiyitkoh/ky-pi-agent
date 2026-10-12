/**
 * /grill command: two entry points, no flags, gated. Procedure lives in the "grill" skill and docs/WORKFLOWS.md.
 * Registers one command, zero tools; interrogation goes through pi.sendUserMessage, never a nested model call.
 * While armed, each turn is told its question slot, and each turn's SPEC.md is re-gated and re-rendered.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { claimWorkflow, isActiveWorkflow } from "../../lib/active-workflow.ts";
import { workDir } from "../../lib/work-artifacts.ts";
import { classifyGitInvocation, currentBranch } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";
import { HARD_QUESTION_BUDGET, INTERVIEW_PERSPECTIVES, nextQuestionSlot } from "./scorecard.ts";
import { validateGatedSpec } from "./spec-gate.ts";
import { gateRequirementsAuthorship, renderSpecMarkdown, type SpecGateVerdict } from "./spec-schema.ts";

/** The one artifact this subsystem ever writes -- named once, reused everywhere below. */
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

/** The most-recently-modified `.pi/work/` subdirectory name, or undefined when `.pi/work/` does not exist. */
function latestWorkSlug(cwd: string): string | undefined {
	const root = resolve(join(cwd, ".pi", "work"));
	if (!existsSync(root)) {
		return undefined;
	}
	const dirs = readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => ({ name: e.name, mtime: statSync(join(root, e.name)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime);
	return dirs[0]?.name;
}

/** The only function that writes a gated SPEC.md: authorship first, then the full gate every reader applies; only the re-rendered artifact reaches disk. */
export function writeSpecIfGated(cwd: string, slug: string, markdown: string): SpecGateVerdict {
	const factsVerdict = gateRequirementsAuthorship(markdown);
	if (!factsVerdict.ok) {
		return factsVerdict;
	}
	const validated = validateGatedSpec(markdown);
	if (!validated.ok) {
		return { ok: false, reason: validated.reason };
	}
	const dir = workDir(cwd, slug);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, SPEC_FILE_NAME), renderSpecMarkdown(validated.spec), "utf-8");
	return { ok: true };
}

interface GrillRun {
	readonly cwd: string;
	readonly slug: string;
	asked: number;
	lastMtime: number;
	lastReject?: string;
}

/** The per-turn instruction: which question slot this is, or that the budget is spent, plus the last gate refusal. */
function turnBrief(run: GrillRun): string {
	const slot = nextQuestionSlot(run.asked);
	const lines = [
		"exhausted" in slot
			? `${slot.reason}. Write .pi/work/${run.slug}/${SPEC_FILE_NAME} now and ask nothing further.`
			: `Question ${slot.index + 1} of ${HARD_QUESTION_BUDGET}: ask exactly one question as the ${INTERVIEW_PERSPECTIVES[slot.index]?.label} (${INTERVIEW_PERSPECTIVES[slot.index]?.surfaces}), or write .pi/work/${run.slug}/${SPEC_FILE_NAME} if every gate already clears.`,
	];
	if (run.lastReject !== undefined) lines.push(`The last ${SPEC_FILE_NAME} was refused by the gate: ${run.lastReject}`);
	return lines.join("\n");
}

export default function (pi: ExtensionAPI): void {
	let run: GrillRun | undefined;
	/** The armed run, dropped once another workflow command has claimed the session. */
	const armed = (): GrillRun | undefined => (run = run !== undefined && isActiveWorkflow("grill") ? run : undefined);

	pi.registerCommand("grill", {
		description: "Interrogate a change into a gated SPEC.md before any plan or code exists",
		handler: async (args, ctx) => {
			// Order is the claim: parse -> git guard -> resolve slug -> idle guard -> hand off.
			const task = args.trim();
			const usage = () => ctx.ui.notify('grill: usage is "/grill <description>" or "/grill --resume"', "error");
			if (task === "" || (task !== "--resume" && task.startsWith("-"))) {
				usage();
				return;
			}

			const verdict = classifyGitInvocation(
				{ subcommand: "commit", args: [] },
				{ currentBranch: currentBranch(ctx.cwd), protectedBranches: PROTECTED_BRANCHES },
			);
			if (verdict.kind === "block") return void ctx.ui.notify(verdict.reason, "error");

			let slug: string;
			try {
				if (task === "--resume") {
					const latest = latestWorkSlug(ctx.cwd);
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
				}
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
				return;
			}

			if (!ctx.isIdle()) return void ctx.ui.notify("grill: a turn is already in flight -- wait for it to finish", "error");

			// A resume is the user's explicit choice to keep asking, so it starts a fresh budget.
			claimWorkflow("grill");
			run = { cwd: ctx.cwd, slug, asked: 0, lastMtime: 0 };
			const description = task === "--resume" ? `resume the interrogation already in progress in .pi/work/${slug}` : task;
			pi.sendUserMessage(
				`Read the "grill" skill before doing anything else, then interrogate this request: ${description}\n\n` +
					"Read and grep the codebase BEFORE proposing anything. Ask exactly ONE question per turn, " +
					`rotating perspective per the skill's own table. Work in .pi/work/${slug}/.`,
			);
		},
	});

	pi.on("session_start", () => void (run = undefined));

	pi.on("before_agent_start", () => {
		const current = armed();
		return current === undefined ? undefined : { message: { customType: "grill-turn", content: turnBrief(current), display: false } };
	});

	pi.on("agent_end", (_event, ctx) => {
		const current = armed();
		if (current === undefined) return;
		current.asked += 1;
		try {
			const file = join(workDir(current.cwd, current.slug), SPEC_FILE_NAME);
			if (existsSync(file) && statSync(file).mtimeMs !== current.lastMtime) {
				const gated = writeSpecIfGated(current.cwd, current.slug, readFileSync(file, "utf-8"));
				current.lastMtime = statSync(file).mtimeMs;
				if (gated.ok) {
					run = undefined;
					return void ctx.ui.notify(`grill: .pi/work/${current.slug}/${SPEC_FILE_NAME} passed every gate and was re-rendered`, "info");
				}
				current.lastReject = gated.reason;
				ctx.ui.notify(`grill: ${SPEC_FILE_NAME} refused -- ${gated.reason}`, "warning");
			}
			if (current.asked > HARD_QUESTION_BUDGET) {
				run = undefined;
				ctx.ui.notify(`grill: question budget spent with no gated ${SPEC_FILE_NAME} -- downstream commands will refuse it; run "/grill --resume" to continue`, "error");
			}
		} catch (err) {
			run = undefined;
			ctx.ui.notify(`grill: gate not applied -- ${err instanceof Error ? err.message : String(err)}`, "error");
		}
	});
}
