# Contributing

This is a personal harness with one contributor. There is no code of conduct,
no PR template and no triage process — there is nobody to triage. What follows
is the set of rules that are expensive to rediscover, each one written down
because getting it wrong is silent rather than loud.

Every line-numbered citation below was read out of the installed Pi 0.84.1
package (`docs/`, and the original TypeScript recovered from
`dist/**/*.js.map` `sourcesContent`). They are facts, not opinions. Re-verify
them when Pi moves; it ships every 2–3 days.

## Boundary rule

**A new capability defaults to a command or skill.** It becomes a tool only
when you can state why it must be one.

This is economics, not taste. The whole project exists to get trustworthy work
out of a cheap model, and the cheap model pays for context on every turn.

- **A tool costs tokens on every single provider request.** Its `name`,
  `description` and complete JSON Schema are serialised into `tools[]` and sent
  with the request — `convertTools()` maps each active tool to
  `{type:"function", function:{name, description, parameters}}` where
  `parameters` is the TypeBox-generated JSON Schema verbatim
  (`pi-ai/src/api/openai-completions.ts:1337-1372`), and the payload builder
  calls it unconditionally whenever any tool is active
  (`pi-ai/src/api/openai-completions.ts:731`). You pay that schema forever, on
  every turn, whether the model uses the tool or not.
- **A command costs zero.** `pi/src/core/system-prompt.ts` is 163 lines and
  contains no reference to registered commands anywhere; the only occurrence of
  the word is prose in the preamble at `:121`. Commands are read solely by the
  interactive command list. Per-turn cost of a command: nothing.
- **A skill costs roughly 40–60 tokens.** `formatSkillsForPrompt()` emits only
  `<name>`, `<description>` and `<location>` per skill
  (`pi/src/core/skills.ts:350-356`); the body is loaded only when the model
  reads the file (`pi/src/core/skills.ts:344`).

To register a tool, the change must answer three questions in writing:

- **(a) Must the _model_ call this mid-turn, or is the _user_ the initiator?**
  If the user starts it, it is a command. An unanswered (a) is an automatic no.
- **(b) What is the measured token cost of its schema?** Measured, not
  estimated — serialise the schema and count.
- **(c) Why can a skill not carry this as a procedure?** Most "tools" are a
  paragraph of instructions wearing a JSON Schema.

**Corollary.** Lazily-loaded tools omit `promptSnippet` and `promptGuidelines`.
Those bullets are appended flat into the system prompt
(`pi/src/core/system-prompt.ts:108-113`, rendered under `Guidelines:` at
`:128`), so activating such a tool rebuilds the prompt prefix and invalidates
the provider cache. DeepSeek cache reads are roughly 50× cheaper than fresh
input; throwing the prefix away is a real bill.

`tests/unit/contributing-boundary.test.ts` enforces this for Phase 1. A later
phase that genuinely needs a tool extends the allow-list there, in the same
change, with the three answers above.

## Dependency policy

Every third-party dependency is pinned to an exact version, and
`package-lock.json` is committed. No `^`, no `~`, no ranges.

**Do not "fix" the `"*"` in `peerDependencies`.** It looks like the opposite of
the rule above and it is not. `docs/packages.md:171` mandates the `"*"` range
for exactly five host-provided packages — `@earendil-works/pi-ai`,
`@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`,
`@earendil-works/pi-tui`, `typebox` — and mandates not bundling them. At
*runtime* none of them is ours: jiti aliases every one to Pi's own bundled copy
(`pi/src/core/extensions/loader.ts:118-139`), so the version that executes is
the host's whatever we wrote here, and bundling any of them creates a second
module instance that breaks type and instance identity across the extension
boundary.

**They are, however, downloaded.** npm 7+ installs the root project's own
`peerDependencies`, and `npm install --omit=dev` — the exact command Pi runs
inside a clone of this repo (`package-manager.ts:1829`) — adds **101 packages**
to a fresh clone, including four of the five peers (`typebox`,
`@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`,
`@earendil-works/pi-tui`; `pi-coding-agent` is resolved through the
devDependency edge and marked `dev` in the lock), plus `pi-telemetry`, the AWS
SDK, `openai`, `@anthropic-ai/sdk` and `@google/genai`
[VERIFIED: executed 2026-08-13, fresh clone, npm 11.13.0]. Do not repeat the
claim that "peers are never installed by us" — it is false, and it was the
stated reason for tolerating `"*"`.

The correct reason is narrower and it is a lockfile obligation, not a
convenience: **`package-lock.json` is the only thing pinning those `"*"` peers.**
The lock has non-dev entries for all 101 and pins each exactly, so a clone today
gets `0.84.1` and `typebox@1.3.7`. Regenerate the lock without re-pinning and
the `"*"` peers resolve to whatever is latest, on a laptop holding live AWS
credentials. That is why the committed lockfile is a BOOT-08 obligation, and why
`tests/unit/pinning.test.ts` asserts every non-dev `@earendil-works/*` entry in
the lock is `0.84.1`. The exact pin *also* lives in `devDependencies`, which is
what the development machine builds against.

Use unscoped `typebox`. Never `@sinclair/typebox` — that is the legacy scoped
package; Pi aliases it too (`loader.ts:136-138`) but bundles and validates
against the unscoped one.

**Package sources.** Every third-party package source written into
`settings.json` must carry a version or a git ref — `npm:pkg@1.2.3`, or a git
URL ending `@tag`/`@sha`. Refs are pinned; `pi update` will not move them
(`docs/packages.md:90`). This repo's own URL,
`https://github.com/kaiyitkoh/ky-pi-agent`, is the single documented exemption:
BOOT-02 mandates that literal unrefed install command, and reconciling to our
own default branch is the desired behaviour. `tests/unit/pinning.test.ts`
encodes the lint and that one exemption.

Match Pi's own toolchain pins rather than registry latest. TypeScript `5.9.3`
and vitest `4.1.9` are Pi core's own devDependencies; type-only compatibility
with Pi's shipped `.d.ts` is the thing that matters.

## Supply chain

`ignore-scripts=true` is a committed control, not a preference. A postinstall
script runs with full user permissions on a laptop that holds live AWS
credentials.

Three `.npmrc` files carry it, and each covers a different scope:

| File | Covers |
|---|---|
| `<repo>/.npmrc` | the developer's own `npm install`, and the `npm install --omit=dev` Pi runs inside a clone of this repo (`package-manager.ts:1829`) |
| `~/.pi/agent/npm/.npmrc` | `pi install npm:*` at user scope — written by `bin/bootstrap.sh` |
| `<repo>/.pi/npm/.npmrc` | project-scope `pi install -l` (`package-manager.ts:2004`) |

**Third-party git packages remain uncovered.** Their clone directory is created
fresh by `git clone`, so no file can be pre-placed inside it before
`npm install` runs there. For those, use the one-shot ritual:

```sh
npm_config_ignore_scripts=true pi install <url>
```

…or install and then review before use. State the gap rather than pretending
the three files close it.

**Never export `npm_config_ignore_scripts` persistently.** npm ranks
environment config above every `.npmrc`, and Pi hands `process.env` straight to
what it spawns: the `bash` tool spawns with `env: env ?? getShellEnv()`
(`pi/src/core/tools/bash.ts:105`) and `getShellEnv()` returns `{...process.env}`
with only `PATH` adjusted (`pi/src/utils/shell.ts:122-134`); Pi's own npm
invocations use `getEnv()`, which is `process.env` on every non-Linux platform
(`pi/src/core/package-manager.ts:6-9, 2583`). A persistent export would
silently break every legitimate native build attempted from inside a session,
with no error that names the cause. One-shot only.

The same precedence has a second edge: anything that probes npm's configuration
must strip `npm_config_*` from the child environment first, or it measures the
launcher instead of the file under test. `npx` and `npm run` export the whole
resolved config. Both `tests/unit/npmrc-policy.test.ts` and `bin/bootstrap.sh`
sanitise before probing; a new probe must too.

## Repo rules

- **No build step, ever.** jiti loads `.ts` directly
  (`docs/extensions.md:179`), and a `dist/` breaks `/reload` hot-reload, which
  only works for auto-discovered locations (`docs/extensions.md:7`). Ship
  TypeScript and point `pi.extensions` at it.
- **POSIX `sh` only.** No PowerShell, no bashisms. Git Bash is a hard Pi
  prerequisite on Windows anyway (`docs/windows.md:3-7`), and macOS `/bin/sh`
  is bash 3.2 in POSIX mode — `[[`, `sort -V`, `declare -A` and `${v^^}` all
  fail there. `.gitattributes` pins `*.sh` to LF; a CRLF script dies on macOS
  with a misleading "bad interpreter".
- **Never place a `.gitignore` inside `.pi/extensions/`.** The two discovery
  paths disagree: the package path honours ignore rules in the directory it
  scans, the project-local path does not (`loader.ts:652-684`). One such file
  makes dogfooding still work while `pi install` silently loses the harness,
  with no error message anywhere.
- **`.pi/prompts/` discovery is flat, non-recursive.**
  `collectAutoPromptEntries()` does one `readdirSync` and takes top-level `.md`
  files only (`package-manager.ts:456-491`). A prompt in a subdirectory is
  invisible.
- **Extensions live at an auto-discovered path** — `.pi/extensions/<name>.ts`
  or `.pi/extensions/<dir>/index.ts`. Anything else cannot hot-reload.
- **Every control assertion ships with the case that must fail.** A one-sided
  test certifies the launcher, the fixture, or nothing at all. This has caught
  two false-assurance bugs in Phase 1 alone.

## Verifying a change

```sh
npx vitest run tests/unit          # quick
npx vitest run && npx tsc --noEmit # full
```

CI additionally runs `shellcheck --shell=sh` over every tracked `*.sh` on
Ubuntu, and executes `sh bin/bootstrap.sh --check-only` on `windows-latest` and
`macos-latest` with `fail-fast: false`. `shellcheck` is not installed on the
development machine, so POSIX conformance is a CI-only gate — do not assume a
green local run covers it.
