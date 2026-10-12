# PROVENANCE — `.pi/extensions/questionnaire.ts`

Added by the Phase 7 code-review fix pass (**WR-15**): four of five vendored
items were outside `MUST_BE_VENDORED`, and the guard meant to catch exactly
that could not, because it discovered vendored code by scanning for
`PROVENANCE.md` files that these vendorings did not ship.

See `todo.PROVENANCE.md` for why a flat vendoring's record is a
`<name>.PROVENANCE.md` sibling rather than a directory member.

## Upstream

| | |
|---|---|
| Source package | `@earendil-works/pi-coding-agent` |
| Version | `0.84.1` |
| Upstream path | `examples/extensions/questionnaire.ts` |
| Package integrity | `sha512-ncAqFrG+iybuPGOhMiZoEHkEzTpJgz3guYD32pD+M7ucc0WeHmauP6wa7qwP8V/KWvsZDVNa5XGsdZ7fkC7w7A==` (this repo's own `package-lock.json`) |

**SHA-256 of the upstream bytes**, computed from the installed `0.84.1`
package on 2026-08-15:

| Upstream file | Bytes | Lines | SHA-256 |
|---|---|---|---|
| `examples/extensions/questionnaire.ts` | 13565 | 449 | `3f1f719d81152ff013f5d36a97cc3976388d43f2d89bff0f19827d3443d903e6` |

## Why vendored rather than installed (EXT-06)

The npm alternative is **`@juicesharp/rpiv-ask-user-question@2.5.2`**, which
carries the identical defect to its sibling `rpiv-todo`:
`@juicesharp/rpiv-config@^2.5.2` and `typebox@^1.1.24`, two floating caret
ranges, the second installing a second typebox instance alongside Pi's.

**Must not also be installed:** `@juicesharp/rpiv-ask-user-question`. Enforced
by `tests/unit/vendor-license-audit.test.ts` Direction 2.

## Why `questionnaire.ts` and not its sibling `question.ts`

Pi 0.84.1 ships both. `questionnaire.ts` is a strict superset: a single
question renders identically with `isMulti=false`, and the multi-question form
adds tab-bar navigation over the same rendering. One vendored file therefore
covers both shapes EXT-05 names, instead of two (plan 07-08's recorded
decision).

## Deviations from a byte-for-byte copy

The vendoring header at the top of `questionnaire.ts` itself. Nothing else.

## Tests that enforce this record

`tests/unit/vendor-license-audit.test.ts`, `tests/unit/extension-composition.test.ts`,
`tests/unit/tool-count-baseline.test.ts` (measured schema cost: 1258 bytes /
315 tokens), `tests/unit/extension-layout.test.ts`.

## Re-checked against Pi 1.1.0 (Phase 08.1)

Date: 2026-10-13. Upstream `examples/extensions/questionnaire.ts` at 1.1.0: SHA-256 `3f1f719d81152ff013f5d36a97cc3976388d43f2d89bff0f19827d3443d903e6` - unchanged at 1.1.0. No hunk ported.
