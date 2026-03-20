# HUMAN.md

This repository uses `skillspm` to manage a declarative Skills environment.

## 0.4.0 contract in one view

Project intent lives in:

- `skills.yaml`

Confirmed state lives in:

- `skills.lock`

Machine-local state lives in:

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

Restore artifacts live in `.skillspm.tgz` packs.

In short:

- `skills.yaml` = project intent, with desired `skills`, optional per-root `source`, and optional `targets`
- `skills.lock` = confirmed state: exact accepted version, digest, and resolved-from provenance
- `~/.skillspm/*` = machine-local cache/materialization used by `install`, `pack`, `adopt`, and `sync`
- `.skillspm.tgz` = confirmed-state restore vehicle, not project truth

This is a self-sufficient install-from-persisted-sources model: `install` prefers confirmed state plus cache first, then falls back to pack contents or recorded manifest/library sources when it must re-materialize.

The cache is not the source of truth for the project.

## Most important commands

```bash
skillspm add <content>
skillspm inspect
skillspm install [input]
skillspm pack [out]
skillspm freeze
skillspm adopt [source]
skillspm sync [target]
skillspm doctor
skillspm help [command]
```

## What each command does

### `skillspm add <content>`

Unified entrypoint for local paths, GitHub inputs, and provider-backed ids.

Examples:

```bash
skillspm add ./skills/my-skill
skillspm add owner/repo/skill --provider github
skillspm add example/skill --provider openclaw
```

For local paths, `add` materializes the skill into the machine-local library and also writes the minimal reusable `source` block into `skills.yaml` alongside `id` and `version` so later installs can re-materialize on cache miss without assuming prior local library state.

### `skillspm inspect`

Explains the current project state in user language: intent, confirmed state, drift, and next safe actions.

Use this before `freeze`, `sync`, or `pack` when you want to know whether the project is still in Development, Drifted Development, or Confirmed state.

### `skillspm install [input]`

Reads project intent from `skills.yaml`, reproduces confirmed state from `skills.lock` when available, and reuses machine-local materializations safely.

Input precedence is:

1. explicit path to `skills.yaml` or `*.skillspm.tgz`
2. current-scope `skills.yaml`
3. exactly one current-directory `*.skillspm.tgz`

If multiple local packs exist, install fails closed.

Install order is:

1. read desired skills from `skills.yaml`
2. use `skills.lock` to reproduce exact version+digest when present
3. reuse the machine-local library on exact match
4. on cache miss, fall back to pack contents
5. on pack miss, fall back to recorded manifest/library source paths (local, target, or supported public-provider provenance)
6. if `skills.lock` recorded `resolved_from.type=provider` with a canonical public `github:` id or anonymous public `https://github.com/...` locator, try that lockfile-backed public recovery first
7. otherwise, if `library.yaml` recorded public provider provenance, use that provenance on cache miss (`github` can keep an exact ref; `openclaw` / `clawhub` / `skills.sh` keep the original provider id plus a backing public GitHub locator)
8. otherwise, if the skill id itself is a supported public provider id (`github:...`, `openclaw:...`, `clawhub:...`, `skills.sh:...`), infer an exact public version and backing locator from project semantics, then recover through unauthenticated public tag fetches
9. reject the recovery if any symlink exists anywhere under the recovered provider skill root
10. fail closed on digest mismatch instead of silently accepting drift

Manifest-based install consumes confirmed state by default when `skills.lock` is aligned, but it may still materialize current intent locally in Development or Drifted Development without refreshing confirmation. Public provider recovery is intentionally narrow here: only public GitHub-backed providers (`github`, `openclaw`, `clawhub`, `skills.sh`) are recoverable this way, only through unauthenticated access. Private repos, authenticated provider flows, non-public visibility, and plain git inputs still require an existing cache entry or a pack.

### `skillspm pack [out]`

Bundles the current confirmed environment into a portable `.skillspm.tgz` file for private/local/offline distribution and recovery.

A pack contains:

- `skills.yaml`
- `skills.lock`
- internal `manifest.yaml`
- `skills/` with exact cached skill payloads

`pack` should refuse when confirmation is missing or stale.

### `skillspm freeze`

Explicitly refreshes `skills.lock` to the accepted current result.

Use this when you intentionally want to confirm the current resolved state.

### `skillspm adopt [source]`

Discovers existing skills and merges them into `skills.yaml`.

Examples:

```bash
skillspm adopt openclaw
skillspm adopt openclaw,codex
skillspm adopt ./agent-skills
```

### `skillspm sync [target]`

Writes the confirmed skills into one or more targets from the local library cache.

Examples:

```bash
skillspm sync openclaw
skillspm sync claude_code
skillspm sync openclaw,codex
```

By default, sync is non-destructive: it updates managed locked entries and does not prune unrelated target contents.

`sync` should refuse when confirmation is missing or stale.

### `skillspm doctor`

Checks manifest, lockfile, library/cache, pack readiness, targets, and project/global conflicts.

Use `skillspm doctor --json` when you want machine-readable diagnostics.

## Typical workflows

### Set up this repository

```bash
skillspm install
skillspm inspect
```

If you changed intent and want to confirm the accepted result:

```bash
skillspm install
skillspm freeze
```

If targets are configured and should be updated:

```bash
skillspm sync openclaw
```

To create a portable restore bundle from confirmed state:

```bash
skillspm pack
```

Use `skillspm doctor --json` when you need validation-oriented diagnostics beyond the user-facing `inspect` summary.

### Add a new root skill

```bash
skillspm add ./skills/my-skill
skillspm install
```

## Files and responsibilities

### `skills.yaml`

Defines project intent for the Skills environment.

Keep root `skills`, optional per-root `source`, and optional `targets` here.

### `skills.lock`

Stores confirmed state for the environment.

In most cases, do not edit this file by hand. Use `skillspm freeze`.

## Source and scope rules

`skillspm install` works from explicit manifest or pack input, or from the current-scope `skills.yaml`.

Do not treat the machine-local cache as a project workspace.

Use `-g` only when you explicitly want global scope.

## When changing this project

If you change command behavior or user-facing workflow, keep these files aligned:

- `README.md`
- `README.zh-CN.md`
- `AGENTS.md`
- `HUMAN.md`

## In one sentence

Think of `skillspm` as a reproducible Skills environment manager centered on project intent in `skills.yaml`, confirmed state in `skills.lock`, and a machine-local cache/materialization layer under `~/.skillspm/`.
