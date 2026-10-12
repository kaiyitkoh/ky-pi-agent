---
phase: 10-context-budget-progressive-disclosure
plan: 04
subsystem: prompt-cache-discipline
tags: [context-hook, prompt-stability, token-budget, lint]
requires: ["10-03"]
provides:
  - "faux proof that a context handler cannot change provider tools, with context_with_system and smuggled-system-message negative controls"
  - "tracked-source lint banning context_with_system, toolsAdded and toolsRemoved"
  - "three-turn byte-stability test for implement and full profiles, with a volatile-section negative control"
  - "static prompt-metadata lint"
  - "CI token budgets for AGENTS.md, rendered context block and comment rules"
key-files:
  created:
    - tests/integration/context-hook-tools.test.ts
    - tests/unit/context-hook-lint.test.ts
    - tests/integration/prompt-stability.test.ts
    - tests/unit/prompt-metadata-lint.test.ts
    - tests/unit/agents-md-budget.test.ts
requirements-completed: [CTX-02, CTX-03, CTX-04]
completed: 2026-10-13
---

# Phase 10 Plan 04: Prompt-cache discipline and context budgets Summary

Five test files, no production changes: the context hook is proven unable to strip tools by ordinary message rewrites, the system prompt is proven byte-stable across a moved clock, branch switch and dirty tree, and the context file sits under CI token budgets.

## Budgets (estimator: `estimateTokensFromChars`, ceil(chars/4))

| Budget | Measured | Chosen | Headroom |
|---|---|---|---|
| AGENTS_MD_BUDGET | 414 tok (1653 chars) | 450 | 8.7% |
| RENDERED_BLOCK_BUDGET | 456 tok (1824 chars: content + assumed 60-char path + wrapper 55 + project_context markers 56) | 500 | 9.6% |
| COMMENT_RULES_BUDGET | 198 tok (792 chars, the `<code_comments>` section as rendered in a real session) | 210 | 6.1% |

All three proposals fell inside the 5-15% window, so none were adjusted. Mutation proof: lowering each budget by one token below measured fails exactly that case.

## Tasks and commits
1. Context hook tools test and lint: c97c904
2. Prompt stability and metadata lint: 74c39f8
3. Token budgets: 4810bf2

## Deviations from Plan

**1. [Rule 1 - finding] A `context` handler CAN change tools by returning a system-shaped message**
- Pi 1.1.0 `restoreSystemMessages` (runner.js:101-106) filters system messages from what it hands in but prepends the real head to whatever is returned, so a returned `{role:"system", toolsRemoved:[...]}` removes tools. Plain message rewrites (including adding `toolsRemoved`/`toolsAdded` fields on non-system messages) do not.
- Handling: the test asserts the true guarantee (plain rewrite cannot change tools), records the loophole as its own test, and the lint additionally bans `toolsAdded` and `toolsRemoved` in tracked extension source (none exist today). Not weakened.

**2. [Rule 3 - fixture limit] Cost non-vacuity uses token usage**
- The faux provider always reports zero cost (faux.js:164), so "cost after turn 2 > turn 1" cannot hold. The test asserts `getSessionStats().tokens.total` strictly increases across turns, and asserts no `$N.NN` figure appears in any prompt.

No volatile source or `context_with_system` user was found in the tree; Pi's default prompt carries no date, so no production fix was needed.

## Mutation proofs
- Lint: appending `// toolsRemoved` to a tracked extension file fails the scan (restored).
- Smuggling case: emptying the removed-tools list fails the test (restored).
- Metadata lint: a `${Date.now()}` in a bg_kill promptSnippet fails the scan (restored).
- Stability: the volatile-section control must produce a non-empty reason; it does.
- Budgets: see above.

## Verification
Five files, 19 tests pass in one `--maxWorkers=2` run; `npx tsc --noEmit` exits 0.

## Self-Check: PASSED
