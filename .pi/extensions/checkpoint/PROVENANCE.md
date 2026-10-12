# PROVENANCE — `.pi/extensions/checkpoint/`

Added by the Phase 7 code-review fix pass (**WR-15**). This directory was
covered by neither `tests/unit/vendor-license-audit.test.ts` nor
`tests/unit/extension-composition.test.ts` — it is not one of EXT-05's eight
named capabilities, and it shipped no `PROVENANCE.md`, so the audit's own
Direction 4 could not see it. Three files of re-authored, security-relevant
code in the tool-execution path, outside every vendoring audit this repo has.

## Upstream

| | |
|---|---|
| Source package | `@earendil-works/pi-coding-agent` |
| Version | `0.84.1` |
| Upstream path | `examples/extensions/git-checkpoint.ts` |
| Package integrity | `sha512-ncAqFrG+iybuPGOhMiZoEHkEzTpJgz3guYD32pD+M7ucc0WeHmauP6wa7qwP8V/KWvsZDVNa5XGsdZ7fkC7w7A==` (this repo's own `package-lock.json`) |

**SHA-256 of the upstream bytes**, computed from the installed `0.84.1`
package on 2026-08-15:

| Upstream file | Bytes | Lines | SHA-256 |
|---|---|---|---|
| `examples/extensions/git-checkpoint.ts` | 1468 | 54 | `cd8741c95ef41d9d267687820ada97f402f962cca8b92200f4a202e4bf68e188` |

## RE-AUTHORED, NOT COPIED — and the distinction matters

Unlike `todo.ts`, `questionnaire.ts` and `plan-mode/`, **no line of the
upstream file survives here.** The 53-line example was read in full and then
replaced, because all three of its behaviours were defects for this project:

| Upstream | Defect | Where it is fixed here |
|---|---|---|
| `git-checkpoint.ts:33-36` — `if (!ctx.hasUI) { return; }` | Does nothing headless | `index.ts` — a registered `/checkpoint-restore` command needs no UI at all, and the fork hook writes an audit row (see WR-16 below) |
| `:22` — `pi.exec("git", ["stash", "create"])` | Never captures untracked files. Its `-u` flag was MEASURED to be accepted and silently ignored | `git.ts#createCheckpoint` — scratch `GIT_INDEX_FILE` + `add -A` + `write-tree` + `commit-tree` |
| `:11,29,49-51` — an in-memory `Map` cleared on `agent_end` | Nothing survives `/reload` or a restart | `store.ts` — durable JSON under `.pi/state/` |

So the hash above is provenance for **what was read and rejected**, not for
bytes that are present. That is the honest framing, and it is why this
directory carries no "unmodified apart from the header" claim.

## Why not an npm package (EXT-07)

Every third-party file-checkpointing candidate surveyed at planning time was
weaker or disqualified, recorded in `docs/EXTENSIONS.md`'s Dropped table:

- `@davideasden/pi-undo` — no `license` field in `package.json`.
- `@pi-plugins/checkpoint` — depends on `effect@4.0.0-beta.*` and
  `@effect/platform-node@4.0.0-beta.*`: a beta functional-programming runtime
  in the tool-execution path on a machine holding live AWS credentials.
  Disqualified by the security posture, not by maturity.
- `pi-rewind` (arpagon) — 4½ months stale against an API shipping every 2-3
  days.
- `@ayulab/pi-rewind` — archived repo, GPL-3.0, belongs to a different fork.

**Must not also be installed:** `@davideasden/pi-undo`,
`@pi-plugins/checkpoint`, `pi-rewind`, `@ayulab/pi-rewind`. Enforced by
`tests/unit/vendor-license-audit.test.ts` Direction 2.

## Post-review state

The Phase 7 code review found this directory carried the phase's worst defect
and its worst test. Both are fixed, and both are recorded here because a
future reader comparing against upstream will find nothing to compare:

- **CR-02** — `restoreCheckpoint` never deleted anything, so a restore
  produced the union of the checkpoint and everything created after it. Now a
  set difference, computed with the same `add -A` mechanism as the capture so
  gitignored paths are in neither tree and can be neither captured nor deleted.
- **CR-04** — the "the shipped wiring reaches restoreCheckpoint" assertion
  could not fail. Bounded, given an in-line mutation guard, and joined by a
  case that drives the real command handler.
- **WR-09..WR-14, WR-16, WR-19** — an unlocked read-modify-write store, an
  unbounded index naming gc-prunable objects, unvalidated reads, the wrong
  checkpoint selected on fork, `ctx.cwd` treated as the repository root, an
  inert headless branch (`ctx.ui.notify` is Pi's `noOpUIContext` `() => { }`
  at `dist/core/extensions/runner.js:92`), and untracked secret-shaped files
  written into `.git/objects`.

## Tests that enforce this record

`tests/integration/git-checkpoint.test.ts` (6 cases against real temp
repositories), `tests/unit/checkpoint-store.test.ts` (17 cases),
`tests/unit/vendor-license-audit.test.ts`, `tests/unit/workflow-budgets.test.ts`.

## Re-checked against Pi 1.1.0 (Phase 08.1)

Date: 2026-10-13. Upstream `examples/extensions/git-checkpoint.ts` at 1.1.0:
SHA-256 `b60c85f797091a1f21ccb2a998027c6229fe995bdd62dbb1cdcc22946768f40b` (recorded 0.84.1: `cd8741c9...e188`) - CHANGED.

Classification: (b) upstream preference, not ported. The upstream change moved its checkpoint trigger from `agent_end` to `agent_settled`. The vendored copy never used `agent_end`; it hooks tool_result, turn_start and session_before_fork, all present in the 1.1.0 event union. No hunk ported. Recorded 0.84.1 hash untouched.
