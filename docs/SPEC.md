# task runner

The problem is that we have a bunch of processes spinning up and down all the time.

What I want is a way to:

1. Select which tasks to actually run (tasks can depend on each other so choosing one task might mean running another)
2. Run the tasks in parallel (by default) or in series (if a task depends on another task)
3. Have output logs of each task
4. Display the status of each task (running, exited, etc.)
5. Immediately cancel all tasks
6. Cancel / restart a single task
7. Headless no gui tied to implementation
8. Give agents and humans control to work concurrently (basically we would have one instance (per definition) that would allow agents/humans to connect to through commands or a gui probably a restapi server that it spins up)

## Implementation details

Each unique task can be given a nanoid which can be traded with the server for live updates on the tasks status
