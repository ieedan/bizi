import { tv, type VariantProps } from "tailwind-variants";
import Root from "$lib/components/ui/code/code.svelte";
import Overflow from "$lib/components/ui/code/code-overflow.svelte";
import CopyButton from "$lib/components/ui/code/code-copy-button.svelte";
import type {
	CodeCopyButtonProps,
	CodeRootProps,
} from "$lib/components/ui/code/types";

export const codeVariants = tv({
	base: "not-prose relative h-full overflow-auto rounded-lg border",
	variants: {
		variant: {
			default: "border-border bg-card",
			secondary: "border-transparent bg-secondary/50",
		},
	},
});

export type CodeVariant = VariantProps<typeof codeVariants>["variant"];

export {
	Root,
	CopyButton,
	Overflow,
	type CodeRootProps as RootProps,
	type CodeCopyButtonProps as CopyButtonProps,
};
