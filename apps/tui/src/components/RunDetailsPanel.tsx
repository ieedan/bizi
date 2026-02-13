import type { TaskRunLogLine } from "@task-runner/client-js";
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useAppContext } from "../lib/app-context";
import { formatElapsedDuration, formatLogTimestamp, formatTaskTagForLog, sanitizeLogForDisplay } from "../lib/logs";
import { taskStatusDisplay } from "../lib/status";

type RunDetailsPanelProps = {
    selectedStatus: string | null;
    selectedRunStatus: "Queued" | "Running" | "Success" | "Cancelled" | "Failed" | null;
    selectedRunUpdatedAt: number | null;
    waitingOn: string | null;
    logs: TaskRunLogLine[];
    logColorByTaskKey: Record<string, string>;
    logTaskTagWidth: number;
    isFocused: boolean;
};

const LOG_TIMESTAMP_WIDTH = 13;

export function RunDetailsPanel(props: RunDetailsPanelProps) {
    const { cliOptions } = useAppContext();
    const [nowMs, setNowMs] = createSignal(Date.now());
    const panelBorderColor = () => (props.isFocused ? "#e6e6e6" : "#666666");
    const waitingOn = () => props.waitingOn?.trim() ?? "";
    const waitingOnText = () => waitingOn().replace(/\s+/g, " ").trim();
    const firstLogTimestamp = createMemo(() => props.logs[0]?.timestamp ?? null);
    const lastLogTimestamp = createMemo(() => props.logs.at(-1)?.timestamp ?? null);

    onMount(() => {
        const timer = setInterval(() => setNowMs(Date.now()), 250);
        onCleanup(() => clearInterval(timer));
    });

    const runStartTimestamp = createMemo(() => firstLogTimestamp() ?? props.selectedRunUpdatedAt ?? nowMs());
    const runEndTimestamp = createMemo(() => {
        const status = props.selectedRunStatus;
        if (status === "Running" || status === "Queued") {
            return nowMs();
        }
        return lastLogTimestamp() ?? props.selectedRunUpdatedAt ?? nowMs();
    });
    const runDurationMs = createMemo(() => runEndTimestamp() - runStartTimestamp());
    const waitingDurationMs = createMemo(() => nowMs() - (props.selectedRunUpdatedAt ?? runStartTimestamp()));

    const footerStatusText = createMemo(() => {
        const waitingOnValue = waitingOnText();
        if (waitingOnValue.length > 0) {
            return `Waiting on ${waitingOnValue} for ${formatElapsedDuration(waitingDurationMs())}`;
        }

        const runStatus = props.selectedRunStatus;
        if (runStatus === "Running") {
            return `Running for ${formatElapsedDuration(runDurationMs())}`;
        }
        if (runStatus === "Cancelled") {
            return `Canceled after ${formatElapsedDuration(runDurationMs())}`;
        }
        if (runStatus === "Success") {
            return `Succeeded in ${formatElapsedDuration(runDurationMs())}`;
        }
        if (runStatus === "Failed") {
            return `Failed after ${formatElapsedDuration(runDurationMs())}`;
        }
        if (runStatus === "Queued") {
            return `Queued for ${formatElapsedDuration(runDurationMs())}`;
        }

        return (props.selectedStatus ?? "Idle").replace(/\s+/g, " ").trim();
    });
    const statusIndicator = createMemo(() => taskStatusDisplay(props.selectedRunStatus ?? undefined));

    return (
        <box flexGrow={1} flexDirection="column">
            <box
                border
                borderColor={panelBorderColor()}
                customBorderChars={{
                    topLeft: "┬",
                    topRight: "┐",
                    bottomLeft: "├",
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
                <scrollbox flexGrow={1} height="100%" focused={props.isFocused} stickyScroll stickyStart="bottom">
                    <For each={props.logs}>
                        {(line) => (
                            <box flexDirection="row">
                                <box width={LOG_TIMESTAMP_WIDTH + 1} flexShrink={0}>
                                    <text fg="#666666">
                                        {formatLogTimestamp(line.timestamp)}{" "}
                                    </text>
                                </box>
                                <box width={props.logTaskTagWidth} flexShrink={0}>
                                    <text fg={props.logColorByTaskKey[line.task]}>
                                        {formatTaskTagForLog(line.task, props.logTaskTagWidth)}
                                    </text>
                                </box>
                                <box flexGrow={1}>
                                    <text>{sanitizeLogForDisplay(line.line)}</text>
                                </box>
                            </box>
                        )}
                    </For>
                </scrollbox>
            </box>
            <box
                border={["left", "right", "bottom"]}
                borderColor={panelBorderColor()}
                flexShrink={0}
                customBorderChars={{
                    topLeft: "├",
                    topRight: "┤",
                    horizontal: "─",
                    vertical: "│",
                    bottomLeft: "┴",
                    bottomRight: "┤",
                    topT: "┬",
                    bottomT: "┴",
                    leftT: "├",
                    rightT: "┤",
                    cross: "┼",
                }}
            >
                <box flexDirection="row" width="100%" paddingLeft={1} paddingRight={1}>
                    <Show when={props.selectedStatus !== "Indeterminate"}>
                        <box flexDirection="row">
                            <text fg={statusIndicator().color}>{statusIndicator().icon}</text>
                            <text> {footerStatusText()}</text>
                        </box>
                    </Show>
                    <box flexGrow={1} />
                    <text>
                        <span style={{ fg: "#666666" }}>{cliOptions.cwd}</span>
                    </text>
                </box>
            </box>
        </box>
    );
}
