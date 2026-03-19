# skillspm

The source of truth is skills.yaml.

Install from it, freeze it, and sync it across agents and projects.

Build reproducible, portable Skills environments for your agents.

`skillspm` manages declarative Skills environments with a minimal project manifest, an exact lockfile, and a machine-local materialization cache.

## What you can do with skillspm

### Case 1: Reproduce an environment from project truth

Keep the desired environment in `skills.yaml`, run `skillspm install`, and let the lockfile plus local cache reproduce exact materialized skills when available.

### Case 2: Lock the exact result identity you want to keep

Use `skillspm freeze` when you intentionally want to record the exact resolved version, digest, and provenance for each skill in `skills.lock`.

### Case 3: Sync one locked environment across agents and projects

Use `skillspm sync <target>` to push the currently locked skills into configured targets without treating those targets as the source of truth.

### Case 4: Carry a portable pack for private, offline, or cross-machine recovery

Use `skillspm pack` to bundle the current locked environment into a `.skillspm.tgz` file for transport and recovery when cache or public recovery paths are not enough.

### Case 5: Bring existing skills under management

Use `skillspm add <content>` for local paths, GitHub inputs, and provider-backed ids, or `skillspm adopt [source]` to merge existing target contents into `skills.yaml`.

### Case 6: Mix local, target, and supported public-provider sources honestly

`skillspm` can recover from persisted sources, but the clean-machine public recovery boundary is intentionally narrow: only public GitHub-backed providers are covered, only through unauthenticated access, and digest mismatches fail closed.

## Quick start

Minimal `skills.yaml`:

```yaml
skills:
  - id: local/example
    version: 0.1.0
    source:
      kind: local
      value: ./skills/local-example
targets:
  - type: openclaw
```

Then run the core lifecycle:

```bash
skillspm install
skillspm freeze
skillspm sync openclaw
skillspm pack
```

What this proves:

- `install` materializes the declared environment from `skills.yaml`
- `freeze` records exact locked result identity in `skills.lock`
- `sync` updates configured agent targets from the locked environment
- `pack` creates a portable recovery bundle for private/local/offline use

## Common workflows

### Set up this repository or any checked-in Skills project

```bash
skillspm install
skillspm doctor --json
```

If configured targets should be updated:

```bash
skillspm sync openclaw
```

### Add or migrate a skill into the environment

```bash
skillspm add ./skills/my-skill
skillspm install
skillspm freeze
```

Mixed-source examples are supported, but they are still persisted back into the same project truth:

```bash
skillspm add owner/repo/skill --provider github
skillspm add example/skill --provider openclaw
skillspm add https://github.com/owner/repo/tree/main/skills/my-skill
```

### Adopt existing target contents into project truth

```bash
skillspm adopt openclaw
skillspm install
```

### Prepare a shareable pack

```bash
skillspm install
skillspm freeze
skillspm pack dist/team-env.skillspm.tgz
```

## Core commands

- `skillspm add <content>`: add a local path, GitHub input, or provider-backed id into `skills.yaml`
- `skillspm install [input]`: materialize the declared environment from `skills.yaml` or a pack
- `skillspm pack [out]`: bundle the current locked environment into a portable `.skillspm.tgz`
- `skillspm freeze`: rewrite `skills.lock` with exact locked result identity
- `skillspm adopt [source]`: discover existing skills and merge them into `skills.yaml`
- `skillspm sync [target]`: sync locked skills from the local library cache to one or more targets
- `skillspm doctor`: check manifest, lockfile, cache, pack readiness, targets, and conflicts
- `skillspm help [command]`: show command help

## `skills.yaml`

`skills.yaml` is the source of truth for the desired environment.

It is intentionally minimal: it keeps desired `skills`, optional per-root `source`, and optional `targets`.

Example:

```yaml
skills:
  - id: local/example
    version: 0.1.0
    source:
      kind: local
      value: ./skills/local-example
  - id: github:owner/repo/skill
    version: ^1.2.0
targets:
  - type: openclaw
  - type: generic
    path: ./agent-skills
```

## `skills.lock`

`skills.lock` stores the exact locked result identity for the environment.

It records exact version, content digest, and resolution provenance under its `skills` map.

Example:

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

## Machine-local library

Machine-local state lives in:

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

The machine-local library is not project truth. It is the local cache/materialization layer used by `install`, `pack`, `adopt`, and `sync`.

When a machine-local provider entry is available, it can record either direct GitHub provenance or a provider-preserving record in `~/.skillspm/library.yaml`:

```yaml
source:
  kind: provider
  value: openclaw:example/demo
  provider:
    name: openclaw
    ref: github:owner/repo/skills/demo
    visibility: public
```

A direct public GitHub provenance record remains valid too:

```yaml
source:
  kind: provider
  value: github:owner/repo/skills/demo
  provider:
    name: github
    ref: refs/tags/v1.2.3
    visibility: public
```

Recorded public GitHub provider provenance may also use an anonymous public GitHub URL as either `source.value` (for `github`) or `source.provider.ref` (for provider-preserving records), for example `https://github.com/owner/repo/tree/main/skills/demo`. URL-embedded credentials are not supported.

## Pack

`skillspm pack` is a core transport and recovery capability for private, local, offline, and cross-machine workflows.

A `.skillspm.tgz` pack contains:

- `skills.yaml`
- `skills.lock`
- internal `manifest.yaml`
- `skills/` with exact cached skill payloads

`manifest.yaml` is internal pack metadata, not user-facing environment truth.

Packs supplement the normal install flow. They do not redefine the source model or replace `skills.yaml` / `skills.lock` as project truth.

## Recovery boundary

`skillspm install` reads `skills.yaml`, consults `skills.lock` when present, checks the machine-local library for an exact content match, and only falls back to pack contents or recorded manifest/library sources on cache miss.

Clean machines can also re-materialize public provider-backed sources from `skills.lock` when `resolved_from.type=provider` and `resolved_from.ref` is either a canonical `github:` locator or an anonymous public `https://github.com/...` locator.

Recorded provider provenance can keep the original provider id (`openclaw:...`, `clawhub:...`, `skills.sh:...`) while persisting the backing public GitHub locator used for re-materialization. Canonical public `github:` skills and provider-backed public skills remain recoverable through unauthenticated public tag fetches.

Recovered provider skill roots must be symlink-free. Digest mismatches fail closed instead of silently accepting drift.

Provider recovery is still intentionally narrow in this branch: clean-machine fallback only covers public GitHub-backed providers (`github`, `openclaw`, `clawhub`, `skills.sh`) and only through unauthenticated access. `skills.sh:` ids resolve through their public GitHub repo/path semantics; `openclaw:` / `clawhub:` ids resolve through public provider metadata and then pin to a public GitHub backing locator. The recovery path disables credential helpers, askpass hooks, and terminal prompting so private/authenticated GitHub access fails closed honestly. Private repos, authenticated provider flows, non-public visibility, and plain git inputs still require an existing cache entry or a pack.

## Current 0.3.0 contract

### Unified `add` entrypoint

`skillspm add <content>` auto-detects input in this order:

1. explicit local path (`./`, `../`, `/`, `file://`)
2. existing local path from the current working directory
3. `https://github.com/...` URL
4. provider-prefixed or plain skill id

`--provider <provider>` is a first-class user choice for non-path inputs. You can supply it proactively even when not strictly required.

If you omit `--provider` and the input could reasonably match multiple providers, `skillspm add` fails and asks you to choose a provider explicitly.

Public `github:` ids and `https://github.com/...` locators must stay canonical: no credentials, query strings, fragments, dot segments, encoded separators, backslashes, or empty path segments.

Examples:

```bash
skillspm add ./skills/my-skill
skillspm add owner/repo/skill --provider github
skillspm add https://github.com/owner/repo/tree/main/skills/my-skill
skillspm add example/skill --provider openclaw
skillspm add github:owner/repo/skill
skillspm add openclaw:example/skill@^1.0.0
skillspm add clawhub:example/skill --install
skillspm add skills.sh:owner/repo/skill --install
```

For local paths, `add` materializes the skill into `~/.skillspm/library.yaml` and `~/.skillspm/skills/`, and it also persists the minimal reusable `source` block into `skills.yaml` so later installs can re-materialize on cache miss without assuming prior local library state.

### `install` input precedence

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
5. on pack miss, fall back to recorded manifest/library source paths (local, target, or supported public-provider provenance)
6. if `skills.lock` recorded `resolved_from.type=provider` with a canonical public `github:` id or anonymous public `https://github.com/...` locator, try that lockfile-backed public recovery first
7. otherwise, if `library.yaml` recorded public provider provenance, use that provenance on cache miss (`github` can keep an exact ref; `openclaw` / `clawhub` / `skills.sh` keep the original provider id plus a backing public GitHub locator)
8. otherwise, if the skill id itself is a supported public provider id (`github:...`, `openclaw:...`, `clawhub:...`, `skills.sh:...`), infer an exact public version and backing locator from project semantics, then recover through unauthenticated public tag fetches
9. reject the recovery if any symlink exists anywhere under the recovered provider skill root
10. fail closed on digest mismatch instead of silently accepting drift

### `adopt` and `sync`

`adopt` and `sync` use a direct target-object UX.

Examples:

```bash
skillspm adopt openclaw
skillspm adopt openclaw,codex
skillspm sync claude_code
skillspm sync openclaw,codex
```

`adopt` can also take a local directory path instead of a target name. When the source is a local path or known target, that source path is recorded in both project `skills.yaml` and the machine-local library so later installs can recover from cache misses on a clean library as long as the source path still exists.

`skillspm sync` writes the currently locked skills into configured agent targets.

By default it is non-destructive:

- it updates the locked skill entries it manages
- it does not prune unrelated or unmanaged target contents
- it fails closed before writing if a resolved target path escapes its allowed containment root

### Doctor scope

`skillspm doctor` explicitly checks:

- manifest contract
- lockfile presence and contents
- machine-local library/cache availability
- pack readiness
- sync target containment and host compatibility
- project/global manifest conflicts

Use `skillspm doctor --json` for machine-readable diagnostics.
