// Single machine copy of the comment rules; AGENTS.md carries these rules plus the vendored-exemption bullet.
export const COMMENT_RULES_HEADING = "## Code comments";

export const COMMENT_RULES_SECTION = "code_comments";

export const COMMENT_RULES_TEXT = [
	"## Code comments",
	"- Default to none. Comment only a non-obvious WHY (constraint, invariant, workaround, surprise), in 1-2 lines.",
	"- Never narrate code or restate a signature.",
	'- No history: no phase, plan, ticket or review IDs, "previously", "fixed", "used by X". Git holds that.',
	"- Cite an external fact as one line: file:line or URL.",
	"- JSDoc only on exported API, one sentence. Update or delete a comment when its code changes.",
].join("\n");

const FENCED_BLOCK = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*\r?$/gm;
const HEADING_LINE = /^##[ \t]+code comments[ \t]*\r?$/im;

/** True when `text` has a level-2 "Code comments" heading outside fenced code; such a section replaces the harness rules. */
export function hasCommentRulesHeading(text: string): boolean {
	return HEADING_LINE.test(text.replace(FENCED_BLOCK, ""));
}
