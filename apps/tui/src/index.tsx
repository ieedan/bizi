import {
	createTaskRunnerApi,
	type Task,
	type TaskRunLogLine,
	type TaskRunLogsStreamMessage,
	type TaskRunTreeNode,
} from "@getbizi/client";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import {
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { resolveCliMode } from "./commands/cli";
import {
	QuitConfirmationDialog,
	type RunningTaskRow,
} from "./components/quit-confirmation-dialog";
import { RunDetailsPanel } from "./components/run-details-panel";
import { StatusFooter } from "./components/status-footer";
import { TaskTreePanel } from "./components/task-tree-panel";
import { AppContextProvider } from "./lib/app-context";
import type { CliOptions } from "./lib/args";
import {
	isJumpParentsBackwardShortcut,
	isJumpParentsForwardShortcut,
} from "./lib/keyboard-shortcuts";
import { resolveTaskLogColor } from "./lib/logs";
import {
	buildDisplayStatusByTaskKey,
	canCancelRun,
	indexRunsByTaskKey,
	upsertRunTreeNode,
} from "./lib/task-runs";
import {
	buildTaskTree,
	findNextParentTaskIndex,
	findPreviousParentTaskIndex,
	flattenTaskRows,
	getDirectChildTaskKeys,
} from "./lib/task-structure";
import type { LogMode } from "./types";

const api = createTaskRunnerApi({ port: 7436 });
const argv = process.argv.slice(2);
let cliOptions: CliOptions = { cwd: process.cwd() };
let cwd = cliOptions.cwd;
const isMacOs = process.platform === "darwin";

function App() {
	const renderer = useRenderer();

	const [tasks, setTasks] = createSignal<Record<string, Task>>({});
	const [taskRuns, setTaskRuns] = createSignal<TaskRunTreeNode[]>([]);
	const [selectedIndex, setSelectedIndex] = createSignal(0);
	const [logs, setLogs] = createSignal<TaskRunLogLine[]>([]);
	const [logMode, setLogMode] = createSignal<LogMode>("aggregate");
	const [focusedPane, setFocusedPane] = createSignal<"tasks" | "logs">(
		"tasks"
	);
	const [taskSearchQuery, setTaskSearchQuery] = createSignal("");
	const [isTaskSearchFocused, setIsTaskSearchFocused] = createSignal(false);
	const [suppressNextTaskSearchSlash, setSuppressNextTaskSearchSlash] =
		createSignal(false);
	const [showTaskSearchError, setShowTaskSearchError] = createSignal(false);
	const [showQuitConfirmation, setShowQuitConfirmation] = createSignal(false);
	const [isCancellingBeforeExit, setIsCancellingBeforeExit] =
		createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

	const taskTree = createMemo(() => buildTaskTree(tasks()));
	const taskRows = createMemo(() => flattenTaskRows(taskTree()));
	const runByTaskKey = createMemo(() => indexRunsByTaskKey(taskRuns()));
	const displayStatusByTaskKey = createMemo(() =>
		buildDisplayStatusByTaskKey(tasks(), runByTaskKey())
	);
	const rootRunIdsKey = createMemo(() =>
		taskRuns()
			.map((run) => run.id)
			.sort()
			.join("|")
	);
	const selectedRow = createMemo(() => taskRows()[selectedIndex()] ?? null);
	const selectedRun = createMemo(() => {
		const row = selectedRow();
		if (!row) {
			return undefined;
		}
		return runByTaskKey().get(row.key);
	});
	const selectedRunId = createMemo(() => selectedRun()?.id ?? null);
	const selectedRunRevisionKey = createMemo(() => {
		const run = selectedRun();
		if (!run) {
			return null;
		}
		return `${run.id}:${run.updatedAt}:${run.status}`;
	});
	const selectedDisplayStatus = createMemo(() => {
		const row = selectedRow();
		if (!row) {
			return undefined;
		}
		return displayStatusByTaskKey().get(row.key);
	});
	const selectedWaitingOn = createMemo(
		() => selectedRun()?.waitingOn ?? null
	);
	const selectedIsSubtask = createMemo(() => (selectedRow()?.depth ?? 0) > 0);
	const hasTaskSelection = createMemo(() => selectedRow() !== null);
	const canNavigateTasks = createMemo(() => taskRows().length > 0);
	const canJumpParentTasks = createMemo(() => taskTree().length > 1);
	const selectedRunAction = createMemo<"run" | "restart">(() => {
		if (selectedIsSubtask()) {
			return selectedRun() ? "restart" : "run";
		}

		const run = selectedRun();
		if (!run) {
			return "run";
		}

		const displayStatus = selectedDisplayStatus();
		if (displayStatus === "Success" || displayStatus === "Failed") {
			return "run";
		}

		return "restart";
	});

	const selectedCommand = createMemo(() => {
		const row = selectedRow();
		if (!row) {
			return null;
		}
		return tasks()[row.key]?.command ?? null;
	});
	const selectedHasChildren = createMemo(() => {
		const row = selectedRow();
		if (!row) {
			return false;
		}
		return getDirectChildTaskKeys(tasks(), row.key).length > 0;
	});
	const selectedHasCommand = createMemo(() => selectedCommand() !== null);
	const canToggleLogMode = createMemo(
		() => selectedHasChildren() && selectedHasCommand()
	);
	const selectedUsesAggregateLogs = createMemo(() => {
		if (!selectedHasChildren()) {
			return false;
		}
		if (!selectedHasCommand()) {
			return true;
		}
		return logMode() === "aggregate";
	});
	const canCancelSelected = createMemo(() => {
		const run = selectedRun();
		if (!run) {
			return false;
		}
		return canCancelRun(run);
	});
	const runningTaskRows = createMemo<RunningTaskRow[]>(() =>
		taskRows().flatMap((row) => {
			const status = runByTaskKey().get(row.key)?.status;
			if (status !== "Running" && status !== "Queued") {
				return [];
			}
			return [{ key: row.key, depth: row.depth, status }];
		})
	);
	const hasRunningTasks = createMemo(() => runningTaskRows().length > 0);
	const isLogViewFocused = createMemo(() => focusedPane() === "logs");
	const logTaskTagWidth = createMemo(() => {
		const longestTaskName = logs().reduce(
			(max, line) => Math.max(max, line.task.length),
			0
		);
		return Math.min(40, Math.max(10, longestTaskName + 3));
	});
	const logColorByTaskKey = createMemo<Record<string, string>>(() => {
		const map: Record<string, string> = {};
		for (const [taskKey, task] of Object.entries(tasks())) {
			const resolvedColor = resolveTaskLogColor(task.color);
			if (resolvedColor) {
				map[taskKey] = resolvedColor;
			}
		}
		return map;
	});

	createEffect(() => {
		const rows = taskRows();
		if (rows.length === 0) {
			setSelectedIndex(0);
			return;
		}
		if (selectedIndex() >= rows.length) {
			setSelectedIndex(rows.length - 1);
		}
	});

	async function refreshTasks() {
		const { data, error } = await api.listTasks(cwd);
		if (error || !data || !("tasks" in data)) {
			setErrorMessage("failed to load tasks");
			return;
		}
		setErrorMessage(null);
		setTasks(data.tasks);
	}

	async function refreshRuns() {
		const { data, error } = await api.listTaskRuns(cwd);
		if (error || !data || !("taskRuns" in data)) {
			setErrorMessage("failed to load task runs");
			return;
		}
		setErrorMessage(null);
		setTaskRuns(data.taskRuns);
	}

	async function runSelectedTask() {
		const row = selectedRow();
		if (!row) {
			return;
		}
		await runTaskByKey(row.key);
	}

	async function restartSelectedRun() {
		const run = selectedRun();
		if (!run) {
			return;
		}
		await restartRunById(run.id);
	}

	async function runTaskByKey(taskKey: string) {
		await api.runTask(taskKey, cwd);
		await refreshRuns();
	}

	async function restartRunById(runId: string) {
		setLogs([]);
		await api.restartTask(runId);
		await refreshRuns();
	}

	async function cancelSelectedRun() {
		const run = selectedRun();
		if (!run) {
			return;
		}
		if (!canCancelRun(run)) {
			return;
		}
		await api.cancelTask(run.id);
		await refreshRuns();
	}

	function handleQuitKey(key: { name: string; ctrl?: boolean }) {
		return key.name === "q" || (key.ctrl && key.name === "c");
	}

	async function cancelRunningTasksBeforeExit() {
		if (isCancellingBeforeExit()) {
			return;
		}
		setIsCancellingBeforeExit(true);
		const taskKeys = runningTaskRows().map((row) => row.key);
		await Promise.allSettled(
			taskKeys.map((taskKey) => {
				const run = runByTaskKey().get(taskKey);
				if (!run) {
					return Promise.resolve();
				}
				return api.cancelTask(run.id);
			})
		);
		renderer.destroy();
	}

	function requestQuit() {
		if (hasRunningTasks()) {
			setShowQuitConfirmation(true);
			return;
		}
		renderer.destroy();
	}

	function handleQuitConfirmationKeys() {
		if (!showQuitConfirmation()) {
			return false;
		}
		return true;
	}

	function focusTaskSearch() {
		setFocusedPane("tasks");
		setIsTaskSearchFocused(true);
	}

	function clearTaskSearch() {
		setTaskSearchQuery("");
		setShowTaskSearchError(false);
		setIsTaskSearchFocused(false);
	}

	function handleTaskSearchShortcut(key: { name: string }) {
		if (key.name !== "/" || isTaskSearchFocused()) {
			return false;
		}
		setSuppressNextTaskSearchSlash(true);
		focusTaskSearch();
		return true;
	}

	function resolveRowAction(
		taskKey: string,
		depth: number
	): "run" | "restart" {
		const run = runByTaskKey().get(taskKey);
		if (depth > 0) {
			return run ? "restart" : "run";
		}
		if (!run) {
			return "run";
		}
		const displayStatus = displayStatusByTaskKey().get(taskKey);
		if (displayStatus === "Success" || displayStatus === "Failed") {
			return "run";
		}
		return "restart";
	}

	async function runExactTaskSearchMatch(rowIndex: number) {
		const row = taskRows()[rowIndex];
		if (!row) {
			return;
		}
		setSelectedIndex(rowIndex);
		const action = resolveRowAction(row.key, row.depth);
		if (action === "run") {
			await runTaskByKey(row.key);
			clearTaskSearch();
			return;
		}
		const run = runByTaskKey().get(row.key);
		if (run) {
			await restartRunById(run.id);
		} else {
			await runTaskByKey(row.key);
		}
		clearTaskSearch();
	}

	function handleTaskSearchSubmit() {
		const normalizedQuery = taskSearchQuery().trim().toLowerCase();
		if (!normalizedQuery) {
			setShowTaskSearchError(false);
			return;
		}
		const rowIndex = taskRows().findIndex(
			(row) =>
				row.key.toLowerCase() === normalizedQuery ||
				row.label.toLowerCase() === normalizedQuery
		);
		if (rowIndex < 0) {
			setShowTaskSearchError(true);
			return;
		}
		setShowTaskSearchError(false);
		runExactTaskSearchMatch(rowIndex).catch(() => undefined);
	}

	function handleTaskSearchInputKeys(key: { name: string }) {
		if (!isTaskSearchFocused()) {
			return false;
		}
		if (key.name === "down" || key.name === "j") {
			if (taskRows().length > 0) {
				setSelectedIndex(0);
				setIsTaskSearchFocused(false);
				setFocusedPane("tasks");
			}
			return true;
		}
		if (key.name === "/") {
			setSuppressNextTaskSearchSlash(true);
			return true;
		}
		if (key.name === "escape") {
			clearTaskSearch();
			return true;
		}
		if (key.name === "enter" || key.name === "return") {
			handleTaskSearchSubmit();
			return true;
		}
		return false;
	}

	function handlePaneNavigation(key: { name: string }) {
		if ((key.name === "right" || key.name === "l") && !isLogViewFocused()) {
			setFocusedPane("logs");
			return true;
		}
		if ((key.name === "left" || key.name === "h") && isLogViewFocused()) {
			setFocusedPane("tasks");
			return true;
		}
		return false;
	}

	function handleTaskNavigation(key: {
		name: string;
		ctrl?: boolean;
		option?: boolean;
	}) {
		const rows = taskRows();
		if (rows.length === 0) {
			return false;
		}
		if (isLogViewFocused()) {
			return ["up", "k", "down", "j"].includes(key.name);
		}
		if (isJumpParentsBackwardShortcut(key, isMacOs)) {
			setSelectedIndex((idx) =>
				findPreviousParentTaskIndex(taskRows(), idx)
			);
			return true;
		}
		if (key.name === "up" || key.name === "k") {
			if (selectedIndex() === 0) {
				focusTaskSearch();
				return true;
			}
			setSelectedIndex((idx) => Math.max(0, idx - 1));
			return true;
		}
		if (isJumpParentsForwardShortcut(key, isMacOs)) {
			setSelectedIndex((idx) => findNextParentTaskIndex(taskRows(), idx));
			return true;
		}
		if (key.name === "down" || key.name === "j") {
			setSelectedIndex((idx) => Math.min(rows.length - 1, idx + 1));
			return true;
		}
		return false;
	}

	function handleActionKeys(key: { name: string }) {
		if (key.name === "m") {
			if (canToggleLogMode()) {
				setLogMode((mode) =>
					mode === "aggregate" ? "selected" : "aggregate"
				);
			}
			return true;
		}
		if (key.name === "r") {
			if (selectedRunAction() === "restart") {
				restartSelectedRun().catch(() => undefined);
			} else {
				runSelectedTask().catch(() => undefined);
			}
			return true;
		}
		if (key.name === "c") {
			cancelSelectedRun().catch(() => undefined);
			return true;
		}
		return false;
	}

	useKeyboard((key) => {
		if (key.eventType !== "press") {
			return;
		}
		if (handleQuitConfirmationKeys()) {
			return;
		}
		if (handleQuitKey(key)) {
			requestQuit();
			return;
		}
		if (handleTaskSearchShortcut(key)) {
			return;
		}
		if (isTaskSearchFocused()) {
			handleTaskSearchInputKeys(key);
			return;
		}
		if (handlePaneNavigation(key)) {
			return;
		}
		if (taskRows().length === 0) {
			return;
		}
		if (handleTaskNavigation(key)) {
			return;
		}
		handleActionKeys(key);
	});

	onMount(() => {
		refreshTasks().catch(() => undefined);
		refreshRuns().catch(() => undefined);
		const interval = setInterval(() => {
			refreshRuns().catch(() => undefined);
		}, 1200);
		onCleanup(() => clearInterval(interval));
	});

	createEffect(() => {
		const runIdsKey = rootRunIdsKey();
		if (!runIdsKey) {
			return;
		}
		const runIds = runIdsKey.split("|").filter(Boolean);

		const sockets = runIds.map((runId) =>
			api.subscribeTaskRun(runId, {
				onMessage: (payload) => {
					if (!("taskRun" in payload)) {
						return;
					}
					setTaskRuns((current) =>
						upsertRunTreeNode(current, payload.taskRun)
					);
				},
			})
		);

		onCleanup(() => {
			for (const socket of sockets) {
				socket.close();
			}
		});
	});

	createEffect(() => {
		const row = selectedRow();
		const runId = selectedRunId();
		selectedRunRevisionKey();
		const includeChildren = selectedUsesAggregateLogs();
		if (!(row && runId)) {
			setLogs([]);
			return;
		}

		let closed = false;

		const logsSocket = api.subscribeTaskLogs(
			runId,
			{
				onMessage: (payload: TaskRunLogsStreamMessage) => {
					if (closed) {
						return;
					}
					if (payload.type === "snapshot") {
						setLogs(payload.logs);
						return;
					}
					if (payload.type === "log") {
						setLogs((prev) => [...prev, payload.log]);
						return;
					}
					setErrorMessage(payload.message);
				},
				onError: () => {
					/* intentional no-op */
				},
				onClose: () => {
					/* intentional no-op */
				},
			},
			{ includeChildren }
		);

		const runSocket = api.subscribeTaskRun(runId, {
			onMessage: () => {
				if (!closed) {
					refreshRuns().catch(() => undefined);
				}
			},
			onError: () => {
				/* intentional no-op */
			},
		});

		onCleanup(() => {
			closed = true;
			logsSocket.close();
			runSocket.close();
		});
	});

	return (
		<AppContextProvider cliOptions={cliOptions} isMacOs={isMacOs}>
			<box flexDirection="column" height="100%" width="100%">
				<box flexDirection="row" flexGrow={1}>
					<TaskTreePanel
						displayStatusByTaskKey={displayStatusByTaskKey()}
						hasTaskSearchError={showTaskSearchError()}
						isTaskSearchFocused={isTaskSearchFocused()}
						onTaskSearchInput={(value) => {
							let normalizedValue = value;
							if (suppressNextTaskSearchSlash()) {
								normalizedValue = normalizedValue.replace(
									"/",
									""
								);
								setSuppressNextTaskSearchSlash(false);
							}
							if (normalizedValue.startsWith("/")) {
								normalizedValue = normalizedValue.slice(1);
							}
							setShowTaskSearchError(false);
							setTaskSearchQuery(normalizedValue);
						}}
						selectedTaskKey={selectedRow()?.key ?? null}
						taskSearchQuery={taskSearchQuery()}
						taskTree={taskTree()}
					/>
					<RunDetailsPanel
						isFocused={isLogViewFocused()}
						logColorByTaskKey={logColorByTaskKey()}
						logs={logs()}
						logTaskTagWidth={logTaskTagWidth()}
						selectedRunStatus={selectedRun()?.status ?? null}
						selectedRunUpdatedAt={selectedRun()?.updatedAt ?? null}
						selectedStatus={selectedDisplayStatus() ?? null}
						waitingOn={selectedWaitingOn()}
					/>
				</box>
				<StatusFooter
					canCancel={canCancelSelected()}
					canJumpParentTasks={canJumpParentTasks()}
					canNavigateTasks={canNavigateTasks()}
					canRunOrRestart={hasTaskSelection()}
					canToggleLogMode={canToggleLogMode()}
					errorMessage={errorMessage()}
					logMode={logMode()}
					runAction={selectedRunAction()}
				/>
				<Show when={showQuitConfirmation()}>
					<QuitConfirmationDialog
						isCancelling={isCancellingBeforeExit()}
						onConfirm={(action) => {
							if (action === "cancelAll") {
								cancelRunningTasksBeforeExit().catch(() =>
									renderer.destroy()
								);
							} else {
								renderer.destroy();
							}
						}}
						runningTasks={runningTaskRows()}
					/>
				</Show>
			</box>
		</AppContextProvider>
	);
}

async function main() {
	const mode = await resolveCliMode(argv, cliOptions);
	if (mode.mode === "cli") {
		process.exit(mode.exitCode);
	}

	cliOptions = mode.cliOptions;
	cwd = cliOptions.cwd;
	render(() => <App />);
}

main().catch((error: unknown) => {
	if (error instanceof Error) {
		process.stderr.write(`${error.message}\n`);
	} else {
		process.stderr.write("Unknown CLI error.\n");
	}
	process.exit(1);
});
