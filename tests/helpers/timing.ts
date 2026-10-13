/**
 * Multiplier for wall-clock budgets. Shared CI runners measured 2-150x slower than a dev machine on the same
 * linear-time code (GC pauses, noisy neighbours), while a super-linear regression costs orders of magnitude more.
 */
export const CI_TIME_FACTOR = process.env.CI ? 5 : 1;

/** Milliseconds `run` takes, re-measured up to twice while over `budgetMs`: noise only ever adds time. */
export function settledMs(run: () => void, budgetMs: number): number {
	let best = Number.POSITIVE_INFINITY;
	for (let attempt = 0; attempt < 3 && best >= budgetMs; attempt++) {
		const start = performance.now();
		run();
		best = Math.min(best, performance.now() - start);
	}
	return best;
}
