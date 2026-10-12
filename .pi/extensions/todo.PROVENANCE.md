# PROVENANCE — `.pi/extensions/todo.ts`

Added by the Phase 7 code-review fix pass (**WR-15**): four of five vendored
items were outside `MUST_BE_VENDORED`, and the guard meant to catch exactly
that could not, because it discovered vendored code by scanning for
`PROVENANCE.md` files that these vendorings did not ship.

**Why the filename is `todo.PROVENANCE.md` and not `todo/PROVENANCE.md`.**
This vendoring is a FLAT file, deliberately: decision D-07-D puts vendored
items flat under `.pi/extensions/`, and `tests/unit/extension-layout.test.ts`'s
`NESTED_INDEX` regex matches one directory level only. There is no directory to
put a `PROVENANCE.md` inside, so the record is a sibling with the file's name as
its prefix, and `MUST_BE_VENDORED` carries an explicit `provenancePath` rather
than assuming `<dir>/PROVENANCE.md`.

## Upstream

| | |
|---|---|
| Source package | `@earendil-works/pi-coding-agent` |
| Version | `0.84.1` |
| Upstream path | `examples/extensions/todo.ts` |
| Package integrity | `sha512-ncAqFrG+iybuPGOhMiZoEHkEzTpJgz3guYD32pD+M7ucc0WeHmauP6wa7qwP8V/KWvsZDVNa5XGsdZ7fkC7w7A==` (this repo's own `package-lock.json`) |

**SHA-256 of the upstream bytes**, computed from the installed `0.84.1`
package on 2026-08-15:

| Upstream file | Bytes | Lines | SHA-256 |
|---|---|---|---|
| `examples/extensions/todo.ts` | 8848 | 298 | `e46824d00217e25242c186d41837cc84ca81b23f978500323448502a9a424ee2` |

## Why vendored rather than installed (EXT-06)

The npm alternative is **`@juicesharp/rpiv-todo@2.5.2`**, which depends on
`@juicesharp/rpiv-config@^2.5.2` and `typebox@^1.1.24` — two floating caret
ranges this repo cannot exactly pin, and the second would install a **second
typebox instance** alongside the one Pi bundles, breaking the type/instance
identity `CLAUDE.md` explicitly warns about. Pi's own bundled example covers
the "todo tracking" capability EXT-05 names in full and carries no
dependencies at all.

**Must not also be installed:** `@juicesharp/rpiv-todo`. Enforced by
`tests/unit/vendor-license-audit.test.ts` Direction 2 against
`.pi/settings.json`'s `packages[]`.

## Deviations from a byte-for-byte copy

The vendoring header at the top of `todo.ts` itself. Nothing else — this file
keeps the `/todos` command name; it was `plan-mode/index.ts` that renamed its
own colliding registration to `/plan-todos`, because the general name belongs
to the capability EXT-05 names (plan 07-07's recorded decision).

## Tests that enforce this record

`tests/unit/vendor-license-audit.test.ts`, `tests/unit/extension-composition.test.ts`,
`tests/unit/tool-count-baseline.test.ts` (measured schema cost: 383 bytes / 96
tokens), `tests/unit/extension-layout.test.ts`.

## Re-checked against Pi 1.1.0 (Phase 08.1)

Date: 2026-10-13. Upstream `examples/extensions/todo.ts` at 1.1.0: SHA-256 `e46824d00217e25242c186d41837cc84ca81b23f978500323448502a9a424ee2` - unchanged at 1.1.0. Events used (session_start, session_tree) exist in 1.1.0. No hunk ported.
