import { createEffect, For } from "solid-js";
import type { DisplayTaskStatus, TaskTreeNode } from "../types";
import { TaskTreeNodeCard } from "./task-tree-node-card";

interface TaskTreePanelProps {
	taskTree: TaskTreeNode[];
	selectedTaskKey: string | null;
	displayStatusByTaskKey: Map<string, DisplayTaskStatus>;
	taskSearchQuery: string;
	isTaskSearchFocused: boolean;
	hasTaskSearchError: boolean;
}

const SEARCH_PLACEHOLDER = "/ Type task name...";
const SEARCH_CURSOR = "▏";

interface ScrollboxWithScrollTo {
	scrollTo?: (position: number) => void;
	scrollTop: number;
	viewport: {
		height: number;
	};
}

function getTaskNodeHeight(node: TaskTreeNode): number {
	if (node.children.length === 0) {
		return 3;
	}

	// Parent card contributes top border + header + bottom border + first-child margin.
	let height = 4;
	for (const child of node.children) {
		height += getTaskNodeHeight(child);
	}
	return height;
}

function findTaskNodeBounds(
	nodes: TaskTreeNode[],
	targetTaskKey: string
): { offset: number; height: number } | null {
	const findWithinNode = (
		node: TaskTreeNode,
		startOffset: number
	): { offset: number; height: number } | null => {
		const nodeHeight = getTaskNodeHeight(node);
		if (node.row.key === targetTaskKey) {
			return { offset: startOffset, height: nodeHeight };
		}
		if (node.children.length === 0) {
			return null;
		}

		let childOffset = startOffset + 4;
		for (const child of node.children) {
			const result = findWithinNode(child, childOffset);
			if (result !== null) {
				return result;
			}
			childOffset += getTaskNodeHeight(child);
		}
		return null;
	};

	let offset = 0;
	for (const node of nodes) {
		const result = findWithinNode(node, offset);
		if (result !== null) {
			return result;
		}
		offset += getTaskNodeHeight(node);
	}
	return null;
}

export function TaskTreePanel(props: TaskTreePanelProps) {
	let taskScrollbox: ScrollboxWithScrollTo | undefined;

	const taskSearchBorderColor = () =>
		props.hasTaskSearchError ? "#ff5555" : "#666666";

	createEffect(() => {
		const selectedTaskKey = props.selectedTaskKey;
		if (!selectedTaskKey) {
			return;
		}

		const selectedTaskBounds = findTaskNodeBounds(
			props.taskTree,
			selectedTaskKey
		);
		if (selectedTaskBounds === null) {
			return;
		}

		queueMicrotask(() => {
			if (!taskScrollbox) {
				return;
			}

			const viewportHeight = taskScrollbox.viewport.height;
			const viewportStart = taskScrollbox.scrollTop;
			const viewportEnd = viewportStart + viewportHeight;
			const itemStart = selectedTaskBounds.offset;
			const itemEnd = itemStart + selectedTaskBounds.height;
			const isItemVisible =
				itemStart >= viewportStart && itemEnd <= viewportEnd;

			if (isItemVisible) {
				return;
			}

			taskScrollbox.scrollTo?.(Math.max(0, itemStart - 1));
		});
	});

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
				<box
					border
					borderColor={taskSearchBorderColor()}
					height={3}
					marginBottom={1}
					paddingX={1}
				>
					{/*
					 * Rendered rather than using an <input> so the state
					 * machine in `lib/tui-state.ts` is the only owner of the
					 * query text — otherwise the input and the key handler
					 * would both try to edit it.
					 */}
					<text>
						{props.taskSearchQuery.length === 0 ? (
							<span style={{ fg: "#666666" }}>
								{SEARCH_PLACEHOLDER}
							</span>
						) : (
							props.taskSearchQuery
						)}
						{props.isTaskSearchFocused ? SEARCH_CURSOR : ""}
					</text>
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
				<scrollbox
					flexGrow={1}
					height="100%"
					ref={(instance) => {
						taskScrollbox = instance as ScrollboxWithScrollTo;
					}}
				>
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
