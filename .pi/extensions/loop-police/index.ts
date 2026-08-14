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
export { default } from "./loop-police.ts";
