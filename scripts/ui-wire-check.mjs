// Reads already-redacted diagnostics logs only; prints hashes and counts, never prompt text.
// Node strips the types on import (>= 22.19).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const USAGE =
	"usage: ui-wire-check.mjs [--logs DIR] [--date YYYY-MM-DD] [--session ID] [--last N] [--probe TEXT]... [--min-ratio X]";

function localDate() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseArgs(argv) {
	const o = { logs: join(process.cwd(), ".pi", "logs"), date: localDate(), last: 10, probes: [], minRatio: 0.5 };
	for (let i = 0; i < argv.length; i += 2) {
		const name = argv[i];
		const value = argv[i + 1];
		if (value === undefined) {
			throw new Error(`missing value for ${name}`);
		}
		if (name === "--logs") o.logs = resolve(value);
		else if (name === "--date") o.date = value;
		else if (name === "--session") o.session = value;
		else if (name === "--last") o.last = Number(value);
		else if (name === "--probe") o.probes.push(value);
		else if (name === "--min-ratio") o.minRatio = Number(value);
		else throw new Error(`unknown flag ${name}`);
	}
	if (!Number.isFinite(o.last) || o.last < 1 || !Number.isFinite(o.minRatio)) {
		throw new Error("--last and --min-ratio must be numbers");
	}
	return o;
}

let opts;
try {
	opts = parseArgs(process.argv.slice(2));
} catch (err) {
	process.stderr.write(`ui-wire-check: ${err.message}\n${USAGE}\n`);
	process.exit(64);
}

const wirePath = join(opts.logs, `wire-${opts.date}.jsonl`);
const turnsPath = join(opts.logs, `turns-${opts.date}.jsonl`);
for (const p of [wirePath, turnsPath]) {
	if (!existsSync(p)) {
		process.stdout.write(`ui-wire-check: missing log file ${p}\n`);
		process.exit(2);
	}
}

const core = await load("scripts/ui-wire-check-core.ts");
const lines = (p) => readFileSync(p, "utf-8").split(/\r?\n/);
const wire = core.analyseWire(lines(wirePath), { sessionId: opts.session, last: opts.last, probes: opts.probes });
const ratios = wire.sessionId ? core.turnRatios(lines(turnsPath), wire.sessionId) : [];
const result = core.verdict(wire, ratios, opts.minRatio);

const out = [];
out.push(`session: ${wire.sessionId ?? "(none)"}`);
out.push(`requests: ${wire.requests}`);
out.push(`distinct system hashes: ${new Set(wire.hashes).size} (${[...new Set(wire.hashes)].map((h) => h.slice(0, 12)).join(", ")})`);
if (wire.skipped > 0) out.push(`malformed lines skipped: ${wire.skipped}`);
for (const hit of wire.probeHits) out.push(`probe hit: "${hit.probe}" in request ${hit.request}`);
for (const r of ratios) out.push(`cacheRead ratio ${r.corr}: ${r.ratio.toFixed(2)}`);
out.push(`ui-wire-check: ${result.status}`);
for (const reason of result.reasons) out.push(`  - ${reason}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(result.status === "PASS" ? 0 : result.status === "FAIL" ? 1 : 2);
