# skills

英文 README: [README.md](README.md)

`skills` 是一个面向 **可复现 AI Agent Skills 环境** 的 CLI。

它负责维护 manifest、解析依赖、安装本地工作集、同步到不同 Agent 目录，并用 `skills.lock` 固化结果。

## V1.2 核心心智模型

- **项目作用域** 默认开启：`./skills.yaml`、`./skills.lock`、`./.skills/installed/`
- **全局作用域** 通过 `-g` / `--global` 显式启用：`~/.skills/skills.yaml`、`~/.skills/skills.lock`、`~/.skills/installed/`
- 当两者同时存在时，推荐优先级：**project > global**
- **项目作用域** 适合仓库内的技能依赖
- **全局作用域** 适合你的个人基线技能环境

## 三条最有感知的使用路径

### 1）拉下仓库后直接 bootstrap

```bash
npm install
npm run build

node dist/cli.js init
node dist/cli.js add ./local-skills/my-skill
node dist/cli.js bootstrap
```

`skills bootstrap` 是 **install + doctor** 的快捷路径；当 `settings.auto_sync: true` 时，也会按现有行为自动 sync。

### 2）导入一次，到处同步

```bash
skills init -g
skills import -g --from openclaw
skills install -g
skills sync -g
skills sync -g codex --mode symlink
```

这样你可以把 `~/.skills/` 当成可迁移的全局技能环境，再投射到 OpenClaw、Codex、Claude Code 或通用目录里。

### 3）把 AI 生成的文件夹变成可管理 skill

```bash
skills inspect ./scratch/my-new-skill --write
skills add ./scratch/my-new-skill
skills bootstrap
```

`skills inspect` 要求目录里已经有 `SKILL.md`，然后再补一个最小可用的 `skill.yaml`：

- `id`：缺失时默认用文件夹名
- `version`：缺失时默认 `0.1.0`
- `dependencies`：缺失时默认 `[]`
- `package`：默认 `dir` + `./`

如果还没有 `SKILL.md`，`skills inspect` 会直接失败并提示先补上。

## 快速开始

### 从 npm 安装

```bash
npm install -g skills
```

### 项目作用域

```bash
skills init
skills add ./local-skills/my-skill
skills install
skills doctor
```

### 全局作用域

```bash
skills init -g
skills add -g ~/.skills/local-skills/my-skill
skills install -g
skills doctor -g
```

## 命令一览

- `skills init [-g]`：初始化 `skills.yaml` 和当前作用域的安装根目录
- `skills add <skill> [-g]`：向 `skills.yaml` 添加 `id[@range]` 或本地路径
- `skills remove <skill> [-g]`：从 `skills.yaml` 删除一个根 skill
- `skills install [-g]`：解析依赖、安装 skills、写入 `skills.lock`；当 `settings.auto_sync: true` 时自动同步
- `skills bootstrap [-g]`：相当于 `install` + `doctor`
- `skills freeze [-g]`：根据当前已安装状态重写 `skills.lock`
- `skills import [-g] [--from <source>]`：扫描 `openclaw`、`codex`、`claude_code` 或本地路径，并合并进 `skills.yaml`
- `skills inspect <path> [--write] [--set-version <v>] [--json]`：检查本地 skill 目录并生成最小 metadata
- `skills sync [-g] [target] [--mode <copy|symlink>]`：把已安装 skills 同步到启用目标或单个目标
- `skills target add <target> [-g]`：向 `skills.yaml` 添加内置同步目标（`openclaw`、`codex` 或 `claude_code`）
- `skills doctor [-g] [--json]`：校验 manifest、已安装技能、`SKILL.md`、`skill.yaml`、二进制依赖和环境变量
- `skills list [-g] [--resolved] [--json]`：查看根技能或完整解析结果
- `skills snapshot [-g] [--resolved] [--json]`：汇总当前选中技能环境的状态
- `skills why [-g] <skill>`：解释某个 skill 为什么会被安装

## 作用域布局

### 项目作用域（默认）

```text
repo/
├── skills.yaml
├── skills.lock
└── .skills/
    ├── installed/
    └── imported/
```

### 全局作用域（`-g`）

```text
~/.skills/
├── skills.yaml
├── skills.lock
├── installed/
└── imported/
```

### 当前作用域规则

没有自动切换逻辑：每条命令只有两种情况：

- 默认就是 **project scope**
- 传 `-g` 才是 **global scope**

如果两套都存在，把它们当成独立环境使用；仓库内工作优先用 **project scope**。

## Agent 使用方式

### OpenClaw

```bash
skills sync
```

当 `skills.yaml` 没有配置 targets 时，默认同步到 `~/.openclaw/skills`。

### Codex

```bash
skills sync codex --mode symlink
```

默认目录是 `~/.codex/skills`。

### Claude Code

```bash
skills sync claude_code
```

默认目录是 `~/.claude/skills`。

### Generic 目标

在 `skills.yaml` 中显式配置路径：

```yaml
targets:
  - type: generic
    path: ./.agent-skills
```

## Manifest 示例

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

## Import 与托管拷贝（vendoring）

`skills import` 会保留现有 manifest 条目，只按 `id` 追加新发现的 skills。

当扫描到的 skill 位于受管根目录之外时，`skills` 会先把它托管拷贝进环境内，再写成安全的本地 `path`：

- project scope → `./.skills/imported/`
- global scope → `~/.skills/imported/`

这样就能保持可复现，同时不需要打开 `SKILLS_ALLOW_UNSAFE_PATHS=1`。

## `skills inspect`

适合目录里已经有 skill 内容，但 metadata 还不完整的场景。

```bash
skills inspect ./my-skill
skills inspect ./my-skill --set-version 0.2.0 --write
```

行为规则：

- `SKILL.md` 必须先存在
- 没有 `skill.yaml` 就生成最小版本
- 没有 `id` 就用文件夹名
- 没有 `version` 就用 `0.1.0`
- 没有 `dependencies` 就用 `[]`

## `skills list --json` 与 `skills snapshot --json`

自动化场景可以直接使用：

```bash
skills list --json
skills list --resolved --json
skills snapshot --json
skills snapshot --resolved --json
```

这些报告会输出当前作用域下的结构化信息，包括根技能、解析结果、targets 状态和时间戳。

## `skills doctor --json`

自动化场景可直接用：

```bash
skills doctor --json
skills doctor -g --json
```

JSON 报告包含：

- scope
- root directory
- installed root
- warning / error 数量
- 每条 finding 的消息
- 总体结果：`healthy`、`warnings` 或 `failed`

## 路径安全默认策略

默认情况下，`skills` 会阻止越界路径，并要求每个已安装 skill 根目录至少有一个标记文件：

- 安装时 skill 根目录必须包含 `SKILL.md` 或 `skill.yaml`
- 所有配置路径如果最终解析到当前受管根目录之外，都会被拒绝，包括 `../...`、绝对路径、`file://` 和 symlink 逃逸

如果确实需要旧行为，必须显式打开：

```bash
SKILLS_ALLOW_UNSAFE_PATHS=1 skills install
SKILLS_ALLOW_UNSAFE_PATHS=1 skills install -g
```

## 当前明确未实现的部分

以下能力目前仍未实现：

- Git source install：`sources[].type: git` 虽然 schema 接受，但 `skills install` **不会** 拉取或安装 git source
- 远程 registry / 鉴权 / 下载流程
- 超出本地 file-backed index 与本地路径之外的发布与制品获取能力

## 本地开发

```bash
npm install
npm run build
npm test
```
