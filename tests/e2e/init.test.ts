import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientUnderTest, runClient } from "./client";
import { MockBiziServer } from "./mock-server";

// `init` never talks to the server, but the client still resolves its target on
// startup, so it gets a mock to point at.
const server = new MockBiziServer({ tasks: {}, runs: [] });

let workDir = "";

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), "bizi-init-"));
});

afterEach(() => {
	rmSync(workDir, { recursive: true, force: true });
});

describe(`bizi init (${clientUnderTest()} client)`, () => {
	beforeAll(() => {
		server.listen();
	});
	afterAll(async () => {
		await server.stop();
	});

	it("writes a starter config into an empty directory", async () => {
		const result = await runClient(["-C", workDir, "init"], {
			port: server.port,
		});

		expect(result.exitCode).toBe(0);
		const config = JSON.parse(
			readFileSync(join(workDir, "task.config.json"), "utf8")
		);
		expect(config).toEqual({
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
		});
	});

	it("ends the file with a newline", async () => {
		await runClient(["-C", workDir, "init"], { port: server.port });
		expect(
			readFileSync(join(workDir, "task.config.json"), "utf8")
		).toEndWith("\n");
	});

	it("refuses to overwrite an existing config", async () => {
		const configPath = join(workDir, "task.config.json");
		writeFileSync(configPath, '{"tasks":{"keep":{"command":"echo keep"}}}');

		const result = await runClient(["-C", workDir, "init"], {
			port: server.port,
		});

		expect(result.exitCode).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain(
			"task.config.json already exists"
		);
		expect(readFileSync(configPath, "utf8")).toContain("keep");
	});

	it("does not read package.json scripts without a terminal", async () => {
		writeFileSync(
			join(workDir, "package.json"),
			JSON.stringify({ scripts: { dev: "vite", prepare: "husky" } })
		);

		const result = await runClient(["-C", workDir, "init"], {
			port: server.port,
		});

		expect(result.exitCode).toBe(0);
		const config = JSON.parse(
			readFileSync(join(workDir, "task.config.json"), "utf8")
		);
		expect(Object.keys(config.tasks)).toEqual(["hello-world"]);
	});
});
