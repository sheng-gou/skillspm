# skillspm

![SkillsPM social preview](./docs/social-preview.jpg)

面向 Agent 的 Skills 环境管理，让 Skills 环境可复现、可移植、可恢复。

`skills.yaml` 保存项目 intent，`skills.lock` 保存 confirmed state。
agent 可以从当前 intent 安装、解释 drift、在你接受后显式确认结果，再把同一套 confirmed environment 同步到不同 agent 与项目。
让 agent 帮你安装、管理、同步、恢复 Skills 环境。

`skillspm` 把项目 intent 放在 `skills.yaml`，把 confirmed state 放在 `skills.lock`，把机器本地物化层放在 `~/.skillspm/*`。你可以直接让 agent 准备项目、用 `inspect` 解释 drift、用 `freeze` 接受当前结果、把 confirmed environment 同步到 targets，或者打包到另一台机器恢复。

## 四个 Agent 优先场景

### 场景 1 — Development 环境 — Agent 安装 skillspm 并准备项目

先安装 CLI，再让 agent 读取 `skills.yaml`，在本地物化 Skills 环境，并解释当前项目处于什么状态。机器本地 library 只是帮助当前机器工作的 cache / materialization，不会替代项目真相。

### 场景 2 — Development 环境 — Agent 添加、纳入并管理 Skills，但不会假装它们已经确认

agent 可以把本地 Skill、已有 agent 目录或 provider-backed Skill 纳入 `skills.yaml` 管理。版本范围属于 project intent，而 `skills.lock` 会保持未确认状态，直到你显式执行 `skillspm freeze` 接受当前结果。

### 场景 3 — Confirmed 环境 — Agent 在多个 agent 间安装并同步已确认环境

当 `skills.yaml` 与 `skills.lock` 对齐后，agent 可以通过 `skillspm install` 复现 confirmed environment，再用 `skillspm sync <target>` 显式同步到目标 agent。`sync` 默认非破坏性，并且会在确认缺失或过期时拒绝执行。

### 场景 4 — Confirmed 环境 — Agent 通过 pack 恢复一台新机器

agent 可以用 `skillspm pack` 生成 `.skillspm.tgz`，再用 `skillspm install <pack>` 在新机器上恢复同一个 confirmed environment。Pack 是恢复载体，不是 source of truth。

## 快速开始

先安装一次 `skillspm`：

```bash
npm install -g skillspm
```

准备一个最小 `skills.yaml`：

```yaml
skills:
  - id: local/example
    version: 0.1.0
    source:
      kind: local
      value: ./skills/local-example
targets:
  - type: openclaw
```

用户会先说：

- “把这个项目的 Skills 环境装起来。”
- “先告诉我现在是 Development、Drifted Development 还是 Confirmed。”

Agent 会先做：

```bash
skillspm install
skillspm inspect
```

当你接受当前结果、准备分发或恢复时，再说：

- “接受当前解析结果并刷新 lockfile。”
- “把已确认环境同步到 OpenClaw。”
- “打一个给新机器恢复用的 pack。”

Agent 会再做：

```bash
skillspm freeze
skillspm sync openclaw
skillspm pack
```

## 常见工作流

### Development 环境 — Agent 安装 skillspm 并准备项目

用户会说：

“安装 `skillspm`，读取这个仓库里的 `skills.yaml`，把本地 Skills 环境准备好。”

Agent 会做：

```bash
npm install -g skillspm
skillspm install
skillspm inspect
```

`install` 负责在本地物化当前 intent，`inspect` 负责解释当前是 Uninitialized、Development、Drifted Development 还是 Confirmed。

### Development 环境 — Agent 添加、纳入并管理带版本与锁定支持的 Skills

用户会说：

“把这个本地 Skill 加进项目，把这个 provider-backed Skill 加进项目，或者把现有 agent Skills 目录纳入管理。”

Agent 会做：

```bash
skillspm add ./skills/my-skill
skillspm add owner/repo/skill --provider github
skillspm add example/skill --provider openclaw
skillspm adopt openclaw
skillspm install
```

`add` 和 `adopt` 会更新 `skills.yaml`，`install` 则把当前 Development 结果物化到本地，但不会假装已经确认完成。

### Confirmed 环境 — Agent 在多个 agent 间安装并同步已确认环境

用户会说：

“解释一下 drift，接受当前环境，然后把已确认的 Skills 同步到配置好的 agent targets。”

Agent 会做：

```bash
skillspm inspect
skillspm freeze
skillspm sync openclaw,codex
```

`freeze` 会显式刷新 `skills.lock`，`sync` 只写 confirmed state，并且会保留无关 target 内容。

### Confirmed 环境 — Agent 通过 pack 恢复一台新机器

用户会说：

“从当前已确认环境生成一个可恢复的 pack，然后用它恢复一台新机器。”

Agent 会做：

```bash
skillspm pack dist/team-env.skillspm.tgz
skillspm install dist/team-env.skillspm.tgz
```

Pack 适合私有、本地、离线和跨机器恢复，但它补充的是正常 install 流程，不会替代 `skills.yaml` + `skills.lock` 作为项目真相。

## 核心命令

这些是 agent 代表你执行的核心命令，以及它们分别带来的用户价值：

- `skillspm add <content>`：把本地路径、GitHub 输入或 provider-backed id 纳入 `skills.yaml` 管理
- `skillspm inspect`：在确认或分发之前，用用户可读语言解释项目状态、drift 和下一步安全动作
- `skillspm install [input]`：默认复现 confirmed state；在 Development 阶段也能先在本地物化当前 intent
- `skillspm freeze`：显式接受当前解析结果，并刷新 `skills.lock`
- `skillspm sync [target]`：把 confirmed environment 从本地 library cache 分发到一个或多个 agent targets
- `skillspm pack [out]`：生成可携带的 confirmed-state 恢复包，便于另一台机器、另一组 agent 或离线场景恢复
- `skillspm adopt [source]`：把现有 target 或目录纳入项目 intent，而不是手工重建
- `skillspm doctor`：当需要诊断时，检查 manifest、lockfile、cache、targets、pack readiness 和冲突
- `skillspm help [command]`：查看命令级帮助

## Development vs Confirmed 状态

- Uninitialized：项目还没有建立起可用的 intent
- Development：`skills.yaml` 表达当前 intent，`install` 可以在本地物化它
- Drifted Development：当前 intent 或本地物化结果已经偏离上一次 confirmed result
- Confirmed：`skills.yaml` 与 `skills.lock` 对齐，`install`、`sync`、`pack` 默认消费 confirmed state

一句话概括：

- `skills.yaml` = 项目 intent，保存期望的 `skills`、可选的每个 root `source`，以及可选的 `targets`
- `skills.lock` = confirmed state，保存已接受的精确版本、digest 和 resolved-from provenance
- `~/.skillspm/*` = 机器本地 cache / materialization layer，永远不是项目真相
- `.skillspm.tgz` = confirmed-state 恢复载体，不是 source of truth

## `skills.yaml`

`skills.yaml` 定义项目 intent。

它被刻意保持最小，只保存期望的 `skills`、可选的每个 root `source`，以及可选的 `targets`。

示例：

```yaml
skills:
  - id: local/example
    version: 0.1.0
    source:
      kind: local
      value: ./skills/local-example
  - id: github:owner/repo/skill
    version: ^1.2.0
targets:
  - type: openclaw
  - type: generic
    path: ./agent-skills
```

## `skills.lock`

`skills.lock` 保存环境的 confirmed state。

它在 `skills` map 下记录已接受的精确版本、内容摘要和解析来源。

示例：

```yaml
schema: skills-lock/v3
skills:
  local/example:
    version: 0.1.0
    digest: sha256:1111111111111111111111111111111111111111111111111111111111111111
    resolved_from:
      type: local
      ref: ./skills/local-example
  "github:owner/repo/skill":
    version: 1.2.3
    digest: sha256:2222222222222222222222222222222222222222222222222222222222222222
    resolved_from:
      type: pack
      ref: github__owner__repo__skill@1.2.3
```

## 机器本地 library

机器本地状态位于：

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

机器本地 library 不是项目真相；它是 `install`、`pack`、`adopt`、`sync` 使用的本地 cache / materialization layer。

当机器本地 provider 条目可用时，`~/.skillspm/library.yaml` 可以保存 direct GitHub provenance，也可以保存保留 provider 身份的记录：

```yaml
source:
  kind: provider
  value: openclaw:example/demo
  provider:
    name: openclaw
    ref: github:owner/repo/skills/demo
    visibility: public
```

直接 public GitHub provenance 也仍然有效：

```yaml
source:
  kind: provider
  value: github:owner/repo/skills/demo
  provider:
    name: github
    ref: refs/tags/v1.2.3
    visibility: public
```

已记录的 public GitHub provider provenance 也可以把匿名 public GitHub URL 写进 `source.value`（对 `github`）或 `source.provider.ref`（对保留 provider 身份的记录），例如 `https://github.com/owner/repo/tree/main/skills/demo`。不支持 URL 内嵌凭据。

## Pack

`skillspm pack` 是面向私有、本地、离线和跨机器工作流的 confirmed-state 传输与恢复能力。

`.skillspm.tgz` pack 包含：

- `skills.yaml`
- `skills.lock`
- 内部使用的 `manifest.yaml`
- 保存精确缓存 skill 内容的 `skills/`

`manifest.yaml` 是 pack 内部元数据，不是用户可编辑的环境真相。

Pack 的定位是补充正常安装流程，而不是改写 source model，也不会取代 intent + confirmed state 作为项目真相。

## 恢复边界

`skillspm install` 会先读取 `skills.yaml`，在存在时参考 `skills.lock`，检查机器本地 library 中是否存在精确内容匹配；只有在 cache miss 时才回退到 pack 内容或 manifest/library 里记录的 source。

对于 `skills.lock` 里 `resolved_from.type=provider` 且 `resolved_from.ref` 是规范 `github:` locator 或匿名 public `https://github.com/...` locator 的条目，即使在干净机器上也可以重新物化 public provider-backed source。

记录下来的 provider provenance 还能保留原始 provider id，比如 `openclaw:...`、`clawhub:...`、`skills.sh:...`，同时保存背后的 public GitHub locator。带精确版本的规范 `github:` skills 和这些 provider-backed public skills 仍然可以通过未认证的 public tag 抓取恢复。

恢复出来的 provider skill root 必须完全不含 symlink。若内容摘要不匹配，会 fail closed，而不是静默接受漂移。

这个分支里的 provider 恢复能力仍然被刻意收窄：干净机器上的回退只覆盖 public GitHub-backed providers `github`、`openclaw`、`clawhub`、`skills.sh`，而且只允许未认证访问。`skills.sh:` id 通过其公开的 GitHub repo/path 语义解析；`openclaw:` 和 `clawhub:` id 通过公开 provider metadata 解析出背后的 public GitHub locator。恢复路径会禁用 credential helper、askpass hook 和终端交互，因此任何私有或需要认证的 GitHub 访问都会诚实地 fail closed。私有仓库、需要认证的 provider 流程、非 public 可见性，以及 plain git 输入仍然必须依赖现有 cache 或 pack。

## 给 agents 的简短说明

默认工作流：

1. `skillspm install`
2. `skillspm inspect`
3. 只有在 intent 发生变化且你需要在确认前重新物化本地结果时，才再次执行 `skillspm install`
4. 只有任务明确要求更新 confirmed state 时，才执行 `skillspm freeze`
5. 只有当目标是分发 confirmed state 或生成恢复产物时，才执行 `skillspm sync <target>` 或 `skillspm pack`
6. 需要验证导向的诊断时，再执行 `skillspm doctor --json`

优先通过编辑 `skills.yaml` 来修改项目 intent。避免手工修改 `skills.lock`，避免把 cache 当成项目真相，也不要在用户未明确要求时切换到 `-g` 全局作用域。

## 当前 0.4.0 契约

### 统一的 `add` 入口

`skillspm add <content>` 会按以下顺序自动识别输入：

1. 显式本地路径（`./`、`../`、`/`、`file://`）
2. 当前工作目录下实际存在的本地路径
3. `https://github.com/...` URL
4. 带 provider 前缀或普通 skill id

`--provider <provider>` 是 non-path 输入的一等用户选择；即使不是严格必需，用户也可以主动指定。

如果未指定 `--provider`，而输入又可能匹配多个 provider，`skillspm add` 会直接失败并要求用户显式选择 provider。

公共 `github:` id 和 `https://github.com/...` locator 必须保持规范形式：不允许凭据、query string、fragment、dot segment、编码后的分隔符、反斜杠，或空路径段。

示例：

```bash
skillspm add ./skills/my-skill
skillspm add owner/repo/skill --provider github
skillspm add https://github.com/owner/repo/tree/main/skills/my-skill
skillspm add example/skill --provider openclaw
skillspm add github:owner/repo/skill
skillspm add openclaw:example/skill@^1.0.0
skillspm add clawhub:example/skill --install
skillspm add skills.sh:owner/repo/skill --install
```

对于本地路径，`add` 会先把 skill 物化到 `~/.skillspm/library.yaml` 和 `~/.skillspm/skills/`，同时把后续重物化所需的最小 `source` 信息一并写进 `skills.yaml`，这样即使本地 library/cache 被清掉，后续 install 也不会再假设之前跑过 add。

### `install` 输入优先级

`skillspm install` 按以下顺序选择输入：

1. 显式传入的 `skills.yaml` 或 `*.skillspm.tgz`
2. 当前 scope 下的 `skills.yaml`
3. 当前目录里唯一的 `*.skillspm.tgz`

如果当前目录里存在多个 pack，会直接失败。

选定输入之后，`install` 会按以下顺序处理每个 skill：

1. 从 `skills.yaml` 读取期望的 skill id / range
2. 在存在时使用 `skills.lock` 复现精确版本 + digest
3. 命中精确内容时复用机器本地 library
4. cache miss 时回退到 pack 内容
5. pack miss 时回退到已记录的 manifest/library source（本地、target，或受支持的 public-provider provenance）
6. 如果 `skills.lock` 记录了 `resolved_from.type=provider`，且 locator 是规范公共 `github:` id 或匿名公共 `https://github.com/...` locator，则先尝试该 lockfile 驱动的 public recovery
7. 否则，如果 `library.yaml` 记录了 public provider provenance，则在 cache miss 时优先使用该 provenance（`github` 可以保存精确 ref；`openclaw` / `clawhub` / `skills.sh` 保存原始 provider id + 背后的 public GitHub locator）
8. 否则，如果 skill id 本身就是受支持的 public provider id（`github:...`、`openclaw:...`、`clawhub:...`、`skills.sh:...`），就从项目语义推导精确 public version 和 backing locator，再通过未认证 public tag 恢复
9. 如果恢复出的 provider skill root 下任意位置存在 symlink，则直接拒绝恢复
10. 若 digest 不匹配，则 fail closed，而不是静默接受漂移

### `adopt` 与 `sync`

`adopt` 和 `sync` 都采用直接的 target-object 心智模型。

示例：

```bash
skillspm adopt openclaw
skillspm adopt openclaw,codex
skillspm sync claude_code
skillspm sync openclaw,codex
```

`adopt` 也可以直接接收一个本地目录路径，而不是 target 名称。对于本地路径和已知 target，`adopt` 会把 source 路径同时记录到项目 `skills.yaml` 和机器本地 library 中；只要该 source 路径仍然存在，后续 install 即使在干净 library 上也能从 cache miss 恢复。

`skillspm sync` 会把当前 lock 中的 skills 写入配置好的 agent targets。

默认是非破坏性的：

- 会更新它当前管理的已锁定 skill 条目
- 不会清理无关或未托管的 target 内容
- 如果解析后的 target 路径越过允许的 containment root，会在任何写入前直接失败

### Doctor 检查范围

`skillspm doctor` 会显式检查：

- manifest 契约
- lockfile 是否存在及其内容
- 机器本地 library/cache 可用性
- pack readiness
- sync target 的 containment 与主机兼容性
- project/global manifest 冲突

需要机器可读诊断时，使用 `skillspm doctor --json`。
