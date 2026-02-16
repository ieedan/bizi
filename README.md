# bizi

## Install the server (one command)

Install and run the bizi server as a background service (same command on macOS and Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/ieedan/bizi/main/scripts/install | bash
```

- **macOS**: Installs the binary and a LaunchAgent; server runs on port 7436 and starts at login.
- **Windows**: Run the command above in **Git Bash** or **WSL**. Installs the binary and a scheduled task that runs at logon (port 7436).

Optional: install a specific version with `bash -s -- --version 0.1.0`, or from a local binary with `./scripts/install --binary /path/to/bizi-server`.

Clients (e.g. the TUI) connect to `localhost:7436` by default and can be installed separately.

### Uninstall

Run the uninstall script (same command on macOS and Windows; on Windows use Git Bash or WSL):

```bash
curl -fsSL https://raw.githubusercontent.com/ieedan/bizi/main/scripts/uninstall | bash
```

Or from a clone: `./scripts/uninstall`

---

## Releasing with commits

Releases are automated with release-please from commits merged into `main`.

### 1) Use Conventional Commits

Examples:

- `feat(server): add task retry policy`
- `fix(client): handle 429 responses`
- `feat(tui): add command palette`

Version bump behavior:

- `fix` -> patch
- `feat` -> minor
- `!` or `BREAKING CHANGE:` -> major

### 2) Merge to `main`

When relevant commits land on `main`, release-please updates or opens a release PR.  
Merging that release PR creates component tags and GitHub releases.

### 3) What gets released

- **Server** (`server` component)
  - Tag: `server-vX.Y.Z`
  - GitHub release is created, then server binaries are attached by the server asset workflow.
- **Client JS** (`client` component)
  - Released independently when `packages/client-js` changes.
  - Published to npm with `npm publish --provenance`.
- **TUI packages** (`tui` and platform packages)
  - Linked versions: if any TUI package changes, all TUI packages release together.
  - All TUI npm packages publish together with `--provenance`.

### Notes

- Non-server releases create GitHub releases without binary assets.
- npm publishing uses trusted publishing (OIDC) and latest npm CLI.

---

## TODO

- [ ] Figure out what the log retention / run retention policy should be
- [ ] Reevaluate situations where runIds actually make sense. Currently the singleton tasks seem to be a better pattern.

## CLI

The CLI is bundled with the TUI binary:

- `bizi` launches the interactive TUI.
- `bizi <task>` is an implicit run command (same behavior as `bizi run <task>`).
- `bizi run <task>` starts or attaches to a task run and streams logs.
- `bizi cancel <task>` cancels an active run for the task.
- `bizi stat <task>` prints task run status.
- `bizi stat <task> --json` prints machine-readable status output.

Reserved command names take precedence over implicit task names (`run`, `cancel`, `stat`). To run a task with one of those names, use the explicit form: `bizi run <task-name>`.

Run-mode behavior:

- Default is interactive in TTY environments.
- Use `bizi run <task> --non-interactive` to force non-interactive mode.
- Interactive mode prompts before exiting so you can choose whether to cancel the run.
- Non-interactive mode only auto-cancels on signal if the run was started by the current CLI session.

User-facing CLI prompts are powered by `clack`.
