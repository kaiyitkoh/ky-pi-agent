# AGENTS.md best practice, and a proposed replacement

**Researched:** 2026-10-14
**Confidence:** HIGH on the vendor docs and on the repo's test constraints. MEDIUM on the length-versus-adherence evidence: there are two peer-reviewed papers, but neither tests a file of this size.

## 1. Findings

**What the sources agree on**

- **The open spec ([agents.md](https://agents.md/))** has no required fields. Its suggested sections are an overview, build and test commands, code style, testing, security, and commit or PR rules. The nearest file wins, and the user's chat prompt overrides every file. The spec gives no length guidance.
- **Codex ([AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md))** concatenates files from the root down to the current directory. A later file overrides an earlier one. The combined cap is `project_doc_max_bytes`, 32 KiB by default. The guide says to keep rules concise and to "reserve formatting and lint checks for CI".
- **Claude Code ([best practices](https://code.claude.com/docs/en/best-practices), [memory](https://code.claude.com/docs/en/memory))** says to aim for fewer than 200 lines and that "Bloated CLAUDE.md files cause Claude to ignore your actual instructions." Its pruning test is "Would removing this cause Claude to make mistakes?"
  - **Include:** commands Claude can't guess, style rules that differ from the defaults, the test runner, repository etiquette, and gotchas.
  - **Exclude:** anything inferable from the code, standard conventions, file-by-file descriptions, and "write clean code".
  - **Emphasis:** put IMPORTANT on one line only. Use hooks for anything that must happen every time.
  - **Imports:** imports do not reduce the context cost.
- **Gemini CLI ([GEMINI.md](https://geminicli.com/docs/cli/gemini-md/))** gives no length guidance. Its files are hierarchical and concatenated, and it can read `AGENTS.md` through `context.fileName`.
- **GitHub's [study of 2,500+ agents.md files](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)** recommends six areas: commands with exact flags, testing, structure, style, git, and boundaries split into always, ask first and never. "Never commit secrets" was the most common useful rule. One real snippet beats paragraphs of prose.

**Measurements**

- **Gloaguen et al., [arXiv 2602.11988](https://arxiv.org/abs/2602.11988) (ICLR 2026):**
  - Context files "do not generally improve task success rates" and raise inference cost by more than 20%.
  - Agents do follow the instructions, but repository overviews do not help.
  - The paper concludes these files should state minimal requirements and non-standard practices only.
- **IFScale, [arXiv 2507.11538](https://arxiv.org/abs/2507.11538) (NeurIPS 2025):** instruction-following degrades as instruction count rises, and earlier instructions are favoured. So the most-violated rules belong near the top.

**Real files (fetched through `gh api` on 2026-10-14)**

| Repo | Size | Notes |
|---|---|---|
| `earendil-works/pi` | 125 lines | Sections: Code Quality, Commands, Dependency Security, Git. Includes "Check node_modules for external API types; don't guess", "Stage explicit paths… never `git add -A`", a list of git commands never to run because "multiple pi sessions may be running in this cwd", and faux-provider-only tests. |
| `astral-sh/uv` | 46 lines | All one-liners with ALWAYS/NEVER/PREFER. Includes "DO NOT leak our conversation… into code comments" and "Avoid past-facing wording." |
| `apache/airflow` | 251 lines | Explicit **Ask first / Never** boundaries. |
| `microsoft/vscode` | 5 lines | A pointer file only. |
| `openai/codex` | — | Only nested, scoped files such as `codex-rs/tui/src/bottom_pane/AGENTS.md`. |
| `vercel/next.js`, `astral-sh/ruff`, `openai-agents-python` | 523, 230 and 214 lines | Counter-examples. Mostly structure tours and workflows that the paper above finds unhelpful. |

**What to leave out:** overviews and architecture tours, directory maps, anything in `package.json` or config (Node engine, test globs), tool defaults, rationale paragraphs, and generic "write clean code" advice.

**Repository constraints any rewrite must pass**

- **`tests/unit/agents-md-budget.test.ts`:**
  - AGENTS.md must stay within 450 estimated tokens (chars / 4).
  - The rendered project-context block must stay within 500 tokens.
  - The injected `<code_comments>` section must stay within 210 tokens.
- **`tests/unit/comment-rules-delivery.test.ts`:**
  - AGENTS.md must contain `COMMENT_RULES_TEXT` verbatim, immediately followed by `\n- Vendored`.
  - The comment block must be at most 15 lines, and the whole file at most 46 lines.
- **Implication:** the brief's "about 60 lines" target is not reachable. The test-imposed ceiling is about 1,800 chars.

**Side finding:** `CLAUDE.md` is 49 KB, roughly 12k tokens of GSD-generated stack notes on top of `@AGENTS.md`. Pi does not load it, but Claude Code pays for it on every turn. That is 25 times what AGENTS.md costs.

## 2. Proposed `AGENTS.md` (33 lines, 1,796 chars, about 449 tokens)

```markdown
## Commands
- Test only touched files: `npx vitest run <file> --maxWorkers=2`.
- Full suite `npm test` once, last. Never run tests in parallel.
- Typecheck: `npx tsc --noEmit`.

## Conventions
- POSIX `sh` only (Windows Git Bash, macOS); no PowerShell, no bashisms.
- Extensions: `.pi/extensions/<name>/index.ts`, loaded by jiti; no build step.
- `@earendil-works/*` and `typebox` are peerDependencies `"*"`, never bundled; `typebox` is unscoped, never `@sinclair`.
- Pin exact versions; no bare `npm:pkg` or unrefed git URL.
- Verify Pi behaviour in `node_modules/@earendil-works/*/dist` (.d.ts, .js.map), not docs.
- Smallest correct diff; delete dead code; no speculative options, layers or impossible-case guards.

## Boundaries
- Never commit secrets, credentials, account ids or hostnames: the repo is public.
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

## Testing
- No real provider, network or credentials in tests; use the faux provider (`tests/helpers/`).

## Git
- Stage only paths you changed (agents share this worktree); never `git add -A`, `stash`, `reset --hard`, `clean`.
- Never push or merge to `main` without the user.
```

**Budget:** the draft is 449 of 450 tokens, which leaves no headroom. When adopting it, raise `AGENTS_MD_BUDGET` to 480 and `RENDERED_BLOCK_BUDGET` to 530 with a re-measured `why`. Alternatively, cut the "Ask before…" line.

**Dropped from the current file:**
- `Node >= 22.19.0`: it is already in `package.json` `engines`.
- The H1 title: Pi already wraps the file with its path.
- Long-form comment rules: these are merged below.

**Kept despite being a vitest default:** `--maxWorkers=2`. `vitest.config.ts` already sets `maxWorkers: 2`, so the flag is redundant. The user asked for it explicitly, and it costs about 4 tokens. Drop it if the user accepts that the config enforces it.

## 3. Why each section exists

- **Commands:** the commands an agent can't guess, plus the user's CPU constraint (targeted tests, one full run). The first position gets the strongest adherence (IFScale position bias).
- **Conventions:** non-default stack facts that models get wrong from training data (`@sinclair/typebox`, adding a build step, bashisms). Also the user's verify-at-source and shrink-don't-bloat rules, stated as checkable actions rather than "write good code".
- **Boundaries:** the never and ask-first split from GitHub's study and Airflow's file. This covers the public-repo secrets rule, the zero-spend rule and the per-turn cost of a tool.
- **Code comments:** the user's core style rule. It must match `COMMENT_RULES_TEXT` verbatim, and uv's file shows the same no-history rule at a major project.
- **Testing:** the one testing gotcha that isn't in config. This harness must never spend tokens or touch credentials in tests, matching Pi's own AGENTS.md.
- **Git:** explicit staging and a destructive-command list, adopted from Pi's AGENTS.md because parallel agents share this worktree. Main is protected without the user.

## 4. Matching `COMMENT_RULES_TEXT` in `.pi/extensions/harness/comment-rules.ts`

This is the text injected into other projects. It is 6 lines and about 404 chars of rules (about 115 tokens rendered, down from 198). It is the AGENTS.md block minus the vendored bullet, so the verbatim test still holds.

```ts
export const COMMENT_RULES_TEXT = [
	"## Code comments",
	"- Default to none. Comment only a non-obvious WHY (constraint, invariant, workaround, surprise), in 1-2 lines.",
	"- Never narrate code or restate a signature.",
	'- No history: no phase, plan, ticket or review IDs, "previously", "fixed", "used by X". Git holds that.',
	"- Cite an external fact as one line: file:line or URL.",
	"- JSDoc only on exported API, one sentence. Update or delete a comment when its code changes.",
].join("\n");
```

**Merged or dropped from the current 8 bullets:**
- "Longer explanation belongs in docs/" is implied by "1-2 lines".
- "No caller or task references" is folded into "used by X".
- "A wrong comment is worse than none" is cut as rationale. Its directive is kept.

After the change, lower `COMMENT_RULES_BUDGET` to about 130 with a fresh measurement.

## Sources

- https://agents.md/
- https://learn.chatgpt.com/docs/agent-configuration/agents-md (redirected from developers.openai.com/codex/guides/agents-md)
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/memory
- https://geminicli.com/docs/cli/gemini-md/
- https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/ (seen through search excerpts only: MEDIUM)
- https://arxiv.org/abs/2602.11988 (Gloaguen et al., Evaluating AGENTS.md)
- https://arxiv.org/abs/2507.11538 (IFScale)
- Repo files via `gh api repos/<r>/contents/AGENTS.md`: earendil-works/pi, astral-sh/uv, astral-sh/ruff, apache/airflow, vercel/next.js, microsoft/vscode, openai/openai-agents-python, openai/codex (nested `codex-rs/tui/src/bottom_pane/AGENTS.md`), google-gemini/gemini-cli `GEMINI.md`
