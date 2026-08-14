# Provenance — vendored `pi-loop-police`

This directory is a source-form copy of a third-party npm package, not an npm
dependency. It exists because the package fails EXT-10's license-file check
and per `docs/EXTENSIONS.md`, anything without a shipped LICENSE file is
vendored, never depended on.

## Upstream identity

| Field | Value |
|---|---|
| Package | `pi-loop-police` |
| Version | `1.14.1` (exact — matches the live re-verification in `07-01-SUMMARY.md` / `docs/EXTENSIONS.md`, unchanged from context generation) |
| Repository | `git+https://github.com/sebaxzero/pi-loop-police.git` |
| `package.json` `license` field | `"MIT"` |
| LICENSE file in tarball | **absent** — `tar -tf pi-loop-police-1.14.1.tgz \| grep -i licen` returned nothing |
| GitHub API license | `null` — `gh api repos/sebaxzero/pi-loop-police --jq .license` returned `null` (re-confirmed live this session, matching the 07-01 finding) |
| `pushed_at` (GitHub, this session) | `2026-08-11T22:03:23Z` |
| `archived` | `false` |
| Stars | 12 |

**EXT-10 verdict:** the `"license":"MIT"` field is unsupported by any actual
license grant in the repository or the published package. The package is
vendored in source form, reviewed, and MUST NOT be added to
`.pi/settings.json`'s `packages[]` — the two states are mutually exclusive,
enforced by `tests/unit/vendor-license-audit.test.ts`.

## Tarball provenance

Obtained with `npm pack pi-loop-police@1.14.1 --ignore-scripts` (download
only — no lifecycle scripts run, no `npm install`), run from a scratch
directory under this session's temp scratchpad, never inside this repo or
`~/.pi`. `tar -xf` only lists/extracts; it does not execute anything.

- **Tarball filename:** `pi-loop-police-1.14.1.tgz`
- **npm-reported shasum (sha1):** `7b6f19b437b8e1f32aac9c5d3d2aa15aa8c82dd8`
- **npm-reported integrity (sha512, truncated by npm's own notice):** `sha512-gEp4SIAtU7UpS[...]WCcgUB4YDMyrw==`
- **SHA-256 of the tarball (computed with `sha256sum`), the integrity hash this file records for re-derivation:**
  `b906cbb0016f2554b26af6e734e27dca75ffda1c783fb95729a5f2707e336cff`
- **Date/command:** 2026-08-15, `npm pack pi-loop-police@1.14.1 --ignore-scripts` followed by `sha256sum pi-loop-police-1.14.1.tgz` and `tar -tf pi-loop-police-1.14.1.tgz`

Tarball listing (11 entries, matches the plan's `<verified_tarball_layout>` and the 07-01 finding of 110,059 bytes unpacked):

```
package/.gitattributes
package/package.json
package/AGENTS.md
package/CLAUDE.md
package/README.md
package/skills/loop-police-help/SKILL.md
package/skills/loop-police-postmortem/SKILL.md
package/examples/hook.mjs
package/extensions/index.ts
package/examples/listener-extension.ts
package/extensions/loop-police.ts
```

Only `package/extensions/index.ts` and `package/extensions/loop-police.ts`
were copied into this repository. Everything else in the tarball
(`AGENTS.md`, `CLAUDE.md`, `README.md`, the two skills, both `examples/*`
files) was read for context but deliberately NOT vendored — see "What was
not vendored" below.

## Review findings (full read of both vendored files, before any byte was copied)

**Events hooked** (`pi.on(...)` in `extensions/loop-police.ts`):
`agent_start`, `turn_start`, `message_update`, `message_end`, `context`,
`tool_call`.

**What it does on detection:** aborts an in-flight assistant stream
(`ctx.abort()`) when character-level or semantic repetition crosses a
threshold, truncates the repeated tail, and injects a recovery message back
into the agent via `pi.sendMessage(..., { triggerTurn: true })`. On the
`tool_call` hook it can return `{ block: true, reason }` to stop an
identically-repeating tool call from executing, and on the `context` hook it
strips previously-tainted "doom loop" reasoning out of the message history
sent to the model on future turns (`sanitizeTaintedThinking`). All of this is
local, in-memory state (`toolHistory`, `bannedCalls`, `thinkingHistory`,
`fileReadTotals`, etc.), reset on `agent_start`.

**Network calls:** none, by default. There is exactly one optional,
user-configured egress path: `HOOK_CMD` (default `""`, i.e. disabled) is
split on whitespace and run via `pi.exec(command, args, { timeout })` —
fire-and-forget, output/exit code ignored except for a single warning
notification, `HOOK_TIMEOUT_MS` (default 5000ms) bounded, no shell involved
(`splitHookCmd` never invokes a shell interpreter). With `HOOK_CMD` left at
its default this extension makes zero external process calls and zero
network requests. `HOOK_LOG` (also default `""`) is a local JSONL append via
`node:fs`, not a network path.

**Credential / environment reads:** `grep -n "process\.env"` over both
vendored files returned no matches. The extension reads no environment
variable and reads no credential of any kind. It reads and writes exactly one
local file: `loop-police.json`, created next to itself
(`dirname(fileURLToPath(import.meta.url))`) to persist detector-threshold
config across sessions.

**`registerTool` grep:**
```
$ grep -n "registerTool" .pi/extensions/loop-police/index.ts .pi/extensions/loop-police/loop-police.ts
(no matches)
```
Zero model-facing tools. `pi.registerTool` is never called anywhere in
either vendored file. The extension registers exactly one command
(`pi.registerCommand("loop-police", ...)`, sanctioned zero-schema-cost
surface per `CONTRIBUTING.md`'s boundary rule) and one message renderer
(`pi.registerMessageRenderer("loop-police", ...)`, a display-only hook with
no schema either). Per the plan's instruction: research reported zero
model-facing tools and this review confirms it; `PROJECT.md`'s
`tests/unit/contributing-boundary.test.ts` `TOOL_REGISTRATION_ALLOWLIST` is
**left unchanged** — no entry added, because none is owed.

**Model-facing tool count of this vendored extension: 0.** Recorded here for
Phase 10's baseline per this plan's own instruction — every registered tool
costs schema tokens on every provider request
(`openai-completions.ts:1337-1372`), and this extension adds none. Its only
per-turn system-prompt cost is the single `loop-police` command entry
(`src/core/system-prompt.ts` carries no reference to registered commands per
`tests/unit/contributing-boundary.test.ts`'s own citation — a command costs
zero).

## Deviation from a byte-for-byte copy

Two mechanical changes, both forced by this repo's own structural rules, not
by taste — everything else matches the tarball copy byte-for-byte (verified
with `diff` before either fix was applied).

**1. `registerCommand` handler made `async`.** Upstream's
`pi.registerCommand("loop-police", {...})` handler is declared synchronous:
`handler: (args, ctx) => { ... }`. Pi 0.84.1's `registerCommand` handler type
is `(args, ctx) => Promise<void>` — this repo's `npx tsc --noEmit` failed on
the unmodified upstream form (`loop-police.ts:728`, `TS2322`). The handler
body returns no value on any path (bare `return;` only, confirmed by the full
read above), so changing the declaration to `handler: async (args, ctx) => {`
is behaviorally identical — it only satisfies the pinned type. Marked inline
at the call site.

**2. The extension function's `export default` moved from `loop-police.ts`
to `index.ts`.** Upstream's `extensions/loop-police.ts` declares
`export default function (pi: ExtensionAPI) { ... }` directly. This repo's
`tests/unit/extension-layout.test.ts` (BOOT-05) requires that the ONLY file
carrying a top-level `export default` inside a nested-index extension
directory be `index.ts` itself — the path Pi actually auto-discovers
(`.pi/extensions/<dir>/index.ts`); any other file with its own default
export is treated as an ambiguous second entry point and rejected, since Pi
never auto-discovers `.pi/extensions/<dir>/<other-name>.ts` at all. Renamed
the function to the named export `loopPolice` in `loop-police.ts`, and
`index.ts` now does `export { loopPolice as default } from "./loop-police.ts";`
instead of the upstream `export { default } from "./loop-police.ts";`. No
line of the function's body changed — only its own declaration line and the
one-line re-export in `index.ts`. Marked inline at both call sites.

Both fixes were forced, in the sense that the plan's own acceptance criteria
(`npx vitest run tests/unit/extension-layout.test.ts ... && npx tsc --noEmit`
exits 0) fail without them on the unmodified upstream form — recorded as
Deviations in `07-06-SUMMARY.md`.

## Runtime artifact, gitignored

`loop-police.ts` auto-creates `loop-police.json` next to itself
(`dirname(fileURLToPath(import.meta.url))`) the first time it is imported —
even by a test harness that merely loads the module without ever invoking
the extension function, since the config-merge logic runs at module-evaluate
time (`const cfg = (() => { ... })();`, top-level). This is per-machine
runtime state, not source: `.pi/extensions/loop-police/loop-police.json` is
listed in `.gitignore` under "Vendored-extension runtime state" and must
never be committed.

## What was not vendored

The tarball ships two skills — `skills/loop-police-help/SKILL.md` and
`skills/loop-police-postmortem/SKILL.md` — and two example files —
`examples/hook.mjs`, `examples/listener-extension.ts`. None of the four were
copied into this repository:

- The two skills were **deliberately excluded**. A skill's name and
  description are a per-turn system-prompt cost even when the skill is
  never invoked (`docs.md` / `tests/unit/contributing-boundary.test.ts`'s own
  citation of `src/core/skills.ts:350-356`: name + description + location are
  always serialized). Phase 10 — not Phase 7 — owns the context/token
  budget, and this plan's scope is loop detection itself, not its
  documentation surface. A later Phase 10 plan may choose to vendor either
  skill with its own budget justification.
- `examples/hook.mjs` and `examples/listener-extension.ts` are illustrative
  usage samples for `HOOK_CMD` and the `loop-police:detection` event bus
  respectively — neither is imported by `extensions/index.ts` or
  `extensions/loop-police.ts`, and Pi does not auto-discover files under
  `examples/`. Nothing in this repository references them.

## Files copied, and how

- `.pi/extensions/loop-police/index.ts` — copied from `package/extensions/index.ts`, with a vendoring header prepended (naming this file, the exact version, the EXT-10 reason, and pointing here). The original one-line re-export (`export { default } from "./loop-police.ts";`) is otherwise unchanged.
- `.pi/extensions/loop-police/loop-police.ts` — copied byte-for-byte from `package/extensions/loop-police.ts`. No relocation-forced import changes were needed: every import is either a bare package specifier (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) or a Node built-in (`node:fs`, `node:path`, `node:url`) — there are no relative imports to adjust for the move from `extensions/` (upstream tarball root) to `.pi/extensions/loop-police/` (this repo). Verified identical with `diff` against the unpacked tarball copy before commit.

## Placement

Flat, one directory level below `.pi/extensions/` — `.pi/extensions/loop-police/index.ts` —
per decision D-07-D (`docs/EXTENSIONS.md`, "Vendored, not depended on"
section) and `tests/unit/extension-layout.test.ts`'s `NESTED_INDEX` regex
(`^\.pi\/extensions\/[^/]+\/index\.ts$`), which matches only one directory
level. No file was created under `.pi/extensions/vendor/`.
