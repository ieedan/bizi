import { describe, expect, it } from "bun:test";
import type { TaskRunTreeNode } from "@getbizi/client";
import {
	findActiveRunByTaskKey,
	findActiveRunInTaskSubtree,
	findActiveRunsInTaskSubtree,
	findLatestRunByTaskKey,
	findLatestRunInTaskSubtree,
	flattenTaskRuns,
	isTaskInSubtree,
	isTerminalRunStatus,
	taskRunStatusExitCode,
} from "../src/lib/cli-task-runs";
import { caseName, loadSpec, runTree } from "./spec";

type Status = TaskRunTreeNode["status"];

interface Spec {
	flattenTaskRuns: { name?: string; runs: string; expected: string[] }[];
	isTaskInSubtree: {
		name?: string;
		taskKey: string;
		rootTaskKey: string;
		expected: boolean;
	}[];
	findLatestRunByTaskKey: {
		name?: string;
		runs: string;
		taskKey: string;
		expected: string | null;
	}[];
	findActiveRunByTaskKey: {
		name?: string;
		runs: string;
		taskKey: string;
		expected: string | null;
	}[];
	findLatestRunInTaskSubtree: {
		name?: string;
		runs: string;
		rootTaskKey: string;
		expected: string | null;
	}[];
	findActiveRunInTaskSubtree: {
		name?: string;
		runs: string;
		rootTaskKey: string;
		expected: string | null;
	}[];
	findActiveRunsInTaskSubtree: {
		name?: string;
		runs: string;
		rootTaskKey: string;
		expected: string[];
	}[];
	isTerminalRunStatus: { status: Status; expected: boolean }[];
	taskRunStatusExitCode: { status: Status; expected: number }[];
}

const spec = loadSpec<Spec>("cli-task-runs.json");

describe("flattenTaskRuns", () => {
	spec.flattenTaskRuns.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				flattenTaskRuns(runTree(testCase.runs)).map((run) => run.id)
			).toEqual(testCase.expected);
		});
	});
});

describe("isTaskInSubtree", () => {
	spec.isTaskInSubtree.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				isTaskInSubtree(testCase.taskKey, testCase.rootTaskKey)
			).toBe(testCase.expected);
		});
	});
});

const byTaskKeyLookups = [
	["findLatestRunByTaskKey", findLatestRunByTaskKey] as const,
	["findActiveRunByTaskKey", findActiveRunByTaskKey] as const,
];

for (const [name, lookup] of byTaskKeyLookups) {
	describe(name, () => {
		for (const [index, testCase] of spec[name].entries()) {
			it(caseName(testCase, index), () => {
				expect(
					lookup(runTree(testCase.runs), testCase.taskKey)?.id ?? null
				).toBe(testCase.expected);
			});
		}
	});
}

const subtreeLookups = [
	["findLatestRunInTaskSubtree", findLatestRunInTaskSubtree] as const,
	["findActiveRunInTaskSubtree", findActiveRunInTaskSubtree] as const,
];

for (const [name, lookup] of subtreeLookups) {
	describe(name, () => {
		for (const [index, testCase] of spec[name].entries()) {
			it(caseName(testCase, index), () => {
				expect(
					lookup(runTree(testCase.runs), testCase.rootTaskKey)?.id ??
						null
				).toBe(testCase.expected);
			});
		}
	});
}

describe("findActiveRunsInTaskSubtree", () => {
	spec.findActiveRunsInTaskSubtree.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				findActiveRunsInTaskSubtree(
					runTree(testCase.runs),
					testCase.rootTaskKey
				).map((run) => run.id)
			).toEqual(testCase.expected);
		});
	});
});

describe("isTerminalRunStatus", () => {
	for (const testCase of spec.isTerminalRunStatus) {
		it(`${testCase.status} -> ${testCase.expected}`, () => {
			expect(isTerminalRunStatus(testCase.status)).toBe(
				testCase.expected
			);
		});
	}
});

describe("taskRunStatusExitCode", () => {
	for (const testCase of spec.taskRunStatusExitCode) {
		it(`${testCase.status} -> ${testCase.expected}`, () => {
			expect(taskRunStatusExitCode(testCase.status)).toBe(
				testCase.expected
			);
		});
	}
});
