/**
 * buildFacts (safety/index.ts) canonicalises the impure ctx.cwd and os.homedir() before evaluate(), so a write inside
 * the project is allowed on a native-backslash cwd, and the wrapped tool runs in ctx.cwd rather than a cwd captured
 * at registration. Only a real session drives the impure values; the pure classifiers are tested in path-policy and
 * policy-compose. The fail-open home half is proven at unit level in path-policy.test.ts, never against a real ~/.bashrc.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

import { describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { readAudit } from "../helpers/logs.ts";
import { capturing, lastToolResult } from "../helpers/faux.ts";
import { withFauxSession } from "../helpers/session.ts";

const RELATIVE_PATH = "cr-02-canonicalisation-probe.txt";
const CONTENT = "kypi-cr-02-positive-control";

describe("CR-02 -- a write inside the project root is allowed on a native-backslash cwd", () => {
	it("write({ path: 'relative-file.txt' }) inside the session's own (backslash-native) cwd is ALLOWED, not blocked as 'outside the project root'", async () => {
		const outgoing: Context[] = [];

		await withFauxSession(
			{
				extensionPath: `${repoRoot()}/.pi/extensions/safety/index.ts`,
				tools: ["write"],
				responses: [
					fauxAssistantMessage([fauxToolCall("write", { path: RELATIVE_PATH, content: CONTENT })], {
						stopReason: "toolUse",
					}),
					capturing(outgoing, fauxAssistantMessage([fauxText("done")], { stopReason: "stop" })),
				],
			},
			async ({ session, cwd }) => {
				await session.prompt("write the probe file");

				const rows = readAudit(cwd);
				expect(rows.length, "no audit rows at all -- the safety extension likely never loaded").toBeGreaterThan(0);

				// An un-normalised backslash root parses as "/" with one giant segment, so every write read as outside the project.
				const blockedAsOutsideRoot = rows.filter(
					(r) => r.verdict === "block" && (r.reason ?? "").includes("resolves outside the project root"),
				);
				expect(
					blockedAsOutsideRoot,
					"CR-02: a write to a RELATIVE path inside the session's own cwd must never be classified " +
						`as outside the project root. Rows:\n${JSON.stringify(rows, null, 2)}`,
				).toEqual([]);

				const wrapperAllow = rows.filter(
					(r) => r.event === "safety.wrapped_execute" && r.verdict === "allow" && r.tool === "write",
				);
				expect(
					wrapperAllow.length,
					`the wrapper must have allowed the write. Rows:\n${JSON.stringify(rows, null, 2)}`,
				).toBeGreaterThan(0);

				// The write reached the real tool, so the guard did not merely stay out of a call that would no-op.
				expect(outgoing.length, "the closing reply must have been reached for its context to be captured").toBe(1);
				const result = lastToolResult(outgoing[0] as Context);
				expect(result?.isError, "the real write must have succeeded, not thrown").toBe(false);

				const written = readFileSync(join(cwd, RELATIVE_PATH), "utf-8");
				expect(written).toBe(CONTENT);
			},
		);
	});
});
