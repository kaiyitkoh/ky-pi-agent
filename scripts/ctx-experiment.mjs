// Typed logic stays in ctx-experiment-core.ts; this CLI only does the I/O the shell launcher cannot do safely.
// Node strips the types on import (>= 22.19). If a 22.x build rejects the import, run with --experimental-strip-types.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { join as joinSlash } from "node:path/posix";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const USAGE = [
	"usage: ctx-experiment.mjs <subcommand>",
	"  plan --seed N --repeats N [--defects a,b]",
	"  prepare <defectId> <trialRoot>",
	"  settings <agentDir> <arm>",
	"  pad <file>",
	"  args <arm> [padFile]",
	"  run <trialRoot> <stdoutFile> <stderrFile> <sh> <pi> [piArgs...]",
	"  summarise <outDir>",
].join("\n");

// Trial ids contain ':' which Windows filesystems reject.
const fileId = (id) => id.replace(/[^A-Za-z0-9_.-]/g, "_");

// Prose is judged against the tools each arm actually exposes; harness arms are approximated by the minimal four.
const ACTIVE_TOOLS = ["read", "bash", "edit", "write"];

function flag(argv, name, fallback) {
	const i = argv.indexOf(name);
	return i === -1 ? fallback : argv[i + 1];
}

function git(args, cwd) {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (r.error || r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
	}
}

function pick(items, id) {
	const found = items.find((d) => d.id === id);
	if (found === undefined) {
		throw new Error(`unknown defect: ${id}`);
	}
	return found;
}

async function main(argv) {
	const [cmd, ...rest] = argv;
	const core = cmd === undefined ? undefined : await load("scripts/ctx-experiment-core.ts");
	const { SEEDED_DEFECTS } = cmd === undefined ? {} : await load("tests/fixtures/seeded-defects/index.ts");

	if (cmd === "plan") {
		const seed = Number(flag(rest, "--seed", "20261013"));
		const repeats = Number(flag(rest, "--repeats", String(core.FIRST_STAGE_REPEATS)));
		const filter = flag(rest, "--defects", "");
		const ids = SEEDED_DEFECTS.map((d) => d.id).filter((id) => filter === "" || filter.split(",").includes(id));
		if (!Number.isInteger(seed) || !Number.isInteger(repeats) || repeats < 1 || ids.length === 0) {
			throw new Error("invalid seed, repeats or defects");
		}
		const plan = core.buildRunPlan(seed, ids, repeats, core.ARMS.map((a) => a.id));
		for (const t of plan) {
			process.stdout.write(`${t.id}\t${t.arm}\t${t.defect}\t${t.repeat}\n`);
		}
		return 0;
	}

	if (cmd === "prepare") {
		const [defectId, root] = rest;
		const defect = pick(SEEDED_DEFECTS, defectId);
		const repo = join(root, "repo");
		mkdirSync(repo, { recursive: true });
		for (const args of [["init"], ["config", "user.email", "quick@test.invalid"], ["config", "user.name", "quick test"], ["checkout", "-b", "work"]]) {
			git(args, repo);
		}
		const built = defect.build(repo);
		const touchedFiles = built.touchedFiles.map((path) => ({ path, contents: readFileSync(join(repo, path), "utf-8") }));
		writeFileSync(join(root, "prompt.md"), core.buildTrialPrompt({ diff: built.diff, touchedFiles }), "utf-8");
		return 0;
	}

	if (cmd === "settings") {
		const [agentDir, arm] = rest;
		mkdirSync(agentDir, { recursive: true });
		const harness = arm === "B" || arm === "F";
		writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(harness ? { packages: [ROOT] } : {}, null, 2)}\n`, "utf-8");
		return 0;
	}

	if (cmd === "pad") {
		const sources = [join(ROOT, "AGENTS.md")];
		const skills = join(ROOT, ".pi", "skills");
		if (existsSync(skills)) {
			for (const name of readdirSync(skills).sort()) {
				sources.push(join(skills, name, "SKILL.md"));
			}
		}
		const texts = sources.filter((p) => existsSync(p)).map((p) => readFileSync(p, "utf-8"));
		writeFileSync(rest[0], core.padFileText(core.PAD_TOKENS * 4, texts), "utf-8");
		return 0;
	}

	if (cmd === "args") {
		const [arm, padFile] = rest;
		process.stdout.write(`${core.armArgs(arm, { padFile }).join("\n")}\n`);
		return 0;
	}

	if (cmd === "run") {
		// The key travels in the child's env object, never on any argv (process listings and audit logs record argv).
		const [trialRoot, stdoutFile, stderrFile, shBin, piBin, ...piArgs] = rest;
		const keyVar = process.env.KY_EXP_KEY_VAR ?? "";
		const key = process.env[keyVar];
		if (key === undefined || key === "") {
			throw new Error("run: the variable named by KY_EXP_KEY_VAR is not set");
		}
		const home = joinSlash(trialRoot, "home");
		const tmp = joinSlash(trialRoot, "tmp");
		const env = {
			[keyVar]: key,
			PATH: process.env.PATH ?? "",
			HOME: home,
			USERPROFILE: home,
			TMP: tmp,
			TEMP: tmp,
			TMPDIR: tmp,
			PI_CODING_AGENT_DIR: joinSlash(trialRoot, "agent"),
		};
		if (process.env.SYSTEMROOT !== undefined) {
			env.SYSTEMROOT = process.env.SYSTEMROOT;
		}
		const prompt = readFileSync(join(trialRoot, "prompt.md"), "utf-8");
		const outFd = openSync(stdoutFile, "w");
		const errFd = openSync(stderrFile, "w");
		try {
			// Through sh so a shebang fake or npm's sh shim for pi runs on Windows as it does on macOS.
			const r = spawnSync(shBin, ["-c", 'exec "$0" "$@"', piBin, ...piArgs, prompt], {
				cwd: join(trialRoot, "repo"),
				env,
				stdio: ["ignore", outFd, errFd],
				shell: false,
				windowsHide: true,
			});
			if (r.error) {
				throw r.error;
			}
			return r.status ?? 1;
		} finally {
			closeSync(outFd);
			closeSync(errFd);
		}
	}

	if (cmd === "summarise") {
		const out = rest[0];
		const expectations = SEEDED_DEFECTS.map((d) => ({ id: d.id, ...d.expected }));
		const rows = readFileSync(join(out, "trials.tsv"), "utf-8").split("\n").filter((l) => l !== "");
		const failuresFile = join(out, "failures.tsv");
		const exitStatus = new Map(
			(existsSync(failuresFile) ? readFileSync(failuresFile, "utf-8") : "")
				.split("\n")
				.filter((l) => l !== "")
				.map((l) => {
					const [id, status] = l.split("\t");
					return [id, Number(status) || 1];
				}),
		);
		const scored = rows.map((line) => {
			const [id, arm, defect, repeat] = line.split("\t");
			const file = join(out, `${fileId(id)}.jsonl`);
			const output = core.parseJsonModeOutput(existsSync(file) ? readFileSync(file, "utf-8") : "");
			const excluded = core.isInfrastructureFailure(output, exitStatus.get(id));
			return { arm, defect, repeat: Number(repeat), score: core.scoreTrial(output.finalText, defect, expectations), output, excluded };
		});
		const tools = { A: ACTIVE_TOOLS, B: ACTIVE_TOOLS, F: ACTIVE_TOOLS, C: ACTIVE_TOOLS };
		const arms = core.summarise(scored, tools);
		const compare = (a, b) => {
			const first = arms[a];
			const second = arms[b];
			if (first === undefined || second === undefined || first.trials === 0 || second.trials === 0) {
				return { decision: "INCONCLUSIVE" };
			}
			const p1 = { caught: first.caught, n: first.trials };
			const p2 = { caught: second.caught, n: second.trials };
			const [lower, upper] = core.diffInterval(p1, p2, core.Z_90);
			return {
				delta: p1.caught / p1.n - p2.caught / p2.n,
				interval: [lower, upper],
				decision: core.decideArms(first, second),
			};
		};
		const messages = Object.values(arms).reduce((s, a) => s + a.assistantMessages, 0);
		const prose = Object.values(arms).reduce((s, a) => s + a.proseMessages, 0);
		const summary = {
			trials: scored.length,
			excluded: scored.filter((t) => t.excluded).length,
			arms,
			decision: compare("F", "A"),
			comparisons: { "F-vs-A": compare("F", "A"), "B-vs-A": compare("B", "A"), "C-vs-A": compare("C", "A") },
			discrimination: core.discriminate(arms),
			proseRate: messages === 0 ? 0 : prose / messages,
			malformed: Object.values(arms).reduce((s, a) => s + a.malformed, 0),
		};
		writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
		const pct = (a) => {
			if (a === undefined) {
				return "n/a";
			}
			const rate = a.trials === 0 ? "n/a" : `${((100 * a.caught) / a.trials).toFixed(1)}%`;
			return `${a.caught}/${a.trials} (${rate}), excluded ${a.excluded}`;
		};
		const lines = ["Context-pollution experiment summary", `trials: ${summary.trials}, excluded: ${summary.excluded}`];
		for (const id of ["A", "B", "F", "C"]) {
			lines.push(`arm ${id}: catch ${pct(arms[id])}`);
		}
		for (const [name, c] of Object.entries(summary.comparisons)) {
			const iv = c.interval === undefined ? "" : ` delta ${c.delta.toFixed(3)} interval [${c.interval[0].toFixed(3)}, ${c.interval[1].toFixed(3)}]`;
			lines.push(`${name}: ${c.decision}${iv}`);
		}
		lines.push(`discrimination: ${summary.discrimination}`, `prose rate: ${summary.proseRate.toFixed(3)}`, `malformed: ${summary.malformed}`);
		process.stdout.write(`${lines.join("\n")}\n`);
		return 0;
	}

	process.stderr.write(`${USAGE}\n`);
	return 2;
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error) => {
		process.stderr.write(`ctx-experiment: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	},
);
