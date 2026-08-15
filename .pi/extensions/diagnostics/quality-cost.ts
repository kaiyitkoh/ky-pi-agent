/**
 * QUAL-09's ledger half — the process-wide accumulator the quality layer pays
 * into and `diagnostics/index.ts`'s `turn_end` handler drains once per turn.
 *
 * ---------------------------------------------------------------------------
 * WHY A GLOBALTHIS SLOT, NOT A MODULE-LEVEL VARIABLE
 * ---------------------------------------------------------------------------
 * Pi loads each extension through jiti, which keeps its own module registry,
 * so two different import graphs in one process can hold two separate copies
 * of this module. `routing/modes.ts`'s STATE-SLOT HAZARD docstring and
 * `workflows/evidence.ts`'s identical note both point at the same measured
 * bug: `diagnostics/index.ts`'s own request counter (`ROWS_WRITTEN_KEY`)
 * started as a module-level `let`, and a later importer's writes were
 * invisible to an earlier importer's reads until it moved to `globalThis`.
 * This module's callers are plan 08-06's deterministic gate stage, plan
 * 08-07's reviewer and plan 08-09's refute pass — three DIFFERENT files in
 * `quality/`, each with its own import graph, all writing into the SAME
 * turn's ledger. A module-level accumulator here would silently under-report
 * whichever contributor's copy of this module `index.ts`'s `turn_end`
 * handler did not share, which is a wrong ANSWER (a turn that really cost
 * quality work reported as though it did not), not merely a wrong count. So
 * the accumulator lives under one process-wide key, exactly the pattern
 * `routing/modes.ts` and `diagnostics/index.ts` already established.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE OWNS, AND WHY IT LIVES IN `diagnostics/`
 * ---------------------------------------------------------------------------
 * `diagnostics/` owns the ledger; `quality/` is a producer that writes into
 * it. That is deliberate layering, not an accident of file placement: it is
 * what lets plans 08-06, 08-07 and 08-09 call {@link addQualityCost} from
 * their own plans without a second edit landing here, and it is what keeps
 * `quality/` from importing `diagnostics/`'s turn-composition internals just
 * to report a number.
 *
 * ---------------------------------------------------------------------------
 * THE OMISSION RULE, AT THE ACCUMULATOR
 * ---------------------------------------------------------------------------
 * {@link takeQualityCost} returns `undefined` when nothing was ever added to
 * the slot in this turn — never `{qualityMs: 0}`. A turn the quality layer
 * never touched has no quality share to report, and a fabricated zero on that
 * turn would be indistinguishable on disk from a turn where the quality layer
 * genuinely ran for zero milliseconds. `schema.ts`'s `TurnRow.qualityMs`
 * docstring and `turns.ts`'s `composeTurnRow` apply the same omitted-key rule
 * this subsystem already uses for `reasoning` and `cacheReadRatio`.
 *
 * ---------------------------------------------------------------------------
 * NEVER THROWS
 * ---------------------------------------------------------------------------
 * Copying `safety/audit.ts#writeAuditRow`'s discipline: an accounting failure
 * here must never turn a passing turn into an exception. `addQualityCost` and
 * `takeQualityCost` both catch and swallow, because a caller in `quality/`
 * that depended on this call succeeding before continuing its own gate logic
 * could otherwise have an unhandled exception replace a real verdict — a
 * strictly worse outcome than an unrecorded measurement.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It never registers
 * a tool, and it does not spell that call even in prose —
 * `tests/unit/contributing-boundary.test.ts` matches the name as a plain
 * substring across every tracked source under `.pi/extensions/`, comments
 * included.
 */

/** The `globalThis` key this module's accumulator lives under. */
const QUALITY_COST_KEY = "__kypiQualityCost";

/** What {@link addQualityCost} contributes on one call. Both fields optional. */
export interface QualityCostInput {
	readonly ms?: number;
	readonly tokens?: number;
}

/**
 * What {@link takeQualityCost} and {@link peekQualityCost} hand back.
 *
 * Both fields optional so a caller composing a `TurnRow` can apply the same
 * `if (input.qualityMs !== undefined)` idiom `turns.ts` already uses for
 * every other optional field — but in practice this module only ever returns
 * an object with BOTH fields present (summed, possibly zero from an explicit
 * `{ms: 0}` contribution) or `undefined` when nothing was added at all.
 */
export interface QualityCost {
	readonly qualityMs?: number;
	readonly qualityTokens?: number;
}

/** The accumulator's internal shape: always both counters, never partial. */
interface QualityCostSlot {
	readonly ms: number;
	readonly tokens: number;
}

/**
 * Narrow an unknown `globalThis` slot value before trusting it as an
 * accumulator, exactly like `routing/modes.ts`'s `isKyModeData`.
 *
 * Returns `undefined` for anything that does not look like a slot this module
 * itself wrote — including a slot explicitly cleared to `undefined` by
 * {@link takeQualityCost} — so "nothing was ever added" and "something
 * unreadable is sitting there" both resolve to the same honest answer:
 * nothing to report.
 */
function readSlot(): QualityCostSlot | undefined {
	const raw = (globalThis as Record<string, unknown>)[QUALITY_COST_KEY];
	if (raw === undefined || raw === null || typeof raw !== "object") {
		return undefined;
	}
	const candidate = raw as Partial<QualityCostSlot>;
	if (typeof candidate.ms !== "number" || typeof candidate.tokens !== "number") {
		return undefined;
	}
	return { ms: candidate.ms, tokens: candidate.tokens };
}

function writeSlot(slot: QualityCostSlot): void {
	(globalThis as Record<string, unknown>)[QUALITY_COST_KEY] = slot;
}

function clearSlot(): void {
	(globalThis as Record<string, unknown>)[QUALITY_COST_KEY] = undefined;
}

/**
 * Add one contribution to the current turn's quality-cost ledger.
 *
 * Sums across multiple calls in one turn: the deterministic gate stage
 * (08-06), the reviewer call (08-07) and the refute pass (08-09) each
 * contribute independently, and this function's whole job is to make that
 * safe — the caller never has to know whether it is first, last or the only
 * contributor this turn.
 *
 * NEVER THROWS. A malformed or absent `input` degrades to adding nothing
 * rather than raising — see the module docstring for why a throw here would
 * be a strictly worse outcome than a dropped measurement.
 */
export function addQualityCost(input: QualityCostInput): void {
	try {
		const current = readSlot() ?? { ms: 0, tokens: 0 };
		writeSlot({
			ms: current.ms + (input.ms ?? 0),
			tokens: current.tokens + (input.tokens ?? 0),
		});
	} catch {
		// The instrument cannot instrument its own inability to add. Swallow: an
		// accounting failure must never turn a passing turn into an exception.
	}
}

/**
 * Return and CLEAR the current turn's quality-cost ledger.
 *
 * Returns `undefined` when nothing was ever added — never `{qualityMs: 0}`.
 * Called exactly once, from `diagnostics/index.ts`'s `turn_end` handler; see
 * that file for why no other call site may drain this slot. NEVER THROWS.
 */
export function takeQualityCost(): QualityCost | undefined {
	try {
		const slot = readSlot();
		clearSlot();
		if (slot === undefined) {
			return undefined;
		}
		return { qualityMs: slot.ms, qualityTokens: slot.tokens };
	} catch {
		return undefined;
	}
}

/**
 * Subtract exactly ONE caller's own prior {@link addQualityCost} contribution
 * from the current turn's ledger, leaving every OTHER contributor's own
 * recorded cost untouched.
 *
 * WR-06: `/quick`'s blocking branch used to call {@link takeQualityCost} to
 * drain-and-discard the deterministic gate stage's own cost, on the
 * reasoning that "no turn_end runs for this invocation, so the cost must not
 * bleed into a later turn". That reasoning is only true while the gate
 * stage is the SOLE contributor to a turn. `takeQualityCost` drains the
 * WHOLE ledger, so if a caller had already recorded its own cost earlier in
 * the SAME still-in-progress turn (e.g. a reviewer + refute pass that ran
 * before invoking `/quick` as a sub-step of a larger ceremonial workflow),
 * that cost silently vanished too — the turn's eventual real `turn_end`
 * would find nothing to report, understating what quality work genuinely
 * happened, with nothing on disk saying so.
 *
 * `refundQualityCost` fixes this by subtracting only `input`, floored at
 * zero per field, from whatever the slot currently holds — any OTHER
 * contribution present before this call is preserved. When the result is
 * `{ms: 0, tokens: 0}` the slot is cleared to `undefined` entirely (rather
 * than left as an explicit zero), on the reasoning that a caller using this
 * function has, by definition, just undone its OWN entire contribution — if
 * nothing else remains, nothing was genuinely spent by whatever is left of
 * this turn. KNOWN RESIDUAL LIMITATION: this is indistinguishable from a
 * different caller having separately recorded a genuine, deliberate `{ms:
 * 0}` contribution that also nets to exactly zero here — an edge case the
 * module docstring already calls "the caller's own business to avoid, not
 * this module's to reject", and one this function accepts the same way.
 *
 * NEVER THROWS, same discipline as {@link addQualityCost}/{@link takeQualityCost}.
 */
export function refundQualityCost(input: QualityCostInput): void {
	try {
		const current = readSlot();
		if (current === undefined) {
			// Nothing recorded at all -- there is nothing this call could safely
			// subtract from, so it is a no-op rather than a guess.
			return;
		}
		const ms = Math.max(0, current.ms - (input.ms ?? 0));
		const tokens = Math.max(0, current.tokens - (input.tokens ?? 0));
		if (ms === 0 && tokens === 0) {
			clearSlot();
			return;
		}
		writeSlot({ ms, tokens });
	} catch {
		// The instrument cannot instrument its own inability to refund. Swallow:
		// an accounting failure must never turn a passing gate result into an
		// exception.
	}
}

/**
 * Read the current turn's quality-cost ledger WITHOUT clearing it.
 *
 * FOR TESTS ONLY. Production code always wants {@link takeQualityCost}: a
 * peek that is mistaken for a take leaves the slot live into the next turn,
 * double-attributing this turn's quality cost to whichever turn drains it
 * next. NEVER THROWS.
 */
export function peekQualityCost(): QualityCost | undefined {
	try {
		const slot = readSlot();
		if (slot === undefined) {
			return undefined;
		}
		return { qualityMs: slot.ms, qualityTokens: slot.tokens };
	} catch {
		return undefined;
	}
}
