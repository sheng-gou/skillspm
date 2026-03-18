# skillspm

`skillspm` 用最小化项目清单、精确 lockfile 和机器本地物化缓存来管理声明式 Skills 环境。

## 0.3.0 模型

项目真相文件只有：

- `skills.yaml`
- `skills.lock`

机器本地状态位于：

- `~/.skillspm/library.yaml`
- `~/.skillspm/skills/`

`skills.yaml` 被刻意收缩为最小公开契约：只保留期望的 `skills`、可选的每个 root `source`，以及可选的 `targets`。

`skills.lock` 为每个 skill 记录精确锁定的结果身份：精确版本、内容摘要，以及解析来源。

机器本地 library 不是项目真相，而是 `install`、`pack`、`adopt`、`sync` 使用的本地缓存/物化层。

`skillspm install` 会先读取 `skills.yaml`，在存在时参考 `skills.lock`，检查机器本地 library 中是否存在精确内容匹配；只有在 cache miss 时才回退到 pack 内容或 manifest/library 里记录的 source。对于 `skills.lock` 里 `resolved_from.type=provider` 且 `resolved_from.ref` 是规范 `github:` locator 或匿名公共 `https://github.com/...` locator 的条目，即使在干净机器上也可以重新物化 public provider-backed source；记录下来的 provider provenance 还能保留原始 provider id（如 `openclaw:...`、`clawhub:...`、`skills.sh:...`）以及背后的公共 GitHub locator。带精确版本的规范公共 `github:` skill 和这些 provider-backed public skill 仍然可以通过未认证的公共 tag 抓取恢复。恢复出来的 provider skill root 必须完全不含 symlink。若内容摘要不匹配，会 fail closed，而不是静默接受漂移。

这个分支里的 provider 恢复能力仍然被刻意收窄：干净机器上的回退只覆盖 public GitHub-backed provider（`github`、`openclaw`、`clawhub`、`skills.sh`），而且只允许未认证访问。`skills.sh:` id 通过其公开的 GitHub repo/path 语义解析；`openclaw:` / `clawhub:` id 通过公开 provider 元数据解析出背后的 public GitHub locator。恢复路径会禁用 credential helper、askpass hook 和终端交互，因此任何私有/需要认证的 GitHub 访问都会诚实地 fail closed。私有仓库、需要认证的 provider 流程、非 public 可见性，以及 plain git 输入仍然必须依赖现有 cache 或 pack。

当机器本地 provider 记录可用时，`~/.skillspm/library.yaml` 可以保存 provider-preserving 的来源信息，例如：

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

已记录的公共 GitHub provider provenance 也可以把匿名公共 GitHub URL 写进 `source.value`（对 `github`）或 `source.provider.ref`（对保留 provider 身份的记录），例如 `https://github.com/owner/repo/tree/main/skills/demo`。不支持 URL 内嵌凭据。

`skillspm pack` 是面向私有、本地、离线和跨机器恢复场景的补充机制，不会改变 source model，也不会取代 `skills.yaml` / `skills.lock` 作为项目真相。

## Manifest

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

## Lockfile

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

## `adopt` 与 `sync`

`adopt` 和 `sync` 都采用直接的 target-object 心智模型。

示例：

```bash
skillspm adopt openclaw
skillspm adopt openclaw,codex
skillspm sync claude_code
skillspm sync openclaw,codex
```

`adopt` 也可以直接接收一个本地目录路径，而不是 target 名称。对于本地路径和已知 target，`adopt` 会把 source 路径同时记录到项目 `skills.yaml` 和机器本地 library 中；只要该 source 路径仍然存在，后续 install 即使在干净 library 上也能从 cache miss 恢复。

## `install` 输入优先级

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

## Pack 结构

`.skillspm.tgz` pack 包含：

- `skills.yaml`
- `skills.lock`
- 内部使用的 `manifest.yaml`
- 保存精确缓存 skill 内容的 `skills/`

`manifest.yaml` 只是 pack 内部元数据，不是用户可编辑的环境真相。

Pack 的定位是传输、私有/本地/离线分发以及恢复；它补充正常安装流程，而不是引入新的持久 source 类型。

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
