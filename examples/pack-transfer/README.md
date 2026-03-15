# pack-transfer

Runnable example for directory-pack transfer between two workspaces in this repo.

`pack` is a materialization cache for exact resolved nodes. It is not a logical source replacement and it is not a `sources[].type`.

For a real Phase 1 live source flow, prefer an anonymous public HTTPS repo. This example uses an explicit local index so the pack workflow stays reproducible inside the repo.

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

In `source-workspace`, `install` resolves from the declared local index source and `pack --out ./packs/team-baseline` writes a directory pack.

The source workspace manifest can also be authored with:

```bash
node ../../../dist/bin/skillspm.js add demo/pack-app@1.0.0 --from ./skills-index.yaml
```

That `--from ./skills-index.yaml` form is explicit local-index compatibility, not the primary Phase 1 source UX.

In `restore-workspace`, `skills.yaml` uses top-level `packs[]` plus exact versions. `install` restores `demo/pack-app@1.0.0` and its dependency `demo/pack-helper@1.0.0` from the directory pack.

After restore, `skills.lock` should show:

* `materialization.type: pack`
* `materialization.pack: baseline`
* the original logical source metadata under `source` from the source workspace pack entries
* and, for provider-backed git entries, the same persisted `source.provider.kind` provenance carried through the lock/pack metadata
