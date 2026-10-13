/**
 * `!command` belongs in auth.json and nowhere else. auth.json keys go through Pi's cached resolver (one spawn per
 * process); models.json and extension-registered `apiKey`/`headers` go through the uncached one, a subprocess on every
 * request (pi src/core/resolve-config-value.ts, src/core/provider-composer.ts:272-277). Half A scans both surfaces;
 * Half B counts subprocesses to prove the difference. The auth template is deliberately exempt from the ban.
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

/** Parses the models template as bootstrap does: whole-line `//` comments only, so `https://` survives. */
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

/** Every string leaf of a parsed JSON value: a comment mentioning `!echo` passes, a deeply nested value cannot hide. */
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

/** Control for parsed-leaves scanning: the only bang mention is inside a whole-line comment. */
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
 * Forbidden shapes in raw extension source, comments included, so aliases and reformats are caught; no extension may
 * spell them even in prose. No `g` flag: a persistent `lastIndex` makes `.test()` lie on alternate calls.
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

/** One offending form per pattern, inline: a fixture file under a scanned tree would fail the gate it proves. */
/** Present in the inline fixture and nowhere under the scanned trees, proving the fixture stayed inline. */
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
		// A positive control, so a walk that found no credential reference cannot pass the bang check.
		const envRefs = leaves.filter((leaf) => /^\$\{?[A-Za-z_]/.test(leaf.value));

		expect(
			envRefs.map((leaf) => leaf.path),
			`${MODELS_TEMPLATE} contains no $ENV_VAR reference. The bang check above is only ` +
				"meaningful because the file is expected to carry runtime-resolved credentials; a " +
				"template with none has either lost its apiKey or stopped being walked",
		).not.toEqual([]);
	});

	it("walks parsed leaves, not raw text — a `//` mention of !echo passes, a real value fails", () => {
		// The template header itself mentions `!command`, which a text-level scan would flag.
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

		// A property of the scan: the auth template would still comply if it carried a !command.
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
		// A dead pattern and a clean tree produce identical output, so each pattern is proven live.
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
 * A command that appends one line to a log per invocation. A generated `.mjs` run by node, not a PATH stub: withStubBin
 * is synchronous and these resolutions are awaited. Each counter has a unique command string because Pi's cache is
 * keyed on it and cannot be cleared from a test.
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
	// Forward slashes: a backslash is an escape to both Git Bash and sh.
	const toPosix = (p: string): string => p.split("\\").join("/");
	const logPath = join(dir, "invocations.log");
	const scriptPath = join(dir, "counter.mjs");

	writeFileSync(
		scriptPath,
		[
			"// Generated by tests/unit/command-interpolation.test.ts. Lives in a temp dir.",
			'import { appendFileSync } from "node:fs";',
			// Logged before stdout, so an invocation counts even if its value never reaches Pi.
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
				// Discard-port loopback: any request would fail locally rather than egress.
				baseUrl: "http://127.0.0.1:9/v1",
				...(apiKey === undefined ? {} : { apiKey }),
				models: [{ id: "prov02-probe-model" }],
			},
		},
	};
}

/**
 * The pair is the proof: a correct cache and a single resolution look alike, as do a broken cache and the uncached
 * path. Only 1 versus 2 from the same counter in the same process separates them.
 */
describe("PROV-02 — the rule matters: cached vs uncached, counted in subprocesses", () => {
	it("auth.json `!command` — two resolutions, ONE subprocess", async () => {
		const counter = makeCounter("cached");
		try {
			await withModelsConfig(
				{
					// No apiKey in models.json, so the credential branch is taken.
					models: probeProvider(),
					auth: { [PROBE_PROVIDER]: { type: "api_key", key: counter.command } },
				},
				async (handle) => {
					// Both resolutions in one callback: Pi's cache is process-global and cannot be cleared.
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
					// apiKey in models.json and no auth.json entry, so the raw-key branch is taken.
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
