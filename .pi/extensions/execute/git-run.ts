import { spawnSync } from "node:child_process";

const GIT_MAX_BUFFER_BYTES = 67_108_864;

/** One git call, never through a shell; `out` is the raw stdout. */
export function git(cwd: string, args: readonly string[]): { readonly status: number | null; readonly out: string; readonly stderr: string } {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", shell: false, windowsHide: true, maxBuffer: GIT_MAX_BUFFER_BYTES });
	return { status: r.status, out: r.stdout ?? "", stderr: r.stderr ?? "" };
}
