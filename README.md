# SkillsPM

<p align="center">
  <img src="./docs/social-preview.jpg" alt="SkillsPM social preview" />
</p>

<div align="center">

<h2>The source of truth is <code>skills.yaml</code>.</h2>
<p>Install from it, freeze it, and sync it across agents and projects.</p>

![OpenClaw](https://img.shields.io/badge/OpenClaw-Supported-7C3AED.svg)
![Codex](https://img.shields.io/badge/Codex-Supported-111111.svg)
![Claude_Code](https://img.shields.io/badge/Claude_Code-Supported-D97706.svg)
![Project_+_Global](https://img.shields.io/badge/Project_+_Global-Scopes-16A34A.svg)
![Import_+_Sync](https://img.shields.io/badge/Import_+_Sync-Multi_Agent-2563EB.svg)
![Agent_Friendly](https://img.shields.io/badge/Agent-Friendly-0EA5E9.svg)

English | [中文](README.zh-CN.md)

</div>

SkillsPM uses a `skills.yaml` file as the source of truth for a reusable skills environment.

Core workflow:

- install
- pack
- freeze
- sync
- import
- inspect

## Why this exists

AI coding agents are getting better at using skills, but skill management is still messy.

Teams still:

- copy skill folders by hand
- reinstall the same skills across multiple agents
- lose track of which repo depends on which skills
- create ad-hoc skill folders with no version or metadata
- struggle to move an existing setup from one agent to another

SkillsPM turns that into a reproducible workflow centered around `skills.yaml`.

## Core commands

### Install a skills environment from `skills.yaml`

```bash
skillspm install
```

### Export the current environment into a directory pack

```bash
skillspm pack --out ./packs/team-baseline
```

### Freeze the current environment into `skills.lock`

```bash
skillspm freeze
```

### Sync installed skills to another agent

```bash
skillspm sync claude_code
```

### Import an existing setup

```bash
skillspm import --from openclaw
skillspm install
```

Imports an existing setup into the current managed environment. By default it can scan the current working tree and the default OpenClaw skills directory.

### Turn a raw folder into a managed skill

```bash
skillspm inspect ./my-skill --write
```

## Requirements

* Node.js 18+ (recommended)
* macOS or Linux recommended for the current release

## Install

Install the latest release from npm:

```bash
npm install -g skillspm
```

If you want to pin a specific release explicitly:

```bash
npm install -g skillspm@<version>
```

Or use the install script, which now installs from npm by default:

```bash
curl -fsSL https://raw.githubusercontent.com/sheng-gou/skillspm/main/scripts/install.sh | sh
```

To pin a version through the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/sheng-gou/skillspm/main/scripts/install.sh | SKILLSPM_VERSION=<version> sh
```

If you want to inspect the install script before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/sheng-gou/skillspm/main/scripts/install.sh
```

If you want to work from source for development:

```bash
git clone https://github.com/sheng-gou/skillspm.git
cd skillspm
npm install
npm run build
npm link
```

## Quick start

### 1. Define your environment in `skills.yaml`

```yaml
schema: skills/v1

skills:
  - id: local/code-review
    path: ./local-skills/code-review

targets:
  - type: openclaw
    enabled: true
  - type: claude_code
    enabled: true
```

### 2. Install it

```bash
skillspm install
```

### 3. Sync it to an agent

```bash
skillspm sync claude_code
```

### 4. Freeze the current state

```bash
skillspm freeze
```

## Higher-level add UX

In Phase 1, the primary higher-level add flows are:

* one local skill directory via `add --from <dir>`
* one explicit canonical skills.sh / ClawHub ref via `add <provider-ref>`
* one skill id from a public anonymous HTTPS repo via `add <id@range> --from <repo-url>`

Explicit local index/catalog sources remain supported for advanced internal compatibility, but they are not the primary UX.

### Add one local skill directory

```bash
skillspm add --from ./local-skills/code-review
```

This compiles to a normal root path entry in `skills.yaml`.

### Add from an explicit skills.sh / ClawHub provider ref

```bash
skillspm add skills.sh:owner/repo/code-review
skillspm add clawhub:owner/repo/code-review
skillspm add https://skills.sh/owner/repo/code-review
```

This resolves the canonical provider ref to:

* a persisted `sources[]` entry with `type: git`
* a persisted `sources[].provider.kind` of `skills.sh` or `clawhub`
* a normalized GitHub clone URL such as `https://github.com/owner/repo.git`
* a normal root skill id inferred from the matched skill metadata
* a persisted canonical `skills[].provider_ref`

This slice is intentionally conservative in 0.3.0: only explicit canonical refs are supported, only public GitHub-backed anonymous HTTPS repo URLs are in scope, and there is no provider search / private / auth flow.

### Add from a public anonymous HTTPS repo

```bash
skillspm add acme/code-review@^1.2.0 --from https://github.com/example/public-skills.git
```

This compiles to:

* a persisted `sources[]` entry with `type: git`
* a normal root skill with `id + version + source`

`--source <name>` is optional when you want to control the persisted source name. This is restricted public anonymous HTTPS git only, not arbitrary git; private or authenticated repos remain out of scope.

### Advanced compatibility: add from a local index or catalog

```bash
skillspm add acme/code-review@^1.2.0 --from ./catalog
```

You can also point directly at an index file such as `./skills-index.yaml`.

This compiles to:

* a persisted `sources[]` entry with `type: index`
* a normal root skill with `id + version + source`

If a directory looks like both a local skill root and an index/catalog container, `skillspm add --from <dir>` now fails as ambiguous. Point `--from` at the exact skill directory you want, or pass the explicit index file path.

## `skills.yaml`

`skills.yaml` is the source of truth for a skills environment.

It declares:

* which skills belong to this environment
* where those skills come from
* which agents or targets should receive them
* optional install and sync behavior

`skillspm install` reads `skills.yaml`, resolves root skills from local paths and declared sources, can also restore exact versions from configured top-level `packs[]` (including pack-only restores with no declared source), and installs the result into the local `.skills` workspace.

After that:

* `skillspm freeze` writes the resolved state into `skills.lock`
* `skillspm sync` pushes the installed environment from `.skills` to one or more agents

## Runnable examples

The repo includes runnable, in-repo examples:

* [`examples/source-aware-live`](examples/source-aware-live/README.md): advanced local-index compatibility plus one local path skill in the same workspace
* [`examples/pack-transfer`](examples/pack-transfer/README.md): pack restore using an explicit local index fixture for reproducible in-repo testing

### Minimal example

```yaml
schema: skills/v1

skills:
  - id: local/code-review
    path: ./local-skills/code-review

targets:
  - type: openclaw
    enabled: true
  - type: claude_code
    enabled: true
```

### Example with sources

```yaml
schema: skills/v1

sources:
  - name: community
    type: git
    url: https://github.com/example/public-skills.git

  - name: frontend-catalog
    type: git
    url: https://github.com/acme/provider-skills.git
    provider:
      kind: skills.sh

skills:
  - id: openai/code-review
    version: ^1.2.0
    source: community

  - id: acme/frontend-design
    source: frontend-catalog
    provider_ref: skills.sh:acme/provider-skills/frontend-design

  - id: local/release-check
    path: ./local-skills/release-check

targets:
  - type: openclaw
    enabled: true
  - type: codex
    enabled: true

settings:
  auto_sync: true
```

### Where `skillspm install` gets skills from

`skillspm install` only installs skills from what is declared in `skills.yaml`.

Primary Phase 1 flows are:

* local path skills
* declared anonymous public HTTPS git sources
* provider-backed git sources persisted as `type: git` plus `sources[].provider.kind`

Explicit local index/catalog sources are still supported as an advanced compatibility path for internal workflows and fixtures.

These are product-level semantics. They intentionally compile down to the persisted low-level model: local roots use `skills[].path`, live sources use `sources[].type: index|git`, provider-backed repos add optional `sources[].provider.kind` plus root `skills[].provider_ref`, and packs stay separate as the materialization boundary.

In the current implementation:

* local path skills declared with `path`
* source-backed skills resolved from declared `sources[]`
* provider-added roots persist `skills[].provider_ref` on top of the same git source boundary
* exact-version restores from configured top-level `packs[]`, including pack-only restore for an exact root with no declared source

In the current release, a source means an entry in `sources[]`. Supported source types today are:

* restricted anonymous public HTTPS `git` with a plain repo URL only, not arbitrary git transports or authenticated/private repo flows
* `index` for explicit local compatibility manifests

A pack is a directory written by `skillspm pack --out <dir>`. It does not replace the logical source, and it is not a source type.
If a manifest declares an exact version and a matching node exists in a configured pack, install can materialize that node from the pack instead of fetching live content from a declared source. That also enables pack-only restore for an exact root when no source is declared.

This keeps installs explicit and reproducible.

For the formal persisted boundary drafted for 0.3.0, see [`docs/skills-yaml-schema-v0.3.0.md`](docs/skills-yaml-schema-v0.3.0.md).

### Key fields

* `schema`: manifest version
* `project`: optional project-level metadata such as an optional `project.name`
* `sources`: optional declared live sources (`index` or restricted public HTTPS `git`, with optional `provider.kind` on git)
* `packs`: optional declared directory packs for exact-version restore
* `skills`: the root skills in this environment
* `targets`: where installed skills should be synced
* `settings`: optional behavior such as `auto_sync`

### Skill entries

A skill can be declared in two common ways:

#### Local path skill

```yaml
- id: local/code-review
  path: ./local-skills/code-review
```

#### Source-based skill

```yaml
- id: openai/code-review
  version: ^1.2.0
  source: community
```

#### Provider-backed source skill

```yaml
- id: acme/frontend-design
  source: frontend-catalog
  provider_ref: skills.sh:acme/provider-skills/frontend-design
```

In short:

* use `path` for local skills
* use `id + version + source` for ordinary source-backed skills
* add `provider_ref` when the root was added from a provider-backed git source
* use top-level `packs[]` when you want install-time exact-version restore from a portable directory pack, including pack-only restore for exact roots

For interactive authoring, `skillspm add ...` writes these same manifest forms for local skill directories, explicit canonical skills.sh / ClawHub refs, public anonymous HTTPS git repos, and explicit local index/catalog compatibility sources.

### Public git repo layout

Phase 1 only supports public anonymous `https://` git sources, and those sources default to one fixed layout only. Only plain repo URLs are accepted: `file://`, `ssh://`, `git@host:repo`, URLs with embedded credentials, non-empty query strings, and non-empty `#` fragments are rejected. During install, `skillspm` isolates git config, disables credential prompts/helpers, and blocks `file://` transport so ambient rewrite rules such as `url.*.insteadOf` cannot bypass that policy.

```text
skills/
└── <skill-id path>/
    └── <version>/
        ├── SKILL.md
        └── skill.yaml
```

Example for `acme/code-review@1.2.0`:

```text
skills/acme/code-review/1.2.0/
```

`skill.yaml.version` must match the directory version.

Explicit canonical `skills.sh:` / `clawhub:` refs are adapted onto this same git foundation, but their persisted boundary stays distinct. `skillspm add <provider-ref>` writes a normal `type: git` source plus `sources[].provider.kind`, and the root keeps `skills[].provider_ref` for provenance. Resolver behavior is split on purpose:

* plain `type: git` sources stay strict and only use `skills/<skill-id path>/<version>`
* only `type: git` sources with persisted `provider.kind` may use the conservative provider-backed fallback locator

That provider-backed fallback scans the cloned repo for a unique skill directory that contains `SKILL.md` or `skill.yaml` and matches the requested skill metadata id or basename (with `provider_ref` retained for root provenance). Ambiguous, malformed, non-GitHub, search-based, private, and authenticated flows are rejected.

### Manifest example with public HTTPS git + pack restore

```yaml
schema: skills/v1

sources:
  - name: community
    type: git
    url: https://github.com/example/public-skills.git

packs:
  - name: baseline
    path: ./packs/team-baseline

skills:
  - id: acme/code-review
    version: 1.2.0
    source: community

  - id: local/release-check
    path: ./local-skills/release-check
```

A second machine can restore from the pack by declaring the same exact version and the pack:

```yaml
schema: skills/v1

packs:
  - name: baseline
    path: ./packs/team-baseline

skills:
  - id: acme/code-review
    version: 1.2.0
```

## `skills.lock`

`skills.lock` stores the frozen, resolved state of a skills environment.

If `skills.yaml` describes:

> what I want

then `skills.lock` records:

> what was actually resolved and installed

It is mainly used to lock the resolved skills versions and provenance, so the same environment can be reproduced later across machines, repos, and agents.

Each resolved node records both:

* logical source provenance (`source`) — where the skill conceptually came from
* materialization provenance (`materialization`) — whether this install used live content or restored from a pack

This is the same intentional boundary as `skills.yaml`: higher-level product semantics compile down to low-level persisted source fields (`skills[].path`, `sources[].type: index|git`, optional `provider.kind` / `provider_ref`), while pack restores stay represented separately under `materialization`.

In most cases, you do not edit `skills.lock` by hand. It is produced by `skillspm install` / `skillspm freeze`.

When present, `project.name` is optional project-level metadata carried forward from `skills.yaml`.

### What it is for

* locking the resolved skills versions
* recording where each skill came from
* making installs reproducible
* helping humans and agents use the same environment

### Typical workflow

* edit `skills.yaml` to describe the desired environment
* run `skillspm install` to resolve and install it
* run `skillspm freeze` to write the resolved state into `skills.lock`

### In short

* `skills.yaml` = desired environment
* `skills.lock` = frozen installed environment

## Common workflows

### Manage a repo-local skills environment

```bash
skillspm install
skillspm sync
skillspm freeze
```

### Manage a global skills baseline

This assumes you already have a global ~/.skills/skills.yaml manifest.

```bash
skillspm install -g
skillspm sync -g
skillspm freeze -g
```

### Import existing skills from OpenClaw

```bash
skillspm import --from openclaw
skillspm install
skillspm sync
```

### Normalize a newly created skill folder

```bash
skillspm inspect ./scratch/my-new-skill --write
skillspm install
```

## How it works

### Project scope (default)

```text
repo/
├── skills.yaml
├── skills.lock
└── .skills/
    ├── installed/
    └── imported/
```

### Global scope (`-g`)

```text
~/.skills/
├── skills.yaml
├── skills.lock
├── installed/
└── imported/
```

Recommended usage:

* use project scope by default
* use `-g` only when you want to read or modify the global environment explicitly

### Core files

* `skills.yaml`: manifest for the current scope
* `skills.lock`: frozen installation state

## Command reference

| Command                              | Description                                              |
| ------------------------------------ | -------------------------------------------------------- |
| `skillspm install [-g]`                | Resolve skills from local paths, declared sources, and configured exact-version pack restores |
| `skillspm update [skill] [-g]`         | Refresh root skill versions from configured sources or pin one skill |
| `skillspm pack --out <dir> [-g]`       | Write the installed exact skills into a portable directory pack |
| `skillspm freeze [-g]`                 | Write the current installation state into `skills.lock`  |
| `skillspm sync [target] [-g]`          | Sync installed skills to one or more targets             |
| `skillspm import [--from <source>] [-g]` | Import skills from an agent or local path              |
| `skillspm inspect <path> --write`      | Generate or complete `skill.yaml` for a raw skill folder |

## Other commands

| Command                                  | Description                                                  |
| ---------------------------------------- | ------------------------------------------------------------ |
| `skillspm snapshot [--json] [-g]`          | Export the current skills environment                        |
| `skillspm doctor [--json] [-g]`            | Validate manifest, lockfile, installed skills, and targets   |
| `skillspm init [-g]`                       | Create a starter `skills.yaml` for a project or global scope |
| `skillspm add [skill] [--from <source>] [-g]` | Add a local or source-backed root skill entry to `skills.yaml` |
| `skillspm remove <skill> [-g]`             | Remove a root skill entry from `skills.yaml`                 |
| `skillspm list [--resolved] [--json] [-g]` | Show skills in the current scope                             |
| `skillspm why <skill> [-g]`                | Explain why a skill is installed                             |
| `skillspm target add <target> [-g]`        | Add a target agent to the current scope                      |
| `skillspm bootstrap [-g]`                  | Shortcut for `install + auto-sync if enabled + doctor`       |

`skillspm import` scans the current working tree and the default OpenClaw skills directory by default. Use `--from openclaw`, `--from codex`, `--from claude_code`, or `--from <path>` to import from one explicit source.

## For agents

If a repo contains `skills.yaml`, an agent should usually run:

```bash
skillspm install
skillspm doctor --json
```

If targets are already configured, the agent may also run:

```bash
skillspm sync
```

If a newly created skill folder lacks metadata:

```bash
skillspm inspect <path> --write
```

Agents should not edit `skills.lock` by hand unless explicitly asked.

Detailed agent-facing instructions should live in `AGENTS.md`.

## Current scope

What works today:

* project scope and global scope
* manifest + lockfile workflow
* local path skills
* restricted public HTTPS git source install
* explicit canonical skills.sh / ClawHub refs that normalize onto public GitHub git sources
* explicit local index source install for compatibility workflows
* directory pack export and exact-version restore via top-level `packs[]`
* import from OpenClaw / Codex / Claude Code / local path
* sync to OpenClaw / Codex / Claude Code / generic target
* inspect and generate minimal `skill.yaml`
* snapshot and list with JSON output
* doctor with JSON output

## Current limitations

Not implemented yet or still limited:

* private/authenticated git or other non-plain-HTTPS git source flows
* remote registry / auth / download flows beyond declared local index paths and restricted public HTTPS git
* hosted catalog features beyond the explicit canonical GitHub-backed skills.sh / ClawHub adapter (for example search, naked short refs, or private entries)
* automatic dependency inference for new skills
* deeper host compatibility rules

## Development

```bash
npm install
npm test
```

About the maintainer: [HUMAN.md](HUMAN.md)
