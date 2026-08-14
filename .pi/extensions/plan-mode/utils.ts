// VENDORED — Pi's own bundled example, `examples/extensions/plan-mode/utils.ts`
// (Pi 0.84.1, this repo's pinned `@earendil-works/pi-coding-agent` devDependency).
// See ./index.ts for the full vendoring record (why, the permitted changes, and
// the grep verification).
//
// DEVIATION 4 (CR-03) — the ONE behavioural change here, and why this file is
// no longer "unmodified apart from this header". Upstream's `isSafeCommand` was
// two regex lists with the SAFE patterns anchored at `^\s*`, so the first word
// decided admissibility; the Phase 7 review defeated it six ways. Both arrays
// (DESTRUCTIVE_PATTERNS, SAFE_PATTERNS) are DELETED rather than bypassed —
// leaving them would be dead code implying a protection that has moved — and
// `isSafeCommand` now delegates to `./read-only.ts`. Full record in
// ./index.ts's DEVIATION 4. Everything else here (cleanStepText,
// extractTodoItems, extractDoneSteps, markCompletedSteps, TodoItem) is
// byte-for-byte upstream and still diffable against a newer bundled example.

/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

import { classifyPlanModeCommand } from "./read-only.ts";

/**
 * Is `command` admissible under plan mode's read-only boundary?
 *
 * The boolean face of {@link classifyPlanModeCommand}, kept because it is this
 * vendored file's published surface and what upstream's own callers use. Both
 * go through ONE implementation, so they cannot disagree —
 * `tests/unit/plan-mode-read-only.test.ts` asserts that agreement on every
 * corpus row rather than trusting it.
 */
export function isSafeCommand(command: string): boolean {
	return classifyPlanModeCommand(command).kind === "allow";
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
		.replace(/`([^`]+)`/g, "$1") // Remove code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	return items;
}

export function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}
