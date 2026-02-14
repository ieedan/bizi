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

## CLI

The CLI is bundled with the TUI binary:

- `task-runner` launches the interactive TUI.
- `task-runner <task>` is an implicit run command (same behavior as `task-runner run <task>`).
- `task-runner run <task>` starts or attaches to a task run and streams logs.
- `task-runner cancel <task>` cancels an active run for the task.
- `task-runner stat <task>` prints task run status.
- `task-runner stat <task> --json` prints machine-readable status output.

Reserved command names take precedence over implicit task names (`run`, `cancel`, `stat`). To run a task with one of those names, use the explicit form: `task-runner run <task-name>`.

Run-mode behavior:

- Default is interactive in TTY environments.
- Use `task-runner run <task> --non-interactive` to force non-interactive mode.
- Interactive mode prompts before exiting so you can choose whether to cancel the run.
- Non-interactive mode only auto-cancels on signal if the run was started by the current CLI session.

User-facing CLI prompts are powered by `clack`.