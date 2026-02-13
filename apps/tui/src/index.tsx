import {
    createTaskRunnerApi,
    type Task,
    type TaskRunLogLine,
    type TaskRunLogsStreamMessage,
    type TaskRunTreeNode,
} from "../../../packages/client-js/src/index";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

type TaskRow = {
    key: string;
    label: string;
    depth: number;
};

type LogMode = "aggregate" | "selected";
type DisplayTaskStatus = TaskRunTreeNode["status"] | "Indeterminate" | undefined;
type TaskGroup = {
    rootKey: string;
    rootRow: TaskRow | null;
    children: TaskRow[];
};

const api = createTaskRunnerApi({ port: 7436 });
const cwd = parseCwdArg(process.argv.slice(2)) ?? process.cwd();
const isMacOs = process.platform === "darwin";

function App() {
    const renderer = useRenderer();

    const [tasks, setTasks] = createSignal<Record<string, Task>>({});
    const [taskRuns, setTaskRuns] = createSignal<TaskRunTreeNode[]>([]);
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    const [logs, setLogs] = createSignal<TaskRunLogLine[]>([]);
    const [logMode, setLogMode] = createSignal<LogMode>("aggregate");
    const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

    const taskRows = createMemo(() => flattenTaskRows(tasks()));
    const taskGroups = createMemo(() => groupTaskRows(taskRows()));
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
    const selectedDisplayStatus = createMemo(() => {
        const row = selectedRow();
        if (!row) {
            return undefined;
        }
        return displayStatusByTaskKey().get(row.key);
    });
    const selectedIsSubtask = createMemo(() => (selectedRow()?.depth ?? 0) > 0);

    const selectedCommand = createMemo(() => {
        const row = selectedRow();
        if (!row) {
            return null;
        }
        return tasks()[row.key]?.command ?? null;
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

    const refreshTasks = async () => {
        const { data, error } = await api.listTasks(cwd);
        if (error || !data || !("tasks" in data)) {
            setErrorMessage("failed to load tasks");
            return;
        }
        setErrorMessage(null);
        setTasks(data.tasks);
    };

    const refreshRuns = async () => {
        const { data, error } = await api.listTaskRuns(cwd);
        if (error || !data || !("taskRuns" in data)) {
            setErrorMessage("failed to load task runs");
            return;
        }
        setErrorMessage(null);
        setTaskRuns(data.taskRuns);
    };

    const runSelectedTask = async () => {
        const row = selectedRow();
        if (!row) {
            return;
        }
        await api.runTask(row.key, cwd);
        await refreshRuns();
    };

    const restartSelectedRun = async () => {
        const run = selectedRun();
        if (!run) {
            return;
        }
        await api.restartTask(run.id);
        await refreshRuns();
    };

    const cancelSelectedRun = async () => {
        const run = selectedRun();
        if (!run) {
            return;
        }
        await api.cancelTask(run.id);
        await refreshRuns();
    };

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

        if (isJumpParentsBackwardShortcut(key)) {
            setSelectedIndex((idx) => findPreviousParentTaskIndex(taskRows(), idx));
            return;
        }
        if (key.name === "up" || key.name === "k") {
            setSelectedIndex((idx) => Math.max(0, idx - 1));
            return;
        }
        if (isJumpParentsForwardShortcut(key)) {
            setSelectedIndex((idx) => findNextParentTaskIndex(taskRows(), idx));
            return;
        }
        if (key.name === "down" || key.name === "j") {
            setSelectedIndex((idx) => Math.min(rows.length - 1, idx + 1));
            return;
        }
        if (key.name === "l") {
            setLogMode((mode) => (mode === "aggregate" ? "selected" : "aggregate"));
            return;
        }
        if (key.name === "r" && key.shift) {
            void restartSelectedRun();
            return;
        }
        if (key.name === "r") {
            if (selectedIsSubtask()) {
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
        const includeChildren = logMode() === "aggregate";
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
        <box flexDirection="column" height="100%" width="100%">
            <box flexDirection="row" flexGrow={1}>
                <box
                    width={42}
                    border={["top", "left", "bottom"]}
                    borderColor="#666666"
                    customBorderChars={{
                        topLeft: "┌",
                        topRight: "┐",
                        bottomLeft: "├",
                        bottomRight: "┘",
                        horizontal: "─",
                        vertical: "│",
                        topT: "┬",
                        bottomT: "┴",
                        leftT: "├",
                        rightT: "┤",
                        cross: "┼",
                    }}
                    flexDirection="column"
                    paddingX={1}
                >
                    <scrollbox flexGrow={1} height="100%">
                        <For each={taskGroups()}>
                            {(group) => {
                                const selectedTaskKey = () => selectedRow()?.key;
                                const rootDisplayStatus = () =>
                                    displayStatusByTaskKey().get(group.rootKey) ??
                                    displayStatusByTaskKey().get(group.rootRow?.key ?? "");
                                const rootStatus = () =>
                                    taskStatusColor(rootDisplayStatus());
                                const rootSelected = () => selectedTaskKey() === group.rootRow?.key;
                                if (group.children.length === 0 && group.rootRow) {
                                    return (
                                        <box
                                            border
                                            borderStyle="rounded"
                                            borderColor={rootSelected() ? "#e6e6e6" : "#666666"}
                                            paddingLeft={1}
                                            paddingRight={1}
                                            height={3}
                                            alignItems="center"
                                            justifyContent="space-between"
                                            flexDirection="row"
                                        >
                                            <text>{group.rootRow.key}</text>
                                            <text fg={rootStatus()}>
                                                {taskStatusIcon(rootDisplayStatus())}
                                            </text>
                                        </box>
                                    );
                                }

                                return (
                                    <box
                                        border
                                        borderStyle="rounded"
                                        borderColor={rootSelected() ? "#e6e6e6" : "#666666"}
                                        paddingX={1}
                                        flexDirection="column"
                                    >
                                        <box
                                            flexDirection="row"
                                            justifyContent="space-between"
                                            alignItems="center"
                                        >
                                            <text>{group.rootKey}</text>
                                            <text fg={rootStatus()}>
                                                {taskStatusIcon(rootDisplayStatus())}
                                            </text>
                                        </box>
                                        <For each={group.children}>
                                            {(child, i) => {
                                                const childDisplayStatus = () =>
                                                    displayStatusByTaskKey().get(child.key);
                                                return (
                                                    <box
                                                        border
                                                        borderStyle="rounded"
                                                        borderColor={
                                                            selectedTaskKey() === child.key
                                                                ? "#e6e6e6"
                                                                : "#666666"
                                                        }
                                                        marginTop={i() === 0 ? 1 : 0}
                                                        paddingLeft={1}
                                                        paddingRight={1}
                                                        height={3}
                                                        alignItems="center"
                                                        justifyContent="space-between"
                                                        flexDirection="row"
                                                    >
                                                        <text>{child.key}</text>
                                                        <text fg={taskStatusColor(childDisplayStatus())}>
                                                            {taskStatusIcon(childDisplayStatus())}
                                                        </text>
                                                    </box>
                                                );
                                            }}
                                        </For>
                                    </box>
                                );
                            }}
                        </For>
                    </scrollbox>
                </box>

                <box
                    border
                    borderColor="#666666"
                    customBorderChars={{
                        topLeft: "┬",
                        topRight: "┐",
                        bottomLeft: "┴",
                        bottomRight: "┤",
                        horizontal: "─",
                        vertical: "│",
                        topT: "┬",
                        bottomT: "┴",
                        leftT: "├",
                        rightT: "┤",
                        cross: "┼",
                    }}
                    flexGrow={1}
                    flexDirection="column"
                    paddingX={1}
                >
                    <box flexDirection="row">
                        <text>cwd: {cwd}</text>
                    </box>
                    <box flexDirection="row">
                        <text>task: {selectedRow()?.key ?? "-"}</text>
                    </box>
                    <box flexDirection="row">
                        <text>command: {selectedCommand() ?? "(no command)"}</text>
                    </box>
                    <box flexGrow={1} marginTop={1}>
                        <scrollbox flexGrow={1} height="100%" stickyScroll stickyStart="bottom">
                            <For each={logs()}>
                                {(line, idx) => (
                                    <box flexDirection="row">
                                        <box width={logLineNumberWidth() + 1} flexShrink={0}>
                                            <text fg="#666666">
                                                {String(idx() + 1).padStart(logLineNumberWidth(), " ")}{" "}
                                            </text>
                                        </box>
                                        <box width={logTaskTagWidth()} flexShrink={0}>
                                            <text>{formatTaskTagForLog(line.task, logTaskTagWidth())}</text>
                                        </box>
                                        <box flexGrow={1}>
                                            <text>{sanitizeLogForDisplay(line.line)}</text>
                                        </box>
                                    </box>
                                )}
                            </For>
                        </scrollbox>
                    </box>
                </box>
            </box>

            <box border={["left", "right", "bottom"]} borderColor="#666666" paddingLeft={1}>
                <text>
                    arrows/jk move | jump parents: {isMacOs ? "option+up/down or option+k/j" : "ctrl+up/down or ctrl+k/j"} | r run (root) / restart (subtask) | R restart | c cancel | l log mode | q quit
                    {errorMessage() ? ` | error: ${errorMessage()}` : ""}
                </text>
            </box>
        </box>
    );
}

function parseCwdArg(argv: string[]): string | null {
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
            continue;
        }
        if (arg === "--cwd") {
            return argv[index + 1] ?? null;
        }
        if (arg.startsWith("--cwd=")) {
            return arg.slice("--cwd=".length);
        }
    }
    return null;
}

function formatTaskTagForLog(taskName: string, width: number): string {
    const minWidth = 4;
    const safeWidth = Math.max(minWidth, width);
    const suffix = "] ";
    const prefix = "[";
    const innerWidth = Math.max(1, safeWidth - prefix.length - suffix.length);
    const displayTaskName =
        taskName.length > innerWidth ? `${taskName.slice(0, Math.max(1, innerWidth - 1))}…` : taskName;
    return `${prefix}${displayTaskName}${suffix}`.padEnd(safeWidth, " ");
}

function flattenTaskRows(tasks: Record<string, Task>): TaskRow[] {
    return Object.keys(tasks)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => {
            const segments = key.split(":");
            return {
                key,
                label: segments[segments.length - 1] ?? key,
                depth: Math.max(0, segments.length - 1),
            };
        });
}

function groupTaskRows(taskRows: TaskRow[]): TaskGroup[] {
    const groups = new Map<string, TaskGroup>();

    for (const row of taskRows) {
        const rootKey = row.key.split(":")[0] ?? row.key;
        const existing = groups.get(rootKey);
        if (!existing) {
            groups.set(rootKey, {
                rootKey,
                rootRow: row.key === rootKey ? row : null,
                children: row.key === rootKey ? [] : [row],
            });
            continue;
        }
        if (row.key === rootKey) {
            existing.rootRow = row;
            continue;
        }
        existing.children.push(row);
    }

    return [...groups.values()].sort((a, b) => a.rootKey.localeCompare(b.rootKey));
}

function findNextParentTaskIndex(taskRows: TaskRow[], currentIndex: number): number {
    for (let index = currentIndex + 1; index < taskRows.length; index += 1) {
        if (taskRows[index]?.depth === 0) {
            return index;
        }
    }
    return currentIndex;
}

function findPreviousParentTaskIndex(taskRows: TaskRow[], currentIndex: number): number {
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
        if (taskRows[index]?.depth === 0) {
            return index;
        }
    }
    return currentIndex;
}

function isJumpParentsForwardShortcut(key: {
    name: string;
    ctrl: boolean;
    option: boolean;
}): boolean {
    if (isMacOs) {
        return key.option && (key.name === "down" || key.name === "j");
    }
    return key.ctrl && (key.name === "down" || key.name === "j");
}

function isJumpParentsBackwardShortcut(key: {
    name: string;
    ctrl: boolean;
    option: boolean;
}): boolean {
    if (isMacOs) {
        return key.option && (key.name === "up" || key.name === "k");
    }
    return key.ctrl && (key.name === "up" || key.name === "k");
}

function indexRunsByTaskKey(taskRuns: TaskRunTreeNode[]): Map<string, TaskRunTreeNode> {
    const map = new Map<string, TaskRunTreeNode>();
    const visit = (run: TaskRunTreeNode) => {
        // The server stores canonical task keys on each run (including children),
        // so using run.task directly avoids duplicating parent prefixes.
        const existing = map.get(run.task);
        if (!existing || run.updatedAt > existing.updatedAt) {
            map.set(run.task, run);
        }
        for (const child of run.children) {
            visit(child);
        }
    };

    for (const run of taskRuns) {
        visit(run);
    }
    return map;
}

function upsertRunTreeNode(
    roots: TaskRunTreeNode[],
    updatedRun: TaskRunTreeNode,
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

function replaceRunTreeNode(
    node: TaskRunTreeNode,
    updatedRun: TaskRunTreeNode,
): [TaskRunTreeNode, boolean] {
    if (node.id === updatedRun.id) {
        return [updatedRun, true];
    }

    let replaced = false;
    const children = node.children.map((child) => {
        const [nextChild, childReplaced] = replaceRunTreeNode(child, updatedRun);
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

function taskStatusColor(status: DisplayTaskStatus): string {
    if (!status) {
        return "gray";
    }
    if (status === "Indeterminate") {
        return "#f4c542";
    }
    if (status === "Running") {
        return "#31d158";
    }
    if (status === "Success") {
        return "#4da3ff";
    }
    if (status === "Failed") {
        return "#ff3b30";
    }
    if (status === "Cancelled") {
        return "#777777";
    }
    return "gray";
}

function taskStatusIcon(status: DisplayTaskStatus): string {
    if (!status) {
        return "○";
    }
    if (status === "Indeterminate") {
        return "◐";
    }
    if (status === "Running") {
        return "▶";
    }
    if (status === "Success") {
        return "✓";
    }
    if (status === "Failed") {
        return "✖";
    }
    if (status === "Cancelled") {
        return "■";
    }
    return "○";
}

function buildDisplayStatusByTaskKey(
    tasks: Record<string, Task>,
    runByTaskKey: Map<string, TaskRunTreeNode>,
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

        const childStatuses = childKeys.map((childKey) => resolveStatus(childKey));
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

function getDirectChildTaskKeys(tasks: Record<string, Task>, taskKey: string): string[] {
    const childEntries = Object.keys(tasks[taskKey]?.tasks ?? {});
    return childEntries
        .map((childKey) => `${taskKey}:${childKey}`)
        .filter((fullKey) => tasks[fullKey] !== undefined);
}

function sanitizeLogForDisplay(line: string): string {
    const mostRecentSegment = line.split("\r").at(-1) ?? line;
    return mostRecentSegment
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

render(() => <App />);
