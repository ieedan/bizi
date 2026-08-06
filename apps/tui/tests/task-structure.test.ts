import { describe, expect, it } from "bun:test";
import {
	buildTaskTree,
	findNextParentTaskIndex,
	findPreviousParentTaskIndex,
	flattenTaskRows,
	getDirectChildTaskKeys,
} from "../src/lib/task-structure";
import { caseName, loadSpec, taskMap } from "./spec";

interface Spec {
	flattenTaskRows: {
		name?: string;
		tasks: string;
		expected: { key: string; label: string; depth: number }[];
	}[];
	getDirectChildTaskKeys: {
		name?: string;
		tasks: string;
		taskKey: string;
		expected: string[];
	}[];
	findNextParentTaskIndex: {
		name?: string;
		tasks: string;
		from: number;
		expected: number;
	}[];
	findPreviousParentTaskIndex: {
		name?: string;
		tasks: string;
		from: number;
		expected: number;
	}[];
}

const spec = loadSpec<Spec>("task-structure.json");

function rowsFor(tasks: string) {
	return flattenTaskRows(buildTaskTree(taskMap(tasks)));
}

describe("flattenTaskRows", () => {
	spec.flattenTaskRows.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(rowsFor(testCase.tasks)).toEqual(testCase.expected);
		});
	});
});

describe("getDirectChildTaskKeys", () => {
	spec.getDirectChildTaskKeys.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				getDirectChildTaskKeys(
					taskMap(testCase.tasks),
					testCase.taskKey
				)
			).toEqual(testCase.expected);
		});
	});
});

describe("findNextParentTaskIndex", () => {
	spec.findNextParentTaskIndex.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				findNextParentTaskIndex(rowsFor(testCase.tasks), testCase.from)
			).toBe(testCase.expected);
		});
	});
});

describe("findPreviousParentTaskIndex", () => {
	spec.findPreviousParentTaskIndex.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				findPreviousParentTaskIndex(
					rowsFor(testCase.tasks),
					testCase.from
				)
			).toBe(testCase.expected);
		});
	});
});

describe("buildTaskTree", () => {
	it("nests children under their parent node", () => {
		const tree = buildTaskTree(taskMap("monorepo"));
		expect(tree.map((node) => node.row.key)).toEqual([
			"dev",
			"check",
			"build",
		]);
		expect(tree[0]?.children.map((child) => child.row.key)).toEqual([
			"dev:api",
			"dev:web",
		]);
		expect(tree[2]?.children).toEqual([]);
	});

	it("keeps nesting past one level", () => {
		const tree = buildTaskTree(taskMap("deep"));
		expect(tree[0]?.children[0]?.children[0]?.row).toEqual({
			key: "a:b:c",
			label: "c",
			depth: 2,
		});
	});
});
