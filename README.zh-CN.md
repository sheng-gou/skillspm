# skillspm

![SkillsPM social preview](./docs/social-preview.jpg)

以显式的 Development / Confirmed 状态模型，构建可复现、可移植的 Skills 环境。

`skillspm` 把项目 intent 放在 `skills.yaml`，把 confirmed state 放在 `skills.lock`，把机器本地物化层放在 `~/.skillspm/*`。

`inspect` 负责解释 drift 和下一步安全动作。`freeze` 是显式刷新确认状态的步骤。`install`、`sync`、`pack` 默认消费 confirmed state。

## 你可以用 skillspm 做什么

### [Development] Start or change the environment

通过 `add`、`adopt` 或直接编辑 manifest 来创建或修改 `skills.yaml`，然后执行 `skillspm install` 在本地物化当前 intent。如果还没有 confirmed state，项目仍然处于 Development。

### [Development] Inspect drift and confirm accepted changes

执行 `skillspm inspect`，查看项目当前是 Uninitialized、Development、Drifted Development 还是 Confirmed。当你接受当前结果时，再执行 `skillspm freeze` 显式刷新 `skills.lock`。

### [Confirmed] Install or sync the confirmed environment

当 `skills.yaml` 与 `skills.lock` 对齐时，`skillspm install` 会复现 confirmed environment，`skillspm sync <target>` 会显式分发它。`sync` 默认是非破坏性的，并且会在确认缺失或过期时拒绝执行。

### [Confirmed] Pack and restore the confirmed environment

使用 `skillspm pack` 把 confirmed environment 打成 `.skillspm.tgz` 恢复载体，再通过 `skillspm install <pack>` 在别处恢复。Pack 是面向私有、本地、离线和跨机器场景的恢复补充，不会变成项目真相。

## 快速开始

最小 `skills.yaml`：

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

然后按这条 onboarding 路径执行：

```bash
skillspm install
skillspm inspect
skillspm install
skillspm freeze
skillspm sync openclaw
skillspm pack
```

各步含义如下：

- 第一次 `install`：从 `skills.yaml` 在本地物化当前 intent
- `inspect`：检查项目当前仍是 Development、Drifted Development，还是已经 Confirmed
- 第二次 `install`：如果你在确认前又修改了 intent，就再次物化当前结果
- `freeze`：显式刷新 `skills.lock` 中的 confirmed state
- `sync`：显式且非破坏性地分发 confirmed environment
- `pack`：生成用于传输和恢复的 confirmed-state 恢复包

## 常见工作流

### [Development] Start or change the environment

```bash
skillspm add ./skills/my-skill
skillspm install
```

你也可以把已有内容纳入 intent 管理：

```bash
skillspm adopt openclaw
skillspm install
```

Mixed-source intent 是支持的，且会以最小形式持久化进 `skills.yaml`：

```bash
skillspm add owner/repo/skill --provider github
skillspm add example/skill --provider openclaw
skillspm add https://github.com/owner/repo/tree/main/skills/my-skill
```

### [Development] Inspect drift and confirm accepted changes

```bash
skillspm inspect
skillspm install
skillspm freeze
```

把 `inspect` 当作用户可读的 drift 入口。`install` 可以在本地物化当前 intent，但真正刷新确认状态的显式步骤仍然是 `freeze`。

### [Confirmed] Install or sync the confirmed environment

```bash
skillspm install
skillspm sync openclaw
```

当你除了用户可读状态之外，还需要验证导向的诊断时，执行 `skillspm doctor --json`。

### [Confirmed] Pack and restore the confirmed environment

```bash
skillspm pack dist/team-env.skillspm.tgz
skillspm install dist/team-env.skillspm.tgz
```

## 核心命令

- `skillspm add <content>`：把本地路径、GitHub 输入或 provider-backed id 纳入 `skills.yaml`
- `skillspm inspect`：解释当前 intent、confirmed state、drift 和下一步安全动作
- `skillspm install [input]`：默认消费 confirmed state；在尚未确认时仍可先在本地物化当前 intent
- `skillspm pack [out]`：把 confirmed environment 打成可携带的 `.skillspm.tgz`
- `skillspm freeze`：把 `skills.lock` 显式刷新为当前已接受结果
- `skillspm adopt [source]`：发现现有 skills 并合并进 `skills.yaml`
- `skillspm sync [target]`：把 confirmed environment 从本地 library cache 同步到一个或多个 targets
- `skillspm doctor`：检查 manifest、lockfile、cache、pack readiness、targets 和冲突
- `skillspm help [command]`：查看命令帮助

## 项目状态模型

- `skills.yaml` = 项目的 intent：期望的 root `skills`、可选的每个 root `source`，以及可选的 `targets`
- `skills.lock` = confirmed state：已接受的精确版本、digest 和 resolved-from provenance
- `~/.skillspm/*` = 机器本地 cache / 物化层，永远不是项目真相
- `.skillspm.tgz` = confirmed-state 恢复载体，不是 source of truth

## `skills.yaml`

`skills.yaml` 定义项目 intent。

它被刻意保持最小：只保存期望的 `skills`、可选的每个 root `source`，以及可选的 `targets`。

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

机器本地 library 不是项目真相；它是 `install`、`pack`、`adopt`、`sync` 使用的本地 cache / 物化层。

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

对于 `skills.lock` 里 `resolved_from.type=provider` 且 `resolved_from.ref` 是规范 `github:` locator 或匿名公共 `https://github.com/...` locator 的条目，即使在干净机器上也可以重新物化 public provider-backed source。

记录下来的 provider provenance 还能保留原始 provider id（如 `openclaw:...`、`clawhub:...`、`skills.sh:...`）以及背后的 public GitHub locator。带精确版本的规范 public `github:` skill 和这些 provider-backed public skill 仍然可以通过未认证的公共 tag 抓取恢复。

恢复出来的 provider skill root 必须完全不含 symlink。若内容摘要不匹配，会 fail closed，而不是静默接受漂移。

这个分支里的 provider 恢复能力仍然被刻意收窄：干净机器上的回退只覆盖 public GitHub-backed provider（`github`、`openclaw`、`clawhub`、`skills.sh`），而且只允许未认证访问。`skills.sh:` id 通过其公开的 GitHub repo/path 语义解析；`openclaw:` / `clawhub:` id 通过公开 provider 元数据解析出背后的 public GitHub locator。恢复路径会禁用 credential helper、askpass hook 和终端交互，因此任何私有/需要认证的 GitHub 访问都会诚实地 fail closed。私有仓库、需要认证的 provider 流程、非 public 可见性，以及 plain git 输入仍然必须依赖现有 cache 或 pack。

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
8. 否则，如果 skill id 本身就是受支持的 public provider id（`github:...`、`openclaw:...`、`clawhub:...`、`skills.sh:...`），就从项目语义推导精确 public version 和 backing locator，再通过未认证公共 tag 恢复
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

`skillspm sync` 会把当前 lock 中的 skills 写入配置好的 agent target。

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
