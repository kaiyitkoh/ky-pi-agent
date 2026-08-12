# ky-pi-agent

A personalised coding-agent harness built on [Pi](https://pi.dev).

**Status: work in progress. Nothing here is finished or verified. There is no
usable release yet.**

## What this is

A configuration and extension layer over Pi — model routing, quality gates,
subagents, workflows, and safety rules — packaged as a single repo.

The goal is to make cheap models produce work you would trust from an expensive
one, without the harness itself becoming the bottleneck. The intended daily
driver is a low-cost model, with stronger models reserved for the specific
points where they earn their cost.

It is being built for one person's workflow. It is public because there is no
reason for it not to be, not because it is intended as a general-purpose tool.

## Intended usage

Once there is something to install:

```
pi install https://github.com/kaiyitkoh/ky-pi-agent
```

The repo is also intended to be bootstrappable directly on a machine with
nothing but Pi installed.

Neither path works yet.

## Platform

Targets Windows (via Git Bash) and macOS. Shell code is POSIX `sh`.

## Secrets

This is a public repository. No credentials are committed. Provider
configuration is kept structurally complete with values resolved at runtime
from the environment.

## License

See [LICENSE](LICENSE). Pi itself is MIT-licensed and is a separate project by
Mario Zechner / Earendil Works.

---

This README will be rewritten as the project takes shape.
