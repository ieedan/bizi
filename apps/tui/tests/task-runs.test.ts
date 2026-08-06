import { describe, expect, it } from "bun:test";
import type { TaskRunTreeNode } from "@getbizi/client";
import {
	buildDisplayStatusByTaskKey,
	canCancelRun,
	indexRunsByTaskKey,
	upsertRunTreeNode,
} from "../src/lib/task-runs";
import { caseName, loadSpec, runTree, taskMap } from "./spec";

interface Spec {
	indexRunsByTaskKey: {
		name?: string;
		runs: string;
		expected: Record<string, string>;
	}[];
	buildDisplayStatusByTaskKey: {
		name?: string;
		tasks: string;
		runs: string;
		expected: Record<string, string | null>;
	}[];
	upsertRunTreeNode: {
		name?: string;
		runs: string;
		update: TaskRunTreeNode;
		expectedRootIds: string[];
		expectedStatusById: Record<string, string>;
	}[];
	canCancelRun: {
		name?: string;
		run: { status: TaskRunTreeNode["status"]; childCount: number };
		expected: boolean;
	}[];
}

const spec = loadSpec<Spec>("task-runs.json");

function flatten(runs: TaskRunTreeNode[]): TaskRunTreeNode[] {
	return runs.flatMap((run) => [run, ...flatten(run.children)]);
}

describe("indexRunsByTaskKey", () => {
	spec.indexRunsByTaskKey.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			const indexed = indexRunsByTaskKey(runTree(testCase.runs));
			const actual = Object.fromEntries(
				[...indexed.entries()].map(([taskKey, run]) => [
					taskKey,
					run.id,
				])
			);
			expect(actual).toEqual(testCase.expected);
		});
	});
});

describe("buildDisplayStatusByTaskKey", () => {
	spec.buildDisplayStatusByTaskKey.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			const tasks = taskMap(testCase.tasks);
			const statuses = buildDisplayStatusByTaskKey(
				tasks,
				indexRunsByTaskKey(runTree(testCase.runs))
			);
			const actual: Record<string, string | null> = {};
			for (const taskKey of Object.keys(testCase.expected)) {
				actual[taskKey] = statuses.get(taskKey) ?? null;
			}
			expect(actual).toEqual(testCase.expected);
		});
	});
});

describe("upsertRunTreeNode", () => {
	spec.upsertRunTreeNode.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			const next = upsertRunTreeNode(
				runTree(testCase.runs),
				testCase.update
			);
			expect(next.map((run) => run.id)).toEqual(testCase.expectedRootIds);
			const statusById = Object.fromEntries(
				flatten(next).map((run) => [run.id, run.status])
			);
			expect(statusById).toMatchObject(testCase.expectedStatusById);
		});
	});

	it("does not mutate the roots it was given", () => {
		const roots = runTree("devRunning");
		const before = structuredClone(roots);
		upsertRunTreeNode(roots, {
			...roots[0]!.children[0]!,
			status: "Cancelled",
		});
		expect(roots).toEqual(before);
	});
});

describe("canCancelRun", () => {
	spec.canCancelRun.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			const run: TaskRunTreeNode = {
				id: "run",
				task: "dev",
				cwd: "/repo",
				status: testCase.run.status,
				updatedAt: 0,
				children: Array.from(
					{ length: testCase.run.childCount },
					(_unused, childIndex) => ({
						id: `child-${childIndex}`,
						task: `dev:child-${childIndex}`,
						cwd: "/repo",
						status: "Running" as const,
						updatedAt: 0,
						children: [],
					})
				),
			};
			expect(canCancelRun(run)).toBe(testCase.expected);
		});
	});
});
