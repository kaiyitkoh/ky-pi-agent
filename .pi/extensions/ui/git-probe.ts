import { parsePorcelain } from "./statusline.ts";

// --no-optional-locks keeps a status probe from taking index.lock and racing the agent's own git commands.
export const GIT_STATUS_ARGS: readonly string[] = ["--no-optional-locks", "status", "--porcelain"];

export interface ProbeResult {
  stdout: string;
  code: number;
  killed?: boolean;
}

interface ProbeOptions {
  exec: (args: readonly string[]) => Promise<ProbeResult>;
  onResult: (changed: number | undefined) => void;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  minIntervalMs?: number;
}

// unref so a pending probe never keeps the process alive at shutdown.
function defaultSchedule(fn: () => void, ms: number): () => void {
  const handle = setTimeout(fn, ms);
  handle.unref?.();
  return () => clearTimeout(handle);
}

/**
 * Event-driven changed-file counter: single-flight with one trailing run, no
 * polling timer, and silent after exit 128 (not a repository) until reset.
 */
export function createGitProbe(opts: ProbeOptions) {
  const now = opts.now ?? Date.now;
  const schedule = opts.schedule ?? defaultSchedule;
  const minInterval = opts.minIntervalMs ?? 2000;

  let inFlight = false;
  let pending = false;
  let disabled = false;
  let generation = 0;
  let lastStart: number | undefined;
  let lastDurationMs = 0;
  let cancelScheduled: (() => void) | undefined;

  function clearScheduled(): void {
    cancelScheduled?.();
    cancelScheduled = undefined;
  }

  function finish(gen: number, started: number, result: ProbeResult | undefined): void {
    // A superseded run must not touch state the new generation now owns.
    if (gen !== generation) return;
    lastDurationMs = Math.max(0, now() - started);
    inFlight = false;
    if (result?.code === 128) {
      disabled = true;
      opts.onResult(undefined);
      return;
    }
    if (result !== undefined && result.code === 0 && !result.killed) {
      opts.onResult(parsePorcelain(result.stdout));
    } else {
      opts.onResult(undefined);
    }
    if (pending) {
      pending = false;
      trigger();
    }
  }

  function run(): void {
    cancelScheduled = undefined;
    inFlight = true;
    pending = false;
    const gen = generation;
    const started = now();
    lastStart = started;
    let promise: Promise<ProbeResult>;
    try {
      promise = opts.exec(GIT_STATUS_ARGS);
    } catch {
      finish(gen, started, undefined);
      return;
    }
    promise.then(
      (result) => finish(gen, started, result),
      () => finish(gen, started, undefined),
    );
  }

  function trigger(): void {
    if (disabled) return;
    if (inFlight) {
      pending = true;
      return;
    }
    if (cancelScheduled) return;
    if (lastStart !== undefined) {
      const interval = Math.max(minInterval, 4 * lastDurationMs);
      const elapsed = now() - lastStart;
      if (elapsed < interval) {
        cancelScheduled = schedule(run, interval - elapsed);
        return;
      }
    }
    run();
  }

  return {
    trigger,
    reset(): void {
      generation++;
      clearScheduled();
      inFlight = false;
      pending = false;
      disabled = false;
      lastStart = undefined;
      lastDurationMs = 0;
    },
    dispose(): void {
      generation++;
      clearScheduled();
      inFlight = false;
      pending = false;
      disabled = true;
    },
  };
}
