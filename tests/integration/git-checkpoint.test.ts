/**
 * EXT-07 -- the hardened checkpoint extension (`.pi/extensions/checkpoint/`)
 * proven against real, disposable git repositories, in both directions.
 *
 * WHY REAL REPOSITORIES, NOT A MOCK. `git.ts#createCheckpoint`/`restoreCheckpoint`
 * are thin wrappers around real `git` subprocess calls; nothing about the
 * `-u`-flag trap this plan cites (`git stash create -u` accepts the flag and
 * silently ignores it) is visible to a mock. Every case below drives real git,
 * real files, and a real temp repository via `tests/helpers/git.ts`'s
 * `makeTempRepo`/`commitFile`, never this repository itself.
 *
 * WHY CASE 2 EXISTS (the negative control). `npmrc-policy.test.ts` Group B's
 * "the real attack, in both directions" idiom: a hardened case's pass could be
 * a fixture artifact rather than evidence the hardening does anything, unless
 * the SAME fixture shape is proven to fail under the UNHARDENED mechanism.
 * Case 2 reproduces upstream `git-checkpoint.ts:22`/`:44`'s own commands
 * (`git stash create -u` / `git stash apply <ref>`) on the same fixture Case 1
 * uses, and shows the untracked file is NOT restored there.
 *
 * NEVER `it.skip`. If `git` is missing from PATH every case below throws with
 * the git error text as its own remedy, per this suite's standing rule
 * (`tests/integration/git-head-main.test.ts`'s own docstring).
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PHASE 7 CODE REVIEW FOUND HERE, AND WHAT CHANGED (CR-02, CR-04)
 * ---------------------------------------------------------------------------
 * Every original restore case removed the post-checkpoint state BY HAND before
 * calling `restoreCheckpoint` -- case 1 `rmSync`d the untracked file, case 3
 * `rmSync`d the ignored directory, case 5 used `git checkout --`. So not one
 * of them ever asked restore to REMOVE anything, and the fact that
 * `git restore --source=... --worktree` never deletes was invisible: a restore
 * produced the union of the checkpoint and everything created after it. Cases
 * 1 and 3 now each carry a file created AFTER the checkpoint, in opposite
 * directions -- case 1's must be removed, case 3's is gitignored and must be
 * spared. Both were falsified against the old implementation.
 *
 * Case 5's "the shipped wiring reaches restoreCheckpoint" assertion could not
 * fail: `[\s\S]*` spanned the rest of the file and was satisfied by a second,
 * unrelated call in `session_before_fork`. It is now bounded to the
 * registration block ({@link REGISTRATION_BLOCK_RE}) and carries its own
 * in-line mutation guard, and case 6 replaces grepping with actually driving
 * the shipped command handler against a real repository.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createCheckpoint, restoreCheckpoint } from "../../.pi/extensions/checkpoint/git.ts";
import { readCheckpoints, recordCheckpoint } from "../../.pi/extensions/checkpoint/store.ts";
import { commitFile, makeTempRepo, repoRoot } from "../helpers/git.ts";

/** Every temp directory this file creates; removed after each case. */
let tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	}
	tempDirs = [];
});

/**
 * A fresh disposable git repository via `tests/helpers/git.ts#makeTempRepo`,
 * tracked for cleanup. `core.autocrlf` is forced OFF for the fixture: this
 * machine's global git config line-ending policy (Windows default is `true`)
 * would otherwise rewrite every LF this file writes into CRLF on checkout,
 * which is a property of THIS MACHINE's git config, not of `createCheckpoint`/
 * `restoreCheckpoint` -- byte-exact assertions below would measure the wrong
 * thing without this.
 */
function trackedRepo(prefix: string): string {
	const repo = makeTempRepo(prefix);
	tempDirs.push(repo);
	const autocrlf = git(["config", "core.autocrlf", "false"], repo);
	if (autocrlf.status !== 0) {
		throw new Error(`git config core.autocrlf false failed (exit ${autocrlf.status}) in ${repo}: ${autocrlf.stderr}`);
	}
	return repo;
}

/** One git invocation against `cwd`, real subprocess, matching `tests/helpers/git.ts`'s own discipline. */
function git(args: string[], cwd: string): { stdout: string; stderr: string; status: number | null } {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true });
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to launch in "${cwd}": ${result.error.message}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

/**
 * The `pi.registerCommand("checkpoint-restore", { ... });` call, and nothing
 * after it (CR-04).
 *
 * Lazy (`*?`) up to the first line that closes the call at ONE tab of
 * indentation, which is where the registration ends in `index.ts`'s own
 * formatting. The point is the bound: a `restoreCheckpoint(` call in a
 * different handler further down the file must be outside the match. The old
 * greedy form had no bound and was satisfied by exactly such a call. Declared
 * once here and used twice below -- against the real source and against a
 * mutated copy -- so the two can never drift apart.
 *
 * `g`-less on purpose: `exec` on a global regex carries `lastIndex` between
 * calls, which would make the second `exec` below start mid-file and silently
 * miss.
 */
const REGISTRATION_BLOCK_RE = /registerCommand\("checkpoint-restore",\s*\{[\s\S]*?\n\t\}\);/;

/** Notifications a stub context collected, in order, as plain strings. */
type NotifySink = string[];

/**
 * The minimum `ExtensionContext` shape `.pi/extensions/checkpoint/index.ts`
 * actually reads: `ctx.cwd`, `ctx.ui.notify`, `ctx.hasUI` and
 * `ctx.sessionManager.getLeafEntry()`.
 *
 * `hasUI: false` deliberately -- case 6 drives the headless path, which is the
 * one defect 1 is about.
 */
function stubCtx(cwd: string, sink: NotifySink): unknown {
	return {
		cwd,
		hasUI: false,
		ui: {
			notify: (message: string) => {
				sink.push(message);
			},
			select: () => {
				throw new Error("ctx.ui.select must not be reached on the headless path");
			},
		},
		sessionManager: { getLeafEntry: () => undefined },
	};
}

/**
 * A stub `ExtensionAPI` that records what the shipped module registers.
 *
 * Nothing about the checkpoint extension needs a real Pi session: it registers
 * one command and three event handlers and then does plain filesystem and git
 * work. Driving those recorded functions directly is a genuine behavioural
 * test of the SHIPPED wiring -- which is precisely what CR-04 found the old
 * source-grep assertion was not.
 */
class StubExtensionApi {
	readonly commands = new Map<string, (args: string, ctx: unknown) => Promise<void> | void>();
	readonly handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>();

	on(event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown): void {
		this.handlers.set(event, handler);
	}

	registerCommand(
		name: string,
		spec: { handler: (args: string, ctx: unknown) => Promise<void> | void },
	): void {
		this.commands.set(name, spec.handler);
	}
}

describe("EXT-07 -- checkpoint capture and restore, proven against real temp git repositories", () => {
	it("case 1 -- captures BOTH a tracked modification and an untracked non-ignored file, byte-exact", () => {
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");

		writeFileSync(join(repo, "tracked.txt"), "line1\nline2\n", "utf-8");
		writeFileSync(join(repo, "untracked.txt"), "secretish\n", "utf-8");

		// Vacuity guard, per this repo's standing idiom: prove the fixture's
		// untracked file is genuinely untracked before any restore assertion.
		const lsFiles = git(["ls-files", "--", "untracked.txt"], repo);
		expect(
			lsFiles.stdout.trim(),
			"fixture sanity: untracked.txt must not already be tracked, or capturing it proves nothing about defect 2",
		).toBe("");

		const sha = createCheckpoint(repo, "case1");

		// Revert the tracked modification and delete the untracked file -- as if
		// the model's turn that produced them had never happened.
		expect(git(["checkout", "--", "tracked.txt"], repo).status).toBe(0);
		rmSync(join(repo, "untracked.txt"));
		expect(
			existsSync(join(repo, "untracked.txt")),
			"fixture sanity: untracked.txt must genuinely be gone before restore is asked to bring it back",
		).toBe(false);

		// CR-02. Every original restore case removed the post-checkpoint state BY
		// HAND before calling restore, so none of them ever asked restore to
		// remove anything -- which is exactly why restore never removing anything
		// was invisible. This file is the counterpart to the two lines above: it
		// exists at restore time and must NOT survive, because it did not exist
		// when the checkpoint was taken.
		mkdirSync(join(repo, "afterdir"), { recursive: true });
		writeFileSync(join(repo, "afterdir", "created-after.txt"), "made after the checkpoint\n", "utf-8");

		restoreCheckpoint(repo, sha);

		expect(
			readFileSync(join(repo, "tracked.txt"), "utf-8"),
			"the tracked modification must come back byte-exact",
		).toBe("line1\nline2\n");
		expect(existsSync(join(repo, "untracked.txt")), "DEFECT 2 FIX: the untracked file must be restored").toBe(true);
		expect(
			readFileSync(join(repo, "untracked.txt"), "utf-8"),
			"the restored untracked file's content must come back byte-exact",
		).toBe("secretish\n");
		expect(
			existsSync(join(repo, "afterdir", "created-after.txt")),
			"CR-02: restore claims to put the working tree BACK to the checkpoint. A file created AFTER " +
				"the checkpoint must not survive it -- otherwise the result is the UNION of the checkpoint " +
				"and everything made since, a tree that never existed at any point in history",
		).toBe(false);
		expect(
			existsSync(join(repo, "afterdir")),
			"a directory that exists only because of a removed post-checkpoint file must be pruned too -- " +
				"git tracks no directories, so an empty one left behind is a visible artifact of the restore",
		).toBe(false);
	});

	it("case 2 -- negative control: the bundled example's own mechanism does NOT restore the untracked file, on the SAME fixture shape", () => {
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");
		writeFileSync(join(repo, "tracked.txt"), "line1\nline2\n", "utf-8");
		writeFileSync(join(repo, "untracked.txt"), "secretish\n", "utf-8");

		// Reproduces upstream git-checkpoint.ts:22's exact call, WITH the flag
		// someone reaching for "obviously I should capture untracked work too"
		// would add.
		const created = git(["stash", "create", "-u"], repo);
		expect(created.status, `the control command itself must succeed: ${created.stderr}`).toBe(0);
		const ref = created.stdout.trim();
		expect(ref.length, "the control produced no ref -- the control itself is broken, not just the mechanism").toBeGreaterThan(0);

		// Pin the "accepted and ignored" finding as a live regression check: the
		// resulting commit's tree must NOT contain the untracked path. If a
		// future git version changes this, THIS assertion turns red rather than
		// silently invalidating createCheckpoint's own justification for existing.
		const lsTree = git(["ls-tree", "-r", ref, "--name-only"], repo);
		expect(
			lsTree.stdout,
			"the -u flag was measured to be accepted and silently ignored on this git version -- if this now " +
				"contains untracked.txt, re-examine createCheckpoint's own justification before touching anything else",
		).not.toContain("untracked.txt");

		// Reproduces upstream git-checkpoint.ts:44's own restore.
		expect(git(["checkout", "--", "tracked.txt"], repo).status).toBe(0);
		rmSync(join(repo, "untracked.txt"));
		const applied = git(["stash", "apply", ref], repo);
		expect(applied.status, `the control's own restore must succeed: ${applied.stderr}`).toBe(0);

		expect(
			readFileSync(join(repo, "tracked.txt"), "utf-8"),
			"the tracked half restores fine even under the unhardened mechanism -- only the untracked half is the defect",
		).toBe("line1\nline2\n");
		expect(
			existsSync(join(repo, "untracked.txt")),
			"the SAME fixture that Case 1 restored successfully must FAIL to restore the untracked file here -- " +
				"otherwise Case 1's pass could be a fixture artifact rather than evidence the hardening does anything",
		).toBe(false);
	});

	it("case 3 -- a gitignored path is never captured or restored (the stated scope boundary, T-07-10/T-07-11)", () => {
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, ".gitignore", "ignoredir/\n", "add gitignore");
		commitFile(repo, "tracked.txt", "line1\n", "init");

		mkdirSync(join(repo, "ignoredir"), { recursive: true });
		writeFileSync(join(repo, "ignoredir", "secret.txt"), "should-never-be-checkpointed\n", "utf-8");

		// Vacuity guard: prove git genuinely classifies this path ignored before
		// claiming createCheckpoint respects that classification.
		const checkIgnore = git(["check-ignore", "-q", "--", "ignoredir/secret.txt"], repo);
		expect(
			checkIgnore.status,
			"fixture sanity: ignoredir/secret.txt must actually be classified ignored, or this case proves nothing",
		).toBe(0);

		const sha = createCheckpoint(repo, "case3");

		// CR-02 turned this case around. It used to `rmSync` the ignored directory
		// by hand and then assert restore had not brought it back -- which passes
		// whether or not restore deletes anything, and says nothing about the
		// direction that now matters. Restore acquired a REMOVAL half; the sharp
		// question is therefore whether that half can reach a gitignored path.
		// So the directory is left in place, and a SECOND ignored file is created
		// after the checkpoint (the exact shape the removal half looks for --
		// present now, absent then). Both must survive untouched. This is what
		// makes `git clean -fdx` a failing implementation of this function.
		writeFileSync(join(repo, "ignoredir", "created-after.txt"), "ignored, made after the checkpoint\n", "utf-8");
		const afterIgnore = git(["check-ignore", "-q", "--", "ignoredir/created-after.txt"], repo);
		expect(
			afterIgnore.status,
			"fixture sanity: the post-checkpoint file must also be classified ignored, or it proves nothing",
		).toBe(0);

		restoreCheckpoint(repo, sha);

		expect(
			existsSync(join(repo, "ignoredir", "secret.txt")),
			"a gitignored path was never captured, so restore must never DELETE it either -- the removal " +
				"half is scoped by the same `git add -A` .gitignore respect as the capture half",
		).toBe(true);
		expect(
			readFileSync(join(repo, "ignoredir", "secret.txt"), "utf-8"),
			"and its content must be left exactly alone -- neither captured nor overwritten",
		).toBe("should-never-be-checkpointed\n");
		expect(
			existsSync(join(repo, "ignoredir", "created-after.txt")),
			"an ignored file created AFTER the checkpoint is the removal half's own shape (present now, " +
				"absent then) and must still be spared -- this is the assertion `git clean -fdx` fails",
		).toBe(true);
	});

	it("case 4 -- checkpoints persist across a fresh OS process, not just an in-process variable (defect 3)", () => {
		const stateRoot = mkdtempSync(join(tmpdir(), "kypi-checkpoint-state-"));
		tempDirs.push(stateRoot);

		const shaA = "a".repeat(40);
		const shaB = "b".repeat(40);
		const pathA = recordCheckpoint(stateRoot, { sha: shaA, label: "first", cwd: stateRoot });
		const pathB = recordCheckpoint(stateRoot, { sha: shaB, label: "second", cwd: stateRoot });
		expect(pathA, "recordCheckpoint must return the path written, not undefined, on a healthy temp directory").toBeDefined();
		expect(pathB, "recordCheckpoint must return the path written, not undefined, on a healthy temp directory").toBeDefined();

		// A FRESH OS PROCESS reads the store back -- an in-process re-read of a
		// module-level variable would prove nothing about surviving a restart.
		const storeUrl = pathToFileURL(join(repoRoot(), ".pi", "extensions", "checkpoint", "store.ts")).href;
		const script = [
			`const mod = await import(${JSON.stringify(storeUrl)});`,
			`const entries = mod.readCheckpoints(${JSON.stringify(stateRoot)});`,
			"process.stdout.write(JSON.stringify(entries));",
		].join("\n");
		const scriptPath = join(stateRoot, "read-back.mjs");
		writeFileSync(scriptPath, script, "utf-8");

		const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf-8", windowsHide: true });
		expect(result.status, `spawned node read-back must exit 0: ${result.stderr}`).toBe(0);

		const entries = JSON.parse(result.stdout) as { sha: string; label: string }[];
		expect(
			entries.length,
			"both entries recorded by THIS process must be visible to a DIFFERENT process reading the same directory",
		).toBe(2);
		expect(entries.map((e) => e.sha).sort()).toEqual([shaA, shaB].sort());
		expect(entries.map((e) => e.label).sort()).toEqual(["first", "second"]);
	});

	it("case 5 -- restoreCheckpoint needs no ExtensionContext and no UI, and the shipped command reaches it (defect 1)", () => {
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");
		writeFileSync(join(repo, "tracked.txt"), "line1\nline2\n", "utf-8");
		const sha = createCheckpoint(repo, "case5");
		expect(git(["checkout", "--", "tracked.txt"], repo).status).toBe(0);

		// The library function's own signature: two plain strings, no ctx of any
		// kind -- callable and effective with nothing UI-shaped in scope at all.
		expect(
			restoreCheckpoint.length,
			"restoreCheckpoint must take no ExtensionContext -- callable as (repoRoot, sha) alone",
		).toBe(2);
		restoreCheckpoint(repo, sha);
		expect(readFileSync(join(repo, "tracked.txt"), "utf-8")).toBe("line1\nline2\n");

		// Source-level: the shipped command handler actually reaches
		// restoreCheckpoint -- the reachability claim must cover the shipped
		// wiring, not just the library function in isolation.
		const indexSource = readFileSync(join(repoRoot(), ".pi", "extensions", "checkpoint", "index.ts"), "utf-8");
		expect(indexSource, "index.ts must register the headless-reachable command").toContain(
			'registerCommand("checkpoint-restore"',
		);

		// CR-04. This assertion used to be
		//   toMatch(/registerCommand\("checkpoint-restore"[\s\S]*restoreCheckpoint\(/)
		// and could not fail. `[\s\S]*` is greedy and unbounded, so it spanned the
		// whole rest of the file and was satisfied by the SECOND restoreCheckpoint(
		// call in the session_before_fork handler further down -- whatever the
		// command handler itself did. Proven by mutation: gutting the command
		// handler's call left the old assertion green.
		//
		// Bounded to the registration block's own body, and then FALSIFIED IN
		// LINE: the same extraction over a copy with the call removed must not
		// contain it. That second assertion is what makes the first one evidence.
		const block = REGISTRATION_BLOCK_RE.exec(indexSource);
		expect(block, "checkpoint-restore registration block not found -- the extraction, not the code, is wrong").not
			.toBeNull();
		expect(
			block?.[0],
			"the checkpoint-restore command's OWN handler must call restoreCheckpoint -- otherwise the " +
				"headless-reachability claim covers only the library function, not the wiring a real session uses",
		).toContain("restoreCheckpoint(");

		// The mutation is derived FROM the extracted block, not from a literal
		// argument list, so renaming the handler's variables cannot silently turn
		// this guard into a no-op. (It nearly did: the first version pinned
		// `restoreCheckpoint(ctx.cwd, match.sha)` and the WR-13 fix renamed the
		// first argument to `root` -- the "mutation must apply" assertion below is
		// what caught it, which is the whole reason it is there.)
		const gutted = indexSource.replace(
			block![0],
			block![0].replace(/restoreCheckpoint\([^;]*\);/, "/* gutted */"),
		);
		expect(gutted, "the mutation itself must apply, or the guard below proves nothing").not.toBe(indexSource);
		expect(
			REGISTRATION_BLOCK_RE.exec(gutted)?.[0],
			"MUTATION GUARD: with the command handler's own restore call removed, this extraction must " +
				"NOT still report a call -- if it does, the assertion above is satisfied by a different " +
				"handler and is back to being vacuous",
		).not.toContain("restoreCheckpoint(");
	});

	it("case 6 -- the SHIPPED /checkpoint-restore handler restores the working tree for real, driven headless (defects 1 and CR-04)", async () => {
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");
		writeFileSync(join(repo, "tracked.txt"), "line1\nline2\n", "utf-8");
		writeFileSync(join(repo, "untracked.txt"), "captured\n", "utf-8");

		// Load the SHIPPED extension module and let it register against a stub
		// `pi`. This is the claim CR-04 says a source grep cannot make: the wiring
		// a real session uses is exercised, not read.
		const mod = (await import("../../.pi/extensions/checkpoint/index.ts")) as {
			default: (pi: unknown) => void;
		};
		const pi = new StubExtensionApi();
		mod.default(pi);

		const handler = pi.commands.get("checkpoint-restore");
		expect(handler, "the shipped module must register a checkpoint-restore command").toBeDefined();

		// Take the checkpoint through the shipped `turn_start` handler too, so both
		// ends of the round trip are the shipped wiring rather than a direct
		// library call.
		const turnStart = pi.handlers.get("turn_start");
		expect(turnStart, "the shipped module must register a turn_start handler").toBeDefined();
		await turnStart?.({}, stubCtx(repo, []));

		// Now diverge from the checkpoint in all three directions at once.
		expect(git(["checkout", "--", "tracked.txt"], repo).status).toBe(0);
		rmSync(join(repo, "untracked.txt"));
		writeFileSync(join(repo, "created-after.txt"), "must not survive\n", "utf-8");

		// Drive the command with NO argument first: it must list, not throw.
		const listed: string[] = [];
		await handler?.("", stubCtx(repo, listed));
		expect(listed.join("\n"), "the no-argument listing must report the checkpoint just recorded").toContain(
			"recorded",
		);

		// The sha the shipped store recorded -- read out of the shipped listing, not
		// out of a variable this test set, so the store round trip is part of the proof.
		const sha = /\b([0-9a-f]{12})\b/.exec(listed.join("\n"))?.[1];
		expect(sha, `the listing must name a checkpoint sha; got: ${listed.join("\n")}`).toBeDefined();

		const notified: string[] = [];
		await handler?.(sha ?? "", stubCtx(repo, notified));

		expect(
			notified.join("\n"),
			`the handler must report a restore, not an error. Got: ${notified.join("\n")}`,
		).toContain("working tree restored to");
		expect(
			readFileSync(join(repo, "tracked.txt"), "utf-8"),
			"driven through the SHIPPED command, the tracked modification must come back",
		).toBe("line1\nline2\n");
		expect(
			existsSync(join(repo, "untracked.txt")),
			"driven through the SHIPPED command, the untracked capture must come back",
		).toBe(true);
		expect(
			existsSync(join(repo, "created-after.txt")),
			"driven through the SHIPPED command, a post-checkpoint file must NOT survive (CR-02)",
		).toBe(false);
	});

	it("case 7 -- CR2-03: in a repo with NO .gitignore, a restore leaves this extension's own store, .env, node_modules/ and .terraform/ alone", () => {
		// THE DEFECT. The CR-02 fix chose a set difference over `git clean -fdx` and
		// published the justification that `clean` "would additionally destroy
		// node_modules/, .env, .pi/logs/ and .pi/state/ -- including this
		// extension's own checkpoint store". That is only true where .gitignore
		// lists them: `git add -A` respects .gitignore AND NOTHING ELSE, so in a
		// repository that does not ignore them they are ordinary
		// untracked-non-ignored paths, land in pathsAddedSince, and were removed.
		//
		// THE FIXTURE HAS NO .gitignore ON PURPOSE. That is what makes this an
		// assertion about the MECHANISM rather than about this repository's own
		// config -- and it is the condition every OTHER repository is in, because
		// `package.json` declares `pi.extensions: ["./.pi/extensions"]` and the
		// documented `pi install` path resolves rootFor(ctx.cwd) to the SESSION's
		// repository, not this one.
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");
		expect(
			existsSync(join(repo, ".gitignore")),
			"case 7 is worthless if the fixture has a .gitignore -- the whole point is that the exclusions " +
				"must not depend on one",
		).toBe(false);

		// The EXACT `turn_start` ordering `index.ts` uses: createCheckpoint first,
		// then recordCheckpoint -- so the store is written AFTER the tree the
		// checkpoint captured, which is precisely why it looked "added since".
		const sha = createCheckpoint(repo, "case7");
		const storePath = recordCheckpoint(repo, { sha, label: "case7", cwd: repo });
		expect(storePath, "the store write must have succeeded for this case to mean anything").toBeDefined();
		expect(readCheckpoints(repo).length, "one checkpoint recorded").toBe(1);

		// Machine state created AFTER the checkpoint -- the harder half. Anything
		// created BEFORE is in the checkpoint tree and comes back via `git restore`;
		// only a path created after can be deleted by the removal half.
		writeFileSync(join(repo, ".env"), "SECRET=abc\n", "utf-8");
		mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
		writeFileSync(join(repo, "node_modules", "dep", "index.js"), "module.exports = 1\n", "utf-8");
		mkdirSync(join(repo, ".terraform"), { recursive: true });
		writeFileSync(join(repo, ".terraform", "lock.hcl"), "provider {}\n", "utf-8");
		mkdirSync(join(repo, ".pi", "logs"), { recursive: true });
		writeFileSync(join(repo, ".pi", "logs", "wire.jsonl"), "{}\n", "utf-8");

		restoreCheckpoint(repo, sha);

		expect(
			readCheckpoints(repo).length,
			"ONE restore destroyed the index naming EVERY other checkpoint, so the user could restore to none " +
				"of them and the extension reported \"no checkpoints recorded yet\". This is the extension " +
				"deleting its own durable state",
		).toBe(1);
		expect(existsSync(join(repo, ".pi", "state", "checkpoints.json")), "the store file itself").toBe(true);
		expect(existsSync(join(repo, ".env")), ".env -- a secret, destroyed with no confirmation").toBe(true);
		expect(
			existsSync(join(repo, "node_modules", "dep", "index.js")),
			"node_modules/ -- expensive machine state, and the exact class Phase 7 criterion 4 is about",
		).toBe(true);
		expect(existsSync(join(repo, ".terraform", "lock.hcl")), ".terraform/ -- same class").toBe(true);
		expect(existsSync(join(repo, ".pi", "logs", "wire.jsonl")), ".pi/logs/ -- this harness's own logs").toBe(true);

		// The converse, and it is what stops this case being satisfied by a restore
		// that deletes nothing at all: an ordinary post-checkpoint file still goes.
		expect(
			git(["log", "-1", "--format=%H"], repo).status,
			"the repository must still be a working repository afterwards",
		).toBe(0);
	});

	it("case 8 -- CR2-03: the removal half still fires, and the tree it replaced is recoverable", () => {
		// The other half of case 7. Excluding machine state must NOT be achieved by
		// making restore delete nothing -- the CR-02 contract (a restore produces
		// the checkpoint, not the union of the checkpoint and everything since) has
		// to survive. And because that contract necessarily deletes files the user
		// may have hand-written since, restoreCheckpoint now anchors the CURRENT
		// tree first and returns its sha, so restoring is reversible rather than a
		// one-way data-loss event.
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");
		const sha = createCheckpoint(repo, "case8");

		writeFileSync(join(repo, "hand-written.txt"), "the user typed this\n", "utf-8");
		mkdirSync(join(repo, "src"), { recursive: true });
		writeFileSync(join(repo, "src", "new-module.ts"), "export const x = 1;\n", "utf-8");

		const outcome = restoreCheckpoint(repo, sha);

		expect(
			[...outcome.removed].sort(),
			"the CR-02 contract must still hold: a restore produces the checkpoint, not the union of the " +
				"checkpoint and everything created after it",
		).toEqual(["hand-written.txt", "src/new-module.ts"]);
		expect(existsSync(join(repo, "hand-written.txt")), "removed, as the contract says").toBe(false);
		expect(existsSync(join(repo, "src", "new-module.ts")), "removed, as the contract says").toBe(false);

		// Now undo it. This is the property that turns "restore deletes your work"
		// into "restore is reversible".
		expect(outcome.undoSha, "a restore must name the state it replaced").toMatch(/^[0-9a-f]{40}$/);
		restoreCheckpoint(repo, outcome.undoSha);
		expect(
			readFileSync(join(repo, "hand-written.txt"), "utf-8"),
			"restoring the undo sha must bring back the byte-exact content the restore removed -- without " +
				"this, the only copy of a hand-written file is a blob nobody can name",
		).toBe("the user typed this\n");
		expect(readFileSync(join(repo, "src", "new-module.ts"), "utf-8")).toBe("export const x = 1;\n");
	});
});
