https://github.com/user-attachments/assets/5478763d-57c5-4201-8ee7-a4e6239a8bcf

# bizi-rs

The bizi terminal UI, written in Rust with [ratatui](https://ratatui.rs).

`bizi-rs` is a drop-in replacement for the `bizi` package: same commands, same
keybindings, same layout, same binary name. It ships a single native executable
per platform with no runtime to boot, so it starts faster and holds a much
smaller memory footprint while tailing busy logs.

## Install

```bash
pnpm install -g bizi-rs
```

Supported platforms: macOS arm64/x64 and Windows arm64/x64. Unlike the Bun build,
the Windows arm64 package contains a native arm64 binary rather than an x64 one
running under emulation.

## Usage

Start the TUI from your project directory (where your `task.config.json` is):

```bash
bizi
```

Or specify a working directory:

```bash
bizi -C /path/to/project
```

CLI commands (perfect for your agents):

```bash
bizi run <task>     # Run a task and stream its logs
bizi cancel <task>  # Cancel a running task and its subtasks
bizi stat <task>    # Show task status (add --json for machine output)
bizi init           # Create a starter task.config.json
```

`bizi <task>` is shorthand for `bizi run <task>`.

## Keybindings

| Key                       | Action                                      |
| ------------------------- | ------------------------------------------- |
| `↑`/`k`, `↓`/`j`          | Move between tasks (or scroll the log view) |
| `←`/`h`, `→`/`l`          | Move between the task and log panes         |
| `opt`/`ctrl` + `↑`/`↓`    | Jump between top-level tasks                |
| `/`                       | Focus the task search box                   |
| `enter`                   | Run or restart the exact task typed         |
| `r`                       | Run or restart the selected task            |
| `c`                       | Cancel the selected run                     |
| `m`                       | Toggle aggregated vs. own logs              |
| `ctrl+c`                  | Copy the log selection, or quit             |
| `q`                       | Quit                                        |

Drag with the mouse over the log pane to select text, then press `ctrl+c` to copy
it. Copying goes through the platform clipboard (`pbcopy`, `clip`, `wl-copy`/
`xclip`/`xsel`) and falls back to OSC52, which is what gets used over SSH.

## Development

The TUI itself lives in [`crates/bizi-tui`](../../crates/bizi-tui); this package
only wraps the compiled binaries for npm.

```bash
cargo run -p bizi-tui          # run against a local bizi server
cargo test -p bizi-tui         # unit tests
node scripts/build.mjs all     # cross compile every published target
```
