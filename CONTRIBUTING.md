# Contributing

Thanks for contributing to SkillsPM.

SkillsPM is a declarative Skills environment manager built around `skills.yaml` as project truth and `skills.lock` as the frozen resolved state.

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

- `skills.yaml` and `skills.lock` define the project environment contract
- machine-local cache lives under `~/.skillspm/` and is not project truth
- public command docs must stay aligned to the current Phase-2 command surface:
  - `add`
  - `install`
  - `pack`
  - `freeze`
  - `adopt`
  - `sync`
  - `doctor`
  - `help`
- README wording should stay aligned with actual CLI behavior
- agent-facing behavior should stay aligned with [AGENTS.md](AGENTS.md)

## Before opening a pull request

Please make sure your change:

- is focused on one problem or one improvement
- includes tests when command behavior changes
- keeps README examples accurate
- updates [AGENTS.md](AGENTS.md) and [HUMAN.md](HUMAN.md) if user-facing behavior changes
- does not introduce unrelated breaking changes

## Pull request guidelines

When opening a PR, please include:

- what changed
- why it changed
- how it was tested
- whether `README.md`, `README.zh-CN.md`, [AGENTS.md](AGENTS.md), or [HUMAN.md](HUMAN.md) were updated

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
- aligned with the current README contract for manifests, lockfiles, packs, cache, and targets

## Agent-facing instructions

This project is designed to be usable by both humans and agents.

If your change affects agent workflows, please also review:

- [README.md](README.md)
- [README.zh-CN.md](README.zh-CN.md)
- [AGENTS.md](AGENTS.md)
- [HUMAN.md](HUMAN.md)

## Code of conduct

Please be respectful, constructive, and specific in issues and pull requests.

## License

By contributing, you agree that your contributions will be licensed under the repository's license.
