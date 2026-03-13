# Contributing

Thanks for contributing to SkillsPM.

SkillsPM is a package-manager-style CLI for managing reusable Skills environments for AI agents.

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

Run tests:

```bash
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

## Pull request guidelines

When opening a PR, please include:

- what changed
- why it changed
- how it was tested
- whether `README.md`, [AGENTS.md](AGENTS.md), examples, or `README.zh-CN.md` were updated

Small PRs are preferred over large PRs.

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
