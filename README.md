# skills

<div align="center">

![OpenClaw](https://img.shields.io/badge/OpenClaw-Supported-7C3AED.svg)
![Codex](https://img.shields.io/badge/Codex-Supported-111111.svg)
![Claude_Code](https://img.shields.io/badge/Claude_Code-Supported-D97706.svg)
![Project_+_Global](https://img.shields.io/badge/Project_+_Global-Scopes-16A34A.svg)
![Import_+_Sync](https://img.shields.io/badge/Import_+_Sync-Multi_Agent-2563EB.svg)
![Agent_Friendly](https://img.shields.io/badge/Agent-Friendly-0EA5E9.svg)

**Package-manager-style Skills environments for AI agents**

English | [中文](README.zh-CN.md)

</div>

`skills` uses a `skills.yaml` file as the source of truth for a reusable skills environment.

Core workflow:

- install
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

`skills` turns that into a reproducible workflow centered around `skills.yaml`.

## Core commands

### Install a skills environment from `skills.yaml`

```bash
skills install
```

### Freeze the current environment into `skills.lock`

```bash
skills freeze
```

### Sync installed skills to another agent

```bash
skills sync claude_code
```

### Import an existing setup

```bash
skills import --from openclaw
skills install
```

### Turn a raw folder into a managed skill

```bash
skills inspect ./my-skill --write
```

## Requirements

* Node.js 18+ (recommended)
* macOS or Linux recommended for the current release

## Install

```bash
npm install -g skills
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
skills install
```

### 3. Sync it to an agent

```bash
skills sync claude_code
```

### 4. Freeze the current state

```bash
skills freeze
```

## `skills.yaml`

`skills.yaml` is the source of truth for a skills environment.

It declares:

* which skills belong to this environment
* where those skills come from
* which agents or targets should receive them
* optional install and sync behavior

`skills install` reads `skills.yaml`, resolves skills from the declared sources, and installs them into the local `.skills` workspace.

After that:

* `skills freeze` writes the resolved state into `skills.lock`
* `skills sync` pushes the installed environment from `.skills` to one or more agents

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
    type: index
    url: ./skills-index.yaml

skills:
  - id: openai/code-review
    version: ^1.2.0
    source: community

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

### Where `skills install` gets skills from

`skills install` only installs skills from sources declared in `skills.yaml`.

In the current release, the main source types are:

* local paths
* declared local source files

This keeps installs explicit and reproducible.

### Key fields

* `schema`: manifest version
* `sources`: optional declared sources
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

In short:

* use `path` for local skills
* use `id + version + source` for skills resolved from a declared source file

## `skills.lock`

`skills.lock` stores the frozen, resolved state of a skills environment.

If `skills.yaml` describes:

> what I want

then `skills.lock` records:

> what was actually resolved and installed

It is mainly used to lock the resolved skills versions and sources, so the same environment can be reproduced later across machines, repos, and agents.

In most cases, you do not edit `skills.lock` by hand. It is produced by `skills install` / `skills freeze`.

### What it is for

* locking the resolved skills versions
* recording where each skill came from
* making installs reproducible
* helping humans and agents use the same environment

### Typical workflow

* edit `skills.yaml` to describe the desired environment
* run `skills install` to resolve and install it
* run `skills freeze` to write the resolved state into `skills.lock`

### In short

* `skills.yaml` = desired environment
* `skills.lock` = frozen installed environment

## Common workflows

### Manage a repo-local skills environment

```bash
skills install
skills sync
skills freeze
```

### Manage a global skills baseline

This assumes you already have a global ~/.skills/skills.yaml manifest.

```bash
skills install -g
skills sync -g
skills freeze -g
```

### Import existing skills from OpenClaw

```bash
skills import --from openclaw
skills install
skills sync
```

### Normalize a newly created skill folder

```bash
skills inspect ./scratch/my-new-skill --write
skills install
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

## Core commands reference

| Command                              | Description                                              |
| ------------------------------------ | -------------------------------------------------------- |
| `skills install [-g]`                | Resolve and install the skills declared in `skills.yaml` |
| `skills update [skill] [-g]`         | Refresh root skill versions from configured sources or pin one skill |
| `skills freeze [-g]`                 | Write the current installation state into `skills.lock`  |
| `skills sync [target] [-g]`          | Sync installed skills to one or more targets             |
| `skills import [--from <source>] [-g]` | Import skills from an agent or local path              |
| `skills inspect <path> --write`      | Generate or complete `skill.yaml` for a raw skill folder |

## Other commands

| Command                                  | Description                                                  |
| ---------------------------------------- | ------------------------------------------------------------ |
| `skills snapshot [--json] [-g]`          | Export the current skills environment                        |
| `skills doctor [--json] [-g]`            | Diagnose environment health                                  |
| `skills init [-g]`                       | Create a starter `skills.yaml` for a project or global scope |
| `skills add <skill> [-g]`                | Add a root skill entry to `skills.yaml`                      |
| `skills remove <skill> [-g]`             | Remove a root skill entry from `skills.yaml`                 |
| `skills list [--resolved] [--json] [-g]` | Show skills in the current scope                             |
| `skills why <skill> [-g]`                | Explain why a skill is installed                             |
| `skills target add <target> [-g]`        | Add a target agent to the current scope                      |
| `skills bootstrap [-g]`                  | Shortcut for `install + doctor (+ sync if enabled)`          |

`skills import` scans the current working tree and the default OpenClaw skills directory by default. Use `--from openclaw`, `--from codex`, `--from claude_code`, or `--from <path>` to import from one explicit source.

## For agents

If a repo contains `skills.yaml`, an agent should usually run:

```bash
skills install
skills doctor --json
```

If targets are already configured, the agent may also run:

```bash
skills sync
```

If a newly created skill folder lacks metadata:

```bash
skills inspect <path> --write
```

Detailed agent-facing instructions should live in `AGENTS.md`.

## Current scope

What works today:

* project scope and global scope
* manifest + lockfile workflow
* import from OpenClaw / Codex / Claude Code / local path
* sync to OpenClaw / Codex / Claude Code / generic target
* inspect and generate minimal `skill.yaml`
* snapshot and list with JSON output
* doctor with JSON output

## Current limitations

Not implemented yet or still limited:

* git source install
* remote registry / auth / download flows
* automatic dependency inference for new skills
* deeper host compatibility rules

## Development

```bash
npm install
npm test
```
