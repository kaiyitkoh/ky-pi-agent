# Terminal UI

The UI is chrome only. Nothing here is written into the system prompt, so no UI
state can invalidate the provider's prompt cache.

## Theme

The theme is `.pi/themes/ky.json`: a muted dark palette where colour is reserved
for status (accent, warning, error). It conforms to Pi's theme schema, and a test
validates it against the schema shipped in the installed Pi.

Selection:

- Inside this repo, `.pi/settings.json` sets `"theme": "ky"`. A project key beats
  the global one, so `/settings` cannot override it here.
- As a package user, pick `ky` in `/settings`, or run `pi --use-theme ky` for one
  invocation.
- After editing `ky.json`, run `/reload`.

There is no `/theme` command, by design: Pi's `/settings` already does the job.

## Footer and statusline

Pi's built-in footer is kept. There is no custom footer.

| Shown by Pi's footer | Shown by the one `ky-statusline` key |
|----------------------|--------------------------------------|
| model, provider when several are configured | mode, with an escalation marker |
| context percentage | tokens left |
| session cost, including cache-warming usage entries | changed files |
| git branch | running subagents (`N agent(s)`) |
| cache read/write and hit percentage | |

The provider is left to Pi's footer, which shows it whenever more than one
provider is configured; with a single provider the model already identifies it.

Reusing Pi's footer means cost and cache numbers come from the same source Pi
uses, instead of a second tally that can drift. The `ky-statusline` key appears on
the footer's third line.

## Header

A two-line header in the TUI only. Line one is the harness version, Pi version and
current mode; line two is a single dim hint line (`/` commands, `!` bash, the
interrupt key). It replaces Pi's built-in keybinding hints, so the two never
stack. It re-reads state on every render, so a mode change shows without a reload.

## Subagents

The live subagent widget is composed from `pi-subagents`: its `subagent-async` and
`subagent-fleet-status` widgets already show running and queued runs. The
statusline adds only a count, and there is no second widget, so there is one
place to look and nothing to keep in sync. The widget is exercised live by
`RB-11-02`.

## Prompts

Authored prompts use `ctx.ui.confirm` and `ctx.ui.select` only. Those two work in
every mode, including ACP hosts. `ui.custom` appears only in the vendored
`questionnaire.ts`, `todo.ts` and background-tasks code. The split is enforced by
`tests/unit/ui-prompt-surface-lint.test.ts`.

## Cache safety

No volatile UI value (mode, tokens left, changed files, agent count) reaches the
system prompt or the tool list. Offline proof:
`tests/integration/ui-prompt-stability.test.ts`. Live proof is `RB-11-03`:

```sh
sh scripts/ui-wire-check.sh --probe <text>
```

It reads the already-redacted `.pi/logs/` files, compares system-prompt hashes
across requests, searches the requests for probe text, and reports the turn-2
`cacheRead` ratio. It sends nothing anywhere. Set `showCacheMissNotices: true` in
your global settings for a run if you want Pi to flag a miss as it happens.
