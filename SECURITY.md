# Security policy

## Supported versions

This plugin is developed on `main`, and fixes land in the next release. Please
reproduce a report against the latest release or `main` before filing it.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it through GitHub's private advisory form:
[Report a vulnerability](https://github.com/MacHatter1/bb-thread-reference/security/advisories/new).

Include the BB version, the plugin version, and the steps to reproduce. You can
expect an initial response within a few days.

## Scope

This plugin passes content from one BB thread to an agent in another thread, so
reports about the trust boundary are especially welcome. Examples in scope:

- A referenced thread's content escaping the `<bb_thread_reference>` block or
  otherwise being treated as instructions by the destination agent.
- A thread reference resolving to a thread the user cannot access.
- A reference mutating, leaking, or exposing the source thread beyond its
  title, id, project id, and bounded conversation outline.
- Unbounded context: a reference that bypasses the outline and length limits.

Bugs in BB itself belong to the BB project rather than here.
