import {
    createTaskRunnerApi,
    type Task,
    type TaskRunLogLine,
    type TaskRunLogsStreamMessage,
    type TaskRunTreeNode,
} from "@task-runner/client-js";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { RunDetailsPanel } from "./components/RunDetailsPanel";
import { StatusFooter } from "./components/StatusFooter";
import { TaskTreePanel } from "./components/TaskTreePanel";
import { AppContextProvider } from "./lib/app-context";
import { parseCliOptions } from "./lib/args";
import {
    isJumpParentsBackwardShortcut,
    isJumpParentsForwardShortcut,
} from "./lib/keyboard-shortcuts";
import {
    buildTaskTree,
    findNextParentTaskIndex,
    findPreviousParentTaskIndex,
    flattenTaskRows,
    getDirectChildTaskKeys,
} from "./lib/task-structure";
import { buildDisplayStatusByTaskKey, canCancelRun, indexRunsByTaskKey, upsertRunTreeNode } from "./lib/task-runs";
import type { LogMode } from "./types";

const api = createTaskRunnerApi({ port: 7436 });
const cliOptions = parseCliOptions(process.argv.slice(2));
const cwd = cliOptions.cwd;
const isMacOs = process.platform === "darwin";

function App() {
    const renderer = useRenderer();

    const [tasks, setTasks] = createSignal<Record<string, Task>>({});
    const [taskRuns, setTaskRuns] = createSignal<TaskRunTreeNode[]>([]);
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    const [logs, setLogs] = createSignal<TaskRunLogLine[]>([]);
    const [logMode, setLogMode] = createSignal<LogMode>("aggregate");
    const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

    const taskTree = createMemo(() => buildTaskTree(tasks()));
    const taskRows = createMemo(() => flattenTaskRows(taskTree()));
    const runByTaskKey = createMemo(() => indexRunsByTaskKey(taskRuns()));
    const displayStatusByTaskKey = createMemo(() => buildDisplayStatusByTaskKey(tasks(), runByTaskKey()));
    const rootRunIdsKey = createMemo(() => taskRuns().map((run) => run.id).sort().join("|"));
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
    const canToggleLogMode = createMemo(() => selectedHasChildren() && selectedCommand() !== null);
    const canCancelSelected = createMemo(() => {
        const run = selectedRun();
        if (!run) {
            return false;
        }
        return canCancelRun(run);
    });
    const logLineNumberWidth = createMemo(() => Math.max(4, String(logs().length).length));
    const logTaskTagWidth = createMemo(() => {
        const longestTaskName = logs().reduce((max, line) => Math.max(max, line.task.length), 0);
        return Math.min(40, Math.max(10, longestTaskName + 3));
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

    createEffect(() => {
        if (!canToggleLogMode() && logMode() === "aggregate") {
            setLogMode("selected");
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
        await api.runTask(row.key, cwd);
        await refreshRuns();
    }

    async function restartSelectedRun() {
        const run = selectedRun();
        if (!run) {
            return;
        }
        setLogs([]);
        await api.restartTask(run.id);
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

    useKeyboard((key) => {
        if (key.eventType !== "press") {
            return;
        }

        if (key.name === "q" || (key.ctrl && key.name === "c")) {
            renderer.destroy();
            return;
        }

        const rows = taskRows();
        if (rows.length === 0) {
            return;
        }

        if (isJumpParentsBackwardShortcut(key, isMacOs)) {
            setSelectedIndex((idx) => findPreviousParentTaskIndex(taskRows(), idx));
            return;
        }
        if (key.name === "up" || key.name === "k") {
            setSelectedIndex((idx) => Math.max(0, idx - 1));
            return;
        }
        if (isJumpParentsForwardShortcut(key, isMacOs)) {
            setSelectedIndex((idx) => findNextParentTaskIndex(taskRows(), idx));
            return;
        }
        if (key.name === "down" || key.name === "j") {
            setSelectedIndex((idx) => Math.min(rows.length - 1, idx + 1));
            return;
        }
        if (key.name === "l") {
            if (!canToggleLogMode()) {
                return;
            }
            setLogMode((mode) => (mode === "aggregate" ? "selected" : "aggregate"));
            return;
        }
        if (key.name === "r") {
            if (selectedRunAction() === "restart") {
                void restartSelectedRun();
                return;
            }
            void runSelectedTask();
            return;
        }
        if (key.name === "c") {
            void cancelSelectedRun();
        }
    });

    onMount(() => {
        void refreshTasks();
        void refreshRuns();
        const interval = setInterval(() => {
            void refreshRuns();
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
                    setTaskRuns((current) => upsertRunTreeNode(current, payload.taskRun));
                },
            }),
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
        const includeChildren = canToggleLogMode() && logMode() === "aggregate";
        if (!row || !runId) {
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
                onError: () => {},
                onClose: () => {},
            },
            { includeChildren },
        );

        const runSocket = api.subscribeTaskRun(runId, {
            onMessage: () => {
                if (!closed) {
                    void refreshRuns();
                }
            },
            onError: () => {},
        });

        onCleanup(() => {
            closed = true;
            logsSocket.close();
            runSocket.close();
        });
    });

    return (
        <AppContextProvider isMacOs={isMacOs} cliOptions={cliOptions}>
            <box flexDirection="column" height="100%" width="100%">
                <box flexDirection="row" flexGrow={1}>
                    <TaskTreePanel
                        taskTree={taskTree()}
                        selectedTaskKey={selectedRow()?.key ?? null}
                        displayStatusByTaskKey={displayStatusByTaskKey()}
                    />
                    <RunDetailsPanel
                        selectedTaskKey={selectedRow()?.key ?? null}
                        selectedCommand={selectedCommand()}
                        logs={logs()}
                        logLineNumberWidth={logLineNumberWidth()}
                        logTaskTagWidth={logTaskTagWidth()}
                    />
                </box>
                <StatusFooter
                    errorMessage={errorMessage()}
                    canNavigateTasks={canNavigateTasks()}
                    canJumpParentTasks={canJumpParentTasks()}
                    canRunOrRestart={hasTaskSelection()}
                    runAction={selectedRunAction()}
                    canCancel={canCancelSelected()}
                    canToggleLogMode={canToggleLogMode()}
                />
            </box>
        </AppContextProvider>
    );
}

render(() => <App />);
