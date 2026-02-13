import type { TaskRunLogLine } from "@task-runner/client-js";
import {
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { useAppContext } from "../lib/app-context";
import {
	formatElapsedDuration,
	formatLogTimestamp,
	formatTaskTagForLog,
	sanitizeLogForDisplay,
} from "../lib/logs";
import { taskStatusDisplay } from "../lib/status";

interface RunDetailsPanelProps {
	selectedStatus: string | null;
	selectedRunStatus:
		| "Queued"
		| "Running"
		| "Success"
		| "Cancelled"
		| "Failed"
		| null;
	selectedRunUpdatedAt: number | null;
	waitingOn: string | null;
	logs: TaskRunLogLine[];
	logColorByTaskKey: Record<string, string>;
	logTaskTagWidth: number;
	isFocused: boolean;
}

const LOG_TIMESTAMP_WIDTH = 13;

export function RunDetailsPanel(props: RunDetailsPanelProps) {
	const { cliOptions } = useAppContext();
	const [nowMs, setNowMs] = createSignal(Date.now());
	const panelBorderColor = () => (props.isFocused ? "#e6e6e6" : "#666666");
	const waitingOn = () => props.waitingOn?.trim() ?? "";
	const waitingOnText = () => waitingOn().replace(/\s+/g, " ").trim();
	const firstLogTimestamp = createMemo(
		() => props.logs[0]?.timestamp ?? null
	);
	const lastLogTimestamp = createMemo(
		() => props.logs.at(-1)?.timestamp ?? null
	);

	onMount(() => {
		const timer = setInterval(() => setNowMs(Date.now()), 250);
		onCleanup(() => clearInterval(timer));
	});

	const runStartTimestamp = createMemo(
		() => firstLogTimestamp() ?? props.selectedRunUpdatedAt ?? nowMs()
	);
	const runEndTimestamp = createMemo(() => {
		const status = props.selectedRunStatus;
		if (status === "Running" || status === "Queued") {
			return nowMs();
		}
		return lastLogTimestamp() ?? props.selectedRunUpdatedAt ?? nowMs();
	});
	const runDurationMs = createMemo(
		() => runEndTimestamp() - runStartTimestamp()
	);
	const waitingDurationMs = createMemo(
		() => nowMs() - (props.selectedRunUpdatedAt ?? runStartTimestamp())
	);

	const footerStatusText = createMemo(() => {
		const waitingOnValue = waitingOnText();
		if (waitingOnValue.length > 0) {
			return `Waiting on ${waitingOnValue} for ${formatElapsedDuration(waitingDurationMs())}`;
		}

		const runStatus = props.selectedRunStatus;
		if (runStatus === "Running") {
			return `Running for ${formatElapsedDuration(runDurationMs())}`;
		}
		if (runStatus === "Cancelled") {
			return `Canceled after ${formatElapsedDuration(runDurationMs())}`;
		}
		if (runStatus === "Success") {
			return `Succeeded in ${formatElapsedDuration(runDurationMs())}`;
		}
		if (runStatus === "Failed") {
			return `Failed after ${formatElapsedDuration(runDurationMs())}`;
		}
		if (runStatus === "Queued") {
			return `Queued for ${formatElapsedDuration(runDurationMs())}`;
		}

		return (props.selectedStatus ?? "Idle").replace(/\s+/g, " ").trim();
	});
	const statusIndicator = createMemo(() =>
		taskStatusDisplay(props.selectedRunStatus ?? undefined)
	);

	return (
		<box flexDirection="column" flexGrow={1}>
			<box
				border
				borderColor={panelBorderColor()}
				customBorderChars={{
					topLeft: "┬",
					topRight: "┐",
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
				flexDirection="column"
				flexGrow={1}
				paddingX={1}
			>
				<scrollbox
					flexGrow={1}
					focused={props.isFocused}
					height="100%"
					stickyScroll
					stickyStart="bottom"
				>
					<For each={props.logs}>
						{(line) => (
							<box flexDirection="row">
								<box
									flexShrink={0}
									width={LOG_TIMESTAMP_WIDTH + 1}
								>
									<text fg="#666666">
										{formatLogTimestamp(
											line.timestamp
										)}{" "}
									</text>
								</box>
								<box
									flexShrink={0}
									width={props.logTaskTagWidth}
								>
									<text
										fg={props.logColorByTaskKey[line.task]}
									>
										{formatTaskTagForLog(
											line.task,
											props.logTaskTagWidth
										)}
									</text>
								</box>
								<box flexGrow={1}>
									<text>
										{sanitizeLogForDisplay(line.line)}
									</text>
								</box>
							</box>
						)}
					</For>
				</scrollbox>
			</box>
			<box
				border={["left", "right", "bottom"]}
				borderColor={panelBorderColor()}
				customBorderChars={{
					topLeft: "├",
					topRight: "┤",
					horizontal: "─",
					vertical: "│",
					bottomLeft: "┴",
					bottomRight: "┤",
					topT: "┬",
					bottomT: "┴",
					leftT: "├",
					rightT: "┤",
					cross: "┼",
				}}
				flexShrink={0}
			>
				<box
					flexDirection="row"
					paddingLeft={1}
					paddingRight={1}
					width="100%"
				>
					<Show when={props.selectedStatus !== "Indeterminate"}>
						<box flexDirection="row">
							<text fg={statusIndicator().color}>
								{statusIndicator().icon}
							</text>
							<text> {footerStatusText()}</text>
						</box>
					</Show>
					<box flexGrow={1} />
					<text>
						<span style={{ fg: "#666666" }}>{cliOptions.cwd}</span>
					</text>
				</box>
			</box>
		</box>
	);
}
