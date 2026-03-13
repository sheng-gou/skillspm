# SkillsPM

<p align="center">
  <img src="./docs/social-preview.jpg" alt="SkillsPM social preview" />
</p>

<div align="center">

<h2><code>skills.yaml</code> 是唯一事实来源。</h2>
<p>从它安装、冻结，并在不同 agent 与项目之间同步。</p>

![OpenClaw](https://img.shields.io/badge/OpenClaw-Supported-7C3AED.svg)
![Codex](https://img.shields.io/badge/Codex-Supported-111111.svg)
![Claude_Code](https://img.shields.io/badge/Claude_Code-Supported-D97706.svg)
![Project_+_Global](https://img.shields.io/badge/Project_+_Global-Scopes-16A34A.svg)
![Import_+_Sync](https://img.shields.io/badge/Import_+_Sync-Multi_Agent-2563EB.svg)
![Agent_Friendly](https://img.shields.io/badge/Agent-Friendly-0EA5E9.svg)

[English](README.md) | 中文

</div>

SkillsPM 用一个 `skills.yaml` 文件作为一套可复用 skills 环境的真相来源。

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

SkillsPM 把这些事情变成一个围绕 `skills.yaml` 的可重复工作流。

## 核心命令

### 从 `skills.yaml` 安装一套 skills 环境

```bash
skillspm install
```

### 把当前环境冻结到 `skills.lock`

```bash
skillspm freeze
```

### 把已安装的 skills 同步到另一个 agent

```bash
skillspm sync claude_code
```

### 接管已有配置

```bash
skillspm import --from openclaw
skillspm install
```

把已有的 Skills 配置接管进当前受管环境。默认会扫描当前工作目录，以及默认的 OpenClaw skills 目录。

### 把原始文件夹变成可管理的 skill

```bash
skillspm inspect ./my-skill --write
```

## 环境要求

* Node.js 18+（推荐）
* 当前版本优先支持 macOS / Linux

## 安装

默认从 npm 安装最新版本：

```bash
npm install -g skillspm
```

如果你想显式固定某个版本：

```bash
npm install -g skillspm@<version>
```

也可以使用安装脚本；它现在默认也是从 npm 安装：

```bash
curl -fsSL https://raw.githubusercontent.com/sheng-gou/skillspm/main/scripts/install.sh | sh
```

如果你想通过安装脚本固定版本：

```bash
curl -fsSL https://raw.githubusercontent.com/sheng-gou/skillspm/main/scripts/install.sh | SKILLSPM_VERSION=<version> sh
```

如果你想先查看安装脚本内容，再决定是否执行：

```bash
curl -fsSL https://raw.githubusercontent.com/sheng-gou/skillspm/main/scripts/install.sh
```

如果你是为了开发或调试而从源码使用：

```bash
git clone https://github.com/sheng-gou/skillspm.git
cd skillspm
npm install
npm run build
npm link
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
skillspm install
```

### 3. 同步到 agent

```bash
skillspm sync claude_code
```

### 4. 冻结当前状态

```bash
skillspm freeze
```

## `skills.yaml`

`skills.yaml` 是一套 skills 环境的真相来源。

它用来声明：

* 这套环境里有哪些 skills
* 这些 skills 从哪里来
* 安装后要同步到哪些 agent / target
* 可选的安装与同步行为

`skillspm install` 会读取 `skills.yaml`，从其中声明的来源解析 Skills，并把安装结果放到本地 `.skills` 工作目录中。

之后：

* `skillspm freeze` 会把解析后的状态写入 `skills.lock`
* `skillspm sync` 会把 `.skills` 中的已安装结果同步到一个或多个 agent

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

### `skillspm install` 从哪里安装 Skills

`skillspm install` 只会从 `skills.yaml` 中声明的来源安装 Skills。

当前版本的主要来源类型是：

* 本地 path
* 声明式本地来源文件

这样可以保证安装过程是显式的、可复现的。

### 关键字段

* `schema`：manifest 版本
* `project`：可选的项目级 metadata，其中 `project.name` 也是可选的
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

大多数情况下，你不需要手工编辑 `skills.lock`。它通常由 `skillspm install` / `skillspm freeze` 生成。

如果存在，`project.name` 只是从 `skills.yaml` 继承过来的可选项目级 metadata。

### 它的用途

* 锁定解析后的 Skills 版本
* 记录每个 Skill 的来源
* 让安装结果可复现
* 帮助人和 Agent 使用同一套环境

### 典型工作流

* 编辑 `skills.yaml`，声明期望的环境
* 运行 `skillspm install`，解析并安装环境
* 运行 `skillspm freeze`，把解析后的状态写入 `skills.lock`

### 一句话理解

* `skills.yaml` = 期望的环境
* `skills.lock` = 冻结后的已安装环境

## 常见工作流

### 管理一个 repo-local 的 skills 环境

```bash
skillspm install
skillspm sync
skillspm freeze
```

### 管理一套全局 skills 基线

这里默认你已经有一个全局的 ~/.skills/skills.yaml。

```bash
skillspm install -g
skillspm sync -g
skillspm freeze -g
```

### 从 OpenClaw 导入现有 skills

```bash
skillspm import --from openclaw
skillspm install
skillspm sync
```

### 规范化一个新创建的 skill 文件夹

```bash
skillspm inspect ./scratch/my-new-skill --write
skillspm install
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
| `skillspm install [-g]`                  | 按 `skills.yaml` 解析并安装 skills 环境            |
| `skillspm update [skill] [-g]`           | 从已配置 source 刷新 root skill 版本，或单独 pin 某个 skill |
| `skillspm freeze [-g]`                   | 将当前安装状态写入 `skills.lock`                    |
| `skillspm sync [target] [-g]`            | 将已安装的 skills 同步到一个或多个 target           |
| `skillspm import [--from <source>] [-g]` | 从 agent 或本地路径接管现有 skills                   |
| `skillspm inspect <path> --write`        | 为原始 skill 文件夹生成或补全 `skill.yaml`          |

## 其他命令

| 命令                                       | 说明                                            |
| ---------------------------------------- | --------------------------------------------- |
| `skillspm snapshot [--json] [-g]`          | 导出当前 skills 环境                                |
| `skillspm doctor [--json] [-g]`            | 诊断环境健康状态                                      |
| `skillspm init [-g]`                       | 为 project 或 global scope 生成一个初始 `skills.yaml` |
| `skillspm add <skill> [-g]`                | 向 `skills.yaml` 里添加一个 root skill              |
| `skillspm remove <skill> [-g]`             | 从 `skills.yaml` 里删除一个 root skill              |
| `skillspm list [--resolved] [--json] [-g]` | 查看当前作用域中的 skills                              |
| `skillspm why <skill> [-g]`                | 解释某个 skill 为什么会被安装                            |
| `skillspm target add <target> [-g]`        | 为当前作用域添加一个 target agent                       |
| `skillspm bootstrap [-g]`                  | `install + doctor（+ 可选 sync）` 的快捷命令           |

`skillspm import` 默认会扫描当前工作目录，以及默认的 OpenClaw skills 目录。也可以用 `--from openclaw`、`--from codex`、`--from claude_code` 或 `--from <path>` 指定单一来源。

## 给 agents 的说明

如果一个 repo 包含 `skills.yaml`，agent 通常应该执行：

```bash
skillspm install
skillspm doctor --json
```

如果 targets 已经配置好，agent 还可以执行：

```bash
skillspm sync
```

如果一个新创建的 skill 文件夹缺少 metadata：

```bash
skillspm inspect <path> --write
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

关于维护者：见 [HUMAN.md](HUMAN.md)
