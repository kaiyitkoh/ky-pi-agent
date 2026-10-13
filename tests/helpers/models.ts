/**
 * An offline Pi model registry over a caller-supplied models.json and auth.json, so tests assert the model Pi COMPOSED
 * (typebox accepts unknown compat keys, so the template's bytes prove nothing). `refreshOnCreate: false` keeps it off
 * the network (pi 1.1.0 dist/core/model-runtime.js:104); authPath and a copied models.json keep every read and write
 * inside a temp dir (:79, :84). A `!command` value is cached per process (dist/core/resolve-config-value.js:8) with no
 * public reset, so a cached-vs-uncached proof must resolve twice inside one callback. requireModel throws, never skips.
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface ModelsConfigOptions {
	/** An absolute path (copied, never read in place) or a plain object serialised to the temp models.json. */
	models: string | Record<string, unknown>;
	/** Serialised to the temp auth.json; when omitted the path simply does not exist (no stored credential). */
	auth?: Record<string, unknown>;
	/**
	 * Applied to process.env for the callback, then restored. A key absent beforehand is deleted, never blanked: Bedrock's
	 * `credential.env.AWS_PROFILE ?? process.env.AWS_PROFILE` chain treats "" and absent differently.
	 */
	env?: Record<string, string>;
}

export interface ModelsConfigHandle {
	/** The offline runtime, constructed with `refreshOnCreate: false`. */
	modelRuntime: ModelRuntime;
	/** The synchronous facade extensions see. Carries `getProviderAuth`. */
	registry: ModelRegistry;
	/** Temp agent directory: the only path this helper ever removes. */
	agentDir: string;
	/** Absolute path of the temp `models.json` actually loaded. */
	modelsPath: string;
	/** Absolute path of the temp `auth.json`. May not exist. */
	authPath: string;
	/** The composed model (the values that would reach a real request), or a throw naming both ids. */
	requireModel(providerId: string, modelId: string): Model<Api>;
}

/** Best-effort temp-dir removal. Never masks a real assertion result. */
function removeQuietly(dir: string): void {
	try {
		// maxRetries is the Windows convention in this repo: file handles linger.
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	} catch {
		// A leftover temp dir must never mask the test's own result.
	}
}

/** Applies `env` to process.env and returns the exact undo, distinguishing absent from empty. */
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

/** Builds an offline registry over `opts`, awaits `fn`, then restores the env and removes the temp dir in a finally. */
export async function withModelsConfig<T>(
	opts: ModelsConfigOptions,
	fn: (handle: ModelsConfigHandle) => T | Promise<T>,
): Promise<T> {
	// rmSync only ever sees a dir this helper created with mkdtempSync.
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

		// Before construction so a future option Pi reads at composition time inherits the env; `$ENV_VAR` is lazy today.
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
