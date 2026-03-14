# Contributing

Thanks for contributing to SkillsPM.

SkillsPM is a declarative Skills environment manager built around `skills.yaml` as the source of truth and `skills.lock` as the frozen resolved state.

This project is still early. Clear bug reports, small focused pull requests, and practical feedback are especially valuable.

## What to contribute

Good contributions include:

- bug fixes
- README and docs improvements
- command behavior improvements
- tests for CLI workflows
- adapter improvements for supported agents
- better error messages and diagnostics

Please avoid large unrelated refactors in a single pull request.

## Local development

Clone the repo and install dependencies:

```bash
npm install
```

If you want a clean install that matches CI exactly:

```bash
npm ci
```

Run tests:

```bash
npm test
```

CI is intentionally lightweight and only runs:

```bash
npm ci
npm test
```

## Project principles

When contributing, please keep these principles in mind:

- `skills.yaml` is the source of truth for the desired environment
- `skills.lock` represents the frozen installed state
- core user workflow should stay easy to understand:
  - `install`
  - `freeze`
  - `sync`
  - `import`
  - `inspect`
- README wording should stay aligned with actual CLI behavior
- agent-facing behavior should stay aligned with [AGENTS.md](AGENTS.md)

## Before opening a pull request

Please make sure your change:

- is focused on one problem or one improvement
- includes tests when command behavior changes
- keeps README examples accurate
- updates [AGENTS.md](AGENTS.md) if agent-facing behavior changes
- does not introduce unrelated breaking changes

## Branch and pull request flow

Normal changes should not be pushed directly to `main`.

Use this default flow:

1. create a short-lived branch from `main`
2. make a focused change
3. run `npm test`
4. open a pull request to `main`
5. wait for CI to pass and review to finish
6. squash merge the PR

Small PRs are preferred over large PRs.

## Direct pushes to `main`

Direct pushes to `main` should be rare and limited to narrow maintainer-only exceptions such as:

- fixing broken CI or repository metadata that is blocking normal PR flow
- making an urgent docs-only correction that unblocks contributors
- applying a small release follow-up that must happen immediately after a release step

Feature work, bug fixes, refactors, and normal docs changes should still use a short-lived branch and pull request.

## Pull request guidelines

When opening a PR, please include:

- what changed
- why it changed
- how it was tested
- whether `README.md`, [AGENTS.md](AGENTS.md), examples, or `README.zh-CN.md` were updated
- confirmation that `npm test` passed locally or in CI

PRs must pass `npm test` before they are merged. Squash merge is preferred so `main` stays easy to read and release from.

## Release flow

Releases should be cut from a clean `main`, not from a long-lived release branch.

Use this default release flow:

1. open a release PR that bumps the version and any release notes or docs that need to ship with it
2. make sure CI passes and merge the release PR into `main`
3. confirm `main` is clean, then create the release tag on the intended release commit
4. publish the package to npm
5. create the matching GitHub Release

See [docs/release-checklist.md](docs/release-checklist.md) for the short step-by-step checklist.

## Reporting bugs

When reporting a bug, please include as much of the following as possible:

- operating system
- Node.js version
- command you ran
- expected behavior
- actual behavior
- relevant logs or error messages
- a minimal `skills.yaml` example, if relevant

## Feature requests

Feature requests are welcome, especially if they are tied to real workflows.

Helpful feature requests usually explain:

- the problem you are trying to solve
- why current commands are not enough
- what command or behavior you expected
- whether the workflow is for humans, agents, or both

## Documentation changes

Docs improvements are valuable.

Please keep documentation:

- concrete
- command-first
- consistent with the current implementation
- honest about current limitations

## Agent-facing instructions

This project is designed to be usable by both humans and agents.

If your change affects agent workflows, please also review:

- [README.md](README.md)
- [README.zh-CN.md](README.zh-CN.md)
- [AGENTS.md](AGENTS.md)

## Code of conduct

Please be respectful, constructive, and specific in issues and pull requests.

## License

By contributing, you agree that your contributions will be licensed under the repository's license.
