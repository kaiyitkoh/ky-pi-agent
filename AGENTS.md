## Commands
- Test touched files only: `npx vitest run <file> --maxWorkers=2`. Full `npm test` once, last; never parallel runs.
- Typecheck: `npx tsc --noEmit`.

## Conventions
- POSIX `sh` only; no PowerShell, no bashisms.
- Extensions: `.pi/extensions/<name>/index.ts`, loaded by jiti; no build step.
- `@earendil-works/*` and `typebox` are peerDependencies `"*"`, never bundled; unscoped `typebox`, never `@sinclair`.
- Pin exact versions; no bare `npm:pkg` or unrefed git URL.
- Verify Pi behaviour in `node_modules/@earendil-works/*/dist`, not docs.
- Smallest correct diff; delete dead code; no speculative options or impossible-case guards.

## Boundaries
- Public repo: never commit secrets, credentials, account ids or hostnames.
- No paid or hosted services; zero spend beyond model tokens.
- Add a tool only if CONTRIBUTING.md's boundary rule is met; else a command or skill.
- Ask before adding a dependency or removing intentional-looking behaviour.

## Code comments
- Default to none. Comment only a non-obvious WHY (constraint, invariant, workaround, surprise), in 1-2 lines.
- Never narrate code or restate a signature.
- No history: no phase, plan, ticket or review IDs, "previously", "fixed", "used by X". Git holds that.
- Cite an external fact as one line: file:line or URL.
- JSDoc only on exported API, one sentence. Update or delete a comment when its code changes.
- Vendored files (see PROVENANCE.md) are exempt.

## Testing and git
- Tests use the faux provider (`tests/helpers/`); no real provider, network or credentials.
- Stage only your paths (agents share this worktree); never `git add -A`, `stash`, `reset --hard`, `clean`.
- Never push or merge to `main` without the user.
