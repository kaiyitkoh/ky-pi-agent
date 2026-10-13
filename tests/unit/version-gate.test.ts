/**
 * The unpublished-pin gate says why it failed. npm view exits non-zero both for an unpublished version and for an
 * unreachable registry, so the gate reads the literal E404 token: treating any failure as unpublished would send a
 * user on a flaky network off to edit a good pin. Case 1 uses the real registry; an outage fails it, never skips it.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { withStubBin } from "../helpers/stub-bin.ts";

const PI_PKG = "@earendil-works/pi-coding-agent";

/** Forward slashes: Git Bash `sh` will not accept a backslash path argument. */
const BOOTSTRAP = join(repoRoot(), "bin", "bootstrap.sh").replace(/\\/g, "/");

/** Real registry round-trips are the slow part; npm cold-start dominates. */
const TIMEOUT_MS = 120_000;

interface Run {
	stdout: string;
	stderr: string;
	status: number | null;
}

/** Runs the gate as a subprocess through `sh`, which is a real executable on both platforms, so no shell is needed. */
function runCheckVersion(opts: { pinned?: string; env?: NodeJS.ProcessEnv } = {}): Run {
	const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) };
	if (opts.pinned !== undefined) {
		env.KYPI_PI_PINNED = opts.pinned;
	}

	const result = spawnSync("sh", [BOOTSTRAP, "--check-version"], {
		env,
		encoding: "utf-8",
		timeout: TIMEOUT_MS,
		windowsHide: true,
	});

	if (result.error) {
		throw new Error(`failed to run \`sh ${BOOTSTRAP} --check-version\`: ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

describe("BOOT-04 -- the pinned Pi version gate", () => {
	it("case 1: a published pin passes", () => {
		// 1.1.0 is the shipped pin; red means the registry is down or the version was withdrawn, both for a human.
		const run = runCheckVersion({ pinned: "1.1.0" });

		expect(run.status, `stderr: ${run.stderr}`).toBe(0);
		expect(run.stdout).toContain(`${PI_PKG}@1.1.0`);
		expect(run.stdout).toMatch(/published/i);
	}, TIMEOUT_MS);

	it("case 2: an unpublished pin names the version and the way out", () => {
		// 0.73.0 is confirmed gone: the registry keeps 40 versions and the oldest
		// surviving one is 0.74.0. This is a real yank, not a synthetic fixture.
		const run = runCheckVersion({ pinned: "0.73.0" });

		expect(run.status, `stdout: ${run.stdout}`).toBe(1);

		// The three things the failure message has to carry to be actionable:
		// which version, which package, and what to do about it.
		expect(run.stderr).toMatch(/0\.73\.0/);
		expect(run.stderr).toContain(PI_PKG);
		expect(run.stderr).toMatch(/[Ff]allback/);

		// And it must be unambiguous about the cause, since case 3 asserts the
		// opposite wording for the opposite cause.
		expect(run.stderr).toMatch(/no longer published/i);
	}, TIMEOUT_MS);

	it("case 3: an unreachable registry is not reported as an unpublished pin", () => {
		// A stub npm that fails like a dead network: non-zero exit, a connection error, and no E404 anywhere.
		const npmStub = {
			exitCode: 1,
			stdout: "",
			stderr: [
				"npm error code ENOTFOUND",
				"npm error network request to https://registry.npmjs.org/@earendil-works%2fpi-coding-agent failed,",
				"npm error network reason: getaddrinfo ENOTFOUND registry.npmjs.org",
				"npm error network This is a problem related to network connectivity.",
				"",
			].join("\n"),
		};

		const run = withStubBin({ npm: npmStub }, (env) => runCheckVersion({ env }));

		// It still fails -- an unverifiable pin is not a verified pin.
		expect(run.status, `stdout: ${run.stdout}`).not.toBe(0);

		// The reason the gate reads E404 rather than the exit code.
		expect(run.stderr).not.toMatch(/unpublish|yanked|no longer published/i);

		// And it must say something the user can act on.
		expect(run.stderr).toMatch(/registry/i);
		expect(run.stderr).toMatch(/network|proxy|reach/i);
	}, TIMEOUT_MS);
});
