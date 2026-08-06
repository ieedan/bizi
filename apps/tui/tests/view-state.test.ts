import { describe, expect, it } from "bun:test";
import type { LogMode } from "../src/types";
import {
	buildDisplayStatusByTaskKey,
	indexRunsByTaskKey,
} from "../src/lib/task-runs";
import { buildTaskTree, flattenTaskRows } from "../src/lib/task-structure";
import {
	buildLogColorByTaskKey,
	canCancelSelected,
	canToggleLogMode,
	clampSelectedIndex,
	footerActions,
	type FooterActionsInput,
	logTaskTagWidth,
	resolveRowAction,
	runningTaskRows,
	runStatusText,
	type RunAction,
	type RunStatusTextInput,
	selectedFooterStatus,
	type TaskViewContext,
	usesAggregateLogs,
} from "../src/lib/view-state";
import { caseName, loadSpec, logLine, runTree, taskMap } from "./spec";

interface Spec {
	resolveRowAction: {
		name?: string;
		tasks: string;
		runs: string;
		taskKey: string;
		depth: number;
		expected: string;
	}[];
	selectedFooterStatus: {
		name?: string;
		tasks: string;
		runs: string;
		taskKey: string | null;
		expected: string | null;
	}[];
	canToggleLogMode: {
		name?: string;
		tasks: string;
		taskKey: string | null;
		expected: boolean;
	}[];
	usesAggregateLogs: {
		name?: string;
		tasks: string;
		taskKey: string | null;
		logMode: LogMode;
		expected: boolean;
	}[];
	canCancelSelected: {
		name?: string;
		tasks: string;
		runs: string;
		taskKey: string | null;
		expected: boolean;
	}[];
	runningTaskRows: {
		name?: string;
		tasks: string;
		runs: string;
		expected: { key: string; depth: number; status: string }[];
	}[];
	logTaskTagWidth: {
		name?: string;
		taskNames: string[];
		expected: number;
	}[];
	buildLogColorByTaskKey: {
		name?: string;
		tasks: string;
		expected: Record<string, string>;
	}[];
	clampSelectedIndex: {
		name?: string;
		rowCount: number;
		selectedIndex: number;
		expected: number;
	}[];
	footerActions: {
		name?: string;
		input: FooterActionsInput;
		expected: string[];
	}[];
	runStatusText: {
		name?: string;
		input: RunStatusTextInput;
		expected: string;
	}[];
}

const spec = loadSpec<Spec>("view-state.json");

function context(tasksName: string, runsName: string): TaskViewContext {
	const tasks = taskMap(tasksName);
	const runByTaskKey = indexRunsByTaskKey(runTree(runsName));
	return {
		tasks,
		runByTaskKey,
		displayStatusByTaskKey: buildDisplayStatusByTaskKey(
			tasks,
			runByTaskKey
		),
	};
}

describe("resolveRowAction", () => {
	spec.resolveRowAction.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				resolveRowAction(
					context(testCase.tasks, testCase.runs),
					testCase.taskKey,
					testCase.depth
				)
			).toBe(testCase.expected as RunAction);
		});
	});
});

describe("selectedFooterStatus", () => {
	spec.selectedFooterStatus.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				selectedFooterStatus(
					context(testCase.tasks, testCase.runs),
					testCase.taskKey
				)
			).toBe(testCase.expected as never);
		});
	});
});

describe("canToggleLogMode", () => {
	spec.canToggleLogMode.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				canToggleLogMode(taskMap(testCase.tasks), testCase.taskKey)
			).toBe(testCase.expected);
		});
	});
});

describe("usesAggregateLogs", () => {
	spec.usesAggregateLogs.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				usesAggregateLogs(
					taskMap(testCase.tasks),
					testCase.taskKey,
					testCase.logMode
				)
			).toBe(testCase.expected);
		});
	});
});

describe("canCancelSelected", () => {
	spec.canCancelSelected.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				canCancelSelected(
					context(testCase.tasks, testCase.runs),
					testCase.taskKey
				)
			).toBe(testCase.expected);
		});
	});
});

describe("runningTaskRows", () => {
	spec.runningTaskRows.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			const rows = flattenTaskRows(
				buildTaskTree(taskMap(testCase.tasks))
			);
			expect(
				runningTaskRows(
					rows,
					indexRunsByTaskKey(runTree(testCase.runs))
				)
			).toEqual(testCase.expected as never);
		});
	});
});

describe("logTaskTagWidth", () => {
	spec.logTaskTagWidth.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				logTaskTagWidth(
					testCase.taskNames.map((task) => logLine({ task }))
				)
			).toBe(testCase.expected);
		});
	});
});

describe("buildLogColorByTaskKey", () => {
	spec.buildLogColorByTaskKey.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(buildLogColorByTaskKey(taskMap(testCase.tasks))).toEqual(
				testCase.expected
			);
		});
	});
});

describe("clampSelectedIndex", () => {
	spec.clampSelectedIndex.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				clampSelectedIndex(testCase.rowCount, testCase.selectedIndex)
			).toBe(testCase.expected);
		});
	});
});

describe("footerActions", () => {
	spec.footerActions.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				footerActions(testCase.input).map(
					(action) => `${action.key} ${action.label}`
				)
			).toEqual(testCase.expected);
		});
	});
});

describe("runStatusText", () => {
	spec.runStatusText.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(runStatusText(testCase.input)).toBe(testCase.expected);
		});
	});
});
