import {
	cancel,
	confirm,
	intro,
	isCancel,
	log,
	multiselect,
	outro,
} from "@clack/prompts";
import { z } from "zod";
import { join } from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";

const initCommandArgsSchema = z.object({
	cwd: z.string().min(1),
});

export type InitCommandArgs = z.infer<typeof initCommandArgsSchema>;

const KNOWN_NPM_HOOKS = new Set([
	"prepare",
	"prepublish",
	"prepublishOnly",
	"prepack",
	"postpack",
	"publish",
	"postpublish",
	"preinstall",
	"install",
	"postinstall",
	"preuninstall",
	"uninstall",
	"postuninstall",
	"preversion",
	"version",
	"postversion",
	"pretest",
	"posttest",
	"prestart",
	"poststart",
	"prerestart",
	"postrestart",
	"prestop",
	"stop",
	"poststop",
]);

const STARTER_TEMPLATE = {
	$schema: "https://getbizi.dev/schemas/task.config.json",
	tasks: {
		"hello-world": {
			tasks: {
				hello: { command: "echo Hello," },
				world: {
					command: "echo World!",
					dependsOn: ["hello-world:hello"],
				},
			},
		},
	},
} as const;

export async function initCommand(input: unknown): Promise<number> {
	const args = initCommandArgsSchema.parse(input);
	const configPath = join(args.cwd, "task.config.json");

	intro("bizi init");

	const configExists = await fileExists(configPath);
	if (configExists) {
		log.error("task.config.json already exists in this directory.");
		outro("Init failed.");
		return 1;
	}

	const isInteractive = process.stdout.isTTY;
	const packageJsonPath = join(args.cwd, "package.json");
	const packageJsonExists = await fileExists(packageJsonPath);

	let selectedScripts: string[] = [];
	let packageJson: { scripts?: Record<string, string> } | null = null;

	if (isInteractive && packageJsonExists) {
		packageJson = await readPackageJson(packageJsonPath);
		const scripts = packageJson?.scripts;
		const eligibleScripts = Object.keys(scripts ?? {}).filter(
			(name) => !KNOWN_NPM_HOOKS.has(name)
		);

		const shouldBringScripts = await confirm({
			message: "Should we bring scripts over from your package.json?",
		});
		if (isCancel(shouldBringScripts)) {
			cancel("Operation cancelled.");
			outro("Init cancelled.");
			return 0;
		}

		if (shouldBringScripts && eligibleScripts.length > 0) {
			const selected = await multiselect({
				message:
					"Which scripts should we bring over from your package.json?",
				options: eligibleScripts.map((name) => ({
					value: name,
					label: name,
					hint: scripts?.[name],
				})),
				initialValues: eligibleScripts,
				required: false,
			});
			if (isCancel(selected)) {
				cancel("Operation cancelled.");
				outro("Init cancelled.");
				return 0;
			}
			selectedScripts = selected;
		}
	}

	const config =
		selectedScripts.length > 0
			? buildConfigFromScripts(packageJson, selectedScripts)
			: STARTER_TEMPLATE;

	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

	log.success("Created task.config.json.");
	outro("You're all set!");
	return 0;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function readPackageJson(
	path: string
): Promise<{ scripts?: Record<string, string> } | null> {
	try {
		const content = await readFile(path, "utf-8");
		const parsed = JSON.parse(content) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"scripts" in parsed
		) {
			return parsed as { scripts?: Record<string, string> };
		}
		return null;
	} catch {
		return null;
	}
}

function buildConfigFromScripts(
	packageJson: { scripts?: Record<string, string> } | null,
	selectedScripts: string[]
): { $schema: string; tasks: Record<string, { command: string }> } {
	const scripts = packageJson?.scripts ?? {};
	const tasks: Record<string, { command: string }> = {};
	for (const name of selectedScripts) {
		const command = scripts[name];
		if (typeof command === "string") {
			tasks[name] = { command };
		}
	}
	return {
		$schema: "https://getbizi.dev/schemas/task.config.json",
		tasks,
	};
}
