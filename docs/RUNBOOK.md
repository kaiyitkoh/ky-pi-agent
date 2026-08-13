# Runbook — checks that cannot be executed on the development machine

This file exists because some things cannot be proven from a desk. A check
lands here when it needs the work laptop, a clean Pi profile, network egress,
an interactive terminal, or live credentials — none of which the development
machine can supply honestly.

**The contract of this file.** Every entry carries four things:

1. the **exact command**, copy-pasteable, with no placeholder to guess at;
2. the **expected output**, specific enough that "it seemed fine" is not an
   acceptable result;
3. the **offline proxy** — the test in this repo that verifies as much of the
   behaviour as can be verified without the missing thing, so the residual
   uncertainty is narrow and named;
4. a **status line**, which is either `OUTSTANDING` or a date-stamped
   `PASSED — YYYY-MM-DD`.

An entry with no status line is a bug in this file. A status may only move to
passed by a human who actually ran the command and read the output; it may
never be inferred from a green unit test, because the unit test proves the
classifier and not the machine. `tests/unit/docs-policy.test.ts` enforces the
Phase 1 statuses mechanically, so flipping one is a deliberate edit that
breaks the suite until the test is updated in the same change.

**Ownership.** `docs/RUNBOOK.md` is formally a Phase 3 deliverable (PROV-09),
and later phases append their own sections to it. Phase 1 creates the file
early rather than waiting, because three Phase 1 checks would otherwise be
lost between now and then — and a check nobody wrote down is a check nobody
runs.

---

## Phase 1 — Bootstrap, Packaging & Supply Chain

| ID | Check | Status |
|----|-------|--------|
| RB-01-01 | SAFE-16 — `gh` left unauthenticated on the work laptop | OUTSTANDING |
| RB-01-02 | BOOT-02 — `pi install` against the real GitHub URL on a clean profile | OUTSTANDING |
| RB-01-03 | BOOT-05 — `/reload` re-registers the extension | OUTSTANDING |

### RB-01-01 — SAFE-16: `gh` left unauthenticated on the work laptop

**Status:** OUTSTANDING

**Why this cannot be done here.** `gh` is legitimately authenticated on the
development machine. The git remote is HTTPS and no SSH key exists, so the
`gh` credential is how this repository is pushed; logging out here would break
git access and prove nothing. The control matters on the **work laptop**,
which holds the credentials worth protecting.

**What the control is.** Pi's `/share` exports the entire session transcript
to a temporary file and posts it as a secret gist. It cannot be blocked by any
extension — it is matched as a literal string in the interactive submit
handler and dispatched before extension commands and before the `input` event.
The one branch that stops it is Pi's own `gh auth status` check: when that
exits non-zero, `/share` shows an error and returns *before* the transcript is
written to disk. So `gh auth status` exiting non-zero **is** the entire
control.

**Procedure, on the work laptop:**

1. `sh scripts/check-gh-unauthenticated.sh`
   Run it **bare** — not `--warn-only`, which is the development-machine mode
   that reports the risk and continues. Expect exit status **1** and the
   message `gh IS authenticated. /share can upload this session to a GitHub
   gist.` on stderr.
2. `gh auth logout`
3. `sh scripts/check-gh-unauthenticated.sh`
   Expect exit status **0** and `OK: gh is unauthenticated; /share aborts
   before export.` on stdout.
4. Start a real interactive Pi session and type `/share`. Expect it to abort
   with `GitHub CLI is not logged in. Run 'gh auth login' first.` and to write
   nothing.

**Closed door — do not re-litigate.** `gh auth refresh --remove-scopes gist`
cannot be used to keep `gh` usable for git-over-HTTPS while removing the gist
capability. `gh auth refresh --help` states that the minimum set of scopes —
`repo`, `read:org` and `gist` — cannot be removed. `gh auth logout` is the
only remedy.

**Cost of applying it.** On a machine using git-over-HTTPS, logging out also
removes the git credential. Set up SSH first if that machine needs to push.

**Offline proxy:** `tests/unit/gh-unauthenticated.test.ts` — drives the
classifier script against stubbed `gh` binaries in both directions and asserts
the stub's own call log, so a PATH-ordering mistake cannot silently turn the
test into an assertion about the developer's real keyring. It proves the
classifier is correct. It says nothing about the work laptop's state.

### RB-01-02 — BOOT-02: `pi install` against the real GitHub URL on a clean profile

**Status:** OUTSTANDING

**Why this cannot be done here.** It needs a Pi profile with no prior state
and network egress to GitHub. The development machine's profile already has
this repository's packages and trust decisions recorded, so an install here
would exercise the update path rather than the first-install path.

**Procedure:**

1. Start from a clean profile, or point Pi's agent directory at an empty one:
   `export PI_CODING_AGENT_DIR=/tmp/pi-clean-check`
2. `pi install https://github.com/kaiyitkoh/ky-pi-agent`
3. `pi --list-models`

**Expected output:** the sentinel model id `ky-harness-selftest` appears in the
model list. Its presence is the proof that the package manifest resolved, the
extension directory was collected, and the extension loaded.

**Undo:** `pi remove <source>`, where `<source>` is the URL string as written
into `settings.json`. If a throwaway `PI_CODING_AGENT_DIR` was used, deleting
that directory is sufficient.

**Note on the URL.** The form above carries no ref, so it is *not* pinned —
`pi update --extensions` will reconcile it to the tracked default branch.
Pinning requires an explicit `@<tag-or-commit>` suffix.

**Offline proxy:** `tests/integration/load-paths.test.ts` case 2 — clones this
repository locally and runs `npm install --omit=dev` in the clone, then loads
it as a package and asserts the sentinel. It exercises the same code path with
a local clone standing in for the network fetch.

### RB-01-03 — BOOT-05: `/reload` re-registers the extension

**Status:** OUTSTANDING

**Why this cannot be done here.** `/reload` is an interactive slash command
with no non-interactive equivalent; it requires a TTY. There is no `--reload`
flag and no scriptable path to it.

**Procedure:**

1. `cd ky-pi-agent && pi`
2. Accept the project-trust prompt. Without trust, project-local resources
   under `.pi/` are ignored entirely and the test is vacuous.
3. Edit `SELFTEST_MODEL_ID` in `.pi/extensions/harness/index.ts` to a new
   value.
4. Run `/reload`.
5. Confirm the **new** value appears — via the model picker in the same
   session, or by exiting and running a fresh `pi --list-models`.

**Expected output:** the edited sentinel id, not the old one. Hot reload works
only for auto-discovered locations; an extension loaded with `pi -e <path>` is
for quick tests and does not participate.

**Offline proxy:** `tests/unit/extension-layout.test.ts` — asserts the
documented structural precondition for hot reload, that every shipped
extension sits at an auto-discovered path. That is a necessary condition for
`/reload` to work, not a sufficient one, which is exactly why this entry
stays open.

---

### Phase 1 machine-state notes

These belong nowhere else and are easy to get wrong.

**`auth.json` mode `0600` is a no-op on Windows.** `~/.pi/agent/auth.json` is
written with mode `0600`, which on Windows toggles only the read-only bit —
Node's `chmodSync` does not touch NTFS ACLs. Do **not** treat that mode as a
permission control on Windows.

**Three pieces of machine state no file in this repository can reach:**

1. whether `~/.pi/agent/npm/.npmrc` exists — the repo cannot write outside
   itself, and this is the file that covers every user-scope `pi install`;
2. whether `gh` is logged in — see RB-01-01;
3. whether the globally installed Pi matches the pin — a stale global Pi
   silently changes extension-API behaviour.

All three are re-checkable at any time:

```
sh bin/bootstrap.sh --check-only
sh bin/bootstrap.sh --assert-hardening
```

`--check-only` mutates nothing and exits 0 on a clean runner where bootstrap
has never been applied. **It does, however, require network access**: its
published-pin preflight asks the npm registry whether the pin still exists, and
exits 1 when the registry does not answer rather than guessing which of
"withdrawn" and "offline" it is looking at. On a plane, skip it.
`--assert-hardening` is the stricter one *and* the offline-safe one: it asks npm
about all three scopes including the user scope, touches no network, and exits 1
if any of them still permits lifecycle scripts.
