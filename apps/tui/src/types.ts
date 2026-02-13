import type { TaskRunTreeNode } from "@task-runner/client-js";

export interface TaskRow {
	key: string;
	label: string;
	depth: number;
}

export type LogMode = "aggregate" | "selected";
export type DisplayTaskStatus =
	| TaskRunTreeNode["status"]
	| "Indeterminate"
	| undefined;

export interface TaskTreeNode {
	row: TaskRow;
	children: TaskTreeNode[];
}
