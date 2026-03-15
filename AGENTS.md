# AGENTS.md

This repository uses `skillspm` to manage a declarative Skills environment.

## Phase 2 contract

Project truth lives in:

- `skills.yaml`
- `skills.lock`

Machine-local cache lives in:

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

`skills.yaml` keeps the root `skills` and `targets` for the environment.

`skills.lock` keeps the exact resolved skill versions.

The library cache is not project truth. It is the local materialization layer used by `install`, `pack`, and `sync`.

## Default workflow for agents

Use this sequence unless the user asks for something different:

1. `skillspm install`
2. `skillspm doctor --json` if validation or diagnosis is needed
3. `skillspm sync` when configured targets should receive the locked skills
4. `skillspm freeze` only when the task explicitly requires updating `skills.lock`

## Public command surface

Treat these as the current public Phase-2 commands:

```bash
skillspm add
skillspm install
skillspm pack
skillspm freeze
skillspm adopt
skillspm sync
skillspm doctor
skillspm help
```

Do not rely on removed command names in plans, examples, or repo guidance.

## What each command is for

### `skillspm add`

Add a root skill entry to `skills.yaml`.

Use this when the desired environment should include a new skill id, version range, or local path.

### `skillspm install`

Resolve the declared environment and cache exact skills locally.

`skillspm install` selects input in this order:

1. explicit path to `skills.yaml` or `*.skillspm.tgz`
2. current-scope `skills.yaml`
3. exactly one current-directory `*.skillspm.tgz`

If multiple local packs exist, install fails closed.

### `skillspm pack`

Bundle the current locked environment into a portable `.skillspm.tgz` pack.

A pack contains:

- `skills.yaml`
- `skills.lock`
- internal `manifest.yaml`
- `skills/` with exact cached skill payloads

`manifest.yaml` is internal pack metadata, not user-editable environment truth.

### `skillspm freeze`

Rewrite `skills.lock` with exact resolved versions.

Do not run `freeze` automatically unless the task clearly requires updating the lockfile.

### `skillspm adopt`

Discover existing skills and merge them into `skills.yaml`.

Use this when the user wants to bring an existing setup under Phase-2 manifest management.

### `skillspm sync`

Sync locked skills from the local library cache to configured targets.

By default, `sync` is non-destructive:

- it updates the locked skill entries it manages
- it does not prune unrelated target contents
- it fails closed before writing if a target path escapes its allowed containment root

### `skillspm doctor`

Check manifest, lockfile, cache, and targets.

Use `--json` when machine-readable diagnostics help the workflow.

### `skillspm help`

Use for the current command surface, flags, and examples.

## File responsibilities

### `skills.yaml`

Defines the desired Skills environment for this project.

Agents should edit `skills.yaml` when changing root skills or targets.

### `skills.lock`

Stores the exact resolved versions for the environment.

Agents should not hand-edit `skills.lock` unless explicitly asked.

## Safe behavior

Agents should prefer:

- editing `skills.yaml` when changing the desired environment
- running `skillspm install` after manifest changes
- running `skillspm sync` only when target updates are intended
- running `skillspm freeze` only when lockfile updates are part of the task

Agents should avoid:

- treating cache contents as the source of truth
- hand-editing `skills.lock`
- changing machine-local cache contents directly
- switching scope with `-g` unless the user explicitly asks

## Human override rule

If repository instructions, README guidance, and direct user instructions conflict, prefer them in this order:

1. direct user instruction
2. repository-specific instructions in this file
3. repository README examples
4. default `skillspm` behavior
