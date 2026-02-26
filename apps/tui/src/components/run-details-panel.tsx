import type { TaskRunLogLine } from "@getbizi/client";
import {
	createEffect,
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
	parseAnsiLogSegments,
} from "../lib/logs";
import { StatusIndicator } from "./status-indicator";

const LOG_LINE_HEIGHT = 1;
const VIRTUALIZATION_THRESHOLD = 300;
const OVERSCAN_ROWS = 10;

interface ScrollboxRef {
	scrollTop: number;
	viewport: { height: number };
	scrollTo?: (position: number) => void;
	scrollToBottom?: () => void;
}

interface RunDetailsPanelProps {
	selectedTaskKey: string | null;
	selectedStatus: string | null;
	selectedFooterStatus:
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

function LogLine(props: {
	line: TaskRunLogLine;
	logTimestampWidth: number;
	logTaskTagWidth: number;
	logColorByTaskKey: Record<string, string>;
}) {
	return (
		<box flexDirection="row">
			<box flexShrink={0} width={props.logTimestampWidth + 1}>
				<text fg="#666666">
					{formatLogTimestamp(props.line.timestamp)}{" "}
				</text>
			</box>
			<box flexShrink={0} width={props.logTaskTagWidth}>
				<text fg={props.logColorByTaskKey[props.line.task]}>
					{formatTaskTagForLog(props.line.task, props.logTaskTagWidth)}
				</text>
			</box>
			<box flexGrow={1}>
				<text>
					<For each={parseAnsiLogSegments(props.line.line)}>
						{(segment) => (
							<span style={segment.style}>{segment.text}</span>
						)}
					</For>
				</text>
			</box>
		</box>
	);
}

export function RunDetailsPanel(props: RunDetailsPanelProps) {
	const { cliOptions } = useAppContext();
	const [nowMs, setNowMs] = createSignal(Date.now());
	let scrollboxRef: ScrollboxRef | undefined;
	const [scrollTop, setScrollTop] = createSignal(0);
	const [viewportHeight, setViewportHeight] = createSignal(20);

	createEffect(() => {
		props.selectedTaskKey;

		// Force virtualized view to bottom immediately
		setScrollTop(Number.MAX_SAFE_INTEGER);

		const scrollToBottom = () => {
			const el = scrollboxRef;
			if (!el) {
				return;
			}
			el.scrollToBottom?.() ?? el.scrollTo?.(Number.MAX_SAFE_INTEGER);
		};

		const t1 = setTimeout(scrollToBottom, 0);
		return () => {
			clearTimeout(t1);
		};
	});

	createEffect(() => {
		const logs = props.logs;
		if (logs.length <= VIRTUALIZATION_THRESHOLD) {
			return;
		}
		let lastTop = -1;
		let lastHeight = -1;
		const poll = () => {
			if (scrollboxRef) {
				const top = Math.floor(scrollboxRef.scrollTop);
				const height = scrollboxRef.viewport?.height ?? 20;
				if (top !== lastTop || height !== lastHeight) {
					lastTop = top;
					lastHeight = height;
					setScrollTop(top);
					setViewportHeight(height);
				}
			}
		};
		const intervalId = setInterval(poll, 50);
		return () => clearInterval(intervalId);
	});

	const visibleRange = createMemo(() => {
		const total = props.logs.length;
		if (total <= VIRTUALIZATION_THRESHOLD) {
			return { start: 0, end: total, virtualized: false };
		}
		const vh = viewportHeight();
		const top = scrollTop();
		const maxScroll = Math.max(0, total - vh);
		const atBottom = top >= maxScroll - 2;
		const start = atBottom
			? Math.max(0, total - vh - OVERSCAN_ROWS)
			: Math.max(0, top - OVERSCAN_ROWS);
		const end = atBottom
			? total
			: Math.min(total, top + vh + OVERSCAN_ROWS);
		return { start, end, virtualized: true };
	});
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
		const status = props.selectedFooterStatus;
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

		const runStatus = props.selectedFooterStatus;
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
					ref={(el) => {
						scrollboxRef = el as ScrollboxRef;
					}}
					stickyScroll
					stickyStart="bottom"
					viewportCulling={props.logs.length > VIRTUALIZATION_THRESHOLD}
				>
					<Show
						when={visibleRange().virtualized}
						fallback={
							<For each={props.logs}>
								{(line) => (
									<LogLine
										line={line}
										logColorByTaskKey={
											props.logColorByTaskKey
										}
										logTaskTagWidth={
											props.logTaskTagWidth
										}
										logTimestampWidth={
											LOG_TIMESTAMP_WIDTH
										}
									/>
								)}
							</For>
						}
					>
						{(() => {
							const range = visibleRange();
							const logs = props.logs;
							const topSpacerHeight = range.start;
							const bottomSpacerHeight =
								logs.length - range.end;
							return (
								<>
									<Show when={topSpacerHeight > 0}>
										<box
											height={topSpacerHeight * LOG_LINE_HEIGHT}
										/>
									</Show>
									<For
										each={logs.slice(
											range.start,
											range.end
										)}
									>
										{(line) => (
											<LogLine
												line={line}
												logColorByTaskKey={
													props.logColorByTaskKey
												}
												logTaskTagWidth={
													props.logTaskTagWidth
												}
												logTimestampWidth={
													LOG_TIMESTAMP_WIDTH
												}
											/>
										)}
									</For>
									<Show when={bottomSpacerHeight > 0}>
										<box
											height={
												bottomSpacerHeight *
												LOG_LINE_HEIGHT
											}
										/>
									</Show>
								</>
							);
						})()}
					</Show>
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
							<StatusIndicator
								status={props.selectedFooterStatus ?? undefined}
							/>
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
