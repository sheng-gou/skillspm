# pack-transfer

Runnable example for directory-pack transfer between two workspaces in this repo.

`pack` is a materialization cache for exact resolved nodes. It is not a logical source replacement and it is not a `sources[].type`.

## Run

From the repository root:

```bash
npm run build
cd examples/pack-transfer/source-workspace
node ../../../dist/bin/skillspm.js install
node ../../../dist/bin/skillspm.js pack --out ./packs/team-baseline

cd ../restore-workspace
mkdir -p ./packs
cp -R ../source-workspace/packs/team-baseline ./packs/team-baseline
node ../../../dist/bin/skillspm.js install
node ../../../dist/bin/skillspm.js list --resolved
```

## Expected outcome

In `source-workspace`, `install` resolves from the declared index source and `pack --out ./packs/team-baseline` writes a directory pack.

In `restore-workspace`, `skills.yaml` uses top-level `packs[]` plus exact versions. `install` restores `demo/pack-app@1.0.0` and its dependency `demo/pack-helper@1.0.0` from the directory pack.

After restore, `skills.lock` should show:

* `materialization.type: pack`
* `materialization.pack: baseline`
* the original logical source metadata under `source` from the source workspace pack entries
