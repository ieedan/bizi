import { For } from "solid-js";

export interface RunningTaskRow {
	key: string;
	depth: number;
	status: "Queued" | "Running";
}

interface QuitConfirmationDialogProps {
	runningTasks: RunningTaskRow[];
	isCancelling: boolean;
}

const DIALOG_WIDTH = 84;
const TASK_LINE_MAX_WIDTH = DIALOG_WIDTH - 12;

function truncateText(value: string, maxWidth: number): string {
	if (value.length <= maxWidth) {
		return value;
	}
	if (maxWidth <= 3) {
		return ".".repeat(Math.max(0, maxWidth));
	}
	return `${value.slice(0, maxWidth - 3)}...`;
}

function formatTaskLine(row: RunningTaskRow): string {
	const indent = "  ".repeat(row.depth);
	const statusLabel = row.status === "Running" ? "RUN" : "QUEUED";
	const prefix = `${indent}- `;
	const suffix = ` [${statusLabel}]`;
	const availableTaskKeyWidth = Math.max(
		8,
		TASK_LINE_MAX_WIDTH - prefix.length - suffix.length
	);
	const taskKey = truncateText(row.key, availableTaskKeyWidth);
	return `${prefix}${taskKey}${suffix}`;
}

export function QuitConfirmationDialog(props: QuitConfirmationDialogProps) {
	return (
		<box
			alignItems="center"
			backgroundColor="#000000"
			height="100%"
			justifyContent="center"
			left={0}
			position="absolute"
			top={0}
			width="100%"
		>
			<box
				border
				borderColor="#666666"
				flexDirection="column"
				paddingX={1}
				width={DIALOG_WIDTH}
			>
				<text>Exit confirmation</text>
				<box marginTop={1}>
					<text style={{ fg: "#666666" }}>
						Would you like to cancel the following tasks before exiting?
					</text>
				</box>
				{/* <box marginTop={1}>
					<text style={{ fg: "#666666" }}>
						Running tasks ({props.runningTasks.length})
					</text>
				</box> */}
				<box
					border
					borderColor="#666666"
					flexDirection="column"
					height={12}
					marginTop={1}
					paddingX={1}
				>
					<scrollbox flexGrow={1} height="100%">
						<For each={props.runningTasks}>
							{(row) => <text>{formatTaskLine(row)}</text>}
						</For>
					</scrollbox>
				</box>
				<box marginTop={1}>
					<text>
						Press y or q for yes, n for no
						{props.isCancelling ? " (cancelling tasks...)" : ""}
					</text>
				</box>
			</box>
		</box>
	);
}
