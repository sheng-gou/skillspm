# source-aware-live

Runnable example for a single workspace that mixes:

* one source-backed skill from a local index source
* one local path skill from the repo

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
