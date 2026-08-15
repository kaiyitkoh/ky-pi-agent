/**
 * QUAL-01 — six deterministic anti-pattern rule classes, syntax-only.
 *
 * PURPOSE. Six named detectors — magic numbers where a constant belongs,
 * special-casing on a literal input value, copy-paste duplication, swallowed
 * exceptions, a shipped task-marker comment standing in for a real fix, and
 * N+1 query shapes — each walking a real TypeScript syntax tree, never
 * matching regex over source text. This is the deterministic stage's only
 * genuinely new detection capability (08-CONTEXT.md); everything else in
 * GATE-01's four legs already existed before this phase.
 *
 * NOTE ON THIS FILE'S OWN VOCABULARY. This module deliberately never spells
 * the four literal task-marker tokens {@link SHIPPED_TODO_TOKENS} matches
 * inside a comment, anywhere in its own prose — doing so would make
 * `ruleShippedTodo` flag this file's own documentation of itself when this
 * module is swept as ordinary `.pi/extensions/` source (Group D's own false-
 * positive sweep caught this on the first run; see `08-02-SUMMARY.md`).
 *
 * ---------------------------------------------------------------------------
 * WHY THE TYPESCRIPT COMPILER API, AND WHY SYNTAX-ONLY
 * ---------------------------------------------------------------------------
 * `typescript@5.9.3` is already a pinned devDependency and already in the
 * tool path via `tsc --noEmit` — using it for QUAL-01 costs zero new
 * supply-chain surface, on a machine `08-CONTEXT.md` establishes is holding
 * live static IAM admin credentials in plaintext. `tests/unit/pinning.test.ts`
 * asserts `devDependencies` is EXACTLY six audited pins; a new lint or
 * `ast-grep` package fails that assertion outright and demands a full Package
 * Legitimacy Audit this phase has no reason to trigger.
 *
 * Every rule below parses with `ts.createSourceFile` and walks with
 * `ts.forEachChild` — never `String.match`, never a hand-rolled tokenizer.
 * Phase 4 already paid for the alternative the expensive way: an exact-string
 * `tool_call` guard was defeated by `git.exe push`, a trivial rename no
 * string match can see through. A real syntax tree does not have that
 * failure mode.
 *
 * These rules deliberately never build a `ts.Program` and never touch the
 * type checker (`ts.createProgram`, `getTypeChecker`, anything requiring a
 * resolved module graph). A `ts.SourceFile` from `ts.createSourceFile` is
 * cheap — parsing one file costs nothing like type-checking a whole program
 * — which is QUAL-02's wall-clock claim made structurally true rather than
 * merely asserted.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT PROVE
 * ---------------------------------------------------------------------------
 * Syntax-only means no type information reaches any rule here: no rule can
 * know what a value IS, only how it is WRITTEN. `ruleMagicNumber` cannot tell
 * a `number` from a `bigint` from an opaque branded type; `ruleNPlusOne`
 * cannot tell a real database call from a same-named local function; a parse
 * failure on a syntactically invalid source degrades to whatever partial
 * tree `ts.createSourceFile` recovers — it never throws (T-08-04) — so a rule
 * run against broken input returns whatever findings survive the recovery,
 * never an exception. Two of the six rules below (`literal-special-case`,
 * `n-plus-one`) are honestly undecidable without type information or a real
 * call graph, which is why they ship at WARNING tier and can never fail a
 * build on their own — see each rule's own docstring for its specific
 * false-positive scope, and `08-RESEARCH.md` Pitfall 2 for why a naive
 * reading of these six patterns would drown this repository's own house
 * style in false positives (a documented `catch { return undefined; }`, a
 * named byte constant, a legitimate one-`pi.exec`-per-worktree loop).
 *
 * ---------------------------------------------------------------------------
 * PURITY
 * ---------------------------------------------------------------------------
 * This module is PURE: it takes `{ path, text }[]` and returns findings. It
 * never touches `ctx`, never reads a file itself, never spawns anything. The
 * caller — a future `/quick`-adjacent gate module, not built in this plan —
 * owns reading files off disk and handing this module their contents.
 *
 * BOUNDARY RULE (BOOT-10). This module registers nothing. It does not spell
 * the tool-registration call, in code or in prose —
 * `tests/unit/contributing-boundary.test.ts` matches that name as a plain
 * substring across every tracked source under `.pi/extensions/`.
 */
import * as ts from "typescript";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** One file handed to the rules, already read off disk by the (impure) caller. */
export interface QualitySource {
	readonly path: string;
	readonly text: string;
}

/**
 * The six rule ids, in the order `08-02-PLAN.md` names them.
 *
 * A `const` tuple with a derived union type, so a new rule id is a compile
 * error everywhere it is not also added — the same discipline
 * `OUTCOME_BY_STOP_REASON` in `diagnostics/schema.ts` uses for `StopReason`.
 */
export const RULE_IDS = [
	"magic-number",
	"literal-special-case",
	"copy-paste",
	"swallowed-exception",
	"shipped-todo",
	"n-plus-one",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/** One offending shape, found by one rule, at one line of one file. */
export interface QualityFinding {
	readonly ruleId: RuleId;
	readonly path: string;
	readonly line: number;
	readonly tier: "error" | "warning";
	readonly message: string;
}

/**
 * Paths whose repo-relative prefix is exempt from every rule.
 *
 * `tests/fixtures/` holds plan 08-10's seeded-defect corpus, which is BY
 * CONSTRUCTION made of the exact shapes these six rules detect — a shipped
 * task-marker comment, a swallowed exception, a copy-pasted block. Scanning
 * that directory
 * would make the corpus un-shippable the moment this module exists
 * (`08-RESEARCH.md` Known Threat Patterns, last row). Exemption is by path
 * prefix, never by content, so the corpus stays legible as real offending
 * TypeScript rather than needing every fixture individually suppressed.
 */
export const SCAN_EXEMPT_PREFIXES = ["tests/fixtures/"] as const;

/**
 * The suppression comment prefix.
 *
 * `// quality-allow:<rule-id> — <reason>`, on the offending line or the line
 * immediately above it, suppresses exactly that rule id at that line — and
 * ONLY when a non-empty reason follows the em dash. A bare
 * `// quality-allow:shipped-todo` with nothing after it does not suppress:
 * an unreasoned suppression is indistinguishable from a suppression nobody
 * meant to write, and this module must not treat "typed the marker" as
 * "justified the marker".
 */
export const SUPPRESSION_MARKER = "quality-allow:";

// ---------------------------------------------------------------------------
// Shared AST helpers
// ---------------------------------------------------------------------------

/** 1-indexed line number for a source position, matching every other JSONL/finding convention in this repo. */
function lineOf(sourceFile: ts.SourceFile, pos: number): number {
	return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function parse(source: QualitySource): ts.SourceFile {
	// setParentNodes: true — every rule below climbs `.parent` to decide
	// declaration position, enclosing function or nearby comments; without it
	// `.parent` is undefined everywhere and every ancestor walk below is dead.
	return ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
}

// ---------------------------------------------------------------------------
// Rule: magic-number (tier: error)
// ---------------------------------------------------------------------------

/**
 * Values excluded from `magic-number` regardless of position.
 *
 * `0`/`1`/`2` are the smallest counting numbers (empty/singular/pair — the
 * shapes every loop and conditional in ordinary code already carries),
 * `100`/`1000` are the two round numbers this repository's own style uses
 * for percentages and byte-order-of-magnitude comments without naming a
 * constant. This is the documented, deliberate allowlist QUAL-01's own task
 * text calls for — not an attempt to reach zero findings by widening it
 * further (`08-RESEARCH.md` Pitfall 2's explicit warning).
 */
const MAGIC_NUMBER_ALLOWLIST = new Set([0, 1, 2, 100, 1000]);

const COMPARISON_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.EqualsEqualsToken,
	ts.SyntaxKind.EqualsEqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsToken,
	ts.SyntaxKind.ExclamationEqualsEqualsToken,
	ts.SyntaxKind.LessThanToken,
	ts.SyntaxKind.GreaterThanToken,
	ts.SyntaxKind.LessThanEqualsToken,
	ts.SyntaxKind.GreaterThanEqualsToken,
]);

function collectNumericLiterals(sourceFile: ts.SourceFile): ts.NumericLiteral[] {
	const found: ts.NumericLiteral[] = [];
	function visit(node: ts.Node): void {
		if (ts.isNumericLiteral(node)) {
			found.push(node);
		}
		ts.forEachChild(node, visit);
	}
	ts.forEachChild(sourceFile, visit);
	return found;
}

/**
 * True when `node` sits in a `const`-declaration position: the initialiser
 * of a `const` variable, or nested inside an object/array literal (or
 * parenthesised expression) that is itself, transitively, that initialiser.
 *
 * This is the `WIRE_ROTATE_BYTES = 32_000_000` shape — `diagnostics/schema.ts`
 * names its own byte constants exactly this way — and this rule must not
 * flag a named constant's own initialiser (this plan's own `read_first`
 * instruction).
 */
function isConstDeclarationPosition(node: ts.NumericLiteral): boolean {
	let current: ts.Node = node;
	let parent: ts.Node | undefined = node.parent;
	while (parent !== undefined) {
		if (ts.isVariableDeclaration(parent)) {
			if (parent.initializer !== current) {
				return false;
			}
			const list = parent.parent;
			return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
		}
		if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
			current = parent;
			parent = parent.parent;
			continue;
		}
		if (ts.isObjectLiteralExpression(parent) || ts.isArrayLiteralExpression(parent) || ts.isParenthesizedExpression(parent)) {
			current = parent;
			parent = parent.parent;
			continue;
		}
		return false;
	}
	return false;
}

function isEnumMemberValue(node: ts.NumericLiteral): boolean {
	const parent = node.parent;
	return parent !== undefined && ts.isEnumMember(parent) && parent.initializer === node;
}

/** `arr[0]` / `arr[1]` — the two index literals ordinary array access uses constantly. */
function isSmallArrayIndex(node: ts.NumericLiteral): boolean {
	if (node.text !== "0" && node.text !== "1") {
		return false;
	}
	const parent = node.parent;
	return parent !== undefined && ts.isElementAccessExpression(parent) && parent.argumentExpression === node;
}

/** `-1` parses as a `PrefixUnaryExpression` around the literal `1`, never a literal `-1` of its own. */
function isNegativeOne(node: ts.NumericLiteral): boolean {
	if (node.text !== "1") {
		return false;
	}
	const parent = node.parent;
	return (
		parent !== undefined &&
		ts.isPrefixUnaryExpression(parent) &&
		parent.operator === ts.SyntaxKind.MinusToken &&
		parent.operand === node
	);
}

function isAllowlistedValue(node: ts.NumericLiteral): boolean {
	return MAGIC_NUMBER_ALLOWLIST.has(Number(node.text));
}

/** `someCall() > 37` — a literal compared directly against a call's result, never bound to a name. */
function isComparedAgainstCallResult(node: ts.NumericLiteral): boolean {
	const parent = node.parent;
	if (parent === undefined || !ts.isBinaryExpression(parent)) {
		return false;
	}
	if (!COMPARISON_OPERATORS.has(parent.operatorToken.kind)) {
		return false;
	}
	const other = parent.left === node ? parent.right : parent.right === node ? parent.left : undefined;
	return other !== undefined && ts.isCallExpression(other);
}

/**
 * `magic-number` (tier: error).
 *
 * Fires on a `ts.NumericLiteral` in a non-declaration position when either:
 *   (a) the same literal text appears 2+ times in the file, or
 *   (b) the literal is a direct comparison operand against a call's result.
 *
 * Excluded, regardless of (a)/(b): a `const` declaration's own initialiser
 * (including nested inside an object/array literal that IS that
 * initialiser), an enum member's value, the array-index literals `0`/`1`,
 * `-1`, and the deliberate `{0, 1, 2, 100, 1000}` allowlist.
 */
export function ruleMagicNumber(source: QualitySource): QualityFinding[] {
	const sourceFile = parse(source);
	const literals = collectNumericLiterals(sourceFile);
	const candidates = literals.filter(
		(n) =>
			!isAllowlistedValue(n) &&
			!isConstDeclarationPosition(n) &&
			!isEnumMemberValue(n) &&
			!isSmallArrayIndex(n) &&
			!isNegativeOne(n),
	);

	const findings: QualityFinding[] = [];

	const byValue = new Map<string, ts.NumericLiteral[]>();
	for (const literal of candidates) {
		const list = byValue.get(literal.text) ?? [];
		list.push(literal);
		byValue.set(literal.text, list);
	}
	for (const [value, nodes] of byValue) {
		if (nodes.length < 2) {
			continue;
		}
		for (const node of nodes) {
			findings.push({
				ruleId: "magic-number",
				path: source.path,
				line: lineOf(sourceFile, node.getStart(sourceFile)),
				tier: "error",
				message: `literal ${value} appears ${nodes.length} times in this file with no named constant`,
			});
		}
	}

	for (const literal of candidates) {
		if (isComparedAgainstCallResult(literal)) {
			findings.push({
				ruleId: "magic-number",
				path: source.path,
				line: lineOf(sourceFile, literal.getStart(sourceFile)),
				tier: "error",
				message: `literal ${literal.text} is compared directly against a call result instead of a named constant`,
			});
		}
	}

	return findings;
}

// ---------------------------------------------------------------------------
// Rule: literal-special-case (tier: warning — only partially decidable)
// ---------------------------------------------------------------------------

const EQUALITY_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.EqualsEqualsToken,
	ts.SyntaxKind.EqualsEqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsToken,
	ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

function isFunctionLikeNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node)
	);
}

function functionParamNames(fn: ts.FunctionLikeDeclaration): Set<string> {
	const names = new Set<string>();
	for (const param of fn.parameters) {
		if (ts.isIdentifier(param.name)) {
			names.add(param.name.text);
		}
	}
	return names;
}

/**
 * `literal-special-case` (tier: warning — only partially decidable).
 *
 * An `if`/`switch` whose test compares a PARAMETER identifier against a
 * string or numeric literal, inside the function that parameter belongs to.
 *
 * THIS CANNOT DISTINGUISH A LEGITIMATE DISPATCH TABLE FROM AN AD HOC SPECIAL
 * CASE, and that is exactly why it ships at WARNING tier and can never fail a
 * build on its own. A `switch (event.type) { case "click": ...; case "scroll": ... }` is
 * ordinary, correct dispatch; syntactically it is identical in shape to a
 * parameter special-cased for one caller's convenience. Only a human, or a
 * model reviewer with the surrounding intent, can tell the two apart.
 */
export function ruleLiteralSpecialCase(source: QualitySource): QualityFinding[] {
	const sourceFile = parse(source);
	const findings: QualityFinding[] = [];

	function visitFunction(fn: ts.FunctionLikeDeclaration): void {
		const params = functionParamNames(fn);
		if (params.size === 0 || fn.body === undefined) {
			return;
		}

		function checkComparison(expr: ts.BinaryExpression, atPos: number): void {
			if (!EQUALITY_OPERATORS.has(expr.operatorToken.kind)) {
				return;
			}
			let identSide: ts.Identifier | undefined;
			let literalSide: ts.Expression | undefined;
			if (ts.isIdentifier(expr.left) && params.has(expr.left.text)) {
				identSide = expr.left;
				literalSide = expr.right;
			} else if (ts.isIdentifier(expr.right) && params.has(expr.right.text)) {
				identSide = expr.right;
				literalSide = expr.left;
			}
			if (identSide === undefined || literalSide === undefined) {
				return;
			}
			if (!ts.isStringLiteralLike(literalSide) && !ts.isNumericLiteral(literalSide)) {
				return;
			}
			findings.push({
				ruleId: "literal-special-case",
				path: source.path,
				line: lineOf(sourceFile, atPos),
				tier: "warning",
				message:
					`if-statement special-cases parameter "${identSide.text}" against literal ` +
					`${literalSide.getText(sourceFile)} — this may be a legitimate dispatch, not a hack; a human ` +
					"or reviewer must judge",
			});
		}

		function visitBody(node: ts.Node): void {
			if (node !== fn && isFunctionLikeNode(node)) {
				// A nested function is visited independently when the top-level
				// walk reaches it — its own parameters, not this function's, are
				// what matter inside it.
				return;
			}
			if (ts.isIfStatement(node) && ts.isBinaryExpression(node.expression)) {
				checkComparison(node.expression, node.getStart(sourceFile));
			}
			if (ts.isSwitchStatement(node) && ts.isIdentifier(node.expression) && params.has(node.expression.text)) {
				for (const clause of node.caseBlock.clauses) {
					if (ts.isCaseClause(clause) && (ts.isStringLiteralLike(clause.expression) || ts.isNumericLiteral(clause.expression))) {
						findings.push({
							ruleId: "literal-special-case",
							path: source.path,
							line: lineOf(sourceFile, clause.getStart(sourceFile)),
							tier: "warning",
							message:
								`switch on parameter "${node.expression.text}" special-cases literal ` +
								`${clause.expression.getText(sourceFile)} — this may be a legitimate dispatch table, ` +
								"not a hack; a human or reviewer must judge",
						});
					}
				}
			}
			ts.forEachChild(node, visitBody);
		}

		visitBody(fn.body);
	}

	function visitTop(node: ts.Node): void {
		if (isFunctionLikeNode(node)) {
			visitFunction(node);
		}
		ts.forEachChild(node, visitTop);
	}

	ts.forEachChild(sourceFile, visitTop);
	return findings;
}

// ---------------------------------------------------------------------------
// Rule: copy-paste (tier: error)
// ---------------------------------------------------------------------------

/**
 * The duplication threshold, named per this rule's own docstring requirement
 * to dogfood `ruleMagicNumber` — a bare `12` in the walk below would be
 * exactly the anti-pattern this file's sibling rule exists to catch.
 */
export const COPY_PASTE_MIN_STATEMENTS = 12;

/**
 * A normalised token-kind sequence for `block`'s statements: every
 * `Identifier`/`PrivateIdentifier` collapses to `"ID"` and every numeric or
 * string literal collapses to `"LIT"`, so a renamed, re-valued copy of the
 * same structure still produces an identical signature. Everything else is
 * the raw `SyntaxKind` number, so the STRUCTURE — statement shapes, operator
 * choices, nesting — must still match exactly.
 */
function normalizeBlockSignature(block: ts.Block): string {
	const tokens: string[] = [];
	function visit(node: ts.Node): void {
		if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
			tokens.push("ID");
			return;
		}
		if (ts.isNumericLiteral(node) || ts.isStringLiteralLike(node)) {
			tokens.push("LIT");
			return;
		}
		tokens.push(String(node.kind));
		ts.forEachChild(node, visit);
	}
	for (const stmt of block.statements) {
		visit(stmt);
	}
	return tokens.join(",");
}

/**
 * `copy-paste` (tier: error).
 *
 * Two `ts.Block` nodes in the same source whose normalised signature
 * (see {@link normalizeBlockSignature}) is identical, and which carry at
 * least {@link COPY_PASTE_MIN_STATEMENTS} statements each. Renamed copies
 * still match because identifiers and literal values are dropped before
 * comparison — only the STRUCTURE is compared.
 */
export function ruleCopyPaste(source: QualitySource): QualityFinding[] {
	const sourceFile = parse(source);
	const blocks: ts.Block[] = [];
	function collect(node: ts.Node): void {
		if (ts.isBlock(node) && node.statements.length >= COPY_PASTE_MIN_STATEMENTS) {
			blocks.push(node);
		}
		ts.forEachChild(node, collect);
	}
	ts.forEachChild(sourceFile, collect);

	const bySignature = new Map<string, ts.Block[]>();
	for (const block of blocks) {
		const signature = normalizeBlockSignature(block);
		const list = bySignature.get(signature) ?? [];
		list.push(block);
		bySignature.set(signature, list);
	}

	const findings: QualityFinding[] = [];
	for (const group of bySignature.values()) {
		if (group.length < 2) {
			continue;
		}
		for (const block of group) {
			findings.push({
				ruleId: "copy-paste",
				path: source.path,
				line: lineOf(sourceFile, block.getStart(sourceFile)),
				tier: "error",
				message:
					`this block duplicates another block of at least ${COPY_PASTE_MIN_STATEMENTS} statements ` +
					"elsewhere in this file, differing only in identifier names and literal values",
			});
		}
	}
	return findings;
}

// ---------------------------------------------------------------------------
// Rule: swallowed-exception (tier: error)
// ---------------------------------------------------------------------------

/**
 * The NEVER-THROWS contract marker this repository's own house style already
 * uses — `safety/audit.ts`'s `writeAuditRow` and `workflows/evidence.ts`'s
 * `writeEvidenceRow` both document `catch { return undefined; }` this way on
 * purpose, and this rule must not flag either.
 */
export const NEVER_THROWS_MARKERS = ["NEVER THROWS", "never throws"] as const;

function commentTextNear(node: ts.Node, fullText: string): string {
	const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];
	return ranges.map((range) => fullText.slice(range.pos, range.end)).join("\n");
}

/**
 * True when `catchClause`, an ancestor up to and including its nearest
 * enclosing function, carries a leading comment naming a
 * {@link NEVER_THROWS_MARKERS} marker. Stops climbing once the enclosing
 * function-like node's own comment has been checked — a marker on some
 * unrelated outer scope does not count.
 */
function hasNeverThrowsMarker(catchClause: ts.CatchClause, sourceFile: ts.SourceFile): boolean {
	const fullText = sourceFile.getFullText();
	let current: ts.Node | undefined = catchClause;
	while (current !== undefined) {
		const text = commentTextNear(current, fullText);
		if (NEVER_THROWS_MARKERS.some((marker) => text.includes(marker))) {
			return true;
		}
		if (isFunctionLikeNode(current)) {
			return false;
		}
		current = current.parent;
	}
	return false;
}

/** Empty, or a bare `return;`/`return undefined;` — a catch that discards the exception with no trace. */
function isSwallowingBlock(block: ts.Block): boolean {
	if (block.statements.length === 0) {
		return true;
	}
	if (block.statements.length === 1) {
		const stmt = block.statements[0];
		if (ts.isReturnStatement(stmt)) {
			if (stmt.expression === undefined) {
				return true;
			}
			if (ts.isIdentifier(stmt.expression) && stmt.expression.text === "undefined") {
				return true;
			}
		}
	}
	return false;
}

/**
 * `swallowed-exception` (tier: error).
 *
 * A `ts.CatchClause` whose block is empty, or whose sole statement is a bare
 * `return`/`return undefined`, UNLESS a {@link NEVER_THROWS_MARKERS} marker
 * appears in a leading comment on the catch clause or its enclosing function.
 * This is the false-positive that matters most in this codebase: `evidence.ts`
 * and `safety/audit.ts` both ship this exact shape on purpose, and both
 * document it this way.
 */
export function ruleSwallowedException(source: QualitySource): QualityFinding[] {
	const sourceFile = parse(source);
	const findings: QualityFinding[] = [];
	function visit(node: ts.Node): void {
		if (ts.isCatchClause(node) && isSwallowingBlock(node.block) && !hasNeverThrowsMarker(node, sourceFile)) {
			findings.push({
				ruleId: "swallowed-exception",
				path: source.path,
				line: lineOf(sourceFile, node.getStart(sourceFile)),
				tier: "error",
				message: "this catch clause discards the exception with no NEVER THROWS contract documented nearby",
			});
		}
		ts.forEachChild(node, visit);
	}
	ts.forEachChild(sourceFile, visit);
	return findings;
}

// ---------------------------------------------------------------------------
// Rule: shipped-todo (tier: error)
// ---------------------------------------------------------------------------

const SHIPPED_TODO_TOKENS = ["TODO", "FIXME", "XXX", "HACK"] as const;

/** A regex LITERAL, never `new RegExp(...)` — applied only to an already-extracted comment substring, never the whole source. */
const SHIPPED_TODO_PATTERN = /\b(TODO|FIXME|XXX|HACK)\b/;

/**
 * `shipped-todo` (tier: error).
 *
 * A token from {@link SHIPPED_TODO_TOKENS} found inside a COMMENT trivia
 * range, obtained via `ts.getLeadingCommentRanges`/`getTrailingCommentRanges`
 * — never a substring scan of the whole file text, which would also flag the
 * word sitting inside a string literal (a legitimate negative fixture this
 * rule must not trip on) or inside this very module's own docstrings.
 */
export function ruleShippedTodo(source: QualitySource): QualityFinding[] {
	const sourceFile = parse(source);
	const fullText = sourceFile.getFullText();
	const findings: QualityFinding[] = [];
	const seen = new Set<number>();

	function checkRanges(ranges: readonly ts.CommentRange[] | undefined): void {
		for (const range of ranges ?? []) {
			if (seen.has(range.pos)) {
				continue;
			}
			seen.add(range.pos);
			const text = fullText.slice(range.pos, range.end);
			const match = SHIPPED_TODO_PATTERN.exec(text);
			if (match !== null) {
				findings.push({
					ruleId: "shipped-todo",
					path: source.path,
					line: lineOf(sourceFile, range.pos),
					tier: "error",
					message: `comment carries a shipped ${match[1]} marker instead of a tracked follow-up`,
				});
			}
		}
	}

	function visit(node: ts.Node): void {
		checkRanges(ts.getLeadingCommentRanges(fullText, node.getFullStart()));
		checkRanges(ts.getTrailingCommentRanges(fullText, node.getEnd()));
		ts.forEachChild(node, visit);
	}
	ts.forEachChild(sourceFile, visit);
	// A trailing comment at end-of-file attaches only to the EndOfFileToken's
	// own leading trivia, which the statement-level walk above never visits.
	checkRanges(ts.getLeadingCommentRanges(fullText, sourceFile.endOfFileToken.getFullStart()));

	return findings;
}

// ---------------------------------------------------------------------------
// Rule: n-plus-one (tier: warning — only partially decidable)
// ---------------------------------------------------------------------------

/**
 * Callee names treated as a likely per-item data call. Caller-tunable in
 * spirit (a future gate module could accept an override), but exported as a
 * plain constant here because every rule function in this module takes only
 * `(source: QualitySource)` — see the module's own task text.
 */
export const N_PLUS_ONE_CALLEES = ["query", "exec", "fetch", "findMany", "get"] as const;

function calleeName(expr: ts.LeftHandSideExpression): string | undefined {
	if (ts.isIdentifier(expr)) {
		return expr.text;
	}
	if (ts.isPropertyAccessExpression(expr)) {
		return expr.name.text;
	}
	return undefined;
}

/** The loop-body node for a `for`/`for-of`/`for-in`/`while`/`do` statement, or a `.map(`/`.forEach(` callback body. `undefined` for anything else. */
function loopBodyOf(node: ts.Node): ts.Node | undefined {
	if (
		ts.isForStatement(node) ||
		ts.isForOfStatement(node) ||
		ts.isForInStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node)
	) {
		return node.statement;
	}
	if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
		const method = node.expression.name.text;
		if (method === "map" || method === "forEach") {
			const callback = node.arguments[0];
			if (callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
				return callback.body;
			}
		}
	}
	return undefined;
}

/**
 * `n-plus-one` (tier: warning — only partially decidable).
 *
 * An `await` expression, or a call whose callee name matches
 * {@link N_PLUS_ONE_CALLEES}, appearing syntactically inside a
 * `for`/`for-of`/`for-in`/`while`/`do`/`.map(`/`.forEach(` body.
 *
 * THE KNOWN FALSE POSITIVE THIS PROJECT ITSELF HAS: this repository's own
 * worktree tests legitimately run one `pi.exec` per worktree inside a loop,
 * because no bulk git API exists to replace it. This rule cannot distinguish
 * that from a genuine N+1 query, which is exactly why it ships at WARNING
 * tier and can never fail a build on its own.
 */
export function ruleNPlusOne(source: QualitySource): QualityFinding[] {
	const sourceFile = parse(source);
	const findings: QualityFinding[] = [];
	const flagged = new Set<number>();

	function scanBody(body: ts.Node): void {
		function visit(node: ts.Node): void {
			if (ts.isAwaitExpression(node)) {
				const pos = node.getStart(sourceFile);
				if (!flagged.has(pos)) {
					flagged.add(pos);
					findings.push({
						ruleId: "n-plus-one",
						path: source.path,
						line: lineOf(sourceFile, pos),
						tier: "warning",
						message:
							"an await inside a loop body may be an N+1 query — this rule cannot distinguish that from a " +
							"single legitimate per-item call (e.g. one pi.exec per worktree, where no bulk API exists)",
					});
				}
			}
			if (ts.isCallExpression(node)) {
				const name = calleeName(node.expression);
				if (name !== undefined && (N_PLUS_ONE_CALLEES as readonly string[]).includes(name)) {
					const pos = node.getStart(sourceFile);
					if (!flagged.has(pos)) {
						flagged.add(pos);
						findings.push({
							ruleId: "n-plus-one",
							path: source.path,
							line: lineOf(sourceFile, pos),
							tier: "warning",
							message:
								`call to "${name}" inside a loop body may be an N+1 query — this rule cannot distinguish ` +
								"that from a single legitimate per-item call",
						});
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(body);
	}

	function visitTop(node: ts.Node): void {
		const body = loopBodyOf(node);
		if (body !== undefined) {
			scanBody(body);
		}
		ts.forEachChild(node, visitTop);
	}
	ts.forEachChild(sourceFile, visitTop);
	return findings;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

const RULE_FNS: Record<RuleId, (source: QualitySource) => QualityFinding[]> = {
	"magic-number": ruleMagicNumber,
	"literal-special-case": ruleLiteralSpecialCase,
	"copy-paste": ruleCopyPaste,
	"swallowed-exception": ruleSwallowedException,
	"shipped-todo": ruleShippedTodo,
	"n-plus-one": ruleNPlusOne,
};

function isExemptPath(path: string): boolean {
	return SCAN_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * True when `source`'s text carries a valid {@link SUPPRESSION_MARKER} for
 * `ruleId` on `line` (1-indexed) or the line immediately above it, WITH a
 * non-empty reason after the em dash. A bare marker with no reason returns
 * `false` — see {@link SUPPRESSION_MARKER}'s own docstring for why an
 * unreasoned suppression does not suppress.
 */
function isSuppressed(source: QualitySource, ruleId: RuleId, line: number): boolean {
	const lines = source.text.split("\n");
	// `line` is 1-indexed; `lines[line - 1]` is that same line, `lines[line - 2]`
	// is the line above it. Both are checked so a suppression comment may sit
	// beside the offending code or directly over it.
	for (const idx of [line - 1, line - 2]) {
		const text = lines[idx];
		if (text === undefined) {
			continue;
		}
		const markerAt = text.indexOf(SUPPRESSION_MARKER);
		if (markerAt === -1) {
			continue;
		}
		const rest = text.slice(markerAt + SUPPRESSION_MARKER.length).trim();
		const idMatch = /^([a-z-]+)/.exec(rest);
		if (idMatch === null || idMatch[1] !== ruleId) {
			continue;
		}
		const afterId = rest.slice(idMatch[1].length).trim();
		if (!afterId.startsWith("—")) {
			continue;
		}
		const reason = afterId.slice("—".length).trim();
		if (reason.length > 0) {
			return true;
		}
	}
	return false;
}

/**
 * Dispatch all six rules over every non-exempt source, dropping any finding
 * a valid {@link SUPPRESSION_MARKER} suppresses, sorted by `path` then
 * `line` so output is deterministic run to run.
 */
export function runAntiPatternRules(sources: readonly QualitySource[]): QualityFinding[] {
	const findings: QualityFinding[] = [];
	for (const source of sources) {
		if (isExemptPath(source.path)) {
			continue;
		}
		for (const ruleId of RULE_IDS) {
			for (const finding of RULE_FNS[ruleId](source)) {
				if (!isSuppressed(source, ruleId, finding.line)) {
					findings.push(finding);
				}
			}
		}
	}
	return findings.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
}
