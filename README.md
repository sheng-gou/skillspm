# skillspm

![SkillsPM social preview](./docs/social-preview.jpg)

Build reproducible, portable Skills environments with an explicit Development vs Confirmed state model.

`skillspm` keeps project intent in `skills.yaml`, confirmed state in `skills.lock`, and machine-local materialization in `~/.skillspm/*`.

`inspect` explains drift and next safe actions. `freeze` is the explicit confirmation refresh step. `install`, `sync`, and `pack` consume confirmed state by default.

## What you can do with skillspm

### [Development] Start or change the environment

Create or edit `skills.yaml` with `add`, `adopt`, or direct manifest changes. Then run `skillspm install` to materialize the current intent locally. If no confirmed state exists yet, the project remains in Development.

### [Development] Inspect drift and confirm accepted changes

Run `skillspm inspect` to see whether the project is Uninitialized, Development, Drifted Development, or Confirmed. When the current result is accepted, run `skillspm freeze` to refresh `skills.lock` explicitly.

### [Confirmed] Install or sync the confirmed environment

When `skills.yaml` and `skills.lock` are aligned, `skillspm install` reproduces the confirmed environment and `skillspm sync <target>` distributes it explicitly. Sync stays non-destructive and refuses when confirmation is missing or stale.

### [Confirmed] Pack and restore the confirmed environment

Use `skillspm pack` to bundle the confirmed environment into a `.skillspm.tgz` restore vehicle, then `skillspm install <pack>` to restore it elsewhere. Packs supplement recovery for private, local, offline, and cross-machine workflows; they do not become project truth.

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

Then use this onboarding path:

```bash
skillspm install
skillspm inspect
skillspm install
skillspm freeze
skillspm sync openclaw
skillspm pack
```

What each step means:

- first `install`: materialize current intent locally from `skills.yaml`
- `inspect`: check whether the project is still Development, Drifted Development, or Confirmed
- second `install`: re-materialize current intent if you made more changes before confirming
- `freeze`: explicitly refresh confirmed state in `skills.lock`
- `sync`: distribute the confirmed environment explicitly and non-destructively
- `pack`: create a confirmed-state restore bundle for transport and recovery

## Common workflows

### [Development] Start or change the environment

```bash
skillspm add ./skills/my-skill
skillspm install
```

You can also bring existing content under intent management:

```bash
skillspm adopt openclaw
skillspm install
```

Mixed-source intent is supported and persisted minimally in `skills.yaml`:

```bash
skillspm add owner/repo/skill --provider github
skillspm add example/skill --provider openclaw
skillspm add https://github.com/owner/repo/tree/main/skills/my-skill
```

### [Development] Inspect drift and confirm accepted changes

```bash
skillspm inspect
skillspm install
skillspm freeze
```

Use `inspect` as the user-facing drift entrypoint. `install` may materialize current intent locally, but `freeze` is the explicit step that refreshes confirmation.

### [Confirmed] Install or sync the confirmed environment

```bash
skillspm install
skillspm sync openclaw
```

Use `skillspm doctor --json` when you need validation-oriented diagnostics in addition to the user-facing `inspect` state summary.

### [Confirmed] Pack and restore the confirmed environment

```bash
skillspm pack dist/team-env.skillspm.tgz
skillspm install dist/team-env.skillspm.tgz
```

## Core commands

- `skillspm add <content>`: add a local path, GitHub input, or provider-backed id into `skills.yaml`
- `skillspm inspect`: explain current intent, confirmed state, drift, and next safe actions
- `skillspm install [input]`: consume confirmed state by default, while still materializing current intent locally when no confirmed state exists yet
- `skillspm pack [out]`: bundle the confirmed environment into a portable `.skillspm.tgz`
- `skillspm freeze`: explicitly refresh `skills.lock` to the accepted current result
- `skillspm adopt [source]`: discover existing skills and merge them into `skills.yaml`
- `skillspm sync [target]`: sync the confirmed environment from the local library cache to one or more targets
- `skillspm doctor`: check manifest, lockfile, cache, pack readiness, targets, and conflicts
- `skillspm help [command]`: show command help

## Project state model

- `skills.yaml` = intent for the project: desired root `skills`, optional per-root `source`, and optional `targets`
- `skills.lock` = confirmed state: exact accepted version, digest, and resolved-from provenance
- `~/.skillspm/*` = machine-local cache/materialization layer, never project truth
- `.skillspm.tgz` = confirmed-state restore vehicle, never the source of truth

## `skills.yaml`

`skills.yaml` defines project intent.

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

`skills.lock` stores confirmed state for the environment.

It records the exact accepted version, content digest, and resolution provenance under its `skills` map.

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

`skillspm pack` is a confirmed-state transport and recovery capability for private, local, offline, and cross-machine workflows.

A `.skillspm.tgz` pack contains:

- `skills.yaml`
- `skills.lock`
- internal `manifest.yaml`
- `skills/` with exact cached skill payloads

`manifest.yaml` is internal pack metadata, not user-facing environment truth.

Packs supplement the normal install flow. They do not redefine the source model or replace intent plus confirmed state as project truth.

## Recovery boundary

`skillspm install` reads `skills.yaml`, consults `skills.lock` when present, checks the machine-local library for an exact content match, and only falls back to pack contents or recorded manifest/library sources on cache miss.

Clean machines can also re-materialize public provider-backed sources from `skills.lock` when `resolved_from.type=provider` and `resolved_from.ref` is either a canonical `github:` locator or an anonymous public `https://github.com/...` locator.

Recorded provider provenance can keep the original provider id (`openclaw:...`, `clawhub:...`, `skills.sh:...`) while persisting the backing public GitHub locator used for re-materialization. Canonical public `github:` skills and provider-backed public skills remain recoverable through unauthenticated public tag fetches.

Recovered provider skill roots must be symlink-free. Digest mismatches fail closed instead of silently accepting drift.

Provider recovery is still intentionally narrow in this branch: clean-machine fallback only covers public GitHub-backed providers (`github`, `openclaw`, `clawhub`, `skills.sh`) and only through unauthenticated access. `skills.sh:` ids resolve through their public GitHub repo/path semantics; `openclaw:` / `clawhub:` ids resolve through public provider metadata and then pin to a public GitHub backing locator. The recovery path disables credential helpers, askpass hooks, and terminal prompting so private/authenticated GitHub access fails closed honestly. Private repos, authenticated provider flows, non-public visibility, and plain git inputs still require an existing cache entry or a pack.

## Current 0.4.0 contract

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
