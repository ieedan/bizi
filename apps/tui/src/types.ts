import type { TaskRunTreeNode } from "@task-runner/client-js";

export type TaskRow = {
    key: string;
    label: string;
    depth: number;
};

export type LogMode = "aggregate" | "selected";
export type DisplayTaskStatus = TaskRunTreeNode["status"] | "Indeterminate" | undefined;

export type TaskTreeNode = {
    row: TaskRow;
    children: TaskTreeNode[];
};
