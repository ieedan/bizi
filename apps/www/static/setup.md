# How to setup and use bizi

This is intended to be a guide for both agents and humans to get started with bizi. You should be able to simply give this to your agent and they should be able to setup bizi for you.

## What is bizi?

bizi is a tool to help you manage multiple tasks in parallel. You define your tasks in a `task.config.json` file and the bizi server will manage them for you. You can then install a bizi client to help you run and manage your tasks.

## How to setup bizi

### Install the server

#### Checking if the server is already installed

Before installing you may want to check if you already have the server installed. You can do this by running:

```sh
curl http://localhost:7436/openapi.json -i
```

You should get a 200 response if the server is installed correctly.

If you don't have the server installed you can install it by running:

```sh
curl -fsSL https://getbizi.dev/install | bash
```

The server comes precompiled for the following architectures:
- Windows: x64 and arm64
- macOS: x64 and arm64

Once the server is installed it should automatically start as a background service.

#### Uninstalling the server

If you ever need to do a clean install of the server you can uninstall it by running:

```sh
curl -fsSL https://getbizi.dev/uninstall | bash
```

This will uninstall the server and remove all of its data.

### Install a client

If you don't already have a client installed you will need to install one to interact with the server.

Currently the only client is the TUI. You can install it by running:

```sh
npm|pnpm|bun install -g bizi
```

> The client should ALWAYS be installed globally since the server is a single instance any breaking changes on the server will require clients to be updated and this makes it easier to keep things in sync.

### Setup your task.config.json

The task config file is a JSON file that defines the tasks that can be run in the repository. This should include any of those tasks you often want to run manually, format, lint, dev, build etc.

The schema can be found here: https://getbizi.dev/schemas/task.config.json

#### Task keys

Nested tasks are referred to by **task keys** in the form `parent:child`. For example, the subtask `packages` under the root task `dev` has the key `dev:packages`. Deeper nesting uses colons: `parent:child:grandchild`. Use these keys when running a single subtask (e.g. `bizi run dev:packages`) or in `dependsOn` arrays (e.g. `"dependsOn": ["dev:generate"]`).

#### Replacing concurrently with bizi

Concurrently is often used to run multiple tasks in parallel. You might find a task like this in a `package.json` file:

```json
{
	"scripts": {
		"dev": "concurrently -n api,www -c blue,green \"pnpm dev:api\" \"pnpm dev:www\""
	}
}
```

Translating this to a task config file would look like this:

```jsonc
{
	"$schema": "https://getbizi.dev/schemas/task.config.json",
	"tasks": {
		"dev": {
			"tasks": {
				"api": {
					"color": "blue", // you can also provide either hex or (simple) named colors
					"command": "pnpm dev:api",
				},
				"www": {
					"color": "green",
					"command": "pnpm dev:www",
				},
			},
		},
	},
}
```

#### `dependsOn`

You can use the `dependsOn` key of a task to specify tasks which must complete before a given task.

`dependsOn` only applies when tasks are ran as subtasks of another task.

For example:

```jsonc
{
	"$schema": "https://getbizi.dev/schemas/task.config.json",
	"tasks": {
		"dev": {
			"tasks": {
				"generate": {
					"command": "pnpm generate",
				},
				"www": {
					"command": "pnpm dev:www",
					"dependsOn": ["dev:generate"],
				},
			},
		},
	},
}
```

Here if we ran `bizi run dev` www will only start once generate has finished. However if we ran `bizi run dev:www` www would start immediately without waiting for generate to finish.

#### `optional`

You can set `"optional": true` on a task so that it only runs when started manually. When the parent task is run (e.g. `bizi run dev`), optional subtasks are skipped; they run only when the user explicitly runs them (e.g. `bizi run dev:optional-task`). Use this for heavy or rarely-used subtasks that should not start by default.

```jsonc
{
	"tasks": {
		"dev": {
			"tasks": {
				"api": { "command": "pnpm dev:api" },
				"e2e": {
					"command": "pnpm playwright test",
					"optional": true
				}
			}
		}
	}
}
```

#### Maintaining compatibility with other tools

bizi is an upgrade over concurrently that gives users more control over the tasks they run. However not all developers will already have access to bizi. For this reason when migrating to use bizi we should try and leave old package.json scripts intact so that users that are just using traditional package managers can still run the tasks they need to run.

### Use the client to run your tasks

Start the TUI from your project directory (where your `task.config.json` is):

```bash
bizi
```

This will launch the TUI client. You can then use the client to run your tasks from an interactive terminal ui.

The `bizi` client can also run tasks non-interactively from the command line:

```sh
bizi run <task>
```

If a task is already running it will simply retrieve the logs from the running task. This is really nice for times where an agent wants to see logs from your running dev server.
