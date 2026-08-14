/**
 * SAFE-02 — wrapper resolution to a canonical invocation, table-driven.
 *
 * Two concerns, one file, per the plan: (1) `sudo`/`env`/`nohup`/... resolve
 * to the real executable with `-u`/`-C` regressions pinned (Pitfall 2), and
 * (2) a shell runner carrying a guarded verb is denied outright, paired with
 * the negative control that proves the predicate is precise, not a blanket
 * "any shell runner is dangerous" rule.
 *
 * VACUOUS-PASS GUARD: both tables assert non-empty length before their loop
 * runs, matching this repo's house style
 * (`tests/unit/unbash-ast.test.ts`, `tests/unit/shell-deny-list.test.ts`).
 */
import { describe, expect, it } from "vitest";

import {
	canonicalise,
	GUARDED_VERB_PATTERN,
	normaliseExecutable,
	SHELL_RUNNERS,
	type ShellRefusalCause,
} from "../../.pi/extensions/safety/shell.ts";

// ---------------------------------------------------------------------------
// Table 1: wrapper resolution -- {input, expectedExecutable, expectedWrappers,
// expectedCwdOverride, why}, per the plan's required shape, plus explicit
// `outOfScope` rows for the classes this AST layer genuinely cannot catch.
// ---------------------------------------------------------------------------

interface WrapperRow {
	readonly label: string;
	readonly cmd: string;
	readonly why: string;
	readonly outOfScope?: true;
	readonly expectedExecutable?: string;
	readonly expectedWrappers?: readonly string[];
	readonly expectedCwdOverride?: string;
}

const WRAPPER_TABLE: readonly WrapperRow[] = [
	{
		label: "sudo",
		cmd: "sudo git push",
		expectedExecutable: "git",
		expectedWrappers: ["sudo"],
		why: "plan <behavior>: sudo git push -> executable git, wrappers ['sudo']",
	},
	{
		label: "sudo -u root (Pitfall 2 regression)",
		cmd: "sudo -u root git push",
		expectedExecutable: "git",
		expectedWrappers: ["sudo"],
		why: "plan <behavior> + 04-RESEARCH.md Pitfall 2: -u consumes 'root' as its VALUE, so the executable must be git, NOT root",
	},
	{
		label: "env -i",
		cmd: "env -i git push",
		expectedExecutable: "git",
		expectedWrappers: ["env"],
		why: "plan <behavior>: env -i git push -> executable git, wrappers ['env']",
	},
	{
		label: "env -u ... -C ... (value-consuming flags chained)",
		cmd: "env -u FOO -C /some/dir git push",
		expectedExecutable: "git",
		expectedWrappers: ["env"],
		expectedCwdOverride: "/some/dir",
		why: "plan <behavior>: -u and -C both consume a value; -C is recorded as a directory override",
	},
	{
		label: "nohup, no background operator",
		cmd: "nohup git push",
		expectedExecutable: "git",
		expectedWrappers: ["nohup"],
		why: "plan <behavior>: nohup git push (no &) -> executable git, wrappers ['nohup']",
	},
	{
		label: "time (a genuine shell keyword, not a wrapper WORD)",
		cmd: "time git push",
		expectedExecutable: "git",
		expectedWrappers: [],
		why: "executed against unbash: 'time' parses as Pipeline.time === true, a structural keyword -- the Command node unbash hands back is already just 'git push' with no 'time' word in it at all, so PASSTHROUGH_WRAPPERS's 'time' entry never fires for this exact fixture (it exists for defence-in-depth / a quoted \"time\" literal). Deviation from a literal reading of the plan's <behavior>, documented per CLAUDE.md 'verify at source, not docs'.",
	},
	{
		label: "nice",
		cmd: "nice git push",
		expectedExecutable: "git",
		expectedWrappers: ["nice"],
		why: "plan <behavior>: bare pass-through wrapper",
	},
	{
		label: "stdbuf with a packed flag",
		cmd: "stdbuf -o0 git push",
		expectedExecutable: "git",
		expectedWrappers: ["stdbuf"],
		why: "plan <behavior>: -o0 packs flag+value into one token, resolved by the generic flag-skip",
	},
	{
		label: "command",
		cmd: "command git push",
		expectedExecutable: "git",
		expectedWrappers: ["command"],
		why: "plan <behavior>: bare pass-through wrapper",
	},
	{
		label: "git -C to another repo",
		cmd: "git -C /c/other/repo push",
		expectedExecutable: "git",
		expectedWrappers: [],
		expectedCwdOverride: "/c/other/repo",
		why: "plan <behavior>: git's OWN -C changes the working repo; must be captured as cwdOverride for a later HEAD==main oracle",
	},
	{
		label: "git --git-dir long form",
		cmd: "git --git-dir=/c/other/.git push",
		expectedExecutable: "git",
		expectedWrappers: [],
		expectedCwdOverride: "/c/other/.git",
		why: "the --git-dir=value packed form must resolve identically to -C's split form",
	},
	{
		label: "git.exe -C to another repo (CR-08 regression)",
		cmd: "git.exe -C /c/other/repo push",
		expectedExecutable: "git.exe",
		expectedWrappers: [],
		expectedCwdOverride: "/c/other/repo",
		why:
			"CR-08: extractGitCwdOverride compared invocation.executable against a bare lower-cased 'git' " +
			"literal, so 'git.exe -C ...' silently lost its cwdOverride and a later HEAD==main oracle would " +
			"be asked about the WRONG repository. Fixed by routing through normaliseExecutable, the same " +
			"fix CR-03 already applied to policy.ts/infra.ts -- CanonicalInvocation.executable itself stays " +
			"the raw 'git.exe' word, only the internal gate is normalised.",
	},
	{
		label: "/usr/bin/env, path-qualified (CR-10 regression)",
		cmd: "/usr/bin/env git push",
		expectedExecutable: "git",
		expectedWrappers: ["env"],
		why:
			"CR-10: resolveWrappers' own env gate compared a bare .toLowerCase(), so the path-qualified " +
			"canonical POSIX spelling '/usr/bin/env' was never recognised as the env wrapper at all -- " +
			"the loop broke immediately and 'executable' became '/usr/bin/env' itself, with 'git push' " +
			"left unclassified in args. Fixed by routing through normaliseExecutable, same as every other " +
			"bare-verb gate this module owns.",
	},
	{
		label: "env.exe (CR-10 regression, Git-for-Windows spelling)",
		cmd: "env.exe git push",
		expectedExecutable: "git",
		expectedWrappers: ["env"],
		why: "same class as the /usr/bin/env row above, for the '.exe'-suffixed Git-for-Windows spelling -- the same argument CR-03 already made for git.exe.",
	},
	{
		label: "/usr/bin/sudo, path-qualified (CR-10 regression)",
		cmd: "/usr/bin/sudo git push",
		expectedExecutable: "git",
		expectedWrappers: ["sudo"],
		why: "same class as the env rows above, for resolveWrappers' own sudo gate.",
	},
	{
		label: "/usr/bin/nohup, path-qualified (CR-10 regression)",
		cmd: "/usr/bin/nohup git push",
		expectedExecutable: "git",
		expectedWrappers: ["nohup"],
		why: "same class as the env/sudo rows above, for resolveWrappers' own PASSTHROUGH_WRAPPERS gate.",
	},
	{
		label: "/usr/bin/env with a non-guarded verb (CR-10 paired negative)",
		cmd: "/usr/bin/env echo hi",
		expectedExecutable: "echo",
		expectedWrappers: ["env"],
		why:
			"a paired negative proving the CR-10 fix does not degenerate into 'any path-qualified env " +
			"blocks': the wrapper still resolves generically to whatever real executable follows it, " +
			"guarded or not -- policy.ts is what decides whether 'echo' itself is interesting, and it isn't.",
	},
	{
		label: "npm run deploy (task-runner indirection)",
		cmd: "npm run deploy",
		outOfScope: true,
		why: "SAFE-15: task-runner indirection is explicitly out of scope for this AST layer -- npm/make are not guarded executables",
	},
	{
		label: "make deploy (task-runner indirection)",
		cmd: "make deploy",
		outOfScope: true,
		why: "SAFE-15: same class as npm run -- a Makefile target can shell out to anything and this layer cannot see inside it",
	},
	{
		label: "PATH-shadowed git binary",
		cmd: "git push",
		outOfScope: true,
		why: "SAFE-15: if a directory earlier on PATH than the real git ships its own 'git' binary, this AST layer has no way to detect the shadowing -- it only ever sees the literal word 'git'",
	},
];

describe("SAFE-02 -- wrapper-resolution table is non-empty (vacuous-pass guard)", () => {
	it("covers every wrapper row named in the plan's <behavior> block plus the out-of-scope rows", () => {
		expect(WRAPPER_TABLE.length, "a shortened table silently drops a Pitfall-2 regression or an out-of-scope row").toBeGreaterThanOrEqual(
			20,
		);
		const outOfScopeCount = WRAPPER_TABLE.filter((r) => r.outOfScope === true).length;
		expect(outOfScopeCount, "SAFE-15 requires at least two rows explicitly tagged out-of-scope").toBeGreaterThanOrEqual(2);
	});
});

describe("SAFE-02 -- resolveWrappers(), exercised through canonicalise()", () => {
	for (const row of WRAPPER_TABLE) {
		it(`"${row.cmd}" (${row.label})`, () => {
			const verdict = canonicalise(row.cmd);
			expect(verdict.kind, `${row.why} -- expected an 'ok' verdict with invocations to inspect`).toBe("ok");
			if (verdict.kind !== "ok") {
				return;
			}
			expect(verdict.invocations.length, "expected exactly one command segment in this fixture").toBeGreaterThanOrEqual(1);
			const inv = verdict.invocations[0];

			if (row.outOfScope === true) {
				// Out-of-scope rows document OBSERVED behaviour (SAFE-15's published
				// limits table), not a specific executable/wrapper expectation --
				// the point is that this layer does not special-case them at all.
				expect(inv, row.why).toBeDefined();
				return;
			}

			if (row.expectedExecutable !== undefined) {
				expect(inv.executable, `${row.why} -- got executable "${inv.executable}"`).toBe(row.expectedExecutable);
			}
			if (row.expectedWrappers !== undefined) {
				expect(inv.wrappers, row.why).toEqual(row.expectedWrappers);
			}
			if (row.expectedCwdOverride !== undefined) {
				expect(inv.cwdOverride, row.why).toBe(row.expectedCwdOverride);
			} else if (row.outOfScope !== true && row.label !== "git -C to another repo" && row.label !== "git --git-dir long form") {
				// Explicit negative: a row that does NOT expect a cwdOverride must
				// not silently receive one from a misapplied wrapper-level -C.
				expect(inv.cwdOverride, `${row.label} must not carry a spurious cwdOverride`).toBeUndefined();
			}
		});
	}
});

// ---------------------------------------------------------------------------
// Table 2: shell-runner denial -- paired positive/negative on the same
// predicate, per the plan's explicit acceptance criterion.
// ---------------------------------------------------------------------------

interface ShellRunnerRow {
	readonly label: string;
	readonly cmd: string;
	readonly expected: "refused" | "ok";
	readonly cause?: ShellRefusalCause;
	readonly why: string;
}

const SHELL_RUNNER_TABLE: readonly ShellRunnerRow[] = [
	{
		label: "sh -c with a guarded verb",
		cmd: 'sh -c "git push"',
		expected: "refused",
		cause: "shell-runner",
		why: "plan <behavior>: sh -c \"git push\" -> refused, cause shell-runner",
	},
	{
		label: "bash -lc with a guarded verb",
		cmd: 'bash -lc "git push"',
		expected: "refused",
		cause: "shell-runner",
		why: "plan <behavior>: same shell-runner indirection, different runner name",
	},
	{
		label: "xargs with a guarded verb",
		cmd: "xargs git push",
		expected: "refused",
		cause: "shell-runner",
		why: "plan <behavior>: xargs git push -> same treatment as sh -c/bash -lc",
	},
	{
		label: "sh -c with NO guarded verb (negative control)",
		cmd: 'sh -c "ls"',
		expected: "ok",
		why: "plan <behavior>: sh -c \"ls\" -> NOT refused -- a shell runner alone is not the trigger, only a shell runner PLUS a guarded verb",
	},
	{
		label: "pipeline mentioning a guarded verb only in an echo argument",
		cmd: 'echo "run git push manually" | tee notes.txt',
		expected: "ok",
		why: "corpus row for Plan 11 (SAFE-15): echo/tee are not shell runners, so this benign pipeline is correctly NOT refused even though its text mentions git push",
	},
	{
		label: "eval with a literal guarded verb (Plan 11 regression -- EV-08)",
		cmd: 'eval "git push"',
		expected: "refused",
		cause: "shell-runner",
		why: "Plan 11's evasion corpus found this came back allow before eval was added to SHELL_RUNNERS -- eval executes its argument as shell code in the current shell, the same shape as sh -c, just without a fork",
	},
	{
		label: "bash.exe -c with a guarded verb (CR-08 regression)",
		cmd: 'bash.exe -c "git push"',
		expected: "refused",
		cause: "shell-runner",
		why:
			"CR-08: findShellRunnerDenial compared inv.executable via a bare .toLowerCase(), so 'bash.exe' " +
			"never matched the SHELL_RUNNERS membership check even though it is the ordinary Git-Bash-on-" +
			"Windows spelling, not an adversarial one -- came back allow before this fix.",
	},
	{
		label: "/bin/sh -c with a guarded verb, path-qualified (CR-08 regression)",
		cmd: '/bin/sh -c "git push"',
		expected: "refused",
		cause: "shell-runner",
		why: "CR-08: same class as bash.exe -c above, for a path-qualified /bin/sh spelling -- normaliseExecutable reduces both to their basename before the SHELL_RUNNERS check.",
	},
	{
		label: "/usr/bin/xargs, path-qualified (CR-08 regression)",
		cmd: "/usr/bin/xargs git push",
		expected: "refused",
		cause: "shell-runner",
		why: "CR-08: a path-qualified xargs invocation must classify identically to the bare 'xargs' spelling already covered above.",
	},
	{
		label: "sh.exe -c with NO guarded verb, path-qualified (CR-08 paired negative)",
		cmd: 'sh.exe -c "ls"',
		expected: "ok",
		why: "CR-08: the normalisation fix must not degenerate into 'any .exe-suffixed runner is denied' -- a shell-runner spelling with no guarded verb in its raw segment still classifies ok.",
	},
];

describe("SAFE-02/SAFE-03 -- shell-runner table is non-empty (vacuous-pass guard)", () => {
	it("covers the refused trio plus the paired negative control and the pipeline corpus row", () => {
		expect(SHELL_RUNNER_TABLE.length).toBeGreaterThanOrEqual(5);
		const refusedCount = SHELL_RUNNER_TABLE.filter((r) => r.expected === "refused").length;
		const okCount = SHELL_RUNNER_TABLE.filter((r) => r.expected === "ok").length;
		expect(refusedCount, "must cover sh -c / bash -lc / xargs").toBeGreaterThanOrEqual(3);
		expect(okCount, "must cover the paired negative control and the pipeline corpus row").toBeGreaterThanOrEqual(2);
	});
});

describe("SAFE-02/SAFE-03 -- shell-runner denial: resolved executable in SHELL_RUNNERS AND raw segment matches GUARDED_VERB_PATTERN", () => {
	for (const row of SHELL_RUNNER_TABLE) {
		it(`"${row.cmd}" (${row.label}) -> ${row.expected}${row.cause ? ` (${row.cause})` : ""}`, () => {
			const verdict = canonicalise(row.cmd);
			expect(verdict.kind, row.why).toBe(row.expected);
			if (row.expected === "refused" && verdict.kind === "refused" && row.cause !== undefined) {
				expect(verdict.cause, row.why).toBe(row.cause);
			}
		});
	}
});

describe("SAFE-02 -- SHELL_RUNNERS / GUARDED_VERB_PATTERN are exported and consistent with the tables above", () => {
	it("every resolved executable in the refused shell-runner rows is a member of SHELL_RUNNERS once normalised (CR-08)", () => {
		for (const row of SHELL_RUNNER_TABLE.filter((r) => r.expected === "refused")) {
			const verdict = canonicalise(row.cmd);
			// A refused verdict carries no invocations, so re-derive the resolved
			// executable independently: the FIRST word of the command, run through
			// normaliseExecutable (CR-08 -- basename, lower-cased, PATHEXT suffix
			// stripped, not a bare .toLowerCase()), must itself be a SHELL_RUNNERS
			// member for this fixture to mean anything. A raw .toLowerCase() here
			// would fail this test's OWN new "bash.exe"/"/bin/sh"/"/usr/bin/xargs"
			// rows even though findShellRunnerDenial (shell.ts) correctly refuses
			// them post-fix -- this assertion must model the SAME normalisation the
			// code under test now applies, or it would not catch a regression back
			// to the bare-string comparison CR-08 fixes.
			const firstWord = row.cmd.trim().split(/\s+/)[0];
			expect(
				firstWord !== undefined && SHELL_RUNNERS.has(normaliseExecutable(firstWord)),
				`${row.cmd} must start with a (possibly path-qualified/.exe-suffixed) SHELL_RUNNERS member`,
			).toBe(true);
			expect(verdict.kind).toBe("refused");
		}
	});

	it("GUARDED_VERB_PATTERN matches git/glab/terraform/aws/kubectl as whole words only", () => {
		for (const verb of ["git", "glab", "terraform", "aws", "kubectl"]) {
			expect(GUARDED_VERB_PATTERN.test(`sh -c "${verb} status"`), `${verb} must be recognised as a guarded verb`).toBe(true);
		}
		expect(GUARDED_VERB_PATTERN.test("sh -c \"digit status\""), "must not match 'git' as a substring of another word").toBe(
			false,
		);
	});
});
