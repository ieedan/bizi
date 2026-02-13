import type { TaskRunLogLine } from "@task-runner/client-js";
import { For } from "solid-js";
import { useAppContext } from "../lib/app-context";
import { formatTaskTagForLog, sanitizeLogForDisplay } from "../lib/logs";

type RunDetailsPanelProps = {
    selectedTaskKey: string | null;
    selectedCommand: string | null;
    selectedStatus: string | null;
    waitingOn: string | null;
    logs: TaskRunLogLine[];
    logColorByTaskKey: Record<string, string>;
    logLineNumberWidth: number;
    logTaskTagWidth: number;
    isFocused: boolean;
};

export function RunDetailsPanel(props: RunDetailsPanelProps) {
    const { cliOptions } = useAppContext();
    const waitingOn = () => props.waitingOn?.trim() ?? "";
    const statusText = () => (props.selectedStatus ?? "-").replace(/\s+/g, " ").trim();
    const waitingOnText = () => waitingOn().replace(/\s+/g, " ").trim();

    return (
        <box
            border
            borderColor={props.isFocused ? "#e6e6e6" : "#666666"}
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
            <box flexDirection="row" height={1} flexShrink={0}>
                <text>cwd: {cliOptions.cwd}</text>
            </box>
            <box flexDirection="row" height={1} flexShrink={0}>
                <text>task: {props.selectedTaskKey ?? "-"}</text>
            </box>
            <box flexDirection="row" height={1} flexShrink={0}>
                <text>command: {props.selectedCommand ?? "(no command)"}</text>
            </box>
            <box flexDirection="row" height={1} flexShrink={0}>
                <text>status: {statusText()}</text>
            </box>
            {waitingOnText().length > 0 ? (
                <box flexDirection="row" height={1} flexShrink={0}>
                    <text>waiting on: {waitingOnText()}</text>
                </box>
            ) : null}
            <box height={1} flexShrink={0} />
            <box flexGrow={1}>
                <scrollbox flexGrow={1} height="100%" focused={props.isFocused} stickyScroll stickyStart="bottom">
                    <For each={props.logs}>
                        {(line, idx) => (
                            <box flexDirection="row">
                                <box width={props.logLineNumberWidth + 1} flexShrink={0}>
                                    <text fg="#666666">
                                        {String(idx() + 1).padStart(props.logLineNumberWidth, " ")}{" "}
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
        </box>
    );
}
