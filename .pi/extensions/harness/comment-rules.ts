// Single machine copy of the comment rules; AGENTS.md mirrors it verbatim.
export const COMMENT_RULES_HEADING = "## Code comments";

export const COMMENT_RULES_SECTION = "code_comments";

export const COMMENT_RULES_TEXT = [
	"## Code comments",
	"- Default to no comment. Names and types say WHAT; comment only a non-obvious WHY: a constraint, invariant, workaround, or surprising choice.",
	"- One or two lines. Longer explanation belongs in docs/ or the commit message.",
	'- Never narrate code ("loop over items", "set default") or restate a signature.',
	'- No history: no plan, phase, requirement, review or ticket IDs, no "previously", "fixed", "corrected by". Git holds that.',
	'- No caller or task references ("used by X", "added for Y flow"); they go stale.',
	"- Cite an external fact as one line with file:line or URL, not a quoted analysis.",
	"- JSDoc only on exported API: one sentence plus non-obvious params.",
	"- When editing code, update or delete its comments; a wrong comment is worse than none.",
].join("\n");
