# skills

Chinese README: [README.zh-CN.md](README.zh-CN.md)

`skills` is an MVP CLI for managing project-local AI agent skills with a manifest, dependency resolution, local installs, import helpers, target sync, and a reproducible lockfile.

## Quick Start

```bash
npm install -g skills

skills init
skills add ./local-skills/my-skill
skills install
skills doctor
```

`skills install` writes installed skills into `.skills/installed/` and generates `skills.lock`.

For local development in this repo:

```bash
npm install
npm run build
node dist/cli.js --help
```

## Commands

- `skills init`: create `skills.yaml`, `.skills/`, and add `.skills/` to `.gitignore`
- `skills add <skill>`: add `id[@range]` or a local path to `skills.yaml`
- `skills install`: resolve dependencies, install skills into `.skills/installed/`, write `skills.lock`, and auto-sync when `settings.auto_sync: true`
- `skills import`: scan the current project plus the default OpenClaw skills directory when present, then merge newly discovered skills into `skills.yaml`
- `skills import --from <source>`: scan `openclaw`, `codex`, `claude_code`, or a specific local path
- `skills sync [target]`: sync `.skills/installed/` into enabled targets or a single target using `copy` or `symlink`
- `skills doctor`: validate the manifest and installed skills, including `SKILL.md`, `skill.yaml`, binaries, and env requirements
- `skills list`: show root skills
- `skills list --resolved`: show the resolved dependency set
- `skills why <skill>`: explain why a skill is installed

## Current MVP Scope

- Project-local `skills.yaml`, `.skills/installed/`, and `skills.lock`
- Root skills from local `skills[].path` entries
- Local file-backed `index` sources
- `import` scanning from the current project and default host skill directories, with external discoveries vendored into `.skills/imported/`
- `sync` targets for `openclaw`, `codex`, `claude_code`, and `generic`
- Default path safety that denies outside-root paths unless `SKILLS_ALLOW_UNSAFE_PATHS=1`

## Not Implemented Yet

- Git source install: `sources[].type: git` is accepted by schema validation, but `skills install` does not fetch or install git sources yet
- Remote registry/auth/download flows
- Publish workflows or lockfile-based artifact fetching beyond local file-backed indexes and local paths

## Manifest

The CLI expects a `skills.yaml` file shaped like:

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

## Import And Sync

`skills import` keeps existing manifest entries and appends newly discovered skills by `id`. Imports discovered outside the project root are copied into `.skills/imported/` and recorded as project-local `path` entries so `skills install` works without `SKILLS_ALLOW_UNSAFE_PATHS=1`.

`skills sync` copies or symlinks installed skills into host-specific target directories:

- `openclaw`: defaults to `~/.openclaw/skills`
- `codex`: defaults to `~/.codex/skills`
- `claude_code`: defaults to `~/.claude/skills`
- `generic`: requires `targets[].path`

If `skills.yaml` has no `targets`, `skills sync` defaults to `openclaw`. `skills sync --mode <copy|symlink>` overrides `settings.install_mode`; otherwise the manifest setting is used.

Example:

```bash
skills import
skills install
skills sync
skills sync codex --mode symlink
```

## Index Format

The MVP index format is file-backed:

```yaml
schema: skills-index/v1
skills:
  - id: acme/hello
    versions:
      1.0.0:
        artifact:
          type: path
          url: ./packages/acme-hello
        metadata:
          path: ./skill.yaml
```

`artifact.url` is resolved relative to the index file.

## Path Safety Defaults

By default, `skills` blocks outside-root configured paths and requires each installed skill root to include at least one marker file:

- `SKILL.md` or `skill.yaml` must exist in each skill root during `install`
- Configured paths that resolve outside the current project are rejected, including relative `../...` traversal, explicit absolute paths (`file://` included), and symlink escapes once real paths are resolved

If you need legacy behavior, opt in explicitly:

```bash
SKILLS_ALLOW_UNSAFE_PATHS=1 skills install
```

## Verification

```bash
npm test
```
