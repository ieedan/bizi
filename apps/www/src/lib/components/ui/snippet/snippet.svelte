<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";
	import type { UseClipboard } from "$lib/hooks/use-clipboard.svelte";

	const style = tv({
		base: "relative w-full max-w-full rounded-md border bg-background py-2.5 pr-12 pl-3",
		variants: {
			variant: {
				default: "border-border bg-card",
				secondary: "border-border bg-accent",
				destructive: "border-destructive bg-destructive",
				primary: "border-primary bg-primary text-primary-foreground",
			},
		},
	});

	type Variant = VariantProps<typeof style>["variant"];

	export interface SnippetProps {
		variant?: Variant;
		text: string | string[];
		class?: string;
		onCopy?: (status: UseClipboard["status"]) => void;
	}
</script>

<script lang="ts">
	import { cn } from "$lib/utils.js";

	let {
		text,
		variant = "default",
		onCopy,
		class: className,
	}: SnippetProps = $props();
</script>

<div class={cn(style({ variant, className: className }))}>
	{#if typeof text == 'string'}
		<pre
			class={cn('overflow-y-auto text-left font-mono text-sm font-light whitespace-nowrap')}
		>
			{text}
		</pre>
	{:else}
		{#each text as line, i (i)}
			<pre
				class={cn('overflow-y-auto text-left font-mono text-sm font-light whitespace-nowrap')}
			>
			{line}
		</pre>
		{/each}
	{/if}

	<CopyButton
		class="hover:text-opacity-80 absolute top-1/2 right-2 size-7 -translate-y-1/2 transition-opacity ease-in-out hover:bg-transparent dark:hover:bg-transparent"
		text={typeof text === 'string' ? text : text.join('\n')}
		{onCopy}
	/>
</div>
