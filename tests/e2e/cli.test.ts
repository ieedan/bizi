import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Task, TaskRunTreeNode } from "@getbizi/client";
import { clientUnderTest, runClient } from "./client";
import {
	MockBiziServer,
	type MockServerConfig,
	type TimelineStep,
} from "./mock-server";

const SPEC_DIR = join(import.meta.dir, "../spec");

function loadSpec<T>(fileName: string): T {
	return JSON.parse(readFileSync(join(SPEC_DIR, fileName), "utf8")) as T;
}

const fixtures = loadSpec<{
	taskMaps: Record<string, Record<string, Task>>;
	runTrees: Record<string, TaskRunTreeNode[]>;
}>("fixtures.json");

interface Scenario {
	name: string;
	argv: string[];
	timeoutMs?: number;
	server: {
		tasks: string;
		runs: string;
		startRunId?: string;
		startedRun?: TaskRunTreeNode;
		timeline?: TimelineStep[];
		failListTasks?: boolean;
		failListRuns?: boolean;
		failStart?: boolean;
		failCancelRunIds?: string[];
		logsBeforeSubscribe?: { line: string; runId: string; task?: string }[];
	};
	expect: {
		exitCode: number;
		stdout?: string[];
		stderr?: string[];
		stdoutEmpty?: boolean;
		notStdout?: string[];
		stdoutOccurrences?: Record<string, number>;
		stdoutJson?: unknown;
		/** Regex the trimmed stdout must match. */
		stdoutMatches?: string;
		requests?: string[];
		notRequests?: string[];
		/** Requests that must appear, in this relative order. */
		requestOrder?: string[];
	};
}

const spec = loadSpec<{ scenarios: Scenario[] }>("e2e-cli.json");

function serverConfig(scenario: Scenario): MockServerConfig {
	const tasks = fixtures.taskMaps[scenario.server.tasks];
	const runs = fixtures.runTrees[scenario.server.runs];
	if (!(tasks && runs)) {
		throw new Error(`unknown fixture in scenario "${scenario.name}"`);
	}
	return {
		...scenario.server,
		tasks: structuredClone(tasks),
		runs: structuredClone(runs),
	};
}

/** Substrings must appear in the given order, not just be present. */
function expectInOrder(haystack: string, needles: string[]): void {
	let cursor = 0;
	for (const needle of needles) {
		const found = haystack.indexOf(needle, cursor);
		expect(
			found,
			`expected to find ${JSON.stringify(needle)} after index ${cursor} in:\n${haystack}`
		).toBeGreaterThanOrEqual(0);
		cursor = found + needle.length;
	}
}

function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	let cursor = 0;
	for (;;) {
		const found = haystack.indexOf(needle, cursor);
		if (found < 0) {
			return count;
		}
		count += 1;
		cursor = found + needle.length;
	}
}

describe(`bizi CLI (${clientUnderTest()} client)`, () => {
	// One listener for the whole file, reconfigured per scenario.
	const server = new MockBiziServer({ tasks: {}, runs: [] });

	beforeAll(() => {
		server.listen();
	});
	afterAll(async () => {
		await server.stop();
	});

	for (const scenario of spec.scenarios) {
		it(scenario.name, async () => {
			server.reset(serverConfig(scenario));
			{
				const result = await runClient(scenario.argv, {
					port: server.port,
					timeoutMs: scenario.timeoutMs,
				});

				expect(
					result.timedOut,
					`client timed out\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
				).toBe(false);
				expect(
					result.exitCode,
					`unexpected exit code\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
				).toBe(scenario.expect.exitCode);

				if (scenario.expect.stdout) {
					expectInOrder(result.stdout, scenario.expect.stdout);
				}
				if (scenario.expect.stderr) {
					expectInOrder(result.stderr, scenario.expect.stderr);
				}
				if (scenario.expect.stdoutEmpty) {
					expect(result.stdout.trim()).toBe("");
				}
				for (const needle of scenario.expect.notStdout ?? []) {
					expect(result.stdout).not.toContain(needle);
				}
				for (const [needle, times] of Object.entries(
					scenario.expect.stdoutOccurrences ?? {}
				)) {
					expect(countOccurrences(result.stdout, needle)).toBe(times);
				}
				if (scenario.expect.stdoutMatches) {
					expect(result.stdout.trim()).toMatch(
						new RegExp(scenario.expect.stdoutMatches)
					);
				}
				if (scenario.expect.stdoutJson !== undefined) {
					expect(JSON.parse(result.stdout)).toMatchObject(
						scenario.expect.stdoutJson as object
					);
				}

				const requests = server.requestSummaries();
				for (const request of scenario.expect.requests ?? []) {
					expect(requests).toContain(request);
				}
				for (const request of scenario.expect.notRequests ?? []) {
					expect(requests).not.toContain(request);
				}
				let requestCursor = 0;
				for (const request of scenario.expect.requestOrder ?? []) {
					const found = requests.indexOf(request, requestCursor);
					expect(
						found,
						`expected ${request} after index ${requestCursor} in:\n${requests.join("\n")}`
					).toBeGreaterThanOrEqual(0);
					requestCursor = found + 1;
				}
			}
		}, 30_000);
	}
});
