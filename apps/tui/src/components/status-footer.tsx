import { For } from "solid-js";

interface StatusFooterProps {
	errorMessage: string | null;
	canNavigateTasks: boolean;
	canJumpParentTasks: boolean;
	canRunOrRestart: boolean;
	runAction: "run" | "restart";
	canCancel: boolean;
	canToggleLogMode: boolean;
	logMode: "aggregate" | "selected";
}

export function StatusFooter(props: StatusFooterProps) {
	function actions() {
		const parts: Array<{ key: string; label: string }> = [];
		if (props.canRunOrRestart) {
			parts.push({ key: "r", label: props.runAction });
		}
		if (props.canCancel) {
			parts.push({ key: "c", label: "cancel" });
		}
		if (props.canToggleLogMode) {
			parts.push({ key: "m", label: `logs: ${props.logMode}` });
		}
		parts.push({ key: "q", label: "quit" });
		return parts;
	}

	return (
		<box
			border={["left", "right", "bottom"]}
			borderColor="#666666"
			paddingLeft={1}
		>
			<text>
				<For each={actions()}>
					{(action, idx) => (
						<>
							{idx() > 0 ? (
								<span style={{ fg: "#666666" }}> | </span>
							) : (
								""
							)}
							{action.key}{" "}
							<span style={{ fg: "#666666" }}>
								{action.label}
							</span>
						</>
					)}
				</For>
				{props.errorMessage ? ` | error: ${props.errorMessage}` : ""}
			</text>
		</box>
	);
}
