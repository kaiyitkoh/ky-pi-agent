/**
 * /grill command: two entry points, no flags, gated. Procedure lives in the "grill" skill and docs/WORKFLOWS.md.
 * Registers one command, zero tools; interrogation goes through pi.sendUserMessage, never a nested model call.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { workDir } from "../../lib/work-artifacts.ts";
import { classifyGitInvocation, currentBranch } from "../safety/git.ts";
import { PROTECTED_BRANCHES } from "../safety/index.ts";
import { gateAmbiguity } from "./scorecard.ts";
import { parseAmbiguityScorecard } from "./scorecard-parse.ts";
import { gateRequirementsAuthorship, renderSpecMarkdown, validateSpec, type SpecGateVerdict } from "./spec-schema.ts";

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

/** The only function that writes SPEC.md. Runs the authorship, validateSpec and ambiguity gates in order; only `renderSpecMarkdown` output of the validated artifact reaches disk, never the raw `markdown`. */
export function writeSpecIfGated(cwd: string, slug: string, markdown: string): SpecGateVerdict {
	const factsVerdict = gateRequirementsAuthorship(markdown);
	if (!factsVerdict.ok) {
		return factsVerdict;
	}
	const validated = validateSpec(markdown);
	if (!validated.ok) {
		return { ok: false, reason: validated.reason };
	}
	const ambiguityVerdict = gateAmbiguity(parseAmbiguityScorecard(validated.spec.scorecardBody));
	if (!ambiguityVerdict.ok) {
		return ambiguityVerdict;
	}
	const dir = workDir(cwd, slug);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, SPEC_FILE_NAME), renderSpecMarkdown(validated.spec), "utf-8");
	return { ok: true };
}

export default function (pi: ExtensionAPI): void {
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

			const description = task === "--resume" ? `resume the interrogation already in progress in .pi/work/${slug}` : task;
			pi.sendUserMessage(
				`Read the "grill" skill before doing anything else, then interrogate this request: ${description}\n\n` +
					"Read and grep the codebase BEFORE proposing anything. Ask exactly ONE question per turn, " +
					`rotating perspective per the skill's own table. Work in .pi/work/${slug}/.`,
			);
		},
	});
}
