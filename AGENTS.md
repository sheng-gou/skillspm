# AGENTS.md

Guidance for coding agents working in this repo.

## Mission

`skills` is a **reproducible skills environment manager**, not just a folder copier.

Keep changes aligned with these product truths:

- project scope is the default
- global scope lives under `~/.skills/`
- recommended precedence is `project > global`
- unsupported features must stay truthful, especially git-source install
- path safety is default-deny unless `SKILLS_ALLOW_UNSAFE_PATHS=1`

## Working style

- Prefer minimal, production-minded changes
- Preserve non-interactive defaults for core commands
- Avoid widening scope into speculative P1/P2 work
- Keep docs and smoke tests in sync with user-visible behavior

## Agent setup

```bash
npm install
npm run build
npm test
```

Primary entry points:

- `src/cli.ts` — command surface
- `src/resolver.ts` — dependency resolution
- `src/installer.ts` — install + lock writing
- `src/adapter.ts` — sync targets
- `src/importer.ts` — discovery + vendoring
- `src/doctor.ts` — health checks / JSON report
- `scripts/smoke.sh` — end-to-end verification

## Implementation guardrails

- Do not loosen containment checks by default
- Do not claim git-source install works when it does not
- If adding scope-aware behavior, make the selected root explicit in code and docs
- If changing output, keep automation-friendly flows stable enough for smoke coverage

## Verification checklist

Before handing off:

1. `npm run build`
2. `npm test`
3. If you touched packaging/help paths, confirm the packed CLI still works via `scripts/smoke.sh`
