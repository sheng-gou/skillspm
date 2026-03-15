# skillspm

`skillspm` manages declarative Skills environments with an id-first manifest and a machine-local library cache.

## 0.3.0 Phase 2 model

Project truth lives in:

- `skills.yaml`
- `skills.lock`

Machine-local cache lives in:

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

`skills.yaml` keeps only root `skills` and `targets`.

`skills.lock` keeps only exact resolved skill versions.

The library cache is not environment truth. It is a local materialization store used by `install`, `pack`, and `sync`.

## Manifest

```yaml
schema: skills/v2
skills:
  - id: local/example
    path: ./skills/example
  - id: github:owner/repo/skill
targets:
  - type: openclaw
  - type: generic
    path: ./agent-skills
```

## Lockfile

```yaml
schema: skills-lock/v2
skills:
  local/example: 0.1.0
  github:owner/repo/skill: 1.2.3
```

## Commands

Public help centers on:

- `skillspm add`
- `skillspm install`
- `skillspm pack`
- `skillspm freeze`
- `skillspm adopt`
- `skillspm sync`
- `skillspm doctor`
- `skillspm help`

## Install input precedence

`skillspm install` selects input in this order:

1. explicit path to `skills.yaml` or `*.skillspm.tgz`
2. current scope `skills.yaml`
3. exactly one current-directory `*.skillspm.tgz`

If multiple local packs exist, install fails closed.

## Pack format

A `.skillspm.tgz` pack contains:

- `skills.yaml`
- `skills.lock`
- `manifest.yaml` for internal validation
- `skills/` with exact cached skill payloads

`manifest.yaml` is internal pack metadata, not user-facing environment truth.

## Sync behavior

`skillspm sync` writes the currently locked skills into configured agent targets.

By default it is non-destructive:

- it updates the locked skill entries it manages
- it does not prune unrelated or unmanaged target contents
- it fails closed before writing if a resolved target path escapes its allowed containment root

## Typical flow

```bash
skillspm add ./skills/my-skill
skillspm install
skillspm sync
skillspm freeze
```
