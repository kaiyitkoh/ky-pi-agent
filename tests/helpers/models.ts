/**
 * A fully offline Pi model registry over a caller-supplied `models.json` and
 * `auth.json`: no network, no credentials, and no contact with the developer's
 * own agent directory.
 *
 * ---------------------------------------------------------------------------
 * Why this exists — assert the COMPOSED model, never the template's bytes
 * ---------------------------------------------------------------------------
 * Phase 3 ships `models.json` / `auth.json` templates and then makes claims
 * about them: that DashScope's `compat` block is explicit and complete
 * (PROV-03), that no model inherits another provider's context window
 * (PROV-06), that `$DASHSCOPE_API_KEY` resolves at runtime (PROV-01), that the
 * Bedrock credential is `env.AWS_PROFILE` and nothing else (PROV-04), and that
 * the R1 thinking tier is what the entry says it is (PROV-07).
 *
 * A test that reads the template and asserts on its JSON proves none of those.
 * Pi validates `models.json` with typebox, and an unknown `compat` key is
 * accepted in silence — a template carrying `supportsStoore: false` passes
 * every byte-level assertion ever written about it and configures nothing
 * (Trap T6). The only honest oracle is the model Pi *composed* from the file,
 * which is what this helper hands back.
 *
 * ---------------------------------------------------------------------------
 * The construction, and why each option is load-bearing
 * ---------------------------------------------------------------------------
 *   - `refreshOnCreate: false` — no catalogue refresh, therefore no network
 *     call at construction time. This is the single option that makes the
 *     helper offline
 *     [VERIFIED: pi 0.84.1 src/core/model-runtime.ts:210 — the refresh runs
 *      only when `options.refreshOnCreate !== false`].
 *   - `authPath` is always supplied and always inside this helper's own temp
 *     directory. Omitting it resolves the credential store to
 *     `getAgentDir()/auth.json`, i.e. the developer's REAL credentials
 *     [VERIFIED: pi 0.84.1 src/core/model-runtime.ts:173 —
 *      `DefaultAuthStorage.create(options.authPath)`]. The file need not exist;
 *     an absent one resolves as no stored credential. [threat T-03-01-01]
 *   - `models` is COPIED into the temp agent directory, even when the caller
 *     passes the path of a committed template, and `modelsPath` then points at
 *     the copy. This is not tidiness: the models store defaults to
 *     `join(dirname(modelsPath), "models-store.json")`
 *     [VERIFIED: pi 0.84.1 src/core/model-runtime.ts:179-180], so pointing
 *     `modelsPath` straight at `.pi/templates/models-template.json` would aim a
 *     writer at this repository's own tracked directory. [threat T-03-01-02]
 *
 * `ModelRegistry` is the synchronous facade Pi hands to extensions, and
 * `getProviderAuth(providerId)` takes a provider **id string** — it loads no
 * model and prepares no request, which is why an interpolation test over it is
 * a unit test [VERIFIED: pi 0.84.1 src/core/model-registry.ts:115-117;
 * `AuthResult` is `{ auth: { apiKey?, headers?, baseUrl? }, env?, source? }` per
 * pi-ai 0.84.1 src/auth/types.ts:102-109]. Precedence a later test must encode:
 * an `auth.json` entry beats the `models.json` `apiKey`.
 *
 * ---------------------------------------------------------------------------
 * One thing this helper CANNOT isolate, stated rather than hidden
 * ---------------------------------------------------------------------------
 * `!command` config values are cached for the process lifetime in a module-level
 * map inside Pi, and the function that clears it (`clearApiKeyCache`) is
 * re-exported from `core/model-registry.ts` but **not** from the package root
 * [VERIFIED: pi 0.84.1 dist/index.d.ts exports `ModelRegistry` only;
 * src/core/resolve-config-value.ts:10 `const commandResultCache = new Map(...)`].
 * There is no supported import path to it, so this helper does not pretend to
 * reset it. Two consequences bind every caller: `$ENV_VAR` values are re-read
 * on each resolution and are safe to vary between calls, whereas a `!command`
 * value resolved once keeps its first answer for the whole vitest worker. A
 * cached-versus-uncached proof (PROV-02) must therefore perform both of its
 * resolutions inside ONE callback, and two tests that need different answers
 * from the same command string cannot both be honest — vary the command string.
 *
 * ---------------------------------------------------------------------------
 * Throw, never opt out
 * ---------------------------------------------------------------------------
 * {@link ModelsConfigHandle.requireModel} throws when a model does not resolve
 * and names the provider id, the model id and the remedy. It never returns
 * `undefined`: a renamed provider or model id would otherwise turn every
 * assertion downstream of it into a silent no-op, which is Assumption A7's
 * hazard exactly. There is deliberately no escape hatch anywhere in this file;
 * an auditor grepping for one must find nothing.
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface ModelsConfigOptions {
	/**
	 * Either an absolute path to a models config file — the shipped template is
	 * the intended case — or a plain object serialised to the temp
	 * `models.json`. A path is copied, never read in place; see the module
	 * docstring for the writer that aims at `dirname(modelsPath)`.
	 */
	models: string | Record<string, unknown>;
	/**
	 * Optional object serialised to the temp `auth.json`. When omitted the path
	 * is still passed to `ModelRuntime.create` and simply does not exist, which
	 * resolves as "no stored credential" rather than as an error.
	 */
	auth?: Record<string, unknown>;
	/**
	 * Environment applied to `process.env` for the lifetime of the callback and
	 * restored afterwards. A key that did not exist beforehand is DELETED on
	 * restoration, never blanked: `""` and absent are different answers to
	 * Bedrock's `credential.env.AWS_PROFILE ?? process.env.AWS_PROFILE` chain
	 * [VERIFIED: pi-ai 0.84.1 src/providers/amazon-bedrock.ts:52-77].
	 * [threat T-03-01-03]
	 */
	env?: Record<string, string>;
}

export interface ModelsConfigHandle {
	/** The offline runtime, constructed with `refreshOnCreate: false`. */
	modelRuntime: ModelRuntime;
	/** The synchronous facade extensions see. Carries `getProviderAuth`. */
	registry: ModelRegistry;
	/** Temp agent directory. The ONLY path this helper ever removes. */
	agentDir: string;
	/** Absolute path of the temp `models.json` actually loaded. */
	modelsPath: string;
	/** Absolute path of the temp `auth.json`. May not exist. */
	authPath: string;
	/**
	 * The composed model, or a throw naming both ids and the remedy.
	 *
	 * Composed, not templated: the returned object is what Pi built out of the
	 * config, so `contextWindow`, `compat` and `cost` on it are the values that
	 * would reach a real request.
	 */
	requireModel(providerId: string, modelId: string): Model<Api>;
}

/** Best-effort temp-dir removal. Never masks a real assertion result. */
function removeQuietly(dir: string): void {
	try {
		// maxRetries is the Windows convention in this repo: file handles linger.
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	} catch {
		// A leftover temp dir is noise, not a failure. [threat T-03-01-02]
	}
}

/**
 * Apply `env` to `process.env` and return the exact undo.
 *
 * The undo distinguishes "was absent" from "was empty", because the callers
 * this exists for treat those differently. [threat T-03-01-03]
 */
function applyEnv(env: Record<string, string>): () => void {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(env)) {
		previous.set(key, Object.hasOwn(process.env, key) ? process.env[key] : undefined);
		process.env[key] = value;
	}
	return () => {
		for (const [key, value] of previous) {
			if (value === undefined) {
				// DELETE, not `= ""`. An empty string is a value; absent is not.
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	};
}

/**
 * Build an offline model registry over `opts`, run `fn` against it, then clean
 * up.
 *
 * Asynchronous by design, and modelled on `withFauxSession` in
 * `./session.ts`: the callback is awaited inside the `try` so the temp files
 * exist for its whole lifetime, and both the environment restoration and the
 * directory removal happen in the `finally` so a thrown assertion still leaves
 * the process clean.
 */
export async function withModelsConfig<T>(
	opts: ModelsConfigOptions,
	fn: (handle: ModelsConfigHandle) => T | Promise<T>,
): Promise<T> {
	// Only a path this helper created with mkdtempSync under a `kypi-` prefix is
	// ever passed to rmSync. [threat T-03-01-02]
	const agentDir = mkdtempSync(join(tmpdir(), "kypi-models-"));
	const modelsPath = join(agentDir, "models.json");
	const authPath = join(agentDir, "auth.json");

	let restoreEnv: (() => void) | undefined;
	try {
		if (typeof opts.models === "string") {
			copyFileSync(opts.models, modelsPath);
		} else {
			writeFileSync(modelsPath, `${JSON.stringify(opts.models, null, 2)}\n`, "utf-8");
		}
		if (opts.auth !== undefined) {
			writeFileSync(authPath, `${JSON.stringify(opts.auth, null, 2)}\n`, "utf-8");
		}

		// Applied BEFORE construction, deliberately, although Pi does not require
		// it: `$ENV_VAR` values are resolved LAZILY, at `getProviderAuth()` time
		// rather than at composition time, so moving this below `create()` changes
		// nothing observable [VERIFIED: executed 2026-08-13 — the assertion in
		// tests/unit/helpers.test.ts stayed green with the two statements swapped].
		// It is ordered this way so that a future option Pi DOES read during
		// composition inherits the right behaviour by construction, and so nothing
		// in this file depends on the laziness holding.
		if (opts.env !== undefined) {
			restoreEnv = applyEnv(opts.env);
		}

		const modelRuntime = await ModelRuntime.create({
			// Inside the temp dir, always -- never the developer's real one.
			authPath,
			// The COPY, so the models-store writer cannot aim at a tracked directory.
			modelsPath,
			// No catalogue refresh, so no network call at construction time.
			refreshOnCreate: false,
		});
		const registry = new ModelRegistry(modelRuntime);

		const handle: ModelsConfigHandle = {
			modelRuntime,
			registry,
			agentDir,
			modelsPath,
			authPath,
			requireModel(providerId: string, modelId: string): Model<Api> {
				const model = registry.find(providerId, modelId);
				if (!model) {
					const known = modelRuntime
						.getModels()
						.map((candidate) => `${candidate.provider}/${candidate.id}`)
						.sort();
					const configError = modelRuntime.getError();
					throw new Error(
						[
							`withModelsConfig: the model ${providerId}/${modelId} did not resolve from ` +
								`${modelsPath}.`,
							"",
							"This is never a reason to soften the assertion downstream: an unresolved",
							"model that returned undefined would make every claim about its compat,",
							"contextWindow and cost pass without executing. Fix the ids instead.",
							"",
							`  provider id asked for: ${providerId}`,
							`  model id asked for:    ${modelId}`,
							`  models Pi composed:    ${known.length > 0 ? known.join(", ") : "(none)"}`,
							configError !== undefined
								? `  models.json error:     ${configError}`
								: "  models.json error:     (none -- the file parsed and validated)",
							"",
							"Note that Pi validates models.json with typebox and accepts an unknown",
							"key in silence, so a misspelled `providers` entry produces exactly this",
							"failure with no parse error to point at.",
						].join("\n"),
					);
				}
				return model;
			},
		};

		return await fn(handle);
	} finally {
		restoreEnv?.();
		removeQuietly(agentDir);
	}
}
