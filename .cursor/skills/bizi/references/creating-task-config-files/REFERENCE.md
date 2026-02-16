# task.config.json

The task config file is a JSON file that defines the tasks that can be run in the repository.

The schema can be found here: https://getbizi.dev/schemas/task.config.json

## Task keys

Nested tasks are referred to by **task keys** in the form `parent:child`. For example, the subtask `packages` under the root task `dev` has the key `dev:packages`. Deeper nesting uses colons: `parent:child:grandchild`. Use these keys when running a single subtask (e.g. `bizi run dev:packages`) or in `dependsOn` arrays (e.g. `"dependsOn": ["dev:generate"]`).

## Replacing concurrently with bizi

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

## `dependsOn`

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

## `optional`

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

## Maintaining compatibility with other tools

bizi is an upgrade over concurrently that gives users more control over the tasks they run. However not all developers will already have access to bizi. For this reason when migrating to use bizi we should try and leave old package.json scripts intact so that users that are just using traditional package managers can still run the tasks they need to run.
