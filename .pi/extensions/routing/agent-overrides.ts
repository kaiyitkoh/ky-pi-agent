/**
 * ky-pi-agent — `settings.subagents.agentOverrides` derivation and write (ROUTE-05).
 *
 * ---------------------------------------------------------------------------
 * PURPOSE
 * ---------------------------------------------------------------------------
 * ROADMAP criterion 1 says a mode swap swaps the WHOLE role→model map. A
 * subagent defaults to inheriting the parent session's model (ARCHITECTURE:
 * 400), so a mode switch that changes only `ctx.model` (the executor) and
 * leaves the planner subagent on its old pin has swapped half the map — the
 * exact "degrading silently" failure this phase exists to forbid. This
 * module derives the override object from the SAME `ROLE_MAP` the session
 * itself uses (`./schema.ts`, plan 05-01) and performs a validated
 * read-modify-write against a real settings.json file, refusing rather than
 * coercing when the file is not something safe to touch.
 *
 * ---------------------------------------------------------------------------
 * DECISION TAKEN HERE (resolves 05-RESEARCH.md Assumption A1 — the standing
 * policy: the user is asleep, this is not deferred and not asked)
 * ---------------------------------------------------------------------------
 * THE WRITE TARGET IS THE GLOBAL AGENT SETTINGS FILE:
 * `join(getAgentDir(), "settings.json")` — never the project-scoped,
 * git-tracked `.pi/settings.json`. Three reasons:
 *
 *   1. `.pi/settings.json` is tracked in this PUBLIC repository at `{}`
 *      (`git ls-files .pi/settings.json` confirms it). A project-scoped write
 *      would dirty the working tree on every `/cheap`/`/balanced`/`/max` —
 *      session state has no business appearing in `git status`.
 *   2. `bin/bootstrap.sh#merge_settings` (lines 494-527) already established
 *      `$PI_AGENT_DIR/settings.json` — the same file `getAgentDir()` resolves
 *      — as this project's settings write target. One location beats two.
 *   3. SAFE-11 already established that subagent-visible configuration
 *      belongs at USER scope: subagents spawn headless and never grant
 *      project trust, so a project-scoped write would be invisible to the
 *      very process meant to read it.
 *
 * `getAgentDir` is exported from `@earendil-works/pi-coding-agent`
 * (`dist/index.d.ts:2`) and honours `PI_CODING_AGENT_DIR`
 * [VERIFIED: pi 0.84.1 `dist/config.d.ts:68,76`], which is exactly what makes
 * {@link resolveSettingsPath}'s default branch testable against a temp
 * directory rather than this machine's real agent dir.
 *
 * ---------------------------------------------------------------------------
 * THE GUARD CALL IS LOAD-BEARING, NOT DECORATION
 * ---------------------------------------------------------------------------
 * The executor path (`./modes.ts`, ROUTE-02/03) and the single-shot path
 * (`./modes.ts`'s `runSingleShotRole`, ROUTE-04) both run
 * resolve → pick-candidate → guard → dispatch. Without a guard call here, the
 * subagent mechanism would be the ONE route that writes a model pin without a
 * capability check — so a future `ROLE_MAP` edit pinning a subagent role to a
 * model with no tool calling at all (ROUTE-08 — a subagent role is a
 * tool-loop role by definition) would write silently into `settings.json`
 * instead of refusing with a reason. {@link agentOverridesFor} therefore runs
 * every subagent role's FIRST candidate that PASSES the capability guard
 * (`./guard.ts`'s `guardRoute`, plan 05-02), never merely the first candidate
 * in the list. `guardRoute` is a pure predicate that takes no `ctx`
 * (`guard.ts`'s own PURITY section), so calling it here costs
 * {@link agentOverridesFor} none of its own purity or testability. When NO
 * candidate for a subagent role passes the guard, {@link agentOverridesFor}
 * returns `ok:false` naming the role and the guard's own refusal text, and
 * {@link writeAgentOverrides} is never reached — nothing is written.
 *
 * ---------------------------------------------------------------------------
 * WHY AUTHENTICATION IS DELIBERATELY NOT CHECKED HERE
 * ---------------------------------------------------------------------------
 * `ctx.modelRegistry.hasConfiguredAuth(model)` is the sanctioned pre-flight
 * auth check (05-RESEARCH.md §B.4), but it needs a `ctx` this module
 * deliberately does not accept — {@link agentOverridesFor} is pure, matching
 * `guard.ts`'s own discipline. An unauthenticated *subagent* pin is not the
 * silent-degradation bug this phase is built to catch: the pin is INERT until
 * something reads it, and nothing does yet — the `pi-subagents` package is
 * not installed (Phase 7's scope, per 05-CONTEXT.md's Deferred Ideas).
 * Capability (can this model even serve a tool loop at all?) is a STATIC
 * property of the model, checkable without a session. Auth (does THIS
 * machine have a key for it right now?) is not, and re-verifying it is
 * explicitly Phase 7's job (the PHASE 7 RE-VERIFICATION note below).
 *
 * ---------------------------------------------------------------------------
 * THE READ-MODIFY-WRITE — PORTED FROM `merge_settings`, NOT REINVENTED
 * ---------------------------------------------------------------------------
 * `bin/bootstrap.sh#merge_settings` (lines 494-527) is the ONLY existing
 * settings.json read-modify-write idiom in this repository. Its three
 * load-bearing properties are ported here exactly, generalised from "replace
 * `obj.kyPiAgent`" to "replace `obj.subagents.agentOverrides`, creating
 * `obj.subagents` if absent":
 *
 *   1. Missing file or an empty file is treated as `{}`. Invalid JSON is a
 *      REFUSAL naming the path and the parse error — never truncated, never
 *      overwritten.
 *   2. A parsed value that is `null`, an array, or any other non-object is a
 *      REFUSAL — never coerced into an object.
 *   3. Only `obj.subagents.agentOverrides` is replaced. `obj.subagents` is
 *      created when absent, but if it exists and is not a plain object, that
 *      is also a REFUSAL. Every sibling key (`kyPiAgent`,
 *      `subagents.defaultModel`, anything the user wrote by hand) survives
 *      byte-for-byte.
 *
 * Serialisation matches `merge_settings`' own byte shape exactly:
 * `JSON.stringify(obj, null, 2) + "\n"`. The write is SKIPPED ENTIRELY when
 * the resulting text is byte-identical to what is already on disk — a
 * settings file whose mtime changes on every command is noise that hides
 * real changes (bootstrap's own `--assert-hardening` byte-idempotence
 * discipline, `bin/bootstrap.sh:337-344`).
 *
 * {@link writeAgentOverrides} returns a refusal rather than throwing, so a
 * mode-switch command can report "the model switched but the subagent pins
 * did not, because <reason>" instead of failing the whole switch or —
 * strictly worse — silently succeeding at nothing. This mirrors
 * `safety/audit.ts#writeAuditRow`'s own "never let a side-channel write
 * short-circuit the caller's real decision" discipline, adapted from
 * catch-and-swallow (audit is best-effort) to catch-and-report (a settings
 * write failure is something the user should see).
 *
 * ---------------------------------------------------------------------------
 * THE EXACT SHAPE WRITTEN
 * ---------------------------------------------------------------------------
 *     {
 *       "subagents": {
 *         "agentOverrides": {
 *           "<agentName>": { "model": "<provider>/<id>" }
 *         }
 *       }
 *     }
 *
 * ---------------------------------------------------------------------------
 * PHASE 7 RE-VERIFICATION — READ THIS BEFORE ADOPTING THIS SHAPE UNCHANGED
 * ---------------------------------------------------------------------------
 * This shape is ARCHITECTURE.md's documented precedence-chain shape and a
 * FORWARD-COMPATIBLE BEST GUESS, not a shape verified against the real
 * `pi-subagents` package — that package is not installed yet
 * (05-CONTEXT.md's Deferred Ideas: "Installing and pinning `pi-subagents`
 * itself, and its source review — Phase 7"). EXT-08 requires every pin to be
 * re-verified at Phase 7 PLANNING TIME. Phase 7 must confirm this exact key
 * path (`subagents.agentOverrides`) and value shape
 * (`{ "<agentName>": { "model": "<provider>/<id>" } }`) against the pinned
 * `pi-subagents` version's actual settings schema before relying on it, and
 * must not simply inherit this comment's claim.
 *
 * ---------------------------------------------------------------------------
 * PURITY OF `agentOverridesFor`
 * ---------------------------------------------------------------------------
 * No `ctx`, no `node:fs`, no `process.env` — {@link agentOverridesFor} reads
 * only `./schema.ts`'s `ROLE_MAP`/`ROLE_MECHANISM`/`AGENT_NAME_BY_ROLE` and
 * calls `./guard.ts`'s pure `guardRoute`. Only {@link resolveSettingsPath} and
 * {@link writeAgentOverrides} touch the filesystem, and neither touches
 * `ctx` either — the seam for tests is an explicit `settingsPath` option,
 * never a live session.
 *
 * ---------------------------------------------------------------------------
 * BOUNDARY RULE (chokepoint-lint / BOOT-10)
 * ---------------------------------------------------------------------------
 * This module registers no tool and calls nothing that reaches a model
 * directly. It does not spell the forbidden direct-model routes even in
 * prose — `tests/unit/chokepoint-lint.test.ts` scans raw source text,
 * comments included, and grants `routing/` no exemption.
 */
import type { Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { guardRoute } from "./guard.ts";
import { AGENT_NAME_BY_ROLE, type KyModeData, type ModelRef, ROLE_MAP, ROLE_MECHANISM, type Role } from "./schema.ts";

/**
 * Build a structural `Model<"openai-completions">` fixture from a
 * `{provider,id}` candidate, for the sole purpose of feeding it to
 * `guardRoute`. This is NOT a registry lookup — `agentOverridesFor` is pure
 * (no `ctx`), so it cannot resolve a candidate's REAL catalogue entry.
 *
 * This is sound because of what {@link agentOverridesFor} actually asks
 * `guardRoute` for: `{ usesToolLoop: true }` and nothing else — `image` and
 * `estimatedInputTokens` and `thinkingRequested` are never set. Reading
 * `guardRoute`'s own blocks (`./guard.ts`), blocks 1-3 each gate on one of
 * those three fields being set; none of them can fire here regardless of
 * this fixture's `input`/`contextWindow`/`reasoning` values. Only block 4
 * (ROUTE-08's deny-list, keyed on `model.id` and `need.usesToolLoop`) can
 * ever fire through this call path — which is exactly the block this write
 * path exists to enforce (a subagent pin is a tool-loop role by
 * construction). The fixture's other fields are filled with permissive,
 * inert values so a future `guard.ts` edit that adds a new block gated on
 * `image`/`estimatedInputTokens`/`thinkingRequested` fails SAFE (never
 * blocks) rather than failing closed on a fixture artefact — any new block
 * of that shape would need its own `need` field threaded through here
 * deliberately, the same way `usesToolLoop` was.
 */
function candidateAsModelFixture(candidate: ModelRef): Model<"openai-completions"> {
	return {
		id: candidate.id,
		name: candidate.id,
		api: "openai-completions",
		provider: candidate.provider,
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: Number.MAX_SAFE_INTEGER,
		maxTokens: 0,
	};
}

// -----------------------------------------------------------------------------
// agentOverridesFor — pure derivation
// -----------------------------------------------------------------------------

/** One entry of the written `agentOverrides` object. */
export interface AgentOverrideEntry {
	readonly model: string;
}

/** The whole derived override object, keyed by agent name. */
export type AgentOverrides = Record<string, AgentOverrideEntry>;

/** The result of deriving the override object for one mode. */
export type AgentOverridesResult =
	| { readonly ok: true; readonly overrides: AgentOverrides }
	| { readonly ok: false; readonly reason: string };

/**
 * Test-only injection seam for {@link agentOverridesFor}. Production code
 * NEVER passes this — it defaults to the real `./schema.ts` tables. It exists
 * so `tests/unit/agent-overrides.test.ts` can build a fixture role map whose
 * only subagent candidate is guard-blocked, without mutating the real,
 * shared `ROLE_MAP` module singleton (which every other routing test also
 * imports).
 */
export interface AgentOverridesForOptions {
	readonly roleMap?: typeof ROLE_MAP;
	readonly roleMechanism?: typeof ROLE_MECHANISM;
	readonly agentNameByRole?: typeof AGENT_NAME_BY_ROLE;
}

/**
 * Derive `settings.subagents.agentOverrides` for the mode carried by `state`.
 *
 * For every role whose {@link ROLE_MECHANISM} is `"subagent"`, this walks
 * that role's ordered candidate list (from `./schema.ts`'s `ROLE_MAP`) and
 * emits `AGENT_NAME_BY_ROLE[role] -> { model: "<provider>/<id>" }` for the
 * FIRST candidate that passes {@link guardRoute}. See the module docstring's
 * "THE GUARD CALL IS LOAD-BEARING" section for why this is not merely the
 * first candidate in the list. `usesToolLoop: true` is passed on every guard
 * call — a subagent role is a tool-loop role by definition (ROUTE-05), which
 * is exactly the scope block 4 of `guardRoute` (ROUTE-08) is keyed on.
 *
 * Returns `ok:false` naming the role and the guard's own refusal text (from
 * its LAST-tried candidate, so the message is actionable) when every
 * candidate for a subagent role is guard-blocked. {@link writeAgentOverrides}
 * must never be called with a partial or absent result — see the caller
 * discipline note at that function's own doc comment.
 */
export function agentOverridesFor(
	state: Pick<KyModeData, "mode">,
	opts: AgentOverridesForOptions = {},
): AgentOverridesResult {
	const roleMap = opts.roleMap ?? ROLE_MAP;
	const roleMechanism = opts.roleMechanism ?? ROLE_MECHANISM;
	const agentNameByRole = opts.agentNameByRole ?? AGENT_NAME_BY_ROLE;

	const overrides: Record<string, AgentOverrideEntry> = {};
	const modeMap = roleMap[state.mode];

	for (const roleKey of Object.keys(roleMechanism) as Role[]) {
		if (roleMechanism[roleKey] !== "subagent") {
			continue;
		}
		const agentName = agentNameByRole[roleKey];
		if (agentName === undefined) {
			// A subagent-mechanism role with no entry in AGENT_NAME_BY_ROLE is a
			// schema.ts authoring bug, not a runtime condition this function should
			// paper over — refuse rather than silently omit the role from the
			// written overrides.
			return {
				ok: false,
				reason: `role "${roleKey}" is ROLE_MECHANISM.subagent but has no AGENT_NAME_BY_ROLE entry`,
			};
		}

		const route = modeMap[roleKey];
		let lastReason = `no candidates configured for role "${roleKey}" in mode "${state.mode}"`;
		let picked: string | undefined;

		for (const candidate of route.candidates) {
			// See candidateAsModelFixture's own doc comment for why a structural
			// fixture (not a registry lookup) is sound here: the only need field
			// ever set below is usesToolLoop, so only guardRoute's block 4
			// (ROUTE-08's deny-list) can ever fire through this call path.
			const verdict = guardRoute(candidateAsModelFixture(candidate), roleKey, { usesToolLoop: true });
			if (verdict.ok) {
				picked = `${candidate.provider}/${candidate.id}`;
				break;
			}
			lastReason = verdict.reason;
		}

		if (picked === undefined) {
			return {
				ok: false,
				reason: `role "${roleKey}": every candidate is guard-blocked (${lastReason})`,
			};
		}
		overrides[agentName] = { model: picked };
	}

	return { ok: true, overrides };
}

// -----------------------------------------------------------------------------
// resolveSettingsPath
// -----------------------------------------------------------------------------

/** Options accepted by {@link resolveSettingsPath} and {@link writeAgentOverrides}. */
export interface AgentOverridesPathOptions {
	/**
	 * Injected settings path, for tests. Production code never passes this —
	 * see the module docstring's "THE WRITE TARGET" decision.
	 */
	settingsPath?: string;
}

/**
 * The absolute path `writeAgentOverrides` writes to.
 *
 * Returns `opts.settingsPath` verbatim when given (the seam tests use).
 * Otherwise `join(getAgentDir(), "settings.json")` — the GLOBAL agent
 * settings file, which honours `PI_CODING_AGENT_DIR`
 * [VERIFIED: pi 0.84.1 `dist/config.d.ts:68,76`], letting the default branch
 * itself be exercised against a temp directory in tests.
 */
export function resolveSettingsPath(opts: AgentOverridesPathOptions = {}): string {
	if (opts.settingsPath !== undefined) {
		return opts.settingsPath;
	}
	return join(getAgentDir(), "settings.json");
}

// -----------------------------------------------------------------------------
// writeAgentOverrides — the validated read-modify-write
// -----------------------------------------------------------------------------

/** What {@link writeAgentOverrides} returns. */
export type WriteAgentOverridesResult =
	| { readonly ok: true; readonly written: boolean; readonly path: string }
	| { readonly ok: false; readonly reason: string; readonly path: string };

/**
 * Read-modify-write `settings.subagents.agentOverrides` at
 * {@link resolveSettingsPath}'s target.
 *
 * See the module docstring's "THE READ-MODIFY-WRITE" section for the exact
 * three properties this ports from `bin/bootstrap.sh#merge_settings`: refuse
 * on invalid JSON, refuse on a non-object/array, replace ONLY the owned key.
 * Serialises with `JSON.stringify(obj, null, 2) + "\n"` and skips the write
 * entirely (`written: false`) when the result is byte-identical to what is
 * already on disk.
 *
 * CALLER DISCIPLINE: `overrides` should be the `overrides` field of an
 * `agentOverridesFor` result whose `ok` was `true`. This function does not
 * re-run the guard itself — it trusts its caller to have refused already on
 * an `ok:false` derivation, matching `modes.ts`'s own
 * resolve → pick-candidate → guard → dispatch ordering rather than
 * duplicating the check here.
 */
export function writeAgentOverrides(
	overrides: AgentOverrides,
	opts: AgentOverridesPathOptions = {},
): WriteAgentOverridesResult {
	const path = resolveSettingsPath(opts);

	// WR-02: the WHOLE body runs inside one try/catch. The module docstring
	// promises "returns a refusal rather than throwing" for this function, but
	// only the JSON.parse call was ever guarded -- readFileSync (both calls),
	// writeFileSync and renameSync all throw natively on EACCES/EPERM/EISDIR, a
	// missing parent directory on a fresh machine, or a Windows file lock. A
	// caller (applyMode) that reaches this function AFTER pi.setModel already
	// succeeded and the ky:mode entry already got written must never see this
	// throw straight past it -- the switch really happened, and the step-6
	// notification the user is owed must still be reported, not skipped by an
	// unhandled rejection Pi's own extension host silently swallows.
	try {
		let raw = "{}";
		if (existsSync(path)) {
			const fileText = readFileSync(path, "utf-8").trim();
			raw = fileText === "" ? "{}" : fileText;
		}

		let obj: unknown;
		try {
			obj = JSON.parse(raw);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				ok: false,
				reason: `${path} is not valid JSON (${message}). Refusing to touch it.`,
				path,
			};
		}

		if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
			return {
				ok: false,
				reason: `${path} is not a JSON object. Refusing to touch it.`,
				path,
			};
		}

		const root = obj as Record<string, unknown>;
		const existingSubagents = root.subagents;
		if (
			existingSubagents !== undefined &&
			(existingSubagents === null || typeof existingSubagents !== "object" || Array.isArray(existingSubagents))
		) {
			return {
				ok: false,
				reason: `${path}'s "subagents" key is not a JSON object. Refusing to touch it.`,
				path,
			};
		}

		const subagents: Record<string, unknown> = { ...(existingSubagents as Record<string, unknown> | undefined) };
		subagents.agentOverrides = overrides;
		root.subagents = subagents;

		const nextText = `${JSON.stringify(root, null, 2)}\n`;

		if (existsSync(path)) {
			const currentText = readFileSync(path, "utf-8");
			if (currentText === nextText) {
				return { ok: true, written: false, path };
			}
		}

		// WR-02: temp-file + renameSync, never a direct writeFileSync onto the
		// user's GLOBAL settings file. `writeFileSync` alone is not atomic -- a
		// crash or a concurrent Pi session mid-write truncates the file,
		// destroying `kyPiAgent`, `subagents.defaultModel` and any hand-written
		// keys the read-modify-write above exists to preserve. `renameSync` is
		// atomic on the same filesystem, and the temp file lives beside the
		// target (same directory, so same filesystem/volume) rather than in a
		// system temp dir, which could straddle a volume boundary and turn the
		// rename into a copy.
		const tmpPath = `${path}.${process.pid}.tmp`;
		writeFileSync(tmpPath, nextText, "utf-8");
		renameSync(tmpPath, path);

		return { ok: true, written: true, path };
	} catch (err) {
		return {
			ok: false,
			reason: `${path} could not be written (${err instanceof Error ? err.message : String(err)}).`,
			path,
		};
	}
}
