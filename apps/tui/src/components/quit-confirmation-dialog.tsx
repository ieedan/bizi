import { For, Show } from "solid-js";
import { QUIT_ACTIONS } from "../lib/tui-state";
import type { RunningTaskRow } from "../lib/view-state";
import { StatusIndicator } from "./status-indicator";

export type { RunningTaskRow };

interface QuitConfirmationDialogProps {
	isCancelling: boolean;
	runningTasks: RunningTaskRow[];
	selectedActionIndex: number;
}

const DIALOG_WIDTH = 84;
const ACTIONS = QUIT_ACTIONS;

// Keys are handled by the state machine in `lib/tui-state.ts`; this component
// only renders what that state says.
export function QuitConfirmationDialog(props: QuitConfirmationDialogProps) {
	const selectedIndex = () => props.selectedActionIndex;

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
