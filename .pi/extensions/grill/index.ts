/**
 * FLOW-02 / FLOW-03 -- the /grill command. Two entry points, no flags,
 * gated. The interrogation procedure, the four ambiguity dimensions, the
 * perspective rotation and the SPEC.md outline live in the "grill" skill
 * (.pi/skills/grill/SKILL.md, loaded on demand) and docs/WORKFLOWS.md (plan
 * 09-17). Terseness here IS the WORKFLOW_TEXT_BUDGETS ceiling being
 * honoured, matching workflows/index.ts's own header discipline.
 *
 * CHOKEPOINT HYGIENE (DIAG-03 / QUAL-02): this file never reaches a model
 * directly -- interrogation is handed to the ordinary prompt loop via
 * pi.sendUserMessage, never a nested model call. It does not spell, even in
 * a comment, the documented direct-completion method on the model registry,
 * its simple-options or streaming siblings, the method that hands back a raw
 * provider object, the other route to a raw provider object, a deep import
 * under the pi-ai package's adapter path, or the model runtime class name --
 * the same six-plus-one bypass routes tests/unit/chokepoint-lint.test.ts
 * enumerates for DIAG-03.
 *
 * BOUNDARY RULE (BOOT-10): registers exactly one command, zero tools. Does
 * not spell the tool-registration call, in code or in prose.
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

/** A `.pi/work/<slug>/` slug derived from a free-text description. `workDir` is the SLUG_PATTERN authority; an illegal result surfaces as a thrown, caught refusal, not a second check here. */
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

/**
 * The ONLY function in this subsystem that writes SPEC.md. Runs
 * `gateRequirementsAuthorship`, then `validateSpec`, then `gateAmbiguity` on
 * the parsed §8 scorecard -- refusing with the predicate's own reason on the
 * first failure. Never writes the raw `markdown` parameter straight to disk:
 * only `renderSpecMarkdown`'s own re-rendering of the VALIDATED artifact ever
 * reaches `writeFileSync`, so the file on disk is always the shape the
 * validator accepted, never whatever text happened to arrive.
 */
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
			// Order is the whole claim: parse -> git guard -> resolve slug -> idle guard -> hand off.
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
