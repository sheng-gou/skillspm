# skillspm

`skillspm` manages declarative Skills environments with a minimal project manifest, an exact lockfile, and a machine-local materialization cache.

## 0.3.0 model

Project truth lives in:

- `skills.yaml`
- `skills.lock`

Machine-local state lives in:

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

`skills.yaml` is intentionally minimal: it keeps only the desired `skills` and optional `targets`.

`skills.lock` records the exact locked result identity for each skill: exact version, content digest, and resolution provenance.

The machine-local library is not project truth. It is the local cache/materialization layer used by `install`, `pack`, `adopt`, and `sync`.

`skillspm install` reads `skills.yaml`, consults `skills.lock` when present, checks the machine-local library for an exact content match, and only falls back to pack contents or recorded local/target sources on cache miss. Recorded public GitHub provider sources can also re-materialize on cache miss when `~/.skillspm/library.yaml` contains sufficient machine-local provider provenance, but only through unauthenticated access and only when the recovered skill root is symlink-free. Digest mismatches fail closed instead of silently accepting drift.

Provider recovery is intentionally narrow in this branch: only recorded public `github:` sources with an exact persisted ref are re-fetchable. The recovery path disables credential helpers, askpass hooks, and terminal prompting so private/authenticated GitHub access fails closed honestly. Plain git URLs, vague provider ids, and private/authenticated GitHub flows still require an existing cache entry or a pack.

When a machine-local provider entry is sufficient for recovery, it looks like this in `~/.skillspm/library.yaml`:

```yaml
source:
  kind: provider
  value: github:owner/repo/skills/demo
  provider:
    name: github
    ref: refs/tags/v1.2.3
    visibility: public
```

`skillspm pack` is a transport and recovery supplement for private, local, offline, or cross-machine workflows. It does not redefine the source model or replace `skills.yaml`/`skills.lock` as project truth.

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
schema: skills-lock/v3
skills:
  local/example:
    version: 0.1.0
    digest: sha256:1111111111111111111111111111111111111111111111111111111111111111
    resolved_from:
      type: local
      ref: ./skills/local-example
  "github:owner/repo/skill":
    version: 1.2.3
    digest: sha256:2222222222222222222222222222222222222222222222222222222222222222
    resolved_from:
      type: pack
      ref: github__owner__repo__skill@1.2.3
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

After choosing the input, `install` processes each skill in this order:

1. read the desired skill ids/ranges from `skills.yaml`
2. use `skills.lock` to reproduce exact version+digest when present
3. reuse the machine-local library on exact content match
4. on cache miss, fall back to pack contents
5. on pack miss, fall back to recorded local/target source paths
6. if `library.yaml` recorded a public `github:` source with exact ref provenance, re-materialize it into the local cache through unauthenticated public GitHub access only
7. reject the recovery if any symlink exists anywhere under the recovered provider skill root
8. fail closed on digest mismatch instead of silently accepting drift

## Pack format

A `.skillspm.tgz` pack contains:

- `skills.yaml`
- `skills.lock`
- internal `manifest.yaml`
- `skills/` with exact cached skill payloads

`manifest.yaml` is internal pack metadata, not user-facing environment truth.

Packs are for transport, private/local/offline distribution, and recovery. They supplement the normal install flow; they are not a new persistent source type.

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
