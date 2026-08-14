// VENDORED — pi-loop-police@1.14.1 (npm), extensions/index.ts, unmodified apart
// from this header.
//
// Why vendored instead of installed (EXT-10): the upstream package.json
// declares `"license": "MIT"` but ships NO LICENSE file in its published
// tarball, and the GitHub API (`gh api repos/sebaxzero/pi-loop-police`)
// reports `license: null`. A package with no LICENSE file may not be added
// to this repo's npm dependencies; it is copied here in source form instead,
// reviewed, and never installed. See PROVENANCE.md in this directory for the
// full upstream record (repository, tarball SHA-256, review findings, and
// what was deliberately left un-vendored).
//
// Do not edit the exported logic here or in ./loop-police.ts beyond what a
// future re-vendor of a newer upstream version would also change — a
// hand-edited vendored file cannot be diffed against its origin.
//
// Upstream exports the extension function as `export default` directly from
// loop-police.ts. Renamed there to the named export `loopPolice` and
// re-exported as default from here instead, so only THIS file — the actual
// auto-discovered nested-index entry point — carries a top-level default
// export; see PROVENANCE.md's "Deviation from a byte-for-byte copy" section.
export { loopPolice as default } from "./loop-police.ts";
