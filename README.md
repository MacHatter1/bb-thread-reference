# BB Thread Reference

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![BB plugin](https://img.shields.io/badge/BB-plugin-6f42c1)](https://getbb.app/)

BB Thread Reference adds a small drag handle to each BB sidebar thread. Drag
the handle directly into a chat input to add a thread reference.

![BB Thread Reference demo: drag a thread into the composer and use it in a chat](assets/thread-reference-demo.gif)

The demo shows the complete flow: drag a thread into the composer, send the
message with the native reference mention, and receive a response grounded in
that referenced thread.

The reference is a native BB composer mention. When the message is sent, the
plugin resolves the source thread and provides its title, id, and a bounded
conversation outline as agent-visible context. The composer only shows the
thread label, so the destination chat stays readable and the context remains
fresh. In sent messages, the reference mention is keyboard-accessible and
clickable, taking you back to the source thread.

## Requirements

- BB 0.43 or newer
- Node.js 22 or newer

## Install and develop

From this directory:

```sh
npm install
bb plugin install .
bb plugin dev
```

`bb plugin dev` rebuilds and reloads the plugin as files change. For a single
build, run `bb plugin build`; for an installed plugin, run:

```sh
bb plugin reload thread-reference
```

## Use it

- Drag the six-dot grip handle on a sidebar thread into any chat input.
- Or type `@` in the composer and pick a thread from **Threads**.
- Send the message as usual. The reference resolves at send time, so the agent
  reads the source thread as it is now, not as it was when you dragged it.
- Click a thread reference in a sent message to jump back to its source.

References are read-only and do not alter the source thread. Imported content
is wrapped as untrusted reference material, so text from the source thread is
not treated as an instruction to the destination agent.

## How it works

- `src/app.tsx` registers a trusted content script that adds a dedicated drag
  handle to sidebar rows with `data-sidebar-thread-id`, handles drops on
  composer editors, and turns persisted thread mentions into links back to
  their source threads. BB's native row drag is temporarily disabled while
  the plugin is active so the handle is the only source for this reference
  drag; normal row clicking remains unchanged.
- The same frontend registers an invisible per-composer bridge. A drop on the
  actual input inserts a `thread-reference` mention and focuses the composer;
  no drop banner is rendered.
- `src/server.ts` registers the **Threads** mention provider. Search uses BB's
  thread index; resolution reads the source thread at send time and returns a
  bounded, prompt-injection-aware context block.
- `skills/thread-reference/SKILL.md` documents the workflow for agents.

## Manifest and SDK

`package.json` is the BB plugin manifest. The plugin pins the SDK version used
by the running BB. If the host is upgraded, refresh the declarations with:

```sh
bb plugin types
bb plugin types --check
```

The authoritative frontend and backend declarations are in
`node_modules/@get-bb/plugin-sdk/bundled-types/` after installation.

## Tests

```sh
npm run typecheck
npm test
```

The Vitest suite in `tests/` covers the mention payload contract and mounts
the content scripts with the plugin SDK test harness, so the drag and drop
behaviour is exercised without a running BB.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the development loop and the two design constraints that shape the
codebase, and [SECURITY.md](SECURITY.md) for reporting anything
security-sensitive. Release notes live in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
