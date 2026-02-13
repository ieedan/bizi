import { For } from "solid-js";
import { taskStatusDisplay } from "../lib/status";
import type { DisplayTaskStatus, TaskTreeNode } from "../types";

interface TaskTreeNodeCardProps {
	node: TaskTreeNode;
	selectedTaskKey: string | null;
	displayStatusByTaskKey: Map<string, DisplayTaskStatus>;
}

export function TaskTreeNodeCard(props: TaskTreeNodeCardProps) {
	const nodeDisplayStatus = () =>
		props.displayStatusByTaskKey.get(props.node.row.key);
	const nodeStatus = () => taskStatusDisplay(nodeDisplayStatus());
	const nodeSelected = () => props.selectedTaskKey === props.node.row.key;

	if (props.node.children.length === 0) {
		return (
			<box
				alignItems="center"
				border
				borderColor={nodeSelected() ? "#e6e6e6" : "#666666"}
				borderStyle="rounded"
				flexDirection="row"
				height={3}
				justifyContent="space-between"
				paddingLeft={1}
				paddingRight={1}
			>
				<text>{props.node.row.key}</text>
				<text fg={nodeStatus().color}>{nodeStatus().icon}</text>
			</box>
		);
	}

	return (
		<box
			border
			borderColor={nodeSelected() ? "#e6e6e6" : "#666666"}
			borderStyle="rounded"
			flexDirection="column"
			paddingX={1}
		>
			<box
				alignItems="center"
				flexDirection="row"
				justifyContent="space-between"
			>
				<text>{props.node.row.key}</text>
				<text fg={nodeStatus().color}>{nodeStatus().icon}</text>
			</box>
			<For each={props.node.children}>
				{(child, i) => (
					<box marginTop={i() === 0 ? 1 : 0}>
						<TaskTreeNodeCard
							displayStatusByTaskKey={
								props.displayStatusByTaskKey
							}
							node={child}
							selectedTaskKey={props.selectedTaskKey}
						/>
					</box>
				)}
			</For>
		</box>
	);
}
