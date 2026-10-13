/**
 * Quality-layer cost ledger: the accumulator `quality/` pays into and `diagnostics/index.ts`'s `turn_end` drains once per turn.
 * Lives on `globalThis`, not a module variable, because jiti gives separate import graphs separate module copies
 * (the same hazard `routing/modes.ts` documents), and a copy `turn_end` does not share would under-report.
 * Omission rule: `takeQualityCost` returns `undefined` when nothing was added, never `{qualityMs: 0}`.
 * NEVER THROWS: an accounting failure must not replace a real gate verdict, so every function swallows.
 * Registers nothing.
 */

/** The `globalThis` key this module's accumulator lives under. */
const QUALITY_COST_KEY = "__kypiQualityCost";

/** What {@link addQualityCost} contributes on one call. Both fields optional. */
export interface QualityCostInput {
	readonly ms?: number;
	readonly tokens?: number;
}

/** What {@link takeQualityCost} and {@link peekQualityCost} return: both fields present, or `undefined` overall. */
export interface QualityCost {
	readonly qualityMs?: number;
	readonly qualityTokens?: number;
}

/** Internal shape: always both counters. */
interface QualityCostSlot {
	readonly ms: number;
	readonly tokens: number;
}

/** Narrow an unknown `globalThis` slot; anything unreadable, or cleared to `undefined`, means nothing to report. */
function readSlot(): QualityCostSlot | undefined {
	const raw = (globalThis as Record<string, unknown>)[QUALITY_COST_KEY];
	if (typeof raw !== "object" || raw === null) {
		return undefined;
	}
	const candidate = raw as Partial<QualityCostSlot>;
	if (typeof candidate.ms !== "number" || typeof candidate.tokens !== "number") {
		return undefined;
	}
	return { ms: candidate.ms, tokens: candidate.tokens };
}

function writeSlot(slot: QualityCostSlot | undefined): void {
	(globalThis as Record<string, unknown>)[QUALITY_COST_KEY] = slot;
}

/** NEVER THROWS. */
function readCost(): QualityCost | undefined {
	try {
		const slot = readSlot();
		return slot === undefined ? undefined : { qualityMs: slot.ms, qualityTokens: slot.tokens };
	} catch {
		return undefined;
	}
}

/** Add one contribution to the current turn's ledger; sums across the gate, reviewer and refute callers. NEVER THROWS. */
export function addQualityCost(input: QualityCostInput): void {
	try {
		const current = readSlot() ?? { ms: 0, tokens: 0 };
		writeSlot({
			ms: current.ms + (input.ms ?? 0),
			tokens: current.tokens + (input.tokens ?? 0),
		});
	} catch {
		// Swallow: an accounting failure must never turn a passing turn into an exception.
	}
}

/** Return and CLEAR the ledger; `undefined` when nothing was added. Only `turn_end` may call it. NEVER THROWS. */
export function takeQualityCost(): QualityCost | undefined {
	const cost = readCost();
	try {
		writeSlot(undefined);
	} catch {}
	return cost;
}

/**
 * Subtract one caller's own prior {@link addQualityCost} contribution, floored at zero per field, leaving other
 * contributors intact (`takeQualityCost` would drain them too). Clears the slot when the result is zero; a
 * separate deliberate `{ms: 0}` contribution is indistinguishable then, which is accepted. NEVER THROWS.
 */
export function refundQualityCost(input: QualityCostInput): void {
	try {
		const current = readSlot();
		if (current === undefined) {
			// Nothing recorded: no-op rather than a guess.
			return;
		}
		const ms = Math.max(0, current.ms - (input.ms ?? 0));
		const tokens = Math.max(0, current.tokens - (input.tokens ?? 0));
		writeSlot(ms === 0 && tokens === 0 ? undefined : { ms, tokens });
	} catch {
		// Swallow: an accounting failure must never turn a passing gate result into an exception.
	}
}

/** Read the ledger WITHOUT clearing it. For tests only: a peek mistaken for a take double-attributes cost. NEVER THROWS. */
export function peekQualityCost(): QualityCost | undefined {
	return readCost();
}
