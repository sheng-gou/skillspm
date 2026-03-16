# skillspm

`skillspm` 用最小化项目清单 + 机器本地 library cache 来管理声明式 Skills 环境。

## 0.3.0 模型

项目真相文件只有：

- `skills.yaml`
- `skills.lock`

机器本地状态位于：

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

`skills.yaml` 被刻意收缩为最小公开契约：只保留 `skills` 和可选的 `targets`。

`skills.lock` 在 `skills` 映射下记录精确解析后的版本。

机器本地 library 不是项目真相，而是 `install`、`pack`、`adopt`、`sync` 使用的本地物化层。

## Manifest

```yaml
skills:
  - id: local/example
    version: 0.1.0
  - id: github:owner/repo/skill
    version: ^1.2.0
targets:
  - type: openclaw
  - type: generic
    path: ./agent-skills
```

## Lockfile

```yaml
schema: skills-lock/v2
skills:
  local/example: 0.1.0
  github:owner/repo/skill: 1.2.3
```

## 公共命令

- `skillspm add <content>`
- `skillspm install [input]`
- `skillspm pack [out]`
- `skillspm freeze`
- `skillspm adopt [source]`
- `skillspm sync [target]`
- `skillspm doctor`
- `skillspm help [command]`

## 统一的 `add` 入口

`skillspm add <content>` 会按以下顺序自动识别输入：

1. 显式本地路径（`./`、`../`、`/`、`file://`）
2. 当前工作目录下实际存在的本地路径
3. `https://github.com/...` URL
4. 带 provider 前缀或普通 skill id

`--provider <provider>` 是 non-path 输入的一等用户选择；即使不是严格必需，用户也可以主动指定。

如果未指定 `--provider`，而输入又可能匹配多个 provider，`skillspm add` 会直接失败并要求用户显式选择 provider。

示例：

```bash
skillspm add ./skills/my-skill
skillspm add owner/repo/skill --provider github
skillspm add https://github.com/owner/repo/tree/main/skills/my-skill
skillspm add example/skill --provider openclaw
skillspm add github:owner/repo/skill
skillspm add openclaw:example/skill@^1.0.0
```

对于本地路径，`add` 会先把 skill 物化到 `~/.skillspm/library.yaml` 和 `~/.skillspm/skills/`，然后只把 `id` 和 `version` 写进 `skills.yaml`。

## `adopt` 与 `sync`

`adopt` 和 `sync` 都采用直接的 target-object 心智模型。

示例：

```bash
skillspm adopt openclaw
skillspm adopt openclaw,codex
skillspm sync claude_code
skillspm sync openclaw,codex
```

`adopt` 也可以直接接收一个本地目录路径，而不是 target 名称。

## `install` 输入优先级

`skillspm install` 按以下顺序选择输入：

1. 显式传入的 `skills.yaml` 或 `*.skillspm.tgz`
2. 当前 scope 下的 `skills.yaml`
3. 当前目录里唯一的 `*.skillspm.tgz`

如果当前目录里存在多个 pack，会直接失败。

## Pack 结构

`.skillspm.tgz` pack 包含：

- `skills.yaml`
- `skills.lock`
- 内部使用的 `manifest.yaml`
- 保存精确缓存 skill 内容的 `skills/`

`manifest.yaml` 只是 pack 内部元数据，不是用户可编辑的环境真相。

## Doctor 检查范围

`skillspm doctor` 会显式检查：

- manifest 契约
- lockfile 是否存在及其内容
- 机器本地 library/cache 可用性
- pack readiness
- sync target 的 containment 与主机兼容性
- project/global manifest 冲突

需要机器可读诊断时，使用 `skillspm doctor --json`。

## Sync 行为

`skillspm sync` 会把当前 lock 中的 skills 写入配置好的 agent target。

默认是非破坏性的：

- 会更新它当前管理的已锁定 skill 条目
- 不会清理无关或未托管的 target 内容
- 如果解析后的 target 路径越过允许的 containment root，会在任何写入前直接失败

## 常见流程

```bash
skillspm add ./skills/my-skill
skillspm install
skillspm doctor
skillspm sync openclaw
skillspm freeze
```
