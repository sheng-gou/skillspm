# HUMAN.md

Hi, I'm the maintainer of `skills`.

This file is for human readers.

If you are looking for project usage, start with:

- [README.md](README.md)
- [README.zh-CN.md](README.zh-CN.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)

If you are an agent or working on agent-facing behavior, also read:

- [AGENTS.md](AGENTS.md)

## Why I built this

I built `skills` because managing Skills across different AI coding agents still feels messy.

In practice, teams often need to:

- define a reusable Skills environment
- install it consistently
- freeze it into a reproducible state
- sync it across agents
- import existing setups instead of rebuilding from scratch

`skills` is my attempt to make that workflow simpler and more explicit.

## What this project is trying to be

`skills` is intended to be a package-manager-style CLI for reusable Skills environments for AI agents.

At the center of that idea is:

- `skills.yaml` as the source of truth for the desired environment
- `skills.lock` as the frozen resolved state

The main workflow is intentionally small:

- install
- freeze
- sync
- import
- inspect

## What this project is not trying to be (yet)

Right now, `skills` is not trying to be:

- a full remote registry platform
- a hosted marketplace
- a polished enterprise control plane
- an everything-for-everyone agent framework

It is still early, and the goal is to get the core environment workflow right first.

## How feedback is most helpful

The most useful feedback usually comes from real usage.

Examples:

- “I tried this with OpenClaw and Codex, and this step was confusing.”
- “This command worked, but I expected a different lockfile result.”
- “I wanted to import an existing setup, but didn’t know what source format to use.”
- “This part is easy for humans but awkward for agents.”

Clear bug reports, workflow feedback, and focused suggestions are all very welcome.

## If you want to contribute

Please read:

- [CONTRIBUTING.md](CONTRIBUTING.md)

If your change affects user-facing workflows, please also check:

- [README.md](README.md)
- [README.zh-CN.md](README.zh-CN.md)

If your change affects agent-facing workflows, please also check:

- [AGENTS.md](AGENTS.md)

## A note on scope

This project may evolve over time, but I want to keep the core idea understandable.

If a feature makes the main workflow harder to explain, it should probably be questioned before it is added.

## Thanks

Thanks for reading, trying the project, opening issues, sharing workflows, and helping improve it.
