# skillspm

`skillspm` manages declarative Skills environments with a minimal project manifest and a machine-local library cache.

## 0.3.0 model

Project truth lives in:

- `skills.yaml`
- `skills.lock`

Machine-local state lives in:

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

`skills.yaml` is intentionally minimal: it keeps only `skills` and optional `targets`.

`skills.lock` records the exact resolved versions under its `skills` map.

The machine-local library is not project truth. It is the local materialization layer used by `install`, `pack`, `adopt`, and `sync`.

`skillspm install` is source-aware. It reuses the machine-local cache on hit, and on cache miss it falls back to pack contents, then supported recorded sources when available. The cache is not a required prerequisite for install.

In this branch, the only reusable recorded sources are local paths and adopted target paths already captured in `~/.skillspm/library.yaml`. Provider-backed ids are still installable from cache or from a pack, but they are not refetched directly because no provider fetch provenance is persisted in project truth.

## Manifest

```yaml
skills:
  - id: local/example
    version: 0.1.0
  - id: github:owner/repo/skill
    version: ^1.2.0
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

## Public commands

- `skillspm add <content>`
- `skillspm install [input]`
- `skillspm pack [out]`
- `skillspm freeze`
- `skillspm adopt [source]`
- `skillspm sync [target]`
- `skillspm doctor`
- `skillspm help [command]`

## Unified `add` entrypoint

`skillspm add <content>` auto-detects input in this order:

1. explicit local path (`./`, `../`, `/`, `file://`)
2. existing local path from the current working directory
3. `https://github.com/...` URL
4. provider-prefixed or plain skill id

`--provider <provider>` is a first-class user choice for non-path inputs. You can supply it proactively even when not strictly required.

If you omit `--provider` and the input could reasonably match multiple providers, `skillspm add` fails and asks you to choose a provider explicitly.

Examples:

```bash
skillspm add ./skills/my-skill
skillspm add owner/repo/skill --provider github
skillspm add https://github.com/owner/repo/tree/main/skills/my-skill
skillspm add example/skill --provider openclaw
skillspm add github:owner/repo/skill
skillspm add openclaw:example/skill@^1.0.0
```

For local paths, `add` materializes the skill into `~/.skillspm/library.yaml` and `~/.skillspm/skills/`, then writes only `id` and `version` into `skills.yaml`.

## `adopt` and `sync`

`adopt` and `sync` use a direct target-object UX.

Examples:

```bash
skillspm adopt openclaw
skillspm adopt openclaw,codex
skillspm sync claude_code
skillspm sync openclaw,codex
```

`adopt` can also take a local directory path instead of a target name. When the source is a local path or known target, that source path is recorded in the machine-local library so later installs can recover from cache misses.

## `install` input precedence

`skillspm install` selects input in this order:

1. explicit path to `skills.yaml` or `*.skillspm.tgz`
2. current scope `skills.yaml`
3. exactly one current-directory `*.skillspm.tgz`

If multiple local packs exist, install fails closed.

After choosing the input, `install` materializes each locked skill in this order:

1. reuse the machine-local cache on hit
2. on cache miss, fall back to pack contents
3. on pack miss, fall back to recorded local/target source paths
4. fail only after cache lookup, pack lookup, and source resolution fail

## Pack format

A `.skillspm.tgz` pack contains:

- `skills.yaml`
- `skills.lock`
- internal `manifest.yaml`
- `skills/` with exact cached skill payloads

`manifest.yaml` is internal pack metadata, not user-facing environment truth.

## Doctor scope

`skillspm doctor` explicitly checks:

- manifest contract
- lockfile presence and contents
- machine-local library/cache availability
- pack readiness
- sync target containment and host compatibility
- project/global manifest conflicts

Use `skillspm doctor --json` for machine-readable diagnostics.

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
skillspm doctor
skillspm sync openclaw
skillspm freeze
```
