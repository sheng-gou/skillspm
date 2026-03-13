# skills

<div align="center">

![OpenClaw](https://img.shields.io/badge/OpenClaw-Supported-7C3AED.svg)
![Codex](https://img.shields.io/badge/Codex-Supported-111111.svg)
![Claude_Code](https://img.shields.io/badge/Claude_Code-Supported-D97706.svg)
![Project_+_Global](https://img.shields.io/badge/Project_+_Global-Scopes-16A34A.svg)
![Import_+_Sync](https://img.shields.io/badge/Import_+_Sync-Multi_Agent-2563EB.svg)
![Agent_Friendly](https://img.shields.io/badge/Agent-Friendly-0EA5E9.svg)

**像包管理器一样管理 AI Agent Skills 环境**

[English](README.md) | 中文

</div>

`skills` 用一个 `skills.yaml` 文件作为一套可复用 skills 环境的真相来源。

核心工作流：

- install
- freeze
- sync
- import
- inspect

## 为什么会有这个工具

AI 编码 Agent 已经越来越擅长使用 skills，但 skill 管理仍然很混乱。

今天，大多数团队仍然在：

- 手工复制 skill 文件夹
- 在多个 agent 之间重复安装相同的 skills
- 搞不清一个 repo 到底依赖哪些 skills
- 创建没有版本号或 metadata 的临时 skill 文件夹
- 很难把一套现有配置从一个 agent 迁移到另一个 agent

`skills` 把这些事情变成一个围绕 `skills.yaml` 的可重复工作流。

## 核心命令

### 从 `skills.yaml` 安装一套 skills 环境

```bash
skills install
```

### 把当前环境冻结到 `skills.lock`

```bash
skills freeze
```

### 把已安装的 skills 同步到另一个 agent

```bash
skills sync claude_code
```

### 接管已有配置

```bash
skills import --from openclaw
skills install
```

### 把原始文件夹变成可管理的 skill

```bash
skills inspect ./my-skill --write
```

## 环境要求

* Node.js 18+（推荐）
* 当前版本优先支持 macOS / Linux

## 安装

```bash
npm install -g skills
```

## 快速开始

### 1. 在 `skills.yaml` 里定义你的环境

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

### 2. 安装它

```bash
skills install
```

### 3. 同步到 agent

```bash
skills sync claude_code
```

### 4. 冻结当前状态

```bash
skills freeze
```

## `skills.yaml`

`skills.yaml` 是一套 skills 环境的真相来源。

它用来声明：

* 这套环境里有哪些 skills
* 这些 skills 从哪里来
* 安装后要同步到哪些 agent / target
* 可选的安装与同步行为

`skills install` 会读取 `skills.yaml`，从其中声明的来源解析 Skills，并把安装结果放到本地 `.skills` 工作目录中。

之后：

* `skills freeze` 会把解析后的状态写入 `skills.lock`
* `skills sync` 会把 `.skills` 中的已安装结果同步到一个或多个 agent

### 最小示例

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

### 带 source 的示例

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

### `skills install` 从哪里安装 Skills

`skills install` 只会从 `skills.yaml` 中声明的来源安装 Skills。

当前版本的主要来源类型是：

* 本地 path
* 声明好的本地 YAML 来源文件

这样可以保证安装过程是显式的、可复现的。

### 关键字段

* `schema`：manifest 版本
* `sources`：可选的声明式来源
* `skills`：这套环境中的根 skills
* `targets`：安装后要同步到哪里
* `settings`：可选行为，例如 `auto_sync`

### skill 的两种常见声明方式

#### 本地 path skill

```yaml
- id: local/code-review
  path: ./local-skills/code-review
```

#### 基于 source 的 skill

```yaml
- id: openai/code-review
  version: ^1.2.0
  source: community
```

简单来说：

* 本地 skill 用 `path`
* 通过声明式来源解析的 skill 用 `id + version + source`

## `skills.lock`

`skills.lock` 用来保存一套 Skills 环境冻结后的解析结果。

如果说 `skills.yaml` 描述的是：

> 我想要什么

那么 `skills.lock` 记录的就是：

> 实际解析并安装成了什么

它最核心的作用，就是锁定这套环境中 Skills 的解析版本和来源，从而让这套环境之后还能被稳定复现，无论是在不同机器、不同仓库，还是不同 Agent 中。

大多数情况下，你不需要手工编辑 `skills.lock`。它通常由 `skills install` / `skills freeze` 生成。

### 它的用途

* 锁定解析后的 Skills 版本
* 记录每个 Skill 的来源
* 让安装结果可复现
* 帮助人和 Agent 使用同一套环境

### 典型工作流

* 编辑 `skills.yaml`，声明期望的环境
* 运行 `skills install`，解析并安装环境
* 运行 `skills freeze`，把解析后的状态写入 `skills.lock`

### 一句话理解

* `skills.yaml` = 期望的环境
* `skills.lock` = 冻结后的已安装环境

## 常见工作流

### 管理一个 repo-local 的 skills 环境

```bash
skills install
skills sync
skills freeze
```

### 管理一套全局 skills 基线

这里默认你已经有一个全局的 ~/.skills/skills.yaml。

```bash
skills install -g
skills sync -g
skills freeze -g
```

### 从 OpenClaw 导入现有 skills

```bash
skills import --from openclaw
skills install
skills sync
```

### 规范化一个新创建的 skill 文件夹

```bash
skills inspect ./scratch/my-new-skill --write
skills install
```

## 它是怎么工作的

### Project scope（默认）

```text
repo/
├── skills.yaml
├── skills.lock
└── .skills/
    ├── installed/
    └── imported/
```

### Global scope（`-g`）

```text
~/.skills/
├── skills.yaml
├── skills.lock
├── installed/
└── imported/
```

推荐用法：

* 默认优先使用 project scope
* 只有在你明确想读写全局环境时才加 `-g`

### 核心文件

* `skills.yaml`：当前作用域的环境声明
* `skills.lock`：冻结后的安装状态

## 命令参考

| 命令                                   | 说明                              |
| ------------------------------------ | ------------------------------- |
| `skills install [-g]`                  | 按 `skills.yaml` 解析并安装 skills 环境            |
| `skills update [skill] [-g]`           | 从已配置 source 刷新 root skill 版本，或单独 pin 某个 skill |
| `skills freeze [-g]`                   | 将当前安装状态写入 `skills.lock`                    |
| `skills sync [target] [-g]`            | 将已安装的 skills 同步到一个或多个 target           |
| `skills import [--from <source>] [-g]` | 从 agent 或本地路径接管现有 skills                   |
| `skills inspect <path> --write`        | 为原始 skill 文件夹生成或补全 `skill.yaml`          |

## 其他命令

| 命令                                       | 说明                                            |
| ---------------------------------------- | --------------------------------------------- |
| `skills snapshot [--json] [-g]`          | 导出当前 skills 环境                                |
| `skills doctor [--json] [-g]`            | 诊断环境健康状态                                      |
| `skills init [-g]`                       | 为 project 或 global scope 生成一个初始 `skills.yaml` |
| `skills add <skill> [-g]`                | 向 `skills.yaml` 里添加一个 root skill              |
| `skills remove <skill> [-g]`             | 从 `skills.yaml` 里删除一个 root skill              |
| `skills list [--resolved] [--json] [-g]` | 查看当前作用域中的 skills                              |
| `skills why <skill> [-g]`                | 解释某个 skill 为什么会被安装                            |
| `skills target add <target> [-g]`        | 为当前作用域添加一个 target agent                       |
| `skills bootstrap [-g]`                  | `install + doctor（+ 可选 sync）` 的快捷命令           |

`skills import` 默认会扫描当前工作目录，以及默认的 OpenClaw skills 目录。也可以用 `--from openclaw`、`--from codex`、`--from claude_code` 或 `--from <path>` 指定单一来源。

## 给 agents 的说明

如果一个 repo 包含 `skills.yaml`，agent 通常应该执行：

```bash
skills install
skills doctor --json
```

如果 targets 已经配置好，agent 还可以执行：

```bash
skills sync
```

如果一个新创建的 skill 文件夹缺少 metadata：

```bash
skills inspect <path> --write
```

除非用户明确要求，否则 Agent 不应手工编辑 `skills.lock`。

更详细的 agent 说明应写在 `AGENTS.md` 中。

## 当前支持

当前已支持：

* project scope 和 global scope
* manifest + lockfile 工作流
* 从 OpenClaw / Codex / Claude Code / 本地路径导入
* 同步到 OpenClaw / Codex / Claude Code / generic target
* 检查并生成最小化 `skill.yaml`
* 带 JSON 输出的 snapshot 和 list
* 带 JSON 输出的 doctor

## 当前限制

尚未实现或仍有限制：

* git source install
* remote registry / auth / download 流程
* 新 skill 的自动依赖推断
* 更深入的 host compatibility rules

## 开发

```bash
npm install
npm test
```
