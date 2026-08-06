/**
 * Spawns the client under test.
 *
 * `BIZI_CLIENT=ts` (the default) runs the TypeScript client from source;
 * `BIZI_CLIENT=rust` runs the compiled Rust binary. Both are pointed at the
 * mock server with `BIZI_PORT`, so the same scenarios exercise either one.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export type ClientKind = "ts" | "rust";

export const REPO_ROOT = join(import.meta.dir, "../..");

export function clientUnderTest(): ClientKind {
	const requested = (process.env.BIZI_CLIENT ?? "ts").toLowerCase();
	if (requested === "ts" || requested === "rust") {
		return requested;
	}
	throw new Error(
		`BIZI_CLIENT must be "ts" or "rust", got "${process.env.BIZI_CLIENT}"`
	);
}

export const TS_CLIENT_DIR = join(REPO_ROOT, "apps/tui");

export function clientCommand(argv: string[]): string[] {
	if (clientUnderTest() === "rust") {
		const binary =
			process.env.BIZI_RUST_BIN ?? join(REPO_ROOT, "target/debug/bizi");
		if (!existsSync(binary)) {
			throw new Error(
				`Rust client not built. Run \`cargo build -p bizi-tui\` (looked for ${binary}).`
			);
		}
		return [binary, ...argv];
	}
	// Run from the app directory so bunfig.toml's solid JSX preload applies.
	return ["bun", "run", join(TS_CLIENT_DIR, "src/index.tsx"), ...argv];
}

/** Where the client process starts, when a scenario does not pin one. */
export function defaultClientCwd(): string {
	return clientUnderTest() === "rust" ? REPO_ROOT : TS_CLIENT_DIR;
}

export interface RunClientOptions {
	port: number;
	cwd?: string;
	env?: Record<string, string>;
	timeoutMs?: number;
}

export interface ClientResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export async function runClient(
	argv: string[],
	options: RunClientOptions
): Promise<ClientResult> {
	const child = Bun.spawn(clientCommand(argv), {
		cwd: options.cwd ?? defaultClientCwd(),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			BIZI_PORT: String(options.port),
			BIZI_HOST: "127.0.0.1",
			NO_COLOR: "1",
			TZ: "UTC",
			...options.env,
		},
	});

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timer);

	return { exitCode, stdout, stderr, timedOut };
}
