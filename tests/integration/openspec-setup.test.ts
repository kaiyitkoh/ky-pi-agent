/**
 * scripts/openspec-setup.sh against a fake `openspec` CLI and a fake `npm`.
 *
 * The real CLI is never run: it needs the network to install and it would write
 * the developer's real OpenSpec config. Every case redirects the agent dir and
 * XDG_CONFIG_HOME at fresh temp dirs.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { OPENSPEC_SKILL_NAMES, OPENSPEC_WORKFLOWS, openspecPromptMd, openspecSkillMd } from "../fixtures/openspec-skills.ts";
import { repoRoot } from "../helpers/git.ts";
import { scratchDirs } from "../helpers/scratch.ts";
import { withStubBin } from "../helpers/stub-bin.ts";

const SCRIPT_PATH = join(repoRoot(), "scripts", "openspec-setup.sh");
const SCRIPT = SCRIPT_PATH.replace(/\\/g, "/");
const FLAG = "disable-model-invocation: true";

const FAKE_PAYLOAD = `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
const control = JSON.parse(readFileSync(process.env.FAKE_OPENSPEC_CONTROL, "utf-8"));
const argv = process.argv.slice(2);
const log = (o) => appendFileSync(control.log, JSON.stringify(o) + "\\n");
if (argv[0] === "--version") {
	process.stdout.write(control.version + "\\n");
} else if (argv[0] === "init") {
	const xdg = process.env.XDG_CONFIG_HOME ?? null;
	const cfgPath = xdg ? join(xdg, "openspec", "config.json") : null;
	log({
		kind: "init",
		argv,
		cwd: process.cwd(),
		env: {
			OPENSPEC_TELEMETRY: process.env.OPENSPEC_TELEMETRY ?? null,
			DO_NOT_TRACK: process.env.DO_NOT_TRACK ?? null,
			OPENSPEC_NO_UPDATE_CHECK: process.env.OPENSPEC_NO_UPDATE_CHECK ?? null,
			OPENSPEC_NO_AUTO_CONFIG: process.env.OPENSPEC_NO_AUTO_CONFIG ?? null,
		},
		xdg,
		config: cfgPath && existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf-8")) : null,
	});
	for (const [name, content] of Object.entries(control.skills)) {
		const p = join(process.cwd(), ".pi", "skills", name, "SKILL.md");
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, content);
	}
	for (const [file, content] of Object.entries(control.prompts)) {
		const p = join(process.cwd(), ".pi", "prompts", file);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, content);
	}
	mkdirSync(join(process.cwd(), "openspec"), { recursive: true });
	writeFileSync(join(process.cwd(), "openspec", "config.yaml"), "schema: spec-driven\\n");
} else if (argv[0] === "config" && argv[1] === "set") {
	log({ kind: "config-set", argv, xdg: process.env.XDG_CONFIG_HOME ?? null, env: { OPENSPEC_NO_AUTO_CONFIG: process.env.OPENSPEC_NO_AUTO_CONFIG ?? null } });
} else if (argv[0] === "config" && argv[1] === "get" && argv[2] === "telemetry.enabled") {
	log({ kind: "config-get", argv, xdg: process.env.XDG_CONFIG_HOME ?? null });
	process.stdout.write((control.telemetryGet ?? "false") + "\\n");
} else {
	process.exitCode = 1;
}
`;

const scratch = scratchDirs();
const tempDir = scratch.make;

afterEach(scratch.cleanup);

function pathKeyOf(env: Record<string, string>): string {
	return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

interface Fake {
	agent: string;
	realXdg: string;
	cwd: string;
	bin: string;
	log: string;
	env: Record<string, string>;
}

interface FakeOpts {
	version?: string;
	skills?: Record<string, string>;
	prompts?: Record<string, string>;
	telemetryGet?: string;
}

function defaultSkills(): Record<string, string> {
	return Object.fromEntries(OPENSPEC_SKILL_NAMES.map((n) => [n, openspecSkillMd(n)]));
}

function defaultPrompts(): Record<string, string> {
	return Object.fromEntries(OPENSPEC_WORKFLOWS.map((w) => [`opsx-${w.workflow}.md`, openspecPromptMd(w.workflow)]));
}

function makeFake(opts: FakeOpts = {}, make: (prefix: string) => string = tempDir): Fake {
	const root = make("kypi-ospec-");
	const agent = join(root, "agent");
	const realXdg = join(root, "real-xdg");
	const cwd = join(root, "cwd");
	const bin = join(root, "bin");
	for (const d of [realXdg, cwd, bin]) {
		mkdirSync(d, { recursive: true });
	}
	const log = join(root, "fake.log");
	writeFileSync(log, "");
	const control = join(root, "control.json");
	writeFileSync(
		control,
		JSON.stringify({
			version: opts.version ?? "1.13.2",
			skills: opts.skills ?? defaultSkills(),
			prompts: opts.prompts ?? defaultPrompts(),
			telemetryGet: opts.telemetryGet,
			log,
		}),
	);
	const payload = join(bin, "openspec.mjs");
	writeFileSync(payload, FAKE_PAYLOAD);
	const launcher = join(bin, "openspec");
	writeFileSync(launcher, `#!/bin/sh\nexec node "${payload.replace(/\\/g, "/")}" "$@"\n`);
	chmodSync(launcher, 0o755);

	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) {
			env[k] = v;
		}
	}
	const key = pathKeyOf(env);
	env[key] = bin + delimiter + (env[key] ?? "");
	env.FAKE_OPENSPEC_CONTROL = control;
	env.PI_CODING_AGENT_DIR = agent;
	env.XDG_CONFIG_HOME = realXdg;
	return { agent, realXdg, cwd, bin, log, env };
}

function run(fake: Fake, args: string[] = [], env: Record<string, string> = fake.env) {
	const r = spawnSync("sh", [SCRIPT, ...args], {
		cwd: fake.cwd,
		env,
		encoding: "utf-8",
		timeout: 60_000,
		windowsHide: true,
	});
	if (r.error) {
		throw r.error;
	}
	return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function logLines(fake: Fake): Record<string, any>[] {
	return readFileSync(fake.log, "utf-8")
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l));
}

const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

function skillPath(fake: Fake, skill: string): string {
	return join(fake.agent, "skills", skill, "SKILL.md");
}

function promptPath(fake: Fake, workflow: string): string {
	return join(fake.agent, "prompts", `opsx-${workflow}.md`);
}

/** Flag lines inside the first frontmatter block only. */
function frontmatterFlagLines(content: string): string[] {
	const lines = content.split(/\r?\n/);
	const out: string[] = [];
	let fences = 0;
	for (const line of lines) {
		if (line === "---") {
			fences += 1;
			if (fences === 2) {
				break;
			}
			continue;
		}
		if (fences === 1 && line.startsWith("disable-model-invocation:")) {
			out.push(line);
		}
	}
	return out;
}

function snapshot(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (d: string, rel: string) => {
		for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) {
				walk(join(d, e.name), r);
			} else {
				out[r] = readFileSync(join(d, e.name), "utf-8");
			}
		}
	};
	walk(dir, "");
	return out;
}

function openspecDirs(fake: Fake): string[] {
	const skills = join(fake.agent, "skills");
	return existsSync(skills) ? readdirSync(skills).filter((n) => n.startsWith("openspec-")) : [];
}

const repoPiStatus = () =>
	spawnSync("git", ["status", "--porcelain", ".pi"], { cwd: repoRoot(), encoding: "utf-8" }).stdout;

describe("scripts/openspec-setup.sh", () => {
	// Compared against a pre-run snapshot, not an empty porcelain, so in-progress edits under .pi do not fail this file.
	let piStatusBefore = "";
	// One default install, shared by the tests that only read its result.
	const sharedDirs = scratchDirs();
	let fake: Fake;
	let first: ReturnType<typeof run>;
	beforeAll(() => {
		piStatusBefore = repoPiStatus();
		fake = makeFake({}, sharedDirs.make);
		first = run(fake);
	});
	afterAll(sharedDirs.cleanup);

	it("installs 12 flagged skills and 12 prompts", () => {
		expect(first.status, first.stderr).toBe(0);
		for (const { workflow, skill } of OPENSPEC_WORKFLOWS) {
			const content = readFileSync(skillPath(fake, skill), "utf-8");
			expect(frontmatterFlagLines(content)).toEqual([FLAG]);
			expect(content).toContain("The generated header carries disable-model-invocation only when the harness patches it in.");
			expect(existsSync(promptPath(fake, workflow))).toBe(true);
		}
	});

	it("generates in an isolated project with the isolated config and the four opt-outs", () => {
		const init = logLines(fake).find((l) => l.kind === "init");
		expect(init).toBeDefined();
		expect(init!.argv).toEqual(["init", "--tools", "pi", "--profile", "custom", "."]);
		expect(init!.env).toEqual({
			OPENSPEC_TELEMETRY: "0",
			DO_NOT_TRACK: "1",
			OPENSPEC_NO_UPDATE_CHECK: "1",
			OPENSPEC_NO_AUTO_CONFIG: "1",
		});
		expect(norm(init!.xdg)).not.toBe(norm(fake.realXdg));
		expect(init!.config.profile).toBe("custom");
		expect(init!.config.delivery).toBe("both");
		expect(init!.config.workflows).toEqual(OPENSPEC_WORKFLOWS.map((w) => w.workflow));
		expect(init!.config.telemetry).toEqual({ enabled: false });
		expect(norm(init!.cwd)).not.toBe(norm(fake.cwd));
	});

	it("sets telemetry off on the real config with the user's own XDG_CONFIG_HOME", () => {
		const set = logLines(fake).find((l) => l.kind === "config-set");
		expect(set).toBeDefined();
		expect(set!.argv).toEqual(["config", "set", "telemetry.enabled", "false"]);
		expect(norm(set!.xdg)).toBe(norm(fake.realXdg));
		expect(set!.env.OPENSPEC_NO_AUTO_CONFIG).toBe("1");
		const get = logLines(fake).find((l) => l.kind === "config-get");
		expect(get, "the script must read the value back, not trust the set").toBeDefined();
		expect(norm(get!.xdg)).toBe(norm(fake.realXdg));
	});

	it("warns when telemetry.enabled does not read back as false", () => {
		expect(first.stderr).not.toContain("telemetry.enabled reads back");

		const bad = run(makeFake({ telemetryGet: "true" }));
		expect(bad.status).toBe(0);
		expect(bad.stderr).toContain('telemetry.enabled reads back as "true"');
	});

	it("is byte-identical on a second run", () => {
		const installed = snapshot(fake.agent);
		expect(Object.keys(installed)).toHaveLength(24);
		expect(run(fake).status).toBe(0);
		expect(snapshot(fake.agent)).toEqual(installed);
	});

	it("does not duplicate an existing true flag and rewrites false to true", () => {
		const skills = defaultSkills();
		skills["openspec-propose"] = openspecSkillMd("openspec-propose", "true");
		skills["openspec-explore"] = openspecSkillMd("openspec-explore", "false");
		skills["openspec-onboard"] = openspecSkillMd("openspec-onboard", "quoted");
		const fake = makeFake({ skills });
		expect(run(fake).status).toBe(0);
		for (const name of ["openspec-propose", "openspec-explore", "openspec-onboard"]) {
			const content = readFileSync(skillPath(fake, name), "utf-8");
			expect(frontmatterFlagLines(content)).toEqual([FLAG]);
			expect(content).not.toContain("disable-model-invocation: false");
			expect(content).not.toContain('disable-model-invocation: "true"');
		}
	});

	it("fails and installs nothing when the CLI generates only 11 skills", () => {
		const skills = defaultSkills();
		delete skills["openspec-onboard"];
		const fake = makeFake({ skills });
		const r = run(fake);
		expect(r.status).not.toBe(0);
		expect(r.stderr + r.stdout).toContain("openspec-onboard");
		expect(openspecDirs(fake)).toEqual([]);
		expect(existsSync(join(fake.agent, "prompts"))).toBe(false);
	});

	it("refuses a CLI whose version differs from the pin", () => {
		const fake = makeFake({ version: "1.14.1" });
		const r = run(fake);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain("1.13.2");
		expect(r.stderr).toContain("1.14.1");
		expect(r.stderr).toContain("--install-cli");
		expect(openspecDirs(fake)).toEqual([]);
	});

	it("refuses an agent dir inside the repository and writes nothing", () => {
		const fake = makeFake();
		const inside = join(repoRoot(), ".kypi-ospec-test-agent-" + process.pid);
		const env = { ...fake.env, PI_CODING_AGENT_DIR: inside };
		try {
			const r = run(fake, [], env);
			expect(r.status).toBe(2);
			expect(existsSync(inside)).toBe(false);
			expect(logLines(fake)).toEqual([]);
		} finally {
			rmSync(inside, { recursive: true, force: true });
		}
	});

	it("refuses a relative agent dir that lands inside the repository", () => {
		const fake = makeFake();
		const name = ".kypi-ospec-rel-agent-" + process.pid;
		const inside = join(repoRoot(), name);
		try {
			const r = spawnSync("sh", [SCRIPT], {
				cwd: repoRoot(),
				env: { ...fake.env, PI_CODING_AGENT_DIR: "./" + name },
				encoding: "utf-8",
				timeout: 60_000,
				windowsHide: true,
			});
			expect(r.status, r.stderr).toBe(2);
			expect(existsSync(inside)).toBe(false);
			expect(logLines(fake)).toEqual([]);
		} finally {
			rmSync(inside, { recursive: true, force: true });
		}
	});

	it("refuses a case-variant spelling of a path inside the repository", () => {
		const fake = makeFake();
		const root = repoRoot().replace(/\\/g, "/");
		const swapped = root.replace(/[A-Za-z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
		const name = ".kypi-ospec-case-agent-" + process.pid;
		const env = { ...fake.env, PI_CODING_AGENT_DIR: swapped + "/" + name };
		try {
			const r = run(fake, [], env);
			expect(r.status, r.stderr).toBe(2);
			expect(existsSync(join(repoRoot(), name))).toBe(false);
			expect(logLines(fake)).toEqual([]);
		} finally {
			rmSync(join(repoRoot(), name), { recursive: true, force: true });
		}
	});

	it("refuses a .. path through a missing directory that climbs into the repository", () => {
		const fake = makeFake();
		const name = ".kypi-ospec-dotdot-agent-" + process.pid;
		// Climbs from the repository's parent: the temp dir may be on another drive, where no relative climb exists.
		const parent = dirname(repoRoot()).replace(/\\/g, "/");
		const env = { ...fake.env, PI_CODING_AGENT_DIR: `${parent}/kypi-missing-${process.pid}/../${basename(repoRoot())}/${name}` };
		try {
			const r = run(fake, [], env);
			expect(r.status, r.stderr).toBe(2);
			expect(existsSync(join(repoRoot(), name))).toBe(false);
			expect(logLines(fake)).toEqual([]);
		} finally {
			rmSync(join(repoRoot(), name), { recursive: true, force: true });
		}
	});

	it("expands a leading ~ the way Pi does", () => {
		const fake = makeFake();
		const home = tempDir("kypi-ospec-home-");
		const env = { ...fake.env, HOME: home, PI_CODING_AGENT_DIR: "~/agent" };
		const r = run(fake, [], env);
		expect(r.status, r.stderr).toBe(0);
		expect(existsSync(join(home, "agent", "skills", "openspec-explore", "SKILL.md"))).toBe(true);
		expect(existsSync(join(fake.cwd, "~"))).toBe(false);
	});

	it("--install-cli runs npm with the exact pinned, script-free argv", () => {
		const fake = makeFake();
		const npmLog = join(fake.cwd, "npm.log");
		withStubBin({ npm: { logTo: npmLog } }, (stubEnv) => {
			const key = pathKeyOf(stubEnv);
			const env = { ...stubEnv, ...fake.env };
			env[key] = fake.bin + delimiter + stubEnv[key];
			const r = run(fake, ["--install-cli"], env);
			expect(r.status, r.stderr).toBe(0);
		});
		expect(readFileSync(npmLog, "utf-8").trim()).toBe("npm install -g --ignore-scripts @fission-ai/openspec@1.13.2");
	});

	it("--check passes after install and names a skill whose flag was removed", () => {
		const fake = makeFake();
		expect(run(fake).status).toBe(0);
		const ok = run(fake, ["--check"]);
		expect(ok.status, ok.stderr + ok.stdout).toBe(0);

		const target = skillPath(fake, "openspec-apply-change");
		writeFileSync(target, readFileSync(target, "utf-8").replace(`${FLAG}\n`, ""));
		const bad = run(fake, ["--check"]);
		expect(bad.status).toBe(1);
		expect(bad.stderr + bad.stdout).toContain("openspec-apply-change");
	});

	it("--check fails when a prompt is missing", () => {
		const fake = makeFake();
		expect(run(fake).status).toBe(0);
		rmSync(promptPath(fake, "ff"));
		const bad = run(fake, ["--check"]);
		expect(bad.status).toBe(1);
		expect(bad.stderr + bad.stdout).toContain("opsx-ff");
	});

	it("--uninstall removes only the owned skills and prompts", () => {
		const fake = makeFake();
		expect(run(fake).status).toBe(0);
		mkdirSync(join(fake.agent, "skills", "other-skill"), { recursive: true });
		writeFileSync(join(fake.agent, "skills", "other-skill", "SKILL.md"), "keep\n");
		writeFileSync(join(fake.agent, "prompts", "mine.md"), "keep\n");

		const r = run(fake, ["--uninstall"]);
		expect(r.status, r.stderr).toBe(0);
		for (const { workflow, skill } of OPENSPEC_WORKFLOWS) {
			expect(existsSync(join(fake.agent, "skills", skill))).toBe(false);
			expect(existsSync(promptPath(fake, workflow))).toBe(false);
		}
		expect(readFileSync(join(fake.agent, "skills", "other-skill", "SKILL.md"), "utf-8")).toBe("keep\n");
		expect(readFileSync(join(fake.agent, "prompts", "mine.md"), "utf-8")).toBe("keep\n");
	});

	it("rejects unknown arguments with exit 2", () => {
		const fake = makeFake();
		expect(run(fake, ["--bogus"]).status).toBe(2);
		expect(run(fake, ["--check", "--uninstall"]).status).toBe(2);
	});

	it("holds one well-formed pin and leaves repo .pi untouched", () => {
		const src = readFileSync(SCRIPT_PATH, "utf-8");
		const m = /^OPENSPEC_VERSION="([^"]*)"$/m.exec(src);
		expect(m).not.toBeNull();
		expect(m![1]).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
		expect(src.match(/^OPENSPEC_VERSION=/gm)).toHaveLength(1);

		expect(repoPiStatus()).toBe(piStatusBefore);
	});
});
