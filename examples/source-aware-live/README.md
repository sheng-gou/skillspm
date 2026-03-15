# source-aware-live

Runnable example for an advanced compatibility workspace that mixes:

* one source-backed skill from an explicit local index source
* one local path skill from the repo

Primary Phase 1 authoring now includes `add --from <local-skill-dir>`, `add skills.sh:owner/repo/skill` (or `clawhub:` / `https://skills.sh/...`), and `add <id@range> --from https://...`. Provider-backed roots persist on the same git boundary as `type: git` plus `sources[].provider.kind` and `skills[].provider_ref`. This example exists to keep explicit local index compatibility runnable inside the repo.

## Run

From the repository root:

```bash
npm run build
cd examples/source-aware-live
node ../../dist/bin/skillspm.js install
node ../../dist/bin/skillspm.js list --resolved
node ../../dist/bin/skillspm.js doctor --json
```

## Expected outcome

`install` resolves and installs three skills:

* `demo/live-app@1.0.0` from the declared index source
* `demo/helper@1.0.0` as a dependency from the same source
* `demo/local-note@0.1.0` from `./local-skills/local-note`

You should see installed directories under `.skills/installed/`, and `skills.lock` should record `source.type: index` for the source-backed skills and `source.type: path` for the local skill.

Equivalent authoring flow with the higher-level add UX:

```bash
node ../../dist/bin/skillspm.js add demo/live-app@^1.0.0 --from ./skills-index.yaml
node ../../dist/bin/skillspm.js add --from ./local-skills/local-note
```

Because the source side is an explicit local index file, this is compatibility-oriented example coverage rather than the primary Phase 1 onboarding flow.
