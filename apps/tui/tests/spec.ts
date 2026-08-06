/**
 * Loader for the shared conformance spec in `tests/spec/`.
 *
 * The same files are read by the Rust harness in
 * `crates/bizi-tui/src/conformance.rs`, so a behavior only has to be described
 * once for both clients to be held to it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Task, TaskRunLogLine, TaskRunTreeNode } from "@getbizi/client";

export const SPEC_DIR = join(import.meta.dir, "../../../tests/spec");

export function loadSpec<T>(fileName: string): T {
	return JSON.parse(readFileSync(join(SPEC_DIR, fileName), "utf8")) as T;
}

interface Fixtures {
	taskMaps: Record<string, Record<string, Task>>;
	runTrees: Record<string, TaskRunTreeNode[]>;
}

const fixtures = loadSpec<Fixtures>("fixtures.json");

export function taskMap(name: string): Record<string, Task> {
	const tasks = fixtures.taskMaps[name];
	if (!tasks) {
		throw new Error(`unknown task map fixture "${name}"`);
	}
	return structuredClone(tasks);
}

export function runTree(name: string): TaskRunTreeNode[] {
	const runs = fixtures.runTrees[name];
	if (!runs) {
		throw new Error(`unknown run tree fixture "${name}"`);
	}
	return structuredClone(runs);
}

/** A stable label for a case, whether or not it declared a `name`. */
export function caseName(testCase: { name?: string }, index: number): string {
	return testCase.name ?? `case ${index + 1}`;
}

export function logLine(
	overrides: Partial<TaskRunLogLine> & { task?: string } = {}
): TaskRunLogLine {
	return {
		runId: "run-dev",
		sequence: 0,
		task: "dev",
		timestamp: 0,
		isStderr: false,
		line: "line",
		...overrides,
	};
}
