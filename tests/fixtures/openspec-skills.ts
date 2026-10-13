/** The twelve OpenSpec workflows and the skill name each one generates. */
export const OPENSPEC_WORKFLOWS: readonly { workflow: string; skill: string }[] = [
	{ workflow: "propose", skill: "openspec-propose" },
	{ workflow: "explore", skill: "openspec-explore" },
	{ workflow: "new", skill: "openspec-new-change" },
	{ workflow: "continue", skill: "openspec-continue-change" },
	{ workflow: "apply", skill: "openspec-apply-change" },
	{ workflow: "update", skill: "openspec-update-change" },
	{ workflow: "ff", skill: "openspec-ff-change" },
	{ workflow: "sync", skill: "openspec-sync-specs" },
	{ workflow: "archive", skill: "openspec-archive-change" },
	{ workflow: "bulk-archive", skill: "openspec-bulk-archive-change" },
	{ workflow: "verify", skill: "openspec-verify-change" },
	{ workflow: "onboard", skill: "openspec-onboard" },
];

/** Skill names only, in workflow order. */
export const OPENSPEC_SKILL_NAMES: readonly string[] = OPENSPEC_WORKFLOWS.map((w) => w.skill);

/**
 * A SKILL.md in the shape @fission-ai/openspec 1.13.2 writes (core/shared/skill-generation.js:113-123).
 * `flag` adds a `disable-model-invocation` line; "quoted" yields a string, which Pi does not honour.
 */
export function openspecSkillMd(skill: string, flag?: "true" | "quoted" | "false"): string {
	const workflow = OPENSPEC_WORKFLOWS.find((w) => w.skill === skill)?.workflow ?? skill;
	const flagLine =
		flag === undefined
			? []
			: [flag === "true" ? "disable-model-invocation: true" : flag === "quoted" ? 'disable-model-invocation: "true"' : "disable-model-invocation: false"];
	return [
		"---",
		`name: ${skill}`,
		...flagLine,
		`description: Guides the ${workflow} step of a spec-driven change using the openspec command line tool, reading the current change artifacts first and then proposing the next edit. Use it when the user asks to work on an OpenSpec change and wants the step carried out with the CLI available.`,
		"allowed-tools: Bash(openspec:*)",
		"license: MIT",
		"compatibility: Requires openspec CLI.",
		"metadata:",
		"  author: openspec",
		'  version: "1.0"',
		'  generatedBy: "1.13.2"',
		"---",
		"",
		`Run the ${workflow} step. The same flow is available as /opsx-${workflow}.`,
		"The generated header carries disable-model-invocation only when the harness patches it in.",
		"",
	].join("\n");
}

/** A prompt template in the shape the openspec pi adapter writes (command-generation/adapters/pi.js). */
export function openspecPromptMd(workflow: string): string {
	return [
		"---",
		`description: Run the OpenSpec ${workflow} workflow for the current change`,
		"---",
		"",
		`OPSX-TEMPLATE-${workflow}`,
		"",
	].join("\n");
}
