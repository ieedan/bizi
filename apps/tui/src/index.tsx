import type { TaskRunLogsStreamMessage } from "@getbizi/client";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { createMemo, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { resolveCliMode } from "./commands/cli";
import { QuitConfirmationDialog } from "./components/quit-confirmation-dialog";
import { RunDetailsPanel } from "./components/run-details-panel";
import { StatusFooter } from "./components/status-footer";
import { TaskTreePanel } from "./components/task-tree-panel";
import { AppContextProvider } from "./lib/app-context";
import type { CliOptions } from "./lib/args";
import { api } from "./lib/bizi-api";
import { getSelectedTextByRow } from "./lib/selection-copy";
import {
	applyKey,
	applyLogError,
	applyLogLine,
	applyLogSnapshot,
	applyRootRunUpdated,
	applyRunsLoaded,
	applyTasksLoaded,
	createTuiState,
	selectedRow,
	selectedRun,
	selectedTaskKey,
	stateRunningTaskRows,
	syncSubscriptions,
	type TuiEffect,
	type TuiState,
} from "./lib/tui-state";
import {
	buildLogColorByTaskKey,
	canCancelSelected,
	canToggleLogMode,
	logTaskTagWidth,
	selectedFooterStatus,
	selectedRunAction,
} from "./lib/view-state";

const argv = process.argv.slice(2);
let cliOptions: CliOptions = { cwd: process.cwd() };
let cwd = cliOptions.cwd;
const isMacOs = process.platform === "darwin";
const COPY_TOAST_MS = 2000;
const REFRESH_RUNS_MS = 1200;

function App() {
	const renderer = useRenderer();
	const [state, setState] = createStore<TuiState>(
		createTuiState({ isMacOs })
	);

	let copyToastTimeoutId: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Every state change goes through here: the mutation runs against the store
	 * draft and any effects it asks for are performed afterwards, so the state
	 * machine itself stays free of I/O.
	 */
	function dispatch(mutate: (draft: TuiState) => TuiEffect[] | void): void {
		let effects: TuiEffect[] = [];
		setState(
			produce((draft) => {
				effects = [
					...(mutate(draft) ?? []),
					// Streams follow state, so every change gets a chance to
					// open or close one.
					...syncSubscriptions(draft),
				];
			})
		);
		for (const effect of effects) {
			runEffect(effect).catch(() => undefined);
		}
	}

	async function runEffect(effect: TuiEffect): Promise<void> {
		switch (effect.type) {
			case "runTask":
				await api.runTask(effect.taskKey, cwd);
				await refreshRuns();
				return;
			case "restartRun":
				await api.restartTask(effect.runId);
				await refreshRuns();
				return;
			case "cancelRun":
				await api.cancelTask(effect.runId);
				await refreshRuns();
				return;
			case "cancelRunsBeforeExit":
				await Promise.allSettled(
					effect.runIds.map((runId) => api.cancelTask(runId))
				);
				quit();
				return;
			case "copySelection":
				copySelectionToClipboard();
				return;
			case "quit":
				quit();
				return;
			case "openRootRunStreams":
				openRootRunStreams(effect.runIds);
				return;
			case "closeRootRunStreams":
				closeRootRunStreams();
				return;
			case "openSelectedRunStreams":
				openSelectedRunStreams(effect.runId, effect.includeChildren);
				return;
			case "closeSelectedRunStreams":
				closeSelectedRunStreams();
				return;
			default:
				return;
		}
	}

	// ------------------------------------------------------------- streams

	let rootRunSockets: WebSocket[] = [];
	let selectedRunSockets: WebSocket[] = [];

	function openRootRunStreams(runIds: string[]): void {
		rootRunSockets = runIds.map((runId) =>
			api.subscribeTaskRun(runId, {
				onMessage: (payload) => {
					if (!("taskRun" in payload)) {
						return;
					}
					dispatch((draft) =>
						applyRootRunUpdated(draft, payload.taskRun)
					);
				},
			})
		);
	}

	function closeRootRunStreams(): void {
		for (const socket of rootRunSockets) {
			socket.close();
		}
		rootRunSockets = [];
	}

	function openSelectedRunStreams(
		runId: string,
		includeChildren: boolean
	): void {
		const logsSocket = api.subscribeTaskLogs(
			runId,
			{
				onMessage: (payload: TaskRunLogsStreamMessage) => {
					if (payload.type === "snapshot") {
						dispatch((draft) =>
							applyLogSnapshot(draft, payload.logs)
						);
						return;
					}
					if (payload.type === "log") {
						dispatch((draft) => applyLogLine(draft, payload.log));
						return;
					}
					dispatch((draft) => applyLogError(draft, payload.message));
				},
				onError: () => {
					/* intentional no-op */
				},
				onClose: () => {
					/* intentional no-op */
				},
			},
			{ includeChildren }
		);

		const runSocket = api.subscribeTaskRun(runId, {
			onMessage: () => {
				refreshRuns().catch(() => undefined);
			},
			onError: () => {
				/* intentional no-op */
			},
		});

		selectedRunSockets = [logsSocket, runSocket];
	}

	function closeSelectedRunStreams(): void {
		for (const socket of selectedRunSockets) {
			socket.close();
		}
		selectedRunSockets = [];
	}

	const currentRow = createMemo(() => selectedRow(state));
	const currentRun = createMemo(() => selectedRun(state));
	const currentTaskKey = createMemo(() => selectedTaskKey(state));
	const displayStatus = createMemo(() => {
		const taskKey = currentTaskKey();
		return taskKey === null
			? undefined
			: state.displayStatusByTaskKey.get(taskKey);
	});
	const footerStatus = createMemo(() =>
		selectedFooterStatus(state, currentTaskKey())
	);
	const runAction = createMemo(() => selectedRunAction(state, currentRow()));
	const logColorByTaskKey = createMemo(() =>
		buildLogColorByTaskKey(state.tasks)
	);
	const tagWidth = createMemo(() => logTaskTagWidth(state.logs));

	async function refreshTasks() {
		const { data, error } = await api.listTasks(cwd);
		const tasks = error || !data || !("tasks" in data) ? null : data.tasks;
		dispatch((draft) => applyTasksLoaded(draft, tasks));
	}

	async function refreshRuns() {
		const { data, error } = await api.listTaskRuns(cwd);
		const taskRuns =
			error || !data || !("taskRuns" in data) ? null : data.taskRuns;
		dispatch((draft) => applyRunsLoaded(draft, taskRuns));
	}

	function quit() {
		renderer.destroy();
		process.exit(0);
	}

	function showCopyToast(message: string) {
		dispatch((draft) => {
			draft.copyToastMessage = message;
		});
		if (copyToastTimeoutId !== null) {
			clearTimeout(copyToastTimeoutId);
		}
		copyToastTimeoutId = setTimeout(() => {
			dispatch((draft) => {
				draft.copyToastMessage = null;
			});
			copyToastTimeoutId = null;
		}, COPY_TOAST_MS);
	}

	onCleanup(() => {
		if (copyToastTimeoutId !== null) {
			clearTimeout(copyToastTimeoutId);
			copyToastTimeoutId = null;
		}
	});

	function currentSelectionText(): string {
		const selection = renderer.getSelection();
		if (!selection?.isActive) {
			return "";
		}
		return getSelectedTextByRow(selection);
	}

	function copySelectionToClipboard(): void {
		const text = currentSelectionText();
		if (text.length === 0) {
			return;
		}
		const copied = renderer.copyToClipboardOSC52(text);
		const lineCount = text.split("\n").length;
		const linesLabel = lineCount === 1 ? "1 line" : `${lineCount} lines`;
		showCopyToast(
			copied
				? `Copied ${linesLabel} to clipboard`
				: "Copy failed (terminal does not support OSC52)"
		);
		renderer.clearSelection();
	}

	useKeyboard((key) => {
		// Resolved before dispatch so the state machine can decide whether
		// Ctrl+C copies a selection or quits without touching the renderer.
		const hasSelection = currentSelectionText().length > 0;
		dispatch((draft) => {
			draft.hasSelection = hasSelection;
			return applyKey(draft, key);
		});
	});

	onMount(() => {
		refreshTasks().catch(() => undefined);
		refreshRuns().catch(() => undefined);
		const interval = setInterval(() => {
			refreshRuns().catch(() => undefined);
		}, REFRESH_RUNS_MS);
		onCleanup(() => clearInterval(interval));
	});

	onCleanup(() => {
		closeRootRunStreams();
		closeSelectedRunStreams();
	});

	return (
		<AppContextProvider cliOptions={cliOptions} isMacOs={isMacOs}>
			<box flexDirection="column" height="100%" width="100%">
				<box flexDirection="row" flexGrow={1}>
					<TaskTreePanel
						displayStatusByTaskKey={state.displayStatusByTaskKey}
						hasTaskSearchError={state.showTaskSearchError}
						isTaskSearchFocused={state.isTaskSearchFocused}
						selectedTaskKey={currentTaskKey()}
						taskSearchQuery={state.taskSearchQuery}
						taskTree={state.taskTree}
					/>
					<RunDetailsPanel
						isFocused={state.focusedPane === "logs"}
						logColorByTaskKey={logColorByTaskKey()}
						logs={state.logs}
						logTaskTagWidth={tagWidth()}
						selectedFooterStatus={footerStatus()}
						selectedRunUpdatedAt={currentRun()?.updatedAt ?? null}
						selectedStatus={displayStatus() ?? null}
						selectedTaskKey={currentTaskKey()}
						waitingOn={currentRun()?.waitingOn ?? null}
					/>
				</box>
				<StatusFooter
					canCancel={canCancelSelected(state, currentTaskKey())}
					canRunOrRestart={currentRow() !== null}
					canToggleLogMode={canToggleLogMode(
						state.tasks,
						currentTaskKey()
					)}
					copyToastMessage={state.copyToastMessage}
					errorMessage={state.errorMessage}
					logMode={state.logMode}
					runAction={runAction()}
				/>
				<Show when={state.showQuitConfirmation}>
					<QuitConfirmationDialog
						isCancelling={state.isCancellingBeforeExit}
						runningTasks={stateRunningTaskRows(state)}
						selectedActionIndex={state.quitActionIndex}
					/>
				</Show>
			</box>
		</AppContextProvider>
	);
}

async function main() {
	const mode = await resolveCliMode(argv, cliOptions);
	if (mode.mode === "cli") {
		process.exit(mode.exitCode);
	}

	cliOptions = mode.cliOptions;
	cwd = cliOptions.cwd;
	// We handle Ctrl+C ourselves so it can copy a selection instead of always
	// exiting. Without this the renderer would call destroy() on Ctrl+C even
	// when our useKeyboard handler returns early.
	render(() => <App />, { exitOnCtrlC: false });
}

main().catch((error: unknown) => {
	if (error instanceof Error) {
		process.stderr.write(`${error.message}\n`);
	} else {
		process.stderr.write("Unknown CLI error.\n");
	}
	process.exit(1);
});
