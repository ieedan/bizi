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
