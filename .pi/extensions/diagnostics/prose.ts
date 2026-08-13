/**
 * One predicate, for the one failure mode this whole harness exists to survive.
 *
 * ---------------------------------------------------------------------------
 * Why any of this exists
 * ---------------------------------------------------------------------------
 * A cheap model asked to call a tool sometimes *describes* the call instead of
 * emitting one. On the wire that looks like a perfectly ordinary completion:
 * `finish_reason: "stop"`, `tool_calls: null`, and a function call sitting in
 * `content` as text. The agent loop sees no tool call, so it stops; the user
 * sees a paragraph where a file read should have been. Nothing errors, nothing
 * retries, and nothing is recorded — the turn simply did less than it claimed.
 *
 * DeepSeek-V3 issue #1244 puts the rate near 11% and is still open. That number
 * is the leading root-cause candidate for "DeepSeek misses bugs Sonnet would
 * catch", and Phase 10 is supposed to discriminate between candidates using
 * *this project's own* measured rate. Which is the whole reason this file is a
 * predicate rather than a heuristic sprinkled through a handler: the number it
 * produces is going to be used to make a decision, so it has to be wrong in a
 * direction we chose and can test.
 *
 * ---------------------------------------------------------------------------
 * Why it is a predicate and not a handler
 * ---------------------------------------------------------------------------
 * The effect — `sendUserMessage(..., { deliverAs: "followUp" })` from inside
 * `message_end`, capped at one retry per agent run — lives in `index.ts` and
 * ships in plan 02-09. It needs a live session, a streaming agent and a faux
 * provider to test. The interesting half needs none of those, so it is here,
 * pure and importable, and `tests/unit/prose-detector.test.ts` proves it with
 * no session at all. That split is the house pattern (`tests/helpers/win-quote.ts`
 * pure, `pi.ts` effectful) and 02-PATTERNS.md names it for this file by name.
 *
 * The alternative effect — promoting the parsed prose into a real `toolCall`
 * content block — was executed during research and *works*, and is deliberately
 * not the default: it would execute a tool whose arguments were regex-scraped
 * out of prose, on a laptop where merging to `main` auto-deploys, before
 * Phase 4's guard exists [02-RESEARCH.md §6.4]. Nothing in this file parses
 * arguments. It reports a name and a verdict; that is all.
 *
 * ---------------------------------------------------------------------------
 * The rules it implements
 * ---------------------------------------------------------------------------
 * Four gates, all of which must hold, in this order:
 *
 *   1. `stopReason === "stop"`. Pi's union really does contain that literal
 *      [VERIFIED: pi-ai 0.84.1 dist/types.d.ts:275]. A message that stopped for
 *      `toolUse`, `length`, `error` or `aborted` is a different story with a
 *      different fix, and folding them in here would inflate the rate.
 *   2. No content block of type `"toolCall"`. That is the `tool_calls: null`
 *      half of the signature; Pi normalises provider tool calls into content
 *      blocks [VERIFIED: dist/types.d.ts:295-297, the `content` union]. A model
 *      that emitted a real call and *also* narrated it did its job.
 *   3. A non-empty active-tool-name list. With no names there is nothing a
 *      prose tool call could be *about*, so anything matched would be a pure
 *      false positive.
 *   4. The message's text matches a pattern anchored to those names.
 *
 * `rawStopReason` — the provider's untranslated `finish_reason` — is
 * deliberately NOT a gate. It is richer evidence and belongs in the JSONL row
 * as optional enrichment, but `fauxAssistantMessage` never populates it
 * [02-RESEARCH.md §8.5], so requiring it would make the detector untestable
 * offline and, worse, silently dead against any provider Pi does not map.
 *
 * ---------------------------------------------------------------------------
 * The false positive that matters
 * ---------------------------------------------------------------------------
 * "Use `read({...})` to open the file", written as an *explanation to the
 * user*, is not a failed tool call. Firing on it costs a wasted model call and
 * — far worse — fabricates the rate Phase 10 will reason from. So the pattern
 * is anchored to registered tool names and requires an immediately following
 * `(` and `{`: a mention (`read`), a mention with a paren (`read(path)`) and a
 * name nobody registered (`deploy({...})`) all come back `false`. Seven such
 * negatives are mandatory in the test, against five positives.
 *
 * A miss is cheap here and a false positive is not, which is why every gate
 * above is a conjunction and none of them is fuzzy.
 *
 * ---------------------------------------------------------------------------
 * Bounded matching, deliberately
 * ---------------------------------------------------------------------------
 * This regex is pointed at untrusted model output of arbitrary size. Every
 * whitespace run below is a COUNTED quantifier (`{0,8}`) rather than `\s*`, and
 * there is no `.*` anywhere: catastrophic backtracking on a megabyte of
 * assistant text is a denial of service on the instrument itself
 * [02-RESEARCH.md "Security Domain", ASVS V5 row; threat T-02-04-01].
 * `tests/unit/prose-detector.test.ts` asserts a 1 MB adversarial input
 * completes under two seconds.
 *
 * PURITY. No value imports, no I/O, no dependency — the sibling `redact.ts`
 * posture, and the pinning gate (`tests/unit/pinning.test.ts:253`) fails the
 * build if a package is added. The one import is type-only and comes from
 * `schema.ts`, which is this subsystem's single pi-ai import site.
 */
import type { AssistantMessage } from "./schema.ts";

/**
 * Longest run of whitespace tolerated between the name, the paren and the brace.
 *
 * Eight is generous for `read (\n  {` and far short of anything a real model
 * writes, and — the actual point — it is a *number*. `\s*` here would be an
 * unbounded quantifier adjacent to an alternation on attacker-influenced input.
 */
const MAX_GAP = 8;

/**
 * Escape every regex metacharacter in a literal, so a tool name cannot alter
 * the meaning of the pattern it is spliced into.
 *
 * Tool names are not attacker-controlled today — they come from
 * `pi.getActiveTools()` — but an extension may register any name it likes, and
 * a name containing `.` or `|` or `(` would quietly widen the match rather than
 * failing loudly [threat T-02-04-02]. `edit_file` is in the test table for the
 * neighbouring reason: `_` is a word character, so the leading `\b` has to
 * behave for it too.
 */
export function escapeRegExpLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/**
 * Build the tool-name-anchored matcher, or `undefined` when there is nothing to
 * anchor to.
 *
 * `undefined` for an empty list is the load-bearing case, not an edge case: a
 * pattern built from zero names would either match nothing (harmless) or, if
 * someone later "fixed" it into a generic `\w+\(\{`, match every code block the
 * model ever printed. Returning `undefined` makes the empty list a refusal
 * rather than a degenerate pattern.
 *
 * Shape: `\b(name1|name2|...)[\s]{0,8}\([\s]{0,8}\{`
 *
 * NO `g` FLAG, ON PURPOSE. `redact.ts`'s patterns carry `g` and therefore carry
 * a persistent `lastIndex`, which makes `.test()` lie on every other call. This
 * one is used through both `.test()` and `.exec()`, so it must be stateless.
 */
export function buildProseToolCallPattern(activeToolNames: readonly string[]): RegExp | undefined {
	if (activeToolNames.length === 0) {
		return undefined;
	}
	const names = activeToolNames.map(escapeRegExpLiteral).join("|");
	// Counted quantifiers, not `\s*`, and no `.` anywhere: ReDoS on a megabyte
	// of model output would take the instrument down (threat T-02-04-01).
	return new RegExp(`\\b(${names})[\\s]{0,${MAX_GAP}}\\([\\s]{0,${MAX_GAP}}\\{`);
}

/** The text a reader would see: every `text` block, joined, in order. */
function collectText(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

/**
 * Did this finalized assistant message describe a tool call instead of making
 * one?
 *
 * The four gates of the module docstring, in order, each named at its own site.
 * Every one is a conjunction: a miss costs one un-nudged turn, a false positive
 * costs a model call and corrupts the measurement.
 */
export function isProseToolCall(message: AssistantMessage, activeToolNames: readonly string[]): boolean {
	// Gate 1 — rules out `toolUse`, `length`, `error`, `aborted`, `deferred` and
	// `pending`. Only a clean stop can be a *silently* incomplete turn.
	if (message.stopReason !== "stop") {
		return false;
	}
	// Gate 2 — rules out the model that actually emitted the call and merely
	// narrated it as well. This is the `tool_calls: null` half of the signature.
	if (message.content.some((block) => block.type === "toolCall")) {
		return false;
	}
	// Gate 3 — rules out matching when no tool is active, where any hit would be
	// a false positive by construction.
	const pattern = buildProseToolCallPattern(activeToolNames);
	if (pattern === undefined) {
		return false;
	}
	// Gate 4 — rules out a bare mention (`read`), a mention with a paren
	// (`read(path)`) and an unregistered name (`deploy({...})`). The pattern is
	// stateless, so `.test()` is safe here.
	return pattern.test(collectText(message));
}

/**
 * Which tool was described, when one was.
 *
 * Exists so the retry prompt and the JSONL row can name the tool without
 * re-running the match — and so the row records *what* the model meant to call,
 * which is the field Phase 10 will group by.
 *
 * Returns `undefined` for exactly the messages {@link isProseToolCall} rejects;
 * the two functions cannot disagree because this one asks that one first.
 */
export function proseToolCallName(
	message: AssistantMessage,
	activeToolNames: readonly string[],
): string | undefined {
	if (!isProseToolCall(message, activeToolNames)) {
		return undefined;
	}
	const pattern = buildProseToolCallPattern(activeToolNames);
	return pattern?.exec(collectText(message))?.[1];
}
