# AGENTS.md

This repository uses `skillspm` to manage a declarative Skills environment.

## Core principle

The source of truth is `skills.yaml`.

Agents should treat `skills.yaml` as the authoritative definition of the Skills environment.

Typical workflow:

1. install from `skills.yaml`
2. inspect or diagnose if needed
3. sync installed Skills to configured targets
4. freeze the resolved state when explicitly requested

## Primary commands

Use these commands as the default workflow:

```bash
skillspm install
skillspm doctor --json
skillspm sync
skillspm inspect <path> --write
skillspm freeze
```

## Repository setup behavior

When this repository contains a `skills.yaml` file, an agent should usually run:

```bash
skillspm install
skillspm doctor --json
```

If targets are already configured in `skills.yaml`, the agent may also run:

```bash
skillspm sync
```

## Scope rules

Default to project scope.

That means:

- read `./skills.yaml`
- install into `./.skills/`
- freeze into `./skills.lock`

Only use global scope when the user explicitly asks for it.

Examples:

```bash
skillspm install -g
skillspm sync -g
skillspm freeze -g
```

Do not switch to `-g` on your own.

## When to use each command

### `skillspm install`

Use when:

- `skills.yaml` exists and the environment needs to be installed
- the user asks to set up the repo
- the user changes `skills.yaml` and wants the environment applied

### `skillspm doctor --json`

Use when:

- install or sync fails
- the user asks why something is not working
- the environment needs a machine-readable diagnosis

### `skillspm sync`

Use when:

- installed Skills should be pushed to configured targets
- the user asks to make the current Skills available in one or more agents

### `skillspm import --from <source>`

Use when:

- the user wants to adopt an existing Skills setup
- the user wants to bring Skills in from OpenClaw or another supported source

Typical follow-up after import:

```bash
skillspm install
skillspm sync
```

### `skillspm inspect <path> --write`

Use when:

- a raw skill folder was created manually or by AI
- a skill folder is missing metadata
- the user wants to normalize a skill into a managed form

### `skillspm freeze`

Use when:

- the user explicitly wants to update `skills.lock`
- the installed environment should be frozen after changes
- reproducibility is important and the resolved state should be recorded

Do not run `freeze` automatically unless the user asks, or the workflow clearly requires updating the lockfile.

## File responsibilities

### `skills.yaml`

Defines the desired Skills environment.

It may declare:

- root skills
- local paths
- declared sources
- targets
- optional settings such as `auto_sync`

### `.skills/`

This is the local installed workspace.

It contains the installed results of `skillspm install`.

Agents should understand:

- sources are declared in `skills.yaml`
- installed results live in `.skills/`
- sync pushes from `.skills/` to target agents

### `skills.lock`

This is the frozen resolved state.

Agents should not edit `skills.lock` by hand unless explicitly asked.

Preferred behavior:

- `install` resolves
- `freeze` writes lockfile

### `skill.yaml`

This is per-skill metadata, not the top-level environment definition.

Agents may create or update it through:

```bash
skillspm inspect <path> --write
```

Do not treat `skill.yaml` as a replacement for `skills.yaml`.

## Source rules

`skillspm install` only installs Skills from sources declared in `skills.yaml`.

Agents must not assume hidden or implicit sources.

Current expected source patterns include:

- local path entries
- declared local source files
- other explicitly declared sources supported by the current release

Do not invent or substitute new sources unless the user explicitly asks.

## Safe editing rules

Agents should prefer:

- editing `skills.yaml` when changing the desired environment
- running `skillspm install` after environment changes
- running `skillspm freeze` only when the resolved state should be updated

Agents should avoid:

- hand-editing `skills.lock`
- changing `.skills/` manually
- rewriting source layouts without being asked
- switching project/global scope without explicit instruction

## Recommended default sequences

### Set up this repository

```bash
skillspm install
skillspm doctor --json
```

If targets are configured:

```bash
skillspm sync
```

### Add or normalize a raw skill folder

```bash
skillspm inspect ./path-to-skill --write
skillspm install
```

### Adopt an existing setup

```bash
skillspm import --from openclaw
skillspm install
skillspm sync
```

### Update the frozen state

```bash
skillspm freeze
```

## Human override rule

If repository instructions, README guidance, and direct user instructions conflict, prefer them in this order:

1. direct user instruction
2. repository-specific instructions in this file
3. repository README examples
4. default `skillspm` behavior
