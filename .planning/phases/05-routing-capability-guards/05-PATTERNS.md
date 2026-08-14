# Phase 5: Routing & Capability Guards - Pattern Map

**Mapped:** 2026-08-14
**Files analyzed:** 15 (10 new source/test files + 5 files requiring edits)
**Analogs found:** 15 / 15

This repo has three complete, shipped analog subsystems from Phases 2-4. Phase 5 must look like them, not invent a new house style. `safety/policy.ts` + `safety/index.ts` are the single closest analog pair for the whole `routing/` extension (a pure-predicate module + a thin registration entry point that builds facts from `ctx` and calls it). `diagnostics/call-model.ts` and `providers/fallback.ts` are contracts to **consume**, never re-implement. Every enforcement test (`chokepoint-lint`, `extension-layout`, `contributing-boundary`, `docs-policy`) is quoted below with the exact rule `routing/` must satisfy.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `.pi/extensions/routing/index.ts` | extension entry point (commands + `session_start` hook) | request-response | `.pi/extensions/safety/index.ts` (entry-point shape); `.pi/extensions/harness/index.ts` (minimal command registration) | exact (role) |
| `.pi/extensions/routing/modes.ts` | service module (role→model table, mode state) | CRUD (in-memory) + config-write | `.pi/extensions/providers/schema.ts` (module-level config constant, e.g. `CHAIN`) | role-match |
| `.pi/extensions/routing/guard.ts` | pure predicate module | transform (predicate over `Model<Api>`) | `.pi/extensions/safety/policy.ts` (`evaluate()` pure decision function) | exact |
| `.pi/extensions/routing/agent-overrides.ts` (or a named export inside `modes.ts`) | config read-modify-write helper | file I/O | `bin/bootstrap.sh#merge_settings` (bash+node idiom, not a TS file — port the idiom, not the code) | role-match (cross-language) |
| `.pi/extensions/qoder/index.ts` (or `routing/qoder.ts` per ARCHITECTURE sketch — planner's discretion, decision 12 favors physical separation) | tool (foreign-agent delegate) | streaming (SSE) + request-response | `.pi/extensions/safety/index.ts#registerApprovalTool` (the one precedent for a registered, non-wrapper tool with a `Type.Object` schema and `execute(toolCallId, params, signal, onUpdate, ctx)`) | role-match |
| `tests/unit/routing-map.test.ts` | unit test | pure-table assertions | `tests/unit/model-metadata.test.ts`, `tests/unit/r1-unclamp.test.ts` | role-match |
| `tests/integration/mode-switch.test.ts` | integration test | session-driven | `tests/integration/fallback-chain.test.ts` (uses `withFauxSession`) | role-match |
| `tests/integration/escalate.test.ts` | integration test | session-driven | same as above | role-match |
| `tests/integration/single-shot-roles.test.ts` | integration test | session-driven, nested-call assertion | `tests/integration/call-model.test.ts` (already asserts `ctx.model` unchanged + nested `turns` row) | exact |
| `tests/unit/agent-overrides.test.ts` | unit test | file I/O assertion | none exact; closest is `tests/unit/npmrc-policy.test.ts` / bootstrap merge-shape tests (validate-then-write JSON pattern) | partial |
| `tests/unit/capability-guard.test.ts` | unit test | pure predicate fixture table | `tests/unit/policy-compose.test.ts` (fixture-table test over a pure `evaluate()`-shaped function) | exact |
| `tests/integration/mode-persistence.test.ts` | integration test | session entries + wire capture | `tests/integration/wire-capture.test.ts`, `tests/integration/turns-log.test.ts` | role-match |
| `tests/integration/wire-proof.test.ts` | integration test | JSONL readback | `tests/integration/call-model.test.ts` + `tests/helpers/logs.ts#readTornSafe` | exact |
| `tests/integration/qoder-delegate.test.ts` | integration test | loopback HTTP+SSE fixture | `tests/helpers/loopback.ts` + `tests/integration/dashscope-payload.test.ts` (loopback-driven wire proof) | role-match |
| `docs/RUNBOOK.md` (append `RB-05-01`) | docs | append-only | RB-04-01 section (tail of file, quoted below) | exact |
| `docs/ROUTING.md` | docs | new file | `docs/DIAGNOSTICS.md`, `docs/SAFETY.md` | role-match |
| `tests/unit/docs-policy.test.ts` (edit: add `PHASE_FIVE_IDS`, `ENTRY_COMMANDS["RB-05-01"]`) | test edit | append array + map entry | `PHASE_FOUR_IDS` / `ENTRY_COMMANDS["RB-04-01"]` additions | exact |
| `package.json` (`pi.extensions`) | manifest | — | **no edit needed** — `"./.pi/extensions"` already covers a new `routing/` subdirectory (verified, `tests/unit/manifest.test.ts` + `extension-layout.test.ts`) | n/a |

## Pattern Assignments

### `.pi/extensions/routing/index.ts` (extension entry point)

**Analog:** `.pi/extensions/safety/index.ts` (structure), `.pi/extensions/harness/index.ts` (minimal command shape)

**Why this analog:** `safety/index.ts` is the only existing file in this repo that (a) is a directory-nested `index.ts` entry point, (b) composes several sibling pure modules, (c) builds an impure `facts`/context object from `ctx` at the boundary and hands it to a pure module, and (d) registers both commands-equivalent (its tool) and an event hook. `routing/index.ts` needs the same shape: commands (`/cheap`, `/balanced`, `/max`, `/escalate`), a `session_start` restore hook, and (if colocated) the Qoder tool registration — composing `modes.ts` + `guard.ts`.

**Entry-point default-export shape** (`harness/index.ts:68`):
```typescript
export default function (pi: ExtensionAPI): void {
	pi.registerCommand("ky-hello", {
		description: "ky-pi-agent liveness check",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`ky-pi-agent loaded (sentinel: ${SELFTEST_MODEL_ID})`, "info");
		},
	});
}
```

**Command handler with `ExtensionCommandContext`, pre-flight checks, and explicit failure handling** (composited from RESEARCH's own verified pattern, `05-RESEARCH.md` lines 605-628 — copy this shape directly, it is already vetted against the chokepoint-lint and against decision 9):
```typescript
pi.registerCommand("balanced", {
	description: "Switch the role->model map to balanced",
	handler: async (_args, ctx) => {
		await ctx.waitForIdle();                                    // ROUTE-02: command-only surface
		const target = ctx.modelRegistry.find("dashscope", "deepseek-v4-pro"); // sanctioned lookup
		if (!target) { ctx.ui.notify("balanced mode's executor model is not configured", "error"); return; }
		const guard = guardRoute(target, "executor", {});
		if (!guard.ok) { ctx.ui.notify(guard.reason, "error"); return; }
		if (!ctx.modelRegistry.hasConfiguredAuth(target)) {          // sanctioned, synchronous pre-flight
			ctx.ui.notify(`No API key configured for ${target.provider}/${target.id}`, "error");
			return;
		}
		let switched: boolean;
		try { switched = await pi.setModel(target); }
		catch (err) { ctx.ui.notify(`setModel threw: ${String(err)}`, "error"); return; }
		if (!switched) { ctx.ui.notify(`setModel returned false for ${target.provider}/${target.id}`, "error"); return; }
		pi.appendEntry("ky:mode", { mode: "balanced", at: Date.now() }); // narrow: mode name only
	},
});
```

**`session_start` restore hook, mirroring `safety/index.ts`'s own best-effort pruning hook** (`safety/index.ts:832-838`):
```typescript
pi.on("session_start", async (_event, ctx) => {
	try {
		pruneAuditLogs(ctx.cwd);
	} catch {
		// Swallowed deliberately -- see the comment above.
	}
});
```
For routing, the equivalent is the `ky:mode` restore recipe from `05-RESEARCH.md` §B.5 (`pi.on("session_start", (_event, ctx) => { const branch = ctx.sessionManager.getBranch(); ... })`) — same defensive-try/catch posture, since a restore failure must not stop the session from starting.

**File header docstring convention** (every entry point in this repo carries a PURPOSE / LIFETIME / BOUNDARY RULE / LAYOUT structured docstring — see `safety/index.ts:1-99` and `diagnostics/index.ts:1-94` in full). `routing/index.ts` should carry the same sections: PURPOSE (three-mechanism routing), the THREE-MECHANISMS decision restated, BOUNDARY RULE (BOOT-10 — routing itself registers no tool unless the Qoder tool is colocated here, in which case name the (a)/(b)/(c) justification directly beside the `TOOL_REGISTRATION_ALLOWLIST` addition), LAYOUT (what `modes.ts`/`guard.ts` each own).

---

### `.pi/extensions/routing/guard.ts` (pure predicate module)

**Analog:** `.pi/extensions/safety/policy.ts`

**Why this analog:** `policy.ts` is this repo's only existing "pure predicate over structured input, composed from sub-classifiers, deny-by-default, never throws" module — exactly the shape ROUTE-06/07/08 need. Its `Verdict` union (`allow` / `confirm` / `block`) is a direct structural precedent for a `GuardVerdict = { ok: true } | { ok: false; reason: string }` type. Its **purity discipline** (no `ctx`, no `process.env`, no `node:fs`, no default export — facts supplied by the caller) is the exact discipline `guard.ts` must follow so `tests/unit/capability-guard.test.ts` can be a millisecond fixture table exactly like `tests/unit/policy-compose.test.ts`.

**Purity discipline, quoted verbatim from the analog's own docstring** (`safety/policy.ts:138-145`):
```
PURITY (matches shell.ts / paths.ts' pure half / git.ts / infra.ts)
No `ctx`, no `process.env`, no `node:fs`, no default export. The only
impure fact this module ever asks for ... is supplied by the CALLER ...
never read directly ... This is what lets tests/unit/policy-compose.test.ts
be a millisecond fixture table exactly like every sibling module's own test file.
```

**Deny-by-default exhaustiveness pattern to copy** (`safety/policy.ts:290-310`, the `fromInfraVerdict` switch — routing's own switch over `GuardVerdict`-producing sub-checks should end the same way):
```typescript
function fromInfraVerdict(verdict: InfraVerdict, requestKey: string): Verdict {
	switch (verdict.kind) {
		case "not-applicable":
		case "allow":
			return { kind: "allow" };
		case "confirm":
			return { kind: "confirm", reason: verdict.reason, requestKey };
		case "sensitive-read":
			return { kind: "block", reason: verdict.reason };
		default: {
			const exhaustive: never = verdict;   // COMPILE ERROR on an unhandled case, never silent fallthrough
			return exhaustive;
		}
	}
}
```

**The guard's own worked-out shape, already vetted in RESEARCH (`05-RESEARCH.md` lines 567-603) — copy directly:**
```typescript
import type { Api, Model } from "@earendil-works/pi-ai";

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

const NO_TOOL_CALLING_MODEL_IDS = ["deepseek.r1-v1:0", "us.deepseek.r1-v1:0"];

// isAnthropicClaudeModel re-implemented -- not importable from pi-ai's public API (RESEARCH Part B.1)
function isAnthropicClaudeModel(model: Model<Api>): boolean {
	const id = model.id.toLowerCase();
	const name = (model.name ?? "").toLowerCase();
	return id.includes("anthropic.claude") || id.includes("anthropic/claude") ||
	       name.includes("anthropic.claude") || name.includes("anthropic/claude") ||
	       name.includes("claude");
}

export function guardRoute(
	model: Model<Api>,
	role: string,
	need: { image?: boolean; estimatedInputTokens?: number; thinkingRequested?: boolean },
): GuardVerdict {
	if (need.image && !model.input.includes("image")) {
		return { ok: false, reason: `${model.provider}/${model.id} is text-only (input=${JSON.stringify(model.input)}); the ${role} role needs image input` };
	}
	if (need.estimatedInputTokens !== undefined && need.estimatedInputTokens > model.contextWindow) {
		return { ok: false, reason: `${model.provider}/${model.id} has a ${model.contextWindow}-token window; the request needs ~${need.estimatedInputTokens}` };
	}
	if (model.provider === "amazon-bedrock" && model.reasoning && !isAnthropicClaudeModel(model) && need.thinkingRequested) {
		return { ok: false, reason: `${model.provider}/${model.id} silently drops thinking configuration on non-Claude Bedrock models (buildAdditionalModelRequestFields returns undefined)` };
	}
	if (role === "executor" && NO_TOOL_CALLING_MODEL_IDS.some((id) => model.id.toLowerCase().includes(id))) {
		return { ok: false, reason: `${model.provider}/${model.id} supports no tool calling at all; cannot serve as executor` };
	}
	return { ok: true };
}
```

**Error containment, if `guard.ts` composes sub-checks the way `policy.ts#evaluate` does** — copy the try/catch-converts-to-block shape (`safety/policy.ts:623-657`), never let a classifier's exception propagate as "nothing to block".

---

### `.pi/extensions/routing/modes.ts` (role→model map + mode/escalate state)

**Analog:** `.pi/extensions/providers/schema.ts` (module-level `CHAIN` constant pattern) + `.pi/extensions/providers/fallback.ts` (consumption contract)

**Why this analog:** `providers/schema.ts` is this repo's precedent for "a module-level, `readonly`, not-parametrized-by-caller constant table" (`CHAIN: readonly ChainEntry[]`), which is exactly the shape of a `MODES` / role→model table. `fallback.ts` is not something `modes.ts` copies structurally — it is something `modes.ts` **imports and calls**.

**`callWithFallback` consumption contract, exact** (`.pi/extensions/providers/fallback.ts`, cited in full at `05-RESEARCH.md` A.4):
```typescript
export type CallWithFallbackOptions = Omit<CallModelOptions<Api>, "model">;
export async function callWithFallback(
	ctx: ExtensionContext,
	opts: CallWithFallbackOptions,
): Promise<AssistantMessage>
export function classifyFailure(errorText: string): FailureClass  // "quota"|"transient"|"unavailable"|"fatal"
```
Call it exactly like `callModel(ctx, {role, model, ...})` minus `model` — the chain supplies it. `CHAIN` is fixed (`deepseek-direct → dashscope`); it is not parametrized by mode. A role pinned to Bedrock (e.g. `vision`) calls `callModel()` directly instead, since `CHAIN` has no Bedrock hop.

**`callModel()` chokepoint signature `modes.ts` must import and call for every single-shot role** (`.pi/extensions/diagnostics/call-model.ts:92-95, 182-212`):
```typescript
export async function callModel<TApi extends Api>(
	ctx: ExtensionContext,
	opts: CallModelOptions<TApi>,
): Promise<AssistantMessage>

export interface CallModelOptions<TApi extends Api> {
	role: string;              // MANDATORY, never defaulted -- the join key
	model: Model<TApi>;
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
	api?: WithoutCaptures<ModelsApiStreamOptions<TApi>>;  // reasoningEffort goes here
	signal?: AbortSignal;       // defaults to ctx.signal
}
```
Never call `ctx.modelRegistry.complete()`/`.completeSimple()`/`.stream()`/`.streamSimple()`/`.getProvider()` from `modes.ts` or anywhere in `routing/` — see the chokepoint-lint enforcement excerpt below.

**Mode-name persistence recipe** (from `05-RESEARCH.md` §B.5, already vetted against Pi's `session-manager.d.ts`):
```typescript
appendEntry<T = unknown>(customType: string, data?: T): void;   // pi.appendEntry, ExtensionAPI member

pi.on("session_start", (_event, ctx) => {
	const branch = ctx.sessionManager.getBranch();               // root-to-leaf order
	const modeEntries = branch.filter(
		(e): e is CustomEntry<KyModeData> => e.type === "custom" && e.customType === "ky:mode",
	);
	const latest = modeEntries.at(-1);                            // last write wins
	if (latest?.data) { /* restore mode name + escalation flag into module state */ }
});
```
Do **not** re-implement executor-model restoration — Pi's own `model_change` session entry already does that natively (`05-RESEARCH.md` §B.4). `modes.ts` persists only the mode *name* and the `/escalate` sticky flag.

---

### `.pi/extensions/routing/agent-overrides.ts` (or a named export in `modes.ts`) — `settings.subagents.agentOverrides` write

**Analog:** `bin/bootstrap.sh#merge_settings` (lines 494-527, quoted in full above) — a bash-launched Node one-liner, not a TypeScript module, but it is the **only existing settings.json read-modify-write idiom in this repository** and RESEARCH explicitly says to port its pattern (`05-RESEARCH.md` Pitfall 3 / Don't-Hand-Roll table). Port the validation shape, not the code:

```javascript
// bin/bootstrap.sh's merge_settings, the pattern to port into TypeScript:
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
// ... replace ONLY the owned key (bootstrap.sh replaces obj.kyPiAgent; routing replaces obj.subagents.agentOverrides) ...
if (JSON.stringify(obj.kyPiAgent) === JSON.stringify(next)) { /* unchanged -- no write */ }
obj.kyPiAgent = next;
fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
```
**The three load-bearing properties to preserve exactly:** (1) refuse-on-invalid-JSON rather than truncate/coerce, (2) refuse-on-non-object rather than silently overwrite, (3) replace **only the owned key**, never a whole-file rewrite (the same "byte-idempotent" no-op-on-unchanged discipline `merge_settings` itself documents at `bin/bootstrap.sh:337-344`).

**Open assumption the plan must pin (not resolved by this pattern map):** which `settings.json` — global `getAgentDir()/settings.json` (exported per `dist/index.d.ts:2`) or project-scoped, git-tracked `.pi/settings.json`. See RESEARCH Assumptions Log A1. No existing code writes `subagents.agentOverrides` today; this is genuinely new, not a refactor.

**`agentOverrides` shape to write** (ARCHITECTURE-documented, forward-compatible best guess per RESEARCH Open Question 2): `{ "<agentName>": { "model": "<provider>/<id>" } }` under `settings.subagents.agentOverrides`.

---

### `.pi/extensions/qoder/index.ts` (or `routing/qoder.ts`) — Qoder delegate tool

**Analog:** `.pi/extensions/safety/index.ts#registerApprovalTool` (`safety/index.ts:432-577`) — the **only** precedent in this repo for a registered tool that is not a wrapper over a Pi built-in, with a `typebox` `Type.Object` parameter schema, a five-argument `execute(toolCallId, params, signal, onUpdate, ctx)` shape, and a description carrying a first-class user-facing caveat.

**Tool registration shape to copy** (`safety/index.ts:488-497`, trimmed):
```typescript
function registerQoderDelegateTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "qoder_delegate",
		label: "delegate to Qoder (foreign agent)",
		description:
			"Delegates a task to Qoder's own hosted agent loop -- a FOREIGN AGENT, not a Pi tool call. " +
			"Bypasses this harness's tools, AGENTS.md, safety hooks and wire inspector entirely. " +
			// ... the C.5 bypass paragraph, verbatim, per decision 12 ...
		parameters: qoderDelegateSchema,   // Type.Object from unscoped typebox, StringEnum for any enum field
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			// fail actionably if QODER_PERSONAL_ACCESS_TOKEN / QODER_AGENT_ID / QODER_ENVIRONMENT_ID unset
			// POST /sessions -> POST /sessions/{id}/events -> GET .../events/stream (SSE)
			// redactDeep/redactString at capture, per DIAG-07's own pattern
		},
	});
}
```

**typebox schema convention, exact — `StringEnum` not `Type.Union`/`Type.Literal`** (`safety/index.ts:102-105, 446-462`):
```typescript
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const qoderDelegateSchema = Type.Object({
	task: Type.String({ description: "The task to delegate to Qoder's hosted agent." }),
	// any enum-shaped field: StringEnum([...] as const, { description: "..." }) -- NEVER Type.Union/Type.Literal,
	// which CLAUDE.md's "What NOT to Use" documents as broken against Google's API.
});
```

**Redaction reuse, not a second rule** (`.pi/extensions/diagnostics/redact.ts`, exports `redactString`, `redactDeep`, `redactHeaders`, `REDACTED_HEADER_KEY_RE`, `TRUNCATION_PLACEHOLDER`) — import and call these on any Qoder transcript before writing it, per decision 12 and RESEARCH's security-domain table (V2/V13).

**JSONL transcript writer, shared library not `diagnostics/`'s own copy** — `.pi/lib/jsonl.ts` (verified present, exports `logDir`, `logPath`, `rotate`, `appendJsonl(cwd, base, record, opts)`, `pruneLogs`) is the underlying library `diagnostics/jsonl.ts` itself re-exports from (`.pi/extensions/diagnostics/jsonl.ts:65-73`, `export const logDir = libLogDir;` etc.). The Qoder tool should import directly from `.pi/lib/jsonl.ts` (mirroring how `diagnostics/jsonl.ts` wraps it) rather than importing through `diagnostics/`, keeping `routing`/`qoder` decoupled from `diagnostics/` internals while still reusing the exact append/rotate/prune mechanics. Write to a path under `.pi/logs/` — already gitignored (`.gitignore:23,79` — `logs/` and `.pi/logs/`).

**BOOT-10 allowlist requirement — this is a build-failing gate, not optional:**
```typescript
// tests/unit/contributing-boundary.test.ts:113
const TOOL_REGISTRATION_ALLOWLIST: readonly string[] = [".pi/extensions/safety/index.ts"];
```
Whichever file calls `pi.registerTool(...)` for the Qoder delegate **must be added to this array in the same commit**, with an (a)/(b)/(c) justification comment beside it, following the exact worked example already in the file (`contributing-boundary.test.ts:80-112`, quoted in full above): (a) why the model must call it mid-turn, not the user; (b) the **measured** (not estimated) schema byte/token cost, using the same `Math.ceil(bytes/4)` estimator `diagnostics/budget.ts:223-224` already establishes as this project's only sanctioned token-cost arithmetic; (c) why a skill cannot carry it (a skill has no mechanism to perform a validated HTTP round-trip with a bearer credential).

**Five-argument `execute` shape confirmed present in this codebase already** (`safety/index.ts:497`, `execute(_toolCallId, params, _signal, _onUpdate, ctx)`) — the Qoder tool should use the `onUpdate` parameter (unused by `safety/index.ts` but part of the same signature) to surface `agent.thinking` SSE events as tool-call progress, per RESEARCH C.3's parsing recipe.

---

### `tests/unit/capability-guard.test.ts` (ROUTE-06/07/08)

**Analog:** `tests/unit/policy-compose.test.ts` — a fixture-table test over a pure `evaluate()`-shaped function, exactly the harness `guard.ts` needs. Also extend, do not duplicate, `tests/unit/model-metadata.test.ts` and `tests/unit/r1-unclamp.test.ts` (RESEARCH's own instruction, `05-RESEARCH.md` line 91).

**Model fixture source** — `tests/helpers/models.ts#withModelsConfig` gives the "honest oracle" composed `Model<Api>` object (not merely the template file's literal JSON):
```typescript
export interface ModelsConfigOptions { /* ... */ }
export interface ModelsConfigHandle { /* ... requireModel(provider, id): Model<Api> ... */ }
export async function withModelsConfig<T>(/* opts, fn */): Promise<T>
```
Use `handle.requireModel("dashscope", "deepseek-v4-flash")` and a hand-built Bedrock-shaped `Model<Api>` fixture (both DashScope daily-driver models are text-only per RESEARCH A.6 — the guard's image-block test needs a Bedrock or synthetic `input:["text","image"]` fixture too) for ROUTE-06's positive case.

---

### `tests/integration/single-shot-roles.test.ts` (ROUTE-04)

**Analog:** `tests/integration/call-model.test.ts` — this file already asserts `ctx.model` is unchanged after a nested `callModel()` invocation and that exactly one `kind:"nested"` `turns-*.jsonl` row is written. `single-shot-roles.test.ts` is a routing-scoped extension of the identical assertion shape: drive `modes.ts`'s single-shot-role dispatcher (which itself calls `callModel`/`callWithFallback`), then assert the same two invariants.

**Wire/turns reader helpers to use** (`tests/helpers/logs.ts`):
```typescript
export async function withTempLogCwd<T>(fn: (cwd: string) => T | Promise<T>): Promise<T>
export function logFilesIn(dir: string): string[]
export function readJsonl(path: string): unknown[]        // throws on malformed line
export interface TornSafeResult { /* records, unparseable */ }
export function readTornSafe(path: string): TornSafeResult // never throws
```

---

### `tests/integration/mode-switch.test.ts`, `escalate.test.ts`, `mode-persistence.test.ts`, `wire-proof.test.ts` (ROUTE-02/03/09/10)

**Analog:** `tests/helpers/session.ts#withFauxSession` + `tests/helpers/faux.ts#wrapFauxWithPayload` — the combination `tests/integration/fallback-chain.test.ts`, `wire-capture.test.ts` and `turns-log.test.ts` already use to drive a real `createAgentSession` with a faux provider and read back the resulting JSONL.

**Session helper signatures**:
```typescript
export interface FauxSessionOptions { /* ... */ }
export interface FauxSessionHandle { /* cwd, ... */ }
export function writeUserScopeShim(agentDir: string, name: string, targetAbsPath: string): string
export async function createFauxSession(/* opts */): Promise<FauxSessionHandle>
export async function withFauxSession<T>(/* opts, fn */): Promise<T>
```
**Mandatory: load the extension under test at USER SCOPE** — project-scoped `.pi/extensions` requires trust, which resolves `false` headless (RESEARCH A.8). `writeUserScopeShim` is exactly the mechanism.

**Outgoing-payload capture, the mechanism ROUTE-09/10 need** (`tests/helpers/faux.ts`):
```typescript
export type FixturePayloadBuilder = (/* model, context, options */) => Record<string, unknown>
export function wrapFauxWithPayload(faux, buildPayload?): Provider   // onPayload(buildPayload(...), model) before delegating
export function buildOpenAiFixturePayload(/* ... */): Record<string, unknown>
export function buildBedrockFixturePayload(/* ... */): Record<string, unknown>
```
Use `wrapFauxWithPayload` to capture the outgoing request and assert the `ky:mode` entry's payload appears in **no** captured request (ROUTE-09's "zero context tokens" claim) — never assert only that `appendEntry` was called (RESEARCH explicitly names this as the wrong, vacuous assertion).

**Pitfall 1 to avoid, stated exactly as RESEARCH found it** (`05-RESEARCH.md` line 642-646): main-loop `turns-*.jsonl` rows always carry `role: "session"` (the `SESSION_TURN_ROLE` constant from `diagnostics/index.ts:143`), **never** `"executor"`. Prove the executor path by `TurnRow.model`/`provider` on the next `kind:"turn"` row after the mode switch, never by filtering on `role`.

---

### `tests/integration/qoder-delegate.test.ts` (ROUTE-11 FAUX half)

**Analog:** `tests/helpers/loopback.ts#withLoopbackCompletions` (structure and discipline to copy — Qoder's SSE envelope is `id:`/`event:`/`data:` blank-line-terminated frames, not OpenAI-completions SSE chunks, so a **new**, small loopback-style helper is needed, not a reuse of `defaultSseBody` — RESEARCH A.8 says this explicitly). Also draw on `tests/integration/dashscope-payload.test.ts` for the "assert on what the real client actually sent to loopback" pattern.

**Loopback discipline to copy verbatim** (`tests/helpers/loopback.ts:59-71`, `assertLoopbackUrl` pattern):
```typescript
// Enforced HERE, not at the call site -- assertLoopbackUrl throws before the
// baseUrl is handed to anybody, so a copy-paste that reintroduces a real host
// fails loudly instead of quietly issuing a live request from CI.
// The literal "127.0.0.1" is written out TWICE (bind + assertion), never
// shared through one constant -- two independent literals cannot agree by accident.
```
Apply this exact discipline to any Qoder loopback helper: hard-fail if the delegate tool's configured base URL is not `127.0.0.1`.

---

### `docs/RUNBOOK.md` — append `RB-05-01`

**Analog:** `RB-04-01`'s worked example, the literal tail of the file (quoted in full above from this repo). Copy the **exact four-part structure**: summary-table row, `###` heading containing the id, `**Status:**` line, "Why this cannot be done here" / "Procedure, on the work laptop" / "Expected output" / "Offline proxy" sections.

**Exact summary-table row format**:
```
| RB-05-01 | Qoder delegates a task and folds the result back through the Cloud Agents API | OUTSTANDING |
```

**Exact section-header + status format** (must literally contain the id in the heading; `**Status:**` line must agree with the table row or `docs-policy.test.ts` reports `INCONSISTENT`):
```
### RB-05-01 — Qoder delegates a task and folds the result back

**Status:** OUTSTANDING
```

**Offline-proxy line must name a real, existing test path** (matched by `docs-policy.test.ts`'s `PROXY_PATH_RE = /tests\/[A-Za-z0-9._\-/]+\.test\.ts/g`):
```
**Offline proxy:** `tests/integration/qoder-delegate.test.ts` — ...
```

---

### `tests/unit/docs-policy.test.ts` — required edit, same commit as the RUNBOOK append

**Analog:** the `PHASE_FOUR_IDS` / `ENTRY_COMMANDS["RB-04-01"]` additions, quoted in full above from this file.

**Exact pattern to extend** (`tests/unit/docs-policy.test.ts:93-96`):
```typescript
const PHASE_FOUR_IDS = ["RB-04-01"] as const;

// ADD:
const PHASE_FIVE_IDS = ["RB-05-01"] as const;

const ALL_IDS = [...PHASE_ONE_IDS, ...PHASE_TWO_IDS, ...PHASE_THREE_IDS, ...PHASE_FOUR_IDS, ...PHASE_FIVE_IDS] as const;
```

**And add a whole-command-line entry to `ENTRY_COMMANDS`** (`tests/unit/docs-policy.test.ts:259-372`), following the `RB-04-01` shape (whole command lines, never fragments — the file's own comment at line 263-280 states fragment pins caused a false-green in Phase 2 and the discipline since is whole-line pins):
```typescript
"RB-05-01": [
	// whichever commands the actual RB-05-01 procedure names, pinned in full
],
```
**A missing `PHASE_FIVE_IDS` entry is a real gap** — `docs-policy.test.ts`'s own "governs every entry" test (lines 430-459) fails the build if `docs/RUNBOOK.md` declares an id (`RB-05-01`) with no owning phase array.

## Shared Patterns

### Chokepoint-lint — the exact rule `routing/**/*.ts` must obey

**Source:** `tests/unit/chokepoint-lint.test.ts:52-280` (fully quoted in `05-RESEARCH.md` A.3)
**Apply to:** every file under `.pi/extensions/routing/` (and `.pi/extensions/qoder/` if a separate directory)

Scanned set: every tracked `.ts` under `.pi/extensions/`, **except** `.pi/extensions/diagnostics/`. A new `routing/` directory gets **no exemption**.

Forbidden regexes (matched against raw source text, **comments included**):
```
\bmodelRegistry\s*(?:\?\.|\.)\s*complete\b
\bmodelRegistry\s*(?:\?\.|\.)\s*completeSimple\b
\bmodelRegistry\s*(?:\?\.|\.)\s*(?:stream|streamSimple)\b
\bmodelRegistry\s*(?:\?\.|\.)\s*getProvider\b
getRegisteredNativeProvider
from\s+["']@earendil-works/pi-ai/api/
\bModelRuntime\b
```
**Explicitly permitted** (line 99-104): `modelRegistry.find`, `.getAvailable`, `.getAll`, `.hasConfiguredAuth`, `.getProviderAuthStatus`, `.registerProvider` — the test's own docstring names this exact set as needed by "Phase 5's capability guard". Any nested single-shot call in `modes.ts` MUST go through `callModel()` (from `../diagnostics/call-model.ts`) or `callWithFallback()` (from `../providers/fallback.ts`) — routing never gets a second chokepoint.

### Extension layout — where files may live

**Source:** `tests/unit/extension-layout.test.ts` (fully quoted above)
**Apply to:** every new file under `.pi/extensions/`

Only `.pi/extensions/<name>.ts` (flat) or `.pi/extensions/<dir>/index.ts` (nested) may carry `export default function(pi) {...}`. Any sibling module with **no** default export must sit under `.pi/extensions/<dir>/...`, never at the flat top level (that collides with the flat entry-point shape and is a build-failing offense — `it("has every imported module inside an extension directory")`). `guard.ts`/`modes.ts`/`agent-overrides.ts` must all carry **named exports only**, no default export. `package.json#pi.extensions` is already `["./.pi/extensions"]` (a literal directory) — **no manifest edit needed** for a new `routing/` subdirectory.

### BOOT-10 tool-registration boundary

**Source:** `tests/unit/contributing-boundary.test.ts` (fully quoted above)
**Apply to:** whichever file registers the Qoder delegate tool

`RULE_PATTERN = /default.*command or skill/i`, matched against `CONTRIBUTING.md`. `TOOL_REGISTRATION = "registerTool"` matched as a **plain substring** across every tracked `.ts`/`.js` under `.pi/extensions/` — so no file outside the allowlist may even name the call in a comment. Current allowlist: `[".pi/extensions/safety/index.ts"]`. The Qoder tool's file must be added, in the same commit, with the (a)/(b)/(c) justification written beside it (worked example quoted in full above).

### docs-policy RB-entry contract

**Source:** `tests/unit/docs-policy.test.ts` (Group B/C, described above and in `05-RESEARCH.md` A.7)
**Apply to:** `docs/RUNBOOK.md`'s `RB-05-01` append and the corresponding `docs-policy.test.ts` edit

Both the summary-table row's Status cell and the section's `**Status:**` line must say `OUTSTANDING`, and must agree — a disagreement is reported as `INCONSISTENT`, not merely "unexpected", and fails the build. The offline-proxy test path named in prose must exist on disk (`docs-policy.test.ts:412-428`, matched by `PROXY_PATH_RE`).

### Redaction — one rule, reused

**Source:** `.pi/extensions/diagnostics/redact.ts` (`redactString`, `redactDeep`, `redactHeaders`, `REDACTED_HEADER_KEY_RE`, `TRUNCATION_PLACEHOLDER`)
**Apply to:** the Qoder delegate tool's transcript capture

Per decision 12 and RESEARCH's own instruction ("reuse `diagnostics/redact.ts` at capture rather than inventing a second redaction rule"): import these functions directly rather than writing a second PAT-redaction regex.

### Structured docstring convention (project house style)

**Source:** every `index.ts`/`policy.ts`/`call-model.ts`/`fallback.ts` in this repo
**Apply to:** every new file in `routing/`/`qoder/`

Every substantial module in this codebase opens with a structured comment: PURPOSE, an explicit statement of WHY a design choice was made (not just what), a BOUNDARY RULE section referencing the exact `contributing-boundary.test.ts` mechanism when relevant, and a LAYOUT section naming sibling files and which requirement each serves. This is not optional flavor — several of these docstrings are directly load-bearing (e.g. `chokepoint-lint.test.ts` deliberately does not scan comments out, so a routing file's own docstring must not casually mention `modelRegistry.complete` in prose either).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `tests/unit/agent-overrides.test.ts` | unit test | file I/O validation | No prior TypeScript-side settings.json read-modify-write exists in this repo (`bin/bootstrap.sh#merge_settings` is bash+node, not a TS module under test by vitest) — this is genuinely new mechanism, only the *validation shape* has a precedent |
| Qoder SSE parser (inside the delegate tool) | transform | streaming | No prior SSE parser exists in this repo's extension code (`tests/helpers/loopback.ts` builds OpenAI-completions-shaped SSE chunks for provider-side testing, not a client-side parser of a foreign `id:`/`event:`/`data:` envelope) — RESEARCH already specifies the hand-rolled ~20-line parsing recipe (C.3) to follow since no analog or package is warranted |

## Metadata

**Analog search scope:** `.pi/extensions/{diagnostics,safety,providers,harness}/`, `tests/{unit,integration}/`, `tests/helpers/`, `bin/bootstrap.sh`, `docs/RUNBOOK.md`, `package.json`
**Files scanned:** ~30 (full reads of `safety/policy.ts`, `safety/index.ts`, `diagnostics/index.ts`, `diagnostics/call-model.ts`, `providers/fallback.ts`, `extension-layout.test.ts`, `contributing-boundary.test.ts`, `manifest.test.ts`, `docs-policy.test.ts` [partial, targeted], `chokepoint-lint.test.ts` [partial], `diagnostics/redact.ts` + `.pi/lib/jsonl.ts` export lists, `tests/helpers/{session,models,faux,logs,loopback}.ts` signatures, `bin/bootstrap.sh#merge_settings`, `docs/RUNBOOK.md` tail, `harness/index.ts` command registration, `diagnostics/budget.ts` command registration)
**Pattern extraction date:** 2026-08-14
