# ky-pi-agent — agent instructions

## Code comments
- Default to no comment. Names and types say WHAT; comment only a non-obvious WHY: a constraint, invariant, workaround, or surprising choice.
- One or two lines. Longer explanation belongs in docs/ or the commit message.
- Never narrate code ("loop over items", "set default") or restate a signature.
- No history: no plan, phase, requirement, review or ticket IDs, no "previously", "fixed", "corrected by". Git holds that.
- No caller or task references ("used by X", "added for Y flow"); they go stale.
- Cite an external fact as one line with file:line or URL, not a quoted analysis.
- JSDoc only on exported API: one sentence plus non-obvious params.
- When editing code, update or delete its comments; a wrong comment is worse than none.
- Vendored files (each has a PROVENANCE.md) are exempt.

## Conventions
- Platform: Windows Git Bash now, macOS later. POSIX `sh` only; never PowerShell scripts.
- Public repo: never commit credentials, secrets, account ids or hostnames.
- Node >= 22.19.0.
- Pin exact versions; no bare `npm:pkg` and no unrefed git URLs.
- Extensions are `.ts` loaded by jiti; no build step. Entry: `.pi/extensions/<name>/index.ts`.
- `@earendil-works/*` and `typebox` are peerDependencies `"*"`; never bundle them.
- Use unscoped `typebox`, not `@sinclair/typebox`.
- Tests: `npx vitest run <file> --maxWorkers=2` (targeted, never parallel runs); typecheck with `npx tsc --noEmit`.
- Do not register a tool unless CONTRIBUTING.md's boundary rule is met; commands cost zero per-turn tokens.
- Stage explicit paths, never `git add -A`.
- Never push or auto-merge to `main`.
