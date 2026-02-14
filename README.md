# task-runner

## TODO

- [ ] Deployment 🤢
- [ ] Figure out what the log retention / run retention policy should be
- [ ] Reevaluate situations where runIds actually make sense. Currently the singleton tasks seem to be a better pattern.

### Create a CLI for users / agents

This could just be bundled with the tui

The idea would be the tui would only activate if no subcommand/args were provided.

Otherwise the commands could be:

- `run <task>` - Runs a command `task-runner run dev` this will either run or hook into an existing task run we would keep track of which one so that we can handle things nicely for agents. For instance in non-interactive mode we would only kill the process on exit if it was started by that session. In interactive mode we can simply ask the user if they want to cancel the task that was/wasn't started in their session
- `cancel <task>` - Cancels an existing task by name
- `stat <task>` - Get information about a task to see if it's running or what