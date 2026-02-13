import { For } from "solid-js";
import type { DisplayTaskStatus, TaskTreeNode } from "../types";
import { TaskTreeNodeCard } from "./task-tree-node-card";

interface TaskTreePanelProps {
	taskTree: TaskTreeNode[];
	selectedTaskKey: string | null;
	displayStatusByTaskKey: Map<string, DisplayTaskStatus>;
	taskSearchQuery: string;
	isTaskSearchFocused: boolean;
	hasTaskSearchError: boolean;
	onTaskSearchInput: (value: string) => void;
}

export function TaskTreePanel(props: TaskTreePanelProps) {
	const taskSearchBorderColor = () =>
		props.hasTaskSearchError ? "#ff5555" : "#666666";

	return (
		<box flexDirection="column" width={42}>
			<box
				border={["top", "left"]}
				borderColor="#666666"
				customBorderChars={{
					topLeft: "┌",
					topRight: "┬",
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
				paddingX={1}
				width="100%"
			>
				<box border borderColor={taskSearchBorderColor()} paddingX={1}>
					<input
						focused={props.isTaskSearchFocused}
						onInput={props.onTaskSearchInput}
						placeholder="/ Type task name..."
						value={props.taskSearchQuery}
						width={35}
					/>
				</box>
			</box>
			<box
				border={["left", "bottom"]}
				borderColor="#666666"
				customBorderChars={{
					topLeft: "├",
					topRight: "┼",
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
				flexGrow={1}
				paddingX={1}
				width="100%"
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
		</box>
	);
}
