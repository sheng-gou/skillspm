# skillspm

![SkillsPM social preview](./docs/social-preview.jpg)

Agent-native Skills management.

Reproducible, portable, restorable Skills environments that agents can install, explain, confirm, sync, and recover for you.

`skillspm` keeps project intent in `skills.yaml`, confirmed state in `skills.lock`, and machine-local materialization in `~/.skillspm/*`. It gives agents a clean workflow: prepare a repo from intent, explain drift before risky actions, confirm accepted results explicitly, then sync or pack only from confirmed state.

## Four agent-native cases

### Case 1 — Development environment — Agent prepares the project from `skills.yaml`

You point an agent at a repository and ask it to install the local Skills environment. The agent reads project intent, materializes the environment locally, and explains whether the repo is still in Development, Drifted Development, or already Confirmed.

### Case 2 — Development environment — Agent adds or adopts Skills without pretending they are confirmed

You ask an agent to add a local Skill, add a provider-backed Skill, or adopt an existing target or directory. The agent updates `skills.yaml`, materializes the current result locally, and leaves `skills.lock` unchanged until you explicitly accept the resolved state.

### Case 3 — Confirmed environment — Agent reproduces and syncs the accepted environment across agents

Once `skills.yaml` and `skills.lock` align, the agent can reproduce the confirmed environment with `skillspm install` and distribute it with `skillspm sync <target>`. Sync stays non-destructive and refuses when confirmation is missing or stale.

### Case 4 — Confirmed environment — Agent creates a restore pack for another machine

When you want portable recovery, the agent can create a `.skillspm.tgz` with `skillspm pack` and restore it elsewhere with `skillspm install <pack>`. Packs transport confirmed state; they do not replace project intent or confirmed state as truth.

## Quick start

Install `skillspm` once:

```bash
npm install -g skillspm
```

Create a minimal `skills.yaml`:

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

Ask the agent to prepare the repo:

- "Install the Skills environment for this project."
- "Tell me whether this repo is still in Development or already Confirmed."

What the agent runs:

```bash
skillspm install
skillspm inspect
```

When you want to accept, sync, or pack the confirmed environment:

- "Accept the current resolved environment and refresh the lockfile."
- "Sync the confirmed environment to OpenClaw."
- "Create a restore pack for another machine."

What the agent runs:

```bash
skillspm freeze
skillspm sync openclaw
skillspm pack
```

## Agent workflows

### Workflow 1 — Prepare a repo locally

What the user says:

"Install `skillspm`, read this repo's `skills.yaml`, and prepare the local Skills environment."

What the agent runs:

```bash
npm install -g skillspm
skillspm install
skillspm inspect
```

`install` materializes current intent locally. `inspect` explains the current state and the next safe action before you confirm or distribute anything.

### Workflow 2 — Add or adopt Skills during Development

What the user says:

"Add this local Skill, add this provider-backed Skill, or adopt an existing target into the project."

What the agent runs:

```bash
skillspm add ./skills/my-skill
skillspm add owner/repo/skill --provider github
skillspm add example/skill --provider openclaw
skillspm adopt openclaw
skillspm install
```

`add` and `adopt` update `skills.yaml`. A follow-up `install` materializes the current Development result locally without claiming that confirmation already happened.

### Workflow 3 — Explain drift, confirm the result, and sync it

What the user says:

"Explain drift, accept the current environment, and sync the confirmed Skills to my agent targets."

What the agent runs:

```bash
skillspm inspect
skillspm freeze
skillspm sync openclaw,codex
```

`freeze` explicitly refreshes `skills.lock`. `sync` writes confirmed state only and keeps unrelated target contents intact.

### Workflow 4 — Pack and restore a confirmed environment

What the user says:

"Create a portable restore pack from the confirmed environment, then use it to restore another machine."

What the agent runs:

```bash
skillspm pack dist/team-env.skillspm.tgz
skillspm install dist/team-env.skillspm.tgz
```

Packs are for private, local, offline, and cross-machine recovery. They supplement the normal install flow instead of replacing `skills.yaml` plus `skills.lock`.

## Core commands

These are the public commands agents use on your behalf, and the user value each one provides:

- `skillspm add <content>`: bring a local path, GitHub input, or provider-backed id under project intent in `skills.yaml`
- `skillspm inspect`: explain intent, confirmed state, drift, and the next safe action in user-facing language
- `skillspm install [input]`: reproduce confirmed state by default, or materialize current intent locally during Development
- `skillspm freeze`: explicitly accept the current resolved result and refresh `skills.lock`
- `skillspm adopt [source]`: merge an existing target or directory into project intent instead of rebuilding it by hand
- `skillspm sync [target]`: distribute the confirmed environment from the local library cache into one or more targets
- `skillspm pack [out]`: create a portable confirmed-state restore bundle for another machine, team, or offline workflow
- `skillspm doctor`: validate manifest, lockfile, cache, targets, pack readiness, and conflicts when diagnosis is needed
- `skillspm help [command]`: show command-specific usage

## Development vs Confirmed state

- Uninitialized: the project has not established usable intent yet
- Development: `skills.yaml` expresses current intent, and `install` can materialize it locally
- Drifted Development: current intent or local materialization no longer matches the last confirmed result
- Confirmed: `skills.yaml` and `skills.lock` align, so `install`, `sync`, and `pack` consume confirmed state by default

In short:

- `skills.yaml` = project intent with desired `skills`, optional per-root `source`, and optional `targets`
- `skills.lock` = confirmed state with exact accepted version, digest, and resolved-from provenance
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

Recorded public GitHub provider provenance may also use an anonymous public GitHub URL as either `source.value` for `github` or `source.provider.ref` for provider-preserving records, for example `https://github.com/owner/repo/tree/main/skills/demo`. URL-embedded credentials are not supported.

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

Recorded provider provenance can keep the original provider id such as `openclaw:...`, `clawhub:...`, or `skills.sh:...` while persisting the backing public GitHub locator used for re-materialization. Canonical public `github:` skills and provider-backed public skills remain recoverable through unauthenticated public tag fetches.

Recovered provider skill roots must be symlink-free. Digest mismatches fail closed instead of silently accepting drift.

Provider recovery is intentionally narrow in this branch: clean-machine fallback only covers public GitHub-backed providers `github`, `openclaw`, `clawhub`, and `skills.sh`, and only through unauthenticated access. `skills.sh:` ids resolve through their public GitHub repo/path semantics; `openclaw:` and `clawhub:` ids resolve through public provider metadata and then pin to a public GitHub backing locator. The recovery path disables credential helpers, askpass hooks, and terminal prompting so private or authenticated GitHub access fails closed honestly. Private repos, authenticated provider flows, non-public visibility, and plain git inputs still require an existing cache entry or a pack.

## For agents

Default workflow:

1. `skillspm install`
2. `skillspm inspect`
3. `skillspm install` again only if intent changed and local materialization must be refreshed before confirmation
4. `skillspm freeze` only when the task explicitly requires updating confirmed state in `skills.lock`
5. `skillspm sync <target>` or `skillspm pack` only when confirmed-state distribution or restore output is intended
6. `skillspm doctor --json` when validation-oriented diagnostics are needed

Prefer editing `skills.yaml` when changing project intent. Avoid hand-editing `skills.lock`, treating cache contents as project truth, or switching scope with `-g` unless the user explicitly asks.

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
