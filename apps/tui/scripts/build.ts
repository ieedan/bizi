import solidPlugin from "../../../node_modules/@opentui/solid/scripts/solid-plugin";

// biome-ignore lint/correctness/noUndeclaredVariables: it's fine man
await Bun.build({
	entrypoints: ["./src/index.tsx"],
	target: "bun",
	outdir: "./dist",
	plugins: [solidPlugin],
});
