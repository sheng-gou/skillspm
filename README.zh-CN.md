# skills

<div align="center">

![OpenClaw](https://img.shields.io/badge/OpenClaw-Supported-7C3AED.svg)
![Codex](https://img.shields.io/badge/Codex-Supported-111111.svg)
![Claude_Code](https://img.shields.io/badge/Claude_Code-Supported-D97706.svg)
![Project_+_Global](https://img.shields.io/badge/Project_+_Global-Scopes-16A34A.svg)
![Import_+_Sync](https://img.shields.io/badge/Import_+_Sync-Multi_Agent-2563EB.svg)
![Agent_Friendly](https://img.shields.io/badge/Agent-Friendly-0EA5E9.svg)

**像管理真正的环境一样管理 AI Agent Skills**

[English](README.md) | 中文

</div>

在不同项目和 agent 之间复现、同步、检查并复用 skills。

## 为什么会有这个工具

AI 编码 Agent 已经越来越擅长使用 skills，但 skill 管理仍然很混乱。

今天，大多数团队仍然在：

- 手工复制 skill 文件夹
- 在多个 agent 之间重复安装相同的 skills
- 搞不清一个 repo 到底依赖哪些 skills
- 创建没有版本号或 metadata 的临时 skill 文件夹
- 很难把一套现有配置从一个 agent 迁移到另一个 agent

`skills` 把这些事情变成一个可重复的工作流。

## 核心亮点

### clone 一个 repo，跑一条命令，就拿到同一套 skills

```bash
skills bootstrap
```

### 一次导入，到处同步

```bash
skills import --from openclaw
skills sync claude_code
```

### 把 AI 生成的文件夹变成可管理的 skill

```bash
skills inspect ./my-skill --write
```

### 同时使用 project-local 和 global skills

```bash
skills install
skills install -g
```

## 环境要求

- Node.js 18+（推荐）
- 当前版本优先支持 macOS / Linux

## 安装

### 用户安装

```bash
npm install -g skills
```

### 本地开发

```bash
npm install
npm test
```

## 快速开始

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

## 常见工作流

### bootstrap 一个 repo-local 的 skills 环境

```bash
skills bootstrap
```

安装当前作用域、写入 `skills.lock`、运行诊断，并在启用 `auto_sync` 时执行同步。

### 从 OpenClaw 导入现有 skills

```bash
skills init -g
skills import -g --from openclaw
skills install -g
skills sync -g
```

### 添加一个新的 target agent

```bash
skills target add claude_code
skills sync claude_code
```

### 规范化一个新创建的 skill 文件夹

```bash
skills inspect ./scratch/my-new-skill --write
skills add ./scratch/my-new-skill
skills bootstrap
```

`skills inspect` 可以生成或补全一个最小化的 `skill.yaml`：

- `id`
- `name`
- `version`（默认 `0.1.0`）
- `package`
- `dependencies`

### 导出机器可读的环境快照

```bash
skills snapshot --json
```

## 它是怎么工作的

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

推荐优先级：

- project > global

### 核心文件

- `skills.yaml`：当前作用域的 manifest
- `skills.lock`：解析后的安装状态
- `skill.yaml`：单个 skill 的 metadata

## 命令

| 命令 | 说明 |
|---|---|
| `skills init [-g]` | 初始化 project 或 global scope |
| `skills add <skill> [-g]` | 添加一个 root skill |
| `skills remove <skill> [-g]` | 删除一个 root skill |
| `skills install [-g]` | 解析并安装 skills |
| `skills bootstrap [-g]` | Install + doctor（+ 可选 sync） |
| `skills import [-g] --from <source>` | 从 agent 或本地路径导入 skills |
| `skills inspect <path> --write` | 生成或补全 `skill.yaml` |
| `skills snapshot [--json] [-g]` | 导出当前 skills 环境 |
| `skills list [--resolved] [--json] [-g]` | 展示当前作用域中的 skills |
| `skills freeze [-g]` | 将当前安装状态写入 lockfile |
| `skills target add <target> [-g]` | 添加一个 target agent |
| `skills sync [target] [-g]` | 将已安装 skills 同步到 targets |
| `skills doctor [--json] [-g]` | 诊断环境健康状态 |
| `skills why <skill> [-g]` | 解释某个 skill 为什么会被安装 |

## 给 agents 的说明

如果一个 repo 包含 `skills.yaml`，agent 通常应该执行：

```bash
skills bootstrap
```

如果新增了一个 target agent：

```bash
skills target add <target>
skills sync <target>
```

如果一个新创建的 skill 文件夹缺少 metadata：

```bash
skills inspect <path> --write
```

更多说明见 `AGENTS.md`。

## 当前支持

当前已支持：

- project scope 和 global scope
- manifest + lockfile 工作流
- 从 OpenClaw / Codex / Claude Code / 本地路径导入
- 同步到 OpenClaw / Codex / Claude Code / generic target
- 检查并生成最小化 `skill.yaml`
- 带 JSON 输出的 snapshot 和 list
- 带 JSON 输出的 doctor

## 当前限制

尚未实现或仍有限制：

- git source install
- remote registry / auth / download 流程
- 新 skill 的自动依赖推断
- 更深入的 host compatibility rules

## 开发

```bash
npm install
npm test
```
