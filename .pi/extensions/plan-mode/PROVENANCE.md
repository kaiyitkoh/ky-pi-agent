# PROVENANCE — `.pi/extensions/plan-mode/`

Added by the Phase 7 code-review fix pass (**WR-15**). Plan 07-07 deliberately
shipped this vendoring's record as an inline header in `index.ts` and recorded
the reasoning in `07-07-SUMMARY.md`: `MUST_BE_VENDORED` was scoped to EXT-10
license-driven vendoring, this vendor's reason is EXT-06, and EXT-10's
must-not-also-be-installed invariant looked inapplicable.

The review's finding is that the *consequence* was a registry holding 1 of 5
vendored items, and a Direction 4 "no vendored package silently drops out"
guard that discovered directories by scanning for `PROVENANCE.md` — so it
enumerated exactly one directory, found exactly one row, and passed. It was
structurally incapable of firing for the omission that had actually occurred.
The invariant IS applicable, just aimed differently: the npm alternative this
vendoring exists to avoid must not be installed either.

`index.ts`'s inline header remains the authoritative record of the deviations;
this file is the audit-visible summary and the hashes.

## Upstream

| | |
|---|---|
| Source package | `@earendil-works/pi-coding-agent` |
| Version | `0.84.1` |
| Upstream paths | `examples/extensions/plan-mode/index.ts`, `examples/extensions/plan-mode/utils.ts` |
| Package integrity | `sha512-ncAqFrG+iybuPGOhMiZoEHkEzTpJgz3guYD32pD+M7ucc0WeHmauP6wa7qwP8V/KWvsZDVNa5XGsdZ7fkC7w7A==` (this repo's own `package-lock.json`) |

**Per-file SHA-256 of the upstream bytes**, computed from the installed
`0.84.1` package on 2026-08-15 (`createHash("sha256")` over the raw file):

| Upstream file | Bytes | Lines | SHA-256 |
|---|---|---|---|
| `examples/extensions/plan-mode/index.ts` | 12135 | 391 | `90fae53e2fada97165f7488520bd54f3cbfe5d2c7e4cfd3bd2aa07ee796e61e8` |
| `examples/extensions/plan-mode/utils.ts` | 4129 | 169 | `12ea28d57cc55e68e8d52a2f1d16df8b2e7f2749cd694d41453028002a2bdad9` |

These are the bytes that were reviewed. A future Pi bump re-computes them
against the new tarball; a changed hash means the upstream file moved and the
deviations below have to be re-applied deliberately rather than assumed.

## Why vendored rather than installed (EXT-06)

The npm alternative is **`@narumitw/pi-plan-mode@0.49.3`**, which depends on
`@narumitw/pi-tui-kit@^0.49.1` — a floating caret range resolved by ordinary
npm semver at `pi install` time, outside any lockfile this repo controls, and
invisible to `isPinnedPackageSpec` (which governs the top-level `packages[]`
entry, not a transitive range). Pi's own bundled example carries no such
dependency: it comes from the same exact-pinned
`@earendil-works/pi-coding-agent@0.84.1` already in this repo's `node_modules`
and `package-lock.json`.

**Must not also be installed:** `@narumitw/pi-plan-mode`. Enforced by
`tests/unit/vendor-license-audit.test.ts` Direction 2 against
`.pi/settings.json`'s `packages[]`. Vendoring a thing and depending on it means
the unreviewed copy runs alongside the reviewed one.

## Deviations from a byte-for-byte copy

Six, itemised in full in `index.ts`'s own header. Summarised:

1. `/todos` renamed to `/plan-todos` — a genuine command-name collision with
   the separately vendored `todo.ts` (plan 07-08).
2. No import-path change needed; the relative `./utils.ts` import survived the
   relocation.
3. The vendoring header itself.
4. **BEHAVIOURAL (CR-03).** The `tool_call` bash gate called
   `utils.ts#isSafeCommand`, two regex lists with the SAFE patterns anchored at
   `^\s*` — the first word decided admissibility. The review defeated it six
   ways, one of them exfiltrating `~/.aws/credentials`. It now calls
   `./read-only.ts#classifyPlanModeCommand`, which decides over the `unbash`
   AST that `.pi/extensions/safety/shell.ts#canonicalise` already produces for
   the Phase 4 bash guard. `utils.ts`'s two regex arrays are deleted rather
   than bypassed. New file: `read-only.ts` (not upstream at all).
5. **BEHAVIOURAL (WR-18).** `NORMAL_MODE_TOOLS` gains `grep`, `find`, `ls` and
   `questionnaire`, and the three pure tool selectors are hoisted out of the
   extension factory and exported so the round-trip property is testable.
   Reachability of the defect is recorded as UNVERIFIED in `index.ts` —
   the review's stated path was traced and does not hold.
6. **DEVIATION 6 (plan 09-03).** `/plan` renamed to `/plan-mode` — a genuine
   command-name collision with Phase 9's ceremonial spec workflow, which
   `.planning/research/FEATURES.md` Part 2 names as owning that exact
   command. Resolved the same way item 1 resolved the `/todos` collision
   (Standing Rule 8): the general name goes to the authored workflow, and
   this vendored example takes the more specific name.
   `pi.registerFlag("plan", ...)` is a structurally separate namespace and is
   unchanged.

Deviations 4 and 5 mean this copy is **no longer diffable against upstream**
in those two regions. That is deliberate: upstream's predicate is wrong for a
repository whose entire safety posture is built on not doing this.

## Tests that enforce this record

- `tests/unit/vendor-license-audit.test.ts` — this file exists, names the
  package, a version and a hash; the alternative is not installed; and
  Direction 4 discovers vendored entry points by their header marker rather
  than by the presence of this file, so a future vendoring cannot drop out.
- `tests/unit/plan-mode-read-only.test.ts` — deviations 4 and 5, both
  falsified against the pre-fix code.
- `tests/unit/extension-composition.test.ts`, `tests/unit/tool-count-baseline.test.ts`.
