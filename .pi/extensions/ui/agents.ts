// async-complete fires only after delivery to the owning session (pi-subagents@0.76.1 result-watcher.js:528);
// process-terminal follows a runner exit once its proof is persisted (pi-subagents@0.76.1 async-execution.js:517).
export const SUBAGENT_BUS_TOPICS = [
  "subagent:async-started",
  "subagent:async-complete",
  "subagent:process-terminal",
] as const;

function idOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const { id, runId } = payload as { id?: unknown; runId?: unknown };
  return [id, runId].find((c): c is string => typeof c === "string" && c !== "");
}

// asyncByDefault is true (pi-subagents@0.76.1 config.js:233), so only clarify or async:false blocks the parent
// (pi-subagents@0.76.1 subagent-executor.js:7424); a plain call is an async launch counted by its bus event.
function isForegroundLaunch(args: unknown): boolean {
  if (typeof args !== "object" || args === null) return false;
  const a = args as { action?: unknown; async?: unknown; clarify?: unknown; workflow?: unknown; workflowScript?: unknown };
  // Workflow children launch as async runners even under a blocking call (pi-subagents@0.76.1 subagent-executor.js:4435).
  if (a.workflow !== undefined || a.workflowScript !== undefined) return false;
  return a.action === undefined && (a.async === false || a.clarify === true);
}

/** Counts async runners by bus event and blocking subagent calls by tool call; workflows count through their runner children. */
export function createAgentTracker() {
  const asyncIds = new Set<string>();
  const foreground = new Set<string>();

  return {
    onBusEvent(topic: string, payload: unknown): boolean {
      const id = idOf(payload);
      if (id === undefined) return false;
      if (topic === "subagent:async-started") {
        // A workflow runs in-process, so it never gets process-terminal; its children are counted instead.
        if ((payload as { mode?: unknown }).mode === "workflow" || asyncIds.has(id)) return false;
        asyncIds.add(id);
        return true;
      }
      if (topic === "subagent:async-complete" || topic === "subagent:process-terminal") return asyncIds.delete(id);
      return false;
    },
    onToolStart(toolName: unknown, toolCallId: unknown, args?: unknown): boolean {
      if (toolName !== "subagent" || typeof toolCallId !== "string" || toolCallId === "") return false;
      if (!isForegroundLaunch(args) || foreground.has(toolCallId)) return false;
      foreground.add(toolCallId);
      return true;
    },
    onToolEnd(toolName: unknown, toolCallId: unknown): boolean {
      if (toolName !== "subagent" || typeof toolCallId !== "string") return false;
      return foreground.delete(toolCallId);
    },
    running(): number {
      return asyncIds.size + foreground.size;
    },
    reset(): void {
      asyncIds.clear();
      foreground.clear();
    },
  };
}
