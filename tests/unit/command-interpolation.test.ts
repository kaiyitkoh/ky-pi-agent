/**
 * PROV-02 — `!command` belongs in `auth.json` and nowhere else, enforced on both
 * surfaces where "nowhere else" can actually hide.
 *
 * ---------------------------------------------------------------------------
 * THE RULE IS ABOUT A CALL SITE, NOT ABOUT A FILE NAME
 * ---------------------------------------------------------------------------
 * Pi has two resolvers for a config value and they differ in exactly one way:
 * whether the subprocess result is memoised.
 *
 *   - `resolveConfigValue()` → `executeCommand()`, which consults a
 *     module-level `commandResultCache` keyed on the whole `!…` string and
 *     therefore spawns **once per process**
 *     [VERIFIED: pi 0.84.1 src/core/resolve-config-value.ts:10, :145-151, :208-216].
 *   - `resolveConfigValueUncached()` → `executeCommandUncached()`, which does
 *     not touch that map at all
 *     [VERIFIED: pi 0.84.1 src/core/resolve-config-value.ts:198-206, :221-227].
 *
 * Which one runs is decided by the caller, not by the filename:
 *
 *   - `auth.json`'s `credential.key` is resolved by `DefaultAuthStorage.read`
 *     through the **cached** resolver
 *     [VERIFIED: pi 0.84.1 src/core/auth-storage.ts:442-448]. (`ReadOnlyAuthStorage`
 *     diverges: it returns a `!command` credential *unresolved* rather than
 *     running it [VERIFIED: :259-268] — worth knowing before debugging one.)
 *   - `models.json`'s `providers.<id>.apiKey` / `headers` are resolved by
 *     `composeApiKeyAuth().resolve()` through `resolveConfigValueOrThrow`, which
 *     calls the **uncached** one
 *     [VERIFIED: pi 0.84.1 src/core/provider-composer.ts:272-277, :341-363;
 *     src/core/resolve-config-value.ts:229-231]. Pi's own documentation says so
 *     in as many words: "For `models.json`, shell commands are resolved at
 *     request time. pi intentionally does not apply built-in TTL, stale reuse,
 *     or recovery logic" [CITED: pi 0.84.1 docs/models.md:172].
 *
 * ---------------------------------------------------------------------------
 * TRAP T13 — SCANNING ONLY THE TEMPLATE IS THE MISTAKE THIS FILE EXISTS TO STOP
 * ---------------------------------------------------------------------------
 * `configuredApiKey()` is `extension?.apiKey ?? config?.apiKey`
 * [VERIFIED: pi 0.84.1 src/core/provider-composer.ts:272-277] — the key a
 * project extension hands to the provider-registration call takes the *same*
 * uncached path as the one in `models.json`, and Pi's docs describe it with the
 * identical wording: "`apiKey` — API key literal, environment interpolation
 * (`$ENV_VAR` or `${ENV_VAR}`), or leading `!command`"
 * [CITED: pi 0.84.1 docs/extensions.md:1820]. So "it is not in `models.json`"
 * reads as compliance and is not. Both surfaces are scanned below.
 *
 * ---------------------------------------------------------------------------
 * THE AUTH TEMPLATE IS DELIBERATELY *NOT* SUBJECT TO THE BANG PROHIBITION
 * ---------------------------------------------------------------------------
 * `.pi/templates/auth-template.json` may legally carry a `!command`; that file
 * is the sanctioned position and the asymmetry between the two templates IS the
 * requirement. A scan that swept both would be enforcing a rule nobody wrote.
 *
 * ---------------------------------------------------------------------------
 * VACUITY GUARDS, BECAUSE A CLEAN TREE AND A DEAD PATTERN LOOK IDENTICAL
 * ---------------------------------------------------------------------------
 * Modelled on `tests/unit/chokepoint-lint.test.ts:166-233`: the scanned sets are
 * asserted non-empty **before** they are looped, every entry of {@link FORBIDDEN}
 * is proven live against an **inline** offending fixture, and the template's
 * bang check is paired with a positive (`$ENV_VAR` present) so a walk that found
 * no strings at all cannot pass by accident. The fixture is inline for the
 * reason `chokepoint-lint.test.ts:146-156` states: a fixture file under
 * `.pi/extensions/` or `.pi/templates/` would be enumerated by the scan and fail
 * the gate it exists to prove.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS WORTH A TEST AT ALL, IN PLAIN WORDS
 * ---------------------------------------------------------------------------
 * A `!command` in `models.json` — or in an extension's provider registration —
 * is a subprocess spawn on **every provider request**, in the hot path, on a
 * laptop where the model is already the slow part. It is not a style violation;
 * it is latency added to every turn, forever, with no cache and no way to notice
 * from the UI. The second half of this file proves that difference by counting
 * subprocesses rather than by quoting the documentation above.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, trackedFiles } from "../helpers/git.ts";
import { withModelsConfig } from "../helpers/models.ts";

// ---------------------------------------------------------------------------
// Half A — the mechanical scan
// ---------------------------------------------------------------------------

/** The config template the bang prohibition applies to. */
const MODELS_TEMPLATE = ".pi/templates/models-template.json";

/** The config template the bang prohibition deliberately does NOT apply to. */
const AUTH_TEMPLATE = ".pi/templates/auth-template.json";

/** The config templates the bang prohibition applies to. Exactly one, on purpose. */
const SCANNED_TEMPLATES: readonly string[] = [MODELS_TEMPLATE];

/** The scanned extension tree. Everything outside it is out of scope by design. */
const EXT_DIR = ".pi/extensions";

/**
 * Parse the models template the way `bin/bootstrap.sh` and
 * `tests/integration/templates-install.test.ts:179-185` do.
 *
 * WHOLE-LINE ONLY. `models.json` is comment-stripped by Pi
 * [VERIFIED: pi 0.84.1 src/core/model-config.ts:261] so every number in the
 * template carries its source, but a naive strip of every `//` would eat the
 * `https://` inside `baseUrl`.
 */
function stripWholeLineComments(text: string): string {
	return text
		.split("\n")
		.filter((line) => !/^\s*\/\//.test(line))
		.join("\n");
}

/** One string value of a parsed config, with the dotted path that reached it. */
interface StringLeaf {
	path: string;
	value: string;
}

/**
 * Every string leaf of a parsed JSON value, at any depth.
 *
 * Walking the PARSED structure rather than regexing the text is the whole
 * design of this scan, and it is load-bearing in both directions: a `//`
 * comment that merely mentions `!echo` must not fail the gate, and a value
 * nested three levels down inside `providers.<id>.models[0].compat` must not
 * escape it.
 */
function stringLeaves(value: unknown, path = "$"): StringLeaf[] {
	if (typeof value === "string") {
		return [{ path, value }];
	}
	if (Array.isArray(value)) {
		return value.flatMap((entry, index) => stringLeaves(entry, `${path}[${index}]`));
	}
	if (typeof value === "object" && value !== null) {
		return Object.entries(value).flatMap(([key, entry]) => stringLeaves(entry, `${path}.${key}`));
	}
	return [];
}

/** Strip, parse, walk — the exact pipeline the real template goes through. */
function templateStringLeaves(text: string): StringLeaf[] {
	return stringLeaves(JSON.parse(stripWholeLineComments(text)) as unknown);
}

/** Leaves whose value begins with `!`, i.e. the uncached-subprocess shape. */
function bangLeaves(leaves: readonly StringLeaf[]): StringLeaf[] {
	return leaves.filter((leaf) => leaf.value.startsWith("!"));
}

/**
 * A models-template-shaped fixture whose ONLY mention of a bang command is
 * inside a whole-line `//` comment.
 *
 * This is the control for "parsed leaves, not raw text": a text-level scan
 * fails it, and the scan this file actually performs must not.
 */
const COMMENT_ONLY_FIXTURE = [
	"// A comment may say !echo hello and even quote \"!echo hello\" freely —",
	"// the template header does exactly this when it explains the rule.",
	"{",
	'  "providers": {',
	'    "example": { "apiKey": "$EXAMPLE_API_KEY" }',
	"  }",
	"}",
	"",
].join("\n");

/** The same fixture with a REAL bang value, which must be caught. */
const BANG_VALUE_FIXTURE = COMMENT_ONLY_FIXTURE.replace(
	'"$EXAMPLE_API_KEY"',
	'"!echo hello"',
);

/**
 * The forbidden shapes in an extension source, each with the reason it is
 * banned.
 *
 * Matched against RAW SOURCE, comments included, exactly as
 * `chokepoint-lint.test.ts` matches its own set — a substring/shape match is
 * the only form that survives an alias or a reformat, and the price is that no
 * extension file may spell the offending shape even in prose. Describe it
 * instead.
 *
 * Bounded quantifiers only, no `.`, and no `g` flag: these run over committed
 * source in a loop, and a `g` pattern carries a persistent `lastIndex` that
 * makes `.test()` lie on every other call (the lesson `prose.ts:130-135`
 * records against `redact.ts`).
 */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
	{
		pattern: /\bapiKey\s{0,8}:\s{0,8}["'`]\s{0,8}!/,
		why:
			"a provider registration's apiKey is resolved by resolveConfigValueOrThrow — the " +
			"UNCACHED resolver — so a leading `!` here is a subprocess spawn on every request " +
			"(pi 0.84.1 src/core/provider-composer.ts:341-363)",
	},
	{
		pattern: /\bapi_key\s{0,8}:\s{0,8}["'`]\s{0,8}!/,
		why:
			"the snake_case spelling, i.e. the auth.json field name copied into extension code; " +
			"it reaches the same uncached path and reads as if it were the cached one",
	},
	{
		pattern: /\bkey\s{0,8}:\s{0,8}["'`]\s{0,8}!/,
		why:
			"a bare `key` credential literal written into an extension rather than into " +
			"auth.json — the value is cached ONLY when auth-storage.ts:442-448 resolves it, " +
			"and an extension-held one never goes through there",
	},
	{
		pattern: /\bheaders\s{0,8}:\s{0,8}\{[^{}]{0,400}["'`]\s{0,8}!/,
		why:
			"header values go through resolveHeadersOrThrow, which is the same uncached " +
			"resolver applied per header (pi 0.84.1 src/core/provider-composer.ts:360-361)",
	},
];

/**
 * A synthetic extension source carrying one offending form per pattern.
 *
 * INLINE, deliberately. A fixture file under `.pi/extensions/` would be
 * enumerated by the scan below and fail the very gate it exists to prove; one
 * under `.pi/templates/` would do the same to the template scan. It also
 * exercises the quote-style and whitespace tolerance the patterns claim, rather
 * than only the tidy spelling.
 */
/**
 * A string that must appear in the inline fixture and NOWHERE under the scanned
 * trees. It is how "the fixture is inline" is asserted mechanically rather than
 * by inspection.
 */
const FIXTURE_MARKER = "kypi-prov02-offending-fixture";

const OFFENDING_FIXTURE = [
	`// ${FIXTURE_MARKER} — synthetic, never written to disk under a scanned tree.`,
	"export default function (pi) {",
	'\tpi.registerProvider("dashscope", {',
	'\t\tapiKey : "!op read op://vault/dashscope/key",',
	"\t\theaders: { 'X-Kypi-Tenant': `!cat /etc/kypi-tenant` },",
	"\t});",
	'\tpi.registerProvider("deepseek", { api_key: "!echo $DEEPSEEK_API_KEY" });',
	'\tconst credential = { type: "api_key", key: "!aws-vault exec kypi -- printenv KEY" };',
	"\tvoid credential;",
	"}",
	"",
].join("\n");

/** Tracked `.ts` sources under `.pi/extensions/`, read from the index's view. */
function extensionSources(): { path: string; text: string }[] {
	return trackedFiles(EXT_DIR)
		.filter((p) => p.endsWith(".ts"))
		.sort()
		.map((path) => ({ path, text: readFileSync(join(repoRoot(), path), "utf-8") }));
}

describe("PROV-02 surface 1 — no `!command` value in the models template", () => {
	const templateText = readFileSync(join(repoRoot(), MODELS_TEMPLATE), "utf-8");
	const leaves = templateStringLeaves(templateText);

	it("collects string leaves from the template (guards against a vacuous pass)", () => {
		expect(
			leaves.length,
			`${MODELS_TEMPLATE} produced no string leaves at all. Every assertion below filters ` +
				"this list, so an empty one turns the whole gate into a pass that verified nothing — " +
				"assert it non-empty before filtering, never after. A comment-strip that ate the " +
				"whole file, or a template reduced to numbers, both land here",
		).toBeGreaterThanOrEqual(10);
	});

	it("has no string leaf beginning with `!`, at any depth", () => {
		expect(
			bangLeaves(leaves).map((leaf) => `${leaf.path} = ${JSON.stringify(leaf.value)}`),
			`these ${MODELS_TEMPLATE} values begin with \`!\`, so Pi will execute them as shell ` +
				"commands through the UNCACHED resolver — once per provider request, with no cache, " +
				"no TTL, no stale reuse and no recovery (docs/models.md:172). That is a subprocess " +
				"spawn in the hot path of every single turn. If the value genuinely has to come from " +
				"a command, it belongs in auth.json / .pi/templates/auth-template.json, where " +
				"DefaultAuthStorage.read resolves it through the CACHED resolver exactly once per " +
				"process (auth-storage.ts:442-448)",
		).toEqual([]);
	});

	it("paired positive — at least one leaf IS a `$`-prefixed environment reference", () => {
		// Without this, a template that carried no credential reference at all --
		// or a walk that silently returned only structural strings -- would satisfy
		// the bang check perfectly while proving nothing about interpolation.
		const envRefs = leaves.filter((leaf) => /^\$\{?[A-Za-z_]/.test(leaf.value));

		expect(
			envRefs.map((leaf) => leaf.path),
			`${MODELS_TEMPLATE} contains no $ENV_VAR reference. The bang check above is only ` +
				"meaningful because the file is expected to carry runtime-resolved credentials; a " +
				"template with none has either lost its apiKey or stopped being walked",
		).not.toEqual([]);
	});

	it("walks parsed leaves, not raw text — a `//` mention of !echo passes, a real value fails", () => {
		// The template's own header explains the bang rule and therefore CONTAINS
		// the string `!command`. A text-level scan fails on the documentation.
		expect(
			bangLeaves(templateStringLeaves(COMMENT_ONLY_FIXTURE)),
			"a bang command mentioned only inside a whole-line // comment was reported as a " +
				"forbidden value. The scan has regressed to matching raw text, which would make it " +
				"impossible to document this very rule inside the template it governs",
		).toEqual([]);

		expect(
			bangLeaves(templateStringLeaves(BANG_VALUE_FIXTURE)).map((leaf) => leaf.path),
			"the SAME fixture with a real `!echo hello` VALUE was not caught. Without this half " +
				"the case above is satisfied by a scan that finds nothing anywhere, ever",
		).toEqual(["$.providers.example.apiKey"]);

		expect(
			templateText,
			"the template no longer explains the bang rule in its header. That prose is what makes " +
				"the comment-versus-value distinction above a real property of this repository " +
				"rather than a property of a synthetic fixture",
		).toContain("!command");
	});

	it("leaves the auth template alone, because `!command` is legal there", () => {
		// The asymmetry IS the requirement. Asserting it mechanically stops a
		// future tidy-up from "consistently" sweeping both files and banning the
		// one construct PROV-02 exists to permit.
		const tracked = trackedFiles(".pi/templates");

		expect(
			tracked,
			`${AUTH_TEMPLATE} is not tracked, so the sanctioned position for a !command does not ` +
				"exist in a fresh clone and the prohibition above has nowhere to redirect anyone to",
		).toContain(AUTH_TEMPLATE);

		const authLeaves = stringLeaves(
			JSON.parse(readFileSync(join(repoRoot(), AUTH_TEMPLATE), "utf-8")) as unknown,
		);
		expect(
			authLeaves.length,
			`${AUTH_TEMPLATE} produced no string leaves, so the statement below is about nothing`,
		).toBeGreaterThanOrEqual(3);

		// Stated as a property of the SCAN, not of the file: the auth template
		// happens to carry no !command today, and it would still be compliant if
		// it did. Nothing here asserts an absence.
		expect(
			SCANNED_TEMPLATES,
			`${AUTH_TEMPLATE} has been added to the bang scan. It is the one config file where a ` +
				"!command is correct — cached for the process lifetime by auth-storage.ts:442-448 — " +
				"and banning it there would enforce a rule nobody wrote",
		).toEqual([MODELS_TEMPLATE]);
	});
});

describe("PROV-02 surface 2 — no `!command` credential in an extension (Trap T13)", () => {
	const sources = extensionSources();

	it("finds at least one tracked extension source (guards against a vacuous pass)", () => {
		expect(
			sources.length,
			`no tracked .ts under ${EXT_DIR}/ — every assertion below scans this set, so an empty ` +
				"one turns the whole gate into a pass that verified nothing. Trap T13 is precisely " +
				"the belief that checking the template alone discharges PROV-02",
		).toBeGreaterThanOrEqual(1);
	});

	it(`registers no \`!\`-prefixed credential anywhere under ${EXT_DIR}/`, () => {
		const offenders: string[] = [];
		for (const source of sources) {
			for (const { pattern, why } of FORBIDDEN) {
				if (pattern.test(source.text)) {
					offenders.push(`${source.path}: matched ${String(pattern)} — ${why}`);
				}
			}
		}

		expect(
			offenders,
			"these extension sources hand Pi a credential that begins with `!`. It takes the same " +
				"uncached path as a models.json value (provider-composer.ts:272-277 — " +
				"`extension?.apiKey ?? config?.apiKey`), so it is a subprocess spawn on every " +
				"provider request while LOOKING compliant, because it is not in models.json. Move " +
				"the command into auth.json, or resolve it once yourself and pass the value. If the " +
				"match is in a COMMENT, reword it: these patterns are matched against raw source on " +
				"purpose",
		).toEqual([]);
	});

	it("proves every forbidden pattern is live against an inline offending fixture", () => {
		// A regex set proven only against a clean tree is a set that could be
		// uniformly broken -- a stray anchor, an escaping slip during a rename --
		// and never noticed, because a dead pattern and a clean repository produce
		// byte-identical output.
		const dead = FORBIDDEN.filter(({ pattern }) => !pattern.test(OFFENDING_FIXTURE)).map(
			({ pattern, why }) => `${String(pattern)} — ${why}`,
		);

		expect(
			dead,
			"these patterns matched NOTHING in the synthetic offending source, so they are dead and " +
				"the negative assertion above is passing for them no matter what the extension tree " +
				"contains. Either the pattern is broken or OFFENDING_FIXTURE no longer carries a " +
				"form of it",
		).toEqual([]);

		expect(
			FORBIDDEN.length,
			"the forbidden set shrank below the four credential shapes an extension can spell. " +
				"Removing one is a decision about what PROV-02 covers, not a cleanup",
		).toBeGreaterThanOrEqual(4);
	});

	it("keeps the offending fixture inline rather than on disk", () => {
		// A fixture file under `.pi/extensions/` would be enumerated by the scan
		// above and fail the very gate it exists to prove; one under
		// `.pi/templates/` would do the same to surface 1. Asserting the shape,
		// since the fixture is a `const` two screens up.
		expect(
			OFFENDING_FIXTURE,
			"the inline fixture no longer exercises the provider-registration call it models, so " +
				"the patterns are being proven against something that is not the hazard",
		).toContain("registerProvider");

		expect(
			OFFENDING_FIXTURE.split("\n").length,
			"the fixture must carry one offending line per pattern; a shrunken fixture is how a " +
				"pattern quietly stops being exercised while the liveness case above still passes " +
				"on the ones that remain",
		).toBeGreaterThanOrEqual(FORBIDDEN.length + 1);

		// The fixture's marker must exist NOWHERE under the two scanned trees. If
		// someone "extracts the fixture to a file" for tidiness, the scan
		// enumerates it, reports it as a real offender, and the gate fails on its
		// own evidence. Catch that here, with a message that says why.
		const onDisk = trackedFiles(".")
			.filter((p) => p.startsWith(`${EXT_DIR}/`) || p.startsWith(".pi/templates/"))
			.filter((p) => readFileSync(join(repoRoot(), p), "utf-8").includes(FIXTURE_MARKER));
		expect(
			onDisk,
			`the offending fixture (marker ${JSON.stringify(FIXTURE_MARKER)}) has been written ` +
				"into a tracked file under a scanned tree. The scan enumerates that tree, so the " +
				"fixture would be reported as a genuine violation and this gate would fail on the " +
				"evidence it created. Keep it inline, or under tests/fixtures/",
		).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Half B — the cached-versus-uncached behavioural proof
// ---------------------------------------------------------------------------

/** Synthetic provider id. Nothing in the harness ships under this name. */
const PROBE_PROVIDER = "kypi-prov02-probe";

/** What the counter command prints. Asserted, so a silent failure cannot pass. */
const COUNTER_VALUE = "kypi-prov02-counter-value";

/**
 * A shell command that appends exactly one line to a log file per invocation.
 *
 * A `node` invocation of a generated `.mjs`, not a PATH stub. Three reasons,
 * and the first is decisive:
 *
 *   1. `withStubBin` is SYNCHRONOUS by contract and rejects a thenable
 *      (`tests/helpers/stub-bin.ts:205-211`), because it deletes the stub
 *      directory the moment its callback returns. Every resolution below is
 *      awaited, so a stub-bin PATH could not survive the call it exists to
 *      observe.
 *   2. Pi executes the command through Git Bash `-c` on Windows and `execSync`
 *      elsewhere [VERIFIED: pi 0.84.1 src/core/resolve-config-value.ts:153-206,
 *      src/utils/shell.ts:76-98], so a `.cmd` shim is never the reachable
 *      launcher and the CVE-2024-27980 limitation recorded at
 *      `stub-bin.ts:33-47` does not arise. `node "<abs path>"` is one token that
 *      both shells resolve identically.
 *   3. Each counter gets its own temp path, so its command STRING is unique.
 *      That matters: Pi's cache is keyed on the whole `!…` string and cannot be
 *      cleared from a test — `clearApiKeyCache` is re-exported from
 *      `core/model-registry.ts` but not from the package root — so two cases
 *      sharing a command string could not both be honest.
 */
interface Counter {
	/** The `!…` config value to place in models.json or auth.json. */
	command: string;
	/** Invocations recorded so far, one line each. */
	lines(): string[];
	dispose(): void;
}

function makeCounter(label: string): Counter {
	const dir = mkdtempSync(join(tmpdir(), `kypi-prov02-${label}-`));
	// Forward slashes: both Git Bash and sh take this form verbatim, and a
	// backslash path would be an escape sequence to either of them.
	const toPosix = (p: string): string => p.split("\\").join("/");
	const logPath = join(dir, "invocations.log");
	const scriptPath = join(dir, "counter.mjs");

	writeFileSync(
		scriptPath,
		[
			"// Generated by tests/unit/command-interpolation.test.ts. Lives in a temp dir.",
			'import { appendFileSync } from "node:fs";',
			// Appended BEFORE anything is written to stdout, so an invocation is
			// recorded even if the value never reaches Pi -- the same reason
			// `stub-bin.ts:96-106` logs before it chooses a response.
			`appendFileSync(${JSON.stringify(toPosix(logPath))}, "invoked\\n");`,
			`process.stdout.write(${JSON.stringify(`${COUNTER_VALUE}\n`)});`,
			"",
		].join("\n"),
		"utf-8",
	);

	return {
		command: `!node "${toPosix(scriptPath)}"`,
		lines(): string[] {
			if (!existsSync(logPath)) {
				return [];
			}
			return readFileSync(logPath, "utf-8")
				.split("\n")
				.filter((line) => line.trim() !== "");
		},
		dispose(): void {
			try {
				// maxRetries is the Windows convention in this repo: handles linger.
				rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
			} catch {
				// A leftover temp dir is noise, not a failure.
			}
		},
	};
}

/** A minimal, unreachable provider. Nothing here ever issues a request. */
function probeProvider(apiKey?: string): Record<string, unknown> {
	return {
		providers: {
			[PROBE_PROVIDER]: {
				name: "PROV-02 probe",
				api: "openai-completions",
				// Discard-port loopback: if anything ever tried to reach it, the
				// failure would be immediate and local rather than an egress.
				baseUrl: "http://127.0.0.1:9/v1",
				...(apiKey === undefined ? {} : { apiKey }),
				models: [{ id: "prov02-probe-model" }],
			},
		},
	};
}

/**
 * THE PAIR IS THE POINT, and neither half alone would carry it.
 *
 * A resolver that never ran the command produces zero lines, which is why both
 * cases assert the log non-empty first. Beyond that: a correct cache and a
 * resolver that simply resolved once are indistinguishable from the cached case
 * alone, and a broken cache is indistinguishable from the uncached case alone.
 * Only 1-versus-2, from the same counter mechanism in the same process,
 * separates them.
 *
 * [VERIFIED: executed 2026-08-13 on win32 / node 24.16.0 — a standalone probe
 * over ModelRuntime + ModelRegistry produced exactly these counts, 2 for the
 * models.json apiKey and 1 for the auth.json key, before this file existed.]
 * Neither direction needed narrowing for a platform reason; Pi resolves the
 * command through Git Bash `-c` here, not through a `.cmd` launcher.
 */
describe("PROV-02 — the rule matters: cached vs uncached, counted in subprocesses", () => {
	it("auth.json `!command` — two resolutions, ONE subprocess", async () => {
		const counter = makeCounter("cached");
		try {
			await withModelsConfig(
				{
					// No apiKey in models.json: the credential branch of
					// composeApiKeyAuth().resolve() must be the one taken.
					models: probeProvider(),
					auth: { [PROBE_PROVIDER]: { type: "api_key", key: counter.command } },
				},
				async (handle) => {
					// BOTH resolutions inside ONE callback, deliberately. Pi's cache is
					// process-global and cannot be cleared from a test, so a second
					// callback would inherit the first one's answer and the count would
					// be a statement about vitest's worker rather than about Pi.
					const first = await handle.registry.getProviderAuth(PROBE_PROVIDER);
					const second = await handle.registry.getProviderAuth(PROBE_PROVIDER);

					expect(
						counter.lines().length,
						"the counter command was never invoked at all, so `exactly one line` below " +
							"would be asserted against an empty file and this case would be green " +
							"for the wrong reason. Either auth.json was not read, or the provider id " +
							"does not match, or the command failed to launch",
					).toBeGreaterThan(0);

					expect(
						first?.auth.apiKey,
						"the resolved key is not the counter's stdout, so whatever ran was not the " +
							"counter and the invocation count means nothing",
					).toBe(COUNTER_VALUE);

					expect(
						second?.auth.apiKey,
						"the second resolution returned a different value from the first. A cache " +
							"that serves a different answer is worse than no cache",
					).toBe(first?.auth.apiKey);

					expect(
						counter.lines().length,
						"an auth.json !command was executed more than once for two resolutions. " +
							"DefaultAuthStorage.read resolves credential.key through the CACHED " +
							"resolver (auth-storage.ts:442-448 -> resolve-config-value.ts:208-216), " +
							"which memoises on the command string for the process lifetime. If this " +
							"is now false, the entire premise of PROV-02 -- that auth.json is the " +
							"safe place for a command -- has changed and the requirement needs " +
							"re-deriving, not this test relaxing",
					).toBe(1);
				},
			);
		} finally {
			counter.dispose();
		}
	}, 60_000);

	it("models.json `!command` — two resolutions, TWO subprocesses", async () => {
		const counter = makeCounter("uncached");
		try {
			await withModelsConfig(
				{
					// apiKey in models.json and NO auth.json entry: the rawKey branch of
					// composeApiKeyAuth().resolve() must be the one taken.
					models: probeProvider(counter.command),
				},
				async (handle) => {
					const first = await handle.registry.getProviderAuth(PROBE_PROVIDER);
					const second = await handle.registry.getProviderAuth(PROBE_PROVIDER);

					expect(
						counter.lines().length,
						"the counter command was never invoked, so `exactly two lines` below would " +
							"be asserted against an empty file. Neither direction of this pair means " +
							"anything unless the command actually ran",
					).toBeGreaterThan(0);

					expect(
						first?.auth.apiKey,
						"the resolved key is not the counter's stdout, so whatever ran was not the " +
							"counter",
					).toBe(COUNTER_VALUE);
					expect(
						second?.auth.apiKey,
						"the second resolution returned a different value from the first",
					).toBe(COUNTER_VALUE);

					expect(
						counter.lines().length,
						"a models.json !command was NOT re-executed on the second resolution. If Pi " +
							"has started caching this path, PROV-02's cost argument is gone and the " +
							"rule should be re-derived rather than this assertion loosened. Until " +
							"then, two resolutions means two subprocess spawns -- and a real session " +
							"resolves this once per provider REQUEST, not once per test",
					).toBe(2);
				},
			);
		} finally {
			counter.dispose();
		}
	}, 60_000);
});
