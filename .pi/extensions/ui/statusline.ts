export type Fg = (
  color: "accent" | "muted" | "dim" | "warning" | "success" | "error",
  text: string,
) => string;

export interface StatuslineState {
  mode?: string;
  escalated?: boolean;
  provider?: string;
  contextLeftTokens?: number;
  changedFiles?: number;
  agentsRunning?: number;
}

// Order matters: OSC and CSI sequences must go before the bare control-char
// strip, otherwise their printable payload would survive as visible text.
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Strips terminal control sequences from untrusted text so only theme colours can emit ANSI. */
export function sanitizeLabel(value: unknown, max = 24): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return undefined;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Floors rather than rounds so the figure never overstates the real remainder. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const tenths = Math.floor(n / 100_000) / 10;
    return `${tenths}M`;
  }
  if (n >= 1000) return `${Math.floor(n / 1000)}k`;
  return String(Math.floor(n));
}

/** Counts changed paths only; names are never exposed. */
export function parsePorcelain(stdout: string): number {
  let count = 0;
  for (const line of stdout.split("\n")) {
    if (line.replace(/\r$/, "").trim() !== "") count++;
  }
  return count;
}

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Renders only what Pi's default footer lacks; undefined clears the status. */
export function formatStatusline(state: StatuslineState, fg: Fg): string | undefined {
  const mode = sanitizeLabel(state.mode, 12);
  const provider = sanitizeLabel(state.provider, 16);

  const groups: string[] = [];

  const head: string[] = [];
  if (mode !== undefined) {
    head.push(fg("accent", mode) + (state.escalated ? fg("warning", "↑") : ""));
  }
  if (provider !== undefined) head.push(fg("muted", provider));
  if (head.length > 0) groups.push(head.join(" "));

  if (isCount(state.contextLeftTokens)) {
    groups.push(fg("muted", `${formatTokens(Math.max(0, state.contextLeftTokens))} left`));
  }
  if (isCount(state.changedFiles)) {
    const n = Math.max(0, Math.floor(state.changedFiles));
    const text = `${n} changed`;
    groups.push(n > 0 ? fg("warning", text) : fg("muted", text));
  }
  if (isCount(state.agentsRunning) && state.agentsRunning > 0) {
    const n = Math.floor(state.agentsRunning);
    groups.push(fg("accent", `${n} ${n === 1 ? "agent" : "agents"}`));
  }

  if (groups.length === 0) return undefined;
  return groups.join(fg("dim", " · "));
}
