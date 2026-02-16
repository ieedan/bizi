# bizi TUI

Install dependencies:

```bash
bun install
```

Run the server and then start the TUI:

```bash
cargo run -p bizi
bun --cwd apps/tui dev -- --cwd /path/to/project
```

If `--cwd` is omitted, the app uses the current shell working directory.

## Hotkeys

- `up/down` or `j/k`: move selection
- `r`: run selected task
- `R`: restart selected run
- `c`: cancel selected run (and descendants)
- `l`: toggle log mode (`aggregate` vs `selected`)
- `q` or `Ctrl+C`: quit

## Release packaging

- `bun compile` is release-only and is run from CI in `.github/workflows/release.yml`.
- Local install/dev scripts do not compile binaries, and no lifecycle hooks trigger compile.
- Publish order in CI:
  1. compile binaries,
  2. publish platform packages (`@getbizi/bizi-*`),
  3. publish main CLI package (`bizi`).

## Local validation checks

Run from `apps/tui`:

```bash
bun run compile:all
```

Then verify binaries and launcher flow:

```bash
ls -la ./packages/bizi-darwin-arm64/bin
ls -la ./packages/bizi-darwin-x64/bin
ls -la ./packages/bizi-win32-x64/bin
ls -la ./packages/bizi-win32-arm64/bin
node ./bin/bizi.js --help
```

Notes:

- Windows arm64 currently uses a Windows x64 Bun executable fallback because Bun does not yet emit native Windows arm64 executables.
