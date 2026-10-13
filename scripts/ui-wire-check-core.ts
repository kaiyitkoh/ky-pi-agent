import { createHash } from "node:crypto";

export interface WireAnalysis {
	sessionId?: string;
	requests: number;
	hashes: string[];
	stable: boolean;
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

/** Hashes the system text of one session's main requests and looks for volatile probe strings. */
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
	const lastRec = records[records.length - 1];
	const sessionId = opts.sessionId ?? (typeof lastRec?.sessionId === "string" ? lastRec.sessionId : undefined);
	const mine = records.filter((r) => r.sessionId === sessionId).slice(-(opts.last ?? 10));
	const probes = opts.probes.filter((p) => p.length > 0);

	const hashes: string[] = [];
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
		hashes.push(sha256(text));
		for (const probe of probes) {
			if (text.includes(probe)) {
				probeHits.push({ probe, request: i + 1 });
			}
		}
	});
	return {
		sessionId,
		requests: mine.length,
		hashes,
		stable: new Set(hashes).size <= 1,
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
	wire: Pick<WireAnalysis, "requests" | "stable" | "truncated" | "missing" | "probeHits">,
	ratios: readonly { corr: string; ratio: number }[],
	minRatio: number,
): Verdict {
	if (wire.requests < 2) {
		return { status: "INSUFFICIENT", reasons: ["fewer than two main requests in this session"] };
	}
	if (ratios.length === 0) {
		return { status: "INSUFFICIENT", reasons: ["no turn-2+ cache ratio available"] };
	}
	const reasons: string[] = [];
	if (!wire.stable) {
		reasons.push("system prompt differs between requests");
	}
	for (const hit of wire.probeHits) {
		reasons.push(`probe "${hit.probe}" found in the system prompt of request ${hit.request}`);
	}
	for (const r of ratios) {
		if (r.ratio < minRatio) {
			reasons.push(`cacheRead ratio ${r.ratio.toFixed(2)} below ${minRatio} at ${r.corr}`);
		}
	}
	if (wire.truncated) {
		reasons.push("system text truncated by redaction; hash comparison is best-effort");
	}
	const failed = reasons.filter((r) => !r.startsWith("system text truncated"));
	if (failed.length > 0) {
		return { status: "FAIL", reasons };
	}
	// Without system text there is nothing to compare, so a clean result proves nothing.
	if (wire.missing > 0) {
		return { status: "INSUFFICIENT", reasons: [...reasons, `${wire.missing} request(s) had no extractable system text`] };
	}
	return { status: "PASS", reasons };
}
