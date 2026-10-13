/**
 * The checkpoint extension against real disposable git repositories, never a mock: `git stash create -u` silently
 * ignoring `-u` is invisible to one. Case 2 is the negative control running upstream's own stash commands on the same
 * fixture. Restore cases each leave a post-checkpoint file, since a restore that never deletes passes otherwise.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createCheckpoint, restoreCheckpoint } from "../../.pi/extensions/checkpoint/git.ts";
import { readCheckpoints, recordCheckpoint } from "../../.pi/extensions/checkpoint/store.ts";
import { commitFile, gitResult, makeTempRepo, repoRoot } from "../helpers/git.ts";

/** Every temp directory this file creates; removed after each case. */
let tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	}
	tempDirs = [];
});

/** A disposable repo with `core.autocrlf` off, so byte-exact assertions measure the code, not this machine's config. */
function trackedRepo(prefix: string): string {
	const repo = makeTempRepo(prefix);
	tempDirs.push(repo);
	const autocrlf = gitResult(["config", "core.autocrlf", "false"], repo);
	if (autocrlf.status !== 0) {
		throw new Error(`git config core.autocrlf false failed (exit ${autocrlf.status}) in ${repo}: ${autocrlf.stderr}`);
	}
	return repo;
}

/**
 * The `checkpoint-restore` registration call only, lazily bounded at its one-tab close, so a `restoreCheckpoint(` in
 * another handler is outside the match. Not `g`: a global regex carries `lastIndex` between the two `exec`s.
 */
const REGISTRATION_BLOCK_RE = /registerCommand\("checkpoint-restore",\s*\{[\s\S]*?\n\t\}\);/;

/** Notifications a stub context collected, in order, as plain strings. */
type NotifySink = string[];

/** The minimal context the checkpoint extension reads; `hasUI: false` drives the headless path. */
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

/** A stub `ExtensionAPI` recording what the shipped module registers, so its handlers can be driven directly. */
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

		// Vacuity guard: the fixture's untracked file is genuinely untracked.
		const lsFiles = gitResult(["ls-files", "--", "untracked.txt"], repo);
		expect(
			lsFiles.stdout.trim(),
			"fixture sanity: untracked.txt must not already be tracked, or capturing it proves nothing about defect 2",
		).toBe("");

		const sha = createCheckpoint(repo, "case1");

		// Revert the tracked modification and delete the untracked file -- as if
		// the model's turn that produced them had never happened.
		expect(gitResult(["checkout", "--", "tracked.txt"], repo).status).toBe(0);
		rmSync(join(repo, "untracked.txt"));
		expect(
			existsSync(join(repo, "untracked.txt")),
			"fixture sanity: untracked.txt must genuinely be gone before restore is asked to bring it back",
		).toBe(false);

		// Exists at restore time but not at checkpoint time, so restore must remove it.
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

		// Upstream git-checkpoint.ts:22's call, with the `-u` someone would add to capture untracked work.
		const created = gitResult(["stash", "create", "-u"], repo);
		expect(created.status, `the control command itself must succeed: ${created.stderr}`).toBe(0);
		const ref = created.stdout.trim();
		expect(ref.length, "the control produced no ref -- the control itself is broken, not just the mechanism").toBeGreaterThan(0);

		// Pins "accepted and ignored": if a git version changes this, createCheckpoint's reason to exist must be revisited.
		const lsTree = gitResult(["ls-tree", "-r", ref, "--name-only"], repo);
		expect(
			lsTree.stdout,
			"the -u flag was measured to be accepted and silently ignored on this git version -- if this now " +
				"contains untracked.txt, re-examine createCheckpoint's own justification before touching anything else",
		).not.toContain("untracked.txt");

		// Reproduces upstream git-checkpoint.ts:44's own restore.
		expect(gitResult(["checkout", "--", "tracked.txt"], repo).status).toBe(0);
		rmSync(join(repo, "untracked.txt"));
		const applied = gitResult(["stash", "apply", ref], repo);
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
		const checkIgnore = gitResult(["check-ignore", "-q", "--", "ignoredir/secret.txt"], repo);
		expect(
			checkIgnore.status,
			"fixture sanity: ignoredir/secret.txt must actually be classified ignored, or this case proves nothing",
		).toBe(0);

		const sha = createCheckpoint(repo, "case3");

		// A second ignored file created after the checkpoint is exactly what the removal half looks for; both must survive.
		// This is what makes `git clean -fdx` a failing implementation.
		writeFileSync(join(repo, "ignoredir", "created-after.txt"), "ignored, made after the checkpoint\n", "utf-8");
		const afterIgnore = gitResult(["check-ignore", "-q", "--", "ignoredir/created-after.txt"], repo);
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

		// A fresh process reads the store back; an in-process re-read proves nothing about a restart.
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
		expect(gitResult(["checkout", "--", "tracked.txt"], repo).status).toBe(0);

		expect(
			restoreCheckpoint.length,
			"restoreCheckpoint must take no ExtensionContext -- callable as (repoRoot, sha) alone",
		).toBe(2);
		restoreCheckpoint(repo, sha);
		expect(readFileSync(join(repo, "tracked.txt"), "utf-8")).toBe("line1\nline2\n");

		const indexSource = readFileSync(join(repoRoot(), ".pi", "extensions", "checkpoint", "index.ts"), "utf-8");
		expect(indexSource, "index.ts must register the headless-reachable command").toContain(
			'registerCommand("checkpoint-restore"',
		);

		// Bounded to the registration block, then falsified in line: the same extraction over a copy with the call removed
		// must not contain it. An unbounded `[\s\S]*` was satisfied by a different handler's call.
		const block = REGISTRATION_BLOCK_RE.exec(indexSource);
		expect(block, "checkpoint-restore registration block not found -- the extraction, not the code, is wrong").not
			.toBeNull();
		expect(
			block?.[0],
			"the checkpoint-restore command's OWN handler must call restoreCheckpoint -- otherwise the " +
				"headless-reachability claim covers only the library function, not the wiring a real session uses",
		).toContain("restoreCheckpoint(");

		// The mutation is derived from the extracted block, so renaming the handler's arguments cannot make it a no-op.
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

		// Load the shipped module against a stub `pi`, so the wiring is exercised, not read.
		const mod = (await import("../../.pi/extensions/checkpoint/index.ts")) as {
			default: (pi: unknown) => void;
		};
		const pi = new StubExtensionApi();
		mod.default(pi);

		const handler = pi.commands.get("checkpoint-restore");
		expect(handler, "the shipped module must register a checkpoint-restore command").toBeDefined();

		// Checkpoint through the shipped `turn_start` handler too, so both ends of the round trip are shipped wiring.
		const turnStart = pi.handlers.get("turn_start");
		expect(turnStart, "the shipped module must register a turn_start handler").toBeDefined();
		await turnStart?.({}, stubCtx(repo, []));

		// Now diverge from the checkpoint in all three directions at once.
		expect(gitResult(["checkout", "--", "tracked.txt"], repo).status).toBe(0);
		rmSync(join(repo, "untracked.txt"));
		writeFileSync(join(repo, "created-after.txt"), "must not survive\n", "utf-8");

		// Drive the command with NO argument first: it must list, not throw.
		const listed: string[] = [];
		await handler?.("", stubCtx(repo, listed));
		expect(listed.join("\n"), "the no-argument listing must report the checkpoint just recorded").toContain(
			"recorded",
		);

		// The sha comes from the shipped listing, so the store round trip is part of the proof.
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
		// `git add -A` respects .gitignore and nothing else, so machine state must be excluded explicitly. The fixture has no
		// .gitignore on purpose: that is the state of every other repository a session may run in.
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");
		expect(
			existsSync(join(repo, ".gitignore")),
			"case 7 is worthless if the fixture has a .gitignore -- the whole point is that the exclusions " +
				"must not depend on one",
		).toBe(false);

		// index.ts's own `turn_start` order: the store is written after the captured tree, so it looks "added since".
		const sha = createCheckpoint(repo, "case7");
		const storePath = recordCheckpoint(repo, { sha, label: "case7", cwd: repo });
		expect(storePath, "the store write must have succeeded for this case to mean anything").toBeDefined();
		expect(readCheckpoints(repo).length, "one checkpoint recorded").toBe(1);

		// Created after the checkpoint: only such a path can be deleted by the removal half.
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

		// The converse: an ordinary post-checkpoint file still goes, so a delete-nothing restore fails.
		expect(
			gitResult(["log", "-1", "--format=%H"], repo).status,
			"the repository must still be a working repository afterwards",
		).toBe(0);
	});

	it("case 9 -- WR2-05: a secret-name exclusion holds at ANY depth, not only at the repository root", () => {
		// A pathspec without a wildcard is a literal path, so `credentials` alone missed `sub/.aws/credentials`; git's `*`
		// crosses `/`. Asserted on the checkpoint tree, which is what persists in `.git/objects`.
		const repo = trackedRepo("kypi-checkpoint-");
		commitFile(repo, "tracked.txt", "line1\n", "init");
		mkdirSync(join(repo, "sub", ".aws"), { recursive: true });
		writeFileSync(join(repo, "sub", ".aws", "credentials"), "aws_secret_access_key = REDACTED\n", "utf-8");
		mkdirSync(join(repo, "config"), { recursive: true });
		writeFileSync(join(repo, "config", "credentials"), "token = REDACTED\n", "utf-8");
		writeFileSync(join(repo, "credentials"), "root level\n", "utf-8");
		mkdirSync(join(repo, "deep", "nest"), { recursive: true });
		writeFileSync(join(repo, "deep", "nest", "key.pem"), "-----BEGIN-----\n", "utf-8");
		// Negative control: ordinary files at the same depths are still captured.
		writeFileSync(join(repo, "sub", "notes.md"), "ordinary\n", "utf-8");

		const sha = createCheckpoint(repo, "case9");
		const tree = gitResult(["ls-tree", "-r", "--name-only", sha], repo);
		expect(tree.status, "listing the checkpoint tree must succeed").toBe(0);
		const captured = tree.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");

		for (const secret of ["sub/.aws/credentials", "config/credentials", "credentials", "deep/nest/key.pem"]) {
			expect(
				captured,
				`${secret} must be absent from the checkpoint tree. A captured secret survives deleting the ` +
					`file and is recoverable by anyone holding the repository directory. Tree was: ${captured.join(", ")}`,
			).not.toContain(secret);
		}
		expect(
			captured,
			"and the control: an ordinary untracked file at the same depth must STILL be captured, or the " +
				"exclusions have simply turned capture off",
		).toContain("sub/notes.md");
	});

	it("case 8 -- CR2-03: the removal half still fires, and the tree it replaced is recoverable", () => {
		// Excluding machine state must not mean restore deletes nothing; restore anchors the current tree first, so it is
		// reversible.
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
