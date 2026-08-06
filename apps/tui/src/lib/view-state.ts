/**
 * Derived view state for the TUI.
 *
 * Everything the interactive UI computes from `tasks` + `taskRuns` lives here
 * as a pure function so it can be tested without a renderer, and so the Rust
 * client can be held to the same shared conformance cases.
 */
import type { Task, TaskRunLogLine, TaskRunTreeNode } from "@getbizi/client";
import type { DisplayTaskStatus, LogMode, TaskRow } from "../types";
import { formatElapsedDuration, resolveTaskLogColor } from "./logs";
import { canCancelRun } from "./task-runs";
import { getDirectChildTaskKeys } from "./task-structure";

export type RunAction = "run" | "restart";

export type RunStatus = TaskRunTreeNode["status"];

export interface RunningTaskRow {
	key: string;
	depth: number;
	status: "Queued" | "Running";
}

export interface FooterAction {
	key: string;
	label: string;
}

/** The indexes every selector below reads from. */
export interface TaskViewContext {
	tasks: Record<string, Task>;
	runByTaskKey: Map<string, TaskRunTreeNode>;
	displayStatusByTaskKey: Map<string, DisplayTaskStatus>;
}

export function taskCommand(
	tasks: Record<string, Task>,
	taskKey: string | null
): string | null {
	if (taskKey === null) {
		return null;
	}
	return tasks[taskKey]?.command ?? null;
}

export function taskHasCommand(
	tasks: Record<string, Task>,
	taskKey: string | null
): boolean {
	return taskCommand(tasks, taskKey) !== null;
}

export function taskHasChildren(
	tasks: Record<string, Task>,
	taskKey: string | null
): boolean {
	if (taskKey === null) {
		return false;
	}
	return getDirectChildTaskKeys(tasks, taskKey).length > 0;
}

/**
 * `r` runs a task that has never run (or has finished), and restarts anything
 * else. Subtasks are always a restart because they cannot be started on their
 * own — the server links them to a parent run.
 */
export function resolveRowAction(
	context: TaskViewContext,
	taskKey: string,
	depth: number
): RunAction {
	if (depth > 0) {
		return "restart";
	}
	if (!context.runByTaskKey.has(taskKey)) {
		return "run";
	}
	const displayStatus = context.displayStatusByTaskKey.get(taskKey);
	if (displayStatus === "Success" || displayStatus === "Failed") {
		return "run";
	}
	return "restart";
}

export function selectedRunAction(
	context: TaskViewContext,
	row: TaskRow | null
): RunAction {
	if (!row) {
		return "run";
	}
	return resolveRowAction(context, row.key, row.depth);
}

/**
 * The status shown next to the elapsed time. Grouping tasks (children, no
 * command of their own) report their aggregated status, and drop the block
 * entirely while their children disagree.
 */
export function selectedFooterStatus(
	context: TaskViewContext,
	taskKey: string | null
): RunStatus | null {
	if (taskKey === null) {
		return null;
	}
	if (
		taskHasChildren(context.tasks, taskKey) &&
		!taskHasCommand(context.tasks, taskKey)
	) {
		const displayStatus = context.displayStatusByTaskKey.get(taskKey);
		if (displayStatus === "Indeterminate" || !displayStatus) {
			return null;
		}
		return displayStatus;
	}
	return context.runByTaskKey.get(taskKey)?.status ?? null;
}

/** Only a task that has both children and its own command has two log views. */
export function canToggleLogMode(
	tasks: Record<string, Task>,
	taskKey: string | null
): boolean {
	return taskHasChildren(tasks, taskKey) && taskHasCommand(tasks, taskKey);
}

export function usesAggregateLogs(
	tasks: Record<string, Task>,
	taskKey: string | null,
	logMode: LogMode
): boolean {
	if (!taskHasChildren(tasks, taskKey)) {
		return false;
	}
	if (!taskHasCommand(tasks, taskKey)) {
		return true;
	}
	return logMode === "aggregate";
}

export function canCancelSelected(
	context: TaskViewContext,
	taskKey: string | null
): boolean {
	if (taskKey === null) {
		return false;
	}
	const run = context.runByTaskKey.get(taskKey);
	if (!run) {
		return false;
	}
	return canCancelRun(run);
}

export function runningTaskRows(
	taskRows: TaskRow[],
	runByTaskKey: Map<string, TaskRunTreeNode>
): RunningTaskRow[] {
	return taskRows.flatMap((row) => {
		const status = runByTaskKey.get(row.key)?.status;
		if (status !== "Running" && status !== "Queued") {
			return [];
		}
		return [{ key: row.key, depth: row.depth, status }];
	});
}

export function hasRunningTasks(
	taskRows: TaskRow[],
	runByTaskKey: Map<string, TaskRunTreeNode>
): boolean {
	return runningTaskRows(taskRows, runByTaskKey).length > 0;
}

/** Width of the `[task-name] ` gutter in the log view. */
export function logTaskTagWidth(logs: Pick<TaskRunLogLine, "task">[]): number {
	const longestTaskName = logs.reduce(
		(max, line) => Math.max(max, [...line.task].length),
		0
	);
	return Math.min(40, Math.max(10, longestTaskName + 3));
}

export function buildLogColorByTaskKey(
	tasks: Record<string, Task>
): Record<string, string> {
	const map: Record<string, string> = {};
	for (const [taskKey, task] of Object.entries(tasks)) {
		const resolvedColor = resolveTaskLogColor(task.color);
		if (resolvedColor) {
			map[taskKey] = resolvedColor;
		}
	}
	return map;
}

export function clampSelectedIndex(
	rowCount: number,
	selectedIndex: number
): number {
	if (rowCount === 0) {
		return 0;
	}
	if (selectedIndex >= rowCount) {
		return rowCount - 1;
	}
	return Math.max(0, selectedIndex);
}

export interface FooterActionsInput {
	hasSelection: boolean;
	runAction: RunAction;
	canCancel: boolean;
	canToggleLogMode: boolean;
	logMode: LogMode;
}

export function footerActions(input: FooterActionsInput): FooterAction[] {
	const parts: FooterAction[] = [{ key: "/", label: "find/run" }];
	if (input.hasSelection) {
		parts.push({ key: "r", label: input.runAction });
	}
	if (input.canCancel) {
		parts.push({ key: "c", label: "cancel" });
	}
	if (input.canToggleLogMode) {
		parts.push({ key: "m", label: `logs: ${input.logMode}` });
	}
	parts.push({ key: "ctrl+c", label: "copy" });
	parts.push({ key: "q", label: "quit" });
	return parts;
}

export function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export interface RunStatusTextInput {
	footerStatus: RunStatus | null;
	displayStatusLabel: string | null;
	waitingOn: string | null;
	selectedRunUpdatedAt: number | null;
	firstLogTimestamp: number | null;
	lastLogTimestamp: number | null;
	nowMs: number;
}

/** The elapsed-time sentence shown beside the run status icon. */
export function runStatusText(input: RunStatusTextInput): string {
	const runStart =
		input.firstLogTimestamp ?? input.selectedRunUpdatedAt ?? input.nowMs;
	const runEnd =
		input.footerStatus === "Running" || input.footerStatus === "Queued"
			? input.nowMs
			: (input.lastLogTimestamp ??
				input.selectedRunUpdatedAt ??
				input.nowMs);
	const runDurationMs = runEnd - runStart;

	const waitingOn = collapseWhitespace(input.waitingOn ?? "");
	if (waitingOn.length > 0) {
		const waitingDurationMs =
			input.nowMs - (input.selectedRunUpdatedAt ?? runStart);
		return `Waiting on ${waitingOn} for ${formatElapsedDuration(waitingDurationMs)}`;
	}

	if (input.footerStatus === "Running") {
		return `Running for ${formatElapsedDuration(runDurationMs)}`;
	}
	if (input.footerStatus === "Cancelled") {
		return `Canceled after ${formatElapsedDuration(runDurationMs)}`;
	}
	if (input.footerStatus === "Success") {
		return `Succeeded in ${formatElapsedDuration(runDurationMs)}`;
	}
	if (input.footerStatus === "Failed") {
		return `Failed after ${formatElapsedDuration(runDurationMs)}`;
	}
	if (input.footerStatus === "Queued") {
		return `Queued for ${formatElapsedDuration(runDurationMs)}`;
	}

	return collapseWhitespace(input.displayStatusLabel ?? "Idle");
}
