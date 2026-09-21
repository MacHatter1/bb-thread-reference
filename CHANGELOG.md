# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MIT license, contribution guide, security policy, and issue and pull request
  templates.
- GitHub Actions CI running the typecheck and test suite on Node 22 and 24.

## [0.1.0] - 2026-09-18

### Added

- Drag handle on BB sidebar thread rows that drops a thread reference straight
  into a chat composer.
- **Threads** mention provider, so a thread can also be referenced by typing
  `@` in the composer.
- Send-time resolution that supplies the referenced thread's title, id, and a
  bounded conversation outline as untrusted agent-visible context.
- Clickable, keyboard-accessible thread references in sent messages that open
  the source thread.
- `thread-reference` skill documenting the workflow for agents.

[Unreleased]: https://github.com/MacHatter1/bb-thread-reference/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MacHatter1/bb-thread-reference/releases/tag/v0.1.0
