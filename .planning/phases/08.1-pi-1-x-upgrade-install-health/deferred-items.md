# Deferred items (08.1)

## From 08.1-02

- **Pi 1.1.0 renamed the built-in DeepSeek catalogue id.** `pi-ai@1.1.0 dist/providers/data/deepseek.json` ships `deepseek-flash` and `deepseek-v4-pro`; the id `deepseek-v4-flash` used across `.pi/extensions/{providers,routing}/schema.ts`, `.pi/templates/models-template.json`, docs and ~20 tests no longer resolves in the built-in registry. Surfaces as `tests/integration/fallback-chain.test.ts` case 6 (`missing: ["deepseek/deepseek-v4-flash"]`). Not caused by 08.1-02; touches routing/chain config, so needs a decision (rename vs. define the model in models-template). Needs a plan in 08.1 before phase verification.
- Same root cause also fails `tests/unit/r1-unclamp.test.ts` cases 1-3 (`deepseek/deepseek-v4-flash did not resolve`).
- `tests/integration/dashscope-payload.test.ts` case 4 (Q7): with `supportsStrictMode` left to detection, pi-ai 1.1.0 no longer emits `"strict": false` on `tools[0].function` (got undefined). The Q7 finding is stale; re-read `convertTools` in pi-ai 1.1.0 and re-decide. Not caused by 08.1-02.
