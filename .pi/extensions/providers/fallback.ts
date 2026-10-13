/**
 * Two-hop provider chain (named exports only): walks CHAIN through the diagnostics chokepoint and stops on the first
 * non-error message or the first `fatal` failure. It is a failure path, not routing, and registers no hook.
 * It is a function because the registry facade has no retry (compaction.ts) and a nested call fires no events (sdk.ts).
 * Advancing sends the prompt to another vendor, so CHAIN is a fixed table, `fatal` never advances, and no backoff is added (pi 1.1.0 docs/settings.md:125-133).
 */
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { callModel, type CallModelOptions } from "../diagnostics/call-model.ts";
import {
	CHAIN,
	QUOTA_PATTERN,
	UNAVAILABLE_PATTERN,
	type ChainEntry,
	type FailureClass,
} from "./schema.ts";

/**
 * The chokepoint contract minus `model`, which the chain supplies. `role` stays mandatory and undefaulted:
 * the turns row joins on it. Typed at `Api` because registry lookups return the open union.
 */
export type CallWithFallbackOptions = Omit<CallModelOptions<Api>, "model">;

/**
 * The two fields Pi's retry predicate reads (pi-ai dist/utils/retry.js). A rejection carries no message,
 * so one probe keeps rejections and returned failures on the same rule.
 */
function retryProbe(errorText: string): AssistantMessage {
	return { stopReason: "error", errorMessage: errorText } as unknown as AssistantMessage;
}

/**
 * Failure class from text alone. Order matters: quota first (Pi calls it non-retryable, but a second provider survives it),
 * then Pi's own predicate for the retryable/fatal split, then the availability table. Empty text is `fatal`.
 */
export function classifyFailure(errorText: string): FailureClass {
	if (QUOTA_PATTERN.test(errorText)) {
		return "quota";
	}
	if (!isRetryableAssistantError(retryProbe(errorText))) {
		return "fatal";
	}
	return UNAVAILABLE_PATTERN.test(errorText) ? "unavailable" : "transient";
}

/** Thrown for an entry that does not resolve before any hop was attempted: a silent skip would report a chain failure for a chain never walked. */
function unresolvedEntryError(entry: ChainEntry): Error {
	return new Error(
		`callWithFallback: the chain entry ${entry.provider}/${entry.id} does not resolve in this ` +
			"session's registry, so that hop would be skipped in silence and a chain failure would be " +
			"reported for a chain that was never walked. Either the provider is not configured (add it " +
			"to ~/.pi/agent/models.json from .pi/templates/models-template.json) or the model id has " +
			"been renamed upstream — in which case fix CHAIN in " +
			".pi/extensions/providers/schema.ts, do not delete the hop",
	);
}

/** Per-hop capability check, structural so this module does not import routing. */
export type HopGuard = (model: Model<Api>) => { readonly ok: true } | { readonly ok: false; readonly reason: string };

function allHopsSkippedError(skipped: readonly string[]): Error {
	return new Error(
		`callWithFallback: no chain hop was usable, so nothing was attempted (${skipped.join(", ")}). ` +
			"Add a credential for the first hop in ~/.pi/agent/auth.json",
	);
}

/**
 * First hop that answers wins; `fatal` stops the chain and the first failing message is returned if every attempted hop fails.
 * A rejection uses the same classification and is rethrown, not converted: the chokepoint already wrote its turns row.
 * A hop the `guard` refuses is skipped with its reason, so a request that must fail is not sent to a second vendor.
 */
export async function callWithFallback(
	ctx: ExtensionContext,
	opts: CallWithFallbackOptions,
	guard?: HopGuard,
): Promise<AssistantMessage> {
	let firstFailure: AssistantMessage | undefined;
	let firstRejection: unknown;
	let attempted = false;
	const skipped: string[] = [];

	for (const entry of CHAIN) {
		// Registry lookup only; the chokepoint lint does not ban it.
		const model = ctx.modelRegistry.find(entry.provider, entry.id);
		if (!model) {
			if (!attempted) {
				throw unresolvedEntryError(entry);
			}
			skipped.push(`${entry.provider}/${entry.id} (does not resolve)`);
			continue;
		}
		if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
			skipped.push(`${entry.provider}/${entry.id} (no configured auth)`);
			continue;
		}
		const verdict = guard?.(model);
		if (verdict !== undefined && !verdict.ok) {
			skipped.push(`${entry.provider}/${entry.id} (capability guard: ${verdict.reason})`);
			continue;
		}

		let message: AssistantMessage;
		attempted = true;
		try {
			// The sanctioned path outside diagnostics/: each hop gets its own turns row.
			message = await callModel(ctx, { ...opts, model });
		} catch (error) {
			if (classifyFailure(String(error)) === "fatal") {
				throw error;
			}
			if (firstFailure === undefined && firstRejection === undefined) {
				firstRejection = error;
			}
			continue;
		}

		if (message.stopReason !== "error") {
			return message;
		}

		firstFailure ??= message;

		if (classifyFailure(message.errorMessage ?? "") === "fatal") {
			// A 400, 401 or expired credential fails at every vendor; advancing would disclose the prompt for nothing.
			return message;
		}
	}

	// Every attempted hop failed with an advancing class; the first real failure is the one worth reading.
	if (firstFailure !== undefined) {
		return firstFailure;
	}
	if (firstRejection !== undefined) {
		throw firstRejection;
	}
	if (skipped.length > 0) {
		throw allHopsSkippedError(skipped);
	}
	throw new Error(
		"callWithFallback: CHAIN is empty, so no provider was attempted. A chain with no " +
			"entries is not a fallback policy; restore CHAIN in .pi/extensions/providers/schema.ts",
	);
}
