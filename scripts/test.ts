/**
 * Runs the whole client conformance suite: the shared spec against both
 * clients, then the end-to-end scenarios against each of them.
 *
 * `bun run scripts/test.ts` from the repo root, or `pnpm test`.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Step {
	title: string;
	command: string;
	args: string[];
	cwd?: string;
	env?: Record<string, string>;
}

const steps: Step[] = [
	{
		title: "TypeScript client — shared spec",
		command: "bun",
		args: ["test", "tests/"],
		cwd: join(REPO_ROOT, "apps/tui"),
	},
	{
		title: "Rust client — shared spec",
		command: "cargo",
		args: ["test", "-p", "bizi-tui"],
	},
	{
		title: "Rust client — build for the end-to-end suite",
		command: "cargo",
		args: ["build", "-p", "bizi-tui"],
	},
	{
		title: "End to end — TypeScript client",
		command: "bun",
		args: ["test", "tests/e2e/"],
		env: { BIZI_CLIENT: "ts" },
	},
	{
		title: "End to end — Rust client",
		command: "bun",
		args: ["test", "tests/e2e/"],
		env: { BIZI_CLIENT: "rust" },
	},
];

const failures: string[] = [];

for (const step of steps) {
	process.stdout.write(`\n\x1b[1m▶ ${step.title}\x1b[0m\n`);
	const result = spawnSync(step.command, step.args, {
		cwd: step.cwd ?? REPO_ROOT,
		stdio: "inherit",
		// The timestamp cases are written against UTC.
		env: { ...process.env, TZ: "UTC", ...step.env },
	});
	if (result.status !== 0) {
		failures.push(step.title);
	}
}

if (failures.length > 0) {
	process.stdout.write(
		`\n\x1b[31m${failures.length} step(s) failed:\x1b[0m\n`
	);
	for (const failure of failures) {
		process.stdout.write(`  - ${failure}\n`);
	}
	process.exit(1);
}

process.stdout.write("\n\x1b[32mAll conformance steps passed.\x1b[0m\n");
