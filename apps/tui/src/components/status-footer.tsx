import { For } from "solid-js";
import { footerActions } from "../lib/view-state";

interface StatusFooterProps {
	errorMessage: string | null;
	copyToastMessage: string | null;
	canRunOrRestart: boolean;
	runAction: "run" | "restart";
	canCancel: boolean;
	canToggleLogMode: boolean;
	logMode: "aggregate" | "selected";
}

export function StatusFooter(props: StatusFooterProps) {
	function actions() {
		return footerActions({
			hasSelection: props.canRunOrRestart,
			runAction: props.runAction,
			canCancel: props.canCancel,
			canToggleLogMode: props.canToggleLogMode,
			logMode: props.logMode,
		});
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
				{props.copyToastMessage ? (
					<>
						<span style={{ fg: "#666666" }}> | </span>
						<span style={{ fg: "#7ddc8e" }}>
							{props.copyToastMessage}
						</span>
					</>
				) : (
					""
				)}
				{props.errorMessage ? ` | error: ${props.errorMessage}` : ""}
			</text>
		</box>
	);
}
