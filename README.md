# skills

Chinese README: [README.zh-CN.md](README.zh-CN.md)

`skills` is a CLI for reproducible AI agent skills environments.

It manages a manifest, resolves dependencies, installs a local working set, syncs into agent-specific folders, and keeps the result reproducible with `skills.lock`.

## V1.2 quick mental model

- **Project scope** is the default: `./skills.yaml`, `./skills.lock`, `./.skills/installed/`
- **Global scope** is opt-in with `-g` / `--global`: `~/.skills/skills.yaml`, `~/.skills/skills.lock`, `~/.skills/installed/`
- Recommended precedence when both exist: **project > global**
- Use **project scope** for repo-specific skills
- Use **global scope** for your portable personal baseline

## Wow paths

### 1) Clone a repo and bootstrap it

```bash
npm install
npm run build

node dist/cli.js init
node dist/cli.js add ./local-skills/my-skill
node dist/cli.js bootstrap
```

`skills bootstrap` is the fast path for **install + doctor** (and it also syncs when `settings.auto_sync: true`).

### 2) Import once, sync anywhere

```bash
skills init -g
skills import -g --from openclaw
skills install -g
skills sync -g
skills sync -g codex --mode symlink
```

This lets you keep a reusable global skills environment in `~/.skills/` and project it into OpenClaw, Codex, Claude Code, or a generic directory.

### 3) Turn an AI-generated folder into a managed skill

```bash
skills inspect ./scratch/my-new-skill --write
skills add ./scratch/my-new-skill
skills bootstrap
```

`skills inspect` requires `SKILL.md` and creates or fills in a minimal `skill.yaml`:

- `id`: defaults to the folder name when missing
- `version`: defaults to `0.1.0` when missing
- `dependencies`: defaults to `[]`
- `package`: defaults to `dir` + `./`

If `SKILL.md` is missing, `skills inspect` stops and asks you to add it first.

## Quick start

### Install from npm

```bash
npm install -g skills
```

### Project scope

```bash
skills init
skills add ./local-skills/my-skill
skills install
skills doctor
```

### Global scope

```bash
skills init -g
skills add -g ~/.skills/local-skills/my-skill
skills install -g
skills doctor -g
```

## Commands

- `skills init [-g]`: initialize `skills.yaml` and the selected install root
- `skills add <skill> [-g]`: add `id[@range]` or a local path to `skills.yaml`
- `skills remove <skill> [-g]`: remove a root skill from `skills.yaml`
- `skills install [-g]`: resolve dependencies, install skills, write `skills.lock`, and auto-sync when `settings.auto_sync: true`
- `skills bootstrap [-g]`: effectively `install` + `doctor`
- `skills freeze [-g]`: rewrite `skills.lock` from the currently installed state
- `skills import [-g] [--from <source>]`: scan `openclaw`, `codex`, `claude_code`, or a local path and merge discoveries into `skills.yaml`
- `skills inspect <path> [--write] [--set-version <v>] [--json]`: inspect a local skill folder and generate minimal metadata
- `skills sync [-g] [target] [--mode <copy|symlink>]`: sync installed skills to enabled targets or a single target
- `skills target add <target> [-g]`: add a built-in sync target (`openclaw`, `codex`, or `claude_code`) to `skills.yaml`
- `skills doctor [-g] [--json]`: validate the manifest and installed skills, including `SKILL.md`, `skill.yaml`, binaries, and env requirements
- `skills list [-g] [--resolved] [--json]`: show root or resolved skills
- `skills snapshot [-g] [--resolved] [--json]`: summarize the selected skills environment
- `skills why [-g] <skill>`: explain why a skill is installed

## Scope layout

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

### Current scope rule

There is no automatic scope switching: every command is either:

- **project scope** by default, or
- **global scope** when you pass `-g`

If both scopes exist, treat them as separate environments and prefer **project scope** for repo work.

## Agent usage

### OpenClaw

```bash
skills sync
```

Defaults to `~/.openclaw/skills` when no targets are configured.

### Codex

```bash
skills sync codex --mode symlink
```

Defaults to `~/.codex/skills`.

### Claude Code

```bash
skills sync claude_code
```

Defaults to `~/.claude/skills`.

### Generic target

Add an explicit path in `skills.yaml`:

```yaml
targets:
  - type: generic
    path: ./.agent-skills
```

## Manifest example

```yaml
schema: skills/v1
project:
  name: demo
sources:
  - name: local-index
    type: index
    url: ./fixtures/index.yaml
skills:
  - id: acme/hello
    version: ^1.0.0
    source: local-index
  - id: local/release-check
    path: ./local-skills/release-check
targets:
  - type: openclaw
    enabled: true
  - type: generic
    path: ./.agent-skills
settings:
  install_mode: copy
  auto_sync: false
  strict: false
```

## Import and vendoring

`skills import` keeps existing manifest entries and appends newly discovered skills by `id`.

When a discovered skill lives outside the managed root, `skills` vendors it into the managed environment and records a safe local `path` entry:

- project scope → `./.skills/imported/`
- global scope → `~/.skills/imported/`

That keeps installs reproducible without requiring `SKILLS_ALLOW_UNSAFE_PATHS=1`.

## `skills inspect`

Use it when a folder has some skill content but incomplete metadata.

```bash
skills inspect ./my-skill
skills inspect ./my-skill --set-version 0.2.0 --write
```

Behavior:

- `SKILL.md` must already exist
- if `skill.yaml` is missing, generate a minimal one
- if `id` is missing, use the folder name
- if `version` is missing, use `0.1.0`
- if `dependencies` is missing, use `[]`

## `skills list --json` and `skills snapshot --json`

For automation:

```bash
skills list --json
skills list --resolved --json
skills snapshot --json
skills snapshot --resolved --json
```

These reports include scope-aware metadata for the selected environment, including root skills, resolved skills, target state, and timestamps.

## `skills doctor --json`

For automation:

```bash
skills doctor --json
skills doctor -g --json
```

The JSON report includes:

- scope
- root directory
- installed root
- warning/error counts
- per-finding messages
- overall result: `healthy`, `warnings`, or `failed`

## Path safety defaults

By default, `skills` blocks outside-root configured paths and requires each installed skill root to include at least one marker file:

- `SKILL.md` or `skill.yaml` must exist in each skill root during `install`
- configured paths that resolve outside the selected managed root are rejected, including `../...`, explicit absolute paths, `file://` paths, and symlink escapes after realpath resolution

If you need legacy behavior, opt in explicitly:

```bash
SKILLS_ALLOW_UNSAFE_PATHS=1 skills install
SKILLS_ALLOW_UNSAFE_PATHS=1 skills install -g
```

## Current truthful limits

Still not implemented:

- Git source install: `sources[].type: git` is accepted by schema validation, but `skills install` does **not** fetch or install git sources yet
- Remote registry/auth/download flows
- Publish workflows or artifact fetching beyond local file-backed indexes and local paths

## Local development

```bash
npm install
npm run build
npm test
```
