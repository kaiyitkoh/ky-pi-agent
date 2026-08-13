# Phase 3: Providers & Credentials — Pattern Map

**Mapped:** 2026-08-13
**Files analyzed:** 24 (20 new, 4 modified)
**Analogs found:** 24 / 24 — every file in this phase has a real in-repo analog. Nothing here is greenfield.

> Read this with `03-RESEARCH.md` open. RESEARCH says *what* to build (it already
> carries the literal JSON, the `compat` table, the `message_end` sketch and the
> `callWithFallback` shape). This file says *which existing file each new file
> must look like*, and quotes the lines to copy from.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `tests/helpers/faux.ts` **(modify)** — add `wrapFauxWithStatus` | test helper | transform (provider decorator) | itself: `wrapFauxWithPayload`, lines 275–303 | **exact** (same file, sibling function) |
| `tests/helpers/models.ts` **(new)** — `withModelsConfig()` | test helper | request-response (offline registry) | `tests/helpers/session.ts` lines 205–318 | **exact** |
| `tests/helpers/loopback.ts` **(new)** — `withLoopbackCompletions()` | test helper | streaming / request-response | `tests/helpers/logs.ts:58-71` (async `with*`) + `tests/helpers/stub-bin.ts:173-217` (disposable-fixture lifecycle) | role-match ×2 |
| `tests/unit/template-tracked.test.ts` **(new)** | unit test (policy) | file-I/O | `tests/unit/logs-gitignored.test.ts` | **exact** |
| `tests/unit/command-interpolation.test.ts` **(new)** | unit test (policy + behaviour) | file-I/O + process | `tests/unit/chokepoint-lint.test.ts` (the scan half) + `tests/helpers/stub-bin.ts` `logTo` (the counter half) | **exact** ×2 |
| `tests/unit/dashscope-compat.test.ts` **(new)** | unit test | transform (config merge) | `tests/unit/pinning.test.ts` (table-of-record + vacuity guards); canary half → `tests/unit/version-gate.test.ts` posture | role-match |
| `tests/unit/model-metadata.test.ts` **(new)** | unit test (invariant) | transform | `tests/unit/pinning.test.ts` lines 95–102, 244–257 | **exact** |
| `tests/unit/bedrock-auth.test.ts` **(new)** | unit test | request-response (auth resolve) | `tests/helpers/session.ts:246-253` driven from a unit test; assertion shape from `tests/unit/redact.test.ts` | role-match |
| `tests/unit/r1-unclamp.test.ts` **(new)** | unit test (pure) | transform | `tests/unit/prose-detector.test.ts` / `tests/unit/redact.test.ts` (pure table-driven) | **exact** |
| `tests/integration/templates-install.test.ts` **(new)** | integration test | file-I/O + subprocess | `tests/integration/bootstrap-check-only.test.ts` | **exact** |
| `tests/integration/dashscope-payload.test.ts` **(new)** | integration test | streaming capture | `tests/integration/wire-capture.test.ts` | **exact** |
| `tests/integration/sso-classifier.test.ts` **(new)** | integration test | event-driven (`message_end`) | `tests/integration/prose-retry.test.ts` | **exact** |
| `tests/integration/fallback-chain.test.ts` **(new)** | integration test | request-response (nested calls) | `tests/integration/call-model.test.ts` | **exact** |
| `tests/unit/docs-policy.test.ts` **(modify)** | unit test (docs policy) | file-I/O | itself: Phase 2's Group B/C extension, lines 52–74, 228–269, 387–407 | **exact** |
| `.pi/extensions/providers/index.ts` **(new)** — entry point, registers the `message_end` classifier | extension entry | event-driven | `.pi/extensions/diagnostics/index.ts:432-446, 484-584` + `.pi/extensions/harness/index.ts:68-98` | **exact** |
| `.pi/extensions/providers/sso.ts` **(new)** — `classifySso()` predicate | pure module | transform | `.pi/extensions/diagnostics/prose.ts` | **exact** |
| `.pi/extensions/providers/fallback.ts` **(new)** — `callWithFallback()` | service module | request-response | `.pi/extensions/diagnostics/call-model.ts:365-496` | **exact** |
| `.pi/extensions/providers/schema.ts` **(new, optional)** — shared literals | constants module | — | `.pi/extensions/diagnostics/schema.ts:49-108` | **exact** |
| `.pi/templates/models-template.json` **(new)** | config template | file-I/O | `.pi/templates/env.example` | role-match |
| `.pi/templates/auth-template.json` **(new)** | config template | file-I/O | `.pi/templates/env.example` | role-match |
| `.pi/templates/env.example` **(modify)** — add `KYPI_DASHSCOPE_BASE_URL` | config template | file-I/O | itself, lines 11–16 | **exact** |
| `bin/bootstrap.sh` **(modify)** — `merge_models_json`, `merge_auth_json` | installer script | file-I/O | itself: `merge_settings` (441–474) and `write_env_template` (479–519) | **exact** |
| `docs/RUNBOOK.md` **(modify)** — `RB-03-01`…`RB-03-05` | documentation | — | itself: `RB-02-01/02/03`, lines 190–385 | **exact** |
| `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` **(modify)** | planning artifact | — | n/a — see *No Analog Found* | — |

---

## Pattern Assignments

### `tests/helpers/faux.ts` — add `wrapFauxWithStatus` (test helper, provider decorator)

**Analog:** the same file. `wrapFauxWithPayload` is the direct sibling; copy its
shape verbatim and change only what it emits.

**Type-only import block** (`tests/helpers/faux.ts:65-72`) — extend, do not add a second import statement:

```ts
import type {
	Context,
	FauxProviderHandle,
	Message,
	Model,
	Provider,
	StreamOptions,
} from "@earendil-works/pi-ai";
```

**The untyped options bag** (`:89-98`) — the new helper needs the same escape hatch:

```ts
/** Options as the wrapper sees them: a stream-options bag with unknown extras. */
type AnyStreamOptions = StreamOptions & Record<string, unknown>;
```

**The wrapper itself** (`:275-303`) — spread the inner provider, override BOTH
`stream` and `streamSimple`, delegate:

```ts
export function wrapFauxWithPayload(
	faux: FauxProviderHandle,
	buildPayload: FixturePayloadBuilder = buildOpenAiFixturePayload,
): Provider {
	const inner = faux.provider;

	// The emission is written out twice rather than factored into a helper.
	// Task acceptance greps this file for the call inside BOTH overrides, and a
	// duplicated four-line body is a cheaper price than an assertion that stops
	// matching the thing it checks.
	return {
		...inner,
		stream(model, context, options) {
			const bag = options as unknown as AnyStreamOptions | undefined;
			void bag?.onPayload?.(buildPayload(model, context, options), model);
			return inner.stream(model, context, options);
		},
		streamSimple(model, context, options) { /* identical body */ },
	};
}
```

**Contract to carry over, and one open decision.** `wrapFauxWithPayload`
deliberately ignores the callback's return value and says why in a comment. For
`wrapFauxWithStatus` the equivalent decision is RESEARCH Open Question 4: faux's
own hard-coded `onResponse({status: 200})` (`pi-ai src/providers/faux.ts:507`)
**still fires** after a pre-call. RESEARCH §3.1 already flags that a double fire
writes two `*.response` wire records under one correlation id. **Pick one —
pre-call or wrap-and-replace `onResponse` — and state the choice in the same
docstring style as `:281-284`.** Do not leave it implicit.

**Doc obligation:** `tests/unit/helpers.test.ts` is the standing guard for this
module. The new export needs a case there for the same reason `wrapFauxWithPayload` has one.

---

### `tests/helpers/models.ts` — `withModelsConfig()` (test helper, offline registry)

**Analog:** `tests/helpers/session.ts`. Everything needed already exists there —
the difference is that Phase 3 passes a real `modelsPath` where Phase 2 passed `null`.

**The construction to copy** (`tests/helpers/session.ts:246-264`):

```ts
const modelRuntime = await ModelRuntime.create({
	// The file need not exist; faux auth resolves empty.
	authPath: join(agentDir, "auth.json"),
	// null, not undefined: do NOT read the developer's ~/.pi/agent/models.json.
	modelsPath: null,
	// No catalogue refresh, so no network call at construction time.
	refreshOnCreate: false,
});
modelRuntime.registerNativeProvider(wrapFauxWithPayload(faux, opts.buildPayload));

const model = modelRuntime.getModel(faux.provider.id, first.id);
if (!model) {
	throw new Error(
		`createFauxSession: the faux model ... did not resolve after registerNativeProvider. ...`,
	);
}
```

Phase 3's version passes `modelsPath: <template path>` and `authPath: <temp
auth.json>`. **Keep `refreshOnCreate: false`** — it is what makes the helper
offline. **Keep the throwing guard**: an unresolved model must fail with the
remedy in the message, never return `undefined`.

**The `with*` lifecycle to copy** (`:301-318`) — async, awaits inside the `try`, disposes in the `finally`:

```ts
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

**Temp-dir safety to copy** (`:188-196` and `:211-212`) — only ever remove a path
this helper created with `mkdtempSync` under a `kypi-` prefix:

```ts
function removeQuietly(dir: string): void {
	try {
		// maxRetries is the Windows convention in this repo: file handles linger.
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	} catch {
		// A leftover temp dir is noise, not a failure. [threat T-02-01-05]
	}
}
```

**Do not re-declare** `ModelRuntime` in a comment inside `.pi/extensions/**` — see *Shared Patterns → Boundary lints*. Inside `tests/` it is unrestricted, which is why this helper belongs in `tests/helpers/` and not in an extension.

---

### `tests/helpers/loopback.ts` — `withLoopbackCompletions()` (test helper, HTTP capture)

**Analogs:** `tests/helpers/logs.ts:58-71` for the async disposable shape;
`tests/helpers/stub-bin.ts:173-217` for "stand up a throwaway thing, run the
callback, tear it down in a `finally`".

**The async `with*` skeleton** (`tests/helpers/logs.ts:58-71`) — note the docstring
explicitly contrasts itself with `withStubBin`, which is exactly the distinction
the loopback helper must also state (its server must outlive an awaited callback):

```ts
export async function withTempLogCwd<T>(fn: (cwd: string) => T | Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "kypi-logs-"));
	try {
		return await fn(dir);
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		} catch {
			// A leftover temp dir is noise, not a failure.
		}
	}
}
```

**The thenable guard NOT to copy** (`stub-bin.ts:205-211`) — it exists because
`withStubBin` is synchronous. The loopback helper is the async mirror; copying
the guard would break it. `session.ts:53-61` records that distinction as a rule.

**Trap T11 is a helper-level obligation, not a test-level one.** RESEARCH §3.2 requires
the helper to bind `127.0.0.1` and to assert the resolved `baseUrl` host is
`127.0.0.1` *before* the request is issued, so a copy-paste that reintroduces a
real host fails instead of egressing. Model the refusal on `stub-bin.ts:205-211`'s
loud `TypeError` with the remedy in the message.

**Zero-dependency constraint:** `node:http` only. `tests/unit/pinning.test.ts:253`
asserts `Object.keys(devDependencies)` equals exactly six audited pins, so no test
server package may be added.

---

### `tests/unit/template-tracked.test.ts` (unit, file-I/O) — Trap T1

**Analog:** `tests/unit/logs-gitignored.test.ts`, using `tests/helpers/git.ts`.
**Reuse the helper; never spawn `git` from the test file.**

**The oracle** (`tests/helpers/git.ts:82-106`) — both flags are load-bearing and
the `--no-index` lesson is written into the module docstring at `:19-31`:

```ts
export function isIgnored(path: string): boolean {
	const { status } = run(["check-ignore", "-q", "--no-index", "--", path], repoRoot());
	if (status !== 0 && status !== 1) {
		throw new Error(`git check-ignore returned unexpected exit code ${status} for ${path}`);
	}
	return status === 0;
}

export function trackedFiles(pattern = "."): string[] { /* git ls-files -- <pattern> */ }
```

**The live-oracle control** (`logs-gitignored.test.ts:74-83`) — mandatory, and it
inverts for this test: Phase 2 asserted a source file is NOT ignored; Phase 3 must
assert a known-ignored name IS ignored, so a broken `isIgnored` cannot make the
whole file vacuously green:

```ts
it("says a normal source file is NOT ignored (the oracle is live)", () => {
	// Without this, an `isIgnored` that returned true for everything -- a
	// broken git invocation, a wrong cwd, an exit code misread -- would make
	// every assertion in this file vacuously green.
	expect(isIgnored("README.md"), "...").toBe(false);
});
```

**Concrete targets, verified 2026-08-13 by executing `git check-ignore -v --no-index`:**

| path | verdict |
|---|---|
| `.pi/templates/auth-template.json` | committable ✅ |
| `.pi/templates/models-template.json` | committable ✅ |
| `.pi/templates/auth.json` | IGNORED — `.gitignore:46:auth.json` ← the `ARCHITECTURE.md` name |
| `.pi/templates/auth.example.json` | IGNORED — `.gitignore:47:auth.*.json` |

Assert **both directions**: the two shipped names are committable *and* tracked
(`trackedFiles`), and the two rejected names are ignored. Asserting only the
positive direction leaves the trap itself unasserted.

---

### `tests/unit/command-interpolation.test.ts` (unit, PROV-02)

Two halves with two different analogs.

**Half A — the mechanical scan.** Analog: `tests/unit/chokepoint-lint.test.ts`.
Copy the file-enumeration and, above all, the three vacuity guards.

Enumeration (`:158-164`) — reads from git's index, not the disk:

```ts
function extensionSources(): { path: string; text: string }[] {
	return trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
}
```

Guards (`:166-233`) — the scanned set asserted non-empty, and **every pattern proven
live against an inline offending fixture**:

```ts
it("finds at least one tracked extension source (guards against a vacuous pass)", () => {
	expect(sources.length, `no tracked .ts under ${EXT_DIR}/ — every assertion below scans this set, so an empty one turns the whole gate into a pass that verified nothing`).toBeGreaterThanOrEqual(1);
});

it("proves every forbidden pattern is live against an inline offending fixture", () => {
	const dead = FORBIDDEN.filter(({ pattern }) => !pattern.test(OFFENDING_FIXTURE)).map(...);
	expect(dead, "these patterns matched NOTHING in the synthetic offending source, so they are dead ...").toEqual([]);
});
```

The fixture is **inline** (`:146-156`) for a stated reason: a fixture file under
`.pi/extensions/` would be enumerated by the scan and fail the gate it exists to
prove. PROV-02's scan has the same property — a `models-template.json` fixture
carrying a `!command` must be inline or under `tests/fixtures/`, never in `.pi/templates/`.

Scan surfaces required by RESEARCH §Q1.2 / Trap T13: **both** `models-template.json`
values **and** any `registerProvider({ apiKey })` / header string under `.pi/extensions/**`.

**Half B — the cached-vs-uncached behavioural proof.** Analog:
`tests/helpers/stub-bin.ts`'s `logTo` counter (`:96-106`), which is how call
*count* and call *order* are proven elsewhere in this repo:

```ts
/**
 * Absolute path of a file the stub appends one line to per invocation, in
 * the form `<name> <argv joined by spaces>`.
 * ... The line is written BEFORE the response is chosen, so an invocation is
 * logged even when it falls through to the silent default.
 */
logTo?: string;
```

Used at `tests/integration/bootstrap-check-only.test.ts:285-291`:

```ts
const logged = readFileSync(log, "utf-8");
expect(logged, "the stubbed npm must be the npm the script consulted").toContain(
	"npm config get ignore-scripts",
);
```

Same idea here: a stub binary whose invocation log has **one** line after two
`auth.json` resolutions (cached) and **two** after two `models.json` resolutions
(uncached). Windows caveat from `stub-bin.ts:33-47` applies — a stub invoked by
code we do not control cannot be made to succeed on Windows. If Pi's
`executeCommand` spawns without a shell, prefer `node -e`-style resolution or
assert only the direction that is reachable, and say so in the docstring rather
than shipping a case that is green because it never ran.

---

### `tests/unit/dashscope-compat.test.ts`, `model-metadata.test.ts`, `bedrock-auth.test.ts`, `r1-unclamp.test.ts`

**Shared analog for the "table of record" shape:** `tests/unit/pinning.test.ts:95-102`
— the intended values live in one exported/`const` table, with the reason for each
number written beside it, and a companion case that forbids anything outside the table:

```ts
const REQUIRED_DEV_PINS: Record<string, string> = {
	"@earendil-works/pi-coding-agent": "0.84.1",
	...
};

it("declares no dev dependency beyond the six audited pins", () => {
	// Anything extra has not been through the Package Legitimacy Audit.
	expect(Object.keys(dev).sort()).toEqual(Object.keys(REQUIRED_DEV_PINS).sort());
});
```

Apply that shape to:
- **`dashscope-compat.test.ts`** — one `INTENDED_COMPAT` object per model, deep-equalled
  against the **composed** `model.compat` from a real runtime (Trap T6: never assert the
  template's bytes; typebox accepts `supportsStoore` silently).
- **`model-metadata.test.ts`** — the `COST_UNVERIFIED` allowlist is exactly this
  "nothing outside the table" case, plus the cross-provider invariant
  (`dashscope/deepseek-v4-flash.contextWindow === 393216` vs
  `deepseek/deepseek-v4-flash.contextWindow === 1000000`).

**The `detectCompat` regression canary** (PROV-03, third row of VALIDATION). Analog
posture: `tests/unit/version-gate.test.ts` — assert against the *installed* artifact,
and fail loudly rather than skipping. Verified on this machine 2026-08-13:
`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js` exists and contains
**no** `aliyuncs`. Read that file, assert the absence, and write the failure message so
a future Pi bump that *adds* the branch tells the reader to re-verify the explicit block
rather than to delete the test.

**`bedrock-auth.test.ts`** — drives `withModelsConfig()` from a unit test.
`getProviderAuth(providerId)` takes a provider id string, loads no model and prepares
no request (RESEARCH §3.3), so it belongs in `tests/unit/`. Assert
`source: "stored credential"` positively **and** `undefined` with the entry absent
(the negative control is the `logs-gitignored.test.ts:74-83` pattern again).

**`r1-unclamp.test.ts`** — pure, no session, no filesystem. Analog:
`tests/unit/prose-detector.test.ts` / `tests/unit/redact.test.ts`. The house split is
stated at `.pi/extensions/diagnostics/prose.ts:22-31`: the pure half is importable and
tested with no session at all; the effectful half lives in `index.ts` and needs one.

---

### `tests/integration/templates-install.test.ts` (integration, bootstrap installer)

**Analog:** `tests/integration/bootstrap-check-only.test.ts` — copy it almost wholesale.

**Subprocess runner** (`:76-100`) — `sh` with an args array and `shell: false`, forward-slash script path:

```ts
/** Forward slashes: Git Bash `sh` will not accept a backslash path argument. */
const BOOTSTRAP = join(repoRoot(), "bin", "bootstrap.sh").replace(/\\/g, "/");

function runBootstrap(args: string[], opts: {...}): Run {
	const env: Record<string, string> = {
		...(opts.env ?? (process.env as Record<string, string>)),
		PI_CODING_AGENT_DIR: opts.agentDir,
		...(opts.extraEnv ?? {}),
	};
	const result = spawnSync("sh", [BOOTSTRAP, ...args], { cwd: repoRoot(), env, encoding: "utf-8", timeout: TIMEOUT_MS, windowsHide: true });
	if (result.error) { throw new Error(`failed to run \`sh ${BOOTSTRAP} ...\`: ${result.error.message}`); }
	return { stdout: ..., stderr: ..., status: result.status };
}
```

**The npm stub** (`:141-151`) — four argv-conditional answers, plus `KYPI_SKIP_INSTALL=1`
as a second independent guard against touching the real global prefix:

```ts
function npmStub(logTo: string): StubSpec {
	return {
		exitCode: 0,
		logTo,
		match: [
			{ when: ["config", "get", "ignore-scripts"], stdout: "true\n" },
			{ when: ["view"], stdout: '"0.84.1"\n' },
			{ when: ["ls", "-g"], stdout: '{"dependencies":{}}\n' },
		],
	};
}
```

**Idempotence case** (`:244-306`) — the exact shape PROV-01/Trap T7 need. Note it
snapshots and restores the tracked file it mutates:

```ts
expect(
	second.settings,
	"a key-namespaced merge must produce a byte-identical file when the key " +
		"is already current -- anything else corrupts user config over time",
).toBe(first.settings);
```

**Three cases this phase must add on top of the analog** (RESEARCH §Q1.4, Trap T7):
1. temp `PI_CODING_AGENT_DIR` + `KYPI_SKIP_INSTALL=1` → both files merged;
2. second run → byte-identical;
3. **a pre-existing `auth.json` holding a foreign provider key → untouched.** This is
   the one that matters; clobbering it is the worst outcome in the phase.

Also add the PROV-01 half: `getProviderAuth("dashscope").auth.apiKey ===
process.env.DASHSCOPE_API_KEY` via `withModelsConfig()`, and a secret-shape scan over
both templates (borrow `TOKEN_SHAPED` from `tests/unit/docs-policy.test.ts:184`).

---

### `tests/integration/dashscope-payload.test.ts` (integration, loopback capture)

**Analog:** `tests/integration/wire-capture.test.ts` — one fixture run in `beforeAll`,
several cases over the same capture, and a non-empty assertion **before** any content assertion.

**One run, many cases** (`:95-158`):

```ts
async function captureOnePrompt(): Promise<Capture> { /* ... */ }

let capture: Capture;
describe("DIAG-01 / DIAG-07 — the wire dump of one live turn", () => {
	beforeAll(async () => { capture = await captureOnePrompt(); });
```

**The mandatory ordering of assertions** (`:160-181`) — this is the single most
important pattern in the phase, because the naive version of this test is
vacuously green:

```ts
expect(
	capture.rows.length,
	"the wire log holds zero records, so no capture hook ran at all and EVERY assertion " +
		"below is vacuous. ...",
).toBeGreaterThan(0);
```

**The paired positive** (`:276-288`) — a negative assertion needs a positive twin or
an empty/blank capture passes it:

```ts
it("case 4 — the paired positive: real content survived the redactor", () => {
	// Without this, an empty, truncated or all-placeholder file satisfies case
	// 3 perfectly while destroying the instrument's entire value.
```

Apply directly: asserting `store` / `developer` / `strict` / `prompt_cache_*` are
**absent** from the loopback body is worthless unless `enable_thinking`,
`reasoning_effort` and `max_tokens` are asserted **present** in the same case.

**What this file must copy from `wire-capture.test.ts`'s docstring** (`:1-39`): the
"WHAT THIS FILE IS, AND WHAT IT IS NOT" section naming `RB-03-01` / `RB-03-02` and
stating that proving what Pi *emits* says nothing about what DashScope *accepts*.

---

### `tests/integration/sso-classifier.test.ts` (integration, `message_end`)

**Analog:** `tests/integration/prose-retry.test.ts` — the only existing test that drives
a `message_end` handler on a live in-memory session and asserts on `faux.state.callCount`.

**Imports and session shape** (`:79-101`):

```ts
import type { AssistantMessage, Context, FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { withFauxSession } from "../helpers/session.ts";

/** Absolute path of the diagnostics extension this repository ships. */
const EXTENSION_ENTRY = `${repoRoot()}/.pi/extensions/diagnostics/index.ts`;
```

Point `EXTENSION_ENTRY` at `.pi/extensions/providers/index.ts` instead. The user-scope
shim requirement is unchanged and is stated at `session.ts:146-161`: project-scoped
`.pi/extensions` is gated behind project trust, which resolves `false` headless.

**Capture shape carrying `callCount`** (`prose-retry.test.ts:158-178`):

```ts
interface Capture {
	rows: Row[];
	unparseable: string[];
	callCount: number;
	pending: number;
	activeTools: string[];
	outgoing: Context[];
	logText: string;
}
```

**Trap T3 is already the house rule here.** `prose-retry.test.ts:22-28` records
`callCount = 2` as the executed observation turned into a standing assertion. PROV-05's
mirror is `faux.state.callCount === 1` — non-retryable proven by attempts, never by
reading the classifier.

**The fixture-discipline docstring section** (`:65-77`) transfers directly: the six SSO
strings are fixtures this repo wrote, so the file must say so and point at `RB-03-03`,
whose expected output folds in the only live check of whether a real expiry produces a
string the matcher recognises.

**Trap T4 assertion:** RESEARCH §Q4.4 requires `isRetryableAssistantError(rewritten) === false`
for **all six** fixtures, in addition to the message text. Table-drive it the way
`pinning.test.ts:280-290` drives its `PINNED`/`UNPINNED` arrays.

---

### `tests/integration/fallback-chain.test.ts` (integration, nested calls)

**Analog:** `tests/integration/call-model.test.ts`.

**How the live `ExtensionContext` is obtained** (`:88-121`) — copy this whole mechanism;
constructing a context by hand tests a shape, not Pi:

```ts
/** Where the probe parks the live `ExtensionContext`. See the header. */
const CTX_KEY = "__kypiCallModelExtensionContext";

const PROBE_SOURCE = [
	"// Generated for tests/integration/call-model.test.ts. Lives in a temp dir.",
	`import diagnostics from ${JSON.stringify(DIAGNOSTICS_ENTRY)};`,
	'const HOOKS = ["session_start", "before_agent_start", "before_provider_headers"];',
	"export default function (pi) {",
	"\tdiagnostics(pi);",
	"\tfor (const hook of HOOKS) {",
	"\t\tpi.on(hook, (_event, ctx) => {",
	`\t\t\tglobalThis[${JSON.stringify(CTX_KEY)}] = ctx;`,
	"\t\t});",
	"\t}",
	"}",
].join("\n");
```

Two facts that file records and this one inherits: `session_start` does **not** fire in a
headless `createAgentSession` (`:36-47`), so a warm-up prompt is required; and jiti gives
the loaded extension its own module registry, so `globalThis` is the only shared channel.

**The negative-control-first discipline** (`:5-19`) — port it: assert that a chain entry
whose class is `fatal` produced `callCount === 0` on the second provider *in the same
session where a retryable class demonstrably advanced*. Without the paired control, an
implementation that never advances satisfies every positive assertion.

**Per-provider `callCount`:** the chain has two providers, so the test needs two faux
handles (or two `wrapFauxWithStatus` wrappers) registered under different provider ids,
and asserts `state.callCount` on each. `faux.state.callCount++` is the first statement of
`stream()` (RESEARCH §3.1), so it counts attempts, which is exactly the signal PROV-08 needs.

---

### `.pi/extensions/providers/index.ts` (extension entry point, event-driven)

**Analogs:** `.pi/extensions/diagnostics/index.ts` (registration + `message_end` +
`safeHandler`) and `.pi/extensions/harness/index.ts` (a small, complete entry point).

**Entry-point shape** (`harness/index.ts:68-98`) — `export default function (pi: ExtensionAPI): void`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("ky-hello", { description: "...", handler: async (_args, ctx) => { ... } });
	pi.registerProvider(SELFTEST_PROVIDER_ID, { ... });
}
```

**Registration + failure containment** (`diagnostics/index.ts:432-446`):

```ts
export default function (pi: ExtensionAPI): void {
	pi.on(
		"session_start",
		safeHandler<SessionStartEvent>("session_start", (_event, ctx) => { ... }),
	);
```

**`safeHandler` itself** (`:379-430`) — **copy or import it.** Its reason for existing is
stated at `:87-93`: Pi catches every exception thrown by an extension handler and routes it
to `emitError`, which produces no visible output, so an unwrapped handler that dies looks
identical to a quiet one. Two contract details that bind Phase 3 directly:

```ts
// `null` is coerced to `undefined` ...
// the runner replaces on anything that is not `undefined`:
//     const handlerResult = await handler(event, ctx);
//     if (handlerResult !== undefined) { currentPayload = handlerResult; }
return (result ?? undefined) as R | undefined;
```

For a `message_end` handler a non-`undefined` return is a **message replacement**, so the
coercion is load-bearing: a `?? null` typo in the classifier would hand Pi a `null` message.

**The `message_end` handler to model on** (`:484-497`) — role check first, always:

```ts
pi.on(
	"message_end",
	safeHandler<MessageEndEvent>("message_end", (event, ctx) => {
		// `message_end` fires for user and toolResult messages too
		// [pi 0.84.1 dist/core/extensions/types.d.ts:573], so the role check is
		// what keeps a tool result from overwriting the turn's real message.
		if (event.message.role !== "assistant") {
			return;
		}
```

**And the replacement contract, written out at `:570-582`** — diagnostics deliberately
returns nothing; Phase 3's classifier is the first handler in this repo that legitimately
*does* replace, so it must satisfy both stated rules: the replacement keeps `role: "assistant"`,
and it is a **complete** message (the runner deletes every key of the target and
`Object.assign`s the replacement, `agent-session.ts:710-724`) — a patch would erase
`content` and `usage`.

```ts
// A returned `{ message }` REPLACES the finalized message, and the
// replacement must keep the original role
// [VERIFIED: pi 0.84.1 src/core/extensions/types.ts:1097-1100]; the
// runner applies it by deleting every key on the live object and
// `Object.assign`-ing the replacement onto it (`agent-session.ts:710-724`)
```

**Exported literals, never retyped in a test** (`harness/index.ts:50-59`, restated at
`diagnostics/index.ts:126-132`):

```ts
/**
 * The sentinel string every load-path assertion greps for.
 *
 * Exported so tests import it instead of duplicating a literal — a duplicated
 * literal is how an assertion silently stops matching the thing it checks.
 */
export const SELFTEST_MODEL_ID = "ky-harness-selftest";
```

The `aws sso login --profile ` prefix, the SSO pattern list and the chain table must all
be exported constants (or live in a `schema.ts` sibling) for this reason.

**Why a NEW directory rather than adding to `diagnostics/`:**
`tests/unit/diagnostics-entry.test.ts` asserts the exact hook count and the single command
registered by `diagnostics/index.ts` (`index.ts:9-16`). Adding a ninth hook there is a
deliberate edit of that test. A `providers/` directory keeps Phase 2's instrument sealed and
keeps the `.pi/extensions/<dir>/index.ts` auto-discovery shape
(`tests/unit/extension-layout.test.ts:56-67`).

---

### `.pi/extensions/providers/sso.ts` (pure predicate module)

**Analog:** `.pi/extensions/diagnostics/prose.ts` — near-identical in kind: a pure,
importable classifier over untrusted provider text, with the effect living in `index.ts`.

**The pure/effectful split, stated at `prose.ts:22-31`:**

```
 * Why it is a predicate and not a handler
 * The effect — `sendUserMessage(..., { deliverAs: "followUp" })` from inside
 * `message_end`, capped at one retry per agent run — lives in `index.ts` ...
 * The interesting half needs none of those, so it is here, pure and importable,
 * and `tests/unit/prose-detector.test.ts` proves it with no session at all.
```

**Bounded matching over untrusted text** (`:96-144`) — the SSO patterns run over provider
error strings and inherit this rule:

```ts
/** Longest run of whitespace tolerated between the name, the paren and the brace. */
const MAX_GAP = 8;

export function escapeRegExpLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

// Counted quantifiers, not `\s*`, and no `.` anywhere: ReDoS on a megabyte
// of model output would take the instrument down (threat T-02-04-01).
```

**No `g` flag** (`:130-135`) — `redact.ts`'s patterns carry `g` and therefore a persistent
`lastIndex`, which makes `.test()` lie on every other call. The SSO patterns are used
through `.test()` in a loop and must be stateless.

**Purity note to copy** (`:89-92`): no value imports, no I/O, no dependency — the pinning
gate fails the build if a package is added.

**Phase-3-specific constraint from RESEARCH §Q4.4:** the pattern set must deliberately
exclude anything that also matches Pi's `RETRYABLE_PROVIDER_ERROR_PATTERN`, so the rewrite
can only ever move a message retryable → non-retryable, never the reverse. Write that as a
comment above the table, in the `prose.ts` "the false positive that matters" style (`:64-76`).

---

### `.pi/extensions/providers/fallback.ts` (`callWithFallback`, request-response)

**Analog:** `.pi/extensions/diagnostics/call-model.ts:365-496`.

**Cross-phase contract shape** (`:174-212`) — copy the interface style, including the
mandatory-and-undefaulted field with its reason:

```ts
export interface CallModelOptions<TApi extends Api> {
	/**
	 * The executor this call runs as: `"advisor"`, `"reviewer"`, `"summariser"`, …
	 * MANDATORY, and deliberately not defaulted. See the join-key paragraph ...
	 */
	role: string;
	model: Model<TApi>;
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
	api?: WithoutCaptures<ModelsApiStreamOptions<TApi>>;
	signal?: AbortSignal;
}
```

`callWithFallback(ctx, opts)` takes the same options **minus `model`** (the chain supplies
it) and must forward `role` and `signal` unchanged.

**Branch on `stopReason`, not on `catch`** — `call-model.ts:233-256` documents at source
why a rejection almost never happens:

```
 * HOW OFTEN THIS FIRES, STATED HONESTLY: on Pi 0.84.1, almost never ...
 *   - an adapter-surfaced failure ends the event stream with an `error` event,
 *     and `result()` resolves with that message
 *   - a SETUP failure — unknown provider, unresolved auth ... is caught by
 *     `lazyStream`, which pushes `createSetupErrorMessage(...)`
```

and `:475-479` records that `callModel` **rethrows** a registry-facade rejection because
"the caller — not this function — owns the fallback decision". `callWithFallback` **is**
that caller: keep the `try/catch` as well as the `stopReason` branch.

**Model resolution:** `ctx.modelRegistry.find(provider, id)` is explicitly **not** banned by
the chokepoint lint (`chokepoint-lint.test.ts:99-104`) — "the line drawn here is 'reaches a
model', not 'mentions the registry'". Assumption A7 requires the chain test to assert every
entry resolves, or a renamed DashScope id silently skips the hop.

**⚠ Boundary lint, load-bearing for this file — see Shared Patterns below.** This module
lives outside `.pi/extensions/diagnostics/`, so it may not spell `modelRegistry.complete`,
`ModelRuntime`, `getRegisteredNativeProvider`, `modelRegistry.getProvider` or
`@earendil-works/pi-ai/api/` **even in a comment**. Note `getProviderAuth` is safe: the
banned pattern is `\bmodelRegistry\s*(?:\?\.|\.)\s*getProvider\b`, and the trailing `A`
defeats the `\b`. `harness/index.ts:36` shows the sanctioned dodge — describe the call in
prose ("the tool-registration call") rather than naming it.

---

### `.pi/templates/models-template.json` and `auth-template.json` (config templates)

**Analog:** `.pi/templates/env.example` — the only existing shipped template.

**Header convention** (`env.example:1-9`) — a template states what it is, who copies it, and
that it holds no values:

```
# ky-pi-agent — environment variable NAMES only.
#
# bin/bootstrap.sh copies the marked region below into <repo>/.env.example.
# Re-running bootstrap replaces only what is between the markers, so hand-added
# lines outside them survive.
#
# There are no values here and there never will be. Real credentials are
# Phase 3's concern and belong in ~/.pi/agent/auth.json ... never in this repo — it is public.
```

**Managed markers** (`:11-16`) — the only region bootstrap owns:

```
# ky-pi-agent managed:start
DASHSCOPE_API_KEY=
DEEPSEEK_API_KEY=
AWS_PROFILE=
QODER_PERSONAL_ACCESS_TOKEN=
# ky-pi-agent managed:end
```

`KYPI_DASHSCOPE_BASE_URL=` goes **inside** these markers (RESEARCH §Q5.6). Note the header
paragraph above is now discharged by this phase and should be updated rather than left saying
"Phase 3's concern".

**JSON template specifics:** `models.json` accepts `//` comments
(`stripJsonComments`, `model-config.ts:261`), so every sourced or UNVERIFIED number carries its
citation in-file — the same discipline `schema.ts:73-108` applies to its constants
("Every number carries its arithmetic"). The literal blocks are already written in
`03-RESEARCH.md:190-257`; copy them, do not re-derive.

**Filename is a hard constraint, not a preference:** `auth-template.json` — verified
committable; `auth.json` / `auth.example.json` — verified swallowed by `.gitignore:46-47`.

---

### `bin/bootstrap.sh` — `merge_models_json` / `merge_auth_json` (installer)

**Analog:** the same file. Two functions already do exactly this shape.

**Key-namespaced merge with refusal on invalid JSON** (`:437-474`) — the model for `merge_models_json`:

```sh
# Key-namespaced merge: read, parse, replace only the kyPiAgent key, write back.
# Never a whole-file rewrite - this file also holds the user's installed-package
# list and their own settings ...
merge_settings() {
	mkdir -p "$PI_AGENT_DIR"
	KYPI_SETTINGS="$PI_AGENT_DIR/settings.json" \
		... \
		node -e '
const fs = require("node:fs");
const p = process.env.KYPI_SETTINGS;
let raw = "{}";
if (fs.existsSync(p)) { raw = fs.readFileSync(p, "utf8").trim() || "{}"; }
let obj;
try { obj = JSON.parse(raw); } catch (e) {
  console.error("FATAL: " + p + " is not valid JSON (" + e.message + "). Refusing to touch it.");
  process.exit(1);
}
if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
  console.error("FATAL: " + p + " is not a JSON object. Refusing to touch it.");
  process.exit(1);
}
...
if (JSON.stringify(obj.kyPiAgent) === JSON.stringify(next)) {
  console.log("  settings.json kyPiAgent already current - unchanged");
  process.exit(0);
}
obj.kyPiAgent = next;
fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
'
}
```

Note the three properties to preserve verbatim: **refuse invalid JSON**, **replace only our
own key**, **print "already current - unchanged" and exit 0 on a no-op** (that is what makes
the byte-identity test possible).

**Env-var-passing convention:** every value crosses into `node -e` through `KYPI_*`
environment variables, never through shell interpolation into the JS source. `$KYPI_DASHSCOPE_BASE_URL`
substitution must follow the same route.

**Merge-if-absent template copy** (`:479-519`, `write_env_template`) — the model for
`merge_auth_json`, whose whole contract is "write a provider key only when absent":

```sh
_src="$REPO_ROOT/.pi/templates/env.example"
if [ ! -f "$_src" ]; then
	printf 'FATAL: missing template %s\n' "$_src" >&2
	exit 1
fi
```

**Ordering** (`:584-613`) — the BOOT-01 clause is structural and must not be disturbed. Both
new merges go in `run_full` **after** `install_pi`, beside `merge_settings` / `write_env_template`,
and in **neither** `--assert-hardening` nor `--check-only` (`--check-only` mutates nothing —
`bootstrap-check-only.test.ts:218-242` asserts exactly that):

```sh
	printf 'Pi install:\n'
	install_pi
	printf 'Configuration:\n'
	merge_settings
	write_env_template
```

**Style rules from the header** (`:20-33`): strict POSIX `sh` — no arrays, no `local`, no
`[[`, no bash-4 expansions; no external JSON processor, all JSON through `node -e`; never a
stream editor on JSON; never PowerShell; LF endings (`.gitattributes`).
`tests/unit/lf-and-shell.test.ts` is the standing guard.

**Do not touch `sanitise_npm_env`** (`:132-156`) — it is an npm-config control and has nothing
to do with the new merges. Its refusal-over-guess posture is, however, the right model for how
`merge_auth_json` should behave on anything unexpected.

**Usage text** (`:525-555`) — new environment seams (`KYPI_DASHSCOPE_BASE_URL`) go in the
`Environment:` block, or the runbook will reference a flag `--help` never mentions.

---

### `docs/RUNBOOK.md` — `RB-03-01` … `RB-03-05`

**Analog:** the file's own Phase 2 section (lines 190–385). **Append; never recreate.**

**The four-part entry contract** (`:8-24`) — restated here because every new entry is graded against it:

```
1. the **exact command**, copy-pasteable, with no placeholder to guess at;
2. the **expected output**, specific enough that "it seemed fine" is not an
   acceptable result;
3. the **offline proxy** — the test in this repo that verifies as much of the
   behaviour as can be verified without the missing thing ...
4. a **status line**, which is either `OUTSTANDING` or a date-stamped
   `PASSED — YYYY-MM-DD`.
```

**Section skeleton** (`:190-212`) — an intro paragraph, then the summary table, then one
`###` subsection per id:

```markdown
## Phase 2 — Diagnostics — The Instrument

... `tests/unit/docs-policy.test.ts` guards these statuses exactly as it guards the
Phase 1 ones ...

| ID | Check | Status |
|----|-------|--------|
| RB-02-01 | DIAG-01 — one real turn per provider produces a wire dump ... | OUTSTANDING |

### RB-02-01 — DIAG-01: one real turn per provider produces a wire dump ...

**Status:** OUTSTANDING

**Why this cannot be done here.** ...
**Procedure, on the work laptop:** ...
**Expected output.** ...
**Offline proxy:** `tests/integration/wire-capture.test.ts` — ... It proves the
instrument works. It says nothing about what a real provider payload looks like,
which is the only thing this entry is about.
```

**The "Closed door — do not re-litigate" subsection** (`:76-80` and `:288-298`) — the
convention for recording a settled negative so it is not re-derived:

```markdown
**Closed door — do not re-litigate.** A Bedrock SigV4 signature can never appear
in one of these dumps, so do not write a version of this check that looks for
one and do not treat its absence as evidence of anything. ...
```

Phase 3 has at least three closed doors to record in this form: `after_provider_response`
cannot see a provider error (Trap T2); the built-in `qwen-token-plan` provider is a different
product with a different key namespace (decision 7); and Trap T10 — do **not** add a
Phase 3 SigV4 check (RB-02-02 already owns it).

**Cross-references rather than restatements** (`:159-162`) — the `0600`-on-Windows note already
exists in the Phase 1 machine-state section; decision 10 says reference it, do not restate it.

**Machine-state notes section** (`:155-186`) — the model for the extra prose RESEARCH lists with
no id of its own (region/workspace key scoping, `aws sso login … && echo $AWS_PROFILE`,
`KYPI_DASHSCOPE_BASE_URL` remedy).

---

### `tests/unit/docs-policy.test.ts` (modify)

**Analog:** itself — Phase 2 already performed this exact extension, and the file's docstring
(`:27-35`) is a warning written for Phase 3:

```
 * THE GUARD SPANS BOTH PHASES. It was written in Phase 1 against a literal
 * `RB-01-\d{2}`, which meant appending Phase 2's entries would have left three
 * new statuses completely unguarded ... The id pattern is now `RB-<phase>-<n>`
 * and {@link ALL_IDS} drives Group B and Group C, so a future phase adds its ids
 * to one array and inherits the whole guard.
```

**The four edits, each with its line:**

1. Add `PHASE_THREE_IDS` beside `:53` / `:62`, and extend `ALL_IDS` at `:65`:
```ts
const PHASE_TWO_IDS = ["RB-02-01", "RB-02-02", "RB-02-03"] as const;
/** Every governed entry, in phase order. A later phase appends its array here. */
const ALL_IDS = [...PHASE_ONE_IDS, ...PHASE_TWO_IDS] as const;
```
2. Add five `ENTRY_COMMANDS` entries at `:228-269`. Note the recorded lesson at `:237-262`:
   fragments were **not** enough for RB-02-03 because the fragment survived in the prose
   after being deleted from the command — pin whole one-line commands where the command sits
   on one line of a numbered list.
3. Add an `RB-03-01` fixture pair mirroring `FIXTURE_PHASE_TWO` / `FIXTURE_PHASE_TWO_HALF_FLIPPED`
   (`:387-407`), for the reason stated there: a generalisation exercised only by the real file
   is a generalisation nobody has tested.
4. Nothing else. `ID_RE` (`:74`), `runbookEntryStatuses` (`:94-109`) and Group C's loop
   (`:475-493`) already generalise.

**Group B's proxy-path scan** (`:309-325`) asserts every `tests/**/*.test.ts` path named in the
runbook exists on disk, and requires at least `ALL_IDS.length` of them — so the five RB-03
entries must each cite a test that will actually exist when the runbook lands. Order the plans
so the proxies precede the runbook, or this goes red.

---

## Shared Patterns

### 1. Module docstring: purpose, lifetime, verified citations
**Source:** `.pi/extensions/diagnostics/index.ts:1-94`, `call-model.ts:1-110`, `tests/helpers/session.ts:1-61`
**Apply to:** every new `.ts` file in this phase.

Every file opens with a `/** … */` block carrying, in this order: what the file is,
**why it exists** (the failure it prevents), the traps or counter-intuitive facts, and the
scope caveat stated rather than overclaimed. Claims carry `[VERIFIED: <pkg> <ver> <file>:<lines>]`,
`[CITED: <doc>:<line>]` or `[VERIFIED: executed <date>]`. Threats are tagged `[threat T-xx-yy-zz]`
and requirements inline as `DIAG-03` / `PROV-05`. Section rules are `---------------------------------------------------------------------------`.

```
 * ---------------------------------------------------------------------------
 * SCOPE CAVEAT, STATED RATHER THAN OVERCLAIMED
 * ---------------------------------------------------------------------------
 * The build gate is a regex over committed text. These routes reach a model
 * without passing through this function and the gate cannot close them: ...
```

### 2. The vacuous-pass guard — assert the set is non-empty BEFORE looping
**Source:** `tests/helpers/faux.ts:30-38`, `chokepoint-lint.test.ts:41-50`, `wire-capture.test.ts:160-167`, `logs-gitignored.test.ts:107-112`
**Apply to:** every new test file without exception.

```ts
expect(
	relativePaths.length,
	"the writer reported producing no paths at all. Every assertion below iterates this list, " +
		"so an empty one turns the reality check into a pass that verified nothing — assert it " +
		"non-empty before looping, never after",
).toBeGreaterThan(0);
```

Phase 1 shipped two vacuous passes (`check-ignore` without `--no-index`; an npm probe that
read its launcher's environment) and Phase 2 shipped one (`fauxProvider` never calls
`onPayload`). Phase 3's own equivalents are already named: `faux` cannot vary HTTP status,
and `.gitignore` swallows `auth.json`.

### 3. Throw, never skip
**Source:** `tests/helpers/pi.ts:11-16`, `tests/helpers/session.ts:43-51`; recorded at `.planning/STATE.md:97`
**Apply to:** `tests/helpers/models.ts`, `tests/helpers/loopback.ts`, and every new test helper.

```ts
throw new Error([
	`The \`pi\` binary is not usable on PATH (${detail}).`,
	"",
	"This test verifies Pi's real extension-discovery behaviour and MUST NOT be",
	"skipped -- a skipped load-path test is a vacuous pass. Install Pi with:",
	"",
	"  npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.1",
].join("\n"));
```

There is deliberately no skip escape hatch anywhere in `tests/helpers/`; an auditor grepping
for one must find nothing. Every failure message carries the remedy.

### 4. Assertion messages are the documentation
**Source:** every test file; canonical examples `pinning.test.ts:147-149`, `docs-policy.test.ts:481-490`
**Apply to:** all new tests.

Every non-trivial `expect` takes a second argument explaining what breaks in the real world
if the assertion fails — long, specific, and addressed to the person who will read the failure.

### 5. Boundary lints that constrain where Phase 3 code may live and what it may say
**Sources:** `tests/unit/chokepoint-lint.test.ts:106-135`, `tests/unit/contributing-boundary.test.ts`, `tests/unit/extension-layout.test.ts:53-97`, `tests/unit/pinning.test.ts:253`
**Apply to:** `.pi/extensions/providers/**` and any new dependency.

| Lint | Rule | Effect on Phase 3 |
|---|---|---|
| DIAG-03 chokepoint (`chokepoint-lint.test.ts`) | Outside `.pi/extensions/diagnostics/`, these substrings are a build failure **in comments too**: `modelRegistry.complete`, `.completeSimple`, `.stream`/`.streamSimple`, `modelRegistry.getProvider\b`, `getRegisteredNativeProvider`, `from "@earendil-works/pi-ai/api/`, `ModelRuntime` | `fallback.ts` must call `callModel`, and must describe rather than name the banned calls. `modelRegistry.find` and `getProviderAuth` are safe. |
| BOOT-10 (`contributing-boundary.test.ts`) | the tool-registration call name may not appear anywhere under `.pi/extensions/`, comments included | `providers/index.ts` registers hooks (and at most a command) only; do not spell that call even in prose — `harness/index.ts:36` shows the dodge |
| extension layout | `.pi/extensions/<dir>/index.ts` is the only entry-point shape; siblings must carry **no** `export default` | `sso.ts` / `fallback.ts` / `schema.ts` export named functions only |
| pinning | `devDependencies` must equal exactly the six audited pins | no new package, ever — loopback server is `node:http` |

### 6. `git` is the only ignore/tracking oracle
**Source:** `tests/helpers/git.ts:1-37`
**Apply to:** `template-tracked.test.ts`, and any new path-policy assertion.

Never parse `.gitignore`. Use `isIgnored()` (which already carries `-q` **and** `--no-index`)
and `trackedFiles()`. The `--no-index` omission was one of Phase 1's two vacuous passes and
is documented with the executed evidence at `git.ts:19-31`.

### 7. Constants live in one module and are imported, never retyped
**Source:** `.pi/extensions/harness/index.ts:50-56`, `.pi/extensions/diagnostics/schema.ts:1-24`
**Apply to:** SSO patterns, the `aws sso login --profile ` prefix, the chain table, the error-class names, the `COST_UNVERIFIED` allowlist.

```ts
/**
 * PURPOSE. One place for every constant that appears in both the writer and an
 * assertion. The house rule ... is that a duplicated literal is how an assertion
 * silently stops matching the thing it checks, so nothing below may be re-typed
 * in a test: import it.
 */
```

Every constant carries its arithmetic or its source (`schema.ts:77-108`).

### 8. Windows / POSIX portability
**Sources:** `bin/bootstrap.sh:20-33`, `tests/helpers/stub-bin.ts:20-47`, `tests/helpers/pi.ts:21-35`, `tests/helpers/win-quote.ts`
**Apply to:** anything spawning a process or handling a path.

- Script paths for `sh` get `.replace(/\\/g, "/")` (`bootstrap-check-only.test.ts:48`).
- `sh` and `git` spawn with `shell: false` and an args array; `npm`/`pi` need `shell: true` on
  Windows (CVE-2024-27980), and then arguments go through `quoteForWindows` folded into one
  command string.
- `rmSync(..., { maxRetries: 3 })` — the repo's Windows convention; handles linger.
- Repo-relative paths are normalised with `sep` or `.split("\\").join("/")`
  (`wire-capture.test.ts:143-145`), never a hardcoded separator.

### 9. `[RUNBOOK]` honesty — the offline test names what it does not prove
**Sources:** `wire-capture.test.ts:1-20`, `prose-retry.test.ts:1-19`, `extension-layout.test.ts:1-15`
**Apply to:** `dashscope-payload.test.ts`, `sso-classifier.test.ts`, `bedrock-auth.test.ts`, `model-metadata.test.ts`.

Every offline proxy for a `[RUNBOOK]` requirement opens with a paragraph naming its RB id,
stating it is a proxy, and saying what it says nothing about. Trap T12 forbids marking
PROV-03/04/07/10 as passing on the strength of a green offline half.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (checkbox → `[~]`, R1 row annotation) | planning artifact | — | GSD-managed documents, not code. Follow the existing in-file conventions; no code analog applies. |
| A `docs/PROVIDERS.md` reference doc, **if** the planner decides to add one | documentation | — | Not required by RESEARCH — the RB-03 entries plus in-file `//` comments carry the contract. If one is added anyway, `docs/DIAGNOSTICS.md:1-24` is the analog: schema-of-record framing, `[VERIFIED:]`/`[CITED:]` citations, and the explicit "if the code and this document disagree, the code is authoritative" clause. Note it would then be pulled into `docs-policy.test.ts`'s Group D-style drift guard, which is extra scope. |

Nothing else in this phase lacks an analog. In particular, the two things that *look* novel
both have close in-repo precedent: the loopback HTTP server is the async-disposable-fixture
pattern from `logs.ts`/`stub-bin.ts` with `node:http` inside, and the `message_end` message
replacement is the path `diagnostics/index.ts:570-582` documents in full precisely because it
declined to take it.

---

## Metadata

**Analog search scope:** `tests/{helpers,unit,integration,fixtures}/`, `.pi/extensions/{diagnostics,harness}/`, `.pi/templates/`, `bin/`, `scripts/`, `docs/`, `package.json`, `vitest.config.ts`, `.gitignore`, `.planning/STATE.md`
**Files scanned:** 43 tracked test/source files enumerated; 18 read in full or in targeted ranges
**Executed during mapping (read-only):** `git check-ignore -v --no-index` over four candidate template filenames (confirms Trap T1 in both directions); `grep aliyuncs node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js` (confirms the PROV-03 canary is feasible and currently green)
**Pattern extraction date:** 2026-08-13
