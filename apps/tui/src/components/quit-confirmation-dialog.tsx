import { useKeyboard } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import { StatusIndicator } from "./status-indicator";

export interface RunningTaskRow {
	key: string;
	depth: number;
	status: "Queued" | "Running";
}

export type QuitConfirmationAction = "cancelAll" | "exitWithoutCancelling";

interface QuitConfirmationDialogProps {
	isCancelling: boolean;
	onConfirm: (action: QuitConfirmationAction) => void;
	runningTasks: RunningTaskRow[];
}

const DIALOG_WIDTH = 84;

const ACTIONS: { label: string; action: QuitConfirmationAction }[] = [
	{ label: "Cancel All [y/q]", action: "cancelAll" },
	{ label: "Exit without cancelling [n]", action: "exitWithoutCancelling" },
];

export function QuitConfirmationDialog(props: QuitConfirmationDialogProps) {
	const [selectedIndex, setSelectedIndex] = createSignal(0);

	useKeyboard((key) => {
		if (props.isCancelling) {
			return;
		}
		if (
			key.name === "y" ||
			key.name === "q" ||
			(key.ctrl && key.name === "c")
		) {
			props.onConfirm("cancelAll");
			return;
		}
		if (key.name === "n") {
			props.onConfirm("exitWithoutCancelling");
			return;
		}
		if (key.name === "left" || key.name === "[") {
			setSelectedIndex((i) => (i === 0 ? ACTIONS.length - 1 : i - 1));
			return;
		}
		if (key.name === "right" || key.name === "]") {
			setSelectedIndex((i) => (i === ACTIONS.length - 1 ? 0 : i + 1));
			return;
		}
		if (key.name === "enter" || key.name === "return") {
			const action = ACTIONS[selectedIndex()];
			if (action) {
				props.onConfirm(action.action);
			}
		}
	});

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
						Would you like to cancel the following tasks before
						exiting?
					</text>
				</box>
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
							{(row) => (
								<box>
									<box
										alignItems="center"
										border
										borderColor="#666666"
										borderStyle="rounded"
										flexDirection="row"
										height={3}
										justifyContent="space-between"
										paddingLeft={1}
										paddingRight={1}
									>
										<text>{row.key}</text>
										<StatusIndicator status={row.status} />
									</box>
								</box>
							)}
						</For>
					</scrollbox>
				</box>
				<box flexDirection="row" gap={1} marginTop={1}>
					<Show
						fallback={<text>(cancelling tasks...)</text>}
						when={!props.isCancelling}
					>
						<For each={ACTIONS}>
							{(item, i) => {
								const selected = () => i() === selectedIndex();
								return (
									<box
										backgroundColor={
											selected()
												? "#FFFFFF"
												: "transparent"
										}
										paddingX={2}
										paddingY={1}
									>
										<text
											style={{
												fg: selected()
													? "#000000"
													: "#FFFFFF",
											}}
										>
											{item.label}
										</text>
									</box>
								);
							}}
						</For>
					</Show>
				</box>
			</box>
		</box>
	);
}
