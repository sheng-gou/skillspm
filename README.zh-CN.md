# skills

English README: [README.md](README.md)

`skills` 是一个 MVP CLI，用于管理项目本地的 AI agent skill，支持 manifest、依赖解析、本地安装、导入辅助、目标目录同步以及可复现的锁文件。

## 快速开始

```bash
npm install -g skills

skills init
skills add ./local-skills/my-skill
skills install
skills doctor
```

`skills install` 会把已安装的 skill 写入 `.skills/installed/`，并生成 `skills.lock`。

如果是在当前仓库里做本地开发：

```bash
npm install
npm run build
node dist/cli.js --help
```

## 命令

- `skills init`：创建 `skills.yaml`、`.skills/`，并将 `.skills/` 写入 `.gitignore`
- `skills add <skill>`：向 `skills.yaml` 添加 `id[@range]` 或本地路径
- `skills install`：解析依赖、安装到 `.skills/installed/`、写入 `skills.lock`，并在 `settings.auto_sync: true` 时自动执行同步
- `skills import`：扫描当前项目，以及默认 OpenClaw skills 目录（如果存在），然后把新发现的 skill 合并到 `skills.yaml`
- `skills import --from <source>`：扫描 `openclaw`、`codex`、`claude_code`，或一个指定的本地路径
- `skills sync [target]`：使用 `copy` 或 `symlink`，将 `.skills/installed/` 同步到所有启用目标，或某一个指定目标
- `skills doctor`：校验 manifest 和已安装 skill，包括 `SKILL.md`、`skill.yaml`、二进制依赖和环境要求
- `skills list`：显示根 skill
- `skills list --resolved`：显示完整解析后的依赖集合
- `skills why <skill>`：解释某个 skill 为什么会被安装

## 当前 MVP 范围

- 项目本地的 `skills.yaml`、`.skills/installed/` 和 `skills.lock`
- 通过 `skills[].path` 声明的本地 skill
- 基于本地文件的 `index` source
- `import` 可扫描当前项目和默认宿主 skills 目录，并把项目外发现的 skill vendoring 到 `.skills/imported/`
- `sync` 支持 `openclaw`、`codex`、`claude_code` 和 `generic`
- 默认路径安全策略：拒绝项目根目录之外的路径，除非显式设置 `SKILLS_ALLOW_UNSAFE_PATHS=1`

## 尚未实现

- Git source 安装：schema 校验接受 `sources[].type: git`，但 `skills install` 还不会拉取或安装 git source
- 远程 registry、认证、下载流程
- 发布流程，以及超出“本地文件 index + 本地路径”范围的 artifact 获取

## Manifest

CLI 期望项目中存在一个 `skills.yaml`，结构如下：

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

## 导入与同步

`skills import` 会保留已有 manifest 条目，并按 `id` 追加新发现的 skill。对于项目根目录之外发现的 skill，会先复制到 `.skills/imported/`，再写成项目内的 `path` 条目，这样 `skills install` 不需要 `SKILLS_ALLOW_UNSAFE_PATHS=1` 也能工作。

`skills sync` 会将已安装 skill 复制或软链接到各宿主环境对应的目标目录：

- `openclaw`：默认 `~/.openclaw/skills`
- `codex`：默认 `~/.codex/skills`
- `claude_code`：默认 `~/.claude/skills`
- `generic`：要求配置 `targets[].path`

如果 `skills.yaml` 没有 `targets`，`skills sync` 默认同步到 `openclaw`。`skills sync --mode <copy|symlink>` 会覆盖 `settings.install_mode`；否则使用 manifest 中的设置。

示例：

```bash
skills import
skills install
skills sync
skills sync codex --mode symlink
```

## Index 格式

当前 MVP 的 index 格式基于本地文件：

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
SKILLS_ALLOW_UNSAFE_PATHS=1 skills install
```

## 验证

```bash
npm test
```
