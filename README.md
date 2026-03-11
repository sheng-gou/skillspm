# skills

Chinese README: [README.zh-CN.md](README.zh-CN.md)

`skills` is an MVP Node.js + TypeScript CLI for managing project-local AI agent skills with a manifest, dependency resolution, local installs, import/migration helpers, target sync, and a reproducible lockfile.

## Quickstart

```bash
npm install
npm run build

node dist/cli.js init
node dist/cli.js add ./local-skills/my-skill
node dist/cli.js install
node dist/cli.js sync
node dist/cli.js doctor
```

`node dist/cli.js install` writes installed skills into `.skills/installed/` and generates `skills.lock`.

## Manifest

The CLI expects a `skills.yaml` file shaped like:

```yaml
schema: skills/v1
project:
  name: demo
sources:
  - name: local-index
    type: index
    url: ./fixtures/index.json
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

Supported MVP sources:

- local path skills via `skills[].path`
- local file backed `index` sources

## Commands

- `node dist/cli.js init`: create `skills.yaml`, `.skills/`, and add `.skills/` to `.gitignore`
- `node dist/cli.js add <skill>`: add `id[@range]` or a local path to `skills.yaml`
- `node dist/cli.js install`: resolve dependencies, copy skills into `.skills/installed/`, and write `skills.lock`
- `node dist/cli.js import`: scan the current project plus the default OpenClaw skills directory when present, then merge newly discovered skills into `skills.yaml`
- `node dist/cli.js import --from <source>`: scan `openclaw`, `codex`, `claude_code`, or a specific local path
- `node dist/cli.js sync [target]`: sync `.skills/installed/` into enabled targets or a single target using `copy` or `symlink`
- `node dist/cli.js doctor`: validate the manifest and installed skills, including `SKILL.md`, `skill.yaml`, binaries, and env requirements
- `node dist/cli.js list`: show root skills
- `node dist/cli.js list --resolved`: show the resolved dependency set
- `node dist/cli.js why <skill>`: explain why a skill is installed

## Import And Sync

`node dist/cli.js import` keeps any existing manifest entries and appends newly discovered skills by `id`. Imported skills are recorded as `path` dependencies, and version metadata is preserved when `skill.yaml` provides it.

`node dist/cli.js sync` copies or symlinks installed skills into host-specific target directories:

- `openclaw`: defaults to `~/.openclaw/skills`
- `codex`: defaults to `~/.codex/skills`
- `claude_code`: defaults to `~/.claude/skills`
- `generic`: requires `targets[].path`

If `skills.yaml` has no `targets`, `node dist/cli.js sync` defaults to `openclaw`. `node dist/cli.js sync --mode <copy|symlink>` overrides `settings.install_mode`; otherwise the manifest setting is used.

Example:

```bash
node dist/cli.js import
node dist/cli.js install
node dist/cli.js sync
node dist/cli.js sync codex --mode symlink
```

## Index Format

The MVP index format is file-backed and intentionally small:

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
- configured paths that resolve outside the current project are rejected, including relative `../...` traversal, explicit absolute paths (`file://` included), and symlink escapes once real paths are resolved

If you need legacy behavior, opt in explicitly:

```bash
SKILLS_ALLOW_UNSAFE_PATHS=1 node dist/cli.js install
```

## Verification

Run the smoke flow:

```bash
npm test
```
