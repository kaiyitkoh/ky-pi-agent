# Provenance — vendored `pi-background-tasks` (process-only trim)

This directory is a trimmed, source-form copy of a third-party npm package, not
an npm dependency. Decision D-02 (phase 08.1): `pi-background-tasks@2.6.9` caps
its Pi peer dependencies at `^0.84.0`, so it cannot be installed against Pi 1.x.
Vendoring removes the peer range from the picture (no `package.json` travels),
and lets us drop the delegate, fusion, attested-run and anthropic-attribution
features plus an npm-registry phone-home.

## Upstream identity

| Field | Value |
|---|---|
| Package | `pi-background-tasks` |
| Version | `2.6.9` (exact) |
| Repository | `git+https://github.com/ismailsaleekh/pi-background-tasks.git` |
| `package.json` `license` | `ISC` |
| LICENSE file in tarball | present, copied verbatim to `./LICENSE` (sha256 `5b9bdcc9d1c8ff25c560200695de042b12052573cb1224af4d735fba06d30b65`) |
| npm `time.modified` | `2026-09-30T15:49:30.717Z` |
| GitHub `pushed_at` / `archived` | not queried (the `gh` CLI is intentionally unauthenticated in this repo, SAFE-16) |

## Tarball provenance

Obtained 2026-10-13 with `npm pack pi-background-tasks@2.6.9 --ignore-scripts`
into an empty scratch directory, then `tar -xf`; no code from the tarball was
executed (only read and copied by script).

| Field | Value |
|---|---|
| npm `dist.shasum` | `4b6f9ad6cd5fb03cc16460b465f73ad60d72975e` |
| npm `dist.integrity` | `sha512-5dma6xvO7jeAimRaCNCzfe5y+b4bVBYPxnJ/0RnGS+mj6B6SzgA4FcORKuAtZaoGvC29dlyof3NtX7/QD4Ywew==` |
| tarball sha256 | `84cb5dd2b159c77fae02647ebb60f74d184a1f012f30463cb24c8ceff5fd2fee` |
| `npm pack` file count | 236 |
| lifecycle scripts | empty |
| runtime dependency | one, `turndown@7.2.4`, used only by the un-vendored fusion web-fetch module |

## Review findings

Method: static import closure of `extensions/background-tasks.ts` computed by
script (relative `import`/`export ... from`/dynamic `import()`), minus the
excluded features below. The result is 12 files under `src/` (about 10.3k lines
after trimming). `registry.ts`, `common.ts` and `extension.ts` were read at the
registration, spawn and file-IO sites; the remaining files were grepped.

- **Events hooked** (`pi.on`): `before_agent_start` (shell-policy guidance
  text only, `src/core/shell-policy.ts:176` and `src/extension.ts:174`),
  `session_start` (`:282`, `:540`), `session_shutdown` (`:275`, `:565`). No
  `tool_call`, `context`, `before_provider_request` or `message_end` hook; the
  extension cannot alter another tool's input or any provider payload.
- **Process spawning sites**: `src/core/registry.ts:1660` (the shell
  invocation for `bg_run`, `shell: false`, shell and args from the resolved
  shell policy, command is the model-supplied string, so the safety hook must
  classify it; verified by `tests/integration/background-tasks-load.test.ts`),
  `src/core/registry.ts:555`/`:303` (optional telemetry wrapper script written
  to the task runtime dir, only for `isAgent: true` tasks, spawns the resolved
  `pi` launcher with the same command), `src/core/reload-shell-owner.ts:961`
  (re-spawn of an opted-in shell task across `/reload`, same invocation shape),
  `src/core/windows-taskkill.ts:216` (`taskkill` for tree kill).
- **Environment reads**: `PI_BG_SHELL`, `PI_BG_SHELL_PATH`, `PI_BG_POSIX_SHELL`,
  `PI_BG_POSIX_SHELL_PATH`, `SHELL`, `ComSpec`, `PATH` (shell selection,
  `src/core/common.ts:858-1043`); `PI_BG_MAX_OUTPUT_BYTES` (`registry.ts:66`);
  `PI_BG_DISABLE_PI_TELEMETRY` (`registry.ts:256`); `PI_BG_FEATURES` and
  `PI_BG_DOCK_SHORTCUT` (`config.ts`). These are process environment, not
  working-tree files, so the agent cannot rewrite them through write/edit.
- **Network**: `grep -rn "fetch(\|https://\|http://"` over the vendored tree
  returns no hits. There is no network code path.
- **File reads from disk**: the only non-output read is
  `src/core/pi-launch.ts:108-216` (`readFileSync` of `package.json` files while
  resolving the installed `pi` binary by walking up from the PATH-resolved
  launcher). See deviation 6. `JSON.parse` at `registry.ts:594`, `:1900`,
  `:2058` and `reload-shell-owner.ts:1085` parse child-process stdout lines in
  memory, not files. No config or state file inside the working tree is read
  back to decide what is executed or where.
- **Files written**: task output, metadata JSON and the telemetry wrapper under
  `<cwd>/.pi/tasks/<runId>/` (write-only; never read back to widen execution).

### Registered tools (live surface; asserted by the load test)

| Tool | Parameter properties | Registered at |
|---|---|---|
| `bg_run` | `name`, `command`, `isAgent`, `description`, `timeoutSeconds`, `notifyOnCompletion`, `triggerOnCompletion`, `surviveReload` (schema `src/extension.ts:96`) | `src/extension.ts:768` |
| `bg_status` | `taskId` (schema `:132`) | `src/extension.ts:876` |
| `bg_logs` | `taskId`, `maxBytes`, `tail` (schema `:141`) | `src/extension.ts:907` |
| `bg_kill` | `taskId` (schema `:155`) | `src/extension.ts:952` |

Only `bg_run` carries an executable payload (`command`); the safety hook maps it
to the bash classifier (08.1-03). The other three take a task id (or flags) only.
Commands registered: `/bg`, `/tasks`, `/bg-tasks`, `/bg-clear`, `/jobs`,
`/logs`, `/kill` (user-typed, not model-callable).

## Deviation list

1. **Feature code removed from `src/extension.ts`**: the `fusion` and `delegate`
   registration blocks (dynamic `import()` of the two feature modules plus
   `bg_result`), the `bg_run_pi_attested` tool, its schema, argument record and
   `startAttestedPiTask` helper, and the dock-rerun guard that referred to typed
   workflows. Corresponding code removed from `src/core/registry.ts`
   (`startManagedTask`, `updateManagedTask`, `claimFusionUsage`,
   `startDelegateTask`, `startAttestedPiTask`, `finalizeAttestedPiTask`, the
   attested runtime loader and git options, the delegate stdin writer, the
   attestation constructor options) and the matching types and snapshot fields
   from `src/core/common.ts`.
2. **`src/core/config.ts`**: `PI_BG_FEATURE_VALUES` is `['process']`;
   `parseFeatures()` ignores its input entirely. Unknown or removed tokens in
   `PI_BG_FEATURES` neither throw nor enable anything (upstream threw on
   unknown tokens). Removed code cannot be re-enabled by environment.
3. **Update check removed**: `src/core/update-check.ts` not vendored; the
   `readPackageInfo`/`fetchLatestVersion` use, the update status segment, the
   scheduler and the `/bg-update` command are removed from `src/extension.ts`.
4. **Import specifiers**: relative `./x.js` rewritten to `./x.ts` by script
   (repo convention, `allowImportingTsExtensions`; jiti resolves `.ts`).
5. **Default export**: `src/extension.ts` exports `backgroundTasksExtension` by
   name; `./index.ts` re-exports it as default (BOOT-05: only `index.ts` carries a
   top-level default export, loop-police deviation 2 precedent). Upstream's
   `extensions/background-tasks.ts` wrapper is not vendored.
6. **Agent-writable reads audited (WR-17 lesson)**: the only working-tree-relevant
   read is the `pi` launcher manifest walk in `pi-launch.ts`. It starts from the
   PATH-resolved `pi` binary, not from the working tree; an empty PATH entry
   falls back to `process.cwd()` (`pi-launch.ts:429`), used only for
   `isAgent: true` tasks, whose command is already the model-supplied string
   the safety hook classifies. It cannot widen what `bg_run` executes or where.
   No patch needed; recorded here as the audit result. Task metadata and output
   are written but never read back from disk.

## What was not vendored

- `src/fusion-extension.ts`, `src/core/fusion/**`, `src/delegate-extension.ts`,
  `src/core/delegate/**` (read-only delegated agents and Fusion workflows;
  duplicate the separately installed subagents extension).
- `src/core/attested-pi-run.ts`, `src/core/attested-pi-contract.ts` (attested
  Pi runs).
- `src/core/anthropic-attribution.ts`, `src/core/anthropic-attribution-path.ts`
  (rewrites Anthropic provider requests; the one strict-tsc error against Pi 1.1.0).
- `src/core/update-check.ts` (npm-registry network calls).
- `src/core/canonical-json.ts` (only used by the removed attested code), the
  `turndown` dependency, `dist/`, `docs/`, tests, skills, `package.json`,
  `README.md`, `logo.png` and the other tarball documentation.

## Files copied

Hash is the sha256 of the upstream original inside the tarball.

| File | Upstream sha256 | Status |
|---|---|---|
| `LICENSE` | `5b9bdcc9d1c8ff25c560200695de042b12052573cb1224af4d735fba06d30b65` | verbatim |
| `src/core/common.ts` | `4133564bfef268db66e5123bb90030d02a1e5eaedb3ceee00acfbd1f5bd38963` | modified - see deviation 1, 4 |
| `src/core/config.ts` | `24b368933cf9fe136cba3bb81505e872dcdc23fc8a0b17cccb90de35312c3111` | modified - see deviation 2 |
| `src/core/durable-fs.ts` | `93d5481d5dce8830ebbfb7cfd8af3047a2939b4a144f3b9c3bfaeca67cfbe690` | specifiers only (deviation 4) |
| `src/core/extension-api.ts` | `29672729236fe4decdd3010c9374976a31238fba984c2fd8292af87a1390cc30` | specifiers only (deviation 4) |
| `src/core/lazy-module.ts` | `cc58caaa48b734134574683f2eceba980885b9c98cefd689c87df5f42bccd82a` | specifiers only (deviation 4) |
| `src/core/pi-launch.ts` | `69e751caa70cb67109b9fb2990b7e06de5e5fd971ea47f608662ebb3ef6be85d` | specifiers only (deviation 4) |
| `src/core/registry.ts` | `3d33da6f795bc8946a291287987736d7a823b563326116de97ca229a300abb51` | modified - see deviation 1, 4 |
| `src/core/reload-shell-owner.ts` | `315b0fa89e408ec5dc4df21fae7f4308eeb32987761a8361272a69a141543a36` | specifiers only (deviation 4) |
| `src/core/shell-policy.ts` | `91c3532a3b6afc4d682ab0e341f892f228c477c9e648010dd8e40d5aa0cc9c27` | specifiers only (deviation 4) |
| `src/core/task-durable.ts` | `1e604c936a778019e89a7c02cb5efaa09dfc860a43d0d00d3d219f1c19f0cc28` | modified - one error-message word (deviation 1) |
| `src/core/windows-taskkill.ts` | `d8e21e077720f408a5b181b200924363ad75fd7b3acbafeabb6a2662a9d1fad1` | specifiers only (deviation 4) |
| `src/extension.ts` | `480bb50c7a087237aad4bdde302dda00635429b6be5ca0886422c487709603eb` | modified - see deviations 1, 3, 4, 5 |
| `src/ui/background-tasks-manager.ts` | `96c71807767499887ab3417e5eabac973a19221e4f2e985e2218d4ad672dd687` | specifiers only (deviation 4) |
| `index.ts` | n/a (new; upstream `extensions/background-tasks.ts` sha256 `b221129d3a1449606de6e7c04bd8989c6b7feee3eaf5122339c2d45cffadf74f`) | authored entry, deviation 5 |

## Placement

Vendored at `.pi/extensions/background-tasks/`, NOT at the `.pi/extensions/vendor/`
location D-02 names. A `vendor/` subdirectory is not auto-discovered by Pi, and
`tests/unit/extension-layout.test.ts` only admits `<dir>/index.ts` entry points.
This follows the actual Phase 7 pattern (loop-police, plan-mode, checkpoint sit
directly under `.pi/extensions/<name>/` with a PROVENANCE.md).
