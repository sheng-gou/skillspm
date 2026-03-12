# skills

<div align="center">

![OpenClaw](https://img.shields.io/badge/OpenClaw-Supported-7C3AED.svg)
![Codex](https://img.shields.io/badge/Codex-Supported-111111.svg)
![Claude_Code](https://img.shields.io/badge/Claude_Code-Supported-D97706.svg)
![Project_+_Global](https://img.shields.io/badge/Project_+_Global-Scopes-16A34A.svg)
![Import_+_Sync](https://img.shields.io/badge/Import_+_Sync-Multi_Agent-2563EB.svg)
![Agent_Friendly](https://img.shields.io/badge/Agent-Friendly-0EA5E9.svg)

**Manage AI agent skills like a real environment**

English | [中文](README.zh-CN.md)

</div>

Reproduce, sync, inspect, and reuse skills across projects and agents.

## Why this exists

AI coding agents are getting better at using skills, but skill management is still messy.

Today, most teams still:

- copy skill folders by hand
- reinstall the same skills across multiple agents
- lose track of which repo depends on which skills
- create ad-hoc skill folders with no version or metadata
- struggle to move an existing setup from one agent to another

`skills` turns that into a repeatable workflow.

## Highlights

### Clone a repo, run one command, get the same skills

```bash
skills bootstrap
```

### Import once, sync anywhere

```bash
skills import --from openclaw
skills sync claude_code
```

### Turn AI-generated folders into managed skills

```bash
skills inspect ./my-skill --write
```

### Use both project-local and global skills

```bash
skills install
skills install -g
```

## Requirements

- Node.js 18+ (recommended)
- macOS or Linux recommended for the current release

## Install

### For users

```bash
npm install -g skills
```

### For local development

```bash
npm install
npm test
```

## Quick start

### Project scope

```bash
skills init
skills add ./local-skills/my-skill
skills bootstrap
```

### Global scope

```bash
skills init -g
skills add -g ~/.skills/local-skills/my-skill
skills bootstrap -g
```

## Common workflows

### Bootstrap a repo-local skills environment

```bash
skills bootstrap
```

Installs the current scope, writes `skills.lock`, runs diagnostics, and syncs if `auto_sync` is enabled.

### Import existing skills from OpenClaw

```bash
skills init -g
skills import -g --from openclaw
skills install -g
skills sync -g
```

### Add a new target agent

```bash
skills target add claude_code
skills sync claude_code
```

### Normalize a newly created skill folder

```bash
skills inspect ./scratch/my-new-skill --write
skills add ./scratch/my-new-skill
skills bootstrap
```

`skills inspect` can generate or complete a minimal `skill.yaml`:

- `id`
- `name`
- `version` (defaults to `0.1.0`)
- `package`
- `dependencies`

### Export a machine-readable snapshot

```bash
skills snapshot --json
```

## How it works

### Project scope

```text
repo/
├── skills.yaml
├── skills.lock
└── .skills/
    ├── installed/
    └── imported/
```

### Global scope

```text
~/.skills/
├── skills.yaml
├── skills.lock
├── installed/
└── imported/
```

Recommended precedence:

- project > global

### Core files

- `skills.yaml`: manifest for the current scope
- `skills.lock`: resolved installation state
- `skill.yaml`: per-skill metadata

## Commands

| Command | Description |
|---|---|
| `skills init [-g]` | Initialize project or global scope |
| `skills add <skill> [-g]` | Add a root skill |
| `skills remove <skill> [-g]` | Remove a root skill |
| `skills install [-g]` | Resolve and install skills |
| `skills bootstrap [-g]` | Install + doctor (+ sync if enabled) |
| `skills import [-g] --from <source>` | Import skills from an agent or local path |
| `skills inspect <path> --write` | Generate or complete `skill.yaml` |
| `skills snapshot [--json] [-g]` | Export the current skills environment |
| `skills list [--resolved] [--json] [-g]` | Show skills in the current scope |
| `skills freeze [-g]` | Write current installation state to lockfile |
| `skills target add <target> [-g]` | Add a target agent |
| `skills sync [target] [-g]` | Sync installed skills to targets |
| `skills doctor [--json] [-g]` | Diagnose environment health |
| `skills why <skill> [-g]` | Explain why a skill is installed |

## For agents

If a repo contains `skills.yaml`, an agent should usually run:

```bash
skills bootstrap
```

If a new target agent is added:

```bash
skills target add <target>
skills sync <target>
```

If a newly created skill folder lacks metadata:

```bash
skills inspect <path> --write
```

For more guidance, see `AGENTS.md`.

## Current scope

What works today:

- project scope and global scope
- manifest + lockfile workflow
- import from OpenClaw / Codex / Claude Code / local path
- sync to OpenClaw / Codex / Claude Code / generic target
- inspect and generate minimal `skill.yaml`
- snapshot and list with JSON output
- doctor with JSON output

## Current limitations

Not implemented yet or still limited:

- git source install
- remote registry / auth / download flows
- automatic dependency inference for new skills
- deeper host compatibility rules

## Development

```bash
npm install
npm test
```
