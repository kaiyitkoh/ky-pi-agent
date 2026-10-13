import { createHash } from "node:crypto";

export interface WireAnalysis {
	sessionId?: string;
	/** Every session in the log, set only when no session was chosen and more than one is present. */
	ambiguousSessions: string[];
	requests: number;
	hashes: string[];
	stable: boolean;
	toolHashes: string[];
	toolsStable: boolean;
	truncated: boolean;
	missing: number;
	probeHits: { probe: string; request: number }[];
	skipped: number;
}

export interface Verdict {
	status: "PASS" | "FAIL" | "INSUFFICIENT";
	reasons: string[];
}

const TRUNCATED_MARKER = "[redacted:truncated]";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function textOf(content: unknown): string | undefined {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		const parts = content
			.map((p) => (typeof p === "string" ? p : isRecord(p) && typeof p.text === "string" ? p.text : undefined))
			.filter((p): p is string => p !== undefined);
		return parts.length > 0 ? parts.join("\n") : undefined;
	}
	return undefined;
}

/** Pulls the system text out of OpenAI-compatible, Responses, Bedrock or Anthropic request payloads. */
export function extractSystemText(payload: unknown): string | undefined {
	if (!isRecord(payload)) {
		return undefined;
	}
	if (Array.isArray(payload.messages)) {
		for (const m of payload.messages) {
			if (isRecord(m) && (m.role === "system" || m.role === "developer")) {
				const t = textOf(m.content);
				if (t !== undefined) {
					return t;
				}
			}
		}
	}
	if (typeof payload.instructions === "string") {
		return payload.instructions;
	}
	return textOf(payload.system);
}

function parse(line: string): Record<string, unknown> | undefined {
	try {
		const v: unknown = JSON.parse(line);
		return isRecord(v) ? v : undefined;
	} catch {
		return undefined;
	}
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Serialises the tool declarations of OpenAI-compatible, Responses, Anthropic (`tools`) or Bedrock (`toolConfig`) payloads. */
export function extractToolText(payload: unknown): string {
	if (!isRecord(payload)) {
		return "null";
	}
	return JSON.stringify(payload.tools ?? payload.toolConfig ?? null);
}

/** Hashes the system text and tool list of one session's main requests and looks for volatile probe strings. */
export function analyseWire(
	lines: readonly string[],
	opts: { sessionId?: string; last?: number; probes: readonly string[] },
): WireAnalysis {
	let skipped = 0;
	const records: Record<string, unknown>[] = [];
	for (const line of lines) {
		if (line.trim() === "") {
			continue;
		}
		const rec = parse(line);
		if (!rec) {
			skipped += 1;
			continue;
		}
		if (rec.kind === "main.request") {
			records.push(rec);
		}
	}
	const sessions = [...new Set(records.map((r) => r.sessionId).filter((s): s is string => typeof s === "string"))];
	// Async subagent children log to the same file under their own session, so "the last one" may be a child.
	const ambiguousSessions = opts.sessionId === undefined && sessions.length > 1 ? sessions : [];
	const sessionId = opts.sessionId ?? (ambiguousSessions.length > 0 ? undefined : sessions[0]);
	const mine = records.filter((r) => r.sessionId === sessionId).slice(-(opts.last ?? 10));
	const probes = opts.probes.filter((p) => p.length > 0);
	// Tool text is JSON, so a probe with a quote or backslash only appears there in escaped form.
	const escaped = (p: string) => JSON.stringify(p).slice(1, -1);

	const hashes: string[] = [];
	const toolHashes: string[] = [];
	const probeHits: { probe: string; request: number }[] = [];
	let truncated = false;
	let missing = 0;
	mine.forEach((rec, i) => {
		const text = extractSystemText(rec.payload);
		if (text === undefined || text.includes(TRUNCATED_MARKER)) {
			truncated = true;
		}
		if (text === undefined || text.trim() === TRUNCATED_MARKER) {
			missing += 1;
			return;
		}
		const tools = extractToolText(rec.payload);
		if (tools.includes(TRUNCATED_MARKER)) {
			truncated = true;
		}
		hashes.push(sha256(text));
		toolHashes.push(sha256(tools));
		for (const probe of probes) {
			if (text.includes(probe) || tools.includes(probe) || tools.includes(escaped(probe))) {
				probeHits.push({ probe, request: i + 1 });
			}
		}
	});
	return {
		sessionId,
		ambiguousSessions,
		requests: mine.length,
		hashes,
		stable: new Set(hashes).size <= 1,
		toolHashes,
		toolsStable: new Set(toolHashes).size <= 1,
		truncated,
		missing,
		probeHits,
		skipped,
	};
}

/** Cache-read ratio per turn from the second turn on; the first turn has nothing to read. */
export function turnRatios(lines: readonly string[], sessionId: string): { corr: string; ratio: number }[] {
	const out: { corr: string; ratio: number }[] = [];
	let seen = 0;
	for (const line of lines) {
		const rec = parse(line);
		if (!rec || rec.kind !== "turn" || rec.sessionId !== sessionId) {
			continue;
		}
		seen += 1;
		if (seen < 2) {
			continue;
		}
		const input = Number(rec.input);
		const cacheRead = Number(rec.cacheRead);
		const denom = input + cacheRead;
		if (Number.isFinite(denom) && denom > 0) {
			out.push({ corr: typeof rec.corr === "string" ? rec.corr : "", ratio: cacheRead / denom });
		}
	}
	return out;
}

export function verdict(
	wire: Pick<WireAnalysis, "ambiguousSessions" | "requests" | "stable" | "toolsStable" | "truncated" | "missing" | "probeHits">,
	ratios: readonly { corr: string; ratio: number }[],
	minRatio: number,
): Verdict {
	const reasons: string[] = [];
	if (!wire.stable) {
		reasons.push("system prompt differs between requests");
	}
	if (!wire.toolsStable) {
		reasons.push("tool list differs between requests");
	}
	for (const hit of wire.probeHits) {
		reasons.push(`probe "${hit.probe}" found in the system prompt or tool list of request ${hit.request}`);
	}
	for (const r of ratios) {
		if (r.ratio < minRatio) {
			reasons.push(`cacheRead ratio ${r.ratio.toFixed(2)} below ${minRatio} at ${r.corr}`);
		}
	}
	const failed = reasons.length > 0;
	if (wire.truncated) {
		reasons.push("system text or tool list truncated by redaction; hash comparison is best-effort");
	}
	if (failed) {
		return { status: "FAIL", reasons };
	}
	if (wire.ambiguousSessions.length > 0) {
		const ids = wire.ambiguousSessions.join(", ");
		return { status: "INSUFFICIENT", reasons: [`${wire.ambiguousSessions.length} sessions in this log (${ids}); pass --session <id>`] };
	}
	if (wire.requests < 2) {
		return { status: "INSUFFICIENT", reasons: ["fewer than two main requests in this session"] };
	}
	if (ratios.length === 0) {
		return { status: "INSUFFICIENT", reasons: ["no turn-2+ cache ratio available"] };
	}
	// Without system text there is nothing to compare, so a clean result proves nothing.
	if (wire.missing > 0) {
		return { status: "INSUFFICIENT", reasons: [...reasons, `${wire.missing} request(s) had no extractable system text`] };
	}
	return { status: "PASS", reasons };
}
