/**
 * Six syntax-only, pure AST rules (never regex, never a Program); a parse failure never throws. Registers nothing.
 * Do not spell the task-marker tokens or the tool-registration call in comments: ruleShippedTodo and contributing-boundary.test.ts scan them.
 */
import * as ts from "typescript";

/** One file handed to the rules, already read off disk by the (impure) caller. */
export interface QualitySource {
	readonly path: string;
	readonly text: string;
}

/** The six rule ids; a const tuple so a new id is a compile error where unhandled. */
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

/** Prefix exempt from every rule: the seeded-defect corpus is made of the shapes the rules detect. */
export const SCAN_EXEMPT_PREFIXES = ["tests/fixtures/"] as const;

/**
 * `// quality-allow:<rule-id> — <reason>` on the finding's line or the line above suppresses that rule.
 * A bare `// quality-allow:shipped-todo` with no reason after the em dash does not suppress.
 */
export const SUPPRESSION_MARKER = "quality-allow:";

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
	return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function parse(source: QualitySource): ts.SourceFile {
	// setParentNodes: every rule climbs .parent.
	return ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
}

/** Smallest counting numbers plus 100/1000 for percentages and byte magnitudes; deliberately not widened. */
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

/** True for a const initialiser, including nested object/array/paren wrappers (the named-constant shape). */
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
 * Flags a non-declaration literal that repeats 2+ times in the file or is compared directly to a call result.
 * Excluded: const initialisers, enum values, 0/1 indexes, -1, and MAGIC_NUMBER_ALLOWLIST.
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

/** Warning tier: a parameter-vs-literal if/switch looks identical to a legitimate dispatch table; a human must judge. */
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
					// Nested functions are visited on their own with their own parameters.
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

/** Named so this file passes its own magic-number rule. */
export const COPY_PASTE_MIN_STATEMENTS = 12;

/** Identifiers collapse to "ID" and literals to "LIT"; statement structure must still match exactly. */
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

/** Two blocks with identical normalised signatures and at least COPY_PASTE_MIN_STATEMENTS statements each. */
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

/** Marker that excuses a swallowed catch (as in safety/audit.ts writeAuditRow). */
export const NEVER_THROWS_MARKERS = ["NEVER THROWS", "never throws"] as const;

function commentTextNear(node: ts.Node, fullText: string): string {
	const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];
	return ranges.map((range) => fullText.slice(range.pos, range.end)).join("\n");
}

/** Checks leading comments up to and including the nearest enclosing function; outer scopes do not count. */
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

/** Empty or bare-return catch, flagged unless a NEVER_THROWS_MARKERS marker leads the catch or its enclosing function. */
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

const SHIPPED_TODO_TOKENS = ["TODO", "FIXME", "XXX", "HACK"] as const;

const SHIPPED_TODO_PATTERN = /\b(TODO|FIXME|XXX|HACK)\b/;

/** Scans comment trivia only, so the word inside a string literal or fixture is not flagged. */
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
	// A trailing comment at EOF sits in the EndOfFileToken's leading trivia, which the walk skips.
	checkRanges(ts.getLeadingCommentRanges(fullText, sourceFile.endOfFileToken.getFullStart()));

	return findings;
}

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

/** Warning tier: cannot tell a legitimate per-item call (one pi.exec per worktree) from a real N+1. */
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

/** Valid only with a non-empty reason after the em dash, on the finding's line or the line above. */
function isSuppressed(source: QualitySource, ruleId: RuleId, line: number): boolean {
	const lines = source.text.split("\n");
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

/** Runs all six rules over non-exempt sources, drops suppressed findings, sorts by path then line. */
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
