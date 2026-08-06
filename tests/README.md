# bizi client conformance suite

The two bizi clients — the TypeScript TUI in `apps/tui` and the Rust TUI in
`crates/bizi-tui` — are meant to behave identically. This directory is how that
claim gets checked.

Behavior is written down once, in `spec/`, as language-neutral JSON. Two
harnesses read those files:

| Layer | Spec | TypeScript harness | Rust harness |
| --- | --- | --- | --- |
| Pure logic | `spec/task-structure.json`, `spec/task-runs.json`, `spec/cli-task-runs.json`, `spec/status.json`, `spec/logs.json`, `spec/keyboard.json`, `spec/cli-args.json` | `apps/tui/tests/*.test.ts` | `crates/bizi-tui/src/conformance.rs` |
| Derived view state | `spec/view-state.json` | `apps/tui/tests/view-state.test.ts` | `crates/bizi-tui/src/tui/key_conformance.rs` |
| TUI log streaming | `spec/log-subscriptions.json` | `apps/tui/tests/log-subscriptions.test.ts` | `crates/bizi-tui/src/tui/key_conformance.rs` |
| TUI keyboard behavior | `spec/tui-keys.json` | `apps/tui/tests/tui-keys.test.ts` | `crates/bizi-tui/src/tui/key_conformance.rs` |
| Commands, end to end | `spec/e2e-cli.json` | `tests/e2e/cli.test.ts` (spawns either client) | same file, `BIZI_CLIENT=rust` |

A case that passes on one side and fails on the other is a divergence.

## Running it

```bash
bun run test
```

That runs the TypeScript unit layer, `cargo test`, and the end-to-end suite
against both clients. The individual pieces:

```bash
cd apps/tui && TZ=UTC bun test tests/
```

```bash
TZ=UTC cargo test -p bizi-tui
```

```bash
TZ=UTC bun test tests/e2e/
```

```bash
cargo build -p bizi-tui && TZ=UTC BIZI_CLIENT=rust bun test tests/e2e/
```

`TZ=UTC` matters: the timestamp cases in `spec/logs.json` are written against
UTC, and both clients format log timestamps in local time.

## How the end-to-end layer works

`tests/e2e/mock-server.ts` is a stand-in for bizi-server. It speaks the same
HTTP and WebSocket contract, but its runs, logs and failures are scripted by the
scenario, so a client can be pushed through paths a real server would not
reproduce on demand — a start that is refused, a cancel that fails for one run
only, a parent that goes terminal while a child is still live.

Both clients read `BIZI_PORT` and `BIZI_HOST`, which is how the suite points
them at the mock instead of the machine's real server on port 7436. Without
those the tests would fight whatever bizi-server is already running.

`BIZI_CLIENT` picks the client under test: `ts` (default) runs
`apps/tui/src/index.tsx` through bun, `rust` runs `target/debug/bizi`, so
`cargo build -p bizi-tui` has to have run first.

## Writing a case

Add it to the JSON. Both harnesses pick it up with no code change, as long as
the section already exists. `fixtures.json` holds the shared task maps and run
trees; reference them by name rather than inlining a new one, so a case reads as
"this input, this expectation".

The keyboard cases in `spec/tui-keys.json` are the densest format:

```jsonc
{
  "name": "r restarts a live task and clears the log buffer",
  "runs": "devRunning",          // fixture name; "none" by default
  "tasks": "monorepo",           // fixture name; "monorepo" by default
  "initial": { "selectedIndex": 0 },
  "keys": [{ "name": "r" }],
  "expect": {
    "effects": [{ "type": "restartRun", "runId": "run-dev" }],
    "logCount": 0
  }
}
```

Only the fields named in `expect` are checked. `effects` is the complete,
ordered list of server calls the keys asked for — quitting is asserted through
`shouldQuit` instead, and copying through the absence of a quit.

## Known divergences

None in behavior. Where the two clients differ it is in how they reach the same
result, and the shared spec pins the result:

- **Tabs in log lines.** Both parsers keep `\t`. The Rust client expands tabs to
  8-column stops in its render layer only, because ratatui draws into a cell
  grid and a raw tab desynchronises the renderer from the screen. The parser
  output is identical, which is what `spec/logs.json` checks.
- **Log scrolling.** The TypeScript client delegates scrolling to opentui's
  scrollbox; the Rust client implements it. Both move a fifth of the viewport
  per arrow key, half per page key, and jump to the ends on Home/End. The
  mouse wheel is the one place they still differ: opentui accelerates a fast
  wheel, the Rust client scrolls a flat three rows.
- **`RunningTaskRow.depth`.** Carried by the TypeScript row and rendered by
  neither client, so the Rust harness compares those rows on key and status.
- **`--version`.** The Rust client has the flag; the TypeScript one does not.
  A feature gap rather than a drift, so the spec does not cover it.

## Quirks the spec pins on purpose

These look like bugs but both clients do them, so the spec locks them in rather
than letting one side drift:

- `q` quits even while the search box is focused, so a task name containing `q`
  cannot be typed into it.
- `j` and the Down arrow leave the search box rather than typing a `j`.
- Pressing `k` on the top task row opens the search box *and* types `k` into it,
  while `Up` opens it empty.
- The selected run's log stream is keyed on `id:updatedAt:status:includeChildren`,
  so any change the server reports on that run closes both sockets and reopens
  them. While a task is running and the client is polling, that is a reconnect
  per revision — deliberate, because the reopened stream's snapshot comes from
  server storage rather than from lines the client has accumulated.
