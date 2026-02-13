import { For } from "solid-js";
import type { DisplayTaskStatus, TaskTreeNode } from "../types";
import { TaskTreeNodeCard } from "./task-tree-node-card";

interface TaskTreePanelProps {
	taskTree: TaskTreeNode[];
	selectedTaskKey: string | null;
	displayStatusByTaskKey: Map<string, DisplayTaskStatus>;
}

export function TaskTreePanel(props: TaskTreePanelProps) {
	return (
		<box
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
			width={42}
		>
			<scrollbox flexGrow={1} height="100%">
				<For each={props.taskTree}>
					{(node) => (
						<TaskTreeNodeCard
							displayStatusByTaskKey={
								props.displayStatusByTaskKey
							}
							node={node}
							selectedTaskKey={props.selectedTaskKey}
						/>
					)}
				</For>
			</scrollbox>
		</box>
	);
}
