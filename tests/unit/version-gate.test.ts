/**
 * BOOT-04 -- the unpublished-pin gate tells the truth about WHY it failed.
 *
 * Earendil Works unpublishes old versions of `@earendil-works/pi-coding-agent`:
 * 40 versions survive and the oldest is 0.74.0 [VERIFIED: npm registry,
 * executed 2026-08-13]. A pinned harness therefore has a real, non-hypothetical
 * failure mode -- the pin evaporates -- and the bootstrap must say so in a way
 * that names the version and the way out.
 *
 * ---------------------------------------------------------------------------
 * The discrimination is on the literal E404 token, NOT on the exit code
 * ---------------------------------------------------------------------------
 * Both failure shapes exit non-zero, so the exit code carries no information
 * about which one happened [VERIFIED: executed 2026-08-13, npm 11.13.0]:
 *
 *   npm view <pkg>@0.84.1 version --json  -> exit 0, stdout `"0.84.1"`
 *   npm view <pkg>@0.73.0 version --json  -> exit 1, stdout
 *       {"error":{"code":"E404","summary":"No match found for version 0.73.0"}}
 *   registry unreachable                  -> exit 1, no E404 anywhere
 *
 * A gate that treats "non-zero" as "unpublished" therefore tells a user on a
 * flaky connection that Pi has been withdrawn, and sends them off to edit a
 * perfectly good pin -- a worse outcome than having no gate at all, because it
 * manufactures a supply-chain change out of a dropped packet. RESEARCH.md 3.2
 * flags this as the critical nuance; case 3 below is what holds the line.
 *
 * Case 1 touches the real registry deliberately. A registry outage is a genuine
 * failure of this test, not a reason to skip: a silently-skipped supply-chain
 * check is a green run that verified nothing.
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

/**
 * Invoke the gate exactly the way a user or CI would: as a subprocess, through
 * `sh`, with no in-process reimplementation of the logic under test.
 *
 * `sh` is spawned with an args array and `shell: false`. That is safe here and
 * elsewhere is not: `sh` resolves through PATH as a real executable on both
 * platforms (Git Bash ships `sh.exe`), unlike the `.cmd` shims that force
 * `shell: true` for `npm`/`pi` -- see the CVE-2024-27980 note in stub-bin.ts.
 */
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
		// 0.84.1 is `latest` and is the pin the harness actually ships
		// [VERIFIED: npm dist-tags, 2026-08-13]. If this goes red, either the
		// registry is down or Earendil has unpublished the version this project
		// is built on -- both are things a human must look at, so it must not be
		// downgraded to a skip.
		const run = runCheckVersion({ pinned: "0.84.1" });

		expect(run.status, `stderr: ${run.stderr}`).toBe(0);
		expect(run.stdout).toContain(`${PI_PKG}@0.84.1`);
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
		// A stub `npm` that fails the way a dead network fails: non-zero exit, a
		// connection error on stderr, and -- the part that matters -- nothing
		// anywhere in its output containing E404.
		//
		// Stubbed rather than simulated by manipulating the real network: taking
		// this machine offline is not something a test may do, and a test that
		// only passes when someone pulls the cable is a test that never runs.
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

		// But it must not claim the pin was withdrawn. This assertion is the
		// entire reason the gate reads the E404 token instead of the exit code;
		// swap that for a bare non-zero check and this line goes red.
		expect(run.stderr).not.toMatch(/unpublish|yanked|no longer published/i);

		// And it must say something the user can act on.
		expect(run.stderr).toMatch(/registry/i);
		expect(run.stderr).toMatch(/network|proxy|reach/i);
	}, TIMEOUT_MS);
});
