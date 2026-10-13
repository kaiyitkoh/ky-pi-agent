# Phase 12: OpenSpec Opt-in Skill - Pattern Map

**Mapped:** 2026-10-13
**Files analyzed:** 17 (6 new source/script/test-helper-adjacent, 6 new tests, 5+ modified)
**Analogs found:** 16 / 17 (one partial: stub that writes files)

Comments in any new code follow root `AGENTS.md`: WHY-only, no phase/requirement IDs, no "added for X". The existing analogs below carry plan IDs in comments (SAFE-07, BOOT-03); do NOT copy those.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/openspec-setup.sh` | script (operator tool) | file-I/O, batch | `scripts/check-gh-unauthenticated.sh` + `bin/bootstrap.sh` (header, arg parsing, `PI_AGENT_DIR` normalisation) | role-match |
| `.pi/extensions/safety/infra.ts` (modify) | classifier (pure) | request-response | itself: `classifyTerraformInvocation` / `classifyKubectlInvocation` | exact |
| `.pi/extensions/harness/index.ts` (modify) | extension factory | event/config | itself (factory body); `.pi/extensions/routing/index.ts` for `process.env` use | exact |
| `tests/helpers/harness-session.ts` (modify) | test helper | file-I/O + session | itself (`opts.agentsMd`, `extraExtensionSource` options) | exact |
| `tests/unit/infra-policy.test.ts` (modify) | test | table-driven | itself | exact |
| `tests/unit/policy-compose.test.ts` (modify) | test | table-driven | itself | exact |
| `tests/unit/gitignore-policy.test.ts` (modify) | test | oracle (`git check-ignore`) | itself | exact |
| `tests/unit/docs-policy.test.ts` (modify) | test | doc pins | itself (`PHASE_TEN_IDS`, `ENTRY_COMMANDS["RB-10-0x"]`) | exact |
| `.gitignore` (modify) | config | n/a | `.pi/work/` block | exact |
| `docs/RUNBOOK.md` (modify) | doc | n/a | `## Phase 10` section (RB-10-01..03) | exact |
| `docs/SAFETY.md` (modify) | doc | n/a | "Mutating infra calls" bullet + "Known bypasses" table | exact |
| `docs/WORKFLOWS.md` (modify) or new `docs/OPENSPEC.md` | doc | n/a | numbered `## N.` sections; `## 11. Status` | role-match |
| `bin/bootstrap.sh` (modify, optional: pointer line only) | script | n/a | `--help` text at the bottom | role-match |
| `tests/unit/openspec-skills.test.ts` (new) | test | transform (Pi `loadSkills`) | `tests/unit/budget-command.test.ts` (real `Skill`, `formatSkillsForPrompt`) | role-match |
| `tests/unit/openspec-env.test.ts` (new) | test | env mutation + restore | `tests/unit/comment-rules-delivery.test.ts` (loads `HARNESS`) + `harness-session.ts` `PINNED_ENV` save/restore | role-match |
| `tests/integration/openspec-setup.test.ts` (new) | test | spawn `sh` against stub | `tests/integration/bootstrap-check-only.test.ts` (`runBootstrap`) + `tests/helpers/stub-bin.ts` | role-match (stub gap) |
| `tests/integration/openspec-zero-cost.test.ts` (new) | test | session capture | `measureFloor`/`withHarnessSession` consumers: `context-floor.test.ts`, `prompt-stability.test.ts` | exact |

## Pattern Assignments

### `.pi/extensions/safety/infra.ts` (classifier, pure)

**Analog:** same file, `classifyTerraformInvocation` (lines 156-220) and `classifyInfraInvocation` (lines 267-281).

**Table + exported sets pattern** (lines 156-182): exported `ReadonlySet<string>` consts with a one-line JSDoc each; tests import them for liveness.
```ts
/** terraform subcommands (or `state`/`workspace` pairs) that require confirmation: irreversible or hard-to-undo state mutations. */
export const TERRAFORM_CONFIRM_SUBCOMMANDS: ReadonlySet<string> = new Set([
	"apply",
	...
	"workspace delete",
]);
```

**Two-word key pattern** (lines 184-196), reuse for `config`/`store`/`workset`:
```ts
const TERRAFORM_TWO_WORD_PARENTS = new Set(["state", "workspace"]);
function terraformSubcommandKey(args: readonly string[]): string | undefined {
	const first = args[0];
	if (first === undefined) return undefined;
	if (TERRAFORM_TWO_WORD_PARENTS.has(first) && args[1] !== undefined) return `${first} ${args[1]}`;
	return first;
}
```
Keys then look like `config get`, `config set`, `store list`, `workset open`. Put `init`, `update`, `completion`, `feedback` as single-word confirm keys; `config set|unset|reset|edit|profile`, `store setup|register|unregister|remove`, `workset create|open|remove` as two-word confirm keys; `archive` as a single-word allow key.

**Classifier shape** (lines 198-220): no-subcommand -> confirm with fail-closed reason; confirm-set hit -> confirm with WHY reason; allow-set hit -> `{ kind: "allow" }`; unknown -> confirm with "add a table row rather than widening a default".
```ts
function classifyTerraformInvocation(args: readonly string[]): InfraVerdict {
	const key = terraformSubcommandKey(args);
	if (key === undefined) {
		return { kind: "confirm", reason: "\"terraform\" with no subcommand -- fail closed to confirmation" };
	}
	if (TERRAFORM_CONFIRM_SUBCOMMANDS.has(key)) {
		return { kind: "confirm", reason: `"terraform ${key}" mutates state or a live resource and cannot be trivially undone` };
	}
	if (TERRAFORM_ALLOW_SUBCOMMANDS.has(key)) return { kind: "allow" };
	return { kind: "confirm", reason: `"terraform ${key}" is an unclassified subcommand -- defaults to confirm (fail-safe, not a hard block: add a table row rather than widening a default)` };
}
```
Note flags: `--help`, `-h`, `--version`, `-V` are `args[0]` so they go into the single-word allow set as-is. A leading global flag other than those would fall to "unclassified -> confirm", which is acceptable.

**Dispatch** (lines 267-281): add one arm; `normaliseExecutable` already strips `.cmd`/`.exe`.
```ts
if (executable === "kubectl") {
	return classifyKubectlInvocation(invocation.args);
}
return { kind: "not-applicable" };
```
Also update the file header ("terraform / aws / kubectl ...") and the `not-applicable` JSDoc (line 267) so they name openspec. Header invariants list is the place for the one-line WHY for `archive` ("writes only inside openspec/; named allow so a future path-write rule cannot silently regress it"). `policy.ts:155` already routes any `InfraVerdict` through `fromInfraVerdict` (line 92), so no `policy.ts` edit. Keep the file free of the tool-registration call spelling (header lines 22-24; `contributing-boundary.test.ts` substring match).

**Do NOT touch `paths.ts`** (RESEARCH section 4).

---

### `.pi/extensions/harness/index.ts` (modify: env defaults)

**Analog:** same file lines 21-60 (factory body), `process.env` usage precedent in `.pi/extensions/routing/index.ts:310` and `safety/index.ts:52`.

Add force-assignments at the top of the factory (before `pi.on`), not default-if-unset:
```ts
export default function (pi: ExtensionAPI): void {
	// A child `openspec` inherits these; force-assign because an inherited OPENSPEC_TELEMETRY=1 would re-enable reporting.
	process.env.OPENSPEC_TELEMETRY = "0";
	process.env.DO_NOT_TRACK = "1";
	process.env.OPENSPEC_NO_UPDATE_CHECK = "1";
	process.env.OPENSPEC_NO_AUTO_CONFIG = "1";
	pi.on("before_agent_start", ...
```
Constraints visible in the file: header (lines 1-8) says it "Registers commands and a provider, never a tool"; keep that true and extend the header by one line if env assignment is added (a wrong header is worse than none). No `systemPrompt:` substring anywhere in the file (`comment-rules-delivery.test.ts:177` asserts it). Do not add a new `.pi/extensions/<name>/index.ts` (picked up by `listEntryPoints()`, disturbs floor/tool-count tests).

---

### `scripts/openspec-setup.sh` (script, file-I/O)

**Analog A (header, arg guard, exit codes):** `scripts/check-gh-unauthenticated.sh` lines 1, 44-68.
```sh
#!/bin/sh
set -e

if [ "$#" -gt 1 ]; then
	printf 'FATAL: this script takes at most one argument; got %s: %s\n' "$#" "$*" >&2
	printf 'Usage: sh scripts/check-gh-unauthenticated.sh [--warn-only]\n' >&2
	exit 2
fi
case "${1:-}" in
"") ;;
--warn-only) warn_only=1 ;;
*)
	printf 'FATAL: unknown argument: %s\n' "$1" >&2
	exit 2
	;;
esac
if ! command -v gh >/dev/null 2>&1; then ... fi
```
Tabs for indentation, `printf` not `echo -e`, `command -v` for presence checks, exit 2 for usage errors.

**Analog B (agent-dir resolution and Windows path normalisation):** `bin/bootstrap.sh` lines 53-81. Copy verbatim so the script and tests share the `PI_CODING_AGENT_DIR` seam:
```sh
set -eu
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
case "$PI_AGENT_DIR" in
[A-Za-z]:* | '\\'*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
*'\'*)
	case "$PI_AGENT_DIR" in
	*/*) : ;;
	*) PI_AGENT_DIR=$(printf '%s' "$PI_AGENT_DIR" | tr '\\' '/') ;;
	esac
	;;
esac
```
Header documents test seams the same way (`# Test seams: PI_CODING_AGENT_DIR ...`).

**Analog C (npm env hygiene):** `bin/bootstrap.sh` `sanitise_npm_env` (line 132) and `assert_ignore_scripts_for` (line 294) if the script runs the `npm install -g --ignore-scripts` itself. Planner decision: keep `--install-cli` as a separate mode that only prints/runs the pinned command; default mode only generates and copies.

**Script-specific rules from RESEARCH (no existing analog; follow RESEARCH 1.2, 1.3, 1.7, 1.8, Architecture "Frontmatter patch"):**
- Single pin constant `OPENSPEC_VERSION="1.13.2"` validated against `^[0-9]+\.[0-9]+\.[0-9]+$` (shell `case`/`expr`, no bashisms).
- `mktemp -d` project dir plus isolated `XDG_CONFIG_HOME` (use `cygpath -m` when present); write the `config.json` from RESEARCH Code Examples; export the four env vars; `openspec init --tools pi --profile custom "$TMP"`.
- awk state-flag patch inserting `disable-model-invocation: true` (boolean, unquoted) after `name:` in the first frontmatter block only; rewrite via temp file + `mv`; LF only.
- Remove the 12 known `openspec-*` dirs before copy; report other `openspec-*` dirs not created by it.
- Must pass `tests/unit/lf-and-shell.test.ts` automatically (CR-free, `#!/bin/sh`, no `[[`, `declare -A`, `sort -V`, `${v^^}`, parses under `dash -n`). Avoid `local`, `echo -e`, arrays, `$'...'`.

---

### `tests/unit/infra-policy.test.ts` (modify)

**Analog:** itself.

**Imports to extend** (lines 22-31): add `OPENSPEC_ALLOW_SUBCOMMANDS`, `OPENSPEC_CONFIRM_SUBCOMMANDS` to the named import from `../../.pi/extensions/safety/infra.ts`.

**Row shape** (lines 40-44, 50-54): `{ command, expected, why }`, `why` states the reason, named-ALLOW rows cite the rationale:
```ts
{ command: "terraform plan", expected: "allow", why: "Pitfall 4 sibling: a local plan must not gate" },
```
Add rows: `openspec list|view|show|validate|status|instructions|--help|--version` -> allow; `openspec archive add-foo -y` -> allow with why "writes only inside openspec/ (named row so a path rule cannot regress it)"; `openspec init --tools pi`, `update`, `completion install`, `feedback`, `config set telemetry.enabled false`, `workset open x`, `store setup` -> confirm; bare `openspec` -> confirm; `openspec frobnicate` -> confirm. The `inv()` helper (lines 35-38) splits on whitespace, fine for these.

**Floor to bump** (line 183): `toBeGreaterThanOrEqual(45)` raise by the number of rows added (guard on the table, not a budget).

**Liveness pattern** (lines 220-257): copy the `terraformUsed` derivation (lines 221-226) for openspec using a two-word-parent set, then add two `it(...)` blocks identical to lines 231-239 for the new sets, and extend the "all tables non-empty" test (lines 251-256). Without this a dead set entry is invisible.

---

### `tests/unit/policy-compose.test.ts` (modify)

**Analog:** itself, `ROWS` (lines 46-...) and the table runner (lines 274-286).

**Row shape** (lines 36-44, 65-72):
```ts
{
	name: "terraform apply -- confirm",
	toolName: "bash",
	input: { command: "terraform apply" },
	expected: "confirm",
	reasonIncludes: "cannot be trivially undone",
},
```
Add: `openspec archive add-foo -y` allow; `openspec init --tools pi` confirm with `reasonIncludes` matching the new reason text; `mv openspec/changes/x openspec/changes/archive/x` allow; `mkdir -p openspec/changes/archive` allow; `env OPENSPEC_TELEMETRY=0 openspec update` confirm (wrapper resolution); `openspec list && openspec init` strongest-wins confirm (copy line 133 pattern). Raise the `>= 24` floor (line 270) by rows added. Negative control (house rule): the infra-policy table rows already turn red if the arm is deleted; add one explicit assertion here that at least one confirm row names openspec so deleting the arm cannot leave this file green.

---

### `tests/unit/gitignore-policy.test.ts` (modify)

**Analog:** itself, `MUST_BE_IGNORED` (lines 38-76), `MUST_BE_COMMITTABLE` (lines 83-113), counts test (lines 136-139), `trackedFiles` use (lines 173, 196).

Add to `MUST_BE_IGNORED` under a comment line like `// --- OpenSpec scaffold from an accidental init ---`: `openspec/config.yaml`, `openspec/changes/x/proposal.md`, `openspec/specs/y/spec.md`, `openspec/changes/archive/z/tasks.md`. Add to `MUST_BE_COMMITTABLE`: `docs/openspec-notes.md` (proves rooted `/openspec/`, not a name-wide swallow) and `scripts/openspec-setup.sh`. Raise the `>= 20` / `>= 17` floors accordingly.

New describe, copying the `trackedFiles` idiom (line 173):
```ts
it("tracks nothing under openspec/", () => {
	// `git add -f` bypasses ignore rules, so the ignore oracle alone cannot prove this.
	expect(trackedFiles("openspec")).toEqual([]);
});
```
Oracle is `isIgnored` from `../helpers/git.ts` (never parse `.gitignore`).

---

### `.gitignore` (modify)

**Analog:** the `.pi/work/` block (end of file region, banner comment with WHY then the pattern):
```
# ---------------------------------------------------------------------------
# Ceremonial-workflow scratch artifacts (never committed -- public repo)
# ... WHY paragraph ...
# ---------------------------------------------------------------------------
.pi/work/
```
Add a new block of the same shape with a rooted `/openspec/` (rooted pattern style as in `!/.npmrc`). Place it BEFORE the "Supply-chain control files" block or after `.pi/work/`; it does not conflict with the final-match-wins negations.

---

### `tests/helpers/harness-session.ts` (modify: `agentSkills` option)

**Analog:** itself. Options interface (lines 48-69), `agentDir` temp dir (line 139), extra-extension write idiom (lines 167-171), `createAgentSession` call (line 193).

Add to `HarnessSessionOptions` (doc comment style: one line, default stated):
```ts
/** User-level skills written to `<agentDir>/skills/<name>/SKILL.md` before the session loads. Default: none. */
agentSkills?: Record<string, string>;
```
Write block immediately before `createAgentSession` (after line 171), mirroring the extension write:
```ts
for (const [name, body] of Object.entries(opts.agentSkills ?? {})) {
	const dir = join(agentDir, "skills", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), body, "utf-8");
}
```
Cleanup is already covered by `removeQuietly(agentDir)`. Existing callers pass no option, so the floor tests (`context-floor`, `prompt-stability`, `budget`, `tool-profiles`) are unaffected. `measureFloor` passes `skills: []` to `computeBudget` (line 286), so the system-prompt comparison, not the budget slice, is what the zero-cost test must assert.

---

### `tests/unit/docs-policy.test.ts` (modify)

**Analog:** itself, Phase 10 registration.

- Constant (line 172): `const PHASE_TEN_IDS = ["RB-10-01", "RB-10-02", "RB-10-03"] as const;` -> add `const PHASE_TWELVE_IDS = ["RB-12-01", ...] as const;`.
- `ALL_IDS` (lines 175-186): append `...PHASE_TWELVE_IDS`. There is no Phase 11 constant; follow the Phase 6 precedent comment (lines 120-123) if a note is wanted.
- `ENTRY_COMMANDS` (line 349): add one row per id, strings must occur verbatim in RUNBOOK. Pattern from lines 520-545:
```ts
"RB-10-02": [
	'echo "RB-10-02 turn-2 cacheRead ratio: <ratio>, after /plan toggle: <ratio>, $(date -u +%FT%TZ)" >> RB-10-02-RESULT.md',
],
```
- Proxy path rule (`PROXY_PATH_RE`, line 552): every `tests/...test.ts` named in the runbook must exist on disk, so the new test files must exist before the RUNBOOK mentions them.
- Occurs-exactly-once pin (lines 589-596) is Phase-9-only; do not copy it unless wanted.
- Optional: a small `describe` pinning the `openspec-pi` rejection and upgrade/uninstall strings in the docs (RESEARCH Validation map), modelled on the string-pin style in this file.

---

### `docs/RUNBOOK.md` (modify)

**Analog:** `## Phase 10 — Context Budget & Progressive Disclosure` (line 1604 onward).

Structure to copy exactly:
```
## Phase 12 — OpenSpec Opt-in Skill

<one-paragraph summary, cites docs rather than repeating>

| ID | Check | Status |
|----|-------|--------|
| RB-12-01 | ... | OUTSTANDING |

### RB-12-01 — <title>

**Status:** OUTSTANDING

**Why this cannot be done here.** ...
**Precondition.** ...
**Procedure, on the work laptop.**
1. ...
5. Record the result: `echo "RB-12-01 ... $(date -u +%FT%TZ)" >> RB-12-01-RESULT.md`
**Expected output.** ...
**Offline proxy:** `tests/integration/openspec-setup.test.ts` proves ...
```
Table row, Status, and recorded-line formats are what `runbookEntryStatuses` parses. Include in RB-12-01 the pin, integrity string, the exact `npm install -g --ignore-scripts @fission-ai/openspec@1.13.2` line, date, and uninstall; flip Status only with real output in hand.

---

### `docs/SAFETY.md` (modify)

**Analog:** "Mutating infra calls" bullet (lines 107-113, bullet style in "What the guard does catch") and the "Known bypasses" table (lines 156-170, columns `ID | Class | Example | Why it is not caught | What does catch it`).

Add one bullet after the infra bullet: openspec read-only and `archive` allow (writes only inside `openspec/`; allow is a named row, not an exemption, because bash writes are not path-classified); `init`, `update`, `completion`, `feedback`, `config set|...`, `workset`, `store` mutations confirm. CAUTION: "Known bypasses" rows are generated from `tests/fixtures/evasion-corpus.ts` and the row count is asserted equal to the corpus' `OUT-OF-SCOPE` entries (line 160-163, `tests/unit/evasion-corpus.test.ts`). Adding an `npx @fission-ai/openspec ...` row means adding a matching corpus entry, or documenting it in prose outside the table instead. Check that test before choosing.

---

### `docs/WORKFLOWS.md` (modify) or new `docs/OPENSPEC.md`

**Analog:** numbered `## N. Title` sections (lines 20-526), `## 11. Status` at 526. Insert as `## 11.` before Status and renumber Status to 12 only if no test pins "## 11. Status" (grep `docs-policy.test.ts` first); safer is a new `docs/OPENSPEC.md` linked from WORKFLOWS and RUNBOOK. Content: opt-in model, `/skill:openspec-*` and `/opsx-*`, zero per-turn cost mechanism (`disable-model-invocation: true` strict boolean), `openspec-pi` rejection with file:line evidence from RESEARCH section 3, upgrade and uninstall procedures.

---

### `tests/unit/openspec-skills.test.ts` (new, unit, transform)

**Analog:** `tests/unit/budget-command.test.ts` lines 44, 78-89 (real `Skill` objects and Pi's exported `formatSkillsForPrompt`).
```ts
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
const SKILL = { name: "commit", description: "...", filePath: "...", baseDir: "...", sourceInfo: {} as Skill["sourceInfo"], disableModelInvocation: false };
const REAL_SKILLS_BLOCK = formatSkillsForPrompt([SKILL]).trim();
```
Use `loadSkills({ cwd, agentDir, skillPaths: [], includeDefaults: true })` (RESEARCH Code Examples) over fixtures written to `mkdtempSync(join(tmpdir(), ...))` in 1.13.2 frontmatter shape. Cases: patched -> 12 skills, `diagnostics` `[]`, `formatSkillsForPrompt` `""`; unpatched -> non-empty (live negative control); `disable-model-invocation: "true"` string -> NOT honoured. Fixture patch can call a shared function only if the script's awk logic is mirrored in TS; otherwise run the real script via the integration test and keep this file fixture-based.

### `tests/unit/openspec-env.test.ts` (new)

**Analog:** `tests/unit/comment-rules-delivery.test.ts` (line 19 resolves `HARNESS = resolve(repoRoot(), ".pi/extensions/harness/index.ts")`) and `harness-session.ts` lines 141-156 (save map + `restoreEnv`). Import the default factory with a fake `pi` exposing `on`, `registerCommand`, `registerProvider` as no-ops; save the four variables in `beforeEach`, restore in `afterEach`; pre-set `OPENSPEC_TELEMETRY=1` to prove force-assign. Negative control: a source-text assertion is insufficient alone; the behavioural assertion fails when the assignment lines are removed.

### `tests/integration/openspec-setup.test.ts` (new)

**Analog:** `tests/integration/bootstrap-check-only.test.ts` lines 41-122: `spawnSync("sh", [script, ...args], { cwd, env, encoding: "utf-8", timeout, windowsHide: true })`, `PI_CODING_AGENT_DIR` redirected to a fresh temp dir, forward-slash script path (`.replace(/\\/g, "/")`), temp dirs tracked and removed in `afterEach`.

**Stub gap (no exact analog):** `tests/helpers/stub-bin.ts` `StubSpec` (lines 80-111) supports only `exitCode`, `stdout`, `stderr`, `logTo`, `match`; it cannot write files into the cwd, record `XDG_CONFIG_HOME`, or emit skills. RESEARCH assumes it can. Planner must choose: (a) extend `payloadSource` (lines 133-163) with a generic `writeFiles`/`recordEnv` capability (generated `.mjs` already runs in node, so `writeFileSync` and `process.env` are available), or (b) write a bespoke `openspec` stub (`.mjs` + `/bin/sh` launcher + `.cmd`, the three-file shape at lines 181-196) inside the new test. Option (a) is a helper change; keep it additive so existing stubs are unaffected. Note `withStubBin` requires a synchronous `fn` (lines 169-172, 205-210): use `spawnSync`, and on Windows the `.cmd` is only reachable with `shell: true` (module docstring lines 34-47); here the shell script itself runs under `sh` (Git Bash), which resolves the extensionless POSIX launcher, so that limitation does not apply to `sh`-spawned children.

Assertions list: RESEARCH section 5 "Script test". Negative control: a stub emitting fewer than 12 skills makes the script exit non-zero.

### `tests/integration/openspec-zero-cost.test.ts` (new)

**Analog:** `measureFloor` / `withHarnessSession` consumers (`tests/integration/prompt-stability.test.ts`, `context-floor.test.ts`). Pattern:
```ts
await withHarnessSession({ agentSkills }, async (h) => {
	await h.session.prompt("hi");
	const prompt = h.captured[0]; // TranscriptContext, then transcriptView(...)
});
```
Compare `normalisePaths(transcriptView(ctx).systemPrompt, h)` with-flag vs no-skills (byte-identical), without-flag (differs). `/skill:openspec-explore` check: `await h.session.prompt("/skill:openspec-explore")` then assert the captured outgoing user message contains `<skill name="openspec-explore"` (Pi `agent-session.js:1664-1681`). Do not edit the existing floor tests.

---

## Shared Patterns

### Vacuous-pass guard on tables
**Source:** `tests/unit/infra-policy.test.ts` lines 181-185, 220-257; `policy-compose.test.ts` lines 268-272.
**Apply to:** every table-driven test touched. Assert table length floor and that every exported set entry has a row.

### Be suspicious of green (negative control)
**Source:** `tests/unit/gitignore-policy.test.ts` lines 253-260 ("the assertion is live", synthetic input that must differ).
**Apply to:** all new tests; each needs a stated control that fails when its subject is removed.

### Oracles, not parsers
**Source:** `tests/helpers/git.ts` `isIgnored`, `trackedFiles`, `repoRoot`.
**Apply to:** gitignore tests and any repo-state assertion.

### Temp dirs and env restoration
**Source:** `harness-session.ts` lines 139-156, 215-235 (`mkdtempSync(join(tmpdir(), "kypi-..."))`, `removeQuietly`, save/restore map); `bootstrap-check-only.test.ts` (afterEach cleanup).
**Apply to:** all new integration/unit tests that create dirs or mutate `process.env`.

### POSIX sh script conventions
**Source:** `scripts/check-gh-unauthenticated.sh`, `bin/bootstrap.sh` lines 1-81. Tabs, `set -eu`, `printf`, exit 2 on usage error, `PI_CODING_AGENT_DIR` seam, no bashisms; enforced by `tests/unit/lf-and-shell.test.ts` (`trackedFiles("*.sh")`, lines 142-151, only requires the two existing scripts, so a third is safe).

### Targeted test commands
`npx vitest run <file> --maxWorkers=2`, `npx tsc --noEmit` once per plan, never concurrent. Files not to modify: `tool-count-baseline.test.ts`, `contributing-boundary.test.ts`, `pinning.test.ts`, `workflow-budgets.test.ts`, `context-floor.test.ts`, `prompt-stability.test.ts`, `budget.test.ts`, `tool-profiles.test.ts`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| File-writing, env-recording `openspec` stub (part of `openspec-setup.test.ts` or a `stub-bin.ts` extension) | test helper | file-I/O | `stub-bin.ts` `StubSpec` has no file-write or env-record capability; see Stub gap above |
| awk frontmatter patcher inside `scripts/openspec-setup.sh` | utility | transform | No awk-based text rewriter exists in repo scripts; follow RESEARCH "Frontmatter patch (idempotent, POSIX)" |

## Metadata

**Analog search scope:** `.pi/extensions/{safety,harness,routing,diagnostics}`, `scripts/`, `bin/bootstrap.sh`, `tests/{unit,integration,helpers}`, `docs/{RUNBOOK,SAFETY,WORKFLOWS}.md`, `.gitignore`
**Files scanned:** about 30 (read in full or by targeted range)
**Pattern extraction date:** 2026-10-13
