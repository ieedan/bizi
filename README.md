# task-runner

## Install the server (one command)

Install and run the task-runner server as a background service (same command on macOS and Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/ieedan/task-runner/main/scripts/install | bash
```

- **macOS**: Installs the binary and a LaunchAgent; server runs on port 7436 and starts at login.
- **Windows**: Run the command above in **Git Bash** or **WSL**. Installs the binary and a scheduled task that runs at logon (port 7436).

Optional: install a specific version with `bash -s -- --version 0.1.0`, or from a local binary with `./scripts/install --binary /path/to/task-runner-server`.

Clients (e.g. the TUI) connect to `localhost:7436` by default and can be installed separately.

### Uninstall

Run the uninstall script (same command on macOS and Windows; on Windows use Git Bash or WSL):

```bash
curl -fsSL https://raw.githubusercontent.com/ieedan/task-runner/main/scripts/uninstall | bash
```

Or from a clone: `./scripts/uninstall`

---

## TODO

- [ ] Figure out what the log retention / run retention policy should be
- [ ] Reevaluate situations where runIds actually make sense. Currently the singleton tasks seem to be a better pattern.

### Create a CLI for users / agents

This could just be bundled with the tui

The idea would be the tui would only activate if no subcommand/args were provided.

Otherwise the commands could be:

- `run <task>` - Runs a command `task-runner run dev` this will either run or hook into an existing task run we would keep track of which one so that we can handle things nicely for agents. For instance in non-interactive mode we would only kill the process on exit if it was started by that session. In interactive mode we can simply ask the user if they want to cancel the task that was/wasn't started in their session
- `cancel <task>` - Cancels an existing task by name
- `stat <task>` - Get information about a task to see if it's running or what