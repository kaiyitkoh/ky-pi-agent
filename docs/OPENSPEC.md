# OpenSpec (opt-in skills)

OpenSpec is a spec-driven workflow from the official `@fission-ai/openspec` CLI. Here it is strictly opt-in: nothing is loaded into the model's context unless you type a command for it.

## What this is

- The skills and prompt templates are the ones the official CLI generates, not a reimplementation and not a third-party Pi package.
- This repo's own planning system is unchanged. The `openspec/` directory is git-ignored here; it belongs in your other repos, where you choose to use OpenSpec.
- Nothing is installed by `bin/bootstrap.sh`. You run the script below yourself.

## How it costs nothing per turn

Pi reads a strict boolean `disable-model-invocation: true` from a skill's frontmatter (`skills.js:262` in Pi 1.1.0). A quoted `"true"` does not count. Flagged skills are filtered out of the skills block in the system prompt (`formatSkillsForPrompt`), yet `/skill:<name>` still expands them on demand (`agent-session.js:1664-1681`). Prompt templates are expanded only when you type them and never enter the system prompt.

The generated skills do not carry the flag, so the setup script patches it into every `SKILL.md`. The behaviour is proven offline by `tests/unit/openspec-skills.test.ts` and `tests/integration/openspec-zero-cost.test.ts`.

## Install

The CLI is pinned to an exact version, `@fission-ai/openspec@1.13.2`, which was at least 14 days old when chosen (published 2026-09-23) and reviewed read-only: no install lifecycle scripts, SLSA provenance present, registry integrity

```
sha512-HzBaN9C1/ET+tgm/pxbWQYY4Kf+X9/1MSVEGQ8ZT3g4ZpdHn6v82CHkN+zmt9qv98Ghw0MDpmURasjJD2f90bg==
```

Install it with:

```
sh scripts/openspec-setup.sh --install-cli
```

which runs exactly `npm install -g --ignore-scripts @fission-ai/openspec@1.13.2` and then checks `openspec --version`. The flag is passed explicitly because the project `.npmrc` does not cover a global install.

## Generate and install the skills

The CLI can only write into a project directory, not into your user-level Pi directory. So the script:

1. creates a throwaway project and an isolated config home, with profile `custom`, all 12 workflows selected and delivery `both` (the expanded set);
2. runs `openspec init --tools pi --profile custom .` there;
3. patches `disable-model-invocation: true` into each generated `SKILL.md` frontmatter;
4. copies 12 skills and 12 prompts into `$PI_CODING_AGENT_DIR`, or `~/.pi/agent` when unset.

```
sh scripts/openspec-setup.sh
sh scripts/openspec-setup.sh --check
```

`--check` exits 0 only when the CLI version matches the pin and all 12 skills (each flagged) and 12 prompts are present.

The skills are `openspec-propose`, `openspec-explore`, `openspec-new-change`, `openspec-continue-change`, `openspec-apply-change`, `openspec-update-change`, `openspec-ff-change`, `openspec-sync-specs`, `openspec-archive-change`, `openspec-bulk-archive-change`, `openspec-verify-change` and `openspec-onboard`. Invoke one with `/skill:openspec-explore`; the matching prompt templates are `/opsx-explore` and so on.

## Telemetry and update check

The harness extension sets four environment variables for every CLI call it makes: `OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`, `OPENSPEC_NO_UPDATE_CHECK=1` and `OPENSPEC_NO_AUTO_CONFIG=1`. The setup script writes `telemetry.enabled=false` into the real OpenSpec config and verifies it. Check with `openspec config get telemetry.enabled`.

For your own terminal use you may `export OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1`. No script writes to shell rc files.

## Using it in a work repo

In a repo where you want OpenSpec, run `openspec init --tools none`. That creates only the `openspec/` directory and no agent config. The bash safety guard (see [SAFETY.md](SAFETY.md)) allows the read-only verbs and `archive`, and asks for confirmation on `init`, `update`, `completion`, `feedback` and config mutations. The same applies through wrappers (`env A=1`, `timeout`) and package runners (`npx`, `bunx`, `pnpm dlx`). `openspec` handed to a shell runner (`sh -c`, `xargs`, `node .../openspec.js`) is refused outright, which also refuses an agent running `sh scripts/openspec-setup.sh`. A bare package-manager script (`yarn openspec update`) is not caught; SAFETY.md lists it as EV-94.

## Upgrade

1. Check the age rule: `npm view @fission-ai/openspec time --json` (the target must be at least 14 days old).
2. Review the new tarball read-only: lifecycle scripts, telemetry, network calls, file writes.
3. Bump `OPENSPEC_VERSION` in `scripts/openspec-setup.sh`, and update this document and the runbook to the same version (a test enforces the match).
4. `sh scripts/openspec-setup.sh --install-cli`
5. `sh scripts/openspec-setup.sh` to regenerate and re-apply the flag. `openspec update` is not the mechanism because it targets project directories.
6. `sh scripts/openspec-setup.sh --check`, and read the script's warning about stale `openspec-*` directories left by a renamed skill.

## Uninstall

```
sh scripts/openspec-setup.sh --uninstall
npm uninstall -g @fission-ai/openspec
```

Then remove the OpenSpec config directory: `%APPDATA%\openspec` on Windows, `~/.config/openspec` elsewhere.

## Why not `openspec-pi@0.2.1`

It was evaluated and rejected. In its source:

- `extensions/openspec.ts:243` hooks `before_agent_start` and appends `openspec context` output to the system prompt (`:272`) on every turn, which is the per-turn cost this setup exists to avoid.
- `extensions/openspec.ts:201` adds a model-facing `openspec` tool with a 13-field schema and a prompt snippet.
- Its archive path runs through `pi.exec` and so bypasses the bash guard (`:162-165`, `:32`).
- Its bundled skills carry no `disable-model-invocation` and were generated by CLI 1.14.0, newer than the reviewed pin.

Nothing it offers beyond the official skills is wanted.
