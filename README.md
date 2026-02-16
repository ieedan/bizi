# bizi

bizi is a better way to manage dependent concurrent tasks.

> [!WARNING]
> This is still in early development breaking changes are likely. 

## Why?

If you have ever worked in a monorepo with multiple different tasks that depend on each other (for instance running your API in dev and running your web app in dev). Initially you might reach for something like concurrently to run this tasks in parallel. This works great until the moment where you need to restart one of the tasks, at which point you have no choice but to restart both tasks.

This is where bizi comes in. bizi allows you to define concurrent dependent tasks so and run them separately so that you can cancel, and restart them without effecting the other tasks.

The benefits go beyond just that though... Have you ever had that problem working with llms where they want to run their own dev server? bizi solves this by allowing llms to hook into the logs of your existing dev server run instead of spinning up their own.

## Getting Started

### Install the server

This will install the server and start it as a background service.

```bash
curl -fsSL https://getbizi.dev/install | bash
```

### Install a client

Currently the only client is the TUI.

```bash
pnpm install -g bizi
```

### Use the client

Start the TUI from your project directory (where your `task.config.json` is):

```bash
bizi
```

Or specify a working directory:

```bash
bizi -cwd /path/to/project
```

You can also use CLI commands instead of the TUI (Perfect for your agents):

```bash
bizi run <task>     # Run a task
bizi cancel <task> # Cancel a running task
bizi stat <task>   # Show task status
```
