/**
 * SAFE-06 / SAFE-08 / SAFE-13 — `.pi/extensions/safety/paths.ts`, table-driven.
 *
 * WHY THE UNQUOTED/QUOTED FIXTURES ARE BUILT FROM `BS`, NOT A STRING LITERAL
 * ESCAPE. `String.fromCharCode(92)` is one literal backslash built without
 * going through any string-literal escape layer of its own — the same
 * technique `tests/unit/unbash-ast.test.ts` (Plan 01) uses, so a fixture here
 * cannot silently be off by one backslash from what unbash itself would
 * actually see. The exact `word.text`/`word.value` pairs below were VERIFIED
 * by direct execution against unbash 4.0.10 during this plan, not assumed
 * from the plan's prose.
 *
 * VACUOUS-PASS GUARD, this repo's house rule (see `tests/unit/redact.test.ts`,
 * `tests/unit/shell-deny-list.test.ts`): every table asserts its own length
 * before the loop that consumes it runs, and every entry in
 * `SENSITIVE_READ_PATTERNS` / `DETONATION_TARGETS` is asserted reachable by
 * at least one fixture row below — a dead pattern and an absent one produce
 * identical green runs otherwise (`tests/unit/chokepoint-lint.test.ts:212-233`
 * is the model this file follows).
 */
import { describe, expect, it } from "vitest";

import {
	canonicalisePathArg,
	classifyPathRead,
	classifyPathWrite,
	classifyReadGlob,
	DETONATION_TARGETS,
	SENSITIVE_READ_PATTERNS,
	type PathPolicyFacts,
	type PathWordArg,
} from "../../.pi/extensions/safety/paths.ts";

/** One literal backslash, built without going through any string-literal escape layer. */
const BS = String.fromCharCode(92);

function winPath(posixLike: string): string {
	return posixLike.split("/").join(BS);
}

/** Fixture home/cwd/projectRoot — deliberately NOT read from this machine's real environment. */
const HOME = "C:/Users/Admin";
const CWD = "C:/Users/Admin/project";
const PROJECT_ROOT = "C:/Users/Admin/project";

function ctx(overrides: Partial<{ cwd: string; home: string }> = {}) {
	return { cwd: overrides.cwd ?? CWD, home: overrides.home ?? HOME };
}

function arg(text: string, value: string = text): PathWordArg {
	return { text, value };
}

// ---------------------------------------------------------------------------
// Task 1 — canonicalisePathArg
// ---------------------------------------------------------------------------

const AWS_CREDENTIALS_CANONICAL = "C:/Users/Admin/.aws/credentials";

/**
 * Every row canonicalises to {@link AWS_CREDENTIALS_CANONICAL}. This is the
 * table the plan's own warning names: "the warning sign Pitfall 3 names is a
 * rule that fires for the quoted form and silently passes the unquoted one."
 * Each row's `text`/`value` pair was verified by executing unbash 4.0.10
 * directly against the shown shell fragment during this plan.
 */
const EQUIVALENT_TO_AWS_CREDENTIALS: ReadonlyArray<{ label: string; word: PathWordArg; ctxOverrides?: Partial<{ cwd: string; home: string }> }> = [
	{
		label: "unquoted Windows path (value is MANGLED by unbash's escape handling; text is not)",
		word: arg(winPath("C:/Users/Admin/.aws/credentials"), "C:UsersAdmin.awscredentials"),
	},
	{
		label: 'double-quoted Windows path (text still carries the quote marks; value is unmangled)',
		word: arg(`"${winPath("C:/Users/Admin/.aws/credentials")}"`, winPath("C:/Users/Admin/.aws/credentials")),
	},
	{
		label: "single-quoted Windows path (text still carries the quote marks; value is unmangled)",
		word: arg(`'${winPath("C:/Users/Admin/.aws/credentials")}'`, winPath("C:/Users/Admin/.aws/credentials")),
	},
	{
		label: "MSYS /c/ form",
		word: arg("/c/Users/Admin/.aws/credentials"),
	},
	{
		label: "/cygdrive/c/ form",
		word: arg("/cygdrive/c/Users/Admin/.aws/credentials"),
	},
	{
		label: "MSYS form behind a . segment",
		word: arg("/./c/Users/Admin/.aws/credentials"),
	},
	{
		label: "MSYS form behind a .. segment",
		word: arg("/tmp/../c/Users/Admin/.aws/credentials"),
	},
	{
		label: "MSYS form behind duplicate separators",
		word: arg("/.//c//Users/Admin/.aws/credentials"),
	},
	{
		label: "/cygdrive form behind a .. segment",
		word: arg("/x/../cygdrive/c/Users/Admin/.aws/credentials"),
	},
	{
		label: "relative path from the root directory",
		word: arg("c/Users/Admin/.aws/credentials"),
		ctxOverrides: { cwd: "/" },
	},
	{
		label: "already-forward-slash C:/ form",
		word: arg("C:/Users/Admin/.aws/credentials"),
	},
	{
		label: "lowercase drive letter (case-insensitive drive comparison)",
		word: arg(winPath("c:/Users/Admin/.aws/credentials")),
	},
	{
		label: "~/ expansion against the fixture home",
		word: arg("~/.aws/credentials"),
	},
	{
		label: "$HOME/ expansion against the fixture home",
		word: arg("$HOME/.aws/credentials"),
	},
	{
		label: "${HOME}/ expansion against the fixture home",
		word: arg("${HOME}/.aws/credentials"),
	},
];

describe("SAFE-06/SAFE-08 -- canonicalisePathArg: table is non-empty (vacuous-pass guard)", () => {
	it("has at least the ten equivalence-class rows the plan's acceptance criteria name", () => {
		expect(
			EQUIVALENT_TO_AWS_CREDENTIALS.length,
			"a shortened table silently drops coverage of a quoting form, a drive-prefix form, or an expansion form",
		).toBeGreaterThanOrEqual(10);
	});
});

describe("SAFE-06/SAFE-08 -- canonicalisePathArg: every path form for one file canonicalises to ONE string", () => {
	for (const row of EQUIVALENT_TO_AWS_CREDENTIALS) {
		it(`${row.label} -> "${AWS_CREDENTIALS_CANONICAL}"`, () => {
			const result = canonicalisePathArg(row.word, ctx(row.ctxOverrides));
			expect(
				result,
				`text="${row.word.text}" must canonicalise to the same string every other row in this table produces`,
			).toBe(AWS_CREDENTIALS_CANONICAL);
		});
	}

	it("the unquoted form specifically does not fall back to word.value (the Pitfall 3 regression)", () => {
		// word.value for the unquoted fixture is the MANGLED "C:UsersAdmin.awscredentials" --
		// if canonicalisePathArg ever read .value instead of .text, this row alone would
		// silently diverge from every other row in the table above.
		const mangled = EQUIVALENT_TO_AWS_CREDENTIALS[0]!.word;
		expect(mangled.value, "fixture sanity: value really is mangled, or this test proves nothing").not.toBe(
			winPath("C:/Users/Admin/.aws/credentials"),
		);
		expect(canonicalisePathArg(mangled, ctx())).toBe(AWS_CREDENTIALS_CANONICAL);
	});
});

describe("SAFE-08 -- canonicalisePathArg: relative resolution against a caller-supplied cwd", () => {
	it("./secrets/.env resolves against cwd, never process.cwd()", () => {
		expect(canonicalisePathArg(arg("./secrets/.env"), ctx())).toBe("C:/Users/Admin/project/secrets/.env");
	});

	it("../outside/file walks one segment above cwd", () => {
		expect(canonicalisePathArg(arg("../outside/file"), ctx())).toBe("C:/Users/Admin/outside/file");
	});

	it("a bare relative path with no ./ prefix also resolves against cwd", () => {
		expect(canonicalisePathArg(arg("src/index.ts"), ctx())).toBe("C:/Users/Admin/project/src/index.ts");
	});
});

describe("SAFE-08 -- canonicalisePathArg: UNC paths are not mistaken for drive-letter paths", () => {
	it("\\\\server\\share\\pi\\file canonicalises without a drive letter, and the share root survives ..", () => {
		const result = canonicalisePathArg(arg(winPath("//server/share/pi/file")), ctx());
		expect(result, "UNC form must not collapse into something matching X:/...").not.toMatch(/^[A-Za-z]:/);
		expect(result).toBe(BS + BS + "server/share/pi/file");
	});

	it("a UNC path cannot .. above its own share root", () => {
		const result = canonicalisePathArg(arg(winPath("//server/share/../../escaped")), ctx());
		expect(result, "climbing above server+share must be a no-op, not an escape out of the share").toBe(
			BS + BS + "server/share/escaped",
		);
	});
});

describe("SAFE-08 -- canonicalisePathArg: drive-letter case is normalised WITHOUT collapsing the rest of the path's case", () => {
	it("C: and c: produce the identical canonical string for the same rest-of-path", () => {
		const upper = canonicalisePathArg(arg(winPath("C:/Users/Admin/File.txt")), ctx());
		const lower = canonicalisePathArg(arg(winPath("c:/Users/Admin/File.txt")), ctx());
		expect(upper).toBe(lower);
		expect(upper).toBe("C:/Users/Admin/File.txt");
	});

	it("two paths differing only in a NON-drive segment's case remain DISTINCT strings (case is not collapsed)", () => {
		const asGiven = canonicalisePathArg(arg(winPath("C:/Users/Admin/File.txt")), ctx());
		const shouted = canonicalisePathArg(arg(winPath("C:/USERS/Admin/File.txt")), ctx());
		expect(
			asGiven,
			"if this equalled `shouted`, canonicalisePathArg would be lower/upper-casing the whole path, " +
				"which the plan's <behavior> explicitly forbids ('without collapsing case on the rest of the path')",
		).not.toBe(shouted);
	});
});

// ---------------------------------------------------------------------------
// Task 2 — classifyPathRead / classifyPathWrite
// ---------------------------------------------------------------------------

const KUBECONFIG_ENV_CANONICAL = "C:/Users/Admin/custom/kubeconfig.yaml";

const READ_FACTS: PathPolicyFacts = {
	projectRoot: PROJECT_ROOT,
	home: HOME,
	kubeconfigEnv: KUBECONFIG_ENV_CANONICAL,
};

interface ReadRow {
	readonly label: string;
	readonly rawText: string;
	readonly expected: "allow" | "block";
	readonly patternId?: string;
}

const READ_TABLE: readonly ReadRow[] = [
	{ label: ".env", rawText: ".env", expected: "block", patternId: "dotenv" },
	{ label: ".env.local", rawText: ".env.local", expected: "block", patternId: "dotenv" },
	{ label: ".env.production", rawText: ".env.production", expected: "block", patternId: "dotenv" },
	{ label: "~/.aws/credentials", rawText: "~/.aws/credentials", expected: "block", patternId: "aws-credentials" },
	{ label: "~/.aws/config", rawText: "~/.aws/config", expected: "block", patternId: "aws-credentials" },
	{ label: "~/.kube/config", rawText: "~/.kube/config", expected: "block", patternId: "kubeconfig" },
	{
		label: "KUBECONFIG-named path",
		rawText: "C:/Users/Admin/custom/kubeconfig.yaml",
		expected: "block",
		patternId: "kubeconfig",
	},
	{ label: "terraform.tfstate", rawText: "terraform.tfstate", expected: "block", patternId: "tfstate" },
	{ label: "terraform.tfstate.backup", rawText: "terraform.tfstate.backup", expected: "block", patternId: "tfstate" },
	{ label: "the harness ledger key", rawText: ".git/kypi-ledger/key", expected: "block", patternId: "harness-ledger" },
	{ label: "a harness ledger file", rawText: ".git/kypi-ledger/s1.jsonl", expected: "block", patternId: "harness-ledger" },
	{ label: "a file merely named after the ledger", rawText: "docs/kypi-ledger.md", expected: "allow" },
	{ label: "upper-case .ENV", rawText: ".ENV", expected: "block", patternId: "dotenv" },
	{ label: "mixed-case .Env.Local", rawText: ".Env.Local", expected: "block", patternId: "dotenv" },
	{ label: ".ENV.EXAMPLE keeps the carve-out", rawText: ".ENV.EXAMPLE", expected: "allow" },
	{ label: "~/.aws/sso/cache token", rawText: "~/.aws/sso/cache/a.json", expected: "block", patternId: "home-aws" },
	{ label: "~/.aws/cli/cache token", rawText: "~/.aws/cli/cache/b.json", expected: "block", patternId: "home-aws" },
	{ label: "~/.ssh/id_ed25519", rawText: "~/.ssh/id_ed25519", expected: "block", patternId: "home-ssh" },
	{ label: "~/.git-credentials", rawText: "~/.git-credentials", expected: "block", patternId: "git-credentials" },
	{ label: "~/.docker/config.json", rawText: "~/.docker/config.json", expected: "block", patternId: "docker-config" },
	{ label: "~/.pi/agent/auth.json", rawText: "~/.pi/agent/auth.json", expected: "block", patternId: "pi-auth" },
	{ label: "~/.netrc", rawText: "~/.netrc", expected: "block", patternId: "home-credential-stores" },
	{ label: "~/.config/glab-cli/config.yml", rawText: "~/.config/glab-cli/config.yml", expected: "block", patternId: "home-credential-stores" },
	{ label: "~/.terraform.d/credentials.tfrc.json", rawText: "~/.terraform.d/credentials.tfrc.json", expected: "block", patternId: "home-credential-stores" },
	{ label: "a GnuPG private key", rawText: "~/.gnupg/private-keys-v1.d/a.key", expected: "block", patternId: "home-credential-stores" },
	{ label: "~/.kube/cache token", rawText: "~/.kube/cache/t", expected: "block", patternId: "home-credential-stores" },
	{ label: "~/.config/gh/hosts.yml", rawText: "~/.config/gh/hosts.yml", expected: "block", patternId: "home-credential-stores" },
	{ label: "~/.npmrc", rawText: "~/.npmrc", expected: "block", patternId: "home-credential-stores" },
	{ label: "a project .npmrc", rawText: ".npmrc", expected: "allow" },
	{ label: "/proc/self/environ", rawText: "/proc/self/environ", expected: "block", patternId: "process-environment" },
	{ label: "a .ssh directory inside the project", rawText: "tests/fixtures/.ssh/x", expected: "allow" },
	{ label: "docs/aws.md", rawText: "docs/aws.md", expected: "allow" },
	{ label: ".env:$DATA stream suffix", rawText: ".env:$DATA", expected: "block", patternId: "dotenv" },
	{ label: ".env::$DATA stream suffix", rawText: ".env::$DATA", expected: "block", patternId: "dotenv" },
	{ label: "8.3 alias ENV~1", rawText: "ENV~1", expected: "block", patternId: "short-name-alias" },
	{ label: "8.3 alias DOTENV~2.LOC", rawText: "DOTENV~2.LOC", expected: "block", patternId: "short-name-alias" },
	{ label: "8.3 alias of ~/.aws as a directory segment", rawText: "~/AWS~1/credentials", expected: "block", patternId: "short-name-protected" },
	{ label: "8.3 alias of ~/.ssh as a directory segment", rawText: "~/SSH~1/id_rsa", expected: "block", patternId: "short-name-protected" },
	{ label: "hashed 8.3 alias of ~/.pi", rawText: "~/PIC454~1/agent/auth.json", expected: "block", patternId: "short-name-protected" },
	{ label: "8.3 alias of a tfstate file", rawText: "infra/PROD~1.TFS", expected: "block", patternId: "short-name-alias" },
	{ label: "an 8.3 directory segment of an unprotected name", rawText: "PROGRA~1/x", expected: "allow" },
	{ label: "notes~draft.md is not an 8.3 alias", rawText: "notes~draft.md", expected: "allow" },
	// Paired negatives -- the false positives that matter (04-CONTEXT.md `<specifics>`).
	{ label: ".env.example (deliberate carve-out)", rawText: ".env.example", expected: "allow" },
	{ label: ".env.template (deliberate carve-out)", rawText: ".env.template", expected: "allow" },
	{ label: "README.md", rawText: "README.md", expected: "allow" },
	{ label: "src/config.ts", rawText: "src/config.ts", expected: "allow" },
	{ label: "a file merely named environment.ts", rawText: "src/environment.ts", expected: "allow" },
	{ label: 'a "config" file whose parent is not .aws or .kube', rawText: "app/config", expected: "allow" },
];

describe("SAFE-06 -- classifyPathRead table is non-empty (vacuous-pass guard)", () => {
	it("covers at least the four BLOCK classes named in the plan's acceptance criteria plus their negatives", () => {
		expect(READ_TABLE.length).toBeGreaterThanOrEqual(15);
		expect(READ_TABLE.filter((r) => r.expected === "block").length).toBeGreaterThanOrEqual(9);
		expect(READ_TABLE.filter((r) => r.expected === "allow").length).toBeGreaterThanOrEqual(6);
	});
});

describe("SAFE-06 -- classifyPathRead", () => {
	for (const row of READ_TABLE) {
		it(`${row.label} -> ${row.expected}`, () => {
			const canonical = canonicalisePathArg(arg(row.rawText), ctx());
			const verdict = classifyPathRead(canonical, READ_FACTS);
			expect(verdict.kind, `canonical path was "${canonical}"`).toBe(row.expected);
		});
	}
});

describe("SAFE-06 -- every SENSITIVE_READ_PATTERNS entry is matched by at least one fixture row (liveness)", () => {
	it("SENSITIVE_READ_PATTERNS is non-empty, or this guard proves nothing", () => {
		expect(SENSITIVE_READ_PATTERNS.length).toBeGreaterThan(0);
	});

	it("every exported pattern id fires against the READ_TABLE fixtures", () => {
		const fired = new Set<string>();
		for (const row of READ_TABLE) {
			const canonical = canonicalisePathArg(arg(row.rawText), ctx());
			for (const pattern of SENSITIVE_READ_PATTERNS) {
				if (pattern.match(canonical, READ_FACTS)) {
					fired.add(pattern.id);
				}
			}
		}
		for (const pattern of SENSITIVE_READ_PATTERNS) {
			expect(fired.has(pattern.id), `pattern "${pattern.id}" is exported but no fixture row triggers it -- dead pattern`).toBe(
				true,
			);
		}
	});
});

interface WriteRow {
	readonly label: string;
	readonly rawText: string;
	readonly expected: "allow" | "block";
	readonly targetId?: string;
}

const WRITE_FACTS: PathPolicyFacts = { projectRoot: PROJECT_ROOT, home: HOME };

const WRITE_TABLE: readonly WriteRow[] = [
	{ label: ".git/hooks/pre-commit", rawText: ".git/hooks/pre-commit", expected: "block", targetId: "git-hooks" },
	{ label: ".git/hooks/post-checkout (any hook name)", rawText: ".git/hooks/post-checkout", expected: "block", targetId: "git-hooks" },
	{ label: ".git/config", rawText: ".git/config", expected: "block", targetId: "git-config" },
	{ label: "~/.bashrc", rawText: "~/.bashrc", expected: "block", targetId: "bashrc" },
	{ label: "~/.bash_profile", rawText: "~/.bash_profile", expected: "block", targetId: "bash-profile" },
	{ label: "~/.profile", rawText: "~/.profile", expected: "block", targetId: "profile" },
	{ label: "~/.gitconfig", rawText: "~/.gitconfig", expected: "block", targetId: "gitconfig" },
	{
		label: ".github/workflows/ci.yml",
		rawText: ".github/workflows/ci.yml",
		expected: "block",
		targetId: "github-workflows",
	},
	{
		label: ".github/workflows/deploy.yaml (.yaml, not only .yml)",
		rawText: ".github/workflows/deploy.yaml",
		expected: "block",
		targetId: "github-workflows",
	},
	{ label: ".gitlab-ci.yml", rawText: ".gitlab-ci.yml", expected: "block", targetId: "gitlab-ci" },
	{ label: ".git/config.worktree", rawText: ".git/config.worktree", expected: "block", targetId: "git-config" },
	{ label: "a submodule's git config", rawText: ".git/modules/s/config", expected: "block", targetId: "git-config" },
	{ label: "a submodule's hook", rawText: ".git/modules/s/hooks/pre-push", expected: "block", targetId: "git-hooks" },
	{ label: "a husky hook", rawText: ".husky/pre-push", expected: "block", targetId: "hook-manager" },
	{ label: "pre-commit config", rawText: ".pre-commit-config.yaml", expected: "block", targetId: "hook-manager" },
	{ label: "lefthook config", rawText: "lefthook.yml", expected: "block", targetId: "hook-manager" },
	{ label: "a doc about husky", rawText: "docs/husky.md", expected: "allow" },
	{ label: "an app config file", rawText: "src/config", expected: "allow" },
	{ label: "a harness ledger file (model-forged evidence)", rawText: ".git/kypi-ledger/s1.jsonl", expected: "block" },
	{
		label: "absolute path elsewhere on the drive",
		rawText: "C:/Elsewhere/file.txt",
		expected: "block",
	},
	{
		label: "../outside/file.txt (traversal above the project root)",
		rawText: "../outside/file.txt",
		expected: "block",
	},
	{ label: "project agent definitions", rawText: ".pi/agents/x.md", expected: "block", targetId: "agent-definitions" },
	{ label: "project .agents directory", rawText: ".agents/y.md", expected: "block", targetId: "agent-definitions" },
	{ label: "user agent definitions", rawText: "~/.pi/agent/agents/z.md", expected: "block", targetId: "agent-definitions" },
	{ label: "user Pi settings", rawText: "~/.pi/agent/settings.json", expected: "block", targetId: "pi-settings" },
	{ label: "project Pi settings", rawText: ".pi/settings.json", expected: "block", targetId: "pi-settings" },
	// Paired negatives -- the false positives that matter.
	{ label: "docs/workflows.md (contains 'workflows' but not under .github/)", rawText: "docs/workflows.md", expected: "allow" },
	{ label: "docs/hooks/README.md (contains 'hooks' but not under .git/)", rawText: "docs/hooks/README.md", expected: "allow" },
	{
		label: "notes/gitconfig-backup.md (mentions gitconfig but is not ~/.gitconfig)",
		rawText: "notes/gitconfig-backup.md",
		expected: "allow",
	},
	{ label: "an ordinary write inside the project root", rawText: "src/index.ts", expected: "allow" },
];

describe("SAFE-08/SAFE-13 -- classifyPathWrite table is non-empty (vacuous-pass guard)", () => {
	it("covers every detonation target plus containment plus their negatives", () => {
		expect(WRITE_TABLE.length).toBeGreaterThanOrEqual(16);
		expect(WRITE_TABLE.filter((r) => r.expected === "block").length).toBeGreaterThanOrEqual(12);
		expect(WRITE_TABLE.filter((r) => r.expected === "allow").length).toBeGreaterThanOrEqual(4);
	});
});

describe("SAFE-08/SAFE-13 -- classifyPathWrite", () => {
	for (const row of WRITE_TABLE) {
		it(`${row.label} -> ${row.expected}`, () => {
			const canonical = canonicalisePathArg(arg(row.rawText), ctx());
			const verdict = classifyPathWrite(canonical, WRITE_FACTS);
			expect(verdict.kind, `canonical path was "${canonical}"`).toBe(row.expected);
			if (row.expected === "block" && verdict.kind === "block") {
				expect(verdict.reason.length, "every block must carry a non-empty audit-ready reason").toBeGreaterThan(0);
			}
		});
	}

	it("the containment block names the project root in its reason (auditable, not just a boolean)", () => {
		const canonical = canonicalisePathArg(arg("../outside/file.txt"), ctx());
		const verdict = classifyPathWrite(canonical, WRITE_FACTS);
		expect(verdict.kind).toBe("block");
		if (verdict.kind === "block") {
			expect(verdict.reason).toContain(PROJECT_ROOT);
		}
	});
});

describe("SAFE-08/SAFE-13 -- every DETONATION_TARGETS entry is matched by at least one fixture row (liveness)", () => {
	it("DETONATION_TARGETS is non-empty, or this guard proves nothing", () => {
		expect(DETONATION_TARGETS.length).toBeGreaterThan(0);
	});

	it("every exported target id fires against the WRITE_TABLE fixtures", () => {
		const fired = new Set<string>();
		for (const row of WRITE_TABLE) {
			const canonical = canonicalisePathArg(arg(row.rawText), ctx());
			for (const target of DETONATION_TARGETS) {
				if (target.match(canonical, WRITE_FACTS)) {
					fired.add(target.id);
				}
			}
		}
		for (const target of DETONATION_TARGETS) {
			expect(fired.has(target.id), `detonation target "${target.id}" is exported but no fixture row triggers it -- dead pattern`).toBe(
				true,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// WR-10 -- the detonation-rule REASON, not merely the block kind, on a
// genuinely native-Windows-shaped (backslash-rooted) home/project root.
// ---------------------------------------------------------------------------

/**
 * WR-10: `tests/integration/path-canonicalisation.test.ts`'s own docstring
 * claimed CR-02's fail-open half "is proven at the paths.ts/policy.ts unit
 * level instead" -- untrue of this file, whose `HOME`/`PROJECT_ROOT` above
 * are forward-slash literals (`"C:/Users/Admin"`), never built via the
 * `BS` helper this file already defines for exactly this purpose. A
 * forward-slash-only fixture cannot distinguish "the bashrc rule matched"
 * from "the containment rule accidentally matched too" -- `classifyPathWrite`
 * would block `~/.bashrc` via containment alone even if the bashrc
 * DETONATION_TARGETS entry were deleted outright, as long as `HOME` sits
 * outside `PROJECT_ROOT` (as `bashrc`'s own fixture does), because CR-02's
 * bug was specifically about un-canonicalised (backslash-native) facts
 * reaching this module, and only a backslash-native fixture exercises that
 * shape.
 *
 * `index.ts#toCanonicalRoot` is reproduced here verbatim (not imported --
 * that function is private to `index.ts`, and re-deriving it from the SAME
 * `canonicalisePathArg` primitive this file already imports is the more
 * faithful proof: it shows `paths.ts` itself, given a genuinely
 * backslash-rooted home run through the real canonicalisation pipeline,
 * produces the SAME detonation-rule-vs-containment-rule distinction
 * `index.ts#buildFacts` relies on).
 */
function toCanonicalRoot(absolutePath: string): string {
	return canonicalisePathArg({ text: absolutePath, value: absolutePath }, { cwd: absolutePath, home: absolutePath });
}

describe("WR-10 -- classifyPathWrite's detonation reason distinguishes the specific rule from generic containment, on a native-Windows-shaped home", () => {
	// A genuinely backslash-rooted home and project root -- exactly the shape
	// `os.homedir()`/`ctx.cwd` actually produce on this project's target
	// platform, built with the file's own BS helper rather than a
	// forward-slash literal that happens to look similar.
	const RAW_HOME = winPath("C:/Users/tester");
	const RAW_PROJECT_ROOT = winPath("C:/Users/tester/project");
	const CANONICAL_HOME = toCanonicalRoot(RAW_HOME);
	const CANONICAL_PROJECT_ROOT = toCanonicalRoot(RAW_PROJECT_ROOT);
	const FACTS: PathPolicyFacts = { projectRoot: CANONICAL_PROJECT_ROOT, home: CANONICAL_HOME };

	it("fixture sanity: the raw home is genuinely backslash-rooted, or this test proves nothing", () => {
		expect(RAW_HOME, "BS must have produced a real backslash, not a forward slash").toContain(BS);
		expect(CANONICAL_HOME, "toCanonicalRoot must have normalised it to forward slashes").not.toContain(BS);
	});

	it('~/.bashrc blocks because of the "shell rc file" reason, not "resolves outside the project root"', () => {
		const canonical = canonicalisePathArg(arg("~/.bashrc"), { cwd: CANONICAL_PROJECT_ROOT, home: CANONICAL_HOME });
		const verdict = classifyPathWrite(canonical, FACTS);
		expect(verdict.kind).toBe("block");
		if (verdict.kind === "block") {
			expect(
				verdict.reason,
				"the bashrc DETONATION_TARGETS rule must be what fires -- if this instead reads " +
					"'resolves outside the project root', the containment rule matched by ACCIDENT (the " +
					"failure mode CR-02 fixed and this test guards against regressing)",
			).toContain("shell rc file");
			expect(verdict.reason).not.toContain("resolves outside the project root");
		}
	});

	it('~/.gitconfig blocks because of the "global git config" reason, not containment', () => {
		const canonical = canonicalisePathArg(arg("~/.gitconfig"), { cwd: CANONICAL_PROJECT_ROOT, home: CANONICAL_HOME });
		const verdict = classifyPathWrite(canonical, FACTS);
		expect(verdict.kind).toBe("block");
		if (verdict.kind === "block") {
			expect(verdict.reason).toContain("global git config");
			expect(verdict.reason).not.toContain("resolves outside the project root");
		}
	});

	it("an ordinary write inside the (canonicalised, backslash-native) project root is still allowed", () => {
		const canonical = canonicalisePathArg(arg("src/index.ts"), { cwd: CANONICAL_PROJECT_ROOT, home: CANONICAL_HOME });
		const verdict = classifyPathWrite(canonical, FACTS);
		expect(
			verdict.kind,
			"a genuinely backslash-native home/project-root pair, once correctly canonicalised, must not " +
				"over-block an ordinary in-project write -- the false-positive half of the same property",
		).toBe("allow");
	});
});

describe("classifyReadGlob", () => {
	const glob = (raw: string) => classifyReadGlob(canonicalisePathArg(arg(raw), ctx()), READ_FACTS).kind;

	it.each([".en?", ".env*", "~/.aws/cred*", "~/.ssh/*", "~/.aw*/credentials", ".env.{local,prod}", ".[e]nv"])("blocks %s", (raw) => {
		expect(glob(raw)).toBe("block");
	});

	it.each(["*.md", "src/*.ts", "docs/**/*.md"])("allows %s", (raw) => {
		expect(glob(raw)).toBe("allow");
	});

	it("falls back to the literal path classifier when there is no metacharacter", () => {
		expect(glob(".env")).toBe("block");
		expect(glob("README.md")).toBe("allow");
	});
});

describe("classifyPathWrite asks for extension code instead of allowing it", () => {
	const facts: PathPolicyFacts = { projectRoot: "C:/repo", home: "C:/Users/tester" };
	it.each([
		["C:/repo/.pi/extensions/safety/index.ts", "ask"],
		["C:/repo/.pi/extensions/new/index.ts", "ask"],
		["C:/repo/.pi/npm/node_modules/x/index.js", "ask"],
		["C:/repo/.pi/prompts/x.md", "allow"],
		["C:/repo/src/extensions/x.ts", "allow"],
		["C:/Users/tester/.pi/agent/extensions/ky-safety/index.ts", "block"],
	])("%s -> %s", (path, expected) => {
		expect(classifyPathWrite(path, facts).kind).toBe(expected);
	});

	it("asks under home only when the project is home", () => {
		const home: PathPolicyFacts = { projectRoot: "C:/Users/tester", home: "C:/Users/tester" };
		expect(classifyPathWrite("C:/Users/tester/.pi/agent/extensions/subagent/config.json", home).kind).toBe("ask");
		expect(classifyPathWrite("C:/Users/tester/.pi/agent/models.json", home).kind).toBe("ask");
	});
});

describe("classifyPathWrite treats a core.hooksPath directory as git hooks", () => {
	it("blocks a write under the configured hooks path and allows its neighbours", () => {
		const facts: PathPolicyFacts = { projectRoot: "C:/repo", home: "C:/Users/tester", hooksPaths: ["C:/repo/tools/hooks"] };
		expect(classifyPathWrite("C:/repo/tools/hooks/pre-push", facts).kind).toBe("block");
		expect(classifyPathWrite("C:/repo/tools/other.sh", facts).kind).toBe("allow");
	});
});
