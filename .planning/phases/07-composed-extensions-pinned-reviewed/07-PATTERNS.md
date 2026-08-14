# Phase 7: Composed Extensions, Pinned & Reviewed - Pattern Map

**Mapped:** 2026-08-15
**Files analyzed:** 15 (10 new test files, 1 new helper, 4 modified/new non-test files, plus N vendored source files of unknown final count)
**Analogs found:** 15 / 15

---

## Critical structural finding (reconcile before writing any plan task)

**`tests/unit/extension-layout.test.ts` constrains vendored-extension placement more tightly than 07-RESEARCH.md's "Recommended Project Structure" assumes.**

`.pi/extensions/vendor/loop-police/index.ts` (RESEARCH's suggested layout) is **two** directory levels below `.pi/extensions/`. `extension-layout.test.ts`'s `NESTED_INDEX` regex is:

```typescript
// tests/unit/extension-layout.test.ts:58
const NESTED_INDEX = /^\.pi\/extensions\/[^/]+\/index\.ts$/;
```

`[^/]+` forbids a further `/`, so it matches exactly `.pi/extensions/<one-dir>/index.ts` — **not** `.pi/extensions/vendor/<name>/index.ts`. Any vendored file that is itself an *entry point* (carries `export default`, per `isEntryPoint` at `extension-layout.test.ts:95`) must therefore sit at `.pi/extensions/<name>/index.ts` or `.pi/extensions/<name>.ts` — a flat sibling of `diagnostics/`, `harness/`, `providers/`, `qoder/`, `routing/`, `safety/`, `workflows/` — **not** nested inside an intermediate `vendor/` directory.

Non-entry-point modules (no default export) are less constrained — `NESTED_MODULE = /^\.pi\/extensions\/[^/]+\/.+\.ts$/` allows arbitrary depth after the first directory, because `.+` matches `/`. So a vendored package's *helper* files can live under `.pi/extensions/loop-police/lib/*.ts`, but its *loadable* `index.ts` cannot be one level deeper than that.

**Consequence for the plan:** name vendor directories `.pi/extensions/loop-police/`, `.pi/extensions/git-checkpoint.ts` (or `.pi/extensions/checkpoint/index.ts`), `.pi/extensions/plan-mode/`, `.pi/extensions/todo.ts`, `.pi/extensions/questionnaire.ts` — flat, no `vendor/` parent. This also means **no `package.json` `pi.extensions` change is needed** (confirmed below), which resolves one of the "possibly" items in the file inventory: `package.json` should NOT be touched by this phase.

**Corroborating evidence — `package.json`/`manifest.test.ts` already forbid a new manifest entry:**

```typescript
// tests/unit/manifest.test.ts:42-47
it("points pi.extensions at a literal path, not a glob", () => {
    expect(manifest.pi.extensions).toEqual(["./.pi/extensions"]);
    ...
```

This is an **exact-equality** assertion (`toEqual`, not `toContain`). Adding a second `pi.extensions` entry for a vendor path fails this test immediately. Vendored code MUST live inside the existing `.pi/extensions` tree Pi already auto-discovers — matching RESEARCH.md's own Pattern E conclusion ("no separate `packages[]` local-path entry needed at all"), just at one directory level shallower than RESEARCH's own example path.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `tests/helpers/worktree.ts` | test-helper | file-I/O (real git subprocess) | `tests/helpers/git.ts` | exact (sibling helper, same module) |
| `tests/unit/extension-pins.test.ts` | test (unit) | CRUD-over-config (lockfile diff) | `tests/unit/pinning.test.ts` | exact — imports from it directly |
| `tests/unit/vendor-license-audit.test.ts` | test (unit) | filesystem/policy audit | `tests/unit/npmrc-policy.test.ts` + `tests/unit/template-tracked.test.ts` | role-match (effective-behavior + dual-direction) |
| `tests/unit/extension-composition.test.ts` | test (unit) | filesystem/manifest audit | `tests/unit/extension-layout.test.ts` + `tests/unit/manifest.test.ts` | exact |
| `tests/unit/tool-count-baseline.test.ts` | test (unit) | registry-vs-reality | `tests/unit/workflow-budgets.test.ts` | exact |
| `tests/unit/subagent-agents-config.test.ts` | test (unit) | frontmatter/filesystem assertion | `tests/unit/agent-overrides.test.ts` (routing side) + `tests/unit/agent-dir-setup.test.ts` (module-scope guard side) | role-match |
| `tests/integration/worktree-build.test.ts` | test (integration) | file-I/O, real subprocess | `tests/unit/npmrc-policy.test.ts` (Group B "real attack, both directions") + `tests/helpers/git.ts` | role-match (no existing worktree analog; git-subprocess-attack shape is closest) |
| `tests/integration/git-checkpoint.test.ts` | test (integration) | file-I/O, real subprocess | same as above | role-match |
| `tests/integration/subagent-background.test.ts` | test (integration) | session-level, event-driven | `tests/helpers/faux.ts` + `tests/helpers/session.ts` (as used by e.g. `tests/integration/mode-switch.test.ts`, `tests/integration/fallback-chain.test.ts`) | exact |
| `tests/integration/subagent-steering.test.ts` | test (integration) | session-level, event-driven | same | exact |
| `tests/unit/docs-policy.test.ts` (modify) | test (unit) | doc/status audit | itself — extend `PHASE_FIVE_IDS` shape | exact |
| `docs/RUNBOOK.md` (modify) | doc | — | its own `RB-05-01` entry | exact |
| `.pi/settings.json` (modify) | config | CRUD (data file, becomes the lockfile) | `.pi/extensions/routing/agent-overrides.ts`'s settings-write discipline (atomic write, byte-idempotent) informs how the plan should *write* it, but the file itself is just data | n/a (data, not code) |
| Vendored `pi-loop-police`, `git-checkpoint.ts`, `todo.ts`, `questionnaire.ts`, `plan-mode/` | extension (entry point) | event-driven / in-session state | `.pi/extensions/{diagnostics,harness,providers,qoder,routing,safety,workflows}` — the 7 existing flat subsystem directories | exact (placement convention) |
| `.pi/agents/*.md` (e.g. `planner.md`) | config (frontmatter) | — | Pi's bundled `examples/extensions/subagent/agents/*.md` (what NOT to copy verbatim — see Pitfall below) | negative analog — do not copy `model:` |
| worktree setup hook script | utility (child-process hook) | event-driven (stdin JSON → stdout JSON) | no in-repo analog; contract is external (`pi-subagents`' `WorktreeSetupHookInput`, RESEARCH.md Pattern B) | no analog — new mechanism |

---

## Pattern Assignments

### `tests/helpers/worktree.ts` (test-helper, file-I/O)

**Analog:** `tests/helpers/git.ts` (full file already read — 175 lines, all in context)

`tests/helpers/git.ts` already exports the primitives this phase needs:

```typescript
// tests/helpers/git.ts:64-76
export function repoRoot(): string { ... }

// tests/helpers/git.ts:100-109
export function trackedFiles(pattern = "."): string[] { ... }

// tests/helpers/git.ts:121-136
export function makeTempRepo(prefix: string): string {
	const repo = mkdtempSync(join(tmpdir(), prefix));
	const setup: string[][] = [
		["init"],
		["config", "user.email", "quick@test.invalid"],
		["config", "user.name", "quick test"],
		["checkout", "-b", "work"],
	];
	for (const args of setup) {
		const { status } = run(args, repo);
		if (status !== 0) {
			throw new Error(`git ${args.join(" ")} failed (exit ${status}) while making temp repo ${repo}`);
		}
	}
	return repo;
}

// tests/helpers/git.ts:144-157
export function commitFile(repo: string, name: string, body: string, message: string): string { ... }

// tests/helpers/git.ts:164-174
export function headSha(repo: string): string { ... }
```

**Local `run()` pattern to copy exactly** (`git.ts:45-56`):

```typescript
function run(args: string[], cwd?: string): { stdout: string; status: number | null } {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch: ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", status: result.status };
}
```

**What `worktree.ts` must add, per VALIDATION.md's Wave 0 item and RESEARCH Pattern C:**
- `makeTempRepoWithNodeModulesAndEnv()` — build on `makeTempRepo` + `commitFile`, then create **untracked** `node_modules/dep/index.js` and `.env` directly with `writeFileSync`/`mkdirSync` (never `git add` them — they must stay untracked, that is the whole point).
- `addWorktree(repo, path, branch)` wrapping `spawnSync("git", ["worktree", "add", path, "-b", branch, "HEAD"], { cwd: repo, ... })` — mirror `pi-subagents`' own invocation exactly (RESEARCH.md Pattern B/A3: `git -C <toplevel> worktree add <path> -b pi-parallel-<runId>-<index> HEAD`).
- A `removeWorktree(repo, path, branch)` counterpart calling `git worktree remove --force` then `git branch -D` — same `run()` throw-on-nonzero discipline as every other function in `git.ts`.
- Every new export must throw naming the failing argv on non-zero status, exactly like `commitFile`/`headSha` — **never** return a half-initialised path silently (this is the standing discipline `git.ts`'s own docstring states and every function in it honours).

**Non-test writes:** never inside this repo — `mkdtempSync(join(tmpdir(), prefix))`, same as `makeTempRepo`, not `<repoRoot>/tmp/...` (that convention belongs to `bootstrap-repo.ts` specifically because it needs `node_modules` resolution — worktree fixtures do not import anything from this repo's own `node_modules`, so `os.tmpdir()` is correct here, unlike the `bootstrap-repo.ts` special case documented below).

---

### `tests/unit/extension-pins.test.ts` (unit, CRUD-over-config)

**Analog:** `tests/unit/pinning.test.ts` (full file already read — this IS the import source, not just a pattern to imitate)

**The one function this file is allowed to import — do not write a second regex:**

```typescript
// tests/unit/pinning.test.ts:145-147
export function isPinnedPackageSpec(spec: string): boolean {
	return /^npm:.+@[0-9]/.test(spec) || /^(git:|https:\/\/|http:\/\/|ssh:\/\/|git:\/\/).+@.+$/.test(spec);
}
```

**Import shape:**

```typescript
import { isPinnedPackageSpec } from "./pinning.test.ts";
```

**CRITICAL — `isOwnRepo` is NOT exported.** Only `isPinnedPackageSpec` has the `export` keyword; `isOwnRepo` (`pinning.test.ts:160-162`) is a private `function`, not exported:

```typescript
// tests/unit/pinning.test.ts:158-162
const OWN_REPO_URL = "https://github.com/kaiyitkoh/ky-pi-agent";

function isOwnRepo(spec: string): boolean {
	return spec === OWN_REPO_URL || spec === `${OWN_REPO_URL}.git`;
}
```

This is not a gap the plan needs to fix: none of Phase 7's packages are this repo's own URL (decision 2 — "not extended to anybody else"), so `extension-pins.test.ts` never needs `isOwnRepo` at all. If a future test genuinely needs it, that is a Phase-1-owned export change, not something to duplicate here.

**The registry-vs-reality dual assertion to build (per `<what_matters_most>` item 2 and RESEARCH Pattern D) — copy `workflow-budgets.test.ts`'s exact shape**, substituting "packages[]" for "workflow files":

```typescript
// tests/unit/workflow-budgets.test.ts:463-481 (completeness, both directions)
describe("FLOW-11 -- registry completeness, both directions", () => {
	const discovered = discoverWorkflowFiles();
	const declaredFiles = WORKFLOW_BUDGETS.map((e) => e.file);

	it("present-but-undeclared: every discovered workflow file has a budget entry", () => {
		const offenders = discovered.filter((p) => !declaredFiles.includes(p));
		expect(offenders, "...").toEqual([]);
	});

	it("declared-but-absent: every WORKFLOW_BUDGETS entry names a file that still exists", () => {
		const offenders = WORKFLOW_BUDGETS.filter((e) => !existsSync(join(repoRoot(), e.file))).map((e) => e.file);
		expect(offenders, "...").toEqual([]);
	});
});
```

For `extension-pins.test.ts`, this becomes:
1. **Drift direction:** `.pi/settings.json`'s `packages[]` deep-equals a committed `EXPECTED_PACKAGES` const table exactly (order-independent) — every entry must also pass `isPinnedPackageSpec`.
2. **Undeclared-installed direction:** per RESEARCH Pattern D point 2, this is only checkable when `.pi/npm/` or `.pi/git/<host>/` actually exist on disk (they won't in CI, which never runs `pi install`) — write the test to be conditional on their existence and **say so in a comment**, exactly as `tests/unit/agent-dir-setup.test.ts` and other files in this repo state their own scope boundaries in the docstring rather than silently narrowing.
3. **Vacuity guards first, same as every registry file in this repo** (`workflow-budgets.test.ts:266-280`): assert `EXPECTED_PACKAGES.length >= 1` and the settings file's `packages` array is non-empty *before* asserting membership, or an empty table would pass having checked nothing.

**Existing vacuous assertion this file makes load-bearing:** `pinning.test.ts:347-374` ("every third-party entry in `.pi/settings.json` `packages[]` carries a ref") already exists and currently passes vacuously against `{}`. Writing the first `packages[]` entries makes it exercise real data for the first time — no change to `pinning.test.ts` itself is needed or wanted.

---

### `tests/unit/vendor-license-audit.test.ts` (unit, filesystem/policy audit)

**Analog 1 — the "effective, not merely present" methodology:** `tests/unit/npmrc-policy.test.ts` (full file read). Its governing principle, stated in its own header (`npmrc-policy.test.ts:1-14`), applies directly to EXT-10:

> "RESEARCH.md 'Common Pitfalls' 1 names the warning sign explicitly: a check of a FILE'S EXISTENCE rather than of `npm config get` output."

For vendor-license-audit, the equivalent trap is checking that a vendored directory *exists* without checking that the package is **not simultaneously** reachable via an npm install path in `.pi/settings.json`'s `packages[]` — a package could be vendored AND accidentally left in `packages[]` from an earlier draft, defeating EXT-10's whole point silently.

**Analog 2 — dual-direction shipped-vs-swallowed table shape:** `tests/unit/template-tracked.test.ts` (full file read). Copy its exact two-table structure:

```typescript
// tests/unit/template-tracked.test.ts:49-62
const MUST_BE_SHIPPED = [
	".pi/templates/models-template.json",
	".pi/templates/auth-template.json",
] as const;

const MUST_BE_SWALLOWED = [
	{ path: ".pi/templates/auth.json", rule: ".gitignore:46 (`auth.json`)" },
	{ path: ".pi/templates/auth.example.json", rule: ".gitignore:47 (`auth.*.json`)" },
] as const;
```

For `vendor-license-audit.test.ts`: `MUST_BE_VENDORED` (a table of `{ path, npmPackageName }` — e.g. `{ path: ".pi/extensions/loop-police", npmPackageName: "pi-loop-police" }`) paired with an assertion that `npmPackageName` does **not** appear as an `npm:<name>@` prefix anywhere in `.pi/settings.json`'s `packages[]`. Both tables non-empty (vacuity guard), both directions asserted (`trackedFiles` on the vendor dir returns something AND the settings file has no matching npm entry), following `template-tracked.test.ts:65-77`'s "asserts a meaningful number of paths in both directions" pattern exactly.

**Analog 3 — package.json shape assertions for governed lists:** `tests/unit/manifest.test.ts`'s "declares no X beyond the audited list" pattern (`manifest.test.ts` overall shape, and directly reusable from `pinning.test.ts:277-280`):

```typescript
// tests/unit/pinning.test.ts:277-280
it("declares no dev dependency beyond the six audited pins", () => {
	expect(Object.keys(dev).sort()).toEqual(Object.keys(REQUIRED_DEV_PINS).sort());
});
```

**LICENSE-file audit data to embed as a committed table** (from RESEARCH.md's own re-verified findings, Addendum A5 — copy the shape, re-verify the values at execution time per the phase's own thesis):

```
pi-subagents@0.49.0        LICENSE present, MIT  -> npm install
pi-background-tasks@2.4.2  LICENSE present, ISC  -> npm install
@narumitw/pi-lsp@0.49.4    LICENSE present, MIT  -> npm install
pi-web-access@0.22.0       LICENSE present, MIT  -> npm install
pi-session-finder@0.5.6    LICENSE present, MIT  -> npm install
pi-loop-police@1.14.1      NO LICENSE FILE       -> VENDOR (EXT-10)
```

---

### `tests/unit/extension-composition.test.ts` (unit, filesystem/manifest audit — EXT-05/EXT-06)

**Analog:** `tests/unit/extension-layout.test.ts` (full file read, 266 lines) + `tests/unit/manifest.test.ts` (full file read, 71 lines)

Reuse `extension-layout.test.ts`'s exact discovery primitives rather than re-deriving them — `isEntryPoint`, `FLAT`, `NESTED_INDEX`, `walkOnDisk` are all candidates to import if this new file needs to enumerate `.pi/extensions/` itself, or the plan can simply run `extension-layout.test.ts`'s existing suite unmodified (it already asserts every tracked `.ts` sits at an auto-discovered path — that assertion, unmodified, is what makes the flat-not-nested-vendor placement (see the Critical Structural Finding above) mechanically enforced for every file this phase adds).

**What `extension-composition.test.ts` itself must add on top (EXT-05/EXT-06's own claim — "each capability resolves to an installed OR vendored source"):** a capability→evidence table, same registry shape as `workflow-budgets.test.ts`'s `WORKFLOW_BUDGETS`:

```typescript
const CAPABILITY_SOURCES: readonly { capability: string; evidence: () => boolean; why: string }[] = [
	{ capability: "plan mode",   evidence: () => existsSync(join(ROOT, ".pi/extensions/plan-mode/index.ts")), why: "vendored bundled example, EXT-06" },
	{ capability: "todo",        evidence: () => existsSync(join(ROOT, ".pi/extensions/todo.ts")), why: "vendored bundled example, EXT-06" },
	{ capability: "background bash", evidence: () => packagesContains("npm:pi-background-tasks@"), why: "no bundled equivalent, EXT-05" },
	{ capability: "LSP diagnostics", evidence: () => packagesContains("npm:@narumitw/pi-lsp@"), why: "no bundled equivalent, EXT-05" },
	// ...
];

it.each(CAPABILITY_SOURCES)("$capability has a real source ($why)", ({ evidence }) => {
	expect(evidence()).toBe(true);
});
```

Every `it.each` row here doubles as the EXT-06 "bundled preferred wherever it covers the need" proof, because each row's `evidence()` names *which* mechanism (vendored path vs. `packages[]` npm spec) satisfies the capability — a row whose evidence function checks `packages[]` for a capability RESEARCH.md says should be vendored is a fast, mechanical way to catch the exact EXT-06 regression this phase is named after.

---

### `tests/unit/tool-count-baseline.test.ts` (unit, registry-vs-reality — Phase 10's baseline)

**Analog:** `tests/unit/workflow-budgets.test.ts` (full file read, 483 lines) — this is the single most directly-reusable pattern in the whole phase. Its dual-direction discipline is exactly what `<what_matters_most>` item 2 asks for.

**The registry shape to copy verbatim** (`workflow-budgets.test.ts:84-112`):

```typescript
const WORKFLOW_BUDGETS: readonly { file: string; budget: number; why: string }[] = [
	{ file: ".pi/extensions/workflows/index.ts", budget: 80, why: "FLOW-01 -- the ROADMAP's /quick raw-line ceiling" },
	// ...
];
```

Becomes, for the tool-count baseline (data from RESEARCH.md Addendum A4, re-verify at execution time):

```typescript
const TOOL_COUNT_BASELINE: readonly { extension: string; toolNames: readonly string[]; why: string }[] = [
	{ extension: "pi-subagents@0.49.0", toolNames: ["subagent", "subagent_wait", "subagent_supervisor", "intercom"], why: "Addendum A1/A4 — all four always-active, zero promptSnippet" },
	{ extension: "pi-background-tasks@2.4.2", toolNames: ["bg_run", "bg_run_pi_attested", "bg_status", "bg_logs", "bg_kill", "bg_delegate", "bg_result", "fusion_reason", "fusion_investigate", "fusion_research", "fusion_validate"], why: "Addendum A4 — all 11 always-active, all carry promptSnippet; delegate/fusion 6 are redundant with pi-subagents, cannot be filtered (Pitfall 1)" },
	{ extension: "@narumitw/pi-lsp@0.49.4", toolNames: ["lsp_diagnostics", "lsp_fix"], why: "Addendum A4" },
	{ extension: "@narumitw/pi-plan-mode or vendored plan-mode/", toolNames: [], why: "gated on entry/exit if the npm package is used (idle cost zero); ALWAYS-ON if the bundled example is vendored instead -- record whichever the plan actually ships" },
];
```

**Registry completeness, both directions — copy this exact block, substituting the subject** (`workflow-budgets.test.ts:459-482`):

```typescript
describe("registry completeness, both directions", () => {
	it("present-but-undeclared: every discovered X has a baseline entry", () => { /* ... */ });
	it("declared-but-absent: every TOOL_COUNT_BASELINE entry names something that still exists", () => { /* ... */ });
});
```

This file cannot literally read live tool registration the way `workflow-budgets.test.ts` reads raw line counts from disk (tool registration only happens inside a running Pi process) — so the "discovered" half of the dual assertion has to be sourced from `.pi/settings.json`'s `packages[]` (what's actually installed) cross-checked against the committed baseline table, i.e. it is closer to `extension-pins.test.ts`'s registry-vs-settings shape than to a pure filesystem scan. State this scope boundary in the file's own docstring, the same way `tests/unit/agent-dir-setup.test.ts` and `docs-policy.test.ts` state theirs.

---

### `tests/unit/subagent-agents-config.test.ts` (unit, frontmatter/filesystem — EXT-01)

**Analog 1 — real-file, temp-dir-scoped, no writes outside temp shape:** `tests/unit/agent-overrides.test.ts` (full file read, 516 lines). Copy its temp-dir hygiene pattern exactly:

```typescript
// tests/unit/agent-overrides.test.ts:64-70
let tempDirs: string[] = [];

function freshSettingsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "kypi-agent-overrides-"));
	tempDirs.push(dir);
	return join(dir, "settings.json");
}
```

**Analog 2 — module-scope-vs-test-scope discipline (only if the plan needs to prove something at import time):** `tests/unit/agent-dir-setup.test.ts` (full file read, 51 lines) — narrower relevance; cite only if a similar "must already be true before any test body runs" claim surfaces for agent-dir resolution.

**The real names this file must assert against — not invented ones.** `.pi/extensions/routing/schema.ts:334-336`:

```typescript
export const AGENT_NAME_BY_ROLE: Partial<Record<Role, string>> = {
	planner: "planner",
};
```

So the first (and currently only) shipped `.pi/agents/*.md` file this phase's plan should expect is `planner.md` — import `AGENT_NAME_BY_ROLE` from `routing/schema.ts` rather than hardcoding `"planner"`, mirroring how `agent-overrides.test.ts:102` already does (`Object.values(AGENT_NAME_BY_ROLE)`).

**The no-`model:`-key assertion — the single most important assertion in this file, per decision 8 and RESEARCH Addendum A2.** A2 sharpens CONTEXT.md's own claim: it is not merely that a stray `model:` is bad hygiene, it makes `agentOverrides` **inert** for that agent (`pi-subagents/src/agents/agents.ts:1155`: `if (override.model !== undefined && !agentHasFrontmatterField(agent, "model"))`). Structure the assertion as a frontmatter-key scan over every tracked `.pi/agents/*.md`:

```typescript
// pattern, not verbatim — parse the frontmatter block (--- ... ---) and assert
// it has no top-level `model:` key, for every file discovered via trackedFiles(".pi/agents")
for (const file of trackedFiles(".pi/agents").filter((p) => p.endsWith(".md"))) {
	it(`${file} carries no model: key`, () => {
		const frontmatter = extractFrontmatter(readFileSync(join(ROOT, file), "utf-8"));
		expect(Object.keys(frontmatter)).not.toContain("model");
	});
}
```

**Show it fails when removed** (VALIDATION.md's standing constraint): the test suite must include a case that plants a fixture `.md` string containing `model: claude-haiku-4-5` and asserts the *predicate* rejects it — the same "prove the discriminator is live against inline fixtures" discipline `extension-layout.test.ts:229-265` uses for `isEntryPoint` (four cases, both directions, inline strings never written to `.pi/extensions/` itself).

**Full frontmatter key vocabulary this file may need to assert against** (RESEARCH Addendum A2, `pi-subagents/src/agents/agents.ts:1527`, `frontmatter.ts:65`): `name`, `description` (required); `thinking`, `tools`, `systemPromptMode`, `defaultReads`, `model` (forbidden), `fallbackModels`, `inheritProjectContext`, `inheritSkills`, and 15 others — parsed by a **custom flat-key-plus-folded-block parser, not the `yaml` dependency**. If the plan's own frontmatter reader needs to parse `.pi/agents/*.md` for this test, it must not assume real YAML syntax works (e.g. nested lists inside frontmatter may not parse the way a YAML library would).

---

### `tests/integration/worktree-build.test.ts` (integration, file-I/O — EXT-02, the decisive proof)

**No direct existing analog** (confirmed — the full `tests/integration/` listing contains no worktree-shaped file). Closest structural analog: `tests/unit/npmrc-policy.test.ts` Group B, "the real attack, in both directions" (full file read).

**The methodology to copy — assert the negative BEFORE the remedy, so the remedy's effect is attributable:**

```typescript
// tests/unit/npmrc-policy.test.ts:273-303 (shape, not literal content)
it("hardened prefix: the postinstall is blocked and writes no sentinel", () => { ... });
it("unhardened prefix: the SAME postinstall DOES write its sentinel", () => {
	// Not optional. Without this, the assertion above could be passing because
	// the fixture is inert ... the probe is a dud, not the control a success
});
```

Directly maps onto RESEARCH.md's own Pattern C, step-by-step proof design (already fully specified there — reproduce its 10 steps, not re-derive them):

```
1. makeTempRepo() a fresh synthetic repo (never this repo)
2. commit a trivial tracked src/index.js requiring ./dep and checking fs.existsSync(".env")
3. OUTSIDE git: untracked node_modules/dep/index.js + untracked .env in the temp repo root
4. assert: node src/index.js in the ORIGINAL repo succeeds (fixture sanity)
5. spawnSync("git", ["worktree", "add", worktreePath, "-b", "test-branch", "HEAD"], {cwd: repo})
6. assert: node_modules and .env do NOT exist in the worktree (negative proof, untracked files don't travel)
7. assert: node src/index.js INSIDE the worktree throws Cannot find module (worktree genuinely cannot build)
8. apply the remedy: fs.symlinkSync(..., "junction") for node_modules, copy .env
9. assert: node src/index.js inside the worktree now succeeds (remedy proven sufficient)
10. cleanup: git worktree remove --force, git branch -D
```

**The Windows-specific fact this test must encode, verified directly on this machine (RESEARCH.md, executed, not inferred):**

```javascript
const fs = require("node:fs");
fs.symlinkSync(target, link);                 // FAILS: EPERM (no Developer Mode/elevation)
fs.symlinkSync(target, link, "junction");      // SUCCEEDS: no special privilege needed
```

Use `tests/helpers/worktree.ts` (see above) for steps 1–3 and 5/10; steps 4/6/7/8/9 are this file's own assertions using `node:child_process.spawnSync("node", [...])` or a direct `require()`/`import()` inside the test process.

---

### `tests/integration/git-checkpoint.test.ts` (integration, file-I/O — EXT-07)

**Analog:** same real-temp-git-repo, both-directions methodology as `worktree-build.test.ts` above, applied to `tests/helpers/git.ts`'s `makeTempRepo`/`commitFile`.

**The three defects the hardened `git-checkpoint.ts` must fix, and therefore the three things this test must prove (from CONTEXT.md, independently re-confirmed in RESEARCH.md):**

```
git-checkpoint.ts:33-36  if (!ctx.hasUI) { return; }        -> must work headless
git-checkpoint.ts:22     pi.exec("git", ["stash", "create"]) with no -u  -> must capture untracked files
git-checkpoint.ts:11,29,49-51  in-memory Map, restore only on session_before_fork, cleared on agent_end
                                                              -> must survive /reload and a restart
```

**Test shape:** real temp git repo (`makeTempRepo` + `commitFile`), modify a tracked file AND create an untracked file, invoke the hardened checkpoint's create-then-restore path directly (not through a live Pi session — this is a unit-adjacent integration test over the extension's exported functions, similar in spirit to how `agent-overrides.test.ts` drives `writeAgentOverrides` directly rather than through a full session), assert both the tracked change and the untracked file are present after restore. Then assert the restore path is reachable from something other than `session_before_fork` — e.g. a directly-callable exported function or a headless-safe command — per the "must work headless" defect fix.

---

### `tests/integration/subagent-background.test.ts` / `tests/integration/subagent-steering.test.ts` (integration, session-level — EXT-03/EXT-04)

**Analog:** `tests/helpers/faux.ts` (full file read, 397 lines) + `tests/helpers/session.ts` (full file read, 357 lines) — the standard session-level harness this repo already uses throughout `tests/integration/mode-switch.test.ts`, `tests/integration/fallback-chain.test.ts`, `tests/integration/qoder-delegate.test.ts`, etc.

**The core primitive to reuse:**

```typescript
// tests/helpers/session.ts:346-356
export async function withFauxSession<T>(
	opts: FauxSessionOptions,
	fn: (handle: FauxSessionHandle) => Promise<T>,
): Promise<T> {
	const handle = await createFauxSession(opts);
	try {
		return await fn(handle);
	} finally {
		await handle.dispose();
	}
}
```

**Scope discipline, stated explicitly in RESEARCH.md's own Wave 0 Gaps note and worth restating in this file's own docstring:** these two tests prove **this repo's composition** (that `pi-subagents` is configured, that the async/steering config surface is wired), **not** `pi-subagents`' own internals — RESEARCH.md's recommendation is to cite the package's own already-passing test suite for internal behavior (`node --experimental-strip-types --test test/unit/*.test.ts` inside the installed package) rather than re-proving it here. This mirrors the existing scope-boundary discipline in `docs-policy.test.ts`'s own header ("THE GUARD SPANS THREE PHASES...") and `qoder-delegate.test.ts`'s RB-05-01 entry ("It proves the harness constructs the right requests... It says nothing about whether a real personal access token reaches...").

**User-scope extension loading caveat, load-bearing for any test that needs the extension under test to actually run inside a faux session** (`session.ts:32-35, 165-185`):

```
The extension under test must load at USER scope, i.e. <agentDir>/extensions/<name>/index.ts.
Project-scoped .pi/extensions is gated behind project trust, which returns false headless
with no UI to answer it.
```

Use `writeUserScopeShim(agentDir, name, targetAbsPath)` (`session.ts:192-213`) to point a faux session at the real `.pi/extensions/routing/...` or a real vendored extension file, exactly as `bootstrap-safety-stub.test.ts`'s CR-06 cases already do for `safety/index.ts`.

---

## Modified Files

### `tests/unit/docs-policy.test.ts` — add `PHASE_SEVEN_IDS`

**Analog:** its own existing `PHASE_FIVE_IDS` block (full file read, 926 lines — the exact shape to reproduce is already in context).

**Reproduce this shape verbatim, substituting Phase 7's content:**

```typescript
// tests/unit/docs-policy.test.ts:96-108
/**
 * The Phase 5 entry this file governs.
 *
 * ROUTE-11 needs the work laptop specifically: ...
 */
const PHASE_FIVE_IDS = ["RB-05-01"] as const;

/** Every governed entry, in phase order. A later phase appends its array here. */
const ALL_IDS = [
	...PHASE_ONE_IDS,
	...PHASE_TWO_IDS,
	...PHASE_THREE_IDS,
	...PHASE_FOUR_IDS,
	...PHASE_FIVE_IDS,
] as const;
```

Becomes:

```typescript
const PHASE_SEVEN_IDS = ["RB-07-01"] as const;

const ALL_IDS = [
	...PHASE_ONE_IDS,
	...PHASE_TWO_IDS,
	...PHASE_THREE_IDS,
	...PHASE_FOUR_IDS,
	...PHASE_FIVE_IDS,
	...PHASE_SEVEN_IDS,   // NOTE: no PHASE_SIX_IDS exists in this file today — confirm at
	                       // execution time whether Phase 6 added its own RB entries;
	                       // if not, this is simply the next append, per "append, never renumber"
] as const;
```

**`ENTRY_COMMANDS["RB-07-01"]` must name the exact commands** — same discipline as every phase since Phase 3 ("PINS WHOLE ONE-LINE COMMANDS", `docs-policy.test.ts:321-334`). RESEARCH.md's own EXT-09 composition section names the four legs and their existing RB citations (RB-02-01, RB-03-0x) — the new `RB-07-01` commands should be the **composed sequence**, referencing those existing RB ids by name in the runbook prose (not duplicating their commands), plus whatever is new for "one subagent spawn against a real model."

**No fixture work needed for the parser itself** — `runbookEntryStatuses`, `tableStatus`, `sectionStatus` (`docs-policy.test.ts:146-200`) are already generalized to `RB-\d{2}-\d{2}` and already proven against a `FIXTURE_PHASE_THREE`-shaped id; Phase 7 does not need a new fixture pair unless the plan wants the same non-vacuity belt-and-suspenders `FIXTURE_PHASE_TWO`/`FIXTURE_PHASE_THREE` already demonstrate (recommended, for consistency, but the parser genuinely does not need it to function).

---

### `docs/RUNBOOK.md` — append `RB-07-01`

**Analog:** the `RB-05-01` entry, read in full (`docs/RUNBOOK.md` tail, ~80 lines). Reproduce this exact structure:

```markdown
## Phase N — <title>

<2-4 sentence summary of what the phase proved offline and what remains outstanding>

`tests/unit/docs-policy.test.ts` guards this status exactly as it guards the
Phase 1, 2, 3, 4 and 5 ones: it parses both the summary-table row and the
`**Status:**` line of every `RB-<phase>-<n>` entry, and a disagreement between
the two is reported as `INCONSISTENT`, which is never an acceptable status.

| ID | Check | Status |
|----|-------|--------|
| RB-07-01 | <one-line description> | OUTSTANDING |

### RB-07-01 — <title>

**Status:** OUTSTANDING

**Why this cannot be done here.** <credential/network/TTY reasons, naming
exactly what this machine lacks>

**Procedure, on the work laptop:**

1. <step>
2. <step>
...

**Expected output.** <specific, falsifiable expected result — never "it seemed fine">

**Offline proxy:** <name each proxy test file by path and state precisely
what it proves and what it does NOT prove — the RB-05-01 entry's closing
paragraph is the exact tone and precision level to match>
```

The **table row's Status cell and the `### RB-07-01` section's `**Status:**` line must both say `OUTSTANDING`** verbatim — `docs-policy.test.ts`'s `tableStatus`/`sectionStatus` functions read both independently and report `INCONSISTENT` on any disagreement (`docs-policy.test.ts:129-161`).

---

### `.pi/settings.json` — gains `packages[]`

Currently `{}` (confirmed by direct read). No existing code file is the "analog" here since this is pure data, but two things govern its shape:

1. Every third-party entry must satisfy `isPinnedPackageSpec` from `pinning.test.ts` (imported into `extension-pins.test.ts`, per above) — `npm:<pkg>@<exact-version>` or a `git:`/`https://`/`ssh://` ref carrying `@<ref>`.
2. `pinning.test.ts:347-374`'s existing (currently vacuous) assertion becomes load-bearing the moment this file's `packages` key is populated — no change to `pinning.test.ts` is needed, but the plan's own test run must include it as a regression check.

Vendored packages (loop-police, checkpoint, plan-mode, todo, questionnaire) get **no** `packages[]` entry at all — per RESEARCH.md Pattern E, placing them inside the auto-discovered `.pi/extensions/` tree (flat, per the Critical Structural Finding above) means Pi loads them with zero explicit registration, and `vendor-license-audit.test.ts`'s negative assertion (no matching `npm:<name>@` in `packages[]`) is what proves this stayed true.

---

### `package.json` — no change expected

Per the Critical Structural Finding: `manifest.test.ts:42-47` asserts `pi.extensions` deep-equals `["./.pi/extensions"]` exactly. Since vendored code must live flat inside the existing `.pi/extensions/` tree (not a separate `vendor/` root outside it), **no manifest edit is needed**. If the plan concludes otherwise, it must also plan an edit to `manifest.test.ts` and `extension-layout.test.ts` in the same change — treat that as a signal to re-examine the placement decision first, not as routine test maintenance.

---

## Shared Patterns

### Vacuity guards — apply to every new registry-shaped test

Every test file surveyed in this phase (`pinning.test.ts`, `workflow-budgets.test.ts`, `extension-layout.test.ts`, `template-tracked.test.ts`, `docs-policy.test.ts`) asserts its own discovery/collection is non-empty **before** asserting membership. Copy this exact idiom into every new file:

```typescript
// workflow-budgets.test.ts:266-280, template-tracked.test.ts:65-77 — same idiom, different subject
it("finds at least one X (guards against a vacuous pass)", () => {
	expect(discovered.length, "...without this guard every assertion below would pass having checked nothing").toBeGreaterThanOrEqual(1);
});
```

### Dual-direction registries — apply to `extension-pins.test.ts`, `vendor-license-audit.test.ts`, `tool-count-baseline.test.ts`

Every registry in this repo (`WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS`, `AUDITED_PINS` in `ci-pinning.test.ts`, `MUST_BE_SHIPPED`/`MUST_BE_SWALLOWED`) is checked in **both** directions: present-but-undeclared (something real that the registry doesn't know about) AND declared-but-absent (a registry entry naming something that no longer exists). A registry checked in only one direction is the exact failure mode `<what_matters_most>` item 2 names.

### Real-subprocess, both-directions attack proof — apply to `worktree-build.test.ts`, `git-checkpoint.test.ts`

`npmrc-policy.test.ts` Group B's structure (hardened case negative, unhardened case positive, same fixture, same argv) is the template for any test proving a remedy actually does something: **always** include the "without the remedy, the bad thing genuinely happens" control, or the "with the remedy, the bad thing doesn't happen" assertion could be passing because the fixture itself is inert.

### Temp-directory hygiene — apply to every new file that touches the filesystem

Two conventions coexist in this repo, use the right one:
- **`os.tmpdir()`** (`git.ts`, `agent-overrides.test.ts`, `session.ts`) — the default. Use for anything that does not need this repo's own `node_modules` as an ancestor directory.
- **`<repoRoot>/tmp/...`** (`bootstrap-repo.ts` only) — the exception, needed only because `bootstrap-safety-stub.test.ts` dynamically imports the copied safety extension through jiti and that import must resolve this repo's real `node_modules`. `worktree.ts`'s fixtures do not import anything from this repo, so `os.tmpdir()` is correct for them (already gitignored regardless, per `git.ts`'s own module docstring convention).

Every temp dir created must be removed in `afterEach`/`finally`, with `{ recursive: true, force: true, maxRetries: 3 }` on Windows (the `maxRetries` convention appears throughout `agent-overrides.test.ts` and `session.ts` — "file handles linger" on Windows).

### No test may write outside the repo or a temp dir (standing constraint, VALIDATION.md)

Already the norm in every analog file read for this phase — none of `git.ts`, `session.ts`, `agent-overrides.test.ts`, `npmrc-policy.test.ts` ever write to a real `~/.pi/agent` path; `session.ts`'s own docstring states the CR-01 finding this constraint exists to prevent recurring ("Phase 5's review found the suite writing into the developer's real `~/.pi/agent/settings.json`").

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Worktree setup hook script (e.g. `.pi/scripts/worktree-setup-hook.mjs`) | utility (child-process hook) | stdin JSON → stdout JSON | No in-repo precedent for a stdin/stdout JSON contract with an external process; the contract itself comes entirely from `pi-subagents`' own `WorktreeSetupHookInput` interface (RESEARCH.md Code Examples section — reproduce that interface, not an in-repo pattern). Node/`.mjs`, not `sh`, because it must call `fs.symlinkSync(..., "junction")`, which POSIX `sh` cannot do portably — this is not a violation of the "POSIX sh throughout" constraint, since that constraint governs shell *scripts*, and this is a Node program invoked as a subprocess, the same category as every `.ts` extension in this repo. |

---

## Metadata

**Analog search scope:** `tests/unit/*.ts` (49 files, all listed and 11 read in full), `tests/integration/*.ts` (31 files listed, none matched as a direct worktree/checkpoint analog), `tests/helpers/*.ts` (11 files listed, 4 read in full: `git.ts`, `faux.ts`, `session.ts`, `bootstrap-repo.ts`), `.pi/extensions/` (7 existing subsystem directories confirmed via `package.json`/`manifest.test.ts`/`extension-layout.test.ts`), `.pi/settings.json`, `package.json`, `docs/RUNBOOK.md` (tail read), `.pi/extensions/routing/schema.ts` (agent-name source of truth).
**Files scanned:** ~20 read in full or targeted section, 80 test files enumerated by glob.
**Pattern extraction date:** 2026-08-15
