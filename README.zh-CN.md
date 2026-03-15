# skillspm

`skillspm` 用来管理声明式 Skills 环境，采用 id-first 清单和机器本地 library cache。

## 0.3.0 Phase 2 模型

项目真相文件只有：

- `skills.yaml`
- `skills.lock`

机器本地缓存位于：

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

`skills.yaml` 只保留根 `skills` 和 `targets`。

`skills.lock` 只保留精确解析后的版本。

library cache 不是环境真相，只是 `install`、`pack`、`sync` 使用的本地缓存层。

## Manifest

```yaml
schema: skills/v2
skills:
  - id: local/example
    path: ./skills/example
  - id: github:owner/repo/skill
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

`skillspm help` 的主帮助面聚焦于：

- `skillspm add`
- `skillspm install`
- `skillspm pack`
- `skillspm freeze`
- `skillspm adopt`
- `skillspm sync`
- `skillspm doctor`
- `skillspm help`

## install 输入优先级

`skillspm install` 按以下顺序选择输入：

1. 显式传入的 `skills.yaml` 或 `*.skillspm.tgz`
2. 当前 scope 下的 `skills.yaml`
3. 当前目录里唯一的 `*.skillspm.tgz`

如果当前目录存在多个本地 pack，会直接失败。

## Pack 结构

`.skillspm.tgz` pack 包含：

- `skills.yaml`
- `skills.lock`
- 用于内部校验的 `manifest.yaml`
- 存放精确 skill 内容的 `skills/`

`manifest.yaml` 只是 pack 内部元数据，不是用户可编辑的环境真相。

## Sync 行为

`skillspm sync` 会把当前 lock 里的 skills 写入已配置的 agent target。

默认是非破坏性的：

- 会更新它当前管理的已锁定 skill 条目
- 不会清理无关或未托管的 target 内容
- 如果解析后的 target 路径越过允许的 containment root，会在任何写入前直接失败

## 常见流程

```bash
skillspm add ./skills/my-skill
skillspm install
skillspm sync
skillspm freeze
```
