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

## `skills.yaml`

`skills.yaml` is the source of truth for a skills environment.

It declares:

* which skills belong to this environment
* where those skills come from
* which agents or targets should receive them
* optional install and sync behavior

`skillspm install` reads `skills.yaml`, resolves skills from the declared sources, and installs them into the local `.skills` workspace.

After that:

* `skillspm freeze` writes the resolved state into `skills.lock`
* `skillspm sync` pushes the installed environment from `.skills` to one or more agents

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

### Where `skillspm install` gets skills from

`skillspm install` only installs skills from sources declared in `skills.yaml`.

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

In most cases, you do not edit `skills.lock` by hand. It is produced by `skillspm install` / `skillspm freeze`.

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
| `skillspm install [-g]`                | Resolve and install the skills declared in `skills.yaml` |
| `skillspm update [skill] [-g]`         | Refresh root skill versions from configured sources or pin one skill |
| `skillspm freeze [-g]`                 | Write the current installation state into `skills.lock`  |
| `skillspm sync [target] [-g]`          | Sync installed skills to one or more targets             |
| `skillspm import [--from <source>] [-g]` | Import skills from an agent or local path              |
| `skillspm inspect <path> --write`      | Generate or complete `skill.yaml` for a raw skill folder |

## Other commands

| Command                                  | Description                                                  |
| ---------------------------------------- | ------------------------------------------------------------ |
| `skillspm snapshot [--json] [-g]`          | Export the current skills environment                        |
| `skillspm doctor [--json] [-g]`            | Diagnose environment health                                  |
| `skillspm init [-g]`                       | Create a starter `skills.yaml` for a project or global scope |
| `skillspm add <skill> [-g]`                | Add a root skill entry to `skills.yaml`                      |
| `skillspm remove <skill> [-g]`             | Remove a root skill entry from `skills.yaml`                 |
| `skillspm list [--resolved] [--json] [-g]` | Show skills in the current scope                             |
| `skillspm why <skill> [-g]`                | Explain why a skill is installed                             |
| `skillspm target add <target> [-g]`        | Add a target agent to the current scope                      |
| `skillspm bootstrap [-g]`                  | Shortcut for `install + doctor (+ sync if enabled)`          |

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

About the maintainer: [HUMAN.md](HUMAN.md)
