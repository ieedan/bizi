<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	const style = tv({
		base: "w-full rounded-lg border border-border",
		variants: {
			variant: {
				default: "bg-card",
				secondary: "border-transparent bg-secondary/50",
			},
		},
	});

	type Variant = VariantProps<typeof style>["variant"];

	export interface PMCommandProps {
		variant?: Variant;
		class?: string;
		agents?: Agent[];
		agent?: Agent;
		command: Command;
		args: string[];
	}
</script>

<script lang="ts">
	import { cn } from "$lib/utils.js";
	import type { Command, Agent } from "package-manager-detector";
	import { resolveCommand } from "package-manager-detector/commands";
	import CopyButton from "$lib/components/ui/copy-button/copy-button.svelte";
	import ClipboardIcon from "@lucide/svelte/icons/clipboard";
	import TerminalIcon from "@lucide/svelte/icons/terminal";
	import {
		Provider as TooltipProvider,
		Root as TooltipRoot,
		Trigger as TooltipTrigger,
		Content as TooltipContent,
	} from "$lib/components/ui/tooltip";
	import {
		Root as TabsRoot,
		List as TabsList,
		Trigger as TabsTrigger,
	} from "$lib/components/ui/tabs";

	let {
		variant = "default",
		class: className,
		command,
		agents = ["npm", "pnpm", "yarn", "bun"],
		args,
		agent = $bindable("npm"),
	}: PMCommandProps = $props();

	const cmd = $derived(resolveCommand(agent, command, args));

	const commandText = $derived(`${cmd?.command} ${cmd?.args.join(" ")}`);
</script>

<div class={cn(style({ variant }), className)}>
	<div
		class="border-border flex place-items-center justify-between gap-2 border-b py-1 pr-2"
	>
		<div class="flex place-items-center gap-2 px-2">
			<div
				class="bg-foreground flex size-4 place-items-center justify-center opacity-50"
			>
				<TerminalIcon class="text-background size-3" />
			</div>
			<TabsRoot bind:value={agent}>
				<TabsList class="h-auto bg-transparent p-0">
					{#each agents as pm (pm)}
						<TabsTrigger
							value={pm}
							class="h-7 font-mono text-sm font-light"
						>
							{pm}
						</TabsTrigger>
					{/each}
				</TabsList>
			</TabsRoot>
		</div>
		<TooltipProvider delayDuration={0}>
			<TooltipRoot>
				<TooltipTrigger>
					{#snippet child({ props })}
						<CopyButton
							{...props}
							text={commandText}
							class="size-6 [&_svg]:size-3"
						>
							{#snippet icon()}
								<ClipboardIcon />
							{/snippet}
						</CopyButton>
					{/snippet}
				</TooltipTrigger>
				<TooltipContent>Copy to Clipboard</TooltipContent>
			</TooltipRoot>
		</TooltipProvider>
	</div>
	<div class="no-scrollbar overflow-x-auto p-3">
		<span
			class="text-muted-foreground font-mono text-sm leading-none font-light text-nowrap"
		>
			{commandText}
		</span>
	</div>
</div>

<style>
	.no-scrollbar {
		-ms-overflow-style: none; /* IE and Edge */
		scrollbar-width: none; /* Firefox */
	}
</style>
