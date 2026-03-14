# Release checklist

Keep releases simple and cut them from a clean `main`.

## Checklist

1. Start from up-to-date `main`.
2. Create a short-lived release branch.
3. Bump the version in `package.json` and `package-lock.json`.
4. Run `npm test`.
5. Open a release PR and merge it into `main` after CI passes.
6. Confirm local `main` matches the merged release commit and the working tree is clean.
7. Create the release tag for that commit, for example `v0.2.2`.
8. Publish to npm.
9. Create the matching GitHub Release with the same version tag.

## Notes

- Keep release PRs focused on the version bump and release-ready docs.
- If the release PR exposes a problem, fix it with a normal PR before tagging.
- Avoid direct pushes to `main` except for the narrow exceptions documented in [CONTRIBUTING.md](../CONTRIBUTING.md).
