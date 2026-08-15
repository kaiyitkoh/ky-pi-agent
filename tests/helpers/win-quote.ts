/**
 * Test-tree re-export of the one Windows argument quoter.
 *
 * CR2-01 (`08-REVIEW.md` iteration 2) moved the real implementation to
 * `.pi/lib/win-quote.ts` so production code under `.pi/extensions/` (which
 * does not import from `tests/`) could use it too — see that file's own
 * docstring for the full rationale. This file re-exports the same functions
 * under the same names so every existing test import (`pi.ts`,
 * `stub-bin.ts`, `helpers.test.ts`, `npmrc-policy.test.ts`,
 * `load-paths.test.ts`, `global-teardown-exit-code.test.ts`) keeps working
 * unchanged, and there is still exactly ONE implementation, not two that can
 * drift apart.
 */
export { commandFor, quoteForWindows } from "../../.pi/lib/win-quote.ts";
