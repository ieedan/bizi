import { Tooltip as TooltipPrimitive } from "bits-ui";

// biome-ignore lint/performance/noBarrelFile: component library public API
export {
	default as Content,
	default as TooltipContent,
} from "$lib/components/ui/tooltip/tooltip-content.svelte";
export {
	default as Trigger,
	default as TooltipTrigger,
} from "$lib/components/ui/tooltip/tooltip-trigger.svelte";

const Root = TooltipPrimitive.Root;
const Provider = TooltipPrimitive.Provider;
const Portal = TooltipPrimitive.Portal;

export {
	Root,
	Provider,
	Portal,
	Root as Tooltip,
	Provider as TooltipProvider,
	Portal as TooltipPortal,
};
