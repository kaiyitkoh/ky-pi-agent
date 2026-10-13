/**
 * The checkpoint store's own guarantees: a corrupt row never reaches a consumer, the index is bounded, concurrent
 * recorders lose nothing, and `label` is the human-readable one. Everything writes only into `os.tmpdir()`.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../helpers/git.ts";
import { CI_TIME_FACTOR } from "../helpers/timing.ts";
import {
	MAX_CHECKPOINT_ENTRIES,
	pruneCheckpoints,
	readCheckpoints,
	recordCheckpoint,
	STATE_DIR_SEGMENT,
} from "../../.pi/extensions/checkpoint/store.ts";

let tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	}
	tempDirs = [];
});

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), "kypi-cpstore-"));
	tempDirs.push(dir);
	return dir;
}

/** The store file path, spelled the way the module itself builds it. */
function storeFile(root: string): string {
	return join(root, ".pi", STATE_DIR_SEGMENT, "checkpoints.json");
}

/** Write raw text as the store, bypassing recordCheckpoint. */
function plantStore(root: string, text: string): string {
	const file = storeFile(root);
	mkdirSync(join(root, ".pi", STATE_DIR_SEGMENT), { recursive: true });
	writeFileSync(file, text, "utf-8");
	return file;
}

describe("WR-11 -- readCheckpoints validates every element and never hands a consumer something it will dereference", () => {
	// index.ts calls `e.sha.slice` and `e.sha.startsWith`, so a `[1,2,3]` store would throw from an event handler.
	const MALFORMED: { label: string; text: string }[] = [
		{ label: "an array of numbers", text: "[1,2,3]" },
		{ label: "an array of nulls", text: "[null,null]" },
		{ label: "rows with no sha", text: '[{"label":"x","cwd":"/tmp","ts":1}]' },
		{ label: "rows with an empty sha", text: '[{"sha":"","label":"x","cwd":"/tmp","ts":1}]' },
		{ label: "rows with a numeric sha", text: '[{"sha":123,"label":"x","cwd":"/tmp","ts":1}]' },
		{ label: "rows with a non-numeric ts", text: '[{"sha":"abc","label":"x","cwd":"/tmp","ts":"now"}]' },
		{ label: "rows with a non-string entryId", text: '[{"sha":"abc","label":"x","cwd":"/tmp","ts":1,"entryId":7}]' },
		{ label: "nested arrays", text: "[[],[]]" },
		{ label: "an object, not an array", text: '{"sha":"abc"}' },
		{ label: "not JSON at all", text: "{{{" },
	];

	for (const { label, text } of MALFORMED) {
		it(`drops ${label}`, () => {
			const root = scratch();
			plantStore(root, text);
			const entries = readCheckpoints(root);
			expect(entries, `a store containing ${label} must read as no usable entries, never as raw data`).toEqual([]);
		});
	}

	it("keeps the conforming rows in a PARTLY corrupt store -- drops elements, not the file", () => {
		// The negative control. A validator that returned [] for anything
		// imperfect would pass every case above while destroying real data.
		const root = scratch();
		plantStore(
			root,
			JSON.stringify([
				1,
				{ sha: "a".repeat(40), label: "good one", cwd: root, ts: 1 },
				null,
				{ label: "no sha" },
				{ sha: "b".repeat(40), label: "good two", cwd: root, ts: 2, entryId: "e1" },
			]),
		);
		expect(
			readCheckpoints(root).map((e) => e.label),
			"the two well-formed rows must survive -- dropping the whole file on one bad element would " +
				"lose every restorable checkpoint the user has",
		).toEqual(["good one", "good two"]);
	});

	it("a consumer's own dereference does not throw on a corrupt store", () => {
		// The property that actually matters, expressed the way index.ts uses it.
		const root = scratch();
		plantStore(root, "[1,2,3]");
		expect(() => readCheckpoints(root).map((e) => e.sha.slice(0, 12))).not.toThrow();
	});
});

describe("WR-10 -- the index is bounded and pruning reports what it evicted", () => {
	it("keeps the newest MAX entries and returns the evicted ones oldest-first", () => {
		const root = scratch();
		const total = MAX_CHECKPOINT_ENTRIES + 5;
		for (let i = 0; i < total; i++) {
			recordCheckpoint(root, { sha: String(i).padStart(40, "0"), label: `turn ${i}`, cwd: root, ts: i });
		}
		expect(readCheckpoints(root).length, "fixture sanity: every row must be recorded before pruning").toBe(total);

		const dropped = pruneCheckpoints(root);
		expect(dropped.map((e) => e.label), "the five oldest rows must be the ones evicted, in order").toEqual([
			"turn 0",
			"turn 1",
			"turn 2",
			"turn 3",
			"turn 4",
		]);
		const kept = readCheckpoints(root);
		expect(kept.length, "the store must be trimmed to the bound").toBe(MAX_CHECKPOINT_ENTRIES);
		expect(kept[0]?.label, "the oldest surviving row must be the one after the last evicted").toBe("turn 5");
		expect(kept[kept.length - 1]?.label, "the newest row must never be evicted").toBe(`turn ${total - 1}`);
	});

	it("evicts nothing, and reports nothing, when the store is under the bound", () => {
		// Negative control: a prune that always evicted would satisfy the case
		// above's first assertion by accident.
		const root = scratch();
		recordCheckpoint(root, { sha: "a".repeat(40), label: "only", cwd: root, ts: 1 });
		expect(pruneCheckpoints(root), "an under-bound store must lose nothing").toEqual([]);
		expect(readCheckpoints(root).length).toBe(1);
	});

	it("never throws on an unwritable or absent store -- reports 'evicted nothing'", () => {
		const root = join(tmpdir(), `kypi-cpstore-absent-${Math.random().toString(36).slice(2)}`);
		const start = Date.now();
		expect(pruneCheckpoints(root)).toEqual([]);
		// A lock that can never be created must fail at once, not spin until the 35s wait deadline.
		expect(Date.now() - start).toBeLessThan(2000 * CI_TIME_FACTOR);
		expect(existsSync(root), "prune must not create the directory it was asked about").toBe(false);
	});
});

/** What a WR-09 writer child prints on stdout when it is done. */
interface WriterReport {
	tag: string;
	written: number;
	startedAt: number;
	finishedAt: number;
}

/** A minimal resolvable-from-outside promise, matching `tests/helpers/qoder-loopback.ts`'s own `createDeferred`. */
function createDeferred<T = void>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** One spawned writer child: an event gate proving it is ready, and its eventual report. */
interface WriterHandle {
	/** Resolves once the child has imported `store.ts` and sent `ready` -- rejects if it exits/errors first. */
	ready: Promise<void>;
	/** Resolves with the child's parsed report once it exits 0; rejects on any failure. */
	report: Promise<WriterReport>;
	/** Send the `"go"` message releasing the child's first write. Only meaningful once `ready` has settled. */
	release: () => void;
}

/**
 * Spawns one writer child over IPC. It sends `ready` once its `import()` of store.ts resolves and then waits for
 * `go`; a child that dies first rejects `ready`, so the parent never waits forever.
 */
function spawnWriter(script: string, args: string[]): WriterHandle {
	const readyGate = createDeferred<void>();
	let readySettled = false;

	const child = spawn(process.execPath, [script, ...args], {
		shell: false,
		windowsHide: true,
		timeout: 120_000,
		stdio: ["ignore", "pipe", "pipe", "ipc"] as const,
	});

	let stdout = "";
	let stderr = "";
	// With "ipc" in stdio TypeScript still types stdout/stderr as nullable; with "pipe" they never are.
	if (child.stdout === null || child.stderr === null) {
		throw new Error("spawnWriter: child.stdout/stderr is null despite requesting pipe stdio");
	}
	child.stdout.setEncoding("utf-8");
	child.stderr.setEncoding("utf-8");
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk;
	});

	child.on("message", (msg: unknown) => {
		if (readySettled) return;
		if (typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "ready") {
			readySettled = true;
			readyGate.resolve();
		}
	});

	const report = new Promise<WriterReport>((resolve, reject) => {
		child.on("error", (err) => {
			if (!readySettled) {
				readySettled = true;
				readyGate.reject(new Error(`writer failed to launch before sending ready: ${err.message}`));
			}
			reject(new Error(`writer failed to launch: ${err.message}`));
		});
		child.on("close", (code) => {
			if (!readySettled) {
				readySettled = true;
				readyGate.reject(new Error(`writer exited ${String(code)} before sending ready; stderr: ${stderr}`));
			}
			if (code !== 0) {
				reject(new Error(`writer exited ${String(code)}; stderr: ${stderr}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout) as WriterReport);
			} catch {
				reject(new Error(`writer printed unparseable report ${JSON.stringify(stdout)}`));
			}
		});
	});

	return {
		ready: readyGate.promise,
		report,
		release: () => {
			child.send("go");
		},
	};
}

/**
 * Adjacent tag switches in the store's row order needed to prove interleaving: four serial blocks give exactly 3.
 * Measured floor across ~150 solo runs was 5, so 4 never flakes yet fails the serial case.
 */
const MIN_TAG_SWITCHES = 4;

describe("WR-09 -- concurrent recorders do not lose each other's entries", () => {
	/**
	 * recordCheckpoint is read-modify-write over one shared file, and a subagent's turn can race the main session's.
	 * Children are released together by an IPC event, never a wall-clock barrier or spawnSync (which ran them serially
	 * and passed against an unlocked store), and overlap is read from the store's own row order.
	 */
	it("four overlapping OS processes each recording 150 entries produce all 600 rows", async () => {
		const root = scratch();
		const storeUrl = pathToFileURL(join(repoRoot(), ".pi", "extensions", "checkpoint", "store.ts")).href;
		const script = join(root, "writer.mjs");
		writeFileSync(
			script,
			[
				"// Generated child -- see tests/unit/checkpoint-store.test.ts (WR-09).",
				'import { writeSync } from "node:fs";',
				`const mod = await import(${JSON.stringify(storeUrl)});`,
				"const [root, tag, countRaw] = process.argv.slice(2);",
				"const count = Number(countRaw);",
				'process.send({ type: "ready", tag });',
				'await new Promise((resolve) => { process.once("message", resolve); });',
				"const startedAt = Date.now();",
				"for (let i = 0; i < count; i++) {",
				"\tmod.recordCheckpoint(root, {",
				"\t\tsha: (tag + String(i)).padEnd(40, 'x'),",
				"\t\tlabel: tag + '-' + i,",
				"\t\tcwd: root,",
				"\t\tts: Date.now(),",
				"\t});",
				"}",
				"const finishedAt = Date.now();",
				"writeSync(1, JSON.stringify({ tag, written: count, startedAt, finishedAt }));",
				"process.exitCode = 0;",
				"",
			].join("\n"),
			"utf-8",
		);

		const tags = ["A", "B", "C", "D"];
		const handles = tags.map((tag) => spawnWriter(script, [root, tag, "150"]));
		await Promise.all(handles.map((h) => h.ready));
		for (const handle of handles) {
			handle.release();
		}
		const reports = await Promise.all(handles.map((h) => h.report));

		expect(reports.length, "every writer must have reported").toBe(tags.length);

		const entries = readCheckpoints(root);
		expect(
			entries.length,
			"every one of the 600 entries four overlapping processes recorded must be present. A lost entry " +
				"is a checkpoint the user can never restore, and its loss is silent",
		).toBe(600);
		for (const tag of tags) {
			expect(entries.filter((e) => e.label.startsWith(`${tag}-`)).length, `writer ${tag} lost entries`).toBe(150);
		}

		// Structural interleaving proof (WR-09 task 2): a property the store's
		// OWN row order produced, replacing the deleted `Date.now()` comparison.
		let tagSwitches = 0;
		for (let i = 1; i < entries.length; i++) {
			if (entries[i]?.label.charAt(0) !== entries[i - 1]?.label.charAt(0)) {
				tagSwitches++;
			}
		}
		expect(
			tagSwitches,
			"the four writers' rows must be genuinely INTERLEAVED in the store's own recorded order, not four " +
				`contiguous blocks. Four strictly-serial blocks produce exactly 3 switches; ${String(MIN_TAG_SWITCHES)} ` +
				"is set just above that (see MIN_TAG_SWITCHES's own docstring for the measured solo-run floor of " +
				"5 this is held below) so a serialised run (FALSIFICATION (b)) turns this red while a genuinely " +
				"overlapping run stays green",
		).toBeGreaterThan(MIN_TAG_SWITCHES);
	});
});

describe("WR-14 / WR-16 -- the shipped wiring records the human label and writes an observable headless row", () => {
	it("turn_start stores the timestamp label, not a duplicate of entryId", async () => {
		// `label` must not duplicate `entryId`; a listing should show a timestamp, not an opaque id.
		const repo = mkdtempSync(join(tmpdir(), "kypi-cpwire-"));
		tempDirs.push(repo);
		for (const args of [
			["init", "-b", "work"],
			["config", "user.email", "t@example.com"],
			["config", "user.name", "t"],
		]) {
			const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8", shell: false, windowsHide: true });
			expect(r.status, `git ${args.join(" ")} failed: ${r.stderr}`).toBe(0);
		}
		writeFileSync(join(repo, "a.txt"), "x\n", "utf-8");
		for (const args of [
			["add", "-A"],
			["commit", "-m", "init"],
		]) {
			const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8", shell: false, windowsHide: true });
			expect(r.status, `git ${args.join(" ")} failed: ${r.stderr}`).toBe(0);
		}

		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const mod = (await import("../../.pi/extensions/checkpoint/index.ts")) as { default: (pi: unknown) => void };
		mod.default({
			on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, fn),
			registerCommand: () => undefined,
		});

		const ctx = {
			cwd: repo,
			hasUI: false,
			ui: { notify: () => undefined, select: () => undefined },
			sessionManager: { getLeafEntry: () => undefined },
		};
		await handlers.get("turn_start")?.({}, ctx);

		const entries = readCheckpoints(repo);
		expect(entries.length, "the shipped turn_start handler must record exactly one checkpoint").toBe(1);
		expect(
			entries[0]?.label,
			"WR-14: the label must be the human-readable one the commit message carries, not the entry id " +
				"(which is already stored verbatim in entryId on the same row)",
		).toMatch(/^turn \d{4}-\d{2}-\d{2}T/);

		// WR-16: the headless fork branch must write something a FILE can hold.
		await handlers.get("session_before_fork")?.({ entryId: entries[0]?.entryId }, ctx);
		const logDir = join(repo, ".pi", "logs");
		const written = existsSync(logDir)
			? readFileSync(
					join(
						logDir,
						// exactly one audit file, whatever today's date is
						readdirSync(logDir).find((f) => f.startsWith("audit-")) ?? "missing",
					),
					"utf-8",
				)
			: "";
		expect(
			written,
			"WR-16: ctx.ui.notify with no UI is Pi's noOpUIContext.notify -- literally `notify: () => { }` " +
				"at dist/core/extensions/runner.js:92. It emits nothing, so the headless branch was " +
				"behaviourally identical to the upstream `return` it was presented as fixing. The observable " +
				"channel must be a file",
		).toContain("checkpoint_available_at_fork");
		expect(written, "the row must name the command that reaches the checkpoint").toContain("/checkpoint-restore");
	});
});
