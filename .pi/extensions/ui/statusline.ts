export type Fg = (
  color: "accent" | "muted" | "dim" | "warning" | "success" | "error",
  text: string,
) => string;

export interface StatuslineState {
  mode?: string;
  escalated?: boolean;
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
  if (n >= 1_000_000) return `${Math.floor(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.floor(n / 1000)}k`;
  return String(Math.floor(n));
}

/** Counts changed paths only; names are never exposed. */
export function parsePorcelain(stdout: string): number {
  return stdout.split("\n").filter((line) => line.trim() !== "").length;
}

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** The mode label with its escalation marker, or undefined when the mode is unusable. */
export function formatMode(mode: unknown, escalated: boolean | undefined, fg: Fg): string | undefined {
  const label = sanitizeLabel(mode, 12);
  return label === undefined ? undefined : fg("accent", label) + (escalated ? fg("warning", "↑") : "");
}

/** Renders only what Pi's default footer lacks; undefined clears the status. */
export function formatStatusline(state: StatuslineState, fg: Fg): string | undefined {
  const groups: string[] = [];
  const mode = formatMode(state.mode, state.escalated, fg);
  if (mode !== undefined) groups.push(mode);
  if (isCount(state.contextLeftTokens)) {
    groups.push(fg("muted", `${formatTokens(Math.max(0, state.contextLeftTokens))} left`));
  }
  if (isCount(state.changedFiles)) {
    const n = Math.max(0, Math.floor(state.changedFiles));
    groups.push(fg(n > 0 ? "warning" : "muted", `${n} changed`));
  }
  if (isCount(state.agentsRunning) && state.agentsRunning > 0) {
    const n = Math.floor(state.agentsRunning);
    groups.push(fg("accent", `${n} ${n === 1 ? "agent" : "agents"}`));
  }
  return groups.length === 0 ? undefined : groups.join(fg("dim", " · "));
}
