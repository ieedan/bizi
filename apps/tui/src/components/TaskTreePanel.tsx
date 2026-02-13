import { For } from "solid-js";
import type { DisplayTaskStatus, TaskTreeNode } from "../types";
import { TaskTreeNodeCard } from "./TaskTreeNodeCard";

type TaskTreePanelProps = {
    taskTree: TaskTreeNode[];
    selectedTaskKey: string | null;
    displayStatusByTaskKey: Map<string, DisplayTaskStatus>;
};

export function TaskTreePanel(props: TaskTreePanelProps) {
    return (
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
                <For each={props.taskTree}>
                    {(node) => (
                        <TaskTreeNodeCard
                            node={node}
                            selectedTaskKey={props.selectedTaskKey}
                            displayStatusByTaskKey={props.displayStatusByTaskKey}
                        />
                    )}
                </For>
            </scrollbox>
        </box>
    );
}
