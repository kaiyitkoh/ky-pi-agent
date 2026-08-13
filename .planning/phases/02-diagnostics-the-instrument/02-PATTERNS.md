# Phase 2: Diagnostics — The Instrument - Pattern Map

**Mapped:** 2026-08-13
**Files analyzed:** 29 (24 new, 5 modified)
**Analogs found:** 27 / 29 (2 have no in-repo analog and must follow RESEARCH.md's code examples)

> **Read this before the per-file sections.** Phase 1 left behind a *very* strong
> house style, and three of its own tests will actively fail on the naive Phase 2
> layout. Section **"Blocking interactions with existing tests"** below is not
> advisory — it names three existing green tests that Phase 2 will turn red unless
> the plan modifies them in the same wave that introduces the files.

---

## File Classification

### New source (extension code)

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `.pi/extensions/diagnostics/index.ts` | extension entry / hook registrar + command | event-driven | `.pi/extensions/harness/index.ts` (structure, docstring, `registerCommand`) + `node_modules/@earendil-works/pi-coding-agent/examples/extensions/provider-payload.ts` (`pi.on` hooks) | role-match |
| `.pi/extensions/diagnostics/call-model.ts` | service — THE chokepoint | request-response | **none in repo** — RESEARCH.md §4.6 + "Code Examples"; structural analog `tests/helpers/git.ts` (one-purpose module, one oracle, heavy why-docstring) | none (structural only) |
| `.pi/extensions/diagnostics/wire.ts` | service — capture → redact → append | event-driven → file-I/O | Pi bundled `examples/extensions/provider-payload.ts` (whole file, 15 lines) | partial |
| `.pi/extensions/diagnostics/redact.ts` | utility — pure transform | transform | `tests/helpers/win-quote.ts` (the house "one implementation of one documented hazard, pure, table-tested both ways" module) | partial |
| `.pi/extensions/diagnostics/turns.ts` | service — row composition | transform | **none in repo** — RESEARCH.md §5.5 provenance table is the spec | none |
| `.pi/extensions/diagnostics/prose.ts` | utility (pure predicate) + effect | transform / event-driven | `tests/helpers/win-quote.ts` (pure half) + Pi `examples/extensions/send-user-message.ts` (the `deliverAs` effect half) | partial |
| `.pi/extensions/diagnostics/jsonl.ts` | utility — append-only writer, rotation, prune | file-I/O | Pi `examples/extensions/provider-payload.ts:7` (`appendFileSync` + `CONFIG_DIR_NAME` + `join`) ; `tests/helpers/stub-bin.ts` for the `node:fs` import discipline | partial |
| `.pi/extensions/diagnostics/schema.ts` | model — row types + shared constants | n/a | `.pi/extensions/harness/index.ts:50-66` (exported-constant-instead-of-duplicated-literal) | role-match |

### New docs

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `docs/DIAGNOSTICS.md` | reference doc (JSONL schema + known limits) | n/a | `docs/RUNBOOK.md` (contract-first framing, "closed door — do not re-litigate" honesty sections) | role-match |

### New test helpers (Wave 0 — must land before any DIAG test)

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `tests/helpers/faux.ts` | test helper — provider wrapper + fixture payload builders | transform | `tests/helpers/stub-bin.ts` (typed spec interface + factory + generated-payload discipline) | role-match |
| `tests/helpers/session.ts` | test helper — in-memory `createAgentSession` factory | request-response | `tests/helpers/stub-bin.ts:173-217` (`withStubBin` scope-function + `finally` cleanup) and `tests/helpers/pi.ts` (throw-never-skip) | role-match |
| `tests/helpers/logs.ts` | test helper — temp `.pi/logs/` fixture + torn-safe JSONL reader | file-I/O | `tests/helpers/git.ts` (oracle module) + `tests/helpers/stub-bin.ts:177,215` (mkdtemp/rmSync) | role-match |

### New unit tests

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `tests/unit/chokepoint-lint.test.ts` (DIAG-03) | test — tracked-source grep gate | transform | `tests/unit/contributing-boundary.test.ts` (**exact same gate shape**) | exact |
| `tests/unit/redact.test.ts` (DIAG-07) | test — pure fn, both directions | transform | `tests/unit/helpers.test.ts:117-145` (`quoteForWindows` block) | exact |
| `tests/unit/prose-detector.test.ts` (DIAG-05) | test — pure predicate, positive/negative tables | transform | `tests/unit/pinning.test.ts:259-296` (`PINNED` / `UNPINNED` table loops) | exact |
| `tests/unit/turn-row.test.ts` (DIAG-04) | test — pure composition against fixtures | transform | `tests/unit/docs-policy.test.ts:273-328` (inline fixtures + "the assertion is live" test) | exact |
| `tests/unit/jsonl-rotation.test.ts` (DIAG-08) | test — real fs in a temp dir | file-I/O | `tests/unit/helpers.test.ts:24-28` (module-level `scratch` + `afterAll` rm) | role-match |
| `tests/unit/logs-gitignored.test.ts` (DIAG-07) | test — git ignore oracle | transform | `tests/unit/gitignore-policy.test.ts` (**exact same oracle + both-directions shape**) | exact |
| `tests/unit/wire-nonmutating.test.ts` (DIAG-01) | test — handler return contract | event-driven | `tests/unit/helpers.test.ts` + new `tests/helpers/faux.ts` | partial |

### New integration tests

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `tests/integration/wire-capture.test.ts` (DIAG-01/07) | integration — in-memory Pi session | event-driven | `tests/integration/load-paths.test.ts` (lifecycle/scratch/`beforeAll` shape only — the session mechanics are new) | partial |
| `tests/integration/call-model.test.ts` (DIAG-02) | integration — chokepoint + negative control | request-response | `tests/integration/load-paths.test.ts` case 4 (**the paired negative-control pattern** — copy this exactly) | partial |
| `tests/integration/turns-log.test.ts` (DIAG-04) | integration — session → JSONL on disk | file-I/O | same | partial |
| `tests/integration/prose-retry.test.ts` (DIAG-05) | integration — retry inside one agent run | event-driven | same | partial |
| `tests/integration/budget.test.ts` (DIAG-06) | integration — command context | request-response | same | partial |
| `tests/integration/jsonl-concurrency.test.ts` (DIAG-08) | integration — 4 child processes | file-I/O | `tests/integration/load-paths.test.ts:66-86` (`run()`) + `tests/helpers/stub-bin.ts:133-197` (generated `.mjs` payload written to a temp dir) | role-match |

### Modified files

| Modified file | Why it must change | Analog | Match |
|---------------|--------------------|--------|-------|
| `docs/RUNBOOK.md` | append the **Phase 2** section with RB-02-01/02/03 | its own `### RB-01-01` entry — copy the five-part shape verbatim | exact |
| `tests/unit/docs-policy.test.ts` | `ID_RE` matches only `RB-01-\d{2}`; RB-02 statuses would be unguarded | itself | exact |
| `tests/unit/extension-layout.test.ts` | **will fail** on `diagnostics/*.ts` sibling modules — see blockers | itself | exact |
| `tests/unit/helpers.test.ts` | house precedent: new `tests/helpers/*` get self-tests | itself | exact |
| `tests/unit/gitignore-policy.test.ts` | *optional* — extend `MUST_BE_IGNORED` with the real rotated names (`.pi/logs/wire-2026-08-13.1.jsonl`) | itself | exact |

---

## Blocking interactions with existing tests

These are the concrete, verified ways Phase 2 breaks Phase 1's green suite. Each
needs a task in the plan, not a discovery during execution.

### B1. `tests/unit/extension-layout.test.ts` fails on every sibling module under `diagnostics/`

The BOOT-05 hot-reload precondition test enumerates **all** tracked `.ts` under
`.pi/extensions/` and requires each to match one of two shapes:

`tests/unit/extension-layout.test.ts:36-41,79-101`
```typescript
const EXT_DIR = ".pi/extensions";

/** `.pi/extensions/<name>.ts` — flat form. */
const FLAT = /^\.pi\/extensions\/[^/]+\.ts$/;
/** `.pi/extensions/<dir>/index.ts` — nested-index form. */
const NESTED_INDEX = /^\.pi\/extensions\/[^/]+\/index\.ts$/;

// ...
const sources = trackedFiles(EXT_DIR).filter((p) => p.endsWith(".ts")).sort();

it("has every tracked source at an auto-discovered path", () => {
    const offenders = sources.filter((p) => !FLAT.test(p) && !NESTED_INDEX.test(p));
    expect(
        offenders,
        "these paths are not auto-discovered, so `/reload` cannot hot-reload them; " +
            "move each to `.pi/extensions/<name>.ts` or `.pi/extensions/<dir>/index.ts`, " +
            "or make it a non-entry-point imported by one",
    ).toEqual([]);
});
```

`.pi/extensions/diagnostics/call-model.ts` matches neither regex, so it lands in
`offenders` and the test goes red — even though the file's own failure message
explicitly *sanctions* "a non-entry-point imported by one". The docstring's intent
and the regex disagree; only `index.ts` was ever tested.

**Fix the planner must schedule (same wave as the first diagnostics module):**
distinguish entry points from imported modules. The cheapest honest discriminator
that keeps the vacuous-pass guard intact is "a file with a default export is an
entry point and must sit at an auto-discovered path; a file with none is a
module". Keep the existing non-empty guard at `:85-91` and add a second guard
asserting at least one entry point was found. Do **not** just widen the regex to
`[^/]+\/.*\.ts` — that deletes the requirement.

### B2. `tests/unit/docs-policy.test.ts` does not see RB-02 entries

`tests/unit/docs-policy.test.ts:37-40`
```typescript
/** The Phase 1 entries this file governs. */
const PHASE_ONE_IDS = ["RB-01-01", "RB-01-02", "RB-01-03"] as const;

/** Matches any Phase 1 runbook entry id. */
const ID_RE = /RB-01-\d{2}/g;
```

Appending RB-02-01/02/03 to the runbook without touching this file leaves the new
statuses **unguarded** — the exact thing CONTEXT.md says must never happen ("Never
plan them as passing"). Generalise `ID_RE` to `/RB-\d{2}-\d{2}/g`, add
`PHASE_TWO_IDS`, add rows to `ENTRY_COMMANDS` (`:194-198`), and add a Group C loop
for Phase 2. The parser (`phaseOneEntryStatuses`, `:60-114`) needs no change — it
already reads both the table row and the `**Status:**` line and reports
`INCONSISTENT` on a half-flip.

**Ordering constraint, also from this file** (`:238-254`): every
`tests/**/*.test.ts` path named anywhere in the runbook must exist on disk. So the
RB-02 entries can only be written **after** their named offline-proxy tests exist.

### B3. `tests/unit/contributing-boundary.test.ts` bans the substring `registerTool`

`tests/unit/contributing-boundary.test.ts:62-68,122-135` matches `"registerTool"`
as a **plain substring** across every tracked `.ts`/`.js` under `.pi/extensions/`,
comments included. No diagnostics file may spell it, even in prose. The harness
writes "the tool-registration call" instead (`.pi/extensions/harness/index.ts:36`)
— copy that dodge.

The same file's positive half (`:137-146`) requires at least one extension to call
`registerCommand`. `/budget` satisfies it; today only `harness/index.ts` does.

### B4. DIAG-03's own grep will bite the diagnostics files it does not exempt

Per RESEARCH.md §9.3 the new gate scans `.pi/extensions/**/*.ts` for
`modelRegistry.complete` and exempts **only** `.pi/extensions/diagnostics/`. But
Phase 1's lesson (B3) is that a substring grep also matches prose. If the plan
narrows the exemption to `call-model.ts` alone, then `wire.ts`, `index.ts` and
`docs`-style comments in `schema.ts` must not name the call. Prefer the
directory-level exemption RESEARCH recommends, and put the naming discipline in
the test's own header the way `contributing-boundary.test.ts:62-67` does.

### B5. Committed fixtures must not end in `.jsonl`

`.gitignore:30` is a blanket `*.jsonl`. A `tests/fixtures/*.jsonl` is silently
untracked and CI runs against a file that is not there. `.gitignore:77-82` also
already ignores `.pi/logs/`, so DIAG-07's deliverable is the *test*, not a new
rule. Keep fixtures inline in the test file, or name them `*.jsonl.txt`.

---

## Pattern Assignments

### `.pi/extensions/diagnostics/index.ts` (extension entry, event-driven)

**Analog A:** `.pi/extensions/harness/index.ts` — the only existing extension.
**Analog B:** `node_modules/@earendil-works/pi-coding-agent/examples/extensions/provider-payload.ts` — the only `pi.on("before_provider_request", …)` reference implementation.

**Module docstring pattern** (`harness/index.ts:1-47`) — every source file in this
repo opens with a long *why* docstring carrying PURPOSE / LIFETIME / BOUNDARY RULE
/ LAYOUT headings and inline `[VERIFIED: …]` / `[CITED: …]` citations:
```typescript
/**
 * ky-pi-agent — Phase 1 load-path sentinel.
 *
 * PURPOSE. This extension exists to be *observable*, and for nothing else. It
 * ...
 *   [VERIFIED: pi 0.84.1 docs/extensions.md:1709 — registerProvider calls made
 *    during the factory are queued and flushed once the runner binds its
 *    context, which is what makes them visible to --list-models.]
 *
 * BOUNDARY RULE (BOOT-10), dogfooded on the first commit of real code. This
 * file registers a COMMAND and a PROVIDER. It must NEVER register a tool.
 * ...
 */
```

**Imports pattern** (`harness/index.ts:48`) — type-only import, `verbatimModuleSyntax`
is on in `tsconfig.json` so `import type` is mandatory for types:
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
```

**Exported-constant pattern** (`harness/index.ts:50-59`) — never duplicate a
literal a test will grep for:
```typescript
/**
 * The sentinel string every load-path assertion greps for.
 *
 * Exported so tests import it instead of duplicating a literal — a duplicated
 * literal is how an assertion silently stops matching the thing it checks.
 */
export const SELFTEST_MODEL_ID = "ky-harness-selftest";
```
Apply this to `MAX_PROSE_RETRIES`, the rotation thresholds, the secret-pattern
list and the log base names — put them in `schema.ts` and import them in both the
extension and the tests.

**Default-export + command registration** (`harness/index.ts:68-75`):
```typescript
export default function (pi: ExtensionAPI): void {
	// A command, not a tool. Zero per-turn tokens. See BOUNDARY RULE above.
	pi.registerCommand("ky-hello", {
		description: "ky-pi-agent liveness check",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`ky-pi-agent loaded (sentinel: ${SELFTEST_MODEL_ID})`, "info");
		},
	});
```

**Hook registration + `appendFileSync` + `CONFIG_DIR_NAME`** — Pi bundled example,
whole file (`node_modules/@earendil-works/pi-coding-agent/examples/extensions/provider-payload.ts`):
```typescript
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		const logFile = join(ctx.cwd, CONFIG_DIR_NAME, "provider-payload.log");
		appendFileSync(logFile, `${JSON.stringify(event.payload, null, 2)}\n\n`, "utf8");

		// Optional: replace the payload instead of only logging it.
		// return { ...event.payload, temperature: 0 };
	});

	pi.on("after_provider_response", (event, ctx) => {
		const logFile = join(ctx.cwd, CONFIG_DIR_NAME, "provider-payload.log");
		appendFileSync(logFile, `[${event.status}] ${JSON.stringify(event.headers)}\n\n`, "utf8");
	});
}
```
Note the block-bodied arrow with **no return** — that is the DIAG-01 contract
(RESEARCH §1.2). The deltas Phase 2 adds on top of this 15-line file: redaction,
rotation, per-handler `try/catch`, and the nested path.

**Retry effect** — Pi bundled `examples/extensions/send-user-message.ts:36-53`
shows the `isIdle()` / `deliverAs` branch; inside `message_end` the agent is always
streaming, so `deliverAs` is mandatory (RESEARCH §6.3).

---

### `.pi/extensions/diagnostics/call-model.ts` (service, request-response)

**Analog:** none in this repo. Use RESEARCH.md "Code Examples" → "Nested call
through the chokepoint, with all three captures" verbatim as the starting point,
and RESEARCH §4.6 for the exported signature (a cross-phase contract Phases 5 and
8 import).

**Structural analog for the file's *shape*:** `tests/helpers/git.ts:1-37`. That is
the house model for a single-purpose module whose docstring is longer than its
code and states the rule, the two verified traps, and the scope caveat:
```typescript
/**
 * Git ignore/tracking oracle.
 *
 * Rule: never parse `.gitignore`. Git is the only correct authority on ignore
 * precedence, negation, nested ignore files, `.git/info/exclude` and
 * `core.excludesFile`. Ask git; do not reimplement it.
 * (RESEARCH.md "Don't Hand-Roll", row 1.)
 *
 * Two verified traps are encoded here:
 * ...
 * Scope caveat, stated rather than overclaimed: `git add -f` bypasses ignore
 * rules entirely. This module proves POLICY -- ...
 */
```
`call-model.ts` needs exactly this treatment for: (a) why the extension hooks are
blind here (RESEARCH §4.4, executed), (b) why `calculateCost` is called
defensively, and (c) the scope caveat naming the bypass routes DIAG-03 cannot
close (RESEARCH §4.5, §9.4).

**Import concentration rule** (RESEARCH "State of the Art"): keep every
`@earendil-works/pi-ai` import inside `call-model.ts` and `schema.ts` only —
pi-ai's root entrypoint has an announced future removal.

---

### `.pi/extensions/diagnostics/redact.ts` and `prose.ts` (utility, transform)

**Analog:** `tests/helpers/win-quote.ts` — the repo's canonical "one pure function
for one documented hazard" module. Its docstring headings are worth copying
literally: *"Why any of this exists"*, *"Why it is one function and not four"*,
*"The rules the escaping implements"*, followed by the CRT rules it implements.

Both new modules must be **pure predicate + separate effect** so the interesting
half is unit-testable with no session (RESEARCH "Recommended module structure").
`win-quote.ts` is pure and its effect lives in `pi.ts`/`stub-bin.ts` — mirror that
split: `prose.ts` exports `isProseToolCall(...)`, and `index.ts` owns the
`sendUserMessage` effect.

**Test-facing consequence:** because these are pure, their tests are pure tables —
see `tests/unit/helpers.test.ts:117-145` and `tests/unit/pinning.test.ts:259-291`
below.

---

### `.pi/extensions/diagnostics/jsonl.ts` (utility, file-I/O)

**Analog:** Pi's `provider-payload.ts` for `appendFileSync` + `CONFIG_DIR_NAME` +
`join` (quoted above), plus this repo's `node:` import discipline.

**`node:fs` import style** (`tests/helpers/stub-bin.ts:49-52`) — always the
`node:` prefix, named imports, `join` from `node:path` never string concat:
```typescript
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
```

**Cleanup-never-masks-a-failure pattern** (`tests/integration/load-paths.test.ts:113-122`)
— the retention prune should swallow its own errors the same way:
```typescript
afterAll(() => {
    for (const dir of scratch) {
        try {
            rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
        } catch {
            // A leftover temp dir is noise, not a failure. Never mask a real
            // assertion result behind a cleanup error.
        }
    }
});
```
`maxRetries: 3` is the Windows convention in this repo — file handles linger.

**Hard constraint from RESEARCH §10.3:** `appendFileSync` only, never
`createWriteStream`. State that in the module docstring the way `git.ts` states
"never parse `.gitignore`".

---

### `.pi/extensions/diagnostics/schema.ts` (model, n/a)

**Analog:** `.pi/extensions/harness/index.ts:50-66` — exported constants with a
docstring explaining *why they are exported*, plus module-private constants for
things tests do not need:
```typescript
/** Provider name under which the sentinel model is registered. */
export const SELFTEST_PROVIDER_ID = "ky-harness";

/**
 * Deliberately dead endpoint. Port 1 is unassignable; nothing listens there and
 * nothing ever should. ...
 */
const DEAD_ENDPOINT = "http://127.0.0.1:1/v1";
```

Everything a test asserts on — the secret-pattern list, `MAX_PROSE_RETRIES`, the
rotation caps, the `outcome` mapping table, the log file base names — belongs
here, exported, so no test duplicates a literal.

---

### `tests/helpers/faux.ts`, `session.ts`, `logs.ts` (test helpers)

**Analog:** `tests/helpers/stub-bin.ts` — the house helper shape.

**Typed-spec + factory + scoped cleanup** (`stub-bin.ts:165-217`):
```typescript
/**
 * Create executable stubs on a temp PATH, run `fn` with the modified env, then
 * delete the temp directory.
 *
 * `fn` must be SYNCHRONOUS. The temp directory is removed in a `finally`, so an
 * async `fn` would still be running when its stubs vanish -- returning a
 * thenable is therefore rejected loudly rather than left to fail at random.
 */
export function withStubBin<T>(
	stubs: Record<string, StubSpec>,
	fn: (env: Record<string, string>) => T,
): T {
	const dir = mkdtempSync(join(tmpdir(), "kypi-stub-"));
	try {
		// ...
		return result;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
```
`tests/helpers/session.ts` is the `async` mirror of this — so it must **not** copy
the sync-only guard; instead it should return a disposer or take an async `fn` and
`await` it inside the `try`.

**Temp-dir naming convention:** every prefix in the repo is `kypi-<purpose>-`
(`kypi-stub-`, `kypi-agentdir-`, `kypi-cwd-`, `kypi-clone-`, `kypi-helpers-`).
Use `kypi-logs-`, `kypi-faux-`, `kypi-session-`.

**Throw, never skip** (`tests/helpers/pi.ts:12-17, 92-107`) — a prerequisite that
is missing must fail loudly with the remedy command:
```typescript
 * - `requirePiOnPath()` THROWS, it never skips. A load-path test that skips
 *   itself when `pi` is missing is a vacuous pass: CI would go green having
 *   verified nothing, which is the exact failure mode BOOT-02/BOOT-05 exist to
 *   prevent. There is deliberately no skip escape hatch anywhere in this file,
 *   and an auditor grepping for one should find nothing.
```
Apply to `tests/helpers/session.ts`: if `createAgentSession` cannot be constructed,
throw with the reason — never `it.skip`.

**Generated-payload pattern for the concurrency test's child processes**
(`stub-bin.ts:133-163`) — build the child script as a joined string array of
source lines, write it as `.mjs` (never `.js` — `.JS` is in PATHEXT on Windows and
Windows Script Host cannot run ESM), and use `writeSync(1, …)` rather than
`console.log` + `process.exit` so a piped stdout is not truncated mid-flush:
```typescript
function payloadSource(name: string, spec: StubSpec): string {
	return [
		"// Generated stub -- see tests/helpers/stub-bin.ts. Lives in a temp dir.",
		'import { appendFileSync, writeSync } from "node:fs";',
		// ...
		"if (stdout) writeSync(1, stdout);",
		"process.exitCode = code;",
		"",
	].join("\n");
}
```

**Helpers get self-tests** (`tests/unit/helpers.test.ts:1-12`) — the precedent is
explicit and applies to all three Wave 0 helpers:
```typescript
/**
 * Self-tests for the phase's test harness.
 *
 * Not in the plan's file list; added because the three helpers in
 * tests/helpers/ are what every later plan in this phase asserts THROUGH, and
 * nothing else exercises `runPi` or `withStubBin` at all. A typecheck proves
 * they compile, not that a stub is reachable on PATH or that the `pi` binary
 * runs ...
 */
```
For `faux.ts` the self-test is the one Pitfall-1 guard that matters: assert
`captured.length > 0` — i.e. that the wrapper actually causes
`before_provider_request` to fire.

---

### `tests/unit/chokepoint-lint.test.ts` (DIAG-03) — the closest analog in the repo

**Analog:** `tests/unit/contributing-boundary.test.ts`. Same gate, same shape,
same four moving parts. Copy it structurally, then swap the token set.

**Header pattern — the rule, the scope, and the vacuous-pass guard, all stated**
(`contributing-boundary.test.ts:1-34`):
```typescript
/**
 * BOOT-10 — the boundary rule is stated, and this phase does not break it.
 *
 * THE RULE. ... A rule written in markdown and asserted nowhere is a rule that
 * gets broken by phase 4.
 *
 * SCOPE, STATED RATHER THAN IMPLIED. This test applies to Phase 1's
 * `.pi/extensions/**` and to nothing else. A later phase that genuinely needs a
 * tool does not delete this file: it extends `TOOL_REGISTRATION_ALLOWLIST`
 * below, in the same change, with the written answers to (a), (b) and (c) ...
 *
 * THE VACUOUS-PASS GUARD. Assertion 2 scans a file set for a forbidden string.
 * On an empty set it would pass while proving nothing — the exact failure shape
 * this phase has already tripped over twice (a `check-ignore` without
 * `--no-index`, and an npm probe reading its launcher's environment). So the set
 * is asserted non-empty first, and assertion 3 requires the positive half of the
 * rule to be genuinely exercised rather than merely permitted.
 */
```

**Imports + tracked-source enumeration** (`:35-88`):
```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, trackedFiles } from "../helpers/git.ts";

const EXT_DIR = ".pi/extensions";

/**
 * Files under `.pi/extensions/` permitted to register a tool.
 *
 * EMPTY BY DESIGN, for the whole of Phase 1. To add an entry you must also add
 * the (a)/(b)/(c) justification from CONTRIBUTING.md next to it, in the same
 * commit. See the SCOPE note in this file's header.
 */
const TOOL_REGISTRATION_ALLOWLIST: readonly string[] = [];

/** Tracked text sources under `.pi/extensions/`, read from the index's view. */
function extensionSources(): { path: string; text: string }[] {
	return trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts") || p.endsWith(".js"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
}
```
Note: `trackedFiles()` (the **index**, not the disk) is deliberate — "what a
consumer receives is what git committed" (`extension-layout.test.ts:81`).

**The three assertions** (`:111-147`) — non-empty guard, the negative, then the
positive half so the negative cannot be satisfied by an empty extension:
```typescript
it("finds at least one tracked extension source (guards against a vacuous pass)", () => {
	expect(
		sources.length,
		`no tracked .ts/.js under ${EXT_DIR}/ — every assertion below scans this set, so an ` +
			"empty one turns the whole gate into a pass that verified nothing",
	).toBeGreaterThanOrEqual(1);
});

it(`registers no tool anywhere under ${EXT_DIR}/`, () => {
	const offenders = sources
		.filter((s) => !TOOL_REGISTRATION_ALLOWLIST.includes(s.path))
		.filter((s) => s.text.includes(TOOL_REGISTRATION))
		.map((s) => s.path);

	expect(offenders, "these files register a tool. Per CONTRIBUTING.md's boundary rule, …").toEqual([]);
});
```

**Delta Phase 2 must add** (RESEARCH §9.3): exempt by **directory**
(`.pi/extensions/diagnostics/`) rather than by allowlist, keep
`CHOKEPOINT_BYPASS_ALLOWLIST: readonly string[] = []`, use the six regexes from
RESEARCH §9.3 instead of one substring, and add the *regex-is-live* fixture —
run the pattern set against an inline offending string so the regexes are proven
to match something. `contributing-boundary.test.ts` gets that for free from a
substring; a regex set does not.

---

### `tests/unit/logs-gitignored.test.ts` (DIAG-07)

**Analog:** `tests/unit/gitignore-policy.test.ts` — same oracle, same
both-directions discipline.

**The oracle — never parse `.gitignore`** (`tests/helpers/git.ts:82-88`):
```typescript
export function isIgnored(path: string): boolean {
	const { status } = run(["check-ignore", "-q", "--no-index", "--", path], repoRoot());
	if (status !== 0 && status !== 1) {
		throw new Error(`git check-ignore returned unexpected exit code ${status} for ${path}`);
	}
	return status === 0;
}
```
Both flags are load-bearing: `-q` because the verbose form exits 0 on a *negation*
match too, and `--no-index` because the index masks ignore rules for tracked paths
— its absence is a silent vacuous pass (`git.ts:9-31`).

**Table + both directions + a magnitude guard** (`gitignore-policy.test.ts:38-51,132-151`):
```typescript
const MUST_BE_IGNORED = [
	// --- Pi project-scope runtime state -----------------------------------
	".pi/sessions/s.jsonl",
	".pi/logs/wire.jsonl",
	".pi/audit.jsonl",
	// ...
] as const;

describe("BOOT-09: credential and runtime-state paths are not committable", () => {
	it("asserts a meaningful number of paths in both directions", () => {
		expect(MUST_BE_IGNORED.length).toBeGreaterThanOrEqual(20);
		expect(MUST_BE_COMMITTABLE.length).toBeGreaterThanOrEqual(17);
	});

	it.each(MUST_BE_IGNORED)("ignores %s", (path) => {
		expect(isIgnored(path), `${path} MUST be ignored but git says it is committable`).toBe(true);
	});
});
```
`isIgnored` evaluates rules against a **string**, so none of these paths need to
exist — but DIAG-07's stated deliverable is stronger: run `isIgnored` over the
paths the writer **actually produced** in a temp run, not a hand-written list.
Combine both: the literal table for policy, plus a loop over
`logs.producedPaths()` for reality.

**Scope caveat to restate** (`gitignore-policy.test.ts:11-14`): `git add -f`
bypasses ignore rules; this proves policy, not omnipotence. That is why redaction
comes first.

---

### `tests/unit/redact.test.ts` (DIAG-07) and `tests/unit/prose-detector.test.ts` (DIAG-05)

**Analog A — pure-function tests with a named hazard** (`tests/unit/helpers.test.ts:107-145`):
```typescript
/**
 * The single Windows quoter, asserted directly.
 *
 * There were four hand-rolled copies of this across the suite and two were
 * wrong ... Inputs are test-controlled today, which is exactly why
 * it needs asserting rather than assuming.
 */
describe("quoteForWindows -- one implementation of the DEP0190 hazard", () => {
	it("leaves plain arguments alone", () => {
		// Readability of the command string in a failure message is worth this.
		expect(quoteForWindows("--offline")).toBe("--offline");
	});

	it("quotes anything holding a space or a shell metacharacter", () => {
		expect(quoteForWindows("C:/some dir")).toBe('"C:/some dir"');
	});
```
The `"leaves plain arguments alone"` case is exactly DIAG-07's **negative control**:
a payload containing no secret must come out byte-identical.

**Analog B — positive/negative tables driving a predicate** (`tests/unit/pinning.test.ts:259-291`):
```typescript
describe("BOOT-08.4 -- package sources carry a ref", () => {
	// Proven against a table so the lint is live today, while
	// `.pi/settings.json` still has no `packages` array. A lint that only runs
	// when data happens to exist is a lint nobody has ever executed.
	const PINNED: string[] = [ /* ... */ ];
	const UNPINNED: string[] = [ /* ... */ ];

	for (const spec of PINNED) {
		it(`treats "${spec}" as pinned`, () => {
			expect(isPinnedPackageSpec(spec)).toBe(true);
		});
	}

	for (const spec of UNPINNED) {
		it(`treats "${spec}" as unpinned`, () => {
			expect(isPinnedPackageSpec(spec)).toBe(false);
		});
	}
});
```
`isProseToolCall` maps onto this one-for-one: a `PROSE` table and a `NOT_PROSE`
table (real `toolCall` present; a mention with no `{`; `stopReason !== "stop"`; an
empty active-tool list). The comment "a lint that only runs when data happens to
exist is a lint nobody has ever executed" is the exact justification for the
1 MB adversarial ReDoS input the Security Domain section requires.

---

### `tests/unit/turn-row.test.ts` (DIAG-04)

**Analog:** `tests/unit/docs-policy.test.ts:273-328` — inline string fixtures for
a pure parser/composer, plus the "the guard below is proven live" test:
```typescript
const FIXTURE_PASSED = [
	"| ID | Check | Status |",
	// ...
].join("\n");

describe("Group C — the parser catches a status flip", () => {
	it("reads OUTSTANDING", () => {
		expect(phaseOneEntryStatuses(FIXTURE_OUTSTANDING)).toEqual({ "RB-01-01": "OUTSTANDING" });
	});

	it("reads PASSED, so the guard below is proven live rather than assumed", () => {
		expect(
			phaseOneEntryStatuses(FIXTURE_PASSED),
			"if the parser could not see PASSED, asserting OUTSTANDING against the real file would be a " +
				"tautology — it would pass no matter what the file said",
		).toEqual({ "RB-01-01": "PASSED" });
	});
```
Directly applicable to the `reasoning`-key rule: one fixture `Usage` with
`reasoning: undefined` (key must be **absent** from the serialised row — assert
with `expect(Object.keys(row)).not.toContain("reasoning")`, not
`toBeUndefined()`), one with `reasoning: 0`, one with `reasoning: 812`. Inline
fixtures also dodge blocker **B5** entirely.

---

### `tests/integration/*.test.ts` (all six)

**Analog:** `tests/integration/load-paths.test.ts` — the only file in the repo that
manages process/temp-dir lifecycle at integration scale.

**Scratch-dir registry + `beforeAll` prerequisite + tolerant `afterAll`** (`:46-122`):
```typescript
const IS_WINDOWS = process.platform === "win32";

/** Temp dirs created by this suite, removed in afterAll. */
const scratch: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
}

describe("BOOT-02 / BOOT-05 — extension load paths", () => {
	beforeAll(() => {
		// Throws rather than bypassing itself: a load-path assertion that quietly
		// removes itself when `pi` is missing is a green CI run that verified
		// nothing ...
		requirePiOnPath();
	});
```

**Child-process invocation with the Windows shell rule** (`:66-86`):
```typescript
function run(
	cmd: string,
	args: string[],
	opts: { cwd?: string; timeoutMs?: number } = {},
): { stdout: string; stderr: string; status: number | null } {
	const [file, spawnArgs] = commandFor(cmd, args, IS_WINDOWS);
	const result = spawnSync(file, spawnArgs, {
		cwd: opts.cwd,
		encoding: "utf-8",
		shell: IS_WINDOWS,
		timeout: opts.timeoutMs ?? 120_000,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`\`${cmd} ${args.join(" ")}\` failed to launch: ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}
```
`tests/integration/jsonl-concurrency.test.ts` spawns plain `node` on a generated
`.mjs`, so `commandFor(process.execPath, [...], IS_WINDOWS)` — `process.execPath`
is an `.exe`, not a `.cmd`, so `shell` could be `false`; keep `encoding`,
`timeout` and `windowsHide` regardless.

**The paired negative control** (`:179-204`) — the single most transferable
pattern in the file, and DIAG-02's negative control is the same shape: assert a
bare `modelRegistry.complete()` produces **no** extension-hook capture, then in
the *same test, same fixture*, assert `callModel()` does:
```typescript
it("case 4 — BOOT-05 control: the same run WITHOUT `-a` must not see the sentinel", () => {
	// One agent dir, two runs. Sharing it is the point: the only difference
	// between the two invocations is the flag, so the difference in outcome can
	// only be the trust gate. A fresh dir guarantees no saved decision exists.
	const env = freshAgentEnv();

	const gated = runPi(["--list-models"], { cwd: repoRoot(), env });
	expect(gated.stdout, "…Seeing the sentinel here would mean every other case in this file passes vacuously.")
		.not.toContain(SELFTEST_MODEL_ID);

	// Paired positive: same directory, same cwd, only `-a` added. Without this,
	// an absent sentinel could equally mean the fresh agent dir broke Pi
	// outright — which would make the control itself a vacuous pass.
	const approved = runPi(["-a", "--list-models"], { cwd: repoRoot(), env });
	expect(approved.stdout, "adding -a and changing nothing else must flip the verdict; if it does not, " +
		"the absence above proves nothing about the trust gate").toContain(SELFTEST_MODEL_ID);
});
```

**Import the sentinel, don't retype it** (`:41`) — the integration tests import the
extension's own exported constant. Phase 2's tests should likewise import from
`.pi/extensions/diagnostics/schema.ts`:
```typescript
import { SELFTEST_MODEL_ID } from "../../.pi/extensions/harness/index.ts";
```

**RESEARCH-specific override:** load the extension under test at **user** scope
(`<agentDir>/extensions/<name>/index.ts`), not project scope — project resources
are gated behind trust which returns `false` headless (RESEARCH §8.4). That is the
same trust gate `load-paths.test.ts` case 4 exists to prove; here it is a hazard
rather than the subject.

---

### `docs/RUNBOOK.md` (modified — append the Phase 2 section)

**Analog:** the file's own `RB-01-01` entry. Copy the structure exactly — the
summary table row **and** the detail subsection must agree or
`docs-policy.test.ts` reports `INCONSISTENT`.

**Section + table** (`docs/RUNBOOK.md:34-44`):
```markdown
## Phase 1 — Bootstrap, Packaging & Supply Chain

| ID | Check | Status |
|----|-------|--------|
| RB-01-01 | SAFE-16 — `gh` left unauthenticated on the work laptop | OUTSTANDING |
| RB-01-02 | BOOT-02 — `pi install` against the real GitHub URL on a clean profile | OUTSTANDING |
| RB-01-03 | BOOT-05 — `/reload` re-registers the extension | OUTSTANDING |

### RB-01-01 — SAFE-16: `gh` left unauthenticated on the work laptop

**Status:** OUTSTANDING

**Why this cannot be done here.** ...

**Procedure, on the work laptop:**

1. `sh scripts/check-gh-unauthenticated.sh`
   ... Expect exit status **1** and the message `...` on stderr.

**Closed door — do not re-litigate.** ...

**Offline proxy:** `tests/unit/gh-unauthenticated.test.ts` — ... It proves the
classifier is correct. It says nothing about the work laptop's state.
```

Every entry carries the four contract items declared at `:8-24`: exact command,
expected output specific enough that "it seemed fine" is not acceptable, offline
proxy, status line. The `**Offline proxy:** … It proves X. It says nothing about
Y.` closing sentence is the honesty pattern — reuse it verbatim in shape for
RB-02-01/02/03, and add a Bedrock-specific "closed door" note for Pitfall 7 (a
SigV4 signature can never appear in a dump, so RB-02-02 must be written around the
DeepSeek/DashScope bearer-token path).

---

### `docs/DIAGNOSTICS.md` (new)

**Analog:** `docs/RUNBOOK.md:1-31` — open with why the file exists and what its
contract is, before any content:
```markdown
# Runbook — checks that cannot be executed on the development machine

This file exists because some things cannot be proven from a desk. ...

**The contract of this file.** Every entry carries four things:
1. the **exact command**, ...

**Ownership.** `docs/RUNBOOK.md` is formally a Phase 3 deliverable (PROV-09),
and later phases append their own sections to it. ...
```
`DIAGNOSTICS.md` needs the same treatment for: the JSONL row contract, the
"absence of `reasoning` means the provider reports no breakdown, not zero" rule,
and a **Known limits** section carrying RESEARCH §4.5 (bypass routes), §9.4
(what the grep cannot catch) and §2.4 (Bedrock credentials never reach the hook).
The runbook's "Closed door — do not re-litigate" heading is the right idiom for
each.

---

## Shared Patterns

### Formatting and language conventions

**Source:** every `.ts` file in the repo. **Apply to:** all new files.

- **Tabs**, not spaces, for indentation in `.ts`. Verified across
  `harness/index.ts`, all four helpers and all fifteen tests.
- `import type { … }` for type-only imports — `tsconfig.json` sets
  `verbatimModuleSyntax: true`.
- Relative imports carry the **`.ts` extension** (`../helpers/git.ts`) —
  `allowImportingTsExtensions: true`, no build step.
- Import order: `node:*` builtins → third-party (`vitest`) → relative helpers.
- Numeric separators for thresholds: `120_000`, `60_000`. Use `32_000_000` etc.
- `as const` on literal tables; `readonly string[]` on allowlists.

### Every assertion carries a "what this protects" message

**Source:** universal — `contributing-boundary.test.ts:128-134`,
`gitignore-policy.test.ts:146-149`, `docs-policy.test.ts:336-342`.
**Apply to:** every `expect()` in every new test.

```typescript
expect(
	offenders,
	"these files register a tool. Per CONTRIBUTING.md's boundary rule, answer (a) must the " +
		"model call this mid-turn, (b) what is the measured schema cost, (c) why can a skill " +
		"not carry it as a procedure — then add the path to TOOL_REGISTRATION_ALLOWLIST with " +
		"those answers beside it",
).toEqual([]);
```
The message tells the *next* person what to do, not what failed. A bare
`expect(x).toEqual([])` is off-pattern here.

### The vacuous-pass guard (mandatory on every scanning assertion)

**Source:** `contributing-boundary.test.ts:27-33,114-120`,
`extension-layout.test.ts:85-91`, `docs-policy.test.ts:22-26,241-245`.
**Apply to:** DIAG-03's grep, DIAG-07's produced-path loop, and every test that
iterates a discovered set.

Three components, all required:
1. assert the scanned set is **non-empty** before asserting anything about it;
2. prove the matcher is **live** against a synthetic positive
   (`docs-policy.test.ts:313-319`, `gitignore-policy.test.ts:250-257`);
3. assert the **positive half** of the rule is genuinely exercised, so the
   negative cannot be satisfied by an empty subject
   (`contributing-boundary.test.ts:137-146`).

Phase 1 tripped this failure class twice — `check-ignore` without `--no-index`,
and an npm probe reading its launcher's env. Both are named in the docstrings.

### Citation tags on every load-bearing claim

**Source:** `harness/index.ts:9-11,31,34-35`,
`contributing-boundary.test.ts:12-18`, `extension-layout.test.ts:13-19`.
**Apply to:** every source and test docstring in Phase 2.

```
[VERIFIED: pi 0.84.1 docs/extensions.md:1709 — registerProvider calls made
 during the factory are queued and flushed once the runner binds its context]
[CITED: docs/extensions.md:115-120]
[VERIFIED: executed 2026-08-13, node 24.16.0]
```
RESEARCH.md supplies a `file:line` for essentially every Phase 2 claim; carry them
into the code. `contributing-boundary.test.ts:101-108` goes further and *asserts*
that a citation string survives in `CONTRIBUTING.md` — worth mirroring for
`docs/DIAGNOSTICS.md`'s Bedrock-reasoning claim.

### Windows-first file and process handling

**Source:** `tests/helpers/win-quote.ts` (whole file), `tests/helpers/pi.ts:20-35`,
`tests/helpers/stub-bin.ts:20-47,113-121`, `load-paths.test.ts:66-86`.
**Apply to:** `jsonl.ts`, `logs.ts`, and `jsonl-concurrency.test.ts`.

- `join()` from `node:path`, never `/` concatenation; `CONFIG_DIR_NAME` from Pi,
  never a hardcoded `.pi`.
- `spawnSync` always with `encoding: "utf-8"`, `windowsHide: true`, an explicit
  `timeout`, and `shell: IS_WINDOWS` **only** when the target is a `.cmd` shim.
  When `shell` is true, fold quoted args into the command string via
  `commandFor(cmd, args, IS_WINDOWS)` and pass `[]` — DEP0190.
- `rmSync(dir, { recursive: true, force: true, maxRetries: 3 })`.
- Windows env keys are case-insensitive; resolve the real `PATH` key
  (`stub-bin.ts:113-121`) rather than reading `process.env.PATH`.
- `.gitattributes` enforces LF; `tests/unit/lf-and-shell.test.ts` guards it.

### Never duplicate a literal a test greps for

**Source:** `harness/index.ts:50-56` + `load-paths.test.ts:41`.
**Apply to:** the whole of `schema.ts`.

The extension exports the constant; the test imports it. A duplicated literal is
how an assertion silently stops matching the thing it checks.

### No new dependencies

**Source:** `tests/unit/pinning.test.ts:253-256`.
**Apply to:** every plan in this phase.

```typescript
it("declares no dev dependency beyond the six audited pins", () => {
	// Anything extra has not been through the Package Legitimacy Audit.
	expect(Object.keys(dev).sort()).toEqual(Object.keys(REQUIRED_DEV_PINS).sort());
});
```
This is the mechanical reason ESLint is off the table for DIAG-03 (RESEARCH §9.2),
and the reason no tokenizer, redaction library, rotation library or lock library
may be added.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.pi/extensions/diagnostics/call-model.ts` | service (chokepoint) | request-response | Nothing in this repo calls the Pi model API. Use RESEARCH.md "Code Examples" → "Nested call through the chokepoint" as the literal starting point, and `tests/helpers/git.ts` for the module *shape* (single oracle, rule-stating docstring, scope caveat). |
| `.pi/extensions/diagnostics/turns.ts` | service (row composition) | transform | No row/record composition exists anywhere in the tree. RESEARCH.md §5.5's field-by-field provenance table **is** the spec; `docs-policy.test.ts`'s two-sources-must-agree parser is the nearest structural relative (compose from `turn_start` + `message_end` + `turn_end`, three sources, one row). |

Partial-match note: the six integration tests share only lifecycle/scratch/
negative-control patterns with `load-paths.test.ts`. The in-memory
`createAgentSession` mechanics are genuinely new to this repo and come from
RESEARCH.md §8.4 (executed skeleton) — including the three corrections there:
there is **no** `InMemoryCredentialStore`; `SettingsManager.inMemory` takes **two**
arguments; and `cwd` must be a temp dir outside this repo or Pi loads the 49 KB
`CLAUDE.md` into every faux request.

---

## Metadata

**Analog search scope:** `.pi/extensions/**`, `tests/helpers/**`, `tests/unit/**`,
`tests/integration/**`, `docs/**`, `package.json`, `tsconfig.json`,
`vitest.config.ts`, `.gitignore`, `CONTRIBUTING.md`, and Pi 0.84.1's bundled
`node_modules/@earendil-works/pi-coding-agent/examples/extensions/`.
**Files scanned:** 83 tracked files enumerated; 14 read in full or in targeted
ranges.
**Pattern extraction date:** 2026-08-13
