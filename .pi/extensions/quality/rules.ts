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

// A cached tree is reused only while its object still holds the same path and text.
const parsed = new WeakMap<QualitySource, ts.SourceFile>();

function parse(source: QualitySource): ts.SourceFile {
	let sourceFile = parsed.get(source);
	if (sourceFile === undefined || sourceFile.text !== source.text || sourceFile.fileName !== source.path) {
		// setParentNodes: every rule climbs .parent.
		sourceFile = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
		parsed.set(source, sourceFile);
	}
	return sourceFile;
}

/** Every descendant of `root`, depth first, excluding `root` itself. */
function descendants(root: ts.Node): ts.Node[] {
	const nodes: ts.Node[] = [];
	const visit = (node: ts.Node): void => {
		nodes.push(node);
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(root, visit);
	return nodes;
}

type Report = (pos: number, message: string) => void;

/** Parses `source` and hands `body` a reporter that records findings for one rule and tier. */
function runRule(source: QualitySource, ruleId: RuleId, tier: QualityFinding["tier"], body: (sf: ts.SourceFile, report: Report) => void): QualityFinding[] {
	const sourceFile = parse(source);
	const findings: QualityFinding[] = [];
	body(sourceFile, (pos, message) =>
		findings.push({ ruleId, path: source.path, line: sourceFile.getLineAndCharacterOfPosition(pos).line + 1, tier, message }),
	);
	return findings;
}

/** Smallest counting numbers plus 100/1000 for percentages and byte magnitudes; deliberately not widened. */
const MAGIC_NUMBER_ALLOWLIST = new Set([0, 1, 2, 100, 1000]);

const EQUALITY_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.EqualsEqualsToken,
	ts.SyntaxKind.EqualsEqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsToken,
	ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

const COMPARISON_OPERATORS = new Set<ts.SyntaxKind>([
	...EQUALITY_OPERATORS,
	ts.SyntaxKind.LessThanToken,
	ts.SyntaxKind.GreaterThanToken,
	ts.SyntaxKind.LessThanEqualsToken,
	ts.SyntaxKind.GreaterThanEqualsToken,
]);

/** True for a const initialiser, including nested object/array/paren wrappers (the named-constant shape). */
function isConstDeclarationPosition(node: ts.NumericLiteral): boolean {
	let current: ts.Node = node;
	for (let parent = node.parent; parent !== undefined; current = parent, parent = parent.parent) {
		if (ts.isVariableDeclaration(parent)) {
			const list = parent.parent;
			return parent.initializer === current && ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
		}
		const wraps =
			(ts.isPropertyAssignment(parent) && parent.initializer === current) ||
			ts.isObjectLiteralExpression(parent) ||
			ts.isArrayLiteralExpression(parent) ||
			ts.isParenthesizedExpression(parent);
		if (!wraps) return false;
	}
	return false;
}

/** Enum values, 0/1 indexes and `-1` (a `PrefixUnaryExpression` around the literal `1`) name themselves. */
function isExemptLiteral(node: ts.NumericLiteral): boolean {
	const parent = node.parent;
	if (MAGIC_NUMBER_ALLOWLIST.has(Number(node.text)) || isConstDeclarationPosition(node)) return true;
	if (ts.isEnumMember(parent) && parent.initializer === node) return true;
	const smallIndex = node.text === "0" || node.text === "1";
	if (smallIndex && ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
	return node.text === "1" && ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.MinusToken && parent.operand === node;
}

function isComparedAgainstCallResult(node: ts.NumericLiteral): boolean {
	const parent = node.parent;
	if (!ts.isBinaryExpression(parent) || !COMPARISON_OPERATORS.has(parent.operatorToken.kind)) return false;
	const other = parent.left === node ? parent.right : parent.right === node ? parent.left : undefined;
	return other !== undefined && ts.isCallExpression(other);
}

/** First-seen key order, which the findings inherit. */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const group = groups.get(k);
		if (group === undefined) groups.set(k, [item]);
		else group.push(item);
	}
	return groups;
}

/**
 * Flags a non-declaration literal that repeats 2+ times in the file or is compared directly to a call result.
 * Excluded: const initialisers, enum values, 0/1 indexes, -1, and MAGIC_NUMBER_ALLOWLIST.
 */
export function ruleMagicNumber(source: QualitySource): QualityFinding[] {
	return runRule(source, "magic-number", "error", (sf, report) => {
		const candidates = descendants(sf).filter(ts.isNumericLiteral).filter((n) => !isExemptLiteral(n));
		for (const [value, nodes] of groupBy(candidates, (n) => n.text)) {
			if (nodes.length < 2) continue;
			for (const node of nodes) report(node.getStart(sf), `literal ${value} appears ${nodes.length} times in this file with no named constant`);
		}
		for (const literal of candidates.filter(isComparedAgainstCallResult)) {
			report(literal.getStart(sf), `literal ${literal.text} is compared directly against a call result instead of a named constant`);
		}
	});
}

function isFunctionLikeNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
	return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

const isLiteral = (node: ts.Node): node is ts.StringLiteralLike | ts.NumericLiteral => ts.isStringLiteralLike(node) || ts.isNumericLiteral(node);

/** Warning tier: a parameter-vs-literal if/switch looks identical to a legitimate dispatch table; a human must judge. */
export function ruleLiteralSpecialCase(source: QualitySource): QualityFinding[] {
	return runRule(source, "literal-special-case", "warning", (sf, report) => {
		for (const fn of descendants(sf).filter(isFunctionLikeNode)) {
			const params = new Set(fn.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : [])));
			if (params.size === 0 || fn.body === undefined) continue;
			const isParam = (node: ts.Node): node is ts.Identifier => ts.isIdentifier(node) && params.has(node.text);

			const visitBody = (node: ts.Node): void => {
				// Nested functions are visited on their own with their own parameters; `node` is never `fn` itself.
				if (isFunctionLikeNode(node)) return;
				if (ts.isIfStatement(node) && ts.isBinaryExpression(node.expression) && EQUALITY_OPERATORS.has(node.expression.operatorToken.kind)) {
					const { left, right } = node.expression;
					const [ident, literal] = isParam(left) ? [left, right] : isParam(right) ? [right, left] : [undefined, undefined];
					if (ident !== undefined && isLiteral(literal)) {
						report(
							node.getStart(sf),
							`if-statement special-cases parameter "${ident.text}" against literal ${literal.getText(sf)} — this may be a ` +
								"legitimate dispatch, not a hack; a human or reviewer must judge",
						);
					}
				}
				if (ts.isSwitchStatement(node) && isParam(node.expression)) {
					for (const clause of node.caseBlock.clauses) {
						if (!ts.isCaseClause(clause) || !isLiteral(clause.expression)) continue;
						report(
							clause.getStart(sf),
							`switch on parameter "${node.expression.text}" special-cases literal ${clause.expression.getText(sf)} — this may ` +
								"be a legitimate dispatch table, not a hack; a human or reviewer must judge",
						);
					}
				}
				ts.forEachChild(node, visitBody);
			};
			visitBody(fn.body);
		}
	});
}

/** Named so this file passes its own magic-number rule. */
export const COPY_PASTE_MIN_STATEMENTS = 12;

/** Identifiers collapse to "ID" and literals to "LIT"; statement structure must still match exactly. */
function normalizeBlockSignature(block: ts.Block): string {
	const tokens: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) tokens.push("ID");
		else if (isLiteral(node)) tokens.push("LIT");
		else {
			tokens.push(String(node.kind));
			ts.forEachChild(node, visit);
		}
	};
	block.statements.forEach(visit);
	return tokens.join(",");
}

/** Two blocks with identical normalised signatures and at least COPY_PASTE_MIN_STATEMENTS statements each. */
export function ruleCopyPaste(source: QualitySource): QualityFinding[] {
	return runRule(source, "copy-paste", "error", (sf, report) => {
		const blocks = descendants(sf).filter((n): n is ts.Block => ts.isBlock(n) && n.statements.length >= COPY_PASTE_MIN_STATEMENTS);
		for (const group of groupBy(blocks, normalizeBlockSignature).values()) {
			if (group.length < 2) continue;
			for (const block of group) {
				report(
					block.getStart(sf),
					`this block duplicates another block of at least ${COPY_PASTE_MIN_STATEMENTS} statements ` +
						"elsewhere in this file, differing only in identifier names and literal values",
				);
			}
		}
	});
}

/** Marker that excuses a swallowed catch (as in safety/audit.ts writeAuditRow). */
export const NEVER_THROWS_MARKERS = ["NEVER THROWS", "never throws"] as const;

/** Checks leading comments up to and including the nearest enclosing function; outer scopes do not count. */
function hasNeverThrowsMarker(catchClause: ts.CatchClause, sourceFile: ts.SourceFile): boolean {
	const fullText = sourceFile.getFullText();
	for (let current: ts.Node | undefined = catchClause; current !== undefined; current = current.parent) {
		const ranges = ts.getLeadingCommentRanges(fullText, current.getFullStart()) ?? [];
		const text = ranges.map((range) => fullText.slice(range.pos, range.end)).join("\n");
		if (NEVER_THROWS_MARKERS.some((marker) => text.includes(marker))) return true;
		if (isFunctionLikeNode(current)) return false;
	}
	return false;
}

function isSwallowingBlock(block: ts.Block): boolean {
	const [only, ...rest] = block.statements;
	if (only === undefined) return true;
	if (rest.length > 0 || !ts.isReturnStatement(only)) return false;
	return only.expression === undefined || (ts.isIdentifier(only.expression) && only.expression.text === "undefined");
}

/** Empty or bare-return catch, flagged unless a NEVER_THROWS_MARKERS marker leads the catch or its enclosing function. */
export function ruleSwallowedException(source: QualitySource): QualityFinding[] {
	return runRule(source, "swallowed-exception", "error", (sf, report) => {
		for (const node of descendants(sf)) {
			if (ts.isCatchClause(node) && isSwallowingBlock(node.block) && !hasNeverThrowsMarker(node, sf)) {
				report(node.getStart(sf), "this catch clause discards the exception with no NEVER THROWS contract documented nearby");
			}
		}
	});
}

const SHIPPED_TODO_TOKENS = ["TODO", "FIXME", "XXX", "HACK"] as const;

const SHIPPED_TODO_PATTERN = new RegExp(`\\b(${SHIPPED_TODO_TOKENS.join("|")})\\b`);

/** Scans comment trivia only, so the word inside a string literal or fixture is not flagged. */
export function ruleShippedTodo(source: QualitySource): QualityFinding[] {
	return runRule(source, "shipped-todo", "error", (sf, report) => {
		const fullText = sf.getFullText();
		const seen = new Set<number>();
		const check = (ranges: readonly ts.CommentRange[] | undefined): void => {
			for (const range of ranges ?? []) {
				if (seen.has(range.pos)) continue;
				seen.add(range.pos);
				const match = SHIPPED_TODO_PATTERN.exec(fullText.slice(range.pos, range.end));
				if (match !== null) report(range.pos, `comment carries a shipped ${match[1]} marker instead of a tracked follow-up`);
			}
		};
		for (const node of descendants(sf)) {
			check(ts.getLeadingCommentRanges(fullText, node.getFullStart()));
			check(ts.getTrailingCommentRanges(fullText, node.getEnd()));
		}
		// A trailing comment at EOF sits in the EndOfFileToken's leading trivia, which the walk skips.
		check(ts.getLeadingCommentRanges(fullText, sf.endOfFileToken.getFullStart()));
	});
}

export const N_PLUS_ONE_CALLEES = ["query", "exec", "fetch", "findMany", "get"] as const;

function calleeName(expr: ts.LeftHandSideExpression): string | undefined {
	if (ts.isIdentifier(expr)) return expr.text;
	return ts.isPropertyAccessExpression(expr) ? expr.name.text : undefined;
}

function loopBodyOf(node: ts.Node): ts.Node | undefined {
	if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
		return node.statement;
	}
	if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["map", "forEach"].includes(node.expression.name.text)) {
		const callback = node.arguments[0];
		if (callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return callback.body;
	}
	return undefined;
}

/** The N+1 message for a loop-body node, or undefined when the node is not an await or a listed callee call. */
function nPlusOneMessage(node: ts.Node): string | undefined {
	if (ts.isAwaitExpression(node)) {
		return (
			"an await inside a loop body may be an N+1 query — this rule cannot distinguish that from a " +
			"single legitimate per-item call (e.g. one pi.exec per worktree, where no bulk API exists)"
		);
	}
	const name = ts.isCallExpression(node) ? calleeName(node.expression) : undefined;
	if (name === undefined || !(N_PLUS_ONE_CALLEES as readonly string[]).includes(name)) return undefined;
	return `call to "${name}" inside a loop body may be an N+1 query — this rule cannot distinguish that from a single legitimate per-item call`;
}

/** Warning tier: cannot tell a legitimate per-item call (one pi.exec per worktree) from a real N+1. */
export function ruleNPlusOne(source: QualitySource): QualityFinding[] {
	return runRule(source, "n-plus-one", "warning", (sf, report) => {
		const flagged = new Set<number>();
		for (const loop of descendants(sf)) {
			const body = loopBodyOf(loop);
			if (body === undefined) continue;
			for (const node of [body, ...descendants(body)]) {
				const message = nPlusOneMessage(node);
				if (message === undefined) continue;
				const pos = node.getStart(sf);
				if (flagged.has(pos)) continue;
				flagged.add(pos);
				report(pos, message);
			}
		}
	});
}

const RULE_FNS: Record<RuleId, (source: QualitySource) => QualityFinding[]> = {
	"magic-number": ruleMagicNumber,
	"literal-special-case": ruleLiteralSpecialCase,
	"copy-paste": ruleCopyPaste,
	"swallowed-exception": ruleSwallowedException,
	"shipped-todo": ruleShippedTodo,
	"n-plus-one": ruleNPlusOne,
};

/** Valid only with a non-empty reason after the em dash, on the finding's line or the line above. */
function isSuppressed(lines: readonly string[], ruleId: RuleId, line: number): boolean {
	return [lines[line - 1], lines[line - 2]].some((text) => {
		const markerAt = text?.indexOf(SUPPRESSION_MARKER) ?? -1;
		if (text === undefined || markerAt === -1) return false;
		const rest = text.slice(markerAt + SUPPRESSION_MARKER.length).trim();
		const id = /^([a-z-]+)/.exec(rest)?.[1];
		if (id !== ruleId) return false;
		const afterId = rest.slice(id.length).trim();
		return afterId.startsWith("—") && afterId.slice("—".length).trim().length > 0;
	});
}

/** Runs all six rules over non-exempt sources, drops suppressed findings, sorts by path then line. */
export function runAntiPatternRules(sources: readonly QualitySource[]): QualityFinding[] {
	const findings: QualityFinding[] = [];
	for (const source of sources) {
		if (SCAN_EXEMPT_PREFIXES.some((prefix) => source.path.startsWith(prefix))) continue;
		let lines: string[] | undefined;
		for (const ruleId of RULE_IDS) {
			for (const finding of RULE_FNS[ruleId](source)) {
				lines ??= source.text.split("\n");
				if (!isSuppressed(lines, ruleId, finding.line)) findings.push(finding);
			}
		}
	}
	return findings.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
}
