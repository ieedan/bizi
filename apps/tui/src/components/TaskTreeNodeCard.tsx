import { For } from "solid-js";
import { taskStatusDisplay } from "../lib/status";
import type { DisplayTaskStatus, TaskTreeNode } from "../types";

type TaskTreeNodeCardProps = {
    node: TaskTreeNode;
    selectedTaskKey: string | null;
    displayStatusByTaskKey: Map<string, DisplayTaskStatus>;
};

export function TaskTreeNodeCard(props: TaskTreeNodeCardProps) {
    const nodeDisplayStatus = () => props.displayStatusByTaskKey.get(props.node.row.key);
    const nodeStatus = () => taskStatusDisplay(nodeDisplayStatus());
    const nodeSelected = () => props.selectedTaskKey === props.node.row.key;

    if (props.node.children.length === 0) {
        return (
            <box
                border
                borderStyle="rounded"
                borderColor={nodeSelected() ? "#e6e6e6" : "#666666"}
                paddingLeft={1}
                paddingRight={1}
                height={3}
                alignItems="center"
                justifyContent="space-between"
                flexDirection="row"
            >
                <text>{props.node.row.key}</text>
                <text fg={nodeStatus().color}>{nodeStatus().icon}</text>
            </box>
        );
    }

    return (
        <box
            border
            borderStyle="rounded"
            borderColor={nodeSelected() ? "#e6e6e6" : "#666666"}
            paddingX={1}
            flexDirection="column"
        >
            <box flexDirection="row" justifyContent="space-between" alignItems="center">
                <text>{props.node.row.key}</text>
                <text fg={nodeStatus().color}>{nodeStatus().icon}</text>
            </box>
            <For each={props.node.children}>
                {(child, i) => (
                    <box marginTop={i() === 0 ? 1 : 0}>
                        <TaskTreeNodeCard
                            node={child}
                            selectedTaskKey={props.selectedTaskKey}
                            displayStatusByTaskKey={props.displayStatusByTaskKey}
                        />
                    </box>
                )}
            </For>
        </box>
    );
}
