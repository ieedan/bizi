import type { Task, TaskRunTreeNode } from "@getbizi/client";
import pc from "picocolors";
import { z } from "zod";
import {
	findActiveRunInTaskSubtree,
	findLatestRunInTaskSubtree,
} from "../lib/cli-task-runs";
import { taskStatusDisplay } from "../lib/status";
import {
	buildDisplayStatusByTaskKey,
	indexRunsByTaskKey,
} from "../lib/task-runs";
import { getDirectChildTaskKeys } from "../lib/task-structure";
import type { DisplayTaskStatus } from "../types";

const statCommandArgsSchema = z.object({
	cwd: z.string().min(1),
	task: z.string().min(1),
	json: z.boolean(),
});

export type StatCommandArgs = z.infer<typeof statCommandArgsSchema>;

interface StatCommandDependencies {
	listTasks: (cwd: string) => Promise<{ data?: unknown; error?: unknown }>;
	listTaskRuns: (cwd: string) => Promise<{ data?: unknown; error?: unknown }>;
}

export async function statCommand(
	input: unknown,
	deps: StatCommandDependencies
): Promise<number> {
	const args = statCommandArgsSchema.parse(input);
	const tasks = await listTasksOrThrow(deps, args.cwd);
	const taskRuns = await listTaskRunsOrThrow(deps, args.cwd);
	const runByTaskKey = indexRunsByTaskKey(taskRuns);
	const displayStatusByTaskKey = buildDisplayStatusByTaskKey(
		tasks,
		runByTaskKey
	);
	const activeRun = findActiveRunInTaskSubtree(taskRuns, args.task);
	const latestRun = findLatestRunInTaskSubtree(taskRuns, args.task);
	const subtree = buildTaskStatusTree(
		tasks,
		displayStatusByTaskKey,
		args.task
	);

	const payload = {
		task: args.task,
		cwd: args.cwd,
		activeRun: activeRun
			? {
					task: activeRun.task,
					status: activeRun.status,
					updatedAt: activeRun.updatedAt,
				}
			: null,
		latestRun: latestRun
			? {
					task: latestRun.task,
					status: latestRun.status,
					updatedAt: latestRun.updatedAt,
				}
			: null,
		subtree,
	};

	if (args.json) {
		process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
		return 0;
	}

	if (subtree === null && latestRun === undefined) {
		process.stdout.write(`Task "${args.task}" has no recorded runs.\n`);
		return 0;
	}

	if (subtree) {
		process.stdout.write(`${formatStatusTree(subtree).join("\n")}\n`);
	}

	return 0;
}

async function listTasksOrThrow(
	deps: Pick<StatCommandDependencies, "listTasks">,
	cwd: string
) {
	const response = await deps.listTasks(cwd);
	if (response.error || !response.data || !isTasksResponse(response.data)) {
		throw new Error("failed to load tasks");
	}
	return response.data.tasks;
}

async function listTaskRunsOrThrow(
	deps: Pick<StatCommandDependencies, "listTaskRuns">,
	cwd: string
) {
	const response = await deps.listTaskRuns(cwd);
	if (
		response.error ||
		!response.data ||
		!isTaskRunsResponse(response.data)
	) {
		throw new Error("failed to load task runs");
	}
	return response.data.taskRuns;
}

interface TaskStatusTreeNode {
	task: string;
	status: Exclude<DisplayTaskStatus, undefined> | null;
	icon: string;
	children: TaskStatusTreeNode[];
}

function buildTaskStatusTree(
	tasks: Record<string, Task>,
	displayStatusByTaskKey: Map<string, DisplayTaskStatus>,
	rootTaskKey: string
): TaskStatusTreeNode | null {
	if (!tasks[rootTaskKey]) {
		return null;
	}

	const buildNode = (taskKey: string): TaskStatusTreeNode => {
		const status = displayStatusByTaskKey.get(taskKey) ?? null;
		const icon = taskStatusDisplay(status ?? undefined).icon;
		const childKeys = getDirectChildTaskKeys(tasks, taskKey).sort((a, b) =>
			a.localeCompare(b)
		);
		return {
			task: taskKey,
			status,
			icon,
			children: childKeys.map((childKey) => buildNode(childKey)),
		};
	};

	return buildNode(rootTaskKey);
}

function formatStatusTree(root: TaskStatusTreeNode): string[] {
	const lines = [
		`${colorizeStatusIcon(root.status, root.icon)} ${root.task} (${formatStatusLabel(root.status)})`,
	];

	const visit = (
		node: TaskStatusTreeNode,
		prefix: string,
		isLast: boolean
	): void => {
		const connector = isLast ? "└─" : "├─";
		lines.push(
			`${prefix}${connector} ${colorizeStatusIcon(node.status, node.icon)} ${node.task} (${formatStatusLabel(node.status)})`
		);
		const nextPrefix = `${prefix}${isLast ? "   " : "│  "}`;
		node.children.forEach((child, index) => {
			visit(child, nextPrefix, index === node.children.length - 1);
		});
	};

	root.children.forEach((child, index) => {
		visit(child, "", index === root.children.length - 1);
	});

	return lines;
}

function formatStatusLabel(status: TaskStatusTreeNode["status"]): string {
	return status ?? "Idle";
}

function colorizeStatusIcon(
	status: TaskStatusTreeNode["status"],
	icon: string
): string {
	if (!status || status === "Cancelled") {
		return pc.dim(icon);
	}
	if (status === "Queued" || status === "Indeterminate") {
		return pc.yellow(icon);
	}
	if (status === "Running") {
		return pc.green(icon);
	}
	if (status === "Success") {
		return pc.blue(icon);
	}
	if (status === "Failed") {
		return pc.red(icon);
	}
	return icon;
}

function isTaskRunsResponse(
	data: unknown
): data is { taskRuns: TaskRunTreeNode[] } {
	return (
		typeof data === "object" &&
		data !== null &&
		"taskRuns" in data &&
		Array.isArray(data.taskRuns)
	);
}

function isTasksResponse(
	data: unknown
): data is { tasks: Record<string, Task> } {
	return (
		typeof data === "object" &&
		data !== null &&
		"tasks" in data &&
		typeof data.tasks === "object" &&
		data.tasks !== null
	);
}
