/**
 * PROV-01 / PROV-04 — `bin/bootstrap.sh` installs the two config templates into
 * the directory Pi actually reads, and never destroys a credential that was
 * already there.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Pi resolves `models.json` and `auth.json` from the agent directory only
 * [VERIFIED: pi 0.84.1 dist/config.js:423-425; docs/providers.md:111]. There is
 * no project-scope form of either, so `.pi/templates/models-template.json` and
 * `.pi/templates/auth-template.json` are read by NOTHING until the installer
 * puts them somewhere Pi looks. Plan 03-02 proved the two templates are valid
 * documents; this file proves the other half — that they arrive, that arriving
 * twice changes nothing, and above all that arriving does not overwrite
 * `~/.pi/agent/auth.json`, which on a real machine holds live credentials for
 * every provider the user has ever configured. That overwrite is the worst
 * outcome available anywhere in this phase. [threat T-03-06-01]
 *
 * ---------------------------------------------------------------------------
 * TWO INDEPENDENT GUARDS AGAINST TOUCHING THIS MACHINE
 * ---------------------------------------------------------------------------
 * Every run below sets `PI_CODING_AGENT_DIR` to a fresh directory under
 * `os.tmpdir()` **and** `KYPI_SKIP_INSTALL=1`, with a stubbed `npm` first on
 * PATH whose invocation log is asserted. Two guards rather than one, because
 * the cost of either failing alone is running the real installer against the
 * developer's real agent directory and real global npm prefix — a test that
 * forgot a seam would do exactly what this file exists to forbid.
 * [threat T-03-06-05]
 *
 * The single tracked file a full run legitimately writes — `.env.example` — is
 * snapshotted and restored around every case.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT PROVE
 * ---------------------------------------------------------------------------
 * Nothing here contacts a provider and nothing here could: this machine has no
 * credentials. That the installed `models.json` makes DashScope answer is
 * `RB-03-01` / `RB-03-02` and remains OUTSTANDING; that the installed
 * `auth.json` authenticates Bedrock is `RB-03-03`. Case 6 proves only that Pi
 * resolves the credential document offline, which is a statement about Pi and
 * about the template, never about a provider.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	BEDROCK_PROVIDER_ID,
	TEMPLATE_SENTINEL_PREFIX,
} from "../../.pi/extensions/providers/schema.ts";
import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";
import { type StubSpec, withStubBin } from "../helpers/stub-bin.ts";

/** Forward slashes: Git Bash `sh` will not accept a backslash path argument. */
const BOOTSTRAP = join(repoRoot(), "bin", "bootstrap.sh").replace(/\\/g, "/");

/** npm is stubbed, so no registry round-trip; node startup still dominates. */
const TIMEOUT_MS = 120_000;

const ENV_EXAMPLE = join(repoRoot(), ".env.example");
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

/** Temp directories created by this suite; removed after every case. */
let scratch: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
}

/**
 * A stub `npm` answering each of the four questions the script actually asks.
 *
 * Copied from `bootstrap-check-only.test.ts:141-151`, including the reason:
 * answering one thing to all four would make the stub a caricature, and the
 * version gate would then be "passing" on a token that is not a version.
 */
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

/**
 * Run the real script as a subprocess, exactly as a user or CI would.
 *
 * `sh` is spawned with an args array and `shell: false`: it resolves through
 * PATH as a genuine executable on both platforms, unlike the `.cmd` shims that
 * force `shell: true` for `npm` and `pi` (see `tests/helpers/stub-bin.ts`).
 */
function runFullBootstrap(agentDir: string, extraEnv: Record<string, string> = {}): Run {
	const logDir = tempDir("kypi-log-");
	const log = join(logDir, "npm.log").replace(/\\/g, "/");

	return withStubBin({ npm: npmStub(log) }, (env) => {
		const result = spawnSync("sh", [BOOTSTRAP], {
			cwd: repoRoot(),
			env: {
				...env,
				PI_CODING_AGENT_DIR: agentDir,
				// Both guards, every run. [threat T-03-06-05]
				KYPI_SKIP_INSTALL: "1",
				// Blanked rather than inherited: an ambient value on the developer's
				// machine would silently rewrite the base URL under every case that
				// did not ask for one, and case 5 would then pass by coincidence.
				KYPI_DASHSCOPE_BASE_URL: "",
				...extraEnv,
			},
			encoding: "utf-8",
			timeout: TIMEOUT_MS,
			windowsHide: true,
		});

		if (result.error) {
			throw new Error(`failed to run \`sh ${BOOTSTRAP}\`: ${result.error.message}`);
		}
		return {
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			status: result.status,
			log: existsSync(log) ? readFileSync(log, "utf-8") : "",
		};
	});
}

/**
 * The stub's own call log, asserted BEFORE anything about the installed files.
 *
 * Without it every case here could be an assertion about the developer's REAL
 * npm, and a run that never reached the script at all — a PATH mistake, a
 * silent spawn failure — would look identical from the outside.
 */
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
 * Parse the models template the way `bin/bootstrap.sh` does.
 *
 * WHOLE-LINE ONLY, which is what the template promises in its own header:
 * `models.json` is comment-stripped by Pi (src/core/model-config.ts:261) so
 * every number in it carries its source, but a naive strip of every `//` would
 * eat the `https://` inside `baseUrl`. This duplicates four lines of the
 * installer deliberately — case 1 deep-equals the INSTALLED block against this
 * parse, so a drift between the two strips fails loudly rather than silently.
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

/**
 * The auth template split the way `merge_auth_json` splits it.
 *
 * Computed from the committed bytes rather than written down as two id lists:
 * a hand-typed list is how an assertion silently stops describing the file it
 * claims to be about. [CR-01]
 */
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
 * Every environment variable Pi's Bedrock `resolve()` consults, in its own
 * order [VERIFIED: pi-ai 0.84.1 src/providers/amazon-bedrock.ts:54-79].
 *
 * Duplicated from `tests/unit/bedrock-auth.test.ts` for the reason recorded
 * there: a case that blanked only the variable it talks about would still
 * resolve through an ambient bearer token on a machine that has one, and would
 * then pass for the wrong reason.
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
	// `.env.example` is a TRACKED file the full run legitimately owns. Snapshot
	// its bytes so the working tree is restored no matter what any case does.
	const envBefore = existsSync(ENV_EXAMPLE) ? readFileSync(ENV_EXAMPLE) : null;

	afterEach(() => {
		if (envBefore !== null) {
			if (!existsSync(ENV_EXAMPLE) || !readFileSync(ENV_EXAMPLE).equals(envBefore)) {
				writeFileSync(ENV_EXAMPLE, envBefore);
			}
		} else if (existsSync(ENV_EXAMPLE)) {
			rmSync(ENV_EXAMPLE);
		}

		for (const dir of scratch) {
			try {
				rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
			} catch {
				// A leftover temp dir is noise, not a failure. Never mask a real
				// assertion result behind a cleanup error.
			}
		}
		scratch = [];
	});

	it("case 1 -- a clean install writes both files, compat block intact", () => {
		const agentDir = tempDir("kypi-agentdir-");
		const run = runFullBootstrap(agentDir);

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
		// THE REGRESSION THIS PHASE SHIPPED AND THIS CASE CLOSES. On a laptop where
		// `export AWS_PROFILE=...` already made Bedrock work, running bootstrap used
		// to write the template's placeholder into ~/.pi/agent/auth.json, and Pi
		// prefers the stored value over the ambient one -- so every subsequent
		// Bedrock request resolved a profile that does not exist, with no error and
		// no output saying so.
		const agentDir = tempDir("kypi-agentdir-");
		const run = runFullBootstrap(agentDir);
		expectReachedTheScript(run);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		const ambient = "kypi-fixture-ambient-profile";
		const installedAuth = readJson(join(agentDir, "auth.json"));

		// WHAT PI ACTUALLY REPORTS ON THE AMBIENT BRANCH, read at source rather
		// than assumed: `resolve()` returns `{ auth: {}, env: credential?.env,
		// source: credential?.env?.AWS_PROFILE ? "stored credential" : "AWS_PROFILE" }`
		// [VERIFIED: pi-ai 0.84.1 dist/providers/amazon-bedrock.js:64-71]. So the
		// ambient value is NEVER echoed back in `env` -- `env` is undefined on that
		// branch. `source` is the discriminator, and it is the exact field that
		// flips from "AWS_PROFILE" to "stored credential" the moment a placeholder
		// is installed. Asserting on `env.AWS_PROFILE === ambient` would be
		// asserting something Pi cannot produce.
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
		// WHY THIS MATTERS EVEN THOUGH BOOTSTRAP WRITES NO SECRET. Pi creates
		// ~/.pi/agent 0700 and auth.json 0600, but only when they are ABSENT
		// [VERIFIED: pi 0.84.1 dist/core/auth-storage.js:21-31 -- both guards are
		// `if (!existsSync(...))`]. Bootstrap gets there first, so a plain
		// `mkdir -p` permanently disables that control: Pi re-chmods auth.json on
		// every write and repairs the FILE at the first `pi auth login`, but it
		// never re-chmods the DIRECTORY. That directory then holds auth.json,
		// models.json and Pi's session transcripts at 0755 for the life of the
		// machine.
		// A path the SCRIPT must create, not one `mkdtempSync` already created.
		// mkdtempSync makes its directory 0700 by definition, so pointing at one
		// would make this case green whatever bootstrap did -- the tautology the
		// assertion is meant to rule out.
		const agentDir = join(tempDir("kypi-agentroot-"), "agent");
		expect(
			existsSync(agentDir),
			"the agent directory already exists before the run, so its mode is this test's " +
				"doing rather than the script's",
		).toBe(false);

		const run = runFullBootstrap(agentDir);
		expectReachedTheScript(run);
		expect(run.status, `stderr:\n${run.stderr}`).toBe(0);

		const authPath = join(agentDir, "auth.json");
		expect(
			existsSync(authPath),
			"no auth.json was created, so the mode assertions below would be about a file " +
				"that does not exist",
		).toBe(true);

		if (process.platform === "win32") {
			// STATED, NOT SKIPPED. Windows has no POSIX mode bits: Node synthesises
			// 0o666/0o444 from the read-only attribute, so an assertion here would be
			// about Node's synthesis rather than about the script. The real check runs
			// on the macos-latest matrix leg. What IS checkable here is that both
			// paths exist and are the kinds of thing the modes would apply to -- a
			// script that never created them would look identical to a tightened one.
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
		const agentDir = tempDir("kypi-agentdir-");

		const first = runFullBootstrap(agentDir);
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

		// A provider this template has never heard of, plus OUR OWN provider key
		// holding a value the user chose. Merge-if-absent means absent, never
		// "absent or different". [threat T-03-06-01]
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

		// Loopback-shaped and obviously synthetic: a workspace-dedicated host names
		// the caller's own workspace id, which is exactly the value that may not
		// enter a public repository. [threat T-03-06-03]
		//
		// https, not http: the installer now refuses a cleartext endpoint outright,
		// because Pi sends the resolved $DASHSCOPE_API_KEY as a bearer token on
		// every request (WR-07). Port 9 (discard) is never connected to by this
		// suite either way -- nothing here issues a request.
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
		// `ds >= 0 && de >= 0` tested presence and never ORDER. With END above
		// START the two slices OVERLAP -- cur.slice(0, ds) still contains END, and
		// cur.slice(de + END.length) still contains START and everything after it
		// -- so the file gained duplicated content AND duplicated markers, and grew
		// further on every later run. .env.example is tracked and this repo is
		// public. The afterEach hook restores the file whatever happens here.
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
		writeFileSync(ENV_EXAMPLE, scrambled, "utf-8");

		const agentDir = tempDir("kypi-agentdir-");
		const run = runFullBootstrap(agentDir);
		expectReachedTheScript(run);

		expect(run.status, `stdout:\n${run.stdout}`).not.toBe(0);
		expect(
			run.stderr,
			"the refusal must name the file and the reason. A bare failure sends the user " +
				"through every file the script writes",
		).toContain("managed markers");

		const after = readFileSync(ENV_EXAMPLE, "utf-8");
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
		const agentDir = tempDir("kypi-agentdir-");
		const run = runFullBootstrap(agentDir);
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

		// The negative control. Blanking rather than reading process.env is the
		// recorded technique from plan 03-05: Pi's auth context treats an empty
		// value as absent, so this asserts machine state instead of depending on it.
		//
		// STATED RATHER THAN LEFT IMPLICIT: with the variable blank, Pi resolves
		// the entry to `undefined` outright rather than to the literal or to an
		// empty string [VERIFIED: executed 2026-08-13 against this exact pair]. So
		// the two `not.toBe` assertions below are true but weak on their own, and
		// the `toBeUndefined` is what carries the case — it is the assertion that
		// would fail the day the literal started passing through.
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

/**
 * A run of 40+ characters drawn only from the token alphabet.
 *
 * Borrowed verbatim from `tests/unit/docs-policy.test.ts:184`. This is a paste
 * guard, not a secret scanner: both templates are public and are edited on a
 * machine that will hold live credentials, and the realistic accident is a
 * terminal paste that carried a token along with the command.
 * [threat T-03-06-04]
 */
const TOKEN_SHAPED = /[A-Za-z0-9+/=_-]{40,}/g;

/**
 * Runs the paste guard must not report, and why.
 *
 * NARROWED DELIBERATELY, NOT ALLOWLISTED. Two shapes in the models template
 * trip the raw pattern and neither can be a credential:
 *
 *   - a rule line, i.e. one character repeated. `// ---------` opens every
 *     section of the template's header;
 *   - a pure-alphabetic run. `requiresReasoningContentOnAssistantMessages` is
 *     43 characters of the compat vocabulary. Every credential format in scope
 *     here — DashScope `sk-`, DeepSeek `sk-`, AWS `AKIA`, a base64 secret —
 *     carries a digit or a non-alphanumeric, so excluding pure letters excludes
 *     identifiers and prose without excluding tokens.
 *
 * The exclusions are asserted live below, in both directions.
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

	// THE WHOLE PARSED DOCUMENT, NOT ONE KEY. This used to read
	// `templateDashscope()`, i.e. `providers.dashscope` alone, so the value-level
	// checks never saw anything outside that one sub-object. The text-level
	// TOKEN_SHAPED scan does cover the whole file but needs a 40+ character run
	// and excludes pure-alphabetic runs of any length, so a second provider added
	// to the template with a SHORT key -- `"scratch": { "apiKey": "sk-abc123def456" }`,
	// 14 characters -- evaded both. `tests/unit/command-interpolation.test.ts`
	// already walks every leaf of the same file, so the two scans disagreed about
	// their own scope. [WR-02]
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

		// COVERAGE, AND AN HONEST NOTE ABOUT WHAT IT CAN CATCH TODAY. The scanned
		// set must contain every string value in the document.
		//
		// The template currently declares exactly one provider, so a walk of
		// `providers.dashscope` and a walk of the whole document produce the SAME
		// set and this assertion cannot distinguish them right now. Stated rather
		// than dressed up: it is a tripwire for the day a second provider, a model
		// override or a top-level field is added -- at which point narrowing the
		// walk fails here loudly. The LIVE proof that the scan walks depth-wise
		// past one key is case 7b, which drives a document that does discriminate
		// and shows the old walk missing both plants. [WR-02]
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
			// `\b` on the sk- prefix, per the Phase 2 decision: the bare substring
			// matches ordinary identifiers, and a redactor or scanner that mangles
			// ordinary text gets disabled rather than fixed.
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
		// THE PAIRED NEGATIVE FOR THE WIDENED WALK. The committed template is
		// clean, so every assertion above is a `[] === []` that a one-key walk
		// satisfies just as well as a whole-document one. This drives a synthetic
		// document shaped like the evasion the narrow scan allowed: a second
		// provider whose key is SHORT enough to slip under TOKEN_SHAPED's 40-char
		// floor and which lives outside providers.dashscope entirely.
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
		// A NAME IN .env.example IS AN INVITATION TO MINT A CREDENTIAL. The
		// template used to advertise a personal-access-token variable for a vendor
		// 03-CONTEXT decision 8 rules out of v1 entirely -- it publishes no
		// inference endpoint at all, only agent orchestration -- so nothing in this
		// harness could ever call it and docs/RUNBOOK.md never mentions it. Asking
		// an operator to create a secret for no reason is the whole of the harm.
		//
		// A MECHANISM, NOT AN ALLOWLIST. An allowlist of approved names is a second
		// copy of the template that drifts from it. The rule is instead: every name
		// in the managed block must be READ by something tracked outside the two
		// env templates themselves. A variable nothing consumes has no business
		// asking for a value. [IN-01]
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

		// Everything tracked except the two env templates, which are where the
		// names are DECLARED rather than consumed.
		//
		// AND EXCEPT `tests/`. A test that names a variable is DOCUMENTING A
		// CHECK, not consuming a credential, so counting it as a consumer lets a
		// variable certify itself: re-adding an out-of-scope vendor's
		// personal-access-token line to the template AND naming that string
		// anywhere under tests/ — a fixture, a table like AWS_CHAIN_VARIABLES, a
		// comment — makes this case green again, and the operator is back to being
		// asked to mint a credential for a vendor 03-CONTEXT decision 8 rules out.
		// Tightening costs nothing today: all four managed names have non-test
		// consumers (DASHSCOPE_API_KEY and DEEPSEEK_API_KEY in
		// .pi/templates/auth-template.json, AWS_PROFILE in
		// .pi/extensions/providers/schema.ts, KYPI_DASHSCOPE_BASE_URL in
		// bin/bootstrap.sh and docs/RUNBOOK.md). [IN-04]
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
		// A scan that has only ever seen clean input has never demonstrated that it
		// can fail. Assembled from pieces so this file never contains a literal
		// that looks like a key.
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
