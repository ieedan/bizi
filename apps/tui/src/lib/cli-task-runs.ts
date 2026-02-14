import type { TaskRunTreeNode } from "@task-runner/client-js";

const activeStatuses = new Set<TaskRunTreeNode["status"]>([
	"Queued",
	"Running",
]);

export function flattenTaskRuns(
	taskRuns: TaskRunTreeNode[]
): TaskRunTreeNode[] {
	const flattened: TaskRunTreeNode[] = [];
	const visit = (node: TaskRunTreeNode) => {
		flattened.push(node);
		for (const child of node.children) {
			visit(child);
		}
	};

	for (const run of taskRuns) {
		visit(run);
	}

	return flattened;
}

export function findLatestRunByTaskKey(
	taskRuns: TaskRunTreeNode[],
	taskKey: string
): TaskRunTreeNode | undefined {
	return flattenTaskRuns(taskRuns)
		.filter((run) => run.task === taskKey)
		.sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

export function findActiveRunByTaskKey(
	taskRuns: TaskRunTreeNode[],
	taskKey: string
): TaskRunTreeNode | undefined {
	return flattenTaskRuns(taskRuns)
		.filter((run) => run.task === taskKey && activeStatuses.has(run.status))
		.sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

export function isTaskInSubtree(taskKey: string, rootTaskKey: string): boolean {
	return taskKey === rootTaskKey || taskKey.startsWith(`${rootTaskKey}:`);
}

export function findLatestRunInTaskSubtree(
	taskRuns: TaskRunTreeNode[],
	rootTaskKey: string
): TaskRunTreeNode | undefined {
	return flattenTaskRuns(taskRuns)
		.filter((run) => isTaskInSubtree(run.task, rootTaskKey))
		.sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

export function findActiveRunInTaskSubtree(
	taskRuns: TaskRunTreeNode[],
	rootTaskKey: string
): TaskRunTreeNode | undefined {
	return flattenTaskRuns(taskRuns)
		.filter(
			(run) =>
				isTaskInSubtree(run.task, rootTaskKey) &&
				activeStatuses.has(run.status)
		)
		.sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

export function findActiveRunsInTaskSubtree(
	taskRuns: TaskRunTreeNode[],
	rootTaskKey: string
): TaskRunTreeNode[] {
	return flattenTaskRuns(taskRuns)
		.filter(
			(run) =>
				isTaskInSubtree(run.task, rootTaskKey) &&
				activeStatuses.has(run.status)
		)
		.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function isTerminalRunStatus(
	status: TaskRunTreeNode["status"]
): boolean {
	return (
		status === "Success" || status === "Failed" || status === "Cancelled"
	);
}

export function taskRunStatusExitCode(
	status: TaskRunTreeNode["status"]
): number {
	return status === "Success" ? 0 : 1;
}
