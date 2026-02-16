import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPENAPI_URL = "http://127.0.0.1:7436/openapi.json";
const MAX_ATTEMPTS = 30;
const POLL_MS = 500;

async function waitForOpenApi(): Promise<void> {
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		try {
			const res = await fetch(OPENAPI_URL);
			if (res.ok) {
				return;
			}
		} catch {
			// Server not ready yet
		}
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	throw new Error(
		`Timeout: server did not serve ${OPENAPI_URL} within ${(MAX_ATTEMPTS * POLL_MS) / 1000}s`
	);
}

function run(cmd: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			stdio: "inherit",
			cwd: rootDir,
			shell: true,
		});
		const emitter = child as unknown as NodeJS.EventEmitter;
		emitter.on("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`Command failed with code ${code}`))
		);
		emitter.on("error", reject);
	});
}

async function main(): Promise<void> {
	const serverProcess: ChildProcess = spawn(
		"cargo",
		["run", "-p", "server"],
		{
			stdio: "pipe",
			cwd: rootDir,
		}
	);

	const cleanup = (): void => {
		try {
			serverProcess.kill("SIGTERM");
		} catch {
			// Process may already be gone
		}
	};

	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	try {
		await waitForOpenApi();
		await run("pnpm", ["run", "generate:clients"]);
	} finally {
		cleanup();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
