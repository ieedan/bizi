import { createTaskRunnerApi } from "@task-runner/client-js";
import { Command } from "commander";
import type { CliOptions } from "../lib/args";
import { cancelCommand } from "./cancel";
import { runCommand } from "./run";
import { statCommand } from "./stat";

const reservedSubcommands = new Set(["run", "cancel", "stat"]);

type ResolveCliModeResult =
	| { mode: "tui"; cliOptions: CliOptions }
	| { mode: "cli"; exitCode: number };

export async function resolveCliMode(
	argv: string[],
	defaultCliOptions: CliOptions
): Promise<ResolveCliModeResult> {
	const normalized = normalizeImplicitRunCommand(argv);
	let handledCommand = false;
	let commandExitCode = 0;
	let resolvedCliOptions = defaultCliOptions;
	const api = createTaskRunnerApi({ port: 7436 });

	const program = new Command()
		.name("task-runner")
		.allowUnknownOption(false)
		.allowExcessArguments(false)
		.option(
			"-C, --cwd <path>",
			"Set working directory for task discovery and runs",
			defaultCliOptions.cwd
		)
		.hook("preAction", (_, actionCommand) => {
			const cwd = actionCommand.optsWithGlobals().cwd;
			if (typeof cwd === "string" && cwd.length > 0) {
				resolvedCliOptions = { cwd };
			}
		});

	program
		.command("run")
		.argument("<task>")
		.option(
			"--non-interactive",
			"Disable prompts and only cancel on exit when this session started the run",
			false
		)
		.action(async (task: string, options: { nonInteractive: boolean }) => {
			handledCommand = true;
			commandExitCode = await runCommand(
				{
					cwd: resolvedCliOptions.cwd,
					task,
					nonInteractive: Boolean(options.nonInteractive),
					implicit: normalized.wasImplicitRun,
				},
				api
			);
		});

	program
		.command("cancel")
		.argument("<task>")
		.action(async (task: string) => {
			handledCommand = true;
			commandExitCode = await cancelCommand(
				{
					cwd: resolvedCliOptions.cwd,
					task,
				},
				api
			);
		});

	program
		.command("stat")
		.argument("<task>")
		.option("--json", "Print machine-readable JSON output", false)
		.action(async (task: string, options: { json: boolean }) => {
			handledCommand = true;
			commandExitCode = await statCommand(
				{
					cwd: resolvedCliOptions.cwd,
					task,
					json: Boolean(options.json),
				},
				api
			);
		});

	program.exitOverride();

	try {
		await program.parseAsync(normalized.argv, { from: "user" });
	} catch (error) {
		if (isCommanderExitError(error)) {
			return { mode: "cli", exitCode: error.exitCode ?? 1 };
		}
		throw error;
	}

	if (!handledCommand) {
		const cwd = program.opts<{ cwd?: string }>().cwd;
		if (typeof cwd === "string" && cwd.length > 0) {
			resolvedCliOptions = { cwd };
		}
		return { mode: "tui", cliOptions: resolvedCliOptions };
	}

	return { mode: "cli", exitCode: commandExitCode };
}

function normalizeImplicitRunCommand(argv: string[]): {
	argv: string[];
	wasImplicitRun: boolean;
} {
	const firstPositionalIndex = findFirstPositionalTokenIndex(argv);
	if (firstPositionalIndex === -1) {
		return { argv, wasImplicitRun: false };
	}

	const firstPositional = argv[firstPositionalIndex];
	if (!firstPositional || reservedSubcommands.has(firstPositional)) {
		return { argv, wasImplicitRun: false };
	}

	const normalized = [...argv];
	normalized.splice(firstPositionalIndex, 0, "run");
	return { argv: normalized, wasImplicitRun: true };
}

function findFirstPositionalTokenIndex(argv: string[]): number {
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token) {
			continue;
		}
		if (token === "--") {
			return index + 1 < argv.length ? index + 1 : -1;
		}
		if (!token.startsWith("-")) {
			return index;
		}
		if (token === "-C" || token === "--cwd") {
			index += 1;
		}
	}
	return -1;
}

function isCommanderExitError(
	error: unknown
): error is { exitCode?: number; message?: string } {
	return (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string" &&
		error.message.includes("(outputHelp)")
	);
}
