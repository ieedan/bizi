import { taskStatusDisplay } from "../lib/status";
import type { DisplayTaskStatus } from "../types";

interface StatusIndicatorProps {
	status: DisplayTaskStatus;
}

export function StatusIndicator(props: StatusIndicatorProps) {
	const display = () => taskStatusDisplay(props.status);
	return <text fg={display().color}>{display().icon}</text>;
}
