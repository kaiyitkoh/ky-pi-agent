/**
 * The context experiment's launcher, run end to end against a FAKE `pi`. No real pi, no provider, no inference.
 * The fake records its own environment and argv so the test can prove the AWS_* pollution placed in the parent
 * environment never reaches a trial, which is the safety property that matters on a laptop holding live
 * credentials while the minimal arm has bash and no safety layer.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { SEEDED_DEFECTS } from "../fixtures/seeded-defects/index.ts";
import { repoRoot } from "../helpers/git.ts";

const ROOT = repoRoot();
const LAUNCHER = join(ROOT, "scripts", "ctx-experiment.sh").replace(/\\/g, "/");
const CLI = join(ROOT, "scripts", "ctx-experiment.mjs");
const TIMEOUT_MS = 180_000;
const fwd = (p: string) => p.replace(/\\/g, "/");

function resolveSh(): string {
	const finder = process.platform === "win32" ? "where" : "which";
	const found = spawnSync(finder, ["sh"], { encoding: "utf-8", windowsHide: true });
	const first = (found.stdout ?? "").split(/\r?\n/).find((line) => line.trim().length > 0);
	if (!first) {
		throw new Error(`could not locate sh via ${finder}; install Git Bash on Windows`);
	}
	return first.trim();
}

const SH = resolveSh();
const scratch: string[] = [];
const tempDir = (prefix: string) => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
};
afterAll(() => {
	for (const dir of scratch) {
		rmSync(dir, { recursive: true, force: true });
	}
});

const defect = SEEDED_DEFECTS[0];
const expectations = SEEDED_DEFECTS.map((d) => ({ id: d.id, ...d.expected }));

function reviewText(findings: unknown[]): string {
	const review = {
		verdicts: [{ requirementId: "R1", status: "Partial", evidence: "src/x.ts:1" }],
		findings,
		checkedAndCleared: "Read every touched file in full.",
		classification: "root-cause",
		classificationJustification: "Addresses the stated purpose.",
	};
	return `Review.\n\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\`\n`;
}

function catching(id: string) {
	const e = expectations.find((x) => x.id === id);
	if (e === undefined) throw new Error(`no expectation ${id}`);
	return {
		severity: e.minimumSeverity,
		location: `${e.locationFile}:1`,
		concreteFailure: `This change ${e.mustMentionAny.slice(0, 2).join(" and ")}.`,
		suggestedFix: "Fix it.",
	};
}

function streamOf(text: string): string {
	const message = { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 10, cacheRead: 0 } };
	return `${JSON.stringify({ type: "message_end", message })}\n`;
}

function runLauncher(env: Record<string, string>) {
	const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
	for (const key of Object.keys(merged)) {
		if (!(key in env) && key.startsWith("KY_EXP_")) delete merged[key];
	}
	return spawnSync(SH, [LAUNCHER], { env: merged, encoding: "utf-8", timeout: TIMEOUT_MS, windowsHide: true });
}

describe("ctx-experiment launcher with a fake pi", () => {
	const evidence = tempDir("ctx-evidence-");
	const out = tempDir("ctx-out-");
	const fakeDir = tempDir("ctx-fakepi-");
	const fakePi = join(fakeDir, "pi");
	writeFileSync(join(evidence, "canned.jsonl"), streamOf(reviewText([catching(defect.id)])), "utf-8");
	writeFileSync(
		fakePi,
		[
			"#!/bin/sh",
			`d="${fwd(evidence)}"`,
			`n=$(ls "$d" | grep -c '^env\\.')`,
			`env >"$d/env.$n"`,
			`printf '%s\\n' "$@" >"$d/argv.$n"`,
			`cat "$d/canned.jsonl"`,
			"",
		].join("\n"),
		{ encoding: "utf-8", mode: 0o755 },
	);

	const base = {
		KY_EXP_PI: fwd(fakePi),
		KY_EXP_DEFECTS: defect.id,
		KY_EXP_REPEATS: "1",
		KY_EXP_MODEL: "faux/faux-flash",
		KY_EXP_KEY_VAR: "KY_EXP_FAKE_KEY",
		KY_EXP_FAKE_KEY: "dummy-key-value",
		KY_EXP_OUT: fwd(out),
		AWS_PROFILE: "should-not-leak",
		AWS_SECRET_ACCESS_KEY: "should-not-leak",
	};

	it("runs every arm in a scrubbed environment and writes a summary", () => {
		const result = runLauncher(base);
		expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);

		const jsonl = readdirSync(out).filter((f) => f.endsWith(".jsonl"));
		expect(jsonl).toHaveLength(4);

		const envs = readdirSync(evidence).filter((f) => f.startsWith("env."));
		const argvs = readdirSync(evidence).filter((f) => f.startsWith("argv."));
		expect(envs).toHaveLength(4);
		const real = homedir().replace(/\\/g, "/");
		for (const name of envs) {
			const lines = readFileSync(join(evidence, name), "utf-8").split(/\r?\n/);
			expect(lines.some((l) => l.startsWith("AWS_"))).toBe(false);
			expect(lines.join("\n")).not.toContain("should-not-leak");
			expect(lines).toContain("KY_EXP_FAKE_KEY=dummy-key-value");
			const home = lines.find((l) => l.startsWith("HOME="));
			const agent = lines.find((l) => l.startsWith("PI_CODING_AGENT_DIR="));
			expect(home).toBeDefined();
			expect(agent).toBeDefined();
			expect((home as string).slice(5).replace(/\\/g, "/")).not.toBe(real);
			expect((home as string).endsWith("/home")).toBe(true);
			expect((agent as string).endsWith("/agent")).toBe(true);
			expect(lines.some((l) => l.startsWith("KY_EXP_MODEL="))).toBe(false);
		}

		const argLists = argvs.map((f) => readFileSync(join(evidence, f), "utf-8").split("\n"));
		const full = argLists.filter((a) => a.includes("--ky-profile") && a.includes("full"));
		const minimal = argLists.filter((a) => a.includes("-ne") && a.includes("-nc") && !a.includes("--append-system-prompt"));
		const padded = argLists.filter((a) => a.includes("-ne") && a.includes("--append-system-prompt"));
		expect(full).toHaveLength(1);
		expect(minimal).toHaveLength(1);
		expect(padded).toHaveLength(1);

		const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf-8"));
		expect(summary.trials).toBe(4);
		for (const arm of ["A", "B", "F", "C"]) {
			expect(summary.arms[arm].trials).toBe(1);
		}
		expect(summary.decision).toHaveProperty("decision");
		expect(result.stdout).toContain("Context-pollution experiment summary");
	}, TIMEOUT_MS);

	it("refuses to start without a model, before any trial", () => {
		const before = readdirSync(evidence).length;
		const env: Record<string, string> = { ...base, KY_EXP_OUT: fwd(tempDir("ctx-out2-")) };
		delete (env as Record<string, string | undefined>).KY_EXP_MODEL;
		const result = runLauncher(env);
		expect(result.status).not.toBe(0);
		expect(readdirSync(evidence).length).toBe(before);
	});
});

describe("ctx-experiment summarise", () => {
	it("reports catches for the arm that caught and misses for the arm that did not", () => {
		const out = tempDir("ctx-sum-");
		const id = defect.id;
		writeFileSync(join(out, "trials.tsv"), `${id}:r0:A\tA\t${id}\t0\n${id}:r0:F\tF\t${id}\t0\n`, "utf-8");
		writeFileSync(join(out, `${id}_r0_A.jsonl`), streamOf(reviewText([catching(id)])), "utf-8");
		writeFileSync(join(out, `${id}_r0_F.jsonl`), streamOf(reviewText([])), "utf-8");
		const result = spawnSync(process.execPath, [CLI, "summarise", out], { encoding: "utf-8", windowsHide: true });
		expect(result.status, result.stderr).toBe(0);
		const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf-8"));
		expect(summary.arms.A.caught).toBe(1);
		expect(summary.arms.F.caught).toBe(0);
		expect(summary.arms.F.misses).toBe(1);
		expect(summary.decision.delta).toBe(-1);
	});

	it("exits 2 with usage for an unknown subcommand", () => {
		const result = spawnSync(process.execPath, [CLI, "bogus"], { encoding: "utf-8", windowsHide: true });
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("usage");
	});
});
