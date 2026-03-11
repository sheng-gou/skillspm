# skills

English README: [README.md](README.md)

`skills` 是一个基于 Node.js + TypeScript 的 MVP CLI，用于管理项目本地的 AI agent skill，支持清单文件、依赖解析、本地安装、导入/迁移辅助、目标目录同步以及可复现的锁文件。

## 快速开始

```bash
npm install
npm run build

node dist/cli.js init
node dist/cli.js add ./local-skills/my-skill
node dist/cli.js install
node dist/cli.js sync
node dist/cli.js doctor
```

`node dist/cli.js install` 会把已安装的 skill 写入 `.skills/installed/`，并生成 `skills.lock`。

## Manifest

CLI 期望项目中存在一个 `skills.yaml`，结构如下：

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

当前 MVP 支持的 source：

- 通过 `skills[].path` 指向的本地路径 skill
- 本地文件驱动的 `index` source

## 命令

- `node dist/cli.js init`：创建 `skills.yaml`、`.skills/`，并将 `.skills/` 写入 `.gitignore`
- `node dist/cli.js add <skill>`：向 `skills.yaml` 添加 `id[@range]` 或本地路径
- `node dist/cli.js install`：解析依赖，将 skill 复制到 `.skills/installed/`，并写入 `skills.lock`
- `node dist/cli.js import`：扫描当前项目以及默认 OpenClaw skills 目录（如果存在），然后把新发现的 skill 合并到 `skills.yaml`
- `node dist/cli.js import --from <source>`：扫描 `openclaw`、`codex`、`claude_code`，或一个指定的本地路径
- `node dist/cli.js sync [target]`：使用 `copy` 或 `symlink`，将 `.skills/installed/` 同步到所有启用目标，或某一个指定目标
- `node dist/cli.js doctor`：校验 manifest 和已安装 skill，包括 `SKILL.md`、`skill.yaml`、二进制依赖和环境要求
- `node dist/cli.js list`：显示根 skill
- `node dist/cli.js list --resolved`：显示完整解析后的依赖集合
- `node dist/cli.js why <skill>`：解释某个 skill 为什么会被安装

## 导入与同步

`node dist/cli.js import` 会保留已有 manifest 条目，并按 `id` 追加新发现的 skill。导入的 skill 会记录为 `path` 依赖；如果 `skill.yaml` 提供了版本信息，也会一并保留。

`node dist/cli.js sync` 会将已安装 skill 复制或软链接到各宿主环境对应的目标目录：

- `openclaw`：默认 `~/.openclaw/skills`
- `codex`：默认 `~/.codex/skills`
- `claude_code`：默认 `~/.claude/skills`
- `generic`：要求配置 `targets[].path`

如果 `skills.yaml` 没有 `targets`，`node dist/cli.js sync` 默认同步到 `openclaw`。`node dist/cli.js sync --mode <copy|symlink>` 会覆盖 `settings.install_mode`；否则使用 manifest 中的设置。

示例：

```bash
node dist/cli.js import
node dist/cli.js install
node dist/cli.js sync
node dist/cli.js sync codex --mode symlink
```

## Index 格式

当前 MVP 的 index 格式基于本地文件，保持尽量简单：

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

`artifact.url` 会相对于 index 文件所在路径解析。

## 路径安全默认值

默认情况下，`skills` 会阻止显式配置到项目根目录之外的路径，并要求每个已安装 skill 根目录至少包含一个标记文件：

- 安装时，每个 skill 根目录必须包含 `SKILL.md` 或 `skill.yaml`
- 解析后位于当前项目之外的配置路径会被拒绝，包括相对 `../...` 穿越、显式绝对路径（含 `file://`），以及在 realpath 解析后指向项目外部的 symlink 跳转

如果需要兼容旧行为，可以显式开启：

```bash
SKILLS_ALLOW_UNSAFE_PATHS=1 node dist/cli.js install
```

## 验证

运行 smoke 流程：

```bash
npm test
```
