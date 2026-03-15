# skills.yaml schema boundary v0.3.0 (draft)

Status: draft for `skillspm 0.3.0`

This document defines the persisted `skills.yaml` boundary for source-backed roots in v0.3.0.

## Goals

* keep persisted schema stable at `schema: skills/v1`
* distinguish plain git sources from provider-backed git sources without adding a new top-level source type
* keep pack metadata separate from manifest source declarations
* keep ordinary git resolution strict

## Persisted model

### Root manifest

```yaml
schema: skills/v1

sources:
  - name: community
    type: git
    url: https://github.com/example/public-skills.git

  - name: frontend-catalog
    type: git
    url: https://github.com/acme/provider-skills.git
    provider:
      kind: skills.sh

skills:
  - id: acme/code-review
    version: ^1.2.0
    source: community

  - id: acme/frontend-design
    source: frontend-catalog
    provider_ref: skills.sh:acme/provider-skills/frontend-design

  - id: local/release-check
    path: ./local-skills/release-check
```

## Field rules

### `sources[]`

Supported types remain:

* `type: index`
* `type: git`

No new top-level source type is introduced for providers.

#### Plain git source

```yaml
- name: community
  type: git
  url: https://github.com/example/public-skills.git
```

Rules:

* `url` must be a public anonymous HTTPS git URL
* no `file://`, `ssh://`, `git@host:repo`, embedded credentials, query strings, or fragments
* resolver behavior is strict only: `skills/<skill-id path>/<version>/...`
* plain git sources must not imply repo-wide loose scanning

#### Provider-backed git source

```yaml
- name: frontend-catalog
  type: git
  url: https://github.com/acme/provider-skills.git
  provider:
    kind: skills.sh
```

Rules:

* provider-backed sources still persist as `type: git`
* `provider.kind` is optional and only valid on `type: git`
* allowed values in v0.3.0:
  * `skills.sh`
  * `clawhub`
* provider-backed git resolution may use provider-specific lookup behavior
* source identity/dedupe must include `provider.kind`

### `skills[]`

Supported root forms remain:

#### Local root

```yaml
- id: local/release-check
  path: ./local-skills/release-check
```

#### Source-backed root

```yaml
- id: acme/code-review
  version: ^1.2.0
  source: community
```

#### Provider-backed source root

```yaml
- id: acme/frontend-design
  source: frontend-catalog
  provider_ref: skills.sh:acme/provider-skills/frontend-design
```

Rules:

* `provider_ref` is optional
* `provider_ref` is only valid when `source` points to a persisted `type: git` source with `provider.kind`
* `provider_ref` must not be combined with `path`
* `provider_ref` captures provider provenance for the root that was added via provider UX
* dependency entries are not required to carry `provider_ref`

## Accepted provider inputs in v0.3.0

Accepted add-time inputs:

* `skills.sh:owner/repo/skill`
* `clawhub:owner/repo/skill`
* `https://skills.sh/owner/repo/skill`

Persisted canonical form:

* `skills[].provider_ref` stores a canonical provider ref string
* `https://skills.sh/...` normalizes to `skills.sh:owner/repo/skill`

Out of scope in v0.3.0:

* provider search
* naked short refs
* private/authenticated provider flows
* external provider CLI wrapping

## Resolver boundary

### Plain git

Allowed behavior:

1. clone public HTTPS repo
2. resolve only via strict versioned layout

```text
skills/<skill-id path>/<version>/
```

Not allowed:

* repo-wide loose scan
* basename/provider-style fallback

### Provider-backed git

Allowed behavior:

1. clone the same public HTTPS repo form
2. try strict versioned layout first when available
3. if the source has `provider.kind`, allow provider-specific lookup fallback

Provider-specific fallback may match a unique skill directory by:

* `metadata.id`
* basename / provider leaf name
* persisted `provider_ref` context for the root that was added via provider UX

This fallback must not activate for plain git sources.

## Equality / dedupe rules

When deciding whether two persisted sources are the same, compare:

* `type`
* `url`
* `provider.kind` (including undefined vs present)

So these are distinct:

```yaml
- type: git
  url: https://github.com/acme/provider-skills.git
```

```yaml
- type: git
  url: https://github.com/acme/provider-skills.git
  provider:
    kind: skills.sh
```

## Pack boundary

`packs[]` stays separate.

Packs are materialization caches for exact resolved nodes, not logical source declarations. This schema draft does not redesign pack/source modeling.
