/**
 * `bin/bootstrap.sh` installs the two config templates into the agent directory, the only place Pi reads them, and
 * never overwrites an existing `auth.json`, which holds live credentials on a real machine. Every run sets
 * `PI_CODING_AGENT_DIR` to a temp dir and `KYPI_SKIP_INSTALL=1` with a logged npm stub: two guards, so neither alone
 * can touch this machine. No provider is contacted (RB-03-01..03 stay OUTSTANDING); case 6 only shows Pi resolves the
 * installed credential document offline.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
	BEDROCK_PROVIDER_ID,
	TEMPLATE_SENTINEL_PREFIX,
} from "../../.pi/extensions/providers/schema.ts";
import { bootstrapNpmStub, type BootstrapRepoCopy, makeBootstrapRepoCopy } from "../helpers/bootstrap-repo.ts";
import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";
import { scratchDirs } from "../helpers/scratch.ts";
import { withStubBin } from "../helpers/stub-bin.ts";

/** npm is stubbed, so no registry round-trip; node startup still dominates. */
const TIMEOUT_MS = 120_000;

const MODELS_TEMPLATE = join(repoRoot(), ".pi", "templates", "models-template.json");
const AUTH_TEMPLATE = join(repoRoot(), ".pi", "templates", "auth-template.json");

/** The provider key the installer owns in `models.json`. */
const DASHSCOPE = "dashscope";

interface Run {
	stdout: string;
	stderr: string;
	status: number | null;
	/** Everything the stubbed `npm` was asked, one invocation per line. */
	log: string;
}

const scratch = scratchDirs();
const tempDir = scratch.make;

/** A throwaway REPO_ROOT under this repo's `tmp/`, registered for cleanup (see tests/helpers/bootstrap-repo.ts). */
function bootstrapRepoCopy(): BootstrapRepoCopy {
	const copy = makeBootstrapRepoCopy("kypi-bootstrap-repo-");
	scratch.track(copy.root);
	return copy;
}

/**
 * Runs the real script against `repoCopy` (a fresh REPO_ROOT copy by default), so its `.env.example` write never
 * reaches the tracked file. Case 5c pre-seeds its own copy.
 */
function runFullBootstrap(
	agentDir: string,
	extraEnv: Record<string, string> = {},
	repoCopy: BootstrapRepoCopy = bootstrapRepoCopy(),
): Run {
	const logDir = tempDir("kypi-log-");
	const log = join(logDir, "npm.log").replace(/\\/g, "/");

	return withStubBin({ npm: bootstrapNpmStub(log, "0.84.1") }, (env) => {
		const result = spawnSync("sh", [repoCopy.bootstrapSh], {
			cwd: repoCopy.root,
			env: {
				...env,
				PI_CODING_AGENT_DIR: agentDir,
				// Both guards, every run. [threat T-03-06-05]
				KYPI_SKIP_INSTALL: "1",
				// Blanked, not inherited: an ambient value would rewrite the base URL in every case and let case 5 pass by chance.
				KYPI_DASHSCOPE_BASE_URL: "",
				...extraEnv,
			},
			encoding: "utf-8",
			timeout: TIMEOUT_MS,
			windowsHide: true,
		});

		if (result.error) {
			throw new Error(`failed to run \`sh ${repoCopy.bootstrapSh}\`: ${result.error.message}`);
		}
		return {
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			status: result.status,
			log: existsSync(log) ? readFileSync(log, "utf-8") : "",
		};
	});
}

/** The stub's call log, asserted first: a run that never reached the script would otherwise look the same. */
function expectReachedTheScript(run: Run): void {
	expect(
		run.log,
		"the stubbed npm recorded no invocation, so the script this case claims to " +
			"exercise may never have run at all -- and if it DID run, it ran against the " +
			"developer's real npm. Assert the stub was consulted before asserting anything " +
			"it produced",
	).toContain("npm config get ignore-scripts");
	expect(
		run.log,
		"KYPI_SKIP_INSTALL=1 must keep `npm install -g` unreached; this suite may not " +
			"mutate the global prefix",
	).not.toMatch(/^npm install/m);
}

/**
 * The models template parsed as the installer does: whole-line comments only, since a naive `//` strip eats
 * `https://`. Case 1 deep-equals the installed block against this parse, so the two strips cannot drift silently.
 */
function parseModelsTemplate(text: string): Record<string, unknown> {
	return JSON.parse(
		text
			.split("\n")
			.filter((line) => !/^\s*\/\//.test(line))
			.join("\n"),
	) as Record<string, unknown>;
}

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

function templateDashscope(): Record<string, unknown> {
	const providers = parseModelsTemplate(readFileSync(MODELS_TEMPLATE, "utf-8")).providers as
		| Record<string, unknown>
		| undefined;
	return (providers?.[DASHSCOPE] ?? {}) as Record<string, unknown>;
}

function installedProviders(agentDir: string): Record<string, unknown> {
	return (readJson(join(agentDir, "models.json")).providers ?? {}) as Record<string, unknown>;
}

/** True when any string anywhere under `node` still begins with the sentinel. */
function carriesSentinel(node: unknown): boolean {
	if (typeof node === "string") {
		return node.startsWith(TEMPLATE_SENTINEL_PREFIX);
	}
	if (Array.isArray(node)) {
		return node.some(carriesSentinel);
	}
	if (node !== null && typeof node === "object") {
		return Object.values(node).some(carriesSentinel);
	}
	return false;
}

/** The auth template split as `merge_auth_json` splits it, computed from the committed bytes, not a typed list. */
function authTemplatePartition(): { installable: string[]; withheld: string[] } {
	const tpl = readJson(AUTH_TEMPLATE);
	const installable: string[] = [];
	const withheld: string[] = [];
	for (const key of Object.keys(tpl)) {
		(carriesSentinel(tpl[key]) ? withheld : installable).push(key);
	}
	return { installable: installable.sort(), withheld: withheld.sort() };
}

/**
 * Every variable Pi's Bedrock `resolve()` consults (pi-ai src/providers/amazon-bedrock.ts:54-79); blanking only one
 * would let an ambient bearer token answer and pass for the wrong reason.
 */
const AWS_CHAIN_VARIABLES = [
	"AWS_BEARER_TOKEN_BEDROCK",
	"AWS_PROFILE",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
	"AWS_CONTAINER_CREDENTIALS_FULL_URI",
	"AWS_WEB_IDENTITY_TOKEN_FILE",
] as const;

function scopedAwsEnv(overrides: Record<string, string> = {}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const name of AWS_CHAIN_VARIABLES) {
		env[name] = "";
	}
	return { ...env, ...overrides };
}

describe("PROV-01 / PROV-04 -- the templates reach the agent directory", () => {
	// Every case runs against a throwaway REPO_ROOT copy, so scratch cleanup is all that is needed.
	afterEach(scratch.cleanup);

	// One clean install into a directory the script must create, shared by the cases that only read its result.
	const shared = scratchDirs();
	let cleanDir = "";
	let clean: Run;
	beforeAll(() => {
		cleanDir = join(shared.make("kypi-agentroot-"), "agent");
		clean = runFullBootstrap(cleanDir);
	});
	afterAll(shared.cleanup);

	it("case 1 -- a clean install writes both files, compat block intact", () => {
		const agentDir = cleanDir;
		const run = clean;

		expectReachedTheScript(run);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		const models = join(agentDir, "models.json");
		const auth = join(agentDir, "auth.json");
		expect(
			existsSync(models),
			"a fresh machine got no models.json. The templates in this repository are read " +
				"by nothing until the installer copies them; without this step a clone has a " +
				"DashScope provider on paper and none in Pi",
		).toBe(true);
		expect(existsSync(auth), "a fresh machine got no auth.json").toBe(true);

		const dashscope = installedProviders(agentDir)[DASHSCOPE] as Record<string, unknown>;
		expect(
			dashscope,
			"the installed models.json has no providers.dashscope key, so the merge wrote " +
				"something other than the provider it was asked to install",
		).toBeDefined();
		expect(
			dashscope,
			"the installed provider block must be the template's block, byte for byte in " +
				"structure. An unknown compat key validates silently in Pi and configures " +
				"nothing (Trap T6), so a merge that dropped or renamed part of the block " +
				"would leave thinking disabled and the second turn of every tool sequence " +
				"returning 400 -- both invisible from the UI, which is why PROV-03 exists",
		).toEqual(templateDashscope());
		expect(
			(dashscope.compat as Record<string, unknown>).thinkingFormat,
			"thinkingFormat is the single field most likely to be lost in a merge and the " +
				"one whose loss is completely silent: detection has no DashScope branch, so " +
				"its absence falls back to \"openai\" and thinking is never enabled at all",
		).toBe("qwen");

		const installedAuth = readJson(auth);
		const { installable, withheld } = authTemplatePartition();

		expect(
			installable.length,
			"the auth template has no entry free of a REPLACE_WITH_ placeholder, so the " +
				"assertion below would be `[] === []` and the installer could have written " +
				"nothing at all",
		).toBeGreaterThan(0);
		expect(
			withheld.length,
			"the auth template carries no placeholder entry at all, so the withholding " +
				"assertion below is about a rule nothing exercises. CR-01 is the reason that " +
				"rule exists; if the template genuinely stopped shipping one, delete this pair " +
				"deliberately rather than letting it pass vacuously",
		).toBeGreaterThan(0);

		expect(
			Object.keys(installedAuth).sort(),
			"every provider entry the template ships with a REAL value must arrive, and every " +
				"entry still holding a REPLACE_WITH_ placeholder must NOT. Installing a " +
				"placeholder is worse than installing nothing: Pi's Bedrock chain is " +
				"`credential?.env?.AWS_PROFILE ?? ambient AWS_PROFILE` " +
				"(pi-ai amazon-bedrock.ts:65), so a stored placeholder SHADOWS a working " +
				"exported AWS_PROFILE and silently breaks a machine where Bedrock worked " +
				"before bootstrap ran [CR-01]",
		).toEqual(installable);

		expect(
			run.stdout,
			"the withheld entries must be REPORTED. A silent omission is indistinguishable " +
				"from a merge step that never ran, and the operator has no way to learn that " +
				"they still have to configure that provider",
		).toContain(withheld.join(", "));
	}, TIMEOUT_MS);

	it("case 1b -- CR-01: a working ambient AWS_PROFILE survives a bootstrap run", async () => {
		// Pi prefers a stored AWS_PROFILE over the ambient one, so installing the template's placeholder silently broke
		// Bedrock on a laptop where `export AWS_PROFILE=...` already worked.
		const agentDir = cleanDir;
		const run = clean;
		expectReachedTheScript(run);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		const ambient = "kypi-fixture-ambient-profile";
		const installedAuth = readJson(join(agentDir, "auth.json"));

		// On the ambient branch Pi returns `env: credential?.env` (undefined) and `source: "AWS_PROFILE"`
		// (pi-ai dist/providers/amazon-bedrock.js:64-71); `source` flips to "stored credential" once a placeholder is stored.
		await withModelsConfig(
			{
				models: join(agentDir, "models.json"),
				auth: installedAuth,
				env: scopedAwsEnv({ AWS_PROFILE: ambient }),
			},
			async (handle) => {
				const result = await handle.registry.getProviderAuth(BEDROCK_PROVIDER_ID);

				expect(
					result,
					"Bedrock resolved NO credential at all with an exported AWS_PROFILE, so the " +
						"source assertion below would be vacuous",
				).toBeDefined();

				expect(
					result?.source,
					`the exported AWS_PROFILE=${ambient} must still be what answers after bootstrap ` +
						'ran. "stored credential" here means the installer wrote an auth.json entry ' +
						"that WINS over the ambient variable (pi-ai amazon-bedrock.js:64-71), which " +
						"on a laptop where Bedrock worked before is a silent outage: every request " +
						"then resolves the profile that entry names. docs/RUNBOOK.md RB-03-03 step 1 " +
						"asks the operator to check exactly this variable [CR-01]",
				).toBe("AWS_PROFILE");

				expect(
					JSON.stringify(result?.env ?? null),
					"the resolved credential carries a stored env block. On the ambient branch Pi " +
						"returns `env: credential?.env`, i.e. undefined, so anything here means a " +
						"stored entry answered -- and a REPLACE_WITH_ placeholder is the one this " +
						"installer used to write [CR-01]",
				).not.toContain(TEMPLATE_SENTINEL_PREFIX);
			},
		);
	}, TIMEOUT_MS);

	it("case 1c -- CR-02: the agent directory and auth.json are created with Pi's own modes", () => {
		// Pi creates ~/.pi/agent 0700 and auth.json 0600 only when absent (pi dist/core/auth-storage.js:21-31), and never
		// re-chmods the directory, so bootstrap creating it first must use the same modes.
		// cleanDir is a path the script created: mkdtempSync makes 0700 directories, which would pass whatever it did.
		const agentDir = cleanDir;
		const run = clean;
		expectReachedTheScript(run);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		const authPath = join(agentDir, "auth.json");
		expect(
			existsSync(authPath),
			"no auth.json was created, so the mode assertions below would be about a file " +
				"that does not exist",
		).toBe(true);

		if (process.platform === "win32") {
			// Windows has no POSIX mode bits, so only existence and kind are checkable; the mode check runs on macOS CI.
			expect(statSync(agentDir).isDirectory()).toBe(true);
			expect(statSync(authPath).isFile()).toBe(true);
			return;
		}

		expect(
			(statSync(agentDir).mode & 0o777).toString(8),
			"the agent directory is looser than the 0700 Pi would have created " +
				"(auth-storage.js:23). Because bootstrap created it first, Pi's " +
				"`if (!existsSync(dir))` guard will never fire again and this mode is " +
				"permanent -- any other local account can list and read the directory holding " +
				"auth.json, models.json and every session transcript [CR-02]",
		).toBe("700");

		expect(
			(statSync(authPath).mode & 0o777).toString(8),
			"auth.json is looser than the 0600 Pi would have created (auth-storage.js:27-29). " +
				"Pi repairs this one on its first write, so the window is smaller than the " +
				"directory's -- but it is the file a credential is about to be written into and " +
				"there is no reason to open it wider than its owner [CR-02]",
		).toBe("600");
	}, TIMEOUT_MS);

	it("case 2 -- a second run is byte-identical in both files", () => {
		const agentDir = cleanDir;

		const first = clean;
		expectReachedTheScript(first);
		expect(first.status, `first run stderr:\n${first.stderr}`).toBe(0);
		const modelsA = readFileSync(join(agentDir, "models.json"), "utf-8");
		const authA = readFileSync(join(agentDir, "auth.json"), "utf-8");

		const second = runFullBootstrap(agentDir);
		expect(second.status, `second run stderr:\n${second.stderr}`).toBe(0);
		const modelsB = readFileSync(join(agentDir, "models.json"), "utf-8");
		const authB = readFileSync(join(agentDir, "auth.json"), "utf-8");

		expect(
			modelsB,
			"a key-namespaced merge must produce a byte-identical file when the key is " +
				"already current -- anything else corrupts user config over time",
		).toBe(modelsA);
		expect(
			authB,
			"a merge-if-absent installer must produce a byte-identical auth.json when every " +
				"key is already present -- anything else rewrites a credential file on every " +
				"single bootstrap run",
		).toBe(authA);

		expect(
			second.stdout,
			"the no-op must SAY it was a no-op. That report is what makes an unchanged file " +
				"evidence of a correct merge rather than evidence of a step that silently did " +
				"not run",
		).toContain("already current - unchanged");
	}, TIMEOUT_MS);

	it("case 3 -- an existing auth.json is never modified: not the foreign entry, not ours", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const authPath = join(agentDir, "auth.json");

		// A foreign provider plus our own key holding a user-chosen value: merge-if-absent means absent, never different.
		const existing = {
			"some-other-vendor": { type: "api_key", key: "$KYPI_FIXTURE_FOREIGN_VENDOR_KEY" },
			dashscope: { type: "api_key", key: "!kypi-fixture-secret-tool --print" },
		};
		writeFileSync(authPath, `${JSON.stringify(existing, null, 2)}\n`, "utf-8");

		const run = runFullBootstrap(agentDir);
		expectReachedTheScript(run);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		const after = readJson(authPath);

		expect(
			after["some-other-vendor"],
			"the installer modified a provider entry it did not ship. On a real machine that " +
				"entry is a live credential for a provider this harness knows nothing about, " +
				"and there is no undo -- this is the single worst outcome available in this " +
				"phase [threat T-03-06-01]",
		).toEqual(existing["some-other-vendor"]);

		expect(
			after[DASHSCOPE],
			"the installer overwrote an EXISTING dashscope entry with the template's. The " +
				'rule is merge-if-absent, not "absent or different": the user\'s own value for ' +
				"a key we happen to also ship is still the user's, and a `!command` credential " +
				"replaced by a `$ENV_VAR` reference is a working login turned into a broken one",
		).toEqual(existing.dashscope);

		// The paired positive. Without it, a bootstrap that crashed before ever
		// reaching merge_auth_json would satisfy both assertions above perfectly.
		const { installable, withheld } = authTemplatePartition();
		expect(
			Object.keys(after).sort(),
			"the absent, installable template entries must have been ADDED in the same run " +
				"that left the two existing ones alone. If they were not, this case proves only " +
				"that the installer did nothing, which is not the same claim. A placeholder " +
				"entry must still be withheld even here [CR-01]",
		).toEqual([...new Set([...installable, ...Object.keys(existing)])].sort());

		for (const key of withheld) {
			expect(
				Object.hasOwn(after, key),
				`'${key}' still carries a REPLACE_WITH_ placeholder in the template and was ` +
					"installed anyway. A stored placeholder beats the ambient AWS_PROFILE in Pi's " +
					"own resolution order, so this is a silent outage rather than an unhelpful " +
					"default [CR-01]",
			).toBe(false);
		}
	}, TIMEOUT_MS);

	it("case 4 -- invalid JSON in models.json is refused, not overwritten", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const modelsPath = join(agentDir, "models.json");

		const corrupt = '{ "providers": { "dashscope": { "name": "half a file"\n';
		writeFileSync(modelsPath, corrupt, "utf-8");
		const before = readFileSync(modelsPath);

		const run = runFullBootstrap(agentDir);
		expectReachedTheScript(run);

		expect(run.status, `stdout:\n${run.stdout}`).not.toBe(0);
		expect(
			run.stderr,
			"a refusal must NAME the file it refused to touch. A bare failure sends the user " +
				"looking through every file the script writes",
		).toContain("models.json");
		expect(run.stderr).toContain("Refusing to touch it");

		expect(
			readFileSync(modelsPath).equals(before),
			"the installer refused and wrote anyway. A refusal that still writes is strictly " +
				"worse than no refusal: it destroys the file AND reports that it did not",
		).toBe(true);
	}, TIMEOUT_MS);

	it("case 4b -- invalid JSON in auth.json is refused, not overwritten", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const authPath = join(agentDir, "auth.json");

		const corrupt = '{ "dashscope": { "type": "api_key",\n';
		writeFileSync(authPath, corrupt, "utf-8");
		const before = readFileSync(authPath);

		const run = runFullBootstrap(agentDir);
		expectReachedTheScript(run);

		expect(run.status, `stdout:\n${run.stdout}`).not.toBe(0);
		expect(run.stderr, "the refusal must name auth.json").toContain("auth.json");
		expect(run.stderr).toContain("Refusing to touch it");

		expect(
			readFileSync(authPath).equals(before),
			"a credential file that failed to parse was rewritten. Whatever was in there is " +
				"now gone, and the file that replaced it is not the one the user was editing",
		).toBe(true);

		// The models merge runs first and must have succeeded, so the failure is
		// demonstrably the auth refusal rather than an unrelated early abort.
		expect(
			existsSync(join(agentDir, "models.json")),
			"models.json is absent, so the run aborted before reaching either merge and the " +
				"assertions above are about a script that never got to auth.json",
		).toBe(true);
	}, TIMEOUT_MS);

	it("case 5 -- KYPI_DASHSCOPE_BASE_URL reaches the installed file, never the repo", () => {
		const agentDir = tempDir("kypi-agentdir-");

		// Loopback-shaped and synthetic: a workspace host would name a real workspace id. https, because the installer
		// refuses cleartext (the key is sent as a bearer token); nothing here connects.
		const dedicated = "https://127.0.0.1:9/compatible-mode/v1";
		const templateBefore = readFileSync(MODELS_TEMPLATE);

		const run = runFullBootstrap(agentDir, { KYPI_DASHSCOPE_BASE_URL: dedicated });
		expectReachedTheScript(run);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		const dashscope = installedProviders(agentDir)[DASHSCOPE] as Record<string, unknown>;
		expect(
			dashscope.baseUrl,
			"the install-time base-URL seam did not reach the installed file. It is the " +
				"documented remedy in RB-03-01 when the shared host will not resolve, and " +
				"without it the only way to select the workspace-dedicated form is to commit a " +
				"workspace id",
		).toBe(dedicated);

		expect(
			readFileSync(MODELS_TEMPLATE).equals(templateBefore),
			"the committed template changed during an install. The whole point of the seam is " +
				"that the account-identifying host lives only in ~/.pi/agent/models.json, " +
				"outside git [threat T-03-06-03]",
		).toBe(true);
		expect(
			readFileSync(MODELS_TEMPLATE, "utf-8"),
			"the committed template must still carry the SHARED international host. If it " +
				"carries a dedicated one, a workspace id is already in this public repository",
		).toContain("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
	}, TIMEOUT_MS);

	it("case 5a -- an unset KYPI_DASHSCOPE_BASE_URL keeps an installed https endpoint and does not print it", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const dedicated = "https://127.0.0.1:9/compatible-mode/v1";
		expect(runFullBootstrap(agentDir, { KYPI_DASHSCOPE_BASE_URL: dedicated }).status).toBe(0);

		const rerun = runFullBootstrap(agentDir);
		expect(rerun.status, `stderr:\n${rerun.stderr}`).toBe(0);
		expect(rerun.stdout).toContain("keeps its installed non-default endpoint");
		expect(rerun.stderr + rerun.stdout).not.toContain("127.0.0.1");
		expect((installedProviders(agentDir)[DASHSCOPE] as { baseUrl?: string }).baseUrl).toBe(dedicated);

		const shared = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
		expect(runFullBootstrap(agentDir, { KYPI_DASHSCOPE_BASE_URL: shared }).status).toBe(0);
		expect((installedProviders(agentDir)[DASHSCOPE] as { baseUrl?: string }).baseUrl).toBe(shared);
	}, TIMEOUT_MS);

	it.each([
		[
			"http",
			"http://dashscope-intl.aliyuncs.com/compatible-mode/v1",
			"must be https",
			"an http:// endpoint puts $DASHSCOPE_API_KEY on the wire in cleartext on EVERY " +
				"request. Pi never validates baseUrl (provider-composer.ts:142) and never " +
				"interpolates it, so nothing else anywhere would report this",
		],
		[
			"not a URL",
			"dashscope-intl.aliyuncs.com/compatible-mode/v1",
			"not a parseable absolute URL",
			"a scheme-less value is not a URL. Without a parse here it lands in models.json " +
				"and fails much later inside the adapter as an opaque fetch error, at which " +
				"point RB-03-01's remedy looks like it did not work",
		],
	])(
		"case 5b -- WR-07: KYPI_DASHSCOPE_BASE_URL that is %s is refused, and nothing is written",
		(_label, value, expectedMessage, why) => {
			const agentDir = tempDir("kypi-agentdir-");
			const run = runFullBootstrap(agentDir, { KYPI_DASHSCOPE_BASE_URL: value });
			expectReachedTheScript(run);

			expect(run.status, `${why}\nstdout:\n${run.stdout}`).not.toBe(0);
			expect(
				run.stderr,
				"a refusal must NAME the variable and say what is wrong with the value, because " +
					"RB-03-01 is where the operator was told to set it",
			).toContain("KYPI_DASHSCOPE_BASE_URL");
			expect(run.stderr).toContain(expectedMessage);

			expect(
				existsSync(join(agentDir, "models.json")),
				"the installer refused and wrote models.json anyway, so the bad base URL is now " +
					"the configured endpoint and the refusal was cosmetic",
			).toBe(false);
		},
		TIMEOUT_MS,
	);

	it("case 5c -- WR-06: .env.example with markers out of order is refused, not duplicated", () => {
		// Presence alone does not catch END above START: the slices overlap and the file grows on every run. Written into
		// this case's own REPO_ROOT copy.
		const START = "# ky-pi-agent managed:start";
		const END = "# ky-pi-agent managed:end";
		const scrambled = [
			"# hand-edited header",
			END,
			"DASHSCOPE_API_KEY=",
			START,
			"# hand-edited footer",
			"",
		].join("\n");
		const repoCopy = bootstrapRepoCopy();
		writeFileSync(repoCopy.envExample, scrambled, "utf-8");

		const agentDir = tempDir("kypi-agentdir-");
		const run = runFullBootstrap(agentDir, {}, repoCopy);
		expectReachedTheScript(run);

		expect(run.status, `stdout:\n${run.stdout}`).not.toBe(0);
		expect(
			run.stderr,
			"the refusal must name the file and the reason. A bare failure sends the user " +
				"through every file the script writes",
		).toContain("managed markers");

		const after = readFileSync(repoCopy.envExample, "utf-8");
		expect(
			after,
			"the installer refused and rewrote the file anyway. A refusal that still writes is " +
				"strictly worse than no refusal [WR-06]",
		).toBe(scrambled);
		expect(
			after.split(START).length - 1,
			"the START marker was duplicated, which is the overlapping-slice corruption itself: " +
				"the file is not idempotent any more and every later run grows it [WR-06]",
		).toBe(1);
		expect(after.split(END).length - 1, "the END marker was duplicated [WR-06]").toBe(1);
	}, TIMEOUT_MS);

	it("case 6 -- PROV-01: the installed pair resolves $DASHSCOPE_API_KEY from the environment", async () => {
		const agentDir = cleanDir;
		const run = clean;
		expectReachedTheScript(run);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		// Obviously synthetic, and it never leaves this process or the temp dir.
		const fixture = "kypi-fixture-not-a-real-dashscope-key";
		const installedAuth = readJson(join(agentDir, "auth.json"));

		await withModelsConfig(
			{
				models: join(agentDir, "models.json"),
				auth: installedAuth,
				env: { DASHSCOPE_API_KEY: fixture },
			},
			async (handle) => {
				const result = await handle.registry.getProviderAuth(DASHSCOPE);

				expect(
					result,
					"Pi resolved NO credential from the pair this installer just wrote. PROV-01 " +
						"is precisely the claim that a fresh clone plus a bootstrap run yields a " +
						"config whose values resolve at runtime from $ENV_VAR",
				).toBeDefined();
				expect(
					result?.auth.apiKey,
					"the resolved key must be the value in the environment. `undefined` means the " +
						'reference never resolved; the literal "$DASHSCOPE_API_KEY" means it was ' +
						"passed through as text and would be sent to DashScope as the bearer token",
				).toBe(fixture);
				expect(
					result?.source,
					"the credential must be reported as coming from the stored file, so the " +
						"assertion above is about the installed auth.json rather than about the " +
						"models.json literal or something ambient on this machine",
				).toBe("stored credential");
			},
		);

		// Negative control: blanking makes this independent of machine state. With the variable blank Pi resolves the
		// entry to undefined, so `toBeUndefined` carries the case; the `not.toBe` checks are weak on their own.
		await withModelsConfig(
			{
				models: join(agentDir, "models.json"),
				auth: installedAuth,
				env: { DASHSCOPE_API_KEY: "" },
			},
			async (handle) => {
				const result = await handle.registry.getProviderAuth(DASHSCOPE);

				expect(
					result?.auth.apiKey,
					"with nothing in the environment, the resolver handed back the literal " +
						"reference. That is the failure PROV-01 is about: it does not error, it " +
						"sends the string `$DASHSCOPE_API_KEY` as a bearer token and reads as a 401",
				).not.toBe("$DASHSCOPE_API_KEY");
				expect(
					result?.auth.apiKey,
					"the fixture value survived into a run that did not set it, so the positive " +
						"assertion above proves nothing about resolution -- something is caching it " +
						"across callbacks",
				).not.toBe(fixture);
				expect(
					result,
					"with nothing in the environment, Pi must resolve NO credential at all. A " +
						"defined result here means the reference resolved to something -- the " +
						"literal, an empty bearer token, or a value that leaked from the previous " +
						"callback -- and the positive assertion above would then be satisfied by " +
						"whatever answered rather than by the environment",
				).toBeUndefined();
			},
		);
	}, TIMEOUT_MS);
});

/** A paste guard, not a secret scanner: 40+ token-alphabet characters, as in docs-policy.test.ts. */
const TOKEN_SHAPED = /[A-Za-z0-9+/=_-]{40,}/g;

/**
 * Runs the paste guard must not report: rule lines (one repeated character) and pure-alphabetic identifiers, since
 * every credential format in scope carries a digit or a non-alphanumeric. Asserted live below, both directions.
 */
function isStructuralRun(run: string): boolean {
	return /^(.)\1*$/.test(run) || /^[A-Za-z]+$/.test(run);
}

function tokenShapedRuns(text: string): string[] {
	return (text.match(TOKEN_SHAPED) ?? []).filter((run) => !isStructuralRun(run));
}

/** Every string value in a parsed template, at any depth. Keys are not values. */
function stringValues(node: unknown, out: string[] = []): string[] {
	if (typeof node === "string") {
		out.push(node);
	} else if (Array.isArray(node)) {
		for (const item of node) {
			stringValues(item, out);
		}
	} else if (node !== null && typeof node === "object") {
		for (const value of Object.values(node)) {
			stringValues(value, out);
		}
	}
	return out;
}

describe("PROV-01 -- neither committed template carries a secret", () => {
	const templates: ReadonlyArray<readonly [string, string]> = [
		[".pi/templates/models-template.json", readFileSync(MODELS_TEMPLATE, "utf-8")],
		[".pi/templates/auth-template.json", readFileSync(AUTH_TEMPLATE, "utf-8")],
	];

	// The whole parsed document, not one provider: a short key under a second provider evades the 40-character scan.
	const parsed: ReadonlyArray<readonly [string, string[]]> = [
		[
			".pi/templates/models-template.json",
			stringValues(parseModelsTemplate(readFileSync(MODELS_TEMPLATE, "utf-8"))),
		],
		[".pi/templates/auth-template.json", stringValues(readJson(AUTH_TEMPLATE))],
	];

	it("case 7 guard -- the scanned sets are non-empty, and the models walk is not one key deep", () => {
		// Every assertion below iterates these, so an empty one turns the whole
		// scan into a pass that verified nothing.
		expect(templates.length).toBe(2);
		for (const [path, text] of templates) {
			expect(text.length, `${path} is empty`).toBeGreaterThan(0);
		}
		for (const [path, values] of parsed) {
			expect(values.length, `${path} parsed to zero string values`).toBeGreaterThan(0);
		}

		// Every string value must be scanned. With one provider today this cannot tell a narrow walk from a full one; it is
		// a tripwire, and case 7b is the live proof that the walk goes past one key.
		const scanned = new Set(parsed[0]?.[1] ?? []);
		const whole = stringValues(parseModelsTemplate(readFileSync(MODELS_TEMPLATE, "utf-8")));
		expect(
			whole.filter((value) => !scanned.has(value)),
			"a string value in .pi/templates/models-template.json is not in the scanned set, " +
				"so the value checks below cannot see it. A credential pasted there would pass " +
				"every assertion in this describe block [WR-02]",
		).toEqual([]);
	});

	for (const [path, text] of templates) {
		it(`case 7 -- ${path} carries no token-shaped run`, () => {
			expect(
				tokenShapedRuns(text),
				`${path} contains a 40+ character token-alphabet run. This repository is public; ` +
					"such a run is almost always a pasted credential. If it is a false positive, " +
					"narrow the pattern deliberately and say why, rather than deleting the check " +
					"[threat T-03-06-04]",
			).toEqual([]);
		});
	}

	for (const [path, values] of parsed) {
		it(`case 7 -- ${path} has no credential-shaped value`, () => {
			// `\b` on the sk- prefix: the bare substring matches ordinary identifiers.
			expect(
				values.filter((value) => /\bsk-/.test(value)),
				`${path} carries an sk- prefixed value -- that is the shape of both a DashScope ` +
					"and a DeepSeek API key",
			).toEqual([]);
			expect(
				values.filter((value) => value.includes("AKIA")),
				`${path} carries an AKIA-prefixed value -- that is an AWS access key id`,
			).toEqual([]);
			expect(
				values.filter((value) => value.startsWith("!")),
				`${path} carries a value beginning with "!", which Pi executes as a shell ` +
					"command. In models.json that is a subprocess spawn on EVERY request " +
					"(PROV-02, docs/models.md:172); in either file a committed one is a command " +
					"line this repository would be running on someone else's machine",
			).toEqual([]);
		});
	}

	it("case 7b -- WR-02: the value scan reaches a provider that is not dashscope", () => {
		// Paired negative: a synthetic document with a short key under a second provider, which a one-key walk misses.
		const evasive = {
			providers: {
				dashscope: { name: "DashScope", baseUrl: "https://example.invalid/v1" },
				scratch: { apiKey: `sk${"-"}abc123def456` },
				other: { apiKey: "!kypi-fixture-print-secret --now" },
			},
		};

		const values = stringValues(evasive);

		expect(
			values.filter((value) => /\bsk-/.test(value)),
			"the value walk did not reach providers.scratch, so a short API key outside the " +
				"dashscope sub-object is invisible to the scan. That is exactly the hole the " +
				"one-key walk left: 14 characters is under TOKEN_SHAPED's 40-character floor, so " +
				"the text scan does not see it either [WR-02]",
		).not.toEqual([]);

		expect(
			values.filter((value) => value.startsWith("!")),
			"the value walk did not reach providers.other, so a `!command` value outside " +
				"dashscope is invisible here -- while tests/unit/command-interpolation.test.ts " +
				"walks every leaf of the same file and DOES catch it. Two scans of one document " +
				"disagreeing about their own scope is how one of them stops being a check [WR-02]",
		).not.toEqual([]);

		// …and the narrow walk really would have missed both, so the widening is a
		// widening rather than a restatement.
		const narrow = stringValues(evasive.providers.dashscope);
		expect(
			narrow.filter((value) => /\bsk-/.test(value) || value.startsWith("!")),
			"the OLD one-key walk finds the planted values too, so this case does not " +
				"demonstrate a difference and proves nothing about the change",
		).toEqual([]);
	});

	it("case 7c -- IN-01: every variable in the env template is one this harness reads", () => {
		// A name in .env.example invites the operator to mint a credential, so every managed name must be read by something
		// tracked outside the env templates; a rule, not an allowlist that would drift.
		const template = readFileSync(join(repoRoot(), ".pi", "templates", "env.example"), "utf-8");
		const managed = template.slice(
			template.indexOf("# ky-pi-agent managed:start"),
			template.indexOf("# ky-pi-agent managed:end"),
		);
		const names = [...managed.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1] ?? "");

		expect(
			names.length,
			"the managed block declares no variables, so the loop below iterates nothing and " +
				"this case would pass over a template that had been emptied [IN-01]",
		).toBeGreaterThanOrEqual(4);

		// Consumers exclude the env templates (where names are declared) and tests/, where naming a variable documents a
		// check and would let a variable certify itself.
		const consumers = trackedFiles()
			.filter(
				(path) =>
					path !== ".env.example" &&
					path !== ".pi/templates/env.example" &&
					!path.startsWith(".planning/") &&
					!path.startsWith("tests/") &&
					path !== "CLAUDE.md",
			)
			.map((path) => {
				try {
					return readFileSync(join(repoRoot(), path), "utf-8");
				} catch {
					return "";
				}
			});

		const unread = names.filter((name) => !consumers.some((text) => text.includes(name)));
		expect(
			unread,
			`these variables are advertised in .pi/templates/env.example and read by nothing ` +
				"tracked in this repository. Each one asks the operator to mint and store a " +
				"credential for something the harness cannot use. Either delete the line, or add " +
				"it in the same commit as the code that reads it [IN-01]",
		).toEqual([]);
	});

	it("case 7 -- the scan is live: it flags a synthetic token in every shape", () => {
		// Proves the scan can fail; assembled from pieces so this file holds no key-like literal.
		const synthetic = `sk${"-"}0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3a4b5c6d`;
		expect(
			tokenShapedRuns(synthetic),
			"the narrowed paste guard did not match a synthetic token, so every green " +
				"assertion above is vacuous",
		).not.toEqual([]);
		expect(/\bsk-/.test(synthetic)).toBe(true);
		expect(tokenShapedRuns(`AKIA${"IOSFODNN7EXAMPLE"}0123456789012345678901234`)).not.toEqual([]);

		// …and the two narrowings are real narrowings, not dead code: each fires on
		// the shape it was written for, and neither swallows a token.
		expect(isStructuralRun("-".repeat(75)), "a rule line must be excluded").toBe(true);
		expect(
			isStructuralRun("requiresReasoningContentOnAssistantMessages"),
			"a pure-alphabetic compat key must be excluded",
		).toBe(true);
		expect(isStructuralRun(synthetic), "a token must NOT be excluded").toBe(false);

		// And the raw pattern really does hit them, so the exclusions are load-bearing
		// rather than decoration for a scan that would have passed anyway.
		expect("-".repeat(75).match(TOKEN_SHAPED)).not.toBeNull();
		expect("requiresReasoningContentOnAssistantMessages".match(TOKEN_SHAPED)).not.toBeNull();
	});
});

describe("global setup -- user settings, theme, agent scan dir and the pinned packages", () => {
	afterEach(scratch.cleanup);

	const PINS = [
		"npm:@narumitw/pi-lsp@0.49.9",
		"npm:pi-session-finder@0.5.6",
		"npm:pi-subagents@0.76.1",
		"npm:pi-web-access@0.38.0",
	];
	const DISABLES = ["-builtin:mcp", "-builtin:llama.cpp", "-builtin:codemode", "-builtin:tool-search"];

	const stubFile = (agentDir: string): string => join(agentDir, "extensions", "ky-safety", "index.ts");

	/** The user-level entry that loads this checkout's harness without a second guard. */
	const harnessEntry = (repoCopy: BootstrapRepoCopy) => ({
		source: repoCopy.root.replace(/\\/g, "/"),
		extensions: ["!.pi/extensions/safety/**"],
	});

	/** A stub of the shape a full run writes: an import of the copy's guard inside a try/catch. */
	function seedStub(agentDir: string, repoCopy: BootstrapRepoCopy, failClosed = true): void {
		const target = join(repoCopy.root, ".pi", "extensions", "safety", "index.ts").replace(/\\/g, "/");
		const load = `const mod = await import("${target}");\nawait mod.default(pi);`;
		const body = failClosed ? `try {\n${load}\n} catch (error) {\npi.on("tool_call", () => ({ block: true }));\n}` : load;
		mkdirSync(join(agentDir, "extensions", "ky-safety"), { recursive: true });
		writeFileSync(stubFile(agentDir), `export default async function (pi) {\n${body}\n}\n`, "utf-8");
	}

	function runMode(
		args: string[],
		agentDir: string,
		repoCopy: BootstrapRepoCopy,
		extraEnv: Record<string, string> = { KYPI_SKIP_INSTALL: "1" },
		seed = true,
	): Run & { piLog: string } {
		if (seed && args[0] === "--global-setup" && !existsSync(stubFile(agentDir))) seedStub(agentDir, repoCopy);
		const logDir = tempDir("kypi-log-");
		const log = join(logDir, "npm.log").replace(/\\/g, "/");
		const piLog = join(logDir, "pi.log").replace(/\\/g, "/");
		return withStubBin({ npm: bootstrapNpmStub(log, "0.84.1"), pi: { exitCode: 0, logTo: piLog } }, (env) => {
			const result = spawnSync("sh", [repoCopy.bootstrapSh, ...args], {
				cwd: repoCopy.root,
				env: { ...env, PI_CODING_AGENT_DIR: agentDir, KYPI_DASHSCOPE_BASE_URL: "", ...extraEnv },
				encoding: "utf-8",
				timeout: TIMEOUT_MS,
				windowsHide: true,
			});
			if (result.error) throw new Error(`failed to run bootstrap: ${result.error.message}`);
			return {
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? "",
				status: result.status,
				log: existsSync(log) ? readFileSync(log, "utf-8") : "",
				piLog: existsSync(piLog) ? readFileSync(piLog, "utf-8") : "",
			};
		});
	}

	function settingsOf(agentDir: string): Record<string, unknown> {
		return JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8")) as Record<string, unknown>;
	}

	it("case 1 -- an empty agent dir gains the pins, the disables, the theme and the agent scan dir", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();

		const run = runMode(["--global-setup"], agentDir, repoCopy);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expectReachedTheScript(run);

		const settings = settingsOf(agentDir);
		expect(settings.packages).toEqual([...PINS, harnessEntry(repoCopy)]);
		expect(settings.extensions).toEqual(DISABLES);
		expect(settings.theme).toBe("ky");
		expect(settings.subagents).toEqual({
			agentScanDirs: [join(repoCopy.root, ".pi", "agents").replace(/\\/g, "/")],
		});
		expect(settings.kyPiAgent).toMatchObject({ bootstrapVersion: "1", piPinned: "1.1.0" });

		expect(readFileSync(join(agentDir, "themes", "ky.json"), "utf-8")).toBe(
			readFileSync(join(repoRoot(), ".pi", "themes", "ky.json"), "utf-8"),
		);
	}, TIMEOUT_MS);

	it("case 2 -- user packages, extensions, theme and kyPiAgent keys survive, and a second run is byte-identical", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({
				packages: ["npm:foo@1.0.0"],
				extensions: ["./mine.ts"],
				theme: "dark",
				kyPiAgent: { bedrockProfilePrefix: "us." },
			}),
			"utf-8",
		);

		const first = runMode(["--global-setup"], agentDir, repoCopy);
		expect(first.status, `stderr:\n${first.stderr}`).toBe(0);
		const afterFirst = readFileSync(join(agentDir, "settings.json"), "utf-8");
		const settings = JSON.parse(afterFirst) as Record<string, unknown>;
		expect(settings.packages).toEqual(["npm:foo@1.0.0", ...PINS, harnessEntry(repoCopy)]);
		expect(settings.extensions).toEqual(["./mine.ts", ...DISABLES]);
		expect(settings.theme).toBe("dark");
		expect(settings.kyPiAgent).toMatchObject({ bedrockProfilePrefix: "us.", bootstrapVersion: "1" });

		const second = runMode(["--global-setup"], agentDir, repoCopy);
		expect(second.status, `stderr:\n${second.stderr}`).toBe(0);
		expect(readFileSync(join(agentDir, "settings.json"), "utf-8")).toBe(afterFirst);
		expect(second.stdout).toContain("settings.json kyPiAgent already current - unchanged");
	}, TIMEOUT_MS);

	it("case 3 -- a different pinned version of one of our packages is refused, naming both versions", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		const seeded = JSON.stringify({ packages: ["npm:pi-subagents@0.50.0"] });
		writeFileSync(join(agentDir, "settings.json"), seeded, "utf-8");

		const run = runMode(["--global-setup"], agentDir, repoCopy);

		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain("npm:pi-subagents@0.50.0");
		expect(run.stderr).toContain("npm:pi-subagents@0.76.1");
		expect(readFileSync(join(agentDir, "settings.json"), "utf-8")).toBe(seeded);
	}, TIMEOUT_MS);

	it("case 4 -- global setup touches no credential, model, env or safety-stub file", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		seedStub(agentDir, repoCopy);
		const stubBefore = readFileSync(stubFile(agentDir), "utf-8");

		const run = runMode(["--global-setup"], agentDir, repoCopy);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		expect(existsSync(join(agentDir, "auth.json"))).toBe(false);
		expect(existsSync(join(agentDir, "models.json"))).toBe(false);
		expect(readFileSync(stubFile(agentDir), "utf-8")).toBe(stubBefore);
		expect(existsSync(repoCopy.envExample)).toBe(false);
	}, TIMEOUT_MS);

	it.each([
		["no stub and no git package", false],
		["a stub without the fail-closed catch", true],
	])("case 4b -- %s: global setup refuses before installing anything", (_name, legacy) => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		if (legacy) seedStub(agentDir, repoCopy, false);

		const run = runMode(["--global-setup"], agentDir, repoCopy, {}, false);

		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain("without the safety guard");
		expect(run.piLog).not.toContain("pi install");
		expect(existsSync(join(agentDir, "settings.json"))).toBe(false);
	}, TIMEOUT_MS);

	it("case 4c -- the git package alone is a delivery path", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		const settings = { packages: ["git:github.com/kaiyitkoh/ky-pi-agent@v1.0.0"] };
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings), "utf-8");

		const run = runMode(["--global-setup"], agentDir, repoCopy, { KYPI_SKIP_INSTALL: "1" }, false);

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toContain("delivered by the user-level git package");
		expect(run.stdout).toContain("harness package not added");
		expect((settingsOf(agentDir).packages as unknown[]).filter((p) => typeof p === "object")).toEqual([]);
	}, TIMEOUT_MS);

	it("case 4e -- an entry the user already has for this checkout is left exactly as configured", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		const mine = { source: `${repoCopy.root.replace(/\\/g, "/")}/`, skills: [] };
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [mine] }), "utf-8");

		const run = runMode(["--global-setup"], agentDir, repoCopy);

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(settingsOf(agentDir).packages).toEqual([mine, ...PINS]);
		expect(run.stdout).toContain("left as configured");
	}, TIMEOUT_MS);

	it("case 4e2 -- kyPiAgent.harnessPackage false keeps the entry out, and our own entry is reported current", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ kyPiAgent: { harnessPackage: false } }), "utf-8");
		const optedOut = runMode(["--global-setup"], agentDir, repoCopy);
		expect(optedOut.status, `stderr:\n${optedOut.stderr}`).toBe(0);
		expect(optedOut.stdout).toContain("kyPiAgent.harnessPackage is false");
		expect(settingsOf(agentDir).packages).toEqual(PINS);

		const other = tempDir("kypi-agentdir-");
		runMode(["--global-setup"], other, repoCopy);
		const second = runMode(["--global-setup"], other, repoCopy);
		expect(second.stdout).toContain(`harness package ${harnessEntry(repoCopy).source} already current - unchanged`);
	}, TIMEOUT_MS);

	it("case 4e3 -- a full run that stops before the stub leaves no harness entry that filters the guard out", () => {
		const agentDir = tempDir("kypi-agentdir-");
		writeFileSync(join(agentDir, "models.json"), "{ not json", "utf-8");

		const run = runFullBootstrap(agentDir);

		expect(run.status).not.toBe(0);
		expect(existsSync(stubFile(agentDir))).toBe(false);
		const packages = (settingsOf(agentDir).packages ?? []) as unknown[];
		expect(packages.filter((p) => typeof p === "object")).toEqual([]);
	}, TIMEOUT_MS);

	it("case 4f -- dependencies missing from the checkout are installed with npm ci after the hardening assertions", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		const manifestFile = join(repoCopy.root, "package.json");
		const manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as { dependencies: Record<string, string> };
		manifest.dependencies["kypi-absent-fixture"] = "1.0.0";
		writeFileSync(manifestFile, JSON.stringify(manifest), "utf-8");

		const run = runMode([], agentDir, repoCopy, {});

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stdout).toContain("kypi-absent-fixture@1.0.0 is not installed");
		const lines = run.log.split("\n");
		const ci = lines.indexOf("npm ci --ignore-scripts");
		expect(ci, run.log).toBeGreaterThan(lines.findIndex((l) => l.startsWith("npm config get ignore-scripts")));
		expect(ci).toBeLessThan(lines.findIndex((l) => l.startsWith("npm install -g")));
	}, TIMEOUT_MS);

	it("case 4g -- dependencies already at their pins are not reinstalled, and KYPI_SKIP_INSTALL skips the step", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();

		const current = runMode(["--global-setup"], agentDir, repoCopy, {});
		expect(current.status, `stderr:\n${current.stderr}`).toBe(0);
		expect(current.stdout).toContain("installed at its pin - no action");
		expect(current.log).not.toContain("npm ci");

		const skipped = runMode(["--global-setup"], agentDir, repoCopy);
		expect(skipped.status, `stderr:\n${skipped.stderr}`).toBe(0);
		expect(skipped.stdout).toContain("skipped: KYPI_SKIP_INSTALL=1");
		expect(skipped.log).not.toContain("npm ci");
	}, TIMEOUT_MS);

	it("case 4d -- a full run refuses a configured git package before it writes the stub", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const settings = { packages: ["git:github.com/kaiyitkoh/ky-pi-agent@v1.0.0"] };
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings), "utf-8");

		const run = runFullBootstrap(agentDir);

		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain("one delivery path only");
		expect(existsSync(stubFile(agentDir))).toBe(false);
	}, TIMEOUT_MS);

	it("case 5 -- without KYPI_SKIP_INSTALL it runs pi install once per pin, after the hardening assertions", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();

		const run = runMode(["--global-setup"], agentDir, repoCopy, {});

		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);
		const installs = run.piLog.split("\n").filter((l) => l.startsWith("pi install"));
		expect(installs).toEqual(PINS.map((p) => `pi install ${p}`));
		expect(run.stdout.indexOf("ignore-scripts=true")).toBeGreaterThan(-1);
		expect(run.stdout.indexOf("ignore-scripts=true")).toBeLessThan(run.stdout.indexOf("pi install npm:"));
		expect(run.log).not.toMatch(/^npm install/m);
	}, TIMEOUT_MS);

	it("case 6 -- a full run merges the apac Bedrock model next to a user model and leaves no temp files", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const repoCopy = bootstrapRepoCopy();
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: { "amazon-bedrock": { baseUrl: "https://example.invalid", models: [{ id: "mine.model" }] } },
			}),
			"utf-8",
		);

		const run = runMode([], agentDir, repoCopy);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		const bedrock = (installedProviders(agentDir)["amazon-bedrock"] ?? {}) as {
			baseUrl?: string;
			models?: Array<{ id: string }>;
		};
		expect(bedrock.baseUrl).toBe("https://example.invalid");
		expect(bedrock.models?.map((m) => m.id)).toEqual([
			"mine.model",
			"apac.anthropic.claude-sonnet-4-5-20250929-v1:0",
		]);

		const before = readFileSync(join(agentDir, "models.json"), "utf-8");
		const second = runMode([], agentDir, repoCopy);
		expect(second.stdout).toContain("models.json providers.amazon-bedrock already current - unchanged");
		expect(readFileSync(join(agentDir, "models.json"), "utf-8")).toBe(before);

		const leftovers = readdirSync(agentDir, { recursive: true }).filter((f) => String(f).includes(".tmp-"));
		expect(leftovers).toEqual([]);
	}, TIMEOUT_MS);
});
