import type { Task, TaskRunTreeNode } from "@task-runner/client-js";
import type { DisplayTaskStatus } from "../types";
import { getDirectChildTaskKeys } from "./task-structure";

export function indexRunsByTaskKey(
	taskRuns: TaskRunTreeNode[]
): Map<string, TaskRunTreeNode> {
	const map = new Map<
		string,
		{ run: TaskRunTreeNode; lastActivityAt: number }
	>();
	const visit = (run: TaskRunTreeNode): number => {
		let lastActivityAt = run.updatedAt;
		for (const child of run.children) {
			lastActivityAt = Math.max(lastActivityAt, visit(child));
		}

		// The server stores canonical task keys on each run (including children),
		// so using run.task directly avoids duplicating parent prefixes.
		const existing = map.get(run.task);
		if (!existing || lastActivityAt > existing.lastActivityAt) {
			map.set(run.task, { run, lastActivityAt });
		}
		return lastActivityAt;
	};

	for (const run of taskRuns) {
		visit(run);
	}
	return new Map(
		[...map.entries()].map(([taskKey, value]) => [taskKey, value.run])
	);
}

export function upsertRunTreeNode(
	roots: TaskRunTreeNode[],
	updatedRun: TaskRunTreeNode
): TaskRunTreeNode[] {
	let replaced = false;
	const nextRoots = roots.map((root) => {
		const [nextRoot, didReplace] = replaceRunTreeNode(root, updatedRun);
		if (didReplace) {
			replaced = true;
		}
		return nextRoot;
	});

	if (!replaced) {
		nextRoots.push(updatedRun);
	}

	nextRoots.sort((a, b) => b.updatedAt - a.updatedAt);
	return nextRoots;
}

export function buildDisplayStatusByTaskKey(
	tasks: Record<string, Task>,
	runByTaskKey: Map<string, TaskRunTreeNode>
): Map<string, DisplayTaskStatus> {
	const cache = new Map<string, DisplayTaskStatus>();

	const resolveStatus = (taskKey: string): DisplayTaskStatus => {
		const cached = cache.get(taskKey);
		if (cached !== undefined || cache.has(taskKey)) {
			return cached;
		}

		const childKeys = getDirectChildTaskKeys(tasks, taskKey);
		if (childKeys.length === 0) {
			const ownStatus = runByTaskKey.get(taskKey)?.status;
			cache.set(taskKey, ownStatus);
			return ownStatus;
		}

		const childStatuses = childKeys.map((childKey) =>
			resolveStatus(childKey)
		);
		const first = childStatuses[0];
		const allAgree = childStatuses.every((status) => status === first);
		const status = allAgree ? first : "Indeterminate";
		cache.set(taskKey, status);
		return status;
	};

	for (const taskKey of Object.keys(tasks)) {
		resolveStatus(taskKey);
	}

	return cache;
}

export function canCancelRun(run: TaskRunTreeNode): boolean {
	if (run.status === "Cancelled") {
		return false;
	}

	const isLeafRun = run.children.length === 0;
	if (!isLeafRun) {
		return true;
	}

	return run.status !== "Success" && run.status !== "Failed";
}

function replaceRunTreeNode(
	node: TaskRunTreeNode,
	updatedRun: TaskRunTreeNode
): [TaskRunTreeNode, boolean] {
	if (node.id === updatedRun.id) {
		return [updatedRun, true];
	}

	let replaced = false;
	const children = node.children.map((child) => {
		const [nextChild, childReplaced] = replaceRunTreeNode(
			child,
			updatedRun
		);
		if (childReplaced) {
			replaced = true;
		}
		return nextChild;
	});

	if (!replaced) {
		return [node, false];
	}

	return [{ ...node, children }, true];
}
