<script lang="ts">
	import { Button } from "$lib/components/ui/button";

	// biome-ignore lint/performance/noNamespaceImport: <explanation>
	import * as Code from "$lib/components/ui/code";
	import { PMCommand } from "$lib/components/ui/pm-command";
	import { Snippet } from "$lib/components/ui/snippet";
</script>

<svelte:head>
	<title>bizi</title>
	<meta
		name="description"
		content="Manage dependent concurrent tasks with sanity."
	>
</svelte:head>

<main class="min-h-dvh flex items-center justify-center pt-[25svh] pb-6 font-mono">
	<div class="max-w-xl w-full">
		<div class="mb-8 gap-2 flex flex-col items-center">
			<h1 class="text-6xl text-center">bizi</h1>
			<p class="text-center text-lg text-muted-foreground">
				Manage dependent concurrent tasks with sanity.
			</p>
			<Button variant="outline" href="https://github.com/ieedan/bizi">
				View on GitHub
			</Button>
		</div>

		<h2 class="text-xl mb-2">1. Install the server</h2>
		<Snippet
			class="mb-6"
			text="curl -fsSL https://getbizi.dev/install | bash"
		/>

		<h2 class="text-xl mb-2">2. Install the client</h2>
		<PMCommand class="mb-6" command="install" args={["bizi", '-g']} />

		<h2 class="text-xl mb-2">3. Setup your task.config.json</h2>
		<Code.Root
			class="mb-6"
			lang="json"
			code={`{
  "$schema": "https://getbizi.dev/schemas/task.config.json",
  "tasks": {
    "dev": {
      "tasks": {
        "api": {
          "cwd": "./apps/api",
          "command": "dotnet run"
        },
        "site": {
          "cwd": "./apps/site",
          "command": "pnpm dev"
        }
      }
    }
  }
}`}
		>
			<Code.CopyButton />
		</Code.Root>

		<h2 class="text-xl mb-2">4. Use the client to run your tasks</h2>
		<Snippet class="mb-2" text="bizi # launch the tui" />
		<Snippet class="mb-2" text="bizi run <task> # run a task" />
		<Snippet class="mb-2" text="bizi cancel <task> # cancel a task" />
		<Snippet class="mb-2" text="bizi stat <task> # show task status" />
	</div>
</main>
