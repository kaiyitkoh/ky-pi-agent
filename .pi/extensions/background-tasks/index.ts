// VENDORED — pi-background-tasks@2.6.9 (npm), process-only trim of src/extension.ts
// and its static import closure.
//
// Why vendored instead of installed (D-02): 2.6.9 caps its Pi peer dependencies
// at ^0.84.0, so it cannot be installed against Pi 1.x. Vendoring also lets us
// drop the delegate / fusion / attested-run / anthropic-attribution features
// (~22k lines, one of which rewrites provider requests) and the npm-registry
// update check, leaving only bg_run / bg_status / bg_logs / bg_kill and the
// /bg family of commands. See PROVENANCE.md in this directory for the tarball
// hash, review findings, the numbered deviation list and what was not vendored.
//
// Do not edit beyond what a re-vendor of a newer upstream would also change.
//
// Upstream's `extensions/background-tasks.ts` re-exports the default from
// src/extension.ts. Here src/extension.ts exports it by name (BOOT-05) and
// THIS file (the auto-discovered nested-index entry point) is its only
// re-exporter; the upstream wrapper file is not vendored (PROVENANCE deviation 5).
export { backgroundTasksExtension as default } from "./src/extension.ts";
