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

    const selectedCommand = createMemo(() => {
        const row = selectedRow();
        if (!row) {
            return null;
        }
        return tasks()[row.key]?.command ?? null;
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

        if (key.name === "up" || key.name === "k") {
            setSelectedIndex((idx) => Math.max(0, idx - 1));
            return;
        }
        if (key.name === "down" || key.name === "j") {
            if (key.ctrl || key.meta) {
                setSelectedIndex((idx) => findNextParentTaskIndex(taskRows(), idx));
                return;
            }
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
            <box flexDirection="row" flexGrow={1} gap={1}>
                <box width={42} border title="tasks" flexDirection="column" padding={1}>
                    <scrollbox flexGrow={1} height="100%">
                        <For each={taskGroups()}>
                            {(group) => {
                                const selectedTaskKey = () => selectedRow()?.key;
                                const rootStatus = () =>
                                    taskStatusColor(
                                        displayStatusByTaskKey().get(group.rootKey) ??
                                            displayStatusByTaskKey().get(group.rootRow?.key ?? ""),
                                    );
                                const rootSelected = () => selectedTaskKey() === group.rootRow?.key;
                                if (group.children.length === 0 && group.rootRow) {
                                    return (
                                        <box
                                            border
                                            borderStyle="rounded"
                                            borderColor={rootSelected() ? "#e6e6e6" : "#666666"}
                                            marginBottom={1}
                                            paddingLeft={1}
                                            paddingRight={1}
                                            height={3}
                                            alignItems="center"
                                            justifyContent="space-between"
                                            flexDirection="row"
                                        >
                                            <text>{group.rootRow.key}</text>
                                            <text fg={rootStatus()}>●</text>
                                        </box>
                                    );
                                }

                                return (
                                    <box
                                        border
                                        borderStyle="rounded"
                                        borderColor={rootSelected() ? "#e6e6e6" : "#666666"}
                                        marginBottom={1}
                                        padding={1}
                                        flexDirection="column"
                                    >
                                        <box
                                            flexDirection="row"
                                            justifyContent="space-between"
                                            alignItems="center"
                                        >
                                            <text>{group.rootKey}</text>
                                            <text fg={rootStatus()}>●</text>
                                        </box>
                                        <For each={group.children}>
                                            {(child) => (
                                                <box
                                                    border
                                                    borderStyle="rounded"
                                                    borderColor={
                                                        selectedTaskKey() === child.key
                                                            ? "#e6e6e6"
                                                            : "#666666"
                                                    }
                                                    marginTop={1}
                                                    paddingLeft={1}
                                                    paddingRight={1}
                                                    height={3}
                                                    alignItems="center"
                                                    justifyContent="space-between"
                                                    flexDirection="row"
                                                >
                                                    <text>{child.key}</text>
                                                    <text
                                                        fg={taskStatusColor(
                                                            displayStatusByTaskKey().get(child.key),
                                                        )}
                                                    >
                                                        ●
                                                    </text>
                                                </box>
                                            )}
                                        </For>
                                    </box>
                                );
                            }}
                        </For>
                    </scrollbox>
                </box>

                <box border title="logs" flexGrow={1} flexDirection="column" padding={1}>
                    <text>cwd: {cwd}</text>
                    <text>task: {selectedRow()?.key ?? "-"}</text>
                    <text>command: {selectedCommand() ?? "(no command)"}</text>
                    <box flexGrow={1} marginTop={1}>
                        <scrollbox flexGrow={1} height="100%" stickyScroll stickyStart="bottom">
                            <For each={logs()}>
                                {(line, idx) => (
                                    <box flexDirection="row">
                                        <text fg="#666666">{String(idx() + 1).padStart(4, " ")} </text>
                                        <text fg="#808080">[{line.task}] </text>
                                        <text>{sanitizeLogForDisplay(line.line)}</text>
                                    </box>
                                )}
                            </For>
                        </scrollbox>
                    </box>
                </box>
            </box>

            <box border paddingLeft={1}>
                <text>
                    arrows/jk move | r run | R restart | c cancel | l log mode | q quit
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
        return "#ff9f1a";
    }
    if (status === "Cancelled") {
        return "#777777";
    }
    return "gray";
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
