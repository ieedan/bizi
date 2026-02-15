import type { Task } from "@getbizi/client";
import type { TaskRow, TaskTreeNode } from "../types";

export function flattenTaskRows(taskTree: TaskTreeNode[]): TaskRow[] {
	const rows: TaskRow[] = [];

	const visit = (node: TaskTreeNode): void => {
		rows.push(node.row);
		for (const child of node.children) {
			visit(child);
		}
	};

	for (const node of taskTree) {
		visit(node);
	}

	return rows;
}

export function buildTaskTree(tasks: Record<string, Task>): TaskTreeNode[] {
	const buildNode = (taskKey: string): TaskTreeNode => {
		const childKeys = getDirectChildTaskKeys(tasks, taskKey).sort((a, b) =>
			a.localeCompare(b)
		);
		return {
			row: createTaskRow(taskKey),
			children: childKeys.map((childKey) => buildNode(childKey)),
		};
	};

	return Object.keys(tasks)
		.filter((taskKey) => !taskKey.includes(":"))
		.sort((a, b) => a.localeCompare(b))
		.map((taskKey) => buildNode(taskKey));
}

export function findNextParentTaskIndex(
	taskRows: TaskRow[],
	currentIndex: number
): number {
	for (let index = currentIndex + 1; index < taskRows.length; index += 1) {
		if (taskRows[index]?.depth === 0) {
			return index;
		}
	}
	return currentIndex;
}

export function findPreviousParentTaskIndex(
	taskRows: TaskRow[],
	currentIndex: number
): number {
	for (let index = currentIndex - 1; index >= 0; index -= 1) {
		if (taskRows[index]?.depth === 0) {
			return index;
		}
	}
	return currentIndex;
}

export function getDirectChildTaskKeys(
	tasks: Record<string, Task>,
	taskKey: string
): string[] {
	const childEntries = Object.keys(tasks[taskKey]?.tasks ?? {});
	return childEntries
		.map((childKey) => `${taskKey}:${childKey}`)
		.filter((fullKey) => tasks[fullKey] !== undefined);
}

function createTaskRow(taskKey: string): TaskRow {
	const segments = taskKey.split(":");
	return {
		key: taskKey,
		label: segments.at(-1) ?? taskKey,
		depth: Math.max(0, segments.length - 1),
	};
}
