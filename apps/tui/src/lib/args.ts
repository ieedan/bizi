import { Command } from "commander";
import { z } from "zod";

const cliOptionsSchema = z.object({
	cwd: z.string(),
});

export type CliOptions = z.infer<typeof cliOptionsSchema>;

export function parseCliOptions(argv: string[]): CliOptions {
	const program = new Command()
		.name("task-runner")
		.allowUnknownOption(false)
		.allowExcessArguments(false)
		.option(
			"-C, --cwd <path>",
			"Set working directory for task discovery and runs",
			process.cwd()
		);

	program.parse(argv, { from: "user" });
	return cliOptionsSchema.parse(program.opts());
}
