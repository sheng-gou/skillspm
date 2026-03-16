# AGENTS.md

This repository uses `skillspm` to manage a declarative Skills environment.

## 0.3.0 contract

Project truth lives in:

- `skills.yaml`
- `skills.lock`

Machine-local state lives in:

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

`skills.yaml` is intentionally minimal: only `skills` and optional `targets` belong there.

`skills.lock` keeps exact locked result identity under its `skills` map.

The machine-local library is not project truth. It is the local cache/materialization layer used by `install`, `pack`, `adopt`, and `sync`.

## Default workflow for agents

Use this sequence unless the user asks for something different:

1. `skillspm install`
2. `skillspm doctor --json` when validation or diagnosis is needed
3. `skillspm sync <target>` only when configured targets should be updated
4. `skillspm freeze` only when the task explicitly requires updating `skills.lock`

## Public command surface

Treat these as the current public commands:

```bash
skillspm add <content>
skillspm install [input]
skillspm pack [out]
skillspm freeze
skillspm adopt [source]
skillspm sync [target]
skillspm doctor
skillspm help [command]
```

Do not rely on removed command names in plans, examples, or repo guidance.

## Command intent

### `skillspm add <content>`

Unified public entrypoint for local paths, GitHub inputs, and provider-backed ids.

`--provider <provider>` is a first-class user choice for non-path inputs. Use it proactively when you want to force a provider interpretation.

If a non-path input could match multiple providers and `--provider` is omitted, `skillspm add` should fail and ask the user to choose.

For local paths, `add` should materialize into the machine-local library and then persist only `id` and `version` into `skills.yaml`.

### `skillspm install [input]`

Read the declared environment from `skills.yaml`, reproduce exact locked results when available, and cache materialized skills locally.

Input precedence is:

1. explicit path to `skills.yaml` or `*.skillspm.tgz`
2. current-scope `skills.yaml`
3. exactly one current-directory `*.skillspm.tgz`

If multiple local packs exist, install fails closed.

### `skillspm pack [out]`

Bundle the current locked environment into a portable `.skillspm.tgz` pack for private/local/offline distribution and recovery.

A pack contains:

- `skills.yaml`
- `skills.lock`
- internal `manifest.yaml`
- `skills/` with exact cached skill payloads

`manifest.yaml` is internal pack metadata, not user-editable environment truth.

### `skillspm freeze`

Rewrite `skills.lock` with exact locked result identity.

Do not run `freeze` automatically unless the task clearly requires updating the lockfile.

### `skillspm adopt [source]`

Discover existing skills and merge them into `skills.yaml`.

Prefer direct examples such as:

- `skillspm adopt openclaw`
- `skillspm adopt openclaw,codex`
- `skillspm adopt ./agent-skills`

### `skillspm sync [target]`

Sync locked skills from the local library cache to one or more targets.

Prefer direct examples such as:

- `skillspm sync openclaw`
- `skillspm sync claude_code`
- `skillspm sync openclaw,codex`

Default sync is non-destructive:

- it updates the locked skill entries it manages
- it does not prune unrelated target contents
- it fails closed before writing if a target path escapes its allowed containment root

### `skillspm doctor`

Check manifest, lockfile, library/cache, pack readiness, targets, and project/global conflicts.

Use `--json` when machine-readable diagnostics help the workflow.

## File responsibilities

### `skills.yaml`

Defines the desired Skills environment for this project.

Agents should only persist root `skills` and optional `targets` here.

Do not put local path or source provenance into this file.

### `skills.lock`

Stores the exact locked result identity for the environment.

Agents should not hand-edit `skills.lock` unless explicitly asked.

## Safe behavior

Agents should prefer:

- editing `skills.yaml` when changing the desired environment
- running `skillspm install` after manifest changes
- running `skillspm sync <target>` only when target updates are intended
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
