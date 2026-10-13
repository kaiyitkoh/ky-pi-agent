// The JSON half of bin/bootstrap.sh: one subcommand per step, node: builtins only so it runs before npm ci.
// Paths arrive MSYS-converted (C:/...), so a path built by concatenation has the same form as one passed in.
import fs from "node:fs";
import path from "node:path";

const env = process.env;
const ROOT = env.KYPI_REPO_ROOT;
const AGENT = env.KYPI_AGENT_DIR;
const SETTINGS = `${AGENT}/settings.json`;
const STUB = `${AGENT}/extensions/ky-safety/index.ts`;
const THIS_REPO_GIT = /github\.com[\/:]kaiyitkoh\/ky-pi-agent(\.git)?(@|\/|$)/i;
const REMOTE_SOURCE = /^(npm|git|github|https?|ssh|builtin):/i;

function fatal(...lines) {
	for (const line of lines) console.error(line);
	process.exit(1);
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const slashes = (p) => p.replace(/\\/g, "/");
const readTrimmed = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "");

// Temp file in the same directory, then rename, so a crash never leaves a truncated credential file.
function writeAtomic(file, data, mode) {
	const tmp = `${file}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, data, mode === undefined ? "utf8" : { encoding: "utf8", mode });
	try {
		fs.renameSync(tmp, file);
	} catch (error) {
		fs.rmSync(tmp, { force: true });
		throw error;
	}
}

const writeJson = (file, value, indent = 2, mode) => writeAtomic(file, `${JSON.stringify(value, null, indent)}\n`, mode);

function parseJson(text, file, tail = ".", hint = [], what = "valid JSON") {
	try {
		return JSON.parse(text);
	} catch (error) {
		return fatal(`FATAL: ${file} is not ${what} (${error.message})${tail}`, ...hint);
	}
}

// An absent or empty file reads as `emptyAs`; anything but an object is refused.
function readObject(file, verb, hint = [], emptyAs = "{}") {
	const value = parseJson(readTrimmed(file) || emptyAs, file, `. Refusing to ${verb} it.`, hint);
	if (!isObject(value)) fatal(`FATAL: ${file} is not a JSON object. Refusing to ${verb} it.`);
	return value;
}

const sourceOf = (entry) =>
	typeof entry === "string" ? entry : entry && typeof entry.source === "string" ? entry.source : "";
const normPath = (p) => slashes(p).replace(/\/+$/, "").toLowerCase();
const isThisCheckout = (source) =>
	source !== "" &&
	!REMOTE_SOURCE.test(source) &&
	!THIS_REPO_GIT.test(source) &&
	normPath(path.resolve(path.dirname(SETTINGS), source.replace(/^local:/i, ""))) === normPath(ROOT);
const stubTarget = (text) => /await import\("([^"]+)"\)/.exec(text)?.[1];

// Each direct dependency is looked up the way Node resolves it (ancestor node_modules) and judged
// against its exact pin. Exit 0 current, 3 not, 2 unreadable manifest.
function checkoutDeps() {
	const manifestFile = path.join(ROOT, "package.json");
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
	} catch (error) {
		console.log(`FATAL: ${manifestFile} is unreadable (${error.message})`);
		process.exit(2);
	}
	const wanted = { ...manifest.devDependencies, ...manifest.dependencies };
	const installedVersion = (name) => {
		for (let dir = ROOT; ; dir = path.dirname(dir)) {
			const file = path.join(dir, "node_modules", name, "package.json");
			if (fs.existsSync(file)) {
				try {
					return JSON.parse(fs.readFileSync(file, "utf8")).version;
				} catch {
					return "unreadable";
				}
			}
			if (path.dirname(dir) === dir) return undefined;
		}
	};
	let bad = 0;
	for (const name of Object.keys(wanted).sort()) {
		const got = installedVersion(name);
		if (got === wanted[name]) continue;
		bad += 1;
		console.log(`${name}@${wanted[name]}${got === undefined ? " is not installed" : ` is installed at ${got}`}`);
	}
	process.exit(bad === 0 ? 0 : 3);
}

function piGlobalMatches() {
	let tree;
	try {
		tree = JSON.parse(fs.readFileSync(0, "utf8"));
	} catch {
		process.exit(1);
	}
	const entry = ((tree && tree.dependencies) || {})[env.KYPI_PI_PKG];
	process.exit(entry && entry.version === env.KYPI_PI_PIN ? 0 : 1);
}

function composedSpecs() {
	for (const entry of JSON.parse(fs.readFileSync(`${ROOT}/.pi/settings.json`, "utf8")).packages || []) {
		const source = typeof entry === "string" ? entry : entry && entry.source;
		if (typeof source === "string" && /^npm:.+@[0-9]/.test(source)) console.log(source);
	}
}

// Additive: user packages, extensions, theme and kyPiAgent keys we do not own survive, and a different
// pinned version of one of our packages is refused, never re-pinned.
function mergeSettings() {
	const repo = readObject(`${ROOT}/.pi/settings.json`, "trust");
	const obj = readObject(SETTINGS, "touch");
	const before = JSON.stringify(obj);
	// Identity is the package name; the trailing @version is not part of it.
	const identityOf = (source) => {
		const s = source.replace(/^npm:/, "");
		const at = s.lastIndexOf("@");
		return at > 0 ? s.slice(0, at) : s;
	};
	const asList = (value, name) => {
		if (value === undefined) return [];
		if (!Array.isArray(value)) fatal(`FATAL: ${SETTINGS} has a ${name} key that is not an array. Refusing to touch it.`);
		return value;
	};

	const packages = asList(obj.packages, "packages");
	const added = [];
	for (const pin of asList(repo.packages, "packages")) {
		const want = sourceOf(pin);
		if (!want.startsWith("npm:")) continue;
		const existing = packages.map(sourceOf).find((s) => s.startsWith("npm:") && identityOf(s) === identityOf(want));
		if (existing === undefined) {
			packages.push(pin);
			added.push(want);
		} else if (existing !== want) {
			fatal(
				`FATAL: ${SETTINGS} already pins ${existing} but this checkout pins ${want}.`,
				"       A pinned version you chose is never re-pinned silently. Remove the entry or",
				"       change the pin in .pi/settings.json deliberately, then re-run.",
			);
		}
	}
	if (packages.length > 0) obj.packages = packages;

	const extensions = asList(obj.extensions, "extensions");
	for (const entry of asList(repo.extensions, "extensions")) {
		if (!extensions.includes(entry)) {
			extensions.push(entry);
			added.push(entry);
		}
	}
	if (extensions.length > 0) obj.extensions = extensions;

	if (obj.theme === undefined && typeof repo.theme === "string") {
		obj.theme = repo.theme;
		added.push(`theme ${repo.theme}`);
	}

	if (obj.subagents !== undefined && !isObject(obj.subagents)) {
		fatal(`FATAL: ${SETTINGS} has a subagents key that is not a JSON object. Refusing to touch it.`);
	}
	const agentsDir = slashes(`${ROOT}/.pi/agents`);
	const subagents = obj.subagents ?? {};
	const scanDirs = asList(subagents.agentScanDirs, "subagents.agentScanDirs");
	if (!scanDirs.includes(agentsDir)) {
		scanDirs.push(agentsDir);
		added.push(`agentScanDirs ${agentsDir}`);
	}
	subagents.agentScanDirs = scanDirs;
	obj.subagents = subagents;

	obj.kyPiAgent = {
		...obj.kyPiAgent,
		bootstrapVersion: env.KYPI_BOOTSTRAP_VERSION,
		hardenedNpmRoot: `${AGENT}/npm`,
		piPinned: env.KYPI_PI_PIN,
	};

	if (JSON.stringify(obj) === before) {
		console.log("  settings.json kyPiAgent already current - unchanged");
		return;
	}
	writeJson(SETTINGS, obj);
	console.log("  settings.json kyPiAgent key merged");
	for (const a of added) console.log(`  settings.json added ${a}`);
}

// The stub already loads the guard, so the entry filters it out (pi 1.1.0 core/package-manager.js
// applyPatterns: a leading ! excludes); hence it is only ever written once the stub exists.
function mergeHarnessPackage() {
	const obj = readObject(SETTINGS, "touch");
	if (obj.packages !== undefined && !Array.isArray(obj.packages)) {
		fatal(`FATAL: ${SETTINGS} is not a JSON object with a packages array. Refusing to touch it.`);
	}
	const packages = obj.packages ?? [];
	const checkout = slashes(ROOT).replace(/\/+$/, "");
	const gitPackage = packages.map(sourceOf).find((s) => THIS_REPO_GIT.test(s));
	const ownEntry = packages.find((entry) => isThisCheckout(sourceOf(entry)));
	const ours = { source: checkout, extensions: ["!.pi/extensions/safety/**"] };
	if (isObject(obj.kyPiAgent) && obj.kyPiAgent.harnessPackage === false) {
		console.log("  settings.json harness package not added: kyPiAgent.harnessPackage is false");
	} else if (gitPackage !== undefined) {
		console.log(`  settings.json harness package not added: ${gitPackage} already loads the harness`);
	} else if (ownEntry !== undefined) {
		const current = JSON.stringify(ownEntry) === JSON.stringify(ours);
		console.log(
			`  settings.json harness package ${sourceOf(ownEntry)}${current ? " already current - unchanged" : " present - left as configured"}`,
		);
	} else if (!fs.existsSync(STUB)) {
		console.log("  settings.json harness package not added: no safety stub, and the entry leaves the guard out");
	} else {
		packages.push(ours);
		obj.packages = packages;
		writeJson(SETTINGS, obj);
		console.log(`  settings.json added harness package ${checkout} (safety extension filtered out)`);
	}
}

// Marked-region copy: replace between the markers, append when absent, create when the target is absent.
function envTemplate() {
	const START = "# ky-pi-agent managed:start";
	const END = "# ky-pi-agent managed:end";
	const dst = `${ROOT}/.env.example`;
	const src = fs.readFileSync(`${ROOT}/.pi/templates/env.example`, "utf8");
	const s = src.indexOf(START);
	const e = src.indexOf(END);
	if (s < 0 || e < 0) fatal("FATAL: template is missing its managed markers");
	const block = src.slice(s, e + END.length);
	const cur = fs.existsSync(dst) ? fs.readFileSync(dst, "utf8") : undefined;
	let out = src;
	if (cur !== undefined) {
		const ds = cur.indexOf(START);
		const de = cur.indexOf(END);
		// Presence is not enough: an END above a START makes the slices overlap and the file grows on every run.
		if (ds >= 0 && de > ds) {
			out = cur.slice(0, ds) + block + cur.slice(de + END.length);
		} else if (ds >= 0 || de >= 0) {
			fatal(
				`FATAL: ${dst} has managed markers that are out of order or half present.`,
				"       Rewriting it would duplicate content and duplicate the markers, and the",
				"       damage would compound on every later run. Fix the markers by hand so",
				"       start precedes end, or delete the file and re-run to regenerate it.",
			);
		} else {
			out = `${cur.replace(/\n*$/, "\n")}\n${block}\n`;
		}
	}
	if (cur === out) {
		console.log("  .env.example already current - unchanged");
		return;
	}
	writeAtomic(dst, out);
	console.log("  .env.example written from .pi/templates/env.example");
}

// The workspace-dedicated host names a workspace id that must never enter a public repo, so it arrives
// in KYPI_DASHSCOPE_BASE_URL. Validated because a typo that lands as http:// puts the bearer key on the wire.
function dashscopeOverride() {
	const override = env.KYPI_DASHSCOPE_BASE_URL;
	if (!override) return undefined;
	let url;
	try {
		url = new URL(override);
	} catch {
		fatal(
			`FATAL: KYPI_DASHSCOPE_BASE_URL is not a parseable absolute URL: ${override}`,
			"       Expected something like https://<workspace-id>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
		);
	}
	if (url.protocol !== "https:") {
		fatal(
			`FATAL: KYPI_DASHSCOPE_BASE_URL must be https. Got: ${override}`,
			"       Pi sends the resolved $DASHSCOPE_API_KEY as a bearer token on every",
			"       request, so an http:// endpoint puts the key on the wire in cleartext.",
		);
	}
	return override;
}

// Replaces providers.dashscope and merges providers.amazon-bedrock models by id; everything else survives.
function modelsJson() {
	const src = `${ROOT}/.pi/templates/models-template.json`;
	const dst = `${AGENT}/models.json`;
	// Whole-line // comments only: a naive strip would eat the https:// in baseUrl.
	const template = fs
		.readFileSync(src, "utf8")
		.split("\n")
		.filter((line) => !/^\s*\/\//.test(line))
		.join("\n");
	const parsed = parseJson(template, src, ".", [], "valid JSON once whole-line // comments are removed");
	const next = parsed?.providers?.dashscope;
	if (!isObject(next)) {
		fatal(`FATAL: ${src} defines no providers.dashscope object. Refusing to guess what to install.`);
	}
	const bedrockNext = parsed.providers["amazon-bedrock"];
	if (bedrockNext !== undefined && !(isObject(bedrockNext) && Array.isArray(bedrockNext.models))) {
		fatal(`FATAL: ${src} has a providers.amazon-bedrock entry without a models array. Refusing to guess what to install.`);
	}
	const override = dashscopeOverride();
	if (override) next.baseUrl = override;

	const obj = readObject(dst, "touch", [
		"       Note Pi strips // comments from models.json and JSON.parse does not, so a",
		"       commented file lands here too. Merge providers.dashscope by hand rather",
		"       than letting this script rewrite the file without your comments.",
	]);
	if (obj.providers !== undefined && !isObject(obj.providers)) {
		fatal(`FATAL: ${dst} has a providers key that is not a JSON object. Refusing to touch it.`);
	}
	const providers = obj.providers ?? {};
	let changed = false;

	// An unset variable keeps an https endpoint already installed, so a rerun from a shell without it never
	// moves the key to another host. The host is not printed: a workspace-dedicated one names the workspace id.
	const previous = providers.dashscope;
	if (!override && isObject(previous) && typeof previous.baseUrl === "string" && previous.baseUrl !== next.baseUrl) {
		if (previous.baseUrl.toLowerCase().startsWith("https://")) {
			next.baseUrl = previous.baseUrl;
			console.log(
				"  models.json providers.dashscope keeps its installed non-default endpoint (KYPI_DASHSCOPE_BASE_URL is unset)",
			);
		} else {
			console.error(`WARN: providers.dashscope.baseUrl in ${dst} is not https, so it is reset to ${next.baseUrl}.`);
		}
	}
	if (JSON.stringify(previous) === JSON.stringify(next)) {
		console.log("  models.json providers.dashscope already current - unchanged");
	} else {
		providers.dashscope = next;
		changed = true;
		console.log("  models.json providers.dashscope key merged");
	}

	if (bedrockNext !== undefined) {
		const current = providers["amazon-bedrock"];
		if (current !== undefined && !(isObject(current) && (current.models === undefined || Array.isArray(current.models)))) {
			fatal(
				`FATAL: ${dst} has a providers.amazon-bedrock entry that is not an object with a models array. Refusing to touch it.`,
			);
		}
		const merged = current ?? { ...bedrockNext, models: [] };
		const models = merged.models ?? [];
		const touched = [];
		for (const model of bedrockNext.models) {
			const at = models.findIndex((m) => m && m.id === model.id);
			if (at < 0) {
				models.push(model);
				touched.push(model.id);
			} else if (JSON.stringify(models[at]) !== JSON.stringify(model)) {
				models[at] = model;
				touched.push(model.id);
			}
		}
		if (touched.length === 0 && current !== undefined) {
			console.log("  models.json providers.amazon-bedrock already current - unchanged");
		} else {
			merged.models = models;
			providers["amazon-bedrock"] = merged;
			changed = true;
			console.log(`  models.json providers.amazon-bedrock models merged: ${touched.join(", ")}`);
		}
	}
	if (!changed) return;
	obj.providers = providers;
	writeJson(dst, obj);
}

// Merge-if-absent per provider key; an existing key is never modified. Strict JSON in both directions:
// Pi reads auth.json strictly, and a destination holding a comment is not a file this may rewrite.
function authJson() {
	const src = `${ROOT}/.pi/templates/auth-template.json`;
	const dst = `${AGENT}/auth.json`;
	const tpl = parseJson(fs.readFileSync(src, "utf8"), src);
	if (!isObject(tpl)) fatal(`FATAL: ${src} is not a JSON object. Refusing to guess what to install.`);
	const obj = readObject(dst, "touch", [
		"       This file holds credentials. A refusal is always better than a rewrite:",
		"       fix the JSON by hand and re-run, or move it aside if it is disposable.",
	]);

	// Pi resolves a stored env.AWS_PROFILE ahead of the ambient one (pi-ai 1.1.0 dist/providers/amazon-bedrock.js:65),
	// so an entry still carrying a placeholder would shadow a working `export AWS_PROFILE=...`.
	const SENTINEL = "REPLACE_WITH_";
	const carriesSentinel = (node) => {
		if (typeof node === "string") return node.startsWith(SENTINEL);
		if (Array.isArray(node)) return node.some(carriesSentinel);
		if (node !== null && typeof node === "object") return Object.values(node).some(carriesSentinel);
		return false;
	};
	const added = [];
	const skipped = [];
	for (const key of Object.keys(tpl)) {
		if (Object.hasOwn(obj, key)) continue;
		if (carriesSentinel(tpl[key])) { skipped.push(key); continue; }
		obj[key] = tpl[key];
		added.push(key);
	}
	if (skipped.length > 0) {
		console.log(`  auth.json entries NOT installed (still hold a ${SENTINEL} placeholder): ${skipped.join(", ")}`);
		console.log("       installing one would SHADOW a working ambient value, so it is left out on purpose.");
		console.log("       Add the entry by hand (Pi 1.1.0 has no `pi auth login`) to");
		console.log(`       ${dst} by hand. See RB-03-03 in docs/RUNBOOK.md.`);
	}
	if (added.length === 0) {
		console.log("  auth.json already current - unchanged");
		return;
	}
	// Mode 0600 applies only on creation, so chmod covers a file made looser earlier.
	writeJson(dst, obj, 2, 0o600);
	try {
		fs.chmodSync(dst, 0o600);
	} catch {
		// Windows: chmod toggles the read-only bit only.
	}
	console.log(`  auth.json provider entries added: ${added.join(", ")}`);
}

// pi-subagents reads this dedicated file, not settings.json (src/extension/config.ts). Only the two
// worktreeSetupHook keys are replaced. Absolute because the file is user scope; tab indent matches its saveConfig().
function subagentConfig() {
	const file = `${AGENT}/extensions/subagent/config.json`;
	const hookPath = slashes(`${ROOT}/.pi/scripts/worktree-setup-hook.mjs`);
	const timeoutMs = 30000;
	const obj = readObject(file, "touch");
	if (obj.worktreeSetupHook === hookPath && obj.worktreeSetupHookTimeoutMs === timeoutMs) {
		console.log("  subagent config.json worktreeSetupHook already current - unchanged");
		return;
	}
	obj.worktreeSetupHook = hookPath;
	obj.worktreeSetupHookTimeoutMs = timeoutMs;
	writeJson(file, obj, "\t");
	console.log(`  subagent config.json worktreeSetupHook key merged: ${file}`);
}

// A dangling hook path is a moved or deleted clone and breaks worktree spawns in every repo on the machine.
function reportSubagentConfig() {
	const file = `${AGENT}/extensions/subagent/config.json`;
	const hook = readObject(file, "trust", [], "").worktreeSetupHook;
	if (typeof hook !== "string" || hook === "") {
		fatal(`FATAL: ${file} carries no worktreeSetupHook.`, "       Remedy: re-run bin/bootstrap.sh with no arguments.");
	}
	if (!fs.existsSync(hook)) {
		fatal(
			`FATAL: ${file} points at ${hook}, which does not exist.`,
			"       This config is written at USER scope, so every subagent worktree spawn on this",
			"       machine -- in every repository -- is affected, not just this one.",
			"       This usually means the repository clone that wrote it was moved or deleted.",
			"       Remedy: run bin/bootstrap.sh with no arguments to rewrite it.",
		);
	}
	console.log(`  ${file} -> ${hook} (target exists)`);
}

// Backslashes would be escapes in the TS literal, so the specifier is forward-slashed.
function writeStub() {
	const literal = JSON.stringify(slashes(`${ROOT}/.pi/extensions/safety/index.ts`));
	const out = [
		"// Generated by ky-pi-agent bin/bootstrap.sh. See docs/RUNBOOK.md.",
		"//",
		"// Loads the safety extension at user scope so it applies regardless of project",
		"// trust. If the checkout was moved or deleted, or the extension fails to load,",
		"// every tool call is blocked rather than running unguarded.",
		'import { existsSync } from "node:fs";',
		"",
		"export default async function (pi) {",
		`  let failure = existsSync(${literal}) ? undefined : "is missing";`,
		"  if (failure === undefined) {",
		"    try {",
		`      const mod = await import(${literal});`,
		"      await mod.default(pi);",
		"    } catch (error) {",
		'      failure = "failed to load (" + (error instanceof Error ? error.message : String(error)) + ")";',
		"    }",
		"  }",
		"  if (failure !== undefined) {",
		'    pi.on("tool_call", () => ({',
		"      block: true,",
		`      reason: "ky-safety: the safety extension at " + ${literal} + " " + failure + ". Every tool call is blocked. Re-run bin/bootstrap.sh from a ky-pi-agent checkout.",`,
		"    }));",
		"  }",
		"}",
		"",
	].join("\n");
	if (fs.existsSync(STUB) && fs.readFileSync(STUB, "utf8") === out) {
		console.log(`  ${STUB} already current - unchanged`);
		return;
	}
	writeAtomic(STUB, out);
	console.log(`  wrote ${STUB}`);
}

// Present but pointing at a missing target is a moved or deleted clone and is fatal in every mode.
function reportStub() {
	const target = stubTarget(fs.readFileSync(STUB, "utf8"));
	if (target === undefined) {
		fatal(`FATAL: ${STUB} does not contain the expected dynamic-import line. Refusing to trust it.`);
	}
	if (!fs.existsSync(target)) {
		fatal(
			`FATAL: ${STUB} points at ${target}, which does not exist.`,
			"       This usually means the repository clone that wrote this stub was moved or deleted.",
			"       Every tool call is blocked until it is rewritten.",
			"       Remedy: run bin/bootstrap.sh with no arguments to rewrite it.",
		);
	}
	console.log(`  ${STUB} -> ${target} (target exists)`);
}

// Exactly one safety delivery path per machine. The stub plus a git package of this repo is two diverging
// copies and fails. A git package only warns: its harness copy conflicts with a trusted load of this checkout.
// A local package of this checkout is the harness entry; unfiltered, its guard copy is a second load, which
// the guard detects and skips.
function reportDelivery(willWriteStub) {
	if (!fs.existsSync(SETTINGS)) {
		console.log("  no user settings.json - nothing to compare");
		return;
	}
	const obj = parseJson(fs.readFileSync(SETTINGS, "utf8"), SETTINGS);
	const list = obj && Array.isArray(obj.packages) ? obj.packages : [];
	const git = list.map(sourceOf).filter((s) => THIS_REPO_GIT.test(s));
	const local = list.filter((e) => isThisCheckout(sourceOf(e)));
	const filtersGuard = (e) => {
		if (!isObject(e) || !Array.isArray(e.extensions)) return false;
		if (e.extensions.length === 0) return true;
		const about = (x, lead) => typeof x === "string" && x.startsWith(lead) && x.includes(".pi/extensions/safety");
		const excluded =
			e.extensions.some((x) => about(x, "!")) ||
			e.extensions.some((x) => typeof x === "string" && /^-(\.\/)?\.pi\/extensions\/safety\/index\.ts$/.test(x));
		return excluded && !e.extensions.some((x) => about(x, "+"));
	};
	const stub = willWriteStub || fs.existsSync(STUB);
	for (const s of git) {
		console.log(`  WARN user-level package ${s} loads this checkout, so it double-loads inside this repo`);
	}
	for (const e of local) {
		console.log(
			filtersGuard(e)
				? `  harness package ${sourceOf(e)} (safety extension filtered out)`
				: `  WARN user-level package ${sourceOf(e)} also loads the safety extension; the second copy skips registering`,
		);
	}
	if (git.length > 0 && local.length > 0) {
		fatal(
			`FATAL: the git package ${git[0]} and the local package ${sourceOf(local[0])} both load the harness.`,
			"       Pi exits at start in every repository on their conflicting tools. Keep one: remove the",
			`       local entry from ${SETTINGS} to use the git package, or remove the git package.`,
		);
	}
	if (git.length > 0 && stub) {
		fatal(
			`FATAL: one delivery path only: the user-scope safety stub and the git package ${git[0]} are both configured.`,
			"       They are two copies of the guard that can diverge. Keep the stub (bin/bootstrap.sh)",
			"       or the git package (pi install), never both. Remove one and re-run.",
		);
	}
	const unguarded = local.filter(filtersGuard);
	if (unguarded.length > 0 && !stub && git.length === 0) {
		fatal(
			`FATAL: the harness package ${sourceOf(unguarded[0])} filters the safety extension out, and no`,
			"       safety stub loads it instead, so the harness runs in every repository without the guard.",
			"       Remedy: run bin/bootstrap.sh with no arguments to write the stub.",
		);
	}
	if (git.length === 0 && local.length === 0) {
		console.log("  one delivery path (no user-level package loads this checkout)");
		console.log("  WARN harness package not configured: /mode, /quick, /plan and /review load only inside this checkout");
		console.log("       remedy: run bin/bootstrap.sh with no arguments to apply");
	} else if (git.length === 0) {
		console.log("  one delivery path (no git package of this repo)");
	}
}

// --global-setup puts subagents and web access in every repository, so the guard must reach every
// repository too: a current fail-closed stub, or a user-level git package of this repo.
function requireDelivery() {
	reportDelivery(false);
	let packages = [];
	try {
		const parsed = JSON.parse(fs.readFileSync(SETTINGS, "utf8")).packages;
		if (Array.isArray(parsed)) packages = parsed;
	} catch {
		// An absent settings file means no git package; an invalid one was already refused above.
	}
	if (packages.map(sourceOf).some((s) => THIS_REPO_GIT.test(s))) {
		console.log("  safety guard delivered by the user-level git package");
		return;
	}
	const text = fs.existsSync(STUB) ? fs.readFileSync(STUB, "utf8") : "";
	const target = stubTarget(text);
	if (target === undefined || !fs.existsSync(target) || !text.includes("catch (error)")) {
		fatal(
			"FATAL: --global-setup would install subagents and web access in every repository without the safety guard.",
			`       ${STUB}${text === "" ? " is absent" : " is not a current, fail-closed stub pointing at an existing guard"}.`,
			"       Remedy: run bin/bootstrap.sh with no arguments first, then re-run --global-setup.",
		);
	}
	console.log(`  safety guard delivered by ${STUB} -> ${target}`);
}

const STEPS = {
	"checkout-deps": checkoutDeps,
	"pi-global-matches": piGlobalMatches,
	"composed-specs": composedSpecs,
	settings: mergeSettings,
	"harness-package": mergeHarnessPackage,
	"env-template": envTemplate,
	"models-json": modelsJson,
	"auth-json": authJson,
	"subagent-config": subagentConfig,
	"report-subagent-config": reportSubagentConfig,
	"write-stub": writeStub,
	"report-stub": reportStub,
	delivery: () => reportDelivery(process.argv[3] === "--will-write-stub"),
	"require-delivery": requireDelivery,
};

const step = STEPS[process.argv[2]];
if (step === undefined) fatal(`FATAL: unknown bootstrap step: ${process.argv[2]}`);
step();
