# Contributing

Thanks for taking an interest in BB Thread Reference. Issues, ideas, and pull
requests are all welcome.

## Getting set up

You need [BB](https://get-bb.com) 0.43 or newer and Node.js 22 or newer.

```sh
npm install
bb plugin install .
bb plugin dev
```

`bb plugin dev` rebuilds and reloads the plugin as files change, so you can
try a change in a real BB window while you work on it.

## Before you open a pull request

```sh
npm run typecheck
npm test
bb plugin build
```

All three must pass. `npm test` runs the Vitest suite in `tests/`; the app
tests mount the content scripts with the plugin SDK test harness, so UI
behaviour can be covered without a running BB.

Please also:

- Keep changes focused. One behaviour per pull request is easiest to review.
- Add or update a test when you change behaviour in `src/`.
- Match the existing style: TypeScript strict mode, no new runtime
  dependencies, and prose wrapped at roughly 76 columns in Markdown.
- Update `README.md`, `PLUGIN_OVERVIEW.md`, and
  `skills/thread-reference/SKILL.md` when a change alters what users or agents
  see.
- Add a line to the `Unreleased` section of `CHANGELOG.md`.

## Design constraints

Two rules shape most of this codebase and are worth knowing before you change
`src/server.ts`:

- **The source thread is read-only.** A reference never moves, forks,
  archives, or writes to the thread it points at.
- **Referenced content is untrusted.** Resolution wraps the imported outline
  in a `<bb_thread_reference>` block that tells the destination agent to treat
  it as reference material rather than instructions. Keep that framing, and
  keep the size bounds in `MAX_CONTEXT_LENGTH` and `MAX_OUTLINE_ITEMS`.

## Reporting bugs

Open an issue with your BB version, your OS, and the steps that reproduce the
problem. For anything security-sensitive, see [SECURITY.md](SECURITY.md)
instead.
